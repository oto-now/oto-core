// Tableaux (E07-S01, H90 à H97 ; ADR-011 § 1, § 2) : en-tête typé d'un tableau (`nodes.meta`), une
// seule grammaire de filtre (H95), arguments des trois fonctions de lecture et forme de lecture d'une
// ligne (H93). Les schémas des arguments d'une fonction vivent dans la face `schemas`
// (`forms-patterns.md § Principe`) : sans ce fichier, `table.schema`, `table.rows` et
// `table.aggregate` n'ont pas de schéma strict (AC19), et `parseTableHeader` pas de forme d'en-tête
// (AC1, AC2). `zod/v4` : contrats servis par `z.toJSONSchema` (H21). Les contrôles croisés de
// l'en-tête (clé, cycle, options par type) sont dans `server/tables/header.ts` ; ceux d'un filtre,
// qui dépendent des colonnes, dans `server/tables/filters.ts`.
import * as z from "zod/v4"
import { nodePathSchema, normalizeTitle } from "./nodes"

/** Les huit types de colonne de la V1 (H90), dans l'ordre des refus. */
export const COLUMN_TYPES = ["text", "number", "date", "datetime", "bool", "enum", "email", "url"] as const

export type ColumnType = (typeof COLUMN_TYPES)[number]

/**
 * Les types d'une colonne clé (H90 ; dates admises, FB-0014) : relus par l'en-tête (`parseTableHeader`), la clé proposée
 * d'un import (`inferTable`) et le choix de la clé à l'écran d'import, qui ne tiennent qu'une liste.
 */
export const KEY_COLUMN_TYPES: readonly ColumnType[] = ["text", "email", "url", "number", "date"]

const columnTypeSchema = z.enum(COLUMN_TYPES, {
  error: (issue) => (issue.input === undefined ? "required" : `unknown type ${String(issue.input)}. Types: ${COLUMN_TYPES.join(", ")}.`),
})

/** Nom d'une colonne : minuscules, chiffres et `_`, une lettre d'abord, 60 caractères au plus. */
export const COLUMN_NAME_PATTERN = /^[a-z][a-z0-9_]{0,59}$/

export const columnNameSchema = z
  .string()
  .regex(COLUMN_NAME_PATTERN, { error: "lowercase letters, digits and _, starting with a letter, 60 characters at most, e.g. montant_estime" })

/** Caractères au plus d'un libellé de colonne, comme une option d'`enum` (`header.ts`). */
const COLUMN_LABEL_MAX = 100

/** Libellé d'une colonne (#225) : ce que l'écran affiche, accents et sigles compris ; sans lui, le nom. */
const columnLabelSchema = z
  .string()
  .trim()
  .min(1, { error: `a label holds 1 to ${COLUMN_LABEL_MAX} characters` })
  .max(COLUMN_LABEL_MAX, { error: `a label holds 1 to ${COLUMN_LABEL_MAX} characters` })

export const tableColumnSchema = z.strictObject({
  name: columnNameSchema.describe("Column name, e.g. montant_estime."),
  label: columnLabelSchema.optional().describe(`What screens show for this column, 1 to ${COLUMN_LABEL_MAX} characters, e.g. Montant estimé (default: the name).`),
  type: columnTypeSchema.describe("text, number, date, datetime, bool, enum, email or url."),
  options: z.array(z.string()).optional().describe('enum only: the values, 1 to 100, e.g. ["à traiter", "en cours"].'),
  required: z.boolean().optional().describe("true: a row cannot lack this column: a value, or verified_empty with a reason (default false)."),
  allow_verified_empty: z.boolean().optional().describe("false: verified_empty is refused for this column; a row needs a real value there (default true)."),
  max_length: z.number().int().min(1).max(10_000).optional().describe("text, email and url only: characters at most (default 2,000 for text)."),
})

export type TableColumn = z.infer<typeof tableColumnSchema>

export const tableReviewSchema = z.strictObject({
  state: z.string().describe("State where rows wait for a person, e.g. à revoir."),
  approve: z.string().describe("State an approved row takes, e.g. qualifié."),
  reject: z.string().describe("State a rejected row takes, e.g. écarté."),
  agents_may_decide: z
    .boolean()
    .optional()
    .describe("true: an assistant may also set approve or reject, with table.write or table.release; its decision is traced with origin agent (default false)."),
})

