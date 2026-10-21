// @vitest-environment node
// La ressource `files` de la porte (E10-S02 lot a) et l'adresse d'un fichier, `/f/<id>` (fichiers et stockage, § Adresse
// unique), sans base : identité et service simulés. L'état du stockage (AC-a7), la lecture à `/f/<id>` par redirection 302
// sans corps ni cache (AC-a5, `RouteResult.redirect`), la disponibilité en JSON sur `?check` (AC-b8), le 401 sans session,
// la redirection permanente de l'ancienne adresse, les statuts de la demande et de la confirmation (AC-a3, AC-a4) et leur
// ligne de journal. Les décisions du service, sur une vraie base : `tests/integration/files.test.ts`.
import { beforeEach, describe, expect, it, vi } from "vitest"
import { handlePlateforme } from "@otomata_tech/oto_platform/api"
import { PlatformError, type Identity } from "@otomata_tech/oto_platform/server"
import type { VerifyToken } from "../../packages/plateforme/mcp/auth"
import { fileAvailability, fileReadUrl } from "../../packages/plateforme/server/files/address"
import { completeFileUpload, fileStorageState, requestFileUpload } from "../../packages/plateforme/server/files/service"
import { storageNotEnabled } from "../../packages/plateforme/server/files/store"
import { resolveIdentity } from "../../packages/plateforme/server/identity"
import { loggedText } from "../helpers/logs"

vi.mock("../../packages/plateforme/server/db", () => ({ createPlatformDb: vi.fn(() => ({ tx: vi.fn() })) }))

vi.mock("../../packages/plateforme/server/identity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../packages/plateforme/server/identity")>()),
  resolveIdentity: vi.fn(),
}))

vi.mock("../../packages/plateforme/server/files/service", () => ({
  completeFileUpload: vi.fn(),
  fileStorageState: vi.fn(),
  requestFileUpload: vi.fn(),
}))

vi.mock("../../packages/plateforme/server/files/address", () => ({
  fileAvailability: vi.fn(),
  fileReadUrl: vi.fn(),
}))

const HOST = "acme.test"
const ORIGIN = `https://${HOST}`
const FILE_ID = "0c9e8d7f-6a5b-4c3d-8e2f-1a0b9c8d7e6f"
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

