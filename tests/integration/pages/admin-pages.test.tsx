// Les pages `/admin/usage` et `/admin/feedback` (E08-S09, AC1) et les entrées d'administration du
// layout `(dashboard)` (E08-S03 N9) : l'accès décidé par l'identité, avant tout appel de service. E05-S13 :
// les retours à qui les traite (AC-9), « Journal » dans les réglages et un seul groupe sans sous-titre pour un
// membre (AC-10). 1.4.13 : « Statistiques » (l'usage) est un onglet d'« Activité », où mène l'ancienne adresse ; les Retours
// à l'administrateur quand l'organisation les affiche. Session de l'hôte et services du paquet simulés ; `isOrgAdmin` et les écrans sont
// les vrais, `handlesFeedback` suit la règle du service, ses branches prouvées sur la base (`usage-and-feedback.test.ts`).
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { handlesFeedback, isOrgAdmin, listFeedback, listTeams, usageSummary, type Identity, type PlatformDb } from "@otomata_tech/oto_platform/server"
import DashboardLayout from "@/app/(dashboard)/layout"
import RetoursPage, { metadata as retoursMetadata } from "@/app/(dashboard)/admin/feedback/page"
import UsagePage from "@/app/(dashboard)/admin/usage/page"
import { getPlatformIdentitySafely, type PlatformSession } from "@/lib/plateforme/session"

vi.mock("@/lib/plateforme/session", () => ({ getPlatformIdentitySafely: vi.fn() }))

vi.mock("@/lib/actions/auth", () => ({ logoutAction: vi.fn() }))

// redirect() et notFound() lèvent dans Next : les mocks lèvent aussi, le rendu s'arrête comme en production.
// Le rail et le fournisseur de relecture du layout lisent le routeur, absent ici : `push` est celui
// du routeur simulé, par où une entrée du menu mène à sa page.
const { push } = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND")
  }),
  usePathname: () => "/",
  useRouter: () => ({ refresh: vi.fn(), push }),
}))

vi.mock("@otomata_tech/oto_platform/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@otomata_tech/oto_platform/server")>()),
  usageSummary: vi.fn(),
  listTeams: vi.fn(),
  listFeedback: vi.fn(),
  handlesFeedback: vi.fn(),
  // L'arbre du rail du layout (E05-S09) : vide ici.
  visibleTree: vi.fn(async () => ({ tree: [], truncated: false })),
}))

// Les services qui liraient la base sont simulés : un client vide suffit.
const SESSION: PlatformSession = { user: { id: "user-1", email: "claire@demo.test" }, accessToken: "session-token", host: "demo.localhost:3000", db: {} as PlatformDb }

/** `staff-member` : membre simple de l'organisation et de l'équipe plateforme, avec un accès en cours (fiche D17). */
type Profil = "admin" | "member" | "staff-member" | "staff-without-access"

function identite(profil: Profil): Identity {
  const staff = profil === "staff-member" || profil === "staff-without-access"
  return {
    org: { id: "org-1", slug: "demo", name: "Démo", prefix: "demo", brand: {}, domains: null },
    user: { id: SESSION.user.id, email: SESSION.user.email, name: "Claire Morel" },
    member: { role: profil === "admin" ? "admin" : "member", profile: {} },
    teams: [],
    isStaff: staff,
    viaGrant: false,
    hasOpenGrant: profil === "staff-member",
  }
}

const connecte = (profil: Profil) => ({ data: { identity: identite(profil), session: SESSION } })

const retours = () => RetoursPage({ searchParams: Promise.resolve({ period: "7", state: "all" }) })
const statistiques = (parametres: Record<string, string>) => UsagePage({ searchParams: Promise.resolve(parametres) })

beforeEach(() => {
  vi.clearAllMocks()
  // « Retours visibles » éteint : l'équipe plateforme qui administre seule.
  vi.mocked(handlesFeedback).mockImplementation(async (_db, identity) => identity.isStaff && isOrgAdmin(identity))
  vi.mocked(listTeams).mockResolvedValue([])
  vi.mocked(listFeedback).mockResolvedValue({ tickets: [], counts: { open: 0, acknowledged: 0, resolved: 0, declined: 0 }, nextCursor: null })
})

afterEach(() => {
  cleanup()
})

// 1.4.13 : les statistiques sont l'onglet d'« Activité » ; l'ancienne adresse y mène, sa fenêtre et son équipe gardées.
describe("/admin/usage, to the statistics tab of « Activité » (1.4.13)", () => {
  it("should redirect to /journal?tab=statistics with the window and the team, reading nothing", async () => {
    await expect(statistiques({ period: "90", team: "0e8e5a3c-7f10-4a5b-8d3b-2b1c4d5e6f70" })).rejects.toThrow(
      "NEXT_REDIRECT:/journal?tab=statistics&period=90&team=0e8e5a3c-7f10-4a5b-8d3b-2b1c4d5e6f70",
    )
    await expect(statistiques({ period: "abc" })).rejects.toThrow("NEXT_REDIRECT:/journal?tab=statistics&period=30")
    expect(getPlatformIdentitySafely).not.toHaveBeenCalled()
    for (const service of [usageSummary, listTeams]) expect(service).not.toHaveBeenCalled()
  })
})

