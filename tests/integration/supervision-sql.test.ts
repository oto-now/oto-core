// @vitest-environment node
// La supervision de la plateforme (administration et cellule, N9 ; migration `20261102090000`) sur une vraie base,
// en suite portable : les trois fonctions `staff_org_*` refusent qui n'est pas de l'équipe plateforme (42501), sont
// `security definer` à `search_path` vide, ne rendent aucune colonne secrète, et rendent à un membre de l'équipe
// plateforme sans accès à une organisation son identité, ses chiffres, ses membres et ses comptes ; les services
// `listPlatformOrgs` et `readPlatformOrg` décident l'équipe plateforme avant toute lecture (`forbidden`) et rendent
// `not_found` pour un slug inconnu. La base des tests admin (`seedAdminFixture`) : Théo, de l'équipe plateforme, n'a
// ni appartenance ni accès à acme ; Ada en est l'administratrice, hors de l'équipe plateforme.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { listPlatformOrgs, readPlatformOrg } from "../../packages/plateforme/server/admin/supervision"
import { ORGS, PERSONS, TEAMS, type AdminPerson } from "../helpers/mcp-admin"
import { seedAdminFixture, type AdminFixtureSql } from "../helpers/mcp-admin-sql"
import { pendingMigrations, pendingReason } from "../helpers/pending-migrations"
import { hex } from "../helpers/plateforme"
import { asCaller, codeOf, seedWithAdmin, SQL_SKIP_REASON, sqlConfigured, type SeededData } from "../helpers/sql"

const VERSION = "20261102090000"
const pending = (await pendingMigrations()).includes(VERSION)
const SETUP_TIMEOUT = 180_000
const NETWORK_TIMEOUT = 60_000
const NAME = "supervision of the platform (N9)"
const SUITE = !sqlConfigured ? `${NAME} (${SQL_SKIP_REASON})` : pending ? `${NAME} (${pendingReason([VERSION])})` : NAME

