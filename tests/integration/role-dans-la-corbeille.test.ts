// @vitest-environment node
// La lecture des fichiers d'une page à la corbeille, et sa purge (migration `20261021140000`, suite de `20261021130000`,
// décision d'Alexis du 20/10 : le rôle en base, partout). Avec son seul jeton, en SQL direct, un membre simple ne lit plus
// le fichier joint d'une page qui lui est cachée (l'espace personnel d'un autre, une page d'équipe fermée) quand elle est à
// la corbeille : la règle de la lecture du nœud (`node_level_for` >= 1) vaut aussi à la corbeille. La purge, qui lisait
// ces fichiers sous la session de qui ouvre la corbeille, passe par deux fonctions `security definer` : `purge_trash`
// (`purgeTrash`, une rétention de l'organisation, tout membre, au-delà de 30 jours) et `erase_team_trash`
// (`eraseTrashedNodes` pour `deleteTeam`, l'administrateur, toute page de l'équipe à la corbeille). Chacune supprime les
// nœuds et les fichiers de toutes les pages qu'elle vise, lues ou non par l'appelant, et rend les identifiants des
// fichiers, dont les objets partent ensuite du stockage. Sous sa session comme sous celle du serveur, qui juge la même
// personne. Une lecture écartée par la policy rend zéro ligne ; une fonction refusée lève 42501.
import { afterAll, afterEach, describe, expect, it, vi } from "vitest"
import { deleteTeam, listTrash, resolveIdentity, type PlatformDb } from "@otomata_tech/oto_platform/server"
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

const VERSION = "20261021140000"
const pending = (await pendingMigrations()).includes(VERSION)

const suite = !sqlConfigured
  ? `the files of a page in the trash, and its purge (${SQL_SKIP_REASON})`
  : pending
    ? `the files of a page in the trash, and its purge (${pendingReason([VERSION])})`
    : "the files of a page in the trash, and its purge: a plain member reads none she may not, the purge removes every page it targets, read or not"

/** Les deux sessions d'une personne : la sienne, et celle du serveur, aux mêmes claims. */
const SESSIONS = [undefined, "server"] as const

const DAY_MS = 86_400_000

const tag = () => Math.random().toString(16).slice(2, 8)

type Page = { id: string; path: string }
type Team = { id: string; slug: string; folder: Page }

/**
 * Une organisation jetable : Ada l'administre ; Léa, membre simple, hors des équipes ; Paul, membre, responsable de
 * l'équipe `led` et propriétaire de son espace personnel ; Marc, membre de `led`. `other`, une seconde équipe, sans
 * membre.
 */
