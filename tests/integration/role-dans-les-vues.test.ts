// @vitest-environment node
// Les vues des pages et la suppression d'un nœud (migration `20261021150000`, suite de `20261021140000`, décision
// d'Alexis du 20/10 : le rôle en base, partout). Avec son seul jeton, en SQL direct, un membre simple ne lit plus qui a vu
// quoi et quand (`node_views`) : ses propres lignes seules, ni celles d'une page qui lui est fermée, ni celles des autres
// sur une page ouverte. Elle n'enregistre de vue que pour elle-même et d'une page qu'elle lit (`node_level_for` >= 1),
// n'en avance pas une d'une page qu'elle ne lit plus, et ne supprime pas les lignes des autres. Les comptes de
// l'organisation (« Les plus consultés » de l'accueil) passent par `node_view_counts`, `security definer`, filtrée par la
// lecture de l'appelant ; le ménage des lignes de plus de 90 jours, par `sweep_node_views`. Et la suppression d'un nœud
// sous une session ne garde que le retrait d'une création jamais publiée par son auteur (`undoCreation`) : ni un membre
// sur un nœud expiré à la corbeille, ni l'administrateur sur un nœud à la corbeille, que purgent `purge_trash` et
// `erase_team_trash`. Sous sa session comme sous celle du serveur, qui juge la même personne. Une lecture écartée par la
// policy rend zéro ligne ; un `with check` refusé lève 42501 ; une fonction refusée aussi.
import { afterAll, describe, expect, it } from "vitest"
import { homeContents, recordNodeView, resolveIdentity, type PlatformDb } from "@otomata_tech/oto_platform/server"
import type { Tx } from "../../packages/plateforme/server/sql"
import { pendingMigrations, pendingReason } from "../helpers/pending-migrations"
import { asCaller, failureOf, seedWithAdmin, SQL_SKIP_REASON, sqlConfigured, type SeededOrg, type SeededPerson } from "../helpers/sql"

const VERSION = "20261021150000"
const pending = (await pendingMigrations()).includes(VERSION)

const suite = !sqlConfigured
  ? `the views of the pages, and the deletion of a node (${SQL_SKIP_REASON})`
  : pending
    ? `the views of the pages, and the deletion of a node (${pendingReason([VERSION])})`
    : "the views of the pages, and the deletion of a node: a plain member reads and writes her own views of what she reads, the counts go through a function, the trash through its functions"

/** Les deux sessions d'une personne : la sienne, et celle du serveur, aux mêmes claims. */
const SESSIONS = [undefined, "server"] as const

const tag = () => Math.random().toString(16).slice(2, 8)

type Page = { id: string; path: string }

/**
 * Une organisation jetable : Ada l'administre ; Léa, membre simple, hors de l'équipe ; Paul, responsable de l'équipe
 * `led` et propriétaire de son espace personnel ; Marc, membre de `led`. `closed`, une page de `led` (Léa ne la voit
 * pas) ; `open`, une page de l'organisation (tout membre la lit) ; `personal`, une page de l'espace de Paul.
 */
type World = {
  org: SeededOrg
  ada: SeededPerson
  lea: SeededPerson
  paul: SeededPerson
  marc: SeededPerson
  led: string
  root: Page
  space: Page
  closed: Page
  open: Page
  personal: Page
}

