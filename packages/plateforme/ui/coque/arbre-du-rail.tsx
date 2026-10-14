"use client"

// Porté d'oto-frontend (src/components/coque/arbre-du-rail.tsx) : l'arbre servi traduit en arbre du
// design system — destination, glyphe de la nature, ligne courante, branche dépliée quand l'écran
// ouvert est dessous, « + » sur une page, un tableau ou une procédure — et l'hôte de chaque ligne, le lien
// de l'hôte ou rien à cliquer. Changé : l'arbre est celui de `visibleTree` rangé en sections
// (`sectionsDeLArbre`), l'adresse d'un nœud son chemin sous le préfixe des pages ; la ligne de Contexte est
// un nœud de genre `context` (P39). E05-S10 (partie b) : une procédure a son « + » (AC-b1) ; le clic sur le
// nom d'une branche la déplie (AC-b2, `use-depliage-du-rail.ts`) ; une ligne se glisse sur une autre, qui la
// reçoit (AC-b7, `deplacement-dans-le-rail.tsx`), ou se range avant ou après elle (AC-b9, partie b2). Retiré : exécutions, agents, ligne de reste, poignées
// d'écriture. E10-S01 (AC-a3, AC-b1) : un fichier lâché sur une ligne, distingué d'une ligne glissée par
// `dataTransfer.types` qui contient `Files`, ouvre le dialogue d'import sous elle (`DeposerSurLeRail`).
import { useContext, useState, type AnchorHTMLAttributes, type DragEvent, type MouseEvent } from "react"
import { FileText } from "@phosphor-icons/react/dist/csr/FileText"
import { Info } from "@phosphor-icons/react/dist/csr/Info"
import { Play } from "@phosphor-icons/react/dist/csr/Play"
import { Table } from "@phosphor-icons/react/dist/csr/Table"
import { titreDeContexte } from "../arbre/depuis-l-arbre"
import type { NatureDeNoeud, NoeudDArbre } from "../arbre/types"
import { AnimatedIcon, type Glyphe } from "../ds/react/icon"
import type { RailTreeNode } from "../ds/react/rail-tree"
import { useHote } from "../hote/navigation"
import { useGlisserDansLeRail, type GlisserDuRail } from "./deplacement-dans-le-rail"
import { aDesFichiers, DeposerSurLeRail } from "./import-de-fichier"
import type { Zone } from "./freres"
import { useDeplierAuClic, type DepliageDuRail } from "./use-depliage-du-rail"

/**
 * Le glyphe de chaque nature, décoratif (le nom est écrit à côté) ; le seul : l'arbre du rail, la palette, la
 * création et les écrans le lisent. Une procédure porte `Play` (E05-S11, retour 19, AC-35) ; un tableau, `Table`
 * (E11-S05, AC-h2).
 */
export const GLYPHES: Record<NatureDeNoeud, Glyphe> = { page: FileText, tableau: Table, procedure: Play, contexte: Info }

/** Un nom vide s'affiche « Sans titre » : un lien sans texte n'a rien à cliquer ni à annoncer. */
const libelle = (titre: string) => (titre.trim() === "" ? "Sans titre" : titre)

function porteLActif(noeud: RailTreeNode): boolean {
  return noeud.active === true || (noeud.children?.some(porteLActif) ?? false)
}

type Traduction = {
  prefixe: string
  chemin: string
  section: string
  /** Les branches ouvertes, tenues par le rail (AC-b2) ; sans elles, une branche s'ouvre au montage si l'écran ouvert est dessous. */
  depliage?: Pick<DepliageDuRail, "ouverts" | "basculer">
}

/**
 * L'arbre d'une section en lignes du design system. Une ligne de Contexte s'intitule « Contexte ·
 * <section> » (`titreDeContexte`, E05-S11, AC-18) ; chaque ligne, Contexte compris, porte le « + » qui crée
 * sous elle (AC-b1, fiche D110 a).
 */
export function versArbreDuRail(noeuds: readonly NoeudDArbre[], traduction: Traduction): RailTreeNode[] {
  return noeuds.map((noeud) => {
    const href = `${traduction.prefixe}${noeud.chemin}`
    const children = noeud.enfants?.length ? versArbreDuRail(noeud.enfants, traduction) : undefined
    const contexte = noeud.nature === "contexte"
    const { depliage } = traduction
    const ouverture = depliage
      ? { expanded: depliage.ouverts.has(noeud.chemin), onToggle: (ouvert: boolean) => depliage.basculer(noeud.chemin, ouvert) }
      : { defaultExpanded: children?.some(porteLActif) ?? false }
    return {
      id: noeud.chemin,
      label: contexte ? titreDeContexte(traduction.section) : libelle(noeud.titre),
      href,
      icon: <AnimatedIcon as={GLYPHES[noeud.nature]} size="xs" />,
      active: href === traduction.chemin,
      variant: contexte ? "context" : undefined,
      children,
      ...ouverture,
    }
  })
}

