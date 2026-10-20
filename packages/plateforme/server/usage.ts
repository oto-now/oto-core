// Tableau de bord d'usage d'une organisation (E08-S09, FR-OBS-04) : procédures servies, erreurs par
// fonction et conversations dont la demande n'a trouvé ni procédure ni appel, tirées du journal, qui
// fait foi. Réservé à qui administre l'organisation (H74, N6), décidé ici avant toute lecture du
// journal (H123, `security-patterns.md § Droits dans le service`) ; le filtre de l'organisation est
// posé dans chaque requête. Aucune fonction SQL (H01) : une lecture bornée, puis un calcul pur. Sans ce
// module, l'administrateur ne voit ni ce que les assistants servent, ni ce qui ne trouve rien. Un appel
// d'une autre personne sur un espace personnel qui n'est pas celui de l'appelant n'y livre que sa demande
// coupée à `private/<handle>` et son code d'erreur, comme au journal (D44, M14 ; D107) ; le message d'erreur d'un
// autre appel y nomme un tel espace sans le chemin dessous (D52, M14b).
//
// Repris de la maquette (`mcp-test/src/proto/services/journal.ts` l. 38-49, `mcp/server.ts` l. 73-83) :
// la forme des lignes lues (`tool` préfixé, `target` = chemin servi, phrase ou fonction). Repris d'Oto
// (`outils-du-suivi.tsx`, `adoption-des-membres.tsx`) : aucun total recomposé depuis une liste coupée,
// la troncature dite. Retiré : durées, adoption par personne, clés de connecteur (hors FR-OBS-04). 1.4.13 : l'écran
// devient « Statistiques » et s'y ajoutent adoption, contenu, partage et connecteurs (`usage-statistics.ts`).
import { NODE_PATH_PATTERN, USAGE_MAX_LINES, type UsageQuery, type UsageSummary } from "../schemas"
import { ACCESS_LEVELS, describeOwner, isOrgAdmin, nodeLevels } from "./access"
import type { PlatformDb } from "./db"
import { memberDirectory, teamRoster, type Membership, type RosterTeam } from "./directory"
import { inTransaction, PlatformError } from "./errors"
import type { Identity } from "./identity"
import { cut } from "./journal"
import { errorCode, errorFor, hidesContent, journalReader, targetFor } from "./journal-rows"
import { usageStatistics } from "./usage-statistics"

/** Procédures montrées, les plus servies (AC4). */
export const TOP_PROCEDURES = 20
/** Conversations sans procédure listées, les plus récentes (AC6). */
export const UNMATCHED_LIST = 50
/** La dernière erreur d'une fonction, coupée (AC5). */
const ERROR_CHARS = 120
const DAY_MS = 86_400_000

/** Une ligne `tools/call` du journal, telle que l'agrégat la lit. */
export type UsageLine = {
  id: number
  ts: string
  ctx: string | null
  user_id: string | null
  tool: string | null
  target: string | null
  is_error: boolean
  error: string | null
  host: string | null
}

/**
 * Les procédures de l'organisation parmi les cibles de `context` : chemin → titre, ou `null` pour une
 * procédure que l'appelant ne lit pas (niveau 0) : servie, elle n'est ni nommée ni comptée, et sa
 * conversation n'est pas « sans procédure ».
 */
export type UsageProcedures = ReadonlyMap<string, string | null>

type UnmatchedItem = { ctx: string; at: string; userId: string | null; phrase: string; host: string | null }

export type UsageAggregate = Pick<UsageSummary, "totals" | "procedures" | "functions"> & {
  unmatched: { count: number; items: UnmatchedItem[] }
}

const instant = (ts: string) => Date.parse(ts)

/** La plus récente d'abord ; à égalité d'instant, l'id le plus grand (ordre d'écriture). */
function newestFirst(a: UsageLine, b: UsageLine): number {
  return instant(b.ts) - instant(a.ts) || b.id - a.id
}

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

function distinct(values: readonly (string | null)[]): number {
  return new Set(values.filter((value) => value !== null)).size
}

function groupBy(lines: readonly UsageLine[], key: (line: UsageLine) => string): Map<string, UsageLine[]> {
  const groups = new Map<string, UsageLine[]>()
  for (const line of lines) {
    const group = groups.get(key(line))
    if (group) group.push(line)
    else groups.set(key(line), [line])
  }
  return groups
}

