import { renderToStaticMarkup } from "react-dom/server"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { BlockView } from "@otomata_tech/oto_platform/schemas"
import { ListeACiter } from "../../../packages/plateforme/ui/noeud/editeur/citer"
import type { CiblesDesLiens } from "../../../packages/plateforme/ui/noeud/en-ligne"
import { TitreModifiable } from "../../../packages/plateforme/ui/noeud/en-tete-modifiable"
import { RenduDUnBloc } from "../../../packages/plateforme/ui/noeud/rendu-des-blocs"
import { ouvrirLeChamp, texteDuBloc } from "../../helpers/champ-du-bloc"
import { bloc, ID, lEditeur, monterLEditeur, PAGE, simulerLAPI } from "../../helpers/noeud"

// L'éditeur de blocs (E05-S08 ; depuis la 1.1.3, un bloc se lit et son focus monte son champ, `ouvrirLeChamp` ; E05-S02 pour ce qui ne dépend pas du mode ; E05-S10,
// partie a : menu de la poignée, glisser-déposer, blocs vides, un seul titre, publication seule, liens ; E05-S11, lot b :
// l'indication d'enregistrement, les pages citées au repos, tout sélectionner ; E11-S15, lot B : le tableau simple, le
// menu de la poignée, le texte marqué au repos, « @ » avant toute frappe), sous sa file d'écriture (`monterLEditeur`) :
// `fetch` simulé pour `POST /api/platform/nodes`, relecture de la page espionnée ; une relecture se joue en rerendant
// l'éditeur avec les blocs relus. « Ailleurs » est un bouton hors de l'éditeur : le focus qui y va quitte le champ et sa
// rangée, comme en suivant un lien.

type Montage = { blocs?: BlockView[]; tampon?: string | null; revision?: number }

/** Un bloc que l'écran n'écrit pas (un contenu cité ; un diagramme s'écrit depuis la 1.1.3) : il se lit, se déplace, se duplique et se supprime. */
const CITE = bloc("f5000000-0000-4000-8000-000000000005", "reference", null, { path: "ventes/suivi" })
let api: ReturnType<typeof simulerLAPI>

/** L'éditeur monté ; `relire` rerend avec la lecture relue (blocs, révision). */
function monter({ blocs = PAGE, ...montage }: Montage = {}) {
  const monte = monterLEditeur(blocs, montage)
  return { ...monte, relire: ({ blocs: relus = blocs, ...autre }: Montage) => monte.relire(relus, autre) }
}

const bouton = (nom: string) => screen.getByRole("button", { name: nom })

/** Le champ déjà ouvert du bloc nommé, sans l'ouvrir : un bloc lu lève (il s'ouvre par `ouvrirLeChamp`). */
function champ(nom: string): HTMLTextAreaElement {
  const element = screen.getByRole("textbox", { name: nom })
  if (!(element instanceof HTMLTextAreaElement)) throw new Error(`champ « ${nom} » attendu`)
  return element
}

/** Le focus dans un champ, puis un texte tapé : le différé de 1 200 ms est armé. */
function ecrire(element: HTMLTextAreaElement, texte: string) {
  act(() => element.focus())
  fireEvent.change(element, { target: { value: texte } })
}

/** Un texte tapé, puis Échap : il part, et le focus va à la poignée de la rangée. */
function ecrireEtEchapper(element: HTMLTextAreaElement, texte: string) {
  ecrire(element, texte)
  fireEvent.keyDown(element, { key: "Escape" })
}

/** Le focus quitte le champ et sa rangée. */
const ailleurs = () => act(() => bouton("Ailleurs").focus())

/** Un tour de boucle : la sortie d'un champ ou d'une rangée se décide au tour suivant. */
const unTour = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))

const statut = (texte: string) => screen.getAllByRole("status").find((region) => region.textContent?.includes(texte))

/** Le menu d'un bloc, ouvert par un clic sur sa poignée (E05-S10, AC-a2). */
function menuDu(mots: string) {
  fireEvent.click(bouton(`Actions sur ce bloc — ${mots}`))
  return within(screen.getByRole("menu"))
}

/** Un Texte ajouté après un bloc : le « + » ouvre le choix du bloc, « Texte » l'insère (E10-S06, AC-a1). */
function ajouterUnTexteApres(mots: string) {
  fireEvent.click(bouton(`Ajouter un bloc après — ${mots}`))
  fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Texte" }))
}

/** Un geste du menu d'un bloc, par son nom (« Monter » porte son raccourci). */
function choisir(mots: string, geste: string | RegExp) {
  fireEvent.click(menuDu(mots).getByRole("menuitem", { name: geste }))
}

beforeEach(() => {
  api = simulerLAPI()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  Reflect.deleteProperty(navigator, "clipboard")
})

describe("EditeurDeBlocs, champs des blocs (AC1, AC9)", () => {
  it("should name every writable block as a textbox without a click, read with no field mounted, none focused, a heading in its element, the other blocks read, and no « Modifier ce bloc »", () => {
    // Servi par le serveur, aucun champ non plus (1.1.3).
    expect(renderToStaticMarkup(lEditeur([...PAGE, CITE]))).not.toContain("<textarea")
    monter({ blocs: [...PAGE, CITE] })
    expect(screen.getAllByRole("textbox").map((element) => element.getAttribute("aria-label"))).toEqual([
      "Modifier ce titre — Objet",
      "Modifier ce texte — Objet de la relance",
      "Modifier ce code — select 1",
      "Modifier cette liste — Lire le devis Écrire",
    ])
    // Aucun champ monté tant qu'aucun bloc n'est touché (1.1.3).
    expect(document.querySelector("textarea")).toBeNull()
    expect(document.activeElement).toBe(document.body)
    expect(screen.getByRole("textbox", { name: "Modifier ce titre — Objet" }).closest("h2")).toHaveAttribute("id", "objet")
    // Une liste à puces écrite est dessinée par le design system (ses puces : `liens-en-edition.test.tsx`) ; lue, elle
    // est atteinte au clavier.
    const liste = screen.getByRole("textbox", { name: "Modifier cette liste — Lire le devis Écrire" })
    expect(liste).toHaveAttribute("data-kind", "list")
    expect(liste).toHaveAttribute("tabindex", "0")
    // Un bloc qu'on n'écrit pas se lit dans sa rangée, avec sa gouttière (HN-E05S08-5).
    expect(screen.getByText("ventes/suivi")).toBeInTheDocument()
    for (const geste of ["Ajouter un bloc après — ventes/suivi", "Actions sur ce bloc — ventes/suivi", "Actions sur ce bloc — Objet de la relance"]) expect(bouton(geste)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^Modifier ce bloc/ })).toBeNull()
    // Les lignes d'état sont montées vides : elles n'annoncent que ce qui change ensuite.
    for (const region of screen.getAllByRole("status")) expect(region).toBeEmptyDOMElement()
    // Ouvert, son champ a la hauteur de ses lignes avant toute mesure (M30).
    expect(ouvrirLeChamp("Modifier cette liste — Lire le devis Écrire")).toHaveAttribute("rows", "2")
  })
})

