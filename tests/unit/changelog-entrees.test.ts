import { readdirSync, readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

// Le journal des changements : `docs/changelog.md` (l'historique, figé) et un fichier par entrée dans `docs/changelog.d/`,
// pour qu'aucune pull request n'en mette une autre en conflit. Chaque entrée ouvre sur son titre `## [date] — …`. Une
// entrée insérée par un script avant le titre d'une autre, qui remplaçait ce titre sans le réécrire, laissait deux « Quoi »
// sous un seul titre : l'entrée suivante perdait le sien, et rien ne le voyait.

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

/**
 * Les défauts d'un fichier de `docs/changelog.d/` : nommé `AAAA-MM-JJ-<sujet>.md` (lus par nom décroissant), une seule
 * entrée, ouverte en première ligne par `## [AAAA-MM-JJ] — <titre>` à la date du nom, avec son « Quoi ».
 */
function defautsDeLEntree(nom: string, texte: string): string[] {
  const date = /^(\d{4}-\d{2}-\d{2})-[a-z0-9][a-z0-9-]*\.md$/.exec(nom)?.[1]
  if (!date) return [`${nom} : nom hors de la forme AAAA-MM-JJ-<sujet>.md`]
  const lignes = texte.split(/\r?\n/)
  const defauts: string[] = []
  if (!lignes[0].startsWith(`## [${date}] — `)) defauts.push(`${nom} : la première ligne n'est pas « ## [${date}] — <titre> »`)
  if (lignes.filter((ligne) => ligne.startsWith("## ")).length !== 1) defauts.push(`${nom} : plus d'une entrée`)
  if (!lignes.some((ligne) => ligne.startsWith("**Quoi :**"))) defauts.push(`${nom} : aucun « Quoi »`)
  return defauts
}

describe("docs/changelog.md", () => {
  it("should open every entry with its heading: no « Quoi » follows another without a heading in between", () => {
    expect(quoiSansTitre(readFileSync("docs/changelog.md", "utf8"))).toEqual([])
  })

  // Figé au 2026-11-26 : une entrée ajoutée ici remettrait toutes les pull requests ouvertes en conflit.
  it("should stay frozen: no entry dated after 2026-11-26", () => {
    const apres = readFileSync("docs/changelog.md", "utf8")
      .split(/\r?\n/)
      .filter((ligne) => (/^## \[(\d{4}-\d{2}-\d{2})\]/.exec(ligne)?.[1] ?? "") > "2026-11-26")
    expect(apres, "docs/changelog.md est figé : écrivez un fichier dans docs/changelog.d/").toEqual([])
  })

  it("should find the « Quoi » of an entry whose heading was lost", () => {
    expect(quoiSansTitre("## [2026-10-19] — Une\n**Quoi :** a\n\n**Quoi :** b\n## [2026-10-18] — Deux\n**Quoi :** c")).toEqual([4])
  })
})

describe("docs/changelog.d", () => {
  it("should hold one entry per file, headed by the date of its name", () => {
    const noms = readdirSync("docs/changelog.d")
    expect(noms.flatMap((nom) => defautsDeLEntree(nom, readFileSync(`docs/changelog.d/${nom}`, "utf8")))).toEqual([])
  })

  it("should refuse a file misnamed, headed by another date, holding two entries or no « Quoi »", () => {
    const entree = "## [2026-11-26] — Sujet\n**Quoi :** a\n**Pourquoi :** b\n"
    const verdicts = {
      bonne: defautsDeLEntree("2026-11-26-sujet.md", entree).length,
      nom: defautsDeLEntree("sujet.md", entree).length,
      date: defautsDeLEntree("2026-11-25-sujet.md", entree).length,
      deux: defautsDeLEntree("2026-11-26-sujet.md", `${entree}\n## [2026-11-26] — Autre\n**Quoi :** c\n`).length,
      sansQuoi: defautsDeLEntree("2026-11-26-sujet.md", "## [2026-11-26] — Sujet\n**Pourquoi :** b\n").length,
    }
    expect(verdicts).toEqual({ bonne: 0, nom: 1, date: 1, deux: 1, sansQuoi: 1 })
  })
})
