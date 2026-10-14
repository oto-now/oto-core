// @vitest-environment node
// Les textes recollés par l'import d'une arborescence (`server/transfer/links.ts`) : les outils nommés avec le préfixe
// de l'organisation source pris par celui de l'arrivée, pour les six outils seulement et hors d'un nom plus long ; une
// cellule de tableau qui vaut exactement le chemin d'un nœud importé ; des textes hostiles lus en temps linéaire
// (`security-patterns.md § Validation des inputs`).
import { describe, expect, it } from "vitest"
import { procedureAdvice } from "../../packages/plateforme/server/procedure-advice"
import { decodeCursor } from "../../packages/plateforme/server/transfer/import-report"
import { relinkedCell, rewriteLinks, rewritePrefixes, toolPrefixesIn } from "../../packages/plateforme/server/transfer/links"

describe("rewritePrefixes", () => {
  it("should rename the six tools of the source prefix only, never inside a longer name", () => {
    const text = "Lire avec demo_read puis demo_write, demo_context d'abord ; demo_reader, xdemo_read et demo_readx restent, demo_call."
    expect(rewritePrefixes(text, "demo", "acme")).toEqual({
      text: "Lire avec acme_read puis acme_write, acme_context d'abord ; demo_reader, xdemo_read et demo_readx restent, acme_call.",
      count: 4,
    })
    expect(rewritePrefixes(text, "acme", "acme").count).toBe(0)
  })

  it("should read a hostile text in linear time", () => {
    const timeOf = (text: string) => {
      const start = performance.now()
      rewritePrefixes(text, "demo", "acme")
      return performance.now() - start
    }
    const hostile = (n: number) => "demo_".repeat(n / 5)
    timeOf(hostile(250_000))
    const quarter = Math.min(timeOf(hostile(250_000)), timeOf(hostile(250_000)))
    const whole = Math.min(timeOf(hostile(1_000_000)), timeOf(hostile(1_000_000)))
    expect(whole < 50 || whole / quarter < 10, `${whole.toFixed(0)} ms, ${(whole / quarter).toFixed(1)} times a quarter`).toBe(true)
  })
})

describe("toolPrefixesIn and procedureAdvice", () => {
  it("should find the prefixes that name two tools, or context or feedback, once each, never inside a longer name nor in a lone word like to_read", () => {
    expect(toolPrefixesIn("demo_read, demo_write, acme_call, beta_context ; node_reader, xdemo_readx, to_read, on_call")).toEqual(["demo", "beta"])
  })

  it("should read a hostile text in linear time", () => {
    const timeOf = (text: string) => {
      const start = performance.now()
      toolPrefixesIn(text)
      return performance.now() - start
    }
    const hostile = (n: number) => `${"a".repeat(19)}_`.repeat(n / 20)
    timeOf(hostile(250_000))
    const quarter = Math.min(timeOf(hostile(250_000)), timeOf(hostile(250_000)))
    const whole = Math.min(timeOf(hostile(1_000_000)), timeOf(hostile(1_000_000)))
    expect(whole < 50 || whole / quarter < 10, `${whole.toFixed(0)} ms, ${(whole / quarter).toFixed(1)} times a quarter`).toBe(true)
  })

  it("should warn about a procedure without « When to use it » and one naming tools with a prefix, and say nothing about a good one", () => {
    const block = (type: string, text: string) => ({ type, text })
    expect(procedureAdvice([block("heading", "Étapes"), block("paragraph", "Lire avec demo_read, puis demo_write.")])).toEqual([
      "Procedure: no part « When to use it » (or « Quand l'utiliser »): say when to use it, when not, and where to go instead (read path help, section procedures).",
      "Procedure: tools named with an organisation prefix (demo_…): write read, write, find, call without prefix, so the text stays right in another organisation.",
    ])
    expect(procedureAdvice([block("heading", "Quand l'utiliser"), block("paragraph", "Lire avec read.")])).toEqual([])
  })
})

describe("rewriteLinks and decodeCursor", () => {
  it("should rewrite a call argument only when it is exactly an imported path, a word like open never", () => {
    const relink = (path: string) => `csm/${path}`
    const exact = (path: string) => (path === "sav/clients" ? "csm/sav/clients" : null)
    const markdown = ["Voir [[sav/fiche]].", "```call", 'table.rows {"table":"sav/clients","filter":{"status":"open"}}', "```"].join("\n")
    expect(rewriteLinks(markdown, relink, () => {}, exact).split("\n")).toEqual([
      "Voir [[csm/sav/fiche]].",
      "```call",
      'table.rows {"table":"csm/sav/clients","filter":{"status":"open"}}',
      "```",
    ])
  })

  it("should refuse a continue_from whose places are not a map of paths, as a step not given by an answer", () => {
    const token = (cursor: unknown) => Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url")
    for (const placed of [null, [], { a: 1 }]) {
      expect(() => decodeCursor(token({ step: 3, placed }))).toThrow(/continue_from is not a step given by a previous answer/)
    }
    expect(decodeCursor(token({ step: 3, placed: { sav: "support/sav_2" } }))).toEqual({ step: 3, placed: { sav: "support/sav_2" } })
  })
})

describe("relinkedCell", () => {
  const exact = (path: string) => (path === "sav/fiche" ? "csm/sav/fiche" : null)
  const relink = (path: string) => (path.startsWith("sav/") ? `csm/${path}` : null)

  it("should rewrite a cell that is exactly an imported path, or a link in it, and leave any other text", () => {
    expect(relinkedCell("sav/fiche", exact, relink)).toEqual({ value: "csm/sav/fiche", changed: true })
    expect(relinkedCell("Voir [[sav/fiche|la fiche]].", exact, relink)).toEqual({ value: "Voir [[csm/sav/fiche|la fiche]].", changed: true })
    expect(relinkedCell("sav/inconnue", exact, relink)).toEqual({ value: "sav/inconnue", changed: false })
  })
})
