// @vitest-environment node
// Syntaxe des liens `[[…]]` et du code en ligne (M15), seul lecteur de la publication
// (`server/nodes/links.ts`) et de l'écran (`ui/noeud/en-ligne.ts`) : en temps linéaire sur ce qu'un
// rédacteur écrit (`security-patterns.md § Validation des inputs`). Ses règles se prouvent par ses deux
// lecteurs (`nodes-links.test.ts`, `ui-en-ligne.test.ts`).
import { describe, expect, it } from "vitest"
import { codeSpans, fencedParts, linksIn } from "../../../packages/plateforme/schemas/link-syntax"
import { cheminsCitesDans } from "../../../packages/plateforme/ui/noeud/en-ligne"

describe("link syntax (M15)", () => {
  it("should read hostile texts in linear time, 100 ms each at most (security)", () => {
    // 4 000 accents graves et 20 000 « [ » : les tailles où les expressions d'avant N70 prenaient des
    // secondes (revue d'E05-S02) ; puis, à la taille d'un bloc (100 000 caractères), les formes qui font
    // revenir en arrière une expression de ces syntaxes : des suites d'accents graves de toutes les
    // longueurs, des crochets ouvrants, des liens partout.
    const texts: [string, string][] = [
      ["4,000 backticks", "`".repeat(4_000)],
      ["20,000 opening brackets", "[".repeat(20_000)],
      ["backtick runs of every length", Array.from({ length: 445 }, (_, index) => "`".repeat(index + 1)).join("a")],
      ["100,000 opening brackets", "[".repeat(100_000)],
      ["a link everywhere", "[[a]]".repeat(20_000)],
      // Une suite d'accents graves suivie d'une fin de ligne que `.` ne lit pas : `(.*)$` après `{3,}` repartait de
      // chaque longueur de la suite (19 s pour une clôture de corps de repli, revue d'E10-S04).
      ["99,990 backticks then U+2028", "`".repeat(99_990) + "\u2028"],
      ["99,990 backticks then a carriage return", "`".repeat(99_990) + "\r"],
    ]
    for (const [what, text] of texts) {
      const started = performance.now()
      codeSpans(text)
      linksIn(text)
      fencedParts(text)
      expect(performance.now() - started, what).toBeLessThan(100)
    }
  })

  it("should read an escaped bar as the label separator, the form a table cell needs, for the publication and the screen alike", () => {
    const text = String.raw`[[ventes/devis\|Le devis]] et [[ventes/suivi#a1\|Suivi]]`
    expect(linksIn(text).map(({ link }) => link)).toEqual([
      { path: "ventes/devis", key: null, label: "Le devis" },
      { path: "ventes/suivi", key: "a1", label: "Suivi" },
    ])
    expect(cheminsCitesDans(text)).toEqual(["ventes/devis", "ventes/suivi"])
  })

  it("should not open a link on an escaped bracket, for the publication and the screen alike (E10-S04, AC-c2)", () => {
    const text = "\\[[ventes/devis]], \\\\[[ventes/suivi]] et \\\\\\[[ventes/x]]"
    expect(linksIn(text).map(({ link }) => link?.path)).toEqual(["ventes/suivi"])
    expect(cheminsCitesDans(text)).toEqual(["ventes/suivi"])
    const started = performance.now()
    linksIn(`${"\\".repeat(50_000)}${"[[".repeat(25_000)}`)
    expect(performance.now() - started, "backslashes then brackets").toBeLessThan(100)
  })

  it("should split a toggle body into text and fenced code, an unclosed fence running to the end (E10-S04, AC-a4)", () => {
    expect(fencedParts("a [[x]]\n```sql\n[[y]]\n```\nb\n~~~\nc")).toEqual([
      { code: false, text: "a [[x]]" },
      { code: true, text: "[[y]]", language: "sql" },
      { code: false, text: "b" },
      { code: true, text: "c", language: "" },
    ])
    expect(fencedParts("````\n```\n````")).toEqual([{ code: true, text: "```", language: "" }])
  })
})
