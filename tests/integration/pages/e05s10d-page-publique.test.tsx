// La page publique d'un lien de partage, `/p/<jeton>` et `/p/<jeton>/<chemin>` (E05-S10, AC-d2 à AC-d6 ;
// ADR-013) : lue hors session par `readPublicNode` (simulé ici ; ses cas sur base réelle sont dans
// `e05s10e-partage-public.test.ts`), rendue en lecture seule au thème de l'organisation de l'adresse, les liens
// hors de portée en texte, le 404 indistinct, jamais indexée. E11-S05 (lot d, AC-f2) : le visiteur télécharge ce que
// la page a lu, sans requête ; le résumé ne se montre que pour une procédure.
import { headers } from "next/headers"
import { notFound } from "next/navigation"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { rowCells, toCsv, type PublicNodeView, type PublicTable } from "@otomata_tech/oto_platform/schemas"
import { PlatformError, readPublicNode } from "@otomata_tech/oto_platform/server"
import LienPublicIntrouvable from "@/app/p/[jeton]/[[...chemin]]/not-found"
import PagePubliqueDuLien, { generateMetadata } from "@/app/p/[jeton]/[[...chemin]]/page"
import { marqueDeLAdresse } from "@/lib/plateforme/marque-de-l-adresse"

vi.mock("next/headers", () => ({ headers: vi.fn() }))

// notFound() lève NEXT_NOT_FOUND dans Next : le mock lève aussi, le rendu s'arrête comme en production.
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND")
  }),
}))

vi.mock("@/lib/plateforme/marque-de-l-adresse", () => ({ marqueDeLAdresse: vi.fn() }))

vi.mock("@otomata_tech/oto_platform/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@otomata_tech/oto_platform/server")>()),
  readPublicNode: vi.fn(),
}))

const JETON = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde"
const HOTE = "demo.oto.test"

const VUE: PublicNodeView = {
  root: { path: "ventes/tarifs", title: "Tarifs 2026" },
  includeChildren: true,
  node: { path: "ventes/tarifs", title: "Tarifs 2026", summary: "Les prix publics de l'année.", kind: "page", revision: 3, meta: {}, updatedAt: "2026-09-27T08:00:00.000Z" },
  blocks: [
    { id: "b1", type: "heading", position: 1, key: "prix", text: "Prix", data: { level: 1 } },
    { id: "b2", type: "paragraph", position: 2, key: null, text: "Voir [[ventes/tarifs/remises|les remises]] et [[ventes/marges|nos marges]].", data: {} },
  ],
  table: null,
  children: [{ path: "ventes/tarifs/remises", title: "Remises", kind: "page" }],
  links: [{ path: "ventes/tarifs/remises", to: "ventes/tarifs/remises" }],
  language: "fr",
}

const params = (chemin?: string[]) => ({ params: Promise.resolve({ jeton: JETON, ...(chemin ? { chemin } : {}) }) })

