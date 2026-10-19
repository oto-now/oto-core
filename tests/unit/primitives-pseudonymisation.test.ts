// @vitest-environment node
// Les quatre primitives de la pseudonymisation (`pseudonymisation.md` § Les quatre primitives, jalon J1) :
// - un argument marqué « donnée personnelle » (`.meta({ personal: true })`, `personal: true` d'un JSON Schema) n'est
//   jamais journalisé, ni dans les arguments, ni dans la cible, ni dans le message d'erreur qu'un tiers recopie ; à la
//   porte HTTP, ce que la liste blanche d'une route (`journalArgs`) ne garde pas ne revient pas par la cible ;
// - une fonction réservée au serveur (`serverOnly`, d'un connecteur décrit fonction par fonction, ou de l'hôte) est
//   inconnue de l'assistant et courue par `callFunction` ;
// - le contenu d'un fichier joint est retenu quand l'hôte le dit (`registerDataPolicy`) ;
// - la purge du journal et des retours au-delà de la rétention (`platform.purge_expired`, `oto-platform journal purge`).
// Les parties pures sans base ; la porte MCP, `callFunction` et la purge sur une base réelle.
import type postgres from "postgres"
import * as z from "zod/v4"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { purgeCommand } from "../../packages/plateforme/cli/purge.mjs"
import { runCall } from "../../packages/plateforme/server/calls"
import { compileJsonArguments } from "../../packages/plateforme/server/catalog/arguments"
import { CatalogRegistrationError, defineErpFunction, registerFunctions } from "../../packages/plateforme/server/catalog/erp"
import { personalPaths, personalValues } from "../../packages/plateforme/server/catalog/personal"
import { assistantFunctions, catalogFunctions } from "../../packages/plateforme/server/catalog/registry"
import { registerConnectors } from "../../packages/plateforme/server/connectors/declaration"
import { fileContentsFor, registerDataPolicy } from "../../packages/plateforme/server/data-policy"
import { createPlatformDb, type PlatformDb } from "../../packages/plateforme/server/db"
import { PlatformError } from "../../packages/plateforme/server/errors"
import { callFunction } from "../../packages/plateforme/server/function-call"
import type { Identity } from "../../packages/plateforme/server/identity"
import { failedEntry, PERSONAL, servedEntry, withheldValues, withoutWithheld, type JournalEntry } from "../../packages/plateforme/server/journal"
import type { NodeRow } from "../../packages/plateforme/server/nodes/lookup"
import { readNodeFile } from "../../packages/plateforme/server/nodes/read-file"
import { describedConnector } from "../factories/described-connector"
import { connectMcp } from "../helpers/mcp"
import { contentTables, ORG, PEOPLE } from "../helpers/reference-org"
import { seedReferenceTables, type ReferenceOrgSql } from "../helpers/reference-org-sql"
import { portable, recordDb, seedWithAdmin, sqlConfigured, type SeededData } from "../helpers/sql"

vi.mock("../../packages/plateforme/server/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../packages/plateforme/server/db")>()
  return { ...original, createPlatformDb: vi.fn(original.createPlatformDb) }
})

const EMAIL = "camille.exemple@valbrune.test"
const PHONE = "+33612345678"

/** Lit une personne de l'hôte par son courriel ; un courriel inconnu est refusé par un message qui le recopie. */
const lookupPerson = defineErpFunction({
  name: "erp.lookup_person",
  class: "read",
  description: "Reads a person of the ERP by email.",
  schema: z.strictObject({ email: z.string().min(3).meta({ personal: true }), phones: z.array(z.string().meta({ personal: true })).optional(), limit: z.number().optional() }),
  examples: [{ email: "someone@example.test" }],
  run: async (_context, args) => {
    if (args.email.startsWith("unknown")) throw new PlatformError("not_found", `No person has the email ${args.email}.`)
    return { text: `Person P-1 found.`, data: { person: "P-1" } }
  },
})

/** Géocode une adresse : réservée au serveur de l'hôte, qui rend un verdict sans identité. */
const geocode = defineErpFunction({
  name: "erp.geocode",
  class: "read",
  description: "Geocodes an address.",
  schema: z.strictObject({ address: z.string().min(1) }),
  examples: [{ address: "1 rue de l'Exemple" }],
  serverOnly: true,
  run: async () => ({ text: "Geocoded.", data: { lat: 45.76, lon: 4.83 } }),
})

const noDb = null as unknown as PlatformDb
const identity = { org: { id: "org-1", slug: "acme", prefix: "acme", name: "Acme" } } as unknown as Identity

