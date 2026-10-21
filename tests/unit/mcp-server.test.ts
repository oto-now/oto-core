// @vitest-environment node
// Adaptateur MCP sans base (E03-S01, AC5, AC9, AC11, AC14, AC15 ; E03-S05, AC8, AC10, AC11) : le vrai
// SDK par InMemoryTransport, une identité fabriquée, et un client de base qui lève dès qu'on le
// touche. Tout ce qui se décide avant la base (gardes, refus, prompts, identité du serveur) est
// vérifié ici, même sans Supabase.
import { afterEach, describe, expect, it, vi } from "vitest"
import pkg from "../../packages/plateforme/package.json"
import type { McpDeps } from "../../packages/plateforme/mcp/server"
import { MAX_RESULT_CHARS } from "../../packages/plateforme/mcp/result"
import { buildTools, serverInstructions } from "../../packages/plateforme/mcp/tools"
import { callExamples, catalogFunctions } from "../../packages/plateforme/server/catalog/registry"
import { requireCtx } from "../../packages/plateforme/server/ctx"
import type { PlatformDb } from "../../packages/plateforme/server/db"
import { PlatformError } from "../../packages/plateforme/server/errors"
import type { Identity } from "../../packages/plateforme/server/identity"
import { getPrompt, listPrompts } from "../../packages/plateforme/server/prompts"
import { connectDeps } from "../helpers/mcp"

// `requireCtx` reste le vrai (forme vérifiée avant la base), sauf quand un test lui fait accepter
// un code : la base de ces tests est intouchable.
vi.mock("../../packages/plateforme/server/ctx", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../packages/plateforme/server/ctx")>()
  return { ...original, requireCtx: vi.fn(original.requireCtx) }
})

// Services des prompts : les vrais lisent la base ; un test leur fait rendre ou lever ce qu'il faut
// pour juger la porte seule (E03-S05). Leur lecture en base est jouée par `feedback-prompts.test.ts`.
vi.mock("../../packages/plateforme/server/prompts", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../packages/plateforme/server/prompts")>()
  return { ...original, listPrompts: vi.fn(original.listPrompts), getPrompt: vi.fn(original.getPrompt) }
})

const ORG = {
  id: "org-1",
  slug: "acme",
  name: "Acme Énergies",
  prefix: "acme",
  brand: {},
  domains: "sales, customer support, energy consulting",
}
const IDENTITY: Identity = {
  org: ORG,
  user: { id: "user-1", email: "claire@example.test", name: "Claire Morel" },
  member: { role: "member", profile: {} },
  teams: [],
  isStaff: false,
  viaGrant: false,
  hasOpenGrant: false,
}
const MISSING_CTX = "Missing or unknown ctx. Call acme_context first and pass its ctx code."
const INTERNAL = "Internal error. Retry once, then report it with acme_feedback (type error)."
const REFUSAL = "You are signed in as outsider@example.test but you are not a member of Acme Énergies. Ask an administrator of Acme Énergies to add you."

// Toute lecture ou écriture en base lève : ce qui passe ici ne l'a pas touchée. Un Proxy vide n'a
// pas le type du client : l'assertion le fait passer pour lui.
const untouchable = new Proxy(
  {},
  {
    get() {
      throw new Error("database touched")
    },
  },
) as unknown as PlatformDb

function deps(caller: McpDeps["caller"], active: ReadonlySet<string> = new Set()): McpDeps {
  return { db: untouchable, org: ORG, caller, userAgent: "unit-test", journal: [], activeConnectors: () => Promise.resolve(active), origin: "https://acme.test" }
}

const member = () => connectDeps(deps({ kind: "member", identity: IDENTITY }))

afterEach(() => {
  vi.restoreAllMocks()
})

