// @vitest-environment node
// L'index des fonctions d'un hôte sans base (`docs/conception/fonctions-d-un-hote-index.md` § Index) : les fonctions
// filtrées par la liste de la personne, le bloc de `context` borné à 3 000 caractères et sa règle de troncature
// (les fonctions proches d'abord, puis les familles par la fin, une ligne qui le dit et renvoie à `read functions`),
// déterministe ; pas de bloc sans API servie ni pour une personne sans fonction ; la raison d'une liste indisponible ;
// la partie de `read functions`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { CatalogFunction } from "../../packages/plateforme/server/catalog/define"
import { importHostDocument, type HostIndexEntry, type ImportedHost } from "../../packages/plateforme/server/host-api/document"
import { hostCatalogFunctions } from "../../packages/plateforme/server/host-api/functions"
import { FAMILY_LINE_MAX, HOST_INDEX_MAX, hostCatalogLines, hostIndexBlock, hostUnavailableNotice, visibleHostFunctions } from "../../packages/plateforme/server/host-api/index-view"
import type { HostVisibility } from "../../packages/plateforme/server/host-api/visibility"
import { HOST, hostDocument, ISSUER } from "../helpers/host-api"

beforeEach(() => {
  vi.stubEnv("PLATFORM_OIDC_ISSUER", ISSUER)
  vi.stubEnv("PLATFORM_OIDC_AUDIENCE", "https://oto.example.test/api/mcp")
})

afterEach(() => {
  vi.unstubAllEnvs()
})

function imported(): ImportedHost {
  const result = importHostDocument(hostDocument(), ["table", "node"])
  if ("problems" in result) throw new Error(`document refused: ${JSON.stringify(result.problems)}`)
  return result.imported
}

const visible = (host: ImportedHost, names: string[]): Extract<HostVisibility, { kind: "visible" }> => ({ kind: "visible", host: { imported: host, address: HOST }, names: new Set(names) })

/**
 * Un grand hôte : `families` familles de `perFamily` lectures, de noms longs, et le catalogue qui va avec ; seuls
 * comptent pour l'index le titre, les familles, l'index et, pour la recherche, le nom et la description des fonctions.
 */
function largeHost(families: number, perFamily: number): { host: ImportedHost; functions: CatalogFunction[] } {
  const keys = Array.from({ length: families }, (_, rank) => `famille_${String(rank).padStart(2, "0")}`)
  const index: HostIndexEntry[] = keys.flatMap((family) =>
    Array.from({ length: perFamily }, (_, rank) => {
      const name = `${family}.consulter_les_elements_numero_${String(rank).padStart(2, "0")}`
      return { operationId: name, served: name, family, class: "read" as const, label: `Voir ${rank}`, summary: `Read the elements number ${rank} of ${family}.` }
    }),
  )
  const host = { title: "Grand Hote", families: keys.map((key) => ({ key, label: `Family ${key}` })), index } as unknown as ImportedHost
  const functions = index.map((entry) => ({ name: entry.served, connector: entry.family, class: "read", origin: "erp", description: entry.summary }) as unknown as CatalogFunction)
  return { host, functions }
}

describe("the functions a person sees", () => {
  it("should keep only the functions her list names, under their served names", () => {
    const host = imported()
    const all = hostCatalogFunctions(host, HOST)
    expect(visibleHostFunctions(all, visible(host, ["projet.archiver"])).map((fn) => fn.name)).toEqual(["projet_act.archiver"])
    expect(visibleHostFunctions(all, visible(host, []))).toEqual([])
    expect(visibleHostFunctions(all, { kind: "unavailable", host: { imported: host, address: HOST }, reason: "down." })).toEqual([])
  })
})

