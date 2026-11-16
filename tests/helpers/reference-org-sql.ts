// L'organisation O des AC d'E01-S04 et d'E01-S07 (`reference-org.ts`) et P, l'autre organisation de
// Léa, sur une vraie base (E01-S10, lot t1-0) : les lignes que fabrique la base simulée
// (`contentTables`), écrites telles quelles par la connexion d'administration des tests
// (`seedWithAdmin`, `tests/helpers/sql.ts`), jetables (organisations `t<hex>`, adresses
// `test-<hex>@example.invalid`, nettoyées par `seed.cleanup()`) et portables : la graine n'emploie ni
// Supabase Auth ni PostgREST, le job `bare-postgres` la joue. Chaque identifiant de la base simulée
// (`user-ada`, `team-ventes`, `node:ventes/devis`…), chaque email et chaque adresse y reçoit sa valeur
// réelle : `real` et `readable` traduisent dans les deux sens, `db` rend le client d'une personne
// (`personDb`, `asCaller`). Aussi le moteur des trois autres fixtures sur base réelle (`writeTables`,
// `simulatedIds`) : ce que contient une table de la base simulée s'écrit sans être recopié.
//
// Ce que le schéma refuse et que la base simulée permet, et cela seulement, change (`writeTables`) : le
// parent d'un nœud est celui de son chemin (`nodes_guard`) ; une colonne que la base simulée ne donne
// pas prend la valeur de `contentTables` (nœud publié en révision 1, titre = chemin) ou le défaut de la
// base ; l'identifiant d'une ligne est tiré au hasard, jamais celui de la base simulée, comme toute clé
// que le projet tient pour unique (`DRAWN` : code de session, brouillon simulé, adresse), deux passages
// pouvant tourner en même temps sur le projet partagé ; l'organisation garde le slug, le préfixe,
// l'adresse et la date de création jetables de `seed.createOrg()` (une date ancienne la livrerait à
// `pnpm test:cleanup`).
import { randomUUID } from "crypto"
import type postgres from "postgres"
import type { PlatformDb } from "../../packages/plateforme/server/db"
import type { Identity, IdentityTeam } from "../../packages/plateforme/server/identity"
import { ctxCode, hex } from "./plateforme"
import {
  addBlocks as addSimulatedBlocks,
  CONTENT_AT,
  contentTables,
  identityOf as simulatedIdentityOf,
  nodeId as simulatedNodeId,
  openDraftRow,
  ORG,
  OTHER_ORG,
  PEOPLE,
  referenceTables,
  teamOf as simulatedTeamOf,
  type ContentNode,
  type Person,
  type RuleSpec,
  type SeedBlock,
  TEAMS,
} from "./reference-org"
import type { Row, Tables } from "./simulated-db"
import { asCaller, type SeededData, type SeededOrg, type SeededPerson, type TestSql } from "./sql"

/** Les clés d'un `Record<K, …>`, typées K. */
export function keysOf<K extends string>(record: Record<K, unknown>): K[] {
  // `Object.keys` rend des `string` : celles d'un `Record<K, …>` sont les K.
  return Object.keys(record) as K[]
}

/** `record` dont chaque valeur passe par `fn`, mêmes clés. */
export function mapRecord<K extends string, V, W>(record: Record<K, V>, fn: (value: V, key: K) => W): Record<K, W> {
  // `Object.fromEntries` rend un `Record<string, W>` : ses clés sont celles de `record`.
  return Object.fromEntries(keysOf(record).map((key) => [key, fn(record[key], key)])) as Record<K, W>
}

/** Les identifiants, emails et adresses de la base simulée et leur valeur sur la base réelle, dans les deux sens. */
export type SimulatedIds = {
  set(simulated: string, real: string): void
  has(simulated: string): boolean
  /** La valeur réelle d'un identifiant simulé semé ; lève s'il ne l'est pas. */
  id(simulated: string): string
  /** `value` où chaque valeur simulée connue devient sa valeur réelle (dates en ISO). */
  real<T>(value: T): T
  /** L'inverse : chaque valeur réelle connue redevient sa valeur simulée, pour comparer à ce qu'un test attend en simulé. */
  readable<T>(value: T): T
}

