import { describe, expect, it } from "vitest"
import { blockInputSchema, type BlockView } from "@otomata_tech/oto_platform/schemas"
import {
  avecForme,
  changerDeForme,
  deplacer,
  ecrireTexte,
  fusionner,
  insererApres,
  insererEnTete,
  rangeesDepuis,
  retablir,
  retirer,
  scinder,
  sortirDeLaListe,
  texteDe,
  basculerLaCase,
  casesCochees,
  dupliquer,
  formeDe,
  FORMES_ECRITES,
  type Rangee,
} from "../../packages/plateforme/ui/noeud/editeur/modele"
import { controler, estVide } from "../../packages/plateforme/ui/noeud/editeur/operations"
import { estLaPageVide, modeleDeLaPage } from "../../packages/plateforme/ui/noeud/editeur/page-vide"

// Le modèle d'édition (E05-S02, AC11, AC12) : opérations pures, sans écran. Un bloc servi garde son
// `id`, sa référence, sa révision et sa clé ; un bloc neuf n'a jamais d'`id`.

function servi(id: string, type: BlockView["type"], text: string | null, data: Record<string, unknown> = {}): BlockView {
  return { id, ref: id.slice(0, 8), type, text, data, key: null, position: 1, revision: 3, provenance: {} }
}

const PAGE = [
  { ...servi("aaaaaaaa-0001", "heading", "Objet", { level: 1 }), key: "objet", ref: "objet" },
  servi("bbbbbbbb-0002", "paragraph", "Relancer un devis."),
  servi("cccccccc-0003", "code", "select 1", { language: "sql" }),
  servi("dddddddd-0004", "list", null, { items: ["Lire", "Écrire"], ordered: true, start: 3 }),
]

const textes = (modele: readonly Rangee[]) => modele.map((rangee) => [rangee.bloc.type, texteDe(rangee.bloc)])

describe("modèle d'édition, formes (AC11)", () => {
  it("should turn a Texte into a heading, a list or a numbered list by the prefix just typed, and change a form keeping the text, the key and the id", () => {
    const [, paragraphe] = rangeesDepuis(PAGE)
    const cas: [string, string, Record<string, unknown>][] = [
      ["# Budget", "heading", { level: 1 }],
      ["- Budget", "list", { items: ["Budget"] }],
      ["* Budget", "list", { items: ["Budget"] }],
      ["1. Budget", "list", { items: ["Budget"], ordered: true }],
    ]
    for (const [tape, type, data] of cas) {
      const { modele, focus } = ecrireTexte([paragraphe], paragraphe.cle, tape)
      expect(modele[0].bloc).toMatchObject({ id: "bbbbbbbb-0002", type, data })
      expect(texteDe(modele[0].bloc)).toBe("Budget")
      expect(focus).toEqual({ cle: paragraphe.cle, curseur: 0 })
    }
    // Un Texte servi qui commence déjà par « - » le reste (HN-E05S02-17).
    const tiret = rangeesDepuis([servi("eeeeeeee-0005", "paragraph", "- déjà là")])[0]
    expect(ecrireTexte([tiret], tiret.cle, "- déjà là, suite").modele[0].bloc.type).toBe("paragraph")

    const [titre] = rangeesDepuis(PAGE)
    const enListe = changerDeForme([titre], titre.cle, "numerotee").modele[0].bloc
    expect(enListe).toEqual({ id: "aaaaaaaa-0001", ref: "objet", revision: 3, type: "list", text: null, data: { items: ["Objet"], ordered: true }, key: "objet" })
    const liste = rangeesDepuis(PAGE)[3]
    expect(changerDeForme([liste], liste.cle, "grandTitre").modele[0].bloc).toMatchObject({ type: "heading", text: "Lire\nÉcrire", data: { level: 1 } })
  })

  it("should split a Texte at the caret into a new Texte, leave a list by Enter on its last empty line, and open a new Texte before a block split at its start", () => {
    const rangees = rangeesDepuis(PAGE)
    const scinde = scinder(rangees, rangees[1].cle, 8)
    expect(textes(scinde.modele).slice(1, 3)).toEqual([
      ["paragraph", "Relancer"],
      ["paragraph", " un devis."],
    ])
    expect(scinde.modele[2].bloc.id).toBeUndefined()
    expect(scinde.focus).toEqual({ cle: scinde.modele[2].cle, curseur: 0 })

    const liste = { ...rangees[3], bloc: { ...rangees[3].bloc, data: { ...rangees[3].bloc.data, items: ["Lire", "Écrire", ""] } } }
    const sortie = sortirDeLaListe([liste], liste.cle)
    expect(textes(sortie.modele)).toEqual([
      ["list", "Lire\nÉcrire"],
      ["paragraph", ""],
    ])
    const seule = { ...liste, bloc: { ...liste.bloc, data: { items: [""] } } }
    const devenue = sortirDeLaListe([seule], seule.cle)
    expect(devenue.modele).toHaveLength(1)
    expect(devenue.modele[0].bloc).toMatchObject({ id: "dddddddd-0004", type: "paragraph", text: "" })

    // Entrée en tête d'un bloc non vide : un Texte neuf s'ouvre avant lui ; le titre garde son `id`, sa forme et sa clé (HN-E05S02-25).
    const enTete = scinder(rangees, rangees[0].cle, 0)
    expect(enTete.modele[1]).toEqual(rangees[0])
    expect(enTete.modele[0].bloc).toEqual({ type: "paragraph", text: "", data: {}, key: null })
    expect(enTete.focus).toEqual({ cle: enTete.modele[0].cle, curseur: 0 })
  })
})