/** Le type du nœud glissé dans le transfert : Firefox ne commence aucun glisser sans donnée posée. */
const TYPE_DU_GLISSER = "application/x-oto-chemin"

/** La zone de la ligne sous le pointeur, de sa position dans la hauteur de la ligne. */
function zoneDuSurvol(glisser: GlisserDuRail, chemin: string, evenement: DragEvent<HTMLAnchorElement>): Zone {
  const cadre = evenement.currentTarget.getBoundingClientRect()
  return glisser.zoneDe(chemin, (evenement.clientY - cadre.top) / cadre.height)
}

/**
 * Les gestionnaires du glisser-déposer d'une ligne de l'arbre (AC-b7, AC-b9) : elle se glisse si son nœud
 * se déplace ; elle reçoit le nœud glissé dedans (son enfant), ou avant ou après elle (son frère), si le
 * service peut l'y ranger, et le dit : `data-depot` dedans, `data-rang` entre deux lignes.
 */
function useGlisserDeLaLigne(glisser: GlisserDuRail | null, chemin: string | null) {
  const [survol, setSurvol] = useState<Zone | null>(null)
  const deposer = useContext(DeposerSurLeRail)
  if (!glisser || chemin === null) return {}
  return {
    draggable: glisser.peutGlisser(chemin) || undefined,
    onDragStart: (evenement: DragEvent<HTMLAnchorElement>) => {
      if (!glisser.peutGlisser(chemin)) return
      evenement.dataTransfer?.setData(TYPE_DU_GLISSER, chemin)
      if (evenement.dataTransfer) evenement.dataTransfer.effectAllowed = "move"
      glisser.commencer(chemin)
    },
    onDragEnd: () => glisser.finir(),
    onDragOver: (evenement: DragEvent<HTMLAnchorElement>) => {
      if (deposer && aDesFichiers(evenement)) {
        evenement.preventDefault()
        return setSurvol("dans")
      }
      const zone = zoneDuSurvol(glisser, chemin, evenement)
      if (!glisser.accepte(chemin, zone)) return setSurvol(null)
      evenement.preventDefault()
      if (evenement.dataTransfer) evenement.dataTransfer.dropEffect = "move"
      setSurvol(zone)
    },
    onDragLeave: () => setSurvol(null),
    onDrop: (evenement: DragEvent<HTMLAnchorElement>) => {
      setSurvol(null)
      const fichier = evenement.dataTransfer?.files?.[0]
      if (deposer && fichier) {
        evenement.preventDefault()
        return deposer(chemin, fichier)
      }
      const zone = zoneDuSurvol(glisser, chemin, evenement)
      if (!glisser.accepte(chemin, zone)) return
      evenement.preventDefault()
      glisser.deposer(chemin, zone)
    },
    "data-depot": survol === "dans" ? "" : undefined,
    "data-rang": survol === "avant" || survol === "apres" ? survol : undefined,
  }
}

/**
 * L'hôte de chaque ligne : le lien de l'hôte (navigation sans rechargement), ou un `<span>` sans
 * destination — une ancre sans adresse serait annoncée comme un lien mort. Dans l'arbre, le clic déplie
 * aussi la branche de la ligne (AC-b2), et la ligne se glisse-dépose (AC-b7).
 */
export function LigneDuRail({ href, onClick, className, ...reste }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const { Lien } = useHote()
  const deplier = useDeplierAuClic()
  const glisser = useGlisserDansLeRail()
  const chemin = href === undefined ? null : (glisser?.cheminDe(href) ?? null)
  const gestes = useGlisserDeLaLigne(glisser, chemin)
  if (href === undefined) return <span className={className} {...reste} />
  const surClic = (evenement: MouseEvent<HTMLAnchorElement>) => {
    deplier?.(href)
    onClick?.(evenement)
  }
  // Le repère d'un dépôt, dedans (`data-depot`) ou entre deux lignes (`data-rang`, une barre droite), vient du design system (`product.css`).
  return <Lien href={href} className={className} {...reste} {...gestes} onClick={surClic} />
}
