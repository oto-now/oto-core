// « Supervision » de la plateforme (administration et cellule, N9) : pour l'équipe plateforme, tous les espaces de la
// cellule, accès daté ou non, avec leurs chiffres (membres, appels des 30 derniers jours, connecteurs actifs,
// comptes) ; une ligne s'ouvre, par un `<details>` natif, sur ses membres et leur rôle, puis ses comptes par connecteur
// et titulaire. Ni clé, ni libellé de compte, ni contenu : y entrer reste l'accès daté. Server Component, sans état.
//
// Absent d'oto-frontend : posé sur la grammaire des écrans d'administration (en-tête, un îlot, la table serveur), sans
// le fil de l'administration d'une organisation, dont il ne fait pas partie.
import { Binoculars } from "@phosphor-icons/react/dist/ssr/Binoculars"
import { SUPERVISION_DAYS, type SupervisedAccounts, type SupervisedMember, type SupervisedOrg } from "../../schemas"
import type { Resultat } from "../api/resultat"
import { ErreurDeLecture } from "../components/erreur-de-lecture"
import { TableServeur, type ColonneDeTable } from "../components/table-serveur"
import { EmptyState } from "../ds/react/empty-state"
import { Icon } from "../ds/react/icon"
import { ScreenHeader } from "../ds/react/screen-header"
import { Chargement, Ilot } from "../admin/ilot"
import type { LienDeLAdministration } from "../admin/types"
import { dateLisible } from "../format/dates"
import { nombreLisible } from "../format/nombres"

export type EcranSupervisionProps = {
  resultat: Resultat<SupervisedOrg[]>
  Lien: LienDeLAdministration
  /** L'adresse de l'écran dans l'hôte : « Réessayer » d'une lecture en échec y ramène. */
  ici: string
}

const ANCRE = "supervision-espaces"

const COLONNES: readonly ColonneDeTable[] = [
  { entete: "Espace" },
  { entete: "Identifiant" },
  { entete: "Membres", numerique: true },
  { entete: `Appels (${SUPERVISION_DAYS} j)`, numerique: true },
  { entete: "Connecteurs actifs", numerique: true },
  { entete: "Comptes", numerique: true },
]

const ROLES: Record<SupervisedMember["role"], string> = { admin: "Administrateur", member: "Membre" }
const ETATS: Record<SupervisedAccounts["status"], string> = { active: "actif", disabled: "désactivé", error: "en erreur" }
const MODES: Record<SupervisedAccounts["mode"], string> = { reel: "réel", sandbox: "bac à sable", simule: "simulé" }

function pluriel(nombre: number, un: string, plusieurs: string): string {
  return `${nombreLisible(nombre)} ${nombre === 1 ? un : plusieurs}`
}

/** Le titulaire d'un groupe de comptes : l'organisation, l'équipe par son nom, la personne par son email. */
function titulaire(groupe: SupervisedAccounts): string {
  if (groupe.ownerKind === "org") return "L'organisation"
  if (groupe.ownerKind === "team") return `Équipe ${groupe.ownerLabel ?? "retirée"}`
  return groupe.ownerLabel ?? "Personne hors de l'organisation"
}

function Membres({ membres }: { membres: SupervisedMember[] }) {
  if (membres.length === 0) return <p>Aucun membre.</p>
  return (
    <ul className="flex flex-col gap-1">
      {membres.map((membre) => (
        <li key={membre.userId}>
          {`${membre.email ?? membre.name ?? "Membre sans email"} · ${ROLES[membre.role]} · depuis le ${dateLisible(membre.since) ?? "?"}`}
        </li>
      ))}
    </ul>
  )
}

function Comptes({ groupes }: { groupes: SupervisedAccounts[] }) {
  if (groupes.length === 0) return <p>Aucun compte.</p>
  return (
    <ul className="flex flex-col gap-1">
      {groupes.map((groupe) => (
        // Un groupe est unique par connecteur, titulaire, état et mode (`staff_org_accounts`).
        <li key={`${groupe.connector}|${groupe.ownerKind}|${groupe.ownerLabel ?? ""}|${groupe.status}|${groupe.mode}`}>
          <span className="oto-mono">{groupe.connector}</span>
          {` · ${titulaire(groupe)} · ${ETATS[groupe.status]} · ${MODES[groupe.mode]} · ${pluriel(groupe.accounts, "compte", "comptes")}`}
        </li>
      ))}
    </ul>
  )
}

function LigneDEspace({ espace }: { espace: SupervisedOrg }) {
  return (
    <>
      <tr>
        <td data-primary="">{espace.name}</td>
        <td>
          <span className="oto-mono">{espace.slug}</span>
        </td>
        <td data-numeric="">{nombreLisible(espace.members)}</td>
        <td data-numeric="">{nombreLisible(espace.calls)}</td>
        <td data-numeric="">{nombreLisible(espace.activeConnectors)}</td>
        <td data-numeric="">{nombreLisible(espace.accounts)}</td>
      </tr>
      <tr>
        <td colSpan={COLONNES.length}>
          <details>
            <summary className="cursor-pointer underline underline-offset-2">{`Membres et comptes de ${espace.name}`}</summary>
            <div className="flex flex-col gap-3 py-2">
              <section aria-label={`Membres de ${espace.name}`} className="flex flex-col gap-1">
                <h3 className="oto-caption">{`Membres et rôles (${nombreLisible(espace.people.length)})`}</h3>
                <Membres membres={espace.people} />
              </section>
              <section aria-label={`Comptes de ${espace.name}`} className="flex flex-col gap-1">
                <h3 className="oto-caption">Comptes par connecteur et titulaire</h3>
                <Comptes groupes={espace.accountGroups} />
              </section>
            </div>
          </details>
        </td>
      </tr>
    </>
  )
}

function Espaces({ espaces }: { espaces: SupervisedOrg[] }) {
  return (
    <Ilot id={ANCRE} titre="Espaces de la plateforme" compte={pluriel(espaces.length, "espace", "espaces")}>
      {espaces.length === 0 ? (
        <EmptyState title="Aucun espace sur cette plateforme." />
      ) : (
        <TableServeur legende="Espaces de la plateforme" colonnes={COLONNES}>
          {espaces.map((espace) => (
            <LigneDEspace key={espace.id} espace={espace} />
          ))}
        </TableServeur>
      )}
    </Ilot>
  )
}

export function EcranSupervision({ resultat, Lien, ici }: EcranSupervisionProps) {
  return (
    <>
      <ScreenHeader
        title="Supervision"
        icon={<Icon as={Binoculars} size="sm" />}
        meta={`Tous les espaces, leurs membres et leurs comptes ; appels des ${SUPERVISION_DAYS} derniers jours. Le contenu reste fermé sans accès daté.`}
      />
      {resultat.error !== undefined ? <ErreurDeLecture message={resultat.error} href={ici} Lien={Lien} /> : <Espaces espaces={resultat.data} />}
    </>
  )
}

/** L'état de chargement, rendu par le `loading.tsx` de l'hôte. */
export function EcranSupervisionChargement() {
  return <Chargement texte="Chargement de la supervision…" />
}
