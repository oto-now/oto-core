// @vitest-environment node
// L'hôte de référence en mode OIDC (E01-S11 partie b, AC-b1 à AC-b6) : middleware, routes
// `/auth/oidc/*`, pages et route de l'API, sur l'émetteur de test servi en mémoire
// (`tests/helpers/oidc-issuer.ts` : découverte, clés, autorisation, jeton, révocation, déconnexion
// annoncée), posé à la place du `fetch` global par l'hôte de test (`tests/helpers/oidc-host.ts`) ; aucun
// service réel (HN-E01S11-5). Les services du paquet sont simulés à leur frontière : l'acceptation des
// invitations et la porte de l'API ; la vérification du jeton d'accès, elle, est celle du paquet (AC-a3).
// Le cookie chiffré lui-même : `tests/unit/oidc-session.test.ts`.
import type { NextResponse } from "next/server"
import { headers } from "next/headers"
import { randomBytes, randomUUID } from "crypto"
import { decodeJwt } from "jose"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { handlePlateforme } from "@otomata_tech/oto_platform/api"
import { acceptInvitations, createAnonPlatformDb, createPlatformDb, resolveIdentity } from "@otomata_tech/oto_platform/server"
import DashboardPage from "@/app/(dashboard)/page"
import PlateformePage from "@/app/(dashboard)/platform/page"
import ForgotPasswordPage from "@/app/(auth)/forgot-password/page"
import LoginPage from "@/app/(auth)/login/page"
import ResetPasswordPage from "@/app/(auth)/reset-password/page"
import { GET as apiRoute } from "@/app/api/platform/[...route]/route"
import { GET as supabaseCallback } from "@/app/auth/callback/route"
import ConfirmerPage from "@/app/auth/confirm/page"
import { GET as callbackRoute } from "@/app/auth/oidc/callback/route"
import { GET as loginRoute } from "@/app/auth/oidc/login/route"
import { POST as logoutRoute } from "@/app/auth/oidc/logout/route"
import ConsentPage from "@/app/oauth/consent/page"
import { loginAction, logoutAction } from "@/lib/actions/auth"
import { getPlatformSession, getSessionAccessToken } from "@/lib/plateforme/session"
import { middleware } from "@/middleware"
import { makeVerifyToken } from "../../packages/plateforme/mcp/auth"
import { loggedText } from "../helpers/logs"
import { orgDomainsDb } from "../helpers/org-domains"
import { absorb, AUDIENCE, CLIENT_ID, EMAIL, NAME, oidcHost, ORIGIN, PERSON, request, SESSION_COOKIE, SUBJECT, type Jar } from "../helpers/oidc-host"
import type { TestIssuer, TestPerson } from "../helpers/oidc-issuer"
import { identityOf } from "../helpers/reference-org"

const LOGIN_COOKIE = "__Host-plateforme-oidc"

type WritableJar = { get(name: string): { name: string; value: string } | undefined; getAll(): { name: string; value: string }[]; set: ReturnType<typeof vi.fn> }

// L'hôte de la requête (`getRequestOrigin`) et ses cookies (`cookies()` des écrans, de la route de l'API
// et des Server Actions), tels que Next les donnerait.
const host = vi.hoisted((): { cookies: unknown } => ({ cookies: null }))
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ host: "acme.example.test", "x-forwarded-proto": "https" })),
  cookies: vi.fn(async () => host.cookies),
}))

// `redirect()` et `notFound()` lèvent dans Next : les simulations aussi, le rendu s'arrête comme en production.
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND")
  }),
  unstable_rethrow: vi.fn(),
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

const supabaseAuth = vi.hoisted(() => ({ getUser: vi.fn(), getSession: vi.fn(), exchangeCodeForSession: vi.fn(), signInWithPassword: vi.fn() }))
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ auth: supabaseAuth })) }))

