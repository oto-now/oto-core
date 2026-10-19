// « Partages » d'un compte personnel que la personne gère (écran Connecteurs ouvert aux membres) : sous sa ligne, à qui
// il est partagé et à quel niveau, chaque partage retiré par un geste confirmé (`DELETE admin/account-rules/<id>`),
// puis le formulaire qui partage à toute l'organisation ou à une équipe (`PartageDuCompte`). Server Component : il
// reçoit les règles lues par la page (`listAccountRules`), et ne décide aucun droit : `partageable` dit, sur ce que le
// service rend (le propriétaire et `viewerLevel`), sous quels comptes l'écran le pose.
import type { AccountLevelName, AccountView } from "../../../schemas"
import { ActionPlateforme } from "../../components/action-plateforme"
import { NIVEAUX_DU_COMPTE, sujetDuPartage } from "./libelles-des-partages"
import { PartageDuCompte } from "./partage-du-compte"

/**
 * Les partages d'un compte, tels que `listAccountRules` les rend : les règles des équipes et des personnes, nommées, et à
 * part celle de toute l'organisation (`general`).
 */
export type PartagesDuCompte = {
  rules: { id: string; subject: { kind: "team" | "user"; name: string }; level: AccountLevelName }[]
  general: { id: string; level: AccountLevelName } | null
}

/** Un compte personnel que la personne gère : l'écran y pose ses partages, et la page de l'hôte en lit les règles. */
export function partageable(compte: Pick<AccountView, "owner" | "viewerLevel">): boolean {
  return compte.owner.kind === "user" && compte.viewerLevel === "manage"
}

type Ligne = { id: string; sujet: string; niveau: AccountLevelName }

function lignes(partages: PartagesDuCompte): Ligne[] {
  const general = partages.general ? [{ id: partages.general.id, sujet: sujetDuPartage({ kind: "org", name: null }), niveau: partages.general.level }] : []
  return [...general, ...partages.rules.map((regle) => ({ id: regle.id, sujet: sujetDuPartage(regle.subject), niveau: regle.level }))]
}

type ListeDesPartagesProps = {
  compte: Pick<AccountView, "id" | "label">
  partages: PartagesDuCompte
  equipes: { id: string; name: string }[]
  /** L'ancre de la liste des comptes : le focus y va quand un geste emporte sa ligne. */
  ancre: string
}

export function ListeDesPartages({ compte, partages, equipes, ancre }: ListeDesPartagesProps) {
  const titre = `Partages de ${compte.label}`
  const partagesDuCompte = lignes(partages)
  return (
    <div className="flex w-full flex-col gap-2">
      <p className="oto-label">{titre}</p>
      {partagesDuCompte.length === 0 ? (
        <p className="oto-caption">Ce compte n&apos;est partagé avec personne.</p>
      ) : (
        <ul className="flex flex-col gap-1" aria-label={titre}>
          {partagesDuCompte.map((ligne) => (
            <li key={ligne.id} className="flex flex-wrap items-center gap-3">
              <span className="min-w-0 flex-1">{`${ligne.sujet} · ${NIVEAUX_DU_COMPTE[ligne.niveau]}`}</span>
              <ActionPlateforme
                libelle="Retirer"
                nomAccessible={`Retirer le partage à ${ligne.sujet}`}
                requete={{ methode: "DELETE", ressource: `admin/account-rules/${encodeURIComponent(ligne.id)}` }}
                confirmation={{ question: `Retirer le partage de « ${compte.label} » à ${ligne.sujet} ?`, libelleConfirmer: "Retirer le partage" }}
                ancre={ancre}
              />
            </li>
          ))}
        </ul>
      )}
      <PartageDuCompte compte={compte} equipes={equipes} ancre={ancre} />
    </div>
  )
}
