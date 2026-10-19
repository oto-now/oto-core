// Les jetons d'un chemin et des arguments d'une fonction, résolus avant le service (`pseudonymisation.md` § Les jetons
// dans les arguments). Un chemin reçu essaie les formes en chemin de ses entités contre les nœuds et les anciens chemins
// de l'organisation ; le premier qui existe l'emporte, sinon la forme `prenoms_nom` (une page à créer). Les arguments
// d'une fonction suivent son origine : connecteur, tout jeton refusé ; ERP, ses arguments d'entité en identifiants ;
// native, ses arguments de chemin résolus. Sans ce module, un chemin servi avec un jeton ne se relirait pas.
import type { CatalogFunction } from "../catalog/define"
import type { PlatformDb } from "../db"
import { inTransaction, PlatformError } from "../errors"
import type { Identity } from "../identity"
import { isRecord } from "../../schemas/tables"
import { checkTokens, designatedText, hasToken, pathCandidates, refuseTokens, withEntityIds } from "./arguments"
import type { Dictionary } from "./dictionary"
import { pseudonymizedText } from "./gate"

/** Ce que la résolution lit : la base, sous l'appelant, et le dictionnaire de son organisation. */
export type TokenInputs = { db: PlatformDb; identity: Identity; dictionary: Dictionary }

/** Les arguments de chemin des fonctions natives, au premier niveau (`table.rows`, `node.move`…). */
const PATH_ARGUMENTS: readonly string[] = ["path", "table", "new_path", "parent", "after"]
/** Les listes d'éléments qui portent chacun un `path` (`write_many`, transfert d'un arbre). */
const PATH_LISTS: readonly string[] = ["pages", "roots"]

/** Le chemin en clair d'un chemin reçu ; sans jeton, tel quel. */
export async function resolvedPath(inputs: TokenInputs, path: string): Promise<string> {
  if (!hasToken(path)) return path
  const candidates = pathCandidates(inputs.dictionary, path)
  if (candidates.length === 0) throw new PlatformError("not_found", `Nothing at ${path}: no path of this workspace gives it.`)
  if (candidates.length === 1) return candidates[0]
  const org = inputs.identity.org.id
  const rows = await inTransaction(inputs.db, "pseudonym: paths", (sql) => sql<{ path: string }[]>`
    select path from platform.nodes where org_id = ${org} and path = any(${candidates})
    union select old_path as path from platform.node_aliases where org_id = ${org} and old_path = any(${candidates})`)
  const existing = new Set(rows.map((row) => row.path))
  return candidates.find((candidate) => existing.has(candidate)) ?? candidates[0]
}

async function resolvedItemPath(inputs: TokenInputs, item: unknown): Promise<unknown> {
  if (typeof item !== "object" || item === null || Array.isArray(item)) return item
  const record = item as Record<string, unknown>
  return typeof record.path === "string" ? { ...record, path: await resolvedPath(inputs, record.path) } : item
}

/** Les clés de ligne qu'un appel à un tableau porte : `key`, `keys`, `rows[].key`. */
function rowKeysOf(args: Record<string, unknown>): unknown[] {
  const rows = Array.isArray(args.rows) ? args.rows.map((row) => (isRecord(row) ? row.key : undefined)) : []
  return [args.key, ...(Array.isArray(args.keys) ? args.keys : []), ...rows]
}

/**
 * Les clés de ligne d'un tableau (`table.release`, `table.delete_rows`, `table.write`) qui portent un jeton : chacune
 * devient la clé en clair d'une ligne du tableau dont la forme pseudonymisée est la clé reçue ; sans telle ligne, elle
 * reste telle quelle (une ligne neuve de `table.write` garde le jeton, comme tout contenu écrit). Les clés du tableau se
 * lisent sous l'appelant, une fois, seulement quand une clé porte un jeton.
 */
async function resolvedRowKeys(inputs: TokenInputs, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const table = args.table
  if (typeof table !== "string" || !rowKeysOf(args).some((key) => typeof key === "string" && hasToken(key))) return args
  const org = inputs.identity.org.id
  const rows = await inTransaction(inputs.db, "pseudonym: row keys", (sql) => sql<{ key: string }[]>`
    select b.key from platform.blocks b join platform.nodes n on n.id = b.node_id
     where n.org_id = ${org} and n.path = ${table} and b.state = 'published' and b.type = 'row' and b.key is not null`)
  const byMasked = new Map<string, string>()
  for (const { key } of rows) {
    const masked = pseudonymizedText(inputs.dictionary, key)
    if (masked !== key && !byMasked.has(masked)) byMasked.set(masked, key)
  }
  const clear = (key: unknown): unknown => (typeof key === "string" ? (byMasked.get(key) ?? key) : key)
  const out = { ...args }
  if ("key" in out) out.key = clear(out.key)
  if (Array.isArray(out.keys)) out.keys = out.keys.map(clear)
  if (Array.isArray(out.rows)) out.rows = out.rows.map((row) => (isRecord(row) && "key" in row ? { ...row, key: clear(row.key) } : row))
  return out
}

/**
 * Les arguments d'une fonction native : ses chemins résolus, la requête `q` d'un tableau désignée (« prénoms nom »), ses
 * clés de ligne rendues en clair ; ailleurs (cellules, filtres), un jeton connu est gardé tel quel : un filtre se compare
 * dans l'espace pseudonymisé (`FunctionContext.pseudonymized`).
 */
async function nativeArguments(inputs: TokenInputs, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const out = { ...args }
  if (typeof out.q === "string") out.q = designatedText(inputs.dictionary, out.q)
  for (const key of PATH_ARGUMENTS) {
    const value = out[key]
    if (typeof value === "string") out[key] = await resolvedPath(inputs, value)
  }
  for (const key of PATH_LISTS) {
    const list = out[key]
    if (Array.isArray(list)) out[key] = await Promise.all(list.map((item) => resolvedItemPath(inputs, item)))
  }
  checkTokens(inputs.dictionary, out, "content")
  return resolvedRowKeys(inputs, out)
}

/** Les arguments d'un `call` de l'assistant, leurs jetons résolus selon l'origine de la fonction. */
export async function resolvedCallArguments(
  inputs: TokenInputs,
  fn: Pick<CatalogFunction, "name" | "origin" | "entityArguments">,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (fn.origin === "connecteur") {
    refuseTokens(inputs.dictionary, fn.name, args)
    return args
  }
  if (fn.origin === "erp") return withEntityIds(inputs.dictionary, args, fn.entityArguments ?? {})
  return nativeArguments(inputs, args)
}
