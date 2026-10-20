// `?view=<id>` sur les pages de l'hôte (E10-S02 lot c : AC-c1, AC-c2, AC-c5) : `/n/<chemin>?view=<id>` demande au
// service le fichier joint au nœud lu, `not_found` dit « Fichier introuvable », un `.md` qui n'est pas de l'UTF-8 sa
// phrase ; un tableau n'a pas de visionneuse. `/p/<jeton>/<chemin>?view=<id>` demande le fichier au lien, pour le
// contenu de l'adresse, montre la même bannière au nom de l'organisation de l'adresse, et les blocs de la page publique
// lisent leurs fichiers aux routes du lien. Session de l'hôte et services simulés ; les écrans sont les vrais.
import { headers } from "next/headers"
import type { ReactElement } from "react"
import { act, cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { PublicNodeView } from "@otomata_tech/oto_platform/schemas"
import {
  fileView,
  listMembers,
  listNodeRules,
  listTeams,
  loadNode,
  nodeLinks,
  PlatformError,
  publicFileView,
  readPublicNode,
  visibleTree,
  type Identity,
  type PlatformDb,
} from "@otomata_tech/oto_platform/server"
import NoeudPage from "@/app/(dashboard)/n/[...chemin]/page"
import PagePubliqueDuLien from "@/app/p/[jeton]/[[...chemin]]/page"
import { marqueDeLAdresse } from "@/lib/plateforme/marque-de-l-adresse"
import { getPlatformIdentitySafely, type PlatformSession } from "@/lib/plateforme/session"
import { vueDuNoeud } from "../../helpers/noeud"

vi.mock("@/lib/plateforme/session", () => ({ getPlatformIdentitySafely: vi.fn() }))
vi.mock("@/lib/plateforme/marque-de-l-adresse", () => ({ marqueDeLAdresse: vi.fn() }))
vi.mock("next/headers", () => ({ headers: vi.fn() }))

// La vue de la page se compte après la réponse (`after`, 1.4.13) : hors d'une requête de Next, `after` lèverait.
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), after: vi.fn() }))

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
  loadNode: vi.fn(),
  visibleTree: vi.fn(),
  listTeams: vi.fn(),
  listMembers: vi.fn(),
  listNodeRules: vi.fn(),
  nodeLinks: vi.fn(),
  fileView: vi.fn(),
  readPublicNode: vi.fn(),
  publicFileView: vi.fn(),
}))

const LEA = "0b6f1f0e-1c1a-4a8e-9a51-0d7c1a2b3c02"
const ID = "f1000000-0000-4000-8000-0000000000dd"
const JETON = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde"
const HOTE = "demo.oto.test"

// Les services qui liraient la base sont simulés : un client vide suffit.
const SESSION: PlatformSession = { user: { id: LEA, email: "lea@demo.test" }, accessToken: "session-token", host: "localhost:3000", db: {} as PlatformDb }

const IDENTITE: Identity = {
  org: { id: "org-1", slug: "demo", name: "Démo", prefix: "demo", brand: {}, domains: null },
  user: { id: LEA, email: SESSION.user.email, name: "Léa Martin" },
  member: { role: "member", profile: { handle: "lea" } },
  teams: [],
  isStaff: false,
  viaGrant: false,
  hasOpenGrant: false,
}

const page = (parametres: Record<string, string>) => NoeudPage({ params: Promise.resolve({ chemin: ["ventes", "modele_relance"] }), searchParams: Promise.resolve(parametres) })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getPlatformIdentitySafely).mockResolvedValue({ data: { identity: IDENTITE, session: SESSION } })
  vi.mocked(loadNode).mockResolvedValue(vueDuNoeud({ level: 1 }))
  vi.mocked(visibleTree).mockResolvedValue({ tree: [], truncated: false })
  vi.mocked(listTeams).mockResolvedValue([])
  vi.mocked(listMembers).mockResolvedValue([])
  // La page lit les règles du nœud à chaque chemin, visionneuse comprise (`lire`).
  vi.mocked(listNodeRules).mockResolvedValue({ path: "ventes/modele_relance", title: "Modèle de relance", owner: { kind: "org" }, viewerLevel: 1, rules: [] })
  vi.mocked(nodeLinks).mockResolvedValue({ links_out: [], links_out_total: 0, links_in: [], links_in_total: 0 })
  vi.mocked(headers).mockResolvedValue(new Headers({ host: HOTE }))
  vi.mocked(marqueDeLAdresse).mockResolvedValue({ theme: "ardoise", logo: null, nomAffiche: "Démo" })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

