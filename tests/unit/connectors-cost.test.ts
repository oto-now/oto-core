// @vitest-environment node
// Coût d'un appel et travail asynchrone d'un connecteur décrit (format de connectors, « Coût d'un appel », « Travail
// asynchrone ») : `registerConnectors` accepte la forme de la fabrique et refuse nommément ce que refusent ses règles 5,
// 12 et 13. Le pire cas, la quantité à régler et la relève se prouvent par les cas communs (`connectors-cost-cases`).
// Rien n'est réservé ni réglé.
import { afterEach, describe, expect, it } from "vitest"
import { CatalogRegistrationError, registerFunctions } from "../../packages/plateforme/server/catalog/erp"
import { catalogFunctions } from "../../packages/plateforme/server/catalog/registry"
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

function refusalOf(definition: ConnectorDefinition): string {
  try {
    registerConnectors([definition])
  } catch (error) {
    if (error instanceof CatalogRegistrationError) return error.message
    throw error
  }
  return "(declared, no refusal)"
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

  const REFUSALS: [string, () => ConnectorDefinition, string][] = [
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
  ]

  it("should refuse each malformed cost or job by name, and declare nothing", () => {
    const verdicts = Object.fromEntries(
      REFUSALS.map(([name, definition]) => {
        registerConnectors([describedConnector("crm_before")])
        const message = refusalOf(definition())
        return [name, { message, kept: catalogFunctions().filter((fn) => fn.connector === "crm_before").length }]
      }),
    )
    expect(verdicts).toEqual(Object.fromEntries(REFUSALS.map(([name, , message]) => [name, { message, kept: 6 }])))
  })
})
