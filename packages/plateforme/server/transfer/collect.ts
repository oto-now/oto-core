// L'arbre lu pour un export (`node.export_tree`) : chaque racine demandée et ses descendants que la personne lit, leur
// contenu publié (blocs d'une page ou d'une procédure, en-tête et lignes d'un tableau avec la preuve de chaque valeur),
// rangé dans le format pivot (`schemas/tree-transfer.ts`). Les droits sont décidés ici, avant toute lecture de contenu
// (ADR-012 § 3) : `findNode` pour une racine, `nodeLevels` pour ses descendants ; ce qu'on ne lit pas reste hors de
// l'export, et ce qui est sous lui aussi. Sans lui, l'export lirait le contenu sans les règles d'accès.
import { linksIn } from "../../schemas/link-syntax"
import {
  TREE_FORMAT,
  TREE_FORMAT_VERSION,
  TREE_NODES_MAX,
  type PivotBlock,
  type PivotNode,
  type PivotRow,
  type TreePivot,
} from "../../schemas/tree-transfer"
import { FILTERED_ROWS_MAX } from "../../schemas/tables"
import { ACCESS_LEVELS, nodeLevels } from "../access"
import type { PlatformDb } from "../db"
import { inTransaction, PlatformError } from "../errors"
import type { Identity } from "../identity"
import { isJsonObject } from "../json"
import { findNode, NODE_SQL_COLUMNS, parentPath, type NodeRow } from "../nodes/lookup"
import { lastSegment } from "../nodes/segments"
import { loadBlocks } from "../nodes/store"
import { publishedHeader } from "../tables/meta"
import { loadRows, toReadRow } from "../tables/rows"

/** Ce que l'export dit en plus du pivot : liens hors du périmètre, nœuds laissés, fichiers joints non emportés. */
export type ExportReport = {
  /** Un lien `[[…]]` ou un bloc de référence vers un chemin hors des racines exportées : laissé tel quel. */
  orphans: { from: string; to: string }[]
  /** Un nœud non emporté : jamais publié, ou un tableau de plus de 5 000 lignes. */
  skipped: { path: string; reason: string }[]
  /** Un fichier joint ou une image jointe : seule sa mention voyage, pas ses octets. */
  files: { from: string; name: string }[]
}

type Collected = { pivot: TreePivot; report: ExportReport }

/** Les descendants vivants d'une racine que la personne lit, chacun sous un parent gardé, un parent avant ses enfants. */
async function readableSubtree(db: PlatformDb, identity: Identity, root: NodeRow): Promise<NodeRow[]> {
  const rows = await inTransaction(db, "export: subtree", (sql) => sql<NodeRow[]>`
    select ${sql(NODE_SQL_COLUMNS)}
      from platform.nodes
     where org_id = ${identity.org.id} and deleted_at is null and starts_with(path, ${`${root.path}/`})
     order by path`)
  const levels = await nodeLevels(db, identity, rows.map((row) => row.id))
  const kept = new Set([root.id])
  const subtree = [root]
  for (const row of rows) {
    if (row.parent_id !== null && kept.has(row.parent_id) && (levels.get(row.id) ?? ACCESS_LEVELS.none) >= ACCESS_LEVELS.read) {
      kept.add(row.id)
      subtree.push(row)
    }
  }
  return subtree
}

/** Les chemins que citent les textes d'un bloc : ses liens `[[…]]` et le chemin d'un bloc de référence. */
function citedPaths(block: PivotBlock): string[] {
  const texts: string[] = []
  if (typeof block.text === "string") texts.push(block.text)
  const items = block.data.items
  if (Array.isArray(items)) for (const item of items) if (isJsonObject(item) && typeof item.text === "string") texts.push(item.text)
  const paths = texts.flatMap((text) => linksIn(text).flatMap((found) => (found.link ? [found.link.path] : [])))
  if (block.type === "reference" && typeof block.data.path === "string") paths.push(block.data.path)
  return paths
}

/** Un chemin sous l'une des racines exportées (elle comprise). */
function underRoots(path: string, roots: readonly string[]): boolean {
  return roots.some((root) => path === root || path.startsWith(`${root}/`))
}

/** Les blocs publiés d'une page en pivot ; un fichier joint ne voyage pas : sa mention est dite au rapport. */
function pivotBlocks(path: string, blocks: Awaited<ReturnType<typeof loadBlocks>>, report: ExportReport): PivotBlock[] {
  const kept: PivotBlock[] = []
  for (const block of blocks) {
    if (block.type === "row") continue
    const attached = block.type === "file" || (block.type === "image" && typeof block.data.file_id === "string" && block.data.src === undefined)
    if (attached) {
      const name = typeof block.data.name === "string" ? block.data.name : typeof block.data.alt === "string" ? block.data.alt : "file"
      report.files.push({ from: path, name })
      kept.push({ type: "paragraph", text: `(Fichier joint non transféré : ${name})`, data: {}, key: null })
      continue
    }
    kept.push({ type: block.type, text: block.text, data: block.data, key: block.key })
  }
  return kept
}

