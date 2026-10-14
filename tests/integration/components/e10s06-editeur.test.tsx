import type { ReactNode } from "react"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { BlockView } from "@otomata_tech/oto_platform/schemas"
import { ContexteDeRafraichissement } from "@otomata_tech/oto_platform/ui"
import { EditeurDeBlocs } from "../../../packages/plateforme/ui/noeud/editeur/editeur-de-blocs"
import { FileDOperations } from "../../../packages/plateforme/ui/noeud/editeur/file-d-operations"
import { MESSAGES_DU_BLOC } from "../../../packages/plateforme/ui/noeud/editeur/operations"
import { ouvrirLeChamp } from "../../helpers/champ-du-bloc"
import { bloc, ID, PAGE, simulerLAPI } from "../../helpers/noeud"

// L'éditeur des blocs de page (E10-S06) : le choix du « + » et de « / », le séparateur, les préfixes, les niveaux de
// liste, le tableau simple et le repli, sous la file d'écriture (`fetch` simulé pour `POST /api/platform/nodes`).
// « Ailleurs » est un bouton hors de l'éditeur : le focus qui y va quitte le bloc. `apres` dit ce qui suit l'éditeur.

const rafraichir = vi.fn()
let api: ReturnType<typeof simulerLAPI>

function monter(blocs: BlockView[] = PAGE, apres: ReactNode = <button type="button">Ailleurs</button>) {
  render(
    <ContexteDeRafraichissement.Provider value={rafraichir}>
      <FileDOperations chemin="ventes/modele_relance" revisionPubliee={4} tampon={null}>
        <EditeurDeBlocs blocs={blocs} revisionServie={4} prefixeDesPages="/n/" />
      </FileDOperations>
      {apres}
    </ContexteDeRafraichissement.Provider>,
  )
}

const bouton = (nom: string) => screen.getByRole("button", { name: nom })
const champ = (nom: string) => screen.getByRole("textbox", { name: nom })
const ailleurs = () => act(() => bouton("Ailleurs").focus())
const focusSur = (element: HTMLElement) => waitFor(() => expect(document.activeElement).toBe(element))
const annonce = (texte: string) => screen.getAllByRole("status").some((region) => region.textContent?.includes(texte))

/** Un champ de plusieurs lignes : son curseur se lit et se pose. */
function zone(element: HTMLElement): HTMLTextAreaElement {
  if (!(element instanceof HTMLTextAreaElement)) throw new Error("champ de texte attendu")
  return element
}

/** Le choix du « + » d'un bloc, ouvert par un clic (AC-a1). */
function choixApres(mots: string) {
  fireEvent.click(bouton(`Ajouter un bloc après — ${mots}`))
  return within(screen.getByRole("menu"))
}

/** Un bloc choisi au « + » d'un bloc. */
const insererApres = (mots: string, choix: string) => fireEvent.click(choixApres(mots).getByRole("menuitem", { name: choix }))

/** Un Texte neuf, vide, après « Objet de la relance », le focus dedans. */
async function texteNeuf(): Promise<HTMLTextAreaElement> {
  insererApres("Objet de la relance", "Texte")
  const element = zone(champ("Modifier ce texte — bloc vide"))
  await focusSur(element)
  return element
}

const taper = (element: HTMLElement, texte: string) => fireEvent.change(element, { target: { value: texte } })

