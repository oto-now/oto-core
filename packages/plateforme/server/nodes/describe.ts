// `node.describe` : l'état d'un lot de nœuds désignés par leur identifiant stable (`nodes.id`), derrière `call`, sans
// outil ajouté (ADR-002). Un hôte qui garde dans sa propre base les identifiants des pages qui l'intéressent apprend en un
// appel lesquelles tiennent encore, à quel chemin et sous quel titre, lesquelles sont à la corbeille, lesquelles manquent.
// Ce que l'appelant ne lit pas répond comme ce qui n'existe pas (H68) : ni titre, ni chemin, ni corbeille. Les lignes en
// une lecture et les niveaux en un lot (`nodeLevels`), quel que soit le nombre d'identifiants. Sans lui, l'hôte lisait
// chaque page par `read`, une par une, pour savoir si elle tient encore.
import * as z from "zod/v4"
import { NODE_ID_EXAMPLE, nodeIdSchema } from "../../schemas"
import { ACCESS_LEVELS, nodeLevels } from "../access"
import { defineFunction } from "../catalog/define"
import type { PlatformDb } from "../db"
import { inTransaction } from "../errors"
import type { Identity } from "../identity"

/** Identifiants au plus par appel : une lecture et un lot de décisions bornés. */
export const NODE_DESCRIBE_MAX = 200

const describeArgsSchema = z.strictObject({
  ids: z
    .array(nodeIdSchema)
    .min(1)
    .max(NODE_DESCRIBE_MAX)
    .describe(`Stable ids of pages, procedures, tables or folders, as read, find and write return them, ${NODE_DESCRIBE_MAX} at most, e.g. ["${NODE_ID_EXAMPLE}"].`),
})

/**
 * L'état d'un nœud pour l'appelant : `present` (il le lit : son chemin et son titre), `trashed` (à la corbeille, et il le
 * lisait avant : ni chemin ni titre, la corbeille ne se lit pas), `missing` (inconnu, purgé, d'une autre organisation ou
 * invisible : les quatre répondent de même, H68).
 */
export type NodeState = { id: string; state: "present" | "trashed" | "missing"; can_read: boolean; title?: string; path?: string }

/**
 * L'état de chaque identifiant, dans l'ordre demandé, chacun une fois (en minuscules, la forme que la base rend). Le niveau
 * d'un nœud à la corbeille se décide comme s'il était vivant (`trashed`) : seul qui le lisait apprend qu'il y est.
 */
export async function describeNodes(db: PlatformDb, identity: Identity, ids: readonly string[]): Promise<NodeState[]> {
  const wanted = [...new Set(ids.map((id) => id.toLowerCase()))]
  const [rows, levels] = await Promise.all([
    inTransaction(db, "nodes: describe", (sql) => sql<{ id: string; path: string; title: string; trashed: boolean }[]>`
      select id, path, title, deleted_at is not null as trashed from platform.nodes
       where org_id = ${identity.org.id} and id = any(${wanted}::uuid[])`),
    nodeLevels(db, identity, wanted, { trashed: true }),
  ])
  const byId = new Map(rows.map((row) => [row.id, row]))
  return wanted.map((id): NodeState => {
    const row = byId.get(id)
    if (!row || (levels.get(id) ?? ACCESS_LEVELS.none) < ACCESS_LEVELS.read) return { id, state: "missing", can_read: false }
    if (row.trashed) return { id, state: "trashed", can_read: false }
    return { id, state: "present", can_read: true, title: row.title, path: row.path }
  })
}

function stateLine(node: NodeState): string {
  if (node.state === "present") return `- ${node.id}: ${node.path} — ${node.title}`
  if (node.state === "trashed") return `- ${node.id}: in the trash`
  return `- ${node.id}: missing, or not visible to you`
}

export const nodeDescribe = defineFunction({
  name: "node.describe",
  connector: "node",
  class: "read",
  origin: "paquet",
  description:
    "Gives the state of pages, procedures, tables or folders designated by their stable id (the id that read, find and write return), up to 200 in one call: present, with its path and title; in the trash; or missing. A node you cannot read answers missing, without title nor path, like one that does not exist. Use it to check which ids kept elsewhere still lead to a content, before reading, writing or moving it by id. In French: état, existe encore, retrouver une page par son identifiant.",
  schema: describeArgsSchema,
  examples: [{ ids: [NODE_ID_EXAMPLE] }],
  refusals: [`No id, more than ${NODE_DESCRIBE_MAX}, or one that is not a uuid.`],
  run: async (context, args) => {
    const nodes = await describeNodes(context.db, context.identity, args.ids)
    const count = (state: NodeState["state"]) => nodes.filter((node) => node.state === state).length
    const head = `${nodes.length} ${nodes.length === 1 ? "id" : "ids"}: ${count("present")} present, ${count("trashed")} in the trash, ${count("missing")} missing or not visible to you.`
    return { text: [head, ...nodes.map(stateLine)].join("\n"), data: { nodes } }
  },
})
