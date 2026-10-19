// `table.rows` (E07-S01, AC6, AC7, AC11 à AC16 ; H93, H96, N6, N11, N16) : les blocs `row` publiés du
// tableau, lus après la décision de `loadTable` ; forme de lecture d'une ligne (`toReadRow`, reprise
// par `table.write` d'E07-S02) ; filtre, `q` et tri calculés dans le service sur 5 000 lignes au plus,
// lues par pages de `READ_PAGE_ROWS` ; au-delà, pages lues par la base dans l'ordre de la clé ; page
// coupée avant 16 000 caractères de lignes sérialisées. Sans lui, un tableau ne se lit pas. Face SQL
// (E01-S10, lot c1) : chaque lecture passe par `db.tx`, toute valeur liée ; le bail se lit en texte
// (`to_json`), la forme que rendait PostgREST.
//
// Repris de la maquette (`mcp-test/src/proto/functions/table.ts` l. 98-129) : forme de la fonction,
// comptage, « Unknown column(s): … Columns: … », projection. Retiré : la table `rows` à part (→ blocs
// `row`, ADR-011), la comparaison `values->>col` en texte, le curseur `gt key` seul, les valeurs brutes
// servies (dont `null`).
import {
  queryWords,
  tableRowsArgsSchema,
  type CellValue,
  type TableHeader,
  type TableRowRead,
  type TableRowsArgs,
} from "../../schemas"
import { FILTERED_ROWS_MAX, FORMER_MEMBER, isRecord } from "../../schemas/tables"
import { defineFunction, type FunctionContext, type FunctionOutput } from "../catalog/define"
import type { PlatformDb } from "../db"
import { boundedList, inTransaction, PlatformError, READ_PAGE_ROWS } from "../errors"
import { formatCount } from "../nodes/document"
import { memberNames } from "../nodes/view"
import type { Tx } from "../sql"
import { serializedLength } from "../tool-output"
import { checkRowsArgs } from "./check"
import { matchesRow, parseFilter, queryHits, unknownColumns, unknownColumnsMessage, type FilterClause } from "./filters"
import { keyValue, loadTable, rowCells, utcText, type LoadedTable, type RowBlock } from "./meta"
import { tableOutput } from "./output"
import { openCursor, queryPrint, sortRows, tableCursor, type TableCursor } from "./paging"

// La borne des lignes filtrées (N6) et le nom d'une personne partie (N9) vivent dans `schemas/tables.ts`,
// que l'écran d'un tableau lit aussi (E07-S03) ; les autres services des tableaux les lisent toujours ici.
export { FILTERED_ROWS_MAX, FORMER_MEMBER }

const DEFAULT_LIMIT = 20

/** Lignes sérialisées au plus d'une page (N11) : le formateur d'E03-S01 n'a jamais à couper ni à omettre. */
const PAGE_ROWS_CHARS = 16_000

/** Texte sérialisé au plus des lignes d'une page : des guillemets dans les valeurs y doublent leur taille. */
const PAGE_TEXT_CHARS = 22_000

// ------------------------------------------------------------------------------------ Lecture en base

type RowRead = Omit<RowBlock, "key"> & { key: string | null }

function rowBlock(row: RowRead): RowBlock {
  // `blocks_guard` exige la clé d'un `row` : `key` nul n'arrive pas d'un bloc `row` (E01-S06 N8).
  return { ...row, key: row.key ?? "" }
}

/**
 * Une page des blocs `row` publiés du tableau, `limit` lignes au plus après la clé `after`, dans
 * l'ordre de la collation de la base sur `key`. `key is not null`, toujours vrai d'un `row`
 * (`blocks_guard`), laisse la base lire la page par l'index partiel `uq_blocks_node_id_state_key` dans
 * l'ordre de la clé, sans trier tout le tableau.
 */
