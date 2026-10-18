// Journal des partages d'un compte (partage des comptes, `droits-d-acces.md` § Partage d'un compte de connecteur) :
// sa lecture par la personne qui gère le compte. Le déclencheur `access_rules_account_share_journal` l'écrit, à chaque
// règle de compte posée, remplacée ou retirée ; aucune session ne l'écrit. Séparé des règles (`rules.ts`), dont il
// reprend la lecture du compte et le nom des niveaux.
import type { AccountShareEventView } from "../schemas"
import { ACCOUNT_LEVELS } from "./access"
import type { PlatformDb } from "./db"
import { memberDirectory } from "./directory"
import { inTransaction } from "./errors"
import type { Identity } from "./identity"
import { parseId } from "./members"
import { accountLevelName, readAccount } from "./rules"

type TeamName = { id: string; name: string }

/** Lignes du journal des partages d'un compte servies au plus, les plus récentes d'abord. */
const SHARE_JOURNAL_LIMIT = 200

type ShareEventRow = {
  at: string
  action: string
  subject_kind: string
  subject_id: string | null
  level: string
  previous_level: string | null
  actor_user_id: string | null
}

/**
 * Le journal des partages d'un compte (`droits-d-acces.md` § Partage d'un compte de connecteur) : chaque règle posée,
 * remplacée ou retirée, qui l'a fait, vers qui, quand, les plus récentes d'abord, 200 au plus. Réservé à qui gère le
 * compte (`ACCOUNT_LEVELS.manage`) : pour un compte personnel, sa seule personne. Un compte invisible répond comme un
 * identifiant inconnu (H68). Les noms se lisent à la lecture : une équipe supprimée ou une personne qui n'est plus
 * membre restent sans nom (`null`), jamais devinées.
 */
export async function listAccountShareJournal(db: PlatformDb, identity: Identity, accountId: unknown): Promise<{ label: string; events: AccountShareEventView[] }> {
  const id = parseId(accountId, "account")
  return inTransaction(db, "listAccountShareJournal", async (sql) => {
    const account = await readAccount({ db, sql }, identity, id, ACCOUNT_LEVELS.manage)
    const rows = await sql<ShareEventRow[]>`
      select to_json(e.at) #>> '{}' as at, e.action, e.subject_kind, e.subject_id, e.level, e.previous_level, e.actor_user_id
        from platform.account_share_events e
       where e.org_id = ${identity.org.id} and e.account_id = ${account.id}
       order by e.at desc, e.id desc
       limit ${SHARE_JOURNAL_LIMIT}`
    const teamIds = [...new Set(rows.flatMap((row) => (row.subject_kind === "team" && row.subject_id ? [row.subject_id] : [])))]
    const readTeams = async (): Promise<TeamName[]> =>
      teamIds.length === 0 ? [] : sql<TeamName[]>`select id, name from platform.teams where org_id = ${identity.org.id} and id = any(${teamIds})`
    const [teams, directory] = await Promise.all([readTeams(), memberDirectory(db, identity.org.id)])
    const teamName = new Map(teams.map((team) => [team.id, team.name]))
    const personName = new Map(directory.map((person) => [person.userId, person.name]))
    const events = rows.map((row): AccountShareEventView => {
      const kind = row.subject_kind === "team" || row.subject_kind === "user" ? row.subject_kind : "org"
      const name = kind === "org" ? identity.org.name : ((kind === "team" ? teamName : personName).get(row.subject_id ?? "") ?? null)
      return {
        at: row.at,
        action: row.action === "removed" ? "removed" : "set",
        subject: { kind, name },
        level: accountLevelName(row.level),
        previous: row.previous_level === null ? null : accountLevelName(row.previous_level),
        by: row.actor_user_id ? { name: personName.get(row.actor_user_id) ?? null } : null,
      }
    })
    return { label: account.label, events }
  })
}
