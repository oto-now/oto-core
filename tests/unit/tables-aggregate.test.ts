// @vitest-environment node
// `table.aggregate` sur une vraie base (E07-S01, AC17 ; H97, N10) : les douze prospects de la fixture,
// comptés par statut et par ville, sommes et moyenne d'une colonne nombre, refus et bornes. Textes servis
// au modèle comparés mot pour mot (H04). Réécrit sur base réelle par E01-S10 (lot t1-c1a, fiche D76 A) :
// une graine par fichier (`seedTableFixture`), les lignes de chaque cas posées par `fixtureRows`.
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { PlatformError } from "../../packages/plateforme/server/errors"
import type { RowBlock } from "../../packages/plateforme/server/tables/meta"
import { tableAggregate } from "../../packages/plateforme/server/tables/aggregate"
import type { ReferenceOrgSql } from "../helpers/reference-org-sql"
import { sqlConfigured, seedWithAdmin, type SeededData, portable } from "../helpers/sql"
import { manyRows, PROSPECT_ROWS, PROSPECTS, runFunction } from "../factories/table-fixture"
import { seedTableFixture } from "../factories/table-fixture-sql"
import { CASE_TIMEOUT, clientOf, fixtureRows, SEED_TIMEOUT, type FixtureRows } from "../factories/table-rows-sql"

type Aggregate = { text: string; data: { table: string; total: number; group_by?: string; groups: Record<string, unknown>[]; groups_total: number } }

/** `count` lignes de clés `L0001`…, `notes` donné par rang. */
function generated(count: number, notes: (index: number) => string): RowBlock[] {
  return manyRows(count, (index) => ({ entreprise: `L${String(index + 1).padStart(4, "0")}`, notes: notes(index), statut: "à traiter" }))
}