describe("initialize (AC9)", () => {
  it("should announce oto-platform, titled by the organisation, with tools, prompts and one-sentence instructions", async () => {
    const { client } = await member()
    expect(client.getServerVersion()).toEqual({ name: "oto-platform", title: "Acme Énergies", version: pkg.version })
    expect(client.getServerCapabilities()).toMatchObject({ tools: {}, prompts: {} })
    expect(client.getInstructions()).toBe(serverInstructions(ORG))
  })
})

describe("tools/list (AC6)", () => {
  it("should serve the six tools of the contract through the protocol, and journal the list", async () => {
    const session = await member()
    const { tools } = await session.client.listTools()
    // Sans connecteur actif, `call` cite les fonctions natives toujours actives (`table.rows`, E07-S01).
    const expected = buildTools(ORG, callExamples(catalogFunctions(), new Set()))
    expect(tools.map((tool) => tool.name)).toEqual(expected.map((tool) => tool.name))
    for (const [index, tool] of tools.entries()) {
      expect(tool).toMatchObject({
        title: expected[index].title,
        description: expected[index].description,
        annotations: expected[index].annotations,
        _meta: expected[index]._meta,
        inputSchema: expected[index].inputSchema,
      })
    }
    expect(session.journal).toEqual([
      expect.objectContaining({
        org_id: "org-1",
        user_id: "user-1",
        user_agent: "unit-test",
        method: "tools/list",
        args: {},
        args_chars: 2,
        result_chars: JSON.stringify(expected).length,
      }),
    ])
    expect(session.journal[0].duration_ms).toBeGreaterThanOrEqual(0)
  })
})

describe("tools/list with the organisation's active connectors (E04-S01, AC22)", () => {
  it("should cite a function of each active connector in the call description, never a sensitive one", async () => {
    const { client } = await connectDeps(deps({ kind: "member", identity: IDENTITY }, new Set(["mail"])))
    const description = (await client.listTools()).tools.find((tool) => tool.name === "acme_call")?.description
    expect(description).toContain("Acme Énergies's catalog (e.g. mail.create_draft, table.rows)")
    expect(description).not.toContain("mail.send_draft")
  })

  it("should serve the tools without connector examples, logged on the server, when the connectors cannot be read (N38)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    const failing = { ...deps({ kind: "member", identity: IDENTITY }), activeConnectors: () => Promise.reject(new PlatformError("internal", "Internal error.")) }
    const session = await connectDeps(failing)
    const call = (tools: { name: string; description?: string }[]) => tools.find((tool) => tool.name === "acme_call")?.description
    expect(call((await session.client.listTools()).tools)).toBe(call(buildTools(ORG, callExamples(catalogFunctions(), new Set()))))
    expect(log).toHaveBeenCalledWith("[platform] mcp: tools/list served without connector examples", "internal")
    expect(session.journal).toEqual([expect.objectContaining({ method: "tools/list" })])
    expect(session.journal[0].is_error).toBeUndefined()
  })
})

