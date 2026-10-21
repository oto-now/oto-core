// @vitest-environment node
// Fusion d'une ligne écrite et clé d'une ligne, en mémoire (E07-S02, AC3, AC5 à AC7, AC10, AC11, AC14 à
// AC17 ; H92, H94, N19) : `applyRowWrite` et `rowKey` sur les lignes de la fixture d'E07-S01, sans base ;
// la forme d'une écriture (commentaire, lien, raison) par le schéma de `table.write`, seul à la contrôler
// (N22), avec le texte que `call` sert ; les valeurs nues, jugées contre les lignes rangées par
// `withoutBareValues` (fiche D99, M53, HN-M53-5). Les textes servis au modèle sont comparés mot pour mot (H04) ;
// AC4 (un `null` refuse sa seule ligne, D49 B), AC8, AC9 et les écritures en base sont dans
// `tables-write-service.test.ts`.
import { describe, expect, it } from "vitest"
import type { TableHeader } from "../../packages/plateforme/schemas"
import { tableClaimArgsSchema, tableRowWriteSchema, tableWriteArgsSchema, type TableRowWrite } from "../../packages/plateforme/schemas/table-write"
import { isRecord, tableRowsArgsSchema } from "../../packages/plateforme/schemas/tables"
import { issuesText } from "../../packages/plateforme/server/errors"
import { parseTableHeader } from "../../packages/plateforme/server/tables/header"
import type { RowBlock } from "../../packages/plateforme/server/tables/meta"
import { rowKey } from "../../packages/plateforme/server/tables/row-rules"
import { toReadRow } from "../../packages/plateforme/server/tables/rows"
import { withoutBareValues } from "../../packages/plateforme/server/tables/write"
import { applyRowWrite, type CurrentRow, type RowWriteInput } from "../../packages/plateforme/server/tables/write-row"
import { writeReport } from "../../packages/plateforme/server/tables/write-report"
import { PEOPLE } from "../helpers/reference-org"
import { TEMPS_LINEAIRE_MS } from "../helpers/temps-lineaire"
import { PROSPECT_ROWS, PROSPECTS, PROSPECTS_HEADER, TICKETS, WRITTEN_AT } from "../factories/table-fixture"

function headerOf(meta: unknown): TableHeader {
  const parsed = parseTableHeader(meta)
  if (!("header" in parsed)) throw new Error(parsed.problems.join("; "))
  return parsed.header
}

const HEADER = headerOf(PROSPECTS_HEADER)
const ACTOR = { userId: PEOPLE.lea.id, ctx: "ABCD-1234", at: "2026-09-25T10:00:00.000Z" }
const AGENT = { origin: "agent", by: PEOPLE.lea.id, ctx: "ABCD-1234", at: "2026-09-25T10:00:00.000Z" }
const QUEUE = "https://acme.test/n/ventes/suivi_prospects"

function prospect(key: string): RowBlock {
  const found = PROSPECT_ROWS.find((row) => row.key === key)
  if (!found) throw new Error(`no prospect ${key}`)
  return structuredClone(found)
}

/** Une valeur écrite avec sa preuve, seule forme d'une cellule (fiche D99, M53) ; le commentaire n'importe pas au cas. */
const proved = (value: string | number | boolean) => ({ value, comment: "Lu sur le site" })

/** Une ligne écrite sur `current` (une ligne de la fixture par défaut, `null` pour une création), clé déjà normalisée. */
function write(input: Omit<RowWriteInput, "key"> & { key?: string }, current: (NonNullable<CurrentRow> & { key?: string }) | null = prospect("Atelier 2"), header = HEADER) {
  const key = input.key ?? current?.key ?? "Boulangerie du Pont"
  return applyRowWrite({ header, path: PROSPECTS.path, argPath: "rows.0", reviewQueue: QUEUE, current, input: { ...input, key }, actor: ACTOR })
}

/**
 * Le refus que `call` sert pour ces lignes, avant toute écriture (N22) : les problèmes du schéma de
 * `table.write`, chemin par chemin, comme `runCall` les écrit après « Invalid arguments for table.write: ».
 */
function schemaRefusal(rows: unknown[]): string | null {
  const parsed = tableWriteArgsSchema.safeParse({ table: PROSPECTS.path, rows })
  return parsed.success ? null : issuesText(parsed.error.issues)
}

