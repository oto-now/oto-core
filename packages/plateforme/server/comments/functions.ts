// Les commentaires d'une page derrière `call` : `comment.list` sert les fils d'un nœud, `comment.add` ouvre un fil ou y
// répond, `comment.edit` et `comment.delete` (deux temps) corrigent et retirent un commentaire de l'appelant,
// `comment.resolve` résout ou rouvre un fil. Adaptateurs minces sur les services de l'écran (`threads.ts`,
// `comments.ts`), qui décident chaque droit : l'assistant agit comme sa personne, mêmes refus ; un commentaire écrit
// par ici est marqué `via_assistant`. Sans elles, un fil adressé à l'assistant par `@assistant` reste sans réponse.
import {
  commentAddArgsSchema,
  commentDeleteArgsSchema,
  commentEditArgsSchema,
  commentListArgsSchema,
  commentResolveArgsSchema,
  type CommentAddArgs,
  type CommentThreadView,
} from "../../schemas"
import { ACCESS_LEVELS, describeOwner } from "../access"
import { defineFunction, type FunctionContext, type FunctionOutput } from "../catalog/define"
import { PlatformError } from "../errors"
import { resolveBlockRef, type DocBlock } from "../nodes/document"
import { plural } from "../nodes/op-kit"
import { loadBlocks } from "../nodes/store"
import { ownerOf } from "../nodes/view"
import { deleteComment, deletionPreview, editComment } from "./comments"
import { blockRefs, threadText, waitingCount, type ServedThreads } from "./served"
import { commentedNode, listComments, postComment, setThreadStatus, type CommentedNode } from "./threads"

/** Fils servis au plus par `comment.list` (texte et données). */
const THREADS_LISTED = 20

/** Caractères d'un commentaire cités au plus par le récapitulatif de `comment.delete`. */
const QUOTED_CHARS = 200

const UNKNOWN_PATH = "Unknown path: not a page you can read."

const CHANGED = "The comments changed meanwhile: read them again, then retry."

/**
 * Ce qu'il faut pour servir les fils d'un nœud : la référence courte de chaque bloc publié, lue seulement si un fil
 * commente un bloc, et qui écrit la page quand l'appelant ne fait que la lire et qu'un fil attend un assistant.
 */
async function servedThreads(context: FunctionContext, node: CommentedNode, threads: readonly CommentThreadView[]): Promise<ServedThreads> {
  const { db, identity } = context
  const blocks: DocBlock[] = threads.some((thread) => thread.block !== null) ? await loadBlocks(db, node.id, "published") : []
  const reader = node.level < ACCESS_LEVELS.write && waitingCount(threads) > 0
  const owner = reader ? await ownerOf(db, node.id) : null
  return {
    path: node.path,
    prefix: identity.org.prefix,
    refOf: blockRefs(blocks),
    writers: reader ? await describeOwner(db, identity, owner ?? { kind: "org", teamId: null, userId: null }) : null,
    commentIds: true,
  }
}

async function list(context: FunctionContext, args: { path: string; status: "open" | "resolved" | "all" }): Promise<FunctionOutput> {
  const { db, identity } = context
  const node = await commentedNode(db, identity, args.path)
  const view = await listComments(db, identity, node.path)
  const wanted = args.status === "all" ? view.threads : view.threads.filter((thread) => thread.status === args.status)
  const shown = wanted.slice(0, THREADS_LISTED)
  const served = await servedThreads(context, node, shown)
  const which = args.status === "all" ? "" : `${args.status} `
  const more = wanted.length - shown.length
  const text = [
    wanted.length === 0
      ? `No ${which}comment thread on ${node.path}.`
      : `${wanted.length} ${which}comment ${plural(wanted.length, "thread")} on ${node.path} (${waitingCount(wanted)} waiting for an assistant):`,
    ...shown.map((thread) => threadText(thread, served)),
    ...(more > 0 ? [`… and ${more} more: resolve some, or read the others on the screen.`] : []),
  ].join("\n\n")
  const data = {
    path: node.path,
    threads_total: wanted.length,
    waiting_assistant: waitingCount(wanted),
    threads: shown.map((thread) => ({
      id: thread.id,
      status: thread.status,
      block: thread.block === null ? null : served.refOf(thread.block),
      anchor: thread.anchor,
      waiting_assistant: thread.waitingAssistant,
      can_resolve: thread.canResolve,
      comments: thread.comments.length,
    })),
  }
  return { text, data }
}

