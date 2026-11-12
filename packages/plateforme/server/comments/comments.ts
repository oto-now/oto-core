// Un commentaire d'un fil (parcours 5.4) : le modifier, le supprimer. Son auteur seul, décidé ici avant toute requête
// d'écriture : ni qui écrit la page, ni l'administrateur ne touche au commentaire d'un autre, qui reçoit `forbidden` ;
// un commentaire d'un nœud que l'appelant ne lit pas est introuvable, comme un commentaire inconnu (H68). Supprimer le
// premier commentaire d'un fil supprime le fil et ses réponses (clé en cascade). Dans un fil résolu, rien ne se modifie ni
// ne se supprime : `conflict`, le fil se rouvre d'abord. La RLS de `comments` et de
// `comment_threads` répète ces rôles. Sans ce module, un commentaire écrit ne se corrige ni ne se retire.
import { editCommentSchema, type CommentThreadView } from "../../schemas"
import type { PlatformDb } from "../db"
import { changedMeanwhile, inTransaction, invalidInput, PlatformError } from "../errors"
import type { Identity } from "../identity"
import { parseId, type Mutation } from "../members"
import { memberNames } from "../nodes/view"
import type { InOperation } from "../rules"
import { addressesAssistant, readersOf, readMentions } from "./mentions"
import { journalTeam, reachedThread, threadView, type CommentedNode, type ThreadRow } from "./threads"

type CommentRef = { id: string; thread_id: string; author: string | null; text: string }

/**
 * Le commentaire de l'organisation par son identifiant, son fil et son nœud, que l'appelant lit ; inconnu, ou d'un nœud
 * qu'il ne lit pas : `not_found`. Puis l'auteur exigé : un autre que lui reçoit `forbidden`, qui nomme l'auteur. Puis le fil
 * ouvert exigé : un commentaire d'un fil résolu est figé, `conflict` dit de rouvrir le fil. Chaque écriture qui suit est
 * gardée par ce même état (`status = 'open'`) : un fil résolu depuis cette lecture ne reçoit rien, `conflict` journalisé.
 */
async function ownComment(operation: InOperation, identity: Identity, id: string, action: "edit" | "delete"): Promise<{ comment: CommentRef; node: CommentedNode; thread: ThreadRow }> {
  const { db, sql } = operation
  const unknown = () => new PlatformError("not_found", `No comment ${id} on a page of ${identity.org.name}.`)
  const [comment] = await sql<CommentRef[]>`select id, thread_id, author, text from platform.comments where id = ${id} and org_id = ${identity.org.id}`
  if (!comment) throw unknown()
  const reached = await reachedThread(operation, identity, comment.thread_id, unknown)
  if (comment.author !== identity.user.id) {
    const author = comment.author === null ? undefined : (await memberNames(db, identity.org.id)).get(comment.author)
    throw new PlatformError(
      "forbidden",
      `Only its author${author ? ` (${author})` : ""} can ${action} this comment of ${reached.node.path}. Ask them${action === "edit" ? ", or reply in the thread" : ""}.`,
    )
  }
  if (reached.thread.status === "resolved") {
    throw new PlatformError("conflict", `This comment thread of ${reached.node.path} is resolved: reopen the thread, then ${action} your comment.`)
  }
  return { comment, ...reached }
}

function changed(context: string, id: string, node: CommentedNode): PlatformError {
  return changedMeanwhile(context, id, `The comments of ${node.path} changed meanwhile. Reload them and retry.`)
}

/**
 * Remplace le texte d'un commentaire par son auteur : `edited_at` est posé, les mentions et `@assistant` relus sur le
 * nouveau texte ; qui l'a écrit d'abord (`via_assistant`) ne change pas. Un texte inchangé n'écrit rien. Rend le fil tel que l'appelant le lit.
 */
export async function editComment(db: PlatformDb, identity: Identity, commentId: unknown, input: unknown): Promise<Mutation<{ thread: CommentThreadView }>> {
  const id = parseId(commentId, "comment")
  const parsed = editCommentSchema.safeParse(input)
  if (!parsed.success) throw invalidInput(parsed.error)
  const { text } = parsed.data
  return inTransaction(db, "comments: edit", async (sql) => {
    const { comment, node, thread } = await ownComment({ db, sql }, identity, id, "edit")
    const teamId = await journalTeam(db, node)
    if (comment.text !== text) {
      const mentions = readMentions(text, await readersOf(db, identity, node.id))
      const written = await sql`
        update platform.comments set text = ${text}, mentions = ${mentions}::uuid[], edited_at = now(), to_assistant = ${addressesAssistant(text)}
         where id = ${id} and author = ${identity.user.id} and exists (select 1 from platform.comment_threads t where t.id = ${thread.id} and t.status = 'open')
        returning id`
      if (written.length === 0) throw changed("comments: edit", id, node)
    }
    return { data: { thread: await threadView({ db, sql }, identity, node, thread.id) }, target: node.path, teamId }
  })
}

/**
 * Ce que `deleteComment` supprimerait, sans rien écrire (le premier temps de `comment.delete`) : mêmes refus, le texte du
 * commentaire, et, s'il est le premier de son fil (`whole`), les réponses qui partiraient avec lui.
 */
export async function deletionPreview(db: PlatformDb, identity: Identity, commentId: unknown): Promise<{ path: string; text: string; whole: boolean; replies: number }> {
  const id = parseId(commentId, "comment")
  return inTransaction(db, "comments: delete preview", async (sql) => {
    const { comment, node, thread } = await ownComment({ db, sql }, identity, id, "delete")
    const all = await sql<{ id: string }[]>`select c.id from platform.comments c where c.thread_id = ${thread.id} order by c.created_at, c.id`
    const whole = all[0]?.id === id
    return { path: node.path, text: comment.text, whole, replies: whole ? all.length - 1 : 0 }
  })
}

/**
 * Supprime un commentaire par son auteur. Le premier commentaire d'un fil emporte le fil et ses réponses : `thread` est
 * alors nul ; sinon le fil tel que l'appelant le lit, sans ce commentaire.
 */
export async function deleteComment(db: PlatformDb, identity: Identity, commentId: unknown): Promise<Mutation<{ comment: string; thread: CommentThreadView | null }>> {
  const id = parseId(commentId, "comment")
  return inTransaction(db, "comments: delete", async (sql) => {
    const { node, thread } = await ownComment({ db, sql }, identity, id, "delete")
    const teamId = await journalTeam(db, node)
    const [first] = await sql<{ id: string }[]>`
      select c.id from platform.comments c where c.thread_id = ${thread.id} order by c.created_at, c.id limit 1`
    const whole = first?.id === id
    const deleted = whole
      ? await sql`delete from platform.comment_threads where id = ${thread.id} and status = 'open' returning id`
      : await sql`delete from platform.comments where id = ${id} and author = ${identity.user.id} and exists (select 1 from platform.comment_threads t where t.id = ${thread.id} and t.status = 'open') returning id`
    if (deleted.length === 0) throw changed("comments: delete", id, node)
    return { data: { comment: id, thread: whole ? null : await threadView({ db, sql }, identity, node, thread.id) }, target: node.path, teamId }
  })
}