describe("EditeurDeBlocs, envoi du texte (AC2)", () => {
  // Suivre un lien de l'arbre est une navigation du client, sans `beforeunload` : le texte part quand le focus quitte le champ.
  it("should send a modified field once when the focus leaves it, as when following a link, adopt the returned revision, say it, and send nothing unchanged", async () => {
    const lache = api.retenir()
    monter()
    const texte = ouvrirLeChamp("Modifier ce texte — Objet de la relance")
    ecrire(texte, "Objet revu")
    ailleurs()
    await waitFor(() => expect(api.envoyes).toHaveLength(1))
    expect(api.envoyes[0]).toEqual({
      path: "ventes/modele_relance",
      base_revision: 4,
      // Chaque écriture garde le brouillon ; la publication suit les frappes (E11-S02, AC-c2).
      publish: false,
      ops: [{ op: "replace_block", block: ID.objet, revision: 3, input: { type: "paragraph", text: "Objet revu", data: {} } }],
    })
    expect(statut("Enregistrement…")).toHaveAttribute("aria-busy", "true")
    lache()
    await waitFor(() => expect(statut("Enregistré.")).toHaveAttribute("aria-busy", "false"))

    // ⌘S envoie sans quitter le champ, sur la révision rendue (4) ; un champ inchangé qu'on quitte n'envoie rien. Le
    // champ quitté s'est démonté : il se rouvre.
    const encore = ouvrirLeChamp("Modifier ce texte — Objet revu")
    ecrire(encore, "Objet revu encore")
    fireEvent.keyDown(encore, { key: "s", ctrlKey: true })
    await waitFor(() => expect(api.envoyes).toHaveLength(2))
    expect(api.envoyes[1].ops?.[0]).toMatchObject({ op: "replace_block", block: ID.objet, revision: 4 })
    expect(document.activeElement).toBe(encore)
    ailleurs()
    ouvrirLeChamp("Modifier ce titre — Objet")
    ailleurs()
    await unTour()
    expect(api.envoyes).toHaveLength(2)
  })

  it("should send a field's text 1 200 ms after the last keystroke, in a single replace_block", () => {
    monter()
    const texte = ouvrirLeChamp("Modifier ce texte — Objet de la relance")
    vi.useFakeTimers()
    ecrire(texte, "Objet r")
    act(() => vi.advanceTimersByTime(1_000))
    fireEvent.change(texte, { target: { value: "Objet revu" } })
    act(() => vi.advanceTimersByTime(1_199))
    expect(api.envoyes).toHaveLength(0)
    act(() => vi.advanceTimersByTime(1))
    expect(api.envoyes.map((corps) => corps.ops)).toEqual([[{ op: "replace_block", block: ID.objet, revision: 3, input: { type: "paragraph", text: "Objet revu", data: {} } }]])
  })

  it("should keep a refused field's message under it, focus kept, send nothing, and give its last saved content back", async () => {
    monter()
    const titre = ouvrirLeChamp("Modifier ce titre — Objet")
    ecrireEtEchapper(titre, "x".repeat(201))
    const message = await screen.findByRole("alert")
    expect(message).toHaveTextContent("Un titre compte 200 caractères au plus.")
    expect(titre).toHaveAttribute("aria-describedby", message.id)
    expect(document.activeElement).toBe(titre)
    ailleurs()
    await unTour()
    expect(api.envoyes).toHaveLength(0)
    fireEvent.click(bouton("Annuler les modifications du bloc"))
    expect(champ("Modifier ce titre — Objet")).toHaveValue("Objet")
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("should delete an emptied block with « Annuler » once the focus leaves its row, and keep an empty new block without sending", async () => {
    monter()
    ecrire(ouvrirLeChamp("Modifier ce texte — Objet de la relance"), "   ")
    // La poignée de la même rangée garde le bloc vide : il n'est retiré qu'à la sortie de sa rangée.
    act(() => bouton("Actions sur ce bloc — bloc vide").focus())
    await unTour()
    expect(api.envoyes).toHaveLength(0)
    ailleurs()
    await waitFor(() => expect(api.envoyes).toHaveLength(1))
    expect(api.envoyes[0].ops).toEqual([{ op: "delete_block", block: ID.objet, revision: 3 }])
    expect(statut("Bloc supprimé.")).toBeDefined()
    expect(bouton("Annuler")).toBeInTheDocument()
    // Le focus parti ailleurs y reste : le bloc vidé ne le reprend pas pour son voisin.
    await unTour()
    expect(document.activeElement).toBe(bouton("Ailleurs"))

    // Un bloc neuf vide reste quand le focus le quitte (E05-S10, AC-a4), sans rien envoyer.
    ajouterUnTexteApres("Objet")
    await waitFor(() => expect(document.activeElement).toBe(champ("Modifier ce texte — bloc vide")))
    ailleurs()
    await unTour()
    expect(screen.getByRole("textbox", { name: "Modifier ce texte — bloc vide" })).toBeInTheDocument()
    expect(api.envoyes).toHaveLength(1)
  })

  // Sous Safari et Firefox macOS, un bouton cliqué ne prend pas le focus : le champ quitté le laisse à `<body>`.
  it("should keep an empty new block and open its menu when the click in its row leaves the focus to the page, as in Safari (M30)", async () => {
    monter()
    ajouterUnTexteApres("Objet")
    await waitFor(() => expect(document.activeElement).toBe(champ("Modifier ce texte — bloc vide")))
    const poignee = bouton("Actions sur ce bloc — bloc vide")
    fireEvent.pointerDown(poignee)
    act(() => champ("Modifier ce texte — bloc vide").blur())
    await unTour()
    expect(document.activeElement).toBe(document.body)
    fireEvent.pointerUp(poignee)
    fireEvent.click(poignee)
    expect(screen.getByRole("textbox", { name: "Modifier ce texte — bloc vide" })).toBeInTheDocument()
    expect(poignee).toHaveAttribute("aria-expanded", "true")
    expect(api.envoyes).toHaveLength(0)
  })

  // Une navigation du client (retour du navigateur) démonte l'éditeur sans `blur` ni `beforeunload`.
  it("should send the text still waiting for its 1 200 ms when the editor goes away without the field losing the focus (HN-E05S08-16)", async () => {
    const { demonter } = monter()
    // Tapé dans le champ ouvert, que le focus ne quitte pas : aucune sortie de champ ne l'envoie, seul le démontage.
    fireEvent.change(ouvrirLeChamp("Modifier ce texte — Objet de la relance"), { target: { value: "Objet revu" } })
    expect(api.envoyes).toHaveLength(0)
    demonter()
    await waitFor(() => expect(api.envoyes).toHaveLength(1))
    expect(api.envoyes[0].ops).toEqual([{ op: "replace_block", block: ID.objet, revision: 3, input: { type: "paragraph", text: "Objet revu", data: {} } }])
  })
})

describe("EditeurDeBlocs, clavier (AC3)", () => {
  it("should split at the caret on Enter, a heading giving a Texte, send both parts, and focus the part after", async () => {
    monter()
    const titre = ouvrirLeChamp("Modifier ce titre — Objet")
    titre.setSelectionRange(3, 3)
    fireEvent.keyDown(titre, { key: "Enter" })
    const suite = await screen.findByRole("textbox", { name: "Modifier ce texte — et" })
    await waitFor(() => expect(document.activeElement).toBe(suite))
    expect(suite).toHaveProperty("selectionStart", 0)
    await waitFor(() => expect(api.envoyes).toHaveLength(2))
    expect(api.envoyes.map((corps) => corps.ops)).toEqual([
      [{ op: "replace_block", block: ID.titre, revision: 1, input: { type: "heading", text: "Obj", data: { level: 1 }, key: "objet" } }],
      [{ op: "insert_after", block: ID.titre, input: { type: "paragraph", text: "et", data: {} } }],
    ])
  })

  it("should turn a Texte into a heading by its prefix, leave a list on Enter on its last empty line, and merge into the block before on Backspace at the start", async () => {
    monter()
    ecrire(ouvrirLeChamp("Modifier ce texte — Objet de la relance"), "# Objet de la relance")
    // Le bloc change d'élément : son champ est remonté dans le titre, le focus l'y suit.
    const devenu = await screen.findByRole("textbox", { name: "Modifier ce titre — Objet de la relance" })
    expect(devenu.closest("h2")).not.toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(devenu))
    fireEvent.keyDown(devenu, { key: "Escape" })
    await waitFor(() => expect(api.envoyes).toHaveLength(1))
    expect(api.envoyes[0].ops?.[0]).toMatchObject({ op: "replace_block", block: ID.objet, input: { type: "heading", text: "Objet de la relance", data: { level: 1 } } })

    const liste = ouvrirLeChamp("Modifier cette liste — Lire le devis Écrire")
    ecrire(liste, "Lire le devis\nÉcrire le brouillon\n")
    liste.setSelectionRange(liste.value.length, liste.value.length)
    fireEvent.keyDown(liste, { key: "Enter" })
    await waitFor(() => expect(document.activeElement).toBe(champ("Modifier ce texte — bloc vide")))
    expect(texteDuBloc("Modifier cette liste — Lire le devis Écrire")).toBe("Lire le devis\nÉcrire le brouillon")

    const titre = ouvrirLeChamp("Modifier ce titre — Objet de la relance")
    titre.setSelectionRange(0, 0)
    fireEvent.keyDown(titre, { key: "Backspace" })
    const fondu = await screen.findByRole("textbox", { name: "Modifier ce titre — ObjetObjet de la relance" })
    await waitFor(() => expect(document.activeElement).toBe(fondu))
    expect(fondu).toHaveProperty("selectionStart", "Objet".length)
    await waitFor(() => expect(api.envoyes).toHaveLength(3))
    expect(api.envoyes.slice(1).map((corps) => corps.ops)).toEqual([
      [{ op: "replace_block", block: ID.titre, revision: 1, input: { type: "heading", text: "ObjetObjet de la relance", data: { level: 1 }, key: "objet" } }],
      [{ op: "delete_block", block: ID.objet, revision: 4 }],
    ])
  })

  it("should move a block with ⌥↑, the focus kept in its field, and send the text on Escape before focusing the row's handle", async () => {
    monter()
    const liste = ouvrirLeChamp("Modifier cette liste — Lire le devis Écrire")
    fireEvent.keyDown(liste, { key: "ArrowUp", altKey: true })
    await waitFor(() => expect(api.envoyes).toHaveLength(1))
    expect(api.envoyes[0].ops).toEqual([{ op: "move_block", block: ID.liste, after_block: ID.objet }])
    await waitFor(() => expect(document.activeElement).toBe(liste))

    ecrireEtEchapper(liste, "Lire")
    await waitFor(() => expect(document.activeElement).toBe(bouton("Actions sur ce bloc — Lire")))
    await waitFor(() => expect(api.envoyes).toHaveLength(2))
    expect(api.envoyes[1].ops?.[0]).toMatchObject({ op: "replace_block", block: ID.liste, input: { data: { items: ["Lire"] } } })
  })
})

describe("EditeurDeBlocs, menu de la poignée (E05-S10, AC-a2, AC-a5)", () => {
  it("should open under the handle a menu to move, restyle among three titles and eight styles, duplicate and delete, with no such button outside it", async () => {
    monter()
    expect(screen.queryByRole("button", { name: /^(Monter|Descendre|Supprimer|Dupliquer)$/ })).toBeNull()
    ajouterUnTexteApres("Objet de la relance")
    const neuf = champ("Modifier ce texte — bloc vide")
    await waitFor(() => expect(document.activeElement).toBe(neuf))
    const poignee = bouton("Actions sur ce bloc — bloc vide")
    expect(poignee).toHaveAttribute("aria-haspopup", "menu")
    const menu = menuDu("bloc vide")
    expect(poignee).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByRole("menu")).toHaveAttribute("data-side", "bottom")
    expect(menu.getAllByRole("menuitemradio").map((choix) => [choix.textContent, choix.getAttribute("aria-checked")])).toEqual([
      ["Texte", "true"],
      ["Grand titre", "false"],
      ["Moyen titre", "false"],
      ["Petit titre", "false"],
      ["Liste à puces", "false"],
      ["Liste numérotée", "false"],
      ["Liste à cocher", "false"],
      ["Citation", "false"],
      ["Code", "false"],
      // 1.1.3 : « Diagramme » s'ajoute.
      ["Diagramme", "false"],
      // E10-S06 (AC-a3) : le repli, « Menu dépliant », s'ajoute ; les blocs « Insérer » n'y figurent pas.
      ["Menu dépliant", "false"],
    ])
    expect(menu.getAllByRole("menuitem").map((geste) => geste.querySelector(".oto-menu-label")?.textContent)).toEqual(["Monter", "Descendre", "Dupliquer", "Supprimer"])
    // Un bloc neuf vide qui change de style ne part pas : il part avec son texte.
    // Un Texte n'a pas de case « Repliable ».
    expect(menu.queryByRole("menuitemcheckbox")).toBeNull()
    fireEvent.click(menu.getByRole("menuitemradio", { name: "Grand titre" }))
    const titre = champ("Modifier ce titre — bloc vide")
    await waitFor(() => expect(document.activeElement).toBe(titre))
    expect(api.envoyes).toHaveLength(0)
    ecrireEtEchapper(titre, "Budget")
    await waitFor(() => expect(api.envoyes).toHaveLength(1))
    expect(api.envoyes[0].ops).toEqual([{ op: "insert_after", block: ID.objet, input: { type: "heading", text: "Budget", data: { level: 1 } } }])
    // L'ancre du bloc neuf est la référence que rend son écriture.
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Modifier ce titre — Budget" }).closest("h2")).toHaveAttribute("id", "e0000001"))
  })

  it("should open the menu from the keyboard, close it on Escape with the focus back on the handle, and move a block by « Monter », the last one not going down", async () => {
    monter()
    const poignee = bouton("Actions sur ce bloc — Lire le devis Écrire")
    // Au clavier : la flèche du bas ouvre le menu, comme Entrée ou Espace, qui cliquent le bouton.
    act(() => poignee.focus())
    fireEvent.keyDown(poignee, { key: "ArrowDown" })
    const menu = screen.getByRole("menu")
    await waitFor(() => expect(document.activeElement).toBe(menu))
    fireEvent.keyDown(menu, { key: "Escape" })
    expect(screen.queryByRole("menu")).toBeNull()
    expect(document.activeElement).toBe(poignee)

    act(() => poignee.focus())
    fireEvent.click(poignee)
    expect(within(screen.getByRole("menu")).getByRole("menuitem", { name: /^Descendre/ })).toHaveAttribute("aria-disabled", "true")
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: /^Monter/ }))
    await waitFor(() => expect(api.envoyes).toHaveLength(1))
    expect(api.envoyes[0].ops).toEqual([{ op: "move_block", block: ID.liste, after_block: ID.objet }])
    await waitFor(() => expect(document.activeElement).toBe(champ("Modifier cette liste — Lire le devis Écrire")))
  })

  it("should give a block written by the assistant a menu without style, duplicate it, delete it with its revision, and bring it back by « Annuler » without id", async () => {
    monter({ blocs: [...PAGE.slice(0, 2), CITE] })
    const menu = menuDu("ventes/suivi")
    expect(menu.getByText("Ce bloc se modifie par votre assistant.")).toBeInTheDocument()
    expect(menu.queryAllByRole("menuitemradio")).toHaveLength(0)
    fireEvent.click(menu.getByRole("menuitem", { name: "Dupliquer" }))
    await waitFor(() => expect(api.envoyes).toHaveLength(1))
    expect(api.envoyes[0].ops).toEqual([{ op: "insert_after", block: CITE.id, input: { type: "reference", data: { path: "ventes/suivi" } } }])
    expect(screen.getAllByText("ventes/suivi")).toHaveLength(2)

    // Le premier des deux, celui qui était servi.
    fireEvent.click(screen.getAllByRole("button", { name: "Actions sur ce bloc — ventes/suivi" })[0])
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Supprimer" }))
    await waitFor(() => expect(api.envoyes).toHaveLength(2))
    expect(api.envoyes[1].ops).toEqual([{ op: "delete_block", block: CITE.id, revision: 3 }])
    // Le focus va au bloc d'avant, dans son champ ouvert, en fin de texte.
    await waitFor(() => expect(document.activeElement).toBe(champ("Modifier ce texte — Objet de la relance")))
    expect(champ("Modifier ce texte — Objet de la relance")).toHaveProperty("selectionStart", "Objet de la relance".length)
    expect(statut("Bloc supprimé.")).toBeDefined()

    fireEvent.click(bouton("Annuler"))
    await waitFor(() => expect(api.envoyes).toHaveLength(3))
    expect(api.envoyes[2].ops).toEqual([{ op: "insert_after", block: ID.objet, input: { type: "reference", data: { path: "ventes/suivi" } } }])
  })

  it("should read a heading of level 4 as « Petit titre », in the element of its level, without rewriting its level", async () => {
    const ancien = { ...bloc("a7000000-0000-4000-8000-000000000007", "heading", "Suite", { level: 4 }), revision: 2 }
    monter({ blocs: [ancien] })
    expect(screen.getByRole("textbox", { name: "Modifier ce titre — Suite" }).closest("h5")).not.toBeNull()
    expect(menuDu("Suite").getByRole("menuitemradio", { name: "Petit titre" })).toHaveAttribute("aria-checked", "true")
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" })
    ecrireEtEchapper(ouvrirLeChamp("Modifier ce titre — Suite"), "Suite revue")
    await waitFor(() => expect(api.envoyes).toHaveLength(1))
    expect(api.envoyes[0].ops?.[0]).toMatchObject({ input: { type: "heading", text: "Suite revue", data: { level: 4 } } })
  })

  // Chaque titre se replie, ouvert à l'arrivée : son chevron cache sa section sans rien envoyer, et ce navigateur s'en souvient.
  it("should give every title a chevron that folds its section without sending, remembered by this browser", async () => {
    const annexes = { ...bloc("a8000000-0000-4000-8000-000000000008", "heading", "Annexes", { level: 1 }), revision: 2 }
    const detail = bloc("a9000000-0000-4000-8000-000000000009", "paragraph", "Détail des annexes")
    const suite = bloc("aa000000-0000-4000-8000-00000000000a", "heading", "Suite", { level: 1 })
    monter({ blocs: [annexes, detail, suite] })
    const rangee = (id: string) => document.querySelector<HTMLElement>(`[data-cle="${id}"]`)
    expect(rangee(detail.id)).toBeVisible()
    expect(bouton("Replier la section — Suite")).toHaveAttribute("aria-expanded", "true")
    fireEvent.click(bouton("Replier la section — Annexes"))
    expect(rangee(detail.id)).not.toBeVisible()
    expect(rangee(suite.id)).toBeVisible()
    expect(window.localStorage.getItem("oto-plis")).toBe(`${annexes.id}=0`)
    expect(menuDu("Annexes").queryByRole("menuitemcheckbox")).toBeNull()
    expect(api.envoyes).toEqual([])
    window.localStorage.clear()
  })

  it("should show a nested list one item per line, two spaces per level, and send the typing with its children, ordered and start kept (E10-S04, AC-b2)", () => {
    const items = ["a", { text: "b", children: { items: ["c", { text: "d", children: { items: ["e"], ordered: true, start: 3 } }] } }]
    monter({ blocs: [{ ...bloc("a8000000-0000-4000-8000-000000000008", "list", null, { items, ordered: true, start: 2 }), revision: 2 }] })
    const liste = ouvrirLeChamp(/^Modifier .* — a b/)
    expect(liste).toHaveValue("a\nb\n  - c\n  - d\n    3. e")
    vi.useFakeTimers()
    ecrire(liste, "a\nb\n  - c\n  - d\n    3. e\n    4. f")
    act(() => vi.advanceTimersByTime(1_200))
    const suite = [...items.slice(0, 1), { text: "b", children: { items: ["c", { text: "d", children: { items: ["e", "f"], ordered: true, start: 3 } }] } }]
    expect(api.envoyes.map((corps) => corps.ops)).toEqual([
      [{ op: "replace_block", block: "a8000000-0000-4000-8000-000000000008", revision: 2, input: { type: "list", data: { items: suite, ordered: true, start: 2 } } }],
    ])
  })

  it("should settle the status line when a queued gesture has nothing left to send, its block deleted meanwhile", async () => {
    monter()
    const lache = api.retenir()
    ecrireEtEchapper(ouvrirLeChamp("Modifier ce titre — Objet"), "Objet revu")
    ecrireEtEchapper(ouvrirLeChamp("Modifier ce texte — Objet de la relance"), "Texte revu")
    choisir("Texte revu", "Supprimer")
    lache()
    // Le remplacement du bloc supprimé ne part pas : seule sa suppression suit l'écriture retenue.
    await waitFor(() => expect(api.envoyes).toHaveLength(2))
    expect(api.envoyes[1].ops).toEqual([{ op: "delete_block", block: ID.objet, revision: 3 }])
    await waitFor(() => expect(statut("Enregistré.")).toHaveAttribute("aria-busy", "false"))
  })

  // E11-S05 (AC-g1, HN-E11S05-19, HN-E11S05-22) : ni phrase ni bouton, un Texte vide créé sur le poste, son invite.
  it("should give an empty page one local empty Texte with its prompt word for word, sent only once typed, at the start", async () => {
    monter({ blocs: [] })
    expect(screen.queryByText("Cette page n'a pas encore de contenu.")).toBeNull()
    expect(screen.queryByRole("button", { name: "Commencer à écrire" })).toBeNull()
    // Lu, il dit son invite ; ouvert, son champ la porte.
    const invite = "Commencer à écrire... Utilisez '/' pour afficher tous les types de blocs - Utilisez '@' pour citer un autre contenu (page, tableau, procédure) de l'espace"
    expect(screen.getByRole("textbox", { name: "Modifier ce texte — bloc vide" })).toHaveAttribute("aria-placeholder", invite)
    expect(ouvrirLeChamp("Modifier ce texte — bloc vide")).toHaveAttribute("placeholder", invite)
    // Vide, quitté, il ne part pas et reste là.
    ailleurs()
    await unTour()
    expect(api.envoyes).toEqual([])
    ecrireEtEchapper(ouvrirLeChamp("Modifier ce texte — bloc vide"), "Premier bloc")
    await waitFor(() => expect(api.envoyes).toHaveLength(1))
    expect(api.envoyes[0].ops).toEqual([{ op: "insert_after", input: { type: "paragraph", text: "Premier bloc", data: {} } }])
  })

  it("should leave an empty Texte with its prompt in place of the last block removed: the editor never has no row (AC-g1)", async () => {
    monter({ blocs: [bloc(ID.objet, "paragraph", "Seul bloc")] })
    choisir("Seul bloc", "Supprimer")
    await waitFor(() => expect(api.envoyes).toHaveLength(1))
    expect(api.envoyes[0].ops).toEqual([{ op: "delete_block", block: ID.objet, revision: 3 }])
    // Le focus l'ouvre : son champ porte l'invite.
    await waitFor(() => expect(document.activeElement).toBe(champ("Modifier ce texte — bloc vide")))
    expect(champ("Modifier ce texte — bloc vide")).toHaveAttribute("placeholder", "Commencer à écrire... Utilisez '/' pour afficher tous les types de blocs - Utilisez '@' pour citer un autre contenu (page, tableau, procédure) de l'espace")
  })

  it("should open the choice of « / » on the Texte of an empty page, and insert after it from its « + » (AC-g2)", () => {
    monter({ blocs: [] })
    const texte = ouvrirLeChamp("Modifier ce texte — bloc vide")
    fireEvent.change(texte, { target: { value: "/" } })
    expect(screen.getByRole("listbox", { name: "Blocs à insérer" })).toBeInTheDocument()
    fireEvent.change(texte, { target: { value: "" } })
    fireEvent.click(bouton("Ajouter un bloc après — bloc vide"))
    expect(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Texte" })).toBeInTheDocument()
  })

  it("should tick a checklist line from its box, the state sent at once", async () => {
    const cases = bloc("c8000000-0000-4000-8000-000000000008", "checklist", null, { items: [{ text: "Lire", checked: false }, { text: "Écrire", checked: true }] })
    monter({ blocs: [cases] })
    expect(texteDuBloc("Modifier cette liste à cocher — Lire Écrire")).toBe("Lire\nÉcrire")
    const lire = screen.getByRole("checkbox", { name: "Cocher « Lire »" })
    expect(lire).not.toBeChecked()
    expect(screen.getByRole("checkbox", { name: "Cocher « Écrire »" })).toBeChecked()
    fireEvent.click(lire)
    await waitFor(() => expect(api.envoyes).toHaveLength(1))
    expect(api.envoyes[0].ops?.[0]).toMatchObject({ op: "replace_block", input: { type: "checklist", data: { items: [{ text: "Lire", checked: true }, { text: "Écrire", checked: true }] } } })
  })
})

