// @vitest-environment node
// L'inscription libre (E12-S01, ADR-023) sur une vraie base : le service `signUp` et ses refus, décidés avant
// `signup_org`, qui en est la seconde barrière ; l'identité créée pour un sujet OIDC inconnu ; la course de deux
// inscriptions de la même personne ; la route `POST signup`, absente sans l'option de l'hôte, et sa ligne de journal.
// Portable : personnes de `createLocalFixtures`, jetons signés localement ; le point de création de l'hôte simulé. Les
// organisations créées par le service sont retirées en fin de suite, puis les personnes oubliées.
import { randomUUID } from "crypto"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { handlePlateforme } from "@otomata_tech/oto_platform/api"
import { createPlatformDb, listMyOrganisations, listOrganisationsOfPerson, resolveIdentity, signUp, type OrgCreationHook, type PlatformDb, type SignupOptions } from "@otomata_tech/oto_platform/server"
import { hex } from "../helpers/plateforme"
import { createLocalFixtures, type LocalFixtures } from "../helpers/session-locale"
import { failureOf, SQL_SKIP_REASON, sqlConfigured, type SqlReferenceOrg, type SqlUser } from "../helpers/sql"
import { pendingMigrations, pendingReason } from "../helpers/pending-migrations"
import { testIssuer } from "../helpers/oidc-issuer"

/** La migration de l'inscription : les cas se sautent, la version nommée, tant qu'elle manque à la base visée. */
const SIGNUP_VERSION = "20261001090000"
const missing = await pendingMigrations()
const pending = missing.includes(SIGNUP_VERSION)
/** La migration de la 1.3.0 (`signup_org` sans borne) : ses cas se sautent tant qu'elle manque à la base visée. */
const manyPending = missing.includes("20261001180000")

const NETWORK_TIMEOUT = 60_000
const SETUP_TIMEOUT = 180_000

const hook: OrgCreationHook = {
  addresses: ({ slug }) => [`${slug}.signup.test`],
  created: async ({ hosts }) => hosts.map((host) => ({ host, status: "attached", line: `Line of ${host}.` })),
}
const SIGNUP: SignupOptions = { orgCreation: hook }
const request = new Request("https://signup.test/api/platform/signup", { method: "POST" })

/** Un nom, un slug et un préfixe jetables, valides pour `signupSchema`. */
function draft() {
  const tag = `t${hex(6)}`
  return { name: `Organisation ${tag}`, org: tag, prefix: tag.slice(0, 12) }
}

async function refusal(run: Promise<unknown>): Promise<{ code?: string; message?: string; details?: Record<string, unknown> } | null> {
  return run.then(
    () => null,
    (error: { code?: string; message?: string; details?: Record<string, unknown> }) => ({ code: error.code, message: error.message, details: error.details }),
  )
}

const suite = sqlConfigured ? "signup (E12-S01)" : `signup (E12-S01) (${SQL_SKIP_REASON})`

