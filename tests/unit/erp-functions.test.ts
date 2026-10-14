// @vitest-environment node
// Fonctions de l'ERP par les six outils (E08-S05, AC4 à AC11) : le vrai SDK par InMemoryTransport, la porte
// câblée par `resolveMcpRequest` comme la route (`connectMcp`), sur une base réelle (E01-S10, lot t1-d1) :
// O de la fixture de référence, et le client de la personne (`asCaller`), espionné, que
// rend `createPlatformDb` à la porte ; le jeton de la requête de M ou de N est celui que la porte a vérifié.
// Trois fonctions de test inscrites par `registerFunctions`, comme un ERP : lecture, écriture avec suites,
// sensible.
import * as z from "zod/v4"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { buildTools } from "../../packages/plateforme/mcp/tools"
import type { BlockInput } from "../../packages/plateforme/schemas"
import { defineErpFunction, registerFunctions } from "../../packages/plateforme/server/catalog/erp"
import { createPlatformDb } from "../../packages/plateforme/server/db"
import { PlatformError } from "../../packages/plateforme/server/errors"
import { tableSchema } from "../../packages/plateforme/server/tables/schema"
import { connectDeps, connectMcp } from "../helpers/mcp"
import { addBlocks, contentTables, nodeId, openDraftRow, ORG, PEOPLE } from "../helpers/reference-org"
import { seedReferenceTables, type ReferenceOrgSql } from "../helpers/reference-org-sql"
import type { Tables } from "../helpers/simulated-db"
import { namesOf, sqlConfigured, recordDb, seedWithAdmin, type SeededData, type SentRequest, portable } from "../helpers/sql"

// Le vrai par défaut : la fixture ouvre ainsi le client de chaque personne ; la porte reçoit celui du test (`session`).
vi.mock("../../packages/plateforme/server/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../packages/plateforme/server/db")>()
  return { ...original, createPlatformDb: vi.fn(original.createPlatformDb) }
})

type Member = "claire" | "paul"

/** Claire (Ventes, son équipe par défaut) et Paul (Support) ; un code `ctx` et un jeton chacun. */
const CTX: Record<Member, string> = { claire: "7K3Q-M2XA", paul: "8M4R-N3YB" }
const TOKENS: Record<Member, string> = { claire: "token-of-claire", paul: "token-of-paul" }
const PROCEDURE = "ventes/facturer"

/** Ce que les fonctions de test ont exécuté, dans l'ordre : `run` ne court jamais sans que le test le voie. */
const runs: string[] = []

const lookupCustomer = defineErpFunction({
  name: "erp.lookup_customer",
  class: "read",
  description: "Reads a customer of the ERP by its code: name and city.",
  schema: z.strictObject({ code: z.string().min(1).describe("Customer code, e.g. C-001.") }),
  examples: [{ code: "C-001" }],
  refusals: ["Unknown customer: no customer has this code."],
  run: async (context, args) => {
    runs.push(`lookup ${args.code}`)
    if (args.code === "C-999") throw new PlatformError("not_found", "Unknown customer C-999.")
    if (args.code === "C-500") throw new Error("ERP database unreachable at 10.0.0.7:5432")
    if (args.code === "C-503") throw new PlatformError("internal", "ERP invoice queue stalled.")
    return {
      text: `Customer ${args.code} read for ${context.identity.user.email} under token ${context.accessToken}.`,
      data: { customer: args.code, read_by: context.identity.user.id, token: context.accessToken },
    }
  },
})

const createInvoice = defineErpFunction({
  name: "erp.create_invoice",
  class: "write",
  description: "Creates an invoice of the ERP for a customer.",
  schema: z.strictObject({ customer: z.string().min(1), amount: z.number().positive() }),
  examples: [{ customer: "C-001", amount: 100 }],
  next: ["erp.send_invoice", "erp.lookup_customer"],
  run: async (_context, args) => {
    runs.push(`create ${args.customer}`)
    return { text: `Invoice F-0001 created for ${args.customer}.`, data: { invoice: "F-0001" } }
  },
})

const sendInvoice = defineErpFunction({
  name: "erp.send_invoice",
  class: "sensitive",
  description: "Sends an invoice of the ERP to its customer by email.",
  schema: z.strictObject({ invoice: z.string().min(1) }),
  examples: [{ invoice: "F-0001" }],
  summarize: async (_context, args) => ({ text: `About to send invoice ${args.invoice} to Valbrune (compta@valbrune.test).`, data: { invoice: args.invoice } }),
  run: async (_context, args) => {
    runs.push(`send ${args.invoice}`)
    return { text: `Invoice ${args.invoice} sent.` }
  },
})