describe("applyRowWrite", () => {
  it("should apply set ({value, comment | link}), clear and verified_empty, keep unnamed columns, and refuse a column named twice (AC3)", () => {
    const before = prospect("Atelier 2")
    const written = write({
      set: { contact: proved("Nina Perrault-Roy"), ville: { value: "Brémontier", comment: "Déménagé en août", link: "https://atelier2.test/contact" } },
      clear: ["relance_le"],
      verified_empty: [{ column: "dernier_contact", reason: "Aucune date connue" }],
    })
    expect(written.problems).toEqual([])
    expect(written.data).toEqual({ entreprise: "Atelier 2", contact: "Nina Perrault-Roy", email: "nina@atelier2.test", ville: "Brémontier", montant_estime: 2000, actif: true, statut: "à traiter" })
    expect(written.provenance.ville).toEqual({ ...AGENT, comment: "Déménagé en août", link: "https://atelier2.test/contact" })
    // La provenance d'import d'une colonne non nommée reste telle quelle (fixture d'E07-S01).
    expect(written.provenance.email).toEqual({ origin: "import", by: PEOPLE.ada.id, at: WRITTEN_AT })
    expect(written.changes).toMatchObject({ set: ["contact", "ville"], cleared: ["relance_le"], verified_empty: ["dernier_contact"] })

    const twice = write({ set: { email: proved("x@y.test") }, verified_empty: [{ column: "email", reason: "Rien trouvé" }], clear: ["notes", "notes"] })
    expect(twice.problems).toEqual(["email: named in both set and verified_empty; name each column once per row.", "notes: named twice in clear; name each column once per row."])
    expect([twice.data, twice.effective]).toEqual([before.data, false])
    // Le lien et le commentaire d'une cellule, contrôlés par le schéma au chemin exact du champ.
    expect(schemaRefusal([{ key: "Atelier 2", set: { ville: { value: "Brémontier", link: "ftp://atelier2.test" } } }])).toBe(
      "rows.0.set.ville.link: expected a URL starting with http:// or https://, 2,000 characters at most",
    )
    expect(schemaRefusal([{ key: "Atelier 2", set: { ville: { value: "Brémontier", comment: "x".repeat(1_001) } } }])).toBe("rows.0.set.ville.comment: 1,000 characters at most")
    // Une opération nomme 100 colonnes au plus, comme un en-tête en déclare (schéma de la ligne).
    const wide = Object.fromEntries(Array.from({ length: 101 }, (_, index) => [`c${index}`, proved(1)]))
    expect([tableRowWriteSchema.safeParse({ key: "Atelier 2", set: wide }).success, tableRowWriteSchema.safeParse({ key: "Atelier 2", clear: Object.keys(wide) }).success]).toEqual([false, false])
  })

  it("should refuse an unknown column in set, clear and verified_empty, listing the columns of the table (AC5)", () => {
    const text =
      "couleur: unknown column. Columns of ventes/suivi_prospects: entreprise, contact, email, ville, montant_estime, dernier_contact, relance_le, actif, notes, statut. Do not retry under a variant of the name."
    for (const input of [{ set: { couleur: proved("bleu") } }, { clear: ["couleur"] }, { verified_empty: [{ column: "couleur", reason: "Pas de couleur" }] }]) {
      expect(write(input).problems, JSON.stringify(input)).toEqual([text])
    }
  })

  it("should check each value with valueProblem: a number, an option, a text under its length (AC6)", () => {
    expect(write({ set: { montant_estime: proved("15000") } }).problems).toEqual(['montant_estime: expected a number, e.g. 12000 (not "15000").'])
    expect(write({ set: { statut: proved("gagné") } }).problems).toEqual(["statut: expected one of: à traiter, en cours, à revoir, qualifié, écarté."])
    expect(write({ set: { notes: proved("x".repeat(2_001)) } }).problems).toEqual(["notes: expected a text of 2,000 characters at most (not 2,001 characters)."])
  })

  it("should replace a value: comment and link fall, imported survives, the destroyed value is named; a comment on the same value keeps the rest (AC10)", () => {
    const provenance = { origin: "human", by: PEOPLE.claire.id, at: WRITTEN_AT, comment: "Vu au salon", link: "https://salon.test/exposants", imported: { value: "Valbrune-le-Haut", at: WRITTEN_AT } }
    const current = { key: "Scierie Vallon", data: { entreprise: "Scierie Vallon", ville: "Valbrune", statut: "à traiter" }, provenance: { ville: provenance }, claimed_by: null }
    const changed = write({ set: { ville: proved("Brémontier") } }, current)
    expect(changed.provenance.ville).toEqual({ ...AGENT, comment: "Lu sur le site", imported: provenance.imported })
    expect(changed.destroyed).toEqual([{ column: "ville", by: "set", was: "Valbrune", now: "Brémontier" }])
    expect(writeReport(PROSPECTS.path, [{ status: "updated", key: "Scierie Vallon", revision: 6, write: changed }]).text.split("\n")[1]).toBe(
      "Scierie Vallon: updated (revision 6): ville: Valbrune → Brémontier.",
    )
    const commented = write({ set: { ville: { value: "Valbrune", comment: "Vu sur le site" } } }, current)
    expect([commented.effective, commented.data.ville, commented.provenance.ville]).toEqual([true, "Valbrune", { ...provenance, comment: "Vu sur le site" }])
  })

  it("should name what clear and verified_empty destroy, keep the reason, and refuse them on the key or the state column (AC11)", () => {
    const clinique = prospect("Clinique des Saules")
    const current = { ...clinique, data: { ...(isRecord(clinique.data) ? clinique.data : {}), email: "contact@exemple.test" } }
    const written = write({ clear: ["notes"], verified_empty: [{ column: "email", reason: "Aucune adresse sur le site" }] }, current)
    expect(writeReport(PROSPECTS.path, [{ status: "updated", key: "Clinique des Saules", revision: 2, write: written }]).text.split("\n")[1]).toBe(
      "Clinique des Saules: updated (revision 2): notes: cleared (was « Rappeler en octobre »); email: verified_empty (was « contact@exemple.test »).",
    )
    expect([written.data.email, written.data.notes, written.provenance.notes]).toEqual([undefined, undefined, undefined])
    expect(written.provenance.email).toEqual({ origin: "verified_empty", by: PEOPLE.lea.id, ctx: "ABCD-1234", at: "2026-09-25T10:00:00.000Z", reason: "Aucune adresse sur le site" })
    const read = toReadRow({ ...current, key: "Clinique des Saules", data: written.data, provenance: written.provenance }, HEADER, new Map())
    expect(read.verified_empty).toEqual([{ column: "email", reason: "Aucune adresse sur le site" }])
    // Une raison de moins de 3 caractères, espaces de bord retirés : refusée par le schéma (N22).
    expect(schemaRefusal([{ key: "Atelier 2", verified_empty: [{ column: "email", reason: " ok " }] }])).toBe(
      "rows.0.verified_empty.0.reason: verified_empty needs a reason of 3 characters at least",
    )
    expect(write({ verified_empty: [{ column: "entreprise", reason: "Sans nom" }, { column: "statut", reason: "Sans état" }] }).problems).toEqual([
      "entreprise: this is the key column; it cannot be verified_empty.",
      "statut: this is the state column of the work queue; it cannot be verified_empty.",
    ])
  })

  it("should require a required column at creation, refuse to clear one, and note one that an existing row lacks (AC14)", () => {
    const strict = headerOf({ ...PROSPECTS_HEADER, columns: PROSPECTS_HEADER.columns.map((column) => (column.name === "contact" ? { ...column, required: true } : column)) })
    const created = write({ key: "Boulangerie du Pont", set: { ville: proved("Valbrune") } }, null, strict)
    expect(created.problems).toEqual(["contact: required when creating a row: set it, or verified_empty with a reason."])
    expect(write({ key: "Boulangerie du Pont", verified_empty: [{ column: "contact", reason: "Aucun nom publié" }] }, null, strict).problems).toEqual([])
    expect(write({ clear: ["statut"] }, prospect("Atelier 2"), strict).problems).toEqual(["statut: required: it cannot be cleared."])
    const garage = write({ set: { notes: proved("Relancer") } }, prospect("Garage des Tilleuls"), strict)
    expect([garage.problems, garage.effective, garage.notes]).toEqual([[], true, ["note: contact is required and has no value on this row."]])
    // Une colonne `constructor`, que le motif des noms admet, se lit dans la ligne, jamais dans le prototype d'un objet.
    const named = headerOf({ ...PROSPECTS_HEADER, columns: [...PROSPECTS_HEADER.columns, { name: "constructor", type: "text", required: true }] })
    expect(write({ key: "Boulangerie du Pont" }, null, named).problems).toEqual(["constructor: required when creating a row: set it, or verified_empty with a reason."])
  })

  it("should write a row whose other column is out of format, with a note on that column (AC15)", () => {
    const current = { key: "Brasserie de la Lise", data: { entreprise: "Brasserie de la Lise", montant_estime: "12 000", statut: "à traiter" }, provenance: {}, claimed_by: null }
    const written = write({ set: { notes: proved("Rappeler lundi") } }, current)
    expect([written.problems, written.effective, written.data.notes]).toEqual([[], true, "Rappeler lundi"])
    expect(written.notes).toEqual(['note: montant_estime holds a value that is not a number ("12 000"); fix it with set.'])
  })

  it("should refuse a key column that differs from key, ignore one equal to it, and keep the key in data (AC16)", () => {
    expect(write({ set: { entreprise: proved("Autre nom") } }).problems).toEqual([
      "entreprise: this is the key column; it is set by key. Renaming a row's key is not possible in this version.",
    ])
    // La colonne clé égale à `key` passe, sa valeur inchangée ; sa preuve, obligatoire (M53), s'annote comme sur toute valeur inchangée (AC10).
    const same = write({ set: { entreprise: proved("Atelier 2") } })
    expect([same.problems, same.data.entreprise, same.changes.set, same.changes.annotated]).toEqual([[], "Atelier 2", [], ["entreprise"]])
  })

  it("should keep the working state to table.claim, the decisions to the review, and a claimed row's state to table.release (AC17)", () => {
    expect(write({ set: { statut: proved("en cours") } }).problems).toEqual(["statut: « en cours » is set by table.claim, with a lease."])
    for (const decision of ["qualifié", "écarté"]) {
      expect(write({ set: { statut: proved(decision) } }).problems, decision).toEqual([
        "statut: « qualifié » and « écarté » are decided by a person in the review queue of this table (https://acme.test/n/ventes/suivi_prospects).",
      ])
    }
    expect(write({ set: { statut: proved("à revoir") } }, prospect("Atelier 10")).problems).toEqual(["statut: the row is claimed: change its state with table.release."])
    for (const state of ["à revoir", "à traiter"]) {
      const written = write({ set: { statut: proved(state) } }, prospect("Boulangerie Fournier"))
      expect([written.problems, written.data.statut], state).toEqual([[], state])
    }
  })
})

