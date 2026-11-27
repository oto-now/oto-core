"use client"

// Porté d'oto-frontend (src/design-system/components/react/navigation.jsx, `Breadcrumb`) : le fil d'Oto,
// où chaque maillon est un sélecteur qui ouvre la liste de ses FRÈRES (un `DropdownMenu`), ou, sans frères
// et avec une adresse, un lien qui remonte (`as`, le lien d'un routeur) ; le maillon courant porte
// `aria-current="page"`, le dernier à défaut ; un maillon sans l'un ni l'autre reste affiché, un fil à trous
// ne dit plus où l'on est. Troncature par le milieu : la racine et la feuille restent, le milieu se replie
// derrière « … » quand un libellé est rogné (mesuré après le rendu) ; le plancher est le CSS (`nowrap`,
// l'ordre de rétrécissement). En TypeScript. Changé : ce maillon est un texte, plus un bouton inerte (M31) ; le
// séparateur est « › », celui de la maquette de la refonte (#216), au lieu de « / ».
import { useEffect, useRef, useState, type ComponentProps, type ElementType, type ReactNode } from "react"
import { useIsoLayoutEffect } from "./hooks"
import { DropdownMenu, type MenuItem } from "./overlays"

export type Maillon = {
  id?: string
  label: string
  icon?: ReactNode
  /** Le maillon courant ; sans lui, le dernier l'est. */
  current?: boolean
  /** Les frères du maillon, ouverts à son clic. */
  menu?: MenuItem[]
  /** Sans frères, le maillon remonte : `href`, ou `to` pour un routeur qui le demande, rendu par `as`. */
  href?: string
  to?: string
  as?: ElementType
}

type Replie = { replie: true }

type BreadcrumbProps = Omit<ComponentProps<"nav">, "children"> & {
  items: Maillon[]
  /** Le nombre de maillons au-delà duquel le milieu se replie, quelle que soit la place. */
  max?: number
  label?: string
  /** Le lien des maillons qui remontent, sauf le leur (`as` d'un maillon). */
  as?: ElementType
}

/** Combien de maillons du milieu sont repliés : le plus grand de ce qu'impose le nombre et de ce qu'impose la place, jamais la racine, N-1 ni N0. */
function maillonsReplies(total: number, max: number, serres: number): number {
  const repliables = Math.max(0, total - 3)
  const parLeNombre = total > max ? total - max + 1 : 0
  return Math.min(repliables, Math.max(parLeNombre, serres))
}

type MaillonRenduProps = { item: Maillon; dernier: boolean; hoteParDefaut: ElementType | undefined }

function MaillonRendu({ item, dernier, hoteParDefaut }: MaillonRenduProps) {
  const courant = item.current ?? dernier
  // Le libellé dans son élément : `text-overflow` n'ellipse que du contenu en ligne d'un bloc.
  const contenu = (
    <>
      {item.icon}
      <span className="oto-breadcrumb-label">{item.label}</span>
    </>
  )
  if (item.menu?.length) {
    const crumb = (
      <button type="button" className="oto-breadcrumb-item" aria-current={courant ? "page" : undefined}>
        {contenu}
      </button>
    )
    return <DropdownMenu trigger={crumb} items={item.menu} align="start" />
  }
  // Ni frères ni adresse : un texte, pas un bouton qui ne ferait rien (M31).
  if (item.href == null && item.to == null) {
    return (
      <span className="oto-breadcrumb-item" aria-current={courant ? "page" : undefined}>
        {contenu}
      </span>
    )
  }
  const Hote = item.as ?? hoteParDefaut ?? "a"
  const adresse = Hote === "a" ? { href: item.href } : { to: item.to, href: item.href }
  return (
    <Hote className="oto-breadcrumb-item" aria-current={courant ? "page" : undefined} {...adresse}>
      {contenu}
    </Hote>
  )
}

export function Breadcrumb({ items, max = 4, label = "Chemin", as: hoteParDefaut, className, ...rest }: BreadcrumbProps) {
  const [expanded, setExpanded] = useState(false)
  const liste = useRef<HTMLOListElement>(null)
  // Ce que la PLACE oblige à replier, en plus de ce que `max` impose.
  const [serres, setSerres] = useState(0)
  // Le fil réduit à ce qui change sa largeur : `items` est un tableau neuf à chaque rendu du parent.
  const signature = items.map((item) => item.label).join(" ")

  // Toute mesure repart de zéro quand le fil ou la place change : sinon le « … » deviendrait définitif.
  useIsoLayoutEffect(() => {
    setSerres(0)
  }, [signature, max])

  useEffect(() => {
    const ol = liste.current
    if (!ol || typeof ResizeObserver === "undefined") return undefined
    const observateur = new ResizeObserver(() => setSerres(0))
    observateur.observe(ol)
    return () => observateur.disconnect()
  }, [])

  // Après chaque rendu, un maillon de plus se replie tant qu'un libellé est rogné ; au repos, rien ne bouge.
  useIsoLayoutEffect(() => {
    const ol = liste.current
    if (!ol) return
    const rogne = [...ol.querySelectorAll(".oto-breadcrumb-label")].some((libelle) => libelle.scrollWidth > libelle.clientWidth + 1)
    if (rogne && serres < Math.max(0, items.length - 3)) setSerres(serres + 1)
  })

  const caches = maillonsReplies(items.length, max, serres)
  const montres: (Maillon | Replie)[] = !expanded && caches > 0 ? [items[0], { replie: true }, ...items.slice(1 + caches)] : items

  return (
    <nav aria-label={label} className={className} {...rest}>
      <ol className="oto-breadcrumb" ref={liste}>
        {montres.map((item, rang) => {
          const dernier = rang === montres.length - 1
          return (
            <li key={"replie" in item ? "replie" : (item.id ?? rang)}>
              {"replie" in item ? (
                <button type="button" className="oto-breadcrumb-more" aria-label={`Afficher les ${caches} niveaux masqués`} onClick={() => setExpanded(true)}>
                  …
                </button>
              ) : (
                <MaillonRendu item={item} dernier={dernier} hoteParDefaut={hoteParDefaut} />
              )}
              {!dernier && (
                <span className="oto-breadcrumb-sep" aria-hidden="true">
                  ›
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