describe("EditeurDeBlocs, blocs vides de suite (E05-S10, AC-a4)", () => {
  it("should add empty blocks one after the other, by a second « + » or by Enter on an empty block", async () => {
    monter()
    ajouterUnTexteApres("Objet de la relance")
    await waitFor(() => expect(document.activeElement).toBe(champ("Modifier ce texte — bloc vide")))
    ajouterUnTexteApres("bloc vide")
    await waitFor(() => expect(screen.getAllByRole("textbox", { name: "Modifier ce texte — bloc vide" })).toHaveLength(2))
    const second = screen.getAllByRole("textbox", { name: "Modifier ce texte — bloc vide" })[1]
    await waitFor(() => expect(document.activeElement).toBe(second))
    fireEvent.keyDown(second, { key: "Enter" })
    await waitFor(() => expect(screen.getAllByRole("textbox", { name: "Modifier ce texte — bloc vide" })).toHaveLength(3))
    await waitFor(() => expect(document.activeElement).toBe(screen.getAllByRole("textbox", { name: "Modifier ce texte — bloc vide" })[2]))
    ailleurs()
    await unTour()
    expect(screen.getAllByRole("textbox", { name: "Modifier ce texte — bloc vide" })).toHaveLength(3)
    expect(api.envoyes).toHaveLength(0)
  })
})

