// L'historique des versions d'un contenu, pour le tiroir « Historique des versions » de l'écran (`ui/noeud/historique/`) :
// `GET nodes/history` (la liste), `GET nodes/history/diff` (l'écart d'une version) et `POST nodes/restore` (revenir à une
// version). Adaptateur mince : validation, droits et écritures sont dans `server/nodes/history.ts` et `restore.ts`.
// Aucun outil MCP ne les porte (liste figée, ADR-002). Fichier à part de `nodes.ts`, qui en monte les routes.
import { restoreRevisionSchema } from "../schemas/node-history"
import { nodeHistory, nodeHistoryDiff } from "../server/nodes/history"
import { restoreRevision } from "../server/nodes/restore"
import type { Route } from "./handler"

/** Les paramètres de l'adresse d'un `GET`, que le service valide par son schéma. */
function queryOf(request: Request): Record<string, string> {
  return Object.fromEntries(new URL(request.url).searchParams)
}

/** Deux lectures : aucune ligne de journal. */
export const historyReadRoutes: readonly Route[] = [
  {
    params: 1,
    fixed: { 0: "history" },
    async handle({ db, identity, request }) {
      return { status: 200, data: await nodeHistory(db, identity, queryOf(request)) }
    },
  },
  {
    params: 2,
    fixed: { 0: "history", 1: "diff" },
    async handle({ db, identity, request }) {
      return { status: 200, data: await nodeHistoryDiff(db, identity, queryOf(request)) }
    },
  },
]

/** Une écriture, journalisée comme les autres (« POST nodes/restore ») : sa cible est le chemin du contenu. */
export const restoreRoute: Route = {
  params: 1,
  fixed: { 0: "restore" },
  target: ({ body }) => {
    const parsed = restoreRevisionSchema.safeParse(body)
    return parsed.success ? parsed.data.path : null
  },
  async handle({ db, identity, body }) {
    const { data, target, teamId } = await restoreRevision(db, identity, body)
    return { status: 200, data, journal: { target, teamId } }
  },
}
