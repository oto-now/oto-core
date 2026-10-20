// Les libellés de l'écran d'un tableau (E07-S03) : phrases de la grille, de la provenance, de la file de
// revue et des blocs `reference`, pluriels et résumé de revue. Tout autre refus de l'API prend le texte
// de `messageDErreur` (`ui/api/messages.ts`), que complètent les phrases propres à la décision. Depuis la
// reprise d'oto-frontend (E05-S09 partie c2), celles de sa grille : la recherche, les deux vides, l'échec.
import { REVIEW_REASON_MAX, TABLE_VIEW_ROWS_MAX, type ScreenReferenceProblem, type TableLifecycle } from "../../schemas"
import { FILTERED_ROWS_MAX, FORMER_MEMBER } from "../../schemas/tables"
import type { MessagesDuGeste } from "../api/messages"
import { nombreLisible } from "../format/nombres"

/** « 0 ligne », « 1 ligne », « 3 lignes » : 0 et 1 prennent le singulier en français. */
function compte(n: number, singulier: string, pluriel: string): string {
  return `${nombreLisible(n)} ${n > 1 ? pluriel : singulier}`
}

export const nLignes = (n: number) => compte(n, "ligne", "lignes")
export const correspondent = (n: number) => compte(n, "ligne correspond", "lignes correspondent")
export const aRevoir = (n: number) => compte(n, "ligne à revoir", "lignes à revoir")
export const affichees = (n: number, total: number) => `${compte(n, "ligne affichée", "lignes affichées")} sur ${nombreLisible(total)}`
export const lignesSur = (n: number, total: number) => `${nLignes(n)} sur ${nombreLisible(total)}`

export const GRILLE = {
  /** Le nom et l'invite du champ de recherche (`barre-du-tableau.tsx` d'oto-frontend) : « Chercher dans 57 lignes ». */
  chercherDans: (n: number) => `Chercher dans ${nLignes(n)}`,
  chercher: "Chercher dans le tableau",
  retirerLesFiltres: "Retirer les filtres",
  effacerLaRecherche: "Effacer la recherche",
  retirerTout: "Retirer la recherche et les filtres",
  vide: "Ce tableau est vide",
  /** Qui écrira les lignes (E11-S05, AC-h1) : « C'est Claude qui pourra créer et modifier ses lignes. » */
  videTexte: (assistant: string) => `C'est ${assistant} qui pourra créer et modifier ses lignes.`,
  aucune: "Aucune ligne pour cette recherche",
  aucuneTexte: "D'autres lignes existent : aucune ne répond à ce que vous cherchez.",
  chargerPlus: "Charger plus",
  affinez: "Affinez la recherche ou les filtres pour voir les autres lignes.",
  avisDeReglage: "Un réglage de l'adresse n'a pas été compris : il est ignoré.",
  resumeEnEchec: "Le résumé n'a pas pu être calculé.",
  chargement: "Chargement des lignes…",
  filtrer: "Filtrer",
  retirer: "Retirer",
  presence: "Cellule",
  peuImporte: "Peu importe",
  /** Le bouton du filtre d'une colonne et l'intitulé de son panneau (AC6) : « Filtrer sur ville ». */
  filtrerSur: (colonne: string) => `Filtrer sur ${colonne}`,
  /** « le filtre de ville » : ce que retire « Retirer », dit aux lecteurs d'écran (AC6). */
  leFiltreDe: (colonne: string) => ` le filtre de ${colonne}`,
  /** Le bail en cours dans la cellule clé (AC2) : « en cours · claude-claire jusqu'à 14:05 ». */
  bail: (etat: string | undefined, travailleur: string, heure: string) => `${etat ?? "réservée"} · ${travailleur} jusqu'à ${heure}`,
} as const

/** Les opérations d'un filtre de colonne (AC6), dans l'ordre du formulaire. */
export const OPERATIONS_LUES = { contains: "Contient", eq: "Égal à", gte: "Au moins", lte: "Au plus", empty: "Vide", not_empty: "Rempli" } as const

export const TEXTES_DE_CELLULE = { vide: "—", verifieVide: "vérifié vide", oui: "Oui", non: "Non", provenance: (colonne: string) => `Provenance de « ${colonne} »` } as const

/** Le nom d'une provenance en français : « un ancien membre » pour une personne partie (`FORMER_MEMBER`, N9). */
function nomServi(nom: string): string {
  return nom === FORMER_MEMBER ? "un ancien membre" : nom
}

/** Les phrases de la provenance d'une cellule (AC3, H94). */
export const PROVENANCE = {
  agent: (nom: string | undefined) => (nom ? `Rempli par l'assistant de ${nomServi(nom)}` : "Rempli par un assistant"),
  human: (nom: string | undefined) => (nom ? `Décidé par ${nomServi(nom)}` : "Décidé par une personne"),
  import: "Importé",
  verifieVide: (nom: string | undefined, raison: string) => `Vérifié vide par l'assistant de ${nom ? nomServi(nom) : "un assistant"} : ${raison}`,
  le: (quand: string) => `le ${quand}`,
  commentaire: (texte: string) => `Commentaire : ${texte}`,
  preuve: "Preuve : ",
  importee: (valeur: string, quand: string | undefined) => `Valeur importée à l'origine : ${valeur}${quand ? ` (le ${quand})` : ""}`,
} as const

