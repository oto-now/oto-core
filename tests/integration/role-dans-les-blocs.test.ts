// @vitest-environment node
// Le niveau exigé par l'écriture des blocs, et le dernier auteur d'un nœud (migration `20261021120000`, décision d'Alexis du
// 20/10 ; suite de `role-dans-les-noeuds.test.ts` et de `role-dans-la-creation.test.ts`) : avec son seul jeton, en SQL
// direct, un membre simple n'ajoute, ne modifie ni ne supprime une ligne publiée d'un tableau qu'il ne fait que lire, ou
// qu'il ne voit pas, et n'écrit pas le brouillon d'une telle page ; personne ne nomme un autre que soi dernier auteur d'une
// page (`updated_by`), même d'une page qu'il écrit. Sous sa session comme sous celle du serveur, qui juge la même
// personne. L'ayant droit du service (`requireWrite` des fonctions `table.*`, `saveDraft` après `requireNodeLevel`
// action `write`) passe, la création d'une page et de son brouillon dans une transaction aussi, et la donnée est relue
// par la connexion d'administration. Un `with check` refusé lève 42501 (une insertion n'a que lui) ; un `using` qui
// écarte la ligne la cache : zéro ligne touchée ; le déclencheur des gestes d'un nœud (`nodes_gesture_guard`) lève
// 42501 à son nom.
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { pendingMigrations, pendingReason } from "../helpers/pending-migrations"
import { asCaller, failureOf, seedWithAdmin, SQL_SKIP_REASON, sqlConfigured, type SeededData, type SeededOrg, type SeededPerson } from "../helpers/sql"
import type { Tx } from "../../packages/plateforme/server/sql"

const VERSION = "20261021120000"
const pending = (await pendingMigrations()).includes(VERSION)

const suite = !sqlConfigured
  ? `the level required by the writes of the blocks, and the last author of a node (${SQL_SKIP_REASON})`
  : pending
    ? `the level required by the writes of the blocks, and the last author of a node (${pendingReason([VERSION])})`
    : "the level required by the writes of the blocks, and the last author of a node: a plain member is refused, whoever the service lets in passes"

/** Les deux sessions d'une personne : la sienne, et celle du serveur, aux mêmes claims. */
const SESSIONS = [undefined, "server"] as const

const tag = () => Math.random().toString(16).slice(2, 8)

/** Le refus du déclencheur des gestes d'un nœud. */
const GUARD = "guard"

type Page = { id: string; path: string }

