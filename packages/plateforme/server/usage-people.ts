// Les tableaux par équipe et par personne de l'onglet Statistiques d'« Activité » (1.4.13), sans base : le calcul pur sur
// les lectures agrégées de `usage-statistics.ts`. Une procédure n'est nommée, ni comptée, que si l'appelant la lit (D44).
// Sans lui, l'administrateur ne voyait ni quelle équipe se sert des assistants, ni qui ne s'est jamais connecté.
import { INACTIVE_DAYS, type UsagePersonRow, type UsageTeamRow } from "../schemas"
import type { DirectoryEntry, Membership, RosterTeam } from "./directory"

const DAY_MS = 86_400_000

/** Les lectures que ce calcul consomme. */
export type PeopleReads = {
  /** Les conversations de la fenêtre : leur personne et le nom de leur assistant. */
  conversations: readonly { user_id: string | null; assistant: string | null }[]
  /** Par personne : ses appels de la fenêtre et son dernier appel, au-delà de la fenêtre. */
  activity: readonly { user_id: string; calls: number; last: string | null }[]
  /** Les demandes de `context` de la fenêtre, par personne et cible. */
  demands: readonly { user_id: string | null; target: string; count: number }[]
  /** Les contenus dont un bloc publié a été écrit dans la fenêtre, par auteur et origine (`agent`, `human`). */
  authorship: readonly { user_id: string | null; origin: string | null; node_id: string }[]
}

export type PeopleInput = {
  now: Date
  roster: { teams: RosterTeam[]; memberships: Membership[] }
  directory: readonly DirectoryEntry[]
  team: { id: string; userIds: readonly string[] } | null
  /** Les procédures lisibles par l'appelant parmi les cibles des demandes : chemin → titre. */
  procedures: ReadonlyMap<string, string>
}

function latest(dates: readonly (string | null | undefined)[]): string | null {
  return dates.reduce<string | null>((plus, date) => (date && (plus === null || Date.parse(date) > Date.parse(plus)) ? date : plus), null)
}

/** Le plus fréquent d'une liste, à égalité le premier par ordre alphabétique ; `null` pour une liste vide. */
function mostFrequent(values: readonly (string | null)[]): string | null {
  const counts = new Map<string, number>()
  for (const value of values) if (value !== null) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null
}

function teamRow(team: RosterTeam, reads: PeopleReads, input: PeopleInput): UsageTeamRow {
  const known = new Set(input.directory.map((person) => person.userId))
  const members = new Set(input.roster.memberships.flatMap((link) => (link.teamId === team.id && known.has(link.userId) ? [link.userId] : [])))
  const own = (userId: string | null) => userId !== null && members.has(userId)
  const conversations = reads.conversations.filter((row) => own(row.user_id))
  const served = new Map<string, number>()
  for (const demand of reads.demands) if (own(demand.user_id) && input.procedures.has(demand.target)) served.set(demand.target, (served.get(demand.target) ?? 0) + demand.count)
  const top = [...served].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]
  const activity = reads.activity.filter((row) => own(row.user_id))
  return {
    id: team.id,
    name: team.name,
    members: members.size,
    activeMembers: new Set(conversations.map((row) => row.user_id)).size,
    conversations: conversations.length,
    calls: activity.reduce((total, row) => total + row.calls, 0),
    pages: new Set(reads.authorship.filter((row) => own(row.user_id)).map((row) => row.node_id)).size,
    proceduresServed: [...served.values()].reduce((total, count) => total + count, 0),
    topProcedure: top ? { path: top[0], title: input.procedures.get(top[0]) ?? top[0] } : null,
    lastActivity: latest(activity.map((row) => row.last)),
  }
}

function personRow(person: DirectoryEntry, reads: PeopleReads, input: PeopleInput, teamNames: ReadonlyMap<string, string>): UsagePersonRow {
  const conversations = reads.conversations.filter((row) => row.user_id === person.userId)
  const activity = reads.activity.find((row) => row.user_id === person.userId)
  const pages = (origin: string) => new Set(reads.authorship.filter((row) => row.user_id === person.userId && row.origin === origin).map((row) => row.node_id)).size
  const last = latest([person.lastSignInAt, activity?.last])
  const neverSignedIn = person.lastSignInAt === null
  return {
    userId: person.userId,
    name: person.name,
    teams: input.roster.memberships.flatMap((link) => (link.userId === person.userId ? (teamNames.get(link.teamId) ?? []) : [])).sort((a, b) => a.localeCompare(b, "fr")),
    lastSignInAt: person.lastSignInAt,
    lastAssistantUse: activity?.last ?? null,
    conversations: conversations.length,
    calls: activity?.calls ?? 0,
    pagesByHand: pages("human"),
    pagesByAssistant: pages("agent"),
    assistant: mostFrequent(conversations.map((row) => row.assistant)),
    neverSignedIn,
    inactive: !neverSignedIn && (last === null || Date.parse(last) < input.now.getTime() - INACTIVE_DAYS * DAY_MS),
  }
}

/** Les équipes (celle du filtre seule), les plus actives d'abord ; les personnes (de l'équipe du filtre), par nom. */
export function aggregatePeople(reads: PeopleReads, input: PeopleInput): { teams: UsageTeamRow[]; people: UsagePersonRow[] } {
  const teamNames = new Map(input.roster.teams.map((team) => [team.id, team.name]))
  const scope = input.team ? new Set(input.team.userIds) : null
  const teams = input.roster.teams
    .filter((team) => input.team === null || team.id === input.team.id)
    .map((team) => teamRow(team, reads, input))
    .sort((a, b) => b.conversations - a.conversations || a.name.localeCompare(b.name, "fr"))
  const people = input.directory
    .filter((person) => scope === null || scope.has(person.userId))
    .map((person) => personRow(person, reads, input, teamNames))
    .sort((a, b) => a.name.localeCompare(b.name, "fr"))
  return { teams, people }
}
