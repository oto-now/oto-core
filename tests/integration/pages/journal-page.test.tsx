// La page `/journal`, « Activité » depuis la 1.4.13 (E05-S05 : AC1, AC2, AC4 ; onglets Statistiques et Journal) : la session revérifiée par la page
// (`nextjs-patterns.md § Un layout n'est JAMAIS une frontière d'autorisation`), et les paramètres de
// l'adresse lus par `journalFiltersSchema` puis passés aux services avec le client de la session.
// Session de l'hôte et services du paquet simulés ; l'écran est le vrai (porté d'oto-frontend par E05-S09
// partie d1 : la conversation ouverte dans un tiroir, `<dialog>` que jsdom n'ouvre pas seul).
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { UsageSummary } from "@otomata_tech/oto_platform/schemas"
import { getConversation, listConversations, listMembers, listTeams, usageSummary, type Identity, type PlatformDb } from "@otomata_tech/oto_platform/server"
import JournalPage, { metadata } from "@/app/(dashboard)/journal/page"
import { getPlatformIdentitySafely, type PlatformSession } from "@/lib/plateforme/session"
import { simulerLesDialogues } from "../../helpers/dialogue"

vi.mock("@/lib/plateforme/session", () => ({ getPlatformIdentitySafely: vi.fn() }))

// redirect() lève NEXT_REDIRECT dans Next : le mock lève aussi, le rendu s'arrête comme en production.
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
}))

vi.mock("@otomata_tech/oto_platform/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@otomata_tech/oto_platform/server")>()),
  getConversation: vi.fn(),
  listConversations: vi.fn(),
  listMembers: vi.fn(),
  listTeams: vi.fn(),
  usageSummary: vi.fn(),
}))

const CLAIRE = "0b6f1f0e-1c1a-4a8e-9a51-0d7c1a2b3c02"
const VENTES = "0e8e5a3c-7f10-4a5b-8d3b-2b1c4d5e6f70"

// Les services qui liraient la base sont simulés : un client vide suffit.
const SESSION: PlatformSession = { user: { id: CLAIRE, email: "claire@demo.test" }, accessToken: "session-token", host: "demo.localhost:3000", db: {} as PlatformDb }
const IDENTITE: Identity = {
  org: { id: "org-1", slug: "demo", name: "Démo", prefix: "demo", brand: {}, domains: null },
  user: { id: CLAIRE, email: SESSION.user.email, name: "Claire Morel" },
  member: { role: "member", profile: {} },
  teams: [],
  isStaff: false,
  viaGrant: false,
  hasOpenGrant: false,
}

const ADMIN: Identity = { ...IDENTITE, member: { role: "admin", profile: {} } }

const USAGE_VIDE: UsageSummary = {
  periode: 30,
  team: null,
  truncated: false,
  coveredFrom: null,
  totals: { conversations: 0, people: 0, calls: 0, errors: 0 },
  procedures: [],
  functions: [],
  unmatched: { count: 0, items: [] },
  statistics: {
    adoption: { weeks: [], assistants: [], pendingInvitations: 0, neverSignedIn: { count: 0, names: [] } },
    content: { weeks: [], written: { assistant: 0, human: 0 }, mostRead: [] },
    sharing: { publicLinks: { active: 0, created: 0 }, connectors: [] },
    teams: [],
    people: [],
  },
}

const page = (parametres: Record<string, string> = {}) => JournalPage({ searchParams: Promise.resolve(parametres) })
const onglets = () => within(screen.getByRole("tablist", { name: "Les vues de l'activité" })).getAllByRole("tab").map((onglet) => [onglet.textContent, onglet.getAttribute("aria-selected")])

