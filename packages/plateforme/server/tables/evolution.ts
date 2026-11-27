// Évolution de l'en-tête d'un tableau (E07-S04, AC2 à AC5, AC12 ; H90, H91) : le `header` de `write`
// lu (renommage refusé, forme stricte, `confirm_remove` lié à la publication), fusionné par nom de
// colonne et par attribut sur l'en-tête en attente, publié ou vide, puis validé par `parseTableHeader`
// d'E07-S01 ; l'écart entre deux en-têtes et ce qu'on en dit. Fonctions pures, sans base. Sans lui, un
// en-tête ne s'écrirait qu'entier, le piège mesuré chez Oto (une contrainte et 52 notes perdues).
//
// Repris d'Oto (`datastore/effacements.py` l. 1-60) : fusion par clé qui complète les attributs et
// garde l'ordre, colonnes nouvelles à la fin, relevé de ce qui change, « on ne renomme pas : reposer
// sous le nouveau nom ». Retiré : le retrait attribut par attribut (`remove_field_attrs`), les
// sous-champs composites.
import type * as z from "zod/v4"
import {
  COLUMN_NAME_PATTERN,
  COLUMN_TYPES,
  isRecord,
  tableColumnPatchSchema,
  tableHeaderPatchSchema,
  tableLifecycleSchema,
  tableReviewSchema,
  type TableColumn,
  type TableColumnPatch,
  type TableHeader,
  type TableHeaderPatch,
  type TableLifecycle,
} from "../../schemas/tables"
import { boundedList, PlatformError } from "../errors"
import type { NodeRow } from "../nodes/lookup"
import { plural } from "../nodes/op-kit"
import { LENGTH_TYPES, parseTableHeader } from "./header"
import { publishedHeader } from "./meta"

/** Attributs d'un renommage (AC4) : le nouveau nom, sous l'un des trois premiers ; l'ancien, sous `old_name`. */
const RENAMED_TO = ["rename", "new_name", "renamed_to"]
const RENAMED_FROM = "old_name"

/** Les attributs d'une colonne, dans l'ordre où l'écart les nomme (AC12). */
const ATTRIBUTES = ["type", "options", "required", "allow_verified_empty", "max_length", "label"] as const

/** Le renvoi au contrat, en fin des refus d'un en-tête (AC2, AC5). */
function contractHint(prefix: string): string {
  return `Contract: ${prefix}_read {"path": "write.table"}.`
}

/** Refus d'un en-tête (AC2, AC5) : tous ses problèmes, bornés à 20, joints par « ; ». */
function invalidHeader(problems: readonly string[], prefix: string): PlatformError {
  const listed = boundedList(problems.map((problem) => problem.replace(/\.$/, "")), "; ")
  return new PlatformError("invalid_arguments", `Invalid table header: ${listed}. ${contractHint(prefix)}`)
}

/** Refus d'une création de tableau sans `header` (AC2). */
export function missingHeader(prefix: string): PlatformError {
  return new PlatformError("invalid_arguments", `Creating a table needs header {columns, key}: read the contract with ${prefix}_read {"path": "write.table"}.`)
}

/** Un nom de colonne cité par un refus de renommage : le nom donné s'il en a la forme. */
function nameOf(value: unknown, fallback: string): string {
  return typeof value === "string" && COLUMN_NAME_PATTERN.test(value) ? value : fallback
}

/** Refus d'un renommage (AC4), un par colonne qui en porte un attribut. */
function renameRefusals(columns: unknown, prefix: string): string[] {
  return (Array.isArray(columns) ? columns : []).flatMap((column) => {
    if (!isRecord(column)) return []
    const to = RENAMED_TO.map((key) => column[key]).find((value) => value !== undefined)
    const from = column[RENAMED_FROM]
    if (to === undefined && from === undefined) return []
    const name = nameOf(column.name, "the column")
    const [oldName, newName] = to !== undefined ? [name, nameOf(to, "the new name")] : [nameOf(from, "the old column"), name]
    return [`Columns cannot be renamed: add « ${newName} » under the new name, copy the values with ${prefix}_call table.write, then remove « ${oldName} » with header.remove_columns.`]
  })
}

/** « header », « header.columns[1] » : le chemin d'une issue du patch. */
function issuePath(path: readonly PropertyKey[]): string {
  return path.reduce<string>((text, part) => (typeof part === "number" ? `${text}[${part}]` : `${text}.${String(part)}`), "header")
}

