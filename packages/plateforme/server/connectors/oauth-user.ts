// Le consentement d'une personne, `oauth2_user` (`connecteurs-et-comptes.md` § Consentement d'une personne) : ce que le
// moteur en exécute à partir de la seule description. Contrôle de la description à la déclaration ; adresse
// d'autorisation (scopes joints par des espaces, ceux du niveau `full` pour un connecteur à niveaux d'accès,
// `authorizeParams`, `state`, PKCE S256) ; échange du code contre les
// jetons au point de jeton, en formulaire, avec l'application OAuth que fournit l'hôte ; puis, à chaque appel, le jeton
// d'accès gardé tant qu'il n'est pas échu, renouvelé selon `refresh` (jeton de rafraîchissement, rotation comprise, ou
// échange du jeton courant). Un renouvellement refusé (`invalid_grant`) passe le compte à reconnecter ; une
// application refusée ou une panne ne change pas l'état du compte. Sans ce module, un compte ne porterait qu'un jeton
// posé à la main. Aucun jeton ni secret n'en sort ailleurs que dans la requête au tiers : ni texte, ni erreur, ni log.
import { PlatformError } from "../errors"
import { isJsonObject } from "../json"
import type { AccountCredential, Signer } from "./auth"
import type { ConnectorDefinition, OAuthApplication } from "./definition"
import { requestToken, type ApiRequest, type Fetch } from "./http"
import { addressProblem, resolveAddress, type AddressSpec } from "./settings"
import { clientPlacement, expiryOf } from "./token-endpoint"

/** Un jeton dont l'échéance tombe dans cette marge est renouvelé avant l'appel. */
export const EXPIRY_MARGIN_MS = 60_000

/** Ce que l'hôte pose lui-même dans l'adresse d'autorisation : jamais une constante de la description. */
const RESERVED_AUTHORIZE_PARAMS = ["client_id", "redirect_uri", "response_type", "scope", "state", "code_challenge", "code_challenge_method"]
const PARAM_NAME = /^[A-Za-z0-9_.-]+$/
const GRANT_TYPE = /^[A-Za-z0-9_.:-]+$/
/** Un scope n'a ni espace ni guillemet (RFC 6749 § 3.3). */
const SCOPE = /^[\x21\x23-\x5B\x5D-\x7E]+$/
const LEVEL_NAME = /^[a-z][a-z0-9_]{0,39}$/

/** Une liste de scopes sans espace ; `nonEmpty` : au moins un. */
export const isScopeList = (value: unknown, nonEmpty: boolean): value is string[] =>
  Array.isArray(value) && (!nonEmpty || value.length > 0) && value.every((scope) => typeof scope === "string" && SCOPE.test(scope))

/** Qui a consenti : une fonction du connecteur, ou une adresse complète lue avec le jeton, et ses droits. */
export type ConsentIdentity = { function: string; path: string } | { url: string; path: string; scopes: string[] }

/** Le consentement déclaré, prêt pour l'appel : ses adresses, ses scopes, son renouvellement, l'identité à lire. */
export type UserConsentAuth = {
  kind: "user_consent"
  authorize: AddressSpec
  token: AddressSpec
  clientAuth: "body" | "basic"
  /**
   * Les droits que le consentement demande : `scopes` sans niveaux, ceux du niveau `full` avec niveaux, puis ceux de
   * l'identité lue à une adresse qui n'y sont pas déjà.
   */
  scopes: string[]
  /**
   * Les niveaux d'accès déclarés, par nom, `full` compris ; `null` : sans niveaux. Gardés sans être appliqués : ni
   * filtrage des fonctions, ni niveau choisi, le consentement demande `full` (issue oto-now/oto-core#71).
   */
  accessLevels: Record<string, string[]> | null
  /** Un droit et ceux qu'il couvre, tels que le fournisseur le définit ; vide sans niveaux. */
  scopeImplies: Record<string, string[]>
  authorizeParams: Record<string, string>
  refresh: "refresh_token" | "exchange" | "none"
  exchange: { grantType: string; tokenParam: string } | null
  expiresInDefault: number | null
  identity: ConsentIdentity
}

/** Les jetons qu'un point de jeton rend : le jeton d'accès, celui de rafraîchissement, l'échéance, les droits accordés. */
export type ConsentTokens = { accessToken: string; refreshToken: string | null; expiresAt: Date | null; scopes: string[] | null }

const isPositiveInteger = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value > 0

