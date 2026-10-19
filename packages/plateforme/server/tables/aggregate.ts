// `table.aggregate` (E07-S01, AC16, AC17 ; H97, N6, N10) : nombre de lignes, et somme, moyenne,
// minimum et maximum d'une colonne nombre, par valeur d'une colonne ou en une ligne de totaux,
// calculés dans le service sur 5 000 lignes au plus, après la décision de `loadTable`. Sans lui,
// compter les prospects par statut demanderait de lire toutes les lignes.
//
// Repris d'Oto (`db/query.py` l. 673-749) : `count` sans colonne compte les lignes, avec une colonne
// ses cellules renseignées ; `sum`, `avg`, `min`, `max` sur les nombres ; noms `<op>_<colonne>` ;
// 1 000 groupes au plus. Retiré : le filtre par métrique, `count_rows`, le regroupement de plusieurs
// colonnes. Repris de la maquette (`mcp-test/src/proto/functions/table.ts` l. 133-165) : agrégat en
// mémoire, borne de 5 000 lignes, groupes par effectif décroissant ; retiré : `values->>col` en texte.
import {
  tableAggregateArgsSchema,
  type AggregateOp,
  type CellValue,
  type TableAggregateArgs,
  type TableColumn,
  type TableHeader,
} from "../../schemas"
import { defineFunction, type FunctionContext, type FunctionOutput } from "../catalog/define"
import { boundedList, PlatformError } from "../errors"
import { formatCount } from "../nodes/document"
import { checkAggregateArgs } from "./check"
import { matchesRow, parseFilter, unknownColumns, unknownColumnsMessage } from "./filters"
import { columnOf } from "./header"
import { loadTable, rowCells, type LoadedTable } from "./meta"
import { tableOutput } from "./output"
import { NATURAL } from "./paging"
import { countRows, FILTERED_ROWS_MAX, loadRows, tooManyRows } from "./rows"

/** Groupes au plus (H97). */
const GROUPS_MAX = 1_000

/** Groupes sérialisés au plus d'un résultat, comme les lignes d'une page (N11). */
const GROUPS_CHARS = 16_000

type Metric = { op: AggregateOp; column: TableColumn | null; name: string }

/** Un groupe servi : sa valeur, ou `empty` pour les cellules sans valeur, puis ses métriques. */
type Group = { value?: CellValue; empty?: true } & Record<string, CellValue | true | undefined>

/** Les métriques demandées, contrôlées contre l'en-tête (AC17) ; noms `count`, `<op>_<colonne>`, sans doublon. */
function parseMetrics(header: TableHeader, args: TableAggregateArgs): Metric[] {
  const metrics: Metric[] = []
  for (const { op, column: name } of args.metrics ?? [{ op: "count" }]) {
    const column = name === undefined ? null : (columnOf(header, name) ?? null)
    if (op !== "count" && !column) {
      const numbers = header.columns.filter((candidate) => candidate.type === "number").map((candidate) => candidate.name)
      throw new PlatformError("invalid_arguments", `${op} needs a number column, e.g. {"op": "${op}", "column": "${numbers[0] ?? "…"}"}. Number columns: ${numbers.join(", ") || "none"}.`)
    }
    if (op !== "count" && column && column.type !== "number") {
      throw new PlatformError("invalid_arguments", `${op} applies to number columns; ${column.name} is ${column.type}.`)
    }
    const metric = { op, column, name: column ? `${op}_${column.name}` : op }
    if (!metrics.some((known) => known.name === metric.name)) metrics.push(metric)
  }
  return metrics
}

/**
 * La valeur d'une métrique sur les cellules d'un groupe ; aucune pour une moyenne, un minimum ou un
 * maximum sans nombre. Relue par le résumé de la grille (E07-S03, AC8) : une seule règle des sommes.
 */
export function metricValue(metric: Metric, members: readonly ReadonlyMap<string, CellValue>[]): number | undefined {
  const { op, column } = metric
  if (op === "count") return column ? members.filter((cells) => cells.has(column.name)).length : members.length
  // Une valeur hors type (semée par la clé service) ne compte pas : seuls les nombres s'additionnent.
  const numbers = members.flatMap((cells) => {
    const cell = column ? cells.get(column.name) : undefined
    return typeof cell === "number" ? [cell] : []
  })
  if (op === "sum") return numbers.reduce((sum, value) => sum + value, 0)
  if (numbers.length === 0) return undefined
  if (op === "avg") return Math.round((numbers.reduce((sum, value) => sum + value, 0) / numbers.length) * 100) / 100
  return op === "min" ? Math.min(...numbers) : Math.max(...numbers)
}

type Bucket = { value?: CellValue; members: ReadonlyMap<string, CellValue>[] }

/** Les lignes réparties par valeur de la colonne (une seule part sans `group_by`) ; plus de 1 000 → `too_large`. */
function buckets(entries: readonly ReadonlyMap<string, CellValue>[], groupBy: TableColumn | null): Bucket[] {
  const byValue = new Map<string, Bucket>()
  for (const cells of entries) {
    const value = groupBy ? cells.get(groupBy.name) : undefined
    const id = value === undefined ? "" : JSON.stringify(value)
    const bucket = byValue.get(id) ?? { ...(value === undefined ? {} : { value }), members: [] }
    bucket.members.push(cells)
    byValue.set(id, bucket)
    if (byValue.size > GROUPS_MAX) throw new PlatformError("too_large", `More than ${formatCount(GROUPS_MAX)} groups: narrow where, or group by another column.`)
  }
  if (!groupBy && byValue.size === 0) return [{ members: [] }]
  return [...byValue.values()]
}