/** Le refus d'une promesse, ou `null` si elle aboutit. */
const refusal = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: unknown) => error,
  )

describe("arguments marked personal", () => {
  it("should find the marked paths of a Zod schema and of a JSON Schema, and the values the call carries there", () => {
    expect(personalPaths(lookupPerson)).toEqual([[{ key: "email" }], [{ key: "phones" }, { any: true }]])
    expect(personalValues(lookupPerson, { email: EMAIL, phones: [PHONE, ""], limit: 3 })).toEqual([EMAIL, PHONE])
    const json = compileJsonArguments({
      type: "object",
      additionalProperties: false,
      properties: { contact: { type: "object", properties: { name: { type: "string", personal: true }, zip: { type: "integer", personal: true } } }, city: { type: "string" } },
    })
    expect(json.validate({ contact: { name: "Camille", zip: 69001 }, city: "Lyon" })).toBe(true)
    expect(personalValues({ schema: json }, { contact: { name: "Camille Exemple", zip: 69001 }, city: "Lyon" })).toEqual(["Camille Exemple", "69001"])
    expect(personalValues({ schema: json }, { city: "Lyon" })).toEqual([])
  })

  it("should take the values out of the arguments, the target and the error of a line, where a third party copied them", () => {
    const opened = (): JournalEntry => ({
      org_id: "org-1",
      user_id: "user-1",
      method: "tools/call",
      args: { function: "erp.lookup_person", arguments: { email: EMAIL, limit: 69001, note: `about ${EMAIL}`, id: "ab" } },
    })
    const served = opened()
    servedEntry(served, { text: "", target: "erp.lookup_person", personal: [EMAIL, "69001", "ab"] }, { ctx: null, host: null, resultChars: 0 })
    expect(served.args).toEqual({ function: "erp.lookup_person", arguments: { email: PERSONAL, limit: PERSONAL, note: `about ${PERSONAL}`, id: PERSONAL } })
    const failed = opened()
    failedEntry(failed, { code: "not_found", message: `No person has the email ${EMAIL}.` }, { ctx: null, host: null, resultChars: 0, trace: { personal: [EMAIL] } })
    expect(failed.error).toBe(`not_found: No person has the email ${PERSONAL}.`)
    expect(JSON.stringify(failed.args)).not.toContain(EMAIL)
    // Coupés à 2 048 caractères, les arguments gardent leur début (`head`) : la valeur en est retirée aussi.
    const long = { ...opened(), args: { _truncated: true, head: `{"function":"erp.lookup_person","arguments":{"email":"${EMAIL}"` } }
    servedEntry(long, { text: "", personal: [EMAIL] }, { ctx: null, host: null, resultChars: 0 })
    expect(JSON.stringify(long.args)).not.toContain(EMAIL)
  })

  it("should keep out of the target of an HTTP line every value of the body that the route's list leaves out", () => {
    // La porte HTTP : sous `journalArgs`, l'erreur est réduite à son code ; ce que la liste ne garde pas sort aussi de la cible.
    const body = { email: EMAIL, team: "team-1", size: 12, tags: ["vip"] }
    const kept = { team: "team-1", email: PERSONAL }
    const withheld = withheldValues(body, kept)
    expect(withheld.sort()).toEqual([EMAIL, "12", "vip"].sort())
    expect(withoutWithheld(EMAIL, withheld)).toBe(PERSONAL)
    expect(withoutWithheld(`invitation of ${EMAIL}`, withheld)).toBe(`invitation of ${PERSONAL}`)
    expect(withoutWithheld("team-1", withheld)).toBe("team-1")
    expect(withoutWithheld(null, withheld)).toBeNull()
    expect(withheldValues(undefined, kept)).toEqual([])
  })
})

