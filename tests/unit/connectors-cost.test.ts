// @vitest-environment node
// Coût d'un appel et travail asynchrone d'un connecteur décrit (format de connectors, « Coût d'un appel », « Travail
// asynchrone ») : `registerConnectors` accepte la forme de la fabrique et refuse nommément ce que refusent ses règles 5,
// 12 et 13 ; les fonctions pures en tirent le pire cas, la quantité à régler et la relève. Rien n'est réservé ni réglé.
import { afterEach, describe, expect, it } from "vitest"
import { CatalogRegistrationError, registerFunctions } from "../../packages/plateforme/server/catalog/erp"
import { catalogFunctions } from "../../packages/plateforme/server/catalog/registry"
import { collectionOf, ConnectorCostError, costOf, settledQuantity } from "../../packages/plateforme/server/connectors/cost"
import { registerConnectors } from "../../packages/plateforme/server/connectors/declaration"
import type { ConnectorDefinition, ConnectorFunctionDefinition } from "../../packages/plateforme/server/connectors/definition"
import { billedConnector, describedConnector } from "../factories/described-connector"

afterEach(() => {
  registerConnectors([])
  registerFunctions([])
})

type Change = (fn: ConnectorFunctionDefinition) => ConnectorFunctionDefinition

/** Le connecteur au lot payant, des fonctions (par leur nom court) remplacées. */
function billed(changes: Record<string, Change>, base: ConnectorDefinition = billedConnector()): ConnectorDefinition {
  return { ...base, functions: base.functions.map((fn) => changes[fn.name.slice("crm.".length)]?.(fn) ?? fn) }
}

const fnOf = (definition: ConnectorDefinition, short: string): ConnectorFunctionDefinition => {
  const found = definition.functions.find((fn) => fn.name === `crm.${short}`)
  if (!found) throw new Error(`no function ${short}`)
  return found
}

function refusalOf(definition: ConnectorDefinition): string {
  try {
    registerConnectors([definition])
  } catch (error) {
    if (error instanceof CatalogRegistrationError) return error.message
    throw error
  }
  throw new Error("expected a CatalogRegistrationError")
}

const loose = (value: object) => value as unknown as ConnectorFunctionDefinition["cost"]
const looseJob = (value: object) => value as unknown as ConnectorFunctionDefinition["async"]
const withSchema = (fn: ConnectorFunctionDefinition, change: (schema: Record<string, unknown>) => Record<string, unknown>): ConnectorFunctionDefinition => ({ ...fn, schema: change({ ...fn.schema }) })
const SETTLED = { per: "request", unit: "credits", settle: { path: "used" } } as const

/** Une valeur, un poids : le lot payant devenu une liste d'objets, chacun listant ses champs, réglé en crédits, sans échéance. */
const FIELD = { type: "array", minItems: 1, uniqueItems: true, items: { enum: ["email", "phone"] } }
const weighed: Change = (fn) => ({
  ...fn,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["contacts"],
    properties: { contacts: { type: "array", minItems: 1, items: { type: "object", additionalProperties: false, required: ["name", "fields"], properties: { name: { type: "string" }, fields: FIELD } } } },
  },
  examples: [{ title: "One contact, email and phone", input: { contacts: [{ name: "Ada", fields: ["email", "phone"] }] } }],
  request: { ...fn.request, body: { contacts: "contacts" } },
  cost: { per: "item", items: "contacts", weights: { field: "fields", values: { email: 1, phone: 10 } }, unit: "credits", settle: { path: "cost.credits" } },
  async: { collect: fn.async!.collect, jobId: fn.async!.jobId, noDeadline: true },
})
const reweigh = (change: (fn: ConnectorFunctionDefinition) => ConnectorFunctionDefinition): Change => (fn) => change(weighed(fn))
const withField = (fn: ConnectorFunctionDefinition, field: object): ConnectorFunctionDefinition =>
  withSchema(fn, (schema) => {
    const contacts = (schema.properties as { contacts: { items: { properties: object } } }).contacts
    return { ...schema, properties: { contacts: { ...contacts, items: { ...contacts.items, properties: { ...contacts.items.properties, fields: field } } } } }
  })

