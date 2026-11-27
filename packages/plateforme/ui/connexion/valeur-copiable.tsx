"use client"

// Une valeur à coller dans un assistant et le raccourci qui la copie (E02-S04, AC1) : la valeur se lit
// entière et reste sélectionnable, le bouton n'est jamais le seul chemin. Sans ce composant, les six
// valeurs de l'écran répéteraient chacune leur copie et leur statut.
//
// Porté d'oto-frontend (`src/components/shared/lien-copiable.tsx`, forme `entier`) : la valeur en `code`
// mono qui prend la ligne (`min-w-0 grow`), le bouton secondaire `sm` du design system au glyphe de
// copie, qui ne rétrécit pas ; ce qui s'affiche est ce qui se copie (une seule prop). Changé : la valeur
// passe à la ligne entre les mots (`break-words` : une phrase de préférences garde ses mots) et garde ses
// lignes (`whitespace-pre-line` : une phrase sur plusieurs lignes se lit comme elle se copie) ; la copie
// se dit dans une région montée vide, « Copié » puis rien, ou « Copie impossible » (oto-frontend avalait
// l'échec) ; le nom accessible du bouton dit ce qu'il copie. Retiré : la forme `tronque`.
import { useEffect, useState } from "react"
import { Copy } from "@phosphor-icons/react/dist/csr/Copy"
import { COPIE_IMPOSSIBLE, copierLeTexte } from "../components/presse-papiers"
import { AnimatedIcon } from "../ds/react/icon"
import { Button } from "../ds/react/primitives"

const COPIE = "Copié"
/** « Copié » s'efface : resté à l'écran, il se lirait encore après une copie faite ailleurs. */
const DUREE_DE_COPIE_MS = 2000

type ValeurCopiableProps = {
  /** Ce qui s'affiche et ce qui se copie, à l'identique. */
  valeur: string
  /** Ce que copie le bouton, pour son nom accessible : « Copier <cible> ». */
  cible: string
}

export function ValeurCopiable({ valeur, cible }: ValeurCopiableProps) {
  const [statut, setStatut] = useState("")

  useEffect(() => {
    if (statut !== COPIE) return
    const minuteur = setTimeout(() => setStatut(""), DUREE_DE_COPIE_MS)
    return () => clearTimeout(minuteur)
  }, [statut])

  async function copier() {
    // Presse-papiers refusé ou absent : la valeur reste à l'écran, sélectionnable, et l'échec se dit.
    setStatut((await copierLeTexte(valeur)) ? COPIE : COPIE_IMPOSSIBLE)
  }

  return (
    <div className="flex flex-col gap-1">
      {/* La rangée passe à la ligne : sous 24 caractères de place, « Copier » descend sous la valeur au lieu de l'écraser. */}
      <div className="flex flex-wrap items-start gap-2">
        <code className="oto-mono min-w-0 grow basis-[24ch] select-all whitespace-pre-line break-words">{valeur}</code>
        <Button
          variant="secondary"
          size="sm"
          className="shrink-0"
          iconStart={<AnimatedIcon as={Copy} size="xs" />}
          onClick={() => void copier()}
          aria-label={`Copier ${cible}`}
        >
          Copier
        </Button>
      </div>
      {/* Montée vide, remplie au clic : une région de statut n'annonce que ce qui change après son montage. */}
      <p role="status" className="oto-caption min-h-5">
        {statut}
      </p>
    </div>
  )
}
