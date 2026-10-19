// Les listes d'index d'une partie de Contexte servie par `context` (E03-S08, AC12 ; E05-S12, D110 b ; M71) : leurs
// titres, la forme d'une ligne et les pointeurs qui disent la coupe. Écrits par `server/context/blocks/contexts.ts`,
// relus par la vue « Contexte » de l'accueil (`ui/contexte/parties-du-contexte.ts`), qui les montre sous l'éditeur
// d'un Contexte écrivable. Sans ce module, un texte changé côté service ferait disparaître ces listes de l'écran
// sans erreur (`portage-ecrans.md § 6`).
//
// E05-S13 (retour 8, AC-14 à AC-16 ; HN-E05S13-12) : les formats des blocs `procedures`, `news`, `recent content` et
// l'en-tête des règles de l'espace, écrits par `blocks/procedures.ts`, `news.ts`, `recent.ts` et `code.ts`, relus par
// l'écran pour les dire en français ; le texte servi ne change pas d'un octet (tests du texte servi inchangés). La
// ligne « Not loaded » (`blocks/contexts.ts`) et l'avis de budget (`engine.ts`) s'écrivent et se relisent par les
// mêmes constantes.
export const CONTEXT_INDEX = {
  /** Sous-pages, tableaux et procédures du Contexte. */
  children: "Pages, tables and procedures here:",
  /** Les pages que ses blocs citent ailleurs (« cité n'est pas injecté »). */
  linked: "Linked pages:",
  /** Une ligne : `- <chemin> — <titre> — <résumé>`. */
  item: "- ",
  separator: " — ",
  /**
   * Les débuts des deux pointeurs vers `read` d'un Contexte servi en partie, dernière ligne de sa partie
   * (E11-S03) : `Only the first <20> entries are listed. Read the rest: <p>_read {"path": "<chemin>"}.` quand ses
   * listes sont arrêtées (`blocks/contexts.ts`, AC-b2) ; `This context is cut: everything served together exceeds
   * <35,000> characters. Read the rest: …` quand le plafond le coupe (`engine.ts`, AC-b4).
   */
  listsStopped: "Only the first ",
  bodyCut: "This context is cut: everything served together exceeds ",
  /** La fin commune des deux pointeurs, avant l'appel à `read`. */
  readRest: "Read the rest:",
  /** Le début de la ligne d'une partie dont les Contextes n'ont pas pu être lus (`blocks/contexts.ts`, AC13). */
  notLoaded: "Not loaded: read it with ",
} as const

/**
 * Le bloc des procédures utiles : `## Procedures you can run, most used first (<n>)`, puis `- <chemin>: <résumé>` par
 * procédure, ou `None published yet.` ; `… and <k> more: find them with <p>_find, type procedure.` quand toutes ne sont
 * pas listées. Le titre dit l'ordre (usage de la personne et de ses équipes sur 90 jours) : l'agent ne le savait pas.
 */
export const SERVED_PROCEDURES = {
  title: "## Procedures you can run, most used first",
  item: "- ",
  separator: ": ",
  none: "None published yet.",
  moreStart: "… and ",
  moreEnd: " more: find them with ",
} as const

/**
 * Le bloc des nouveautés : `## What's new since <AAAA-MM-JJ>`, puis `- <chemin> v<rév> (<AAAA-MM-JJ>): <titre>` par
 * version, `- Connector <nom> activated (<AAAA-MM-JJ>)` par connecteur, ou `Nothing new.`.
 */
export const SERVED_NEWS = {
  title: "## What's new since ",
  item: "- ",
  revision: " v",
  dateStart: " (",
  dateEnd: "): ",
  connector: "- Connector ",
  activated: " activated (",
  connectorEnd: ")",
  nothing: "Nothing new.",
} as const

/** Le bloc des contenus récents : `## Recent content`, puis `- <chemin> (<genre>, <AAAA-MM-JJ>): <titre>`. */
export const SERVED_RECENT = {
  title: "## Recent content",
  item: "- ",
  kindStart: " (",
  dateStart: ", ",
  dateEnd: "): ",
} as const

/** L'en-tête des règles de l'espace (« Règles Oto », `blocks/code.ts`), suivi d'une ligne `- ` par règle. */
export const SERVED_RULES = {
  title: "## How this workspace works",
  item: "- ",
} as const

/** L'avis de budget (`engine.ts`) : `[Context budget reached. Omitted: <noms>. Use <p>_find or <p>_read for more.]`. */
export const SERVED_BUDGET = {
  start: "[Context budget reached. Omitted: ",
  end: ". Use ",
  /** Un bloc coupé : `<nom> (cut)`. */
  cut: " (cut)",
  /** Les derniers noms comptés : `<noms> and <k> more`. */
  moreStart: " and ",
  moreEnd: " more",
} as const

/**
 * Le bloc des contenus proches de la demande : `## Pages and tables close to the request`, puis
 * `- <chemin> (<genre>, score <s>): <titre>. <résumé>` par contenu, classés comme les procédures par leur titre et leur
 * résumé, puis la consigne de lecture. Sans lui, `context` ne montrait que des procédures, jamais la page qui répond.
 */
export const SERVED_RELATED = {
  title: "## Pages and tables close to the request",
  item: "- ",
} as const
