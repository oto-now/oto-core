// L'import d'une arborescence (`node.import_tree`) : le plan d'une source (`formats.ts`) greffé sous un parent de la
// destination, en deux passes, sous les droits de l'appelant. Passe 1 : chaque nœud créé vide, un parent avant ses
// enfants, pour réserver les chemins ; passe 2 : chaque contenu écrit, ses liens recollés au nouveau préfixe ; puis
// l'en-tête complet d'un tableau du pivot (file de travail, tableau fermé, preuve exigée), posé après ses lignes pour
// qu'aucune ne soit refusée par une règle qui ne valait pas à leur écriture. Chaque écriture passe par le service de
// `write` ou de `table.write` : droits, bornes et refus sont les leurs (ADR-012 § 3). Rien n'est gardé entre deux
// appels : un import se reprend par son chemin (une page vide se remplit, une page écrite se garde ou s'écrase), et une
// réponse arrêtée par le temps donne l'étape d'où repartir. Sans lui, une base de connaissances se recopierait page par
// page par l'assistant, et un tableau y perdrait son schéma et ses preuves.
import { readPageMarkdown } from "../../schemas/blocks-render"
import type { TableHeader } from "../../schemas/tables"
import { tableWriteArgsSchema } from "../../schemas/table-write"
import type { TreeCollision, TreeImportArgs } from "../../schemas/tree-transfer"
import type { FunctionContext } from "../catalog/define"
import { isPlatformError, PlatformError } from "../errors"
import { findNode, parentPath, type NodeRow } from "../nodes/lookup"
import { childPath, freePath, lastSegment } from "../nodes/segments"
import { loadBlocks } from "../nodes/store"
import { writeNodeLazily } from "../nodes/write-lazy"
import type { WriteOrigin } from "../nodes/write-result"
import { importRows, inferredHeader } from "../tables/import"
import { publishedHeader } from "../tables/meta"
import { countRows } from "../tables/rows"
import { tableWrite } from "../tables/write"
import { carryFiles } from "./files"
import type { ImportPlan, PlanNode } from "./formats"
import { rewriteLinks } from "./links"

/** Le temps d'un appel avant de rendre la main : la route MCP a 60 s, la réponse et le journal en prennent une part. */
const TIME_BUDGET_MS = 40_000
/** Lignes par écriture d'un tableau : celles de `table.write`. */
const ROWS_PER_WRITE = 50
/** Lignes au plus du rapport par catégorie : le reste se compte. */
const REPORT_LINES_MAX = 30

/** Où repartir : l'étape, et les chemins pris par `suffix` pour les nœuds du haut (un appel les recalculerait autrement). */
type Cursor = { step: number; tops: Record<string, string> }

export type ImportReport = {
  created: string[]
  updated: string[]
  skipped: { path: string; reason: string }[]
  refused: { path: string; reason: string }[]
  /** Une procédure que la publication refuse (une fonction absente du catalogue, un appel invalide) : son texte gardé en brouillon. */
  drafts: { path: string; reason: string }[]
  orphans: { from: string; to: string }[]
  notes: string[]
}

type Run = {
  context: FunctionContext
  plan: ImportPlan
  args: Required<Pick<TreeImportArgs, "parent" | "root_folder" | "collision">>
  origin: WriteOrigin
  source: string
  cursor: Cursor
  report: ImportReport
}

/** Le curseur d'une réponse arrêtée par le temps, relu tel quel. */
export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url")
}

function decodeCursor(token: string | undefined): Cursor {
  if (token === undefined) return { step: 0, tops: {} }
  try {
    const parsed: unknown = JSON.parse(Buffer.from(token, "base64url").toString("utf8"))
    if (typeof parsed === "object" && parsed !== null && "step" in parsed && Number.isInteger(parsed.step) && "tops" in parsed && typeof parsed.tops === "object") {
      // Forme contrôlée juste au-dessus ; une place forgée n'est reprise que sous le parent (`destinationOf`).
      return parsed as Cursor
    }
  } catch {
    // Illisible : le refus ci-dessous.
  }
  throw new PlatformError("invalid_arguments", "continue_from is not a step given by a previous answer: call again without it.")
}

