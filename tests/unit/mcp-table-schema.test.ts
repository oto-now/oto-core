// @vitest-environment node
// Le schéma d'un tableau par le MCP (E07-S04, AC13, AC14) : `InMemoryTransport` (`connectDeps`), sur la
// fixture d'E07-S01 semée sur une vraie base (E01-S10, lot t1-c1b : `seedTableFixture`, une graine pour
// le fichier ; suite portable), garde `ctx` comprise (un code semé dans `ctx`),
// `publish_node` de la base. Ce qu'on vérifie est ce que le modèle lit : le contrat `write.table`, puis
// une création, un ajout et un retrait en deux temps, le même texte dans les deux canaux et la cible du
// journal. Textes comparés mot pour mot (H04).
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { writeNodeSchema } from "../../packages/plateforme/schemas"
import { tableColumnSchema, tableHeaderPatchSchema } from "../../packages/plateforme/schemas/tables"
import { connectDeps } from "../helpers/mcp"
import { ORG, PEOPLE } from "../helpers/reference-org"
import type { ReferenceOrgSql } from "../helpers/reference-org-sql"
import { seedWithAdmin, type SeededData, sqlConfigured, portable } from "../helpers/sql"
import { seedTableFixture } from "../factories/table-fixture-sql"
import { acmeIdentity, draftsAt, nodeAt } from "../factories/table-publish-sql"

const NETWORK_TIMEOUT = 60_000
const SETUP_TIMEOUT = 180_000

const CTX = "ABCD-1234"

