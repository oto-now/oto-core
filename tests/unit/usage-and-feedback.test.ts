// @vitest-environment node
// Les services d'E08-S09 sur une base réelle (E01-S10, lot t1-e2a) : l'organisation O de la fixture
// (`seedReferenceOrg`), et P, dont Ada est aussi membre ici : la RLS d'isolation lui rend les lignes de P,
// que le service doit écarter. Droits et filtres sont prouvés par les services eux-mêmes
// (`security-patterns.md § Droits dans le service`) : `usageSummary` (AC2, AC7), `listFeedback` (AC12),
// `setFeedbackState` (AC11), les statistiques de l'usage et l'option « Retours visibles » (1.4.13), et le refus d'un
// membre qui n'administre pas l'organisation (N9) ; un refus
// sans requête, par l'espion de `spyRequests` (AC-x3). En suite portable (`sqlConfigured`) : le projet, ou le Postgres nu du job `bare-postgres`.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { listFeedback, setFeedbackState } from "../../packages/plateforme/server/feedback"
import type { Tx } from "../../packages/plateforme/server/sql"
import { usageSummary } from "../../packages/plateforme/server/usage"
import { ORG, OTHER_ORG, PEOPLE, TEAMS, type ContentNode, type Person } from "../helpers/reference-org"
import { seedReferenceOrg, type ReferenceOrgSql } from "../helpers/reference-org-sql"
import type { Row } from "../helpers/simulated-db"
import { seedWithAdmin, spyRequests, sqlConfigured, type SeededData, portable } from "../helpers/sql"

const NOW = new Date("2026-09-24T15:00:00.000Z")
/** `minutes` avant `NOW`, comme la base rend un `timestamptz` (UTC, sans fraction nulle) : écrit puis relu tel quel. */
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString().replace(".000Z", "+00:00")
const DAY = 24 * 60

const NETWORK_TIMEOUT = 60_000
const SETUP_TIMEOUT = 180_000

/** Deux procédures : une de Ventes, une dans l'espace personnel de Claire, que l'administratrice ne lit pas (D5). */
const PROCEDURES: ContentNode[] = [
  { path: "ventes/qualifier_prospects", kind: "procedure", title: "Qualifier les prospects" },
  { path: "private/claire/relances", kind: "procedure", title: "Mes relances" },
]

let seed: SeededData
let ref: ReferenceOrgSql

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** Vide une table de O et de P : chaque test pose ses lignes. */
async function clear(table: "journal" | "feedback"): Promise<void> {
  await seed.admin`delete from ${seed.admin(`platform.${table}`)} where org_id in ${seed.admin([ref.org.id, ref.other.id])}`
}

/** Le ticket d'une organisation, relu tel qu'il est en base, en identifiants simulés. */
async function ticketOf(org: string, number: number): Promise<Row> {
  const [row] = await seed.admin<Row[]>`select state, resolution, handled_by, handled_at from platform.feedback where org_id = ${ref.id(org)} and number = ${number}`
  return ref.readable(row)
}

/** Ada, administratrice de O, et aussi de l'équipe plateforme : les retours ne se traitent qu'ainsi (E05-S13, AC-9). */
const staffAda = () => ({ ...ref.identityOf("ada"), isStaff: true })

// ------------------------------------------------------------------------------------ Usage

type LineSpec = { ctx: string | null; person: Person; tool: string; at: number; target?: string; org?: string; method?: string }

function journalLine(spec: LineSpec): Row {
  return {
    ts: minutesAgo(spec.at),
    org_id: spec.org ?? ORG.id,
    user_id: PEOPLE[spec.person].id,
    ctx: spec.ctx,
    method: spec.method ?? "tools/call",
    tool: `${ref.org.prefix}_${spec.tool}`,
    target: spec.target ?? null,
    is_error: false,
    error: null,
    host: "claude-ai@0.1.0",
  }
}

