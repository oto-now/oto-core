// @vitest-environment node
// `find` (E03-S02 : AC10 à AC16) sur la base réelle (E01-S10, lot t1-e2b2) : Acme semée sur O (`seedAcme`,
// `tests/integration/fixtures/acme-sql.ts`) avec les quatre pages « zorglub » d'AC12, et `find` sous le
// client d'Ada (`ref.db`). `search_content` est servie par le test (`watchDb`,
// `tests/helpers/spy-t1-e2b2.ts`) : elle rend les lignes écrites ici à la forme du « Contrat » d'E01-S06 § 4, que
// la vraie fonction rendrait sur ces données, les nœuds sous leur identifiant réel ; ce qu'elle trouve et
// son classement (brouillons, racine, langue, rang) sont prouvés par ses propres tests (E01-S06 AC22 à
// AC25, M06 : `tests/integration/search-content.test.ts`). Les niveaux, `context` et `ctx` lisent la base.
// AC16 passe par le MCP (`connectDeps`), sur le catalogue réel.
import * as z from "zod/v4"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { connectDeps } from "../helpers/mcp"
import { ORG } from "../helpers/reference-org"
import type { ReferenceOrgSql } from "../helpers/reference-org-sql"
import type { Row } from "../helpers/simulated-db"
import { watchDb, type DbCall } from "../helpers/spy-t1-e2b2"
import { sqlConfigured, seedWithAdmin, type SeededData, portable } from "../helpers/sql"
import { acmeNode, acmeSearchRow, NO_CATALOG, simulatedBlockId } from "../integration/fixtures/acme"
import { seedAcme } from "../integration/fixtures/acme-sql"
import { MAX_RESULT_CHARS } from "../../packages/plateforme/mcp/result"
import { defineFunction, type CatalogFunction } from "../../packages/plateforme/server/catalog/define"
import { find, type FindType } from "../../packages/plateforme/server/find"

const NETWORK_TIMEOUT = 60_000
const SETUP_TIMEOUT = 180_000

const GRILLE = "conseil/grille_tarifaire_2026"
const TABLE = "ventes/suivi_prospects"
/** Les consignes de `find`, au préfixe de l'organisation (jetable sur la base réelle). */
const readLine = (prefix: string) => `Read one with ${prefix}_read {"path": "<path>"}; a procedure's steps are in its sections.`
const rowsLine = (prefix: string) => `At most 3 rows per table are shown: for every matching row, run ${prefix}_call table.rows with a filter or q.`

afterEach(() => {
  vi.restoreAllMocks()
})

/** Les quatre pages de test de Ventes d'AC12 (titre, résumé), à côté d'Acme. */
const ZORGLUB: Record<string, { title: string; summary: string }> = {
  "ventes/a_titre": { title: "Le zorglub", summary: "Une page dont le titre porte le mot." },
  "ventes/b_resume": { title: "Page B", summary: "Le zorglub est dans le résumé." },
  "ventes/c_bloc": { title: "Page C", summary: "Une page dont les blocs portent le mot." },
  "ventes/d_bloc": { title: "Page D", summary: "Une autre page dont un bloc porte le mot." },
}

/** Une ligne d'une page « zorglub » ; son nœud est celui de son chemin (`searchDb`). */
function zorglubRow(path: string, fields: Partial<Row>): Row {
  return { ...acmeSearchRow(GRILLE), path, kind: "page", ...ZORGLUB[path], ...fields }
}

/** Un bloc trouvé (`snippet`, `rank`, et la clé et la colonne d'une ligne) ; `index` fait son id, donc sa référence courte. */
const inBlock = (index: number, type: string, fields: Partial<Row>): Partial<Row> => ({
  match: "block",
  block_id: simulatedBlockId(index),
  block_type: type,
  ...fields,
})

const searchCalls = (calls: DbCall[]) => calls.filter((call) => call.kind === "rpc" && call.name === "search_content")

const ok = async () => ({ text: "ok" })

