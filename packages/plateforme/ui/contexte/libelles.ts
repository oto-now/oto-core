// Les libellés français d'un Contexte (E05-S04, AC10 à AC12 ; P39) : qui le reçoit, les noms des blocs de l'aperçu,
// les lignes servies traduites (E05-S13), la publication d'un Contexte (« Ma fiche » : Profil, E05-S11). Tout autre
// refus prend le texte de `messageDErreur` (`ui/api/messages.ts`), jamais une seconde table.
//
// Repris d'oto-frontend (`contexte/annexes-du-contexte.tsx`) : « À quoi sert cette page », une phrase de
// cloisonnement par grain, jamais le nom d'un collègue. Retiré : « déposé dans les instructions du
// serveur MCP » (architecture § 10), l'aide servie (`help`).
import type { TeamView } from "../../schemas"
import { PERSO, SECTION_PERSO, TOUT_LE_MONDE } from "../arbre/depuis-l-arbre"
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
  /** La seconde phrase (HN-E05S13-16) : la fin de l'introduction d'oto-frontend, seule gardée. */
  ecriture: "Vous l'écrivez comme n'importe quelle page.",
} as const

/**
 * La première phrase, par portée (D128, textes de JB) ; le Privé d'une autre personne, au même modèle : le lire ou
 * l'écrire ne le fait pas recevoir (HN-E05S04-22). E11-S15 (AC-a6) : l'assistant se nomme « votre
 * Claude/ChatGPT/Mistral » ; la personne reconnaît le sien.
 */
export function aQuoiSert(portee: Portee): string {
  if (portee.genre === "all") return "Ce que votre Claude/ChatGPT/Mistral, comme celui de chaque membre de l'organisation, lit à chaque conversation."
  if (portee.genre === "equipe") return `Ce que votre Claude/ChatGPT/Mistral, comme celui de chaque membre de l'équipe ${portee.nom}, lit à chaque conversation.`
  if (portee.genre === "private") return "Ce que votre assistant lit à chaque conversation ; vous seul le recevez."
  return "Ce que l'assistant de la personne de cet espace lit à chaque conversation ; elle seule le reçoit."
}

/**
 * Les blocs de `context` qui ne sont pas un Contexte, par leur nom servi (E03-S08) ; un nom inconnu se montre
 * tel quel (AC12). E05-S12 (D109, AC-6, AC-11, AC-20) : le bloc `code` porte les règles de l'espace ; les faits
 * de la personne, de l'organisation et des équipes ouvrent la partie de leur Contexte.
 */
export const NOMS_DES_BLOCS: Readonly<Record<string, string>> = {
  code: "Règles Oto",
  news: "Nouveautés",
  procedures: "Procédures utiles",
  "recent content": "Contenus récents",
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
  return `Contexte : ${portee.genre === "all" ? TOUT_LE_MONDE : SECTION_PERSO}`
}

/**
 * L'encart d'un Contexte (E05-S11, AC-9, retour 4 de JB) : ce que lit l'agent, dans l'ordre. E05-S13 (retour 7, AC-13) :
 * sans taille, état, note des versions ni total ; « Ordre de lecture » ne reste que le nom accessible de la liste.
 */
export const APERCU_DU_CONTEXTE = {
  titre: "Voici ce que votre agent va lire",
  legende: "Ordre de lecture",
  ceContexte: "(ce contexte)",
  echec: "L'aperçu n'a pas pu être calculé.",
} as const

/**
 * La jauge du budget sur la page d'un Contexte (2026-10-20) : son poids, tout ce que l'assistant de la personne recevrait
 * sans plafond, et ce qui se passe au-delà. Les nombres viennent de l'aperçu, jamais écrits ici.
 */
export const JAUGE_DU_BUDGET = {
  nom: "Part du budget du contexte",
  ligne: (total: string, budget: string, poids: string | null) =>
    `${total} / ${budget} caractères · ${poids === null ? "ce contexte pas encore servi" : `ce contexte ${poids}`}`,
  tient: "Tout tient : votre assistant reçoit chaque partie en entier.",
  depasse:
    "Au-delà du budget, les dernières parties sont coupées. Avec une demande, les contextes d'équipe les plus éloignés d'elle sont résumés en une ligne.",
} as const

/**
 * La vue « Contexte » (E05-S11, AC-13 à AC-15) : les parties du texte servi, empilées, sans chiffres (E05-S13) ; son écran
 * (E11-S10, AC-e2), la partie sans corps (AC-f2) et « Nouveautés » sans nouveauté servie (AC-f5).
 */
