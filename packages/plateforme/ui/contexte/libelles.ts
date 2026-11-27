// Les libellés français d'un Contexte (E05-S04, AC10 à AC12 ; P39) : qui le reçoit, les noms des blocs de l'aperçu,
// les lignes servies traduites (E05-S13), la publication d'un Contexte (« Ma fiche » : Profil, E05-S11). Tout autre
// refus prend le texte de `messageDErreur` (`ui/api/messages.ts`), jamais une seconde table.
//
// Repris d'oto-frontend (`contexte/annexes-du-contexte.tsx`) : « À quoi sert cette page », une phrase de
// cloisonnement par grain, jamais le nom d'un collègue. Retiré : « déposé dans les instructions du
// serveur MCP » (architecture § 10), l'aide servie (`help`).
import type { TeamView } from "../../schemas"
import { PERSO, SECTION_PERSO, titreDeContexte, TOUT_LE_MONDE } from "../arbre/depuis-l-arbre"
import { nombreLisible } from "../format/nombres"
import { estUnContexte } from "./parties-du-contexte"

/** Les équipes de l'organisation (`listTeams`) : le nom d'un Contexte d'équipe. */
export type EquipesNommees = readonly Pick<TeamView, "slug" | "name">[]

/**
 * La portée d'un Contexte, par son chemin (P39) : `contexte`, `<équipe>/contexte`, `private/<handle>/contexte` ;
 * `private-d-autrui` : le Contexte Perso d'une autre personne, qui l'a partagé, servi à elle seule.
 */
export type Portee = { genre: "all" } | { genre: "equipe"; nom: string } | { genre: "private" } | { genre: "private-d-autrui" }

/** La portée d'un Contexte par son chemin (P39) ; une équipe se nomme par `listTeams`, sinon par son slug. */
export function porteeDe(chemin: string, equipes: EquipesNommees): Portee {
  if (chemin === "contexte") return { genre: "all" }
  // `private` seul : la partie du Privé d'une personne sans `handle` (E05-S12, AC-3).
  if (chemin === PERSO || chemin.startsWith(`${PERSO}/`)) return { genre: "private" }
  const slug = chemin.split("/")[0]
  return { genre: "equipe", nom: equipes.find((equipe) => equipe.slug === slug)?.name ?? slug }
}

/**
 * « À quoi sert cette page » (E05-S13, retour 9, AC-17 ; D128) : deux phrases dans un seul style, qui le reçoit par sa
 * portée, puis comment il s'écrit ; sans « Reçu par », ni recharge, ni cloisonnement en pied.
 */
export const ANNEXES = {
  titre: "À quoi sert cette page",
} as const

/**
 * La première phrase, par portée (D128, textes de JB) ; le Privé d'une autre personne, au même modèle : le lire ou
 * l'écrire ne le fait pas recevoir (HN-E05S04-22). E11-S15 (AC-a6) : l'assistant se nomme « votre
 * Claude/ChatGPT/Mistral » ; la personne reconnaît le sien.
 */
export function aQuoiSert(portee: Portee): string {
  if (portee.genre === "all") return "Ce que votre Claude/ChatGPT/Mistral, comme celui de chaque membre de l'organisation, lit à chaque conversation."
  if (portee.genre === "equipe") return `Ce que votre Claude/ChatGPT/Mistral, comme celui de chaque membre de l'équipe ${portee.nom}, lit à chaque conversation.`
  // « Mes instructions » : ce que suit l'assistant de la personne, quel qu'il soit.
  if (portee.genre === "private") return "Ce que votre assistant suit pour vous, quel qu'il soit ; vous seul le recevez."
  return "Ce que l'assistant de la personne de cet espace lit à chaque conversation ; elle seule le reçoit."
}

/**
 * La reprise sur « Mes instructions » : la phrase que la personne copie dans son assistant, qui range dans la page les
 * préférences qu'il garde dans sa mémoire ; sans elle, ces préférences restent dans un seul assistant.
 */
/** La section du pied d'un Contexte (refonte #217) : la jauge, puis l'ordre de lecture. */
export const PIED_DU_CONTEXTE = { titre: "Ce que reçoit votre assistant" } as const

export const REPRISE_DES_PREFERENCES = {
  explication: "Votre assistant garde déjà des préférences ? Copiez-lui cette phrase : il les range ici.",
  phrase: "Range mes préférences actuelles dans mes instructions Oto, sans doublon",
  cible: "la phrase de reprise",
} as const

/**
 * Les blocs de `context` qui ne sont pas un Contexte, par leur nom servi (E03-S08) ; un nom inconnu se montre
 * tel quel (AC12). E05-S12 (D109, AC-6, AC-11, AC-20) : le bloc `code` porte les règles de l'espace ; les faits
 * de la personne, de l'organisation et des équipes ouvrent la partie de leur Contexte.
 */
export const NOMS_DES_BLOCS: Readonly<Record<string, string>> = {
  code: "Règles Oto",
  guests: "Partagé avec vous",
  related: "Pages et tableaux proches de la demande",
  "recent content": "Contenus récents et nouveautés",
}

