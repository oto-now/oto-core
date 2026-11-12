// Ressources `comments` et `comment-threads` de l'API du paquet (parcours 5.4) : `GET comments?path=` rend les fils
// d'un nœud (lecture sans journal, D138) ; `POST comments` ouvre un fil ou y répond ; `PATCH comments/<id>` et
// `DELETE comments/<id>` modifient et suppriment un commentaire ; `PATCH comment-threads/<id>` résout ou rouvre un fil.
// Adaptateur mince : la validation, les droits et l'écriture sont dans `server/comments/`. Chaque mutation laisse une
// ligne de journal dont la cible est le chemin du nœud. Sans elles, l'encart « Commentaires » n'a pas de porte.
import { createCommentSchema } from "../schemas"
import { deleteComment, editComment } from "../server/comments/comments"
import { listComments, postComment, setThreadStatus } from "../server/comments/threads"
import type { ResourceRoutes } from "./handler"
import { idOrNull } from "./ids"

export const commentsRoutes: ResourceRoutes = {
  GET: {
    params: 0,
    async handle({ db, identity, request }) {
      return { status: 200, data: await listComments(db, identity, new URL(request.url).searchParams.get("path") ?? "") }
    },
  },
  POST: {
    params: 0,
    target: ({ body }) => {
      const parsed = createCommentSchema.safeParse(body)
      return parsed.success ? parsed.data.path : null
    },
    async handle({ db, identity, body }) {
      const { data, target, teamId } = await postComment(db, identity, body)
      return { status: 201, data, journal: { target, teamId } }
    },
  },
  PATCH: {
    params: 1,
    target: ({ params }) => idOrNull(params[0]),
    async handle({ db, identity, params, body }) {
      const { data, target, teamId } = await editComment(db, identity, params[0], body)
      return { status: 200, data, journal: { target, teamId } }
    },
  },
  DELETE: {
    params: 1,
    target: ({ params }) => idOrNull(params[0]),
    async handle({ db, identity, params }) {
      const { data, target, teamId } = await deleteComment(db, identity, params[0])
      return { status: 200, data, journal: { target, teamId } }
    },
  },
}

export const commentThreadsRoutes: ResourceRoutes = {
  PATCH: {
    params: 1,
    target: ({ params }) => idOrNull(params[0]),
    async handle({ db, identity, params, body }) {
      const { data, target, teamId } = await setThreadStatus(db, identity, params[0], body)
      return { status: 200, data, journal: { target, teamId } }
    },
  },
}