export const CONTEXTE_SERVI = {
  titre: "Contexte",
  chargement: "Chargement du contexte…",
  omise: "Cette partie ne tient pas dans le budget : l'assistant ne la lit pas.",
  vide: "L'assistant ne reçoit rien de ce contexte pour l'instant.",
  aucuneNouveaute: "Aucune nouveauté n'est servie à l'assistant en ce moment.",
  fin: "Fin du texte",
} as const

/**
 * Ce que la vue « Contexte » explique sous son titre (E11-S15, AC-a8), tiré du service et dit sans jargon : ce qu'est le
 * contexte (`mcp/tools.ts`, description de `context`), comment il vit (servi par l'outil `context`, relu à chaque
 * conversation, seul le publié ; relu quand un Contexte reçu change : `server/ctx.ts`, `requireCtx`), la procédure servie
 * quand le routage la reconnaît dans la demande (`decide` de `server/routing.ts` : seuil et écart), et son ordre (`assembleContext` de
 * `server/context/index.ts`, `contextPaths` et `contextBody` de `blocks/contexts.ts`, les blocs `news`, `procedures`,
 * `recent`, le plafond de `engine.ts`). Aucune borne chiffrée : elles vivent dans `server/`, que l'écran ne lit pas.
 */
export const EXPLICATION_DU_CONTEXTE = {
  ceQuEst: "Le contexte, c'est ce que votre Claude/ChatGPT/Mistral lit au début de chaque conversation sur votre travail, avant de vous répondre.",
  fonctionnement:
    "Oto le lui donne par son outil « context », au début de chaque nouvelle conversation : ce que vous publiez dans un Contexte y arrive dès la suivante, un brouillon jamais. Si la version publiée d'un Contexte que vous recevez change pendant une conversation, l'assistant relit le contexte avant de continuer.",
  ordre: "Il est assemblé dans cet ordre :",
  etapes: [
    "les règles d'Oto, les mêmes pour tous (non montrées ici) ;",
    "la procédure qui correspond à votre demande, quand Oto en reconnaît clairement une (non montrée ici) ;",
    "le Contexte de Tout le monde, puis le vôtre (Privé), puis celui de chacune de vos équipes : chacun s'ouvre sur quelques faits (l'organisation, vous, l'équipe et ses connecteurs), puis son texte, puis la liste des contenus rangés dessous et des pages qu'il cite, par leur titre et leur résumé, sans leur contenu ;",
    "les nouveautés depuis votre dernière conversation : contenus publiés et connecteurs activés ;",
    "les procédures publiées que vous pouvez lire, les plus utilisées par vous et vos équipes d'abord ;",
    "vos contenus récents : les pages et tableaux que vous avez lus ou écrits ces derniers temps.",
  ],
  plafond: "Le tout a une longueur maximale : ce qui dépasse est coupé, et le texte le signale.",
} as const

/** « page », « tableau » : la nature d'un contenu récent servi (`page`, `table`) ; une autre, telle que servie. */
const NATURES: Readonly<Record<string, string>> = { page: "page", table: "tableau" }

/** Accordé au nombre : « 1 procédure », « 3 procédures ». */
function accorde(nombre: number, singulier: string, pluriel: string): string {
  return `${nombreLisible(nombre)} ${nombre > 1 ? pluriel : singulier}`
}

/**
 * Les lignes servies dites en français (E05-S13, retour 8, AC-14, AC-15 ; HN-E05S13-12) ; le texte servi ne change
 * pas. Les dates arrivent lisibles (`dateLisible`), les noms de blocs traduits (`nomDuBloc`).
 */
export const LIGNES_SERVIES = {
  procedures: (nombre: number) => accorde(nombre, "procédure", "procédures"),
  aucuneProcedure: "Aucune procédure publiée.",
  autresProcedures: (nombre: number) => `… et ${accorde(nombre, "autre", "autres")}, que l'assistant trouve par la recherche.`,
  depuis: (date: string) => `Depuis le ${date}`,
  version: (revision: number, date: string) => `version ${revision}, publiée le ${date}`,
  connecteur: (nom: string, date: string) => `Connecteur ${nom} activé le ${date}`,
  rienDeNouveau: "Rien de nouveau.",
  recent: (nature: string, date: string) => `${NATURES[nature] ?? nature}, ${date}`,
  children: "Rangés sous ce contexte",
  linked: "Pages citées",
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
