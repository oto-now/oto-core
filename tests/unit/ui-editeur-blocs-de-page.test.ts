import { describe, expect, it } from "vitest"
import { blockInputSchema, type BlockView } from "@otomata_tech/oto_platform/schemas"
import {
  ajouterColonne,
  ajouterRangee,
  aligner,
  avecTableau,
  celluleVoisine,
  echapperLesBarres,
  niveauDeLigne,
  numerosDeGouttiere,
  positionDansLaLigne,
  retirerColonne,
  retirerRangee,
  tableauColle,
  type Tableau,
} from "../../packages/plateforme/ui/noeud/editeur/blocs-de-page"
import {
  changerDeForme,
  ecrireTexte,
  formeDe,
  fusionner,
  insererApres,
  rangeesDepuis,
  remplacerParChoix,
  texteDe,
  type Choix,
} from "../../packages/plateforme/ui/noeud/editeur/modele"
import { controler } from "../../packages/plateforme/ui/noeud/editeur/operations"
import { TEMPS_LINEAIRE_MS } from "../helpers/temps-lineaire"

// Les blocs de page qu'écrit l'éditeur (E10-S06) : choix du « + » et de « / », préfixes de titre, séparateur, repli,
// niveaux de liste, tableau simple et collage d'un tableur, en fonctions pures, sans écran.

function servi(id: string, type: BlockView["type"], text: string | null, data: Record<string, unknown> = {}): BlockView {
  return { id, ref: id.slice(0, 8), type, text, data, key: null, position: 1, revision: 3, provenance: {} }
}

const PARAGRAPHE = servi("bbbbbbbb-0002", "paragraph", "Relancer un devis.")
const VIDE = servi("cccccccc-0003", "paragraph", "")

const accepte = (bloc: Parameters<typeof controler>[0]) => {
  const controle = controler(bloc)
  return "entree" in controle && blockInputSchema.safeParse(controle.entree).success
}

describe("choix du « + » et de « / » (AC-a1, AC-a2)", () => {
  it("should insert each chosen block empty and without id after the row, the focus in its first field or on the handle of a divider", () => {
    const rangees = rangeesDepuis([PARAGRAPHE])
    const attendus: [Choix, Record<string, unknown>][] = [
      ["texte", { type: "paragraph", text: "", data: {} }],
      ["grandTitre", { type: "heading", text: "", data: { level: 1 } }],
      ["moyenTitre", { type: "heading", text: "", data: { level: 2 } }],
      ["petitTitre", { type: "heading", text: "", data: { level: 3 } }],
      ["puces", { type: "list", text: null, data: { items: [""] } }],
      ["numerotee", { type: "list", text: null, data: { items: [""], ordered: true } }],
      ["cases", { type: "checklist", text: null, data: { items: [{ text: "", checked: false }] } }],
      ["citation", { type: "callout", text: "", data: {} }],
      ["code", { type: "code", text: "", data: {} }],
      ["repli", { type: "toggle", text: "", data: { summary: "" } }],
      ["tableau", { type: "simple_table", text: null, data: { columns: ["", "", ""], rows: [["", "", ""], ["", "", ""]] } }],
      ["separateur", { type: "divider", text: null, data: {} }],
    ]
    for (const [choix, attendu] of attendus) {
      const { modele, focus } = insererApres(rangees, rangees[0].cle, choix)
      expect(modele).toHaveLength(2)
      expect(modele[1].bloc).toEqual({ ...attendu, key: null })
      expect(focus).toEqual(choix === "separateur" ? { cle: modele[1].cle, curseur: null, cible: "rangee" } : { cle: modele[1].cle, curseur: 0 })
    }
  })

  it("should turn a Texte into the chosen block in its place, its id, reference and revision kept", () => {
    const [vide] = rangeesDepuis([VIDE])
    expect(remplacerParChoix([vide], vide.cle, "grandTitre").modele[0].bloc).toEqual({ id: VIDE.id, ref: VIDE.ref, revision: 3, type: "heading", text: "", data: { level: 1 }, key: null })
    expect(remplacerParChoix([vide], vide.cle, "separateur")).toEqual({
      modele: [{ cle: vide.cle, bloc: { id: VIDE.id, ref: VIDE.ref, revision: 3, type: "divider", text: null, data: {}, key: null } }],
      focus: { cle: vide.cle, curseur: null, cible: "rangee" },
    })
  })
})

