// La corbeille (E05-S10, AC-b11 ; HN-E05S10e-2 à 4) : « Supprimer » met un nœud et son sous-arbre à la
// corbeille (`nodes.deleted_at`, une date pour tous) ; la corbeille liste ce que la personne peut gérer et
// le restaure à sa place (sous son parent, sinon sous son plus proche ancêtre vivant) ; ce qui y dort
// depuis plus de 30 jours est purgé par le service quand la corbeille se lit ou qu'un contenu y entre
// (aucune tâche planifiée : portable). Un nœud à la corbeille vaut 0 partout où un service décide
// (`access-facts.ts`) : absent de l'arbre, des lectures, de `find`, de `context`, des outils MCP, des liens
// résolus. Décidé par le service avant toute écriture : la gestion du nœud (actions `trash`, `restore`),
// l'écriture sur l'ancêtre qui le reçoit. Sans lui, un contenu ne se supprime pas depuis l'écran.
// E11-S02 (lot e) : `node.trash`, la même corbeille derrière `call`, en deux temps ; son récapitulatif rejoue
// la décision (`trashPlan`) sans rien écrire.
import { nodePathBodySchema, type TrashItem } from "../../schemas"
import { nodePathArgsSchema } from "../../schemas/node-gestures"
import { ACCESS_LEVELS, ancestorPaths, describeOwner, nodeDecisions, nodeLevel, nodeLevels, requireNodeLevel, reservedTo } from "../access"
import { defineFunction, type FunctionContext, type FunctionSummary } from "../catalog/define"
import type { PlatformDb } from "../db"
import { boundedList, changedMeanwhile, inTransaction, invalidInput, PlatformError } from "../errors"
import { purgePendingFiles, removeObjects } from "../files/service"
import { fileStore } from "../files/store"
import type { Identity } from "../identity"
import type { Mutation } from "../members"
import { purgeExpiredExports } from "../transfer/files"
import { findNode, NODE_SQL_COLUMNS, unknownNode, type NodeRow } from "./lookup"
import { structureOf } from "./move"
import { freePath, lastSegment } from "./segments"
import { ownerOf, teamOf } from "./view"

/** Jours passés à la corbeille avant la purge (AC-b11). */
export const TRASH_DAYS = 30

const DAY_MS = 86_400_000

/** Éléments de la corbeille lus au plus (la borne d'une lecture de la face SQL). */
const TRASH_ROWS = 1_000

/**
 * Purge de la corbeille de l'organisation (AC-b11, HN-E05S10e-2) : les nœuds entrés il y a plus de 30
 * jours dont tout le sous-arbre y est aussi depuis plus de 30 jours, en une suppression (la clé du parent
 * est contrôlée à la fin de l'instruction ; blocs, versions, liens, alias, règles et liens publics partent
 * en cascade). Une rétention de l'organisation, pas un geste de la personne : tout membre la lance, et elle
 * vise aussi les pages qu'il ne lit pas, dont la base lui cache les fichiers (`20261021140000`) ; d'où la
 * fonction `security definer` `purge_trash`, bornée à l'organisation de l'appelant et au délai, fixé en
 * base (30 jours, `TRASH_DAYS`). Rend le nombre de nœuds purgés.
 * E10-S02 (AC-e2, ADR-016 § 6) : dans la même instruction, les lignes `files` des nœuds purgés, et eux seuls,
 * sont supprimées et leurs identifiants rendus (la cascade de `files.node_id` les perdrait) ; leurs objets
 * partent après le commit, un échec du bucket nommé au log serveur (`removeObjects`).
 */
export async function purgeTrash(db: PlatformDb, identity: Identity): Promise<number> {
  // E10-S02 (AC-a6) : les envois de fichiers abandonnés partent au passage de la corbeille, objets compris.
  await purgePendingFiles(db, identity)
  // Les exports d'arborescence dont l'URL a expiré partent aussi au passage de la corbeille (le paquet n'a pas de tâche planifiée).
  await purgeExpiredExports(fileStore(), identity.org.id)
  const [purged] = await inTransaction(db, "trash: purge", (sql) => sql<{ nodes: number; files: string[] }[]>`
    select nodes, files::text[] as files from platform.purge_trash(${identity.org.id})`)
  await removeObjects(identity.org.id, purged.files)
  return purged.nodes
}

