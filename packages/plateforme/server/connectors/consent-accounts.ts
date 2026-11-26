// Les comptes d'un connecteur dont chaque personne connecte le sien : à consentement (`oauth2_user`,
// `connecteurs-et-comptes.md` § Consentement d'une personne) ou à compte rattaché (`accountIdentity`, § Compte de
// l'hôte et compte rattaché). Un tel compte est le compte personnel de qui l'a connecté ; ses appels le prennent sans
// le nommer, comme tout compte personnel de l'appelant (`droits-d-acces.md` § Partage d'un compte de connecteur) ; faute
// de compte, la personne connecte le sien, ou reconnecte celui que le tiers ne reconnaît plus. Partagé, il sert à qui
// le reçoit comme tout compte personnel : nommé (`account`), sous la règle d'accès posée (H83). Lu par la résolution du
// compte (`resolution.ts`), les lignes de `context` (`lines.ts`) et le renouvellement d'un consentement
// (`account-secret.ts`) : sans ce module, chacun redirait ses refus.
import { declaredConnector } from "../catalog/connector-source"
import type { PlatformError } from "../errors"
import type { AccountOwner, ConnectorAccount } from "./accounts"
import { connectRefusal, ownerNameOf, refusalFromPlan, type ConnectionPlan, type ConnectWhere } from "./connect-link"

/**
 * Un connecteur dont chaque personne peut connecter le sien (consentement `oauth2_user`, par son seul accès ou par l'un
 * de ses accès ; compte rattaché `accountIdentity`) : faute de compte, son refus dit à la personne de connecter le sien
 * plutôt que d'en demander un à un administrateur.
 */
export function isPersonalConnector(connector: string): boolean {
  const declared = declaredConnector(connector)
  return declared?.accesses.some((access) => access.auth.kind === "user_consent") === true || declared?.definition.accountIdentity !== undefined
}

/**
 * Ce qui manque à un compte à consentement ou rattaché à reconnecter (`status_reason` : la raison), à la résolution comme
 * au renouvellement ; l'action et l'adresse viennent de `connect-link.ts`.
 */
export function reconnectSaid(connector: string, label: string, reason: string | null, own = true): string {
  const why = reason ? `: ${reason}` : ""
  return own ? `Your ${connector} account « ${label} » must be connected again${why}.` : `The ${connector} account « ${label} » must be connected again${why}.`
}

/**
 * Le refus d'un appel sans compte de la personne, la connexion décidée (`plan`) : aucun, elle connecte le sien ; le sien
 * en erreur, elle le reconnecte. `shared` : la phrase et les précisions qui nomment les comptes personnels partagés avec
 * elle (`resolution.ts`).
 */
export function consentRefusal(plan: ConnectionPlan, orgName: string, account: ConnectorAccount | null, shared: { text: string; details?: Record<string, unknown> }): PlatformError {
  const { connector } = plan
  if (account) return refusalFromPlan(plan, orgName, { reason: "reconnect", said: reconnectSaid(connector, account.label, account.statusReason ?? null), shared })
  const said = `No ${connector} account of yours is connected: each person connects their own to ${connector}.`
  return refusalFromPlan(plan, orgName, { reason: "no_account", said, shared })
}

/**
 * Le refus d'un compte à reconnecter de l'appel, avec l'adresse de la connexion (`connect-link.ts`) : à transmettre à
 * la personne à qui il est, nommée par l'annuaire, quand il est partagé par une autre. Un compte personnel partagé
 * n'est jamais celui d'une personne partie (`chooseAccount`) : un propriétaire absent de l'annuaire est une faute.
 */
export function reconnectRefuser(where: ConnectWhere, connector: string, account: { id: string; access?: string; owner: AccountOwner }, own: boolean) {
  return async (said: string) => {
    const base = { reason: "reconnect" as const, connector, access: account.access ?? null, said }
    if (own || account.owner.kind !== "user") return connectRefusal(where, base)
    return connectRefusal(where, { ...base, owner: await ownerNameOf(where, account) })
  }
}
