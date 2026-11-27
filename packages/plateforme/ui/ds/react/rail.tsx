"use client"

// Porté d'oto-frontend (src/design-system/components/react/rail.jsx) : `RailSection`, `RailSearch`,
// `RailAccount`, `RailThemePicker` — le titre d'un espace et son « + », le déclencheur de la recherche
// (clic ou ⌘K), la ligne de compte et son menu, les huit teintes ; des classes, des attributs et le
// clavier, le CSS d'`ui/ds/app/islands.css` fait le reste. Tels quels, en TypeScript. Changé : glyphes
// Phosphor ; les huit thèmes viennent de `schemas/brand.ts`. `RailTree` vit à côté (`rail-tree.tsx`). #221 : le menu du
// compte s'ouvre sur la personne (avatar, nom, email) et son déclencheur porte un chevron vers le haut, là où il s'ouvre.
import { useEffect, useRef, type ComponentProps, type ElementType, type ReactNode } from "react"
import { CaretRight } from "@phosphor-icons/react/dist/csr/CaretRight"
import { CaretUp } from "@phosphor-icons/react/dist/csr/CaretUp"
import { CaretUpDown } from "@phosphor-icons/react/dist/csr/CaretUpDown"
import { MagnifyingGlass } from "@phosphor-icons/react/dist/csr/MagnifyingGlass"
import { Plus } from "@phosphor-icons/react/dist/csr/Plus"
import { OTO_THEMES, THEME_LABELS, type Theme } from "../../../schemas/brand"
import { AnimatedIcon, Icon } from "./icon"
import { RailItem } from "./layout"
import { cx } from "./outils"
import { DropdownMenu, type MenuItem } from "./overlays"
import { Avatar, IconButton, Kbd } from "./primitives"

/** Le menu de création coiffé de sa destination : « Dans <l'espace> ». */
export function menuDeCreation(items: MenuItem[], ou: string): MenuItem[] {
  return [{ group: `Dans ${ou}` }, ...items]
}

type RailSectionProps = Omit<ComponentProps<"div">, "onToggle"> & {
  label: string
  addLabel?: string
  /** Les items du « + » ; sans eux, pas de « + ». */
  addItems?: MenuItem[]
  /** L'hôte du titre quand il ouvre la section ; sans `to`, le titre est un `<p>`. */
  as?: ElementType
  to?: string
  expanded?: boolean
  /** Le pli ; sans lui, aucune bascule. */
  onToggle?: (ouvert: boolean) => void
  /** L'identifiant de ce que le pli cache (l'arbre rendu à côté). */
  controls?: string
  end?: ReactNode
}

/**
 * Le titre d'un espace, son pli et son « + » visible au repos. E05-S13 (AC-12, HN-E05S13-9) : sans `to`, le titre
 * plie la section comme le chevron, dans un seul bouton (chevron et titre, nom « Replier <titre> ») ; avec `to`, le
 * titre garde son lien et le chevron reste le seul pli.
 */
export function RailSection({ label, addLabel, addItems, as, to, expanded, onToggle, controls, end, className, ...rest }: RailSectionProps) {
  const ouvert = expanded !== false
  const pli = onToggle
    ? { "aria-expanded": ouvert, "aria-controls": controls, "aria-label": `${ouvert ? "Replier" : "Déplier"} ${label}`, onClick: () => onToggle(!ouvert) }
    : null
  const bouton = (
    <IconButton label={addLabel ?? `Créer dans ${label}`} size="sm">
      <AnimatedIcon as={Plus} anim="pop" size="xs" />
    </IconButton>
  )
  const Titre: ElementType = to == null ? "p" : (as ?? "a")
  // Le lien de l'hôte prend `href` (portage-ecrans.md § 1), comme une ancre.
  const destination = to == null ? {} : { href: to }
  const titre =
    pli && to == null ? (
      // Le titre qui plie : les égards d'un titre-lien (`data-link` : curseur, éclaircissement, anneau), le chevron
      // dedans, tourné quand la section est ouverte.
      // `me-1` et non `gap-1` : sous 768 px, le tiroir rend `.oto-rail-group` en bloc, où un écart de flex ne vaut rien.
      <button type="button" {...pli} className="oto-rail-group flex items-center border-0 bg-transparent text-start" data-link="">
        <Icon as={CaretRight} size="xs" className={cx("me-1 shrink-0 transition-transform", ouvert && "rotate-90")} />
        <span className="min-w-0 truncate">{label}</span>
      </button>
    ) : (
      <>
        {pli && (
          <button type="button" className="oto-rail-branch" {...pli}>
            <Icon as={CaretRight} size="xs" className="oto-rail-chevron" />
          </button>
        )}
        <Titre {...destination} className="oto-rail-group" data-link={to == null ? undefined : ""}>
          {label}
        </Titre>
      </>
    )
  return (
    <div {...rest} className={cx("oto-rail-section", className)} data-expanded={pli && ouvert ? "" : undefined}>
      {titre}
      {end}
      {addItems?.length ? <DropdownMenu trigger={bouton} items={menuDeCreation(addItems, label)} /> : null}
    </div>
  )
}