/** Ce que l'arbre garde en place ne part pas à la corbeille (AC9 d'E03-S07, P39), dit à la façon du refus. */
async function refuseStructure(db: PlatformDb, identity: Identity, node: NodeRow): Promise<void> {
  const structure = await structureOf(db, identity, node)
  if (!structure) return
  const reasons: Record<typeof structure.kind, string> = {
    root: "it is the root of the tree.",
    private: "it holds the personal spaces.",
    space: "it is a personal space; delete the pages inside it instead.",
    context: "a Contexte stays at the head of its team; delete the pages inside it instead.",
    team: "it is the folder of a team; delete the team, or the pages inside it.",
  }
  throw new PlatformError("invalid_arguments", `${node.path} cannot be deleted: ${reasons[structure.kind]}`)
}

/** Les descendants vivants d'un nœud (par le préfixe de son chemin), une lecture, triés par chemin. */
async function liveDescendants(db: PlatformDb, identity: Identity, node: NodeRow): Promise<{ id: string; path: string }[]> {
  return inTransaction(db, "trash: descendants", (sql) => sql<{ id: string; path: string }[]>`
    select id, path from platform.nodes where org_id = ${identity.org.id} and deleted_at is null and starts_with(path, ${`${node.path}/`})
     order by path`)
}

/** Ce que la corbeille a décidé, sans rien écrire : le nœud et ses descendants vivants, tous visibles. */
type TrashPlan = { node: NodeRow; descendants: { id: string; path: string }[] }

/**
 * La décision de la corbeille (AC-b11), sans écrire : le nœud lu par `findNode` ; ce que l'arbre garde en
 * place refusé ; la gestion exigée ; un sous-arbre qui porte un contenu que la personne ne voit pas refusé
 * (sa purge l'effacerait sans que son propriétaire le sache, HN-E05S10e-3). Lue par `trashNode` et par le
 * récapitulatif de `node.trash` (E11-S02, AC-e1).
 */
async function trashPlan(db: PlatformDb, identity: Identity, path: string): Promise<TrashPlan> {
  const found = await findNode(db, identity, path)
  if (!found) throw unknownNode(path, identity.org.prefix)
  const { node } = found
  await refuseStructure(db, identity, node)
  if (found.level < ACCESS_LEVELS.manage) await requireNodeLevel(db, identity, { id: node.id, path: node.path }, "trash")
  const descendants = await liveDescendants(db, identity, node)
  const levels = await nodeLevels(db, identity, descendants.map((row) => row.id))
  const hidden = descendants.filter((row) => (levels.get(row.id) ?? ACCESS_LEVELS.none) === ACCESS_LEVELS.none).length
  if (hidden > 0) {
    throw new PlatformError(
      "forbidden",
      `${node.path} holds ${hidden} ${hidden === 1 ? "page" : "pages"} you cannot see: their owners must move them out before it is deleted.`,
    )
  }
  return { node, descendants }
}

/**
 * Met un nœud et son sous-arbre à la corbeille (AC-b11) : la décision (`trashPlan`), puis purge d'abord
 * l'ancien et, sous le verrou de l'arbre, une écriture de `deleted_at`, gardée par le chemin lu et par
 * les descendants jugés : un nœud déplacé, ou un contenu rangé dessous entre-temps, rend `conflict`. Rend
 * le nombre de nœuds partis, lui compris.
 */
export async function trashNode(db: PlatformDb, identity: Identity, input: unknown): Promise<Mutation<{ path: string; count: number }>> {
  const parsed = nodePathBodySchema.safeParse(input)
  if (!parsed.success) throw invalidInput(parsed.error)
  const plan = await trashPlan(db, identity, parsed.data.path)
  const { node } = plan
  const descendants = plan.descendants.map((row) => row.id)
  const teamId = teamOf(await ownerOf(db, node.id))
  await purgeTrash(db, identity)
  const changed = () => changedMeanwhile("trashNode", node.id, `${node.path} changed meanwhile: reload it and try again.`)
  const trashed = await inTransaction(db, "trash: put", async (sql) => {
    // Le verrou de l'arbre (7301, que prennent une création et un déplacement sous un jeton), puis les
    // descendants relus : un contenu rangé dessous depuis la décision n'a pas été jugé, il ne part pas.
    await sql`select pg_catalog.pg_advisory_xact_lock(7301, pg_catalog.hashtext(${identity.org.id}::text))`
    const [unjudged] = await sql<{ id: string }[]>`
      select id from platform.nodes
       where org_id = ${identity.org.id} and deleted_at is null and starts_with(path, ${`${node.path}/`})
         and not (id = any(${descendants}::uuid[]))
       limit 1`
    if (unjudged) throw changed()
    return sql<{ id: string }[]>`
      update platform.nodes set deleted_at = now()
       where org_id = ${identity.org.id} and deleted_at is null
         and ((id = ${node.id} and path = ${node.path}) or starts_with(path, ${`${node.path}/`}))
      returning id`
  })
  if (!trashed.some((row) => row.id === node.id)) throw changed()
  return { data: { path: node.path, count: trashed.length }, target: node.path, teamId }
}

