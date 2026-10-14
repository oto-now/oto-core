"use client"

// Porté d'oto-frontend (src/components/settings/settings-shell.tsx) : le fil commun des écrans
// d'administration, que chaque écran pose dans son en-tête — le groupe, qui remonte à son premier écran,
// puis l'écran ouvert, qui porte ses frères en `menuitemradio` : c'est par lui qu'on passe au voisin.
// Changé : les groupes sont ceux du menu de l'entreprise (« Suivi de l'entreprise », « Réglages de
// l'entreprise », AC-a4) au lieu des quatre écrans de réglages ; les écrans, leurs mots et leurs glyphes
// sont ceux du rail (`ecransPermis`), aux adresses que l'hôte lui donne, et ceux que la personne ne peut pas
// ouvrir n'y sont pas ; la navigation est celle de l'hôte (`useHote`). Retiré : TanStack Router. 1.1.3 : le
// groupe « Suivi de l'entreprise » disparaît ; Usage et Retours, hors du menu, n'ont plus de fil.
import { Gear } from "@phosphor-icons/react/dist/csr/Gear"
import { ecransPermis, type EcranPermis, type Rangement } from "../coque/ecrans"
import { ENTREPRISE } from "../coque/libelles"
import { Breadcrumb, type Maillon } from "../ds/react/breadcrumb"
import { AnimatedIcon, Icon, type Glyphe } from "../ds/react/icon"
import type { MenuItem } from "../ds/react/overlays"
import { useHote } from "../hote/navigation"
import type { FilDeLEcran } from "./types"

/** Les écrans d'administration de la plateforme, par leur clé dans les adresses du rail. */
export type EcranDAdministration = "usage" | "retours" | "organisation" | "marque" | "drapeaux" | "acces" | "connecteurs" | "abonnement"

const GROUPES: Partial<Record<Rangement, { titre: string; glyphe: Glyphe }>> = {
  reglages: { titre: ENTREPRISE.reglages, glyphe: Gear },
}

/** Les frères de l'écran ouvert, en choix exclusifs : celui qu'on regarde est coché. */
function freresEnMenu(ouvert: EcranPermis, freres: readonly EcranPermis[], naviguer: (adresse: string) => void): MenuItem[] {
  return freres.map((frere) => ({
    label: frere.libelle,
    icon: <Icon as={frere.glyphe} size="xs" />,
    radio: true,
    checked: frere.adresse === ouvert.adresse,
    onSelect: () => naviguer(frere.adresse),
  }))
}

type FilDeLAdministrationProps = FilDeLEcran & { courant: EcranDAdministration }

/**
 * Le fil de l'écran ouvert ; rien quand l'écran n'est pas de ceux que la personne peut ouvrir (la page dit sa
 * réserve), ni quand il n'est rangé sous aucun groupe du menu de l'entreprise (Connecteurs, au pied du rail
 * depuis E05-S11, AC-32 ; Usage et Retours, hors du menu).
 */
export function FilDeLAdministration({ courant, adresses, administre }: FilDeLAdministrationProps) {
  const { Lien, naviguer } = useHote()
  const ecrans = ecransPermis(adresses, administre)
  const ouvert = ecrans.find((ecran) => ecran.adresse === adresses[courant])
  const groupe = ouvert && GROUPES[ouvert.rangement]
  if (!ouvert || !groupe) return null
  const freres = ecrans.filter((ecran) => ecran.rangement === ouvert.rangement)
  const items: Maillon[] = [
    // Le premier maillon remonte, il ne sélectionne pas : un lien vers le premier écran du groupe.
    { id: ouvert.rangement, label: groupe.titre, icon: <AnimatedIcon as={groupe.glyphe} size="xs" />, as: Lien, href: freres[0].adresse },
    { id: courant, label: ouvert.libelle, icon: <Icon as={ouvert.glyphe} size="xs" />, current: true, menu: freresEnMenu(ouvert, freres, naviguer) },
  ]
  return <Breadcrumb items={items} />
}