vi.mock("@otomata_tech/oto_platform/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@otomata_tech/oto_platform/server")>()),
  createPlatformDb: vi.fn(() => ({})),
  // Le client sans session de `getRequestOrigin` : `org_by_host` sert l'organisation d'`ORIGIN` seulement.
  createAnonPlatformDb: vi.fn(),
  acceptInvitations: vi.fn(async () => []),
  // L'accueil (E05-S09 b) résout l'identité de la session et lit ses services : simulés comme la porte de l'API.
  resolveIdentity: vi.fn(async () => identityOf("lea")),
  listConversations: vi.fn(async () => ({ conversations: [], total: 0, calls: 0, withErrors: 0, truncated: false, restarted: false, nextCursor: null })),
  lastConnections: vi.fn(async () => []),
}))
vi.mock("@otomata_tech/oto_platform/api", () => ({ handlePlateforme: vi.fn(async () => Response.json({ data: null })) }))

/** Supabase Auth, tel que le lit l'hôte : la personne connectée et son jeton, ou personne. */
function supabaseSignedIn(signedIn: boolean): void {
  const user = { id: SUBJECT, email: EMAIL, user_metadata: { full_name: NAME } }
  supabaseAuth.getUser.mockResolvedValue({ data: { user: signedIn ? user : null }, error: null })
  supabaseAuth.getSession.mockResolvedValue({ data: { session: signedIn ? { access_token: "supabase-session-token", user } : null }, error: null })
}

/** `cookies()` de Next sur ces cookies : lecture, et écritures relevées (Server Action). */
function cookieJar(jar: Jar): WritableJar {
  const values = new Map(jar)
  return {
    get: (name) => (values.has(name) ? { name, value: values.get(name) ?? "" } : undefined),
    getAll: () => [...values].map(([name, value]) => ({ name, value })),
    set: vi.fn((name: string, value: string) => (value ? values.set(name, value) : values.delete(name))),
  }
}

function sessionCookies(response: NextResponse) {
  return response.cookies.getAll().filter((cookie) => cookie.name.startsWith(SESSION_COOKIE))
}

/** Une connexion par les routes de l'hôte, jusqu'au retour de l'émetteur : le rappel et les cookies laissés. */
async function signIn(issuer: TestIssuer, person: TestPerson = PERSON, back = "/n/contexte"): Promise<{ jar: Jar; callback: NextResponse }> {
  const login = await loginRoute(request(`/auth/oidc/login?redirect=${encodeURIComponent(back)}`))
  const jar = absorb(new Map(), login)
  const callbackUrl = issuer.authorize(login.headers.get("location") ?? "", person)
  const callback = await callbackRoute(request(callbackUrl, jar))
  return { jar: absorb(jar, callback), callback }
}

beforeEach(() => {
  vi.clearAllMocks()
  host.cookies = cookieJar(new Map())
  vi.mocked(createAnonPlatformDb).mockReturnValue(orgDomainsDb([new URL(ORIGIN).hostname]))
})

