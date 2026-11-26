"use client"

// Un geste destructeur vers l'API du paquet, confirmé en ligne (E05-S03, AC20, HN-E05S03-2) : le
// bouton cède sa place à la question, « Garder » (focus posé dessus) puis la confirmation ; Échap ou
// « Garder » rendent le bouton et le focus. Un refus se dit sous le geste (`role="alert"`), le focus
// rendu au bouton ; un succès donne le focus à l'ancre de la liste, puis fait relire la page par
// l'hôte : la ligne, ou le bouton, part avec la relecture. Un refus `not_found` dit que la cible est
// déjà partie (AC6 : invitation acceptée ou annulée ailleurs) : l'alerte est rendue, le focus va à
// l'ancre, puis la page se relit (HN-E05S03-31). Sans lui, cinq gestes destructeurs de l'écran
// `/teams` réécrivaient chacun la même confirmation.
//
// Porté d'oto-frontend (`components/settings/team-people-rows.tsx`, `AnnulationDeLInvitation` ;
// `member-actions.tsx` l. 74-81, `replierLeFocusSur`). Repris : la confirmation sur place, « Garder »
// avant le geste destructeur, qui n'est jamais le bouton par défaut ; le focus replié sur une ancre
// nommée de la liste, jamais laissé à `<body>`, le `Button` du DS. Retiré : le `Dialog` modal et son piège à
// focus, les glyphes du DS. La question elle-même est `useConfirmationEnLigne` (E05-S04).
import { useEffect, useRef, useState } from "react"
import { appelerPlateforme } from "../api/client"
import { messageDErreur, type MessagesDuGeste } from "../api/messages"
import { useRafraichir } from "../hote/rafraichir"
import { Button } from "../ds/react/primitives"
import { useConfirmationEnLigne } from "./confirmation-en-ligne"
import { replierLeFocusSur } from "./focus"

type RequetePlateforme = { methode: "POST" | "PATCH" | "DELETE"; ressource: string; corps?: unknown }

type ActionPlateformeProps = {
  libelle: string
  requete: RequetePlateforme
  /**
   * La question posée en place avant l'envoi ; absente, le geste part au clic, sans question : un
   * geste réversible (changer l'état d'un retour, E08-S09 AC10), le bouton désactivé pendant l'envoi.
   */
  confirmation?: { question: string; libelleConfirmer: string }
  /**
   * Identifiant du titre de la liste (légende ou titre de section, en `tabIndex={-1}`) qui reçoit le
   * focus après un succès ou un refus `not_found` : il reste à l'écran quand la ligne part
   * (`accessibility-patterns.md` § Focus Management).
   */
  ancre: string
  /** Phrases propres au geste, par raison ou par code (elles nomment l'organisation, la personne). */
  messages?: MessagesDuGeste
  /**
   * Nom accessible du bouton de départ, plusieurs lignes portant le même libellé : il commence par le
   * libellé visible (WCAG 2.5.3) et nomme la cible.
   */
  nomAccessible: string
  /** La taille de ses voisins : `sm` dans la cellule d'un tableau, à côté des gestes de ligne ; `md` ailleurs. */
  taille?: "sm" | "md"
}

export function ActionPlateforme({ libelle, requete, confirmation, ancre, messages, nomAccessible, taille = "md" }: ActionPlateformeProps) {
  const rafraichir = useRafraichir()
  const [envoi, setEnvoi] = useState(false)
  const [erreur, setErreur] = useState("")
  // Un double clic arrive avant que le bouton désactivé soit rendu : ce verrou tient l'envoi unique.
  const enCours = useRef(false)
  const racine = useRef<HTMLDivElement>(null)
  const relireApresLAlerte = useRef(false)
  const question = useConfirmationEnLigne({
    question: confirmation?.question ?? "",
    libelleConfirmer: confirmation?.libelleConfirmer ?? "",
    confirmer: () => void envoyer(),
    envoi,
    taille,
  })

  useEffect(() => {
    // L'alerte d'un refus `not_found` est rendue, donc annoncée : la relecture peut emporter la ligne.
    if (!erreur || !relireApresLAlerte.current) return
    relireApresLAlerte.current = false
    rafraichir()
  }, [erreur, rafraichir])

  async function envoyer() {
    if (enCours.current) return
    enCours.current = true
    setErreur("")
    setEnvoi(true)
    const reponse = await appelerPlateforme<unknown>(requete)
    enCours.current = false
    setEnvoi(false)
    if (reponse.erreur && reponse.erreur.code !== "not_found") {
      // Le bouton revient, le focus avec lui : le refus se corrige depuis le geste.
      question.revenir()
      setErreur(messageDErreur(reponse.erreur, messages))
      return
    }
    // Un succès, ou une cible déjà partie : la relecture emporte la ligne, le focus l'attend à l'ancre.
    replierLeFocusSur(ancre, racine.current)
    question.refermer()
    if (!reponse.erreur) {
      rafraichir()
      return
    }
    relireApresLAlerte.current = true
    setErreur(messageDErreur(reponse.erreur, messages))
  }

  return (
    <div ref={racine} className="space-y-1">
      {confirmation && question.ouverte ? (
        question.rendu
      ) : (
        <Button
          ref={question.depart}
          type="button"
          variant="secondary"
          size={taille}
          aria-label={nomAccessible}
          disabled={envoi}
          aria-busy={envoi || undefined}
          onClick={() => (confirmation ? question.demander() : void envoyer())}
        >
          {libelle}
        </Button>
      )}
      {erreur && (
        <p role="alert" className="text-sm text-ink">
          {erreur}
        </p>
      )}
    </div>
  )
}
