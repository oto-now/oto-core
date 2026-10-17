// @vitest-environment node
// Le compte de l'hôte et le compte rattaché (`connecteurs-et-comptes.md` § Compte de l'hôte et compte rattaché), sans
// base : la déclaration (`holder`, `accountIdentity`, `act`, lecteur et port de l'hôte) et ses refus nommés ;
// l'assemblage à l'appel de la clé de l'hôte et de l'identifiant du compte dans l'adresse ; les champs de l'hôte
// absents ; et les décisions pures du retour du branchement : la date du tiers, les candidats, le choix après sondes.
import { randomBytes } from "crypto"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { FunctionContext } from "../../packages/plateforme/server/catalog/define"
import { CatalogRegistrationError } from "../../packages/plateforme/server/catalog/erp"
import { declaredConnector } from "../../packages/plateforme/server/catalog/connector-source"
import { catalogFunctions, findFunction } from "../../packages/plateforme/server/catalog/registry"
import { registerConnectors, type ConnectorOptions } from "../../packages/plateforme/server/connectors/declaration"
import type { ConnectorDefinition } from "../../packages/plateforme/server/connectors/definition"
import { readHostFields } from "../../packages/plateforme/server/connectors/host-fields"
import { chooseHostedCandidate, hostedCandidates, hostedCreatedAt, hostedRefusal } from "../../packages/plateforme/server/connectors/hosted-link"
import type { Fetch } from "../../packages/plateforme/server/connectors/http"
import { PlatformError } from "../../packages/plateforme/server/errors"
import { consentConnector, describedConnector, fakeHostedLinks, hostedConnector, leveledConsentConnector, memoryTokens } from "../factories/described-connector"

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
const key = () => `hk_${randomBytes(12).toString("hex")}`

