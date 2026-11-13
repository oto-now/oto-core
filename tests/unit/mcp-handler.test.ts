// @vitest-environment node
// Porte HTTP du MCP sans base (E03-S01, AC2 et AC3) : le 401 passe avant toute résolution
// d'organisation, avec la vraie chaîne mcp-handler (`withMcpAuth`) et une JWKS locale.
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from "jose"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { makeVerifyToken } from "../../packages/plateforme/mcp/auth"
import { handleMcpPost, mcpMethodNotAllowed } from "../../packages/plateforme/mcp/handler"
import { registerHostSurface } from "../../packages/plateforme/server/catalog/surface"
import { PlatformError } from "../../packages/plateforme/server/errors"
import { resolveIdentity, resolveOrg, type ServedHost } from "../../packages/plateforme/server/identity"

// La base n'est jamais atteinte : client factice, identité simulée.
vi.mock("../../packages/plateforme/server/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../packages/plateforme/server/db")>()),
  createPlatformDb: vi.fn(() => ({})),
}))

vi.mock("../../packages/plateforme/server/identity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../packages/plateforme/server/identity")>()),
  resolveIdentity: vi.fn(),
  resolveOrg: vi.fn(),
}))

afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

const ISSUER = "https://project.example.test/auth/v1"
const INITIALIZE = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-ai", version: "0.1.0" } },
}

let signingKey: CryptoKey
let otherKey: CryptoKey
let jwks: JWTVerifyGetKey

beforeAll(async () => {
  const signing = await generateKeyPair("ES256")
  signingKey = signing.privateKey
  otherKey = (await generateKeyPair("ES256")).privateKey
  jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(signing.publicKey)), kid: "k1", alg: "ES256", use: "sig" }] })
})

const now = () => Math.floor(Date.now() / 1000)

type TokenOptions = { key?: CryptoKey; issuer?: string; exp?: number; sub?: string | null }

/** Jeton de test ; la clé, l'émetteur, l'expiration et le `sub` (null : absent) varient. */
function token({ key = signingKey, issuer = ISSUER, exp = now() + 3600, sub = "user-1" }: TokenOptions = {}) {
  const jwt = new SignJWT({ email: "claire@example.test" })
    .setProtectedHeader({ alg: "ES256", kid: "k1" })
    .setIssuer(issuer)
    .setIssuedAt(now() - 60)
    .setExpirationTime(exp)
  if (sub !== null) jwt.setSubject(sub)
  return jwt.sign(key)
}

function post({ bearer, forwarded = true, body = JSON.stringify(INITIALIZE) }: { bearer?: string; forwarded?: boolean; body?: string } = {}) {
  const headers = new Headers({ "content-type": "application/json", accept: "application/json, text/event-stream" })
  if (forwarded) {
    headers.set("x-forwarded-host", "acme.example.test")
    headers.set("x-forwarded-proto", "https")
  }
  if (bearer) headers.set("authorization", `Bearer ${bearer}`)
  return new Request("http://localhost:3000/api/mcp", { method: "POST", headers, body })
}

async function call(request: Request, host?: ServedHost) {
  const tasks: (() => Promise<void>)[] = []
  const response = await handleMcpPost(request, {
    verifyToken: makeVerifyToken({ jwks, issuer: ISSUER }),
    defer: (task) => tasks.push(task),
    host,
  })
  return { response, tasks }
}

const WWW_AUTHENTICATE = (origin: string) =>
  `Bearer error="invalid_token", error_description="No authorization provided", resource_metadata="${origin}/.well-known/oauth-protected-resource/api/mcp"`

describe("POST /api/mcp without a valid token (AC2)", () => {
  // Chaque refus d'un jeton est prouvé dans `mcp-auth.test.ts` ; ici, la réponse de la porte (M11).
  it.each([
    ["no Authorization header", async () => undefined],
    ["a token signed by another key", () => token({ key: otherKey })],
  ])("should answer 401 with WWW-Authenticate for %s, and journal nothing", async (_case, make) => {
    const { response, tasks } = await call(post({ bearer: await make() }))
    expect(response.status).toBe(401)
    expect(response.headers.get("www-authenticate")).toBe(WWW_AUTHENTICATE("https://acme.example.test"))
    expect(tasks).toEqual([])
    expect(resolveIdentity).not.toHaveBeenCalled()
  })

  it("should take the origin from the request URL without x-forwarded-host", async () => {
    const { response } = await call(post({ forwarded: false }))
    expect(response.status).toBe(401)
    expect(response.headers.get("www-authenticate")).toBe(WWW_AUTHENTICATE("http://localhost:3000"))
  })

  it("should refuse an unreadable body with a valid token before any resolution", async () => {
    const { response, tasks } = await call(post({ bearer: await token(), body: "{not json" }))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null })
    expect(tasks).toEqual([])
    expect(resolveIdentity).not.toHaveBeenCalled()
  })
})

describe("organisation of the called address (AC4)", () => {
  it("should answer 404 -32001 for an address without organisation, and journal nothing", async () => {
    vi.mocked(resolveIdentity).mockRejectedValue(new PlatformError("unknown_org", "No organisation is served at acme.example.test."))
    const { response, tasks } = await call(post({ bearer: await token() }))
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      jsonrpc: "2.0",
      error: { code: -32001, message: "No organisation is served at acme.example.test." },
      id: null,
    })
    expect(tasks).toEqual([])
    expect(vi.mocked(resolveIdentity).mock.calls[0][1]).toBe("acme.example.test")
  })

  it("should answer 503 -32603 when the resolution fails unexpectedly", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    vi.mocked(resolveIdentity).mockRejectedValue(new Error("fetch failed"))
    const { response, tasks } = await call(post({ bearer: await token() }))
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      jsonrpc: "2.0",
      error: { code: -32603, message: "Service unavailable. Retry in a moment." },
      id: null,
    })
    expect(tasks).toEqual([])
    expect(log).toHaveBeenCalled()
  })
})

