// Les commentaires d'une page (parcours 5.4) : les saisies que valident le service et l'écran (`server/comments/`,
// `ui/noeud/commentaires/`), et les formes que rend le service. Sans ce module, le service, l'API et l'écran
// décriraient chacun un fil, et l'écran écrirait en chiffres les bornes de la base.
import * as z from "zod/v4"
import { nodePathSchema } from "./nodes"

/** Longueur d'un commentaire (`comments_text_check`). */
export const COMMENT_MAX_CHARS = 4000

/** Longueur d'un passage cité (`comment_threads_quote_check`). */
export const COMMENT_QUOTE_MAX_CHARS = 500

/** Membres mentionnés par un commentaire, au plus (`comments_mentions_check`). */
export const COMMENT_MENTIONS_MAX = 50

export const COMMENT_THREAD_STATUSES = ["open", "resolved"] as const

export type CommentThreadStatus = (typeof COMMENT_THREAD_STATUSES)[number]

const commentTextSchema = z.string().trim().min(1).max(COMMENT_MAX_CHARS)

/**
 * `POST comments` : un commentaire sur le nœud de `path`. Avec `thread`, une réponse à ce fil ; sinon un nouveau fil, sur
 * la page entière ou sur un bloc publié (`block`, son identifiant), avec en option un passage cité de ce bloc (`quote`).
 */
export const createCommentSchema = z
  .strictObject({
    path: nodePathSchema,
    thread: z.uuid().optional(),
    block: z.uuid().optional(),
    quote: z.string().trim().min(1).max(COMMENT_QUOTE_MAX_CHARS).optional(),
    text: commentTextSchema,
  })
  .refine((value) => value.thread === undefined || (value.block === undefined && value.quote === undefined), {
    path: ["thread"],
    message: "A reply takes neither block nor quote: they belong to the thread",
  })
  .refine((value) => value.quote === undefined || value.block !== undefined, { path: ["quote"], message: "A quote needs the block it is taken from" })

export type CreateCommentInput = z.input<typeof createCommentSchema>

/** `PATCH comments/<id>` : le nouveau texte d'un commentaire. */
export const editCommentSchema = z.strictObject({ text: commentTextSchema })

export type EditCommentInput = z.input<typeof editCommentSchema>

/** `PATCH comment-threads/<id>` : résoudre (`resolved`) ou rouvrir (`open`) un fil. */
export const threadStatusSchema = z.strictObject({ status: z.enum(COMMENT_THREAD_STATUSES) })

export type ThreadStatusInput = z.input<typeof threadStatusSchema>

// Les arguments des fonctions de `call` (`server/comments/functions.ts`), décrits pour le contrat que `read` sert
// (`mcp-patterns.md § 3`). Sans eux, l'assistant d'une personne ne peut ni répondre à un fil ni le résoudre.
const commentedPath = nodePathSchema.describe("Path of the commented page, procedure or table, e.g. ventes/devis.")

const threadId = z.uuid().describe("Id of the comment thread, as read or comment.list serves it.")

const commentId = z.uuid().describe("Id of the comment, as comment.list serves it for the comments of the user.")

const servedText = commentTextSchema.describe(`Text of the comment, ${COMMENT_MAX_CHARS} characters at most. @Full Name mentions a member who reads the page; @assistant asks the next assistant of a person who can edit the page.`)

/** Les fils que `comment.list` sert : les ouverts (défaut), les résolus, ou tous. */
export const COMMENT_LIST_STATUSES = [...COMMENT_THREAD_STATUSES, "all"] as const

/** `comment.list` : les fils d'un nœud, ouverts par défaut. */
export const commentListArgsSchema = z.strictObject({
  path: commentedPath,
  status: z.enum(COMMENT_LIST_STATUSES).default("open").describe("open (default): the threads still to handle; resolved; or all."),
})

/**
 * `comment.add` : une réponse à un fil (`thread`), sinon un nouveau fil sur la page entière ou sur un bloc publié, désigné
 * par sa référence courte telle que `read` la sert avec `refs: true` (`block`), avec en option un passage cité (`quote`).
 */