/** `value` où chaque chaîne que `lookup` connaît devient sa valeur, à toute profondeur ; `JSON` : dates en ISO. */
function translate<T>(value: T, lookup: (text: string) => string | undefined): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value), (_key, field: unknown) => (typeof field === "string" ? (lookup(field) ?? field) : field))
}

function unseeded(simulated: string): Error {
  return new Error(`${simulated} is not seeded by this fixture`)
}

export function simulatedIds(): SimulatedIds {
  const toReal = new Map<string, string>()
  const toSimulated = new Map<string, string>()
  return {
    set(simulated, real) {
      toReal.set(simulated, real)
      toSimulated.set(real, simulated)
    },
    has: (simulated) => toReal.has(simulated),
    id(simulated) {
      const real = toReal.get(simulated)
      if (real === undefined) throw unseeded(simulated)
      return real
    },
    real: (value) => translate(value, (text) => toReal.get(text)),
    readable: (value) => translate(value, (text) => toSimulated.get(text)),
  }
}

/**
 * Les identifiants d'une écriture : ceux qu'elle tire restent à part, et ne rejoignent `ids` (`commit`)
 * qu'une fois sa transaction validée ; une écriture refusée par la base n'y laisse rien.
 */
function stagedIds(ids: SimulatedIds) {
  const local = new Map<string, string>()
  const lookup = (text: string) => local.get(text) ?? (ids.has(text) ? ids.id(text) : undefined)
  return {
    /** Tiré par cette écriture : une ligne ne se sème qu'une fois par écriture. */
    drawn: (simulated: string) => local.has(simulated),
    has: (simulated: string) => local.has(simulated) || ids.has(simulated),
    /** Une valeur réelle tirée pour `simulated` : un uuid, ou la clé que tire `DRAWN`. */
    draw: (simulated: string, real: string = randomUUID()) => void local.set(simulated, real),
    id(simulated: string): string {
      const real = lookup(simulated)
      if (real === undefined) throw unseeded(simulated)
      return real
    },
    real: <T>(value: T): T => translate(value, lookup),
    commit: () => local.forEach((real, simulated) => ids.set(simulated, real)),
  }
}

type StagedIds = ReturnType<typeof stagedIds>

/** L'email et le nom des personnes semées, par identifiant réel : les copies de `members` et de `platform_staff` (E01-S09). */
export type Directory = ReadonlyMap<string, { email: string; name: string }>

const REQUIRED = Symbol("required")
/** La valeur d'une colonne que la ligne simulée ne donne pas : fixe, calculée sur la ligne, ou exigée. */
type Fallback = null | string | number | boolean | Record<string, never> | readonly never[] | typeof REQUIRED | ((row: Row) => unknown)

const now = () => new Date()
const inAWeek = () => new Date(Date.now() + 7 * 24 * 3600 * 1000)

/**
 * Les tables écrites, dans l'ordre d'écriture (un parent avant ce qui le vise ; une invitation avant
 * les membres, que `invitations_guard` compare), leurs colonnes et leurs valeurs par défaut. Une table
 * absente d'ici et non vide lève : ce qu'une fixture ne sème pas ne se perd pas en silence.
 */
