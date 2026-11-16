"use client"

// « Commenter ce passage » sur un texte sélectionné (parcours 5.4, AC15) : la sélection, prise dans un seul bloc
// publié, fait paraître un bouton léger, centré au-dessus d'elle (au-dessus du bloc dans l'éditeur) ; il ouvre un nouveau fil dont elle est la citation (ou sur le bloc
// seul, quand elle ne se retrouverait pas dans son texte : `passage.ts`). Au clavier, le même fil s'ouvre par la bulle
// du bloc, sans citation. Monté une fois par le fournisseur des commentaires. Sans lui, un fil ne citerait rien.
import { useEffect, useState } from "react"
import { ChatText } from "@phosphor-icons/react/dist/csr/ChatText"
import { Icon } from "../../ds/react/icon"
import { Button } from "../../ds/react/primitives"
import { useCommentaires } from "./contexte"
import { BULLE } from "./libelles"
import { passageChoisi, type PassageChoisi } from "./passage"

/** Le bouton se pose au-dessus du passage, centré, sans sortir de la fenêtre. */
const AU_DESSUS = 38
const DEMI_LARGEUR = 100
const MARGE = 8

export function CommenterLaSelection() {
  const commentaires = useCommentaires()
  const [passage, setPassage] = useState<PassageChoisi | null>(null)
  const publies = commentaires?.blocsPublies
  useEffect(() => {
    if (!publies || publies.size === 0) return
    // La sélection se lit quand le geste finit (souris lâchée, touche relâchée), pas pendant qu'elle s'étend.
    const lire = () => setPassage(passageChoisi(publies))
    // Une sélection défaite retire le bouton tout de suite.
    const oublier = () => {
      if (passageChoisi(publies) === null) setPassage(null)
    }
    document.addEventListener("mouseup", lire)
    document.addEventListener("keyup", lire)
    document.addEventListener("selectionchange", oublier)
    return () => {
      document.removeEventListener("mouseup", lire)
      document.removeEventListener("keyup", lire)
      document.removeEventListener("selectionchange", oublier)
    }
  }, [publies])
  if (!commentaires || !passage) return null
  return (
    <div
      className="oto-commenter-selection"
      // La place suit la sélection, mesurée à l'écran : seule valeur qu'une classe ne porte pas.
      style={{ top: Math.max(MARGE, passage.haut - AU_DESSUS), left: Math.max(MARGE + DEMI_LARGEUR, Math.min(window.innerWidth - DEMI_LARGEUR - MARGE, passage.centre)) }}
      // L'appui ne prend pas le focus : la sélection reste jusqu'au clic.
      onMouseDown={(evenement) => evenement.preventDefault()}
    >
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          commentaires.commenter(passage.bloc, passage.citation)
          setPassage(null)
          window.getSelection()?.removeAllRanges()
        }}
      >
        <Icon as={ChatText} size="xs" />
        {BULLE.commenter}
      </Button>
    </div>
  )
}
