// @vitest-environment node
// Le calcul des statistiques (1.4.13), sans base : chaque semaine de la fenêtre, même vide ; les conversations par
// assistant, le nom du client ramené à sa famille ; chaque équipe ou celle du filtre ; les jamais connectés ; les
// contenus lus nommés seulement quand l'appelant les lit ; les appels de `call` par famille, activée ou non ; les tableaux
// par équipe (taux d'usage, procédure la plus servie lisible) et par personne (pages, assistant, jamais connecté, inactif).
import { describe, expect, it } from "vitest"
import { aggregateStatistics, assistantName, weekOf, type StatisticsInput, type StatisticsReads } from "../../packages/plateforme/server/usage-statistics"

const NOW = new Date("2026-09-24T15:00:00.000Z")
const SINCE = new Date("2026-09-10T15:00:00.000Z")

const READS: StatisticsReads = {
  conversations: [
    { ctx: "A-1", user_id: "lea", host: "claude-ai@0.1.0", first: "2026-09-11T09:00:00+00:00" },
    { ctx: "A-2", user_id: "lea", host: "openai-mcp@1.0.0", first: "2026-09-22T09:00:00+00:00" },
    { ctx: "A-3", user_id: "paul", host: "Claude Desktop", first: "2026-09-23T09:00:00+00:00" },
    { ctx: "A-4", user_id: "marc", host: null, first: "2026-09-23T10:00:00+00:00" },
  ],
  targets: [
    { tool: "demo_read", target: "ventes/tarifs", calls: 7, errors: 0, conversations: 3 },
    { tool: "demo_read", target: "private/claire/notes", calls: 9, errors: 0, conversations: 1 },
    { tool: "demo_call", target: "mail.create_draft", calls: 3, errors: 1, conversations: 2 },
    { tool: "demo_call", target: "mail.send_draft", calls: 1, errors: 0, conversations: 1 },
    { tool: "demo_call", target: "table.rows", calls: 2, errors: 0, conversations: 1 },
  ],
  contentWeeks: [{ what: "created", week: "2026-09-21", count: 4 }, { what: "published", week: "2026-09-21", count: 6 }],
  written: [{ origin: "agent", count: 3 }, { origin: "human", count: 1 }],
  pendingInvitations: 2,
  publicLinks: { active: 1, created: 0 },
  activations: [{ name: "mail", label: "Mail" }, { name: "erp", label: "ERP" }],
  activity: [
    { user_id: "lea", calls: 12, last: "2026-09-22T09:30:00+00:00" },
    { user_id: "paul", calls: 4, last: "2026-09-23T09:30:00+00:00" },
    { user_id: "marc", calls: 1, last: "2026-09-23T10:30:00+00:00" },
    // Hors de la fenêtre seulement : aucun appel compté, son dernier appel dit.
    { user_id: "zoe", calls: 0, last: "2026-07-01T10:00:00+00:00" },
  ],
  demands: [
    { user_id: "lea", target: "ventes/qualifier", count: 3 },
    { user_id: "paul", target: "ventes/relancer", count: 2 },
    // Une procédure que l'appelant ne lit pas : ni comptée ni nommée.
    { user_id: "paul", target: "private/paul/notes", count: 9 },
    { user_id: "lea", target: "Une phrase", count: 1 },
  ],
  authorship: [
    { user_id: "lea", origin: "agent", node_id: "n1" },
    { user_id: "lea", origin: "human", node_id: "n1" },
    { user_id: "paul", origin: "agent", node_id: "n1" },
    { user_id: "paul", origin: "agent", node_id: "n2" },
  ],
}

const INPUT: StatisticsInput = {
  since: SINCE,
  now: NOW,
  prefix: "demo",
  roster: {
    teams: [{ id: "t-ventes", slug: "ventes", name: "Ventes" }, { id: "t-compta", slug: "compta", name: "Compta" }],
    memberships: [{ teamId: "t-ventes", userId: "lea", role: "member" }, { teamId: "t-ventes", userId: "paul", role: "lead" }, { teamId: "t-compta", userId: "marc", role: "member" }],
  },
  directory: [
    { userId: "lea", email: "lea@x.test", name: "Léa Roux", role: "member", lastSignInAt: "2026-09-22T09:00:00Z" },
    { userId: "zoe", email: "zoe@x.test", name: "Zoé Blanc", role: "member", lastSignInAt: null },
    { userId: "marc", email: "marc@x.test", name: "Marc Petit", role: "member", lastSignInAt: null },
  ],
  team: null,
  // Les notes de Claire ne se lisent pas : jamais nommées.
  titles: new Map([["ventes/tarifs", "Tarifs"]]),
  procedures: new Map([
    ["ventes/qualifier", "Qualifier"],
    ["ventes/relancer", "Relancer"],
  ]),
}

describe("weekOf and assistantName", () => {
  it("should give the Monday of the week in UTC, a Sunday included", () => {
    expect([weekOf(new Date("2026-09-21T00:00:00Z")), weekOf(new Date("2026-09-27T23:59:00Z")), weekOf(new Date("2026-09-28T00:00:00Z"))]).toEqual(["2026-09-21", "2026-09-21", "2026-09-28"])
  })

  it("should bring a client name to its assistant family, an unknown one to its name without version, none to null", () => {
    expect(["claude-ai@0.1.0", "Claude Desktop", "openai-mcp@1.0.0", "le-chat@2", "inconnu@3.1", "", null].map(assistantName)).toEqual(["Claude", "Claude", "ChatGPT", "Mistral", "inconnu", null, null])
  })
})

