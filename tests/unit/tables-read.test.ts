// @vitest-environment node
// Chargement d'un tableau, contrat, borne de lecture et droits, sur une vraie base (E07-S01, AC4, AC5,
// AC16, AC20 ; H68, H123) : la base rend, sans filtre de niveau (isolation seule, E01-S08), le tableau de
// Ventes et ses lignes, le tableau personnel de Claire, et à Léa un tableau de P ; `loadTable` décide
// avant toute lecture de lignes, l'espion des requêtes le montre (`security-patterns.md § Droits dans le
// service`). Textes servis au modèle comparés mot pour mot (H04). Réécrit sur base réelle par E01-S10
// (lot t1-c1a, fiche D76 A) : une graine par fichier (`seedTableFixture`) ; un cas pose ce qu'il ajoute
// (lignes, règle, tableaux, en-tête) et le retire ensuite ; l'espion `dbSpy` à la place de celui de la
// base simulée.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import type { CatalogFunction, FunctionOutput } from "../../packages/plateforme/server/catalog/define"
import { catalogNames } from "../../packages/plateforme/server/catalog/registry"
import type { Identity } from "../../packages/plateforme/server/identity"
import { tableAggregate } from "../../packages/plateforme/server/tables/aggregate"
import { loadTable, type RowBlock } from "../../packages/plateforme/server/tables/meta"
import { tableRows } from "../../packages/plateforme/server/tables/rows"
import { tableSchema } from "../../packages/plateforme/server/tables/schema"
import { nodeId, TEAMS, teamOf, type RuleSpec } from "../helpers/reference-org"
import type { ReferenceOrgSql } from "../helpers/reference-org-sql"
import type { Tables } from "../helpers/simulated-db"
import { dbSpy, type SpiedCall } from "../helpers/spy-t1-c1a"
import { sqlConfigured, seedWithAdmin, type SeededData, portable } from "../helpers/sql"
import {
  DRAFT_TABLE,
  FOREIGN_TABLE,
  fixtureTables,
  PERSONAL_TABLE,
  PROSPECT_ROWS,
  PROSPECTS,
  PROSPECTS_HEADER,
  runFunction,
  TICKETS,
} from "../factories/table-fixture"
import { seedTableFixture } from "../factories/table-fixture-sql"
import { BIG_TABLE_TIMEOUT, CASE_TIMEOUT, clientOf, fixtureRows, SEED_TIMEOUT, type FixtureRows } from "../factories/table-rows-sql"

// Le catalogue que `table.schema` lit à l'appel, simulé ici entier (le registre n'est pas chargé) :
// vide, puis, dans un test, les fonctions d'écriture et de file d'E07-S02. Le vrai catalogue est
// vérifié par `catalog.test.ts` (AC19).
vi.mock("../../packages/plateforme/server/catalog/registry", () => ({ catalogNames: vi.fn(() => new Set<string>()) }))

afterEach(() => {
  vi.restoreAllMocks()
})

/** Les requêtes sur `blocks` : le comptage (`count`) et les lectures de lignes. */
const blockCalls = (calls: SpiedCall[]) => calls.filter((call) => call.tables.includes("blocks"))

/** Les clés des lignes que sert `table.rows`. */
function rowKeys(output: FunctionOutput): unknown[] {
  const rows = output.data?.rows
  return Array.isArray(rows) ? rows.map((row) => row.key) : []
}