async function monter(element: Promise<ReactElement>) {
  const rendu = await element
  await act(async () => {
    render(rendu)
  })
}

describe("/n/<chemin>?view=<id> (AC-c2)", () => {
  it("should ask the service for the file of the node read, and show the viewer instead of the node", async () => {
    vi.mocked(fileView).mockResolvedValue({ id: ID, name: "rapport.html", size: 2_048, path: "ventes/modele_relance", type: "html" })
    await monter(page({ view: ID }))
    expect(fileView).toHaveBeenCalledWith(SESSION.db, IDENTITE, { node: "noeud-modele-relance", file: ID })
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("rapport.html")
    expect(screen.getByRole("note")).toHaveTextContent("Contenu interactif publié par Démo. N'y saisissez jamais de mot de passe.")
    expect(screen.getByRole("link", { name: "Ouvrir la page Modèle de relance" })).toHaveAttribute("href", "/n/ventes/modele_relance")
  })

  it.each([
    ["an unknown file", new PlatformError("not_found", "Unknown file."), "Fichier introuvable"],
    ["a .md that is not UTF-8", new PlatformError("invalid_arguments", "the file is not UTF-8; download it instead", { reason: "not_utf8" }), "Ce fichier n'est pas en UTF-8 : téléchargez-le."],
  ])("should say %s in the viewer's own sentence", async (_cas, refus, phrase) => {
    vi.mocked(fileView).mockRejectedValue(refus)
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    await monter(page({ view: ID }))
    expect(screen.getAllByText(phrase).length).toBeGreaterThan(0)
    expect(document.querySelector("iframe")).toBeNull()
  })

  it("should give a table no viewer: view is not read", async () => {
    vi.mocked(loadNode).mockResolvedValue(vueDuNoeud({ kind: "table", meta: {} }))
    await monter(page({ view: ID }))
    expect(fileView).not.toHaveBeenCalled()
  })
})

const VUE: PublicNodeView = {
  root: { path: "ventes/rapports", title: "Rapports" },
  includeChildren: false,
  node: { path: "ventes/rapports", title: "Rapports", summary: "Les rapports publics.", kind: "page", revision: 2, meta: {}, updatedAt: "2026-09-27T08:00:00.000Z" },
  blocks: [{ id: "b1", type: "file", position: 1, key: null, text: null, data: { file_id: ID, name: "devis.pdf", size: 10, mime: "application/pdf" } }],
  table: null,
  children: [],
  links: [],
  language: "fr",
}

describe("/p/<jeton>/<chemin>?view=<id> (AC-c5)", () => {
  const publique = (parametres: Record<string, string>) => PagePubliqueDuLien({ params: Promise.resolve({ jeton: JETON }), searchParams: Promise.resolve(parametres) })

  it("should read the blocks' files through the link's routes", async () => {
    vi.mocked(readPublicNode).mockResolvedValue(VUE)
    await monter(publique({}))
    expect(screen.getByRole("link", { name: "Voir devis.pdf (nouvel onglet)" })).toHaveAttribute("href", `/api/platform/public/${JETON}/files/${ID}?disposition=inline`)
    expect(publicFileView).not.toHaveBeenCalled()
  })

  it("should ask the link for the file of the content at the address, and show the viewer with the organisation's banner", async () => {
    vi.mocked(readPublicNode).mockResolvedValue(VUE)
    vi.mocked(publicFileView).mockResolvedValue({ id: ID, name: "rapport.html", size: 2_048, path: "ventes/rapports", type: "html" })
    await monter(publique({ view: ID }))
    expect(publicFileView).toHaveBeenCalledWith(HOTE, JETON, { path: "ventes/rapports", file: ID })
    expect(screen.getByRole("note")).toHaveTextContent("Contenu interactif publié par Démo. N'y saisissez jamais de mot de passe.")
    expect(screen.getByTitle("rapport.html")).toHaveAttribute("src", `/api/platform/public/${JETON}/files/${ID}/html`)
    expect(screen.getByRole("link", { name: "Ouvrir la page Rapports" })).toHaveAttribute("href", `/p/${JETON}`)
  })

  it("should say « Fichier introuvable » for a file the link does not serve", async () => {
    vi.mocked(readPublicNode).mockResolvedValue(VUE)
    vi.mocked(publicFileView).mockRejectedValue(new PlatformError("not_found", "Not found."))
    await monter(publique({ view: ID }))
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Fichier introuvable")
  })
})
