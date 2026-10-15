import { describe, expect, it } from "vitest"
import type { BlockInput } from "@otomata_tech/oto_platform/schemas"
import {
  avecLeursSections,
  dansLOrdre,
  deplacementsDuGroupe,
  deplacerLeGroupe,
  insertionsDuGroupe,
  poserAvant,
  remettre,
  retablirLeGroupe,
  retirerLeGroupe,
} from "../../packages/plateforme/ui/noeud/editeur/groupe"
import type { Rangee } from "../../packages/plateforme/ui/noeud/editeur/modele"
import { couverts } from "../../packages/plateforme/ui/noeud/editeur/pointeur-de-la-selection"
import { avancer, basculer, etendre, jusqua, plage, SELECTION_VIDE, seul, tous } from "../../packages/plateforme/ui/noeud/editeur/selection-de-blocs"

// La sélection de blocs (E11-S17, lot a), en fonctions pures, sans écran : la sélection (plage, extension, bascule,
// rectangle) et les gestes de groupe du modèle (retirer, rétablir, déplacer, remettre), avec les corps d'écriture à
// plusieurs opérations qui les envoient en une seule écriture.

/** Une rangée servie `x`, d'`id` `id-x` ; `neuve`, sans `id` (un bloc jamais envoyé). */
function rangee(cle: string, neuve = false): Rangee {
  return { cle, bloc: { ...(neuve ? {} : { id: `id-${cle}`, ref: `ref-${cle}`, revision: 2 }), type: "paragraph", text: cle, data: {}, key: null } }
}

const PAGE = ["a", "b", "c", "d", "e"].map((cle) => rangee(cle))
const cles = (modele: readonly Rangee[]) => modele.map((une) => une.cle)
const entree = (texte: string): BlockInput => ({ type: "paragraph", text: texte, data: {} })

describe("selection of blocks (AC-a2 to AC-a5)", () => {
  it("should take a range in page order, upward as downward, and only the target when the anchor is gone", () => {
    expect(plage(PAGE, "b", "d")).toEqual(["b", "c", "d"])
    expect(plage(PAGE, "d", "b")).toEqual(["b", "c", "d"])
    expect(plage(PAGE, "parti", "c")).toEqual(["c"])
    expect(plage(PAGE, "b", "parti")).toEqual([])
  })

  it("should extend from the anchor with Maj+↑↓, shrink back past it, move a single block with ↑↓, and stop at the bounds", () => {
    const depart = seul("c")
    const bas = etendre(PAGE, etendre(PAGE, depart, 1), 1)
    expect(bas).toEqual({ cles: ["c", "d", "e"], ancre: "c", tete: "e" })
    expect(etendre(PAGE, bas, 1)).toBe(bas)
    // Remonter passe l'ancre : la plage s'inverse, l'ancre reste.
    const haut = etendre(PAGE, etendre(PAGE, etendre(PAGE, bas, -1), -1), -1)
    expect(haut).toEqual({ cles: ["b", "c"], ancre: "c", tete: "b" })
    expect(avancer(PAGE, haut, -1)).toEqual(seul("a"))
    expect(avancer(PAGE, seul("a"), -1)).toEqual(seul("a"))
    expect(etendre(PAGE, SELECTION_VIDE, 1)).toBe(SELECTION_VIDE)
  })

  it("should extend with Maj+clic from the anchor and toggle with Ctrl+clic, a non-contiguous group kept in page order", () => {
    const etendue = jusqua(PAGE, seul("b"), "d")
    expect(etendue).toEqual({ cles: ["b", "c", "d"], ancre: "b", tete: "d" })
    // Un second Maj+clic repart de la même ancre.
    expect(jusqua(PAGE, etendue, "a").cles).toEqual(["a", "b"])
    const eparse = basculer(PAGE, basculer(PAGE, seul("d"), "a"), "c")
    expect(eparse).toEqual({ cles: ["a", "c", "d"], ancre: "c", tete: "c" })
    // Retiré, un bloc cède l'ancre au dernier restant ; le dernier retiré vide la sélection.
    expect(basculer(PAGE, eparse, "c")).toEqual({ cles: ["a", "d"], ancre: "d", tete: "d" })
    expect(basculer(PAGE, seul("a"), "a")).toEqual(SELECTION_VIDE)
    expect(tous(PAGE)).toEqual({ cles: ["a", "b", "c", "d", "e"], ancre: "a", tete: "e" })
    expect(tous([])).toEqual(SELECTION_VIDE)
  })

  it("should take the blocks a rectangle covers in height, bounds excluded, whatever its width", () => {
    const boites = [
      { cle: "a", haut: 0, bas: 20 },
      { cle: "b", haut: 24, bas: 44 },
      { cle: "c", haut: 48, bas: 68 },
    ]
    expect(couverts(boites, 10, 30)).toEqual(["a", "b"])
    expect(couverts(boites, 20, 24)).toEqual([])
    expect(couverts(boites, 45, 47)).toEqual([])
    expect(couverts(boites, -100, 1_000)).toEqual(["a", "b", "c"])
  })
})

