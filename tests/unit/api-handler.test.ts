// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"
import { handlePlateforme } from "@otomata_tech/oto_platform/api"
import { PLATFORM_API_PREFIX } from "@otomata_tech/oto_platform/schemas"
import { PlatformError, type Identity } from "@otomata_tech/oto_platform/server"
import type { VerifyToken } from "../../packages/plateforme/mcp/auth"
import { resolveIdentity } from "../../packages/plateforme/server/identity"
import { inviteMember, listInvitations, revokeInvitation } from "../../packages/plateforme/server/invitations"

// La porte seule, sans base : identité et services simulés, un client dont aucune face n'est lue. La
// ligne de journal d'une mutation (AC21) s'écrit sur une vraie base, dans une suite portable :
// `tests/integration/api-handler.test.ts` (E01-S10, partie e1a) ; `api-invitations.test.ts` la relit
// sur le vrai projet.

const db = vi.hoisted(() => ({
  tx: vi.fn(),
}))

vi.mock("../../packages/plateforme/server/db", () => ({
  createPlatformDb: vi.fn(() => ({ tx: db.tx })),
}))

// Le vérificateur injecté (M10) : il accepte le jeton de user-1, sauf quand un test le fait refuser.
const verifyToken = vi.fn<VerifyToken>()

vi.mock("../../packages/plateforme/server/identity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../packages/plateforme/server/identity")>()),
  resolveIdentity: vi.fn(),
}))

vi.mock("../../packages/plateforme/server/invitations", () => ({
  inviteMember: vi.fn(),
  listInvitations: vi.fn(),
  revokeInvitation: vi.fn(),
}))

const HOST = "acme.test"
const ORIGIN = `https://${HOST}`
const IDENTITY: Identity = {
  org: { id: "org-1", slug: "acme", name: "Acme", prefix: "acme", brand: {}, domains: null },
  user: { id: "user-1", email: "admin@acme.test", name: "admin" },
  member: { role: "admin", profile: {} },
  teams: [],
  isStaff: false,
  viaGrant: false,
  hasOpenGrant: false,
}
const INVITATION_ID = "5b0d1c56-0f3a-4a57-9d8e-6f1f1b9e2c11"
const TEAM_ID = "0e8e5a3c-7f10-4a5b-8d3b-2b1c4d5e6f70"

type Task = () => Promise<void>

function request(method: string, path: string, init: { body?: string; headers?: Record<string, string> } = {}) {
  return new Request(`https://${HOST}/api/platform/${path}`, {
    method,
    body: init.body,
    headers: { "x-forwarded-proto": "https", origin: ORIGIN, "user-agent": "api-test", ...init.headers },
  })
}

async function call(req: Request, accessToken: string | null = "token") {
  const tasks: Task[] = []
  const response = await handlePlateforme(req, { accessToken, host: HOST, defer: (task) => tasks.push(task), verifyToken })
  return { response, body: await response.json(), tasks }
}

beforeEach(() => {
  vi.clearAllMocks()
  verifyToken.mockResolvedValue({ token: "token", clientId: "", scopes: [], extra: { sub: "user-1", email: "admin@acme.test" } })
  vi.mocked(resolveIdentity).mockResolvedValue(IDENTITY)
})

describe("handlePlateforme gate", () => {
  it("should answer 401 forbidden without a token", async () => {
    const { response, body } = await call(request("GET", "invitations"), null)
    expect(response.status).toBe(401)
    expect(body).toEqual({ error: { code: "forbidden", message: "Authentication required." } })
  })

  it("should answer 401 when the token does not verify", async () => {
    verifyToken.mockResolvedValue(undefined)
    const { response, body } = await call(request("GET", "invitations"))
    expect(response.status).toBe(401)
    expect(body.error.code).toBe("forbidden")
  })

  it("should refuse a mutation from another origin with 403", async () => {
    const { response, body } = await call(request("POST", "invitations", { body: "{}", headers: { origin: "https://evil.test" } }))
    expect(response.status).toBe(403)
    expect(body).toEqual({ error: { code: "forbidden", message: "Cross-origin request refused." } })
    expect(inviteMember).not.toHaveBeenCalled()
  })

  it("should refuse a mutation without an Origin header", async () => {
    const req = new Request(`https://${HOST}/api/platform/invitations/${INVITATION_ID}`, { method: "DELETE" })
    const { response } = await call(req)
    expect(response.status).toBe(403)
  })

  it("should answer 404 not_found for an unknown route", async () => {
    const unknown = await call(request("GET", "nowhere"))
    expect(unknown.response.status).toBe(404)
    expect(unknown.body.error.code).toBe("not_found")
    const tooDeep = await call(request("GET", "invitations/a/b"))
    expect(tooDeep.response.status).toBe(404)
  })

  it("should answer 404 not_found under the former French prefix, reading nothing (E11-S07, AC-a3)", async () => {
    const ancien = PLATFORM_API_PREFIX.replace("platform", "plateforme")
    const { response, body } = await call(new Request(`https://${HOST}${ancien}invitations`, { headers: { origin: ORIGIN } }))
    expect(response.status).toBe(404)
    expect(body.error.code).toBe("not_found")
    expect(listInvitations).not.toHaveBeenCalled()
  })

  it("should answer 400 invalid_arguments for a body that is not JSON", async () => {
    const { response, body } = await call(request("POST", "invitations", { body: "email=a@x.test" }))
    expect(response.status).toBe(400)
    expect(body.error.code).toBe("invalid_arguments")
  })

  it("should answer 404 for unknown_org and 403 for not_member", async () => {
    vi.mocked(resolveIdentity).mockRejectedValueOnce(new PlatformError("unknown_org", "No organisation is served at acme.test."))
    expect((await call(request("GET", "invitations"))).response.status).toBe(404)
    vi.mocked(resolveIdentity).mockRejectedValueOnce(new PlatformError("not_member", "Not a member."))
    const notMember = await call(request("GET", "invitations"))
    expect(notMember.response.status).toBe(403)
    expect(notMember.body.error.code).toBe("not_member")
  })

  it("should render a service refusal with its status and details", async () => {
    vi.mocked(inviteMember).mockRejectedValue(
      new PlatformError("forbidden", "Only an administrator can invite an administrator.", { reason: "admin_role_reserved" }),
    )
    const { response, body } = await call(request("POST", "invitations", { body: JSON.stringify({ email: "a@x.test", role: "admin" }) }))
    expect(response.status).toBe(403)
    expect(body).toEqual({
      error: {
        code: "forbidden",
        message: "Only an administrator can invite an administrator.",
        details: { reason: "admin_role_reserved" },
      },
    })
  })

  it("should hide an unexpected failure behind a generic 500", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    vi.mocked(listInvitations).mockRejectedValue(new Error("relation platform.secret_table does not exist"))
    const { response, body } = await call(request("GET", "invitations"))
    expect(response.status).toBe(500)
    expect(body).toEqual({ error: { code: "internal", message: "Internal error." } })
  })
})

