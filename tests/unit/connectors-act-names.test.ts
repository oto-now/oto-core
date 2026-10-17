// @vitest-environment node
// Les noms servis d'un connecteur décrit (`outils-mcp.md` § Lire et engager) : une fonction qui engage ou détruit
// (`act`) est servie sous `<connecteur>_act.<fonction>` par `find`, et `call` ne la connaît que sous ce nom ; sous le
// nom simple, le refus donne le nom servi. Sans base : `find` d'une fonction et le refus d'une fonction inconnue ne la
// lisent pas. La lecture (`read`) et la ligne de journal passent sur une vraie base (`comptes-rattaches.test.ts`).
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { runCall } from "../../packages/plateforme/server/calls"
import { catalogFunctions } from "../../packages/plateforme/server/catalog/registry"
import { registerConnectors } from "../../packages/plateforme/server/connectors/declaration"
import type { PlatformDb } from "../../packages/plateforme/server/db"
import { PlatformError } from "../../packages/plateforme/server/errors"
import { find } from "../../packages/plateforme/server/find"
import type { Identity } from "../../packages/plateforme/server/identity"
import { describedConnector } from "../factories/described-connector"

// Ni `find` d'une fonction ni le refus d'une fonction inconnue ne lisent la base ni l'identité au-delà du préfixe.
const db = null as unknown as PlatformDb
const identity = { org: { id: "org-1", prefix: "acme", name: "Acme" } } as unknown as Identity

beforeEach(() => {
  registerConnectors([describedConnector()])
})

afterEach(() => {
  registerConnectors([])
})

describe("names served for the functions of a described connector", () => {
  it("should find a function that engages under its _act name, and the others under the connector's", async () => {
    const found = await find(db, identity, { query: "entry", type: "function" }, { functions: catalogFunctions(), activeConnectors: new Set(["crm"]) })
    expect(found.data?.functions).toContainEqual(expect.objectContaining({ name: "crm_act.post_entry", connector: "crm", class: "sensitive" }))
    const contacts = await find(db, identity, { query: "contact", type: "function" }, { functions: catalogFunctions(), activeConnectors: new Set(["crm"]) })
    const names = [...(found.data?.functions as { name: string }[]), ...(contacts.data?.functions as { name: string }[])].map((fn) => fn.name)
    expect(names.filter((name) => name.includes("contact")).every((name) => name.startsWith("crm."))).toBe(true)
    expect(names).not.toContain("crm.post_entry")
  })

  it("should refuse the plain name of a function that engages, giving its _act name, and run nothing", async () => {
    const deps = { db, identity, ctxCode: null, origin: "https://acme.test", activeConnectors: async () => new Set(["crm"]) }
    const plain = await runCall(deps, { function: "crm.post_entry", arguments: { label: "Fees", lines: [] } }).then(
      () => null,
      (error: unknown) => error,
    )
    expect(plain instanceof PlatformError && [plain.code, plain.message]).toEqual([
      "not_found",
      "Unknown function crm.post_entry: it engages or destroys, so it is served as crm_act.post_entry. Call crm_act.post_entry.",
    ])
    const unknown = await runCall(deps, { function: "crm.unknown_thing" }).then(
      () => null,
      (error: unknown) => error,
    )
    expect(unknown instanceof PlatformError && unknown.message).toBe("Unknown function crm.unknown_thing. Use acme_find with type function.")
  })
})
