// Une équipe vue du « ⋯ » de sa section du rail : ses personnes, celles de l'organisation qu'on peut y ajouter, et ce
// que la personne peut y faire — composer (l'administrateur, ou un responsable de l'équipe, H72), supprimer
// (l'administrateur). Les mêmes données que l'écran Équipes (`listTeams`, `listMembers`), lues en une transaction ; la
// même lecture, ouverte à tout membre de l'organisation. Les gestes passent par les routes `teams` existantes, qui
// redécident chaque droit. Sans lui, le rail n'ouvrait « Les personnes de … » qu'en quittant la page.
import type { TeamPanel, TeamView } from "../schemas/teams"
import { isOrgAdmin, leadsTeam } from "./access"
import type { PlatformDb } from "./db"
import { leadNames, memberDirectory, teamRoster, type DirectoryEntry, type Membership, type RosterTeam } from "./directory"
import { inTransaction, PlatformError } from "./errors"
import type { Identity } from "./identity"

/** Les équipes lues, par nom, avec leurs responsables et leurs personnes : `listTeams` (`teams.ts`), et le panneau d'une équipe du rail. */
export function teamViews(roster: { teams: RosterTeam[]; memberships: Membership[] }, directory: readonly DirectoryEntry[]): TeamView[] {
  const people = new Map(directory.map((person) => [person.userId, person]))
  return roster.teams.map((team) => ({
    id: team.id,
    slug: team.slug,
    name: team.name,
    leadName:
      leadNames(
        roster.memberships.filter((link) => link.teamId === team.id && link.role === "lead").map((link) => link.userId),
        (userId) => people.get(userId)?.name,
      ).join(", ") || null,
    members: roster.memberships
      .flatMap((link) => {
        const person = link.teamId === team.id ? people.get(link.userId) : undefined
        return person ? [{ userId: link.userId, name: person.name, email: person.email, role: link.role }] : []
      })
      .sort((a, b) => Number(b.role === "lead") - Number(a.role === "lead") || a.name.localeCompare(b.name, "fr")),
  }))
}

export async function teamPanel(db: PlatformDb, identity: Identity, slug: string): Promise<TeamPanel> {
  const [roster, directory] = await inTransaction(db, "teamPanel", () => Promise.all([teamRoster(db, identity.org.id), memberDirectory(db, identity.org.id)]))
  const team = teamViews(roster, directory).find((one) => one.slug === slug)
  if (!team) throw new PlatformError("not_found", `No team ${slug} in ${identity.org.name}.`)
  const admin = isOrgAdmin(identity)
  return {
    team,
    people: directory.map((person) => ({ id: person.userId, name: person.name, email: person.email })),
    compose: admin || leadsTeam(identity, team.id),
    admin,
  }
}
