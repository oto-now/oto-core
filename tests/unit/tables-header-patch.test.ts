// @vitest-environment node
// En-tête d'un tableau écrit par patch (E07-S04, AC3 à AC5) : fusion par nom et par attribut, retrait
// à part, clé, cycle et fermeture remplacés (fonction pure, `targetHeader`) ; en-tête en attente dans
// `node_drafts.meta` et lignes intactes à la publication, renommage et refus du patch par `write`, sur
// la fixture d'E07-S01 semée sur une vraie base (E01-S10, lot t1-c1b : `seedTableFixture`, une graine
// pour le fichier ; suite portable), le tableau remis à son état semé par
// `freshTable`, requêtes vues et courses jouées par `spyDb`. Textes servis au modèle comparés mot pour
// mot (H04).
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import type { TableHeader } from "../../packages/plateforme/schemas/tables"
import { readHeaderPatch, targetHeader } from "../../packages/plateforme/server/tables/evolution"
import type { ReferenceOrgSql } from "../helpers/reference-org-sql"
import type { DbCall } from "../helpers/spy-tables"
import { seedWithAdmin, type SeededData, sqlConfigured, portable } from "../helpers/sql"
import { PROSPECTS, PROSPECTS_HEADER, STATES } from "../factories/table-fixture"
import { seedTableFixture } from "../factories/table-fixture-sql"
import { draftsAt, freshTable, nodeAt, publishCalls, tableRows, writeAs, writesOf } from "../factories/table-publish-sql"

const NETWORK_TIMEOUT = 60_000
const SETUP_TIMEOUT = 180_000

/**
 * L'en-tête de la fixture, typé comme `parseTableHeader` le rend : la fixture écrit ses types en chaînes
 * libres (`type: "text"`), que TypeScript ne relie pas à l'union des types de colonne.
 */
const HEADER = PROSPECTS_HEADER as TableHeader

const names = (header: { columns: { name: string }[] }) => header.columns.map((column) => column.name)

afterEach(() => {
  vi.restoreAllMocks()
})

describe("header patch merge (AC3)", () => {
  it("should merge columns by name and attribute, add new ones at the end, remove apart, and replace key, lifecycle and closed", () => {
    const merge = (patch: Record<string, unknown>) => targetHeader({ base: HEADER, patch: readHeaderPatch({ header: patch }, "acme") ?? {}, path: PROSPECTS.path, prefix: "acme" })
    const merged = merge({ columns: [{ name: "entreprise", max_length: 250 }, { name: "telephone", type: "text" }] })
    expect(names(merged)).toEqual([...names(HEADER), "telephone"])
    expect(merged.columns[0]).toEqual({ name: "entreprise", type: "text", required: true, max_length: 250 })
    expect(merged.columns.at(-1)).toEqual({ name: "telephone", type: "text" })
    expect([merged.key, merged.lifecycle, merged.closed]).toEqual([HEADER.key, HEADER.lifecycle, false])

    const replaced = merge({ remove_columns: ["notes"], key: "email", closed: true, lifecycle: { column: "statut", states: STATES, working: "à revoir" } })
    expect(names(replaced)).toEqual(names(HEADER).filter((name) => name !== "notes"))
    expect([replaced.key, replaced.closed, replaced.lifecycle]).toEqual(["email", true, { column: "statut", states: STATES, working: "à revoir" }])

    // Un type changé laisse les attributs que le nouveau type ne prend pas, sauf s'ils sont redonnés.
    const base: TableHeader = { ...HEADER, columns: [...HEADER.columns, { name: "segment", type: "enum", options: ["a", "b"] }, { name: "site", type: "url", max_length: 80 }] }
    const patch = readHeaderPatch({ header: { columns: [{ name: "segment", type: "text" }, { name: "site", type: "number" }] } }, "acme") ?? {}
    const retyped = targetHeader({ base, patch, path: PROSPECTS.path, prefix: "acme" })
    expect(retyped.columns.slice(-2)).toEqual([{ name: "segment", type: "text" }, { name: "site", type: "number" }])
  })

  it("should set a column's label trimmed, keep it through other patches and a type change, replace it, and refuse a blank or too long one (#225)", () => {
    const merge = (base: TableHeader, header: Record<string, unknown>) => targetHeader({ base, patch: readHeaderPatch({ header }, "acme") ?? {}, path: PROSPECTS.path, prefix: "acme" })
    const labelled = merge(HEADER, { columns: [{ name: "ville", label: "  Ville du siège " }] })
    expect(labelled.columns.find((column) => column.name === "ville")).toEqual({ name: "ville", type: "text", label: "Ville du siège" })
    const kept = merge(labelled, { columns: [{ name: "ville", type: "email", max_length: 80 }] })
    expect(kept.columns.find((column) => column.name === "ville")).toEqual({ name: "ville", type: "email", max_length: 80, label: "Ville du siège" })
    expect(merge(kept, { columns: [{ name: "ville", label: "Commune" }] }).columns.find((column) => column.name === "ville")?.label).toBe("Commune")
    for (const label of ["   ", "x".repeat(101)]) {
      expect(() => readHeaderPatch({ header: { columns: [{ name: "ville", label }] } }, "acme")).toThrow("header.columns[0].label: a label holds 1 to 100 characters")
    }
  })
})

