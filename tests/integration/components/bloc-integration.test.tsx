import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { BlockView } from "@otomata_tech/oto_platform/schemas"
import { ContexteDeRafraichissement } from "@otomata_tech/oto_platform/ui"
import { EditeurDeBlocs } from "../../../packages/plateforme/ui/noeud/editeur/editeur-de-blocs"
import { FileDOperations } from "../../../packages/plateforme/ui/noeud/editeur/file-d-operations"
import { INTEGRATION } from "../../../packages/plateforme/ui/noeud/libelles"
import { RenduDUnBloc } from "../../../packages/plateforme/ui/noeud/rendu-des-blocs"
import { simulerLesDialogues } from "../../helpers/dialogue"
import { bloc, ID, PAGE, simulerLAPI } from "../../helpers/noeud"

// Le bloc « Intégration » (1.4.3) : lu, un cadre isolé (`sandbox`) à la hauteur du bloc, avec le lien qui ouvre la page ;
// édité, l'entrée « Intégration » du « + » et de « / », le dialogue de l'adresse contrôlée comme la base, le cadre écrit
// tout de suite, puis sa hauteur et son adresse changées par le menu de sa poignée.

const rafraichir = vi.fn()
let api: ReturnType<typeof simulerLAPI>

function monter(blocs: BlockView[] = PAGE) {
  render(
    <ContexteDeRafraichissement.Provider value={rafraichir}>
      <FileDOperations chemin="ventes/modele_relance" revisionPubliee={4} tampon={null}>
        <EditeurDeBlocs blocs={blocs} revisionServie={4} prefixeDesPages="/n/" />
      </FileDOperations>
    </ContexteDeRafraichissement.Provider>,
  )
}

const ADRESSE = "https://www.youtube.com/embed/abc"

beforeAll(() => simulerLesDialogues())

beforeEach(() => {
  api = simulerLAPI()
  rafraichir.mockReset()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("RenduDUnBloc — an embed (1.4.3)", () => {
  it("should show the page of another site in an isolated frame at the height of the block, with a link that opens it", async () => {
    render(<RenduDUnBloc bloc={{ type: "embed", text: null, data: { url: ADRESSE, height: "large" } }} Lien="a" hrefDuChemin={(chemin) => `/n/${chemin}`} />)
    const cadre = await screen.findByTitle("Contenu intégré de youtube.com")
    expect(cadre.getAttribute("src")).toBe(ADRESSE)
    expect(cadre.getAttribute("sandbox")?.split(" ")).toEqual(expect.arrayContaining(["allow-scripts", "allow-same-origin"]))
    expect(cadre.closest("figure")).toHaveAttribute("data-height", "large")
    expect(screen.getByRole("link", { name: "Ouvrir youtube.com dans un nouvel onglet" })).toHaveAttribute("rel", "noopener noreferrer")
  })

  it("should mount no frame for an address that is not https", () => {
    render(<RenduDUnBloc bloc={{ type: "embed", text: null, data: { url: "javascript:alert(1)" } }} Lien="a" hrefDuChemin={(chemin) => `/n/${chemin}`} />)
    expect(document.querySelector("iframe")).toBeNull()
    expect(screen.getByText(INTEGRATION.invalide)).toBeInTheDocument()
  })
})

describe("EditeurDeBlocs — an embed (1.4.3)", () => {
  it("should offer « Intégration » at the end of the « + », refuse an address that is not https, and write the frame at once after the block", async () => {
    monter()
    fireEvent.click(screen.getByRole("button", { name: "Ajouter un bloc après — Objet de la relance" }))
    const menu = within(screen.getByRole("menu"))
    expect(menu.getAllByRole("menuitem").at(-1)).toHaveTextContent(INTEGRATION.entree)
    fireEvent.click(menu.getByRole("menuitem", { name: INTEGRATION.entree }))
    const dialogue = screen.getByRole("dialog", { name: INTEGRATION.dialogue })
    const champ = within(dialogue).getByLabelText(INTEGRATION.adresse)
    fireEvent.change(champ, { target: { value: "http://exemple.test/a" } })
    fireEvent.click(within(dialogue).getByRole("button", { name: INTEGRATION.valider }))
    expect(within(dialogue).getByText(INTEGRATION.invalide)).toBeInTheDocument()
    fireEvent.change(champ, { target: { value: ` ${ADRESSE} ` } })
    fireEvent.click(within(dialogue).getByRole("button", { name: INTEGRATION.valider }))
    await waitFor(() => expect(api.envoyes).toHaveLength(1))
    expect(api.envoyes[0].ops).toEqual([{ op: "insert_after", block: ID.objet, input: { type: "embed", data: { url: ADRESSE } } }])
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("should offer « Intégration » in the list of « / » too, the Texte emptied of its slash", async () => {
    monter()
    fireEvent.click(screen.getByRole("button", { name: "Ajouter un bloc après — Objet de la relance" }))
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Texte" }))
    const texte = screen.getByRole("textbox", { name: "Modifier ce texte — bloc vide" })
    await waitFor(() => expect(document.activeElement).toBe(texte))
    fireEvent.change(texte, { target: { value: "/" } })
    fireEvent.change(texte, { target: { value: "/integ" } })
    expect(within(screen.getByRole("listbox", { name: "Blocs à insérer" })).getAllByRole("option").map((option) => option.textContent)).toEqual([INTEGRATION.entree])
    fireEvent.keyDown(texte, { key: "Enter" })
    expect(screen.getByRole("dialog", { name: INTEGRATION.dialogue })).toBeInTheDocument()
    expect(texte).toHaveValue("")
  })

  it("should change the height of a frame and its address from the menu of its handle", async () => {
    const cadre = bloc("e1000000-0000-4000-8000-000000000001", "embed", null, { url: ADRESSE })
    monter([...PAGE, cadre])
    const mots = `${INTEGRATION.entree} ${ADRESSE}`
    fireEvent.click(screen.getByRole("button", { name: `Actions sur ce bloc — ${mots}` }))
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitemradio", { name: INTEGRATION.hauteurs.large }))
    // La hauteur part comme un texte tapé, après le différé de 1 200 ms.
    await waitFor(() => expect(api.envoyes).toHaveLength(1), { timeout: 3_000 })
    expect(api.envoyes[0].ops).toEqual([{ op: "replace_block", block: cadre.id, revision: 3, input: { type: "embed", data: { url: ADRESSE, height: "large" } } }])
    fireEvent.click(screen.getByRole("button", { name: `Actions sur ce bloc — ${mots}` }))
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: INTEGRATION.modifier }))
    const dialogue = screen.getByRole("dialog", { name: INTEGRATION.modifier })
    const champ = within(dialogue).getByLabelText(INTEGRATION.adresse)
    expect(champ).toHaveValue(ADRESSE)
    act(() => {
      fireEvent.change(champ, { target: { value: "https://www.youtube.com/embed/xyz" } })
      fireEvent.click(within(dialogue).getByRole("button", { name: INTEGRATION.modifier }))
    })
    await waitFor(() => expect(api.envoyes).toHaveLength(2), { timeout: 3_000 })
    expect(api.envoyes[1].ops).toMatchObject([{ op: "replace_block", block: cadre.id, input: { type: "embed", data: { url: "https://www.youtube.com/embed/xyz", height: "large" } } }])
  })
})