describe("registerConnectors: cost and asynchronous job", () => {
  it("should accept a cost per item settled on collection, and the plain request and page costs as before", () => {
    registerConnectors([billedConnector()])
    expect(catalogFunctions().filter((fn) => fn.connector === "crm")).toHaveLength(8)
    registerConnectors([
      billed({
        get_company: (fn) => ({ ...fn, cost: { per: "request" } }),
        list_contacts: (fn) => ({ ...fn, cost: { per: "page", unit: "calls" } }),
        get_contact: (fn) => ({ ...fn, cost: SETTLED }),
        submit_enrichment: (fn) => ({ ...fn, cost: { per: "item", items: "contacts", unit: "contacts" }, async: { ...fn.async!, withinMs: undefined } }),
      }),
    ])
    expect(catalogFunctions().filter((fn) => fn.connector === "crm")).toHaveLength(8)
  })

  it("should accept a weighted cost settled on collection without deadline", () => {
    registerConnectors([billed({ submit_enrichment: weighed })])
    expect(catalogFunctions().filter((fn) => fn.connector === "crm")).toHaveLength(8)
  })

  it.each<[string, () => ConnectorDefinition, string]>([
    ["an unknown per", () => billed({ get_contact: (fn) => ({ ...fn, cost: loose({ per: "call" }) }) }), "crm.get_contact: cost must be {per: request, page or item, items?, times? or weights?, unit?, settle?}."],
    ["an unknown cost key", () => billed({ get_contact: (fn) => ({ ...fn, cost: loose({ per: "request", amount: 2 }) }) }), "crm.get_contact: cost must be {per: request, page or item, items?, times? or weights?, unit?, settle?}."],
    ["items on a request cost", () => billed({ get_contact: (fn) => ({ ...fn, cost: loose({ per: "request", items: "contact_id" }) }) }), "crm.get_contact: cost.items, cost.times and cost.weights go with per item only."],
    ["an item cost without unit", () => billed({ submit_enrichment: (fn) => ({ ...fn, cost: loose({ per: "item", items: "contacts" }) }) }), "crm.submit_enrichment: cost.unit must be non-empty, and is required per item or with settle."],
    ["a settled cost without unit", () => billed({ get_contact: (fn) => ({ ...fn, cost: loose({ per: "request", settle: { path: "used" } }) }) }), "crm.get_contact: cost.unit must be non-empty, and is required per item or with settle."],
    ["an empty unit", () => billed({ get_contact: (fn) => ({ ...fn, cost: { per: "request", unit: "" } }) }), "crm.get_contact: cost.unit must be non-empty, and is required per item or with settle."],
    ["a settle path with an empty segment", () => billed({ get_contact: (fn) => ({ ...fn, cost: { ...SETTLED, settle: { path: "a..b" } } }) }), "crm.get_contact: cost.settle must be {path}, a dotted path."],
    ["a settle with an unknown key", () => billed({ get_contact: (fn) => ({ ...fn, cost: loose({ ...SETTLED, settle: { path: "used", max: 3 } }) }) }), "crm.get_contact: cost.settle must be {path}, a dotted path."],
    ["items that are not an argument", () => billed({ submit_enrichment: (fn) => ({ ...fn, cost: { per: "item", items: "nope", unit: "u" } }) }), 'crm.submit_enrichment: cost.items "nope" must be a required list argument (type array, minItems 1 or more), so that the worst case is never zero nor guessed.'],
    ["items that are not required", () => billed({ submit_enrichment: (fn) => withSchema(fn, (schema) => ({ ...schema, required: ["fields"] })) }), 'crm.submit_enrichment: cost.items "contacts" must be a required list argument (type array, minItems 1 or more), so that the worst case is never zero nor guessed.'],
    [
      "times that may be empty",
      () => billed({ submit_enrichment: (fn) => withSchema(fn, (schema) => ({ ...schema, properties: { ...(schema.properties as object), fields: { type: "array", items: { type: "string" } } } })) }),
      'crm.submit_enrichment: cost.times "fields" must be a required list argument (type array, minItems 1 or more), so that the worst case is never zero nor guessed.',
    ],
    ["times that are the items", () => billed({ submit_enrichment: (fn) => ({ ...fn, cost: { per: "item", items: "contacts", times: "contacts", unit: "u" } }) }), "crm.submit_enrichment: cost.times names the items argument contacts again."],
    ["a settled paginated function", () => billed({ list_contacts: (fn) => ({ ...fn, cost: { per: "page", unit: "u", settle: { path: "used" } } }) }), "crm.list_contacts: a paginated function costs per request or per page, without settle: each page is a request, and one response does not tell the quantity of the call."],
    ["a balance probe whose function costs per page", () => ({ ...billed({ get_company: (fn) => ({ ...fn, cost: { per: "page" } }) }), probe: { function: "crm.get_company", nonEmpty: [], balance: { path: "credits", min: 1, unit: "credits" } } }), "crm: probe crm.get_company reads a balance, so it must declare no cost: one never pays to learn whether one can pay."],
    ["a job without its id", () => billed({ submit_enrichment: (fn) => ({ ...fn, async: looseJob({ collect: "crm.get_enrichment" }) }) }), "crm.submit_enrichment: async must be {collect, jobId: {from: a dotted path, to}, withinMs? or noDeadline: true?}."],
    ["a job id read at a malformed path", () => billed({ submit_enrichment: (fn) => ({ ...fn, async: { ...fn.async!, jobId: { from: "job id", to: "enrichment_id" } } }) }), "crm.submit_enrichment: async must be {collect, jobId: {from: a dotted path, to}, withinMs? or noDeadline: true?}."],
    ["a job collected by an unknown function", () => billed({ submit_enrichment: (fn) => ({ ...fn, async: { ...fn.async!, collect: "crm.nope" } }) }), "crm.submit_enrichment: async.collect crm.nope is not another function of the connector."],
    ["a job collected by itself", () => billed({ submit_enrichment: (fn) => ({ ...fn, async: { ...fn.async!, collect: "crm.submit_enrichment" } }) }), "crm.submit_enrichment: async.collect crm.submit_enrichment is not another function of the connector."],
    ["a job collected by a write", () => billed({ submit_enrichment: (fn) => ({ ...fn, async: { ...fn.async!, collect: "crm.rename_contact" } }) }), "crm.submit_enrichment: async.collect crm.rename_contact must be a read function, not asynchronous itself."],
    ["a job collected with another argument", () => billed({ submit_enrichment: (fn) => ({ ...fn, async: { ...fn.async!, jobId: { from: "job.id", to: "other" } } }) }), "crm.submit_enrichment: async.jobId.to other must be the only required argument of crm.get_enrichment."],
    ["a collection delay within the submission's timeout", () => billed({ submit_enrichment: (fn) => ({ ...fn, async: { ...fn.async!, withinMs: 5_000 } }) }), "crm.submit_enrichment: async.withinMs must be an integer from 1000 to 86400000, beyond the timeout of the submission (5000)."],
    ["a collection delay above a day", () => billed({ submit_enrichment: (fn) => ({ ...fn, async: { ...fn.async!, withinMs: 86_400_001 } }) }), "crm.submit_enrichment: async.withinMs must be an integer from 1000 to 86400000, beyond the timeout of the submission (5000)."],
    ["a settled job without collection delay", () => billed({ submit_enrichment: (fn) => ({ ...fn, async: { ...fn.async!, withinMs: undefined } }) }), "crm.submit_enrichment: async.withinMs, or async.noDeadline when the vendor sets no deadline, is required when the cost is settled: its quantity is read when collected."],
    ["weights on a request cost", () => billed({ get_contact: (fn) => ({ ...fn, cost: loose({ per: "request", weights: { field: "fields", values: { email: 1, phone: 10 } } }) }) }), "crm.get_contact: cost.items, cost.times and cost.weights go with per item only."],
    ["weights with times", () => billed({ submit_enrichment: reweigh((fn) => ({ ...fn, cost: loose({ per: "item", items: "contacts", times: "contacts", weights: { field: "fields", values: { email: 1, phone: 10 } }, unit: "credits" }) })) }), "crm.submit_enrichment: cost.weights replaces cost.times: declare one of them."],
    ["a weight of zero", () => billed({ submit_enrichment: reweigh((fn) => ({ ...fn, cost: loose({ per: "item", items: "contacts", weights: { field: "fields", values: { email: 0, phone: 10 } }, unit: "credits" }) })) }), "crm.submit_enrichment: cost.weights must be {field, values: {value: an integer weight of 1 or more}}, with at least one value."],
    ["a negative weight", () => billed({ submit_enrichment: reweigh((fn) => ({ ...fn, cost: loose({ per: "item", items: "contacts", weights: { field: "fields", values: { email: -1, phone: 10 } }, unit: "credits" }) })) }), "crm.submit_enrichment: cost.weights must be {field, values: {value: an integer weight of 1 or more}}, with at least one value."],
    ["a weight that is not an integer", () => billed({ submit_enrichment: reweigh((fn) => ({ ...fn, cost: loose({ per: "item", items: "contacts", weights: { field: "fields", values: { email: 1.5, phone: 10 } }, unit: "credits" }) })) }), "crm.submit_enrichment: cost.weights must be {field, values: {value: an integer weight of 1 or more}}, with at least one value."],
    ["an empty weight table", () => billed({ submit_enrichment: reweigh((fn) => ({ ...fn, cost: loose({ per: "item", items: "contacts", weights: { field: "fields", values: {} }, unit: "credits" }) })) }), "crm.submit_enrichment: cost.weights must be {field, values: {value: an integer weight of 1 or more}}, with at least one value."],
    ["weights with an unknown key", () => billed({ submit_enrichment: reweigh((fn) => ({ ...fn, cost: loose({ per: "item", items: "contacts", weights: { field: "fields", values: { email: 1, phone: 10 }, default: 1 }, unit: "credits" }) })) }), "crm.submit_enrichment: cost.weights must be {field, values: {value: an integer weight of 1 or more}}, with at least one value."],
    ["a weighted cost without unit", () => billed({ submit_enrichment: reweigh((fn) => ({ ...fn, cost: loose({ per: "item", items: "contacts", weights: { field: "fields", values: { email: 1, phone: 10 } } }) })) }), "crm.submit_enrichment: cost.unit must be non-empty, and is required per item or with settle."],
    ["a weighted field that may be empty", () => billed({ submit_enrichment: reweigh((fn) => withField(fn, { ...FIELD, minItems: 0 })) }), 'crm.submit_enrichment: cost.weights.field "fields" must be a required list of each element of contacts (type array, minItems 1 or more, uniqueItems true), so that each element counts at least one weight, each value once.'],
    ["a weighted field with duplicates", () => billed({ submit_enrichment: reweigh((fn) => withField(fn, { type: "array", minItems: 1, items: FIELD.items })) }), 'crm.submit_enrichment: cost.weights.field "fields" must be a required list of each element of contacts (type array, minItems 1 or more, uniqueItems true), so that each element counts at least one weight, each value once.'],
    ["an allowed value without a weight", () => billed({ submit_enrichment: reweigh((fn) => withField(fn, { ...FIELD, items: { enum: ["email", "phone", "address"] } })) }), "crm.submit_enrichment: cost.weights.field fields: its allowed values (items.enum) must be exactly the weighted values (email, phone), so that a value without a weight is refused before the call."],
    ["a weighted field without allowed values", () => billed({ submit_enrichment: reweigh((fn) => withField(fn, { ...FIELD, items: { type: "string" } })) }), "crm.submit_enrichment: cost.weights.field fields: its allowed values (items.enum) must be exactly the weighted values (email, phone), so that a value without a weight is refused before the call."],
    ["a no-deadline job with a delay", () => billed({ submit_enrichment: reweigh((fn) => ({ ...fn, async: { ...fn.async!, withinMs: 600_000 } })) }), "crm.submit_enrichment: async.noDeadline is true or absent, and excludes async.withinMs: the vendor sets no deadline, or one is declared."],
    ["a no-deadline job set to false", () => billed({ submit_enrichment: reweigh((fn) => ({ ...fn, async: looseJob({ ...fn.async!, noDeadline: false }) })) }), "crm.submit_enrichment: async.noDeadline is true or absent, and excludes async.withinMs: the vendor sets no deadline, or one is declared."],
    ["a settled job whose collection settles too", () => billed({ get_enrichment: (fn) => ({ ...fn, cost: SETTLED }) }), "crm.submit_enrichment: its quantity is read in the responses of crm.get_enrichment, which must be neither paginated nor settled on its own."],
  ])("should refuse %s by name, and declare nothing", (_case, definition, message) => {
    registerConnectors([describedConnector("crm_before")])
    expect(refusalOf(definition())).toBe(message)
    expect(catalogFunctions().filter((fn) => fn.connector === "crm_before")).toHaveLength(6)
  })
})

