"use client"

// Le corps de l'écran d'un contenu et la piste de droite (refonte #217, #218, D8) : sans panneau ouvert, aucune colonne,
// le texte seul, centré à la mesure de lecture (`.oto-content-max` à `data-width="document"`), un tableau sur toute la
// largeur ; dès 1 024 px, un panneau ouvert, celui des commentaires ou celui de l'historique des versions, se pose à droite
// (les pistes de `TwoColumns`, `data-aside="panneau"`) et le texte se resserre sans bouger son bord gauche, l'en-tête
// restant en place ; dessous, les commentaires passent dans un `Drawer` (à droite, en bas sur un téléphone), l'historique
// dans le sien (`historique-du-noeud.tsx`). Reçoit le document déjà rendu par le serveur (`portage-ecrans.md § 2`). Sans
// lui, aucun panneau ne s'ouvre à côté du texte.
import type { ReactNode } from "react"
import { Drawer } from "../ds/react/drawer"
import { useBreakpoint } from "../ds/react/hooks"
import { useCommentaires } from "./commentaires/contexte"
import { CorpsDesCommentaires, PanneauDesCommentaires } from "./commentaires/encart-commentaires"
import { COMMENTAIRES } from "./commentaires/libelles"
import { useHistorique } from "./historique-du-noeud"
import { TiroirDHistorique } from "./historique/tiroir-d-historique"

type ColonnesDuNoeudProps = {
  /** `document` : la mesure de lecture d'une page ; absent, un tableau, sur toute la largeur. */
  mesure?: "document"
  children: ReactNode
}

/** Le panneau de la piste de droite dès 1 024 px : l'historique ouvert, sinon les commentaires ouverts, sinon aucun. */
function usePanneau(etroit: boolean): ReactNode {
  const commentaires = useCommentaires()
  const historique = useHistorique()
  if (etroit) return null
  if (historique?.portee) {
    return <TiroirDHistorique place="panneau" node={historique.noeud} scope={historique.portee} open onClose={historique.fermer} />
  }
  return commentaires?.encartOuvert ? <PanneauDesCommentaires /> : null
}

export function ColonnesDuNoeud({ mesure, children }: ColonnesDuNoeudProps) {
  const commentaires = useCommentaires()
  const etroit = useBreakpoint("lg")
  const panneau = usePanneau(etroit)
  // Les mêmes éléments, panneau ouvert ou non (les classes de `TwoColumns` posées sur eux) : le document n'est pas
  // remonté quand un panneau s'ouvre, et le champ en cours d'écriture garde sa frappe.
  return (
    <>
      <div
        // Un tableau sans panneau est déjà dans le cadre de l'écran (`ecran-de-noeud.tsx`) : rien à mesurer ici.
        className={panneau ? "oto-two-columns" : mesure && "oto-content-max"}
        data-main={panneau ? mesure : undefined}
        data-aside={panneau ? "panneau" : undefined}
        data-width={panneau ? undefined : mesure}
      >
        <div className={panneau ? "oto-two-columns-main" : undefined}>{children}</div>
        {panneau && <aside className="oto-two-columns-aside">{panneau}</aside>}
      </div>
      {commentaires && etroit && (
        <Drawer open={commentaires.encartOuvert} onClose={() => commentaires.ouvrirLEncart(false)} title={COMMENTAIRES.titre} closeLabel={COMMENTAIRES.fermer}>
          <CorpsDesCommentaires />
        </Drawer>
      )}
    </>
  )
}