/** Le problème du renouvellement déclaré, ou ce qu'il prépare. */
function refreshOf(head: string, auth: Record<string, unknown>): Pick<UserConsentAuth, "refresh" | "exchange"> | string {
  if (auth.refresh === "none") return { refresh: "none", exchange: null }
  if (auth.refresh === "refresh_token") return typeof auth.rotates === "boolean" ? { refresh: "refresh_token", exchange: null } : `${head}: refresh refresh_token needs rotates true or false.`
  if (auth.refresh !== "exchange") return `${head} needs refresh refresh_token, exchange or none.`
  const exchange = auth.exchange
  if (!isJsonObject(exchange) || typeof exchange.grantType !== "string" || !GRANT_TYPE.test(exchange.grantType) || typeof exchange.tokenParam !== "string" || !PARAM_NAME.test(exchange.tokenParam)) {
    return `${head}: refresh exchange needs exchange {grantType, tokenParam}.`
  }
  return { refresh: "exchange", exchange: { grantType: exchange.grantType, tokenParam: exchange.tokenParam } }
}

/** Les droits déclarés : `scopes` sans niveaux, ou `accessLevels` (`full` exigé) et `scopeImplies` ; ou le problème. */
function scopesOf(head: string, auth: Record<string, unknown>): Pick<UserConsentAuth, "scopes" | "accessLevels" | "scopeImplies"> | string {
  const { scopes, accessLevels, scopeImplies } = auth
  if (accessLevels === undefined) {
    if (scopeImplies !== undefined) return `${head}: scopeImplies needs accessLevels.`
    if (scopes !== undefined && !isScopeList(scopes, false)) return `${head}: scopes must list texts without spaces.`
    return { scopes: [...((scopes as string[] | undefined) ?? [])], accessLevels: null, scopeImplies: {} }
  }
  if (scopes !== undefined) return `${head}: scopes and accessLevels exclude each other; a connector with access levels asks the scopes of a level.`
  if (!isJsonObject(accessLevels) || !isJsonObject(accessLevels.full)) return `${head}: accessLevels needs the level full.`
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
  return { scopes: levels.full, accessLevels: levels, scopeImplies: Object.fromEntries(Object.entries(implies).map(([scope, implied]) => [scope, [...(implied as string[])]])) }
}

/** L'identité déclarée : `{ function, path }`, ou `{ url, path, scopes }`, une adresse `https` fixe ; ou le problème. */
function identityOf(definition: ConnectorDefinition, head: string, identity: unknown): ConsentIdentity | string {
  const missing = `${head} needs identity {function, path} or {url, path, scopes}: what names who consented.`
  if (!isJsonObject(identity) || typeof identity.path !== "string" || !identity.path) return missing
  if (identity.url === undefined) return typeof identity.function === "string" && identity.scopes === undefined ? { function: identity.function, path: identity.path } : missing
  if (identity.function !== undefined || typeof identity.url !== "string") return `${head}: identity takes a function or a url, not both.`
  const badAddress = addressProblem(`${definition.name}: identity url`, { template: identity.url }, [])
  if (badAddress) return badAddress
  if (!isScopeList(identity.scopes, true)) return `${head}: identity url needs the scopes it requires, a non-empty list without spaces.`
  return { url: identity.url, path: identity.path, scopes: [...identity.scopes] }
}

/**
 * Le consentement `oauth2_user` déclaré, prêt pour l'appel, ou le problème qui le refuse. Ni réglage, ni `tokenUrls`, ni
 * `fromToken` dans cette version du paquet (aucune description ne s'en sert) : refusés nommément. L'identité par une
 * fonction se contrôle avec les fonctions (`declaration.ts`) ; celle à une adresse, ici.
 */
