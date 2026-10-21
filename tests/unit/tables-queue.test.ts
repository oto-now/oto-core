// @vitest-environment node
// File de travail sur une vraie base (E07-S02, AC20 à AC25 ; H98, N10 à N14) : `table.claim` et
// `table.release` sur la fixture d'E07-S01. Baux actifs et expirés semés (jamais d'attente réelle) ;
// réservations concurrentes jouées par `Promise.all`, retenues jusqu'à ce qu'elles se croisent
// (`crossing`), départagées par la garde de révision. Textes servis au modèle comparés mot pour mot (H04).
// Réécrit sur base réelle par E01-S10 (lot t1-c1a, fiche D76 A) : une graine par fichier
// (`seedTableFixture`), les lignes de chaque base simulée posées par `fixtureRows`, relues par la
// connexion d'administration ; l'écriture concurrente de la base simulée passe par la connexion
// d'administration, juste avant la mise à jour du service (`bumpBeforeUpdate`).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { isRecord } from "../../packages/plateforme/schemas/tables"
import type { CatalogFunction, FunctionOutput } from "../../packages/plateforme/server/catalog/define"
import type { Identity } from "../../packages/plateforme/server/identity"
import { tableClaim } from "../../packages/plateforme/server/tables/claim"
import { tableRelease } from "../../packages/plateforme/server/tables/release"
import { tableWrite } from "../../packages/plateforme/server/tables/write"
import { nodeId, PEOPLE } from "../helpers/reference-org"
import type { ReferenceOrgSql } from "../helpers/reference-org-sql"
import type { Row, Tables } from "../helpers/simulated-db"
import { dbSpy, type DbSpy } from "../helpers/spy-t1-c1a"
import { sqlConfigured, seedWithAdmin, type SeededData, portable } from "../helpers/sql"
import { fixtureTables, LEASE_ACTIVE, LEASE_EXPIRED, manyRows, PROSPECTS, rowBlocks, runFunction, TICKETS } from "../factories/table-fixture"
import { seedTableFixture } from "../factories/table-fixture-sql"
import { BIG_TABLE_TIMEOUT, CASE_TIMEOUT, clientOf, crossing, fixtureRows, SEED_TIMEOUT, type FixtureRows } from "../factories/table-rows-sql"

const CTX = "WXYZ-2345"
/** Le tableau des prospects dans la base simulée, dont les variantes ci-dessous retouchent les lignes. */
const TABLE_ID = nodeId(PROSPECTS.path)
const RELEASE_TO = "à traiter, à revoir"

const claimed = (output: FunctionOutput): unknown[] => (Array.isArray(output.data?.claimed) ? output.data.claimed.map((row) => row.key) : [])

/** La fixture, des lignes des prospects retouchées par clé ; `data` fusionné avec celui de la ligne. */
function prospects(changes: Record<string, Partial<Row>>): Tables {
  const tables = fixtureTables()
  for (const block of tables.blocks) {
    const change = block.node_id === TABLE_ID ? changes[String(block.key)] : undefined
    if (!change) continue
    const data = { ...(isRecord(block.data) ? block.data : {}), ...(isRecord(change.data) ? change.data : {}) }
    Object.assign(block, change, { data })
  }
  return tables
}

/** Une ligne sous le bail de `holder`, à l'état de travail. */
function leased(worker: string, holder: string, until = LEASE_ACTIVE): Partial<Row> {
  return { claimed_by: worker, claimed_by_user: holder, lease_until: until, data: { statut: "en cours" } }
}

/** La Mairie de Valbrune, tenue par Claire (claude-claire), révision 4. */
function withMairie(until = LEASE_ACTIVE): Tables {
  const tables = fixtureTables()
  const [mairie] = rowBlocks(TABLE_ID, [
    {
      key: "Mairie de Valbrune",
      data: { entreprise: "Mairie de Valbrune", ville: "Valbrune", statut: "en cours" },
      provenance: {},
      revision: 4,
      claimed_by: "claude-claire",
      claimed_by_user: PEOPLE.claire.id,
      lease_until: until,
    },
  ])
  tables.blocks.push({ ...mairie, id: "node:ventes/suivi_prospects:row:mairie" })
  return tables
}