/** La requête suivante arrive par un proxy qui transmet `x-forwarded-host` tel quel, forgé par le client. */
function forgedHost(): void {
  vi.mocked(headers).mockResolvedValueOnce(new Headers({ "x-forwarded-host": "evil.example.test", host: new URL(ORIGIN).host, "x-forwarded-proto": "https" }) as unknown as Awaited<ReturnType<typeof headers>>)
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("sign-in at the issuer (AC-b1)", () => {
  it("should send a page opened without a session to the issuer, with PKCE, state, nonce and the resource", async () => {
    const issuer = await oidcHost()

    const opened = await middleware(request("/n/contexte"))
    const posted = await middleware(request("/platform/invitations", new Map(), { method: "POST" }))
    const login = await loginRoute(request("/auth/oidc/login?redirect=%2Fn%2Fcontexte"))

    expect(opened.headers.get("location")).toBe(`${ORIGIN}/auth/oidc/login?redirect=%2Fn%2Fcontexte`)
    // Une requête autre que GET garde la règle d'`auth-patterns.md § Middleware` : `/login`.
    expect(posted.headers.get("location")).toBe(`${ORIGIN}/login`)
    const to = new URL(login.headers.get("location") ?? "")
    expect(`${to.origin}${to.pathname}`).toBe(`${issuer.issuer}/auth`)
    expect(Object.fromEntries(to.searchParams)).toEqual({
      client_id: CLIENT_ID,
      redirect_uri: `${ORIGIN}/auth/oidc/callback`,
      response_type: "code",
      scope: "openid email profile offline_access",
      prompt: "consent",
      resource: AUDIENCE,
      state: expect.stringMatching(/^[\w-]{20,}$/),
      nonce: expect.stringMatching(/^[\w-]{20,}$/),
      code_challenge: expect.stringMatching(/^[\w-]{43}$/),
      code_challenge_method: "S256",
    })
    expect(login.cookies.get(LOGIN_COOKIE)).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 600 })
  })

  // Aucune adresse de retour n'est confiée à l'émetteur hors d'une adresse qui sert une organisation (ou d'entrée).
  it("should refuse to start from a forwarded host that serves no organisation", async () => {
    await oidcHost()
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    forgedHost()

    const login = await loginRoute(request("/auth/oidc/login?redirect=%2Fn%2Fcontexte"))

    expect(login.status).toBe(400)
    expect(login.headers.get("location")).toBeNull()
    expect(login.cookies.get(LOGIN_COOKIE)).toBeUndefined()
    expect(loggedText(log)).toContain("evil.example.test")
  })
})

describe("the way back from the issuer (AC-b2)", () => {
  it("should exchange the code, set the session, accept the pending invitations and reach the requested page", async () => {
    const issuer = await oidcHost()

    const { jar, callback } = await signIn(issuer)

    expect(callback.status).toBe(307)
    expect(callback.headers.get("location")).toBe(`${ORIGIN}/n/contexte`)
    expect(callback.cookies.get(LOGIN_COOKIE)?.maxAge).toBe(0)
    host.cookies = cookieJar(jar)
    const token = (await getSessionAccessToken()) ?? ""
    // Les invitations en attente, par le service du paquet, sous l'appelant de l'`id_token` validé, que la
    // base traduit (E01-S11 a1-wire).
    const caller = { issuer: issuer.issuer, issuerKind: "oidc", subject: SUBJECT, email: EMAIL, name: NAME }
    expect(createPlatformDb).toHaveBeenCalledWith({ caller })
    expect(acceptInvitations).toHaveBeenCalledTimes(1)
    // Le jeton d'accès de la session porte la ressource demandée : la vérification du paquet l'accepte (AC-a3).
    expect((await makeVerifyToken()(new Request(AUDIENCE), token))?.extra?.sub).toBe(SUBJECT)
  })

  // L'invitation relie une personne par son email (AC-a4) : un email que l'émetteur n'a pas vérifié n'entre pas (HN-E01S09-3).
  it("should give the package no email that the issuer did not verify", async () => {
    const issuer = await oidcHost()

    await signIn(issuer, { ...PERSON, claims: { ...PERSON.claims, email_verified: false } })

    expect(createPlatformDb).toHaveBeenCalledWith(
      expect.objectContaining({ caller: { issuer: issuer.issuer, issuerKind: "oidc", subject: SUBJECT, email: null, name: NAME } }),
    )
  })

  it.each(["//evil.example.test", "https://evil.example.test/n/contexte"])("should bring the way back %s to /", async (back) => {
    const issuer = await oidcHost()

    const { callback } = await signIn(issuer, PERSON, back)

    expect(callback.headers.get("location")).toBe(`${ORIGIN}/`)
  })

  it("should answer 400 and set nothing when state does not match", async () => {
    const issuer = await oidcHost()
    vi.spyOn(console, "error").mockImplementation(() => {})
    const login = await loginRoute(request("/auth/oidc/login"))
    const jar = absorb(new Map(), login)
    const back = new URL(issuer.authorize(login.headers.get("location") ?? "", PERSON))
    back.searchParams.set("state", "another-state-than-the-browser-one")

    const response = await callbackRoute(request(back.href, jar))

    expect(response.status).toBe(400)
    expect(response.headers.get("set-cookie")).toBeNull()
    expect(issuer.requests.filter((url) => url.endsWith("/token"))).toEqual([])
    expect(acceptInvitations).not.toHaveBeenCalled()
  })

  // Un refus de l'émetteur (accès refusé, annulation) revient aussi au rappel : 400, rien de posé, et au
  // log le seul code OAuth, jamais un texte venu du navigateur (`auth-patterns.md § Auth Callback`).
  it.each([
    { error: "access_denied", logged: "access_denied" },
    { error: "access_denied\n[oidc] forged line", logged: "authorization error" },
  ])("should answer 400 to an error returned by the issuer, logging only its code ($logged)", async ({ error, logged }) => {
    await oidcHost()
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    const login = await loginRoute(request("/auth/oidc/login"))
    const jar = absorb(new Map(), login)
    const back = new URL(`${ORIGIN}/auth/oidc/callback`)
    back.searchParams.set("error", error)
    back.searchParams.set("error_description", "La personne a refusé l'accès.")
    back.searchParams.set("state", new URL(login.headers.get("location") ?? "").searchParams.get("state") ?? "")

    const response = await callbackRoute(request(back.href, jar))

    expect(response.status).toBe(400)
    expect(response.headers.get("set-cookie")).toBeNull()
    const text = loggedText(log)
    expect(text).toContain(`sign-in refused (${logged})`)
    expect(text).not.toContain("forged line")
    expect(text).not.toContain("refusé l'accès")
  })

  it.each([
    { claim: "nonce", idToken: { nonce: "another-nonce" } },
    { claim: "aud", idToken: { aud: "another-client" } },
    { claim: "iss", idToken: { iss: "https://another-issuer.example.test/oidc" } },
    { claim: "exp", idToken: { exp: Math.floor(Date.now() / 1000) - 300 } },
  ])("should refuse an id_token whose $claim is wrong, and set no session", async ({ idToken }) => {
    const issuer = await oidcHost()
    vi.spyOn(console, "error").mockImplementation(() => {})

    const { callback } = await signIn(issuer, { ...PERSON, idToken })

    expect(callback.status).toBe(400)
    expect(sessionCookies(callback)).toEqual([])
    expect(acceptInvitations).not.toHaveBeenCalled()
  })
})

