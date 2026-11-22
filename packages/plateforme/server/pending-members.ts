// Les personnes en attente de leur première connexion, telles que les gèrent `member.add` et `member.set_teams` : une
// invitation ouverte, inscrite sans email (`registerInvitation`), qu'elle accepte en entrant (`accept_invitations`).
// Une invitation porte une équipe au plus (`invitations.team_id`) : une personne en attente n'entre que dans une équipe.
// Sans ce module, les deux fonctions décideraient chacune quand une attente change, et la reliraient à leur façon.
import type { InvitationRole } from "../schemas"
import type { PlatformDb } from "./db"
import { inTransaction, PlatformError } from "./errors"
import type { Identity } from "./identity"
import { invitationRole, registerInvitation } from "./invitations"

/** Une invitation en attente, telle que la lit `openInvitation`. */
export type OpenInvitation = { id: string; email: string; role: InvitationRole; teamId: string | null }

type OpenRow = { id: string; email: string; role: string; team_id: string | null }

/**
 * L'invitation en attente de `email` dans l'organisation de l'identité, ou `null` : une seule à la fois
 * (`invitations_guard`, `already_invited`). Sans borne de liste, à la différence de `listInvitations`.
 */
export async function openInvitation(db: PlatformDb, identity: Identity, email: string): Promise<OpenInvitation | null> {
  const [row] = await inTransaction(
    db,
    "openInvitation",
    (sql) => sql<OpenRow[]>`
      select id, email, role, team_id from platform.invitations
       where org_id = ${identity.org.id} and email = ${email.toLowerCase()}
         and accepted_at is null and declined_at is null and revoked_at is null and expires_at > ${new Date()}`,
  )
  return row ? { id: row.id, email: row.email, role: invitationRole(row.role), teamId: row.team_id } : null
}

/** Plus d'une équipe pour une personne en attente : refusé, rien ne change. */
export function oneTeamWhilePending(email: string, count: number): void {
  if (count <= 1) return
  throw new PlatformError(
    "invalid_arguments",
    `${email} is pending: until their first sign-in a pending person joins one team at most. Give one team now, then call member.set_teams once they have signed in.`,
    { reason: "pending_single_team" },
  )
}

/**
 * L'attente de `invitation` avec ce rôle et ces équipes : inchangée si rien ne diffère, sinon remplacée par une
 * invitation sans email (`registerInvitation`, qui décide le droit). Rend l'identifiant de l'attente et si elle a changé.
 */
export async function setPending(
  db: PlatformDb,
  identity: Identity,
  invitation: OpenInvitation,
  wanted: { role: InvitationRole; teamIds: readonly string[] },
): Promise<{ id: string; changed: boolean }> {
  oneTeamWhilePending(invitation.email, wanted.teamIds.length)
  const [teamId] = wanted.teamIds
  if ((teamId ?? null) === invitation.teamId && wanted.role === invitation.role) return { id: invitation.id, changed: false }
  const replaced = await registerInvitation(db, identity, { email: invitation.email, role: wanted.role, teamId }, invitation.id)
  return { id: replaced.id, changed: true }
}