function fn(name: string, fields: { class?: CatalogFunction["class"]; origin?: CatalogFunction["origin"]; description: string }): CatalogFunction {
  return defineFunction({
    name,
    connector: name.split(".")[0],
    class: fields.class ?? "read",
    origin: fields.origin ?? "paquet",
    description: fields.description,
    schema: z.strictObject({}),
    examples: [],
    refusals: [],
    run: ok,
  })
}

/** Le catalogue de test d'AC15 : `table.*`, `probe.payload` (ERP) et une fonction d'un connecteur inactif. */
const CATALOG = {
  functions: [
    fn("table.rows", { description: "Reads the rows of a table, 20 at a time, with a filter and a sort." }),
    fn("table.schema", { description: "Reads the header of a table: its columns, key and states. Use it before writing." }),
    fn("table.aggregate", { description: "Counts or sums the rows of a table by a column." }),
    fn("table.write", { class: "write", description: "Writes rows of a table by key." }),
    fn("table.claim", { class: "write", description: "Reserves rows of a table's work queue for a worker." }),
    fn("table.release", { class: "write", description: "Releases reserved rows of a table, with their new state." }),
    fn("probe.payload", { origin: "erp", description: "Echoes a payload to test the chain of calls" }),
    fn("sellsy.list_estimates", { origin: "connecteur", description: "Lists the estimates sent from Sellsy." }),
  ],
  activeConnectors: new Set<string>(),
}