/** Par effectif décroissant, puis par valeur (ordre naturel), les cellules sans valeur en dernier. */
function largestFirst(a: Bucket, b: Bucket): number {
  if (a.members.length !== b.members.length) return b.members.length - a.members.length
  if (a.value === undefined || b.value === undefined) return a.value === b.value ? 0 : a.value === undefined ? 1 : -1
  if (typeof a.value === "number" && typeof b.value === "number") return a.value - b.value
  return NATURAL.compare(String(a.value), String(b.value))
}

function groupOf(bucket: Bucket, metrics: readonly Metric[], grouped: boolean): Group {
  const group: Group = grouped ? (bucket.value === undefined ? { empty: true } : { value: bucket.value }) : {}
  for (const metric of metrics) {
    const value = metricValue(metric, bucket.members)
    if (value !== undefined) group[metric.name] = value
  }
  return group
}

/** Combien de groupes tiennent en 16 000 caractères sérialisés (N11), dans l'ordre servi. */
function fittingGroups(groups: readonly Group[]): number {
  let size = 2
  for (const [index, group] of groups.entries()) {
    size += JSON.stringify(group).length + (index > 0 ? 1 : 0)
    if (size > GROUPS_CHARS) return index
  }
  return groups.length
}

/**
 * Une ligne de groupe : sa valeur citée en JSON, comme les lignes de `table.rows` : un saut de ligne
 * écrit dans une cellule ne fabrique pas de fausse ligne de groupe dans le texte (N23).
 */
function groupLine(group: Group, metrics: readonly Metric[], grouped: boolean): string {
  const label = !grouped ? "all rows" : group.empty ? "(no value)" : JSON.stringify(group.value)
  const values = metrics.flatMap((metric) => (group[metric.name] === undefined ? [] : [`${metric.name} ${String(group[metric.name])}`]))
  return `- ${label}: ${values.join(", ")}`
}

function firstLine(path: string, total: number, groupBy: TableColumn | null, groups: number): string {
  if (total === 0) return `${path}: 0 row match.`
  const by = groupBy ? `; ${formatCount(groups)} group(s) by ${groupBy.name}` : ""
  return `${path}: ${formatCount(total)} row(s) match${by}.`
}

/** Les colonnes nommées (`where`, `group_by`, `metrics`) sont déclarées (AC8), le filtre typé, les métriques permises. */
function checkArgs(table: LoadedTable, args: TableAggregateArgs, masked?: (text: string) => string) {
  const { header } = table
  const named = [...Object.keys(args.where ?? {}), ...(args.group_by ? [args.group_by] : []), ...(args.metrics ?? []).flatMap((metric) => (metric.column ? [metric.column] : []))]
  const unknown = unknownColumns(header, named)
  if (unknown.length > 0) throw new PlatformError("invalid_arguments", unknownColumnsMessage(header, unknown))
  const where = parseFilter(args.where, header, masked)
  if ("problems" in where) throw new PlatformError("invalid_arguments", boundedList(where.problems, " "))
  const groupBy = args.group_by ? (columnOf(header, args.group_by) ?? null) : null
  return { clauses: where.clauses, groupBy, metrics: parseMetrics(header, args) }
}

async function aggregateRows(context: FunctionContext, args: TableAggregateArgs): Promise<FunctionOutput> {
  const table = await loadTable(context, args.table)
  const { clauses, groupBy, metrics } = checkArgs(table, args, context.pseudonymized)
  const path = table.node.path
  const count = await countRows(context.db, table.node.id)
  if (count > FILTERED_ROWS_MAX) throw tooManyRows(path, count)
  const rows = await loadRows(context.db, table.node.id, FILTERED_ROWS_MAX)
  if (rows.length > FILTERED_ROWS_MAX) throw tooManyRows(path, rows.length)
  const entries = rows.map((block) => rowCells(block, table.header)).filter((cells) => matchesRow(cells, clauses))
  const grouped = groupBy !== null
  const groups = buckets(entries, groupBy)
    .sort(largestFirst)
    .map((bucket) => groupOf(bucket, metrics, grouped))
  const served = groups.slice(0, fittingGroups(groups))
  const text = [
    firstLine(path, entries.length, groupBy, groups.length),
    ...served.map((group) => groupLine(group, metrics, grouped)),
    ...(served.length < groups.length
      ? [`Showing the ${formatCount(served.length)} largest groups of ${formatCount(groups.length)}; narrow where to see the others.`]
      : []),
  ].join("\n")
  const data = { table: path, total: entries.length, ...(groupBy ? { group_by: groupBy.name } : {}), groups: served, groups_total: groups.length }
  return tableOutput(context, table, { text, data })
}

export const tableAggregate = defineFunction({
  name: "table.aggregate",
  connector: "table",
  class: "read",
  origin: "paquet",
  description:
    "Counts the rows of a table, in groups by the values of a column or as one line of totals, with the sum, average, minimum or maximum of number columns, computed by the server. Use it to count or total rows (how many per status, total amount); to list rows, use table.rows.",
  schema: tableAggregateArgsSchema,
  examples: [
    { table: "ventes/suivi_prospects", group_by: "statut" },
    { table: "ventes/suivi_prospects", where: { ville: "Valbrune" }, metrics: [{ op: "count" }, { op: "sum", column: "montant_estime" }] },
  ],
  refusals: [
    "Unknown table: not a table you can read; the refusal lists the tables you can read.",
    "Unknown column(s) in where, group_by or metrics; the refusal lists the columns.",
    "sum, avg, min or max on a column that is not a number column, or without a column.",
    "A where refused like the filter of table.rows (unknown operator, wrong type, null, in with no value).",
    "More than 1,000 groups; a table of more than 5,000 rows.",
  ],
  next: ["table.rows"],
  checkArgs: checkAggregateArgs,
  run: aggregateRows,
})
