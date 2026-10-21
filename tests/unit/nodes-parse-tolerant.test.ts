// @vitest-environment node
// Le mode tolérant de l'analyse du markdown (E10-S01, AC-a2) : chaque construction que le mode strict refuse,
// gardée en texte (comptée dans `keptAsText`) ou ramenée à une forme admise ; le mode strict inchangé pour la
// même entrée ; `tolerant` porté par le corps de l'API seul, jamais par `write` ; le HTML d'un markdown importé
// rendu en texte échappé ; les textes hostiles de 1 000 000 caractères lus en temps linéaire.
import { createElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { writeNodeBodySchema, writeNodeSchema, type BlockInput } from "../../packages/plateforme/schemas"
import { parseMarkdown } from "../../packages/plateforme/server/nodes/markdown-parse"
import { applyOps } from "../../packages/plateforme/server/nodes/ops"
import { RenduDUnBloc } from "../../packages/plateforme/ui/noeud/rendu-des-blocs"
import { bloc } from "../helpers/noeud"
import { readingRatio } from "../helpers/temps-lineaire"

const fields = ({ type, text, data }: BlockInput) => ({ type, text: text ?? null, data })

function tolerant(text: string): { blocks: ReturnType<typeof fields>[]; kept: number } {
  const result = parseMarkdown(text, { tolerant: true })
  if ("problem" in result) throw new Error(result.problem)
  return { blocks: result.blocks.map(fields), kept: result.keptAsText ?? -1 }
}

function strictProblem(text: string): string | null {
  const result = parseMarkdown(text)
  return "problem" in result ? result.problem : null
}

const items = (count: number, from = 1) => Array.from({ length: count }, (_, index) => `i${index + from}`)
const tableLines = (columns: number, rows: number) => [
  `| ${Array.from({ length: columns }, (_, index) => `c${index}`).join(" | ")} |`,
  `| ${Array.from({ length: columns }, () => "---").join(" | ")} |`,
  ...Array.from({ length: rows }, () => `| ${Array.from({ length: columns }, () => "x").join(" | ")} |`),
]

describe("parseMarkdown in tolerant mode (AC-a2)", () => {
  it("should keep a malformed call or reference fence as a code block of its text, counted", () => {
    expect(tolerant("```call\nnot json {\n```\n\n```reference\nPas Un Chemin\n```")).toEqual({
      blocks: [
        { type: "code", text: "not json {", data: {} },
        { type: "code", text: "Pas Un Chemin", data: {} },
      ],
      kept: 2,
    })
  })

  it("should drop an empty mermaid fence, and keep a fence never closed as code to the end of the text", () => {
    expect(tolerant("```mermaid\n```\nApres")).toEqual({ blocks: [{ type: "paragraph", text: "Apres", data: {} }], kept: 0 })
    expect(tolerant("Avant\n\n```js\nx = 1\n\ny = 2")).toEqual({
      blocks: [
        { type: "paragraph", text: "Avant", data: {} },
        { type: "code", text: "x = 1\n\ny = 2", data: { language: "js" } },
      ],
      kept: 1,
    })
    expect(tolerant("```call\nx")).toEqual({ blocks: [{ type: "code", text: "x", data: {} }], kept: 1 })
  })

  it("should read # as a heading of level 1, even under a line of text (C5), and keep a heading too long as a paragraph", () => {
    expect(tolerant("# Titre\ntexte\n# Suite")).toEqual({
      blocks: [
        { type: "heading", text: "Titre", data: { level: 1 } },
        { type: "paragraph", text: "texte", data: {} },
        { type: "heading", text: "Suite", data: { level: 1 } },
      ],
      kept: 0,
    })
    const long = `## ${"t".repeat(201)}`
    expect(tolerant(long)).toEqual({ blocks: [{ type: "paragraph", text: long, data: {} }], kept: 1 })
    expect(tolerant("####### sept")).toEqual({ blocks: [{ type: "paragraph", text: "####### sept", data: {} }], kept: 0 })
  })

  it("should keep an image whose source is too long as a paragraph", () => {
    const image = `![plan](https://x.test/${"a".repeat(2_000)})`
    expect(tolerant(image)).toEqual({ blocks: [{ type: "paragraph", text: image, data: {} }], kept: 1 })
  })

  it("should split a list of more than 500 items into lists of 500 at most, numbers following", () => {
    const bullets = tolerant(items(1_001).map((item) => `- ${item}`).join("\n"))
    // Des listes lues : leurs données portent leurs éléments, que `fields` rend sans type.
    expect(bullets.blocks.map((one) => (one.data as { items: string[] }).items.length)).toEqual([500, 500, 1])
    const numbered = tolerant(items(501).map((item, index) => `${index + 1}. ${item}`).join("\n"))
    expect(numbered.blocks.map((one) => one.data)).toEqual([
      { items: items(500), ordered: true },
      { items: ["i501"], ordered: true, start: 501 },
    ])
    expect(numbered.kept).toBe(0)
  })

  it("should keep a simple table out of the bounds of E10-S04 as a code block of its lines", () => {
    for (const lines of [tableLines(21, 1), tableLines(2, 201), [...tableLines(2, 1), "| a | b | c |"]]) {
      expect(tolerant(lines.join("\n")), lines[0]).toEqual({ blocks: [{ type: "code", text: lines.join("\n"), data: {} }], kept: 1 })
    }
  })

  it("should bring items nested deeper than three levels back to the third level", () => {
    const text = "- a\n  - b\n    - c\n      - d\n        - e\n      suite de d"
    expect(tolerant(text)).toEqual({
      blocks: [{ type: "list", text: null, data: { items: [{ text: "a", children: { items: [{ text: "b", children: { items: ["c", "d", "e\nsuite de d"] } }] } }] } }],
      kept: 0,
    })
  })

  it("should keep a toggle inside a toggle in the body of the outer one, without its details lines", () => {
    const text = "<details>\n<summary>Dehors</summary>\n\navant\n<details>\n<summary>Dedans</summary>\ncorps\n</details>\napres\n\n</details>"
    expect(tolerant(text)).toEqual({ blocks: [{ type: "toggle", text: "avant\n<summary>Dedans</summary>\ncorps\napres", data: { summary: "Dehors" } }], kept: 0 })
  })

  it("should read --- right under a line of text as a divider", () => {
    expect(tolerant("texte\n---\nsuite")).toEqual({
      blocks: [
        { type: "paragraph", text: "texte", data: {} },
        { type: "divider", text: null, data: {} },
        { type: "paragraph", text: "suite", data: {} },
      ],
      kept: 0,
    })
  })

  it("should refuse the same inputs without the tolerant mode, as before", () => {
    expect(strictProblem("# Titre")).toBe("line 1 « # Titre » is the level of the page title; headings start at ##.")
    expect(strictProblem("```js\nx")).toBe("a code fence opened on line 1 (```js) is never closed.")
    expect(strictProblem(tableLines(21, 1).join("\n"))).toBe("line 1: a table holds 20 columns at most (21).")
    expect(strictProblem("texte\n---")).toBeNull()
    expect(parseMarkdown("texte\n---")).toEqual({ blocks: [{ type: "paragraph", text: "texte\n---", data: {} }], lines: [1] })
  })
})

describe("the tolerant mode through write (AC-a2)", () => {
  it("should count what the operations kept as text, only when asked", () => {
    const ops = [{ op: "insert_after" as const, text: "# Titre\n\n```call\nx {\n```" }]
    expect(applyOps([], ops, { path: "ventes/cr", tolerant: true }).keptAsText).toBe(1)
    expect(() => applyOps([], ops, { path: "ventes/cr" })).toThrow("Op 1 (insert_after): line 1 « # Titre » is the level of the page title; headings start at ##. Nothing was written.")
  })

  it("should carry tolerant in the body of the API only: the input of write drops it", () => {
    const body = { path: "ventes/cr", tolerant: true }
    expect(writeNodeBodySchema.parse(body)).toEqual(body)
    expect(writeNodeSchema.parse(body)).toEqual({ path: "ventes/cr" })
  })

  it("should render the HTML of an imported markdown as escaped text", () => {
    const [block] = tolerant('<script>alert(1)</script>\n<img src=x onerror="alert(2)">').blocks
    const Lien = ({ href, children }: { href: string; children?: ReactNode }) => createElement("a", { href }, children)
    const html = renderToStaticMarkup(createElement(RenduDUnBloc, { bloc: bloc("00000001-0000-4000-8000-000000000000", "paragraph", block.text), Lien, hrefDuChemin: (chemin: string) => `/n/${chemin}` }))
    expect(html).not.toContain("<script")
    expect(html).not.toContain("<img")
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;")
  })
})

const readTolerant = (text: string) => parseMarkdown(text, { tolerant: true })

describe("hostile texts of 1,000,000 characters in tolerant mode (security-patterns.md § Validation des inputs)", () => {
  const size = 1_000_000
  const hostile: [string, (n: number) => string][] = [
    ["backticks", (n) => "`".repeat(n)],
    ["a fence never closed", (n) => `\`\`\`\n${"a\n".repeat(n / 2)}`],
    ["nested details", (n) => "<details>\n<summary>s</summary>\n".repeat(n / 30)],
    ["ever deeper items", (n) => Array.from({ length: 900 }, (_, depth) => `${" ".repeat(depth * 2)}- x`).join("\n").padEnd(n, "\n")],
    ["a wide table", (n) => `| ${"a | ".repeat(n / 4)}\n| ${"--- | ".repeat(10)}`],
    ["a long heading", (n) => `# ${"t".repeat(n)}`],
    ["dashes under text", (n) => "t\n---\n".repeat(n / 6)],
  ]
  // Un bloc de plus de 100 000 caractères reste refusé, même gardé en code : un texte d'opération en porte 40 000 au plus.
  it("should read every hostile text in linear time", () => {
    const verdicts = Object.fromEntries(
      hostile.map(([what, text]) => {
        const { whole, ratio, linear } = readingRatio(readTolerant, text(size / 4), text(size))
        return [what, linear ? "linear" : `${whole.toFixed(0)} ms for ${size} characters, ${ratio.toFixed(1)} times the time of a quarter`]
      }),
    )
    expect(verdicts).toEqual(Object.fromEntries(hostile.map(([what]) => [what, "linear"])))
  })
})
