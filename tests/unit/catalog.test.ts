// @vitest-environment node
// Catalogue des fonctions derrière `call` (E03-S01, AC23, H80, H81) : fonctions de test ; le
// catalogue livré porte le mail simulé (E04-S01).
import * as z from "zod/v4"
import { describe, expect, it } from "vitest"
import { checkArguments } from "../../packages/plateforme/server/catalog/arguments"
import { defineFunction, type CatalogFunction } from "../../packages/plateforme/server/catalog/define"
import {
  callExamples,
  catalogFunctions,
  describeFunction,
  findFunction,
  isActive,
  looksLikeFunction,
  searchFunctions,
} from "../../packages/plateforme/server/catalog/registry"

const ok = async () => ({ text: "ok" })

const ROWS = defineFunction({
  name: "table.rows",
  connector: "table",
  class: "read",
  origin: "paquet",
  description: "Reads the rows of a table, 20 at a time, with a filter and a sort.",
  schema: z.strictObject({ table: z.string().describe("Path of the table, e.g. ventes/suivi_prospects.") }),
  examples: [{ table: "ventes/suivi_prospects" }],
  refusals: ["Unknown table: the path is not a table you can read."],
  run: ok,
})
const WRITE = defineFunction({
  name: "table.write",
  connector: "table",
  class: "write",
  origin: "paquet",
  description: "Writes rows of a table by key.",
  schema: z.strictObject({ table: z.string() }),
  examples: [],
  refusals: [],
  run: ok,
})
const DRAFT = defineFunction({
  name: "mail.create_draft",
  connector: "mail",
  class: "write",
  origin: "connecteur",
  description: "Creates an email draft in the simulated mailbox.",
  schema: z.strictObject({ to: z.string() }),
  examples: [],
  refusals: [],
  run: ok,
})
const SEND = defineFunction({
  name: "mail.send_draft",
  connector: "mail",
  class: "sensitive",
  origin: "connecteur",
  description: "Sends an email draft.",
  schema: z.strictObject({ id: z.string() }),
  examples: [{ id: "sim_0a1b2c3d" }],
  refusals: ["Unknown draft."],
  run: ok,
  summarize: async () => ({ text: "Send 1 draft" }),
})
const INVOICE = defineFunction({
  name: "erp.list_invoices",
  connector: "erp",
  class: "read",
  origin: "erp",
  description: "Lists the invoices of the ERP.",
  schema: z.strictObject({}),
  examples: [],
  refusals: [],
  run: ok,
})
const ALERT = defineFunction({
  name: "slack.post_alert",
  connector: "slack",
  class: "sensitive",
  origin: "connecteur",
  description: "Posts an alert in a channel.",
  schema: z.strictObject({}),
  examples: [],
  refusals: [],
  run: ok,
})
const FUNCTIONS: CatalogFunction[] = [ROWS, WRITE, DRAFT, SEND, INVOICE, ALERT]
const NONE: ReadonlySet<string> = new Set()