/** `/f/<id>` : l'adresse d'un fichier, hors du préfixe de la porte. */
function addressed(path: string) {
  return new Request(`${ORIGIN}/f/${path}`, { headers: { "x-forwarded-proto": "https" } })
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

describe("files resource of the gate (E10-S02, lot a)", () => {
  it("should give the storage state (AC-a7)", async () => {
    vi.mocked(fileStorageState).mockReturnValue({ enabled: false, hostTypes: [] })
    const { response, tasks } = await call(request("GET", "files"))
    expect({ status: response.status, body: await response.json(), journal: tasks.length }).toEqual({ status: 200, body: { data: { enabled: false, hostTypes: [] } }, journal: 0 })
  })

  it("should redirect a read of /f/<id> with 302 to the presigned URL, without body nor cache, and pass the disposition (AC-a5)", async () => {
    const signed = "https://s3.fr-par.scw.cloud/b/org-1/f?X-Amz-Expires=60&X-Amz-Signature=abc"
    vi.mocked(fileReadUrl).mockResolvedValue(signed)
    const { response, tasks } = await call(addressed(`${FILE_ID}?disposition=inline`))
    expect({
      status: response.status,
      location: response.headers.get("location"),
      cache: response.headers.get("cache-control"),
      body: await response.text(),
      journal: tasks.length,
    }).toEqual({ status: 302, location: signed, cache: "private, no-store", body: "", journal: 0 })
    expect(fileReadUrl).toHaveBeenCalledWith(expect.anything(), IDENTITY, FILE_ID, { disposition: "inline" })
  })

  it("should answer the availability on ?check as JSON, never a redirection, and the same not_found for what is not readable (AC-b8)", async () => {
    vi.mocked(fileAvailability)
      .mockResolvedValueOnce({ available: true, origin: null })
      .mockResolvedValueOnce({ available: false, origin: null })
      .mockRejectedValueOnce(new PlatformError("not_found", "Unknown file."))
    const answers: unknown[] = []
    for (let rank = 0; rank < 3; rank += 1) {
      const { response, tasks } = await call(addressed(`${FILE_ID}?check`))
      answers.push({ status: response.status, location: response.headers.get("location"), body: await response.json(), journal: tasks.length })
    }
    expect(answers).toEqual([
      { status: 200, location: null, body: { data: { available: true, origin: null } }, journal: 0 },
      { status: 200, location: null, body: { data: { available: false, origin: null } }, journal: 0 },
      { status: 404, location: null, body: { error: { code: "not_found", message: "Unknown file." } }, journal: 0 },
    ])
    expect(fileAvailability).toHaveBeenCalledWith(expect.anything(), IDENTITY, FILE_ID)
    expect(fileReadUrl).not.toHaveBeenCalled()
  })

  it("should answer 401 forbidden to a read without session, before the service (AC-a5)", async () => {
    const { response } = await call(addressed(FILE_ID), null)
    expect({ status: response.status, body: await response.json() }).toEqual({ status: 401, body: { error: { code: "forbidden", message: "Authentication required." } } })
    expect(fileReadUrl).not.toHaveBeenCalled()
  })

  it("should render not_found of a read as JSON, never as a redirection (AC-a5)", async () => {
    vi.mocked(fileReadUrl).mockRejectedValue(new PlatformError("not_found", "Unknown file."))
    const { response } = await call(addressed(FILE_ID))
    expect({ status: response.status, location: response.headers.get("location"), body: await response.json() }).toEqual({
      status: 404,
      location: null,
      body: { error: { code: "not_found", message: "Unknown file." } },
    })
  })

  it("should redirect the old address permanently to /f/<id>, query kept, without reading the file, and count it in the log", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const answers: unknown[] = []
    for (const query of ["?disposition=inline", "?check", ""]) {
      const { response, tasks } = await call(request("GET", `files/${FILE_ID}${query}`))
      answers.push({ status: response.status, location: response.headers.get("location"), body: await response.text(), journal: tasks.length })
    }
    expect(answers).toEqual([
      { status: 308, location: `/f/${FILE_ID}?disposition=inline`, body: "", journal: 0 },
      { status: 308, location: `/f/${FILE_ID}?check`, body: "", journal: 0 },
      { status: 308, location: `/f/${FILE_ID}`, body: "", journal: 0 },
    ])
    expect(loggedText(warn).split("\n")).toEqual(Array(3).fill("[platform] files: old address"))
    expect(fileReadUrl).not.toHaveBeenCalled()
    expect(fileAvailability).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it("should serve /f/<id> outside the gate prefix only, and a GET alone", async () => {
    const underPrefix = await call(request("GET", `f/${FILE_ID}`))
    const posted = await call(new Request(`${ORIGIN}/f/${FILE_ID}`, { method: "POST", body: "{}", headers: { "x-forwarded-proto": "https", origin: ORIGIN } }))
    expect([underPrefix.response.status, posted.response.status]).toEqual([404, 404])
    expect(fileReadUrl).not.toHaveBeenCalled()
  })

  it("should answer 201 to an upload request, 403 not_enabled without storage, each with its journal line (AC-a1, AC-a3)", async () => {
    const upload = { id: FILE_ID, upload: { url: "https://s3.test/u", headers: { "content-type": "application/pdf" } } }
    vi.mocked(requestFileUpload).mockResolvedValueOnce({ data: upload, target: "ventes/devis", teamId: null })
    const body = JSON.stringify({ node: "ventes/devis", name: "r.pdf", mime: "application/pdf", size: 3 })
    const accepted = await call(request("POST", "files", body))
    vi.mocked(requestFileUpload).mockRejectedValueOnce(storageNotEnabled())
    const refused = await call(request("POST", "files", body))
    expect([
      { status: accepted.response.status, body: await accepted.response.json(), journal: accepted.tasks.length },
      { status: refused.response.status, code: (await refused.response.json()).error.code, journal: refused.tasks.length },
    ]).toEqual([
      { status: 201, body: { data: upload }, journal: 1 },
      { status: 403, code: "not_enabled", journal: 1 },
    ])
  })

  it("should confirm an upload by its id in the address (AC-a4)", async () => {
    const ready = { id: FILE_ID, name: "r.pdf", size: 3, mime: "application/pdf" }
    vi.mocked(completeFileUpload).mockResolvedValue({ data: ready, target: "ventes/devis", teamId: null })
    const { response, tasks } = await call(request("POST", `files/${FILE_ID}/complete`, "{}"))
    expect({ status: response.status, body: await response.json(), journal: tasks.length }).toEqual({ status: 200, body: { data: ready }, journal: 1 })
    expect(completeFileUpload).toHaveBeenCalledWith(expect.anything(), IDENTITY, FILE_ID)
  })
})