const WRITTEN = {
  teams: { id: REQUIRED, org_id: REQUIRED, slug: REQUIRED, name: REQUIRED, lead_user_id: null },
  invitations: {
    id: REQUIRED,
    org_id: REQUIRED,
    email: REQUIRED,
    role: "member",
    team_id: null,
    invited_by: null,
    created_at: now,
    expires_at: inAWeek,
    accepted_at: null,
    declined_at: null,
    revoked_at: null,
  },
  members: { org_id: REQUIRED, user_id: REQUIRED, role: "member", default_team_id: null, profile: {}, email: null, name: null, created_at: now },
  team_members: { team_id: REQUIRED, user_id: REQUIRED, role: "member" },
  platform_staff: { user_id: REQUIRED, added_by: null, added_at: now, email: null, name: null },
  platform_grants: { id: REQUIRED, org_id: REQUIRED, user_id: REQUIRED, granted_by: null, granted_at: now, revoked_at: null, revoked_by: null, reason: null },
  // Les valeurs de `contentTables` pour un nœud qu'elle n'a pas complété (`referenceTables`, `acmeTables`).
  nodes: {
    id: REQUIRED,
    org_id: REQUIRED,
    parent_id: null,
    path: REQUIRED,
    kind: "page",
    title: (row: Row) => row.path,
    summary: (row: Row) => `Summary of ${String(row.path)}.`,
    status: "published",
    revision: 1,
    meta: {},
    owner_kind: null,
    owner_team_id: null,
    owner_user_id: null,
    created_by: null,
    updated_by: null,
    created_at: CONTENT_AT,
    updated_at: CONTENT_AT,
  },
  accounts: { id: REQUIRED, org_id: REQUIRED, connector: "mail", label: REQUIRED, owner_kind: REQUIRED, owner_team_id: null, owner_user_id: null, mode: "reel", status: "active" },
  access_rules: { id: REQUIRED, org_id: REQUIRED, node_id: null, account_id: null, subject_team_id: null, subject_user_id: null, subject_org: false, level: REQUIRED },
  blocks: {
    id: REQUIRED,
    state: REQUIRED,
    org_id: REQUIRED,
    node_id: REQUIRED,
    position: null,
    type: REQUIRED,
    text: null,
    data: {},
    key: null,
    provenance: {},
    revision: 1,
    claimed_by: null,
    claimed_by_user: null,
    lease_until: null,
    created_by: null,
    updated_by: null,
    created_at: CONTENT_AT,
    updated_at: CONTENT_AT,
  },
  node_drafts: {
    node_id: REQUIRED,
    base_revision: REQUIRED,
    title: null,
    summary: null,
    kind: null,
    meta: null,
    created_by: null,
    updated_by: null,
    created_at: CONTENT_AT,
    updated_at: CONTENT_AT,
  },
  node_versions: { node_id: REQUIRED, revision: REQUIRED, title: REQUIRED, summary: REQUIRED, kind: "page", meta: {}, blocks: [], author: null, created_at: CONTENT_AT },
  node_aliases: { org_id: REQUIRED, old_path: REQUIRED, node_id: REQUIRED, created_by: null, created_at: now },
  // Les tables que remplissent les tests des lots de t1 (lot t1-0b). Les adresses d'une graine viennent de
  // `seed.createOrg` ; celles-ci s'écrivent après. `id` des tables à identité (`links`, `feedback`,
  // `journal`, `admin_journal`) n'est jamais écrit : la base le tire.
  org_domains: { host: REQUIRED, org_id: REQUIRED, created_at: now },
  connector_activations: { org_id: REQUIRED, connector: REQUIRED, state: "active", activated_by: null, closed_by: null, created_at: now, updated_at: now },
  // `rules_version` : celle d'une organisation neuve (`orgs.rules_version`, défaut 1).
  // `contexts` : aucun Contexte gardé, jamais périmé (E11-S03) ; un test pose les révisions qu'il garde.
  ctx: { code: REQUIRED, org_id: REQUIRED, user_id: REQUIRED, rules_version: 1, contexts: {}, host: null, user_agent: null, created_at: now },
  // `connector` et `function` : ceux du seul écrivain de la table, `mail.create_draft` (connecteur simulé).
  sim_outbox: {
    id: REQUIRED,
    org_id: REQUIRED,
    account_id: REQUIRED,
    connector: "mail",
    function: "mail.create_draft",
    payload: {},
    status: "draft",
    created_by: null,
    created_at: now,
    sent_by: null,
    sent_at: null,
  },
  links: { org_id: REQUIRED, source_node_id: REQUIRED, source_block_id: REQUIRED, target_path: REQUIRED, target_key: null, target_node_id: null },
  feedback: {
    org_id: REQUIRED,
    number: REQUIRED,
    user_id: null,
    ctx: null,
    type: REQUIRED,
    target: null,
    text: REQUIRED,
    state: "open",
    resolution: null,
    handled_by: null,
    handled_at: null,
    created_at: now,
  },
  // `method` : celle d'un appel d'outil, la seule que les portes journalisent.
  journal: {
    ts: now,
    org_id: null,
    user_id: null,
    team_id: null,
    ctx: null,
    method: "tools/call",
    tool: null,
    target: null,
    args: null,
    args_chars: null,
    result_chars: null,
    is_error: false,
    error: null,
    duration_ms: null,
    host: null,
    user_agent: null,
    account_id: null,
  },
  admin_journal: {
    ts: now,
    org_id: null,
    user_id: null,
    ctx: null,
    method: "tools/call",
    tool: null,
    op: null,
    target: null,
    args: null,
    args_chars: null,
    result_chars: null,
    is_error: false,
    error: null,
    duration_ms: null,
    host: null,
    user_agent: null,
  },
} satisfies Record<string, Record<string, Fallback>>

