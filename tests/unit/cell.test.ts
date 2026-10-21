// @vitest-environment node
// État de la cellule (E08-S04) sans base : présence des variables (AC10), et `GET /api/platform/cell` servi
// sans identité par l'adresse (AC12), `cellStatus` posé par le test. `cellStatus` lui-même (AC8, AC9, AC11 : la
// version du paquet, la base qui ne répond pas) tourne sur une base réelle depuis la partie e2 d'E01-S10
// (`tests/integration/cell-status.test.ts`) ; `applied_migrations` dans `tests/integration/role-plateforme.test.ts` ;
// un refus du service rendu avec son statut, par `tests/unit/api-handler.test.ts`.
import { beforeEach, describe, expect, it, vi } from "vitest"
import { handlePlateforme } from "@otomata_tech/oto_platform/api"
import pkg from "@otomata_tech/oto_platform/package.json"
import { PlatformError, type CellStatus } from "@otomata_tech/oto_platform/server"
import type { VerifyToken } from "../../packages/plateforme/mcp/auth"
import { cellStatus, envReport } from "../../packages/plateforme/server/cell"
import { resolveIdentity } from "../../packages/plateforme/server/identity"

// La porte construit son client avec `createPlatformDb` : ici, un client que seul `cellStatus`, posé par le
// test, reçoit ; le jeton est accepté par le vérificateur que reçoit la porte (M10).
vi.mock("../../packages/plateforme/server/db", () => ({
  createPlatformDb: vi.fn(() => ({})),
}))

vi.mock("../../packages/plateforme/server/cell", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../packages/plateforme/server/cell")>()),
  cellStatus: vi.fn(),
}))

vi.mock("../../packages/plateforme/server/identity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../packages/plateforme/server/identity")>()),
  resolveIdentity: vi.fn(),
}))

const WITNESSES = {
  NEXT_PUBLIC_SUPABASE_URL: "valeur-temoin-1",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "valeur-temoin-2",
  NEXT_PUBLIC_SITE_URL: "valeur-temoin-3",
}
const MIGRATIONS = [
  { version: "20260924100000", name: "platform_socle" },
  { version: "20260924110000", name: "platform_identite" },
]
const STATUS: CellStatus = {
  packageVersion: pkg.version,
  migrations: MIGRATIONS,
  health: { database: { ok: true, latencyMs: 3 }, env: envReport(WITNESSES), ok: true },
  checkedAt: "2026-09-26T12:00:00.000Z",
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("envReport (AC10)", () => {
  it("should say present or absent, an empty or blank value being absent, and carry no value", () => {
    const env = { NEXT_PUBLIC_SUPABASE_URL: "valeur-temoin-1", NEXT_PUBLIC_SUPABASE_ANON_KEY: "" }
    const report = envReport(env)
    expect(report).toEqual([
      { name: "NEXT_PUBLIC_SUPABASE_URL", present: true },
      { name: "NEXT_PUBLIC_SUPABASE_ANON_KEY", present: false },
      { name: "NEXT_PUBLIC_SITE_URL", present: false },
    ])
    expect(JSON.stringify(report)).not.toContain("valeur-temoin-1")
    expect(envReport({ ...WITNESSES, NEXT_PUBLIC_SITE_URL: "   " }).map((entry) => entry.present)).toEqual([true, true, false])
  })

  it("should check the issuer, the audience, the SMTP relay and the sender on an OIDC host, never the Supabase variables (M50)", () => {
    const env = { PLATFORM_OIDC_ISSUER: "https://issuer.example.test/oidc", PLATFORM_OIDC_AUDIENCE: "valeur-temoin-4", PLATFORM_SMTP_URL: " ", NEXT_PUBLIC_SITE_URL: "valeur-temoin-3" }
    expect(envReport(env)).toEqual([
      { name: "PLATFORM_OIDC_ISSUER", present: true },
      { name: "PLATFORM_OIDC_AUDIENCE", present: true },
      { name: "PLATFORM_SMTP_URL", present: false },
      { name: "PLATFORM_MAIL_FROM", present: false },
      { name: "NEXT_PUBLIC_SITE_URL", present: true },
    ])
  })
})

describe("GET /api/platform/cell (AC12)", () => {
  const NOWHERE = "nowhere.example.invalid"

  function request(method = "GET", path = "cell") {
    return new Request(`https://${NOWHERE}/api/platform/${path}`, {
      method,
      headers: { "x-forwarded-proto": "https", origin: `https://${NOWHERE}` },
    })
  }

  const verifyToken: VerifyToken = async () => ({ token: "token", clientId: "", scopes: [], extra: { sub: "user-s", email: "s@oto.test" } })

  async function call(req: Request, accessToken: string | null = "token") {
    const tasks: (() => Promise<void>)[] = []
    const response = await handlePlateforme(req, { accessToken, host: NOWHERE, defer: (task) => tasks.push(task), verifyToken })
    return { response, body: await response.json(), tasks }
  }

  it("should serve the status to the platform team without resolving the organisation of the address, nor journaling", async () => {
    vi.mocked(cellStatus).mockResolvedValue(STATUS)

    const { response, body, tasks } = await call(request())

    expect(response.status).toBe(200)
    expect(body.data).toMatchObject({ packageVersion: pkg.version, migrations: MIGRATIONS, health: { database: { ok: true } } })
    expect(resolveIdentity).not.toHaveBeenCalled()
    expect(tasks).toEqual([])
  })

  it("should answer 403 forbidden outside the platform team", async () => {
    vi.mocked(cellStatus).mockRejectedValue(new PlatformError("forbidden", "The cell status is reserved to the platform team."))
    const { response, body } = await call(request())
    expect(response.status).toBe(403)
    expect(body).toEqual({ error: { code: "forbidden", message: "The cell status is reserved to the platform team." } })
  })

  it("should answer 401 without a token, like the other resources", async () => {
    const { response, body } = await call(request(), null)
    expect(response.status).toBe(401)
    expect(body).toEqual({ error: { code: "forbidden", message: "Authentication required." } })
    expect(cellStatus).not.toHaveBeenCalled()
  })

  it("should know no other method nor any parameter on cell", async () => {
    expect((await call(request("POST"))).response.status).toBe(404)
    expect((await call(request("GET", "cell/migrations"))).response.status).toBe(404)
    expect(cellStatus).not.toHaveBeenCalled()
  })
})