describe("bare values of table.write: ignored when equal to the stored one, otherwise the whole call refused (fiche D99, M53, HN-M53-5)", () => {
  const SHAPE = 'expected a value, {"value": …, "comment": "…"} or {"value": …, "link": "https://…"}; a new value needs its proof when the table requires it (table.schema says it)'
  const UNPROVED =
    'new value without its proof: write {"value": …, "comment": "…"} (where you found it) or {"value": …, "link": "https://…"} (the source); a column searched without result goes in verified_empty with a reason'
  const stored = new Map(PROSPECT_ROWS.map((row) => [row.key, row]))
  const sorted = (rows: TableRowWrite[]) => withoutBareValues(HEADER, rows, stored)

  it("should admit a bare value or {value} without proof in the schema, and refuse another shape saying the documented form", () => {
    expect(schemaRefusal([{ key: "Atelier 2", set: { contact: "Anne Roy", montant_estime: 1500, actif: true, notes: { value: "x" } } }])).toBeNull()
    expect(schemaRefusal([{ key: "Atelier 2", set: { contact: ["Anne Roy"] } }])).toBe(`rows.0.set.contact: ${SHAPE}`)
  })

  it("should drop a bare value equal to the stored one, compared in the column type, and keep a value with its proof and a null", () => {
    const set = {
      entreprise: "Atelier 2",
      contact: "Nina Perrault",
      montant_estime: 2000,
      dernier_contact: "2026-03-02",
      relance_le: "2026-09-30T11:00:00+02:00",
      actif: true,
      statut: { value: "à traiter" },
      email: { value: "nina@atelier2.test", comment: "  " },
      ville: proved("Brémontier"),
      notes: null,
    }
    // La clé et l'état restent à leur ligne, qui les juge (décision de JB du 2026-09-27) : égaux, ils n'y changent rien.
    const kept = { entreprise: "Atelier 2", statut: { value: "à traiter" }, ville: proved("Brémontier"), notes: null }
    expect(sorted([{ key: "Atelier 2", set }])).toEqual({ rows: [{ key: "Atelier 2", set: kept }] })
    // Une valeur rangée hors format, renvoyée telle quelle, est égale à elle-même (AC29).
    expect(sorted([{ key: "Brasserie de la Lise", set: { montant_estime: "12000" } }])).toEqual({ rows: [{ key: "Brasserie de la Lise", set: {} }] })
  })

  it("should refuse the whole call on a bare value that differs from the stored one, in type or in value, or lands on a new row, naming each", () => {
    const rows: TableRowWrite[] = [
      { key: "Atelier 2", set: { ville: proved("Coudray") } },
      { key: "Atelier 2", set: { montant_estime: "2000", dernier_contact: "2026-03-03", actif: "true", contact: "Nina Perrault ", email: { value: "x@atelier2.test", comment: " " } } },
      { key: "Nouveau Prospect", set: { entreprise: "Nouveau Prospect", ville: "Valbrune" } },
    ]
    const refused = [
      ["1", "montant_estime"],
      ["1", "dernier_contact"],
      ["1", "actif"],
      ["1", "contact"],
      ["1", "email"],
      ["2", "ville"],
    ]
    expect(sorted(rows)).toEqual({ issues: refused.map(([row, column]) => ({ path: ["rows", row, "set", column], message: UNPROVED })) })
  })

  it("should keep a bare state or key out of the proof, to the rules of its row: a permitted state is written, a decision or a new key refused with its own reason (decision of JB, 2026-09-27)", () => {
    const rows: TableRowWrite[] = [{ key: "Boulangerie Fournier", set: { statut: "à revoir" } }, { key: "Atelier 2", set: { statut: "qualifié", entreprise: "Atelier 3" } }]
    expect(sorted(rows)).toEqual({ rows })
    const permitted = write({ set: { statut: "à revoir" } }, prospect("Boulangerie Fournier"))
    expect([permitted.problems, permitted.data.statut]).toEqual([[], "à revoir"])
    expect(write({ set: { statut: "qualifié" } }, prospect("Boulangerie Fournier")).problems).toEqual([
      `statut: « qualifié » and « écarté » are decided by a person in the review queue of this table (${QUEUE}).`,
    ])
    expect(write({ set: { entreprise: "Atelier 3" } }).problems).toEqual(["entreprise: this is the key column; it is set by key. Renaming a row's key is not possible in this version."])
  })
})

