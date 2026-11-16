// Les fils de commentaires d'un nœud (parcours 5.4 ; migration `20261112090000_platform_commentaires.sql`) : les lire,
// en ouvrir un sur la page entière ou sur un bloc publié, y répondre, le résoudre et le rouvrir. Aucune règle d'accès
// propre : un fil suit sa page. Décidé ici avant toute requête d'écriture (`security-patterns.md § Droits dans le
// service`) : lire la page suffit pour lire ses fils, en ouvrir un et répondre (`findNode`, niveau 1 ; un nœud
// invisible, à la corbeille ou inconnu répond `not_found`, H68) ; résoudre ou rouvrir revient à l'auteur du fil ou à qui
// écrit la page (niveau 2), le refus disant à qui demander. La RLS des deux tables répète ces rôles. « Passage modifié
// depuis » et « passage supprimé » se calculent à la lecture, sur les blocs publiés (`anchorOf`), jamais écrits ; « en
// attente d'un assistant » aussi (`waitingAssistant`). Un commentaire garde s'il s'adresse à l'assistant (`@assistant`)
// et s'il vient d'une fonction de `call` (`CommentOrigin`).
// Sans ce module, une personne qui lit une page ne peut rien y signaler sans la modifier.
import {
  COMMENT_THREAD_STATUSES,
  createCommentSchema,
  nodePathSchema,
  sectionOfBlock,
  threadStatusSchema,
  type CommentAnchor,
  type CommentThreadStatus,
  type CommentThreadView,
  type CommentView,
  type NodeCommentsView,
} from "../../schemas"
import { ACCESS_LEVELS, describeOwner, nodeLevel, unknownPath, type AccessLevel } from "../access"
import type { PlatformDb } from "../db"
import { changedMeanwhile, inTransaction, invalidInput, PlatformError } from "../errors"
import type { Identity } from "../identity"
import { mailRelayConfigured } from "../mail"
import { parseId, type Mutation } from "../members"
import { blockMarkdown } from "../nodes/document"
import { findNode } from "../nodes/lookup"
import { BLOCK_SQL_COLUMNS, docBlock, loadBlocks } from "../nodes/store"
import { memberNames, ownerOf, teamOf } from "../nodes/view"
import type { InOperation } from "../rules"
import type { Tx } from "../sql"
import { addressesAssistant, readersOf, readMentions } from "./mentions"

/** D'où vient un commentaire écrit : l'écran (API du paquet), ou l'assistant de son auteur (fonction de `call`). */
export type CommentOrigin = "screen" | "assistant"

/** Le nœud commenté, que l'appelant lit, et son niveau (1 à 3). */
export type CommentedNode = { id: string; path: string; kind: string; level: AccessLevel }

/** Une ligne de `comment_threads`, ses dates en texte ISO (`to_json`). */
export type ThreadRow = {
  id: string
  node_id: string
  block_id: string | null
  quote: string | null
  block_revision: number | null
  status: string
  resolved_by: string | null
  resolved_at: string | null
  created_by: string | null
  created_at: string
}

type CommentRow = {
  id: string
  thread_id: string
  author: string | null
  text: string
  mentions: string[]
  created_at: string
  edited_at: string | null
  to_assistant: boolean
  via_assistant: boolean
}

/**
 * Un fil attend un assistant : ouvert, un de ses commentaires s'adresse à l'assistant, et aucun commentaire écrit par un
 * assistant ne suit le dernier d'entre eux. `comments` du plus ancien au plus récent.
 */
export function waitingAssistant(status: CommentThreadStatus, comments: readonly Pick<CommentView, "toAssistant" | "viaAssistant">[]): boolean {
  if (status !== "open") return false
  const asked = comments.findLastIndex((comment) => comment.toAssistant)
  return asked !== -1 && !comments.slice(asked + 1).some((comment) => comment.viaAssistant)
}

/**
 * Où en est le passage commenté par un fil, d'après la révision de chaque bloc publié du nœud : la page entière, un bloc
 * intact, publié de nouveau depuis (« passage modifié depuis »), ou qui n'est plus publié (« passage supprimé »).
 */
