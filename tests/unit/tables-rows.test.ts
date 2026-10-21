// @vitest-environment node
// `table.rows` sur une vraie base (E07-S01, AC6, AC7, AC9 à AC15 ; H93, H96) : les douze prospects de la
// fixture, lus par pages dans l'ordre de la base, servis dans l'ordre naturel ; forme de lecture, tri
// typé, `q`, projection, curseur, provenance, bail, coupe des pages. Textes servis au modèle comparés mot
// pour mot (H04). Réécrit sur base réelle par E01-S10 (lot t1-c1a, fiche D76 A) : une graine par fichier
// (`seedTableFixture`), les lignes de chaque cas posées par `fixtureRows`, l'espion des requêtes
// (`dbSpy`) à la place de celui de la base simulée.
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { formatResult } from "../../packages/plateforme/mcp/result"
import { isRecord, tableRowReadSchema } from "../../packages/plateforme/schemas/tables"
import type { ViewKind } from "../../packages/plateforme/schemas/views"
import type { PlatformError } from "../../packages/plateforme/server/errors"
import type { RowBlock } from "../../packages/plateforme/server/tables/meta"
import { tableRows } from "../../packages/plateforme/server/tables/rows"
import { PEOPLE, type Person } from "../helpers/reference-org"
import type { ReferenceOrgSql } from "../helpers/reference-org-sql"
import { dbSpy } from "../helpers/spy-t1-c1a"
import { sqlConfigured, seedWithAdmin, type SeededData, portable } from "../helpers/sql"
import { PROSPECT_ROWS, PROSPECTS, runFunction, TICKETS, WRITTEN_AT } from "../factories/table-fixture"
import { seedTableFixture } from "../factories/table-fixture-sql"
import { CASE_TIMEOUT, clientOf, fixtureRows, SEED_TIMEOUT, type FixtureRows } from "../factories/table-rows-sql"

type ServedRow = { key: string | number; revision: number; set: Record<string, unknown>; verified_empty?: unknown; provenance?: Record<string, unknown>; claim?: unknown }
type Page = { text: string; data: { table: string; total: number; offset: number; rows: ServedRow[]; next_cursor?: string }; view?: ViewKind }

const keys = (page: Page) => page.data.rows.map((row) => row.key)

const NATURAL_ORDER = [
  "Atelier 2",
  "Atelier 10",
  "Boulangerie Fournier",
  "Brasserie de la Lise",
  "Camping Les Pins",
  "Clinique des Saules",
  "École de Valbrune",
  "Ferme du Coudray",
  "Garage des Tilleuls",
  "Mairie de Coudray",
  "Pharmacie du Port",
  "Scierie Vallon",
]

/** `count` lignes de la forme d'un prospect, de clés `L001`…, `notes` de `notes` caractères `char`. */
function generated(count: number, notes = 0, char = "n"): RowBlock[] {
  return Array.from({ length: count }, (_, index) => {
    const key = `L${String(index + 1).padStart(3, "0")}`
    return { key, data: { entreprise: key, statut: "à traiter", ...(notes > 0 ? { notes: char.repeat(notes) } : {}) }, provenance: {}, revision: 1, claimed_by: null, claimed_by_user: null, lease_until: null }
  })
}

/** Un parcours profond : aucun `null` à aucun niveau. */
function nulls(value: unknown, path = "$"): string[] {
  if (value === null) return [path]
  if (Array.isArray(value)) return value.flatMap((item, index) => nulls(item, `${path}[${index}]`))
  if (typeof value === "object") return Object.entries(value).flatMap(([key, item]) => nulls(item, `${path}.${key}`))
  return []
}

