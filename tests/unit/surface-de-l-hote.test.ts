// @vitest-environment node
// La surface qu'un hôte déclare servir à un assistant (`registerHostSurface`) : fonctions du paquet en liste fermée,
// capacités MCP facultatives, téléchargement d'une adresse fournie. Sans base : le registre, la porte MCP par
// InMemoryTransport, et `fetchSource` avec un réseau qui lève s'il est joint.
import * as z from "zod/v4"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { McpDeps } from "../../packages/plateforme/mcp/server"
import { buildTools } from "../../packages/plateforme/mcp/tools"
import { CatalogRegistrationError, defineErpFunction, registerFunctions } from "../../packages/plateforme/server/catalog/erp"
import { assistantFunctions, callExamples, catalogFunctions, catalogNames, findFunction, packageFunctions } from "../../packages/plateforme/server/catalog/registry"
import { registerHostSurface } from "../../packages/plateforme/server/catalog/surface"
import type { PlatformDb } from "../../packages/plateforme/server/db"
import type { Identity } from "../../packages/plateforme/server/identity"
import { fetchSource, SOURCE_FAILURES } from "../../packages/plateforme/server/uploads-fetch"
import { connectDeps } from "../helpers/mcp"

const ORG = { id: "org-1", slug: "acme", name: "Acme Énergies", prefix: "acme", brand: {}, domains: null }
const IDENTITY: Identity = {
  org: ORG,
  user: { id: "user-1", email: "claire@example.test", name: "Claire Morel" },
  member: { role: "member", profile: {} },
  teams: [],
  isStaff: false,
  viaGrant: false,
  hasOpenGrant: false,
}

// La base de ces tests est intouchable : un Proxy vide n'a pas le type du client, l'assertion le fait passer pour lui.
const untouchable = new Proxy(
  {},
  {
    get() {
      throw new Error("database touched")
    },
  },
) as unknown as PlatformDb

const deps = (): McpDeps => ({ db: untouchable, org: ORG, caller: { kind: "member", identity: IDENTITY }, userAgent: "unit-test", journal: [], activeConnectors: () => Promise.resolve(new Set<string>()), origin: "https://acme.test" })

// Dans l'ordre du catalogue, que la déclaration ne change pas.
const KEPT = ["table.schema", "table.rows", "node.access"]
const closed = (over: Partial<Parameters<typeof registerHostSurface>[0] & object> = {}) => registerHostSurface({ functions: KEPT, capabilities: [], fetchCallerUrls: false, ...over })

afterEach(() => {
  registerHostSurface(null)
  registerFunctions([])
})

describe("registerHostSurface", () => {
  it("should serve an assistant the named functions of the package only, the whole catalog staying for the host's server", () => {
    const all = assistantFunctions().map((fn) => fn.name)
    closed()
    expect(assistantFunctions().map((fn) => fn.name)).toEqual(KEPT)
    expect([...catalogNames()]).toEqual(KEPT)
    // Ce que `call` et `read` cherchent : une fonction fermée est inconnue, sa suite (`node.share` après `node.access`) aussi.
    expect(["node.share", "upload.link", "node.import_tree"].map((name) => findFunction(assistantFunctions(), name))).toEqual([null, null, null])
    expect(catalogFunctions().map((fn) => fn.name)).toEqual(packageFunctions().map((fn) => fn.name))

    registerHostSurface(null)
    expect(assistantFunctions().map((fn) => fn.name)).toEqual(all)
  })

  it("should keep serving the functions the host registers itself, which the closed list does not name", () => {
    registerFunctions([defineErpFunction({ name: "erp.lookup_customer", class: "read", description: "Reads a customer of the ERP by its code.", schema: z.strictObject({ code: z.string().min(1) }), examples: [{ code: "C-001" }], run: async () => ({ text: "ok" }) })])
    closed()
    expect(assistantFunctions().map((fn) => fn.name)).toEqual([...KEPT, "erp.lookup_customer"])
  })

  it("should refuse a name that is not a function of the package and an unknown capability, declaring nothing", () => {
    const refusals = [
      () => registerHostSurface({ functions: ["table.rows", "table.inconnue"], capabilities: [], fetchCallerUrls: true }),
      // Une capacité hors de la liste fermée : le type la refuse, l'hôte en JavaScript non.
      () => registerHostSurface({ functions: [], capabilities: ["sampling" as "prompts"], fetchCallerUrls: true }),
    ].map((register) => {
      try {
        register()
        return null
      } catch (error) {
        return error instanceof CatalogRegistrationError ? error.message : String(error)
      }
    })
    expect(refusals[0]).toContain("not a function of the package: table.inconnue.")
    expect(refusals[1]).toBe("registerHostSurface: unknown capability sampling. Capabilities: prompts, resources.")
    expect(assistantFunctions()).toHaveLength(packageFunctions().length)
  })

  it("should cite in the tools only the functions served, and nothing else changes when all are", async () => {
    const examples = callExamples(catalogFunctions(), new Set())
    const open = buildTools(ORG, examples)
    expect(buildTools(ORG, examples, { served: catalogNames() })).toEqual(open)

    closed()
    const { tools } = await (await connectDeps(deps())).client.listTools()
    const text = tools.map((tool) => tool.description).join("\n")
    expect(tools.map((tool) => tool.name)).toEqual(open.map((tool) => tool.name))
    expect(["upload.link", "node.move", "node.write_many"].filter((name) => text.includes(name))).toEqual([])
    expect(text).toContain("table.rows")
  })

  it("should not serve the prompts a host closed, and serve them to a host that names them", async () => {
    closed()
    const without = await connectDeps(deps())
    expect(without.client.getServerCapabilities()).toEqual({ tools: {} })
    await expect(without.client.listPrompts()).rejects.toThrow()

    closed({ capabilities: ["prompts"] })
    expect((await connectDeps(deps())).client.getServerCapabilities()).toMatchObject({ tools: {}, prompts: {} })
  })

  it("should send no request to an address a caller gives once the host closed it", async () => {
    const get = vi.fn(() => {
      throw new Error("network touched")
    })
    const resolve = vi.fn(async () => [{ address: "93.184.216.34", family: 4 }])
    closed()
    expect(await fetchSource("https://files.example.org/notes.md", { resolve, get })).toEqual({ failure: SOURCE_FAILURES.closed })
    expect([resolve.mock.calls.length, get.mock.calls.length]).toEqual([0, 0])
  })
})
