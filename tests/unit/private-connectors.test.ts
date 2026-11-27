// @vitest-environment node
// La validation d'un connecteur privé à l'écriture (`connecteurs-prives.md` § Validation), sans base : les trois
// contrôles (profil Custom API, déclaration d'oto-core, contrôles d'oto), dont tous les problèmes se rendent d'un coup ;
// et le jugement d'une adresse par sa résolution (`resolutionFault`), sous une résolution remplacée.
import type { LookupAddress } from "node:dns"
import { afterEach, describe, expect, it, vi } from "vitest"
import { resolutionFault } from "../../packages/plateforme/server/connectors/address-guard"
import { privateConnectorProblems } from "../../packages/plateforme/server/private-connectors/validation"
import { ERP, erpDefinition } from "../helpers/private-connectors"

/** La résolution des adresses jugées : publique par défaut ; un test en change le défaut. */
const dns = vi.hoisted(() => ({ fault: new Map<string, "internal" | "unresolved">() }))

vi.mock("../../packages/plateforme/server/connectors/address-guard", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../packages/plateforme/server/connectors/address-guard")>()
  return { ...original, resolutionFault: async (url: string) => dns.fault.get(new URL(url).hostname) ?? null }
})

const codesOf = async (document: unknown, reserved: Iterable<string> = []) =>
  (await privateConnectorProblems(document, new Set(reserved))).map((problem) => `${problem.code} ${problem.path}`)

afterEach(() => {
  dns.fault.clear()
})

describe("privateConnectorProblems", () => {
  it("should accept the ERP: a key in a header, a read and a sensitive write", async () => {
    expect(await codesOf(erpDefinition())).toEqual([])
  })

  it("should name every problem at once: the profile's, then oto's, the declaration not judged on a refused profile", async () => {
    const definition = erpDefinition()
    definition.connector.base_url = "http://erp.exemple.test/api"
    definition.connector.namespace = "custom_autre"
    Object.assign(definition.connector.auth, { kind: "oauth2_user" })
    dns.fault.set("erp.exemple.test", "internal")
    expect(await codesOf(definition)).toEqual([
      "custom_api_base_url_not_https connector.base_url",
      expect.stringMatching(/^custom_api_schema_invalid /),
      "private_connector_namespace_mismatch connector.namespace",
      "private_connector_auth_not_supported connector.auth.kind",
    ])
  })

  it("should refuse a namespace the instance already serves, alone or with _act", async () => {
    expect(await codesOf(erpDefinition(), [ERP])).toEqual(["private_connector_namespace_taken connector.name"])
    expect(await codesOf(erpDefinition(), [`${ERP}_act`])).toEqual(["private_connector_namespace_taken connector.name"])
  })

  it("should refuse an address that resolves to an internal host, or does not resolve", async () => {
    dns.fault.set("erp.exemple.test", "internal")
    expect(await codesOf(erpDefinition())).toEqual(["private_connector_address_internal connector.base_url"])
    dns.fault.set("erp.exemple.test", "unresolved")
    expect(await codesOf(erpDefinition())).toEqual(["private_connector_address_unresolved connector.base_url"])
  })

  it("should refuse what oto-core would not declare, which the profile accepts", async () => {
    const definition = erpDefinition()
    definition.connector.label = "x".repeat(81)
    expect(await privateConnectorProblems(definition, new Set())).toEqual([
      { code: "private_connector_declaration", path: "", message: `${ERP}: label must be 1 to 80 characters.` },
    ])
  })

  it("should bound a definition to 100 functions", async () => {
    const definition = erpDefinition()
    const [read] = definition.functions
    definition.functions = Array.from({ length: 101 }, (_, i) => ({ ...read, name: `search_${i}` }))
    expect(await codesOf(definition)).toContain("custom_api_too_large functions")
  })
})

describe("resolutionFault", () => {
  type Done = (error: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void
  const resolving = (addresses: string[] | Error) => ((_host: string, _options: unknown, done: Done) =>
    addresses instanceof Error ? done(addresses as NodeJS.ErrnoException, []) : done(null, addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })))) as never

  it("should judge every address resolved, and an address written as an IP", async () => {
    const { resolutionFault: real } = await vi.importActual<typeof import("../../packages/plateforme/server/connectors/address-guard")>(
      "../../packages/plateforme/server/connectors/address-guard",
    )
    expect(await real("https://erp.exemple.test/api", resolving(["93.184.216.34"]))).toBeNull()
    expect(await real("https://erp.exemple.test/api", resolving(["93.184.216.34", "10.0.0.7"]))).toBe("internal")
    expect(await real("https://erp.exemple.test/api", resolving(["::ffff:169.254.169.254"]))).toBe("internal")
    expect(await real("https://erp.exemple.test/api", resolving(new Error("ENOTFOUND")))).toBe("unresolved")
    expect(await real("https://erp.exemple.test/api", resolving([]))).toBe("unresolved")
    expect(await real("https://127.0.0.1/api")).toBe("internal")
    expect(await real("https://[::1]/api")).toBe("internal")
    expect(resolutionFault).not.toBe(real)
  })
})
