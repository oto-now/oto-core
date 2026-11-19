import { describe, expect, it } from "vitest"
import type { TreeNode } from "@otomata_tech/oto_platform/schemas"
import { destinationsDuDeplacement, noeudsDArbreDepuis, sectionsDeLArbre } from "../../packages/plateforme/ui/arbre/depuis-l-arbre"

// L'arbre visible servi par `visibleTree` (E03-S03, AC36) en données de l'écran de nœud (E05-S02,
// AC1, AC20) : sections d'équipes de P39 et nouveaux parents d'un déplacement.

const noeud = (path: string, kind: TreeNode["kind"], title: string, children: TreeNode[] = []): TreeNode => ({ path, kind, title, status: "published", children })

// L'arbre de Claire, membre de Ventes : Support n'est pas partagé ; `support/faq` l'est, sans son dossier.
const ARBRE: TreeNode[] = [
  noeud("guide", "page", "Guide de Démo", [
    noeud("conseil", "page", "Conseil", [noeud("conseil/grille", "page", "Grille tarifaire")]),
    noeud("contexte", "context", "Contexte de l'organisation"),
    noeud("private", "page", "Espaces personnels", [
      noeud("private/claire", "page", "Perso", [noeud("private/claire/contexte", "context", "Contexte"), noeud("private/claire/notes", "page", "Notes")]),
      // L'espace de Léa, qu'une règle partage à Claire : une ligne, ses pages dessous.
      noeud("private/lea", "page", "Perso de Léa", [noeud("private/lea/brouillons", "page", "Brouillons")]),
    ]),
    noeud("support/faq", "page", "FAQ"),
    noeud("ventes", "page", "Ventes", [
      noeud("ventes/contexte", "context", "Contexte"),
      noeud("ventes/modele_relance", "page", "Modèle de relance", [noeud("ventes/modele_relance/exemple", "page", "Exemple")]),
      noeud("ventes/suivi", "table", "Suivi"),
    ]),
  ]),
]
const EQUIPES = [
  { slug: "ventes", name: "Ventes" },
  { slug: "support", name: "Support" },
]

describe("sectionsDeLArbre (AC1)", () => {
  it("should give Tout le monde, the teams by name, then Privé, each opened by its Contexte, with neither root, team folder nor own personal space as a line", () => {
    const sections = sectionsDeLArbre(ARBRE, EQUIPES, "claire")
    expect(sections.map((section) => [section.titre, section.noeuds.map((une) => une.chemin)])).toEqual([
      ["Tout le monde", ["contexte", "conseil"]],
      ["Support", ["support/faq"]],
      ["Ventes", ["ventes/contexte", "ventes/modele_relance", "ventes/suivi"]],
      ["Privé", ["private/claire/contexte", "private/claire/notes", "private/lea"]],
    ])
    expect(sections[3].noeuds[2].enfants?.map((une) => une.chemin)).toEqual(["private/lea/brouillons"])
    expect(sections[0].noeuds[0]).toEqual({ chemin: "contexte", titre: "Contexte", nature: "contexte" })
    expect(sections[2].noeuds[2].nature).toBe("tableau")
    expect(sectionsDeLArbre([noeud("guide", "page", "Guide")], EQUIPES, "claire")).toEqual([])
  })

  it("should put after Privé, by name and marked, the teams the person is not a member of, when the host names her teams, and change nothing without them", () => {
    const equipes = [...EQUIPES, { slug: "finance", name: "Finance" }]
    const arbre = [noeud("guide", "page", "Guide de Démo", [...ARBRE[0].children, noeud("finance/mandat", "page", "Mandat")])]

    const rangees = sectionsDeLArbre(arbre, equipes, "claire", ["ventes"])

    expect(rangees.map((section) => [section.titre, section.invite ?? false])).toEqual([
      ["Tout le monde", false],
      ["Ventes", false],
      ["Privé", false],
      ["Finance", true],
      ["Support", true],
    ])
    // Sans les équipes de la personne : l'ordre d'avant, aucune section marquée.
    expect(sectionsDeLArbre(arbre, equipes, "claire").map((section) => [section.titre, section.invite ?? false])).toEqual([
      ["Tout le monde", false],
      ["Finance", false],
      ["Support", false],
      ["Ventes", false],
      ["Privé", false],
    ])
  })

  it("should keep the children of a node, natures mapped", () => {
    expect(noeudsDArbreDepuis([noeud("conseil", "procedure", "Conseil", [noeud("conseil/suivi", "table", "Suivi")])])).toEqual([
      { chemin: "conseil", titre: "Conseil", nature: "procedure", enfants: [{ chemin: "conseil/suivi", titre: "Suivi", nature: "tableau" }] },
    ])
  })
})

describe("destinationsDuDeplacement (AC20)", () => {
  it("should offer the root, then the visible nodes by path, without the node, its descendants, its parent nor private", () => {
    expect(destinationsDuDeplacement(ARBRE, "ventes/modele_relance").map((une) => une.chemin)).toEqual([
      "",
      "conseil",
      "conseil/grille",
      "contexte",
      "private/claire",
      "private/claire/contexte",
      "private/claire/notes",
      "private/lea",
      "private/lea/brouillons",
      "support/faq",
      "ventes/contexte",
      "ventes/suivi",
    ])
    expect(destinationsDuDeplacement(ARBRE, "ventes/modele_relance")[0]).toEqual({ chemin: "", titre: "Racine de l'arbre" })
    // Un nœud de premier niveau : sa racine est son parent actuel.
    expect(destinationsDuDeplacement(ARBRE, "conseil").map((une) => une.chemin)).not.toContain("")
  })
})
