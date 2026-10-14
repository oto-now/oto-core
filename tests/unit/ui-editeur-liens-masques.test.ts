import { describe, expect, it } from "vitest"
import {
  appliquer,
  masquer,
  morceauxParLigne,
  sourceDe,
  sourceDeLaSelection,
  versSource,
  versVisible,
} from "../../packages/plateforme/ui/noeud/editeur/liens-masques"

// Les liens d'un champ réduits à leur titre pendant la frappe (story `liens-en-edition`), en fonctions pures : le
// texte montré (AC-1), les positions converties (AC-7), une frappe du texte montré rendue en frappe de la source (AC-3,
// AC-4, AC-5, AC-6), la source d'une sélection (AC-8). Le champ rendu se lit dans
// `tests/integration/components/liens-en-edition.test.tsx`.

/** La frappe d'un champ : le texte montré avant, la frappe jouée (remplacer `[debut, fin)` par `insere`), sa source d'arrivée. */
function taper(source: string, [debut, fin, insere]: [number, number, string], { retenus = new Map<string, string>(), parLigne = false } = {}) {
  const masque = masquer(source, parLigne)
  const nouveau = `${masque.visible.slice(0, debut)}${insere}${masque.visible.slice(fin)}`
  const ecrit = appliquer(masque, nouveau, debut + insere.length, retenus)
  return { ...ecrit, montre: masquer(ecrit.source, parLigne).visible, nouveau }
}

describe("masquer", () => {
  it("should show a labelled page link or web link by its title between its brackets, and keep its source", () => {
    const source = "Voir [[ventes/relance_devis|Relance des devis]] puis [[a/b#k|Ligne]] et [Le site](https://exemple.fr/page) !"
    const masque = masquer(source, false)
    expect(masque.visible).toBe("Voir [[Relance des devis]] puis [[Ligne]] et [Le site] !")
    expect(sourceDe(masque)).toBe(source)
  })

  it("should leave a link without label, a bare address, an address in angle brackets and code as they are", () => {
    const source = "a [[a/b]] b https://y.fr c <https://z.fr> d `[[a/b|T]]` e [[a/b|  ]]"
    expect(masquer(source, false).visible).toBe(source)
  })

  it("should read a list line by line, a code span opened on one line not hiding a link of the next", () => {
    const source = "un `code\n[[a/b|T]] deux`"
    expect(masquer(source, true).visible).toBe("un `code\n[[T]] deux`")
    expect(masquer(source, false).visible).toBe(source)
  })
})

describe("versSource et versVisible", () => {
  const masque = masquer("ab [[x/y|Titre]] cd", false)
  // Montré : « ab [[Titre]] cd » ; le lien de 3 à 12, son titre de 5 à 10 ; dans la source, le titre de 9 à 14.

  it("should map a letter of the title to the same letter, a bracket to the edge of the title, the edges of a link to its edges", () => {
    expect([0, 3, 4, 5, 7, 10, 11, 12, 15].map((place) => versSource(masque, place))).toEqual([0, 3, 9, 9, 11, 14, 14, 16, 19])
  })

  it("should map a hidden place of the source to the edge of the title", () => {
    expect([0, 3, 4, 8, 9, 11, 14, 15, 16, 19].map((place) => versVisible(masque, place))).toEqual([0, 3, 5, 5, 5, 7, 10, 10, 12, 15])
  })
})

describe("appliquer", () => {
  const source = "ab [[x/y|Titre]] cd"

  it("should write before `[[` and after `]]` outside the link, the path kept", () => {
    expect(taper(source, [3, 3, "Z"]).source).toBe("ab Z[[x/y|Titre]] cd")
    expect(taper(source, [12, 12, "Z"]).source).toBe("ab [[x/y|Titre]]Z cd")
  })

  it("should write between the brackets in the title, the path kept, the text shown being the text typed", () => {
    const debutDuTitre = taper(source, [5, 5, "Le "])
    expect(debutDuTitre.source).toBe("ab [[x/y|Le Titre]] cd")
    expect(debutDuTitre.montre).toBe(debutDuTitre.nouveau)
    expect(taper(source, [10, 10, "s"]).source).toBe("ab [[x/y|Titres]] cd")
    expect(taper(source, [6, 8, "OU"]).source).toBe("ab [[x/y|TOUre]] cd")
  })

  it("should read a `]` typed just before `]]` at the caret, and give the link back to its title as text", () => {
    const ecrit = taper(source, [10, 10, "]"])
    expect(ecrit.source).toBe("ab Titre] cd")
    expect(ecrit.curseur).toBe(9)
  })

  it.each(["|", "[", "\n"])("should give the link back to its title when %j is typed in it", (signe) => {
    expect(taper(source, [7, 7, signe]).source).toBe(`ab Ti${signe}tre cd`)
  })

  it("should remove the link whose whole title is erased, the caret where it was", () => {
    const ecrit = taper(source, [5, 10, ""])
    expect(ecrit.source).toBe("ab  cd")
    expect(ecrit.curseur).toBe(3)
  })

  it("should give the link back to its title when a bracket is erased, and its source back when the undo types it again", () => {
    const retenus = new Map<string, string>()
    const efface = taper(source, [11, 12, ""], { retenus })
    expect(efface.source).toBe("ab Titre cd")
    const annule = appliquer(masquer(efface.source, false), "ab [[Titre]] cd", 12, retenus)
    expect(annule.source).toBe(source)
  })

  it("should give the link back to its title under a selection astride, then apply the typing", () => {
    expect(taper(source, [1, 7, ""]).source).toBe("atre cd")
    expect(taper(source, [7, 14, "X"]).source).toBe("ab TiXd")
  })

  it("should carry a link away with the selection that covers it whole", () => {
    expect(taper(source, [2, 13, " "]).source).toBe("ab cd")
  })

  it("should reduce a link typed in full at its closing, the caret right after it", () => {
    const tape = "x [[a/b|T]"
    const ecrit = appliquer(masquer(tape, false), `${tape}]`, tape.length + 1, new Map())
    expect(ecrit.source).toBe("x [[a/b|T]]")
    expect(masquer(ecrit.source, false).visible).toBe("x [[T]]")
    expect(versVisible(masquer(ecrit.source, false), ecrit.curseur)).toBe(7)
  })

  it("should write in the title of a web link, its address kept", () => {
    expect(taper("[Site](https://x.fr) ok", [5, 5, "s"]).source).toBe("[Sites](https://x.fr) ok")
  })

  it("should keep each link of a list line, typing in another line", () => {
    const liste = "[[a/b|Un]]\n[[c/d|Deux]]"
    expect(taper(liste, [7, 7, "x"], { parLigne: true }).source).toBe("[[a/b|Un]]\nx[[c/d|Deux]]")
  })
})

describe("sourceDeLaSelection", () => {
  const masque = masquer("ab [[x/y|Titre]] cd", false)

  it("should copy a link selected whole with its source, and a piece of title as text", () => {
    expect(sourceDeLaSelection(masque, 0, 15)).toBe("ab [[x/y|Titre]] cd")
    expect(sourceDeLaSelection(masque, 6, 14)).toBe("itre c")
  })
})

describe("morceauxParLigne", () => {
  it("should split the pieces shown at each line, an empty line keeping its place", () => {
    const lignes = morceauxParLigne(masquer("[[a/b|Un]] x\n\ny [Site](https://x.fr)", true))
    expect(lignes.map((ligne) => ligne.map((morceau) => (morceau.genre === "texte" ? morceau.texte : morceau.libelle)))).toEqual([["Un", " x"], [], ["y ", "Site"]])
  })
})