describe("modèle d'édition, structure (AC12)", () => {
  it("should merge into a writable block only, and move a block by one rank within the bounds", () => {
    const rangees = rangeesDepuis(PAGE)
    const fondu = fusionner(rangees, rangees[1].cle)
    expect(fondu.avec).toBe(rangees[0].cle)
    expect(textes(fondu.modele)[0]).toEqual(["heading", "ObjetRelancer un devis."])
    expect(fondu.focus).toEqual({ cle: rangees[0].cle, curseur: "Objet".length })
    // Le précédent se modifie par l'assistant (un contenu cité) : rien ne fusionne, le focus va à sa rangée.
    const avecReference = rangeesDepuis([PAGE[1], servi("cccccccc-0011", "reference", null, { path: "ventes/suivi" }), PAGE[3]])
    const refuse = fusionner(avecReference, avecReference[2].cle)
    expect(refuse.avec).toBeUndefined()
    expect(refuse.modele).toEqual(avecReference)
    expect(refuse.focus).toEqual({ cle: avecReference[1].cle, curseur: null, cible: "rangee" })

    expect(deplacer(rangees, rangees[1].cle, -1).modele.map((rangee) => rangee.cle)).toEqual([rangees[1].cle, rangees[0].cle, rangees[2].cle, rangees[3].cle])
    expect(deplacer(rangees, rangees[0].cle, -1).modele).toEqual(rangees)
    expect(deplacer(rangees, rangees[3].cle, 1).modele).toEqual(rangees)
  })

  it("should remove a block then bring it back after its former neighbour, without id, reference nor revision", () => {
    const rangees = rangeesDepuis(PAGE)
    const retire = retirer(rangees, rangees[2].cle)
    expect(retire.modele).toHaveLength(3)
    // Le focus va au champ du bloc d'avant, en fin de texte (E05-S08, AC4).
    expect(retire.focus).toEqual({ cle: rangees[1].cle, curseur: Number.MAX_SAFE_INTEGER })
    const retiree = retire.retiree
    if (!retiree) throw new Error("rangée retirée attendue")
    const retabli = retablir(retire.modele, retiree)
    expect(retabli.modele[2].bloc).toEqual({ type: "code", text: "select 1", data: { language: "sql" }, key: null })
    expect(retabli.modele[2].cle).not.toBe(rangees[2].cle)
    // Sans voisin, en tête.
    const premier = retirer(rangees, rangees[0].cle)
    if (!premier.retiree) throw new Error("rangée retirée attendue")
    expect(retablir(premier.modele, premier.retiree).modele[0].bloc).toMatchObject({ type: "heading", key: "objet" })
  })

  // Le rendu du serveur et l'hydratation lisent les mêmes blocs : leurs clés de rendu (`data-cle`) doivent s'accorder.
  it("should give the same render keys to the same served blocks on every reading", () => {
    expect(rangeesDepuis(PAGE).map((rangee) => rangee.cle)).toEqual(rangeesDepuis(PAGE).map((rangee) => rangee.cle))
  })

  // E11-S05 (AC-g1, HN-E11S05-19) : le modèle d'une page n'est jamais vide.
  it("should give a page without block one local empty Texte, of a fixed render key, kept by a reading that still serves none", () => {
    const [vide, ...autres] = modeleDeLaPage([])
    expect(autres).toEqual([])
    expect(vide.bloc).toEqual({ type: "paragraph", text: "", data: {}, key: null })
    expect(estLaPageVide([vide])).toBe(true)
    // Rendu par le serveur puis hydraté : la même clé à chaque lecture.
    expect(modeleDeLaPage([])[0].cle).toBe(vide.cle)
    expect(modeleDeLaPage([], [vide])).toEqual([vide])
    expect(modeleDeLaPage(PAGE).map((rangee) => rangee.cle)).toEqual(rangeesDepuis(PAGE).map((rangee) => rangee.cle))
    // Un Texte tapé ou servi n'est plus le Texte d'une page vide.
    expect(estLaPageVide(ecrireTexte([vide], vide.cle, "Début").modele)).toBe(false)
    expect(estLaPageVide(rangeesDepuis([servi("eeeeeeee-0005", "paragraph", "")]))).toBe(false)
  })

  it("should leave an empty Texte, the focus in it, when the last block is removed (AC-g1)", () => {
    const [seule] = rangeesDepuis([PAGE[1]])
    const retire = retirer([seule], seule.cle)
    expect(retire.modele).toHaveLength(1)
    const [texte] = retire.modele
    expect(estLaPageVide(retire.modele)).toBe(true)
    expect(texte.cle).not.toBe(seule.cle)
    expect(retire.focus).toEqual({ cle: texte.cle, curseur: Number.MAX_SAFE_INTEGER })
  })

  it("should never give an id to a new block", () => {
    const rangees = rangeesDepuis(PAGE)
    const neufs = [insererApres(rangees, rangees[0].cle), insererEnTete(rangees), scinder(rangees, rangees[1].cle, 3)].map(({ modele, focus }) => modele.find((rangee) => rangee.cle === focus?.cle)?.bloc)
    for (const bloc of neufs) expect(bloc).toEqual({ type: "paragraph", text: expect.any(String), data: {}, key: null })
  })
})