export function prepareUserConsent(definition: ConnectorDefinition, auth: Record<string, unknown>): UserConsentAuth | string {
  const head = `${definition.name}: auth oauth2_user`
  if ((definition.settings ?? []).length > 0) return `${head} takes no settings in this version of the package.`
  if (auth.fromToken !== undefined) return `${head}: fromToken is not supported yet by the package.`
  if (typeof auth.authorizeUrl !== "string") return `${head} needs authorizeUrl.`
  if (typeof auth.tokenUrl !== "string" || auth.tokenUrls !== undefined) return `${head} needs tokenUrl (tokenUrls depends on a setting, which oauth2_user does not take yet).`
  const authorize: AddressSpec = { template: auth.authorizeUrl }
  const token: AddressSpec = { template: auth.tokenUrl }
  const badAddress = addressProblem(`${definition.name}: authorizeUrl`, authorize, []) ?? addressProblem(`${definition.name}: tokenUrl`, token, [])
  if (badAddress) return badAddress
  const { clientAuth, authorizeParams, pkce } = auth
  if (clientAuth !== "body" && clientAuth !== "basic") return `${head} needs clientAuth body or basic.`
  const declared = scopesOf(head, auth)
  if (typeof declared === "string") return declared
  const params = authorizeParams ?? {}
  if (!isJsonObject(params) || Object.entries(params).some(([name, value]) => !PARAM_NAME.test(name) || typeof value !== "string")) {
    return `${head}: authorizeParams must map parameter names to texts.`
  }
  const reserved = Object.keys(params).find((name) => RESERVED_AUTHORIZE_PARAMS.includes(name))
  if (reserved !== undefined) return `${head}: authorizeParams must not set ${reserved}, which the package sets itself.`
  if (pkce !== undefined && pkce !== "S256") return `${head}: pkce must be S256.`
  const expires = auth.expiresInDefault
  if (expires !== undefined && !isPositiveInteger(expires)) return `${head}: expiresInDefault must be a positive integer.`
  const identity = identityOf(definition, head, auth.identity)
  if (typeof identity === "string") return identity
  const refresh = refreshOf(head, auth)
  if (typeof refresh === "string") return refresh
  return {
    kind: "user_consent",
    authorize,
    token,
    clientAuth,
    scopes: "url" in identity ? [...new Set([...declared.scopes, ...identity.scopes])] : declared.scopes,
    accessLevels: declared.accessLevels,
    scopeImplies: declared.scopeImplies,
    authorizeParams: { ...(params as Record<string, string>) },
    ...refresh,
    expiresInDefault: expires ?? null,
    identity,
  }
}

/**
 * L'adresse d'autorisation où la personne consent : `response_type=code`, l'identifiant du client de l'hôte, l'adresse
 * de retour, les scopes joints par des espaces, le `state`, la preuve PKCE (S256, toujours : un serveur ignore un
 * paramètre qu'il ne connaît pas, RFC 6749 § 3.1), puis les constantes de la description.
 */
export function authorizationAddress(auth: UserConsentAuth, request: { clientId: string; redirectUri: string; state: string; codeChallenge: string }): string {
  const { url } = resolveAddress(auth.authorize, {}, [])
  const query = new URLSearchParams([
    ["response_type", "code"],
    ["client_id", request.clientId],
    ["redirect_uri", request.redirectUri],
    ...(auth.scopes.length > 0 ? ([["scope", auth.scopes.join(" ")]] as [string, string][]) : []),
    ["state", request.state],
    ["code_challenge", request.codeChallenge],
    ["code_challenge_method", "S256"],
    ...Object.entries(auth.authorizeParams),
  ])
  return `${url}?${query.toString()}`
}

/** Ce qu'il faut pour joindre le point de jeton d'un connecteur. */
export type TokenEndpointCall = { definition: ConnectorDefinition; auth: UserConsentAuth; application: OAuthApplication; pacingKey: string; fetcher: Fetch }

/** Les droits accordés d'une réponse de jeton (`scope`, joints par des espaces) ; absents : `null`. */
function grantedScopes(answer: Record<string, unknown>): string[] | null {
  return typeof answer.scope === "string" ? answer.scope.split(/\s+/).filter(Boolean) : null
}

/** Le refus d'une application OAuth que le tiers ne reconnaît pas : l'état du compte n'y est pour rien. */
const applicationRefused = (label: string) =>
  new PlatformError("upstream_error", `${label} refused the OAuth application of this application: ask whoever runs this application to check its client id and secret.`)

/**
 * Envoie une demande au point de jeton (`grant_type` et ses paires, le client posé selon `clientAuth`) et rend les
 * jetons, ou la raison d'un refus du tiers : `invalid_grant` (code ou autorisation refusés), l'application refusée.
 */
