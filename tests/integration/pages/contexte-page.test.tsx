// La page `/context` (E11-S10, lot e, AC-e2 ; AC-f7) : la vue « Contexte », ex-onglet de l'accueil (E05-S11, AC-13,
// AC-14), ouverte par le menu du compte. La session revérifiée par la page (`nextjs-patterns.md § Un layout n'est
// JAMAIS une frontière d'autorisation`), l'aperçu lu sans phrase avec le client de la session, puis chaque Contexte
// servi par son chemin, dont le niveau (décidé par le service) choisit l'éditeur. Session de l'hôte et services du
// paquet simulés ; l'écran est le vrai.
import type { ReactNode } from "react"
import { act, cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { loadNode, PlatformError, previewContext, type PlatformDb } from "@otomata_tech/oto_platform/server"
import { EcranDuContexteChargement } from "@otomata_tech/oto_platform/ui"
import ContextePage, { metadata } from "@/app/(dashboard)/context/page"
import { getPlatformIdentitySafely, type PlatformSession } from "@/lib/plateforme/session"
import { bloc, vueDuNoeud } from "../../helpers/noeud"
import { identityOf, ORG } from "../../helpers/reference-org"

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
  previewContext: vi.fn(),
  loadNode: vi.fn(),
}))

const ECHEC = "Une erreur est survenue. Réessayez."
/** Léa, administratrice de l'organisation, membre de la seule équipe Ventes (AC-f7). */
const LEA = identityOf("lea", { org: { id: ORG.id, slug: "demo", name: "Démo", prefix: "demo", brand: {}, domains: null } })
const IDENTITE = { ...LEA, member: { ...LEA.member, role: "admin" as const } }
const SESSION: PlatformSession = {
  user: { id: IDENTITE.user.id, email: IDENTITE.user.email },
  accessToken: "session-token",
  host: "demo.example.test",
  // Les services qui liraient la base sont simulés : un client vide suffit, sans le type du vrai.
  db: {} as PlatformDb,
}

const TEXTE = "ctx: XXXX-XXXX\n\n## Context: everyone (contexte)\nNous vendons.\n\n## Context: team Ventes (ventes/contexte)\nTutoie."
const APERCU = {
  text: TEXTE,
  budget: 20_000,
  whole: { total: 112, blocks: [{ name: "code", chars: 14 }, { name: "contexte", chars: 45 }, { name: "ventes/contexte", chars: 49 }] },
  blocks: [
    { name: "code", chars: 14, status: "full" as const, path: null },
    { name: "contexte", chars: 45, status: "full" as const, path: "contexte" },
    { name: "ventes/contexte", chars: 49, status: "full" as const, path: "ventes/contexte" },
  ],
  served: null,
  candidates: [],
}

/** Rend sous un `act` attendu : l'écran, suspendu sur ses lectures, se rend dans le même tour. */
async function montrer(page: ReactNode) {
  await act(async () => {
    render(page)
  })
}