describe("préfixes de titre (AC-a5)", () => {
  it("should give a large, medium and small title for #, ## and ### typed at the start of a Texte, a small one beyond, the prefix gone", () => {
    const [paragraphe] = rangeesDepuis([PARAGRAPHE])
    const niveaux = [1, 2, 3, 4, 5, 6].map((nombre) => {
      const { modele, focus } = ecrireTexte([paragraphe], paragraphe.cle, `${"#".repeat(nombre)} Budget`)
      expect(modele[0].bloc).toMatchObject({ id: PARAGRAPHE.id, type: "heading", text: "Budget" })
      expect(focus).toEqual({ cle: paragraphe.cle, curseur: 0 })
      expect(accepte(modele[0].bloc)).toBe(true)
      return [formeDe(modele[0].bloc), modele[0].bloc.data.level]
    })
    expect(niveaux).toEqual([
      ["grandTitre", 1],
      ["moyenTitre", 2],
      ["petitTitre", 3],
      ["petitTitre", 3],
      ["petitTitre", 3],
      ["petitTitre", 3],
    ])
    // Sept `#` ne sont pas un titre (CommonMark) : le texte reste.
    expect(ecrireTexte([paragraphe], paragraphe.cle, "####### Budget").modele[0].bloc).toMatchObject({ type: "paragraph", text: "####### Budget" })
  })
})

describe("séparateur (AC-a4)", () => {
  it("should turn a Texte typed ---, *** or ___ into a divider followed by a new Texte that takes the focus, and leave any other text", () => {
    for (const signes of ["---", "***", "___"]) {
      const [vide] = rangeesDepuis([VIDE])
      const { modele, focus } = ecrireTexte([vide], vide.cle, signes)
      expect(modele.map((rangee) => rangee.bloc.type)).toEqual(["divider", "paragraph"])
      expect(modele[0].bloc).toEqual({ id: VIDE.id, ref: VIDE.ref, revision: 3, type: "divider", text: null, data: {}, key: null })
      expect(modele[1].bloc).toEqual({ type: "paragraph", text: "", data: {}, key: null })
      expect(focus).toEqual({ cle: modele[1].cle, curseur: 0 })
      expect(accepte(modele[0].bloc)).toBe(true)
    }
    const [vide] = rangeesDepuis([VIDE])
    expect(ecrireTexte([vide], vide.cle, "----").modele.map((rangee) => rangee.bloc.type)).toEqual(["paragraph"])
    // Un Texte servi qui vaut déjà `---` le reste, comme un Texte servi qui commence par « - » (HN-E05S02-17).
    const [deja] = rangeesDepuis([servi("dddddddd-0004", "paragraph", "---")])
    expect(ecrireTexte([deja], deja.cle, "---").modele[0].bloc.type).toBe("paragraph")
    // La marque se tape : un Texte qui en valait un début (« -- ») la devient ; « ---x » raccourci en `---` reste un Texte.
    const [debut] = rangeesDepuis([servi("dddddddd-0005", "paragraph", "--")])
    expect(ecrireTexte([debut], debut.cle, "---").modele[0].bloc.type).toBe("divider")
    const [plus] = rangeesDepuis([servi("dddddddd-0006", "paragraph", "---x")])
    expect(ecrireTexte([plus], plus.cle, "---").modele.map((rangee) => rangee.bloc.type)).toEqual(["paragraph"])
  })
})

describe("repli (AC-a3)", () => {
  it("should turn a Texte into a toggle, its first line the summary cut at 200 characters, and back into summary, blank line, body", () => {
    const [texte] = rangeesDepuis([servi("eeeeeeee-0005", "paragraph", "Détails\nligne 1\n\nligne 2")])
    const repli = changerDeForme([texte], texte.cle, "repli").modele[0].bloc
    expect(repli).toMatchObject({ id: "eeeeeeee-0005", type: "toggle", text: "ligne 1\n\nligne 2", data: { summary: "Détails" } })
    expect(formeDe(repli)).toBe("repli")
    expect(accepte(repli)).toBe(true)
    const [rangee] = rangeesDepuis([{ ...servi("eeeeeeee-0005", "toggle", repli.text, repli.data) }])
    expect(changerDeForme([rangee], rangee.cle, "texte").modele[0].bloc).toMatchObject({ type: "paragraph", text: "Détails\n\nligne 1\n\nligne 2", data: {} })

    // Au-delà de 200 caractères, le reste de la première ligne ouvre le corps.
    const [long] = rangeesDepuis([servi("ffffffff-0006", "paragraph", `${"é".repeat(250)}\nsuite`)])
    const coupe = changerDeForme([long], long.cle, "repli").modele[0].bloc
    expect(coupe.data.summary).toBe("é".repeat(200))
    expect(coupe.text).toBe(`${"é".repeat(50)}\nsuite`)
  })
})

