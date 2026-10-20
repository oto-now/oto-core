"use client"

// La largeur du rail, à la main : une poignée sur son bord droit, qu'on glisse à la souris ou qu'on règle au clavier
// (flèches, Début, Fin), un double-clic la remet à sa largeur d'origine. La largeur est gardée dans ce navigateur. Sans
// elle, le rail restait à 232 px, et un arbre profond ou des noms longs ne s'y lisaient pas. Sous 1 024 px, le rail est un
// tiroir : la poignée ne s'affiche pas (`islands.css`).
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react"
import { RAIL } from "./libelles"

/** La largeur du rail du design system (`--rail-w`, `oto.css`), et ses bornes. */
const LARGEUR_PAR_DEFAUT = 232
const LARGEUR_MIN = 200
/** La part de la fenêtre que le rail peut prendre au plus : le contenu garde la place de se lire. */
const PART_MAX = 0.4
/** Un pas au clavier. */
const PAS = 16
/** La largeur gardée dans ce navigateur, par personne et par appareil, jamais envoyée. */
const CLE = "oto-rail-largeur"

const largeurMax = () => Math.max(LARGEUR_MIN, Math.round(window.innerWidth * PART_MAX))
const borner = (largeur: number) => Math.min(largeurMax(), Math.max(LARGEUR_MIN, Math.round(largeur)))

/** La largeur gardée, ou `null` : aucune, ou un stockage refusé (navigation privée, données bloquées). */
function largeurGardee(): number | null {
  try {
    const lue = Number(window.localStorage.getItem(CLE))
    return Number.isFinite(lue) && lue > 0 ? lue : null
  } catch {
    return null
  }
}

function garder(largeur: number | null) {
  try {
    if (largeur === null) window.localStorage.removeItem(CLE)
    else window.localStorage.setItem(CLE, String(largeur))
  } catch {
    // Un stockage refusé ne garde rien : la largeur vaut pour cette page.
  }
}

export function PoigneeDuRail() {
  const poignee = useRef<HTMLDivElement>(null)
  const [largeur, setLargeur] = useState<number | null>(null)
  // La borne haute dépend de la fenêtre : lue après l'hydratation, comme la largeur gardée.
  const [maximum, setMaximum] = useState<number | undefined>(undefined)
  const glisse = useRef(false)

  // La largeur gardée, lue après l'hydratation : le rendu du serveur ne la connaît pas.
  useEffect(() => {
    setMaximum(largeurMax())
    const gardee = largeurGardee()
    if (gardee !== null) setLargeur(borner(gardee))
  }, [])

  // Le bureau porte la largeur (`--rail-w`) : sa grille et le rail la lisent.
  useEffect(() => {
    const bureau = poignee.current?.closest<HTMLElement>(".oto-desk")
    if (!bureau) return
    if (largeur === null) bureau.style.removeProperty("--rail-w")
    else bureau.style.setProperty("--rail-w", `${largeur}px`)
  }, [largeur])

  const poser = (suivante: number | null) => {
    setLargeur(suivante)
    garder(suivante)
  }

  const suivre = (evenement: PointerEvent<HTMLDivElement>) => {
    if (!glisse.current) return
    const gauche = poignee.current?.parentElement?.getBoundingClientRect().left ?? 0
    setLargeur(borner(evenement.clientX - gauche))
  }

  const lacher = (evenement: PointerEvent<HTMLDivElement>) => {
    if (!glisse.current) return
    glisse.current = false
    if (evenement.currentTarget.hasPointerCapture?.(evenement.pointerId)) evenement.currentTarget.releasePointerCapture(evenement.pointerId)
    const gauche = poignee.current?.parentElement?.getBoundingClientRect().left ?? 0
    poser(borner(evenement.clientX - gauche))
  }

  const toucher = (evenement: KeyboardEvent<HTMLDivElement>) => {
    const actuelle = largeur ?? LARGEUR_PAR_DEFAUT
    const suivante =
      evenement.key === "ArrowLeft" ? actuelle - PAS : evenement.key === "ArrowRight" ? actuelle + PAS : evenement.key === "Home" ? LARGEUR_MIN : evenement.key === "End" ? largeurMax() : null
    if (suivante === null) return
    evenement.preventDefault()
    poser(borner(suivante))
  }

  return (
    <div
      ref={poignee}
      role="separator"
      aria-orientation="vertical"
      aria-label={RAIL.largeur}
      aria-valuemin={LARGEUR_MIN}
      aria-valuemax={maximum}
      aria-valuenow={largeur ?? LARGEUR_PAR_DEFAUT}
      tabIndex={0}
      className="oto-rail-resize"
      onPointerDown={(evenement) => {
        if (evenement.button !== 0) return
        glisse.current = true
        evenement.preventDefault()
        evenement.currentTarget.setPointerCapture?.(evenement.pointerId)
      }}
      onPointerMove={suivre}
      onPointerUp={lacher}
      onPointerCancel={lacher}
      onDoubleClick={() => poser(null)}
      onKeyDown={toucher}
    />
  )
}
