// Les libellés français de l'écran de nœud (E05-S02) : natures, statuts, formes des blocs, et les
// phrases propres aux gestes de l'écran (AC9 à AC18, AC21). Tout autre refus prend le texte de
// `messageDErreur` (`ui/api/messages.ts`), jamais une seconde table.
import type { NodeKind, NodeView } from "../../schemas"
import type { AccessLevelName } from "../../schemas"
import { nLignes } from "../tableau/libelles"

export const NATURES: Record<NodeKind, string> = {
  page: "Page",
  procedure: "Procédure",
  context: "Contexte",
  table: "Tableau",
}

export const INTROUVABLE = "Cette page n'existe pas ou ne vous est pas partagée."
export const PAGE_VIDE = "Cette page n'a pas encore de contenu."
export const ARBRE_TRONQUE = "L'arbre n'affiche que les 5 000 premiers nœuds."

/** Les mots de l'écran porté d'oto-frontend (E05-S09, partie c1) : en-tête, états, accès, sous-pages. */
export const ECRAN = {
  /** Le titre d'un écran qui n'a pas de nœud à nommer (lecture en échec). */
  page: "Page",
  introuvable: "Page introuvable",
  echec: "Ce contenu n'a pas pu être chargé",
  chargement: "Chargement de la page…",
  allerATouLeMonde: "Aller à Tout le monde",
  /** Le périmètre et le verbe qui dit qu'on peut le changer, en un seul bouton (oto-frontend). */
  partager: (espace: string) => `Partager · ${espace}`,
  panneauDePartage: (espace: string) => `Partager — ${espace}`,
  versionPubliee: (revision: number) => `Version publiée (révision ${revision}).`,
  revenirAuxModifications: "Revenir aux modifications en attente",
  rangeAilleurs: "rangé ailleurs",
} as const

/**
 * Un bloc `mermaid` : sa légende en texte (le repli, lu sans JavaScript et sous le dessin), le texte que mermaid ne lit
 * pas, et le nom du dessin (`role="img"`), tiré de son titre ou de sa première ligne.
 */
export const DIAGRAMME = {
  legende: "Diagramme (texte)",
  invalide: "Diagramme invalide",
  voirLeCode: "Voir le code",
  nom: (ligne: string) => (ligne === "" ? "Diagramme" : `Diagramme : ${ligne}`),
} as const

/** Le nom du cadre d'un tableau lu, qui défile en largeur et se prend donc au clavier : un tableau simple, un tableau écrit en texte. */
export const CADRE_DU_TABLEAU = { simple: "Tableau", texte: "Tableau en texte" } as const

/** Les formes qu'écrit l'écran (E05-S10, AC-a2), trois titres comme Notion, leur libellé et le nom du champ ouvert (AC10). */
export const FORMES = {
  texte: { libelle: "Texte", champ: "ce texte" },
  grandTitre: { libelle: "Grand titre", champ: "ce titre" },
  moyenTitre: { libelle: "Moyen titre", champ: "ce titre" },
  petitTitre: { libelle: "Petit titre", champ: "ce titre" },
  puces: { libelle: "Liste à puces", champ: "cette liste" },
  numerotee: { libelle: "Liste numérotée", champ: "cette liste numérotée" },
  cases: { libelle: "Liste à cocher", champ: "cette liste à cocher" },
  citation: { libelle: "Citation", champ: "cette citation" },
  code: { libelle: "Code", champ: "ce code" },
  diagramme: { libelle: "Diagramme", champ: "ce diagramme" },
  // E10-S06 (AC-a1, AC-a3) : le repli au menu « Style », « Menu dépliant » comme Notion ; le tableau simple s'insère seulement.
  repli: { libelle: "Menu dépliant", champ: "ce menu dépliant" },
  tableau: { libelle: "Tableau simple", champ: "ce tableau" },
} as const

