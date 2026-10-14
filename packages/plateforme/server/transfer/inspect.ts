// L'inventaire et le contrôle d'une arborescence (1.4.3), derrière `call`, sans outil ajouté (ADR-002) : `node.tree` liste
// ce qu'on lit sous une racine (chemin, genre, titre, publié ou non, révision), page par page ; `node.check` y cherche ce
// qui casse un usage : un lien `[[…]]` vers un chemin qui n'existe pas, un bloc `call` que la publication refuserait
// aujourd'hui, une cellule qui vaut un chemin inconnu, un outil nommé avec le préfixe d'une autre organisation. L'import
// d'une arborescence le lance sur ce qu'il a importé. Les droits sont ceux de la lecture (`readableSubtree`) : rien de ce
// qu'on ne lit pas n'est listé ni contrôlé, et un lien vers un contenu qu'on ne voit pas compte comme un lien qui tient.
// Sans lui, inventorier un dossier demandait un export et un script, et un import ne se vérifiait qu'à la main.
import * as z from "zod/v4"
import { JOURNAL_PATH } from "../../schemas/journal"
import { NODE_PATH_PATTERN, nodePathSchema } from "../../schemas/nodes"
import { FILTERED_ROWS_MAX } from "../../schemas/tables"
import { TREE_NODES_MAX } from "../../schemas/tree-transfer"
import { defineFunction, type FunctionContext, type FunctionOutput } from "../catalog/define"
import type { PlatformDb } from "../db"
import { inTransaction, PlatformError } from "../errors"
import { HELP_PATH } from "../help"
import type { Identity } from "../identity"
import { findNode, type NodeRow } from "../nodes/lookup"
import { loadBlocks } from "../nodes/store"
import { FUNCTIONS_PATH } from "../reserved-paths"
import { loadRows } from "../tables/rows"
import { citedPaths, readableSubtree } from "./collect"
import { toolPrefixesIn } from "./links"

/** Nœuds par page de `node.tree`. */
const TREE_PAGE = 200

/** Problèmes au plus que `node.check` rend : au-delà, le compte. */
const PROBLEMS_MAX = 200

const treeArgsSchema = z.strictObject({
  path: nodePathSchema.describe("The root to list, with everything under it that you can read, e.g. sav."),
  continue_from: z.number().int().min(0).optional().describe("The value given by a previous answer that stopped at 200 nodes (default: from the start)."),
})

const checkArgsSchema = z.strictObject({
  path: nodePathSchema.describe("The root to check, with everything under it that you can read, e.g. csm_sav/sav."),
})

/** La racine et ce qu'on lit sous elle ; une racine inconnue ou illisible refuse, comme `read`. */
async function treeOf(db: PlatformDb, identity: Identity, path: string): Promise<NodeRow[]> {
  const found = await findNode(db, identity, path)
  if (!found) throw new PlatformError("not_found", `Unknown path ${path}. Use ${identity.org.prefix}_find to locate it.`)
  const nodes = await readableSubtree(db, identity, found.node)
  if (nodes.length > TREE_NODES_MAX) throw new PlatformError("too_large", `${path} holds more than ${TREE_NODES_MAX} nodes: check its folders one by one.`)
  return nodes
}

async function runTree(context: FunctionContext, args: z.infer<typeof treeArgsSchema>): Promise<FunctionOutput> {
  const nodes = await treeOf(context.db, context.identity, args.path)
  const from = args.continue_from ?? 0
  const page = nodes.slice(from, from + TREE_PAGE)
  const next = from + TREE_PAGE < nodes.length ? from + TREE_PAGE : null
  const lines = page.map((node) => `- ${node.path} (${node.kind}, ${node.revision === 0 ? "never published" : `revision ${node.revision}`}): ${node.title}`)
  const head = `${nodes.length} node(s) under ${args.path} that you can read${next === null ? "" : `, ${from + 1} to ${from + page.length} here`}:`
  const tail = next === null ? [] : [`Call node.tree again with continue_from ${next} for the next ones.`]
  const data = {
    total: nodes.length,
    nodes: page.map((node) => ({ path: node.path, kind: node.kind, title: node.title, revision: node.revision })),
    ...(next === null ? {} : { continue_from: next }),
  }
  return { text: [head, ...lines, ...tail].join("\n"), data }
}

/** Les chemins qui existent, rangés ou anciens chemins d'un contenu déplacé, parmi ceux qu'on demande. */
async function existingPaths(db: PlatformDb, identity: Identity, paths: readonly string[]): Promise<Set<string>> {
  if (paths.length === 0) return new Set()
  const rows = await inTransaction(db, "check: paths", (sql) => sql<{ path: string }[]>`
    select path from platform.nodes where org_id = ${identity.org.id} and deleted_at is null and path in ${sql([...paths])}
    union
    select old_path as path from platform.node_aliases where org_id = ${identity.org.id} and old_path in ${sql([...paths])}`)
  return new Set(rows.map((row) => row.path))
}

const RESERVED: ReadonlySet<string> = new Set([JOURNAL_PATH, FUNCTIONS_PATH, HELP_PATH])

/** Un chemin cité qui se vérifie : il a la forme d'un chemin, et n'est ni un chemin réservé ni un nom de fonction. */
const checkable = (path: string) => NODE_PATH_PATTERN.test(path) && !RESERVED.has(path)

