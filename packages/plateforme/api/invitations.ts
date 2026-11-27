// Ressource `invitations` de l'API du paquet (AC20) : lister, inviter, révoquer ; ajouter une équipe à une
// personne en attente ou l'en retirer, par `invitations/<id>/teams/<teamId>`, comme `teams/<id>/members` pour un
// membre. Adaptateur mince : la validation, les droits et l'écriture sont dans `server/invitations.ts` et
// `server/pending-members.ts`.
import { invitationIdSchema, inviteSchema } from "../schemas"
import { inviteMember, listInvitations, revokeInvitation } from "../server/invitations"
import { changeInvitationTeams } from "../server/pending-members"
import type { ResourceRoutes, Route } from "./handler"
import { idOrNull } from "./ids"

const TEAMS = { 1: "teams" } as const

/**
 * `POST` ajoute l'équipe, `DELETE` la retire (`changeInvitationTeams`, qui décide le droit équipe par équipe) ; l'une
 * et l'autre ne laissent que la personne en attente changée, sans remplacer son invitation.
 */
function invitationTeamRoute(sens: "add" | "remove"): Route {
  return {
    params: 3,
    fixed: TEAMS,
    target: ({ params }) => idOrNull(params[0]),
    async handle({ db, identity, params }) {
      const [invitationId, , teamId] = params
      await changeInvitationTeams(db, identity, invitationId, sens === "add" ? { add: [teamId], remove: [] } : { add: [], remove: [teamId] })
      return { status: 200, data: { invitation: { id: invitationId, teamId } }, journal: { target: invitationId, teamId: idOrNull(teamId) } }
    },
  }
}

export const invitationsRoutes: ResourceRoutes = {
  GET: {
    params: 0,
    async handle({ db, identity, request }) {
      const state = new URL(request.url).searchParams.get("state") ?? undefined
      const invitations = await listInvitations(db, identity, { state })
      return { status: 200, data: { invitations } }
    },
  },
  POST: [
    {
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
    invitationTeamRoute("add"),
  ],
  DELETE: [
    {
      params: 1,
      target: ({ params }) => (invitationIdSchema.safeParse(params[0]).success ? params[0] : null),
      async handle({ db, identity, params }) {
        const invitation = await revokeInvitation(db, identity, params[0])
        return { status: 200, data: { invitation }, journal: { target: invitation.id, teamId: invitation.teamId } }
      },
    },
    invitationTeamRoute("remove"),
  ],
}
