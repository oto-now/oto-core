// Les appels de l'encart « Commentaires » à l'API du paquet (ressources `comments` et `comment-threads`,
// `api/comments.ts`) : lire les fils d'un nœud, ouvrir un fil ou y répondre, modifier et supprimer un commentaire,
// résoudre et rouvrir un fil. Chaque écriture rend le fil tel que la personne le lit : l'encart l'adopte sans relire
// la page. Sans ce module, chaque composant des commentaires écrirait ses adresses et la forme de leurs réponses.
import type { CommentThreadStatus, CommentThreadView, CreateCommentInput, NodeCommentsView } from "../../../schemas/comments"
import { appelerPlateforme } from "../../api/client"

export function lireLesFils(chemin: string) {
  return appelerPlateforme<NodeCommentsView>({ methode: "GET", ressource: `comments?path=${encodeURIComponent(chemin)}` })
}

/** Un nouveau fil (`block` et `quote` en option) ou une réponse (`thread`). */
export function envoyerUnCommentaire(corps: CreateCommentInput) {
  return appelerPlateforme<{ thread: CommentThreadView }>({ methode: "POST", ressource: "comments", corps })
}

export function modifierUnCommentaire(id: string, text: string) {
  return appelerPlateforme<{ thread: CommentThreadView }>({ methode: "PATCH", ressource: `comments/${encodeURIComponent(id)}`, corps: { text } })
}

/** `thread: null` : le premier commentaire a emporté le fil et ses réponses. */
export function supprimerUnCommentaire(id: string) {
  return appelerPlateforme<{ thread: CommentThreadView | null }>({ methode: "DELETE", ressource: `comments/${encodeURIComponent(id)}` })
}

export function changerLEtatDuFil(id: string, status: CommentThreadStatus) {
  return appelerPlateforme<{ thread: CommentThreadView }>({ methode: "PATCH", ressource: `comment-threads/${encodeURIComponent(id)}`, corps: { status } })
}
