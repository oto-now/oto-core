// Les arguments des fonctions de partage derrière `call` (1.4.13) : `node.access` lit qui a accès à un nœud,
// `node.share` règle l'accès d'un sujet, `node.public_link` crée ou désactive le lien public. Décrits pour le contrat que
// `read` sert (`mcp-patterns.md § 3`). Sans eux, un assistant ne partageait rien : il renvoyait la personne à l'écran.
import * as z from "zod/v4"
import { nodePathSchema } from "./nodes"
import { ACCESS_LEVEL_NAMES } from "./rules"

const path = nodePathSchema.describe("Path of the page, procedure, table or folder, e.g. ventes/devis.")

/** `node.access` : le nœud seul. */
export const nodeAccessArgsSchema = z.strictObject({ path })

/** Les sujets de `node.share` : une personne, une équipe (par leur nom), l'équipe propriétaire, toute l'organisation. */
const SHARE_SUBJECTS = ["person", "team", "owner_team", "organisation"] as const

/** `node.share` : un sujet, son nom pour une personne ou une équipe, et un niveau, ou `remove`. */
export const nodeShareArgsSchema = z.strictObject({
  path,
  subject: z
    .enum(SHARE_SUBJECTS)
    .describe(
      "Who: person or team (give name), owner_team (the team that owns the node: its default access), organisation (every member of the organisation).",
    ),
  name: z
    .string()
    .trim()
    .min(1)
    .max(320)
    .optional()
    .describe("Required for person (full name or email of a member) and team (team name); ignored otherwise. Case and accents do not matter."),
  level: z
    .enum([...ACCESS_LEVEL_NAMES, "remove"])
    .describe(
      "none (hides the node and everything under it), read, write (edit and publish), manage (full access: also share, move, delete; granted by an administrator only), or remove (drop this subject's rule here: the closest rule above applies; for organisation, only the people and teams added keep access).",
    ),
})

export type NodeShareArgs = z.infer<typeof nodeShareArgsSchema>

/** `node.public_link` : créer (sous-pages comprises ou non) ou désactiver le lien public. */
export const nodePublicLinkArgsSchema = z.strictObject({
  path,
  action: z.enum(["create", "disable"]).describe("create: make the node readable on the web by anyone with the link; disable: the link stops working."),
  include_children: z.boolean().optional().describe("With create: the pages under the node are readable through the link too. Default false."),
})

export type NodePublicLinkArgs = z.infer<typeof nodePublicLinkArgsSchema>
