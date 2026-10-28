// L'annuaire d'une organisation : les membres avec leur nom et leur email (`member_directory`,
// E01-S04), les équipes et qui en fait partie. Seule lecture de `member_directory` du paquet
// (E01-S07c : l'annuaire court d'E04-S01, dans `access.ts`, y est réuni, N34). Sans ce module,
// `members.ts`, `teams.ts`, `rules.ts`, `access.ts` (« à qui demander ») et les connecteurs
// reliraient chacun les mêmes lignes à leur façon.
//
// Face SQL (E01-S10, partie e1a) : chaque lecture passe par `db.tx`, sous l'appelant de la session ;
// elle rend toutes ses lignes (aucun `max_rows`, donc aucune page).
import type { MemberRoleView, NodeRulesView } from "../schemas"
import type { PlatformDb } from "./db"
import { fromDatabaseError, inTransaction } from "./errors"
import { memberRole, teamRole } from "./identity"
import type { Tx } from "./sql"

export type DirectoryEntry = {
  userId: string
  /** Nul à l'exécution pour une ligne écrite sans email (E01-S09) : se compare par `sameEmail` (M20). */
  email: string
  /** Fiche, nom recopié ou partie locale de l'email ; sans nom ni email, `user <id>` (M20). */
  name: string
  role: MemberRoleView
  lastSignInAt: string | null
}

export type RosterTeam = { id: string; slug: string; name: string }

export type Membership = { teamId: string; userId: string; role: "lead" | "member" }

/**
 * L'email d'une ligne d'annuaire (`member_directory`, `staff_directory`) est-il `wanted`, en
 * minuscules ? Une ligne écrite sans email (E01-S09) rend un email nul, ce que le type généré ne dit
 * pas : elle ne répond à aucun email (M20).
 */
export function sameEmail(email: string | null, wanted: string): boolean {
  return typeof email === "string" && email.toLowerCase() === wanted
}

/**
 * Une ligne de `member_directory`. Une ligne écrite sans email (E01-S09) y rend un email et un nom nuls :
 * l'email reste typé comme celui de `DirectoryEntry`, qui ne le dit pas et se compare par `sameEmail` (M20).
 */
type DirectoryRow = {
  user_id: string
  email: string
  name: string | null
  role: string
  signed_in_at: string | null
}

/**
 * Les membres de l'organisation, triés par nom en français (même ordre que les équipes de
 * l'identité), tous en une lecture. La dernière connexion est rendue par `to_json`, dans l'écriture
 * qu'avait la lecture de PostgREST (à la microseconde, `+00:00`), et non en `Date` du pilote.
 */
export async function memberDirectory(db: PlatformDb, orgId: string): Promise<DirectoryEntry[]> {
  const rows = await inTransaction(
    db,
    "memberDirectory: member_directory",
    (sql) => sql<DirectoryRow[]>`select user_id, email, name, role, to_json(last_sign_in_at) as signed_in_at
                                   from platform.member_directory(${orgId})`,
  )
  return rows
    .map((row) => ({
      userId: row.user_id,
      email: row.email,
      // Ni nom ni email (ligne écrite sans email, E01-S09) : le libellé d'une personne sans email que
      // donne déjà la porte MCP (N19 d'E03-S01), pour que chaque liste trie et montre un nom.
      name: row.name || `user ${row.user_id}`,
      role: memberRole(row.role),
      lastSignInAt: row.signed_in_at,
    }))
    // Entre homonymes, un email absent passe d'abord.
    .sort((a, b) => a.name.localeCompare(b.name, "fr") || (a.email || "").localeCompare(b.email || "", "fr"))
}

/**
 * Les équipes de l'organisation (par nom) et leurs appartenances, lues sous RLS, en une transaction.
 * Le rôle se lit sur `team_members.role`, seule source des responsables depuis E05-S13 : une équipe en a
 * zéro, un ou plusieurs.
 */
