// @vitest-environment node
// `table.write` sur une vraie base (E07-S02, AC1, AC2, AC4, AC8, AC9, AC12, AC13, AC18, AC19, AC29 ; H92,
// H98, H123 ; fiche D49 B) : la base rend toute ligne de l'organisation que les filtres demandent
// (isolation seule, E01-S08) ; le service décide, fusionne et écrit sous garde de révision, et l'espion
// des requêtes montre ce qui part. Écritures concurrentes jouées par `Promise.all`, retenues jusqu'à ce
// qu'elles se croisent (`crossing`) ; la violation d'unicité de `uq_blocks_node_id_state_key` est celle de
// la base. Textes servis au modèle comparés mot pour mot (H04). Réécrit sur base réelle par E01-S10 (lot
// t1-c1a, fiche D76 A) : une graine par fichier (`seedTableFixture`), les lignes de chaque base simulée
// posées par `fixtureRows` et relues par la connexion d'administration ; l'espion `dbSpy` à la place de
// celui de la base simulée. Les formes de requête comparées (colonnes d'une insertion ou d'une mise à
// jour, clés du lot lues) sont celles de la face SQL, où la partie c d'E01-S10 (lot c1) a passé les
// lignes de tableau : lues dans le texte de l'instruction et dans ses valeurs liées.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import type { CatalogFunction, FunctionOutput } from "../../packages/plateforme/server/catalog/define"
import type { Identity } from "../../packages/plateforme/server/identity"
import { tableClaim } from "../../packages/plateforme/server/tables/claim"
import { parseTableHeader } from "../../packages/plateforme/server/tables/header"
import { tableRelease } from "../../packages/plateforme/server/tables/release"
import { tableRows, toReadRow } from "../../packages/plateforme/server/tables/rows"
import { tableWrite } from "../../packages/plateforme/server/tables/write"
import { nodeId, PEOPLE, teamOf, type RuleSpec } from "../helpers/reference-org"
import type { ReferenceOrgSql } from "../helpers/reference-org-sql"
import type { Row, Tables } from "../helpers/simulated-db"
import { loggedText } from "../helpers/logs"
import { dbSpy, isWrite, type DbSpy, type SpiedCall } from "../helpers/spy-t1-c1a"
import { sqlConfigured, seedWithAdmin, type SeededData, portable } from "../helpers/sql"
import { fixtureTables, PROSPECT_ROWS, PROSPECTS, PROSPECTS_HEADER, rowBlocks, runFunction, TICKETS } from "../factories/table-fixture"
import { seedTableFixture } from "../factories/table-fixture-sql"
import { CASE_TIMEOUT, clientOf, crossing, fixtureRows, SEED_TIMEOUT, type FixtureRows } from "../factories/table-rows-sql"

const CTX = "ABCD-1234"
const ORIGIN = "https://acme.test"
/** Le tableau des prospects dans la base simulée, dont les variantes ci-dessous retouchent les lignes. */
const TABLE_ID = nodeId(PROSPECTS.path)
const SUMMARY_ONE_CREATED = "ventes/suivi_prospects: 1 row(s) written (1 created, 0 updated), 0 unchanged, 0 refused."

/** Une valeur écrite avec sa preuve, forme documentée d'une cellule (fiche D99, M53). */
const PROOF = "Lu sur le site"
const proved = (value: string | number) => ({ value, comment: PROOF })
/** Le problème d'une valeur nue différente de la valeur rangée, qui refuse l'appel entier (HN-M53-5). */
const UNPROVED =
  'new value without its proof: write {"value": …, "comment": "…"} (where you found it) or {"value": …, "link": "https://…"} (the source); a column searched without result goes in verified_empty with a reason'

const blockCalls = (calls: SpiedCall[]) => calls.filter((one) => one.tables.includes("blocks"))
const blockWrites = (calls: SpiedCall[]) => blockCalls(calls).filter(isWrite)

/** Les colonnes qu'une insertion nomme, lues dans le texte de son instruction. */
function insertedColumns(call: SpiedCall): string[] {
  const listed = /insert\s+into\s+platform\.blocks\s*\(([^)]*)\)/i.exec(call.text ?? "")?.[1] ?? ""
  return listed.split(",").map((column) => column.trim()).filter(Boolean).sort()
}

/** Les colonnes que le `set` d'une mise à jour écrit, lues dans le texte de son instruction. */
function setColumns(call: SpiedCall): string[] {
  const assignments = /\bset\b([\s\S]*?)\bwhere\b/i.exec(call.text ?? "")?.[1] ?? ""
  return assignments.split(",").map((assignment) => assignment.split("=")[0].trim()).filter(Boolean).sort()
}

