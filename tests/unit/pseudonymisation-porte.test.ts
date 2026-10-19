// @vitest-environment node
// La porte de la pseudonymisation sur une base réelle (`pseudonymisation.md`, J2) : une page, un résultat et un refus
// qui citent une personne déclarée partent en jetons, au même endroit du texte et des données ; le même jeton d'une
// conversation à l'autre, un autre dans une autre organisation ; le journal et les retours pseudonymisés à l'écriture ;
// fermé en cas de panne (source de l'hôte, clé absente, témoin faux) ; l'invalidation fait rebâtir le dictionnaire ;
// `pseudonymize` pour l'hôte qui repasse un résultat de `callFunction`.
import * as z from "zod/v4"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { defineErpFunction, registerFunctions } from "../../packages/plateforme/server/catalog/erp"
import { createPlatformDb } from "../../packages/plateforme/server/db"
import { PlatformError } from "../../packages/plateforme/server/errors"
import { recordFeedback } from "../../packages/plateforme/server/feedback"
import { callFunction } from "../../packages/plateforme/server/function-call"
import { writeJournal } from "../../packages/plateforme/server/journal"
import { registerSensitiveEntities, type SensitiveEntity } from "../../packages/plateforme/server/pseudonym/declaration"
import { forgetDictionaries, invalidateSensitiveEntities, pseudonymize } from "../../packages/plateforme/server/pseudonym/service"
import { connectMcp } from "../helpers/mcp"
import { connectAdminMcp } from "../helpers/mcp-admin"
import { seedAdminFixture, type AdminFixtureSql } from "../helpers/mcp-admin-sql"
import { contentTables, ORG, PEOPLE } from "../helpers/reference-org"
import { seedReferenceTables, type ReferenceOrgSql } from "../helpers/reference-org-sql"
import { portable, recordDb, seedWithAdmin, sqlConfigured, type SeededData } from "../helpers/sql"

vi.mock("../../packages/plateforme/server/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../packages/plateforme/server/db")>()
  return { ...original, createPlatformDb: vi.fn(original.createPlatformDb) }
})

const KEY = Buffer.alloc(32, 3).toString("base64")
const TOKEN_OF_A_PERSON = /⟦client:[0-9a-hjkmnp-tv-z]{13}⟧/u
const CAMILLE: SensitiveEntity = { id: "c-1", values: { firstNames: "Camille", lastName: "Dupré", phones: ["06 12 34 56 78"] } }
const JEAN: SensitiveEntity = { id: "c-2", values: { firstNames: "Jean", lastName: "Morin" } }

/** La source de l'hôte : ses clients, lus dans sa base (ici, une liste que les tests changent). */
const source = { entities: [CAMILLE, JEAN] as SensitiveEntity[], fail: false }

const lookupClient = defineErpFunction({
  name: "erp.lookup_client",
  class: "read",
  description: "Reads a client of the ERP by name.",
  schema: z.strictObject({ name: z.string().min(1) }),
  examples: [{ name: "Someone" }],
  run: async (_context, args) => {
    if (args.name.startsWith("Nobody")) throw new PlatformError("not_found", `No client named ${args.name}; did you mean Camille Dupré?`)
    return { text: `Client ${args.name} found: call 06 12 34 56 78.`, data: { name: args.name } }
  },
})

