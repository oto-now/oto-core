"use client"

// Le glisser-déposer d'un bloc par sa poignée (E05-S10, AC-a3) : la vraie rangée bouge sous le pointeur, dans le modèle
// seulement ; l'ordre part une seule fois, au dépôt (`move_block`). En deçà de 4 px, c'est un clic : la poignée ouvre son
// menu ; après un déplacement, le clic qui termine le geste n'ouvre rien. Sans lui, un bloc ne change de place que rang
// par rang, par le menu ou le clavier.
//
// Porté d'oto-frontend (`components/editor/use-drag-block.ts`). Repris : Pointer Events et capture du
// pointeur (ni HTML5 DnD, absent au tactile, ni fantôme, que l'îlot rognerait), le seuil de geste, le défilement
// entretenu aux bords, l'enregistrement au dépôt seulement, le clic avalé. Changé : les rangées sont lues sous la racine
// de l'éditeur (`[data-cle]`), et c'est la fenêtre qui défile (l'îlot de la plateforme ne défile pas).
//
// E11-S17 (AC-a8) : la poignée d'un bloc sélectionné parmi d'autres glisse le groupe ; un titre emmène sa section. La cible
// se lit sous le pointeur à chaque mouvement, plusieurs rangs d'un coup, sur les rangées montrées (une section repliée se
// passe d'un seul tenant) et dans leur ordre sans le groupe, qui ne fait donc pas osciller la cible en se déplaçant ;
// interrompu, l'éditeur remet lui-même l'ordre d'avant.
import { useEffect, useRef, useState, type MouseEvent, type PointerEvent, type RefObject } from "react"

/** En deçà, c'est un clic : le menu de la poignée s'ouvre sans déplacer le bloc. */
const SEUIL_DE_GESTE_PX = 4
/** La bande, aux bords de la fenêtre, où le défilement s'entretient tout seul. */
const ZONE_DE_BORD_PX = 40
/** Ce qu'on défile par image : à 60 Hz, ~720 px/s. */
const PAS_DE_DEFILEMENT_PX = 12

/** Les gestionnaires de la poignée, servis aux rangées par le contexte de l'éditeur. */
export type PoigneeGlissee = {
  appui: (cle: string, evenement: PointerEvent<HTMLElement>) => void
  mouvement: (evenement: PointerEvent<HTMLElement>) => void
  lacher: (evenement: PointerEvent<HTMLElement>) => void
  annuler: () => void
  clicCapture: (evenement: MouseEvent<HTMLElement>) => void
}

type Parametres = {
  racine: RefObject<HTMLElement | null>
  /** Les rangées qui se glissent avec la rangée tenue, elle comprise : les blocs sélectionnés ou elle seule, et la section de chaque titre. */
  groupe: (cle: string) => readonly string[]
  /** Le groupe posé juste avant la rangée `suivante` (`null` : en fin de page), dans le modèle seulement. */
  poser: (cle: string, suivante: string | null) => void
  /** Le geste est fini : l'ordre part. */
  deposer: (cle: string) => void
  /** Un geste interrompu : l'éditeur remet l'ordre d'avant. */
  revenir: (cle: string) => void
}

/**
 * `ecart` : du pointeur au haut du groupe, lu au premier mouvement ; `cible` : la rangée que le groupe précède, `null` en fin
 * de page ; `y` : le dernier pointeur, relu quand la fenêtre défile sous un pointeur immobile.
 */
type Geste = { cle: string; depart: number; aBouge: boolean; groupe: ReadonlySet<string>; ecart: number; cible: string | null; y: number }

const rangeesDe = (racine: HTMLElement | null) => (racine ? [...racine.querySelectorAll<HTMLElement>("[data-cle]")] : [])

/**
 * Le haut du groupe tel qu'il suivra la rangée tenue, regroupé : le haut de celle-ci moins la hauteur des rangées montrées
 * du groupe qui la précèdent. Une sélection éparse se pose ainsi d'après la rangée qu'on tient, pas d'après son premier bloc.
 */
function hautDuGroupe(racine: HTMLElement | null, cle: string, groupe: ReadonlySet<string>): number {
  const rangees = rangeesDe(racine)
  const tenue = rangees.findIndex((rangee) => rangee.dataset.cle === cle)
  const avant = rangees.slice(0, Math.max(tenue, 0)).filter((rangee) => groupe.has(rangee.dataset.cle ?? ""))
  const hauteur = avant.reduce((somme, rangee) => somme + rangee.getBoundingClientRect().height, 0)
  return (rangees[tenue]?.getBoundingClientRect().top ?? 0) - hauteur
}

/**
 * La rangée devant laquelle se pose un groupe dont le haut est à `haut` : la première rangée montrée hors du groupe dont le
 * milieu est plus bas, `null` après la dernière. Les positions se lisent comme si le groupe n'était pas là (chaque passage
 * du groupe retiré de ce qui le suit) ; une rangée cachée par un pli n'a pas de boîte et se passe avec son titre.
 */
