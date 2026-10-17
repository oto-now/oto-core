// Erreurs nommées des services (H04) : une liste fermée de codes, un statut HTTP par code. Sans ce
// module, chaque porte (écrans, API, MCP) inventerait sa forme d'erreur, et une panne ne se
// distinguerait plus d'un refus à montrer.
import type { PlatformDb } from "./db"
import type { Tx } from "./sql"

export const PLATFORM_ERROR_CODES = [
  "not_found",
  "forbidden",
  // Jeton refusé par la base après la vérification de la porte (M10) ; le refus de la porte
  // elle-même reste `forbidden` au statut 401 (P36).
  "unauthorized",
  "invalid_arguments",
  "stale_revision",
  "ctx_missing",
  "ctx_stale",
  "not_member",
  "unknown_org",
  "not_enabled",
  "ambiguous_team",
  "ambiguous_account",
  "needs_confirmation",
  "unavailable_in_v1",
  "too_large",
  "conflict",
  "internal",
  // Le tiers d'un connecteur limite le débit (429) : réessayer plus tard.
  "rate_limited",
  // Le tiers d'un connecteur refuse l'appel, tombe ou répond hors de sa table d'erreurs.
  "upstream_error",
  // Le tiers d'un connecteur refuse la clé du compte, selon sa description (`marksAccount`) : le compte est marqué
  // jusqu'au premier appel réussi ; à qui gère le compte d'en poser une neuve.
  "credential_rejected",
  // Le tiers d'un connecteur dit les crédits du compte épuisés, selon sa description (`marksAccount`) : le compte est
  // marqué jusqu'au premier appel réussi ; à qui gère le compte d'en racheter.
  "quota_exhausted",
] as const

export type PlatformErrorCode = (typeof PLATFORM_ERROR_CODES)[number]

export const HTTP_STATUS: Record<PlatformErrorCode, number> = {
  not_found: 404,
  forbidden: 403,
  unauthorized: 401,
  invalid_arguments: 400,
  stale_revision: 409,
  ctx_missing: 400,
  ctx_stale: 409,
  not_member: 403,
  unknown_org: 404,
  not_enabled: 403,
  ambiguous_team: 409,
  ambiguous_account: 409,
  needs_confirmation: 409,
  unavailable_in_v1: 501,
  too_large: 413,
  conflict: 409,
  internal: 500,
  rate_limited: 429,
  upstream_error: 502,
  credential_rejected: 502,
  quota_exhausted: 502,
}

/** Précisions lisibles par une porte : `reason`, `revision`, `refusals`… jamais un message de la base. */
type PlatformErrorDetails = Record<string, unknown>

/** Refus ou panne nommée d'un service. Le message est en anglais ; `ui/` traduit le code. */
export class PlatformError extends Error {
  readonly code: PlatformErrorCode
  readonly details?: PlatformErrorDetails

  constructor(code: PlatformErrorCode, message: string, details?: PlatformErrorDetails) {
    super(message)
    this.name = "PlatformError"
    this.code = code
    this.details = details
  }
}

export function isPlatformError(error: unknown): error is PlatformError {
  return error instanceof PlatformError
}

/**
 * Éléments nommés au plus dans un refus bâti sur une liste (E03-S01 N30) : de quoi corriger ou
 * choisir. Sans borne, 1 000 opérations fausses faisaient un refus de 117 922 caractères, que
 * Claude Code ne transmet pas au modèle (mcp-patterns.md § 4).
 */
const MAX_LISTED = 20

/** Les 20 premiers éléments, puis leur nombre restant : « a, b, … and 980 more » ; `""` sans élément. */
export function boundedList(items: readonly string[], separator = ", "): string {
  const shown = items.slice(0, MAX_LISTED)
  const more = items.length - shown.length
  return [...shown, ...(more > 0 ? [`… and ${more} more`] : [])].join(separator)
}

/** Problème d'une saisie refusée : forme structurelle de ceux de Zod, ce module n'en dépend pas. */
type InputIssue = { path: readonly PropertyKey[]; message: string }

/** Problèmes chemin par chemin, bornés : « label: Too small…; team_id: …; … and 3 more ». */
export function issuesText(issues: readonly InputIssue[]): string {
  return boundedList(
    issues.map((issue) => `${issue.path.map(String).join(".") || "(root)"}: ${issue.message}`),
    "; ",
  )
}

/**
 * Refus `invalid_arguments` d'une saisie que son schéma Zod refuse (`parsed.error`), chaque problème
 * nommé par son chemin (N28). Même signature que celle d'E05-S03, qui n'en nomme qu'un (N34).
 */
export function invalidInput(error: { issues: readonly InputIssue[] }): PlatformError {
  return new PlatformError("invalid_arguments", `Invalid arguments: ${issuesText(error.issues)}.`)
}

/** Violation d'unicité : un doublon à dire (`conflict`), ou une clé tirée au hasard à retirer. */
const UNIQUE_VIOLATION = "23505"

export function isUniqueViolation(error: { code?: string } | null | undefined): boolean {
  return error?.code === UNIQUE_VIOLATION
}

/**
 * Nom de la contrainte d'unicité d'une violation `23505` (E08-S02, N24), `null` sinon : PostgREST
 * rend le message de Postgres, « duplicate key value violates unique constraint "orgs_slug_key" ».
 * Seul lieu de cette hypothèse sur la forme d'une erreur (`supabase-patterns.md § Couplage à
 * Supabase`) ; le message lui-même ne sort jamais d'un service.
 */
export function uniqueConstraint(error: { code?: string; message?: string } | null | undefined): string | null {
  if (!isUniqueViolation(error)) return null
  return /unique constraint "([^"]+)"/.exec(error?.message ?? "")?.[1] ?? null
}