async function tokenRequest(call: TokenEndpointCall, pairs: [string, string][]): Promise<ConsentTokens | { refused: "grant" }> {
  const { definition, auth, application } = call
  const client = clientPlacement(auth.clientAuth, application.clientId, application.clientSecret)
  const { url } = resolveAddress(auth.token, {}, [])
  const request: ApiRequest = { method: "POST", path: "", headers: client.headers, form: [...pairs, ...client.pairs], pacingKey: call.pacingKey }
  const api = { label: definition.label, baseUrl: url, timeoutMs: definition.timeoutMs, errors: [] }
  const answer = await requestToken(api, request, call.fetcher)
  if (!answer.ok) {
    if (answer.error === "invalid_grant") return { refused: "grant" }
    if (answer.error === "invalid_client" || answer.error === "unauthorized_client" || answer.status === 401) throw applicationRefused(definition.label)
    throw new PlatformError("upstream_error", `${definition.label} refused the token request (status ${answer.status}). Retry later.`)
  }
  const body = answer.answer
  const accessToken = isJsonObject(body) ? body.access_token : undefined
  if (!isJsonObject(body) || typeof accessToken !== "string" || !accessToken) {
    console.error(`[platform] connector ${definition.label}: token answer without access_token`)
    throw new PlatformError("upstream_error", `${definition.label} sent an unreadable token answer. Retry later.`)
  }
  const refreshToken = typeof body.refresh_token === "string" && body.refresh_token ? body.refresh_token : null
  return { accessToken, refreshToken, expiresAt: expiryOf(body, auth.expiresInDefault, Date.now()), scopes: grantedScopes(body) }
}

/**
 * Échange le code d'autorisation contre les jetons (`authorization_code`, adresse de retour et preuve PKCE). Refus :
 * code expiré, déjà servi ou refusé (`invalid_arguments`, qui dit de recommencer) ; application refusée ou panne
 * (`upstream_error`).
 */
export async function exchangeCode(call: TokenEndpointCall, request: { code: string; redirectUri: string; verifier: string }): Promise<ConsentTokens> {
  const tokens = await tokenRequest(call, [
    ["grant_type", "authorization_code"],
    ["code", request.code],
    ["redirect_uri", request.redirectUri],
    ["code_verifier", request.verifier],
  ])
  if ("refused" in tokens) throw new PlatformError("invalid_arguments", `${call.definition.label} refused the authorization code (expired or already used). Connect the account again.`)
  return tokens
}

/**
 * Le jeton d'accès d'un compte `oauth2_user` pour un appel. `fresh` : renouvelé même s'il n'est pas échu (après un 401).
 * Un jeton gardé sert tant qu'il n'est pas à moins d'une minute de son échéance ; sinon il se renouvelle selon
 * `refresh`, et le jeton de rafraîchissement rendu remplace celui qu'on a lu (`renewed`). Un renouvellement impossible
 * ou refusé (`invalid_grant`, `refresh: none` échu, aucun jeton de rafraîchissement) passe le compte à reconnecter et
 * lève son refus nommé (`revoked`).
 */
export async function consentAccessToken(signer: Signer & { auth: UserConsentAuth }, fresh: boolean): Promise<string> {
  const { auth, credential, definition } = signer
  const consent = consentOf(credential, definition)
  const kept = await credential.tokens.read()
  const usable = !fresh && kept !== null && (kept.expiresAt === null || kept.expiresAt.getTime() - EXPIRY_MARGIN_MS > Date.now())
  if (usable) return kept.token
  const label = definition.label
  if (auth.refresh === "none") throw await consent.revoked(`its ${label} authorization expired`)
  const pairs: [string, string][] | null =
    auth.refresh === "refresh_token"
      ? consent.refreshToken
        ? [["grant_type", "refresh_token"], ["refresh_token", consent.refreshToken]]
        : null
      : kept && auth.exchange
        ? [["grant_type", auth.exchange.grantType], [auth.exchange.tokenParam, kept.token]]
        : null
  if (!pairs) throw await consent.revoked(`${label} gave no token to renew its authorization`)
  const call: TokenEndpointCall = { definition, auth, application: consent.application, pacingKey: `token:${signer.accountId}`, fetcher: signer.fetcherFor(false) }
  const tokens = await tokenRequest(call, pairs)
  if ("refused" in tokens) throw await consent.revoked(`${label} no longer accepts its authorization (expired or revoked)`)
  const rotated = tokens.refreshToken !== null && tokens.refreshToken !== consent.refreshToken ? tokens.refreshToken : null
  await consent.renewed({ token: tokens.accessToken, expiresAt: tokens.expiresAt }, rotated, tokens.scopes)
  return tokens.accessToken
}

/** Le consentement d'un compte ouvert ; absent pour un connecteur `oauth2_user`, une erreur de câblage. */
function consentOf(credential: AccountCredential, definition: ConnectorDefinition) {
  if (credential.consent) return credential.consent
  console.error(`[platform] connector ${definition.name}: oauth2_user account opened without its consent`)
  throw new PlatformError("internal", "Internal error.")
}
