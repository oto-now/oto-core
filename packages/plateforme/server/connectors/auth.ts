// L'authentification d'un connecteur décrit (`connecteurs-et-comptes.md` § Comptes à plusieurs champs et réglages,
// § Consentement d'une personne) : contrôlée à la déclaration, puis posée sur chaque requête depuis le compte. `api_key`
// en en-tête ou en query, `bearer`, `basic`, `oauth2_client_credentials` : le jeton échangé contre l'identifiant et le
// secret du client, rangé en base (chiffré, `token_ciphertext`) et non dans la mémoire du processus, renouvelé à son
// échéance, et une fois de plus après un 401 ; `oauth2_user` : le jeton d'accès du consentement d'une personne, rangé
// de même, renouvelé par `oauth-user.ts`. Sans ce module, un compte ne porterait qu'un jeton posé à la main. Aucun
// secret ne sort d'ici ailleurs que dans la requête au tiers : ni texte, ni erreur, ni log.
import type { AccountMark, AccountMarkReason } from "../../schemas"
import { PlatformError } from "../errors"
import { isJsonObject } from "../json"
import type { ConnectorDefinition, ConnectorSetting, OAuthApplication } from "./definition"
import { requestJson, type ApiRequest, type Fetch } from "./http"
import { consentAccessToken, EXPIRY_MARGIN_MS, prepareUserConsent, type UserConsentAuth } from "./oauth-user"
import { addressProblem, resolveAddress, type AccountSettings, type AddressSpec } from "./settings"
import { basicOf, clientPlacement, expiryOf } from "./token-endpoint"

const HEADER_NAME = /^[A-Za-z0-9-]+$/
const QUERY_NAME = /^[A-Za-z0-9_.-]+$/

/** Les sortes d'authentification que le moteur exécute. */
export const RUN_AUTH_KINDS: readonly string[] = ["api_key", "bearer", "basic", "oauth2_client_credentials", "oauth2_user"]

/** L'authentification déclarée, prête pour l'appel : les noms des champs du compte qu'elle lit. */
export type PreparedAuth =
  | { kind: "header"; header: string; prefix: string; field: string }
  | { kind: "query"; param: string; field: string }
  | { kind: "basic"; username: string; password: string }
  | {
      kind: "client_credentials"
      token: AddressSpec
      tokenRequest: "json" | "form"
      clientAuth: "body" | "basic"
      clientId: string
      clientSecret: string
      scope: string | null
      expiresInDefault: number | null
    }
  | UserConsentAuth

/** Le jeton d'un échange tel que le garde un compte. */
export type StoredToken = { token: string; expiresAt: Date | null }

/** Où le jeton d'un échange se lit et s'écrit : la ligne du compte, chiffré (`token_ciphertext`). */
export type TokenStore = { read: () => Promise<StoredToken | null>; write: (token: StoredToken) => Promise<void> }

/**
 * Le consentement d'un compte `oauth2_user`, ouvert pour un appel : l'application OAuth de l'hôte, le jeton de
 * rafraîchissement lu, et les deux écritures d'un renouvellement.
 */
export type ConsentCredential = {
  application: OAuthApplication
  refreshToken: string | null
  /**
   * Range un renouvellement : le jeton d'accès et son échéance, les droits accordés s'ils sont dits, et le jeton de
   * rafraîchissement rendu (`rotated`) à la place de celui qu'on a lu, seulement s'il est encore en place.
   */
  renewed: (token: StoredToken, rotated: string | null, scopes: string[] | null) => Promise<void>
  /** Le consentement ne vaut plus : le compte passe à reconnecter, avec la raison ; rend le refus nommé à lever. */
  revoked: (reason: string) => Promise<PlatformError>
}

/**
 * La marque du compte d'un appel (`accounts.health.mark`), ouverte avec lui : celle qu'il porte (`current`) ; `set`, qui
 * la pose (une raison) ou la lève (`null`) par `platform.mark_account`, sans rien écrire si rien ne change ; `effect`, ce
 * que l'appel en a fait, pour sa ligne de journal, une écriture qui a échoué comprise (`mark_failed`, `lift_failed`,
 * posé par le moteur) ; `remedy`, la phrase qui dit la marque, sa date et à qui demander.
 */
export type AccountMarker = {
  current: AccountMark | null
  effect: "marked" | "lifted" | "mark_failed" | "lift_failed" | null
  set: (reason: AccountMarkReason | null) => Promise<void>
  remedy: () => Promise<string>
}

