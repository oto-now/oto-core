"use client"

// La veille d'une page ouverte (retour RET-008) : tant que l'onglet est visible, toutes les 30 secondes et au retour sur
// l'onglet ou dans la fenêtre, l'écran relit la seule révision publiée de la page (`GET nodes/revision`). Si elle a
// changé ailleurs (un assistant, une autre personne), la page se relit ; si la personne écrit dans la page à ce
// moment-là, rien n'est remplacé sous ses doigts : un bandeau propose de recharger. Sans elle, une écriture d'un
// assistant n'apparaissait qu'après un rechargement à la main. Un onglet caché ne lit rien ; un échec de lecture se tait,
// la veille réessaie au tour suivant.
import { useCallback, useEffect, useRef, useState } from "react"
import type { NodeRevision } from "../../schemas/search"
import { appelerPlateforme } from "../api/client"
import { Alert, Button } from "../ds/react/primitives"
import { useRafraichir } from "../hote/rafraichir"
import { VEILLE } from "./libelles"

/** L'intervalle entre deux lectures, onglet visible (décision de JB : 30 secondes). */
export const VEILLE_MS = 30_000

/** Vrai quand la personne écrit dans la page : le focus est dans un champ de saisie ou une zone modifiable. */
function enTrainDEcrire(): boolean {
  const actif = document.activeElement
  if (!(actif instanceof HTMLElement)) return false
  return actif.isContentEditable || actif instanceof HTMLTextAreaElement || (actif instanceof HTMLInputElement && actif.type !== "checkbox" && actif.type !== "radio")
}

type VeilleDeLaPageProps = {
  /** Le chemin de la page ouverte. */
  chemin: string
  /** La révision publiée servie avec la page. */
  revision: number
}

export function VeilleDeLaPage({ chemin, revision }: VeilleDeLaPageProps) {
  const rafraichir = useRafraichir()
  const [modifieeAilleurs, setModifieeAilleurs] = useState(false)
  // La révision servie, lue par la vérification sans la relancer à chaque rendu.
  const servie = useRef(revision)
  useEffect(() => {
    servie.current = revision
    setModifieeAilleurs(false)
  }, [revision])

  const verifier = useCallback(async () => {
    if (document.visibilityState !== "visible") return
    const lue = await appelerPlateforme<NodeRevision>({ methode: "GET", ressource: `nodes/revision?path=${encodeURIComponent(chemin)}` })
    if (lue.erreur || lue.data.revision <= servie.current) return
    if (enTrainDEcrire()) setModifieeAilleurs(true)
    else rafraichir()
  }, [chemin, rafraichir])

  useEffect(() => {
    const tour = window.setInterval(() => void verifier(), VEILLE_MS)
    const auRetour = () => void verifier()
    document.addEventListener("visibilitychange", auRetour)
    window.addEventListener("focus", auRetour)
    return () => {
      window.clearInterval(tour)
      document.removeEventListener("visibilitychange", auRetour)
      window.removeEventListener("focus", auRetour)
    }
  }, [verifier])

  // La région se monte vide et reçoit son message ensuite (`accessibility-patterns.md § Régions dynamiques`) ; l'encart
  // du design system y entre sans rôle propre, qui ferait annoncer deux fois.
  return (
    <div role="status">
      {modifieeAilleurs && (
        <Alert
          role="none"
          tone="review"
          title={VEILLE.modifiee}
          actions={
            <Button size="sm" variant="secondary" onClick={rafraichir}>
              {VEILLE.recharger}
            </Button>
          }
        />
      )}
    </div>
  )
}
