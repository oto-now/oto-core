// Le jeton de la personne pour l'API d'un hôte (`fonctions-d-un-hote-jeton.md` § Ordre) : l'échange RFC 8693 auprès de
// l'émetteur de l'instance, voie first-party. Le jeton vérifié de l'appelant (`subject_token`) s'échange au point de
// jeton de la découverte OIDC contre un jeton de l'audience de l'API (`resource`), au scope de la fonction appelée ; oto
// s'y authentifie en client M2M (`PLATFORM_OIDC_EXCHANGE_CLIENT_ID` et `_SECRET`, `cell.ts`). Le jeton de la personne ne
// part jamais vers l'hôte : seul le jeton échangé y va. Sans ce module, l'API d'un hôte ne saurait pas qui appelle.
//
// Un seul refus désigne un client tiers (Claude, Le Chat, tout client DCR ou CIMD), dont l'émetteur n'échange jamais le
// jeton : `thirdParty`, que le consentement de la personne prend en charge (`consent.ts`). Tout autre refus est une
// erreur, jamais un consentement.
import { createHash } from "node:crypto"
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

/**
 * Le refus de Logto qui désigne un client tiers : `invalid_grant`, sous la description que Logto donne à tout
 * `InvalidGrant` de son fournisseur OIDC (`grant request is invalid`). La raison précise (« subject token was not issued
 * to a first-party application », un client CIMD compris) reste dans son `error_detail`, que Logto ne rend pas. Ce couple
 * ne couvre donc, sous un jeton qu'oto vient de vérifier (signature, émetteur, audience, `exp`, `sub`), que trois cas :
 * un client tiers, un client supprimé, une personne suspendue ; les deux derniers ne consentent pas non plus. Un client
 * first-party mal réglé (« Allow token exchange » absent), une ressource ou un scope refusés rendent d'autres codes
 * (`unauthorized_client`, `invalid_target`, `invalid_scope`…) : jamais le consentement.
 */
export const THIRD_PARTY_REFUSAL = { error: "invalid_grant", description: "grant request is invalid" } as const

/** Ce qu'a donné un échange : le jeton de l'API, ou un client tiers dont l'émetteur n'échange pas le jeton. */
export type ExchangeOutcome = { token: string } | { thirdParty: true }

/** Combien de temps se garde le constat d'un client tiers, au plus (le jeton de l'appelant échoit souvent avant). */
const THIRD_PARTY_KEPT_MS = 5 * 60_000

/**
 * Les échanges gardés, par organisation, personne, client de l'appelant, API et scope ; pour un client tiers, par
 * empreinte du jeton de l'appelant en plus.
 */
const exchanged = new Map<string, { outcome: ExchangeOutcome; until: number }>()

/** Vide les jetons gardés ; les tests seuls. */
export function forgetExchangedTokens(): void {
  exchanged.clear()
}

/**
 * Les claims d'un JWT, lus sans vérification ; `null` s'il ne se lit pas. Pour un jeton déjà vérifié par la porte (celui
 * de l'appelant), ou rendu par l'émetteur lui-même en TLS (celui d'un consentement) : jamais pour décider d'un droit sur
 * un jeton venu d'ailleurs.
 */
export function claimsOf(token: string): Record<string, unknown> | null {
  const payload = token.split(".")[1]
  if (!payload) return null
  try {
    const claims: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))
    return isJsonObject(claims) ? claims : null
  } catch {
    return null
  }
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

/** Un point de l'émetteur lu dans sa découverte (`token_endpoint`, `authorization_endpoint`) ; absent, une panne nommée. */
export async function issuerEndpoint(issuer: string, endpoint: "tokenEndpoint" | "authorizationEndpoint"): Promise<string> {
  let found: string | null
  try {
    found = (await discover(issuer))[endpoint]
  } catch (error) {
    if (!(error instanceof PlatformConfigError)) throw error
    console.error(`[platform] host api: ${error.message}`)
    throw new PlatformError("upstream_error", "The issuer of this instance is unreachable. Retry later.")
  }
  if (found) return found
  console.error(`[platform] host api: the issuer's discovery has no ${endpoint === "tokenEndpoint" ? "token_endpoint" : "authorization_endpoint"}`)
  throw new PlatformError("internal", "Internal error.")
}

