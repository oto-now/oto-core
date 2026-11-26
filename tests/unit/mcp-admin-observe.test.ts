// @vitest-environment node
// `admin_journal`, `admin_feedback` et `admin_cell` par InMemoryTransport sur une vraie base (E08-S06,
// AC14 à AC19 ; E01-S10, lot t1-d2b) : la lecture du journal d'E05-S05 (portée, masquage des clés
// secrètes, curseurs), le journal du connecteur admin (`listAdminLog`), les tickets d'E08-S09 (le
// FB-0012 d'une autre organisation n'est ni lu ni touché), l'état de la cellule d'E08-S04 sans aucune
// valeur de variable. La base des tests admin, avec l'arbre d'acme, son journal et ses tickets
// (`seedAdminFixture`), est semée par la connexion d'administration : une graine pour le fichier ; un
// test y ajoute ses lignes et les retire après lui, ou prend une base à soi, sur la même connexion, quand
// il en écrit des milliers. Codes de session, slug, préfixe et emails y sont jetables, et les textes attendus les
// portent. Un refus avant toute lecture, et la panne d'une base qui ne répond pas, passent par l'espion des
// deux faces du client (`spyDb`, AC-x3). Sam n'agit pas chez other : le temps d'un cas qui prouve le filtre
// d'organisation du service, il y reçoit un accès en cours, et la RLS lui rend les lignes d'other.
// En suite portable (`sqlConfigured`) : le projet, ou le Postgres nu du job `bare-postgres`.
import * as z from "zod/v4"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { listAdminLog } from "../../packages/plateforme/server/admin/journal"
import { cellStatus, packageVersion } from "../../packages/plateforme/server/cell"
import { codes, connectAdminMcp, ORGS, PERSONS, TEAMS, type AdminPerson } from "../helpers/mcp-admin"
import { seedAdminFixture, type AdminFixtureSql } from "../helpers/mcp-admin-sql"
import type { Row } from "../helpers/simulated-db"
import { isoInstants, seedWithAdmin, spyDb, sqlConfigured, type SeededData, type SpyOptions, portable } from "../helpers/sql"

// `cellStatus` d'E08-S04, tel quel : AC19 lui fait rendre l'historique des migrations de la base
// simulée, sans toucher l'historique réel du projet partagé.
vi.mock("../../packages/plateforme/server/cell", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../packages/plateforme/server/cell")>()
  return { ...original, cellStatus: vi.fn(original.cellStatus) }
})

const RESTARTED = "The cursor is no longer valid: this is the first page again."
const HIDDEN_ARGS = "args not shown: call on another person's personal space"
const NETWORK_TIMEOUT = 60_000
const SETUP_TIMEOUT = 180_000

