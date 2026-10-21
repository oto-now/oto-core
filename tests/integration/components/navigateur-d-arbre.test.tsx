import type { ReactNode } from "react"
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react"
import { describe, it, expect, afterEach } from "vitest"
import { NavigateurDArbre, NavigateurDArbreChargement, type NoeudDArbre } from "@otomata_tech/oto_platform/ui"

afterEach(cleanup)

// Les nœuds de l'ancien `arbreDExemple` (E05-S01), retiré du paquet par E05-S02 (P16) : fixture du test.
const arbreDExemple: NoeudDArbre[] = [
  {
    chemin: "organisation",
    titre: "Organisation",
    nature: "page",
    enfants: [
      { chemin: "organisation/guide", titre: "Guide de l'entreprise", nature: "page" },
      { chemin: "organisation/clients", titre: "Clients", nature: "tableau" },
    ],
  },
  {
    chemin: "ventes",
    titre: "Ventes",
    nature: "page",
    enfants: [
      { chemin: "ventes/relance-des-devis", titre: "Relance des devis", nature: "procedure" },
      { chemin: "ventes/devis", titre: "Devis", nature: "tableau" },
      {
        chemin: "ventes/modeles",
        titre: "Modèles d'emails",
        nature: "page",
        enfants: [{ chemin: "ventes/modeles/premiere-relance", titre: "Première relance", nature: "page" }],
      },
    ],
  },
]

// Le lien d'un hôte quelconque : marqué pour prouver que l'écran rend CE composant, pas une ancre à lui.
function LienDeTest({ children, ...props }: { href: string; className?: string; "aria-current"?: "page"; children: ReactNode }) {
  return (
    <a data-lien-hote="" {...props}>
      {children}
    </a>
  )
}

const hrefDuNoeud = (n: NoeudDArbre) => `/hote/${n.chemin}`

function rendre(resultat: Parameters<typeof NavigateurDArbre>[0]["resultat"], cheminActif?: string) {
  return render(
    <NavigateurDArbre resultat={resultat} hrefDuNoeud={hrefDuNoeud} Lien={LienDeTest} cheminActif={cheminActif} />,
  )
}

describe("NavigateurDArbre", () => {
  // `hidden: true` : les sous-arbres repliés sont dans le DOM, mais hors de l'arbre d'accessibilité.
  it("should render every node with the host link component and the host href", () => {
    rendre({ data: arbreDExemple })
    const lien = screen.getByRole("link", { name: "Relance des devis", hidden: true })
    expect(lien).toHaveAttribute("href", "/hote/ventes/relance-des-devis")
    expect(lien).toHaveAttribute("data-lien-hote")
    expect(screen.getAllByRole("link", { hidden: true })).toHaveLength(8)
  })

  it("should mark the active node and expand its ancestors", () => {
    rendre({ data: arbreDExemple }, "ventes/modeles/premiere-relance")
    expect(screen.getByRole("link", { name: "Première relance" })).toHaveAttribute("aria-current", "page")
    expect(screen.getByRole("button", { name: "Replier Ventes" })).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByRole("button", { name: "Replier Modèles d'emails" })).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByRole("button", { name: "Déplier Organisation" })).toHaveAttribute("aria-expanded", "false")
  })

  it("should keep a collapsed subtree in the DOM, hidden, and toggle it", () => {
    rendre({ data: arbreDExemple })
    const bascule = screen.getByRole("button", { name: "Déplier Organisation" })
    const sousArbre = document.getElementById(bascule.getAttribute("aria-controls") ?? "")
    expect(sousArbre).toHaveAttribute("hidden")
    fireEvent.click(bascule)
    expect(bascule).toHaveAttribute("aria-expanded", "true")
    expect(bascule).toHaveAccessibleName("Replier Organisation")
    expect(sousArbre).not.toHaveAttribute("hidden")
  })

  it("should put the toggle beside the link, never inside it", () => {
    rendre({ data: arbreDExemple })
    for (const lien of screen.getAllByRole("link", { hidden: true })) {
      expect(within(lien).queryByRole("button")).toBeNull()
    }
  })

  it("should render the empty state without a navigation list", () => {
    rendre({ data: [] })
    expect(screen.getByText(/L'arbre est vide/)).toBeInTheDocument()
    expect(screen.queryByRole("navigation")).toBeNull()
  })

  it("should announce the error message", () => {
    rendre({ error: "Impossible de charger l'arbre." })
    expect(screen.getByRole("alert")).toHaveTextContent("Impossible de charger l'arbre.")
    expect(screen.queryByRole("navigation")).toBeNull()
  })
})

describe("NavigateurDArbre sections (E05-S02, AC1)", () => {
  it("should title each section in text inside one nav, and mark a Contexte by its nature", () => {
    const contexte: NoeudDArbre = { chemin: "ventes/contexte", titre: "Contexte", nature: "contexte" }
    const sections = [
      { titre: "Tout le monde", noeuds: [{ chemin: "contexte", titre: "Contexte", nature: "contexte" as const }] },
      { titre: "Ventes", noeuds: [contexte, { chemin: "ventes/devis", titre: "Devis", nature: "tableau" as const }] },
    ]
    render(<NavigateurDArbre resultat={{ data: [] }} sections={sections} hrefDuNoeud={hrefDuNoeud} Lien={LienDeTest} />)

    const navigation = screen.getByRole("navigation", { name: "Arbre des connaissances" })
    expect(screen.getAllByRole("navigation")).toHaveLength(1)
    expect(within(navigation).getByRole("list", { name: "Ventes" })).toBeInTheDocument()
    expect(within(navigation).getByText("Tout le monde").closest("a")).toBeNull()
    expect(within(navigation).getAllByRole("link").map((lien) => lien.getAttribute("href"))).toEqual(["/hote/contexte", "/hote/ventes/contexte", "/hote/ventes/devis"])
    // Chaque nature a son glyphe : un Contexte en a un, décoratif (`aria-hidden`).
    expect(within(navigation).getAllByRole("link", { name: "Contexte" })[1].querySelector("svg")).toHaveAttribute("aria-hidden", "true")
  })
})

describe("NavigateurDArbreChargement", () => {
  it("should expose a busy status with a readable label", () => {
    render(<NavigateurDArbreChargement />)
    const statut = screen.getByRole("status")
    expect(statut).toHaveAttribute("aria-busy", "true")
    expect(statut).toHaveTextContent("Chargement de l'arbre…")
  })
})
