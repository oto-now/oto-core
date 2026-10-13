// @vitest-environment node
// Services d'organisation du MCP admin (E08-S02 : AC10, AC14 à AC19, AC21, AC24 ;
// `security-patterns.md § Droits dans le service`) sur une vraie base (E01-S10, lot t1-d2a) : la base des
// tests admin (`seedAdminFixture`), semée une fois pour le fichier, le client de chaque personne (mode de
// transition, lot t1-0b) et l'espion des requêtes des deux faces (`recordRequests`, AC-x3). La RLS n'isole
// que les organisations, et l'équipe plateforme y lit tous les accès plateforme : ce que le service ne
// filtre pas lui-même revient ; chaque service refuse avant d'écrire. Ce qu'un test change dans la graine,
// il le défait après lui, même en échec (`undo`) : chacun passe seul. Slugs, adresses et emails sont
// jetables : les lignes se comparent par `readable`, les textes portent les valeurs réelles. En
// suite portable (`sqlConfigured`) : le projet, ou le Postgres nu du job `bare-postgres`.
import { AuthClient } from "@supabase/supabase-js"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import {
  addAdmin,
  addHost,
  createOrg,
  describeTeamDeletion,
  getOrg,
  grantAccess,
  listOrgOverviews,
  removeHost,
  resolveAdminOrg,
  revokeAccess,
  updateOrg,
  type StaffCaller,
} from "@otomata_tech/oto_platform/server"
import { ADMIN_ORIGIN, adminTables, ORGS, PERSONS, type AdminPerson } from "../helpers/mcp-admin"
import { seedAdminFixture, type AdminFixtureSql } from "../helpers/mcp-admin-sql"
import { isoInstants, sqlConfigured, seedWithAdmin, type SeededData, portable } from "../helpers/sql"
import { createdOrgs, recordRequests, requestedWrites, undoAll } from "../helpers/spy-t1-d2a"

const NETWORK_TIMEOUT = 60_000
const SETUP_TIMEOUT = 180_000

/** Les tables que lit la résolution d'une identité (`resolveAdminOrg`, puis `identityInOrg`). */
const IDENTITY_TABLES: ReadonlySet<string> = new Set(["orgs", "members", "teams", "team_members", "platform_staff", "platform_grants"])

const UNKNOWN = (slug: string) =>
  `Unknown organisation ${slug}, or you have no platform access to it. List yours with admin_context {"op": "orgs"}; a colleague who has access can grant you one with admin_org {"op": "grant_access"}.`
const STAFF_ADMIN = (op: string, slug: string) =>
  `op ${op} of admin_org is reserved to platform team members who administer ${slug}. A colleague who does can grant you a platform access with admin_org {"op": "grant_access"}.`

/** Un accès de Théo à acme, accordé par Sam le 2026-09-01, révoqué par Ada à `revokedAt`. */
function revokedTheo(id: string, revokedAt: string) {
  const granted = { org_id: ORGS.acme.id, user_id: PERSONS.theo.id, granted_by: PERSONS.sam.id, granted_at: "2026-09-01T08:00:00.000Z" }
  return { id, ...granted, revoked_at: revokedAt, revoked_by: PERSONS.ada.id, reason: null }
}

/** Les valeurs dans l'ordre du slug de leur organisation, celui de `listOrgs` : les slugs jetables sont tirés au hasard. */
function bySlug<T>(entries: [string, T][]): T[] {
  return [...entries].sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => value)
}

/** L'origine du MCP admin appelé, que `createOrg` et `addAdmin` reçoivent de la route. */
const origin = { origin: ADMIN_ORIGIN }

/** Un texte tel quel dans une expression régulière. */
const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

/**
 * L'email d'une invitation en mode Supabase (le lien magique, `signInWithOtp`), simulé : rien ne part vers le projet.
 * `failing` : l'envoi refusé, comme un service d'email en panne.
 */
