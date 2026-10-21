import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { CiblesDesLiens } from "../../../packages/plateforme/ui/noeud/en-ligne"
import { ouvrirLeChamp, texteDuBloc } from "../../helpers/champ-du-bloc"
import { bloc, monterLEditeur, simulerLAPI } from "../../helpers/noeud"

// Les liens réduits à leur titre pendant la frappe (story `liens-en-edition`) : le champ montre `[[Titre]]`, dessine
// crochets et titre sur lui au focus (AC-1, AC-2), et chaque frappe, copie, coupe ou Entrée garde la source (AC-3,
// AC-7, AC-8). Les bords d'un lien et l'annulation se prouvent en fonctions pures : `tests/unit/ui-editeur-liens-masques.test.ts`.
// Puis l'éditeur après les retours de la démo (E11-S06) : une puce, un numéro ou une case par élément d'une liste, portés
// par la copie de ses éléments (lot a) ; le panneau « Lien » ouvert par le curseur dans un lien ou par le menu contextuel
// d'un lien au repos (E11-S15, AC-b9 : un clic le suit), qui réécrit le lien seul par une frappe (lot b) ; le correcteur du
// navigateur (E11-S15, AC-b7). Sous la file d'écriture (`monterLEditeur`), `fetch` simulé pour `POST /api/platform/nodes`.
// La place des repères sur les lignes repliées se mesure dans un navigateur : `tests/e2e/e11s06-editeur.spec.ts`.

const ID = { texte: "e1500000-0000-4000-8000-000000000001", liste: "e1500000-0000-4000-8000-000000000002" } as const
const TEXTE = "Voir [[prive/moi/taches#k1|Mes taches]] et [le site](https://exemple.fr/doc) demain"
/** Au focus : « Voir », le lien réduit de 5 à 19 (titre de 7 à 17), « et », le lien web réduit de 23 à 32. */
const MONTRE = "Voir [[Mes taches]] et [le site] demain"
const NOM = "Modifier ce texte — Voir Mes taches et"
/** Le bloc d'après une coupe ou une scission : « et le site demain ». */
const SUITE = "Modifier ce texte — et le site demain"

let api: ReturnType<typeof simulerLAPI>

/** Une frappe du champ : son texte d'arrivée, et le curseur posé là où la frappe s'arrête, que le champ lit avec elle. */
function frapper(champ: HTMLTextAreaElement, valeur: string, curseur: number) {
  fireEvent.change(champ, { target: { value: valeur, selectionStart: curseur, selectionEnd: curseur } })
}

/** Le texte du bloc envoyé par Échap. */
async function envoye(champ: HTMLTextAreaElement) {
  fireEvent.keyDown(champ, { key: "Escape" })
  await waitFor(() => expect(api.envoyes).toHaveLength(1))
  return api.envoyes[0].ops?.[0]
}

