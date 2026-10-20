// Ressource `home` de l'API du paquet (1.4.13) : `GET /api/platform/home?tab=&scope=&offset=` sert à la carte
// « Reprendre » de l'accueil une page de contenus (un onglet, un filtre, « Voir plus »), par le service que la page de
// l'hôte lit pour la première (`homeContents`). Adaptateur mince : la requête validée et les droits sont dans le service.
// Sans elle, l'accueil ne montre que sa première page et un seul filtre.
import { homeContents } from "../server/home-contents"
import type { ResourceRoutes, Route } from "./handler"

const homeRoute: Route = {
  params: 0,
  async handle({ db, identity, request }) {
    return { status: 200, data: await homeContents(db, identity, Object.fromEntries(new URL(request.url).searchParams)) }
  },
}

export const homeRoutes: ResourceRoutes = { GET: [homeRoute] }
