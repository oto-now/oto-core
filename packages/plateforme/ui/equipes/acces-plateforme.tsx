// L'onglet « Accès plateforme » (E05-S03, AC18 ; fiches D2 et D17) : les accès de l'équipe plateforme
// à l'organisation, datés, révocables par l'administrateur ; à côté, les membres ajoutés par le
// staff, qu'une révocation ne retire pas. Server Component, réutilisable par l'écran d'administration des accès
// (E08-S03) ; la révocation est un geste confirmé.
//
// Absent d'oto-frontend, qui n'a pas de rôle plateforme : écrit d'après H73 et la fiche D2, une ligne
// datée par accès, accordé comme révoqué ; depuis E05-S09 (partie d1), sur les classes du design system
// porté (tableau, badge d'état, lecture en échec), comme les onglets voisins.
import type { PlatformAccessOverview, PlatformAccessView, StaffAddedMemberView } from "../../schemas"
import type { Resultat } from "../api/resultat"
import type { LienDeLHote } from "../arbre/navigateur-d-arbre"
import { ActionPlateforme } from "../components/action-plateforme"
import { Badge } from "../ds/react/primitives"
import { dateLisible } from "../format/dates"
import { ErreurDeLecture } from "../components/erreur-de-lecture"
import { motifDAcces } from "./libelles"
import { TableauFixe } from "./tableau-fixe"

/** Le titre du tableau, qui reçoit le focus quand « Révoquer l'accès » part avec la relecture. */
const ANCRE_DES_ACCES = "acces-plateforme"
const TITRE_DES_AJOUTS = "acces-plateforme-ajouts"

type AccesPlateformeProps = {
  resultat: Resultat<PlatformAccessOverview>
  nomOrganisation: string
  /** Pour « Réessayer » : le lien de l'hôte et l'adresse de l'écran. */
  Lien: LienDeLHote
  ici: string
}

/** Qui porte l'accès : son nom, ou « Membre de l'équipe plateforme » s'il n'est plus lisible. */
function porteur(acces: PlatformAccessView): string {
  return acces.name ?? "Membre de l'équipe plateforme"
}

function par(nom: string | null): string {
  return nom ?? "un membre de l'équipe plateforme"
}

function cellulesDAcces(acces: PlatformAccessView, nomOrganisation: string) {
  const motif = motifDAcces(acces.reason)
  return [
    <span key="personne" className="flex flex-col">
      <span>{porteur(acces)}</span>
      {acces.email && <span className="oto-caption">{acces.email}</span>}
    </span>,
    <span key="accord" className="flex flex-col">
      <span>{`accordé le ${dateLisible(acces.grantedAt) ?? "?"} par ${par(acces.grantedByName)}`}</span>
      {motif && <span className="oto-caption">{`Motif : ${motif}`}</span>}
    </span>,
    acces.revokedAt ? `Révoqué le ${dateLisible(acces.revokedAt) ?? "?"} par ${par(acces.revokedByName)}` : <Badge tone="ok">En cours</Badge>,
    acces.revokedAt ? null : (
      <ActionPlateforme
        libelle="Révoquer l'accès"
        nomAccessible={`Révoquer l'accès (${porteur(acces)})`}
        requete={{ methode: "POST", ressource: `platform-access/${acces.id}/revoke`, corps: {} }}
        confirmation={{
          question: `Révoquer l'accès de ${porteur(acces)} à ${nomOrganisation} ? Il ne pourra plus agir sur ${nomOrganisation}.`,
          libelleConfirmer: "Révoquer l'accès",
        }}
        ancre={ANCRE_DES_ACCES}
        taille="sm"
      />
    ),
  ]
}

function ajout(membre: StaffAddedMemberView): string {
  if (membre.via === "staff") return "membre de l'équipe plateforme"
  const quand = membre.joinedAt ? ` le ${dateLisible(membre.joinedAt) ?? "?"}` : ""
  return `invité par ${par(membre.invitedByName)}${quand}`
}

/** Fiche D17, option A : ce que révoquer un accès ne retire pas. */
function AjoutesParLeStaff({ membres, nomOrganisation }: { membres: StaffAddedMemberView[]; nomOrganisation: string }) {
  return (
    <section aria-labelledby={TITRE_DES_AJOUTS} className="flex flex-col gap-2">
      <h2 id={TITRE_DES_AJOUTS} className="oto-label">
        Membres ajoutés par l&apos;équipe plateforme
      </h2>
      <p className="oto-caption">{`Révoquer un accès ne retire pas ces personnes de ${nomOrganisation} : retirez-les depuis l'onglet Membres.`}</p>
      {membres.length === 0 ? (
        <p>{`Aucun membre de ${nomOrganisation} n'a été ajouté par l'équipe plateforme.`}</p>
      ) : (
        <ul className="oto-row-list" data-rules="">
          {membres.map((membre) => (
            <li key={membre.userId} className="oto-row">{`${membre.name} (${membre.email}) : ${ajout(membre)}`}</li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function AccesPlateforme({ resultat, nomOrganisation, Lien, ici }: AccesPlateformeProps) {
  if (resultat.error !== undefined) return <ErreurDeLecture message={resultat.error} href={ici} Lien={Lien} />
  const { accesses, addedByStaff } = resultat.data
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h2 id={ANCRE_DES_ACCES} tabIndex={-1} className="oto-label">
          {`Accès de l'équipe plateforme à ${nomOrganisation}`}
        </h2>
        {accesses.length === 0 ? (
          <p>{`Aucun accès de l'équipe plateforme n'a été accordé à ${nomOrganisation}.`}</p>
        ) : (
          <TableauFixe
            nommePar={ANCRE_DES_ACCES}
            entetes={["Personne", "Accord", "État", "Action"]}
            lignes={accesses.map((acces) => ({ cle: acces.id, cellules: cellulesDAcces(acces, nomOrganisation) }))}
          />
        )}
      </section>
      <AjoutesParLeStaff membres={addedByStaff} nomOrganisation={nomOrganisation} />
    </div>
  )
}
