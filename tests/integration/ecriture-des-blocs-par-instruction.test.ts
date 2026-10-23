// @vitest-environment node
// L'écriture des blocs jugée une fois par nœud et par instruction (migration `20261021180000` ; suite de
// `role-dans-les-blocs.test.ts`, dont les cas ne changent pas) : le déclencheur de fin d'instruction
// `blocks_write_guard` exige l'écriture (2) de chaque nœud des lignes écrites, un appel par nœud. Sous la session
// d'une personne comme sous celle du serveur, en SQL direct : une page de 1 000 blocs s'écrit en une instruction sous
// le délai d'une session ; une instruction qui écrit les blocs d'un nœud qu'on écrit et d'un nœud qu'on ne fait que
// lire est refusée en entière (42501), rien n'est écrit ; une modification ou une suppression sans filtre, que la
// lecture ne borne pas, est refusée de même dès qu'elle touche un brouillon qu'on n'écrit pas. La donnée est relue par
// la connexion d'administration.
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { pendingMigrations, pendingReason } from "../helpers/pending-migrations"
import { asCaller, failureOf, seedWithAdmin, SQL_SKIP_REASON, sqlConfigured, type SeededData, type SeededOrg, type SeededPerson } from "../helpers/sql"
import type { Tx } from "../../packages/plateforme/server/sql"

const VERSION = "20261023120000" // 20261023120000_v1_6_0.sql, partie écrite en 20261021180000
const pending = (await pendingMigrations()).includes(VERSION)

const suite = !sqlConfigured
  ? `the writes of the blocks judged once per node and per statement (${SQL_SKIP_REASON})`
  : pending
    ? `the writes of the blocks judged once per node and per statement (${pendingReason([VERSION])})`
    : "the writes of the blocks judged once per node and per statement: 1 000 blocks in one statement, a statement over a node not written refused whole"

/** Les deux sessions d'une personne : la sienne, et celle du serveur, aux mêmes claims. */
const SESSIONS = [undefined, "server"] as const

const tag = () => Math.random().toString(16).slice(2, 8)

type Node = { id: string; path: string }

