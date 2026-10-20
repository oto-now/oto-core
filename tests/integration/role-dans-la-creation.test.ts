// @vitest-environment node
// Le niveau exigé par la création d'un nœud, et les colonnes de `nodes` qu'une session écrit (migration `20261021110000`,
// décision d'Alexis du 20/10 ; suite de `role-dans-les-noeuds.test.ts`) : avec son seul jeton, en SQL direct, un membre
// simple ne crée pas une page sous un parent qu'il ne fait que lire, ou qu'il ne voit pas ; personne ne se pose
// propriétaire d'une page à sa création, ni n'en choisit la corbeille, l'état, la révision, l'identifiant, la date, les
// métadonnées ou la position ; personne ne change l'identifiant d'une page, ni son contenu (titre, résumé, genre, état,
// révision, métadonnées, date de création, auteur), qu'aucun service n'écrit sous une session. Sous sa session comme
// sous celle du serveur, qui juge la même personne. L'ayant droit de `create` (`server/nodes/write.ts`) crée sous un
// parent qu'il écrit, avec les seules colonnes d'`insertNode` (`write-result.ts`), et la donnée est relue par la
// connexion d'administration. Le déclencheur des gestes d'un nœud (`nodes_gesture_guard`) lève 42501 à son nom ; un
// droit de colonne refusé lève 42501, « permission denied ».
import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { pendingMigrations, pendingReason } from "../helpers/pending-migrations"
import { asCaller, failureOf, seedWithAdmin, SQL_SKIP_REASON, sqlConfigured, type SeededData, type SeededOrg, type SeededPerson } from "../helpers/sql"
import type { Tx } from "../../packages/plateforme/server/sql"

const VERSION = "20261021110000"
const pending = (await pendingMigrations()).includes(VERSION)

const suite = !sqlConfigured
  ? `the level required by the creation of a node, and the columns of nodes (${SQL_SKIP_REASON})`
  : pending
    ? `the level required by the creation of a node, and the columns of nodes (${pendingReason([VERSION])})`
    : "the level required by the creation of a node, and the columns of nodes a session writes: a plain member is refused, whoever the service lets in passes"

/** Les deux sessions d'une personne : la sienne, et celle du serveur, aux mêmes claims. */
const SESSIONS = [undefined, "server"] as const

/**
 * Les colonnes de `nodes` qu'une session insère : celles qu'écrit `insertNode` (`server/nodes/write-result.ts`), seul
 * ajout dans `nodes` sous une session ; le propriétaire est hérité (nul), le reste prend sa valeur par défaut.
 */
const INSERTED = ["org_id", "parent_id", "path", "kind", "title", "summary", "created_by", "updated_by"]

/**
 * Les colonnes de `nodes` qu'une session modifie, chacune avec ses services ; le contenu passe par `publish_node`,
 * `security definer`, et `updated_at` par le déclencheur `set_updated_at`.
 */
const UPDATED: Record<string, string> = {
  parent_id: "moveNode (server/nodes/move.ts), restoreNode (server/nodes/trash.ts)",
  path: "moveNode (server/nodes/move.ts), restoreNode (server/nodes/trash.ts)",
  owner_kind: "transferOwner (server/admin/nodes.ts)",
  owner_team_id: "transferOwner (server/admin/nodes.ts)",
  owner_user_id: "transferOwner (server/admin/nodes.ts)",
  updated_by: "transferOwner, moveNode, restoreNode",
  position: "placeNode, positionAfter (server/nodes/order.ts)",
  deleted_at: "trashNode, restoreNode (server/nodes/trash.ts)",
}

const tag = () => Math.random().toString(16).slice(2, 8)

/** Le refus du déclencheur des gestes d'un nœud. */
const GUARD = "guard"
/** Le refus d'un droit de table ou de colonne. */
const DENIED = "denied"

type Privilege = { role: string; privilege: string; column_name: string }