describe.skipIf(!sqlConfigured)(portable("the pseudonymization gate on a real database"), { timeout: 60_000 }, () => {
  const CTX = "7K3Q-M2XB"
  const ACCESS = "token-of-claire"
  let seed: SeededData
  let ref: ReferenceOrgSql

  beforeAll(async () => {
    registerFunctions([lookupClient])
    const tables = contentTables()
    tables.orgs[0].rules_version = 1
    tables.ctx = [{ code: CTX, org_id: ORG.id, user_id: PEOPLE.claire.id, rules_version: 1, host: null }]
    seed = seedWithAdmin()
    ref = await seedReferenceTables(seed, tables)
    await ref.addNodes([
      { path: "ventes/relance_jean_morin", kind: "procedure", title: "Relance", summary: "Relance." },
      { path: "ventes/rappel", kind: "procedure", title: "Rappeler Jean Morin", summary: "Pour Camille Dupré." },
    ])
    await ref.addBlocks("ventes/devis", "published", [{ type: "paragraph", text: "Appeler Camille Dupré au 06 12 34 56 78, puis Jean Morin." }])
  }, 180_000)

  afterAll(async () => {
    registerFunctions([])
    await seed?.cleanup()
  }, 180_000)

  beforeEach(async () => {
    vi.stubEnv("PLATFORM_PSEUDONYM_KEY", KEY)
    source.entities = [CAMILLE, JEAN]
    source.fail = false
    registerSensitiveEntities([{
      kind: "client",
      list: async () => {
        if (source.fail) throw new Error("the host database is down")
        return source.entities
      },
      read: async (_org, id) => source.entities.find((entity) => entity.id === id)?.values ?? null,
    }])
    forgetDictionaries()
    await seed.admin`delete from platform.journal where org_id = ${ref.org.id}`
    await seed.admin`delete from platform.pseudonym_orgs`
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    registerSensitiveEntities(null)
  })

  async function session() {
    const spied = recordDb(await ref.db("claire"))
    vi.mocked(createPlatformDb).mockReturnValueOnce(spied.db)
    const connected = await connectMcp(ref.org, { id: ref.people.claire.id, email: ref.people.claire.email, accessToken: ACCESS })
    const run = (tool: string, fields: Record<string, unknown>) => connected.call(tool, { ctx: ref.id(CTX), ...fields })
    return { ...connected, run }
  }

  const journalRows = () => seed.admin<{ tool: string; args: unknown; target: string | null; error: string | null }[]>`
    select tool, args, target, error from platform.journal where org_id = ${ref.org.id} order by id`

  it("should serve a page that names a declared person with its token, in the text and in the data, the same token each time", async () => {
    const { run } = await session()
    const read = await run("read", { path: "ventes/devis" })
    expect(read.isError).toBe(false)
    expect(read.text).not.toMatch(/Camille|Dupré|Morin|06 12/u)
    const [camille] = read.text.match(TOKEN_OF_A_PERSON) ?? []
    expect(read.text).toContain(`Appeler ${camille} au ${camille}, puis ⟦client:`)
    expect(JSON.stringify(read.result.structuredContent)).not.toMatch(/Camille|Dupré|Morin/u)
    // Une autre conversation, le même jeton ; le dictionnaire rebâti (autre processus), le même jeton encore.
    forgetDictionaries()
    const again = await (await session()).run("read", { path: "ventes/devis" })
    expect(again.text.match(TOKEN_OF_A_PERSON)?.[0]).toBe(camille)
  })

  it("should serve the prompts through the gate, leave out one whose name names a person, and tell the assistant how to use tokens", async () => {
    const { client, openContext } = await session()
    const { prompts } = await client.listPrompts()
    expect(prompts.map((prompt) => prompt.name)).toContain("rappel")
    expect(prompts.map((prompt) => prompt.name)).not.toContain("relance_jean_morin")
    expect(JSON.stringify(prompts)).not.toMatch(/Camille|Dupré|Morin/u)
    const served = await client.getPrompt({ name: "rappel" })
    expect(JSON.stringify(served)).not.toMatch(/Camille|Dupré|Morin/u)
    expect(JSON.stringify(served)).toMatch(TOKEN_OF_A_PERSON)
    await expect(client.getPrompt({ name: "relance_jean_morin" })).rejects.toThrow(/Unknown prompt relance_⟦client:/u)
    const opened = await openContext("a quote")
    expect(opened.text).toContain("copy the token exactly as written")
  })

  it("should give another organisation another token for the same person", async () => {
    const here = await pseudonymize(await ref.db("lea"), { id: ref.org.id, slug: ref.org.slug }, { who: "Camille Dupré" })
    const there = await pseudonymize(await ref.db("lea"), { id: ref.other.id, slug: ref.other.slug }, { who: "Camille Dupré" })
    expect(here.who).toMatch(TOKEN_OF_A_PERSON)
    expect(there.who).toMatch(TOKEN_OF_A_PERSON)
    expect(there.who).not.toBe(here.who)
  })

  it("should pseudonymize a function's result and a refusal that names a person, and journal them pseudonymized", async () => {
    const { run, flush } = await session()
    const served = await run("call", { function: "erp.lookup_client", arguments: { name: "Jean Morin" } })
    expect(served.text).toMatch(/^Client ⟦client:[0-9a-hjkmnp-tv-z]{13}⟧ found: call ⟦client:[0-9a-hjkmnp-tv-z]{13}⟧\./u)
    const refused = await run("call", { function: "erp.lookup_client", arguments: { name: "Nobody, not Jean Morin" } })
    expect(refused.isError).toBe(true)
    expect(refused.text).toMatch(/^No client named Nobody, not ⟦client:[0-9a-hjkmnp-tv-z]{13}⟧; did you mean ⟦client:[0-9a-hjkmnp-tv-z]{13}⟧\?/u)
    await flush()
    const rows = await journalRows()
    expect(rows.length).toBeGreaterThanOrEqual(2)
    expect(JSON.stringify(rows)).not.toMatch(/Camille|Dupré|Morin/u)
    expect(JSON.stringify(rows)).toMatch(TOKEN_OF_A_PERSON)
  })

  it("should journal a call by the host and a line of any door pseudonymized, and record a feedback pseudonymized", async () => {
    const db = await ref.db("claire")
    const identity = ref.identityOf("claire")
    const result = await callFunction(db, identity, { function: "erp.lookup_client", arguments: { name: "Camille Dupré" } }, { origin: "https://acme.test", accessToken: ACCESS })
    // `callFunction` rend en clair à l'hôte ; `pseudonymize` est là pour qui repasse le résultat à un assistant.
    expect(result).toMatchObject({ status: "done", result: { name: "Camille Dupré" } })
    expect(await pseudonymize(db, ref.org, { name: "Camille Dupré" })).toEqual({ name: expect.stringMatching(TOKEN_OF_A_PERSON) })
    await writeJournal(db, [{ org_id: ref.org.id, user_id: ref.people.claire.id, method: "api", tool: "POST nodes", target: "clients/camille_dupre", args: { title: "Camille Dupré" }, is_error: true, error: "conflict: Camille Dupré exists." }])
    const rows = await journalRows()
    expect(rows).toHaveLength(2)
    expect(JSON.stringify(rows)).not.toMatch(/Camille|Dupré|camille_dupre/u)
    await recordFeedback(db, identity, { type: "error", text: "The page of Camille Dupré is wrong", target: "Jean Morin" }, null)
    const [ticket] = await seed.admin<{ text: string; target: string }[]>`select text, target from platform.feedback where org_id = ${ref.org.id} order by created_at desc limit 1`
    expect(ticket.text).toMatch(/^The page of ⟦client:[0-9a-hjkmnp-tv-z]{13}⟧ is wrong$/u)
    expect(ticket.target).toMatch(TOKEN_OF_A_PERSON)
  })

  it("should refuse rather than serve in clear when the host's source fails, the key is missing or the key changed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    source.fail = true
    const down = await (await session()).run("read", { path: "ventes/devis" })
    expect([down.isError, down.text]).toEqual([true, expect.stringContaining("Internal error.")])
    expect(down.text).not.toMatch(/Camille|Dupré/u)
    source.fail = false
    vi.stubEnv("PLATFORM_PSEUDONYM_KEY", "")
    const keyless = await (await session()).run("read", { path: "ventes/devis" })
    expect(keyless.isError).toBe(true)
    vi.stubEnv("PLATFORM_PSEUDONYM_KEY", KEY)
    await (await session()).run("read", { path: "ventes/devis" })
    vi.stubEnv("PLATFORM_PSEUDONYM_KEY", Buffer.alloc(32, 4).toString("base64"))
    forgetDictionaries()
    const changed = await (await session()).run("read", { path: "ventes/devis" })
    expect(changed.isError).toBe(true)
    expect(vi.mocked(console.error).mock.calls.flat().join(" ")).toContain("master key changed")
    // Le journal d'un appel dont la porte est en panne retient ses arguments.
    await writeJournal(await ref.db("claire"), [{ org_id: ref.org.id, user_id: ref.people.claire.id, method: "api", tool: "POST nodes", target: "Camille Dupré", args: { title: "Camille Dupré" }, is_error: true, error: "conflict: Camille Dupré exists." }])
    const rows = await journalRows()
    expect(rows.at(-1)).toMatchObject({ args: { _withheld: true }, target: null, error: "conflict" })
  })

  it("should rebuild the dictionary after an invalidation: a new person masked, an erased one no longer", async () => {
    const db = await ref.db("claire")
    const before = await pseudonymize(db, ref.org, { a: "Camille Dupré", b: "Lucie Bernard" })
    expect(before.a).toMatch(TOKEN_OF_A_PERSON)
    expect(before.b).toBe("Lucie Bernard")
    source.entities = [JEAN, { id: "c-3", values: { firstNames: "Lucie", lastName: "Bernard" } }]
    // Sans invalidation, le dictionnaire gardé sert encore l'ancienne liste (fenêtre acceptée, bornée à 5 minutes).
    expect((await pseudonymize(db, ref.org, { b: "Lucie Bernard" })).b).toBe("Lucie Bernard")
    await invalidateSensitiveEntities(db, ref.org)
    const after = await pseudonymize(db, ref.org, { a: "Camille Dupré", b: "Lucie Bernard" })
    expect(after).toEqual({ a: "Camille Dupré", b: expect.stringMatching(TOKEN_OF_A_PERSON) })
    const [state] = await seed.admin<{ generation: string }[]>`select generation::text from platform.pseudonym_orgs where org_id = ${ref.org.id}`
    expect(state.generation).toBe("1")
    // Une invalidation par un autre processus : la génération changée en base fait rebâtir le dictionnaire gardé ici.
    source.entities = [JEAN]
    await seed.admin`update platform.pseudonym_orgs set generation = generation + 1 where org_id = ${ref.org.id}`
    expect((await pseudonymize(db, ref.org, { b: "Lucie Bernard" })).b).toBe("Lucie Bernard")
  })

  it("should keep the state table out of reach of sessions, and its functions to the organisation's members", async () => {
    const db = await ref.db("claire")
    await expect(db.tx((sql) => sql`select * from platform.pseudonym_orgs`)).rejects.toThrow()
    await expect(db.tx((sql) => sql`select * from platform.pseudonym_org(${ref.other.id}, ${"s".repeat(20)}, ${"witness1"})`)).rejects.toThrow()
    await expect(db.tx((sql) => sql`select platform.invalidate_pseudonyms(${ref.other.id})`)).rejects.toThrow()
  })
})