describe.skipIf(!sqlConfigured)(portable("table.rows on a real database"), { timeout: CASE_TIMEOUT }, () => {
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

  async function rows(args: Record<string, unknown>, options: { person?: Person; rows?: readonly RowBlock[] } = {}): Promise<Page> {
    // Aucun cas n'écrit : un jeu de lignes déjà posé sert le cas suivant.
    await fixture.useRows(options.rows ?? PROSPECT_ROWS)
    const identity = ref.identityOf(options.person ?? "claire")
    const output = await runFunction(tableRows, { db: await clientOf(ref, identity), identity }, { table: PROSPECTS.path, ...args })
    // Les données de `table.rows` ont la forme de `servedPage` (rows.ts) : le type commun les efface.
    return output as Page
  }

  async function refusal(args: Record<string, unknown>, options: { rows?: readonly RowBlock[] } = {}): Promise<PlatformError> {
    return rows(args, options).then(
      () => {
        throw new Error("expected a refusal")
      },
      (error: PlatformError) => error,
    )
  }

  describe("table.rows", () => {
    it("should serve 20 rows at most in the natural order of the key, one JSON line per row, the empty result in a sentence (AC6)", async () => {
      const page = await rows({})
      expect(keys(page)).toEqual(NATURAL_ORDER)
      const lines = page.text.split("\n")
      expect(lines[0]).toBe("ventes/suivi_prospects: 12 row(s) match; rows 1-12.")
      expect(lines.slice(1).map((line) => JSON.parse(line.replace(/ \(lease expired\)$/, "")))).toEqual(page.data.rows)
      expect(page.data).toMatchObject({ table: PROSPECTS.path, total: 12, offset: 0 })
      expect(page.data).not.toHaveProperty("next_cursor")
      const long = await rows({}, { rows: generated(25) })
      expect([long.data.rows.length, long.data.total, long.text.split("\n")[0]]).toEqual([20, 25, "ventes/suivi_prospects: 25 row(s) match; rows 1-20."])
      const none = await rows({ filter: { ville: "Paris" } })
      expect([none.text, none.data]).toEqual(["ventes/suivi_prospects: 0 row match.", { table: PROSPECTS.path, total: 0, offset: 0, rows: [] }])
    })

    // Story widgets-dans-la-conversation : une ligne seule se lit comme une fiche, plusieurs ou aucune comme un tableau.
    it("should name the widget's view: record for one row, table for several or none", async () => {
      const views = await Promise.all([{}, { filter: { ville: "Paris" } }, { limit: 1 }].map(async (args) => (await rows(args)).view))
      expect(views).toEqual(["table", "table", "record"])
    })

    it("should serve each row in the form of the write, with the declared columns that have a value and never a null (AC7)", async () => {
      const page = await rows({ provenance: true })
      for (const row of page.data.rows) expect(tableRowReadSchema.safeParse(row).success, String(row.key)).toBe(true)
      const byKey = new Map(page.data.rows.map((row) => [row.key, row]))
      expect(byKey.get("Atelier 2")).toMatchObject({ key: "Atelier 2", revision: 1, set: { entreprise: "Atelier 2", ville: "Valbrune", montant_estime: 2000, actif: true } })
      // Contact vidé, email vérifié vide, clé `fax` hors en-tête, `relance_le` nul : absents de `set`.
      expect(Object.keys(byKey.get("Garage des Tilleuls")?.set ?? {})).toEqual(["entreprise", "email", "ville", "montant_estime", "actif", "statut"])
      expect(byKey.get("Boulangerie Fournier")).toMatchObject({ verified_empty: [{ column: "email", reason: "Aucune adresse sur le site ni à l'annuaire" }] })
      expect(byKey.get("Boulangerie Fournier")?.set).not.toHaveProperty("email")
      expect(byKey.get("Mairie de Coudray")?.set).not.toHaveProperty("fax")
      expect(byKey.get("Pharmacie du Port")?.set).not.toHaveProperty("relance_le")
      expect([nulls(page.text.split("\n").slice(1).map((line) => JSON.parse(line.replace(/ \(lease expired\)$/, "")))), nulls(formatResult(page, () => false).structuredContent)]).toEqual([[], []])
      // Une clé de type nombre est servie en nombre, dans `key` et dans `set`.
      const tickets = await rows({ table: TICKETS.path }, { person: "paul" })
      expect(tickets.data.rows.map((row) => [row.key, row.set.numero])).toEqual([
        [7, 7],
        [12, 12],
      ])
    })

    it("should sort by the type of the column, values out of type then empty cells last, ties by key (AC9)", async () => {
      const amounts = ["Atelier 2", "Ferme du Coudray", "Boulangerie Fournier", "École de Valbrune", "Scierie Vallon", "Clinique des Saules", "Camping Les Pins", "Garage des Tilleuls", "Pharmacie du Port", "Atelier 10"]
      expect(keys(await rows({ sort: { column: "montant_estime" } }))).toEqual([...amounts, "Brasserie de la Lise", "Mairie de Coudray"])
      expect(keys(await rows({ sort: { column: "montant_estime", direction: "desc" } }))).toEqual([...amounts].reverse().concat("Brasserie de la Lise", "Mairie de Coudray"))
      expect(keys(await rows({ sort: { column: "dernier_contact" } }))).toEqual([
        "École de Valbrune",
        "Ferme du Coudray",
        "Atelier 2",
        "Camping Les Pins",
        "Atelier 10",
        "Clinique des Saules",
        ...["Boulangerie Fournier", "Brasserie de la Lise", "Garage des Tilleuls", "Mairie de Coudray", "Pharmacie du Port", "Scierie Vallon"],
      ])
      const relances = keys(await rows({ sort: { column: "relance_le" } }))
      expect(relances.slice(0, 3)).toEqual(["Clinique des Saules", "École de Valbrune", "Atelier 2"])
      // Une colonne texte : villes égales départagées par la clé, cellules vides en dernier.
      expect(keys(await rows({ sort: { column: "ville" }, columns: ["ville"] }))).toEqual([
        ...["Atelier 10", "Garage des Tilleuls", "Brasserie de la Lise", "Mairie de Coudray", "Scierie Vallon", "Pharmacie du Port"],
        ...["Camping Les Pins", "Clinique des Saules", "Atelier 2", "Boulangerie Fournier", "École de Valbrune", "Ferme du Coudray"],
      ])
      // Texte naturel, sans casse ni accent, que l'ordre des caractères ne donne pas : « École » entre
      // « Ferme » et « Clinique », « Atelier 10 » avant « Atelier 2 » en ordre décroissant.
      expect(keys(await rows({ sort: { column: "entreprise", direction: "desc" } }))).toEqual([...NATURAL_ORDER].reverse())
      expect(await refusal({ sort: { column: "couleur" } })).toMatchObject({
        code: "invalid_arguments",
        message: "Unknown column(s): couleur. Columns: entreprise, contact, email, ville, montant_estime, dernier_contact, relance_le, actif, notes, statut.",
      })
    })

    it("should keep the rows where q is found without case or accent in the text, email, url and enum columns and the key, 2 to 200 characters (AC10)", async () => {
      const found = async (q: string) => {
        const page = await rows({ q })
        return [keys(page), page.data.total]
      }
      expect(await found("BREMONTIER")).toEqual([["Atelier 10", "Garage des Tilleuls"], 2])
      expect(await found("atelier")).toEqual([["Atelier 2", "Atelier 10"], 2])
      expect(await found("pharmacieduport.test")).toEqual([["Pharmacie du Port"], 1])
      expect(await found("qualifie")).toEqual([["Garage des Tilleuls"], 1])
      // Un nombre n'est pas cherché par `q` : 45000 est un montant.
      expect(await found("45000")).toEqual([[], 0])
      const q = (value: string) => tableRows.schema.safeParse({ table: PROSPECTS.path, q: value }).success
      expect([q("a"), q("ab"), q("x".repeat(200)), q("x".repeat(201))]).toEqual([false, true, true, false])
    })

    it("should limit set, verified_empty and provenance to the columns asked, key and revision kept (AC11)", async () => {
      const page = await rows({ columns: ["contact", "email"], provenance: true })
      const boulangerie = page.data.rows.find((row) => row.key === "Boulangerie Fournier")
      expect(boulangerie).toEqual({
        key: "Boulangerie Fournier",
        revision: 2,
        set: { contact: "Marius Roche" },
        verified_empty: [{ column: "email", reason: "Aucune adresse sur le site ni à l'annuaire" }],
        provenance: {
          contact: { origin: "import", by: "Ada Martin", at: "2026-09-01T08:00:00.000Z" },
          email: { origin: "verified_empty", by: "Léa Roux", at: "2026-09-01T08:00:00.000Z" },
        },
      })
      expect(page.data.rows.every((row) => Object.keys(row.set).every((column) => ["contact", "email"].includes(column)))).toBe(true)
      expect(await refusal({ columns: ["contact", "fax"] })).toMatchObject({ code: "invalid_arguments", message: expect.stringMatching(/^Unknown column\(s\): fax\. Columns: /) })
    })

    it("should page with an opaque cursor bound to the filter, q and sort (AC12)", async () => {
      const first = await rows({ limit: 5 })
      expect([keys(first), first.text.split("\n")[0]]).toEqual([NATURAL_ORDER.slice(0, 5), "ventes/suivi_prospects: 12 row(s) match; rows 1-5."])
      expect(first.text.endsWith(`\nnext_cursor: ${first.data.next_cursor}`)).toBe(true)
      const second = await rows({ limit: 5, cursor: first.data.next_cursor })
      expect([keys(second), second.data.offset, second.text.split("\n")[0]]).toEqual([NATURAL_ORDER.slice(5, 10), 5, "ventes/suivi_prospects: 12 row(s) match; rows 6-10."])
      const last = await rows({ limit: 5, cursor: second.data.next_cursor })
      expect([keys(last), last.data.next_cursor]).toEqual([NATURAL_ORDER.slice(10), undefined])
      for (const other of [{ filter: { ville: "Valbrune" } }, { q: "atelier" }, { sort: { column: "ville" } }]) {
        expect(await refusal({ limit: 5, cursor: first.data.next_cursor, ...other })).toMatchObject({
          code: "invalid_arguments",
          message: "This cursor belongs to another query (filter, q, match or sort changed): start again without cursor.",
        })
      }
      const invalid = { code: "invalid_arguments", message: "Invalid cursor: pass the next_cursor of the previous page unchanged, or omit it." }
      expect(await refusal({ cursor: "abc" })).toMatchObject(invalid)
      // Le vrai curseur, sa dernière clé remplacée par 501 caractères (au-delà d'une clé de `blocks`) :
      // illisible, refusé avant toute requête sur `blocks`, jamais envoyé dans un filtre de la base.
      const payload: unknown = JSON.parse(Buffer.from(String(first.data.next_cursor), "base64url").toString("utf8"))
      const forged = Buffer.from(JSON.stringify([...(Array.isArray(payload) ? payload.slice(0, 2) : []), "é".repeat(501)])).toString("base64url")
      const spy = dbSpy()
      const claire = ref.identityOf("claire")
      const refused = await runFunction(tableRows, { db: await clientOf(ref, claire, spy), identity: claire }, { table: PROSPECTS.path, limit: 5, cursor: forged }).catch((error: unknown) => error)
      expect(refused).toMatchObject(invalid)
      expect(spy.calls.filter((call) => call.tables.includes("blocks"))).toEqual([])
      expect([50, 51].map((limit) => tableRows.schema.safeParse({ table: PROSPECTS.path, limit }).success)).toEqual([true, false])
    })

    it("should serve the provenance of each served cell only when asked, by the name of its member (AC13)", async () => {
      const page = await rows({ provenance: true })
      const byKey = new Map(page.data.rows.map((row) => [row.key, row]))
      expect(byKey.get("École de Valbrune")?.provenance?.montant_estime).toEqual({
        origin: "human",
        by: "Claire Morel",
        at: "2026-09-01T08:00:00.000Z",
        comment: "Devis signé en mairie",
        link: "https://valbrune.test/deliberation-12",
      })
      expect(byKey.get("Camping Les Pins")?.provenance?.email).toEqual({
        origin: "human",
        by: "Léa Roux",
        at: "2026-09-01T08:00:00.000Z",
        imported: { value: "contact@campinglespins.test", at: "2026-08-01T00:00:00.000Z" },
      })
      expect(byKey.get("Clinique des Saules")?.provenance?.notes).toEqual({ origin: "agent", by: "former member", at: "2026-09-01T08:00:00.000Z" })
      expect((await rows({})).data.rows.some((row) => "provenance" in row)).toBe(false)
    })

    it("should serve an active lease as claim, and say an expired one without serving it (AC14)", async () => {
      const page = await rows({})
      const byKey = new Map(page.data.rows.map((row) => [row.key, row]))
      expect(byKey.get("Atelier 10")?.claim).toEqual({ worker: "claude-claire", by: "Claire Morel", until: "2999-12-31T00:00:00.000Z" })
      expect(byKey.get("Scierie Vallon")).not.toHaveProperty("claim")
      const lines = page.text.split("\n")
      expect(lines.filter((line) => line.endsWith(" (lease expired)"))).toEqual([`${JSON.stringify(byKey.get("Scierie Vallon"))} (lease expired)`])
    })

    it("should cut a page on a row boundary before 16,000 characters of rows, the formatter never cutting nor omitting (AC15)", async () => {
      const big = generated(50, 2_000)
      const page = await rows({ limit: 50 }, { rows: big })
      const served = page.data.rows.length
      expect(served).toBeGreaterThan(0)
      expect(served).toBeLessThan(50)
      expect(JSON.stringify(page.data.rows).length).toBeLessThanOrEqual(16_000)
      expect(page.text).toContain(`\nPage cut at ${served} rows to keep the result readable; continue with the cursor below.\n`)
      const next = await rows({ limit: 50, cursor: page.data.next_cursor }, { rows: big })
      expect(next.data.rows[0].key).toBe(big[served].key)
      const formatted = formatResult(page, () => false).structuredContent
      expect([formatted?.truncated, formatted?.data_omitted]).toEqual([undefined, undefined])
      // Des guillemets doublent la taille d'une ligne dans le texte : la page se coupe alors par le texte
      // (22,000 caractères sérialisés, N25), avant que les lignes n'atteignent 16,000, et le formateur ne coupe rien.
      const quoted = await rows({ limit: 50 }, { rows: generated(50, 1_500, '"') })
      const cutByText = quoted.data.rows.length
      expect(cutByText).toBeGreaterThan(0)
      expect(JSON.stringify(quoted.data.rows).length + JSON.stringify(quoted.data.rows[0]).length + 1).toBeLessThanOrEqual(16_000)
      expect(quoted.text).toContain(`\nPage cut at ${cutByText} rows to keep the result readable; continue with the cursor below.\n`)
      const quotedResult = formatResult(quoted, () => false).structuredContent
      expect([quotedResult?.truncated, quotedResult?.data_omitted]).toEqual([undefined, undefined])
      const huge = [...PROSPECT_ROWS.slice(0, 1), { ...generated(1, 17_000)[0], key: "Atelier 3", data: { entreprise: "Atelier 3", notes: "n".repeat(17_000) } }]
      expect(await refusal({ filter: { entreprise: "Atelier 3" } }, { rows: huge })).toMatchObject({
        code: "too_large",
        message: "Row Atelier 3 is larger than 16,000 characters: read it with columns to project fewer columns.",
      })
      expect(keys(await rows({ filter: { entreprise: "Atelier 3" }, columns: ["statut"] }, { rows: huge }))).toEqual(["Atelier 3"])
    })
  })

  describe("E11-S01: q by words, host and worker served", () => {
    // Chaque mot de q dans une cellule cherchée (AC-c1) : `tables-filters.test.ts` (même `matchesQuery`) ; le câblage de q
    // par table.rows, par le test de match any qui suit.
    // E11-S19 (AC-f1 à AC-f3, HN-E11S19-11) : en OU, au moins un mot, le plus de mots d'abord, `sort` départage ; le ET reste le défaut.
    it("should keep the rows with at least one word of q under match any, most words first, then by sort, with a cursor of its own", async () => {
      expect(keys(await rows({ q: "valbrune sophie" }))).toEqual(["École de Valbrune"])
      expect(keys(await rows({ q: "valbrune sophie", match: "all" }))).toEqual(["École de Valbrune"])
      const any = await rows({ q: "valbrune sophie", match: "any" })
      expect([keys(any), any.data.total]).toEqual([["École de Valbrune", "Atelier 2", "Boulangerie Fournier"], 3])
      expect(keys(await rows({ q: "valbrune sophie", match: "any", sort: { column: "entreprise", direction: "desc" } }))).toEqual(["École de Valbrune", "Boulangerie Fournier", "Atelier 2"])
      expect(keys(await rows({ q: "valbrune inconnu", match: "any" }))).toEqual(["Atelier 2", "Boulangerie Fournier", "École de Valbrune"])
      const first = await rows({ q: "valbrune sophie", match: "any", limit: 1 })
      expect(keys(await rows({ q: "valbrune sophie", match: "any", limit: 1, cursor: first.data.next_cursor }))).toEqual(["Atelier 2"])
      expect(await refusal({ q: "valbrune sophie", limit: 1, cursor: first.data.next_cursor })).toMatchObject({
        code: "invalid_arguments",
        message: "This cursor belongs to another query (filter, q, match or sort changed): start again without cursor.",
      })
    })

    it("should serve host and worker in the provenance when stored, and never the ctx code (AC-d4)", async () => {
      const written = { origin: "agent", by: PEOPLE.lea.id, ctx: "ABCD-1234", at: WRITTEN_AT, host: "claude-ai@0.1.0", worker: "claude-lea" }
      const atelier = PROSPECT_ROWS.map((row) => (row.key === "Atelier 2" ? { ...row, provenance: { ...(isRecord(row.provenance) ? row.provenance : {}), ville: written } } : row))
      const page = await rows({ provenance: true, filter: { entreprise: "Atelier 2" } }, { rows: atelier })
      expect(page.data.rows[0]?.provenance?.ville).toEqual({ origin: "agent", by: "Léa Roux", at: "2026-09-01T08:00:00.000Z", host: "claude-ai@0.1.0", worker: "claude-lea" })
      expect(page.text).not.toContain("ABCD-1234")
    })
  })
})
