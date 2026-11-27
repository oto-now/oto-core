"use client"

// La confirmation en ligne d'un geste (E05-S03, HN-E05S03-2 ; reprise par E05-S02 et E05-S04) : le bouton
// de départ cède sa place à la question, « Garder » (focus posé dessus) puis la confirmation ; « Garder »
// ou Échap rendent le bouton et le focus. Un hook qui rend la question, et non un composant : un îlot de
// `ui/` ne reçoit jamais de fonction en prop (`portage-ecrans.md § 2`), et chaque geste lui passe son
// envoi en argument. Sans lui, `ActionPlateforme`, « Abandonner mon texte » et la publication d'un
// Contexte vide réécrivaient chacun la même question, ses refs et son focus.
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react"
import { Button } from "../ds/react/primitives"

type Confirmation = {
  question: string
  libelleConfirmer: string
  /** Le geste, une fois confirmé. */
  confirmer: () => void
  /** Pendant l'envoi (`ActionPlateforme`), la question reste, ses boutons désactivés, et Échap n'y fait rien. */
  envoi?: boolean
  /** La taille du bouton de départ, que ses deux boutons remplacent : `sm` par défaut, celle des gestes de ligne. */
  taille?: "sm" | "md"
}

/**
 * La question d'un geste confirmé en ligne : `rendu`, à montrer à la place du bouton de départ tant
 * qu'elle est `ouverte` ; `depart`, la référence de ce bouton, qui reprend le focus après `revenir`.
 */
export function useConfirmationEnLigne({ question, libelleConfirmer, confirmer, envoi = false, taille = "sm" }: Confirmation) {
  const id = useId()
  const [ouverte, setOuverte] = useState(false)
  const depart = useRef<HTMLButtonElement>(null)
  const garder = useRef<HTMLButtonElement>(null)
  const rendreLeFocus = useRef(false)

  useEffect(() => {
    if (ouverte) garder.current?.focus()
  }, [ouverte])
  // Au rendu qui suit `revenir` (question refermée, ou envoi refusé), le bouton de départ reprend le focus.
  useEffect(() => {
    if (!rendreLeFocus.current) return
    rendreLeFocus.current = false
    depart.current?.focus()
  })

  function revenir() {
    rendreLeFocus.current = true
    setOuverte(false)
  }

  function surLaQuestion(evenement: KeyboardEvent<HTMLDivElement>) {
    if (evenement.key !== "Escape" || envoi) return
    evenement.preventDefault()
    revenir()
  }

  const rendu: ReactNode = ouverte && (
    <div role="group" aria-labelledby={id} onKeyDown={surLaQuestion} className="flex flex-wrap items-center gap-2">
      <p id={id} className="text-sm text-ink">
        {question}
      </p>
      <Button ref={garder} type="button" variant="secondary" size={taille} disabled={envoi} onClick={revenir}>
        Garder
      </Button>
      <Button type="button" variant="primary" size={taille} disabled={envoi} aria-busy={envoi} onClick={confirmer}>
        {libelleConfirmer}
      </Button>
    </div>
  )
  return { ouverte, rendu, depart, demander: () => setOuverte(true), refermer: () => setOuverte(false), revenir }
}
