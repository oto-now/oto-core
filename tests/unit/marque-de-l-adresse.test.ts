// La marque de l'adresse des écrans d'authentification (E05-S07, AC4) : en-têtes et services du
// paquet simulés (comme `identite-pages.test.tsx`) ; `readBrand` reste le vrai.
import { headers } from "next/headers"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  createAnonPlatformDb,
  PlatformError,
  resolveOrg,
  type IdentityOrg,
  type PlatformDb,
} from "@otomata_tech/oto_platform/server"
import {
  ATTENTE_DE_LA_MARQUE_MS,
  marqueDeLAdresse,
  marqueDOrganisation,
} from "@/lib/plateforme/marque-de-l-adresse"

vi.mock("next/headers", () => ({ headers: vi.fn() }))

vi.mock("@otomata_tech/oto_platform/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@otomata_tech/oto_platform/server")>()),
  createAnonPlatformDb: vi.fn(),
  resolveOrg: vi.fn(),
}))

// Les services qui liraient la base sont simulés : un client vide suffit.
const ANON_DB = {} as PlatformDb
const LOGO = "https://example.com/logo.png"

function org(brand: unknown): IdentityOrg {
  // `brand` est du JSON libre en base : le test y met aussi des valeurs invalides.
  return { id: "org-1", slug: "demo", name: "Démo", prefix: "demo", brand: brand as IdentityOrg["brand"], domains: null }
}

beforeEach(() => {
  vi.clearAllMocks()
  // `headers()` rend des en-têtes en lecture seule : des `Headers` ordinaires suffisent.
  vi.mocked(headers).mockResolvedValue(new Headers({ host: "demo.localhost:3000" }) as unknown as Awaited<ReturnType<typeof headers>>)
  vi.mocked(createAnonPlatformDb).mockReturnValue(ANON_DB)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe("marqueDeLAdresse (AC4)", () => {
  it("should read the organisation of the address without a session and hand its brand to the screens", async () => {
    vi.mocked(resolveOrg).mockResolvedValue(org({ theme: "foret", logo_url: LOGO, display_name: "Démo Forêt" }))

    // E05-S13 (AC-3) : le nom de l'organisation, même quand un ancien `display_name` est enregistré.
    await expect(marqueDeLAdresse()).resolves.toEqual({ theme: "foret", logo: LOGO, nomAffiche: "Démo" })
    expect(resolveOrg).toHaveBeenCalledWith(ANON_DB, "demo.localhost")
  })

  it("should return null for an address without organisation, without logging", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    vi.mocked(resolveOrg).mockRejectedValue(new PlatformError("unknown_org", "No organisation is served at 127.0.0.1."))

    await expect(marqueDeLAdresse()).resolves.toBeNull()
    expect(log).not.toHaveBeenCalled()
  })

  it("should return null and log the original error on any other failure", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    const panne = new Error("fetch failed")
    vi.mocked(resolveOrg).mockRejectedValue(panne)

    await expect(marqueDeLAdresse()).resolves.toBeNull()
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0][1]).toBe(panne)
  })

  it("should wait at most 1 000 ms for org_by_host, then return null and log it", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    vi.mocked(resolveOrg).mockReturnValue(new Promise<IdentityOrg>(() => {}))
    vi.useFakeTimers()
    let lue: unknown = "en attente"
    void marqueDeLAdresse().then((marque) => (lue = marque))
    // `headers()` répond d'abord ; la borne part ensuite.
    await vi.advanceTimersByTimeAsync(0)
    expect(vi.getTimerCount()).toBe(1)

    await vi.advanceTimersByTimeAsync(ATTENTE_DE_LA_MARQUE_MS - 1)
    expect(lue).toBe("en attente")
    expect(log).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(lue).toBeNull()
    expect(log).toHaveBeenCalledTimes(1)
    expect(ATTENTE_DE_LA_MARQUE_MS).toBe(1_000)
  })

  it("should let the dynamic usage signal of headers() through, unlogged", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    // Au prérendu, `headers()` lève pour marquer la route dynamique : Next doit recevoir ce signal.
    const dynamique = Object.assign(new Error("Dynamic server usage: Route /login used `headers`"), {
      digest: "DYNAMIC_SERVER_USAGE",
    })
    vi.mocked(headers).mockRejectedValue(dynamique)

    await expect(marqueDeLAdresse()).rejects.toBe(dynamique)
    expect(resolveOrg).not.toHaveBeenCalled()
    expect(log).not.toHaveBeenCalled()
  })
})

describe("marqueDOrganisation", () => {
  it("should never hand over a logo that is not an https address", () => {
    expect(marqueDOrganisation({ name: "Acme", brand: { logo_url: "javascript:alert(1)" } }).logo).toBeNull()
  })
})
