// @vitest-environment node
// Le corps emboîté (`request.body` en table dont une valeur est une table, connecteurs et comptes, § Moteur des
// connecteurs décrits) : la constante du corps, puis chaque argument donné à son chemin ; sur un `fetch` simulé, sans
// base. Les cas communs avec la lib (`connectors/_cases/nested_body.yaml`), copiés
// (`tests/factories/nested-body-cases.ts`) en attendant `@otomata_tech/connectors/nested-body-cases` : chaque cas par le
// chemin réel d'appel d'une fonction décrite (chemin, query, en-têtes posés par les arguments, corps), chaque entrée
// rejetée contre le contrôle des arguments de `call`, rien d'envoyé, et chaque fonction refusée contre
// `registerConnectors`, avec le code de la règle 22 de la fabrique. Puis la pagination dont le curseur est sous une clé
// emboîtée, page par page.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { checkArguments } from "../../packages/plateforme/server/catalog/arguments"
import type { FunctionContext } from "../../packages/plateforme/server/catalog/define"
import { CatalogRegistrationError } from "../../packages/plateforme/server/catalog/erp"
import { catalogFunctions, findFunction } from "../../packages/plateforme/server/catalog/registry"
import { bodyTableProblem } from "../../packages/plateforme/server/connectors/body-table"
import { registerConnectors } from "../../packages/plateforme/server/connectors/declaration"
import type { ConnectorDefinition, ConnectorFunctionDefinition } from "../../packages/plateforme/server/connectors/definition"
import type { Fetch } from "../../packages/plateforme/server/connectors/http"
import { memoryTokens } from "../factories/described-connector"
import {
  connector,
  createRecord,
  listIssues,
  nestedBodyCases,
  nestedBodyRefusals,
  nestedBodyRefusedFunctions,
  nestedBodyRejectedInputs,
  updateIssue,
} from "../factories/nested-body-cases"

const BASE = "https://api.example.test/v1"

type Sent = { url: URL; method: string | undefined; headers: Record<string, string>; body: unknown }

