// La carte « Reprendre » de l'accueil et ses nouveautés (1.4.13) : les contenus modifiés récemment et les plus
// consultés (vues à l'écran, `node_views`, et lectures des assistants, au journal), filtrés par ce que la personne a
// touché, ce que possèdent ses équipes ou tout ce qu'elle lit ; puis les contenus publiés par d'autres depuis sa
// dernière visite. Une lecture par service, dans une transaction ; les candidats lus dans l'organisation, puis gardés
// au seuil de la lecture par `nodeLevels` (`security-patterns.md § Droits dans le service` : un filtre de liste compare
// au niveau 1). Le journal ne se lit que dans la portée de la personne (H74, `journalScope`) : un membre compte les
// lectures de ses assistants et de ceux des équipes qu'il mène, un administrateur celles de toute l'organisation.
//
// Repris : `recentDocuments` (bloc « Recent content » de `context`) lit les contenus de la personne seule, lectures
// comprises, sans page ni filtre, 20 au plus ; le bloc « What's new » (`newsItems`) rend des lignes écrites pour
// l'assistant, sans titre ni genre séparés. Ni l'un ni l'autre ne sert la carte telle quelle.
import {
  HOME_NEWS_DEFAULT_DAYS,
  HOME_NEWS_MAX,
  HOME_PAGE_SIZE,
  HOME_VIEWED_DAYS,
  homeContentsQuerySchema,
  NODE_KINDS,
  type HomeContent,
  type HomeContentsPage,
  type HomeNews,
  type HomeScope,
  type NodeKind,
} from "../schemas"
import { HOME_OFFSET_MAX } from "../schemas/accueil"
import { ACCESS_LEVELS, nodeLevels } from "./access"
import type { PlatformDb } from "./db"
import { memberDirectory } from "./directory"
import { inTransaction, invalidInput, READ_PAGE_ROWS } from "./errors"
import type { Identity } from "./identity"
import { inScope, journalScope } from "./journal-read"
import type { Tx } from "./sql"

const DAY_MS = 86_400_000

/** Candidats lus au plus par page demandée, avant le filtre de lecture. */
const SCANNED = 300

/** Un nœud candidat : de quoi le filtrer (auteurs, équipe propriétaire effective) et le montrer. */
type Candidate = { id: string; path: string; title: string; kind: string; at: string; updated_by: string | null; created_by: string | null; owner_team_id: string | null }

const kindOf = (value: string): NodeKind | null => NODE_KINDS.find((kind) => kind === value) ?? null

/** Les outils d'un assistant qui écrivent ou lisent, avec et sans le préfixe de l'organisation (`activities.ts`). */
const toolNames = (identity: Identity, tool: string) => [`${identity.org.prefix}_${tool}`, tool]

/** Le filtre de la carte, sur un candidat : touché par la personne, ou possédé par l'une de ses équipes, ou tout. */
function inHomeScope(identity: Identity, scope: HomeScope, candidate: Pick<Candidate, "created_by" | "updated_by" | "owner_team_id">): boolean {
  if (scope === "org") return true
  const me = identity.user.id
  if (candidate.created_by === me || candidate.updated_by === me) return true
  return scope === "teams" && candidate.owner_team_id !== null && identity.teams.some((team) => team.id === candidate.owner_team_id)
}

/**
 * Les contenus vivants de l'organisation, les plus récemment modifiés d'abord, `SCANNED` au plus ; ni la racine, ni le
 * dossier des espaces personnels, ni un espace personnel lui-même (la structure de l'arbre). Le filtre « Moi » ou
 * « Mes équipes » est posé dans la requête par des paramètres, jamais par un fragment.
 */
async function recentCandidates(sql: Tx, identity: Identity, scope: HomeScope): Promise<Candidate[]> {
  const teams = identity.teams.map((team) => team.id)
  return sql<Candidate[]>`
    select n.id, n.path, n.title, n.kind, to_json(n.updated_at) #>> '{}' as at, n.updated_by, n.created_by, o.owner_team_id
      from platform.nodes n
      left join lateral platform.node_owner(n.id) o on true
     where n.org_id = ${identity.org.id} and n.deleted_at is null and n.parent_id is not null
       and n.path <> 'private' and n.path !~ '^private/[^/]+$'
       and (${scope === "org"}::boolean or n.created_by = ${identity.user.id} or n.updated_by = ${identity.user.id}
            or (${scope === "teams"}::boolean and o.owner_team_id = any(${teams}::uuid[])))
     order by n.updated_at desc, n.id
     limit ${SCANNED}`
}

