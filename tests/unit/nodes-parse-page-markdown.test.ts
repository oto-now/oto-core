// @vitest-environment node
// Compatibilité markdown des pages (E10-S04) : chaque forme nouvelle rendue par `renderBlocks` et relue à
// l'identique par `parseMarkdown` (tableau simple, séparateur, repli, listes imbriquées, titres à cinq
// niveaux), les ambiguïtés tranchées (HN-E10S04-5), chaque refus mot pour mot, et les textes hostiles lus en
// temps linéaire (`security-patterns.md § Validation des inputs`).
import { describe, expect, it } from "vitest"
import { blockInputSchema, renderBlocks, type BlockInput } from "../../packages/plateforme/schemas"
import { parseMarkdown } from "../../packages/plateforme/server/nodes/markdown-parse"
import { applyOps } from "../../packages/plateforme/server/nodes/ops"
import { TEMPS_LINEAIRE_MS } from "../helpers/temps-lineaire"

const fields = ({ type, text, data }: BlockInput) => ({ type, text: text ?? null, data })

function parsed(text: string): ReturnType<typeof fields>[] {
  const result = parseMarkdown(text)
  if ("problem" in result) throw new Error(result.problem)
  return result.blocks.map(fields)
}

function problem(text: string): string | null {
  const result = parseMarkdown(text)
  return "problem" in result ? result.problem : null
}

/** Chaque forme nouvelle et son rendu canonique. */
const CANONICAL: { block: BlockInput; markdown: string }[] = [
  {
    block: { type: "simple_table", text: null, data: { columns: ["Nom", "a \\| b", "Montant"], rows: [["Devis<br>signé", "", "12 €"]], align: ["left", "center", "right"] } },
    markdown: "| Nom | a \\| b | Montant |\n| :--- | :---: | ---: |\n| Devis<br>signé |  | 12 € |",
  },
  { block: { type: "simple_table", text: null, data: { columns: ["Seule"], rows: [] } }, markdown: "| Seule |\n| --- |" },
  { block: { type: "divider", text: null, data: {} }, markdown: "---" },
  {
    block: { type: "toggle", text: "Le corps, [[ventes/devis]].\n\n```\n## pas un titre\n```", data: { summary: "Voir **le détail**" } },
    markdown: "<details>\n<summary>Voir **le détail**</summary>\n\nLe corps, [[ventes/devis]].\n\n```\n## pas un titre\n```\n\n</details>",
  },
  { block: { type: "toggle", text: "", data: { summary: "Vide" } }, markdown: "<details>\n<summary>Vide</summary>\n\n</details>" },
  {
    block: {
      type: "list",
      text: null,
      data: { items: ["a", { text: "b\nsuite", children: { items: ["c", { text: "d", children: { items: ["e", "f"], ordered: true, start: 3 } }] } }] },
    },
    markdown: "- a\n- b\n  suite\n  - c\n  - d\n    3. e\n    4. f",
  },
  {
    block: { type: "list", text: null, data: { items: [{ text: "un", children: { items: ["x"] } }], ordered: true } },
    markdown: "1. un\n   - x",
  },
  {
    block: { type: "list", text: null, data: { items: [{ text: "dix", children: { items: ["x"], ordered: true } }], ordered: true, start: 10 } },
    markdown: "10. dix\n    1. x",
  },
  ...[1, 2, 3, 4, 5].map((level) => ({
    block: { type: "heading" as const, text: `Niveau ${level}`, data: { level: level as 1 | 2 | 3 | 4 | 5 } },
    markdown: `${"#".repeat(level + 1)} Niveau ${level}`,
  })),
]