describe("group gestures of the model (AC-a6, AC-a8)", () => {
  it("should keep the page order and drop unknown keys", () => {
    expect(dansLOrdre(PAGE, ["d", "parti", "a"])).toEqual(["a", "d"])
  })

  it("should remove a non-contiguous group, focus the handle before it, and bring every block back at its place in one go", () => {
    const retire = retirerLeGroupe(PAGE, ["d", "b", "c"])
    expect(cles(retire.modele)).toEqual(["a", "e"])
    expect(retire.focus).toEqual({ cle: "a", curseur: null, cible: "rangee" })
    expect(retire.retirees.map((une) => [une.rangee.cle, une.voisin])).toEqual([
      ["b", "a"],
      ["c", "b"],
      ["d", "c"],
    ])
    // Les blocs rétablis, sans `id`, retrouvent leur ordre après leur ancien voisin ; un bloc ajouté entre-temps après lui les suit.
    const retabli = retablirLeGroupe([...retire.modele.slice(0, 1), rangee("x", true), ...retire.modele.slice(1)], retire.retirees)
    expect(retabli.modele.map((une) => une.bloc.text)).toEqual(["a", "b", "c", "d", "x", "e"])
    expect(retabli.cles).toHaveLength(3)
    expect(retabli.modele.filter((une) => retabli.cles.includes(une.cle)).every((une) => une.bloc.id === undefined)).toBe(true)
  })

  it("should focus the first block left when the group starts the page, and leave an empty Texte when every block goes (E11-S05, AC-g1)", () => {
    expect(retirerLeGroupe(PAGE, ["a", "b"]).focus).toEqual({ cle: "c", curseur: null, cible: "rangee" })
    const toutes = retirerLeGroupe(PAGE, cles(PAGE))
    expect(toutes.modele).toHaveLength(1)
    expect(toutes.modele[0].bloc).toMatchObject({ type: "paragraph", text: "" })
    expect(toutes.focus).toEqual({ cle: toutes.modele[0].cle, curseur: 0 })
    expect(retablirLeGroupe([], toutes.retirees).modele.map((une) => une.bloc.text)).toEqual(["a", "b", "c", "d", "e"])
    expect(retirerLeGroupe(PAGE, ["parti"])).toEqual({ modele: PAGE, retirees: [] })
  })

  it("should move a contiguous group one step, gather a scattered one at the target, and not move a group at the bound", () => {
    expect(cles(deplacerLeGroupe(PAGE, ["b", "c"], 1))).toEqual(["a", "d", "b", "c", "e"])
    expect(cles(deplacerLeGroupe(PAGE, ["c", "d"], -1))).toEqual(["a", "c", "d", "b", "e"])
    // Épars : les blocs se suivent, dans l'ordre de la page, avant la voisine du premier ou après celle du dernier (HN-E11S16-6).
    expect(cles(deplacerLeGroupe(PAGE, ["b", "d"], -1))).toEqual(["b", "d", "a", "c", "e"])
    expect(cles(deplacerLeGroupe(PAGE, ["b", "d"], 1))).toEqual(["a", "c", "e", "b", "d"])
    expect(cles(deplacerLeGroupe(PAGE, ["a", "b"], -1))).toEqual(cles(PAGE))
    expect(cles(deplacerLeGroupe(PAGE, ["d", "e"], 1))).toEqual(cles(PAGE))
    expect(cles(deplacerLeGroupe(PAGE, ["a", "c"], -1))).toEqual(["a", "c", "b", "d", "e"])
  })

  it("should take each heading with its section, up to the next heading of the same or a greater level, subheadings included", () => {
    const titre = (cle: string, level: number): Rangee => ({ cle, bloc: { ...rangee(cle).bloc, type: "heading", data: { level } } })
    const page = [rangee("a"), titre("h2", 2), rangee("b"), titre("h3", 3), rangee("c"), titre("g2", 2), rangee("d"), titre("h1", 1), rangee("e")]
    expect(avecLeursSections(page, ["h2"])).toEqual(["h2", "b", "h3", "c"])
    expect(avecLeursSections(page, ["h3"])).toEqual(["h3", "c"])
    expect(avecLeursSections(page, ["a", "g2"])).toEqual(["a", "g2", "d"])
    expect(avecLeursSections(page, ["h1"])).toEqual(["h1", "e"])
    expect(avecLeursSections(page, ["b"])).toEqual(["b"])
  })

  it("should set a group, gathered in page order, just before the given block, at the end for null or a block of the group", () => {
    expect(cles(poserAvant(PAGE, ["d", "e"], "b"))).toEqual(["a", "d", "e", "b", "c"])
    expect(cles(poserAvant(PAGE, ["a", "c"], "e"))).toEqual(["b", "d", "a", "c", "e"])
    expect(cles(poserAvant(PAGE, ["a", "b"], null))).toEqual(["c", "d", "e", "a", "b"])
    expect(cles(poserAvant(PAGE, ["b"], "b"))).toEqual(["a", "c", "d", "e", "b"])
  })

  it("should put a moved group back in the order before, a block added meanwhile kept", () => {
    const avant = cles(PAGE)
    const deplace = deplacerLeGroupe(PAGE, ["b", "d"], 1)
    expect(cles(remettre(deplace, avant, ["b", "d"]))).toEqual(avant)
    const avecUnNeuf = [rangee("x", true), ...deplace]
    expect(cles(remettre(avecUnNeuf, avant, ["b", "d"]))).toEqual(["x", "a", "b", "c", "d", "e"])
  })
})