/** Les clés permises là où le patch porte une clé inconnue (AC5), dans l'ordre de leur schéma. */
function patchKeys(path: readonly PropertyKey[]): string[] {
  if (path.length === 0) return Object.keys(tableHeaderPatchSchema.shape)
  if (path[0] === "columns") return Object.keys(tableColumnPatchSchema.shape)
  if (path[0] === "lifecycle") return Object.keys(path.length === 1 ? tableLifecycleSchema.shape : tableReviewSchema.shape)
  return []
}

/**
 * Un problème du patch (AC5) ; des clés inconnues : « header: unknown key « order »; keys: columns, … »,
 * 20 citées au plus, puis leur nombre restant : le message de Zod les cite toutes (`mcp-patterns.md § 4`).
 */
function patchProblem(issue: z.core.$ZodIssue): string {
  if (issue.code !== "unrecognized_keys") return `${issuePath(issue.path)}: ${issue.message}`
  const keys = boundedList(issue.keys.map((key) => `« ${key} »`))
  return `${issuePath(issue.path)}: unknown ${plural(issue.keys.length, "key")} ${keys}; keys: ${patchKeys(issue.path).join(", ")}`
}

/**
 * Le patch d'en-tête d'un appel `write` sur un tableau (AC4, AC5), `null` sans `header` : renommage
 * refusé, forme stricte de `tableHeaderPatchSchema`, `confirm_remove` refusé avec `publish: false`
 * (E11-S02). À la création (`created`), le refus de forme a le cadre de l'AC2 (« Invalid table header: …
 * Contract: … », N1). Rien n'est écrit quand il lève.
 */
export function readHeaderPatch(body: { header?: Record<string, unknown>; publish?: boolean }, prefix: string, created = false): TableHeaderPatch | null {
  if (body.header === undefined) return null
  const renamed = renameRefusals(body.header.columns, prefix)
  if (renamed.length > 0) throw new PlatformError("invalid_arguments", boundedList(renamed, " "))
  const parsed = tableHeaderPatchSchema.safeParse(body.header)
  if (!parsed.success) {
    const problems = parsed.error.issues.map(patchProblem)
    throw created ? invalidHeader(problems, prefix) : new PlatformError("invalid_arguments", boundedList(problems, "; "))
  }
  // `write` publie par défaut (E11-S02) : seul `publish: false` exclut la confirmation.
  if (parsed.data.confirm_remove !== undefined && body.publish === false) {
    throw new PlatformError("invalid_arguments", "confirm_remove only applies when the write publishes: remove publish: false.")
  }
  return parsed.data
}

/** Le patch change l'en-tête : une clé autre que `confirm_remove`, jamais enregistré (n° 10). */
export function changesHeader(patch: TableHeaderPatch | null | undefined): boolean {
  return Boolean(patch) && Object.keys(patch ?? {}).some((key) => key !== "confirm_remove")
}

/** Une colonne existante qui reçoit les attributs fournis ; un type changé laisse ceux qu'il ne prend pas, sauf s'ils sont redonnés. */
function mergedColumn(column: TableColumn, change: TableColumnPatch): TableColumn {
  const merged: TableColumn = { ...column, ...change }
  if (change.type === undefined || change.type === column.type) return merged
  if (change.type !== "enum" && change.options === undefined) delete merged.options
  if (!LENGTH_TYPES.includes(change.type) && change.max_length === undefined) delete merged.max_length
  return merged
}

/** `pending` : `base` est l'en-tête en attente du brouillon, que le refus d'un retrait nomme. */
type Merge = { base: TableHeader | null; patch: TableHeaderPatch; path: string; pending?: boolean }

/**
 * Les retraits possibles et les problèmes des autres (AC5) : un nom aussi dans `columns`, la clé, un
 * nom absent (tous les absents en une phrase, les colonnes citées une fois : le refus reste borné).
 */
function removals(names: readonly string[], request: Merge & { key: string | undefined }): { removed: Set<string>; problems: string[] } {
  const { patch, key, path } = request
  const patched = new Set((patch.columns ?? []).map((column) => column.name))
  const problems: string[] = []
  const absent = new Set<string>()
  const removed = new Set<string>()
  for (const name of patch.remove_columns ?? []) {
    if (patched.has(name)) problems.push(`« ${name} » is both in columns and remove_columns`)
    else if (!names.includes(name)) absent.add(name)
    else if (name === key) problems.push(`remove_columns: « ${name} » is the key of ${path}; a key column cannot be removed`)
    else removed.add(name)
  }
  if (absent.size > 0) {
    const listed = boundedList([...absent].map((name) => `« ${name} »`))
    // Un retrait déjà en attente : la colonne est encore publiée, le refus dit d'où il part.
    const of = request.pending ? `the pending header of ${path} (read it with draft: true)` : path
    problems.push(`remove_columns: ${listed} ${absent.size === 1 ? "is not a column" : "are not columns"} of ${of}. Columns: ${names.join(", ") || "none"}`)
  }
  return { removed, problems }
}