export function anchorOf(thread: { block_id: string | null; block_revision: number | null }, published: ReadonlyMap<string, number>): CommentAnchor {
  if (thread.block_id === null) return "page"
  const revision = published.get(thread.block_id)
  if (revision === undefined) return "deleted"
  return thread.block_revision !== null && revision > thread.block_revision ? "changed" : "intact"
}

/** Les fils ouverts d'abord, puis du plus récent au plus ancien ; à date égale, par identifiant. */
export function orderThreads<T extends { id: string; status: CommentThreadStatus; createdAt: string }>(threads: readonly T[]): T[] {
  return [...threads].sort(
    (a, b) => Number(b.status === "open") - Number(a.status === "open") || Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.id.localeCompare(b.id),
  )
}

/** L'état d'un fil lu en base, nommé comme `COMMENT_THREAD_STATUSES` ; toute autre valeur : `open`. */
function statusOf(value: string): CommentThreadStatus {
  return COMMENT_THREAD_STATUSES.find((status) => status === value) ?? "open"
}

/**
 * Le nœud du chemin, que l'appelant lit (`findNode` : un ancien chemin mène au nœud courant). Inconnu, invisible, à la
 * corbeille ou mal formé : la même réponse, `not_found`, comme un chemin inconnu (H68).
 */
export async function commentedNode(db: PlatformDb, identity: Identity, path: string): Promise<CommentedNode> {
  const parsed = nodePathSchema.safeParse(path)
  if (!parsed.success) throw new PlatformError("not_found", unknownPath(path))
  const found = await findNode(db, identity, parsed.data)
  if (!found) throw new PlatformError("not_found", unknownPath(parsed.data))
  return { id: found.node.id, path: found.node.path, kind: found.node.kind, level: found.level }
}

/** Les fils d'un nœud, ou ce fil seul, ou ceux d'un état. */
function readThreads(sql: Tx, nodeId: string, threadId: string | null = null, status: CommentThreadStatus | null = null): Promise<ThreadRow[]> {
  return sql<ThreadRow[]>`
    select t.id, t.node_id, t.block_id, t.quote, t.block_revision, t.status, t.resolved_by, to_json(t.resolved_at) as resolved_at,
           t.created_by, to_json(t.created_at) as created_at
      from platform.comment_threads t
     where t.node_id = ${nodeId} and (${threadId}::uuid is null or t.id = ${threadId}::uuid) and (${status}::text is null or t.status = ${status}::text)`
}

/**
 * Un fil de l'organisation par son identifiant, et son nœud, que l'appelant lit. Un fil inconnu, ou d'un nœud qu'il ne
 * lit pas : `unknown()`, sans rien dire du nœud (H68).
 */
export async function reachedThread({ db, sql }: InOperation, identity: Identity, threadId: string, unknown: () => PlatformError): Promise<{ node: CommentedNode; thread: ThreadRow }> {
  const [node] = await sql<{ id: string; path: string; kind: string }[]>`
    select n.id, n.path, n.kind from platform.comment_threads t join platform.nodes n on n.id = t.node_id and n.org_id = t.org_id
     where t.id = ${threadId} and t.org_id = ${identity.org.id}`
  const level = node ? await nodeLevel(db, identity, node.id) : ACCESS_LEVELS.none
  if (!node || level === ACCESS_LEVELS.none) throw unknown()
  const [thread] = await readThreads(sql, node.id, threadId)
  if (!thread) throw unknown()
  return { node: { ...node, level }, thread }
}

/**
 * Les fils tels que l'appelant les lit, dans l'ordre servi : leurs commentaires du plus ancien au plus récent, le nom de
 * chaque auteur, la section et l'état du passage sur les blocs publiés (lus seulement si un fil commente un bloc), et ce
 * que l'appelant peut faire.
 */