describe.skipIf(!sqlConfigured || pending)(suite, () => {
  let seed: SeededData
  let org: SeededOrg
  /** Administratrice de O. */
  let ada: SeededPerson
  /** Membre simple de O : il lit les nœuds de l'organisation, écrit ceux où une règle le nomme. */
  let marc: SeededPerson
  let root: Node

  /** Le nombre de lignes rendues par une écriture de Marc, `42501` pour un refus de la sécurité par ligne, ou le code et le message de toute autre erreur. */
  async function attempt(query: (sql: Tx) => PromiseLike<readonly unknown[]>, session?: "server"): Promise<number | string> {
    let rows = 0
    const failure = await failureOf(asCaller(marc.id, marc.email).tx(async (sql) => (rows = (await query(sql)).length), session))
    if (!failure) return rows
    if (failure.code === "42501" && /row-level security/.test(failure.message)) return failure.code
    return `${failure.code} ${failure.message}`
  }

  /** Un nœud publié de l'organisation sous la racine ; Marc l'écrit avec `writes`, sinon il le lit. */
  async function node(kind: "page" | "table", writes: boolean): Promise<Node> {
    const [row] = await seed.admin<Node[]>`
      insert into platform.nodes (org_id, parent_id, path, kind, title, summary, status, revision, created_by)
      values (${org.id}, ${root.id}, ${`p${tag()}`}, ${kind}, 'Page', 'Une page.', 'published', 1, ${ada.id})
      returning id, path`
    if (writes) {
      await seed.admin`
        insert into platform.access_rules (org_id, node_id, subject_user_id, level, created_by) values (${org.id}, ${row.id}, ${marc.id}, 'write', ${ada.id})`
    }
    if (kind === "page") await seed.admin`insert into platform.node_drafts (node_id, base_revision, created_by) values (${row.id}, 1, ${ada.id})`
    return row
  }

  /** Un bloc du brouillon d'une page, ou une ligne d'un tableau, posé par la connexion d'administration. */
  async function seeded(target: Node, kind: "page" | "table"): Promise<void> {
    await (kind === "page"
      ? seed.admin`insert into platform.blocks (org_id, node_id, state, type, text, position, created_by) values (${org.id}, ${target.id}, 'draft', 'paragraph', 'Avant.', 1, ${ada.id})`
      : seed.admin`insert into platform.blocks (org_id, node_id, state, type, key, data, created_by) values (${org.id}, ${target.id}, 'published', 'row', ${`k${tag()}`}, '{"ville":"Valbrune"}'::jsonb, ${ada.id})`)
  }

  /** Les blocs d'un nœud relus par la connexion d'administration : leur texte, ou la ville d'une ligne. */
  const blocksOf = async (target: Node) =>
    (await seed.admin<{ value: string }[]>`select coalesce(text, data ->> 'ville') as value from platform.blocks where node_id = ${target.id} order by position, value`).map((row) => row.value)

  beforeAll(async () => {
    seed = seedWithAdmin()
    org = await seed.createOrg()
    ;[ada, marc] = [seed.person(), seed.person()]
    await seed.addMember(org.id, ada, "admin")
    await seed.addMember(org.id, marc)
    const [row] = await seed.admin<Node[]>`
      insert into platform.nodes (org_id, parent_id, path, title, summary, owner_kind)
      values (${org.id}, null, 'guide', 'Guide', 'Racine.', 'org') returning id, path`
    root = row
  })

  afterAll(async () => {
    await seed?.cleanup()
  })

  it.each(SESSIONS)("should write the 1,000 blocks of a page in one statement, as insertBlocks does (session %s)", async (session) => {
    const page = await node("page", true)
    const insertMany = (sql: Tx) =>
      sql`insert into platform.blocks (node_id, org_id, state, type, text, data, provenance, position, created_by, updated_by)
          select ${page.id}::uuid, ${org.id}::uuid, 'draft', 'paragraph', 'Bloc ' || g || '.', '{}'::jsonb, '{}'::jsonb, g * 1024, ${marc.id}::uuid, ${marc.id}::uuid
            from generate_series(1, 1000) g
          returning id`
    expect(await attempt(insertMany, session)).toBe(1000)
    expect(await blocksOf(page)).toHaveLength(1000)
  })

  it.each(SESSIONS)("should refuse whole a statement that writes the blocks of a node it writes and of a node it only reads (session %s)", async (session) => {
    const [written, read] = [await node("page", true), await node("page", false)]
    const [writtenTable, readTable] = [await node("table", true), await node("table", false)]
    // Sans `returning` : la lecture ne juge pas les lignes ajoutées, seul le déclencheur les juge.
    const draftBlocks = (sql: Tx) =>
      sql`insert into platform.blocks (node_id, state, type, text, position, created_by, updated_by)
          values (${written.id}, 'draft', 'paragraph', 'Ajouté.', 2, ${marc.id}, ${marc.id}), (${read.id}, 'draft', 'paragraph', 'Ajouté.', 2, ${marc.id}, ${marc.id})`
    const rows = (sql: Tx) =>
      sql`insert into platform.blocks (node_id, state, type, key, data, created_by, updated_by)
          values (${writtenTable.id}, 'published', 'row', ${`n${tag()}`}, '{"ville":"Brémontier"}'::jsonb, ${marc.id}, ${marc.id}),
                 (${readTable.id}, 'published', 'row', ${`n${tag()}`}, '{"ville":"Brémontier"}'::jsonb, ${marc.id}, ${marc.id})`
    expect(await attempt(draftBlocks, session)).toBe("42501")
    expect(await attempt(rows, session)).toBe("42501")
    expect([await blocksOf(written), await blocksOf(read), await blocksOf(writtenTable), await blocksOf(readTable)]).toEqual([[], [], [], []])
  })

  it.each(SESSIONS)("should refuse an update or a delete without filter that reaches a draft it does not write (session %s)", async (session) => {
    const [written, read] = [await node("page", true), await node("page", false)]
    await seeded(written, "page")
    await seeded(read, "page")
    // Ni filtre ni `returning` : la policy de lecture ne s'applique pas, la policy laisse passer le brouillon, le déclencheur juge.
    expect(await attempt((sql) => sql`update platform.blocks set text = 'Écrasé.'`, session)).toBe("42501")
    expect(await attempt((sql) => sql`delete from platform.blocks`, session)).toBe("42501")
    expect([await blocksOf(written), await blocksOf(read)]).toEqual([["Avant."], ["Avant."]])
    // Bornée par un filtre, la même écriture touche le seul brouillon qu'il écrit.
    expect(await attempt((sql) => sql`update platform.blocks set text = 'Écrasé.' where state = 'draft' and node_id in ${sql([written.id, read.id])} returning id`, session)).toBe(1)
    expect([await blocksOf(written), await blocksOf(read)]).toEqual([["Écrasé."], ["Avant."]])
  })
})
