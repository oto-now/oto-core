// Ressource `teams` de l'API du paquet (E05-S03, AC11 à AC14) : créer, renommer, supprimer ; composer
// par `teams/<id>/members` ; nommer ou retirer un responsable par `PATCH teams/<id>/members/<userId>`
// (E05-S13, AC-24). Adaptateur mince : la validation, les droits et l'écriture sont dans `server/teams.ts`.
// `GET teams/<slug>` : le panneau d'une équipe, lu par le « ⋯ » de sa section du rail (`server/team-panel.ts`).
import { createTeamSchema } from "../schemas"
import { teamPanel } from "../server/team-panel"
import { addTeamMember, createTeam, deleteTeam, removeTeamMember, setTeamMemberRole, teamSlug, updateTeam } from "../server/teams"
import type { ResourceRoutes } from "./handler"
import { idOrNull } from "./ids"

const MEMBERS = { 1: "members" } as const

export const teamsRoutes: ResourceRoutes = {
  GET: {
    params: 1,
    async handle({ db, identity, params }) {
      return { status: 200, data: await teamPanel(db, identity, params[0]) }
    },
  },
  POST: [
    {
      params: 0,
      target: ({ body }) => {
        const parsed = createTeamSchema.safeParse(body)
        return parsed.success ? teamSlug(parsed.data.name) : null
      },
      async handle({ db, identity, body }) {
        const { data, target, teamId } = await createTeam(db, identity, body)
        return { status: 201, data: { team: data }, journal: { target, teamId } }
      },
    },
    {
      params: 2,
      fixed: MEMBERS,
      target: ({ body }) => idOrNull(typeof body === "object" && body !== null && "userId" in body ? body.userId : null),
      async handle({ db, identity, params, body }) {
        const { data, target, teamId } = await addTeamMember(db, identity, params[0], body)
        return { status: 200, data: { membership: data }, journal: { target, teamId } }
      },
    },
  ],
  PATCH: [
    {
      params: 1,
      target: ({ params }) => idOrNull(params[0]),
      async handle({ db, identity, params, body }) {
        const { data, target, teamId } = await updateTeam(db, identity, params[0], body)
        return { status: 200, data: { team: data }, journal: { target, teamId } }
      },
    },
    // Nommer un membre responsable, ou le retirer des responsables (E05-S13, AC-24).
    {
      params: 3,
      fixed: MEMBERS,
      target: ({ params }) => idOrNull(params[2]),
      async handle({ db, identity, params, body }) {
        const { data, target, teamId } = await setTeamMemberRole(db, identity, { teamId: params[0], userId: params[2] }, body)
        return { status: 200, data: { membership: data }, journal: { target, teamId } }
      },
    },
  ],
  DELETE: [
    {
      params: 1,
      target: ({ params }) => idOrNull(params[0]),
      async handle({ db, identity, params }) {
        const { data, target, teamId } = await deleteTeam(db, identity, params[0])
        return { status: 200, data: { team: data }, journal: { target, teamId } }
      },
    },
    {
      params: 3,
      fixed: MEMBERS,
      target: ({ params }) => idOrNull(params[2]),
      async handle({ db, identity, params }) {
        const { data, target, teamId } = await removeTeamMember(db, identity, params[0], params[2])
        return { status: 200, data: { membership: data }, journal: { target, teamId } }
      },
    },
  ],
}
