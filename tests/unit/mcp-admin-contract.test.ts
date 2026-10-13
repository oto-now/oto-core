// @vitest-environment node
// Contrat du MCP admin (E08-S02, AC4, AC5, AC11, AC23 ; E08-S06, AC20) : les huit outils, leurs titres,
// annotations, descriptions et schémas servis, le serveur annoncé, chaque opération servie (plus aucune
// `unavailable_in_v1` depuis E08-S06, sauf un compte réel ou de bac à sable), et aucune opération en deux
// temps proposée en suite. Les textes attendus sont ceux de la section « Déclaration des huit outils »
// d'E08-S02, mot pour mot : ce que lisent les hosts. Les opérations d'E08-S06 servies par une session
// ouverte tournent sur une vraie base (E01-S10, lot t1-d2a : la base des tests admin, le client de Sam,
// `asCaller`), en suite portable ; l'annonce du serveur (AC5) ne lit pas la base, et
// garde les dépendances de la base simulée, qu'aucune requête n'atteint.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { ADMIN_OPS } from "../../packages/plateforme/mcp/admin/inputs"
import { isTwoStep } from "../../packages/plateforme/mcp/admin/server"
import { buildAdminTools } from "../../packages/plateforme/mcp/admin/tools"
import { CELL_OPS } from "../../packages/plateforme/mcp/admin/tools/cell"
import { CONNECTOR_OPS } from "../../packages/plateforme/mcp/admin/tools/connector"
import { CONTEXT_OPS } from "../../packages/plateforme/mcp/admin/tools/context"
import { FEEDBACK_OPS } from "../../packages/plateforme/mcp/admin/tools/feedback"
import { JOURNAL_OPS } from "../../packages/plateforme/mcp/admin/tools/journal"
import { NODE_OPS } from "../../packages/plateforme/mcp/admin/tools/node"
import { ORG_OPS } from "../../packages/plateforme/mcp/admin/tools/org"
import { TEAM_OPS } from "../../packages/plateforme/mcp/admin/tools/team"
import { formatResult } from "../../packages/plateforme/mcp/result"
import { connectAdminMcp, simulatedAdmin } from "../helpers/mcp-admin"
import { seedAdminFixture, type AdminFixtureSql } from "../helpers/mcp-admin-sql"
import { sqlConfigured, seedWithAdmin, type SeededData, portable } from "../helpers/sql"
const NETWORK_TIMEOUT = 60_000
const SETUP_TIMEOUT = 180_000

const KEYS = ["admin_context", "admin_org", "admin_team", "admin_node", "admin_connector", "admin_journal", "admin_feedback", "admin_cell"]
const REQ = "Requires the ctx code from admin_context; call it first."

