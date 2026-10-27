// E11-S15, lot A (retours sur la 1.1.1, écrans d'un contenu) : un test par critère, au minimum vital. Les écrans sont
// montés comme l'hôte les monte (lectures en `resultat`, lien de l'hôte) ; AC-a3 (zoom) ne se prouve pas sous jsdom,
// qui ne met rien en page : la structure dont dépend le centrage (en-tête et colonnes frères, document dans
// `TwoColumns main="document"`) a déjà son test (`ecran-de-noeud.test.tsx`, AC-e1), le reste se contrôle à l'œil dans
// les deux thèmes. AC-a6 : le texte change dans les tests qui le lisaient (`contexte.test.tsx`).
import type { ReactNode } from "react"
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import type { NodeView, TableHeader } from "@otomata_tech/oto_platform/schemas"
import { ContexteDeLHote, EcranDeNoeud } from "@otomata_tech/oto_platform/ui"
import { DepotSurLeTableau } from "../../../packages/plateforme/ui/coque/import-de-fichier"
import { ContexteServi } from "../../../packages/plateforme/ui/contexte/contexte-servi"
import { EcranDuContexte } from "../../../packages/plateforme/ui/contexte/ecran-du-contexte"
import { EXPLICATION_DU_CONTEXTE, NOMS_DES_BLOCS } from "../../../packages/plateforme/ui/contexte/libelles"
import { GuideDeBranchement } from "../../../packages/plateforme/ui/connexion/guide-de-branchement"
import { AccessPanel } from "../../../packages/plateforme/ui/ds/react/access-panel"
import { simulerLesDialogues } from "../../helpers/dialogue"
import { bloc, vueDuNoeud } from "../../helpers/noeud"

function LienDeTest({ children, ...props }: { href: string; className?: string; children: ReactNode }) {
  return <a {...props}>{children}</a>
}