/**
 * L'en-tête fusionné (AC3, AC5) et les problèmes de la fusion : un retrait impossible (colonne absente,
 * clé, colonne aussi dans `columns`), une colonne nommée deux fois dans `columns` et une colonne
 * nouvelle sans type restent hors de l'en-tête, que `parseTableHeader` contrôle ensuite.
 */
function merge(request: Merge): { candidate: Record<string, unknown>; problems: string[] } {
  const { base, patch } = request
  const columns = (base?.columns ?? []).map((column) => ({ ...column }))
  const key = patch.key ?? base?.key
  const { removed, problems } = removals(
    columns.map((column) => column.name),
    { ...request, key },
  )
  const given = new Set<string>()
  for (const [rank, change] of (patch.columns ?? []).entries()) {
    const index = columns.findIndex((column) => column.name === change.name)
    const { type } = change
    if (given.has(change.name)) problems.push(`columns[${rank}].name: duplicate column ${change.name}`)
    else if (index >= 0) columns[index] = mergedColumn(columns[index], change)
    else if (type === undefined) problems.push(`columns: « ${change.name} » is a new column: give its type (${COLUMN_TYPES.join(", ")})`)
    else columns.push({ ...change, type })
    given.add(change.name)
  }
  const lifecycle = patch.lifecycle ?? base?.lifecycle
  const candidate = {
    columns: columns.filter((column) => !removed.has(column.name)),
    ...(key === undefined ? {} : { key }),
    ...(lifecycle === undefined ? {} : { lifecycle }),
    closed: patch.closed ?? base?.closed ?? false,
    proof: patch.proof ?? base?.proof ?? false,
  }
  return { candidate, problems }
}

/**
 * L'en-tête cible (AC2, AC3, AC5) : `patch` fusionné sur `base` (en attente, sinon publié, sinon vide
 * à la création), validé par `parseTableHeader` ; sinon `invalid_arguments` avec tous les problèmes,
 * ceux de la fusion d'abord.
 */
export function targetHeader(input: Merge & { prefix: string }): TableHeader {
  const { candidate, problems } = merge(input)
  const parsed = parseTableHeader(candidate)
  const all = [...problems, ...("problems" in parsed ? parsed.problems : [])]
  if (all.length > 0 || !("header" in parsed)) throw invalidHeader(all, input.prefix)
  return parsed.header
}

/**
 * Un en-tête rangé dans `node_drafts.meta` (validé à chaque écriture, H91) ; invalide (semé par la clé
 * service) → `internal`, le problème au log, comme un en-tête publié (E07-S01 N13).
 */
export function draftHeader(path: string, meta: Record<string, unknown>): TableHeader {
  const parsed = parseTableHeader(meta)
  if ("header" in parsed) return parsed.header
  console.error(`[platform] tables: invalid pending header of ${path}:`, boundedList(parsed.problems, "; "))
  throw new PlatformError("internal", "Internal error.")
}

/** L'en-tête publié d'un tableau, `null` s'il n'en a jamais publié (E07-S01). */
export function publishedOrNull(node: NodeRow): TableHeader | null {
  const published = publishedHeader(node)
  return "header" in published ? published.header : null
}

/** L'en-tête d'où part une écriture : celui du brouillon, sinon le publié, sinon aucun (AC3). */
export function currentHeader(node: NodeRow, meta: Record<string, unknown> | null): TableHeader | null {
  return meta ? draftHeader(node.path, meta) : publishedOrNull(node)
}

// ------------------------------------------------------------------------------------ Écart (AC12)

export type ColumnChange = { name: string; before: TableColumn; after: TableColumn; attributes: string[] }

/** Ce qu'un en-tête change à un autre ; `closed` et `proof` : la nouvelle valeur, `null` si inchangée. */
export type HeaderDiff = {
  added: TableColumn[]
  removed: TableColumn[]
  changed: ColumnChange[]
  key: { before: string | null; after: string } | null
  lifecycle: { before: TableLifecycle | null; after: TableLifecycle | null } | null
  closed: boolean | null
  proof: boolean | null
}

