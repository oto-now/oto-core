"use client"

// Les titres repliables et les menus dépliants qu'une personne a ouverts, gardés dans CE navigateur par l'`id` de
// leur bloc (`liste-gardee.ts`), ni en base ni dans l'adresse : replié par défaut, à la lecture comme dans l'éditeur,
// un pli ouvert le reste au rechargement. La liste porte les plis OUVERTS, le défaut étant replié, et garde les
// 500 derniers ouverts : elle ne grandit pas sans fin. Chaque geste relit la liste avant de l'écrire, plusieurs plis
// d'une page l'écrivant chacun. L'état se lit après le montage : le rendu du serveur et l'hydratation s'accordent.
import { useCallback, useEffect, useState, type RefObject } from "react"
import { ecrireLaListe, lireLaListe } from "../components/liste-gardee"

const CLE_DE_STOCKAGE = "oto-plis-ouverts"
const PLAFOND = 500

/** Les `id` des blocs ouverts dans ce navigateur. */
export const plisOuverts = (): ReadonlySet<string> => new Set(lireLaListe(CLE_DE_STOCKAGE))

/** Le pli du bloc `id` ouvert ou refermé, écrit tout de suite. */
export function garderLePli(id: string, ouvert: boolean): void {
  const autres = lireLaListe(CLE_DE_STOCKAGE).filter((un) => un !== id)
  ecrireLaListe(CLE_DE_STOCKAGE, ouvert ? [...autres, id].slice(-PLAFOND) : autres)
}

/**
 * L'état d'un pli : `defaut` au premier rendu (replié pour un bloc servi, ouvert pour un bloc qu'on vient d'écrire), puis
 * ouvert si ce navigateur l'a gardé ouvert ; un bloc sans `id` n'est pas gardé.
 */
export function usePliGarde(id: string | undefined, defaut = false): [boolean, (ouvert: boolean) => void] {
  const [ouvert, setOuvert] = useState(defaut)
  useEffect(() => {
    if (id !== undefined && plisOuverts().has(id)) setOuvert(true)
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
