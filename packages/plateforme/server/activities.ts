// Les activités de l'accueil (E05-S12, lot B, AC-12 à AC-17 ; HN-E05S12-14 à -18) : ce qui est arrivé aux
// contenus sur la période, lu au journal, aux deux portes (écran et assistant). Une ligne de journal devient
// un geste classé (créé, modifié, publié, déplacé, dupliqué, mis à la corbeille, restauré, lignes écrites,
// revue, procédure lancée) ; les gestes d'une personne sur un même contenu, du même verbe, à moins d'une heure
// l'un de l'autre, font une activité. Sans ce module, l'accueil ne montre que les conversations d'assistant
// (`listConversations` ne lit que les lignes à `ctx`) : rien de ce qui se fait à l'écran.
//
// La portée est celle du journal (H74, `journalScope`), décidée avant la requête et posée dedans
// (`security-patterns.md § Droits dans le service`) ; la requête ne rend jamais `args` entiers, seulement les
// champs qui classent ; l'espace personnel d'autrui reste coupé à `private/<handle>` (D44, `targetFor`) ; titre
// et lien seulement pour un contenu que la personne lit (`resolveTargets`, niveau ≥ lecture). Aucune migration.
// Repris d'oto-frontend (`accueil/fil-activite.tsx`) : un fil par journée ; retiré : la prose d'action écrite
// par le serveur (→ un verbe classé, écrit par l'écran).
import type { HomeScope } from "../schemas/accueil"
import { ACTIVITIES_MAX, ACTIVITY_GROUP_MS, type Activity, type ActivityPage, type ActivityVerb } from "../schemas/activity"
import { JOURNAL_ROWS_SCANNED } from "../schemas/journal"
import { NODE_KINDS, NODE_PATH_PATTERN, type NodeKind } from "../schemas/nodes"
import { ACCESS_LEVELS, nodeDecisions } from "./access"
import type { PlatformDb } from "./db"
import { memberDirectory } from "./directory"
import { inTransaction } from "./errors"
import type { Identity } from "./identity"
import { inScope, journalScope } from "./journal-read"
import { bareTool, journalReader, targetFor, type JournalReader } from "./journal-rows"
import { resolveTargets, type TargetNode } from "./nodes/link-resolution"

const DAY_MS = 86_400_000

/** Les lignes de l'écran qui sont des gestes sur un contenu (outil « <VERBE> <ressource>[/<segment>] », H07) ; `write` se classe par ses arguments. */
const SCREEN_GESTURES: Readonly<Record<string, ActivityVerb | "write">> = {
  "POST nodes": "write",
  "POST nodes/move": "moved",
  "POST nodes/duplicate": "duplicated",
  "POST trash": "trashed",
  "POST trash/restore": "restored",
  "POST tables/review": "reviewed",
}

/**
 * Les outils des assistants lus : l'écriture, l'appel d'une fonction (`table.write` ; `node.trash` et
 * `table.delete_rows` confirmés, E11-S02), le routage de `context`.
 */
const ASSISTANT_TOOLS = ["write", "call", "context"] as const

/**
 * Une ligne telle que la requête la rend (AC-17) : ses colonnes, et des arguments seulement ce qui classe
 * (`publish` vrai, `base_revision` présent, arguments coupés, `kind`, tableau d'un `table.write`), bornés.
 * E11-S02 (AC-h3) : `confirm` vrai d'un `call`, chemin de ses arguments, et lignes à revoir supprimées
 * (`args._outcome.review`, un entier, sinon nul) ; facultatifs pour les lignes écrites à la main.
 */
export type ActivityRow = {
  id: number
  ts: string
  user_id: string | null
  ctx: string | null
  method: string
  tool: string | null
  target: string | null
  publish: boolean
  revised: boolean
  truncated: boolean
  kind: string | null
  table: string | null
  confirmed?: boolean
  path?: string | null
  review?: number | null
}

/**
 * Un geste classé, avant la relecture du contenu : son chemin tel que le lecteur le voit, et la nature que disent
 * les arguments ; `inReview`, les lignes à revoir d'une suppression de lignes (E11-S02, AC-h3).
 */
export type Gesture = { id: number; at: string; userId: string | null; ctx: string | null; verb: ActivityVerb; path: string; kind: NodeKind | null; inReview?: number }