beforeEach(() => {
  vi.mocked(headers).mockResolvedValue(new Headers({ host: HOTE }))
  vi.mocked(marqueDeLAdresse).mockResolvedValue({ theme: "ardoise", logo: null, nomAffiche: "Démo" })
  vi.mocked(readPublicNode).mockResolvedValue(VUE)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("/p/<jeton> public page (AC-d2, AC-d3, AC-d4)", () => {
  it("should show the published content read-only, in the organisation's theme, read by the token and the address alone", async () => {
    const { container } = render(await PagePubliqueDuLien(params()))

    expect(readPublicNode).toHaveBeenCalledWith(HOTE, JETON, null)
    expect(container.querySelector(".oto")).toHaveAttribute("data-oto-theme", "ardoise")
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Tarifs 2026")
    expect(screen.getByRole("heading", { level: 2, name: "Prix" })).toBeInTheDocument()
    // Lecture seule : aucun champ, aucun bouton d'écriture ; un bouton télécharge (E11-S05, AC-d2), le chevron d'un titre replie sa section.
    expect(screen.queryByRole("textbox")).toBeNull()
    expect(screen.getAllByRole("button").map((bouton) => bouton.textContent || bouton.getAttribute("aria-label"))).toEqual(["Télécharger en .md", "Replier la section — Prix"])
    // 1.4.12 : le document prend la pleine largeur de son îlot, comme dans l'éditeur, sans la colonne centrée de la lecture.
    expect(screen.getByRole("heading", { level: 2, name: "Prix" }).closest(".oto-island-body")).toHaveAttribute("data-reading", "blocs")
  })

  it("should open the sub-contents by the same token, and write a link outside the share as plain text", async () => {
    render(await PagePubliqueDuLien(params()))

    const dessous = within(screen.getByRole("navigation", { name: "Dessous" }))
    expect(dessous.getByRole("link", { name: "Remises" })).toHaveAttribute("href", `/p/${JETON}/ventes/tarifs/remises`)
    const paragraphe = screen.getByText(/^Voir/)
    expect(within(paragraphe).getByRole("link", { name: "les remises" })).toHaveAttribute("href", `/p/${JETON}/ventes/tarifs/remises`)
    expect(within(paragraphe).queryByRole("link", { name: "nos marges" })).toBeNull()
    expect(within(paragraphe).getByText("nos marges").closest("a")).toBeNull()
  })

  it("should read a sub-content by its path, with a way back to the shared content", async () => {
    vi.mocked(readPublicNode).mockResolvedValue({ ...VUE, node: { ...VUE.node, path: "ventes/tarifs/remises", title: "Remises" }, blocks: [], children: [], links: [] })
    render(await PagePubliqueDuLien(params(["ventes", "tarifs", "remises"])))

    expect(readPublicNode).toHaveBeenCalledWith(HOTE, JETON, "ventes/tarifs/remises")
    expect(screen.getByRole("link", { name: "Retour à Tarifs 2026" })).toHaveAttribute("href", `/p/${JETON}`)
    expect(screen.getByText("Cette page n'a pas encore de contenu.")).toBeInTheDocument()
  })
})

describe("/p/<jeton> refusals (AC-d5)", () => {
  it("should answer the same 404 for any link the service does not serve, saying nothing of which", async () => {
    vi.mocked(readPublicNode).mockRejectedValue(new PlatformError("not_found", "Not found."))
    await expect(PagePubliqueDuLien(params(["ventes", "secret"]))).rejects.toThrow("NEXT_NOT_FOUND")
    expect(notFound).toHaveBeenCalledTimes(1)

    render(await LienPublicIntrouvable())
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Page introuvable")
    expect(screen.getByText("Ce lien n'existe pas ou n'est plus actif.")).toBeInTheDocument()
    expect(await generateMetadata(params(["ventes", "secret"]))).toEqual({ title: "Page introuvable", robots: { index: false, follow: false } })
  })

  it("should title a breakdown by its sentence, not as a missing page", async () => {
    vi.mocked(readPublicNode).mockRejectedValue(new Error("connection refused 10.0.0.1"))
    vi.spyOn(console, "error").mockImplementation(() => {})
    expect(await generateMetadata(params())).toEqual({ title: "Cette page n'a pas pu être chargée", robots: { index: false, follow: false } })
  })

  it("should say a breakdown of the reading, without its technical message", async () => {
    vi.mocked(readPublicNode).mockRejectedValue(new Error("connection refused 10.0.0.1"))
    vi.spyOn(console, "error").mockImplementation(() => {})
    render(await PagePubliqueDuLien(params()))

    expect(screen.getByRole("alert")).toHaveTextContent("Une erreur est survenue. Réessayez.")
    expect(screen.getByRole("alert")).not.toHaveTextContent("10.0.0.1")
  })
})

describe("/p/<jeton> indexing (AC-d6)", () => {
  it("should title and describe the page by its content and keep it out of any index", async () => {
    expect(await generateMetadata(params())).toMatchObject({ title: "Tarifs 2026", description: "Les prix publics de l'année.", robots: { index: false, follow: false } })
  })

  // E11-S21 (AC-6) : l'aperçu d'un lien collé dans une messagerie, sous le même jeton et le même chemin.
  it("should give the link's preview its content, its organisation and its image keyed by revision", async () => {
    expect(await generateMetadata(params(["ventes", "tarifs"]))).toEqual({
      title: "Tarifs 2026",
      description: "Les prix publics de l'année.",
      robots: { index: false, follow: false },
      openGraph: {
        type: "article",
        siteName: "Démo",
        title: "Tarifs 2026",
        description: "Les prix publics de l'année.",
        url: `/p/${JETON}/ventes/tarifs`,
        images: [{ url: `/p/${JETON}/share-image/ventes/tarifs?v=3`, width: 1200, height: 630, alt: "Tarifs 2026 — Démo" }],
      },
      twitter: { card: "summary_large_image" },
    })
  })
})

// Les lignes d'un tableau (fiche D103) : `table` que le service sert (E01-S12 partie c), rendu en grille en lecture
// seule, sans tri, filtre ni geste.
describe("/p/<jeton> table rows (D103)", () => {
  const HOSTILE = '<img src=x onerror="alert(1)">'
  const TABLE: PublicTable = {
    columns: [
      { name: "ref", type: "text" },
      { name: "nom", type: "text" },
      { name: "montant", type: "number" },
      { name: "actif", type: "bool" },
      { name: "site", type: "url" },
    ],
    rows: [
      { key: "a-01", cells: { ref: null, nom: "Atelier Nord", montant: 1200, actif: true, site: "https://nord.example" } },
      { key: "a-02", cells: { ref: null, nom: HOSTILE, montant: null, actif: false, site: "javascript:alert(1)" } },
    ],
    truncated: false,
  }
  const TABLEAU: PublicNodeView = {
    ...VUE,
    node: { ...VUE.node, title: "Clients", summary: "", kind: "table", meta: { key: "ref", columns: [] } },
    blocks: [{ id: "r1", type: "row", position: 1, key: "a-01", text: "", data: { nom: "brut" } }],
    children: [],
    links: [],
    table: TABLE,
  }

  it("should show the columns and the rows, each value in the format of its type, read-only", async () => {
    vi.mocked(readPublicNode).mockResolvedValue(TABLEAU)
    render(await PagePubliqueDuLien(params()))

    const grille = screen.getByRole("table", { name: "Lignes de Clients" })
    expect(within(grille).getAllByRole("columnheader").map((entete) => entete.textContent)).toEqual(["ref", "nom", "montant", "actif", "site"])
    const [premiere, seconde] = within(grille).getAllByRole("row").slice(1)
    expect(within(premiere).getByRole("rowheader")).toHaveTextContent("a-01")
    expect(within(premiere).getAllByRole("cell").map((cellule) => cellule.textContent)).toEqual(["Atelier Nord", "1\u202f200", "Oui", "https://nord.example"])
    expect(within(premiere).getByRole("link", { name: "https://nord.example" })).toHaveAttribute("href", "https://nord.example")
    expect(within(seconde).getAllByRole("cell").map((cellule) => cellule.textContent)).toEqual([HOSTILE, "\u2014", "Non", "javascript:alert(1)"])
    // Les lignes ne passent plus par les blocs, et la phrase qui les disait absentes est partie.
    expect(screen.queryByText("brut")).toBeNull()
    expect(screen.queryByText(/ne s'affichent pas/)).toBeNull()
    expect(screen.queryByText(/500 premières lignes/)).toBeNull()
    expect(screen.getAllByRole("button").map((bouton) => bouton.textContent)).toEqual(["Télécharger en .csv"])
    expect(screen.queryByRole("textbox")).toBeNull()
  })

  it("should render a hostile text value as text, never as markup or a link", async () => {
    vi.mocked(readPublicNode).mockResolvedValue(TABLEAU)
    const { container } = render(await PagePubliqueDuLien(params()))

    expect(screen.getByText(HOSTILE)).toBeInTheDocument()
    expect(container.querySelector("img")).toBeNull()
    expect(screen.queryByRole("link", { name: "javascript:alert(1)" })).toBeNull()
  })

  it("should say when only the first 500 rows are shown, in the page and on its download (E11-S05, AC-d1)", async () => {
    vi.mocked(readPublicNode).mockResolvedValue({ ...TABLEAU, table: { ...TABLE, truncated: true } })
    render(await PagePubliqueDuLien(params()))

    expect(screen.getByText("Les 500 premières lignes, dans l'ordre de leur clé.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Télécharger en .csv (500 premières lignes)" })).toBeInTheDocument()
  })

  it("should render no grid for a content that is not a table", async () => {
    vi.mocked(readPublicNode).mockResolvedValue({ ...VUE, table: null })
    render(await PagePubliqueDuLien(params()))

    expect(screen.queryByRole("table")).toBeNull()
    expect(screen.getByText(/^Voir/)).toBeInTheDocument()
  })
})

// E11-S05 (lot d ; HN-E11S05-10, HN-E11S05-11) : le fichier se bâtit dans le navigateur à partir de la vue lue.
describe("/p/<jeton> download (E11-S05, AC-d1 to AC-d4, AC-f2)", () => {
  /** Le fichier que la page donne : son nom, et ses octets lus sans décodage (le BOM compris). */
  async function telecharge(): Promise<{ nom: string; octets: Uint8Array; texte: string; type: string }> {
    const blobs: Blob[] = []
    const noms: string[] = []
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn((blob: Blob) => (blobs.push(blob), "blob:fichier")), revokeObjectURL: vi.fn() }))
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      noms.push(this.download)
    })
    const requetes = vi.fn()
    vi.stubGlobal("fetch", requetes)
    fireEvent.click(screen.getByRole("button", { name: /^Télécharger en/ }))
    // Aucune requête au clic (AC-d3) : le fichier vient de la vue déjà lue.
    expect(requetes).not.toHaveBeenCalled()
    const [blob] = blobs
    const octets = new Uint8Array(
      await new Promise<ArrayBuffer>((resolve) => {
        const lecteur = new FileReader()
        lecteur.onload = () => resolve(lecteur.result as ArrayBuffer)
        lecteur.readAsArrayBuffer(blob)
      }),
    )
    return { nom: noms[0], octets, texte: new TextDecoder("utf-8", { ignoreBOM: true }).decode(octets), type: blob.type }
  }

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const TABLE: PublicTable = {
    columns: [
      { name: "ref", type: "text" },
      { name: "nom", type: "text" },
      { name: "montant", type: "number" },
    ],
    rows: [
      { key: "a-01", cells: { nom: "=SOMME(A1)", montant: 12.5 } },
      { key: "a-02", cells: { nom: "Atelier Sud", montant: null } },
    ],
    truncated: false,
  }
  const TABLEAU: PublicNodeView = { ...VUE, node: { ...VUE.node, path: "ventes/clients", title: "Clients", kind: "table", meta: { key: "ref" } }, blocks: [], children: [], links: [], table: TABLE }

  it("should give the loaded rows as a .csv in the organisation's language, formulas neutralised, without a request (AC-d1, AC-d3, AC-d4)", async () => {
    vi.mocked(readPublicNode).mockResolvedValue(TABLEAU)
    render(await PagePubliqueDuLien(params()))
    const fichier = await telecharge()

    expect(fichier.nom).toBe("clients.csv")
    expect(fichier.type).toBe("text/csv;charset=utf-8")
    expect([...fichier.octets.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    expect(fichier.texte).toBe("\uFEFFref;nom;montant\r\na-01;'=SOMME(A1);12,5\r\na-02;Atelier Sud;\r\n")
  })

  it("should write a number key as the connected export does, never as a guarded text (AC-d1, portage-ecrans.md § 6)", async () => {
    const colonnes = [
      { name: "num", type: "number" },
      { name: "montant", type: "number" },
    ]
    const lignes = [
      { key: "-3", data: { montant: 1.5 } },
      { key: "1.5", data: {} },
    ]
    vi.mocked(readPublicNode).mockResolvedValue({
      ...TABLEAU,
      node: { ...TABLEAU.node, meta: { key: "num" } },
      table: { columns: colonnes, rows: lignes.map((ligne) => ({ key: ligne.key, cells: ligne.data })), truncated: false },
    })
    render(await PagePubliqueDuLien(params()))
    const fichier = await telecharge()

    // Ce que compose l'export connecté (`server/tables/export.ts`, `rowCells` puis `toCsv`) pour les mêmes lignes.
    const connecte = toCsv(colonnes, lignes.map((ligne) => rowCells(ligne, { columns: colonnes, key: "num" })), "fr")
    expect(fichier.texte).toBe(connecte)
    expect(fichier.texte).toBe("﻿num;montant\r\n-3;1,5\r\n1,5;\r\n")
  })

  it("should give a page as a .md made of its title and its public blocks only (AC-d2, AC-d4)", async () => {
    render(await PagePubliqueDuLien(params()))
    const fichier = await telecharge()

    expect(fichier.nom).toBe("tarifs.md")
    expect(fichier.texte).toBe("# Tarifs 2026\n\n## Prix\n\nVoir [[ventes/tarifs/remises|les remises]] et [[ventes/marges|nos marges]].\n")
    // Rien que ce que la vue sert déjà (canal « ouvert, déjà ouvert ») : ni résumé, ni référence de bloc.
    expect(fichier.texte).not.toContain(VUE.node.summary)
    expect(fichier.texte).not.toContain("ref:")
  })

  it("should show the summary of a procedure only (AC-f2)", async () => {
    render(await PagePubliqueDuLien(params()))
    expect(screen.queryByText("Les prix publics de l'année.")).toBeNull()
    cleanup()

    vi.mocked(readPublicNode).mockResolvedValue({ ...VUE, node: { ...VUE.node, kind: "procedure", summary: "Relancer un devis resté sans réponse." } })
    render(await PagePubliqueDuLien(params()))
    expect(screen.getByText("Relancer un devis resté sans réponse.")).toBeInTheDocument()
  })
})