describe("find with the organisation's active connectors (E03-S02 with E04-S01)", () => {
  it("should search the functions of the connectors read for the request, and theirs only", async () => {
    // Réconciliation d'E03-S02 avec E04-S01 (M13a) : `find` reçoit l'ensemble lu par `activeConnectors`.
    // Sans connecteur actif, `mail.create_draft` ne se trouve pas ; un ensemble vide passé à la place
    // de l'ensemble lu ferait échouer la première attente, un catalogue non filtré la seconde.
    const found = async (active: ReadonlySet<string>) => {
      vi.mocked(requireCtx).mockResolvedValueOnce({ code: "AAAA-BBBB", host: null })
      const session = await connectDeps(deps({ kind: "member", identity: IDENTITY }, active))
      return (await session.call("find", { ctx: "AAAA-BBBB", query: "mail.create_draft", type: "function" })).text
    }
    expect(await found(new Set(["mail"]))).toMatch(/^Top functions for « mail\.create_draft »:\n1\. mail\.create_draft \(write, score 1\.00\): /)
    // Les fonctions natives des tableaux (E07-S01) restent cherchables sans connecteur : seule compte
    // l'absence de `mail.create_draft` dans la réponse.
    expect(await found(new Set())).not.toMatch(/\d+\. mail\.create_draft \(/)
  })
})

describe("tools/call guards before the database (AC11, AC15)", () => {
  it("should refuse an unknown tool, another prefix included, naming the prefix", async () => {
    const session = await member()
    for (const name of ["acme_delete", "delta_find"]) {
      const refused = await session.callNamed(name, { ctx: "AAAA-BBBB" })
      expect(refused.isError, name).toBe(true)
      expect(refused.text, name).toBe(`Unknown tool ${name}. The tools of this server all start with acme_.`)
    }
    expect(session.journal[0]).toMatchObject({
      method: "tools/call",
      tool: "acme_delete",
      ctx: "AAAA-BBBB",
      is_error: true,
      error: "not_found: Unknown tool acme_delete. The tools of this server all start with acme_.",
    })
  })

  it("should refuse arguments over 1,000,000 characters before the ctx", async () => {
    const session = await member()
    const args = { ctx: "AAAA-BBBB", type: "gap", text: "x".repeat(1_000_000) }
    const refused = await session.call("feedback", args)
    const size = JSON.stringify(args).length
    expect(refused.text).toBe(`Arguments too large (${size} characters, max 1000000). Split the content into several calls.`)
    expect(session.journal[0]).toMatchObject({ is_error: true, args_chars: size, args: { _truncated: true } })
  })

  it("should refuse a missing or malformed ctx before validating the other fields", async () => {
    const session = await member()
    for (const tool of ["find", "read", "call", "write", "feedback"]) {
      const refused = await session.call(tool, {})
      expect(refused.isError, tool).toBe(true)
      expect(refused.text, tool).toBe(MISSING_CTX)
    }
    const huge = await session.call("feedback", { ctx: "X".repeat(100_000), type: "gap", text: "x" })
    expect(huge.text).toBe(MISSING_CTX)
    expect(session.journal.map((line) => [line.ctx, line.error])).toEqual(
      Array.from({ length: 6 }, () => [null, `ctx_missing: ${MISSING_CTX}`]),
    )
  })

  // Revue du cycle 1 : 1 000 opérations fausses donnaient un refus de 117 922 caractères.
  it("should list the first 20 invalid arguments, count the others, and stay under 45,000 characters (AC14)", async () => {
    vi.mocked(requireCtx).mockResolvedValueOnce({ code: "AAAA-BBBB", host: null })
    const session = await member()
    const ops = Array.from({ length: 1000 }, () => ({ op: "bogus", section: "Étapes", text: "x" }))
    const refused = await session.call("write", { ctx: "AAAA-BBBB", path: "conseil/cr_client", ops })
    expect(refused.isError).toBe(true)
    expect(refused.text.startsWith("Invalid arguments for acme_write: ops.0.op: ")).toBe(true)
    expect(refused.text.match(/ops\.\d+\.op: /g)).toHaveLength(20)
    expect(refused.text.endsWith("; … and 980 more")).toBe(true)
    expect(JSON.stringify(refused.text).length).toBeLessThanOrEqual(MAX_RESULT_CHARS)
    expect(session.journal[0].error?.startsWith("invalid_arguments: Invalid arguments for acme_write: ops.0.op: ")).toBe(true)
    expect(session.journal[0].result_chars).toBe(refused.text.length)
  })

  it("should hide an unexpected failure behind the internal message, logged on the server only", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    const session = await member()
    const failed = await session.call("context", { phrase: "Relance les devis en attente" })
    expect(failed.isError).toBe(true)
    expect(failed.text).toBe(INTERNAL)
    expect(failed.result.structuredContent).toBeUndefined()
    expect(log).toHaveBeenCalledWith("[platform] mcp: tools/call failed", expect.any(Error))
    expect(session.journal[0]).toMatchObject({ is_error: true, error: `internal: ${INTERNAL}`, result_chars: INTERNAL.length })
  })
})

