// @vitest-environment node
// Les commentaires d'une page sous un jeton, en SQL direct (migration `20261112090000`, doctrine du rôle en base). Avec
// son seul jeton, un membre ne lit les fils et les commentaires que d'une page qu'il lit, hors corbeille ; il n'ouvre un
// fil et ne commente que pour lui-même, sur une page qu'il lit ; l'état d'un fil se change par son auteur ou par qui écrit
// la page, qui ne nomme que lui-même comme « résolu par » ; un commentaire ne se modifie et ne se supprime que par son
// auteur, administrateur compris, et plus du tout sur une page qu'il ne lit plus ; un fil ne se supprime que par son
// auteur, ses réponses avec lui. Sous sa session comme sous celle du serveur, qui juge la même personne. Une ligne écartée
// par une policy rend zéro ligne ; un `with check` refusé lève 42501 ; une colonne non accordée aussi, sans la policy.
import { afterAll, describe, expect, it } from "vitest"
import type { Tx } from "../../packages/plateforme/server/sql"
import { pendingMigrations, pendingReason } from "../helpers/pending-migrations"
import { asCaller, failureOf, seedWithAdmin, SQL_SKIP_REASON, sqlConfigured, type SeededOrg, type SeededPerson } from "../helpers/sql"

const VERSION = "20261113180000"
const pending = (await pendingMigrations()).includes(VERSION)

const suite = !sqlConfigured
  ? `the comments of a page under a token (${SQL_SKIP_REASON})`
  : pending
    ? `the comments of a page under a token (${pendingReason([VERSION])})`
    : "the comments of a page under a token: read and written by who reads the page, each comment kept to its author"

/** Les deux sessions d'une personne : la sienne, et celle du serveur, aux mêmes claims. */
const SESSIONS = [undefined, "server"] as const

const tag = () => Math.random().toString(16).slice(2, 8)

type Page = { id: string; path: string }

/**
 * Une organisation jetable : Ada l'administre ; Léa, membre simple, hors de l'équipe ; Paul, responsable de l'équipe
 * `led` ; Marc, membre de `led`. `closed`, une page de `led` (Léa ne la voit pas, Marc l'écrit) ; `open`, une page de
 * l'organisation (tout membre la lit, Ada seule l'écrit) ; `trashed`, une page de l'organisation à la corbeille.
 */
type World = { org: SeededOrg; ada: SeededPerson; lea: SeededPerson; paul: SeededPerson; marc: SeededPerson; closed: Page; open: Page; trashed: Page }

