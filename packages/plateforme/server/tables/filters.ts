// Une seule grammaire de filtre (E07-S01, AC8, AC10 ; H95, N3, N4) : validée contre l'en-tête, typée
// par la colonne, évaluée sur les cellules d'une ligne ; partagée par `table.rows`, `table.aggregate`,
// `table.claim` (E07-S02) et la grille (E07-S03). Sans elle, pas de filtre typé : `True` pour `true`
// rendait 0 ligne au lieu de 29, `in: []` rendait tout le tableau (#353).
//
// Repris d'Oto (`db/query.py` l. 34-387) : `{col: val}` ou `{col: {op: val}}`, 30 clauses, opérateurs,
// refus de `in: []` et de `null`, `ne` qui garde les cellules vides (`IS DISTINCT FROM`). Retiré : les
// filtres sur colonnes liste (`contacts[].attr`), les colonnes libres hors schéma, un seul opérateur
// par colonne (ici, plusieurs : ET).
import {
  FILTER_OPERATORS,
  MAX_FILTER_CLAUSES,
  MAX_IN_VALUES,
  normalizeTitle,
  nullInFilterMessage,
  tooManyInValuesMessage,
  unknownOperatorMessage,
  type CellValue,
  type ColumnType,
  type FilterOperator,
  type TableColumn,
  type TableHeader,
} from "../../schemas"
import { isRecord } from "../../schemas/tables"
import { boundedList } from "../errors"
import { hasToken } from "../pseudonym/arguments"
import { columnOf } from "./header"
import { instantOf, isValidDate, valueProblem } from "./meta"

/** Une valeur comparable : texte sans casse ni accent, nombre, date, instant (ms) ou booléen (N3). */
type Compared =
  | { kind: "text"; value: string }
  | { kind: "number"; value: number }
  | { kind: "date"; value: string }
  | { kind: "instant"; value: number }
  | { kind: "bool"; value: boolean }

/**
 * `masked` : quand une valeur de la clause porte un jeton (pseudonymisation), la cellule se compare pseudonymisée, dans
 * l'espace où l'assistant l'a lue (« client#… » égale « Camille Dupré »).
 */
export type FilterClause = { column: TableColumn; op: FilterOperator; values: Compared[]; masked?: (text: string) => string }

const TEXT_TYPES: readonly ColumnType[] = ["text", "email", "url", "enum"]
const ORDERED_TYPES: readonly ColumnType[] = ["number", "date", "datetime"]

/** Types qui prennent un opérateur ; absent : tous (`eq`, `ne`, `empty`, `not_empty`). */
const APPLIES: Partial<Record<FilterOperator, readonly ColumnType[]>> = {
  contains: TEXT_TYPES,
  in: [...TEXT_TYPES, ...ORDERED_TYPES],
  gt: ORDERED_TYPES,
  gte: ORDERED_TYPES,
  lt: ORDERED_TYPES,
  lte: ORDERED_TYPES,
}

