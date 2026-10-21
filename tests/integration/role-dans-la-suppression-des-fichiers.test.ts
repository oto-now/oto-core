// @vitest-environment node
// La suppression d'une ligne de fichier (migration `20261021170000`, suite de `20261021140000`, doctrine « le rôle en
// base, partout » décidée par Alexis le 20/10 ; issue #81). `files_delete_member` laissait supprimer la ligne d'un
// fichier joint à tout membre qui la voit : avec son seul jeton, en SQL direct, la lectrice d'une page d'équipe (niveau
// 1) effaçait la ligne d'un fichier qui y est joint et laissait son objet orphelin. La policy exige désormais l'écriture
// (`node_level_for` >= 2) sur le nœud d'un fichier joint ; un fichier en transit ne se supprime que par son auteur, comme
// avant. La purge des envois abandonnés (`purgePendingFiles`), qui comptait sur la policy large, passe par une fonction
// `security definer`, `purge_pending_files` : tout membre, les lignes `pending` de plus d'une heure de l'organisation,
// délai fixé en base, sur toute page, lue ou non par l'appelant, plus ses propres envois en transit ; elle ne rend que
// les identifiants. Sous sa session comme sous celle du serveur, qui juge la même personne. Une suppression écartée par
// la policy rend zéro ligne ; une fonction refusée lève 42501.
import { afterAll, afterEach, describe, expect, it, vi } from "vitest"
import { listTrash, resolveIdentity, type PlatformDb } from "@otomata_tech/oto_platform/server"
import { memoryFileStore, type MemoryFileStore } from "../../packages/plateforme/server/files/memory"
import { objectKey } from "../../packages/plateforme/server/files/store"
import type { Tx } from "../../packages/plateforme/server/sql"
import { pendingMigrations, pendingReason } from "../helpers/pending-migrations"
import { asCaller, failureOf, seedWithAdmin, SQL_SKIP_REASON, sqlConfigured, type SeededOrg, type SeededPerson } from "../helpers/sql"

// Le bucket du test, à la place de `fileStore()` : la purge en retire les objets des fichiers qu'elle rend.
const storage = vi.hoisted(() => ({ store: null as MemoryFileStore | null }))

vi.mock("../../packages/plateforme/server/files/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../packages/plateforme/server/files/store")>()),
  fileStore: () => storage.store,
}))

const VERSION = "20261021170000"
const pending = (await pendingMigrations()).includes(VERSION)

const suite = !sqlConfigured
  ? `the deletion of a file row (${SQL_SKIP_REASON})`
  : pending
    ? `the deletion of a file row (${pendingReason([VERSION])})`
    : "the deletion of a file row: an attached file by whoever writes its node, a transit file by its author, the abandoned uploads by any member through the base"

/** Les deux sessions d'une personne : la sienne, et celle du serveur, aux mêmes claims. */
const SESSIONS = [undefined, "server"] as const

const HOUR_MS = 3_600_000

const tag = () => Math.random().toString(16).slice(2, 8)

type Page = { id: string; path: string }

/**
 * Une organisation jetable : Ada l'administre ; Léa, membre simple hors de l'équipe `led`, lectrice nommée de la page
 * `read` (niveau 1) ; Zoé, membre simple hors de l'équipe, rédactrice nommée de la même page (niveau 2) ; Paul, membre,
 * responsable de `led` et propriétaire de son espace personnel. `page` est une page de l'équipe `led`.
 */
type World = { org: SeededOrg; ada: SeededPerson; lea: SeededPerson; zoe: SeededPerson; paul: SeededPerson; page: Page; space: Page }

