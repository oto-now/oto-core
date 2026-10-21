// Les phrases du panneau « Partager » (E05-S10, AC-b5, AC-b13, AC-d1 ; 1.4.12, 1.4.13) : les niveaux et ce qu'ils permettent,
// le panneau, l'accès par défaut, le partage sur le web et leurs refus. À part de `libelles.ts`, qui les réexporte.
import type { AccessLevelName } from "../../schemas"

/** Une page absente ou non partagée : la même phrase partout, pour ne rien dire de ce qui existe (H68). */
export const INTROUVABLE = "Cette page n'existe pas ou ne vous est pas partagée."

/** Les niveaux d'accès dans « Partager » (E05-S10, AC-b5), les mots de Notion ; les niveaux eux-mêmes ne changent pas. */
export const NIVEAUX_D_ACCES: Record<AccessLevelName, string> = {
  none: "Aucun accès",
  read: "Peut lire",
  write: "Peut modifier",
  manage: "Accès complet",
}

/** Ce que chaque niveau permet, une ligne fine sous son nom dans chaque liste de niveaux (1.4.13) : la différence se lit sans aide. */
export const DETAIL_DES_NIVEAUX: Record<AccessLevelName, string> = {
  none: "Ne voit ni ce contenu ni ce qu'il range.",
  read: "Voit le contenu, sans le changer.",
  write: "Lit, écrit et publie.",
  manage: "Modifie, partage, déplace et supprime.",
}

/** Les phrases du panneau « Partager » (AC-b5) : ni « règle » ni « niveau » à l'écran. */
export const PARTAGE = {
  ajouter: "Ajouter une personne ou une équipe",
  suggestions: "Personnes et équipes",
  rienTrouve: "Aucune personne ni équipe de ce nom.",
  personneAjoutee: "Personne n'a été ajouté à ce contenu.",
  equipe: (nom: string) => `Équipe ${nom}`,
  vous: "vous",
  accesDe: (nom: string) => `Accès de ${nom}`,
  retirer: "Retirer",
  ajoute: (nom: string) => `${nom} peut lire ce contenu.`,
  change: (nom: string, niveau: string) => `${nom} : ${niveau.toLowerCase()}.`,
  retire: (nom: string) => `${nom} n'a plus d'accès propre à ce contenu.`,
  reserve: "Seules les personnes qui ont l'accès complet changent le partage.",
  ajoutesSeulement: "Seulement les personnes ajoutées",
  detailPerso: (qui: string) => `${qui} a l'accès complet.`,
  /** Les membres de l'équipe propriétaire, leur niveau hérité et le menu qui le surcharge (1.4.12). */
  membresDe: (equipe: string) => `Membres de l'équipe ${equipe}`,
  responsable: "responsable",
  /** Les intertitres du panneau en étiquettes (1.4.13). */
  parDefaut: "Accès par défaut",
  ajoutes: "Personnes et équipes ajoutées",
  surLeWeb: "Sur le web",
  /** Un membre dont le niveau diffère de celui de l'équipe : une règle qui le nomme, posée plus haut, l'a réglé. */
  exception: "exception",
  niveauxIllisibles: (message: string) => `Les niveaux d'accès n'ont pas pu être lus : ${message}`,
  reessayer: "Réessayer",
  introuvable: INTROUVABLE,
} as const

/**
 * L'accès général dans « Partager » (E05-S10, AC-b13 ; ADR-014) : la règle de toute l'organisation, à un niveau,
 * ou aucune ; ce que l'espace donne déjà se dit à côté (Tout le monde lit, l'équipe modifie).
 */
export const ACCES_GENERAL = {
  niveau: "Niveau de toute l'organisation",
  /** La ligne de l'équipe propriétaire (1.4.13) : son niveau par défaut sur ce contenu et ce qu'il y a dessous. */
  niveauEquipe: (equipe: string) => `Niveau de l'équipe ${equipe}`,
  herite: "hérité",
  responsableGarde: "Son responsable garde l'accès complet. Un niveau d'équipe choisi ici passe devant les exceptions posées plus haut.",
  lecture: "Lecture…",
  toute: (organisation: string) => `Toute l'organisation ${organisation}`,
  toutLeMondeLit: "Dans Tout le monde, chaque membre lit au moins ce contenu.",
  prive: "Un contenu de Privé ne s'ouvre pas à toute l'organisation : ajoutez des personnes ou des équipes.",
  ouvert: (niveau: string) => `Toute l'organisation : ${niveau.toLowerCase()}.`,
  restreint: "Accès général : seules les personnes ajoutées et l'espace du contenu.",
} as const

/**
 * Les refus de `POST nodes/access` (ADR-014 § 2 ; `setGeneralAccess`), par code : la table commune ne dit ni
 * l'accès complet réservé, ni Privé, ni le changement venu d'ailleurs.
 */
export const REFUS_DE_L_ACCES_GENERAL = {
  forbidden: "Vous ne pouvez pas changer l'accès général de ce contenu : il faut l'accès complet, et seul un administrateur ouvre l'accès complet à toute l'organisation.",
  invalid_arguments: ACCES_GENERAL.prive,
  conflict: "L'accès général a changé pendant votre geste : fermez puis rouvrez « Partager ».",
} as const

/** « Partager sur le web » (E05-S10, partie d ; ADR-013) : le lien public d'un contenu, pour qui en a l'accès complet. */
export const PARTAGE_WEB = {
  titre: "Partager sur le web",
  explication: "Toute personne qui a le lien lit la dernière version publiée, sans compte ; jamais indexé par un moteur de recherche.",
  /** Ce que copie le bouton : « Copier le lien ». */
  cible: "le lien",
  sousContenus: "Inclure les sous-contenus",
  sousContenusDetail: "Les contenus dessous que vous lisez s'ouvrent aussi depuis la page publique.",
  desactiver: "Désactiver le lien",
  question: "Désactiver ce lien ? Il ne mènera plus à rien ; un nouveau lien aura une autre adresse.",
  chargement: "Lecture du lien public…",
  reessayer: "Réessayer",
  cree: "Lien public créé : copiez-le pour le partager.",
  avecSousContenus: "Les sous-contenus s'ouvrent depuis la page publique.",
  sansSousContenus: "Les sous-contenus ne s'ouvrent plus depuis la page publique.",
  desactive: "Lien désactivé : il ne mène plus à rien.",
} as const

/** Les refus du service propres au partage sur le web (ADR-013 § 2, § 3 ; HN-E05S10e-19), par code. */
export const REFUS_DU_PARTAGE_WEB = {
  invalid_arguments:
    "Ce contenu ne se partage pas sur le web : la racine, Privé, un espace personnel, un Contexte et le dossier d'une équipe restent dans l'organisation. Partagez une page qu'ils contiennent.",
  forbidden: "Vous ne pouvez pas partager ce contenu sur le web : il faut l'accès complet, et un contenu du Privé d'une autre personne ne se partage que par elle.",
  conflict: "Le lien a changé pendant votre geste : fermez puis rouvrez « Partager ».",
} as const
