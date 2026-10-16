// Le parcours du consentement d'une personne à un connecteur `oauth2_user` (`connecteurs-et-comptes.md` § Consentement
// d'une personne) : le départ, pour la personne connectée, qui rend l'adresse d'autorisation du tiers ; puis le retour
// sur l'adresse de retour du paquet, qui échange le code, lit qui a consenti et range les jetons, chiffrés, sur le
// compte personnel de cette personne (créé, ou reconnecté). La demande en cours tient dans `connector_consents` : le
// `state` est tiré au hasard (256 bits), la base n'en garde que l'empreinte, il est lié à la personne, à
// l'organisation et au connecteur, vaut dix minutes et ne sert qu'une fois ; la preuve PKCE en est tirée par la clé du
// coffre, rien d'autre n'est gardé. L'application OAuth est celle que l'hôte a fournie à `registerConnectors`. Sans ce
// module, un compte `oauth2_user` ne se connecterait pas. Aucun jeton, code ni secret n'est rendu ni journalisé.
import { createHash, randomBytes } from "node:crypto"
import { connectorConsentReturnSchema, connectorConsentSchema } from "../../schemas/connectors"
import { declaredConnector, type DeclaredConnector } from "../catalog/connector-source"
import type { PlatformDb } from "../db"
import { fromDatabaseError, invalidInput, isUniqueViolation, PlatformError } from "../errors"
import type { Identity } from "../identity"
import { cut } from "../journal"
import { applicationMissing } from "./account-secret"
import { accountRows, summary, type AccountSummary } from "./accounts"
import type { AccountCredential, StoredToken } from "./auth"
import { keepDeclaredConnector } from "./declaration"
import type { OAuthApplication } from "./definition"
import { executeDescribed, valueAt } from "./engine"
import type { Fetch } from "./http"
import { authorizationAddress, exchangeCode, type ConsentTokens, type UserConsentAuth } from "./oauth-user"
import { consentVerifier, encryptCredential, encryptToken } from "./vault"

/** Le chemin de l'adresse de retour, sous la porte du paquet, à déclarer chez le tiers avec l'origine de chaque adresse. */
export const CONNECTOR_CONSENT_CALLBACK_PATH = "/api/platform/connector-consent/callback"
/** L'écran où revenir quand le départ n'en nomme pas : l'écran Connecteurs du paquet. */
export const CONSENT_DEFAULT_RETURN = "/admin/connectors"
/** Durée d'une demande de consentement. */
const CONSENT_TTL_MINUTES = 10

/** L'adresse de retour d'un consentement pour l'adresse de l'organisation (`https://acme.example.com`). */
export function connectorConsentRedirectUri(origin: string): string {
  return `${origin}${CONNECTOR_CONSENT_CALLBACK_PATH}`
}

const stateHash = (state: string) => createHash("sha256").update(state, "utf8").digest("hex")
const challengeOf = (verifier: string) => createHash("sha256").update(verifier, "ascii").digest("base64url")

/** Un connecteur à consentement déclaré, avec son application OAuth ; sinon le refus nommé. */
function consentConnector(name: string): DeclaredConnector & { auth: UserConsentAuth; application: OAuthApplication; identity: NonNullable<DeclaredConnector["identity"]> } {
  const declared = declaredConnector(name)
  if (!declared || declared.auth.kind !== "user_consent" || !declared.identity) {
    throw new PlatformError("invalid_arguments", `Connector ${name} does not connect by a person's consent.`)
  }
  if (!declared.application) throw applicationMissing(declared.definition.label)
  return { ...declared, auth: declared.auth, application: declared.application, identity: declared.identity }
}

/**
 * Démarre le consentement de la personne connectée à un connecteur `oauth2_user` et rend l'adresse d'autorisation du
 * tiers, où l'envoyer : scopes de la description (ceux du niveau `full` pour un connecteur à niveaux d'accès, que le
 * paquet n'applique pas encore), `state` à usage unique, preuve PKCE (S256), adresse de retour du paquet à l'adresse
 * de l'organisation (`connectorConsentRedirectUri(origin)`). `return_to` : l'écran de l'hôte où revenir ensuite
 * (l'écran Connecteurs par défaut). Les demandes échues de l'organisation sont purgées au passage. Refus : saisie
 * invalide, connecteur sans consentement (`invalid_arguments`), application OAuth absente (`not_enabled`).
 */