afterEach(() => {
  registerConnectors([])
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function refusalOf(definitions: readonly ConnectorDefinition[], options: ConnectorOptions = {}): string {
  try {
    registerConnectors(definitions, options)
  } catch (error) {
    if (error instanceof CatalogRegistrationError) return error.message
    throw error
  }
  throw new Error("expected a CatalogRegistrationError")
}

/** Le connecteur rattaché de test, une fonction (par son nom court) remplacée par `change`. */
function hostedWith(short: string, change: (fn: ConnectorDefinition["functions"][number]) => object): ConnectorDefinition {
  const base = hostedConnector()
  return { ...base, functions: base.functions.map((fn) => (fn.name === `crm.${short}` ? (change(fn) as typeof fn) : fn)) }
}

describe("declaring host fields, account identity and act", () => {
  it("should declare a hosted connector with the host's reader and port, and keep them for the call and the link", () => {
    const reader = () => ({ api_key: key() })
    const { port } = fakeHostedLinks()
    registerConnectors([hostedConnector()], { hostCredentials: { crm: reader }, hostedLinks: { crm: port } })
    const declared = declaredConnector("crm")
    expect([declared?.hostCredentials, declared?.hostedLinks, catalogFunctions().filter((fn) => fn.connector === "crm")]).toEqual([reader, port, expect.any(Array)])
    expect(catalogFunctions().filter((fn) => fn.connector === "crm")).toHaveLength(6)
  })

  it.each<[string, () => ConnectorDefinition[], string]>([
    ["an unknown holder", () => [{ ...describedConnector(), credential: [{ name: "api_key", label: "API key", secret: true, holder: "tenant" as "host" }] }], 'crm: credential field api_key has holder "tenant": account or host.'],
    ["an account identity on a consent connector", () => [{ ...consentConnector(), accountIdentity: { name: "account_id", label: "Account", pattern: "^[a-z]+$" } }], "crm: accountIdentity does not go with oauth2_user: a consent's account is the person's own."],
    // Les niveaux d'accès n'existent que sous `oauth2_user`, que l'identité d'un compte rattaché refuse : refus explicite.
    ["access levels with an account identity", () => [{ ...leveledConsentConnector(), accountIdentity: { name: "account_id", label: "Account", pattern: "^[a-z]+$" } }], "crm: accountIdentity does not go with oauth2_user: a consent's account is the person's own."],
    ["an identity pattern that is not anchored", () => [{ ...hostedConnector(), accountIdentity: { name: "account_id", label: "Account", pattern: "[a-z]+" } }], "crm: accountIdentity: pattern must be anchored (^…$)."],
    ["an identity pattern that does not compile", () => [{ ...hostedConnector(), accountIdentity: { name: "account_id", label: "Account", pattern: "^[a-z$" } }], "crm: accountIdentity: pattern is not a valid regular expression."],
    ["an identity named like a credential field", () => [{ ...hostedConnector(), accountIdentity: { name: "api_key", label: "Account", pattern: "^[a-z]+$" } }], "crm: credential fields, settings and the account identity need distinct names."],
    ["an address that does not cite the identity", () => [{ ...hostedConnector(), baseUrl: "https://crm.example.test/v2" }], "crm: baseUrl must cite the account identity {account_id}, after the host."],
    ["an identity in the host", () => [{ ...hostedConnector(), baseUrl: "https://{account_id}.crm.example.test/v2" }], "crm: baseUrl: the account identity {account_id} may only follow the host."],
    ["an argument carrying the identity", () => [hostedWith("get_contact", (fn) => ({ ...fn, schema: { ...fn.schema, properties: { ...(fn.schema.properties as object), account_id: { type: "string" } } } }))], "crm.get_contact: no argument may carry the account identity account_id: it comes from the account, never from the agent."],
    ["a function without act", () => [hostedWith("get_company", (fn) => ({ ...fn, act: undefined }))], "crm.get_company: act must be true (the function engages or destroys) or false."],
    ["a read function that acts", () => [hostedWith("get_company", (fn) => ({ ...fn, act: true }))], "crm.get_company: a read function never engages: act must be false."],
    ["a sensitive function that does not act", () => [hostedWith("post_entry", (fn) => ({ ...fn, act: false }))], "crm.post_entry: a sensitive function engages: act must be true."],
  ])("should refuse %s by name, and declare nothing", (_case, definitions, message) => {
    registerConnectors([describedConnector("crm_before")])
    expect(refusalOf(definitions())).toBe(message)
    expect(catalogFunctions().filter((fn) => fn.connector === "crm_before")).toHaveLength(6)
  })

  it.each<[string, ConnectorOptions, string]>([
    ["a reader for an undeclared connector", { hostCredentials: { other: () => ({}) } }, "Host credentials for other: no connector of this name with a host field is declared."],
    ["a reader that is not a function", { hostCredentials: { crm: { api_key: "x" } as unknown as () => Record<string, string> } }, "Host credentials for crm must be a function that returns the host fields."],
    ["a port for an undeclared connector", { hostedLinks: { other: fakeHostedLinks().port } }, "Hosted links for other: no connector of this name with an accountIdentity is declared."],
    ["a port without its three methods", { hostedLinks: { crm: { createLink: async () => ({ url: "https://x.test" }) } as never } }, "Hosted links for crm need createLink, listAccounts and probe."],
  ])("should refuse %s at registration", (_case, options, message) => {
    expect(refusalOf([hostedConnector()], options)).toBe(message)
  })

  it("should refuse a reader for a connector without any host field", () => {
    expect(refusalOf([describedConnector()], { hostCredentials: { crm: () => ({ api_key: "x" }) } })).toBe("Host credentials for crm: no connector of this name with a host field is declared.")
  })
})

describe("assembling a call on a hosted account", () => {
  function context(fields: Record<string, string>, linkedId?: string): FunctionContext {
    const credential = { fields, settings: {}, tokens: memoryTokens(), ...(linkedId !== undefined ? { linkedId } : {}) }
    return { credential, account: { id: `account-${randomBytes(4).toString("hex")}` } } as unknown as FunctionContext
  }

  it("should put the host's key in its header and the account's id in the base address, never in an argument", async () => {
    const hostKey = key()
    registerConnectors([hostedConnector()], { hostCredentials: { crm: () => ({ api_key: hostKey }) } })
    const send = vi.fn<Fetch>(async () => json({ items: [], has_more: false }))
    vi.stubGlobal("fetch", send)
    const fn = findFunction(catalogFunctions(), "crm.list_contacts")
    if (!fn) throw new Error("crm.list_contacts is not declared")
    await fn.run(context({ api_key: hostKey }, "acc_42-x"), {} as never)
    const [url, init] = send.mock.calls[0]
    expect([url, new Headers(init.headers).get("x-api-key")]).toEqual(["https://crm.example.test/v2/acc_42-x/contacts?view=full", hostKey])
  })

  it("should refuse, without sending, an account opened without its id", async () => {
    registerConnectors([hostedConnector()])
    vi.spyOn(console, "error").mockImplementation(() => {})
    const send = vi.fn<Fetch>(async () => json({}))
    vi.stubGlobal("fetch", send)
    const fn = findFunction(catalogFunctions(), "crm.get_company")
    if (!fn) throw new Error("crm.get_company is not declared")
    const error = await fn.run(context({ api_key: key() }), {} as never).then(
      () => null,
      (reason: unknown) => reason,
    )
    expect([error instanceof PlatformError && error.code, send.mock.calls]).toEqual(["internal", []])
  })
})

describe("reading the host's fields", () => {
  const declaredWith = (options: ConnectorOptions) => {
    registerConnectors([hostedConnector()], options)
    const declared = declaredConnector("crm")
    if (!declared) throw new Error("crm is not declared")
    return declared
  }
  const message = "Hosted Crm needs the API key of this application, which is not configured. Ask whoever runs this application to configure it."

  it("should give the host's fields read at each call", () => {
    let current = key()
    const declared = declaredWith({ hostCredentials: { crm: () => ({ api_key: current }) } })
    expect(readHostFields(declared)).toEqual({ api_key: current })
    current = key()
    expect(readHostFields(declared)).toEqual({ api_key: current })
  })

  it.each<[string, ConnectorOptions]>([
    ["no reader", {}],
    ["a reader that throws", { hostCredentials: { crm: () => { throw new Error("vault down: hk_leaked") } } }],
    ["a reader without the field", { hostCredentials: { crm: () => ({}) } }],
    ["a reader with an empty field", { hostCredentials: { crm: () => ({ api_key: "  " }) } }],
  ])("should refuse with %s, naming the field and nothing of the reader", (_case, options) => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {})
    const declared = declaredWith(options)
    let thrown: unknown
    try {
      readHostFields(declared)
    } catch (error) {
      thrown = error
    }
    expect(thrown instanceof PlatformError && [thrown.code, thrown.message]).toEqual(["not_enabled", message])
    expect(JSON.stringify(logged.mock.calls)).not.toContain("hk_leaked")
  })
})

