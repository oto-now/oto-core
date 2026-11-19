// @vitest-environment node
// Titre de l'espace personnel posé par la base (tâche M45, fiche D89 B ; HN-M38-1) sur une vraie base, la
// base étant le sujet : `members_tree_sync` titre « Privé » l'espace d'un membre nouveau. Le renommage des
// espaces restés « Perso », donnée d'une migration que la ligne de base V1 a repliée (E01-S12 partie d),
// n'a plus rien à renommer sur une installation neuve. Portable : connexion d'administration seule.
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { seedWithAdmin, SQL_SKIP_REASON, sqlConfigured, type SeededData } from "../helpers/sql"
import { pendingMigrations, pendingReason, privateFolderPending, privateFolderSuite } from "../helpers/pending-migrations"

// Ces tests supposent le dossier `private` en base (fiche D107) : sautés, la version nommée, tant que
// 20260928120000 n'est pas appliquée au projet (`database-patterns.md § Règles`).
const privatePending = await privateFolderPending()

const SETUP_TIMEOUT = 180_000
const NETWORK_TIMEOUT = 60_000
const SUITE = "title of the personal space set by the database (M45)"

describe.skipIf(!sqlConfigured || privatePending)(privateFolderSuite(sqlConfigured ? SUITE : `${SUITE} (${SQL_SKIP_REASON})`, privatePending), { timeout: NETWORK_TIMEOUT }, () => {
  let seed: SeededData
  let orgId: string

  beforeAll(async () => {
    seed = seedWithAdmin()
    orgId = (await seed.createOrg()).id
    // Ce que pose `create_org` et que lit le déclencheur : la racine, puis le dossier `private`.
    const [root] = await seed.admin<{ id: string }[]>`
      insert into platform.nodes (org_id, parent_id, path, title, summary, owner_kind)
      values (${orgId}, null, 'guide', 'Guide', 'Racine.', 'org') returning id`
    await seed.admin`
      insert into platform.nodes (org_id, parent_id, path, title, summary)
      values (${orgId}, ${root.id}, 'private', 'Espaces personnels', 'Un espace par personne.')`
  }, SETUP_TIMEOUT)

  afterAll(async () => {
    await seed?.cleanup()
  }, SETUP_TIMEOUT)

  /** Un membre au `handle` donné : `members_tree_sync` crée son espace et le Contexte de l'espace. */
  async function member(handle: string): Promise<string> {
    const person = seed.person()
    await seed.admin`insert into platform.members (org_id, user_id, role, email, profile)
                     values (${orgId}, ${person.id}, 'member', ${person.email}, ${seed.admin.json({ handle })})`
    return person.id
  }

  const titles = (prefix: string) =>
    seed.admin<{ path: string; title: string }[]>`
      select path, title from platform.nodes where org_id = ${orgId} and path like ${`${prefix}%`} order by path`

  it("should title « Privé » the personal space it creates for a new member, its Contexte unchanged", async () => {
    await member("ada")
    expect([...(await titles("private/ada"))]).toEqual([
      { path: "private/ada", title: "Privé" },
      { path: "private/ada/contexte", title: "Contexte" },
    ])
  })
})

// E11-S10, lot a (AC-a1, AC-a2) : le handle posé à l'insertion d'un membre qui n'en a pas, et la réparation
// d'un membre inséré avant le dossier `private` (`ensure_private_space`). Sautés, la version nommée, tant que
// la migration de la 1.1.0 (`20260930100000_v1_1_0.sql`, partie E11-S10) n'est pas appliquée au projet
// (`database-patterns.md § Règles`).
const PRIVATE_SPACES_VERSION = "20260930100000"
const spacesPending = privatePending || (await pendingMigrations()).includes(PRIVATE_SPACES_VERSION)
const SPACES_SUITE = "private space of a member without handle (E11-S10, lot a)"

