// @vitest-environment node
// Le corps entier (`request.body` qui nomme un argument, connecteurs et comptes, § Moteur des connecteurs décrits) :
// l'objet validé part tel quel, en JSON ; sur un `fetch` simulé, sans base. Les cas communs avec la lib
// (`connectors/_cases/body.yaml`), copiés (`tests/factories/body-cases.ts`) en attendant
// `@otomata_tech/connectors/body-cases` : chaque cas par le chemin réel d'appel d'une fonction décrite (chemin, query,
// en-têtes posés par les arguments, corps), chaque entrée rejetée contre le contrôle des arguments de `call`, rien
// d'envoyé, et chaque fonction refusée contre `registerConnectors`, avec le code de la règle 20 de la fabrique.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { checkArguments } from "../../packages/plateforme/server/catalog/arguments"
import type { FunctionContext } from "../../packages/plateforme/server/catalog/define"
import { CatalogRegistrationError } from "../../packages/plateforme/server/catalog/erp"
import { catalogFunctions, findFunction } from "../../packages/plateforme/server/catalog/registry"
import { registerConnectors } from "../../packages/plateforme/server/connectors/declaration"
import type { ConnectorDefinition, ConnectorFunctionDefinition } from "../../packages/plateforme/server/connectors/definition"
import type { Fetch } from "../../packages/plateforme/server/connectors/http"
import { memoryTokens } from "../factories/described-connector"
import { bodyCases, bodyRefusals, bodyRefusedFunctions, bodyRejectedInputs, connector, createLead } from "../factories/body-cases"

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
    expect(bodyCases).toHaveLength(8)
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

  it("should keep a table body a table: the argument under its API name", async () => {
    const table = { ...createLead, request: { ...createLead.request, body: { contact: "lead" } } }
    registerConnectors([alone(table)])
    const { sent } = recorder()
    await call("body_cases_act.create_lead", { campaign_id: "cam-1", lead: { email: "ada@example.test" } })
    expect(sent[0].body).toEqual({ contact: { email: "ada@example.test" } })
  })
})
