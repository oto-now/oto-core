// @vitest-environment node
// L'aller-retour d'une page par son fichier `.md` (E10-S01, AC-a6) : chaque cas valide de `DOCUMENT_CASES` que
// l'analyse produit (hors `reference`, qu'elle ignore, et `row`), sans clé ni donnée libre, cas d'E10-S04 compris,
// exporté (`pageMarkdown`, AC-a5), puis lu comme un fichier importé (`readPageMarkdown`, AC-a3) et analysé en mode
// tolérant : le même titre, les mêmes blocs, rien de gardé en texte. Et la lecture d'un fichier : titre, résumé,
// morceaux (AC-a3).
import { describe, expect, it } from "vitest"
import { blockInputSchema, OP_TEXT_MAX, PAGE_MAX, pageMarkdown, readPageMarkdown, renderBlocks, type BlockInput } from "../../packages/plateforme/schemas"
import { parseMarkdown } from "../../packages/plateforme/server/nodes/markdown-parse"
import { DOCUMENT_CASES } from "../helpers/block-cases"
import { TEMPS_LINEAIRE_MS } from "../helpers/temps-lineaire"

const fields = (block: { type: string; text?: string | null; data?: unknown }) => ({ type: block.type, text: block.text ?? null, data: block.data ?? {} })

/** Les blocs d'un texte, lus comme le fait `write` (strict) ou l'import de l'écran (tolérant). */
function blocksOf(text: string, tolerant: boolean): { blocks: BlockInput[]; kept: number } | null {
  const parsed = parseMarkdown(text, { tolerant })
  return "problem" in parsed ? null : { blocks: parsed.blocks, kept: parsed.keptAsText ?? 0 }
}

/** Un cas que l'analyse produit : son rendu relu par `write` le redonne à l'identique (sans clé, sans donnée libre). */
const produced = DOCUMENT_CASES.flatMap(({ name, valid, block: raw }) => {
  if (!valid || raw.key !== undefined || raw.type === "reference") return []
  const block = blockInputSchema.parse(raw)
  const back = blocksOf(renderBlocks([block]), false)
  const same = back !== null && back.blocks.length === 1 && JSON.stringify(fields(back.blocks[0])) === JSON.stringify(fields(block))
  return same ? [{ name, block }] : []
})

describe("a page exported to .md and imported back (AC-a6)", () => {
  it("should cover the block types the analysis produces, those of E10-S04, the attached file of E10-S02 and the embed of 1.4.3 included", () => {
    const types = new Set(produced.map(({ block }) => String(block.type)))
    expect([...types].sort()).toEqual(["callout", "checklist", "code", "divider", "heading", "image", "list", "mermaid", "paragraph", "simple_table", "toggle", "call", "file", "embed"].sort())
  })

  // Une table de cas en un test (DG1) : le différentiel de `toEqual` nomme les cas fautifs.
  it("should give back the title and every produced case, nothing kept as text", () => {
    const title = "Compte rendu du 29 septembre"
    const roundTrip = (block: BlockInput) => {
      const file = readPageMarkdown(pageMarkdown(title, [block]), "export.md")
      const back = file.chunks.map((chunk) => blocksOf(chunk, true))
      return { title: file.title, kept: back.map((one) => one?.kept), blocks: back[0]?.blocks.map(fields) }
    }
    expect(Object.fromEntries(produced.map(({ name, block }) => [name, roundTrip(block)]))).toEqual(
      Object.fromEntries(produced.map(({ name, block }) => [name, { title, kept: [0], blocks: [fields(block)] }])),
    )
  })
})