describe.skipIf(!sqlConfigured || spacesPending)(
  !sqlConfigured ? `${SPACES_SUITE} (${SQL_SKIP_REASON})` : spacesPending ? `${SPACES_SUITE} (${pendingReason([PRIVATE_SPACES_VERSION])})` : SPACES_SUITE,
  { timeout: NETWORK_TIMEOUT },
  () => {
    let seed: SeededData

    beforeAll(() => {
      seed = seedWithAdmin()
    })

    afterAll(async () => {
      await seed?.cleanup()
    }, SETUP_TIMEOUT)

    /** Une organisation et sa racine ; `withPrivate` : le dossier `private` aussi, comme le pose `create_org`. */
    async function org(withPrivate: boolean): Promise<{ id: string; root: string }> {
      const { id } = await seed.createOrg()
      const [root] = await seed.admin<{ id: string }[]>`
        insert into platform.nodes (org_id, parent_id, path, title, summary, owner_kind)
        values (${id}, null, 'guide', 'Guide', 'Racine.', 'org') returning id`
      if (withPrivate) await privateFolder(id, root.id)
      return { id, root: root.id }
    }

    const privateFolder = (orgId: string, root: string) =>
      seed.admin`insert into platform.nodes (org_id, parent_id, path, title, summary)
                 values (${orgId}, ${root}, 'private', 'Espaces personnels', 'Un espace par personne.')`

    /** Le membre, relu : son handle et la version de sa ligne (`xmin` change à toute écriture). */
    const memberRow = async (orgId: string, userId: string) =>
      (await seed.admin<{ handle: string | null; version: string }[]>`
        select profile ->> 'handle' as handle, xmin::text as version from platform.members where org_id = ${orgId} and user_id = ${userId}`)[0]

    /** Les nœuds de l'organisation sous `private/`, relus avec leur version. */
    const spaces = (orgId: string) =>
      seed.admin<{ path: string; title: string; summary: string; owner_kind: string | null; owner_user_id: string | null; version: string }[]>`
        select path, title, summary, owner_kind, owner_user_id, xmin::text as version
          from platform.nodes where org_id = ${orgId} and path like 'private/%' order by path`

    const expectedSpace = (handle: string, userId: string) => [
      { path: `private/${handle}`, title: "Privé", summary: "Votre espace privé, visible de vous seul.", owner_kind: "user", owner_user_id: userId },
      {
        path: `private/${handle}/contexte`,
        title: "Contexte",
        summary: "Ce que votre assistant lit à chaque conversation ; vous seul le recevez.",
        owner_kind: "user",
        owner_user_id: userId,
      },
    ]
    const withoutVersion = (rows: Awaited<ReturnType<typeof spaces>>) =>
      rows.map(({ path, title, summary, owner_kind, owner_user_id }) => ({ path, title, summary, owner_kind, owner_user_id }))

    it("should give a member inserted without handle the handle of unique_handle, then its space and Contexte (AC-a1)", async () => {
      const { id } = await org(true)
      const person = seed.person()
      const [{ handle }] = await seed.admin<{ handle: string }[]>`select platform.unique_handle(${id}, ${person.email}) as handle`
      await seed.addMember(id, person)
      expect((await memberRow(id, person.id)).handle).toBe(handle)
      expect(withoutVersion(await spaces(id))).toEqual(expectedSpace(handle, person.id))
    })

    it("should repair a member inserted before the private folder, then write nothing on a second call (AC-a2)", async () => {
      const { id, root } = await org(false)
      const person = seed.person()
      await seed.addMember(id, person)
      expect((await memberRow(id, person.id)).handle).toBeNull()
      await privateFolder(id, root)

      await seed.admin`select platform.ensure_private_space(${id}, ${person.id})`
      const repaired = await memberRow(id, person.id)
      expect(repaired.handle).toMatch(/^test_[0-9a-f]{12}$/)
      const created = await spaces(id)
      expect(withoutVersion(created)).toEqual(expectedSpace(String(repaired.handle), person.id))

      await seed.admin`select platform.ensure_private_space(${id}, ${person.id})`
      expect(await memberRow(id, person.id)).toEqual(repaired)
      expect(await spaces(id)).toEqual(created)
    })

    it("should return without error nor write in an organisation without private folder (AC-a2)", async () => {
      const { id } = await org(false)
      const person = seed.person()
      await seed.addMember(id, person)
      const before = await memberRow(id, person.id)

      await seed.admin`select platform.ensure_private_space(${id}, ${person.id})`
      expect(await memberRow(id, person.id)).toEqual(before)
      expect(await seed.admin`select id from platform.nodes where org_id = ${id} and path <> 'guide'`).toEqual([])
    })
  },
)