/** Le choix du « + » et de « / » (E10-S06, AC-a1, AC-a2) : ses deux groupes, le séparateur, la liste sous le champ. */
export const CHOIX_DE_BLOC = {
  texte: "Texte",
  inserer: "Insérer",
  separateur: "Séparateur",
  liste: "Blocs à insérer",
  aucun: "Aucun bloc",
  ajouter: (mots: string) => `Ajouter un bloc après — ${mots}`,
} as const

/** Le bloc « Iframe » (« Intégration » en 1.4.3) : son entrée au « + » et à « / », le dialogue de son adresse, son menu, son cadre. */
export const INTEGRATION = {
  entree: "Iframe",
  dialogue: "Intégrer une page",
  modifier: "Modifier l'adresse",
  adresse: "Adresse de la page",
  aide: "L'adresse https d'un autre site, ou le code <iframe> qu'il donne (« Intégrer », « Embed ») : une vidéo, une carte, une maquette, un document partagé. Seule l'adresse est gardée.",
  invalide: "Une adresse https, sans espace ni guillemet.",
  valider: "Intégrer",
  annuler: "Annuler",
  hauteur: "Hauteur",
  hauteurs: { small: "Petite", medium: "Moyenne", large: "Grande" },
  titre: (hote: string) => `Contenu intégré de ${hote}`,
  ouvrir: (hote: string) => `Ouvrir ${hote} dans un nouvel onglet`,
} as const

/** Un tableau simple dans l'éditeur (E10-S06, AC-b1, AC-b2) : le nom de chaque cellule par son en-tête, le menu de sa poignée. */
export const TABLEAU_EDITE = {
  enTete: (colonne: number) => `En-tête de la colonne ${colonne}`,
  cellule: (enTete: string, rangee: number) => `${enTete}, rangée ${rangee}`,
  colonne: (colonne: number) => `Colonne ${colonne}`,
  tableau: "Tableau",
  ajouterRangee: "Ajouter une rangée après",
  ajouterColonne: "Ajouter une colonne après",
  retirerRangee: "Retirer la rangée",
  retirerColonne: "Retirer la colonne",
  alignement: "Alignement de la colonne",
  alignements: { aucun: "Aucun", left: "Gauche", center: "Centre", right: "Droite" },
} as const

/** Un menu dépliant dans l'éditeur (E10-S06, AC-b4) : ses deux champs et son chevron. */
export const REPLI_EDITE = {
  resume: (mots: string) => `Résumé du menu dépliant — ${mots}`,
  corps: (mots: string) => `Corps du menu dépliant — ${mots}`,
  /** Le chevron du repli dans l'éditeur, nommé par ce qu'il fera, comme celui d'une branche de l'arbre. */
  plier: (ouvert: boolean, mots: string) => `${ouvert ? "Replier" : "Déplier"} le corps — ${mots}`,
} as const

/** Les plis d'une page : la case « Repliable » d'un titre, et le chevron qui replie ou déplie sa section. */
export const PLIS = {
  repliable: "Repliable",
  section: (ouvert: boolean, titre: string) => `${ouvert ? "Replier" : "Déplier"} la section — ${titre}`,
} as const

/** Les annonces des niveaux de liste (E10-S06, AC-a6) : rien n'a changé, et pourquoi ; la borne est celle du contrôle (`MESSAGES_DU_BLOC`). */
export const NIVEAUX_DE_LISTE = {
  rienAuDessus: "Rien au-dessus de cette ligne.",
  premierNiveau: "Cette ligne est déjà au premier niveau.",
} as const