beforeEach(() => {
  api = simulerLAPI()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("Liens réduits à leur titre pendant la frappe (story liens-en-edition)", () => {
  it("should show each labelled link by its title at focus, drawn over the field, the field keeping the source", () => {
    monterLEditeur([bloc(ID.texte, "paragraph", TEXTE)])
    const champ = ouvrirLeChamp(NOM)
    expect(champ).toHaveValue(MONTRE)
    expect(champ).toHaveAttribute("data-miroir")
    expect(texteDuBloc(NOM)).toBe(TEXTE)
    const miroir = champ.parentElement?.querySelector(".oto-block-miroir")
    expect(miroir).toHaveTextContent(MONTRE)
    expect(miroir).toHaveAttribute("aria-hidden", "true")
    expect(Array.from(miroir?.querySelectorAll(".oto-lien-reduit-titre") ?? [], (titre) => titre.textContent)).toEqual(["Mes taches", "le site"])
    expect(Array.from(miroir?.querySelectorAll(".oto-lien-reduit-crochet") ?? [], (crochet) => crochet.textContent)).toEqual(["[[", "]]", "[", "]"])
  })

  it("should send the source with the title typed in the link and the text typed beside it, every path and address kept", async () => {
    monterLEditeur([bloc(ID.texte, "paragraph", TEXTE)])
    const champ = ouvrirLeChamp(NOM)
    frapper(champ, "Voir [[Mes taches!]] et [le site] demain", 18)
    frapper(champ, "Voir [[Mes taches!]] et [le site] demain matin", 46)
    expect(champ).toHaveValue("Voir [[Mes taches!]] et [le site] demain matin")
    expect(await envoye(champ)).toMatchObject({
      op: "replace_block",
      input: { type: "paragraph", text: "Voir [[prive/moi/taches#k1|Mes taches!]] et [le site](https://exemple.fr/doc) demain matin" },
    })
  })

  it("should copy and cut the source of a selection, a link selected whole with its path", () => {
    monterLEditeur([bloc(ID.texte, "paragraph", TEXTE)])
    const champ = ouvrirLeChamp(NOM)
    const presse = { setData: vi.fn() }
    champ.setSelectionRange(0, 19)
    fireEvent.copy(champ, { clipboardData: presse })
    expect(presse.setData).toHaveBeenCalledWith("text/plain", "Voir [[prive/moi/taches#k1|Mes taches]]")
    champ.setSelectionRange(0, 20)
    fireEvent.cut(champ, { clipboardData: presse })
    expect(presse.setData).toHaveBeenLastCalledWith("text/plain", "Voir [[prive/moi/taches#k1|Mes taches]] ")
    expect(champ).toHaveValue("et [le site] demain")
    expect(texteDuBloc(SUITE)).toBe("et [le site](https://exemple.fr/doc) demain")
  })

  it("should split at the caret of the text shown with Enter, the link kept whole in the block before", async () => {
    monterLEditeur([bloc(ID.texte, "paragraph", TEXTE)])
    const champ = ouvrirLeChamp(NOM)
    act(() => champ.setSelectionRange(20, 20))
    fireEvent.keyDown(champ, { key: "Enter" })
    await waitFor(() => expect(api.envoyes.length).toBeGreaterThan(0))
    expect(api.envoyes[0].ops?.[0]).toMatchObject({ op: "replace_block", input: { text: "Voir [[prive/moi/taches#k1|Mes taches]] " } })
    expect(texteDuBloc(SUITE)).toBe("et [le site](https://exemple.fr/doc) demain")
  })

  it("should draw the reduced links of a list in its copy at focus, line by line", () => {
    monterLEditeur([bloc(ID.liste, "list", null, { items: ["un [[a/b|Un]]", "deux [[c/d|Deux]]"] })])
    const champ = ouvrirLeChamp("Modifier cette liste — un Un deux Deux")
    expect(champ).toHaveValue("un [[Un]]\ndeux [[Deux]]")
    const copie = champ.parentElement?.querySelector(".oto-block-copie")
    expect(Array.from(copie?.querySelectorAll(".oto-block-element-texte") ?? [], (ligne) => ligne.textContent)).toEqual(["un [[Un]]", "deux [[Deux]]"])
    expect(copie?.querySelectorAll(".oto-lien-reduit-titre")).toHaveLength(2)
  })
})

describe("EditeurDeBlocs après les retours de la démo (E11-S06)", () => {
  const ID = {
    texte: "e1100000-0000-4000-8000-000000000001",
    puces: "e1100000-0000-4000-8000-000000000002",
    numeros: "e1100000-0000-4000-8000-000000000003",
    cases: "e1100000-0000-4000-8000-000000000004",
    code: "e1100000-0000-4000-8000-000000000005",
    web: "e1100000-0000-4000-8000-000000000006",
    objet: "e1100000-0000-4000-8000-000000000007",
  } as const

  /** « Voir » (5 caractères), le lien de 5 à 39, puis « demain ». */
  const TEXTE = "Voir [[prive/moi/taches#k1|Mes tâches]] demain"
  /** Ce que montre son champ au focus (story `liens-en-edition`) : le lien réduit à son titre, de 5 à 19. */
  const MONTRE = "Voir [[Mes tâches]] demain"
  const NOM = "Modifier ce texte — Voir Mes tâches demain"
  const CIBLES: CiblesDesLiens = { "prive/moi/taches": { titre: "Mes tâches", chemin: "prive/moi/taches" } }

  const bouton = (nom: string) => screen.getByRole("button", { name: nom })
  const focusSur = (element: HTMLElement) => waitFor(() => expect(document.activeElement).toBe(element))
  const panneau = () => screen.queryByRole("group", { name: "Modifier le lien" })
  const libelle = () => screen.getByRole("textbox", { name: "Libellé" })

  function zone(element: HTMLElement): HTMLTextAreaElement {
    if (!(element instanceof HTMLTextAreaElement)) throw new Error("champ de texte attendu")
    return element
  }

  /** Le champ d'un bloc, ouvert et focalisé : un bloc qu'on ne touche pas se lit, son focus monte le `<textarea>` (1.1.3). */
  const champ = (nom: string) => ouvrirLeChamp(nom)

  /** Le bloc par son texte, lu ou déjà ouvert, sans l'ouvrir : relu après chaque ouverture ou fermeture. */
  function champDe(valeur: string): HTMLElement {
    const trouve = screen
      .getAllByRole("textbox")
      .find((element) => element.hasAttribute("data-champ") && texteDuBloc(element.getAttribute("aria-label") ?? "", element.parentElement ?? undefined) === valeur)
    if (!trouve) throw new Error(`champ « ${valeur} » attendu`)
    return trouve
  }

  /** Le champ d'un bloc par son texte, ouvert et focalisé : le curseur s'y pose. */
  function ouvrirDe(valeur: string): HTMLTextAreaElement {
    const lu = champDe(valeur)
    return ouvrirLeChamp(lu.getAttribute("aria-label") ?? "", lu.parentElement ?? undefined)
  }

  /** Une couche posée sur le champ, dans sa case : la copie d'une liste, ou le rendu au repos d'un Texte. */
  function couche(element: HTMLElement, classe: ".oto-block-copie" | ".oto-block-rendu"): HTMLElement {
    const trouvee = element.parentElement?.querySelector(classe)
    if (!(trouvee instanceof HTMLElement)) throw new Error(`${classe} absente`)
    return trouvee
  }

  /** Le repère dessiné de chaque élément de la copie d'une liste, vide pour un élément sans repère. */
  const reperesDe = (element: HTMLElement) =>
    Array.from(couche(element, ".oto-block-copie").querySelectorAll(".oto-block-element"), (un) => un.querySelector(".oto-block-repere")?.textContent ?? "")

  /** Le curseur posé dans le champ, puis la touche relâchée, où React relit la sélection (`onSelect`). */
  function placer(element: HTMLTextAreaElement, position: number) {
    element.setSelectionRange(position, position)
    fireEvent.keyUp(element, { key: "ArrowRight" })
  }

  /** Un clic sur un lien : `true` s'il serait suivi. Le défaut est lu, puis empêché : jsdom ne navigue pas. */
  function cliquer(lien: HTMLElement, init: MouseEventInit = {}): boolean {
    let suivi = false
    const lire = (evenement: Event) => {
      suivi = !evenement.defaultPrevented
      evenement.preventDefault()
    }
    document.addEventListener("click", lire)
    fireEvent.click(lien, init)
    document.removeEventListener("click", lire)
    return suivi
  }

  /**
   * Le menu contextuel d'un lien : clic droit, ou touche Menu et Maj+F10 sur le lien atteint au clavier, qui lui envoient le
   * même `contextmenu` ; `true` si celui du navigateur s'ouvrirait.
   */
  const menuContextuel = (lien: HTMLElement) => fireEvent.contextMenu(lien)

  const lienAuRepos = (element: HTMLElement, nom: string) => within(couche(element, ".oto-block-rendu")).getByRole("link", { name: nom })

  const TROUVES = [
    { path: "ventes/grille_tarifaire", kind: "page", title: "Grille tarifaire", snippet: null },
    { path: "ventes/grille_remises", kind: "page", title: "Grille des remises", snippet: null },
  ]

  /** La recherche de « Chercher une page » simulée ; les écritures vont à la file simulée. */
  function simulerLaRecherche() {
    const ecriture = api.fetchMock.getMockImplementation()
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (adresse, init) => {
        if (!String(adresse).includes("/api/platform/search?")) return ecriture ? ecriture(adresse, init) : new Response(null, { status: 500 })
        return new Response(JSON.stringify({ data: { matches: TROUVES, more: 0 } }), { status: 200, headers: { "content-type": "application/json" } })
      }),
    )
  }

  describe("EditeurDeBlocs, un repère par élément (E11-S06, AC-a1 à AC-a5)", () => {
    it("should draw one hidden bullet or number per first-level item, none for a sub-item, and one named box per checklist item, at rest and at focus", () => {
      const puces = bloc(ID.puces, "list", null, { items: [{ text: "Premier", children: { items: ["sous"] } }, "Second"] })
      const numeros = bloc(ID.numeros, "list", null, { items: ["a", { text: "b", children: { ordered: true, items: ["c"] } }, "d"], ordered: true, start: 3 })
      const cases = bloc(ID.cases, "checklist", null, { items: [{ text: "Lire", checked: false }, { text: "Écrire", checked: true }] })
      monterLEditeur([puces, numeros, cases])
      expect(reperesDe(champDe("Premier\n  - sous\nSecond"))).toEqual(["•", "", "•"])
      expect(reperesDe(champDe("a\nb\n  1. c\nd"))).toEqual(["3.", "4.", "", "5."])
      // Les repères et le texte brut de la copie se taisent : le champ, nommé « liste », se lit seul.
      for (const repere of document.querySelectorAll(".oto-block-copie[data-kind='list'] .oto-block-repere")) expect(repere).toHaveAttribute("aria-hidden", "true")
      expect(couche(champDe("a\nb\n  1. c\nd"), ".oto-block-copie").querySelectorAll("[data-brut][aria-hidden='true']")).toHaveLength(4)
      // Une case accessible par élément, au repos comme au focus.
      const nomsDesCases = () => screen.getAllByRole("checkbox").map((une) => une.getAttribute("aria-label"))
      expect(nomsDesCases()).toEqual(["Cocher « Lire »", "Cocher « Écrire »"])
      act(() => champDe("Lire\nÉcrire").focus())
      expect(nomsDesCases()).toEqual(["Cocher « Lire »", "Cocher « Écrire »"])
    })

    it("should follow the rendered text at rest in a list whose item carries a link, and the text shown at focus, its link reduced to its title", () => {
      const valeur = "un\nVoir [[prive/moi/taches|Mes tâches]] demain"
      monterLEditeur([bloc(ID.puces, "list", null, { items: ["un", "Voir [[prive/moi/taches|Mes tâches]] demain"] })])
      const liste = champDe(valeur)
      const copie = couche(liste, ".oto-block-copie")
      expect(within(copie).getByRole("link", { name: "Mes tâches" })).toHaveAttribute("href", "/n/prive/moi/taches")
      expect(copie).not.toHaveTextContent("[[")
      expect(reperesDe(liste)).toEqual(["•", "•"])
      act(() => liste.focus())
      expect(within(copie).queryByRole("link")).toBeNull()
      expect(copie).toHaveTextContent("Voir [[Mes tâches]] demain")
      expect(copie).not.toHaveTextContent("prive/moi/taches")
      // Le focus a monté le champ à la place du bloc lu : il se relit.
      expect(reperesDe(champDe(valeur))).toEqual(["•", "•"])
    })
  })

  describe("EditeurDeBlocs, le panneau « Lien » (E11-S06, lot b)", () => {
    it("should open under the field when the cursor is strictly in a link, the focus staying in the field that it describes, and never with « @ » open nor in code", () => {
      monterLEditeur([bloc(ID.texte, "paragraph", TEXTE), bloc(ID.code, "code", "[[prive/moi/taches]]", { language: "sql" })])
      const texte = champ(NOM)
      act(() => texte.focus())
      placer(texte, 10)
      expect(panneau()).not.toBeNull()
      expect(document.activeElement).toBe(texte)
      expect(texte).toHaveAccessibleDescription("Lien vers « Mes tâches ». Alt+Entrée pour le modifier.")
      // Sur un bord du lien, le curseur n'y est pas.
      placer(texte, 5)
      expect(panneau()).toBeNull()
      placer(texte, 19)
      expect(panneau()).toBeNull()
      placer(texte, 18)
      expect(panneau()).not.toBeNull()
      // « @ » ouvert : sa liste, jamais le panneau.
      fireEvent.change(texte, { target: { value: `${MONTRE} @` } })
      placer(texte, 10)
      expect(screen.getByRole("listbox", { name: "Contenus à citer" })).toBeInTheDocument()
      expect(panneau()).toBeNull()
      // Un code ne lit pas de lien.
      const code = champ("Modifier ce code — taches")
      act(() => code.focus())
      placer(code, 5)
      expect(panneau()).toBeNull()
    })

    it("should never open in a field read only during a conflict, a click following the link", async () => {
      const objet = bloc(ID.objet, "paragraph", "Objet")
      const lie = bloc(ID.texte, "paragraph", TEXTE)
      const { relire, rafraichir } = monterLEditeur([objet, lie])
      api.refuser("stale_revision", 409)
      const champObjet = champ("Modifier ce texte — Objet")
      act(() => champObjet.focus())
      fireEvent.change(champObjet, { target: { value: "Objet revu" } })
      fireEvent.keyDown(champObjet, { key: "Escape" })
      await waitFor(() => expect(rafraichir).toHaveBeenCalledTimes(1))
      relire([{ ...bloc(ID.objet, "paragraph", "Objet d'un autre"), revision: 4 }, lie])
      await screen.findByText(/Ce bloc a changé pendant que vous écriviez/)
      // Au repos, le bloc lu se dit en lecture seule ; ouvert, son champ l'est.
      const lu = screen.getByRole("textbox", { name: NOM })
      expect(lu).toHaveAttribute("aria-readonly", "true")
      expect(cliquer(lienAuRepos(lu, "Mes tâches"))).toBe(true)
      expect(menuContextuel(lienAuRepos(lu, "Mes tâches"))).toBe(true)
      const texte = champ(NOM)
      expect(texte).toHaveAttribute("readonly")
      placer(texte, 10)
      expect(panneau()).toBeNull()
    })

    it("should follow a link at rest on a plain click, open the panel from its context menu, by the pointer or the keyboard, focus in « Libellé », close it without writing when the focus leaves the row", async () => {
      monterLEditeur([bloc(ID.texte, "paragraph", TEXTE)], { cibles: CIBLES })
      // Le bloc, lu ou ouvert par le panneau, relu à chaque geste (1.1.3).
      const texte = () => screen.getByRole("textbox", { name: NOM })
      // Un clic suit le lien (E11-S15, AC-b9) : aucun panneau.
      expect(cliquer(lienAuRepos(texte(), "Mes tâches"))).toBe(true)
      expect(panneau()).toBeNull()
      // Au clavier : le lien atteint, la touche Menu ou Maj+F10 lui envoie `contextmenu` ; le menu du navigateur ne s'ouvre pas.
      act(() => lienAuRepos(texte(), "Mes tâches").focus())
      expect(menuContextuel(lienAuRepos(texte(), "Mes tâches"))).toBe(false)
      await focusSur(libelle())
      expect(libelle()).toHaveValue("Mes tâches")
      expect(screen.getByRole("radio", { name: "Page de la plateforme" })).toHaveAttribute("aria-checked", "true")
      expect(within(screen.getByRole("group", { name: "Modifier le lien" })).getByText("prive/moi/taches")).toBeInTheDocument()
      // Le focus quitte la rangée : le panneau se ferme, rien n'est écrit.
      fireEvent.change(libelle(), { target: { value: "Autre chose" } })
      act(() => bouton("Ailleurs").focus())
      expect(panneau()).toBeNull()
      expect(texteDuBloc(NOM)).toBe(TEXTE)
      // Échap dans le panneau, ouvert d'un clic droit : il se ferme, le focus revient au champ, le curseur après le lien.
      menuContextuel(lienAuRepos(texte(), "Mes tâches"))
      await focusSur(libelle())
      fireEvent.keyDown(libelle(), { key: "Escape" })
      expect(panneau()).toBeNull()
      const ouvert = zone(texte())
      await focusSur(ouvert)
      expect(ouvert.selectionStart).toBe(19)
      // Ctrl ou ⌘ : le lien est suivi, aucun panneau.
      act(() => bouton("Ailleurs").focus())
      expect(cliquer(lienAuRepos(texte(), "Mes tâches"), { ctrlKey: true })).toBe(true)
      expect(cliquer(lienAuRepos(texte(), "Mes tâches"), { metaKey: true })).toBe(true)
      expect(panneau()).toBeNull()
      expect(api.envoyes).toEqual([])
    })

    it("should lead to the panel with Alt+Enter from a list, and apply a new label to the link alone, as a keystroke, the focus back in the field after the link", async () => {
      const avant = "un\nVoir [[prive/moi/taches|Mes tâches]] demain"
      monterLEditeur([bloc(ID.puces, "list", null, { items: ["un", "Voir [[prive/moi/taches|Mes tâches]] demain"] })])
      const liste = ouvrirDe(avant)
      act(() => liste.focus())
      placer(liste, 12)
      expect(fireEvent.keyDown(liste, { key: "Enter", altKey: true })).toBe(false)
      await focusSur(libelle())
      expect(liste).toHaveValue("un\nVoir [[Mes tâches]] demain")
      fireEvent.change(libelle(), { target: { value: " Mes courses " } })
      fireEvent.keyDown(libelle(), { key: "Enter" })
      await waitFor(() => expect(liste).toHaveValue("un\nVoir [[Mes courses]] demain"))
      await focusSur(liste)
      expect(liste.selectionStart).toBe("un\nVoir [[Mes courses]]".length)
      expect(panneau()).toBeNull()
      fireEvent.keyDown(liste, { key: "Escape" })
      await waitFor(() => expect(api.envoyes).toHaveLength(1))
      expect(api.envoyes[0].ops?.[0]).toMatchObject({ op: "replace_block", input: { type: "list", data: { items: ["un", "Voir [[prive/moi/taches|Mes courses]] demain"] } } })
    })

    it("should read the link under the cursor in its list item, as the copy shows it, a code span opened in the item before not hiding it", async () => {
      // Un accent grave ouvert sur le premier élément se ferme sur le second : lu entier, le texte n'aurait pas de lien.
      const avant = "a `b\nVoir [[prive/moi/taches|Mes tâches]] c`"
      monterLEditeur([bloc(ID.puces, "list", null, { items: ["a `b", "Voir [[prive/moi/taches|Mes tâches]] c`"] })])
      const liste = ouvrirDe(avant)
      act(() => liste.focus())
      placer(liste, "a `b\nVoir [[".length)
      expect(panneau()).not.toBeNull()
      expect(liste).toHaveAccessibleDescription("Lien vers « Mes tâches ». Alt+Entrée pour le modifier.")
      fireEvent.keyDown(liste, { key: "Enter", altKey: true })
      await focusSur(libelle())
      fireEvent.change(libelle(), { target: { value: "Mes courses" } })
      fireEvent.keyDown(libelle(), { key: "Enter" })
      await waitFor(() => expect(liste).toHaveValue("a `b\nVoir [[Mes courses]] c`"))
      expect(texteDuBloc(liste.getAttribute("aria-label") ?? "")).toBe("a `b\nVoir [[prive/moi/taches|Mes courses]] c`")
    })

    it("should open a link of the second item of a list from its context menu at rest, and remove it for the text it shows", async () => {
      monterLEditeur([bloc(ID.puces, "list", null, { items: ["un [[prive/moi/notes]]", "Voir [[prive/moi/taches|Mes tâches]] demain"] })])
      const avant = "un [[prive/moi/notes]]\nVoir [[prive/moi/taches|Mes tâches]] demain"
      expect(menuContextuel(within(couche(champDe(avant), ".oto-block-copie")).getByRole("link", { name: "Mes tâches" }))).toBe(false)
      await focusSur(libelle())
      // Le panneau a monté le champ du bloc, sans le focus : il se relit.
      const liste = zone(champDe(avant))
      expect(libelle()).toHaveValue("Mes tâches")
      fireEvent.click(bouton("Retirer le lien"))
      await waitFor(() => expect(liste).toHaveValue("un [[prive/moi/notes]]\nVoir Mes tâches demain"))
      await focusSur(liste)
      expect(liste.selectionStart).toBe("un [[prive/moi/notes]]\nVoir Mes tâches".length)
    })

    it("should refuse without writing a label too long, an address other than https://, and no page chosen, then close on a link changed since it opened", async () => {
      const web = bloc(ID.web, "paragraph", "Doc https://exemple.fr fin")
      const { relire } = monterLEditeur([bloc(ID.texte, "paragraph", TEXTE), web], { cibles: CIBLES })
      menuContextuel(lienAuRepos(screen.getByRole("textbox", { name: NOM }), "Mes tâches"))
      await focusSur(libelle())
      fireEvent.change(libelle(), { target: { value: "x".repeat(201) } })
      fireEvent.click(bouton("Appliquer"))
      expect(screen.getByText("Le libellé tient en 200 caractères.")).toHaveAttribute("role", "alert")
      expect(libelle()).toHaveAccessibleDescription("Le libellé tient en 200 caractères.")
      fireEvent.change(libelle(), { target: { value: "Mes tâches" } })
      fireEvent.click(screen.getByRole("radio", { name: "Adresse web" }))
      const adresse = screen.getByRole("textbox", { name: "Adresse" })
      fireEvent.change(adresse, { target: { value: "javascript:alert(1)" } })
      fireEvent.keyDown(adresse, { key: "Enter" })
      expect(screen.getByText("Une adresse web commence par https:// et ne contient pas d'espace.")).toHaveAttribute("role", "alert")
      expect(texteDuBloc(NOM)).toBe(TEXTE)

      // Une adresse nue vers une page : aucune page choisie.
      act(() => bouton("Ailleurs").focus())
      const doc = champ("Modifier ce texte — Doc https://exemple.fr fin")
      act(() => doc.focus())
      placer(doc, 8)
      expect(screen.queryByRole("button", { name: "Retirer le lien" })).toBeNull()
      fireEvent.click(screen.getByRole("radio", { name: "Page de la plateforme" }))
      fireEvent.click(bouton("Appliquer"))
      expect(screen.getByText("Choisissez une page.")).toHaveAttribute("role", "alert")
      expect(doc).toHaveValue("Doc https://exemple.fr fin")

      // Le texte a changé depuis l'ouverture : rien n'est écrit, le panneau se ferme, le message reste sous le champ.
      act(() => bouton("Ailleurs").focus())
      menuContextuel(lienAuRepos(screen.getByRole("textbox", { name: NOM }), "Mes tâches"))
      await focusSur(libelle())
      // Le panneau a monté le champ du bloc : il se relit, avant que son nom ne suive le texte relu.
      const texte = zone(screen.getByRole("textbox", { name: NOM }))
      relire([{ ...bloc(ID.texte, "paragraph", `Revoir ${TEXTE.slice(5)}`), revision: 4 }, web])
      await waitFor(() => expect(texte).toHaveValue(`Revoir ${MONTRE.slice(5)}`))
      fireEvent.click(bouton("Appliquer"))
      expect(screen.getByText("Ce lien a changé ; rouvrez-le.")).toHaveAttribute("role", "alert")
      expect(panneau()).toBeNull()
      expect(texte).toHaveValue(`Revoir ${MONTRE.slice(5)}`)
      expect(api.envoyes).toEqual([])
    })

    it("should search a page from two letters as « @ » does, choose it with the arrows and Enter, open it in a new tab, and write it without the key of the other page", async () => {
      simulerLaRecherche()
      const ouvrir = vi.spyOn(window, "open").mockReturnValue(null)
      monterLEditeur([bloc(ID.texte, "paragraph", TEXTE)], { cibles: CIBLES })
      menuContextuel(lienAuRepos(screen.getByRole("textbox", { name: NOM }), "Mes tâches"))
      await focusSur(libelle())
      fireEvent.click(bouton("Ouvrir"))
      expect(ouvrir).toHaveBeenCalledWith("/n/prive/moi/taches#k1", "_blank", "noopener,noreferrer")
      expect(panneau()).not.toBeNull()

      const recherche = screen.getByRole("textbox", { name: "Chercher une page" })
      fireEvent.change(recherche, { target: { value: "g" } })
      expect(await screen.findByText("Tapez au moins deux lettres du contenu à citer.")).toBeInTheDocument()
      fireEvent.change(recherche, { target: { value: "gri" } })
      const options = await screen.findAllByRole("option")
      expect(recherche).toHaveAttribute("aria-activedescendant", options[0].id)
      fireEvent.keyDown(recherche, { key: "ArrowDown" })
      expect(recherche).toHaveAttribute("aria-activedescendant", options[1].id)
      fireEvent.keyDown(recherche, { key: "Enter" })
      expect(within(screen.getByRole("group", { name: "Modifier le lien" })).getByText("ventes/grille_remises")).toBeInTheDocument()
      fireEvent.click(bouton("Appliquer"))
      await waitFor(() => expect(texteDuBloc(NOM)).toBe("Voir [[ventes/grille_remises|Mes tâches]] demain"))
    })

    it("should show the title of the chosen page in « Libellé » for a link written without a label, and write the link still without one", async () => {
      simulerLaRecherche()
      const nu = "Voir [[prive/moi/taches]] demain"
      monterLEditeur([bloc(ID.texte, "paragraph", nu)], { cibles: CIBLES })
      menuContextuel(lienAuRepos(champDe(nu), "Mes tâches"))
      await focusSur(libelle())
      // Le panneau a monté le champ du bloc : il se relit.
      const texte = zone(champDe(nu))
      expect(libelle()).toHaveValue("Mes tâches")
      // Appliquer sans rien changer ne fige pas le titre en libellé.
      fireEvent.click(bouton("Appliquer"))
      await waitFor(() => expect(panneau()).toBeNull())
      expect(texte).toHaveValue(nu)
      // Une autre page choisie : « Libellé » montre son titre, et le lien s'écrit sans libellé.
      act(() => bouton("Ailleurs").focus())
      menuContextuel(lienAuRepos(champDe(nu), "Mes tâches"))
      await focusSur(libelle())
      const rouvert = zone(champDe(nu))
      const recherche = screen.getByRole("textbox", { name: "Chercher une page" })
      fireEvent.change(recherche, { target: { value: "gri" } })
      await screen.findAllByRole("option")
      fireEvent.keyDown(recherche, { key: "Enter" })
      expect(libelle()).toHaveValue("Grille tarifaire")
      fireEvent.click(bouton("Appliquer"))
      await waitFor(() => expect(rouvert).toHaveValue("Voir [[ventes/grille_tarifaire]] demain"))
    })

    it("should prefill a web link, offer no « Retirer le lien » for a bare address, and after Escape in the field stay closed until the cursor leaves the link", async () => {
      // « Doc », au focus, le lien markdown réduit à son titre de 4 à 12, « et », l'adresse nue de 16 à 34.
      monterLEditeur([bloc(ID.web, "paragraph", "Doc [la doc](https://exemple.fr/doc) et https://exemple.fr fin")])
      const texte = champ("Modifier ce texte — Doc la doc et")
      act(() => texte.focus())
      placer(texte, 10)
      expect(libelle()).toHaveValue("la doc")
      expect(screen.getByRole("radio", { name: "Adresse web" })).toHaveAttribute("aria-checked", "true")
      expect(screen.getByRole("textbox", { name: "Adresse" })).toHaveValue("https://exemple.fr/doc")
      expect(bouton("Retirer le lien")).toBeInTheDocument()
      placer(texte, 20)
      expect(libelle()).toHaveValue("")
      expect(screen.queryByRole("button", { name: "Retirer le lien" })).toBeNull()
      expect(texte).toHaveAccessibleDescription("Lien vers « https://exemple.fr ». Alt+Entrée pour le modifier.")

      expect(fireEvent.keyDown(texte, { key: "Escape" })).toBe(false)
      expect(panneau()).toBeNull()
      expect(document.activeElement).toBe(texte)
      placer(texte, 21)
      expect(panneau()).toBeNull()
      placer(texte, 13)
      placer(texte, 21)
      expect(panneau()).not.toBeNull()
      // Un second Échap, panneau fermé : la poignée, comme toujours.
      fireEvent.keyDown(texte, { key: "Escape" })
      fireEvent.keyDown(texte, { key: "Escape" })
      await focusSur(bouton("Actions sur ce bloc — Doc la doc et"))
    })
  })

  describe("E11-S15, lot B — correcteur", () => {
    it("should keep the browser's spell checker off a text that carries a link and off the fields of the « Lien » panel, on elsewhere (AC-b7)", () => {
      monterLEditeur([bloc("e1150000-0000-4000-8000-000000000004", "paragraph", "Voir [[prive/moi/taches|Mes tâches]] demain"), bloc("e1150000-0000-4000-8000-000000000005", "paragraph", "Objet de la relance")])
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
})