describe("one write for a group (AC-a6, AC-a8)", () => {
  it("should insert restored blocks after the written block before them, last first, so that one body rebuilds the page order", () => {
    // Page : a, [r1], [r2], b, [n neuf], [r3] ; r1, r2 et r3 rétablis, sans `id`.
    const modele = [rangee("a"), rangee("r1", true), rangee("r2", true), rangee("b"), rangee("n", true), rangee("r3", true)]
    const corps = insertionsDuGroupe(modele, ["r1", "r2", "r3"].map((cle) => ({ cle, entree: entree(cle) })))
    expect(corps.ops).toEqual([
      { op: "insert_after", block: "id-a", input: entree("r2") },
      { op: "insert_after", block: "id-a", input: entree("r1") },
      { op: "insert_after", block: "id-b", input: entree("r3") },
    ])
    expect(corps.cles).toEqual(["r2", "r1", "r3"])
    // En tête de page, sans ancre.
    expect(insertionsDuGroupe([rangee("r0", true), rangee("a")], [{ cle: "r0", entree: entree("r0") }]).ops).toEqual([{ op: "insert_after", input: entree("r0") }])
  })

  it("should move each written block of the group after the written block now before it, in page order, a new block left for later", () => {
    const modele = [rangee("a"), rangee("c"), rangee("n", true), rangee("b"), rangee("d")]
    const idDe = (cle: string) => modele.find((une) => une.cle === cle)?.bloc.id
    const corps = deplacementsDuGroupe(modele, ["b", "c", "n"], idDe)
    expect(corps.ops).toEqual([
      { op: "move_block", block: "id-c", after_block: "id-a" },
      { op: "move_block", block: "id-b", after_block: "id-c" },
    ])
    expect(corps.cles).toEqual(["c", "b"])
    expect(deplacementsDuGroupe([rangee("b"), rangee("a")], ["b"], (cle) => `id-${cle}`).ops).toEqual([{ op: "move_block", block: "id-b" }])
  })
})