/** Par où le dernier changement de chaque chemin est passé, quand la portée du journal de la personne le dit. */
async function lastWrites(sql: Tx, identity: Identity, paths: readonly string[]): Promise<Map<string, "screen" | "assistant">> {
  if (paths.length === 0) return new Map()
  const rows = await sql<{ target: string; method: string }[]>`
    select distinct on (j.target) j.target, j.method from platform.journal j
     where j.org_id = ${identity.org.id} ${inScope(sql, journalScope(identity))}
       and j.target = any(${[...paths]}) and not j.is_error
       and ((j.method = 'api' and j.tool = 'POST nodes') or (j.method = 'tools/call' and j.tool = any(${toolNames(identity, "write")})))
     order by j.target, j.id desc`
  return new Map(rows.map((row) => [row.target, row.method === "api" ? "screen" : "assistant"]))
}

type Viewed = Candidate & { screen: number; assistant: number }

/**
 * Les contenus consultés sur `HOME_VIEWED_DAYS` jours : les vues à l'écran (toute l'organisation, des comptes
 * seulement) et les lectures des assistants dans la portée du journal de la personne, réunies par nœud, la plus
 * consultée d'abord.
 */
async function viewedCandidates(sql: Tx, identity: Identity): Promise<Viewed[]> {
  const org = identity.org.id
  const since = new Date(Date.now() - HOME_VIEWED_DAYS * DAY_MS)
  const [views, reads] = await Promise.all([
    sql<{ node_id: string; screen: number; at: string }[]>`
      select node_id, sum(views)::int as screen, to_json(max(last_at)) #>> '{}' as at from platform.node_views
       where org_id = ${org} and day >= current_date - ${HOME_VIEWED_DAYS}::int
       group by node_id order by screen desc limit ${SCANNED}`,
    sql<{ target: string; assistant: number; at: string }[]>`
      select j.target, count(*)::int as assistant, to_json(max(j.ts)) #>> '{}' as at from platform.journal j
       where j.org_id = ${org} ${inScope(sql, journalScope(identity))}
         and j.tool = any(${toolNames(identity, "read")}) and not j.is_error and j.target is not null and j.ts >= ${since}
       group by j.target order by assistant desc limit ${SCANNED}`,
  ])
  const ids = views.map((row) => row.node_id)
  const paths = reads.map((row) => row.target)
  if (ids.length === 0 && paths.length === 0) return []
  const nodes = await sql<Candidate[]>`
    select n.id, n.path, n.title, n.kind, to_json(n.updated_at) #>> '{}' as at, n.updated_by, n.created_by, o.owner_team_id
      from platform.nodes n
      left join lateral platform.node_owner(n.id) o on true
     where n.org_id = ${org} and n.deleted_at is null and (n.id = any(${ids}::uuid[]) or n.path = any(${paths}))`
  const byId = new Map(views.map((row) => [row.node_id, row]))
  const byPath = new Map(reads.map((row) => [row.target, row]))
  return nodes
    .map((node) => {
      const seen = byId.get(node.id)
      const read = byPath.get(node.path)
      const at = [seen?.at, read?.at].filter((when): when is string => when !== undefined).sort().at(-1) ?? node.at
      return { ...node, at, screen: seen?.screen ?? 0, assistant: read?.assistant ?? 0 }
    })
    .sort((a, b) => b.screen + b.assistant - (a.screen + a.assistant) || Date.parse(b.at) - Date.parse(a.at) || a.path.localeCompare(b.path))
}

/** Une ligne de la carte, le nom de l'auteur du dernier changement lu dans l'annuaire. */
type Line = { node: Candidate & Partial<Pick<Viewed, "screen" | "assistant">>; kind: NodeKind; via: HomeContent["via"] }

function contentOf(identity: Identity, { node, kind, via }: Line, names: ReadonlyMap<string, string>): HomeContent {
  const views = node.screen === undefined ? {} : { views: { screen: node.screen, assistant: node.assistant ?? 0 } }
  return {
    path: node.path,
    title: node.title,
    kind,
    at: node.at,
    byName: node.updated_by === null ? null : (names.get(node.updated_by) ?? null),
    byMe: node.updated_by === identity.user.id,
    via,
    ...views,
  }
}

/**
 * Une page de la carte « Reprendre » (1.4.13) : `query` validé par `homeContentsQuerySchema` (onglet, filtre, décalage) ;
 * les candidats de l'onglet, filtrés, puis gardés au seuil de la lecture ; `HOME_PAGE_SIZE` lignes à partir du
 * décalage ; `hasMore` quand d'autres suivent parmi les candidats lus.
 */
