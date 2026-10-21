import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { BlockView } from "@otomata_tech/oto_platform/schemas"
import { RenduDUnBloc } from "../../../packages/plateforme/ui/noeud/rendu-des-blocs"
import { ouvrirLeChamp } from "../../helpers/champ-du-bloc"
import { bloc, ID, monterLEditeur, simulerLAPI } from "../../helpers/noeud"

// Un bloc `mermaid` (1.1.3) à la lecture, par `RenduDUnBloc` : le texte rendu d'abord, puis le dessin de mermaid,
// chargé dans le navigateur ; un texte que mermaid ne lit pas garde son texte et le dit ; le thème suit `.dark`. Dans
// l'éditeur : la forme « Diagramme », son champ au dessin du code ; hors du focus, lu comme à la lecture (1.1.4).
// Mermaid est simulé : sous jsdom, sans mise en page SVG, le vrai met plus de 20 s à se charger et ne mesure rien. Il
// n'est résolu que depuis le paquet (pnpm) : le chemin simulé est le sien. L'assainissement du SVG (DOMPurify, mode
// `strict`) est celui de mermaid, non rejoué ici.

const mermaid = vi.hoisted(() => ({ initialize: vi.fn(), render: vi.fn() }))
vi.mock("mermaid", () => ({ default: mermaid }))

const LU = "0000000d-0000-4000-8000-000000000000"
const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><text>A</text></svg>'

/** jsdom n'a pas `getBBox` : sans lui le composant garde le texte, comme un navigateur sans mise en page SVG. */
function mesurer(): void {
  Object.defineProperty(SVGGraphicsElement.prototype, "getBBox", { configurable: true, value: () => ({ x: 0, y: 0, width: 40, height: 16 }) })
}

beforeEach(() => {
  mermaid.initialize.mockReset()
  mermaid.render.mockReset()
})

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(SVGGraphicsElement.prototype, "getBBox")
  document.documentElement.classList.remove("dark")
})

function lire(texte: string) {
  return render(<RenduDUnBloc bloc={bloc(LU, "mermaid", texte)} Lien="a" hrefDuChemin={(chemin) => `/n/${chemin}`} />)
}

describe("DiagrammeMermaid — a mermaid block at reading (1.1.3)", () => {
  it("should serve its text, legend and anchor, and load nothing without SVG layout", async () => {
    const { container } = lire("graph TD; A-->B")
    expect(screen.getByText("Diagramme (texte)")).toBeInTheDocument()
    expect(screen.getByText("graph TD; A-->B")).toBeInTheDocument()
    expect(container.querySelector(`[id="${LU.slice(0, 8)}"]`)).not.toBeNull()
    await act(async () => {})
    expect(mermaid.render).not.toHaveBeenCalled()
    expect(screen.queryByText("Diagramme invalide")).toBeNull()
  })

  it("should keep the text and say the diagram is invalid when mermaid cannot read it", async () => {
    mesurer()
    mermaid.render.mockRejectedValue(new Error("Parse error on line 1"))
    lire("ceci n'est pas un diagramme")
    expect(await screen.findByText("Diagramme invalide")).toBeInTheDocument()
    expect(screen.getByText("ceci n'est pas un diagramme")).toBeInTheDocument()
    expect(screen.queryByRole("img")).toBeNull()
    expect(mermaid.initialize).toHaveBeenCalledWith(expect.objectContaining({ startOnLoad: false, securityLevel: "strict", suppressErrorRendering: true }))
  })

  it("should draw a valid diagram, named by its title, with its text behind « Voir le code »", async () => {
    mesurer()
    mermaid.render.mockResolvedValue({ svg: SVG })
    lire("---\ntitle: Circuit des devis\n---\ngraph TD; A-->B")
    const dessin = await screen.findByRole("img", { name: "Diagramme : Circuit des devis" })
    expect(dessin.querySelector("svg")).not.toBeNull()
    expect(screen.getByText("Voir le code").closest("details")).toContainElement(screen.getByText("Diagramme (texte)"))
    expect(mermaid.render).toHaveBeenCalledWith(expect.stringMatching(/^mermaid-[\w-]+$/), "---\ntitle: Circuit des devis\n---\ngraph TD; A-->B")
  })

  it("should draw in the dark theme under .dark, and draw again when the mode changes", async () => {
    mesurer()
    mermaid.render.mockResolvedValue({ svg: SVG })
    document.documentElement.classList.add("dark")
    lire("graph TD; A-->B")
    await screen.findByRole("img", { name: "Diagramme : graph TD; A-->B" })
    expect(mermaid.initialize).toHaveBeenLastCalledWith(expect.objectContaining({ theme: "dark" }))
    document.documentElement.classList.remove("dark")
    await waitFor(() => expect(mermaid.initialize).toHaveBeenLastCalledWith(expect.objectContaining({ theme: "neutral" })))
    const [premier, second] = mermaid.render.mock.calls.map(([cible]) => cible)
    expect(second).not.toBe(premier)
  })
})

function editer(blocs: BlockView[]) {
  const api = simulerLAPI()
  monterLEditeur(blocs)
  return api
}