/**
 * Le nom d'un bloc servi (AC12) : la partie d'un Contexte, reconnue à son `name` (le chemin de son Contexte,
 * servi ou non, E05-S12 AC-6), nommée par sa portée (l'équipe par son nom ; le Privé servi est celui de la
 * personne) ; les autres par leur nom servi traduit, un nom inconnu tel quel. Lu par l'encart d'un Contexte et
 * par la vue « Contexte » de l'accueil (E05-S11, AC-13).
 */
export function nomDuBloc(bloc: { name: string }, equipes: EquipesNommees): string {
  if (!estUnContexte(bloc.name)) return NOMS_DES_BLOCS[bloc.name] ?? bloc.name
  const portee = porteeDe(bloc.name, equipes)
  if (portee.genre === "equipe") return `Contexte : équipe ${portee.nom}`
  // Le Privé servi se nomme comme son titre, « Mes instructions » : un seul nom pour la même page.
  return portee.genre === "all" ? `Contexte : ${TOUT_LE_MONDE}` : titreDeContexte(SECTION_PERSO)
}

/**
 * L'encart d'un Contexte (E05-S11, AC-9, retour 4 de JB) : ce que lit l'agent, dans l'ordre. E05-S13 (retour 7, AC-13) :
 * sans taille, état, note des versions ni total ; « Ordre de lecture » ne reste que le nom accessible de la liste.
 */
export const APERCU_DU_CONTEXTE = {
  legende: "Ordre de lecture",
  ceContexte: "(ce contexte)",
  echec: "L'aperçu n'a pas pu être calculé.",
} as const

/**
 * La jauge du budget sur la page d'un Contexte (2026-10-20) : son poids, tout ce que l'assistant de la personne recevrait
 * sans plafond, et ce qui se passe au-delà. Les nombres viennent de l'aperçu, jamais écrits ici.
 */
export const JAUGE_DU_BUDGET = {
  /** « Votre assistant reçoit 13 971 caractères de contexte sur 35 000 possibles ; celui-ci en pèse 64. » */
  phrase: ({ total, budget, poids, depasse }: { total: string; budget: string; poids: string | null; depasse: boolean }) =>
    `Votre assistant reçoit ${total} caractères de contexte sur ${budget} possibles${depasse ? " : la suite est coupée ou résumée." : " ;"} ${depasse ? "Celui-ci" : "celui-ci"} ${poids === null ? "n'est pas encore servi." : `en pèse ${poids}.`}`,
  tient: "Tout tient.",
  depasse: "Le plafond est dépassé.",
} as const

/**
 * La vue « Contexte » (E05-S11, AC-13 à AC-15) : les parties du texte servi, empilées, sans chiffres (E05-S13) ; son écran
 * (E11-S10, AC-e2) et la partie sans corps (AC-f2).
 */
export const CONTEXTE_SERVI = {
  titre: "Contexte",
  chargement: "Chargement du contexte…",
  omise: "Cette partie ne tient pas dans le budget : l'assistant ne la lit pas.",
  vide: "L'assistant ne reçoit rien de ce contexte pour l'instant.",
  fin: "Fin du texte",
} as const

/**
 * Ce que la vue « Contexte » explique sous son titre (E11-S15, AC-a8), tiré du service et dit sans jargon : ce qu'est le
 * contexte (`mcp/tools.ts`, description de `context`), comment il vit (servi par l'outil `context`, relu à chaque
 * conversation, seul le publié ; relu quand un Contexte reçu change : `server/ctx.ts`, `requireCtx`), la procédure servie
 * quand le routage la reconnaît dans la demande (`decide` de `server/routing.ts` : seuil et écart), et son ordre (`assembleContext` de
 * `server/context/index.ts`, `contextPaths` et `contextBody` de `blocks/contexts.ts`, le bloc `recent` et ses nouveautés,
 * le plafond de `engine.ts`). Aucune borne chiffrée : elles vivent dans `server/`, que l'écran ne lit pas.
 */
export const EXPLICATION_DU_CONTEXTE = {
  ceQuEst: "Le contexte, c'est ce que votre Claude/ChatGPT/Mistral lit au début de chaque conversation sur votre travail, avant de vous répondre.",
  fonctionnement:
    "Oto le lui donne par son outil « context », au début de chaque nouvelle conversation : ce que vous publiez dans un Contexte y arrive dès la suivante, un brouillon jamais. Si la version publiée d'un Contexte que vous recevez change pendant une conversation, l'assistant relit le contexte avant de continuer.",
  ordre: "Il est assemblé dans cet ordre :",
  etapes: [
    "l'adresse de cet Oto et ses règles, les mêmes pour tous (non montrées ici) ;",
    "les procédures les plus proches de votre demande, la meilleure en tête quand Oto en reconnaît clairement une, que l'assistant lit avant d'en suivre les étapes, et les pages et tableaux proches (montrés quand vous testez une demande) ;",
    "le Contexte de Tout le monde, puis le vôtre (Privé), puis celui de chacune de vos équipes : chacun s'ouvre sur quelques faits (l'organisation, vous, l'équipe et ses connecteurs), puis son texte, puis la liste des contenus rangés dessous et des pages qu'il cite, par leur titre et leur résumé, sans leur contenu ;",
    "ce que d'autres équipes partagent avec vous, calculé d'après les partages : votre assistant sait ce qu'il peut lire dans les équipes dont vous n'êtes pas membre ;",
    "vos contenus récents, les pages et tableaux que vous avez lus ou écrits ces derniers temps, avec les nouveautés depuis votre dernière conversation (contenus publiés, marqués comme tels, et connecteurs activés).",
  ],
  plafond: "Le tout a une longueur maximale : ce qui dépasse est coupé, et le texte le signale.",
} as const

