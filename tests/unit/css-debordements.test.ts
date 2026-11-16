import { readFileSync } from "fs"
import path from "path"
import { describe, expect, it } from "vitest"

// Les débordements vus en production, que jsdom ne mesure pas (ils ont été reproduits dans un navigateur) : la règle
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

  it("should keep the raw text of a rendered table cell, longer with its links, out of the width of its cell at rest (1.4.12)", () => {
    const editeur = css("components/css/editeur.css")
    expect(editeur).toMatch(/@media not \(forced-colors: active\) \{\s*\.oto-table\[data-simple\] \.oto-cellule-editee > textarea\[data-rendu\]:not\(:focus\) \{ inline-size: auto; \}/)
  })

  it("should keep the raw text of a rendered field, longer with its links, out of the height of its block at rest", () => {
    const editeur = css("components/css/editeur.css")
    expect(editeur).toMatch(/@media not \(forced-colors: active\) \{\s*\.oto-block-pile > :is\(\.oto-block-field, \.oto-inline-field\)\[data-rendu\]:not\(:focus\) \{[^}]*position: absolute;[^}]*inset: 0;/)
  })

  // Un champ positionné passe au-dessus d'un frère qui ne l'est pas : sans cette règle, le clic sur un lien d'un Texte au
  // repos tombait dans le champ, qui ouvrait le panneau « Lien » au lieu de suivre le lien (la copie d'une liste l'avait).
  it("should paint the rendering of a field at rest above the field made absolute, so that a click on its link follows it", () => {
    const rendu = regle(css("components/css/editeur.css"), ".oto-block-pile > .oto-block-rendu")
    expect(rendu).toMatch(/position:\s*relative/)
    expect(rendu).toMatch(/z-index:\s*1/)
  })

  // Mesuré dans Chrome à 390 px, au doigt : la gouttière cachée gardait 48 px à gauche de chaque bloc (texte de 232 px
  // de large sur 348), et le bouton de 44 px de la bulle débordait sa cellule de 32 px, l'îlot défilait de côté.
  it("should give a touch screen the whole width: no gutter kept for the « + » and the handle, a comment cell as wide as its target", () => {
    const tactile = /@media \(hover: none\) \{([\s\S]*?)\n\}/.exec(css("components/css/blocks.css"))?.[1] ?? ""
    expect(tactile).toMatch(/\.oto-block-row \{ --block-gutter: 0px; \}/)
    expect(tactile).toMatch(/\.oto-block-gutter \{ display: none; \}/)
    expect(tactile).toMatch(/--block-comment: var\(--touch\);/)
    expect(tactile).toMatch(/padding-inline-end: max\(var\(--island-pad\), var\(--touch\)\);/)
  })

  it("should show every entry of the « + » and of « / » without a scroll bar, the « + » bounded by the window only", () => {
    const editeur = css("components/css/editeur.css")
    expect(regle(editeur, ".oto-pop.oto-menu-du-plus > .oto-menu")).toMatch(/max-block-size:\s*calc\(100dvh/)
    expect(regle(editeur, ".oto-pop.oto-choix-de-bloc > .oto-menu")).toMatch(/max-block-size:\s*none/)
  })
})