type RailSearchProps = Omit<ComponentProps<"label">, "onSelect"> & { label?: string; placeholder?: string; shortcut?: string; onOpen?: () => void }

/** Le déclencheur de la recherche : un champ en lecture seule, le clic, Entrée ou ⌘K (sur toute la fenêtre) ouvrent. */
export function RailSearch({ label = "Rechercher", placeholder = "Rechercher", shortcut = "⌘K", onOpen, className, ...rest }: RailSearchProps) {
  const ouvrir = useRef(onOpen)
  useEffect(() => {
    ouvrir.current = onOpen
  }, [onOpen])

  useEffect(() => {
    const surTouche = (evenement: KeyboardEvent) => {
      if ((evenement.metaKey || evenement.ctrlKey) && evenement.key.toLowerCase() === "k") {
        evenement.preventDefault()
        ouvrir.current?.()
      }
    }
    window.addEventListener("keydown", surTouche)
    return () => window.removeEventListener("keydown", surTouche)
  }, [])

  return (
    <label {...rest} className={cx("oto-rail-search", className)}>
      <AnimatedIcon as={MagnifyingGlass} anim="magnify" size="xs" />
      <input
        type="search"
        readOnly
        placeholder={placeholder}
        aria-label={label}
        onClick={() => onOpen?.()}
        onKeyDown={(evenement) => {
          if (evenement.key !== "Enter" && evenement.key !== " ") return
          evenement.preventDefault()
          onOpen?.()
        }}
      />
      {shortcut && <Kbd>{shortcut}</Kbd>}
    </label>
  )
}

/** La ligne de compte du pied : elle ouvre au-dessus d'elle le menu de la personne, coiffé de son avatar, son nom et son `email`. */
export function RailAccount({ name, email, avatarSrc, items }: { name: string; email?: string | null; avatarSrc?: string | null; items: MenuItem[] }) {
  return (
    <DropdownMenu
      side="top"
      align="start"
      head={
        <>
          <Avatar name={name} src={avatarSrc} size="lg" self aria-hidden="true" />
          <span className="oto-menu-head-text">
            <span className="oto-menu-head-name">{name}</span>
            {email ? <span className="oto-menu-head-meta">{email}</span> : null}
          </span>
        </>
      }
      trigger={
        <RailItem
          as="button"
          variant="account"
          label={name}
          aria-label={`Compte : ${name}. Ouvrir le menu`}
          icon={<Avatar name={name} src={avatarSrc} size="sm" self />}
          end={<AnimatedIcon as={CaretUp} size="xs" />}
        />
      }
      items={items}
    />
  )
}

/**
 * Les huit teintes, depuis le pied du rail : chaque pastille porte sa propre portée (`.oto` +
 * `data-oto-theme`), aucune couleur n'est choisie en JS ; la ligne ne se montre qu'au survol du pied
 * et au focus clavier.
 */
export function RailThemePicker({ value, onChange, label = "Couleur" }: { value: Theme; onChange: (theme: Theme) => void; label?: string }) {
  return (
    <DropdownMenu
      side="top"
      align="start"
      trigger={
        <RailItem
          as="button"
          variant="skin"
          label={label}
          aria-label={`${label} du thème`}
          icon={<span className="oto-rail-dot" aria-hidden="true" />}
          end={<AnimatedIcon as={CaretUpDown} anim="pop" size="xs" />}
        />
      }
      items={OTO_THEMES.map((theme) => ({
        label: THEME_LABELS[theme][0],
        radio: true,
        checked: value === theme,
        icon: <span className="oto oto-menu-dot" data-oto-theme={theme} aria-hidden="true" />,
        onSelect: () => onChange(theme),
      }))}
    />
  )
}