export async function startConnectorConsent(db: PlatformDb, identity: Identity, input: unknown, options: { origin: string }): Promise<{ url: string }> {
  const parsed = connectorConsentSchema.safeParse(input)
  if (!parsed.success) throw invalidInput(parsed.error)
  const connector = consentConnector(parsed.data.connector)
  const state = randomBytes(32).toString("base64url")
  const challenge = challengeOf(consentVerifier(state))
  await db
    .tx(async (sql) => {
      await sql`delete from platform.connector_consents where org_id = ${identity.org.id} and expires_at < now()`
      await keepDeclaredConnector(sql, connector.definition.name)
      await sql`
        insert into platform.connector_consents (state_hash, org_id, user_id, connector, return_to, expires_at)
        values (${stateHash(state)}, ${identity.org.id}, ${identity.user.id}, ${connector.definition.name}, ${parsed.data.return_to ?? null},
                now() + make_interval(mins => ${CONSENT_TTL_MINUTES}))`
    })
    .catch((error) => {
      throw fromDatabaseError(error, "startConnectorConsent: connector_consents")
    })
  const url = authorizationAddress(connector.auth, { clientId: connector.application.clientId, redirectUri: connectorConsentRedirectUri(options.origin), state, codeChallenge: challenge })
  return { url }
}

/** Une demande de consentement retrouvée et consommée : son connecteur et l'écran où revenir. */
type PendingConsent = { connector: string; returnTo: string }

/** Le refus d'un retour sans demande en cours à son `state` : inconnu, déjà servi, échu, ou d'une autre personne. */
const unknownConsent = () => new PlatformError("invalid_arguments", "This connection request is unknown, already used or expired. Connect the account again.")

/**
 * Consomme la demande de consentement de ce `state` : à la personne et à l'organisation de l'appel, non échue ; elle
 * est supprimée par la même requête, et ne sert donc qu'une fois. `null` : aucune.
 */
async function consumePending(db: PlatformDb, identity: Identity, state: string | undefined): Promise<PendingConsent | null> {
  if (!state) return null
  const rows = await db
    .tx((sql) => sql<{ connector: string; return_to: string | null }[]>`
      delete from platform.connector_consents
       where state_hash = ${stateHash(state)} and org_id = ${identity.org.id} and user_id = ${identity.user.id} and expires_at > now()
      returning connector, return_to`)
    .catch((error) => {
      throw fromDatabaseError(error, "completeConnectorConsent: connector_consents")
    })
  const [row] = rows
  return row ? { connector: row.connector, returnTo: row.return_to ?? CONSENT_DEFAULT_RETURN } : null
}

/** Le jeton tout neuf d'un consentement, gardé en mémoire le temps de lire l'identité : rien n'est écrit. */
function freshCredential(tokens: ConsentTokens, application: OAuthApplication, label: string): AccountCredential {
  let kept: StoredToken = { token: tokens.accessToken, expiresAt: tokens.expiresAt }
  return {
    fields: {},
    settings: {},
    tokens: {
      read: async () => kept,
      write: async (token) => {
        kept = token
      },
    },
    consent: {
      application,
      refreshToken: tokens.refreshToken,
      renewed: async (token) => {
        kept = token
      },
      revoked: async () => new PlatformError("upstream_error", `${label} refused the authorization it had just given. Connect the account again.`),
    },
  }
}

/**
 * Qui a consenti : la valeur non vide au chemin `identity.path` de la réponse de la fonction d'identité, ou de l'adresse
 * d'identité (un `GET` avec le jeton neuf, préparé comme une fonction : `declaration.ts`).
 */
async function consentingIdentity(connector: ReturnType<typeof consentConnector>, tokens: ConsentTokens, pacingKey: string): Promise<string> {
  const { definition, auth } = connector
  const credential = freshCredential(tokens, connector.application, definition.label)
  const { answers } = await executeDescribed(connector.identity, { credential, accountId: pacingKey }, {})
  const who = valueAt(answers[0], auth.identity.path)
  if ((typeof who === "string" && who.trim()) || typeof who === "number") return String(who).trim()
  console.error(`[platform] connector ${definition.name}: identity answer without ${auth.identity.path}`)
  throw new PlatformError("upstream_error", `${definition.label} did not say who connected. Nothing was saved; retry later.`)
}

/** Le libellé du compte d'un consentement : qui a consenti, puis le connecteur ; 80 caractères au plus. */
export function consentLabel(who: string, connector: string): string {
  const suffix = ` (${connector})`
  return `${cut(who, 80 - suffix.length)}${suffix}`.toWellFormed()
}

/**
 * Range le consentement sur le compte personnel de la personne : le sien de ce connecteur et de ce libellé s'il
 * existe (une reconnexion : actif de nouveau, raison effacée), sinon un compte neuf, réel. Jetons chiffrés : le jeton
 * de rafraîchissement dans le secret du compte, le jeton d'accès et son échéance à part, les droits accordés en clair.
 */
