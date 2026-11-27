// Les équipes d'une invitation (`invitation_teams`), où la personne entre à sa première connexion : ce que l'appelant en
// voit, le droit de donner chacune, et leur écriture. Lu par `invitations.ts` (inviter, lister) et `pending-members.ts`
// (changer les équipes d'une personne en attente) : sans ce module, `invitations.ts` passait le plafond de lignes, et
// la vérification d'une équipe s'écrivait deux fois.
import { isOrgAdmin, leadsTeam } from "./access"
import { PlatformError } from "./errors"
import type { Identity } from "./identity"
import type { InvitationOptions } from "./invitations"
import type { Tx } from "./sql"

/**
 * Les équipes de l'invitation `i` de la requête que l'appelant voit, en tableau JSON : toutes pour l'administrateur ;
 * pour un autre, celles qu'il mène, filtre posé ici comme la RLS le pose (`leadsTeam`). Un administrateur passe un
 * tableau nul, jamais un fragment de plus.
 */
export function visibleTeamIds(sql: Tx, identity: Identity) {
  const led = isOrgAdmin(identity) ? null : identity.teams.filter((team) => leadsTeam(identity, team.id)).map((team) => team.id)
  return sql`coalesce((select json_agg(it.team_id order by it.created_at, it.team_id) from platform.invitation_teams it
                        where it.invitation_id = i.id and (${led}::uuid[] is null or it.team_id = any(${led}::uuid[]))), '[]'::json)`
}

/**
 * Chaque équipe de `teamIds`, une à une, parmi celles que l'appelant peut donner (`invitationOptions`), avant toute
 * écriture : pour un responsable, une équipe qu'il ne mène pas est refusée (`team_required`) ; pour un administrateur,
 * une équipe hors de l'organisation est inconnue.
 */
export function requireAllowedTeams(identity: Identity, allowed: InvitationOptions, teamIds: readonly string[]): void {
  for (const teamId of teamIds) {
    if (allowed.teams.some((team) => team.id === teamId)) continue
    if (allowed.teamRequired) throw new PlatformError("forbidden", "Choose teams you lead.", { reason: "team_required" })
    throw new PlatformError("invalid_arguments", `Unknown team ${teamId} in ${identity.org.name}.`)
  }
}

/** Ajoute ces équipes à l'invitation, chacune une fois (celle de `team_id` y est déjà, par le déclencheur). */
export async function addInvitationTeams(sql: Tx, invitationId: string, teamIds: readonly string[]): Promise<void> {
  if (teamIds.length === 0) return
  await sql`
    insert into platform.invitation_teams (invitation_id, team_id)
    select ${invitationId}::uuid, team from unnest(${[...teamIds]}::uuid[]) as team
    on conflict (invitation_id, team_id) do nothing`
}