// E05-S10 : un seul niveau de titre (AC-a5), les styles d'un bloc (AC-a2).

describe("modèle d'édition, styles d'un bloc (E05-S10, AC-a2, AC-a5)", () => {
  it("should read levels 1, 2 and 3 to 5 as large, medium and small titles, keep a written level, and give its level to a block turned into a title", () => {
    expect([1, 2, 3, 4, 5].map((level) => formeDe({ type: "heading", data: { level } }))).toEqual(["grandTitre", "moyenTitre", "petitTitre", "petitTitre", "petitTitre"])
    const [ancien] = rangeesDepuis([servi("aaaaaaaa-0009", "heading", "Suite", { level: 3 })])
    // Un titre de niveau 3 réécrit garde son niveau en base : aucune migration.
    expect(ecrireTexte([ancien], ancien.cle, "Suite revue").modele[0].bloc.data).toEqual({ level: 3 })
    const [paragraphe] = rangeesDepuis([PAGE[1]])
    expect(changerDeForme([paragraphe], paragraphe.cle, "moyenTitre").modele[0].bloc.data).toEqual({ level: 2 })
    // Un titre de niveau 4 reste tel quand on choisit « Petit titre », qu'il est déjà.
    const [profond] = rangeesDepuis([servi("aaaaaaaa-0010", "heading", "Détail", { level: 4 })])
    expect(changerDeForme([profond], profond.cle, "petitTitre").modele[0].bloc.data).toEqual({ level: 4 })
    // Trois titres, « Menu dépliant » (repli) et « Diagramme » (1.1.3).
    expect(FORMES_ECRITES).toEqual(["texte", "grandTitre", "moyenTitre", "petitTitre", "puces", "numerotee", "cases", "citation", "code", "diagramme", "repli"])
  })

  it("should write a checklist, a quote and code on existing types that blockInputSchema accepts, the text following, the checks kept by line", () => {
    const [paragraphe] = rangeesDepuis([servi("bbbbbbbb-0010", "paragraph", "Lire\nÉcrire")])
    const cases = changerDeForme([paragraphe], paragraphe.cle, "cases").modele
    expect(cases[0].bloc).toMatchObject({ type: "checklist", text: null, data: { items: [{ text: "Lire", checked: false }, { text: "Écrire", checked: false }] } })
    const cochee = basculerLaCase(cases, cases[0].cle, 1)
    expect(casesCochees(cochee[0].bloc)).toEqual([false, true])
    // Une ligne ajoutée à la fin : les cases des lignes existantes gardent leur état.
    const suite = ecrireTexte(cochee, cochee[0].cle, "Lire\nÉcrire\nEnvoyer").modele
    expect(casesCochees(suite[0].bloc)).toEqual([false, true, false])
    expect(texteDe(suite[0].bloc)).toBe("Lire\nÉcrire\nEnvoyer")
    for (const [forme, type] of [
      ["cases", "checklist"],
      ["citation", "callout"],
      ["code", "code"],
      // 1.1.3 : le diagramme, sur `mermaid`.
      ["diagramme", "mermaid"],
    ] as const) {
      const bloc = changerDeForme([paragraphe], paragraphe.cle, forme).modele[0].bloc
      expect(bloc.type).toBe(type)
      expect(formeDe(bloc)).toBe(forme)
      const controle = controler(bloc)
      expect("entree" in controle && blockInputSchema.safeParse(controle.entree).success).toBe(true)
    }
    // Le langage d'un code ne suit pas le bloc devenu Texte.
    const [code] = rangeesDepuis([PAGE[2]])
    expect(changerDeForme([code], code.cle, "texte").modele[0].bloc).toMatchObject({ type: "paragraph", text: "select 1", data: {} })
    // Du code au diagramme et retour, le texte suit (1.1.3) ; un diagramme blanc est vide : il ne part pas, le service le refuserait.
    const diagramme = changerDeForme([code], code.cle, "diagramme").modele
    expect(diagramme[0].bloc).toMatchObject({ id: "cccccccc-0003", type: "mermaid", text: "select 1", data: {} })
    expect(changerDeForme(diagramme, code.cle, "code").modele[0].bloc).toMatchObject({ type: "code", text: "select 1" })
    expect(estVide(avecForme({ type: "paragraph", text: " \n ", data: {}, key: null }, "diagramme"))).toBe(true)
  })

  it("should duplicate a block right after it, without id, reference, revision nor key, the focus in the copy", () => {
    const rangees = rangeesDepuis(PAGE)
    const suite = dupliquer(rangees, rangees[0].cle)
    expect(suite.modele).toHaveLength(5)
    expect(suite.modele[1].bloc).toEqual({ type: "heading", text: "Objet", data: { level: 1 }, key: null })
    expect(suite.focus).toEqual({ cle: suite.modele[1].cle, curseur: Number.MAX_SAFE_INTEGER })
    expect(suite.modele[0]).toEqual(rangees[0])
  })
})