export const tableLifecycleSchema = z.strictObject({
  column: columnNameSchema.describe("The enum column that holds the state, e.g. statut."),
  states: z.array(z.string()).describe("The options of that column, in the same order; rows enter at the first."),
  working: z.string().describe("State of a row a worker holds with a lease, e.g. en cours."),
  review: tableReviewSchema.optional().describe("Human review of the rows (default: none)."),
})

export type TableLifecycle = z.infer<typeof tableLifecycleSchema>

/** En-tête d'un tableau (H91) : les contrôles croisés d'AC1 sont dans `parseTableHeader`. */
export const tableHeaderSchema = z.strictObject({
  columns: z.array(tableColumnSchema).min(1).max(100).describe("The columns, 1 to 100, in display order."),
  key: columnNameSchema.describe("Name of the column whose value addresses each row, e.g. entreprise."),
  lifecycle: tableLifecycleSchema.optional().describe("Work queue of the rows (default: none)."),
  closed: z.boolean().default(false).describe("true: only existing rows can be written (default false)."),
  proof: z.boolean().default(false).describe("true: every new value written by table.write needs its proof, {value, comment | link} (default false)."),
})

export type TableHeader = z.output<typeof tableHeaderSchema>

// ------------------------------------------------------------------------------------- Filtres

/** Les opérateurs de la grammaire (H95), dans l'ordre des refus. */
export const FILTER_OPERATORS = ["eq", "ne", "contains", "in", "gt", "gte", "lt", "lte", "empty", "not_empty"] as const

export type FilterOperator = (typeof FILTER_OPERATORS)[number]

/** Clauses au plus dans un filtre (H95). */
export const MAX_FILTER_CLAUSES = 30

/** Valeurs au plus d'un `in` (N3). */
export const MAX_IN_VALUES = 100

/**
 * Lignes au plus sur lesquelles se calculent un filtre, `q`, un tri ou un agrégat (N6) : le service les
 * compte, l'écran d'un tableau dit la borne (E07-S03).
 */
export const FILTERED_ROWS_MAX = 5_000

/** Refus d'un `null` dans un filtre (AC8) : la cellule sans valeur se cherche par `empty`. */
export function nullInFilterMessage(column: string): string {
  return `null is refused in filters: use {"${column}": {"empty": true}} for a cell without value.`
}

/** Noms cités au plus dans un refus : 20, comme `boundedList` de `server/errors.ts`, que `schemas/` n'importe pas. */
const NAMES_LISTED = 20

/** « a, b, … and 3 more » : les 20 premiers noms, puis leur nombre restant (`mcp-patterns.md § 4`). */
function namesText(names: readonly string[]): string {
  const more = names.length - NAMES_LISTED
  return [...names.slice(0, NAMES_LISTED), ...(more > 0 ? [`… and ${more} more`] : [])].join(", ")
}

/** Refus des opérateurs inconnus d'une colonne (AC8) : un seul message, 20 noms au plus. */
export function unknownOperatorMessage(operators: readonly string[], column: string): string {
  return `Unknown operator${operators.length > 1 ? "s" : ""} ${namesText(operators)} on ${column}. Operators: ${FILTER_OPERATORS.join(", ")}.`
}

/** Refus d'un `in` de plus de 100 valeurs (N3), même texte au schéma et au service. */
export function tooManyInValuesMessage(count: number, column: string): string {
  return `in takes ${MAX_IN_VALUES} values at most (${count.toLocaleString("en-US")} given): ${column}.`
}

/** Un objet JSON (ni `null` ni tableau) : un en-tête, un filtre, `data` ou `provenance` d'un bloc `row`. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * Une date `YYYY-MM-DD` qui existe (`2026-02-30` refusée), années 0 à 99 comprises : une seule règle
 * pour les valeurs et les filtres du service (E07-S01) et pour l'adresse de l'écran (E07-S03).
 */
export function isValidDate(value: string): boolean {
  const match = DATE.exec(value)
  if (!match) return false
  const [year, month, day] = match.slice(1).map(Number)
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

const DATETIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-](\d{2}):(\d{2}))$/

/**
 * L'instant (ms) d'une date et heure ISO 8601 avec fuseau (`Z` ou décalage) ; `null` sinon. Une seule règle
 * pour les valeurs du service (E07-S01) et la lecture d'un CSV (E10-S01, `schemas/csv.ts`).
 */
export function instantOf(value: string): number | null {
  const match = DATETIME.exec(value)
  if (!match || !isValidDate(match[1])) return null
  const [hour, minute, second, offsetHour, offsetMinute] = match.slice(2).map((part) => Number(part ?? 0))
  if (hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59) return null
  const instant = Date.parse(value)
  return Number.isNaN(instant) ? null : instant
}

