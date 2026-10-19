import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { readFileSync } from "fs"
import path from "path"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { acceptInvitations, createAnonPlatformDb, createPlatformDb } from "@otomata_tech/oto_platform/server"
import {
  confirmerLienAction,
  connexionFournisseurAction,
  forgotPasswordAction,
  loginAction,
  magicLinkAction,
  resetPasswordAction,
} from "@/lib/actions/auth"
import { orgDomainsDb } from "../../helpers/org-domains"

const auth = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  getUser: vi.fn(),
  updateUser: vi.fn(),
  signInWithOtp: vi.fn(),
  verifyOtp: vi.fn(),
  signInWithOAuth: vi.fn(),
}))

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth })),
}))

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

// L'hôte appelé : le lien de connexion y ramène (E02-S01 N2).
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ "x-forwarded-host": "acme.test", "x-forwarded-proto": "https" })),
}))

// Les services du paquet sont simulés : l'acceptation des invitations est observée, et le client sans session ne
// connaît que les adresses d'organisation de `ORG_HOSTS` (`org_by_host`) ; `trustedRequestOrigin` reste le vrai.
vi.mock("@otomata_tech/oto_platform/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@otomata_tech/oto_platform/server")>()),
  createPlatformDb: vi.fn(() => ({})),
  createAnonPlatformDb: vi.fn(),
  acceptInvitations: vi.fn(async () => []),
}))

const ORG_HOSTS = ["acme.test", "acme.cellule.test", "acme.example.test"]

// redirect() lève NEXT_REDIRECT dans Next : le mock lève aussi, pour que le code après
// l'appel ne s'exécute pas comme en production.
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
  unstable_rethrow: vi.fn(),
}))

function form(fields: Record<string, string>): FormData {
  const data = new FormData()
  Object.entries(fields).forEach(([key, value]) => data.set(key, value))
  return data
}

const SUPABASE_MESSAGE = "relation auth.users: Invalid login credentials for user@example.com"
// La session ouverte par Supabase Auth porte son compte : l'appelant vérifié qu'elle passe au paquet (E01-S10).
const SESSION = { access_token: "session-token", user: { id: "user-1", email: "user@example.com", user_metadata: { full_name: "Claire Morel" } } }
const SESSION_DB = { caller: { userId: "user-1", email: "user@example.com", name: "Claire Morel" } }
const MAGIC_LINK_MESSAGE =
  "Si une invitation ou un compte existe pour cette adresse, un lien de connexion vient de partir."

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  // L'adresse commune du site : une adresse d'entrée, qui ne sert aucune organisation ici.
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://localhost:3000")
  vi.mocked(createAnonPlatformDb).mockReturnValue(orgDomainsDb(ORG_HOSTS))
})

/** En-têtes de la requête, lus par `getRequestOrigin()`, pour le prochain appel. */
function requestHeaders(values: Record<string, string>) {
  // `headers()` rend des en-têtes en lecture seule : des `Headers` ordinaires suffisent à la lecture.
  vi.mocked(headers).mockResolvedValueOnce(new Headers(values) as unknown as Awaited<ReturnType<typeof headers>>)
}

