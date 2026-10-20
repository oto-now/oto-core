// L'usage d'une organisation (E08-S09, FR-OBS-04) : les paramètres de l'adresse `/admin/usage` et la
// forme que `server/usage.ts` rend à l'écran. Sans ce module, la page lirait ses paramètres bruts et
// l'écran devinerait la forme du calcul.
import * as z from "zod/v4"
import { journalPeriodSchema } from "./journal"

/**
 * Appels lus au plus dans une fenêtre, les plus récents (AC8, N2) : au-delà, le calcul le dit. Ici,
 * face commune, pour que le service qui borne et l'écran qui dit la borne lisent la même valeur.
 */
export const USAGE_MAX_LINES = 20_000

/**
 * `period` et `team`, noms des paramètres de `/journal` (E05-S05 ; en anglais, E11-S07) : 30 jours par défaut et
 * pour toute valeur inconnue (N3) ; un identifiant d'équipe mal formé est ignoré (AC2).
 */
export const usageQuerySchema = z.object({
  period: journalPeriodSchema.catch(30),
  team: z.uuid().optional().catch(undefined),
})

export type UsageQuery = z.output<typeof usageQuerySchema>
export type UsagePeriod = UsageQuery["period"]

/** Le tableau de bord d'usage (AC3 à AC8), sur les lignes `tools/call` de la fenêtre. */
export type UsageSummary = {
  periode: UsagePeriod
  /** L'équipe du filtre ; `null` sans filtre, ou pour un identifiant inconnu. */
  team: { id: string; name: string } | null
  /** Plus de `USAGE_MAX_LINES` appels dans la fenêtre : le calcul porte sur les plus récents (AC8). */
  truncated: boolean
  /** La date de la plus ancienne ligne lue quand le calcul est tronqué. */
  coveredFrom: string | null
  totals: { conversations: number; people: number; calls: number; errors: number }
  procedures: { path: string; title: string; served: number; conversations: number; people: number; lastServedAt: string }[]
  functions: { name: string; calls: number; errors: number; lastError: { message: string; at: string } | null }[]
  unmatched: { count: number; items: { ctx: string; at: string; person: string | null; phrase: string; host: string | null }[] }
  /** Les blocs des statistiques (1.4.13) : adoption, contenu, partage et connecteurs, sur la même fenêtre. */
  statistics: UsageStatistics
}

/**
 * Jours sans connexion ni appel d'assistant au-delà desquels une personne connectée une fois est inactive (1.4.13) :
 * le service le décide, l'écran le dit.
 */
export const INACTIVE_DAYS = 30

/** Une semaine de la fenêtre, par la date de son lundi (UTC, `AAAA-MM-JJ`). */
export type UsageWeek = string

/**
 * Les statistiques de l'écran (1.4.13), calculées par le service sur la fenêtre et, quand il y en a un, le filtre
 * d'équipe (ses membres d'aujourd'hui) ; les liens publics et les connecteurs activés sont ceux de toute l'organisation.
 */
export type UsageStatistics = {
  adoption: {
    /** Chaque semaine de la fenêtre : les personnes qui y ont ouvert une conversation, et ces conversations. */
    weeks: { week: UsageWeek; people: number; conversations: number }[]
    /** Les conversations par assistant (Claude, ChatGPT…), lu sur le client de la conversation ; `null` : non dit. */
    assistants: { name: string | null; conversations: number }[]
    pendingInvitations: number
    /** Les membres qui ne se sont jamais connectés, par nom (20 au plus). */
    neverSignedIn: { count: number; names: string[] }
  }
  content: {
    /** Chaque semaine de la fenêtre : les contenus créés, et les publications. */
    weeks: { week: UsageWeek; created: number; published: number }[]
    /** Les blocs publiés écrits dans la fenêtre, par un assistant ou à la main. */
    written: { assistant: number; human: number }
    /** Les contenus que les assistants lisent le plus (`read`), ceux que l'appelant lit seulement. */
    mostRead: { path: string; title: string; reads: number; conversations: number }[]
  }
  sharing: {
    publicLinks: { active: number; created: number }
    /** Les connecteurs activés, et toute famille de fonctions appelée par `call` (`table`, `mail`…). */
    connectors: { name: string; label: string | null; active: boolean; calls: number; errors: number }[]
  }
  /** Chaque équipe, ou celle du filtre (1.4.13, onglet Statistiques de « Activité »). */
  teams: UsageTeamRow[]
  /** Chaque membre, ou ceux de l'équipe du filtre. */
  people: UsagePersonRow[]
}

/**
 * Une équipe sur la fenêtre : ses membres d'aujourd'hui, ceux qui ont ouvert une conversation (leur part, le taux
 * d'usage, se calcule à l'écran), leurs conversations et appels, les contenus qu'ils ont écrits, les procédures servies
 * et la plus servie (nommée seulement quand l'appelant la lit), leur dernier appel.
 */
export type UsageTeamRow = {
  id: string
  name: string
  members: number
  activeMembers: number
  conversations: number
  calls: number
  pages: number
  proceduresServed: number
  topProcedure: { path: string; title: string } | null
  lastActivity: string | null
}

/**
 * Une personne : ses équipes, sa dernière connexion à l'écran (`members.last_sign_in_at`), son dernier appel d'assistant
 * (au-delà de la fenêtre), ses conversations et appels de la fenêtre, les contenus écrits à la main ou par son assistant,
 * l'assistant qu'elle emploie le plus ; jamais connectée, ou inactive depuis 30 jours (ni connexion ni appel).
 */
export type UsagePersonRow = {
  userId: string
  name: string
  teams: string[]
  lastSignInAt: string | null
  lastAssistantUse: string | null
  conversations: number
  calls: number
  pagesByHand: number
  pagesByAssistant: number
  assistant: string | null
  neverSignedIn: boolean
  inactive: boolean
}