describe("handlePlateforme routes", () => {
  it("should list invitations with 200 and pass the state", async () => {
    vi.mocked(listInvitations).mockResolvedValue([])
    const { response, body } = await call(request("GET", "invitations?state=all"))
    expect(response.status).toBe(200)
    expect(body).toEqual({ data: { invitations: [] } })
    expect(listInvitations).toHaveBeenCalledWith(expect.anything(), IDENTITY, { state: "all" })
  })

  it("should invite with 201 and a return link to the calling address", async () => {
    const created = {
      invitation: { id: INVITATION_ID, email: "a@x.test", role: "member" as const, teamId: TEAM_ID, expiresAt: "2026-10-01T00:00:00Z" },
      emailed: true as const,
    }
    vi.mocked(inviteMember).mockResolvedValue(created)
    const { response, body } = await call(request("POST", "invitations", { body: JSON.stringify({ email: "a@x.test" }) }))
    expect(response.status).toBe(201)
    expect(body).toEqual({ data: created })
    expect(inviteMember).toHaveBeenCalledWith(expect.anything(), IDENTITY, { email: "a@x.test" }, {
      redirectTo: `${ORIGIN}/auth/confirm?next=/`,
    })
  })

  // Le lien de l'email part de l'hôte qui a résolu l'identité, en https hors du poste local : un `x-forwarded-proto`
  // transmis du client ne l'abaisse pas ; le contrôle d'`Origin`, lui, compare toujours l'origine appelée.
  it("should keep the invitation link in https when the proxy forwards http", async () => {
    vi.mocked(inviteMember).mockResolvedValue({
      invitation: { id: INVITATION_ID, email: "a@x.test", role: "member" as const, teamId: null, expiresAt: "2026-10-01T00:00:00Z" },
      emailed: true as const,
    })
    const req = request("POST", "invitations", { body: JSON.stringify({ email: "a@x.test" }), headers: { "x-forwarded-proto": "http", origin: `http://${HOST}` } })

    const { response } = await call(req)

    expect(response.status).toBe(201)
    expect(vi.mocked(inviteMember).mock.calls[0][3]).toEqual({ redirectTo: `${ORIGIN}/auth/confirm?next=/` })
  })

  it("should revoke with 200", async () => {
    vi.mocked(revokeInvitation).mockResolvedValue({ id: INVITATION_ID, state: "revoked", teamId: null })
    const { response, body } = await call(request("DELETE", `invitations/${INVITATION_ID}`))
    expect(response.status).toBe(200)
    expect(body).toEqual({ data: { invitation: { id: INVITATION_ID, state: "revoked", teamId: null } } })
  })
})

describe("handlePlateforme journal (AC21)", () => {
  it("should write no line for a GET", async () => {
    vi.mocked(listInvitations).mockResolvedValue([])
    const { tasks } = await call(request("GET", "invitations"))
    expect(tasks).toHaveLength(0)
    expect(db.tx).not.toHaveBeenCalled()
  })
})

describe("handlePlateforme brand (E09-S01, AC7, AC9, AC11)", () => {
  it("should know no other method on brand", async () => {
    expect((await call(request("GET", "brand"))).response.status).toBe(404)
    expect((await call(request("POST", "brand", { body: "{}" }))).response.status).toBe(404)
  })
})
