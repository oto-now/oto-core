import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { BlockView } from "@otomata_tech/oto_platform/schemas"
import { ContexteDeRafraichissement } from "@otomata_tech/oto_platform/ui"
import { EditeurDeBlocs } from "../../../packages/plateforme/ui/noeud/editeur/editeur-de-blocs"
import { FileDOperations } from "../../../packages/plateforme/ui/noeud/editeur/file-d-operations"
import { FICHIERS } from "../../../packages/plateforme/ui/noeud/libelles-des-fichiers"
import { RenduDUnBloc } from "../../../packages/plateforme/ui/noeud/rendu-des-blocs"
import { ouvrirLeChamp, texteDuBloc } from "../../helpers/champ-du-bloc"
import { bloc, simulerLAPI } from "../../helpers/noeud"

// Les retours sur l'éditeur et les blocs de la 1.1.1 (E11-S15, lot B) : le tableau simple, la carte d'un fichier, les
// proportions d'une image, le menu de la poignée, le texte marqué au repos et le correcteur du navigateur. L'éditeur sous
// sa file d'écriture (`fetch` simulé pour `POST /api/platform/nodes`) ; un bloc lu passe par `RenduDUnBloc`, comme à
// l'écran de lecture. Ce que la feuille de style en fait (teinte, bordures, hauteur) se contrôle à l'œil, dans les deux
// thèmes, à la campagne visuelle : jsdom ne calcule pas le rendu. Le clic et le menu contextuel d'un lien (AC-b9) sont
// dans `e11s06-editeur.test.tsx`.

const ID = {
  tableau: "e1150000-0000-4000-8000-000000000001",
  fichier: "e1150000-0000-4000-8000-000000000002",
  image: "e1150000-0000-4000-8000-000000000003",
  texte: "e1150000-0000-4000-8000-000000000004",
  objet: "e1150000-0000-4000-8000-000000000005",
  hostile: "e1150000-0000-4000-8000-000000000006",
} as const

const ID_FICHIER = "f1150000-0000-4000-8000-0000000000aa"

const TABLEAU = bloc(ID.tableau, "simple_table", null, { columns: ["Nom", "Montant"], rows: [["a", "1"]] })

const rafraichir = vi.fn()

function monter(blocs: BlockView[]) {
  render(
    <ContexteDeRafraichissement.Provider value={rafraichir}>
      <FileDOperations chemin="ventes/modele_relance" revisionPubliee={4} tampon={null}>
        <EditeurDeBlocs blocs={blocs} revisionServie={4} prefixeDesPages="/n/" />
      </FileDOperations>
    </ContexteDeRafraichissement.Provider>,
  )
}

/** Un bloc lu. Les routes d'un lien public : la carte d'un fichier ne relit pas sa disponibilité, qui demande une session. */
const lire = (un: BlockView) => render(<RenduDUnBloc bloc={un} Lien="a" hrefDuChemin={(chemin) => `/n/${chemin}`} routeDesFichiers="/api/platform/public/t/files" />)

/** Le curseur posé dans le champ, puis la touche relâchée, où React relit la sélection (`onSelect`). */
function placer(element: HTMLTextAreaElement, position: number) {
  element.setSelectionRange(position, position)
  fireEvent.keyUp(element, { key: "ArrowRight" })
}

function zone(element: HTMLElement): HTMLTextAreaElement {
  if (!(element instanceof HTMLTextAreaElement)) throw new Error("champ de texte attendu")
  return element
}

/** Le rendu au repos posé sur un champ, dans sa case. */
function renduDe(element: HTMLElement): HTMLElement {
  const rendu = element.parentElement?.querySelector(".oto-block-rendu")
  if (!(rendu instanceof HTMLElement)) throw new Error("rendu au repos absent")
  return rendu
}