describe.skipIf(!sqlConfigured)(portable("the header of a table through MCP"), { timeout: NETWORK_TIMEOUT }, () => {
  let seed: SeededData
  let ref: ReferenceOrgSql

  beforeAll(async () => {
    seed = seedWithAdmin()
    ref = await seedTableFixture(seed)
    await ref.write({ ctx: [{ code: CTX, user_id: PEOPLE.claire.id, org_id: ORG.id, rules_version: 1, host: null }] })
  }, SETUP_TIMEOUT)

  afterAll(async () => {
    await seed?.cleanup()
  }, SETUP_TIMEOUT)

  /** Une session MCP de Claire (responsable de Ventes) sur la fixture, avec son code `ctx` semé. */
  async function session() {
    const identity = acmeIdentity(ref, "claire")
    const connected = await connectDeps({ db: await ref.db("claire"), org: identity.org, caller: { kind: "member", identity }, userAgent: "unit-test", journal: [], activeConnectors: () => Promise.resolve(new Set<string>()), origin: "https://acme.test" })
    return { ...connected, write: (args: Record<string, unknown>) => connected.call("write", { ctx: ref.id(CTX), ...args }) }
  }

  describe("write.table contract (AC13)", () => {
    it("should serve the contract of a table's header through read: schema, rules, examples that write, refusals", async () => {
      const claire = await session()
      const read = await claire.call("read", { ctx: ref.id(CTX), path: "write.table" })
      const lines = read.text.split("\n")
      expect(read.isError).toBe(false)
      expect(lines[0]).toBe("Contract write.table: the header of acme_write for a table (not a function; nothing to call).")
      expect(read.text.length).toBeLessThan(45_000)
      expect(read.result.structuredContent).toMatchObject({ text: read.text, next_actions: ["acme_write"], contract: "write.table" })
      const at = (line: string) => lines.indexOf(line)
      const [schema, rules, examples, refusals] = [at("Header (JSON Schema):"), at("Rules:"), at("Examples:"), at("Possible refusals:")]
      expect(1 < schema && schema < rules && rules < examples && examples < refusals).toBe(true)
      const { $schema, ...json } = JSON.parse(lines[schema + 1])
      expect([$schema, Object.keys(json.properties)]).toEqual([undefined, ["columns", "remove_columns", "key", "lifecycle", "closed", "proof", "confirm_remove"]])
      // E11-S01 : `required` dit ce qu'il exige (AC-b1), `proof` s'écrit par l'en-tête (AC-f5), la règle 1 nomme `allow_verified_empty` (AC-b6).
      expect(json.properties.columns.items.properties.required.description).toBe(
        "true: a row cannot lack this column: a value, or verified_empty with a reason, e.g. true (default: unchanged; false for a new column).",
      )
      expect(tableColumnSchema.shape.required.description).toBe("true: a row cannot lack this column: a value, or verified_empty with a reason (default false).")
      expect(json.properties.lifecycle.properties.review.properties.agents_may_decide.description).toBe(
        "true: an assistant may also set approve or reject, with table.write or table.release; its decision is traced with origin agent (default false).",
      )
      expect(json.properties.proof.description).toBe(
        "true: every new value written by table.write needs its proof, {value, comment | link}, e.g. true (default: unchanged; false for a new table).",
      )
      expect(read.text).toContain(
        "the work queue of the rows (lifecycle), whether new rows can be created (closed) and whether each new value needs its proof (proof). Create it",
      )
      expect(lines.slice(rules + 1, examples)).toEqual(
        expect.arrayContaining([
          "1. columns are merged by name: an existing column receives the attributes given (type, options, required, allow_verified_empty, max_length) and keeps the others; a new column needs its type and is added at the end; the order of the existing columns never changes.",
          "3. key, lifecycle, closed and proof replace their value; lifecycle is replaced whole, and the options of its state column change in the same header as its states.",
        ]),
      )
      expect(lines.slice(rules + 1, examples).filter((line) => /renamed|type of a column|key changes/.test(line))).toHaveLength(3)
      // Trois exemples : créer, ajouter une colonne, retirer en deux temps ; chacun est une entrée valide de `write`.
      const writes = lines.slice(examples + 1, refusals).filter((line) => line.startsWith("acme_write ")).map((line) => JSON.parse(line.slice("acme_write ".length)))
      expect(writes.map((input) => [writeNodeSchema.safeParse(input).success, tableHeaderPatchSchema.safeParse(input.header).success])).toEqual(Array(4).fill([true, true]))
      expect(lines.slice(refusals + 1)).toHaveLength(7)
    })
  })

  describe("a table end to end through MCP (AC14)", () => {
    it("should create, add a column, then remove one that holds values in two steps, with the same text in both channels", async () => {
      const claire = await session()
      const created = await claire.write({
        path: "ventes/salons",
        kind: "table",
        title: "Salons professionnels",
        summary: "Les salons où l'équipe Ventes expose ou prospecte.",
        header: { columns: [{ name: "nom", type: "text", required: true }, { name: "ville", type: "text" }], key: "nom" },
        publish: true,
      })
      expect([created.isError, created.text]).toEqual([false, "Published ventes/salons revision 1: a table with 2 columns, key nom. Write rows with acme_call table.write. Next write: base_revision 1.\nSpace: team Ventes (lead: Claire Morel): its members see it."])
      expect(created.result.structuredContent).toMatchObject({ text: created.text, path: "ventes/salons", revision: 1 })

      const added = await claire.write({ path: "ventes/salons", base_revision: 1, header: { columns: [{ name: "stand", type: "text" }] }, publish: true })
      expect([added.isError, added.text]).toEqual([false, "Published ventes/salons revision 2: added stand. Next write: base_revision 2."])
      expect(added.result.structuredContent).toMatchObject({ text: added.text })

      // Deux salons écrits entre-temps (E07-S02 les écrirait par `table.write`), qui ont une ville.
      const salons = await nodeAt(seed, ref, "ventes/salons")
      await ref.write({ blocks: ["Batimat", "Pollutec"].map((nom) => ({ id: `row:${nom}`, org_id: ORG.id, node_id: salons?.id, state: "published", type: "row", key: nom, data: { nom, ville: "Paris" } })) })
      const asked = await claire.write({ path: "ventes/salons", base_revision: 2, header: { remove_columns: ["ville"] }, publish: true })
      expect(asked.isError).toBe(true)
      // Rien n'est écrit : le second appel refait le premier, `confirm_remove` en plus dans l'en-tête (E11-S18, AC-1, AC-2).
      expect(asked.text).toBe(
        'Publication of ventes/salons needs confirmation: removing column « ville » erases its values on 2 rows (sample keys: Batimat, Pollutec). Columns cannot be renamed: to rename one, add the new column, copy the values with acme_call table.write, then remove the old one. Nothing was written. If the user agrees to erase them, call acme_write {"path":"ventes/salons","base_revision":2,"header":{"remove_columns":["ville"],"confirm_remove":true},"publish":true}.',
      )
      expect(await draftsAt(seed, ref, "ventes/salons")).toEqual([])
      const confirmed = await claire.write({ path: "ventes/salons", base_revision: 2, header: { remove_columns: ["ville"], confirm_remove: true }, publish: true })
      expect([confirmed.isError, confirmed.text]).toEqual([false, "Published ventes/salons revision 3: removed ville (2 values erased). Next write: base_revision 3."])
      expect(confirmed.result.structuredContent).toMatchObject({ text: confirmed.text, revision: 3 })

      const writes = claire.journal.filter((entry) => entry.tool === "acme_write")
      expect(writes.map((entry) => [entry.target ?? null, entry.is_error === true])).toEqual([
        ["ventes/salons", false],
        ["ventes/salons", false],
        [null, true],
        ["ventes/salons", false],
      ])
    })
  })
})
