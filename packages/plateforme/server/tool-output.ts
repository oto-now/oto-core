// Ce que rend un service servi par un outil MCP (N16). Sans ce fichier, les services de server/
// importeraient un type de mcp/, contre le sens des dépendances entre faces (architecture § 3).
import type { ServedViewKind } from "../schemas/views"

/**
 * Plafond d'un résultat, mesuré sur `structuredContent` sérialisé (banc E04, mesure 3) : `read`
 * pagine sous lui (E03-S03, N36), le formateur de `mcp/result.ts` coupe au-delà en dernier rempart.
 */
export const MAX_RESULT_CHARS = 45_000

/** Plafond des données en champs d'un résultat ; au-delà, le formateur les omet. */
export const MAX_DATA_CHARS = 20_000

/**
 * Caractères d'un texte une fois sérialisé en JSON, guillemets exclus : la mesure du plafond (H26),
 * partagée par le formateur (`mcp/result.ts`) et la pagination de `read` (E03-S03).
 */
export function serializedLength(text: string): number {
  return JSON.stringify(text).length - 2
}

export type ToolOutput = {
  /** Ce que le modèle lit, servi à l'identique en texte et en `structuredContent.text` (H26). */
  text: string
  /** Données en champs de `structuredContent` (ids, lignes, dates), en plus du texte. */
  data?: Record<string, unknown>
  /** Noms de fonctions ou d'outils proposés ensuite ; les fonctions sensibles en sont retirées. */
  nextActions?: string[]
  /** Comment lire la suite d'un résultat coupé à 45 000 caractères (curseur, section). */
  continuation?: string
  /** Pour le journal : fonction, chemin ou phrase touchés. */
  target?: string | null
  /** Pour le journal : équipe sous laquelle l'appel a couru. */
  teamId?: string | null
  /** Pour le journal : compte de connecteur sur lequel `call` a couru (E03-S04), nul pour une fonction sans compte. */
  accountId?: string | null
  /** Pour le journal : code `ctx` émis par `context`. */
  ctx?: string
  /** Pour le journal : signature du host (`client_name@version`) portée par le `ctx`. */
  host?: string | null
  /** Pour le journal : ce qu'une fonction de `call` a fait, en nombres, écrit en `args._outcome` (E11-S02, AC-h2). */
  outcome?: Record<string, number>
  /**
   * Pour le journal : la personne dont `call` a servi le compte personnel, quand ce n'est pas l'appelant (partage des
   * comptes, l'équivalent du `lent_by` d'oto 1), écrite en `args._lent_by`.
   */
  lentBy?: string | null
  /**
   * Pour le journal : les valeurs des arguments marqués « donnée personnelle » (`catalog/personal.ts`), retirées de la
   * ligne de l'appel (arguments, cible, erreur) ; jamais servies.
   */
  personal?: readonly string[]
  /**
   * Pour le journal : le travail en tâche de fond qu'un `call` a mis en file, ou dont la ligne dit la fin
   * (`fonctions-longues.md`), écrit en `args._job` : les deux lignes d'un travail se relient par lui.
   */
  job?: string
  /**
   * Pour le journal : la quantité d'un travail en tâche de fond conclu, lue dans sa réponse (`cost.settle`) ou son pire cas,
   * écrite en `args._cost` avec son unité et d'où elle vient.
   */
  cost?: { quantity: number; unit: string; from: string }
  /**
   * La vue du widget qui rend ce résultat ; ses données sont déjà dans `data`. La porte la sert avec le thème quand
   * les widgets sont allumés (`structuredContent.view`), l'ignore sinon (story widgets-dans-la-conversation).
   */
  view?: ServedViewKind
}