/** Le préfixe du haut d'un chemin relatif : sa racine, ou, quand on déverse, sa racine et l'enfant de celle-ci. */
function topOf(run: Run, path: string): string | null {
  const parts = path.split("/")
  const depth = run.args.root_folder ? 1 : 2
  return parts.length < depth ? null : parts.slice(0, depth).join("/")
}

/** Le chemin d'arrivée d'un chemin relatif ; `null` pour une racine qu'on déverse (elle n'est pas créée). */
function destinationOf(run: Run, path: string): string | null {
  const top = topOf(run, path)
  if (top === null) return null
  const rest = path.slice(top.length)
  // Une place retenue par le curseur ne vaut que sous le parent : un `continue_from` récrit à la main ne déplace rien ailleurs.
  const remembered = run.cursor.tops[top]
  const kept = remembered !== undefined && parentPath(remembered) === run.args.parent
  const placed = kept ? remembered : childPath(run.args.parent, lastSegment(top))
  return `${placed}${rest}`
}

/** Un lien de la source vers un chemin d'arrivée, `null` hors du périmètre (laissé tel quel, dit au rapport). */
function relinked(run: Run, sourcePath: string): string | null {
  const relative = run.plan.relink(sourcePath)
  if (relative === null) return null
  return destinationOf(run, relative) ?? run.args.parent
}

/** Ce qu'un nœud déjà là contient : rien (une page sans bloc publié, un tableau sans ligne), ou du contenu. */
async function isEmpty(run: Run, node: NodeRow): Promise<boolean> {
  if (node.kind === "table") return (await countRows(run.context.db, node.id)) === 0
  return (await loadBlocks(run.context.db, node.id, "published")).length === 0
}

/** Le genre d'un nœud de la destination, comparé à celui du plan (un Contexte compte comme une page). */
function kindOf(node: NodeRow): string {
  return node.kind === "context" ? "page" : node.kind
}

/** L'en-tête de création d'un tableau : colonnes et clé seulement ; file de travail, fermeture et preuve après les lignes. */
function creationHeader(node: PlanNode): { columns: TableHeader["columns"]; key: string } {
  if (node.table) return { columns: node.table.header.columns, key: node.table.header.key }
  const csv = node.csv ?? { headers: [], rows: [] }
  return inferredHeader(csv.headers, csv.rows, undefined)
}

function message(error: unknown): string {
  return isPlatformError(error) ? `${error.code}: ${error.message.split("\n")[0]}` : "internal error"
}

/** Passe 1 : le chemin réservé, le nœud créé vide s'il manque ; un chemin pris se juge selon `collision`. */
async function reserve(run: Run, node: PlanNode): Promise<void> {
  const destination = destinationOf(run, node.path)
  if (destination === null) {
    run.report.notes.push(`${node.path}: its content goes directly under ${run.args.parent}; the root page itself is not created.`)
    return
  }
  const { db, identity } = run.context
  let existing = await findNode(db, identity, destination)
  const top = topOf(run, node.path)
  if (existing && run.args.collision === "suffix" && top === node.path && run.cursor.tops[top] === undefined) {
    // Le nœud du haut va à côté du chemin pris ; ses descendants le suivent.
    const placed = await freePath(db, identity, { parent: run.args.parent, segment: lastSegment(top) })
    run.cursor.tops[top] = placed
    existing = null
  }
  const target = destinationOf(run, node.path) ?? destination
  if (existing) {
    if (kindOf(existing.node) !== node.kind) run.report.refused.push({ path: target, reason: `already a ${existing.node.kind}, not a ${node.kind}: left as it is` })
    return
  }
  try {
    const body = node.kind === "table" ? { header: creationHeader(node) } : {}
    await writeNodeLazily(db, identity, { path: target, kind: node.kind, title: node.title, summary: node.summary, ...body }, run.origin)
    run.report.created.push(target)
  } catch (error) {
    run.report.refused.push({ path: target, reason: message(error) })
  }
}

/** Les morceaux du corps d'une page, ses liens recollés ; le titre ajouté puis retiré, pour qu'un `#` du corps reste. */
function chunksOf(run: Run, node: PlanNode, destination: string): string[] {
  if (node.markdown.trim() === "") return []
  const body = rewriteLinks(node.markdown, (path) => relinked(run, path), (to) => run.report.orphans.push({ from: destination, to }))
  return readPageMarkdown(`# ${node.title}\n\n${body}`, `${lastSegment(destination)}.md`).chunks
}