/**
 * Le compte d'un appel : ses champs déchiffrés, ceux de l'hôte (`holder: host`) compris, ses réglages, son jeton ; son
 * consentement pour `oauth2_user` ; l'identifiant du compte chez le tiers (`linkedId`, `accounts.linked_id`) pour un
 * connecteur à `accountIdentity` ; sa marque (`mark`), absente seulement pour l'identité lue au consentement, avant
 * que le compte existe.
 */
export type AccountCredential = {
  fields: Readonly<Record<string, string>>
  settings: AccountSettings
  tokens: TokenStore
  consent?: ConsentCredential
  linkedId?: string
  mark?: AccountMarker
}

/** Ce que l'authentification pose sur une requête. */
export type Signature = { headers: Record<string, string>; query: [string, string][] }

const isField = (definition: ConnectorDefinition, name: unknown): name is string =>
  typeof name === "string" && definition.credential.some((field) => field.name === name)

/** Le problème d'un échange `oauth2_client_credentials` déclaré, ou ce qu'il prépare. */
function clientCredentials(definition: ConnectorDefinition, auth: Record<string, unknown>): PreparedAuth | string {
  const head = `${definition.name}: auth oauth2_client_credentials`
  const { clientId, clientSecret, tokenRequest, clientAuth, scope } = auth
  if (!isField(definition, clientId) || !isField(definition, clientSecret)) return `${head} must name two credential fields (clientId, clientSecret).`
  if (tokenRequest !== "json" && tokenRequest !== "form") return `${head} needs tokenRequest json or form.`
  if (clientAuth !== "body" && clientAuth !== "basic") return `${head} needs clientAuth body or basic.`
  if (scope !== undefined && typeof scope !== "string") return `${head}: scope must be text.`
  const expires = auth.expiresInDefault
  if (expires !== undefined && !(typeof expires === "number" && Number.isInteger(expires) && expires > 0)) return `${head}: expiresInDefault must be a positive integer.`
  const token: AddressSpec | null =
    typeof auth.tokenUrl === "string" && auth.tokenUrls === undefined
      ? { template: auth.tokenUrl }
      : isJsonObject(auth.tokenUrls) && auth.tokenUrl === undefined
        ? { bySetting: auth.tokenUrls as { setting: string; values: Record<string, string> } }
        : null
  if (!token) return `${head} needs tokenUrl or tokenUrls, not both.`
  const problem = addressProblem(`${definition.name}: tokenUrl`, token, definition.settings ?? [])
  if (problem) return problem
  return { kind: "client_credentials", token, tokenRequest, clientAuth, clientId, clientSecret, scope: scope ?? null, expiresInDefault: expires ?? null }
}

/**
 * L'authentification déclarée prête pour l'appel, ou le problème qui la refuse : chaque valeur qui désigne un secret
 * nomme un champ de `credential` ; `oauth2_user` (consentement d'une personne) n'en nomme aucun. Toute autre sorte
 * (`none`) est refusée.
 */
export function prepareAuth(definition: ConnectorDefinition): PreparedAuth | string {
  const auth: Record<string, unknown> = { ...definition.auth }
  const head = `${definition.name}: auth ${String(auth.kind)}`
  if (auth.kind === "bearer") return isField(definition, auth.token) ? { kind: "header", header: "authorization", prefix: "Bearer ", field: auth.token } : `${head} must name a credential field (token).`
  if (auth.kind === "basic") {
    return isField(definition, auth.username) && isField(definition, auth.password) ? { kind: "basic", username: auth.username, password: auth.password } : `${head} must name two credential fields (username, password).`
  }
  if (auth.kind === "api_key") {
    if (!isField(definition, auth.key)) return `${head} must name a credential field (key).`
    if (auth.in === "query") {
      if (auth.prefix !== undefined) return `${head}: a key in the query takes no prefix.`
      return typeof auth.name === "string" && QUERY_NAME.test(auth.name) ? { kind: "query", param: auth.name, field: auth.key } : `${head} needs the name of its query parameter.`
    }
    if (auth.in !== "header" || typeof auth.name !== "string" || !HEADER_NAME.test(auth.name)) return `${head} needs in: header or query, and a name.`
    if (auth.prefix !== undefined && typeof auth.prefix !== "string") return `${head}: prefix must be text.`
    return { kind: "header", header: auth.name.toLowerCase(), prefix: auth.prefix ?? "", field: auth.key }
  }
  if (auth.kind === "oauth2_client_credentials") return clientCredentials(definition, auth)
  if (auth.kind === "oauth2_user") return prepareUserConsent(definition, auth)
  return `${head} is not supported; the package runs api_key, bearer, basic, oauth2_client_credentials and oauth2_user.`
}

