// Le jeton de la personne pour l'API d'un hôte (`fonctions-d-un-hote.md` § Jeton) : l'échange RFC 8693 auprès de
// l'émetteur de l'instance, voie first-party. Le jeton vérifié de l'appelant (`subject_token`) s'échange au point de
// jeton de la découverte OIDC contre un jeton de l'audience de l'API (`resource`), aux scopes demandés ; oto s'y
// authentifie en client M2M (`PLATFORM_OIDC_EXCHANGE_CLIENT_ID` et `_SECRET`, `cell.ts`). Le jeton de la personne ne
// part jamais vers l'hôte : seul le jeton échangé y va. Sans ce module, l'API d'un hôte ne saurait pas qui appelle.
//
// Un refus de l'émetteur (`invalid_grant`) dit que la personne n'a pas consenti depuis ce client : `consentRequired`,
// sans repli. Le consentement OAuth d'un client tiers (PR 2 du chantier) s'y branchera.
import { EXCHANGE_CLIENT_ENV } from "../cell"
import { basicOf, expiryOf } from "../connectors/token-endpoint"
import { requestToken, type ConnectorApi } from "../connectors/http"
import { EXPIRY_MARGIN_MS } from "../connectors/oauth-user"
import { PlatformError } from "../errors"
import { issuerConfig, discover } from "../issuer"
import { isJsonObject } from "../json"
import { PlatformConfigError } from "../sql"

export const TOKEN_EXCHANGE_GRANT = "urn:ietf:params:oauth:grant-type:token-exchange"
export const ACCESS_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:access_token"
/** Délai d'un échange au point de jeton. */
const EXCHANGE_TIMEOUT_MS = 10_000

/** Ce qu'il faut pour un échange : qui appelle (son organisation, son identifiant, son jeton vérifié) et pour quelle API. */
export type ExchangeRequest = {
  orgId: string
  userId: string
  subjectToken: string
  issuer: string
  resource: string
  scope: string
}

/** Les jetons échangés, par organisation, personne, API et scopes, jusqu'à leur échéance moins une minute. */
const exchanged = new Map<string, { token: string; until: number }>()

/** Vide les jetons gardés ; les tests seuls. */
export function forgetExchangedTokens(): void {
  exchanged.clear()
}

/**
 * Le refus d'une personne qui n'a pas consenti aux fonctions de l'hôte depuis ce client : l'émetteur a refusé l'échange
 * (`invalid_grant`). Point d'entrée du consentement d'un client tiers (PR 2) : `details.reason` le nomme.
 */
export function consentRequired(label: string): PlatformError {
  return new PlatformError(
    "forbidden",
    `The functions of ${label} require the person's consent from this client. The issuer refused to delegate your session to ${label}.`,
    { reason: "host_consent_required" },
  )
}

/**
 * L'émetteur de l'API d'un hôte doit être celui de l'instance (mode OIDC), sinon la configuration est refusée : oto
 * n'échange un jeton qu'auprès de l'émetteur qui l'a signé. `null` : accepté ; sinon la raison, sans valeur.
 */
export function issuerProblem(issuer: string): string | null {
  let config: ReturnType<typeof issuerConfig>
  try {
    config = issuerConfig()
  } catch (error) {
    if (error instanceof PlatformConfigError) return "the instance's issuer is misconfigured"
    throw error
  }
  if (config.kind !== "oidc") return "the instance does not run on an OpenID Connect issuer: the token exchange needs one"
  return config.issuer === issuer ? null : "x-oto.issuer is not the issuer of this instance (compare the trailing slash)"
}

/** Le client M2M d'oto à l'émetteur ; une variable manquante se dit par son nom, jamais par une valeur. */
function exchangeClient(): { id: string; secret: string } {
  const id = process.env[EXCHANGE_CLIENT_ENV.id]
  const secret = process.env[EXCHANGE_CLIENT_ENV.secret]
  if (!id || !secret) {
    console.error(`[platform] host api: ${!id ? EXCHANGE_CLIENT_ENV.id : EXCHANGE_CLIENT_ENV.secret} missing: no token exchange`)
    throw new PlatformError("internal", "Internal error.")
  }
  return { id, secret }
}

/** Le point de jeton de l'émetteur, lu dans sa découverte. */
async function tokenEndpoint(issuer: string): Promise<string> {
  let endpoint: string | null
  try {
    endpoint = (await discover(issuer)).tokenEndpoint
  } catch (error) {
    if (!(error instanceof PlatformConfigError)) throw error
    console.error(`[platform] host api: ${error.message}`)
    throw new PlatformError("upstream_error", "The issuer of this instance is unreachable. Retry later.")
  }
  if (endpoint) return endpoint
  console.error("[platform] host api: the issuer's discovery has no token_endpoint")
  throw new PlatformError("internal", "Internal error.")
}

/**
 * Le jeton de la personne pour l'API (`resource`), échangé ou gardé. Refus : émetteur qui n'est pas celui de l'instance
 * ou client M2M absent (`internal`, journalisé) ; `invalid_grant` (`consentRequired`) ; tout autre refus de l'émetteur
 * (`upstream_error`). `label` : le nom de l'hôte dans les messages.
 */
export async function hostToken(label: string, request: ExchangeRequest): Promise<string> {
  const problem = issuerProblem(request.issuer)
  if (problem) {
    console.error(`[platform] host api ${label}: no token exchange: ${problem}`)
    throw new PlatformError("internal", "Internal error.")
  }
  const key = JSON.stringify([request.orgId, request.userId, request.resource, request.scope])
  const kept = exchanged.get(key)
  if (kept && kept.until > Date.now()) return kept.token
  const client = exchangeClient()
  const endpoint = await tokenEndpoint(request.issuer)
  const api: ConnectorApi = { label: "the issuer", baseUrl: endpoint, timeoutMs: EXCHANGE_TIMEOUT_MS, errors: [] }
  const form: [string, string][] = [
    ["grant_type", TOKEN_EXCHANGE_GRANT],
    ["subject_token", request.subjectToken],
    ["subject_token_type", ACCESS_TOKEN_TYPE],
    ["resource", request.resource],
    ...(request.scope ? ([["scope", request.scope]] as [string, string][]) : []),
  ]
  const now = Date.now()
  // `fetch` lu à l'appel : l'émetteur de l'instance est une adresse de sa configuration, jamais une saisie.
  const answer = await requestToken(api, { method: "POST", path: "", headers: { authorization: basicOf(client.id, client.secret) }, form, pacingKey: `exchange:${request.orgId}` }, (input, init) =>
    fetch(input, { ...init, redirect: "error" }),
  )
  if (!answer.ok) {
    console.error(`[platform] host api ${label}: token exchange refused (${answer.status}${answer.error ? ` ${answer.error}` : ""})`)
    if (answer.error === "invalid_grant") throw consentRequired(label)
    throw new PlatformError("upstream_error", `The issuer refused to delegate your session to ${label} (HTTP ${answer.status}). Retry later.`)
  }
  const body = isJsonObject(answer.answer) ? answer.answer : {}
  const token = body.access_token
  if (typeof token !== "string" || token === "") {
    console.error(`[platform] host api ${label}: token exchange answer without access_token`)
    throw new PlatformError("upstream_error", `The issuer sent an unreadable answer for ${label}. Retry later.`)
  }
  const expiry = expiryOf(body, null, now)
  // Sans échéance, le jeton sert à cet appel seul : rien ne dit jusqu'à quand il vaut.
  if (expiry) exchanged.set(key, { token, until: expiry.getTime() - EXPIRY_MARGIN_MS })
  return token
}
