// Ressource `nodes` de l'API du paquet (E03-S03, AC37, H03) : `POST` écrit le brouillon d'une page, ou
// la publie avec `publish: true`, pour l'éditeur de l'écran (E05-S02). Adaptateur mince : validation
// (`writeNodeBodySchema`), droits et écritures sont dans `server/nodes/write.ts`, le même service que
// l'outil `write` (parité, `mcp-patterns.md § 1`). Sans lui, l'éditeur n'a pas de porte d'écriture.
// `POST nodes/move` (E03-S07, AC14, P12) déplace un nœud par `moveNode` : aucun des six outils ne
// déplace, et sans elle le niveau gestion ne réorganise pas son arbre depuis l'écran (E05-S02).
// `GET nodes?path=` (E05-S09, AC-a4) rend la tête d'un nœud (titre, révision, brouillon ouvert) :
// « Renommer », dans le rail, écrit sur la révision et le tampon qu'il vient de lire, comme l'éditeur.
// Gestes du rail et du panneau « Partager » (E05-S10, partie e) : `GET nodes/links` (« Contenus liés »,
// AC-b6), `GET nodes/impact` (aperçu d'un déplacement, AC-b7), `POST nodes/position` (ordre des frères,
// AC-b9), `POST nodes/duplicate` (AC-b10), `POST nodes/access` (accès général, AC-b13) ; aucun outil MCP
// ne les porte (liste figée, ADR-002). `GET nodes/export?path=` (E10-S01, AC-a5) : le `.md` d'un nœud publié.
// `GET nodes/tree` (E11-S20, AC-1) : l'arbre visible, celui que le layout de l'hôte passe au rail, que le rail relit
// seul à la navigation client, où Next ne rejoue pas le layout. `GET nodes/revision?path=` (retour RET-008) : la seule
// révision, que l'écran d'une page ouverte relit toutes les 30 secondes pour voir ce qu'un assistant y a écrit.
import { generalAccessSchema, moveNodeSchema, nodePathBodySchema, placeNodeSchema, writeNodeBodySchema } from "../schemas"
import { nodeHeadQuerySchema, type NodeHead } from "../schemas/search"
import { invalidInput } from "../server/errors"
import { setGeneralAccess } from "../server/general-access"
import { duplicateNode } from "../server/nodes/duplicate"
import { exportNode } from "../server/nodes/export"
import { moveImpact } from "../server/nodes/move-impact"
import { moveNode } from "../server/nodes/move"
import { nodeLinks } from "../server/nodes/node-links"
import { placeNode } from "../server/nodes/order"
import { nodeRevision } from "../server/nodes/revision"
import { loadNode } from "../server/nodes/read"
import { visibleTree } from "../server/nodes/tree"
import { writeNode } from "../server/nodes/write"
import type { ResourceRoutes } from "./handler"

/** Les paramètres de l'adresse d'un `GET`, que le service valide par son schéma. */
function queryOf(request: Request): Record<string, string> {
  return Object.fromEntries(new URL(request.url).searchParams)
}

/** La cible du journal d'un corps qui nomme un nœud par `path` : celle de la requête validée, sinon `null`. */
function pathTarget({ body }: { body: unknown }): string | null {
  const parsed = nodePathBodySchema.safeParse(body)
  return parsed.success ? parsed.data.path : null
}

export const nodesRoutes: ResourceRoutes = {
  GET: [
    {
      params: 0,
      // Le service de la page d'un nœud décide : un nœud invisible est inconnu, le brouillon ne se lit qu'au niveau écriture.
      async handle({ db, identity, request }) {
        const parsed = nodeHeadQuerySchema.safeParse(queryOf(request))
        if (!parsed.success) throw invalidInput(parsed.error)
        const view = await loadNode(db, identity, parsed.data)
        const head: NodeHead = {
          path: view.path,
          title: view.title,
          revision: view.revision,
          draft: view.draft ? { title: view.draft.title, stamp: view.draft.draftStamp } : null,
        }
        return { status: 200, data: head }
      },
    },
    {
      params: 1,
      fixed: { 0: "links" },
      async handle({ db, identity, request }) {
        return { status: 200, data: await nodeLinks(db, identity, queryOf(request)) }
      },
    },
    {
      params: 1,
      fixed: { 0: "impact" },
      async handle({ db, identity, request }) {
        return { status: 200, data: await moveImpact(db, identity, queryOf(request)) }
      },
    },
    {
      // E10-S01 (AC-a5) : « Télécharger en .md » ; le service exige la lecture avant de lire les blocs. Une lecture :
      // aucune ligne de journal (HN-E10S01-18).
      params: 1,
      fixed: { 0: "export" },
      async handle({ db, identity, request }) {
        return { status: 200, data: await exportNode(db, identity, queryOf(request)) }
      },
    },
    {
      // E11-S20 (AC-1) : le service du layout (`visibleTree`), qui filtre par niveau et borne à 5 000 nœuds (`truncated`).
      // Une lecture : aucune ligne de journal.
      params: 1,
      fixed: { 0: "tree" },
      async handle({ db, identity }) {
        return { status: 200, data: await visibleTree(db, identity) }
      },
    },
    {
      // Retour RET-008 : la révision seule, relue toutes les 30 secondes par une page ouverte. Une lecture : aucune ligne de journal.
      params: 1,
      fixed: { 0: "revision" },
      async handle({ db, identity, request }) {
        return { status: 200, data: await nodeRevision(db, identity, queryOf(request)) }
      },
    },
  ],
  POST: [
    {
      params: 0,
      target: ({ body }) => {
        const parsed = writeNodeBodySchema.safeParse(body)
        return parsed.success ? parsed.data.path : null
      },
      async handle({ db, identity, body }) {
        const output = await writeNode(db, identity, body, { kind: "human" })
        // Les champs de `write` seuls (AC37) : le texte servi au modèle n'a pas de lecteur à l'écran.
        return { status: 200, data: output.data, journal: { target: output.target, teamId: output.teamId } }
      },
    },
    {
      params: 1,
      fixed: { 0: "move" },
      // Refus : le chemin demandé du nœud ; déplacement fait : son nouveau chemin, rendu par le service (H07).
      target: ({ body }) => {
        const parsed = moveNodeSchema.safeParse(body)
        return parsed.success ? parsed.data.path : null
      },
      async handle({ db, identity, body }) {
        // `path` : le chemin où le nœud est arrivé, le premier libre quand le demandé était pris (fiche D125).
        const { moves, target, teamId } = await moveNode(db, identity, body)
        return { status: 200, data: { path: target, moves }, journal: { target, teamId } }
      },
    },
    {
      params: 1,
      fixed: { 0: "position" },
      target: ({ body }) => {
        const parsed = placeNodeSchema.safeParse(body)
        return parsed.success ? parsed.data.path : null
      },
      async handle({ db, identity, body }) {
        const { data, target, teamId } = await placeNode(db, identity, body)
        return { status: 200, data, journal: { target, teamId } }
      },
    },
    {
      params: 1,
      fixed: { 0: "duplicate" },
      target: pathTarget,
      async handle({ db, identity, body }) {
        const { data, target, teamId } = await duplicateNode(db, identity, body)
        return { status: 201, data, journal: { target, teamId } }
      },
    },
    {
      params: 1,
      fixed: { 0: "access" },
      target: ({ body }) => {
        const parsed = generalAccessSchema.safeParse(body)
        return parsed.success ? parsed.data.path : null
      },
      async handle({ db, identity, body }) {
        const { data, target, teamId } = await setGeneralAccess(db, identity, body)
        return { status: 200, data, journal: { target, teamId } }
      },
    },
  ],
}
