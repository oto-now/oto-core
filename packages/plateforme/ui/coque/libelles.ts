// Les mots du rail (E05-S09, partie a) : ceux d'oto-frontend (`src/components/coque/`), et ceux des
// écrans de la plateforme qu'il range dans ses menus (HN-E05S09-1). Une seule table, lue par la coque.
// Aucun tiret cadratin (E05-S11, AC-18) : le titre d'un Contexte est `titreDeContexte` (« Contexte · … »).

/** Le « ⋯ » d'une équipe, au titre de sa section du rail : ses personnes, sa suppression (`menu-de-l-equipe.tsx`). */
export const MENU_DE_L_EQUIPE = {
  actions: (nom: string) => `Actions sur l'équipe ${nom}`,
  personnes: (nom: string) => `Les personnes de ${nom}`,
  supprimer: "Supprimer l'équipe…",
  chargement: "Chargement de l'équipe…",
  echec: "L'équipe n'a pas pu être lue",
  reessayer: "Réessayer",
  fermer: "Fermer",
} as const

export const RAIL = {
  accueil: "Accueil",
  arbreEnPanne: "L'arbre n'a pas pu être chargé",
  /** Sous les sections, après trois relectures de l'arbre en échec (E11-S20, AC-6) : l'arbre montré reste. */
  arbreNonActualise: "L'arbre n'a pas pu être actualisé.",
  /** Le bouton qui ouvre le rail en tiroir sous 768 px (fiche D90 B). */
  menu: "Menu",
  /** L'écran de la corbeille (E05-S10, AC-b11), au menu du compte (E05-S11, AC-e22). */
  corbeille: "Corbeille",
  /** L'écran des connecteurs, au pied du rail pour qui administre (E05-S11, AC-32). */
  connecteurs: "Connecteurs",
} as const

/** Le menu de l'entreprise (AC-a4) : les réglages d'oto-frontend, les écrans de la plateforme rangés dessous (E05-S11, AC-33). */
export const ENTREPRISE = {
  reglages: "Réglages de l’entreprise",
  usage: "Usage",
  journal: "Journal",
  retours: "Retours",
  organisation: "Organisation",
  equipes: "Équipes & accès",
  /** L'écran d'abonnement de l'hôte qui vend le paquet (E12-S02) : présent seulement quand l'hôte en donne l'adresse. */
  abonnement: "Abonnement",
  /** Créer une organisation de plus, sous la bascule : présent seulement quand l'hôte donne l'adresse de son inscription. */
  creer: "Créer une organisation",
} as const

/** Le menu du compte, ouvert par l'engrenage du pied : Contexte, Profil, « Brancher mon Claude, ChatGPT ou Mistral », Corbeille, puis Déconnexion (E05-S11, AC-6, AC-e22 ; E11-S09, AC-14). */
export const COMPTE = {
  /** La vue « Contexte », en tête du menu du compte (E11-S10, AC-e1). */
  contexte: "Contexte",
  profil: "Profil",
  brancher: "Brancher mon Claude, ChatGPT ou Mistral",
  deconnexion: "Déconnexion",
  modeSombre: "Mode sombre",
  modeClair: "Mode clair",
  anonyme: "Mon compte",
} as const

/**
 * Ce qu'on crée depuis un « + » (AC-a4), dans chaque section, Privé comprise (E05-S11, AC-34). Depuis
 * E05-S10 (partie b, AC-b3), sans dialogue : le nœud naît avec ces valeurs, puis sa page s'ouvre ; le titre
 * et le résumé s'écrivent en place.
 */
export const CREATION = {
  page: "Une page",
  tableau: "Un tableau",
  procedure: "Une procédure",
  /** Le titre d'un nœud neuf, celui qu'oto-frontend pose (`TITRE_D_UNE_PAGE_NEUVE`) et que le rail montre d'un nom vide. */
  sansTitre: "Sans titre",
  /**
   * Le résumé d'un nœud neuf, selon son genre (E05-S11, retour 21, AC-e21) : le service en exige un (1 à 200
   * caractères) ; il se réécrit en place (HN-E05S10b-2). Celui d'une procédure dit comment l'écrire, le routage le
   * lisant avec le titre (E11-S05, AC-f3 ; ADR-003 § 1).
   */
  resumeParDefaut: {
    page: "Résumé de la page à compléter.",
    table: "Résumé du tableau à compléter.",
    procedure: "Résumé à compléter : dites ce que fait la procédure et comment on la demande, avec les mots de l'équipe. L'assistant la choisit sur ce résumé et sur le titre.",
  },
  /** La colonne clé d'un tableau neuf, sa seule colonne (texte). */
  cle: "nom",
  enCours: "Création…",
  tropProfond: "Cet endroit est trop profond pour y créer un contenu : choisissez un parent plus haut.",
  aucuneAdresse: "Les adresses d'un contenu sans titre sont toutes prises à cet endroit : créez-le ailleurs.",
} as const