describe.skipIf(!sqlConfigured)(portable("the header of a table written by patch"), { timeout: NETWORK_TIMEOUT }, () => {
  let seed: SeededData
  let ref: ReferenceOrgSql

  beforeAll(async () => {
    seed = seedWithAdmin()
    ref = await seedTableFixture(seed)
  }, SETUP_TIMEOUT)

  afterAll(async () => {
    await seed?.cleanup()
  }, SETUP_TIMEOUT)

  /** Les en-têtes en attente du tableau, tels que la base les garde. */
  const pendingHeaders = async () => (await draftsAt(seed, ref, PROSPECTS.path)).map((draft) => draft.meta)

  describe("pending header (AC3)", () => {
    it("should keep the merged header pending in node_drafts, say what the write changed, and leave every row untouched when published", async () => {
      await freshTable(seed, ref)
      const lea = await writeAs(ref, "lea", { path: PROSPECTS.path, base_revision: 3, header: { columns: [{ name: "entreprise", max_length: 250 }, { name: "telephone", type: "text" }] } })
      expect(lea.result?.text.split("\n")[0]).toBe("Draft of ventes/suivi_prospects saved on revision 3: header changed (add telephone; change entreprise).")
      const [draft] = await draftsAt(seed, ref, PROSPECTS.path)
      expect(draft.meta).toMatchObject({ key: "entreprise", closed: false, lifecycle: HEADER.lifecycle })
      // `meta` d'une ligne relue est `unknown` : l'attente ci-dessus en a vérifié la forme.
      expect(names(draft.meta as TableHeader)).toEqual([...names(HEADER), "telephone"])
      expect((await nodeAt(seed, ref, PROSPECTS.path))?.meta).toEqual(PROSPECTS_HEADER)

      const before = await tableRows(seed, ref)
      const claire = await writeAs(ref, "claire", { path: PROSPECTS.path, base_revision: 3, publish: true })
      expect(claire.result?.text).toBe("Published ventes/suivi_prospects revision 4: added telephone; changed entreprise (max_length). Next write: base_revision 4.")
      expect((await nodeAt(seed, ref, PROSPECTS.path))?.meta).toEqual(draft.meta)
      expect(await tableRows(seed, ref)).toEqual(before)
      expect(writesOf(claire.calls).filter((call) => call.kind === "table" && call.table === "blocks")).toEqual([])
    })

    it("should publish a header change at the write level, by default, naming each change (E11-S02, AC-a2, AC-b1)", async () => {
      await freshTable(seed, ref)
      // Léa écrit dans l'équipe Ventes (niveau 2) : sans `publish`, l'en-tête changé est publié après ses contrôles.
      const lea = await writeAs(ref, "lea", { path: PROSPECTS.path, base_revision: 3, header: { columns: [{ name: "telephone", type: "text" }], closed: true }, publish: undefined })
      expect(lea.error).toBeNull()
      expect(lea.result?.text).toBe("Published ventes/suivi_prospects revision 4: added telephone; closed. Next write: base_revision 4.")
      expect(lea.result?.data).toMatchObject({ revision: 4, status: "published", has_draft: false })
      expect(publishCalls(lea.calls)).toHaveLength(1)
      expect(await pendingHeaders()).toEqual([])
      expect((await nodeAt(seed, ref, PROSPECTS.path))?.meta).toMatchObject({ closed: true })
    })

    it("should refuse, never lose, a pending header another writer saved while the draft opened", async () => {
      const logged = vi.spyOn(console, "error").mockImplementation(() => undefined)
      // L'en-tête qu'un autre enregistre dans le brouillon ouvert, encore sans en-tête ; la base avance
      // alors son tampon (`set_updated_at`).
      const theirs = { ...PROSPECTS_HEADER, columns: [...PROSPECTS_HEADER.columns, { name: "secteur", type: "text" }] }
      const saveTheirs = () => seed.admin`update platform.node_drafts set meta = ${seed.admin.json(theirs)} where node_id = ${ref.nodeId(PROSPECTS.path)} and meta is null`
      // Léa part de l'en-tête publié (aucun brouillon) ; un autre ouvre le brouillon et y enregistre son en-tête
      // juste avant l'ouverture de Léa, qui le trouve ouvert. Léa ouvre le brouillon dans la transaction de son
      // écriture (M32, HN-E01S10-b2-3) : personne n'y écrit plus entre son ouverture et sa relecture.
      const openTheirs = async () => {
        await seed.admin`insert into platform.node_drafts (node_id, base_revision)
                         select id, revision from platform.nodes where id = ${ref.nodeId(PROSPECTS.path)}`
        await saveTheirs()
      }
      const meanwhile = async (call: DbCall) => {
        if (call.kind === "rpc" && call.name === "open_draft") await openTheirs()
      }
      await freshTable(seed, ref)
      const lea = await writeAs(ref, "lea", { path: PROSPECTS.path, base_revision: 3, header: { columns: [{ name: "telephone", type: "text" }] } }, { meanwhile })
      expect(lea.error).toMatchObject({
        code: "stale_revision",
        message: "stale revision: ventes/suivi_prospects changed while writing (its pending header was saved meanwhile). Nothing was written. Read it again with draft: true, then retry.",
      })
      expect(await pendingHeaders()).toEqual([theirs])
      expect(logged).toHaveBeenCalledWith(`[platform] nodes: draft of ${ref.nodeId(PROSPECTS.path)} changed while writing (header)`)

      // Le brouillon déjà ouvert : l'autre enregistre son en-tête entre la lecture de Léa et son écriture (garde du tampon).
      const saving = async (call: DbCall) => {
        if (call.kind === "table" && call.table === "node_drafts" && call.op === "update") await saveTheirs()
      }
      await freshTable(seed, ref, { draft: { meta: null } })
      const second = await writeAs(ref, "lea", { path: PROSPECTS.path, base_revision: 3, header: { columns: [{ name: "telephone", type: "text" }] } }, { meanwhile: saving })
      expect(second.error).toMatchObject({
        code: "stale_revision",
        message: "stale revision: ventes/suivi_prospects changed while writing (its pending header was saved meanwhile). Nothing was written. Read it again with draft: true, then retry.",
      })
      expect(await pendingHeaders()).toEqual([theirs])
    })
  })

  describe("renaming (AC4)", () => {
    it("should refuse a rename attribute with the path that works, and remind it when a removed column holds values", async () => {
      await freshTable(seed, ref)
      const renamed = "Columns cannot be renamed: add « tel » under the new name, copy the values with acme_call table.write, then remove « telephone » with header.remove_columns."
      for (const column of [{ name: "telephone", rename: "tel" }, { name: "telephone", new_name: "tel" }, { name: "telephone", renamed_to: "tel" }, { name: "tel", old_name: "telephone" }]) {
        const refused = await writeAs(ref, "claire", { path: PROSPECTS.path, base_revision: 3, header: { columns: [column] } })
        expect(refused.error, JSON.stringify(column)).toMatchObject({ code: "invalid_arguments", message: renamed })
        expect(writesOf(refused.calls)).toEqual([])
      }
      // Retirer une colonne qui a des valeurs et en ajouter une autre : la confirmation de l'AC8 le rappelle.
      const swapped = await writeAs(ref, "claire", { path: PROSPECTS.path, base_revision: 3, header: { remove_columns: ["contact"], columns: [{ name: "interlocuteur", type: "text" }] }, publish: true })
      expect(swapped.error).toMatchObject({ code: "needs_confirmation", message: expect.stringContaining(". Columns cannot be renamed: to rename one, add the new column, copy the values with acme_call table.write, then remove the old one. ") })
      expect(publishCalls(swapped.calls)).toEqual([])
    })
  })

  describe("patch refusals (AC5)", () => {
    it("should refuse a patch that cannot apply, writing nothing, with every problem and the contract", async () => {
      const contract = 'Contract: acme_read {"path": "write.table"}.'
      const columns = "entreprise, contact, email, ville, montant_estime, dernier_contact, relance_le, actif, notes, statut"
      const cases: [Record<string, unknown>, string][] = [
        [{ header: { remove_columns: ["fax"] } }, `Invalid table header: remove_columns: « fax » is not a column of ventes/suivi_prospects. Columns: ${columns}. ${contract}`],
        [{ header: { remove_columns: ["entreprise"] } }, `Invalid table header: remove_columns: « entreprise » is the key of ventes/suivi_prospects; a key column cannot be removed. ${contract}`],
        [{ header: { columns: [{ name: "fax", type: "text" }], remove_columns: ["fax"] } }, `Invalid table header: « fax » is both in columns and remove_columns. ${contract}`],
        [{ header: { remove_columns: ["notes"], confirm_remove: true } }, "confirm_remove only applies when the write publishes: remove publish: false."],
        [{ header: { order: ["ville"] } }, "header: unknown key « order »; keys: columns, remove_columns, key, lifecycle, closed, proof, confirm_remove"],
        [{ header: { columns: [{ name: "ville", width: 3 }] } }, "header.columns[0]: unknown key « width »; keys: name, label, type, options, required, allow_verified_empty, max_length"],
        // Des clés inconnues sans nombre fixé : 20 citées, puis leur nombre restant (`mcp-patterns.md § 4`).
        [
          { header: Object.fromEntries(Array.from({ length: 25 }, (_, index) => [`k${index + 1}`, 1])) },
          `header: unknown keys ${Array.from({ length: 20 }, (_, index) => `« k${index + 1} »`).join(", ")}, … and 5 more; keys: columns, remove_columns, key, lifecycle, closed, proof, confirm_remove`,
        ],
        [{ header: { columns: [{ name: "telephone", type: "text" }, { name: "telephone", type: "email" }] } }, `Invalid table header: columns[1].name: duplicate column telephone. ${contract}`],
        [
          { header: { columns: [{ name: "statut", options: ["ouvert", "fermé"] }, { name: "ville", options: ["a"] }] } },
          `Invalid table header: columns[3].options: options apply to enum columns only; ville is text; lifecycle.states must list exactly the options of statut, in the same order. ${contract}`,
        ],
      ]
      await freshTable(seed, ref)
      for (const [input, message] of cases) {
        const refused = await writeAs(ref, "claire", { path: PROSPECTS.path, base_revision: 3, ...input })
        expect(refused.error, message).toMatchObject({ code: "invalid_arguments", message })
        expect(writesOf(refused.calls), message).toEqual([])
      }

      // Une colonne que l'en-tête en attente retire déjà : le refus dit qu'il part de lui.
      await freshTable(seed, ref, { draft: { meta: { ...PROSPECTS_HEADER, columns: PROSPECTS_HEADER.columns.filter((column) => column.name !== "notes") } } })
      const again = await writeAs(ref, "claire", { path: PROSPECTS.path, base_revision: 3, header: { remove_columns: ["notes"] } })
      expect(again.error).toMatchObject({
        code: "invalid_arguments",
        message: `Invalid table header: remove_columns: « notes » is not a column of the pending header of ventes/suivi_prospects (read it with draft: true). Columns: ${columns.replace("notes, ", "")}. ${contract}`,
      })
      expect(writesOf(again.calls)).toEqual([])
    })
  })
})