/** jsdom n'a pas de `PointerEvent` : sans lui, un événement de pointeur arrive sans bouton ni position. */
class PointerEventDeTest extends MouseEvent {
  readonly pointerId: number
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init)
    this.pointerId = init.pointerId ?? 1
  }
}

describe("EditeurDeBlocs, glisser-déposer (E05-S10, AC-a3)", () => {
  afterEach(() => void Reflect.deleteProperty(window, "PointerEvent"))

  /** Chaque rangée fait 40 px, dans l'ordre du DOM : le milieu de la rangée n est à 40 n + 20. */
  const rangeesDe40Px = () =>
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const rang = [...document.querySelectorAll("[data-cle]")].indexOf(this)
      return new DOMRect(0, rang * 40, 600, 40)
    })

  it("should move the held block past each middle it crosses, send one move_block on drop, and not open its menu", async () => {
    Object.assign(window, { PointerEvent: PointerEventDeTest })
    monter()
    rangeesDe40Px()
    const poignee = bouton("Actions sur ce bloc — Lire le devis Écrire")
    fireEvent.pointerDown(poignee, { clientY: 140, button: 0, pointerId: 1 })
    fireEvent.pointerMove(poignee, { clientY: 138, pointerId: 1 })
    expect(poignee.closest("[data-cle]")).not.toHaveAttribute("data-state")
    fireEvent.pointerMove(poignee, { clientY: 95, pointerId: 1 })
    fireEvent.pointerMove(poignee, { clientY: 55, pointerId: 1 })
    expect(bouton("Actions sur ce bloc — Lire le devis Écrire").closest("[data-cle]")).toHaveAttribute("data-state", "moving")
    expect(api.envoyes).toHaveLength(0)
    fireEvent.pointerUp(poignee, { clientY: 55, pointerId: 1 })
    fireEvent.click(poignee)
    expect(screen.queryByRole("menu")).toBeNull()
    await waitFor(() => expect(api.envoyes).toHaveLength(1))
    expect(api.envoyes[0].ops).toEqual([{ op: "move_block", block: ID.liste, after_block: ID.titre }])
    expect(screen.getAllByRole("textbox").map((element) => element.getAttribute("aria-label"))).toEqual([
      "Modifier ce titre — Objet",
      "Modifier cette liste — Lire le devis Écrire",
      "Modifier ce texte — Objet de la relance",
      "Modifier ce code — select 1",
    ])
  })

  it("should put the block back in its place and send nothing when the system cancels the gesture (pointercancel)", async () => {
    Object.assign(window, { PointerEvent: PointerEventDeTest })
    monter()
    rangeesDe40Px()
    const ordre = () => screen.getAllByRole("textbox").map((element) => element.getAttribute("aria-label"))
    const avant = ordre()
    const poignee = bouton("Actions sur ce bloc — Lire le devis Écrire")
    fireEvent.pointerDown(poignee, { clientY: 140, button: 0, pointerId: 1 })
    fireEvent.pointerMove(poignee, { clientY: 95, pointerId: 1 })
    fireEvent.pointerMove(poignee, { clientY: 55, pointerId: 1 })
    expect(ordre()).not.toEqual(avant)
    fireEvent.pointerCancel(poignee, { pointerId: 1 })
    expect(ordre()).toEqual(avant)
    expect(poignee.closest("[data-cle]")).not.toHaveAttribute("data-state")
    await unTour()
    expect(api.envoyes).toHaveLength(0)
  })

  // E11-S17 (AC-a8) : la poignée d'un bloc sélectionné parmi d'autres glisse le groupe, regroupé dans l'ordre de la page.
  describe("a selection of blocks (E11-S17, AC-a8)", () => {
    const ORDRE_SERVI = ["Modifier ce titre — Objet", "Modifier ce texte — Objet de la relance", "Modifier ce code — select 1", "Modifier cette liste — Lire le devis Écrire"]
    const ordre = () => screen.getAllByRole("textbox").map((element) => element.getAttribute("aria-label"))

    /** Ctrl+clic sur le texte et la liste (deux blocs non contigus), puis le texte tenu par sa poignée et glissé sous le milieu du code (100). */
    function glisserLeTexteEtLaListe() {
      Object.assign(window, { PointerEvent: PointerEventDeTest })
      monter()
      rangeesDe40Px()
      fireEvent.click(bouton("Actions sur ce bloc — Objet de la relance"), { ctrlKey: true })
      fireEvent.click(bouton("Actions sur ce bloc — Lire le devis Écrire"), { ctrlKey: true })
      const poignee = bouton("Actions sur ce bloc — Objet de la relance")
      fireEvent.pointerDown(poignee, { clientY: 50, button: 0, pointerId: 1 })
      fireEvent.pointerMove(poignee, { clientY: 150, pointerId: 1 })
      return poignee
    }

    it("should move the group past the middle it crosses, send one write of move_block in page order on drop, and put it back on « Annuler »", async () => {
      const poignee = glisserLeTexteEtLaListe()
      expect(ordre()).toEqual([ORDRE_SERVI[0], ORDRE_SERVI[2], ORDRE_SERVI[1], ORDRE_SERVI[3]])
      expect(api.envoyes).toHaveLength(0)
      fireEvent.pointerUp(poignee, { clientY: 150, pointerId: 1 })
      fireEvent.click(poignee)
      expect(screen.queryByRole("menu")).toBeNull()
      await waitFor(() => expect(api.envoyes).toHaveLength(1))
      expect(api.envoyes[0].ops).toEqual([
        { op: "move_block", block: ID.objet, after_block: ID.code },
        { op: "move_block", block: ID.liste, after_block: ID.objet },
      ])
      expect(statut("2 blocs déplacés.")).toBeDefined()

      fireEvent.click(bouton("Annuler"))
      await waitFor(() => expect(api.envoyes).toHaveLength(2))
      expect(api.envoyes[1].ops).toEqual([
        { op: "move_block", block: ID.objet, after_block: ID.titre },
        { op: "move_block", block: ID.liste, after_block: ID.code },
      ])
      expect(ordre()).toEqual(ORDRE_SERVI)
    })

    it("should put the group back in its order and send nothing when the system cancels the gesture (pointercancel)", async () => {
      const poignee = glisserLeTexteEtLaListe()
      expect(ordre()).not.toEqual(ORDRE_SERVI)
      fireEvent.pointerCancel(poignee, { pointerId: 1 })
      expect(ordre()).toEqual(ORDRE_SERVI)
      await unTour()
      expect(api.envoyes).toHaveLength(0)
    })
  })

  // Un titre glissé emmène sa section, jusqu'au titre suivant de même niveau ; une section repliée se passe d'un tenant.
  describe("a heading and the folds", () => {
    const AVANT = bloc("e1000000-0000-4000-8000-000000000001", "paragraph", "Avant")
    const PARTIE = bloc("e2000000-0000-4000-8000-000000000002", "heading", "Partie", { level: 2 })
    const DEDANS = bloc("e3000000-0000-4000-8000-000000000003", "paragraph", "Dedans")
    const SUITE = bloc("e4000000-0000-4000-8000-000000000004", "heading", "Suite", { level: 2 })
    const ordre = () => screen.getAllByRole("textbox", { hidden: true }).map((element) => element.getAttribute("aria-label"))

    /** Les rangées montrées font 40 px, empilées ; une rangée cachée par un pli n'a pas de boîte. */
    const rangeesMontreesDe40Px = () =>
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
        const montrees = [...document.querySelectorAll<HTMLElement>("[data-cle]")].filter((rangee) => !rangee.hidden)
        const rang = montrees.indexOf(this)
        return rang < 0 ? new DOMRect(0, 0, 0, 0) : new DOMRect(0, rang * 40, 600, 40)
      })

    it("should move a dragged heading with its section, in one write of move_block, said with « Annuler »", async () => {
      Object.assign(window, { PointerEvent: PointerEventDeTest })
      monter({ blocs: [AVANT, PARTIE, DEDANS, SUITE] })
      rangeesMontreesDe40Px()
      const poignee = bouton("Actions sur ce bloc — Partie")
      fireEvent.pointerDown(poignee, { clientY: 50, button: 0, pointerId: 1 })
      fireEvent.pointerMove(poignee, { clientY: 5, pointerId: 1 })
      expect(ordre()).toEqual(["Modifier ce titre — Partie", "Modifier ce texte — Dedans", "Modifier ce texte — Avant", "Modifier ce titre — Suite"])
      fireEvent.pointerUp(poignee, { clientY: 5, pointerId: 1 })
      await waitFor(() => expect(api.envoyes).toHaveLength(1))
      expect(api.envoyes[0].ops).toEqual([
        { op: "move_block", block: PARTIE.id },
        { op: "move_block", block: DEDANS.id, after_block: PARTIE.id },
      ])
      expect(statut("2 blocs déplacés.")).toBeDefined()
    })

    it("should mark the chevron of a heading without a section as empty, not the one of a heading with blocks under it", () => {
      monter({ blocs: [AVANT, PARTIE, DEDANS, SUITE] })
      expect(bouton("Replier la section — Partie")).not.toHaveAttribute("data-vide")
      expect(bouton("Replier la section — Suite")).toHaveAttribute("data-vide")
    })

    it("should draw the selection rectangle from outside the block area, around the editor, and take the blocks it covers", () => {
      Object.assign(window, { PointerEvent: PointerEventDeTest })
      monter({ blocs: [AVANT, PARTIE, DEDANS, SUITE] })
      rangeesMontreesDe40Px()
      const zone = screen.getByRole("group", { name: "Blocs de la page" })
      const autour = zone.parentElement
      if (!autour) throw new Error("un parent de la zone des blocs attendu")
      fireEvent.pointerDown(autour, { clientX: 2, clientY: 5, button: 0, pointerId: 1 })
      fireEvent.pointerMove(zone, { clientX: 300, clientY: 70, pointerId: 1 })
      expect(zone).toHaveAccessibleName("2 blocs sélectionnés")
      fireEvent.pointerUp(zone, { clientX: 300, clientY: 70, pointerId: 1 })
    })

    it("should pass a folded section whole: a block dragged up over it lands before its heading", () => {
      Object.assign(window, { PointerEvent: PointerEventDeTest })
      monter({ blocs: [AVANT, PARTIE, DEDANS, SUITE] })
      rangeesMontreesDe40Px()
      fireEvent.click(bouton("Replier la section — Partie"))
      const poignee = bouton("Actions sur ce bloc — Suite")
      fireEvent.pointerDown(poignee, { clientY: 90, button: 0, pointerId: 1 })
      fireEvent.pointerMove(poignee, { clientY: 45, pointerId: 1 })
      expect(ordre()).toEqual(["Modifier ce texte — Avant", "Modifier ce titre — Suite", "Modifier ce titre — Partie", "Modifier ce texte — Dedans"])
    })
  })
})