const nodeKind = (value: string | null | undefined): NodeKind | null => NODE_KINDS.find((kind) => kind === value) ?? null

/** Une écriture (`write`, `POST nodes`) : arguments coupés → modifiée ; `publish: true` → publiée ; sans `base_revision` → créée (HN-E05S12-15). */
function writeVerb(row: ActivityRow): ActivityVerb {
  if (row.truncated) return "edited"
  if (row.publish) return "published"
  return row.revised ? "edited" : "created"
}

/**
 * Un `call` qui est un geste sur un contenu : `table.write`, `node.move` (E11-S18, HN-E11S18-14 : son ancien chemin, que
 * la relecture suit jusqu'au nœud déplacé), et l'exécution confirmée de `node.trash` et de `table.delete_rows` (E11-S02,
 * AC-h3) ; un récapitulatif sans `confirm`, `node.discard_draft` et `node.write_many` (ses pages, coupées au journal,
 * ne s'y lisent pas) n'y sont pas.
 */
function callVerbAndPath(row: ActivityRow): { verb: ActivityVerb; path: string | null } | null {
  if (row.target === "table.write") return { verb: "wrote_rows", path: row.table }
  if (row.target === "node.move") return { verb: "moved", path: row.path ?? null }
  if (row.confirmed !== true) return null
  if (row.target === "node.trash") return { verb: "trashed", path: row.path ?? null }
  if (row.target === "table.delete_rows") return { verb: "deleted_rows", path: row.table }
  return null
}

/** Le verbe et le chemin d'une ligne, sinon `null` : une ligne qui n'est pas un geste sur un contenu. */
function verbAndPath(row: ActivityRow, prefix: string): { verb: ActivityVerb; path: string | null } | null {
  if (row.method === "api") {
    const gesture = row.tool === null ? undefined : SCREEN_GESTURES[row.tool]
    if (gesture === undefined) return null
    return { verb: gesture === "write" ? writeVerb(row) : gesture, path: row.target }
  }
  if (row.method !== "tools/call") return null
  const tool = bareTool(row.tool, prefix)
  if (tool === "write") return { verb: writeVerb(row), path: row.target }
  // Le chemin du tableau est dans les arguments ; illisible (arguments coupés), la ligne est omise (HN-E05S12-15).
  if (tool === "call") return callVerbAndPath(row)
  // Une procédure lancée : confirmée à la relecture, si la cible est une procédure que la personne lit.
  if (tool === "context") return { verb: "ran", path: row.target }
  return null
}

/**
 * Le geste d'une ligne pour son lecteur (AC-12, AC-15), sinon `null` : chemin et tableau coupés à
 * `private/<handle>` sur l'espace personnel d'autrui (D44) ; la nature des arguments, sur une ligne du lecteur seulement.
 */
export function classifyRow(row: ActivityRow, reader: JournalReader, prefix: string): Gesture | null {
  const found = verbAndPath(row, prefix)
  if (found === null || found.path === null) return null
  const path = targetFor(reader, row.user_id, found.path)
  if (found.verb === "ran" && !NODE_PATH_PATTERN.test(path)) return null
  // La nature des arguments sur une ligne du lecteur seulement : ceux d'une autre personne peuvent nommer son
  // espace personnel ailleurs que dans la cible, et la requête ne les relit pas entiers (AC-17) ; plus strict que
  // `hidesContent` du journal, qui les lit (HB-E05S12-10).
  const kind = row.user_id === reader.userId ? nodeKind(row.kind) : null
  const inReview = found.verb === "deleted_rows" && row.review ? { inReview: row.review } : {}
  return { id: row.id, at: row.ts, userId: row.user_id, ctx: row.ctx, verb: found.verb, path, kind, ...inReview }
}

/** Ce que la relecture sait d'un chemin : le nœud que la personne lit, ou la nature d'un nœud à la corbeille qu'elle lisait. */
export type Resolution = { node?: TargetNode; trashedKind?: NodeKind }

/** La nature que le verbe dit à coup sûr : des lignes s'écrivent dans un tableau, une procédure se lance. */
const VERB_KINDS: Partial<Record<ActivityVerb, NodeKind>> = { wrote_rows: "table", reviewed: "table", ran: "procedure", deleted_rows: "table" }

