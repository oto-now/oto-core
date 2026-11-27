// `table.schema` (E07-S01, AC5) et la description d'un tableau que `read` sert aussi (AC18) : clé,
// colonnes, file de travail et revue, fermeture. Les lignes qui nomment `table.write`, `table.claim`
// ou `table.release` n'apparaissent que si la fonction est au catalogue (N15) : E07-S02 les y
// inscrit, et le contrat les montre alors sans autre changement. Sans lui, un modèle lirait ou
// écrirait un tableau sans en connaître les colonnes, et `read` ne dirait rien d'un tableau.
//
// Repris de la maquette (`mcp-test/src/proto/functions/table.ts` l. 71-94, `services/read.ts`
// l. 46-53) : « Table <path>: <titre>. <résumé> », une ligne par colonne, la file de travail, le
// renvoi de `read` vers `table.rows`. Retiré : la clé hors des colonnes (→ une colonne déclarée, N1),
// la colonne d'état et ses états à part (→ `lifecycle`, H91), les lignes d'écriture servies sans
// `table.write` au catalogue.
import {
  ACCESS_LEVEL_NAMES,
  tableSchemaArgsSchema,
  type TableColumn,
  type TableHeader,
} from "../../schemas"
import { defineFunction, type FunctionContext, type FunctionOutput } from "../catalog/define"
import type { PlatformDb } from "../db"
import { formatCount } from "../nodes/document"
import type { NodeRow } from "../nodes/lookup"
import { ownerOf, ownerTexts } from "../nodes/view"
import { checkSchemaArgs } from "./check"
import { pendingHeaderChanges } from "./evolution"
import { loadTable, maxLengthOf, noHeaderMessage, publishedHeader, type LoadedTable } from "./meta"
import { tableOutput } from "./output"
import { countRows } from "./rows"

/** Ce que la description d'un tableau lit hors de son en-tête : ses lignes et le catalogue (N15). */
type TableFacts = { rows: number; functions: ReadonlySet<string> }

/** Forme attendue d'une valeur, citée après le type quand elle n'est pas évidente. */
const FORMATS: Partial<Record<TableColumn["type"], string>> = {
  date: "YYYY-MM-DD",
  datetime: "with a time zone, e.g. 2026-09-24T14:30:00Z",
  bool: "true or false",
}

/**
 * Ce qu'exige une colonne (E11-S01, AC-b6) : la clé et la colonne d'état, requises (ni `clear` ni
 * `verified_empty`, `reservedProblem`) ; une colonne requise, une valeur ou `verified_empty`, sauf
 * `allow_verified_empty: false` ; une colonne facultative qui refuse `verified_empty`.
 */
function requirement(column: TableColumn, reserved: boolean): string | null {
  const strict = column.allow_verified_empty === false
  if (reserved) return "required"
  if (column.required) return strict ? "required (a value; verified_empty not allowed)" : "required (a value or verified_empty)"
  return strict ? "verified_empty not allowed" : null
}

function columnLine(column: TableColumn, header: TableHeader): string {
  const key = column.name === header.key
  const type = column.type === "enum" ? `enum (${(column.options ?? []).join(" | ")})` : column.type
  const format = FORMATS[column.type]
  const parts = [format ? `${type} (${format})` : type]
  const required = requirement(column, key || column.name === header.lifecycle?.column)
  if (required !== null) parts.push(required)
  // La longueur que `valueProblem` accepte : une adresse email ou une URL garde son plafond (N30).
  if (column.max_length !== undefined) parts.push(`${formatCount(maxLengthOf(column) ?? column.max_length)} characters at most`)
  // #225 : le libellé que l'écran affiche, pour que l'assistant nomme la colonne comme la personne la voit.
  if (column.label !== undefined) parts.push(`shown as « ${column.label} »`)
  return `- ${column.name}: ${parts.join(", ")}${key ? " (key)" : ""}`
}