describe.skipIf(!sqlConfigured)(portable("the pseudonymization gate of the admin MCP on a real database"), { timeout: 60_000 }, () => {
  let seed: SeededData
  let admin: AdminFixtureSql

  beforeAll(async () => {
    seed = seedWithAdmin()
    admin = await seedAdminFixture(seed, { tree: true })
  }, 180_000)

  afterAll(async () => {
    try {
      await admin?.forgetJournal()
    } finally {
      await seed?.cleanup()
    }
  }, 180_000)

  beforeEach(() => {
    vi.stubEnv("PLATFORM_PSEUDONYM_KEY", KEY)
    registerSensitiveEntities([{ kind: "client", list: async () => [JEAN], read: async () => null }])
    forgetDictionaries()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    registerSensitiveEntities(null)
  })

  it("should serve what an operation on an organisation shows, and its refusal, through that organisation's gate, and journal them pseudonymized", async () => {
    const deps = await admin.deps("sam")
    const mcp = await connectAdminMcp(deps)
    const { code } = await mcp.openAdmin()
    const node = (args: Record<string, unknown>) => mcp.call("admin_node", { ctx: code, org: admin.orgs.acme.slug, ...args })
    const moved = await node({ op: "move", path: "ventes/tarifs", new_path: "ventes/jean_morin" })
    expect(moved.isError).toBe(false)
    expect(moved.text).toMatch(/^ventes\/tarifs moved to ventes\/⟦client:[0-9a-hjkmnp-tv-z]{13}⟧ /u)
    expect(JSON.stringify(moved.structured)).not.toContain("jean_morin")
    const refused = await node({ op: "move", path: "ventes/jean_morin/nothing", new_path: "conseil/x" })
    expect(refused.isError).toBe(true)
    expect(refused.text).toMatch(TOKEN_OF_A_PERSON)
    expect(refused.text).not.toContain("jean_morin")
    await mcp.flush()
    const rows = await seed.admin<{ args: unknown; target: string | null; error: string | null }[]>`
      select args, target, error from platform.admin_journal where user_id = ${admin.persons.sam.id} and org_id = ${admin.orgs.acme.id}`
    expect(rows.length).toBeGreaterThanOrEqual(2)
    expect(JSON.stringify(rows)).not.toMatch(/jean_morin|Jean Morin/u)
  })
})
