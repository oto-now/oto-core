// @vitest-environment node
// Le MCP admin par InMemoryTransport sur une vraie base (E08-S02 : AC6 à AC9, AC12, AC13, AC20 à
// AC23 ; E01-S10, lot t1-d2b) : la session et son ancrage, la garde, la validation des opérations, le
// contrat de `op help`, les opérations d'`admin_context` et d'`admin_team` sur les services d'E05-S03,
// le journal à part. La base des tests admin (`seedAdminFixture`) est semée par la connexion
// d'administration : une graine pour le fichier, et une base à soi, sur la même connexion, pour chaque
// test qui change ce que lisent les autres (organisation, accès, équipes). Slug, préfixe, adresse et emails y sont jetables, et les textes
// attendus les portent. La RLS n'isole que les organisations : ce que le service ne filtre pas revient.
// Une panne ou une course qu'aucune donnée ne provoque, la base simulée la posait sur une requête : l'espion
// des deux faces du client de la session (`spyDb`) la pose de même, avant l'envoi de cette requête.
// En suite portable (`sqlConfigured`) : le projet, ou le Postgres nu du job `bare-postgres`.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { day } from "../../packages/plateforme/mcp/admin/ops"
import { adminTables, codes, connectAdminMcp, ORGS, PERSONS, TEAMS, type AdminPerson } from "../helpers/mcp-admin"
import { seedAdminFixture, type AdminFixtureSql } from "../helpers/mcp-admin-sql"
import { hex } from "../helpers/plateforme"
import type { Row } from "../helpers/simulated-db"
import { isoInstants, seedWithAdmin, spyDb, sqlConfigured, type SeededData, type SentQuery, type SpyOptions, portable } from "../helpers/sql"

const CODE = /^ctx: ([0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}) \(admin session, valid 24 hours\)$/
const MISSING = "Missing or unknown admin ctx. Call admin_context first and pass its ctx code."
const STALE = "Admin ctx expired after 24 hours: call admin_context again, then retry this call."
const HOUR = 3600 * 1000
/** Ce que fait `create`, dans son contrat (`op help`), depuis le premier administrateur exigé (décision du 2026-10-14). */
const CREATE_SUMMARY =
  "Creates an organisation with its root page, context page, personal spaces, your platform access, its first address and its first administrator (admin_email): your own email makes you a member with the admin role at creation, without email; another email is invited with the admin role, by the invitation email of the web app (Équipes)."
const NETWORK_TIMEOUT = 60_000
const SETUP_TIMEOUT = 180_000

/** Une ligne d'ancrage d'`admin_context`, datée de `age` millisecondes. */
function anchor(code: string, userId: string, age: number): Row {
  const ts = new Date(Date.now() - age).toISOString()
  return { id: code, ts, user_id: userId, method: "tools/call", tool: "admin_context", op: "ctx", ctx: code, org_id: null, is_error: false }
}

/** Les éléments dans l'ordre du slug de leur organisation, celui de `listOrgs` : les slugs jetables sont tirés au hasard. */
function bySlug<T>(entries: [string, T][]): T[] {
  return [...entries].sort(([a], [b]) => a.localeCompare(b)).map(([, item]) => item)
}

/** Le jour de création d'une organisation jetable (`seed.createOrg` : le jour du passage, à l'horloge de la base). */
async function createdDay(seed: SeededData, orgId: string): Promise<string> {
  const [row] = await seed.admin<{ day: string }[]>`select to_char(created_at at time zone 'UTC', 'YYYY-MM-DD') as day from platform.orgs where id = ${orgId}`
  return row.day
}

describe("day", () => {
  it("should give the UTC date of an instant whatever its offset, near midnight included (M32)", () => {
    const instants = ["2026-09-27T23:30:00.123456+00:00", "2026-09-28T01:30:00+02:00", "2026-09-27T20:30:00-05:00"]
    expect(instants.map(day)).toEqual(["2026-09-27", "2026-09-27", "2026-09-28"])
  })
})