/** Une ligne du pivot dans la forme de `table.write` : chaque valeur avec sa preuve quand elle en a une. */
function rowWrite(row: NonNullable<PlanNode["table"]>["rows"][number]) {
  const set = Object.fromEntries(Object.entries(row.set).map(([column, value]) => [column, row.proofs?.[column] ? { value, ...row.proofs[column] } : value]))
  return { key: row.key, set, ...(row.verified_empty ? { verified_empty: row.verified_empty } : {}) }
}

/** Les lignes d'un tableau du pivot, par lots de 50 : une ligne refusée est dite au rapport, les autres s'écrivent. */
async function writeTableRows(run: Run, destination: string, rows: NonNullable<PlanNode["table"]>["rows"]): Promise<void> {
  for (let from = 0; from < rows.length; from += ROWS_PER_WRITE) {
    const args = tableWriteArgsSchema.parse({ table: destination, rows: rows.slice(from, from + ROWS_PER_WRITE).map(rowWrite) })
    // `run` d'une fonction du registre est typé sur l'union de ses schémas (`never` ici) : `args` sort de son propre schéma.
    const output = await tableWrite.run(run.context, args as never)
    // `data` d'une fonction est un objet libre : la forme des lignes est celle que `table.write` rend.
    const outcomes = Array.isArray(output.data?.rows) ? (output.data.rows as { key?: unknown; status?: unknown; message?: unknown }[]) : []
    for (const outcome of outcomes) {
      if (outcome.status === "refused") run.report.refused.push({ path: `${destination} (row ${String(outcome.key)})`, reason: String(outcome.message ?? "refused") })
    }
  }
}

/**
 * Le corps d'une page ou d'une procédure : ses fichiers joints d'abord, puis tout son texte en une écriture. Une procédure
 * dont la publication est refusée (une fonction que ce catalogue n'a pas) garde son texte en brouillon, à corriger à
 * l'écran ou par l'assistant, plutôt que de disparaître de l'import.
 */
async function writeBody(run: Run, node: PlanNode, destination: string, target: { node: NodeRow; created: boolean }): Promise<void> {
  const { db, identity } = run.context
  const carried = node.files ? await carryFiles(run.context, target.node.id, node.markdown, node.files) : { markdown: node.markdown, failed: [] }
  for (const file of carried.failed) run.report.refused.push({ path: `${destination} (file ${file.name})`, reason: file.reason })
  const chunks = chunksOf(run, { ...node, markdown: carried.markdown }, destination)
  if (chunks.length === 0) return
  // Chaque morceau en tête, du dernier au premier : l'ordre du texte, en une écriture qui remplace tout le corps.
  const ops = [...chunks].reverse().map((text) => ({ op: "insert_after", text }))
  const origin: WriteOrigin = { kind: "agent", ctx: run.context.ctx ?? null, file: { replace: true } }
  const summary = target.created || target.node.summary === node.summary ? {} : { summary: node.summary }
  const input = { path: destination, base_revision: target.node.revision, ops, ...summary }
  try {
    await writeNodeLazily(db, identity, input, origin)
  } catch (error) {
    if (node.kind !== "procedure") throw error
    await writeNodeLazily(db, identity, { ...input, publish: false }, origin)
    run.report.drafts.push({ path: destination, reason: message(error) })
  }
}

/** Passe 2 : le contenu d'un nœud ; un chemin pris garde le sien quand `skip` le dit et qu'il n'est pas vide. */
async function fill(run: Run, node: PlanNode): Promise<void> {
  const destination = destinationOf(run, node.path)
  // Un nœud sans contenu (la page d'un dossier, un tableau sans ligne) n'a rien à écrire après sa création.
  const content = node.markdown.trim() !== "" || (node.table?.rows.length ?? 0) > 0 || (node.csv?.rows.length ?? 0) > 0
  if (destination === null || !content) return
  const { db, identity } = run.context
  const found = await findNode(db, identity, destination)
  if (!found || kindOf(found.node) !== node.kind) return
  const created = run.report.created.includes(destination)
  if (!created && run.args.collision !== "overwrite" && !(await isEmpty(run, found.node))) {
    run.report.skipped.push({ path: destination, reason: "already there, with content" })
    return
  }
  try {
    if (node.kind === "table") {
      if (node.table) await writeTableRows(run, destination, node.table.rows)
      else if (node.csv) {
        await importRows(run.context, { path: destination, by: run.origin, comment: `Importé de ${run.source}`, headers: node.csv.headers, rows: node.csv.rows })
      }
    } else {
      await writeBody(run, node, destination, { node: found.node, created })
    }
    if (!created) run.report.updated.push(destination)
  } catch (error) {
    run.report.refused.push({ path: destination, reason: message(error) })
  }
}

