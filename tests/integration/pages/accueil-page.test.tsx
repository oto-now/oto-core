// La page d'accueil `/` (E05-S09, partie b, AC-b1) : la session revérifiée par la page
// (`nextjs-patterns.md § Un layout n'est JAMAIS une frontière d'autorisation`), les lectures des services
// avec le client de la session, chacune passée par `resultatDe`, la semaine du journal prise au défaut de
// `/journal`, l'adresse du serveur tirée de l'origine de la requête, et les noms des services adaptés pour
// l'écran. Session de l'hôte et services du paquet simulés ; `connectAddress` et l'écran sont les vrais.
// E11-S10 (AC-e3) : l'accueil n'a plus d'onglets ni ne lit l'adresse ; la vue « Contexte » est éprouvée par
// `contexte-page.test.tsx`.
// E11-S09 (AC-11) : la fenêtre de « Brancher » reçoit l'adresse entière et les procédures déjà lues.
// 1.4.13 : la page lit aussi la première page de « Reprendre » (contenus récents de ses équipes) et les nouveautés.
import type { ReactNode } from "react"
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { homeContents, homeNews, lastConnections, listActivities, loadNode, PlatformError, previewContext, usefulProcedures, type PlatformDb } from "@otomata_tech/oto_platform/server"
import AccueilPage, { metadata } from "@/app/(dashboard)/page"
import { getPlatformIdentitySafely, getRequestOrigin, type PlatformSession } from "@/lib/plateforme/session"
import { simulerLesDialogues } from "../../helpers/dialogue"
import { identityOf, ORG } from "../../helpers/reference-org"

vi.mock("@/lib/plateforme/session", () => ({ getPlatformIdentitySafely: vi.fn(), getRequestOrigin: vi.fn() }))

// redirect() lève NEXT_REDIRECT dans Next : le mock lève aussi, le rendu s'arrête comme en production.
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
}))

vi.mock("@otomata_tech/oto_platform/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@otomata_tech/oto_platform/server")>()),
  lastConnections: vi.fn(),
  listActivities: vi.fn(),
  homeContents: vi.fn(),
  homeNews: vi.fn(),
  usefulProcedures: vi.fn(),
  previewContext: vi.fn(),
  loadNode: vi.fn(),
}))

/** La page : elle ne lit plus son adresse (E11-S10, AC-e3). */
const page = () => AccueilPage()

const ECHEC = "Une erreur est survenue. Réessayez."
const BRANCHER = "Brancher votre assistant"
const GUIDE = "Brancher mon Claude, ChatGPT ou Mistral"
const IDENTITE = identityOf("lea", { org: { id: ORG.id, slug: "demo", name: "Démo", prefix: "demo", brand: {}, domains: null } })
const SESSION: PlatformSession = {
  user: { id: IDENTITE.user.id, email: IDENTITE.user.email },
  accessToken: "session-token",
  host: "demo.example.test",
  // Les services qui liraient la base sont simulés : un client vide suffit, sans le type du vrai.
  db: {} as PlatformDb,
}

/** Rend sous un `act` attendu : l'écran, suspendu sur ses lectures, se rend dans le même tour. */
async function montrer(page: ReactNode) {
  await act(async () => {
    render(page)
  })
}

const ilot = (nom: string) => within(screen.getByRole("region", { name: nom }))
/** Ouvre l'onglet « Fil » de « Reprendre », fermé par défaut. */
const ouvrirLeFil = () => fireEvent.click(ilot("Reprendre").getByRole("tab", { name: "Fil" }))

beforeAll(simulerLesDialogues)

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getPlatformIdentitySafely).mockResolvedValue({ data: { identity: IDENTITE, session: SESSION } })
  vi.mocked(getRequestOrigin).mockResolvedValue("https://demo.example.test")
  vi.mocked(listActivities).mockResolvedValue({
    truncated: false,
    activities: [
      { id: 7, at: "2026-09-20T08:05:00Z", userId: IDENTITE.user.id, userName: IDENTITE.user.name, verb: "ran", kind: "procedure", path: "ventes/relance", title: "Relancer les impayés", count: 1, ctx: "K7M2-9QXR" },
    ],
  })
  vi.mocked(usefulProcedures).mockResolvedValue([{ path: "ventes/relance", title: "Relancer les impayés" }])
  vi.mocked(homeContents).mockResolvedValue({
    items: [{ path: "ventes/grille", title: "Grille tarifaire", kind: "page", space: { kind: "team", name: "Ventes" }, at: "2026-09-20T08:00:00Z" }],
    hasMore: false,
  })
  vi.mocked(homeNews).mockResolvedValue({ since: "2026-09-19T00:00:00.000Z", items: [] })
  vi.mocked(lastConnections).mockResolvedValue([{ family: "Claude Code", signature: "claude-code@2.1.280", at: "2026-09-23T09:00:00Z" }])
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("/ page session", () => {
  it("should send a visitor without a session to /login, reading nothing, and stay out of the index", async () => {
    vi.mocked(getPlatformIdentitySafely).mockResolvedValue({ error: { code: "unauthenticated" } })

    await expect(page()).rejects.toThrow("NEXT_REDIRECT:/login")
    expect(listActivities).not.toHaveBeenCalled()
    expect(lastConnections).not.toHaveBeenCalled()
    expect(metadata).toMatchObject({ title: "Accueil", robots: { index: false } })
  })

  it.each(["unknown_org", "not_member"] as const)("should send %s to /no-organization, reading nothing", async (code) => {
    vi.mocked(getPlatformIdentitySafely).mockResolvedValue({ error: { code } })

    await expect(page()).rejects.toThrow("NEXT_REDIRECT:/no-organization")
    expect(listActivities).not.toHaveBeenCalled()
  })

  it("should send a request without origin to /no-organization, as /connect does, reading nothing", async () => {
    vi.mocked(getRequestOrigin).mockResolvedValue(null)

    await expect(page()).rejects.toThrow("NEXT_REDIRECT:/no-organization")
    expect(listActivities).not.toHaveBeenCalled()
  })
})

