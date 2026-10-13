// @vitest-environment node
// Point de création de l'hôte (E09-S02, AC2 à AC6) : `createOrg` avec un point simulé (espions), et les
// textes que sert `admin_org create` par InMemoryTransport, sur une vraie base (E01-S10, lot t1-d2a) : la
// base des tests admin (`seedAdminFixture`), le client de l'appelant (`asCaller`), et
// l'espion de ses requêtes (`recordRequests`, AC-x3). Chaque organisation qu'un test fait
// créer a un slug jetable (`createdOrgs`) dont ses adresses dérivent : deux passages en même temps sur
// le projet ne se croisent pas. Une adresse prise l'est dans la base : le refus vient du service, avant
// `create_org`. En suite portable (`sqlConfigured`) : le projet, ou le Postgres nu du job `bare-postgres`.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { createOrg, PlatformError, type OrgCreationHook, type StaffCaller } from "@otomata_tech/oto_platform/server"
import { ADMIN_ORIGIN, connectAdminMcp, ORGS, type AdminPerson } from "../helpers/mcp-admin"
import { seedAdminFixture, type AdminFixtureSql } from "../helpers/mcp-admin-sql"
import { loggedText } from "../helpers/logs"
import { sqlConfigured, seedWithAdmin, type SeededData, portable } from "../helpers/sql"
import { createdOrgs, recordRequests, type RecordedRequest } from "../helpers/spy-t1-d2a"

const NETWORK_TIMEOUT = 60_000
const SETUP_TIMEOUT = 180_000

/** L'adresse qu'ouvre `other` dans la base simulée d'AC6 ; la fixture lui tire sa valeur réelle. */
const CELL = "acme.cellule.test"
const NEXT_LINE = 'Next: set its work domains with admin_org {"op": "update"} and create its teams with admin_team {"op": "create"}.'
const INTERNAL = "Internal error. Retry once; if it fails again, report it to the platform developers."

/** L'adresse que le point simulé ajoute à une organisation, et celle qu'un test passe en `host`. */
const cellOf = (slug: string) => `${slug}.cellule.test`
const otherOf = (slug: string) => `${slug}.example.test`

/** Un point simulé : l'adresse `<slug>.cellule.test`, puis une ligne par adresse créée (espions). */
function hook(overrides: Partial<OrgCreationHook> = {}) {
  return {
    addresses: vi.fn<OrgCreationHook["addresses"]>(({ slug }) => [cellOf(slug)]),
    created: vi.fn<OrgCreationHook["created"]>(async ({ hosts }) => hosts.map((host) => ({ host, status: "attached", line: `Line of ${host}.` }))),
    ...overrides,
  }
}

const objectsOf = (requests: readonly RecordedRequest[]) => requests.map((request) => request.objects)
const createOrgRequests = (requests: readonly RecordedRequest[]) => requests.filter((request) => request.objects.includes("create_org"))

