// @vitest-environment node
// Publication d'un en-tête sur les lignes déjà là (E07-S04, AC6 à AC10) : avertissements sans
// réécriture, type et clé d'un tableau rempli, retrait en deux temps et purge gardée par la révision,
// bornes de 2 000 lignes purgées et de 5 000 lignes lues, valeurs restées sous le nom d'une colonne
// ajoutée. `write` de Claire (gestion) sur la fixture d'E07-S01 semée sur une vraie base (E01-S10, lot
// t1-c1b : `seedTableFixture`, une graine pour le fichier ; suite portable), le
// tableau remis à son état semé avant chaque publication (`freshTable`) ; requêtes vues, courses et
// pannes jouées par `spyDb` ; textes servis au modèle comparés mot pour mot (H04).
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import type { WriteOrigin } from "../../packages/plateforme/server/nodes/write"
import type { RowBlock } from "../../packages/plateforme/server/tables/meta"
import { nodeId } from "../helpers/reference-org"
import type { ReferenceOrgSql } from "../helpers/reference-org-sql"
import type { Row } from "../helpers/simulated-db"
import type { DbCall } from "../helpers/spy-tables"
import { seedWithAdmin, type SeededData, sqlConfigured, portable } from "../helpers/sql"
import { PROSPECT_ROWS, PROSPECTS, PROSPECTS_HEADER, rowBlocks, STATES } from "../factories/table-fixture"
import { seedTableFixture } from "../factories/table-fixture-sql"
import { draftsAt, freshTable, nodeAt, publishCalls, tableRows, writeAs, writesOf } from "../factories/table-publish-sql"

const NETWORK_TIMEOUT = 60_000
const SETUP_TIMEOUT = 180_000
/** Cinq tableaux de 2 441 à 5 002 lignes semés, puis lus par pages par le service. */
const BOUNDS_TIMEOUT = 240_000

afterEach(() => {
  vi.restoreAllMocks()
})

/** Les requêtes sur `blocks` : comptage (`count`), lectures et écritures de lignes. */
const blockCalls = (calls: readonly DbCall[]) => calls.filter((call) => call.kind === "table" && call.table === "blocks")

/** La purge d'une ligne : la mise à jour de `blocks` qui la vise par sa clé. */
const purgeOf = (key: string) => (call: DbCall) => call.kind === "table" && call.table === "blocks" && call.op === "update" && call.values.includes(key)

/** Un objet JSON d'une ligne (`data`, `provenance`), typé `unknown` par `Row`. */
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : {}
}

const rowOf = (rows: readonly Row[], key: string) => rows.find((row) => row.key === key)

/** Les prospects sans aucune valeur ni provenance sous `column`. */
function without(column: string): RowBlock[] {
  const kept = (value: unknown) => Object.fromEntries(Object.entries(record(value)).filter(([name]) => name !== column))
  return PROSPECT_ROWS.map((row) => ({ ...row, data: kept(row.data), provenance: kept(row.provenance) }))
}

/** Une ligne de clé `key` à l'état d'entrée, qui porte `notes` ou non. */
function extraRow(key: string, notes: boolean): RowBlock {
  return { key, data: { entreprise: key, statut: "à traiter", ...(notes ? { notes: "x" } : {}) }, provenance: {}, revision: 1, claimed_by: null, claimed_by_user: null, lease_until: null }
}

/** Les prospects et `count` lignes de plus, clés `Z0001`…, qui portent toutes `notes` (ou aucune). */
function withRows(count: number, notes = true): RowBlock[] {
  return [...PROSPECT_ROWS, ...Array.from({ length: count }, (_, index) => extraRow(`Z${String(index + 1).padStart(4, "0")}`, notes))]
}

/** L'en-tête en attente qui retire `notes`, publié par `confirm_remove`. */
const WITHOUT_NOTES = { ...PROSPECTS_HEADER, columns: PROSPECTS_HEADER.columns.filter((column) => column.name !== "notes") }
const CONFIRM = { path: PROSPECTS.path, base_revision: 3, header: { confirm_remove: true }, publish: true }
/** L'écran : une publication en deux temps, sa purge dans sa propre transaction (E11-S18, AC-3). */
const SCREEN: WriteOrigin = { kind: "human" }

