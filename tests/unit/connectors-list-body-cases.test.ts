// @vitest-environment node
// Le corps en liste (`request.bodyList`, connecteurs et comptes, § Moteur des connecteurs décrits) : le corps construit,
// table ou argument entier, part seul élément d'une liste JSON ; sur un `fetch` simulé, sans base. Les cas communs avec
// la lib (`connectors/_cases/list_body.yaml`), copiés (`tests/factories/list-body-cases.ts`) en attendant
// `@otomata_tech/connectors/list-body-cases` : chaque cas par le chemin réel d'appel d'une fonction décrite (chemin,
// query, en-têtes posés par les arguments, corps), chaque entrée rejetée contre le contrôle des arguments de `call`, rien
// d'envoyé, et chaque fonction refusée contre `registerConnectors`, avec le code de la règle 23 de la fabrique.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { checkArguments } from "../../packages/plateforme/server/catalog/arguments"
import type { FunctionContext } from "../../packages/plateforme/server/catalog/define"
import { CatalogRegistrationError } from "../../packages/plateforme/server/catalog/erp"
import { catalogFunctions, findFunction } from "../../packages/plateforme/server/catalog/registry"
import { bodyListProblem } from "../../packages/plateforme/server/connectors/body-list"
import { registerConnectors } from "../../packages/plateforme/server/connectors/declaration"
import type { ConnectorDefinition, ConnectorFunctionDefinition } from "../../packages/plateforme/server/connectors/definition"
import type { Fetch } from "../../packages/plateforme/server/connectors/http"
import { memoryTokens } from "../factories/described-connector"
import { connector, listBodyCases, listBodyRefusals, listBodyRefusedFunctions, listBodyRejectedInputs, searchKeyword } from "../factories/list-body-cases"

const BASE = "https://api.example.test/v3"

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
  const credential = { fields: { login: "login_test", password: "password_test" }, settings: {}, tokens: memoryTokens() }
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
const served = (fn: ConnectorFunctionDefinition): string => (fn.act ? fn.name.replace(/^list_body_cases\./, "list_body_cases_act.") : fn.name)

/** Le connecteur des cas réduit à la fonction `fn`. */
const alone = (fn: ConnectorFunctionDefinition): ConnectorDefinition => ({ ...connector, functions: [fn] })

afterEach(() => {
  registerConnectors([])
  vi.unstubAllGlobals()
})

describe("the shared list-body cases", () => {
  beforeEach(() => {
    registerConnectors([connector])
  })

  it("should declare the connector of the shared cases", () => {
    expect(listBodyCases).toHaveLength(5)
    expect(connector.functions.every((fn) => findFunction(catalogFunctions(), fn.name) !== undefined)).toBe(true)
  })

  it.each(listBodyCases.map((one) => [one.name, one] as const))("%s", async (_name, one) => {
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

  it.each(listBodyRejectedInputs.map((one) => [one.name, one] as const))("%s: refused before anything is sent", async (_name, one) => {
    const { fetcher } = recorder()
    const outcome = await call(served(one.function), one.input)
    expect(outcome.refused).not.toBeNull()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it("should send the object itself without the flag", async () => {
    registerConnectors([alone({ ...searchKeyword, request: { ...searchKeyword.request, bodyList: undefined } })])
    const { sent } = recorder()
    await call("list_body_cases.search_keyword", { engine: "web", keyword: "alpha" })
    expect(sent[0].body).toEqual({ keyword: "alpha" })
  })

  it.todo("should play the list-body cases of @otomata_tech/connectors/list-body-cases, shared with the Python lib, once the connectors pin brings them")
})

describe("the shared refused list bodies (registerConnectors)", () => {
  it("should name the three refusals of rule 23, each with a refused function", () => {
    expect([...listBodyRefusals]).toEqual(["body_list_without_body", "body_list_method", "body_list_multipart"])
    expect(new Set(listBodyRefusedFunctions.map((one) => one.refusal))).toEqual(new Set(listBodyRefusals))
  })

  it.each(listBodyRefusedFunctions.map((one) => [one.name, one] as const))("%s", (_name, one) => {
    const message = refusedWith(alone(one.function))
    expect(message.startsWith(`${one.function.name}: request.bodyList`)).toBe(true)
    expect(message.endsWith(`(${one.refusal}).`)).toBe(true)
    expect(bodyListProblem(one.function)).toMatch(new RegExp(` \\(${one.refusal}\\)\\.$`))
  })
})