describe("prompts of the procedures (E03-S05: AC8, AC10, AC11)", () => {
  const PROMPT = {
    name: "relance_devis",
    title: "Relancer les devis en attente",
    description: "Relance par email les devis envoyés sans réponse depuis 7 jours ou plus, après accord de la personne.",
  }

  it("should list the prompts of the caller's identity by name, title and description, and journal the list", async () => {
    vi.mocked(listPrompts).mockResolvedValueOnce([PROMPT])
    const session = await member()
    expect(await session.client.listPrompts()).toEqual({ prompts: [PROMPT] })
    expect(vi.mocked(listPrompts).mock.calls[0][1]).toBe(IDENTITY)
    expect(session.journal).toEqual([expect.objectContaining({ method: "prompts/list", result_chars: JSON.stringify([PROMPT]).length })])
  })

  it("should serve a prompt as one message of the person, the procedure's title, and journal its name", async () => {
    vi.mocked(getPrompt).mockResolvedValueOnce({ description: PROMPT.description, text: PROMPT.title })
    const session = await member()
    const expected = {
      description: PROMPT.description,
      messages: [{ role: "user", content: { type: "text", text: PROMPT.title } }],
    }
    expect(await session.client.getPrompt({ name: "relance_devis" })).toEqual(expected)
    expect(vi.mocked(getPrompt).mock.calls[0].slice(1)).toEqual([IDENTITY, "relance_devis"])
    expect(session.journal).toEqual([
      expect.objectContaining({ method: "prompts/get", target: "relance_devis", result_chars: JSON.stringify(expected).length }),
    ])
    expect(session.journal[0].is_error).toBeUndefined()
  })

  it("should answer an unknown prompt with JSON-RPC -32602 and its exact message, journaled as not_found", async () => {
    vi.mocked(getPrompt).mockRejectedValueOnce(new PlatformError("not_found", "Unknown prompt relance."))
    const session = await member()
    // Le client préfixe « MCP error <code>: » : un seul préfixe prouve le message exact sur le fil.
    await expect(session.client.getPrompt({ name: "relance" })).rejects.toMatchObject({
      code: -32602,
      message: "MCP error -32602: Unknown prompt relance.",
    })
    expect(session.journal).toEqual([
      expect.objectContaining({
        method: "prompts/get",
        target: "relance",
        is_error: true,
        error: "not_found: Unknown prompt relance.",
        result_chars: "Unknown prompt relance.".length,
      }),
    ])
  })

  it("should hide a failure behind JSON-RPC -32603, logged on the server only, and journal it", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    vi.mocked(listPrompts).mockRejectedValueOnce(new Error("socket hang up"))
    const session = await member()
    await expect(session.client.listPrompts()).rejects.toMatchObject({ code: -32603, message: "MCP error -32603: Internal error." })
    expect(log).toHaveBeenCalledWith("[platform] mcp: prompts/list failed", expect.any(Error))
    expect(session.journal).toEqual([
      expect.objectContaining({ method: "prompts/list", is_error: true, error: "internal: Internal error." }),
    ])
  })

  it("should serve an outsider no prompt: an unknown name, without the database nor the journal (N5)", async () => {
    const session = await connectDeps(deps({ kind: "not_member", refusal: REFUSAL }))
    await expect(session.client.getPrompt({ name: "relance_devis" })).rejects.toMatchObject({
      code: -32602,
      message: "MCP error -32602: Unknown prompt relance_devis.",
    })
    expect(vi.mocked(getPrompt)).not.toHaveBeenCalled()
    expect(session.journal).toEqual([])
  })
})

// La personne qui n'est pas membre (AC5) : la liste servie, chaque appel refusé, aucun prompt, rien au journal,
// prouvés sur une vraie base par `tests/integration/mcp-core.test.ts` (suite portable).
