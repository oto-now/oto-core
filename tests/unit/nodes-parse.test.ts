// @vitest-environment node
// Analyse du markdown d'une opération de `write` (E03-S03, AC2, AC3) : les formes canoniques rendues par
// le rendu commun de M05, relues à l'identique par `parseMarkdown` ; les analyses et les refus de
// l'AC3, mot pour mot, avec le préfixe et la fin de l'AC22 (servis par `applyOps`). Puis la compatibilité
// markdown des pages (E10-S04) : chaque forme nouvelle rendue par `renderBlocks` et relue à l'identique
// (tableau simple, séparateur, repli, listes imbriquées, titres à cinq niveaux), les ambiguïtés tranchées
// (HN-E10S04-5), chaque refus mot pour mot, et les textes hostiles lus en temps linéaire
// (`security-patterns.md § Validation des inputs`).
import { describe, expect, it } from "vitest"
import { blockInputSchema, renderBlocks, type BlockInput } from "../../packages/plateforme/schemas"
import { extractLinks } from "../../packages/plateforme/server/nodes/links"
import { parseMarkdown } from "../../packages/plateforme/server/nodes/markdown-parse"
import { applyOps } from "../../packages/plateforme/server/nodes/ops"
import { TEMPS_LINEAIRE_MS } from "../helpers/temps-lineaire"

/** Un bloc de chaque type de document, dans les formes du tableau « Formes canoniques » (AC2). */
const CANONICAL: { block: BlockInput; markdown: string }[] = [
  { block: { type: "heading", text: "Étapes", data: { level: 1 } }, markdown: "## Étapes" },
  { block: { type: "heading", text: "Détail", data: { level: 3 } }, markdown: "#### Détail" },
  { block: { type: "paragraph", text: "Voir [[ventes/suivi|le suivi]] et **le devis**.\nDeuxième ligne.", data: {} }, markdown: "Voir [[ventes/suivi|le suivi]] et **le devis**.\nDeuxième ligne." },
  { block: { type: "list", text: null, data: { items: ["Téléphone", "Chat"] } }, markdown: "- Téléphone\n- Chat" },
  { block: { type: "list", text: null, data: { items: ["Réserve", "Écris"], ordered: true, start: 3 } }, markdown: "3. Réserve\n4. Écris" },
  { block: { type: "list", text: null, data: { items: ["Lire\nattentivement", "Écrire"], ordered: true } }, markdown: "1. Lire\n  attentivement\n2. Écrire" },
  { block: { type: "checklist", text: null, data: { items: [{ text: "Relire", checked: false }, { text: "Envoyer", checked: true }] } }, markdown: "- [ ] Relire\n- [x] Envoyer" },
  { block: { type: "code", text: "Exemple :\n```\nx = 1\n```", data: { language: "md" } }, markdown: "````md\nExemple :\n```\nx = 1\n```\n````" },
  { block: { type: "code", text: "select 1", data: {} }, markdown: "```\nselect 1\n```" },
  {
    block: { type: "call", text: null, data: { function: "table.rows", args: { table: "ventes/suivi_prospects", limit: 3 } } },
    markdown: '```call\ntable.rows {"table":"ventes/suivi_prospects","limit":3}\n```',
  },
  { block: { type: "mermaid", text: "graph TD; A-->B", data: {} }, markdown: "```mermaid\ngraph TD; A-->B\n```" },
  { block: { type: "image", text: "Plan du site", data: { src: "https://x.test/p.png", alt: "Plan" } }, markdown: '![Plan](https://x.test/p.png "Plan du site")' },
  { block: { type: "image", text: null, data: { src: "a.png", alt: "" } }, markdown: "![](a.png)" },
  { block: { type: "callout", text: "Attention.", data: { tone: "warning" } }, markdown: "> [!WARNING]\n> Attention." },
  {
    block: { type: "reference", text: null, data: { path: "ventes/suivi_prospects", view: { filter: { statut: "à revoir" } } } },
    markdown: '```reference\nventes/suivi_prospects {"filter":{"statut":"à revoir"}}\n```',
  },
]

const fields = ({ type, text, data }: BlockInput) => ({ type, text: text ?? null, data })

function parsed(text: string): BlockInput[] {
  const result = parseMarkdown(text)
  if ("problem" in result) throw new Error(result.problem)
  return result.blocks
}

/** Le refus servi par `write` pour un texte, par une opération `add_section` (préfixe et fin de l'AC22). */
function refusal(text: string): unknown {
  try {
    applyOps([], [{ op: "add_section", section: "S", text }], { path: "ventes/devis" })
  } catch (error) {
    return error
  }
  return null
}

describe("parseMarkdown — canonical forms of M05 read back (AC2)", () => {
  it("should render each block in its canonical form, one empty line apart, and read each back identically", () => {
    for (const { block, markdown } of CANONICAL) {
      expect(renderBlocks([block]), block.type).toBe(markdown)
      const [back] = parsed(markdown)
      expect(fields(back), markdown).toEqual(fields(block))
      expect(blockInputSchema.safeParse(back).success, markdown).toBe(true)
    }
    const all = CANONICAL.map(({ block }) => block)
    expect(renderBlocks(all)).toBe(CANONICAL.map(({ markdown }) => markdown).join("\n\n"))
    expect(parsed(renderBlocks(all)).map(fields)).toEqual(all.map(fields))
  })
})