describe("loginAction", () => {
  it("should return an error when the input is invalid", async () => {
    const result = await loginAction(form({ email: "not-an-email", password: "x" }))

    expect(result).toEqual({ error: expect.any(String) })
    expect(auth.signInWithPassword).not.toHaveBeenCalled()
  })

  it("should return a generic error without the Supabase message when sign-in fails", async () => {
    auth.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: SUPABASE_MESSAGE, status: 400 },
    })

    const result = await loginAction(form({ email: "user@example.com", password: "password123" }))

    expect(result).toEqual({ error: "Email ou mot de passe incorrect." })
    expect(result?.error).not.toContain(SUPABASE_MESSAGE)
  })

  it("should redirect to / when sign-in succeeds", async () => {
    auth.signInWithPassword.mockResolvedValue({ data: {}, error: null })

    await expect(
      loginAction(form({ email: "user@example.com", password: "password123" }))
    ).rejects.toThrow("NEXT_REDIRECT:/")
    expect(redirect).toHaveBeenCalledWith("/")
  })

  it("should accept pending invitations with the session token before redirecting", async () => {
    auth.signInWithPassword.mockResolvedValue({ data: { session: SESSION }, error: null })

    await expect(loginAction(form({ email: "user@example.com", password: "password123" }))).rejects.toThrow(
      "NEXT_REDIRECT:/",
    )
    expect(createPlatformDb).toHaveBeenCalledWith(SESSION_DB)
    expect(acceptInvitations).toHaveBeenCalledTimes(1)
    expect(vi.mocked(acceptInvitations).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(redirect).mock.invocationCallOrder[0],
    )
  })

  it("should still sign in when accepting invitations fails, and log the failure", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    auth.signInWithPassword.mockResolvedValue({ data: { session: SESSION }, error: null })
    vi.mocked(acceptInvitations).mockRejectedValueOnce(new Error("database unavailable"))

    await expect(loginAction(form({ email: "user@example.com", password: "password123" }))).rejects.toThrow(
      "NEXT_REDIRECT:/",
    )
    expect(log).toHaveBeenCalled()
  })
})

describe("magicLinkAction", () => {
  it("should ask Supabase for a link back to the calling address", async () => {
    auth.signInWithOtp.mockResolvedValue({ data: {}, error: null })

    const result = await magicLinkAction(form({ email: "claire@acme.test" }))

    expect(result).toEqual({ data: { message: MAGIC_LINK_MESSAGE } })
    expect(auth.signInWithOtp).toHaveBeenCalledWith({
      email: "claire@acme.test",
      options: { shouldCreateUser: true, emailRedirectTo: "https://acme.test/auth/confirm?next=/" },
    })
  })

  it("should give the same answer for an invalid email, without calling Supabase", async () => {
    const result = await magicLinkAction(form({ email: "not-an-email" }))

    expect(result).toEqual({ data: { message: MAGIC_LINK_MESSAGE } })
    expect(auth.signInWithOtp).not.toHaveBeenCalled()
  })

  it("should give the same answer when the hook refuses the address", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    auth.signInWithOtp.mockResolvedValue({ data: {}, error: { status: 403, message: SUPABASE_MESSAGE } })

    const result = await magicLinkAction(form({ email: "stranger@acme.test" }))

    expect(result).toEqual({ data: { message: MAGIC_LINK_MESSAGE } })
    expect(JSON.stringify(result)).not.toContain(SUPABASE_MESSAGE)
  })
})