describe("costOf, settledQuantity, collectionOf: a weighted cost", () => {
  const submit = weighed(fnOf(billedConnector(), "submit_enrichment"))
  const contacts = (...fields: string[][]) => ({ contacts: fields.map((asked, index) => ({ name: `c-${index}`, fields: asked })) })

  it("should sum, over the items, the weights of the values each lists", () => {
    expect(costOf(submit, contacts(["email", "phone"], ["email"]))).toEqual({ quantity: 12, unit: "credits" })
  })

  it("should refuse a value without a weight, and an item without values, instead of counting them for nothing", () => {
    expect(() => costOf(submit, contacts(["email", "address"]))).toThrow('crm.submit_enrichment: fields value "address" has no weight')
    expect(() => costOf(submit, contacts([]))).toThrow(ConnectorCostError)
    expect(() => costOf(submit, { contacts: [{ name: "c-0" }] })).toThrow("crm.submit_enrichment: each element of contacts lists its fields")
    expect(() => costOf(submit, { contacts: [] })).toThrow(ConnectorCostError)
  })

  it("should settle the credits read in the collection, and report a quantity above the worst case", () => {
    const args = contacts(["email", "phone"])
    expect(settledQuantity(submit, args, [{ status: "IN_PROGRESS" }, { cost: { credits: 10 } }])).toEqual({ quantity: 10, unit: "credits", from: "response", exceeded: false })
    expect(settledQuantity(submit, args, [{ cost: { credits: 14 } }])).toEqual({ quantity: 14, unit: "credits", from: "response", exceeded: true })
    expect(settledQuantity(submit, args, [{ status: "IN_PROGRESS" }])).toEqual({ quantity: 11, unit: "credits", from: "unreadable", exceeded: false })
  })

  it("should give the collection of a job without deadline", () => {
    expect(collectionOf(submit, { job: { id: "e-9" } })).toEqual({ function: "crm.get_enrichment", args: { enrichment_id: "e-9" }, withinMs: null, noDeadline: true })
  })
})

