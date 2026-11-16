// Le compte de service d'un connecteur décrit (`oauth2_jwt_bearer`, RFC 7523 ; `connecteurs-et-comptes.md` § Compte
// de service) : le seul champ secret du compte porte le fichier JSON de la clé ; l'hôte la lit, signe une assertion RS256
// et l'échange au `tokenUrl` fixe de la description contre un jeton d'accès, rangé et renouvelé comme celui d'un
// échange `oauth2_client_credentials` (`auth.ts`). Sans ce module, un compte de service ne s'ouvrirait que par du code
// écrit à la main. La clé privée ne sort jamais d'ici : seule l'assertion part, dans le corps, vers `tokenUrl` seul ;
// ni la clé ni l'assertion ne vont dans un texte, une erreur ni un log. Avec des niveaux d'accès (`levels.ts`), l'assertion
// demande les droits du niveau du compte ; le jeton gardé dit ses droits, et un autre niveau en signe une neuve.
import { createPrivateKey, createSign, type KeyObject } from "node:crypto"
import { PlatformError } from "../errors"
import { isJsonObject } from "../json"
import type { Signer } from "./auth"
import type { ConnectorDefinition } from "./definition"
import { requestToken, type ApiRequest } from "./http"
import { declaredLevels, FULL_LEVEL, readAccessLevels, resolveLevel } from "./levels"
import { EXPIRY_MARGIN_MS } from "./oauth-user"
import { expiryOf } from "./token-endpoint"

/**
 * L'authentification `oauth2_jwt_bearer` déclarée, prête pour l'appel : le champ de la clé, l'audience, les droits.
 * Sans niveaux : `scopes`, `accessLevels` à `null`. Avec niveaux : `scopes` vide, `accessLevels` (`full` compris),
 * `scopeImplies`, et `defaultLevel`, le niveau d'un compte qui n'en dit pas (celui de la description, sinon `full`).
 */
export type ServiceAccountAuth = {
  kind: "service_account"
  tokenUrl: string
  key: string
  scopes: string[]
  accessLevels: Record<string, string[]> | null
  scopeImplies: Record<string, string[]>
  defaultLevel: string
}

/** Les refus d'une clé, nommés comme les cas communs du format (`connectors/_cases/jwt_bearer.yaml`). */
export type ServiceAccountKeyRefusal =
  | "service_account_key_not_json"
  | "service_account_key_incomplete"
  | "service_account_key_foreign_token_uri"
  | "service_account_key_unreadable"

/** La clé lue : l'émetteur de l'assertion, l'identifiant de la clé (`kid`), la clé privée RSA. */
export type ServiceAccountKey = { clientEmail: string; keyId: string | null; privateKey: KeyObject }