export const commentList = defineFunction({
  name: "comment.list",
  connector: "comment",
  class: "read",
  origin: "paquet",
  description:
    "Lists the comment threads of a page, procedure or table, the open ones by default: where each thread sits (a block by its short reference, or the page), its quote, its comments with their author and date, whether it waits for an assistant, and the exact calls to reply and to resolve. Use it when the user asks what was commented or what is left to handle on a page, or to get the id of one of their comments before comment.edit or comment.delete. Reading the page already serves its open threads. In French: commentaires, fils, remarques, relecture.",
  schema: commentListArgsSchema,
  examples: [{ path: "ventes/devis" }, { path: "ventes/devis", status: "all" }],
  refusals: [UNKNOWN_PATH],
  next: ["comment.add", "comment.resolve"],
  run: (context, args) => list(context, args),
})

/** Le bloc publié que désigne une référence courte, par son identifiant ; inconnue ou partagée par plusieurs blocs : refusée. */
async function blockOf(context: FunctionContext, node: CommentedNode, ref: string): Promise<string> {
  const prefix = context.identity.org.prefix
  const found = resolveBlockRef(await loadBlocks(context.db, node.id, "published"), ref)
  if ("block" in found && found.block.id !== null) return found.block.id
  const why = "matches" in found ? `Reference ${ref} matches ${found.matches} blocks of ${node.path}` : `Unknown block ${ref} in ${node.path}`
  throw new PlatformError("invalid_arguments", `${why}: read the page with ${prefix}_read {"path": "${node.path}", "refs": true} and give the reference of a published block, or none to comment the whole page.`)
}

async function add(context: FunctionContext, args: CommentAddArgs): Promise<FunctionOutput> {
  const { db, identity } = context
  const node = await commentedNode(db, identity, args.path)
  const block = args.block === undefined ? undefined : await blockOf(context, node, args.block)
  const { data, teamId } = await postComment(db, identity, { path: node.path, thread: args.thread, block, quote: args.quote, text: args.text }, "assistant")
  const served = await servedThreads(context, node, [data.thread])
  const done = data.created ? `Comment thread ${data.thread.id} opened on ${node.path}.` : `Reply added to thread ${data.thread.id} of ${node.path}.`
  return {
    text: `${done}\n\n${threadText(data.thread, served)}`,
    data: { path: node.path, thread: data.thread.id, comment: data.comment, created: data.created, waiting_assistant: data.thread.waitingAssistant },
    teamId,
  }
}

export const commentAdd = defineFunction({
  name: "comment.add",
  connector: "comment",
  class: "write",
  origin: "paquet",
  description:
    "Writes a comment on a page, procedure or table, in the name of the user and signed as their assistant: a reply to a thread (thread), or a new thread on the whole page or on one published block (block: its short reference, read with refs: true; quote: a passage of that block). Reading the page is enough to comment. Use it to answer a thread that waits for an assistant once the user agreed and you have done what it asks, or when the user asks to leave a remark on a page without editing it. It does not edit the page: use write for that. In French: commenter, répondre à un commentaire, laisser une remarque.",
  schema: commentAddArgsSchema,
  examples: [
    { path: "ventes/devis", thread: "5d1c2b3a-4e5f-4a6b-8c7d-9e0f1a2b3c4d", text: "Corrigé : le délai est de 30 jours partout." },
    { path: "ventes/devis", block: "a1b2c3d4", quote: "sous 15 jours", text: "@Léa Roux ce délai est-il toujours le bon ?" },
  ],
  refusals: [
    UNKNOWN_PATH,
    "An unknown thread of that page, or a resolved one: reopen it with comment.resolve, then reply.",
    "A block reference that is not a published block of the page, or a quote that is not in the text of that block; nothing is written.",
    "block or quote given with thread: they belong to the thread.",
  ],
  next: ["comment.resolve", "comment.list"],
  run: (context, args) => add(context, args),
})

