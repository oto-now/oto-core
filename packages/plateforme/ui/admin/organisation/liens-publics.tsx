// « Liens publics » de l'écran « Organisation » (E05-S10, AC-d7 ; ADR-013 § 2) : les liens de partage actifs de
// l'organisation, pour son administrateur — le contenu, son auteur, sa date — et
// « Désactiver », confirmé en place (`ActionPlateforme`, `DELETE /api/platform/shares/<id>`). La liste arrive
// après l'écran, sous son `<Suspense>` : l'hôte la lit (`listShares`) sans l'attendre. Un contenu d'un espace
// privé garde son espace et perd son titre (D44, décidé par le service). Server Component. Sans lui, un
// administrateur ne voit pas ce que son organisation publie hors d'elle.
import { Suspense, use } from "react"
import type { OrgShareView } from "../../../schemas"
import type { Resultat } from "../../api/resultat"
import { ActionPlateforme } from "../../components/action-plateforme"
import { ErreurDeLecture } from "../../components/erreur-de-lecture"
import { LienDeCellule, TableServeur } from "../../components/table-serveur"
import { EmptyState } from "../../ds/react/empty-state"
import { dateLisible } from "../../format/dates"
import { Ilot } from "../ilot"
import type { LienDeLAdministration } from "../types"

/** Le titre de l'îlot, qui reçoit le focus quand « Désactiver » emporte sa ligne. */
const ANCRE = "organisation-liens-publics"

export const LIENS_PUBLICS = {
  titre: "Liens publics",
  legende: "Liens publics actifs, le plus récent d'abord",
  chargement: "Lecture des liens publics…",
  aucun: "Aucun lien public actif.",
  aucunDetail: "Un contenu se partage sur le web depuis « Partager », par qui en a l'accès complet.",
  prive: (chemin: string) => `${chemin} (espace privé)`,
  auteurParti: "Personne partie",
  desactiver: "Désactiver",
  question: "Désactiver ce lien ? Il ne mènera plus à rien.",
  confirmer: "Désactiver le lien",
  nomDuGeste: (contenu: string) => `Désactiver le lien de ${contenu}`,
} as const

// Contenu, auteur et date (AC-d7), puis le geste : une colonne de plus poussait « Désactiver » hors de l'îlot à 1 280 px.
const COLONNES = [{ entete: "Contenu" }, { entete: "Auteur" }, { entete: "Créé le" }, { entete: "Action" }] as const

/** Ce que l'hôte passe : la lecture des liens, lancée sans être attendue, et l'adresse des pages. */
export type LiensPublicsDeLOrganisation = {
  lecture: Promise<Resultat<OrgShareView[]>>
  /** Le préfixe des pages de l'hôte (`"/n/"`) : le contenu d'un lien lisible y mène. */
  prefixeDesPages: string
}

type Navigation = { Lien: LienDeLAdministration; ici: string; prefixeDesPages: string }

function LigneDuLien({ lien, Lien, prefixeDesPages }: Omit<Navigation, "ici"> & { lien: OrgShareView }) {
  const contenu = lien.title ?? LIENS_PUBLICS.prive(lien.path)
  return (
    <tr>
      <td>
        {lien.title === null ? (
          contenu
        ) : (
          <LienDeCellule Lien={Lien} href={`${prefixeDesPages}${lien.path}`}>
            {lien.title}
          </LienDeCellule>
        )}
      </td>
      <td>{lien.createdByName ?? LIENS_PUBLICS.auteurParti}</td>
      <td>{dateLisible(lien.createdAt) ?? lien.createdAt}</td>
      <td>
        <ActionPlateforme
          libelle={LIENS_PUBLICS.desactiver}
          requete={{ methode: "DELETE", ressource: `shares/${lien.id}` }}
          confirmation={{ question: LIENS_PUBLICS.question, libelleConfirmer: LIENS_PUBLICS.confirmer }}
          ancre={ANCRE}
          nomAccessible={LIENS_PUBLICS.nomDuGeste(contenu)}
          taille="sm"
        />
      </td>
    </tr>
  )
}

function ListeDesLiens({ lecture, ...navigation }: Navigation & { lecture: Promise<Resultat<OrgShareView[]>> }) {
  const lu = use(lecture)
  if (lu.error !== undefined) return <ErreurDeLecture message={lu.error} href={navigation.ici} Lien={navigation.Lien} />
  if (lu.data.length === 0) {
    return (
      <EmptyState compact title={LIENS_PUBLICS.aucun}>
        {LIENS_PUBLICS.aucunDetail}
      </EmptyState>
    )
  }
  return (
    <TableServeur legende={LIENS_PUBLICS.legende} colonnes={COLONNES}>
      {lu.data.map((lien) => (
        <LigneDuLien key={lien.id} lien={lien} Lien={navigation.Lien} prefixeDesPages={navigation.prefixeDesPages} />
      ))}
    </TableServeur>
  )
}

export function LiensPublics({ liens, Lien, ici }: { liens: LiensPublicsDeLOrganisation; Lien: LienDeLAdministration; ici: string }) {
  return (
    <Ilot id={ANCRE} titre={LIENS_PUBLICS.titre}>
      <Suspense
        fallback={
          <p role="status" aria-busy="true" className="oto-caption">
            {LIENS_PUBLICS.chargement}
          </p>
        }
      >
        <ListeDesLiens lecture={liens.lecture} Lien={Lien} ici={ici} prefixeDesPages={liens.prefixeDesPages} />
      </Suspense>
    </Ilot>
  )
}
