// Aides des tests des nœuds sur base réelle (E01-S10, lot t1-b), sorties de `tests/helpers/sql.ts` à la
// deuxième fusion des lots de t1 : son `spyDb` porte le nom de ceux des lots t1-e1 (`tests/helpers/sql.ts`)
// et t1-c1b (`tests/helpers/spy-tables.ts`) pour un troisième contrat (`calls` et `SpiedCall`, crochet
// `hook`), qu'un même module ne peut tenir ; ses aides le suivent (un espion
// par module). La tâche M29 réunit les espions des lots de t1 en un seul, dans `tests/helpers/sql.ts`.
// Les suites sont portables : `sqlConfigured` et `portable` (`tests/helpers/sql.ts`).
//
// Ce que la base simulée donnait aux tests de service, relevé sur le vrai client d'une personne (`ref.db`) :
// `spyDb` garde chaque instruction d'un appel (l'espion des refus sans requête, AC-x3), et laisse le test agir
// juste avant l'une d'elles (une écriture concurrente de la connexion d'administration, ou le refus que la
// base rendrait, sans envoyer l'instruction) ; `replaceContent` donne à chaque test le contenu de ses tables
// simulées, sur la graine de son fichier (`testing-strategy.md § Budget de tests`). Sa face PostgREST est
// partie avec celle du client (E01-S10 f2).
import type { PlatformDb } from "../../packages/plateforme/server/db"
import type { Tx } from "../../packages/plateforme/server/sql"
import type { Tables } from "./simulated-db"
import type { TestSql } from "./sql"

/** Une instruction d'un appel, dans une transaction de `db.tx` : son texte (`$` pour chaque valeur liée) et ses valeurs. */
export type SpiedCall = { kind: "sql"; text: string; values: unknown[] }

/** Le refus qu'un test fait rendre à une requête, à la place de la base. */
export type SpiedError = { code: string; message?: string }

/** Appelé juste avant l'envoi de chaque instruction : ce qui change la base entre-temps, ou le refus rendu. */
export type SpyHook = (call: SpiedCall) => Promise<SpiedError | null | void> | SpiedError | null | void

type Spy = { calls: SpiedCall[]; hook?: SpyHook }

/** Les fonctions de `platform` qui écrivent, que les services appellent. */
const WRITE_FUNCTIONS = ["open_draft", "publish_node", "accept_invitations", "update_my_profile", "create_org", "forget_user"]

/**
 * Une écriture de la face SQL ailleurs qu'en tête de l'instruction : dans un `with`
 * (`with moved as (update platform.blocks …) select …`), le verbe suivi de sa table ; `for update` et une
 * colonne `updated_by` n'en sont pas.
 */
const SQL_WRITE_ANYWHERE = /\b(insert\s+into|update|delete\s+from)\s+platform\./i

/** Une écriture partie vers la base : ce qu'un refus décidé par le service n'envoie jamais (AC-x3). */
export function isWrite(call: SpiedCall): boolean {
  return /^\s*(insert|update|delete)\b/i.test(call.text) || SQL_WRITE_ANYWHERE.test(call.text) || WRITE_FUNCTIONS.some((name) => call.text.includes(`${name}(`))
}

/** Les appels d'une fonction de `platform` (`publish_node`, `open_draft`…). */
export function functionCalls(calls: readonly SpiedCall[], name: string): SpiedCall[] {
  return calls.filter((call) => call.text.includes(`${name}(`))
}

/** Une instruction qui lit ou écrit `table`. */
export function touches(call: SpiedCall, table: string): boolean {
  return new RegExp(`\\bplatform\\.${table}\\b`).test(call.text)
}

/**
 * Les lectures du brouillon d'un nœud : `node_drafts`, ou les blocs de l'état `draft` (valeur liée ou écrite
 * dans l'instruction) ; ce qu'un lecteur sans l'écriture ne fait jamais partir (E03-S03, AC12, AC35).
 */