export const commentAddArgsSchema = z
  .strictObject({
    path: commentedPath,
    thread: threadId.optional().describe("Reply to this thread (its id). Without it, a new thread is opened."),
    block: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .optional()
      .describe("New thread only: the published block it comments, by its short reference as read with refs: true serves it (<!-- ref: … -->). Without it, the thread comments the whole page."),
    quote: z.string().trim().min(1).max(COMMENT_QUOTE_MAX_CHARS).optional().describe("New thread on a block only: a passage of that block, quoted exactly."),
    text: servedText,
  })
  .refine((value) => value.thread === undefined || (value.block === undefined && value.quote === undefined), {
    path: ["thread"],
    message: "A reply takes neither block nor quote: they belong to the thread",
  })
  .refine((value) => value.quote === undefined || value.block !== undefined, { path: ["quote"], message: "A quote needs the block it is taken from" })

export type CommentAddArgs = z.infer<typeof commentAddArgsSchema>

/** `comment.edit` : le nouveau texte d'un commentaire de l'appelant. */
export const commentEditArgsSchema = z.strictObject({ comment: commentId, text: servedText })

/** `comment.delete` : un commentaire de l'appelant. */
export const commentDeleteArgsSchema = z.strictObject({ comment: commentId })

/** `comment.resolve` : résoudre un fil (défaut), ou le rouvrir (`status: "open"`). */
export const commentResolveArgsSchema = z.strictObject({
  thread: threadId,
  status: z.enum(COMMENT_THREAD_STATUSES).default("resolved").describe("resolved (default) closes the thread; open reopens a resolved thread."),
})

/**
 * Un commentaire tel que le lit l'appelant. `author` : le nom de son auteur, nul quand il n'est plus membre ou a été
 * oublié (« Ancien membre » à l'écran) ; `mine` : l'appelant en est l'auteur, lui seul le modifie et le supprime ;
 * `mentions` : les membres mentionnés encore connus, sous leur nom d'aujourd'hui ; `editedAt` : nul tant que le texte n'a
 * pas changé.
 */
export type CommentView = {
  id: string
  author: string | null
  mine: boolean
  text: string
  mentions: { id: string; name: string }[]
  createdAt: string
  editedAt: string | null
  /** Le texte s'adresse à l'assistant (`@assistant`). */
  toAssistant: boolean
  /** Écrit par l'assistant de son auteur (« Assistant de <nom> » à l'écran). */
  viaAssistant: boolean
}

/**
 * Où en est le passage commenté, calculé à la lecture : `page`, le fil commente la page entière ; `intact`, son bloc est
 * publié à la révision commentée ; `changed`, le bloc a été publié de nouveau depuis (« passage modifié depuis ») ;
 * `deleted`, le bloc n'est plus publié (« passage supprimé » : le fil se lit sur la page, sa citation gardée).
 */
export type CommentAnchor = "page" | "intact" | "changed" | "deleted"

/**
 * Un fil tel que le lit l'appelant. `block` : l'identifiant du bloc commenté tant qu'il est publié, nul pour la page
 * entière et pour un passage supprimé ; `section` : le titre de la section de ce bloc, nul avant le premier titre ou
 * sans bloc ; `canResolve` : l'appelant peut le résoudre et le rouvrir (son auteur, ou qui écrit la page) ;
 * `resolvedBy` : le nom de qui l'a résolu, nul s'il est ouvert ou si cette personne n'est plus membre.
 */
export type CommentThreadView = {
  id: string
  status: CommentThreadStatus
  anchor: CommentAnchor
  block: string | null
  quote: string | null
  section: string | null
  canResolve: boolean
  resolvedBy: string | null
  resolvedAt: string | null
  createdAt: string
  /** Ouvert, adressé à l'assistant, et sans réponse d'un assistant depuis (« en attente d'un assistant »). */
  waitingAssistant: boolean
  comments: CommentView[]
}

/**
 * `GET comments?path=` : les fils du nœud, ouverts d'abord, puis du plus récent au plus ancien ; `readers` : les membres
 * qui lisent le nœud, par nom, ceux qu'un commentaire peut mentionner par `@`.
 */
export type NodeCommentsView = {
  path: string
  threads: CommentThreadView[]
  readers: { id: string; name: string }[]
  /** L'hôte a un relais d'envoi : une personne mentionnée recevra l'email groupé. */
  mailEnabled: boolean
}

