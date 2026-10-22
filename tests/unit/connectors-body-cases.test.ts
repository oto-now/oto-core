// @vitest-environment node
// Le corps entier (`request.body` qui nomme un argument, connecteurs et comptes, § Moteur des connecteurs décrits) :
// l'objet validé part tel quel, en JSON ; sur un `fetch` simulé, sans base. Les cas communs avec la lib
// (`connectors/_cases/body.yaml`), copiés (`tests/factories/body-cases.ts`) en attendant
// `@otomata_tech/connectors/body-cases` : chaque cas par le chemin réel d'appel d'une fonction décrite (chemin, query,
// en-têtes posés par les arguments, corps), chaque entrée rejetée contre le contrôle des arguments de `call`, rien
// d'envoyé, et chaque fonction refusée contre `registerConnectors`, avec le code de la règle 20 de la fabrique. Les clés
// libres en texte de l'objet (décidé par Alexis le 2026-10-22) sont des données personnelles : ni la ligne de journal
// d'un appel servi, ni celle d'un appel refusé ne garde leur valeur.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { runCall } from "../../packages/plateforme/server/calls"
import { checkArguments } from "../../packages/plateforme/server/catalog/arguments"
import type { FunctionContext } from "../../packages/plateforme/server/catalog/define"
import { CatalogRegistrationError } from "../../packages/plateforme/server/catalog/erp"
import { personalValues } from "../../packages/plateforme/server/catalog/personal"
import { catalogFunctions, findFunction } from "../../packages/plateforme/server/catalog/registry"
import { bodyArgumentProblem } from "../../packages/plateforme/server/connectors/body-argument"
import { registerConnectors } from "../../packages/plateforme/server/connectors/declaration"
import type { ConnectorDefinition, ConnectorFunctionDefinition } from "../../packages/plateforme/server/connectors/definition"
import type { Fetch } from "../../packages/plateforme/server/connectors/http"
import type { PlatformDb } from "../../packages/plateforme/server/db"
import { PlatformError } from "../../packages/plateforme/server/errors"
import type { Identity } from "../../packages/plateforme/server/identity"
import { failedEntry, PERSONAL, servedEntry, type JournalEntry } from "../../packages/plateforme/server/journal"
import { memoryTokens } from "../factories/described-connector"
import { bodyCases, bodyRefusals, bodyRefusedFunctions, bodyRejectedInputs, connector, createLead, upsertContact } from "../factories/body-cases"

const BASE = "https://api.example.test/v1"

type Sent = { url: URL; method: string | undefined; headers: Record<string, string>; body: unknown }

/** Le `fetch` simulé : chaque requête gardée (adresse, méthode, en-têtes, corps lu en JSON), une réponse `{ ok: true }`. */
function recorder(): { sent: Sent[]; fetcher: ReturnType<typeof vi.fn<Fetch>> } {
  const sent: Sent[] = []
  const fetcher = vi.fn<Fetch>(async (input, init) => {
    const body = init?.body
    sent.push({
      url: new URL(String(input)),
      method: init?.method,
      headers: { ...(init?.headers as Record<string, string>) },
      body: typeof body === "string" ? JSON.parse(body) : body,
    })
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } })
  })
  vi.stubGlobal("fetch", fetcher)
  return { sent, fetcher }
}

/** Appelle une fonction déclarée comme `call` : arguments contrôlés (`checkArguments`), puis `run` ; sinon le refus. */
async function call(name: string, input: Record<string, unknown>) {
  const fn = findFunction(catalogFunctions(), name)
  if (!fn) throw new Error(`${name} is not declared`)
  const checked = checkArguments(fn.schema, structuredClone(input))
  if (!checked.success) return { refused: checked.issues }
  const credential = { fields: { api_key: "key_test" }, settings: {}, tokens: memoryTokens() }
  await fn.run({ db: {}, identity: {}, credential, account: { id: "account-1" } } as unknown as FunctionContext, checked.data as never)
  return { refused: null }
}