describe("the dates of the third party", () => {
  it.each<[string | null, string | null]>([
    ["2026-10-17T09:30:00Z", "2026-10-17T09:30:00.000Z"],
    ["2026-10-17T09:30:00.123456789Z", "2026-10-17T09:30:00.123Z"],
    ["2026-10-17T11:30:00+02:00", "2026-10-17T09:30:00.000Z"],
    ["2026-10-17T09:30Z", "2026-10-17T09:30:00.000Z"],
    [null, null],
    ["1697000000000", null],
    ["2026-10-17 09:30:00", null],
    ["2026-10-17T09:30:00", null],
    ["2026-13-45T09:30:00Z", null],
    ["yesterday", null],
  ])("should read %s as %s", (given, read) => {
    expect(hostedCreatedAt(given)?.toISOString() ?? null).toBe(read)
  })
})

describe("choosing the candidate of a return", () => {
  const requestAt = new Date("2026-10-17T10:00:00Z")
  const at = (minutes: number) => new Date(requestAt.getTime() + minutes * 60_000)
  const none = { mine: new Set<string>(), elsewhere: new Set<string>() }

  it("should keep accounts created at most 5 minutes before the request, and the person's own whatever their date", () => {
    const listed = [
      { id: "fresh", createdAt: at(1) },
      { id: "edge", createdAt: at(-5) },
      { id: "old", createdAt: at(-10) },
      { id: "undated", createdAt: null },
      { id: "mine", createdAt: at(-60 * 24 * 365) },
    ]
    expect(hostedCandidates(listed, { mine: new Set(["mine"]), elsewhere: new Set() }, { createdAt: requestAt })).toEqual({
      candidates: [listed[0], listed[1], listed[4]],
    })
  })

  it("should drop another person's ids, refuse one named by the hint, and refuse when nothing is left", () => {
    const listed = [{ id: "theirs", createdAt: at(1) }]
    const ownership = { mine: new Set<string>(), elsewhere: new Set(["theirs"]) }
    expect(hostedCandidates(listed, ownership, { createdAt: requestAt })).toEqual({ refusal: "no_candidate" })
    expect(hostedCandidates(listed, ownership, { createdAt: requestAt, hint: "theirs" })).toEqual({ refusal: "forbidden" })
    expect(hostedCandidates(listed, none, { createdAt: requestAt, hint: "absent" })).toEqual({ refusal: "no_candidate" })
    expect(hostedCandidates([{ id: "old", createdAt: at(-10) }], none, { createdAt: requestAt, hint: "old" })).toEqual({ refusal: "no_candidate" })
  })

  it("should restrict the candidates to the hint", () => {
    const listed = [
      { id: "one", createdAt: at(1) },
      { id: "two", createdAt: at(2) },
    ]
    expect(hostedCandidates(listed, none, { createdAt: requestAt, hint: "two" })).toEqual({ candidates: [listed[1]] })
  })

  it("should link the only live candidate, and refuse two live ones, all dead ones, or any it could not read", () => {
    const one = { id: "one", createdAt: at(1) }
    const two = { id: "two", createdAt: at(2) }
    const alive = (who: string) => ({ state: "alive" as const, label: who })
    expect(chooseHostedCandidate([{ account: one, probe: alive("ada") }, { account: two, probe: { state: "dead" } }])).toEqual({ account: one, label: "ada" })
    expect(chooseHostedCandidate([{ account: one, probe: alive("ada") }, { account: two, probe: alive("lea") }])).toEqual({ refusal: "ambiguous_candidates" })
    expect(chooseHostedCandidate([{ account: one, probe: { state: "dead" } }, { account: two, probe: { state: "dead" } }])).toEqual({ refusal: "candidates_dead" })
    expect(chooseHostedCandidate([{ account: one, probe: alive("ada") }, { account: two, probe: { state: "unavailable" } }])).toEqual({ unavailable: true })
  })

  it("should name each refusal with a closed code, the reason in details, and nothing about the accounts", () => {
    const named = (["not_found", "expired", "invalid_arguments", "no_candidate", "candidates_dead", "ambiguous_candidates", "forbidden"] as const).map((reason) => {
      const error = hostedRefusal(reason, "Hosted Crm")
      return [reason, error.code, error.details?.refusal ?? null]
    })
    expect(named).toEqual([
      ["not_found", "not_found", null],
      ["expired", "invalid_arguments", "expired"],
      ["invalid_arguments", "invalid_arguments", null],
      ["no_candidate", "not_found", "no_candidate"],
      ["candidates_dead", "not_enabled", "candidates_dead"],
      ["ambiguous_candidates", "conflict", "ambiguous_candidates"],
      ["forbidden", "forbidden", null],
    ])
  })
})