describe("EditeurDeBlocs, publication seule (E05-S10, AC-a6)", () => {
  it("should offer no « Publier », and publish 3 s after the last keystroke, after the text, on the stamp it returned", async () => {
    const { rafraichir } = monter()
    expect(screen.queryByRole("button", { name: "Publier" })).toBeNull()
    vi.useFakeTimers()
    const texte = ouvrirLeChamp("Modifier ce texte — Objet de la relance")
    ecrire(texte, "Objet r")
    await act(() => vi.advanceTimersByTimeAsync(2_000))
    fireEvent.change(texte, { target: { value: "Objet revu" } })
    await act(() => vi.advanceTimersByTimeAsync(2_999))
    expect(api.envoyes.map((corps) => corps.publish ?? false)).toEqual([false, false])
    await act(() => vi.advanceTimersByTimeAsync(1))
    expect(api.envoyes).toHaveLength(3)
    expect(api.envoyes[2]).toEqual({ path: "ventes/modele_relance", base_revision: 4, draft_stamp: "2026-09-24T10:00:02.000000+00:00", publish: true })
    expect(rafraichir).toHaveBeenCalledTimes(1)
    // Ni bandeau de brouillon, ni « Publié en révision N. » ; l'enregistrement se dit.
    expect(screen.queryByText(/^Brouillon non publié|^Publié en révision/)).toBeNull()
    expect(statut("Enregistré.")).toBeDefined()
    // Rien de plus sans frappe.
    await act(() => vi.advanceTimersByTimeAsync(10_000))
    expect(api.envoyes).toHaveLength(3)
  })

  it.each([
    ["the tab closed (pagehide)", () => window.dispatchEvent(new Event("pagehide"))],
    ["the tab hidden (visibilitychange)", () => {
      Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true })
      document.dispatchEvent(new Event("visibilitychange"))
      Reflect.deleteProperty(document, "visibilityState")
    }],
  ])("should send the waiting text then publish at once when %s", async (_cas, sortir) => {
    monter()
    ecrire(ouvrirLeChamp("Modifier ce texte — Objet de la relance"), "Objet revu")
    act(sortir)
    await waitFor(() => expect(api.envoyes).toHaveLength(2))
    expect(api.envoyes[0].ops?.[0]).toMatchObject({ op: "replace_block", input: { text: "Objet revu" } })
    expect(api.envoyes[1]).toMatchObject({ publish: true })
    // L'écriture vidée à la sortie et la publication survivent à l'onglet fermé (`keepalive`).
    expect(api.fetchMock.mock.calls.map(([, init]) => init?.keepalive)).toEqual([true, true])
  })

  it("should send a text over the keepalive limit (64 KiB) without keepalive when the tab closes, so that it still leaves", async () => {
    monter()
    ecrire(ouvrirLeChamp("Modifier ce texte — Objet de la relance"), "a".repeat(70_000))
    act(() => window.dispatchEvent(new Event("pagehide")))
    await waitFor(() => expect(api.envoyes).toHaveLength(2))
    expect(api.fetchMock.mock.calls.map(([, init]) => init?.keepalive)).toEqual([undefined, true])
  })

  it("should publish when the host navigates away, the editor going with the page", async () => {
    const { demonter } = monter()
    ecrire(ouvrirLeChamp("Modifier ce texte — Objet de la relance"), "Objet revu")
    demonter()
    await waitFor(() => expect(api.envoyes).toHaveLength(2))
    expect(api.envoyes[1]).toMatchObject({ publish: true })
  })

  it("should say a stale publication, keep the text, and publish again on « Réessayer »", async () => {
    const { rafraichir } = monter()
    const texte = ouvrirLeChamp("Modifier ce texte — Objet de la relance")
    ecrireEtEchapper(texte, "Objet revu")
    await waitFor(() => expect(api.envoyes).toHaveLength(1))
    api.refuser("stale_revision", 409)
    act(() => window.dispatchEvent(new Event("pagehide")))
    expect(await screen.findByText("La page a changé pendant que vous écriviez : votre texte est gardé, il sera publié à votre prochaine modification.")).toHaveAttribute("role", "alert")
    expect(texteDuBloc("Modifier ce texte — Objet revu")).toBe("Objet revu")
    expect(rafraichir).toHaveBeenCalledTimes(1)
    fireEvent.click(bouton("Réessayer"))
    await waitFor(() => expect(api.envoyes).toHaveLength(3))
    expect(api.envoyes[2]).toMatchObject({ publish: true })
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull())
  })

  // E11-S02 (AC-c2) : écrire publie ; l'éditeur, monté au niveau écriture, publie comme à la gestion.
  it("should publish at the writing level too, 3 s after the last keystroke, with no sentence about who publishes", async () => {
    monter()
    expect(screen.queryByText(/La publication revient/)).toBeNull()
    vi.useFakeTimers()
    ecrire(ouvrirLeChamp("Modifier ce texte — Objet de la relance"), "Objet revu")
    await act(() => vi.advanceTimersByTimeAsync(1_200))
    expect(api.envoyes.map((corps) => corps.publish)).toEqual([false])
    expect(statut("Enregistré.")).toBeDefined()
    await act(() => vi.advanceTimersByTimeAsync(3_000))
    expect(api.envoyes.map((corps) => corps.publish)).toEqual([false, true])
  })

  it("should ask before leaving the tab with a modified field, and no longer once it is sent", async () => {
    monter()
    const quitter = () => {
      const depart = new Event("beforeunload", { cancelable: true })
      window.dispatchEvent(depart)
      return depart.defaultPrevented
    }
    const texte = ouvrirLeChamp("Modifier ce texte — Objet de la relance")
    expect(quitter()).toBe(false)
    fireEvent.change(texte, { target: { value: "Objet revu" } })
    expect(quitter()).toBe(true)
    fireEvent.keyDown(texte, { key: "Escape" })
    await waitFor(() => expect(statut("Enregistré.")).toBeDefined())
    expect(quitter()).toBe(false)
  })
})

describe("EditeurDeBlocs, brouillon (AC9 d'E05-S02 ; E11-S02, AC-c3)", () => {
  it("should say nothing of a draft, the person's or one an assistant left, and publish the shared draft whole after the next keystroke", async () => {
    monter({ tampon: null })
    ecrireEtEchapper(ouvrirLeChamp("Modifier ce texte — Objet de la relance"), "Objet revu")
    await waitFor(() => expect(api.envoyes).toHaveLength(1))
    expect(screen.queryByText(/Brouillon non publié/)).toBeNull()
    expect(screen.queryByRole("link", { name: "Voir la version publiée" })).toBeNull()
    cleanup()

    // Un brouillon trouvé à l'ouverture (laissé par un assistant, `publish: false`) : aucun avis (HN-E11S02-19).
    monter({ tampon: "2026-09-24T09:00:00.000000+00:00" })
    expect(screen.queryByText(/Brouillon non publié/)).toBeNull()
    vi.useFakeTimers()
    ecrireEtEchapper(ouvrirLeChamp("Modifier ce texte — Objet de la relance"), "Objet revu")
    await act(() => vi.advanceTimersByTimeAsync(3_000))
    // La publication part sur le tampon rendu par l'écriture : le brouillon partagé, entier.
    expect(api.envoyes.at(-1)).toMatchObject({ publish: true, draft_stamp: expect.any(String) })
    expect(screen.queryByText(/Brouillon non publié/)).toBeNull()
  })
})

