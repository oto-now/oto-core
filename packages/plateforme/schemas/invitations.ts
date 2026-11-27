// Schémas des invitations, partagés par le formulaire (ui/), l'API (api/) et les services
// (server/) : un schéma, une source de vérité (CLAUDE.md § Invariants techniques 3, H02).
// `zod/v4` pour tout schemas/ (décision du pilote, P1) : sous-chemin de zod 3.25, compatible
// avec `@hookform/resolvers` 5 et porteur de `toJSONSchema` pour les outils MCP.
import * as z from "zod/v4"

export const INVITATION_ROLES = ["member", "admin"] as const
export const INVITATION_STATES = ["pending", "accepted", "declined", "revoked", "expired"] as const

export type InvitationRole = (typeof INVITATION_ROLES)[number]
export type InvitationState = (typeof INVITATION_STATES)[number]

/** Au plus autant d'équipes dans une invitation : la borne des équipes de `member.add` (`member-functions.ts`). */
const MAX_INVITATION_TEAMS = 50

// Les équipes où la personne entre à sa première connexion : `teamIds`, aucune, une ou plusieurs. `teamId`, une
// seule, est la forme d'avant les équipes multiples, encore acceptée d'un client qui l'envoie (`""` ou `null` : aucune) ;
// elle passe en tête de `teamIds`, chaque équipe une fois.
export const inviteSchema = z
  .object({
    email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
    role: z.enum(INVITATION_ROLES).default("member"),
    teamId: z.preprocess((value) => (value === "" || value === null ? undefined : value), z.uuid().optional()),
    teamIds: z.array(z.uuid()).max(MAX_INVITATION_TEAMS).default([]),
  })
  .transform(({ teamId, teamIds, ...invite }) => ({ ...invite, teamIds: [...new Set([...(teamId ? [teamId] : []), ...teamIds])] }))

export type InviteInput = z.input<typeof inviteSchema>
export type Invite = z.output<typeof inviteSchema>

export const invitationIdSchema = z.uuid()

export const listInvitationsQuerySchema = z.object({
  state: z.enum(["pending", "all"]).default("pending"),
})