function proceduresOf(served: readonly UsageLine[], procedures: UsageProcedures): UsageSummary["procedures"] {
  const rows = [...groupBy(served, (line) => line.target ?? "")].flatMap(([path, group]) => {
    const title = procedures.get(path)
    if (title === null || title === undefined) return []
    const last = [...group].sort(newestFirst)[0]
    const counts = { served: group.length, conversations: distinct(group.map((line) => line.ctx)), people: distinct(group.map((line) => line.user_id)) }
    return [{ path, title, ...counts, lastServedAt: last.ts }]
  })
  return rows.sort((a, b) => b.served - a.served || byText(a.path, b.path)).slice(0, TOP_PROCEDURES)
}

/** Le message d'une dernière erreur (AC5), coupé ; son code seul pour un appel de `hidden` (D44, M14). */
function shownError(line: UsageLine, hidden: ReadonlySet<number>): string {
  return hidden.has(line.id) ? (errorCode(line.error) ?? "") : cut(line.error ?? "", ERROR_CHARS)
}

/** Les appels de fonction, groupés par leur cible, la fonction (N10 : sans cible, un appel ne compte que dans les totaux). */
function callsByFunction(lines: readonly UsageLine[], prefix: string): Map<string, UsageLine[]> {
  return groupBy(
    lines.filter((line) => line.tool === `${prefix}_call` && line.target !== null),
    (line) => line.target ?? "",
  )
}

/** La dernière erreur d'une fonction (AC5) : la plus récente de ses lignes en échec. */
function lastFailure(group: readonly UsageLine[]): UsageLine | undefined {
  return group.filter((line) => line.is_error).sort(newestFirst)[0]
}

function functionsOf(groups: ReadonlyMap<string, UsageLine[]>, hidden: ReadonlySet<number>): UsageSummary["functions"] {
  return [...groups]
    .map(([name, group]) => {
      const last = lastFailure(group)
      const errors = group.filter((line) => line.is_error).length
      return { name, calls: group.length, errors, lastError: last ? { message: shownError(last, hidden), at: last.ts } : null }
    })
    .sort((a, b) => b.errors - a.errors || b.calls - a.calls || byText(a.name, b.name))
}

type Tools = { context: string; call: string }

/** Une demande : une ligne `context` sans erreur et à cible (la phrase, ou le chemin servi, E03-S02). */
const isDemand = (tools: Tools) => (line: UsageLine) => line.tool === tools.context && !line.is_error && line.target !== null

function unmatchedOf(lines: readonly UsageLine[], tools: Tools, procedures: UsageProcedures): UsageAggregate["unmatched"] {
  const items = [...groupBy(lines.filter((line) => line.ctx !== null), (line) => line.ctx ?? "")].flatMap(([ctx, group]): UnmatchedItem[] => {
    const demands = group.filter(isDemand(tools)).sort(newestFirst)
    if (demands.length === 0 || group.some((line) => line.tool === tools.call)) return []
    if (demands.some((line) => procedures.has(line.target ?? ""))) return []
    const first = demands[demands.length - 1]
    return [{ ctx, at: first.ts, userId: first.user_id, phrase: first.target ?? "", host: first.host }]
  })
  items.sort((a, b) => instant(b.at) - instant(a.at) || byText(a.ctx, b.ctx))
  return { count: items.length, items: items.slice(0, UNMATCHED_LIST) }
}

/**
 * Le calcul d'AC7, sans base : appel = une ligne ; erreur = `is_error` ; conversation = un `ctx` non
 * nul distinct ; personne active = un `user_id` distinct ; procédure servie = une demande dont la cible
 * est le chemin d'une procédure (`procedures`) ; appel de fonction = une ligne `<préfixe>_call`,
 * groupée par sa cible (N10 : sans cible, il ne compte que dans les totaux) ; conversation sans
 * procédure = un `ctx` qui a une demande, aucune procédure servie et aucun `call`, sa demande et son
 * host lus sur sa première demande. `hidden` : les ids des appels dont l'appelant ne lit que le code
 * d'erreur (D44, M14).
 */
