// @vitest-environment node
// Middleware de session (E02-S02, AC7) : une page ouverte sans session y revient après la connexion,
// en GET seulement ; les cookies rafraîchis par `getUser()` suivent toute redirection
// (`auth-patterns.md § Middleware`). Le client Supabase est simulé.
import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CONSENT_PATH } from "@otomata_tech/oto_platform/server"
import { middleware } from "@/middleware"

type Cookie = { name: string; value: string; options: Record<string, unknown> }
type CookieMethods = { setAll: (cookies: Cookie[]) => void }

const session = vi.hoisted((): { user: { id: string } | null; refreshed: Cookie[] } => ({ user: null, refreshed: [] }))

// `getUser()` rafraîchit la session comme le client réel : il écrit les nouveaux cookies par `setAll`.
vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn((_url: string, _key: string, options: { cookies: CookieMethods }) => ({
    auth: {
      getUser: async () => {
        if (session.refreshed.length > 0) options.cookies.setAll(session.refreshed)
        return { data: { user: session.user }, error: null }
      },
    },
  })),
}))

const ORIGIN = "http://localhost:3000"

function requete(path: string, method = "GET"): NextRequest {
  return new NextRequest(`${ORIGIN}${path}`, { method })
}

beforeEach(() => {
  session.user = null
  session.refreshed = []
})

afterEach(() => {
  vi.clearAllMocks()
})

describe("middleware without a session (AC7)", () => {
  it("should send a GET of the consent page to /login with the way back", async () => {
    const response = await middleware(requete("/oauth/consent?authorization_id=abc123"))

    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toBe(`${ORIGIN}/login?redirect=%2Foauth%2Fconsent%3Fauthorization_id%3Dabc123`)
  })

  it("should keep the path alone when the page has no query", async () => {
    const response = await middleware(requete("/n/contexte"))

    expect(response.headers.get("location")).toBe(`${ORIGIN}/login?redirect=%2Fn%2Fcontexte`)
  })

  it("should send a GET of / to /login, without way back", async () => {
    const response = await middleware(requete("/"))

    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toBe(`${ORIGIN}/login`)
  })

  it("should keep the current redirect of a POST: /login, without way back", async () => {
    const response = await middleware(requete("/platform/invitations", "POST"))

    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toBe(`${ORIGIN}/login`)
  })

  it("should keep the query of a POST on /login, as before", async () => {
    const response = await middleware(requete("/platform/invitations?team=ventes", "POST"))

    expect(response.headers.get("location")).toBe(`${ORIGIN}/login?team=ventes`)
  })

  // Redirigé, le POST de la Server Action serait rejoué sur `/login`, qui rend `{}` : page d'erreur
  // générique (banc E03). Il passe, et l'action ramène elle-même à la connexion (HN-E02S02-27).
  // `CONSENT_PATH` du paquet : le chemin écrit dans le middleware ne peut pas s'en écarter sans bruit.
  it("should let the POST of a consent decision through, its action sending back to sign-in (AC18)", async () => {
    session.refreshed = [{ name: "sb-test-auth-token", value: "fresh", options: { path: "/" } }]

    const response = await middleware(requete(`${CONSENT_PATH}?authorization_id=abc123`, "POST"))

    expect(response.headers.get("location")).toBeNull()
    expect(response.headers.get("x-middleware-next")).toBe("1")
    expect(response.cookies.get("sb-test-auth-token")?.value).toBe("fresh")
  })

  it.each([
    "/login?redirect=%2Foauth%2Fconsent",
    "/auth/callback?code=abc",
    // E11-S07 (AC-a4) : le lien de l'email, sous son adresse anglaise.
    "/auth/confirm?token_hash=abc&type=email&next=/",
    "/api/mcp",
    "/.well-known/oauth-protected-resource/api/mcp",
    "/.well-known/oauth-protected-resource",
    // E11-S21 (AC-9) : l'image de partage de l'organisation, demandée par un robot d'aperçu sans session.
    "/opengraph-image?4b1a1d3c2e5f6a7b",
    // L'adresse d'un fichier (fichiers et stockage, § Adresse unique) : la porte du paquet la sert et vérifie la session.
    "/f/0c9e8d7f-6a5b-4c3d-8e2f-1a0b9c8d7e6f?disposition=inline",
  ])("should let the public route %s through", async (path) => {
    const response = await middleware(requete(path))

    expect(response.headers.get("location")).toBeNull()
    expect(response.headers.get("x-middleware-next")).toBe("1")
  })

  it("should copy the refreshed session cookies onto the redirect", async () => {
    session.refreshed = [{ name: "sb-test-auth-token", value: "fresh", options: { path: "/" } }]

    const response = await middleware(requete("/oauth/consent?authorization_id=abc123"))

    expect(response.headers.get("location")).toContain("/login?redirect=")
    expect(response.cookies.get("sb-test-auth-token")?.value).toBe("fresh")
  })
})