/** Texte sans `max_length` (N2) ; adresse email (AC3) ; URL (AC3). */
export const COLUMN_TEXT_MAX = 2_000
const EMAIL_MAX = 254
const URL_MAX = 2_000

/** Longueur maximale d'une colonne de texte, d'email ou d'URL ; `null` pour les autres types. */
export function maxLengthOf(column: Pick<TableColumn, "type" | "max_length">): number | null {
  if (column.type === "text") return column.max_length ?? COLUMN_TEXT_MAX
  if (column.type === "email") return Math.min(column.max_length ?? EMAIL_MAX, EMAIL_MAX)
  if (column.type === "url") return Math.min(column.max_length ?? URL_MAX, URL_MAX)
  return null
}

/** Une clé de ligne : 200 caractères au plus (N19), sous la borne de `blocks.key` (500) ; lue aussi par l'import d'un CSV. */
export const ROW_KEY_MAX = 200

/** Une adresse email (AC3) : un seul `@`, une partie de chaque côté, sans blanc (`security-patterns.md § Validation des inputs`). */
export function isEmail(value: string): boolean {
  return /^[^@\s]+@[^@\s]+$/.test(value)
}

/**
 * Le refus d'une valeur de filtre que le schéma rejette, au texte du service (AC8) : `null`, des
 * opérateurs inconnus, un `in` de plus de 100 valeurs ; sinon le message de Zod. `path` finit par la
 * colonne.
 */
function filterValueError(path: readonly PropertyKey[] | undefined, input: unknown): string | undefined {
  const column = String(path?.at(-1) ?? "?")
  if (input === null) return nullInFilterMessage(column)
  if (!isRecord(input)) return undefined
  const known: readonly string[] = FILTER_OPERATORS
  const unknown = Object.keys(input).filter((operator) => !known.includes(operator))
  if (unknown.length > 0) return unknownOperatorMessage(unknown, column)
  const values = Object.values(input).flatMap((value) => (Array.isArray(value) ? value : [value]))
  if (values.includes(null)) return nullInFilterMessage(column)
  return Array.isArray(input.in) && input.in.length > MAX_IN_VALUES ? tooManyInValuesMessage(input.in.length, column) : undefined
}

const filterScalarSchema = z.union([z.string(), z.number(), z.boolean()])

const filterOperatorsSchema = z.strictObject({
  eq: filterScalarSchema.optional().describe("Equal to (text: without case or accents)."),
  ne: filterScalarSchema.optional().describe("Different from, cells without value included."),
  contains: z.string().optional().describe("text, email, url, enum: contains these characters, without case or accents."),
  in: z.array(filterScalarSchema).max(MAX_IN_VALUES).optional().describe("One of these values, 1 to 100."),
  gt: filterScalarSchema.optional().describe("number, date, datetime: greater than."),
  gte: filterScalarSchema.optional().describe("number, date, datetime: greater than or equal to."),
  lt: filterScalarSchema.optional().describe("number, date, datetime: less than."),
  lte: filterScalarSchema.optional().describe("number, date, datetime: less than or equal to."),
  empty: z.boolean().optional().describe("true: the cell has no value."),
  not_empty: z.boolean().optional().describe("true: the cell has a value."),
})

/**
 * Une seule grammaire (H95) : `{colonne: valeur}` (égalité) ou `{colonne: {opérateur: valeur}}` ;
 * plusieurs colonnes ou opérateurs = ET. `null` exclu du type : refusé avec la consigne d'`empty`.
 */
export const tableFilterSchema = z.record(
  columnNameSchema,
  z.union([filterScalarSchema, filterOperatorsSchema], { error: (issue) => filterValueError(issue.path, issue.input) }),
)

const tableSortSchema = z.strictObject({
  column: columnNameSchema.describe("Column to sort by, e.g. montant_estime."),
  direction: z.enum(["asc", "desc"]).optional().describe("asc or desc (default asc)."),
})

export type TableSort = z.infer<typeof tableSortSchema>

// ------------------------------------------------------------------------ Arguments des fonctions

export const tablePathArgSchema = nodePathSchema.describe("Table path, e.g. ventes/suivi_prospects")

const FILTER_HELP =
  'a value (equals; text without case or accents), e.g. {"ville": "Valbrune"}, or operators, e.g. {"montant_estime": {"gte": 10000}}; several columns or operators all apply; operators: eq, ne, contains, in, gt, gte, lt, lte, empty, not_empty; null is refused'

