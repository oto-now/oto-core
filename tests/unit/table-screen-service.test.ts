// @vitest-environment node
// Les lectures de l'écran d'un tableau sur une vraie base (E07-S03 : AC1, AC4 à AC8, AC10 ; H93, H95 à
// H97, H123 ; E01-S10, lot t1-c1b : fixture d'E07-S01 semée par `seedTableFixture`, une graine pour le
// fichier, suite portable) : lignes de la grille, résumé et file de revue, décidés
// par `loadTable` avant toute lecture de ligne ; l'isolation seule y rend toute ligne de
// l'organisation, et l'espion des requêtes (`spyDb`) montre ce qui part. Douze prospects, dont un bail
// actif et une provenance humaine avec preuve ; le tableau remis à son état semé, ou à d'autres lignes,
// par `freshTable`.
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { TableRowRead } from "@otomata_tech/oto_platform/schemas"
import { loadNode } from "../../packages/plateforme/server/nodes/read"
import type { RowBlock } from "../../packages/plateforme/server/tables/meta"
import { tableGridRows, tableGridSummary, tableReviewQueue } from "../../packages/plateforme/server/tables/screen"
import type { ReferenceOrgSql } from "../helpers/reference-org-sql"
import { spyDb, type DbCall } from "../helpers/spy-tables"
import { seedWithAdmin, type SeededData, sqlConfigured, portable } from "../helpers/sql"
import { manyRows, PROSPECT_ROWS, PROSPECTS, TICKETS } from "../factories/table-fixture"
import { seedTableFixture } from "../factories/table-fixture-sql"
import { acmeIdentity, freshTable } from "../factories/table-publish-sql"

const NETWORK_TIMEOUT = 60_000
const SETUP_TIMEOUT = 180_000
/** Un tableau de 5 001 lignes semé, puis lu par le service. */
const LARGE_TIMEOUT = 120_000

const VALBRUNE = { ville: { contains: "valbrune" } }

const rowReads = (calls: readonly DbCall[]) => calls.filter((one) => one.kind === "table" && one.table === "blocks")
const keys = (rows: readonly TableRowRead[]) => rows.map((row) => row.key)

function refusal(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (reason: unknown) => reason,
  )
}

/** Les prospects, des lignes retouchées par clé : `data` fusionné, bail retiré au besoin. */
function prospects(changes: Record<string, Partial<RowBlock> & { data?: Record<string, unknown> }>): RowBlock[] {
  return PROSPECT_ROWS.map((row) => {
    const change = changes[row.key]
    // `data` d'une ligne de la fixture est un objet JSON, typé `unknown` par `RowBlock`.
    return change ? { ...row, ...change, data: { ...(row.data as object), ...change.data } } : row
  })
}