/** L'activité d'un geste relu (AC-13, AC-15), sinon `null` : une cible de `context` qui n'est pas une procédure lue n'est pas lancée. */
function activityOf(gesture: Gesture, resolution: Resolution | undefined, names: ReadonlyMap<string, string>): Activity | null {
  const node = resolution?.node
  if (gesture.verb === "ran" && node?.kind !== "procedure") return null
  return {
    id: gesture.id,
    at: gesture.at,
    userId: gesture.userId,
    userName: gesture.userId === null ? null : (names.get(gesture.userId) ?? null),
    verb: gesture.verb,
    kind: nodeKind(node?.kind) ?? resolution?.trashedKind ?? VERB_KINDS[gesture.verb] ?? gesture.kind,
    path: node?.path ?? gesture.path,
    title: node?.title ?? null,
    count: 1,
    ctx: gesture.verb === "ran" ? gesture.ctx : null,
    ...(gesture.inReview ? { inReview: gesture.inReview } : {}),
  }
}

/**
 * Les activités des gestes, les plus récents d'abord (AC-13, AC-14) : même personne, même contenu (le nœud
 * relu, sinon le chemin), même verbe, moins d'une heure entre deux gestes → une activité, à l'heure du plus
 * récent, avec leur nombre, et la somme de leurs lignes à revoir supprimées (E11-S02, AC-h3) ; `limit`
 * activités au plus.
 */
export function groupGestures(gestures: readonly Gesture[], resolutions: ReadonlyMap<string, Resolution>, names: ReadonlyMap<string, string>, limit: number): Activity[] {
  const activities: Activity[] = []
  const open = new Map<string, { activity: Activity; oldest: number }>()
  for (const gesture of gestures) {
    const resolution = resolutions.get(gesture.path)
    const activity = activityOf(gesture, resolution, names)
    if (activity === null) continue
    const key = JSON.stringify([gesture.userId, gesture.verb, resolution?.node?.id ?? gesture.path])
    const at = Date.parse(gesture.at)
    const group = open.get(key)
    if (group && Math.abs(group.oldest - at) < ACTIVITY_GROUP_MS) {
      group.activity.count += 1
      if (activity.inReview) group.activity.inReview = (group.activity.inReview ?? 0) + activity.inReview
      group.oldest = at
      continue
    }
    activities.push(activity)
    open.set(key, { activity, oldest: at })
  }
  return activities.slice(0, limit)
}

/**
 * Les lignes de la période dans la portée (AC-17) : les gestes d'écran et les outils des assistants, sans
 * erreur, à cible ; le filtre de l'accueil (1.4.13) la resserre, par des paramètres : « Moi », ses lignes ; « Mes équipes », les
 * siennes et celles de ses équipes ; « Toute l'organisation », toute la portée ; les `JOURNAL_ROWS_SCANNED` plus récentes, une de plus pour dire `truncated`. Aucun `args`
 * entier : les champs qui classent, bornés.
 */
async function scanRows(db: PlatformDb, identity: Identity, since: Date, scope: HomeScope): Promise<{ rows: ActivityRow[]; truncated: boolean }> {
  const prefix = identity.org.prefix
  const tools = ASSISTANT_TOOLS.flatMap((tool) => [`${prefix}_${tool}`, tool])
  const me = identity.user.id
  const teams = identity.teams.map((team) => team.id)
  const read = await inTransaction(db, "activities: rows", (sql) => sql<{ row: ActivityRow }[]>`
    select (select to_json(r) from (
      select j.id, j.ts, j.user_id, j.ctx, j.method, j.tool, j.target,
             coalesce((j.args -> 'publish') = 'true'::jsonb, false) as publish,
             coalesce(j.args ? 'base_revision', false) as revised,
             coalesce(j.args ? '_truncated', false) as truncated,
             left(j.args ->> 'kind', 20) as kind,
             left(j.args -> 'arguments' ->> 'table', 200) as "table",
             coalesce((j.args -> 'confirm') = 'true'::jsonb, false) as confirmed,
             left(j.args -> 'arguments' ->> 'path', 1000) as path,
             case when jsonb_typeof(j.args -> '_outcome' -> 'review') = 'number' and (j.args -> '_outcome' ->> 'review') ~ '^[0-9]{1,9}$'
                  then (j.args -> '_outcome' ->> 'review')::int end as review) r) as row
    from platform.journal j
    where j.org_id = ${identity.org.id} ${inScope(sql, journalScope(identity))}
      and (${scope !== "me"}::boolean or j.user_id = ${me})
      and (${scope !== "teams"}::boolean or j.user_id = ${me} or j.team_id = any(${teams}::uuid[]))
      and j.ts >= ${since} and not j.is_error and j.target is not null
      and ((j.method = 'api' and j.tool = any(${Object.keys(SCREEN_GESTURES)})) or (j.method = 'tools/call' and j.tool = any(${tools})))
    order by j.id desc
    limit ${JOURNAL_ROWS_SCANNED + 1}`)
  const rows = read.map(({ row }) => row)
  return { rows: rows.slice(0, JOURNAL_ROWS_SCANNED), truncated: rows.length > JOURNAL_ROWS_SCANNED }
}

