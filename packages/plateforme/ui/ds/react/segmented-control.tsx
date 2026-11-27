"use client"

// Porté d'oto-frontend (src/design-system/components/react/navigation.jsx, `SegmentedControl`) : il FILTRE,
// un choix parmi n (`role="radiogroup"`, les flèches le parcourent) ; le curseur est UN élément qu'on
// déplace, mesuré après le rendu et posé en variables CSS. Tel quel, en TypeScript. Changé : `chain` et
// `useRefList` (`hooks.js` d'oto-frontend) vivent ici, `hooks.ts` ne les porte pas ; le curseur n'a pas de
// mesure avant la première (le serveur n'en a pas), et le CSS pose alors la pilule sur le segment coché ;
// l'observateur de taille est gardé par `typeof ResizeObserver`, comme dans le fil d'Ariane. Ajouté (refonte #216) : la
// variante `neutral`, le segment coché sur `--hair` à l'encre, et la mesure qui lit le segment coché courant.
import { useEffect, useRef, useState, type ComponentProps, type CSSProperties, type KeyboardEvent, type ReactNode } from "react"
import { useControllable, useIsoLayoutEffect } from "./hooks"
import { cx } from "./outils"

export type Segment = { value: string; label: ReactNode; icon?: ReactNode; disabled?: boolean }

type SegmentedControlProps = Omit<ComponentProps<"div">, "onChange" | "defaultValue"> & {
  options: Segment[]
  value?: string
  defaultValue?: string
  onChange?: (valeur: string) => void
  size?: "lg"
  block?: boolean
  label?: string
  /** `neutral` : le segment coché sur `--hair`, à l'encre, sans l'accent du thème (la portée d'un historique, qui ne filtre pas un écran). */
  variant?: "neutral"
}

/** Une ref par élément d'une liste rendue. */
function useRefList<T>() {
  const ref = useRef<(T | null)[]>([])
  const set = (rang: number) => (element: T | null) => {
    ref.current[rang] = element
  }
  return { list: ref, set }
}

/** Le gestionnaire du consommateur d'abord, le nôtre ensuite : un `onKeyDown` étalé ne remplace plus les flèches promises. */
function chain<E>(leur: ((evenement: E) => void) | undefined, notre: (evenement: E) => void) {
  return typeof leur === "function"
    ? (evenement: E) => {
        leur(evenement)
        notre(evenement)
      }
    : notre
}

export function SegmentedControl({ options, value, defaultValue, onChange, size, block, label, variant, className, ...rest }: SegmentedControlProps) {
  const [active, setActive] = useControllable(value, defaultValue ?? options[0]?.value ?? "", onChange)
  const { list, set } = useRefList<HTMLButtonElement>()
  const [thumb, setThumb] = useState<{ x: number; w: number } | null>(null)
  // Le segment coché lu au moment de la mesure : l'observateur de taille garde la `measure` de son premier rendu, et un
  // contrôle monté caché (un tiroir fermé) puis coché ailleurs à l'ouverture y reposait le curseur sur le premier choix.
  const actif = useRef(active)
  useIsoLayoutEffect(() => {
    actif.current = active
  }, [active])

  const measure = () => {
    const element = list.current[options.findIndex((option) => option.value === actif.current)]
    if (element) setThumb({ x: element.offsetLeft, w: element.offsetWidth })
  }

  useIsoLayoutEffect(measure, [active, options.length, size, block])
  useEffect(() => {
    // Les libellés changent de largeur quand la police finit de charger.
    if (typeof ResizeObserver === "undefined") return undefined
    const observateur = new ResizeObserver(measure)
    list.current.forEach((element) => element && observateur.observe(element))
    return () => observateur.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- comme dans oto-frontend : l'observateur suit le nombre de segments, la mesure lit l'état courant
  }, [options.length])

  const onKeyDown = (evenement: KeyboardEvent<HTMLDivElement>) => {
    const rang = options.findIndex((option) => option.value === active)
    const aller = (vers: number) => {
      const option = options[(vers + options.length) % options.length]
      if (option.disabled) return
      setActive(option.value)
      list.current[options.indexOf(option)]?.focus()
    }
    if (evenement.key === "ArrowRight" || evenement.key === "ArrowDown") {
      evenement.preventDefault()
      aller(rang + 1)
    }
    if (evenement.key === "ArrowLeft" || evenement.key === "ArrowUp") {
      evenement.preventDefault()
      aller(rang - 1)
    }
  }

  // Deux propriétés personnalisées, que `CSSProperties` ne déclare pas : le curseur les lit (`navigation.css`).
  const position = thumb ? ({ "--seg-x": `${thumb.x}px`, "--seg-w": `${thumb.w}px` } as CSSProperties) : undefined

  return (
    <div
      {...rest}
      className={cx("oto-segmented", className)}
      data-size={size}
      data-block={block ? "" : undefined}
      data-variant={variant}
      role="radiogroup"
      aria-label={label ?? rest["aria-label"]}
      onKeyDown={chain(rest.onKeyDown, onKeyDown)}
    >
      <span className="oto-segmented-thumb" aria-hidden="true" style={position} />
      {options.map((option, rang) => {
        const coche = option.value === active
        return (
          <button
            key={option.value}
            ref={set(rang)}
            type="button"
            role="radio"
            className="oto-segment"
            aria-checked={coche}
            aria-disabled={option.disabled || undefined}
            tabIndex={coche ? 0 : -1}
            onClick={() => !option.disabled && setActive(option.value)}
          >
            {option.icon}
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
