// L'îlot « Nouveautés depuis votre dernière visite » de l'accueil (1.4.13) : ce que d'autres ont publié dans Tout le
// monde et dans les équipes de la personne depuis sa dernière visite (`homeNews`), dix au plus, chacun ouvert par le
// lien de l'hôte. Server Component : le lien arrive en prop. Sans lui, la personne ne voit ce qui a changé qu'en
// parcourant l'arbre ; son assistant, lui, le reçoit dans le bloc « What's new » de `context`.
import type { HomeNews } from "../../schemas"
import type { Resultat } from "../api/resultat"
import { natureDuGenre } from "../arbre/depuis-l-arbre"
import type { LienDeLHote } from "../arbre/navigateur-d-arbre"
import { ErreurDeLecture } from "../components/erreur-de-lecture"
import { EmptyState } from "../ds/react/empty-state"
import { FeedItem } from "../ds/react/home"
import { Island, IslandBody, IslandHead } from "../ds/react/island"
import { dateCourte, dateLisible } from "../format/dates"
import { GlypheDeNature } from "../noeud/glyphes"
import { NOUVEAUTES } from "./libelles"

type NouveautesProps = {
  nouveautes: Resultat<HomeNews>
  Lien: LienDeLHote
  /** Le préfixe des pages de l'arbre (« /n/ ») : un contenu s'ouvre à ce préfixe suivi de son chemin. */
  prefixeDesPages: string
}

function CorpsDesNouveautes({ nouveautes, Lien, prefixeDesPages }: NouveautesProps) {
  if (nouveautes.error !== undefined) return <ErreurDeLecture message={nouveautes.error} />
  if (nouveautes.data.items.length === 0) return <EmptyState title={NOUVEAUTES.rien} />
  return nouveautes.data.items.map((item) => (
    <FeedItem
      key={item.path}
      as={Lien}
      href={`${prefixeDesPages}${item.path}`}
      lead={
        <span aria-hidden="true">
          <GlypheDeNature nature={natureDuGenre(item.kind)} />
        </span>
      }
      name={item.title}
      what={NOUVEAUTES.publiePar(item.byName)}
      when={dateCourte(item.at)}
    />
  ))
}

export function Nouveautes(props: NouveautesProps) {
  const depuis = props.nouveautes.data ? dateLisible(props.nouveautes.data.since) : undefined
  return (
    <Island aria-label={NOUVEAUTES.titre}>
      <IslandHead>
        <h2>{NOUVEAUTES.titre}</h2>
      </IslandHead>
      <IslandBody>
        {depuis && <p className="oto-caption">{NOUVEAUTES.depuis(depuis)}</p>}
        <CorpsDesNouveautes {...props} />
      </IslandBody>
    </Island>
  )
}
