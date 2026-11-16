// Les listes d'index d'une partie de Contexte servie par `context` (E03-S08, AC12 ; E05-S12, D110 b ; M71) : leurs
// titres, la forme d'une ligne et les pointeurs qui disent la coupe. Écrits par `server/context/blocks/contexts.ts`,
// relus par la vue « Contexte » de l'accueil (`ui/contexte/parties-du-contexte.ts`), qui les montre sous l'éditeur
// d'un Contexte écrivable. Sans ce module, un texte changé côté service ferait disparaître ces listes de l'écran
// sans erreur (`portage-ecrans.md § 6`).
//
// E05-S13 (retour 8, AC-14 à AC-16 ; HN-E05S13-12) : les formats du bloc `recent content` (nouveautés comprises depuis
// le 2026-10-27) et l'en-tête des règles de l'espace, écrits par `blocks/recent.ts` et `code.ts`, relus par
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
 * Le bloc des contenus récents et des nouveautés (« What's new » et « Recent content » fusionnés le 2026-10-27) :
 * `## Recent content`, suivi de ` (new: published since <AAAA-MM-JJ>)` quand la borne des nouveautés est connue, puis une
 * ligne par contenu : `- <chemin> (<genre>, <AAAA-MM-JJ>): <titre>` pour un contenu lu ou écrit par la personne,
 * `- <chemin> (<genre>, new v<rév>, <AAAA-MM-JJ>): <titre>` pour une version publiée depuis la borne, et
 * `- Connector <nom> activated (<AAAA-MM-JJ>)` pour un connecteur activé depuis la borne. Un contenu que la personne écrit
 * et dont des fils de commentaires attendent un assistant porte, avant sa date, `<n> comment for the assistant` ou
 * `<n> comments for the assistant` : `- <chemin> (<genre>, 2 comments for the assistant, <AAAA-MM-JJ>): <titre>`. Un contenu
 * dont un fil destiné à la personne porte des commentaires d'un autre depuis la borne porte, avant cette mention,
 * `<n> new comment` ou `<n> new comments` : `- <chemin> (<genre>, 2 new comments, <AAAA-MM-JJ>): <titre>`.
 */
export const SERVED_RECENT = {
  title: "## Recent content",
  sinceStart: " (new: published since ",
  sinceEnd: ")",
  item: "- ",
  kindStart: " (",
  newMark: "new v",
  newCommentOne: " new comment",
  newCommentMany: " new comments",
  forAssistantOne: " comment for the assistant",
  forAssistantMany: " comments for the assistant",
  /** La consigne servie une fois, après les lignes, dès que l'une d'elles porte une marque de commentaires : sans elle, l'assistant voit le compte sans savoir où lire les fils. */
  commentsHint: "Comments: read a page marked above to get its open comment threads, each with the exact call to reply and to resolve.",
  dateStart: ", ",
  dateEnd: "): ",
  connector: "- Connector ",
  activated: " activated (",
  connectorEnd: ")",
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