export async function homeContents(db: PlatformDb, identity: Identity, query: unknown): Promise<HomeContentsPage> {
  const parsed = homeContentsQuerySchema.safeParse(query)
  if (!parsed.success) throw invalidInput(parsed.error)
  const { tab, scope, offset } = parsed.data
  return inTransaction(db, "home: contents", async (sql) => {
    const candidates: (Candidate & Partial<Pick<Viewed, "screen" | "assistant">>)[] = tab === "recent" ? await recentCandidates(sql, identity, scope) : (await viewedCandidates(sql, identity)).filter((node) => inHomeScope(identity, scope, node))
    const levels = await nodeLevels(db, identity, candidates.map((node) => node.id))
    const readable = candidates.filter((node) => (levels.get(node.id) ?? ACCESS_LEVELS.none) >= ACCESS_LEVELS.read)
    const page = readable.slice(offset, offset + HOME_PAGE_SIZE)
    if (page.length === 0) return { items: [], hasMore: false }
    const [directory, writes] = await Promise.all([memberDirectory(db, identity.org.id), tab === "recent" ? lastWrites(sql, identity, page.map((node) => node.path)) : new Map()])
    const names = new Map(directory.map((person) => [person.userId, person.name]))
    const items = page.flatMap((node) => {
      const kind = kindOf(node.kind)
      if (kind === null) return []
      const via: HomeContent["via"] = tab === "recent" ? (writes.get(node.path) ?? null) : (node.screen ?? 0) >= (node.assistant ?? 0) ? "screen" : "assistant"
      return [contentOf(identity, { node, kind, via }, names)]
    })
    // Au-delà du dernier décalage permis, « Voir plus » demanderait une page refusée : il n'y en a pas d'autre.
    return { items, hasMore: readable.length > offset + HOME_PAGE_SIZE && offset + HOME_PAGE_SIZE <= HOME_OFFSET_MAX }
  })
}

/** La dernière visite de la personne : le début du dernier jour, avant aujourd'hui, où elle a ouvert une page ; sinon 14 jours. */
async function lastVisit(sql: Tx, identity: Identity): Promise<string> {
  const [row] = await sql<{ day: string | null }[]>`
    select max(day)::text as day from platform.node_views
     where org_id = ${identity.org.id} and user_id = ${identity.user.id} and day < current_date`
  return row?.day ? `${row.day}T00:00:00.000Z` : new Date(Date.now() - HOME_NEWS_DEFAULT_DAYS * DAY_MS).toISOString()
}

type Published = { node_id: string; path: string; title: string; kind: string; at: string; author: string | null }

/**
 * Les nouveautés de l'accueil (1.4.13) : les contenus vivants de Tout le monde et des équipes de la personne publiés par
 * quelqu'un d'autre depuis sa dernière visite, leur dernière version, la plus récente d'abord, `HOME_NEWS_MAX` au plus,
 * gardés au seuil de la lecture.
 */
export async function homeNews(db: PlatformDb, identity: Identity): Promise<HomeNews> {
  return inTransaction(db, "home: news", async (sql) => {
    const since = await lastVisit(sql, identity)
    const rows = await sql<Published[]>`
      select latest.node_id, latest.path, latest.title, latest.kind, to_json(latest.created_at) #>> '{}' as at, latest.author from (
        select distinct on (v.node_id) v.node_id, n.path, n.title, n.kind, v.created_at, v.author
          from platform.node_versions v
          join platform.nodes n on n.id = v.node_id
          left join lateral platform.node_owner(n.id) o on true
         where n.org_id = ${identity.org.id} and n.deleted_at is null and v.created_at > ${since}::text::timestamptz
           and v.author is distinct from ${identity.user.id}
           and (o.owner_kind = 'org' or o.owner_team_id = any(${identity.teams.map((team) => team.id)}::uuid[]))
         order by v.node_id, v.created_at desc) latest
       order by latest.created_at desc, latest.path
       limit ${READ_PAGE_ROWS}`
    const levels = await nodeLevels(db, identity, rows.map((row) => row.node_id))
    const readable = rows.filter((row) => (levels.get(row.node_id) ?? ACCESS_LEVELS.none) >= ACCESS_LEVELS.read).slice(0, HOME_NEWS_MAX)
    if (readable.length === 0) return { since, items: [] }
    const names = new Map((await memberDirectory(db, identity.org.id)).map((person) => [person.userId, person.name]))
    const items = readable.flatMap((row) => {
      const kind = kindOf(row.kind)
      return kind === null ? [] : [{ path: row.path, title: row.title, kind, at: row.at, byName: row.author === null ? null : (names.get(row.author) ?? null) }]
    })
    return { since, items }
  })
}
