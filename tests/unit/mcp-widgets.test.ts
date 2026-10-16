// @vitest-environment node
// Le widget routeur à la porte (story widgets-dans-la-conversation, lot 1) : l'interrupteur `widgets`, la triple
// méta de `call` et `read`, les deux resources du bundle, la vue d'un résultat au thème de la personne. Le vrai SDK
// par InMemoryTransport ; aucune base : `runCall` et la garde du `ctx` sont doublés, leur travail en base est joué
// par leurs propres suites (`calls.test.ts`, `tables-rows.test.ts`).
import { afterEach, describe, expect, it, vi } from "vitest"
import * as z from "zod/v4"
import type { McpDeps } from "../../packages/plateforme/mcp/server"
import { serverOptions } from "../../packages/plateforme/mcp/server"
import { buildTools } from "../../packages/plateforme/mcp/tools"
import { readWidgetResource, widgetMeta } from "../../packages/plateforme/mcp/widget-meta"
import { VIEW_HTML } from "../../packages/plateforme/mcp/widgets/generated"
import { runCall } from "../../packages/plateforme/server/calls"
import type { CatalogFunction } from "../../packages/plateforme/server/catalog/define"
import { callExamples, catalogFunctions } from "../../packages/plateforme/server/catalog/registry"
import { requireCtx } from "../../packages/plateforme/server/ctx"
import type { PlatformDb } from "../../packages/plateforme/server/db"
import type { Identity } from "../../packages/plateforme/server/identity"
import { connectDeps } from "../helpers/mcp"

vi.mock("../../packages/plateforme/server/ctx", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../packages/plateforme/server/ctx")>()
  return { ...original, requireCtx: vi.fn(original.requireCtx) }
})

// `runCall` rend ce que le test lui fait rendre : la porte seule est jugée ici (vue, thème, interrupteur).
vi.mock("../../packages/plateforme/server/calls", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../packages/plateforme/server/calls")>()
  return { ...original, runCall: vi.fn(original.runCall) }
})

const ORG = { id: "org-1", slug: "acme", name: "Acme Énergies", prefix: "acme", brand: { theme: "lagune" }, domains: null }
const IDENTITY: Identity = {
  org: ORG,
  user: { id: "user-1", email: "claire@example.test", name: "Claire Morel" },
  member: { role: "member", profile: {} },
  teams: [],
  isStaff: false,
  viaGrant: false,
  hasOpenGrant: false,
}
const CTX = "AAAA-BBBB"
const ROWS = { function: "table.rows", team: null, result: { table: "ventes/prospects", total: 1, offset: 0, rows: [{ key: "Valbrune", revision: 1, set: { ville: "Valbrune" } }] } }

// Toute lecture ou écriture en base lève : ce qui passe ici ne l'a pas touchée. Un Proxy vide n'a pas le type du
// client : l'assertion le fait passer pour lui.
const untouchable = new Proxy(
  {},
  {
    get() {
      throw new Error("database touched")
    },
  },
) as unknown as PlatformDb

function deps(options: { widgets?: boolean; identity?: Identity } = {}): McpDeps {
  const caller = { kind: "member" as const, identity: options.identity ?? IDENTITY }
  return { db: untouchable, org: ORG, caller, userAgent: "unit-test", journal: [], activeConnectors: () => Promise.resolve(new Set<string>()), origin: "https://acme.test", widgets: options.widgets }
}