describe.skipIf(!sqlConfigured || pending)(suite, () => {
  let seed: SeededData
  let org: SeededOrg
  /** Membre simple de O, hors de l'équipe `led`. */
  let lea: SeededPerson
  /** Membre simple de O, membre de l'équipe `led`. */
  let marc: SeededPerson
  let led: string
  let root: { id: string; path: string }

  /**
   * Le résultat d'une écriture sous la session de `who` (la sienne, ou celle du serveur) : le nombre de lignes rendues,
   * `42501` pour le refus d'une policy, `guard` pour celui du déclencheur des gestes d'un nœud, `denied` pour un droit
   * refusé, ou le code et le message de toute autre erreur.
   */
  async function attempt(who: SeededPerson, query: (sql: Tx) => PromiseLike<readonly unknown[]>, session?: "server"): Promise<number | string> {
    let rows = 0
    const failure = await failureOf(asCaller(who.id, who.email).tx(async (sql) => (rows = (await query(sql)).length), session))
    if (!failure) return rows
    if (failure.code === "42501" && /row-level security/.test(failure.message)) return failure.code
    if (failure.code === "42501" && /^platform\.nodes: /.test(failure.message)) return GUARD
    if (failure.code === "42501" && /^permission denied for table nodes$/.test(failure.message)) return DENIED
    return `${failure.code} ${failure.message}`
  }

  /** Un nœud sous `parent`, posé par la connexion d'administration : propriétaire hérité sans `team`, publié. */
  async function node(parent: { id: string; path: string }, team?: string): Promise<{ id: string; path: string }> {
    const segment = `p${tag()}`
    const path = parent.id === root.id ? segment : `${parent.path}/${segment}`
    const [row] = await seed.admin<{ id: string; path: string }[]>`
      insert into platform.nodes (org_id, parent_id, path, title, summary, status, revision, owner_kind, owner_team_id)
      values (${org.id}, ${parent.id}, ${path}, 'Page', 'Une page.', 'published', 1, ${team ? "team" : null}, ${team ?? null})
      returning id, path`
    return row
  }

  /** La création de `create` : les colonnes d'`insertNode`, et `extra` en plus. */
  const create =
    (who: SeededPerson, parent: { id: string; path: string }, extra: Record<string, unknown> = {}) =>
    (sql: Tx) => {
      const path = `${parent.path}/n${tag()}`
      const row = { org_id: org.id, parent_id: parent.id, path, kind: "page", title: "Neuve", summary: "Une page neuve.", created_by: who.id, updated_by: who.id, ...extra }
      return sql<{ id: string }[]>`insert into platform.nodes ${sql(row)} returning id`
    }

  beforeAll(async () => {
    seed = seedWithAdmin()
    org = await seed.createOrg()
    ;[lea, marc] = [seed.person(), seed.person()]
    for (const person of [lea, marc]) await seed.addMember(org.id, person)
    const [team] = await seed.admin<{ id: string }[]>`
      insert into platform.teams (org_id, slug, name) values (${org.id}, ${`e${tag()}`}, ${`Équipe ${tag()}`}) returning id`
    led = team.id
    await seed.admin`insert into platform.team_members (team_id, user_id, role) values (${led}, ${marc.id}, 'member')`
    const [row] = await seed.admin<{ id: string; path: string }[]>`
      insert into platform.nodes (org_id, parent_id, path, title, summary, owner_kind)
      values (${org.id}, null, 'guide', 'Guide', 'Racine.', 'org') returning id, path`
    root = row
  })

  afterAll(async () => {
    await seed?.cleanup()
  })

  it("should grant authenticated the INSERT of the columns insertNode writes and the UPDATE of the columns the services write, and platform_server nothing beyond", async () => {
    const granted = await seed.admin<Privilege[]>`
      select r.role, p.privilege, a.attname as column_name
        from pg_catalog.pg_attribute a
       cross join (values ('authenticated'), ('platform_server')) as r(role)
       cross join (values ('INSERT'), ('UPDATE')) as p(privilege)
       where a.attrelid = 'platform.nodes'::regclass and a.attnum > 0 and not a.attisdropped
         and pg_catalog.has_column_privilege(r.role, a.attrelid, a.attnum, p.privilege)`
    const held = (role: string, privilege: string) =>
      granted
        .filter((right) => right.role === role && right.privilege === privilege)
        .map((right) => right.column_name)
        .sort()
    expect({
      insert: held("authenticated", "INSERT"),
      update: held("authenticated", "UPDATE"),
      serverInsert: held("platform_server", "INSERT"),
      serverUpdate: held("platform_server", "UPDATE"),
    }).toEqual({
      insert: [...INSERTED].sort(),
      update: Object.keys(UPDATED).sort(),
      serverInsert: [...INSERTED].sort(),
      serverUpdate: Object.keys(UPDATED).sort(),
    })
  })

  it.each(SESSIONS)("should refuse a plain member creating a page under a parent she only reads or does not see, and let whoever writes it (session %s)", async (session) => {
    const [read, folder] = [await node(root), await node(root, led)]
    expect(await attempt(lea, create(lea, read), session)).toBe(GUARD)
    expect(await attempt(lea, create(lea, folder), session)).toBe(GUARD)
    expect(await seed.admin`select 1 from platform.nodes where parent_id in ${seed.admin([read.id, folder.id])}`).toHaveLength(0)
    expect(await attempt(marc, create(marc, folder), session)).toBe(1)
    expect(await seed.admin`
      select kind, status, revision, owner_kind, created_by, updated_by, deleted_at, position, meta
        from platform.nodes where parent_id = ${folder.id}`).toEqual([
      { kind: "page", status: "draft", revision: 0, owner_kind: null, created_by: marc.id, updated_by: marc.id, deleted_at: null, position: null, meta: {} },
    ])
  })

  it.each(SESSIONS)("should refuse a writer making herself the owner of the page she creates (session %s)", async (session) => {
    const folder = await node(root, led)
    expect(await attempt(marc, create(marc, folder, { owner_kind: "user", owner_user_id: marc.id }), session)).toBe(DENIED)
    expect(await attempt(marc, create(marc, folder, { owner_kind: "org" }), session)).toBe(DENIED)
    expect(await seed.admin`select 1 from platform.nodes where parent_id = ${folder.id}`).toHaveLength(0)
  })

  it.each(SESSIONS)("should refuse a writer choosing the trash date, the state, the revision, the id, the date, the metadata or the position of the page she creates (session %s)", async (session) => {
    const folder = await node(root, led)
    const chosen: Record<string, unknown>[] = [
      { deleted_at: new Date("2000-01-01T00:00:00Z") },
      { status: "published", revision: 7 },
      { revision: 3 },
      { id: randomUUID() },
      { created_at: new Date("2000-01-01T00:00:00Z") },
      { meta: { forged: true } },
      { position: 1 },
    ]
    for (const extra of chosen) expect([extra, await attempt(marc, create(marc, folder, extra), session)]).toEqual([extra, DENIED])
    expect(await seed.admin`select 1 from platform.nodes where parent_id = ${folder.id}`).toHaveLength(0)
  })

  it.each(SESSIONS)("should refuse a writer changing the id or the content of a page she writes, which no service writes under a session (session %s)", async (session) => {
    const folder = await node(root, led)
    const set = (id: string, column: string, value: unknown) => (sql: Tx) => sql`update platform.nodes set ${sql({ [column]: value })} where id = ${id} returning id`
    const changes: [string, unknown][] = [
      ["id", randomUUID()],
      ["title", "Marc"],
      ["summary", "Un autre résumé."],
      ["kind", "procedure"],
      ["status", "draft"],
      ["revision", 9],
      ["meta", { forged: true }],
      ["created_at", new Date("2000-01-01T00:00:00Z")],
      ["created_by", marc.id],
    ]
    // Une page par changement : un identifiant changé ne cache pas le refus suivant.
    const pages = await Promise.all(changes.map(() => node(folder)))
    for (const [index, [column, value]] of changes.entries()) {
      expect([column, await attempt(marc, set(pages[index].id, column, value), session)]).toEqual([column, DENIED])
    }
    expect(await seed.admin`
      select count(*)::int as unchanged from platform.nodes
       where id in ${seed.admin(pages.map((page) => page.id))} and title = 'Page' and summary = 'Une page.' and kind = 'page'
         and status = 'published' and revision = 1 and meta = '{}'::jsonb and created_at > now() - interval '1 hour' and created_by is null`).toEqual([
      { unchanged: changes.length },
    ])
  })

  it.each(SESSIONS)("should still refuse a reader signing a page alone, and let a writer place it (session %s)", async (session) => {
    const [read, written] = [await node(root), await node(await node(root, led))]
    expect(await attempt(lea, (sql) => sql`update platform.nodes set updated_by = ${lea.id} where id = ${read.id} returning id`, session)).toBe(GUARD)
    expect(await attempt(marc, (sql) => sql`update platform.nodes set position = 500 where id = ${written.id} returning id`, session)).toBe(1)
    expect(await seed.admin`select updated_by, position from platform.nodes where id in ${seed.admin([read.id, written.id])} order by id = ${written.id}`).toEqual([
      { updated_by: null, position: null },
      { updated_by: null, position: 500 },
    ])
  })
})
