// Le consentement d'une personne à l'API de l'hôte de son organisation (`fonctions-d-un-hote.md` § Jeton, voie
// third-party) : le parcours `oauth2_user` du paquet (`connectors/consent.ts`, `connectors/oauth-user.ts`), construit
// depuis le document servi et l'émetteur de l'instance plutôt que depuis une description déclarée. La personne autorise
// une fois l'instance, cliente de l'émetteur (`PLATFORM_OIDC_CONSENT_CLIENT_ID` et `_SECRET`, `cell.ts`), à appeler l'API
// (`resource`) aux scopes de toutes ses familles, `offline_access` compris pour le jeton de rafraîchissement ; le compte
// personnel `host_api` de la personne garde ce jeton, chiffré, avec la ressource consentie. Sans ce module, un client MCP
// tiers, dont l'émetteur n'échange pas le jeton, n'atteindrait pas l'API de l'hôte.
import { CONSENT_CLIENT_ENV } from "../cell"
import type { ConsentAccess } from "../connectors/consent"
import { HOST_CONSENT_CONNECTOR, HOST_CONSENT_CONNECTOR_LABEL, type ConnectorView, type OAuthApplication } from "../connectors/definition"
import type { ConsentFlow } from "../connectors/oauth-user"
import type { PlatformDb } from "../db"
import { PlatformError } from "../errors"
import type { Identity } from "../identity"
import { issuerEndpoint } from "./exchange"
import type { ImportedHost } from "./document"
import { servedHost } from "./served"

/** Délai d'une demande au point de jeton de l'émetteur (code, renouvellement). */
const CONSENT_TIMEOUT_MS = 10_000
/**
 * Les scopes que l'émetteur exige en plus de ceux des familles : `openid`, et `offline_access` pour le jeton de
 * rafraîchissement, que Logto ne rend qu'avec `prompt=consent`.
 */
const OIDC_SCOPES = ["openid", "offline_access"]

/** Le client de consentement de l'instance chez son émetteur ; une variable manquante se dit par son nom, jamais par une valeur. */
export function consentApplication(): OAuthApplication {
  const clientId = process.env[CONSENT_CLIENT_ENV.id]
  const clientSecret = process.env[CONSENT_CLIENT_ENV.secret]
  if (!clientId || !clientSecret) {
    console.error(`[platform] host api: ${!clientId ? CONSENT_CLIENT_ENV.id : CONSENT_CLIENT_ENV.secret} missing: no consent of a third-party client`)
    throw new PlatformError("internal", "Internal error.")
  }
  return { clientId, clientSecret }
}

/** Le connecteur vu par le moteur : son nom, le titre de l'API pour les messages, le délai de l'émetteur. */
export function consentView(imported: ImportedHost): ConnectorView {
  return {
    name: HOST_CONSENT_CONNECTOR,
    label: imported.title,
    auth: { kind: "oauth2_user" },
    credential: [],
    modes: ["byo_user"],
    errors: [],
    functions: [],
    timeoutMs: CONSENT_TIMEOUT_MS,
  }
}

/**
 * Le parcours du consentement à l'API servie : adresses de la découverte de l'émetteur, client `basic`, scopes OIDC puis
 * ceux des familles, `resource` (RFC 8707) à l'autorisation et à chaque demande de jeton (sans lui, Logto rend un jeton
 * opaque, sans l'audience de l'API), `prompt=consent`, renouvellement par jeton de rafraîchissement.
 */
export async function hostConsentFlow(imported: ImportedHost): Promise<ConsentFlow> {
  const [authorize, token] = await Promise.all([issuerEndpoint(imported.issuer, "authorizationEndpoint"), issuerEndpoint(imported.issuer, "tokenEndpoint")])
  return {
    kind: "user_consent",
    authorize: { template: authorize },
    token: { template: token },
    clientAuth: "basic",
    scopes: [...new Set([...OIDC_SCOPES, ...imported.consentScopes])],
    accessLevels: null,
    scopeImplies: {},
    authorizeParams: { resource: imported.resource, prompt: "consent" },
    tokenParams: { resource: imported.resource },
    refresh: "refresh_token",
    exchange: null,
    expiresInDefault: null,
  }
}

/**
 * Ce qui se consent pour une API servie : son parcours, le client de consentement, et le compte `host_api` de la
 * personne, un seul par personne, au libellé du titre de l'API, qui retient la ressource consentie
 * (`settings.resource`). Refus : client de consentement absent (`internal`, journalisé par le nom de la variable).
 */
export async function consentAccessFor(imported: ImportedHost): Promise<ConsentAccess> {
  const application = consentApplication()
  return {
    definition: consentView(imported),
    name: null,
    auth: await hostConsentFlow(imported),
    application,
    accountLabel: async () => imported.title.slice(0, 80).toWellFormed(),
    settings: { resource: imported.resource },
    single: true,
    keep: async (sql) => {
      await sql`select platform.declare_connector(${HOST_CONSENT_CONNECTOR}, ${HOST_CONSENT_CONNECTOR_LABEL})`
    },
  }
}

/**
 * Ce qui se consent pour l'API de l'hôte de l'organisation de `identity` (`consentAccessFor`). Refus : organisation sans
 * API d'hôte servie (`invalid_arguments`).
 */
export async function hostConsentAccess(db: PlatformDb, identity: Identity): Promise<ConsentAccess> {
  const host = await servedHost(db, identity)
  if (!host) throw new PlatformError("invalid_arguments", `The organisation ${identity.org.name} has no API of a host to consent to.`)
  return consentAccessFor(host.imported)
}