describe("confirmerLienAction", () => {
  const LINK = { token_hash: "hash-from-the-email", type: "email", next: "/platform" }

  it("should verify the token, accept invitations, then go to next", async () => {
    auth.verifyOtp.mockResolvedValue({ data: { session: SESSION }, error: null })

    await expect(confirmerLienAction(form(LINK))).rejects.toThrow("NEXT_REDIRECT:/platform")
    expect(auth.verifyOtp).toHaveBeenCalledWith({ type: "email", token_hash: "hash-from-the-email" })
    expect(createPlatformDb).toHaveBeenCalledWith(SESSION_DB)
    expect(acceptInvitations).toHaveBeenCalledTimes(1)
  })

  it("should send a refused token to the login error", async () => {
    auth.verifyOtp.mockResolvedValue({ data: { session: null }, error: { status: 403, message: "expired" } })

    await expect(confirmerLienAction(form(LINK))).rejects.toThrow("NEXT_REDIRECT:/login?error=auth_callback_error")
    expect(acceptInvitations).not.toHaveBeenCalled()
  })

  it("should refuse a type other than email without verifying anything", async () => {
    await expect(confirmerLienAction(form({ ...LINK, type: "magiclink" }))).rejects.toThrow(
      "NEXT_REDIRECT:/login?error=auth_callback_error",
    )
    expect(auth.verifyOtp).not.toHaveBeenCalled()
  })

  it("should refuse missing parameters", async () => {
    await expect(confirmerLienAction(form({}))).rejects.toThrow("NEXT_REDIRECT:/login?error=auth_callback_error")
    expect(auth.verifyOtp).not.toHaveBeenCalled()
  })

  // Un navigateur retire tabulations et retours à la ligne d'une URL et lit `\` comme `/` :
  // `/\t/evil.test` y devient `//evil.test`, une autre adresse (revue E02-S01, HAUTE).
  it.each(["//evil.test", "https://evil.test", "/\\evil.test", "/\t/evil.test", "/\n/evil.test"])(
    "should bring an absolute next (%j) back to /",
    async (next) => {
      auth.verifyOtp.mockResolvedValue({ data: { session: SESSION }, error: null })

      await expect(confirmerLienAction(form({ ...LINK, next }))).rejects.toThrow(/^NEXT_REDIRECT:\/$/)
    },
  )

  it("should refuse a next whose dot segments resolve to //host", async () => {
    auth.verifyOtp.mockResolvedValue({ data: { session: SESSION }, error: null })

    await expect(confirmerLienAction(form({ ...LINK, next: "/.//evil.test" }))).rejects.toThrow(/^NEXT_REDIRECT:\/$/)
  })

  it("should keep the query and the fragment of a path of the site", async () => {
    auth.verifyOtp.mockResolvedValue({ data: { session: SESSION }, error: null })

    await expect(confirmerLienAction(form({ ...LINK, next: "/teams?tab=teams#news" }))).rejects.toThrow(
      /^NEXT_REDIRECT:\/teams\?tab=teams#news$/,
    )
  })
})

describe("forgotPasswordAction", () => {
  it("should return the same success when the email exists", async () => {
    auth.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null })

    const result = await forgotPasswordAction(form({ email: "known@example.com" }))

    expect(result).toEqual({ data: { message: expect.any(String) } })
  })

  it("should return the same success when the email is unknown or Supabase fails", async () => {
    auth.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null })
    const known = await forgotPasswordAction(form({ email: "known@example.com" }))

    vi.spyOn(console, "error").mockImplementation(() => {})
    auth.resetPasswordForEmail.mockResolvedValue({
      data: null,
      error: { message: SUPABASE_MESSAGE, status: 404 },
    })
    const unknown = await forgotPasswordAction(form({ email: "unknown@example.com" }))

    expect(unknown).toEqual(known)
  })

  // E09-S02, AC15 : le lien revient sur l'adresse d'où on le demande, lue par `getRequestOrigin()`.
  it.each([
    [{ "x-forwarded-host": "acme.cellule.test", "x-forwarded-proto": "https" }, "https://acme.cellule.test"],
    [{ host: "localhost:3000", "x-forwarded-proto": "http" }, "http://localhost:3000"],
  ])("should send a reset link back to the origin of the request (%j) (E09-S02, AC15)", async (values, origin) => {
    requestHeaders(values)
    auth.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null })

    await forgotPasswordAction(form({ email: "claire@acme.test" }))

    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith("claire@acme.test", { redirectTo: `${origin}/auth/callback?next=/reset-password` })
  })
})

describe("resetPasswordAction", () => {
  it("should redirect to /login without updating the password when there is no session", async () => {
    auth.getUser.mockResolvedValue({ data: { user: null }, error: null })

    await expect(
      resetPasswordAction(form({ password: "password123", confirmPassword: "password123" }))
    ).rejects.toThrow("NEXT_REDIRECT:/login")
    expect(auth.updateUser).not.toHaveBeenCalled()
  })
})