/** Le `fetch` simulé : chaque requête gardée (adresse, méthode, en-têtes, corps lu en JSON) ; les réponses dans l'ordre, puis `{ ok: true }`. */
function recorder(answers: unknown[] = []): { sent: Sent[]; fetcher: ReturnType<typeof vi.fn<Fetch>> } {
  const sent: Sent[] = []
  const fetcher = vi.fn<Fetch>(async (input, init) => {
    const body = init?.body
    sent.push({
      url: new URL(String(input)),
      method: init?.method,
      headers: { ...(init?.headers as Record<string, string>) },
      body: typeof body === "string" ? JSON.parse(body) : body,
    })
    return new Response(JSON.stringify(answers.shift() ?? { ok: true }), { status: 200, headers: { "content-type": "application/json" } })
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
const served = (fn: ConnectorFunctionDefinition): string => (fn.act ? fn.name.replace(/^nested_body_cases\./, "nested_body_cases_act.") : fn.name)

/** Le connecteur des cas réduit à la fonction `fn`. */
const alone = (fn: ConnectorFunctionDefinition): ConnectorDefinition => ({ ...connector, functions: [fn] })

afterEach(() => {
  registerConnectors([])
  vi.unstubAllGlobals()
})

describe("the shared nested-body cases", () => {
  beforeEach(() => {
    registerConnectors([connector])
  })

  it("should declare the connector of the shared cases", () => {
    expect(nestedBodyCases).toHaveLength(9)
    expect(connector.functions.every((fn) => findFunction(catalogFunctions(), fn.name) !== undefined)).toBe(true)
  })

  it.each(nestedBodyCases.map((one) => [one.name, one] as const))("%s", async (_name, one) => {
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

  it.each(nestedBodyRejectedInputs.map((one) => [one.name, one] as const))("%s: refused before anything is sent", async (_name, one) => {
    const { fetcher } = recorder()
    const outcome = await call(served(one.function), one.input)
    expect(outcome.refused).not.toBeNull()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it("should leave the body constant of the definition intact, call after call", async () => {
    const { sent } = recorder()
    await call("nested_body_cases_act.create_record", { object: "people", values: { name: "Ada" }, owner_id: "u-1" })
    await call("nested_body_cases_act.create_record", { object: "people", values: { name: "Grace" } })
    expect(createRecord.request.constants?.body).toEqual({ data: { format: "plain" } })
    expect(sent.map((one) => one.body)).toEqual([
      { data: { format: "plain", values: { name: "Ada" }, owner_id: "u-1" } },
      { data: { format: "plain", values: { name: "Grace" } } },
    ])
  })

  it("should encode a nested argument before placing it, as at the first level", async () => {
    const encoded = { ...updateIssue, request: { ...updateIssue.request, encode: { priority: "json" as const } } }
    registerConnectors([alone(encoded)])
    const { sent } = recorder()
    await call("nested_body_cases_act.update_issue", { issue_id: "i-1", priority: 2 })
    expect(sent[0].body).toMatchObject({ variables: { id: "i-1", input: { priority: "2" } } })
  })

  it.todo("should play the nested-body cases of @otomata_tech/connectors/nested-body-cases, shared with the Python lib, once the connectors pin brings them")
})

describe("a cursor under a nested key", () => {
  const page = (cursor: string | null, more: boolean) => ({ data: { issues: { nodes: [{ id: "i-1" }], pageInfo: { endCursor: cursor, hasNextPage: more } } } })

  beforeEach(() => {
    registerConnectors([connector])
  })

  it("should place the next cursor at its nested path, page after page, the rest of the body unchanged", async () => {
    const { sent } = recorder([page("c-2", true), page("c-3", true), page("c-4", false)])
    expect(await call("nested_body_cases.list_issues", { first: 50, all_pages: true })).toEqual({ refused: null })
    expect(sent).toHaveLength(3)
    const query = listIssues.request.constants?.body?.query
    expect(sent.map((one) => one.body)).toEqual([
      { query, variables: { first: 50 } },
      { query, variables: { first: 50, after: "c-2" } },
      { query, variables: { first: 50, after: "c-3" } },
    ])
  })

  it("should stop at the last page, as `more` says", async () => {
    const { sent } = recorder([page("c-2", false)])
    await call("nested_body_cases.list_issues", { first: 50, after: "c-1", all_pages: true })
    expect(sent).toHaveLength(1)
    expect(sent[0].body).toMatchObject({ variables: { first: 50, after: "c-1" } })
  })
})

describe("the shared refused nested bodies (registerConnectors)", () => {
  it("should name the three refusals of rule 22, each with a refused function", () => {
    expect([...nestedBodyRefusals]).toEqual(["body_nested_empty", "body_key_twice", "body_nested_multipart"])
    expect(new Set(nestedBodyRefusedFunctions.map((one) => one.refusal))).toEqual(new Set(nestedBodyRefusals))
  })

  it.each(nestedBodyRefusedFunctions.map((one) => [one.name, one] as const))("%s", (_name, one) => {
    const message = refusedWith(alone(one.function))
    expect(message.startsWith(`${one.function.name}: request.body `)).toBe(true)
    expect(message.endsWith(`(${one.refusal}).`)).toBe(true)
    expect(bodyTableProblem(one.function)).toMatch(new RegExp(` \\(${one.refusal}\\)\\.$`))
  })

  it("should name the path where a constant and an argument meet", () => {
    const paths = Object.fromEntries(nestedBodyRefusedFunctions.map((one) => [one.name, bodyTableProblem(one.function)?.split(" ")[2]]))
    expect(paths).toEqual({
      empty_nested_table: "data",
      deep_empty_nested_table: "data.meta",
      argument_on_a_constant: "data.format",
      flat_argument_on_a_constant: "draft",
      argument_over_a_constant_object: "data",
      table_under_a_constant_value: "data",
      nested_in_multipart: "meta.title",
    })
  })

  it.each([
    ["number", 3],
    ["null", null],
    ["list", ["title"]],
  ] as const)("should refuse a nested value that is neither an argument name nor a table: %s", (_name, value) => {
    const variables = { id: "issue_id", input: { title: value } }
    const fn = { ...updateIssue, request: { ...updateIssue.request, body: { variables } } } as unknown as ConnectorFunctionDefinition
    expect(refusedWith(alone(fn))).toBe(`${updateIssue.name}: request needs pathParams, query, body (a map, or the argument that is the whole body) and headers.`)
  })

  it("should refuse a nested argument the schema does not declare, by its name", () => {
    const fn = { ...updateIssue, request: { ...updateIssue.request, body: { variables: { id: "issue_id", input: { state: "state_id" } } } } }
    expect(refusedWith(alone(fn))).toBe(`${updateIssue.name}: request places state_id, which the schema does not declare.`)
  })
})