type WrittenTable = keyof typeof WRITTEN

/** Les tables dont chaque ligne reçoit un identifiant tiré au hasard, retenu contre celui de la base simulée. */
const WITH_ID: ReadonlySet<string> = new Set(["teams", "invitations", "platform_grants", "nodes", "accounts", "access_rules", "blocks"])

/**
 * Les clés que le projet partagé tient pour uniques et qu'une ligne simulée porte en clair : tirées au
 * hasard, la même valeur réelle pour une même valeur simulée, dans l'écriture comme après (un code de
 * session est aussi celui des lignes de journal et des retours de la conversation).
 */
const DRAWN: Partial<Record<string, { column: string; draw: () => string }>> = {
  org_domains: { column: "host", draw: () => `t${hex(4)}.example.invalid` },
  ctx: { column: "code", draw: ctxCode },
  sim_outbox: { column: "id", draw: () => `sim_${hex(4)}` },
  feedback: { column: "ctx", draw: ctxCode },
  journal: { column: "ctx", draw: ctxCode },
  admin_journal: { column: "ctx", draw: ctxCode },
}

/**
 * Une organisation est créée par la fixture (`seed.createOrg`) : sa ligne simulée n'en change que les
 * colonnes qu'elle donne, parmi celles-ci (après la graine, `settings` seul d'une organisation).
 */
const ORG_COLUMNS = ["name", "brand", "settings", "flags", "rules_version"] as const

const JSON_COLUMNS: ReadonlySet<string> = new Set(["profile", "meta", "data", "provenance", "blocks", "brand", "settings", "flags", "args", "payload", "contexts"])
const UUID_COLUMN = /^(id|\w+_id|(created|updated|invited|granted|revoked|added|accepted|activated|handled|sent)_by|claimed_by_user|author)$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Lignes par insertion : sous la borne de 65 535 paramètres d'une requête Postgres (18 colonnes au plus). */
const CHUNK = 500

type SqlValue = string | number | boolean | Date | null | postgres.Parameter
/** `leads` : l'équipe et son responsable (`<équipe> <personne>`, identifiants simulés) de chaque équipe de l'écriture, que `teams_lead_sync` inscrit. */
type WriteContext = { ids: StagedIds; directory: Directory; leads: ReadonlySet<string> }

/**
 * Une valeur de colonne de `table` pour le pilote : JSON pour une colonne `jsonb`, un identifiant réel
 * pour une colonne `uuid` (une clé de `DRAWN`, `sim_outbox.id`, n'en est pas un).
 */
function sqlValue(tx: postgres.TransactionSql, table: string, column: string, value: unknown): SqlValue {
  if (value === null || value === undefined) return null
  if (JSON_COLUMNS.has(column)) return tx.json(JSON.parse(JSON.stringify(value)))
  const drawnKey = DRAWN[table]?.column === column
  if (UUID_COLUMN.test(column) && !drawnKey && !(typeof value === "string" && UUID.test(value))) {
    throw new Error(`writeTables: ${column} = ${JSON.stringify(value)} has no real id (not seeded by this fixture)`)
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value instanceof Date) return value
  throw new Error(`writeTables: ${column} holds ${JSON.stringify(value)}, not a column value`)
}

