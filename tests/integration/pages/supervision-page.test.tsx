// La page `/platform/supervision` (administration et cellule, N9) : la session revérifiée par la page, puis le droit
// de l'équipe plateforme décidé avant toute lecture (`getPlatformStaff`) : hors d'elle, la page n'existe pas ; puis
// `listPlatformOrgs` lu avec le client de la session. Session de l'hôte et service du paquet simulés ; l'écran est le vrai.
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { listPlatformOrgs, type PlatformDb } from "@otomata_tech/oto_platform/server"
import SupervisionPage, { metadata } from "@/app/(dashboard)/platform/supervision/page"
import { getPlatformSession, getPlatformStaff, type PlatformSession } from "@/lib/plateforme/session"

vi.mock("@/lib/plateforme/session", () => ({ getPlatformSession: vi.fn(), getPlatformStaff: vi.fn() }))

// redirect() et notFound() lèvent dans Next : les mocks lèvent aussi, le rendu s'arrête comme en production.
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND")
  }),
}))

vi.mock("@otomata_tech/oto_platform/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@otomata_tech/oto_platform/server")>()),
  listPlatformOrgs: vi.fn(),
}))

const THEO = "0b6f1f0e-1c1a-4a8e-9a51-0d7c1a2b3c09"
// Le service qui lirait la base est simulé : un client vide suffit.
const SESSION: PlatformSession = { user: { id: THEO, email: "theo@oto.test" }, accessToken: "session-token", host: "cell.localhost:3000", db: {} as PlatformDb }
const STAFF = { userId: THEO, email: SESSION.user.email }

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("/platform/supervision page", () => {
  it("should send a visitor without a session to /login, reading nothing, and stay out of the index", async () => {
    vi.mocked(getPlatformSession).mockResolvedValue(null)
    await expect(SupervisionPage()).rejects.toThrow("NEXT_REDIRECT:/login")
    expect(getPlatformStaff).not.toHaveBeenCalled()
    expect(listPlatformOrgs).not.toHaveBeenCalled()
    expect(metadata).toMatchObject({ title: "Supervision", robots: { index: false } })
  })

  it("should not exist for a person outside the platform team, reading nothing", async () => {
    vi.mocked(getPlatformSession).mockResolvedValue(SESSION)
    vi.mocked(getPlatformStaff).mockResolvedValue(null)
    await expect(SupervisionPage()).rejects.toThrow("NEXT_NOT_FOUND")
    expect(listPlatformOrgs).not.toHaveBeenCalled()
  })

  it("should list the spaces with the session's client for the platform team", async () => {
    vi.mocked(getPlatformSession).mockResolvedValue(SESSION)
    vi.mocked(getPlatformStaff).mockResolvedValue(STAFF)
    vi.mocked(listPlatformOrgs).mockResolvedValue([])
    render(await SupervisionPage())
    expect(getPlatformStaff).toHaveBeenCalledWith(SESSION)
    expect(listPlatformOrgs).toHaveBeenCalledWith(SESSION.db, STAFF)
    expect(screen.getByText("Aucun espace sur cette plateforme.")).toBeInTheDocument()
  })
})