/** Les champs du compte que l'authentification lit : chacun est exigé à l'appel. */
export function requiredFields(auth: PreparedAuth): string[] {
  if (auth.kind === "basic") return [auth.username, auth.password]
  if (auth.kind === "client_credentials") return [auth.clientId, auth.clientSecret]
  if (auth.kind === "user_consent") return []
  return [auth.field]
}

/** L'en-tête qu'occupe l'authentification, qu'aucun autre en-tête ne remplace ; `null` : elle va en query. */
export function authHeader(auth: PreparedAuth): string | null {
  if (auth.kind === "query") return null
  return auth.kind === "header" ? auth.header : "authorization"
}

type Exchange = { auth: Extract<PreparedAuth, { kind: "client_credentials" }>; label: string; timeoutMs: number; accountId: string; fetcherFor: (guarded: boolean) => Fetch }

/** Échange l'identifiant et le secret du client contre un jeton, puis le range ; un refus nomme les deux champs. */
async function exchangeToken(exchange: Exchange, credential: AccountCredential, settings: readonly ConnectorSetting[]): Promise<string> {
  const { auth, label } = exchange
  const address = resolveAddress(auth.token, credential.settings, settings)
  const id = credential.fields[auth.clientId]
  const secret = credential.fields[auth.clientSecret]
  const client = clientPlacement(auth.clientAuth, id, secret)
  const pairs: [string, string][] = [["grant_type", "client_credentials"], ...client.pairs, ...(auth.scope ? ([["scope", auth.scope]] as [string, string][]) : [])]
  const refused = { code: "upstream_error" as const, message: `${label} refused the client credentials of this account: check its client id and secret.` }
  const request: ApiRequest = {
    method: "POST",
    path: "",
    headers: client.headers,
    ...(auth.tokenRequest === "form" ? { form: pairs } : { body: Object.fromEntries(pairs) }),
    pacingKey: `token:${exchange.accountId}`,
  }
  const api = { label, baseUrl: address.url, timeoutMs: exchange.timeoutMs, errors: [{ status: [400, 401, 403], ...refused }] }
  const answer = await requestJson(api, request, exchange.fetcherFor(address.guarded))
  const token = isJsonObject(answer) ? answer.access_token : undefined
  if (typeof token !== "string" || !token) {
    console.error(`[platform] connector ${label}: token answer without access_token`)
    throw new PlatformError("upstream_error", `${label} sent an unreadable token answer. Retry later.`)
  }
  const now = Date.now()
  await credential.tokens.write({ token, expiresAt: expiryOf(answer as Record<string, unknown>, auth.expiresInDefault, now) })
  return token
}

/** Ce qu'il faut pour signer une requête : l'authentification, le compte, de quoi joindre le point de jeton. */
export type Signer = { auth: PreparedAuth; definition: ConnectorDefinition; credential: AccountCredential; accountId: string; fetcherFor: (guarded: boolean) => Fetch }

/**
 * La signature d'une requête. `fresh` : un jeton d'échange neuf, même si celui du compte n'est pas échu (après un 401).
 * Un jeton gardé sert tant qu'il n'est pas à moins d'une minute de son échéance.
 */
export async function sign(signer: Signer, fresh = false): Promise<Signature> {
  const { auth, credential } = signer
  const field = (name: string) => credential.fields[name]
  if (auth.kind === "header") return { headers: { [auth.header]: `${auth.prefix}${field(auth.field)}` }, query: [] }
  if (auth.kind === "query") return { headers: {}, query: [[auth.param, field(auth.field)]] }
  if (auth.kind === "basic") return { headers: { authorization: basicOf(field(auth.username), field(auth.password)) }, query: [] }
  if (auth.kind === "user_consent") return { headers: { authorization: `Bearer ${await consentAccessToken({ ...signer, auth }, fresh)}` }, query: [] }
  const kept = fresh ? null : await credential.tokens.read()
  const usable = kept !== null && (kept.expiresAt === null || kept.expiresAt.getTime() - EXPIRY_MARGIN_MS > Date.now())
  const exchange = { auth, label: signer.definition.label, timeoutMs: signer.definition.timeoutMs, accountId: signer.accountId, fetcherFor: signer.fetcherFor }
  const token = usable ? kept.token : await exchangeToken(exchange, credential, signer.definition.settings ?? [])
  return { headers: { authorization: `Bearer ${token}` }, query: [] }
}

/**
 * Vrai si un 401 se rejoue une fois sur un jeton neuf : un échange, ou un consentement qui se renouvelle (`refresh`
 * autre que `none`), dont le jeton vient d'un compte.
 */
export const renewsOnUnauthorized = (auth: PreparedAuth): boolean => auth.kind === "client_credentials" || (auth.kind === "user_consent" && auth.refresh !== "none")
