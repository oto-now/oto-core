// Les comptes d'un connecteur dont chaque personne connecte le sien : à consentement (`oauth2_user`,
// `connecteurs-et-comptes.md` § Consentement d'une personne) ou à compte rattaché (`accountIdentity`, § Compte de
// l'hôte et compte rattaché). Un tel compte est le compte personnel de qui l'a connecté ; ses appels le prennent sans
// le nommer, comme tout compte personnel de l'appelant (`droits-d-acces.md` § Partage d'un compte de connecteur) ; faute
// de compte, la personne connecte le sien, ou reconnecte celui que le tiers ne reconnaît plus. Partagé, il sert à qui
// le reçoit comme tout compte personnel : nommé (`account`), sous la règle d'accès posée (H83). Lu par la résolution du
// compte (`resolution.ts`), les lignes de `context` (`lines.ts`) et le renouvellement d'un consentement
// (`account-secret.ts`) : sans ce module, chacun redirait ses refus.
import { declaredConnector } from "../catalog/connector-source"
import { PlatformError } from "../errors"
import type { ConnectorAccount } from "./accounts"

/**
 * Un connecteur dont chaque personne connecte le sien (consentement `oauth2_user`, compte rattaché `accountIdentity`) :
 * faute de compte, son refus dit à la personne de connecter le sien plutôt que d'en demander un à un administrateur.
 */
export function isPersonalConnector(connector: string): boolean {
  const declared = declaredConnector(connector)
  return declared?.auth.kind === "user_consent" || declared?.definition.accountIdentity !== undefined
}

/**
 * Le refus d'un compte à consentement à reconnecter (`status_reason` : la raison), à la résolution comme au
 * renouvellement : à sa personne, qu'elle le reconnecte ; à qui l'a reçu en partage, que sa personne le reconnecte.
 */
export function reconnectRefusal(connector: string, label: string, reason: string | null, own = true): PlatformError {
  const why = reason ? `: ${reason}` : ""
  return new PlatformError(
    "not_enabled",
    own
      ? `Your ${connector} account « ${label} » must be connected again${why}. Ask the user to connect it again in the application (Connect my account).`
      : `The ${connector} account « ${label} » must be connected again${why}. Only its owner can, in the application (Connect my account): ask them.`,
  )
}

/**
 * Le refus d'un appel sans compte de la personne : aucun, elle connecte le sien ; le sien en erreur, elle le reconnecte.
 * `shared` : la phrase et les précisions qui nomment les comptes personnels partagés avec elle (`resolution.ts`).
 */
export function consentRefusal(connector: string, account: ConnectorAccount | null, shared: { text: string; details?: Record<string, unknown> }): PlatformError {
  if (account) return reconnectRefusal(connector, account.label, account.statusReason ?? null)
  return new PlatformError(
    "not_enabled",
    `No ${connector} account of yours is connected: each person connects their own to ${connector}. Ask the user to connect theirs in the application (Connect my account).${shared.text}`,
    shared.details,
  )
}