describe("readPageMarkdown (AC-a3)", () => {
  it("should take the first # heading outside a fence as the title, removed from the body, and the plain text of the first paragraph as the summary", () => {
    const text = "```\n# pas le titre\n```\n\nIntro **en gras**, [un lien](https://x.test) et `du code`.\nSuite.\n\n# Réunion du lundi\n\n## Décisions\n- Relancer"
    expect(readPageMarkdown(text, "cr.md")).toEqual({
      title: "Réunion du lundi",
      summary: "Intro en gras, un lien et du code. Suite.",
      chunks: ["```\n# pas le titre\n```\n\nIntro **en gras**, [un lien](https://x.test) et `du code`.\nSuite.\n\n## Décisions\n- Relancer"],
    })
  })

  it("should fall back on the file name and « Importé de <nom> », both cut at 200 characters", () => {
    expect(readPageMarkdown("- une liste\n\n> une citation", "Compte rendu.md")).toMatchObject({ title: "Compte rendu", summary: "Importé de Compte rendu.md" })
    const long = readPageMarkdown(`# ${"t".repeat(300)}\n\n${"r".repeat(300)}`, "x.md")
    expect([long.title.length, long.summary.length]).toEqual([200, 200])
  })

  it("should cut the body in pieces of 40,000 characters at most, at an empty line outside a fence", () => {
    const paragraph = "p".repeat(15_000)
    const fence = `\`\`\`\n${"c".repeat(10_000)}\n\n${"c".repeat(10_000)}\n\`\`\``
    const { chunks } = readPageMarkdown([paragraph, paragraph, fence, paragraph].join("\n\n"), "long.md")
    expect(chunks).toEqual([`${paragraph}\n\n${paragraph}`, `${fence}\n\n${paragraph}`])
    expect(chunks.every((chunk) => chunk.length <= OP_TEXT_MAX)).toBe(true)
  })

  // E11-S18 (AC-9) : un frontmatter YAML de tête n'est ni le résumé ni le corps.
  it("should drop a YAML front matter, take title and summary from it, and remove the # heading that repeats its title", () => {
    const text = ["---", "titre: Guide de l'atelier", 'résumé: "Monter et régler le poste."', "version: 3", "tags:", "  - atelier", "---", "", "# Guide de l'atelier", "", "Ce guide explique le montage.", "", "## Première section", "", "Texte."].join("\n")
    expect(readPageMarkdown(text, "guide.md")).toEqual({
      title: "Guide de l'atelier",
      summary: "Monter et régler le poste.",
      chunks: ["Ce guide explique le montage.\n\n## Première section\n\nTexte."],
    })
  })

  it("should take the summary from the first real paragraph when the front matter has none, and keep a leading divider that opens no front matter", () => {
    const fronted = readPageMarkdown("---\nversion: 3\n...\n# Guide\n\nCe guide explique le montage.", "guide.md")
    expect(fronted).toEqual({ title: "Guide", summary: "Ce guide explique le montage.", chunks: ["Ce guide explique le montage."] })
    expect(readPageMarkdown("---\n\nUn texte.\n\n---", "note.md").chunks).toEqual(["---\n\nUn texte.\n\n---"])
  })

  // Revue E11-S18 (HN-E11S18-9) : un commentaire après la valeur, un bloc littéral non lu.
  it("should read a quoted title before a comment, and ignore a literal block title", () => {
    expect(readPageMarkdown('---\ntitle: "Guide" # à revoir\nsummary: Le montage # brouillon\n---\n\nTexte.', "g.md")).toMatchObject({ title: "Guide", summary: "Le montage" })
    expect(readPageMarkdown("---\ntitle: |\n  Guide\n  sur deux lignes\n---\n\nCe guide explique le montage.", "guide.md")).toMatchObject({
      title: "guide",
      summary: "Ce guide explique le montage.",
    })
  })
})

describe("readPageMarkdown on a hostile text (security-patterns.md § Validation des inputs)", () => {
  it("should read a # line of spaces ended by a line separator in linear time, without taking it as the title", () => {
    const text = `#${" ".repeat(PAGE_MAX - 2)}${String.fromCodePoint(0x2028)}`
    const start = performance.now()
    const file = readPageMarkdown(text, "hostile.md")
    expect(performance.now() - start).toBeLessThan(TEMPS_LINEAIRE_MS)
    expect(file.title).toBe("hostile")
  })

  it("should read a front matter line of spaces ended by a line separator, or a key without colon, in linear time", () => {
    const separator = String.fromCodePoint(0x2028)
    for (const line of [`titre:${" ".repeat(PAGE_MAX - 20)}${separator}`, `${"cle ".repeat(PAGE_MAX / 4 - 5)}`]) {
      const start = performance.now()
      readPageMarkdown(`---\n${line}\n---\n\nTexte.`, "hostile.md")
      expect(performance.now() - start).toBeLessThan(TEMPS_LINEAIRE_MS)
    }
  })
})
