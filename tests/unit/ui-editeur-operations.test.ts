import { describe, expect, it } from "vitest"
import { blockInputSchema, writeNodeBodySchema, type BlockView } from "@otomata_tech/oto_platform/schemas"
import { rangeesDepuis, type BlocEdite } from "../../packages/plateforme/ui/noeud/editeur/modele"
import {
  controler,
  estVide,
  idPrecedent,
  MESSAGES_DU_BLOC,
  operationDeplacer,
  operationInserer,
  operationRemplacer,
  operationSupprimer,
  verdictDuRefus,
} from "../../packages/plateforme/ui/noeud/editeur/operations"

// Ce qu'un geste envoie (E05-S02, AC10 à AC13, AC15) : le bloc contrôlé par `blockInputSchema`, puis
// les opérations par bloc du corps `writeNodeBodySchema`, jamais du markdown.

const ID_B = "0f1e2d3c-4b5a-4968-8776-655443322110"

function valide(ops: unknown[]) {
  return writeNodeBodySchema.safeParse({ path: "ventes/modele_relance", base_revision: 4, ops }).success
}

function entree(bloc: BlocEdite) {
  const controle = controler(bloc)
  if (!("entree" in controle)) throw new Error(controle.message)
  return controle.entree
}

describe("opérations par bloc (AC10 à AC12)", () => {
  it("should replace a block by its full id with the revision read, its input accepted by blockInputSchema, its key kept (AC10)", () => {
    const bloc: BlocEdite = { id: ID_B, ref: "objet", revision: 3, type: "heading", text: "Objet du devis", data: { level: 2 }, key: "objet" }
    const op = operationRemplacer(ID_B, 3, entree(bloc))
    expect(op).toEqual({ op: "replace_block", block: ID_B, revision: 3, input: { type: "heading", text: "Objet du devis", data: { level: 2 }, key: "objet" } })
    expect(blockInputSchema.safeParse(op.input).success).toBe(true)
    expect(valide([op])).toBe(true)
  })

  it("should insert a new block without id, after a block or at the start without one (AC11)", () => {
    const neuf: BlocEdite = { type: "paragraph", text: "Relancer après 7 jours.", data: {}, key: null }
    expect(operationInserer(ID_B, entree(neuf))).toEqual({ op: "insert_after", block: ID_B, input: { type: "paragraph", text: "Relancer après 7 jours.", data: {} } })
    expect(operationInserer(null, entree(neuf))).toEqual({ op: "insert_after", input: { type: "paragraph", text: "Relancer après 7 jours.", data: {} } })
    // L'ancre est le plus proche bloc écrit qui précède ; un bloc neuf, pas encore écrit, n'en est pas une.
    const [a, b] = rangeesDepuis([{ id: ID_B, ref: "0f1e2d3c", type: "paragraph", text: "A", data: {}, key: null, position: 1, revision: 1, provenance: {} }, { id: "x", ref: "x", type: "paragraph", text: "B", data: {}, key: null, position: 2, revision: 1, provenance: {} }])
    const modele = [a, { cle: "neuve", bloc: neuf }, { ...b, cle: "apres" }]
    expect(idPrecedent(modele, "apres")).toBe(ID_B)
    expect(idPrecedent(modele, a.cle)).toBeNull()
  })

  it("should move without revision and delete with it (AC12)", () => {
    expect(operationDeplacer(ID_B, "etapes")).toEqual({ op: "move_block", block: ID_B, after_block: "etapes" })
    expect(operationDeplacer(ID_B, null)).toEqual({ op: "move_block", block: ID_B })
    expect(operationSupprimer(ID_B, 3)).toEqual({ op: "delete_block", block: ID_B, revision: 3 })
    expect(valide([operationDeplacer(ID_B, null), operationSupprimer(ID_B, 3)])).toBe(true)
  })
})

describe("contrôle avant envoi (AC13)", () => {
  const titre = (text: string): BlocEdite => ({ type: "heading", text, data: { level: 1 }, key: null })

  // Une table de cas en un test (DG1) : le différentiel de `toEqual` nomme les cas fautifs.
  it("should refuse each of these blocks before sending, with its message", () => {
    const cas: [string, BlocEdite, string][] = [
      ["an empty heading", titre("  "), MESSAGES_DU_BLOC.titreVide],
      ["a heading on two lines", titre("Objet\ndu devis"), MESSAGES_DU_BLOC.titreUneLigne],
      ["a heading of 201 characters", titre("x".repeat(201)), MESSAGES_DU_BLOC.titreLong],
      ["a text of 100 001 characters", { type: "paragraph", text: "x".repeat(100_001), data: {}, key: null }, MESSAGES_DU_BLOC.tropLong],
      ["a list of 501 items", { type: "list", text: null, data: { items: Array.from({ length: 501 }, () => "x") }, key: null }, MESSAGES_DU_BLOC.listeLongue],
      // E10-S04 (AC-b1, AC-b2) : les sous-éléments comptent ; un quatrième niveau frappé est refusé.
      ["a list of 501 items, sub-items included", { type: "list", text: null, data: { items: [{ text: "a", children: { items: Array.from({ length: 500 }, () => "x") } }] }, key: null }, MESSAGES_DU_BLOC.listeLongue],
      [
        "a list typed four levels deep",
        { type: "list", text: null, data: { items: [{ text: "a", children: { items: [{ text: "b", children: { items: [{ text: "c", children: { items: ["d"] } }] } }] } }] }, key: null },
        MESSAGES_DU_BLOC.troisNiveaux,
      ],
    ]
    expect(Object.fromEntries(cas.map(([nom, bloc]) => [nom, controler(bloc)]))).toEqual(Object.fromEntries(cas.map(([nom, , message]) => [nom, { message }])))
  })

  it("should see an emptied Texte, heading or list as empty, which is deleted rather than replaced", () => {
    expect(estVide({ type: "paragraph", text: " \n ", data: {}, key: null })).toBe(true)
    expect(estVide({ type: "list", text: null, data: { items: ["", " "] }, key: null })).toBe(true)
    expect(estVide(titre("Objet"))).toBe(false)
  })
})