describe("connexionFournisseurAction (E09-S03)", () => {
  const PROVIDER_URL = "https://ref.supabase.test/auth/v1/authorize?provider=google&code_challenge=abc"
  const UNAVAILABLE = "Ce mode de connexion n'est pas disponible."
  const START_FAILED = "La connexion avec ce fournisseur n'a pas pu démarrer. Réessayez."

  it.each([
    [{ host: "localhost:3000", "x-forwarded-proto": "http" }, "http://localhost:3000"],
    [{ "x-forwarded-host": "acme.example.test", "x-forwarded-proto": "https" }, "https://acme.example.test"],
  ])("should start Google with a return to the origin of the request (%j) (AC2)", async (values, origin) => {
    requestHeaders(values)
    auth.signInWithOAuth.mockResolvedValue({ data: { provider: "google", url: PROVIDER_URL }, error: null })

    await expect(connexionFournisseurAction(null, form({ fournisseur: "google" }))).rejects.toThrow(
      `NEXT_REDIRECT:${PROVIDER_URL}`,
    )
    expect(auth.signInWithOAuth).toHaveBeenCalledTimes(1)
    expect(auth.signInWithOAuth.mock.calls[0][0]).toStrictEqual({
      provider: "google",
      options: { redirectTo: `${origin}/auth/callback` },
    })
    expect(redirect).toHaveBeenCalledWith(PROVIDER_URL)
  })

  it("should start Microsoft as the azure provider, with the email scope (AC3)", async () => {
    auth.signInWithOAuth.mockResolvedValue({ data: { provider: "azure", url: PROVIDER_URL }, error: null })

    await expect(connexionFournisseurAction(null, form({ fournisseur: "azure" }))).rejects.toThrow(
      `NEXT_REDIRECT:${PROVIDER_URL}`,
    )
    expect(auth.signInWithOAuth.mock.calls[0][0]).toStrictEqual({
      provider: "azure",
      options: { redirectTo: "https://acme.test/auth/callback", scopes: "email" },
    })
  })

  it.each<Record<string, string>>([{ fournisseur: "github" }, { fournisseur: "Google" }, {}])(
    "should refuse %j without calling Supabase (AC4)",
    async (fields) => {
      const result = await connexionFournisseurAction(null, form(fields))

      expect(result).toEqual({ error: UNAVAILABLE })
      expect(auth.signInWithOAuth).not.toHaveBeenCalled()
      expect(redirect).not.toHaveBeenCalled()
    },
  )

  it("should return a generic error, never the SDK message, when Supabase fails (AC4)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    auth.signInWithOAuth.mockResolvedValue({
      data: { provider: "google", url: null },
      error: { message: SUPABASE_MESSAGE, status: 500 },
    })

    const result = await connexionFournisseurAction(null, form({ fournisseur: "google" }))

    expect(result).toEqual({ error: START_FAILED })
    expect(JSON.stringify(result)).not.toContain(SUPABASE_MESSAGE)
    expect(redirect).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalled()
  })

  it("should return the same generic error when Supabase gives no URL (AC4)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    auth.signInWithOAuth.mockResolvedValue({ data: { provider: "google", url: null }, error: null })

    const result = await connexionFournisseurAction(null, form({ fournisseur: "google" }))

    expect(result).toEqual({ error: START_FAILED })
    expect(redirect).not.toHaveBeenCalled()
  })

  it("should not call Supabase when the request has no host", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    requestHeaders({})

    const result = await connexionFournisseurAction(null, form({ fournisseur: "google" }))

    expect(result).toEqual({ error: START_FAILED })
    expect(auth.signInWithOAuth).not.toHaveBeenCalled()
  })

  // AC7 : une seule lecture de l'origine, celle de `getRequestOrigin()`.
  it("should read no forwarded or host header itself (AC7)", () => {
    const source = readFileSync(path.resolve(__dirname, "../../../src/lib/actions/auth.ts"), "utf8")

    expect(source).not.toMatch(/x-forwarded|get\("host"\)/)
    expect(source).toMatch(/getRequestOrigin\(\)/)
  })
})

