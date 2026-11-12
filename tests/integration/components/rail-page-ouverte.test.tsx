// Le rail déplié jusqu'à la page ouverte : sa section (repliée dans ce navigateur ou non) et ses ancêtres, à
// l'ouverture par l'adresse, au rechargement et à chaque navigation ; la ligne courante amenée en vue ; les plis
// faits à la main respectés ; un ancien chemin déplié à son chemin actuel ; le tiroir d'un écran étroit laissé
// fermé ; un titre long lisible en entier. L'hôte est simulé par ce qu'il prête (`ContexteDeLHote`).
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { TreeNode } from "@otomata_tech/oto_platform/schemas"
import { ContexteDeLHote, ContexteDeRafraichissement, CoquilleOto, RailApplication, type RailApplicationProps } from "@otomata_tech/oto_platform/ui"
import { NoeudOuvert } from "../../../packages/plateforme/ui/coque/noeud-ouvert"
import { simulerLesDialogues } from "../../helpers/dialogue"

const noeud = (path: string, kind: TreeNode["kind"], title: string, children: TreeNode[] = []): TreeNode => ({ path, kind, title, status: "published", children })

const TITRE_LONG = "Notes du salon Énergies locales de l'automne, stand et rendez-vous pris"

// Tout le monde (Conseil et sa grille), l'équipe Ventes (Salons et ses notes, au titre long), Privé (des notes).
const ARBRE: TreeNode[] = [
  noeud("guide", "page", "Guide de Démo", [
    noeud("contexte", "context", "Contexte de l'organisation"),
    noeud("conseil", "page", "Conseil", [noeud("conseil/grille", "table", "Grille tarifaire")]),
    noeud("private", "page", "Espaces personnels", [noeud("private/claire", "page", "Claire", [noeud("private/claire/notes", "page", "Brouillons")])]),
    noeud("ventes", "page", "Ventes", [noeud("ventes/contexte", "context", "Contexte"), noeud("ventes/salons", "page", "Salons", [noeud("ventes/salons/notes", "page", TITRE_LONG)])]),
  ]),
]

const PROPS: RailApplicationProps = {
  entreprise: { nom: "Démo", logo: null },
  arbre: { data: { tree: ARBRE, truncated: false } },
  equipes: { data: [{ slug: "ventes", name: "Ventes" }] },
  handle: "claire",
  compte: "Claire Morel",
  administre: false,
  adresses: { pages: "/n/", accueil: "/" },
}

/** Le rail à cette adresse et, à côté, la page ouverte qui annonce son chemin actuel (`ouvert`, sous un ancien chemin). */
function railA(chemin: string, ouvert: string | null = null) {
  return (
    <CoquilleOto pleinePage>
      <ContexteDeRafraichissement.Provider value={vi.fn()}>
        <ContexteDeLHote.Provider value={{ Lien: "a", chemin, naviguer: vi.fn() }}>
          <RailApplication {...PROPS} />
          {ouvert !== null && <NoeudOuvert chemin={ouvert} />}
        </ContexteDeLHote.Provider>
      </ContexteDeRafraichissement.Provider>
    </CoquilleOto>
  )
}

// `hidden` : le tiroir fermé d'un écran étroit est caché aux lecteurs d'écran, le test le lit quand même.
const rail = () => within(screen.getByRole("navigation", { hidden: true }))
const bouton = (name: string) => rail().getByRole("button", { name, hidden: true })
const lien = (name: string) => rail().getByRole("link", { name, hidden: true })
/** Les sections repliées dans ce navigateur (`use-rail-folds.ts`), une par ligne ; « org » : Tout le monde. */
const replier = (...sections: string[]) => window.localStorage.setItem("oto-rail-plis", sections.join("\n"))

beforeAll(simulerLesDialogues)