describe("parseMarkdown — analyses and refusals (AC3)", () => {
  it("should split paragraphs and lists, read checklists, cut a list at an indented call fence, and ignore comment lines", () => {
    expect(parsed("Étapes :\n1. Lire\n2. Écrire").map(fields)).toEqual([
      { type: "paragraph", text: "Étapes :", data: {} },
      { type: "list", text: null, data: { items: ["Lire", "Écrire"], ordered: true } },
    ])
    expect(parsed("* a\n+ b").map(fields)).toEqual([{ type: "list", text: null, data: { items: ["a", "b"] } }])
    expect(parsed("- [ ] a\n- [X] b").map(fields)).toEqual([
      { type: "checklist", text: null, data: { items: [{ text: "a", checked: false }, { text: "b", checked: true }] } },
    ])
    const steps = '1. Lis le contrat :\n   ```call\n   table.schema {"table": "ventes/suivi_prospects"}\n   ```\n2. Réserve des lignes :'
    expect(parsed(steps).map(fields)).toEqual([
      { type: "list", text: null, data: { items: ["Lis le contrat :"], ordered: true } },
      { type: "call", text: null, data: { function: "table.schema", args: { table: "ventes/suivi_prospects" } } },
      { type: "list", text: null, data: { items: ["Réserve des lignes :"], ordered: true, start: 2 } },
    ])
    expect(parsed("```call\ntable.schema\n```").map(fields)).toEqual([{ type: "call", text: null, data: { function: "table.schema", args: {} } }])
    const withRefs = '<!-- ref: 3f9a2c1b -->\nTexte.\n\n```reference\nventes/suivi\n```\n<!-- → page: Suivi (ventes/suivi) -->'
    expect(parsed(withRefs).map(fields)).toEqual([
      { type: "paragraph", text: "Texte.", data: {} },
      { type: "reference", text: null, data: { path: "ventes/suivi" } },
    ])
    expect(parsed("a\r\nb").map(fields)).toEqual([{ type: "paragraph", text: "a\nb", data: {} }])
  })

  it("should read hostile texts of the largest size a client sends in linear time (N70, security)", () => {
    // Textes qui faisaient tourner les anciennes expressions en temps quadratique ou cubique (revue 1 :
    // de 0,4 s à 11 s) ; en temps linéaire, chacun tient en quelques millisecondes.
    const [separator, n] = [String.fromCharCode(0x2028), 40_000]
    const parsed: [string, string][] = [
      ["heading, spaces", `## x${" ".repeat(n)}y`],
      ["heading, separator", `## ${" ".repeat(n)}x${separator}`],
      ["image", `![${"](".repeat(n / 2)}`],
      ["fence, separator", `${"`".repeat(n)}${separator}`],
      ["tildes, separator", `${"~".repeat(n / 2)}${"a".repeat(n / 2)}${separator}`],
      ["mermaid, spaces (btrim)", `\`\`\`mermaid\na${" ".repeat(n)}b\n\`\`\``],
    ]
    const linked: [string, string][] = [
      ["inline code", `a${"`".repeat(n / 2)}${"b".repeat(n / 2)}`],
      ["brackets", "[[".repeat(n / 2)],
    ]
    const within = (what: string, run: () => unknown) => {
      const started = performance.now()
      run()
      expect(performance.now() - started, what).toBeLessThan(250)
    }
    for (const [what, text] of parsed) within(what, () => parseMarkdown(text))
    for (const [what, text] of linked) {
      within(what, () => extractLinks([{ id: "b0", type: "paragraph", text, data: {}, key: null, position: 1, revision: 1, provenance: {} }]))
    }
    within("key through the API (btrim)", () => blockInputSchema.safeParse({ type: "paragraph", text: "x", key: `a${" ".repeat(250_000)}b` }))
  })

  it("should refuse each malformed text with the words of AC3, prefixed and ended as AC22", () => {
    const cases: [string, string][] = [
      ["Intro.\n\n```python\nx = 1", "a code fence opened on line 3 (```python) is never closed."],
      ["# Titre", "line 1 « # Titre » is the level of the page title; headings start at ##."],
      [`Intro\n#### ${"a".repeat(201)}`, "line 2: a heading holds 200 characters at most (201)."],
      ["a\n\nb\n\n```call\ntable.rows filter\n```", 'line 5: a call block holds <function> {"argument": …}; « table.rows filter » is not followed by a JSON object.'],
      ["a\n```reference\nVentes/X\n```", "line 2: a reference block holds a path such as ventes/relance_devis, then an optional JSON view; « Ventes/X » is not a path."],
      [Array.from({ length: 501 }, (_, index) => `- ${index}`).join("\n"), "line 1: a list holds 500 items at most, sub-items included (501)."],
    ]
    for (const [text, problem] of cases) {
      expect(refusal(text), problem).toMatchObject({
        code: "invalid_arguments",
        message: `Op 1 (add_section « S »): ${problem} Nothing was written.`,
      })
    }
  })
})

describe("parseMarkdown — page markdown forms read back (E10-S04)", () => {
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
