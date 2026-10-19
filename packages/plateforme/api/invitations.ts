// Ressource `invitations` de l'API du paquet (AC20) : lister, inviter, révoquer. Adaptateur mince :
// la validation, les droits et l'écriture sont dans `server/invitations.ts`.
import { invitationIdSchema, inviteSchema } from "../schemas"
import { inviteMember, listInvitations, revokeInvitation } from "../server/invitations"
import type { ResourceRoutes } from "./handler"

export const invitationsRoutes: ResourceRoutes = {
  GET: {
    params: 0,
    async handle({ db, identity, request }) {
      const state = new URL(request.url).searchParams.get("state") ?? undefined
      const invitations = await listInvitations(db, identity, { state })
      return { status: 200, data: { invitations } }
    },
  },
  POST: {
    params: 0,
    target: ({ body }) => {
      const parsed = inviteSchema.safeParse(body)
      return parsed.success ? parsed.data.email : null
    },
    async handle({ db, identity, body, linkOrigin }) {
      // Le lien ramène à l'adresse d'où l'on invite, celle qui a résolu l'organisation : le cookie de session y sera posé (N2).
      const created = await inviteMember(db, identity, body, { redirectTo: `${linkOrigin}/auth/confirm?next=/` })
      return {
        status: 201,
        data: created,
        journal: { target: created.invitation.email, teamId: created.invitation.teamId },
      }
    },
  },
  DELETE: {
    params: 1,
    target: ({ params }) => (invitationIdSchema.safeParse(params[0]).success ? params[0] : null),
    async handle({ db, identity, params }) {
      const invitation = await revokeInvitation(db, identity, params[0])
      return { status: 200, data: { invitation }, journal: { target: invitation.id, teamId: invitation.teamId } }
    },
  },
}