/** Les phrases de l'éditeur (AC9 à AC15, AC18). */
export const EDITEUR = {
  /**
   * L'invite du Texte seul d'une page vide (E11-S05, AC-g1, HN-E11S05-22), mot pour mot : ce qu'on fait, et « @ » ;
   * rien sur « / ».
   */
  invite: "Commencer à écrire... Utilisez '/' pour afficher tous les types de blocs - Utilisez '@' pour citer un autre contenu (page, tableau, procédure) de l'espace",
  lectureSeule: "Ce bloc se modifie par votre assistant.",
  enregistrement: "Enregistrement…",
  supprime: "Bloc supprimé.",
  conflitAReglerDAbord: "Réglez d'abord le bloc en conflit.",
  refuse: "Vous n'avez pas le droit de modifier cette page. Votre texte est toujours là : copiez-le avant de quitter l'écran.",
  disparu: "Ce bloc ou cette page n'existe plus. Votre texte est toujours là : copiez-le avant de recharger.",
  tropGrand: "Ce bloc est trop long, ou la page est pleine : découpez le texte ou placez-le dans une autre page.",
  reseau: "La requête n'a pas abouti. Réessayez dans un instant : votre texte est toujours là.",
  pageChangee: "La page a changé pendant que vous écriviez : réessayez.",
  blocChange: "Ce bloc a changé pendant que vous écriviez. Votre texte n'a pas été enregistré : composez le texte final à partir de la version enregistrée.",
  blocEncoreChange: "Le bloc a encore changé.",
  blocSupprimeAilleurs: "Ce bloc a été supprimé pendant que vous écriviez.",
  blocGarde: "Ce bloc a été modifié pendant que vous le supprimiez : il est gardé.",
  abandonner: "Abandonner votre texte et garder la version enregistrée ?",
  annulerLesModifications: "Annuler les modifications du bloc",
} as const

/** Les phrases de la publication (AC17) : son refus faute du droit (E11-S02, AC-c4 : écrire publie). */
export const PUBLICATION = {
  refusee: "Vous n'avez pas le droit de publier cette modification.",
} as const

/** Les phrases du titre et du résumé (AC16). */
export const EN_TETE = {
  titreInvalide: "Le titre compte de 1 à 200 caractères.",
  resumeInvalide: "Le résumé compte de 1 à 200 caractères.",
  enregistre: "Titre et résumé enregistrés dans le brouillon.",
  changeAilleurs: "Le titre ou le résumé a changé pendant que vous écriviez.",
  aRenvoyer: "Le brouillon a changé pendant l'enregistrement : enregistrez de nouveau.",
} as const

/** Le genre que l'écran montre et écrit (E05-S04) : celui du brouillon s'il en change, sinon celui du nœud. */
export function genreDuNoeud(vue: Pick<NodeView, "kind" | "draft">): NodeKind {
  return vue.draft?.kind ?? vue.kind
}

/**
 * Le résumé ne se montre, lu ou écrit, que pour une procédure, dont il porte la demande (E11-S05, AC-f1, AC-f2 ;
 * HN-E11S05-15) : sous le titre, dans « Sous-pages », sur la carte d'un contenu cité et sur la page publique. Le
 * résumé des autres genres reste servi à l'assistant.
 */
export const resumeMontre = (genre: string): boolean => genre === "procedure"

/** Les phrases du déplacement (AC20, AC21) ; tout autre refus prend le texte de `messageDErreur`. */
export const DEPLACEMENT = {
  choisir: "Choisissez un parent",
  nouveauChemin: (chemin: string) => `Nouveau chemin : ${chemin}`,
  alias: (chemin: string) => `L'ancien chemin ${chemin} restera valable : les liens et les assistants qui l'emploient seront redirigés.`,
  sousPages: (nombre: number) => (nombre > 1 ? `Ses ${nombre} sous-pages suivent.` : "Sa sous-page suit."),
  proprietaire: "Sans propriétaire propre, la page prendra celui de sa nouvelle place.",
  refuse: "Ce déplacement vous est refusé : il faut la gestion de la page et l'écriture sous le nouveau parent.",
  parentDisparu: "Ce parent n'existe plus ou ne vous est plus partagé.",
  // E05-S13 (AC-20) : plus de bouton « Déplacer » en tête de page, le rail déplace ; l'envoi du formulaire reste.
  envoyer: "Déplacer ici",
  annuler: "Annuler",
  nouveauParent: "Nouveau parent",
} as const

