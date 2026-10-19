"use client"

// Porté d'oto-frontend (src/design-system/components/react/layout.jsx) : `Desk`, `Content`, `Rail`,
// `RailScroll`, `RailGroup`, `RailFoot`, `RailItem`, tels quels, en TypeScript. La page EST le bureau,
// chaque région un îlot ; seul le rail devenu tiroir sous 1 024 px a un état. Changé : le tiroir fermé est
// `inert`, hors de la tabulation (oto-frontend ne le cachait qu'aux lecteurs d'écran), et son voile est un
// bouton (un `div` cliquable). Retiré : `DeskGroup`,
// `Island`, `Topbar`, `Inspector`, `Grid`, `TwoColumns`, `useDeskChrome`, que la coque n'emploie pas.
import { forwardRef, useEffect, useRef, type ComponentProps, type ElementType, type ReactNode } from "react"
import { useBreakpoint, useDismiss } from "./hooks"
import { cx, mergeRefs } from "./outils"

type DeskProps = ComponentProps<"div"> & { rail?: boolean; density?: "dense" | "comfortable"; lift?: "none" }

export const Desk = forwardRef<HTMLDivElement, DeskProps>(function Desk({ rail = true, density, lift, className, children, ...rest }, ref) {
  return (
    <div ref={ref} className={cx("oto-desk", className)} data-rail={rail ? undefined : "none"} data-density={density} data-lift={lift} {...rest}>
      {children}
    </div>
  )
})

/** Le contenu : un `<main>` nu, où chaque écran pose ses îlots ; `max` les cadre à la mesure du contenu. */
export const Content = forwardRef<HTMLElement, ComponentProps<"main"> & { max?: boolean }>(function Content({ max, className, children, ...rest }, ref) {
  return (
    <main ref={ref} className={cx("oto-content", className)} {...rest}>
      {max ? <div className="oto-content-max">{children}</div> : children}
    </main>
  )
})

type RailProps = ComponentProps<"nav"> & { open?: boolean; onClose?: () => void }

/**
 * Le rail : complet dès 1 024 px, tiroir en dessous (réduit à ses icônes, un arbre de pages ne se lisait plus) — le seul palier
 * où le JS intervient (un tiroir a un état ouvert et un voile).
 */
export const Rail = forwardRef<HTMLElement, RailProps>(function Rail({ open, onClose, className, children, ...rest }, ref) {
  const interne = useRef<HTMLElement>(null)
  const tiroir = useBreakpoint("lg")

  useDismiss(tiroir && Boolean(open), () => onClose?.(), [interne])

  // Le corps ne défile pas derrière un tiroir ouvert : sur iOS, le doigt traverse le voile.
  useEffect(() => {
    if (!tiroir || !open) return
    const avant = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = avant
    }
  }, [tiroir, open])

  return (
    <>
      {/* Le voile double Échap pour le pointeur : un bouton hors de la tabulation et du lecteur d'écran. */}
      {tiroir && open && <button type="button" tabIndex={-1} className="oto-rail-scrim" onClick={onClose} aria-hidden="true" />}
      <nav
        ref={mergeRefs(interne, ref)}
        className={cx("oto-island", "oto-rail", className)}
        data-open={tiroir && open ? "" : undefined}
        aria-label="Navigation principale"
        aria-hidden={tiroir && !open ? "true" : undefined}
        // Le tiroir fermé est hors de l'écran : `inert` le sort aussi de la tabulation, que `aria-hidden`
        // laissait traverser (un focus invisible sur chaque lien du rail avant le contenu).
        inert={tiroir && !open ? true : undefined}
        {...rest}
      >
        {children}
      </nav>
    </>
  )
})

export const RailScroll = ({ className, children, ...rest }: ComponentProps<"div">) => (
  <div className={cx("oto-rail-scroll", className)} {...rest}>
    {children}
  </div>
)

export const RailGroup = ({ className, children, ...rest }: ComponentProps<"p">) => (
  <p className={cx("oto-rail-group", className)} {...rest}>
    {children}
  </p>
)

export const RailFoot = ({ className, children, ...rest }: ComponentProps<"div">) => (
  <div className={cx("oto-rail-foot", className)} {...rest}>
    {children}
  </div>
)

/** Ce qu'un hôte de ligne reçoit en plus de ses attributs : sa destination, s'il en a une. */
type RailItemProps = Omit<ComponentProps<"a">, "ref"> & {
  icon?: ReactNode
  label: string
  count?: number
  /** Créneau de fin de ligne : un badge, un glyphe. */
  end?: ReactNode
  /** Pose `aria-current="page"`, que le lecteur d'écran annonce « page courante ». */
  active?: boolean
  variant?: "context" | "account" | "skin"
  /** L'élément hôte : `a` par défaut, `button`, ou le lien de l'hôte (portage-ecrans.md § 1). */
  as?: ElementType
}

/** Une ligne de rail ; `title` porte le libellé en infobulle quand le rail est réduit. */
export const RailItem = forwardRef<HTMLElement, RailItemProps>(function RailItem({ icon, label, count, end, active, variant, as: Tag = "a", className, ...rest }, ref) {
  return (
    <Tag
      ref={ref}
      className={cx("oto-rail-item", "anim-host", className)}
      data-variant={variant}
      aria-current={active ? "page" : undefined}
      title={label}
      type={Tag === "button" ? "button" : undefined}
      {...rest}
    >
      {icon}
      <span className="oto-rail-label">{label}</span>
      {count != null && <span className="oto-rail-count oto-num">{count}</span>}
      {end}
    </Tag>
  )
})
