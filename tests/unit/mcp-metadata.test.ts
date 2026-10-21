// @vitest-environment node
// Métadonnées RFC 9728 des ressources protégées (E02-S02, AC1 à AC6), sans base : `findOrg` injecté,
// ou `resolveOrg` simulé derrière la route de l'hôte ; cohérence avec le 401 d'E03-S01, dont la vraie
// chaîne mcp-handler répond avant toute résolution d'organisation.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { GET, OPTIONS } from "@/app/.well-known/oauth-protected-resource/[[...chemin]]/route"
import { makeVerifyToken } from "../../packages/plateforme/mcp/auth"
import { handleMcpPost } from "../../packages/plateforme/mcp/handler"
import { handleResourceMetadata } from "../../packages/plateforme/mcp/metadata"
import { createAnonPlatformDb, createPlatformDb } from "../../packages/plateforme/server/db"
import { PlatformError } from "../../packages/plateforme/server/errors"
import { resolveOrg, type IdentityOrg } from "../../packages/plateforme/server/identity"

vi.mock("../../packages/plateforme/server/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../packages/plateforme/server/db")>()),
  createAnonPlatformDb: vi.fn(() => ({})),
  createPlatformDb: vi.fn(() => ({})),
}))

vi.mock("../../packages/plateforme/server/identity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../packages/plateforme/server/identity")>()),
  resolveOrg: vi.fn(),
  resolveIdentity: vi.fn(),
}))

const ISSUER = "https://project.example.test/auth/v1"
const ROOT = "/.well-known/oauth-protected-resource"
const ORG: IdentityOrg = { id: "org-1", slug: "acme", name: "Acme Énergies", prefix: "acm", brand: {}, domains: null }
const SERVED = new Set(["acme.example.test", "delta.example.test", "localhost"])

const findOrg = vi.fn(async (host: string) => (SERVED.has(host) ? { id: `org-of-${host}` } : null))

type RequestOptions = { host?: string; proto?: string; origin?: string }

/** Requête de lecture ; `host` et `proto` : en-têtes `x-forwarded-*` d'un proxy (Vercel). */
function lecture(path: string, { host, proto, origin = "http://localhost:3000" }: RequestOptions = {}): Request {
  const headers = new Headers({ host: new URL(origin).host })
  if (host) headers.set("x-forwarded-host", host)
  if (proto) headers.set("x-forwarded-proto", proto)
  return new Request(`${origin}${path}`, { headers })
}

const ACME = { host: "acme.example.test", proto: "https" }

function metadataOf(origin: string) {
  return {
    resource: `${origin}/api/mcp`,
    authorization_servers: [ISSUER],
    scopes_supported: ["openid", "email", "profile", "offline_access"],
    bearer_methods_supported: ["header"],
    resource_documentation: `${origin}/connect`,
  }
}

beforeEach(() => {
  // Barre oblique finale comprise : l'émetteur ne la garde pas (AC1).
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.example.test/")
})

afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe("GET the suffixed form /api/mcp (AC1)", () => {
  it("should describe the MCP of the called address, with CORS", async () => {
    const response = await handleResourceMetadata(lecture(`${ROOT}/api/mcp`, ACME), { findOrg })

    expect(response.status).toBe(200)
    expect(response.headers.get("access-control-allow-origin")).toBe("*")
    expect(await response.json()).toStrictEqual(metadataOf("https://acme.example.test"))
    expect(findOrg).toHaveBeenCalledWith("acme.example.test")
  })

  it("should describe each address with its own origin", async () => {
    const delta = await handleResourceMetadata(lecture(`${ROOT}/api/mcp`, { host: "delta.example.test", proto: "https" }), { findOrg })

    expect(await delta.json()).toStrictEqual(metadataOf("https://delta.example.test"))
  })

  it("should take the first element of forwarded lists", async () => {
    const request = lecture(`${ROOT}/api/mcp`, { host: "acme.example.test, proxy.internal", proto: "https, http" })

    const response = await handleResourceMetadata(request, { findOrg })

    expect(await response.json()).toStrictEqual(metadataOf("https://acme.example.test"))
    expect(findOrg).toHaveBeenCalledWith("acme.example.test")
  })
})