/** « number, date and datetime ». */
function listText(items: readonly string[]): string {
  return items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}` : items.join("")
}

function article(type: ColumnType): string {
  return type === "enum" || type === "email" ? "an" : "a"
}

/**
 * « Unknown column(s): couleur. Columns: entreprise, contact, … » (AC8) : les noms inconnus bornés à
 * 20 (`boundedList`), leur nombre n'étant borné nulle part avant ; les colonnes, 100 au plus (en-tête).
 */
export function unknownColumnsMessage(header: TableHeader, unknown: readonly string[]): string {
  return `Unknown column(s): ${boundedList([...new Set(unknown)])}. Columns: ${header.columns.map((column) => column.name).join(", ")}.`
}

/** Les noms qui ne sont pas des colonnes déclarées, dans l'ordre, sans doublon. */
export function unknownColumns(header: TableHeader, names: readonly string[]): string[] {
  return [...new Set(names.filter((name) => !columnOf(header, name)))]
}

/** La valeur comparable d'une cellule, pseudonymisée par `masked` s'il est donné ; `null` pour une valeur hors type (semée par la clé service). */
export function comparedCell(column: TableColumn, cell: CellValue, masked?: (text: string) => string): Compared | null {
  if (TEXT_TYPES.includes(column.type)) return typeof cell === "string" ? { kind: "text", value: normalizeTitle(masked ? masked(cell) : cell) } : null
  if (column.type === "number") return typeof cell === "number" ? { kind: "number", value: cell } : null
  if (column.type === "bool") return typeof cell === "boolean" ? { kind: "bool", value: cell } : null
  if (column.type === "date") return typeof cell === "string" && isValidDate(cell) ? { kind: "date", value: cell } : null
  const instant = typeof cell === "string" ? instantOf(cell) : null
  return instant === null ? null : { kind: "instant", value: instant }
}

/** La valeur d'un filtre, typée par la colonne (N4), ou le problème à dire. */
function filterValue(column: TableColumn, value: unknown): { compared: Compared } | { problem: string } {
  const typeProblem = (problem: string) => ({ problem: `${column.name} is ${article(column.type)} ${column.type} column: ${problem}.` })
  if (column.type === "enum") {
    const option = typeof value === "string" ? (column.options ?? []).find((candidate) => normalizeTitle(candidate) === normalizeTitle(value)) : undefined
    return option === undefined ? typeProblem(`expected one of: ${(column.options ?? []).join(", ")}`) : { compared: { kind: "text", value: normalizeTitle(option) } }
  }
  if (TEXT_TYPES.includes(column.type)) {
    return typeof value === "string" ? { compared: { kind: "text", value: normalizeTitle(value) } } : typeProblem(`expected a text (not ${JSON.stringify(value)})`)
  }
  const problem = valueProblem(column, value)
  if (problem !== null) return typeProblem(problem)
  // La valeur a passé `valueProblem` : c'est une valeur de ce type, donc une cellule comparable.
  const compared = comparedCell(column, value as CellValue)
  return compared ? { compared } : typeProblem(`expected ${column.type}`)
}

type RawClause = { column: TableColumn; op: string; value: unknown }

/** Les clauses brutes d'une colonne : `{col: valeur}` vaut `eq` ; `{col: {op: valeur}}`, une par opérateur. */
function rawClauses(column: TableColumn, spec: unknown, problems: string[]): RawClause[] {
  if (spec === null) {
    problems.push(nullInFilterMessage(column.name))
    return []
  }
  if (Array.isArray(spec)) {
    problems.push(`${column.name}: a list is not a value; use {"${column.name}": {"in": [...]}}.`)
    return []
  }
  if (!isRecord(spec)) return [{ column, op: "eq", value: spec }]
  const entries = Object.entries(spec)
  if (entries.length === 0) problems.push(`No operator given for ${column.name}. Operators: ${FILTER_OPERATORS.join(", ")}.`)
  return entries.map(([op, value]) => ({ column, op, value }))
}

function isOperator(op: string): op is FilterOperator {
  const known: readonly string[] = FILTER_OPERATORS
  return known.includes(op)
}

/** Une clause brute contrôlée : opérateur connu et permis par le type, valeurs typées (AC8). */
function checkClause(raw: RawClause): FilterClause | string[] {
  const { column, op, value } = raw
  if (!isOperator(op)) return [unknownOperatorMessage([op], column.name)]
  if (value === null) return [nullInFilterMessage(column.name)]
  const types = APPLIES[op]
  if (types && !types.includes(column.type)) return [`${op} applies to ${listText(types)} columns; ${column.name} is ${column.type}.`]
  if (op === "empty" || op === "not_empty") {
    return value === true ? { column, op, values: [] } : [`${op} takes true: {"${column.name}": {"${op}": true}}.`]
  }
  if (op === "contains") {
    return typeof value === "string" && value.trim() !== ""
      ? { column, op, values: [{ kind: "text", value: normalizeTitle(value) }] }
      : [`contains takes a text of one character at least: ${column.name}.`]
  }
  const values = op === "in" ? value : [value]
  if (!Array.isArray(values)) return [`in takes a list of values, e.g. {"${column.name}": {"in": [...]}}.`]
  if (values.length === 0) return [`in needs at least one value (an empty list would match nothing): ${column.name}.`]
  if (values.length > MAX_IN_VALUES) return [tooManyInValuesMessage(values.length, column.name)]
  if (values.includes(null)) return [nullInFilterMessage(column.name)]
  const typed = values.map((item) => filterValue(column, item))
  const problems = typed.flatMap((item) => ("problem" in item ? [item.problem] : []))
  return problems.length > 0 ? [...new Set(problems)] : { column, op, values: typed.flatMap((item) => ("compared" in item ? [item.compared] : [])) }
}

/**
 * Le filtre validé contre l'en-tête (AC8) : clauses typées, ou la liste de ses problèmes (colonne
 * inconnue, `null`, opérateur inconnu ou d'un autre type, valeur mal typée, `in` vide, plus de 30
 * clauses). Reçoit l'entrée brute : une vue rangée en base (E07-S03) n'est passée par aucun schéma.
 */
export function parseFilter(filter: unknown, header: TableHeader, masked?: (text: string) => string): { clauses: FilterClause[] } | { problems: string[] } {
  if (filter === undefined) return { clauses: [] }
  if (!isRecord(filter)) return { problems: ['filter: expected an object, e.g. {"ville": "Valbrune"}.'] }
  const unknown = unknownColumns(header, Object.keys(filter))
  const problems = unknown.length > 0 ? [unknownColumnsMessage(header, unknown)] : []
  const raw = Object.entries(filter).flatMap(([name, spec]) => {
    const column = columnOf(header, name)
    return column ? rawClauses(column, spec, problems) : []
  })
  if (raw.length > MAX_FILTER_CLAUSES) problems.push(`Too many filter clauses (${raw.length}): ${MAX_FILTER_CLAUSES} at most.`)
  const clauses: FilterClause[] = []
  for (const checked of raw.map(checkClause)) {
    if (Array.isArray(checked)) problems.push(...checked)
    else clauses.push(masked && checked.values.some((value) => value.kind === "text" && hasToken(value.value)) ? { ...checked, masked } : checked)
  }
  return problems.length > 0 ? { problems: [...new Set(problems)] } : { clauses }
}

function equal(a: Compared, b: Compared): boolean {
  return a.kind === b.kind && a.value === b.value
}

/** Ordre de deux valeurs de même genre (nombre, instant, date ISO). */
function order(a: Compared, b: Compared): number {
  if (typeof a.value === "number" && typeof b.value === "number") return a.value - b.value
  return String(a.value) < String(b.value) ? -1 : String(a.value) > String(b.value) ? 1 : 0
}

function matchesClause(cells: ReadonlyMap<string, CellValue>, clause: FilterClause): boolean {
  const cell = cells.get(clause.column.name)
  if (clause.op === "empty") return cell === undefined
  if (clause.op === "not_empty") return cell !== undefined
  const typed = cell === undefined ? null : comparedCell(clause.column, cell, clause.masked)
  const [first] = clause.values
  switch (clause.op) {
    case "ne":
      return typed === null || !equal(typed, first)
    case "eq":
    case "in":
      return typed !== null && clause.values.some((value) => equal(typed, value))
    case "contains":
      return typed?.kind === "text" && typed.value.includes(String(first.value))
    default:
      return typed !== null && typed.kind === first.kind && compareOp(clause.op, order(typed, first))
  }
}

function compareOp(op: FilterOperator, sign: number): boolean {
  if (op === "gt") return sign > 0
  if (op === "gte") return sign >= 0
  if (op === "lt") return sign < 0
  return sign <= 0
}

/** Une ligne répond à toutes les clauses (ET) ; une valeur hors type ne répond qu'à `ne` et `not_empty`. */
export function matchesRow(cells: ReadonlyMap<string, CellValue>, clauses: readonly FilterClause[]): boolean {
  return clauses.every((clause) => matchesClause(cells, clause))
}

/** Séparateur des cellules cherchées : ni lettre ni chiffre, aucun mot de `queryWords` ne l'enjambe. */
const CELL_SEPARATOR = "\n"

/**
 * `q` (AC10 ; E11-S01, AC-c1) : chaque mot (`queryWords`) se trouve, sans casse ni accent, dans l'une des
 * colonnes `text`, `email`, `url` ou `enum` ou dans la clé, dans n'importe quel ordre, au besoin dans des
 * cellules différentes. Chaque cellule est normalisée une fois par ligne (coût borné, § Sécurité de la story).
 */
export function matchesQuery(cells: ReadonlyMap<string, CellValue>, header: TableHeader, words: readonly string[]): boolean {
  return queryHits(cells, header, words) === words.length
}

/**
 * Le nombre de mots de `q` qu'une ligne porte, cherchés comme pour `matchesQuery` (E11-S19, AC-f1) : `match: "any"`
 * de `table.rows` garde les lignes qui en portent au moins un et les classe par ce nombre.
 */
export function queryHits(cells: ReadonlyMap<string, CellValue>, header: TableHeader, words: readonly string[]): number {
  const searched = header.columns.flatMap((column) => {
    if (!TEXT_TYPES.includes(column.type) && column.name !== header.key) return []
    const cell = cells.get(column.name)
    return cell !== undefined && typeof cell !== "boolean" ? [normalizeTitle(String(cell))] : []
  })
  const text = searched.join(CELL_SEPARATOR)
  return words.filter((word) => text.includes(word)).length
}