const partie = (nom: string) => within(screen.getByRole("region", { name: nom }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getPlatformIdentitySafely).mockResolvedValue({ data: { identity: IDENTITE, session: SESSION } })
  vi.mocked(previewContext).mockResolvedValue(APERCU)
  // Le service décide des niveaux : Tout le monde en lecture, Ventes en gestion.
  vi.mocked(loadNode).mockImplementation(async (_db, _identite, { path }) =>
    path === "contexte"
      ? vueDuNoeud({ id: "n-contexte", path, kind: "context", level: 1 })
      : vueDuNoeud({ id: "n-ventes", path, kind: "context", level: 3, blocks: [bloc("b2000000-0000-4000-8000-000000000002", "paragraph", "Tutoie.")] }),
  )
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("/context page session (AC-e2)", () => {
  it("should send a visitor without a session to /login, reading nothing, and stay out of the index", async () => {
    vi.mocked(getPlatformIdentitySafely).mockResolvedValue({ error: { code: "unauthenticated" } })

    await expect(ContextePage()).rejects.toThrow("NEXT_REDIRECT:/login")
    expect(previewContext).not.toHaveBeenCalled()
    expect(metadata).toMatchObject({ title: "Contexte", robots: { index: false } })
  })

  // `not_member` suit la même branche (`if (identite?.error) redirect`) : un seul code la prouve.
  it("should send unknown_org to /no-organization, reading nothing", async () => {
    vi.mocked(getPlatformIdentitySafely).mockResolvedValue({ error: { code: "unknown_org" } })

    await expect(ContextePage()).rejects.toThrow("NEXT_REDIRECT:/no-organization")
    expect(previewContext).not.toHaveBeenCalled()
  })

  it("should say once that the view could not be read when the identity cannot be resolved, « Réessayer » on /context", async () => {
    vi.mocked(getPlatformIdentitySafely).mockResolvedValue(null)

    await montrer(await ContextePage())

    expect(screen.getByRole("heading", { level: 1, name: "Contexte" })).toBeInTheDocument()
    expect(screen.getAllByRole("alert")).toHaveLength(1)
    expect(screen.getByRole("alert")).toHaveTextContent(ECHEC)
    expect(screen.getByRole("link", { name: "Réessayer" })).toHaveAttribute("href", "/context")
    expect(previewContext).not.toHaveBeenCalled()
  })

  it("should say it is loading while the view is read", () => {
    render(<EcranDuContexteChargement />)
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true")
    expect(screen.getByRole("status")).toHaveTextContent("Chargement du contexte…")
  })
})

describe("/context page reads (AC-e2, AC-f7)", () => {
  it("should read the preview without a phrase, then each served Contexte by its path, with the session client, writing in place the one the service lets the person write", async () => {
    await montrer(await ContextePage())

    expect(previewContext).toHaveBeenCalledWith(SESSION.db, IDENTITE, {})
    expect(vi.mocked(loadNode).mock.calls.map(([db, identite, lu]) => [db, identite, lu.path])).toEqual([
      [SESSION.db, IDENTITE, "contexte"],
      [SESSION.db, IDENTITE, "ventes/contexte"],
    ])
    expect(screen.getByRole("heading", { level: 1, name: "Contexte" })).toBeInTheDocument()
    expect(partie("Contexte : Tout le monde").queryByRole("textbox")).toBeNull()
    expect(partie("Contexte : équipe Ventes").getByRole("textbox", { name: "Modifier ce texte — Tutoie." })).toBeInTheDocument()
    // Administratrice, membre de la seule équipe Ventes : sa seule partie d'équipe, nommée par ses équipes (AC-f7).
    expect(screen.getAllByRole("region", { name: /^Contexte : équipe/ }).map((region) => region.id)).toEqual(["context-ventes"])
  })

  // E05-S12 (AC-7, HN-E05S12-C10) : le Contexte d'une partie non servie se lit aussi ; absent (`not_found`), sa
  // partie ne dit aucune alerte ; toute autre panne se dit dans sa partie.
  it("should read the Contexte of a part not served, say its failed read, and say nothing of an absent one", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const conseil = "## Context: team Conseil (conseil/contexte)\nTeam Conseil."
    const support = "## Context: team Support (support/contexte)\nTeam Support."
    vi.mocked(previewContext).mockResolvedValue({
      ...APERCU,
      text: [TEXTE, conseil, support].join("\n\n"),
      blocks: [
        ...APERCU.blocks,
        { name: "conseil/contexte", chars: conseil.length, status: "full", path: null, head: conseil.length },
        { name: "support/contexte", chars: support.length, status: "full", path: null, head: support.length },
      ],
    })
    vi.mocked(loadNode).mockImplementation(async (_db, _identite, { path }) => {
      if (path === "conseil/contexte") throw new PlatformError("not_found", "Not found.")
      if (path === "support/contexte") throw new PlatformError("internal", "Internal error.")
      return vueDuNoeud({ id: `n-${path}`, path, kind: "context", level: 1 })
    })

    await montrer(await ContextePage())

    expect(vi.mocked(loadNode).mock.calls.map(([, , lu]) => lu.path)).toEqual(["contexte", "ventes/contexte", "conseil/contexte", "support/contexte"])
    expect(partie("Contexte : équipe conseil").queryByRole("alert")).toBeNull()
    expect(partie("Contexte : équipe support").getByRole("alert")).toHaveTextContent(ECHEC)
  })

  it("should say a failed preview with « Réessayer » on /context", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    vi.mocked(previewContext).mockRejectedValue(new PlatformError("internal", "Internal error."))

    await montrer(await ContextePage())

    expect(screen.getByRole("alert")).toHaveTextContent(`L'aperçu n'a pas pu être calculé.${ECHEC}`)
    expect(screen.getByRole("link", { name: "Réessayer" })).toHaveAttribute("href", "/context")
    expect(loadNode).not.toHaveBeenCalled()
  })
})