/** Les natures au masculin dans « modifié … » : un Contexte, un tableau (E05-S10, AC-a7). */
const AU_MASCULIN: ReadonlySet<NodeKind> = new Set(["context", "table"])

/**
 * La ligne sous le titre (E05-S10, AC-a7) : « modifiée <quand>, par <qui> », une moitié inconnue se tait ;
 * `null` sans l'une ni l'autre. Le type, l'état, la révision et le propriétaire passent dans son infobulle.
 */
export function modifieeDuNoeud(noeud: Pick<NodeView, "kind">, modifiee: { quand?: string; qui?: string | null }): string | null {
  if (!modifiee.quand && !modifiee.qui) return null
  const accord = AU_MASCULIN.has(noeud.kind) ? "modifié" : "modifiée"
  const quand = modifiee.quand ? ` ${modifiee.quand}` : ""
  const qui = modifiee.qui ? `${quand ? "," : ""} par ${modifiee.qui}` : ""
  return `${accord}${quand}${qui}`
}

/** Les intitulés de l'infobulle de la ligne sous le titre (AC-a7). */
export const INFOBULLE = { type: "Type", etat: "État", revision: "Révision", lignes: "Lignes", proprietaire: "Propriétaire" } as const

/**
 * Le type, l'état et la révision d'un nœud, puis ses lignes pour un tableau : les lignes de l'infobulle (AC-a7) ;
 * sans le mot « brouillon », qui ne se dit plus à l'écran (E11-S02, AC-c4).
 */
export function detailsDuNoeud(noeud: Pick<NodeView, "kind" | "status" | "revision" | "rowsTotal">): { intitule: string; valeur: string }[] {
  const e = AU_MASCULIN.has(noeud.kind) ? "" : "e"
  const publie = noeud.status === "published"
  const lignes = noeud.kind === "table" && noeud.rowsTotal !== undefined ? [{ intitule: INFOBULLE.lignes, valeur: nLignes(noeud.rowsTotal) }] : []
  return [
    { intitule: INFOBULLE.type, valeur: NATURES[noeud.kind] },
    { intitule: INFOBULLE.etat, valeur: publie ? `Publié${e}` : `Non publié${e}` },
    { intitule: INFOBULLE.revision, valeur: publie ? String(noeud.revision) : "aucune" },
    ...lignes,
  ]
}

/** Les niveaux d'accès dans « Partager » (E05-S10, AC-b5), les mots de Notion ; les niveaux eux-mêmes ne changent pas. */
export const NIVEAUX_D_ACCES: Record<AccessLevelName, string> = {
  none: "Aucun accès",
  read: "Peut lire",
  write: "Peut modifier",
  manage: "Accès complet",
}

/** Les phrases du panneau « Partager » (AC-b5) : ni « règle » ni « niveau » à l'écran. */
export const PARTAGE = {
  ajouter: "Ajouter une personne ou une équipe",
  suggestions: "Personnes et équipes",
  rienTrouve: "Aucune personne ni équipe de ce nom.",
  ontAcces: "Ont accès",
  personneAjoutee: "Personne n'a été ajouté à ce contenu.",
  accesGeneral: "Accès général",
  equipe: (nom: string) => `Équipe ${nom}`,
  vous: "vous",
  accesDe: (nom: string) => `Accès de ${nom}`,
  retirer: "Retirer",
  ajoute: (nom: string) => `${nom} peut lire ce contenu.`,
  change: (nom: string, niveau: string) => `${nom} : ${niveau.toLowerCase()}.`,
  retire: (nom: string) => `${nom} n'a plus d'accès propre à ce contenu.`,
  votreAcces: (niveau: string) => `Votre accès : ${niveau.toLowerCase()}.`,
  reserve: "Seules les personnes qui ont l'accès complet changent le partage.",
  toutLeMonde: (organisation: string) => `Tous les membres de ${organisation}`,
  equipeEtAjoutes: (equipe: string) => `L'équipe ${equipe} et les personnes ajoutées`,
  ajoutesSeulement: "Seulement les personnes ajoutées",
  detailEquipe: "L'équipe peut modifier ; son responsable a l'accès complet.",
  detailPerso: (qui: string) => `${qui} a l'accès complet.`,
  introuvable: INTROUVABLE,
} as const

