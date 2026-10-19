// Les jetons d'un chemin et des arguments d'une fonction, résolus avant le service (`pseudonymisation.md` § Les jetons
// dans les arguments). Un chemin reçu essaie les formes en chemin de ses entités contre les nœuds et les anciens chemins
// de l'organisation ; le premier qui existe l'emporte, sinon la forme `prenoms_nom` (une page à créer). Les arguments
// d'une fonction suivent son origine : connecteur, tout jeton refusé ; ERP, ses arguments d'entité en identifiants ;
// native, ses arguments de chemin résolus. Sans ce module, un chemin servi avec un jeton ne se relirait pas.
import type { CatalogFunction } from "../catalog/define"
import type { PlatformDb } from "../db"
import { inTransaction, PlatformError } from "../errors"
import type { Identity } from "../identity"
import { checkTokens, hasToken, pathCandidates, refuseTokens, withEntityIds } from "./arguments"
import type { Dictionary } from "./dictionary"

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

/** Les arguments d'une fonction native, ses chemins résolus ; ailleurs, un jeton connu est un contenu, gardé tel quel. */
async function nativeArguments(inputs: TokenInputs, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const out = { ...args }
  for (const key of PATH_ARGUMENTS) {
    const value = out[key]
    if (typeof value === "string") out[key] = await resolvedPath(inputs, value)
  }
  for (const key of PATH_LISTS) {
    const list = out[key]
    if (Array.isArray(list)) out[key] = await Promise.all(list.map((item) => resolvedItemPath(inputs, item)))
  }
  checkTokens(inputs.dictionary, out, "content")
  return out
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
