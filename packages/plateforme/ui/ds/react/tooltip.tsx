"use client"

// Porté d'oto-frontend (src/design-system/components/react/overlays.jsx, `Tooltip`) : l'infobulle explique
// et ne prend jamais le focus ; elle n'est jamais le seul porteur d'une information ; ouverte au survol
// (après `delay`) et au focus clavier, fermée par Échap sans quitter le déclencheur (WCAG 1.4.13) ; les
// gestionnaires vont sur le déclencheur lui-même, qu'on survole, focalise et mesure. Tel quel, en
// TypeScript. Changé : montée dans la racine `.oto` du déclencheur (`Portail`, comme les menus de la
// partie a), qui porte les jetons. Partie c2 : l'ancre est celle d'`anchor.tsx`, partagée avec `Popover`.
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react"
import { Anchor } from "./anchor"
import { useAnchor } from "./hooks"
import { cx } from "./outils"
import { Portail, racineOto } from "./overlays"

type TooltipProps = {
  content: ReactNode
  side?: "top" | "bottom" | "left" | "right"
  delay?: number
  children: ReactNode
  className?: string
}

export function Tooltip({ content, side = "top", delay = 400, children, className }: TooltipProps) {
  const [open, setOpenState] = useState(false)
  const [conteneur, setConteneur] = useState<Element | null>(null)
  const anchorRef = useRef<HTMLElement>(null)
  const floatRef = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const id = useId()
  const placed = useAnchor(anchorRef, floatRef, { open, side, align: "center" })

  const setOpen = (ouvrir: boolean) => {
    if (ouvrir) setConteneur(racineOto(anchorRef.current))
    setOpenState(ouvrir)
  }
  const show = () => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setOpen(true), delay)
  }
  const hide = () => {
    clearTimeout(timer.current)
    setOpen(false)
  }
  useEffect(() => () => clearTimeout(timer.current), [])
  // La couche du dessus : un `<dialog>` modal y vit, au-dessus de tout `z-index` ; l'infobulle s'y pose après lui, donc
  // devant. Au montage, avant la mesure de `useAnchor`, qui lit sa taille.
  const poser = useCallback((element: HTMLDivElement | null) => {
    floatRef.current = element
    if (element && "showPopover" in element) element.showPopover()
  }, [])

  return (
    <>
      <Anchor
        ref={anchorRef}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={() => setOpen(true)}
        onBlur={hide}
        onKeyDown={(evenement) => {
          if (evenement.key === "Escape") hide()
        }}
        aria-describedby={open ? id : undefined}
      >
        {children}
      </Anchor>
      {open && content && (
        <Portail conteneur={conteneur}>
          <div ref={poser} id={id} role="tooltip" popover="manual" className={cx("oto-tooltip", className)} data-side={placed.side} style={{ top: placed.top, left: placed.left }}>
            {content}
          </div>
        </Portail>
      )}
    </>
  )
}