describe.skipIf(!sqlConfigured)(portable("the screen of a table"), { timeout: NETWORK_TIMEOUT }, () => {
  let seed: SeededData
  let ref: ReferenceOrgSql

  beforeAll(async () => {
    seed = seedWithAdmin()
    ref = await seedTableFixture(seed)
  }, SETUP_TIMEOUT)

  afterAll(async () => {
    await seed?.cleanup()
  }, SETUP_TIMEOUT)

  const lea = () => acmeIdentity(ref, "lea")

  describe("tableGridRows (AC4 à AC7)", () => {
    it("should serve the rows of the filter, sorted by the declared type, the first ones only, with their provenance and the counts", async () => {
      await freshTable(seed, ref)
      const db = await ref.db("lea")
      const lu = await tableGridRows(db, lea(), { table: PROSPECTS.path, filter: VALBRUNE, sort: { column: "montant_estime", direction: "desc" }, limit: 2 })
      expect([keys(lu.rows), lu.total, lu.count]).toEqual([["École de Valbrune", "Boulangerie Fournier"], 3, 12])
      expect(lu.rows[0].provenance?.montant_estime).toEqual({
        origin: "human",
        by: "Claire Morel",
        at: "2026-09-01T08:00:00.000Z",
        comment: "Devis signé en mairie",
        link: "https://valbrune.test/deliberation-12",
      })
      // Le texte libre, sans casse ni accent : clé, texte, email (AC5).
      const cherche = await tableGridRows(db, lea(), { table: PROSPECTS.path, q: "ÉCOLE", limit: 20 })
      expect([keys(cherche.rows), cherche.total]).toEqual([["École de Valbrune"], 1])
      // Par mots, comme `table.rows` : dans n'importe quel ordre et des cellules différentes ; un `q` sans mot est ignoré (E11-S01, AC-c2, AC-c3).
      const mots = await tableGridRows(db, lea(), { table: PROSPECTS.path, q: "valbrune NINA", limit: 20 })
      expect([keys(mots.rows), mots.total]).toEqual([["Atelier 2"], 1])
      expect((await tableGridRows(db, lea(), { table: PROSPECTS.path, q: "--", limit: 20 })).total).toBe(12)
      // Sans tri, l'ordre naturel des clés (« Atelier 2 » avant « Atelier 10 ») ; un bail actif est servi (AC2).
      const tout = await tableGridRows(db, lea(), { table: PROSPECTS.path, limit: 20 })
      expect(keys(tout.rows).slice(0, 2)).toEqual(["Atelier 2", "Atelier 10"])
      expect(tout.rows[1].claim).toMatchObject({ worker: "claude-claire", by: "Claire Morel" })
    })

    it("should refuse an unknown column or a limit beyond 200, and read no row of a table of level 0 that the base returns", async () => {
      await freshTable(seed, ref)
      const { db, calls } = spyDb(await ref.db("lea"))
      expect(await refusal(tableGridRows(db, lea(), { table: PROSPECTS.path, filter: { couleur: "bleu" }, limit: 20 }))).toMatchObject({ code: "invalid_arguments" })
      expect(await refusal(tableGridRows(db, lea(), { table: PROSPECTS.path, limit: 201 }))).toMatchObject({ code: "invalid_arguments" })
      expect(rowReads(calls)).toEqual([])
      const marc = spyDb(await ref.db("marc"))
      expect(await refusal(tableGridRows(marc.db, acmeIdentity(ref, "marc"), { table: PROSPECTS.path, limit: 20 }))).toMatchObject({ code: "not_found" })
      expect(await refusal(tableGridSummary(marc.db, acmeIdentity(ref, "marc"), { table: PROSPECTS.path }))).toMatchObject({ code: "not_found" })
      expect(await refusal(tableReviewQueue(marc.db, acmeIdentity(ref, "marc"), { table: PROSPECTS.path }))).toMatchObject({ code: "not_found" })
      expect(rowReads(marc.calls)).toEqual([])
      // Un lecteur (niveau 1) lit la grille.
      await freshTable(seed, ref, { rules: [{ node: PROSPECTS.path, user: "paul", level: "read" }] })
      expect((await tableGridRows(await ref.db("paul"), acmeIdentity(ref, "paul"), { table: PROSPECTS.path, limit: 20 })).count).toBe(12)
    })

    it(
      "should serve the first rows in database key order beyond 5,000 rows, and refuse a filter there",
      async () => {
        await freshTable(seed, ref, { rows: manyRows(5_001) })
        const db = await ref.db("lea")
        const lu = await tableGridRows(db, lea(), { table: PROSPECTS.path, limit: 3 })
        expect([keys(lu.rows), lu.total]).toEqual([["Prospect 0000", "Prospect 0001", "Prospect 0002"], 5_001])
        expect(await refusal(tableGridRows(db, lea(), { table: PROSPECTS.path, q: "prospect", limit: 20 }))).toMatchObject({ code: "too_large" })
      },
      LARGE_TIMEOUT,
    )
  })

  describe("tableGridSummary (AC8)", () => {
    it("should count each declared state, zeros included, and sum the number columns under the same filter and search", async () => {
      await freshTable(seed, ref)
      const db = await ref.db("lea")
      expect(await tableGridSummary(db, lea(), { table: PROSPECTS.path, filter: VALBRUNE })).toEqual({
        states: [
          { state: "à traiter", count: 2 },
          { state: "en cours", count: 0 },
          { state: "à revoir", count: 1 },
          { state: "qualifié", count: 0 },
          { state: "écarté", count: 0 },
        ],
        sums: [{ column: "montant_estime", total: 21_000 }],
      })
      const cherche = await tableGridSummary(db, lea(), { table: PROSPECTS.path, filter: VALBRUNE, q: "atelier" })
      expect([cherche.states?.reduce((lignes, etat) => lignes + etat.count, 0), cherche.sums]).toEqual([1, [{ column: "montant_estime", total: 2_000 }]])
      expect(await tableGridSummary(await ref.db("paul"), acmeIdentity(ref, "paul"), { table: TICKETS.path })).toEqual({ states: null, sums: [{ column: "numero", total: 19 }] })
    })
  })

  describe("tableReviewQueue (AC10)", () => {
    it("should count the rows to review and serve them in the natural order of the keys, not the database order, with their provenance (M54)", async () => {
      // « Atelier 10 » précède « Atelier 2 » dans l'ordre des caractères de la base, pas dans l'ordre des clés.
      await freshTable(seed, ref, { rows: prospects({ "Atelier 10": { claimed_by: null, claimed_by_user: null, lease_until: null, data: { statut: "à revoir" } }, "Atelier 2": { data: { statut: "à revoir" } } }) })
      const file = await tableReviewQueue(await ref.db("lea"), lea(), { table: PROSPECTS.path })
      const [first] = file.rows
      expect([file.count, file.rows.map((row) => row.key), first?.revision]).toEqual([4, ["Atelier 2", "Atelier 10", "Clinique des Saules", "École de Valbrune"], 1])
      // La preuve de chaque valeur se lit sur la fiche (P3) : la provenance est servie, noms des personnes compris.
      expect(first?.provenance?.contact).toMatchObject({ origin: "import", by: "Ada Martin" })
      expect(await refusal(tableReviewQueue(await ref.db("paul"), acmeIdentity(ref, "paul"), { table: TICKETS.path }))).toMatchObject({ code: "invalid_arguments" })
    })
  })

  describe("loadNode of a table (AC1)", () => {
    it("should count the rows of a table for the meta, and read none", async () => {
      await freshTable(seed, ref)
      const { db, calls } = spyDb(await ref.db("lea"))
      const vue = await loadNode(db, lea(), { path: PROSPECTS.path })
      expect([vue.kind, vue.rowsTotal, vue.blocks]).toEqual(["table", 12, []])
      expect(rowReads(calls).every((one) => one.kind === "table" && "count" in one)).toBe(true)
      expect((await loadNode(db, lea(), { path: "conseil/grille_tarifaire" })).rowsTotal).toBeUndefined()
    })
  })
})
