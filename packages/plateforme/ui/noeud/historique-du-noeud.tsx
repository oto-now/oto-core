"use client"

// L'historique d'un contenu à l'écran (refonte #217, #218, maquette validée) : le bouton « Historique des versions » de
// l'en-tête et l'icône « Historique du bloc » au survol d'un bloc ouvrent le même historique (`TiroirDHistorique`,
// `historique/`), sur la page ou sur un bloc. Ce module tient la portée ouverte, partagée par l'en-tête, les blocs et la
// piste de droite, qui vivent dans trois branches de l'écran. Dès 1 024 px, l'historique est un panneau de la piste de
// droite (`ColonnesDuNoeud`), à la place de celui des commentaires : ouvrir l'un ferme l'autre ; dessous, un tiroir monté
// ici. Sans lui, la bulle d'un bloc ne saurait pas ouvrir l'historique de l'en-tête.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { useBreakpoint } from "../ds/react/hooks"
import { useCommentaires } from "./commentaires/contexte"
import { TiroirDHistorique, type PorteeDuTiroir } from "./historique/tiroir-d-historique"

type Historique = {
  ouvrir: (portee: PorteeDuTiroir) => void
  fermer: () => void
  /** La portée ouverte, `null` fermé. */
  portee: PorteeDuTiroir | null
  noeud: { chemin: string; titre: string }
}

const ContexteDeLHistorique = createContext<Historique | null>(null)

/** L'historique, ou `null` hors de l'écran d'un contenu publié (page publique, widget) : pas d'icône. */
export function useHistorique(): Historique | null {
  return useContext(ContexteDeLHistorique)
}

type FournisseurDHistoriqueProps = {
  /** Le contenu dont l'historique lit les versions. */
  noeud: { chemin: string; titre: string }
  children: ReactNode
}

export function FournisseurDHistorique({ noeud, children }: FournisseurDHistoriqueProps) {
  const [portee, setPortee] = useState<PorteeDuTiroir | null>(null)
  const commentaires = useCommentaires()
  const etroit = useBreakpoint("lg")
  const ouvrirLEncart = commentaires?.ouvrirLEncart
  const encartOuvert = commentaires?.encartOuvert === true
  // Une seule piste à droite : l'historique ouvert ferme les commentaires, les commentaires ouverts ferment l'historique.
  const ouvrir = useCallback(
    (suivante: PorteeDuTiroir) => {
      ouvrirLEncart?.(false)
      setPortee(suivante)
    },
    [ouvrirLEncart],
  )
  useEffect(() => {
    if (encartOuvert) setPortee(null)
  }, [encartOuvert])
  const fermer = useCallback(() => setPortee(null), [])
  const valeur = useMemo(() => ({ ouvrir, fermer, portee, noeud }), [ouvrir, fermer, portee, noeud])
  return (
    <ContexteDeLHistorique.Provider value={valeur}>
      {children}
      {etroit && <TiroirDHistorique node={noeud} scope={portee ?? "page"} open={portee !== null} onClose={fermer} />}
    </ContexteDeLHistorique.Provider>
  )
}