describe.skipIf(!sqlConfigured)(portable("the header of a table published over its rows"), { timeout: NETWORK_TIMEOUT }, () => {
  let seed: SeededData
  let ref: ReferenceOrgSql

  beforeAll(async () => {
    seed = seedWithAdmin()
    ref = await seedTableFixture(seed)
  }, SETUP_TIMEOUT)

  afterAll(async () => {
    await seed?.cleanup()
  }, SETUP_TIMEOUT)

  /** Publication directe de Claire sur la révision 3 du tableau remis à son état semé (`rows` : d'autres lignes). */
  async function publish(header: Record<string, unknown>, rows?: readonly RowBlock[]) {
    await freshTable(seed, ref, { rows })
    return writeAs(ref, "claire", { path: PROSPECTS.path, base_revision: 3, header, publish: true })
  }

  /** La ligne `key` du tableau, telle que la base la garde. */
  const liveRow = async (key: string) => rowOf(await tableRows(seed, ref), key)

  describe("warnings, never a rewrite (AC6)", () => {
    it("should publish, rewrite no row, and warn about required values missing, removed options, values too long and rows under lease", async () => {
      await freshTable(seed, ref)
      const before = await tableRows(seed, ref)
      const states = STATES.filter((state) => state !== "écarté")
      const lifecycle = { column: "statut", states, working: "à revoir", review: { state: "en cours", approve: "qualifié", reject: "à traiter" } }
      const header = {
        columns: [{ name: "telephone", type: "text", required: true }, { name: "contact", required: true }, { name: "statut", options: states }, { name: "notes", max_length: 10 }],
        lifecycle,
      }
      const claire = await writeAs(ref, "claire", { path: PROSPECTS.path, base_revision: 3, header, publish: true })
      expect(claire.result?.text).toBe(
        [
          "Published ventes/suivi_prospects revision 4: added telephone; changed contact (required); changed notes (max_length); changed statut (options); lifecycle replaced. Next write: base_revision 4.",
          "Warnings:",
          "- 12 rows have no value for required column telephone (sample keys: Atelier 2, Atelier 10, Boulangerie Fournier, Brasserie de la Lise, Camping Les Pins).",
          "- 1 row has no value for required column contact (sample key: Garage des Tilleuls).",
          "- 1 row holds « écarté », no longer an option of statut (sample key: Mairie de Coudray).",
          "- 2 rows hold a value longer than 10 characters in notes (sample keys: Clinique des Saules, École de Valbrune).",
          "- 1 row is in « en cours » under lease; it keeps it until released.",
        ].join("\n"),
      )
      expect(claire.result?.data?.warnings).toEqual([
        { kind: "missing_required", column: "telephone", count: 12, sample_keys: ["Atelier 2", "Atelier 10", "Boulangerie Fournier", "Brasserie de la Lise", "Camping Les Pins"] },
        { kind: "missing_required", column: "contact", count: 1, sample_keys: ["Garage des Tilleuls"] },
        { kind: "outside_options", column: "statut", count: 1, sample_keys: ["Mairie de Coudray"] },
        { kind: "too_long", column: "notes", count: 2, sample_keys: ["Clinique des Saules", "École de Valbrune"] },
        { kind: "working_rows", column: "statut", count: 1, sample_keys: ["Atelier 10"] },
      ])
      expect(await tableRows(seed, ref)).toEqual(before)
      expect(writesOf(claire.calls).filter((call) => call.kind === "table" && call.table === "blocks")).toEqual([])
      // Une valeur `verified_empty` compte comme renseignée pour `required` : Boulangerie Fournier n'a pas d'email.
      const email = await publish({ columns: [{ name: "email", required: true }] })
      expect(email.result?.text).toBe(
        "Published ventes/suivi_prospects revision 4: changed email (required). Next write: base_revision 4.\nWarnings:\n- 4 rows have no value for required column email (sample keys: Brasserie de la Lise, Ferme du Coudray, Mairie de Coudray, Scierie Vallon).",
      )
    })
  })

  describe("type of a column that holds values (AC7)", () => {
    it("should refuse the type change of a column that holds values, nothing written, and change it on a column without value", async () => {
      const ville = await publish({ columns: [{ name: "ville", type: "enum", options: ["Valbrune", "Coudray"] }] })
      expect(ville.error).toMatchObject({
        code: "conflict",
        // E11-S02 (AC-d5) : la raison que l'écran lit pour sa phrase d'aide (AC-g1).
        details: { reason: "header_refused" },
        // Une écriture d'assistant qui publie n'écrit rien sur un refus (E11-S18, AC-1).
        message:
          "Publication of ventes/suivi_prospects refused: column « ville » holds values on 11 rows (sample keys: Atelier 2, Atelier 10, Boulangerie Fournier, Brasserie de la Lise, Camping Les Pins); its type cannot change from text to enum. Add a new column of type enum, copy the values with acme_call table.write, then remove « ville ». Nothing was written.",
      })
      expect(publishCalls(ville.calls)).toEqual([])
      expect(await draftsAt(seed, ref, PROSPECTS.path)).toEqual([])
      // La colonne clé « a des valeurs » dès que le tableau a des lignes.
      const key = await publish({ columns: [{ name: "entreprise", type: "email" }] })
      expect(key.error).toMatchObject({ code: "conflict", message: expect.stringContaining("column « entreprise » holds values on 12 rows (") })

      const empty = await publish({ columns: [{ name: "notes", type: "enum", options: ["chaud", "froid"] }] }, without("notes"))
      expect(empty.result?.text).toBe("Published ventes/suivi_prospects revision 4: changed notes (type, options). Next write: base_revision 4.")
    })
  })

  describe("removing a column that holds values, in two steps (AC8)", () => {
    it("should ask for confirmation without publishing, then publish and purge each row that held the column", async () => {
      const asked = await publish({ remove_columns: ["notes"] })
      expect(asked.error).toMatchObject({
        code: "needs_confirmation",
        // E11-S02 (AC-d5) : la raison que l'écran lit pour sa phrase d'aide (AC-g1).
        details: { reason: "header_refused" },
        // Rien n'est écrit : l'appel à refaire porte tout l'en-tête et `confirm_remove` (E11-S18, AC-1, AC-2).
        message:
          'Publication of ventes/suivi_prospects needs confirmation: removing column « notes » erases its values on 2 rows (sample keys: Clinique des Saules, École de Valbrune). Columns cannot be renamed: to rename one, add the new column, copy the values with acme_call table.write, then remove the old one. Nothing was written. If the user agrees to erase them, call acme_write {"path":"ventes/suivi_prospects","base_revision":3,"header":{"remove_columns":["notes"],"confirm_remove":true},"publish":true}.',
      })
      expect(publishCalls(asked.calls)).toEqual([])
      expect(await draftsAt(seed, ref, PROSPECTS.path)).toEqual([])

      const before = await tableRows(seed, ref)
      const confirmed = await writeAs(ref, "claire", { ...CONFIRM, header: { remove_columns: ["notes"], confirm_remove: true } })
      expect(confirmed.result?.text).toBe("Published ventes/suivi_prospects revision 4: removed notes (2 values erased). Next write: base_revision 4.")
      const after = await tableRows(seed, ref)
      const purged = ["Clinique des Saules", "École de Valbrune"]
      for (const key of purged) {
        const was: Row = rowOf(before, key) ?? {}
        const row = rowOf(after, key)
        expect(row?.data).toEqual(Object.fromEntries(Object.entries(record(was.data)).filter(([column]) => column !== "notes")))
        expect(Object.keys(record(row?.provenance))).not.toContain("notes")
        expect([row?.revision, row?.updated_by]).toEqual([Number(was.revision) + 1, "user-claire"])
      }
      expect(after.filter((row) => !purged.includes(String(row.key)))).toEqual(before.filter((row) => !purged.includes(String(row.key))))

      const silent = await publish({ remove_columns: ["notes"] }, without("notes"))
      expect(silent.result?.text).toBe("Published ventes/suivi_prospects revision 4: removed notes. Next write: base_revision 4.")
    })
  })

  describe("safe purge, bounded reads (AC9)", () => {
    it("should read again and purge again a row changed during the purge, and say the rows it could not purge", async () => {
      // Une écriture d'E07-S02 change « Clinique des Saules » juste avant la mise à jour de la purge (les `times` premières).
      let raced = 0
      const race = (times: number) => async (call: DbCall) => {
        if (!purgeOf("Clinique des Saules")(call) || raced >= times) return
        raced += 1
        await seed.admin`update platform.blocks set revision = revision + 1
                          where node_id = ${ref.nodeId(PROSPECTS.path)} and state = 'published' and key = 'Clinique des Saules'`
      }
      // Par l'écran : la purge d'après la publication tient sa transaction ; celle d'un assistant est dans son écriture (E11-S18).
      await freshTable(seed, ref, { draft: { meta: WITHOUT_NOTES } })
      const once = await writeAs(ref, "claire", CONFIRM, { meanwhile: race(1), origin: SCREEN })
      expect(once.result?.text).toBe("Published ventes/suivi_prospects revision 4: removed notes (2 values erased). Next write: base_revision 4.")
      const clinique = await liveRow("Clinique des Saules")
      expect(clinique).toMatchObject({ revision: 3 })
      expect(Object.keys(record(clinique?.data))).not.toContain("notes")

      raced = 0
      const logged = vi.spyOn(console, "error").mockImplementation(() => undefined)
      await freshTable(seed, ref, { draft: { meta: WITHOUT_NOTES } })
      const always = await writeAs(ref, "claire", CONFIRM, { meanwhile: race(9), origin: SCREEN })
      expect(always.result?.text).toBe(
        "Published ventes/suivi_prospects revision 4: removed notes (1 value erased). Next write: base_revision 4.\nWarnings:\n- 1 row still holds a value under removed column notes (changed while purging; sample key: Clinique des Saules); it is purged if a column notes is added again.",
      )
      expect(logged).toHaveBeenCalledWith(`[platform] tables: purge of ${ref.nodeId(PROSPECTS.path)}: a row changed 3 times, no row written`)

      // Une panne de la base pendant la purge, la publication faite : une ligne non écrite, puis la relecture des lignes en panne.
      await freshTable(seed, ref, { draft: { meta: WITHOUT_NOTES } })
      const unwritten = await writeAs(ref, "claire", CONFIRM, { fail: (call) => (purgeOf("Clinique des Saules")(call) ? { code: "57014" } : null), origin: SCREEN })
      expect(unwritten.result?.text).toBe(
        "Published ventes/suivi_prospects revision 4: removed notes (1 value erased). Next write: base_revision 4.\nWarnings:\n- 1 row still holds a value under removed column notes (could not be written; sample key: Clinique des Saules); it is purged if a column notes is added again.",
      )
      expect(logged).toHaveBeenCalledWith(`[platform] tables: purge of ${ref.nodeId(PROSPECTS.path)}`, "57014")
      let published = false
      const afterPublication = (call: DbCall) => {
        published ||= call.kind === "rpc" && call.name === "publish_node"
        return published && call.kind === "table" && call.table === "blocks" && call.op === "select" ? { code: "57014" } : null
      }
      await freshTable(seed, ref, { draft: { meta: WITHOUT_NOTES } })
      const unread = await writeAs(ref, "claire", CONFIRM, { fail: afterPublication, origin: SCREEN })
      expect(unread.result?.text).toBe(
        "Published ventes/suivi_prospects revision 4: removed notes. Next write: base_revision 4.\nWarnings:\n- 2 rows still hold values under removed column notes (could not be written; sample keys: Clinique des Saules, École de Valbrune); they are purged if a column notes is added again.",
      )
      expect((await nodeAt(seed, ref, PROSPECTS.path))?.revision).toBe(4)
    })

    it(
      "should refuse more than 2,000 rows to purge and a table of more than 5,000 rows, read no row to close or widen, and purge rows written past 5,000 meanwhile",
      async () => {
        const many = await publish({ remove_columns: ["notes"] }, withRows(2_429))
        expect(many.error).toMatchObject({
          code: "too_large",
          // E11-S02 (AC-d5) : la raison que l'écran lit pour sa phrase d'aide (AC-g1).
          details: { reason: "header_refused" },
          message:
            "Publication of ventes/suivi_prospects refused: removing « notes » would erase values on 2,431 rows; 2,000 at most per publication: clear them in batches with acme_call table.write, then remove the column. Nothing was written.",
        })
        expect(publishCalls(many.calls)).toEqual([])

        const huge = await publish({ columns: [{ name: "secteur", type: "text" }] }, withRows(4_989))
        expect(huge.error).toMatchObject({
          code: "too_large",
          // E11-S02 (AC-d5) : la raison que l'écran lit pour sa phrase d'aide (AC-g1).
          details: { reason: "header_refused" },
          message:
            "Publication of ventes/suivi_prospects refused: the table has 5,001 rows; header changes that check its rows work on tables of 5,000 rows at most in this version. Nothing was written.",
        })
        expect(blockCalls(huge.calls).map((call) => "count" in call)).toEqual([true])

        for (const header of [{ closed: true }, { columns: [{ name: "entreprise", max_length: 500 }, { name: "statut", required: false }] }]) {
          const widened = await publish(header, withRows(4_989))
          expect(widened.error, JSON.stringify(header)).toBeNull()
          expect(blockCalls(widened.calls), JSON.stringify(header)).toEqual([])
        }

        // 5 000 lignes aux contrôles ; deux autres écrites avant `publish_node`, sous `notes` encore déclarée : la purge lit toutes les pages.
        await freshTable(seed, ref, { rows: withRows(4_988, false), draft: { meta: WITHOUT_NOTES } })
        const table = nodeId(PROSPECTS.path)
        const late = rowBlocks(table, [extraRow("Zz1", true), extraRow("Zz2", true)]).map((row) => ({ ...row, id: `${table}:row:${String(row.key)}` }))
        const lateWrite = async (call: DbCall) => {
          if (call.kind === "rpc" && call.name === "publish_node") await ref.write({ blocks: late })
        }
        const grown = await writeAs(ref, "claire", CONFIRM, { meanwhile: lateWrite })
        expect(grown.result?.text).toBe("Published ventes/suivi_prospects revision 4: removed notes (4 values erased). Next write: base_revision 4.")
        expect((await tableRows(seed, ref)).filter((row) => Object.hasOwn(record(row.data), "notes"))).toEqual([])
      },
      BOUNDS_TIMEOUT,
    )

    it("should purge the values left under a removed column before a column of that name is published again, or not publish it", async () => {
      // « fax » reste sous une ligne après une purge interrompue (fixture : Mairie de Coudray).
      const claire = await publish({ columns: [{ name: "fax", type: "text" }] })
      expect(claire.result?.text).toBe("Published ventes/suivi_prospects revision 4: added fax (purged 1 stale value left under « fax »). Next write: base_revision 4.")
      expect(Object.keys(record((await liveRow("Mairie de Coudray"))?.data))).not.toContain("fax")
      const purge = claire.calls.findIndex((call) => call.kind === "table" && call.table === "blocks" && call.op === "update")
      expect(purge).toBeGreaterThan(-1)
      expect(purge).toBeLessThan(claire.calls.findIndex((call) => call.kind === "rpc" && call.name === "publish_node"))

      // La ligne change avant chaque essai de la purge : sa valeur reparaîtrait sous « fax » publiée, rien n'est publié.
      const logged = vi.spyOn(console, "error").mockImplementation(() => undefined)
      const busy = async (call: DbCall) => {
        if (call.kind !== "table" || call.table !== "blocks" || call.op !== "update") return
        await seed.admin`update platform.blocks set revision = revision + 1
                          where node_id = ${ref.nodeId(PROSPECTS.path)} and state = 'published' and key = 'Mairie de Coudray'`
      }
      const input = { path: PROSPECTS.path, base_revision: 3, header: { columns: [{ name: "fax", type: "text" }] }, publish: true }
      await freshTable(seed, ref)
      const refused = await writeAs(ref, "claire", input, { meanwhile: busy })
      expect(refused.error).toMatchObject({
        code: "conflict",
        message:
          "Publication of ventes/suivi_prospects refused: the old values left under « fax » could not be erased on 1 row (sample key: Mairie de Coudray); an added column never shows old values. Nothing was written. Retry the publication.",
      })
      expect(publishCalls(refused.calls)).toEqual([])
      expect(record((await liveRow("Mairie de Coudray"))?.data)).toHaveProperty("fax")
      expect(logged).toHaveBeenCalledWith(`[platform] tables: purge of ${ref.nodeId(PROSPECTS.path)}: a row changed 3 times, no row written`)

      // Une panne de la base pendant cette purge n'est pas une course : un jeton refusé reste `unauthorized`, une autre panne est `internal`.
      const failing = (code: string) => (call: DbCall) => (call.kind === "table" && call.table === "blocks" && call.op === "update" ? { code } : null)
      await freshTable(seed, ref)
      const expired = await writeAs(ref, "claire", input, { fail: failing("PGRST301") })
      await freshTable(seed, ref)
      const down = await writeAs(ref, "claire", input, { fail: failing("57014") })
      expect([expired.error, down.error]).toMatchObject([{ code: "unauthorized" }, { code: "internal" }])
      expect([...publishCalls(expired.calls), ...publishCalls(down.calls)]).toEqual([])
      expect(logged).toHaveBeenCalledWith("[platform] tables: purge", "57014")
    })
  })

  describe("key (AC10)", () => {
    it("should change the key of a table without rows, and refuse it while the table has rows", async () => {
      const empty = await publish({ key: "email" }, [])
      expect(empty.result?.text).toBe("Published ventes/suivi_prospects revision 4: key set to email. Next write: base_revision 4.")
      expect((await nodeAt(seed, ref, PROSPECTS.path))?.meta).toMatchObject({ key: "email" })

      const full = await publish({ key: "email" })
      expect(full.error).toMatchObject({
        code: "conflict",
        // E11-S02 (AC-d5) : la raison que l'écran lit pour sa phrase d'aide (AC-g1).
        details: { reason: "header_refused" },
        message:
          "Publication of ventes/suivi_prospects refused: its key cannot change from « entreprise » to « email » while it has rows (12). Create a new table keyed by email and copy the rows (acme_call table.rows, then table.write). Nothing was written.",
      })
      expect(publishCalls(full.calls)).toEqual([])
    })
  })

  // La preuve par tableau (AC-f1) : `tables-schema-write.test.ts` (« settings of the screen »).
  describe("E11-S01: strict required column", () => {
    it("should warn, rewriting no row, about the rows that only have verified_empty in a required column made strict (AC-b5)", async () => {
      await publish({ columns: [{ name: "email", required: true }] })
      const before = await tableRows(seed, ref)
      const strict = await writeAs(ref, "claire", { path: PROSPECTS.path, base_revision: 4, header: { columns: [{ name: "email", allow_verified_empty: false }] }, publish: true })
      expect(strict.result?.text).toBe(
        "Published ventes/suivi_prospects revision 5: changed email (allow_verified_empty). Next write: base_revision 5.\nWarnings:\n- 1 row has no value for required column email (sample key: Boulangerie Fournier).",
      )
      expect(strict.result?.data?.warnings).toEqual([{ kind: "missing_required", column: "email", count: 1, sample_keys: ["Boulangerie Fournier"] }])
      expect(await tableRows(seed, ref)).toEqual(before)
    })

  })
})
