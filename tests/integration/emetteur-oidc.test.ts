// @vitest-environment node
// Émetteur configurable, branchement (E01-S11, parties a1-wire et a2-wire) : un jeton de l'émetteur de
// test traverse les portes comme chez un hôte (vérification par `makeVerifyToken()`, `resolveMcpRequest`
// puis un client MCP par InMemoryTransport, `handlePlateforme`), et la base traduit son sujet
// (`identity_for_caller`) : AC-a4, AC-a5, AC-a7 par les portes, les erreurs de la traduction servies en
// refus, AC-a8 et AC-a8b (l'invitation envoyée par la plateforme) ; AC-a13 par la porte du MCP admin
// (`handleAdminMcp`, M34). Portable (fiche D76) : la base est
// celle des suites portables (`tests/helpers/sql.ts`), sur le projet comme sur le Postgres nu du job
// `bare-postgres` ; l'émetteur est servi en mémoire (`tests/helpers/oidc-issuer.ts`), et le relais SMTP
// de l'hôte, frontière du paquet, est un transport de capture. Les variables de Supabase ne servent
// qu'à construire le client du paquet, dont la face PostgREST n'est jamais appelée ici. Données jetables
// (`t<hex>`, `test-<hex>@example.invalid`) ; chaque identifiant né d'une traduction est oublié au ménage.
import { randomBytes, randomUUID } from "crypto"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { handlePlateforme } from "../../packages/plateforme/api/handler"
import { handleAdminMcp, openAdminRequest } from "../../packages/plateforme/mcp/admin/handler"
import { makeVerifyToken } from "../../packages/plateforme/mcp/auth"
import { resolveMcpRequest } from "../../packages/plateforme/mcp/handler"
import { resolveIdentity } from "../../packages/plateforme/server/identity"
import { inviteMember } from "../../packages/plateforme/server/invitations"
import { loggedText } from "../helpers/logs"
import { connectDeps } from "../helpers/mcp"
import { connectAdminMcp } from "../helpers/mcp-admin"
import { testIssuer, type TestIssuer } from "../helpers/oidc-issuer"
import { asCaller, seedWithAdmin, SQL_SKIP_REASON, sqlConfigured, type SeededData, type SeededOrg, type SeededPerson } from "../helpers/sql"

// Le relais SMTP de l'hôte : les messages gardés au lieu d'être envoyés, ou refusés comme un relais
// injoignable, dont l'erreur nomme l'adresse (que le log ne doit pas recopier). nodemailer n'est une
// dépendance que du paquet : il se simule par son chemin sous le paquet, celui que `server/mail.ts` charge.
const relay = vi.hoisted(() => ({ sent: [] as Record<string, unknown>[], refuse: false }))
vi.mock("../../packages/plateforme/node_modules/nodemailer", () => ({
  createTransport: () => ({
    sendMail: async (message: Record<string, unknown>) => {
      if (relay.refuse) throw Object.assign(new Error("connect ECONNREFUSED relay.example.invalid:465"), { code: "ECONNECTION" })
      relay.sent.push(message)
    },
  }),
}))

const NETWORK_TIMEOUT = 60_000
const hex = () => randomBytes(4).toString("hex")
const address = () => `test-${hex()}@example.invalid`
const FROM = "Invitations <invitations@example.invalid>"
/**
 * La marque de l'organisation ; son ancien nom affiché n'est plus lu (E05-S13, AC-3) : l'email porte le nom de
 * l'organisation (l'échappement du HTML : `tests/unit/mail.test.ts`).
 */
const BRAND = { display_name: "Atelier <Nord>", logo_url: "https://cdn.example.invalid/logo.png" }
const PROTOCOL = "2025-06-18"

