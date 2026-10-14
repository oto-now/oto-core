// @vitest-environment node
// Le guide de la plateforme (`read {"path": "help"}`, 1.4.3) : son plan, une section par appel, le refus d'une section
// inconnue ; la section la plus proche d'une demande, et les propositions de `context` quand aucune procédure ne
// convient (fonctions, puis section du guide).
import { describe, expect, it } from "vitest"
import { catalogFunctions, searchFunctions } from "../../packages/plateforme/server/catalog/registry"
import { hintLines } from "../../packages/plateforme/server/context/hints"
import { closestHelpSection, helpGuide, HELP_PATH } from "../../packages/plateforme/server/help"

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
    expect(() => helpGuide("nowhere", "acme")).toThrow(/Unknown section nowhere of help\. Sections: pages, tables, procedures, paths, transfer, pitfalls\./)
  })
})

describe("closestHelpSection and hintLines", () => {
  it("should lead a request to its section by the beginnings of its words, French or English, and nowhere without one", () => {
    expect(closestHelpSection("Exporte toutes les pages de l'équipe SAV")?.id).toBe("transfer")
    expect(closestHelpSection("Comment écrire une procédure en étapes ?")?.id).toBe("procedures")
    expect(closestHelpSection("Range ce dossier ailleurs")?.id).toBe("paths")
    expect(closestHelpSection("Bonjour")).toBeNull()
  })

  it("should find node.export_tree among the functions for a request to export a team's pages", () => {
    const found = searchFunctions(catalogFunctions(), "Exporte toutes les pages de l'équipe SAV", 3)
    expect(found.filter(({ score }) => score >= 0.25).map(({ fn }) => fn.name)).toContain("node.export_tree")
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
})