describe("the silent refresh (AC-b3)", () => {
  it("should refresh an expired session when a page opens, for the page and for the browser", async () => {
    const issuer = await oidcHost()
    issuer.accessTokenTtl = 0
    const { jar } = await signIn(issuer)
    host.cookies = cookieJar(jar)
    const expired = await getSessionAccessToken()
    issuer.accessTokenTtl = 3600

    const response = await middleware(request("/n/contexte", jar))

    expect(expired).toBeNull()
    expect(response.headers.get("location")).toBeNull()
    const renewed = absorb(new Map(jar), response)
    host.cookies = cookieJar(renewed)
    const token = (await getSessionAccessToken()) ?? ""
    // Le jeton rafraîchi porte encore la ressource demandée : la vérification du paquet l'accepte (AC-a3).
    expect((await makeVerifyToken()(new Request(AUDIENCE), token))?.extra?.sub).toBe(SUBJECT)
    // La requête que la page lit porte déjà la session rafraîchie.
    expect(response.headers.get("x-middleware-request-cookie")).toContain(renewed.get(`${SESSION_COOKIE}.0`))
    expect(issuer.requests.filter((url) => url.endsWith("/token"))).toHaveLength(2)
  })

  it("should send back to sign-in, the session removed, when the refresh fails", async () => {
    const issuer = await oidcHost()
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    issuer.accessTokenTtl = 0
    const { jar } = await signIn(issuer)
    issuer.refreshTokens.clear()

    const response = await middleware(request("/n/contexte", jar))

    expect(response.headers.get("location")).toBe(`${ORIGIN}/auth/oidc/login?redirect=%2Fn%2Fcontexte`)
    expect(sessionCookies(response).map((cookie) => [cookie.value, cookie.maxAge, cookie.secure])).toEqual([["", 0, true]])
    expect(log).toHaveBeenCalledWith(expect.stringContaining("refresh refused (invalid_grant"))
  })

  // OpenID Connect Core § 12.2 : sans ce contrôle, la session garderait le sujet de l'une et l'email de l'autre.
  it("should refuse a refreshed id_token that names another person", async () => {
    const issuer = await oidcHost()
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    issuer.accessTokenTtl = 0
    const { jar } = await signIn(issuer)
    for (const granted of issuer.refreshTokens.values()) granted.person = { sub: randomUUID(), claims: { email: "autre@acme.example.test", email_verified: true } }

    const response = await middleware(request("/n/contexte", jar))

    expect(response.headers.get("location")).toBe(`${ORIGIN}/auth/oidc/login?redirect=%2Fn%2Fcontexte`)
    expect(sessionCookies(response).map((cookie) => cookie.maxAge)).toEqual([0])
    expect(log).toHaveBeenCalledWith(expect.stringContaining("names another subject"))
  })

  // Une requête voisine a pu rafraîchir la session juste avant : tant que le jeton vaut, rien ne se retire.
  it("should keep a session whose access token still holds when its refresh is refused", async () => {
    const issuer = await oidcHost()
    vi.spyOn(console, "error").mockImplementation(() => {})
    issuer.accessTokenTtl = 30
    const { jar } = await signIn(issuer)
    issuer.refreshTokens.clear()

    const response = await middleware(request("/n/contexte", jar))

    expect(response.headers.get("location")).toBeNull()
    expect(response.cookies.getAll()).toEqual([])
  })
})