/** Un attribut comparé : `required` absent vaut `false`, `allow_verified_empty` absent vaut `true`. */
function attributeValue(column: TableColumn, attribute: (typeof ATTRIBUTES)[number]): string {
  if (attribute === "required") return JSON.stringify(column.required === true)
  if (attribute === "allow_verified_empty") return JSON.stringify(column.allow_verified_empty !== false)
  return JSON.stringify(column[attribute] ?? null)
}

/**
 * L'écart de `before` (publié, ou `null` pour aucun) à `after` : colonnes ajoutées (dans l'ordre de
 * `after`), retirées, changées attribut par attribut ; clé, cycle de vie (comparé entier, H91),
 * fermeture. Les deux en-têtes sortent de `parseTableHeader` : mêmes clés, dans le même ordre.
 */
export function diffTableHeaders(before: TableHeader | null, after: TableHeader): HeaderDiff {
  const previous = new Map((before?.columns ?? []).map((column) => [column.name, column]))
  const kept = new Set(after.columns.map((column) => column.name))
  const lifecycle = { before: before?.lifecycle ?? null, after: after.lifecycle ?? null }
  return {
    added: after.columns.filter((column) => !previous.has(column.name)),
    removed: (before?.columns ?? []).filter((column) => !kept.has(column.name)),
    changed: after.columns.flatMap((column) => {
      const old = previous.get(column.name)
      const attributes = old ? ATTRIBUTES.filter((attribute) => attributeValue(old, attribute) !== attributeValue(column, attribute)) : []
      return old && attributes.length > 0 ? [{ name: column.name, before: old, after: column, attributes }] : []
    }),
    key: before?.key === after.key ? null : { before: before?.key ?? null, after: after.key },
    lifecycle: JSON.stringify(lifecycle.before) === JSON.stringify(lifecycle.after) ? null : lifecycle,
    closed: (before?.closed ?? false) === after.closed ? null : after.closed,
    proof: (before?.proof ?? false) === after.proof ? null : after.proof,
  }
}

/** Les changements d'un écart, à l'impératif (AC3 sans attributs, AC12 avec) : « add telephone; change email (max_length) ». */
function changeList(diff: HeaderDiff, attributes: boolean): string[] {
  return [
    ...diff.added.map((column) => `add ${column.name}`),
    ...diff.changed.map((change) => (attributes ? `change ${change.name} (${change.attributes.join(", ")})` : `change ${change.name}`)),
    ...diff.removed.map((column) => `remove ${column.name}`),
    ...(diff.key ? [`set key ${diff.key.after}`] : []),
    ...(diff.lifecycle ? [diff.lifecycle.before ? "replace lifecycle" : "set lifecycle"] : []),
    ...(diff.closed === null ? [] : [diff.closed ? "close" : "reopen"]),
    ...(diff.proof === null ? [] : [diff.proof ? "require proof" : "stop requiring proof"]),
  ]
}

/** « a table with 4 columns, key nom » : un en-tête sans état précédent. */
export function headerShape(header: TableHeader): string {
  return `${header.columns.length} ${plural(header.columns.length, "column")}, key ${header.key}`
}

/** Ce qu'une écriture change à l'en-tête d'où elle part (AC3) : « header changed (add telephone; change entreprise) ». */
export function headerChangeText(base: TableHeader | null, target: TableHeader): string {
  if (!base) return `header with ${headerShape(target)}`
  const changes = changeList(diffTableHeaders(base, target), false)
  return changes.length > 0 ? `header changed (${changes.join("; ")})` : "header unchanged"
}

/**
 * L'en-tête que `read {draft: true}` décrit (AC12) et la ligne des changements en attente : celui du
 * brouillon (`node_drafts.meta`), comparé au publié ; sans en-tête en attente, le publié.
 */
export function pendingHeaderChanges(node: NodeRow, draft: { meta: Record<string, unknown> | null; baseRevision: number }): { header: TableHeader | null; line: string } {
  const published = publishedOrNull(node)
  if (!draft.meta) return { header: published, line: "no pending header changes." }
  const header = draftHeader(node.path, draft.meta)
  const changes = changeList(diffTableHeaders(published, header), true)
  return { header, line: changes.length > 0 ? `pending header changes (from revision ${draft.baseRevision}): ${changes.join("; ")}.` : "no pending header changes." }
}