async function threadViews({ db, sql }: InOperation, identity: Identity, node: CommentedNode, rows: readonly ThreadRow[]): Promise<CommentThreadView[]> {
  if (rows.length === 0) return []
  const [comments, names, blocks] = await Promise.all([
    sql<CommentRow[]>`
      select c.id, c.thread_id, c.author, c.text, c.mentions::text[] as mentions, to_json(c.created_at) as created_at, to_json(c.edited_at) as edited_at,
             c.to_assistant, c.via_assistant
        from platform.comments c
       where c.thread_id = any(${rows.map((row) => row.id)}::uuid[])
       order by c.created_at, c.id`,
    memberNames(db, identity.org.id),
    rows.some((row) => row.block_id !== null) ? loadBlocks(db, node.id, "published") : [],
  ])
  const published = new Map(blocks.flatMap((block) => (block.id === null ? [] : [[block.id, block.revision] as const])))
  const nameOf = (userId: string | null) => (userId === null ? null : (names.get(userId) ?? null))
  const byThread = new Map<string, CommentView[]>()
  for (const comment of comments) {
    const view: CommentView = {
      id: comment.id,
      author: nameOf(comment.author),
      mine: comment.author === identity.user.id,
      text: comment.text,
      mentions: comment.mentions.flatMap((id) => {
        const name = names.get(id)
        return name === undefined ? [] : [{ id, name }]
      }),
      createdAt: comment.created_at,
      editedAt: comment.edited_at,
      toAssistant: comment.to_assistant,
      viaAssistant: comment.via_assistant,
    }
    byThread.set(comment.thread_id, [...(byThread.get(comment.thread_id) ?? []), view])
  }
  return orderThreads(
    rows.map((row) => {
      const anchor = anchorOf(row, published)
      const block = anchor === "intact" || anchor === "changed" ? row.block_id : null
      const status = statusOf(row.status)
      const comments = byThread.get(row.id) ?? []
      return {
        id: row.id,
        status,
        anchor,
        block,
        quote: row.quote,
        section: block === null ? null : sectionOfBlock(blocks, block),
        canResolve: row.created_by === identity.user.id || node.level >= ACCESS_LEVELS.write,
        resolvedBy: nameOf(row.resolved_by),
        resolvedAt: row.resolved_at,
        createdAt: row.created_at,
        waitingAssistant: waitingAssistant(status, comments),
        comments,
      }
    }),
  )
}

/** Un fil du nœud tel que l'appelant le lit, après une écriture ; parti entre-temps : un conflit à recharger. */
export async function threadView(operation: InOperation, identity: Identity, node: CommentedNode, threadId: string): Promise<CommentThreadView> {
  const [view] = await threadViews(operation, identity, node, await readThreads(operation.sql, node.id, threadId))
  if (!view) throw changedMeanwhile("comments: thread", threadId, `The comments of ${node.path} changed meanwhile. Reload them and retry.`)
  return view
}

/** L'équipe du journal d'une mutation (H07) : celle qui possède le nœud commenté. */
export async function journalTeam(db: PlatformDb, node: CommentedNode): Promise<string | null> {
  return teamOf(await ownerOf(db, node.id))
}

/**
 * Les fils du nœud au chemin donné : ouverts d'abord, puis du plus récent au plus ancien, chacun avec ses commentaires,
 * la section et l'état de son passage, et ce que l'appelant peut faire ; avec eux, les membres qui lisent le nœud, ceux
 * qu'un commentaire peut mentionner, et si l'hôte a un relais d'envoi (`mailRelayConfigured` : l'email groupé partira).
 * Une lecture, sans ligne de journal (D138).
 */
export async function listComments(db: PlatformDb, identity: Identity, path: string): Promise<NodeCommentsView> {
  return inTransaction(db, "comments: list", async (sql) => {
    const node = await commentedNode(db, identity, path)
    const [threads, readers] = await Promise.all([threadViews({ db, sql }, identity, node, await readThreads(sql, node.id)), readersOf(db, identity, node.id)])
    return { path: node.path, threads, readers, mailEnabled: mailRelayConfigured() }
  })
}