describe("middleware with a session", () => {
  beforeEach(() => {
    session.user = { id: "user-1" }
  })

  it("should send /login to /", async () => {
    const response = await middleware(requete("/login"))

    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toBe(`${ORIGIN}/`)
  })

  // Connectée dans un autre onglet, ou retour arrière sur `/login?redirect=…` : la demande n'est pas perdue.
  it("should send /login to the way back it carries", async () => {
    const response = await middleware(requete("/login?redirect=%2Foauth%2Fconsent%3Fauthorization_id%3Dabc123"))

    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toBe(`${ORIGIN}/oauth/consent?authorization_id=abc123`)
  })

  it("should send /login to a way back without query, without carrying the redirect along", async () => {
    const response = await middleware(requete("/login?redirect=%2Fn%2Fcontexte"))

    expect(response.headers.get("location")).toBe(`${ORIGIN}/n/contexte`)
  })

  it.each(["https://evil.example", "//evil.example", "/\\evil.example"])("should send /login with the unsafe way back %s to /", async (retour) => {
    const response = await middleware(requete(`/login?redirect=${encodeURIComponent(retour)}`))

    expect(response.headers.get("location")).toBe(`${ORIGIN}/`)
  })

  it("should let the consent page through, the refreshed cookies on the response", async () => {
    session.refreshed = [{ name: "sb-test-auth-token", value: "fresh", options: { path: "/" } }]

    const response = await middleware(requete("/oauth/consent?authorization_id=abc123"))

    expect(response.headers.get("location")).toBeNull()
    expect(response.cookies.get("sb-test-auth-token")?.value).toBe("fresh")
  })
})

// Sous `next start` derrière un proxy, `request.url` porte l'adresse d'écoute : la redirection prend
// l'adresse publique des en-têtes du proxy (deploiement.md d'oto-saas, § 8.3).
describe("middleware behind a proxy", () => {
  function derriere(path: string, headers: Record<string, string>): NextRequest {
    return new NextRequest(`https://localhost:3000${path}`, { headers })
  }

  it("should redirect to the forwarded host and protocol, never to the listening address", async () => {
    const response = await middleware(derriere("/n/contexte", { host: "localhost:3000", "x-forwarded-host": "acme.example.test", "x-forwarded-proto": "https" }))

    expect(response.headers.get("location")).toBe("https://acme.example.test/login?redirect=%2Fn%2Fcontexte")
  })

  it("should take the Host header when the proxy keeps it and sends no X-Forwarded-Host", async () => {
    session.user = { id: "user-1" }

    const response = await middleware(derriere("/login", { host: "acme.example.test", "x-forwarded-proto": "https" }))

    expect(response.headers.get("location")).toBe("https://acme.example.test/")
  })

  // L'origine de `linkOrigin` du paquet : `X-Forwarded-Proto`, qu'un proxy peut transmettre du client, n'est plus lu.
  it("should keep https off the local machine when the proxy forwards http", async () => {
    const response = await middleware(derriere("/n/contexte", { host: "localhost:3000", "x-forwarded-host": "acme.example.test:8443", "x-forwarded-proto": "http" }))

    expect(response.headers.get("location")).toBe("https://acme.example.test/login?redirect=%2Fn%2Fcontexte")
  })

  it("should keep http and the port on the local machine", async () => {
    const response = await middleware(new NextRequest("http://localhost:3000/n/contexte", { headers: { host: "demo.localhost:3000", "x-forwarded-proto": "https" } }))

    expect(response.headers.get("location")).toBe("http://demo.localhost:3000/login?redirect=%2Fn%2Fcontexte")
  })

  it.each(["evil.example.test/@acme.example.test", "evil.example.test\\x", "acme example"])("should not build the address on a forwarded host that is not a host name (%j)", async (forged) => {
    const response = await middleware(derriere("/n/contexte", { host: "localhost:3000", "x-forwarded-host": forged }))

    expect(response.headers.get("location")).toBe("https://localhost:3000/login?redirect=%2Fn%2Fcontexte")
  })
})
