"use client"

// Les lignes d'écrans du rail, une par écran permis (`ecransPermis`) : en tête, sous Accueil, et au pied, au-dessus
// du compte. Extrait du pied (2026-10-14) pour que la tête, qui accueille les écrans de l'hôte, les rende de même.
import { AnimatedIcon } from "../ds/react/icon"
import { RailItem } from "../ds/react/layout"
import { LigneDuRail } from "./arbre-du-rail"
import type { EcranPermis } from "./ecrans"

/** Les lignes de ces écrans, navigant par le lien de l'hôte ; la courante est marquée, sous-pages comprises. */
export function LignesDEcrans({ ecrans, chemin }: { ecrans: readonly EcranPermis[]; chemin: string }) {
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