/** Les trois encarts d'un nœud (E11-S05, AC-e1, AC-e4), qui remplacent le bandeau « Contenus liés » (E05-S10, AC-b6). */
export const ENCARTS = {
  citeDans: "Cité dans",
  cite: "Cite",
  sousPages: "Sous-pages",
  chargement: "Lecture des liens…",
  sansCible: "sans cible",
  deplace: (vers: string) => `déplacé vers ${vers}`,
  autres: (nombre: number) => (nombre > 1 ? `et ${nombre} autres` : "et 1 autre"),
} as const

/** Le menu d'un bloc, ouvert par sa poignée (E05-S10, AC-a2). */
export const MENU_DU_BLOC = {
  monter: "Monter",
  descendre: "Descendre",
  style: "Style",
  dupliquer: "Dupliquer",
  supprimer: "Supprimer",
  /** Le nom d'une case d'une liste à cocher, par son texte. */
  case: (texte: string) => `Cocher « ${texte || "élément vide"} »`,
  /** E10-S01 (AC-b7) : un tableau simple devient un tableau de données, sous la page. */
  convertir: "Convertir en tableau de données",
} as const

/**
 * Coller ou déposer du markdown dans l'éditeur, et convertir un tableau simple (E10-S01, AC-a1, AC-a4, AC-b7). Les
 * bornes s'écrivent depuis `schemas/` (`portage-ecrans.md § 6`).
 */
export const MARKDOWN_DANS_L_EDITEUR = {
  tropLong: (max: string) => `Ce texte dépasse ${max} caractères : importez-le comme fichier .md`,
  seulementMarkdown: "Seul un fichier .md s'insère dans une page ; un .csv s'importe depuis le « + » du rail.",
  tableauDe: (titre: string) => `Tableau de ${titre}`,
  convertiDepuis: (titre: string, lignes: string) => `Converti depuis ${titre} (${lignes} lignes)`,
  tableauGarde: (chemin: string) => `Le tableau ${chemin} est créé, mais le bloc n'a pas pu être remplacé : il reste en place.`,
  conversionRefusee: {
    forbidden: "Convertir ce tableau demande la gestion de la page : demandez-la à ses responsables.",
  },
} as const

/** La publication seule (E05-S10, AC-a6) : ce qui se dit quand elle n'aboutit pas ; le texte reste. */
export const PUBLICATION_SEULE = {
  enregistre: "Enregistré.",
  pageChangee: "La page a changé pendant que vous écriviez : votre texte est gardé, il sera publié à votre prochaine modification.",
  reessayer: "Réessayer",
  contexteVide: "Ce contexte est vide : il n'est pas publié tant que vous ne le confirmez pas.",
  // E11-S02 (AC-g1) : le refus d'un en-tête de tableau ne se lève pas à l'écran ; l'assistant l'abandonne.
  enTeteRefuse: "Ce changement d'en-tête est refusé : demandez à votre assistant d'abandonner le brouillon.",
} as const

/** « @ » dans un bloc (E05-S10, AC-a9) : la recherche des contenus à citer. */
export const CITER = {
  liste: "Contenus à citer",
  invite: "Tapez au moins deux lettres du contenu à citer.",
  recherche: "Recherche…",
  aucun: "Aucun contenu trouvé.",
  panne: "La recherche n'a pas abouti. Continuez à taper pour réessayer.",
  /** Avant toute frappe après « @ » (E11-S15, AC-b4). */
  recents: "Vos contenus récents. Tapez au moins deux lettres pour en chercher un autre.",
} as const

