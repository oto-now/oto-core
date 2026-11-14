// Les niveaux d'accès d'un connecteur décrit (`connecteurs-et-comptes.md` § Compte de service ; `connectors :
// docs/conception/niveaux-d-acces.md`) : `accessLevels` (un nom, ses droits ; `full` exigé, qui ne filtre rien) et
// `scopeImplies` (un droit et ceux qu'il couvre), communs au consentement d'une personne et au compte de service. Lus à
// la déclaration ; à l'appel, une fonction dont un droit n'est ni un droit du niveau ni couvert par l'un d'eux est
// refusée avant tout envoi (`access_level_denied`). Sans ce module, chaque authentification relirait les niveaux à sa
// façon, et une fonction d'écriture partirait sous un compte en lecture.
import { PlatformError } from "../errors"
import { isJsonObject } from "../json"

/** Le niveau qui ne filtre rien, exigé de tout connecteur à niveaux. */
export const FULL_LEVEL = "full"

/** Un scope n'a ni espace ni guillemet (RFC 6749 § 3.3). */
const SCOPE = /^[\x21\x23-\x5B\x5D-\x7E]+$/
const LEVEL_NAME = /^[a-z][a-z0-9_]{0,39}$/

/** Une liste de scopes sans espace ; `nonEmpty` : au moins un. */
export const isScopeList = (value: unknown, nonEmpty: boolean): value is string[] =>
  Array.isArray(value) && (!nonEmpty || value.length > 0) && value.every((scope) => typeof scope === "string" && SCOPE.test(scope))

/** Les niveaux déclarés, par nom (`full` compris), et ce que couvre chaque droit (vide sans `scopeImplies`). */
export type AccessLevels = { levels: Record<string, string[]>; implies: Record<string, string[]> }

/**
 * Les niveaux d'une authentification qui déclare `accessLevels`, ou le problème : `scopes` les exclut, `full` exigé,
 * chaque nom en minuscules ASCII avec ses droits (liste non vide), `scopeImplies` un droit vers la liste qu'il couvre.
 */
export function readAccessLevels(head: string, auth: Record<string, unknown>): AccessLevels | string {
  const { scopes, accessLevels, scopeImplies } = auth
  if (scopes !== undefined) return `${head}: scopes and accessLevels exclude each other; a connector with access levels asks the scopes of a level.`
  if (!isJsonObject(accessLevels) || !isJsonObject(accessLevels[FULL_LEVEL])) return `${head}: accessLevels needs the level full.`
  const levels: Record<string, string[]> = {}
  for (const [name, level] of Object.entries(accessLevels)) {
    if (!LEVEL_NAME.test(name) || !isJsonObject(level) || !isScopeList(level.scopes, true)) {
      return `${head}: access level ${JSON.stringify(name)} needs a name in lowercase ASCII letters, digits and _, and a non-empty list of scopes without spaces.`
    }
    levels[name] = [...level.scopes]
  }
  const implies = scopeImplies ?? {}
  if (!isJsonObject(implies) || Object.entries(implies).some(([scope, implied]) => !SCOPE.test(scope) || !isScopeList(implied, true))) {
    return `${head}: scopeImplies must map a scope to the non-empty list of scopes it covers.`
  }
  return { levels, implies: Object.fromEntries(Object.entries(implies).map(([scope, implied]) => [scope, [...(implied as string[])]])) }
}

/** Les niveaux gardés par une authentification préparée ; `null` : sans niveaux. */
export const declaredLevels = (auth: { accessLevels: Record<string, string[]> | null; scopeImplies: Record<string, string[]> }): AccessLevels | null =>
  auth.accessLevels === null ? null : { levels: auth.accessLevels, implies: auth.scopeImplies }

/** Les droits d'un niveau et ceux qu'ils couvrent (`scopeImplies`, d'un seul pas : la table dit tout). */
function coveredScopes(declared: AccessLevels, level: string): Set<string> {
  const own = declared.levels[level] ?? []
  return new Set([...own, ...own.flatMap((scope) => declared.implies[scope] ?? [])])
}

/** Vrai si chaque droit exigé est un droit du niveau, ou couvert par l'un d'eux. */
const grants = (declared: AccessLevels, level: string, needs: readonly string[]): boolean => {
  const covered = coveredScopes(declared, level)
  return needs.every((scope) => covered.has(scope))
}

/**
 * Le problème des droits exigés d'une fonction (`scopes`) : exigés dans un connecteur à niveaux d'accès, refusés
 * ailleurs, et couverts par au moins un niveau déclaré (une fonction qu'aucun niveau n'accorde ne servirait jamais).
 */
export function functionScopesProblem(fn: { name: string; scopes?: readonly string[] }, declared: AccessLevels | null): string | null {
  if (declared === null) return fn.scopes === undefined ? null : `${fn.name}: scopes need the connector's accessLevels.`
  if (!isScopeList(fn.scopes, true)) return `${fn.name}: scopes must list the scopes the function needs, in a connector with access levels.`
  const needs = fn.scopes
  return Object.keys(declared.levels).some((level) => grants(declared, level, needs))
    ? null
    : `${fn.name}: no access level grants its scopes (${needs.join(", ")}), directly or through scopeImplies.`
}

/**
 * Le niveau d'un appel : celui du compte (`requested`), sinon `fallback` (le niveau par défaut de la description). Un
 * niveau que la description ne déclare pas est une erreur de câblage de l'hôte : rien n'est envoyé, jamais un autre
 * niveau à sa place.
 */
export function resolveLevel(connector: string, declared: AccessLevels | null, requested: string | undefined, fallback: string): string | null {
  if (declared === null) {
    if (requested === undefined || requested === FULL_LEVEL) return null
    console.error(`[platform] connector ${connector}: access level ${JSON.stringify(requested)} given, but the connector declares no access levels`)
    throw new PlatformError("internal", "Internal error.")
  }
  const level = requested ?? fallback
  if (!(level in declared.levels)) {
    console.error(`[platform] connector ${connector}: access level ${JSON.stringify(level)} is not declared (it declares ${Object.keys(declared.levels).sort().join(", ")})`)
    throw new PlatformError("internal", "Internal error.")
  }
  return level
}

/**
 * Refuse, avant tout envoi, une fonction que le niveau n'accorde pas : `not_enabled`, nommé `access_level_denied` dans
 * `details.refusal`, qui dit le niveau et les droits qu'il faudrait. `full`, ou un connecteur sans niveaux, ne refuse
 * rien.
 */
export function refuseUnserved(label: string, fn: { name: string; scopes?: readonly string[] }, declared: AccessLevels | null, level: string | null): void {
  if (declared === null || level === null || level === FULL_LEVEL) return
  const needs = fn.scopes ?? []
  if (grants(declared, level, needs)) return
  throw new PlatformError(
    "not_enabled",
    `${label}: ${fn.name} is not allowed at the access level « ${level} » of this account; it needs a level that grants ${needs.join(", ")}.`,
    { refusal: "access_level_denied", level },
  )
}