describe("DiagrammeMermaid — the « Diagramme » form of the editor (1.1.3, 1.1.4)", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("should read a diagram out of focus as at reading: the drawing, then « Voir le code » folded after it, without any field", async () => {
    mesurer()
    mermaid.render.mockResolvedValue({ svg: SVG })
    editer([bloc(ID.code, "mermaid", "graph TD; A-->B")])
    // 1.1.4 : un groupe nommé comme le champ, atteint au clavier ; ni zone de texte ni `<textarea>`.
    const lu = screen.getByRole("group", { name: "Modifier ce diagramme — graph TD; A-->B" })
    expect(lu).toHaveAttribute("tabindex", "0")
    const dessin = await within(lu).findByRole("img", { name: "Diagramme : graph TD; A-->B" })
    const voir = within(lu).getByText("Voir le code")
    expect(dessin.compareDocumentPosition(voir) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(voir.closest("details")).not.toHaveAttribute("open")
    expect(voir.closest("details")).toContainElement(within(lu).getByText("Diagramme (texte)"))
    expect(document.querySelector("textarea")).toBeNull()
    expect(screen.queryByRole("textbox")).toBeNull()
    // Sous la souris, le dessin reste : le survol ne monte pas le champ du diagramme.
    fireEvent(dessin, Object.assign(new MouseEvent("pointerover", { bubbles: true }), { pointerType: "mouse" }))
    expect(document.querySelector("textarea")).toBeNull()
  })

  it("should mount the code field, focused, when the drawing is clicked, send its text on blur and read it drawn again", async () => {
    mesurer()
    mermaid.render.mockResolvedValue({ svg: SVG })
    const api = editer([bloc(ID.code, "mermaid", "graph TD; A-->B")])
    const lu = screen.getByRole("group", { name: "Modifier ce diagramme — graph TD; A-->B" })
    const dessin = await within(lu).findByRole("img")
    // Un clic sur le dessin donne le focus au groupe, son plus proche ancêtre focalisable (jsdom ne le fait pas au clic).
    fireEvent.pointerDown(dessin)
    act(() => lu.focus())
    const champ = screen.getByRole("textbox", { name: "Modifier ce diagramme — graph TD; A-->B" })
    expect(champ).toBeInstanceOf(HTMLTextAreaElement)
    expect(champ).toHaveFocus()
    expect(champ).toHaveAttribute("data-kind", "code")
    // Pendant la frappe, ni dessin ni « Voir le code ».
    expect(screen.queryByRole("img")).toBeNull()
    expect(screen.queryByText("Voir le code")).toBeNull()
    fireEvent.change(champ, { target: { value: "graph LR; A-->C" } })
    act(() => screen.getByRole("button", { name: "Ailleurs" }).focus())
    await waitFor(() => expect(api.envoyes).toHaveLength(1))
    expect(api.envoyes[0].ops).toEqual([{ op: "replace_block", block: ID.code, revision: 3, input: { type: "mermaid", text: "graph LR; A-->C", data: {} } }])
    const relu = await screen.findByRole("group", { name: "Modifier ce diagramme — graph LR; A-->C" })
    await within(relu).findByRole("img", { name: "Diagramme : graph LR; A-->C" })
    expect(within(relu).getByText("Voir le code").closest("details")).not.toHaveAttribute("open")
    expect(screen.queryByRole("textbox")).toBeNull()
  })

  it("should unfold « Voir le code » without mounting the field", async () => {
    mesurer()
    mermaid.render.mockResolvedValue({ svg: SVG })
    editer([bloc(ID.code, "mermaid", "graph TD; A-->B")])
    const lu = screen.getByRole("group", { name: "Modifier ce diagramme — graph TD; A-->B" })
    const voir = await within(lu).findByText("Voir le code")
    act(() => voir.focus())
    fireEvent.click(voir)
    expect(voir.closest("details")).toHaveAttribute("open")
    expect(screen.queryByRole("textbox")).toBeNull()
    expect(within(lu).getByRole("img")).toBeInTheDocument()
  })

  it("should open the code field from the block above with ↓, and keep an invalid diagram's text and message at rest", async () => {
    mesurer()
    mermaid.render.mockRejectedValue(new Error("Parse error on line 1"))
    editer([bloc(ID.objet, "paragraph", "Objet"), bloc(ID.code, "mermaid", "pas un diagramme")])
    const lu = screen.getByRole("group", { name: "Modifier ce diagramme — pas un diagramme" })
    expect(await within(lu).findByText("Diagramme invalide")).toBeInTheDocument()
    expect(within(lu).getByText("pas un diagramme")).toBeInTheDocument()
    const objet = ouvrirLeChamp("Modifier ce texte — Objet")
    fireEvent.keyDown(objet, { key: "ArrowDown" })
    const champ = screen.getByRole("textbox", { name: "Modifier ce diagramme — pas un diagramme" })
    expect(champ).toBeInstanceOf(HTMLTextAreaElement)
    expect(champ).toHaveFocus()
  })

  it("should insert an empty « Diagramme » from the « + » without sending it nor drawing it, read at rest with its field", async () => {
    mesurer()
    const api = editer([bloc(ID.objet, "paragraph", "Objet de la relance")])
    fireEvent.click(screen.getByRole("button", { name: "Ajouter un bloc après — Objet de la relance" }))
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Diagramme" }))
    await screen.findByRole("textbox", { name: "Modifier ce diagramme — bloc vide" })
    act(() => screen.getByRole("button", { name: "Ailleurs" }).focus())
    // La sortie de la rangée se décide au tour suivant.
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))
    // Rien à dessiner : le bloc vide se relit en champ au repos (1.1.3), jamais en diagramme.
    expect(screen.getByRole("textbox", { name: "Modifier ce diagramme — bloc vide" })).toHaveAttribute("data-au-repos")
    expect(screen.queryByRole("group", { name: /Modifier ce diagramme/ })).toBeNull()
    expect(api.envoyes).toEqual([])
    expect(mermaid.render).not.toHaveBeenCalled()
    expect(screen.queryByText("Diagramme invalide")).toBeNull()
  })
})