// La preuve par tableau (AC-f2), l'hôte et le travailleur (AC-d2, AC-d3) : `tables-write-service.test.ts`, qui les voit
// à travers le service (le bail du travailleur compris).
describe("E11-S01: strict required column, bounds said", () => {
  const refusal = (parsed: { success: boolean; error?: { issues: Parameters<typeof issuesText>[0] } }) => (parsed.error ? issuesText(parsed.error.issues) : null)
  /** L'en-tête de référence où `contact` est requise, stricte ou non. */
  const contactRequired = (strict: boolean) =>
    headerOf({ ...PROSPECTS_HEADER, columns: PROSPECTS_HEADER.columns.map((column) => (column.name === "contact" ? { ...column, required: true, ...(strict ? { allow_verified_empty: false } : {}) } : column)) })

  it("should refuse verified_empty on a column that needs a real value, and require its value at creation (AC-b2, AC-b3, AC-b4)", () => {
    const strict = contactRequired(true)
    expect(write({ verified_empty: [{ column: "contact", reason: "Aucun nom publié" }] }, prospect("Atelier 2"), strict).problems).toEqual([
      "contact: needs a real value; verified_empty is not allowed for this column.",
    ])
    expect(write({ key: "Boulangerie du Pont", set: { ville: proved("Valbrune") } }, null, strict).problems).toEqual([
      "contact: required when creating a row: set it with its proof; verified_empty is not allowed for this column.",
    ])
    // Sans preuve exigée, la phrase ne la demande pas.
    expect(write({ key: "Boulangerie du Pont", set: { ville: "Valbrune" } }, null, { ...strict, proof: false }).problems).toEqual([
      "contact: required when creating a row: set it; verified_empty is not allowed for this column.",
    ])
    // Une ligne rangée qui n'a qu'un `verified_empty` sur la colonne : la note le dit ; sans l'attribut, rien (AC-b4).
    const emptied = {
      key: "Scierie Vallon",
      data: { entreprise: "Scierie Vallon", statut: "à traiter" },
      provenance: { contact: { origin: "verified_empty", by: PEOPLE.lea.id, at: WRITTEN_AT, reason: "Aucun nom publié" } },
      claimed_by: null,
    }
    expect(write({ set: { notes: proved("Relancer") } }, emptied, strict).notes).toEqual(["note: contact is required and has no value on this row."])
    expect(write({ set: { notes: proved("Relancer") } }, emptied, contactRequired(false)).notes).toEqual([])
  })

  it("should refuse revision with create_only at its path, and say the bounds of rows, limit and claim word for word (AC-a4, AC-c4)", () => {
    const createOnly = tableWriteArgsSchema.safeParse({ table: PROSPECTS.path, create_only: true, rows: [{ key: "Atelier 3" }, { key: "Atelier 2", revision: 3 }] })
    expect(refusal(createOnly)).toBe("rows.1.revision: revision is for an existing row; create_only only creates rows: remove one of them")
    expect(tableWriteArgsSchema.safeParse({ table: PROSPECTS.path, rows: [{ key: "Atelier 2", revision: 3 }] }).success).toBe(true)
    const many = tableWriteArgsSchema.safeParse({ table: PROSPECTS.path, rows: Array.from({ length: 51 }, (_, index) => ({ key: `P${index}` })) })
    expect(refusal(many)).toBe("rows: 50 rows at most per call; send the others in another call")
    expect(refusal(tableRowsArgsSchema.safeParse({ table: PROSPECTS.path, limit: 100 }))).toBe("limit: 50 rows at most per page; use next_cursor for more")
    expect(refusal(tableClaimArgsSchema.safeParse({ table: PROSPECTS.path, worker: "claude-claire", limit: 6 }))).toBe("limit: 5 rows at most per claim; call table.claim again for more")
  })
})

