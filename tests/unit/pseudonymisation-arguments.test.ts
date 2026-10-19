// Les jetons dans les arguments (`docs/conception/pseudonymisation.md` § Les jetons dans les arguments, J2) : un jeton
// reçu se cherche dans le dictionnaire ; une requête reçoit la désignation de l'entité, un chemin sa forme en chemin,
// un argument d'entité d'une fonction de l'hôte l'identifiant ; un connecteur le refuse. D'abord sur un dictionnaire en
// mémoire, puis par le MCP sur une base jetable.
import * as z from "zod/v4"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { CatalogRegistrationError, defineErpFunction, registerFunctions } from "../../packages/plateforme/server/catalog/erp"
import { createPlatformDb, type PlatformDb } from "../../packages/plateforme/server/db"
import { isPlatformError } from "../../packages/plateforme/server/errors"
import type { Identity } from "../../packages/plateforme/server/identity"
import { checkTokens, designatedText, pathCandidates, refuseTokens, withEntityIds } from "../../packages/plateforme/server/pseudonym/arguments"
import { registerSensitiveEntities, type SensitiveEntity, type SensitiveKind } from "../../packages/plateforme/server/pseudonym/declaration"
import { buildDictionary, type Dictionary } from "../../packages/plateforme/server/pseudonym/dictionary"
import { pseudonymizedPlaces, pseudonymizedText } from "../../packages/plateforme/server/pseudonym/gate"
import { resolvedCallArguments } from "../../packages/plateforme/server/pseudonym/inputs"
import { WITHHELD, withEntityTokens } from "../../packages/plateforme/server/pseudonym/outputs"
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

  it("should take for text what only has a token's shape, at the gate and at the entry", async () => {
    // Sans enveloppe fermante, l'ancre d'une adresse a la forme d'un jeton : elle ne protège pas un nom, n'est pas refusée.
    expect(pseudonymizedText(dictionary, "https://crm.test/fiche#camille_dupre")).toBe(`https://crm.test/fiche#${camille}`)
    expect(pseudonymizedText(dictionary, "voir fiche#camille dupré")).toBe(`voir fiche#${camille}`)
    expect(pseudonymizedText(dictionary, `voir fiche#${camille}`)).toBe(`voir fiche#${camille}`)
    expect(() => checkTokens(dictionary, "https://docs.test/guide#installation, issue#12, doc.md#intro", "designation")).not.toThrow()
    expect(designatedText(dictionary, `fiche#${camille} et guide#intro`)).toBe("fiche#Camille Dupré et guide#intro")
    expect(pathCandidates(dictionary, "docs/guide#intro")).toEqual(["docs/guide#intro"])
    expect(withEntityIds(dictionary, { client: "issue#12" }, { client: "client" })).toEqual({ client: "issue#12" })
    expect(() => refuseTokens(dictionary, "mail.send", { body: "voir guide#installation" })).not.toThrow()
    expect(await refusal(() => checkTokens(dictionary, token("client", "0".repeat(13)), "content"))).toBe("invalid_arguments unknown_pseudonym")
  })

  it("should serve the declared fields of a host function as the entity's token, withhold an unknown entity, and clear the text", () => {
    const output = {
      text: "Martin (Camille), Dupré (Camille) ; Martin (Paul).",
      data: { clients: [{ id: "c-1", identite: { nom: "Dupré", prenoms: "Camille" } }, { id: "c-9", identite: { nom: "Martin", prenoms: "Paul" } }], total: 2 },
    }
    const fields = [{ kind: "client", at: "clients", id: "id", fields: ["identite.nom", "identite.prenoms"] }]
    const served = withEntityTokens(dictionary, output, fields)
    expect(served.data).toEqual({
      clients: [{ id: "c-1", identite: { nom: camille, prenoms: camille } }, { id: "c-9", identite: { nom: WITHHELD, prenoms: WITHHELD } }],
      total: 2,
    })
    expect(served.text).toBe(`${WITHHELD} (${camille}), ${camille} (${camille}) ; ${WITHHELD} (${WITHHELD}).`)
    // La sortie de la fonction n'est pas touchée : `callFunction` la rend en clair.
    expect(output.data.clients[0].identite.nom).toBe("Dupré")
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
    // Le jeton d'une valeur détectée (courriel, téléphone d'une personne non déclarée) : à sens unique, sans dictionnaire.
    const detected = pseudonymizedText(dictionary, "lea.roux@ailleurs.test")
    expect(detected).toMatch(/^email#/u)
    expect(await refusal(() => designatedText(dictionary, `devis ${detected}`))).toBe("invalid_arguments one_way_pseudonym")
    expect(() => checkTokens(dictionary, { text: `écrire à ${detected}` }, "content")).not.toThrow()
    expect(await refusal(() => refuseTokens(dictionary, "mail.create_draft", { to: detected }))).toBe("forbidden pseudonym_not_accepted")
    expect(await refusal(() => checkTokens(dictionary, { text: "voir iban#0000000000000" }, "content"))).toBe("invalid_arguments unknown_pseudonym")
  })

  it("should try the path forms of an entity, prenoms_nom first, each giving back the path received", () => {
    expect(pathCandidates(dictionary, `clients/${camille}`)).toEqual(["clients/camille_dupre", "clients/dupre_camille", "clients/c_dupre", "clients/dupre"])
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

  it("should map a place of the pseudonymized text back to the clear text, and none strictly inside a token", () => {
    const clear = "Écrire à Camille Dupré, puis à C. Dupré."
    const places = pseudonymizedPlaces(dictionary, clear)
    expect(places.text).toBe(`Écrire à ${camille}, puis à ${camille}.`)
    const second = places.text.lastIndexOf(camille)
    expect([places.clearAt(0), places.clearAt(9), places.clearAt(9 + camille.length), places.clearAt(second), places.clearAt(second + camille.length)]).toEqual([0, 9, 22, 31, 39])
    expect(places.clearAt(10)).toBeNull()
    expect(clear.slice(places.clearAt(second) ?? 0, places.clearAt(places.text.length) ?? 0)).toBe("C. Dupré.")
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

const clientFiche = defineErpFunction({
  name: "erp.client_fiche",
  class: "read",
  description: "Reads the fiche of a client of the ERP.",
  schema: z.strictObject({ client: z.string().regex(/^c-\d+$/u) }),
  examples: [{ client: "c-2" }],
  entityArguments: { client: "client" },
  output: { entityFields: [{ kind: "client", id: "id", fields: ["nom", "prenoms"] }] },
  run: async (_context, args) => ({ text: `Fiche de Morin (Jean), ${args.client}.`, data: { id: args.client, nom: "Morin", prenoms: "Jean", ville: "Nantes" } }),
})

describe("the declared fields of a host function, at registration", () => {
  afterEach(() => registerFunctions([]))

  it("should refuse a malformed output declaration, naming it", () => {
    const declared = (output: unknown) => {
      try {
        registerFunctions([defineErpFunction({ ...clientFiche, run: async () => ({ text: "" }), output } as Parameters<typeof defineErpFunction>[0])])
      } catch (error) {
        return error instanceof CatalogRegistrationError ? error.message : String(error)
      }
      return "registered"
    }
    expect(declared({ entityFields: [{ kind: "client", id: "id", fields: ["nom"] }] })).toBe("registered")
    expect(declared({ withhold: ["nom"] })).toBe("erp.client_fiche: output: unknown key withhold; expected entityFields.")
    expect(declared({ entityFields: [{ kind: "Client", id: "id", fields: ["nom"] }] })).toMatch(/output\.entityFields\[0\]\.kind/u)
    expect(declared({ entityFields: [{ kind: "client", id: "id", fields: [] }] })).toMatch(/fields must list at least one path/u)
    expect(declared({ entityFields: [{ kind: "client", id: "id", fields: ["nom"], at: "a b" }] })).toMatch(/\.at: "a b" is not a path/u)
  })
})

describe.skipIf(!sqlConfigured)(portable("the tokens in the arguments, through MCP on a real database"), { timeout: 60_000 }, () => {
  const CTX = "7K3Q-M2XC"
  let seed: SeededData
  let ref: ReferenceOrgSql

  beforeAll(async () => {
    registerFunctions([clientCard, clientFiche])
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

  it("should replace in clear the text that replace_text finds with a token, whatever form the page gives the name", async () => {
    const { run, camille } = await session()
    const created = await run("write", { path: "ventes/note", kind: "page", title: "Note", summary: "Une note.", ops: [{ op: "set_markdown", text: "Appeler Camille Dupré au sujet du devis. Puis écrire à C. Dupré." }], publish: true })
    expect(created.isError).toBe(false)
    const replaced = await run("write", { path: "ventes/note", base_revision: 1, ops: [{ op: "replace_text", find: `${camille} au sujet`, text: "la cliente au sujet" }], publish: true })
    expect([replaced.isError, replaced.text]).toEqual([false, expect.stringContaining("replaced 1 occurrence")])
    const again = await run("write", { path: "ventes/note", base_revision: 2, ops: [{ op: "replace_text", find: `à ${camille}.`, text: "à elle." }], publish: true })
    expect(again.isError).toBe(false)
    const [row] = await seed.admin<{ text: string }[]>`
      select b.text from platform.blocks b join platform.nodes n on n.id = b.node_id
       where n.org_id = ${ref.org.id} and n.path = 'ventes/note' and b.state = 'published' and b.type = 'paragraph'`
    expect(row?.text).toBe("Appeler la cliente au sujet du devis. Puis écrire à elle.")
  })

  it("should compare a table's filters and keys with tokens in the pseudonymized space, and keep a token in a new cell", async () => {
    const { run, camille, jean } = await session()
    const header = { columns: [{ name: "nom", type: "text", required: true }, { name: "ville", type: "text" }, { name: "contact", type: "text" }], key: "nom" }
    expect((await run("write", { path: "ventes/suivi", kind: "table", title: "Suivi", summary: "Le suivi des clients.", header, publish: true })).isError).toBe(false)
    const rows = [{ key: "Camille Dupré", set: { ville: "Lyon", contact: "Camille Dupré" } }, { key: "Jean Morin", set: { ville: "Nantes", contact: "M. Jean Morin" } }]
    expect((await run("call", { function: "table.write", arguments: { table: "ventes/suivi", rows } })).isError).toBe(false)
    const equal = await run("call", { function: "table.rows", arguments: { table: "ventes/suivi", filter: { contact: camille } } })
    expect([equal.text.includes("Lyon"), equal.text.includes("Nantes")]).toEqual([true, false])
    const contains = await run("call", { function: "table.rows", arguments: { table: "ventes/suivi", filter: { contact: { contains: jean } } } })
    expect([contains.text.includes("Lyon"), contains.text.includes("Nantes")]).toEqual([false, true])
    const searched = await run("call", { function: "table.rows", arguments: { table: "ventes/suivi", q: jean } })
    expect([searched.text.includes("Lyon"), searched.text.includes("Nantes")]).toEqual([false, true])
    // La clé reçue en jeton désigne la ligne existante ; une cellule neuve garde le jeton.
    const updated = await run("call", { function: "table.write", arguments: { table: "ventes/suivi", rows: [{ key: camille, set: { ville: "Paris", contact: `${camille} (rappel)` } }] } })
    expect(updated.isError).toBe(false)
    const stored = await seed.admin<{ key: string; data: { ville?: string; contact?: string } }[]>`
      select b.key, b.data from platform.blocks b join platform.nodes n on n.id = b.node_id
       where n.org_id = ${ref.org.id} and n.path = 'ventes/suivi' and b.type = 'row' order by b.key`
    expect(stored.map((row) => [row.key, row.data.ville, row.data.contact])).toEqual([
      ["Camille Dupré", "Paris", `${camille} (rappel)`],
      ["Jean Morin", "Nantes", "M. Jean Morin"],
    ])
  })

  it("should refuse an unknown token, give a host function the id, serve its declared fields as tokens, and refuse a token toward a connector", async () => {
    const { run, camille, jean } = await session()
    const unknown = await run("read", { path: `ventes/${token("client", "0000000000000")}` })
    expect([unknown.isError, unknown.text]).toEqual([true, expect.stringMatching(/^Unknown token /u)])
    const card = await run("call", { function: "erp.client_card", arguments: { client: camille, note: `Pour ${camille}.` } })
    expect([card.isError, card.text]).toEqual([false, `Card of c-1: ${camille}. Pour ${camille}.`])
    // Les champs déclarés d'une fiche : le jeton de Jean, dans les données et dans le texte, nom et prénom compris.
    const fiche = await run("call", { function: "erp.client_fiche", arguments: { client: jean } })
    expect([fiche.isError, fiche.text]).toEqual([false, expect.stringContaining(`Fiche de ${jean} (${jean}), c-2.`)])
    expect(JSON.stringify(fiche.result)).not.toMatch(/Morin|"Jean"/u)
    expect(JSON.stringify(fiche.result.structuredContent)).toContain(`"nom":"${jean}"`)
    const draft = await run("call", { function: "mail.create_draft", arguments: { to: "x@acme.test", subject: "Relance", body: `Bonjour ${camille}` } })
    expect([draft.isError, draft.text]).toEqual([true, expect.stringMatching(/^mail\.create_draft does not take a token/u)])
  })
})
