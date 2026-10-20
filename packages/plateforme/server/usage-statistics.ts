// Les statistiques de l'écran « Statistiques » (1.4.13) : adoption, contenu, partage et connecteurs, sur la fenêtre et le
// filtre d'équipe de l'usage (`usage.ts`), qui les appelle une fois son droit décidé (l'administrateur, N9). Des lectures
// agrégées et bornées, une par sujet, puis un calcul pur (`aggregateStatistics`). Un contenu que l'appelant ne lit pas
// n'est jamais nommé (D44) : seuls les comptes le portent. Sans ce module, l'administrateur ne voyait ni qui adopte les
// assistants, ni ce qu'ils écrivent et lisent, ni ce qui se partage. Les tableaux par équipe et par personne :
// `usage-people.ts`, sur les lectures d'ici.
import { NODE_PATH_PATTERN, type UsageStatistics, type UsageWeek } from "../schemas"
import { ACCESS_LEVELS, nodeLevels } from "./access"
import type { PlatformDb } from "./db"
import type { DirectoryEntry, Membership, RosterTeam } from "./directory"
import { inTransaction } from "./errors"
import type { Identity } from "./identity"
import { aggregatePeople, type PeopleReads } from "./usage-people"

/** Contenus les plus lus montrés. */
export const TOP_READ = 10
/** Membres jamais connectés nommés, au-delà le compte seul. */
const NEVER_NAMED = 20
/** Conversations et cibles lues au plus : les agrégats de la fenêtre, jamais des lignes du journal. */
const ROWS_MAX = 20_000
const DAY_MS = 86_400_000

/** Une conversation de la fenêtre : sa personne, son client, son premier appel. */
export type ConversationRow = { ctx: string; user_id: string | null; host: string | null; first: string }
/** Les appels `read` et `call` de la fenêtre, par outil et cible. */
export type TargetRow = { tool: string; target: string; calls: number; errors: number; conversations: number }

export type StatisticsReads = Omit<PeopleReads, "conversations"> & {
  conversations: ConversationRow[]
  targets: TargetRow[]
  contentWeeks: { what: "created" | "published"; week: UsageWeek; count: number }[]
  written: { origin: string | null; count: number }[]
  pendingInvitations: number
  publicLinks: { active: number; created: number }
  activations: { name: string; label: string }[]
}

export type StatisticsInput = {
  since: Date
  now: Date
  prefix: string
  roster: { teams: RosterTeam[]; memberships: Membership[] }
  directory: readonly DirectoryEntry[]
  /** L'équipe du filtre et ses personnes d'aujourd'hui ; `null` sans filtre. */
  team: { id: string; userIds: readonly string[] } | null
  /** Les titres des chemins lus que l'appelant lit ; un chemin absent n'est pas nommé. */
  titles: ReadonlyMap<string, string>
  /** Les procédures que l'appelant lit parmi les cibles des demandes : chemin → titre. */
  procedures: ReadonlyMap<string, string>
}

/** Le lundi (UTC) de la semaine d'un instant, `AAAA-MM-JJ`. */
export function weekOf(instant: Date): UsageWeek {
  const day = new Date(Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate()))
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7))
  return day.toISOString().slice(0, 10)
}

/** Les semaines de la fenêtre, de la plus ancienne à celle d'aujourd'hui. */
function weeksOf(since: Date, now: Date): UsageWeek[] {
  const weeks: UsageWeek[] = []
  for (let at = new Date(`${weekOf(since)}T00:00:00.000Z`); at <= now; at = new Date(at.getTime() + 7 * DAY_MS)) weeks.push(weekOf(at))
  return weeks
}

/** Les familles d'assistants connues, par le nom du client MCP (`claude-ai@0.1.0`, `openai-mcp@1.0.0`…). */
const ASSISTANTS: readonly { name: string; pattern: RegExp }[] = [
  { name: "Claude", pattern: /claude|anthropic/i },
  { name: "ChatGPT", pattern: /openai|chatgpt/i },
  { name: "Mistral", pattern: /mistral|le-?chat/i },
  { name: "Gemini", pattern: /gemini|google/i },
  { name: "Copilot", pattern: /copilot/i },
  { name: "Cursor", pattern: /cursor/i },
]

/** Le nom de l'assistant d'un client MCP : sa famille connue, sinon son nom sans version ; `null` sans client. */
export function assistantName(host: string | null): string | null {
  if (!host || host.trim() === "") return null
  return ASSISTANTS.find(({ pattern }) => pattern.test(host))?.name ?? (host.split("@")[0].trim() || null)
}

