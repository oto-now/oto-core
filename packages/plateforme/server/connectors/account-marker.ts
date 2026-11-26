// La marque du compte d'un appel (`connecteurs-et-comptes.md` § Le refus nommé) et le refus qu'elle dit : la pose et la
// levée par `platform.mark_account` (`accountMarker`), puis, sur un refus du tiers qui marque, le refus rendu
// (`markRefusal`) : une clé refusée mène l'assistant au geste par une adresse (`connexion-par-l-agent.md`), des crédits
// épuisés disent à qui demander d'en racheter. Ouvert par `account-secret.ts` avec le compte. Sans ce module, chaque refus
// marqué redirait son remède.
import type { AccountMark, AccountMarkReason } from "../../schemas"
import type { PlatformDb } from "../db"
import { inTransaction, PlatformError } from "../errors"
import type { CallAccount } from "./account-secret"
import { markOf, markWords } from "./accounts"
import type { AccountMarker } from "./auth"
import { accountKeyRefusal, type ConnectWhere } from "./connect-link"

/**
 * Pour qui le compte s'ouvre : un appel (`call`), dont le refus mène l'assistant au geste par une adresse, ou la sonde de
 * l'écran Connecteurs (`probe`), qui garde le refus du tiers tel qu'il le dit (`credential_rejected`) pour classer son
 * issue, devant qui gère déjà le compte.
 */
export type CredentialUse = "call" | "probe"

/**
 * Ce qu'une marque ou un refus du compte d'un appel dit pour y remédier : le compte, s'il est celui de l'appelant, s'il se
 * reconnecte, s'il signe par la clé de l'hôte, à qui demander, pour qui il s'ouvre (`use`), `refuse`, le refus d'un compte
 * à reconnecter qui porte l'adresse de la connexion (`connectRefusal`, à transmettre à sa personne quand le compte est
 * partagé), et `refuseKey`, celui d'un compte dont la clé est à poser, qui porte l'adresse de sa saisie
 * (`accountKeyRefusal`).
 */
export type MarkRemedy = {
  account: CallAccount
  own: boolean
  reconnect: boolean
  hostKey: boolean
  use: CredentialUse
  who: () => Promise<string>
  refuse: (said: string) => Promise<PlatformError>
  refuseKey: (reason: "no_account" | "reconnect", said: string) => Promise<PlatformError>
}

/**
 * Le remède d'une marque, en phrase : reconnecter un consentement ou un compte rattaché, faire vérifier la clé de l'hôte,
 * poser une clé neuve, racheter des crédits. Un appel ne le dit que pour ce qu'aucune adresse ne mène (`markRefusal`).
 */
async function remedyOf(reason: AccountMarkReason, remedy: MarkRemedy): Promise<string> {
  const { own, reconnect } = remedy
  if (reason === "credential_rejected" && reconnect) return own ? "Ask the user to connect it again (Connect my account)." : "Only its owner can connect it again: ask them."
  if (reason === "credential_rejected" && remedy.hostKey) return "The key is this application's: ask whoever runs this application to check it."
  const who = own ? "the user" : await remedy.who()
  return reason === "credential_rejected" ? `Ask ${who} to set a new key.` : `Ask ${who} to add credits.`
}

/**
 * La marque du compte d'un appel (`AccountMarker`) : la seule écriture de `accounts.health` est `platform.mark_account`,
 * réservée au rôle du serveur, qui pose ou lève la marque d'un compte d'une organisation de l'appelant, et rien d'autre ; elle garde la date d'une
 * marque reposée pour la même raison. Rien n'est écrit quand la marque lue ne change pas : un appel réussi sur un compte
 * sans marque ne touche pas la base.
 */
export function accountMarker(db: PlatformDb, mark: unknown, remedy: MarkRemedy): AccountMarker {
  const { account } = remedy
  const marker: AccountMarker = {
    current: markOf(mark),
    effect: null,
    async set(reason) {
      if ((marker.current?.reason ?? null) === reason) return
      const [written] = await inTransaction(db, "accountMarker: mark_account", (sql) => sql<{ changed: boolean; mark: unknown }[]>`
        select changed, mark from platform.mark_account(${account.id}, ${reason})`, "server")
      marker.current = markOf(written?.mark)
      if (written?.changed) marker.effect = reason === null ? "lifted" : "marked"
    },
    async refusal(error) {
      const current = marker.current
      if (!current) {
        console.error(`[platform] accountMarker: account ${account.id} has no mark to tell`)
        throw new PlatformError("internal", "Internal error.")
      }
      return markRefusal(error, current, remedy)
    },
  }
  return marker
}

/**
 * Le refus que devient un refus du tiers qui vient de marquer le compte (`error`, son code celui de la marque), la marque
 * dite après lui. Pour un appel, une clé refusée mène au geste (`not_enabled`, `reason: reconnect`) : un consentement ou un
 * compte rattaché se reconnecte (`refuse`, geste `oauth` ou `hosted_link`), un compte à clé reçoit une clé neuve
 * (`refuseKey`, geste `key`, l'adresse de la saisie de sa clé). Restent le refus du tiers, avec la phrase de leur remède :
 * des crédits épuisés, qui se rachètent chez le tiers, hors de l'application, et qu'aucune adresse ne mène ; la clé de
 * l'hôte refusée, que seul qui fait tourner l'application change ; toute marque vue par la sonde.
 */
async function markRefusal(error: PlatformError, current: AccountMark, remedy: MarkRemedy): Promise<PlatformError> {
  const said = `${error.message} Account « ${remedy.account.label} » is marked: ${markWords(current)}.`
  if (remedy.use === "call" && current.reason === "credential_rejected") {
    if (remedy.reconnect) return remedy.refuse(said)
    if (!remedy.hostKey) return remedy.refuseKey("reconnect", said)
  }
  return new PlatformError(error.code, `${said} ${await remedyOf(current.reason, remedy)}`, error.details)
}

/** Le refus d'un compte de l'appel dont la clé est à poser, l'adresse menant à la saisie de la sienne (`accountKeyRefusal`). */
export function keyRefuser(where: ConnectWhere, connector: string, account: CallAccount): MarkRemedy["refuseKey"] {
  return (reason, said) => accountKeyRefusal(where, { connector, account, reason, said })
}
