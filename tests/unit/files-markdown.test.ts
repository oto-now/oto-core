// @vitest-environment node
// Le markdown des fichiers joints (E10-S02 lot d, AC-d1) : le rendu de l'image jointe et du bloc `file`, relatif ou sur
// l'origine que `read` donne, à l'adresse d'un fichier (`/f/<id>`), et leur relecture par `parseMarkdown`, de toute
// origine, l'ancienne adresse comprise (aller-retour, ADR-011 § 5 ; fichiers et stockage, § Adresse unique) ; un
// lien ordinaire reste un paragraphe ; une étiquette écrite à la main donne des métadonnées provisoires, que `writeNode`
// remplace (AC-d3) ; un texte hostile se lit en temps linéaire (`security-patterns.md § Validation des inputs`).
import { describe, expect, it } from "vitest"
import { PAGE_MAX, renderBlock, renderBlocks, type BlockInput } from "../../packages/plateforme/schemas"
import { fileSizeText } from "../../packages/plateforme/schemas/files"
import { parseMarkdown } from "../../packages/plateforme/server/nodes/markdown-parse"
import { TEMPS_LINEAIRE_MS } from "../helpers/temps-lineaire"

const IMAGE = "f1000000-0000-4000-8000-000000000001"
const FILE = "f2000000-0000-4000-8000-000000000002"
const ORIGIN = "https://acme.oto.test/f"

const report: BlockInput = { type: "file", text: null, data: { file_id: FILE, name: "Rapport (v2) ](final).pdf", size: 1_234_567, mime: "application/pdf" } }
const plan: BlockInput = { type: "image", text: null, data: { file_id: IMAGE, alt: "Plan du site" } }

/** Les blocs d'un texte lu comme `write` le lit (strict). */
function blocksOf(text: string): BlockInput[] {
  const parsed = parseMarkdown(text)
  if ("problem" in parsed) throw new Error(parsed.problem)
  return parsed.blocks
}

describe("markdown of attached files (AC-d1)", () => {
  it("should render an internal image and a file on the route given, relative without one", () => {
    expect(renderBlocks([plan, report], { fileRoute: ORIGIN })).toBe(
      `![Plan du site](${ORIGIN}/${IMAGE})\n\n[Rapport (v2) ](final).pdf (1,234,567 bytes, pdf)](${ORIGIN}/${FILE})`,
    )
    expect(renderBlock(report)).toBe(`[Rapport (v2) ](final).pdf (1,234,567 bytes, pdf)](/f/${FILE})`)
    expect([fileSizeText(1), fileSizeText(2)]).toEqual(["1 byte", "2 bytes"])
  })

  it("should give the extension of a host type as the type of its line, never its mime; the mime of a name without extension (lot 1b)", () => {
    const dxf: BlockInput = { type: "file", text: null, data: { file_id: FILE, name: "Plan RDC.DXF", size: 1200, mime: "image/vnd.dxf" } }
    const bare: BlockInput = { type: "file", text: null, data: { file_id: FILE, name: "plan", size: 1200, mime: "image/vnd.dxf" } }
    expect([renderBlock(dxf), renderBlock(bare)]).toEqual([`[Plan RDC.DXF (1,200 bytes, dxf)](/f/${FILE})`, `[plan (1,200 bytes, image/vnd.dxf)](/f/${FILE})`])
  })

  it("should read both forms back from any origin, the old address included, identical", () => {
    const routes: [string, string][] = [
      ["the origin of read", ORIGIN],
      ["another origin", "http://localhost:3000/f"],
      ["no origin", "/f"],
      ["the old address", "/api/platform/files"],
      ["the old address on an origin", "https://acme.oto.test/api/platform/files"],
    ]
    const verdicts = Object.fromEntries(routes.map(([name, route]) => [name, blocksOf(renderBlocks([plan, report], { fileRoute: route }))]))
    expect(verdicts).toEqual(Object.fromEntries(routes.map(([name]) => [name, [plan, report]])))
  })

  it("should take the uuid in lower case, give a hand-written label provisional metadata, and keep an ordinary link as a paragraph", () => {
    expect(blocksOf(`![](${ORIGIN}/${IMAGE.toUpperCase()})`)).toEqual([{ type: "image", text: null, data: { file_id: IMAGE, alt: "" } }])
    expect(blocksOf(`[le rapport](/api/platform/files/${FILE})`)).toEqual([
      { type: "file", text: null, data: { file_id: FILE, name: "le rapport", size: 1, mime: "application/octet-stream" } },
    ])
    for (const text of [`[x](https://acme.oto.test/api/platform/public/jeton/files/${FILE})`, "[x](https://example.com/rapport.pdf)", `[x](/api/platform/files/${FILE}/html)`, `[x](/f/${FILE}/html)`, `[x](/api/platform/f/${FILE})`, `[x](/fx/${FILE})`]) {
      expect(blocksOf(text)).toEqual([{ type: "paragraph", text, data: {} }])
    }
  })

  it("should read a hostile line of brackets in linear time", () => {
    const line = `[${"](".repeat(Math.floor((PAGE_MAX - 60) / 2))}](/api/platform/files/${FILE})`
    const start = performance.now()
    const blocks = blocksOf(line)
    expect(performance.now() - start).toBeLessThan(TEMPS_LINEAIRE_MS)
    expect(blocks.map((block) => block.type)).toEqual(["file"])
  })
})
