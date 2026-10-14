"use client"

// Porté d'oto-frontend (src/components/coque/compte-du-rail.tsx et le pied de rail-application.tsx) : la
// ligne « Connecteurs », puis la ligne de compte et son menu, ouvert par l'engrenage. Changé : les
// entrées sont celles de `ecransPermis` rangées au pied ou au compte, aux adresses que l'hôte sert
// (E05-S11) — « Connecteurs » pour qui administre (AC-32), « Profil » ouvre la page Profil (AC-6),
// « Brancher un assistant », la Corbeille (AC-e22) —, puis un filet et la déconnexion de l'hôte. Retiré :
// Agents, Procédures (portage-ecrans.md § 0), la ligne « Couleur » et « Apparence » (E05-S11, AC-6 : la
// couleur de la personne se choisit dans Profil, celle de l'organisation dans Organisation), la ligne
// « Corbeille » du pied (AC-e22). Ajouté : la bascule jour ou nuit, quand l'hôte la sert (`Hote.apparence`) ; le paquet
// n'écrit pas le mode, il est à l'hôte.
import { Moon } from "@phosphor-icons/react/dist/csr/Moon"
import { SignOut } from "@phosphor-icons/react/dist/csr/SignOut"
import { Sun } from "@phosphor-icons/react/dist/csr/Sun"
import { AnimatedIcon } from "../ds/react/icon"
import { RailFoot, RailItem } from "../ds/react/layout"
import type { MenuItem } from "../ds/react/overlays"
import { RailAccount } from "../ds/react/rail"
import { useHote, type Hote } from "../hote/navigation"
import { LigneDuRail } from "./arbre-du-rail"
import { ecransPermis, type EcranPermis } from "./ecrans"
import { COMPTE } from "./libelles"
import type { AdressesDuRail } from "./types"

/** L'entrée qui passe à l'autre mode : elle nomme le mode où l'on va, jamais celui où l'on est. */
function bascule({ mode, basculer }: NonNullable<Hote["apparence"]>): MenuItem {
  return mode === "dark"
    ? { label: COMPTE.modeClair, icon: <AnimatedIcon as={Sun} size="xs" />, onSelect: basculer }
    : { label: COMPTE.modeSombre, icon: <AnimatedIcon as={Moon} size="xs" />, onSelect: basculer }
}

/** Les items du menu du compte : ses écrans, puis, sous un filet, le mode jour ou nuit et la déconnexion quand l'hôte les sert. */
function itemsDuCompte(ecrans: readonly EcranPermis[], { naviguer, deconnecter, apparence }: Pick<Hote, "naviguer" | "deconnecter" | "apparence">): MenuItem[] {
  const gestes: MenuItem[] = [
    ...(apparence ? [bascule(apparence)] : []),
    ...(deconnecter ? [{ label: COMPTE.deconnexion, icon: <AnimatedIcon as={SignOut} size="xs" />, onSelect: deconnecter }] : []),
  ]
  return [
    ...ecrans.map((ecran) => ({ label: ecran.libelle, icon: <AnimatedIcon as={ecran.glyphe} size="xs" />, onSelect: () => naviguer(ecran.adresse) })),
    ...(gestes.length > 0 ? [{ separator: true }, ...gestes] : []),
  ]
}

/** Les lignes du pied, au-dessus du compte ; la courante est marquée, sous-pages comprises. */
function LignesDuPied({ ecrans, chemin }: { ecrans: readonly EcranPermis[]; chemin: string }) {
  return ecrans.map((ecran) => (
    <RailItem
      key={ecran.adresse}
      as={LigneDuRail}
      href={ecran.adresse}
      label={ecran.libelle}
      icon={<AnimatedIcon as={ecran.glyphe} size="xs" />}
      active={chemin === ecran.adresse || chemin.startsWith(`${ecran.adresse}/`)}
    />
  ))
}

export type PiedDuRailProps = {
  /** Le nom de la personne ; `null` quand l'identité n'a pas été lue (« Mon compte »). */
  compte: string | null
  adresses: AdressesDuRail
  /** `isOrgAdmin` de l'identité : « Connecteurs ». */
  administre: boolean
}

/** Le pied du rail : « Connecteurs » (qui administre), puis le compte et son menu. */
export function PiedDuRail({ compte, adresses, administre }: PiedDuRailProps) {
  const hote = useHote()
  const ecrans = ecransPermis(adresses, administre)
  return (
    <RailFoot>
      <LignesDuPied ecrans={ecrans.filter((ecran) => ecran.rangement === "pied")} chemin={hote.chemin} />
      <RailAccount
        name={compte ?? COMPTE.anonyme}
        items={itemsDuCompte(
          ecrans.filter((ecran) => ecran.rangement === "compte"),
          hote,
        )}
      />
    </RailFoot>
  )
}