beforeAll(() => {
  registerFunctions([lookupCustomer, createInvoice, sendInvoice])
})

afterAll(() => {
  registerFunctions([])
})

beforeEach(() => {
  runs.length = 0
})

afterEach(() => {
  vi.restoreAllMocks()
})

const heading = (text: string): BlockInput => ({ type: "heading", text, data: { level: 1 } })
const steps = (items: string[]): BlockInput => ({ type: "list", text: null, data: { items, ordered: true } })

/** O, ses codes `ctx`, et la procédure `ventes/facturer` publiée dont le brouillon appelle `erp.create_invoice` avec `args`. */
function erpTables(args: Record<string, unknown> = { customer: "C-001", amount: 100 }): Tables {
  const tables = contentTables([], [{ path: PROCEDURE, kind: "procedure", title: "Facturer un client", summary: "Crée la facture d'un client." }])
  tables.orgs[0].rules_version = 1
  tables.ctx = (["claire", "paul"] as const).map((person) => ({ code: CTX[person], org_id: ORG.id, user_id: PEOPLE[person].id, rules_version: 1, host: null }))
  addBlocks(tables, PROCEDURE, "published", [heading("Étapes"), steps(["Annonce."])])
  openDraftRow(tables, PROCEDURE)
  addBlocks(tables, PROCEDURE, "draft", [heading("Étapes"), steps(["Crée la facture :"]), { type: "call", text: null, data: { function: "erp.create_invoice", args } }])
  return tables
}

const publishCalls = (requests: readonly SentRequest[]) => requests.filter((sent) => namesOf(sent).includes("publish_node"))