/** Passe 3 : l'en-tête complet d'un tableau du pivot, ce que sa création a laissé (file de travail, fermeture, preuve). */
async function finish(run: Run, node: PlanNode): Promise<void> {
  const destination = destinationOf(run, node.path)
  const header = node.table?.header
  if (destination === null || !header || (!header.lifecycle && !header.closed && !header.proof)) return
  const { db, identity } = run.context
  const found = await findNode(db, identity, destination)
  if (!found || found.node.kind !== "table") return
  const current = publishedHeader(found.node)
  if ("header" in current && JSON.stringify([current.header.lifecycle, current.header.closed, current.header.proof]) === JSON.stringify([header.lifecycle, header.closed, header.proof])) return
  const patch = { ...(header.lifecycle ? { lifecycle: header.lifecycle } : {}), closed: header.closed, proof: header.proof }
  try {
    await writeNodeLazily(db, identity, { path: destination, base_revision: found.node.revision, header: patch }, run.origin)
  } catch (error) {
    run.report.refused.push({ path: `${destination} (header)`, reason: message(error) })
  }
}

/** Les étapes d'un plan, dans l'ordre : réserver chaque nœud, remplir chaque nœud, finir chaque tableau. */
function steps(plan: ImportPlan): { pass: "reserve" | "fill" | "finish"; node: PlanNode }[] {
  return [
    ...plan.nodes.map((node) => ({ pass: "reserve" as const, node })),
    ...plan.nodes.map((node) => ({ pass: "fill" as const, node })),
    ...plan.nodes.filter((node) => node.table).map((node) => ({ pass: "finish" as const, node })),
  ]
}

export type ImportRun = { report: ImportReport; total: number; done: number; next: string | null }

/**
 * L'import d'un plan sous `parent` : le parent doit exister et se lire ; chaque étape à partir du curseur, jusqu'au bout
 * ou jusqu'à la fin du temps d'un appel, qui rend l'étape d'où repartir.
 */
export async function runImport(
  context: FunctionContext,
  plan: ImportPlan,
  args: TreeImportArgs & { source: string },
  now: () => number = Date.now,
): Promise<ImportRun> {
  const parent = await findNode(context.db, context.identity, args.parent)
  if (!parent) throw new PlatformError("not_found", `Unknown parent ${args.parent}. Use ${context.identity.org.prefix}_find to locate it.`)
  const collision: TreeCollision = args.collision ?? "skip"
  const run: Run = {
    context,
    plan,
    args: { parent: parent.node.path, root_folder: args.root_folder ?? true, collision },
    origin: { kind: "agent", ctx: context.ctx ?? null },
    source: args.source,
    cursor: decodeCursor(args.continue_from),
    report: { created: [], updated: [], skipped: [], refused: [], drafts: [], orphans: [], notes: [...plan.notes] },
  }
  const all = steps(plan)
  const started = now()
  let step = run.cursor.step
  for (; step < all.length; step++) {
    if (step > run.cursor.step && now() - started > TIME_BUDGET_MS) break
    const { pass, node } = all[step]
    if (pass === "reserve") await reserve(run, node)
    else if (pass === "fill") await fill(run, node)
    else await finish(run, node)
  }
  const next = step < all.length ? encodeCursor({ step, tops: run.cursor.tops }) : null
  return { report: run.report, total: all.length, done: step, next }
}

/** Les lignes d'une liste du rapport, bornées : les 30 premières, puis le compte du reste. */
export function reportLines(items: readonly string[]): string[] {
  if (items.length <= REPORT_LINES_MAX) return [...items]
  return [...items.slice(0, REPORT_LINES_MAX), `… and ${items.length - REPORT_LINES_MAX} more`]
}