function rowsPage(sql: Tx, nodeId: string, after: string | null, limit: number) {
  return sql<RowRead[]>`
    select key, data, provenance, revision, claimed_by, claimed_by_user, to_json(lease_until) as lease_until
      from platform.blocks
     where node_id = ${nodeId} and state = ${"published"} and type = ${"row"} and key is not null
       and (${after}::text is null or key > ${after})
     order by key
     limit ${limit}`
}

/** Nombre de blocs `row` publiés du tableau, compté par la base, sans ligne rendue. */
export async function countRows(db: PlatformDb, nodeId: string): Promise<number> {
  const [counted] = await inTransaction(
    db,
    "blocks: count rows",
    (sql) => sql<{ count: number }[]>`select count(*)::int as count from platform.blocks where node_id = ${nodeId} and state = ${"published"} and type = ${"row"}`,
  )
  return counted?.count ?? 0
}

/**
 * Les lignes du tableau, `max + 1` au plus, par pages de `READ_PAGE_ROWS` ordonnées par clé, chaque
 * page après la dernière clé lue (N6), dans une transaction ; au-delà de `max`, l'appelant refuse
 * (`tooManyRows`).
 */
export async function loadRows(db: PlatformDb, nodeId: string, max: number): Promise<RowBlock[]> {
  return inTransaction(db, "blocks: rows", async (sql) => {
    const rows: RowBlock[] = []
    let after: string | null = null
    for (;;) {
      const wanted = Math.min(READ_PAGE_ROWS, max + 1 - rows.length)
      const page = await rowsPage(sql, nodeId, after, wanted)
      rows.push(...page.map(rowBlock))
      if (page.length < wanted || rows.length > max) return rows
      after = rows[rows.length - 1].key
    }
  })
}

/** Une page lue par la base dans l'ordre de sa collation sur `key` (au-delà de 5 000 lignes, AC16). */
async function databasePage(db: PlatformDb, nodeId: string, after: string | null, limit: number): Promise<RowBlock[]> {
  const page = await inTransaction(db, "blocks: rows page", (sql) => rowsPage(sql, nodeId, after, limit + 1))
  return page.map(rowBlock)
}

/** Refus d'un filtre, de `q`, d'un tri ou d'un agrégat sur plus de 5 000 lignes (AC16). */
export function tooManyRows(path: string, rows: number): PlatformError {
  return new PlatformError(
    "too_large",
    `Table ${path} has ${formatCount(rows)} rows: filters, q, sort and aggregates work on tables of ${formatCount(FILTERED_ROWS_MAX)} rows at most in this version. Read it page by page without them.`,
  )
}

// ------------------------------------------------------------------------------ Forme de lecture (H93)

type ServedProvenance = NonNullable<TableRowRead["provenance"]>[string]

function importedOf(raw: unknown): ServedProvenance["imported"] | null {
  if (!isRecord(raw)) return null
  const { value, at } = raw
  const scalar = typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))
  return scalar ? { value, ...(typeof at === "string" ? { at: utcText(at) } : {}) } : null
}

/**
 * La provenance servie d'une cellule (AC13, H94) : ses seuls champs bien formés, `by` en nom du
 * membre (`names` : `memberNames`), dates en UTC `…Z`.
 */
function servedProvenance(raw: Record<string, unknown>, names: ReadonlyMap<string, string>): ServedProvenance | null {
  // Le code `ctx` rangé n'est jamais servi (E11-S01, AC-d4) : c'est le code de conversation d'une autre personne.
  const { origin, by, at, comment, link, host, worker } = raw
  if (origin !== "agent" && origin !== "human" && origin !== "import" && origin !== "verified_empty") return null
  const imported = importedOf(raw.imported)
  return {
    origin,
    ...(typeof by === "string" ? { by: names.get(by) ?? FORMER_MEMBER } : {}),
    ...(typeof at === "string" ? { at: utcText(at) } : {}),
    ...(typeof comment === "string" ? { comment } : {}),
    ...(typeof link === "string" ? { link } : {}),
    ...(typeof host === "string" ? { host } : {}),
    ...(typeof worker === "string" ? { worker } : {}),
    ...(imported ? { imported } : {}),
  }
}