/**
 * Les fils ouverts d'un nœud que l'appelant lit, tels qu'il les lit : ce que `read` sert à son assistant après le corps
 * de la page. Aucun fil ouvert : une seule lecture, sans ligne.
 */
export async function openThreads(db: PlatformDb, identity: Identity, node: CommentedNode): Promise<CommentThreadView[]> {
  return inTransaction(db, "comments: open threads", async (sql) => threadViews({ db, sql }, identity, node, await readThreads(sql, node.id, null, "open")))
}

/** Blancs réduits : un passage sélectionné à l'écran ne garde pas les retours de ligne du texte de son bloc. */
const spaced = (text: string) => text.replace(/\s+/g, " ").trim()

/**
 * Le bloc publié du nœud qu'un nouveau fil commente, et sa révision. Un bloc d'un autre nœud, de brouillon ou inconnu,
 * une ligne de tableau (un tableau ne se commente qu'en entier), ou une citation absente du texte du bloc tel que
 * `read` le rend : `invalid_arguments`, avant toute écriture.
 */
async function commentedBlock(sql: Tx, node: CommentedNode, blockId: string, quote: string | undefined): Promise<{ id: string; revision: number }> {
  const [row] = await sql<Parameters<typeof docBlock>[0][]>`
    select ${sql(BLOCK_SQL_COLUMNS)} from platform.blocks where node_id = ${node.id} and state = 'published' and id = ${blockId} and type <> 'row'`
  if (!row) throw new PlatformError("invalid_arguments", `Block ${blockId} is not a published block of ${node.path}: comment a published block, or the whole page.`)
  if (quote !== undefined && !spaced(blockMarkdown(docBlock(row))).includes(spaced(quote))) {
    throw new PlatformError("invalid_arguments", `The quote is not in the text of block ${blockId}: quote a passage of the published block, or none.`)
  }
  return { id: blockId, revision: row.revision }
}

/** Le fil ouvert du nœud auquel répondre ; inconnu sur ce nœud : `not_found` ; résolu : `conflict`, rien n'est écrit. */
async function repliedThread(sql: Tx, node: CommentedNode, threadId: string): Promise<string> {
  const [thread] = await readThreads(sql, node.id, threadId)
  if (!thread) throw new PlatformError("not_found", `No comment thread ${threadId} on ${node.path}.`)
  if (statusOf(thread.status) !== "open") throw new PlatformError("conflict", `This comment thread of ${node.path} is resolved: reopen the thread, then reply.`)
  return thread.id
}

/**
 * Écrit un commentaire sur le nœud au chemin donné, que l'appelant lit : une réponse en fin d'un fil ouvert (`thread`),
 * sinon le premier commentaire d'un nouveau fil, ouvert sur la page entière ou sur un bloc publié, avec la révision de ce
 * bloc et le passage cité. Les membres mentionnés par `@Prénom Nom` qui lisent la page entrent dans `mentions` ;
 * `@assistant` pose `to_assistant`, et `origin` dit si l'assistant de l'appelant l'écrit (`via_assistant`). Rend le fil tel
 * que l'appelant le lit, et l'identifiant du commentaire.
 */
