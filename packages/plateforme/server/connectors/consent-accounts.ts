// Les comptes d'un connecteur dont chaque personne connecte le sien : à consentement (`oauth2_user`,
// `connecteurs-et-comptes.md` § Consentement d'une personne) ou à compte rattaché (`accountIdentity`, § Compte de
// l'hôte et compte rattaché). Un tel compte est le compte personnel de qui l'a connecté ; ses appels le prennent sans
// le nommer (`droits-d-acces.md` § Partage d'un compte de connecteur) ; à défaut, la personne connecte le sien, ou
// reconnecte celui que le tiers ne reconnaît plus. Partagé, il sert à qui le
// reçoit comme tout compte personnel : nommé (`account`), sous la règle d'accès posée (H83). Lu par la
// résolution du compte (`resolution.ts`), les lignes de `context` (`lines.ts`) et le renouvellement d'un consentement
// (`account-secret.ts`) : sans ce module, chacun redirait la règle et ses refus.
import { declaredConnector } from "../catalog/connector-source"
import { PlatformError } from "../errors"
import type { Identity } from "../identity"
import { levelName, type ConnectorAccount } from "./accounts"
import type { AccountChoice } from "./resolution"

/**
 * La personne dont le compte porte, sans être nommé, l'appel d'un connecteur dont chaque personne connecte le sien
 * (consentement `oauth2_user`, compte rattaché `accountIdentity`) : l'appelant ; `undefined` pour tout autre connecteur
 * (la résolution ordinaire, H83).
 */
export function personalOwnerOf(connector: string, identity: Identity): string | undefined {
  const declared = declaredConnector(connector)
  const personal = declared?.auth.kind === "user_consent" || declared?.definition.accountIdentity !== undefined
  return personal ? identity.user.id : undefined
}

/**
 * Le compte d'un connecteur dont chaque personne connecte le sien : celui de la personne, actif ; plusieurs → ambiguïté ; aucun actif, celui
 * qui est à reconnecter (en erreur), sinon aucun : la personne connecte le sien.
 */
export function ownAccount(accounts: readonly ConnectorAccount[], owner: string): AccountChoice {
  const own = accounts.filter((account) => account.owner.kind === "user" && account.owner.userId === owner)
  const active = own.filter((account) => account.status === "active")
  if (active.length > 1) return { kind: "ambiguous_step", team: null, accounts: active }
  if (active.length === 0) return { kind: "connect_needed", account: own.find((account) => account.status === "error") ?? null }
  const { id, label, connector, mode, owner: holder, level } = active[0]
  return { kind: "account", account: { id, label, connector, mode, owner: holder, level: levelName(level), source: "personal" } }
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

/** Le refus d'un appel sans compte de la personne : aucun, elle connecte le sien ; le sien en erreur, elle le reconnecte. */
export function consentRefusal(connector: string, account: ConnectorAccount | null): PlatformError {
  if (account) return reconnectRefusal(connector, account.label, account.statusReason ?? null)
  return new PlatformError(
    "not_enabled",
    `No ${connector} account of yours is connected: each person connects their own to ${connector}. Ask the user to connect theirs in the application (Connect my account).`,
  )
}