/**
 * Le jeton de la personne pour l'API (`resource`), échangé ou gardé, ou le constat d'un client tiers
 * (`THIRD_PARTY_REFUSAL`), gardé cinq minutes au plus pour ce jeton de l'appelant. Refus : émetteur qui n'est pas celui
 * de l'instance ou client M2M absent (`internal`, journalisé) ; jeton de l'appelant échu (`unauthorized`, avant tout
 * échange : l'émetteur le refuserait sous le même code qu'un client tiers) ; tout autre refus de l'émetteur
 * (`upstream_error`). `label` : le nom de l'hôte dans les messages.
 */
export async function exchangedToken(label: string, request: ExchangeRequest): Promise<ExchangeOutcome> {
  const problem = issuerProblem(request.issuer)
  if (problem) {
    console.error(`[platform] host api ${label}: no token exchange: ${problem}`)
    throw new PlatformError("internal", "Internal error.")
  }
  const now = Date.now()
  const claims = claimsOf(request.subjectToken)
  const exp = claims?.exp
  if (typeof exp === "number" && exp * 1000 <= now) throw new PlatformError("unauthorized", "Your session expired. Sign in again, then call again.")
  const caller = createHash("sha256").update(request.subjectToken, "utf8").digest("hex")
  // Le client de l'appelant fait partie de la clé : un jeton échangé pour un client first-party ne sert jamais un autre.
  const key = JSON.stringify([request.orgId, request.userId, typeof claims?.client_id === "string" ? claims.client_id : null, request.resource, request.scope])
  for (const kept of [exchanged.get(key), exchanged.get(`${key} ${caller}`)]) if (kept && kept.until > now) return kept.outcome
  const client = exchangeClient()
  const endpoint = await issuerEndpoint(request.issuer, "tokenEndpoint")
  const api: ConnectorApi = { label: "the issuer", baseUrl: endpoint, timeoutMs: EXCHANGE_TIMEOUT_MS, errors: [] }
  const form: [string, string][] = [
    ["grant_type", TOKEN_EXCHANGE_GRANT],
    ["subject_token", request.subjectToken],
    ["subject_token_type", ACCESS_TOKEN_TYPE],
    ["resource", request.resource],
    // Un scope vide (la liste des fonctions de la personne, `visibility.ts`) : l'audience seule, aucun scope demandé.
    ...(request.scope === "" ? [] : [["scope", request.scope] as [string, string]]),
  ]
  // `fetch` lu à l'appel : l'émetteur de l'instance est une adresse de sa configuration, jamais une saisie.
  const answer = await requestToken(api, { method: "POST", path: "", headers: { authorization: basicOf(client.id, client.secret) }, form, pacingKey: `exchange:${request.orgId}` }, (input, init) =>
    fetch(input, { ...init, redirect: "error" }),
  )
  if (!answer.ok) {
    if (answer.error === THIRD_PARTY_REFUSAL.error && answer.description === THIRD_PARTY_REFUSAL.description) {
      const until = typeof exp === "number" ? Math.min(now + THIRD_PARTY_KEPT_MS, exp * 1000) : now + THIRD_PARTY_KEPT_MS
      exchanged.set(`${key} ${caller}`, { outcome: { thirdParty: true }, until })
      return { thirdParty: true }
    }
    console.error(`[platform] host api ${label}: token exchange refused (${answer.status}${answer.error ? ` ${answer.error}` : ""})`)
    throw new PlatformError("upstream_error", `The issuer refused to delegate your session to ${label} (HTTP ${answer.status}${answer.error ? `, ${answer.error}` : ""}).`)
  }
  const body = isJsonObject(answer.answer) ? answer.answer : {}
  const token = body.access_token
  if (typeof token !== "string" || token === "") {
    console.error(`[platform] host api ${label}: token exchange answer without access_token`)
    throw new PlatformError("upstream_error", `The issuer sent an unreadable answer for ${label}. Retry later.`)
  }
  const expiry = expiryOf(body, null, now)
  // Sans échéance, le jeton sert à cet appel seul : rien ne dit jusqu'à quand il vaut.
  if (expiry) exchanged.set(key, { outcome: { token }, until: expiry.getTime() - EXPIRY_MARGIN_MS })
  return { token }
}
