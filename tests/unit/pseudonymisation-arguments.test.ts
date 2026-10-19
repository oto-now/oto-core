// Les jetons dans les arguments (`docs/conception/pseudonymisation.md` § Les jetons dans les arguments, J2) : un jeton
// reçu se cherche dans le dictionnaire ; une requête reçoit la désignation de l'entité, un chemin sa forme en chemin,
// un argument d'entité d'une fonction de l'hôte l'identifiant ; un connecteur le refuse. D'abord sur un dictionnaire en
// mémoire, puis par le MCP sur une base jetable.
import * as z from "zod/v4"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { defineErpFunction, registerFunctions } from "../../packages/plateforme/server/catalog/erp"
import { createPlatformDb, type PlatformDb } from "../../packages/plateforme/server/db"
import { isPlatformError } from "../../packages/plateforme/server/errors"
import type { Identity } from "../../packages/plateforme/server/identity"
import { checkTokens, designatedText, pathCandidates, refuseTokens, withEntityIds } from "../../packages/plateforme/server/pseudonym/arguments"
import { registerSensitiveEntities, type SensitiveEntity, type SensitiveKind } from "../../packages/plateforme/server/pseudonym/declaration"
import { buildDictionary, type Dictionary } from "../../packages/plateforme/server/pseudonym/dictionary"
import { pseudonymizedText } from "../../packages/plateforme/server/pseudonym/gate"
import { resolvedCallArguments } from "../../packages/plateforme/server/pseudonym/inputs"
import { forgetDictionaries } from "../../packages/plateforme/server/pseudonym/service"
import { HMAC_BODY_SOURCE, orgKey, token, tokenSource } from "../../packages/plateforme/server/pseudonym/token"
import { connectMcp } from "../helpers/mcp"
import { contentTables, ORG, PEOPLE } from "../helpers/reference-org"
import { seedReferenceTables, type ReferenceOrgSql } from "../helpers/reference-org-sql"
import { portable, recordDb, seedWithAdmin, sqlConfigured, type SeededData } from "../helpers/sql"

vi.mock("../../packages/plateforme/server/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../packages/plateforme/server/db")>()
  return { ...original, createPlatformDb: vi.fn(original.createPlatformDb) }
})

const CAMILLE: SensitiveEntity = { id: "c-1", values: { firstNames: "Camille", lastName: "Dupré", emails: ["accueil@acme.test"] } }
const JEAN: SensitiveEntity = { id: "c-2", values: { firstNames: "Jean", lastName: "Morin", emails: ["accueil@acme.test"] } }
const ACME: SensitiveEntity = { id: "c-3", values: { aliases: ["Acme SA"] } }
const PERSON = tokenSource("client", HMAC_BODY_SOURCE)

/** Le code et la raison d'un refus levé par `work`. */
async function refusal(work: () => unknown): Promise<string> {
  try {
    await work()
  } catch (error) {
    return isPlatformError(error) ? `${error.code} ${String(error.details?.reason ?? "")}`.trim() : String(error)
  }
  return "no refusal"
}