describe("catalog (AC23)", () => {
  // E04-S01 y inscrit le mail simulé, E07-S01 la lecture des tableaux ; les fonctions ERP (E08-S05) suivront.
  it("should ship the simulated mail and the table functions, call citing table.rows for every organisation", () => {
    expect(catalogFunctions().map((fn) => fn.name)).toEqual([
      "mail.create_draft",
      "mail.send_draft",
      "table.schema",
      "table.rows",
      "table.aggregate",
      "table.write",
      "table.claim",
      "table.release",
      "table.import",
      "table.delete_rows",
      "node.discard_draft",
      "node.trash",
      // E11-S18 (AC-5, AC-12) : déplacer, écrire par lot.
      "node.move",
      "node.write_many",
      // Transfert d'une arborescence d'un MCP Oto à un autre.
      "node.export_tree",
      "node.import_tree",
      // E10-S02 (lot f) : le dépôt par lien à usage unique.
      "upload.link",
    ])
    expect(callExamples(catalogFunctions(), NONE)).toEqual(["table.rows"])
  })

  // E11-S18 (AC-5, AC-12) : deux fonctions d'écriture natives, aux schémas stricts, trouvées par les mots d'un assistant.
  it("should serve node.move and node.write_many as native write functions, strict, and find node.move by the words of a move", () => {
    const writing = ["node.move", "node.write_many"].map((name) => findFunction(catalogFunctions(), name))
    expect(writing.map((fn) => [fn?.name, fn?.class, fn?.origin, fn?.summarize])).toEqual([
      ["node.move", "write", "paquet", undefined],
      ["node.write_many", "write", "paquet", undefined],
    ])
    for (const fn of writing) expect(fn && checkArguments(fn.schema, { ...fn.examples[0], extra: 1 }).success, fn?.name).toBe(false)
    const many = findFunction(catalogFunctions(), "node.write_many")
    expect(many && checkArguments(many.schema, { pages: [{ path: "sav/fiche", markdown: "# Fiche" }] }).success).toBe(false)
    expect(many && checkArguments(many.schema, { pages: Array.from({ length: 51 }, (_, rank) => ({ path: `sav/p${rank}` })) }).success).toBe(false)
    for (const query of ["move rename node path", "déplacer renommer dossier", "reorganize folder"]) {
      expect(searchFunctions(catalogFunctions(), query, 3)[0]?.fn.name, query).toBe("node.move")
    }
  })

  // E11-S02 (AC-h1, HN-E11S02-6) : les trois fonctions qui suppriment, en deux temps, natives, aux schémas stricts.
  it("should serve node.discard_draft, node.trash and table.delete_rows as sensitive native functions with a summary and strict schemas", () => {
    const deleting = ["node.discard_draft", "node.trash", "table.delete_rows"].map((name) => findFunction(catalogFunctions(), name))
    expect(deleting.map((fn) => [fn?.name, fn?.class, fn?.origin, typeof fn?.summarize])).toEqual([
      ["node.discard_draft", "sensitive", "paquet", "function"],
      ["node.trash", "sensitive", "paquet", "function"],
      ["table.delete_rows", "sensitive", "paquet", "function"],
    ])
    for (const fn of deleting) expect(fn && checkArguments(fn.schema, { ...fn.examples[0], extra: 1 }).success, fn?.name).toBe(false)
    const deleteRows = deleting[2]
    expect(deleteRows && checkArguments(deleteRows.schema, { table: "ventes/salons", keys: [] }).success).toBe(false)
    expect(deleteRows && checkArguments(deleteRows.schema, { table: "ventes/salons", keys: Array.from({ length: 51 }, (_, rank) => `K${rank}`) }).success).toBe(false)
    // Recherchées par leurs mots (AC-h1), jamais proposées ni citées en exemple (H87).
    for (const [query, name] of [["delete rows", "table.delete_rows"], ["trash", "node.trash"], ["discard draft", "node.discard_draft"]]) {
      expect(searchFunctions(catalogFunctions(), query, 3).map((found) => found.fn.name), query).toContain(name)
    }
    expect(callExamples(catalogFunctions(), new Set(["node"]))).not.toContain("node.trash")
  })

  it("should serve table.schema, table.rows and table.aggregate as native read functions with strict schemas and closed contracts (E07-S01 AC19)", () => {
    const tables = catalogFunctions().filter((fn) => fn.connector === "table" && fn.class === "read")
    const next = { "table.schema": ["table.rows", "table.aggregate"], "table.rows": ["table.aggregate"], "table.aggregate": ["table.rows"] }
    expect(tables.map((fn) => [fn.name, fn.class, fn.origin, isActive(fn, NONE), fn.next])).toEqual(
      Object.entries(next).map(([name, after]) => [name, "read", "paquet", true, after]),
    )
    for (const fn of tables) {
      expect(fn.description.split(". ")[0], fn.name).toMatch(/^(Describes|Reads|Counts) (a table|the rows of a table)[:,]/)
      expect(fn.refusals.length, fn.name).toBeGreaterThan(0)
      for (const example of fn.examples) {
        expect(example.table, fn.name).toBe("ventes/suivi_prospects")
        expect(checkArguments(fn.schema, example).success, JSON.stringify(example)).toBe(true)
      }
      const { text, data } = describeFunction(fn, "acme")
      expect(JSON.stringify({ ...data, text, next_actions: ["acme_call"] }).length, fn.name).toBeLessThan(45_000)
    }
    const rows = tables.find((fn) => fn.name === "table.rows")
    const typo = rows && checkArguments(rows.schema, { table: "ventes/suivi_prospects", filters: { ville: "Valbrune" } })
    expect(typo?.success === false && typo.issues).toEqual([expect.objectContaining({ code: "unrecognized_keys", message: expect.stringContaining("filters") })])
  })

  it("should find a function by its exact name, edge spaces removed", () => {
    expect(findFunction(FUNCTIONS, "  table.rows ")).toBe(ROWS)
    expect(findFunction(FUNCTIONS, "table.row")).toBeNull()
    expect(findFunction(FUNCTIONS, "Table.rows")).toBeNull()
  })

  it("should tell a function name from a node path", () => {
    expect(looksLikeFunction("table.rows")).toBe(true)
    expect(looksLikeFunction("mail.create_draft")).toBe(true)
    expect(looksLikeFunction("ventes/relance_devis")).toBe(false)
    expect(looksLikeFunction("journal")).toBe(false)
  })

  it("should keep native and ERP functions active, and remote ones only when their connector is", () => {
    expect(isActive(ROWS, NONE)).toBe(true)
    expect(isActive(INVOICE, NONE)).toBe(true)
    expect(isActive(DRAFT, NONE)).toBe(false)
    expect(isActive(DRAFT, new Set(["mail"]))).toBe(true)
  })

  it("should rank by share of words found, then by name", () => {
    const found = searchFunctions(FUNCTIONS, "rows of a table", 3)
    expect(found.map((result) => [result.fn.name, result.score])).toEqual([
      ["table.rows", 1],
      ["table.write", 1],
    ])
    expect(searchFunctions(FUNCTIONS, "email drafts", 5).map((result) => result.fn.name)).toEqual([
      "mail.create_draft",
      "mail.send_draft",
    ])
  })

  it("should match 3-letter words whole and longer words by prefix both ways", () => {
    expect(searchFunctions(FUNCTIONS, "row", 5)).toEqual([])
    expect(searchFunctions(FUNCTIONS, "invoice", 5).map((result) => result.fn.name)).toEqual(["erp.list_invoices"])
    expect(searchFunctions(FUNCTIONS, "erp", 5).map((result) => result.fn.name)).toEqual(["erp.list_invoices"])
    expect(searchFunctions(FUNCTIONS, "a an", 5)).toEqual([])
  })

  it("should describe a function in the contract format", () => {
    const { text, data } = describeFunction(ROWS, "acme")
    expect(text).toBe(
      [
        "Function table.rows (connector table, origin paquet, class read)",
        "Reads the rows of a table, 20 at a time, with a filter and a sort.",
        "Arguments (JSON Schema):",
        '{"type":"object","properties":{"table":{"description":"Path of the table, e.g. ventes/suivi_prospects.","type":"string"}},"required":["table"],"additionalProperties":false}',
        "Examples:",
        'acme_call {"function": "table.rows", "arguments": {"table":"ventes/suivi_prospects"}}',
        "Possible refusals:",
        "- Unknown table: the path is not a table you can read.",
      ].join("\n"),
    )
    expect(data).toEqual({
      function: "table.rows",
      connector: "table",
      class: "read",
      origin: "paquet",
      arguments_schema: JSON.parse(text.split("\n")[3]),
      examples: [{ table: "ventes/suivi_prospects" }],
    })
  })

  it("should announce the two-step confirmation of a sensitive function", () => {
    expect(describeFunction(SEND, "acme").text.split("\n")[0]).toBe(
      "Function mail.send_draft (connector mail, origin connecteur, class sensitive: two-step confirmation)",
    )
  })

  it("should cite at most two activated connectors then table.rows, never a sensitive or an ERP function (E08-S05, NH6)", () => {
    const active = new Set(["mail", "slack"])
    expect(callExamples(FUNCTIONS, active)).toEqual(["mail.create_draft", "table.rows"])
    expect(callExamples(FUNCTIONS, NONE)).toEqual(["table.rows"])
    expect(callExamples([SEND, ALERT], active)).toEqual([])
  })
})
