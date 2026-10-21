// Les libellés français des fichiers joints à une page (E10-S02, lot b) : insérer, envoyer, lire, décrire, élargir,
// convertir. Hors de `libelles.ts`, que son plafond de lignes ne laisse plus grandir. Les limites et les types s'écrivent
// depuis `schemas/files.ts` (`portage-ecrans.md § 6`).
import { TEXT_TYPES } from "../../schemas/files"

/** Les fichiers texte, bornés plus bas : « html, md, txt, csv ». */
const TEXTES = TEXT_TYPES.join(", ")

export const FICHIERS = {
  image: "Image",
  fichier: "Fichier",
  titreImage: "Joindre une image",
  titreFichier: "Joindre un fichier",
  limitesImage: (types: string, max: string) => `${types} ; ${max} au plus.`,
  limitesFichier: (types: string, max: string, maxTexte: string) => `${types} ; ${max} au plus, ${maxTexte} pour un fichier texte (${TEXTES}).`,
  envoi: (nom: string) => `Envoi de ${nom}`,
  annuler: "Annuler",
  annulerNom: (nom: string) => `Annuler l'envoi de ${nom}`,
  retirer: "Retirer",
  retirerNom: (nom: string) => `Retirer ${nom}`,
  telecharger: "Télécharger",
  renduPar: (fonction: string, date: string) => `Rendu par ${fonction} le ${date}`,
  deposeParLien: (date: string) => `Déposé par un lien de dépôt le ${date}`,
  depose: (date: string) => `Déposé le ${date}`,
  origineInconnue: "Origine inconnue",
  auteur: (nom: string) => ` · ${nom}`,
  copie: (date: string) => `copié le ${date}`,
  telechargerNom: (nom: string) => `Télécharger ${nom}`,
  voir: "Voir",
  voirNom: (nom: string) => `Voir ${nom} (nouvel onglet)`,
  indisponible: "Fichier indisponible",
  agrandir: (alt: string) => (alt ? `Agrandir l'image — ${alt}` : "Agrandir l'image"),
  imageAgrandie: (alt: string) => alt || "Image",
  decrire: "Décrire l'image pour l'assistant",
  sansDescription: "Sans description",
  largeur: "Largeur",
  largeurs: { small: "Petite", medium: "Moyenne", full: "Pleine" },
  convertir: "Convertir en tableau",
  desactives: "Les fichiers ne sont pas activés sur cette plateforme.",
  typeRefuse: (types: string) => `Ce type de fichier n'est pas joint à une page. Formats admis : ${types}.`,
  nomRefuse: "Le nom de ce fichier n'est pas admis (trop long, ou avec un caractère invisible) : renommez-le.",
  vide: "Ce fichier est vide : il n'y a rien à joindre.",
  tropLourd: (max: string, maxTexte: string) => `Ce fichier dépasse ${max}, ou ${maxTexte} pour un fichier texte (${TEXTES}).`,
  quota: (quota: string) => `Les fichiers de l'organisation dépasseraient ${quota} : supprimez les pages dont les fichiers ne servent plus.`,
  interdit: "Vous ne pouvez pas joindre de fichier à cette page : il faut pouvoir la modifier.",
  different: "Le fichier reçu ne correspond pas à l'envoi : réessayez.",
  stockage: "Le stockage des fichiers ne répond pas. Réessayez plus tard.",
  illisible: "Le fichier n'a pas pu être lu : téléchargez-le.",
  choix: (nom: string) => `Que faire de ${nom} ?`,
  insererLeContenu: "Insérer le contenu",
  joindre: "Joindre comme fichier",
  importerEnTableau: "Importer en tableau",
  // E10-S02 (lot c) : la visionneuse d'un fichier `html` ou `md` (AC-c2, AC-c4).
  introuvable: "Fichier introuvable",
  pasEnUtf8: "Ce fichier n'est pas en UTF-8 : téléchargez-le.",
  ouvrirLaPage: (titre: string) => `Ouvrir la page ${titre}`,
  banniere: (organisation: string) => `Contenu interactif publié par ${organisation}. N'y saisissez jamais de mot de passe.`,
  quitte: "Ce contenu a tenté de quitter la page.",
  recharger: "Recharger",
  contenuDe: (nom: string) => `Contenu de ${nom}`,
} as const

/**
 * Les phrases des lectures de la visionneuse (`resultatDe`, `portage-ecrans.md § 4`) : un fichier qui n'est pas de
 * l'UTF-8 (raison `not_utf8`), des fichiers désactivés ; un fichier introuvable est `null`, dit par la visionneuse.
 */
export const MESSAGES_DE_LA_VISIONNEUSE = {
  not_utf8: FICHIERS.pasEnUtf8,
  not_enabled: FICHIERS.desactives,
} as const