describe("/ page reads (AC-b1)", () => {
  it("should read the week of activities, the first page of « Reprendre », the news, the connections and five procedures with the session client, and show them with the address of the request origin", async () => {
    await montrer(await page())

    expect(listActivities).toHaveBeenCalledWith(SESSION.db, IDENTITE, { periodDays: 7, scope: "teams" })
    expect(homeContents).toHaveBeenCalledWith(SESSION.db, IDENTITE, { tab: "recent", scope: "teams" })
    expect(homeNews).toHaveBeenCalledWith(SESSION.db, IDENTITE)
    expect(usefulProcedures).toHaveBeenCalledWith(SESSION.db, IDENTITE, 5)
    expect(lastConnections).toHaveBeenCalledWith(SESSION.db, IDENTITE)
    expect(screen.getByRole("heading", { level: 1, name: `Bonjour ${IDENTITE.member.profile.name}` })).toBeInTheDocument()
    expect(ilot("Reprendre").getByRole("link", { name: /^Grille tarifaire/ })).toHaveAttribute("href", "/n/ventes/grille")
    ouvrirLeFil()
    expect(ilot("Reprendre").getByRole("link", { name: /^Vous avez lancé la procédure Relancer les impayés/ })).toHaveAttribute("href", "/n/ventes/relance")
    expect(ilot("Lancer avec Claude").getByRole("link", { name: "Relancer les impayés" })).toHaveAttribute("href", "/n/ventes/relance")
    expect(ilot(BRANCHER).getAllByRole("listitem").at(-1)).toHaveTextContent("Claude Code · dernière connexion le 23 septembre 2026")
    // La fenêtre reçoit l'adresse entière, lue à l'origine de la requête, et les procédures déjà lues (AC-11).
    fireEvent.click(ilot(BRANCHER).getByRole("button", { name: "Brancher" }))
    const guide = within(screen.getByRole("dialog", { name: GUIDE })).getByRole("tabpanel", { name: "Claude Code" })
    expect(within(guide).getByText("claude mcp add --transport http demo https://demo.example.test/api/mcp")).toBeInTheDocument()
    expect(within(guide).getByRole("button", { name: "Copier la demande « Relancer les impayés »" })).toBeInTheDocument()
    expect(usefulProcedures).toHaveBeenCalledTimes(1)
    expect(previewContext).not.toHaveBeenCalled()
    expect(loadNode).not.toHaveBeenCalled()
  })

  it("should say a failed read in its island only, the rest of the home shown", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    vi.mocked(listActivities).mockRejectedValue(new PlatformError("internal", "Internal error."))

    await montrer(await page())
    ouvrirLeFil()

    expect(screen.getAllByRole("alert").filter((alerte) => alerte.textContent !== "")).toHaveLength(1)
    expect(ilot("Reprendre").getAllByRole("alert").find((alerte) => alerte.textContent !== "")).toHaveTextContent(ECHEC)
    expect(ilot(BRANCHER).getAllByRole("listitem").at(-1)).toHaveTextContent("Claude Code")
  })

  it("should say once that the home could not be read when the identity cannot be resolved, reading nothing", async () => {
    vi.mocked(getPlatformIdentitySafely).mockResolvedValue(null)

    await montrer(await page())

    expect(screen.getByRole("alert")).toHaveTextContent(ECHEC)
    expect(screen.getByRole("heading", { level: 1, name: "Bonjour" })).toBeInTheDocument()
    expect(listActivities).not.toHaveBeenCalled()
    expect(lastConnections).not.toHaveBeenCalled()
  })
})

// E11-S10 (AC-e3) : l'ancien onglet « Contexte » de l'accueil ne se lit plus ; l'accueil se rend sans rien lire du Contexte.
describe("/ page without address parameters (E11-S10, AC-e3)", () => {
  it("should read no parameter of its address, show « Reprendre » on « Récents », and read nothing of the Contexte", async () => {
    // La page ne prend plus `searchParams` : aucun paramètre de l'adresse ne l'atteint.
    expect(AccueilPage.length).toBe(0)
    await montrer(await page())

    expect(ilot("Reprendre").queryByRole("heading", { level: 2 })).toBeNull()
    expect(ilot("Reprendre").getByRole("tab", { name: "Récents" })).toHaveAttribute("aria-selected", "true")
    expect(previewContext).not.toHaveBeenCalled()
    expect(loadNode).not.toHaveBeenCalled()
  })
})
