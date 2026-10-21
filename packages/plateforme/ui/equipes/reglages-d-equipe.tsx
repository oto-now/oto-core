"use client"

// Renommer une équipe (E05-S03, AC12 ; porté par E05-S09 partie d1) : un dialogue ouvert depuis le « ⋯ » de sa
// ligne, un champ, envoyé à `PATCH /api/platform/teams/<id>` après le schéma partagé avec l'API
// (`updateTeamSchema`) ; un nom inchangé ne part pas. Porté d'oto-frontend (`teams-columns.tsx`, « Renommer »
// du menu d'une équipe, et ses refus : nom déjà pris, refus) ; changé : un dialogue à un champ plutôt que
// `TitleField` en place, qui ne laissait pas de fente sous le champ pour le refus. Le formulaire suit l'équipe
// servie (`values`), et garde la saisie refusée, à corriger sous le champ (portage-ecrans.md § 2). E05-S13
// (AC-24) : le responsable ne se règle plus ici ; les responsables se nomment dans « Les personnes de … ». Le rail
// l'ouvre aussi depuis le « ⋯ » d'une équipe (1.4.13), sans le nom de l'organisation, et en annonce le succès.
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { updateTeamSchema, type TeamView, type UpdateTeam } from "../../schemas"
import { appelerPlateforme } from "../api/client"
import { messageDErreur } from "../api/messages"
import { Dialog } from "../ds/react/dialog"
import { Field, Input } from "../ds/react/forms"
import { Button } from "../ds/react/primitives"
import { useRafraichir } from "../hote/rafraichir"
import { NOM_D_EQUIPE_INVALIDE, refusDuNom, surLeNom } from "./libelles"

type ReglagesDEquipeProps = {
  equipe: Pick<TeamView, "id" | "name">
  /** Le nom de l'organisation, dans le refus d'un nom pris ; absent (le rail), la phrase s'en passe. */
  nomOrganisation?: string
  onFermer: () => void
  /** Après un renommage réussi, le nouveau nom : le rail l'annonce. */
  apresLeRenommage?: (nom: string) => void
}

export function ReglagesDEquipe({ equipe, nomOrganisation, onFermer, apresLeRenommage }: ReglagesDEquipeProps) {
  const rafraichir = useRafraichir()
  const form = useForm<UpdateTeam>({ resolver: zodResolver(updateTeamSchema), mode: "onBlur", values: { name: equipe.name } })
  const { errors, isSubmitting } = form.formState
  // Le message de Zod (anglais) ne s'affiche pas : une saisie refusée a sa phrase, un refus du serveur la sienne.
  const erreurDuNom = errors.name ? (errors.name.type === "server" ? errors.name.message : NOM_D_EQUIPE_INVALIDE) : undefined

  async function enregistrer({ name }: UpdateTeam) {
    if (name === undefined || name === equipe.name) {
      onFermer()
      return
    }
    const reponse = await appelerPlateforme({ methode: "PATCH", ressource: `teams/${equipe.id}`, corps: { name } })
    if (reponse.erreur) {
      const message = messageDErreur(reponse.erreur, refusDuNom(nomOrganisation))
      if (surLeNom(reponse.erreur)) form.setError("name", { type: "server", message }, { shouldFocus: true })
      else form.setError("root", { type: "server", message })
      return
    }
    onFermer()
    apresLeRenommage?.(name)
    rafraichir()
  }

  return (
    <Dialog open onClose={onFermer} title={`Renommer ${equipe.name}`} size="sm">
      <form noValidate onSubmit={(evenement) => void form.handleSubmit(enregistrer)(evenement)} className="flex flex-col gap-3">
        <Field label="Nom de l'équipe" error={erreurDuNom}>
          <Input type="text" autoComplete="off" {...form.register("name")} />
        </Field>
        {errors.root?.message && <p role="alert">{errors.root.message}</p>}
        <Button type="submit" variant="primary" disabled={isSubmitting} aria-busy={isSubmitting}>
          {isSubmitting ? "Enregistrement…" : "Enregistrer"}
        </Button>
      </form>
    </Dialog>
  )
}