describe("the block of context", () => {
  it("should list one line per family with the visible functions, then the closest functions with their summary", () => {
    const host = imported()
    const all = hostCatalogFunctions(host, HOST)
    const block = hostIndexBlock(visible(host, ["projet.lister", "projet.archiver"]), all, "archive a project", "acme")
    expect(block?.cut).toBe(false)
    expect(block?.text.split("\n")).toEqual([
      'Functions of Hote Test open to you, by family (read a contract with acme_read {"path": "<function>"}, run it with acme_call; the whole index, with each summary: acme_read {"path": "functions"}):',
      "- Projects: projet.lister, projet_act.archiver",
      "Closest to the request:",
      "- projet_act.archiver: Archive a project",
      "- projet.lister: List the projects",
    ])
  })

  it("should show only what the person's roles open, and nothing to a person without a role", () => {
    const host = imported()
    const all = hostCatalogFunctions(host, HOST)
    const reader = hostIndexBlock(visible(host, ["projet.lister"]), visibleHostFunctions(all, visible(host, ["projet.lister"])), "archive a project", "acme")
    expect(reader?.text).toContain("- Projects: projet.lister\n")
    expect(reader?.text).not.toContain("archiver")
    expect(hostIndexBlock(visible(host, []), [], "archive a project", "acme")).toBeNull()
  })

  it("should serve no block in an organisation without a host's API", () => {
    expect(hostIndexBlock({ kind: "none" }, [], "archive a project", "acme")).toBeNull()
    expect(hostCatalogLines({ kind: "none" }, "acme")).toEqual([])
    expect(hostUnavailableNotice({ kind: "none" }, "acme")).toBeNull()
  })

  it("should say why the list is unavailable rather than show every function", () => {
    const unavailable: HostVisibility = { kind: "unavailable", host: { imported: imported(), address: HOST }, reason: "Hote Test answered with an unexpected status (500). Retry later." }
    const line = "Functions of Hote Test unavailable: Hote Test answered with an unexpected status (500). Retry later. acme_call still reaches Hote Test, which decides."
    expect(hostIndexBlock(unavailable, [], undefined, "acme")).toEqual({ text: line, cut: false })
    expect(hostCatalogLines(unavailable, "acme")).toEqual([line])
    expect(hostUnavailableNotice(unavailable, "acme")).toBe(line)
  })

  it("should drop the closest functions first, the least close first, and say so with a pointer to read functions", () => {
    // 11 familles de 4 : les familles tiennent, pas les 8 fonctions proches en plus.
    const { host, functions } = largeHost(11, 4)
    const names = host.index.map((entry) => entry.operationId)
    const block = hostIndexBlock(visible(host, names), functions, "consulter elements numero", "acme")
    expect(block?.cut).toBe(true)
    expect(block!.text.length).toBeLessThanOrEqual(HOST_INDEX_MAX)
    const lines = block!.text.split("\n")
    expect(lines.filter((line) => line.startsWith("- Family "))).toHaveLength(11)
    expect(lines).toContain("Closest to the request:")
    expect(lines.at(-1)).toMatch(/^\[Index cut to 3,000 characters: \d close functions not listed\. Read them with acme_read \{"path": "functions"\}\.\]$/)
  })

  it("should then drop the families from the last, name how many are missing, and stay deterministic", () => {
    const { host, functions } = largeHost(20, 6)
    const names = host.index.map((entry) => entry.operationId)
    const block = hostIndexBlock(visible(host, names), functions, "consulter elements numero", "acme")
    expect(block!.text.length).toBeLessThanOrEqual(HOST_INDEX_MAX)
    const lines = block!.text.split("\n")
    const families = lines.filter((line) => line.startsWith("- Family "))
    expect(families[0]).toMatch(/^- Family famille_00: /)
    expect(lines).not.toContain("Closest to the request:")
    expect(lines.at(-1)).toBe(`[Index cut to 3,000 characters: ${20 - families.length} families and 8 close functions not listed. Read them with acme_read {"path": "functions"}.]`)
    expect(hostIndexBlock(visible(host, [...names].reverse()), [...functions], "consulter elements numero", "acme")).toEqual(block)
  })

  it("should count the last names of a family too long for its line, never cut a name", () => {
    const { host, functions } = largeHost(1, 30)
    const block = hostIndexBlock(visible(host, host.index.map((entry) => entry.operationId)), functions, undefined, "acme")
    const line = block!.text.split("\n")[1]
    expect(line.length).toBeLessThanOrEqual(FAMILY_LINE_MAX)
    expect(line).toMatch(/ … and \d+ more$/)
    expect(line.replace(/ … and \d+ more$/, "").split(": ")[1].split(", ").every((name) => /^famille_00\.consulter_les_elements_numero_\d{2}$/.test(name))).toBe(true)
    expect(block?.cut).toBe(true)
  })
})

describe("the part of read functions", () => {
  it("should list every visible function by family with its class and summary, or say none is open", () => {
    const host = imported()
    expect(hostCatalogLines(visible(host, ["projet.lister", "projet.archiver"]), "acme")).toEqual([
      "Functions of Hote Test open to you, by family:",
      "Projects:",
      "- projet.lister (read): List the projects",
      "- projet_act.archiver (sensitive): Archive a project",
    ])
    expect(hostCatalogLines(visible(host, []), "acme")).toEqual(["No function of Hote Test is open to you."])
  })
})
