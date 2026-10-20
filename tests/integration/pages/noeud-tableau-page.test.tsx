// La page `/n/[...chemin]` d'un tableau et d'une page à références (E07-S03 : AC1, AC4 à AC8, AC10,
// AC15, AC16) : les réglages lus dans l'adresse et passés aux services, la grille sous son propre
// `<Suspense>`, les champs d'un formulaire « Filtrer » réécrits en `f` par une redirection, et les blocs
// `reference` des blocs montrés résolus puis rendus en place. Session de l'hôte et services du paquet
// simulés ; l'écran est le vrai.
import type { ReactNode } from "react"
import { act, cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { NodeView, TableHeader } from "@otomata_tech/oto_platform/schemas"
import {
  lastConnections,
  listMembers,
  listNodeRules,
  listTeams,
  loadNode,
  PlatformError,
  nodeLinks,
  resolveReferencesForScreen,
  tableGridRows,
  tableGridSummary,
  tableReviewQueue,
  visibleTree,
  type Identity,
  type PlatformDb,
} from "@otomata_tech/oto_platform/server"
import NoeudPage from "@/app/(dashboard)/n/[...chemin]/page"
import { getPlatformIdentitySafely, type PlatformSession } from "@/lib/plateforme/session"
import { bloc, vueDuNoeud } from "../../helpers/noeud"

vi.mock("@/lib/plateforme/session", () => ({ getPlatformIdentitySafely: vi.fn() }))

// redirect() lève NEXT_REDIRECT dans Next : le mock lève aussi, le rendu s'arrête comme en production.
// La vue de la page se compte après la réponse (`after`, 1.4.13) : hors d'une requête de Next, `after` lèverait.
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), after: vi.fn() }))

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
}))

vi.mock("@otomata_tech/oto_platform/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@otomata_tech/oto_platform/server")>()),
  loadNode: vi.fn(),
  visibleTree: vi.fn(),
  listTeams: vi.fn(),
  listMembers: vi.fn(),
  listNodeRules: vi.fn(),
  tableGridRows: vi.fn(),
  tableGridSummary: vi.fn(),
  tableReviewQueue: vi.fn(),
  resolveReferencesForScreen: vi.fn(),
  nodeLinks: vi.fn(),
  lastConnections: vi.fn(),
}))

const TABLEAU = "ventes/suivi_prospects"
const STATES = ["à traiter", "en cours", "à revoir", "qualifié", "écarté"]
const ENTETE: TableHeader = {
  columns: [
    { name: "ref", type: "text" },
    { name: "ville", type: "text" },
    { name: "montant_estime", type: "number" },
    { name: "statut", type: "enum", options: STATES },
  ],
  key: "ref",
  lifecycle: { column: "statut", states: STATES, working: "en cours", review: { state: "à revoir", approve: "qualifié", reject: "écarté" } },
  closed: false,
  proof: false,
}

const SESSION: PlatformSession = { user: { id: "user-lea", email: "lea@demo.test" }, accessToken: "session-token", host: "localhost:3000", db: {} as PlatformDb }
const IDENTITE: Identity = {
  org: { id: "org-1", slug: "demo", name: "Démo", prefix: "demo", brand: {}, domains: null },
  user: { id: "user-lea", email: SESSION.user.email, name: "Léa Martin" },
  member: { role: "member", profile: { handle: "lea" } },
  teams: [],
  isStaff: false,
  viaGrant: false,
  hasOpenGrant: false,
}

const tableau = (surcharge: Partial<NodeView> = {}): NodeView =>
  vueDuNoeud({ id: "noeud-suivi", path: TABLEAU, title: "Suivi des prospects", kind: "table", revision: 3, blocks: [], meta: ENTETE, rowsTotal: 10, level: 2, ...surcharge })

const page = (segments: string[], parametres: Record<string, string | string[]> = {}) =>
  NoeudPage({ params: Promise.resolve({ chemin: segments }), searchParams: Promise.resolve(parametres) })

