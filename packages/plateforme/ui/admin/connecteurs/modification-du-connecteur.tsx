"use client"

// « Modifier le nom » dans le détail d'un connecteur, pour qui le gère : son nom et sa description, envoyés à
// `PATCH /api/platform/admin/accounts/<id>` sur le schéma de l'API (`accountChangeSchema`). Aucun alias n'est gardé :
// l'écran le dit avant de valider. Un nom déjà porté par le même propriétaire se dit sous le champ. Après un succès,
// la saisie se replie et la page se relit.
import { useRef, useState } from "react"
import { useForm } from "react-hook-form"
import { ACCOUNT_DESCRIPTION_MAX, accountChangeSchema, type AccountChange } from "../../../schemas"
import { appelerPlateforme } from "../../api/client"
import { Field, Input } from "../../ds/react/forms"
import { Alert, Button } from "../../ds/react/primitives"
import { Textarea } from "../../ds/react/textarea"
import { useRafraichir } from "../../hote/rafraichir"
import { estNomPris, NOM_PRIS, refusDuConnecteur } from "./refus-des-connecteurs"

type Compte = { id: string; label: string; description: string | null }
type Saisie = { label: string; description: string }

const NOM_INVALIDE = "Le nom est vide ou trop long."

/** Ce qui a changé, tel que la route l'attend ; `null` : rien à envoyer. Une description vidée l'efface. */
function changement(saisie: Saisie, compte: Compte): AccountChange | null {
  const label = saisie.label.trim()
  const description = saisie.description.trim() || null
  const corps: AccountChange = { ...(label !== compte.label ? { label } : {}), ...(description !== compte.description ? { description } : {}) }
  return Object.keys(corps).length > 0 ? corps : null
}

function Formulaire({ compte, fermer }: { compte: Compte; fermer: (annonce: string) => void }) {
  const rafraichir = useRafraichir()
  const form = useForm<Saisie>({ mode: "onBlur", values: { label: compte.label, description: compte.description ?? "" } })
  const { errors, isSubmitting } = form.formState

  async function enregistrer(saisie: Saisie) {
    const corps = changement(saisie, compte)
    if (!corps) return fermer("")
    if (!accountChangeSchema.safeParse(corps).success) {
      form.setError("label", { type: "client", message: NOM_INVALIDE }, { shouldFocus: true })
      return
    }
    const reponse = await appelerPlateforme({ methode: "PATCH", ressource: `admin/accounts/${encodeURIComponent(compte.id)}`, corps })
    if (reponse.erreur) {
      if (estNomPris(reponse.erreur)) form.setError("label", { type: "server", message: NOM_PRIS }, { shouldFocus: true })
      else form.setError("root", { type: "server", message: refusDuConnecteur(reponse.erreur) })
      return
    }
    fermer("Nom et description enregistrés.")
    rafraichir()
  }

  return (
    <form noValidate aria-label={`Nom et description de ${compte.label}`} onSubmit={(evenement) => void form.handleSubmit(enregistrer)(evenement)} className="flex w-full flex-col gap-3">
      <Field label="Nom" error={errors.label?.message} hint="L'ancien nom ne sera plus reconnu par votre assistant.">
        <Input type="text" {...form.register("label")} />
      </Field>
      <Field label="Description (facultatif)" hint="Ce à quoi sert ce connecteur : votre assistant la lit pour choisir le bon.">
        <Textarea maxLength={ACCOUNT_DESCRIPTION_MAX} {...form.register("description")} />
      </Field>
      {errors.root?.message && <Alert tone="fail" title={errors.root.message} />}
      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" disabled={isSubmitting} aria-busy={isSubmitting}>
          {isSubmitting ? "Enregistrement…" : "Enregistrer"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => fermer("")}>
          Annuler
        </Button>
      </div>
    </form>
  )
}

/** Le bouton qui ouvre la saisie, puis la saisie ; l'annonce d'un succès reste à côté du bouton. */
export function ModificationDuConnecteur({ compte }: { compte: Compte }) {
  const [ouvert, setOuvert] = useState(false)
  const [annonce, setAnnonce] = useState("")
  const bouton = useRef<HTMLButtonElement>(null)
  const fermer = (texte: string) => {
    setAnnonce(texte)
    setOuvert(false)
    // La saisie part avec le focus qu'elle portait : il revient au bouton qui l'a ouverte.
    bouton.current?.focus()
  }
  return (
    <div className="flex w-full flex-col gap-3">
      <div className="flex items-center gap-3">
        <Button ref={bouton} type="button" variant="ghost" size="sm" aria-expanded={ouvert} onClick={() => setOuvert(!ouvert)}>
          Modifier le nom
          <span className="oto-sr-only">{` de ${compte.label}`}</span>
        </Button>
        {/* Montée d'emblée, vide : une région montée avec son message n'est pas annoncée. */}
        <p role="status" className="oto-caption">
          {annonce}
        </p>
      </div>
      {ouvert && <Formulaire compte={compte} fermer={fermer} />}
    </div>
  )
}
