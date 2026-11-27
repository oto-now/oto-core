// L'historique des versions d'un contenu (tiroir « Historique des versions ») : les entrées et les formes que
// `server/nodes/history.ts` rend aux routes `nodes/history`, `nodes/history/diff` et `nodes/restore`, et que le tiroir
// de l'écran lit. Une seule source pour le service et l'écran (`portage-ecrans.md § 6`). Sans lui, l'écran recopierait
// la forme du service et la taille d'une page.
import * as z from "zod/v4"
import { nodePathSchema, type NodeKind } from "./nodes"

/** Les versions servies par page de la liste, de la plus récente à la plus ancienne. */
export const HISTORY_PAGE_SIZE = 20

/** Les blocs d'un écart servis au plus ; `total` dit les autres. */
export const HISTORY_DIFF_BLOCKS_MAX = 50

const blockIdSchema = z.guid("Block: the id of a block of the page.")
const revisionSchema = z.coerce.number().int().min(1).max(2_147_483_647)

/** `GET nodes/history?path=&block=&cursor=` : `cursor`, la révision sous laquelle la page suivante commence. */
export const nodeHistoryQuerySchema = z.strictObject({ path: nodePathSchema, block: blockIdSchema.optional(), cursor: revisionSchema.optional() })

/** `GET nodes/history/diff?path=&revision=&block=` : la révision lue contre la précédente gardée. */
export const nodeHistoryDiffQuerySchema = z.strictObject({ path: nodePathSchema, revision: revisionSchema, block: blockIdSchema.optional() })

/** `POST nodes/restore` : la version à rétablir, sur la révision que l'écran a lue. */
export const restoreRevisionSchema = z.strictObject({
  path: nodePathSchema,
  revision: z.number().int().min(1).max(2_147_483_647),
  base_revision: z.number().int().min(1).max(2_147_483_647),
})

export type NodeHistoryQuery = z.infer<typeof nodeHistoryQuerySchema>
export type NodeHistoryDiffQuery = z.infer<typeof nodeHistoryDiffQuerySchema>
export type RestoreRevisionInput = z.infer<typeof restoreRevisionSchema>

/** Ce qu'une version a changé depuis la précédente gardée, compté ; l'écran en tire sa ligne. */
export type HistorySummary = {
  /** La première version gardée : le contenu créé. */
  created: boolean
  title: boolean
  summary: boolean
  kind: boolean
  /** L'en-tête d'un tableau (ses colonnes) a changé. */
  schema: boolean
  added: number
  changed: number
  moved: number
  deleted: number
  /** Une seule section ajoutée ou retirée, et rien d'autre : son titre. */
  section: { title: string; change: "added" | "deleted" } | null
}

export type HistoryEntry = {
  revision: number
  at: string
  /** `null` : l'auteur n'est plus membre, ou son compte a été supprimé (« Ancien membre »). */
  author: { name: string } | null
  summary: HistorySummary
}

export type NodeHistoryView = {
  path: string
  kind: NodeKind
  /** La révision publiée courante : celle qu'on ne rétablit pas. */
  revision: number
  /** L'appelant écrit le contenu : « Revenir à cette version » lui est offert (le service le revérifie). */
  writable: boolean
  entries: HistoryEntry[]
  /** Le curseur de la page suivante, `null` à la dernière. */
  next: number | null
}

export type HistoryBlockChange = {
  id: string
  change: "added" | "deleted" | "changed" | "moved"
  /** Le titre de la section du bloc (dans la version d'arrivée, ou de départ pour un retrait) ; `null` en tête de page. */
  section: string | null
  /** Le texte du bloc avant et après, en markdown ; `null` du côté où il n'existe pas. */
  before: string | null
  after: string | null
}

export type HistoryHeaderChange = { before: string; after: string }

export type NodeHistoryDiffView = {
  revision: number
  /** La révision comparée, `null` pour la première version gardée. */
  previous: number | null
  header: { title?: HistoryHeaderChange; summary?: HistoryHeaderChange; kind?: HistoryHeaderChange }
  schema: boolean
  blocks: HistoryBlockChange[]
  /** Les blocs changés en tout ; au-delà de `HISTORY_DIFF_BLOCKS_MAX`, les premiers seuls sont servis. */
  total: number
}

export type RestoreRevisionResult = { path: string; revision: number; restored: number }