describe("functions reserved to the host's server", () => {
  afterEach(() => {
    registerConnectors([])
    registerFunctions([])
  })

  it("should reserve some functions of a described connector, keep the others served, and refuse an unknown name", () => {
    registerConnectors([describedConnector()], { serverOnly: { crm: ["crm.get_contact", "crm_act.post_entry"] } })
    const reserved = catalogFunctions().filter((fn) => fn.serverOnly).map((fn) => fn.name)
    expect(reserved.sort()).toEqual(["crm.get_contact", "crm_act.post_entry"])
    const served = assistantFunctions().map((fn) => fn.name)
    expect(served).toContain("crm.list_contacts")
    expect(served).not.toContain("crm.get_contact")
    registerConnectors([describedConnector()], { serverOnly: { crm: "all" } })
    expect(assistantFunctions().some((fn) => fn.connector === "crm")).toBe(false)
    expect(() => registerConnectors([describedConnector()], { serverOnly: { crm: ["crm.post_entry"] } })).toThrow(CatalogRegistrationError)
    expect(() => registerConnectors([describedConnector()], { serverOnly: { crm: [] } })).toThrow(CatalogRegistrationError)
    expect(() => registerConnectors([describedConnector()], { serverOnly: { other: "all" } })).toThrow("serverOnly for other: no connector of this name is declared.")
  })

  it("should make a reserved function unknown to call from the gate, with the message of an absent function", async () => {
    registerFunctions([geocode])
    registerConnectors([describedConnector()], { serverOnly: { crm: ["crm.get_contact"] } })
    const deps = { db: noDb, identity, ctxCode: null, origin: "https://acme.test", activeConnectors: async () => new Set(["crm"]) }
    for (const name of ["erp.geocode", "crm.get_contact"]) {
      const error = await refusal(runCall(deps, { function: name, arguments: {} }))
      expect(error instanceof PlatformError && [error.code, error.message]).toEqual(["not_found", `Unknown function ${name}. Use acme_find with type function.`])
    }
    expect(() => registerFunctions([{ ...geocode, serverOnly: "yes" as unknown as boolean }])).toThrow("erp.geocode: serverOnly must be true or false.")
  })
})

describe("file contents withheld by the host", () => {
  afterEach(() => registerDataPolicy(null))

  it("should refuse to serve the contents of a file before reading anything, naming the page that shows its name", async () => {
    registerDataPolicy({ fileContents: "metadata" })
    const node = { id: "node-1", path: "clients/dossier" } as unknown as NodeRow
    const error = await refusal(readNodeFile(noDb, identity, { input: { path: node.path, file: "file-1" }, file: "file-1", node, prefix: "acme" }))
    expect(error instanceof PlatformError && [error.code, error.message, error.details]).toEqual([
      "forbidden",
      "The contents of files are not served to assistants at Acme: only their name, size and type, shown in clients/dossier. Ask the user to open the file.",
      { reason: "file_contents_withheld" },
    ])
  })

  it("should read the policy per organisation, refuse a host function that fails, and refuse a malformed policy", async () => {
    registerDataPolicy({ fileContents: (org) => (org.slug === "acme" ? "metadata" : "served") })
    expect(await fileContentsFor({ id: "1", slug: "acme" })).toBe("metadata")
    expect(await fileContentsFor({ id: "2", slug: "delta" })).toBe("served")
    registerDataPolicy({ fileContents: () => "maybe" as unknown as "served" })
    vi.spyOn(console, "error").mockImplementation(() => {})
    expect(await refusal(fileContentsFor({ id: "1", slug: "acme" }))).toMatchObject({ code: "internal" })
    registerDataPolicy(null)
    expect(await fileContentsFor({ id: "1", slug: "acme" })).toBe("served")
    expect(() => registerDataPolicy({ fileContents: "hidden" as unknown as "served" })).toThrow(TypeError)
  })
})

describe("journal purge command", () => {
  it("should refuse without a duration or with a malformed one, without connecting", async () => {
    const errors: string[] = []
    const connect = vi.fn() as unknown as typeof postgres
    const base = { dbUrl: "postgresql://admin@db.test/postgres", print: () => {}, printError: (line: string) => errors.push(line), connect }
    expect(await purgeCommand(base)).toBe(1)
    expect(await purgeCommand({ ...base, journalDays: "0" })).toBe(1)
    expect(await purgeCommand({ ...base, feedbackDays: "12.5" })).toBe(1)
    expect(connect).not.toHaveBeenCalled()
    expect(errors).toEqual([
      "journal purge : rien à purger : --journal-days <jours>, --feedback-days <jours>, ou les deux",
      "journal purge : --journal-days attend un nombre de jours, de 1 à 36500",
      "journal purge : --feedback-days attend un nombre de jours, de 1 à 36500",
    ])
  })
})