describe("EditeurDeBlocs, liens d'un bloc (E05-S10, AC-a8, AC-a9 ; E05-S11, AC-26)", () => {
  it("should read a pasted address and a cited page as links in the sentence, over the same field, and no row of links under it", () => {
    monter()
    const adresse = "https://docs.exemple.fr/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/edit"
    const texte = ouvrirLeChamp("Modifier ce texte — Objet de la relance")
    ecrire(texte, `Voir ${adresse} et [[ventes/tarifs|les tarifs]]`)
    // Le rendu est posé sur le champ ouvert, dans sa case : le même `<textarea>`, jamais remonté, porte le texte brut.
    const rendu = texte.parentElement?.querySelector(".oto-block-rendu")
    if (!(rendu instanceof HTMLElement)) throw new Error("rendu au repos absent")
    expect(texte).toHaveAttribute("data-rendu")
    expect(screen.getByRole("textbox", { name: /^Modifier ce texte — Voir https:\/\/docs\.exemple\.fr\/…tUvWxYz\/edit et/ })).toBe(texte)
    expect(rendu).toHaveTextContent("Voir https://docs.exemple.fr/…tUvWxYz/edit et les tarifs")
    // Coupée à l'écran (E11-S15, AC-b10), l'adresse se nomme entière.
    const web = within(rendu).getByRole("link", { name: adresse })
    expect(web).toHaveAttribute("href", adresse)
    expect(web).toHaveAttribute("title", adresse)
    expect(web).toHaveAttribute("target", "_blank")
    expect(web).toHaveAttribute("rel", "noopener noreferrer nofollow")
    expect(within(rendu).getByRole("link", { name: "les tarifs" })).toHaveAttribute("href", "/n/ventes/tarifs")
    expect(screen.queryByRole("group", { name: "Liens de ce bloc" })).toBeNull()
    // Sans lien, aucun rendu posé : le champ se lit tel quel.
    fireEvent.change(texte, { target: { value: "Voir le devis" } })
    expect(texte).not.toHaveAttribute("data-rendu")
    expect(document.querySelector(".oto-block-rendu")).toBeNull()
  })

  it("should search the readable contents after « @ », and insert the chosen one as a [[path|title]] link, sent as text", async () => {
    const ecriture = api.fetchMock.getMockImplementation()
    const recherches: string[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (adresse, init) => {
        // Aucun contenu récent (E11-S15, AC-b4) : « @ » seul garde l'invite à taper.
        if (String(adresse).includes("/api/platform/search/recent")) return new Response(JSON.stringify({ data: { matches: [] } }), { status: 200, headers: { "content-type": "application/json" } })
        if (!String(adresse).includes("/api/platform/search?")) return ecriture ? ecriture(adresse, init) : new Response(null, { status: 500 })
        recherches.push(String(adresse))
        const matches = [
          { path: "ventes/grille_tarifaire", kind: "page", title: "Grille tarifaire", snippet: null },
          { path: "ventes/grille_remises", kind: "table", title: "Grille des remises", snippet: null },
        ]
        return new Response(JSON.stringify({ data: { matches, more: 0 } }), { status: 200, headers: { "content-type": "application/json" } })
      }),
    )
    monter()
    const texte = ouvrirLeChamp("Modifier ce texte — Objet de la relance")
    ecrire(texte, "Voir @")
    expect(await screen.findByText("Tapez au moins deux lettres du contenu à citer.")).toBeInTheDocument()
    fireEvent.change(texte, { target: { value: "Voir @gri" } })
    const options = await screen.findAllByRole("option")
    expect(options.map((option) => option.textContent)).toEqual(["Grille tarifaireventes/grille_tarifaire", "Grille des remisesventes/grille_remises"])
    expect(recherches).toEqual(["/api/platform/search?q=gri"])
    expect(texte).toHaveAttribute("aria-activedescendant", options[0].id)
    fireEvent.keyDown(texte, { key: "ArrowDown" })
    expect(texte).toHaveAttribute("aria-activedescendant", options[1].id)
    fireEvent.keyDown(texte, { key: "ArrowUp" })
    fireEvent.keyDown(texte, { key: "Enter" })
    await screen.findByRole("textbox", { name: "Modifier ce texte — Voir Grille tarifaire" })
    const lie = champ("Modifier ce texte — Voir Grille tarifaire")
    expect(lie).toHaveValue("Voir [[Grille tarifaire]]")
    expect(screen.queryByRole("listbox")).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(lie))
    expect(lie).toHaveProperty("selectionStart", lie.value.length)
    expect(screen.getByRole("link", { name: "Grille tarifaire" })).toHaveAttribute("href", "/n/ventes/grille_tarifaire")
    fireEvent.keyDown(lie, { key: "Escape" })
    await waitFor(() => expect(api.envoyes).toHaveLength(1))
    expect(api.envoyes[0].ops?.[0]).toMatchObject({ op: "replace_block", input: { type: "paragraph", text: "Voir [[ventes/grille_tarifaire|Grille tarifaire]]" } })
  })

  // E10-S06 (AC-a6) : dans une liste, `Tab` change le niveau d'une ligne, sauf quand la liste de « @ » est ouverte.
  it("should still choose with Tab in the list of « @ » opened in a bulleted list, the line keeping its level", async () => {
    const ecriture = api.fetchMock.getMockImplementation()
    const matches = [{ path: "ventes/grille_tarifaire", kind: "page", title: "Grille tarifaire", snippet: null }]
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (adresse, init) => {
        if (!String(adresse).includes("/api/platform/search?")) return ecriture ? ecriture(adresse, init) : new Response(null, { status: 500 })
        return new Response(JSON.stringify({ data: { matches, more: 0 } }), { status: 200, headers: { "content-type": "application/json" } })
      }),
    )
    monter()
    const liste = ouvrirLeChamp("Modifier cette liste — Lire le devis Écrire")
    ecrire(liste, "Lire le devis\nÉcrire @gri")
    await screen.findByRole("option")
    expect(fireEvent.keyDown(liste, { key: "Tab" })).toBe(false)
    await waitFor(() => expect(champ("Modifier cette liste — Lire le devis Écrire")).toHaveValue("Lire le devis\nÉcrire [[Grille tarifaire]]"))
    expect(screen.queryByRole("listbox")).toBeNull()
  })

  it("should mount the status region of « @ » empty, its sentence coming after the mount", () => {
    // Le premier rendu, sans effet : la région y est vide ; monté, l'effet lui donne sa phrase.
    const liste = <ListeACiter id="citer" resultat={{ etat: "repos" }} actif={0} choisir={() => {}} />
    const conteneur = document.createElement("div")
    conteneur.innerHTML = renderToStaticMarkup(liste)
    expect(within(conteneur).getByRole("status")).toBeEmptyDOMElement()
    render(liste)
    expect(screen.getByRole("status")).toHaveTextContent("Tapez au moins deux lettres du contenu à citer.")
  })
})

describe("EditeurDeBlocs, conflit au bloc (AC6)", () => {
  it("should reread on stale_revision, put the changed block in conflict with the final text prefilled by the saved version, lock the other fields, then save the final text on the new revision", async () => {
    const { relire, rafraichir } = monter()
    api.refuser("stale_revision", 409)
    ecrireEtEchapper(ouvrirLeChamp("Modifier ce texte — Objet de la relance"), "Texte de Léa")
    await waitFor(() => expect(rafraichir).toHaveBeenCalledTimes(1))
    // Le champ s'écrit encore : ce qu'on y tape entre le refus et la relecture va dans « Votre texte ».
    ecrire(ouvrirLeChamp("Modifier ce texte — Texte de Léa"), "Texte de Léa, suite")
    const claire = [PAGE[0], { ...bloc(ID.objet, "paragraph", "Texte de Claire"), revision: 4 }, PAGE[2], PAGE[3]]
    relire({ blocs: claire })

    expect(await screen.findByText("Ce bloc a changé pendant que vous écriviez. Votre texte n'a pas été enregistré : composez le texte final à partir de la version enregistrée.")).toHaveAttribute("role", "alert")
    expect(screen.getByRole("textbox", { name: "Votre texte, non enregistré" })).toHaveValue("Texte de Léa, suite")
    expect(screen.getByRole("textbox", { name: "Version enregistrée" })).toHaveValue("Texte de Claire")
    expect(screen.getByRole("textbox", { name: "Texte final" })).toHaveValue("Texte de Claire")
    expect(bouton("Copier mon texte")).toBeInTheDocument()
    // Les autres champs se lisent sans s'écrire, et le disent (HN-E05S08-3) : lus, puis ouverts.
    expect(screen.getByRole("textbox", { name: "Modifier ce titre — Objet" })).toHaveAttribute("aria-readonly", "true")
    expect(ouvrirLeChamp("Modifier ce titre — Objet")).toHaveAttribute("readonly")
    await waitFor(() => expect(statut("Réglez d'abord le bloc en conflit.")).toBeDefined())
    choisir("Objet", "Supprimer")
    expect(api.envoyes).toHaveLength(1)

    // Un second refus pendant la résolution : la nouvelle version s'affiche, le texte final est gardé.
    fireEvent.change(screen.getByRole("textbox", { name: "Texte final" }), { target: { value: "Texte final" } })
    api.refuser("stale_revision", 409)
    fireEvent.click(bouton("Enregistrer le texte final"))
    await waitFor(() => expect(rafraichir).toHaveBeenCalledTimes(2))
    relire({ blocs: [PAGE[0], { ...bloc(ID.objet, "paragraph", "Texte de Claire, bis"), revision: 5 }, PAGE[2], PAGE[3]] })
    expect(await screen.findByText("Le bloc a encore changé.")).toHaveAttribute("role", "alert")
    expect(screen.getByRole("textbox", { name: "Version enregistrée" })).toHaveValue("Texte de Claire, bis")
    expect(screen.getByRole("textbox", { name: "Texte final" })).toHaveValue("Texte final")
    expect(screen.getByRole("textbox", { name: "Votre texte, non enregistré" })).toHaveValue("Texte de Léa, suite")

    // Au clavier : le focus sur le geste, puis le geste ; le panneau part avec son bouton, le focus va à la poignée du bloc réglé.
    act(() => bouton("Enregistrer le texte final").focus())
    fireEvent.click(bouton("Enregistrer le texte final"))
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Texte final" })).toBeNull())
    expect(api.envoyes[api.envoyes.length - 1].ops).toEqual([
      { op: "replace_block", block: ID.objet, revision: 5, input: { type: "paragraph", text: "Texte final", data: {} } },
    ])
    await waitFor(() => expect(document.activeElement).toBe(bouton("Actions sur ce bloc — Texte final")))
    expect(screen.getByRole("textbox", { name: "Modifier ce titre — Objet" })).not.toHaveAttribute("aria-readonly")
    expect(ouvrirLeChamp("Modifier ce titre — Objet")).not.toHaveAttribute("readonly")
  })

  it("should keep a block modified while being deleted, and let an abandoned text give way to the saved version, the queue running again", async () => {
    const { relire, rafraichir } = monter()
    // Léa supprime B, que Claire vient de modifier : B est gardé et reparaît, relu.
    api.refuser("stale_revision", 409)
    choisir("Objet de la relance", "Supprimer")
    await waitFor(() => expect(rafraichir).toHaveBeenCalledTimes(1))
    const claire = [PAGE[0], { ...bloc(ID.objet, "paragraph", "Texte de Claire"), revision: 4 }, PAGE[2], PAGE[3]]
    relire({ blocs: claire })
    expect(await screen.findByText("Ce bloc a été modifié pendant que vous le supprimiez : il est gardé.")).toHaveAttribute("role", "alert")
    expect(texteDuBloc("Modifier ce texte — Texte de Claire")).toBe("Texte de Claire")

    // Léa écrit B, que Claire modifie de nouveau : conflit ; elle abandonne son texte.
    api.refuser("stale_revision", 409)
    ecrireEtEchapper(ouvrirLeChamp("Modifier ce texte — Texte de Claire"), "Texte de Léa")
    await waitFor(() => expect(rafraichir).toHaveBeenCalledTimes(2))
    relire({ blocs: [PAGE[0], { ...bloc(ID.objet, "paragraph", "Texte de Claire, bis"), revision: 5 }, PAGE[2], PAGE[3]] })
    fireEvent.click(await screen.findByRole("button", { name: "Abandonner mon texte" }))
    expect(screen.getByText("Abandonner votre texte et garder la version enregistrée ?")).toBeInTheDocument()
    await waitFor(() => expect(document.activeElement).toBe(bouton("Garder")))
    fireEvent.keyDown(bouton("Garder"), { key: "Escape" })
    await waitFor(() => expect(document.activeElement).toBe(bouton("Abandonner mon texte")))
    fireEvent.click(bouton("Abandonner mon texte"))
    fireEvent.click(bouton("Abandonner"))
    await waitFor(() => expect(document.activeElement).toBe(bouton("Actions sur ce bloc — Texte de Claire, bis")))
    expect(screen.queryByRole("textbox", { name: "Texte final" })).toBeNull()
    expect(texteDuBloc("Modifier ce texte — Texte de Claire, bis")).toBe("Texte de Claire, bis")

    // La file repart : le geste suivant part, sur la version gardée.
    const envoyes = api.envoyes.length
    ecrireEtEchapper(ouvrirLeChamp("Modifier cette liste — Lire le devis Écrire"), "Lire")
    await waitFor(() => expect(api.envoyes).toHaveLength(envoyes + 1))
    expect(api.envoyes[envoyes].ops?.[0]).toMatchObject({ op: "replace_block", block: ID.liste, revision: 3 })
  })

  it("should offer to reinsert a text whose block was deleted meanwhile, and ask for a retry when the page was published meanwhile", async () => {
    const { relire, rafraichir } = monter()
    api.refuser("stale_revision", 409)
    ecrireEtEchapper(ouvrirLeChamp("Modifier ce texte — Objet de la relance"), "Texte de Léa")
    await waitFor(() => expect(rafraichir).toHaveBeenCalledTimes(1))
    relire({ blocs: [PAGE[0], PAGE[2], PAGE[3]] })
    expect(await screen.findByText("Ce bloc a été supprimé pendant que vous écriviez.")).toBeInTheDocument()
    act(() => bouton("Réinsérer mon texte").focus())
    fireEvent.click(bouton("Réinsérer mon texte"))
    await waitFor(() => expect(document.activeElement).toBe(bouton("Actions sur ce bloc — Texte de Léa")))
    await waitFor(() => expect(api.envoyes).toHaveLength(2))
    expect(api.envoyes[1].ops).toEqual([{ op: "insert_after", block: ID.titre, input: { type: "paragraph", text: "Texte de Léa", data: {} } }])

    api.refuser("stale_revision", 409)
    ecrireEtEchapper(ouvrirLeChamp("Modifier cette liste — Lire le devis Écrire"), "Lire le devis")
    await waitFor(() => expect(rafraichir).toHaveBeenCalledTimes(2))
    relire({ blocs: [PAGE[0], PAGE[2], PAGE[3]], revision: 5 })
    expect(await screen.findByText("La page a changé pendant que vous écriviez : réessayez.")).toHaveAttribute("role", "alert")
    fireEvent.click(bouton("Réessayer"))
    await waitFor(() => expect(api.envoyes).toHaveLength(4))
    expect(api.envoyes[3]).toMatchObject({ base_revision: 5, ops: [{ op: "replace_block", block: ID.liste, revision: 3 }] })
  })
})

