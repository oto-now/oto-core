"use client"

// L'îlot du tableau (E05-S09 partie c2, AC-x3) : l'`Island` du design system, nommé par le tableau, et le
// repli du focus. Un geste de l'îlot qui navigue (un lien, un bouton qui n'ouvre pas de panneau, un envoi)
// passe par l'hôte ; quand la relecture
// emporte le contrôle qui avait le focus — le bouton du filtre d'une table devenue vide, « Charger plus » à
// la dernière ligne, « Retirer les filtres » une fois les filtres retirés, l'action d'un vide qui se remplit —,
// le focus revient à l'îlot, jamais à la page (`accessibility-patterns.md § Focus Management`, par
// `replierLeFocusSur`). Seulement après un geste : le double montage du mode strict, ou une relecture venue
// d'ailleurs, ne le déplace pas. Reçoit des données et du `ReactNode` déjà rendu, jamais une fonction. Sans
// lui, un geste qui retire son propre bouton laisse le clavier en haut de la page.
//
// Porté d'oto-frontend (`src/components/shared/attentes.tsx`, la cible de repli du focus : « on désigne
// l'îlot lui-même, la région qu'on vient de vider ») ; l'îlot est celui de `CorpsTableauDuNoeud`
// (`src/routes/n.$nodeId.lazy.tsx`).
import { useId, useLayoutEffect, useRef, type MouseEvent, type ReactNode } from "react"
import { replierLeFocusSur } from "../components/focus"
import { Island } from "../ds/react/island"

export function IlotDuTableau({ titre, children }: { titre: string; children: ReactNode }) {
  const id = useId()
  const geste = useRef(false)

  // Après chaque rendu : celui qui suit un geste est la relecture qu'il a demandée.
  useLayoutEffect(() => {
    if (!geste.current) return
    geste.current = false
    replierLeFocusSur(id, null)
  })

  const noter = () => {
    geste.current = true
  }
  // Seul un geste qui navigue est noté : ouvrir le panneau d'un filtre ou un repli, cliquer une cellule, ne relit
  // rien, et le drapeau attendrait sinon une relecture venue d'ailleurs pour y déplacer le focus. Entrée sur un
  // lien ou un bouton est un clic, dans un champ un envoi : aucune touche à écouter.
  const noterUnClic = (evenement: MouseEvent) => {
    const cible = evenement.target
    if (cible instanceof Element && cible.closest("a[href], button") && !cible.closest("[aria-haspopup]")) noter()
  }

  return (
    // `-1` : l'îlot n'entre dans la tabulation que lorsque le script l'y pose.
    // Un filet arrondi, sans ombre ni fond de carte (refonte #217) : la grille garde un cadre pour défiler en largeur.
    <Island id={id} tabIndex={-1} aria-label={titre} className="oto-node-table-frame" onClickCapture={noterUnClic} onSubmitCapture={noter}>
      {children}
    </Island>
  )
}