/** La durée de vie d'une assertion, en secondes (le maximum de Google). */
const ASSERTION_LIFETIME_S = 3600
const GRANT_TYPE = "urn:ietf:params:oauth:grant-type:jwt-bearer"
// L'étiquette PEM d'une clé PKCS#8, jamais écrite avec ses tirets : la garde de secrets refuse un en-tête de clé privée.
const PEM_HEAD = `-----BEGIN ${"PRIVATE KEY"}-----\n`
/** Une adresse de jeton fixe en https : ni gabarit, ni query, ni fragment, ni `/` final. */
const FIXED_HTTPS = /^https:\/\/[^\s{}?#]*[^/\s{}?#]$/

/** Les droits déclarés : `scopes` (non vide) sans niveaux, ou des niveaux et `defaultLevel`, un niveau déclaré. */
function scopesOf(head: string, auth: Record<string, unknown>): Pick<ServiceAccountAuth, "scopes" | "accessLevels" | "scopeImplies" | "defaultLevel"> | string {
  const { scopes, accessLevels, scopeImplies, defaultLevel } = auth
  if (accessLevels === undefined) {
    if (scopeImplies !== undefined || defaultLevel !== undefined) return `${head}: scopeImplies and defaultLevel need accessLevels.`
    if (!Array.isArray(scopes) || scopes.length === 0 || !scopes.every((scope) => typeof scope === "string" && scope !== "" && !/\s/.test(scope))) return `${head} needs scopes, a non-empty list.`
    return { scopes: [...(scopes as string[])], accessLevels: null, scopeImplies: {}, defaultLevel: FULL_LEVEL }
  }
  const declared = readAccessLevels(head, auth)
  if (typeof declared === "string") return declared
  const level = defaultLevel ?? FULL_LEVEL
  if (typeof level !== "string" || !(level in declared.levels)) return `${head}: defaultLevel must name a declared access level (${Object.keys(declared.levels).join(", ")}).`
  return { scopes: [], accessLevels: declared.levels, scopeImplies: declared.implies, defaultLevel: level }
}

/**
 * Le problème d'un `oauth2_jwt_bearer` déclaré, ou ce qu'il prépare : `tokenUrl` fixe en https (jamais `tokenUrls`),
 * `scopes` non vide ou des niveaux d'accès (`scopesOf`), `key` qui nomme le seul champ du credential, secret (règle 2 de
 * la fabrique).
 */
export function prepareServiceAccount(definition: ConnectorDefinition, auth: Record<string, unknown>): ServiceAccountAuth | string {
  const head = `${definition.name}: auth oauth2_jwt_bearer`
  const { tokenUrl, key } = auth
  if (typeof tokenUrl !== "string" || !FIXED_HTTPS.test(tokenUrl) || auth.tokenUrls !== undefined) return `${head} needs a fixed https tokenUrl (no template, query nor tokenUrls).`
  const declared = scopesOf(head, auth)
  if (typeof declared === "string") return declared
  const fields = definition.credential
  if (typeof key !== "string" || fields.length !== 1 || fields[0].name !== key || !fields[0].secret) return `${head}: key must name the one credential field, secret (the JSON key file).`
  return { kind: "service_account", tokenUrl, key, ...declared }
}

/**
 * Le niveau d'un compte de service pour un appel : celui du compte (`accessLevel`), sinon `defaultLevel` ; `null` sans
 * niveaux. Un niveau non déclaré lève (`resolveLevel`).
 */
export function serviceAccountLevel(definition: ConnectorDefinition, auth: ServiceAccountAuth, accessLevel: string | undefined): string | null {
  return resolveLevel(definition.name, declaredLevels(auth), accessLevel, auth.defaultLevel)
}

/** Les droits que demande l'assertion au niveau `level` : `scopes` sans niveaux, sinon ceux du niveau. */
export function serviceAccountScopes(auth: ServiceAccountAuth, level: string | null): string[] {
  return level === null || auth.accessLevels === null ? auth.scopes : auth.accessLevels[level]
}

const sameScopes = (kept: readonly string[] | undefined, wanted: readonly string[]): boolean =>
  kept !== undefined && kept.length === wanted.length && [...kept].sort().join(" ") === [...wanted].sort().join(" ")

const keyRefused = (label: string, refusal: ServiceAccountKeyRefusal, why: string) =>
  new PlatformError("not_enabled", `The ${label} service account key of this account ${why}: refused. Ask whoever manages the account to paste its JSON key file again.`, { refusal })

/**
 * La clé d'un compte lue, ou son refus, avant tout envoi et dans cet ordre : pas un objet JSON ; `client_email` ou
 * `private_key` absent ou vide ; `token_uri` autre que `tokenUrl` (la clé est un texte saisi, elle ne choisit pas où part
 * une assertion signée) ; `private_key` qui n'est pas une clé RSA en PEM PKCS#8. Refus `not_enabled`, nommé dans
 * `details.refusal` ; ni la clé ni un morceau d'elle n'y figurent.
 */
export function readServiceAccountKey(auth: ServiceAccountAuth, text: string, label: string): ServiceAccountKey {
  let file: unknown
  try {
    file = JSON.parse(text)
  } catch {
    throw keyRefused(label, "service_account_key_not_json", "is not a JSON object")
  }
  if (!isJsonObject(file)) throw keyRefused(label, "service_account_key_not_json", "is not a JSON object")
  const { client_email: clientEmail, private_key: pem, private_key_id: keyId } = file
  if (typeof clientEmail !== "string" || clientEmail === "" || typeof pem !== "string" || pem === "") {
    throw keyRefused(label, "service_account_key_incomplete", "lacks client_email or private_key")
  }
  if ("token_uri" in file && file.token_uri !== auth.tokenUrl) throw keyRefused(label, "service_account_key_foreign_token_uri", "names another token address (token_uri)")
  const unreadable = keyRefused(label, "service_account_key_unreadable", "has a private_key that is not an RSA key in PKCS#8 PEM")
  if (!pem.startsWith(PEM_HEAD)) throw unreadable
  let privateKey: KeyObject
  try {
    privateKey = createPrivateKey({ key: pem, format: "pem" })
  } catch {
    throw unreadable
  }
  if (privateKey.asymmetricKeyType !== "rsa") throw unreadable
  return { clientEmail, keyId: typeof keyId === "string" && keyId !== "" ? keyId : null, privateKey }
}

const segment = (value: object) => Buffer.from(JSON.stringify(value), "utf8").toString("base64url")

/**
 * L'assertion signée (`compte.md` du format, § Le compte de service) : en-tête `{ alg, typ, kid? }` et revendications
 * `{ iss, scope, aud, iat, exp }`, `scope` les droits demandés joints par des espaces, JSON compact dans cet ordre, en
 * base64url sans remplissage, puis la signature RSASSA-PKCS1-v1_5 SHA-256 de `en-tête.revendications`. `now` : en
 * secondes.
 */
export function serviceAccountAssertion(auth: ServiceAccountAuth, key: ServiceAccountKey, now: number, scopes: readonly string[]): string {
  const header = { alg: "RS256", typ: "JWT", ...(key.keyId === null ? {} : { kid: key.keyId }) }
  const claims = { iss: key.clientEmail, scope: scopes.join(" "), aud: auth.tokenUrl, iat: now, exp: now + ASSERTION_LIFETIME_S }
  const input = `${segment(header)}.${segment(claims)}`
  return `${input}.${createSign("RSA-SHA256").update(input, "utf8").sign(key.privateKey).toString("base64url")}`
}

/**
 * Le jeton d'accès d'un compte de service pour un appel. `fresh` : un jeton neuf même si celui du compte n'est pas échu
 * (après un 401). Un jeton gardé sert tant qu'il n'est pas à moins d'une minute de son échéance et, avec des niveaux,
 * qu'il porte les droits du niveau du compte (rangés avec lui) ; sinon la clé se lit,
 * l'assertion se signe et s'échange par un seul `POST` en formulaire, sans redirection suivie. Refus : la clé
 * (`readServiceAccountKey`) ; `invalid_grant`, la clé révoquée ou le compte désactivé (`credential_rejected`, qui marque
 * le compte) ; tout autre refus, une redirection comprise (`upstream_error`).
 */
export async function serviceAccountToken(signer: Signer & { auth: ServiceAccountAuth }, fresh: boolean): Promise<string> {
  const { auth, credential, definition } = signer
  const scopes = serviceAccountScopes(auth, serviceAccountLevel(definition, auth, credential.accessLevel))
  const kept = fresh ? null : await credential.tokens.read()
  const forLevel = auth.accessLevels === null || sameScopes(kept?.scopes, scopes)
  if (kept !== null && forLevel && (kept.expiresAt === null || kept.expiresAt.getTime() - EXPIRY_MARGIN_MS > Date.now())) return kept.token
  const label = definition.label
  const key = readServiceAccountKey(auth, credential.fields[auth.key], label)
  const assertion = serviceAccountAssertion(auth, key, Math.floor(Date.now() / 1000), scopes)
  const request: ApiRequest = { method: "POST", path: "", headers: {}, form: [["grant_type", GRANT_TYPE], ["assertion", assertion]], pacingKey: `token:${signer.accountId}` }
  const answer = await requestToken({ label, baseUrl: auth.tokenUrl, timeoutMs: definition.timeoutMs, errors: [] }, request, signer.fetcherFor(false))
  if (!answer.ok) {
    if (answer.error === "invalid_grant") {
      throw new PlatformError("credential_rejected", `${label} refused the service account key of this account (invalid_grant): the key was revoked or deleted, or the service account disabled.`)
    }
    const said = answer.error === null ? "" : `, ${answer.error}`
    throw new PlatformError("upstream_error", `${label} refused the token request of this service account (status ${answer.status}${said}). Check the rights granted to it, or retry later.`)
  }
  const token = isJsonObject(answer.answer) ? answer.answer.access_token : undefined
  if (!isJsonObject(answer.answer) || typeof token !== "string" || !token) {
    console.error(`[platform] connector ${label}: token answer without access_token`)
    throw new PlatformError("upstream_error", `${label} sent an unreadable token answer. Retry later.`)
  }
  await credential.tokens.write({ token, expiresAt: expiryOf(answer.answer, null, Date.now()), ...(auth.accessLevels === null ? {} : { scopes }) })
  return token
}