describe.skipIf(!sqlConfigured)(portable("work queue on a real database"), { timeout: CASE_TIMEOUT }, () => {
  let seed: SeededData
  let ref: ReferenceOrgSql
  let fixture: FixtureRows
  let CLAIRE: Identity
  let LEA: Identity

  beforeAll(async () => {
    seed = seedWithAdmin()
    ref = await seedTableFixture(seed)
    fixture = fixtureRows(seed, ref)
    CLAIRE = ref.identityOf("claire")
    LEA = ref.identityOf("lea")
  }, SEED_TIMEOUT)

  afterAll(async () => {
    await seed?.cleanup()
  }, SEED_TIMEOUT)

  async function call(fn: CatalogFunction, identity: Identity, args: Record<string, unknown>, simulated: DbSpy): Promise<FunctionOutput> {
    return runFunction(fn, { db: await clientOf(ref, identity, simulated), identity, ctx: CTX, origin: "https://acme.test" }, { table: PROSPECTS.path, ...args })
  }

  function refusal(fn: CatalogFunction, identity: Identity, args: Record<string, unknown>, simulated: DbSpy): Promise<unknown> {
    return call(fn, identity, args, simulated).then(
      () => null,
      (reason: unknown) => reason,
    )
  }

  describe("table.claim", () => {
    it("should claim expired leases first, then the longest waiting rows, then by key, under a lease of the worker and the person; filter narrows (AC20)", async () => {
      const waiting = { "Pharmacie du Port": "01", "Boulangerie Fournier": "02", "Atelier 2": "03", "Brasserie de la Lise": "04", "Camping Les Pins": "05", "Ferme du Coudray": "06", "Scierie Vallon": "09" }
      const tables = prospects(Object.fromEntries(Object.entries(waiting).map(([key, day]) => [key, { updated_at: `2026-09-${day}T08:00:00.000Z` }])))
      const simulated = await fixture.database(tables)
      const before = Date.now()
      const output = await call(tableClaim, CLAIRE, { worker: "claude-claire", limit: 3 }, simulated)
      const until = String(output.data?.until)
      expect(Date.parse(until) - before).toBeGreaterThanOrEqual(15 * 60_000)
      expect(Date.parse(until) - Date.now()).toBeLessThanOrEqual(15 * 60_000)
      expect(claimed(output)).toEqual(["Scierie Vallon", "Pharmacie du Port", "Boulangerie Fournier"])
      const rows = Array.isArray(output.data?.claimed) ? output.data.claimed : []
      expect(output.text.split("\n")).toEqual([
        `Claimed 3 row(s) for claude-claire until ${until.slice(11, 16)} UTC:`,
        ...rows.map((row) => JSON.stringify(row)),
        "Release each one with table.release when done.",
        // Restent « à traiter » Atelier 2, Brasserie, Camping et Ferme ; ni Atelier 10, sous un bail actif, ni les lignes « à revoir » (M53).
        "Left in the queue: 4 row(s) to process.",
      ])
      expect(output.data).toMatchObject({ table: PROSPECTS.path, worker: "claude-claire", until, left: 4 })
      expect(await fixture.row("Pharmacie du Port")).toMatchObject({
        data: { statut: "en cours" },
        claimed_by: "claude-claire",
        claimed_by_user: PEOPLE.claire.id,
        lease_until: until,
        revision: 2,
        provenance: { statut: { origin: "agent", by: PEOPLE.claire.id, ctx: CTX, at: expect.stringMatching(/Z$/), claim_revision: 2 } },
      })
      expect(await fixture.row("Scierie Vallon")).toMatchObject({ claimed_by: "claude-claire", claimed_by_user: PEOPLE.claire.id, revision: 6 })

      const valbrune = await call(tableClaim, CLAIRE, { worker: "claude-claire", limit: 5, filter: { ville: "Valbrune" } }, await fixture.database())
      expect(claimed(valbrune)).toEqual(["Atelier 2", "Boulangerie Fournier"])
      // Toute la file, hors filtre : les quatre autres « à traiter » et Scierie Vallon, dont le bail est passé.
      expect(valbrune.data?.left).toBe(5)
      const paul = await refusal(tableClaim, ref.identityOf("paul"), { table: TICKETS.path, worker: "claude-paul" }, await fixture.database())
      expect(paul).toMatchObject({ code: "invalid_arguments", message: "Table support/tickets has no work queue (no lifecycle): table.claim does not apply." })
    })

    // Story widgets-dans-la-conversation : une ligne réservée se lit comme une fiche ; plusieurs, en texte seul.
    it("should name the record view for one claimed row only", async () => {
      const one = await call(tableClaim, CLAIRE, { worker: "claude-claire", limit: 1 }, await fixture.database(prospects({})))
      const two = await call(tableClaim, CLAIRE, { worker: "claude-claire", limit: 2 }, await fixture.database(prospects({})))
      expect([claimed(one).length, one.view, claimed(two).length, two.view]).toEqual([1, "record", 2, undefined])
    })

    it("should reach with a filter a waiting row beyond the first page of candidates, and refuse a filter on more than 5,000 rows (AC20, N14)", { timeout: BIG_TABLE_TIMEOUT }, async () => {
      // `count` prospects « à traiter » ; le dernier dans l'ordre de la file, seul à Port-Lise.
      const waiting = (count: number) =>
        manyRows(count, (index) => ({ entreprise: `Prospect ${String(index + 1).padStart(4, "0")}`, ville: index === count - 1 ? "Port-Lise" : "Valbrune", statut: "à traiter" }))
      const port = await call(tableClaim, CLAIRE, { worker: "claude-claire", filter: { ville: "Port-Lise" } }, await fixture.database(fixtureTables([], waiting(1_001))))
      expect(claimed(port)).toEqual(["Prospect 1001"])
      const refused = await refusal(tableClaim, CLAIRE, { worker: "claude-claire", filter: { ville: "Port-Lise" } }, await fixture.database(fixtureTables([], waiting(5_001))))
      expect(refused).toMatchObject({ code: "too_large" })
    })

    it("should bound limit, lease and worker by the schema, refuse a sixth lease of a worker, and serve the rest of the quota with a note (AC21)", async () => {
      const parse = (args: Record<string, unknown>) => tableClaim.schema.safeParse({ table: PROSPECTS.path, worker: "claude-claire", ...args }).success
      expect([parse({ limit: 5 }), parse({ limit: 6 }), parse({ lease_minutes: 60 }), parse({ lease_minutes: 61 })]).toEqual([true, false, true, false])
      expect(["", "   ", "x".repeat(40), "x".repeat(41)].map((worker) => parse({ worker }))).toEqual([false, false, true, false])

      // Atelier 10 est déjà tenu par Claire (claude-claire) : quatre de plus font cinq baux.
      const five = prospects(Object.fromEntries(["Atelier 2", "Boulangerie Fournier", "Brasserie de la Lise", "Camping Les Pins"].map((key) => [key, leased("claude-claire", PEOPLE.claire.id)])))
      expect(await refusal(tableClaim, CLAIRE, { worker: "claude-claire" }, await fixture.database(five))).toMatchObject({
        code: "conflict",
        message: "Worker claude-claire already holds 5 leases on ventes/suivi_prospects (the maximum): release some before claiming more.",
      })
      // Trois baux de Claire sous claude-claire ; ceux de Léa sous ce libellé et de Claire sous un autre ne comptent pas (H98 : ni le seul libellé, ni la seule personne).
      const three = prospects({
        ...Object.fromEntries(["Atelier 2", "Boulangerie Fournier"].map((key) => [key, leased("claude-claire", PEOPLE.claire.id)])),
        "Brasserie de la Lise": leased("claude-claire", PEOPLE.lea.id),
        "Camping Les Pins": leased("claude-bis", PEOPLE.claire.id),
      })
      const output = await call(tableClaim, CLAIRE, { worker: "claude-claire", limit: 5 }, await fixture.database(three))
      expect(claimed(output)).toHaveLength(2)
      expect(output.text.split("\n").at(-1)).toBe("2 of 5 requested: worker claude-claire may hold 5 leases on this table.")
    })

    it("should never give the same row to two claims running at once, and answer an empty queue without error (AC22)", async () => {
      const all = Object.fromEntries(fixtureTables().blocks.filter((block) => block.node_id === TABLE_ID).map((block) => [String(block.key), { claimed_by: null, claimed_by_user: null, lease_until: null, data: { statut: "à traiter" } }]))
      // Le client de Léa ouvert avant la course (son compte naît au premier), et la première mise à jour
      // de chaque réservation retenue jusqu'à ce que les trois partent ensemble, sur la même ligne.
      await clientOf(ref, LEA)
      const simulated = await fixture.database(prospects(all), crossing(3, "update"))
      const outputs = await Promise.all([
        call(tableClaim, CLAIRE, { worker: "w1", limit: 2 }, simulated),
        call(tableClaim, LEA, { worker: "w2", limit: 2 }, simulated),
        call(tableClaim, CLAIRE, { worker: "w3", limit: 2 }, simulated),
      ])
      const keys = outputs.flatMap(claimed)
      expect([keys.length, new Set(keys).size]).toEqual([6, 6])

      const done = Object.fromEntries(Object.keys(all).map((key) => [key, { claimed_by: null, claimed_by_user: null, lease_until: null, data: { statut: "à revoir" } }]))
      const empty = await call(tableClaim, CLAIRE, { worker: "claude-claire", limit: 3 }, await fixture.database(prospects(done)))
      expect([empty.text, empty.data?.claimed]).toEqual(["No row « à traiter » left to claim in ventes/suivi_prospects.", []])
    })

    it("should pass over a row that an open table.write still holds, never waiting for it (M32)", async () => {
      // Deux lignes à traiter, les autres hors de la file. L'écriture de Léa tient « Atelier 2 » (mise à jour
      // faite, transaction ouverte) et attend, avant d'écrire « Camping Les Pins », que la réservation de
      // Claire finisse ; celle-ci ne réserve qu'une fois « Atelier 2 » tenue. Attendre « Atelier 2 »
      // l'interbloquerait avec l'écriture, qui attend « Camping Les Pins » (délai de verrou, puis panne).
      const queue = Object.fromEntries(
        fixtureTables()
          .blocks.filter((block) => block.node_id === TABLE_ID)
          .map((block) => [String(block.key), { claimed_by: null, claimed_by_user: null, lease_until: null, data: { statut: "à revoir" } }]),
      )
      for (const key of ["Atelier 2", "Camping Les Pins"]) queue[key] = { ...queue[key], data: { statut: "à traiter" } }
      await Promise.all([clientOf(ref, CLAIRE), clientOf(ref, LEA)])
      let hold = () => {}
      const held = new Promise<void>((resolve) => (hold = resolve))
      const running: { claim?: Promise<FunctionOutput> } = {}
      let updates = 0
      const writing = await fixture.database(prospects(queue), async (spied) => {
        if (spied.op !== "update" || !spied.tables.includes("blocks") || ++updates !== 2) return
        hold()
        await running.claim?.catch(() => undefined)
      })
      let started = false
      const queued = dbSpy(async (spied) => {
        if (started || spied.op !== "update" || !spied.tables.includes("blocks")) return
        started = true
        await held
      })
      const claiming = call(tableClaim, CLAIRE, { worker: "w-m32", limit: 2 }, queued)
      running.claim = claiming
      const note = { value: "M32", comment: "Course du lot" }
      const rows = [{ key: "Atelier 2", set: { notes: note } }, { key: "Camping Les Pins", set: { notes: note } }]
      const [written, claim] = await Promise.all([call(tableWrite, LEA, { rows }, writing), claiming])

      expect(claimed(claim)).toEqual(["Camping Les Pins"])
      expect(written.text.split("\n").slice(1)).toEqual([
        expect.stringMatching(/^Atelier 2: updated \(revision \d+\): set notes\.$/),
        expect.stringMatching(/^Camping Les Pins: claimed by Claire Morel \(worker w-m32\) until \d\d:\d\d UTC; nothing written\./),
      ])
    })

    it("should give a row whose lease expired to another worker, whose former holder can no longer release it (AC23)", async () => {
      const simulated = await fixture.database()
      const output = await call(tableClaim, CLAIRE, { worker: "claude-claire", limit: 1 }, simulated)
      expect(claimed(output)).toEqual(["Scierie Vallon"])
      expect(await refusal(tableRelease, LEA, { key: "Scierie Vallon", worker: "claude-lea", state: "à revoir" }, simulated)).toMatchObject({
        code: "conflict",
        message: "Scierie Vallon is claimed by claude-claire (Claire Morel), not claude-lea (Léa Roux).",
      })
    })
  })

  describe("table.release", () => {
    it("should release by the same person and worker, and refuse another holder, a reserved or unknown state, an unknown row, a row changed meanwhile (AC24)", async () => {
      const simulated = await fixture.database(withMairie())
      const released = await call(tableRelease, CLAIRE, { key: "Mairie de Valbrune", worker: "claude-claire", state: "à revoir" }, simulated)
      expect(released.text).toBe("Mairie de Valbrune released → « à revoir » (revision 5).")
      expect(await fixture.row("Mairie de Valbrune")).toMatchObject({
        data: { statut: "à revoir" },
        claimed_by: null,
        claimed_by_user: null,
        lease_until: null,
        revision: 5,
        provenance: { statut: { origin: "agent", by: PEOPLE.claire.id, ctx: CTX, at: expect.stringMatching(/Z$/) } },
      })

      // Les refus n'écrivent rien : ils partagent la Mairie posée de nouveau.
      await fixture.database(withMairie())
      const refused = (identity: Identity, args: Record<string, unknown>) => refusal(tableRelease, identity, { key: "Mairie de Valbrune", worker: "claude-claire", ...args }, dbSpy())
      expect(await refused(LEA, {})).toMatchObject({ code: "conflict", message: "Mairie de Valbrune is claimed by claude-claire (Claire Morel), not claude-claire (Léa Roux)." })
      expect(await refused(CLAIRE, { worker: "claude-bis" })).toMatchObject({ code: "conflict", message: "Mairie de Valbrune is claimed by claude-claire (Claire Morel), not claude-bis (Claire Morel)." })
      expect(await refused(CLAIRE, { state: "en cours" })).toMatchObject({ code: "invalid_arguments", message: `« en cours » is set by table.claim, with a lease; release to another state: ${RELEASE_TO}.` })
      expect(await refused(CLAIRE, { state: "qualifié" })).toMatchObject({ code: "invalid_arguments", message: `« qualifié » and « écarté » are decided by a person in the review queue; release to: ${RELEASE_TO}.` })
      expect(await refused(CLAIRE, { state: "gagné" })).toMatchObject({ code: "invalid_arguments", message: `Unknown state gagné. States you can release to: ${RELEASE_TO}.` })
      expect(await refused(CLAIRE, { key: "Mairie de Valbrun" })).toMatchObject({ code: "not_found", message: "Unknown row Mairie de Valbrun in ventes/suivi_prospects." })

      const logged = vi.spyOn(console, "error").mockImplementation(() => undefined)
      const raced = await refusal(tableRelease, CLAIRE, { key: "Mairie de Valbrune", worker: "claude-claire" }, await fixture.database(withMairie(), fixture.bumpBeforeUpdate))
      expect(raced).toMatchObject({ code: "conflict", message: "Mairie de Valbrune changed meanwhile (another worker may hold it now): read it with table.rows." })
      expect(logged).toHaveBeenCalledWith("[platform] tables: release: no row written", `${ref.nodeId(PROSPECTS.path)}#Mairie de Valbrune`)
      logged.mockRestore()

      const free = await call(tableRelease, CLAIRE, { key: "Atelier 2", worker: "claude-claire" }, await fixture.database())
      expect(free.text).toBe("Atelier 2 is not claimed: nothing to release. This is not a failure.")
      const expired = await call(tableRelease, CLAIRE, { key: "Mairie de Valbrune", worker: "claude-claire", state: "à revoir" }, await fixture.database(withMairie(LEASE_EXPIRED)))
      expect(expired.text).toBe("Mairie de Valbrune released → « à revoir » (revision 5).")
    })

    it("should say when a row goes back to the first state unchanged since its claim, and not when it was written (AC25)", async () => {
      const note = "Note: Atelier 2 goes back to « à traiter » unchanged; a claim with the same filter will serve it again. Release it to another state if you are done with it."
      const idle = await fixture.database()
      await call(tableClaim, CLAIRE, { worker: "claude-claire", filter: { entreprise: "Atelier 2" } }, idle)
      const back = await call(tableRelease, CLAIRE, { key: "Atelier 2", worker: "claude-claire" }, idle)
      expect(back.text.split("\n")).toEqual(["Atelier 2 released → « à traiter » (revision 3).", note])

      const worked = await fixture.database()
      await call(tableClaim, CLAIRE, { worker: "claude-claire", filter: { entreprise: "Atelier 2" } }, worked)
      await call(tableWrite, CLAIRE, { rows: [{ key: "Atelier 2", set: { notes: { value: "Pas de réponse", comment: "Appel du jour" } } }] }, worked)
      const after = await call(tableRelease, CLAIRE, { key: "Atelier 2", worker: "claude-claire" }, worked)
      expect(after.text).toBe("Atelier 2 released → « à traiter » (revision 4).")
    })
  })

  describe("E11-S01: host and worker, decisions by the assistant", () => {
    const HOST = "claude-ai@0.1.0"
    const decided = { origin: "agent", by: PEOPLE.claire.id, ctx: CTX, at: expect.stringMatching(/Z$/), host: HOST, worker: "claude-claire" }

    async function withHost(fn: CatalogFunction, identity: Identity, args: Record<string, unknown>, simulated: DbSpy): Promise<FunctionOutput> {
      return runFunction(fn, { db: await clientOf(ref, identity, simulated), identity, ctx: CTX, origin: "https://acme.test", host: HOST }, { table: PROSPECTS.path, ...args })
    }

    /** La revue des prospects confiée aussi à l'assistant, le temps d'un cas (`agents_may_decide`, AC-e1). */
    async function lettingAgentsDecide(run: () => Promise<void>): Promise<void> {
      const id = ref.nodeId(PROSPECTS.path)
      await seed.admin`update platform.nodes set meta = jsonb_set(meta, '{lifecycle,review,agents_may_decide}', 'true'::jsonb) where id = ${id}`
      try {
        await run()
      } finally {
        await seed.admin`update platform.nodes set meta = meta #- '{lifecycle,review,agents_may_decide}' where id = ${id}`
      }
    }

    it("should store the host and the worker in the provenance of the state that table.claim and table.release set (AC-d2, AC-d3)", async () => {
      const simulated = await fixture.database()
      await withHost(tableClaim, CLAIRE, { worker: "claude-claire", filter: { entreprise: "Atelier 2" } }, simulated)
      expect((await fixture.row("Atelier 2"))?.provenance).toHaveProperty("statut", { ...decided, claim_revision: 2 })
      await withHost(tableRelease, CLAIRE, { key: "Atelier 2", worker: "claude-claire", state: "à revoir" }, simulated)
      expect((await fixture.row("Atelier 2"))?.provenance).toHaveProperty("statut", decided)
    })

    it("should let an assistant set a decision with table.release or table.write on a table that allows it, traced with origin agent (AC-e2)", async () => {
      await lettingAgentsDecide(async () => {
        const simulated = await fixture.database(withMairie())
        const released = await withHost(tableRelease, CLAIRE, { key: "Mairie de Valbrune", worker: "claude-claire", state: "qualifié" }, simulated)
        expect(released.text).toBe("Mairie de Valbrune released → « qualifié » (revision 5).")
        expect((await fixture.row("Mairie de Valbrune"))?.provenance).toHaveProperty("statut", decided)
        // Nue, comme tout état permis : la colonne d'état n'a pas de preuve.
        await call(tableWrite, LEA, { rows: [{ key: "Boulangerie Fournier", set: { statut: "écarté" } }] }, simulated)
        const fournier = await fixture.row("Boulangerie Fournier")
        expect(fournier?.data).toHaveProperty("statut", "écarté")
        expect(fournier?.provenance).toHaveProperty("statut", { origin: "agent", by: PEOPLE.lea.id, ctx: CTX, at: expect.stringMatching(/Z$/) })
      })
    })
  })
})