type TrashedRow = { id: string; parent_id: string | null; path: string; title: string; kind: string; deleted_at: string }

/**
 * Les éléments de la corbeille (un nœud mis à la corbeille avec son sous-arbre) : un nœud à la corbeille
 * dont le parent ne l'est pas, ou pas depuis la même date ; `count` compte les nœuds partis avec lui.
 */
function trashItems(rows: readonly TrashedRow[]): (TrashedRow & { count: number })[] {
  const byId = new Map(rows.map((row) => [row.id, row]))
  const roots = rows.filter((row) => {
    const parent = row.parent_id === null ? undefined : byId.get(row.parent_id)
    return !parent || parent.deleted_at !== row.deleted_at
  })
  return roots.map((root) => ({
    ...root,
    count: rows.filter((row) => row.deleted_at === root.deleted_at && (row.id === root.id || row.path.startsWith(`${root.path}/`))).length,
  }))
}

/**
 * La corbeille de l'organisation (AC-b11) : purge d'abord ce qui y dort depuis plus de 30 jours, puis
 * les éléments que la personne peut gérer (niveau 3, décidé sur le nœud à la corbeille), le plus récent
 * d'abord, avec leur date de purge.
 */
export async function listTrash(db: PlatformDb, identity: Identity): Promise<TrashItem[]> {
  await purgeTrash(db, identity)
  const rows = await inTransaction(db, "trash: list", (sql) => sql<TrashedRow[]>`
    select id, parent_id, path, title, kind, to_json(deleted_at) #>> '{}' as deleted_at
      from platform.nodes where org_id = ${identity.org.id} and deleted_at is not null
     order by deleted_at desc, path limit ${TRASH_ROWS}`)
  const items = trashItems(rows)
  const decisions = await nodeDecisions(db, identity, items.map((item) => item.id), { trashed: true })
  return items
    .filter((item) => (decisions.get(item.id)?.level ?? ACCESS_LEVELS.none) >= ACCESS_LEVELS.manage)
    .sort((a, b) => (a.deleted_at < b.deleted_at ? 1 : a.deleted_at > b.deleted_at ? -1 : a.path < b.path ? -1 : 1))
    .map((item) => ({
      path: item.path,
      title: item.title,
      kind: item.kind,
      deletedAt: item.deleted_at,
      count: item.count,
      purgeAt: new Date(new Date(item.deleted_at).getTime() + TRASH_DAYS * DAY_MS).toISOString(),
    }))
}

/** Un nœud à la corbeille de l'organisation, par son chemin ; `null` sinon. */
async function trashedNode(db: PlatformDb, identity: Identity, path: string): Promise<NodeRow | null> {
  const [row] = await inTransaction(db, "trash: node", (sql) => sql<{ node: NodeRow }[]>`
    select to_json(n) as node from (select ${sql(NODE_SQL_COLUMNS)} from platform.nodes
                                     where org_id = ${identity.org.id} and path = ${path} and deleted_at is not null) n`)
  return row?.node ?? null
}

/**
 * Où revient un nœud restauré (HN-E05S10e-4) : sous son parent s'il est vivant ; sinon sous son plus
 * proche ancêtre vivant (un espace personnel, le dossier d'une équipe ou la racine ne vont jamais à la
 * corbeille), qu'il faut pouvoir écrire, à un chemin libre au même segment.
 */
async function restorePlace(db: PlatformDb, identity: Identity, node: NodeRow): Promise<{ parentId: string; path: string } | null> {
  const paths = ancestorPaths(node.path)
  const ancestors = await inTransaction(db, "trash: ancestors", (sql) => sql<{ id: string; path: string; deleted_at: string | null }[]>`
    select id, path, deleted_at::text from platform.nodes where org_id = ${identity.org.id} and path = any(${paths})`)
  const parent = ancestors.find((row) => row.id === node.parent_id)
  if (parent && parent.deleted_at === null) return null
  const live = ancestors.filter((row) => row.deleted_at === null).sort((a, b) => b.path.length - a.path.length)[0]
  if (!live) throw new PlatformError("internal", "Internal error.")
  if ((await nodeLevel(db, identity, live.id)) < ACCESS_LEVELS.write) {
    const owner = await ownerOf(db, live.id)
    throw new PlatformError("forbidden", reservedTo("write", `under ${live.path}`, owner ? await describeOwner(db, identity, owner) : "its managers"))
  }
  return { parentId: live.id, path: await freePath(db, identity, { parent: live.path, segment: lastSegment(node.path), nodeId: node.id }) }
}