/**
 * Déplacer depuis le rail (E05-S10, AC-b7) : glisser-déposer, ou « Déplacer » du « ⋯ » ; la confirmation
 * quand le déplacement change qui voit le contenu, lue sur l'aperçu du service (partie b2), avec les mots des
 * niveaux de « Partager ». Ranger entre frères (AC-b9) : glisser entre deux lignes, « Monter », « Descendre ».
 */
export const DEPLACEMENT_RAIL = {
  action: "Déplacer",
  titre: (nom: string) => `Déplacer « ${nom} »`,
  confirmer: (nom: string) => `Déplacer « ${nom} » ?`,
  quitte: (avant: string, apres: string) => `Il quitte ${avant} pour ${apres}.`,
  gagnent: (noms: string) => `Gagnent l'accès : ${noms}.`,
  perdent: (noms: string) => `Perdent l'accès : ${noms}.`,
  changent: (noms: string) => `Leur accès change : ${noms}.`,
  etAutres: (noms: string, reste: number) => `${noms} et ${reste} ${reste > 1 ? "autres" : "autre"}`,
  proprietaireSeul: "Personne ne gagne ni ne perd l'accès, mais son propriétaire change : il prend celui de sa nouvelle place.",
  sousContenus: (nombre: number) => (nombre > 1 ? `Ses ${nombre} sous-contenus le suivent.` : "Son sous-contenu le suit."),
  geste: "Déplacer",
  enCours: "Déplacement…",
  /** Le refus de l'aperçu qui a sa phrase : le nœud ou sa destination ne sont plus visibles, le rail se relit. */
  refusDeLImpact: { not_found: "Ce contenu ou sa destination n'est plus visible." },
  monter: "Monter",
  descendre: "Descendre",
  rangement: "Rangement…",
  range: (nom: string) => `« ${nom} » a changé de place.`,
  /** Les refus de `nodes/position` qui ont leur phrase (HN-E05S10e-11 : ranger exige la gestion). */
  refusDuRangement: {
    forbidden: "Ranger ce contenu vous est refusé : il faut sa gestion.",
    not_found: "Ce contenu ou son voisin n'est plus visible.",
  },
} as const

/** Les gestes du « ⋯ » d'une ligne (E05-S10, partie b2) : « Dupliquer » (AC-b10), « Supprimer » (AC-b11). */
export const GESTES_DU_RAIL = {
  dupliquer: "Dupliquer",
  duplicationEnCours: "Duplication…",
  supprimer: "Supprimer",
  confirmerLaSuppression: (nom: string) => `Supprimer « ${nom} » ?`,
  corbeille: "Il va à la corbeille : il disparaît du rail, des recherches et des assistants. La Corbeille le restaure à sa place jusqu'à sa purge.",
  partentAvec: (nombre: number) => (nombre > 1 ? `Ses ${nombre} sous-contenus partent avec lui.` : "Son sous-contenu part avec lui."),
  suppressionEnCours: "Suppression…",
  supprime: (nom: string) => `« ${nom} » est à la corbeille.`,
} as const

/** La palette (AC-a7) : ses rubriques, et ce qu'elle dit quand elle ne trouve rien. */
export const PALETTE = {
  placeholder: "Chercher une page, un tableau, une procédure…",
  allerA: "Aller à",
  // Le Contexte de chaque espace, sous « Équipes », comme dans oto-frontend.
  contextes: "Équipes",
  pages: "Pages",
  tableaux: "Tableaux",
  procedures: "Procédures",
  contenu: "Dans le contenu",
  rienTrouve: "Rien de ce nom dans vos pages.",
  arbreAbsent: "Vos pages ne sont pas chargées : seuls les écrans sont proposés ici.",
  recherche: "Recherche dans le contenu…",
  rechercheEnPanne: "La recherche dans le contenu n’a pas répondu. Les titres restent cherchables.",
  plusDeResultats: (nombre: number) =>
    nombre > 1 ? `${nombre} autres pages contiennent ces mots : précisez la recherche.` : "Une autre page contient ces mots : précisez la recherche.",
} as const

/** Les exports du « ⋯ » d'une ligne (E10-S01, AC-a5, AC-b6) : un fichier téléchargé, ou le refus. */
export const EXPORTS = {
  markdown: "Télécharger en .md",
  csv: "Télécharger en .csv",
  enCours: "Préparation du fichier…",
  pret: (nom: string) => `« ${nom} » est téléchargé.`,
  /** Les refus qui ont leur phrase ; les autres passent par `messageDErreur`. */
  refus: {
    invalid_arguments: "Ce contenu n'a pas encore de version publiée à télécharger.",
    too_large: "Ce tableau a trop de lignes pour un export : filtrez-le, ou demandez à un assistant de le lire par pages.",
    not_found: "Ce contenu n'est plus visible.",
  },
} as const