/**
 * « Tester une demande » sur l'écran « Contexte » : le champ, ce que la demande testée donne (la procédure retenue, les
 * proches, leur score), et le texte exact envoyé à l'assistant avec sa taille dans le plafond.
 */
export const TEST_D_UNE_DEMANDE = {
  champ: "Tester une demande",
  indice: "Ex. : relance les devis en attente",
  tester: "Tester",
  legende: (demande: string) => `Ce que votre assistant recevrait pour : « ${demande} »`,
  revenir: "Revenir au contexte sans demande",
  routage: "Procédures pour cette demande",
  retenue: "Procédure retenue",
  aucune: "Aucune procédure retenue",
  proches: "Procédures proches",
  score: (score: number) => `score ${score.toFixed(2).replace(".", ",")}`,
  texteExact: "Texte exact envoyé à l'assistant",
  /** Le titre en deux morceaux : sur un écran étroit, seul le premier est montré, pour que la taille tienne sur sa ligne. */
  texteExactCourt: "Texte exact",
  texteExactSuite: " envoyé à l'assistant",
  taille: (caracteres: string, plafond: string) => `${caracteres} caractères sur ${plafond}`,
} as const

/** La nature d'un contenu récent ou nouveau servi (`page`, `table`, `procedure`, `context`) ; une autre, telle que servie. */
const NATURES: Readonly<Record<string, string>> = { page: "page", table: "tableau", procedure: "procédure", context: "contexte" }

/** Accordé au nombre : « 1 procédure », « 3 procédures ». */
function accorde(nombre: number, singulier: string, pluriel: string): string {
  return `${nombreLisible(nombre)} ${nombre > 1 ? pluriel : singulier}`
}

/**
 * Les lignes servies dites en français (E05-S13, retour 8, AC-14, AC-15 ; HN-E05S13-12) ; le texte servi ne change
 * pas. Les dates arrivent lisibles (`dateLisible`), les noms de blocs traduits (`nomDuBloc`).
 */
export const LIGNES_SERVIES = {
  depuis: (date: string) => `Nouveau : publié depuis le ${date}`,
  version: (nature: string, revision: number, date: string) => `${NATURES[nature] ?? nature}, nouveau : version ${revision}, publiée le ${date}`,
  connecteur: (nom: string, date: string) => `Connecteur ${nom} activé le ${date}`,
  recent: (nature: string, date: string) => `${NATURES[nature] ?? nature}, ${date}`,
  /** Les commentaires d'un autre arrivés depuis la conversation précédente, dans des fils destinés à la personne. */
  nouveauxCommentaires: (nombre: number) => accorde(nombre, "nouveau commentaire", "nouveaux commentaires"),
  /** Les fils du contenu qui attendent un assistant. */
  pourLAssistant: (nombre: number) => `${accorde(nombre, "fil", "fils")} en attente d'un assistant`,
  children: "Rangés sous ce contexte",
  linked: "Pages citées",
  /** L'équipe d'une vue invité, et ses responsables quand elle en nomme. */
  equipe: (nom: string, responsables: string) => (responsables === "" ? `Équipe ${nom}` : `Équipe ${nom} · ${responsables.includes(", ") ? "Responsables" : "Responsable"} : ${responsables}`),
  /** Un contenu proche de la demande testée : son genre et son score. */
  proche: (nature: string, score: string) => `${NATURES[nature] ?? nature}, score ${score.replace(".", ",")}`,
  /** Le dernier repli : les contenus qu'une équipe partage, comptés. */
  partages: (nombre: number) => (nombre > 1 ? `${nombreLisible(nombre)} contenus partagés avec vous` : "1 contenu partagé avec vous"),
  /** Les contenus lisibles sous un dossier partagé. */
  dessous: (nombre: number) => `et ${accorde(nombre, "contenu", "contenus")} dessous`,
  suite: "La suite de ce contexte est lue à la demande.",
  nonCharge: "Non chargé : l'assistant le lira à la demande.",
  coupe: (nom: string) => `${nom} (coupé)`,
  autres: (nombre: number) => accorde(nombre, "autre", "autres"),
  budget: (noms: string) => `Budget atteint : l'assistant ne lit pas ${noms}.`,
} as const

/** La publication d'un Contexte (AC11, HN-E05S04-10) ; sans phrase de recharge (E11-S10, AC-g3). */
export const PUBLICATION_DU_CONTEXTE = {
  question: "Publier un contexte vide ? Le modèle ne recevra plus rien de ce contexte.",
  confirmer: "Publier quand même",
} as const
