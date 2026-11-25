"use client"

// Les boutons de la fiche d'ajout dans le pied fixe de la fenêtre « Ajouter un connecteur » : la fenêtre pose une place
// vide dans son pied (`footer` du `Dialog`), la fiche y porte ses boutons. Le pied ne défile pas avec le corps : le
// bouton principal n'est jamais coupé. Lu par le formulaire d'une clé et par la connexion chez le tiers.
import { useEffect, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"

/** L'identifiant de la place des boutons, dans le pied de la fenêtre. */
export const PIED_DE_LA_FICHE = "pied-de-la-fiche"

/** La place vide que la fenêtre pose dans son pied. */
export const PlaceDuPied = () => <div id={PIED_DE_LA_FICHE} className="contents" />

/**
 * Les boutons de la fiche, portés dans le pied de la fenêtre une fois monté ; hors de la fenêtre (la page de connexion
 * d'un connecteur, qui monte le formulaire seul), ils restent sous lui.
 */
export function PiedDeLaFiche({ children }: { children: ReactNode }) {
  const [place, setPlace] = useState<Element | null | undefined>(undefined)
  useEffect(() => setPlace(document.getElementById(PIED_DE_LA_FICHE)), [])
  if (place === undefined) return null
  return place ? createPortal(children, place) : <div className="flex flex-wrap items-center justify-end gap-2">{children}</div>
}