/** Rend sous un `act` attendu : la grille, suspendue sur sa lecture, se rend dans le même tour. */
async function montrer(arbre: ReactNode) {
  await act(async () => {
    render(arbre)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getPlatformIdentitySafely).mockResolvedValue({ data: { identity: IDENTITE, session: SESSION } })
  vi.mocked(loadNode).mockResolvedValue(tableau())
  // Les liens du nœud (« Cité dans », « Cite » ; E05-S10 AC-b6, E11-S05 AC-e3), lus par `nodeLinks` : aucun.
  vi.mocked(nodeLinks).mockResolvedValue({ links_out: [], links_out_total: 0, links_in: [], links_in_total: 0 })
  vi.mocked(visibleTree).mockResolvedValue({ tree: [], truncated: false })
  vi.mocked(listTeams).mockResolvedValue([])
  vi.mocked(listMembers).mockResolvedValue([])
  vi.mocked(listNodeRules).mockResolvedValue({ path: TABLEAU, title: "Suivi des prospects", owner: { kind: "org" }, viewerLevel: 2, rules: [] })
  vi.mocked(tableGridRows).mockResolvedValue({ rows: [{ key: "P-003", revision: 4, set: { ref: "P-003", ville: "Valbrune", montant_estime: 95000, statut: "à revoir" } }], total: 1, count: 10 })
  vi.mocked(tableGridSummary).mockResolvedValue({ states: STATES.map((state) => ({ state, count: state === "à revoir" ? 1 : 0 })), sums: [{ column: "montant_estime", total: 95000 }] })
  vi.mocked(tableReviewQueue).mockResolvedValue({ count: 3, rows: [{ key: "P-003", revision: 4, set: { ref: "P-003", statut: "à revoir" } }] })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("/n/[...chemin] page of a table (AC1, AC4 à AC8, AC10)", () => {
  it("should read the rows, the summary and the queue with the settings of the address, and show the meta, the queue and the grid", async () => {
    await montrer(await page(["ventes", "suivi_prospects"], { q: "valbrune", sort: "-montant_estime", f: "ville:contains:Valbrune", n: "40" }))

    const lecture = [SESSION.db, IDENTITE] as const
    const selection = { table: TABLEAU, filter: { ville: { contains: "Valbrune" } }, q: "valbrune" }
    expect(tableGridRows).toHaveBeenCalledWith(...lecture, { ...selection, sort: { column: "montant_estime", direction: "desc" }, limit: 40 })
    expect(tableGridSummary).toHaveBeenCalledWith(...lecture, selection)
    expect(tableReviewQueue).toHaveBeenCalledWith(...lecture, { table: TABLEAU })
    expect(resolveReferencesForScreen).not.toHaveBeenCalled()
    // E05-S10, AC-a7 : les lignes passent dans l'infobulle de « modifié … ».
    const meta = screen.getByText(/^modifié /)
    act(() => meta.focus())
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Lignes10 lignes")
    expect(await screen.findByRole("table", { name: "Suivi des prospects — 10 lignes · 1 ligne correspond" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "À revoir" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Approuver → qualifié" })).toBeInTheDocument()
    expect(screen.queryByText("Cette page n'a pas encore de contenu.")).toBeNull()
  })

  it("should give a reader of level 1, not an administrator, the count of the queue only", async () => {
    vi.mocked(loadNode).mockResolvedValue(tableau({ level: 1 }))
    await montrer(await page(["ventes", "suivi_prospects"]))
    expect(await screen.findByRole("table", { name: /^Suivi des prospects — 10 lignes/ })).toBeInTheDocument()
    expect(screen.getByText("3 lignes à revoir")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Approuver → qualifié" })).toBeNull()
    expect(screen.queryByRole("textbox", { name: "Raison (facultative)" })).toBeNull()
  })

  it("should say in French a table too large for the search, the filters, the sort and the queue", async () => {
    const tropGrand = new PlatformError("too_large", "Table ventes/suivi_prospects has 5,001 rows.")
    vi.mocked(tableGridRows).mockRejectedValue(tropGrand)
    vi.mocked(tableReviewQueue).mockRejectedValue(tropGrand)
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    await montrer(await page(["ventes", "suivi_prospects"], { q: "valbrune" }))
    const phrase = "Ce tableau compte plus de 5 000 lignes : la recherche, les filtres, le tri et la file de revue ne s'y appliquent pas dans cette version."
    const alertes = await screen.findAllByRole("alert")
    expect(alertes).toHaveLength(2)
    for (const alerte of alertes) expect(alerte).toHaveTextContent(phrase)
  })

  it("should rewrite the fields of a « Filtrer » form into f by a redirection, and read no queue without review", async () => {
    await expect(page(["ventes", "suivi_prospects"], { sort: "ref", column: "ville", contains: "Valbrune", presence: "" })).rejects.toThrow(
      "NEXT_REDIRECT:/n/ventes/suivi_prospects?sort=ref&f=ville%3Acontains%3AValbrune",
    )
    expect(tableGridRows).not.toHaveBeenCalled()
    vi.mocked(loadNode).mockResolvedValue(tableau({ meta: { ...ENTETE, lifecycle: { column: "statut", states: STATES, working: "en cours" } } }))
    await montrer(await page(["ventes", "suivi_prospects"]))
    expect(await screen.findByRole("table", { name: "Suivi des prospects — 10 lignes" })).toBeInTheDocument()
    expect(tableReviewQueue).not.toHaveBeenCalled()
  })
})

// E11-S05 (AC-h1, HN-E11S05-17) : qui écrira les lignes d'un tableau vide, lu seulement quand il n'en a aucune.
describe("/n/[...chemin] page of an empty table (E11-S05, AC-h1)", () => {
  const vide = { rows: [], total: 0, count: 0 }
  const connexion = (family: string) => ({ family, signature: `${family}@1`, at: "2026-09-29T08:00:00.000Z" })

  it("should read the connections of the person only without a row, and name its most recent assistant", async () => {
    await montrer(await page(["ventes", "suivi_prospects"]))
    expect(lastConnections).not.toHaveBeenCalled()
    cleanup()

    vi.mocked(tableGridRows).mockResolvedValue(vide)
    vi.mocked(lastConnections).mockResolvedValue([connexion("ChatGPT"), connexion("claude.ai")])
    await montrer(await page(["ventes", "suivi_prospects"]))
    expect(lastConnections).toHaveBeenCalledWith(SESSION.db, IDENTITE)
    expect(await screen.findByText("C'est ChatGPT qui pourra créer et modifier ses lignes.")).toBeInTheDocument()
    cleanup()

    vi.mocked(lastConnections).mockResolvedValue([connexion("Claude Code")])
    await montrer(await page(["ventes", "suivi_prospects"]))
    expect(await screen.findByText("C'est Claude qui pourra créer et modifier ses lignes.")).toBeInTheDocument()
  })

  it("should say « votre assistant » without a connection or when they cannot be read, never with an alert", async () => {
    vi.mocked(tableGridRows).mockResolvedValue(vide)
    vi.mocked(tableReviewQueue).mockResolvedValue({ count: 0, rows: [] })
    vi.mocked(lastConnections).mockResolvedValue([])
    await montrer(await page(["ventes", "suivi_prospects"]))
    expect(await screen.findByText("C'est votre assistant qui pourra créer et modifier ses lignes.")).toBeInTheDocument()
    cleanup()

    vi.mocked(lastConnections).mockRejectedValue(new Error("panne"))
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    await montrer(await page(["ventes", "suivi_prospects"]))
    expect(await screen.findByText("C'est votre assistant qui pourra créer et modifier ses lignes.")).toBeInTheDocument()
    expect(screen.queryByRole("alert")).toBeNull()
  })
})

describe("/n/[...chemin] page with reference blocks (AC15, AC16)", () => {
  it("should resolve the references of the blocks shown, the draft of a writer, and render them in place", async () => {
    const publie = { ...bloc("a1000000-0000-4000-8000-000000000001", "reference", null, { path: "conseil/grille_tarifaire" }), ref: "grille" }
    const brouillon = { ...publie, data: { path: "conseil/autre_grille" } }
    const draft = { baseRevision: 1, savedAt: "2026-09-24T10:00:00Z", draftStamp: "2026-09-24T10:00:00.000000+00:00", blocks: [brouillon], title: null, summary: null, kind: null, meta: null }
    vi.mocked(loadNode).mockResolvedValue(vueDuNoeud({ path: "ventes/prospects_valbrune", blocks: [publie], level: 2, draft }))
    vi.mocked(resolveReferencesForScreen).mockResolvedValue({ [publie.id]: { kind: "card", path: "conseil/autre_grille", title: "Autre grille", nodeKind: "page", summary: "Une autre grille." } })

    render(await page(["ventes", "prospects_valbrune"]))
    expect(resolveReferencesForScreen).toHaveBeenCalledWith(SESSION.db, IDENTITE, [brouillon])
    expect(screen.getByRole("link", { name: "Autre grille" })).toHaveAttribute("href", "/n/conseil/autre_grille")
    cleanup()

    render(await page(["ventes", "prospects_valbrune"], { version: "published" }))
    expect(resolveReferencesForScreen).toHaveBeenLastCalledWith(SESSION.db, IDENTITE, [publie])
    vi.mocked(loadNode).mockResolvedValue(vueDuNoeud({ level: 2 }))
    vi.mocked(resolveReferencesForScreen).mockClear()
    await page(["ventes", "modele_relance"])
    expect(resolveReferencesForScreen).not.toHaveBeenCalled()
  })
})