beforeAll(() => {
  simulerLesDialogues()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function rendreLeNoeud(noeud: NodeView, props: { partage?: Parameters<typeof EcranDeNoeud>[0]["partage"]; complement?: ReactNode } = {}) {
  return render(
    <ContexteDeLHote.Provider value={{ Lien: "a", chemin: "", naviguer: vi.fn() }}>
      <EcranDeNoeud
        chemin={noeud.path}
        noeud={{ data: noeud }}
        arbre={{ data: { tree: [], truncated: false } }}
        equipes={{ data: [{ slug: "ventes", name: "Ventes" }] }}
        handle={null}
        nomOrganisation="Démo"
        versionPubliee={false}
        Lien={LienDeTest}
        hrefDuChemin={(chemin) => `/n/${chemin}`}
        prefixeDesPages="/n/"
        {...props}
      />
    </ContexteDeLHote.Provider>,
  )
}

describe("the « Contexte » view, index lists (E11-S15, AC-a1)", () => {
  const TETE = "## Context: everyone (contexte)\nOrganisation: Démo."
  const CORPS = "Nous vendons des logiciels."
  const SUITE = [CORPS, "", "Pages, tables and procedures here:", "- contexte/conseil — Conseil — Nos conseils.", "Linked pages:", "- support/faq — FAQ support — Réponses types."].join("\n")

  it("should put « Rangés sous ce contexte » and « Pages citées » each in an open encart of a Contexte screen, in the card of the part", () => {
    const text = `${TETE}\n${SUITE}`
    render(
      <ContexteServi
        donnees={{
          apercu: { data: { text, budget: 20_000, blocks: [{ name: "contexte", chars: text.length, status: "full", path: "contexte", head: TETE.length }] } },
          contextes: { contexte: { data: vueDuNoeud({ id: "n-contexte", path: "contexte", kind: "context", level: 3, blocks: [bloc("b2000000-0000-4000-8000-000000000002", "paragraph", CORPS)] }) } },
          equipes: [],
        }}
        Lien={LienDeTest}
        prefixeDesPages="/n/"
        ici="/context"
      />,
    )
    const partie = within(screen.getByRole("region", { name: "Contexte : Tout le monde" }))
    const carte = partie.getByRole("textbox", { name: `Modifier ce texte — ${CORPS}` }).closest(".oto-island")
    for (const titre of ["Rangés sous ce contexte", "Pages citées"]) {
      const encart = partie.getByRole("list", { name: titre }).closest("details")
      expect(encart).toHaveClass("oto-linked")
      expect(encart).toHaveAttribute("open")
      expect(encart?.querySelector("summary")?.textContent).toBe(titre)
      expect(encart?.closest(".oto-island")).toBe(carte)
    }
  })
})

describe("the encarts of a page (E11-S15, AC-a2)", () => {
  const LONG = "Un titre de sous-page assez long pour ne jamais tenir sur la ligne d'un encart de la colonne de droite"

  it("should show a line by its full name, cut on screen only, with no summary, a procedure included", () => {
    const enfant = { path: "ventes/modele_relance/long", title: LONG, summary: "Un résumé qui ne se montre plus.", kind: "procedure" as const, status: "published" as const }
    rendreLeNoeud(vueDuNoeud({ children: [enfant], childrenTotal: 1 }))
    const lien = within(screen.getByRole("list", { name: "Sous-pages" })).getByRole("link", { name: /^Un titre de sous-page/ })
    // Le nom entier reste le texte du lien (lecteur d'écran) et son `title` (survol) ; seule la vue le coupe.
    expect(within(lien).getByTitle(LONG)).toHaveTextContent(LONG)
    expect(lien.textContent).toBe(`${LONG}Procédure`)
    expect(screen.queryByText(/Un résumé qui ne se montre plus/)).toBeNull()
  })
})

describe("a cited Contexte, named as elsewhere on screen (E11-S15, AC-a9)", () => {
  const CONTEXTE = { kind: "context" as const, status: "published" as const, title: "Contexte", children: [] }
  const ARBRE = [
    { ...CONTEXTE, path: "contexte" },
    { path: "sav", title: "SAV", kind: "page" as const, status: "published" as const, children: [{ ...CONTEXTE, path: "sav/contexte" }] },
  ]
  const LIENS = {
    links_out: [
      { path: "contexte", title: "Contexte", status: "ok" },
      { path: "sav/contexte", title: "Contexte", status: "ok" },
    ],
    links_out_total: 2,
    links_in: [{ path: "sav/contexte", title: "Contexte" }],
    links_in_total: 1,
  }

  it("should name a link to a Contexte and its lines in the encarts by its section, a hand-written label kept", async () => {
    const texte = "Voir [[sav/contexte|Contexte]], [[contexte]] et [[sav/contexte|notre SAV]]."
    await act(async () => {
      render(
        <ContexteDeLHote.Provider value={{ Lien: "a", chemin: "", naviguer: vi.fn() }}>
          <EcranDeNoeud
            chemin="ventes/modele_relance"
            noeud={{ data: vueDuNoeud({ blocks: [bloc("b1590000-0000-4000-8000-000000000001", "paragraph", texte)] }) }}
            arbre={{ data: { tree: ARBRE, truncated: false } }}
            equipes={{ data: [{ slug: "sav", name: "SAV" }] }}
            handle={null}
            nomOrganisation="Démo"
            versionPubliee={false}
            Lien={LienDeTest}
            hrefDuChemin={(chemin) => `/n/${chemin}`}
            prefixeDesPages="/n/"
            liens={Promise.resolve({ data: LIENS })}
          />
        </ContexteDeLHote.Provider>,
      )
    })
    // Le lien au repos, après la lecture des liens sortants, qui ne servent que le titre enregistré.
    const phrase = await screen.findByText((_, element) => element?.tagName === "P" && element.textContent?.startsWith("Voir ") === true)
    expect(within(phrase).getAllByRole("link").map((lien) => [lien.textContent, lien.getAttribute("href")])).toEqual([
      ["Contexte · SAV", "/n/sav/contexte"],
      ["Contexte · Tout le monde", "/n/contexte"],
      ["notre SAV", "/n/sav/contexte"],
    ])
    // Les lignes des encarts.
    const cite = within(await screen.findByRole("list", { name: "Cite" }))
    expect(cite.getAllByRole("link").map((lien) => lien.textContent)).toEqual(["Contexte · Tout le monde", "Contexte · SAV"])
    expect(within(screen.getByRole("list", { name: "Cité dans" })).getByRole("link").textContent).toBe("Contexte · SAV")
  })
})

describe("« Partager », anchored to its button (E11-S15, AC-a4)", () => {
  /** Une fenêtre de 1 200 × 800 et un déclencheur en bas de l'en-tête ; la hauteur du panneau, réglée par le test. */
  function poserLaFenetre(hauteurDuPanneau: { valeur: number }) {
    vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(1_200)
    vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(800)
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
      return this.getAttribute("role") === "dialog" ? hauteurDuPanneau.valeur : 0
    })
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.getAttribute("role") === "dialog" ? 400 : 0
    })
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 800, y: 500, top: 500, left: 800, bottom: 530, right: 950, width: 150, height: 30, toJSON: () => ({}) })
    const observateurs: (() => void)[] = []
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(rappel: () => void) {
          observateurs.push(rappel)
        }
        observe() {}
        disconnect() {}
      },
    )
    return () => act(() => observateurs.forEach((rappel) => rappel()))
  }

  it("should place the panel again when its content grows after opening, on the side where it stays whole", () => {
    const hauteur = { valeur: 100 }
    const redimensionner = poserLaFenetre(hauteur)
    render(<AccessPanel scope="Partager · Ventes" panelLabel="Partager — Ventes" panel={<p>Le lien public se lit…</p>} />)
    fireEvent.click(screen.getByRole("button", { name: "Partager · Ventes" }))
    const panneau = screen.getByRole("dialog", { name: "Partager — Ventes" })
    // 264 px sous le bouton : le panneau de 100 px y tient.
    expect(panneau).toHaveAttribute("data-side", "bottom")
    // Le lien lu, le panneau fait 400 px : il ne tient plus dessous, il passe au-dessus, entier.
    hauteur.valeur = 400
    redimensionner()
    expect(panneau).toHaveAttribute("data-side", "top")
  })
})

