// @vitest-environment node
// Le guide de la plateforme (`read {"path": "help"}`, 1.4.3) : son plan, une section par appel, le refus d'une section
// inconnue ; la section la plus proche d'une demande, et les propositions de `context` quand aucune procédure ne
// convient (fonctions, puis section du guide).
import { describe, expect, it } from "vitest"
import { PROCEDURE_MAX_CHARS } from "../../packages/plateforme/schemas/procedures"
import { catalogFunctions } from "../../packages/plateforme/server/catalog/registry"
import { hintLines, proposedFunctions } from "../../packages/plateforme/server/context/hints"
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
    // La borne d'une procédure, lue dans `schemas` : le guide la disait encore à 8 000 après son passage à 12 000.
    const procedures = helpGuide("procedures", "acme").text
    expect(procedures).toContain(`a procedure holds ${PROCEDURE_MAX_CHARS.toLocaleString("en-US")} characters at most`)
    expect(procedures).toContain("never a procedure under a procedure")
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

  it("should propose node.export_tree for a request to export a team's pages, and no function on a single common word", () => {
    expect(proposedFunctions(catalogFunctions(), "Exporte toutes les pages de l'équipe SAV").map(({ name }) => name)).toContain("node.export_tree")
    // Un seul mot commun avec `node.export_tree` et `node.import_tree` : rien n'est proposé.
    expect(proposedFunctions(catalogFunctions(), "créer une tâche")).toEqual([])
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
    expect(lines).not.toContain("<p>")
    expect(closestHelpSection("Exporte toutes les pages de l'équipe SAV")?.text).toBeUndefined()
  })
})
