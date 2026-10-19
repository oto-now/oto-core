import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

// Le journal des changements (`docs/changelog.md`) : chaque entrée ouvre sur son titre `## [date] — …`. Une entrée insérée
// par un script avant le titre d'une autre, qui remplaçait ce titre sans le réécrire, laissait deux « Quoi » sous un seul
// titre : l'entrée suivante perdait le sien, et rien ne le voyait.

/** Les « Quoi » d'une entrée qui suivent un autre « Quoi » sans titre entre les deux, par numéro de ligne. */
function quoiSansTitre(texte: string): number[] {
  let titre = true
  const orphelins: number[] = []
  texte.split(/\r?\n/).forEach((ligne, rang) => {
    if (ligne.startsWith("## ")) titre = true
    else if (ligne.startsWith("**Quoi :**")) {
      if (!titre) orphelins.push(rang + 1)
      titre = false
    }
  })
  return orphelins
}

describe("docs/changelog.md", () => {
  it("should open every entry with its heading: no « Quoi » follows another without a heading in between", () => {
    expect(quoiSansTitre(readFileSync("docs/changelog.md", "utf8"))).toEqual([])
  })

  it("should find the « Quoi » of an entry whose heading was lost", () => {
    expect(quoiSansTitre("## [2026-10-19] — Une\n**Quoi :** a\n\n**Quoi :** b\n## [2026-10-18] — Deux\n**Quoi :** c")).toEqual([4])
  })
})
