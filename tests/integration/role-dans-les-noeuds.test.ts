// @vitest-environment node
// Le niveau exigé par les écritures des nœuds (migration `20261021090000`, décision d'Alexis du 20/10 ; suite de
// `role-dans-les-ajouts-et-modifications.test.ts`) : avec son seul jeton, en SQL direct, un membre simple n'écrit pas
// une page qu'il ne fait que lire, ne la met pas à la corbeille, ne la restaure pas, ne la déplace ni ne la renomme, ne
// change pas son propriétaire, n'écrit pas son brouillon, n'en crée ni n'en change le lien public, ne supprime pas une
// page vivante ou entrée depuis peu à la corbeille, n'exclut pas un autre membre, et un brouillon de courriel envoyé ne
// redevient pas brouillon ; personne ne date la corbeille autrement que par l'horloge de la base. Sous sa session comme
// sous celle du serveur, qui juge la même personne. L'ayant droit du service passe, et la donnée est relue par la
// connexion d'administration. Une policy dont le `using` écarte la ligne la cache : zéro ligne touchée ; un `with check`
// refusé lève 42501 (une insertion n'a que lui) ; le déclencheur des gestes d'un nœud (`nodes_gesture_guard`), qui voit
// l'ancienne ligne, lève 42501 à son nom.
import { randomBytes } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { pendingMigrations, pendingReason } from "../helpers/pending-migrations"
import { asCaller, failureOf, seedWithAdmin, SQL_SKIP_REASON, sqlConfigured, type SeededData, type SeededOrg, type SeededPerson } from "../helpers/sql"
import type { Tx } from "../../packages/plateforme/server/sql"

const VERSION = "20261021090000"
const pending = (await pendingMigrations()).includes(VERSION)

const suite = !sqlConfigured
  ? `the level required by the writes of the nodes (${SQL_SKIP_REASON})`
  : pending
    ? `the level required by the writes of the nodes (${pendingReason([VERSION])})`
    : "the level required by the writes of the nodes: a plain member is refused, whoever the service lets in passes"

/** Les deux sessions d'une personne : la sienne, et celle du serveur, aux mêmes claims. */
const SESSIONS = [undefined, "server"] as const

const tag = () => Math.random().toString(16).slice(2, 8)

/** Un jeton de lien public, de la forme que tire `shareNode` (43 caractères). */
const token = () => randomBytes(32).toString("base64url")

/** Le refus du déclencheur des gestes d'un nœud. */
const GUARD = "guard"

