// @vitest-environment node
// Retirer de la sortie (`output.strip`, connecteurs et comptes, § Moteur des connecteurs décrits) : un chemin à points,
// relatif à chaque élément de `items` ou à la réponse entière, à travers les listes ; sur un `fetch` simulé, sans base.
// Les cas communs avec la lib (`connectors/_cases/strip.yaml`), copiés (`tests/factories/strip-cases.ts`) en attendant
// `@otomata_tech/connectors/strip-cases` : chaque cas par le chemin réel d'appel d'une fonction décrite, chaque sortie
// refusée contre `registerConnectors`, avec le code de la règle 18 de la fabrique.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { checkArguments } from "../../packages/plateforme/server/catalog/arguments"
import type { FunctionContext } from "../../packages/plateforme/server/catalog/define"
import { CatalogRegistrationError } from "../../packages/plateforme/server/catalog/erp"
import { catalogFunctions, findFunction } from "../../packages/plateforme/server/catalog/registry"
import { registerConnectors } from "../../packages/plateforme/server/connectors/declaration"
import type { ConnectorDefinition, ConnectorOutput } from "../../packages/plateforme/server/connectors/definition"
import type { Fetch } from "../../packages/plateforme/server/connectors/http"
import { memoryTokens } from "../factories/described-connector"
import { connector, getCall, stripCases, stripRefusals, stripRefusedOutputs } from "../factories/strip-cases"

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })

/** Appelle une fonction décrite déclarée comme l'assistant : arguments contrôlés, puis `run`, sur la réponse simulée. */
async function run(name: string, args: Record<string, unknown>, answer: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn<Fetch>(async () => json(answer)),
  )
  const fn = findFunction(catalogFunctions(), name)
  if (!fn) throw new Error(`${name} is not declared`)
  const checked = checkArguments(fn.schema, args)
  if (!checked.success) throw new Error("invalid test arguments")
  const credential = { fields: { api_key: "key_test" }, settings: {}, tokens: memoryTokens() }
  return fn.run({ db: {}, identity: {}, credential, account: { id: "account-1" } } as unknown as FunctionContext, checked.data as never)
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

/** Le connecteur des cas dont `get_call` porte la sortie `output`. */
const withOutput = (output: unknown): ConnectorDefinition => ({
  ...connector,
  functions: connector.functions.map((fn) => (fn.name === getCall.name ? { ...fn, output: output as ConnectorOutput } : fn)),
})

afterEach(() => {
  registerConnectors([])
  vi.unstubAllGlobals()
})

describe("the shared strip cases", () => {
  beforeEach(() => {
    registerConnectors([connector])
  })

  it("should declare the connector of the shared cases", () => {
    expect(stripCases).toHaveLength(18)
    expect(connector.functions.every((fn) => findFunction(catalogFunctions(), fn.name) !== undefined)).toBe(true)
  })

  it.each(stripCases.map((one) => [one.name, one] as const))("%s", async (_name, one) => {
    const input = one.function.examples[0].input
    const answer = structuredClone(one.answer)
    const output = await run(one.function.name, input, answer)
    if (one.function.output?.items !== undefined) {
      const items = one.shaped as unknown[]
      expect(output.data).toEqual({ items, next_cursor: null, pages: 1 })
      expect(output.text.split("\n").slice(1)).toEqual(items.map((item) => `- ${JSON.stringify(item)}`))
    } else {
      const object = typeof one.shaped === "object" && one.shaped !== null && !Array.isArray(one.shaped)
      expect(output.data).toEqual(object ? one.shaped : { value: one.shaped })
      expect(output.text).toBe(`${one.function.name}:\n${JSON.stringify(one.shaped)}`)
    }
  })

  it.todo("should play the strip cases of @otomata_tech/connectors/strip-cases, shared with the Python lib, once the connectors pin brings them")
})

describe("the shared refused strip outputs (registerConnectors)", () => {
  it("should name the three refusals of rule 18", () => {
    expect([...stripRefusals].sort()).toEqual(["strip_path_malformed", "strip_path_overlaps", "strip_path_twice"])
    expect(new Set(stripRefusedOutputs.map((one) => one.refusal))).toEqual(new Set(stripRefusals))
  })

  it.each(stripRefusedOutputs.map((one) => [one.name, one] as const))("%s", (_name, one) => {
    const message = refusedWith(withOutput(one.output))
    expect(message.startsWith(`${getCall.name}: output.strip ${JSON.stringify(one.path)} `)).toBe(true)
    expect(message.endsWith(`(${one.refusal}).`)).toBe(true)
  })

  it("should refuse a strip that is not a list of paths, or lists none", () => {
    expect(refusedWith(withOutput({ strip: "call.recording" }))).toBe(`${getCall.name}: output.strip must be a list of paths.`)
    expect(refusedWith(withOutput({ strip: [] }))).toBe(`${getCall.name}: output.strip must list at least one path (absent, nothing is removed).`)
    expect(refusedWith(withOutput({ strip: ["call", 7] }))).toBe(`${getCall.name}: output.strip 7 is malformed: keys separated by dots, each non-empty (strip_path_malformed).`)
  })
})

describe("a signed address in a wrapped answer", () => {
  const SIGNED = "https://files.example.test/recordings/c-1.mp3?X-Signature=SIGNEDMARK42"

  beforeEach(() => {
    registerConnectors([connector])
  })

  it("should serve neither in the text nor in the data the address that strip names by its path", async () => {
    const answer = { call: { id: "c-1", duration: 42, recording: SIGNED, voicemail: `${SIGNED}&voicemail` } }
    const output = await run(getCall.name, { id: "c-1" }, answer)
    expect(output.text).toBe('strip_cases.get_call:\n{"call":{"id":"c-1","duration":42}}')
    expect(output.data).toEqual({ call: { id: "c-1", duration: 42 } })
    expect(JSON.stringify(output)).not.toContain("SIGNEDMARK42")
  })
})