/** Le plus grand compte d'abord ; à égalité, par nom, un nom absent en dernier (`localeCompare` range `~` avant les lettres). */
function byCount<T extends { name: string | null }>(count: (item: T) => number) {
  return (a: T, b: T) => count(b) - count(a) || (a.name === null ? 1 : 0) - (b.name === null ? 1 : 0) || (a.name ?? "").localeCompare(b.name ?? "", "fr")
}

function adoptionOf(reads: StatisticsReads, input: StatisticsInput, weeks: readonly UsageWeek[]): UsageStatistics["adoption"] {
  const perWeek = new Map(weeks.map((week) => [week, { people: new Set<string>(), conversations: 0 }]))
  const assistants = new Map<string | null, number>()
  for (const row of reads.conversations) {
    const week = perWeek.get(weekOf(new Date(row.first)))
    if (week) {
      week.conversations += 1
      if (row.user_id) week.people.add(row.user_id)
    }
    const name = assistantName(row.host)
    assistants.set(name, (assistants.get(name) ?? 0) + 1)
  }
  const scope = input.team ? new Set(input.team.userIds) : null
  const never = input.directory.filter((person) => person.lastSignInAt === null && (scope === null || scope.has(person.userId)))
  return {
    weeks: weeks.map((week) => ({ week, people: perWeek.get(week)?.people.size ?? 0, conversations: perWeek.get(week)?.conversations ?? 0 })),
    assistants: [...assistants].map(([name, conversations]) => ({ name, conversations })).sort(byCount((item) => item.conversations)),
    pendingInvitations: reads.pendingInvitations,
    neverSignedIn: { count: never.length, names: never.map((person) => person.name).sort((a, b) => a.localeCompare(b, "fr")).slice(0, NEVER_NAMED) },
  }
}

function contentOf(reads: StatisticsReads, input: StatisticsInput, weeks: readonly UsageWeek[]): UsageStatistics["content"] {
  const count = (what: "created" | "published", week: UsageWeek) => reads.contentWeeks.find((row) => row.what === what && row.week === week)?.count ?? 0
  const written = (origin: string) => reads.written.find((row) => row.origin === origin)?.count ?? 0
  const read = `${input.prefix}_read`
  const mostRead = reads.targets
    .flatMap((row) => {
      const title = row.tool === read ? input.titles.get(row.target) : undefined
      return title === undefined ? [] : [{ path: row.target, title, reads: row.calls, conversations: row.conversations }]
    })
    .sort((a, b) => b.reads - a.reads || a.path.localeCompare(b.path))
    .slice(0, TOP_READ)
  return {
    weeks: weeks.map((week) => ({ week, created: count("created", week), published: count("published", week) })),
    written: { assistant: written("agent"), human: written("human") },
    mostRead,
  }
}

/** Les appels de `call` par famille de fonctions (`mail.create_draft` → `mail`), et chaque connecteur activé. */
function connectorsOf(reads: StatisticsReads, prefix: string): UsageStatistics["sharing"]["connectors"] {
  const families = new Map<string, { calls: number; errors: number }>()
  for (const row of reads.targets.filter((target) => target.tool === `${prefix}_call`)) {
    const name = row.target.split(".")[0]
    const family = families.get(name) ?? { calls: 0, errors: 0 }
    families.set(name, { calls: family.calls + row.calls, errors: family.errors + row.errors })
  }
  const active = new Map(reads.activations.map((activation) => [activation.name, activation.label]))
  const names = [...new Set([...active.keys(), ...families.keys()])]
  return names
    .map((name) => ({ name, label: active.get(name) ?? null, active: active.has(name), calls: families.get(name)?.calls ?? 0, errors: families.get(name)?.errors ?? 0 }))
    .sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name))
}

/** Le calcul des statistiques, sans base : chaque semaine de la fenêtre, même vide, et les listes triées. */
export function aggregateStatistics(reads: StatisticsReads, input: StatisticsInput): UsageStatistics {
  const weeks = weeksOf(input.since, input.now)
  return {
    adoption: adoptionOf(reads, input, weeks),
    content: contentOf(reads, input, weeks),
    sharing: { publicLinks: reads.publicLinks, connectors: connectorsOf(reads, input.prefix) },
    ...aggregatePeople({ ...reads, conversations: reads.conversations.map((row) => ({ user_id: row.user_id, assistant: assistantName(row.host) })) }, input),
  }
}

type Scope = { orgId: string; since: Date; userIds: readonly string[] | null; prefix: string }