/** La nature des nœuds à la corbeille aux chemins donnés, que la personne lisait (décision `trashed`) : « a mis à la corbeille la page … ». */
async function trashedKinds(db: PlatformDb, identity: Identity, paths: readonly string[]): Promise<Map<string, NodeKind>> {
  if (paths.length === 0) return new Map()
  const rows = await inTransaction(db, "activities: trashed", (sql) => sql<{ id: string; path: string; kind: string }[]>`
    select distinct on (path) id, path, kind from platform.nodes
     where org_id = ${identity.org.id} and path = any(${paths}) and deleted_at is not null
     order by path, deleted_at desc`)
  const decisions = await nodeDecisions(db, identity, rows.map((row) => row.id), { trashed: true })
  const kinds = new Map<string, NodeKind>()
  for (const row of rows) {
    const kind = nodeKind(row.kind)
    if (kind && (decisions.get(row.id)?.level ?? ACCESS_LEVELS.none) >= ACCESS_LEVELS.read) kinds.set(row.path, kind)
  }
  return kinds
}

/** Chaque chemin relu en un lot (AC-17) : le nœud lisible au chemin ou à l'ancien chemin (`resolveTargets`), sinon la nature d'un nœud à la corbeille. */
async function resolvePaths(db: PlatformDb, identity: Identity, gestures: readonly Gesture[]): Promise<Map<string, Resolution>> {
  const paths = [...new Set(gestures.map((gesture) => gesture.path))].filter((path) => NODE_PATH_PATTERN.test(path))
  const resolved = await resolveTargets(db, identity, paths.map((path) => ({ path, key: null })))
  const resolutions = new Map<string, Resolution>()
  for (const target of resolved) if (target.node) resolutions.set(target.path, { node: target.node })
  const trashed = await trashedKinds(db, identity, paths.filter((path) => !resolutions.has(path)))
  for (const [path, trashedKind] of trashed) resolutions.set(path, { trashedKind })
  return resolutions
}

/**
 * Les activités de la période (AC-12 à AC-17) : lignes de la portée (H74) décidée avant la requête, gestes
 * classés pour le lecteur (D44), chemins relus en un lot, noms par `member_directory`, puis regroupés ;
 * `ACTIVITIES_MAX` au plus, la plus récente d'abord.
 */
export async function listActivities(db: PlatformDb, identity: Identity, options: { periodDays: number; scope?: HomeScope }): Promise<ActivityPage> {
  // Le journal, les chemins relus, les niveaux et l'annuaire dans une transaction (`supabase-patterns.md § Couplage à Supabase (ADR-012)`).
  return inTransaction(db, "activities", async () => {
    const scan = await scanRows(db, identity, new Date(Date.now() - options.periodDays * DAY_MS), options.scope ?? "org")
    const reader = journalReader(identity)
    const gestures = scan.rows.flatMap((row) => classifyRow(row, reader, identity.org.prefix) ?? [])
    if (gestures.length === 0) return { activities: [], truncated: scan.truncated }
    const [resolutions, directory] = await Promise.all([resolvePaths(db, identity, gestures), memberDirectory(db, identity.org.id)])
    const names = new Map(directory.map((person) => [person.userId, person.name]))
    return { activities: groupGestures(gestures, resolutions, names, ACTIVITIES_MAX), truncated: scan.truncated }
  })
}