beforeEach(() => {
  window.localStorage.clear()
  // Les relectures de l'arbre par le rail échouent : l'arbre servi reste.
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code: "internal", message: "Internal error." } }), { status: 500, headers: { "content-type": "application/json" } })))
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("RailApplication, unfolded down to the open page", () => {
  it("should unfold the section kept folded by this browser and every ancestor of a page opened by its address, mark its line, and leave the other sections folded (AC1)", async () => {
    replier("org", "ventes", "private")
    render(railA("/n/ventes/salons/notes"))

    await waitFor(() => expect(bouton("Replier Ventes")).toHaveAttribute("aria-expanded", "true"))
    expect(bouton("Replier Salons")).toHaveAttribute("aria-expanded", "true")
    expect(lien(TITRE_LONG)).toHaveAttribute("aria-current", "page")
    expect(bouton("Déplier Tout le monde")).toHaveAttribute("aria-expanded", "false")
    expect(bouton("Déplier Privé")).toHaveAttribute("aria-expanded", "false")
    // Le pli rouvert est écrit : au rechargement, le rail se rend déjà déplié.
    expect(window.localStorage.getItem("oto-rail-plis")).toBe("org\nprivate")
  })

  it("should scroll the rail to the line of the open page once its folded section is unfolded (AC2)", async () => {
    replier("ventes")
    const boite = (haut: number, hauteur: number) =>
      // Une boîte simulée : jsdom ne calcule aucune mise en page, et `DOMRect` n'a pas de constructeur sous jsdom.
      ({ left: 0, top: haut, right: 200, bottom: haut + hauteur, width: 200, height: hauteur, x: 0, y: haut }) as DOMRect
    // La ligne courante sous le champ du rail (400 px de haut), mesurée seulement quand sa section est dépliée.
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      if (this.getAttribute("aria-current") !== "page") return boite(0, 400)
      return this.closest("[hidden]") ? boite(0, 0) : boite(600, 28)
    })
    render(railA("/n/ventes/salons/notes"))

    await waitFor(() => expect(document.querySelector(".oto-rail-scroll")?.scrollTop).toBe(236))
  })

  it("should unfold the section and the ancestors of a page reached by a navigation, keep what was unfolded by hand, and reopen a section folded by hand only for the page it carries (AC3, AC4)", async () => {
    const { rerender } = render(railA("/"))
    // À la main : Conseil déplié, Privé et Ventes repliés.
    fireEvent.click(bouton("Déplier Conseil"))
    fireEvent.click(bouton("Replier Privé"))
    fireEvent.click(bouton("Replier Ventes"))

    // Un lien d'une page, le retour arrière : l'hôte rend une autre adresse.
    rerender(railA("/n/ventes/salons/notes"))
    await waitFor(() => expect(bouton("Replier Ventes")).toHaveAttribute("aria-expanded", "true"))
    expect(bouton("Replier Salons")).toHaveAttribute("aria-expanded", "true")
    expect(lien(TITRE_LONG)).toHaveAttribute("aria-current", "page")
    expect(bouton("Replier Conseil")).toHaveAttribute("aria-expanded", "true")
    expect(bouton("Déplier Privé")).toHaveAttribute("aria-expanded", "false")

    // Repliée à la main sur la page ouverte, la section le reste tant que l'adresse ne change pas.
    fireEvent.click(bouton("Replier Ventes"))
    rerender(railA("/n/ventes/salons/notes"))
    expect(bouton("Déplier Ventes")).toHaveAttribute("aria-expanded", "false")

    // Une page d'une autre section ne la rouvre pas ; une page qu'elle porte, si.
    rerender(railA("/n/conseil/grille"))
    await waitFor(() => expect(lien("Grille tarifaire")).toHaveAttribute("aria-current", "page"))
    expect(bouton("Déplier Ventes")).toHaveAttribute("aria-expanded", "false")
    rerender(railA("/n/ventes/salons"))
    await waitFor(() => expect(bouton("Replier Ventes")).toHaveAttribute("aria-expanded", "true"))
  })

  it("should unfold the current path of a content opened by an old address: its section and its ancestors (AC5)", async () => {
    replier("org")
    // Déplacé de Ventes vers Conseil : l'adresse garde l'ancien chemin, la page annonce l'actuel.
    render(railA("/n/ventes/grille", "conseil/grille"))

    await waitFor(() => expect(lien("Grille tarifaire")).toHaveAttribute("aria-current", "page"))
    await waitFor(() => expect(bouton("Replier Tout le monde")).toHaveAttribute("aria-expanded", "true"))
    expect(bouton("Replier Conseil")).toHaveAttribute("aria-expanded", "true")
  })

  it("should leave the drawer of a narrow screen closed, its tree already unfolded for when it opens (AC6)", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: true, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
    replier("ventes")
    render(railA("/n/ventes/salons/notes"))

    await waitFor(() => expect(bouton("Replier Ventes")).toHaveAttribute("aria-expanded", "true"))
    expect(bouton("Replier Salons")).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByRole("button", { name: "Menu" })).toHaveAttribute("aria-expanded", "false")
    expect(screen.getByRole("navigation", { hidden: true })).not.toHaveAttribute("data-open")
  })

  it("should give the whole title of a line on hover, its text staying whole for a screen reader (AC7)", () => {
    render(railA("/n/ventes/salons/notes"))

    expect(lien(TITRE_LONG)).toHaveAttribute("title", TITRE_LONG)
  })
})
