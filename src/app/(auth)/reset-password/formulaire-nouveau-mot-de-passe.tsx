"use client"

import * as React from "react"
import { unstable_rethrow } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Alert, Button, Field, IlotDAuthentification, Input } from "@otomata_tech/oto_platform/ui"
import { resetPasswordAction } from "@/lib/actions/auth"
import { resetPasswordSchema, type ResetPasswordData } from "@/lib/schemas/auth"
import { SERVEUR_INJOIGNABLE } from "@/app/(auth)/messages"

// Le formulaire de `/reset-password` (M01) : la page, Server Component, lit la marque de l'adresse et
// exporte son titre. Porté d'oto-frontend (`src/components/auth/password-reset-form.tsx`, avant le
// retrait de sa démonstration) : React Hook Form sur le schéma de l'action (l'égalité des deux saisies est
// son `refine`), « Nouveau mot de passe » et « Confirmer le mot de passe », leurs erreurs sous le champ,
// l'échec dans un `Alert`, « Enregistrer le mot de passe » au pied relié par `form`, « Enregistrement… »
// pendant l'envoi. Changé : le succès redirige (l'action), sans message ; le lien de l'email a déjà posé
// la session, l'action renvoie à la connexion sans elle. Retiré : le jeton de l'adresse et l'état « lien
// plus valable » (la session en tient lieu), l'indication de longueur (la borne vit dans le schéma de
// l'hôte, que son message d'erreur dit), TanStack Query.
//
// Aussi l'îlot « Choisir un mot de passe » de l'accueil d'une invitation (`/welcome`, 2026-10-20) : son titre, et la page
// où revenir (`retour`, le champ `next` que suit l'action), une phrase avant les champs (`intro`) et d'autres façons
// d'entrer au pied (`complement` : les fournisseurs).

const FORMULAIRE = "nouveau-mot-de-passe"

type FormulaireNouveauMotDePasseProps = {
  /** Le titre de l'îlot ; « Choisir un nouveau mot de passe » par défaut (réinitialisation). */
  titre?: string
  /** La page où l'action ramène après l'enregistrement ; `/` sans elle. */
  retour?: string
  /** Une phrase avant les champs. */
  intro?: React.ReactNode
  /** Sous le bouton, au pied de l'îlot : d'autres façons d'entrer. */
  complement?: React.ReactNode
}

export function FormulaireNouveauMotDePasse({ titre = "Choisir un nouveau mot de passe", retour, intro, complement }: FormulaireNouveauMotDePasseProps = {}) {
  const [erreur, setErreur] = React.useState<string | null>(null)
  const form = useForm<ResetPasswordData>({
    resolver: zodResolver(resetPasswordSchema),
    mode: "onBlur",
    defaultValues: { password: "", confirmPassword: "" },
  })
  const { errors, isSubmitting } = form.formState

  // L'appel de l'action peut échouer (réseau, déploiement remplacé) : le bouton se libère et l'échec se
  // dit. Un succès redirige : Next 15 rejette alors l'appel avec la redirection, que `unstable_rethrow`
  // relance pour qu'elle soit suivie (`api-patterns.md § Type de retour standard`).
  const enregistrer = form.handleSubmit(async ({ password, confirmPassword }) => {
    const donnees = new FormData()
    donnees.set("password", password)
    donnees.set("confirmPassword", confirmPassword)
    if (retour) donnees.set("next", retour)
    try {
      const resultat = await resetPasswordAction(donnees)
      if (resultat?.error) setErreur(resultat.error)
    } catch (rejet) {
      unstable_rethrow(rejet)
      setErreur(SERVEUR_INJOIGNABLE)
    }
  })

  // Chaque envoi efface l'échec d'avant, champs refusés compris : il ne se lit plus sous une autre erreur.
  function envoyer(evenement: React.FormEvent<HTMLFormElement>) {
    setErreur(null)
    void enregistrer(evenement)
  }

  return (
    <IlotDAuthentification
      titre={titre}
      pied={
        <>
          <Button type="submit" form={FORMULAIRE} variant="primary" block disabled={isSubmitting} aria-busy={isSubmitting}>
            {isSubmitting ? "Enregistrement…" : "Enregistrer le mot de passe"}
          </Button>
          {complement}
        </>
      }
    >
      <form id={FORMULAIRE} className="flex flex-col gap-3" noValidate onSubmit={envoyer}>
        {intro}
        {erreur && (
          <Alert tone="fail" title="Le mot de passe n'a pas été enregistré">
            {erreur}
          </Alert>
        )}
        <Field label="Nouveau mot de passe" error={errors.password?.message}>
          <Input type="password" autoComplete="new-password" autoFocus {...form.register("password")} />
        </Field>
        <Field label="Confirmer le mot de passe" error={errors.confirmPassword?.message}>
          <Input type="password" autoComplete="new-password" {...form.register("confirmPassword")} />
        </Field>
      </form>
    </IlotDAuthentification>
  )
}
