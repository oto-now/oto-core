// La liste des versions d'un objet et l'écart d'une version, que le design system n'avait pas (tiroir « Historique des
// versions » de la maquette de la refonte) : `HistoryList` (une liste ordonnée nommée), `HistoryItem` (une version, le
// bouton entier qui la choisit, son détail ouvert sous elle quand elle est choisie, marquée par `aria-current` et un
// filet d'encre, jamais par la couleur seule) et `DiffLine` (un texte retiré ou ajouté : son mot, « Supprimé » ou
// « Ajouté », en pastille, puis le texte barré ou souligné sur une teinte d'état). Des classes et des attributs, le CSS
// fait le reste (`history.css`). Sans eux, l'écran dessinerait sa liste et son écart à la main.
import type { ComponentProps, ReactNode } from "react"
import { Badge } from "./primitives"
import { cx } from "./outils"

export function HistoryList({ className, children, ...rest }: ComponentProps<"ol">) {
  return (
    <ol {...rest} className={cx("oto-history", className)}>
      {children}
    </ol>
  )
}

type HistoryItemProps = Omit<ComponentProps<"li">, "title" | "onSelect"> & {
  lead?: ReactNode
  /** Qui, à gauche de la ligne de tête. */
  title: ReactNode
  /** Quand, au bout de la ligne de tête. */
  meta?: ReactNode
  /** La ligne sous la tête : ce que la version a changé. */
  description?: ReactNode
  selected?: boolean
  onSelect?: () => void
  /** Le détail, montré sous la version choisie seulement. */
  children?: ReactNode
}

export function HistoryItem({ lead, title, meta, description, selected = false, onSelect, className, children, ...rest }: HistoryItemProps) {
  return (
    <li {...rest} className={cx("oto-history-item", className)} data-selected={selected ? "" : undefined}>
      <button type="button" className="oto-history-head" aria-current={selected || undefined} aria-expanded={selected} onClick={onSelect}>
        {lead && <span className="oto-history-lead">{lead}</span>}
        <span className="oto-history-text">
          <span className="oto-history-top">
            <span className="oto-history-title">{title}</span>
            {meta && <span className="oto-history-meta">{meta}</span>}
          </span>
          {description && <span className="oto-history-desc">{description}</span>}
        </span>
      </button>
      {selected && children && <div className="oto-history-detail">{children}</div>}
    </li>
  )
}

type DiffLineProps = Omit<ComponentProps<"p">, "children"> & { change: "added" | "deleted"; label: string; children: ReactNode }

/** Un texte retiré (`deleted`, barré) ou ajouté (`added`) : le mot dit le sens, la teinte le redit. */
export function DiffLine({ change, label, className, children, ...rest }: DiffLineProps) {
  const Texte = change === "added" ? "ins" : "del"
  return (
    <p {...rest} className={cx("oto-diff-line", className)} data-change={change}>
      <Badge tone={change === "added" ? "ok" : "fail"}>{label}</Badge>
      <Texte className="oto-diff-text">{children}</Texte>
    </p>
  )
}

/** Le cadre d'un écart : les lignes retirées et ajoutées d'un bloc, sur le fond de l'îlot. */
export function Diff({ className, children, ...rest }: ComponentProps<"div">) {
  return (
    <div {...rest} className={cx("oto-diff", className)}>
      {children}
    </div>
  )
}
