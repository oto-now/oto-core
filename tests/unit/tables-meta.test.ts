// @vitest-environment node
// En-tête et valeurs d'un tableau (E07-S01, AC1 à AC3 ; H90, H91) : `parseTableHeader` et
// `valueProblem`, fonctions pures, sans base. Les refus sont servis au modèle (écriture d'E07-S02,
// filtres) : leurs textes sont comparés mot pour mot (H04).
import { describe, expect, it } from "vitest"
import type { TableColumn } from "../../packages/plateforme/schemas"
import { parseTableHeader } from "../../packages/plateforme/server/tables/header"
import { normalizeValue, valueProblem } from "../../packages/plateforme/server/tables/meta"
import { PROSPECTS_HEADER, STATES } from "../factories/table-fixture"

/** L'en-tête de référence, une partie remplacée. */
function variant(change: Record<string, unknown>): Record<string, unknown> {
  return { ...structuredClone(PROSPECTS_HEADER), ...change }
}

const LIFECYCLE = PROSPECTS_HEADER.lifecycle

describe("parseTableHeader (AC1, AC2)", () => {
  it("should accept the header of the reference table, closed and proof false when absent (AC1; E11-S01 AC-f1)", () => {
    expect(parseTableHeader(PROSPECTS_HEADER)).toEqual({ header: PROSPECTS_HEADER })
    const open: Record<string, unknown> = structuredClone(PROSPECTS_HEADER)
    delete open.closed
    delete open.proof
    expect(parseTableHeader(open)).toEqual({ header: { ...open, closed: false, proof: false } })
    // FB-0014 : une colonne de dates peut porter la clé ; une date et heure, non.
    expect("header" in parseTableHeader(variant({ key: "dernier_contact" }))).toBe(true)
    expect(parseTableHeader(variant({ key: "relance_le" }))).toEqual({ problems: ["key: the key column must be text, email, url, number or date; relance_le is datetime."] })
    expect(parseTableHeader([])).toEqual({ problems: ["header: expected an object {columns, key, lifecycle?, closed?, proof?}."] })
  })

  it("should name each problem with its path (AC2)", () => {
    const columns = PROSPECTS_HEADER.columns
    const cases: [Record<string, unknown>, string][] = [
      [variant({ columns: [...columns.slice(0, 2), { name: "email", type: "email", read_only: true }, ...columns.slice(3)] }), "columns[2].read_only: unknown attribute. Allowed: name, label, type, options, required, allow_verified_empty, max_length."],
      [variant({ columns: [...columns.slice(0, 4), { name: "montant_estime", type: "money" }, ...columns.slice(5)] }), "columns[4].type: unknown type money. Types: text, number, date, datetime, bool, enum, email, url."],
      [variant({ stricte: true }), "stricte: unknown attribute. Allowed: columns, key, lifecycle, closed, proof."],
      [variant({ lifecycle: { ...LIFECYCLE, stricte: true } }), "lifecycle.stricte: unknown attribute. Allowed: column, states, working, review."],
      [variant({ lifecycle: { ...LIFECYCLE, review: { ...LIFECYCLE.review, auto: true } } }), "lifecycle.review.auto: unknown attribute. Allowed: state, approve, reject, agents_may_decide."],
      [variant({ key: "societe" }), "key: unknown column societe. Columns: entreprise, contact, email, ville, montant_estime, dernier_contact, relance_le, actif, notes, statut."],
      [variant({ key: "statut" }), "key: the key column must be text, email, url, number or date; statut is enum."],
      [variant({ lifecycle: { ...LIFECYCLE, states: [...STATES].reverse() } }), "lifecycle.states must list exactly the options of statut, in the same order."],
      [variant({ lifecycle: { ...LIFECYCLE, working: "en attente" } }), "lifecycle.working: en attente is not one of the states of statut."],
      [variant({ lifecycle: { ...LIFECYCLE, working: "à traiter" } }), "lifecycle.working: à traiter is the first state, where rows enter; the working state comes after it."],
      [variant({ lifecycle: { ...LIFECYCLE, review: { state: "à revoir", approve: "en cours", reject: "écarté" } } }), "lifecycle.review: state, approve and reject are three different states, none of them en cours."],
      [variant({ columns: [...columns.slice(0, 8), { name: "notes", type: "text", options: ["a"] }, columns[9]] }), "columns[8].options: options apply to enum columns only; notes is text."],
      [variant({ columns: [...columns.slice(0, 7), { name: "actif", type: "bool", max_length: 5 }, ...columns.slice(8)] }), "columns[7].max_length: max_length applies to text, email and url columns; actif is bool."],
      [variant({ columns: [...columns.slice(0, 9), { ...columns[9], options: [...STATES, "à traiter"] }] }), "columns[9].options[5]: duplicate option « à traiter »."],
      [variant({ columns: [...columns.slice(0, 9), { name: "statut", type: "enum", options: [] }] }), "columns[9].options: an enum column lists 1 to 100 options (0 given)."],
      [variant({ columns: [...columns, { name: "ville", type: "text" }] }), "columns[10].name: duplicate column ville."],
      [variant({ columns: [{ name: "Entreprise", type: "text" }, ...columns.slice(1)] }), "columns[0].name: lowercase letters, digits and _, starting with a letter, 60 characters at most, e.g. montant_estime."],
    ]
    for (const [header, problem] of cases) {
      const parsed = parseTableHeader(header)
      expect("problems" in parsed && parsed.problems, problem).toContain(problem)
    }
  })

  it("should return every problem of a header in one call, never the first alone (AC2)", () => {
    const header = {
      columns: [
        { name: "entreprise", type: "text", required: true },
        { name: "notes", type: "text", options: ["a"] },
        { name: "contact", type: "text", read_only: true },
        { name: "contact", type: "email" },
        { name: "montant", type: "money" },
        { name: "statut", type: "enum", options: ["à traiter", "en cours", "fait"] },
      ],
      key: "statut",
      lifecycle: { column: "statut", states: ["à traiter", "en cours", "fait"], working: "en attente" },
      couleur: "bleu",
    }
    const parsed = parseTableHeader(header)
    expect("problems" in parsed && [...parsed.problems].sort()).toEqual(
      [
        "columns[2].read_only: unknown attribute. Allowed: name, label, type, options, required, allow_verified_empty, max_length.",
        "columns[4].type: unknown type money. Types: text, number, date, datetime, bool, enum, email, url.",
        "couleur: unknown attribute. Allowed: columns, key, lifecycle, closed, proof.",
        "columns[1].options: options apply to enum columns only; notes is text.",
        "columns[3].name: duplicate column contact.",
        "key: the key column must be text, email, url, number or date; statut is enum.",
        "lifecycle.working: en attente is not one of the states of statut.",
      ].sort(),
    )
  })
})