describe("a forwarded host that serves no organisation", () => {
  it("should refuse the way back from the issuer, and set no session", async () => {
    const issuer = await oidcHost()
    const login = await loginRoute(request("/auth/oidc/login?redirect=%2Fn%2Fcontexte"))
    const callbackUrl = issuer.authorize(login.headers.get("location") ?? "", PERSON)
    vi.spyOn(console, "error").mockImplementation(() => {})
    forgedHost()

    const callback = await callbackRoute(request(callbackUrl, absorb(new Map(), login)))

    expect(callback.status).toBe(400)
    expect(callback.headers.get("location")).toBeNull()
    expect(sessionCookies(callback)).toEqual([])
  })

  it("should refuse the sign-out", async () => {
    const issuer = await oidcHost()
    const { jar } = await signIn(issuer)
    vi.spyOn(console, "error").mockImplementation(() => {})
    forgedHost()

    const response = await logoutRoute(request("/auth/oidc/logout", jar, { method: "POST", headers: { origin: "https://evil.example.test" } }))

    expect(response.status).toBe(403)
  })
})

describe("sign-out (AC-b4)", () => {
  it("should remove the session, revoke its refresh token and send the person through the end_session_endpoint of the issuer", async () => {
    const issuer = await oidcHost()
    const { jar } = await signIn(issuer)

    const response = await logoutRoute(request("/auth/oidc/logout", jar, { method: "POST", headers: { origin: ORIGIN } }))

    // Révoqué chez l'émetteur (RFC 7009) : une copie du cookie faite avant la déconnexion ne se rafraîchit plus.
    expect(issuer.refreshTokens.size).toBe(0)
    expect(response.status).toBe(303)
    const to = new URL(response.headers.get("location") ?? "")
    expect(`${to.origin}${to.pathname}`).toBe(`${issuer.issuer}/session/end`)
    expect(to.searchParams.get("client_id")).toBe(CLIENT_ID)
    expect(to.searchParams.get("post_logout_redirect_uri")).toBe(`${ORIGIN}/login`)
    expect(decodeJwt(to.searchParams.get("id_token_hint") ?? "").sub).toBe(SUBJECT)
    expect(sessionCookies(response).map((cookie) => [cookie.value, cookie.maxAge, cookie.secure, cookie.path])).toEqual([["", 0, true, "/"]])
  })

  it("should send the person to /login when the issuer announces no end_session_endpoint", async () => {
    const issuer = await oidcHost({ endSession: false })
    const { jar } = await signIn(issuer)

    const response = await logoutRoute(request("/auth/oidc/logout", jar, { method: "POST", headers: { origin: ORIGIN } }))

    expect(response.headers.get("location")).toBe(`${ORIGIN}/login`)
    expect(sessionCookies(response).map((cookie) => cookie.maxAge)).toEqual([0])
  })

  // Une révocation refusée ne retient pas la personne : au log, son seul code ; la déconnexion continue.
  it("should still sign out when the issuer refuses the revocation", async () => {
    const issuer = await oidcHost()
    const { jar } = await signIn(issuer)
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    issuer.clients.clear()

    const response = await logoutRoute(request("/auth/oidc/logout", jar, { method: "POST", headers: { origin: ORIGIN } }))

    expect(response.status).toBe(303)
    expect(sessionCookies(response).map((cookie) => cookie.maxAge)).toEqual([0])
    expect(log).toHaveBeenCalledWith(expect.stringContaining("revocation refused (invalid_client, HTTP 401)"))
  })

  // Un Route Handler n'a pas la protection d'origine des Server Actions (`security-patterns.md § CSRF Protection`).
  it("should refuse a sign-out posted from another origin, the session kept", async () => {
    const issuer = await oidcHost()
    const { jar } = await signIn(issuer)

    const response = await logoutRoute(request("/auth/oidc/logout", jar, { method: "POST", headers: { origin: "https://evil.example.test" } }))

    expect(response.status).toBe(403)
    expect(response.headers.get("set-cookie")).toBeNull()
    expect(issuer.refreshTokens.size).toBe(1)
  })

  it("should close the session from « Se déconnecter » too, through the issuer", async () => {
    const issuer = await oidcHost()
    const { jar } = await signIn(issuer)
    const cookies = cookieJar(jar)
    host.cookies = cookies

    await expect(logoutAction()).rejects.toThrow(`NEXT_REDIRECT:${issuer.issuer}/session/end?`)
    expect(cookies.set).toHaveBeenCalledWith(`${SESSION_COOKIE}.0`, "", expect.objectContaining({ maxAge: 0, secure: true, httpOnly: true, path: "/" }))
    expect(supabaseAuth.getUser).not.toHaveBeenCalled()
  })
})