describe.skipIf(!sqlConfigured || pending)(suite, () => {
  const seed = seedWithAdmin()

  afterAll(async () => {
    await seed.cleanup()
  })

  /**
   * Le résultat d'une instruction sous la session de `who` : le nombre de lignes rendues, `42501` pour le refus d'une
   * policy, ou le code et le message de toute autre erreur (un droit de colonne refusé lève aussi 42501, sans la policy).
   */
  async function attempt(who: SeededPerson, query: (sql: Tx) => PromiseLike<readonly unknown[]>, session?: "server"): Promise<number | string> {
    let rows = 0
    const failure = await failureOf(asCaller(who.id, who.email).tx(async (sql) => (rows = (await query(sql)).length), session))
    if (!failure) return rows
    if (failure.code === "42501" && /row-level security/.test(failure.message)) return failure.code
    return `${failure.code} ${failure.message}`
  }

  async function world(): Promise<World> {
    const org = await seed.createOrg()
    const [root] = await seed.admin<Page[]>`
      insert into platform.nodes (org_id, parent_id, path, title, summary, owner_kind)
      values (${org.id}, null, 'guide', 'Guide', 'Racine.', 'org') returning id, path`
    await seed.admin`insert into platform.nodes (org_id, parent_id, path, title, summary) values (${org.id}, ${root.id}, 'private', 'Espaces personnels', 'Un espace par personne.')`
    const [ada, lea, paul, marc] = [seed.person(), seed.person(), seed.person(), seed.person()]
    await seed.addMember(org.id, ada, "admin")
    for (const person of [lea, paul, marc]) await seed.addMember(org.id, person)
    const slug = `e${tag()}`
    const [team] = await seed.admin<{ id: string }[]>`insert into platform.teams (org_id, slug, name) values (${org.id}, ${slug}, ${`Équipe ${slug}`}) returning id`
    await seed.admin`insert into platform.team_members (team_id, user_id, role) values (${team.id}, ${paul.id}, 'lead'), (${team.id}, ${marc.id}, 'member')`
    const node = async (options: { team?: string; trashed?: boolean } = {}): Promise<Page> => {
      const [row] = await seed.admin<Page[]>`
        insert into platform.nodes (org_id, parent_id, path, kind, title, summary, status, revision, owner_kind, owner_team_id, created_by, deleted_at)
        values (${org.id}, ${root.id}, ${`p${tag()}`}, 'page', 'Page', 'Une page.', 'published', 1, ${options.team ? "team" : null}, ${options.team ?? null}, ${ada.id},
                ${options.trashed ? seed.admin`now()` : null})
        returning id, path`
      return row
    }
    return { org, ada, lea, paul, marc, closed: await node({ team: team.id }), open: await node(), trashed: await node({ trashed: true }) }
  }

  /** Un fil de `author` sur `page` et son premier commentaire, posés par la connexion d'administration. */
  async function thread(w: World, page: Page, author: SeededPerson): Promise<{ id: string; comment: string }> {
    const [row] = await seed.admin<{ id: string }[]>`insert into platform.comment_threads (org_id, node_id, created_by) values (${w.org.id}, ${page.id}, ${author.id}) returning id`
    return { id: row.id, comment: await comment(w, row.id, author) }
  }

  /** Un commentaire de `author` dans un fil, posé par la connexion d'administration. */
  async function comment(w: World, threadId: string, author: SeededPerson): Promise<string> {
    const [row] = await seed.admin<{ id: string }[]>`
      insert into platform.comments (org_id, thread_id, author, text) values (${w.org.id}, ${threadId}, ${author.id}, 'Un commentaire.') returning id`
    return row.id
  }

  /** Les fils et les commentaires de l'organisation, relus par la connexion d'administration. */
  async function left(w: World): Promise<{ threads: number; comments: number }> {
    const [row] = await seed.admin<{ threads: number; comments: number }[]>`
      select (select count(*)::int from platform.comment_threads where org_id = ${w.org.id}) as threads,
             (select count(*)::int from platform.comments where org_id = ${w.org.id}) as comments`
    return row
  }

  it.each(SESSIONS)("should show the threads and the comments of the pages the member reads only, none of a trashed page (session %s)", async (session) => {
    const w = await world()
    const closed = await thread(w, w.closed, w.paul)
    await thread(w, w.open, w.paul)
    await thread(w, w.trashed, w.ada)
    const threads = (sql: Tx) => sql`select id from platform.comment_threads where org_id = ${w.org.id}`
    const comments = (sql: Tx) => sql`select id from platform.comments where org_id = ${w.org.id}`
    expect({
      lea: [await attempt(w.lea, threads, session), await attempt(w.lea, comments, session)],
      leaOnClosed: await attempt(w.lea, (sql) => sql`select text from platform.comments where thread_id = ${closed.id}`, session),
      marc: [await attempt(w.marc, threads, session), await attempt(w.marc, comments, session)],
      ada: [await attempt(w.ada, threads, session), await attempt(w.ada, comments, session)],
    }).toEqual({ lea: [1, 1], leaOnClosed: 0, marc: [2, 2], ada: [2, 2] })
  })

  it.each(SESSIONS)("should let a member open a thread and comment for herself on a page she reads, and refuse any other writing (session %s)", async (session) => {
    const w = await world()
    const closed = await thread(w, w.closed, w.paul)
    const open = await thread(w, w.open, w.paul)
    const openThread = (page: Page, author: SeededPerson) => (sql: Tx) => sql`
      insert into platform.comment_threads (org_id, node_id, created_by) values (${w.org.id}, ${page.id}, ${author.id}) returning id`
    const write = (threadId: string, author: SeededPerson) => (sql: Tx) => sql`
      insert into platform.comments (org_id, thread_id, author, text) values (${w.org.id}, ${threadId}, ${author.id}, 'Sous un jeton.') returning id`
    expect({
      threadOnClosed: await attempt(w.lea, openThread(w.closed, w.lea), session),
      threadOnTrashed: await attempt(w.lea, openThread(w.trashed, w.lea), session),
      threadForPaul: await attempt(w.lea, openThread(w.open, w.paul), session),
      threadResolved: await attempt(w.lea, (sql) => sql`insert into platform.comment_threads (org_id, node_id, created_by, status) values (${w.org.id}, ${w.open.id}, ${w.lea.id}, 'resolved') returning id`, session),
      commentOnClosed: await attempt(w.lea, write(closed.id, w.lea), session),
      commentForPaul: await attempt(w.lea, write(open.id, w.paul), session),
      // Ce que le service fait passe : son fil et son commentaire sur une page qu'elle lit.
      ownThread: await attempt(w.lea, openThread(w.open, w.lea), session),
      ownComment: await attempt(w.lea, write(open.id, w.lea), session),
    }).toEqual({
      threadOnClosed: "42501",
      threadOnTrashed: "42501",
      threadForPaul: "42501",
      threadResolved: expect.stringMatching(/^42501 permission denied/),
      commentOnClosed: "42501",
      commentForPaul: "42501",
      ownThread: 1,
      ownComment: 1,
    })
    expect(await left(w)).toEqual({ threads: 3, comments: 3 })
  })

  it.each(SESSIONS)("should let the author of a thread or a writer of the page change its status, naming herself only, and nothing else of the thread (session %s)", async (session) => {
    const w = await world()
    const ofPaul = await thread(w, w.open, w.paul)
    const ofLea = await thread(w, w.open, w.lea)
    const onClosed = await thread(w, w.closed, w.paul)
    const resolve = (threadId: string, by: SeededPerson) => (sql: Tx) => sql`
      update platform.comment_threads set status = 'resolved', resolved_by = ${by.id}, resolved_at = now() where id = ${threadId} returning id`
    expect({
      // Léa lit la page sans l'écrire : le fil de Paul lui échappe, le sien non ; elle ne nomme qu'elle.
      readerOnAnother: await attempt(w.lea, resolve(ofPaul.id, w.lea), session),
      authorNamingAnother: await attempt(w.lea, resolve(ofLea.id, w.paul), session),
      author: await attempt(w.lea, resolve(ofLea.id, w.lea), session),
      // Marc écrit la page de son équipe, Ada celle de l'organisation : le fil d'un autre se résout.
      writer: await attempt(w.marc, resolve(onClosed.id, w.marc), session),
      administrator: await attempt(w.ada, resolve(ofPaul.id, w.ada), session),
      quote: await attempt(w.lea, (sql) => sql`update platform.comment_threads set quote = 'Réécrit.' where id = ${ofLea.id} returning id`, session),
      move: await attempt(w.ada, (sql) => sql`update platform.comment_threads set node_id = ${w.closed.id} where id = ${ofPaul.id} returning id`, session),
    }).toEqual({
      readerOnAnother: 0,
      authorNamingAnother: "42501",
      author: 1,
      writer: 1,
      administrator: 1,
      quote: expect.stringMatching(/^42501 permission denied/),
      move: expect.stringMatching(/^42501 permission denied/),
    })
    expect(await seed.admin`select id, resolved_by from platform.comment_threads where org_id = ${w.org.id} order by created_at, id`).toEqual([
      { id: ofPaul.id, resolved_by: w.ada.id },
      { id: ofLea.id, resolved_by: w.lea.id },
      { id: onClosed.id, resolved_by: w.marc.id },
    ])
  })

  it.each(SESSIONS)("should keep the text and the deletion of a comment to its author, administrator and writers excluded, and to a page she still reads (session %s)", async (session) => {
    const w = await world()
    const ofPaul = await thread(w, w.closed, w.paul)
    // Un commentaire de Léa du temps où elle lisait la page fermée.
    const former = await comment(w, ofPaul.id, w.lea)
    const edit = (id: string) => (sql: Tx) => sql`update platform.comments set text = 'Réécrit.', edited_at = now() where id = ${id} returning id`
    const remove = (id: string) => (sql: Tx) => sql`delete from platform.comments where id = ${id} returning id`
    expect({
      writerEdits: await attempt(w.marc, edit(ofPaul.comment), session),
      administratorEdits: await attempt(w.ada, edit(ofPaul.comment), session),
      writerRemoves: await attempt(w.marc, remove(ofPaul.comment), session),
      administratorRemoves: await attempt(w.ada, remove(ofPaul.comment), session),
      formerReaderEdits: await attempt(w.lea, edit(former), session),
      formerReaderRemoves: await attempt(w.lea, remove(former), session),
      author: await attempt(w.paul, (sql) => sql`update platform.comments set author = ${w.marc.id} where id = ${ofPaul.comment} returning id`, session),
      authorEdits: await attempt(w.paul, edit(ofPaul.comment), session),
    }).toEqual({
      writerEdits: 0,
      administratorEdits: 0,
      writerRemoves: 0,
      administratorRemoves: 0,
      formerReaderEdits: 0,
      formerReaderRemoves: 0,
      author: expect.stringMatching(/^42501 permission denied/),
      authorEdits: 1,
    })
    expect(await left(w)).toEqual({ threads: 1, comments: 2 })
    expect(await attempt(w.paul, remove(ofPaul.comment), session)).toBe(1)
    expect(await left(w)).toEqual({ threads: 1, comments: 1 })
  })

  it.each(SESSIONS)("should let the author of a thread alone delete it, its replies leaving with it (session %s)", async (session) => {
    const w = await world()
    const ofPaul = await thread(w, w.open, w.paul)
    await comment(w, ofPaul.id, w.lea)
    const remove = (sql: Tx) => sql`delete from platform.comment_threads where id = ${ofPaul.id} returning id`
    expect([await attempt(w.lea, remove, session), await attempt(w.ada, remove, session), await left(w)]).toEqual([0, 0, { threads: 1, comments: 2 }])
    expect([await attempt(w.paul, remove, session), await left(w)]).toEqual([1, { threads: 0, comments: 0 }])
  })
})
