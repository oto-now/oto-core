// La page `/profile` (E05-S11, AC-3 ; HN-E05S11-30) : ouverte à tout membre, la session revérifiée par la page
// (`nextjs-patterns.md § Un layout n'est JAMAIS une frontière d'autorisation`), la fiche tirée de l'identité
// par `readProfile` (le vrai service : il ne lit pas la base), son refus dit par la phrase de la page. Session
// de l'hôte simulée ; l'écran est le vrai.
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Identity, PlatformDb } from "@otomata_tech/oto_platform/server"
import ProfilPage, { metadata } from "@/app/(dashboard)/profile/page"
import { getPlatformIdentitySafely, type PlatformSession } from "@/lib/plateforme/session"
import { libellesDesChoix } from "../../helpers/liste-de-choix"

vi.mock("@/lib/plateforme/session", () => ({ getPlatformIdentitySafely: vi.fn() }))

// redirect() lève NEXT_REDIRECT dans Next : le mock lève aussi, le rendu s'arrête comme en production.
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
}))

const CLAIRE = "0b6f1f0e-1c1a-4a8e-9a51-0d7c1a2b3c02"

const SESSION: PlatformSession = { user: { id: CLAIRE, email: "claire@demo.test" }, accessToken: "session-token", host: "demo.localhost:3000", db: {} as PlatformDb }
const IDENTITE: Identity = {
  org: { id: "org-1", slug: "demo", name: "Démo", prefix: "demo", brand: { theme: "lagune", language: "en" }, domains: null },
  user: { id: CLAIRE, email: SESSION.user.email, name: "Claire Morel" },
  member: { role: "member", profile: { name: "Claire Morel", first_name: "Claire", last_name: "Morel", handle: "claire", theme: "foret" } },
  teams: [],
  isStaff: false,
  viaGrant: false,
  hasOpenGrant: false,
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("/profile page", () => {
  it("should send a visitor without a session to /login, and stay out of the index", async () => {
    vi.mocked(getPlatformIdentitySafely).mockResolvedValue({ error: { code: "unauthenticated" } })
    await expect(ProfilPage()).rejects.toThrow("NEXT_REDIRECT:/login")
    expect(metadata).toMatchObject({ title: "Profil", robots: { index: false } })
  })

  it("should send a person who is not a member of the organisation to /no-organization", async () => {
    vi.mocked(getPlatformIdentitySafely).mockResolvedValue({ error: { code: "not_member" } })
    await expect(ProfilPage()).rejects.toThrow("NEXT_REDIRECT:/no-organization")
  })

  it("should say the profile failed when the identity cannot be resolved", async () => {
    vi.mocked(getPlatformIdentitySafely).mockResolvedValue(null)
    render(await ProfilPage())
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Profil")
    expect(screen.getByRole("alert")).toHaveTextContent("Une erreur est survenue. Réessayez.")
    expect(screen.queryByRole("textbox")).toBeNull()
  })

  it("should open the profile of a member, prefilled from the identity, with the organisation's language named", async () => {
    vi.mocked(getPlatformIdentitySafely).mockResolvedValue({ data: { identity: IDENTITE, session: SESSION } })
    render(await ProfilPage())
    expect(screen.getByRole("textbox", { name: "Prénom" })).toHaveValue("Claire")
    expect(screen.getByRole("textbox", { name: "Nom" })).toHaveValue("Morel")
    expect(libellesDesChoix(screen.getByRole("combobox", { name: "Langue" }))).toContain("Celle de l'organisation (English)")
    expect(screen.getByRole("button", { name: "Forêt" })).toHaveAttribute("aria-pressed", "true")
  })

  // `readProfile` refuse l'équipe plateforme entrée par un accès en cours : la page le dit par sa phrase.
  it("should say that only members have a profile to a caller entered by a platform access", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    vi.mocked(getPlatformIdentitySafely).mockResolvedValue({ data: { identity: { ...IDENTITE, viaGrant: true }, session: SESSION } })
    render(await ProfilPage())
    expect(screen.getByRole("alert")).toHaveTextContent("Seuls les membres de l'organisation ont un profil ici.")
    expect(screen.queryByRole("textbox")).toBeNull()
  })
})
