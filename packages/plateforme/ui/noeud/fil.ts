// Le fil d'un nœud en données (E05-S02, AC2 ; E05-S09, partie c1) : la section de son premier segment (une
// équipe, Perso, sinon Tout le monde), ses ancêtres visibles sous le dossier d'équipe ou l'espace de la
// personne, puis le nœud ; chaque maillon avec ses frères, ceux de la liste qui le range dans l'arbre du
// rail (le maillon de section : les sections, chacune menant à son Contexte). Fonctions pures, calculées
// par l'écran serveur ; le fil client n'y ajoute que la navigation. Sans elles, le fil ne dit ni où l'on
// est ni par où passer au voisin.
//
// Porté d'oto-frontend (`components/noeud/fil-du-noeud.tsx`) : chaque maillon ouvre ses frères, le courant
// coché ; un frère sans destination reste affiché, inerte. Changé : les frères se lisent dans l'arbre
// visible (`sectionsDeLArbre`, l'ordre du rail), un espace mène à son Contexte (aucune page de section).
import type { NodeView, TreeNode } from "../../schemas"
import { PERSO, SECTION_PERSO, sectionsDeLArbre, titreDeContexte, titresParChemin, TOUT_LE_MONDE } from "../arbre/depuis-l-arbre"
import type { NatureDeNoeud, NoeudDArbre, SectionCle } from "../arbre/types"
import type { PorteeDEspace } from "./glyphes"

type Equipes = readonly { slug: string; name: string }[]

export type GlypheDuFil = { nature: NatureDeNoeud } | { portee: PorteeDEspace }

/** Un frère d'un maillon : une ligne de son menu ; `href` nul, il reste affiché sans mener nulle part. */
export type FrereDuFil = { id: string; libelle: string; glyphe: GlypheDuFil; choisi: boolean; href: string | null }

/** Un maillon : sans frère, il reste un bouton inerte ; sans glyphe, sa nature n'est pas connue (nœud invisible). */
export type MaillonDuFil = { id: string; libelle: string; glyphe: GlypheDuFil | null; courant: boolean; freres: FrereDuFil[] }

/** La section d'un chemin : sa clé (`null` quand les équipes sont illisibles : rien n'est deviné), son titre, le rang du premier ancêtre maillon. */
type SectionDuChemin = { cle: string | null; titre: string; debut: number }

export function porteeDeLaSection(cle: string): PorteeDEspace {
  if (cle === "") return "all"
  return cle === PERSO ? "private" : "equipe"
}

/**
 * L'espace d'un nœud tel que « Partager · <espace> » le dit : celui qui est écrit sur le nœud (son propriétaire), pas
 * la section de son chemin, qui n'est que son adresse (décidé avec JB le 03/11) : une page Privée rangée dans un dossier
 * de Tout le monde reste « Privé ».
 */
export function espaceDuNoeud(owner: NodeView["owner"]): { titre: string; portee: PorteeDEspace } {
  if (owner.kind === "team") return { titre: owner.teamName ?? "Équipe", portee: "equipe" }
  if (owner.kind === "user") return { titre: owner.you ? SECTION_PERSO : `${SECTION_PERSO} de ${owner.userName ?? "son auteur"}`, portee: "private" }
  return { titre: TOUT_LE_MONDE, portee: "all" }
}

/**
 * La section d'un chemin : Perso (l'espace de la personne n'est pas un maillon), l'équipe de son dossier (le
 * dossier non plus), sinon Tout le monde. Équipes illisibles : le premier segment tel quel.
 */
export function sectionDuChemin(chemin: string, equipes: Equipes | null, handle: string | null): SectionDuChemin {
  const segments = chemin.split("/")
  if (segments[0] === PERSO) return { cle: PERSO, titre: SECTION_PERSO, debut: handle !== null && segments[1] === handle ? 2 : 1 }
  if (equipes === null) return { cle: null, titre: segments[0], debut: 1 }
  const equipe = equipes.find((une) => une.slug === segments[0])
  return equipe ? { cle: equipe.slug, titre: equipe.name, debut: 1 } : { cle: "", titre: TOUT_LE_MONDE, debut: 0 }
}

