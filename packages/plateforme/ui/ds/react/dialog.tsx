"use client"

// Porté d'oto-frontend (src/design-system/components/react/overlays.jsx, `Dialog` et `useNativeDialog`) :
// le `<dialog>` natif, qui donne le piège de focus, Échap, la couche du dessus et l'inertie du fond ;
// fermeture au clic sur le fond commencé sur le fond ; sortie animée avant `close()`. Tels quels, en
// TypeScript. Changé : démonté encore ouvert, le dialogue rend le focus à ce qui l'avait avant lui.
import { useEffect, useId, useRef, useState, type ComponentProps, type ReactNode, type RefObject } from "react"
import { cx, mergeRefs } from "./outils"

export const GLYPHE_FERMER = (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
)

/**
 * Ouvre ou ferme un `<dialog>` selon `open`, en laissant jouer l'animation de sortie ; Échap passe par
 * `onClose`. Démonté ouvert, il rend le focus à ce qui l'avait avant `showModal()`.
 */
export function useNativeDialog(ref: RefObject<HTMLDialogElement | null>, open: boolean, onClose?: () => void): boolean {
  const [closing, setClosing] = useState(false)
  const retour = useRef<Element | null>(null)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    if (open && !element.open) {
      retour.current = document.activeElement
      element.showModal()
    }
    if (!open && element.open) {
      setClosing(true)
      const minuterie = setTimeout(() => {
        setClosing(false)
        element.close()
      }, 140)
      return () => clearTimeout(minuterie)
    }
  }, [open, ref])

  useEffect(() => {
    const element = ref.current
    if (!element) return
    // `cancel` est Échap : sans passer par `onClose`, l'état de React et celui du document divergeraient.
    const surAnnulation = (evenement: Event) => {
      evenement.preventDefault()
      onClose?.()
    }
    element.addEventListener("cancel", surAnnulation)
    return () => element.removeEventListener("cancel", surAnnulation)
  }, [ref, onClose])

  // `close()` rend le focus à ce qui l'avait ; un `<dialog>` retiré du document, non (Annuler, Échap et
  // Fermer démontent le dialogue qui les porte) : le focus tombait sur `<body>`. Seulement s'il est
  // perdu : un geste qui l'a posé ailleurs le garde.
  useEffect(
    () => () => {
      const avant = retour.current
      const actif = document.activeElement
      const perdu = actif === null || actif === document.body || !actif.isConnected
      if (perdu && avant instanceof HTMLElement && avant.isConnected) avant.focus()
    },
    [],
  )

  return closing
}

type DialogProps = Omit<ComponentProps<"dialog">, "title" | "open"> & {
  open: boolean
  onClose: () => void
  title?: ReactNode
  description?: ReactNode
  size?: "sm" | "md" | "lg" | "xl"
  footer?: ReactNode
  closeLabel?: string
}

export function Dialog({ open, onClose, title, description, size, footer, closeLabel = "Fermer", className, children, ref: leurRef, ...rest }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const closing = useNativeDialog(ref, open, onClose)
  const titreId = useId()
  const descriptionId = useId()

  return (
    <dialog
      {...rest}
      ref={mergeRefs(leurRef, ref)}
      className={cx("oto-dialog", className)}
      data-size={size}
      data-closing={closing ? "" : undefined}
      aria-labelledby={title ? titreId : rest["aria-labelledby"]}
      aria-describedby={description ? descriptionId : rest["aria-describedby"]}
      onClick={(evenement) => {
        rest.onClick?.(evenement)
        if (evenement.target === ref.current) onClose()
      }}
    >
      {(title || description) && (
        <header className="oto-dialog-head">
          <div style={{ flex: 1 }}>
            {title && (
              <h2 className="oto-dialog-title" id={titreId}>
                {title}
              </h2>
            )}
            {description && (
              <p className="oto-dialog-desc" id={descriptionId}>
                {description}
              </p>
            )}
          </div>
          <button type="button" className="oto-icon-btn oto-dialog-close" aria-label={closeLabel} onClick={onClose}>
            {GLYPHE_FERMER}
          </button>
        </header>
      )}
      <div className="oto-dialog-body">{children}</div>
      {footer && <footer className="oto-dialog-foot">{footer}</footer>}
    </dialog>
  )
}