describe.skipIf(!sqlConfigured)(sqlConfigured ? "issuer wired to the gates (E01-S11 a1-wire, a2-wire)" : `issuer wired to the gates (${SQL_SKIP_REASON})`, { timeout: NETWORK_TIMEOUT }, () => {
  let seed: SeededData
  let org: SeededOrg
  let issuer: TestIssuer
  /** L'administratrice de l'organisation, déjà connue de l'émetteur de test : sa ligne `identities` est posée. */
  let ada: SeededPerson & { subject: string }
  const audience = () => `https://${org.host}/api/mcp`
  /** Les identifiants nés d'une traduction pendant le passage, oubliés au ménage. */
  const born = new Set<string>()

  beforeAll(async () => {
    seed = seedWithAdmin()
    org = await seed.createOrg()
    await seed.admin`update platform.orgs set brand = ${seed.admin.json(BRAND)} where id = ${org.id}`
    issuer = await testIssuer()
    ada = { ...seed.person(), subject: `ada-${hex()}` }
    await seed.addMember(org.id, ada, "admin")
    await seed.admin`insert into platform.identities (issuer, subject, user_id) values (${issuer.issuer}, ${ada.subject}, ${ada.id})`
  })

  afterAll(async () => {
    try {
      for (const id of born) await seed.admin`select platform.forget_user(${id})`
    } finally {
      await seed?.cleanup()
    }
  })

  // Un hôte en mode OIDC : l'émetteur de test, son audience, son `fetch` à la place du réseau, le relais.
  beforeEach(() => {
    vi.stubEnv("PLATFORM_OIDC_ISSUER", issuer.issuer)
    vi.stubEnv("PLATFORM_OIDC_AUDIENCE", audience())
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.example.invalid")
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key")
    vi.stubEnv("PLATFORM_SMTP_URL", "smtps://relay.example.invalid:465")
    vi.stubEnv("PLATFORM_MAIL_FROM", FROM)
    vi.stubGlobal("fetch", issuer.fetch)
    relay.sent.length = 0
    relay.refuse = false
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  /** Un jeton d'accès de l'émetteur pour le MCP de l'organisation, email vérifié. */
  const tokenOf = (subject: string, email: string) => issuer.sign({ sub: subject, email, email_verified: true, name: "Camille" }, { audience: audience() })

  /** La requête MCP d'un jeton, câblée comme la route : vérification, puis organisation et appartenance. */
  async function viaMcp(bearer: string) {
    const claims = (await makeVerifyToken()(new Request(audience(), { method: "POST" }), bearer))?.extra
    const resolved = await resolveMcpRequest({ accessToken: bearer, claims, host: org.host, origin: `https://${org.host}`, userAgent: "vitest" })
    if (resolved.kind === "unknown_org") throw new Error(`no organisation at ${org.host}`)
    return resolved
  }

  /** Une requête de l'API du paquet, au vérificateur par défaut ; une mutation vient de l'adresse elle-même. */
  function viaApi(bearer: string, method = "GET", body?: unknown) {
    const origin = `https://${org.host}`
    const headers = { "x-forwarded-proto": "https", origin, "content-type": "application/json" }
    const request = new Request(`${origin}/api/platform/invitations`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    return handlePlateforme(request, { accessToken: bearer, host: org.host, defer: () => {} })
  }

  /** `initialize` à la porte du MCP admin, au vérificateur par défaut ; le journal différé joué après la réponse. */
  async function viaAdmin(bearer: string): Promise<Response> {
    const tasks: (() => Promise<void>)[] = []
    const headers = { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": PROTOCOL, authorization: `Bearer ${bearer}` }
    const body = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "claude-ai", version: "0.1.0" } } }
    const request = new Request(`https://${org.host}/api/mcp-admin`, { method: "POST", headers, body: JSON.stringify(body) })
    const response = await handleAdminMcp(request, { verifyToken: makeVerifyToken(), defer: (task) => tasks.push(task) })
    // Le corps lu en entier : le serveur a fini d'écrire avant que le journal parte.
    await response.text()
    for (const task of tasks) await task()
    return response
  }

  async function identitiesOf(subject: string): Promise<{ user_id: string }[]> {
    const rows = [...(await seed.admin<{ user_id: string }[]>`select user_id from platform.identities where issuer = ${issuer.issuer} and subject = ${subject}`)]
    for (const row of rows) born.add(row.user_id)
    return rows
  }

  it("should translate an invited person at her first MCP call, accept her invitation and serve context, under the same id at the next call (AC-a4)", async () => {
    const [subject, email] = [`abc-${hex()}`, address()]
    const [invitation] = await seed.admin<{ id: string }[]>`insert into platform.invitations (org_id, email) values (${org.id}, ${email}) returning id`
    const bearer = await tokenOf(subject, email)

    const first = await viaMcp(bearer)
    const context = first.kind === "member" ? await (await connectDeps(first.deps)).call("context") : null
    const again = await viaMcp(bearer)
    const rows = await identitiesOf(subject)
    const [accepted] = await seed.admin`select accepted_by from platform.invitations where id = ${invitation.id}`

    expect(rows).toEqual([{ user_id: expect.any(String) }])
    const [{ user_id: internal }] = rows
    expect([first.kind, again.kind]).toEqual(["member", "member"])
    expect(first.deps.caller).toMatchObject({ kind: "member", identity: { user: { id: internal, email } } })
    expect(again.deps.caller).toMatchObject({ kind: "member", identity: { user: { id: internal } } })
    expect(accepted).toEqual({ accepted_by: internal })
    expect(context?.isError).toBe(false)
  })

  it("should refuse a person neither invited nor of the platform team as a non-member, at the MCP and at the API, without any row (AC-a5)", async () => {
    const [subject, email] = [`z-${hex()}`, address()]
    const bearer = await tokenOf(subject, email)

    const resolved = await viaMcp(bearer)
    const context = await (await connectDeps(resolved.deps)).call("context")
    const api = await viaApi(bearer)

    expect(resolved.kind).toBe("not_member")
    expect(context.isError).toBe(true)
    expect(context.text).toContain(`You are signed in as ${email} but you are not a member of ${org.name}`)
    expect([api.status, (await api.json()).error.code]).toEqual([403, "not_member"])
    expect(await identitiesOf(subject)).toEqual([])
  })

  it("should give a Supabase Auth caller its sub as internal id, its row born at the gate, its member row unchanged (AC-a7)", async () => {
    const project = `https://project-${hex()}.example.invalid`
    const supabase = await testIssuer({ issuer: `${project}/auth/v1`, alg: "RS256", discovery: "none", jwksPath: "/.well-known/jwks.json" })
    vi.stubEnv("PLATFORM_OIDC_ISSUER", "")
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", project)
    vi.stubGlobal("fetch", supabase.fetch)
    const bob = seed.person()
    await seed.addMember(org.id, bob)
    const before = [...(await seed.admin`select * from platform.members where user_id = ${bob.id}`)]
    const bearer = await supabase.sign({ sub: bob.id, email: bob.email, role: "authenticated" }, { audience: "authenticated" })

    const api = await viaApi(bearer)

    expect(api.status).toBe(200)
    expect([...(await seed.admin`select subject, user_id from platform.identities where issuer = ${supabase.issuer}`)]).toEqual([{ subject: bob.id, user_id: bob.id }])
    expect([...(await seed.admin`select * from platform.members where user_id = ${bob.id}`)]).toEqual(before)
  })

  // L'acceptation à la porte est propre au mode OIDC (AC-a4) : sur Supabase, elle reste au retour de connexion (AC-a8).
  it("should accept no invitation at the gate for a Supabase Auth caller who is not a member yet", async () => {
    const project = `https://project-${hex()}.example.invalid`
    const supabase = await testIssuer({ issuer: `${project}/auth/v1`, alg: "RS256", discovery: "none", jwksPath: "/.well-known/jwks.json" })
    vi.stubEnv("PLATFORM_OIDC_ISSUER", "")
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", project)
    vi.stubGlobal("fetch", supabase.fetch)
    const cleo = seed.person()
    const [invitation] = await seed.admin<{ id: string }[]>`insert into platform.invitations (org_id, email) values (${org.id}, ${cleo.email}) returning id`
    const bearer = await supabase.sign({ sub: cleo.id, email: cleo.email, role: "authenticated" }, { audience: "authenticated" })

    const api = await viaApi(bearer)

    expect(api.status).toBe(403)
    expect([...(await seed.admin`select accepted_at from platform.invitations where id = ${invitation.id}`)]).toEqual([{ accepted_at: null }])
  })

  it("should serve as a non-member a subject longer than the identities table admits, never as a failure", async () => {
    const [subject, email] = ["s".repeat(256), address()]
    await seed.admin`insert into platform.invitations (org_id, email) values (${org.id}, ${email})`
    const log = vi.spyOn(console, "error").mockImplementation(() => {})

    const api = await viaApi(await tokenOf(subject, email))

    expect([api.status, (await api.json()).error.code]).toEqual([403, "not_member"])
    expect(loggedText(log)).toContain("subject longer than the identities table admits")
    expect(loggedText(log)).not.toContain(subject)
  })

  it("should answer a conflict to retry, never a failure, while another first call of the subject holds its row", async () => {
    const [subject, email] = [`held-${hex()}`, address()]
    await seed.admin`insert into platform.invitations (org_id, email) values (${org.id}, ${email})`
    const bearer = await tokenOf(subject, email)
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    const held = await seed.admin.reserve()
    const api = await (async () => {
      try {
        await held.unsafe("begin")
        await held`insert into platform.identities (issuer, subject, user_id) values (${issuer.issuer}, ${subject}, ${randomUUID()})`
        // La traduction attend la ligne de l'autre passage, jusqu'aux délais de la session (8 s).
        return await viaApi(bearer)
      } finally {
        await held.unsafe("rollback")
        held.release()
      }
    })()

    expect([api.status, (await api.json()).error.code]).toEqual([409, "conflict"])
    // Le conflit journalisé (`security-patterns.md § Idempotence`) : la porte de l'API ne journalise pas une `PlatformError`.
    expect(loggedText(log)).toContain("[platform] identity: first call of this subject still held by another request")
  })

  it("should make a platform team member without any account the first administrator of the organisation she creates, without email, and invite another address by the platform email (2026-10-14)", async () => {
    // L'équipe plateforme en mode OIDC : une ligne `platform_staff` par email, aucun compte chez l'émetteur ni ailleurs.
    const staff = { ...seed.person(), subject: `staff-${hex()}` }
    await seed.admin`insert into platform.platform_staff (user_id, email) values (${staff.id}, ${staff.email})`
    const slug = `t${hex()}`
    const host = `${slug}.example.invalid`
    try {
      const bearer = await tokenOf(staff.subject, staff.email)
      const claims = (await makeVerifyToken()(new Request(`https://${org.host}/api/mcp-admin`, { method: "POST" }), bearer))?.extra
      const session = await connectAdminMcp(await openAdminRequest({ accessToken: bearer, claims, userAgent: "vitest", origin: `https://${org.host}` }))
      const { code } = await session.openAdmin()
      const created = await session.call("admin_org", { ctx: code, op: "create", org: slug, name: "Acme OIDC", prefix: slug, host, admin_email: staff.email.toUpperCase(), confirm: true })
      expect(created.text.split("\n")[1]).toBe(`You (${staff.email}) are its first administrator: a member with the admin role.`)
      const members = await seed.admin`select m.user_id, m.role, m.email from platform.members m join platform.orgs o on o.id = m.org_id where o.slug = ${slug}`
      expect([...members]).toEqual([{ user_id: staff.id, role: "admin", email: staff.email }])
      expect(relay.sent).toEqual([])

      const invited = address()
      const other = await session.call("admin_org", { ctx: code, op: "add_admin", org: slug, admin_email: invited })
      expect(other.text.startsWith(`Invitation to administer ${slug} sent to ${invited} (role admin, valid until `), other.text).toBe(true)
      expect(relay.sent).toHaveLength(1)
      // L'email de l'écran Équipes, au nom de qui invite : la créatrice, membre depuis la création, nommée par ses claims.
      expect(relay.sent[0]).toMatchObject({ from: FROM, to: invited, subject: "Camille vous invite à rejoindre Acme OIDC" })
      expect(relay.sent[0].text).toContain(`https://${host}/login`)
      const rows = await seed.admin`
        select i.role, i.invited_by from platform.invitations i join platform.orgs o on o.id = i.org_id where o.slug = ${slug} and i.email = ${invited}`
      expect([...rows]).toEqual([{ role: "admin", invited_by: staff.id }])
    } finally {
      await seed.admin`delete from platform.orgs where slug = ${slug}`
      await seed.admin`delete from platform.admin_journal where user_id = ${staff.id}`
    }
  })

  it("should admit at the admin MCP a verified email of the platform team, under the id of its platform_staff row (AC-a13)", async () => {
    const staff = { ...seed.person(), subject: `staff-${hex()}` }
    await seed.admin`insert into platform.platform_staff (user_id, email) values (${staff.id}, ${staff.email})`
    // Un accès à l'organisation marquée : le ménage des tests date la personne par elle (`staleStaff`).
    await seed.admin`insert into platform.platform_grants (org_id, user_id) values (${org.id}, ${staff.id})`
    try {
      const response = await viaAdmin(await tokenOf(staff.subject, staff.email))
      const journal = await seed.admin`select method, user_id from platform.admin_journal where user_id = ${staff.id}`

      expect(response.status).toBe(200)
      expect(await identitiesOf(staff.subject)).toEqual([{ user_id: staff.id }])
      // La ligne du journal admin porte l'identifiant de la ligne `platform_staff`, jamais le sujet du jeton.
      expect([...journal]).toEqual([{ method: "initialize", user_id: staff.id }])
    } finally {
      await seed.admin`delete from platform.admin_journal where user_id = ${staff.id}`
    }
  })

  it("should refuse at the admin MCP a caller outside the platform team, a translated member as a stranger, and give the stranger no row (AC-a13)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const [subject, email] = [`z-${hex()}`, address()]

    const member = await viaAdmin(await tokenOf(ada.subject, ada.email))
    const stranger = await viaAdmin(await tokenOf(subject, email))

    // 401 sans métadonnées : le jeton est valide, l'appelant n'est pas de l'équipe plateforme (E08-S02, AC2).
    expect([member.status, stranger.status]).toEqual([401, 401])
    expect([member.headers.get("www-authenticate"), stranger.headers.get("www-authenticate")]).toEqual(['Bearer error="invalid_token"', 'Bearer error="invalid_token"'])
    expect(warn).toHaveBeenCalledTimes(2)
    expect(await identitiesOf(subject)).toEqual([])
  })

  it("should send the invitation email by the relay of the host, at the brand of the organisation, with a link to its login (AC-a8)", async () => {
    const email = address()

    const response = await viaApi(await tokenOf(ada.subject, ada.email), "POST", { email })
    const body = await response.json()
    const [row] = await seed.admin`select id, revoked_at from platform.invitations where org_id = ${org.id} and email = ${email}`

    expect(response.status).toBe(201)
    expect(body.data).toEqual({ invitation: { id: row.id, email, role: "member", teamId: null, expiresAt: expect.any(String) }, emailed: true })
    expect(row.revoked_at).toBeNull()
    expect(relay.sent).toHaveLength(1)
    const [message] = relay.sent
    expect(message).toMatchObject({ from: FROM, to: email, subject: `Invitation à rejoindre ${org.name}` })
    expect(message.text).toContain(`https://${org.host}/login`)
    expect(message.html).toContain(`>${org.name}</h1>`)
    expect(message.html).not.toContain("Atelier")
    expect(message.html).toContain(`<img src="${BRAND.logo_url}"`)
  })

  it("should create no invitation and name the variable when the relay is not configured (AC-a8b)", async () => {
    vi.stubEnv("PLATFORM_SMTP_URL", "")
    vi.spyOn(console, "error").mockImplementation(() => {})
    const email = address()

    const response = await viaApi(await tokenOf(ada.subject, ada.email), "POST", { email })
    const { error } = await response.json()

    expect([response.status, error.code]).toEqual([500, "internal"])
    expect(error.message).toContain("PLATFORM_SMTP_URL")
    expect([...(await seed.admin`select id from platform.invitations where org_id = ${org.id} and email = ${email}`)]).toEqual([])
    expect(relay.sent).toEqual([])
  })

  it("should withdraw the invitation when the relay refuses, and log without the address of the relay (AC-a8b)", async () => {
    relay.refuse = true
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    const email = address()

    const response = await viaApi(await tokenOf(ada.subject, ada.email), "POST", { email })
    const { error } = await response.json()
    const [row] = await seed.admin`select revoked_at from platform.invitations where org_id = ${org.id} and email = ${email}`

    expect([response.status, error.code]).toEqual([500, "internal"])
    expect(error.message).toContain("withdrawn")
    expect(row.revoked_at).not.toBeNull()
    expect(loggedText(log)).toContain("ECONNECTION")
    expect(loggedText(log)).not.toContain("relay.example.invalid")
  })

  it("should create no invitation, and log it, when the address of the request is neither http nor https", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    const db = asCaller(ada.id, ada.email)
    const identity = await resolveIdentity(db, org.host, { email: ada.email })
    const email = address()

    const refusal = await inviteMember(db, identity, { email }, { redirectTo: "javascript://x/%0aalert(1)" }).catch((error: unknown) => error)

    expect(refusal).toMatchObject({ code: "internal" })
    expect(loggedText(log)).toContain("the request origin is not http(s)")
    expect([...(await seed.admin`select id from platform.invitations where org_id = ${org.id} and email = ${email}`)]).toEqual([])
    expect(relay.sent).toEqual([])
  })
})