describe.skipIf(!sqlConfigured)(portable("tables read on a real database"), { timeout: CASE_TIMEOUT }, () => {
  let seed: SeededData
  let ref: ReferenceOrgSql
  let fixture: FixtureRows
  let prefix: string
  /** Marc, membre de Support sans règle sur le tableau de Ventes (AC4, AC20). */
  let MARC_SUPPORT: Identity
  let UNKNOWN_FOR_MARC: string

  beforeAll(async () => {
    seed = seedWithAdmin()
    ref = await seedTableFixture(seed)
    fixture = fixtureRows(seed, ref)
    prefix = ref.org.prefix
    MARC_SUPPORT = ref.identityOf("marc", { teams: [teamOf("support", "marc")] })
    // Marc est membre de Support en base aussi : la lecture des lignes exige en base le niveau que le service décide
    // (`20261021130000`), et une règle de Support ne lui ouvre le tableau que s'il est de l'équipe.
    await seed.admin`insert into platform.team_members (team_id, user_id, role) values (${ref.id(TEAMS.support.id)}, ${ref.people.marc.id}, 'member')`
    UNKNOWN_FOR_MARC = `Unknown table ventes/suivi_prospects. Tables you can read: support/tickets. Use ${prefix}_find with type table for more.`
  }, SEED_TIMEOUT)

  afterAll(async () => {
    await seed?.cleanup()
  }, SEED_TIMEOUT)

  /** Une fonction appelée sur la graine, telle qu'elle est : ce qu'elle rend, et l'espion des requêtes. */
  async function run(fn: CatalogFunction, identity: Identity, args: Record<string, unknown>) {
    const spy = dbSpy()
    return { output: await runFunction(fn, { db: await clientOf(ref, identity, spy), identity }, args), calls: spy.calls }
  }

  /** Le refus d'une fonction appelée sur la graine (`null` si elle répond), et l'espion des requêtes. */
  async function refusal(fn: CatalogFunction, identity: Identity, args: Record<string, unknown>) {
    const spy = dbSpy()
    const error = await runFunction(fn, { db: await clientOf(ref, identity, spy), identity }, args).then(
      () => null,
      (reason: unknown) => reason,
    )
    return { error, calls: spy.calls }
  }

  /** Une règle de plus le temps de `body`, retirée ensuite. */
  async function withRule<T>(rule: RuleSpec, body: () => Promise<T>): Promise<T> {
    const [ruleId] = await ref.addRules([rule])
    try {
      return await body()
    } finally {
      await seed.admin`delete from platform.access_rules where id = ${ruleId}`
    }
  }

  describe("loadTable (AC4)", () => {
    it("should load a readable table with its published header and the level of its reader", async () => {
      const identity = ref.identityOf("claire")
      const loaded = await loadTable({ db: await clientOf(ref, identity), identity }, PROSPECTS.path)
      expect([loaded.node.path, loaded.header, loaded.level, loaded.movedFrom]).toEqual([PROSPECTS.path, PROSPECTS_HEADER, 3, null])
    })

    it("should refuse a path of another kind, a table never published and a published header that is invalid", async () => {
      const identity = ref.identityOf("claire")
      const claire = { db: await clientOf(ref, identity), identity }
      for (const [path, kind] of [
        ["conseil/grille_tarifaire", "a page"],
        ["ventes/qualifier_prospects", "a procedure"],
        ["ventes/contexte", "a Contexte"],
      ]) {
        await expect(loadTable(claire, path), path).rejects.toMatchObject({ code: "invalid_arguments", message: `${path} is ${kind}, not a table. Read it with ${prefix}_read.` })
      }
      await expect(loadTable(claire, DRAFT_TABLE)).rejects.toMatchObject({
        code: "conflict",
        message: `Table ventes/brouillon has no published header yet: its owner publishes it with ${prefix}_write.`,
      })
      const table = ref.nodeId(PROSPECTS.path)
      const logged = vi.spyOn(console, "error").mockImplementation(() => undefined)
      await seed.admin`update platform.nodes set meta = ${seed.admin.json({ columns: [], key: "entreprise" })} where id = ${table}`
      try {
        await expect(loadTable(claire, PROSPECTS.path)).rejects.toMatchObject({ code: "internal", message: "Internal error." })
      } finally {
        await seed.admin`update platform.nodes set meta = ${seed.admin.json(PROSPECTS_HEADER)} where id = ${table}`
      }
      expect(logged).toHaveBeenCalledWith(expect.stringContaining("invalid published header of ventes/suivi_prospects"), expect.stringContaining("columns:"))
    })
  })

  describe("table.schema (AC5)", () => {
    it("should serve the contract of a table, naming write, claim and release only when they are in the catalog", async () => {
      const lea = ref.identityOf("lea")
      const { output } = await run(tableSchema, lea, { table: PROSPECTS.path })
      expect(output).toMatchObject({
        text: [
          "Table ventes/suivi_prospects: Suivi des prospects. Les prospects de l'équipe Ventes et la file des fiches à qualifier.",
          `Owner: team Ventes (lead: Claire Morel). Your access: write. Rows: 12. Revision: 3 (the base_revision of ${prefix}_write to change the header).`,
          "Key: entreprise — each row is addressed by its entreprise value; a new value creates a row.",
          "Columns:",
          "- entreprise: text, required, 200 characters at most (key)",
          "- contact: text",
          "- email: email",
          "- ville: text",
          "- montant_estime: number",
          "- dernier_contact: date (YYYY-MM-DD)",
          "- relance_le: datetime (with a time zone, e.g. 2026-09-24T14:30:00Z)",
          "- actif: bool (true or false)",
          "- notes: text",
          "- statut: enum (à traiter | en cours | à revoir | qualifié | écarté), required",
          "Work queue on statut: rows enter « à traiter »; « en cours » marks a row a worker holds under a lease.",
          "Review: rows « à revoir » wait for a person, who approves them (« qualifié ») or rejects them (« écarté »).",
          "Closed: no — a new key creates a row.",
          "Proof: required — every new value needs {value, comment | link}; a new value without it refuses the whole call.",
          `Example: ${prefix}_call {"function": "table.rows", "arguments": {"table":"ventes/suivi_prospects","filter":{"statut":"à traiter"},"columns":["contact","email","ville"]}}`,
        ].join("\n"),
        data: {
          table: PROSPECTS.path,
          title: PROSPECTS.title,
          key: "entreprise",
          columns: PROSPECTS_HEADER.columns,
          lifecycle: PROSPECTS_HEADER.lifecycle,
          closed: false,
          proof: true,
          rows_count: 12,
          revision: 3,
          your_level: "write",
        },
      })
      // Les fonctions d'écriture et de file d'E07-S02 au catalogue : le contrat les nomme.
      vi.mocked(catalogNames).mockReturnValueOnce(new Set(["table.write", "table.claim", "table.release"]))
      const shown = await run(tableSchema, lea, { table: PROSPECTS.path })
      expect(shown.output.text.split("\n").filter((line) => /table\.(write|claim|release)/.test(line))).toEqual([
        "table.claim takes rows « à traiter » (or whose lease expired) and sets them « en cours » with a lease.",
        "table.release frees a row you claimed and sets its next state.",
        "Write with table.write: rows [{key, revision?, set: {column: {value, comment | link}}, clear: [column], verified_empty: [{column, reason}]}]; a bare value equal to the stored one is ignored; any new value needs its proof (comment or link), except the state column statut, set bare within its allowed changes; null is refused; unnamed columns stay unchanged.",
      ])
    })
  })

  describe("5,000 rows (AC16)", () => {
    /** 5 001 lignes : les douze prospects, puis des clés `Z0001`… rangées après eux. */
    function big(): Tables {
      const extra: RowBlock[] = Array.from({ length: 4_989 }, (_, index) => {
        const key = `Z${String(index + 1).padStart(4, "0")}`
        return { key, data: { entreprise: key, statut: "à traiter" }, provenance: {}, revision: 1, claimed_by: null, claimed_by_user: null, lease_until: null }
      })
      return fixtureTables([], [...PROSPECT_ROWS, ...extra])
    }

    it("should refuse filters, q, sort and aggregates without reading the rows, and page in the database key order without them", { timeout: BIG_TABLE_TIMEOUT }, async () => {
      await fixture.use(big())
      try {
        const claire = ref.identityOf("claire")
        const message = "Table ventes/suivi_prospects has 5,001 rows: filters, q, sort and aggregates work on tables of 5,000 rows at most in this version. Read it page by page without them."
        for (const [fn, args] of [
          [tableRows, { filter: { ville: "Valbrune" } }],
          [tableRows, { q: "valbrune" }],
          [tableRows, { sort: { column: "montant_estime" } }],
          [tableAggregate, { group_by: "statut" }],
        ] as const) {
          const { error, calls } = await refusal(fn, claire, { table: PROSPECTS.path, ...args })
          expect(error, JSON.stringify(args)).toMatchObject({ code: "too_large", message })
          expect(blockCalls(calls).map((read) => read.count)).toEqual([true])
        }
        const page = await run(tableRows, claire, { table: PROSPECTS.path })
        expect(page.output.text.split("\n")[0]).toBe("ventes/suivi_prospects: 5,001 row(s); rows 1-20 in database key order (more than 5,000 rows).")
        // L'ordre de la base sur `key` (sa collation), pas l'ordre naturel : « Atelier 10 » avant « Atelier 2 ».
        expect(rowKeys(page.output).slice(0, 3)).toEqual(["Atelier 10", "Atelier 2", "Boulangerie Fournier"])
        expect(blockCalls(page.calls)).toHaveLength(2)
        // La 21e clé dans l'ordre de la collation de la base (sur le projet, « École » y vient entre
        // « Clinique » et « Ferme », non après « Z… » comme dans l'ordre des caractères).
        const [twentyFirst] = await seed.admin<{ key: string }[]>`
          select key from platform.blocks where node_id = ${ref.nodeId(PROSPECTS.path)} and state = 'published' and type = 'row' order by key offset 20 limit 1`
        const next = await run(tableRows, claire, { table: PROSPECTS.path, cursor: page.output.data?.next_cursor })
        expect([next.output.text.split("\n")[0], rowKeys(next.output)[0]]).toEqual(["ventes/suivi_prospects: 5,001 row(s); rows 21-40 in database key order (more than 5,000 rows).", twentyFirst.key])
      } finally {
        await fixture.use()
      }
    })
  })

  describe("rights and isolation in the service (AC20)", () => {
    it("should decide the level before reading any row: none unknown, listing at most 20 readable tables, a rule opens, personal and foreign tables stay unknown", async () => {
      for (const fn of [tableSchema, tableRows, tableAggregate]) {
        const { error, calls } = await refusal(fn, MARC_SUPPORT, { table: PROSPECTS.path })
        expect(error, fn.name).toMatchObject({ code: "not_found", message: UNKNOWN_FOR_MARC })
        expect(blockCalls(calls), fn.name).toEqual([])
      }
      // Le niveau 0 se dit comme un chemin inconnu (AC4) : au plus vingt tableaux lisibles nommés. Vingt-cinq tableaux de
      // Support, lisibles par Marc, après `private/claire/notes`, qu'il ne lit pas : la borne suit le filtre.
      const tables: Tables = { nodes: [] }
      const tickets = fixtureTables().nodes.find((node) => node.id === nodeId(TICKETS.path))
      for (let rank = 1; rank <= 25; rank++) {
        const path = `support/t${String(rank).padStart(2, "0")}`
        tables.nodes.push({ ...structuredClone(tickets), id: nodeId(path), path })
      }
      const listed = Array.from({ length: 20 }, (_, index) => `support/t${String(index + 1).padStart(2, "0")}`).join(", ")
      const spy = dbSpy()
      await ref.write(tables)
      try {
        await expect(loadTable({ db: await clientOf(ref, MARC_SUPPORT, spy), identity: MARC_SUPPORT }, PROSPECTS.path)).rejects.toMatchObject({
          code: "not_found",
          message: `Unknown table ventes/suivi_prospects. Tables you can read: ${listed}. Use ${prefix}_find with type table for more.`,
        })
      } finally {
        await seed.admin`delete from platform.nodes where id in ${seed.admin(tables.nodes.map((node) => ref.id(String(node.id))))}`
      }
      expect(blockCalls(spy.calls)).toEqual([])
      const alone = { db: await clientOf(ref, MARC_SUPPORT), identity: MARC_SUPPORT }
      await expect(loadTable(alone, "ventes/inexistant")).rejects.toMatchObject({
        code: "not_found",
        message: `Unknown table ventes/inexistant. Tables you can read: support/tickets. Use ${prefix}_find with type table for more.`,
      })
      const marc = ref.identityOf("marc")
      await expect(loadTable({ db: await clientOf(ref, marc), identity: marc }, PROSPECTS.path)).rejects.toMatchObject({
        code: "not_found",
        message: "Unknown table ventes/suivi_prospects. You cannot read any table here.",
      })
      const rule: RuleSpec = { node: PROSPECTS.path, team: "support", level: "read" }
      await withRule(rule, async () => {
        const opened = await run(tableSchema, MARC_SUPPORT, { table: PROSPECTS.path })
        expect(opened.output.text.split("\n")[1]).toBe(`Owner: team Ventes (lead: Claire Morel). Your access: read. Rows: 12. Revision: 3 (the base_revision of ${prefix}_write to change the header).`)
        const read = await run(tableRows, MARC_SUPPORT, { table: PROSPECTS.path, limit: 1 })
        expect(read.output.data).toMatchObject({ total: 12 })
      })
      // Espace personnel de Claire, administratrice comprise (H61, H66) ; tableau de P lu depuis l'adresse de O,
      // que la base rend à Léa, membre des deux.
      for (const [who, path] of [
        [ref.identityOf("ada"), PERSONAL_TABLE],
        [ref.identityOf("lea"), FOREIGN_TABLE.path],
      ] as const) {
        const { error, calls } = await refusal(tableRows, who, { table: path })
        expect(error, path).toMatchObject({ code: "not_found", message: expect.stringMatching(new RegExp(`^Unknown table ${path}\\. `)) })
        expect(blockCalls(calls), path).toEqual([])
      }
    })
  })
})
