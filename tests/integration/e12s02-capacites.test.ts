// @vitest-environment node
// Capacités d'une organisation (E12-S02, ADR-022) sur une vraie base : la source de l'hôte enregistrée par
// `registerOrgLimits`, les refus décidés par `inviteMember`, `createTeam`, `activateConnector` et le quota de
// fichiers, sous le verrou de l'organisation, et l'état servi aux écrans. Portable : personnes par `fx.as`, lien
// magique espionné sous une adresse factice, bucket en mémoire. Chaque cas pose ses limites et les retire.
import { AuthClient } from "@supabase/supabase-js"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import {
  activateConnector,
  createTeam,
  inviteMember,
  orgLimitsView,
  orgUsage,
  registerOrgLimits,
  resolveIdentity,
  type Identity,
  type PlatformDb,
} from "@otomata_tech/oto_platform/server"
import type { OrgLimits } from "../../packages/plateforme/schemas"
import { memoryFileStore } from "../../packages/plateforme/server/files/memory"
import { requestFileUpload } from "../../packages/plateforme/server/files/service"
import { hex } from "../helpers/plateforme"
import { createSqlFixtures, SQL_SKIP_REASON, sqlConfigured, type SqlFixtures, type SqlReferenceOrg } from "../helpers/sql"
import { pendingMigrations } from "../helpers/pending-migrations"

/** `org_usage` (migration de la 1.2.0) : son cas se saute tant qu'elle manque à la base visée. */
const usagePending = (await pendingMigrations()).includes("20261001090000")

const storage = vi.hoisted(() => ({ store: null as ReturnType<typeof import("../../packages/plateforme/server/files/memory").memoryFileStore> | null }))

vi.mock("../../packages/plateforme/server/files/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../packages/plateforme/server/files/store")>()),
  fileStore: () => storage.store,
}))

const NETWORK_TIMEOUT = 60_000
const SETUP_TIMEOUT = 180_000
const REDIRECT = { redirectTo: "https://acme.test/auth/confirm?next=/" }

type Who = "ada" | "claire"
type Session = { db: PlatformDb; identity: Identity }

/** Le refus d'un appel : code, message et détails ; `null` s'il passe. */
async function refusal(run: Promise<unknown>): Promise<{ code?: string; message?: string; details?: Record<string, unknown> } | null> {
  return run.then(
    () => null,
    (error: { code?: string; message?: string; details?: Record<string, unknown> }) => ({ code: error.code, message: error.message, details: error.details }),
  )
}

