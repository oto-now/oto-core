// @vitest-environment node
// Les plis d'une page : chaque titre replie sa section à l'écran, l'assistant la lit entière ; le marqueur d'un titre
// repliable de la 1.4.5 n'entre plus dans le texte d'un titre et ne s'écrit plus.
import { describe, expect, it } from "vitest"
import { renderBlocks } from "../../packages/plateforme/schemas"
import { foldsAround, foldTree, hiddenByFolds } from "../../packages/plateforme/schemas/folds"
import { parseMarkdown } from "../../packages/plateforme/server/nodes/markdown-parse"

const titre = (text: string, level: number) => ({ type: "heading", text, data: { level } })
const texte = (text: string) => ({ type: "paragraph", text, data: {} })

describe("the marker of a 1.4.5 collapsible heading", () => {
  it("should read it out of the heading text, and no longer write it", () => {
    const parsed = parseMarkdown("### Annexes <!-- toggle -->\n\nDétail.")
    expect("blocks" in parsed && parsed.blocks).toEqual([titre("Annexes", 2), texte("Détail.")])
    expect(renderBlocks([{ type: "heading", text: "Annexes", data: { level: 2, collapsible: true } }])).toBe("### Annexes")
  })
})

describe("the sections every heading folds", () => {
  // 0 Intro · 1 ## A · 2 a · 3 ### A1 · 4 a1 · 5 ## B · 6 b
  const page = [texte("Intro"), titre("A", 1), texte("a"), titre("A1", 2), texte("a1"), titre("B", 1), texte("b")]

  it("should group each heading with its section, nested, the blocks before the first heading flat", () => {
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
      ["B", [["b", undefined]]],
    ])
  })

  it("should hide the section of a closed heading only, and name the headings around a block", () => {
    expect(hiddenByFolds(page, () => true)).toEqual(page.map(() => false))
    expect(hiddenByFolds(page, (_, rang) => rang !== 3)).toEqual([false, false, false, false, true, false, false])
    expect(hiddenByFolds(page, (_, rang) => rang !== 1)).toEqual([false, false, true, true, true, false, false])
    expect(foldsAround(page, 4)).toEqual([1, 3])
    expect(foldsAround(page, 0)).toEqual([])
  })
})
