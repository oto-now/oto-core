"use client"

// La clé et les réglages d'un compte réel (comptes à plusieurs champs) : le formulaire tiré de la déclaration de son
// connecteur, replié dans le détail du compte sous « Saisir la clé » ou « Remplacer la clé », envoyé à
// `POST /api/platform/admin/accounts/<id>/secret`. Le secret ne
// revient jamais : un champ posé le dit, laissé vide il est gardé, coché « Effacer » il est effacé ; un réglage vidé
// est effacé. La validation est celle de l'API (`accountSecretInputSchema`), le refus du service dit le champ en
// cause. Après un succès, la saisie se vide et la page se relit.
import { useState } from "react"
import { FormProvider, useForm } from "react-hook-form"
import { accountSecretInputSchema, type AccountView, type ConnectorAccountForm } from "../../../schemas"
import { appelerPlateforme } from "../../api/client"
import { messageDErreur } from "../../api/messages"
import { Alert, Button } from "../../ds/react/primitives"
import { useRafraichir } from "../../hote/rafraichir"
import { chargeDeLaSaisie, ChampsDuCompte, saisieDeDepart, type SaisieDesChamps } from "./champs-du-compte"

const RIEN_A_ENREGISTRER = "Rien à enregistrer : saisissez un champ, cochez « Effacer » ou changez un réglage."

type SaisieProps = { compte: AccountView; formulaire: ConnectorAccountForm }

function Formulaire({ compte, formulaire, fermer }: SaisieProps & { fermer: (annonce: string) => void }) {
  const rafraichir = useRafraichir()
  const form = useForm<SaisieDesChamps>({ mode: "onBlur", values: saisieDeDepart(formulaire, compte) })
  const { errors, isSubmitting } = form.formState

  async function enregistrer(saisie: SaisieDesChamps) {
    const charge = chargeDeLaSaisie(saisie, formulaire, compte)
    if (!charge || !accountSecretInputSchema.safeParse(charge).success) {
      form.setError("root", { type: "client", message: charge ? "Une valeur est trop longue." : RIEN_A_ENREGISTRER })
      return
    }
    const reponse = await appelerPlateforme({ methode: "POST", ressource: `admin/accounts/${encodeURIComponent(compte.id)}/secret`, corps: charge })
    if (reponse.erreur) {
      form.setError("root", { type: "server", message: messageDErreur(reponse.erreur) })
      return
    }
    fermer(`Clé et réglages de « ${compte.label} » enregistrés.`)
    rafraichir()
  }

  return (
    <FormProvider {...form}>
      <form noValidate aria-label={`Clé et réglages de ${compte.label}`} onSubmit={(evenement) => void form.handleSubmit(enregistrer)(evenement)} className="flex w-full flex-col gap-3">
        <ChampsDuCompte formulaire={formulaire} compte={compte} />
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
    </FormProvider>
  )
}

type SaisieDuCompteProps = SaisieProps & {
  /** Le mot du bouton : « Saisir la clé » tant qu'aucune n'est posée, « Remplacer la clé » ensuite. */
  libelle: string
  /** Vrai quand l'état du compte attend la clé : la saisie s'offre ouverte. */
  ouverte: boolean
}

/** Le bouton qui ouvre la saisie, puis la saisie ; l'annonce d'un succès reste à côté du bouton. */
export function SaisieDuCompte({ compte, formulaire, libelle, ouverte }: SaisieDuCompteProps) {
  const [ouvert, setOuvert] = useState(ouverte)
  const [annonce, setAnnonce] = useState("")
  const fermer = (texte: string) => {
    setAnnonce(texte)
    setOuvert(false)
  }
  return (
    <div className="flex w-full flex-col gap-3">
      <div className="flex items-center gap-3">
        <Button type="button" variant="secondary" aria-expanded={ouvert} onClick={() => setOuvert(!ouvert)}>
          {libelle}
          <span className="oto-sr-only">{` de ${compte.label}`}</span>
        </Button>
        {/* Montée d'emblée, vide : une région montée avec son message n'est pas annoncée. */}
        <p role="status" className="oto-caption">
          {annonce}
        </p>
      </div>
      {ouvert && <Formulaire compte={compte} formulaire={formulaire} fermer={fermer} />}
    </div>
  )
}
