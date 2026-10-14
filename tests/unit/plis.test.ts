// @vitest-environment node
// Les titres repliables (story `titres-et-replis`) : le marqueur markdown servi et relu (AC-d), les sections que
// replie un titre (AC-b), et l'option « Repliable » d'un titre dans l'éditeur (AC-b).
import { describe, expect, it } from "vitest"
import { blockInputSchema, renderBlocks } from "../../packages/plateforme/schemas"
import { foldsAround, foldTree, hiddenByFolds } from "../../packages/plateforme/schemas/folds"
import { parseMarkdown } from "../../packages/plateforme/server/nodes/markdown-parse"
import { avecRepliable } from "../../packages/plateforme/ui/noeud/editeur/blocs-de-page"
import { changerDeForme, rangeesDepuis } from "../../packages/plateforme/ui/noeud/editeur/modele"

const titre = (text: string, level: number, collapsible = false) => ({ type: "heading", text, data: { level, ...(collapsible ? { collapsible: true } : {}) } })
const texte = (text: string) => ({ type: "paragraph", text, data: {} })

describe("the collapsible heading marker (AC-d)", () => {
  it("should serve a collapsible heading with its marker and read the marker back out of the heading text", () => {
    const blocks = [titre("Annexes", 2, true), texte("Détail.")]
    const markdown = renderBlocks(blocks)
    expect(markdown).toBe("### Annexes <!-- toggle -->\n\nDétail.")
    const parsed = parseMarkdown(markdown)
    expect("blocks" in parsed && parsed.blocks).toEqual(blocks)
    expect(blockInputSchema.safeParse(blocks[0]).success).toBe(true)
  })

  it("should drop the option when an assistant writes the heading without its marker", () => {
    const parsed = parseMarkdown("## Annexes")
    expect("blocks" in parsed && parsed.blocks).toEqual([titre("Annexes", 1)])
  })
})

describe("the sections a collapsible heading folds (AC-b)", () => {
  // 0 Intro · 1 ## A (repliable) · 2 a · 3 ### A1 (repliable) · 4 a1 · 5 ## B · 6 b
  const page = [texte("Intro"), titre("A", 1, true), texte("a"), titre("A1", 2, true), texte("a1"), titre("B", 1), texte("b")]

  it("should group each collapsible heading with its section, nested, the other blocks flat", () => {
    const arbre = foldTree(page).map(({ block, section }) => [block.text, section?.map((pli) => [pli.block.text, pli.section?.map((un) => un.block.text)])])
    expect(arbre).toEqual([
      ["Intro", undefined],
      [
        "A",
        [
          ["a", undefined],
          ["A1", ["a1"]],
        ],
      ],
      ["B", undefined],
      ["b", undefined],
    ])
  })

  it("should hide the section of a closed heading only, and name the headings around a block", () => {
    expect(hiddenByFolds(page, () => false)).toEqual([false, false, true, true, true, false, false])
    expect(hiddenByFolds(page, (_, rang) => rang === 1)).toEqual([false, false, false, false, true, false, false])
    expect(hiddenByFolds(page, () => true)).toEqual(page.map(() => false))
    expect(foldsAround(page, 4)).toEqual([1, 3])
    expect(foldsAround(page, 6)).toEqual([])
  })
})

describe("the Repliable option of a title in the editor (AC-b)", () => {
  it("should keep the option from one title to another, lose it on another form, and drop the key when unchecked", () => {
    const [rangee] = rangeesDepuis([{ id: "aaaaaaaa-0001", ref: "aaaaaaaa", revision: 1, type: "heading", text: "Annexes", data: { level: 1, collapsible: true }, key: null, position: 1, provenance: {} }])
    expect(changerDeForme([rangee], rangee.cle, "petitTitre").modele[0].bloc.data).toEqual({ level: 3, collapsible: true })
    expect(changerDeForme([rangee], rangee.cle, "texte").modele[0].bloc.data).toEqual({})
    expect(avecRepliable(rangee.bloc, false).data).toEqual({ level: 1 })
    expect(avecRepliable(avecRepliable(rangee.bloc, false), true).data).toEqual({ level: 1, collapsible: true })
  })
})