// Retour sur la page demandée avant la connexion (E02-S02, AC7 et AC8) : le consentement OAuth.
describe("way back after sign-in (E02-S02)", () => {
  const CONSENT = "/oauth/consent?authorization_id=abc123"
  const NEXT = "%2Foauth%2Fconsent%3Fauthorization_id%3Dabc123"
  const HOSTILES = ["https://evil.example", "//evil.example", "/\\evil.example", "/oauth consent", "/\t/evil.example", `/${"a".repeat(2048)}`]
  const PROVIDER_URL = "https://ref.supabase.test/auth/v1/authorize?provider=google&code_challenge=abc"

  it("should bring loginAction back to the requested page (AC7)", async () => {
    auth.signInWithPassword.mockResolvedValue({ data: {}, error: null })

    await expect(loginAction(form({ email: "user@example.com", password: "password123", redirect: CONSENT }))).rejects.toThrow(
      `NEXT_REDIRECT:${CONSENT}`,
    )
    expect(redirect).toHaveBeenCalledWith(CONSENT)
    // `redirect` est un champ de l'hôte : il ne part pas au SDK.
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: "user@example.com", password: "password123" })
  })

  it.each(HOSTILES)("should bring loginAction to / for the redirect %j (AC8)", async (hostile) => {
    auth.signInWithPassword.mockResolvedValue({ data: {}, error: null })

    await expect(loginAction(form({ email: "user@example.com", password: "password123", redirect: hostile }))).rejects.toThrow(
      /^NEXT_REDIRECT:\/$/,
    )
  })

  it("should start Google with a callback that brings back to the requested page (AC7)", async () => {
    auth.signInWithOAuth.mockResolvedValue({ data: { provider: "google", url: PROVIDER_URL }, error: null })

    await expect(connexionFournisseurAction(null, form({ fournisseur: "google", redirect: CONSENT }))).rejects.toThrow(
      `NEXT_REDIRECT:${PROVIDER_URL}`,
    )
    expect(auth.signInWithOAuth.mock.calls[0][0]).toStrictEqual({
      provider: "google",
      options: { redirectTo: `https://acme.test/auth/callback?next=${NEXT}` },
    })
  })

  it.each(HOSTILES)("should start Google without next for the redirect %j (AC8)", async (hostile) => {
    auth.signInWithOAuth.mockResolvedValue({ data: { provider: "google", url: PROVIDER_URL }, error: null })

    await expect(connexionFournisseurAction(null, form({ fournisseur: "google", redirect: hostile }))).rejects.toThrow("NEXT_REDIRECT")
    expect(auth.signInWithOAuth.mock.calls[0][0].options.redirectTo).toBe("https://acme.test/auth/callback")
  })

  it("should put the requested page in the next of the magic link (AC7)", async () => {
    auth.signInWithOtp.mockResolvedValue({ data: {}, error: null })

    await magicLinkAction(form({ email: "claire@acme.test", redirect: CONSENT }))

    expect(auth.signInWithOtp).toHaveBeenCalledWith({
      email: "claire@acme.test",
      options: { shouldCreateUser: true, emailRedirectTo: `https://acme.test/auth/confirm?next=${NEXT}` },
    })
  })

  it.each(HOSTILES)("should keep next=/ in the magic link for the redirect %j (AC8)", async (hostile) => {
    auth.signInWithOtp.mockResolvedValue({ data: {}, error: null })

    await magicLinkAction(form({ email: "claire@acme.test", redirect: hostile }))

    expect(auth.signInWithOtp.mock.calls[0][0].options.emailRedirectTo).toBe("https://acme.test/auth/confirm?next=/")
  })
})