describe("the pages of each mode (AC-b5)", () => {
  it("should send /login to the issuer, and answer 404 for the pages of Supabase Auth, in OIDC mode", async () => {
    await oidcHost()

    await expect(LoginPage({ searchParams: Promise.resolve({ redirect: "/n/contexte" }) })).rejects.toThrow(
      `NEXT_REDIRECT:/auth/oidc/login?redirect=${encodeURIComponent("/n/contexte")}`,
    )
    for (const page of [
      () => ForgotPasswordPage(),
      () => ResetPasswordPage(),
      () => ConfirmerPage({ searchParams: Promise.resolve({ token_hash: "hash", type: "email" }) }),
      () => ConsentPage({ searchParams: Promise.resolve({ authorization_id: "abc123" }) }),
    ]) {
      await expect(page()).rejects.toThrow("NEXT_NOT_FOUND")
    }
    expect((await supabaseCallback(new Request(`${ORIGIN}/auth/callback?code=abc`))).status).toBe(404)
    expect(supabaseAuth.exchangeCodeForSession).not.toHaveBeenCalled()
  })

  // Leurs Server Actions restent appelables par leur identifiant : chez un hôte qui garderait les variables
  // de Supabase, la session qu'elles ouvriraient ne prend pas l'invitation d'une personne de l'émetteur.
  it("should accept no invitation for a session that a Supabase action opens, in OIDC mode", async () => {
    await oidcHost()
    supabaseAuth.signInWithPassword.mockResolvedValue({
      data: { session: { access_token: "supabase-session-token", user: { id: randomUUID(), email: EMAIL, user_metadata: {} } } },
      error: null,
    })
    const form = new FormData()
    form.set("email", EMAIL)
    form.set("password", randomBytes(8).toString("hex"))

    await expect(loginAction(form)).rejects.toThrow("NEXT_REDIRECT:/")

    expect(supabaseAuth.signInWithPassword).toHaveBeenCalledTimes(1)
    expect(acceptInvitations).not.toHaveBeenCalled()
  })

  it("should answer 404 on the routes of the issuer in Supabase mode", async () => {
    vi.stubEnv("PLATFORM_OIDC_ISSUER", "")

    const answers = await Promise.all([
      loginRoute(request("/auth/oidc/login")),
      callbackRoute(request("/auth/oidc/callback?code=abc&state=xyz")),
      logoutRoute(request("/auth/oidc/logout", new Map(), { method: "POST", headers: { origin: ORIGIN } })),
    ])

    expect(answers.map((response) => response.status)).toEqual([404, 404, 404])
  })
})