/** Un instant il y a `minutes` minutes, et ses deux formes servies : « 2026-09-24 14:02 UTC », « 14:02:07 ». */
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()
const when = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`
const clock = (iso: string) => iso.slice(11, 19)
const DAY_MINUTES = 24 * 60

// Chaque instant est pris une fois : une ligne et le texte attendu le lisent au même moment.
const AT = { context: ago(60), call: ago(59), read: ago(30), other: ago(10), tenDays: ago(10 * DAY_MINUTES) }
const TICKET_AT = { fb12: ago(60), fb13: ago(30), handled: ago(20), other: ago(10), fortyDays: ago(40 * DAY_MINUTES) }
const LOG_AT = { move: ago(120), create: ago(119), theo: ago(100), eightDays: ago(8 * DAY_MINUTES) }

/** La cible des lignes servies d'une page d'`admin_log`, lue par un schéma plutôt qu'affirmée. */
const servedRows = z.array(z.object({ target: z.string().nullable() }))

/** Le préfixe des outils d'acme et d'other : une ligne du journal nomme l'outil appelé (`<préfixe>_context`), et les préfixes sont jetables. */
type Prefixes = { acme: string; other: string }

const prefixesOf = (fixture: AdminFixtureSql): Prefixes => ({ acme: fixture.orgs.acme.prefix, other: fixture.orgs.other.prefix })

function journalRow(id: number, fields: Row): Row {
  const base = { org_id: ORGS.acme.id, team_id: null, host: null, user_agent: null, account_id: null, is_error: false, error: null, duration_ms: 10, args: {} }
  return { id, ...base, ...fields }
}

/** Deux conversations d'acme (Claire, avec un échec aux arguments secrets ; Marc), et une d'`other`. */
function journal(prefix: Prefixes): Row[] {
  const claire = { user_id: PERSONS.claire.id, team_id: TEAMS.ventes.id, ctx: "AAAA-0001", host: "claude-ai@0.1.0" }
  return [
    journalRow(1, { ...claire, ts: AT.context, tool: `${prefix.acme}_context`, target: "ventes/relance", duration_ms: 40, args: { phrase: "relance devis" } }),
    journalRow(2, {
      ...claire,
      ts: AT.call,
      tool: `${prefix.acme}_call`,
      target: "mail.send_draft",
      is_error: true,
      error: "invalid_arguments: The account is refused.",
      duration_ms: 120,
      args: { api_key: "abc", authorization: "Bearer x", key: "P-001" },
    }),
    journalRow(3, { user_id: PERSONS.marc.id, team_id: TEAMS.support.id, ctx: "BBBB-0002", ts: AT.read, tool: `${prefix.acme}_read`, target: "support/faq", user_agent: "Claude-User" }),
    journalRow(4, { org_id: ORGS.other.id, user_id: PERSONS.otto.id, ctx: "CCCC-0003", ts: AT.other, tool: `${prefix.other}_read`, target: "guide" }),
  ]
}

/** Le texte de FB-0012, que le test d'AC17 allonge puis rend. */
const GAP_TEXT = "The procedure does not say which account to use."

function ticket(fields: Row): Row {
  const base = { org_id: ORGS.acme.id, ctx: null, target: null, resolution: null, handled_by: null, handled_at: null }
  return { ...base, ...fields }
}

/** FB-0012 et FB-0013 d'acme ; un FB-0012 d'`other`, que rien ne doit lire ni toucher. */
function feedback(): Row[] {
  const declined = { state: "declined", resolution: "Out of scope for V1.", handled_by: PERSONS.ada.id, handled_at: TICKET_AT.handled }
  return [
    ticket({ id: 1, number: 12, created_at: TICKET_AT.fb12, user_id: PERSONS.claire.id, ctx: "AAAA-0001", type: "gap", target: "ventes/relance", text: GAP_TEXT, state: "open" }),
    ticket({ id: 2, number: 13, created_at: TICKET_AT.fb13, user_id: PERSONS.marc.id, type: "friction", text: "Too slow.", ...declined }),
    ticket({ id: 3, org_id: ORGS.other.id, number: 12, created_at: TICKET_AT.other, user_id: PERSONS.otto.id, type: "error", text: "Broken.", state: "open" }),
  ]
}

/** L'arbre d'acme, son journal et ses tickets, sur une graine : les tables de `session()` de la base simulée. */
async function seedObserved(seed: SeededData): Promise<AdminFixtureSql> {
  const fixture = await seedAdminFixture(seed, { tree: true })
  await fixture.write({ journal: journal(prefixesOf(fixture)), feedback: feedback() })
  return fixture
}

/** Une ligne du journal admin. */
function adminLine(id: number, fields: Row): Row {
  const base = { method: "tools/call", user_agent: "vitest", host: null, is_error: false, error: null, duration_ms: 10, args: null, args_chars: null, result_chars: 100 }
  return { id, ...base, ...fields }
}

function adminLines(): Row[] {
  const session = { user_id: PERSONS.sam.id, org_id: ORGS.acme.id, ctx: "SESS-0001" }
  return [
    adminLine(101, { ...session, ts: LOG_AT.move, tool: "admin_node", op: "move", target: "conseil/tarifs", duration_ms: 35, args: { op: "move", path: "ventes/tarifs" } }),
    adminLine(102, {
      ...session,
      ts: LOG_AT.create,
      tool: "admin_connector",
      op: "create_account",
      target: "account:Mail Test",
      is_error: true,
      error: "not_found: Unknown connector fax.",
      duration_ms: 12,
      args: { op: "create_account", api_key: "sk-test" },
    }),
    adminLine(103, { user_id: PERSONS.theo.id, org_id: ORGS.other.id, ctx: "TTTT-0002", ts: LOG_AT.theo, tool: "admin_org", op: "get", target: "org:other" }),
    // Huit jours : hors de la fenêtre par défaut de 7 jours (N7).
    adminLine(104, { user_id: PERSONS.sam.id, org_id: ORGS.acme.id, ctx: "SESS-0000", ts: LOG_AT.eightDays, tool: "admin_org", op: "get", target: "org:acme" }),
  ]
}

/** L'historique des migrations de la base simulée : deux du paquet, une de l'hôte, une sans nom (une CLI qui ne l'écrivait pas). */
const MIGRATIONS = [
  { version: "20260924100000", name: "platform_socle" },
  { version: "20260924120000", name: "platform_droits" },
  { version: "20260925000000", name: "hote_ventes" },
  { version: "20260925000001", name: null },
]

/** L'accès en cours de Sam à other, le temps d'un cas (`withOtherInReach`). */
const OTHER_GRANT = "d0000000-0000-4000-8000-000000000009"

describe.skipIf(!sqlConfigured)(portable("admin observation on a real database"), { timeout: NETWORK_TIMEOUT }, () => {
  let seed: SeededData
  let admin: AdminFixtureSql
  /** Les bases à soi des tests, sur la connexion de la graine du fichier : défaites avec elle. */
  const own: AdminFixtureSql[] = []

  beforeAll(async () => {
    seed = seedWithAdmin()
    admin = await seedObserved(seed)
  }, SETUP_TIMEOUT)

  afterAll(async () => {
    try {
      for (const fixture of [admin, ...own]) await fixture?.forgetJournal()
    } finally {
      await seed?.cleanup()
    }
  }, SETUP_TIMEOUT)

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  /**
   * Une base à soi (l'arbre, le journal et les tickets, pour des organisations et des personnes nouvelles),
   * pour un test qui écrit des milliers de lignes ; sur la connexion de la graine du fichier.
   */
  async function ownSeed(): Promise<{ seed: SeededData; admin: AdminFixtureSql }> {
    const fixture = await seedObserved(seed)
    own.push(fixture)
    return { seed, admin: fixture }
  }

  /** La session admin de `caller` sur `fixture`, ouverte, son client passé par l'espion (`options` : `fail`) ; `call` lui passe son code. */
  async function session(fixture: AdminFixtureSql = admin, caller: AdminPerson = "sam", options: SpyOptions = {}) {
    const person = await fixture.deps(caller)
    const deps = { ...person, db: spyDb(person.db, options).db }
    const mcp = await connectAdminMcp(deps)
    const { code } = await mcp.openAdmin()
    const call = (tool: string, args: Record<string, unknown>) => mcp.call(tool, { ctx: code, ...args })
    return { deps, call }
  }

  /**
   * `fn` pendant que Sam a un accès en cours à other, écrit puis retiré par la connexion d'administration :
   * la RLS d'isolation lui rend alors les lignes d'other, et seul le filtre d'organisation du service les
   * écarte (`security-patterns.md § Droits dans le service`), comme la base simulée, sans RLS.
   */
  async function withOtherInReach(fn: () => Promise<void>): Promise<void> {
    await admin.write({ platform_grants: [{ id: OTHER_GRANT, org_id: ORGS.other.id, user_id: PERSONS.sam.id, granted_by: PERSONS.theo.id }] })
    try {
      await fn()
    } finally {
      await seed.admin`delete from platform.platform_grants where id = ${admin.id(OTHER_GRANT)}`
    }
  }

  /** Retire du journal de la graine du fichier les lignes qu'un test y a ajoutées, par leur code simulé. */
  async function dropConversation(simulated: string): Promise<void> {
    await seed.admin`delete from platform.journal where ctx = ${admin.id(simulated)}`
  }

  /**
   * Les clés des arguments d'un appel, dans l'ordre où la base les rend : `jsonb` les range par longueur
   * puis par octets, et le texte servi les suit (`testing-strategy.md § Anti-patterns`).
   */
  async function storedKeys(simulated: string, target: string): Promise<string[]> {
    const [row] = await seed.admin<{ args: Record<string, unknown> }[]>`select args from platform.journal where ctx = ${admin.id(simulated)} and target = ${target}`
    return Object.keys(row.args)
  }

  describe("admin_journal conversations (AC14)", () => {
    it("should list the conversations of the organisation most recent first over 7 days by default, filtered by team, person and errors, and say when none matches", async () => {
      // Une conversation de Marc vieille de dix jours : hors de la fenêtre par défaut (N7).
      const old = journalRow(5, { user_id: PERSONS.marc.id, team_id: TEAMS.support.id, ctx: "GGGG-0007", ts: AT.tenDays, tool: `${admin.orgs.acme.prefix}_read`, target: "support/faq" })
      await admin.write({ journal: [old] })
      try {
        // La conversation d'other, la plus récente, que la RLS rend à Sam le temps du cas : le service l'écarte.
        await withOtherInReach(async () => {
          const { call } = await session()
          const acme = admin.orgs.acme.slug
          const conversations = (args: Record<string, unknown>) => call("admin_journal", { op: "conversations", org: acme, ...args })
          const claire = `- ${when(AT.call)} · ${admin.id("AAAA-0001")} · Claire Morel · claude-ai@0.1.0 · served ventes/relance · 2 calls, 1 error`
          const marc = `- ${when(AT.read)} · ${admin.id("BBBB-0002")} · Marc Petit · Claude-User · no procedure served · 1 call, 0 errors`
          const listed = await conversations({})
          expect(listed.text).toBe([marc, claire].join("\n"))
          expect(admin.readable(listed.structured)).toMatchObject({ conversations: [{ ctx: "BBBB-0002" }, { ctx: "AAAA-0001", procedure: "ventes/relance" }], next_cursor: null })
          expect((await conversations({ days: 30 })).text).toBe(
            [marc, claire, `- ${when(AT.tenDays)} · ${admin.id("GGGG-0007")} · Marc Petit · unknown host · no procedure served · 1 call, 0 errors`].join("\n"),
          )
          expect((await conversations({ team: "ventes" })).text).toBe(claire)
          expect((await conversations({ email: admin.persons.marc.email })).text).toBe(marc)
          expect((await conversations({ errors: true })).text).toBe(claire)
          expect((await conversations({ team: "support", errors: true, days: 30 })).text).toBe(`No conversation in ${acme} over the last 30 days, team support, errors only.`)
          expect((await conversations({ cursor: "not-a-cursor" })).text).toBe([RESTARTED, marc, claire].join("\n"))
        })
      } finally {
        await dropConversation("GGGG-0007")
      }
    })

    it("should say when the period holds more than 2,000 calls, and serve the rest of a long list by cursor", async () => {
      const mine = await ownSeed()
      const acme = mine.admin.orgs.acme
      // 49 conversations d'un appel et les deux d'acme : la 51e, la plus ancienne, passe à la page suivante.
      const times = Array.from({ length: 49 }, (_, index) => ago(500 - index))
      const many = times.map((ts, index) =>
        journalRow(100 + index, { user_id: PERSONS.marc.id, ctx: `DD${String(index).padStart(2, "0")}-0000`, ts, tool: `${acme.prefix}_read`, target: "support/faq" }),
      )
      await mine.admin.write({ journal: many })
      const { call } = await session(mine.admin)
      const first = await call("admin_journal", { op: "conversations", org: acme.slug, days: 7 })
      const lines = first.text.split("\n")
      expect(lines).toHaveLength(51)
      expect(lines.at(-1)).toBe(`next_cursor: ${String(first.structured?.next_cursor)}`)
      const second = await call("admin_journal", { op: "conversations", org: acme.slug, days: 7, cursor: first.structured?.next_cursor })
      expect(second.text).toBe(`- ${when(times[0])} · ${mine.admin.id("DD00-0000")} · Marc Petit · unknown host · no procedure served · 1 call, 0 errors`)
      expect(second.structured?.next_cursor).toBeNull()

      const crowded = Array.from({ length: 2001 }, (_, index) =>
        journalRow(5000 + index, { user_id: PERSONS.marc.id, ctx: "EEEE-0005", ts: ago(100), tool: `${acme.prefix}_read`, target: "support/faq" }),
      )
      await mine.admin.write({ journal: crowded })
      const page = await call("admin_journal", { op: "conversations", org: acme.slug })
      expect(page.text.split("\n")[0]).toBe("The period has more than 2,000 calls: only the most recent are grouped here. Narrow the period or filter.")
    })
  })

  describe("admin_journal conversation (AC15)", () => {
    it("should list the calls of a conversation with their secret-looking arguments masked, and answer an unknown, foreign or malformed code alike", async () => {
      // La conversation d'other, que la RLS rend à Sam le temps du cas : le service ne la sert pas sous acme.
      await withOtherInReach(async () => {
        const { call } = await session()
        const acme = admin.orgs.acme.slug
        const claire = admin.id("AAAA-0001")
        const read = await call("admin_journal", { op: "conversation", org: acme, code: claire.toLowerCase() })
        const masked: Record<string, string> = { api_key: "[masked]", authorization: "[masked]", key: "P-001" }
        const shown = Object.fromEntries((await storedKeys("AAAA-0001", "mail.send_draft")).map((key) => [key, masked[key]]))
        expect(read.text).toBe(
          [
            `Conversation ${when(AT.call)} · ${claire} · Claire Morel · claude-ai@0.1.0 · served ventes/relance · 2 calls, 1 error`,
            `- ${clock(AT.context)} · context ventes/relance · ok · 40 ms · args {"phrase":"relance devis"}`,
            `- ${clock(AT.call)} · call mail.send_draft · error: invalid_arguments: The account is refused. · 120 ms · args ${JSON.stringify(shown)}`,
          ].join("\n"),
        )
        expect(read.structured).toMatchObject({ calls: [expect.anything(), { args: { api_key: "[masked]", authorization: "[masked]", key: "P-001" } }], next_cursor: null })
        // Un code inconnu, celui de la conversation d'other, un code mal formé.
        for (const code of ["ZZZZ-9999", admin.id("CCCC-0003"), "nope"]) {
          expect((await call("admin_journal", { op: "conversation", org: acme, code })).text).toBe(`No conversation ${code.toUpperCase()} in ${acme}.`)
        }
      })
    })

    it("should serve the conversation and each of its calls in fields, a call without the rank that read journal gives it (AC22)", async () => {
      const { call } = await session()
      const read = await call("admin_journal", { op: "conversation", org: admin.orgs.acme.slug, code: admin.id("AAAA-0001") })
      const fields = { person: "Claire Morel", host: "claude-ai@0.1.0", procedure: "ventes/relance", request: null }
      // Le code relu en simulé (`readable`), les instants à la graphie de `toISOString` (`isoInstants`).
      expect(isoInstants(admin.readable(read.structured?.conversation))).toEqual({ ctx: "AAAA-0001", started_at: AT.context, last_at: AT.call, ...fields, calls: 2, errors: 1 })
      const ventes = { team: "Ventes", account: null }
      expect(isoInstants(read.structured?.calls)).toEqual([
        { at: AT.context, tool: "context", target: "ventes/relance", ...ventes, duration_ms: 40, is_error: false, error: null, args: { phrase: "relance devis" } },
        {
          at: AT.call,
          tool: "call",
          target: "mail.send_draft",
          ...ventes,
          duration_ms: 120,
          is_error: true,
          error: "invalid_arguments: The account is refused.",
          args: { api_key: "[masked]", authorization: "[masked]", key: "P-001" },
        },
      ])
    })

    it("should serve a call on another person's personal space as read journal does: target cut, error code, no arguments (fiche D44)", async () => {
      // Claire écrit dans son espace personnel ; Sam, qui n'en est pas l'auteur, lit la conversation (règle de M14).
      const personal = journalRow(6, {
        user_id: PERSONS.claire.id,
        ctx: "HHHH-0008",
        ts: AT.read,
        tool: `${admin.orgs.acme.prefix}_write`,
        target: "private/claire/budget",
        is_error: true,
        error: "invalid_arguments: private/claire/budget has no section Salaires.",
        args: { path: "private/claire/budget", ops: [{ op: "append", section: "Salaires" }] },
      })
      await admin.write({ journal: [personal] })
      try {
        const { call } = await session()
        const read = await call("admin_journal", { op: "conversation", org: admin.orgs.acme.slug, code: admin.id("HHHH-0008") })
        expect(read.text.split("\n")[1]).toBe(`- ${clock(AT.read)} · write private/claire · error: invalid_arguments · 10 ms · ${HIDDEN_ARGS}`)
        expect(read.structured?.calls).toEqual([expect.objectContaining({ target: "private/claire", error: "invalid_arguments", args: null, args_hidden: true })])
      } finally {
        await dropConversation("HHHH-0008")
      }
    })
  })

  describe("admin_journal admin_log (AC16)", () => {
    afterEach(async () => {
      // Les lignes qu'un test a ajoutées au journal admin, et l'ancrage de sa session : chaque test ouvre la sienne.
      await admin.forgetJournal()
    })

    it("should list the lines of the whole platform team over 7 days by default, by organisation or person, and those of one session with their arguments masked", async () => {
      await admin.write({ admin_journal: adminLines() })
      const { call } = await session()
      const acme = admin.orgs.acme.slug
      const { sam, theo } = admin.persons
      const log = (args: Record<string, unknown>) => call("admin_journal", { op: "admin_log", ...args })
      const move = `- ${when(LOG_AT.move)} · ${sam.email} · admin_node move · ${acme} · conseil/tarifs · ok · 35 ms`
      const create = `- ${when(LOG_AT.create)} · ${sam.email} · admin_connector create_account · ${acme} · account:Mail Test · error · 12 ms`
      const byOrg = await log({ org: acme })
      expect(byOrg.text).toBe([create, move].join("\n"))
      expect(byOrg.structured?.rows).toEqual([expect.objectContaining({ tool: "admin_connector", org: acme }), expect.objectContaining({ tool: "admin_node" })])
      const old = `- ${when(LOG_AT.eightDays)} · ${sam.email} · admin_org get · ${acme} · org:acme · ok · 10 ms`
      expect((await log({ org: acme, days: 30 })).text).toBe([create, move, old].join("\n"))
      // Sam n'agit pas chez other (ni membre, ni accès en cours) : l'organisation n'est pas nommée, décidé par le service
      // (`listOrgs`) ; sur la vraie base, la RLS d'`orgs` lui cache aussi la ligne d'other.
      expect((await log({ email: theo.email })).text).toBe(
        `- ${when(LOG_AT.theo)} · ${theo.email} · admin_org get · an organisation you cannot read · org:other · ok · 10 ms`,
      )
      const oneSession = await log({ code: admin.id("SESS-0001").toLowerCase() })
      expect(oneSession.text).toBe(
        [
          `- ${when(LOG_AT.create)} · ${sam.email} · admin_connector create_account · ${acme} · account:Mail Test · error: not_found: Unknown connector fax. · 12 ms · args {"op":"create_account","api_key":"[masked]"}`,
          `- ${when(LOG_AT.move)} · ${sam.email} · admin_node move · ${acme} · conseil/tarifs · ok · 35 ms · args {"op":"move","path":"ventes/tarifs"}`,
        ].join("\n"),
      )
      expect(oneSession.structured?.rows).toEqual([expect.objectContaining({ args: { op: "create_account", api_key: "[masked]" } }), expect.anything()])
      expect((await log({ email: "nobody@oto.test" })).text).toBe("No member of the platform team has the email nobody@oto.test.")
    })

    it("should serve 50 lines a page, the next page after the last line served, a tie on the time broken by id", async () => {
      // 51 lignes d'acme ; les deux dernières de la première page et la première de la suivante ont le même instant.
      const tie = ago(300)
      const rows = Array.from({ length: 51 }, (_, index) =>
        adminLine(1000 + index, { user_id: PERSONS.sam.id, org_id: ORGS.acme.id, ctx: null, ts: index <= 1 ? tie : ago(200 - index), tool: "admin_org", op: "get", target: `org:acme${index}` }),
      )
      // Une seule écriture : la base tire les identifiants dans l'ordre des lignes, qui départage l'instant commun.
      await admin.write({ admin_journal: rows })
      const { call } = await session()
      const acme = admin.orgs.acme.slug
      const first = await call("admin_journal", { op: "admin_log", org: acme })
      const second = await call("admin_journal", { op: "admin_log", org: acme, cursor: first.structured?.next_cursor })
      const served = [...servedRows.parse(first.structured?.rows), ...servedRows.parse(second.structured?.rows)].map((row) => row.target)
      expect(first.structured?.rows).toHaveLength(50)
      expect(served).toEqual(rows.map((row) => row.target).reverse())
      expect(second.structured?.next_cursor).toBeNull()
    })

    it("should refuse a caller outside the platform team before any read of the admin journal (security-patterns.md § Droits dans le service)", async () => {
      // Ada administre acme sans être de l'équipe plateforme : la RLS lui laisserait lire les lignes d'acme.
      await admin.write({ admin_journal: adminLines() })
      const deps = await admin.deps("ada")
      const { db, sent } = spyDb(deps.db)
      await expect(listAdminLog(db, deps.caller, { days: 7 })).rejects.toMatchObject({ code: "forbidden" })
      expect(sent.filter((query) => query.target === "admin_journal")).toEqual([])
      // L'espion voit les requêtes du service : celle de sa décision, `is_staff`.
      expect(sent.some((query) => query.target === "is_staff")).toBe(true)
    })

    it("should serve another member's line on someone's personal space without its arguments or message, its target cut, and the caller's own line whole (fiche D44)", async () => {
      const refused = { tool: "admin_node", op: "publish", target: "org:acme", is_error: true, error: "not_found: Unknown path private/claire/budget." }
      const publish = { op: "publish", org: "acme", path: "private/claire/budget" }
      const lines = [
        adminLine(201, { user_id: PERSONS.theo.id, org_id: ORGS.acme.id, ctx: "TTTT-0003", ts: LOG_AT.move, tool: "admin_node", op: "rules", target: "private/claire/budget", args: { op: "rules", path: "private/claire/budget" } }),
        adminLine(202, { user_id: PERSONS.theo.id, org_id: ORGS.acme.id, ctx: "TTTT-0003", ts: LOG_AT.create, ...refused, args: publish }),
        adminLine(203, { user_id: PERSONS.sam.id, org_id: ORGS.acme.id, ctx: "SESS-0002", ts: LOG_AT.theo, ...refused, args: publish }),
      ]
      await admin.write({ admin_journal: lines })
      const { call } = await session()
      const acme = admin.orgs.acme.slug
      const { sam, theo } = admin.persons
      const theirs = await call("admin_journal", { op: "admin_log", code: admin.id("TTTT-0003") })
      expect(theirs.text).toBe(
        [
          `- ${when(LOG_AT.create)} · ${theo.email} · admin_node publish · ${acme} · org:acme · error: not_found · 10 ms · ${HIDDEN_ARGS}`,
          `- ${when(LOG_AT.move)} · ${theo.email} · admin_node rules · ${acme} · private/claire · ok · 10 ms · ${HIDDEN_ARGS}`,
        ].join("\n"),
      )
      expect(theirs.structured?.rows).toEqual([
        expect.objectContaining({ target: "org:acme", args: null, args_hidden: true }),
        expect.objectContaining({ target: "private/claire", args: null, args_hidden: true }),
      ])
      expect((await call("admin_journal", { op: "admin_log", code: admin.id("SESS-0002") })).text).toBe(
        `- ${when(LOG_AT.theo)} · ${sam.email} · admin_node publish · ${acme} · org:acme · error: not_found: Unknown path private/claire/budget. · 10 ms · args ${JSON.stringify(publish)}`,
      )
    })

    it("should cut to private/<handle> each path under someone's personal space that another member's error names (fiche D52, M14b)", async () => {
      const publish = { op: "publish", org: "acme", path: "ventes/budget" }
      const refused = "invalid_arguments: ventes/budget links to private/claire/budget, which its readers cannot open."
      const line = adminLine(204, { user_id: PERSONS.theo.id, org_id: ORGS.acme.id, ctx: "TTTT-0004", ts: LOG_AT.move, tool: "admin_node", op: "publish", target: "org:acme", is_error: true, error: refused, args: publish })
      await admin.write({ admin_journal: [line] })
      const { call } = await session()
      expect((await call("admin_journal", { op: "admin_log", code: admin.id("TTTT-0004") })).text).toBe(
        `- ${when(LOG_AT.move)} · ${admin.persons.theo.email} · admin_node publish · ${admin.orgs.acme.slug} · org:acme · error: invalid_arguments: ventes/budget links to private/claire, which its readers cannot open. · 10 ms · args ${JSON.stringify(publish)}`,
      )
    })
  })

  describe("admin_feedback list (AC17)", () => {
    it("should count the tickets by state over 30 days by default, then list them most recent first, numbered in the organisation, their text cut at 200 characters", async () => {
      // Un texte de 249 caractères, et un ticket vieux de quarante jours, hors de la fenêtre par défaut (N8) ; rendus après le test.
      const long = "The procedure does not say which account to use. ".repeat(5).trim()
      const old = ticket({ id: 4, number: 10, created_at: TICKET_AT.fortyDays, user_id: PERSONS.marc.id, type: "friction", text: "Old.", state: "open" })
      const acmeId = admin.orgs.acme.id
      await seed.admin`update platform.feedback set text = ${long} where org_id = ${acmeId} and number = 12`
      try {
        await admin.write({ feedback: [old] })
        const { call } = await session()
        const acme = admin.orgs.acme.slug
        const listed = await call("admin_feedback", { op: "list", org: acme })
        const fb13 = `- FB-0013 · ${TICKET_AT.fb13.slice(0, 10)} · Marc Petit · friction · no target · declined · « Too slow. » · no ctx · resolution: Out of scope for V1.`
        const fb12 = `- FB-0012 · ${TICKET_AT.fb12.slice(0, 10)} · Claire Morel · gap · target ventes/relance · open · « ${long.slice(0, 199)}… » · ctx ${admin.id("AAAA-0001")}`
        expect(listed.text).toBe(["1 open, 0 acknowledged, 0 resolved, 1 declined", fb13, fb12].join("\n"))
        expect(listed.structured).toMatchObject({ counts: { open: 1, acknowledged: 0, resolved: 0, declined: 1 }, tickets: [{ ticket: "FB-0013" }, { ticket: "FB-0012" }], next_cursor: null })
        const fb10 = `- FB-0010 · ${TICKET_AT.fortyDays.slice(0, 10)} · Marc Petit · friction · no target · open · « Old. » · no ctx`
        expect((await call("admin_feedback", { op: "list", org: acme, days: 90 })).text).toBe(["2 open, 0 acknowledged, 0 resolved, 1 declined", fb13, fb12, fb10].join("\n"))
        expect((await call("admin_feedback", { op: "list", org: acme, state: "resolved", type: "gap", days: 7 })).text).toBe(
          ["1 open, 0 acknowledged, 0 resolved, 0 declined", `No ticket in ${acme} over the last 7 days, state resolved, type gap.`].join("\n"),
        )
      } finally {
        await seed.admin`delete from platform.feedback where org_id = ${acmeId} and number = 10`
        await seed.admin`update platform.feedback set text = ${GAP_TEXT} where org_id = ${acmeId} and number = 12`
      }
    })
  })

  describe("admin_feedback set_state (AC18)", () => {
    it("should change the state of the ticket of the organisation only, and say what it did or why not", async () => {
      // Le FB-0012 d'other, que la RLS laisse Sam lire et changer le temps du cas : le service ne le touche pas.
      await withOtherInReach(async () => {
        const { deps, call } = await session()
        const { acme, other } = admin.orgs
        const set = (args: Record<string, unknown>) => call("admin_feedback", { op: "set_state", org: acme.slug, ...args })
        const today = new Date().toISOString().slice(0, 10)
        expect((await set({ ticket: "FB-0012", state: "acknowledged" })).text).toBe(`FB-0012 is now acknowledged (by you, ${today}).`)
        expect((await set({ ticket: "FB-0012", state: "acknowledged" })).text).toBe("FB-0012 is already acknowledged; nothing changed.")
        expect((await set({ ticket: "FB-0012", state: "declined" })).text).toBe(
          "A declined ticket needs a resolution: pass resolution = why it will not be handled, which the reporter will read.",
        )
        expect((await set({ ticket: "12", state: "open" })).text).toBe("ticket must look like FB-0012.")
        expect((await set({ ticket: "FB-0099", state: "open" })).text).toBe("Unknown ticket FB-0099 in Acme Test.")
        expect((await set({ ticket: "FB-0012", state: "open" })).text).toBe("FB-0012 is open again: its previous decision was cleared.")
        const rows = await seed.admin<Row[]>`
          select org_id, number, state, handled_by from platform.feedback where org_id in ${seed.admin([acme.id, other.id])} order by id`
        expect(admin.readable([...rows]).map((row) => [row.org_id, row.number, row.state, row.handled_by])).toEqual([
          [ORGS.acme.id, 12, "open", null],
          [ORGS.acme.id, 13, "declined", PERSONS.ada.id],
          [ORGS.other.id, 12, "open", null],
        ])
        expect(codes(deps.journal)).toEqual([null, null, "invalid_arguments", "invalid_arguments", "not_found", null])
      })
    })
  })

  describe("admin_cell (AC19)", () => {
    it("should give the versions, count the platform migrations and report the health without any value, and refuse an organisation", async () => {
      // La session d'abord : son client lit l'adresse du projet à sa construction ; `cellStatus` lit ces variables à l'appel.
      const { deps, call } = await session()
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://cell-secret.example")
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-value-123")
      vi.stubEnv("NEXT_PUBLIC_SITE_URL", "")
      expect((await call("admin_cell", { op: "version" })).text).toBe(`Package @otomata_tech/oto_platform ${packageVersion}; admin connector 1.0.0.`)
      // Le vrai `cellStatus` lit l'historique réel, que le test remplace par celui de la base simulée, sa table fictive
      // (HN-E01S10-t10b-10) : une migration de l'hôte et une sans nom, que le compte des migrations du paquet écarte.
      const actual = await vi.importActual<typeof import("../../packages/plateforme/server/cell")>("../../packages/plateforme/server/cell")
      vi.mocked(cellStatus).mockImplementationOnce(async (db, env) => ({ ...(await actual.cellStatus(db, env)), migrations: MIGRATIONS }))
      expect((await call("admin_cell", { op: "migrations" })).text).toBe("2 platform migrations applied (4 in all); last: 20260924120000 platform_droits.")
      const health = (await call("admin_cell", { op: "health" })).text
      expect(health.split("\n")[0]).toMatch(/^Database: reachable \(\d+ ms\)\.$/)
      expect(health.split("\n").slice(1, 2)).toEqual(["Settings: NEXT_PUBLIC_SUPABASE_URL present, NEXT_PUBLIC_SUPABASE_ANON_KEY present, NEXT_PUBLIC_SITE_URL missing."])
      expect(health.split("\n")[2]).toMatch(/^Checked at \d{4}-\d{2}-\d{2}T/)
      // Une clé dépréciée que les capacités de l'hôte posent encore : nommée, sur sa ligne, avant la date.
      const said = "connectors_max has no effect any more; the key will be refused at the next major version (set for acme)."
      vi.mocked(cellStatus).mockImplementationOnce(async (db, env) => {
        const status = await actual.cellStatus(db, env)
        return { ...status, health: { ...status.health, warnings: [said] } }
      })
      expect((await call("admin_cell", { op: "health" })).text.split("\n")[2]).toBe(`Warning: ${said}`)
      const values = { url: "https://cell-secret.example", key: "anon-value-123" }
      expect(Object.entries(values).filter(([, value]) => JSON.stringify(deps.journal).includes(value) || health.includes(value)).map(([name]) => name)).toEqual([])
      expect((await call("admin_cell", { op: "version", org: "acme" })).text).toBe(
        'Field org is not used by op version of admin_cell. Fields of version: none. Call admin_cell {"op": "help"} for details.',
      )
    })

    it("should say that the database is unreachable when it does not answer", async () => {
      // `applied_migrations` ne répond pas (`57014`, comme la base simulée) : l'espion rend la panne à sa place.
      const { deps, call } = await session(admin, "sam", { fail: (query) => (query.target === "applied_migrations" ? { code: "57014" } : null) })
      expect(await call("admin_cell", { op: "health" })).toMatchObject({ isError: true, text: "Database unreachable." })
      expect(codes(deps.journal)).toEqual(["internal"])
    })
  })
})