beforeEach(() => {
  api = simulerLAPI()
  rafraichir.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
  cleanup()
  // Les plis ouverts sont gardés dans le navigateur (`plis-gardes.ts`) : chaque cas part replié.
  window.localStorage.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("EditeurDeBlocs, le « + » ouvre un choix (AC-a1)", () => {
  it("should open a menu in two groups, without HTML, walked with the arrows, Enter inserting the block after, Escape giving the focus back to the « + »", async () => {
    monter()
    const menu = choixApres("Objet de la relance")
    expect(Array.from(screen.getByRole("menu").querySelectorAll(".oto-menu-group-label"), (groupe) => groupe.textContent)).toEqual(["Texte", "Insérer"])
    expect(menu.getAllByRole("menuitem").map((entree) => entree.textContent)).toEqual([
      "Texte",
      "Grand titre",
      "Moyen titre",
      "Petit titre",
      "Liste à puces",
      "Liste numérotée",
      "Liste à cocher",
      "Citation",
      "Code",
      "Diagramme",
      "Menu dépliant",
      "Tableau simple",
      "Séparateur",
      // 1.4.3 : le cadre intégré.
      "Intégration",
    ])
    expect(menu.queryByRole("menuitem", { name: /HTML/i })).toBeNull()
    // Échap ferme le menu et rend le focus au « + ».
    await focusSur(screen.getByRole("menu"))
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull())
    expect(document.activeElement).toBe(bouton("Ajouter un bloc après — Objet de la relance"))
    // Flèches et Entrée : le deuxième choix, « Grand titre », après le bloc, le focus dans son champ.
    choixApres("Objet de la relance")
    const ouvert = screen.getByRole("menu")
    await focusSur(ouvert)
    fireEvent.keyDown(ouvert, { key: "ArrowDown" })
    fireEvent.keyDown(ouvert, { key: "ArrowDown" })
    fireEvent.keyDown(ouvert, { key: "Enter" })
    const titre = champ("Modifier ce titre — bloc vide")
    await focusSur(titre)
    const rangees = Array.from(document.querySelectorAll("[data-cle]"))
    expect(rangees.indexOf(titre.closest("[data-cle]") ?? titre)).toBe(rangees.indexOf(champ("Modifier ce texte — Objet de la relance").closest("[data-cle]") ?? titre) + 1)
    expect(api.envoyes).toEqual([])
  })

  it("should insert a divider sent at once, the focus on its handle, and turn a Texte typed --- into a divider followed by a focused Texte", async () => {
    monter()
    insererApres("Objet de la relance", "Séparateur")
    await focusSur(bouton("Actions sur ce bloc — Séparateur"))
    await waitFor(() => expect(api.envoyes).toHaveLength(1))
    expect(api.envoyes[0].ops).toEqual([{ op: "insert_after", block: ID.objet, input: { type: "divider", data: {} } }])
    expect(document.querySelectorAll("hr.oto-separator")).toHaveLength(1)

    const texte = ouvrirLeChamp("Modifier ce texte — Objet de la relance")
    act(() => texte.focus())
    taper(texte, "")
    taper(texte, "---")
    await focusSur(champ("Modifier ce texte — bloc vide"))
    await waitFor(() => expect(api.envoyes).toHaveLength(2))
    expect(api.envoyes[1].ops).toEqual([{ op: "replace_block", block: ID.objet, revision: 3, input: { type: "divider", data: {} } }])
    expect(document.querySelectorAll("hr.oto-separator")).toHaveLength(2)
  })

  it("should make a small title of level 3 from ### typed at the start of a Texte, « Petit titre » in the menu", async () => {
    monter()
    const texte = await texteNeuf()
    taper(texte, "### Budget")
    const titre = champ("Modifier ce titre — Budget")
    await focusSur(titre)
    expect(titre.closest("h4")).not.toBeNull()
    fireEvent.keyDown(titre, { key: "Escape" })
    await waitFor(() => expect(api.envoyes).toHaveLength(1))
    expect(api.envoyes[0].ops).toEqual([{ op: "insert_after", block: ID.objet, input: { type: "heading", text: "Budget", data: { level: 3 } } }])
    fireEvent.click(bouton("Actions sur ce bloc — Budget"))
    expect(within(screen.getByRole("menu")).getByRole("menuitemradio", { name: "Petit titre" })).toHaveAttribute("aria-checked", "true")
  })
})

describe("EditeurDeBlocs, « / » ouvre le même choix (AC-a2)", () => {
  it("should open the list under an empty Texte, filter it without case nor accent, and replace the Texte by the block chosen with Enter", async () => {
    monter()
    const texte = await texteNeuf()
    taper(texte, "/")
    const liste = screen.getByRole("listbox", { name: "Blocs à insérer" })
    expect(within(liste).getAllByRole("option")).toHaveLength(14)
    expect(texte).toHaveAttribute("aria-controls", liste.id)
    taper(texte, "/SEPAR")
    expect(within(liste).getAllByRole("option").map((option) => option.textContent)).toEqual(["Séparateur"])
    expect(texte).toHaveAttribute("aria-activedescendant", within(liste).getByRole("option").id)
    taper(texte, "/tab")
    expect(within(liste).getAllByRole("option")[0]).toHaveTextContent("Tableau simple")
    fireEvent.keyDown(texte, { key: "Enter" })
    await focusSur(champ("En-tête de la colonne 1"))
    expect(screen.queryByRole("textbox", { name: "Modifier ce texte — bloc vide" })).toBeNull()
    expect(screen.queryByRole("listbox")).toBeNull()
    expect(api.envoyes).toEqual([])
  })

  it("should keep the typed text on Escape, say « Aucun bloc » when nothing matches, and leave a / typed elsewhere as text", async () => {
    monter()
    const texte = await texteNeuf()
    taper(texte, "/")
    taper(texte, "/zzz")
    await waitFor(() => expect(annonce("Aucun bloc")).toBe(true))
    expect(within(screen.getByRole("listbox")).queryAllByRole("option")).toEqual([])
    taper(texte, "/ti")
    fireEvent.keyDown(texte, { key: "Escape" })
    expect(screen.queryByRole("listbox")).toBeNull()
    expect(texte).toHaveValue("/ti")
    expect(document.activeElement).toBe(texte)
    // Un « / » ailleurs qu'au début d'un Texte vide reste du texte.
    const autre = ouvrirLeChamp("Modifier ce texte — Objet de la relance")
    taper(autre, "Objet de la relance /")
    expect(screen.queryByRole("listbox")).toBeNull()
  })

  it("should choose with Tab too", async () => {
    monter()
    const texte = await texteNeuf()
    taper(texte, "/")
    taper(texte, "/depl")
    fireEvent.keyDown(texte, { key: "Tab" })
    await focusSur(champ("Résumé du menu dépliant — bloc vide"))
  })

  it("should hold the delayed send while the list of « / » is open, and send a / text once the list is closed (HN-E10S06-10)", async () => {
    monter()
    const texte = await texteNeuf()
    vi.useFakeTimers()
    taper(texte, "/")
    act(() => vi.advanceTimersByTime(1_200))
    expect(api.envoyes).toEqual([])
    fireEvent.keyDown(texte, { key: "Escape" })
    taper(texte, "/etc")
    expect(screen.queryByRole("listbox")).toBeNull()
    act(() => vi.advanceTimersByTime(1_200))
    expect(api.envoyes.map((corps) => corps.ops)).toEqual([[{ op: "insert_after", block: ID.objet, input: { type: "paragraph", text: "/etc", data: {} } }]])
  })

  it("should drop the delayed send armed by an earlier keystroke when « / » opens the list (HN-E10S06-10)", async () => {
    monter()
    const texte = await texteNeuf()
    vi.useFakeTimers()
    taper(texte, "a")
    act(() => vi.advanceTimersByTime(500))
    taper(texte, "")
    act(() => vi.advanceTimersByTime(500))
    // Le différé armé par l'effacement ne part pas : la liste attend le choix.
    taper(texte, "/")
    act(() => vi.advanceTimersByTime(1_200))
    expect(api.envoyes).toEqual([])
    fireEvent.keyDown(texte, { key: "Enter" })
    expect(screen.queryByRole("listbox")).toBeNull()
    // Le bloc choisi, neuf et vide, reste quand le focus quitte sa rangée : rien ne part, rien n'est supprimé.
    act(() => bouton("Ailleurs").focus())
    act(() => vi.advanceTimersByTime(1_200))
    expect(api.envoyes).toEqual([])
    expect(annonce("Bloc supprimé.")).toBe(false)
  })
})

describe("EditeurDeBlocs, niveaux de liste (AC-a6)", () => {
  const LISTE = bloc("f7000000-0000-4000-8000-000000000007", "list", null, { items: ["a", "b"], ordered: true })

  it("should indent a line with Tab under the item before it, outdent it with Shift+Tab, and announce what cannot change", async () => {
    monter([LISTE])
    const liste = ouvrirLeChamp("Modifier cette liste numérotée — a b")
    act(() => liste.focus())
    liste.setSelectionRange(0, 0)
    fireEvent.keyDown(liste, { key: "Tab" })
    await waitFor(() => expect(annonce("Rien au-dessus de cette ligne.")).toBe(true))
    expect(liste).toHaveValue("a\nb")
    liste.setSelectionRange(2, 2)
    expect(fireEvent.keyDown(liste, { key: "Tab" })).toBe(false)
    await waitFor(() => expect(liste).toHaveValue("a\n  1. b"))
    // La gouttière ne compte que le premier niveau (HN-E10S04-14) : le sous-élément porte sa marque dans le texte.
    expect(Array.from(liste.closest("[id]")?.querySelectorAll(".oto-block-element") ?? [], (element) => element.querySelector(".oto-block-repere")?.textContent ?? "")).toEqual(["1.", ""])
    await waitFor(() => expect(liste.selectionStart).toBe(7))
    fireEvent.keyDown(liste, { key: "Tab", shiftKey: true })
    await waitFor(() => expect(liste).toHaveValue("a\nb"))
    fireEvent.keyDown(liste, { key: "Tab", shiftKey: true })
    await waitFor(() => expect(annonce("Cette ligne est déjà au premier niveau.")).toBe(true))
  })

  it("should refuse a fourth level, keep Tab for a checklist, and let Tab choose in the list of « @ »", async () => {
    const trois = bloc("f8000000-0000-4000-8000-000000000008", "list", null, { items: [{ text: "a", children: { items: [{ text: "b", children: { items: ["c"] } }] } }] })
    const cases = bloc("f9000000-0000-4000-8000-000000000009", "checklist", null, { items: [{ text: "x", checked: false }, { text: "y", checked: false }] })
    monter([trois, cases])
    const liste = ouvrirLeChamp(/^Modifier cette liste — a/)
    expect(liste).toHaveValue("a\n  - b\n    - c")
    act(() => liste.focus())
    liste.setSelectionRange(liste.value.length, liste.value.length)
    fireEvent.keyDown(liste, { key: "Tab" })
    await waitFor(() => expect(annonce(MESSAGES_DU_BLOC.troisNiveaux)).toBe(true))
    expect(liste).toHaveValue("a\n  - b\n    - c")
    const aCocher = ouvrirLeChamp("Modifier cette liste à cocher — x y")
    aCocher.setSelectionRange(2, 2)
    expect(fireEvent.keyDown(aCocher, { key: "Tab" })).toBe(true)
  })

  it("should leave a list, then a table, from its handle with Tab after Escape, Shift+Tab left to the browser", async () => {
    const tableau = bloc("fd000000-0000-4000-8000-00000000000d", "simple_table", null, { columns: ["Nom", "Montant"], rows: [["a", "1"]] })
    monter([LISTE, tableau])
    const liste = ouvrirLeChamp("Modifier cette liste numérotée — a b")
    act(() => liste.focus())
    fireEvent.keyDown(liste, { key: "Escape" })
    const poigneeDeLaListe = bouton("Actions sur ce bloc — a b")
    await focusSur(poigneeDeLaListe)
    // Maj+Tab n'est pas pris : le navigateur remonte au « + » de la rangée, comme avant.
    expect(fireEvent.keyDown(poigneeDeLaListe, { key: "Tab", shiftKey: true })).toBe(true)
    expect(document.activeElement).toBe(poigneeDeLaListe)
    // Tab passe le champ de la liste, qui garde Tab : le « + » du bloc suivant.
    expect(fireEvent.keyDown(poigneeDeLaListe, { key: "Tab" })).toBe(false)
    expect(document.activeElement).toBe(bouton("Ajouter un bloc après — Nom Montant"))

    const cellule = champ("Montant, rangée 1")
    act(() => cellule.focus())
    fireEvent.keyDown(cellule, { key: "Escape" })
    const poigneeDuTableau = bouton("Actions sur ce bloc — Nom Montant")
    await focusSur(poigneeDuTableau)
    expect(fireEvent.keyDown(poigneeDuTableau, { key: "Tab" })).toBe(false)
    // Dernier bloc : le focus va à ce qui suit l'éditeur, hors de la rangée du tableau.
    expect(poigneeDuTableau.closest("[data-cle]")?.contains(document.activeElement)).toBe(false)
    expect(document.activeElement).not.toBe(document.body)
  })

  /** Les éléments de la tabulation qui suivent `element` dans le document, hors de lui. */
  const tabulablesApres = (element: HTMLElement) =>
    Array.from(document.body.querySelectorAll<HTMLElement>("*")).filter(
      (autre) => !element.contains(autre) && (element.compareDocumentPosition(autre) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 && autre.tabIndex >= 0 && !autre.matches(":disabled"),
    )

  it.each([
    { cas: "a list", dernier: LISTE, mots: "a b" },
    { cas: "a table", dernier: bloc("fd000000-0000-4000-8000-00000000000d", "simple_table", null, { columns: ["Nom", "Montant"], rows: [["a", "1"]] }), mots: "Nom Montant" },
  ])("should leave $cas ending the page with Tab on its handle, its fields out of the tabulation for the browser's move only", async ({ dernier, mots }) => {
    // Rien ne suit l'éditeur, comme dans l'hôte de référence : le navigateur sort de la page.
    monter([bloc("f1000000-0000-4000-8000-000000000001", "paragraph", "Avant", {}), dernier], null)
    const poignee = bouton(`Actions sur ce bloc — ${mots}`)
    // Les champs de la rangée : les cellules d'un tableau, ou le bloc lu d'une liste (1.1.3), qui porte `tabindex="0"`.
    const champs = Array.from(poignee.closest("[data-cle]")?.querySelectorAll<HTMLElement>("[data-champ]") ?? [])
    expect(champs.length).toBeGreaterThan(0)
    const attributs = champs.map((un) => un.getAttribute("tabindex"))
    act(() => poignee.focus())
    // Le défaut reste au navigateur ; pendant son geste, aucun champ de la rangée n'est le prochain tabulable.
    expect(fireEvent.keyDown(poignee, { key: "Tab" })).toBe(true)
    expect(tabulablesApres(poignee)).toEqual([])
    // Au tour suivant, même si le focus n'a pas bougé, chaque champ revient dans la tabulation, tel qu'il était.
    await waitFor(() => expect(champs.map((un) => un.tabIndex)).toEqual(champs.map(() => 0)))
    expect(champs.map((un) => un.getAttribute("tabindex"))).toEqual(attributs)
    expect(document.activeElement).toBe(poignee)
  })

  it("should skip what is not rendered after the editor: a hidden element, the content of a closed details", async () => {
    monter(
      [LISTE],
      <>
        <button type="button">Masqué</button>
        <details>
          <button type="button">Replié</button>
        </details>
        <button type="button">Ailleurs</button>
      </>,
    )
    // jsdom ne calcule pas le rendu : le navigateur dirait `display: none` de ce bouton par `checkVisibility`.
    Object.defineProperty(bouton("Masqué"), "checkVisibility", { value: () => false })
    const poignee = bouton("Actions sur ce bloc — a b")
    act(() => poignee.focus())
    expect(fireEvent.keyDown(poignee, { key: "Tab" })).toBe(false)
    expect(document.activeElement).toBe(bouton("Ailleurs"))
  })
})

describe("EditeurDeBlocs, tableau simple (AC-b1, AC-b2, AC-b3)", () => {
  it("should insert a 3 × 3 table, walk its cells with Tab, add a row from the last one, and send it once in insert_after then replace_block", async () => {
    monter()
    insererApres("Objet de la relance", "Tableau simple")
    const premiere = champ("En-tête de la colonne 1")
    await focusSur(premiere)
    taper(premiere, " Nom ")
    fireEvent.keyDown(premiere, { key: "Tab" })
    const deuxieme = champ("En-tête de la colonne 2")
    await focusSur(deuxieme)
    taper(deuxieme, "Montant")
    fireEvent.keyDown(deuxieme, { key: "Tab", shiftKey: true })
    await focusSur(premiere)
    // Entrée descend d'une cellule ; la cellule est nommée par son en-tête.
    fireEvent.keyDown(premiere, { key: "Enter" })
    const nom = champ("Nom, rangée 1")
    await focusSur(nom)
    taper(nom, "a|b")
    const derniere = champ("Colonne 3, rangée 2")
    act(() => derniere.focus())
    fireEvent.keyDown(derniere, { key: "Tab" })
    await focusSur(champ("Nom, rangée 3"))
    // Passer d'une cellule à l'autre n'envoie rien : le tableau part quand le focus le quitte.
    expect(api.envoyes).toEqual([])
    ailleurs()
    await waitFor(() => expect(api.envoyes).toHaveLength(1))
    expect(api.envoyes[0].ops).toEqual([
      {
        op: "insert_after",
        block: ID.objet,
        input: {
          type: "simple_table",
          data: {
            columns: ["Nom", "Montant", ""],
            rows: [
              ["a\\|b", "", ""],
              ["", "", ""],
              ["", "", ""],
            ],
          },
        },
      },
    ])
    const montant = champ("Montant, rangée 1")
    act(() => montant.focus())
    taper(montant, "12")
    fireEvent.keyDown(montant, { key: "s", metaKey: true })
    await waitFor(() => expect(api.envoyes).toHaveLength(2))
    expect(api.envoyes[1].ops?.[0]).toMatchObject({ op: "replace_block", revision: 1, input: { type: "simple_table", data: { rows: [["a\\|b", "12", ""], ["", "", ""], ["", "", ""]] } } })
  })

  it("should add a row or a column after the current cell, remove them but never the header, align a column, and say the bound of 20 columns", async () => {
    const tableau = bloc("fa000000-0000-4000-8000-00000000000a", "simple_table", null, { columns: ["Nom", "Montant"], rows: [["a", "1"]] })
    const large = bloc("fb000000-0000-4000-8000-00000000000b", "simple_table", null, { columns: Array.from({ length: 20 }, (_, rang) => `c${rang}`), rows: [] })
    monter([tableau, large])
    // Les cellules de chaque tableau, dans sa rangée : deux tableaux ont chacun leur « En-tête de la colonne 1 ».
    const cellule = (cle: string, nom: string) => within(document.querySelector<HTMLElement>(`[data-cle="${cle}"]`) ?? document.body).getByRole("textbox", { name: nom })
    const menu = (mots: string) => {
      fireEvent.click(bouton(`Actions sur ce bloc — ${mots}`))
      return within(screen.getByRole("menu"))
    }
    act(() => cellule(tableau.id, "Montant, rangée 1").focus())
    expect(menu("Nom Montant").getByRole("menuitem", { name: "Retirer la rangée" })).not.toHaveAttribute("aria-disabled")
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Ajouter une colonne après" }))
    expect(cellule(tableau.id, "En-tête de la colonne 3")).toHaveValue("")
    fireEvent.click(menu("Nom Montant").getByRole("menuitemradio", { name: "Droite" }))
    fireEvent.click(menu("Nom Montant").getByRole("menuitem", { name: "Ajouter une rangée après" }))
    expect(cellule(tableau.id, "Nom, rangée 2")).toHaveValue("")
    act(() => cellule(tableau.id, "En-tête de la colonne 1").focus())
    expect(menu("Nom Montant").getByRole("menuitem", { name: "Retirer la rangée" })).toHaveAttribute("aria-disabled", "true")
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" })
    act(() => cellule(tableau.id, "Montant, rangée 1").focus())
    fireEvent.keyDown(cellule(tableau.id, "Montant, rangée 1"), { key: "s", ctrlKey: true })
    await waitFor(() => expect(api.envoyes).toHaveLength(1))
    expect(api.envoyes[0].ops?.[0]).toMatchObject({
      op: "replace_block",
      block: tableau.id,
      input: { type: "simple_table", data: { columns: ["Nom", "Montant", ""], rows: [["a", "1", ""], ["", "", ""]], align: [null, "right", null] } },
    })

    fireEvent.click(menu("c0 c1 c2 c3").getByRole("menuitem", { name: "Ajouter une colonne après" }))
    await waitFor(() => expect(annonce("20 colonnes au plus.")).toBe(true))
    expect(within(document.querySelector<HTMLElement>(`[data-cle="${large.id}"]`) ?? document.body).getAllByRole("textbox")).toHaveLength(20)
  })

  it("should offer « Convertir en tableau de données » for a table with columns only", () => {
    const vide = bloc("fe000000-0000-4000-8000-00000000000e", "simple_table", null, { columns: [], rows: [] })
    const plein = bloc("fa000000-0000-4000-8000-00000000000a", "simple_table", null, { columns: ["Nom"], rows: [["a"]] })
    monter([vide, plein])
    fireEvent.click(bouton("Actions sur ce bloc — bloc vide"))
    expect(within(screen.getByRole("menu")).queryByRole("menuitem", { name: "Convertir en tableau de données" })).toBeNull()
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" })
    fireEvent.click(bouton("Actions sur ce bloc — Nom"))
    expect(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Convertir en tableau de données" })).toBeInTheDocument()
  })

  it("should turn a spreadsheet pasted in an empty Texte into a table, reading text/plain only, a tag in a cell kept as text", async () => {
    monter()
    const texte = await texteNeuf()
    // Le HTML du presse-papiers n'est jamais lu : une balise tapée dans une cellule reste du texte.
    fireEvent.paste(texte, { clipboardData: { getData: (type: string) => (type === "text/plain" ? "<img src=x onerror=alert(1)>\tMontant\nPomme\t 3 \n" : '<img src=x onerror="alert(1)">') } })
    await focusSur(champ("En-tête de la colonne 1"))
    expect(champ("En-tête de la colonne 1")).toHaveValue("<img src=x onerror=alert(1)>")
    expect(champ("Montant, rangée 1")).toHaveValue("3")
    expect(document.querySelector("img")).toBeNull()
    expect(api.envoyes).toEqual([])
  })
})

describe("EditeurDeBlocs, repli (AC-b4)", () => {
  it("should write a toggle in two fields, Enter going to the body and Backspace in an empty body back to the summary, and refuse an empty summary", async () => {
    monter()
    insererApres("Objet de la relance", "Menu dépliant")
    const resume = champ("Résumé du menu dépliant — bloc vide")
    await focusSur(resume)
    fireEvent.keyDown(resume, { key: "Enter" })
    const corps = zone(champ("Corps du menu dépliant — bloc vide"))
    await focusSur(corps)
    fireEvent.keyDown(corps, { key: "Backspace" })
    await focusSur(resume)
    // Au début d'un corps écrit, Retour arrière reste au corps (AC-b4 : « du corps vide »).
    act(() => corps.focus())
    taper(corps, "Le corps\n")
    corps.setSelectionRange(0, 0)
    fireEvent.keyDown(corps, { key: "Backspace" })
    expect(document.activeElement).toBe(corps)
    // Un résumé vide n'est pas envoyé : le message reste sous le champ.
    act(() => resume.focus())
    fireEvent.keyDown(resume, { key: "Escape" })
    expect(await screen.findByRole("alert")).toHaveTextContent("Le repli a besoin d'un résumé.")
    expect(resume).toHaveAccessibleDescription("Le repli a besoin d'un résumé.")
    expect(api.envoyes).toEqual([])
    taper(resume, "Détails")
    ailleurs()
    await waitFor(() => expect(api.envoyes).toHaveLength(1))
    expect(api.envoyes[0].ops).toEqual([{ op: "insert_after", block: ID.objet, input: { type: "toggle", text: "Le corps", data: { summary: "Détails" } } }])
  })

  // Le dessin de la lecture (chevron à gauche, corps décalé), servi replié, déplié au chevron, l'état jamais envoyé.
  it("should draw the toggle as read, folded when served, unfold and fold it from the chevron without sending, and unfold it on Enter in the summary", async () => {
    const repli = bloc("fc000000-0000-4000-8000-00000000000c", "toggle", "Le **corps**", { summary: "Détails" })
    monter([repli])
    const resume = zone(champ("Résumé du menu dépliant — Détails"))
    // Le chevron, un bouton natif avant le résumé (Entrée et Espace viennent du navigateur), dit l'état du corps.
    const chevron = bouton("Déplier le corps — Détails")
    const tete = resume.closest(".oto-depliant-tete")
    expect(tete?.firstElementChild).toBe(chevron)
    expect(chevron.querySelector(".oto-pli-chevron")).not.toBeNull()
    expect(chevron).toHaveAttribute("aria-expanded", "false")
    fireEvent.click(chevron)
    const corps = zone(champ("Corps du menu dépliant — Détails"))
    const panneau = corps.closest(".oto-depliant-corps")
    expect(panneau?.parentElement).toBe(tete?.parentElement)
    expect(chevron).toHaveAttribute("aria-controls", panneau?.id)
    // Au repos, le corps se lit comme en lecture, ses marques rendues sur le champ.
    expect(corps).toHaveAttribute("data-rendu")
    expect(within(corps.parentElement ?? corps).getByText("corps").tagName).toBe("STRONG")
    // Le résumé s'écrit sur une ligne ; passer au chevron n'envoie rien, replier cache le corps.
    act(() => resume.focus())
    taper(resume, "Détails\nde la relance")
    act(() => chevron.focus())
    fireEvent.click(chevron)
    expect(chevron).toHaveAttribute("aria-expanded", "false")
    expect(chevron).toHaveAccessibleName("Déplier le corps — Détails de la relance")
    expect(panneau).not.toBeVisible()
    fireEvent.click(chevron)
    expect(panneau).toBeVisible()
    fireEvent.click(chevron)
    // Entrée dans le résumé d'un repli replié : le corps se déplie et prend le focus.
    act(() => resume.focus())
    fireEvent.keyDown(resume, { key: "Enter" })
    await focusSur(corps)
    expect(chevron).toHaveAttribute("aria-expanded", "true")
    expect(panneau).toBeVisible()
    taper(corps, "Le **corps** relu")
    ailleurs()
    await waitFor(() => expect(api.envoyes).toHaveLength(1))
    expect(api.envoyes[0].ops).toEqual([
      { op: "replace_block", block: repli.id, revision: 3, input: { type: "toggle", text: "Le **corps** relu", data: { summary: "Détails de la relance" } } },
    ])
  })

  it("should refuse a toggle inside the body", async () => {
    const repli = bloc("fc000000-0000-4000-8000-00000000000c", "toggle", "Corps", { summary: "Détails" })
    monter([repli])
    fireEvent.click(bouton("Déplier le corps — Détails"))
    const corps = champ("Corps du menu dépliant — Détails")
    act(() => corps.focus())
    taper(corps, "Corps\n<details>")
    fireEvent.keyDown(corps, { key: "Escape" })
    expect(await screen.findByRole("alert")).toHaveTextContent("Un repli ne contient pas d'autre repli.")
    expect(api.envoyes).toEqual([])
  })
})
