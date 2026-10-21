// La carte « Reprendre » de l'accueil, ses nouveautés et les vues des pages (1.4.13) : les formes que rendent
// `server/home-contents.ts` et `server/node-views.ts`, que lisent la page de l'hôte, l'API (« Voir plus ») et l'écran
// (`ui/` ne lit pas `server/`). Sans ce module, le service, l'API et l'écran décriraient chacun une ligne, et
// l'écran écrirait en chiffres les bornes du service.
import * as z from "zod/v4"
import { nodePathSchema, type NodeKind } from "./nodes"

/** Les onglets lus par le service : les contenus modifiés récemment, puis les plus consultés. « Fil » est le journal par gestes. */
export const HOME_TABS = ["recent", "viewed"] as const

export type HomeTab = (typeof HOME_TABS)[number]

/**
 * Les filtres : `me`, ce que la personne a créé ou modifié (à l'écran ou par son assistant, qui écrit sous son nom) ;
 * `teams`, en plus ce que possèdent ses équipes (propriétaire effectif) ; `org`, tout ce qu'elle lit.
 */
export const HOME_SCOPES = ["me", "teams", "org"] as const

export type HomeScope = (typeof HOME_SCOPES)[number]

/** Lignes par page ; « Voir plus » en ajoute autant. */
export const HOME_PAGE_SIZE = 20

/** Le décalage le plus loin qu'une page demande : dix pages de vingt. */
export const HOME_OFFSET_MAX = 180

/** La période des « plus consultés », en jours : vues à l'écran et lectures des assistants. */
export const HOME_VIEWED_DAYS = 30

/** Procédures de « Lancer » : les plus utilisées de la personne. */
export const LAUNCH_PROCEDURES_SHOWN = 5

/** Nouveautés listées au plus. */
export const HOME_NEWS_MAX = 10

/** Sans visite connue, les nouveautés remontent à 14 jours, comme le bloc « What's new » de `context`. */
export const HOME_NEWS_DEFAULT_DAYS = 14

/** Les vues d'une page se gardent 90 jours : assez pour la période des plus consultés, et rien au-delà. */
export const NODE_VIEWS_KEPT_DAYS = 90

/** `GET /api/platform/home?tab=&scope=&offset=` : une page de la carte « Reprendre ». */
export const homeContentsQuerySchema = z.strictObject({
  tab: z.enum(HOME_TABS),
  scope: z.enum(HOME_SCOPES).default("teams"),
  offset: z.coerce.number().int().min(0).max(HOME_OFFSET_MAX).default(0),
})

/** `GET /api/platform/home/activities?scope=` : le fil de l'accueil, au filtre choisi (1.4.13). */
export const homeActivitiesQuerySchema = z.strictObject({ scope: z.enum(HOME_SCOPES).default("teams") })

/** La vue d'une page, enregistrée par la page de l'hôte qui l'affiche. */
export const nodeViewSchema = z.strictObject({ path: nodePathSchema })

/**
 * L'espace d'un contenu, que dit sa ligne : l'équipe propriétaire effective et son nom, Tout le monde (`org`) ou un
 * espace personnel (`user`, « Privé »).
 */
export type HomeSpace = { kind: "team"; name: string } | { kind: "org" } | { kind: "user" }

/**
 * Une ligne de la carte : le contenu (chemin courant, qui l'ouvre ; titre, genre), son espace, la date de sa dernière
 * modification (`recent`) ou de sa dernière consultation (`viewed`). `views` : sur l'onglet `viewed`, les consultations
 * à l'écran et les lectures par un assistant sur `HOME_VIEWED_DAYS` jours.
 */
export type HomeContent = {
  path: string
  title: string
  kind: NodeKind
  space: HomeSpace
  at: string
  views?: { screen: number; assistant: number }
}

/** Une page de la carte ; `hasMore` : « Voir plus » en trouvera d'autres. */
export type HomeContentsPage = { items: HomeContent[]; hasMore: boolean }

/** Une nouveauté : un contenu publié depuis la dernière visite de la personne, par quelqu'un d'autre. */
export type HomeNewsItem = { path: string; title: string; kind: NodeKind; at: string; byName: string | null }

/** Les nouveautés et la date depuis laquelle elles se comptent (la dernière visite, sinon 14 jours). */
export type HomeNews = { since: string; items: HomeNewsItem[] }