function magicLinks({ failing = false } = {}) {
  vi.stubEnv("PLATFORM_OIDC_ISSUER", "")
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.example.invalid")
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key")
  const refused = { name: "AuthApiError", message: "unavailable", status: 500 }
  const answer = failing ? { data: { user: null, session: null }, error: refused } : { data: { user: null, session: null }, error: null }
  // L'erreur de Supabase Auth est une classe : la réponse simulée n'en reprend que les champs que lit le service.
  return vi.spyOn(AuthClient.prototype, "signInWithOtp").mockResolvedValue(answer as never)
}

describe.skipIf(!sqlConfigured)(portable("organisation services of the admin MCP (E08-S02)"), { timeout: NETWORK_TIMEOUT }, () => {
  let seed: SeededData
  let admin: AdminFixtureSql
  let orgs: ReturnType<typeof createdOrgs>
  /** Ce que le test en cours a changé dans la graine, défait après lui dans l'ordre inverse, même en échec. */
  const undo: (() => Promise<unknown>)[] = []

  beforeAll(async () => {
    seed = seedWithAdmin()
    orgs = createdOrgs(seed)
    admin = await seedAdminFixture(seed)
  }, SETUP_TIMEOUT)

  afterEach(() => undoAll(undo), SETUP_TIMEOUT)

  afterAll(async () => {
    try {
      await orgs?.cleanup()
      await admin?.forgetJournal()
    } finally {
      await seed?.cleanup()
    }
  }, SETUP_TIMEOUT)

  const as = (person: AdminPerson): StaffCaller => ({ userId: admin.persons[person].id, email: admin.persons[person].email })
  const dbOf = async (person: AdminPerson) => (await admin.deps(person)).db

  /** Théo n'a aucun accès à acme dans la graine : ceux que le test lui donne partent après lui. */
  function forgetTheoOnAcme(): void {
    undo.push(() => seed.admin`delete from platform.platform_grants where org_id = ${admin.orgs.acme.id} and user_id = ${admin.persons.theo.id}`)
  }

  /** Théo, de l'équipe plateforme, simple membre d'acme le temps du test. */
  async function theoMemberOfAcme(): Promise<void> {
    undo.push(() => seed.admin`delete from platform.members where org_id = ${admin.orgs.acme.id} and user_id = ${admin.persons.theo.id}`)
    await admin.write({ members: [{ org_id: ORGS.acme.id, user_id: PERSONS.theo.id, role: "member", profile: {} }] })
  }

  /** Les adresses d'une organisation, dans la base. */
  async function hostsOf(orgId: string): Promise<string[]> {
    const rows = await seed.admin<{ host: string }[]>`select host from platform.org_domains where org_id = ${orgId} order by host`
    return rows.map((row) => row.host)
  }

  describe("organisations the caller acts on (AC10, AC14, N9)", () => {
    it("should list only the organisations of the caller's memberships and current accesses, with their details", async () => {
      // Un accès révoqué de Théo à acme : le détail ne compte que les accès en cours.
      forgetTheoOnAcme()
      await admin.write({ platform_grants: [revokedTheo("revoked-theo", "2026-09-02T08:00:00.000Z")] })
      const { acme, demo } = admin.orgs
      const { orgs: listed, overviews } = await listOrgOverviews(await dbOf("sam"), as("sam"), 200)
      // `delta` : l'accès révoqué de Sam ; `other` : l'accès de Théo, que l'équipe plateforme lit aussi. La RLS
      // cache ces deux organisations (ligne embarquée nulle) et la ligne d'Otto, membre d'`other`.
      expect(listed.map((org) => [org.slug, org.access, org.role])).toEqual(
        bySlug([
          [acme.slug, [acme.slug, "platform_access", null]],
          [demo.slug, [demo.slug, "member", "admin"]],
        ]),
      )
      expect([...overviews.keys()]).toEqual(
        bySlug([
          [acme.slug, acme.id],
          [demo.slug, demo.id],
        ]),
      )
      expect(admin.readable(isoInstants(overviews.get(acme.id)))).toEqual({
        hosts: ["acme.test"],
        members: 3,
        teams: 3,
        accesses: [{ userId: PERSONS.sam.id, grantedAt: "2026-09-20T08:00:00.000Z" }],
      })
    })

    it("should refuse an organisation without membership nor current access as an unknown one, before any other request", async () => {
      const spy = recordRequests(await dbOf("sam"))
      const other = admin.orgs.other.slug
      await expect(resolveAdminOrg(spy.db, as("sam"), other)).rejects.toMatchObject({ code: "not_found", message: UNKNOWN(other) })
      await expect(resolveAdminOrg(spy.db, as("sam"), "nope")).rejects.toMatchObject({ code: "not_found", message: UNKNOWN("nope") })
      // La RLS cache la ligne d'`other` : rien n'est lu hors de la résolution de l'identité.
      const read = spy.requests.flatMap((request) => request.objects)
      expect(read).toContain("orgs")
      expect(read.filter((object) => !IDENTITY_TABLES.has(object))).toEqual([])
    })

    it("should read the sheet of an organisation: addresses, brand, routing defaults, administrators, contact, accesses", async () => {
      forgetTheoOnAcme()
      await admin.write({ platform_grants: Array.from({ length: 6 }, (_, index) => revokedTheo(`revoked-${index}`, `2026-09-0${index + 2}T08:00:00.000Z`)) })
      const { acme } = admin.orgs
      const db = await dbOf("sam")
      const sheet = admin.readable(isoInstants(await getOrg(db, await resolveAdminOrg(db, as("sam"), acme.slug))))
      expect(sheet).toMatchObject({
        slug: acme.slug,
        prefix: acme.prefix,
        hosts: ["acme.test"],
        domains: null,
        brand: { theme: "manuscrit", logo_url: null, display_name: null },
        routing: { threshold: 0.65, gap: 0.1 },
        flags: {},
        rulesVersion: 1,
        administrators: [{ name: "Ada Martin", email: "ada.martin@acme.test" }],
        contact: { name: "Ada Martin", email: "ada.martin@acme.test" },
      })
      expect(sheet.accesses.map((access) => [access.email, access.revokedAt])).toEqual([
        ["sam.staff@oto.test", null],
        ...[7, 6, 5, 4, 3].map((day) => ["theo.staff@oto.test", `2026-09-0${day}T08:00:00.000Z`]),
      ])
    })
  })

  describe("create an organisation (AC15, AC16)", () => {
    /** Une organisation à créer : slug jetable, noté pour le ménage, qui sert aussi de préfixe (`pnpm test:cleanup`), et une adresse libre. */
    function draftOf(name: string, adminEmail = admin.persons.sam.email) {
      const slug = orgs.slug()
      return { org: slug, name, prefix: slug, host: `${slug}.example.test`, admin_email: adminEmail }
    }

    it("should write nothing before confirm, and refuse an address taken as soon as the first step", async () => {
      const spy = recordRequests(await dbOf("sam"))
      const draft = draftOf("Acme Deux")
      expect(await createOrg(spy.db, as("sam"), draft, origin)).toEqual({
        created: false,
        org: { slug: draft.org, name: "Acme Deux", prefix: draft.prefix, host: draft.host },
        firstAdmin: { email: admin.persons.sam.email, self: true },
      })
      const taken = admin.orgs.acme.host
      await expect(createOrg(spy.db, as("sam"), { ...draft, host: taken }, origin)).rejects.toMatchObject({
        code: "conflict",
        message: `Address ${taken} already opens another organisation.`,
      })
      expect(requestedWrites(spy.requests)).toEqual([])
    })

    it("should refuse a caller outside the platform team before any other request", async () => {
      const spy = recordRequests(await dbOf("ada"))
      await expect(createOrg(spy.db, as("ada"), { ...draftOf("Acme Deux"), confirm: true }, origin)).rejects.toMatchObject({ code: "forbidden" })
      expect(spy.requests.map((request) => request.objects)).toEqual([["is_staff"]])
    })

    it("should create by create_org once confirmed, and name the address taken between the two steps", async () => {
      undo.push(() => orgs.cleanup())
      const spy = recordRequests(await dbOf("sam"))
      const draft = draftOf("Acme Deux")
      const created = await createOrg(spy.db, as("sam"), { ...draft, confirm: true }, origin)
      // Sam se nomme premier administrateur : membre `admin` dans la transaction de `create_org`, sans invitation.
      expect(spy.requests.slice(-2)).toMatchObject([
        { objects: ["create_org"], values: ["Acme Deux", draft.org, draft.prefix, [draft.host]] },
        { objects: ["claim_org_admin"] },
      ])
      expect(created).toMatchObject({ created: true, org: { slug: draft.org }, firstAdmin: { email: admin.persons.sam.email, self: true, outcome: "joined" } })
      const members = await seed.admin`
        select m.user_id, m.role, m.email from platform.members m join platform.orgs o on o.id = m.org_id where o.slug = ${draft.org}`
      expect(admin.readable([...members])).toEqual([{ user_id: PERSONS.sam.id, role: "admin", email: PERSONS.sam.email }])
      expect(await seed.admin`select 1 from platform.invitations i join platform.orgs o on o.id = i.org_id where o.slug = ${draft.org}`).toEqual([])
      const grants = await seed.admin`
        select g.user_id, g.granted_by, g.reason from platform.platform_grants g join platform.orgs o on o.id = g.org_id where o.slug = ${draft.org}`
      expect(admin.readable([...grants])).toEqual([{ user_id: PERSONS.sam.id, granted_by: PERSONS.sam.id, reason: "creation" }])

      const late = draftOf("Acme Trois")
      undo.push(() => seed.admin`delete from platform.org_domains where host = ${late.host}`)
      const raced = recordRequests(await dbOf("sam"), {
        // Prise entre les deux temps : l'adresse ouvre `other` juste avant `create_org`.
        before: async (request) => {
          if (request.objects.includes("create_org")) await seed.admin`insert into platform.org_domains (host, org_id) values (${late.host}, ${admin.orgs.other.id})`
        },
      })
      await expect(createOrg(raced.db, as("sam"), { ...late, confirm: true }, origin)).rejects.toMatchObject({
        code: "conflict",
        message: `Address ${late.host} already opens another organisation.`,
      })
    })

    it("should invite another first administrator with the admin role once created, by the email of the Équipes screen, linking to its address", async () => {
      undo.push(() => orgs.cleanup())
      const otp = magicLinks()
      const invited = `first-${admin.persons.ada.email}`.toUpperCase()
      const draft = draftOf("Acme Deux", invited)
      const email = invited.toLowerCase()
      const link = `http://${draft.host}:3000`
      expect(await createOrg(await dbOf("sam"), as("sam"), draft, origin)).toMatchObject({ created: false, firstAdmin: { email, self: false, link } })
      expect(otp).not.toHaveBeenCalled()

      const created = await createOrg(await dbOf("sam"), as("sam"), { ...draft, confirm: true }, origin)
      expect(created).toMatchObject({ created: true, firstAdmin: { email, self: false, outcome: "invited", link } })
      expect(otp).toHaveBeenCalledTimes(1)
      expect(otp.mock.calls[0]?.[0]).toMatchObject({ email, options: { emailRedirectTo: `${link}/auth/confirm?next=/` } })
      const rows = await seed.admin`
        select i.email, i.role, i.invited_by from platform.invitations i join platform.orgs o on o.id = i.org_id where o.slug = ${draft.org}`
      expect(admin.readable([...rows])).toEqual([{ email, role: "admin", invited_by: PERSONS.sam.id }])
      // Le créateur n'est pas membre : il garde son accès `creation`, comme avant.
      expect(await seed.admin`select 1 from platform.members m join platform.orgs o on o.id = m.org_id where o.slug = ${draft.org}`).toEqual([])
    })

    it("should refuse to invite without an address before any write, and keep the organisation when the invitation email fails", async () => {
      undo.push(() => orgs.cleanup())
      const spy = recordRequests(await dbOf("sam"))
      const noHost = { ...draftOf("Acme Deux", `first-${admin.persons.ada.email}`), host: undefined }
      await expect(createOrg(spy.db, as("sam"), { ...noHost, confirm: true }, origin)).rejects.toMatchObject({
        code: "invalid_arguments",
        message: `Inviting first-${admin.persons.ada.email} needs an address of ${noHost.org} to sign in at: pass host, or name yourself with admin_email.`,
      })
      expect(requestedWrites(spy.requests)).toEqual([])

      magicLinks({ failing: true })
      const draft = draftOf("Acme Trois", `first-${admin.persons.ada.email}`)
      const created = await createOrg(await dbOf("sam"), as("sam"), { ...draft, confirm: true }, origin)
      expect(created).toMatchObject({
        created: true,
        firstAdmin: { outcome: "invitation_failed", failure: "The invitation email could not be sent; the invitation was withdrawn. Try again." },
      })
      const [state] = await seed.admin<{ orgs: number; open: number }[]>`
        select (select count(*)::int from platform.orgs where slug = ${draft.org}) as orgs,
               (select count(*)::int from platform.invitations i join platform.orgs o on o.id = i.org_id
                 where o.slug = ${draft.org} and i.revoked_at is null) as open`
      expect(state).toEqual({ orgs: 1, open: 0 })
    })
  })

  describe("name an administrator (add_admin, 2026-10-14)", () => {
    /** Sam n'a qu'un accès à acme dans la graine : sa ligne `members` part après le test. */
    function forgetSamMemberOfAcme(): void {
      undo.push(() => seed.admin`delete from platform.members where org_id = ${admin.orgs.acme.id} and user_id = ${admin.persons.sam.id}`)
    }

    it("should make the caller a member with the admin role without email, then change nothing", async () => {
      forgetSamMemberOfAcme()
      const otp = magicLinks()
      const db = await dbOf("sam")
      const identity = await resolveAdminOrg(db, as("sam"), admin.orgs.acme.slug)
      const email = admin.persons.sam.email
      expect(await addAdmin(db, identity, { admin_email: email.toUpperCase() }, origin)).toEqual({ email, self: true, outcome: "joined" })
      const [row] = await seed.admin`select role, email from platform.members where org_id = ${admin.orgs.acme.id} and user_id = ${admin.persons.sam.id}`
      expect(row).toEqual({ role: "admin", email })
      const again = await resolveAdminOrg(db, as("sam"), admin.orgs.acme.slug)
      expect(await addAdmin(db, again, { admin_email: email }, origin)).toEqual({ email, self: true, outcome: "unchanged" })
      expect(otp).not.toHaveBeenCalled()
    })

    it("should promote a member, keep an administrator, and invite another address with the admin role", async () => {
      undo.push(() => seed.admin`update platform.members set role = 'member' where org_id = ${admin.orgs.acme.id} and user_id = ${admin.persons.claire.id}`)
      const invited = `new-${admin.persons.claire.email}`
      undo.push(() => seed.admin`delete from platform.invitations where org_id = ${admin.orgs.acme.id} and email = ${invited}`)
      const otp = magicLinks()
      const db = await dbOf("sam")
      const identity = await resolveAdminOrg(db, as("sam"), admin.orgs.acme.slug)
      const claire = admin.persons.claire.email
      expect(await addAdmin(db, identity, { admin_email: claire }, origin)).toEqual({ email: claire, self: false, outcome: "promoted" })
      const ada = admin.persons.ada.email
      expect(await addAdmin(db, identity, { admin_email: ada }, origin)).toEqual({ email: ada, self: false, outcome: "unchanged" })
      const link = `http://${admin.orgs.acme.host}:3000`
      expect(await addAdmin(db, identity, { admin_email: invited }, origin)).toMatchObject({ email: invited, self: false, outcome: "invited", link })
      expect(otp).toHaveBeenCalledTimes(1)
      const roles = await seed.admin`
        select (select role from platform.members where org_id = ${admin.orgs.acme.id} and user_id = ${admin.persons.claire.id}) as claire,
               (select role from platform.invitations where org_id = ${admin.orgs.acme.id} and email = ${invited}) as invited`
      expect([...roles]).toEqual([{ claire: "admin", invited: "admin" }])
    })

    it("should refuse a caller who does not administer the organisation as platform team, before any request", async () => {
      const db = await dbOf("ada")
      const identity = await resolveAdminOrg(db, as("ada"), admin.orgs.acme.slug)
      const spy = recordRequests(db)
      await expect(addAdmin(spy.db, identity, { admin_email: admin.persons.ada.email }, origin)).rejects.toMatchObject({
        code: "forbidden",
        message: STAFF_ADMIN("add_admin", admin.orgs.acme.slug),
      })
      expect(spy.requests).toEqual([])
    })
  })

  describe("update an organisation (AC17)", () => {
    it("should merge settings, remove domains with an empty string, and keep the stored brand fields not passed", async () => {
      // La ligne d'acme de la graine (nom, marque, réglages), remise après le test.
      const seeded = adminTables().orgs.filter((row) => row.id === ORGS.acme.id)
      undo.push(() => admin.write({ orgs: seeded }))
      await admin.write({ orgs: [{ id: ORGS.acme.id, settings: { demo: true, domains: "sales" }, brand: { theme: "cobalt", logo_url: "https://acme.test/logo.png" } }] })
      const db = await dbOf("sam")
      const identity = await resolveAdminOrg(db, as("sam"), admin.orgs.acme.slug)
      const { changes } = await updateOrg(db, identity, { name: "Acme Énergies", domains: "", routing_threshold: 0.7, theme: "foret" })
      expect(changes).toEqual([
        { field: "name", before: "Acme Test", after: "Acme Énergies" },
        { field: "domains", before: "sales", after: null },
        { field: "routing_threshold", before: 0.65, after: 0.7 },
        { field: "theme", before: "cobalt", after: "foret" },
      ])
      const [acme] = await seed.admin<{ name: string; brand: unknown; settings: unknown }[]>`
        select name, brand, settings from platform.orgs where id = ${admin.orgs.acme.id}`
      expect(acme).toMatchObject({ name: "Acme Énergies", brand: { theme: "foret", logo_url: "https://acme.test/logo.png", display_name: null } })
      // Tel que la base le garde (jsonb) : les domaines retirés, les autres clés gardées.
      expect(acme.settings).toEqual({ demo: true, routing: { threshold: 0.7 } })
    })

    // E05-S13 (AC-1) : l'écran « Organisation » n'envoie plus que le nom ; les domaines enregistrés restent.
    it("should keep the stored domains when only the name is sent", async () => {
      const seeded = adminTables().orgs.filter((row) => row.id === ORGS.acme.id)
      undo.push(() => admin.write({ orgs: seeded }))
      await admin.write({ orgs: [{ id: ORGS.acme.id, settings: { domains: "sales, support" } }] })
      const db = await dbOf("sam")
      const identity = await resolveAdminOrg(db, as("sam"), admin.orgs.acme.slug)
      const { changes } = await updateOrg(db, identity, { name: "Acme Énergies" })
      expect(changes).toEqual([{ field: "name", before: "Acme Test", after: "Acme Énergies" }])
      const [acme] = await seed.admin<{ settings: unknown }[]>`select settings from platform.orgs where id = ${admin.orgs.acme.id}`
      expect(acme.settings).toEqual({ domains: "sales, support" })
    })

    it("should refuse a caller who does not administer the organisation before any write, and a concurrent change as a conflict", async () => {
      const { acme } = admin.orgs
      const claireSpy = recordRequests(await dbOf("claire"))
      const claire = await resolveAdminOrg(claireSpy.db, as("claire"), acme.slug)
      await expect(updateOrg(claireSpy.db, claire, { name: "Acme" })).rejects.toMatchObject({
        code: "forbidden",
        message: `Changing the settings of ${acme.slug} is reserved to the administrators of Acme Test (Ada Martin). Ask them.`,
      })
      expect(requestedWrites(claireSpy.requests)).toEqual([])

      // Une autre écriture d'acme entre la lecture de `updateOrg` et la sienne : `updated_at` a changé.
      const raced = recordRequests(await dbOf("sam"), {
        before: async (request) => {
          if (request.write && request.objects.includes("orgs")) await seed.admin`update platform.orgs set updated_at = now() where id = ${acme.id}`
        },
      })
      const identity = await resolveAdminOrg(raced.db, as("sam"), acme.slug)
      await expect(updateOrg(raced.db, identity, { domains: "sales" })).rejects.toMatchObject({
        code: "conflict",
        message: `${acme.slug} changed meanwhile: read it again with admin_org {"op": "get"} and retry.`,
      })
      expect(console.error).toHaveBeenCalledWith("[platform] updateOrg: no row written", acme.id)
    })
  })

  describe("addresses of an organisation (AC18)", () => {
    it("should add a free address, refuse one already served, and remove one in two steps", async () => {
      const { acme, demo } = admin.orgs
      const added = `app.${acme.host}`
      // L'adresse que le test ajoute, puis retire lui-même : celle de la graine, que lisent les autres tests,
      // reste. Retirée après lui s'il échoue avant.
      undo.push(() => seed.admin`delete from platform.org_domains where host = ${added}`)
      const db = await dbOf("sam")
      const identity = await resolveAdminOrg(db, as("sam"), acme.slug)
      expect(await addHost(db, identity, { host: added.toUpperCase() })).toEqual({ host: added })
      await expect(addHost(db, identity, { host: demo.host })).rejects.toMatchObject({ message: `Address ${demo.host} already opens another organisation.` })
      await expect(addHost(db, identity, { host: acme.host })).rejects.toMatchObject({ message: `${acme.host} is already an address of ${acme.slug}.` })
      expect(await removeHost(db, identity, { host: added })).toEqual({ host: added, remaining: [acme.host], removed: false })
      expect(await hostsOf(acme.id)).toContain(added)
      expect(await removeHost(db, identity, { host: added, confirm: true })).toMatchObject({ removed: true })
      expect(await hostsOf(acme.id)).not.toContain(added)
      await expect(removeHost(db, identity, { host: demo.host })).rejects.toMatchObject({
        code: "not_found",
        message: `${demo.host} is not an address of ${acme.slug}. Its addresses: ${acme.host}.`,
      })
    })

    it("should refuse an administrator outside the platform team, and a platform team member who does not administer, before any write", async () => {
      await theoMemberOfAcme()
      const { acme } = admin.orgs
      for (const person of ["ada", "theo"] as const) {
        const spy = recordRequests(await dbOf(person))
        const identity = await resolveAdminOrg(spy.db, as(person), acme.slug)
        await expect(addHost(spy.db, identity, { host: "new.test" })).rejects.toMatchObject({ code: "forbidden", message: STAFF_ADMIN("add_host", acme.slug) })
        await expect(removeHost(spy.db, identity, { host: acme.host, confirm: true })).rejects.toMatchObject({ code: "forbidden" })
        await expect(grantAccess(spy.db, identity, { email: admin.persons.theo.email })).rejects.toMatchObject({
          code: "forbidden",
          message: STAFF_ADMIN("grant_access", acme.slug),
        })
        expect(requestedWrites(spy.requests), person).toEqual([])
      }
    })
  })

  describe("summary of a team deletion (AC21)", () => {
    it("should refuse a caller who does not administer the organisation before any read", async () => {
      // Théo, de l'équipe plateforme, simple membre d'acme sans accès en cours : il n'administre pas.
      await theoMemberOfAcme()
      const spy = recordRequests(await dbOf("theo"))
      const identity = await resolveAdminOrg(spy.db, as("theo"), admin.orgs.acme.slug)
      const resolved = spy.requests.length
      await expect(describeTeamDeletion(spy.db, identity, "support")).rejects.toMatchObject({
        code: "forbidden",
        message: "Only an administrator of Acme Test can delete a team.",
      })
      expect(spy.requests.slice(resolved)).toEqual([])
    })
  })

  describe("platform accesses (AC19, AC24)", () => {
    it("should grant a colleague a dated access, then refuse a second one and an email outside the platform team", async () => {
      forgetTheoOnAcme()
      const { acme } = admin.orgs
      const { theo, ada } = admin.persons
      const db = await dbOf("sam")
      const identity = await resolveAdminOrg(db, as("sam"), acme.slug)
      const granted = await grantAccess(db, identity, { email: theo.email.toUpperCase(), reason: "Pilot support" })
      expect(granted.email).toBe(theo.email)
      const grants = await seed.admin`select org_id, user_id, granted_by, reason from platform.platform_grants where org_id = ${acme.id} and user_id = ${theo.id}`
      expect(admin.readable([...grants])).toEqual([{ org_id: ORGS.acme.id, user_id: PERSONS.theo.id, granted_by: PERSONS.sam.id, reason: "Pilot support" }])
      await expect(grantAccess(db, identity, { email: theo.email })).rejects.toMatchObject({
        code: "conflict",
        message: expect.stringMatching(new RegExp(`^${literal(theo.email)} already has a platform access to ${literal(acme.slug)} \\(since \\d{4}-\\d{2}-\\d{2}\\)\\.$`)),
      })
      await expect(grantAccess(db, identity, { email: ada.email })).rejects.toMatchObject({
        code: "not_found",
        message: `No member of the platform team has the email ${ada.email}.`,
      })
    })

    it("should let a colleague act once granted, then refuse them once revoked, the access read again at each call", async () => {
      forgetTheoOnAcme()
      const { acme } = admin.orgs
      const { theo } = admin.persons
      const samDb = await dbOf("sam")
      const theoDb = await dbOf("theo")
      await expect(resolveAdminOrg(theoDb, as("theo"), acme.slug)).rejects.toMatchObject({ code: "not_found" })
      const sam = await resolveAdminOrg(samDb, as("sam"), acme.slug)
      await grantAccess(samDb, sam, { email: theo.email })
      expect((await resolveAdminOrg(theoDb, as("theo"), acme.slug)).hasOpenGrant).toBe(true)

      const summary = await revokeAccess(samDb, sam, { email: theo.email })
      expect(summary).toMatchObject({ email: theo.email, grantedBy: "Sam Staff", own: false, revoked: false })
      expect((await revokeAccess(samDb, sam, { email: theo.email, confirm: true })).revoked).toBe(true)
      await expect(resolveAdminOrg(theoDb, as("theo"), acme.slug)).rejects.toMatchObject({ code: "not_found" })
      await expect(revokeAccess(samDb, sam, { email: theo.email })).rejects.toMatchObject({
        code: "not_found",
        message: `${theo.email} has no platform access to ${acme.slug} in progress.`,
      })
      expect((await revokeAccess(samDb, sam, { email: admin.persons.sam.email })).own).toBe(true)
    })
  })
})