describe("aggregateStatistics (1.4.13)", () => {
  it("should count the adoption each week of the window and by assistant, and name the members never signed in", () => {
    const { adoption } = aggregateStatistics(READS, INPUT)
    expect(adoption.weeks).toEqual([
      { week: "2026-09-07", people: 1, conversations: 1 },
      { week: "2026-09-14", people: 0, conversations: 0 },
      { week: "2026-09-21", people: 3, conversations: 3 },
    ])
    expect(adoption.assistants).toEqual([
      { name: "Claude", conversations: 2 },
      { name: "ChatGPT", conversations: 1 },
      { name: null, conversations: 1 },
    ])
    expect(adoption.neverSignedIn).toEqual({ count: 2, names: ["Marc Petit", "Zoé Blanc"] })
    expect(adoption.pendingInvitations).toBe(2)
  })

  it("should keep the filtered team only, its own members never signed in and its own people", () => {
    const statistics = aggregateStatistics(READS, { ...INPUT, team: { id: "t-compta", userIds: ["marc"] } })
    expect(statistics.teams.map((team) => team.name)).toEqual(["Compta"])
    expect(statistics.adoption.neverSignedIn).toEqual({ count: 1, names: ["Marc Petit"] })
    expect(statistics.people.map((person) => person.name)).toEqual(["Marc Petit"])
  })

  it("should give each team its members, the active ones, its calls, pages, procedures served and the most served readable one", () => {
    const { teams } = aggregateStatistics(READS, INPUT)
    expect(teams).toEqual([
      // Paul n'est pas dans l'annuaire : membre d'équipe sans être membre de l'organisation, il ne compte pas.
      { id: "t-ventes", name: "Ventes", members: 1, activeMembers: 1, conversations: 2, calls: 12, pages: 1, proceduresServed: 3, topProcedure: { path: "ventes/qualifier", title: "Qualifier" }, lastActivity: "2026-09-22T09:30:00+00:00" },
      { id: "t-compta", name: "Compta", members: 1, activeMembers: 1, conversations: 1, calls: 1, pages: 0, proceduresServed: 0, topProcedure: null, lastActivity: "2026-09-23T10:30:00+00:00" },
    ])
  })

  it("should give each person, by name, their teams, last uses, pages by hand and by assistant, assistant, never signed in or inactive", () => {
    const { people } = aggregateStatistics(READS, INPUT)
    expect(people).toEqual([
      { userId: "lea", name: "Léa Roux", teams: ["Ventes"], lastSignInAt: "2026-09-22T09:00:00Z", lastAssistantUse: "2026-09-22T09:30:00+00:00", conversations: 2, calls: 12, pagesByHand: 1, pagesByAssistant: 1, assistant: "ChatGPT", neverSignedIn: false, inactive: false },
      { userId: "marc", name: "Marc Petit", teams: ["Compta"], lastSignInAt: null, lastAssistantUse: "2026-09-23T10:30:00+00:00", conversations: 1, calls: 1, pagesByHand: 0, pagesByAssistant: 0, assistant: null, neverSignedIn: true, inactive: false },
      { userId: "zoe", name: "Zoé Blanc", teams: [], lastSignInAt: null, lastAssistantUse: "2026-07-01T10:00:00+00:00", conversations: 0, calls: 0, pagesByHand: 0, pagesByAssistant: 0, assistant: null, neverSignedIn: true, inactive: false },
    ])
  })

  it("should call inactive a person signed in once whose last sign-in and last call are older than 30 days", () => {
    const directory = [{ userId: "lea", email: "lea@x.test", name: "Léa Roux", role: "member" as const, lastSignInAt: "2026-08-01T09:00:00Z" }]
    const quiet = { ...READS, activity: [{ user_id: "lea", calls: 0, last: "2026-08-10T09:00:00+00:00" }], conversations: [] }
    expect(aggregateStatistics(quiet, { ...INPUT, directory }).people[0]).toMatchObject({ neverSignedIn: false, inactive: true })
    const recent = { ...quiet, activity: [{ user_id: "lea", calls: 1, last: "2026-09-20T09:00:00+00:00" }] }
    expect(aggregateStatistics(recent, { ...INPUT, directory }).people[0]).toMatchObject({ inactive: false })
  })

  it("should name the most read contents the caller reads only, and count the calls by family, activated or not", () => {
    const { content, sharing } = aggregateStatistics(READS, INPUT)
    expect(content.mostRead).toEqual([{ path: "ventes/tarifs", title: "Tarifs", reads: 7, conversations: 3 }])
    expect(content.written).toEqual({ assistant: 3, human: 1 })
    expect(content.weeks.at(-1)).toEqual({ week: "2026-09-21", created: 4, published: 6 })
    expect(sharing.connectors).toEqual([
      { name: "mail", label: "Mail", active: true, calls: 4, errors: 1 },
      { name: "table", label: null, active: false, calls: 2, errors: 0 },
      { name: "erp", label: "ERP", active: true, calls: 0, errors: 0 },
    ])
  })
})