/** Les conversations de la fenêtre, une ligne chacune (sa personne, son client, son premier appel). */
async function readConversations(db: PlatformDb, scope: Scope): Promise<ConversationRow[]> {
  return inTransaction(db, "usageStatistics: conversations", (sql) => sql<ConversationRow[]>`
    select j.ctx, j.user_id, j.host, to_json(min(j.ts)) #>> '{}' as first
    from platform.journal j
    where j.org_id = ${scope.orgId} and j.method = 'tools/call' and j.ts >= ${scope.since} and j.ctx is not null
      and (${scope.userIds}::uuid[] is null or j.user_id = any(${scope.userIds}::uuid[]))
    group by j.ctx, j.user_id, j.host
    order by min(j.ts) desc
    limit ${ROWS_MAX}`)
}

/** Les appels `read` et `call` de la fenêtre, comptés par cible. */
async function readTargets(db: PlatformDb, scope: Scope): Promise<TargetRow[]> {
  const tools = [`${scope.prefix}_read`, `${scope.prefix}_call`]
  return inTransaction(db, "usageStatistics: targets", (sql) => sql<TargetRow[]>`
    select j.tool, j.target, count(*)::int as calls, (count(*) filter (where j.is_error))::int as errors, count(distinct j.ctx)::int as conversations
    from platform.journal j
    where j.org_id = ${scope.orgId} and j.method = 'tools/call' and j.ts >= ${scope.since} and j.tool = any(${tools}) and j.target is not null
      and (${scope.userIds}::uuid[] is null or j.user_id = any(${scope.userIds}::uuid[]))
    group by j.tool, j.target
    order by count(*) desc, j.target
    limit ${ROWS_MAX}`)
}

/**
 * Par personne : ses appels de la fenêtre et son dernier appel au-delà d'elle ; les demandes de `context` de la fenêtre ;
 * les contenus dont un bloc publié a été écrit dans la fenêtre, par auteur et origine. Trois agrégats, une transaction.
 */
async function readPeople(db: PlatformDb, scope: Scope): Promise<Omit<PeopleReads, "conversations">> {
  const users = scope.userIds
  const context = `${scope.prefix}_context`
  return inTransaction(db, "usageStatistics: people", async (sql) => {
    const [activity, demands, authorship] = await Promise.all([
      sql<PeopleReads["activity"][number][]>`
        select j.user_id, (count(*) filter (where j.ts >= ${scope.since}))::int as calls, to_json(max(j.ts)) #>> '{}' as last
        from platform.journal j
        where j.org_id = ${scope.orgId} and j.method = 'tools/call' and j.user_id is not null
          and (${users}::uuid[] is null or j.user_id = any(${users}::uuid[]))
        group by j.user_id
        limit ${ROWS_MAX}`,
      sql<PeopleReads["demands"][number][]>`
        select j.user_id, j.target, count(*)::int as count
        from platform.journal j
        where j.org_id = ${scope.orgId} and j.method = 'tools/call' and j.ts >= ${scope.since} and j.tool = ${context}
          and not j.is_error and j.target is not null and (${users}::uuid[] is null or j.user_id = any(${users}::uuid[]))
        group by j.user_id, j.target
        order by count(*) desc, j.target
        limit ${ROWS_MAX}`,
      sql<PeopleReads["authorship"][number][]>`
        select distinct b.provenance ->> 'by' as user_id, b.provenance ->> 'origin' as origin, b.node_id
        from platform.blocks b
        where b.org_id = ${scope.orgId} and b.state = 'published' and b.updated_at >= ${scope.since}
          and (${users}::text[] is null or b.provenance ->> 'by' = any(${users}::text[]))
        limit ${ROWS_MAX}`,
    ])
    return { activity, demands, authorship }
  })
}

