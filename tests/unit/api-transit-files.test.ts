// @vitest-environment node
// La ressource `transit-files` de la porte (fichiers et stockage, § Fichier en transit), sans base : identité et service
// simulés. La demande (201) et la confirmation (200), chacune avec sa ligne de journal ; aucune lecture ici, un fichier en
// transit se lisant à son adresse, `/f/<id>` (`api-files.test.ts`) ; aucun
// nom de fichier au journal de l'organisation, ni par le corps, ni par la réponse, ni par le message d'un refus (décision
// du 19/10). Les décisions du service, sur une vraie base : `tests/integration/fichiers-en-transit.test.ts`.
import { beforeEach, describe, expect, it, vi } from "vitest"
import { handlePlateforme } from "@otomata_tech/oto_platform/api"
import { PlatformError, type Identity } from "@otomata_tech/oto_platform/server"
import type { VerifyToken } from "../../packages/plateforme/mcp/auth"
import { completeTransitUpload, requestTransitUpload } from "../../packages/plateforme/server/files/transit"
import { resolveIdentity } from "../../packages/plateforme/server/identity"
import { writeJournal } from "../../packages/plateforme/server/journal"

vi.mock("../../packages/plateforme/server/db", () => ({ createPlatformDb: vi.fn(() => ({ tx: vi.fn() })) }))

vi.mock("../../packages/plateforme/server/identity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../packages/plateforme/server/identity")>()),
  resolveIdentity: vi.fn(),
}))

vi.mock("../../packages/plateforme/server/journal", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../packages/plateforme/server/journal")>()),
  writeJournal: vi.fn(),
}))

vi.mock("../../packages/plateforme/server/files/transit", () => ({
  completeTransitUpload: vi.fn(),
  requestTransitUpload: vi.fn(),
}))

const HOST = "acme.test"
const ORIGIN = `https://${HOST}`
const FILE_ID = "0c9e8d7f-6a5b-4c3d-8e2f-1a0b9c8d7e6f"
const EXPIRES_AT = "2026-10-19T10:00:00+00:00"
const IDENTITY: Identity = {
  org: { id: "org-1", slug: "acme", name: "Acme", prefix: "acme", brand: {}, domains: null },
  user: { id: "user-1", email: "lea@acme.test", name: "Léa" },
  member: { role: "member", profile: {} },
  teams: [],
  isStaff: false,
  viaGrant: false,
  hasOpenGrant: false,
}

const verifyToken = vi.fn<VerifyToken>()

type Task = () => Promise<void>

function request(method: string, path: string, body?: string) {
  return new Request(`${ORIGIN}/api/platform/${path}`, { method, body, headers: { "x-forwarded-proto": "https", origin: ORIGIN } })
}

async function call(req: Request, accessToken: string | null = "token") {
  const tasks: Task[] = []
  const response = await handlePlateforme(req, { accessToken, host: HOST, defer: (task) => tasks.push(task), verifyToken })
  return { response, tasks }
}

beforeEach(() => {
  vi.clearAllMocks()
  verifyToken.mockResolvedValue({ token: "token", clientId: "", scopes: [], extra: { sub: "user-1", email: "lea@acme.test" } })
  vi.mocked(resolveIdentity).mockResolvedValue(IDENTITY)
})

describe("transit-files resource of the gate", () => {
  it("should answer 201 to an upload request and 200 to its confirmation, each with its journal line", async () => {
    const upload = { id: FILE_ID, upload: { url: "https://s3.test/u", headers: { "content-type": "application/pdf" } }, expiresAt: EXPIRES_AT }
    const ready = { id: FILE_ID, name: "r.pdf", size: 3, mime: "application/pdf", expiresAt: EXPIRES_AT }
    vi.mocked(requestTransitUpload).mockResolvedValue(upload)
    vi.mocked(completeTransitUpload).mockResolvedValue(ready)
    const body = { name: "r.pdf", mime: "application/pdf", size: 3 }
    const requested = await call(request("POST", "transit-files", JSON.stringify(body)))
    const completed = await call(request("POST", `transit-files/${FILE_ID}/complete`, "{}"))
    expect([
      { status: requested.response.status, body: await requested.response.json(), journal: requested.tasks.length },
      { status: completed.response.status, body: await completed.response.json(), journal: completed.tasks.length },
    ]).toEqual([
      { status: 201, body: { data: upload }, journal: 1 },
      { status: 200, body: { data: { ...ready, url: `/f/${FILE_ID}` } }, journal: 1 },
    ])
    expect(requestTransitUpload).toHaveBeenCalledWith(expect.anything(), IDENTITY, body)
    expect(completeTransitUpload).toHaveBeenCalledWith(expect.anything(), IDENTITY, FILE_ID)
  })

  it("should not serve GET transit-files/<id>: a file in transit is read at its address, /f/<id>", async () => {
    const { response } = await call(request("GET", `transit-files/${FILE_ID}`))
    expect({ status: response.status, body: await response.json() }).toEqual({ status: 404, body: { error: { code: "not_found", message: "Unknown route." } } })
  })

  it("should journal only the id, the size and the MIME type, never the file name, served or refused", async () => {
    const name = "bilan-confidentiel.csv"
    const body = { name, mime: "text/csv", size: 6_000_000 }
    vi.mocked(requestTransitUpload)
      .mockResolvedValueOnce({ id: FILE_ID, upload: { url: "https://s3.test/u", headers: {} }, expiresAt: EXPIRES_AT })
      .mockRejectedValueOnce(new PlatformError("too_large", `${name} is 60 MB: a file in transit holds 50 MB at most.`))
    vi.mocked(completeTransitUpload)
      .mockResolvedValueOnce({ id: FILE_ID, name, size: 6_000_000, mime: "text/csv", expiresAt: EXPIRES_AT })
      .mockRejectedValueOnce(new PlatformError("conflict", `${name} was not received by the file storage.`))
    const calls = [
      await call(request("POST", "transit-files", JSON.stringify(body))),
      await call(request("POST", `transit-files/${FILE_ID}/complete`, JSON.stringify({ name }))),
      await call(request("POST", "transit-files", JSON.stringify(body))),
      await call(request("POST", `transit-files/${FILE_ID}/complete`, "{}")),
    ]
    for (const { tasks } of calls) await Promise.all(tasks.map((task) => task()))
    const lines = vi.mocked(writeJournal).mock.calls.flatMap(([, entries]) => entries)
    expect(lines.map((line) => ({ tool: line.tool, target: line.target, args: line.args, error: line.error }))).toEqual([
      { tool: "POST transit-files", target: null, args: { id: FILE_ID, size: 6_000_000, mime: "text/csv" }, error: null },
      { tool: "POST transit-files/complete", target: null, args: { id: FILE_ID, size: 6_000_000, mime: "text/csv" }, error: null },
      { tool: "POST transit-files", target: null, args: { size: 6_000_000, mime: "text/csv" }, error: "too_large" },
      { tool: "POST transit-files/complete", target: null, args: { id: FILE_ID }, error: "conflict" },
    ])
    expect(lines.filter((line) => JSON.stringify(line).includes("bilan-confidentiel"))).toEqual([])
  })
})
