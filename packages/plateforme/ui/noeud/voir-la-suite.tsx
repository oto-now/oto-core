"use client"

// « Voir les N autres » d'une colonne du pied d'un contenu (refonte #217) : les cinq premières lignes sont rendues, la
// suite arrive en place au clic, déjà rendue par le serveur ; le bouton part, le focus va à la première ligne révélée.
// Sans lui, une colonne longue pousserait le pied hors de la vue, ou ses lignes au-delà de cinq ne se liraient pas.
import { useEffect, useRef, useState, type ReactNode } from "react"
import { Button } from "../ds/react/primitives"

type VoirLaSuiteProps = { premieres: ReactNode; suite: ReactNode; libelle: string; nom: string }

export function VoirLaSuite({ premieres, suite, libelle, nom }: VoirLaSuiteProps) {
  const [ouverte, setOuverte] = useState(false)
  const liste = useRef<HTMLUListElement>(null)
  const demandee = useRef(false)
  useEffect(() => {
    if (!ouverte || !demandee.current) return
    demandee.current = false
    liste.current?.querySelector<HTMLElement>("[data-suite] a")?.focus()
  }, [ouverte])
  return (
    <>
      <ul ref={liste} className="oto-node-foot-list" aria-label={nom}>
        {premieres}
        {ouverte && suite}
      </ul>
      {!ouverte && (
        <Button
          variant="link"
          size="sm"
          onClick={() => {
            demandee.current = true
            setOuverte(true)
          }}
        >
          {libelle}
        </Button>
      )}
    </>
  )
}
