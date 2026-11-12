// L'îlot « Commentaires » de l'accueil : les fils ouverts destinés à la personne (`homeComments`), non lus d'abord et
// marqués « Non lu », dix au plus, puis une ligne qui dit combien restent. Une ligne est un lien vers la page du fil :
// son titre, l'auteur du dernier commentaire d'un autre et son extrait dessous, quand à droite (la grille de `FeedItem`,
// où le fait passe sous le nom). L'ouvrir marque ses fils comme lus, la page enregistrant sa vue. Sans fil, l'îlot
// n'est pas rendu ; une lecture en échec se dit, avec « Réessayer ». Server Component : le lien de l'hôte arrive en prop.
// Sans lui, un fil qui attend la personne ne se voit que sur sa page.
import type { HomeComments, HomeCommentThread } from "../../schemas"
import type { Resultat } from "../api/resultat"
import type { LienDeLHote } from "../arbre/navigateur-d-arbre"
import { ErreurDeLecture } from "../components/erreur-de-lecture"
import { FeedItem } from "../ds/react/home"
import { Island, IslandBody, IslandHead } from "../ds/react/island"
import { Badge } from "../ds/react/primitives"
import { ilYA } from "../format/dates"
import { SUIVI } from "./libelles"

type Navigation = {
  Lien: LienDeLHote
  /** Le préfixe des pages de l'arbre (« /n/ ») : un fil s'ouvre à ce préfixe suivi du chemin de sa page. */
  prefixeDesPages: string
}

/** L'auteur tel que la page du fil le nomme : « Ancien membre » sans nom, « Assistant de <nom> » pour un assistant. */
function auteurDe({ author, viaAssistant }: Pick<HomeCommentThread, "author" | "viaAssistant">): string {
  if (author === null) return viaAssistant ? SUIVI.assistantDUnAncienMembre : SUIVI.ancienMembre
  return viaAssistant ? SUIVI.assistantDe(author) : author
}

function Fil({ fil, Lien, prefixeDesPages }: Navigation & { fil: HomeCommentThread }) {
  return (
    <li>
      <FeedItem
        as={Lien}
        className="oto-fil-suivi"
        href={`${prefixeDesPages}${fil.path}`}
        name={
          <>
            {fil.title}
            {/* Le mot, jamais la couleur seule : « Non lu » se lit dans le nom du lien. */}
            {fil.unread && (
              <>
                {" "}
                <Badge tone="review">{SUIVI.nonLu}</Badge>
              </>
            )}
          </>
        }
        what={SUIVI.extrait(auteurDe(fil), fil.excerpt)}
        // L'écart se calcule au rendu : quelques secondes entre le serveur et le navigateur peuvent changer le mot.
        when={<span suppressHydrationWarning>{ilYA(fil.at)}</span>}
      />
    </li>
  )
}

function Fils({ commentaires, ...navigation }: Navigation & { commentaires: HomeComments }) {
  return (
    <>
      <ul className="grid gap-px">
        {commentaires.threads.map((fil) => (
          <Fil key={fil.id} fil={fil} {...navigation} />
        ))}
      </ul>
      {commentaires.more > 0 && <p className="oto-caption">{SUIVI.autres(commentaires.more)}</p>}
    </>
  )
}

export type CommentairesSuivisProps = Navigation & { commentaires: Resultat<HomeComments> }

export function CommentairesSuivis({ commentaires, ...navigation }: CommentairesSuivisProps) {
  // Aucun fil destiné à la personne : pas d'îlot, plutôt qu'un îlot qui dit « rien ».
  if (commentaires.error === undefined && commentaires.data.threads.length === 0) return null
  return (
    <Island aria-label={SUIVI.titre}>
      <IslandHead>
        <h2>{SUIVI.titre}</h2>
      </IslandHead>
      <IslandBody>{commentaires.error !== undefined ? <ErreurDeLecture message={commentaires.error} /> : <Fils commentaires={commentaires.data} {...navigation} />}</IslandBody>
    </Island>
  )
}