describe("the tokens in the arguments, on a dictionary in memory", () => {
  const kind = (entities: SensitiveEntity[]): SensitiveKind => ({ kind: "client", list: async () => entities, read: async () => null })
  let dictionary: Dictionary
  let camille: string
  let jean: string
  let acme: string
  let shared: string

  beforeAll(async () => {
    dictionary = await buildDictionary([kind([CAMILLE, JEAN, ACME])], { id: "org-1", slug: "acme" }, orgKey(Buffer.alloc(32, 5), "org-1", "salt"))
    const served = pseudonymizedText(dictionary, "Camille Dupré, Jean Morin, Acme SA, accueil@acme.test")
    ;[camille, jean, acme, shared] = served.split(", ")
  })

  it("should give a query the designation of the entity, and a phrase too, keeping a shared value's token there", () => {
    expect([camille, jean, acme]).toEqual([expect.stringMatching(new RegExp(`^${PERSON}$`, "u")), expect.any(String), expect.any(String)])
    expect(designatedText(dictionary, `devis ${camille} et ${acme}`)).toBe("devis Camille Dupré et Acme SA")
    expect(designatedText(dictionary, `écrire à ${shared} pour ${jean}`, "content")).toBe(`écrire à ${shared} pour Jean Morin`)
  })

  it("should refuse an unknown token anywhere, and a shared value's token where a person is designated", async () => {
    const unknown = token("client", "0000000000000")
    expect(await refusal(() => designatedText(dictionary, `devis ${unknown}`))).toBe("invalid_arguments unknown_pseudonym")
    expect(await refusal(() => checkTokens(dictionary, { ops: [{ text: `voir ${unknown}` }] }, "content"))).toBe("invalid_arguments unknown_pseudonym")
    expect(await refusal(() => designatedText(dictionary, `devis ${shared}`))).toBe("invalid_arguments one_way_pseudonym")
    expect(await refusal(() => pathCandidates(dictionary, `clients/${shared}`))).toBe("invalid_arguments one_way_pseudonym")
    expect(() => checkTokens(dictionary, { text: `écrire à ${shared}` }, "content")).not.toThrow()
  })

  it("should try the path forms of an entity, prenoms_nom first, each giving back the path received", () => {
    expect(pathCandidates(dictionary, `clients/${camille}`)).toEqual(["clients/camille_dupre", "clients/dupre_camille", "clients/c_dupre"])
    expect(pathCandidates(dictionary, `clients/fiche_${acme}_2026`)).toEqual(["clients/fiche_acme_sa_2026"])
    expect(pathCandidates(dictionary, "ventes/devis")).toEqual(["ventes/devis"])
    // La forme en chemin d'une désignation libre est servie masquée, comme celle d'un nom.
    expect(pseudonymizedText(dictionary, "clients/acme_sa")).toBe(`clients/${acme}`)
  })

  it("should turn the token of an entity argument into its id, refuse another kind or a token among words, and pass the rest as is", async () => {
    const args = { client: camille, note: `rappeler ${jean}`, dossier: { client: jean }, lignes: [{ client: acme }] }
    const spec = { client: "client", "dossier.client": "client", "lignes.client": "client" }
    expect(withEntityIds(dictionary, args, spec)).toEqual({ client: "c-1", note: `rappeler ${jean}`, dossier: { client: "c-2" }, lignes: [{ client: "c-3" }] })
    expect(withEntityIds(dictionary, { client: "c-9" }, spec)).toEqual({ client: "c-9" })
    expect(await refusal(() => withEntityIds(dictionary, { client: `M. ${camille}` }, spec))).toBe("invalid_arguments")
    expect(await refusal(() => withEntityIds(dictionary, { client: camille }, { client: "dossier" }))).toBe("invalid_arguments")
    expect(await refusal(() => withEntityIds(dictionary, { client: shared }, spec))).toBe("invalid_arguments one_way_pseudonym")
  })

  it("should refuse any token toward a connector, and let a value given in clear pass", async () => {
    expect(await refusal(() => refuseTokens(dictionary, "mail.create_draft", { to: "x@y.test", body: `Pour ${camille}` }))).toBe("forbidden pseudonym_not_accepted")
    expect(await refusal(() => refuseTokens(dictionary, "mail.create_draft", { body: `Pour ${shared}` }))).toBe("forbidden pseudonym_not_accepted")
    expect(() => refuseTokens(dictionary, "mail.create_draft", { to: "camille@acme.test", body: "Pour Camille Dupré" })).not.toThrow()
  })

  it("should resolve the path arguments of a native function to the path that exists, else to prenoms_nom", async () => {
    const existing = ["ventes/dupre_camille"]
    const db = { tx: async (work: (sql: unknown) => unknown) => work(() => Promise.resolve(existing.map((path) => ({ path })))) } as unknown as PlatformDb
    const inputs = { db, identity: { org: { id: "org-1" } } as Identity, dictionary }
    const native = { name: "table.rows", origin: "paquet" as const }
    expect(await resolvedCallArguments(inputs, native, { table: `ventes/${camille}`, filter: { nom: camille } })).toEqual({ table: "ventes/dupre_camille", filter: { nom: camille } })
    existing.length = 0
    expect(await resolvedCallArguments(inputs, native, { pages: [{ path: `ventes/${camille}` }] })).toEqual({ pages: [{ path: "ventes/camille_dupre" }] })
    expect(await refusal(() => resolvedCallArguments(inputs, { name: "mail.create_draft", origin: "connecteur" }, { body: camille }))).toBe("forbidden pseudonym_not_accepted")
  })
})

const clientCard = defineErpFunction({
  name: "erp.client_card",
  class: "read",
  description: "Reads the card of a client of the ERP.",
  schema: z.strictObject({ client: z.string().regex(/^c-\d+$/u), note: z.string().optional() }),
  examples: [{ client: "c-1" }],
  entityArguments: { client: "client" },
  run: async (_context, args) => ({ text: `Card of ${args.client}: Camille Dupré.${args.note ? ` ${args.note}` : ""}` }),
})