describe("the rest of the host in both modes (AC-b6)", () => {
  /** Ce que l'hôte donne au paquet et montre, pour la session du moment. */
  async function answers() {
    vi.mocked(createPlatformDb).mockClear()
    vi.mocked(resolveIdentity).mockClear()
    const session = await getPlatformSession()
    const caller = vi.mocked(createPlatformDb).mock.calls[0]?.[0].caller
    const pages = [await DashboardPage(), await PlateformePage()]
    // La personne dont l'accueil résout l'identité, à l'hôte de la requête.
    const resolved = vi.mocked(resolveIdentity).mock.lastCall?.slice(1)
    await apiRoute(new Request(`${ORIGIN}/api/platform/teams`))
    return { user: session?.user, host: session?.host, caller, resolved, pages, token: vi.mocked(handlePlateforme).mock.lastCall?.[1].accessToken }
  }

  it("should give the package, the dashboard and the API the same person in both modes", async () => {
    vi.stubEnv("PLATFORM_OIDC_ISSUER", "")
    supabaseSignedIn(true)
    const supabase = await answers()
    const issuer = await oidcHost()
    const { jar } = await signIn(issuer)
    host.cookies = cookieJar(jar)
    // Chez un hôte OIDC, Supabase Auth ne connaît personne : ce que l'hôte montre vient de sa seule session.
    supabaseSignedIn(false)

    const oidc = await answers()

    // La même personne : l'identifiant de Supabase Auth, ou l'émetteur et le sujet que la base traduit (a1-wire).
    expect(supabase.caller).toEqual({ userId: SUBJECT, email: EMAIL, name: NAME })
    expect(oidc.caller).toEqual({ issuer: issuer.issuer, issuerKind: "oidc", subject: SUBJECT, email: EMAIL, name: NAME })
    expect(supabase.resolved).toEqual([expect.any(String), { email: EMAIL }])
    expect({ ...oidc, caller: undefined, token: undefined }).toEqual({ ...supabase, caller: undefined, token: undefined })
    expect(supabase.token).toBe("supabase-session-token")
    expect(decodeJwt(oidc.token ?? "")).toMatchObject({ sub: SUBJECT, aud: AUDIENCE, iss: issuer.issuer })
  })

  // En mode OIDC, une personne connectée à Supabase Auth, sans session de l'hôte : seule une page qui lit
  // la session de son mode la renvoie à la connexion.
  it.each(["supabase", "oidc"] as const)("should send the dashboard pages to /login without a session of their mode, in %s mode", async (mode) => {
    if (mode === "oidc") await oidcHost()
    else vi.stubEnv("PLATFORM_OIDC_ISSUER", "")
    supabaseSignedIn(mode === "oidc")

    await expect(DashboardPage()).rejects.toThrow("NEXT_REDIRECT:/login")
    await expect(PlateformePage()).rejects.toThrow("NEXT_REDIRECT:/login")
  })
})
