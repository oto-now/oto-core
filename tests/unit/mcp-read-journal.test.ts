// @vitest-environment node
// `<préfixe>_read {path: "journal"}` par la porte MCP (E05-S05 : AC9 à AC13), sur une base réelle (E01-S10,
// lot t1-e2a) : l'organisation O de la fixture (`seedReferenceOrg`), le vrai SDK par InMemoryTransport, la
// garde `ctx`, le formateur unique et le journal de la porte. Les textes servis sont comparés à l'octet par
// `journal-render.test.ts` ; ici, leurs trois formes, la parité des deux canaux, les données en champs, les
// refus, la réservation du chemin et la ligne que la lecture laisse au journal. Les outils portent le préfixe
// jetable de O, et un code de conversation sa valeur tirée (`ref.id`). En suite portable (`sqlConfigured`) : le projet, ou le Postgres nu du job `bare-postgres`.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { writeJournal } from "../../packages/plateforme/server/journal"
import { connectDeps } from "../helpers/mcp"
import { ORG, PEOPLE, TEAMS, type Person } from "../helpers/reference-org"
import { seedReferenceOrg, type ReferenceOrgSql } from "../helpers/reference-org-sql"
import type { Row } from "../helpers/simulated-db"
import { seedWithAdmin, spyRequests, sqlConfigured, type SeededData, portable } from "../helpers/sql"

const NOW = new Date("2026-09-23T15:00:00.000Z")
const SESSION = "SESS-0001"
/** `minutes` avant `NOW`, comme la base rend un `timestamptz` (UTC, sans fraction nulle). */
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString().replace(".000Z", "+00:00")

const NETWORK_TIMEOUT = 60_000
const SETUP_TIMEOUT = 180_000

let seed: SeededData
let ref: ReferenceOrgSql

function line(ctx: string, person: Person, fields: Row): Row {
  return {
    ts: minutesAgo(60),
    org_id: ORG.id,
    user_id: PEOPLE[person].id,
    team_id: null,
    account_id: null,
    ctx,
    method: "tools/call",
    tool: `${ref.org.prefix}_context`,
    target: null,
    args: {},
    is_error: false,
    error: null,
    duration_ms: 120,
    host: "claude-ai@0.1.0",
    user_agent: "Claude-User",
    ...fields,
  }
}

/** Claire (responsable de Ventes) : une conversation de la veille au soir, une d'il y a trois jours ; Paul (Support) : une d'aujourd'hui. */
function journalRows(): Row[] {
  return [
    line("K7M2-9QXR", "claire", { ts: minutesAgo(120), target: "ventes/qualifier_prospects" }),
    line("K7M2-9QXR", "claire", {
      ts: minutesAgo(118),
      tool: `${ref.org.prefix}_call`,
      target: "table.write",
      team_id: TEAMS.ventes.id,
      is_error: true,
      error: "invalid_arguments: Unknown column « statut ».",
      args: { function: "table.write", arguments: { api_token: "demo-secret" } },
    }),
    line("OLD1-0001", "claire", { ts: minutesAgo(3 * 24 * 60) }),
    line("PAU1-0001", "paul", { ts: minutesAgo(30) }),
  ]
}

/** Une session MCP de Claire sur son client de la base, espionné. */
async function session() {
  const claire = ref.identityOf("claire")
  const spy = spyRequests(await ref.db("claire"))
  const mcp = await connectDeps({ db: spy.db, org: claire.org, caller: { kind: "member", identity: claire }, userAgent: "unit-test", journal: [], activeConnectors: () => Promise.resolve(new Set<string>()), adoptedConnectors: () => Promise.resolve(new Set<string>()), origin: `https://${ref.org.host}` })
  return { ...mcp, requests: spy.requests }
}