async function keepConsent(db: PlatformDb, identity: Identity, consent: { connector: string; label: string; tokens: ConsentTokens; scopes: string[] }): Promise<AccountSummary> {
  const { connector, label, tokens, scopes } = consent
  const orgId = identity.org.id
  const userId = identity.user.id
  return db
    .tx(async (sql) => {
      const [own] = await sql<{ id: string }[]>`
        select id from platform.accounts
         where org_id = ${orgId} and connector = ${connector} and owner_kind = 'user' and owner_user_id = ${userId} and lower(label) = lower(${label})`
      let id = own?.id
      if (!id) {
        await keepDeclaredConnector(sql, connector)
        const [created] = await sql<{ id: string }[]>`
          insert into platform.accounts (org_id, connector, owner_kind, owner_team_id, owner_user_id, label, mode, status)
          values (${orgId}, ${connector}, 'user', null, ${userId}, ${label}, 'reel', 'active')
          returning id`
        id = created.id
      }
      const fields: Record<string, string> = tokens.refreshToken ? { refresh_token: tokens.refreshToken } : {}
      await sql`
        update platform.accounts
           set secret_ciphertext = ${encryptCredential(id, fields)}, secret_fields = ${Object.keys(fields)}::text[], secret_updated_at = now(),
               token_ciphertext = ${encryptToken(id, tokens.accessToken)}, token_expires_at = ${tokens.expiresAt}, granted_scopes = ${scopes}::text[],
               status = 'active', status_reason = null
         where id = ${id}`
      const [written] = await accountRows(sql, orgId, { id })
      if (!written) {
        console.error(`[platform] completeConnectorConsent: account ${id} written but not read back`)
        throw new PlatformError("internal", "Internal error.")
      }
      return summary(written)
    })
    .catch((error) => {
      if (isUniqueViolation(error)) throw new PlatformError("conflict", `An account labelled ${label} already exists in ${identity.org.name}, held by someone else. Ask an administrator of ${identity.org.name}.`)
      throw fromDatabaseError(error, "completeConnectorConsent: accounts")
    })
}

/**
 * Le retour du tiers sur l'adresse de retour (`GET connector-consent/callback`) : la demande de ce `state` consommée
 * (à la personne de l'appel, une seule fois), puis le code échangé contre les jetons, l'identité lue pour nommer le
 * compte, et les jetons rangés sur le compte personnel de la personne. Rend le compte et l'écran où revenir, que
 * l'appelant reçoit même sur un refus postérieur à la consommation (`returnTo` du refus, en `details`). Refus : demande
 * inconnue, servie, échue ou d'une autre personne, consentement refusé par la personne ou le tiers, code refusé
 * (`invalid_arguments`) ; application refusée, identité absente, panne du tiers (`upstream_error`) ; libellé pris par un
 * autre compte (`conflict`). Rien n'est rangé sur un refus.
 */
export async function completeConnectorConsent(
  db: PlatformDb,
  identity: Identity,
  input: unknown,
  options: { origin: string },
): Promise<{ account: AccountSummary; returnTo: string }> {
  const parsed = connectorConsentReturnSchema.safeParse(input)
  const pending = parsed.success ? await consumePending(db, identity, parsed.data.state) : null
  if (!parsed.success || !pending) throw unknownConsent()
  try {
    const connector = consentConnector(pending.connector)
    const label = connector.definition.label
    const { code, error, state } = parsed.data
    if (error !== undefined) {
      const said = /^[A-Za-z0-9_.-]{1,64}$/.test(error) ? error : "error"
      throw new PlatformError("invalid_arguments", said === "access_denied" ? `The connection to ${label} was refused or cancelled.` : `${label} did not give the authorization (${said}).`)
    }
    if (!code || !state) throw new PlatformError("invalid_arguments", `${label} came back without an authorization code. Connect the account again.`)
    // `fetch` lu à l'appel, jamais au chargement : l'hôte (et un test) peut le remplacer.
    const fetcher: Fetch = (address, init) => fetch(address, init)
    const pacingKey = `consent:${stateHash(state)}`
    const call = { definition: connector.definition, auth: connector.auth, application: connector.application, pacingKey, fetcher }
    const tokens = await exchangeCode(call, { code, redirectUri: connectorConsentRedirectUri(options.origin), verifier: consentVerifier(state) })
    const who = await consentingIdentity(connector, tokens, pacingKey)
    const name = connector.definition.name
    const account = await keepConsent(db, identity, { connector: name, label: consentLabel(who, name), tokens, scopes: tokens.scopes ?? connector.auth.scopes })
    return { account, returnTo: pending.returnTo }
  } catch (error) {
    if (error instanceof PlatformError) throw new PlatformError(error.code, error.message, { ...error.details, returnTo: pending.returnTo })
    throw error
  }
}