/** La file de travail et la revue, quand l'en-tête les déclare ; `table.claim` et `table.release` s'ils sont au catalogue. */
function queueLines(header: TableHeader, functions: ReadonlySet<string>): string[] {
  const { lifecycle } = header
  if (!lifecycle) return []
  const [entry] = lifecycle.states
  const lines = [
    `Work queue on ${lifecycle.column}: rows enter « ${entry} »; « ${lifecycle.working} » marks a row a worker holds under a lease.`,
  ]
  if (functions.has("table.claim")) lines.push(`table.claim takes rows « ${entry} » (or whose lease expired) and sets them « ${lifecycle.working} » with a lease.`)
  if (functions.has("table.release")) lines.push("table.release frees a row you claimed and sets its next state.")
  const { review } = lifecycle
  if (review) {
    lines.push(`Review: rows « ${review.state} » wait for a person, who approves them (« ${review.approve} ») or rejects them (« ${review.reject} »).`)
    // E11-S01, AC-e4 : la revue confiée aussi à l'assistant, qui pose la décision par l'une des deux fonctions.
    if (review.agents_may_decide) lines.push(`An assistant may also decide: set « ${review.approve} » or « ${review.reject} » with table.release or table.write.`)
  }
  return lines
}

/**
 * La ligne d'écriture (E07-S02 ; E11-S01, AC-f4) : la forme de la preuve, exigée seulement dans un tableau
 * qui la déclare (`proof`, fiche D133).
 */
function writeLine(header: TableHeader): string {
  if (!header.proof) {
    return "Write with table.write: rows [{key, revision?, set: {column: value | {value, comment | link}}, clear: [column], verified_empty: [{column, reason}]}]; a bare value equal to the stored one is ignored; null is refused; unnamed columns stay unchanged."
  }
  const state = header.lifecycle ? `, except the state column ${header.lifecycle.column}, set bare within its allowed changes` : ""
  return `Write with table.write: rows [{key, revision?, set: {column: {value, comment | link}}, clear: [column], verified_empty: [{column, reason}]}]; a bare value equal to the stored one is ignored; any new value needs its proof (comment or link)${state}; null is refused; unnamed columns stay unchanged.`
}

/** La ligne de la preuve (E11-S01, AC-f4), après la fermeture. */
function proofLine(header: TableHeader): string {
  return header.proof
    ? "Proof: required — every new value needs {value, comment | link}; a new value without it refuses the whole call."
    : "Proof: optional — a bare value is written as it is; {value, comment | link} keeps where it comes from."
}

/**
 * La description d'un tableau (AC5, AC18) : clé, colonnes, file de travail et revue, écriture si
 * `table.write` est au catalogue, fermeture, preuve ; et ses données en champs. `table.schema` y ajoute son
 * en-tête et un exemple, `read` le nombre de lignes et le renvoi vers `table.rows`.
 */
function describeTable(table: Pick<LoadedTable, "node" | "header">, facts: TableFacts): { lines: string[]; data: Record<string, unknown> } {
  const { node, header } = table
  const lines = [
    `Key: ${header.key} — each row is addressed by its ${header.key} value${header.closed ? "." : "; a new value creates a row."}`,
    "Columns:",
    ...header.columns.map((column) => columnLine(column, header)),
    ...queueLines(header, facts.functions),
    ...(facts.functions.has("table.write") ? [writeLine(header)] : []),
    header.closed ? "Closed: yes — only existing rows can be written." : "Closed: no — a new key creates a row.",
    proofLine(header),
  ]
  const data = {
    table: node.path,
    title: node.title,
    key: header.key,
    columns: header.columns,
    ...(header.lifecycle ? { lifecycle: header.lifecycle } : {}),
    closed: header.closed,
    proof: header.proof,
    rows_count: facts.rows,
  }
  return { lines, data }
}

/** Un appel de `table.rows` sur les vraies colonnes : le premier état de la file (ou la première option), trois colonnes. */
function exampleArguments(table: Pick<LoadedTable, "node" | "header">): Record<string, unknown> {
  const { node, header } = table
  const choice = header.columns.find((column) => column.name === header.lifecycle?.column) ?? header.columns.find((column) => column.type === "enum")
  const option = choice?.options?.[0]
  const columns = header.columns.filter((column) => column.name !== header.key).slice(0, 3).map((column) => column.name)
  return {
    table: node.path,
    ...(choice && option !== undefined ? { filter: { [choice.name]: option } } : {}),
    ...(columns.length > 0 ? { columns } : {}),
  }
}

