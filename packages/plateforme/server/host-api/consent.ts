// Le jeton qu'une fonction de l'API d'un hôte envoie (`fonctions-d-un-hote-jeton.md` § Ordre), dans un ordre fixe : l'échange
// RFC 8693 d'abord (`exchange.ts`) ; s'il désigne un client tiers, le consentement de la personne s'il est rangé (son
// compte `host_api`, renouvelé comme tout compte `oauth2_user`) ; sinon le refus qui porte l'adresse de la
// connexion (`connect-link.ts`). Aucun repli silencieux : un autre refus de l'échange est une erreur, jamais un consentement. Le jeton de la
// personne ne part jamais vers l'hôte, ni un jeton consenti par une autre personne. Sans ce module, un client MCP tiers
// n'atteindrait pas l'API de l'hôte.
import type { FunctionContext } from "../catalog/define"
import { ownConsentCredential } from "../connectors/account-secret"
import { accountRows, summary } from "../connectors/accounts"
import { connectRefusal } from "../connectors/connect-link"
import { HOST_CONSENT_CONNECTOR } from "../connectors/definition"
import { consentAccessToken } from "../connectors/oauth-user"
import { inTransaction, PlatformError } from "../errors"
import { consentAccessFor } from "./consent-access"
import type { ImportedHost } from "./document"
import { claimsOf, exchangedToken } from "./exchange"

/**
 * Le refus d'un appel qu'aucune voie ne porte : l'adresse stable de la connexion (`connectRefusal`, geste `oauth`), qui
 * pose la demande de consentement quand la personne l'ouvre et l'envoie chez l'émetteur. `why` : ce qui précède, quand
 * un consentement rangé ne vaut plus (`reconnect`) ; sans lui, aucun n'est rangé (`no_account`). L'adresse est celle de
 * l'organisation appelée (`origin`).
 */
async function consentLink(context: FunctionContext, imported: ImportedHost, why?: string): Promise<PlatformError> {
  const said = why ?? `oto is not authorized to act on ${imported.title} for you from this client.`
  return connectRefusal(context, { reason: why ? "reconnect" : "no_account", connector: HOST_CONSENT_CONNECTOR, label: imported.title, said })
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
    credential = await ownConsentCredential(context, account, access)
    // `fetch` lu à l'appel : l'émetteur de l'instance est une adresse de sa configuration, jamais une saisie.
    const fetcherFor = () => (input: string, init: RequestInit) => fetch(input, { ...init, redirect: "error" })
    token = await consentAccessToken({ auth: access.auth, definition: access.definition, credential, accountId: account.id, fetcherFor }, false)
  } catch (error) {
    // Un consentement sans jeton, ou que l'émetteur ne renouvelle plus (passé à reconnecter) : le lien, pour consentir à nouveau.
    if (error instanceof PlatformError && error.code === "not_enabled") throw await consentLink(context, imported, `The authorization given to oto for ${imported.title} no longer holds.`)
    throw error
  }
  const given = claimsOf(token)?.sub
  if (typeof given !== "string") {
    console.error(`[platform] host api ${imported.title}: the consented token does not say its subject`)
    throw new PlatformError("upstream_error", `The issuer gave a token for ${imported.title} that does not say whom it is for. Retry later.`)
  }
  if (given !== claimsOf(subjectToken)?.sub) {
    await credential.consent?.revoked("the authorization was given under another account of the issuer")
    throw await consentLink(context, imported, `The authorization given to oto for ${imported.title} was given under another account.`)
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
