// Ressource `rules` de l'API du paquet (E05-S03, AC17) : poser ou remplacer une règle sur un nœud,
// la retirer. Adaptateur mince : la validation, les droits et l'écriture sont dans `server/rules.ts`.
// `GET rules?path=` (1.4.12) : le panneau d'un nœud, ses règles et le niveau des membres de son équipe, que lit
// « Les personnes de … » pour le dossier d'une équipe ; lecture sans journal (D138).
import { setNodeRuleSchema } from "../schemas"
import { listNodeRules, removeRule, setNodeRule } from "../server/rules"
import type { ResourceRoutes } from "./handler"
import { idOrNull } from "./ids"

export const rulesRoutes: ResourceRoutes = {
  GET: {
    params: 0,
    async handle({ db, identity, request }) {
      return { status: 200, data: await listNodeRules(db, identity, new URL(request.url).searchParams.get("path") ?? "", { people: true }) }
    },
  },
  POST: {
    params: 0,
    target: ({ body }) => {
      const parsed = setNodeRuleSchema.safeParse(body)
      return parsed.success ? parsed.data.path : null
    },
    async handle({ db, identity, body }) {
      const { data, target, teamId } = await setNodeRule(db, identity, body)
      return { status: data.created ? 201 : 200, data: { rule: data }, journal: { target, teamId } }
    },
  },
  DELETE: {
    params: 1,
    target: ({ params }) => idOrNull(params[0]),
    async handle({ db, identity, params }) {
      const { data, target, teamId } = await removeRule(db, identity, params[0])
      return { status: 200, data: { rule: data }, journal: { target, teamId } }
    },
  },
}