const DESCRIPTIONS: Record<string, string> = {
  admin_context:
    "Opens a platform admin session and returns the admin ctx code that every other admin_ tool requires; call it first in every admin conversation. op ctx (default): who you are, the admin tools and their operations, and the organisations you can act on. op orgs: all of them, with how you reach each one (platform access or membership) and since when. op help: the fields of each operation. A code stays valid 24 hours; nothing else is remembered between calls, so pass org = the organisation slug to every other admin_ tool. Call it only for platform administration (organisations, teams, nodes, connectors, journal, feedback, this cell). Otherwise do not call it.",
  admin_org: `${REQ} Manages organisations: list, get, create (its tool prefix never changes; admin_email names its first administrator: your own email makes you a member with the admin role, another email is invited), update name, work domains, brand or routing thresholds, add or remove an address (host), grant or revoke a platform access, name an administrator (add_admin, same rule). Pass org = the organisation slug (for create, the new slug) and people by email. create, remove_host and revoke_access first return a summary and change nothing: show it to the user, get their explicit approval, then call again with confirm: true. Call with op help for the fields of each operation.`,
  admin_team: `${REQ} Manages the teams of an organisation: list, create (from a name; the result gives the slug), rename, set the only lead or clear the leads, add or remove a lead (a team can have several), add or remove a member, delete. Pass org = the organisation slug, team = the team slug (e.g. ventes) and people by email; a person must already be a member of the organisation. delete is refused while the team owns pages or accounts, and otherwise first returns a summary and deletes nothing: show it to the user, get their explicit approval, then call again with confirm: true. Call with op help for the fields of each operation.`,
  admin_node: `${REQ} Administers the tree of an organisation: move a node (its old path stays as an alias), publish its pending draft, transfer its owner, and list, add or remove access rules on it. Pass org = the organisation slug and path = the node path (e.g. ventes/relance_devis); an owner or a rule subject is written team:<slug>, user:<email>, org or inherit. transfer_owner first returns a summary of who gains and loses control and changes nothing: show it to the user, get their explicit approval, then call again with confirm: true. Personal spaces are out of reach. Call with op help for the fields.`,
  admin_connector: `${REQ} Administers the connectors of an organisation: the catalogue and what is active, activate or deactivate a connector, list, create or disable simulated accounts (V1 has simulated accounts only), and list, add or remove access rules on an account. Pass org = the organisation slug; connectors by name (mail), accounts by label, teams by slug, people by email. deactivate and disable_account first return a summary and change nothing: show it to the user, get their explicit approval, then call again with confirm: true. Call with op help for the fields.`,
  admin_journal: `${REQ} Reads what happened, read-only: the conversations of an organisation grouped by ctx code (person, host, procedure served, calls, errors), the calls of one conversation, and the journal of this admin connector. Filters: team, person (email), errors only, last 7, 30 or 90 days; long lists come with a cursor. Argument values whose key looks like a secret are masked. Pass org = the organisation slug (optional for admin_log). Call with op help for the fields.`,
  admin_feedback: `${REQ} Handles the tickets that assistants filed with <prefix>_feedback in an organisation: list them (by state, type, last 7, 30 or 90 days) and change a ticket's state to acknowledged, resolved, declined or back to open; declined needs a resolution, which the reporter will read. Pass org = the organisation slug and ticket = the ticket number, e.g. FB-0012. Check the conversation in admin_journal before deciding: an assistant's report can be rebuilt after the fact. Call with op help for the fields.`,
  admin_cell: `${REQ} Reports on this cell, the application you are connected to and its database, read-only: the package version, the platform migrations applied, and its health (database reachable, required settings present, never their values). No org is needed. Call with op help for the fields.`,
}

const TITLES = [
  "Platform admin: Load admin context",
  "Platform admin: Organisations",
  "Platform admin: Teams",
  "Platform admin: Nodes",
  "Platform admin: Connectors",
  "Platform admin: Journal",
  "Platform admin: Feedback",
  "Platform admin: Cell",
]

const READ_ONLY = new Set(["admin_context", "admin_journal", "admin_cell"])

/** Les propriétés servies, dans l'ordre de la section « Déclaration » : elles n'évoluent que par ajout. */
const PROPERTIES: Record<string, string[]> = {
  admin_context: ["op"],
  admin_org: [
    "ctx",
    "op",
    "org",
    "name",
    "prefix",
    "host",
    "domains",
    "display_name",
    "theme",
    "logo_url",
    "routing_threshold",
    "routing_gap",
    "email",
    "reason",
    "confirm",
    "admin_email",
  ],
  admin_team: ["ctx", "op", "org", "team", "name", "email", "confirm"],
  admin_node: ["ctx", "op", "org", "path", "new_path", "owner", "subject", "level", "confirm"],
  admin_connector: ["ctx", "op", "org", "connector", "account", "owner", "mode", "subject", "level", "confirm"],
  admin_journal: ["ctx", "op", "org", "code", "team", "email", "errors", "days", "cursor"],
  admin_feedback: ["ctx", "op", "org", "ticket", "state", "type", "resolution", "days", "cursor"],
  admin_cell: ["ctx", "op"],
}

