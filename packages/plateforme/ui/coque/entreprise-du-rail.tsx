"use client"

// Porté d'oto-frontend (src/components/coque/entreprise-du-rail.tsx) : l'organisation en tête du rail. Changé (#221,
// décisions D5 et D6 de JB) : le bloc fusionne le logo et le nom et mène à l'accueil (infobulle « Accueil », marqué sur
// l'accueil), qui n'a plus de ligne à lui ; ses écrans (Organisation, Équipes & accès, Activité, Retours) sont passés au
// menu du compte, sous le nom de l'organisation (`PiedDuRail`). La bascule d'entreprise (décision du 2026-10-01 : une
// personne peut avoir plusieurs organisations) reste à droite du bloc, « Changer d'espace », à partir de deux
// organisations joignables : chaque organisation ayant sa propre adresse (ADR-004), choisir une organisation mène à son
// adresse, où la session se reprend ; « Créer une organisation » la suit quand l'hôte donne sa page d'inscription, et
// garde alors le bouton avec une seule organisation, sans quoi l'entrée n'aurait plus de place. Le logo de l'organisation
// remplace le mark (E09-S01). Retiré : TanStack Query, le menu de l'entreprise.
import { CaretUpDown } from "@phosphor-icons/react/dist/csr/CaretUpDown"
import { Plus } from "@phosphor-icons/react/dist/csr/Plus"
import { AnimatedIcon } from "../ds/react/icon"
import { RailItem } from "../ds/react/layout"
import { DropdownMenu, type MenuItem } from "../ds/react/overlays"
import { IconButton } from "../ds/react/primitives"
import { OtoMark } from "../ds/react/product"
import { Tooltip } from "../ds/react/tooltip"
import { useHote } from "../hote/navigation"
import { LogoDOrganisation } from "../marque/logo-d-organisation"
import type { PersonOrganisation } from "../../schemas"
import { ENTREPRISE, RAIL } from "./libelles"
import type { AdressesDuRail } from "./types"

export type EntrepriseDuRailProps = {
  /** Le nom affiché et le logo de l'organisation ; `null` quand l'identité n'a pas été lue (le bloc dit « Oto »). */
  entreprise: { nom: string; logo: string | null } | null
  adresses: AdressesDuRail
  /** Sans effet depuis #221 : les écrans de l'organisation sont au menu du compte (`PiedDuRail`). Gardé facultatif pour les hôtes qui le passent. */
  administre?: boolean
  /** Les organisations de la personne ; « Changer d'espace » ne se montre qu'à partir de deux qui ont une adresse. */
  organisations?: PersonOrganisation[]
}

/** L'organisation choisie a sa propre adresse : on y part, la session s'y reprend. Celle qu'on regarde ne mène nulle part. */
function allerA(organisation: PersonOrganisation | undefined) {
  if (!organisation || organisation.current || !organisation.host) return
  window.location.assign(new URL("/", `${window.location.protocol}//${organisation.host}`).href)
}

/** Le menu de « Changer d'espace » : les organisations joignables, la courante cochée, puis « Créer une organisation ». */
function menuDesEspaces(bascule: readonly PersonOrganisation[], inscription: string | undefined, naviguer: (adresse: string) => void): MenuItem[] {
  const creer: MenuItem[] = inscription ? [{ label: ENTREPRISE.creer, icon: <AnimatedIcon as={Plus} size="xs" />, onSelect: () => naviguer(inscription) }] : []
  return [
    ...bascule.map((organisation) => ({ label: organisation.name, radio: true, checked: organisation.current, onSelect: () => allerA(organisation) })),
    ...(bascule.length > 0 && creer.length > 0 ? [{ separator: true }] : []),
    ...creer,
  ]
}

/** Le bloc de l'organisation, lien vers l'accueil, et « Changer d'espace » à sa droite. */
export function EntrepriseDuRail({ entreprise, adresses, organisations }: EntrepriseDuRailProps) {
  const { Lien, chemin, naviguer } = useHote()
  const nom = entreprise?.nom || "Oto"
  const logo = entreprise ? <LogoDOrganisation nom={entreprise.nom} logo={entreprise.logo} taille={24} /> : <OtoMark size={24} />
  const joignables = (organisations ?? []).filter((organisation) => organisation.current || organisation.host)
  const menu = menuDesEspaces(joignables.length > 1 ? joignables : [], adresses.inscription, naviguer)
  const { accueil } = adresses
  return (
    <div className="oto-rail-org">
      {accueil === undefined ? (
        <RailItem as="span" variant="org" label={nom} icon={logo} />
      ) : (
        <Tooltip content={RAIL.accueil} side="bottom">
          {/* `title` retiré : l'infobulle du design system dit « Accueil », celle du navigateur aurait redit le nom. */}
          <RailItem as={Lien} href={accueil} variant="org" label={nom} icon={logo} active={chemin === accueil} title={undefined} />
        </Tooltip>
      )}
      {menu.length > 0 && (
        <DropdownMenu
          trigger={
            <IconButton label={RAIL.changerDEspace} size="sm">
              <AnimatedIcon as={CaretUpDown} size="xs" />
            </IconButton>
          }
          items={menu}
        />
      )}
    </div>
  )
}
