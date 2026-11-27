// Le bouton « Liens » de l'en-tête d'un contenu (refonte #218, D1) : le glyphe et le total des liens ; il ouvre un popover
// « Cité dans N contenus » puis « Cite N contenus », chaque ligne un lien précédé du glyphe de son genre, son espace en
// fin de ligne. Les liens arrivent après la page, sous leur `<Suspense>` : en attendant, le bouton est là sans total ni
// geste ; sans lien, ou leur lecture en échec (le pied la dit), il n'est pas rendu. Server Component : le popover
// (client) reçoit ses lignes déjà rendues. Les mêmes liens se lisent aussi au pied (`pied-du-noeud.tsx`), décision D1.
import { Suspense, use } from "react"
import { LinkSimple } from "@phosphor-icons/react/dist/ssr/LinkSimple"
import type { TreeNode } from "../../schemas"
import type { Resultat } from "../api/resultat"
import type { LienDeLHote } from "../arbre/navigateur-d-arbre"
import { Icon } from "../ds/react/icon"
import { Button } from "../ds/react/primitives"
import { PopoverDesLiens } from "./actions-du-noeud"
import { sectionDuChemin } from "./fil"
import { GlypheDeNature } from "./glyphes"
import { ACTIONS, PIED } from "./libelles"
import { lignesDesLiens, type LigneLiee } from "./pied-du-noeud"
import { liensDeLaLecture, naturesParChemin, type NomsDesContextes } from "./sous-pages"

type Equipes = readonly { slug: string; name: string }[]

type LiensDeLEnTeteProps = {
  lecture: Promise<Resultat<Record<string, unknown>>>
  arbre: readonly TreeNode[] | null
  equipes: Equipes | null
  handle: string | null
  contextes: NomsDesContextes
  Lien: LienDeLHote
  hrefDuChemin: (chemin: string) => string
}

const glyphe = <Icon as={LinkSimple} size="sm" />

/** Le bouton en attendant les liens : sa place gardée, sans total, inerte. */
function BoutonEnAttente() {
  return (
    <Button variant="ghost" size="sm" className="oto-node-action oto-node-links-trigger" aria-label={ACTIONS.liens} aria-disabled iconStart={glyphe} />
  )
}

type GroupeProps = { titre: string; lignes: readonly LigneLiee[]; espace: (chemin: string) => string; Lien: LienDeLHote }

/** Un groupe du popover : son intitulé, puis ses lignes (rien à 0). */
function Groupe({ titre, lignes, espace, Lien }: GroupeProps) {
  if (lignes.length === 0) return null
  return (
    <section className="oto-node-links-group" aria-label={titre}>
      <h3 className="oto-group-title">{titre}</h3>
      <ul className="oto-node-links-list">
        {lignes.map((ligne) => (
          <li key={ligne.chemin} className="oto-node-foot-item">
            <GlypheDeNature nature={ligne.nature} />
            {ligne.href === null ? (
              <span className="oto-node-foot-name">{ligne.nom}</span>
            ) : (
              <Lien href={ligne.href} className="oto-node-links-link">
                <span className="oto-node-foot-name">{ligne.nom}</span>
              </Lien>
            )}
            <span className="oto-caption">{espace(ligne.chemin)}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function LiensLus({ lecture, arbre, equipes, handle, contextes, Lien, hrefDuChemin }: LiensDeLEnTeteProps) {
  const lu = use(lecture)
  if (lu.error !== undefined) return null
  const liens = liensDeLaLecture(lu.data)
  const total = liens.totalCitant + liens.totalCites
  if (total === 0) return null
  const { citeDans, cite } = lignesDesLiens(liens, naturesParChemin(arbre), contextes, hrefDuChemin)
  const espace = (chemin: string) => sectionDuChemin(chemin, equipes, handle).titre
  return (
    <PopoverDesLiens
      align="end"
      aria-label={ACTIONS.panneauDesLiens}
      className="oto-node-links"
      trigger={
        <Button variant="ghost" size="sm" className="oto-node-action oto-node-links-trigger" aria-label={ACTIONS.nomDesLiens(total)} iconStart={glyphe}>
          {total}
        </Button>
      }
    >
      <Groupe titre={PIED.citeDansN(liens.totalCitant)} lignes={citeDans} espace={espace} Lien={Lien} />
      <Groupe titre={PIED.citeN(liens.totalCites)} lignes={cite} espace={espace} Lien={Lien} />
    </PopoverDesLiens>
  )
}

// Sans infobulle : le déclencheur d'un popover est son ancre, qu'une infobulle autour ne laisserait plus mesurer ; son nom
// accessible dit « Liens » et le total.
export function LiensDeLEnTete(props: LiensDeLEnTeteProps) {
  return (
    <Suspense fallback={<BoutonEnAttente />}>
      <LiensLus {...props} />
    </Suspense>
  )
}