function lines(output: FunctionOutput): string[] {
  return output.text.split("\n")
}

function rowsOf(output: FunctionOutput): Record<string, unknown>[] {
  const rows = output.data?.rows
  return Array.isArray(rows) ? rows : []
}

/** Une table de la fixture où une ligne des prospects est retouchée. */
function withProspect(key: string, change: Partial<Row>): Tables {
  const tables = fixtureTables()
  const row = tables.blocks.find((block) => block.node_id === TABLE_ID && block.key === key)
  if (row) Object.assign(row, change)
  return tables
}

describe.skipIf(!sqlConfigured)(portable("table.write on a real database"), { timeout: CASE_TIMEOUT }, () => {
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

  async function call(fn: CatalogFunction, identity: Identity, args: Record<string, unknown>, simulated?: DbSpy): Promise<FunctionOutput> {
    const spy = simulated ?? (await fixture.database())
    return runFunction(fn, { db: await clientOf(ref, identity, spy), identity, ctx: CTX, origin: ORIGIN }, args)
  }

  function refusal(fn: CatalogFunction, identity: Identity, args: Record<string, unknown>, simulated?: DbSpy): Promise<unknown> {
    return call(fn, identity, args, simulated).then(
      () => null,
      (reason: unknown) => reason,
    )
  }

  describe("table.write on the database", () => {
    it("should insert a published row with its key, the entry state and the provenance of each cell; the base sets id, org_id and revision (AC1)", async () => {
      const simulated = await fixture.database()
      const output = await call(tableWrite, ref.identityOf("lea"), {
        table: PROSPECTS.path,
        rows: [{ key: "Boulangerie du Pont", set: { contact: proved("Anne Roy"), ville: proved("Valbrune"), montant_estime: proved(15000) } }],
      }, simulated)
      const [insert] = blockWrites(simulated.calls)
      expect([insert.op, insertedColumns(insert)]).toEqual(["insert", ["created_by", "data", "key", "node_id", "provenance", "state", "type", "updated_by"]])
      const row = await fixture.row("Boulangerie du Pont")
      const agent = { origin: "agent", by: PEOPLE.lea.id, ctx: CTX, at: expect.stringMatching(/Z$/) }
      expect(row).toMatchObject({
        state: "published",
        type: "row",
        revision: 1,
        data: { entreprise: "Boulangerie du Pont", contact: "Anne Roy", ville: "Valbrune", montant_estime: 15000, statut: "à traiter" },
        created_by: PEOPLE.lea.id,
        updated_by: PEOPLE.lea.id,
      })
      const proven = { ...agent, comment: PROOF }
      expect(row?.provenance).toEqual({ entreprise: agent, contact: proven, ville: proven, montant_estime: proven, statut: agent })
      expect([row?.text ?? null, row?.position ?? null]).toEqual([null, null])
      expect(output.text).toBe([SUMMARY_ONE_CREATED, "Boulangerie du Pont: created (revision 1): set contact, ville, montant_estime; statut = « à traiter » (queue entry)."].join("\n"))
      expect(rowsOf(output)).toEqual([
        {
          key: "Boulangerie du Pont",
          status: "created",
          revision: 1,
          changes: { set: ["contact", "ville", "montant_estime"], cleared: [], verified_empty: [], annotated: [], entry: { column: "statut", state: "à traiter" } },
        },
      ])
    })

    it("should write 49 rows of 50 and refuse the 7th with all its problems, one line per row in order; 51 rows or none are refused by the schema (AC2)", async () => {
      const simulated = await fixture.database()
      const keys = Array.from({ length: 50 }, (_, index) => `Prospect ${String(index + 1).padStart(2, "0")}`)
      const rows = keys.map((key, index) => ({ key, set: index === 6 ? { couleur: proved("bleu"), montant_estime: proved("cher") } : { ville: proved("Valbrune") } }))
      const output = await call(tableWrite, ref.identityOf("lea"), { table: PROSPECTS.path, rows }, simulated)
      expect(lines(output)[0]).toBe("ventes/suivi_prospects: 49 row(s) written (49 created, 0 updated), 0 unchanged, 1 refused.")
      expect(lines(output).slice(1).map((line) => line.split(":")[0])).toEqual(keys)
      const problems = [
        "couleur: unknown column. Columns of ventes/suivi_prospects: entreprise, contact, email, ville, montant_estime, dernier_contact, relance_le, actif, notes, statut. Do not retry under a variant of the name.",
        'montant_estime: expected a number, e.g. 12000 (not "cher").',
      ]
      expect(lines(output)[7]).toBe(`Prospect 07: refused, nothing written: ${problems.join(" ")}`)
      expect(rowsOf(output)[6]).toEqual({ key: "Prospect 07", status: "refused", code: "invalid_arguments", problems })
      expect(output.data).toMatchObject({ table: PROSPECTS.path, written: 49, refused: 1 })
      expect([(await fixture.row("Prospect 06"))?.revision, await fixture.row("Prospect 07")]).toEqual([1, undefined])
      expect([[], [...rows, { key: "Prospect 51" }]].map((many) => tableWrite.schema.safeParse({ table: PROSPECTS.path, rows: many }).success)).toEqual([false, false])
      // Une ligne, une cellule ou une entrée `verified_empty` à clé inconnue est refusée, jamais dépouillée de cette clé.
      const nested = [
        { key: "Prospect 01", sets: { ville: proved("Coudray") } },
        { key: "Prospect 01", set: { ville: { value: "Coudray", commentaire: "Vu au salon" } } },
        { key: "Prospect 01", verified_empty: [{ column: "email", reason: "Rien trouvé", raison: "annuaire" }] },
      ]
      expect(nested.map((row) => tableWrite.schema.safeParse({ table: PROSPECTS.path, rows: [row] }).success)).toEqual([false, false, false])
    })

    it("should refuse only the row that holds a null, alone or as value, at its path with the text of AC4, and write the other rows of the call (AC4, D49 B)", async () => {
      const simulated = await fixture.database()
      const output = await call(tableWrite, ref.identityOf("lea"), {
        table: PROSPECTS.path,
        rows: [
          { key: "Atelier 2", set: { notes: proved("Visite prévue") } },
          { key: "Boulangerie du Pont", set: { contact: null, ville: { value: null }, montant_estime: proved(15000) } },
          { key: "Nouveau Prospect", set: { contact: proved("Hélène Dubois") } },
        ],
      }, simulated)
      const text = "null is refused: use clear to empty a field, or verified_empty with a reason for 'searched, nothing found'."
      const problems = [`rows.1.set.contact: ${text}`, `rows.1.set.ville: ${text}`]
      expect(lines(output)).toEqual([
        "ventes/suivi_prospects: 2 row(s) written (1 created, 1 updated), 0 unchanged, 1 refused.",
        "Atelier 2: updated (revision 2): set notes.",
        `Boulangerie du Pont: refused, nothing written: ${problems.join(" ")}`,
        "Nouveau Prospect: created (revision 1): set contact; statut = « à traiter » (queue entry).",
      ])
      expect(rowsOf(output)[1]).toEqual({ key: "Boulangerie du Pont", status: "refused", code: "invalid_arguments", problems })
      expect([(await fixture.row("Atelier 2"))?.revision, await fixture.row("Boulangerie du Pont"), (await fixture.row("Nouveau Prospect"))?.revision]).toEqual([2, undefined, 1])
    })

    it("should write an existing row of a closed table and refuse a new key there, nothing created (AC8)", async () => {
      const simulated = await fixture.database()
      const paul = ref.identityOf("paul")
      const output = await call(tableWrite, paul, { table: TICKETS.path, rows: [{ key: 7, set: { sujet: proved("Facture corrigée") } }, { key: 99, set: { sujet: proved("Nouveau ticket") } }] }, simulated)
      expect(lines(output).slice(1)).toEqual([
        "7: updated (revision 2): sujet: Facture en double → Facture corrigée.",
        "99: this table is closed: only existing rows can be written; nothing was created. Check the key: an invented key would create a row that nothing matches.",
      ])
      expect(rowsOf(output).map((row) => [row.key, row.status])).toEqual([[7, "updated"], [99, "refused"]])
      expect(await fixture.row("99", TICKETS.path)).toBeUndefined()
    })

    it("should leave a row unchanged when the value is the same: no update sent, revision and provenance kept (AC9)", async () => {
      // La même valeur avec la même preuve : rien ne change (une autre preuve s'annoterait, AC10).
      const provenance = { ville: { origin: "agent", by: PEOPLE.lea.id, at: "2026-09-20T08:00:00.000Z", comment: PROOF } }
      const simulated = await fixture.database(withProspect("Atelier 2", { revision: 3, provenance }))
      const before = structuredClone(await fixture.row("Atelier 2"))
      const output = await call(tableWrite, ref.identityOf("lea"), { table: PROSPECTS.path, rows: [{ key: "Atelier 2", set: { ville: proved("Valbrune") } }] }, simulated)
      expect(lines(output)).toEqual(["ventes/suivi_prospects: 0 row(s) written (0 created, 0 updated), 1 unchanged, 0 refused.", "Atelier 2: unchanged (revision 3): same values."])
      expect(blockWrites(simulated.calls)).toEqual([])
      expect(await fixture.row("Atelier 2")).toEqual(before)
    })

    it("should refuse a stale revision with the current row and write the other rows; two writes at once without revision both land (AC12)", async () => {
      const simulated = await fixture.database()
      const output = await call(tableWrite, ref.identityOf("lea"), {
        table: PROSPECTS.path,
        rows: [
          { key: "Boulangerie Fournier", revision: 1, set: { notes: proved("Rappeler") } },
          { key: "Atelier 2", set: { notes: proved("Visite prévue") } },
        ],
      }, simulated)
      const header = parseTableHeader(PROSPECTS_HEADER)
      if (!("header" in header)) throw new Error("fixture header")
      const fournier = PROSPECT_ROWS.find((row) => row.key === "Boulangerie Fournier")
      if (!fournier) throw new Error("fixture row")
      const current = toReadRow(fournier, header.header, new Map())
      expect(lines(output).slice(1)).toEqual([
        `Boulangerie Fournier: refused (stale_revision): you read revision 1, the row is at revision 2; nothing written. Current row: ${JSON.stringify(current)}. Read it again, recompute, then write with revision 2.`,
        "Atelier 2: updated (revision 2): set notes.",
      ])
      expect(rowsOf(output)[0]).toMatchObject({ status: "refused", code: "stale_revision", current })

      // Les deux mises à jour retenues jusqu'à ce qu'elles partent ensemble : l'une croise l'autre.
      const both = await fixture.database(fixtureTables(), crossing(2, "update"))
      await Promise.all([
        call(tableWrite, ref.identityOf("lea"), { table: PROSPECTS.path, rows: [{ key: "Camping Les Pins", set: { contact: proved("Inès Vidal-Roy") } }] }, both),
        call(tableWrite, ref.identityOf("claire"), { table: PROSPECTS.path, rows: [{ key: "Camping Les Pins", set: { ville: proved("Coudray") } }] }, both),
      ])
      expect(await fixture.row("Camping Les Pins")).toMatchObject({ revision: 4, data: { contact: "Inès Vidal-Roy", ville: "Coudray" } })
      // Trois mises à jour gardées (une a croisé l'autre), aucune ne nomme `key` ni `node_id` (AC16) : les colonnes de leur `set`.
      const updated = blockWrites(both.calls).map((one) => [one.op, setColumns(one)])
      expect(updated).toEqual(Array.from({ length: 3 }, () => ["update", ["data", "provenance", "revision", "updated_by"]]))

      // Une autre écriture passe avant chaque mise à jour : sans révision, la ligne est réappliquée deux fois
      // au plus puis refusée en conflit (N2) ; avec révision, périmée dès la première (N26). Chaque course est journalisée.
      const logged = vi.spyOn(console, "error").mockImplementation(() => undefined)
      const racing = [
        { key: "Ferme du Coudray", set: { notes: proved("x") } },
        { key: "Boulangerie Fournier", revision: 2, set: { notes: proved("Rappeler") } },
      ]
      const raced = await call(tableWrite, ref.identityOf("lea"), { table: PROSPECTS.path, rows: racing }, await fixture.database(fixtureTables(), fixture.bumpBeforeUpdate))
      const moved = toReadRow({ ...fournier, revision: 3 }, header.header, new Map())
      expect(lines(raced).slice(1)).toEqual([
        "Ferme du Coudray: changed meanwhile by other writes (3 tries); nothing written. Read it again with table.rows, then retry.",
        `Boulangerie Fournier: refused (stale_revision): you read revision 2, the row is at revision 3; nothing written. Current row: ${JSON.stringify(moved)}. Read it again, recompute, then write with revision 3.`,
      ])
      expect(rowsOf(raced).map((row) => row.code)).toEqual(["conflict", "stale_revision"])
      const tableId = ref.nodeId(PROSPECTS.path)
      expect(logged.mock.calls).toEqual([
        ["[platform] tables: write: no row written", `${tableId}#Ferme du Coudray`],
        ["[platform] tables: write: row changed before its update", `${tableId}#Boulangerie Fournier`],
      ])
      logged.mockRestore()
    })

    it("should keep one row when two writes create the same key at once: the second insertion reads the row and updates it (AC13)", async () => {
      // Les deux insertions retenues jusqu'à ce qu'elles partent ensemble : l'index `uq_blocks_node_id_state_key` écarte la seconde.
      const simulated = await fixture.database(fixtureTables(), crossing(2, "insert"))
      await Promise.all([
        call(tableWrite, ref.identityOf("lea"), { table: PROSPECTS.path, rows: [{ key: "Nouveau Prospect", set: { contact: proved("Hélène Dubois") } }] }, simulated),
        call(tableWrite, ref.identityOf("claire"), { table: PROSPECTS.path, rows: [{ key: "Nouveau Prospect", set: { ville: proved("Port-Lise") } }] }, simulated),
      ])
      const rows = await fixture.rows("Nouveau Prospect")
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ revision: 2, data: { entreprise: "Nouveau Prospect", contact: "Hélène Dubois", ville: "Port-Lise", statut: "à traiter" } })
    })

    it("should refuse a row under someone else's lease, and let the holder write it whatever the worker label (AC18)", async () => {
      const simulated = await fixture.database()
      const lea = await call(tableWrite, ref.identityOf("lea"), { table: PROSPECTS.path, rows: [{ key: "Atelier 10", set: { notes: proved("Relancer") } }] }, simulated)
      expect(lines(lea)[1]).toBe("Atelier 10: claimed by Claire Morel (worker claude-claire) until 00:00 UTC; nothing written. Wait for its release or the end of the lease.")
      expect(rowsOf(lea)[0]).toMatchObject({ status: "refused", code: "conflict" })
      expect(blockWrites(simulated.calls)).toEqual([])
      const claire = await call(tableWrite, ref.identityOf("claire"), { table: PROSPECTS.path, rows: [{ key: "Atelier 10", set: { notes: proved("Relancer") } }] }, simulated)
      expect(lines(claire)[1]).toBe("Atelier 10: updated (revision 4): set notes.")
    })

    it("should answer an unreadable table as unknown and refuse writing without the write level, naming whom to ask, before reading or writing any row (AC19)", async () => {
      const marc = ref.identityOf("marc", { teams: [teamOf("support", "marc")] })
      const cases: [CatalogFunction, Record<string, unknown>][] = [
        [tableWrite, { rows: [{ key: "Atelier 2", set: { notes: proved("x") } }] }],
        [tableClaim, { worker: "claude-marc" }],
        [tableRelease, { key: "Atelier 2", worker: "claude-marc" }],
      ]
      const read: RuleSpec = { node: PROSPECTS.path, team: "support", level: "read" }
      await fixture.database()
      // La ligne que chaque refus viserait, relue identique après eux (AC-x3 d'E01-S10).
      const before = await fixture.row("Atelier 2")
      for (const [fn, args] of cases) {
        const unknown = dbSpy()
        expect(await refusal(fn, marc, { table: PROSPECTS.path, ...args }, unknown), fn.name).toMatchObject({
          code: "not_found",
          message: `Unknown table ventes/suivi_prospects. Tables you can read: support/tickets. Use ${ref.org.prefix}_find with type table for more.`,
        })
        expect(blockCalls(unknown.calls), fn.name).toEqual([])
      }
      const [ruleId] = await ref.addRules([read])
      try {
        for (const [fn, args] of cases) {
          const reader = dbSpy()
          expect(await refusal(fn, marc, { table: PROSPECTS.path, ...args }, reader), fn.name).toMatchObject({
            code: "forbidden",
            message: expect.stringContaining("Writing ventes/suivi_prospects is reserved to team Ventes (lead: Claire Morel). You can read it: suggest the change"),
          })
          expect(blockCalls(reader.calls), fn.name).toEqual([])
        }
      } finally {
        await seed.admin`delete from platform.access_rules where id = ${ruleId}`
      }
      expect(await fixture.row("Atelier 2")).toEqual(before)
    })

    it("should send the database only strings it reads: a lone surrogate half becomes U+FFFD, and a quoted key is read as written in the batch (supabase-patterns.md § Error Handling)", async () => {
      // La base refuse un paramètre `jsonb` qui porte une moitié de paire de substitution (22P02) : la vraie base le dit elle-même.
      const dupont = 'SARL "Dupont (Fils)"'
      const tables = fixtureTables()
      const [seeded] = rowBlocks(TABLE_ID, [{ key: dupont, data: { entreprise: dupont, statut: "à traiter" }, provenance: {}, revision: 1, claimed_by: null, claimed_by_user: null, lease_until: null }])
      tables.blocks.push({ ...seeded, id: `${TABLE_ID}:row:dupont` })
      const simulated = await fixture.database(tables)
      const lea = ref.identityOf("lea")
      const rows = [
        { key: "Atelier 2", set: { notes: proved("Rappeler") } },
        { key: "Prospect \ud83d", set: { contact: proved("Anne \ud83d") } },
        { key: dupont, set: { ville: proved("Coudray") } },
      ]
      const output = await call(tableWrite, lea, { table: PROSPECTS.path, rows }, simulated)
      expect(rowsOf(output).map((row) => [row.key, row.status])).toEqual([["Atelier 2", "updated"], ["Prospect �", "created"], [dupont, "updated"]])
      expect(await fixture.row("Prospect \ufffd")).toMatchObject({ data: { entreprise: "Prospect \ufffd", contact: "Anne \ufffd" } })
      expect(await fixture.row(dupont)).toMatchObject({ revision: 2, data: { ville: "Coudray" } })
      // Une clé part en valeur liée, telle qu'écrite : la lecture du lot trouve celle qui porte `"` (PostgREST la lisait autre
      // dans une liste `in`, `unsafeInValue`), et aucune insertion n'est tentée pour elle.
      const batches = blockCalls(simulated.calls).filter((one) => one.op === "select").map((one) => [one.values].flat(2))
      const inserts = blockWrites(simulated.calls).filter((one) => one.op === "insert")
      expect([batches.some((values) => values.includes("Atelier 2") && values.includes(dupont)), inserts.length]).toEqual([true, 1])

      // Le libellé du travailleur écrit par `table.claim` est celui que `table.release` compare.
      await call(tableClaim, lea, { table: PROSPECTS.path, worker: "claude-\ud83d", filter: { entreprise: "Atelier 2" } }, simulated)
      expect(await fixture.row("Atelier 2")).toMatchObject({ claimed_by: "claude-�", claimed_by_user: PEOPLE.lea.id })
      const released = await call(tableRelease, lea, { table: PROSPECTS.path, key: "Atelier 2", worker: "claude-\ud83d", state: "à revoir" }, simulated)
      expect(released.text).toBe("Atelier 2 released → « à revoir » (revision 4).")
    })

    it("should ignore a bare value equal to the stored one, and refuse the whole call on a bare value that differs, writing nothing, and write a bare permitted state (fiche D99, M53, HN-M53-5)", async () => {
      const simulated = await fixture.database()
      const lea = ref.identityOf("lea")
      const before = structuredClone(await fixture.row("Atelier 2"))
      const fournier = structuredClone(await fixture.row("Boulangerie Fournier"))
      // Égales à la valeur rangée, dans le type de la colonne : ignorées, rien d'écrit, aucune provenance changée.
      const same = await call(tableWrite, lea, { table: PROSPECTS.path, rows: [{ key: "Atelier 2", set: { ville: "Valbrune", montant_estime: 2000, actif: { value: true } } }] }, simulated)
      expect(rowsOf(same).map((row) => [row.key, row.status, row.revision])).toEqual([["Atelier 2", "unchanged", before?.revision]])
      expect(blockWrites(simulated.calls)).toEqual([])
      expect(await fixture.row("Atelier 2")).toEqual(before)
      // Une valeur nue différente refuse l'appel entier : la ligne prouvée du même appel ne s'écrit pas non plus.
      const rows = [{ key: "Boulangerie Fournier", set: { notes: proved("Rappeler") } }, { key: "Atelier 2", set: { montant_estime: "2000" } }]
      expect(await refusal(tableWrite, lea, { table: PROSPECTS.path, rows }, simulated)).toMatchObject({
        code: "invalid_arguments",
        message: `Nothing was written: a bare value equal to the stored one is ignored; any new value needs its proof. rows.1.set.montant_estime: ${UNPROVED}.`,
      })
      expect(blockWrites(simulated.calls)).toEqual([])
      expect([await fixture.row("Boulangerie Fournier"), await fixture.row("Atelier 2")]).toEqual([fournier, before])
      // La colonne d'état n'a pas de preuve (décision de JB du 2026-09-27) : « à traiter » → « à revoir » s'écrit nu.
      const state = await call(tableWrite, lea, { table: PROSPECTS.path, rows: [{ key: "Boulangerie Fournier", set: { statut: "à revoir" } }] }, simulated)
      expect(rowsOf(state).map((row) => [row.key, row.status])).toEqual([["Boulangerie Fournier", "updated"]])
      expect(await fixture.row("Boulangerie Fournier")).toMatchObject({ data: { statut: "à revoir" } })
    })

    it("should leave unchanged a row read by table.rows and sent back as is, even with a value out of format (AC29)", async () => {
      const simulated = await fixture.database()
      const lea = ref.identityOf("lea")
      const page = await call(tableRows, lea, { table: PROSPECTS.path, filter: { entreprise: { in: ["Boulangerie Fournier", "École de Valbrune", "Brasserie de la Lise"] } } }, simulated)
      const read = rowsOf(page)
      const rows = read.map(({ key, revision, set, verified_empty }) => ({ key, revision, set, ...(verified_empty ? { verified_empty } : {}) }))
      const output = await call(tableWrite, lea, { table: PROSPECTS.path, rows }, simulated)
      expect(rowsOf(output).map((row) => [row.key, row.status, row.revision])).toEqual(read.map((row) => [row.key, "unchanged", row.revision]))
      expect(blockWrites(simulated.calls)).toEqual([])
    })
  })

  describe("E11-S01: create_only, host and worker, proof by table", () => {
    const HOST = "claude-ai@0.1.0"

    function readHeader() {
      const parsed = parseTableHeader(PROSPECTS_HEADER)
      if (!("header" in parsed)) throw new Error("fixture header")
      return parsed.header
    }

    /** Le tableau des prospects sans la preuve exigée, le temps d'un cas (fiche D133, HN-E11S01-13). */
    async function withoutProof(run: () => Promise<void>): Promise<void> {
      const id = ref.nodeId(PROSPECTS.path)
      await seed.admin`update platform.nodes set meta = jsonb_set(meta, '{proof}', 'false'::jsonb) where id = ${id}`
      try {
        await run()
      } finally {
        await seed.admin`update platform.nodes set meta = jsonb_set(meta, '{proof}', 'true'::jsonb) where id = ${id}`
      }
    }

    it("should refuse a key that has its row under create_only, with the row as it is, create the others, and refuse a key written twice after creating it (AC-a1, AC-a3)", async () => {
      const simulated = await fixture.database(withProspect("Atelier 2", { revision: 3 }))
      const before = structuredClone(await fixture.row("Atelier 2"))
      const rows = [
        { key: "Atelier 2", set: { notes: proved("Relancer") } },
        { key: "Boulangerie du Pont", set: { ville: proved("Valbrune") } },
        { key: "Boulangerie du Pont", set: { contact: proved("Anne Roy") } },
      ]
      const output = await call(tableWrite, ref.identityOf("lea"), { table: PROSPECTS.path, create_only: true, rows }, simulated)
      const atelier = PROSPECT_ROWS.find((row) => row.key === "Atelier 2")
      if (!atelier) throw new Error("fixture row")
      const current = toReadRow({ ...atelier, revision: 3 }, readHeader(), new Map())
      const created = { key: "Boulangerie du Pont", revision: 1, set: { entreprise: "Boulangerie du Pont", ville: "Valbrune", statut: "à traiter" } }
      expect(lines(output)).toEqual([
        "ventes/suivi_prospects: 1 row(s) written (1 created, 0 updated), 0 unchanged, 2 refused.",
        `Atelier 2: refused (conflict): a row with this key already exists (revision 3); nothing written (create_only). Current row: ${JSON.stringify(current)}. Pick another key, or write without create_only to update it.`,
        "Boulangerie du Pont: created (revision 1): set ville; statut = « à traiter » (queue entry).",
        `Boulangerie du Pont: refused (conflict): a row with this key already exists (revision 1); nothing written (create_only). Current row: ${JSON.stringify(created)}. Pick another key, or write without create_only to update it.`,
      ])
      expect(rowsOf(output).map((row) => [row.status, row.code ?? null])).toEqual([["refused", "conflict"], ["created", null], ["refused", "conflict"]])
      expect(rowsOf(output)[0]).toMatchObject({ current })
      expect(await fixture.row("Atelier 2")).toEqual(before)
      expect(await fixture.row("Boulangerie du Pont")).toMatchObject({ revision: 1, data: { entreprise: "Boulangerie du Pont", ville: "Valbrune", statut: "à traiter" } })
    })

    it("should refuse, never update, a key another creation took meanwhile under create_only, and log the race (AC-a2)", async () => {
      const taken = rowBlocks(TABLE_ID, [
        { key: "Nouveau Prospect", data: { entreprise: "Nouveau Prospect", statut: "à traiter" }, provenance: {}, revision: 1, claimed_by: null, claimed_by_user: null, lease_until: null },
      ]).map((row) => ({ ...row, id: `${TABLE_ID}:row:pris` }))
      let raced = false
      // L'autre création passe juste avant l'insertion du service : `uq_blocks_node_id_state_key` écarte la sienne.
      const simulated = await fixture.database(fixtureTables(), async (spied) => {
        if (raced || spied.op !== "insert" || !spied.tables.includes("blocks")) return
        raced = true
        await ref.write({ blocks: taken })
      })
      const logged = vi.spyOn(console, "error").mockImplementation(() => undefined)
      try {
        const args = { table: PROSPECTS.path, create_only: true, rows: [{ key: "Nouveau Prospect", set: { ville: proved("Valbrune") } }] }
        const output = await call(tableWrite, ref.identityOf("lea"), args, simulated)
        const current = { key: "Nouveau Prospect", revision: 1, set: { entreprise: "Nouveau Prospect", statut: "à traiter" } }
        expect(lines(output)[1]).toBe(
          `Nouveau Prospect: refused (conflict): a row with this key already exists (revision 1); nothing written (create_only). Current row: ${JSON.stringify(current)}. Pick another key, or write without create_only to update it.`,
        )
        expect(loggedText(logged)).toBe(`[platform] tables: write: create_only key taken meanwhile ${ref.nodeId(PROSPECTS.path)}#Nouveau Prospect`)
        // Une seule écriture tentée, l'insertion écartée : aucune mise à jour de la ligne prise.
        expect(blockWrites(simulated.calls).map((one) => one.op)).toEqual(["insert"])
        expect(await fixture.row("Nouveau Prospect")).toMatchObject({ revision: 1, data: { entreprise: "Nouveau Prospect", statut: "à traiter" } })
      } finally {
        logged.mockRestore()
      }
    })

    it("should store the host of the conversation, and the worker of the writer's own active lease only (AC-d2, AC-d3)", async () => {
      const simulated = await fixture.database()
      const claire = ref.identityOf("claire")
      const args = { table: PROSPECTS.path, rows: [{ key: "Atelier 10", set: { notes: proved("Relancer") } }, { key: "Atelier 2", set: { notes: proved("Relancer") } }] }
      await runFunction(tableWrite, { db: await clientOf(ref, claire, simulated), identity: claire, ctx: CTX, origin: ORIGIN, host: HOST }, args)
      const agent = { origin: "agent", by: PEOPLE.claire.id, ctx: CTX, at: expect.stringMatching(/Z$/), host: HOST, comment: PROOF }
      // Atelier 10 est sous le bail actif de Claire (claude-claire) : le travailleur suit ; Atelier 2, sans bail, n'en a pas.
      expect((await fixture.row("Atelier 10"))?.provenance).toHaveProperty("notes", { ...agent, worker: "claude-claire" })
      expect((await fixture.row("Atelier 2"))?.provenance).toHaveProperty("notes", agent)
      // Sans client connu, aucun `host` ; Scierie Vallon est au bail de Léa (claude-lea), expiré : aucun `worker`.
      await call(tableWrite, ref.identityOf("lea"), { table: PROSPECTS.path, rows: [{ key: "Scierie Vallon", set: { notes: proved("Relancer") } }] }, simulated)
      const lea = { origin: "agent", by: PEOPLE.lea.id, ctx: CTX, at: expect.stringMatching(/Z$/), comment: PROOF }
      expect((await fixture.row("Scierie Vallon"))?.provenance).toHaveProperty("notes", lea)
    })

    it("should write bare values on a table without proof, with an agent provenance, and leave a proved value sent back bare untouched (AC-f2)", async () => {
      await withoutProof(async () => {
        const simulated = await fixture.database()
        const lea = ref.identityOf("lea")
        const agent = { origin: "agent", by: PEOPLE.lea.id, ctx: CTX, at: expect.stringMatching(/Z$/) }
        const created = await call(tableWrite, lea, { table: PROSPECTS.path, rows: [{ key: "Boulangerie du Pont", set: { ville: "Valbrune" } }] }, simulated)
        expect(lines(created)[0]).toBe(SUMMARY_ONE_CREATED)
        expect((await fixture.row("Boulangerie du Pont"))?.provenance).toHaveProperty("ville", agent)
        const updated = await call(tableWrite, lea, { table: PROSPECTS.path, rows: [{ key: "Atelier 2", set: { ville: { value: "Coudray" } } }] }, simulated)
        expect(rowsOf(updated).map((row) => row.status)).toEqual(["updated"])
        const atelier = await fixture.row("Atelier 2")
        expect(atelier?.data).toHaveProperty("ville", "Coudray")
        // Sans commentaire ni lien : la provenance d'une valeur nue (§ Sécurité de la story).
        expect(atelier?.provenance).toHaveProperty("ville", agent)
        // Une valeur nue égale à la valeur prouvée rangée : ignorée, sa provenance (commentaire, lien, origine) intacte.
        const ecole = structuredClone(await fixture.row("École de Valbrune"))
        const same = await call(tableWrite, lea, { table: PROSPECTS.path, rows: [{ key: "École de Valbrune", set: { montant_estime: 10000 } }] }, simulated)
        expect(rowsOf(same).map((row) => row.status)).toEqual(["unchanged"])
        expect(await fixture.row("École de Valbrune")).toEqual(ecole)
      })
    })
  })
})