describe.skipIf(!sqlConfigured)(sqlConfigured ? "organisation limits (E12-S02)" : `organisation limits (E12-S02) (${SQL_SKIP_REASON})`, { timeout: NETWORK_TIMEOUT }, () => {
  let fx: SqlFixtures
  let o: SqlReferenceOrg
  const sessions = new Map<Who, Session>()
  const as = (who: Who): Session => {
    const found = sessions.get(who)
    if (!found) throw new Error(`${who} has no session`)
    return found
  }
  /** Pose les capacités de l'organisation de référence, comme le ferait l'hôte. */
  const limit = (limits: OrgLimits, raiseUrl?: string) =>
    registerOrgLimits({ read: ({ id }) => (id === o.org.id ? limits : null), ...(raiseUrl ? { raiseUrl } : {}) })

  const count = async (table: "teams" | "invitations") => (await fx.admin`select id from ${fx.admin(`platform.${table}`)} where org_id = ${o.org.id}`).length

  beforeAll(async () => {
    fx = createSqlFixtures()
    o = await fx.buildReferenceOrg()
    for (const who of ["ada", "claire"] as const) {
      const person = o.people[who]
      const db = fx.as(person)
      sessions.set(who, { db, identity: await resolveIdentity(db, o.host, { userId: person.id, email: person.email }) })
    }
  }, SETUP_TIMEOUT)

  afterEach(() => {
    registerOrgLimits(null)
    storage.store = null
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  afterAll(async () => {
    await fx?.cleanup()
  }, SETUP_TIMEOUT)

  it("should limit nothing and read nothing without a source, the storage quota staying 10 GB (AC-1)", async () => {
    expect(await orgLimitsView(as("ada").db, as("ada").identity)).toEqual({ members: null, teams: null, connectors: null, raiseUrl: null })
    const created = await createTeam(as("ada").db, as("ada").identity, { name: `Libre ${hex(3)}` })
    expect(created.data.id).toBeTruthy()
  })

  it("should refuse with internal and write nothing when the source throws or returns invalid limits (AC-2)", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const before = await count("teams")
    registerOrgLimits({
      read: () => {
        throw new Error("host secret")
      },
    })
    expect(await refusal(createTeam(as("ada").db, as("ada").identity, { name: `Panne ${hex(3)}` }))).toMatchObject({ code: "internal", message: "Internal error." })
    registerOrgLimits({ read: () => ({ teams_max: -1 }) as OrgLimits })
    expect(await refusal(createTeam(as("ada").db, as("ada").identity, { name: `Invalide ${hex(3)}` }))).toMatchObject({ code: "internal" })
    expect(await count("teams")).toBe(before)
    expect(errors.mock.calls.flat().join(" ")).not.toContain("host secret")
  })

  it("should refuse a team beyond teams_max, and the first one at 0, from any caller (AC-4)", async () => {
    const teams = await count("teams")
    limit({ teams_max: teams })
    expect(await refusal(createTeam(as("ada").db, as("ada").identity, { name: `Trop ${hex(3)}` }))).toEqual({
      code: "forbidden",
      message: `${o.org.name} is limited to ${teams} ${teams > 1 ? "teams" : "team"}.`,
      details: { reason: "limit", limit: "teams_max", max: teams },
    })
    limit({ teams_max: 0 })
    expect(await refusal(createTeam(as("ada").db, as("ada").identity, { name: `Zero ${hex(3)}` }))).toMatchObject({
      message: `Creating teams is not open for ${o.org.name}.`,
    })
    limit({ teams_max: teams + 1 })
    expect(await refusal(createTeam(as("ada").db, as("ada").identity, { name: `Encore ${hex(3)}` }))).toBeNull()
    expect(await count("teams")).toBe(teams + 1)
  })

  it("should let the platform team pass a limit with an open access, leaving a journal line, and grey nothing for it", async () => {
    const sam = await fx.createUser({ fullName: "Sam Support" })
    await fx.makeStaff(sam.id)
    await fx.grantPlatformAccess(o.org.id, sam.id, null)
    const db = fx.as(sam)
    const identity = await resolveIdentity(db, o.host, { userId: sam.id, email: sam.email })
    const teams = await count("teams")
    limit({ teams_max: teams, members_max: 0 })

    expect(await refusal(createTeam(as("ada").db, as("ada").identity, { name: `Refus ${hex(3)}` }))).toMatchObject({ details: { limit: "teams_max" } })
    expect(await refusal(createTeam(db, identity, { name: `Support ${hex(3)}` }))).toBeNull()
    expect(await count("teams")).toBe(teams + 1)
    expect(await fx.admin`select tool, target, args from platform.journal where org_id = ${o.org.id} and user_id = ${sam.id} and tool = 'limit passed'`).toEqual([
      { tool: "limit passed", target: "teams_max", args: { max: teams, used: teams } },
    ])
    expect(await orgLimitsView(db, identity)).toMatchObject({ members: null, teams: null, connectors: null })
  })

  it("should let one of two concurrent creations pass at the limit minus one (AC-7)", async () => {
    const teams = await count("teams")
    limit({ teams_max: teams + 1 })
    const results = await Promise.all([1, 2].map((rank) => refusal(createTeam(as("ada").db, as("ada").identity, { name: `Course ${rank} ${hex(3)}` }))))
    expect(results.filter((result) => result === null)).toHaveLength(1)
    expect(results.find((result) => result !== null)).toMatchObject({ details: { limit: "teams_max" } })
    expect(await count("teams")).toBe(teams + 1)
  })

  it("should count pending invitations in members_max, refuse before any email, and name the administrators to a lead (AC-3)", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.invalid")
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key")
    const otp = vi.spyOn(AuthClient.prototype, "signInWithOtp").mockResolvedValue({ data: { user: null, session: null }, error: null })
    const view = async () => (await orgLimitsView(as("ada").db, as("ada").identity)).members
    limit({ members_max: 1_000 })
    const used = (await view())?.used ?? 0
    await inviteMember(as("ada").db, as("ada").identity, { email: `test-${hex(6)}@example.invalid`, role: "member" }, REDIRECT)
    expect(await view()).toEqual({ max: 1_000, used: used + 1 })

    limit({ members_max: used + 1 })
    const sent = otp.mock.calls.length
    const invitations = await count("invitations")
    expect(await refusal(inviteMember(as("ada").db, as("ada").identity, { email: `test-${hex(6)}@example.invalid`, role: "member" }, REDIRECT))).toEqual({
      code: "forbidden",
      message: `${o.org.name} is limited to ${used + 1} members, pending invitations included.`,
      details: { reason: "limit", limit: "members_max", max: used + 1 },
    })
    const lead = await refusal(inviteMember(as("claire").db, as("claire").identity, { email: `test-${hex(6)}@example.invalid`, role: "member", teamId: o.teams.ventes }, REDIRECT))
    expect(lead?.message).toMatch(/ Ask the administrators of .+ about it\.$/)
    expect(otp.mock.calls.length).toBe(sent)
    expect(await count("invitations")).toBe(invitations)
  })

  it("should refuse a connector beyond connectors_max, never the one already active (AC-5)", async () => {
    limit({ connectors_max: 0 })
    expect(await refusal(activateConnector(as("ada").db, as("ada").identity, { connector: "mail" }))).toMatchObject({
      code: "forbidden",
      details: { reason: "limit", limit: "connectors_max", max: 0 },
    })
    registerOrgLimits(null)
    await activateConnector(as("ada").db, as("ada").identity, { connector: "mail" })
    limit({ connectors_max: 1 })
    expect(await refusal(activateConnector(as("ada").db, as("ada").identity, { connector: "mail" }))).toBeNull()
    expect((await orgLimitsView(as("ada").db, as("ada").identity)).connectors).toEqual({ max: 1, used: 1 })
  })

  it("should refuse a file beyond storage_bytes with the quota in bytes (AC-6)", async () => {
    storage.store = memoryFileStore()
    const node = `ventes/quota_${hex(3)}`
    await fx.createNode(o.org.id, { parentId: o.nodes.ventes, path: node, title: node })
    limit({ storage_bytes: 3 })
    expect(await refusal(requestFileUpload(as("claire").db, as("claire").identity, { node, name: "r.pdf", mime: "application/pdf", size: 4 }))).toMatchObject({
      code: "too_large",
      details: { reason: "quota", max: 3 },
    })
    limit({ storage_bytes: 10 })
    expect(await refusal(requestFileUpload(as("claire").db, as("claire").identity, { node, name: "r.pdf", mime: "application/pdf", size: 4 }))).toBeNull()
  })

  it("should serve the raise address and refuse a malformed source at registration", () => {
    expect(() => registerOrgLimits({ read: () => null, raiseUrl: "//elsewhere.test/billing" })).toThrow(TypeError)
    expect(() => registerOrgLimits({ read: () => null, raiseUrl: "http://acme.test/billing" })).toThrow(TypeError)
    expect(() => registerOrgLimits({ read: () => null, raiseUrl: "/billing" })).not.toThrow()
    expect(() => registerOrgLimits({ read: () => null, raiseUrl: "https://acme.test/billing" })).not.toThrow()
  })

  it.skipIf(usagePending)("should read the members and pending invitations of an organisation without a session (ADR-022 § 10)", async () => {
    const [{ members }] = await fx.admin<{ members: number }[]>`select count(*)::int as members from platform.members where org_id = ${o.org.id}`
    const [{ pending }] = await fx.admin<{ pending: number }[]>`
      select count(*)::int as pending from platform.invitations
       where org_id = ${o.org.id} and accepted_at is null and declined_at is null and revoked_at is null and expires_at > now()`
    expect(await orgUsage(o.org.id)).toEqual({ members, pendingInvitations: pending })
    expect(await orgUsage("00000000-0000-4000-8000-000000000000")).toBeNull()
    expect(await refusal(orgUsage("not-an-id"))).toMatchObject({ code: "invalid_arguments" })
  })

  it("should read account_owner_kinds and accounts_per_owner_max without counting them in the view: the connectors check them (AC-11, ecran-connecteurs-services)", async () => {
    limit({ account_owner_kinds: ["org"], accounts_per_owner_max: 1, teams_max: 1_000 }, "/billing")
    expect(await orgLimitsView(as("ada").db, as("ada").identity)).toMatchObject({ members: null, connectors: null, raiseUrl: "/billing" })
  })
})
