// Les données du rail (E05-S09, partie a), lues par la page de l'hôte avec le jeton de la session et
// passées telles quelles : aucune fonction ne traverse la frontière client (portage-ecrans.md § 2).
import type { PersonOrganisation, TreeNode } from "../../schemas"
import type { Resultat } from "../api/resultat"

/**
 * Les adresses des écrans de l'hôte : une adresse absente retire son entrée des menus et de la palette
 * (un ERP ne monte pas forcément tous les écrans).
 */
export type AdressesDuRail = {
  /** Le préfixe des pages de l'arbre (« /n/ ») : l'adresse d'un nœud est ce préfixe suivi de son chemin. */
  pages: string
  accueil?: string
  journal?: string
  equipes?: string
  /** « Brancher un assistant ». */
  brancher?: string
  usage?: string
  retours?: string
  organisation?: string
  /** Écrans retirés du rail et des menus par E05-S11 (AC-31, AC-33) : lus par aucune entrée ; clés gardées jusqu'au retrait de ces écrans (HN-E05S11-15). */
  marque?: string
  drapeaux?: string
  acces?: string
  /** Les connecteurs : une ligne du pied du rail, pour qui administre (E05-S11, AC-32). */
  connecteurs?: string
  /** La corbeille (E05-S10, AC-b11) : au menu du compte (E05-S11, AC-e22), et dans la palette. */
  corbeille?: string
  /** La page « Profil » (E05-S11, AC-6) : au menu du compte, et dans la palette. */
  profil?: string
  /** La vue « Contexte », ce que lit l'assistant (E11-S10, AC-e1) : en tête du menu du compte, et dans la palette. */
  contexte?: string
  /** L'écran d'abonnement de l'hôte (E12-S02) : aux réglages de l'entreprise, pour qui administre, et dans la palette ; absente, rien. */
  abonnement?: string
  /**
   * La page d'inscription de l'hôte, un chemin de son application (elle monte `FormulaireDInscription`) : « Créer une
   * organisation », sous la bascule du menu de l'entreprise, pour toute personne ; absente, rien.
   */
  inscription?: string
}

export type EquipeDuRail = { slug: string; name: string }

export type DonneesDuRail = {
  /** Le nom affiché et le logo de l'organisation (marque, E09-S01) ; `null` quand l'identité n'a pas été lue. */
  entreprise: { nom: string; logo: string | null } | null
  arbre: Resultat<{ tree: TreeNode[]; truncated: boolean }>
  equipes: Resultat<EquipeDuRail[]>
  /** L'espace de la personne, `private/<handle>` ; `null` sans profil. */
  handle: string | null
  /** Le nom de la personne, au pied ; `null` quand l'identité n'a pas été lue. */
  compte: string | null
  /** `isOrgAdmin` de l'identité : les entrées d'administration. */
  administre: boolean
  /** Les organisations de la personne (`listMyOrganisations`) : à partir de deux, le menu de l'entreprise porte la bascule. */
  organisations?: PersonOrganisation[]
}
