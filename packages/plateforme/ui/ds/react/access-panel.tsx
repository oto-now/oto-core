"use client"

// Porté d'oto-frontend (src/design-system/components/react/content.jsx, `AccessPanel`) : qui a accès et par où
// partager, une ligne dans l'en-tête d'écran et le détail dans un popover ; un popover et non un menu, ses
// lignes ne s'activent pas (un `role="menu"` promettrait un clic qui n'arrive jamais) ; l'ouverture est
// tenue ici. Tel quel, en TypeScript. Retiré : la pile d'avatars (aucune liste de personnes n'est servie),
// le second déclencheur « Partager » et le menu ⋯, qu'aucun écran porté n'emploie. Changé : un Échap que le
// détail a déjà traité (une confirmation sur place qui se referme) ne ferme pas le panneau. E05-S10 (partie
// b, AC-b4) : l'ouverture se tient aussi par l'appelant (« Déplacer » referme son panneau après « Annuler »),
// et un panneau refermé par son contenu rend le focus à son déclencheur.
import { useEffect, useRef, useState, type ComponentProps, type KeyboardEvent, type ReactNode } from "react"
import { cx } from "./outils"
import { Popover, PopoverBody } from "./popover"

/** La mécanique du composant (« ça s'ouvre »), pas du contenu : le glyphe est inline, le DS ne dépend d'aucun paquet d'icônes. */
const CHEVRON = (
  <svg className="oto-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m6 9 6 6 6-6" />
  </svg>
)

/**
 * Un Échap déjà traité par le détail (`preventDefault`) s'arrête ici : le popover l'écoute sur `document`, où
 * la racine de React écoute aussi dans Next ; `stopImmediatePropagation` l'arrête avant lui, `stopPropagation`
 * sous une racine plus basse.
 */
function garderLEchapTraite(evenement: KeyboardEvent<HTMLDivElement>) {
  if (evenement.key !== "Escape" || !evenement.defaultPrevented) return
  evenement.stopPropagation()
  evenement.nativeEvent.stopImmediatePropagation()
}

/**
 * Un panneau refermé par son contenu (« Annuler ») part avec le focus, qui tombe sur `<body>` : il revient au
 * déclencheur. Un panneau refermé par Échap ou un clic extérieur, le popover l'a déjà rendu ou laissé ailleurs.
 */
function useFocusRenduAuDeclencheur(ouvert: boolean) {
  const declencheur = useRef<HTMLButtonElement>(null)
  const avant = useRef(ouvert)
  useEffect(() => {
    const actif = document.activeElement
    if (avant.current && !ouvert && (actif === null || actif === document.body)) declencheur.current?.focus()
    avant.current = ouvert
  }, [ouvert])
  return declencheur
}

type AccessPanelProps = Omit<ComponentProps<"div">, "children"> & {
  /** Le périmètre, et le verbe qui dit qu'on peut le changer : « Partager · Ventes ». */
  scope?: ReactNode
  scopeIcon?: ReactNode
  /** Le détail des droits ; sans lui, le périmètre se lit sans s'ouvrir. */
  panel?: ReactNode
  panelLabel?: string
  /** Tenue par l'appelant quand il la passe (son contenu le referme) ; ici sinon. */
  open?: boolean
  onOpenChange?: (ouvert: boolean) => void
  children?: ReactNode
}

export function AccessPanel({ scope, scopeIcon, panel, panelLabel = "Accès et partage", open, onOpenChange, className, children, ...rest }: AccessPanelProps) {
  const [ouvertInterne, setOuvertInterne] = useState(false)
  const ouvert = open ?? ouvertInterne
  const declencheur = useFocusRenduAuDeclencheur(ouvert)
  const poser = (suivant: boolean) => {
    setOuvertInterne(suivant)
    onOpenChange?.(suivant)
  }
  return (
    <div {...rest} className={cx("oto-access", className)}>
      {panel ? (
        <Popover
          data-size="lg"
          className="oto-access-pop"
          // Le déclencheur est au bout de l'en-tête : aligné sur son bord droit, le panneau reste sous lui ; aligné à
          // gauche, il sortait de la fenêtre et s'y faisait repousser, loin de son bouton (E11-S15, AC-a4).
          align="end"
          aria-label={panelLabel}
          open={ouvert}
          onOpenChange={poser}
          trigger={
            <button ref={declencheur} type="button" className="oto-scope">
              {scopeIcon}
              {scope}
              {CHEVRON}
            </button>
          }
        >
          <PopoverBody onKeyDown={garderLEchapTraite}>{panel}</PopoverBody>
        </Popover>
      ) : (
        scope != null && (
          <span className="oto-scope">
            {scopeIcon}
            {scope}
          </span>
        )
      )}
      {children}
    </div>
  )
}