function cibleSous(racine: HTMLElement | null, groupe: ReadonlySet<string>, haut: number): string | null {
  let retrait = 0
  let passage: number | null = null
  for (const rangee of rangeesDe(racine)) {
    const cle = rangee.dataset.cle ?? ""
    const boite = rangee.getBoundingClientRect()
    if (groupe.has(cle)) {
      if (passage === null && boite.height > 0) passage = boite.top
      continue
    }
    if (boite.height === 0) continue
    if (passage !== null) {
      retrait += boite.top - passage
      passage = null
    }
    if (haut < boite.top - retrait + boite.height / 2) return cle
  }
  return null
}

export function useGlisser(parametres: Parametres): { enCours: string | null; poignee: PoigneeGlissee } {
  const [enCours, setEnCours] = useState<string | null>(null)
  const geste = useRef<Geste | null>(null)
  const avale = useRef(false)
  const image = useRef<number | undefined>(undefined)
  const vitesse = useRef(0)
  // Les rappels du dernier rendu : un geste commencé plus tôt déplace le modèle courant.
  const lus = useRef(parametres)
  useEffect(() => {
    lus.current = parametres
  })

  const arreterLeDefilement = () => {
    if (image.current !== undefined) cancelAnimationFrame(image.current)
    image.current = undefined
  }
  // Quitter l'écran au milieu d'un geste ne laisse pas de boucle d'images en vie.
  useEffect(() => arreterLeDefilement, [])

  /** Le groupe suit le pointeur : posé ailleurs quand la rangée qu'il précède change. */
  const suivre = () => {
    const courant = geste.current
    if (!courant) return
    const cible = cibleSous(lus.current.racine.current, courant.groupe, courant.y - courant.ecart)
    if (cible === courant.cible) return
    courant.cible = cible
    lus.current.poser(courant.cle, cible)
  }

  /** Sans boucle, le pointeur immobile contre le bord n'émet plus rien, et le défilement s'arrêterait là. */
  const entretenirLeDefilement = (y: number) => {
    vitesse.current = y < ZONE_DE_BORD_PX ? -PAS_DE_DEFILEMENT_PX : y > window.innerHeight - ZONE_DE_BORD_PX ? PAS_DE_DEFILEMENT_PX : 0
    if (vitesse.current === 0) return arreterLeDefilement()
    if (image.current !== undefined) return
    const pas = () => {
      window.scrollBy(0, vitesse.current)
      // Les rangées défilent sous le pointeur immobile : la cible se relit.
      suivre()
      image.current = requestAnimationFrame(pas)
    }
    image.current = requestAnimationFrame(pas)
  }

  const finir = () => {
    arreterLeDefilement()
    geste.current = null
    setEnCours(null)
  }

  const poignee: PoigneeGlissee = {
    appui(cle, evenement) {
      if (evenement.button !== 0) return
      geste.current = { cle, depart: evenement.clientY, aBouge: false, groupe: new Set(), ecart: 0, cible: null, y: evenement.clientY }
      // Les événements continuent d'arriver sur la poignée quand le pointeur en sort.
      evenement.currentTarget.setPointerCapture?.(evenement.pointerId)
    },
    mouvement(evenement) {
      const courant = geste.current
      if (!courant) return
      if (!courant.aBouge && Math.abs(evenement.clientY - courant.depart) < SEUIL_DE_GESTE_PX) return
      courant.y = evenement.clientY
      if (!courant.aBouge) {
        // Le groupe, l'écart du pointeur à son haut et sa place se lisent une fois : le geste part de là.
        courant.aBouge = true
        setEnCours(courant.cle)
        const racine = lus.current.racine.current
        courant.groupe = new Set(lus.current.groupe(courant.cle))
        const haut = hautDuGroupe(racine, courant.cle, courant.groupe)
        courant.ecart = courant.depart - haut
        courant.cible = cibleSous(racine, courant.groupe, haut)
      }
      suivre()
      entretenirLeDefilement(evenement.clientY)
    },
    lacher(evenement) {
      const courant = geste.current
      if (evenement.currentTarget.hasPointerCapture?.(evenement.pointerId)) evenement.currentTarget.releasePointerCapture(evenement.pointerId)
      finir()
      if (!courant?.aBouge) return
      avale.current = true
      lus.current.deposer(courant.cle)
    },
    annuler() {
      const courant = geste.current
      finir()
      // Un geste interrompu par le système (`pointercancel` : appel, défilement tactile) ne dépose rien : le bloc
      // reprend sa place d'origine, sans quoi l'écran montrerait un ordre que rien n'a enregistré.
      if (courant?.aBouge) lus.current.revenir(courant.cle)
    },
    clicCapture(evenement) {
      // Un déplacement se termine par un clic sur la poignée : sans cette garde, chaque dépôt ouvrirait son menu.
      if (!avale.current) return
      avale.current = false
      evenement.preventDefault()
      evenement.stopPropagation()
    },
  }
  return { enCours, poignee }
}