describe.skipIf(!sqlConfigured || pending)(suite, () => {
  const seed = seedWithAdmin()

  afterAll(async () => {
    await seed.cleanup()
  })

  /**
   * Le résultat d'une instruction sous la session de `who` : le nombre de lignes rendues, `42501` pour le refus d'une
   * policy, ou le code et le message de toute autre erreur (un droit de table refusé lève aussi 42501, sans la policy).
   */
  async function attempt(who: SeededPerson, query: (sql: Tx) => PromiseLike<readonly unknown[]>, session?: "server"): Promise<number | string> {
    let rows = 0
    const failure = await failureOf(asCaller(who.id, who.email).tx(async (sql) => (rows = (await query(sql)).length), session))
    if (!failure) return rows
    if (failure.code === "42501" && /row-level security/.test(failure.message)) return failure.code
    return `${failure.code} ${failure.message}`
  }

  /** Un nœud publié sous `parent` (la racine par défaut), posé par la connexion d'administration. */
  async function node(
    w: Pick<World, "org" | "ada" | "root">,
    options: { team?: string; parent?: Page; trashedDaysAgo?: number; createdBy?: string; revision?: number } = {},
  ): Promise<Page> {
    const parent = options.parent ?? w.root
    const path = parent === w.root ? `p${tag()}` : `${parent.path}/p${tag()}`
    const revision = options.revision ?? 1
    const [row] = await seed.admin<Page[]>`
      insert into platform.nodes (org_id, parent_id, path, kind, title, summary, status, revision, owner_kind, owner_team_id, created_by, deleted_at)
      values (${w.org.id}, ${parent.id}, ${path}, 'page', 'Page', 'Une page.', ${revision > 0 ? "published" : "draft"}, ${revision},
              ${options.team ? "team" : null}, ${options.team ?? null}, ${options.createdBy ?? w.ada.id},
              ${options.trashedDaysAgo === undefined ? null : seed.admin`now() - make_interval(days => ${options.trashedDaysAgo})`})
      returning id, path`
    return row
  }

  async function world(): Promise<World> {
    const org = await seed.createOrg()
    const [root] = await seed.admin<Page[]>`
      insert into platform.nodes (org_id, parent_id, path, title, summary, owner_kind)
      values (${org.id}, null, 'guide', 'Guide', 'Racine.', 'org') returning id, path`
    const [folder] = await seed.admin<Page[]>`
      insert into platform.nodes (org_id, parent_id, path, title, summary)
      values (${org.id}, ${root.id}, 'private', 'Espaces personnels', 'Un espace par personne.') returning id, path`
    const [ada, lea, paul, marc] = [seed.person(), seed.person(), seed.person(), seed.person()]
    await seed.addMember(org.id, ada, "admin")
    for (const person of [lea, paul, marc]) await seed.addMember(org.id, person)
    const slug = `e${tag()}`
    const [team] = await seed.admin<{ id: string }[]>`insert into platform.teams (org_id, slug, name) values (${org.id}, ${slug}, ${`Équipe ${slug}`}) returning id`
    await seed.admin`insert into platform.team_members (team_id, user_id, role) values (${team.id}, ${paul.id}, 'lead'), (${team.id}, ${marc.id}, 'member')`
    const [space] = await seed.admin<Page[]>`
      select id, path from platform.nodes where org_id = ${org.id} and parent_id = ${folder.id} and owner_kind = 'user' and owner_user_id = ${paul.id}`
    const base = { org, ada, root }
    return {
      ...base,
      lea,
      paul,
      marc,
      led: team.id,
      space,
      closed: await node(base, { team: team.id }),
      open: await node(base),
      personal: await node(base, { parent: space }),
    }
  }

  /** Une ligne de vues posée par la connexion d'administration : `views` vues de `page` par `who`, il y a `daysAgo` jours. */
  async function view(w: World, page: Page, who: SeededPerson, { views = 1, daysAgo = 0 }: { views?: number; daysAgo?: number } = {}): Promise<void> {
    await seed.admin`
      insert into platform.node_views (org_id, node_id, user_id, day, views)
      values (${w.org.id}, ${page.id}, ${who.id}, current_date - ${daysAgo}::int, ${views})`
  }

  /** Les lignes de vues de l'organisation, relues par la connexion d'administration. */
  async function viewRows(w: World): Promise<{ node_id: string; user_id: string; views: number }[]> {
    return seed.admin<{ node_id: string; user_id: string; views: number }[]>`
      select node_id, user_id, views from platform.node_views where org_id = ${w.org.id} order by node_id, user_id, day`
  }

  /** Les comptes de `node_view_counts` pour `who`, triés par nœud ; le code et le message d'une erreur. */
  async function counts(who: SeededPerson, org: SeededOrg, session?: "server", days = 30): Promise<{ node_id: string; views: number }[] | string> {
    let rows: { node_id: string; views: number }[] = []
    const failure = await failureOf(
      asCaller(who.id, who.email).tx(async (sql) => {
        rows = [...(await sql<{ node_id: string; views: number }[]>`select node_id, views from platform.node_view_counts(${org.id}, ${days}, 300)`)]
      }, session),
    )
    if (failure) return `${failure.code} ${failure.message}`
    return rows.map((row) => ({ node_id: row.node_id, views: row.views })).sort((a, b) => a.node_id.localeCompare(b.node_id))
  }

  /** Des lignes de vues dans un ordre stable, pour les comparer. */
  const sorted = <T extends { node_id: string; user_id: string }>(rows: T[]) => [...rows].sort((a, b) => `${a.node_id}${a.user_id}`.localeCompare(`${b.node_id}${b.user_id}`))

  const byNode = (entries: [Page, number][]) => entries.map(([page, views]) => ({ node_id: page.id, views })).sort((a, b) => a.node_id.localeCompare(b.node_id))

  /** La base d'une personne pour un service, sous sa session ou celle du serveur. */
  const dbOf = (who: SeededPerson, session?: "server"): PlatformDb => {
    const db = asCaller(who.id, who.email)
    return { tx: (fn) => db.tx(fn, session) }
  }

  it.each(SESSIONS)("should show a plain member her own views only, neither those of a page closed to her nor those of others on an open page (session %s)", async (session) => {
    const w = await world()
    await view(w, w.closed, w.paul, { views: 3 })
    await view(w, w.open, w.paul, { views: 1 })
    await view(w, w.open, w.lea, { views: 4 })
    const of = (page: Page) => (sql: Tx) => sql`select user_id, day, views from platform.node_views where node_id = ${page.id}`
    expect({
      closed: await attempt(w.lea, of(w.closed), session),
      othersOnOpen: await attempt(w.lea, (sql) => sql`select user_id from platform.node_views where node_id = ${w.open.id} and user_id <> ${w.lea.id}`, session),
      own: await attempt(w.lea, (sql) => sql`select node_id from platform.node_views where user_id = ${w.lea.id}`, session),
      paulOnClosed: await attempt(w.paul, of(w.closed), session),
      marcOnClosed: await attempt(w.marc, of(w.closed), session),
    }).toEqual({ closed: 0, othersOnOpen: 0, own: 1, paulOnClosed: 1, marcOnClosed: 0 })
  })

  it.each(SESSIONS)("should refuse a plain member writing a view of a page she does not read, in the name of another, or deleting the views of others (session %s)", async (session) => {
    const w = await world()
    // Une ligne de Léa sur la page fermée (du temps où elle la lisait), une ligne expirée de Paul sur la page ouverte.
    await view(w, w.closed, w.lea, { views: 2, daysAgo: 1 })
    await view(w, w.open, w.paul, { views: 1, daysAgo: 100 })
    const record = (page: Page, who: SeededPerson) => (sql: Tx) => sql`
      insert into platform.node_views (org_id, node_id, user_id) values (${w.org.id}, ${page.id}, ${who.id})
      on conflict (org_id, node_id, user_id, day) do update set views = least(node_views.views + 1, 1000000), last_at = now()
      returning views`
    expect({
      hidden: await attempt(w.lea, record(w.closed, w.lea), session),
      personal: await attempt(w.lea, record(w.personal, w.lea), session),
      forPaul: await attempt(w.lea, record(w.open, w.paul), session),
      bump: await attempt(w.lea, (sql) => sql`update platform.node_views set views = views + 1 where node_id = ${w.closed.id} and user_id = ${w.lea.id} returning views`, session),
      sweepOthers: await attempt(w.lea, (sql) => sql`delete from platform.node_views where org_id = ${w.org.id} and user_id = ${w.paul.id} and day < current_date - 90 returning node_id`, session),
    }).toEqual({
      hidden: "42501",
      personal: "42501",
      forPaul: "42501",
      bump: "42501",
      sweepOthers: expect.stringMatching(/^42501 permission denied/),
    })
    // Ce que le service fait passe : sa propre vue d'une page qu'elle lit, deux fois.
    expect(await attempt(w.lea, record(w.open, w.lea), session)).toBe(1)
    expect(await attempt(w.lea, record(w.open, w.lea), session)).toBe(1)
    expect(sorted(await viewRows(w))).toEqual(
      sorted([
        { node_id: w.closed.id, user_id: w.lea.id, views: 2 },
        { node_id: w.open.id, user_id: w.paul.id, views: 1 },
        { node_id: w.open.id, user_id: w.lea.id, views: 2 },
      ]),
    )
  })

  it.each(SESSIONS)("should refuse deleting a node in the trash under a session, to a member past 30 days and to an administrator, and keep the undoing of a creation (session %s)", async (session) => {
    const w = await world()
    const remove = (page: Page) => (sql: Tx) => sql`delete from platform.nodes where id = ${page.id} returning id`
    const expired = await node(w, { trashedDaysAgo: 31 })
    const expiredHidden = await node(w, { team: w.led, trashedDaysAgo: 40 })
    const lately = await node(w, { trashedDaysAgo: 1 })
    const expiredForAda = await node(w, { trashedDaysAgo: 40 })
    const created = await node(w, { createdBy: w.lea.id, revision: 0 })
    const createdByPaul = await node(w, { createdBy: w.paul.id, revision: 0 })
    expect({
      expired: await attempt(w.lea, remove(expired), session),
      expiredHidden: await attempt(w.lea, remove(expiredHidden), session),
      adminLately: await attempt(w.ada, remove(lately), session),
      adminExpired: await attempt(w.ada, remove(expiredForAda), session),
      othersCreation: await attempt(w.lea, remove(createdByPaul), session),
      ownCreation: await attempt(w.lea, remove(created), session),
    }).toEqual({ expired: 0, expiredHidden: 0, adminLately: 0, adminExpired: 0, othersCreation: 0, ownCreation: 1 })
    const left = await seed.admin<{ id: string }[]>`
      select id from platform.nodes where id in ${seed.admin([expired, expiredHidden, lately, expiredForAda, created, createdByPaul].map((page) => page.id))}`
    expect(left.map((row) => row.id).sort()).toEqual([expired, expiredHidden, lately, expiredForAda, createdByPaul].map((page) => page.id).sort())
  })

  it.each(SESSIONS)("should count the views of the organisation through node_view_counts, for the pages the caller reads only (session %s)", async (session) => {
    const w = await world()
    const elsewhere = await world()
    const trashed = await node(w, { trashedDaysAgo: 2 })
    await view(w, w.closed, w.paul, { views: 3 })
    await view(w, w.closed, w.marc, { views: 2 })
    await view(w, w.open, w.paul, { views: 1 })
    await view(w, w.open, w.lea, { views: 4 })
    await view(w, w.open, w.lea, { views: 7, daysAgo: 40 })
    await view(w, w.personal, w.paul, { views: 5 })
    await view(w, trashed, w.lea, { views: 2 })
    await view(elsewhere, elsewhere.open, elsewhere.lea, { views: 9 })
    expect({
      lea: await counts(w.lea, w.org, session),
      marc: await counts(w.marc, w.org, session),
      paul: await counts(w.paul, w.org, session),
      // La fenêtre la plus large, celle de la rétention : la vue d'il y a 40 jours compte.
      lea90: await counts(w.lea, w.org, session, 90),
    }).toEqual({
      lea: byNode([[w.open, 5]]),
      marc: byNode([[w.open, 5], [w.closed, 5]]),
      paul: byNode([[w.open, 5], [w.closed, 5], [w.personal, 5]]),
      lea90: byNode([[w.open, 12]]),
    })
  })

  it.each(SESSIONS)("should refuse the functions of the views to whoever is not a member, and a window beyond the retention (session %s)", async (session) => {
    const w = await world()
    const elsewhere = await world()
    await view(w, w.open, w.paul, { views: 1, daysAgo: 100 })
    expect({
      outsider: await counts(elsewhere.lea, w.org, session),
      admin: await counts(elsewhere.ada, w.org, session),
      tooWide: await counts(w.lea, w.org, session, 91),
      empty: await counts(w.lea, w.org, session, 0),
      sweep: await attempt(elsewhere.ada, (sql) => sql`select platform.sweep_node_views(${w.org.id})`, session),
    }).toEqual({
      outsider: expect.stringMatching(/^42501 /),
      admin: expect.stringMatching(/^42501 /),
      tooWide: expect.stringMatching(/^22023 /),
      empty: expect.stringMatching(/^22023 /),
      sweep: expect.stringMatching(/^42501 /),
    })
    expect(await viewRows(w)).toHaveLength(1)
  })

  it.each(SESSIONS)("should keep what the services return: a view recorded and the expired views of the organisation swept, and the most viewed (session %s)", async (session) => {
    const w = await world()
    await view(w, w.closed, w.paul, { views: 3 })
    await view(w, w.open, w.paul, { views: 1, daysAgo: 1 })
    await view(w, w.open, w.marc, { views: 1, daysAgo: 100 })
    await view(w, w.closed, w.paul, { views: 1, daysAgo: 120 })
    await view(w, w.open, w.lea, { views: 1, daysAgo: 3 })
    const db = dbOf(w.lea, session)
    const identity = await resolveIdentity(db, w.org.host, { userId: w.lea.id, email: w.lea.email })
    await recordNodeView(db, identity, { path: w.open.path })
    await expect(recordNodeView(db, identity, { path: w.closed.path })).rejects.toMatchObject({ code: "not_found" })
    // La vue de Léa comptée ; les lignes de plus de 90 jours de toute l'organisation retirées, celles de Marc et de Paul comprises.
    const rows = await viewRows(w)
    expect(rows.filter((row) => row.node_id === w.open.id).map((row) => row.user_id).sort()).toEqual([w.lea.id, w.lea.id, w.paul.id].sort())
    expect(rows.filter((row) => row.node_id === w.closed.id)).toEqual([{ node_id: w.closed.id, user_id: w.paul.id, views: 3 }])
    expect(rows).toHaveLength(4)
    const page = await homeContents(db, identity, { tab: "viewed", scope: "org" })
    expect(page.items.map((item) => ({ path: item.path, views: item.views }))).toEqual([{ path: w.open.path, views: { screen: 3, assistant: 0 } }])
  })
})