export function draftReads(calls: readonly SpiedCall[]): SpiedCall[] {
  return calls.filter((call) => {
    return touches(call, "node_drafts") || (touches(call, "blocks") && (call.values.includes("draft") || call.text.includes("'draft'")))
  })
}

/**
 * Un horodatage lu en base, quelle que soit sa forme (`+00:00` de PostgREST, `Z`, microsecondes) : le même
 * instant que `at` (`CONTENT_AT`, `ALIASED_AT`), dans un `toEqual` ou un `toMatchObject`.
 */
export function sameInstant(at: string) {
  const text = `sameInstant(${at})`
  return {
    asymmetricMatch: (value: unknown) => typeof value === "string" && Date.parse(value) === Date.parse(at),
    toString: () => text,
    toAsymmetricMatcher: () => text,
  }
}

/** Un lien écrit par une publication, dans la forme de `p_links` : son bloc, son chemin, sa clé s'il en a une. */
export type WrittenLink = { block_id: string; path: string; key?: string }

/** Les liens qu'une publication a écrits pour un nœud (`publish_node`), relus par la connexion d'administration. */
export async function writtenLinks(admin: TestSql, nodeId: string): Promise<WrittenLink[]> {
  const rows = await admin<{ block_id: string; path: string; key: string | null }[]>`
    select source_block_id as block_id, target_path as path, target_key as key from platform.links where source_node_id = ${nodeId}`
  return rows.map(({ key, ...link }) => (key === null ? link : { ...link, key }))
}

/** Des liens rangés d'une seule façon : ceux d'une publication se comparent sans l'ordre de leurs lignes, qui n'en ont pas. */
export function linkSet<T>(links: readonly T[]): T[] {
  return [...links].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
}

/**
 * Les lignes du contenu d'une organisation, relues par la connexion d'administration (nœuds, blocs,
 * brouillons, versions, anciens chemins, liens, règles) : la « ligne relue identique » d'un refus (AC-x3).
 */
export async function contentRows(admin: TestSql, orgId: string): Promise<Record<string, unknown[]>> {
  type Rows = { row: unknown }[]
  const nodes = await admin<Rows>`select to_jsonb(n) as row from platform.nodes n where n.org_id = ${orgId} order by n.id`
  const blocks = await admin<Rows>`select to_jsonb(b) as row from platform.blocks b where b.org_id = ${orgId} order by b.id, b.state`
  const drafts = await admin<Rows>`select to_jsonb(d) as row from platform.node_drafts d join platform.nodes n on n.id = d.node_id where n.org_id = ${orgId} order by d.node_id`
  const versions = await admin<Rows>`select to_jsonb(v) as row from platform.node_versions v join platform.nodes n on n.id = v.node_id where n.org_id = ${orgId} order by v.node_id, v.revision`
  const aliases = await admin<Rows>`select to_jsonb(a) as row from platform.node_aliases a where a.org_id = ${orgId} order by a.old_path`
  const links = await admin<Rows>`select to_jsonb(l) as row from platform.links l where l.org_id = ${orgId} order by l.id`
  const rules = await admin<Rows>`select to_jsonb(r) as row from platform.access_rules r where r.org_id = ${orgId} order by r.id`
  const rowsOf = (result: Rows) => result.map(({ row }) => row)
  return { nodes: rowsOf(nodes), blocks: rowsOf(blocks), node_drafts: rowsOf(drafts), node_versions: rowsOf(versions), node_aliases: rowsOf(aliases), links: rowsOf(links), access_rules: rowsOf(rules) }
}

/** Une requête de postgres.js 3.4.9 : paresseuse, elle part par `handle` (son premier `then`, `catch`, `execute`…) ; `reject` la rejette sans l'envoyer. */
type PendingQuery = { handle(): Promise<void>; reject(error: unknown): void }

function isPending(value: unknown): value is PendingQuery {
  return typeof value === "object" && value !== null && typeof Reflect.get(value, "handle") === "function" && typeof Reflect.get(value, "reject") === "function"
}