type World = {
  org: SeededOrg
  ada: SeededPerson
  lea: SeededPerson
  paul: SeededPerson
  marc: SeededPerson
  led: Team
  other: Team
  root: Page
  /** L'espace personnel de Paul. */
  space: Page
}

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
   * `42501` pour le refus d'une policy, ou le code et le message de toute autre erreur.
   */
  async function attempt(who: SeededPerson, query: (sql: Tx) => PromiseLike<readonly unknown[]>, session?: "server"): Promise<number | string> {
    let rows = 0
    const failure = await failureOf(asCaller(who.id, who.email).tx(async (sql) => (rows = (await query(sql)).length), session))
    if (!failure) return rows
    if (failure.code === "42501" && /row-level security/.test(failure.message)) return failure.code
    return `${failure.code} ${failure.message}`
  }

  /** Les lignes d'une instruction sous la session de `who` ; une erreur est levée. */
  async function rowsAs<T>(who: SeededPerson, query: (sql: Tx) => PromiseLike<readonly T[]>, session?: "server"): Promise<T[]> {
    return asCaller(who.id, who.email).tx(async (sql) => [...(await query(sql))], session)
  }

  async function team(org: SeededOrg): Promise<Team> {
    const slug = `e${tag()}`
    const [row] = await seed.admin<{ id: string }[]>`insert into platform.teams (org_id, slug, name) values (${org.id}, ${slug}, ${`Équipe ${slug}`}) returning id`
    const [folder] = await seed.admin<Page[]>`select id, path from platform.nodes where org_id = ${org.id} and path = ${slug}`
    return { id: row.id, slug, folder }
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
    const [led, other] = [await team(org), await team(org)]
    await seed.admin`insert into platform.team_members (team_id, user_id, role) values (${led.id}, ${paul.id}, 'lead'), (${led.id}, ${marc.id}, 'member')`
    const [space] = await seed.admin<Page[]>`
      select id, path from platform.nodes where org_id = ${org.id} and parent_id = ${folder.id} and owner_kind = 'user' and owner_user_id = ${paul.id}`
    return { org, ada, lea, paul, marc, led, other, root, space }
  }

  /**
   * Un nœud publié sous `parent` (la racine par défaut), posé par la connexion d'administration ; de l'équipe `team` s'il
   * en a une ; à la corbeille depuis `trashedDaysAgo` jours s'il en a.
   */
  async function node(w: World, options: { team?: Team; parent?: Page; trashedDaysAgo?: number } = {}): Promise<Page> {
    const parent = options.parent ?? w.root
    const path = parent === w.root ? `p${tag()}` : `${parent.path}/p${tag()}`
    const deletedAt = options.trashedDaysAgo === undefined ? null : new Date(Date.now() - options.trashedDaysAgo * DAY_MS)
    const [row] = await seed.admin<Page[]>`
      insert into platform.nodes (org_id, parent_id, path, kind, title, summary, status, revision, owner_kind, owner_team_id, created_by, deleted_at)
      values (${w.org.id}, ${parent.id}, ${path}, 'page', 'Page', 'Une page.', 'published', 1, ${options.team ? "team" : null}, ${options.team?.id ?? null},
              ${w.ada.id}, ${deletedAt})
      returning id, path`
    return row
  }

  /** Un fichier joint à `page` (posé par Ada, `ready` par défaut), et son objet dans le bucket du test s'il y en a un. */
  async function file(w: World, page: Page, status: "ready" | "pending" = "ready"): Promise<string> {
    const [row] = await seed.admin<{ id: string }[]>`
      insert into platform.files (org_id, node_id, name, mime, size, status, created_by)
      values (${w.org.id}, ${page.id}, 'bilan-confidentiel.pdf', 'application/pdf', 1024, ${status}, ${w.ada.id}) returning id`
    storage.store?.objects.set(objectKey(w.org.id, row.id), { bytes: new TextEncoder().encode("%PDF"), mime: "application/pdf" })
    return row.id
  }

  /** Ce qui reste en base, lu par la connexion d'administration : les nœuds et les fichiers parmi ceux donnés. */
  async function remaining(nodes: Page[], files: string[]): Promise<{ nodes: string[]; files: string[] }> {
    const [n, f] = await Promise.all([
      seed.admin<{ id: string }[]>`select id from platform.nodes where id in ${seed.admin(nodes.map((page) => page.id))}`,
      seed.admin<{ id: string }[]>`select id from platform.files where id in ${seed.admin(files)}`,
    ])
    return { nodes: n.map((row) => row.id).sort(), files: f.map((row) => row.id).sort() }
  }

  const ids = (pages: Page[]) => pages.map((page) => page.id).sort()

  it.each(SESSIONS)("should hide from a plain member the files of a hidden page in the trash, and show them to whoever reads the page (session %s)", async (session) => {
    // De l'équipe `led` : Léa ne la voit pas, Marc la lit. Dans l'espace de Paul : Paul seul la lit. À la corbeille depuis
    // un jour, et depuis 40 jours (pas encore purgée).
    const w = await world()
    const pages = {
      team: await node(w, { team: w.led, trashedDaysAgo: 1 }),
      personal: await node(w, { parent: w.space, trashedDaysAgo: 1 }),
      expired: await node(w, { team: w.led, trashedDaysAgo: 40 }),
    }
    for (const page of Object.values(pages)) await file(w, page)
    const files = (page: Page) => (sql: Tx) => sql`select name, size from platform.files where node_id = ${page.id}`
    expect({
      team: await attempt(w.lea, files(pages.team), session),
      personal: await attempt(w.lea, files(pages.personal), session),
      expired: await attempt(w.lea, files(pages.expired), session),
    }).toEqual({ team: 0, personal: 0, expired: 0 })
    expect({
      marc: await attempt(w.marc, files(pages.team), session),
      paul: await attempt(w.paul, files(pages.personal), session),
    }).toEqual({ marc: 1, paul: 1 })
  })

  it.each(SESSIONS)("should purge for any member the nodes and files of every expired page of the organisation, read or not, and return the files (session %s)", async (session) => {
    const w = await world()
    // Expirées (plus de 30 jours, tout le sous-arbre aussi) : une page d'équipe fermée, une page de l'espace de Paul, une
    // page de l'organisation et sa sous-page.
    const team = await node(w, { team: w.led, trashedDaysAgo: 40 })
    const personal = await node(w, { parent: w.space, trashedDaysAgo: 35 })
    const open = await node(w, { trashedDaysAgo: 31 })
    const child = await node(w, { parent: open, trashedDaysAgo: 31 })
    // Gardées : une page à la corbeille depuis 5 jours ; une page expirée dont une sous-page est plus récente ; une page
    // vivante ; la page expirée d'une autre organisation.
    const recent = await node(w, { team: w.led, trashedDaysAgo: 5 })
    const parent = await node(w, { trashedDaysAgo: 40 })
    const younger = await node(w, { parent, trashedDaysAgo: 2 })
    const live = await node(w)
    const elsewhere = await world()
    const foreign = await node(elsewhere, { trashedDaysAgo: 40 })
    const gone = [await file(w, team), await file(w, team, "pending"), await file(w, personal), await file(w, open), await file(w, child)]
    const kept = [await file(w, recent), await file(w, parent), await file(w, younger), await file(w, live), await file(elsewhere, foreign)]
    const purged = await rowsAs(w.lea, (sql) => sql<{ nodes: number; files: string[] }[]>`select nodes, files from platform.purge_trash(${w.org.id})`, session)
    expect(purged.map((row) => ({ nodes: row.nodes, files: [...row.files].sort() }))).toEqual([{ nodes: 4, files: [...gone].sort() }])
    expect(await remaining([team, personal, open, child, recent, parent, younger, live, foreign], [...gone, ...kept])).toEqual({
      nodes: ids([recent, parent, younger, live, foreign]),
      files: [...kept].sort(),
    })
  })

  it.each(SESSIONS)("should erase for an administrator every trashed page of a team, its subpages and files, whatever their date, and return the files (session %s)", async (session) => {
    const w = await world()
    // De l'équipe `other` : une page dont elle est propriétaire, à la corbeille depuis un jour ; une page rangée sous son
    // dossier, à la corbeille depuis 40 jours, et sa sous-page.
    const owned = await node(w, { team: w.other, trashedDaysAgo: 1 })
    const below = await node(w, { parent: w.other.folder, trashedDaysAgo: 40 })
    const child = await node(w, { parent: below, trashedDaysAgo: 40 })
    // Gardées : une page vivante sous son dossier (le service refuse avant), la page à la corbeille d'une autre équipe, une
    // page de l'organisation à la corbeille.
    const live = await node(w, { parent: w.other.folder })
    const led = await node(w, { team: w.led, trashedDaysAgo: 1 })
    const open = await node(w, { trashedDaysAgo: 1 })
    const gone = [await file(w, owned), await file(w, below), await file(w, child, "pending")]
    const kept = [await file(w, live), await file(w, led), await file(w, open)]
    const erased = await rowsAs(w.ada, (sql) => sql<{ files: string[] }[]>`select platform.erase_team_trash(${w.org.id}, ${w.other.id}) as files`, session)
    expect(erased.map((row) => [...row.files].sort())).toEqual([[...gone].sort()])
    expect(await remaining([owned, below, child, live, led, open], [...gone, ...kept])).toEqual({ nodes: ids([live, led, open]), files: [...kept].sort() })
  })

  it.each(SESSIONS)("should refuse the purge functions to whoever their service does not let in (session %s)", async (session) => {
    const w = await world()
    const elsewhere = await world()
    const expired = await node(w, { team: w.led, trashedDaysAgo: 40 })
    const trashed = await node(w, { team: w.led, trashedDaysAgo: 1 })
    const files = [await file(w, expired), await file(w, trashed)]
    const purge = (org: SeededOrg) => (sql: Tx) => sql`select nodes, files from platform.purge_trash(${org.id})`
    const erase = (org: SeededOrg, team: Team) => (sql: Tx) => sql`select platform.erase_team_trash(${org.id}, ${team.id}) as files`
    expect({
      // Une personne d'une autre organisation ne purge pas la corbeille de celle-ci.
      outsider: await attempt(elsewhere.lea, purge(w.org), session),
      admin: await attempt(elsewhere.ada, purge(w.org), session),
      // Ni un membre simple, ni le responsable de l'équipe n'effacent ses pages ; l'administrateur d'une autre organisation non plus.
      plain: await attempt(w.lea, erase(w.org, w.led), session),
      lead: await attempt(w.paul, erase(w.org, w.led), session),
      foreignAdmin: await attempt(elsewhere.ada, erase(w.org, w.led), session),
      // L'administrateur nomme une équipe d'une autre organisation : inconnue dans la sienne.
      foreignTeam: await attempt(w.ada, erase(w.org, elsewhere.led), session),
    }).toEqual({
      outsider: expect.stringMatching(/^42501 /),
      admin: expect.stringMatching(/^42501 /),
      plain: expect.stringMatching(/^42501 /),
      lead: expect.stringMatching(/^42501 /),
      foreignAdmin: expect.stringMatching(/^42501 /),
      foreignTeam: expect.stringMatching(/^P0002 /),
    })
    expect(await remaining([expired, trashed], files)).toEqual({ nodes: ids([expired, trashed]), files: [...files].sort() })
  })

  /** La base d'une personne pour un service, sous sa session ou celle du serveur. */
  const dbOf = (who: SeededPerson, session?: "server"): PlatformDb => {
    const db = asCaller(who.id, who.email)
    return { tx: (fn) => db.tx(fn, session) }
  }

  it.each(SESSIONS)("should purge, from the trash screen of a plain member, the expired pages she cannot see, objects included (session %s)", async (session) => {
    storage.store = memoryFileStore()
    const w = await world()
    const hidden = await node(w, { parent: w.space, trashedDaysAgo: 40 })
    const recent = await node(w, { parent: w.space, trashedDaysAgo: 1 })
    const [gone, kept] = [await file(w, hidden), await file(w, recent)]
    const db = dbOf(w.lea, session)
    const identity = await resolveIdentity(db, w.org.host, { userId: w.lea.id, email: w.lea.email })
    expect(await listTrash(db, identity)).toEqual([])
    expect(await remaining([hidden, recent], [gone, kept])).toEqual({ nodes: ids([recent]), files: [kept] })
    expect({ gone: storage.store.objects.has(objectKey(w.org.id, gone)), kept: storage.store.objects.has(objectKey(w.org.id, kept)) }).toEqual({ gone: false, kept: true })
  })

  it.each(SESSIONS)("should erase, when an administrator deletes a team, its trashed pages and their objects (session %s)", async (session) => {
    storage.store = memoryFileStore()
    const w = await world()
    const owned = await node(w, { team: w.other, trashedDaysAgo: 1 })
    const below = await node(w, { parent: w.other.folder, trashedDaysAgo: 3 })
    const gone = [await file(w, owned), await file(w, below)]
    const db = dbOf(w.ada, session)
    const identity = await resolveIdentity(db, w.org.host, { userId: w.ada.id, email: w.ada.email })
    expect((await deleteTeam(db, identity, w.other.id)).data).toEqual({ id: w.other.id, slug: w.other.slug })
    expect(await remaining([owned, below], gone)).toEqual({ nodes: [], files: [] })
    expect(gone.map((id) => storage.store?.objects.has(objectKey(w.org.id, id)))).toEqual([false, false])
  })
})