beforeAll(simulerLesDialogues)

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(listConversations).mockResolvedValue({ conversations: [], total: 0, calls: 0, withErrors: 0, truncated: false, restarted: false, nextCursor: null })
  vi.mocked(getConversation).mockResolvedValue(null)
  vi.mocked(listTeams).mockResolvedValue([])
  vi.mocked(listMembers).mockResolvedValue([])
  vi.mocked(usageSummary).mockResolvedValue(USAGE_VIDE)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("/journal page", () => {
  it("should send a visitor without a session to /login, reading nothing, and stay out of the index", async () => {
    vi.mocked(getPlatformIdentitySafely).mockResolvedValue({ error: { code: "unauthenticated" } })
    await expect(page()).rejects.toThrow("NEXT_REDIRECT:/login")
    expect(listConversations).not.toHaveBeenCalled()
    expect(metadata).toMatchObject({ title: "Activité", robots: { index: false } })
  })

  it("should say the list failed, with « Réessayer » to the same address, when the identity cannot be resolved (AC2)", async () => {
    vi.mocked(getPlatformIdentitySafely).mockResolvedValue(null)
    render(await page({ period: "30" }))
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Activité")
    const alertes = screen.getAllByRole("alert")
    expect(alertes).toHaveLength(3)
    for (const alerte of alertes) expect(alerte).toHaveTextContent("Une erreur est survenue. Réessayez.")
    expect(screen.getAllByRole("link", { name: "Réessayer" })[0]).toHaveAttribute("href", "/journal?tab=journal&period=30")
    expect(listConversations).not.toHaveBeenCalled()
  })

  it("should ignore a former French parameter like any unknown one, without a notice (E11-S07, AC-b3)", async () => {
    vi.mocked(getPlatformIdentitySafely).mockResolvedValue({ data: { identity: IDENTITE, session: SESSION } })
    render(await page({ periode: "30", personne: CLAIRE, erreurs: "1" }))
    expect(listConversations).toHaveBeenCalledWith(SESSION.db, IDENTITE, { periodDays: 7, teamId: undefined, userId: undefined, errorsOnly: false, cursor: undefined })
    expect(screen.queryByText("Un filtre de l'adresse n'a pas été compris : il est ignoré.")).toBeNull()
  })

  it("should pass the filters of the address to the services, with the session's client (AC4)", async () => {
    vi.mocked(getPlatformIdentitySafely).mockResolvedValue({ data: { identity: IDENTITE, session: SESSION } })
    render(await page({ period: "30", team: VENTES, person: CLAIRE, errors: "1", cursor: "c-2", conversation: "K7M2-9QXR", calls: "a-1" }))
    expect(listConversations).toHaveBeenCalledWith(SESSION.db, IDENTITE, { periodDays: 30, teamId: VENTES, userId: CLAIRE, errorsOnly: true, cursor: "c-2" })
    expect(getConversation).toHaveBeenCalledWith(SESSION.db, IDENTITE, "K7M2-9QXR", { cursor: "a-1" })
    expect(screen.getByRole("dialog", { name: "Conversation" })).toHaveTextContent("Cette conversation n'existe pas ou ne vous est pas visible.")
  })
})

// 1.4.13 : « Activité », Statistiques pour qui administre, ouvert par défaut pour lui ; Journal pour tous.
describe("/journal page, the tabs of « Activité » (1.4.13)", () => {
  it("should open the statistics by default for an administrator, reading the usage only, the two tabs offered", async () => {
    vi.mocked(getPlatformIdentitySafely).mockResolvedValue({ data: { identity: ADMIN, session: SESSION } })
    render(await page({ period: "7", team: VENTES }))
    expect(usageSummary).toHaveBeenCalledWith(SESSION.db, ADMIN, { period: 7, team: VENTES })
    expect(listConversations).not.toHaveBeenCalled()
    expect(onglets()).toEqual([
      ["Statistiques", "true"],
      ["Journal", "false"],
    ])
    expect(screen.getByRole("heading", { level: 2, name: "Par personne" })).toBeInTheDocument()
    // Le filtre d'équipe garde l'onglet : un formulaire GET remplace la requête de son adresse.
    const formulaire = screen.getByRole("form", { name: "Filtrer par équipe" })
    expect(formulaire).toHaveAttribute("action", "/journal")
    expect(formulaire.querySelector('input[type="hidden"][name="tab"]')).toHaveValue("statistics")
  })

  it("should open the journal of an administrator who asks for it", async () => {
    vi.mocked(getPlatformIdentitySafely).mockResolvedValue({ data: { identity: ADMIN, session: SESSION } })
    render(await page({ tab: "journal" }))
    expect(listConversations).toHaveBeenCalled()
    expect(usageSummary).not.toHaveBeenCalled()
    expect(onglets()).toEqual([
      ["Statistiques", "false"],
      ["Journal", "true"],
    ])
    // Les filtres gardent l'onglet : un formulaire GET remplace la requête de son adresse.
    const formulaire = screen.getByRole("form", { name: "Filtrer le journal" })
    expect(formulaire).toHaveAttribute("action", "/journal?tab=journal")
    expect(formulaire.querySelector('input[type="hidden"][name="tab"]')).toHaveValue("journal")
  })

  it("should give a member the journal alone, even when the address asks for the statistics, never reading the usage", async () => {
    vi.mocked(getPlatformIdentitySafely).mockResolvedValue({ data: { identity: IDENTITE, session: SESSION } })
    render(await page({ tab: "statistics" }))
    expect(usageSummary).not.toHaveBeenCalled()
    expect(listConversations).toHaveBeenCalled()
    expect(onglets()).toEqual([["Journal", "true"]])
  })
})