describe.skipIf(!sqlConfigured)(portable("the tokens in the arguments, through MCP on a real database"), { timeout: 60_000 }, () => {
  const CTX = "7K3Q-M2XC"
  let seed: SeededData
  let ref: ReferenceOrgSql

  beforeAll(async () => {
    registerFunctions([clientCard])
    const tables = contentTables()
    tables.orgs[0].rules_version = 1
    tables.ctx = [{ code: CTX, org_id: ORG.id, user_id: PEOPLE.claire.id, rules_version: 1, host: null }]
    seed = seedWithAdmin()
    ref = await seedReferenceTables(seed, tables)
    await ref.addNodes([
      { path: "ventes/relance_jean_morin", kind: "procedure", title: "Relance", summary: "Relance." },
      { path: "ventes/dupre_camille", kind: "page", title: "Fiche", summary: "La fiche d'une cliente." },
      { path: "ventes/rappel", kind: "procedure", title: "Rappeler Jean Morin", summary: "Pour Camille Dupré." },
    ])
    await ref.addBlocks("ventes/devis", "published", [{ type: "paragraph", text: "Appeler Camille Dupré, puis Jean Morin." }])
    await ref.write({ connector_activations: [{ org_id: ORG.id, connector: "mail" }] })
  }, 180_000)

  afterAll(async () => {
    registerFunctions([])
    await seed?.cleanup()
  }, 180_000)

  beforeEach(async () => {
    vi.stubEnv("PLATFORM_PSEUDONYM_KEY", Buffer.alloc(32, 4).toString("base64"))
    registerSensitiveEntities([{ kind: "client", list: async () => [CAMILLE, JEAN], read: async () => null }])
    forgetDictionaries()
    await seed.admin`delete from platform.pseudonym_orgs where org_id = ${ref.org.id}`
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    registerSensitiveEntities(null)
  })

  async function session() {
    vi.mocked(createPlatformDb).mockReturnValueOnce(recordDb(await ref.db("claire")).db)
    const connected = await connectMcp(ref.org, { id: ref.people.claire.id, email: ref.people.claire.email, accessToken: "token-of-claire" })
    const run = (tool: string, fields: Record<string, unknown>) => connected.call(tool, { ctx: ref.id(CTX), ...fields })
    // Les jetons de Camille puis de Jean, tels qu'une page les sert.
    const page = await run("read", { path: "ventes/devis" })
    const [camille, jean] = page.text.match(new RegExp(PERSON, "gu")) ?? []
    return { run, camille, jean }
  }

  it("should read a page by a path served with a token, find by a token, and write a page whose path carries one", async () => {
    const { run, camille, jean } = await session()
    const procedure = await run("read", { path: `ventes/relance_${jean}` })
    expect([procedure.isError, procedure.text]).toEqual([false, expect.stringContaining("Relance")])
    // Deux formes en chemin : celle qui existe l'emporte sur `camille_dupre`.
    const card = await run("read", { path: `ventes/${camille}` })
    expect([card.isError, card.text]).toEqual([false, expect.stringContaining("La fiche d'une cliente")])
    const found = await run("find", { query: jean, type: "procedure" })
    expect(found.text).toContain("ventes/rappel")
    expect(found.text).not.toMatch(/Morin|Dupré/u)
    const written = await run("write", { path: `ventes/${jean}`, kind: "page", title: "Suivi", summary: "Le suivi.", ops: [{ op: "set_markdown", text: `Rappeler ${jean}.` }], publish: true })
    expect(written.isError).toBe(false)
    const [row] = await seed.admin<{ text: string }[]>`
      select b.text from platform.blocks b join platform.nodes n on n.id = b.node_id where n.org_id = ${ref.org.id} and n.path = 'ventes/jean_morin'`
    expect(row?.text).toBe(`Rappeler ${jean}.`)
  })

  it("should refuse an unknown token, give a host function the id, and refuse a token toward a connector", async () => {
    const { run, camille } = await session()
    const unknown = await run("read", { path: `ventes/${token("client", "0000000000000")}` })
    expect([unknown.isError, unknown.text]).toEqual([true, expect.stringMatching(/^Unknown token /u)])
    const card = await run("call", { function: "erp.client_card", arguments: { client: camille, note: `Pour ${camille}.` } })
    expect([card.isError, card.text]).toEqual([false, `Card of c-1: ${camille}. Pour ${camille}.`])
    const draft = await run("call", { function: "mail.create_draft", arguments: { to: "x@acme.test", subject: "Relance", body: `Bonjour ${camille}` } })
    expect([draft.isError, draft.text]).toEqual([true, expect.stringMatching(/^mail\.create_draft does not take a token/u)])
  })
})