describe.skipIf(!sqlConfigured)(portable("admin MCP on a real database"), { timeout: NETWORK_TIMEOUT }, () => {
  let seed: SeededData
  let admin: AdminFixtureSql
  /** Les bases à soi des tests, sur la connexion de la graine du fichier : défaites avec elle. */
  const own: AdminFixtureSql[] = []

  beforeAll(async () => {
    seed = seedWithAdmin()
    admin = await seedAdminFixture(seed)
  }, SETUP_TIMEOUT)

  afterAll(async () => {
    try {
      for (const fixture of [admin, ...own]) await fixture?.forgetJournal()
    } finally {
      await seed?.cleanup()
    }
  }, SETUP_TIMEOUT)

  beforeEach(() => {
    // `fromDatabaseError`, les conflits et l'ancrage manqué journalisent côté serveur.
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  /**
   * Une base à soi (organisations et personnes nouvelles), pour un test qui change ce que lisent les
   * autres : organisation, accès, équipes ; sur la connexion de la graine du fichier, la seule de ce fichier.
   */
  async function ownSeed(): Promise<{ seed: SeededData; admin: AdminFixtureSql }> {
    const fixture = await seedAdminFixture(seed)
    own.push(fixture)
    return { seed, admin: fixture }
  }

  /** La session admin de `caller` sur la base `fixture`, ouverte ; son client passe par l'espion (`options` : `before`, `fail`). */
  async function opened(fixture: AdminFixtureSql = admin, caller: AdminPerson = "sam", options: SpyOptions = {}) {
    const person = await fixture.deps(caller)
    const session = await connectAdminMcp({ ...person, db: spyDb(person.db, options).db })
    const { code } = await session.openAdmin()
    return { session, code }
  }

  /** Le dernier identifiant du journal admin : les lignes d'un test sont celles d'après. */
  async function lastAdminLine(): Promise<number> {
    const [row] = await seed.admin<{ id: number }[]>`select coalesce(max(id), 0)::int as id from platform.admin_journal`
    return row.id
  }

  describe("admin session (AC6)", () => {
    it("should serve the code on the first line and in structuredContent, its anchor line written before the answer", async () => {
      const mark = await lastAdminLine()
      const session = await connectAdminMcp(await admin.deps("sam"))
      const result = await session.openAdmin()
      expect(result.text.split("\n")[0]).toMatch(CODE)
      expect(result.structured?.ctx).toBe(result.code)
      // Les lignes de Sam écrites depuis la marque : l'ancrage, seul (la base simulée comparait tout `admin_journal`).
      const lines = await seed.admin<Row[]>`
        select method, tool, op, ctx, user_id, org_id, is_error from platform.admin_journal where user_id = ${admin.persons.sam.id} and id > ${mark} order by id`
      expect(admin.readable([...lines])).toEqual([
        expect.objectContaining({ method: "tools/call", tool: "admin_context", op: "ctx", ctx: result.code, user_id: PERSONS.sam.id, org_id: null, is_error: false }),
      ])
      // L'ancrage est la ligne de l'appel : rien d'autre n'attend la fin de la requête.
      expect(session.deps.journal).toEqual([])
    })

    it("should serve no code when its anchor line cannot be written", async () => {
      // La base refuse l'ancrage d'une personne hors de l'équipe plateforme (`admin_journal_insert_staff`) :
      // une écriture qui échoue pour de vrai, sur les deux faces de la base.
      const session = await connectAdminMcp(await admin.deps("ada"))
      const refused = await session.call("admin_context", { op: "orgs" })
      expect(refused.isError).toBe(true)
      expect(refused.text).toBe("Could not open an admin session. Retry once.")
      expect(session.deps.journal).toEqual([
        expect.objectContaining({ tool: "admin_context", ctx: null, is_error: true, error: "internal: Could not open an admin session. Retry once." }),
      ])
    })
  })

  describe("admin ctx guard (AC7)", () => {
    it("should refuse a missing, foreign or expired code before reading the arguments", async () => {
      await admin.write({ admin_journal: [anchor("AAAA-BBBB", PERSONS.theo.id, HOUR), anchor("CCCC-DDDD", PERSONS.sam.id, 25 * HOUR)] })
      try {
        const session = await connectAdminMcp(await admin.deps("sam"))
        expect((await session.call("admin_org", { op: "frobnicate" })).text).toBe(MISSING)
        expect((await session.call("admin_org", { ctx: admin.id("AAAA-BBBB"), op: "list" })).text).toBe(MISSING)
        const stale = await session.call("admin_org", { ctx: admin.id("CCCC-DDDD"), op: "list" })
        expect(stale).toMatchObject({ isError: true, text: STALE })
        expect(session.deps.journal.map((line) => line.error)).toEqual([`ctx_missing: ${MISSING}`, `ctx_missing: ${MISSING}`, `ctx_stale: ${STALE}`])
      } finally {
        await seed.admin`delete from platform.admin_journal where ctx in ${seed.admin([admin.id("AAAA-BBBB"), admin.id("CCCC-DDDD")])}`
      }
    })
  })

  describe("operation and fields (AC8, AC9)", () => {
    it("should refuse an unknown op, a field the op does not use, and an invalid value, naming what is expected", async () => {
      const { session, code } = await opened()
      const acme = admin.orgs.acme.slug
      const unknown = await session.call("admin_org", { ctx: code, op: "delete", org: acme })
      expect(unknown.text).toBe("Unknown op delete for admin_org. Operations: help, list, get, create, update, add_host, remove_host, grant_access, revoke_access, add_admin.")
      const extra = await session.call("admin_org", { ctx: code, op: "get", org: acme, name: "Acme" })
      expect(extra.text).toBe('Field name is not used by op get of admin_org. Fields of get: org. Call admin_org {"op": "help"} for details.')
      const invalid = await session.call("admin_org", { ctx: code, op: "create", org: "acme2", name: "Acme Deux", prefix: "2acme", admin_email: "alice@example.com" })
      expect(invalid.text).toBe(
        'Invalid arguments for admin_org op create: prefix: 2 to 12 lowercase letters or digits, starting with a letter. Call admin_org {"op": "help"} for details.',
      )
      expect(codes(session.deps.journal)).toEqual(["invalid_arguments", "invalid_arguments", "invalid_arguments"])
    })

    it("should require org on an operation that targets an organisation", async () => {
      const { session, code } = await opened()
      const refused = await session.call("admin_team", { ctx: code, op: "list" })
      expect(refused).toMatchObject({ isError: true, text: 'op list of admin_team needs org = the organisation slug. List yours with admin_context {"op": "orgs"}.' })
      expect(codes(session.deps.journal)).toEqual(["invalid_arguments"])
    })
  })

  describe("op help (contract of the operations)", () => {
    it("should serve each operation with its two steps, required and optional fields, an example and its refusals", async () => {
      const { session, code } = await opened()
      const { text, isError } = await session.call("admin_org", { ctx: code, op: "help" })
      expect(isError).toBe(false)
      expect(text).toContain("- ctx_stale: Admin ctx expired after 24 hours: call admin_context again, then retry this call.")
      expect(text).toContain(
        [
          "Op create (two steps: without confirm: true it returns a summary and changes nothing)",
          `${CREATE_SUMMARY}`,
          "Required: org, name, prefix, admin_email. Optional: host, confirm.",
          'Example: admin_org {"op":"create","ctx":"7K3Q-M2XA","org":"acme2","name":"Acme Deux","prefix":"acmedeux","host":"acme2.localhost","admin_email":"alice@example.com"}',
          "Possible refusals:",
          "- invalid_arguments: Inviting <admin_email> needs an address of <org> to sign in at: pass host, or name yourself with admin_email.",
          "- conflict: Address <host> already opens another organisation.",
        ].join("\n"),
      )
      // Décision du 2026-10-14 : l'opération qui nomme un administrateur d'une organisation existante, ajoutée en dernier.
      expect(text.endsWith(
        [
          "Op add_admin",
          "Names an administrator of the organisation, by the rule of create: your own email makes you a member with the admin role at once, without email; a member becomes an administrator; another email is invited with the admin role, by the invitation email of the web app (Équipes).",
          "Required: org, admin_email. Optional: none.",
          'Example: admin_org {"op":"add_admin","ctx":"7K3Q-M2XA","org":"acme","admin_email":"alice@example.com"}',
          "Possible refusals:",
          '- invalid_arguments: Inviting <admin_email> needs an address of <org> to sign in at: add one with admin_org {"op": "add_host"} first.',
          "- conflict: An invitation is already pending for <admin_email>. Revoke it to send another.",
          "- forbidden: op <op> of admin_org is reserved to platform team members who administer <org>.",
        ].join("\n"),
      )).toBe(true)
      expect(text).toContain("Op get\nReads an organisation")
    })

    it("should add the addresses of the application to the help of create when the host plugs a creation hook, the rest unchanged (E09-S02, AC7)", async () => {
      const deps = await admin.deps("sam")
      const help = async (session: Awaited<ReturnType<typeof connectAdminMcp>>) => {
        const { code } = await session.openAdmin()
        return (await session.call("admin_org", { ctx: code, op: "help" })).text
      }
      const without = await help(await connectAdminMcp(deps))
      const hooked = await help(await connectAdminMcp({ ...deps, orgCreation: { addresses: () => [], created: async () => [] } }))
      const summary = CREATE_SUMMARY
      const added = "The application may add its own addresses, for example a sub-domain of this cell: the summary lists them before anything is created."
      expect(without).not.toContain(added)
      expect(hooked).toBe(without.replace(summary, `${summary} ${added}`))
    })
  })

  describe("admin_context (AC12, AC13)", () => {
    it("should say who calls, where they act (current access and membership, not a revoked access) and the admin tools", async () => {
      const { session } = await opened()
      const result = await session.openAdmin()
      const { acme, demo } = admin.orgs
      expect(result.text.split("\n").slice(1)).toEqual([
        `Signed in as ${admin.persons.sam.email}, in the platform team since 2026-09-01.`,
        "You can act on 2 organisations:",
        ...bySlug([
          [acme.slug, `- ${acme.slug} · Acme Test · platform access since 2026-09-20`],
          [demo.slug, `- ${demo.slug} · Démo · admin (member)`],
        ]),
        "Admin tools (pass ctx on every call, and org = the organisation slug):",
        "- admin_org: list, get, create, update, add_host, remove_host, grant_access, revoke_access, add_admin",
        "- admin_team: list, create, rename, set_lead, add_lead, remove_lead, add_member, remove_member, delete",
        "- admin_node: move, publish, transfer_owner, rules, add_rule, remove_rule",
        "- admin_connector: catalogue, activate, deactivate, accounts, create_account, disable_account, account_rules, add_account_rule, remove_account_rule",
        "- admin_journal: conversations, conversation, admin_log",
        "- admin_feedback: list, set_state",
        "- admin_cell: version, migrations, health",
        "Call any admin tool with op help for the fields of its operations.",
      ])
      expect(isoInstants(result.structured?.orgs)).toEqual(
        bySlug([
          [acme.slug, { slug: acme.slug, name: "Acme Test", prefix: acme.prefix, access: "platform_access", since: "2026-09-20T08:00:00.000Z" }],
          [demo.slug, { slug: demo.slug, name: "Démo", prefix: demo.prefix, access: "member", role: "admin", since: "2026-09-10T08:00:00.000Z" }],
        ]),
      )
      const reach = await session.openAdmin({ op: "orgs" })
      expect(reach.text.split("\n").slice(1)).toEqual([
        "Organisations you can act on (2):",
        ...bySlug([
          [acme.slug, `- ${acme.slug} · Acme Test · prefix ${acme.prefix} · 1 address · platform access since 2026-09-20 (granted by ${admin.persons.theo.email})`],
          [demo.slug, `- ${demo.slug} · Démo · prefix ${demo.prefix} · 1 address · admin (member)`],
        ]),
      ])
    })

    it("should tell a platform team member without any access where to start", async () => {
      // Théo n'a qu'un accès, à other : retiré le temps du test, il n'agit nulle part ; puis rendu (sa ligne d'`adminTables`).
      await seed.admin`delete from platform.platform_grants where user_id = ${admin.persons.theo.id}`
      try {
        const session = await connectAdminMcp(await admin.deps("theo"))
        const result = await session.openAdmin({ op: "orgs" })
        expect(result.text.split("\n").slice(1)).toEqual([
          'You can act on no organisation yet. Create one with admin_org {"op": "create"}, or ask a colleague who has access to grant you one.',
        ])
      } finally {
        await admin.write({ platform_grants: adminTables().platform_grants.filter((row) => row.user_id === PERSONS.theo.id) })
      }
    })
  })

  describe("admin_org texts (AC14 to AC19)", () => {
    it("should list the organisations, read a sheet with the six tool names, summarise a creation without creating, and say each setting changed", async () => {
      const mine = await ownSeed()
      const { session, code } = await opened(mine.admin)
      const org = (args: Record<string, unknown>) => session.call("admin_org", { ctx: code, ...args })
      const { acme, demo } = mine.admin.orgs
      const { ada, sam } = mine.admin.persons
      const created = { acme: await createdDay(mine.seed, acme.id), demo: await createdDay(mine.seed, demo.id) }
      const list = await org({ op: "list" })
      expect(list.text).toBe(
        [
          "Organisations you can act on (2):",
          ...bySlug([
            [
              acme.slug,
              `- ${acme.slug} · Acme Test · prefix ${acme.prefix} · addresses ${acme.host} · 3 members · 3 teams · created ${created.acme} · platform access: ${sam.email} since 2026-09-20`,
            ],
            [demo.slug, `- ${demo.slug} · Démo · prefix ${demo.prefix} · addresses ${demo.host} · 1 member · 0 teams · created ${created.demo} · no platform access`],
          ]),
        ].join("\n"),
      )
      expect(list.structured?.next_actions).toEqual(["admin_org get", "admin_team list"])
      const tools = ["context", "find", "read", "call", "write", "feedback"].map((tool) => `${acme.prefix}_${tool}`).join(", ")
      expect((await org({ op: "get", org: acme.slug })).text).toBe(
        [
          `Organisation ${acme.slug} (Acme Test), created ${created.acme}.`,
          `Tools (prefix ${acme.prefix}, which never changes): ${tools}.`,
          `Addresses: ${acme.host}.`,
          "Work domains: none.",
          "Brand: theme manuscrit, logo none.",
          "Routing: threshold 0.65, gap 0.1.",
          "Flags: none.",
          "Rules version: 1.",
          `Administrators: Ada Martin <${ada.email}>.`,
          `Contact shown to non-members: Ada Martin <${ada.email}>.`,
          `Platform accesses in progress: ${sam.email} since 2026-09-20 (granted by Théo Staff).`,
          "Revoked platform accesses (last 5): none.",
        ].join("\n"),
      )
      // Slug et adresse jetables : aucune organisation du projet partagé ne les porte.
      const draft = { org: `t${hex(4)}`, name: "Acme Deux", prefix: "acmedeux", host: `t${hex(4)}.example.invalid`, admin_email: "alice@example.com" }
      const preview = await org({ op: "create", ...draft })
      expect(preview).toMatchObject({ isError: false, structured: expect.objectContaining({ next_actions: [] }) })
      expect(preview.text).toBe(
        [
          `About to create organisation Acme Deux (slug ${draft.org}).`,
          "Its assistant tools will be named acmedeux_context, acmedeux_find, acmedeux_read, acmedeux_call, acmedeux_write, acmedeux_feedback, for good: the prefix never changes and no operation deletes an organisation.",
          `Address: ${draft.host}`,
          // Décision du 2026-10-14 : le récapitulatif dit lequel des deux cas se produira, ici une invitation.
          `First administrator: alice@example.com, invited with the admin role once it is created, by the invitation email of the web app (Équipes), with a link to http://${draft.host}:3000, valid 7 days; they become a member when they sign in with that address.`,
          // E05-S13 (AC-7) : plus de promesse d'un écran client qui montre et révoque l'accès.
          "You get a platform access to it. Your calls are recorded in its journal, which its administrators read.",
          "Nothing was created. Show this to the user and ask for explicit approval, then call again with confirm: true.",
        ].join("\n"),
      )
      const [{ count }] = await mine.seed.admin<{ count: number }[]>`select count(*)::int as count from platform.orgs where slug = ${draft.org}`
      expect(count).toBe(0)
      expect((await org({ op: "update", org: acme.slug, name: "Acme Énergies", routing_gap: 0.2 })).text).toBe(
        [
          `${acme.slug} updated: name Acme Test → Acme Énergies; routing_gap 0.1 → 0.2.`,
          "The tool descriptions changed: users see them after refreshing the connector (claude.ai « Actualiser la liste d'outils », ChatGPT « Actualiser »).",
        ].join("\n"),
      )
      expect((await org({ op: "update", org: acme.slug })).text).toBe(
        "Nothing to update: pass at least one of name, domains, display_name, theme, logo_url, routing_threshold, routing_gap.",
      )
    })

    it("should add an address, summarise its removal, grant an access and summarise the revocation of one's own", async () => {
      const mine = await ownSeed()
      const { session, code } = await opened(mine.admin)
      const { acme } = mine.admin.orgs
      const { sam, theo } = mine.admin.persons
      const org = (args: Record<string, unknown>) => session.call("admin_org", { ctx: code, org: acme.slug, ...args })
      // Une adresse jetable : l'adresse d'une organisation est unique sur tout le projet partagé.
      const host = `t${hex(4)}.example.invalid`
      expect((await org({ op: "add_host", host })).text).toBe(
        `Address ${host} now opens ${acme.slug}. Its DNS record and its domain on the hosting side are set outside the platform.`,
      )
      expect((await org({ op: "remove_host", host: acme.host })).text).toBe(
        [
          `About to remove address ${acme.host} from ${acme.slug}: assistants connected through https://${acme.host}/api/mcp fail at their next call (unknown address), and the web app at this address shows « adresse inconnue ». Remaining addresses: ${host}.`,
          "Nothing was removed. Show this to the user and ask for explicit approval, then call again with confirm: true.",
        ].join("\n"),
      )
      const today = new Date().toISOString().slice(0, 10)
      expect((await org({ op: "grant_access", email: theo.email })).text).toBe(
        `${theo.email} now has a platform access to ${acme.slug} (granted by you on ${today}). They act as an administrator of ${acme.slug}, personal spaces excepted. Their calls are recorded in its journal, which its administrators read.`,
      )
      expect((await org({ op: "revoke_access", email: sam.email })).text).toBe(
        [
          `About to revoke the platform access of ${sam.email} to ${acme.slug} (granted on 2026-09-20 by Théo Staff): they stop acting on ${acme.slug} at their next call; the dated line stays.`,
          `This is your own access: you will no longer act on ${acme.slug}.`,
          "Nothing was revoked. Show this to the user and ask for explicit approval, then call again with confirm: true.",
        ].join("\n"),
      )
      expect((await org({ op: "revoke_access", email: sam.email, confirm: true })).text).toBe(`Platform access of ${sam.email} to ${acme.slug} revoked.`)
    })

    it("should name an administrator: oneself a member at once, a member promoted, an administrator unchanged (add_admin, 2026-10-14)", async () => {
      const mine = await ownSeed()
      const { session, code } = await opened(mine.admin)
      const { acme } = mine.admin.orgs
      const { sam, claire, ada } = mine.admin.persons
      const named = (email: string) => session.call("admin_org", { ctx: code, op: "add_admin", org: acme.slug, admin_email: email })
      const self = await named(sam.email.toUpperCase())
      expect(self).toMatchObject({ isError: false, text: `You (${sam.email}) are now a member of ${acme.slug} with the admin role.` })
      expect(self.structured).toMatchObject({ admin: { email: sam.email, self: true, outcome: "joined" }, next_actions: ["admin_org get"] })
      expect((await named(sam.email)).text).toBe(`You (${sam.email}) are already an administrator of ${acme.slug}: nothing changed.`)
      expect((await named(claire.email)).text).toBe(`${claire.email} is now an administrator of ${acme.slug}: they were a member.`)
      expect((await named(ada.email)).text).toBe(`${ada.email} is already an administrator of ${acme.slug}: nothing changed.`)
      const roles = await mine.seed.admin<Row[]>`select user_id, role from platform.members where org_id = ${acme.id} and role = 'admin' order by user_id`
      expect(roles.map((row) => mine.admin.readable(row)).sort((a, b) => String(a.user_id).localeCompare(String(b.user_id)))).toEqual(
        [PERSONS.ada.id, PERSONS.claire.id, PERSONS.sam.id].sort().map((id) => ({ user_id: id, role: "admin" })),
      )
    })
  })

  describe("admin_team (AC20)", () => {
    it("should run each operation through the team services of E05-S03 and say what changed", async () => {
      const mine = await ownSeed()
      const { session, code } = await opened(mine.admin)
      const { acme } = mine.admin.orgs
      const { claire, marc } = mine.admin.persons
      const team = (args: Record<string, unknown>) => session.call("admin_team", { ctx: code, org: acme.slug, ...args })
      // E05-S13 : les responsables se lisent sur `team_members.role`.
      const leads = async (slug: string) => {
        const rows = await mine.seed.admin<Row[]>`
          select tm.user_id from platform.team_members tm join platform.teams t on t.id = tm.team_id
           where t.org_id = ${acme.id} and t.slug = ${slug} and tm.role = 'lead'`
        return rows.map((row) => mine.admin.readable(row).user_id)
      }
      expect((await team({ op: "list" })).text).toBe(
        ["- conseil · Conseil · no lead · 0 members", "- support · Support · no lead · 1 member", `- ventes · Ventes · lead Claire Morel ${claire.email} · 1 member`].join("\n"),
      )
      expect((await team({ op: "create", name: "Achats", email: marc.email })).text).toBe(
        `Team Achats created in ${acme.slug} with the slug achats (folder achats, context page achats/contexte), lead Marc Petit ${marc.email}.`,
      )
      expect(await leads("achats")).toEqual([PERSONS.marc.id])
      expect((await team({ op: "rename", team: "conseil", name: "Conseil France" })).text).toBe("Team renamed: Conseil → Conseil France (slug conseil).")
      expect((await team({ op: "set_lead", team: "ventes", email: "" })).text).toBe("Team Ventes has no lead now.")
      expect((await team({ op: "set_lead", team: "ventes", email: marc.email })).text).toBe(`Marc Petit ${marc.email} now leads team Ventes.`)
      expect(await leads("ventes")).toEqual([PERSONS.marc.id])
      expect((await team({ op: "add_member", team: "support", email: claire.email })).text).toBe(`Claire Morel ${claire.email} added to team Support (2 members).`)
      expect((await team({ op: "remove_member", team: "support", email: marc.email })).text).toBe("Marc Petit removed from team Support (1 member; lead: none).")
    })

    it("should name its creator as the lead of a team created without email, unless she enters by a platform access (E11-S10, AC-c3)", async () => {
      const mine = await ownSeed()
      const { session, code } = await opened(mine.admin)
      const { acme, demo } = mine.admin.orgs
      const { sam, marc } = mine.admin.persons
      const team = (org: string, args: Record<string, unknown>) => session.call("admin_team", { ctx: code, org, ...args })
      const roles = async (orgId: string, slug: string) => {
        const rows = await mine.seed.admin<Row[]>`
          select tm.user_id, tm.role from platform.team_members tm join platform.teams t on t.id = tm.team_id
           where t.org_id = ${orgId} and t.slug = ${slug} order by tm.role`
        return rows.map((row) => mine.admin.readable(row))
      }
      // Membre de Demo : Sam en est le responsable.
      expect((await team(demo.slug, { op: "create", name: "Achats" })).text).toBe(
        `Team Achats created in ${demo.slug} with the slug achats (folder achats, context page achats/contexte), lead Sam Staff ${sam.email} (you).`,
      )
      expect(await roles(demo.id, "achats")).toEqual([{ user_id: PERSONS.sam.id, role: "lead" }])
      // Entrée dans Acme par un accès plateforme, sans ligne `members` : personne n'entre.
      expect((await team(acme.slug, { op: "create", name: "Achats" })).text).toBe(
        `Team Achats created in ${acme.slug} with the slug achats (folder achats, context page achats/contexte), no lead yet.`,
      )
      expect(await roles(acme.id, "achats")).toEqual([])
      // Avec `email` : la personne nommée est la seule responsable, le créateur reste membre (HN-E11S10-9).
      await mine.seed.admin`insert into platform.members (org_id, user_id, role, email, name) values (${demo.id}, ${marc.id}, 'member', ${marc.email}, 'Marc Petit')`
      expect((await team(demo.slug, { op: "create", name: "Stock", email: marc.email })).text).toBe(
        `Team Stock created in ${demo.slug} with the slug stock (folder stock, context page stock/contexte), lead Marc Petit ${marc.email}.`,
      )
      expect(await roles(demo.id, "stock")).toEqual([
        { user_id: PERSONS.marc.id, role: "lead" },
        { user_id: PERSONS.sam.id, role: "member" },
      ])
    })

    it("should refuse an unknown team or email, a taken name and a person out of the team, and accept a member already in", async () => {
      const { session, code } = await opened()
      const acme = admin.orgs.acme.slug
      const { ada, marc } = admin.persons
      const team = (args: Record<string, unknown>) => session.call("admin_team", { ctx: code, org: acme, ...args })
      expect((await team({ op: "add_member", team: "nope", email: marc.email })).text).toBe(`Unknown team nope in ${acme}. Teams: conseil, support, ventes.`)
      expect((await team({ op: "add_member", team: "support", email: "nobody@acme.test" })).text).toBe(
        `No member of ${acme} has the email nobody@acme.test. Invite them first from the web app (Équipes).`,
      )
      expect((await team({ op: "create", name: "VENTES" })).text).toBe(`A team named VENTES (or with the slug ventes) already exists in ${acme}. Pick another name.`)
      expect((await team({ op: "remove_member", team: "support", email: ada.email })).text).toBe(`${ada.email} is not a member of team Support.`)
      const again = await team({ op: "add_member", team: "support", email: marc.email })
      expect(again).toMatchObject({ isError: false, text: `${marc.email} is already a member of team Support; nothing changed.` })
      expect(codes(session.deps.journal)).toEqual(["not_found", "not_found", "conflict", "not_found", null])
    })

    it("should say that a team was created without its lead when the lead cannot be set", async () => {
      const mine = await ownSeed()
      // La base ne répond pas à l'écriture du responsable, sur `team_members` (`57014`, comme la base simulée).
      const leadFails = (query: SentQuery) => (query.op === "update" && query.target === "team_members" ? { code: "57014" } : null)
      const { session, code } = await opened(mine.admin, "sam", { fail: leadFails })
      const { acme } = mine.admin.orgs
      const created = await session.call("admin_team", { ctx: code, org: acme.slug, op: "create", name: "Achats", email: mine.admin.persons.marc.email })
      expect(created).toMatchObject({
        isError: true,
        text: 'Team Achats was created (slug achats) but its lead could not be set: call admin_team {"op": "set_lead"}.',
      })
      const [{ count }] = await mine.seed.admin<{ count: number }[]>`select count(*)::int as count from platform.teams where org_id = ${acme.id} and slug = 'achats'`
      expect(count).toBe(1)
    })

    it("should tell how to create the first team of an organisation without any", async () => {
      // demo n'a aucune équipe, et Sam l'administre : la base simulée vidait celles d'acme.
      const { session, code } = await opened()
      const demo = admin.orgs.demo.slug
      const { text } = await session.call("admin_team", { ctx: code, org: demo, op: "list" })
      expect(text).toBe(`${demo} has no team yet. Create one with admin_team {"op": "create", "org": "${demo}", "name": "<Name>"}.`)
    })
  })

  describe("admin_team delete (AC21)", () => {
    it("should refuse to delete a team that owns a page, with or without confirm", async () => {
      const { session, code } = await opened()
      for (const confirm of [undefined, true]) {
        const refused = await session.call("admin_team", { ctx: code, org: admin.orgs.acme.slug, op: "delete", team: "support", confirm })
        expect(refused.text).toBe(
          "Team Support owns 1 page (support/faq): it cannot be deleted while it owns them. Transfer the pages to another owner first; a team that owns accounts cannot be deleted in V1.",
        )
      }
      expect(codes(session.deps.journal)).toEqual(["conflict", "conflict"])
    })

    it("should summarise the deletion without deleting, then delete once confirmed", async () => {
      const mine = await ownSeed()
      const { session, code } = await opened(mine.admin)
      const { acme } = mine.admin.orgs
      const conseil = async () => {
        const [{ count }] = await mine.seed.admin<{ count: number }[]>`select count(*)::int as count from platform.teams where id = ${mine.admin.id(TEAMS.conseil.id)}`
        return count
      }
      // Ventes : Claire en est membre et c'est son équipe par défaut.
      const ventes = await session.call("admin_team", { ctx: code, org: acme.slug, op: "delete", team: "ventes" })
      expect(ventes.text).toBe(
        [
          `About to delete team Ventes (ventes) of ${acme.slug}: its 1 member (Claire Morel) lose this team; 0 access rules that name it are removed.`,
          "Nothing was deleted. Show this to the user and ask for explicit approval, then call again with confirm: true.",
        ].join("\n"),
      )
      const summary = await session.call("admin_team", { ctx: code, org: acme.slug, op: "delete", team: "conseil" })
      expect(summary.text).toBe(
        [
          `About to delete team Conseil (conseil) of ${acme.slug}: it has no member; 1 access rule that names it is removed.`,
          "Nothing was deleted. Show this to the user and ask for explicit approval, then call again with confirm: true.",
        ].join("\n"),
      )
      expect(summary.structured?.next_actions).toEqual([])
      expect(await conseil()).toBe(1)
      const deleted = await session.call("admin_team", { ctx: code, org: acme.slug, op: "delete", team: "conseil", confirm: true })
      expect(deleted.text).toBe(`Team Conseil deleted from ${acme.slug}.`)
      expect(await conseil()).toBe(0)
    })

    it("should serve the blocked text when a page is placed between the two steps", async () => {
      const mine = await ownSeed()
      const conseil = { org_id: ORGS.acme.id, owner_kind: "team", owner_team_id: TEAMS.conseil.id, owner_user_id: null }
      // Le schéma veut le dossier de Conseil sous la page (`nodes_guard`) : posé d'abord, il ne bloque rien.
      await mine.admin.write({ nodes: [{ id: "node-conseil", path: "conseil", ...conseil }] })
      // `deleteTeam` relit l'équipe par son identifiant, puis ce qu'elle possède : la page arrive juste avant cette
      // lecture, après le récapitulatif (`meanwhile` de la base simulée).
      let placed = false
      const late = async (query: SentQuery) => {
        if (placed || query.op !== "select" || query.target !== "teams" || !/[?&]id=eq\.|\bwhere id = \?/.test(String(query.detail))) return
        placed = true
        await mine.admin.write({ nodes: [{ id: "node-late", path: "conseil/offre", ...conseil }] })
      }
      const { session, code } = await opened(mine.admin, "sam", { before: late })
      const refused = await session.call("admin_team", { ctx: code, org: mine.admin.orgs.acme.slug, op: "delete", team: "conseil", confirm: true })
      expect(refused.text).toBe(
        "Team Conseil owns 1 page (conseil/offre): it cannot be deleted while it owns them. Transfer the pages to another owner first; a team that owns accounts cannot be deleted in V1.",
      )
      expect(codes(session.deps.journal)).toEqual(["conflict"])
    })
  })

  describe("separate admin journal (AC22)", () => {
    it("should write one line per request of the caller in admin_journal, secrets masked, and none in journal", async () => {
      const before = await lastAdminLine()
      const { session, code } = await opened()
      const acme = admin.orgs.acme.slug
      const sam = admin.persons.sam.id
      await session.client.listTools()
      await session.call("admin_org", { ctx: code, op: "get", org: acme })
      await session.call("admin_org", { ctx: code, op: "get", org: acme, api_key: "sk-test" })
      await session.flush()
      const linesAfter = async (mark: number) =>
        admin.readable([
          ...(await seed.admin<Row[]>`
            select method, tool, op, is_error, user_id, user_agent, ctx, org_id, target, args, error, result_chars
              from platform.admin_journal where user_id in (${sam}, ${admin.persons.theo.id}) and id > ${mark} order by id`),
        ])
      const lines = await linesAfter(before)
      expect(lines.map((line) => [line.method, line.tool, line.op, line.is_error])).toEqual([
        ["tools/call", "admin_context", "ctx", false],
        ["tools/list", null, null, false],
        ["tools/call", "admin_org", "get", false],
        ["tools/call", "admin_org", "get", true],
      ])
      expect(lines.every((line) => line.user_id === PERSONS.sam.id && line.user_agent === "vitest")).toBe(true)
      expect(lines[2]).toMatchObject({ ctx: code, org_id: ORGS.acme.id, target: `org:${acme}`, args: { ctx: code, op: "get", org: acme } })
      expect(lines[3]).toMatchObject({ org_id: null, args: { api_key: "[masked]" }, error: expect.stringMatching(/^invalid_arguments: Field api_key is not used/) })
      for (const line of lines.slice(2)) expect(line.result_chars).toBeGreaterThan(0)
      const [{ count }] = await seed.admin<{ count: number }[]>`select count(*)::int as count from platform.journal where user_id = ${sam}`
      expect(count).toBe(0)

      // Une ligne empilée au nom d'un autre part au nom de l'appelant : le journal n'écrit que ses lignes.
      const flushed = await lastAdminLine()
      session.deps.journal.splice(0, session.deps.journal.length, { user_id: admin.persons.theo.id, method: "tools/list" })
      await session.flush()
      expect(await linesAfter(flushed)).toEqual([expect.objectContaining({ method: "tools/list", user_id: PERSONS.sam.id })])
    })
  })

  describe("long lists (AC23)", () => {
    it("should stop a list at 200 lines, then say how many more", async () => {
      const mine = await ownSeed()
      const sam = mine.admin.persons.sam
      // 200 organisations jetables de plus, dont Sam est membre, en deux écritures ; retirées avec leurs membres.
      const more = Array.from({ length: 200 }, () => `t${hex(4)}`).map((slug) => ({ name: `test_${slug.slice(1)}`, slug, prefix: slug }))
      const ids = (await mine.seed.admin<{ id: string }[]>`insert into platform.orgs ${mine.seed.admin(more)} returning id`).map((row) => row.id)
      try {
        const members = ids.map((orgId) => ({ org_id: orgId, user_id: sam.id, role: "member", email: sam.email }))
        await mine.seed.admin`insert into platform.members ${mine.seed.admin(members)}`
        const { session, code } = await opened(mine.admin)
        const lines = (await session.call("admin_org", { ctx: code, op: "list" })).text.split("\n")
        expect(lines[0]).toBe("Organisations you can act on (202):")
        expect(lines).toHaveLength(202)
        expect(lines.at(-1)).toBe("… and 2 more")
      } finally {
        await mine.seed.admin`delete from platform.orgs where id in ${mine.seed.admin(ids)}`
      }
    })
  })
})
