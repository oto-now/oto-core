// Les mots de l'accueil (E05-S09, partie b) : ceux d'oto-frontend (`src/components/accueil/`), adaptés à la
// plateforme (des assistants branchés, pas des agents d'Oto). Constantes du paquet, jamais un texte venu du
// service (`portage-ecrans.md § 4`) ; une seule table, lue par l'écran et ses îlots.
import { HOME_VIEWED_DAYS, type ActivityVerb, type NodeKind } from "../../schemas"

export const ACCUEIL = {
  bonjour: (nom: string | null) => (nom ? `Bonjour ${nom}` : "Bonjour"),
  chargement: "Chargement de l'accueil…",
  /** L'îlot principal (1.4.13) : « Reprendre », trois onglets. */
  ilot: "Reprendre",
} as const

/** La carte « Reprendre » (1.4.13) : ses onglets, ses filtres, ses lignes. */
export const REPRENDRE = {
  onglets: "Contenus à reprendre",
  recents: "Récents",
  consultes: "Les plus consultés",
  fil: "Fil",
  filtres: "Contenus de",
  moi: "Moi",
  equipes: "Mes équipes",
  organisation: "Toute l'organisation",
  voirPlus: "Voir plus",
  chargement: "Chargement…",
  reessayer: "Réessayer",
  rienRecent: "Aucun contenu modifié ici pour l'instant",
  rienConsulte: `Aucun contenu consulté ces ${HOME_VIEWED_DAYS} derniers jours`,
  rienTexte: "Changez de filtre pour voir plus large.",
  /** Les consultations d'un contenu sur la période des plus consultés, à l'écran et par un assistant. */
  consultations: (total: number) => `${total} consultation${total > 1 ? "s" : ""}`,
} as const

/** L'îlot « Activités » : ce qui est arrivé aux contenus, lu au journal (E05-S12, AC-13). */
export const ACTIVITES = {
  toutLeJournal: "Tout le journal",
  vous: "Vous",
  aujourdhui: "Aujourd'hui",
  hier: "Hier",
  rien: "Aucune activité cette semaine",
  rienTexte: "Ce qui est créé, modifié, publié ou lancé, à l'écran comme par un assistant, s'écrira ici.",
  /** Plusieurs gestes regroupés (AC-14) : lu « 3 fois », montré « ×3 ». */
  fois: (nombre: number) => `×${nombre}`,
  foisLu: (nombre: number) => `${nombre} fois`,
  /** Le lien d'une procédure lancée vers sa conversation au journal (1.4.13). */
  conversation: "Voir la conversation dans le journal",
  voirLaConversation: (titre: string) => `Voir la conversation dans le journal : ${titre}`,
  /** Des lignes à revoir parmi les lignes supprimées (E11-S02, AC-h3). */
  dontARevoir: (nombre: number) => `, dont ${nombre} à revoir`,
} as const

/** Ce qui est arrivé, par verbe du service : à la troisième personne, et après « Vous » (AC-13). */
export const VERBES_DES_ACTIVITES: Record<ActivityVerb, { il: string; vous: string }> = {
  created: { il: "a créé", vous: "avez créé" },
  edited: { il: "a modifié", vous: "avez modifié" },
  published: { il: "a publié", vous: "avez publié" },
  moved: { il: "a déplacé", vous: "avez déplacé" },
  duplicated: { il: "a dupliqué", vous: "avez dupliqué" },
  trashed: { il: "a mis à la corbeille", vous: "avez mis à la corbeille" },
  restored: { il: "a restauré", vous: "avez restauré" },
  wrote_rows: { il: "a écrit dans", vous: "avez écrit dans" },
  reviewed: { il: "a tranché une revue dans", vous: "avez tranché une revue dans" },
  ran: { il: "a lancé", vous: "avez lancé" },
  deleted_rows: { il: "a supprimé des lignes dans", vous: "avez supprimé des lignes dans" },
}

/** La nature d'un contenu, avec son article ; une nature inconnue ne se nomme pas (le chemin suit seul). */
export const NATURES_DES_ACTIVITES: Record<NodeKind, string> = {
  page: "la page",
  table: "le tableau",
  procedure: "la procédure",
  context: "le Contexte",
}

/**
 * L'îlot « Lancer avec Claude » (1.4.13) : les procédures les plus utilisées de la personne, celles du bloc servi par
 * `context`, chacune ouverte dans Claude sur sa demande.
 */
export const LANCER = {
  titre: "Lancer avec Claude",
  rien: "Aucune procédure publiée",
  lancer: "Lancer dans Claude",
  lancerDans: (titre: string) => `Lancer dans Claude : ${titre}`,
  /** La demande que reçoit Claude : le titre et le chemin, par lesquels l'assistant retrouve la procédure. */
  demande: (titre: string, chemin: string) => `Suis la procédure « ${titre} » (${chemin}).`,
} as const

/** L'îlot « Nouveautés » (1.4.13) : ce que d'autres ont publié depuis la dernière visite de la personne. */
export const NOUVEAUTES = {
  titre: "Nouveautés",
  depuis: (date: string) => `Depuis le ${date}`,
  rien: "Rien de nouveau depuis votre dernière visite",
  publiePar: (qui: string | null) => (qui ? `publié par ${qui}` : "publié"),
} as const

/** L'aparté « Brancher votre assistant » (E02-S04, E11-S09 ; 1.4.13) : l'état et la fenêtre du guide. */
export const BRANCHEMENT = {
  /** Le titre court de l'îlot (1.4.13) : il tient sur une ligne avec « Brancher » ; les assistants se nomment dessous. */
  titre: "Brancher votre assistant",
  assistants: ["Claude", "ChatGPT", "Mistral"],
  assistantsLu: "Assistants pris en charge",
  brancher: "Brancher",
  fermer: "Fermer",
  aucun: "Aucun assistant branché",
  derniere: (famille: string, date: string) => `${famille} · dernière connexion le ${date}`,
} as const

export const PREMIER_JOUR = {
  rien: "Rien n'a encore tourné",
  texte:
    "Votre assistant lit vos pages, suit vos procédures et appelle vos outils, dans la limite de vos droits. Branchez-le d'abord : « Brancher votre assistant » vous guide pas à pas.",
} as const