describe.skipIf(!sqlConfigured || pending)(pending ? `${suite} (${pendingReason([SIGNUP_VERSION])})` : suite, { timeout: NETWORK_TIMEOUT }, () => {
  let fx: LocalFixtures
  let o: SqlReferenceOrg
  const createdSlugs: string[] = []
  const mintedUsers: string[] = []

  /** Une personne jetable, membre d'aucune organisation, et son client. */
  async function newcomer(): Promise<{ user: SqlUser; db: PlatformDb }> {
    const user = await fx.createUser({ fullName: "Nora Petit" })
    return { user, db: fx.as(user) }
  }

  async function signed(db: PlatformDb, user: { email: string }, input: ReturnType<typeof draft>, options: SignupOptions = SIGNUP) {
    const result = await signUp(db, user, { ...input, confirm: true }, { signup: options, request })
    createdSlugs.push(input.org)
    return result
  }

  beforeAll(async () => {
    fx = createLocalFixtures()
    o = await fx.buildReferenceOrg()
  }, SETUP_TIMEOUT)

  afterAll(async () => {
    if (fx) {
      if (createdSlugs.length > 0) await fx.admin`delete from platform.orgs where slug in ${fx.admin(createdSlugs)}`
      for (const id of mintedUsers) await fx.admin`select platform.forget_user(${id})`
      await fx.cleanup()
    }
  }, SETUP_TIMEOUT)

  it("should refuse without a verified email, before any write (AC-3)", async () => {
    const { db } = await newcomer()
    expect(await refusal(signUp(db, { email: "" }, draft(), { signup: SIGNUP, request }))).toMatchObject({ code: "forbidden", details: { reason: "email_required" } })
  })

  it.skipIf(manyPending)("should let a member of an organisation create another one, and list both for the switcher", async () => {
    const ada = o.people.ada
    const db = fx.as(ada)
    const input = draft()
    await signed(db, ada, input)
    expect(await fx.admin`select m.role from platform.members m join platform.orgs g on g.id = m.org_id where g.slug = ${input.org} and m.user_id = ${ada.id}`).toEqual([{ role: "admin" }])

    const identity = await resolveIdentity(db, o.host, { userId: ada.id, email: ada.email })
    const mine = await listMyOrganisations(db, identity)
    expect(mine.map((org) => [org.name, org.host, org.current]).sort()).toEqual(
      [
        [o.org.name, o.host, true],
        [input.name, `${input.org}.signup.test`, false],
      ].sort(),
    )
    // 1.4.12 : les mêmes, lues par la session seule à une adresse qui n'en désigne aucune (l'adresse commune).
    const deLaSession = await listOrganisationsOfPerson(db, "signup.test")
    expect(deLaSession.map((org) => [org.name, org.current]).sort()).toEqual([[o.org.name, false], [input.name, false]].sort())
  })

  it("should refuse a caller without an identity nor an issuer in signup_org itself", async () => {
    const input = draft()
    const anonymous = createPlatformDb({ caller: { issuer: "https://issuer.signup.test", issuerKind: "supabase", subject: "not-a-uuid", email: "x@example.invalid", name: null } })
    expect(await failureOf(anonymous.tx((sql) => sql`select platform.signup_org(${input.name}, ${input.org}, ${input.prefix}, ${["x.signup.test"]}::text[])`))).toMatchObject({ code: "42501" })
  })

  it("should pass the host's refusal text as is, and serve its failure as internal (AC-5)", async () => {
    const { user, db } = await newcomer()
    const admit = vi.fn<NonNullable<SignupOptions["admit"]>>(() => "Captcha invalide.")
    expect(await refusal(signUp(db, user, draft(), { signup: { ...SIGNUP, admit }, request }))).toEqual({
      code: "forbidden",
      message: "Captcha invalide.",
      details: { reason: "signup_refused", text: "Captcha invalide." },
    })
    expect(admit).toHaveBeenCalledWith({ email: user.email, request, acceptedTerms: false })
    await refusal(signUp(db, user, { ...draft(), accepted_terms: true }, { signup: { ...SIGNUP, admit }, request }))
    expect(admit).toHaveBeenLastCalledWith({ email: user.email, request, acceptedTerms: true })
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const failing: SignupOptions = {
      ...SIGNUP,
      admit: () => {
        throw new Error("secret of the host")
      },
    }
    expect(await refusal(signUp(db, user, draft(), { signup: failing, request }))).toMatchObject({ code: "internal", message: "Internal error." })
    expect(errors.mock.calls.flat().join(" ")).not.toContain("secret of the host")
    errors.mockRestore()
  })

  it("should preview the host's addresses without writing, then create the organisation, its tree and its administrator (AC-6, AC-7)", async () => {
    const { user, db } = await newcomer()
    const input = draft()
    const preview = await signUp(db, user, input, { signup: SIGNUP, request })
    expect(preview).toEqual({ created: false, org: { slug: input.org, name: input.name, prefix: input.prefix, host: null }, addresses: { hosts: [`${input.org}.signup.test`], added: [`${input.org}.signup.test`] } })
    expect(await fx.admin`select id from platform.orgs where slug = ${input.org}`).toHaveLength(0)

    const created = await signed(db, user, input)
    expect(created).toMatchObject({ created: true, hosts: [`${input.org}.signup.test`], setup: [{ host: `${input.org}.signup.test`, status: "attached" }] })
    const [org] = await fx.admin<{ id: string }[]>`select id from platform.orgs where slug = ${input.org}`
    const paths = (await fx.admin<{ path: string }[]>`select path from platform.nodes where org_id = ${org.id} order by path`).map((row) => row.path)
    expect(paths).toEqual(expect.arrayContaining(["contexte", "guide", "private"]))
    expect(paths.some((path) => path.startsWith("private/"))).toBe(true)
    expect(await fx.admin`select user_id, role, email from platform.members where org_id = ${org.id}`).toEqual([{ user_id: user.id, role: "admin", email: user.email }])
    expect(await fx.admin`select id from platform.teams where org_id = ${org.id}`).toHaveLength(0)
    expect(await fx.admin`select id from platform.platform_grants where org_id = ${org.id}`).toHaveLength(0)
    expect((await fx.admin<{ host: string }[]>`select host from platform.org_domains where org_id = ${org.id}`).map((row) => row.host)).toEqual([`${input.org}.signup.test`])
  })

  it("should create the identity of an OIDC subject that nothing invited (AC-8)", async () => {
    const subject = `oidc-${randomUUID()}`
    const email = `test-${hex(6)}@example.invalid`
    const db = createPlatformDb({ caller: { issuer: "https://issuer.signup.test", issuerKind: "oidc", subject, email, name: "Iris Blanc" } })
    const input = draft()
    await signed(db, { email }, input)
    const [identity] = await fx.admin<{ user_id: string }[]>`select user_id from platform.identities where issuer = 'https://issuer.signup.test' and subject = ${subject}`
    mintedUsers.push(identity.user_id)
    expect(await fx.admin`select m.role from platform.members m join platform.orgs g on g.id = m.org_id where g.slug = ${input.org} and m.user_id = ${identity.user_id}`).toEqual([{ role: "admin" }])
  })

  it("should refuse a slug or a prefix already taken, writing nothing (AC-9)", async () => {
    const { user, db } = await newcomer()
    const taken = { ...draft(), org: o.org.slug }
    expect(await refusal(signUp(db, user, { ...taken, confirm: true }, { signup: { orgCreation: { ...hook, addresses: () => [`${hex(6)}.signup.test`] } }, request }))).toMatchObject({
      code: "conflict",
      message: `Slug ${o.org.slug} is already taken. Pick another slug.`,
    })
    expect(await fx.admin`select org_id from platform.members where user_id = ${user.id}`).toHaveLength(0)
  })

  it.skipIf(manyPending)("should create both organisations of two concurrent signups of the same person", async () => {
    const { user, db } = await newcomer()
    const [first, second] = [draft(), draft()]
    createdSlugs.push(first.org, second.org)
    const results = await Promise.all([first, second].map((input) => refusal(signUp(db, user, { ...input, confirm: true }, { signup: SIGNUP, request }))))
    expect(results).toEqual([null, null])
    expect(await fx.admin`select org_id from platform.members where user_id = ${user.id} and role = 'admin'`).toHaveLength(2)
  })

  describe("an OIDC host, as with Logto or Keycloak (AC-8)", () => {
    afterEach(() => {
      vi.unstubAllEnvs()
      vi.unstubAllGlobals()
    })

    it("should sign up a person unknown to the base through the route, and refuse an unverified email", async () => {
      const issuer = await testIssuer()
      const audience = "https://signup.test/api/mcp"
      vi.stubEnv("PLATFORM_OIDC_ISSUER", issuer.issuer)
      vi.stubEnv("PLATFORM_OIDC_AUDIENCE", audience)
      vi.stubGlobal("fetch", issuer.fetch)
      const subject = `logto-${randomUUID()}`
      const email = `test-${hex(6)}@example.invalid`
      const post = (token: string, body: unknown) =>
        handlePlateforme(
          new Request("https://signup.test/api/platform/signup", {
            method: "POST",
            headers: { origin: "https://signup.test", "x-forwarded-proto": "https", "content-type": "application/json" },
            body: JSON.stringify(body),
          }),
          { accessToken: token, host: "signup.test", signup: SIGNUP, defer: () => {} },
        )

      const unverified = await issuer.sign({ sub: `logto-${randomUUID()}`, email, email_verified: false }, { audience })
      const refused = await post(unverified, { ...draft(), confirm: true })
      expect(refused.status).toBe(403)
      expect(await refused.json()).toMatchObject({ error: { code: "forbidden", details: { reason: "email_required" } } })

      const input = draft()
      createdSlugs.push(input.org)
      const token = await issuer.sign({ sub: subject, email, email_verified: true, name: "Iris Blanc" }, { audience })
      const created = await post(token, { ...input, confirm: true })
      expect(created.status).toBe(201)
      const [identity] = await fx.admin<{ user_id: string }[]>`select user_id from platform.identities where issuer = ${issuer.issuer} and subject = ${subject}`
      mintedUsers.push(identity.user_id)
      expect(await fx.admin`select m.role from platform.members m join platform.orgs g on g.id = m.org_id where g.slug = ${input.org} and m.user_id = ${identity.user_id}`).toEqual([{ role: "admin" }])
    })
  })

  describe("the route (AC-1, AC-2, AC-11)", () => {
    const post = (accessToken: string | null, body: unknown, origin = "https://signup.test") =>
      new Request("https://signup.test/api/platform/signup", {
        method: "POST",
        headers: { origin, "x-forwarded-proto": "https", "content-type": "application/json", "user-agent": "e12s01" },
        body: JSON.stringify(body),
      })

    it("should not exist without the host's option, and ask for a session and the same origin with it", async () => {
      const { user } = await newcomer()
      const { accessToken } = await fx.sessionFor(user)
      const without = await handlePlateforme(post(accessToken, draft()), { accessToken, host: "signup.test", verifyToken: fx.verifyToken })
      expect(without.status).toBe(404)
      const anonymous = await handlePlateforme(post(null, draft()), { accessToken: null, host: "signup.test", verifyToken: fx.verifyToken, signup: SIGNUP })
      expect(anonymous.status).toBe(401)
      const elsewhere = await handlePlateforme(post(accessToken, draft(), "https://evil.test"), { accessToken, host: "signup.test", verifyToken: fx.verifyToken, signup: SIGNUP })
      expect(elsewhere.status).toBe(403)
    })

    it("should create the organisation with 201 and write its signup line in the new organisation's journal", async () => {
      const { user } = await newcomer()
      const { accessToken } = await fx.sessionFor(user)
      const input = draft()
      createdSlugs.push(input.org)
      const tasks: (() => Promise<void>)[] = []
      const response = await handlePlateforme(post(accessToken, { ...input, confirm: true }), {
        accessToken,
        host: "signup.test",
        verifyToken: fx.verifyToken,
        signup: SIGNUP,
        defer: (task) => tasks.push(task),
      })
      expect(response.status).toBe(201)
      expect(await response.json()).toMatchObject({ data: { created: true, hosts: [`${input.org}.signup.test`] } })
      await Promise.all(tasks.map((task) => task()))
      expect(await fx.admin`select j.tool, j.target from platform.journal j join platform.orgs g on g.id = j.org_id where g.slug = ${input.org}`).toEqual([
        { tool: "POST signup", target: input.org },
      ])
    })
  })
})