// M59 (fiche D104) : un bloc `call` déjà écrit s'écrit comme un Texte, et reste tel quel tant qu'on ne le change pas.

const APPEL = { ...servi("eeeeeeee-0006", "call", null, { function: "table.schema", args: { table: "ventes/suivi_prospects" } }), key: "contrat" }
const LU = 'Appel de table.schema : { "table": "ventes/suivi_prospects" }'

describe("modèle d'édition, appel déjà écrit (M59)", () => {
  it("should read a call as a Texte, keep it untouched while its text is unchanged, and make it a Texte once written, id, key and revision kept", () => {
    const [rangee] = rangeesDepuis([APPEL])
    expect(formeDe(rangee.bloc)).toBe("texte")
    expect(texteDe(rangee.bloc)).toBe(LU)
    // Rien ne change sans changement : le bloc reste un appel, rien ne partira.
    expect(ecrireTexte([rangee], rangee.cle, LU).modele[0]).toEqual(rangee)
    expect(changerDeForme([rangee], rangee.cle, "texte").modele[0]).toEqual(rangee)

    const ecrit = ecrireTexte([rangee], rangee.cle, "Lis le contrat du tableau.").modele[0].bloc
    expect(ecrit).toEqual({ id: "eeeeeeee-0006", ref: "eeeeeeee", revision: 3, type: "paragraph", text: "Lis le contrat du tableau.", data: {}, key: "contrat" })
    const controle = controler(ecrit)
    expect("entree" in controle && blockInputSchema.safeParse(controle.entree).success).toBe(true)

    // Un autre style prend son texte lisible, sans `function` ni `args`.
    expect(changerDeForme([rangee], rangee.cle, "grandTitre").modele[0].bloc).toEqual({ id: "eeeeeeee-0006", ref: "eeeeeeee", revision: 3, type: "heading", text: LU, data: { level: 1 }, key: "contrat" })
    expect(avecForme(rangee.bloc, "puces")).toMatchObject({ type: "list", text: null, data: { items: [LU] } })
  })
})