export const REVUE = {
  titre: "À revoir",
  rien: "Rien à revoir.",
  enEchec: "La file de revue n'a pas pu être lue",
  raison: "Raison (facultative)",
  /** L'invite du champ de la raison, qui n'a pas d'étiquette visible (`attentes.tsx` d'oto-frontend) : son nom est `raison`. */
  raisonInvite: "Pourquoi ? (facultatif)",
  raisonTropLongue: `La raison compte ${nombreLisible(REVIEW_REASON_MAX)} caractères au plus.`,
  refuser: (etat: string) => `Refuser → ${etat}`,
  approuver: (etat: string) => `Approuver → ${etat}`,
  decidee: (cle: string, etat: string) => `${cle} → ${etat}.`,
  sautee: (cle: string, etat: string | null) => `${cle} a changé entre-temps (état actuel : « ${etat ?? "aucun"} ») : rien n'a été écrit.`,
  resume: "Résumé de la revue",
  copier: "Copier pour la conversation",
  copie: "Copié",
  copieImpossible: "Copie impossible : sélectionnez le texte du résumé.",
  /**
   * Le cycle d'une ligne, dit sous le titre de l'îlot (E11-S05, AC-a5, HN-E11S05-4) avec les états que l'en-tête
   * déclare : l'entrée (le premier état), l'état de travail, celui de la revue, puis les deux décisions.
   */
  cycle: ({ states, working, review }: TableLifecycle & { review: NonNullable<TableLifecycle["review"]> }) =>
    `Une ligne entre à « ${states[0] ?? working} », passe à « ${working} » quand un assistant la prend, puis à « ${review.state} ». ` +
    `Vous l'approuvez (« ${review.approve} ») ou la refusez (« ${review.reject} »). Les lignes à revoir sont surlignées dans le tableau.`,
} as const

/**
 * Le nom de l'assistant de la personne dans le vide d'un tableau (E11-S05, AC-h1 ; HN-E11S05-17, HN-E11S05-18) : la
 * famille de sa connexion la plus récente (`lastConnections`), « Claude » pour claude.ai et Claude Code, « ChatGPT »,
 * sinon « votre assistant » (famille inconnue, client non identifié, aucune connexion ou lecture en échec).
 */
export function nomDeLAssistant(famille: string | undefined): string {
  if (famille === "claude.ai" || famille === "Claude Code") return "Claude"
  if (famille === "ChatGPT") return "ChatGPT"
  return "votre assistant"
}

/**
 * Les refus des lectures de l'écran d'un tableau (AC9), passés à `resultatDe` par la page : au-delà de la
 * borne de N6, recherche, filtres, tri et file ne se calculent pas, et « Réessayer » échouerait pareil.
 */
export const MESSAGES_DU_TABLEAU: MessagesDuGeste = {
  too_large: `Ce tableau compte plus de ${nombreLisible(FILTERED_ROWS_MAX)} lignes : la recherche, les filtres, le tri et la file de revue ne s'y appliquent pas dans cette version.`,
}

/** Les refus propres à la décision (AC13) ; tout autre code prend le texte de `messageDErreur`. */
export const MESSAGES_DE_LA_REVUE: MessagesDuGeste = {
  forbidden: "Seuls les rédacteurs de ce tableau peuvent décider.",
  not_found: "Cette ligne n'existe plus.",
  reseau: "La décision n'a pas été envoyée. Réessayez : votre raison est gardée.",
}

/** Les décisions d'une revue, dans une session de l'écran (AC14). */
export type SessionDeRevue = { approuvees: string[]; refusees: string[]; sautees: string[] }

/**
 * Le résumé d'une ligne d'une revue (AC14, HN-E07S03-6) : « Revue de ventes/suivi_prospects le
 * 24/09/2026 : 1 approuvée (qualifié : P-003), 1 refusée (écarté : P-006), 1 sautée (P-009). » ; une
 * part sans décision est tue.
 */
export function resumeDeLaRevue(table: string, jour: string, session: SessionDeRevue, etats: { approuver: string; refuser: string }): string {
  const parts = [
    session.approuvees.length > 0 ? `${compte(session.approuvees.length, "approuvée", "approuvées")} (${etats.approuver} : ${session.approuvees.join(", ")})` : null,
    session.refusees.length > 0 ? `${compte(session.refusees.length, "refusée", "refusées")} (${etats.refuser} : ${session.refusees.join(", ")})` : null,
    session.sautees.length > 0 ? `${compte(session.sautees.length, "sautée", "sautées")} (${session.sautees.join(", ")})` : null,
  ]
  return `Revue de ${table} le ${jour} : ${parts.filter((part) => part !== null).join(", ")}.`
}