describe.skipIf(!sqlConfigured || pending)(suite, () => {
  let seed: SeededData
  let org: SeededOrg
  /** Administratrice de O. */
  let ada: SeededPerson
  /** Membre simple de O, hors de l'équipe `led`. */
  let lea: SeededPerson
  /** Membre de O, responsable de l'équipe `led`. */
  let paul: SeededPerson
  /** Membre simple de O, membre de l'équipe `led`. */
  let marc: SeededPerson
  let led: string
  let root: Page

  /**
   * Le résultat d'une écriture sous la session de `who` (la sienne, ou celle du serveur) : le nombre de lignes rendues,
   * `42501` pour le refus d'une policy, `guard` pour celui du déclencheur des gestes d'un nœud, ou le code et le message
   * de toute autre erreur.
   */
  async function attempt(who: SeededPerson, query: (sql: Tx) => PromiseLike<readonly unknown[]>, session?: "server"): Promise<number | string> {
    let rows = 0
    const failure = await failureOf(asCaller(who.id, who.email).tx(async (sql) => (rows = (await query(sql)).length), session))
    if (!failure) return rows
    if (failure.code === "42501" && /row-level security/.test(failure.message)) return failure.code
    if (failure.code === "42501" && /^platform\.nodes: /.test(failure.message)) return GUARD
    return `${failure.code} ${failure.message}`
  }

  /** Un nœud publié sous la racine, posé par la connexion d'administration : de l'équipe `led` avec `team`, sinon de l'organisation. */
  async function node(kind: "page" | "table", team?: string): Promise<Page> {
    const [row] = await seed.admin<Page[]>`
      insert into platform.nodes (org_id, parent_id, path, kind, title, summary, status, revision, owner_kind, owner_team_id, created_by)
      values (${org.id}, ${root.id}, ${`p${tag()}`}, ${kind}, 'Page', 'Une page.', 'published', 1, ${team ? "team" : null}, ${team ?? null}, ${ada.id})
      returning id, path`
    return row
  }

  /** L'écriture d'une personne nommée sur un nœud qu'elle ne fait que lire (`access_rules`, comme `setNodeRule`). */
  async function grantWrite(page: Page, who: SeededPerson): Promise<void> {
    await seed.admin`
      insert into platform.access_rules (org_id, node_id, subject_user_id, level, created_by) values (${org.id}, ${page.id}, ${who.id}, 'write', ${ada.id})`
  }

  /** Une ligne publiée de `table`, posée par la connexion d'administration. */
  async function seededRow(table: Page): Promise<string> {
    const [row] = await seed.admin<{ id: string }[]>`
      insert into platform.blocks (org_id, node_id, state, type, key, data, created_by)
      values (${org.id}, ${table.id}, 'published', 'row', ${`k${tag()}`}, '{"ville":"Valbrune"}'::jsonb, ${ada.id}) returning id`
    return row.id
  }

  /** Le brouillon ouvert de `page` et un bloc de ce brouillon, posés par la connexion d'administration. */
  async function seededDraft(page: Page): Promise<string> {
    await seed.admin`insert into platform.node_drafts (node_id, base_revision, created_by) values (${page.id}, 1, ${ada.id})`
    const [block] = await seed.admin<{ id: string }[]>`
      insert into platform.blocks (org_id, node_id, state, type, text, position, created_by)
      values (${org.id}, ${page.id}, 'draft', 'paragraph', 'Avant.', 1, ${ada.id}) returning id`
    return block.id
  }

  // Les écritures des lignes d'un tableau : celles de `insertRow`, `updateRow` (`server/tables/row-store.ts`) et
  // `deleteJudged` (`server/tables/delete-rows.ts`).
  const insertRow = (table: Page, who: SeededPerson) => (sql: Tx) =>
    sql`insert into platform.blocks (node_id, state, type, key, data, created_by, updated_by)
        values (${table.id}, 'published', 'row', ${`n${tag()}`}, '{"ville":"Brémontier"}'::jsonb, ${who.id}, ${who.id}) returning id`
  const updateRow = (id: string, who: SeededPerson) => (sql: Tx) =>
    sql`update platform.blocks set data = '{"ville":"Brémontier"}'::jsonb, revision = revision + 1, updated_by = ${who.id}
         where id = ${id} and state = 'published' returning id`
  const deleteBlock = (id: string) => (sql: Tx) => sql`delete from platform.blocks where id = ${id} returning id`

  // Les écritures d'un brouillon : celles d'`insertBlocks`, `writeUpdate` et `deleteBlocks` (`server/nodes/store.ts`).
  const insertDraftBlock = (page: Page, who: SeededPerson) => (sql: Tx) =>
    sql`insert into platform.blocks (node_id, state, type, text, position, created_by, updated_by)
        values (${page.id}, 'draft', 'paragraph', 'Ajouté.', 2, ${who.id}, ${who.id}) returning id`
  const updateDraftBlock = (id: string, who: SeededPerson) => (sql: Tx) =>
    sql`update platform.blocks set text = 'Après.', revision = revision + 1, updated_by = ${who.id} where id = ${id} and state = 'draft' returning id`

  /** Les blocs d'un nœud relus par la connexion d'administration : leur texte, ou la ville d'une ligne, et leur dernier auteur. */
  const blocksOf = (page: Page) =>
    seed.admin`select coalesce(text, data ->> 'ville') as value, updated_by from platform.blocks where node_id = ${page.id} order by created_at, value`

  beforeAll(async () => {
    seed = seedWithAdmin()
    org = await seed.createOrg()
    ;[ada, lea, paul, marc] = [seed.person(), seed.person(), seed.person(), seed.person()]
    await seed.addMember(org.id, ada, "admin")
    for (const person of [lea, paul, marc]) await seed.addMember(org.id, person)
    const [team] = await seed.admin<{ id: string }[]>`
      insert into platform.teams (org_id, slug, name) values (${org.id}, ${`e${tag()}`}, ${`Équipe ${tag()}`}) returning id`
    led = team.id
    await seed.admin`insert into platform.team_members (team_id, user_id, role) values (${led}, ${paul.id}, 'lead'), (${led}, ${marc.id}, 'member')`
    const [row] = await seed.admin<Page[]>`
      insert into platform.nodes (org_id, parent_id, path, title, summary, owner_kind)
      values (${org.id}, null, 'guide', 'Guide', 'Racine.', 'org') returning id, path`
    root = row
  })

  afterAll(async () => {
    await seed?.cleanup()
  })

  it.each(SESSIONS)("should refuse a plain member writing the rows of a table she only reads, and let whoever writes it (session %s)", async (session) => {
    // Un tableau de l'organisation : Léa et Marc le lisent (1) ; Marc l'écrit par une règle (2).
    const table = await node("table")
    const row = await seededRow(table)
    expect(await attempt(lea, insertRow(table, lea), session)).toBe("42501")
    expect(await attempt(lea, updateRow(row, lea), session)).toBe(0)
    expect(await attempt(lea, deleteBlock(row), session)).toBe(0)
    expect(await blocksOf(table)).toEqual([{ value: "Valbrune", updated_by: null }])
    await grantWrite(table, marc)
    expect(await attempt(marc, updateRow(row, marc), session)).toBe(1)
    expect(await attempt(marc, insertRow(table, marc), session)).toBe(1)
    expect(await blocksOf(table)).toEqual([
      { value: "Brémontier", updated_by: marc.id },
      { value: "Brémontier", updated_by: marc.id },
    ])
    expect(await attempt(marc, deleteBlock(row), session)).toBe(1)
    expect(await blocksOf(table)).toEqual([{ value: "Brémontier", updated_by: marc.id }])
  })

  it.each(SESSIONS)("should refuse a plain member writing the draft of a page she only reads, and let whoever writes it (session %s)", async (session) => {
    const page = await node("page")
    const block = await seededDraft(page)
    expect(await attempt(lea, insertDraftBlock(page, lea), session)).toBe("42501")
    expect(await attempt(lea, updateDraftBlock(block, lea), session)).toBe(0)
    expect(await attempt(lea, deleteBlock(block), session)).toBe(0)
    expect(await blocksOf(page)).toEqual([{ value: "Avant.", updated_by: null }])
    await grantWrite(page, marc)
    expect(await attempt(marc, updateDraftBlock(block, marc), session)).toBe(1)
    expect(await attempt(marc, insertDraftBlock(page, marc), session)).toBe(1)
    expect(await blocksOf(page)).toEqual([
      { value: "Après.", updated_by: marc.id },
      { value: "Ajouté.", updated_by: marc.id },
    ])
    expect(await attempt(marc, deleteBlock(block), session)).toBe(1)
    expect(await blocksOf(page)).toEqual([{ value: "Ajouté.", updated_by: marc.id }])
  })

  it.each(SESSIONS)("should refuse a plain member writing the rows or the draft of a table or a page hidden from her, and let its team (session %s)", async (session) => {
    // De l'équipe `led` : Léa ne les voit pas (0), Marc les écrit (2).
    const [table, page] = [await node("table", led), await node("page", led)]
    const [row, block] = [await seededRow(table), await seededDraft(page)]
    expect(await attempt(lea, insertRow(table, lea), session)).toBe("42501")
    expect(await attempt(lea, updateRow(row, lea), session)).toBe(0)
    expect(await attempt(lea, deleteBlock(row), session)).toBe(0)
    expect(await attempt(lea, insertDraftBlock(page, lea), session)).toBe("42501")
    expect(await attempt(lea, updateDraftBlock(block, lea), session)).toBe(0)
    expect(await attempt(lea, deleteBlock(block), session)).toBe(0)
    expect([await blocksOf(table), await blocksOf(page)]).toEqual([[{ value: "Valbrune", updated_by: null }], [{ value: "Avant.", updated_by: null }]])
    expect(await attempt(marc, updateRow(row, marc), session)).toBe(1)
    expect(await attempt(marc, updateDraftBlock(block, marc), session)).toBe(1)
    expect([await blocksOf(table), await blocksOf(page)]).toEqual([[{ value: "Brémontier", updated_by: marc.id }], [{ value: "Après.", updated_by: marc.id }]])
    expect(await attempt(marc, deleteBlock(row), session)).toBe(1)
    expect(await attempt(marc, deleteBlock(block), session)).toBe(1)
    expect([await blocksOf(table), await blocksOf(page)]).toEqual([[], []])
  })

  // `create` (`server/nodes/write.ts`) : `insertNode`, `open_draft` et `saveDraft` dans une transaction ; la page neuve
  // hérite du propriétaire et des règles de son parent, donc de son niveau.
  it.each(SESSIONS)("should let whoever writes a parent create a page and write its draft in one transaction (session %s)", async (session) => {
    const folder = await node("page", led)
    const path = `${folder.path}/n${tag()}`
    const create = async (sql: Tx) => {
      const [created] = await sql<{ id: string }[]>`
        insert into platform.nodes (org_id, parent_id, path, kind, title, summary, created_by, updated_by)
        values (${org.id}, ${folder.id}, ${path}, 'page', 'Neuve', 'Une page neuve.', ${marc.id}, ${marc.id}) returning id`
      await sql`select platform.open_draft(${created.id})`
      return insertDraftBlock({ id: created.id, path }, marc)(sql)
    }
    expect(await attempt(marc, create, session)).toBe(1)
    expect(await seed.admin`select b.state, b.text, b.updated_by from platform.blocks b join platform.nodes n on n.id = b.node_id where n.path = ${path} and n.org_id = ${org.id}`).toEqual([
      { state: "draft", text: "Ajouté.", updated_by: marc.id },
    ])
  })

  it.each(SESSIONS)("should refuse a writer naming someone else the last author of a page, and let her name herself (session %s)", async (session) => {
    const folder = await node("page", led)
    const sign = (who: SeededPerson) => (sql: Tx) => sql`update platform.nodes set updated_by = ${who.id} where id = ${folder.id} returning id`
    const create = (author: SeededPerson) => (sql: Tx) =>
      sql`insert into platform.nodes (org_id, parent_id, path, kind, title, summary, created_by, updated_by)
          values (${org.id}, ${folder.id}, ${`${folder.path}/n${tag()}`}, 'page', 'Neuve', 'Une page neuve.', ${marc.id}, ${author.id}) returning id`
    expect(await attempt(marc, sign(paul), session)).toBe(GUARD)
    expect(await attempt(marc, create(paul), session)).toBe(GUARD)
    expect(await seed.admin`select updated_by from platform.nodes where id = ${folder.id} or parent_id = ${folder.id}`).toEqual([{ updated_by: null }])
    expect(await attempt(marc, sign(marc), session)).toBe(1)
    expect(await attempt(marc, create(marc), session)).toBe(1)
    expect(await seed.admin`select updated_by from platform.nodes where id = ${folder.id} or parent_id = ${folder.id}`).toEqual([{ updated_by: marc.id }, { updated_by: marc.id }])
  })
})
