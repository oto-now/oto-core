"use client"

// Les plis d'une page lue : le menu dépliant (bloc `toggle`, `DepliantLu`), replié à l'arrivée, et la section de chaque
// titre (`SectionRepliable`, `ChevronDeSection`), ouverte à l'arrivée ; au dessin de Notion, chevron à gauche, sans fond
// ni filet. Le geste de la personne est gardé dans ce navigateur (`plis-gardes.ts`) ; une ancre qui vise un bloc replié
// l'ouvre. Ils reçoivent leur contenu déjà rendu par le serveur (`portage-ecrans.md § 2`). Sans eux, une page
// lue ne replie rien, ou replie sans se souvenir de ce qu'on a ouvert.
import { createContext, useCallback, useContext, useId, useMemo, useRef, type ReactNode } from "react"
import { CaretRight } from "@phosphor-icons/react/dist/csr/CaretRight"
import { Icon } from "../ds/react/icon"
import { IconButton } from "../ds/react/primitives"
import { PLIS } from "./libelles"
import { useOuvertParLAncre, usePliGarde } from "./plis-gardes"

/** Le chevron d'un pli, tourné vers le bas quand le pli est ouvert (`content.css`, `.oto-pli-chevron`). */
export function GlypheDuPli() {
  return <Icon as={CaretRight} size="xs" className="oto-pli-chevron" />
}

/** Le bouton d'un pli, nommé par ce qu'il fera : un titre dans l'éditeur ou à la lecture. */
export function BoutonDuPli({ ouvert, nom, controle, basculer }: { ouvert: boolean; nom: string; controle?: string; basculer: () => void }) {
  return (
    <IconButton size="sm" className="oto-pli-bouton" label={PLIS.section(ouvert, nom)} aria-expanded={ouvert} aria-controls={controle} onClick={basculer}>
      <GlypheDuPli />
    </IconButton>
  )
}

type DepliantLuProps = { id?: string; ancre?: string; resume: ReactNode; children: ReactNode; className?: string }

/** Un menu dépliant lu : `<details>` natif (clavier et annonce du navigateur), son état gardé dans ce navigateur. */
export function DepliantLu({ id, ancre, resume, children, className }: DepliantLuProps) {
  const [ouvert, changer] = usePliGarde(id, false)
  const zone = useRef<HTMLDetailsElement>(null)
  const ouvrir = useCallback(() => changer(true), [changer])
  useOuvertParLAncre(zone, ouvrir)
  return (
    <details
      ref={zone}
      id={ancre}
      className={`oto-depliant ${className ?? ""}`.trim()}
      open={ouvert}
      // Le navigateur a ouvert ou fermé le pli (clic, clavier) : l'état le suit ; un état déjà posé ne s'écrit pas deux fois.
      onToggle={(evenement) => evenement.currentTarget.open !== ouvert && changer(evenement.currentTarget.open)}
    >
      <summary>
        <GlypheDuPli />
        <span className="oto-depliant-resume">{resume}</span>
      </summary>
      <div className="oto-depliant-corps">{children}</div>
    </details>
  )
}

type Pli = { ouvert: boolean; basculer: () => void; corps: string }

const ContexteDuPli = createContext<Pli | null>(null)

/**
 * La section d'un titre lu : le titre (rendu par le serveur, son `ChevronDeSection` dedans), puis les blocs de sa
 * section, cachés quand la personne la replie.
 */
export function SectionRepliable({ id, titre, children }: { id?: string; titre: ReactNode; children: ReactNode }) {
  const [ouvert, changer] = usePliGarde(id, true)
  const corps = useId()
  const zone = useRef<HTMLDivElement>(null)
  const ouvrir = useCallback(() => changer(true), [changer])
  useOuvertParLAncre(zone, ouvrir)
  const pli = useMemo(() => ({ ouvert, basculer: () => changer(!ouvert), corps }), [ouvert, changer, corps])
  return (
    <ContexteDuPli.Provider value={pli}>
      {titre}
      <div ref={zone} id={corps} className="oto-section-repliable" hidden={!ouvert}>
        {children}
      </div>
    </ContexteDuPli.Provider>
  )
}

/** Le chevron d'un titre lu, dans son titre ; hors d'une `SectionRepliable` (widget, visionneuse), rien. */
export function ChevronDeSection({ nom }: { nom: string }) {
  const pli = useContext(ContexteDuPli)
  if (!pli) return null
  return <BoutonDuPli ouvert={pli.ouvert} nom={nom} controle={pli.corps} basculer={pli.basculer} />
}