describe("GET the root and the admin resource (AC2)", () => {
  it("should serve the same body at the root", async () => {
    const response = await handleResourceMetadata(lecture(ROOT, ACME), { findOrg })

    expect(response.status).toBe(200)
    expect(await response.json()).toStrictEqual(metadataOf("https://acme.example.test"))
  })

  it("should describe /api/mcp-admin without resource_documentation", async () => {
    const response = await handleResourceMetadata(lecture(`${ROOT}/api/mcp-admin`, ACME), { findOrg })

    expect(response.status).toBe(200)
    expect(response.headers.get("access-control-allow-origin")).toBe("*")
    expect(await response.json()).toStrictEqual({
      resource: "https://acme.example.test/api/mcp-admin",
      authorization_servers: [ISSUER],
      scopes_supported: ["openid", "email", "profile", "offline_access"],
      bearer_methods_supported: ["header"],
    })
  })

  it("should serve /api/mcp-admin on an address without organisation, without reading org_domains", async () => {
    const response = await handleResourceMetadata(lecture(`${ROOT}/api/mcp-admin`, { origin: "http://127.0.0.1:3000" }), { findOrg })

    expect(response.status).toBe(200)
    expect((await response.json()).resource).toBe("http://127.0.0.1:3000/api/mcp-admin")
    expect(findOrg).not.toHaveBeenCalled()
  })
})

describe("origin of the request (AC3)", () => {
  it("should keep http://localhost:3000 and resolve the organisation of localhost, port dropped", async () => {
    const response = await handleResourceMetadata(lecture(`${ROOT}/api/mcp`), { findOrg })

    expect(response.status).toBe(200)
    expect(await response.json()).toStrictEqual(metadataOf("http://localhost:3000"))
    expect(findOrg).toHaveBeenCalledWith("localhost")
  })
})

describe("refusals (AC4)", () => {
  it.each([ROOT, `${ROOT}/api/mcp`])("should answer 404 unknown_org at %s for an address without organisation", async (path) => {
    const response = await handleResourceMetadata(lecture(path, { host: "unknown.example.test", proto: "https" }), { findOrg })

    expect(response.status).toBe(404)
    expect(response.headers.get("access-control-allow-origin")).toBe("*")
    expect(await response.json()).toStrictEqual({
      error: { code: "unknown_org", message: "No organisation is served at unknown.example.test." },
    })
  })

  it.each([`${ROOT}/api/other`, `${ROOT}/api/mcp/extra`])("should answer 404 not_found at %s, without reading org_domains", async (path) => {
    const response = await handleResourceMetadata(lecture(path, ACME), { findOrg })

    expect(response.status).toBe(404)
    expect(response.headers.get("access-control-allow-origin")).toBe("*")
    expect(await response.json()).toStrictEqual({ error: { code: "not_found", message: `No protected resource at ${path}.` } })
    expect(findOrg).not.toHaveBeenCalled()
  })

  it("should name the organisation of the address the host chooses, the resource staying the called address", async () => {
    const seen: string[] = []
    const known = async (host: string) => (seen.push(host), host === "acme.example.test" ? { id: "org-acme" } : null)
    const preview = { host: "preview-42.example.test", proto: "https" }

    expect((await handleResourceMetadata(lecture(`${ROOT}/api/mcp`, preview), { findOrg: known })).status).toBe(404)
    const response = await handleResourceMetadata(lecture(`${ROOT}/api/mcp`, preview), { findOrg: known, host: ({ host }) => (host?.startsWith("preview-") ? "Acme.Example.test" : host) })

    expect(response.status).toBe(200)
    expect(await response.json()).toStrictEqual(metadataOf("https://preview-42.example.test"))
    expect(seen).toEqual(["preview-42.example.test", "acme.example.test"])
  })

  it("should answer 404 when the host gives no address, and 503 when its choice throws", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    const none = await handleResourceMetadata(lecture(`${ROOT}/api/mcp`, ACME), { findOrg, host: () => null })
    expect(none.status).toBe(404)
    expect(await none.json()).toStrictEqual({ error: { code: "unknown_org", message: "No organisation is served at this address." } })
    const failed = await handleResourceMetadata(lecture(`${ROOT}/api/mcp`, ACME), { findOrg, host: () => Promise.reject(new Error("erp down")) })
    expect(failed.status).toBe(503)
    expect(log).toHaveBeenCalled()
  })

  it("should answer 503 internal when the resolution throws, the cause in the server log only", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    const cause = new Error("fetch failed: db.internal:5432")

    const response = await handleResourceMetadata(lecture(`${ROOT}/api/mcp`, ACME), { findOrg: async () => Promise.reject(cause) })

    expect(response.status).toBe(503)
    expect(response.headers.get("access-control-allow-origin")).toBe("*")
    const body = await response.json()
    expect(body).toStrictEqual({ error: { code: "internal", message: "Service unavailable. Retry in a moment." } })
    expect(log).toHaveBeenCalledWith(expect.any(String), cause)
  })

  it("should answer 503 internal when the project URL is missing, read at call time", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "")

    const response = await handleResourceMetadata(lecture(`${ROOT}/api/mcp`, ACME), { findOrg })

    expect(response.status).toBe(503)
    expect((await response.json()).error.code).toBe("internal")
    expect(log).toHaveBeenCalled()
  })
})