describe("modèle d'édition, liste imbriquée (E10-S04, AC-b2)", () => {
  const imbriquee = servi("ffffffff-0012", "list", null, {
    items: ["a", { text: "b", children: { items: ["c", { text: "d", children: { items: ["e"], ordered: true, start: 3 } }], ordered: false } }],
    ordered: true,
    start: 2,
  })

  it("should show one item per line, two spaces per level, sub-level markers included", () => {
    expect(texteDe(imbriquee)).toBe("a\nb\n  - c\n  - d\n    3. e")
  })

  it("should give back the served list plus the typing, children, ordered and start kept", () => {
    const [rangee] = rangeesDepuis([imbriquee])
    expect(ecrireTexte([rangee], rangee.cle, texteDe(imbriquee)).modele[0].bloc).toEqual(rangee.bloc)
    const tape = ecrireTexte([rangee], rangee.cle, "a!\nb\n  - c\n  - d\n    3. e\n    4. f\n  - g").modele[0].bloc
    expect(tape.data).toEqual({
      items: ["a!", { text: "b", children: { items: ["c", { text: "d", children: { items: ["e", "f"], ordered: true, start: 3 } }, "g"], ordered: false } }],
      ordered: true,
      start: 2,
    })
    expect(blockInputSchema.safeParse({ type: "list", data: tape.data }).success).toBe(true)
  })

  it("should keep the parent of the children of a sub-item written on several lines, its lines becoming sibling sub-items", () => {
    const [rangee] = rangeesDepuis([servi("ffffffff-0013", "list", null, { items: [{ text: "P", children: { items: ["a\nb", "c"] } }, "Q"] })])
    expect(texteDe(rangee.bloc)).toBe("P\n  - a\n  - b\n  - c\nQ")
    expect(ecrireTexte([rangee], rangee.cle, texteDe(rangee.bloc)).modele[0].bloc.data).toEqual({ items: [{ text: "P", children: { items: ["a", "b", "c"] } }, "Q"] })
    // Une sous-liste numérotée compte ses lignes : relue, elle garde son premier numéro.
    const [numerotee] = rangeesDepuis([servi("ffffffff-0014", "list", null, { items: [{ text: "P", children: { items: ["a\nb", "c"], ordered: true, start: 4 } }] })])
    expect(texteDe(numerotee.bloc)).toBe("P\n  4. a\n  5. b\n  6. c")
    expect(ecrireTexte([numerotee], numerotee.cle, texteDe(numerotee.bloc)).modele[0].bloc.data).toEqual({
      items: [{ text: "P", children: { items: ["a", "b", "c"], ordered: true, start: 4 } }],
    })
  })

  it("should keep the sub-lists when a numbered list becomes bulleted", () => {
    const [rangee] = rangeesDepuis([imbriquee])
    expect(avecForme(rangee.bloc, "puces").data).toEqual({ items: imbriquee.data.items })
  })
})