describe("costOf, settledQuantity, collectionOf", () => {
  const definition = billedConnector()
  const submit = fnOf(definition, "submit_enrichment")
  const args = { contacts: ["c-1", "c-2", "c-3"], fields: ["email", "phone"] }

  it("should give the worst case per item, contacts times fields, in the declared unit", () => {
    expect(costOf(submit, args)).toEqual({ quantity: 6, unit: "fields" })
    const once = { ...submit, cost: { per: "item", items: "contacts", unit: "contacts" } } as const
    expect(costOf(once, args)).toEqual({ quantity: 3, unit: "contacts" })
  })

  it("should count the requests a call may send, every page with all_pages up to the declared bound", () => {
    const list = { ...fnOf(definition, "list_contacts"), cost: { per: "page" } } as const
    expect(costOf(list, {})).toEqual({ quantity: 1, unit: "pages" })
    expect(costOf(list, { all_pages: true })).toEqual({ quantity: 3, unit: "pages" })
    expect(costOf(list, { all_pages: true, max_pages: 2 })).toEqual({ quantity: 2, unit: "pages" })
    expect(costOf({ ...list, cost: { per: "request" } }, { all_pages: true, max_pages: 9 })).toEqual({ quantity: 3, unit: "requests" })
    expect(costOf(fnOf(definition, "get_contact"), {})).toBeNull()
  })

  it("should refuse to guess the worst case of a counted list absent or empty", () => {
    expect(() => costOf(submit, { contacts: [], fields: ["email"] })).toThrow(ConnectorCostError)
    expect(() => costOf(submit, { contacts: ["c-1"] })).toThrow("crm.submit_enrichment: cost argument fields is not a non-empty list")
  })

  it("should settle the first readable quantity of the responses, else the worst case as unreadable", () => {
    expect(settledQuantity(submit, args, [{ state: "running" }, { summary: { found: 4 } }])).toEqual({ quantity: 4, unit: "fields", from: "response", exceeded: false })
    expect(settledQuantity(submit, args, [{ summary: { found: 0 } }])).toEqual({ quantity: 0, unit: "fields", from: "response", exceeded: false })
    for (const found of ["4", -1, null, Number.POSITIVE_INFINITY]) {
      expect(settledQuantity(submit, args, [{ summary: { found } }])).toEqual({ quantity: 6, unit: "fields", from: "unreadable", exceeded: false })
    }
    expect(settledQuantity(submit, args, [])).toEqual({ quantity: 6, unit: "fields", from: "unreadable", exceeded: false })
  })

  it("should settle the requests sent without settle, and the worst case per item", () => {
    const list = { ...fnOf(definition, "list_contacts"), cost: { per: "request" } } as const
    expect(settledQuantity(list, { all_pages: true }, [{}, {}])).toEqual({ quantity: 2, unit: "requests", from: "requests", exceeded: false })
    expect(() => settledQuantity(list, {}, [])).toThrow(ConnectorCostError)
    const unsettled = { ...submit, cost: { per: "item", items: "contacts", unit: "contacts" } } as const
    expect(settledQuantity(unsettled, args, [{ summary: { found: 1 } }])).toEqual({ quantity: 3, unit: "contacts", from: "worst_case", exceeded: false })
    expect(settledQuantity(fnOf(definition, "get_contact"), {}, [{}])).toBeNull()
  })

  it("should give the collection of a submitted job, its id read in the submission's response", () => {
    expect(collectionOf(submit, { job: { id: "e-9" } })).toEqual({ function: "crm.get_enrichment", args: { enrichment_id: "e-9" }, withinMs: 600_000, noDeadline: false })
    expect(collectionOf({ ...submit, async: { ...submit.async!, withinMs: undefined } }, { job: { id: 12 } })).toEqual({ function: "crm.get_enrichment", args: { enrichment_id: 12 }, withinMs: null, noDeadline: false })
    expect(() => collectionOf(submit, { job: {} })).toThrow("crm.submit_enrichment: the submission answered without its job id at job.id.")
    expect(() => collectionOf(submit, { job: { id: "" } })).toThrow(ConnectorCostError)
    expect(collectionOf(fnOf(definition, "get_contact"), {})).toBeNull()
  })
})