describe("the connection guide (E11-S15, AC-a5)", () => {
  it("should mark its steps as separated from one another", () => {
    render(<GuideDeBranchement adresse={{ url: "https://acme.example.test/api/mcp", nom: "Acme", nomCli: "acme", phrase: "Commence par le contexte." }} exemples={{ data: [] }} connexions={{ data: [] }} />)
    const etapes = screen.getByRole("tabpanel").querySelector("ol")
    expect(etapes).toHaveClass("oto-etapes")
    expect(etapes?.children.length).toBeGreaterThan(1)
  })
})

describe("« Importer un fichier… » of a table (E11-S15, AC-a7)", () => {
  const ENTETE: TableHeader = { columns: [{ name: "entreprise", type: "text" }], key: "entreprise", closed: false, proof: false }

  it("should sit in the row of the header buttons, before « Réglages », and open the import into this table", () => {
    rendreLeNoeud(vueDuNoeud({ kind: "table", level: 2, blocks: [], meta: ENTETE, title: "Prospects" }), { complement: <p>La grille du tableau</p> })
    const importer = screen.getByRole("button", { name: "Importer un fichier…" })
    const reglages = screen.getByRole("button", { name: "Réglages" })
    expect(importer.closest(".oto-screen-header-access")).toBe(reglages.closest(".oto-screen-header-access"))
    expect(importer.compareDocumentPosition(reglages) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.click(importer)
    expect(screen.getByRole("dialog", { name: "Importer dans « Prospects »" })).toBeInTheDocument()
  })

  it("should keep the drop of a file on the table, without a button above it", () => {
    render(
      <DepotSurLeTableau chemin="ventes/prospects" titre="Prospects" entete={ENTETE}>
        <p>La grille du tableau</p>
      </DepotSurLeTableau>,
    )
    expect(screen.queryByRole("button", { name: "Importer un fichier…" })).toBeNull()
    const fichier = new File(["entreprise\nAtelier\n"], "prospects.csv", { type: "text/csv" })
    fireEvent.drop(screen.getByText("La grille du tableau"), { dataTransfer: { files: [fichier], types: ["Files"] } })
    expect(screen.getByRole("dialog", { name: "Importer dans « Prospects »" })).toBeInTheDocument()
  })
})

describe("the « Contexte » view explained (E11-S15, AC-a8)", () => {
  it("should say under its title what the context is, how it lives and its order, open", () => {
    render(<EcranDuContexte resultat={{ data: { apercu: { data: { text: "", budget: 35_000, blocks: [] } }, contextes: {}, equipes: [] } }} Lien={LienDeTest} prefixeDesPages="/n/" ici="/context" />)
    const aide = screen.getByRole("group", { name: "À quoi sert cette page" })
    expect(aide).toHaveAttribute("open")
    expect(screen.getByRole("heading", { level: 1, name: "Contexte" }).compareDocumentPosition(aide) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(aide).getByText(EXPLICATION_DU_CONTEXTE.ceQuEst)).toBeInTheDocument()
    expect(within(aide).getByText(EXPLICATION_DU_CONTEXTE.fonctionnement)).toBeInTheDocument()
    expect(within(aide).getAllByRole("listitem").map((etape) => etape.textContent)).toEqual([...EXPLICATION_DU_CONTEXTE.etapes])
  })

  // Le conteneur de `render` tient lieu de `.oto-content` : un de ses enfants directs est cadré par `.oto-content > *`,
  // dont la marge `auto` s'efface sous la marge propre d'un encart (`.oto-linked`) ; l'encart, dans la colonne de ses
  // voisins, en suit l'alignement et la largeur (`portage-ecrans.md § 0`).
  // Le bloc des contenus récents, seul servi : un aperçu sans bloc ne rend aucune partie.
  const RECENT = "## Recent content (new: published since 2026-10-20)\n- ventes/devis (page, 2026-10-26): Devis"
  it.each([
    ["the parts", { data: { apercu: { data: { text: RECENT, budget: 35_000, blocks: [{ name: "recent content", chars: RECENT.length, status: "full", path: null }] } }, contextes: {}, equipes: [] } }, () => screen.getByRole("region", { name: NOMS_DES_BLOCS["recent content"] })],
    ["the failure", { error: "Une erreur est survenue. Réessayez." }, () => screen.getByRole("alert")],
  ] as const)("should put the explanation in the column of %s, not beside it at the level of the screen", (_, resultat, voisin) => {
    const { container } = render(<EcranDuContexte resultat={resultat} Lien={LienDeTest} prefixeDesPages="/n/" ici="/context" />)
    const colonne = screen.getByRole("group", { name: "À quoi sert cette page" }).parentElement
    expect(colonne?.parentElement).toBe(container)
    expect(colonne).toContainElement(voisin())
  })
})
