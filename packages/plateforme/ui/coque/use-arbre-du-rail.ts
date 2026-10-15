"use client"

// L'arbre que montre le rail, tenu à jour sans recharger la page (E11-S20). Le layout de l'hôte le sert au premier
// rendu et à chaque relecture de la page, mais Next ne rejoue pas un layout à la navigation client : le rail relit
// alors son arbre seul, par `GET /api/platform/nodes/tree` (le service du layout, sous la session), quand l'adresse
// change, au retour sur l'onglet ou la fenêtre (5 s au moins après la relecture précédente, HN-E11S20-2), et à chaque
// relecture de la page (`useRafraichir`, qui suit chaque geste, HN-E11S20-1). L'arbre montré reste pendant la
// lecture et sur un échec (HN-E11S20-3) ; une relecture demandée pendant qu'une autre est en vol en fait suivre une
// seule (HN-E11S20-4).
import { useCallback, useEffect, useRef, useState } from "react"
import { appelerPlateforme } from "../api/client"
import type { DonneesDuRail } from "./types"

type ArbreDuRail = DonneesDuRail["arbre"]
type ArbreLu = NonNullable<ArbreDuRail["data"]>

/** L'événement de la fenêtre qui demande au rail de relire son arbre : les gestes sont montés hors du rail (la page). */
const RELIRE_LE_RAIL = "oto:relire-le-rail"
/** Le délai minimal entre deux relectures dues au retour sur l'onglet ou la fenêtre (AC-4). */
const DELAI_DE_RETOUR_MS = 5_000
/** Les échecs d'affilée à partir desquels le rail dit, discrètement, que son arbre n'est plus actualisé (AC-6). */
const ECHECS_DITS = 3

/** Demande au rail monté de relire son arbre ; sans rail monté, rien ne part. */
export function relireLeRail(): void {
  window.dispatchEvent(new Event(RELIRE_LE_RAIL))
}

/** Écoute chaque relecture du rail (après chaque geste) : le panneau d'une équipe s'y relit ; rend le retrait de l'écoute. */
export function surRelectureDuRail(relire: () => void): () => void {
  window.addEventListener(RELIRE_LE_RAIL, relire)
  return () => window.removeEventListener(RELIRE_LE_RAIL, relire)
}

/** Une réponse qui a la forme de l'arbre servi par le layout ; toute autre compte comme un échec. */
function estUnArbre(data: unknown): data is ArbreLu {
  return typeof data === "object" && data !== null && "tree" in data && Array.isArray(data.tree) && "truncated" in data && typeof data.truncated === "boolean"
}

async function lireLArbre(): Promise<ArbreLu | null> {
  const lu = await appelerPlateforme<unknown>({ methode: "GET", ressource: "nodes/tree" })
  return lu.erreur === undefined && estUnArbre(lu.data) ? lu.data : null
}

type Etat = { servi: ArbreDuRail; arbre: ArbreDuRail; echecs: number }

/**
 * L'arbre du rail : `servi` (le layout) au départ et chaque fois qu'il en sert un autre (AC-8), puis celui de chaque
 * relecture réussie. `enPanne` : trois relectures d'affilée en échec.
 */
export function useArbreDuRail(servi: ArbreDuRail, chemin: string): { arbre: ArbreDuRail; enPanne: boolean } {
  const [etat, setEtat] = useState<Etat>({ servi, arbre: servi, echecs: 0 })
  if (etat.servi !== servi) setEtat({ servi, arbre: servi, echecs: 0 })
  // `derniere` : le départ de la dernière relecture, ou le montage ; lu par le seul retour sur l'onglet.
  const suivi = useRef({ enVol: false, encore: false, derniere: 0 })

  const relire = useCallback(async function relireUneFois(): Promise<void> {
    const lecture = suivi.current
    if (lecture.enVol) {
      lecture.encore = true
      return
    }
    lecture.enVol = true
    lecture.derniere = Date.now()
    const arbre = await lireLArbre()
    lecture.enVol = false
    setEtat((avant) => (arbre ? { ...avant, arbre: { data: arbre }, echecs: 0 } : { ...avant, echecs: avant.echecs + 1 }))
    if (!lecture.encore) return
    lecture.encore = false
    await relireUneFois()
  }, [])

  // Une navigation client : le layout n'est pas rejoué (AC-3). Le premier rendu ne relit pas, l'arbre vient d'être servi.
  const cheminVu = useRef(chemin)
  useEffect(() => {
    if (cheminVu.current === chemin) return
    cheminVu.current = chemin
    void relire()
  }, [chemin, relire])

  useEffect(() => {
    suivi.current.derniere = Date.now()
    const auRetour = () => {
      if (document.visibilityState !== "visible" || Date.now() - suivi.current.derniere < DELAI_DE_RETOUR_MS) return
      void relire()
    }
    const surDemande = () => void relire()
    document.addEventListener("visibilitychange", auRetour)
    window.addEventListener("focus", auRetour)
    window.addEventListener(RELIRE_LE_RAIL, surDemande)
    return () => {
      document.removeEventListener("visibilitychange", auRetour)
      window.removeEventListener("focus", auRetour)
      window.removeEventListener(RELIRE_LE_RAIL, surDemande)
    }
  }, [relire])

  return { arbre: etat.arbre, enPanne: etat.echecs >= ECHECS_DITS }
}