/** Les préfixes d'outils d'une autre organisation qu'un texte nomme. */
function foreignPrefixes(text: string, prefix: string): string[] {
  return toolPrefixesIn(text).filter((one) => one !== prefix)
}

/** Les textes d'un bloc : son texte, et les textes de ses éléments de liste. */
function blockTexts(block: { text: string | null; data: Record<string, unknown> }): string[] {
  const items = Array.isArray(block.data.items) ? block.data.items.flatMap((item: unknown) => (typeof item === "string" ? [item] : [])) : []
  return [...(block.text ? [block.text] : []), ...items]
}

/** Les cellules texte d'une ligne de tableau. */
const cellsOf = (data: unknown): string[] => (data !== null && typeof data === "object" ? Object.values(data).filter((value): value is string => typeof value === "string") : [])

type Finding = { path: string; problem: string }

/** Ce qu'on contrôle d'un nœud : ses liens et ses mentions, ses appels (procédure), ses cellules (tableau). */
async function nodeFindings(db: PlatformDb, identity: Identity, node: NodeRow, cited: Map<string, Set<string>>): Promise<Finding[]> {
  const findings: Finding[] = []
  const cite = (path: string) => {
    if (checkable(path)) cited.set(path, (cited.get(path) ?? new Set()).add(node.path))
  }
  const texts: string[] = []
  if (node.kind === "table") {
    const cells = (await loadRows(db, node.id, FILTERED_ROWS_MAX)).flatMap((row) => cellsOf(row.data))
    texts.push(...cells)
    for (const cell of cells.filter((one) => one.includes("/"))) cite(cell)
  } else if (node.revision > 0) {
    const blocks = await loadBlocks(db, node.id, "published")
    for (const block of blocks) {
      texts.push(...blockTexts(block))
      for (const path of citedPaths({ type: block.type, text: block.text, data: block.data, key: null })) cite(path)
    }
    if (node.kind === "procedure") {
      // Importé à l'appel : le contrôle des procédures relit le registre du catalogue, qui importe ce module (`write-lazy.ts`).
      const { checkProcedureBlocks } = await import("../procedures-check")
      for (const refusal of await checkProcedureBlocks(db, identity, blocks)) findings.push({ path: node.path, problem: `procedure: ${refusal.message}` })
    }
  }
  for (const other of foreignPrefixes(texts.join("\n"), identity.org.prefix)) {
    findings.push({ path: node.path, problem: `names tools of another organisation (${other}_…): write read, write, find, call without prefix` })
  }
  return findings
}

/**
 * Les problèmes de l'arbre lisible sous chaque racine : une ligne par problème, `<chemin>: <problème>`. Relu par l'import
 * sur ce qu'il a importé. Les chemins cités sont vérifiés en une requête.
 */
export async function checkTree(db: PlatformDb, identity: Identity, roots: readonly string[]): Promise<string[]> {
  const findings: Finding[] = []
  const cited = new Map<string, Set<string>>()
  for (const root of roots) {
    for (const node of await treeOf(db, identity, root)) findings.push(...(await nodeFindings(db, identity, node, cited)))
  }
  const existing = await existingPaths(db, identity, [...cited.keys()])
  for (const [path, from] of cited) {
    if (existing.has(path)) continue
    for (const source of from) findings.push({ path: source, problem: `links to ${path}, which does not exist` })
  }
  return findings.map((finding) => `${finding.path}: ${finding.problem}`)
}

async function runCheck(context: FunctionContext, args: z.infer<typeof checkArgsSchema>): Promise<FunctionOutput> {
  const problems = await checkTree(context.db, context.identity, [args.path])
  if (problems.length === 0) return { text: `Nothing to fix under ${args.path}: links, calls, table cells and tool names hold.`, data: { problems: [] } }
  const shown = problems.slice(0, PROBLEMS_MAX)
  const more = problems.length > PROBLEMS_MAX ? [`… and ${problems.length - PROBLEMS_MAX} more.`] : []
  return { text: [`${problems.length} problem(s) under ${args.path}:`, ...shown.map((line) => `- ${line}`), ...more].join("\n"), data: { problems } }
}

export const nodeTree = defineFunction({
  name: "node.tree",
  connector: "node",
  class: "read",
  origin: "paquet",
  description:
    "Lists a root and everything under it that you can read: path, kind, title, whether it was ever published, revision; 200 nodes per answer, continue_from for the next ones. Use it to take stock of a folder before reorganising, copying or checking it; find returns a few results only. In French: lister, inventorier, arborescence d'un dossier.",
  schema: treeArgsSchema,
  examples: [{ path: "sav" }, { path: "sav", continue_from: 200 }],
  refusals: ["An unknown root, or one you cannot read; more than 2,000 nodes (list the folders one by one)."],
  next: ["node.check"],
  run: runTree,
})

export const nodeCheck = defineFunction({
  name: "node.check",
  connector: "node",
  class: "read",
  origin: "paquet",
  description:
    "Checks a root and everything under it that you can read: links [[…]] to a path that does not exist, call blocks of a procedure that publication would refuse now (unknown function or table), table cells naming a path that does not exist, tools named with another organisation's prefix. One line per problem, with its path. Use it after an import, a reorganisation or before relying on a folder. In French: vérifier, contrôler, liens cassés.",
  schema: checkArgsSchema,
  examples: [{ path: "csm_sav/sav" }],
  refusals: ["An unknown root, or one you cannot read; more than 2,000 nodes (check the folders one by one)."],
  next: [],
  run: runCheck,
})