/** Les tables d'opérations des huit outils ; les cinq dernières depuis E08-S06. */
const TABLES = {
  admin_context: CONTEXT_OPS,
  admin_org: ORG_OPS,
  admin_team: TEAM_OPS,
  admin_node: NODE_OPS,
  admin_connector: CONNECTOR_OPS,
  admin_journal: JOURNAL_OPS,
  admin_feedback: FEEDBACK_OPS,
  admin_cell: CELL_OPS,
}

/** Les opérations en deux temps d'E08-S06 (N2, N4). */
const E08_S06_TWO_STEP = ["admin_node transfer_owner", "admin_connector deactivate", "admin_connector disable_account"]

type Property = { type?: string; description?: string; enum?: unknown[] }
type InputSchema = { properties: Record<string, Property>; required?: string[] }

describe("the eight admin tools (AC4)", () => {
  const tools = buildAdminTools()

  it("should list the eight tools in order, with their titles, honest annotations and no destructiveHint", () => {
    expect(tools.map((tool) => tool.name)).toEqual(KEYS)
    expect(tools.map((tool) => tool.title)).toEqual(TITLES)
    for (const tool of tools) {
      expect(tool.annotations, tool.name).toEqual({ readOnlyHint: READ_ONLY.has(tool.name), openWorldHint: false })
      expect(tool._meta, tool.name).toEqual({ securitySchemes: [{ type: "oauth2" }] })
    }
  })

  it("should serve the descriptions of the contract, each under 1,000 characters", () => {
    for (const tool of tools) {
      expect(tool.description, tool.name).toBe(DESCRIPTIONS[tool.name])
      expect(tool.description.length, tool.name).toBeLessThan(1000)
    }
    expect(tools[0].description.endsWith("Otherwise do not call it.")).toBe(true)
    for (const tool of tools.slice(1)) expect(tool.description.startsWith(`${REQ} `), tool.name).toBe(true)
  })

  it("should describe every flat property, require ctx and op on the seven, and leave op optional on admin_context", () => {
    for (const tool of tools) {
      // `toInputSchema` rend l'objet JSON Schema de `z.toJSONSchema` : des propriétés et leurs requis.
      const schema = tool.inputSchema as InputSchema
      for (const [name, property] of Object.entries(schema.properties)) {
        expect(property.description, `${tool.name}.${name}`).toBeTruthy()
        expect(["object", "array"], `${tool.name}.${name}`).not.toContain(property.type)
      }
      const opValues = schema.properties.op.enum
      // `tool.name` est l'une des huit clés, que `ToolDefinition` type en chaîne.
      expect(opValues, tool.name).toEqual([...ADMIN_OPS[tool.name as keyof typeof ADMIN_OPS]])
      if (tool.name === "admin_context") {
        expect(schema.properties.ctx).toBeUndefined()
        expect(schema.required ?? []).toEqual([])
      } else {
        expect(schema.required, tool.name).toEqual(["ctx", "op"])
      }
    }
  })

  it("should declare the properties of the contract, and every field of the operations served in V1", () => {
    // `toInputSchema` rend l'objet JSON Schema de `z.toJSONSchema` : des propriétés et leurs requis.
    const served = new Map(tools.map((tool) => [tool.name, Object.keys((tool.inputSchema as InputSchema).properties)]))
    for (const tool of tools) expect(served.get(tool.name), tool.name).toEqual(PROPERTIES[tool.name])
    for (const [tool, table] of Object.entries(TABLES)) {
      for (const [op, entry] of Object.entries(table)) {
        for (const field of Object.keys(entry.schema.shape)) expect(served.get(tool), `${tool} ${op}`).toContain(field)
      }
    }
  })

  it("should have an entry for each op of the enum of the tools served in V1, and an op for each entry", () => {
    for (const [tool, table] of Object.entries(TABLES)) {
      // `Object.entries` rend des clés en chaîne : ce sont celles de `TABLES`.
      expect(Object.keys(table).sort(), tool).toEqual([...ADMIN_OPS[tool as keyof typeof TABLES]].sort())
    }
  })
})

