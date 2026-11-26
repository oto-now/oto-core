// @vitest-environment node
// Le guide de la plateforme (`read {"path": "help"}`, 1.4.3) : son plan, une section par appel, le refus d'une section
// inconnue ; la section la plus proche d'une demande, et les propositions de `context` quand aucune procédure ne
// convient (fonctions, puis section du guide).
import { describe, expect, it, vi } from "vitest"
import { assistantFunctions, catalogFunctions } from "../../packages/plateforme/server/catalog/registry"
import type { PlatformDb } from "../../packages/plateforme/server/db"
import { hintLines, proposedFunctions, routingHints } from "../../packages/plateforme/server/context/hints"
import type { Identity } from "../../packages/plateforme/server/identity"
import { closestHelpSection, helpGuide, HELP_PATH } from "../../packages/plateforme/server/help"
import { loggedText } from "../helpers/logs"

// La lecture des connecteurs actifs et le catalogue de l'assistant, simulés pour le seul test de la panne du classement (AC4).
vi.mock("../../packages/plateforme/server/connectors/activations", () => ({ loadOpenConnectors: vi.fn(async () => new Set<string>()) }))
vi.mock("../../packages/plateforme/server/catalog/registry", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../packages/plateforme/server/catalog/registry")>()
  return { ...original, assistantFunctions: vi.fn(original.assistantFunctions) }
})

describe("helpGuide", () => {
  it("should serve its plan, then one section at a time with the organisation prefix, and refuse an unknown section", () => {
    const plan = helpGuide(undefined, "acme")
    expect(plan.target).toBe(HELP_PATH)
    expect(plan.text).toContain("- transfer: Import and export")
    expect(plan.text).toContain('acme_read {"path": "help", "section": "<name>"}')
    const tables = helpGuide("Tables", "acme").text
    expect(tables.split("\n")[0]).toBe("## Tables")
    expect(tables).toContain("acme_call table.schema")
    expect(tables).not.toContain("<p>")
    expect(helpGuide("pages", "acme").text).toContain("```embed https://…```")
    // Plus de borne de taille d'une procédure depuis le 2026-10-27 : le guide n'en dit aucune.
    const procedures = helpGuide("procedures", "acme").text
    expect(procedures).not.toMatch(/characters at most/)
    expect(procedures).toContain("never a procedure under a procedure")
    expect(() => helpGuide("nowhere", "acme")).toThrow(/Unknown section nowhere of help\. Sections: pages, tables, procedures, paths, transfer, comments, pitfalls\./)
  })
})

describe("routingHints when the ranking throws (AC4)", () => {
  it("should propose no function, the failure logged, and still give the guide section", async () => {
    // Une fonction du paquet (toujours active) dont la description ne se lit pas : la préparation du classement lève.
    const broken = Object.defineProperty({ ...catalogFunctions().filter((fn) => fn.origin === "paquet")[0], name: "node.broken" }, "description", { get: () => { throw new Error("unreadable") } })
    vi.mocked(assistantFunctions).mockReturnValueOnce([broken])
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    // Ni base ni identité lues au-delà du préfixe : la lecture des connecteurs actifs est simulée.
    const hints = await routingHints({} as PlatformDb, { org: { id: "o" } } as Identity, "Exporte toutes les pages de l'équipe SAV", { served: false, used: Promise.resolve(new Set()) })
    expect([hints.functions, hints.help?.id, loggedText(error).includes("[platform] context: function ranking failed")]).toEqual([[], "transfer", true])
    error.mockRestore()
  })
})

describe("closestHelpSection and hintLines", () => {
  it("should lead a request to its section by the beginnings of its words, French or English, and nowhere without one", () => {
    expect(closestHelpSection("Exporte toutes les pages de l'équipe SAV")?.id).toBe("transfer")
    expect(closestHelpSection("Comment écrire une procédure en étapes ?")?.id).toBe("procedures")
    expect(closestHelpSection("Range ce dossier ailleurs")?.id).toBe("paths")
    expect(closestHelpSection("Bonjour")).toBeNull()
  })

  it("should propose node.export_tree first for a request to export a team's pages, and neither transfer function to create a task", () => {
    // Par sa formule française « exporter les pages d'une équipe ou d'un dossier », comptée comme une formulation.
    expect(proposedFunctions(catalogFunctions(), "Exporte toutes les pages de l'équipe SAV").map(({ name }) => name)[0]).toBe("node.export_tree")
    // Un seul mot commun avec `node.export_tree` et `node.import_tree` : ni l'une ni l'autre (AC3) ; `team.create` vient de
    // sa formule « créer équipe » : un faux positif compté dans la mesure des fonctions.
    expect(proposedFunctions(catalogFunctions(), "créer une tâche").map(({ name }) => name)).toEqual(["team.create"])
  })

  it("should list the functions that may do it, then the section of the guide, and nothing without hints", () => {
    const lines = hintLines({ functions: [{ name: "node.export_tree", sentence: "Exports one or several roots." }], help: { id: "transfer", title: "Import and export" } }, "acme")
    expect(lines).toEqual([
      "Functions that may do it (read a contract with acme_read path <function>, run it with acme_call):",
      "- node.export_tree: Exports one or several roots.",
      'Platform guide: acme_read {"path": "help", "section": "transfer"} (Import and export).',
    ])
    expect(hintLines(undefined, "acme")).toEqual([])
  })

  // 1.4.12 : une demande d'écrire une procédure reçoit la notice entière, préfixe de l'organisation compris.
  it("should serve the whole procedures section to a request about writing a procedure, and only a pointer to another section", () => {
    const procedures = closestHelpSection("Écris une procédure pour relancer les devis")
    const lines = hintLines({ functions: [], help: procedures }, "acme").join("\n")
    expect(lines).toContain("From the platform guide (section procedures):\n## Procedures\nA procedure is a page of steps an assistant follows.")
    expect(lines).toContain("acme_read path write.procedure")
    // Contexte plus court (AC5) : la règle du titre et du résumé, que les règles servies ne détaillent plus.
    expect(lines).toContain(
      "The title is the action in the words of those who ask for it, a verb and an object (« Relancer les devis en attente »), never the name of a deliverable alone. The summary says what it does, then three to five ways people ask for it, abbreviations included.",
    )
    expect(lines).not.toContain("<p>")
    expect(closestHelpSection("Exporte toutes les pages de l'équipe SAV")?.text).toBeUndefined()
  })
})