describe.skipIf(!sqlConfigured)(portable("table.aggregate on a real database"), { timeout: CASE_TIMEOUT }, () => {
  let seed: SeededData
  let ref: ReferenceOrgSql
  let fixture: FixtureRows

  beforeAll(async () => {
    seed = seedWithAdmin()
    ref = await seedTableFixture(seed)
    fixture = fixtureRows(seed, ref)
  }, SEED_TIMEOUT)

  afterAll(async () => {
    await seed?.cleanup()
  }, SEED_TIMEOUT)

  async function aggregate(args: Record<string, unknown>, rows: readonly RowBlock[] = PROSPECT_ROWS): Promise<Aggregate> {
    // Aucun cas n'écrit : un jeu de lignes déjà posé sert le cas suivant.
    await fixture.useRows(rows)
    const identity = ref.identityOf("claire")
    const output = await runFunction(tableAggregate, { db: await clientOf(ref, identity), identity }, { table: PROSPECTS.path, ...args })
    // Les données de `table.aggregate` ont la forme de `aggregateRows` (aggregate.ts) : le type commun les efface.
    return output as Aggregate
  }

  async function refusal(args: Record<string, unknown>, rows?: readonly RowBlock[]): Promise<PlatformError> {
    return aggregate(args, rows).then(
      () => {
        throw new Error("expected a refusal")
      },
      (error: PlatformError) => error,
    )
  }

  describe("table.aggregate (AC17)", () => {
    it("should count the rows of each group, largest first, cells without value under empty, and compute number metrics", async () => {
      const byStatut = await aggregate({ group_by: "statut" })
      expect(byStatut.text).toBe(
        [
          "ventes/suivi_prospects: 12 row(s) match; 5 group(s) by statut.",
          '- "à traiter": count 6',
          '- "à revoir": count 2',
          '- "en cours": count 2',
          '- "écarté": count 1',
          '- "qualifié": count 1',
        ].join("\n"),
      )
      expect(byStatut.data).toEqual({
        table: PROSPECTS.path,
        total: 12,
        group_by: "statut",
        groups: [
          { value: "à traiter", count: 6 },
          { value: "à revoir", count: 2 },
          { value: "en cours", count: 2 },
          { value: "écarté", count: 1 },
          { value: "qualifié", count: 1 },
        ],
        groups_total: 5,
      })
      const byVille = await aggregate({ group_by: "ville", metrics: [{ op: "count" }, { op: "sum", column: "montant_estime" }] })
      expect(byVille.data.groups.map((group) => group.value ?? group)).toEqual([
        "Valbrune",
        "Brémontier",
        "Coudray",
        "Saint-Arlan",
        "Haute-Lise",
        "Port-Lise",
        { empty: true, count: 1, sum_montant_estime: 5000 },
      ])
      // Un montant rangé en texte (« 12000 ») ne s'additionne pas.
      expect(byVille.text.split("\n").slice(3, 4).concat(byVille.text.split("\n").at(-1) ?? "")).toEqual(['- "Coudray": count 2, sum_montant_estime 0', "- (no value): count 1, sum_montant_estime 5000"])
      // Une valeur citée en JSON : un saut de ligne écrit dans une cellule ne fabrique pas de fausse ligne de groupe.
      const forged = { ...PROSPECT_ROWS[0], data: { entreprise: PROSPECT_ROWS[0].key, ville: "Valbrune\n- Coudray: count 50", statut: "à traiter" } }
      const byForged = await aggregate({ group_by: "ville" }, [forged, ...PROSPECT_ROWS.slice(1)])
      expect(byForged.text.split("\n").filter((line) => line.startsWith("- "))).toHaveLength(byForged.data.groups_total)
      const metrics = ["sum", "avg", "min", "max"].map((op) => ({ op, column: "montant_estime" }))
      const totals = await aggregate({ where: { statut: { in: ["à revoir", "qualifié"] } }, metrics: [{ op: "count" }, ...metrics] })
      expect(totals.text).toBe(
        "ventes/suivi_prospects: 3 row(s) match.\n- all rows: count 3, sum_montant_estime 77000, avg_montant_estime 25666.67, min_montant_estime 10000, max_montant_estime 45000",
      )
      expect(totals.data).toEqual({
        table: PROSPECTS.path,
        total: 3,
        groups: [{ count: 3, sum_montant_estime: 77000, avg_montant_estime: 25666.67, min_montant_estime: 10000, max_montant_estime: 45000 }],
        groups_total: 1,
      })
    })

    it("should refuse like the filter of table.rows and a metric on a text column, and bound the groups", async () => {
      expect(await refusal({ where: { ville: { in: [] } } })).toMatchObject({ code: "invalid_arguments", message: "in needs at least one value (an empty list would match nothing): ville." })
      expect(await refusal({ group_by: "couleur" })).toMatchObject({ code: "invalid_arguments", message: expect.stringMatching(/^Unknown column\(s\): couleur\. Columns: entreprise, /) })
      expect(await refusal({ metrics: [{ op: "sum", column: "ville" }] })).toMatchObject({ code: "invalid_arguments", message: "sum applies to number columns; ville is text." })
      expect(await refusal({ group_by: "entreprise" }, generated(1_001, () => "même note"))).toMatchObject({
        code: "too_large",
        message: "More than 1,000 groups: narrow where, or group by another column.",
      })
      // Deux cents notes différentes de 150 caractères, dont une trois fois : servies par effectif, puis coupées.
      const cut = await aggregate({ group_by: "notes" }, generated(200, (index) => (index < 3 ? "commune" : `${String(index).padStart(3, "0")}${"n".repeat(147)}`)))
      const served = cut.data.groups.length
      expect(cut.data.groups[0]).toEqual({ value: "commune", count: 3 })
      expect(served).toBeLessThan(198)
      expect(JSON.stringify(cut.data.groups).length).toBeLessThanOrEqual(16_000)
      expect(cut.data.groups_total).toBe(198)
      expect(cut.text.split("\n").at(-1)).toBe(`Showing the ${served} largest groups of 198; narrow where to see the others.`)
    })
  })
})