export function leaseEnd(block: RowBlock): number | null {
  if (!block.claimed_by || !block.lease_until) return null
  const until = Date.parse(block.lease_until)
  return Number.isNaN(until) ? null : until
}

/** Un bail posé dont l'échéance est passée (H98) : la ligne est libre, et sa ligne de texte le dit (AC14). */
export function leaseExpired(block: RowBlock, now: number): boolean {
  const until = leaseEnd(block)
  return until !== null && until <= now
}

function activeClaim(block: RowBlock, names: ReadonlyMap<string, string>, now: number): TableRowRead["claim"] | null {
  const until = leaseEnd(block)
  if (until === null || until <= now || !block.claimed_by) return null
  const by = block.claimed_by_user ? (names.get(block.claimed_by_user) ?? FORMER_MEMBER) : FORMER_MEMBER
  return { worker: block.claimed_by, by, until: new Date(until).toISOString() }
}

type ReadOptions = { columns?: readonly string[] | null; provenance?: boolean; now?: number }

/**
 * La forme de lecture d'un bloc `row` (AC7, AC11, AC13, AC14 ; H93) : `{ key, revision, set,
 * verified_empty?, provenance?, claim? }`, les seules colonnes déclarées qui ont une valeur, jamais
 * `null` ; `columns` limite `set`, `verified_empty` et `provenance` ; `provenance` n'est servie que
 * demandée ; un bail expiré n'est pas servi. `names` : les noms des membres (`memberNames`).
 */
export function toReadRow(block: RowBlock, header: TableHeader, names: ReadonlyMap<string, string>, options: ReadOptions = {}): TableRowRead {
  const cells = rowCells(block, header)
  const stored = isRecord(block.provenance) ? block.provenance : {}
  const set: Record<string, CellValue> = {}
  const verifiedEmpty: { column: string; reason: string }[] = []
  const provenance: Record<string, ServedProvenance> = {}
  for (const column of header.columns) {
    if (options.columns && !options.columns.includes(column.name)) continue
    const value = cells.get(column.name)
    const cell = stored[column.name]
    const written = isRecord(cell) ? cell : null
    if (value !== undefined) set[column.name] = value
    else if (written?.origin === "verified_empty") verifiedEmpty.push({ column: column.name, reason: typeof written.reason === "string" ? written.reason : "" })
    else continue
    const served = options.provenance && written ? servedProvenance(written, names) : null
    if (served) provenance[column.name] = served
  }
  const claim = activeClaim(block, names, options.now ?? Date.now())
  return {
    key: keyValue(block.key, header),
    revision: block.revision,
    set,
    ...(verifiedEmpty.length > 0 ? { verified_empty: verifiedEmpty } : {}),
    ...(options.provenance ? { provenance } : {}),
    ...(claim ? { claim } : {}),
  }
}

// ------------------------------------------------------------------------------------ Page (AC6, AC15)

type Query = {
  clauses: FilterClause[]
  /** Les mots de `q` (E11-S01, AC-c1) ; `null` sans `q`. */
  q: string[] | null
  /** `all` : chaque mot de `q` ; `any` : au moins un, classé (E11-S19, AC-f1). */
  match: "all" | "any"
  sort: TableRowsArgs["sort"]
  columns: string[] | null
  limit: number
  provenance: boolean
  narrowed: boolean
}

