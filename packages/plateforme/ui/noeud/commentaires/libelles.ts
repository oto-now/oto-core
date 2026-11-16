// Les libellés des commentaires d'une page (parcours 5.4) : l'encart, la carte d'un fil, le champ et ses mentions, la
// bulle d'un bloc. Hors de `ui/noeud/libelles.ts`, à son plafond de lignes. Sans ce module, chaque composant des
// commentaires écrirait ses phrases, et le test les recopierait.
import type { MessagesDuGeste } from "../../api/messages"

export const COMMENTAIRES = {
  titre: "Commentaires",
  ouverts: "Ouverts",
  resolus: "Résolus",
  onglets: "Fils de commentaires",
  commenterLaPage: "Commenter la page",
  commenterLaPageAide: "Un commentaire sur la page entière, sans passage précis",
  chargement: "Lecture des commentaires…",
  echec: "Chargement impossible",
  reessayer: "Réessayer",
  aucunOuvert: "Aucun fil ouvert",
  aucunOuvertSansBloc: "Aucun fil ouvert",
  aucunResolu: "Aucun fil résolu.",
  filsOuverts: "Fils ouverts",
  filsResolus: "Fils résolus",
} as const

export const BULLE = {
  commenter: "Commenter ce passage",
  commenterAide: "Commenter ce bloc : poser une question, signaler une erreur, ou demander une correction à l'assistant",
  nom: (mots: string) => `Commenter ce bloc — ${mots}`,
  fils: (nombre: number, mots: string) => `${nombre > 1 ? `${nombre} fils ouverts` : "1 fil ouvert"} sur ce bloc — ${mots}`,
  filsAide: (nombre: number) => `${nombre > 1 ? `${nombre} fils ouverts` : "1 fil ouvert"} sur ce bloc : cliquer pour le lire`,
} as const

export const FIL = {
  surLaPage: "Sur la page",
  debutDeLaPage: "Début de la page",
  allerAuPassage: "Aller au passage",
  nom: (lieu: string) => `Fil sur ${lieu}`,
  nouveauSurLaPage: "Nouveau fil sur la page entière",
  nouveauSurUnPassage: "Nouveau fil sur ce passage",
  modifieDepuis: "passage modifié depuis",
  modifieDepuisAide: "Le texte commenté a été réécrit après ce commentaire",
  supprime: "passage supprimé",
  supprimeAide: "Le passage commenté n'existe plus : le fil est rattaché à la page",
  resoudre: "Résoudre le fil",
  resoudreAide: "Résoudre tout le fil : il passe dans « Résolus », reste lisible et peut être rouvert",
  rouvrir: "Rouvrir le fil",
  rouvrirAide: "Rouvrir le fil : il revient dans « Ouverts »",
  reserve: "Résoudre ou rouvrir ce fil revient à son auteur ou à un rédacteur de la page",
  repondre: "Répondre",
  enAttente: "en attente d'un assistant",
  enAttenteAide: "Ce fil attend le prochain assistant d'une personne qui peut modifier la page. Rien ne se passe tant que personne n'ouvre de conversation.",
  citation: (texte: string) => `« ${texte} »`,
} as const

export const COMMENTAIRE = {
  ancienMembre: "Ancien membre",
  assistantDe: (nom: string) => `Assistant de ${nom}`,
  assistantDUnAncienMembre: "Assistant d'un ancien membre",
  modifie: "modifié",
  modifier: "Modifier mon commentaire",
  supprimerLeFil: "Supprimer le fil et ses réponses",
  supprimerLaReponse: "Supprimer ma réponse",
  questionDuFil: (reponses: number) =>
    reponses === 0 ? "Supprimer ce fil ? C'est définitif." : `Supprimer ce fil et ${reponses > 1 ? `ses ${reponses} réponses` : "sa réponse"} ? C'est définitif.`,
  questionDeLaReponse: "Supprimer cette réponse ? C'est définitif.",
  supprimer: "Supprimer",
} as const

export const CHAMP = {
  nouveau: "Votre commentaire…",
  reponse: "Répondre…",
  modification: "Modifier le commentaire…",
  envoyer: "Envoyer",
  enregistrer: "Enregistrer",
  annuler: "Annuler",
  aide: "@ pour mentionner",
  mentions: "Personnes à mentionner",
  assistant: "assistant",
  assistantAide: "le prochain assistant qui passe sur cette page",
  lecteur: "lit cette page",
  vide: "Écrivez un commentaire avant de l'envoyer.",
  tropLong: (maximum: number) => `Un commentaire tient en ${maximum} caractères au plus : raccourcissez-le.`,
  pourLAssistant:
    "@assistant ne désigne pas un assistant précis, et aucun ne tourne en permanence. Le fil attend : il sera traité par le prochain assistant d'une personne qui peut modifier cette page, à sa prochaine conversation.",
  email: (noms: readonly string[]) => `${noms.join(", ")} ${noms.length > 1 ? "recevront" : "recevra"} un email, regroupé avec les autres commentaires : un par heure au plus.`,
  citationRetiree: "Le passage cité ne se retrouve pas tel quel dans le texte publié : la citation est retirée. Envoyez de nouveau pour commenter le passage sans elle.",
} as const

/** Les refus des gestes sur un commentaire ou un fil : ce que la personne peut faire, sa saisie gardée. */
export const REFUS: MessagesDuGeste = {
  reseau: "La connexion au serveur a échoué. Votre texte est gardé : réessayez.",
  forbidden: "Ce geste ne vous revient pas : un fil se résout par son auteur ou un rédacteur de la page, un commentaire se modifie par son auteur.",
  conflict: "Ce fil est résolu : rouvrez-le pour y répondre.",
  not_found: "Cette page ou ce fil n'existe plus. Rechargez la page.",
  invalid_arguments: "Ce commentaire n'a pas pu être enregistré tel quel. Vérifiez son texte, puis réessayez.",
}