describe("admin server (AC5)", () => {
  it("should announce oto-platform-admin with the tools capability only and the one-sentence instructions", async () => {
    const { client } = await connectAdminMcp(simulatedAdmin().deps)
    expect(client.getServerVersion()).toEqual({ name: "oto-platform-admin", title: "Platform admin", version: "1.0.0" })
    expect(client.getServerCapabilities()).toEqual({ tools: {} })
    expect(client.getInstructions()).toBe(
      "Platform admin: call admin_context first in every conversation, because every other admin_ tool requires the ctx code it returns, and pass org = the organisation slug on every call.",
    )
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(KEYS)
  })
})

describe.skipIf(!sqlConfigured)(portable("operations of E08-S06 (AC20)"), { timeout: NETWORK_TIMEOUT }, () => {
  let seed: SeededData
  let admin: AdminFixtureSql

  beforeAll(async () => {
    seed = seedWithAdmin()
    admin = await seedAdminFixture(seed)
  }, SETUP_TIMEOUT)

  afterAll(async () => {
    try {
      await admin?.forgetJournal()
    } finally {
      await seed?.cleanup()
    }
  }, SETUP_TIMEOUT)

  it("should serve with op help the contract of every operation of the five tools, its two steps named", async () => {
    const session = await connectAdminMcp(await admin.deps("sam"))
    const { code } = await session.openAdmin()
    const steps = " (two steps: without confirm: true it returns a summary and changes nothing)"
    for (const tool of ["admin_node", "admin_connector", "admin_journal", "admin_feedback", "admin_cell"] as const) {
      const help = await session.call(tool, { ctx: code, op: "help" })
      expect(help.isError, tool).toBe(false)
      for (const [op, entry] of Object.entries(TABLES[tool]).filter(([name]) => name !== "help")) {
        expect(help.text, `${tool} ${op}`).toContain(`\nOp ${op}${entry.twoStep ? steps : ""}\n${entry.summary}\nRequired: `)
        expect(help.text, `${tool} ${op}`).toContain(`Example: ${tool} {"op":"${op}"`)
      }
    }
    expect(E08_S06_TWO_STEP.every(isTwoStep)).toBe(true)
  })

  it("should answer every operation of the eight tools, and unavailable_in_v1 only for a live or sandbox account", async () => {
    // Les opérations appelées sans leurs champs, sur la base des tests admin : refus et pannes restent au journal.
    vi.spyOn(console, "error").mockImplementation(() => {})
    const session = await connectAdminMcp(await admin.deps("sam"))
    const { code } = await session.openAdmin()
    const acme = admin.orgs.acme.slug
    for (const [tool, table] of Object.entries(TABLES).filter(([name]) => name !== "admin_context")) {
      for (const [op, entry] of Object.entries(table)) await session.call(tool, { ctx: code, op, ...("org" in entry.schema.shape ? { org: acme } : {}) })
    }
    expect(session.deps.journal.filter((line) => line.error?.startsWith("unavailable_in_v1"))).toEqual([])
    const live = await session.call("admin_connector", { ctx: code, op: "create_account", org: acme, connector: "mail", account: "Mail Live", owner: "org", mode: "sandbox" })
    expect(live).toMatchObject({
      isError: true,
      text: "mail is simulated in this version: its accounts are simulated, a sandbox account is not available. Create it with mode simule.",
    })
    vi.restoreAllMocks()
  })
})

describe("next actions (AC23, N14)", () => {
  it("should never propose an operation in two steps, whatever an operation lists", () => {
    const twoStep = ["admin_org create", "admin_org remove_host", "admin_org revoke_access", "admin_team delete", ...E08_S06_TWO_STEP]
    const result = formatResult({ text: "done", nextActions: [...twoStep, "admin_org get", "admin_team list"] }, isTwoStep)
    expect(result.structuredContent?.next_actions).toEqual(["admin_org get", "admin_team list"])
    expect(result.content[0].text).toBe(result.structuredContent?.text)
  })
})
