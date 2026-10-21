import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ouvrirLeChamp } from "../../helpers/champ-du-bloc"
import { bloc, ID, monterLEditeur, simulerLAPI } from "../../helpers/noeud"

// L'éditeur d'une page longue reste fluide (1.1.3) : un seul bloc monte son champ, celui qu'on touche, les autres se
// lisent (A et E) ; une frappe ne rend que sa rangée (C) ; les menus se construisent au geste qui les ouvre (D) ; la
// hauteur d'un champ ne se mesure que sans `field-sizing`, les champs montés ensemble à l'image suivante (A). Les rendus
// d'un champ et les constructions du menu « + » sont comptés par des enveloppes des vrais composants.

const suivi = vi.hoisted(() => ({ rendus: [] as string[], choix: 0 }))

vi.mock("../../../packages/plateforme/ui/noeud/editeur/champ-de-bloc", async (importOriginal) => {
  const { createElement } = await import("react")
  const original = await importOriginal<typeof import("../../../packages/plateforme/ui/noeud/editeur/champ-de-bloc")>()
  return {
    ...original,
    ChampDeBloc: (props: Parameters<typeof original.ChampDeBloc>[0]) => {
      suivi.rendus.push(props.nom)
      return createElement(original.ChampDeBloc, props)
    },
  }
})

vi.mock("../../../packages/plateforme/ui/noeud/editeur/choix-de-bloc", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../packages/plateforme/ui/noeud/editeur/choix-de-bloc")>()
  return {
    ...original,
    itemsDuChoix: (...parametres: Parameters<typeof original.itemsDuChoix>) => {
      suivi.choix += 1
      return original.itemsDuChoix(...parametres)
    },
  }
})

const TITRE = "Modifier ce titre — Objet"
const TEXTE = "Modifier ce texte — Objet de la relance"
const CODE = "Modifier ce code — select 1"
let api: ReturnType<typeof simulerLAPI>

const monter = monterLEditeur
const bouton = (nom: string) => screen.getByRole("button", { name: nom })
const champsMontes = () => document.querySelectorAll("textarea")
const leBloc = (nom: string) => screen.getByRole("textbox", { name: nom })

/** Le champ monté d'un bloc : son `<textarea>`. */
function champMonte(nom: string): HTMLTextAreaElement {
  const element = leBloc(nom)
  if (!(element instanceof HTMLTextAreaElement)) throw new Error(`champ monté « ${nom} » attendu`)
  return element
}

/** Un tour de boucle : la sortie d'une rangée se décide au tour suivant. */
const unTour = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))

/** L'image suivante : les champs montés en attente de leur hauteur y sont mesurés. */
const uneImage = () => act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))

/** La souris qui entre dans un élément, ou en sort vers `vers` : jsdom n'a pas de `PointerEvent`, le genre du pointeur est posé. */
function souris(element: Element, type: "pointerover" | "pointerout", vers: Element | null = null) {
  fireEvent(element, Object.assign(new MouseEvent(type, { bubbles: true, cancelable: true, relatedTarget: vers }), { pointerType: "mouse" }))
}

beforeEach(() => {
  api = simulerLAPI()
  suivi.rendus.length = 0
  suivi.choix = 0
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  Reflect.deleteProperty(document, "caretRangeFromPoint")
})

