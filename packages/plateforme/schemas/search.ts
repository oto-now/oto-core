// Les lectures du rail (E05-S09, partie a) : la recherche de la palette (⌘K, AC-a7), dans les titres et
// le contenu par le service de `find`, et la tête d'un nœud que « Renommer » lit avant d'écrire
// (AC-a4). Un schéma pour l'écran, qui borne ce qu'il envoie, et pour l'API, qui le valide.
import * as z from "zod/v4"
import { nodePathSchema } from "./nodes"

/** Une recherche de la palette tient sur une ligne : 200 caractères au plus, comme un titre. */
export const SEARCH_QUERY_MAX = 200

/** `GET /api/platform/search?q=` : les mots cherchés, espaces retirés. */
export const searchQuerySchema = z.object({ q: z.string().trim().min(1).max(SEARCH_QUERY_MAX) })

/** `GET /api/platform/search/recent?exclude=` (E11-S15, AC-b4) : la page qu'on édite, que la liste de « @ » ne propose pas. */
export const recentQuerySchema = z.object({ exclude: nodePathSchema.optional() })

/** Un nœud trouvé, tel que l'écran le montre : son chemin, son genre, son titre, un extrait. */
export type SearchMatch = { path: string; kind: string; title: string; snippet: string | null }

/** `GET /api/platform/nodes?path=` : le chemin d'un nœud. */
export const nodeHeadQuerySchema = z.object({ path: nodePathSchema })

/** La tête d'un nœud : sa révision publiée, son titre, le brouillon ouvert (titre, tampon) quand on l'écrit. */
export type NodeHead = {
  path: string
  title: string
  revision: number
  draft: { title: string | null; stamp: string } | null
}

/** `GET /api/platform/nodes/revision?path=` : la révision publiée d'un nœud, seule (retour RET-008). */
export type NodeRevision = { path: string; revision: number }
