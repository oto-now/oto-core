// @vitest-environment node
// Les données de l'image de partage d'une adresse (E11-S21, AC-3 à AC-5), sans base : l'organisation de l'adresse,
// la lecture d'un lien et le téléchargement du logo simulés (leurs règles sont prouvées sur base réelle par
// `tests/integration/partage-public.test.ts` et par les tests de `fetchSource`). Ici : ce que l'image reçoit, et ses replis.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { PlatformError, shareImageData, type IdentityOrg } from "@otomata_tech/oto_platform/server"
import type { PublicNodeView } from "@otomata_tech/oto_platform/schemas"
import { resolveOrg } from "../../packages/plateforme/server/identity"
import { readPublicNode } from "../../packages/plateforme/server/shares"
import { fetchSource } from "../../packages/plateforme/server/uploads-fetch"
import { loggedText } from "../helpers/logs"

vi.mock("../../packages/plateforme/server/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../packages/plateforme/server/db")>()),
  createAnonPlatformDb: vi.fn(() => ({ tx: vi.fn() })),
}))

vi.mock("../../packages/plateforme/server/identity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../packages/plateforme/server/identity")>()),
  resolveOrg: vi.fn(),
}))

vi.mock("../../packages/plateforme/server/shares", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../packages/plateforme/server/shares")>()),
  readPublicNode: vi.fn(),
}))

vi.mock("../../packages/plateforme/server/uploads-fetch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../packages/plateforme/server/uploads-fetch")>()),
  fetchSource: vi.fn(),
}))

const HOST = "demo.oto.test"
const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde"
const LOGO_URL = "https://cdn.example.com/logo.png"
const ORG: IdentityOrg = { id: "org-1", slug: "demo", name: "Démo", prefix: "demo", brand: { theme: "lagune", logo_url: LOGO_URL }, domains: null }
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47])

// `shareImageData` ne lit que le titre et le résumé du nœud : la vue entière (blocs, tableau, liens) ne changerait rien.
const view = (title: string, summary: string) => ({ node: { title, summary } }) as PublicNodeView

let erreurs: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  erreurs = vi.spyOn(console, "error").mockImplementation(() => undefined)
  vi.mocked(resolveOrg).mockResolvedValue(ORG)
  vi.mocked(fetchSource).mockResolvedValue({ bytes: PNG, type: "image/png" })
  vi.mocked(readPublicNode).mockResolvedValue(view("Tarifs 2026", "Les prix publics de l'année."))
})

afterEach(() => {
  erreurs.mockRestore()
  vi.clearAllMocks()
})

describe("shareImageData", () => {
  it("should give a public link its title and summary, with the organisation of the address, its theme and its logo inline (AC-3)", async () => {
    const lu = await shareImageData(HOST, { token: TOKEN, path: "ventes/tarifs" })

    expect(readPublicNode).toHaveBeenCalledWith(HOST, TOKEN, "ventes/tarifs")
    expect(fetchSource).toHaveBeenCalledWith(LOGO_URL, { timeoutMs: 3_000 })
    expect(lu).toEqual({
      org: { name: "Démo", theme: "lagune", logo: `data:image/png;base64,${Buffer.from(PNG).toString("base64")}` },
      page: { title: "Tarifs 2026", summary: "Les prix publics de l'année." },
    })
  })

  it("should read no page at all without a link: an address's image never carries a title (AC-5)", async () => {
    const lu = await shareImageData(HOST)

    expect(readPublicNode).not.toHaveBeenCalled()
    expect(lu.page).toBeNull()
    expect(lu.org?.name).toBe("Démo")
  })

  it("should fall back to the organisation's image for an unknown link, silently, and for a failing read, logged (AC-4)", async () => {
    vi.mocked(readPublicNode).mockRejectedValueOnce(new PlatformError("not_found", "Not found."))
    expect((await shareImageData(HOST, { token: TOKEN, path: null })).page).toBeNull()
    expect(erreurs).not.toHaveBeenCalled()

    vi.mocked(readPublicNode).mockRejectedValueOnce(new Error("connection refused"))
    const lu = await shareImageData(HOST, { token: TOKEN, path: null })
    expect(lu.page).toBeNull()
    expect(lu.org?.name).toBe("Démo")
    expect(loggedText(erreurs)).toContain("[platform] share image: public link unreadable")
  })

  it("should draw « Oto » for an address without an organisation, silently, and log a failing read (AC-4)", async () => {
    vi.mocked(resolveOrg).mockRejectedValueOnce(new PlatformError("unknown_org", "Unknown organisation."))
    expect(await shareImageData("127.0.0.1")).toEqual({ org: null, page: null })
    expect(erreurs).not.toHaveBeenCalled()

    vi.mocked(resolveOrg).mockRejectedValueOnce(new Error("timeout"))
    expect((await shareImageData(HOST)).org).toBeNull()
    expect(loggedText(erreurs)).toContain("[platform] share image: organisation unreadable")
  })

  it("should replace the logo by the initial on a type the image does not decode, and on a failed download (AC-3)", async () => {
    const cas: [string, Awaited<ReturnType<typeof fetchSource>>][] = [
      ["a type the image does not decode", { bytes: PNG, type: "image/webp" }],
      ["a failed download", { failure: "source_url leads to a private, loopback, link-local or metadata address" }],
    ]
    const verdicts: Record<string, unknown> = {}
    for (const [nom, telecharge] of cas) {
      vi.mocked(fetchSource).mockResolvedValueOnce(telecharge)
      verdicts[nom] = (await shareImageData(HOST)).org
    }
    expect(verdicts).toEqual(Object.fromEntries(cas.map(([nom]) => [nom, { name: "Démo", theme: "lagune", logo: null }])))
  })

  it("should not download anything for an organisation without a logo", async () => {
    vi.mocked(resolveOrg).mockResolvedValueOnce({ ...ORG, brand: { theme: "cobalt" } })

    expect((await shareImageData(HOST)).org).toEqual({ name: "Démo", theme: "cobalt", logo: null })
    expect(fetchSource).not.toHaveBeenCalled()
  })
})