/** Les colonnes de `spec` pour une ligne traduite de `table` : sa valeur, sinon celle par défaut ; une colonne exigée absente lève. */
function valuesOf(tx: postgres.TransactionSql, spec: Record<string, Fallback>, row: Row, table: string): Record<string, SqlValue> {
  return Object.fromEntries(
    Object.entries(spec).map(([column, fallback]) => {
      if (row[column] !== undefined) return [column, sqlValue(tx, table, column, row[column])]
      if (fallback === REQUIRED) throw new Error(`writeTables: ${table}.${column} is required`)
      return [column, sqlValue(tx, table, column, typeof fallback === "function" ? fallback(row) : fallback)]
    }),
  )
}

function chunks<T>(rows: T[]): T[][] {
  const out: T[][] = []
  for (let at = 0; at < rows.length; at += CHUNK) out.push(rows.slice(at, at + CHUNK))
  return out
}

/**
 * L'identifiant réel d'une ligne simulée, tiré au hasard. Un bloc publié et son brouillon partagent le
 * leur (`open_draft` copie sous le même `id`) : un bloc déjà semé le garde. Toute autre ligne en tire
 * un nouveau, même semée avant : une ligne qu'un test a supprimée se sème de nouveau, et une ligne qui
 * est encore là, la base la refuse (clé, contrainte d'unicité), sans rien laisser dans `ids`.
 */
function assignId(table: string, row: Row, ids: StagedIds): void {
  const simulated = row.id
  if (typeof simulated !== "string") throw new Error(`writeTables: a row of ${table} has no id`)
  if (table === "blocks" && ids.has(simulated)) return
  if (ids.drawn(simulated)) throw new Error(`writeTables: ${simulated} twice in one write`)
  ids.draw(simulated)
}

async function updateOrgs(tx: postgres.TransactionSql, rows: Row[], ids: StagedIds): Promise<void> {
  for (const row of rows) {
    const given = ORG_COLUMNS.filter((column) => row[column] !== undefined)
    if (given.length === 0) continue
    const values = Object.fromEntries(given.map((column) => [column, sqlValue(tx, "orgs", column, row[column])]))
    await tx`update platform.orgs set ${tx(values, ...given)} where id = ${ids.id(String(row.id))}`
  }
}

/** Tire la valeur réelle de chaque clé de `DRAWN` que portent les lignes, si l'écriture ou la fixture ne la connaît pas déjà. */
function drawKeys(table: WrittenTable, rows: Row[], ids: StagedIds): void {
  const key = DRAWN[table]
  if (!key) return
  for (const row of rows) {
    const simulated = row[key.column]
    if (typeof simulated === "string" && !ids.has(simulated)) ids.draw(simulated, key.draw())
  }
}

async function insertRows(tx: postgres.TransactionSql, table: WrittenTable, rows: Row[], context: WriteContext): Promise<void> {
  drawKeys(table, rows, context.ids)
  // Le responsable d'une équipe écrite ici y est déjà : `teams_lead_sync` l'inscrit avec son équipe. Toute
  // autre ligne déjà là, la base la refuse (23505), en nommant sa clé.
  const kept = table === "team_members" ? rows.filter((row) => !context.leads.has(`${String(row.team_id)} ${String(row.user_id)}`)) : rows
  const values = kept.map((row) => {
    if (WITH_ID.has(table)) assignId(table, row, context.ids)
    const written = valuesOf(tx, WRITTEN[table], context.ids.real(row), table)
    if (table !== "members" && table !== "platform_staff") return written
    const person = context.directory.get(String(written.user_id))
    return { ...written, email: person?.email ?? written.email, name: person?.name ?? written.name }
  })
  const columns = Object.keys(WRITTEN[table])
  for (const chunk of chunks(values)) await tx`insert into ${tx(`platform.${table}`)} ${tx(chunk, ...columns)}`
}

/** Au-dessus de tout numéro de retour d'une organisation de test : la place d'un numéro pendant qu'il change. */
const PARKED = 1_000_000_000