describe("niveaux de liste (AC-a6)", () => {
  it("should indent a line under the item before it with the sub-level marker, outdent it, and keep the caret in its text", () => {
    expect(niveauDeLigne("a\nb", 2, 1, false)).toEqual({ texte: "a\n  - b", ligne: 1, colonne: 0 })
    expect(niveauDeLigne("a\nbc", 3, 1, true)).toEqual({ texte: "a\n  1. bc", ligne: 1, colonne: 1 })
    expect(niveauDeLigne("a\n  - bc", 8, -1, false)).toEqual({ texte: "a\nbc", ligne: 1, colonne: 2 })
    expect(niveauDeLigne("a\n  - b\n    1. c", 13, -1, false)).toEqual({ texte: "a\n  - b\n  - c", ligne: 2, colonne: 0 })

    const [puces] = rangeesDepuis([servi("aaaaaaaa-0007", "list", null, { items: ["a", "b"] })])
    const [numerotee] = rangeesDepuis([servi("aaaaaaaa-0008", "list", null, { items: ["a", "b"], ordered: true })])
    for (const [rangee, attendu, curseur] of [
      [puces, { items: [{ text: "a", children: { items: ["b"] } }] }, 6],
      [numerotee, { items: [{ text: "a", children: { items: ["b"], ordered: true } }], ordered: true }, 7],
    ] as const) {
      const lu = niveauDeLigne(texteDe(rangee.bloc), 2, 1, rangee.bloc.data.ordered === true)
      if ("refus" in lu) throw new Error(lu.refus)
      const bloc = ecrireTexte([rangee], rangee.cle, lu.texte).modele[0].bloc
      expect(bloc.data).toEqual(attendu)
      expect(positionDansLaLigne(texteDe(bloc), lu.ligne, lu.colonne)).toBe(curseur)
      expect(accepte(bloc)).toBe(true)
    }
  })

  it("should change nothing on the first line, beyond three levels, under nothing, or above the first level", () => {
    expect(niveauDeLigne("a\nb", 0, 1, false)).toEqual({ refus: "rienAuDessus" })
    expect(niveauDeLigne("a\n  - b\n    - c", 13, 1, false)).toEqual({ refus: "troisNiveaux" })
    expect(niveauDeLigne("a\n  - b", 6, 1, false)).toEqual({ refus: "rienAuDessus" })
    expect(niveauDeLigne("a\nb", 2, -1, false)).toEqual({ refus: "premierNiveau" })
  })

  it("should number only the first-level items in the gutter of a numbered list, from its start (HN-E10S04-14)", () => {
    expect(numerosDeGouttiere("a\n  1. x\n    - y\n  2. z\nb\nc", 3)).toEqual(["3.", "", "", "", "4.", "5."])
    expect(numerosDeGouttiere("a", 1)).toEqual(["1."])
  })
})

const TROIS: Tableau = { columns: ["A", "B", "C"], rows: [["a1", "b1", "c1"], ["a2", "b2", "c2"]] }