/** La fiche de la file de revue (fiche D99, M54) : le choix de la fiche (P2) et la preuve de chaque valeur (P3). */
export const FICHE = {
  choisir: "Fiche à revoir",
  passer: "Passer",
  montree: (cle: string) => `Fiche ${cle}.`,
  /** « Passer » depuis la dernière fiche lue : le retour à la première se dit, et qu'il en reste au-delà (HN-M54-5). */
  retour: (cle: string, restantes: boolean) =>
    `Fiche ${cle} : retour à la première${restantes ? " ; les suivantes paraissent après vos décisions" : ""}.`,
  /** Les fiches lues quand la file en compte plus (HN-M54-5) : « 20 premières sur 57 ». */
  premieres: (n: number, total: number) => `${nombreLisible(n)} premières sur ${nombreLisible(total)}`,
  sansPreuve: "sans preuve",
} as const

/** Une ligne refusée dans le résumé de la revue, avec la raison donnée (P4) : « P-002 « Doublon de P-001 » ». */
export const refuseeAvecRaison = (cle: string, raison: string) => `${cle} « ${raison} »`

/** Pourquoi une vue ne se lit pas (AC15), en français ; `detail` nomme la clé, la colonne ou le chemin. */
const RAISONS: Record<ScreenReferenceProblem, (detail: string | undefined) => string> = {
  not_found: () => "introuvable",
  not_a_table: (detail) => `${detail ?? "ce chemin"} n'est pas un tableau`,
  unpublished: () => "ce tableau n'a pas encore été publié",
  unknown_key: (detail) => `clé inconnue${detail ? ` (${detail})` : ""}`,
  limit: () => `plus de ${nombreLisible(TABLE_VIEW_ROWS_MAX)} lignes demandées`,
  unknown_column: (detail) => `colonne inconnue${detail ? ` (${detail})` : ""}`,
  filter: () => "filtre refusé",
  sort: () => "tri refusé",
  too_large: () => `le tableau compte plus de ${nombreLisible(FILTERED_ROWS_MAX)} lignes`,
}

export const REFERENCES = {
  tableauIntrouvable: (chemin: string) => `Tableau introuvable ou non partagé : ${chemin}.`,
  pageIntrouvable: (chemin: string) => `Page introuvable ou non partagée : ${chemin}.`,
  vueIllisible: (raison: ScreenReferenceProblem, detail: string | undefined) => `Vue illisible : ${RAISONS[raison](detail)}.`,
  tropDeVues: "Trop de vues dans cette page : les suivantes s'affichent en lien.",
  enEchec: "Les vues et les cartes de cette page n'ont pas pu être lues : les références s'affichent en lien.",
  ouvrirLeTableau: "Ouvrir le tableau",
  /** Le vide d'une vue (AC15) : sans recherche, la phrase de la grille (« pour cette recherche ») s'y lirait de travers. */
  vueVide: "Aucune ligne ne correspond.",
  vue: (titre: string) => `${titre} — vue`,
  ancienChemin: (chemin: string) => `ancien chemin : ${chemin}`,
} as const

/** Les réglages d'un tableau à l'écran (E11-S01, AC-g1 à AC-g6) : le bouton, le panneau, ses trois interrupteurs. */
export const OPTIONS = {
  bouton: "Réglages",
  titre: "Réglages du tableau",
  preuve: {
    intitule: "Preuve exigée",
    aide: "Chaque valeur nouvelle écrite par un assistant doit citer sa source : un commentaire ou un lien.",
  },
  revue: {
    intitule: "L'assistant peut décider la revue",
    /** Les états de la revue déclarée (`lifecycle.review`) : « à revoir », « qualifié », « écarté ». */
    aide: (etats: { state: string; approve: string; reject: string }) =>
      `Un assistant peut aussi passer une ligne « ${etats.state} » à « ${etats.approve} » ou « ${etats.reject} » ; sa décision est tracée comme venant d'un assistant.`,
  },
  ferme: {
    intitule: "Fermé",
    aide: "Seules les lignes existantes s'écrivent : aucune ligne nouvelle n'est créée.",
  },
  /** L'issue d'une bascule publiée (AC-g3) : « Preuve exigée : activée. ». */
  annonce: (intitule: string, active: boolean) => `${intitule} : ${active ? "activée" : "désactivée"}.`,
  enAttente: "Un changement de l'en-tête attend en brouillon. Demandez à l'assistant de le publier ou de l'abandonner, puis rechargez la page.",
} as const

/** Les refus propres aux réglages (AC-g5) ; tout autre code prend le texte de `messageDErreur`. */
export const REFUS_DES_OPTIONS: MessagesDuGeste = {
  stale_revision: "Le tableau a changé pendant que la page était ouverte. Rechargez la page, puis réessayez.",
}