export const tableSchemaArgsSchema = z.strictObject({ table: tablePathArgSchema })

/** Un séparateur de mots de `q` : tout ce qui n'est ni lettre ni chiffre (E11-S01, AC-c1). */
const NOT_A_WORD = /[^\p{L}\p{N}]+/u

/**
 * Les mots de `q` (E11-S01, AC-c1, AC-c3) : sans casse ni accent (`normalizeTitle`), découpés sur tout ce
 * qui n'est ni lettre ni chiffre, un mot répété compté une fois ; en une passe (`security-patterns.md §
 * Validation des inputs`). Une seule règle pour le refus du schéma (AC-c2), `table.rows`, la grille et les
 * vues de tableau : sans elle, « mairie valbrune » ne trouvait rien.
 */
export function queryWords(q: string): string[] {
  return [...new Set(normalizeTitle(q).split(NOT_A_WORD).filter((word) => word !== ""))]
}

/** Lignes au plus d'une page de `table.rows` (N6). */
const MAX_PAGE_ROWS = 50

export const tableRowsArgsSchema = z.strictObject({
  table: tablePathArgSchema,
  filter: tableFilterSchema.optional().describe(`Rows to keep, by column: ${FILTER_HELP} (default: all rows).`),
  q: z
    .string()
    .trim()
    .min(2)
    .max(200)
    .refine((q) => queryWords(q).length > 0, { error: "write at least one word (letters or digits)" })
    .optional()
    .describe('Words to find, without case or accents, in any order: each word must appear (unless match is any) in a text, email, url or enum column or in the key, e.g. "mairie valbrune" (default: none).'),
  // E11-S19 (AC-f1, AC-f2) : le OU classé, ajouté facultatif ; le défaut reste le ET d'E11-S01.
  match: z
    .enum(["all", "any"])
    .optional()
    .describe("With q: all keeps the rows with every word; any keeps the rows with at least one, those with the most words first, then by sort (default all)."),
  sort: tableSortSchema.optional().describe('Order: {"column": "montant_estime", "direction": "desc"}; cells without value come last (default: the key, ascending).'),
  columns: z
    .array(columnNameSchema)
    .min(1)
    .max(100)
    .optional()
    .describe('Columns to return, e.g. ["contact", "email"]; key and revision always come (default: all columns).'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_ROWS, { error: `${MAX_PAGE_ROWS} rows at most per page; use next_cursor for more` })
    .optional()
    .describe("Rows per page, 50 at most (default 20)."),
  cursor: z
    .string()
    .min(1)
    .max(4000)
    .optional()
    .describe("next_cursor of the previous page, unchanged, with the same filter, q and sort (default: the first page)."),
  provenance: z.boolean().optional().describe("true: each cell comes with who wrote it and when (default false)."),
})

export type TableRowsArgs = z.infer<typeof tableRowsArgsSchema>

const AGGREGATE_OPS = ["count", "sum", "avg", "min", "max"] as const

export type AggregateOp = (typeof AGGREGATE_OPS)[number]

export const tableAggregateArgsSchema = z.strictObject({
  table: tablePathArgSchema,
  where: tableFilterSchema.optional().describe(`Rows to count, same grammar as the filter of table.rows: ${FILTER_HELP} (default: all rows).`),
  group_by: columnNameSchema.optional().describe("Column whose values make the groups, e.g. statut (default: one line of totals)."),
  metrics: z
    .array(
      z.strictObject({
        op: z.enum(AGGREGATE_OPS).describe("count, sum, avg, min or max."),
        column: columnNameSchema.optional().describe("Column it applies to; required by sum, avg, min and max, which take a number column."),
      }),
    )
    .min(1)
    .max(10)
    .optional()
    .describe('What to compute per group, e.g. [{"op": "count"}, {"op": "sum", "column": "montant_estime"}] (default [{"op": "count"}]).'),
})

export type TableAggregateArgs = z.infer<typeof tableAggregateArgsSchema>

// ------------------------------------------------------------------------------- Ligne lue (H93)

/** Valeur d'une cellule servie : jamais `null` (H93). */
const cellValueSchema = z.union([z.string(), z.number(), z.boolean()])

export type CellValue = z.infer<typeof cellValueSchema>

/** Le nom servi pour une personne qui n'est plus membre (N9), dans la provenance et le bail ; l'écran le traduit (E07-S03). */
export const FORMER_MEMBER = "former member"