export async function postComment(db: PlatformDb, identity: Identity, input: unknown, origin: CommentOrigin = "screen"): Promise<Mutation<{ thread: CommentThreadView; comment: string; created: boolean }>> {
  const parsed = createCommentSchema.safeParse(input)
  if (!parsed.success) throw invalidInput(parsed.error)
  const { path, thread, block, quote, text } = parsed.data
  return inTransaction(db, "comments: post", async (sql) => {
    const node = await commentedNode(db, identity, path)
    const anchor = thread === undefined && block !== undefined ? await commentedBlock(sql, node, block, quote) : null
    const replied = thread === undefined ? null : await repliedThread(sql, node, thread)
    const mentions = readMentions(text, await readersOf(db, identity, node.id))
    const teamId = await journalTeam(db, node)
    const [opened] =
      replied === null
        ? await sql<{ id: string }[]>`
            insert into platform.comment_threads (org_id, node_id, block_id, quote, block_revision, created_by)
            values (${identity.org.id}, ${node.id}, ${anchor?.id ?? null}, ${anchor ? (quote ?? null) : null}, ${anchor?.revision ?? null}, ${identity.user.id})
            returning id`
        : [{ id: replied }]
    // Écriture gardée par l'état du fil : résolu depuis la lecture de `repliedThread`, la réponse n'y entre pas.
    const [comment] = await sql<{ id: string }[]>`
      insert into platform.comments (org_id, thread_id, author, text, mentions, to_assistant, via_assistant)
      select ${identity.org.id}::uuid, ${opened.id}::uuid, ${identity.user.id}::uuid, ${text}::text, ${mentions}::uuid[], ${addressesAssistant(text)}::boolean, ${origin === "assistant"}::boolean
       where exists (select 1 from platform.comment_threads t where t.id = ${opened.id}::uuid and t.status = 'open')
      returning id`
    if (!comment) throw changedMeanwhile("comments: post", opened.id, `The comments of ${node.path} changed meanwhile. Reload them and retry.`)
    return { data: { thread: await threadView({ db, sql }, identity, node, opened.id), comment: comment.id, created: replied === null }, target: node.path, teamId }
  })
}

/** Le refus de résoudre ou de rouvrir : il nomme l'auteur du fil et à qui demander parmi ceux qui écrivent la page (H68). */
async function resolutionReserved(db: PlatformDb, identity: Identity, refused: { node: CommentedNode; thread: ThreadRow; status: CommentThreadStatus }): Promise<PlatformError> {
  const { node, thread, status } = refused
  const [names, owner] = await Promise.all([memberNames(db, identity.org.id), ownerOf(db, node.id)])
  const author = thread.created_by === null ? undefined : names.get(thread.created_by)
  const who = await describeOwner(db, identity, owner ?? { kind: "org", teamId: null, userId: null })
  const [verb, ask] = status === "resolved" ? ["Resolving", "resolve"] : ["Reopening", "reopen"]
  return new PlatformError(
    "forbidden",
    `${verb} a comment thread of ${node.path} is reserved to its author${author ? ` (${author})` : ""} and to those who can edit the page: ${who}. Ask them to ${ask} it.`,
  )
}

/**
 * Résout (`resolved`) ou rouvre (`open`) un fil : son auteur, ou qui écrit la page ; toute autre personne qui lit la
 * page reçoit `forbidden`, qui dit à qui demander, sans aucune écriture. Résolu, le fil garde qui l'a résolu et quand,
 * et reste lisible. Un fil déjà dans l'état demandé est rendu tel quel.
 */
export async function setThreadStatus(db: PlatformDb, identity: Identity, threadId: unknown, input: unknown): Promise<Mutation<{ thread: CommentThreadView }>> {
  const id = parseId(threadId, "comment thread")
  const parsed = threadStatusSchema.safeParse(input)
  if (!parsed.success) throw invalidInput(parsed.error)
  const { status } = parsed.data
  return inTransaction(db, "comments: thread status", async (sql) => {
    const unknown = () => new PlatformError("not_found", `No comment thread ${id} on a page of ${identity.org.name}.`)
    const { node, thread } = await reachedThread({ db, sql }, identity, id, unknown)
    if (thread.created_by !== identity.user.id && node.level < ACCESS_LEVELS.write) throw await resolutionReserved(db, identity, { node, thread, status })
    const teamId = await journalTeam(db, node)
    if (statusOf(thread.status) !== status) {
      const resolved = status === "resolved"
      const written = await sql`
        update platform.comment_threads
           set status = ${status}, resolved_by = ${resolved ? identity.user.id : null}, resolved_at = case when ${resolved}::boolean then now() end
         where id = ${id} and status = ${thread.status}
        returning id`
      if (written.length === 0) throw changedMeanwhile("comments: thread status", id, `The comments of ${node.path} changed meanwhile. Reload them and retry.`)
    }
    return { data: { thread: await threadView({ db, sql }, identity, node, id) }, target: node.path, teamId }
  })
}