beforeEach(() => {
  // Les pannes du point et les refus de la base journalisent côté serveur.
  vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe.skipIf(!sqlConfigured)(
  portable("createOrg with the creation hook of the host (E09-S02)"),
  { timeout: NETWORK_TIMEOUT },
  () => {
    let seed: SeededData
    let admin: AdminFixtureSql
    let orgs: ReturnType<typeof createdOrgs>

    beforeAll(async () => {
      seed = seedWithAdmin()
      orgs = createdOrgs(seed)
      admin = await seedAdminFixture(seed)
    }, SETUP_TIMEOUT)

    afterAll(async () => {
      try {
        await orgs?.cleanup()
        await admin?.forgetJournal()
      } finally {
        await seed?.cleanup()
      }
    }, SETUP_TIMEOUT)

    const staff = (person: AdminPerson): StaffCaller => ({ userId: admin.persons[person].id, email: admin.persons[person].email })
    /** Sam se nomme premier administrateur (décision du 2026-10-14) : le cas sans invitation, celui de ces tests. */
    const samFirst = () => ({ admin_email: admin.persons.sam.email })
    const options = (orgCreation: OrgCreationHook) => ({ orgCreation, origin: ADMIN_ORIGIN })
    const firstAdminLine = () => `You (${admin.persons.sam.email}) are its first administrator: a member with the admin role.`

    /** Les organisations de ces slugs et les adresses de cette liste, dans la base : ce qu'une création y aurait écrit. */
    async function written(slugs: string[], hosts: string[]) {
      const [counts] = await seed.admin<{ orgs: number; hosts: number }[]>`
        select (select count(*)::int from platform.orgs where slug in ${seed.admin(slugs)}) as orgs,
               (select count(*)::int from platform.org_domains where host in ${seed.admin(hosts)}) as hosts`
      return counts
    }

    /** Les adresses de l'organisation de ce slug, dans l'ordre de leur nom. */
    async function hostsOf(slug: string): Promise<string[]> {
      const rows = await seed.admin<{ host: string }[]>`
        select d.host from platform.org_domains d join platform.orgs o on o.id = d.org_id where o.slug = ${slug} order by d.host`
      return rows.map((row) => row.host)
    }

    /**
     * Le MCP admin de Sam avec ce point, espionné (`spy`, sinon un espion neuf), sa session ouverte, et
     * `admin_org create` d'une organisation au slug jetable.
     */
    async function adminWith(point: OrgCreationHook, spy?: ReturnType<typeof recordRequests>) {
      const deps = await admin.deps("sam")
      const watched = spy ?? recordRequests(deps.db)
      const session = await connectAdminMcp({ ...deps, db: watched.db, orgCreation: point })
      const { code } = await session.openAdmin()
      const slug = orgs.slug()
      const create = (args: Record<string, unknown> = {}) =>
        session.call("admin_org", { ctx: code, op: "create", org: slug, name: "Acme", prefix: slug, ...samFirst(), ...args })
      return { spy: watched, session, create, slug }
    }

    it("should ask the application once after the platform team check, check its address before any write, and list it in the summary (AC2)", async () => {
      const spy = recordRequests((await admin.deps("sam")).db)
      const slug = orgs.slug()
      let before: string[][] = []
      const point = hook({
        addresses: vi.fn<OrgCreationHook["addresses"]>(() => {
          before = objectsOf(spy.requests)
          return [cellOf(slug)]
        }),
      })
      const summary = await createOrg(spy.db, staff("sam"), { org: slug, name: "Acme", prefix: slug, ...samFirst() }, options(point))
      expect(point.addresses).toHaveBeenCalledTimes(1)
      expect(point.addresses).toHaveBeenCalledWith({ slug, hosts: [] })
      expect(before).toEqual([["is_staff"]])
      expect(spy.requests.slice(before.length).map(({ objects, values }) => ({ objects, values }))).toEqual([
        { objects: ["org_by_host"], values: [cellOf(slug)] },
      ])
      expect(summary).toEqual({
        created: false,
        org: { slug, name: "Acme", prefix: slug, host: null },
        firstAdmin: { email: admin.persons.sam.email, self: true },
        addresses: { hosts: [cellOf(slug)], added: [cellOf(slug)] },
      })
      expect(point.created).not.toHaveBeenCalled()

      const served = hook()
      const other = await adminWith(served, spy)
      expect((await other.create()).text.split("\n")[2]).toBe(`Address: ${cellOf(other.slug)} (added by this application).`)
      const two = await other.create({ host: otherOf(other.slug) })
      expect(two.text.split("\n")[2]).toBe(`Addresses: ${otherOf(other.slug)}, ${cellOf(other.slug)} (added by this application).`)
      expect(two.structured?.summary).toEqual({
        slug: other.slug,
        name: "Acme",
        prefix: other.slug,
        host: otherOf(other.slug),
        hosts: [otherOf(other.slug), cellOf(other.slug)],
        first_admin: { email: admin.persons.sam.email, self: true },
      })
      expect(createOrgRequests(spy.requests)).toEqual([])
      expect(await written([slug, other.slug], [cellOf(slug), cellOf(other.slug), otherOf(other.slug)])).toEqual({ orgs: 0, hosts: 0 })
      expect(served.created).not.toHaveBeenCalled()
    })

    it("should serve the refusal of the application as is, and any other exception as the constant internal error (AC3)", async () => {
      const reserved = "app.cellule.test is reserved. Choose another slug or address."
      const refusing = hook({
        addresses: vi.fn<OrgCreationHook["addresses"]>(() => {
          throw new PlatformError("invalid_arguments", reserved)
        }),
      })
      const failing = hook({
        addresses: vi.fn<OrgCreationHook["addresses"]>(async () => {
          throw new Error("detail known to the application only")
        }),
      })

      // Le refus du point simulé nomme `app` ; la création, elle, ne vise qu'un slug jetable (base partagée).
      const refused = await (await adminWith(refusing)).create({ confirm: true })
      expect(refused).toMatchObject({ isError: true, text: reserved })
      const { spy, create } = await adminWith(failing)
      const broken = await create({ confirm: true })
      expect(broken).toMatchObject({ isError: true, text: INTERNAL })
      expect(loggedText(vi.mocked(console.error))).not.toContain("detail known to the application only")
      expect(createOrgRequests(spy.requests)).toEqual([])
      expect(refusing.created).not.toHaveBeenCalled()
      expect(failing.created).not.toHaveBeenCalled()
    })

    it("should ask again at the second step, create with the addresses deduplicated, then hand over once with every address created (AC4)", async () => {
      const first = hook()
      const one = await adminWith(first)
      await one.create()
      const confirmed = await one.create({ host: cellOf(one.slug), confirm: true })
      expect(first.addresses).toHaveBeenCalledTimes(2)
      expect(one.spy.requests.filter((request) => request.objects.includes("org_by_host"))).toHaveLength(2)
      // `create_org` une fois, avec l'adresse passée et celle du point dédoublonnées : une seule est créée.
      expect(createOrgRequests(one.spy.requests).map((request) => request.values)).toEqual([["Acme", one.slug, one.slug, [cellOf(one.slug)]]])
      const [created] = await seed.admin<{ name: string; prefix: string }[]>`select name, prefix from platform.orgs where slug = ${one.slug}`
      expect(created).toEqual({ name: "Acme", prefix: one.slug })
      expect(await hostsOf(one.slug)).toEqual([cellOf(one.slug)])
      expect(confirmed.text.split("\n")).toEqual([
        `Organisation ${one.slug} (Acme) created: root page guide, context page contexte, personal spaces (private), your platform access, address ${cellOf(one.slug)}.`,
        firstAdminLine(),
        NEXT_LINE,
        `Line of ${cellOf(one.slug)}.`,
      ])

      let seen: string[][] = []
      // Appelé pendant `create`, une fois `two` connu : ses lignes nomment les adresses de son slug.
      const second = hook({
        created: vi.fn<OrgCreationHook["created"]>(async () => {
          seen = objectsOf(two.spy.requests)
          return [
            { host: cellOf(two.slug), status: "pending_verification", line: "First line." },
            { host: otherOf(two.slug), status: "attached", line: "Second line." },
          ]
        }),
      })
      const two = await adminWith(second)
      const both = await two.create({ host: otherOf(two.slug), confirm: true })
      expect(second.created).toHaveBeenCalledTimes(1)
      expect(second.created).toHaveBeenCalledWith({ slug: two.slug, hosts: [otherOf(two.slug), cellOf(two.slug)] })
      // Sam se nomme premier administrateur : `claim_org_admin` suit `create_org`, dans sa transaction.
      expect(seen.slice(-2)).toEqual([["create_org"], ["claim_org_admin"]])
      expect(both.text.split("\n").slice(0, 1)).toEqual([
        `Organisation ${two.slug} (Acme) created: root page guide, context page contexte, personal spaces (private), your platform access, addresses ${otherOf(two.slug)}, ${cellOf(two.slug)}.`,
      ])
      expect(both.text.split("\n").slice(3)).toEqual(["First line.", "Second line."])
      expect(both.structured?.address_setup).toEqual([
        { host: cellOf(two.slug), status: "pending_verification" },
        { host: otherOf(two.slug), status: "attached" },
      ])

      // Le slug d'une organisation semée : `create_org` le refuse (orgs_slug_key), et le point n'est pas rappelé.
      const taken = admin.orgs.acme.slug
      const racing = hook()
      const raced = await adminWith(racing)
      const refused = await raced.create({ org: taken, confirm: true })
      expect(refused).toMatchObject({ isError: true, text: `Slug ${taken} is already taken. Pick another slug.` })
      expect(createOrgRequests(raced.spy.requests)).toHaveLength(1)
      expect(racing.created).not.toHaveBeenCalled()
    })

    // `throws` : un point écrit sans `async`, qui lève avant de rendre une promesse.
    it.each<[string, OrgCreationHook["created"]]>([
      [
        "throws",
        () => {
          throw new Error("detail known to the application only")
        },
      ],
      [
        "rejects",
        async () => {
          throw new Error("detail known to the application only")
        },
      ],
    ])("should keep the organisation created and add the constant line when created %s (AC5)", async (_case, failure) => {
      const { session, create, slug } = await adminWith(hook({ created: failure }))
      const result = await create({ confirm: true })
      expect(result.isError).toBe(false)
      expect(result.text.split("\n")).toEqual([
        `Organisation ${slug} (Acme) created: root page guide, context page contexte, personal spaces (private), your platform access, address ${cellOf(slug)}.`,
        firstAdminLine(),
        NEXT_LINE,
        `Organisation ${slug} is created, but this application could not finish setting up its addresses. Check them with admin_org {"op": "get"}.`,
      ])
      expect(result.structured?.address_setup).toBeUndefined()
      // L'organisation reste créée, avec son adresse.
      expect(await written([slug], [cellOf(slug)])).toEqual({ orgs: 1, hosts: 1 })
      await session.flush()
      // Le résultat et le journal partent en JSON (transport, base) ; la console, par `format`.
      const journal = await seed.admin`select * from platform.admin_journal where user_id = ${admin.persons.sam.id}`
      const traces = [JSON.stringify([result.result, journal]), loggedText(vi.mocked(console.error))].join("\n")
      expect(traces).not.toContain("detail known to the application only")
    })

    it("should decide the platform team, the formats and the addresses before the hook and before create_org (AC6)", async () => {
      // L'adresse d'`other`, prise dans la base : c'est elle que le point ajoute.
      await admin.write({ org_domains: [{ host: CELL, org_id: ORGS.other.id }] })
      const taken = admin.id(CELL)
      const point = hook({ addresses: vi.fn<OrgCreationHook["addresses"]>(() => [taken]) })
      const slug = orgs.slug()
      const ada = await admin.deps("ada")
      await expect(createOrg(ada.db, staff("ada"), { org: slug, name: "Acme", prefix: slug, ...samFirst(), confirm: true }, options(point))).rejects.toMatchObject({
        code: "forbidden",
      })
      const sam = recordRequests((await admin.deps("sam")).db)
      await expect(createOrg(sam.db, staff("sam"), { org: "Acme!", name: "Acme", prefix: "acme", ...samFirst() }, options(point))).rejects.toMatchObject({
        code: "invalid_arguments",
      })
      expect(sam.requests).toEqual([])
      expect(point.addresses).not.toHaveBeenCalled()

      await expect(createOrg(sam.db, staff("sam"), { org: slug, name: "Acme", prefix: slug, ...samFirst(), confirm: true }, options(point))).rejects.toMatchObject({
        code: "conflict",
        message: `Address ${taken} already opens another organisation.`,
      })
      expect(createOrgRequests(sam.requests)).toEqual([])
      expect(point.created).not.toHaveBeenCalled()
    })
  },
)