/** Créations et publications par semaine, blocs publiés écrits par origine ; invitations, liens publics, activations. */
async function readOrgCounts(db: PlatformDb, scope: Scope): Promise<Omit<StatisticsReads, "conversations" | "targets" | keyof Omit<PeopleReads, "conversations">>> {
  return inTransaction(db, "usageStatistics: counts", async (sql) => {
    const users = scope.userIds
    const [contentWeeks, written, [counts], activations] = await Promise.all([
      sql<StatisticsReads["contentWeeks"]>`
        select 'created' as what, to_char(date_trunc('week', n.created_at at time zone 'UTC'), 'YYYY-MM-DD') as week, count(*)::int as count
        from platform.nodes n
        where n.org_id = ${scope.orgId} and n.created_at >= ${scope.since} and (${users}::uuid[] is null or n.created_by = any(${users}::uuid[]))
        group by 2
        union all
        select 'published', to_char(date_trunc('week', v.created_at at time zone 'UTC'), 'YYYY-MM-DD'), count(*)::int
        from platform.node_versions v join platform.nodes n on n.id = v.node_id
        where n.org_id = ${scope.orgId} and v.created_at >= ${scope.since} and (${users}::uuid[] is null or v.author = any(${users}::uuid[]))
        group by 2`,
      sql<StatisticsReads["written"]>`
        select b.provenance ->> 'origin' as origin, count(*)::int as count
        from platform.blocks b
        where b.org_id = ${scope.orgId} and b.state = 'published' and b.updated_at >= ${scope.since}
          and (${users}::uuid[] is null or b.updated_by = any(${users}::uuid[]))
        group by 1`,
      sql<{ pending: number; active: number; created: number }[]>`
        select (select count(*)::int from platform.invitations i
                 where i.org_id = ${scope.orgId} and i.accepted_at is null and i.declined_at is null and i.revoked_at is null and i.expires_at > now()) as pending,
               (select count(*)::int from platform.node_shares s where s.org_id = ${scope.orgId} and s.revoked_at is null) as active,
               (select count(*)::int from platform.node_shares s where s.org_id = ${scope.orgId} and s.created_at >= ${scope.since}) as created`,
      sql<StatisticsReads["activations"]>`
        select a.connector as name, c.label from platform.connector_activations a join platform.connectors c on c.name = a.connector
        where a.org_id = ${scope.orgId} and a.state = 'active'
        order by a.connector`,
    ])
    return { contentWeeks, written, pendingInvitations: counts.pending, publicLinks: { active: counts.active, created: counts.created }, activations }
  })
}

type Readable = { titles: Map<string, string>; procedures: Map<string, string> }

/**
 * Les contenus lus par `read` et les procédures demandées par `context` que l'appelant lit (niveau 1, `nodeLevels`),
 * en une lecture ; les autres ne sont ni nommés ni comptés.
 */
async function readableNodes(db: PlatformDb, identity: Identity, targets: readonly TargetRow[], demands: PeopleReads["demands"]): Promise<Readable> {
  const read = `${identity.org.prefix}_read`
  const asPath = (target: string) => (NODE_PATH_PATTERN.test(target) ? [target] : [])
  const paths = [...new Set([...targets.flatMap((row) => (row.tool === read ? asPath(row.target) : [])), ...demands.flatMap((row) => asPath(row.target))])]
  if (paths.length === 0) return { titles: new Map(), procedures: new Map() }
  const found = await inTransaction(db, "usageStatistics: titles", (sql) => sql<{ id: string; path: string; title: string; kind: string }[]>`
    select n.id, n.path, n.title, n.kind from platform.nodes n where n.org_id = ${identity.org.id} and n.path = any(${paths}) and n.deleted_at is null`)
  const levels = await nodeLevels(db, identity, found.map((node) => node.id))
  const readable = found.filter((node) => (levels.get(node.id) ?? ACCESS_LEVELS.none) >= ACCESS_LEVELS.read)
  return {
    titles: new Map(readable.map((node) => [node.path, node.title])),
    procedures: new Map(readable.filter((node) => node.kind === "procedure").map((node) => [node.path, node.title])),
  }
}

/**
 * Les statistiques de la fenêtre (1.4.13), pour l'usage qui a décidé le droit (`usageSummary`) : quatre lectures agrégées
 * en parallèle, les titres lisibles des contenus lus et des procédures demandées, puis le calcul pur. `team` : ses
 * personnes d'aujourd'hui (N4).
 */
export async function usageStatistics(
  db: PlatformDb,
  identity: Identity,
  input: Omit<StatisticsInput, "prefix" | "titles" | "procedures">,
): Promise<UsageStatistics> {
  const scope: Scope = { orgId: identity.org.id, since: input.since, userIds: input.team?.userIds ?? null, prefix: identity.org.prefix }
  // Une transaction pour toutes les lectures, celle de `usageSummary` quand il appelle (`server/sql.ts` la reprend).
  return inTransaction(db, "usageStatistics", async () => {
    const [conversations, targets, counts, people] = await Promise.all([readConversations(db, scope), readTargets(db, scope), readOrgCounts(db, scope), readPeople(db, scope)])
    const { titles, procedures } = await readableNodes(db, identity, targets, people.demands)
    return aggregateStatistics({ conversations, targets, ...counts, ...people }, { ...input, prefix: identity.org.prefix, titles, procedures })
  })
}