/** Les arguments contrôlés contre l'en-tête : colonnes inconnues d'abord (filtre, tri, projection), puis le filtre. */
function parseQuery(header: TableHeader, args: TableRowsArgs, masked?: (text: string) => string): Query {
  const named = [...Object.keys(args.filter ?? {}), ...(args.sort ? [args.sort.column] : []), ...(args.columns ?? [])]
  const unknown = unknownColumns(header, named)
  if (unknown.length > 0) throw new PlatformError("invalid_arguments", unknownColumnsMessage(header, unknown))
  const filter = parseFilter(args.filter, header, masked)
  if ("problems" in filter) throw new PlatformError("invalid_arguments", boundedList(filter.problems, " "))
  const q = args.q === undefined ? null : queryWords(args.q)
  const narrowed = filter.clauses.length > 0 || q !== null || args.sort !== undefined
  const { sort, columns, limit, provenance } = args
  return { clauses: filter.clauses, q, match: args.match ?? "all", sort, columns: columns ?? null, limit: limit ?? DEFAULT_LIMIT, provenance: provenance === true, narrowed }
}

/** Les lignes d'une page avant la coupe : `more` dit s'il en reste après elles. */
type Selection = { blocks: RowBlock[]; total: number; more: boolean }

async function scannedSelection(context: FunctionContext, table: LoadedTable, query: Query, cursor: TableCursor): Promise<Selection> {
  const rows = await loadRows(context.db, table.node.id, FILTERED_ROWS_MAX)
  if (rows.length > FILTERED_ROWS_MAX && query.narrowed) throw tooManyRows(table.node.path, rows.length)
  const words = query.q
  const hits = new Map<RowBlock, number>()
  const entries = rows
    .map((block) => ({ block, cells: rowCells(block, table.header) }))
    .filter((entry) => {
      if (!matchesRow(entry.cells, query.clauses)) return false
      if (words === null) return true
      const found = queryHits(entry.cells, table.header, words)
      hits.set(entry.block, found)
      return query.match === "any" ? found > 0 : found === words.length
    })
  const sorted = sortRows(entries, table.header, query.sort)
  // E11-S19 (AC-f1, HN-E11S19-11) : en OU, le nombre de mots trouvés d'abord ; le tri, stable, départage par `sort`.
  const ordered = query.match === "any" ? [...sorted].sort((a, b) => (hits.get(b.block) ?? 0) - (hits.get(a.block) ?? 0)) : sorted
  const page = ordered.slice(cursor.offset, cursor.offset + query.limit)
  return { blocks: page.map((entry) => entry.block), total: ordered.length, more: cursor.offset + page.length < ordered.length }
}

/** Combien de lignes tiennent (N11) ; une première ligne trop grande à elle seule → `too_large` (AC15). */
function fittingRows(rows: readonly TableRowRead[], lines: readonly string[], keys: readonly string[]): number {
  let json = 2
  let text = 0
  for (let index = 0; index < rows.length; index++) {
    const rowChars = JSON.stringify(rows[index]).length + (index > 0 ? 1 : 0)
    const lineChars = serializedLength(lines[index]) + 2
    if (json + rowChars > PAGE_ROWS_CHARS || text + lineChars > PAGE_TEXT_CHARS) {
      if (index > 0) return index
      throw new PlatformError("too_large", `Row ${keys[0]} is larger than ${formatCount(PAGE_ROWS_CHARS)} characters: read it with columns to project fewer columns.`)
    }
    json += rowChars
    text += lineChars
  }
  return rows.length
}

function firstLine(path: string, page: { total: number; offset: number; served: number; fast: boolean }): string {
  const { total, offset, served, fast } = page
  const range = served === 0 ? `no row after row ${formatCount(offset)}` : `rows ${formatCount(offset + 1)}-${formatCount(offset + served)}`
  if (fast) return `${path}: ${formatCount(total)} row(s); ${range} in database key order (more than ${formatCount(FILTERED_ROWS_MAX)} rows).`
  return total === 0 ? `${path}: 0 row match.` : `${path}: ${formatCount(total)} row(s) match; ${range}.`
}

type PageRequest = { context: FunctionContext; table: LoadedTable; query: Query; cursor: TableCursor; print: string }

