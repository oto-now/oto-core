// Les arguments des fonctions des membres et des équipes derrière `call` : `member.list`, `member.add`,
// `member.set_teams`, `member.remove` et `team.create`. Décrits pour le contrat que `read` sert (`mcp-patterns.md § 3`).
// Sans eux, le serveur d'un hôte qui sert de client MCP, sous le jeton de la personne qui agit, ne gérait les membres
// et les équipes d'une organisation que par l'écran.
import * as z from "zod/v4"
import { INVITATION_ROLES } from "./invitations"

/** Personnes rendues au plus par page de `member.list` : `next_offset` donne la suite. */
export const MEMBER_LIST_PAGE = 100

/** Une personne par son email, sans casse : stable de l'attente à la première connexion, où son identifiant change. */
const memberEmail = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email().max(254))
  .describe("Email of the person, member or pending, e.g. lea.roux@example.com. Case does not matter.")

const teams = z
  .array(z.string().trim().min(1).max(100))
  .max(50)
  .describe("Teams by slug or name, e.g. [\"ventes\"]. Case and accents do not matter.")

/** `member.list` : les membres et les personnes en attente, par page. */
export const memberListArgsSchema = z.strictObject({
  offset: z.number().int().min(0).default(0).describe(`Index of the first person to return (default 0); pages of ${MEMBER_LIST_PAGE}.`),
})

/** `member.add` : une personne par son email, ses équipes et son rôle dans l'organisation. */
export const memberAddArgsSchema = z.strictObject({
  email: memberEmail,
  teams: teams.optional().describe("Teams to put the person in, by slug or name (default: none). A team lead gives only teams they lead."),
  role: z.enum(INVITATION_ROLES).default("member").describe("Role in the organisation: member (default) or admin (administrators only)."),
})

/** `member.set_teams` : les équipes de la personne, qui remplacent les siennes. */
export const memberSetTeamsArgsSchema = z.strictObject({
  member: memberEmail,
  teams: teams.describe("All the teams of the person after the call, by slug or name; [] removes them from every team."),
})

/** `member.remove` : la personne qui quitte l'organisation, ou dont l'attente est retirée. */
export const memberRemoveArgsSchema = z.strictObject({ member: memberEmail })

/** `team.create` : le nom de l'équipe, 60 caractères au plus (comme à l'écran Équipes). */
export const teamCreateArgsSchema = z.strictObject({
  name: z.string().trim().min(1).max(60).describe("Name of the team, e.g. Support. Its folder is created with it, at its slug."),
})

export type MemberListArgs = z.output<typeof memberListArgsSchema>
export type MemberAddArgs = z.output<typeof memberAddArgsSchema>
export type MemberSetTeamsArgs = z.output<typeof memberSetTeamsArgsSchema>
export type MemberRemoveArgs = z.output<typeof memberRemoveArgsSchema>
export type TeamCreateArgs = z.output<typeof teamCreateArgsSchema>