/**
 * Le crochet d'une instruction de la face SQL, joué une fois, juste avant son envoi (partie b2) : l'écriture
 * concurrente attendue, ou le refus rendu à sa place (une erreur au code de la base), l'instruction non
 * envoyée. Un fragment, qui ne part jamais seul, n'y passe pas. Même geste que `gate` de l'espion de t1-e1
 * (`tests/helpers/sql.ts`), pour le contrat de celui-ci (M29 : un seul espion).
 */
function hookedQuery(query: unknown, call: SpiedCall, hook: SpyHook): void {
  if (!isPending(query)) throw new Error("spyDb: a postgres.js query without handle and reject (postgres.js changed)")
  const send = query.handle.bind(query)
  let gated: Promise<void> | undefined
  query.handle = () =>
    (gated ??= Promise.resolve(hook(call)).then(
      (refused) => (refused ? query.reject(Object.assign(new Error(`refused by the test (${refused.code})`), refused)) : send()),
      (error: unknown) => query.reject(error),
    ))
}

/**
 * Le gabarit `sql` d'une transaction : chaque instruction relevée (texte et valeurs liées) à sa construction,
 * puis envoyée telle quelle, après le crochet quand le test en pose un.
 */
function spiedSql(sql: Tx, spy: Spy): Tx {
  return new Proxy(sql, {
    apply(target, _this, args: unknown[]) {
      const [strings, ...values] = args
      const call: SpiedCall | null = Array.isArray(strings) && "raw" in strings ? { kind: "sql", text: strings.join("$"), values } : null
      if (call) spy.calls.push(call)
      const query: unknown = Reflect.apply(target, undefined, args)
      if (call && spy.hook) hookedQuery(query, call, spy.hook)
      return query
    },
  })
}

/**
 * Le client `db` sous espion : `calls` garde chaque instruction de `db.tx`, dans l'ordre où elle part.
 * `hook` est appelé juste avant chacune, comme `fail` et `meanwhile` de la base simulée : il écrit par la
 * connexion d'administration ce qu'une autre personne change entre-temps, ou rend le refus de la base, et
 * l'instruction ne part pas.
 */
export function spyDb(db: PlatformDb, hook?: SpyHook): { db: PlatformDb; calls: SpiedCall[] } {
  const spy: Spy = { calls: [], hook }
  return { db: { tx: (fn, session) => db.tx((sql) => fn(spiedSql(sql, spy)), session) }, calls: spy.calls }
}

/** Les tables du contenu d'une organisation : ce qu'un test de service pose, et que le suivant remplace. */
const CONTENT_TABLES = ["nodes", "access_rules", "blocks", "node_drafts", "node_versions", "node_aliases", "links", "connector_activations", "ctx"] as const

/**
 * Le contenu des deux organisations d'une graine (`ref.org`, `ref.other`) remplacé par celui de `tables`,
 * les tables simulées d'un test (`contentTables` et ce qu'il y ajoute) : nœuds et ce qui en dépend, règles,
 * activations et codes `ctx` supprimés par la connexion d'administration, puis `CONTENT_TABLES` de
 * `tables` écrites par la fixture (`ref.write`, identifiants tirés de nouveau). Les personnes, les
 * équipes, les comptes et leurs sessions restent ceux de la graine du fichier.
 */
export async function replaceContent(
  seed: { admin: TestSql },
  ref: { org: { id: string }; other: { id: string }; write(tables: Tables): Promise<void> },
  tables: Tables,
): Promise<void> {
  const orgs = [ref.org.id, ref.other.id]
  await seed.admin.begin(async (sql) => {
    // Les blocs, brouillons, versions, anciens chemins, liens sortants et règles d'un nœud partent avec lui.
    await sql`delete from platform.nodes where org_id in ${sql(orgs)}`
    await sql`delete from platform.access_rules where org_id in ${sql(orgs)}`
    await sql`delete from platform.connector_activations where org_id in ${sql(orgs)}`
    await sql`delete from platform.ctx where org_id in ${sql(orgs)}`
  })
  await ref.write(Object.fromEntries(CONTENT_TABLES.map((table) => [table, tables[table] ?? []])))
}