const provenanceReadSchema = z.strictObject({
  origin: z.enum(["agent", "human", "import", "verified_empty"]),
  by: z.string().optional(),
  at: z.string().optional(),
  comment: z.string().optional(),
  link: z.string().optional(),
  /** Le client MCP de la conversation (`ctx.host`, `nom@version`) et le libellé du travailleur sous bail (E11-S01, AC-d4). */
  host: z.string().optional(),
  worker: z.string().optional(),
  imported: z.strictObject({ value: cellValueSchema, at: z.string().optional() }).optional(),
})

/** Une ligne lue a la forme de l'écriture (H93) : aucune valeur `null` possible. */
export const tableRowReadSchema = z.strictObject({
  key: z.union([z.string(), z.number()]),
  revision: z.number().int().min(1),
  set: z.record(columnNameSchema, cellValueSchema),
  verified_empty: z.array(z.strictObject({ column: columnNameSchema, reason: z.string() })).optional(),
  provenance: z.record(columnNameSchema, provenanceReadSchema).optional(),
  claim: z.strictObject({ worker: z.string(), by: z.string(), until: z.string() }).optional(),
})

export type TableRowRead = z.infer<typeof tableRowReadSchema>

// ---------------------------------------------------------------- Patch de l'en-tête (E07-S04)
// L'en-tête s'écrit par `write.header` en deltas nommés (`mcp-patterns.md § 4 ter`) : les colonnes
// fusionnées par nom et par attribut, le retrait à part (Oto, 52 notes perdues par un schéma posé
// entier). Les contrôles croisés restent ceux de `parseTableHeader`, sur l'en-tête fusionné ; le refus
// d'une clé inconnue est écrit par le service (`readHeaderPatch`), qui borne la liste des clés.

export const tableColumnPatchSchema = z.strictObject({
  name: columnNameSchema.describe("Column name: an existing column receives the attributes given, a new one is added at the end, e.g. telephone."),
  label: columnLabelSchema.optional().describe(`What screens show for this column, 1 to ${COLUMN_LABEL_MAX} characters, e.g. Téléphone (default: unchanged; the name for a new column).`),
  type: columnTypeSchema.optional().describe("text, number, date, datetime, bool, enum, email or url; required for a new column, e.g. text (default: unchanged)."),
  options: z.array(z.string()).min(1).max(100).optional().describe('enum only: the values, 1 to 100, e.g. ["à contacter", "inscrit"] (default: unchanged).'),
  required: z.boolean().optional().describe("true: a row cannot lack this column: a value, or verified_empty with a reason, e.g. true (default: unchanged; false for a new column)."),
  allow_verified_empty: z
    .boolean()
    .optional()
    .describe("false: verified_empty is refused for this column; a row needs a real value there, e.g. false (default: unchanged; true for a new column)."),
  max_length: z.number().int().min(1).max(10_000).optional().describe("text, email and url only: characters at most, e.g. 250 (default: unchanged)."),
})

export type TableColumnPatch = z.infer<typeof tableColumnPatchSchema>

/** Le `header` de `write` pour un tableau (E07-S04) : le JSON Schema du contrat `write.table`. */
export const tableHeaderPatchSchema = z.strictObject({
  columns: z
    .array(tableColumnPatchSchema)
    .min(1)
    .max(100)
    .optional()
    .describe('Columns merged by name, e.g. [{"name": "telephone", "type": "text"}]; unnamed columns and attributes stay (default: none).'),
  remove_columns: z.array(columnNameSchema).min(1).max(100).optional().describe('Names of the columns to remove, e.g. ["notes"] (default: none).'),
  key: columnNameSchema.optional().describe("Name of the key column, e.g. nom; it changes only while the table has no row (default: unchanged)."),
  lifecycle: tableLifecycleSchema.optional().describe("Work queue of the rows, replaced whole, e.g. {column, states, working} (default: unchanged)."),
  closed: z.boolean().optional().describe("true: only existing rows can be written, e.g. true (default: unchanged; false for a new table)."),
  proof: z
    .boolean()
    .optional()
    .describe("true: every new value written by table.write needs its proof, {value, comment | link}, e.g. true (default: unchanged; false for a new table)."),
  confirm_remove: z
    .boolean()
    .optional()
    .describe("true, with publish: true and only after the user agreed: erases the values of the removed columns (default false; never saved)."),
})

export type TableHeaderPatch = z.infer<typeof tableHeaderPatchSchema>
