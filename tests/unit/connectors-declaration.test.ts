// @vitest-environment node
// Déclaration des connecteurs décrits par l'hôte (story moteur-des-connecteurs-decrits, AC1 à AC4) : sur une définition
// de test écrite dans la forme de la fabrique, les fonctions entrent au catalogue avec l'origine `connecteur`, leur
// JSON Schema servi et validé tel quel ; chaque définition invalide est refusée nommément, et rien n'est déclaré.
import * as z from "zod/v4"
import { afterEach, describe, expect, it } from "vitest"
import { checkArguments } from "../../packages/plateforme/server/catalog/arguments"
import { CatalogRegistrationError, defineErpFunction, registerFunctions } from "../../packages/plateforme/server/catalog/erp"
import { catalogFunctions, describeFunction, findFunction } from "../../packages/plateforme/server/catalog/registry"
import { registerConnectors } from "../../packages/plateforme/server/connectors/declaration"
import type { ConnectorDefinition, ConnectorFunctionDefinition } from "../../packages/plateforme/server/connectors/definition"
import { describedConnector } from "../factories/described-connector"

afterEach(() => {
  registerConnectors([])
  registerFunctions([])
})

const declaredNames = () => catalogFunctions().filter((fn) => fn.connector === "crm").map((fn) => fn.name)

/** Le connecteur de test, une fonction (par son nom court) remplacée par `change`. */
function withFunction(short: string, change: (fn: ConnectorFunctionDefinition) => ConnectorFunctionDefinition): ConnectorDefinition {
  const base = describedConnector()
  return { ...base, functions: base.functions.map((fn) => (fn.name === `crm.${short}` ? change(fn) : fn)) }
}

function refusalOf(definitions: readonly ConnectorDefinition[]): string {
  try {
    registerConnectors(definitions)
  } catch (error) {
    if (error instanceof CatalogRegistrationError) return error.message
    throw error
  }
  throw new Error("expected a CatalogRegistrationError")
}