describe("tableau simple (AC-b1, AC-b2)", () => {
  it("should add a row or a column after the current cell, remove a row or a column, never the header nor the last column, and align a column", () => {
    expect(ajouterRangee(TROIS, 0)).toEqual({ columns: ["A", "B", "C"], rows: [["", "", ""], ["a1", "b1", "c1"], ["a2", "b2", "c2"]] })
    expect(ajouterColonne(TROIS, 0)).toEqual({ columns: ["A", "", "B", "C"], rows: [["a1", "", "b1", "c1"], ["a2", "", "b2", "c2"]] })
    expect(retirerRangee(TROIS, 0)).toBe(TROIS)
    expect(retirerRangee(TROIS, 1)).toEqual({ columns: ["A", "B", "C"], rows: [["a2", "b2", "c2"]] })
    expect(retirerColonne(TROIS, 1)).toEqual({ columns: ["A", "C"], rows: [["a1", "c1"], ["a2", "c2"]] })
    const seule = { columns: ["A"], rows: [["a"]] }
    expect(retirerColonne(seule, 0)).toBe(seule)
    const centre = aligner(TROIS, 1, "center")
    expect(avecTableau({}, centre)).toEqual({ ...TROIS, align: [null, "center", null] })
    // Aucune colonne alignée : `align` part (forme canonique d'E10-S04).
    expect(avecTableau({ align: [null, "center", null] }, aligner(centre, 1, null))).toEqual({ columns: TROIS.columns, rows: TROIS.rows })
    expect(celluleVoisine(TROIS, { ligne: 0, colonne: 2 }, 1)).toEqual({ ligne: 1, colonne: 0 })
    expect(celluleVoisine(TROIS, { ligne: 2, colonne: 2 }, 1)).toBeNull()
    expect(celluleVoisine(TROIS, { ligne: 0, colonne: 0 }, -1)).toBeNull()
  })

  it("should add nothing beyond 20 columns or 200 rows", () => {
    const large = { columns: Array.from({ length: 20 }, () => "x"), rows: [] }
    expect(ajouterColonne(large, 0)).toEqual({ borne: "colonnes" })
    const long = { columns: ["x"], rows: Array.from({ length: 200 }, () => ["y"]) }
    expect(ajouterRangee(long, 3)).toEqual({ borne: "rangees" })
    expect(ajouterRangee({ ...long, rows: long.rows.slice(1) }, 3)).not.toHaveProperty("borne")
  })

  it("should escape a typed | unless it is escaped already", () => {
    expect(echapperLesBarres("a|b")).toBe("a\\|b")
    expect(echapperLesBarres("a\\|b")).toBe("a\\|b")
    expect(echapperLesBarres("a\\\\|b")).toBe("a\\\\\\|b")
  })

  it("should never merge a table into the block before it, nor a block into a table: the focus goes to the table row", () => {
    const rangees = rangeesDepuis([PARAGRAPHE, servi("abababab-0009", "simple_table", null, TROIS), servi("cdcdcdcd-0010", "paragraph", "Après")])
    expect(fusionner(rangees, rangees[1].cle)).toEqual({ modele: rangees, focus: { cle: rangees[1].cle, curseur: null, cible: "rangee" } })
    expect(fusionner(rangees, rangees[2].cle)).toEqual({ modele: rangees, focus: { cle: rangees[1].cle, curseur: null, cible: "rangee" } })
  })
})

describe("collage d'un tableur (AC-b3)", () => {
  it("should read lines with the same number of tabs as a table, header first, cells trimmed and | escaped", () => {
    expect(tableauColle("Nom\tMontant\r\n Dupont \t 1|2 \r\nMartin\t3\r\n")).toEqual({ columns: ["Nom", "Montant"], rows: [["Dupont", "1\\|2"], ["Martin", "3"]] })
    const [vide] = rangeesDepuis([VIDE])
    const colle = tableauColle("a\tb\nc\td")
    if (!colle) throw new Error("tableau attendu")
    const bloc = remplacerParChoix([vide], vide.cle, "tableau", colle).modele[0].bloc
    expect(bloc).toMatchObject({ id: VIDE.id, type: "simple_table", text: null, data: { columns: ["a", "b"], rows: [["c", "d"]] } })
    expect(accepte(bloc)).toBe(true)
  })

  it("should leave as text unequal columns, a single line, no tab, or more than 20 columns or 200 rows", () => {
    expect(tableauColle("a\tb\nc")).toBeNull()
    expect(tableauColle("a\tb\nc\td\te")).toBeNull()
    expect(tableauColle("a\tb")).toBeNull()
    expect(tableauColle("a\nb")).toBeNull()
    expect(tableauColle(`${"a\t".repeat(20)}a\n${"b\t".repeat(20)}b`)).toBeNull()
    const lignes = (nombre: number) => ["a\tb", ...Array.from({ length: nombre }, () => "c\td")].join("\n")
    expect(tableauColle(lignes(201))).toBeNull()
    expect(tableauColle(lignes(200))?.rows).toHaveLength(200)
  })

  it("should read a hostile paste of 100 000 characters in linear time", () => {
    for (const hostile of ["\t".repeat(100_000), `${"a\t".repeat(50_000)}\n`, "a\tb\n".repeat(25_000), `${"\\".repeat(100_000)}|`]) {
      const debut = performance.now()
      tableauColle(hostile)
      echapperLesBarres(hostile)
      expect(performance.now() - debut).toBeLessThan(TEMPS_LINEAIRE_MS)
    }
  })
})
