"use client"

// « Créer un compte » (E08-S03, AC6 ; comptes à plusieurs champs) : un compte de l'organisation ou d'une équipe,
// pour un connecteur activable, actif ou non (un compte se prépare avant l'activation, E04-S01), envoyé à
// `POST /api/platform/admin/accounts` sur le schéma de l'API (`createAccountSchema`). Simulé pour un connecteur
// simulé ; réel pour un connecteur que l'hôte déclare, dont le formulaire (`ConnectorAccountForm`) ajoute les champs du
// secret et les réglages, envoyés ensuite à `POST admin/accounts/<id>/secret`. Un compte personnel se crée par son
// propriétaire, jamais ici (N11). Après un succès, la page se relit.
//
// Absent d'oto-frontend, dont les comptes naissent d'une connexion réelle (V2) : écrit sur le modèle de
// « Créer une équipe » (`ui/equipes/creation-d-equipe.tsx`) et d'« Inviter quelqu'un » (E02-S01), puis posé
// sur les contrôles du design system (E05-S09 partie d2) : `Field`, `Select`, `Input`, `Radio` dans un
// groupe à légende, l'échec en `Alert`, le bouton primaire.
import { useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { FormProvider, useForm, useFormContext, useWatch } from "react-hook-form"
import type * as z from "zod/v4"
import { createAccountSchema, type ConnectorAccountForm } from "../../../schemas"
import { appelerPlateforme } from "../../api/client"
import { messageDErreur } from "../../api/messages"
import { Field, Input } from "../../ds/react/forms"
import { Alert, Button } from "../../ds/react/primitives"
import { Radio } from "../../ds/react/radio"
import { Select } from "../../ds/react/select"
import { useRafraichir } from "../../hote/rafraichir"
import { LIBELLE_PRIS } from "../textes"
import { chargeDeLaSaisie, ChampsDuCompte, type SaisieDesChamps } from "./champs-du-compte"

type NouveauCompte = z.input<typeof createAccountSchema> & Partial<SaisieDesChamps>
type Equipe = { id: string; name: string }

const LIBELLE_INVALIDE = "Le libellé compte de 1 à 80 caractères."
const EQUIPE_MANQUANTE = "Choisissez une équipe."

type CreationDeCompteProps = {
  /** Les connecteurs activables, actifs ou non. */
  connecteurs: string[]
  equipes: Equipe[]
  /** Les formulaires des connecteurs réels déclarés ; un connecteur sans formulaire prend des comptes simulés. */
  formulaires?: ConnectorAccountForm[]
  /** Appelé quand le compte est créé, secret posé compris : la fenêtre d'ajout s'y ferme et ouvre son détail. */
  apresCreation?: (compte: { id: string; label: string }) => void
}

/** Le connecteur du compte, parmi les connecteurs activables ; relié au formulaire par son contexte. */
function ChoixDuConnecteur({ connecteurs }: { connecteurs: readonly string[] }) {
  const { register } = useFormContext<NouveauCompte>()
  return (
    <Field label="Connecteur">
      <Select {...register("connector")}>
        {connecteurs.map((connecteur) => (
          <option key={connecteur} value={connecteur}>
            {connecteur}
          </option>
        ))}
      </Select>
    </Field>
  )
}

/** L'équipe du compte, montrée quand le propriétaire est une équipe : son choix part avec elle. */
function ChoixDeLEquipe({ equipes, erreur }: { equipes: readonly Equipe[]; erreur?: string }) {
  const { register } = useFormContext<NouveauCompte>()
  return (
    <Field label="Équipe" error={erreur}>
      <Select {...register("team_id", { shouldUnregister: true, setValueAs: (valeur: string) => valeur || undefined })}>
        <option value="">Choisir une équipe</option>
        {equipes.map((equipe) => (
          <option key={equipe.id} value={equipe.id}>
            {equipe.name}
          </option>
        ))}
      </Select>
    </Field>
  )
}

/** Le propriétaire : l'organisation, ou une équipe choisie dans la liste. */
function ChoixDuProprietaire({ equipes, erreur }: { equipes: readonly Equipe[]; erreur?: string }) {
  const { register } = useFormContext<NouveauCompte>()
  const genre = useWatch<NouveauCompte, "owner_kind">({ name: "owner_kind" })
  return (
    <>
      <fieldset className="oto-radio-group" data-orientation="horizontal">
        <legend>Propriétaire</legend>
        <Radio value="org" label="L'organisation" {...register("owner_kind")} />
        {equipes.length > 0 && <Radio value="team" label="Une équipe" {...register("owner_kind")} />}
      </fieldset>
      {genre === "team" && <ChoixDeLEquipe equipes={equipes} erreur={erreur} />}
    </>
  )
}

/** Le mode d'un compte du connecteur : réel s'il a un formulaire (déclaré par l'hôte), simulé sinon. */
const modeDe = (formulaire: ConnectorAccountForm | undefined) => (formulaire ? "reel" : "simule")

/** Le mode dit sous le formulaire, selon le connecteur choisi. */
function MentionDuMode({ reel }: { reel: boolean }) {
  return (
    <p className="oto-caption">
      {reel
        ? "Mode : réel. Le secret part chiffré au coffre et ne s'affiche plus ensuite. Un compte personnel se crée par son propriétaire, pas ici."
        : "Mode : simulé. Rien ne sort du serveur. Un compte personnel se crée par son propriétaire, pas ici."}
    </p>
  )
}

export function CreationDeCompte({ connecteurs, equipes, formulaires = [], apresCreation }: CreationDeCompteProps) {
  const rafraichir = useRafraichir()
  const [annonce, setAnnonce] = useState("")
  const formulaireDe = (connecteur: string) => formulaires.find((candidat) => candidat.connector === connecteur)
  const premier = connecteurs[0] ?? ""
  const form = useForm<NouveauCompte>({
    // `raw` : les champs du secret et les réglages, hors du schéma de création, restent dans la saisie rendue.
    resolver: zodResolver(createAccountSchema, undefined, { raw: true }),
    mode: "onBlur",
    defaultValues: { connector: premier, owner_kind: "org", label: "", mode: modeDe(formulaireDe(premier)) },
  })
  const { errors, isSubmitting } = form.formState
  const choisi = useWatch({ control: form.control, name: "connector" })
  const formulaire = formulaireDe(choisi)
  // Le message de Zod (anglais) ne s'affiche pas : une saisie refusée a sa phrase, le libellé pris la sienne.
  const erreurDuLibelle = errors.label ? (errors.label.type === "server" ? errors.label.message : LIBELLE_INVALIDE) : undefined

  async function creer({ secret, effacer, settings, ...compte }: NouveauCompte) {
    setAnnonce("")
    const corps = { ...compte, mode: modeDe(formulaire) }
    const reponse = await appelerPlateforme<{ account: { id: string; label: string } }>({ methode: "POST", ressource: "admin/accounts", corps })
    if (reponse.erreur) {
      if (reponse.erreur.code === "conflict") form.setError("label", { type: "server", message: LIBELLE_PRIS }, { shouldFocus: true })
      else form.setError("root", { type: "server", message: messageDErreur(reponse.erreur) })
      return
    }
    const { id, label } = reponse.data.account
    const charge = formulaire ? chargeDeLaSaisie({ secret: secret ?? {}, effacer: effacer ?? {}, settings: settings ?? {} }, formulaire) : null
    if (charge) {
      const pose = await appelerPlateforme({ methode: "POST", ressource: `admin/accounts/${encodeURIComponent(id)}/secret`, corps: charge })
      if (pose.erreur) {
        form.setError("root", { type: "server", message: `Compte « ${label} » créé, mais son secret n'est pas posé : ${messageDErreur(pose.erreur)} Saisissez-le sur sa ligne.` })
        rafraichir()
        return
      }
    }
    setAnnonce(`Compte « ${label} » créé.`)
    form.reset()
    rafraichir()
    apresCreation?.({ id, label })
  }

  return (
    <FormProvider {...form}>
      <form noValidate aria-label="Créer un compte" onSubmit={(evenement) => void form.handleSubmit(creer)(evenement)} className="flex flex-col gap-3">
        <ChoixDuConnecteur connecteurs={connecteurs} />
        <Field label="Libellé" error={erreurDuLibelle}>
          <Input type="text" {...form.register("label")} />
        </Field>
        <ChoixDuProprietaire equipes={equipes} erreur={errors.team_id ? EQUIPE_MANQUANTE : undefined} />
        {formulaire && <ChampsDuCompte key={formulaire.connector} formulaire={formulaire} />}
        <MentionDuMode reel={formulaire !== undefined} />
        {errors.root?.message && <Alert tone="fail" title={errors.root.message} />}
        <div className="flex items-center gap-3">
          <Button type="submit" variant="primary" disabled={isSubmitting} aria-busy={isSubmitting}>
            {isSubmitting ? "Création…" : "Créer le compte"}
          </Button>
          {/* Montée d'emblée, vide, à côté du bouton : une région montée avec son message n'est pas annoncée. */}
          <p role="status" className="oto-caption">
            {annonce}
          </p>
        </div>
      </form>
    </FormProvider>
  )
}