/** `call table.rows` sous un `ctx` accepté, `runCall` rendant une ligne et la vue `record`. */
async function callRows(session: Awaited<ReturnType<typeof connectDeps>>) {
  vi.mocked(requireCtx).mockResolvedValueOnce({ code: CTX, host: null })
  vi.mocked(runCall).mockResolvedValueOnce({ text: "ventes/prospects: 1 row(s) match; rows 1-1.", data: ROWS, nextActions: [], view: "record" })
  const { result } = await session.call("call", { ctx: CTX, function: "table.rows", arguments: { table: "ventes/prospects" } })
  return result.structuredContent
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("widgets off (the default)", () => {
  it("should serve the frozen list and capabilities, no resources, and no view in a result", async () => {
    const session = await connectDeps(deps())
    expect(session.client.getServerCapabilities()).toEqual({ tools: {}, prompts: {} })
    const { tools } = await session.client.listTools()
    for (const tool of tools) expect(tool._meta, tool.name).toEqual({ securitySchemes: [{ type: "oauth2" }] })
    await expect(session.client.listResources()).rejects.toThrow()
    expect(await callRows(session)).toEqual({ ...ROWS, text: "ventes/prospects: 1 row(s) match; rows 1-1.", next_actions: [] })
  })
})

describe("widgets on", () => {
  it("should add the triple meta to call and read only, the rest of the contract unchanged", () => {
    const examples = callExamples(catalogFunctions(), new Set())
    const off = buildTools(ORG, examples)
    const on = buildTools(ORG, examples, { widgets: true })
    const contract = (tool: object) => Object.fromEntries(Object.entries(tool).filter(([key]) => key !== "_meta"))
    expect(on.map(contract)).toEqual(off.map(contract))
    const widget = { securitySchemes: [{ type: "oauth2" }], ...widgetMeta() }
    expect(on.map((tool) => [tool.name, tool._meta])).toEqual(off.map((tool) => [tool.name, ["acme_call", "acme_read"].includes(tool.name) ? widget : tool._meta]))
    expect(widgetMeta()).toEqual({ ui: { resourceUri: "ui://oto/view.html" }, "ui/resourceUri": "ui://oto/view.html", "openai/outputTemplate": "ui://oto/view-skybridge.html" })
    expect(serverOptions(ORG, { widgets: true }).capabilities).toEqual({ tools: {}, prompts: {}, resources: {} })
  })

  it("should list the two variants of the bundle and read the same HTML under each MIME type, journaled", async () => {
    const session = await connectDeps(deps({ widgets: true }))
    const { resources } = await session.client.listResources()
    expect(resources.map(({ uri, mimeType }) => [uri, mimeType])).toEqual([
      ["ui://oto/view.html", "text/html;profile=mcp-app"],
      ["ui://oto/view-skybridge.html", "text/html+skybridge"],
    ])
    for (const { uri, mimeType } of resources) {
      const { contents } = await session.client.readResource({ uri })
      expect(contents).toEqual([{ uri, mimeType, text: VIEW_HTML }])
    }
    expect(session.journal.map((line) => [line.method, line.target ?? null])).toEqual([
      ["resources/list", null],
      ["resources/read", "ui://oto/view.html"],
      ["resources/read", "ui://oto/view-skybridge.html"],
    ])
  })

  // Les hosts sandboxent le widget sous une CSP sans requête externe (`mcp-patterns.md § 5.3`) : tout est inliné.
  it("should load no external script, style, image or font in the bundle", () => {
    expect(VIEW_HTML.startsWith("<!doctype html>")).toBe(true)
    for (const external of [/<script[^>]*\ssrc=/i, /<link[^>]*\shref=/i, /\ssrc=["']?https?:/i, /url\(\s*["']?https?:/i, /@import\s+(url\()?["']?https?:/i]) {
      expect(VIEW_HTML, String(external)).not.toMatch(external)
    }
  })

  it("should refuse an unknown resource with -32002, journaled", async () => {
    const session = await connectDeps(deps({ widgets: true }))
    await expect(session.client.readResource({ uri: "ui://oto/other.html" })).rejects.toMatchObject({ code: -32002, message: expect.stringContaining("Unknown resource ui://oto/other.html.") })
    expect(readWidgetResource("ui://oto/other.html")).toBeNull()
    expect(session.journal).toEqual([expect.objectContaining({ method: "resources/read", target: "ui://oto/other.html", is_error: true, error: "not_found: Unknown resource ui://oto/other.html." })])
  })

  it("should serve a result's view under the person's theme, else the organisation's, its data unchanged", async () => {
    const byOrg = await callRows(await connectDeps(deps({ widgets: true })))
    expect(byOrg).toEqual({ ...ROWS, view: { kind: "record", theme: "lagune", call: "acme_call" }, text: "ventes/prospects: 1 row(s) match; rows 1-1.", next_actions: [] })
    const chosen = { ...IDENTITY, member: { role: "member" as const, profile: { theme: "cobalt" } } }
    expect(await callRows(await connectDeps(deps({ widgets: true, identity: chosen })))).toMatchObject({ view: { kind: "record", theme: "cobalt", call: "acme_call" } })
  })
})

describe("runCall: the view of a function", () => {
  it("should copy the view the function returns, else pose erp:<name> for the view it declares, else none", async () => {
    const reader = (view?: "table", erpView?: string): CatalogFunction => ({
      name: "test.rows",
      connector: "test",
      class: "read",
      origin: "paquet",
      description: "Reads test rows.",
      schema: z.strictObject({ table: z.string() }),
      examples: [],
      refusals: [],
      ...(erpView ? { view: erpView } : {}),
      run: async () => ({ text: "rows", data: { rows: [] }, ...(view ? { view } : {}) }),
    })
    const actual = await vi.importActual<typeof import("../../packages/plateforme/server/calls")>("../../packages/plateforme/server/calls")
    const run = (fn: CatalogFunction) =>
      actual.runCall(
        { db: untouchable, identity: IDENTITY, ctxCode: null, origin: "https://acme.test", activeConnectors: () => Promise.resolve(new Set()), functions: [fn] },
        { function: "test.rows", arguments: { table: "ventes/prospects" } },
      )
    expect((await run(reader("table"))).view).toBe("table")
    expect((await run(reader())).view).toBeUndefined()
    // Une fonction qui déclare une vue de l'hôte la reçoit, sauf si elle rend elle-même une vue du paquet.
    expect((await run(reader(undefined, "devis"))).view).toBe("erp:devis")
    expect((await run(reader("table", "devis"))).view).toBe("table")
  })
})
