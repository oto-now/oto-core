// @vitest-environment node
// La revue humaine sur une vraie base (E07-S03, AC11 à AC13 ; H99, H100, H123 ; E01-S10, lot t1-c1b :
// fixture d'E07-S01 semée par `seedTableFixture`, une graine pour le fichier, suite portable) : l'isolation seule y rend toute ligne de l'organisation ; `decideReview` décide avant de lire
// ou d'écrire la ligne, puis écrit une seule mise à jour gardée par `id`, `state`, la révision et l'état ;
// l'espion des requêtes (`spyDb`) montre ce qui part. Le tableau est remis à son état semé par
// `freshTable` ; décisions concurrentes jouées par `Promise.all`, changement d'une ligne entre la lecture
// et l'écriture par le crochet `meanwhile` de l'espion. La porte `POST tables/review` passe par
// `handlePlateforme`, ligne de journal relue par la connexion d'administration.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { handlePlateforme } from "@otomata_tech/oto_platform/api"
import type { PlatformDb } from "../../packages/plateforme/server/db"
import { decideReview } from "../../packages/plateforme/server/tables/review"
import { nodeId, ORG, PEOPLE, TEAMS } from "../helpers/reference-org"
import type { ReferenceOrgSql } from "../helpers/reference-org-sql"
import type { Row } from "../helpers/simulated-db"
import { spyDb, type DbCall } from "../helpers/spy-tables"
import { seedWithAdmin, type SeededData, sqlConfigured, portable } from "../helpers/sql"
import { PROSPECTS, TICKETS } from "../factories/table-fixture"
import { seedTableFixture } from "../factories/table-fixture-sql"
import { acmeIdentity, freshTable, tableRows } from "../factories/table-publish-sql"

const NETWORK_TIMEOUT = 60_000
const SETUP_TIMEOUT = 180_000

/** « Clinique des Saules » : à revoir, révision 1, provenance d'import sur `statut` ; sixième ligne de la fixture. */
const CLINIQUE = { table: PROSPECTS.path, key: "Clinique des Saules", revision: 1 }
const CLINIQUE_ID = `${nodeId(PROSPECTS.path)}:row:5`

const blockCalls = (calls: readonly DbCall[]) => calls.filter((one) => one.kind === "table" && one.table === "blocks")
const updates = (calls: readonly DbCall[]) => blockCalls(calls).filter((one) => one.kind === "table" && one.op === "update")

function refusal(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (reason: unknown) => reason,
  )
}

// La porte entière : jeton vérifié par le vérificateur injecté, identité par l'adresse, service réel ; le
// client qu'elle construit est celui de Léa, sous sa session (`base.db`, posé par le test de la porte).
const base = vi.hoisted((): { db: PlatformDb | null } => ({ db: null }))