// L'adresse choisie par l'hôte (previews, ERP sur un seul domaine) : seule la source de l'adresse change.
describe("organisation of the address the host chooses", () => {
  const UNKNOWN = new PlatformError("unknown_org", "No organisation is served at this address.")

  it("should resolve the address the host gives, normalised, from the called address and the request", async () => {
    vi.mocked(resolveIdentity).mockRejectedValue(UNKNOWN)
    const host = vi.fn<ServedHost>(() => "Staging.Example.test:443")
    const request = post({ bearer: await token() })
    await call(request, host)
    expect(vi.mocked(resolveIdentity).mock.calls[0][1]).toBe("staging.example.test")
    expect(host).toHaveBeenCalledTimes(1)
    expect(host.mock.calls[0][0].host).toBe("acme.example.test")
    expect(host.mock.calls[0][0].request).toBeInstanceOf(Request)
  })

  it("should answer 404 when the host gives no address, after the token", async () => {
    vi.mocked(resolveIdentity).mockRejectedValue(UNKNOWN)
    const { response, tasks } = await call(post({ bearer: await token() }), async () => null)
    expect(response.status).toBe(404)
    expect(vi.mocked(resolveIdentity).mock.calls[0][1]).toBeNull()
    expect(tasks).toEqual([])
  })

  it("should not ask the host for an address without a valid token, the 401 naming the called origin", async () => {
    const host = vi.fn<ServedHost>(() => "staging.example.test")
    const { response } = await call(post(), host)
    expect(response.status).toBe(401)
    expect(response.headers.get("www-authenticate")).toBe(WWW_AUTHENTICATE("https://acme.example.test"))
    expect(host).not.toHaveBeenCalled()
  })

  it("should answer 503 when the host's choice throws, and serve no organisation by default", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    const { response, tasks } = await call(post({ bearer: await token() }), () => Promise.reject(new Error("erp down")))
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ jsonrpc: "2.0", error: { code: -32603, message: "Service unavailable. Retry in a moment." }, id: null })
    expect(resolveIdentity).not.toHaveBeenCalled()
    expect(tasks).toEqual([])
    expect(log).toHaveBeenCalled()
  })

  // L'entrée sans invitation au plafond de membres : servi comme un non-membre, le refus dit la limite, jamais un 503.
  it("should serve the member limit of an entry without invitation as a refusal, not as an outage", async () => {
    vi.mocked(resolveIdentity).mockRejectedValue(new PlatformError("forbidden", "Acme is limited to 3 members, pending invitations included.", { reason: "limit", limit: "members_max", max: 3 }))
    vi.mocked(resolveOrg).mockResolvedValue({ id: "org-1", slug: "acme", name: "Acme", prefix: "acme", brand: null, domains: null } as never)
    const { response, tasks } = await call(post({ bearer: await token() }))
    expect(response.status).toBe(200)
    expect(tasks).toEqual([])
  })

  // Le widget tient par les ressources MCP : fermées par l'hôte (`registerHostSurface`), il n'est plus annoncé.
  it("should announce the resources of the widget only to a host that serves them", async () => {
    vi.mocked(resolveIdentity).mockRejectedValue(new PlatformError("not_member", "claire@example.test is not a member of Acme."))
    vi.mocked(resolveOrg).mockResolvedValue({ id: "org-1", slug: "acme", name: "Acme", prefix: "acme", brand: null, domains: null } as never)
    const announced = async () => {
      const response = await handleMcpPost(post({ bearer: await token() }), { verifyToken: makeVerifyToken({ jwks, issuer: ISSUER }), defer: () => undefined, widgets: true })
      // La réponse d'`initialize` part en flux d'événements : la ligne `data:` porte le message JSON-RPC.
      const data = (await response.text()).split("\n").find((line) => line.startsWith("data: ")) ?? "data: {}"
      const answer: { result?: { capabilities?: Record<string, unknown> } } = JSON.parse(data.slice("data: ".length))
      return Object.keys(answer.result?.capabilities ?? {}).sort()
    }
    try {
      expect(await announced()).toEqual(["prompts", "resources", "tools"])
      registerHostSurface({ functions: [], capabilities: ["prompts"], fetchCallerUrls: true })
      expect(await announced()).toEqual(["prompts", "tools"])
    } finally {
      registerHostSurface(null)
    }
  })

  it("should still refuse a caller who is not a member of the organisation of the chosen address", async () => {
    vi.mocked(resolveIdentity).mockRejectedValue(new PlatformError("not_member", "claire@example.test is not a member of Staging."))
    vi.mocked(resolveOrg).mockResolvedValue({ id: "org-1", slug: "staging", name: "Staging", prefix: "staging", brand: null, domains: null } as never)
    const { response, tasks } = await call(post({ bearer: await token() }), () => "staging.example.test")
    // Servi sans droit : aucun journal, et l'organisation relue à l'adresse choisie.
    expect(response.status).toBe(200)
    expect(vi.mocked(resolveOrg).mock.calls[0][1]).toBe("staging.example.test")
    expect(tasks).toEqual([])
  })
})

describe("GET and DELETE /api/mcp (AC3)", () => {
  it("should answer 405 with Allow: POST and an empty body", async () => {
    const response = mcpMethodNotAllowed()
    expect(response.status).toBe(405)
    expect(response.headers.get("allow")).toBe("POST")
    expect(await response.text()).toBe("")
  })
})
