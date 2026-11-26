"use client"

// La clé et les réglages d'un compte réel (comptes à plusieurs champs) : le formulaire tiré de la déclaration de son
// connecteur, replié dans la bande d'état du détail du compte, sous « Saisir la clé » ou « Remplacer la clé » posé à côté
// de « Tester », envoyé à
// `POST /api/platform/admin/accounts/<id>/secret`. Le secret ne
// revient jamais : un champ posé le dit, laissé vide il est gardé, coché « Effacer » il est effacé ; un réglage vidé
// est effacé. La validation est celle de l'API (`accountSecretInputSchema`), le refus du service dit le champ en
// cause. Après un succès, la saisie se vide et la page se relit. La page de connexion d'un connecteur reprend le même
// formulaire (`FormulaireDeLaCle`) pour la clé d'un compte que le tiers a refusée ou qui n'en a jamais eu.
import { useRef, useState, type ReactNode } from "react"
import { Key } from "@phosphor-icons/react/dist/csr/Key"
import { FormProvider, useForm } from "react-hook-form"
import { accountSecretInputSchema, type AccountView, type ConnectorAccountForm } from "../../../schemas"
import { appelerPlateforme } from "../../api/client"
import { messageDErreur } from "../../api/messages"
import { Icon } from "../../ds/react/icon"
import { Alert, Button } from "../../ds/react/primitives"
import { useRafraichir } from "../../hote/rafraichir"
import { chargeDeLaSaisie, ChampsDuCompte, saisieDeDepart, type SaisieDesChamps } from "./champs-du-compte"

const RIEN_A_ENREGISTRER = "Rien à enregistrer : saisissez un champ, cochez « Effacer » ou changez un réglage."

type SaisieProps = { compte: AccountView; formulaire: ConnectorAccountForm }

type FormulaireDeLaCleProps = SaisieProps & {
  /** Après l'enregistrement, avec l'annonce du succès. */
  enregistre: (annonce: string) => void
  /** « Annuler ». */
  annule: () => void
}

/** Le formulaire de la clé et des réglages d'un compte, envoyé à `POST admin/accounts/<id>/secret`. */
export function FormulaireDeLaCle({ compte, formulaire, enregistre, annule }: FormulaireDeLaCleProps) {
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
    enregistre(`Clé et réglages de « ${compte.label} » enregistrés.`)
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
          <Button type="button" variant="ghost" onClick={annule}>
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
  /** L'état du compte, déjà rendu : il tient la gauche de la rangée. */
  etat: ReactNode
  /** Les gestes qui suivent le bouton dans la rangée (« Tester »), déjà rendus. */
  gestes?: ReactNode
}

/**
 * La rangée de la bande d'état (l'état, puis le bouton et les gestes qui le suivent, l'annonce d'un succès à côté), puis
 * la saisie, ouverte sous la rangée.
 */
export function SaisieDuCompte({ compte, formulaire, libelle, ouverte, etat, gestes }: SaisieDuCompteProps) {
  const rafraichir = useRafraichir()
  const [ouvert, setOuvert] = useState(ouverte)
  const [annonce, setAnnonce] = useState("")
  const bouton = useRef<HTMLButtonElement>(null)
  const fermer = (texte: string) => {
    setAnnonce(texte)
    setOuvert(false)
    // La saisie part avec le focus qu'elle portait : il revient au bouton qui l'a ouverte.
    bouton.current?.focus()
  }
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {etat}
        <div className="flex flex-wrap items-start gap-2">
          {/* Montée d'emblée, vide : une région montée avec son message n'est pas annoncée. */}
          <p role="status" className="oto-caption">
            {annonce}
          </p>
          <Button ref={bouton} type="button" variant="secondary" iconStart={<Icon as={Key} size="xs" />} aria-expanded={ouvert} onClick={() => setOuvert(!ouvert)}>
            {libelle}
            <span className="oto-sr-only">{` de ${compte.label}`}</span>
          </Button>
          {gestes}
        </div>
      </div>
      {ouvert && (
        <FormulaireDeLaCle
          compte={compte}
          formulaire={formulaire}
          enregistre={(texte) => {
            fermer(texte)
            rafraichir()
          }}
          annule={() => fermer("")}
        />
      )}
    </>
  )
}