describe("EditeurDeBlocs, refus et pannes (AC18 d'E05-S02)", () => {
  it("should say a refusal near the kept text, and copy it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })
    monter()
    api.refuser("forbidden", 403)
    ecrireEtEchapper(ouvrirLeChamp("Modifier ce texte — Objet de la relance"), "Texte refusé")
    expect(await screen.findByText("Vous n'avez pas le droit de modifier cette page. Votre texte est toujours là : copiez-le avant de quitter l'écran.")).toHaveAttribute("role", "alert")
    fireEvent.click(bouton("Copier mon texte"))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Texte refusé"))
    expect(await screen.findByRole("button", { name: "Texte copié" })).toBeInTheDocument()
    expect(texteDuBloc("Modifier ce texte — Texte refusé")).toBe("Texte refusé")
  })

  it("should keep the following gestures waiting behind a network failure, and send them after « Réessayer »", async () => {
    monter()
    api.couper()
    ecrireEtEchapper(ouvrirLeChamp("Modifier ce texte — Objet de la relance"), "Texte 1")
    expect(await screen.findByText("La requête n'a pas abouti. Réessayez dans un instant : votre texte est toujours là.")).toHaveAttribute("role", "alert")
    ecrireEtEchapper(ouvrirLeChamp("Modifier cette liste — Lire le devis Écrire"), "Lire")
    expect(api.envoyes).toHaveLength(1)

    // L'alerte part avec « Réessayer » : le focus va à la poignée du bloc du geste refusé.
    act(() => bouton("Réessayer").focus())
    fireEvent.click(bouton("Réessayer"))
    await waitFor(() => expect(document.activeElement).toBe(bouton("Actions sur ce bloc — Texte 1")))
    await waitFor(() => expect(api.envoyes).toHaveLength(3))
    expect(api.envoyes[1].ops?.[0]).toMatchObject({ op: "replace_block", block: ID.objet, input: { text: "Texte 1" } })
    expect(api.envoyes[2].ops?.[0]).toMatchObject({ op: "replace_block", block: ID.liste, input: { data: { items: ["Lire"] } } })
  })

  // Une relecture ne dit rien de ces refus : une personne retirée ou une organisation partie quitteraient l'écran sans leur texte.
  it.each([
    { cas: "not_found", code: "not_found", statut: 404, message: "Ce bloc ou cette page n'existe plus. Votre texte est toujours là : copiez-le avant de recharger.", gestes: ["Copier mon texte", "Recharger la page"] },
    { cas: "too_large", code: "too_large", statut: 413, message: "Ce bloc est trop long, ou la page est pleine : découpez le texte ou placez-le dans une autre page.", gestes: ["Réessayer"] },
    { cas: "an expired session (forbidden, 401)", code: "forbidden", statut: 401, message: "Votre session a expiré. Reconnectez-vous.", gestes: ["Copier mon texte", "Réessayer"] },
    { cas: "not_member", code: "not_member", statut: 403, message: "Vous ne faites plus partie de cette organisation.", gestes: ["Copier mon texte"] },
    { cas: "unknown_org", code: "unknown_org", statut: 404, message: "Cette adresse ne sert plus d'organisation. Rechargez la page.", gestes: ["Copier mon texte"] },
  ])("should say $cas near the kept text, without rereading the page", async ({ code, statut: statutHttp, message, gestes }) => {
    const { rafraichir } = monter()
    api.refuser(code, statutHttp)
    ecrireEtEchapper(ouvrirLeChamp("Modifier ce texte — Objet de la relance"), "Texte long")
    expect(await screen.findByText(message)).toHaveAttribute("role", "alert")
    for (const geste of gestes) expect(bouton(geste)).toBeInTheDocument()
    expect(rafraichir).not.toHaveBeenCalled()
  })
})

