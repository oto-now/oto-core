"use client"

// « Décliner » un retour (E08-S09, AC10) : le bouton cède sa place à un formulaire en place, « Motif
// (lu par la personne qui a signalé) », 3 à 2 000 caractères, puis `PATCH feedback/<ticket>` et la
// relecture de la page. Le seul geste des retours qui demande une saisie : les autres sont des
// `ActionPlateforme` sans question. Même glu que `ui/invitations/` (React Hook Form, `zodResolver` sur
// le schéma que l'API relit). Reçoit le ticket par props, jamais une fonction (`portage-ecrans.md § 2`).
// Le motif et le refus sont ceux du design system (`Field`, `Textarea`, `Alert`, E05-S09 partie d2) ; les
// boutons sont des `Button` du DS à la taille de ceux d'`ActionPlateforme`, leurs voisins dans la même cellule.
import { useEffect, useRef, useState, type KeyboardEvent } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { feedbackStateChangeSchema, type FeedbackStateChange, type FeedbackStateChangeInput } from "../../../schemas"
import { appelerPlateforme } from "../../api/client"
import { messageDErreur } from "../../api/messages"
import { replierLeFocusSur } from "../../components/focus"
import { Field } from "../../ds/react/forms"
import { Alert, Button } from "../../ds/react/primitives"
import { Textarea } from "../../ds/react/textarea"
import { useRafraichir } from "../../hote/rafraichir"
import { MESSAGES_DU_RETOUR, MOTIF_TROP_COURT, MOTIF_TROP_LONG } from "./libelles"

type RefusDuRetourProps = {
  /** « FB-0012 ». */
  ticket: string
  /** Le titre de la liste, qui reçoit le focus quand le succès emporte le geste. */
  ancre: string
}

export function RefusDuRetour({ ticket, ancre }: RefusDuRetourProps) {
  const rafraichir = useRafraichir()
  const [ouvert, setOuvert] = useState(false)
  const racine = useRef<HTMLDivElement>(null)
  const depart = useRef<HTMLButtonElement>(null)
  const rendreLeFocus = useRef(false)
  const form = useForm<FeedbackStateChangeInput, unknown, FeedbackStateChange>({
    resolver: zodResolver(feedbackStateChangeSchema),
    defaultValues: { state: "declined", resolution: "" },
  })
  const { setFocus } = form
  const { errors, isSubmitting } = form.formState
  // Le message de Zod (anglais) ne s'affiche pas : la saisie a sa phrase, le refus du serveur la sienne.
  const erreurDuMotif = errors.resolution ? (errors.resolution.type === "too_big" ? MOTIF_TROP_LONG : MOTIF_TROP_COURT) : undefined

  useEffect(() => {
    if (ouvert) setFocus("resolution")
    if (!ouvert && rendreLeFocus.current) {
      rendreLeFocus.current = false
      depart.current?.focus()
    }
  }, [ouvert, setFocus])

  function annuler() {
    form.reset()
    rendreLeFocus.current = true
    setOuvert(false)
  }

  function surLeFormulaire(evenement: KeyboardEvent<HTMLFormElement>) {
    if (evenement.key !== "Escape" || isSubmitting) return
    evenement.preventDefault()
    annuler()
  }

  async function envoyer(changement: FeedbackStateChange) {
    const reponse = await appelerPlateforme<unknown>({ methode: "PATCH", ressource: `feedback/${ticket}`, corps: changement })
    if (reponse.erreur) {
      form.setError("root", { type: "server", message: messageDErreur(reponse.erreur, MESSAGES_DU_RETOUR) })
      return
    }
    // Le ticket décliné perd ce geste à la relecture : le focus l'attend à l'ancre de la liste.
    replierLeFocusSur(ancre, racine.current)
    rafraichir()
  }

  return (
    <div ref={racine} className="space-y-1">
      {!ouvert ? (
        <Button ref={depart} type="button" variant="secondary" size="sm" aria-label={`Décliner ${ticket}`} onClick={() => setOuvert(true)}>
          Décliner
        </Button>
      ) : (
        <form
          noValidate
          aria-label={`Décliner ${ticket}`}
          onKeyDown={surLeFormulaire}
          onSubmit={(evenement) => void form.handleSubmit(envoyer)(evenement)}
          className="space-y-2"
        >
          <Field label="Motif (lu par la personne qui a signalé)" error={erreurDuMotif}>
            <Textarea required maxLength={2000} rows={3} {...form.register("resolution")} />
          </Field>
          {errors.root?.message && <Alert tone="fail" title={errors.root.message} />}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" size="sm" disabled={isSubmitting} onClick={annuler}>
              Annuler
            </Button>
            <Button type="submit" variant="primary" size="sm" disabled={isSubmitting} aria-busy={isSubmitting || undefined}>
              Confirmer le refus
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}