/**
 * Les retours : `feedback_number` numérote chaque insertion (le plus grand numéro de l'organisation,
 * plus un) ; le numéro de la ligne simulée est remis ensuite, en deux temps, pour qu'aucun numéro en
 * cours n'en croise un autre (une contrainte d'unicité se contrôle ligne à ligne). Un numéro déjà pris
 * dans l'organisation, la base le refuse (23505).
 */
async function insertFeedback(tx: postgres.TransactionSql, rows: Row[], context: WriteContext): Promise<void> {
  drawKeys("feedback", rows, context.ids)
  const values = rows.map((row) => valuesOf(tx, WRITTEN.feedback, context.ids.real(row), "feedback"))
  const columns = Object.keys(WRITTEN.feedback)
  for (const chunk of chunks(values)) {
    // `returning` rend les lignes d'une insertion `values` dans l'ordre où elles sont écrites.
    const inserted = await tx<{ id: string }[]>`insert into platform.feedback ${tx(chunk, ...columns)} returning id`
    const numbers = inserted.map((row, index): [string, number] => [row.id, Number(chunk[index].number)])
    await tx`update platform.feedback as f set number = (t.number)::int + ${PARKED}
             from (values ${tx(numbers)}) as t (id, number) where f.id = (t.id)::bigint`
    await tx`update platform.feedback set number = number - ${PARKED} where id in ${tx(inserted.map((row) => row.id))}`
  }
}

const parentPath = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "guide")
const depthOf = (row: Row) => (row.path === "guide" ? 0 : String(row.path).split("/").length)

/** Les nœuds, par profondeur croissante, chacun sous le nœud de son chemin parent (`guide` : la racine), déjà semé ou semé avant lui. */
async function insertNodes(tx: postgres.TransactionSql, rows: Row[], context: WriteContext): Promise<void> {
  const orgIds = [...new Set(rows.map((row) => context.ids.id(String(row.org_id))))]
  const known = new Map<string, string>()
  const seeded = await tx<{ id: string; org_id: string; path: string }[]>`select id, org_id, path from platform.nodes where org_id in ${tx(orgIds)}`
  for (const node of seeded) known.set(`${node.org_id}:${node.path}`, node.id)
  const columns = Object.keys(WRITTEN.nodes)
  for (const depth of [...new Set(rows.map(depthOf))].sort((a, b) => a - b)) {
    const values = rows
      .filter((row) => depthOf(row) === depth)
      .map((row) => {
        assignId("nodes", row, context.ids)
        const node = context.ids.real(row)
        const path = String(node.path)
        const parent = path === "guide" ? null : known.get(`${String(node.org_id)}:${parentPath(path)}`)
        if (parent === undefined) throw new Error(`writeTables: the parent ${parentPath(path)} of ${path} is not seeded`)
        known.set(`${String(node.org_id)}:${path}`, String(node.id))
        return valuesOf(tx, WRITTEN.nodes, { ...node, parent_id: parent }, "nodes")
      })
    for (const chunk of chunks(values)) await tx`insert into platform.nodes ${tx(chunk, ...columns)}`
  }
}

/**
 * Écrit sur la base, dans une transaction, les lignes d'une base simulée dont les organisations et les
 * personnes sont déjà dans `ids` (organisations créées par `seed.createOrg`, personnes par
 * `seed.person`) ; une fois la transaction validée, chaque ligne écrite y ajoute son identifiant. Les
 * déclencheurs de la base jouent : une équipe écrite après la racine fait naître son dossier et son
 * Contexte, un membre écrit après `private` son espace (P39) — les fixtures écrivent donc équipes et
 * membres avant l'arbre.
 */
export async function writeTables(sql: TestSql, tables: Tables, ids: SimulatedIds, directory: Directory): Promise<void> {
  const ignored = Object.entries(tables).filter(([name, rows]) => rows.length > 0 && name !== "orgs" && !(name in WRITTEN))
  if (ignored.length > 0) throw new Error(`writeTables: ${ignored.map(([name]) => name).join(", ")} not written: not a table of platform that WRITTEN lists`)
  const leads = new Set((tables.teams ?? []).filter((team) => team.lead_user_id).map((team) => `${String(team.id)} ${String(team.lead_user_id)}`))
  const context: WriteContext = { ids: stagedIds(ids), directory, leads }
  await sql.begin(async (tx) => {
    await updateOrgs(tx, tables.orgs ?? [], context.ids)
    for (const table of keysOf(WRITTEN)) {
      const rows = tables[table] ?? []
      if (rows.length === 0) continue
      if (table === "nodes") await insertNodes(tx, rows, context)
      else if (table === "feedback") await insertFeedback(tx, rows, context)
      else await insertRows(tx, table, rows, context)
    }
  })
  context.ids.commit()
}