describe.skipIf(!sqlConfigured)(portable("the primitives on a real database"), { timeout: 60_000 }, () => {
  const CTX = "7K3Q-M2XA"
  const TOKEN = "token-of-claire"
  let seed: SeededData
  let ref: ReferenceOrgSql

  beforeAll(async () => {
    registerFunctions([lookupPerson, geocode])
    const tables = contentTables()
    tables.orgs[0].rules_version = 1
    tables.ctx = [{ code: CTX, org_id: ORG.id, user_id: PEOPLE.claire.id, rules_version: 1, host: null }]
    seed = seedWithAdmin()
    ref = await seedReferenceTables(seed, tables)
  }, 180_000)

  afterAll(async () => {
    registerFunctions([])
    await seed?.cleanup()
  }, 180_000)

  beforeEach(async () => {
    await seed.admin`delete from platform.journal where org_id = ${ref.org.id}`
  })

  async function session() {
    const spied = recordDb(await ref.db("claire"))
    vi.mocked(createPlatformDb).mockReturnValueOnce(spied.db)
    const connected = await connectMcp(ref.org, { id: ref.people.claire.id, email: ref.people.claire.email, accessToken: TOKEN })
    const run = (tool: string, fields: Record<string, unknown>) => connected.call(tool, { ctx: ref.id(CTX), ...fields })
    return { ...connected, run }
  }

  it("should journal a call through the gate without the personal values, refusal included", async () => {
    const { run, journal } = await session()
    const served = await run("call", { function: "erp.lookup_person", arguments: { email: EMAIL, phones: [PHONE] } })
    expect(served.isError).toBe(false)
    const refused = await run("call", { function: "erp.lookup_person", arguments: { email: `unknown-${EMAIL}` } })
    expect(refused.text).toBe(`No person has the email unknown-${EMAIL}.`)
    const lines = journal.filter((line) => line.tool === `${ref.org.prefix}_call`)
    expect(lines).toHaveLength(2)
    expect(lines[0].args).toMatchObject({ function: "erp.lookup_person", arguments: { email: PERSONAL, phones: [PERSONAL] } })
    expect(lines[1].error).toBe(`not_found: No person has the email ${PERSONAL}.`)
    expect(JSON.stringify(lines)).not.toContain("valbrune")
  })

  it("should hide a reserved function from find, read and call, and run it by callFunction", async () => {
    const { run } = await session()
    const found = await run("find", { query: "geocode address", type: "function" })
    expect(JSON.stringify(found.result.structuredContent)).not.toContain("erp.geocode")
    const read = await run("read", { path: "erp.geocode" })
    expect([read.isError, read.text]).toEqual([true, `Unknown function erp.geocode. Use ${ref.org.prefix}_find with type function.`])
    const call = await run("call", { function: "erp.geocode", arguments: { address: "1 rue de l'Exemple" } })
    expect([call.isError, call.text]).toEqual([true, `Unknown function erp.geocode. Use ${ref.org.prefix}_find with type function.`])
    const result = await callFunction(await ref.db("claire"), ref.identityOf("claire"), { function: "erp.geocode", arguments: { address: "1 rue de l'Exemple" } }, { origin: "https://acme.test", accessToken: TOKEN })
    expect(result).toMatchObject({ status: "done", function: "erp.geocode", result: { lat: 45.76, lon: 4.83 } })
  })

  it("should journal a call by the host without the personal values", async () => {
    await callFunction(await ref.db("claire"), ref.identityOf("claire"), { function: "erp.lookup_person", arguments: { email: EMAIL } }, { origin: "https://acme.test", accessToken: TOKEN })
    const [line] = await seed.admin<{ args: unknown }[]>`select args from platform.journal where org_id = ${ref.org.id} and method = 'api'`
    expect(line.args).toEqual({ function: "erp.lookup_person", arguments: { email: PERSONAL } })
  })

  it("should purge the journal and the feedback beyond the retention, keep the rest, and refuse a bad duration", async () => {
    const old = new Date(Date.now() - 40 * 86_400_000)
    await seed.admin`insert into platform.journal (org_id, user_id, method, ts) values (${ref.org.id}, ${ref.people.claire.id}, 'tools/call', ${old}), (${ref.org.id}, ${ref.people.claire.id}, 'tools/call', now())`
    const [counts] = await seed.admin<{ journal: string; admin_journal: string; feedback: string }[]>`select * from platform.purge_expired(30, null)`
    expect(Number(counts.journal)).toBe(1)
    const left = await seed.admin<{ n: string }[]>`select count(*) as n from platform.journal where org_id = ${ref.org.id}`
    expect(Number(left[0].n)).toBe(1)
    await expect(seed.admin`select * from platform.purge_expired(0, null)`).rejects.toThrow("journal_days must be between 1 and 36500")
    // Aucun rôle de session ne l'exécute : la connexion du serveur, sous la personne, est refusée.
    await expect((await ref.db("claire")).tx((sql) => sql`select * from platform.purge_expired(30, null)`)).rejects.toThrow()
  })
})
