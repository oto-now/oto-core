// L'import d'une arborescence (`node.import_tree`) : le plan d'une source (`formats.ts`) greffé sous un parent de la
// destination, en deux passes, sous les droits de l'appelant. Passe 1 : chaque nœud créé vide, un parent avant ses
// enfants, pour réserver les chemins ; passe 2 : chaque contenu écrit, ses liens recollés au nouveau préfixe ; puis
// l'en-tête complet d'un tableau du pivot (file de travail, tableau fermé, preuve exigée), posé après ses lignes pour
// qu'aucune ne soit refusée par une règle qui ne valait pas à leur écriture. Chaque écriture passe par le service de
// `write` ou de `table.write` : droits, bornes et refus sont les leurs (ADR-012 § 3). Rien n'est gardé entre deux
// appels : un import se reprend par son chemin (une page vide se remplit, une page écrite se garde ou s'écrase), et une
// réponse arrêtée par le temps donne l'étape d'où repartir. Un nœud que l'import crée puis ne peut remplir ne reste pas
// vide : une page ou un tableau partent à la corbeille, une procédure garde son texte en brouillon. Un chemin tenu à
// l'arrivée (un Contexte, un chemin pris ou réservé) fait placer le nœud au premier chemin libre, ses enfants le suivant.
// Sans lui, une base de connaissances se recopierait page par page par l'assistant, et un tableau y perdrait son schéma et
// ses preuves.
import { readPageMarkdown } from "../../schemas/blocks-render"
import type { TableHeader } from "../../schemas/tables"
import { tableWriteArgsSchema } from "../../schemas/table-write"
import type { TreeCollision, TreeImportArgs } from "../../schemas/tree-transfer"
import type { FunctionContext } from "../catalog/define"
import { isPlatformError, PlatformError } from "../errors"
import { findNode, parentPath, type NodeRow } from "../nodes/lookup"
import { childPath, freePath, lastSegment } from "../nodes/segments"
import { loadBlocks } from "../nodes/store"
import { trashNode } from "../nodes/trash"
import { writeNodeLazily } from "../nodes/write-lazy"
import type { WriteOrigin } from "../nodes/write-result"
import { importRows, inferredHeader } from "../tables/import"
import { publishedHeader } from "../tables/meta"
import { countRows } from "../tables/rows"
import { tableWrite } from "../tables/write"
import { carryFiles } from "./files"
import type { ImportPlan, PlanNode } from "./formats"
import { decodeCursor, emptyReport, encodeCursor, refusalOf, type Cursor, type ImportReport } from "./import-report"
import { relinkedCell, rewriteLinks, rewritePrefixes } from "./links"

export { reportLines, type ImportReport } from "./import-report"

/** Le temps d'un appel avant de rendre la main : la route MCP a 60 s, la réponse et le journal en prennent une part. */
const TIME_BUDGET_MS = 40_000
/** Lignes par écriture d'un tableau : celles de `table.write`. */
const ROWS_PER_WRITE = 50

type Run = {
  context: FunctionContext
  plan: ImportPlan
  args: Required<Pick<TreeImportArgs, "parent" | "root_folder" | "collision">>
  origin: WriteOrigin
  source: string
  /** Les chemins relatifs des nœuds du plan : une cellule n'est un chemin à recoller que si elle en vaut un. */
  paths: ReadonlySet<string>
  /** Le préfixe des outils de la source et celui de l'arrivée, quand la source le dit (le pivot) et qu'ils diffèrent. */
  prefixes: { from: string; to: string } | null
  cursor: Cursor
  report: ImportReport
}

export { encodeCursor } from "./import-report"

/** Le préfixe du haut d'un chemin relatif : sa racine, ou, quand on déverse, sa racine et l'enfant de celle-ci. */
function topOf(run: Run, path: string): string | null {
  const parts = path.split("/")
  const depth = run.args.root_folder ? 1 : 2
  return parts.length < depth ? null : parts.slice(0, depth).join("/")
}

/**
 * Le chemin d'arrivée d'un chemin relatif ; `null` pour une racine qu'on déverse (elle n'est pas créée). Une place retenue
 * (le curseur) pour lui ou un ancêtre l'emporte, la plus profonde d'abord ; elle ne vaut que sous le parent : un
 * `continue_from` récrit à la main ne place rien ailleurs.
 */
function destinationOf(run: Run, path: string): string | null {
  const top = topOf(run, path)
  if (top === null) return null
  const held = Object.keys(run.cursor.placed)
    .filter((source) => path === source || path.startsWith(`${source}/`))
    .sort((a, b) => b.length - a.length)
    .find((source) => run.cursor.placed[source].startsWith(`${run.args.parent}/`))
  if (held !== undefined) return `${run.cursor.placed[held]}${path.slice(held.length)}`
  return `${childPath(run.args.parent, lastSegment(top))}${path.slice(top.length)}`
}

