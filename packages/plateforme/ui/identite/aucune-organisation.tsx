// « Aucune organisation » : la personne est connectée, mais pas membre de l'organisation de
// l'adresse, ou l'adresse n'en désigne aucune (H13, AC27). Server Component : l'action de
// déconnexion de l'hôte arrive en prop et ne traverse aucune frontière client.
//
// Absent d'oto-frontend (organisation personnelle par construction). Repris de ses écrans
// d'identifiants (`src/components/auth/auth-page.tsx`) : l'îlot (`IlotDAuthentification`) sous
// `EcranDAuthentification`, que la page de l'hôte pose ; un titre qui situe, un seul geste, en pied,
// le bouton principal du design system, pleine largeur ; l'échec dans un `Alert`. Retiré : Logto.

import type { ReactNode } from "react"
import { IlotDAuthentification } from "../authentification/ilot-d-authentification"
import { LIEN } from "../components/classes"
import { Alert, Button } from "../ds/react/primitives"
import { Skeleton } from "../ds/react/skeleton"

type ContactDOrganisation = { nom: string; email: string }

type DonneesAucuneOrganisation = {
  /** Email du compte connecté. */
  email: string
  /** Hôte de la requête : c'est lui, et aucun paramètre d'URL, qui décide de l'état (N12). */
  hote: string | null
  /** L'organisation de l'adresse et son contact ; `null` quand l'adresse n'en désigne aucune. */
  organisation: { nom: string; contact: ContactDOrganisation | null } | null
  /**
   * Les organisations dont la personne est membre, chacune avec l'adresse où entrer (1.4.12) ; lues par l'hôte quand
   * l'adresse n'en désigne aucune (l'adresse commune d'un hôte). Absentes ou vides : le texte d'avant.
   */
  organisations?: { nom: string; adresse: string }[]
}

/** Même forme que le retour des actions (`ActionResult`) : des données ou un message. */
export type ResultatAucuneOrganisation =
  | { data: DonneesAucuneOrganisation; error?: never }
  | { data?: never; error: string }

type AucuneOrganisationProps = {
  resultat: ResultatAucuneOrganisation
  /** Server Action de l'hôte, posée sur le formulaire « Se déconnecter ». */
  actionDeDeconnexion: (formData: FormData) => void | Promise<void>
}

/** Le titre de l'îlot et son corps, selon l'état. */
function etat(resultat: ResultatAucuneOrganisation): { titre: string; corps: ReactNode } {
  if (resultat.error !== undefined) {
    return { titre: "Aucune organisation", corps: <Alert tone="fail">{resultat.error}</Alert> }
  }

  const { email, hote, organisation, organisations = [] } = resultat.data
  const connexion = <p className="oto-caption">Connecté·e avec {email}.</p>
  if (organisation === null && organisations.length > 0) {
    return {
      titre: organisations.length === 1 ? "Votre organisation" : "Vos organisations",
      corps: (
        <>
          <p>L&apos;adresse {hote ?? "demandée"} est commune à toutes les organisations : chacune a la sienne, où entrer.</p>
          <ul className="flex flex-col gap-1">
            {organisations.map((une) => (
              <li key={une.adresse}>
                <a href={une.adresse} className={LIEN}>
                  {une.nom}
                </a>{" "}
                <span className="oto-caption">{new URL(une.adresse).host}</span>
              </li>
            ))}
          </ul>
          {connexion}
        </>
      ),
    }
  }
  if (organisation === null) {
    return {
      titre: "Adresse inconnue",
      corps: (
        <>
          <p>
            L&apos;adresse {hote ?? "demandée"} ne correspond à aucune organisation. Vérifiez l&apos;adresse reçue
            dans votre invitation.
          </p>
          {connexion}
        </>
      ),
    }
  }

  const { nom, contact } = organisation
  return {
    titre: `Vous n'êtes pas membre de ${nom}`,
    corps: (
      <>
        <p>
          {contact
            ? `Pour y entrer, demandez à ${contact.nom} (${contact.email}) de vous inviter.`
            : `Demandez à un administrateur de ${nom} de vous inviter.`}
        </p>
        <p>Si vous avez reçu une invitation, ouvrez le lien de son email.</p>
        {connexion}
      </>
    ),
  }
}

export function AucuneOrganisation({ resultat, actionDeDeconnexion }: AucuneOrganisationProps) {
  const { titre, corps } = etat(resultat)
  return (
    <IlotDAuthentification
      titre={titre}
      pied={
        <form action={actionDeDeconnexion}>
          <Button type="submit" variant="primary" block>
            Se déconnecter
          </Button>
        </form>
      }
    >
      <div className="flex flex-col gap-3">{corps}</div>
    </IlotDAuthentification>
  )
}

/** L'état de chargement, à passer en `fallback` du `<Suspense>` qui attend le résultat. */
export function AucuneOrganisationChargement() {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-3">
      <span className="oto-sr-only">Vérification de votre organisation…</span>
      <Skeleton width="66%" />
      <Skeleton />
      <Skeleton width="50%" />
    </div>
  )
}