/** Une ligne en pivot : ses valeurs, ses vides vérifiés, et pour chaque valeur sa preuve (commentaire, lien). */
function pivotRow(row: ReturnType<typeof toReadRow>): PivotRow {
  const proofs: NonNullable<PivotRow["proofs"]> = {}
  for (const [column, provenance] of Object.entries(row.provenance ?? {})) {
    if (row.set[column] === undefined) continue
    const proof = { ...(provenance.comment ? { comment: provenance.comment } : {}), ...(provenance.link ? { link: provenance.link } : {}) }
    if (Object.keys(proof).length > 0) proofs[column] = proof
  }
  return {
    key: row.key,
    set: row.set,
    ...(row.verified_empty ? { verified_empty: row.verified_empty } : {}),
    ...(Object.keys(proofs).length > 0 ? { proofs } : {}),
  }
}

/** Un nœud en pivot, ou la raison de le laisser. */
async function pivotNode(db: PlatformDb, node: NodeRow, relative: string, report: ExportReport): Promise<PivotNode | null> {
  const head = { path: relative, title: node.title, summary: node.summary }
  if (node.kind === "table") {
    const published = publishedHeader(node)
    if ("missing" in published) {
      report.skipped.push({ path: node.path, reason: "table never published" })
      return null
    }
    const blocks = await loadRows(db, node.id, FILTERED_ROWS_MAX)
    if (blocks.length > FILTERED_ROWS_MAX) {
      report.skipped.push({ path: node.path, reason: `table of more than ${FILTERED_ROWS_MAX} rows` })
      return null
    }
    const rows = blocks.map((block) => pivotRow(toReadRow(block, published.header, new Map(), { provenance: true })))
    return { ...head, kind: "table", table: { header: published.header, rows } }
  }
  if (node.revision === 0) {
    report.skipped.push({ path: node.path, reason: "never published" })
    return null
  }
  // Un Contexte voyage en page : à la destination, son chemin ne désigne pas forcément le Contexte d'une équipe.
  const kind = node.kind === "procedure" ? "procedure" : "page"
  return { ...head, kind, blocks: pivotBlocks(node.path, await loadBlocks(db, node.id, "published"), report) }
}

/**
 * Le pivot des racines `paths` : chaque racine illisible ou inconnue refuse l'export (`not_found`), une racine sous une
 * autre aussi (`invalid_arguments`) ; au-delà de 2 000 nœuds, `too_large`. Chaque nœud porte son chemin relatif : le
 * nom de sa racine, puis son chemin sous elle.
 */
export async function collectTree(db: PlatformDb, identity: Identity, paths: readonly string[], origin?: string): Promise<Collected> {
  const unique = [...new Set(paths)]
  const nested = unique.find((path) => unique.some((other) => other !== path && path.startsWith(`${other}/`)))
  if (nested) throw new PlatformError("invalid_arguments", `${nested} is under another root of this export: give its ancestor only.`)
  const roots: { node: NodeRow; name: string }[] = []
  for (const path of unique) {
    const found = await findNode(db, identity, path)
    if (!found) throw new PlatformError("not_found", `Unknown path ${path}. Use ${identity.org.prefix}_find to locate it.`)
    roots.push({ node: found.node, name: lastSegment(found.node.path) })
  }
  const names = roots.map((root) => root.name)
  const twice = names.find((name, index) => names.indexOf(name) !== index)
  if (twice) throw new PlatformError("invalid_arguments", `Two roots end with ${twice}: export them in two calls, or export their common parent.`)

  const report: ExportReport = { orphans: [], skipped: [], files: [] }
  const nodes: PivotNode[] = []
  const rootPaths = roots.map((root) => root.node.path)
  for (const root of roots) {
    const subtree = await readableSubtree(db, identity, root.node)
    if (nodes.length + subtree.length > TREE_NODES_MAX) {
      throw new PlatformError("too_large", `This export holds more than ${TREE_NODES_MAX} nodes: export fewer roots, or the folders under them one by one.`)
    }
    const skipped = new Set<string>()
    for (const node of subtree) {
      // Sous un nœud laissé, rien ne voyage : son parent manquerait à la destination.
      if (skipped.has(parentPath(node.path) ?? "")) {
        skipped.add(node.path)
        report.skipped.push({ path: node.path, reason: "under a node left out" })
        continue
      }
      const relative = `${root.name}${node.path.slice(root.node.path.length)}`
      const pivot = await pivotNode(db, node, relative, report)
      if (!pivot) {
        skipped.add(node.path)
        continue
      }
      const cited = (pivot.blocks ?? []).flatMap((block) => citedPaths(block))
      for (const to of cited.filter((path) => !underRoots(path, rootPaths))) report.orphans.push({ from: node.path, to })
      nodes.push(pivot)
    }
  }
  const pivot: TreePivot = {
    format: TREE_FORMAT,
    version: TREE_FORMAT_VERSION,
    exported_at: new Date().toISOString(),
    source: { org: identity.org.slug, ...(origin ? { origin } : {}) },
    roots: roots.map((root) => ({ path: root.node.path, name: root.name })),
    nodes,
  }
  return { pivot, report }
}