/** Le journal d'AC2 : quatre conversations de O dans la fenêtre ou hors d'elle, une de P, un appel qui n'est pas `tools/call`. */
function usageLines(): Row[] {
  return [
    journalLine({ ctx: "LEA1-0001", person: "lea", tool: "context", at: 2 * DAY, target: "ventes/qualifier_prospects" }),
    journalLine({ ctx: "CLA1-0001", person: "claire", tool: "context", at: DAY, target: "Combien de prospects à Valbrune ?" }),
    journalLine({ ctx: "PAU1-0001", person: "paul", tool: "context", at: 180, target: "private/claire/relances" }),
    journalLine({ ctx: "LEA0-0001", person: "lea", tool: "context", at: 10 * DAY, target: "Une vieille demande" }),
    journalLine({ ctx: "LEAP-0001", person: "lea", tool: "context", at: 60, target: "Ailleurs", org: OTHER_ORG.id }),
    journalLine({ ctx: null, person: "claire", tool: "context", at: 30, method: "tools/list" }),
  ]
}

// ------------------------------------------------------------------------------------ Retours

type TicketSpec = { number: number; at: number; state?: string; type?: string; org?: string; resolution?: string; person?: Person }

/** Un ticket ; son id, la base le tire, et son numéro, la fixture le lui remet (`number`). */
function ticketRow(spec: TicketSpec): Row {
  return {
    org_id: spec.org ?? ORG.id,
    number: spec.number,
    created_at: minutesAgo(spec.at),
    user_id: PEOPLE[spec.person ?? "lea"].id,
    ctx: `T${String(spec.number).padStart(3, "0")}-0001`,
    type: spec.type ?? "gap",
    target: null,
    text: `Retour ${spec.number}`,
    state: spec.state ?? "open",
    resolution: spec.resolution ?? null,
    handled_by: spec.state && spec.state !== "open" ? PEOPLE.ada.id : null,
    handled_at: spec.state && spec.state !== "open" ? minutesAgo(1) : null,
  }
}

const writeTickets = (tickets: TicketSpec[]) => ref.write({ feedback: tickets.map(ticketRow) })