// E10-S06 : un séparateur n'est jamais vide ; un tableau et un repli, contrôlés avant le schéma, partent sans blanc de bord.
describe("contrôle d'un tableau, d'un repli et d'un séparateur (E10-S06, AC-a4, AC-b1, AC-b4)", () => {
  const tableau = (columns: string[], rows: string[][]): BlocEdite => ({ type: "simple_table", text: null, data: { columns, rows }, key: null })
  const repli = (summary: string, text: string): BlocEdite => ({ type: "toggle", text, data: { summary }, key: null })

  it("should never see a divider as empty, and see a table of blank cells or a toggle without text as empty", () => {
    expect(estVide({ type: "divider", text: null, data: {}, key: null })).toBe(false)
    expect(estVide(tableau(["", " "], [["", ""]]))).toBe(true)
    expect(estVide(tableau(["", "x"], [["", ""]]))).toBe(false)
    expect(estVide(repli(" ", ""))).toBe(true)
  })

  // Une table de cas en un test (DG1) : le différentiel de `toEqual` nomme les cas fautifs.
  it("should refuse each of these tables and toggles before sending, with its message", () => {
    const cas: [string, BlocEdite, string][] = [
      ["a table of 21 columns forced in the model", tableau(Array.from({ length: 21 }, () => "x"), []), MESSAGES_DU_BLOC.colonnes],
      ["a table of 201 rows", tableau(["x"], Array.from({ length: 201 }, () => ["y"])), MESSAGES_DU_BLOC.rangees],
      ["a toggle without summary", repli("  ", "Le corps"), MESSAGES_DU_BLOC.resumeVide],
      ["a toggle summary of 201 characters", repli("é".repeat(201), ""), MESSAGES_DU_BLOC.resumeLong],
      ["a toggle holding a toggle", repli("Détails", "avant\n  <details open>\naprès"), MESSAGES_DU_BLOC.repliDansRepli],
      ["a toggle holding a closing tag", repli("Détails", "</details>"), MESSAGES_DU_BLOC.repliDansRepli],
    ]
    expect(Object.fromEntries(cas.map(([nom, bloc]) => [nom, controler(bloc)]))).toEqual(Object.fromEntries(cas.map(([nom, , message]) => [nom, { message }])))
  })

  it("should send the cells without edge blanks and every typed | escaped, the summary trimmed and the body without edge blank lines", () => {
    expect(MESSAGES_DU_BLOC.colonnes).toBe("20 colonnes au plus.")
    expect(MESSAGES_DU_BLOC.rangees).toBe("200 rangées au plus.")
    expect(entree(tableau([" Nom ", "A|B"], [["x\\|y ", ""]]))).toEqual({ type: "simple_table", data: { columns: ["Nom", "A\\|B"], rows: [["x\\|y", ""]] } })
    expect(entree(repli("  Détails ", "\n\nLe corps\n \n"))).toEqual({ type: "toggle", text: "Le corps", data: { summary: "Détails" } })
  })
})

describe("verdictDuRefus (AC15)", () => {
  const version = (revision: number): BlockView => ({ id: ID_B, ref: "0f1e2d3c", type: "paragraph", text: "Texte de Claire", data: {}, key: null, position: 1, revision, provenance: {} })

  it("should put the block in conflict when its revision changed, say it deleted when absent, else a page conflict when published meanwhile, else the refusal", () => {
    const vise = { id: ID_B, revision: 3 }
    expect(verdictDuRefus(vise, { blocs: [version(4)], revision: 4 }, 4)).toEqual({ genre: "conflit-du-bloc", version: version(4) })
    expect(verdictDuRefus(vise, { blocs: [], revision: 4 }, 4)).toEqual({ genre: "supprime" })
    expect(verdictDuRefus(vise, { blocs: [version(3)], revision: 5 }, 4)).toEqual({ genre: "conflit-de-page" })
    expect(verdictDuRefus(vise, { blocs: [version(3)], revision: 4 }, 4)).toEqual({ genre: "message" })
    expect(verdictDuRefus(null, { blocs: [], revision: 5 }, 4)).toEqual({ genre: "conflit-de-page" })
  })
})