/** La page servie : lignes sous la coupe, texte (une ligne JSON par ligne) et données en champs (AC6). */
async function servedPage(request: PageRequest, selection: Selection & { fast: boolean }): Promise<FunctionOutput> {
  const { context, table, query, cursor } = request
  const now = Date.now()
  const claimed = selection.blocks.some((block) => (leaseEnd(block) ?? 0) > now)
  const names = query.provenance || claimed ? await memberNames(context.db, context.identity.org.id) : new Map<string, string>()
  const rows = selection.blocks.map((block) => toReadRow(block, table.header, names, { columns: query.columns, provenance: query.provenance, now }))
  const lines = rows.map((row, index) => `${JSON.stringify(row)}${leaseExpired(selection.blocks[index], now) ? " (lease expired)" : ""}`)
  const served = fittingRows(rows, lines, selection.blocks.map((block) => block.key))
  const cut = served < rows.length
  const last = selection.blocks[served - 1]
  const next = (cut || selection.more) && last ? tableCursor(request.print, { offset: cursor.offset + served, after: last.key }) : null
  const path = table.node.path
  const text = [
    firstLine(path, { total: selection.total, offset: cursor.offset, served, fast: selection.fast }),
    ...lines.slice(0, served),
    ...(cut ? [`Page cut at ${served} rows to keep the result readable; continue with the cursor below.`] : []),
    ...(next ? [`next_cursor: ${next}`] : []),
  ].join("\n")
  const data = { table: path, total: selection.total, offset: cursor.offset, rows: rows.slice(0, served), ...(next ? { next_cursor: next } : {}) }
  // Une ligne seule se lit comme une fiche, plusieurs ou aucune comme un tableau (widget, story widgets-dans-la-conversation).
  return { text, data, view: served === 1 ? "record" : "table" }
}

async function readRows(context: FunctionContext, args: TableRowsArgs): Promise<FunctionOutput> {
  const table = await loadTable(context, args.table)
  const query = parseQuery(table.header, args, context.pseudonymized)
  const print = queryPrint(table.node.id, args)
  const cursor = openCursor(args.cursor, print)
  const count = await countRows(context.db, table.node.id)
  const request = { context, table, query, cursor, print }
  if (count <= FILTERED_ROWS_MAX) return tableOutput(context, table, await servedPage(request, { ...(await scannedSelection(context, table, query, cursor)), fast: false }))
  if (query.narrowed) throw tooManyRows(table.node.path, count)
  // Au-delà de 5 000 lignes, sans filtre, `q` ni tri : la base lit la page, sans borne (AC16).
  const page = await databasePage(context.db, table.node.id, cursor.after, query.limit)
  return tableOutput(context, table, await servedPage(request, { blocks: page.slice(0, query.limit), total: count, more: page.length > query.limit, fast: true }))
}

export const tableRows = defineFunction({
  name: "table.rows",
  connector: "table",
  class: "read",
  origin: "paquet",
  description:
    "Reads the rows of a table, 20 per page (50 at most), filtered by column values or by words, sorted by a column, with the columns you choose and a cursor for the next page. Use it to answer a question about the rows or to list them; to count or sum rows, use table.aggregate.",
  schema: tableRowsArgsSchema,
  examples: [
    { table: "ventes/suivi_prospects", filter: { ville: "Valbrune" } },
    { table: "ventes/suivi_prospects", sort: { column: "montant_estime", direction: "desc" }, limit: 3, columns: ["entreprise", "montant_estime"] },
  ],
  refusals: [
    "Unknown table: not a table you can read; the refusal lists the tables you can read.",
    "Unknown column(s) in filter, sort or columns; the refusal lists the columns.",
    "Unknown operator, or an operator the column type does not take (gt on a text column).",
    'A value of the wrong type, e.g. "12000" for a number column or "true" for a bool column.',
    'null in a filter (use {"column": {"empty": true}}), in with no value, more than 30 clauses.',
    "A cursor from another query (filter, q, match or sort changed), or unreadable.",
    "More than 5,000 rows with filter, q or sort; a single row larger than 16,000 characters.",
  ],
  next: ["table.aggregate"],
  checkArgs: checkRowsArgs,
  run: readRows,
})