type NodeSeed = { owner?: { kind: "org" | "team" | "user"; id?: string }; createdBy?: string; revision?: number; trashedDaysAgo?: number }

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
  let root: { id: string; path: string }

  /**
   * Le résultat d'une écriture sous la session de `who` (la sienne, ou celle du serveur) : le nombre de lignes rendues,
   * `42501` pour le refus d'une policy, `guard` pour celui du déclencheur des gestes d'un nœud, ou le code et le message
   * de toute autre erreur (un droit de colonne refusé lève aussi 42501, mais ne dit rien de la policy).
   */
  async function attempt(who: SeededPerson, query: (sql: Tx) => PromiseLike<readonly unknown[]>, session?: "server"): Promise<number | string> {
    let rows = 0
    const failure = await failureOf(asCaller(who.id, who.email).tx(async (sql) => (rows = (await query(sql)).length), session))
    if (!failure) return rows
    if (failure.code === "42501" && /row-level security/.test(failure.message)) return failure.code
    if (failure.code === "42501" && /^platform\.nodes: /.test(failure.message)) return GUARD
    return `${failure.code} ${failure.message}`
  }

  /**
   * Un nœud sous `parent` : propriétaire hérité sans `owner`, auteur Ada, publié (révision 1) sauf `revision`, à la
   * corbeille depuis `trashedDaysAgo` jours.
   */
  async function node(parent: { id: string; path: string }, options: NodeSeed = {}): Promise<{ id: string; path: string }> {
    const segment = `p${tag()}`
    const path = parent.id === root.id ? segment : `${parent.path}/${segment}`
    const { owner, revision = 1, trashedDaysAgo } = options
    const [row] = await seed.admin<{ id: string; path: string }[]>`
      insert into platform.nodes (org_id, parent_id, path, title, summary, status, revision, owner_kind, owner_team_id, owner_user_id, created_by, deleted_at)
      values (${org.id}, ${parent.id}, ${path}, 'Page', 'Une page.', ${revision > 0 ? "published" : "draft"}, ${revision},
              ${owner?.kind ?? null}, ${owner?.kind === "team" ? (owner.id ?? null) : null}, ${owner?.kind === "user" ? (owner.id ?? null) : null},
              ${options.createdBy ?? ada.id},
              ${trashedDaysAgo === undefined ? null : seed.admin`now() - make_interval(days => ${trashedDaysAgo})`})
      returning id, path`
    return row
  }

  /** Une page de l'équipe `led` sous la racine : Paul la gère (3), Marc l'écrit (2), Léa ne la voit pas (0). */
  const teamPage = () => node(root, { owner: { kind: "team", id: led } })
  /** Une page de l'organisation sous la racine : tout membre la lit (1), Ada la gère (3). */
  const orgPage = () => node(root)

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
    const [row] = await seed.admin<{ id: string; path: string }[]>`
      insert into platform.nodes (org_id, parent_id, path, title, summary, owner_kind)
      values (${org.id}, null, 'guide', 'Guide', 'Racine.', 'org') returning id, path`
    root = row
  })

  afterAll(async () => {
    await seed?.cleanup()
  })

  // Le contenu (titre, résumé, genre…) ne s'écrit plus sous une session (`20261021110000`, `role-dans-la-creation.test.ts`) :
  // le dernier auteur est la seule colonne de contenu encore accordée.
  it.each(SESSIONS)("should refuse a plain member signing a page she only reads, and let whoever writes it (session %s)", async (session) => {
    const [read, written] = [await orgPage(), await node(await teamPage())]
    const sign = (id: string, who: SeededPerson) => (sql: Tx) => sql`update platform.nodes set updated_by = ${who.id} where id = ${id} returning id`
    expect(await attempt(lea, sign(read.id, lea), session)).toBe(GUARD)
    expect(await seed.admin`select updated_by from platform.nodes where id = ${read.id}`).toEqual([{ updated_by: null }])
    expect(await attempt(marc, sign(written.id, marc), session)).toBe(1)
    expect(await seed.admin`select updated_by from platform.nodes where id = ${written.id}`).toEqual([{ updated_by: marc.id }])
  })

  it.each(SESSIONS)("should refuse trashing a page by whoever does not manage it, and let a lead trash his team's page with what is under it (session %s)", async (session) => {
    const [read, folder] = [await orgPage(), await teamPage()]
    // Sous la page de l'équipe : une sous-page de l'équipe (Marc l'écrit), une page de l'organisation (Paul la lit).
    const [written, readUnder] = [await node(folder), await node(folder, { owner: { kind: "org" } })]
    const trash = (target: { id: string; path: string }) => (sql: Tx) =>
      sql`update platform.nodes set deleted_at = now()
           where org_id = ${org.id} and deleted_at is null and (id = ${target.id} or starts_with(path, ${`${target.path}/`})) returning id`
    expect(await attempt(lea, trash(read), session)).toBe(GUARD)
    expect(await attempt(marc, trash(written), session)).toBe(GUARD)
    expect(await attempt(marc, trash(folder), session)).toBe(GUARD)
    expect(await seed.admin`select 1 from platform.nodes where id in ${seed.admin([read.id, folder.id, written.id, readUnder.id])} and deleted_at is not null`).toHaveLength(0)
    expect(await attempt(paul, trash(folder), session)).toBe(3)
    expect(await seed.admin`select count(*)::int as trashed from platform.nodes where id in ${seed.admin([folder.id, written.id, readUnder.id])} and deleted_at is not null`).toEqual([
      { trashed: 3 },
    ])
  })

  it.each(SESSIONS)("should refuse a trash date other than the clock of the database, to an administrator too (session %s)", async (session) => {
    const [live, trashed] = [await orgPage(), await node(root, { trashedDaysAgo: 1 })]
    const date = (id: string, value: string) => (sql: Tx) => sql`update platform.nodes set deleted_at = ${value}::timestamptz where id = ${id} returning id`
    expect(await attempt(ada, date(live.id, "2000-01-01T00:00:00Z"), session)).toBe(GUARD)
    expect(await attempt(ada, date(trashed.id, "2000-01-01T00:00:00Z"), session)).toBe(GUARD)
    expect(await seed.admin`select deleted_at is null as live from platform.nodes where id = ${live.id}`).toEqual([{ live: true }])
    expect(await seed.admin`select deleted_at > now() - interval '2 days' as recent from platform.nodes where id = ${trashed.id}`).toEqual([{ recent: true }])
    expect(await attempt(ada, (sql) => sql`update platform.nodes set deleted_at = now() where id = ${live.id} returning id`, session)).toBe(1)
    expect(await seed.admin`select deleted_at is not null as trashed from platform.nodes where id = ${live.id}`).toEqual([{ trashed: true }])
  })

  it.each(SESSIONS)("should refuse a plain member restoring a page she does not manage, and let an administrator restore it with what is under it (session %s)", async (session) => {
    const page = await node(root, { trashedDaysAgo: 1 })
    const [under] = await seed.admin<{ id: string }[]>`
      insert into platform.nodes (org_id, parent_id, path, title, summary, created_by, deleted_at)
      select org_id, id, path || '/sous_page', 'Sous-page', 'Une sous-page.', ${ada.id}, deleted_at from platform.nodes where id = ${page.id}
      returning id`
    const restore = (sql: Tx) =>
      sql`update platform.nodes set deleted_at = null
           where org_id = ${org.id} and deleted_at = (select deleted_at from platform.nodes where id = ${page.id})
             and (id = ${page.id} or starts_with(path, ${`${page.path}/`})) returning id`
    expect(await attempt(lea, restore, session)).toBe(GUARD)
    expect(await seed.admin`select 1 from platform.nodes where id in ${seed.admin([page.id, under.id])} and deleted_at is null`).toHaveLength(0)
    expect(await attempt(ada, restore, session)).toBe(2)
    expect(await seed.admin`select 1 from platform.nodes where id in ${seed.admin([page.id, under.id])} and deleted_at is null`).toHaveLength(2)
  })

  it.each(SESSIONS)("should keep moving to the manager and renaming to the writer, both writing the parent (session %s)", async (session) => {
    const [read, folder, other] = [await orgPage(), await teamPage(), await teamPage()]
    const [renamed, moved] = [await node(folder), await node(folder)]
    const place = (id: string, parent: { id: string; path: string }, segment: string) => (sql: Tx) =>
      sql`update platform.nodes set parent_id = ${parent.id}, path = ${parent.id === root.id ? segment : `${parent.path}/${segment}`} where id = ${id} returning id`
    expect(await attempt(lea, place(read.id, root, `r${tag()}`), session)).toBe(GUARD)
    expect(await attempt(lea, place(read.id, other, `m${tag()}`), session)).toBe(GUARD)
    expect(await attempt(marc, place(moved.id, other, `m${tag()}`), session)).toBe(GUARD)
    // Paul gère la page de son équipe, mais ne fait que lire la page de l'organisation où il la poserait.
    expect(await attempt(paul, place(moved.id, read, `m${tag()}`), session)).toBe(GUARD)
    expect(await seed.admin`select id, parent_id from platform.nodes where id in ${seed.admin([read.id, moved.id])} order by id = ${read.id}`).toEqual([
      { id: moved.id, parent_id: folder.id },
      { id: read.id, parent_id: root.id },
    ])
    const segment = `r${tag()}`
    expect(await attempt(marc, place(renamed.id, folder, segment), session)).toBe(1)
    expect(await attempt(paul, place(moved.id, other, moved.path.split("/").at(-1) ?? ""), session)).toBe(1)
    expect(await seed.admin`select id, path from platform.nodes where id in ${seed.admin([renamed.id, moved.id])} order by id = ${moved.id}`).toEqual([
      { id: renamed.id, path: `${folder.path}/${segment}` },
      { id: moved.id, path: `${other.path}/${moved.path.split("/").at(-1)}` },
    ])
  })

  it.each(SESSIONS)("should refuse changing the owner of a page by whoever does not manage it, and let its manager (session %s)", async (session) => {
    const [read, folder] = [await orgPage(), await teamPage()]
    const written = await node(folder)
    const mine = (id: string, who: SeededPerson) => (sql: Tx) =>
      sql`update platform.nodes set owner_kind = 'user', owner_team_id = null, owner_user_id = ${who.id} where id = ${id} returning id`
    expect(await attempt(lea, mine(read.id, lea), session)).toBe(GUARD)
    expect(await attempt(marc, mine(written.id, marc), session)).toBe(GUARD)
    expect(await seed.admin`select owner_kind from platform.nodes where id in ${seed.admin([read.id, written.id])}`).toEqual([{ owner_kind: null }, { owner_kind: null }])
    expect(await attempt(paul, mine(written.id, paul), session)).toBe(1)
    expect(await seed.admin`select owner_kind, owner_user_id from platform.nodes where id = ${written.id}`).toEqual([{ owner_kind: "user", owner_user_id: paul.id }])
  })

  // Ce que la base ne distingue pas : la renumérotation des frères (`positionAfter`) range des pages de tout niveau.
  it.each(SESSIONS)("should still let a member place pages among their siblings, as the renumbering of positions does (session %s)", async (session) => {
    const hidden = await teamPage()
    expect(await attempt(lea, (sql) => sql`update platform.nodes set position = 1000 where id = ${hidden.id} returning id`, session)).toBe(1)
    expect(await seed.admin`select position from platform.nodes where id = ${hidden.id}`).toEqual([{ position: 1000 }])
  })

  it.each(SESSIONS)("should refuse a plain member writing the draft of a page she only reads, and let whoever writes it (session %s)", async (session) => {
    const [read, written] = [await orgPage(), await node(await teamPage())]
    await seed.admin`insert into platform.node_drafts (node_id, base_revision, created_by) values (${read.id}, 1, ${ada.id}), (${written.id}, 1, ${ada.id})`
    const header = (id: string, who: SeededPerson) => (sql: Tx) =>
      sql`update platform.node_drafts set title = ${`Titre ${tag()}`}, updated_by = ${who.id} where node_id = ${id} returning node_id`
    expect(await attempt(lea, header(read.id, lea), session)).toBe(0)
    expect(await attempt(lea, header(written.id, lea), session)).toBe(0)
    expect(await seed.admin`select title from platform.node_drafts where node_id in ${seed.admin([read.id, written.id])}`).toEqual([{ title: null }, { title: null }])
    expect(await attempt(marc, header(written.id, marc), session)).toBe(1)
    expect(await attempt(ada, header(read.id, ada), session)).toBe(1)
    expect(await seed.admin`select updated_by from platform.node_drafts where node_id in ${seed.admin([read.id, written.id])} order by node_id = ${read.id}`).toEqual([
      { updated_by: marc.id },
      { updated_by: ada.id },
    ])
  })

  it.each(SESSIONS)("should refuse a public link created by whoever does not manage the page, and let its manager (session %s)", async (session) => {
    const [read, folder] = [await orgPage(), await teamPage()]
    const written = await node(folder)
    const share = (id: string, who: SeededPerson) => (sql: Tx) =>
      sql`insert into platform.node_shares (org_id, node_id, token, created_by) values (${org.id}, ${id}, ${token()}, ${who.id}) returning id`
    expect(await attempt(lea, share(read.id, lea), session)).toBe("42501")
    expect(await attempt(marc, share(written.id, marc), session)).toBe("42501")
    expect(await seed.admin`select 1 from platform.node_shares where node_id in ${seed.admin([read.id, written.id])}`).toHaveLength(0)
    expect(await attempt(paul, share(written.id, paul), session)).toBe(1)
    expect(await seed.admin`select created_by from platform.node_shares where node_id = ${written.id}`).toEqual([{ created_by: paul.id }])
  })

  it.each(SESSIONS)("should refuse a public link changed or revoked by whoever does not manage the page, and let its manager or an administrator (session %s)", async (session) => {
    const written = await node(await teamPage())
    const link = async () => {
      const [row] = await seed.admin<{ id: string }[]>`
        insert into platform.node_shares (org_id, node_id, token, created_by) values (${org.id}, ${written.id}, ${token()}, ${paul.id}) returning id`
      return row.id
    }
    const widen = (id: string, who: SeededPerson) => (sql: Tx) =>
      sql`update platform.node_shares set include_children = true, created_by = ${who.id} where id = ${id} and revoked_at is null returning id`
    const revoke = (id: string) => (sql: Tx) => sql`update platform.node_shares set revoked_at = now() where id = ${id} and revoked_at is null returning id`
    const first = await link()
    expect(await attempt(lea, widen(first, lea), session)).toBe(0)
    expect(await attempt(marc, widen(first, marc), session)).toBe(0)
    expect(await attempt(lea, revoke(first), session)).toBe(0)
    expect(await attempt(marc, revoke(first), session)).toBe(0)
    expect(await seed.admin`select include_children, created_by, revoked_at from platform.node_shares where id = ${first}`).toEqual([
      { include_children: false, created_by: paul.id, revoked_at: null },
    ])
    expect(await attempt(paul, widen(first, paul), session)).toBe(1)
    expect(await attempt(ada, revoke(first), session)).toBe(1)
    // Désactivé, le lien ne se rallume pas.
    expect(await attempt(paul, (sql) => sql`update platform.node_shares set revoked_at = null where id = ${first} returning id`, session)).toBe(0)
    const second = await link()
    expect(await attempt(paul, revoke(second), session)).toBe(1)
    expect(await seed.admin`select include_children, revoked_at is not null as revoked from platform.node_shares where id in ${seed.admin([first, second])} order by id = ${second}`).toEqual([
      { include_children: true, revoked: true },
      { include_children: false, revoked: true },
    ])
  })

  it.each(SESSIONS)("should refuse a sent draft sent back to draft, and let a member send a draft in her own name (session %s)", async (session) => {
    const [account] = await seed.admin<{ id: string }[]>`
      insert into platform.accounts (org_id, connector, owner_kind, label, mode) values (${org.id}, 'mail', 'org', ${`compte ${tag()}`}, 'simule') returning id`
    const draft = async (sent: boolean) => {
      const [row] = await seed.admin<{ id: string }[]>`
        insert into platform.sim_outbox (org_id, account_id, connector, function, payload, created_by, status, sent_by, sent_at)
        values (${org.id}, ${account.id}, 'mail', 'mail.create_draft', '{}'::jsonb, ${ada.id}, ${sent ? "sent" : "draft"}, ${sent ? ada.id : null}, ${sent ? new Date() : null})
        returning id`
      return row.id
    }
    const [sent, open] = [await draft(true), await draft(false)]
    expect(await attempt(lea, (sql) => sql`update platform.sim_outbox set status = 'draft', sent_by = null, sent_at = null where id = ${sent} returning id`, session)).toBe(0)
    expect(await attempt(lea, (sql) => sql`update platform.sim_outbox set sent_by = ${lea.id} where id = ${open} returning id`, session)).toBe("42501")
    expect(await seed.admin`select status, sent_by from platform.sim_outbox where id in ${seed.admin([sent, open])} order by id = ${open}`).toEqual([
      { status: "sent", sent_by: ada.id },
      { status: "draft", sent_by: null },
    ])
    expect(await attempt(lea, (sql) => sql`update platform.sim_outbox set status = 'sent', sent_by = ${lea.id}, sent_at = now() where id = ${open} and status = 'draft' returning id`, session)).toBe(1)
    expect(await seed.admin`select status, sent_by from platform.sim_outbox where id = ${open}`).toEqual([{ status: "sent", sent_by: lea.id }])
  })

  it.each(SESSIONS)("should refuse deleting a live page or one trashed lately, and let the purge, the administrator and the undoing of a creation (session %s)", async (session) => {
    const remove = (id: string) => (sql: Tx) => sql`delete from platform.nodes where id = ${id} returning id`
    const [live, lately, teamLately] = [await orgPage(), await node(root, { trashedDaysAgo: 1 }), await node(root, { owner: { kind: "team", id: led }, trashedDaysAgo: 1 })]
    expect(await attempt(lea, remove(live.id), session)).toBe(0)
    expect(await attempt(lea, remove(lately.id), session)).toBe(0)
    // Gérer une page ne la supprime pas : la corbeille la garde 30 jours.
    expect(await attempt(paul, remove(teamLately.id), session)).toBe(0)
    expect(await seed.admin`select 1 from platform.nodes where id in ${seed.admin([live.id, lately.id, teamLately.id])}`).toHaveLength(3)
    const [expired, created, published] = [
      await node(root, { trashedDaysAgo: 31 }),
      await node(root, { createdBy: lea.id, revision: 0 }),
      await node(root, { createdBy: lea.id, revision: 1 }),
    ]
    expect(await attempt(lea, remove(published.id), session)).toBe(0)
    expect(await attempt(lea, remove(expired.id), session)).toBe(1)
    expect(await attempt(lea, remove(created.id), session)).toBe(1)
    expect(await attempt(ada, remove(lately.id), session)).toBe(1)
    expect(await seed.admin`select id from platform.nodes where id in ${seed.admin([expired.id, created.id, lately.id, published.id])}`).toEqual([{ id: published.id }])
  })

  it.each(SESSIONS)("should refuse a plain member excluding another member from the open entry, and let an administrator (session %s)", async (session) => {
    const exclude = (who: SeededPerson, person: SeededPerson) => (sql: Tx) =>
      sql`insert into platform.member_exclusions (org_id, user_id, excluded_by) values (${org.id}, ${person.id}, ${who.id}) returning user_id`
    const [refused, excluded] = [seed.person(), seed.person()]
    expect(await attempt(lea, exclude(lea, refused), session)).toBe("42501")
    expect(await seed.admin`select 1 from platform.member_exclusions where org_id = ${org.id} and user_id = ${refused.id}`).toHaveLength(0)
    expect(await attempt(ada, exclude(ada, excluded), session)).toBe(1)
    expect(await seed.admin`select excluded_by from platform.member_exclusions where org_id = ${org.id} and user_id = ${excluded.id}`).toEqual([{ excluded_by: ada.id }])
  })
})