/** Un lien de la source vers un chemin d'arrivée, `null` hors du périmètre (laissé tel quel, dit au rapport). */
function relinked(run: Run, sourcePath: string): string | null {
  const relative = run.plan.relink(sourcePath)
  if (relative === null) return null
  return destinationOf(run, relative) ?? run.args.parent
}

/**
 * Le chemin d'arrivée d'une valeur qui vaut exactement le chemin d'un nœud importé, avec au moins un « / » (un argument
 * d'appel, une cellule) ; `null` pour toute autre valeur : un mot seul (« open », « sav », « lyon ») n'est jamais un chemin
 * à recoller, même quand il nomme une racine ou qu'un dossier importé pourrait le contenir.
 */
function exactly(run: Run, value: string): string | null {
  if (!value.includes("/")) return null
  const relative = run.plan.relink(value)
  return relative !== null && run.paths.has(relative) ? (destinationOf(run, relative) ?? run.args.parent) : null
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

/** Le nœud placé au premier chemin libre à côté de `destination`, retenu pour ses enfants et pour un appel suivant. */
async function placeBeside(run: Run, node: PlanNode, destination: string): Promise<string> {
  const placed = await freePath(run.context.db, run.context.identity, { parent: parentPath(destination) ?? run.args.parent, segment: lastSegment(destination) })
  run.cursor.placed[node.path] = placed
  return placed
}

/** La création vide d'un nœud au chemin `target`. */
async function createEmpty(run: Run, node: PlanNode, target: string): Promise<void> {
  const body = node.kind === "table" ? { header: creationHeader(node) } : {}
  await writeNodeLazily(run.context.db, run.context.identity, { path: target, kind: node.kind, title: node.title, summary: node.summary, ...body }, run.origin)
  run.report.created.push(target)
}

/**
 * Passe 1 : le chemin réservé, le nœud créé vide s'il manque ; un chemin pris se juge selon `collision`. Un Contexte à
 * l'arrivée ne se remplace jamais : le nœud va au premier chemin libre à côté, comme quand le chemin est tenu par un
 * contenu qu'on ne voit pas, un ancien chemin ou un nom réservé. Sous un parent que l'import n'a pas pu créer, le nœud
 * est laissé, et le rapport le dit.
 */
async function reserve(run: Run, node: PlanNode): Promise<void> {
  const destination = destinationOf(run, node.path)
  if (destination === null) {
    run.report.notes.push(`${node.path}: its content goes directly under ${run.args.parent}; the root page itself is not created.`)
    return
  }
  const { db, identity } = run.context
  const above = parentPath(destination)
  if (above !== null && above !== run.args.parent && !(await findNode(db, identity, above))) {
    run.report.skipped.push({ path: destination, reason: "left out: its parent was not imported" })
    return
  }
  const existing = await findNode(db, identity, destination)
  const top = topOf(run, node.path)
  // Un nœud déjà placé par un appel précédent (`continue_from`) est à sa place : il ne se replace pas.
  const suffixed = existing !== null && run.args.collision === "suffix" && top === node.path && run.cursor.placed[node.path] === undefined
  if (existing && !suffixed && (existing.node.kind !== "context" || run.cursor.placed[node.path] !== undefined)) {
    if (kindOf(existing.node) !== node.kind) run.report.refused.push({ path: destination, reason: `already a ${existing.node.kind}, not a ${node.kind}: left as it is` })
    return
  }
  const target = existing ? await placeBeside(run, node, destination) : destination
  if (existing?.node.kind === "context") run.report.notes.push(`${destination} is a Contexte: ${node.path} was imported at ${target}.`)
  try {
    await createEmpty(run, node, target)
  } catch (error) {
    if (!isPlatformError(error) || error.code !== "conflict" || target !== destination) return void run.report.refused.push({ path: target, reason: refusalOf(error) })
    // Le chemin est tenu (un contenu qu'on ne voit pas, l'ancien chemin d'un contenu déplacé, un nom réservé) : à côté.
    const beside = await placeBeside(run, node, destination)
    run.report.notes.push(`${destination} is not available: ${node.path} was imported at ${beside}.`)
    await createEmpty(run, node, beside).catch((again: unknown) => run.report.refused.push({ path: beside, reason: refusalOf(again) }))
  }
}

/** Les morceaux du corps d'une page, ses liens recollés ; le titre ajouté puis retiré, pour qu'un `#` du corps reste. */
function chunksOf(run: Run, node: PlanNode, destination: string): string[] {
  if (node.markdown.trim() === "") return []
  const body = rewriteLinks(prefixed(run, node.markdown), (path) => relinked(run, path), (to) => run.report.orphans.push({ from: destination, to }), (path) => exactly(run, path))
  return readPageMarkdown(`# ${node.title}\n\n${body}`, `${lastSegment(destination)}.md`).chunks
}

/** Un texte de la source, les outils nommés avec son préfixe pris par celui de l'arrivée ; les mentions comptées. */
function prefixed(run: Run, text: string): string {
  if (run.prefixes === null) return text
  const done = rewritePrefixes(text, run.prefixes.from, run.prefixes.to)
  run.report.rewritten.prefixes += done.count
  return done.text
}

/** Une cellule de la source : un chemin importé (la cellule entière, ou un `[[…]]`) prend celui d'arrivée, ses outils aussi. */
function cellOf<T>(run: Run, value: T): T | string {
  if (typeof value !== "string") return value
  const cell = relinkedCell(prefixed(run, value), (path) => exactly(run, path), (path) => relinked(run, path))
  if (cell.changed) run.report.rewritten.paths++
  return cell.value
}

/** Une ligne du pivot dans la forme de `table.write` : chaque valeur recollée, avec sa preuve quand elle en a une. */
function rowWrite(run: Run, row: NonNullable<PlanNode["table"]>["rows"][number]) {
  const set = Object.fromEntries(
    Object.entries(row.set).map(([column, raw]) => {
      const value = cellOf(run, raw)
      return [column, row.proofs?.[column] ? { value, ...row.proofs[column] } : value]
    }),
  )
  return { key: row.key, set, ...(row.verified_empty ? { verified_empty: row.verified_empty } : {}) }
}

/** Les lignes d'un tableau du pivot, par lots de 50 : une ligne refusée est dite au rapport, les autres s'écrivent. */
async function writeTableRows(run: Run, destination: string, rows: NonNullable<PlanNode["table"]>["rows"]): Promise<void> {
  for (let from = 0; from < rows.length; from += ROWS_PER_WRITE) {
    const args = tableWriteArgsSchema.parse({ table: destination, rows: rows.slice(from, from + ROWS_PER_WRITE).map((row) => rowWrite(run, row)) })
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
    const shell = target.created ? "created empty, its text kept as a draft: " : "its text kept as a draft: "
    run.report.drafts.push({ path: destination, reason: `${shell}${refusalOf(error)}` })
  }
}

/**
 * Un nœud créé par cet import que son contenu n'a pu remplir : à la corbeille, pour ne pas laisser une coquille publiée
 * vide ; il quitte les créés, et le refus dit pourquoi. S'il ne peut partir, il reste, et le refus le dit aussi.
 */
async function removeShell(run: Run, destination: string, reason: string): Promise<void> {
  run.report.created = run.report.created.filter((path) => path !== destination)
  const trashed = await trashNode(run.context.db, run.context.identity, { path: destination }).then(
    () => true,
    () => false,
  )
  run.report.refused.push({ path: destination, reason: trashed ? `${reason} (the empty node created for it was put in the trash)` : `${reason} (an empty node stays at this path)` })
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
        const rows = node.csv.rows.map((cells) => cells.map((cell) => String(cellOf(run, cell))))
        await importRows(run.context, { path: destination, by: run.origin, comment: `Importé de ${run.source}`, headers: node.csv.headers, rows })
      }
    } else {
      await writeBody(run, node, destination, { node: found.node, created })
    }
    if (!created) run.report.updated.push(destination)
  } catch (error) {
    // Seule une page sans enfant importé part à la corbeille : son corps s'écrit d'un coup (un refus n'a rien écrit) ; un
    // tableau a pu garder des lignes, et des enfants y suivraient leur parent.
    const leaf = !run.plan.nodes.some((other) => other.path.startsWith(`${node.path}/`))
    if (created && node.kind === "page" && leaf) await removeShell(run, destination, refusalOf(error))
    else run.report.refused.push({ path: destination, reason: refusalOf(error) })
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
    run.report.refused.push({ path: `${destination} (header)`, reason: refusalOf(error) })
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

/** `nodes` : les nœuds de la source ; `total` et `done` : les étapes (trois passes), pour la reprise ; `roots` : où l'arbre est arrivé. */
export type ImportRun = { report: ImportReport; total: number; done: number; next: string | null; nodes: number; roots: string[]; elapsedMs: number }

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
    paths: new Set(plan.nodes.map((node) => node.path)),
    prefixes: plan.sourcePrefix && plan.sourcePrefix !== context.identity.org.prefix ? { from: plan.sourcePrefix, to: context.identity.org.prefix } : null,
    cursor: decodeCursor(args.continue_from),
    report: emptyReport(plan.notes),
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
  const next = step < all.length ? encodeCursor({ step, placed: run.cursor.placed }) : null
  const roots = plan.nodes.filter((node) => topOf(run, node.path) === node.path).map((node) => destinationOf(run, node.path) ?? run.args.parent)
  return { report: run.report, total: all.length, done: step, next, nodes: plan.nodes.length, roots: [...new Set(roots)], elapsedMs: now() - started }
}
