// Les fils de commentaires destinés à une personne (parcours 5.3 et 5.2) : ce que son accueil montre (bloc
// « Commentaires », lus ou non) et ce que `context` dit à son assistant (« 2 new comments » sur la ligne de la page). Un
// fil lui est destiné quand l'un de ses commentaires la prévient, par la règle de l'email groupé (`recipientsOf`,
// `cli/comments-mail.mjs`, la seule) : elle y est mentionnée, un autre a écrit dans un fil où elle a écrit, ou elle mène
// l'équipe propriétaire de la page et le fil est nouveau ; jamais pour ses seuls commentaires. Seuls les fils ouverts,
// d'une page hors corbeille qu'elle lit encore (niveau 1, décidé ici par `nodeLevels`, `security-patterns.md § Droits
// dans le service`). « Non lu » se lit sur sa dernière visite de la page à l'écran (`node_views.last_at`, ses propres
// lignes) : aucune table. Sans ce module, un fil qui attend une personne ne se voit que sur sa page.
import { recipientsOf } from "../../cli/comments-mail.mjs"
import { HOME_COMMENT_EXCERPT_CHARS, HOME_COMMENTS_SHOWN, type HomeComments } from "../../schemas/accueil"
import { ACCESS_LEVELS, nodeLevels } from "../access"
import type { PlatformDb } from "../db"
import { inTransaction } from "../errors"
import type { Identity } from "../identity"
import { cut } from "../journal"
import { memberNames } from "../nodes/view"

/** Fils lus au plus, les plus récemment ouverts, avant la règle et le filtre de lecture. */
const FOLLOWED_THREADS = 200

/** Un commentaire d'un fil, tel que la règle le lit. */
type RuledComment = { author: string | null; mentions: readonly string[] }

/** Un fil tel que la règle le lit : son auteur, les responsables de l'équipe propriétaire de sa page, ses commentaires du plus ancien au plus récent. */
export type RuledThread = { author: string | null; teamLeads: readonly string[]; comments: readonly RuledComment[] }

/**
 * Le fil est-il destiné à `person` ? Oui quand l'un de ses commentaires la prévient (`recipientsOf`, la règle de l'email
 * groupé) : le premier commentaire du fil est un nouveau fil, les autres des réponses.
 */
export function concerns(person: string, thread: RuledThread): boolean {
  return thread.comments.some((comment, rank) =>
    recipientsOf({
      author: comment.author,
      mentions: comment.mentions,
      first: rank === 0,
      threadAuthor: thread.author,
      earlierAuthors: thread.comments.slice(0, rank).flatMap((earlier) => earlier.author ?? []),
      teamLeads: thread.teamLeads,
    }).includes(person),
  )
}

/**
 * Un commentaire d'un autre dans un fil destiné à la personne : `unseen`, il suit sa dernière visite de la page à
 * l'écran (ou elle ne l'a jamais visitée) ; `fresh`, il suit la borne demandée.
 */
export type OtherComment = { author: string | null; viaAssistant: boolean; text: string; at: string; unseen: boolean; fresh: boolean }

/** Un fil ouvert destiné à la personne, sur une page qu'elle lit : les commentaires des autres, du plus ancien au plus récent. */
export type FollowedThread = { id: string; node: { id: string; path: string; kind: string; title: string }; others: OtherComment[] }

type Row = {
  thread_id: string
  thread_author: string | null
  node_id: string
  path: string
  kind: string
  title: string
  led: boolean
  author: string | null
  mentions: string[]
  text: string
  via_assistant: boolean
  at: string
  unseen: boolean
  fresh: boolean
}

/**
 * Les fils ouverts destinés à l'appelant, sur les pages hors corbeille qu'il lit. Une lecture : les fils où il a écrit,
 * où il est mentionné, ou d'une page dont il mène l'équipe propriétaire (le propriétaire effectif, `node_owner`),
 * `FOLLOWED_THREADS` au plus, avec leurs commentaires dans l'ordre et sa dernière visite de chaque page ; puis la règle
 * (`concerns`) et les niveaux en un lot. `since` : la borne de `fresh` (texte, converti dans la requête), nulle pour
 * l'accueil, qui ne la lit pas.
 */