describe("EditeurDeBlocs, le seul bloc touché monte son champ (1.1.3)", () => {
  it("should mount the touched block's field, focused with the cursor at the end of its text, and read again the block it leaves", async () => {
    monter()
    const texte = ouvrirLeChamp(TEXTE)
    expect(document.activeElement).toBe(texte)
    expect(texte.selectionStart).toBe("Objet de la relance".length)
    const code = ouvrirLeChamp(CODE)
    expect(document.activeElement).toBe(code)
    await unTour()
    expect(champsMontes()).toHaveLength(1)
    expect(leBloc(TEXTE)).not.toBeInstanceOf(HTMLTextAreaElement)
  })

  it("should put the cursor on the character a finger touches in a read block", () => {
    monter()
    const lu = leBloc(TEXTE)
    const texteBrut = lu.firstChild
    // Le navigateur dit le caractère sous le doigt ; jsdom ne calcule pas le rendu.
    Object.defineProperty(document, "caretRangeFromPoint", { configurable: true, value: () => ({ startContainer: texteBrut, startOffset: 6 }) })
    fireEvent.pointerDown(lu)
    act(() => lu.focus())
    const champ = champMonte(TEXTE)
    expect(document.activeElement).toBe(champ)
    expect(champ.selectionStart).toBe(6)
  })

  it("should mount the field under the mouse without taking the focus, and read the block again when the mouse leaves", () => {
    monter()
    souris(leBloc(CODE), "pointerover")
    const monte = champMonte(CODE)
    expect(document.activeElement).toBe(document.body)
    souris(monte, "pointerout", document.body)
    expect(champsMontes()).toHaveLength(0)
  })

  it("should go to the previous block with ↑ at the start of a text, cursor at its end, and to the next one with ↓ at the end", () => {
    monter()
    const texte = ouvrirLeChamp(TEXTE)
    texte.setSelectionRange(0, 0)
    // Maj+↑ étend la sélection du texte : le focus reste.
    fireEvent.keyDown(texte, { key: "ArrowUp", shiftKey: true })
    expect(document.activeElement).toBe(texte)
    fireEvent.keyDown(texte, { key: "ArrowUp" })
    const titre = champMonte(TITRE)
    expect(document.activeElement).toBe(titre)
    expect(titre.selectionStart).toBe("Objet".length)
    fireEvent.keyDown(titre, { key: "ArrowDown" })
    const retour = champMonte(TEXTE)
    expect(document.activeElement).toBe(retour)
    expect(retour.selectionStart).toBe(0)
  })

  it.each<[string, number, "ArrowUp" | "ArrowDown", string]>([
    ["the cursor inside a text of several lines, ↑", 4, "ArrowUp", "Modifier ce texte — un deux"],
    ["the cursor inside a text of several lines, ↓", 2, "ArrowDown", "Modifier ce texte — un deux"],
    ["the first block, ↑ at its start", 0, "ArrowUp", "Modifier ce texte — début"],
    ["the last block, ↓ at its end", 3, "ArrowDown", "Modifier ce texte — fin"],
  ])("should keep the focus in the field with %s", (_cas, curseur, touche, nom) => {
    monter([bloc(ID.titre, "paragraph", "début"), bloc(ID.objet, "paragraph", "un\ndeux"), bloc(ID.code, "paragraph", "fin")])
    const champ = ouvrirLeChamp(nom)
    champ.setSelectionRange(curseur, curseur)
    fireEvent.keyDown(champ, { key: touche })
    expect(document.activeElement).toBe(champ)
    expect(champsMontes()).toHaveLength(1)
  })

  it("should send the text of a field left for its neighbour by ↓ at once, before its 1 200 ms delay, the field kept mounted until it loses the focus", () => {
    monter()
    const texte = ouvrirLeChamp(TEXTE)
    vi.useFakeTimers()
    fireEvent.change(texte, { target: { value: "Relance du devis" } })
    texte.setSelectionRange("Relance du devis".length, "Relance du devis".length)
    fireEvent.keyDown(texte, { key: "ArrowDown" })
    expect(document.activeElement).toBe(champMonte(CODE))
    expect(champsMontes()).toHaveLength(1)
    // La sortie du champ se décide au tour suivant : le texte part alors, bien avant les 1 200 ms sans frappe.
    act(() => vi.advanceTimersByTime(0))
    expect(api.envoyes.flatMap((corps) => corps.ops ?? [])).toContainEqual(expect.objectContaining({ op: "replace_block", block: ID.objet }))
  })

  it("should mount nothing under a finger passing over a block, and one field only under a mouse going from block to block", () => {
    monter()
    fireEvent(leBloc(TEXTE), Object.assign(new MouseEvent("pointerover", { bubbles: true }), { pointerType: "touch" }))
    expect(champsMontes()).toHaveLength(0)
    // La sortie du premier bloc n'est pas signalée (le champ monté sous le pointeur) : le suivant le démonte.
    souris(leBloc(TEXTE), "pointerover")
    souris(leBloc(CODE), "pointerover")
    expect(champsMontes()).toHaveLength(1)
    champMonte(CODE)
  })

  it("should follow a link of a read block, and open the « Lien » panel from its context menu, the field mounted behind it", async () => {
    const nom = "Modifier ce texte — Voir les tarifs demain"
    monter([bloc(ID.objet, "paragraph", "Voir [[ventes/tarifs|les tarifs]] demain")])
    const lien = screen.getByRole("link", { name: "les tarifs" })
    expect(lien).toHaveAttribute("href", "/n/ventes/tarifs")
    expect(champsMontes()).toHaveLength(0)
    fireEvent.contextMenu(lien)
    const libelle = await screen.findByRole("textbox", { name: "Libellé" })
    await waitFor(() => expect(document.activeElement).toBe(libelle))
    champMonte(nom)
    // Échap : le panneau se ferme et rend le focus au champ, resté monté.
    fireEvent.keyDown(libelle, { key: "Escape" })
    await waitFor(() => expect(document.activeElement).toBe(leBloc(nom)))
  })
})