// Derrière un proxy qui transmet `x-forwarded-host` tel quel, un lien demandé pour l'email d'autrui ne part que vers une
// adresse qui sert une organisation ou l'adresse commune du site, en https hors du poste local.
describe("links only to a trusted address", () => {
  const FORGED = { "x-forwarded-host": "evil.example.test", "x-forwarded-proto": "https", host: "acme.test" }

  it("should give the same answer to a magic link asked from an unknown host, without calling Supabase", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    requestHeaders(FORGED)

    await expect(magicLinkAction(form({ email: "victim@acme.test" }))).resolves.toEqual({ data: { message: MAGIC_LINK_MESSAGE } })
    expect(auth.signInWithOtp).not.toHaveBeenCalled()
    expect(String(log.mock.calls[0]?.[0])).toContain("evil.example.test")
  })

  it("should give the same answer to a reset asked from an unknown host, without calling Supabase", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    auth.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null })
    const known = await forgotPasswordAction(form({ email: "victim@acme.test" }))
    vi.clearAllMocks()
    requestHeaders(FORGED)

    await expect(forgotPasswordAction(form({ email: "victim@acme.test" }))).resolves.toEqual(known)
    expect(auth.resetPasswordForEmail).not.toHaveBeenCalled()
  })

  it("should not start a provider from an unknown host", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    requestHeaders(FORGED)

    await expect(connexionFournisseurAction(null, form({ fournisseur: "google" }))).resolves.toEqual({ error: "La connexion avec ce fournisseur n'a pas pu démarrer. Réessayez." })
    expect(auth.signInWithOAuth).not.toHaveBeenCalled()
  })

  it("should keep https for an organisation address when the proxy forwards http", async () => {
    requestHeaders({ "x-forwarded-host": "acme.test", "x-forwarded-proto": "http" })
    auth.signInWithOtp.mockResolvedValue({ data: {}, error: null })

    await magicLinkAction(form({ email: "claire@acme.test" }))

    expect(auth.signInWithOtp.mock.calls[0][0].options.emailRedirectTo).toBe("https://acme.test/auth/confirm?next=/")
  })

  it("should admit the common address of the site, which serves no organisation", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://oto.example.test")
    requestHeaders({ "x-forwarded-host": "oto.example.test", "x-forwarded-proto": "https" })
    auth.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null })

    await forgotPasswordAction(form({ email: "claire@acme.test" }))

    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith("claire@acme.test", { redirectTo: "https://oto.example.test/auth/callback?next=/reset-password" })
  })

  it("should refuse an unreadable NEXT_PUBLIC_SITE_URL instead of ignoring it", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "not an address")

    await expect(magicLinkAction(form({ email: "claire@acme.test" }))).rejects.toThrow("NEXT_PUBLIC_SITE_URL")
    expect(auth.signInWithOtp).not.toHaveBeenCalled()
  })
})

// Mode OIDC : on se connecte chez l'émetteur ; les actions propres à Supabase Auth ne tentent rien (HN-E01S11b-12).
describe("Supabase actions in OIDC mode", () => {
  beforeEach(() => {
    vi.stubEnv("PLATFORM_OIDC_ISSUER", "https://issuer.example.test/oidc")
  })

  it("should answer the magic link and the reset as usual, without calling Supabase nor reading the address", async () => {
    await expect(magicLinkAction(form({ email: "claire@acme.test" }))).resolves.toEqual({ data: { message: MAGIC_LINK_MESSAGE } })
    await expect(forgotPasswordAction(form({ email: "claire@acme.test" }))).resolves.toEqual({ data: { message: "Si un compte existe, un email vous a été envoyé." } })

    expect(auth.signInWithOtp).not.toHaveBeenCalled()
    expect(auth.resetPasswordForEmail).not.toHaveBeenCalled()
    expect(createAnonPlatformDb).not.toHaveBeenCalled()
  })

  it("should say a provider is not available, without calling Supabase", async () => {
    await expect(connexionFournisseurAction(null, form({ fournisseur: "google" }))).resolves.toEqual({ error: "Ce mode de connexion n'est pas disponible." })

    expect(auth.signInWithOAuth).not.toHaveBeenCalled()
    expect(redirect).not.toHaveBeenCalled()
  })
})