/** Les nœuds de O, relus tels qu'ils sont en base. */
async function nodes(): Promise<Row[]> {
  return [...(await seed.admin<Row[]>`select * from platform.nodes where org_id = ${ref.org.id} order by id`)]
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

describe.skipIf(!sqlConfigured)(portable("acme_read journal through MCP on a real database (E01-S10 t1)"), { timeout: NETWORK_TIMEOUT }, () => {
  beforeAll(async () => {
    seed = seedWithAdmin()
    ref = await seedReferenceOrg(seed, { nodes: [{ path: "ventes/qualifier_prospects", kind: "procedure", title: "Qualifier les prospects" }] })
    // La conversation en cours de Claire, émise sous la version des règles de O.
    await ref.write({
      orgs: [{ id: ORG.id, rules_version: 1 }],
      ctx: [{ code: SESSION, org_id: ORG.id, user_id: PEOPLE.claire.id, rules_version: 1, host: "claude-ai@0.1.0" }],
    })
  }, SETUP_TIMEOUT)

  afterAll(async () => {
    await seed?.cleanup()
  }, SETUP_TIMEOUT)

  // Chaque test part des lignes de journal de O, et d'elles seules.
  beforeEach(async () => {
    await seed.admin`delete from platform.journal where org_id = ${ref.org.id}`
    await ref.write({ journal: journalRows() })
  })

  describe("acme_read journal through MCP (AC9, AC10)", () => {
    it("should serve today without a section, the week, and a conversation, the same text in both channels with the data in fields", async () => {
      const mcp = await session()
      const code = ref.id(SESSION)
      const today = await mcp.call("read", { ctx: code, path: "journal" })
      const week = await mcp.call("read", { ctx: code, path: "journal", section: "week" })
      const conversation = await mcp.call("read", { ctx: code, path: "journal", section: ref.id("K7M2-9QXR").toLowerCase() })

      for (const served of [today, week, conversation]) {
        expect(served.isError).toBe(false)
        expect(served.result.structuredContent).toMatchObject({ text: served.text })
      }
      expect(today.text.split("\n").slice(0, 3)).toEqual([
        "# Journal — last 24 hours",
        "Scope: your calls and the calls of team Ventes.",
        "1 conversation, 2 calls, 1 with errors. Most recent first.",
      ])
      // Paul n'est pas dans la portée de Claire ; la conversation d'il y a trois jours est dans la semaine.
      expect(ref.readable(today.result.structuredContent)).toMatchObject({
        section: "today",
        conversations: [{ ctx: "K7M2-9QXR", procedure: "ventes/qualifier_prospects" }],
        next_actions: [`${ref.org.prefix}_read`],
      })
      expect(ref.readable(week.result.structuredContent)).toMatchObject({ section: "week", conversations: [{ ctx: "K7M2-9QXR" }, { ctx: "OLD1-0001" }] })
      expect(conversation.text.split("\n")[0]).toBe(`# Conversation ${ref.id("K7M2-9QXR")}`)
      // Les arguments d'une ligne écrite hors de `writeJournal` sont masqués à la lecture (AC8).
      expect(conversation.text).not.toContain("demo-secret")
      expect(ref.readable(conversation.result.structuredContent)).toMatchObject({
        conversation: { ctx: "K7M2-9QXR", calls: 2, errors: 1 },
        calls: [{ rank: 1, tool: "context" }, { rank: 2, tool: "call", team: "Ventes", is_error: true, args: { arguments: { api_token: "[masked]" } } }],
      })
    })
  })

  describe("acme_read journal refusals (AC11)", () => {
    it("should answer an unknown section and a conversation out of scope alike, refuse revisions, drafts and a stale cursor, and keep the ctx guard", async () => {
      const mcp = await session()
      const refused = async (args: Record<string, unknown>) => {
        const answer = await mcp.call("read", { ctx: ref.id(SESSION), path: "journal", ...args })
        return [answer.isError, answer.text]
      }
      const sections = "Sections: today, week, or a conversation code (XXXX-XXXX)."
      const paul = ref.id("PAU1-0001")
      const k7 = ref.id("K7M2-9QXR")
      expect(await refused({ section: "month" })).toEqual([true, `Unknown section «month» in journal. ${sections}`])
      expect(await refused({ section: paul })).toEqual([true, `Unknown section «${paul}» in journal. ${sections}`])
      expect(await refused({ since_revision: 2 })).toEqual([true, "journal has no revisions or drafts."])
      expect(await refused({ draft: true })).toEqual([true, "journal has no revisions or drafts."])
      // Un curseur illisible, ou d'une autre lecture, n'est jamais servi comme la suite (HN-E05S05-12).
      const stale = (section: string) => `This cursor no longer matches journal ${section}: read again without cursor.`
      expect(await refused({ section: "today", cursor: "not-a-cursor" })).toEqual([true, stale("today")])
      expect(await refused({ section: k7, cursor: "not-a-cursor" })).toEqual([true, stale(k7)])
      expect(mcp.journal.slice(-6).map((entry) => entry.error?.split(":")[0])).toEqual([
        "not_found",
        "not_found",
        "invalid_arguments",
        "invalid_arguments",
        "invalid_arguments",
        "invalid_arguments",
      ])

      const missing = await mcp.call("read", { path: "journal" })
      expect([missing.isError, missing.text]).toEqual([true, `Missing or unknown ctx. Call ${ref.org.prefix}_context first and pass its ctx code.`])
    })
  })

  describe("acme_write on journal (AC12)", () => {
    it("should refuse to create a node at the journal path, writing nothing", async () => {
      const mcp = await session()
      const before = await nodes()
      const refused = await mcp.call("write", { ctx: ref.id(SESSION), path: "journal", title: "Journal", summary: "Mes notes.", ops: [{ op: "append", text: "x" }] })
      expect([refused.isError, refused.text]).toEqual([true, "journal is reserved: it serves the call journal. Choose another path."])
      // Aucune requête d'écriture (espion, AC-x3), et l'arbre de O relu identique.
      expect(mcp.requests.filter((request) => request.write)).toEqual([])
      expect(await nodes()).toEqual(before)
    })
  })

  describe("the journal read is journaled (AC13)", () => {
    it("should leave its own line on target journal, shown by the next today", async () => {
      const mcp = await session()
      const code = ref.id(SESSION)
      await mcp.call("read", { ctx: code, path: "journal", section: "today" })
      expect(mcp.journal.at(-1)).toMatchObject({ method: "tools/call", tool: `${ref.org.prefix}_read`, ctx: code, target: "journal" })
      expect(mcp.journal.at(-1)?.error).toBeUndefined()

      await writeJournal(mcp.deps.db, mcp.journal)
      const again = await mcp.call("read", { ctx: code, path: "journal", section: "today" })
      expect(ref.readable(again.result.structuredContent)).toMatchObject({ conversations: [{ ctx: SESSION, calls: 1 }, { ctx: "K7M2-9QXR" }] })
    })
  })
})
