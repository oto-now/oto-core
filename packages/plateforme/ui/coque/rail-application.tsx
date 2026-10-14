"use client"

// Porté d'oto-frontend (src/components/coque/rail-application.tsx) : LE RAIL, la seule coque (ADR-008
// point 7). Ses zones, dans l'ordre : l'entreprise et son menu, Accueil, Rechercher (⌘K), une section
// par espace (le Contexte en tête, puis l'arbre), puis le pied (Connecteurs, le compte). Toute ligne
// navigue par le lien de l'hôte (`ContexteDeLHote`), jamais par une ancre qui rechargerait le document ;
// la ligne courante se calcule ici, sur l'adresse que l'hôte donne. Changé : les données viennent de la
// page de l'hôte (`DonneesDuRail`), lues sous le jeton de la session, au lieu de TanStack Query ; un
// échec de lecture se dit dans le rail avec son message et « Réessayer » (la relecture de la page), et
// l'écran reste ouvert. Retiré : Agents, compteurs, premier jour, squelette (les données
// arrivent avec la page). Ajouté (fiche D90 B) : sous 768 px, le bouton « Menu » ouvre le rail en tiroir,
// qu'oto-frontend laissait sans déclencheur ; son bouton est le `.oto-rail-toggle` du design system.
// E11-S20 : l'arbre servi est l'état de départ, remplacé par les relectures du rail (`useArbreDuRail`).
import { useCallback, useId, useRef, useState } from "react"
import { List } from "@phosphor-icons/react/dist/csr/List"
import { SquaresFour } from "@phosphor-icons/react/dist/csr/SquaresFour"
import { ErreurDeLecture } from "../components/erreur-de-lecture"
import { AnimatedIcon } from "../ds/react/icon"
import { Rail, RailItem, RailScroll } from "../ds/react/layout"
import { IconButton } from "../ds/react/primitives"
import { useHote } from "../hote/navigation"
import { LigneDuRail } from "./arbre-du-rail"
import { EntrepriseDuRail } from "./entreprise-du-rail"
import { RAIL } from "./libelles"
import { PiedDuRail } from "./pied-du-rail"
import { RechercheDuRail } from "./recherche-du-rail"
import { SectionsDuRail } from "./sections-du-rail"
import type { AdressesDuRail, DonneesDuRail } from "./types"
import { useArbreDuRail } from "./use-arbre-du-rail"

type ArbreProps = Pick<DonneesDuRail, "arbre" | "equipes" | "handle"> & { prefixe: string; enPanne: boolean }

/**
 * L'arbre en sections, ou l'échec de sa lecture (sans équipes, les sections ne se rangent pas) : le
 * message fourni, puis « Réessayer », qui relit la page (`ErreurDeLecture` sans lien), et avec elle l'arbre du
 * rail (E11-S20) ; une relecture réussie à la navigation remplace aussi l'échec.
 * `enPanne` : les relectures échouent depuis trois essais ; l'arbre montré reste, une ligne le dit sans alerte (AC-6),
 * dans une région de statut montée vide (`accessibility-patterns.md § Régions dynamiques`), hors de la mise en page
 * tant qu'elle l'est (le titre de groupe du rail réduit est un filet).
 */
function ArbreDuRail({ arbre, equipes, handle, prefixe, enPanne }: ArbreProps) {
  if (arbre.error !== undefined) return <ErreurDeLecture titre={RAIL.arbreEnPanne} message={arbre.error} />
  if (equipes.error !== undefined) return <ErreurDeLecture titre={RAIL.arbreEnPanne} message={equipes.error} />
  return (
    <>
      <SectionsDuRail arbre={arbre.data.tree} equipes={equipes.data} handle={handle} prefixe={prefixe} tronque={arbre.data.truncated} />
      <p role="status" className={enPanne ? "oto-rail-group" : "oto-sr-only"}>
        {enPanne ? RAIL.arbreNonActualise : ""}
      </p>
    </>
  )
}

/** Une couche posée sur le tiroir (menu, palette, dialogue) : Échap et le clic hors d'elle la ferment d'abord. */
const COUCHE_AU_DESSUS = '[role="menu"], dialog[open]'

/**
 * Le tiroir du rail sous 768 px : « Menu » l'ouvre ; Échap, le voile ou un clic hors du rail le ferment et
 * rendent le focus au bouton. Un menu du rail est monté hors de lui (portail) : sans la garde, le clic sur
 * l'une de ses lignes fermait le tiroir sous lui. Une navigation le referme, la page choisie se montre.
 */
function useTiroirDuRail(chemin: string) {
  const [ouvert, setOuvert] = useState(false)
  const [cheminVu, setCheminVu] = useState(chemin)
  const bouton = useRef<HTMLButtonElement>(null)
  if (cheminVu !== chemin) {
    setCheminVu(chemin)
    setOuvert(false)
  }
  const fermer = useCallback(() => {
    if (document.querySelector(COUCHE_AU_DESSUS)) return
    setOuvert(false)
    bouton.current?.focus()
  }, [])
  return { ouvert, ouvrir: () => setOuvert(true), fermer, bouton }
}

export type RailApplicationProps = DonneesDuRail & { adresses: AdressesDuRail }

export function RailApplication({ entreprise, arbre: servi, equipes, handle, compte, administre, adresses, organisations }: RailApplicationProps) {
  const { chemin } = useHote()
  const tiroir = useTiroirDuRail(chemin)
  const { arbre, enPanne } = useArbreDuRail(servi, chemin)
  const idDuRail = useId()
  const lu = arbre.error === undefined && equipes.error === undefined ? { tree: arbre.data.tree, equipes: equipes.data } : null
  return (
    <>
      {/* Hors du rail, première rangée du bureau ; le design system ne l'affiche que sous 768 px. */}
      <IconButton ref={tiroir.bouton} label={RAIL.menu} className="oto-rail-toggle" aria-expanded={tiroir.ouvert} aria-controls={idDuRail} onClick={tiroir.ouvrir}>
        <AnimatedIcon as={List} size="sm" />
      </IconButton>
      <Rail id={idDuRail} open={tiroir.ouvert} onClose={tiroir.fermer}>
        <EntrepriseDuRail entreprise={entreprise} adresses={adresses} administre={administre} organisations={organisations} />
        <RailScroll>
          {adresses.accueil !== undefined && (
            <RailItem as={LigneDuRail} href={adresses.accueil} label={RAIL.accueil} icon={<AnimatedIcon as={SquaresFour} size="xs" />} active={chemin === adresses.accueil} />
          )}
          <RechercheDuRail arbre={lu} handle={handle} adresses={adresses} administre={administre} />
          <ArbreDuRail arbre={arbre} equipes={equipes} handle={handle} prefixe={adresses.pages} enPanne={enPanne} />
        </RailScroll>
        <PiedDuRail compte={compte} adresses={adresses} administre={administre} />
      </Rail>
    </>
  )
}