describe("EditeurDeBlocs, une frappe ne rend que sa rangée (1.1.3)", () => {
  it("should render again only the field typed in, neither the others nor any field on a write of the queue", async () => {
    monter()
    const texte = ouvrirLeChamp(TEXTE)
    suivi.rendus.length = 0
    fireEvent.change(texte, { target: { value: "Objet de la relance !" } })
    fireEvent.change(texte, { target: { value: "Objet de la relance !!" } })
    expect(suivi.rendus.length).toBeGreaterThan(0)
    expect(suivi.rendus.filter((nom) => nom !== TEXTE)).toEqual([])
    // ⌘S : le texte part, la file s'occupe puis se libère ; aucun autre champ n'est rendu pour elle.
    suivi.rendus.length = 0
    fireEvent.keyDown(texte, { key: "s", metaKey: true })
    await waitFor(() => expect(api.envoyes).toHaveLength(1))
    await unTour()
    expect(suivi.rendus.filter((nom) => nom !== TEXTE)).toEqual([])
  })
})

describe("EditeurDeBlocs, menus construits à l'ouverture (1.1.3)", () => {
  it("should build the entries of a block's menus on the gesture that opens them, not with the page", () => {
    monter()
    expect(suivi.choix).toBe(0)
    fireEvent.click(bouton("Ajouter un bloc après — Objet de la relance"))
    expect(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Texte" })).toBeInTheDocument()
    expect(suivi.choix).toBeGreaterThan(0)
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" })
    expect(screen.queryByRole("menu")).toBeNull()
    // La poignée d'un autre bloc, ouverte au clavier : ses entrées sont là.
    fireEvent.keyDown(bouton("Actions sur ce bloc — select 1"), { key: "ArrowDown" })
    expect(within(screen.getByRole("menu")).getByRole("menuitem", { name: /Monter/ })).toBeInTheDocument()
  })
})

describe("ChampDeBloc, la hauteur du champ (1.1.3)", () => {
  it("should never measure a field where the browser sizes it by field-sizing", async () => {
    const lectures = vi.spyOn(Element.prototype, "scrollHeight", "get")
    vi.stubGlobal("CSS", { supports: (propriete: string, valeur: string) => propriete === "field-sizing" && valeur === "content" })
    monter()
    const texte = ouvrirLeChamp(TEXTE)
    await uneImage()
    fireEvent.change(texte, { target: { value: "Objet de la relance, relu" } })
    expect(lectures).not.toHaveBeenCalled()
  })

  it("should measure elsewhere the fields mounted together in one pass at the next frame, then the typed field alone at once", async () => {
    const lectures = vi.spyOn(Element.prototype, "scrollHeight", "get")
    const images = vi.spyOn(window, "requestAnimationFrame")
    vi.stubGlobal("CSS", { supports: () => false })
    monter()
    // Deux champs montés dans la même image : l'un sous la souris, l'autre ouvert ; aucune mesure au montage, une seule passe.
    souris(leBloc(CODE), "pointerover")
    const texte = ouvrirLeChamp(TEXTE)
    expect(lectures).not.toHaveBeenCalled()
    expect(images).toHaveBeenCalledTimes(1)
    await uneImage()
    expect(lectures).toHaveBeenCalled()
    const apresLaPasse = lectures.mock.calls.length
    fireEvent.change(texte, { target: { value: "Objet de la relance, relu" } })
    expect(lectures.mock.calls.length).toBeGreaterThan(apresLaPasse)
  })
})