/**
 * « Importer un fichier… » (E10-S01, AC-a3, AC-b1 à AC-b5) : le dialogue, sa zone de dépôt, ses réglages, ses refus
 * et sa progression. Les bornes s'écrivent depuis `schemas/` (`portage-ecrans.md § 6`), formatées par l'écran.
 */
export const IMPORT = {
  entree: "Importer un fichier…",
  titre: "Importer un fichier",
  titreDans: (nom: string) => `Importer dans « ${nom} »`,
  zone: "Déposez un fichier ici, ou choisissez-le",
  choisir: "Choisir un fichier",
  limites: (lignes: string, colonnes: string, mo: string) => `.csv ou .md ; ${lignes} lignes, ${colonnes} colonnes, ${mo} Mo`,
  limitesDuTableau: (lignes: string, mo: string) => `.csv ; ${lignes} lignes, ${mo} Mo`,
  formatRefuse: "Ce fichier n'est ni un .md ni un .csv.",
  tableauSeulement: "Seul un .csv s'importe dans un tableau.",
  tropLourd: (mo: string) => `Ce fichier dépasse ${mo} Mo.`,
  vide: "Ce fichier est vide",
  illisible: "Ce fichier n'a pas pu être lu.",
  pageTropLongue: (max: string) => `Ce fichier dépasse ${max} caractères, la taille d'une page : coupez-le en plusieurs fichiers.`,
  lecture: "Lecture du fichier…",
  pageTitre: "Titre de la page",
  pageResume: "Résumé",
  importer: "Importer",
  annuler: "Annuler",
  envoi: "Import…",
  encodage: "Encodage",
  separateur: "Séparateur",
  separateurs: { ";": "Point-virgule", "\t": "Tabulation", ",": "Virgule" },
  cle: "Colonne clé",
  cleGeneree: (nom: string) => `« ${nom} » générée (0001, 0002…)`,
  type: (colonne: string) => `Type de ${colonne}`,
  types: { text: "Texte", number: "Nombre", date: "Date", datetime: "Date et heure", bool: "Oui ou non", enum: "Liste de valeurs", email: "Email", url: "Lien" },
  apercu: (lignes: number, total: string) => `Aperçu : ${lignes} premières lignes sur ${total}`,
  ignorees: (noms: string) => `Colonnes ignorées (absentes du tableau, ou son état) : ${noms}.`,
  colonneIgnoree: "(ignorée)",
  problemes: "Rien n'est envoyé tant que ces problèmes restent :",
  etAutres: (nombre: number) => `et ${nombre} ${nombre > 1 ? "autres" : "autre"}`,
  cellule: (ligne: number, colonne: string, valeur: string, attendu: string) => `Ligne ${ligne}, colonne ${colonne} : « ${valeur} » n'est pas ${attendu}.`,
  cellules: (ligne: number, compte: string, attendu: string) => `Ligne ${ligne} : ${compte} cellules, l'en-tête en a ${attendu}.`,
  cleVide: (ligne: number, colonne: string) => `Ligne ${ligne}, colonne ${colonne} : la clé est vide.`,
  cleEnDouble: (ligne: number, colonne: string, valeur: string, premiere: number) => `Ligne ${ligne}, colonne ${colonne} : « ${valeur} » est déjà la clé de la ligne ${premiere}.`,
  cleInvalide: (ligne: number, colonne: string, valeur: string) => `Ligne ${ligne}, colonne ${colonne} : « ${valeur} » ne peut pas servir de clé (trop longue, ou un caractère de contrôle).`,
  cleAbsente: (colonne: string) => `La colonne clé du tableau, ${colonne}, manque à l'en-tête du fichier.`,
  guillemet: (ligne: number) => `Ligne ${ligne} : un guillemet n'est jamais fermé.`,
  tropGrand: "Ce fichier dépasse les limites d'un import (lignes, colonnes ou taille d'une cellule).",
  attendus: {
    text: "un texte assez court",
    number: "un nombre",
    date: "une date (AAAA-MM-JJ ou JJ/MM/AAAA)",
    datetime: "une date et heure avec son fuseau",
    bool: "oui ou non",
    enum: "une des valeurs de la liste",
    email: "une adresse email",
    url: "un lien http:// ou https://",
  },
  progression: "Lignes envoyées",
  ecrites: (faites: string, total: string) => `${faites} lignes écrites sur ${total}.`,
  reprendre: "Reprendre",
  conserves: (nombre: number) => `${nombre} ${nombre > 1 ? "éléments conservés" : "élément conservé"} en texte`,
  resumeDuTableau: (nom: string, lignes: string) => `Importé de ${nom} (${lignes} lignes)`,
  aucuneAdresse: "Les adresses tirées de ce nom de fichier sont toutes prises à cet endroit : renommez le fichier.",
  refus: {
    forbidden: "Créer un tableau ici demande l'écriture de cet endroit : demandez-la à ses responsables, ou importez ailleurs.",
    too_large: "Ce fichier dépasse une limite de la page ou du tableau (taille, nombre de blocs ou de lignes).",
  },
} as const