describe("registerConnectors", () => {
  it("should add the declared functions to the catalog with the origin connecteur, examples without their title (AC1)", () => {
    registerConnectors([describedConnector()])
    expect(declaredNames()).toEqual([
      "crm.get_company",
      "crm.list_contacts",
      "crm.get_contact",
      "crm.rename_contact",
      "crm.untag_contact",
      "crm_act.post_entry",
    ])
    const contact = findFunction(catalogFunctions(), "crm.get_contact")
    expect([contact?.origin, contact?.class, contact?.examples]).toEqual(["connecteur", "read", [{ contact_id: "c-42" }]])
    expect(typeof findFunction(catalogFunctions(), "crm_act.post_entry")?.summarize).toBe("function")
  })

  it("should serve the JSON Schema of the description as is in the contract, and validate arguments against it (AC2)", () => {
    const definition = describedConnector()
    registerConnectors([definition])
    const fn = findFunction(catalogFunctions(), "crm.get_contact")
    if (!fn) throw new Error("crm.get_contact is not declared")
    const { text, data } = describeFunction(fn, "acme")
    expect(data.arguments_schema).toEqual(definition.functions[2].schema)
    expect(text).toContain("- contact_not_found: No contact with this id. (HTTP 404)")
    expect(text).toContain("- access_rejected: Crm refused access: the key is invalid or lacks the scope.")
    expect(checkArguments(fn.schema, { contact_id: "c-42" }).success).toBe(true)
    expect(checkArguments(fn.schema, { contact_id: "C 42", extra: 1 })).toEqual({
      success: false,
      issues: [
        { path: [], message: 'Unrecognized key: "extra"', code: "unrecognized_keys" },
        { path: ["contact_id"], message: 'must match pattern "^[a-z0-9_-]{1,40}$"', code: "pattern" },
      ],
    })
    expect(checkArguments(fn.schema, {})).toEqual({ success: false, issues: [{ path: ["contact_id"], message: "Required", code: "required" }] })
  })

  it("should replace the whole declaration at each call, so that a hot reload doubles nothing (AC1)", () => {
    registerConnectors([describedConnector()])
    registerConnectors([describedConnector()])
    expect(declaredNames()).toHaveLength(6)
    registerConnectors([])
    expect(declaredNames()).toEqual([])
  })

  it.each<[string, () => ConnectorDefinition[], string]>([
    ["an invalid name", () => [{ ...describedConnector(), name: "Crm" }], 'Invalid connector name "Crm": lowercase ASCII letters, digits and _, starting with a letter, 40 characters at most.'],
    ["a namespace of the package", () => [describedConnector("mail")], "Connector mail: the namespace is already served by another source."],
    ["a duplicate", () => [describedConnector(), describedConnector()], "Duplicate connector crm in registerConnectors."],
    ["an http address", () => [{ ...describedConnector(), baseUrl: "http://crm.example.test" }], "crm: baseUrl must start with https:// or with a url setting."],
    [
      "basic authentication on a field the credential does not declare",
      () => [{ ...describedConnector(), auth: { kind: "basic", username: "api_id", password: "api_key" } }],
      "crm: auth basic must name two credential fields (username, password).",
    ],
    [
      "a key in the query with a prefix",
      () => [{ ...describedConnector(), auth: { kind: "api_key", in: "query", name: "key", prefix: "Key ", key: "api_key" } as unknown as ConnectorDefinition["auth"] }],
      "crm: auth api_key: a key in the query takes no prefix.",
    ],
    [
      "a key in the query that an argument would replace",
      () => [{ ...describedConnector(), auth: { kind: "api_key", in: "query", name: "limit", key: "api_key" } }],
      "crm.list_contacts: a constant or argument query parameter would replace the authentication parameter limit.",
    ],
    [
      "an address citing an unknown setting",
      () => [{ ...describedConnector(), baseUrl: "https://{tenant}.crm.example.test" }],
      "crm: baseUrl cites {tenant}, which is not a setting.",
    ],
    [
      "a url setting in the middle of an address",
      () => [{ ...describedConnector(), settings: [{ name: "server", label: "Server", type: "url" }], baseUrl: "https://crm.example.test/{server}" }],
      "crm: baseUrl: url setting {server} must open the address, alone.",
    ],
    [
      "an address per region missing a choice",
      () => [
        {
          ...describedConnector(),
          baseUrl: undefined,
          settings: [{ name: "region", label: "Region", type: "choice", choices: ["us", "eu"] }],
          baseUrls: { setting: "region", values: { us: "https://us.crm.example.test" } },
        },
      ],
      "crm: baseUrl must give one address to each choice of region.",
    ],
    [
      "a text setting whose pattern is not anchored",
      () => [{ ...describedConnector(), settings: [{ name: "domain", label: "Domain", type: "text", pattern: "[a-z]+" }] }],
      'crm: setting "domain": pattern must be anchored (^…$).',
    ],
    [
      "a schema that is not strict",
      () => [withFunction("get_company", (fn) => ({ ...fn, schema: { type: "object", properties: {} } }))],
      "crm.get_company: schema must be a strict object (type object, additionalProperties false): unknown keys are refused, not ignored.",
    ],
    [
      "a schema Ajv cannot compile",
      () => [withFunction("get_company", (fn) => ({ ...fn, schema: { type: "object", additionalProperties: false, properties: { a: { type: "texte" } } } }))],
      "crm.get_company: schema is not a valid JSON Schema 2020-12 (schema is invalid: data/properties/a/type must be equal to one of the allowed values, data/properties/a/type must be array, data/properties/a/type must match a schema in anyOf).",
    ],
    [
      "an example the schema refuses",
      () => [withFunction("get_contact", (fn) => ({ ...fn, examples: [{ title: "Bad", input: { contact_id: 42 } }] }))],
      "crm.get_contact: examples[0] does not match the schema (contact_id: must be string).",
    ],
    [
      "a function outside its namespace",
      () => [withFunction("get_company", (fn) => ({ ...fn, name: "erp.get_company" }))],
      'Invalid function name "erp.get_company" in crm: expected crm.<name> in lowercase ASCII letters, digits and _, 64 characters at most.',
    ],
    [
      "a sensitive function without a summary",
      () => [withFunction("post_entry", (fn) => ({ ...fn, confirm: undefined }))],
      "crm.post_entry: a sensitive function needs confirm.summary (two-step confirmation).",
    ],
    [
      "a header that would replace the authentication",
      () => [{ ...describedConnector(), headers: { Authorization: "Basic x" } }],
      "crm.get_company: a constant or argument header would replace the authentication header authorization.",
    ],
    [
      "a list in the query without queryArrays",
      () => [{ ...describedConnector(), queryArrays: undefined }],
      "crm.list_contacts: list argument tags in the query needs the connector's queryArrays.",
    ],
    [
      "a cursor that goes nowhere",
      () => [withFunction("list_contacts", (fn) => ({ ...fn, pagination: { kind: "cursor", requestParam: "page_token", next: "next_cursor", maxPages: 3 } }))],
      "crm.list_contacts: pagination requestParam page_token is not an argument placed in the query or the body.",
    ],
    [
      "a check of an unknown kind",
      () => [withFunction("post_entry", (fn) => ({ ...fn, checks: [{ kind: "formula", refusal: "entry_unbalanced", items: "lines", fields: ["debit", "credit"] }] }))],
      "crm.post_entry: check formula is not supported, or names no refusal of the function (equal_sums with items and two fields).",
    ],
    [
      "a probe with a required argument",
      () => [{ ...describedConnector(), probe: { function: "crm.get_contact", nonEmpty: ["email"] } }],
      "crm: probe must name a read function of the connector without required arguments, and list nonEmpty paths.",
    ],
  ])("should refuse %s by name, and declare nothing (AC3)", (_case, definitions, message) => {
    registerConnectors([describedConnector("crm_before")])
    expect(refusalOf(definitions())).toBe(message)
    expect(catalogFunctions().filter((fn) => fn.connector === "crm_before")).toHaveLength(6)
  })

  it("should keep the namespaces of the application functions and of the declared connectors apart (AC3)", () => {
    registerFunctions([
      defineErpFunction({ name: "erp.lookup", class: "read", description: "Reads.", schema: z.strictObject({}), examples: [{}], run: async () => ({ text: "ok" }) }),
    ])
    expect(refusalOf([describedConnector("erp")])).toBe("Connector erp: the namespace is already served by another source.")
    registerFunctions([])
    registerConnectors([describedConnector()])
    expect(() =>
      registerFunctions([
        defineErpFunction({ name: "crm.lookup", class: "read", description: "Reads.", schema: z.strictObject({}), examples: [{}], run: async () => ({ text: "ok" }) }),
      ]),
    ).toThrow('Namespace "crm" of crm.lookup is already served by another source.')
  })

  it("should serve a function that engages under <connector>_act, its connector unchanged, and keep that namespace", () => {
    registerConnectors([describedConnector()])
    const engaging = catalogFunctions().filter((fn) => fn.name.startsWith("crm_act."))
    expect(engaging.map((fn) => [fn.name, fn.connector, fn.class])).toEqual([["crm_act.post_entry", "crm", "sensitive"]])
    expect(findFunction(catalogFunctions(), "crm.post_entry")).toBeNull()
    expect(() =>
      registerFunctions([
        defineErpFunction({ name: "crm_act.lookup", class: "read", description: "Reads.", schema: z.strictObject({}), examples: [{}], run: async () => ({ text: "ok" }) }),
      ]),
    ).toThrow('Namespace "crm_act" of crm_act.lookup is already served by another source.')
    registerConnectors([])
    registerFunctions([
      defineErpFunction({ name: "crm_act.lookup", class: "read", description: "Reads.", schema: z.strictObject({}), examples: [{}], run: async () => ({ text: "ok" }) }),
    ])
    expect(refusalOf([describedConnector()])).toBe("Connector crm: the namespace is already served by another source.")
    expect(refusalOf([describedConnector("crm_act")])).toBe("Connector crm_act: a name ending in _act is kept for the functions of a connector that engage.")
  })
})