describe.skipIf(!sqlConfigured)(portable("find on the real database, Acme on O"), { timeout: NETWORK_TIMEOUT }, () => {
  let seed: SeededData
  let ref: ReferenceOrgSql

  beforeAll(async () => {
    seed = seedWithAdmin()
    ref = await seedAcme(seed)
    await ref.addNodes(Object.entries(ZORGLUB).map(([path, { title, summary }]) => ({ path, title, summary })))
  }, SETUP_TIMEOUT)

  afterAll(async () => {
    await seed?.cleanup()
  }, SETUP_TIMEOUT)

  /** Le client d'Ada, dont `search_content` rend `rows[p_query]` quel que soit le genre, chaque nœud sous son identifiant réel. */
  async function searchDb(rows: Record<string, Row[]> = {}) {
    const real = (row: Row): Row => ({ ...row, node_id: ref.nodeId(String(row.path)) })
    return watchDb(await ref.db("ada"), { rpc: { search_content: (args) => (rows[String(args.p_query)] ?? []).map(real) } })
  }

  describe("find: nodes, places and snippets (AC10)", () => {
    it("should give each node one line with its snippet, then one line per block found, on one line", async () => {
      // L'extrait que rend `search_content`, un saut de ligne en plus : le fragment de `ts_headline`, qui ne finit
      // jamais sur un nombre (N31), est prolongé jusqu'à la fin du bloc quand il n'en reste que huit mots au
      // plus (fiche D43 B, E01-S13 AC-b10) ; AC10 reprend sa lettre d'origine, « 250 € HT » dans l'extrait.
      const paragraph = inBlock(0x3f2a9c1e, "paragraph", {
        snippet: "Pré-étude : 1 500 € HT.\nÉtude complète jusqu'à 10 **participants** : 6 500 € HT. Par **participant** **supplémentaire** : 250 € HT.",
        rank: 0.1,
      })
      const { db } = await searchDb({
        "grille tarifaire": [acmeSearchRow(GRILLE, { snippet: "**Grille** **tarifaire** 2026", rank: 3 })],
        "participant supplémentaire": [acmeSearchRow(GRILLE, paragraph)],
        "pré-étude": [
          acmeSearchRow("conseil/methode_etude", { snippet: "Méthode d'**étude** d'autoconsommation collective", rank: 2.3 }),
          acmeSearchRow(GRILLE, { ...paragraph, snippet: "**Pré**-**étude** : 1 500 € HT. Étude complète jusqu'à 10 participants", rank: 0.2 }),
        ],
      })
      const ada = ref.identityOf("ada")

      const titled = await find(db, ada, { query: "grille tarifaire", type: "page" }, NO_CATALOG)
      expect(titled.text).toBe(
        [
          "Top matches for « grille tarifaire »:",
          "1. conseil/grille_tarifaire_2026 (page, score 1.00): **Grille** **tarifaire** 2026. Tarifs 2026 des études et de l'accompagnement, en euros HT.",
          readLine(ref.org.prefix),
        ].join("\n"),
      )
      const [, node, block] = (await find(db, ada, { query: "participant supplémentaire" }, NO_CATALOG)).text.split("\n")
      expect(node).toBe("1. conseil/grille_tarifaire_2026 (page, score 0.03): Grille tarifaire 2026. Tarifs 2026 des études et de l'accompagnement, en euros HT.")
      expect(block).toBe(
        "   - block 3f2a9c1e (paragraph): Pré-étude : 1 500 € HT. Étude complète jusqu'à 10 **participants** : 6 500 € HT. Par **participant** **supplémentaire** : 250 € HT.",
      )
      const study = (await find(db, ada, { query: "pré-étude" }, NO_CATALOG)).text.split("\n")
      expect(study.slice(1, 4).map((line) => line.split(" (")[0])).toEqual(["1. conseil/methode_etude", "2. conseil/grille_tarifaire_2026", "   - block 3f2a9c1e"])
    })
  })

  describe("find: table rows (AC11)", () => {
    /** Une ligne du tableau trouvée par la colonne `column_name` de `fields`. */
    const row = (index: number, key: string, fields: Partial<Row>) => acmeSearchRow(TABLE, inBlock(index, "row", { block_key: key, ...fields }))

    it("should show the rows of a table with their column, say that rows are capped, and keep the order of the rows", async () => {
      const valbrune = [
        row(1, "P-003", { column_name: "entreprise", snippet: "entreprise: Mairie de **Valbrune**", rank: 0.2 }),
        row(2, "P-001", { column_name: "email", snippet: "email: marion@**valbrune**.test", rank: 0.1 }),
        row(3, "P-009", { column_name: "email", snippet: "email: ines@**valbrune**.test", rank: 0.1 }),
      ]
      const { db, calls } = await searchDb({
        Valbrune: valbrune,
        // Classement de M06 : le tableau couvre les deux termes (titre et lignes), les procédures un seul.
        "prospects à Valbrune": [
          acmeSearchRow(TABLE, { snippet: "Suivi des **prospects**", rank: 2.95 }),
          acmeSearchRow("ventes/qualifier_prospects", { snippet: "Qualifier les **prospects** à traiter", rank: 2.6 }),
          acmeSearchRow("ventes/relance_prospects", { snippet: "Relancer les **prospects** à traiter", rank: 2.55 }),
          row(4, "P-001", { column_name: "ville", snippet: "ville: **Valbrune**", rank: 0.3 }),
          row(5, "P-003", { column_name: "entreprise", snippet: "entreprise: Mairie de **Valbrune**", rank: 0.3 }),
          row(6, "P-009", { column_name: "ville", snippet: "ville: **Valbrune**", rank: 0.2 }),
        ],
      })
      const ada = ref.identityOf("ada")

      const table = await find(db, ada, { query: "Valbrune", type: "table" }, NO_CATALOG)
      expect(table.text).toBe(
        [
          "Top matches for « Valbrune »:",
          `1. ventes/suivi_prospects (table, score 0.07): Suivi des prospects. ${acmeNode(TABLE).summary}`,
          "   - row P-003: entreprise: Mairie de **Valbrune**",
          "   - row P-001: email: marion@**valbrune**.test",
          "   - row P-009: email: ines@**valbrune**.test",
          readLine(ref.org.prefix),
          rowsLine(ref.org.prefix),
        ].join("\n"),
      )
      expect(searchCalls(calls)[0]).toMatchObject({ args: { p_kinds: ["table"] } })
      expect(table.data).toMatchObject({
        matches: [
          {
            path: TABLE,
            kind: "table",
            places: [{ match: "block", block: "P-003", block_type: "row", column: "entreprise", snippet: "entreprise: Mairie de **Valbrune**" }, {}, {}],
          },
        ],
      })

      const both = await find(db, ada, { query: "prospects à Valbrune" }, NO_CATALOG)
      const lines = both.text.split("\n")
      expect(lines.slice(0, 5)).toEqual([
        "Top matches for « prospects à Valbrune »:",
        `1. ventes/suivi_prospects (table, score 0.98): Suivi des **prospects**. ${acmeNode(TABLE).summary}`,
        "   - row P-001: ville: **Valbrune**",
        "   - row P-003: entreprise: Mairie de **Valbrune**",
        "   - row P-009: ville: **Valbrune**",
      ])
      expect(lines.slice(5, 7).map((line) => line.split(": ")[0])).toEqual([
        "2. ventes/qualifier_prospects (procedure, score 0.87)",
        "3. ventes/relance_prospects (procedure, score 0.85)",
      ])
    })
  })

  describe("find: order, three nodes, truncation said (AC12)", () => {
    it("should group the rows into three nodes in the order of their first row, and count the others", async () => {
      const found = [
        zorglubRow("ventes/a_titre", { snippet: "Le **zorglub**", rank: 2.9 }),
        zorglubRow("ventes/b_resume", { match: "summary", snippet: "Le **zorglub** est dans le résumé.", rank: 1.08 }),
        zorglubRow("ventes/c_bloc", inBlock(0xc001, "paragraph", { snippet: "Le **zorglub** est ici dans un bloc.", rank: 0.09, block_total: 5 })),
        zorglubRow("ventes/d_bloc", inBlock(0xd001, "paragraph", { snippet: "Le **zorglub** est ici dans un bloc.", rank: 0.09 })),
        zorglubRow("ventes/c_bloc", inBlock(0xc002, "checklist", { snippet: "Vérifier le **zorglub**", rank: 0.08, block_total: 5 })),
        zorglubRow("ventes/c_bloc", inBlock(0xc003, "callout", { snippet: "Attention au **zorglub**.", rank: 0.07, block_total: 5 })),
      ]
      const { db } = await searchDb({ zorglub: found, "zorglub seul": found.filter((row) => row.path !== "ventes/d_bloc") })
      const ada = ref.identityOf("ada")

      const result = await find(db, ada, { query: "zorglub" }, NO_CATALOG)
      const [{ revision: cRevision }] = await seed.admin<{ revision: number }[]>`select revision from platform.nodes where id = ${ref.nodeId("ventes/c_bloc")}`
      expect(result.text).toBe(
        [
          "Top matches for « zorglub »:",
          "1. ventes/a_titre (page, score 0.97): Le **zorglub**. Une page dont le titre porte le mot.",
          "2. ventes/b_resume (page, score 0.36): Page B. Le **zorglub** est dans le résumé.",
          "3. ventes/c_bloc (page, score 0.03): Page C. Une page dont les blocs portent le mot.",
          "   - block 0000c001 (paragraph): Le **zorglub** est ici dans un bloc.",
          "   - block 0000c002 (checklist): Vérifier le **zorglub**",
          "   - block 0000c003 (callout): Attention au **zorglub**.",
          // `search_content` ne rend que trois blocs par nœud : les autres blocs trouvés sont comptés, jamais tus.
          "   3 of 5 matching blocks shown: read the page for the others, or search more exact words.",
          // E11-S19 (AC-e5) : Ada, administratrice, écrit la page ; ses blocs simulés n'ont pas de section en base.
          `   To edit: ${ref.org.prefix}_write {"path": "ventes/c_bloc", "base_revision": ${cRevision}, "ops": [...]}.`,
          // Le quatrième nœud, en une ligne : l'agent le voit et peut le lire.
          "Other matches:",
          "- ventes/d_bloc (page, score 0.03): Page D. Une autre page dont un bloc porte le mot.",
          readLine(ref.org.prefix),
        ].join("\n"),
      )
      expect(result.data).toMatchObject({
        more_nodes: 1,
        others: [{ path: "ventes/d_bloc", kind: "page", title: "Page D", score: 0.03 }],
        matches: [{}, {}, { path: "ventes/c_bloc", blocks_total: 5 }],
      })
      const whole = await find(db, ada, { query: "zorglub seul" }, NO_CATALOG)
      expect(whole.text).not.toContain("Other matches")
      expect(whole.data).toMatchObject({ more_nodes: 0, others: [] })
    })
  })

  // E11-S19 (AC-e4, AC-e5) : la section de chaque bloc de page trouvé ; l'appel qui édite la page, pour qui l'écrit seulement.
  describe("find: sections and the edit line (E11-S19)", () => {
    it("should give the section of each page block found, and the write call with the revision to a writer only", async () => {
      const path = "ventes/d_bloc"
      const [before, , inTarifs] = await ref.addBlocks(path, "published", [
        { type: "paragraph", text: "Le zorglub avant tout titre." },
        { type: "heading", text: "Tarifs", data: { level: 1 } },
        { type: "paragraph", text: "Le zorglub coûte trois euros." },
      ])
      const found = [
        zorglubRow(path, { match: "block", block_id: inTarifs, block_type: "paragraph", snippet: "Le **zorglub** coûte trois euros.", rank: 0.09, block_total: 2 }),
        zorglubRow(path, { match: "block", block_id: before, block_type: "paragraph", snippet: "Le **zorglub** avant tout titre.", rank: 0.08, block_total: 2 }),
      ]
      const [{ revision }] = await seed.admin<{ revision: number }[]>`select revision from platform.nodes where id = ${ref.nodeId(path)}`
      const blockLines = [
        `   - block ${inTarifs.slice(0, 8)} (paragraph) in « Tarifs »: Le **zorglub** coûte trois euros.`,
        `   - block ${before.slice(0, 8)} (paragraph): Le **zorglub** avant tout titre.`,
      ]
      const written = await find((await searchDb({ "zorglub tarifs": found })).db, ref.identityOf("ada"), { query: "zorglub tarifs" }, NO_CATALOG)
      expect(written.text.split("\n").slice(2, 5)).toEqual([...blockLines, `   To edit: ${ref.org.prefix}_write {"path": "${path}", "base_revision": ${revision}, "ops": [...]}.`])
      expect(written.data).toMatchObject({
        matches: [{ path, revision, places: [{ block: inTarifs.slice(0, 8), section: "Tarifs" }, { block: before.slice(0, 8), section: null }] }],
      })
      // Les deux blocs trouvés sont montrés : aucune ligne de décompte.
      expect(written.text).not.toContain("matching blocks shown")
      // Marc lit la page sans l'écrire : les sections, sans l'appel qui édite.
      await ref.addRules([{ node: path, user: "marc", level: "read" }])
      const marc = await ref.db("marc")
      const read = await find(watchDb(marc, { rpc: { search_content: () => found.map((row) => ({ ...row, node_id: ref.nodeId(path) })) } }).db, ref.identityOf("marc"), { query: "zorglub tarifs" }, NO_CATALOG)
      expect(read.text.split("\n").slice(2, 5)).toEqual([...blockLines, readLine(ref.org.prefix)])
    })
  })

  describe("find: language (AC13)", () => {
    it("should pass the query as is to search_content, whose normalisation is the rule", async () => {
      const queries = ["pré-étude", "pre etude", "PRÉ-ÉTUDE"]
      const rows = [acmeSearchRow(GRILLE, inBlock(7, "paragraph", { snippet: "**Pré**-**étude** : 1 500 € HT.", rank: 0.2 }))]
      const { db, calls } = await searchDb(Object.fromEntries(queries.map((query) => [query, rows])))
      const ada = ref.identityOf("ada")
      const texts = []
      for (const query of queries) texts.push((await find(db, ada, { query }, NO_CATALOG)).text.split("\n").slice(1).join("\n"))
      expect(searchCalls(calls).map((call) => (call.kind === "rpc" ? call.args.p_query : null))).toEqual(queries)
      expect(new Set(texts).size).toBe(1)
    })
  })

  describe("find: kinds and drafts (AC14)", () => {
    it("should restrict search_content to the kinds asked, a context as a page, never a function with a node kind", async () => {
      const mission = acmeSearchRow("contexte", inBlock(8, "heading", { snippet: "**Mission**", rank: 0.1 }))
      const { db, calls } = await searchDb({ mission: [mission], "table.rows": [] })
      const ada = ref.identityOf("ada")
      const kinds: [FindType | undefined, unknown][] = [
        [undefined, undefined],
        ["procedure", ["procedure"]],
        ["page", ["page", "context"]],
        ["table", ["table"]],
      ]
      for (const [type] of kinds) await find(db, ada, { query: "mission", type }, CATALOG)
      expect(ref.readable(searchCalls(calls).map((call) => (call.kind === "rpc" ? call.args : null)))).toEqual(
        kinds.map(([, p_kinds]) => ({ p_org: ORG.id, p_query: "mission", ...(p_kinds ? { p_kinds } : {}), p_limit: 50 })),
      )
      expect((await find(db, ada, { query: "mission", type: "page" }, CATALOG)).text).toContain("1. contexte (context, score 0.03)")

      const typed = await find(db, ada, { query: "table.rows", type: "procedure" }, CATALOG)
      expect(typed.text).toBe("No match for « table.rows ». Ask the user to rephrase or to say what they are looking for; do not guess.")
      const before = searchCalls(calls).length
      await find(db, ada, { query: "table.rows", type: "function" }, CATALOG)
      expect(searchCalls(calls)).toHaveLength(before)
      expect((await find(db, ada, { query: "zanzibar" }, NO_CATALOG)).text).toBe(
        "No match for « zanzibar ». Ask the user to rephrase or to say what they are looking for; do not guess.",
      )
    })
  })

  describe("find: functions and nothing found (AC15)", () => {
    it("should put an exact function name first, list active functions after the nodes, and say when nothing matches", async () => {
      const schemaCall = acmeSearchRow(
        "ventes/qualifier_prospects",
        inBlock(9, "call", { snippet: '**table.schema** {"table":"ventes/suivi_prospects"}', rank: 0.4 }),
      )
      const { db } = await searchDb({ "table.schema": [schemaCall] })
      const ada = ref.identityOf("ada")
      const { prefix } = ref.org

      const byName = await find(db, ada, { query: "table.rows" }, CATALOG)
      expect(byName.text.split("\n").slice(0, 3)).toEqual([
        "Top matches for « table.rows »:",
        "Functions:",
        "1. table.rows (read, score 1.00): Reads the rows of a table, 20 at a time, with a filter and a sort.",
      ])
      expect((await find(db, ada, { query: "probe.payload" }, CATALOG)).text).toContain("1. probe.payload (read, score 1.00): Echoes a payload to test the chain of calls.")

      const nodesFirst = (await find(db, ada, { query: "table.schema" }, CATALOG)).text.split("\n")
      const [{ revision }] = await seed.admin<{ revision: number }[]>`select revision from platform.nodes where id = ${ref.nodeId("ventes/qualifier_prospects")}`
      expect(nodesFirst.slice(1, 6)).toEqual([
        "1. ventes/qualifier_prospects (procedure, score 0.13): Qualifier les prospects à traiter. " + acmeNode("ventes/qualifier_prospects").summary,
        '   - block 00000009 (call): **table.schema** {"table":"ventes/suivi_prospects"}',
        // E11-S19 (AC-e5) : Ada écrit la procédure.
        `   To edit: ${prefix}_write {"path": "ventes/qualifier_prospects", "base_revision": ${revision}, "ops": [...]}.`,
        readLine(prefix),
        "Functions:",
      ])
      expect(nodesFirst[6]).toBe("1. table.schema (read, score 1.00): Reads the header of a table: its columns, key and states.")
      expect(nodesFirst.filter((line) => /^\d\. table\./.test(line))).toHaveLength(3)
      expect(nodesFirst.at(-1)).toBe(`Read a contract with ${prefix}_read {"path": "<function>"}, then run it with ${prefix}_call.`)

      const typed = await find(db, ada, { query: "table.rows", type: "function" }, CATALOG)
      expect(typed.text.startsWith("Top functions for « table.rows »:\n1. table.rows (read, score 1.00): ")).toBe(true)
      expect(typed.data).toMatchObject({ matches: [], functions: [{ name: "table.rows", class: "read", connector: "table", score: 1 }, {}, {}] })
      expect((await find(db, ada, { query: "sellsy estimates" }, CATALOG)).text).not.toContain("sellsy.list_estimates")

      for (const query of ["zzz qqq www", "les", "de la"]) {
        expect((await find(db, ada, { query }, CATALOG)).text).toBe(
          `No match for « ${query} ». Ask the user to rephrase or to say what they are looking for; do not guess.`,
        )
      }
      expect((await find(db, ada, { query: "zzz", type: "function" }, CATALOG)).text).toBe(
        "No function matches « zzz ». Ask the user what they want to do; do not guess.",
      )
    })
  })

  describe("acme_find through MCP (AC16)", () => {
    it("should guard, serve the data in fields with next_actions, journal the query and go through the single formatter", async () => {
      const query = `grille tarifaire ${"x".repeat(250)}`
      const long = "y".repeat(30_000)
      const { db } = await searchDb({
        [query]: [acmeSearchRow(GRILLE, { snippet: "**Grille** **tarifaire** 2026", rank: 3 })],
        "très long": [acmeSearchRow(GRILLE, { snippet: long }), acmeSearchRow(TABLE, { snippet: long })],
      })
      const ada = ref.identityOf("ada")
      const { prefix } = ref.org
      const session = await connectDeps({ db, org: ada.org, caller: { kind: "member", identity: ada }, userAgent: "unit-test", journal: [], activeConnectors: () => Promise.resolve(new Set<string>()), origin: "https://acme.test" })
      const { code } = await session.openContext()

      const missing = await session.call("find", { query: "grille" })
      expect([missing.isError, missing.text]).toEqual([true, `Missing or unknown ctx. Call ${prefix}_context first and pass its ctx code.`])
      const invalid = await session.call("find", { ctx: code })
      expect(invalid.text.startsWith(`Invalid arguments for ${prefix}_find: query: `)).toBe(true)
      expect(session.journal.at(-1)?.error?.startsWith("invalid_arguments: ")).toBe(true)

      const found = await session.call("find", { ctx: code, query })
      expect(found.isError).toBe(false)
      expect(Object.keys(found.result.structuredContent ?? {}).sort()).toEqual(["functions", "matches", "more_nodes", "next_actions", "others", "text"])
      expect(found.result.structuredContent).toMatchObject({
        text: found.text,
        matches: [{ path: GRILLE, kind: "page", title: "Grille tarifaire 2026", score: 1, places: [{ match: "title", block: null, block_type: null, column: null }] }],
        more_nodes: 0,
        functions: [],
        next_actions: [`${prefix}_read`],
      })
      expect(session.journal.at(-1)?.target).toBe(query.slice(0, 200))

      const none = await session.call("find", { ctx: code, query: "zzz qqq www" })
      expect(none.result.structuredContent).toMatchObject({ matches: [], more_nodes: 0, functions: [], next_actions: [] })

      // Données de plus de 20 000 caractères : le formateur les omet et le dit au log serveur.
      vi.spyOn(console, "error").mockImplementation(() => {})
      const cut = await session.call("find", { ctx: code, query: "très long" })
      expect(JSON.stringify(cut.result.structuredContent).length).toBeLessThanOrEqual(MAX_RESULT_CHARS)
      expect(cut.text).toContain("[Result cut at 45,000 characters.")
    })
  })
})