/** Les trois fonctions, chacune avec un appel sous l'appelant. */
const FUNCTIONS = ["staff_org_overview", "staff_org_members", "staff_org_accounts"] as const

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe.skipIf(!sqlConfigured || pending)(SUITE, { timeout: NETWORK_TIMEOUT }, () => {
  let seed: SeededData
  let admin: AdminFixtureSql

  beforeAll(async () => {
    seed = seedWithAdmin()
    admin = await seedAdminFixture(seed)
    // Un compte d'équipe, un compte personnel de Claire, mail actif, un appel récent, un appel ancien et une
    // ligne `tools/list` : seul l'appel récent compte.
    const recent = new Date(Date.now() - 3600 * 1000).toISOString()
    const old = new Date(Date.now() - 40 * 24 * 3600 * 1000).toISOString()
    const call = { org_id: ORGS.acme.id, user_id: PERSONS.claire.id, team_id: null, ctx: null, tool: "acme_read", target: null, is_error: false, error: null, host: null, user_agent: null, account_id: null, duration_ms: 5, args: {} }
    await admin.write({
      connector_activations: [{ org_id: ORGS.acme.id, connector: "mail", state: "active", activated_by: PERSONS.ada.id, updated_at: recent }],
      accounts: [
        { id: "c2000000-0000-4000-8000-000000000101", org_id: ORGS.acme.id, connector: "mail", label: "Mail Ventes", mode: "simule", status: "active", owner_kind: "team", owner_team_id: TEAMS.ventes.id, owner_user_id: null },
        { id: "c2000000-0000-4000-8000-000000000102", org_id: ORGS.acme.id, connector: "mail", label: "Mail Claire", mode: "simule", status: "disabled", owner_kind: "user", owner_team_id: null, owner_user_id: PERSONS.claire.id },
      ],
      journal: [
        { ...call, id: 101, ts: recent, method: "tools/call" },
        { ...call, id: 102, ts: old, method: "tools/call" },
        { ...call, id: 103, ts: recent, method: "tools/list" },
      ],
    })
  }, SETUP_TIMEOUT)

  afterAll(async () => {
    try {
      await admin?.forgetJournal()
    } finally {
      await seed?.cleanup()
    }
  }, SETUP_TIMEOUT)

  const dbOf = (person: AdminPerson) => asCaller(admin.persons[person].id, admin.persons[person].email)
  const callerOf = (person: AdminPerson) => ({ email: admin.persons[person].email })
  const since = () => new Date(Date.now() - 30 * 24 * 3600 * 1000)

  it("should refuse each function to a person outside the platform team (42501), and the overview a null period (22004)", async () => {
    const ada = dbOf("ada")
    const acme = admin.orgs.acme.id
    const codes = {
      staff_org_overview: await codeOf(ada.tx((sql) => sql`select * from platform.staff_org_overview(${since()})`)),
      staff_org_members: await codeOf(ada.tx((sql) => sql`select * from platform.staff_org_members(${acme}::uuid)`)),
      staff_org_accounts: await codeOf(ada.tx((sql) => sql`select * from platform.staff_org_accounts(${acme}::uuid)`)),
      null_period: await codeOf(dbOf("theo").tx((sql) => sql`select * from platform.staff_org_overview(null)`)),
    }
    expect(codes).toEqual({ staff_org_overview: "42501", staff_org_members: "42501", staff_org_accounts: "42501", null_period: "22004" })
  })

  it("should be security definer with an empty search_path, and return no secret column", async () => {
    const rows = await seed.admin<{ name: string; definer: boolean; config: string[] | null; columns: string[] }[]>`
      select p.proname as name, p.prosecdef as definer, p.proconfig as config,
             array(select a.name from unnest(p.proargnames, p.proargmodes) as a(name, mode) where a.mode = 't' order by a.name) as columns
        from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'platform' and p.proname in ${seed.admin([...FUNCTIONS])}
       order by p.proname`
    expect(rows.map(({ name, definer, config }) => ({ name, definer, config }))).toEqual(
      [...FUNCTIONS].sort().map((name) => ({ name, definer: true, config: ['search_path=""'] })),
    )
    expect(rows.flatMap((row) => row.columns).filter((column) => column.startsWith("secret") || column === "label")).toEqual([])
  })

  it("should give a platform team member without access to an organisation its figures, members and accounts", async () => {
    const theo = dbOf("theo")
    const acme = admin.orgs.acme.id
    const { overview, members, accounts } = await theo.tx(async (sql) => ({
      overview: await sql`select slug, name, members, teams, calls, active_connectors, accounts from platform.staff_org_overview(${since()}) where id = ${acme}`,
      members: await sql`select user_id, email, name, role from platform.staff_org_members(${acme}::uuid)`,
      accounts: await sql`select connector, owner_kind, owner_label, status, mode, accounts from platform.staff_org_accounts(null) where org_id = ${acme}`,
    }))
    expect([...overview]).toEqual([{ slug: admin.orgs.acme.slug, name: "Acme Test", members: 3, teams: 3, calls: 1, active_connectors: 1, accounts: 2 }])
    const { ada, claire, marc } = admin.persons
    expect([...members]).toEqual([
      { user_id: ada.id, email: ada.email, name: "Ada Martin", role: "admin" },
      { user_id: claire.id, email: claire.email, name: "Claire Morel", role: "member" },
      { user_id: marc.id, email: marc.email, name: "Marc Petit", role: "member" },
    ])
    expect([...accounts]).toEqual([
      { connector: "mail", owner_kind: "team", owner_label: "Ventes", status: "active", mode: "simule", accounts: 1 },
      { connector: "mail", owner_kind: "user", owner_label: claire.email, status: "disabled", mode: "simule", accounts: 1 },
    ])
    // Sans les fonctions, la RLS ne lui rend rien d'acme.
    const direct = await theo.tx((sql) => sql`select id from platform.orgs where id = ${acme}`)
    expect([...direct]).toEqual([])
  })

  it("should decide the platform team in the services before any read, and refuse an unknown slug", async () => {
    await expect(listPlatformOrgs(dbOf("ada"), callerOf("ada"))).rejects.toMatchObject({ code: "forbidden" })
    await expect(readPlatformOrg(dbOf("ada"), callerOf("ada"), admin.orgs.acme.slug)).rejects.toMatchObject({ code: "forbidden" })
    const unknown = `t${hex(4)}`
    await expect(readPlatformOrg(dbOf("theo"), callerOf("theo"), unknown)).rejects.toMatchObject({
      code: "not_found",
      message: `Unknown organisation ${unknown}. List them all with admin_org {"op": "overview"}.`,
    })
    const read = await readPlatformOrg(dbOf("theo"), callerOf("theo"), admin.orgs.acme.slug)
    expect(read).toMatchObject({ slug: admin.orgs.acme.slug, members: 3, calls: 1, activeConnectors: 1, accounts: 2 })
    expect(read.people.map((person) => person.role)).toEqual(["admin", "member", "member"])
    expect(read.accountGroups.map((group) => [group.ownerKind, group.ownerLabel])).toEqual([
      ["team", "Ventes"],
      ["user", admin.persons.claire.email],
    ])
    const listed = (await listPlatformOrgs(dbOf("theo"), callerOf("theo"))).find((org) => org.id === admin.orgs.acme.id)
    expect(listed).toEqual(read)
  })
})