describe("rowKey (AC7, N19)", () => {
  it("should trim edge spaces, refuse an empty key or a control character, bound it to 200 characters, and pass valueProblem of the key column", () => {
    expect(rowKey(HEADER, "Boulangerie du Pont  ")).toEqual({ key: "Boulangerie du Pont" })
    for (const empty of ["", "   "]) expect(rowKey(HEADER, empty)).toEqual({ problem: "key: an empty key designates no row; nothing written." })
    for (const control of ["Boulangerie\ndu Pont", "Boulangerie\tdu Pont"]) expect(rowKey(HEADER, control)).toEqual({ problem: "key: control characters are not allowed in a key." })
    expect(rowKey(HEADER, "x".repeat(201))).toEqual({ problem: "key: a key holds 200 characters at most (not 201 characters)." })
    const short = headerOf({ ...PROSPECTS_HEADER, columns: PROSPECTS_HEADER.columns.map((column) => (column.name === "entreprise" ? { ...column, max_length: 20 } : column)) })
    expect(rowKey(short, "Boulangerie du Pont de Pierre")).toEqual({ problem: "key: expected a text of 20 characters at most (not 29 characters)." })
    expect(rowKey(HEADER, 12)).toEqual({ problem: "key: expected a text (not 12)." })
  })

  it("should store a number key in canonical text: 12000, \"12000\" and \"12000.0\" designate the same row", () => {
    const tickets = headerOf(TICKETS.header)
    expect([12000, "12000", "12000.0", " 12000 "].map((raw) => rowKey(tickets, raw))).toEqual(Array.from({ length: 4 }, () => ({ key: "12000" })))
    expect(rowKey(tickets, "douze")).toEqual({ problem: 'key: expected a number, e.g. 12000 (not "douze").' })
  })

  it("should read a hostile key of the largest size a client sends in linear time (security-patterns.md § Validation des inputs)", () => {
    const tickets = headerOf(TICKETS.header)
    const million = 1_000_000
    for (const [header, key] of [
      [HEADER, " ".repeat(million)],
      [HEADER, `${" ".repeat(million)}x`],
      [tickets, `${"1".repeat(million)}x`],
      [tickets, `${"1".repeat(million)}.`],
    ] as const) {
      const started = performance.now()
      rowKey(header, key)
      expect(performance.now() - started, `${key.slice(-2)} × ${key.length}`).toBeLessThan(TEMPS_LINEAIRE_MS)
    }
  })
})