export function aggregateUsage(lines: readonly UsageLine[], procedures: UsageProcedures, prefix: string, hidden: ReadonlySet<number>): UsageAggregate {
  const tools: Tools = { context: `${prefix}_context`, call: `${prefix}_call` }
  const served = lines.filter((line) => isDemand(tools)(line) && procedures.has(line.target ?? ""))
  return {
    totals: {
      conversations: distinct(lines.map((line) => line.ctx)),
      people: distinct(lines.map((line) => line.user_id)),
      calls: lines.length,
      errors: lines.filter((line) => line.is_error).length,
    },
    procedures: proceduresOf(served, procedures),
    functions: functionsOf(callsByFunction(lines, prefix), hidden),
    unmatched: unmatchedOf(lines, tools, procedures),
  }
}

/** Le refus d'un membre qui n'administre pas l'organisation (N9), avec à qui demander (H68). */
async function reserved(db: PlatformDb, identity: Identity): Promise<PlatformError> {
  const who = await describeOwner(db, identity, { kind: "org", teamId: null, userId: null })
  return new PlatformError("forbidden", `Reading the usage of ${identity.org.name} is reserved to ${who}. Ask them.`)
}

type LinesRequest = { since: string; userIds: readonly string[] | null }

/**
 * Les lignes `tools/call` de l'organisation depuis `since` (pour ces personnes seulement quand
 * `userIds` est donné, N4), les plus récentes d'abord, `ts` puis `id` ; une de plus que la borne, pour
 * savoir qu'elle est dépassée. Une requête, sans page : la face SQL n'a pas la coupe de PostgREST.
 * Chaque ligne passe par `to_json`, comme PostgREST la rendait : `ts` en texte ISO, à la microseconde,
 * `id` en nombre (postgres.js rendrait une `Date` et une chaîne).
 */
async function windowLines(db: PlatformDb, identity: Identity, request: LinesRequest): Promise<UsageLine[]> {
  // Une équipe sans personne aujourd'hui : aucune ligne, et aucune requête.
  if (request.userIds?.length === 0) return []
  const rows = await inTransaction(db, "usageSummary: journal", (sql) => sql<{ row: UsageLine }[]>`
    select (select to_json(r) from (select j.id, j.ts, j.ctx, j.user_id, j.tool, j.target, j.is_error, j.error, j.host) r) as row
    from platform.journal j
    where j.org_id = ${identity.org.id} and j.method = 'tools/call' and j.ts >= ${new Date(request.since)}
      ${request.userIds ? sql`and j.user_id = any(${request.userIds})` : sql``}
    order by j.ts desc, j.id desc
    limit ${USAGE_MAX_LINES + 1}`)
  return rows.map(({ row }) => row)
}

/**
 * Les procédures de l'organisation parmi les cibles de `context` qui ont la forme d'un chemin (une
 * phrase ne va jamais dans un filtre), en une lecture, aucune pour une liste vide ; niveaux de
 * l'appelant en un lot (`nodeLevels`, seuil 1), après la transaction de la lecture.
 */
async function readProcedures(db: PlatformDb, identity: Identity, lines: readonly UsageLine[]): Promise<UsageProcedures> {
  const context = `${identity.org.prefix}_context`
  const paths = [...new Set(lines.flatMap((line) => (line.tool === context && line.target && NODE_PATH_PATTERN.test(line.target) ? [line.target] : [])))]
  const found: readonly { id: string; path: string; title: string }[] =
    paths.length === 0
      ? []
      : await inTransaction(db, "usageSummary: procedures", (sql) => sql<{ id: string; path: string; title: string }[]>`
        select n.id, n.path, n.title from platform.nodes n
        where n.org_id = ${identity.org.id} and n.kind = 'procedure' and n.path = any(${paths})`)
  const levels = await nodeLevels(db, identity, found.map((node) => node.id))
  return new Map(found.map((node) => [node.path, (levels.get(node.id) ?? ACCESS_LEVELS.none) >= ACCESS_LEVELS.read ? node.title : null]))
}

/**
 * Les dernières erreurs de fonction (AC5) dont l'appelant ne lit que le code (D44, M14) : celles d'une
 * autre personne dont les arguments portent sur un espace personnel qui n'est pas le sien, la cible d'un
 * `call` étant sa fonction ; décidées par `hidesContent`, comme au journal. Seule la dernière erreur
 * d'une fonction est servie : les arguments de ces seules lignes, une par fonction, lus par ids en une
 * lecture, aucune sans ligne à examiner.
 */
