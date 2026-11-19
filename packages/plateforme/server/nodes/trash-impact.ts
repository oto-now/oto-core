// Qui perd l'accès quand un contenu part à la corbeille : les sujets des règles de lecture ou plus posées sur lui ou
// sur un contenu dessous, hors de son équipe propriétaire et de la personne qui supprime. Les équipes par leur nom, à
// leur plus haut niveau ; les personnes comptées, jamais nommées ; toute l'organisation dite une fois. Lu par le
// récapitulatif de `node.trash` et par le dialogue de suppression de l'écran (`GET trash/impact`). Sans lui, supprimer
// un contenu partagé coupait d'autres équipes sans que personne ne le sache avant.
import type { TrashImpact } from "../../schemas"
import type { PlatformDb } from "../db"
import { inTransaction } from "../errors"
import type { Identity } from "../identity"
import { formatCount } from "./document"

type Shared = TrashImpact["shared"]
type Level = Shared["teams"][number]["level"]

const RANK: Record<Level, number> = { read: 1, write: 2, manage: 3 }

type RuleRow = { team_id: string | null; team_name: string | null; user_id: string | null; org: boolean; level: Level }

/**
 * Les sujets qui lisent ces contenus par une règle : une lecture, pour tous les nœuds. Les droits sont décidés avant
 * par l'appelant (`trashPlan` : la gestion du contenu, et la vue de tout ce qu'il porte).
 */
export async function sharedWith(db: PlatformDb, identity: Identity, target: { nodeIds: readonly string[]; ownerTeamId: string | null }): Promise<Shared> {
  const rows = await inTransaction(db, "trash: shared with", (sql) => sql<RuleRow[]>`
    select r.subject_team_id as team_id, t.name as team_name, r.subject_user_id as user_id, r.subject_org as org, r.level
      from platform.access_rules r
      left join platform.teams t on t.id = r.subject_team_id
     where r.org_id = ${identity.org.id} and r.node_id = any(${[...target.nodeIds]}::uuid[]) and r.level in ('read', 'write', 'manage')`)
  const teams = new Map<string, Shared["teams"][number]>()
  const people = new Set<string>()
  for (const row of rows) {
    if (row.team_id !== null && row.team_id !== target.ownerTeamId) {
      const known = teams.get(row.team_id)
      if (!known || RANK[row.level] > RANK[known.level]) teams.set(row.team_id, { name: row.team_name ?? row.team_id, level: row.level })
    }
    if (row.user_id !== null && row.user_id !== identity.user.id) people.add(row.user_id)
  }
  return {
    teams: [...teams.values()].sort((a, b) => a.name.localeCompare(b.name, "fr")),
    people: people.size,
    org: rows.some((row) => row.org),
  }
}

/** « Shared with: team Support (read), 2 people, the whole organisation: they lose access. », ou `null` sans partage. */
export function sharedWithLine(shared: Shared): string | null {
  const subjects = [
    ...shared.teams.map((team) => `team ${team.name} (${team.level})`),
    ...(shared.people > 0 ? [`${formatCount(shared.people)} ${shared.people === 1 ? "person" : "people"}`] : []),
    ...(shared.org ? ["the whole organisation"] : []),
  ]
  return subjects.length > 0 ? `Shared with: ${subjects.join(", ")}: they lose access.` : null
}
