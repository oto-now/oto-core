// Le jeton qu'une fonction de l'API d'un hôte envoie (`fonctions-d-un-hote-jeton.md` § Ordre), dans un ordre fixe : l'échange
// RFC 8693 d'abord (`exchange.ts`) ; s'il désigne un client tiers, le consentement de la personne s'il est rangé (son
// compte `host_api`, renouvelé comme tout compte `oauth2_user`) ; sinon le refus qui porte le lien d'autorisation à
// ouvrir. Aucun repli silencieux : un autre refus de l'échange est une erreur, jamais un consentement. Le jeton de la
// personne ne part jamais vers l'hôte, ni un jeton consenti par une autre personne. Sans ce module, un client MCP tiers
// n'atteindrait pas l'API de l'hôte.
import type { FunctionContext } from "../catalog/define"
import { ownConsentCredential } from "../connectors/account-secret"
import { accountRows, summary } from "../connectors/accounts"
import { beginConsent, consentStillOpen } from "../connectors/consent"
import { HOST_CONSENT_CONNECTOR } from "../connectors/definition"
import { consentAccessToken } from "../connectors/oauth-user"
import { inTransaction, PlatformError } from "../errors"
import { consentAccessFor } from "./consent-access"
import type { ImportedHost } from "./document"
import { claimsOf, exchangedToken } from "./exchange"

/** Le refus d'un appel sans consentement rangé : `details.reason`, que `read` sert parmi les refus d'une fonction. */
export const HOST_CONSENT_REQUIRED = "host_consent_required"

/** Ce qu'il reste au moins, en minutes, à la demande d'un lien servi ; plus près de son échéance, une demande neuve. */
export const LINK_LEFT_MINUTES = 5

/** Le dernier lien servi, par organisation, personne, ressource, version du document et adresse de retour. */
const links = new Map<string, string>()

/** Oublie les liens servis ; les tests seuls. */
export function forgetConsentLinks(): void {
  links.clear()
}

/**
 * Le lien d'autorisation de la personne pour l'API : celui de sa demande encore ouverte (au moins `LINK_LEFT_MINUTES`),
 * relue en base par son `state`, sinon une demande neuve (dix minutes, à usage unique, à la personne). Sans lui, chaque
 * lecture de la liste de ses fonctions (`context`, `find`, `read functions`) posait une demande de plus.
 */
async function authorizationLink(context: FunctionContext & { origin: string }, imported: ImportedHost): Promise<string> {
  const { db, identity, origin } = context
  const key = JSON.stringify([identity.org.id, identity.user.id, imported.resource, imported.version, origin])
  const kept = links.get(key)
  if (kept) {
    const state = new URL(kept).searchParams.get("state")
    if (!state) throw new Error("[platform] host api: an authorization link without its state")
    if (await consentStillOpen(db, identity, state, LINK_LEFT_MINUTES)) return kept
    links.delete(key)
  }
  const url = await beginConsent(db, identity, await consentAccessFor(imported), { returnTo: null, origin })
  links.set(key, url)
  return url
}

/**
 * Le refus d'un appel qu'aucune voie ne porte : le lien d'autorisation chez l'émetteur (`authorizationLink`) dans le
 * message et en `details.url`. `why` : ce qui précède, quand un consentement rangé ne vaut plus. L'adresse de retour est
 * celle de l'organisation appelée (`origin`).
 */
async function consentLink(context: FunctionContext, imported: ImportedHost, why = ""): Promise<PlatformError> {
  const { origin } = context
  if (!origin) {
    console.error(`[platform] host api ${imported.title}: no origin to build the consent link`)
    return new PlatformError("internal", "Internal error.")
  }
  const url = await authorizationLink({ ...context, origin }, imported)
  return new PlatformError(
    "not_enabled",
    `${why}Authorize oto to act on ${imported.title} for you: ${url} (ask the user to open this link within ${LINK_LEFT_MINUTES} minutes and sign in, then call again).`,
    { reason: HOST_CONSENT_REQUIRED, url },
  )
}

/** Le compte `host_api` actif de l'appelant, consenti pour cette ressource ; `null` sans lui (désactivé, à reconnecter, autre ressource). */
async function consentAccount(context: FunctionContext, resource: string) {
  const { db, identity } = context
  const rows = await inTransaction(db, "hostConsent: accounts", (sql) => accountRows(sql, identity.org.id, { connector: HOST_CONSENT_CONNECTOR, ownerUserId: identity.user.id }))
  const row = rows.find((candidate) => candidate.status === "active" && candidate.settings.resource === resource)
  return row ? summary(row) : null
}

/**
 * Le jeton consenti de l'appelant pour l'API, renouvelé à son échéance ; sans consentement valable, le refus et son lien.
 * Le jeton se lit (rendu par l'émetteur lui-même) : son `sub` doit être celui du jeton vérifié de l'appelant, sinon la
 * personne a autorisé sous un autre compte de l'émetteur, et le consentement passe à reconnecter.
 */
async function consentedToken(context: FunctionContext, imported: ImportedHost, subjectToken: string): Promise<string> {
  const account = await consentAccount(context, imported.resource)
  if (!account) throw await consentLink(context, imported)
  const access = await consentAccessFor(imported)
  let token: string
  let credential: Awaited<ReturnType<typeof ownConsentCredential>>
  try {
    credential = await ownConsentCredential(context.db, context.identity, account, access)
    // `fetch` lu à l'appel : l'émetteur de l'instance est une adresse de sa configuration, jamais une saisie.
    const fetcherFor = () => (input: string, init: RequestInit) => fetch(input, { ...init, redirect: "error" })
    token = await consentAccessToken({ auth: access.auth, definition: access.definition, credential, accountId: account.id, fetcherFor }, false)
  } catch (error) {
    // Un consentement sans jeton, ou que l'émetteur ne renouvelle plus (passé à reconnecter) : le lien, pour consentir à nouveau.
    if (error instanceof PlatformError && error.code === "not_enabled") throw await consentLink(context, imported, `The authorization given to oto for ${imported.title} no longer holds. `)
    throw error
  }
  const given = claimsOf(token)?.sub
  if (typeof given !== "string") {
    console.error(`[platform] host api ${imported.title}: the consented token does not say its subject`)
    throw new PlatformError("upstream_error", `The issuer gave a token for ${imported.title} that does not say whom it is for. Retry later.`)
  }
  if (given !== claimsOf(subjectToken)?.sub) {
    await credential.consent?.revoked("the authorization was given under another account of the issuer")
    throw await consentLink(context, imported, `The authorization given to oto for ${imported.title} was given under another account. `)
  }
  return token
}

/**
 * Le jeton de la personne pour la fonction `fn` de l'API : échangé au scope de la fonction ; pour un client tiers,
 * consenti. `subjectToken` : le jeton vérifié de l'appelant, qui ne part qu'à l'émetteur.
 */
export async function hostBearer(context: FunctionContext, imported: ImportedHost, scope: string, subjectToken: string): Promise<string> {
  const outcome = await exchangedToken(imported.title, {
    orgId: context.identity.org.id,
    userId: context.identity.user.id,
    subjectToken,
    issuer: imported.issuer,
    resource: imported.resource,
    scope,
  })
  return "token" in outcome ? outcome.token : consentedToken(context, imported, subjectToken)
}
