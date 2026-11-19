/** Les natures d'un nœud de l'arbre (ADR-011 § 1) : page, tableau, procédure, Contexte (P39). */
export type NatureDeNoeud = "page" | "tableau" | "procedure" | "contexte"

/** Un nœud tel que l'écran le reçoit. Le `chemin` est figé et unique : il sert d'identifiant. */
export type NoeudDArbre = {
  chemin: string
  titre: string
  nature: NatureDeNoeud
  enfants?: NoeudDArbre[]
}

/** Une section de l'arbre (P39) : son intitulé, texte et non lien, puis ses nœuds. */
export type SectionDArbre = { titre: string; noeuds: NoeudDArbre[] }

/**
 * Une section telle que `sectionsDeLArbre` la rend : sa clé en plus (`""` pour Tout le monde, le slug
 * d'une équipe, `private`), d'où le rail tire son pli et la racine de ce qu'on y crée (E05-S09) ; `invite`, quand
 * l'hôte dit les équipes de la personne et que celle-ci n'en est pas.
 */
export type SectionCle = SectionDArbre & {
  cle: string
  /**
   * La section d'une équipe quand l'hôte dit les équipes de la personne : `true`, elle n'en est pas membre et y voit ce
   * que l'équipe partage avec elle ; `false`, elle en est membre ; absente quand l'hôte ne le dit pas.
   */
  invite?: boolean
}

/** Même forme que le retour des actions (`ActionResult`) : l'écran reçoit des données ou un message. */
export type ResultatDArbre = { data: NoeudDArbre[]; error?: never } | { data?: never; error: string }
