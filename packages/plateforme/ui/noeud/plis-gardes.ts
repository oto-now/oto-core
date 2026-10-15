"use client"

// Les titres et les menus dépliants qu'une personne a ouverts ou repliés, gardés dans CE navigateur par l'`id` de leur
// bloc (`liste-gardee.ts`), ni en base ni dans l'adresse : un titre est ouvert par défaut, un menu dépliant replié, et
// le geste de la personne survit au rechargement. Chaque entrée dit l'état choisi (`<id>=1` ouvert, `<id>=0` replié),
// les 500 dernières gardées : la liste ne grandit pas sans fin. Chaque geste relit la liste avant de l'écrire, plusieurs
// plis d'une page l'écrivant chacun. L'état se lit après le montage : le rendu du serveur et l'hydratation s'accordent.
import { useCallback, useEffect, useState, type RefObject } from "react"
import { ecrireLaListe, lireLaListe } from "../components/liste-gardee"

const CLE_DE_STOCKAGE = "oto-plis"
const PLAFOND = 500

/** L'état choisi pour chaque bloc dans ce navigateur : `true` ouvert, `false` replié ; un bloc absent garde son défaut. */
export function plisGardes(): ReadonlyMap<string, boolean> {
  return new Map(lireLaListe(CLE_DE_STOCKAGE).map((entree) => [entree.slice(0, -2), entree.endsWith("=1")]))
}

/** Le pli du bloc `id` ouvert ou replié, écrit tout de suite. */
export function garderLePli(id: string, ouvert: boolean): void {
  const autres = lireLaListe(CLE_DE_STOCKAGE).filter((entree) => entree.slice(0, -2) !== id)
  ecrireLaListe(CLE_DE_STOCKAGE, [...autres, `${id}=${ouvert ? 1 : 0}`].slice(-PLAFOND))
}

/**
 * L'état d'un pli : `defaut` au premier rendu, puis celui que ce navigateur a gardé pour le bloc ; un bloc sans `id`
 * (pas encore écrit) n'est pas gardé.
 */
export function usePliGarde(id: string | undefined, defaut: boolean): [boolean, (ouvert: boolean) => void] {
  const [ouvert, setOuvert] = useState(defaut)
  useEffect(() => {
    const garde = id === undefined ? undefined : plisGardes().get(id)
    if (garde !== undefined) setOuvert(garde)
  }, [id])
  const changer = useCallback(
    (suivant: boolean) => {
      setOuvert(suivant)
      if (id !== undefined) garderLePli(id, suivant)
    },
    [id],
  )
  return [ouvert, changer]
}

/** L'élément que vise l'ancre `#…` de l'adresse ; `null` sans ancre, ou pour une ancre mal encodée (`%` seul). */
function elementDeLAncre(hash: string): HTMLElement | null {
  try {
    const ancre = decodeURIComponent(hash.slice(1))
    return ancre === "" ? null : document.getElementById(ancre)
  } catch {
    // Une ancre que `decodeURIComponent` refuse ne vise aucun bloc.
    return null
  }
}

/**
 * Une ancre de l'adresse (`#ref`) qui vise un bloc replié dans `zone` : le pli s'ouvre, puis l'ancre se montre ; à
 * l'arrivée sur la page comme à chaque changement d'ancre.
 */
export function useOuvertParLAncre(zone: RefObject<HTMLElement | null>, ouvrir: () => void): void {
  useEffect(() => {
    const suivre = () => {
      const cible = elementDeLAncre(window.location.hash)
      if (!cible || !zone.current?.contains(cible)) return
      ouvrir()
      requestAnimationFrame(() => cible.scrollIntoView())
    }
    suivre()
    window.addEventListener("hashchange", suivre)
    return () => window.removeEventListener("hashchange", suivre)
  }, [zone, ouvrir])
}