/** Une personne semée : son identifiant réel, son adresse jetable, son nom. */
export type SeededNamed = SeededPerson & { name: string }

/**
 * Le client du paquet sous une personne semée (`asCaller`), sur le projet comme sur Postgres nu : son
 * identifiant, son email et son nom, comme l'hôte les tire de la session (`callerOf`,
 * `src/lib/plateforme/session.ts`). Le mode de transition du lot t1-0b (compte Supabase Auth et session
 * de la personne, pour la face PostgREST) est tombé avec cette face (E01-S10 f2).
 */
export function personDb(person: SeededNamed): Promise<PlatformDb> {
  return Promise.resolve(asCaller(person.id, person.email, person.name))
}

type TeamKey = keyof typeof TEAMS

/** O et P sur la base réelle, et ce qu'il faut pour appeler un service sous l'une de leurs personnes. */
export type ReferenceOrgSql = {
  /** O : « Acme Test », slug, préfixe et adresse jetables. */
  org: SeededOrg
  /** P : « Other Test », l'autre organisation de Léa. */
  other: SeededOrg
  people: Record<Person, SeededNamed>
  /** L'identifiant réel d'un identifiant simulé semé (`TEAMS.ventes.id`, `ACCOUNTS.org.id`, `OTHER_ORG.root`…) ; lève sinon. */
  id(simulated: string): string
  /** L'identifiant réel du nœud de O à ce chemin ; lève s'il n'est pas semé. */
  nodeId(path: string): string
  real<T>(value: T): T
  readable<T>(value: T): T
  /** L'identité que `identityOf` de la base simulée rend, en identifiants réels, l'organisation O réelle. */
  identityOf(person: Person, overrides?: Partial<Identity>): Identity
  teamOf(key: TeamKey, person: Person): IdentityTeam
  /** Le client du paquet sous cette personne (`personDb`, `asCaller`). */
  db(person: Person): Promise<PlatformDb>
  /**
   * Écrit des lignes simulées de plus (`aliasRow`, `addVersion`, `rowBlocks`…), de toute table de
   * `platform` (`WRITTEN`) : `writeTables`. Une ligne qu'un test a supprimée se sème de nouveau ; une ligne
   * encore là, la base la refuse (23505), et rien ne change. Un code de session, un brouillon simulé ou
   * une adresse reçoit une valeur tirée au hasard (`DRAWN`), que rend `id`.
   */
  write(tables: Tables): Promise<void>
  /** Des règles de plus (`RuleSpec`, comme `referenceTables(rules)`) ; rend leurs identifiants réels. */
  addRules(rules: RuleSpec[]): Promise<string[]>
  /** Des nœuds de plus dans O, complétés comme `contentTables` ; un chemin déjà pris, la base le refuse (23505). */
  addNodes(nodes: ContentNode[]): Promise<void>
  /** Comme `addBlocks` de la base simulée ; rend les identifiants réels, dans l'ordre. */
  addBlocks(path: string, state: "published" | "draft", blocks: SeedBlock[]): Promise<string[]>
  /** Comme `openDraftRow` : le brouillon ouvert du nœud, sur sa révision en base, avec son en-tête en attente. */
  openDraft(path: string, header?: { title?: string; summary?: string; kind?: string }): Promise<void>
}

type Base = { org: SeededOrg; other: SeededOrg; people: Record<Person, SeededNamed>; ids: SimulatedIds; directory: Directory }