describe.skipIf(!sqlConfigured || pending)(suite, () => {
  const seed = seedWithAdmin()

  afterEach(() => {
    storage.store = null
  })

  afterAll(async () => {
    await seed.cleanup()
  })

  /**
   * Le résultat d'une instruction sous la session de `who` (la sienne, ou celle du serveur) : le nombre de lignes rendues,
   * ou le code et le message d'une erreur.
   */
  async function attempt(who: SeededPerson, query: (sql: Tx) => PromiseLike<readonly unknown[]>, session?: "server"): Promise<number | string> {
    let rows = 0
    const failure = await failureOf(asCaller(who.id, who.email).tx(async (sql) => (rows = (await query(sql)).length), session))
    return failure ? `${failure.code} ${failure.message}` : rows
  }

  /** Les lignes d'une instruction sous la session de `who` ; une erreur est levée. */
  async function rowsAs<T>(who: SeededPerson, query: (sql: Tx) => PromiseLike<readonly T[]>, session?: "server"): Promise<T[]> {
    return asCaller(who.id, who.email).tx(async (sql) => [...(await query(sql))], session)
  }

  async function world(): Promise<World> {
    const org = await seed.createOrg()
    const [root] = await seed.admin<Page[]>`
      insert into platform.nodes (org_id, parent_id, path, title, summary, owner_kind)
      values (${org.id}, null, 'guide', 'Guide', 'Racine.', 'org') returning id, path`
    const [folder] = await seed.admin<Page[]>`
      insert into platform.nodes (org_id, parent_id, path, title, summary)
      values (${org.id}, ${root.id}, 'private', 'Espaces personnels', 'Un espace par personne.') returning id, path`
    const [ada, lea, zoe, paul] = [seed.person(), seed.person(), seed.person(), seed.person()]
    await seed.addMember(org.id, ada, "admin")
    for (const person of [lea, zoe, paul]) await seed.addMember(org.id, person)
    const slug = `e${tag()}`
    const [team] = await seed.admin<{ id: string }[]>`insert into platform.teams (org_id, slug, name) values (${org.id}, ${slug}, ${`Équipe ${slug}`}) returning id`
    await seed.admin`insert into platform.team_members (team_id, user_id, role) values (${team.id}, ${paul.id}, 'lead')`
    const [page] = await seed.admin<Page[]>`
      insert into platform.nodes (org_id, parent_id, path, kind, title, summary, status, revision, owner_kind, owner_team_id, created_by)
      values (${org.id}, ${root.id}, ${`p${tag()}`}, 'page', 'Page', 'Une page.', 'published', 1, 'team', ${team.id}, ${ada.id})
      returning id, path`
    await seed.admin`
      insert into platform.access_rules (org_id, node_id, subject_user_id, level, created_by)
      values (${org.id}, ${page.id}, ${lea.id}, 'read', ${ada.id}), (${org.id}, ${page.id}, ${zoe.id}, 'write', ${ada.id})`
    const [space] = await seed.admin<Page[]>`
      select id, path from platform.nodes where org_id = ${org.id} and parent_id = ${folder.id} and owner_kind = 'user' and owner_user_id = ${paul.id}`
    return { org, ada, lea, zoe, paul, page, space }
  }

  /**
   * Une ligne `files` posée par la connexion d'administration : jointe à `page`, ou en transit sans page ; `ready` par
   * défaut ; créée il y a `hoursAgo` heures (échue 24 heures après, en transit) ; par `author` (Ada par défaut) ; et son objet dans le bucket du test s'il y en a un.
   */
  async function file(
    w: World,
    options: { page?: Page | null; status?: "ready" | "pending"; hoursAgo?: number; author?: SeededPerson; org?: SeededOrg } = {},
  ): Promise<string> {
    const org = options.org ?? w.org
    const page = options.page === undefined ? w.page : options.page
    const createdAt = new Date(Date.now() - (options.hoursAgo ?? 0) * HOUR_MS)
    const [row] = await seed.admin<{ id: string }[]>`
      insert into platform.files (org_id, node_id, name, mime, size, status, created_by, created_at, expires_at)
      values (${org.id}, ${page?.id ?? null}, 'bilan.pdf', 'application/pdf', 1024, ${options.status ?? "ready"}, ${(options.author ?? w.ada).id}, ${createdAt},
              ${page ? null : new Date(createdAt.getTime() + 24 * HOUR_MS)})
      returning id`
    storage.store?.objects.set(objectKey(org.id, row.id), { bytes: new TextEncoder().encode("%PDF"), mime: "application/pdf" })
    return row.id
  }

  /** Les fichiers qui restent en base parmi ceux donnés, lus par la connexion d'administration. */
  async function remaining(files: string[]): Promise<string[]> {
    return (await seed.admin<{ id: string }[]>`select id from platform.files where id in ${seed.admin(files)}`).map((row) => row.id).sort()
  }

  const deleteFile = (id: string) => (sql: Tx) => sql`delete from platform.files where id = ${id} returning id`

  it.each(SESSIONS)("should let only whoever writes its node delete the row of an attached file: a reader (level 1) deletes nothing (session %s)", async (session) => {
    const w = await world()
    const levelOn = (who: SeededPerson) =>
      rowsAs(who, (sql) => sql<{ level: number }[]>`
        select platform.node_level_for(n.org_id, n.lpath, n.owner_kind, n.owner_team_id, n.owner_user_id) as level from platform.nodes n where n.id = ${w.page.id}`, session)
    expect({ lea: (await levelOn(w.lea))[0].level, zoe: (await levelOn(w.zoe))[0].level }).toEqual({ lea: 1, zoe: 2 })
    const [ready, pendingFile] = [await file(w), await file(w, { status: "pending" })]
    // Léa lit la page et voit ses fichiers, mais ne les supprime pas.
    expect(await attempt(w.lea, (sql) => sql`select id from platform.files where id in ${sql([ready, pendingFile])}`, session)).toBe(2)
    expect({ ready: await attempt(w.lea, deleteFile(ready), session), pending: await attempt(w.lea, deleteFile(pendingFile), session) }).toEqual({ ready: 0, pending: 0 })
    expect(await remaining([ready, pendingFile])).toEqual([ready, pendingFile].sort())
    // Zoé écrit la page : elle les supprime.
    expect({ ready: await attempt(w.zoe, deleteFile(ready), session), pending: await attempt(w.zoe, deleteFile(pendingFile), session) }).toEqual({ ready: 1, pending: 1 })
    expect(await remaining([ready, pendingFile])).toEqual([])
  })

  it.each(SESSIONS)("should let only its author delete a transit file, not an administrator nor another member (session %s)", async (session) => {
    const w = await world()
    const transit = await file(w, { page: null, author: w.lea })
    expect({ ada: await attempt(w.ada, deleteFile(transit), session), zoe: await attempt(w.zoe, deleteFile(transit), session) }).toEqual({ ada: 0, zoe: 0 })
    expect(await remaining([transit])).toEqual([transit])
    expect(await attempt(w.lea, deleteFile(transit), session)).toBe(1)
    expect(await remaining([transit])).toEqual([])
  })

  it.each(SESSIONS)("should purge for any member the pending rows of more than an hour of every page, read or not, and her own pending transit files, and return their ids (session %s)", async (session) => {
    const w = await world()
    const elsewhere = await world()
    // Purgées : un envoi abandonné sur la page d'équipe (Léa n'y a que le niveau 1), dans l'espace de Paul (Léa ne le voit
    // pas), et l'envoi en transit abandonné de Léa.
    const gone = [
      await file(w, { status: "pending", hoursAgo: 2 }),
      await file(w, { page: w.space, status: "pending", hoursAgo: 3, author: w.paul }),
      await file(w, { page: null, status: "pending", hoursAgo: 2, author: w.lea }),
    ]
    // Gardées : un envoi de moins d'une heure, un fichier `ready` ancien, l'envoi en transit abandonné d'un autre (sa
    // purge à lui est `purge_transit_files`, à l'échéance), l'envoi abandonné d'une autre organisation.
    const kept = [
      await file(w, { status: "pending", hoursAgo: 0.5 }),
      await file(w, { status: "ready", hoursAgo: 5 }),
      await file(w, { page: null, status: "pending", hoursAgo: 2, author: w.zoe }),
      await file(elsewhere, { status: "pending", hoursAgo: 2 }),
    ]
    const purged = await rowsAs(w.lea, (sql) => sql<{ id: string }[]>`select id from platform.purge_pending_files(${w.org.id}) as id`, session)
    expect(purged.map((row) => row.id).sort()).toEqual([...gone].sort())
    expect(await remaining([...gone, ...kept])).toEqual([...kept].sort())
  })

  it.each(SESSIONS)("should refuse the purge of the abandoned uploads of an organisation to whoever is not its member (session %s)", async (session) => {
    const w = await world()
    const elsewhere = await world()
    const stale = await file(w, { status: "pending", hoursAgo: 2 })
    const purge = (sql: Tx) => sql`select id from platform.purge_pending_files(${w.org.id}) as id`
    expect({ outsider: await attempt(elsewhere.lea, purge, session), admin: await attempt(elsewhere.ada, purge, session) }).toEqual({
      outsider: expect.stringMatching(/^42501 /),
      admin: expect.stringMatching(/^42501 /),
    })
    expect(await remaining([stale])).toEqual([stale])
  })

  /** La base d'une personne pour un service, sous sa session ou celle du serveur. */
  const dbOf = (who: SeededPerson, session?: "server"): PlatformDb => {
    const db = asCaller(who.id, who.email)
    return { tx: (fn) => db.tx(fn, session) }
  }

  it.each(SESSIONS)("should purge, from the trash screen of a plain member, the abandoned uploads of pages she cannot write, objects included (session %s)", async (session) => {
    storage.store = memoryFileStore()
    const w = await world()
    const gone = [await file(w, { status: "pending", hoursAgo: 2 }), await file(w, { page: w.space, status: "pending", hoursAgo: 2, author: w.paul })]
    const kept = await file(w, { status: "pending", hoursAgo: 0.1 })
    const db = dbOf(w.lea, session)
    const identity = await resolveIdentity(db, w.org.host, { userId: w.lea.id, email: w.lea.email })
    await listTrash(db, identity)
    expect(await remaining([...gone, kept])).toEqual([kept])
    expect([...gone, kept].map((id) => storage.store?.objects.has(objectKey(w.org.id, id)))).toEqual([false, false, true])
  })
})