describe("/admin/feedback, reserved to who handles the feedback (E08-S09, AC1 ; E05-S13, AC-9 ; 1.4.13)", () => {
  // Qui n'administre pas l'organisation : un membre, l'équipe plateforme sans accès en cours ni rôle d'administrateur.
  it.each(["member", "staff-without-access"] as const)("should render not found to %s, calling no service", async (profil) => {
    vi.mocked(getPlatformIdentitySafely).mockResolvedValue(connecte(profil))

    await expect(retours()).rejects.toThrow("NEXT_NOT_FOUND")
    for (const service of [handlesFeedback, listFeedback]) expect(service).not.toHaveBeenCalled()
  })

  // 1.4.13 : l'administrateur d'une organisation qui n'affiche pas ses retours le lit dit, et les affiche sur place.
  it("should tell an administrator of the client that the feedback is not shown, offering to show it, without reading it", async () => {
    vi.mocked(getPlatformIdentitySafely).mockResolvedValue(connecte("admin"))

    render(await retours())
    expect(handlesFeedback).toHaveBeenCalledWith(SESSION.db, identite("admin"))
    expect(listFeedback).not.toHaveBeenCalled()
    expect(screen.getByText("Les retours des assistants ne sont pas affichés pour votre organisation.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Afficher les retours des assistants aux administrateurs" })).toHaveTextContent("Les afficher")
  })

  it("should read the feedback with the session's client for the platform team, under the follow-up trail", async () => {
    vi.mocked(getPlatformIdentitySafely).mockResolvedValue(connecte("staff-member"))

    render(await retours())
    expect(handlesFeedback).toHaveBeenCalledWith(SESSION.db, identite("staff-member"))
    expect(listFeedback).toHaveBeenCalledWith(SESSION.db, identite("staff-member"), { state: undefined, type: undefined, days: 7, cursor: undefined })
    expect(screen.queryByRole("alert")).toBeNull()
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Retours des assistants")
    expect(screen.getByRole("navigation", { name: "Chemin" })).toHaveTextContent("Suivi de l’entreprise")
  })

  it("should read the feedback for an administrator of the client when the organisation shows it", async () => {
    vi.mocked(getPlatformIdentitySafely).mockResolvedValue(connecte("admin"))
    vi.mocked(handlesFeedback).mockResolvedValue(true)

    render(await retours())
    expect(listFeedback).toHaveBeenCalledWith(SESSION.db, identite("admin"), { state: undefined, type: undefined, days: 7, cursor: undefined })
  })

  it("should send a visitor without a session to /login, and say a failed identity", async () => {
    vi.mocked(getPlatformIdentitySafely).mockResolvedValue({ error: { code: "unauthenticated" } })
    await expect(retours()).rejects.toThrow("NEXT_REDIRECT:/login")

    vi.mocked(getPlatformIdentitySafely).mockResolvedValue(null)
    render(await retours())
    expect(screen.getByRole("alert")).toHaveTextContent("Une erreur est survenue. Réessayez.")
    expect(listFeedback).not.toHaveBeenCalled()
  })

  it("should title the page and keep it out of the index", () => {
    expect(retoursMetadata).toMatchObject({ title: "Retours des assistants", robots: { index: false } })
  })
})

// Depuis E05-S09 (AC-a4), les entrées sont celles du menu de l'entreprise, au haut du rail ; depuis E05-S11
// (AC-31, AC-33), « Réglages » puis « Suivi » ; Connecteurs est au pied du rail (AC-32), « Brancher un
// assistant » au menu du compte. E05-S13 : Retours à qui les traite (AC-9), Journal dans les réglages, un seul groupe
// sans sous-titre pour un membre (AC-10). 1.4.13 : « Activité » (Statistiques et Journal) à la place du Journal ; Retours
// sous « Suivi de l'entreprise » pour qui administre, décidé sur l'identité seule, sans lire l'option.
describe("(dashboard) layout administration entries (E08-S03 N9 ; E05-S09, AC-a4 ; E05-S13, AC-8 to AC-10)", () => {
  const ouvrir = () => {
    fireEvent.click(screen.getByRole("button", { name: /^Entreprise : Démo/ }))
    return screen.getByRole("menu")
  }

  it.each([
    ["admin", ["Organisation", "Équipes & accès", "Activité", "Retours"]],
    ["member", ["Équipes & accès", "Activité"]],
    ["staff-member", ["Organisation", "Équipes & accès", "Activité", "Retours"]],
  ] as const)("should show the entries by right: %s, without reading the feedback option", async (profil, attendues) => {
    vi.mocked(getPlatformIdentitySafely).mockResolvedValue(connecte(profil))

    render(await DashboardLayout({ children: <p>Contenu</p> }))
    // L'entrée « Retours » se décide sur l'identité : le layout ne lit pas l'option (budget de requêtes d'une page).
    expect(handlesFeedback).not.toHaveBeenCalled()

    // Les sous-titres (un seul groupe, aucun) : `rail-application.test.tsx`.
    const menu = ouvrir()
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual(attendues)
    // Une entrée mène à sa page, par le routeur de l'hôte.
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Activité" }))
    expect(push).toHaveBeenCalledWith("/journal")
  })
})