/** Le message du refus de `registerConnectors`, ou `"declared"`. */
function refusedWith(definition: ConnectorDefinition): string {
  try {
    registerConnectors([definition])
  } catch (error) {
    if (error instanceof CatalogRegistrationError) return error.message
    throw error
  }
  return "declared"
}

/** Le nom sous lequel `call` sert une fonction : `<connecteur>_act.<fonction>` pour une fonction qui engage. */
const served = (fn: ConnectorFunctionDefinition): string => (fn.act ? fn.name.replace(/^body_cases\./, "body_cases_act.") : fn.name)

/** Le connecteur des cas réduit à la fonction `fn`. */
const alone = (fn: ConnectorFunctionDefinition): ConnectorDefinition => ({ ...connector, functions: [fn] })

afterEach(() => {
  registerConnectors([])
  vi.unstubAllGlobals()
})

describe("the shared whole-body cases", () => {
  beforeEach(() => {
    registerConnectors([connector])
  })

  it("should declare the connector of the shared cases", () => {
    expect(bodyCases).toHaveLength(11)
    expect(connector.functions.every((fn) => findFunction(catalogFunctions(), fn.name) !== undefined)).toBe(true)
  })

  it.each(bodyCases.map((one) => [one.name, one] as const))("%s", async (_name, one) => {
    const { sent } = recorder()
    expect(await call(served(one.function), one.input)).toEqual({ refused: null })
    expect(sent).toHaveLength(1)
    const [request] = sent
    expect(request.method).toBe(one.function.request.method)
    expect(`${request.url.origin}${request.url.pathname}`).toBe(`${BASE}${one.request.path}`)
    expect([...request.url.searchParams]).toEqual(one.request.query)
    expect(request.headers).toMatchObject(one.request.headers)
    expect(request.headers["content-type"]).toBe("application/json")
    expect(request.body).toEqual(one.request.body)
  })

  it.each(bodyRejectedInputs.map((one) => [one.name, one] as const))("%s: refused before anything is sent", async (_name, one) => {
    const { fetcher } = recorder()
    const outcome = await call(served(one.function), one.input)
    expect(outcome.refused).not.toBeNull()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.todo("should play the whole-body cases of @otomata_tech/connectors/body-cases, shared with the Python lib, once the connectors pin brings them")
})

describe("the shared refused whole bodies (registerConnectors)", () => {
  it("should name the eight refusals of rule 20, each with a refused function", () => {
    expect(bodyRefusals).toHaveLength(8)
    expect(new Set(bodyRefusedFunctions.map((one) => one.refusal))).toEqual(new Set(bodyRefusals))
  })

  it.each(bodyRefusedFunctions.map((one) => [one.name, one] as const))("%s", (_name, one) => {
    const message = refusedWith(alone(one.function))
    expect(message.startsWith(`${one.function.name}: request.body ${String(one.function.request.body)}`)).toBe(true)
    expect(message.endsWith(`(${one.refusal}).`)).toBe(true)
  })

  it("should still refuse a body that is neither a map nor an argument name", () => {
    const fn = { ...createLead, request: { ...createLead.request, body: 3 } } as unknown as ConnectorFunctionDefinition
    expect(refusedWith(alone(fn))).toBe(`${createLead.name}: request needs pathParams, query, body (a map, or the argument that is the whole body) and headers.`)
  })

  // Ce que les cas communs ne portent pas, le schéma des descriptions le refusant avant la règle 20 (un nombre), ou ce
  // qu'une comparaison lâche confondrait (`personal: 1`, `type: ["string"]`) : jugé ici par la règle seule, et refusé
  // à la déclaration (un schéma qu'Ajv ne compile pas l'est avant elle).
  it.each([
    ["zero", 0],
    ["one", 1],
    ["true", true],
    ["personal_one", { type: "string", personal: 1 }],
    ["personal_text", { type: "string", personal: "true" }],
    ["type_list", { type: ["string"], personal: true }],
    ["description", { type: "string", personal: true, description: "A field." }],
  ] as const)("should refuse free keys other than exactly { type: string, personal: true }: %s", (_name, additional) => {
    const contact = { ...(upsertContact.schema.properties as Record<string, Record<string, unknown>>).contact, additionalProperties: additional }
    const fn = { ...upsertContact, schema: { ...upsertContact.schema, properties: { contact } } }
    expect(bodyArgumentProblem(fn)).toMatch(/ \(body_argument_not_strict\)\.$/)
    expect(refusedWith(alone(fn))).not.toBe("declared")
  })

  it("should keep a table body a table: the argument under its API name", async () => {
    const table = { ...createLead, request: { ...createLead.request, body: { contact: "lead" } } }
    registerConnectors([alone(table)])
    const { sent } = recorder()
    await call("body_cases_act.create_lead", { campaign_id: "cam-1", lead: { email: "ada@example.test" } })
    expect(sent[0].body).toEqual({ contact: { email: "ada@example.test" } })
  })
})

describe("free text keys of a whole body, all personal data", () => {
  const EMAIL = "ada@example.test"
  // Les clés libres (`city`, `team_size`) et la propriété déclarée `personal` (`email`) ; `first_name` et `score`,
  // déclarées sans la marque, restent lisibles.
  const contact = { email: EMAIL, first_name: "Ada", score: 3, city: "Valbrune-sur-Test", team_size: "10-50" }
  const opened = (args: { contact: Record<string, string | number> }): JournalEntry => ({
    org_id: "org-1",
    user_id: "user-1",
    method: "tools/call",
    args: { function: "body_cases_act.upsert_contact", arguments: args },
  })

  beforeEach(() => {
    registerConnectors([connector])
  })

  it("should mark the values of free keys, as those of a declared personal property, and not the other declared keys", () => {
    const fn = findFunction(catalogFunctions(), "body_cases_act.upsert_contact")
    if (!fn) throw new Error("upsert_contact is not declared")
    expect(upsertContact.schema.properties).toMatchObject({ contact: { additionalProperties: { type: "string", personal: true } } })
    expect(personalValues(fn, { contact }).sort()).toEqual([EMAIL, "Valbrune-sur-Test", "10-50"].sort())
    const served = opened({ contact })
    servedEntry(served, { text: "", target: fn.name, personal: personalValues(fn, { contact }) }, { ctx: null, host: null, resultChars: 0 })
    expect(served.args).toEqual({
      function: "body_cases_act.upsert_contact",
      arguments: { contact: { email: PERSONAL, first_name: "Ada", score: 3, city: PERSONAL, team_size: PERSONAL } },
    })
  })

  it("should keep a free key's value out of the line of a call refused before anything is sent, as a declared personal one", async () => {
    const { fetcher } = recorder()
    // `seats` n'est pas un texte : refusé par le schéma ; la valeur de `city`, une clé libre, était dans l'appel.
    const args = { contact: { ...contact, seats: 12 } }
    const identity = { org: { id: "org-1", slug: "acme", prefix: "acme", name: "Acme" }, user: { id: "user-1" }, teams: [] } as unknown as Identity
    const trace = {}
    const deps = { db: null as unknown as PlatformDb, identity, ctxCode: null, origin: "https://acme.test", activeConnectors: async () => new Set(["body_cases"]), trace }
    const error = await runCall(deps, { function: "body_cases_act.upsert_contact", arguments: args }).then(
      () => null,
      (refused: unknown) => refused,
    )
    expect(error instanceof PlatformError && error.code).toBe("invalid_arguments")
    expect(fetcher).not.toHaveBeenCalled()
    const failed = opened(args)
    const failure = error as PlatformError
    failedEntry(failed, { code: failure.code, message: `${failure.message} (city: ${contact.city})` }, { ctx: null, host: null, resultChars: 0, trace })
    const line = JSON.stringify(failed)
    for (const value of [EMAIL, "Valbrune-sur-Test", "10-50"]) expect(line).not.toContain(value)
    expect(failed.args).toMatchObject({ arguments: { contact: { first_name: "Ada", city: PERSONAL, seats: PERSONAL } } })
  })
})
