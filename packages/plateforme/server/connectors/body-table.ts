// Le corps emboîté d'une fonction décrite (`connecteurs-et-comptes.md` § Moteur des connecteurs décrits ; `connectors :
// docs/conception/format-de-description.md` § Le corps emboîté, décidé par Alexis le 2026-10-26) : dans un corps en
// table, la valeur d'une clé est un argument ou une table de même forme, à toute profondeur ; le moteur part de la
// constante du corps et pose chaque argument donné à son chemin, les objets parents créés au besoin ; et sa
// déclaration contrôlée comme la règle 22 de la fabrique, avec ses codes. Sans ce module, un tiers qui prend ses
// arguments sous une clé (une enveloppe `data`, les `variables` d'une requête GraphQL) ne se décrirait pas.
import { PlatformError } from "../errors"
import { isJsonObject } from "../json"
import { bodyTable } from "./body-argument"
import type { ConnectorBodyMap, ConnectorFunctionDefinition, ConnectorRequest } from "./definition"

/** Les entrées d'une table de corps, à toute profondeur : le chemin des clés côté API et l'argument, dans l'ordre. */
export function bodyEntries(table: ConnectorBodyMap, at: readonly string[] = []): [string[], string][] {
  return Object.entries(table).flatMap(([key, value]): [string[], string][] =>
    typeof value === "string" ? [[[...at, key], value]] : isJsonObject(value) ? bodyEntries(value, [...at, key]) : [],
  )
}

/** Les arguments que place le corps en table, à toute profondeur ; aucun pour un corps entier (`body-argument.ts`). */
export function bodyArguments(spec: ConnectorRequest): string[] {
  return bodyEntries(bodyTable(spec)).map(([, argument]) => argument)
}

/** Une table de corps bien formée : chaque valeur est un nom d'argument (un texte) ou une table de même forme. */
export function bodyTableShaped(table: unknown): boolean {
  return isJsonObject(table) && Object.values(table).every((value) => typeof value === "string" || bodyTableShaped(value))
}

/** Le chemin de la première table emboîtée vide, ou `null`. */
function emptyTable(table: ConnectorBodyMap, at: readonly string[]): string[] | null {
  for (const [key, value] of Object.entries(table)) {
    if (typeof value === "string") continue
    const found = Object.keys(value).length === 0 ? [...at, key] : emptyTable(value, [...at, key])
    if (found !== null) return found
  }
  return null
}

/**
 * Le premier chemin où la table et la constante du corps se rencontrent autrement que par deux objets : un argument là
 * où la constante a une valeur, ou une table emboîtée sous une constante qui n'est pas un objet ; `null` sinon.
 */
function clash(table: ConnectorBodyMap, constant: unknown, at: readonly string[]): string[] | null {
  if (!isJsonObject(constant)) return null
  for (const [key, value] of Object.entries(table)) {
    if (!Object.hasOwn(constant, key)) continue
    if (typeof value === "string" || !isJsonObject(constant[key])) return [...at, key]
    const found = clash(value, constant[key], [...at, key])
    if (found !== null) return found
  }
  return null
}

/**
 * Le problème d'un corps en table, comme la règle 22 de la fabrique et dans son ordre, le message finissant par son
 * code ; `null` : aucun, ou un corps entier. Une table emboîtée porte une entrée au moins ; la table et la constante du
 * corps ne se rejoignent que par des objets, au premier niveau comme au-dessous ; un corps multipart n'en a pas.
 */
export function bodyTableProblem(fn: ConnectorFunctionDefinition): string | null {
  const spec = fn.request
  if (typeof spec.body === "string") return null
  const at = (path: readonly string[]) => `${fn.name}: request.body ${path.join(".")}`
  const empty = emptyTable(spec.body, [])
  if (empty !== null) return `${at(empty)} is a nested table without any entry: it places nothing (body_nested_empty).`
  const twice = clash(spec.body, spec.constants?.body, [])
  if (twice !== null) {
    return `${at(twice)} is both a body constant and an argument, or one is under the other: they meet only through objects (body_key_twice).`
  }
  const nested = spec.files === undefined ? undefined : bodyEntries(spec.body).find(([path]) => path.length > 1)
  if (nested !== undefined) {
    return `${at(nested[0])} is nested in a multipart body, whose parts are texts: a file part rules out a nested table (body_nested_multipart).`
  }
  return null
}

/**
 * Le corps JSON d'une table : la constante du corps, copiée (la définition reste intacte), puis chaque argument donné
 * (`placed`, `encode` appliqué) à son chemin, les objets parents créés au besoin ; un argument absent ne crée rien, un
 * `null` part `null`. La déclaration garantit qu'un parent déjà posé par la constante est un objet (`bodyTableProblem`) :
 * le contraire est un câblage fautif, jamais une constante remplacée en silence.
 */
export function tableBody(
  spec: ConnectorRequest,
  args: Record<string, unknown>,
  placed: (argument: string) => unknown,
): Record<string, unknown> {
  const body = structuredClone(spec.constants?.body ?? {}) as Record<string, unknown>
  for (const [path, argument] of bodyEntries(bodyTable(spec))) {
    if (args[argument] === undefined) continue
    let parent = body
    for (const key of path.slice(0, -1)) {
      parent[key] ??= {}
      const next = parent[key]
      if (!isJsonObject(next)) {
        console.error(`[platform] request body: ${path.join(".")} lies under a constant that is not an object`)
        throw new PlatformError("internal", "Internal error.")
      }
      parent = next
    }
    parent[path[path.length - 1]] = placed(argument)
  }
  return body
}
