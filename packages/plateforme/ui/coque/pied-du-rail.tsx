"use client"

// Porté d'oto-frontend (src/components/coque/compte-du-rail.tsx et le pied de rail-application.tsx) : la ligne de
// compte et son menu. Changé : les entrées sont celles de `ecransPermis`, aux adresses que l'hôte sert (E05-S11). #221
// (décision D5 de JB, maquette du menu du compte) : la ligne « Connecteurs » quitte le pied ; le menu s'ouvre sur la
// personne (avatar, nom, email), puis trois groupes titrés : « Vous » (« Mes instructions », le Contexte privé de la
// personne, Profil, Connecteurs, « Brancher mon Claude, ChatGPT ou Mistral », Corbeille), le nom de l'organisation avec son
// logo (Organisation, Équipes & accès, Activité, Retours pour qui les traite : le menu de l'entreprise, descendu du haut du
// rail), « Apparence » (le mode sombre en interrupteur, quand l'hôte le sert : le paquet n'écrit pas le mode, il est à
// l'hôte) ; enfin, sous un filet, la déconnexion de l'hôte. Retiré : Agents, Procédures (portage-ecrans.md § 0), la ligne
// « Couleur » (E05-S11, AC-6 : la couleur de la personne se choisit dans Profil, celle de l'organisation dans
// Organisation), la vue « Contexte » (la palette la garde).
import { Moon } from "@phosphor-icons/react/dist/csr/Moon"
import { SignOut } from "@phosphor-icons/react/dist/csr/SignOut"
import { Info } from "@phosphor-icons/react/dist/csr/Info"
import { PERSO, SECTION_PERSO, titreDeContexte } from "../arbre/depuis-l-arbre"
import { AnimatedIcon } from "../ds/react/icon"
import { RailFoot } from "../ds/react/layout"
import type { MenuItem } from "../ds/react/overlays"
import { RailAccount } from "../ds/react/rail"
import { useHote, type Hote } from "../hote/navigation"
import { LogoDOrganisation } from "../marque/logo-d-organisation"
import { ecransPermis, type EcranPermis } from "./ecrans"
import { COMPTE } from "./libelles"
import type { AdressesDuRail } from "./types"

type Entreprise = { nom: string; logo: string | null } | null

/** Un groupe titré, ou rien quand il n'a aucune entrée. */
function groupe(titre: string, entrees: MenuItem[], icon?: MenuItem["icon"]): MenuItem[] {
  return entrees.length > 0 ? [{ group: titre, icon }, ...entrees] : []
}

/** Les entrées d'écrans : chacune navigue vers son adresse. */
const versEntrees = (ecrans: readonly EcranPermis[], naviguer: (adresse: string) => void): MenuItem[] =>
  ecrans.map((ecran) => ({ label: ecran.libelle, icon: <AnimatedIcon as={ecran.glyphe} size="xs" />, onSelect: () => naviguer(ecran.adresse) }))

/**
 * Les items du menu du compte : « Vous » (« Mes instructions » quand la personne a son espace, l'adresse de son Contexte
 * privé, puis ses écrans), l'organisation (ses réglages, puis son suivi), « Apparence » quand l'hôte sert le mode, puis,
 * sous un filet, la déconnexion quand l'hôte la sert.
 */
function itemsDuCompte(instructions: string | null, ecrans: readonly EcranPermis[], entreprise: Entreprise, { naviguer, deconnecter, apparence }: Pick<Hote, "naviguer" | "deconnecter" | "apparence">): MenuItem[] {
  const mesInstructions: MenuItem[] = instructions ? [{ label: titreDeContexte(SECTION_PERSO), icon: <AnimatedIcon as={Info} size="xs" />, onSelect: () => naviguer(instructions) }] : []
  const deLOrganisation = ecrans.filter((ecran) => ecran.rangement === "reglages" || ecran.rangement === "suivi")
  const nom = entreprise?.nom || "Oto"
  const mode: MenuItem[] = apparence ? [{ label: COMPTE.modeSombre, icon: <AnimatedIcon as={Moon} size="xs" />, switch: true, checked: apparence.mode === "dark", keepOpen: true, onSelect: apparence.basculer }] : []
  return [
    ...groupe(COMPTE.vous, [...mesInstructions, ...versEntrees(ecrans.filter((ecran) => ecran.rangement === "compte"), naviguer)]),
    // Les réglages d'abord, le suivi (Retours) ensuite : l'ordre de `ecransPermis`.
    ...groupe(nom, versEntrees(deLOrganisation, naviguer), entreprise ? <LogoDOrganisation nom={entreprise.nom} logo={entreprise.logo} taille={14} /> : undefined),
    ...groupe(COMPTE.apparence, mode),
    ...(deconnecter ? [{ separator: true }, { label: COMPTE.deconnexion, icon: <AnimatedIcon as={SignOut} size="xs" />, onSelect: deconnecter }] : []),
  ]
}

export type PiedDuRailProps = {
  /** Le nom de la personne ; `null` quand l'identité n'a pas été lue (« Mon compte »). */
  compte: string | null
  /** L'email de la personne, sous son nom en tête du menu (facultatif : sans lui, le nom seul). */
  email?: string | null
  /** L'espace de la personne, `private/<handle>` : « Mes instructions » en tête du menu ; `null` ou absent sans profil, rien (facultatif : un hôte qui monte déjà ce pied compile encore). */
  handle?: string | null
  /** Le nom et le logo de l'organisation, qui titrent le groupe de ses écrans (facultatif : sans eux, « Oto »). */
  entreprise?: Entreprise
  adresses: AdressesDuRail
  /** `isOrgAdmin` de l'identité : les écrans d'administration que `ecransPermis` réserve. */
  administre: boolean
}

/** Le pied du rail : la personne et son menu. */
export function PiedDuRail({ compte, email = null, handle = null, entreprise = null, adresses, administre }: PiedDuRailProps) {
  const hote = useHote()
  return (
    <RailFoot>
      <RailAccount
        name={compte ?? COMPTE.anonyme}
        email={email}
        items={itemsDuCompte(handle === null ? null : `${adresses.pages}${PERSO}/${handle}/contexte`, ecransPermis(adresses, administre), entreprise, hote)}
      />
    </RailFoot>
  )
}
