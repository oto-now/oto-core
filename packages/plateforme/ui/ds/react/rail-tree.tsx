"use client"

// Porté d'oto-frontend (src/design-system/components/react/rail.jsx, `RailTree`) : l'arborescence d'un
// espace en liste imbriquée de liens (une navigation, pas un treeview) ; la bascule de dépliage, le
// « ⋯ » et le « + » sont les FRÈRES du lien dans la rangée, jamais dedans ; l'hôte des lignes (`as`)
// descend à toutes les profondeurs, comme `addItems` et `moreItems`. Tels quels, en TypeScript.
// Changé : la destination d'une ligne est `href` (le lien de l'hôte, portage-ecrans.md § 1).
import { useId, type ComponentProps, type ElementType, type ReactNode } from "react"
import { CaretRight } from "@phosphor-icons/react/dist/csr/CaretRight"
import { DotsThree } from "@phosphor-icons/react/dist/csr/DotsThree"
import { Plus } from "@phosphor-icons/react/dist/csr/Plus"
import { useControllable } from "./hooks"
import { AnimatedIcon, Icon } from "./icon"
import { RailItem } from "./layout"
import { cx } from "./outils"
import { DropdownMenu, type MenuItem } from "./overlays"
import { Badge } from "./primitives"
import { menuDeCreation } from "./rail"

export type RailTreeNode = {
  id: string
  label: string
  /** La destination ; sans elle, l'hôte rend une ligne sans lien. */
  href?: string
  icon?: ReactNode
  badge?: ReactNode
  active?: boolean
  variant?: "context"
  children?: RailTreeNode[]
  expanded?: boolean
  defaultExpanded?: boolean
  onToggle?: (ouvert: boolean) => void
  /** `false` retire le « + » de la ligne, quels que soient les items. */
  addable?: boolean
}

type Gestes = {
  addItems?: (node: RailTreeNode) => MenuItem[] | undefined
  moreItems?: (node: RailTreeNode) => MenuItem[] | undefined
  as?: ElementType
}

type RailTreeProps = Omit<ComponentProps<"ul">, "children"> & Gestes & { nodes: RailTreeNode[] }

export function RailTree({ nodes, addItems, moreItems, as, className, ...rest }: RailTreeProps) {
  return (
    <ul {...rest} className={cx("oto-rail-tree", className)}>
      {nodes.map((node) => (
        <RailTreeNodeRow key={node.id} node={node} addItems={addItems} moreItems={moreItems} as={as} />
      ))}
    </ul>
  )
}

/** « ⋯ » puis « + », posés APRÈS le lien et superposés à sa fin par le CSS, révélés au survol et au focus. */
function ActionsDeLaRangee({ node, addItems, moreItems }: Omit<Gestes, "as"> & { node: RailTreeNode }) {
  const items = node.addable === false ? undefined : addItems?.(node)
  const autres = moreItems?.(node)
  if (!items?.length && !autres?.length) return null
  return (
    <span className="oto-rail-actions">
      {autres?.length ? (
        <DropdownMenu
          align="start"
          items={autres}
          trigger={
            <button type="button" className="oto-rail-more" aria-label={`Autres actions sur ${node.label}`}>
              <AnimatedIcon as={DotsThree} anim="pulse" size="xs" />
            </button>
          }
        />
      ) : null}
      {items?.length ? (
        <DropdownMenu
          items={menuDeCreation(items, node.label)}
          trigger={
            <button type="button" className="oto-rail-add" aria-label={`Ajouter dans ${node.label}`}>
              <AnimatedIcon as={Plus} anim="pop" size="xs" />
            </button>
          }
        />
      ) : null}
    </span>
  )
}

function RailTreeNodeRow({ node, addItems, moreItems, as }: Gestes & { node: RailTreeNode }) {
  const branche = Boolean(node.children?.length)
  const [ouvert, setOuvert] = useControllable(node.expanded, node.defaultExpanded ?? false, node.onToggle)
  const idEnfants = useId()

  const contenu = (
    <>
      {branche && (
        <button type="button" className="oto-rail-branch" aria-expanded={ouvert} aria-controls={idEnfants} aria-label={`${ouvert ? "Replier" : "Déplier"} ${node.label}`} onClick={() => setOuvert(!ouvert)}>
          <Icon as={CaretRight} size="xs" className="oto-rail-chevron" />
        </button>
      )}
      <RailItem
        as={as}
        href={node.href}
        label={node.label}
        active={node.active}
        variant={node.variant}
        icon={node.icon}
        end={
          node.badge != null && (
            <Badge tone="review" count>
              {node.badge}
            </Badge>
          )
        }
      />
      <ActionsDeLaRangee node={node} addItems={addItems} moreItems={moreItems} />
    </>
  )

  // Une feuille n'a pas de rangée à part : le `<li>` EST la rangée.
  if (!branche) return <li className="oto-rail-row">{contenu}</li>
  return (
    <li>
      <div className="oto-rail-row" data-branch="" data-expanded={ouvert ? "" : undefined}>
        {contenu}
      </div>
      {/* `hidden` plutôt qu'un démontage : `aria-controls` désigne un élément qui existe même replié. */}
      <ul className="oto-rail-tree" id={idEnfants} hidden={!ouvert}>
        {(node.children ?? []).map((enfant) => (
          <RailTreeNodeRow key={enfant.id} node={enfant} addItems={addItems} moreItems={moreItems} as={as} />
        ))}
      </ul>
    </li>
  )
}
