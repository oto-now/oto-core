"use client"

// Porté d'oto-frontend (src/design-system/components/react/overlays.jsx, `Anchor`) : le déclencheur est
// l'ancre, jamais une enveloppe en `display: contents`, que rien ne mesure ; sa ref est fusionnée, ses
// gestionnaires chaînés avant ceux du flottant ; un texte ou un fragment reçoit une boîte réelle. Tel quel,
// en TypeScript, pour `DropdownMenu` (`overlays.tsx`), `Popover` et `Tooltip`.
import { cloneElement, forwardRef, isValidElement, use, type ReactElement, type ReactNode, type Ref } from "react"
import { mergeRefs } from "./outils"

type Proprietes = Record<string, unknown>

/** Un élément qui peut porter une ref et des gestionnaires : ni un fragment ni un autre type interne de React. */
function peutPorterUneAncre(element: ReactNode): element is ReactElement<Proprietes & { ref?: Ref<HTMLElement> }> {
  return isValidElement(element) && typeof element.type !== "symbol"
}

const REACT_LAZY_TYPE = Symbol.for("react.lazy")

/** Un nœud paresseux dont la charge se lit par `use` : l'enveloppe du client Flight autour d'un élément en attente. */
function estUneEnveloppeDeFlight(enfant: ReactNode): enfant is ReactNode & { _payload: PromiseLike<ReactNode> } {
  if (typeof enfant !== "object" || enfant === null || !("$$typeof" in enfant) || enfant.$$typeof !== REACT_LAZY_TYPE) return false
  const charge: unknown = "_payload" in enfant ? enfant._payload : null
  return typeof charge === "object" && charge !== null && "then" in charge && typeof charge.then === "function"
}

/**
 * Le déclencheur tel que le client le recevra. Venu d'un Server Component, il arrive au rendu serveur, en
 * développement, sous l'enveloppe paresseuse du client Flight (`createLazyChunkWrapper` de
 * `react-server-dom-webpack/client`) tant qu'une de ses références (propriétaire, pile) n'est pas arrivée, alors que le
 * navigateur, qui a tout le flux, reçoit l'élément : sans cette lecture, le serveur rend l'enveloppe de repli et le
 * client clone l'élément, et l'hydratation échoue.
 */
function useDeclencheur(enfant: ReactNode): ReactNode {
  return estUneEnveloppeDeFlight(enfant) ? use(enfant._payload) : enfant
}

/** Le gestionnaire du déclencheur d'abord, le nôtre ensuite ; une valeur qui n'est pas une fonction remplace. */
function enchainer(leur: unknown, notre: unknown): unknown {
  if (typeof notre !== "function" || typeof leur !== "function") return notre
  return (...args: unknown[]) => {
    leur(...args)
    return notre(...args)
  }
}

/** Ce qu'un flottant pose sur son déclencheur : le popover l'ouvre au clic, l'infobulle au survol et au focus. */
type AncreProps = {
  children: ReactNode
  onClick?: () => void
  onKeyDown?: (evenement: { key: string; preventDefault: () => void }) => void
  onMouseEnter?: () => void
  onMouseLeave?: () => void
  onFocus?: () => void
  onBlur?: () => void
  "aria-expanded"?: boolean
  "aria-haspopup"?: "menu" | "dialog"
  "aria-controls"?: string
  "aria-describedby"?: string
}

export const Anchor = forwardRef<HTMLElement, AncreProps>(function Anchor({ children: recu, ...propres }, ref) {
  const children = useDeclencheur(recu)
  if (peutPorterUneAncre(children)) {
    const suivantes: Proprietes = { ref: mergeRefs(children.props.ref, ref) }
    for (const [cle, valeur] of Object.entries(propres)) {
      // Une valeur absente (`aria-controls` fermé) n'efface pas celle du déclencheur.
      if (valeur !== undefined) suivantes[cle] = enchainer(children.props[cle], valeur)
    }
    return cloneElement(children, suivantes)
  }
  return (
    <span ref={ref} style={{ display: "inline-flex" }} {...propres}>
      {children}
    </span>
  )
})