describe.skipIf(!sqlConfigured)(portable("usage and feedback services on a real database (E01-S10 t1)"), { timeout: NETWORK_TIMEOUT }, () => {
  beforeAll(async () => {
    seed = seedWithAdmin()
    ref = await seedReferenceOrg(seed, { nodes: PROCEDURES })
    // Ada, membre de P aussi : la base lui rend le journal et les tickets de P.
    await ref.write({ members: [{ org_id: OTHER_ORG.id, user_id: PEOPLE.ada.id, role: "member", profile: { name: PEOPLE.ada.name, handle: "ada" } }] })
  }, SETUP_TIMEOUT)

  afterAll(async () => {
    await seed?.cleanup()
  }, SETUP_TIMEOUT)

  describe("usageSummary (AC2, AC7)", () => {
    beforeEach(async () => {
      await clear("journal")
    })

    it("should count the window's calls of the organisation only, and name only the procedures the caller reads", async () => {
      await ref.write({ journal: usageLines() })

      const usage = await usageSummary(await ref.db("ada"), ref.identityOf("ada"), { period: 7 })

      expect(usage).toMatchObject({ periode: 7, team: null, truncated: false, coveredFrom: null, totals: { calls: 3, conversations: 3, people: 3, errors: 0 } })
      // La procédure de l'espace de Claire est servie à Paul : ni nommée, ni comptée, ni « sans procédure ».
      expect(usage.procedures.map((procedure) => [procedure.path, procedure.title, procedure.served])).toEqual([["ventes/qualifier_prospects", "Qualifier les prospects", 1]])
      expect(ref.readable(usage.unmatched)).toEqual({
        count: 1,
        items: [{ ctx: "CLA1-0001", at: minutesAgo(DAY), person: "Claire Morel", phrase: "Combien de prospects à Valbrune ?", host: "claude-ai@0.1.0" }],
      })
    })

    it("should keep the calls of the team's members today, and ignore an unknown team", async () => {
      await ref.write({ journal: usageLines() })
      const db = await ref.db("ada")

      const ventes = await usageSummary(db, ref.identityOf("ada"), { period: 7, team: ref.id(TEAMS.ventes.id) })
      expect(ref.readable(ventes.team)).toEqual({ id: TEAMS.ventes.id, name: "Ventes" })
      expect(ventes.totals).toMatchObject({ calls: 2, people: 2 })

      const unknown = await usageSummary(db, ref.identityOf("ada"), { period: 7, team: "0b6f1f0e-1c1a-4a8e-9a51-0d7c1a2b3c02" })
      expect(unknown.team).toBeNull()
      expect(unknown.totals.calls).toBe(3)
    })

    it("should serve of a call on another person's personal space its demand cut to private/<handle> and only the code of its error (D44, M14)", async () => {
      const failed = (spec: LineSpec, error: string, args: unknown): Row => ({ ...journalLine(spec), is_error: true, error, args })
      await ref.write({
        journal: [
          ...usageLines(),
          // Une procédure de l'espace de Claire, servie à Claire, déplacée depuis : son ancien chemin n'est plus une procédure.
          journalLine({ ctx: "CLA3-0001", person: "claire", tool: "context", at: 120, target: "private/claire/anciennes_relances" }),
          // La cible d'un `call` est sa fonction : le tableau personnel de Léa n'est que dans ses arguments, ses colonnes dans l'erreur.
          failed({ ctx: "LEA2-0001", person: "lea", tool: "call", at: 90, target: "table.rows" }, "invalid_arguments: Unknown column(s): statut. Columns: loyer, charges.", {
            function: "table.rows",
            arguments: { table: "private/lea/budget", columns: ["statut"] },
          }),
          // Plus ancienne, sur la même fonction, une erreur de Claire sur un tableau de Ventes : le masquage examine
          // la dernière erreur, celle que l'écran montre (AC5 d'E08-S09), jamais une autre.
          failed({ ctx: "CLA4-0001", person: "claire", tool: "call", at: 100, target: "table.rows" }, "not_found: Unknown table ventes/suivi.", {
            function: "table.rows",
            arguments: { table: "ventes/suivi" },
          }),
          // Sur un tableau de Ventes, l'erreur reste entière.
          failed({ ctx: "CLA2-0001", person: "claire", tool: "call", at: 80, target: "table.schema" }, "not_found: Unknown table ventes/suivi.", {
            function: "table.schema",
            arguments: { table: "ventes/suivi" },
          }),
        ],
      })
      const usage = await usageSummary(await ref.db("ada"), ref.identityOf("ada"), { period: 7 })
      expect(ref.readable(usage.unmatched.items.map((item) => [item.ctx, item.phrase]))).toEqual([
        ["CLA3-0001", "private/claire"],
        ["CLA1-0001", "Combien de prospects à Valbrune ?"],
      ])
      expect(usage.functions.map((entry) => [entry.name, entry.lastError?.message])).toEqual([
        ["table.rows", "invalid_arguments"],
        ["table.schema", "not_found: Unknown table ventes/suivi."],
      ])
    })

    it("should cut to private/<handle> the paths under another person's space that the last error of a function names (D52, M14b)", async () => {
      // Sur un tableau de Ventes, le refus de Léa nomme son tableau et celui que Marc lui partage (N35).
      await ref.write({
        journal: [
          ...usageLines(),
          {
            ...journalLine({ ctx: "LEA3-0001", person: "lea", tool: "call", at: 70, target: "table.rows" }),
            is_error: true,
            error: "not_found: Unknown table ventes/suivi. Tables you can read: private/lea/budget, private/marc/budget, ventes/prospects.",
            args: { function: "table.rows", arguments: { table: "ventes/suivi" } },
          },
        ],
      })
      const usage = await usageSummary(await ref.db("ada"), ref.identityOf("ada"), { period: 7 })
      expect(usage.functions.map((entry) => [entry.name, entry.lastError?.message])).toEqual([
        ["table.rows", "not_found: Unknown table ventes/suivi. Tables you can read: private/lea, private/marc, ventes/prospects."],
      ])
    })
  })

  // 1.4.13 : les statistiques lues sur la base, la fenêtre et l'organisation posées dans chaque lecture.
  it("should add the statistics of the window: conversations by assistant, the contents read named when the caller reads them, the calls by family", async () => {
    await clear("journal")
    await ref.write({
      journal: [
        ...usageLines(),
        journalLine({ ctx: "CLA1-0001", person: "claire", tool: "read", at: DAY - 1, target: "ventes/qualifier_prospects" }),
        journalLine({ ctx: "PAU1-0001", person: "paul", tool: "read", at: 179, target: "private/claire/relances" }),
        { ...journalLine({ ctx: "LEA1-0001", person: "lea", tool: "call", at: 2 * DAY - 1, target: "table.rows" }), is_error: true, error: "not_found: x" },
        // Hors de la fenêtre, et de P : jamais comptés.
        journalLine({ ctx: "LEA0-0001", person: "lea", tool: "read", at: 10 * DAY, target: "ventes/qualifier_prospects" }),
        journalLine({ ctx: "LEAP-0001", person: "lea", tool: "read", at: 60, target: "ventes/qualifier_prospects", org: OTHER_ORG.id }),
      ],
    })

    const { statistics } = await usageSummary(await ref.db("ada"), ref.identityOf("ada"), { period: 7 })

    expect(statistics.adoption.assistants).toEqual([{ name: "Claude", conversations: 3 }])
    expect(statistics.adoption.weeks.reduce((total, week) => total + week.conversations, 0)).toBe(3)
    expect(statistics.content.mostRead).toEqual([{ path: "ventes/qualifier_prospects", title: "Qualifier les prospects", reads: 1, conversations: 1 }])
    expect(statistics.sharing.connectors.find((connector) => connector.name === "table")).toEqual({ name: "table", label: null, active: false, calls: 1, errors: 1 })
    // Par personne : Claire, une conversation et deux appels dans la fenêtre ; son dernier appel est celui de sa lecture.
    expect(statistics.people.find((person) => person.name === "Claire Morel")).toMatchObject({ conversations: 1, calls: 2, lastAssistantUse: minutesAgo(DAY - 1), assistant: "Claude" })
    // Par équipe : Ventes, la procédure servie à Léa nommée.
    expect(statistics.teams.find((team) => team.name === "Ventes")?.topProcedure).toEqual({ path: "ventes/qualifier_prospects", title: "Qualifier les prospects" })
  })

  describe("listFeedback (AC12)", () => {
    // #1 à #50 ouverts, #51 pris en compte, #52 ouvert de type `error` ; #1 à #3 au même instant, à la
    // frontière de la page ; #53 résolu, #54 décliné ; #55 hors de la fenêtre ; le #1 de P, qu'Ada lit aussi ;
    // #56 à #1055 résolus, de type `friction`, plus anciens : 1 054 tickets dans la fenêtre, que les comptes
    // lisent au-delà des 1 000 lignes que PostgREST rend au plus (`supabase-patterns.md § Error Handling`).
    const tickets: TicketSpec[] = [
      ...Array.from({ length: 52 }, (_, index): TicketSpec => {
        const number = index + 1
        return { number, at: 200 - Math.max(number, 3), state: number === 51 ? "acknowledged" : "open", type: number === 52 ? "error" : "gap" }
      }),
      { number: 53, at: 10, state: "resolved" },
      { number: 54, at: 5, state: "declined", resolution: "Hors périmètre." },
      { number: 55, at: 40 * DAY },
      { number: 1, at: 1, org: OTHER_ORG.id },
      ...Array.from({ length: 1_000 }, (_, index): TicketSpec => ({ number: 56 + index, at: 3 * DAY, state: "resolved", type: "friction" })),
    ]

    // Les deux tests lisent sans écrire : les tickets s'écrivent une fois, dans l'ordre de leurs numéros (ids croissants).
    beforeAll(async () => {
      await clear("feedback")
      await writeTickets(tickets)
    }, SETUP_TIMEOUT)

    it("should serve the tickets to handle by 50, after a composite cursor, numbered by the organisation, with the counts over the window", async () => {
      const db = await ref.db("ada")
      const ada = staffAda()

      const first = await listFeedback(db, ada, { state: "to_handle", days: 30 })
      expect(first.tickets).toHaveLength(50)
      expect(first.tickets.slice(0, 2).map((ticket) => [ticket.ticket, ticket.state, ticket.person])).toEqual([
        ["FB-0052", "open", "Léa Roux"],
        ["FB-0051", "acknowledged", "Léa Roux"],
      ])
      // Ni le #1 de P, que la base rend à Ada, ni le #55, hors de la fenêtre.
      expect(first.counts).toEqual({ open: 51, acknowledged: 1, resolved: 1_001, declined: 1 })
      expect(first.nextCursor).not.toBeNull()

      const second = await listFeedback(db, ada, { state: "to_handle", days: 30, cursor: first.nextCursor ?? "" })
      expect(second.tickets.map((ticket) => ticket.ticket)).toEqual(["FB-0002", "FB-0001"])
      expect(second.nextCursor).toBeNull()
    })

    it("should filter by type and state, the counts following the type", async () => {
      const db = await ref.db("ada")

      const errors = await listFeedback(db, staffAda(), { type: "error", days: 30 })
      expect(errors.tickets.map((ticket) => [ticket.ticket, ticket.type])).toEqual([["FB-0052", "error"]])
      expect(errors.counts).toEqual({ open: 1, acknowledged: 0, resolved: 0, declined: 0 })

      const declined = await listFeedback(db, staffAda(), { state: "declined", days: 30 })
      expect(declined.tickets).toMatchObject([{ ticket: "FB-0054", resolution: "Hors périmètre.", handledBy: "Ada Martin", handledAt: minutesAgo(1) }])
    })
  })

  describe("setFeedbackState (AC11)", () => {
    beforeEach(async () => {
      await clear("feedback")
    })

    it("should find the ticket by (org_id, number), write its state, who, when and resolution, and leave the same number of another organisation alone", async () => {
      // Le #13 de O est dans l'état lu du #12 : une écriture qui ne filtrerait pas le numéro l'écrirait aussi.
      await writeTickets([{ number: 12, at: 30 }, { number: 13, at: 25 }, { number: 12, at: 20, org: OTHER_ORG.id }])

      // Une moitié de paire de substitution dans la résolution est écrite en U+FFFD (`supabase-patterns.md § Error Handling`).
      const result = await setFeedbackState(await ref.db("ada"), staffAda(), { ticket: "FB-0012", state: "acknowledged", resolution: "Vu \uD83D ici." })

      expect(result).toMatchObject({ changed: true, ticket: { ticket: "FB-0012", state: "acknowledged", handledBy: "Ada Martin", handledAt: minutesAgo(0), resolution: "Vu � ici." } })
      // Relus en base : le ticket de O écrit ; le #13 de O, et le #12 de P, que la base rend à Ada, intacts.
      expect(await ticketOf(ORG.id, 12)).toEqual({ state: "acknowledged", resolution: "Vu � ici.", handled_by: PEOPLE.ada.id, handled_at: NOW.toISOString() })
      expect(await ticketOf(ORG.id, 13)).toEqual({ state: "open", resolution: null, handled_by: null, handled_at: null })
      expect(await ticketOf(OTHER_ORG.id, 12)).toEqual({ state: "open", resolution: null, handled_by: null, handled_at: null })
    })

    it("should clear the decision when a ticket is opened again, and write nothing for the same state", async () => {
      await writeTickets([{ number: 3, at: 30, state: "declined", resolution: "Hors périmètre." }])
      const ada = staffAda()

      const same = spyRequests(await ref.db("ada"))
      expect(await setFeedbackState(same.db, ada, { ticket: "FB-0003", state: "declined", resolution: "Un autre motif" })).toMatchObject({ changed: false })
      expect(same.requests.filter((request) => request.write)).toEqual([])
      expect(await ticketOf(ORG.id, 3)).toMatchObject({ state: "declined", resolution: "Hors périmètre." })

      expect(await setFeedbackState(same.db, ada, { ticket: "FB-0003", state: "open" })).toMatchObject({ changed: true, ticket: { state: "open", resolution: null, handledBy: null } })
      // La réouverture écrit, et l'espion voit son écriture, sur la face où elle part : la liste vide d'avant
      // n'est pas celle d'un espion aveugle.
      expect(same.requests.filter((request) => request.write).map((request) => request.tables)).toEqual([["feedback"]])
      expect(await ticketOf(ORG.id, 3)).toEqual({ state: "open", resolution: null, handled_by: null, handled_at: null })
    })

    it("should refuse a malformed ticket and a refusal without a reason before any read, and an unknown ticket, the other organisation's one included", async () => {
      await writeTickets([{ number: 1, at: 20, org: OTHER_ORG.id }])
      const spy = spyRequests(await ref.db("ada"))
      const ada = staffAda()

      await expect(setFeedbackState(spy.db, ada, { ticket: "fb-12", state: "resolved" })).rejects.toMatchObject({ code: "invalid_arguments", message: "ticket must look like FB-0012." })
      await expect(setFeedbackState(spy.db, ada, { ticket: "FB-0001", state: "declined", resolution: " ab " })).rejects.toMatchObject({
        code: "invalid_arguments",
        message: "A declined ticket needs a resolution: pass resolution = why it will not be handled, which the reporter will read.",
      })
      expect(spy.requests).toEqual([])

      // Le #1 de P, que la base rend à Ada, n'est pas un ticket de O.
      await expect(setFeedbackState(spy.db, ada, { ticket: "FB-0001", state: "resolved" })).rejects.toMatchObject({ code: "not_found", message: "Unknown ticket FB-0001 in Acme Test." })
      // Ce ticket-là a été cherché : l'espion voit les lectures du service, et sa liste vide d'avant n'est pas
      // celle d'un espion aveugle.
      expect(spy.requests.some((request) => request.tables.includes("feedback"))).toBe(true)
      expect(spy.requests.filter((request) => request.write)).toEqual([])
      expect(await ticketOf(OTHER_ORG.id, 1)).toMatchObject({ state: "open" })
    })

    it("should answer conflict, logged, when the ticket changed between its read and its write", async () => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {})
      await writeTickets([{ number: 7, at: 20 }])

      // Un autre administrateur résout le ticket entre la lecture du service et son écriture : la connexion
      // d'administration verrouille la ligne, le service la lit puis attend le verrou pour l'écrire ; la ligne
      // résolue, le verrou relâché, son écriture gardée par l'état lu ne trouve plus rien.
      const outcome = await seed.admin.begin(async (tx) => {
        const [{ pid }] = await tx<{ pid: number }[]>`select pg_backend_pid() as pid`
        await tx`select 1 from platform.feedback where org_id = ${ref.org.id} and number = 7 for update`
        const service = setFeedbackState(await ref.db("ada"), staffAda(), { ticket: "FB-0007", state: "acknowledged" }).then(
          () => null,
          (error: unknown) => error,
        )
        await blockedBy(tx, pid)
        await tx`update platform.feedback set state = 'resolved' where org_id = ${ref.org.id} and number = 7`
        // Une promesse rendue telle quelle, la transaction l'attendrait avant de relâcher son verrou.
        return { service }
      })

      expect(await outcome.service).toMatchObject({ code: "conflict" })
      expect(log).toHaveBeenCalledWith(expect.stringContaining("setFeedbackState: no row written for ticket FB-0007"))
      expect(await ticketOf(ORG.id, 7)).toMatchObject({ state: "resolved" })
    })
  })

  describe("usage and feedback are reserved to the administrators (N9, H123)", () => {
    beforeEach(async () => {
      await clear("journal")
      await clear("feedback")
    })

    it("should refuse a member who does not administer the organisation, naming whom to ask, without reading the journal or the tickets nor writing", async () => {
      await ref.write({ journal: usageLines() })
      await writeTickets([{ number: 1, at: 20 }])
      const spy = spyRequests(await ref.db("lea"))
      const lea = ref.identityOf("lea")
      const who = "the administrators of Acme Test (Ada Martin)"

      await expect(usageSummary(spy.db, lea, { period: 30 })).rejects.toMatchObject({ code: "forbidden", message: `Reading the usage of Acme Test is reserved to ${who}. Ask them.` })
      await expect(listFeedback(spy.db, lea, { days: 30 })).rejects.toMatchObject({ code: "forbidden" })
      await expect(setFeedbackState(spy.db, lea, { ticket: "FB-0001", state: "resolved" })).rejects.toMatchObject({ code: "forbidden" })

      // La RLS laisse Léa lire le journal et les tickets de O, et les écrire : le service ne les a pas demandés,
      // ni rien écrit (AC-x3).
      expect(spy.requests.filter((request) => request.write || request.tables.includes("journal") || request.tables.includes("feedback"))).toEqual([])
      expect(await ticketOf(ORG.id, 1)).toMatchObject({ state: "open" })
    })

    // E05-S13 (AC-9, HN-E05S13-7) : les retours sont à l'équipe plateforme ; l'administratrice du client, qui lit
    // l'usage, ne les lit ni ne les change tant que l'organisation ne les affiche pas (1.4.13), refusée sur la seule
    // lecture de l'option.
    it("should refuse the feedback to an administrator of the client outside the platform team while the organisation hides it, before reading a ticket", async () => {
      await writeTickets([{ number: 1, at: 20 }])
      const spy = spyRequests(await ref.db("ada"))
      const ada = ref.identityOf("ada")
      const reserved = "Handling the feedback of Acme Test is reserved to the platform team that administers it, and to its administrators when « Retours visibles » is on. Ask them."

      await expect(listFeedback(spy.db, ada, { days: 30 })).rejects.toMatchObject({ code: "forbidden", message: reserved })
      await expect(setFeedbackState(spy.db, ada, { ticket: "FB-0001", state: "resolved" })).rejects.toMatchObject({ code: "forbidden", message: reserved })

      expect(spy.requests.filter((request) => request.write || request.tables.includes("feedback"))).toEqual([])
      expect(spy.requests.some((request) => request.tables.includes("orgs"))).toBe(true)
      expect(await ticketOf(ORG.id, 1)).toMatchObject({ state: "open" })
    })

    // 1.4.13 : « Retours visibles » allumé, l'administratrice du client lit et change les tickets ; un membre, jamais.
    it("should let an administrator of the client handle the feedback when the organisation shows it, never a member", async () => {
      await writeTickets([{ number: 1, at: 20 }])
      await seed.admin`update platform.orgs set flags = flags || '{"feedback_visible": true}'::jsonb where id = ${ref.org.id}`
      try {
        const ada = ref.identityOf("ada")
        expect((await listFeedback(await ref.db("ada"), ada, { days: 30 })).tickets.map((ticket) => ticket.ticket)).toEqual(["FB-0001"])
        expect(await setFeedbackState(await ref.db("ada"), ada, { ticket: "FB-0001", state: "acknowledged" })).toMatchObject({ changed: true })
        await expect(listFeedback(await ref.db("lea"), ref.identityOf("lea"), { days: 30 })).rejects.toMatchObject({ code: "forbidden" })
      } finally {
        await seed.admin`update platform.orgs set flags = flags - 'feedback_visible' where id = ${ref.org.id}`
      }
    })
  })
})

/**
 * Attend qu'une session attende le verrou que tient la transaction `pid` (10 s au plus : `Date` est figée
 * ici) ; lève sinon, plutôt que de laisser le test jouer la course sans elle.
 */
async function blockedBy(tx: Tx, pid: number): Promise<void> {
  const deadline = performance.now() + 10_000
  while (performance.now() < deadline) {
    const [{ waiting }] = await tx<{ waiting: boolean }[]>`
      select exists (select 1 from pg_catalog.pg_stat_activity where ${pid} = any (pg_catalog.pg_blocking_pids(pid))) as waiting`
    if (waiting) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error("blockedBy: no session waited on the lock of the admin connection within 10 s")
}
