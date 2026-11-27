import { useId, type ComponentType, type ReactNode } from "react"
import type { Icon } from "@phosphor-icons/react"
// Une icône par import, depuis `ssr` : l'entrée principale lit un contexte React (interdit dans un
// Server Component), et le baril charge les 1 500 icônes à chaque import (40 s sous Vitest).
import { FileText } from "@phosphor-icons/react/dist/ssr/FileText"
import { Info } from "@phosphor-icons/react/dist/ssr/Info"
import { Play } from "@phosphor-icons/react/dist/ssr/Play"
import { Table } from "@phosphor-icons/react/dist/ssr/Table"
import { Skeleton } from "../ds/react/skeleton"
import { BrancheDArbre } from "./branche-d-arbre"
import { ARBRE_VIDE } from "./depuis-l-arbre"
import type { NatureDeNoeud, NoeudDArbre, ResultatDArbre, SectionDArbre } from "./types"

/** Ce que l'écran attend du lien de l'hôte : `next/link`, le `Link` d'un autre routeur, ou `"a"`. */
export type LienDeLHote = ComponentType<{
  href: string
  className?: string
  "aria-current"?: "page"
  children: ReactNode
}>

type NavigateurDArbreProps = {
  resultat: ResultatDArbre
  /** La navigation appartient à l'hôte : il dit où mène un nœud et avec quel composant. */
  hrefDuNoeud: (noeud: NoeudDArbre) => string
  Lien: LienDeLHote
  cheminActif?: string
  /**
   * Les sections d'équipes de l'écran de nœud (E05-S02, P39) : un intitulé par section, puis ses
   * nœuds, dans l'unique `<nav>` ; sans elles, les nœuds de `resultat` en une liste (E05-S01).
   */
  sections?: SectionDArbre[]
}

/** Les glyphes du rail (`coque/arbre-du-rail.tsx`), en `ssr` : une procédure porte `Play` (E05-S11, AC-35), un tableau `Table` (E11-S05, AC-h2). */
const GLYPHES: Record<NatureDeNoeud, Icon> = {
  page: FileText,
  tableau: Table,
  procedure: Play,
  contexte: Info,
}

const LIGNE =
  "flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"

function contientLActif(noeud: NoeudDArbre, cheminActif: string | undefined): boolean {
  return (noeud.enfants ?? []).some((e) => e.chemin === cheminActif || contientLActif(e, cheminActif))
}

type NoeudsProps = Omit<NavigateurDArbreProps, "resultat" | "sections"> & { noeuds: NoeudDArbre[] }

function Noeuds({ noeuds, hrefDuNoeud, Lien, cheminActif }: NoeudsProps) {
  return noeuds.map((noeud) => {
    const actif = noeud.chemin === cheminActif
    const Glyphe = GLYPHES[noeud.nature]
    const ligne = (
      <Lien
        href={hrefDuNoeud(noeud)}
        aria-current={actif ? "page" : undefined}
        className={actif ? `${LIGNE} bg-primary text-primary-on` : `${LIGNE} text-ink hover:bg-card`}
      >
        <Glyphe aria-hidden="true" className="size-4 shrink-0" />
        <span className="truncate">{noeud.titre}</span>
      </Lien>
    )

    if (!noeud.enfants?.length) {
      return (
        <li key={noeud.chemin} className="flex items-center gap-1">
          {/* Réserve la place de la bascule : les titres d'un même niveau restent alignés. */}
          <span aria-hidden="true" className="size-6 shrink-0" />
          {ligne}
        </li>
      )
    }

    return (
      <BrancheDArbre
        key={noeud.chemin}
        titre={noeud.titre}
        ligne={ligne}
        // Déplié quand l'écran ouvert est dessous : sinon l'utilisateur perd son repère.
        ouverteParDefaut={contientLActif(noeud, cheminActif)}
      >
        <Noeuds noeuds={noeud.enfants} hrefDuNoeud={hrefDuNoeud} Lien={Lien} cheminActif={cheminActif} />
      </BrancheDArbre>
    )
  })
}

/**
 * Les sections dans la même `<nav>` : l'intitulé nomme sa liste, qu'il n'ouvre ni ne relie. Ses `id`
 * partent de `useId` (servi aussi dans un Server Component) : deux navigateurs d'une même page ne se
 * les partagent pas.
 */
function Sections({ sections, ...navigation }: Omit<NoeudsProps, "noeuds"> & { sections: SectionDArbre[] }) {
  const base = useId()
  return sections.map((section, rang) => {
    const intitule = `${base}-section-${rang}`
    return (
      <div key={section.titre} className="pt-3 first:pt-0">
        <p id={intitule} className="oto-label px-2 pb-1">
          {section.titre}
        </p>
        <ul aria-labelledby={intitule}>
          <Noeuds noeuds={section.noeuds} {...navigation} />
        </ul>
      </div>
    )
  })
}

/**
 * Le navigateur d'arbre, porté de l'arbre du rail d'oto-frontend. Server Component : aucun routeur
 * importé, la navigation vient des props ; seule la bascule d'une branche est client.
 */
export function NavigateurDArbre({ resultat, sections, ...navigation }: NavigateurDArbreProps) {
  if (resultat.error !== undefined) {
    return (
      <p role="alert" className="text-sm text-ink">
        {resultat.error}
      </p>
    )
  }
  if (sections ? sections.length === 0 : resultat.data.length === 0) {
    return <p className="text-sm text-mute">{ARBRE_VIDE}</p>
  }
  return (
    <nav aria-label="Arbre des connaissances">
      {sections ? (
        <Sections sections={sections} {...navigation} />
      ) : (
        <ul>
          <Noeuds noeuds={resultat.data} {...navigation} />
        </ul>
      )}
    </nav>
  )
}

/** L'état de chargement, à passer en `fallback` du `<Suspense>` qui attend les données. */
export function NavigateurDArbreChargement() {
  return (
    <div role="status" aria-busy="true" className="space-y-2">
      <span className="sr-only">Chargement de l&apos;arbre…</span>
      {["66%", "50%", "60%"].map((largeur) => (
        <Skeleton key={largeur} shape="row" width={largeur} className="block" />
      ))}
    </div>
  )
}
