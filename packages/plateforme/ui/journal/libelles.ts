// Les phrases françaises du journal (E05-S05) : états, avertissements, issues. Constantes du paquet,
// jamais un texte venu du service (`portage-ecrans.md § 4`) ; lues par l'écran, la liste et le panneau.
// Repris d'oto-frontend (`etats-du-suivi.tsx`, `journal-des-appels.tsx`) : un message constant par cas,
// un titre à l'avertissement d'une liste qui s'arrête avant la fin (E05-S09, partie d1). Retiré : « réservé
// aux responsables » (la portée est celle de H74, pas un rôle).
import { JOURNAL_ROWS_SCANNED } from "../../schemas/journal"

/** Une cellule sans valeur. */
export const ABSENT = "—"

export const TITRE = "Journal"

/** La page « Activité » (1.4.13) : ses onglets Statistiques, pour qui administre, et Journal, pour tous. */
export const ACTIVITE = {
  titre: "Activité",
  onglets: "Les vues de l'activité",
  statistiques: "Statistiques",
  journal: "Journal",
} as const
export const META = "Les conversations des assistants avec les pages de l'organisation"
export const TITRE_DE_LA_LISTE = "Conversations, la plus récente d'abord"
export const AUCUNE_CONVERSATION = "Aucune conversation sur cette période."
export const ELARGIR = "Essayez une période plus large, ou retirez les filtres."
export const RETIRER_LES_FILTRES = "Retirer les filtres"
export const FILTRE_IGNORE = "Un filtre de l'adresse n'a pas été compris : il est ignoré."
export const SUITE_PERIMEE = "La suite demandée n'est plus valable : la liste repart du début."
export const LISTE_ARRETEE = "Cette liste s'arrête avant la fin"
// La borne même du service, lue dans le schéma que partagent les deux faces (« 2 000 »).
export const PERIODE_TRONQUEE = `La période compte plus de ${JOURNAL_ROWS_SCANNED.toLocaleString("fr-FR")} appels : seuls les plus récents sont regroupés ici. Réduisez la période ou filtrez.`
export const CONVERSATION_INTROUVABLE = "Cette conversation n'existe pas ou ne vous est pas visible."

/** La personne d'une conversation qui n'est plus membre (AC3). */
export const PERSONNE_RETIREE = "Personne retirée"

/** À la place des arguments d'un appel sur l'espace personnel d'une autre personne (D44, M14). */
export const ARGUMENTS_NON_MONTRES = "Arguments non montrés : appel sur l'espace personnel d'une autre personne."

/** L'issue d'un appel : un mot et une teinte, jamais la teinte seule (AC7, AC14). */
export const ISSUES = { reussi: "Réussi", echec: "Échec" } as const

/** « 1 erreur », « 3 erreurs ». */
export function erreurs(nombre: number): string {
  return nombre > 1 ? `${nombre} erreurs` : `${nombre} erreur`
}