vi.mock("../../packages/plateforme/server/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../packages/plateforme/server/db")>()
  // Hors de la porte, le client du paquet : la fixture en ouvre les sessions de ses personnes.
  return { ...original, createPlatformDb: vi.fn((options: Parameters<typeof original.createPlatformDb>[0]) => base.db ?? original.createPlatformDb(options)) }
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe.skipIf(!sqlConfigured)(portable("the human review of a table"), { timeout: NETWORK_TIMEOUT }, () => {
  let seed: SeededData
  let ref: ReferenceOrgSql

  beforeAll(async () => {
    seed = seedWithAdmin()
    ref = await seedTableFixture(seed)
  }, SETUP_TIMEOUT)

  afterAll(async () => {
    await seed?.cleanup()
  }, SETUP_TIMEOUT)

  /** La ligne `key` du tableau, telle que la base la garde. */
  const liveRow = async (key: string) => (await tableRows(seed, ref)).find((row) => row.key === key)
  const lea = () => acmeIdentity(ref, "lea")

  describe("decideReview, decision (AC11)", () => {
    it("should write the state in one update guarded by id, state, revision and expected state, with a human provenance and the next revision", async () => {
      await freshTable(seed, ref)
      const { db, calls } = spyDb(await ref.db("lea"))
      const approved = await decideReview(db, lea(), { ...CLINIQUE, decision: "approve", reason: "  Fiche vérifiée au téléphone.  " })

      expect(ref.readable(approved)).toEqual({ outcome: { outcome: "decided", key: "Clinique des Saules", state: "qualifié", revision: 2 }, target: PROSPECTS.path, teamId: TEAMS.ventes.id })
      const [update, ...others] = updates(calls)
      expect(others).toEqual([])
      // Ce qui garde la mise à jour : l'identifiant de la ligne, son état, la révision lue et l'état attendu.
      expect(update?.values.map(String)).toEqual(expect.arrayContaining([ref.id(CLINIQUE_ID), "published", "1", "à revoir"]))
      const row = await liveRow("Clinique des Saules")
      expect(row).toMatchObject({ revision: 2, updated_by: PEOPLE.lea.id, data: { statut: "qualifié", entreprise: "Clinique des Saules", notes: "Rappeler en octobre" } })
      expect(row?.provenance).toMatchObject({
        statut: { origin: "human", by: PEOPLE.lea.id, ctx: null, at: expect.stringMatching(/Z$/), comment: "Fiche vérifiée au téléphone." },
        notes: { origin: "agent" },
      })

      const rejected = await decideReview(db, lea(), { table: PROSPECTS.path, key: "École de Valbrune", revision: 2, decision: "reject" })
      expect(rejected.outcome).toEqual({ outcome: "decided", key: "École de Valbrune", state: "écarté", revision: 3 })
      const ecole = await liveRow("École de Valbrune")
      expect(ecole?.provenance).toMatchObject({ statut: { origin: "human", by: PEOPLE.lea.id } })
      // `provenance` d'une ligne relue est `unknown` : l'attente ci-dessus en a vérifié `statut`.
      expect(Object.keys((ecole?.provenance as { statut: object }).statut)).not.toContain("comment")
    })
  })

  describe("decideReview, row changed meanwhile (AC12)", () => {
    it("should skip without writing a row read at another revision or in another state", async () => {
      await freshTable(seed, ref)
      const { db, calls } = spyDb(await ref.db("lea"))
      const stale = await decideReview(db, lea(), { ...CLINIQUE, revision: 2, decision: "approve" })
      expect(stale.outcome).toEqual({ outcome: "skipped", key: "Clinique des Saules", currentState: "à revoir", currentRevision: 1 })
      const other = await decideReview(db, lea(), { table: PROSPECTS.path, key: "Atelier 2", revision: 1, decision: "approve" })
      expect(other.outcome).toEqual({ outcome: "skipped", key: "Atelier 2", currentState: "à traiter", currentRevision: 1 })
      expect(updates(calls)).toEqual([])
    })

    it("should read the row again and skip it when the guarded update writes nothing, and let only one of two decisions write", async () => {
      const logged = vi.spyOn(console, "error").mockImplementation(() => undefined)
      // Un assistant réserve la ligne entre la lecture et l'écriture : révision avancée, état « en cours ».
      const meanwhile = async (one: DbCall) => {
        if (one.kind !== "table" || one.table !== "blocks" || one.op !== "update") return
        await seed.admin`update platform.blocks set revision = 2, data = data || ${seed.admin.json({ statut: "en cours" })}
                          where node_id = ${ref.nodeId(PROSPECTS.path)} and state = 'published' and key = 'Clinique des Saules'`
      }
      await freshTable(seed, ref)
      const raced = await decideReview(spyDb(await ref.db("lea"), { meanwhile }).db, lea(), { ...CLINIQUE, decision: "approve" })
      expect(raced.outcome).toEqual({ outcome: "skipped", key: "Clinique des Saules", currentState: "en cours", currentRevision: 2 })
      expect(logged).toHaveBeenCalledWith("[platform] tables: review: no row written", `${ref.nodeId(PROSPECTS.path)}#Clinique des Saules`)

      await freshTable(seed, ref)
      const db = await ref.db("lea")
      const both = await Promise.all([decideReview(db, lea(), { ...CLINIQUE, decision: "approve" }), decideReview(db, lea(), { ...CLINIQUE, decision: "reject" })])
      expect(both.map((one) => one.outcome.outcome).sort()).toEqual(["decided", "skipped"])
      expect(await liveRow("Clinique des Saules")).toMatchObject({ revision: 2 })
    })
  })

  describe("decideReview, refusals decided by the service (AC13)", () => {
    it("should refuse a reader before any read or write of the row, although the base would accept the write", async () => {
      await freshTable(seed, ref, { rules: [{ node: PROSPECTS.path, user: "paul", level: "read" }] })
      const { db, calls } = spyDb(await ref.db("paul"))
      expect(await refusal(decideReview(db, acmeIdentity(ref, "paul"), { ...CLINIQUE, decision: "approve" }))).toMatchObject({
        code: "forbidden",
        message: expect.stringContaining("Writing ventes/suivi_prospects is reserved to team Ventes (lead: Claire Morel). You can read it: suggest the change"),
      })
      expect(blockCalls(calls)).toEqual([])
      expect(await liveRow("Clinique des Saules")).toMatchObject({ revision: 1, data: { statut: "à revoir" } })
    })

    it("should answer not_found for a table of level 0 that the base returns, and for a row gone, without reading the row of the first", async () => {
      await freshTable(seed, ref)
      const hidden = spyDb(await ref.db("marc"))
      expect(await refusal(decideReview(hidden.db, acmeIdentity(ref, "marc"), { ...CLINIQUE, decision: "approve" }))).toMatchObject({ code: "not_found" })
      expect(blockCalls(hidden.calls)).toEqual([])
      expect(await refusal(decideReview(await ref.db("lea"), lea(), { ...CLINIQUE, key: "Clinique des Pins", decision: "approve" }))).toMatchObject({
        code: "not_found",
        message: "Row Clinique des Pins no longer exists in ventes/suivi_prospects.",
      })
    })

    it("should answer invalid_arguments for a table without review, an unknown decision or a reason of more than 500 characters", async () => {
      const tickets = await refusal(decideReview(await ref.db("paul"), acmeIdentity(ref, "paul"), { table: TICKETS.path, key: "12", revision: 1, decision: "approve" }))
      expect(tickets).toMatchObject({ code: "invalid_arguments", message: "Table support/tickets has no review queue (no lifecycle.review in its header)." })
      const { db, calls } = spyDb(await ref.db("lea"))
      for (const invalid of [{ ...CLINIQUE, decision: "qualify" }, { ...CLINIQUE, decision: "approve", reason: "x".repeat(501) }]) {
        expect(await refusal(decideReview(db, lea(), invalid))).toMatchObject({ code: "invalid_arguments" })
      }
      expect(calls).toEqual([])
    })
  })

  describe("POST /api/platform/tables/review (AC11)", () => {
    it("should answer the outcome and journal POST tables/review on the table, with its team and the key and decision", async () => {
      await freshTable(seed, ref)
      const tasks: (() => Promise<void>)[] = []
      const request = new Request(`https://${ref.org.host}/api/platform/tables/review`, {
        method: "POST",
        body: JSON.stringify({ ...CLINIQUE, decision: "approve" }),
        headers: { "x-forwarded-proto": "https", origin: `https://${ref.org.host}`, "content-type": "application/json" },
      })
      const verifyToken = async () => ({ token: "token", clientId: "", scopes: [], extra: { sub: ref.people.lea.id, email: ref.people.lea.email } })
      base.db = await ref.db("lea")
      try {
        const response = await handlePlateforme(request, { accessToken: "token", host: ref.org.host, defer: (task) => tasks.push(task), verifyToken })
        for (const task of tasks) await task()
        expect([response.status, await response.json()]).toEqual([200, { data: { outcome: "decided", key: "Clinique des Saules", state: "qualifié", revision: 2 } }])
      } finally {
        base.db = null
      }
      const lines = await seed.admin<Row[]>`
        select org_id, user_id, method, tool, target, team_id, is_error, args from platform.journal
         where org_id = ${ref.org.id} and tool = 'POST tables/review'`
      expect(ref.readable([...lines])).toMatchObject([
        { org_id: ORG.id, user_id: PEOPLE.lea.id, method: "api", tool: "POST tables/review", target: PROSPECTS.path, team_id: TEAMS.ventes.id, is_error: false, args: { key: "Clinique des Saules", decision: "approve" } },
      ])
    })
  })
})