// La lecture des mentions d'un texte, que le service enregistre (`server/comments/`) et que l'écran annonce avant
// l'envoi et met en valeur (`ui/noeud/commentaires/mentions.ts`). Sans elle ici, l'écran et le service liraient chacun
// `@` à leur façon, et l'écran annoncerait une personne que le service ne mentionne pas.

/** La forme sous laquelle un nom et un texte se comparent : même composition des accents, sans casse. */
const comparable = (text: string) => text.normalize("NFC").toLowerCase()

const WORD_CHARACTER = /[\p{L}\p{N}_]/u

/** Un nom ne se lit pas au milieu d'un mot : « @Léa Rouxel » ne mentionne pas Léa Roux, « a@Léa Roux » non plus. */
const inWord = (character: string | undefined) => character !== undefined && WORD_CHARACTER.test(character)

/** Le mot qui adresse un commentaire à l'assistant, après `@`. */
const ASSISTANT_WORD = "assistant"

/**
 * Le texte s'adresse à l'assistant : un `@assistant` qui ne suit pas un mot, sans casse, que ne prolonge aucune lettre
 * ni chiffre (« @assistante » et « a@assistant » non). Lecture en temps linéaire : une comparaison par `@`.
 */
export function addressesAssistant(text: string): boolean {
  const haystack = comparable(text)
  for (let at = haystack.indexOf("@"); at !== -1; at = haystack.indexOf("@", at + 1)) {
    if (!inWord(haystack[at - 1]) && haystack.startsWith(ASSISTANT_WORD, at + 1) && !inWord(haystack[at + 1 + ASSISTANT_WORD.length])) return true
  }
  return false
}

/**
 * Les mentions de `text` parmi `names`, dans l'ordre du texte : un `@` qui ne suit pas un mot, suivi d'un nom entier
 * (sans casse), que ne prolonge aucune lettre ni chiffre ; de deux noms possibles, le plus long (« @Léa Roux Martin »
 * avant « @Léa Roux »). `start` (le `@`) et `end` sont des places dans le texte composé (`text.normalize("NFC")`),
 * `name` le nom sous sa forme comparée. Lecture en temps linéaire du texte : à chaque `@`, les seuls noms qui commencent
 * par le caractère qui le suit.
 */
export function mentionPlaces(text: string, names: readonly string[]): { start: number; end: number; name: string }[] {
  const byInitial = new Map<string, string[]>()
  for (const name of new Set(names.map((given) => comparable(given.trim())))) {
    if (name === "") continue
    const known = byInitial.get(name[0]) ?? []
    known.push(name)
    byInitial.set(name[0], known)
  }
  // Le plus long d'abord : le premier nom trouvé est le plus précis.
  for (const known of byInitial.values()) known.sort((a, b) => b.length - a.length)

  const haystack = comparable(text)
  const places: { start: number; end: number; name: string }[] = []
  for (let at = haystack.indexOf("@"); at !== -1; at = haystack.indexOf("@", at + 1)) {
    if (inWord(haystack[at - 1])) continue
    const found = (byInitial.get(haystack[at + 1]) ?? []).find((name) => haystack.startsWith(name, at + 1) && !inWord(haystack[at + 1 + name.length]))
    if (found) places.push({ start: at, end: at + 1 + found.length, name: found })
  }
  return places
}

/**
 * Les lecteurs mentionnés par `text` (`mentionPlaces`), dans l'ordre de leur première mention, chacun une fois,
 * `COMMENT_MENTIONS_MAX` au plus. Des homonymes sont tous mentionnés : le texte ne les distingue pas.
 */
export function readMentions(text: string, readers: readonly { id: string; name: string }[]): string[] {
  const named = new Map<string, string[]>()
  for (const reader of readers) {
    const name = comparable(reader.name.trim())
    const ids = named.get(name) ?? []
    ids.push(reader.id)
    named.set(name, ids)
  }
  const mentioned = new Set<string>()
  for (const place of mentionPlaces(text, readers.map((reader) => reader.name))) {
    for (const id of named.get(place.name) ?? []) if (mentioned.size < COMMENT_MENTIONS_MAX) mentioned.add(id)
  }
  return [...mentioned]
}