export async function followedThreads(db: PlatformDb, identity: Identity, since: string | null): Promise<FollowedThread[]> {
  const org = identity.org.id
  const me = identity.user.id
  const led = identity.teams.filter((team) => team.role === "lead").map((team) => team.id)
  const rows = await inTransaction(db, "comments: followed threads", (sql) => sql<Row[]>`
    with followed as (
      select t.id, t.created_by, n.id as node_id, n.path, n.kind, n.title,
             coalesce(o.owner_team_id = any(${led}::uuid[]), false) as led,
             (select max(v.last_at) from platform.node_views v where v.org_id = t.org_id and v.node_id = n.id and v.user_id = ${me}) as seen_at
        from platform.comment_threads t
        join platform.nodes n on n.id = t.node_id and n.org_id = t.org_id and n.deleted_at is null
        left join lateral platform.node_owner(n.id) o on true
       where t.org_id = ${org} and t.status = 'open'
         and (t.created_by = ${me} or o.owner_team_id = any(${led}::uuid[])
              or exists (select 1 from platform.comments c where c.thread_id = t.id and (c.author = ${me} or ${me}::uuid = any(c.mentions))))
       order by t.created_at desc, t.id
       limit ${FOLLOWED_THREADS}
    )
    select f.id as thread_id, f.created_by as thread_author, f.node_id, f.path, f.kind, f.title, f.led,
           c.author, c.mentions::text[] as mentions, c.text, c.via_assistant, to_json(c.created_at) #>> '{}' as at,
           (f.seen_at is null or c.created_at > f.seen_at) as unseen,
           coalesce(c.created_at > ${since}::text::timestamptz, false) as fresh
      from followed f
      join platform.comments c on c.thread_id = f.id
     order by c.created_at, c.id`)
  const byThread = new Map<string, Row[]>()
  for (const row of rows) byThread.set(row.thread_id, [...(byThread.get(row.thread_id) ?? []), row])
  const destined = [...byThread.values()].filter((comments) =>
    concerns(me, { author: comments[0].thread_author, teamLeads: comments[0].led ? [me] : [], comments }),
  )
  if (destined.length === 0) return []
  const levels = await nodeLevels(db, identity, [...new Set(destined.map(([first]) => first.node_id))])
  // Un filtre de liste compare `nodeLevels` à 1 seulement (`security-patterns.md § Droits dans le service`).
  return destined
    .filter(([first]) => (levels.get(first.node_id) ?? ACCESS_LEVELS.none) >= ACCESS_LEVELS.read)
    .map((comments) => ({
      id: comments[0].thread_id,
      node: { id: comments[0].node_id, path: comments[0].path, kind: comments[0].kind, title: comments[0].title },
      others: comments
        .filter((comment) => comment.author !== me)
        .map((comment) => ({ author: comment.author, viaAssistant: comment.via_assistant, text: comment.text, at: comment.at, unseen: comment.unseen, fresh: comment.fresh })),
    }))
}

/**
 * Le bloc de l'accueil, sur des fils déjà lus : les non lus d'abord, puis du dernier commentaire d'un autre le plus
 * récent au plus ancien (à date égale, par identifiant), `HOME_COMMENTS_SHOWN` au plus, et combien restent. Chaque
 * ligne dit le dernier commentaire d'un autre : son auteur par `nameOf`, son extrait (blancs réduits, coupé par `cut`).
 * Un fil sans commentaire d'un autre n'a pas de ligne.
 */
export function homeCommentsOf(threads: readonly FollowedThread[], nameOf: (userId: string) => string | undefined): HomeComments {
  const lines = threads.flatMap((thread) => {
    const last = thread.others.at(-1)
    if (!last) return []
    return [
      {
        id: thread.id,
        path: thread.node.path,
        title: thread.node.title,
        author: last.author === null ? null : (nameOf(last.author) ?? null),
        viaAssistant: last.viaAssistant,
        excerpt: cut(last.text.replace(/\s+/g, " ").trim(), HOME_COMMENT_EXCERPT_CHARS),
        at: last.at,
        unread: thread.others.some((comment) => comment.unseen),
      },
    ]
  })
  lines.sort((a, b) => Number(b.unread) - Number(a.unread) || Date.parse(b.at) - Date.parse(a.at) || a.id.localeCompare(b.id))
  return { threads: lines.slice(0, HOME_COMMENTS_SHOWN), more: Math.max(lines.length - HOME_COMMENTS_SHOWN, 0) }
}

/** Le bloc « Commentaires » de l'accueil : les fils ouverts destinés à l'appelant (`followedThreads`), lus ou non. */
export async function homeComments(db: PlatformDb, identity: Identity): Promise<HomeComments> {
  const threads = await followedThreads(db, identity, null)
  if (threads.length === 0) return { threads: [], more: 0 }
  const names = await memberNames(db, identity.org.id)
  return homeCommentsOf(threads, (userId) => names.get(userId))
}

/** Un contenu dont des fils destinés à l'appelant portent `comments` commentaires d'un autre depuis la borne ; `at` : le dernier (ISO). */
export type CommentedPage = { path: string; kind: string; title: string; comments: number; at: string }

/**
 * Les contenus dont un fil destiné à l'appelant porte un commentaire d'un autre depuis `since` (la borne des nouveautés
 * de `context`), avec leur nombre : ce que le bloc des contenus récents dit sur la ligne de la page.
 */
export async function pagesWithNewComments(db: PlatformDb, identity: Identity, since: string): Promise<CommentedPage[]> {
  const pages = new Map<string, CommentedPage>()
  for (const thread of await followedThreads(db, identity, since)) {
    const fresh = thread.others.filter((comment) => comment.fresh)
    const last = fresh.at(-1)
    if (!last) continue
    const { id, path, kind, title } = thread.node
    const known = pages.get(id)
    const at = new Date(last.at).toISOString()
    pages.set(id, { path, kind, title, comments: (known?.comments ?? 0) + fresh.length, at: known && Date.parse(known.at) > Date.parse(at) ? known.at : at })
  }
  return [...pages.values()]
}