/**
 * Restaure un élément de la corbeille (AC-b11) : le nœud et ce qui est parti avec lui (même date), à sa
 * place, ou sous son plus proche ancêtre vivant (`restorePlace`) ; la gestion du nœud exigée (décidée
 * sur le nœud à la corbeille). Une transaction : la sortie de la corbeille, puis le déplacement s'il
 * faut (la base réécrit les chemins du sous-arbre et inscrit les anciens, E01-S04, E01-S06).
 */
export async function restoreNode(db: PlatformDb, identity: Identity, input: unknown): Promise<Mutation<{ path: string; from: string; count: number }>> {
  const parsed = nodePathBodySchema.safeParse(input)
  if (!parsed.success) throw invalidInput(parsed.error)
  const node = await trashedNode(db, identity, parsed.data.path)
  if (!node) throw new PlatformError("not_found", `Nothing in the trash at ${parsed.data.path}.`)
  await requireNodeLevel(db, identity, { id: node.id, path: node.path }, "restore")
  const place = await restorePlace(db, identity, node)
  const changed = () => changedMeanwhile("restoreNode", node.id, `${node.path} changed meanwhile: reload the trash and try again.`)
  const count = await inTransaction(db, "trash: restore", async (sql) => {
    const restored = await sql<{ id: string }[]>`
      update platform.nodes set deleted_at = null
       where org_id = ${identity.org.id}
         and deleted_at = (select t.deleted_at from platform.nodes t where t.org_id = ${identity.org.id} and t.id = ${node.id} and t.path = ${node.path})
         and (id = ${node.id} or starts_with(path, ${`${node.path}/`}))
      returning id`
    if (!restored.some((row) => row.id === node.id)) throw changed()
    if (place) {
      const moved = await sql`
        update platform.nodes set parent_id = ${place.parentId}, path = ${place.path}, updated_by = ${identity.user.id}
         where org_id = ${identity.org.id} and id = ${node.id} and path = ${node.path}
        returning id`
      if (moved.length === 0) throw changed()
    }
    return restored.length
  })
  const path = place?.path ?? node.path
  return { data: { path, from: node.path, count }, target: path, teamId: teamOf(await ownerOf(db, node.id)) }
}

/** « A manager can restore it… » : où restaurer, par l'écran Corbeille de l'adresse appelée (AC-e1, AC-e2). */
function restoreHint(context: FunctionContext): string {
  return `A manager can restore it for ${TRASH_DAYS} days from the Trash screen (${context.origin ?? ""}/trash); after that it is erased.`
}

/** « with 3 pages under it » : le compte des descendants. */
function underIt(count: number): string {
  return `with ${count} ${count === 1 ? "page" : "pages"} under it`
}

/** Le récapitulatif d'AC-e1 : les contrôles de `trashNode` (`trashPlan`), sans rien écrire ; 20 chemins au plus. */
async function summarizeTrash(context: FunctionContext, args: { path: string }): Promise<FunctionSummary> {
  const { node, descendants } = await trashPlan(context.db, context.identity, args.path)
  const listed = descendants.length > 0 ? [boundedList(descendants.map((row) => `- ${row.path}`), "\n")] : []
  const under = descendants.length > 0 ? `, ${underIt(descendants.length)}:` : "."
  const text = [`About to move ${node.path} (${node.kind} « ${node.title} ») to the trash${under}`, ...listed, restoreHint(context)]
  return { text: text.join("\n"), data: { path: node.path, kind: node.kind, title: node.title, pages_under: descendants.length } }
}

export const nodeTrash = defineFunction({
  name: "node.trash",
  connector: "node",
  class: "sensitive",
  origin: "paquet",
  description:
    "Moves a page, procedure or table to the trash with everything under it, as Delete does on the screen: it disappears at once, and a manager can restore it from the Trash screen for 30 days before it is erased. Use it when the user asks to delete a content. Two steps: a summary of what would go, then confirm: true after the user agreed. Needs the manage level.",
  schema: nodePathArgsSchema,
  examples: [{ path: "ventes/essai" }],
  refusals: [
    "Unknown path: not a node you can read.",
    "The root, a personal space, a Contexte or the folder of a team: they stay in place; delete the pages inside instead.",
    "Deleting is reserved to those who manage the node: the refusal says whom to ask.",
    "Pages under it that you cannot see: their owners must move them out first.",
    "The node changed meanwhile: read it again, then retry.",
  ],
  summarize: summarizeTrash,
  run: async (context, args) => {
    const { data, teamId } = await trashNode(context.db, context.identity, args)
    const pages = data.count - 1
    return {
      text: `${data.path} moved to the trash${pages > 0 ? ` ${underIt(pages)}` : ""}. ${restoreHint(context)}`,
      data: { path: data.path, pages_under: pages },
      teamId,
    }
  },
})