/**
 * Le titre montré du Contexte de ce chemin, « Contexte · <section> » (E05-S11, AC-17) : le `<h1>` de l'écran et
 * le `<title>` que la page de l'hôte pose (AC-17, AC-18) ; sans lui, les deux se composeraient chacun.
 */
export function titreDuContexte(chemin: string, equipes: Equipes | null, handle: string | null): string {
  return titreDeContexte(sectionDuChemin(chemin, equipes, handle).titre)
}

/** La liste qui range un chemin dans les sections (ses frères, lui compris), dans l'ordre du rail. */
function listeDe(noeuds: readonly NoeudDArbre[], chemin: string): readonly NoeudDArbre[] | null {
  for (const noeud of noeuds) {
    if (noeud.chemin === chemin) return noeuds
    const dessous = noeud.enfants ? listeDe(noeud.enfants, chemin) : null
    if (dessous) return dessous
  }
  return null
}

type Lecture = { sections: readonly SectionCle[]; prefixe: string }

function maillonDeNoeud(chemin: string, libelle: string, courant: boolean, { sections, prefixe }: Lecture): MaillonDuFil {
  const liste = sections.map((section) => listeDe(section.noeuds, chemin)).find((trouvee) => trouvee !== null) ?? []
  const moi = liste.find((noeud) => noeud.chemin === chemin)
  const freres = liste.map((frere) => ({ id: frere.chemin, libelle: frere.titre, glyphe: { nature: frere.nature }, choisi: frere.chemin === chemin, href: `${prefixe}${frere.chemin}` }))
  return { id: chemin, libelle, glyphe: moi ? { nature: moi.nature } : null, courant, freres }
}

function maillonDeSection(section: SectionDuChemin, { sections, prefixe }: Lecture): MaillonDuFil {
  if (section.cle === null) return { id: "section", libelle: section.titre, glyphe: null, courant: false, freres: [] }
  const freres = sections.map((une) => {
    const contexte = une.noeuds.find((noeud) => noeud.nature === "contexte")
    return { id: `section:${une.cle}`, libelle: une.titre, glyphe: { portee: porteeDeLaSection(une.cle) }, choisi: une.cle === section.cle, href: contexte ? `${prefixe}${contexte.chemin}` : null }
  })
  return { id: `section:${section.cle}`, libelle: section.titre, glyphe: { portee: porteeDeLaSection(section.cle) }, courant: false, freres }
}

type FilDuCheminEntree = {
  chemin: string
  /** Le titre montré du nœud : celui du brouillon en attente pour un rédacteur. */
  titre: string
  /** `null` : l'arbre ou les équipes sont illisibles (la page le dit ailleurs) ; aucun frère n'est deviné. */
  arbre: readonly TreeNode[] | null
  equipes: Equipes | null
  handle: string | null
  /** Le préfixe des adresses de pages de l'hôte (`"/n/"`). */
  prefixe: string
}

/** Le fil d'un nœud (AC2) : la section, les ancêtres (titrés s'ils sont visibles, leur segment sinon), le nœud. */
export function filDuChemin({ chemin, titre, arbre, equipes, handle, prefixe }: FilDuCheminEntree): MaillonDuFil[] {
  const segments = chemin.split("/")
  const section = sectionDuChemin(chemin, equipes, handle)
  const lecture: Lecture = { sections: arbre && equipes ? sectionsDeLArbre(arbre, equipes, handle) : [], prefixe }
  const titres = arbre ? titresParChemin(arbre) : new Map<string, string>()
  const ancetres = segments.slice(0, -1).flatMap((segment, rang) => {
    if (rang < section.debut) return []
    const ancetre = segments.slice(0, rang + 1).join("/")
    return [maillonDeNoeud(ancetre, titres.get(ancetre) ?? segment, false, lecture)]
  })
  return [maillonDeSection(section, lecture), ...ancetres, maillonDeNoeud(chemin, titre, true, lecture)]
}