export async function teamRoster(db: PlatformDb, orgId: string): Promise<{ teams: RosterTeam[]; memberships: Membership[] }> {
  return inTransaction(db, "teamRoster", async (sql) => {
    const rows = await sql<RosterTeam[]>`select id, slug, name from platform.teams where org_id = ${orgId}`.catch((error) => {
      throw fromDatabaseError(error, "teamRoster: teams")
    })
    const teams = rows.map((row) => ({ id: row.id, slug: row.slug, name: row.name })).sort((a, b) => a.name.localeCompare(b.name, "fr"))
    if (teams.length === 0) return { teams, memberships: [] }
    const links = await sql<{ team_id: string; user_id: string; role: string }[]>`select team_id, user_id, role from platform.team_members
                                                                                 where team_id = any(${teams.map((team) => team.id)}::uuid[])`.catch((error) => {
      throw fromDatabaseError(error, "teamRoster: team_members")
    })
    const memberships = links.map((link) => ({ teamId: link.team_id, userId: link.user_id, role: teamRole(link.role) }))
    return { teams, memberships }
  })
}

export type TeamLeads = { id: string; name: string; leads: string[] }

/**
 * Les équipes de l'organisation et leurs responsables (`team_members.role = 'lead'`), en une lecture sous
 * l'appelant ; avec `teamId`, cette équipe seule (aucune ligne : absente ou illisible). La seule lecture
 * des responsables avec leur équipe : panneau des règles, propriétaire d'un nœud, refus d'accès.
 */
export async function teamsWithLeads(sql: Tx, orgId: string, teamId?: string): Promise<TeamLeads[]> {
  return sql<TeamLeads[]>`
    select t.id, t.name, array(select tm.user_id from platform.team_members tm where tm.team_id = t.id and tm.role = 'lead') as leads
      from platform.teams t
     where t.org_id = ${orgId} and (${teamId ?? null}::uuid is null or t.id = ${teamId ?? null}::uuid)`
}

/**
 * Les sujets qu'on peut ajouter à une règle (`NodeRulesView.subjects`) : le nom de l'organisation, ses équipes par nom et
 * ses membres, tirés des lectures du panneau d'un nœud (règle de la racine, 28/10).
 */
export function ruleSubjects(organisation: string, teams: readonly { id: string; name: string }[], directory: readonly DirectoryEntry[]): NonNullable<NodeRulesView["subjects"]> {
  return {
    organisation,
    teams: teams.map((team) => ({ id: team.id, name: team.name })).sort((a, b) => a.name.localeCompare(b.name, "fr")),
    people: directory.map((person) => ({ id: person.userId, name: person.name })),
  }
}

/** « lead » ou « leads » selon le nombre de responsables nommés (E05-S13 : zéro, un ou plusieurs). */
export function leadWord(count: number): "lead" | "leads" {
  return count > 1 ? "leads" : "lead"
}

/**
 * Les noms connus des responsables, par ordre alphabétique (AC-23, HN-E05S13-19) : une équipe à plusieurs
 * responsables les nomme tous, joints par « , » (`leadName` des vues, « Lead: » du texte servi).
 */
export function leadNames(userIds: readonly string[], nameOf: (userId: string) => string | undefined): string[] {
  return userIds
    .flatMap((userId) => {
      const name = nameOf(userId)
      return name ? [name] : []
    })
    .sort((a, b) => a.localeCompare(b, "fr"))
}

/** La personne fait-elle partie de l'équipe ? Lu sous RLS, comme les appartenances de `teamRoster`. */
export async function inTeam(db: PlatformDb, teamId: string, userId: string): Promise<boolean> {
  const rows = await inTransaction(
    db,
    "inTeam: team_members",
    (sql) => sql`select user_id from platform.team_members where team_id = ${teamId} and user_id = ${userId}`,
  )
  return rows.length > 0
}
