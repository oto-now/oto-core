// Ressource `home` de l'API du paquet (1.4.13) : `GET /api/platform/home?tab=&scope=&offset=` sert à la carte
// « Reprendre » de l'accueil une page de contenus (un onglet, un filtre, « Voir plus »), par le service que la page de
// l'hôte lit pour la première (`homeContents`) ; `GET /api/platform/home/activities?scope=` son onglet « Fil » au filtre
// choisi (`listActivities`, sur la semaine du journal). Adaptateur mince : la requête validée et les droits sont dans les
// services. Sans elle, l'accueil ne montre que sa première page et un seul filtre.
import { homeActivitiesQuerySchema } from "../schemas/accueil"
import { journalFiltersSchema } from "../schemas/journal"
import { listActivities } from "../server/activities"
import { invalidInput } from "../server/errors"
import { homeContents } from "../server/home-contents"
import type { ResourceRoutes, Route } from "./handler"

const homeRoute: Route = {
  params: 0,
  async handle({ db, identity, request }) {
    return { status: 200, data: await homeContents(db, identity, Object.fromEntries(new URL(request.url).searchParams)) }
  },
}

const activitiesRoute: Route = {
  params: 1,
  fixed: { 0: "activities" },
  async handle({ db, identity, request }) {
    const parsed = homeActivitiesQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams))
    if (!parsed.success) throw invalidInput(parsed.error)
    // La semaine du journal, la période de l'accueil et de `/journal` par défaut.
    return { status: 200, data: await listActivities(db, identity, { periodDays: journalFiltersSchema.parse({}).period, scope: parsed.data.scope }) }
  },
}

export const homeRoutes: ResourceRoutes = { GET: [homeRoute, activitiesRoute] }
