// La carte « Reprendre » de l'accueil (1.4.13) : les contenus modifiés récemment et les plus consultés (vues à l'écran,
// `node_views`, et lectures des assistants, au journal), filtrés par ce que la personne a touché, ce que possèdent ses
// équipes ou tout ce qu'elle lit. Une ligne dit l'espace du contenu (son équipe propriétaire, Tout le monde, Privé), jamais son chemin ni
// son auteur. Une lecture par service, dans une transaction ; les candidats lus dans l'organisation, puis gardés
// au seuil de la lecture par `nodeLevels` (`security-patterns.md § Droits dans le service` : un filtre de liste compare
// au niveau 1). Le journal ne se lit que dans la portée de la personne (H74, `journalScope`) : un membre compte les
// lectures de ses assistants et de ceux des équipes qu'il mène, un administrateur celles de toute l'organisation.
//
// Repris : `recentDocuments` (bloc « Recent content » de `context`) lit les contenus de la personne seule, lectures
// comprises, sans page ni filtre, 20 au plus : il ne sert pas la carte telle quelle.
import {
  HOME_PAGE_SIZE,
  HOME_VIEWED_DAYS,
  homeContentsQuerySchema,
  NODE_KINDS,
  type HomeContent,
  type HomeContentsPage,
  type HomeScope,
  type HomeSpace,
  type NodeKind,
} from "../schemas"
import { HOME_OFFSET_MAX } from "../schemas/accueil"
import { ACCESS_LEVELS, nodeLevels } from "./access"
import type { PlatformDb } from "./db"
import { inTransaction, invalidInput } from "./errors"
import type { Identity } from "./identity"
import { inScope, journalScope } from "./journal-read"
import type { Tx } from "./sql"

const DAY_MS = 86_400_000

/** Candidats lus au plus par page demandée, avant le filtre de lecture. */
const SCANNED = 300

/** Un nœud candidat : de quoi le filtrer (auteurs, équipe propriétaire effective) et le montrer (son espace). */
type Candidate = {
  id: string
  path: string
  title: string
  kind: string
  at: string
  updated_by: string | null
  created_by: string | null
  owner_kind: string | null
  owner_team_id: string | null
  owner_team_name: string | null
}

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
    select n.id, n.path, n.title, n.kind, to_json(n.updated_at) #>> '{}' as at, n.updated_by, n.created_by, o.owner_kind, o.owner_team_id, t.name as owner_team_name
      from platform.nodes n
      left join lateral platform.node_owner(n.id) o on true
      left join platform.teams t on t.id = o.owner_team_id
     where n.org_id = ${identity.org.id} and n.deleted_at is null and n.parent_id is not null
       and n.path <> 'private' and n.path !~ '^private/[^/]+$'
       and (${scope === "org"}::boolean or n.created_by = ${identity.user.id} or n.updated_by = ${identity.user.id}
            or (${scope === "teams"}::boolean and o.owner_team_id = any(${teams}::uuid[])))
     order by n.updated_at desc, n.id
     limit ${SCANNED}`
}

type Viewed = Candidate & { screen: number; assistant: number }

/**
 * Les contenus consultés sur `HOME_VIEWED_DAYS` jours : les vues à l'écran (toute l'organisation, des comptes par page
 * que la personne lit, `node_view_counts`) et les lectures des assistants dans la portée du journal de la personne,
 * réunies par nœud, la plus consultée d'abord.
 */
async function viewedCandidates(sql: Tx, identity: Identity): Promise<Viewed[]> {
  const org = identity.org.id
  const since = new Date(Date.now() - HOME_VIEWED_DAYS * DAY_MS)
  const [views, reads] = await Promise.all([
    // Les vues de toute l'organisation, que la personne ne lit pas ligne à ligne (`20261021150000`) : des comptes par page
    // vivante qu'elle lit, par `node_view_counts`.
    sql<{ node_id: string; screen: number; at: string }[]>`
      select c.node_id, c.views as screen, to_json(c.last_at) #>> '{}' as at
        from platform.node_view_counts(${org}, ${HOME_VIEWED_DAYS}::int, ${SCANNED}::int) c`,
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
    select n.id, n.path, n.title, n.kind, to_json(n.updated_at) #>> '{}' as at, n.updated_by, n.created_by, o.owner_kind, o.owner_team_id, t.name as owner_team_name
      from platform.nodes n
      left join lateral platform.node_owner(n.id) o on true
      left join platform.teams t on t.id = o.owner_team_id
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

/** L'espace d'un contenu : son équipe propriétaire effective, Tout le monde, ou un espace personnel ; sans propriétaire lu, Tout le monde. */
function spaceOf(node: Pick<Candidate, "owner_kind" | "owner_team_name">): HomeSpace {
  if (node.owner_kind === "team" && node.owner_team_name !== null) return { kind: "team", name: node.owner_team_name }
  return node.owner_kind === "user" ? { kind: "user" } : { kind: "org" }
}

/** Une ligne de la carte. */
function contentOf(node: Candidate & Partial<Pick<Viewed, "screen" | "assistant">>, kind: NodeKind): HomeContent {
  const views = node.screen === undefined ? {} : { views: { screen: node.screen, assistant: node.assistant ?? 0 } }
  return { path: node.path, title: node.title, kind, space: spaceOf(node), at: node.at, ...views }
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
    const items = page.flatMap((node) => {
      const kind = kindOf(node.kind)
      return kind === null ? [] : [contentOf(node, kind)]
    })
    // Au-delà du dernier décalage permis, « Voir plus » demanderait une page refusée : il n'y en a pas d'autre.
    return { items, hasMore: readable.length > offset + HOME_PAGE_SIZE && offset + HOME_PAGE_SIZE <= HOME_OFFSET_MAX }
  })
}