describe("valueProblem (AC3)", () => {
  const column = (type: TableColumn["type"], extra: Partial<TableColumn> = {}): TableColumn => ({ name: "c", type, ...extra })
  const statut = column("enum", { options: STATES })

  it("should accept a value of the column type and name the expected form otherwise, null never a value", () => {
    const cases: [TableColumn, unknown, string | null][] = [
      [column("text"), "Visite prévue", null],
      [column("text"), "x".repeat(2001), "expected a text of 2,000 characters at most (not 2,001 characters)"],
      [column("text", { max_length: 200 }), "x".repeat(201), "expected a text of 200 characters at most (not 201 characters)"],
      [column("number"), 12000, null],
      [column("number"), "12000", 'expected a number, e.g. 12000 (not "12000")'],
      [column("number"), true, "expected a number, e.g. 12000 (not true)"],
      [column("date"), "2026-02-28", null],
      [column("date"), "2026-02-30", 'expected a date YYYY-MM-DD, e.g. 2026-09-24 (not "2026-02-30")'],
      [column("datetime"), "2026-09-24T14:30:00+02:00", null],
      [column("datetime"), "2026-09-24T14:30:00", 'expected a date and time with a time zone, e.g. 2026-09-24T14:30:00Z (not "2026-09-24T14:30:00")'],
      [column("bool"), false, null],
      [column("bool"), "true", 'expected true or false (not "true")'],
      [statut, "à traiter", null],
      [statut, "A traiter", "expected one of: à traiter, en cours, à revoir, qualifié, écarté"],
      [column("email"), "contact@valbrune.test", null],
      [column("email"), "contact@@valbrune.test", 'expected an email address, e.g. contact@example.test (not "contact@@valbrune.test")'],
      [column("email"), "contact @valbrune.test", 'expected an email address, e.g. contact@example.test (not "contact @valbrune.test")'],
      [column("email"), `${"a".repeat(250)}@b.test`, "expected an email address of 254 characters at most (not 257 characters)"],
      [column("url"), "https://valbrune.test/deliberation-12", null],
      [column("url"), "ftp://valbrune.test", 'expected a URL starting with http:// or https:// (not "ftp://valbrune.test")'],
      [column("url"), `https://${"a".repeat(2000)}`, "expected a URL of 2,000 characters at most (not 2,008 characters)"],
    ]
    for (const [col, value, expected] of cases) expect(valueProblem(col, value), `${col.type} ${String(value).slice(0, 40)}`).toBe(expected)
    for (const type of ["text", "number", "date", "datetime", "bool", "email", "url"] as const) {
      expect(valueProblem(column(type), null)).toBe("expected a value (not null)")
    }
    expect(valueProblem(statut, null)).toBe("expected a value (not null)")
    // Une date et heure est rangée en UTC `…Z`.
    expect(normalizeValue(column("datetime"), "2026-09-24T14:30:00+02:00")).toBe("2026-09-24T12:30:00.000Z")
  })
})