/**
 * Les noms des fonctions du catalogue (`catalogNames`). Le registre importe ce module : lu à l'appel,
 * par un import dynamique, il ne forme pas de cycle d'import (registre → `table.schema` → registre).
 */
async function functionNames(): Promise<ReadonlySet<string>> {
  return (await import("../catalog/registry")).catalogNames()
}

async function ownerLine(context: FunctionContext, nodeId: string): Promise<string> {
  return (await ownerTexts(context.db, context.identity, await ownerOf(context.db, nodeId), false)).line
}

async function readSchema(context: FunctionContext, args: { table: string }): Promise<FunctionOutput> {
  const table = await loadTable(context, args.table)
  const { node } = table
  const [rows, owner, functions] = await Promise.all([countRows(context.db, node.id), ownerLine(context, node.id), functionNames()])
  const described = describeTable(table, { rows, functions })
  const level = ACCESS_LEVEL_NAMES[table.level]
  const text = [
    `Table ${node.path}: ${node.title}. ${node.summary}`,
    // E11-S01, AC-d1 : la révision publiée, celle que `write` attend pour changer l'en-tête (HN-E11S01-9).
    `Owner: ${owner}. Your access: ${level}. Rows: ${formatCount(rows)}. Revision: ${node.revision} (the base_revision of ${context.identity.org.prefix}_write to change the header).`,
    ...described.lines,
    `Example: ${context.identity.org.prefix}_call {"function": "table.rows", "arguments": ${JSON.stringify(exampleArguments(table))}}`,
  ].join("\n")
  return tableOutput(context, table, { text, data: { ...described.data, revision: node.revision, your_level: level } })
}

/** Ce que `read {draft: true}` lit du brouillon d'un tableau (E07-S04, AC12), décidé au niveau 2 par `read`. */
type TableDraft = { meta: Record<string, unknown> | null; baseRevision: number }

/**
 * Le corps de `read` d'un tableau (AC18) : sa description, son nombre de lignes et comment les lire ;
 * aucun bloc. Un tableau jamais publié le dit. Avec `draft` (E07-S04, AC12) : la description de
 * l'en-tête du brouillon, suivie de la ligne des changements en attente.
 */
export async function tableReadBody(
  db: PlatformDb,
  node: NodeRow,
  request: { prefix: string; functions: ReadonlySet<string>; draft?: TableDraft | null },
): Promise<string> {
  const published = publishedHeader(node)
  const pending = request.draft ? pendingHeaderChanges(node, request.draft) : null
  const header = pending ? pending.header : "missing" in published ? null : published.header
  const tail = pending ? [pending.line] : []
  if (!header) return [noHeaderMessage(node.path, request.prefix), ...tail].join("\n")
  const rows = await countRows(db, node.id)
  const { lines } = describeTable({ node, header }, { rows, functions: request.functions })
  return [
    ...lines,
    `Rows: ${formatCount(rows)}.`,
    `Read rows with ${request.prefix}_call {"function": "table.rows", "arguments": {"table": "${node.path}"}}.`,
    ...tail,
  ].join("\n")
}

export const tableSchema = defineFunction({
  name: "table.schema",
  connector: "table",
  class: "read",
  origin: "paquet",
  description:
    "Describes a table: its key, its columns with their types, its work queue and review, whether new rows can be created, and an example call of table.rows. Use it before filtering, sorting or writing a table whose columns you do not know.",
  schema: tableSchemaArgsSchema,
  examples: [{ table: "ventes/suivi_prospects" }],
  refusals: [
    "Unknown table: not a table you can read; the refusal lists the tables you can read.",
    "A path that is a page, a procedure or a Contexte, not a table: read it with read.",
    "A table whose header was never published: its owner publishes it with write.",
  ],
  next: ["table.rows", "table.aggregate"],
  checkArgs: checkSchemaArgs,
  run: readSchema,
})