describe("authorization server of an OIDC host (E01-S11, AC-a9)", () => {
  it("should announce PLATFORM_OIDC_ISSUER, and nothing of the Supabase project", async () => {
    vi.stubEnv("PLATFORM_OIDC_ISSUER", "https://issuer.example.test/oidc")
    vi.stubEnv("PLATFORM_OIDC_AUDIENCE", "https://acme.example.test/api/mcp")

    const response = await handleResourceMetadata(lecture(`${ROOT}/api/mcp`, ACME), { findOrg })

    expect(response.status).toBe(200)
    expect(await response.json()).toStrictEqual({ ...metadataOf("https://acme.example.test"), authorization_servers: ["https://issuer.example.test/oidc"] })
  })
})

describe("host route /.well-known/oauth-protected-resource/[[...chemin]]", () => {
  it("should resolve the organisation by org_by_host, anonymously (AC1)", async () => {
    vi.mocked(resolveOrg).mockResolvedValue(ORG)

    const response = await GET(lecture(`${ROOT}/api/mcp`, ACME))

    expect(response.status).toBe(200)
    expect(await response.json()).toStrictEqual(metadataOf("https://acme.example.test"))
    expect(vi.mocked(resolveOrg).mock.calls[0][1]).toBe("acme.example.test")
    // Sans session : le client anonyme, limité à `org_by_host`, jamais celui d'une personne.
    expect(createAnonPlatformDb).toHaveBeenCalled()
    expect(vi.mocked(resolveOrg).mock.calls[0][0]).toBe(vi.mocked(createAnonPlatformDb).mock.results[0].value)
    expect(createPlatformDb).not.toHaveBeenCalled()
  })

  it("should answer 404 unknown_org when org_by_host finds nothing (AC4)", async () => {
    vi.mocked(resolveOrg).mockRejectedValue(new PlatformError("unknown_org", "No organisation is served at acme.example.test."))

    const response = await GET(lecture(ROOT, ACME))

    expect(response.status).toBe(404)
    expect((await response.json()).error.code).toBe("unknown_org")
  })

  it("should answer 503 when org_by_host fails (AC4)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    vi.mocked(resolveOrg).mockRejectedValue(new PlatformError("internal", "Internal error."))

    const response = await GET(lecture(ROOT, ACME))

    expect(response.status).toBe(503)
  })

  it("should answer the CORS preflight on OPTIONS (AC5)", async () => {
    const response = OPTIONS()

    expect(response.status).toBe(200)
    expect(response.headers.get("access-control-allow-origin")).toBe("*")
    expect(response.headers.get("access-control-allow-methods")).toBe("GET, OPTIONS")
  })
})

describe("coherence with the 401 of POST /api/mcp (AC6)", () => {
  it("should serve, at the address named by resource_metadata, the resource of the MCP", async () => {
    const post = new Request("http://localhost:3000/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "x-forwarded-host": "acme.example.test",
        "x-forwarded-proto": "https",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    })
    const refused = await handleMcpPost(post, { verifyToken: makeVerifyToken({ issuer: ISSUER }), defer: () => {} })
    expect(refused.status).toBe(401)
    const url = /resource_metadata="([^"]+)"/.exec(refused.headers.get("www-authenticate") ?? "")?.[1] ?? ""

    const metadata = new URL(url)
    const response = await handleResourceMetadata(lecture(metadata.pathname, ACME), { findOrg })

    expect(metadata.pathname).toBe(`${ROOT}/api/mcp`)
    expect(metadata.origin).toBe("https://acme.example.test")
    expect(response.status).toBe(200)
    expect((await response.json()).resource).toBe("https://acme.example.test/api/mcp")
  })
})
