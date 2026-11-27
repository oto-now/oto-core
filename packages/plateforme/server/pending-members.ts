// Les personnes en attente de leur première connexion, telles que les gèrent `member.add` et `member.set_teams` : une
// invitation ouverte, inscrite sans email (`registerInvitation`), qu'elle accepte en entrant (`accept_invitations`).
// Une invitation porte plusieurs équipes (`invitation_teams`) : la personne entre dans toutes à sa première connexion.
// Sans ce module, les deux fonctions décideraient chacune quand une attente change, et la reliraient à leur façon.
import { invitationIdSchema, type InvitationRole } from "../schemas"
import type { PlatformDb } from "./db"
import { inTransaction, PlatformError } from "./errors"
import type { Identity } from "./identity"
import { addInvitationTeams, requireAllowedTeams, visibleTeamIds } from "./invitation-teams"
import { invitationOptions, invitationRole, registerInvitation } from "./invitations"

/**
 * Une invitation en attente, telle que la lit `openInvitation` ; `teamIds` : ses équipes que l'appelant voit (toutes
 * pour l'administrateur, celles qu'il mène pour un responsable).
 */
export type OpenInvitation = { id: string; email: string; role: InvitationRole; teamIds: string[] }

type OpenRow = { id: string; email: string; role: string; team_ids: string[] }

/** Classe de verrou des invitations (`database-patterns.md § Transactions`), clé `org_id:email`. */
const INVITATION_LOCK = 7101

/**
 * L'invitation en attente de `email` dans l'organisation de l'identité, ou `null` : une seule à la fois
 * (`invitations_guard`, `already_invited`). Sans borne de liste, à la différence de `listInvitations`.
 */
export async function openInvitation(db: PlatformDb, identity: Identity, email: string): Promise<OpenInvitation | null> {
  const [row] = await inTransaction(
    db,
    "openInvitation",
    (sql) => sql<OpenRow[]>`
      select i.id, i.email, i.role, ${visibleTeamIds(sql, identity)} as team_ids from platform.invitations i
       where i.org_id = ${identity.org.id} and i.email = ${email.toLowerCase()}
         and i.accepted_at is null and i.declined_at is null and i.revoked_at is null and (i.expires_at is null or i.expires_at > ${new Date()})`,
  )
  return row ? { id: row.id, email: row.email, role: invitationRole(row.role), teamIds: row.team_ids } : null
}

/**
 * Ajoute à l'invitation ouverte `invitationId` les équipes `add` et lui retire les équipes `remove`, sans la remplacer :
 * son identifiant ne change pas, et les équipes que l'appelant ne voit pas restent. Chaque équipe est vérifiée une à
 * une avant toute écriture (`invitationOptions` : toutes pour l'administrateur, celles qu'il mène pour un responsable),
 * comme `addTeamMember` et `removeTeamMember` pour un membre. Un identifiant qui n'est pas un UUID est refusé
 * (`invalid_arguments`) avant toute requête, comme dans `revokeInvitation`. L'invitation, close entre-temps, est un
 * conflit ; tout se fait dans une transaction.
 */
export async function changeInvitationTeams(
  db: PlatformDb,
  identity: Identity,
  id: unknown,
  change: { add: readonly string[]; remove: readonly string[] },
): Promise<void> {
  const parsed = invitationIdSchema.safeParse(id)
  if (!parsed.success) throw new PlatformError("invalid_arguments", "The invitation id must be a UUID.")
  const invitationId = parsed.data
  requireAllowedTeams(identity, await invitationOptions(db, identity), [...change.add, ...change.remove])
  const open = await inTransaction(db, "changeInvitationTeams", async (sql) => {
    // Le verrou de l'invitation (organisation, adresse), celui d'`invitations_guard` et d'`accept_invitations`, avant de
    // la relire ouverte : une acceptation en cours finit avant, ou attend que ses équipes soient écrites. Pas de
    // `for update` : la policy de mise à jour d'`invitations` cache la ligne au responsable qui n'a pas invité.
    await sql`
      select pg_catalog.pg_advisory_xact_lock(${INVITATION_LOCK}, pg_catalog.hashtext(i.org_id::text || ':' || i.email))
        from platform.invitations i
       where i.id = ${invitationId} and i.org_id = ${identity.org.id}`
    const [invitation] = await sql<{ id: string }[]>`
      select id from platform.invitations
       where id = ${invitationId} and org_id = ${identity.org.id}
         and accepted_at is null and declined_at is null and revoked_at is null`
    if (!invitation) return false
    await addInvitationTeams(sql, invitationId, change.add)
    if (change.remove.length > 0) {
      await sql`delete from platform.invitation_teams where invitation_id = ${invitationId} and team_id = any(${[...change.remove]}::uuid[])`
    }
    return true
  })
  if (!open) {
    console.error(`[platform] changeInvitationTeams: invitation ${invitationId} closed before its teams changed`)
    throw new PlatformError("conflict", `Invitation ${invitationId} changed meanwhile. Reload the people and retry.`)
  }
}

/**
 * L'attente de `invitation` avec ce rôle et ces équipes : inchangée si rien ne diffère. Un autre rôle la remplace par
 * une invitation sans email (`registerInvitation`, qui décide le droit) ; d'autres équipes seulement changent les siennes
 * sans la remplacer (`changeInvitationTeams`, qui vérifie chaque équipe), celles que l'appelant ne voit pas gardées.
 * Rend l'identifiant de l'attente et si elle a changé.
 */
export async function setPending(
  db: PlatformDb,
  identity: Identity,
  invitation: OpenInvitation,
  wanted: { role: InvitationRole; teamIds: readonly string[] },
): Promise<{ id: string; changed: boolean }> {
  if (wanted.role !== invitation.role) {
    const replaced = await registerInvitation(db, identity, { email: invitation.email, role: wanted.role, teamIds: wanted.teamIds }, invitation.id)
    return { id: replaced.id, changed: true }
  }
  const add = wanted.teamIds.filter((id) => !invitation.teamIds.includes(id))
  const remove = invitation.teamIds.filter((id) => !wanted.teamIds.includes(id))
  if (add.length === 0 && remove.length === 0) return { id: invitation.id, changed: false }
  await changeInvitationTeams(db, identity, invitation.id, { add, remove })
  return { id: invitation.id, changed: true }
}