beforeEach(() => {
  simulerLAPI()
  rafraichir.mockReset()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("E11-S15, lot B — tableau simple, fichier, image, menu de la poignée", () => {
  it("should mark the simple table, read and written, for its tinted header row and its cell fields bordered on hover or focus only (AC-b1)", () => {
    lire(TABLEAU)
    expect(screen.getByRole("table")).toHaveAttribute("data-simple")
    cleanup()
    monter([TABLEAU])
    const grille = screen.getByRole("table")
    expect(grille).toHaveAttribute("data-simple")
    expect(within(grille).getAllByRole("textbox")).toHaveLength(4)
  })

  // 1.1.5 : la colonne centrée du lecteur (`content.css`) exclut `data-reading="blocs"` ; le corps d'écriture garde sa pleine largeur.
  it("should mark the writing body apart from the centered reading column", () => {
    monter([TABLEAU])
    expect(screen.getByRole("table").closest(".oto-island-body")).toHaveAttribute("data-reading", "blocs")
  })

  it("should draw a joined file as the file row of the design system, name, size and actions kept (AC-b2)", () => {
    lire(bloc(ID.fichier, "file", null, { file_id: ID_FICHIER, name: "devis.pdf", size: 2048 }))
    const ligne = screen.getByText("devis.pdf").closest(".oto-file")
    if (!(ligne instanceof HTMLElement)) throw new Error("ligne du fichier absente")
    expect(within(ligne).getByRole("link", { name: FICHIERS.voirNom("devis.pdf") })).toBeInTheDocument()
    expect(within(ligne).getByRole("link", { name: FICHIERS.telechargerNom("devis.pdf") })).toBeInTheDocument()
  })

  it("should keep the proportions of an image at each width chosen, its height following its width (AC-b3)", () => {
    for (const largeur of ["small", "medium", "full"]) {
      lire(bloc(ID.image, "image", null, { src: "https://exemple.test/plan.png", alt: "Plan", width: largeur }))
      const image = screen.getByRole("img", { name: "Plan" })
      expect(image, largeur).toHaveClass("h-auto", "object-contain")
      expect(image, largeur).not.toHaveAttribute("height")
      cleanup()
    }
  })

  it("should open the menu of a table's handle as the handle menu, whose height follows its entries (AC-b5)", () => {
    monter([TABLEAU])
    fireEvent.click(screen.getByRole("button", { name: "Actions sur ce bloc — Nom Montant" }))
    const menu = screen.getByRole("menu")
    expect(menu).toHaveClass("oto-menu-de-poignee")
    expect(within(menu).getByRole("menuitem", { name: "Ajouter une rangée après" })).toBeInTheDocument()
  })
})

describe("E11-S15, lot B — texte en ligne au repos et correcteur", () => {
  it("should render at rest the marks of a text without a link, bold on a part of it, italic, code and strikethrough, and no HTML (AC-b6)", () => {
    const texte = "Un **gras** ici, *un* et _deux_, du `code` et ~~barré~~"
    monter([bloc(ID.texte, "paragraph", texte), bloc(ID.hostile, "paragraph", "Voir <img src=x onerror=alert(1)> **b**"), bloc(ID.objet, "paragraph", "Objet de la relance")])
    const champ = screen.getByRole("textbox", { name: /^Modifier ce texte — Un gras ici/ })
    // Le champ garde la source ; son rendu, posé dessus, la lit comme la lecture.
    expect(texteDuBloc(/^Modifier ce texte — Un gras ici/)).toBe(texte)
    expect(champ).toHaveAttribute("data-rendu")
    const rendu = renduDe(champ)
    expect(rendu).toHaveTextContent("Un gras ici, un et deux, du code et barré")
    expect(Array.from(rendu.querySelectorAll("strong, em, code, s"), (marque) => `${marque.tagName}:${marque.textContent}`)).toEqual([
      "STRONG:gras",
      "EM:un",
      "EM:deux",
      "CODE:code",
      "S:barré",
    ])
    // Du HTML écrit reste du texte, que React échappe.
    const hostile = renduDe(screen.getByRole("textbox", { name: /^Modifier ce texte — Voir/ }))
    expect(hostile.querySelector("img")).toBeNull()
    expect(hostile).toHaveTextContent("Voir <img src=x onerror=alert(1)> b")
    // Sans marque ni lien : aucun rendu, le champ se lit tel quel.
    const simple = screen.getByRole("textbox", { name: "Modifier ce texte — Objet de la relance" })
    expect(simple).not.toHaveAttribute("data-rendu")
    expect(simple.parentElement?.querySelector(".oto-block-rendu")).toBeNull()
  })

  it("should keep the browser's spell checker off a text that carries a link and off the fields of the « Lien » panel, on elsewhere (AC-b7)", () => {
    monter([bloc(ID.texte, "paragraph", "Voir [[prive/moi/taches|Mes tâches]] demain"), bloc(ID.objet, "paragraph", "Objet de la relance")])
    // Le correcteur ne relit qu'un champ monté (1.1.3) : chaque bloc s'ouvre avant d'être lu, l'autre se refermant.
    expect(ouvrirLeChamp("Modifier ce texte — Objet de la relance")).not.toHaveAttribute("spellcheck")
    const lie = ouvrirLeChamp("Modifier ce texte — Voir Mes tâches demain")
    expect(lie).toHaveAttribute("spellcheck", "false")
    act(() => lie.focus())
    placer(lie, 10)
    expect(screen.getByRole("textbox", { name: "Libellé" })).toHaveAttribute("spellcheck", "false")
    expect(screen.getByRole("textbox", { name: "Chercher une page" })).toHaveAttribute("spellcheck", "false")
  })
})

describe("E11-S15, lot B — adresse web coupée (AC-b10)", () => {
  it("should name and title a cut address as the browser follows it, never with its user name or password, the written address kept in href", () => {
    // Une adresse à mot de passe se construit à l'exécution (testing-strategy.md § Anti-patterns : check:public).
    const avecIdentifiants = `https://${["alice", "secret"].join(":")}@docs.exemple.fr/document/d/1AbCdEfGh/edit`
    const deguisee = "https://evil.example\\@good.example/chemin"
    lire(bloc(ID.texte, "paragraph", `Voir ${avecIdentifiants} et ${deguisee}`))
    const lien = screen.getByRole("link", { name: "https://docs.exemple.fr/document/d/1AbCdEfGh/edit" })
    expect(lien).toHaveTextContent("https://docs.exemple.fr/…bCdEfGh/edit")
    expect(lien).toHaveAttribute("title", "https://docs.exemple.fr/document/d/1AbCdEfGh/edit")
    expect(lien).toHaveAttribute("href", avecIdentifiants)
    // L'hôte montré, nommé et au survol est celui qu'ouvre le navigateur.
    const autre = screen.getByRole("link", { name: "https://evil.example/@good.example/chemin" })
    expect(autre).toHaveTextContent("https://evil.example/…ample/chemin")
    expect(autre).toHaveAttribute("title", "https://evil.example/@good.example/chemin")
  })
})

describe("E11-S15, lot B — « @ » avant toute frappe", () => {
  const RECENTS = [
    { path: "ventes/devis", kind: "page", title: "Devis", snippet: null },
    { path: "ventes/suivi", kind: "table", title: "Suivi des prospects", snippet: null },
  ]
  const TROUVES = [{ path: "ventes/grille_tarifaire", kind: "page", title: "Grille tarifaire", snippet: null }]
  const RECENTS_HORS_DE_LA_PAGE = "/api/platform/search/recent?exclude=ventes%2Fmodele_relance"
  const titresDesOptions = () => screen.queryAllByRole("option").map((option) => option.textContent)

  it("should list the recent contents as « @ » opens, choose one with the keyboard, and give way to the search at the first letter typed (AC-b4)", async () => {
    // Les lectures de « @ » simulées ; les écritures vont à la file simulée.
    const ecriture = simulerLAPI().fetchMock.getMockImplementation()
    const lectures: string[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (adresse, init) => {
        const url = String(adresse)
        if (!url.includes("/api/platform/search")) return ecriture ? ecriture(adresse, init) : new Response(null, { status: 500 })
        lectures.push(url)
        const data = url.includes("/search/recent") ? { matches: RECENTS } : { matches: TROUVES, more: 0 }
        return new Response(JSON.stringify({ data }), { status: 200, headers: { "content-type": "application/json" } })
      }),
    )
    monter([bloc(ID.texte, "paragraph", "Voir")])
    const texte = ouvrirLeChamp("Modifier ce texte — Voir")
    act(() => texte.focus())

    // « @ » seul : les récents, nommés, sans rien taper ; les flèches et Entrée les choisissent comme un trouvé.
    fireEvent.change(texte, { target: { value: "Voir @" } })
    await waitFor(() => expect(titresDesOptions()).toEqual(["Devisventes/devis", "Suivi des prospectsventes/suivi"]))
    expect(screen.getByText("Vos contenus récents. Tapez au moins deux lettres pour en chercher un autre.")).toBeInTheDocument()
    // La page qu'on édite ne se propose pas à elle-même.
    expect(lectures).toEqual([RECENTS_HORS_DE_LA_PAGE])
    fireEvent.keyDown(texte, { key: "ArrowDown" })
    expect(texte).toHaveAttribute("aria-activedescendant", screen.getAllByRole("option")[1].id)
    fireEvent.keyDown(texte, { key: "Enter" })
    const lie = zone(await screen.findByRole("textbox", { name: "Modifier ce texte — Voir Suivi des prospects" }))
    expect(lie).toHaveValue("Voir [[Suivi des prospects]]")
    expect(screen.queryByRole("listbox")).toBeNull()

    // Rouverte, la liste relit les récents ; une lettre les retire, deux lancent la recherche.
    fireEvent.change(lie, { target: { value: `${lie.value} @` } })
    await waitFor(() => expect(titresDesOptions()).toHaveLength(2))
    fireEvent.change(lie, { target: { value: `${lie.value}g` } })
    expect(titresDesOptions()).toEqual([])
    expect(screen.getByText("Tapez au moins deux lettres du contenu à citer.")).toBeInTheDocument()
    fireEvent.change(lie, { target: { value: `${lie.value}r` } })
    await waitFor(() => expect(titresDesOptions()).toEqual(["Grille tarifaireventes/grille_tarifaire"]))
    expect(lectures).toEqual([RECENTS_HORS_DE_LA_PAGE, RECENTS_HORS_DE_LA_PAGE, "/api/platform/search?q=gr"])
  })
})