describe.skipIf(!sqlConfigured)(portable("ERP functions on a real database (E08-S05)"), { timeout: 60_000 }, () => {
  let seed: SeededData
  let ref: ReferenceOrgSql

  beforeAll(async () => {
    seed = seedWithAdmin()
    ref = await seedReferenceTables(seed, erpTables())
  }, 180_000)

  afterAll(async () => {
    await seed?.cleanup()
  }, 180_000)

  /** La consigne d'une panne, servie au modèle sous le préfixe de l'organisation. */
  const internal = () => `Internal error. Retry once, then report it with ${ref.org.prefix}_feedback (type error).`

  /**
   * La session MCP de `person` sur l'adresse d'O, résolue par la porte au jeton de sa requête : la porte
   * reçoit le client de la personne, espionné (un seul `createPlatformDb`, le sien).
   */
  async function session(person: Member) {
    const spied = recordDb(await ref.db(person))
    vi.mocked(createPlatformDb).mockReturnValueOnce(spied.db)
    const connected = await connectMcp(ref.org, { id: ref.people[person].id, email: ref.people[person].email, accessToken: TOKENS[person] })
    const run = (tool: string, fields: Record<string, unknown>) => connected.call(tool, { ctx: ref.id(CTX[person]), ...fields })
    return { ...connected, run, requests: spied.requests }
  }

  /** `ventes/facturer` de nouveau publiée en révision 1, son brouillon appelant `erp.create_invoice` avec `args`. */
  async function resetProcedure(args?: Record<string, unknown>): Promise<void> {
    await seed.admin`delete from platform.nodes where id = ${ref.nodeId(PROCEDURE)}`
    const tables = erpTables(args)
    await ref.write({ nodes: tables.nodes.filter((row) => row.id === nodeId(PROCEDURE)), blocks: tables.blocks, node_drafts: tables.node_drafts })
  }

  describe("ERP functions through find and read (E08-S05)", () => {
    it("should find an ERP function by its exact name first with score 1.00, and by its words, the tools unchanged (AC4)", async () => {
      const { run, client } = await session("claire")
      const exact = await run("find", { query: "erp.lookup_customer" })
      const lines = exact.text.split("\n")
      expect(lines[lines.indexOf("Functions:") + 1]).toBe("1. erp.lookup_customer (read, score 1.00): Reads a customer of the ERP by its code: name and city.")
      expect(exact.result.structuredContent).toMatchObject({ text: exact.text, functions: [{ name: "erp.lookup_customer", class: "read", connector: "erp", score: 1 }, {}, {}] })

      const words = await run("find", { query: "lookup customer", type: "function" })
      // Les fonctions trouvées, en champs de `structuredContent` (E03-S02, AC16) : le SDK le type `unknown`.
      const { functions } = words.result.structuredContent as { functions: { name: string }[] }
      expect(functions.map((fn) => fn.name)).toContain("erp.lookup_customer")
      expect(functions.length).toBeLessThanOrEqual(3)
      // La description de `call` ne cite pas les fonctions de l'ERP (NH6) : la surface servie ne change pas (ADR-002).
      const descriptions = (await client.listTools()).tools.map((tool) => tool.description)
      expect(descriptions).toEqual(buildTools(ref.identityOf("claire").org, ["table.rows"]).map((tool) => tool.description))
    })

    it("should serve the contract of an ERP function, naming its origin and class, strict schema, examples and refusals (AC5)", async () => {
      const { run } = await session("claire")
      const contract = await run("read", { path: "erp.lookup_customer" })
      const lines = contract.text.split("\n")
      expect([...lines.slice(0, 3), ...lines.slice(4)]).toEqual([
        "Function erp.lookup_customer (connector erp, origin erp, class read)",
        "Reads a customer of the ERP by its code: name and city.",
        "Arguments (JSON Schema):",
        "Examples:",
        `${ref.org.prefix}_call {"function": "erp.lookup_customer", "arguments": {"code":"C-001"}}`,
        "Possible refusals:",
        "- Unknown customer: no customer has this code.",
      ])
      const schema = { type: "object", properties: { code: { type: "string", minLength: 1, description: "Customer code, e.g. C-001." } }, required: ["code"], additionalProperties: false }
      expect(JSON.parse(lines[3])).toEqual(schema)
      expect(contract.result.structuredContent).toEqual({
        function: "erp.lookup_customer",
        connector: "erp",
        class: "read",
        origin: "erp",
        arguments_schema: schema,
        examples: [{ code: "C-001" }],
        text: contract.text,
        next_actions: [`${ref.org.prefix}_call`],
      })
    })
  })

  describe("ERP functions through call (E08-S05)", () => {
    // E05-S13 (fiche D128) : sans procédure ni équipe nommée, une fonction de l'ERP (sans compte) ne court sous
    // aucune équipe : plus d'équipe par défaut.
    it("should run an ERP function under the verified token of each caller, journaled without team nor account (AC6)", async () => {
      for (const person of ["claire", "paul"] as const) {
        const { run, journal } = await session(person)
        const called = await run("call", { function: "erp.lookup_customer", arguments: { code: "C-001" } })
        expect(vi.mocked(createPlatformDb)).toHaveBeenLastCalledWith({
          caller: { userId: ref.people[person].id, email: ref.people[person].email, name: null },
        })
        expect(called.text).toBe(`Customer C-001 read for ${ref.people[person].email} under token ${TOKENS[person]}.`)
        expect(ref.readable(called.result.structuredContent)).toEqual({
          function: "erp.lookup_customer",
          team: null,
          result: { customer: "C-001", read_by: PEOPLE[person].id, token: TOKENS[person] },
          text: called.text,
          next_actions: [],
        })
        expect(ref.readable(journal.find((line) => line.tool === `${ref.org.prefix}_call`))).toMatchObject({ target: "erp.lookup_customer", team_id: null, account_id: null })
      }
      // Le jeton ne va qu'aux fonctions de l'ERP (moindre privilège, NH19) : une fonction native ne le reçoit pas.
      const native = vi.spyOn(tableSchema, "run").mockResolvedValue({ text: "Table ventes/suivi." })
      await (await session("claire")).run("call", { function: "table.schema", arguments: { table: "ventes/suivi" } })
      expect(native.mock.calls.map(([context]) => context.accessToken)).toEqual([undefined])
      // Une porte qui ne passerait pas le jeton ne fait rien courir : câblage fautif, panne dite au serveur.
      const log = vi.spyOn(console, "error").mockImplementation(() => {})
      const { deps } = await session("claire")
      const untokened = await connectDeps({ ...deps, accessToken: undefined })
      const refused = await untokened.call("call", { ctx: ref.id(CTX.claire), function: "erp.lookup_customer", arguments: { code: "C-001" } })
      expect([refused.isError, refused.text]).toEqual([true, internal()])
      expect(log).toHaveBeenCalledWith("[platform] call: ERP function erp.lookup_customer without the caller's token")
      expect(runs).toEqual(["lookup C-001", "lookup C-001"])
    })

    it("should refuse an unknown key with the contract to read, and run nothing (AC7)", async () => {
      const { run } = await session("claire")
      const refused = await run("call", { function: "erp.lookup_customer", arguments: { code: "C-001", client: "x" } })
      expect([refused.isError, refused.text]).toEqual([
        true,
        `Invalid arguments for erp.lookup_customer: (root): Unrecognized key: "client". Read the contract with ${ref.org.prefix}_read {"path": "erp.lookup_customer"}.`,
      ])
      expect(runs).toEqual([])
    })

    it("should summarize a sensitive ERP function without confirm and run it once with confirm: true (AC8)", async () => {
      const { run } = await session("claire")
      const summary = await run("call", { function: "erp.send_invoice", arguments: { invoice: "F-0001" } })
      expect(summary.text).toBe(
        [
          "About to send invoice F-0001 to Valbrune (compta@valbrune.test).",
          "",
          "Nothing was sent. Show this to the user and ask for explicit approval, then call again with confirm: true.",
        ].join("\n"),
      )
      expect(summary.result.structuredContent).toMatchObject({ status: "needs_confirmation", summary: { invoice: "F-0001" }, next_actions: [] })
      expect(runs).toEqual([])
      const sent = await run("call", { function: "erp.send_invoice", arguments: { invoice: "F-0001" }, confirm: true })
      expect([sent.isError, sent.text]).toEqual([false, "Invoice F-0001 sent."])
      expect(runs).toEqual(["send F-0001"])
    })

    it("should propose the next functions of an ERP function, the sensitive one removed (AC9)", async () => {
      const { run } = await session("claire")
      const created = await run("call", { function: "erp.create_invoice", arguments: { customer: "C-001", amount: 100 } })
      expect(created.result.structuredContent).toMatchObject({ result: { invoice: "F-0001" }, next_actions: ["erp.lookup_customer"] })
    })

    it("should serve a PlatformError of the ERP as is, and any other error, internal included, as the internal instruction logged on the server (AC10)", async () => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {})
      const { run } = await session("claire")
      const unknown = await run("call", { function: "erp.lookup_customer", arguments: { code: "C-999" } })
      expect([unknown.isError, unknown.text]).toEqual([true, "Unknown customer C-999."])
      const failed = await run("call", { function: "erp.lookup_customer", arguments: { code: "C-500" } })
      expect([failed.isError, failed.text, failed.result.structuredContent]).toEqual([true, internal(), undefined])
      expect(log).toHaveBeenCalledWith("[platform] mcp: tools/call failed", expect.objectContaining({ message: "ERP database unreachable at 10.0.0.7:5432" }))
      // La porte ne journalise pas une `PlatformError` : la cause d'une panne `internal` de l'ERP s'écrit à son enveloppe (NH18).
      const stalled = await run("call", { function: "erp.lookup_customer", arguments: { code: "C-503" } })
      expect([stalled.isError, stalled.text]).toEqual([true, internal()])
      expect(log).toHaveBeenCalledWith("[platform] call: ERP function erp.lookup_customer failed", expect.objectContaining({ message: "ERP invoice queue stalled." }))
    })
  })

  describe("procedures citing an ERP function (E08-S05)", () => {
    it("should publish a procedure whose call block runs an ERP function, and refuse an unknown key with its step (AC11)", async () => {
      await resetProcedure()
      const accepted = await session("claire")
      const published = await accepted.run("write", { path: PROCEDURE, base_revision: 1, publish: true })
      // 1.4.3 : une procédure sans partie « Quand l'utiliser » se publie, avec un avertissement.
      expect([published.isError, published.text]).toEqual([false, `Published ${PROCEDURE} revision 2 (1 section, 3 blocks). Next write: base_revision 2.\nWarnings:\n- Procedure: no part « When to use it » (or « Quand l'utiliser »): say when to use it, when not, and where to go instead (read path help, section procedures).`])
      expect(publishCalls(accepted.requests)).toHaveLength(1)

      await resetProcedure({ client: "C-001", amount: 100 })
      const refused = await session("claire")
      const answer = await refused.run("write", { path: PROCEDURE, base_revision: 1, publish: true })
      const at = "section « Étapes », call block 1 (step 1)"
      expect([answer.isError, answer.text]).toEqual([
        true,
        [
          // E11-S18 (AC-1) : l'écriture d'un assistant n'écrit rien ; le brouillon semé avant l'appel reste.
          `Publication of ${PROCEDURE} refused: 2 problem(s). Nothing was written; the draft saved before this call stays.`,
          `- ${at}: erp.create_invoice has no argument « client »; its arguments: customer, amount`,
          `- ${at}: erp.create_invoice needs argument « customer »; write "<…>" for a value known only when the procedure runs`,
          `Fix them with ${ref.org.prefix}_write (ops on the sections), then publish again. Format and rules: ${ref.org.prefix}_read {"path": "write.procedure"}.`,
          "Writing it in several calls? Pass publish: false until the last one.",
        ].join("\n"),
      ])
      expect(publishCalls(refused.requests)).toEqual([])
    })
  })
})
