import { readFileSync } from "fs"
import path from "path"
import { describe, expect, it } from "vitest"

// Trois débordements vus en production, que jsdom ne mesure pas (ils ont été reproduits dans un navigateur) : la règle
// qui les empêche se garde ici, par son texte.
const css = (fichier: string) => readFileSync(path.resolve(__dirname, "../../packages/plateforme/ui/ds", fichier), "utf8").replace(/\/\*[\s\S]*?\*\//g, "")
const regle = (texte: string, selecteur: string) => new RegExp(`${selecteur.replace(/[.[\]"=]/g, (c) => `\\${c}`)}\\s*\\{([^}]*)\\}`).exec(texte)?.[1] ?? ""

describe("overflows of the screens kept closed by their CSS", () => {
  it("should keep the tab bar from collapsing in a flex column, its overflow-x bringing its minimum height to zero", () => {
    expect(regle(css("components/css/navigation.css"), ".oto-tabs")).toMatch(/flex:\s*none/)
  })

  it("should keep an island that lets its content out from shrinking under it", () => {
    expect(regle(css("app/islands.css"), '.oto-island[data-overflow="visible"]')).toMatch(/flex-shrink:\s*0/)
  })

  it("should size the lead of a row to what it holds, an avatar of 24 px included", () => {
    const lead = regle(css("components/css/lists.css"), ".oto-row-lead")
    expect(lead).toMatch(/min-inline-size:\s*20px/)
    expect(lead).not.toMatch(/(^|[^-])inline-size:\s*20px/)
  })
})
