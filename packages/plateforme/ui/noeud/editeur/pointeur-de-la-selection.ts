"use client"

// Les gestes du pointeur d'une sélection de blocs (E11-S17, AC-a5) : le rectangle tiré depuis la marge de la page, qui
// prend au fil du geste les blocs qu'il couvre. Sans lui, la souris ne prend qu'un bloc à la fois (par sa poignée). Un
// glissé commencé dans le texte reste une sélection de texte, à travers les blocs lus (issue de l'édition au clic) : la
// sélection de blocs ne part que de la marge ou du vide.
import { useEffect, useRef, useState, type PointerEvent as EvenementDuPointeur, type RefObject } from "react"

/** En deçà, c'est un clic dans la marge : la sélection se vide, aucun rectangle ne paraît (comme le glisser d'une poignée). */
const SEUIL_DE_GESTE_PX = 4

/** Ce qui n'est pas la marge : un champ, un contrôle, un lien, un menu ; un appui y garde son geste propre. */
const INTERACTIFS = "[data-champ], button, a, input, textarea, select, label, summary, [role='menu'], [contenteditable]"

/** La marge : la zone des blocs elle-même, une rangée ou sa gouttière hors de leurs contrôles ; jamais le rendu d'un bloc lu. */
const MARGES = ".oto-block-row, .oto-block-gutter, .oto-block-insert, .oto-block-handle"

/** Un appui dans la marge de la page (AC-a5) : dans la zone des blocs, hors d'un champ, d'une poignée, d'un bouton, d'un lien. */
export function dansLaMarge(zone: HTMLElement, cible: Element): boolean {
  if (!zone.contains(cible) || cible.closest(INTERACTIFS)) return false
  return cible === zone || cible.matches(MARGES)
}

/**
 * Les blocs qu'un rectangle couvre en hauteur, où qu'il soit en largeur (AC-a5) : tiré dans la gouttière, à gauche des
 * blocs, il prend ceux d'à côté. `haut` et `bas` : les bords du rectangle, dans le repère des boîtes ; l'ordre des boîtes
 * est celui de la page.
 */
export function couverts(boites: readonly { cle: string; haut: number; bas: number }[], haut: number, bas: number): string[] {
  return boites.filter((boite) => boite.bas > haut && boite.haut < bas).map((boite) => boite.cle)
}

/** Le rectangle dessiné, dans le repère de la zone des blocs (`position: relative`). */
export type Rectangle = { gauche: number; haut: number; largeur: number; hauteur: number }

type Parametres = {
  zone: RefObject<HTMLDivElement | null>
  /** Les blocs que couvre le rectangle, dans l'ordre de la page (AC-a5). */
  prendreLesBlocs: (cles: string[]) => void
  vider: () => void
}

/** Les boîtes des rangées, dans le repère de la zone. */
function boitesDesRangees(zone: HTMLElement, repere: DOMRect): { cle: string; haut: number; bas: number }[] {
  return [...zone.querySelectorAll<HTMLElement>("[data-cle]")].map((rangee) => {
    const boite = rangee.getBoundingClientRect()
    return { cle: rangee.dataset.cle ?? "", haut: boite.top - repere.top, bas: boite.bottom - repere.top }
  })
}

export function usePointeurDeLaSelection(parametres: Parametres) {
  // Les rappels du dernier rendu : un geste commencé plus tôt lit le modèle courant.
  const lus = useRef(parametres)
  useEffect(() => {
    lus.current = parametres
  })
  const [rectangle, setRectangle] = useState<Rectangle | null>(null)
  const trace = useRef<{ x: number; y: number; bouge: boolean } | null>(null)

  /** Le rectangle part de ce point (AC-a5) : ni sélection de texte ni focus déplacé pendant le geste, la zone suit le pointeur. */
  const commencer = (zone: HTMLDivElement, evenement: { clientX: number; clientY: number; pointerId: number; preventDefault: () => void }) => {
    evenement.preventDefault()
    zone.setPointerCapture?.(evenement.pointerId)
    const repere = zone.getBoundingClientRect()
    trace.current = { x: evenement.clientX - repere.left, y: evenement.clientY - repere.top, bouge: false }
    lus.current.vider()
  }

  // Le vide autour de l'éditeur (la colonne, les marges de la page, une bordure) est une marge aussi : un appui sur un
  // élément qui contient la zone des blocs, sans être elle, tire le rectangle. Sans quoi il ne partait que de la zone.
  useEffect(() => {
    const surAppui = (evenement: PointerEvent) => {
      const zone = lus.current.zone.current
      const cible = evenement.target
      if (!zone || !(cible instanceof Element) || cible === zone || !cible.contains(zone)) return
      const modifie = evenement.shiftKey || evenement.ctrlKey || evenement.metaKey || evenement.altKey
      if (evenement.button !== 0 || modifie || evenement.pointerType === "touch") return
      commencer(zone, evenement)
    }
    document.addEventListener("pointerdown", surAppui)
    return () => document.removeEventListener("pointerdown", surAppui)
  }, [])

  const lacher = (evenement: EvenementDuPointeur<HTMLDivElement>) => {
    const origine = trace.current
    if (!origine) return
    trace.current = null
    setRectangle(null)
    const zone = evenement.currentTarget
    if (zone.hasPointerCapture?.(evenement.pointerId)) zone.releasePointerCapture(evenement.pointerId)
    if (origine.bouge) zone.focus({ preventScroll: true })
  }

  return {
    rectangle,
    proprietes: {
      onPointerDown(evenement: EvenementDuPointeur<HTMLDivElement>) {
        const { currentTarget: zone, target: cible } = evenement
        if (evenement.button !== 0 || !(cible instanceof Element)) return
        // Au doigt, la page défile : le rectangle se tire à la souris et au stylet (HN-E11S16-12).
        if (evenement.pointerType === "touch" || !dansLaMarge(zone, cible)) return
        // La zone prend le focus au lâcher.
        commencer(zone, evenement)
      },
      onPointerMove(evenement: EvenementDuPointeur<HTMLDivElement>) {
        const origine = trace.current
        if (!origine) return
        const zone = evenement.currentTarget
        const repere = zone.getBoundingClientRect()
        const x = evenement.clientX - repere.left
        const y = evenement.clientY - repere.top
        if (!origine.bouge && Math.hypot(x - origine.x, y - origine.y) < SEUIL_DE_GESTE_PX) return
        origine.bouge = true
        const haut = Math.min(origine.y, y)
        const bas = Math.max(origine.y, y)
        setRectangle({ gauche: Math.min(origine.x, x), haut, largeur: Math.abs(x - origine.x), hauteur: bas - haut })
        lus.current.prendreLesBlocs(couverts(boitesDesRangees(zone, repere), haut, bas))
      },
      onPointerUp: lacher,
      onPointerCancel: lacher,
    },
  }
}