export const commentEdit = defineFunction({
  name: "comment.edit",
  connector: "comment",
  class: "write",
  origin: "paquet",
  description:
    "Replaces the text of a comment written by the user (or by their assistant in their name): mentions and @assistant are read again on the new text, and the comment shows as edited. Use it to correct a comment; to answer, use comment.add. Get the comment id with comment.list. In French: modifier, corriger un commentaire.",
  schema: commentEditArgsSchema,
  examples: [{ comment: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d", text: "Corrigé : le délai est de 30 jours." }],
  refusals: ["Unknown comment: not a comment of a page you can read.", "A comment of someone else: only its author edits it; the refusal names them. Reply in the thread instead.", CHANGED],
  next: ["comment.list"],
  run: async (context, args) => {
    const { data, target, teamId } = await editComment(context.db, context.identity, args.comment, { text: args.text })
    return { text: `Comment ${args.comment} of ${target} edited.`, data: { path: target, thread: data.thread.id, comment: args.comment }, teamId }
  },
})

/** Les premiers caractères d'un texte, coupé entre deux points de code. */
function quoted(text: string): string {
  const points = Array.from(text)
  return points.length > QUOTED_CHARS ? `${points.slice(0, QUOTED_CHARS).join("")}…` : text
}

export const commentDelete = defineFunction({
  name: "comment.delete",
  connector: "comment",
  class: "sensitive",
  origin: "paquet",
  description:
    "Deletes a comment written by the user (or by their assistant in their name); the first comment of a thread takes the thread and all its replies with it, and nothing brings them back. Use it when the user asks to remove one of their comments; to close a discussion, use comment.resolve instead. Two steps: a summary of what would go, then confirm: true after the user agreed. Get the comment id with comment.list. In French: supprimer, retirer un commentaire.",
  schema: commentDeleteArgsSchema,
  examples: [{ comment: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d" }],
  refusals: ["Unknown comment: not a comment of a page you can read.", "A comment of someone else: only its author deletes it; the refusal names them.", CHANGED],
  summarize: async (context, args) => {
    const preview = await deletionPreview(context.db, context.identity, args.comment)
    const replies = preview.whole ? ` It is the first comment of its thread: the thread and its ${preview.replies} ${preview.replies === 1 ? "reply" : "replies"} would go with it.` : ""
    return {
      text: `Would delete the comment of the user on ${preview.path}: « ${quoted(preview.text)} ».${replies} Nothing brings it back.`,
      data: { path: preview.path, comment: args.comment, thread_deleted: preview.whole, replies: preview.replies },
    }
  },
  run: async (context, args) => {
    const { data, target, teamId } = await deleteComment(context.db, context.identity, args.comment)
    const whole = data.thread === null
    return { text: `Comment ${data.comment} of ${target} deleted${whole ? ", with its thread and replies" : ""}.`, data: { path: target, comment: data.comment, thread_deleted: whole }, teamId }
  },
})

export const commentResolve = defineFunction({
  name: "comment.resolve",
  connector: "comment",
  class: "write",
  origin: "paquet",
  description:
    "Resolves a comment thread, or reopens a resolved one (status: open). The thread stays readable, with who resolved it. Allowed to the author of the thread and to those who can edit the page. Use it once what the thread asks is done and answered, or when the user says a discussion is closed. In French: résoudre, clore, rouvrir un fil de commentaires.",
  schema: commentResolveArgsSchema,
  examples: [{ thread: "5d1c2b3a-4e5f-4a6b-8c7d-9e0f1a2b3c4d" }, { thread: "5d1c2b3a-4e5f-4a6b-8c7d-9e0f1a2b3c4d", status: "open" }],
  refusals: [
    "Unknown thread: not a thread of a page you can read.",
    "Resolving and reopening are reserved to the author of the thread and to those who can edit the page: the refusal names them.",
    CHANGED,
  ],
  next: ["comment.list"],
  run: async (context, args) => {
    const { data, target, teamId } = await setThreadStatus(context.db, context.identity, args.thread, { status: args.status })
    return {
      text: `Thread ${data.thread.id} of ${target} ${args.status === "resolved" ? "resolved" : "reopened"}.`,
      data: { path: target, thread: data.thread.id, status: data.thread.status },
      teamId,
    }
  },
})