// E05-S11, lot b : l'indication d'enregistrement dans la carte du document, qui se tait 5 s après la dernière écriture
// réussie, titre compris (AC-1, AC-2) ; les pages citées lues dans la phrase au repos (AC-26, AC-27) ; tout le texte d'un
// bloc sélectionné ouvre le menu de sa poignée, sans prendre le focus (AC-28). La position de l'indication (rien ne
// bouge) se mesure dans un navigateur : `tests/e2e/e05s11-page.spec.ts`.
describe("EditeurDeBlocs, indication d'enregistrement (E05-S11, AC-1, AC-2)", () => {
  /** L'indication d'enregistrement de la carte : une seule région pour les blocs, le titre et la publication. */
  function indication(): HTMLElement {
    const region = document.querySelector<HTMLElement>(".oto-indication-d-enregistrement")
    if (!region) throw new Error("indication d'enregistrement absente")
    return region
  }

  it("should say « Enregistrement… » then « Enregistré. » in the card, silent 5 s after the last successful write, the title included", async () => {
    vi.useFakeTimers()
    monterLEditeur(PAGE, {
      avant: (
        <h1>
          <TitreModifiable titre="Modèle de relance" revisionServie={4} tamponServi={null} />
        </h1>
      ),
    })
    // Dans la carte du document (l'îlot de lecture), montée vide.
    expect(indication()).toHaveAttribute("role", "status")
    expect(indication().closest(".oto-island-body")).not.toBeNull()
    expect(indication()).toBeEmptyDOMElement()

    const texte = ouvrirLeChamp("Modifier ce texte — Objet de la relance")
    act(() => texte.focus())
    fireEvent.change(texte, { target: { value: "Objet revu" } })
    fireEvent.keyDown(texte, { key: "Escape" })
    expect(indication()).toHaveTextContent("Enregistrement…")
    expect(indication()).toHaveAttribute("aria-busy", "true")
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(indication()).toHaveTextContent("Enregistré.")
    expect(indication()).toHaveAttribute("aria-busy", "false")

    // Une nouvelle écriture, celle du titre écrit en place, le remplace par « Enregistrement… », dans la même région.
    await act(() => vi.advanceTimersByTimeAsync(1_000))
    const titre = ouvrirLeChamp("Titre")
    act(() => titre.focus())
    fireEvent.change(titre, { target: { value: "Modèle revu" } })
    act(() => titre.blur())
    expect(indication()).toHaveTextContent("Enregistrement…")
    expect(within(screen.getByRole("heading", { level: 1 })).queryByRole("status")).toBeNull()
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(api.envoyes.at(-1)).toMatchObject({ title: "Modèle revu" })
    expect(indication()).toHaveTextContent("Enregistré.")

    // La publication seule part 3 s après la dernière frappe, et se dit de même ; 5 s après elle, plus rien.
    await act(() => vi.advanceTimersByTimeAsync(3_000))
    expect(api.envoyes.at(-1)).toMatchObject({ publish: true })
    expect(indication()).toHaveTextContent("Enregistré.")
    await act(() => vi.advanceTimersByTimeAsync(4_999))
    expect(indication()).toHaveTextContent("Enregistré.")
    await act(() => vi.advanceTimersByTimeAsync(1))
    expect(indication()).toBeEmptyDOMElement()
  })

  it("should keep the alert of a refused write and say nothing in the card", async () => {
    monterLEditeur()
    api.refuser("forbidden", 403)
    const texte = ouvrirLeChamp("Modifier ce texte — Objet de la relance")
    act(() => texte.focus())
    fireEvent.change(texte, { target: { value: "Objet revu" } })
    fireEvent.keyDown(texte, { key: "Escape" })
    expect(await screen.findByRole("alert")).toHaveTextContent(/Vous n'avez pas le droit de modifier cette page/)
    expect(indication()).toBeEmptyDOMElement()
  })
})

describe("EditeurDeBlocs, pages citées au repos (E05-S11, AC-26, AC-27)", () => {
  it("should read a cited page by its title in the sentence, a page with no visible target as plain text, and follow a moved one once the links are read", async () => {
    let servir: (lu: { data: Record<string, unknown> }) => void = () => {}
    const liens = new Promise<{ data: Record<string, unknown> }>((resolve) => (servir = resolve))
    const cibles: CiblesDesLiens = { "ventes/grille": { titre: "Grille tarifaire", chemin: "ventes/grille" }, "ventes/perdue": null, "ventes/ancien": null }
    await act(async () => {
      monterLEditeur([bloc(PAGE[1].id, "paragraph", "Voir [[ventes/grille]], [[ventes/perdue]] et [[ventes/ancien]].")], { cibles, liens })
    })
    const texte = screen.getByRole("textbox", { name: /^Modifier ce texte — Voir/ })
    const rendu = texte.parentElement?.querySelector<HTMLElement>(".oto-block-rendu")
    if (!rendu) throw new Error("rendu au repos absent")
    expect(rendu).toHaveTextContent("Voir Grille tarifaire, perdue et ancien.")
    expect(within(rendu).getAllByRole("link").map((lien) => [lien.textContent, lien.getAttribute("href")])).toEqual([["Grille tarifaire", "/n/ventes/grille"]])
    // Le texte brut reste celui du champ : c'est lui qui s'écrit au focus.
    expect(texteDuBloc(/^Modifier ce texte — Voir/)).toBe("Voir [[ventes/grille]], [[ventes/perdue]] et [[ventes/ancien]].")
    await act(async () => {
      servir({ data: { links_out: [{ path: "ventes/ancien", status: "moved", title: "Nouveau", moved_to: "conseil/nouveau" }], links_out_total: 1, links_in: [], links_in_total: 0 } })
    })
    await waitFor(() => expect(within(rendu).getByRole("link", { name: "Nouveau" })).toHaveAttribute("href", "/n/conseil/nouveau"))
  })
})

describe("EditeurDeBlocs, tout sélectionner (E05-S11, AC-28)", () => {
  /** La sélection posée dans le champ (⌘A, un glissé), puis la touche relâchée, où React relit la sélection (`onSelect`). */
  function selectionner(element: HTMLTextAreaElement, debut: number, fin: number) {
    element.setSelectionRange(debut, fin)
    fireEvent.keyUp(element, { key: "a", ctrlKey: true })
  }

  it("should open the menu of the handle when the whole text is selected, without taking the focus, and close it on Escape or the next keystroke", () => {
    monterLEditeur()
    const texte = ouvrirLeChamp("Modifier ce texte — Objet de la relance")
    const poignee = screen.getByRole("button", { name: "Actions sur ce bloc — Objet de la relance" })
    act(() => texte.focus())

    // Une sélection partielle n'ouvre rien.
    selectionner(texte, 0, 5)
    expect(screen.queryByRole("menu")).toBeNull()

    selectionner(texte, 0, texte.value.length)
    expect(screen.getByRole("menu")).toBeInTheDocument()
    expect(poignee).toHaveAttribute("aria-expanded", "true")
    expect(document.activeElement).toBe(texte)

    // Échap le ferme, rien d'autre : le focus reste dans le texte.
    fireEvent.keyDown(texte, { key: "Escape" })
    expect(screen.queryByRole("menu")).toBeNull()
    expect(document.activeElement).toBe(texte)
    expect(api.envoyes).toHaveLength(0)

    // La frappe suivante le ferme, et s'écrit ; une touche de modification seule ne le ferme pas.
    selectionner(texte, 0, texte.value.length)
    fireEvent.keyDown(texte, { key: "Control" })
    expect(screen.getByRole("menu")).toBeInTheDocument()
    fireEvent.keyDown(texte, { key: "x" })
    expect(screen.queryByRole("menu")).toBeNull()
    expect(document.activeElement).toBe(texte)

    // Un choix du menu ouvert par la sélection s'exécute.
    selectionner(texte, 0, texte.value.length)
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Dupliquer" }))
    expect(screen.getAllByRole("textbox", { name: "Modifier ce texte — Objet de la relance" })).toHaveLength(2)
    expect(screen.queryByRole("menu")).toBeNull()
  })

  it("should open nothing when the selected text is empty", () => {
    monterLEditeur()
    const texte = ouvrirLeChamp("Modifier ce texte — Objet de la relance")
    act(() => texte.focus())
    fireEvent.change(texte, { target: { value: "   " } })
    selectionner(texte, 0, 3)
    expect(screen.queryByRole("menu")).toBeNull()
  })
})

// E11-S15, lot B : un bloc lu passe par `RenduDUnBloc`, comme à l'écran de lecture. Ce que la feuille de style en fait
// (teinte, bordures, hauteur) se contrôle à l'œil, dans les deux thèmes, à la campagne visuelle : jsdom ne calcule pas le
// rendu. Le clic et le menu contextuel d'un lien (AC-b9) sont dans `liens-en-edition.test.tsx`.
describe("EditeurDeBlocs, tableau simple et menu de la poignée (E11-S15, lot B)", () => {
  const TABLEAU = bloc("e1150000-0000-4000-8000-000000000001", "simple_table", null, { columns: ["Nom", "Montant"], rows: [["a", "1"]] })

  it("should mark the simple table, read and written, for its tinted header row and its cell fields bordered on hover or focus only (AC-b1)", () => {
    render(<RenduDUnBloc bloc={TABLEAU} Lien="a" hrefDuChemin={(chemin) => `/n/${chemin}`} routeDesFichiers="/api/platform/public/t/files" />)
    expect(screen.getByRole("table")).toHaveAttribute("data-simple")
    cleanup()
    monterLEditeur([TABLEAU])
    const grille = screen.getByRole("table")
    expect(grille).toHaveAttribute("data-simple")
    expect(within(grille).getAllByRole("textbox")).toHaveLength(4)
  })

  // 1.1.5 : la colonne centrée du lecteur (`content.css`) exclut `data-reading="blocs"` ; le corps d'écriture garde sa pleine largeur.
  it("should mark the writing body apart from the centered reading column", () => {
    monterLEditeur([TABLEAU])
    expect(screen.getByRole("table").closest(".oto-island-body")).toHaveAttribute("data-reading", "blocs")
  })

  it("should open the menu of a table's handle as the handle menu, whose height follows its entries (AC-b5)", () => {
    monterLEditeur([TABLEAU])
    fireEvent.click(screen.getByRole("button", { name: "Actions sur ce bloc — Nom Montant" }))
    const menu = screen.getByRole("menu")
    expect(menu).toHaveClass("oto-menu-de-poignee")
    expect(within(menu).getByRole("menuitem", { name: "Ajouter une rangée après" })).toBeInTheDocument()
  })
})

describe("EditeurDeBlocs, texte marqué au repos et « @ » avant toute frappe (E11-S15, lot B)", () => {
  /** Le rendu au repos posé sur un champ, dans sa case. */
  function renduDe(element: HTMLElement): HTMLElement {
    const rendu = element.parentElement?.querySelector(".oto-block-rendu")
    if (!(rendu instanceof HTMLElement)) throw new Error("rendu au repos absent")
    return rendu
  }

  it("should render at rest the marks of a text without a link, bold on a part of it, italic, code and strikethrough, and no HTML (AC-b6)", () => {
    const texte = "Un **gras** ici, *un* et _deux_, du `code` et ~~barré~~"
    monterLEditeur([
      bloc("e1150000-0000-4000-8000-000000000004", "paragraph", texte),
      bloc("e1150000-0000-4000-8000-000000000006", "paragraph", "Voir <img src=x onerror=alert(1)> **b**"),
      bloc("e1150000-0000-4000-8000-000000000005", "paragraph", "Objet de la relance"),
    ])
    const marque = screen.getByRole("textbox", { name: /^Modifier ce texte — Un gras ici/ })
    // Le champ garde la source ; son rendu, posé dessus, la lit comme la lecture.
    expect(texteDuBloc(/^Modifier ce texte — Un gras ici/)).toBe(texte)
    expect(marque).toHaveAttribute("data-rendu")
    const rendu = renduDe(marque)
    expect(rendu).toHaveTextContent("Un gras ici, un et deux, du code et barré")
    expect(Array.from(rendu.querySelectorAll("strong, em, code, s"), (une) => `${une.tagName}:${une.textContent}`)).toEqual([
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

  it("should list the recent contents as « @ » opens, choose one with the keyboard, and give way to the search at the first letter typed (AC-b4)", async () => {
    const RECENTS = [
      { path: "ventes/devis", kind: "page", title: "Devis", snippet: null },
      { path: "ventes/suivi", kind: "table", title: "Suivi des prospects", snippet: null },
    ]
    const TROUVES = [{ path: "ventes/grille_tarifaire", kind: "page", title: "Grille tarifaire", snippet: null }]
    const RECENTS_HORS_DE_LA_PAGE = "/api/platform/search/recent?exclude=ventes%2Fmodele_relance"
    const titresDesOptions = () => screen.queryAllByRole("option").map((option) => option.textContent)
    // Les lectures de « @ » simulées ; les écritures vont à la file simulée.
    const ecriture = api.fetchMock.getMockImplementation()
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
    monterLEditeur([bloc("e1150000-0000-4000-8000-000000000004", "paragraph", "Voir")])
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
    await screen.findByRole("textbox", { name: "Modifier ce texte — Voir Suivi des prospects" })
    const lie = champ("Modifier ce texte — Voir Suivi des prospects")
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
