// La carte d'un nœud cité par un bloc `reference` sans `view` (E07-S03, AC16 ; H56, HN-E07S03-11) : son
// titre en lien vers son chemin courant, sa nature et son résumé ; atteint par un ancien chemin, il le
// dit. Server Component : il entre dans l'éditeur d'E05-S02 déjà rendu (AC17). Sans lui, une page citée
// ne serait qu'un chemin.
//
// Porté d'oto-frontend (`design-system/components/react/content.jsx` l. 214-260, `EmbedCard`) : un
// contenu cité est un objet, le nom porte le lien, pas la carte. Retiré : la vignette, le volume, le mode
// d'injection et le bouton « Ouvrir », doublon du lien. E11-S05 (AC-f2) : le résumé d'une procédure seule.
import type { ScreenCard } from "../../schemas"
import type { LienDeLHote } from "../arbre/navigateur-d-arbre"
import { LIEN } from "../components/classes"
import { NATURES, resumeMontre } from "../noeud/libelles"
import { REFERENCES } from "./libelles"

type CarteDeNoeudProps = { carte: ScreenCard; Lien: LienDeLHote; hrefDuChemin: (chemin: string) => string }

export function CarteDeNoeud({ carte, Lien, hrefDuChemin }: CarteDeNoeudProps) {
  return (
    <div className="oto-card space-y-1 text-ink">
      <p className="font-medium">
        <Lien href={hrefDuChemin(carte.path)} className={LIEN}>
          {carte.title}
        </Lien>
      </p>
      <p className="text-sm">{[NATURES[carte.nodeKind], ...(carte.movedFrom ? [REFERENCES.ancienChemin(carte.movedFrom)] : [])].join(" · ")}</p>
      {resumeMontre(carte.nodeKind) && <p className="text-sm">{carte.summary}</p>}
    </div>
  )
}