/**
 * Le panneau « Lien » d'un bloc (E11-S06, AC-b1 à AC-b5) : modifier le libellé et la destination d'un lien sans lire
 * sa source. La borne du libellé s'écrit depuis `schemas/` (`portage-ecrans.md § 6`).
 */
export const LIEN_DU_BLOC = {
  groupe: "Modifier le lien",
  /** Ce que le champ dit du lien sous son curseur (`aria-describedby`), et la touche qui mène au panneau. */
  decrit: (titre: string) => `Lien vers « ${titre} ». Alt+Entrée pour le modifier.`,
  libelle: "Libellé",
  destination: "Destination",
  page: "Page de la plateforme",
  web: "Adresse web",
  aucunePage: "Aucune page choisie.",
  chercher: "Chercher une page",
  adresse: "Adresse",
  appliquer: "Appliquer",
  retirer: "Retirer le lien",
  ouvrir: "Ouvrir",
  libelleLong: (max: string) => `Le libellé tient en ${max} caractères.`,
  adresseRefusee: "Une adresse web commence par https:// et ne contient pas d'espace.",
  choisirUnePage: "Choisissez une page.",
  change: "Ce lien a changé ; rouvrez-le.",
  /** Le lien construit ne se relit pas tel quel à sa place (un accent grave du libellé, une adresse collée au texte qui suit). */
  illisible: "Ce lien ne se relirait pas tel quel à sa place : changez son libellé ou son adresse.",
} as const

/**
 * L'accès général dans « Partager » (E05-S10, AC-b13 ; ADR-014) : la règle de toute l'organisation, à un niveau,
 * ou aucune ; ce que l'espace donne déjà se dit à côté (Tout le monde lit, l'équipe modifie).
 */
export const ACCES_GENERAL = {
  qui: "Qui a accès en général",
  niveau: "Niveau de toute l'organisation",
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

/** Un nombre de blocs, accordé : « 1 bloc supprimé », « 3 blocs supprimés ». */
const blocs = (nombre: number, participe: string) => `${nombre} ${nombre > 1 ? `blocs ${participe}s` : `bloc ${participe}`}`

/** La sélection de blocs de l'éditeur (E11-S17, lot a) : son nom, son annonce, et ce que disent ses gestes groupés. */
export const SELECTION = {
  /** Le nom de la zone des blocs, qui prend le focus quand toute la page est sélectionnée (AC-a2). */
  zone: "Blocs de la page",
  /** Le nombre de blocs sélectionnés, dans la région vivante et au nom de la zone (AC-a9). */
  nombre: (nombre: number) => blocs(nombre, "sélectionné"),
  supprimes: (nombre: number) => `${blocs(nombre, "supprimé")}.`,
  deplaces: (nombre: number) => `${blocs(nombre, "déplacé")}.`,
  copies: (nombre: number) => `${blocs(nombre, "copié")} en markdown.`,
  copieImpossible: "Copie impossible : le navigateur refuse l'accès au presse-papiers.",
  /** Plus de blocs qu'une page n'en tient : le geste n'est pas fait (fiche D153, `BLOCKS_MAX`). */
  tropDeBlocs: (maximum: string) => `Un geste prend ${maximum} blocs au plus : sélectionnez-en moins.`,
  /** Une écriture groupée refusée en entier par le service : la renvoyer telle quelle échouerait encore. */
  refusee: "Ce geste sur plusieurs blocs a été refusé : rechargez la page pour retrouver les blocs enregistrés.",
  /** La description de la poignée d'un bloc sélectionné (AC-a9). */
  selectionne: "Bloc sélectionné",
} as const