describe("parseMarkdown — page markdown forms read back (E10-S04)", () => {
  it("should render each new form canonically and read it back identically", () => {
    for (const { block, markdown } of CANONICAL) {
      expect(blockInputSchema.safeParse(block).success, markdown).toBe(true)
      expect(renderBlocks([block]), markdown).toBe(markdown)
      expect(parsed(markdown), markdown).toEqual([fields(block)])
    }
    const all = CANONICAL.map(({ block }) => block)
    expect(parsed(renderBlocks(all))).toEqual(all.map(fields))
  })

  it("should render back, word for word, a report written the way an assistant writes it", () => {
    const report = [
      "Réunion du **lundi** : ~~report~~ maintenu.<br>Voir [[ventes/devis]].",
      "---",
      "| Sujet | Décision | Échéance |\n| :--- | :---: | ---: |\n| Devis \\| Acme | Relancer | vendredi |\n| Pré-étude |  | 15/10 |",
      "- Actions\n  - Léa : relancer\n    1. appeler\n    2. écrire\n  - Paul : chiffrer\n- Suivi",
      "### Détail\n\nTexte.\n\n#### Précision\n\n##### Note\n\n###### Fin",
      "<details>\n<summary>Notes brutes</summary>\n\nTout ce qui a été dit.\n\n</details>",
    ].join("\n\n")
    const result = parseMarkdown(report)
    if ("problem" in result) throw new Error(result.problem)
    expect(result.blocks.map((block) => block.type)).toEqual(["paragraph", "divider", "simple_table", "list", "heading", "paragraph", "heading", "heading", "heading", "toggle"])
    expect(renderBlocks(result.blocks)).toBe(report)
  })

  it("should read each written variant into its canonical block (AC-a1 to AC-a3, AC-b1)", () => {
    expect(parsed("|a|b|\n|-|--:|\n|x|y")).toEqual([{ type: "simple_table", text: null, data: { columns: ["a", "b"], rows: [["x", "y"]], align: [null, "right"] } }])
    for (const line of ["***", "___", "  ----  ", "- - -".replace(/ /g, "")]) expect(parsed(`Intro.\n\n${line}`)[1], line).toEqual({ type: "divider", text: null, data: {} })
    expect(parsed("<details open><summary> Résumé </summary>\n\n\ncorps\n  </details>")).toEqual([{ type: "toggle", text: "corps", data: { summary: "Résumé" } }])
    expect(parsed("- a\n    - b\n  - c\n\n  - d")).toEqual([{ type: "list", text: null, data: { items: [{ text: "a", children: { items: ["b", "c", "d"] } }] } }])
  })

  it("should keep a titled link whole in a table cell, its bar written bare or escaped", () => {
    const table = String.raw`| Page | Note |
| --- | --- |
| [[ventes/devis|Le devis]] | [[ventes/suivi\|Suivi]] |
| [[a | b |`
    expect(parsed(table)).toEqual([
      { type: "simple_table", text: null, data: { columns: ["Page", "Note"], rows: [[String.raw`[[ventes/devis\|Le devis]]`, String.raw`[[ventes/suivi\|Suivi]]`], ["[[a", "b"]] } },
    ])
  })

  it("should settle each ambiguity as HN-E10S04-5 says", () => {
    expect(parsed("Texte\n---")).toEqual([{ type: "paragraph", text: "Texte\n---", data: {} }])
    expect(parsed("Texte\n| a |\n| --- |")).toEqual([{ type: "paragraph", text: "Texte\n| a |\n| --- |", data: {} }])
    expect(parsed("| a | b |\nfin")).toEqual([{ type: "paragraph", text: "| a | b |\nfin", data: {} }])
    expect(parsed("* * *")).toEqual([{ type: "list", text: null, data: { items: ["* *"] } }])
    expect(parsed("```\n<details>\n```")).toEqual([{ type: "code", text: "<details>", data: {} }])
    expect(parsed("####### Sept")).toEqual([{ type: "paragraph", text: "####### Sept", data: {} }])
    expect(parsed("Texte\n<details>\n<summary>R</summary>\n</details>")).toEqual([
      { type: "paragraph", text: "Texte", data: {} },
      { type: "toggle", text: "", data: { summary: "R" } },
    ])
    // HN-E10S04-2 : sous une liste à cocher, une ligne à marque reste du texte de l'élément.
    expect(parsed("- [ ] a\n  - b")).toEqual([{ type: "checklist", text: null, data: { items: [{ text: "a\n- b", checked: false }] } }])
  })

  it("should refuse each malformed form with its words, as invalid_arguments", () => {
    const cases: [string, string][] = [
      [`| ${Array.from({ length: 21 }, () => "c").join(" | ")} |\n| ${Array.from({ length: 21 }, () => "---").join(" | ")} |`, "line 1: a table holds 20 columns at most (21)."],
      [["| c |", "| --- |", ...Array.from({ length: 201 }, () => "| x |")].join("\n"), "line 1: a table holds 200 rows at most (201)."],
      ["| a | b |\n| --- | --- |\n| x | y | z |", "line 3: this row has 3 cells; the header has 2."],
      ["Intro\n\n<details>\n<summary>R</summary>\ncorps", "line 3: <details> is never closed by </details>."],
      ["<details>\n<summary>R</summary>\n<details>\n</details>", "line 3: a toggle cannot hold another toggle."],
      ["<details>\ncorps\n</details>", "line 2: a toggle starts with <summary>…</summary> on one line."],
      [`<details><summary>${"r".repeat(201)}</summary>\n</details>`, "line 1: a toggle summary holds 200 characters at most (201)."],
      ["- a\n  - b\n  1. c", "line 3: a sub-list mixes bullets and numbers."],
      ["- a\n  - b\n    - c\n      - d", "line 4: lists go three levels deep at most."],
      ["- a\n  - b\n  texte", "line 3: text after a sub-list belongs to no item; indent it under an item."],
      [["- a", ...Array.from({ length: 500 }, () => "  - b")].join("\n"), "line 1: a list holds 500 items at most, sub-items included (501)."],
    ]
    for (const [text, words] of cases) expect(problem(text), words).toBe(words)
    expect(() => applyOps([], [{ op: "add_section", section: "S", text: cases[2][0] }], { path: "ventes/devis" })).toThrow(
      expect.objectContaining({ code: "invalid_arguments", message: `Op 1 (add_section « S »): ${cases[2][1]} Nothing was written.` }),
    )
  })

  it("should read hostile texts in linear time", () => {
    const n = 100_000
    const texts: [string, string][] = [
      ["bars", "|".repeat(n)],
      ["bars then a delimiter", `${"|".repeat(n)}\n| --- |`],
      ["escaped cell", `| ${"\\\\".repeat(n / 2)}| |\n| --- |`],
      ["unclosed toggles", Array.from({ length: n / 2 }, () => "<details>").join("\n")],
      ["summary then toggles", `<details>\n<summary>R</summary>\n${Array.from({ length: n / 2 }, () => "x").join("\n")}`],
      ["indented list lines", ["- a", ...Array.from({ length: n }, (_, index) => `${"  ".repeat((index % 3) + 1)}- b`)].join("\n")],
      ["deep list continuations", ["- a", ...Array.from({ length: n }, () => "    texte")].join("\n")],
      ["dividers", Array.from({ length: n / 4 }, () => "---").join("\n\n")],
      ["hashes", `${"#".repeat(n)} x`],
    ]
    for (const [what, text] of texts) {
      const started = performance.now()
      parseMarkdown(text)
      expect(performance.now() - started, what).toBeLessThan(TEMPS_LINEAIRE_MS)
    }
  })
})
