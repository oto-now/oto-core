// Les activités de l'accueil (E05-S12, lot B, AC-12 à AC-17) et ses procédures utiles (AC-18) : les formes
// que rendent `server/activities.ts` et `usefulProcedures`, que lisent la page de l'hôte et l'écran (`ui/` ne
// lit pas `server/`), comme `JournalPage` (`schemas/journal.ts`). Sans ce module, le service et l'écran
// décriraient chacun une activité, et l'écran écrirait en chiffres les bornes du service.
import type { NodeKind } from "./nodes"

/**
 * Ce qui est arrivé à un contenu (HN-E05S12-15) : créé, modifié, publié, déplacé, dupliqué, mis à la
 * corbeille, restauré ; lignes écrites dans un tableau (`table.write`), décision de revue ; procédure lancée ;
 * lignes supprimées d'un tableau (`table.delete_rows`, E11-S02, HN-E11S02-11).
 */
export const ACTIVITY_VERBS = ["created", "edited", "published", "moved", "duplicated", "trashed", "restored", "wrote_rows", "reviewed", "ran", "deleted_rows"] as const

export type ActivityVerb = (typeof ACTIVITY_VERBS)[number]

/** Activités rendues au plus, les plus récentes (AC-13, HN-E05S12-19) ; « Tout le journal » garde les autres. */
export const ACTIVITIES_MAX = 20

/** Deux gestes d'une même personne, sur le même contenu et du même verbe, à moins d'une heure : une ligne (AC-14). */
export const ACTIVITY_GROUP_MS = 3_600_000

/** Procédures utiles montrées à l'accueil (AC-18), par usage puis par chemin (`usefulProcedures`). */
export const USEFUL_PROCEDURES_SHOWN = 6

/**
 * Une activité (AC-13 à AC-15) : un geste, ou plusieurs regroupés (`count`), à l'heure du plus récent (`at`).
 * `path` : le chemin courant quand la personne lit le contenu (`title` alors posé), sinon le chemin tel que le
 * journal le montre, coupé à `private/<handle>` sur l'espace personnel d'autrui (D44). `kind` : nul quand la
 * nature n'est pas sue. `ctx` : la conversation d'une procédure lancée, nul sinon.
 */
export type Activity = {
  /** L'identifiant de la ligne de journal la plus récente du groupe : une clé stable. */
  id: number
  at: string
  userId: string | null
  /** `null` : la personne n'est plus membre (« Personne retirée »). */
  userName: string | null
  verb: ActivityVerb
  kind: NodeKind | null
  path: string
  /** Le titre, seulement si la personne lit le contenu (niveau ≥ lecture) ; sinon ni titre ni lien. */
  title: string | null
  count: number
  ctx: string | null
  /** Lignes à revoir parmi les lignes supprimées (`deleted_rows`), sommées sur le groupe (E11-S02, AC-h3) ; absent sans elles. */
  inReview?: number
}

/** Les activités de la période, la plus récente d'abord ; `truncated` : la période compte plus de lignes que la lecture n'en prend. */
export type ActivityPage = { activities: Activity[]; truncated: boolean }

/** Une procédure utile (AC-18) : publiée, lue par la personne, dans l'ordre du bloc servi (usage 90 jours, puis chemin). */
export type UsefulProcedure = { path: string; title: string }
