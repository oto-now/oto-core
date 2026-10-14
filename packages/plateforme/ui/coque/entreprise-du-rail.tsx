"use client"

// Porté d'oto-frontend (src/components/coque/entreprise-du-rail.tsx) : la pastille d'entreprise en tête
// du rail et son menu — « Suivi de l'entreprise », « Réglages de l'entreprise », « Membres & équipes »
// —, chaque entrée navigue ; une entrée d'administration se montre ou disparaît avec le droit, elle
// n'est jamais grisée. Changé : les écrans de la plateforme se rangent sous ces trois titres (AC-a4,
// HN-E05S09-1) ; le droit est `isOrgAdmin` de l'identité, servi par la page (administrateur, ou staff
// avec un accès en cours) ; le logo de l'organisation remplace le mark (E09-S01). E05-S11 (AC-33) : deux
// groupes, « Réglages de l'entreprise » (Organisation, Équipes & accès) avant « Suivi de l'entreprise » ;
// « Membres & équipes » disparaît. E05-S13 (AC-10) : Journal dans les réglages ; Usage caché et Retours au staff, par
// les adresses que l'hôte donne. 1.1.3 : « Suivi de l'entreprise » disparaît, Usage et Retours hors du menu
// (`ecrans.ts`), un seul groupe reste, sans sous-titre. La bascule d'entreprise revient (décision du 2026-10-01 : une
// personne peut avoir plusieurs organisations) : chaque organisation ayant sa propre adresse (ADR-004), choisir une
// organisation mène à son adresse, où la session se reprend. Retiré : TanStack Query.
import { Plus } from "@phosphor-icons/react/dist/csr/Plus"
import { AnimatedIcon } from "../ds/react/icon"
import type { MenuItem } from "../ds/react/overlays"
import { OrgSwitcher } from "../ds/react/product"
import { useHote } from "../hote/navigation"
import { LogoDOrganisation } from "../marque/logo-d-organisation"
import type { PersonOrganisation } from "../../schemas"
import { ecransPermis, type EcranPermis, type Rangement } from "./ecrans"
import { ENTREPRISE } from "./libelles"
import type { AdressesDuRail } from "./types"

const GROUPES: readonly { rangement: Rangement; titre: string }[] = [
  { rangement: "reglages", titre: ENTREPRISE.reglages },
]

/**
 * Les deux groupes du menu, chacun avec les écrans qui s'y rangent ; un groupe vide n'est pas montré, et un seul
 * groupe montré n'a pas de sous-titre (E05-S13, AC-10, HN-E05S13-8) : le titre ne sert qu'à séparer deux groupes.
 */
function menuDeLEntreprise(ecrans: readonly EcranPermis[], naviguer: (adresse: string) => void): MenuItem[] {
  const groupes = GROUPES.map(({ rangement, titre }) => ({ titre, entrees: ecrans.filter((ecran) => ecran.rangement === rangement) })).filter(
    ({ entrees }) => entrees.length > 0,
  )
  return groupes.flatMap(({ titre, entrees }) => [
    ...(groupes.length > 1 ? [{ group: titre }] : []),
    ...entrees.map((ecran) => ({ label: ecran.libelle, icon: <AnimatedIcon as={ecran.glyphe} size="xs" />, onSelect: () => naviguer(ecran.adresse) })),
  ])
}

export type EntrepriseDuRailProps = {
  /** Le nom affiché et le logo de l'organisation ; `null` quand l'identité n'a pas été lue (la pastille dit « Oto »). */
  entreprise: { nom: string; logo: string | null } | null
  adresses: AdressesDuRail
  administre: boolean
  /** Les organisations de la personne ; la bascule ne se montre qu'à partir de deux qui ont une adresse. */
  organisations?: PersonOrganisation[]
}

/** L'organisation choisie a sa propre adresse : on y part, la session s'y reprend. Celle qu'on regarde ne mène nulle part. */
function allerA(organisation: PersonOrganisation | undefined) {
  if (!organisation || organisation.current || !organisation.host) return
  window.location.assign(`${window.location.protocol}//${organisation.host}/`)
}

/** La pastille d'entreprise et son menu. */
export function EntrepriseDuRail({ entreprise, adresses, administre, organisations }: EntrepriseDuRailProps) {
  const { naviguer } = useHote()
  const logo = entreprise ? <LogoDOrganisation nom={entreprise.nom} logo={entreprise.logo} taille={18} /> : undefined
  const joignables = (organisations ?? []).filter((organisation) => organisation.current || organisation.host)
  const bascule = joignables.length > 1 ? joignables : []
  const courante = bascule.find((organisation) => organisation.current)
  const { inscription } = adresses
  return (
    <OrgSwitcher
      org={{ id: courante?.id ?? "courante", name: entreprise?.nom }}
      logo={logo}
      settings={menuDeLEntreprise(ecransPermis(adresses, administre), naviguer)}
      orgs={bascule.map(({ id, name }) => ({ id, name }))}
      onSelectOrg={({ id }) => allerA(bascule.find((organisation) => organisation.id === id))}
      after={inscription ? [{ label: ENTREPRISE.creer, icon: <AnimatedIcon as={Plus} size="xs" />, onSelect: () => naviguer(inscription) }] : []}
    />
  )
}