function referenceHandle(seed: SeededData, base: Base): ReferenceOrgSql {
  const { ids, people, org } = base
  const write = (tables: Tables) => writeTables(seed.admin, tables, ids, base.directory)
  const orgIdentity: Identity["org"] = { id: org.id, slug: org.slug, name: org.name, prefix: org.prefix, brand: {}, domains: null }
  return {
    org,
    other: base.other,
    people,
    id: ids.id,
    nodeId: (path) => ids.id(simulatedNodeId(path)),
    real: ids.real,
    readable: ids.readable,
    identityOf: (person, overrides = {}) => ({ ...ids.real(simulatedIdentityOf(person, overrides)), ...(overrides.org ? {} : { org: orgIdentity }) }),
    teamOf: (key, person) => ids.real(simulatedTeamOf(key, person)),
    db: (person) => personDb(people[person]),
    write,
    async addRules(rules) {
      // Les règles de P suivent celles de `rules` dans `referenceTables` ; elles sont déjà semées.
      const rows = referenceTables(rules).access_rules.filter((row) => row.org_id === ORG.id)
      await write({ access_rules: rows })
      return rows.map((row) => ids.id(String(row.id)))
    },
    async addNodes(nodes) {
      const paths = new Set(nodes.map((node) => node.path))
      await write({ nodes: contentTables([], nodes).nodes.filter((row) => row.org_id === ORG.id && paths.has(String(row.path))) })
    },
    async addBlocks(path, state, blocks) {
      const scratch: Tables = { blocks: [] }
      const created = addSimulatedBlocks(scratch, path, state, blocks)
      await write(scratch)
      return created.map(ids.id)
    },
    async openDraft(path, header = {}) {
      const [node] = await seed.admin<{ revision: number }[]>`select revision from platform.nodes where id = ${ids.id(simulatedNodeId(path))}`
      const scratch: Tables = { nodes: [{ id: simulatedNodeId(path), revision: node.revision }], node_drafts: [] }
      openDraftRow(scratch, path, header)
      await write({ node_drafts: scratch.node_drafts })
    },
  }
}

/**
 * O et P, avec les lignes de `tables` : celles d'une base simulée de O (`contentTables`,
 * `fixtureTables`, `acmeTables`), écrites telles quelles. `extra` : des identifiants simulés de plus,
 * hors des personnes et des organisations (un membre parti, sans ligne), et leur valeur réelle.
 */
export async function seedReferenceTables(seed: SeededData, tables: Tables, extra: Record<string, string> = {}): Promise<ReferenceOrgSql> {
  const ids = simulatedIds()
  const orgName = (id: string) => String(tables.orgs?.find((row) => row.id === id)?.name)
  const org = { ...(await seed.createOrg()), name: orgName(ORG.id) }
  const other = { ...(await seed.createOrg()), name: orgName(OTHER_ORG.id) }
  ids.set(ORG.id, org.id)
  ids.set(ORG.host, org.host)
  ids.set(OTHER_ORG.id, other.id)
  ids.set(OTHER_ORG.host, other.host)
  const people = mapRecord(PEOPLE, (data): SeededNamed => ({ ...seed.person(), name: data.name }))
  for (const person of keysOf(people)) {
    ids.set(PEOPLE[person].id, people[person].id)
    ids.set(PEOPLE[person].email, people[person].email)
  }
  for (const [simulated, real] of Object.entries(extra)) ids.set(simulated, real)
  const directory: Directory = new Map(Object.values(people).map((person) => [person.id, { email: person.email, name: person.name }]))
  await writeTables(seed.admin, tables, ids, directory)
  return referenceHandle(seed, { org, other, people, ids, directory })
}

/**
 * O et P comme `contentTables(rules, nodes)` les pose dans la base simulée : personnes, équipes,
 * membres, équipe plateforme et accès, nœuds publiés en révision 1 (`nodes` y précisent un nœud ou en
 * ajoutent un), comptes, règles, invitation de P. Ce que rend la fonction : `ReferenceOrgSql`.
 */
export function seedReferenceOrg(seed: SeededData, options: { rules?: RuleSpec[]; nodes?: ContentNode[] } = {}): Promise<ReferenceOrgSql> {
  return seedReferenceTables(seed, contentTables(options.rules, options.nodes))
}