async function hiddenFailures(db: PlatformDb, identity: Identity, lines: readonly UsageLine[]): Promise<ReadonlySet<number>> {
  const reader = journalReader(identity)
  const lastFailures = [...callsByFunction(lines, identity.org.prefix).values()].flatMap((group) => lastFailure(group) ?? [])
  const others = new Map(lastFailures.filter((line) => line.user_id !== reader.userId).map((line) => [line.id, line]))
  if (others.size === 0) return new Set()
  const rows = await inTransaction(db, "usageSummary: arguments", (sql) => sql<{ row: { id: number; args: unknown } }[]>`
    select (select to_json(r) from (select j.id, j.args) r) as row
    from platform.journal j
    where j.org_id = ${identity.org.id} and j.id = any(${[...others.keys()]})`)
  return new Set(rows.flatMap(({ row }) => {
    const line = others.get(row.id)
    return line && hidesContent(reader, line, row.args) ? [row.id] : []
  }))
}

type Roster = { teams: RosterTeam[]; memberships: Membership[] }

/**
 * L'équipe du filtre et ses personnes aujourd'hui (N4), celles de l'annuaire comme dans `listTeams` ;
 * `null` pour un identifiant inconnu (AC2). Lue sur l'annuaire que le service a déjà lu pour nommer
 * les personnes : une lecture de `member_directory` par calcul.
 */
function teamOf(roster: Roster, names: ReadonlyMap<string, string>, teamId: string) {
  const team = roster.teams.find((candidate) => candidate.id === teamId)
  if (!team) return null
  const userIds = roster.memberships.flatMap((link) => (link.teamId === team.id && names.has(link.userId) ? [link.userId] : []))
  return { id: team.id, name: team.name, userIds }
}

/**
 * L'usage de l'organisation sur la fenêtre (AC2 à AC8) : réservé à qui l'administre, décidé avant
 * toute lecture du journal (N9) ; 20 000 appels au plus, les plus récents, et la date à partir de
 * laquelle la période est couverte quand la borne est atteinte.
 */
export async function usageSummary(db: PlatformDb, identity: Identity, query: UsageQuery): Promise<UsageSummary> {
  if (!isOrgAdmin(identity)) throw await reserved(db, identity)
  // Une transaction pour toutes les lectures (`supabase-patterns.md § Couplage à Supabase`) : chaque lecture ci-dessous,
  // ouverte pendant elle sous le même appelant, la reprend (`server/sql.ts`).
  return inTransaction(db, "usageSummary", () => summaryOf(db, identity, query))
}

async function summaryOf(db: PlatformDb, identity: Identity, query: UsageQuery): Promise<UsageSummary> {
  const now = new Date()
  const since = new Date(now.getTime() - query.period * DAY_MS).toISOString()
  // Les équipes, lues sans filtre aussi : les statistiques comptent chacune (1.4.13).
  const [directory, roster] = await Promise.all([memberDirectory(db, identity.org.id), teamRoster(db, identity.org.id)])
  const names = new Map(directory.map((person) => [person.userId, person.name]))
  const team = query.team ? teamOf(roster, names, query.team) : null
  const [read, statistics] = await Promise.all([
    windowLines(db, identity, { since, userIds: team?.userIds ?? null }),
    usageStatistics(db, identity, { since: new Date(since), now, roster, directory, team }),
  ])
  const truncated = read.length > USAGE_MAX_LINES
  const lines = read.slice(0, USAGE_MAX_LINES)
  const [procedures, hidden] = await Promise.all([readProcedures(db, identity, lines), hiddenFailures(db, identity, lines)])
  const reader = journalReader(identity)
  // Les messages tels que l'appelant les lit, avant la coupe à 120 caractères, comme au journal (D52).
  const seen = lines.map((line) => ({ ...line, error: errorFor(reader, line.user_id, line.error) }))
  const aggregate = aggregateUsage(seen, procedures, identity.org.prefix, hidden)
  return {
    periode: query.period,
    team: team ? { id: team.id, name: team.name } : null,
    truncated,
    coveredFrom: truncated ? (lines.at(-1)?.ts ?? null) : null,
    totals: aggregate.totals,
    procedures: aggregate.procedures,
    functions: aggregate.functions,
    unmatched: {
      count: aggregate.unmatched.count,
      // Une demande sur l'espace personnel d'autrui (procédure déplacée ou retirée depuis) : `private/<handle>` (D44).
      items: aggregate.unmatched.items.map(({ userId, ...item }) => ({ ...item, phrase: targetFor(reader, userId, item.phrase), person: userId ? (names.get(userId) ?? null) : null })),
    },
    statistics,
  }
}