// Messages constants : jamais le texte de la base.
const FROM_DATABASE: Record<string, [PlatformErrorCode, string]> = {
  // Jeton que PostgREST refuse (HTTP 401) après que la porte l'a accepté (M10) : expiré pendant la
  // requête (`PGRST301`, « JWT expired » ; PostgREST 14 tolère 30 s d'écart sur `exp`, `iat`, `nbf`)
  // ou claims refusées (`PGRST303`, un `iat` à venir quand les horloges divergent). Une session à
  // reprendre, jamais une panne : la requête suivante porte un jeton rafraîchi. Depuis E01-S10 f2, le paquet
  // ne lit plus rien par PostgREST : les codes `PGRST…` ne viennent plus que de la base d'un ERP, qu'une
  // fonction ERP de l'hôte lit sous `ctx.accessToken` et traduit par ce même `fromDatabaseError` (E08-S05,
  // README du paquet, « Erreurs ») ; ils restent pour elle (M47).
  PGRST301: ["unauthorized", "The session token was refused. Retry the request."],
  PGRST303: ["unauthorized", "The session token was refused. Retry the request."],
  "42501": ["forbidden", "You are not allowed to do this."],
  [UNIQUE_VIOLATION]: ["conflict", "This conflicts with the current state."],
  "23503": ["invalid_arguments", "Some values are invalid."],
  "22023": ["invalid_arguments", "Some values are invalid."],
  "23514": ["invalid_arguments", "Some values are invalid."],
  PGRST116: ["not_found", "Not found."],
  // Un conflit de révision ou de brouillon : PostgREST rend 409 avec ce code, sans rejouer (E01-S06
  // N36, E03-S03 N48) ; le service qui l'attend compose le texte de son refus sur `stale_revision`.
  PT409: ["stale_revision", "The content changed meanwhile. Read it again, then retry."],
}

/**
 * Traduit une erreur PostgREST ou Postgres en `PlatformError`. Une `PostgresError` du pilote (face
 * SQL, E01-S10) porte le même SQLSTATE que PostgREST en rendait (`PT409` compris) : même code, même
 * statut ; `PGRST…` ne vient que de PostgREST. Le code technique et `context` partent au log
 * serveur ; `message`, `details` et `hint` de la base n'en sortent jamais : ils portent des noms de
 * tables et de colonnes (`supabase-patterns.md § Error Handling`). Ce qui ne vient pas de la base,
 * que `db.tx` rejette aussi, passe tel quel : un refus ou un conflit décidé dans la transaction est
 * rendu inchangé ; une erreur sans code (`PlatformConfigError`, bogue) est relancée, et la porte la
 * journalise avec son message et sa pile.
 */
export function fromDatabaseError(error: { code?: string } | null | undefined, context: string): PlatformError {
  if (isPlatformError(error)) return error
  if (error instanceof Error && typeof error.code !== "string") throw error
  const dbCode = error?.code ?? "unknown"
  console.error(`[platform] ${context}`, dbCode)
  const [code, message] = FROM_DATABASE[dbCode] ?? ["internal", "Internal error."]
  return new PlatformError(code, message)
}

/**
 * `fn` dans une transaction de la face SQL (`db.tx`, sous l'appelant de la requête, E01-S10) ; ce qu'elle
 * rejette sort par `fromDatabaseError` (`context` au log serveur avec le code) : une erreur de la base
 * traduite, mêmes codes et mêmes messages (AC-x2 d'E01-S10) ; un refus ou un conflit décidé dans la
 * transaction rendu tel quel ; une erreur sans code (`PlatformConfigError`, bogue) relancée (HN-E01S10-15).
 * La seule aide de transaction traduite des services (M32) : sans elle, chaque transaction recopie sa
 * capture.
 */
export async function inTransaction<T>(db: PlatformDb, context: string, fn: (sql: Tx) => Promise<T>): Promise<T> {
  try {
    return await db.tx(fn)
  } catch (error) {
    // Le `catch` ne connaît pas le type de ce que rejette `db.tx` : une erreur de la base ou du pilote
    // porte son `code`, ce qui n'en vient pas est rendu ou relancé tel quel par `fromDatabaseError`.
    throw fromDatabaseError(error as { code?: string }, context)
  }
}

/**
 * Panne de la base qu'un service dit par son propre message (`internal`, « Database
 * unreachable. ») ; un jeton que la base refuse reste `unauthorized`, une session à reprendre et
 * jamais une panne (M10). Même log que `fromDatabaseError`, et comme lui, ce qui ne vient pas de la
 * base passe tel quel.
 */
export function databaseFailure(error: { code?: string } | null | undefined, context: string, message: string): PlatformError {
  if (isPlatformError(error)) return error
  const failure = fromDatabaseError(error, context)
  return failure.code === "unauthorized" ? failure : new PlatformError("internal", message)
}

/**
 * Une écriture qui ne rend aucune ligne après la décision du service : sa cible a changé entre la
 * lecture et l'écriture (partie, ou déjà dans un autre état). Un conflit à recharger, jamais un refus
 * ni `not_found` (HN-E01S07-6) ; le log serveur nomme le service et la cible.
 */
export function changedMeanwhile(context: string, target: string, message: string): PlatformError {
  console.error(`[platform] ${context}: no row written`, target)
  return new PlatformError("conflict", message)
}

/**
 * Lignes lues au plus par une lecture bornée de la face SQL (une page : le plus récent d'abord, les
 * blocs d'un nœud, l'usage d'une personne) : la borne de `max_rows` de PostgREST (1 000), gardée telle
 * quelle depuis la fin de sa face (E01-S10 f2) pour que chaque service rende les mêmes lignes qu'avant.
 */
export const READ_PAGE_ROWS = 1000
