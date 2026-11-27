// Porté d'oto-frontend (src/design-system/components/react/primitives.jsx) : `Button`, `IconButton`,
// `Badge`, `Avatar`, `Kbd`, `Alert`, tels quels, en TypeScript — des classes et des attributs
// `data-*`, le CSS fait le reste ; `{...rest}` d'abord, les garanties du composant ensuite. Retiré :
// les primitives que la coque n'emploie pas (Card, Stat, Tag, StatusDot, AvatarGroup, ToolMark,
// Separator, Skeleton, EmptyState) : chaque écran porté les reprend au besoin ; `Progress` vit dans `progress.tsx`.
import { forwardRef, Fragment, type ComponentProps, type MouseEvent, type ReactNode } from "react"
import { cx, initials } from "./outils"

/** Un élément inerte n'agit pas et ne laisse pas remonter le clic. */
const bloquer = (evenement: MouseEvent) => {
  evenement.preventDefault()
  evenement.stopPropagation()
}

type ButtonProps = ComponentProps<"button"> & {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "link"
  size?: "sm" | "md" | "lg"
  block?: boolean
  loading?: boolean
  iconStart?: ReactNode
  iconEnd?: ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", block, loading, disabled, iconStart, iconEnd, className, children, ...rest },
  ref,
) {
  const inerte = Boolean(disabled || loading)
  return (
    <button
      ref={ref}
      {...rest}
      className={cx("oto-btn", "anim-host", className)}
      data-variant={variant}
      data-size={size}
      data-press=""
      data-block={block ? "" : undefined}
      data-loading={loading ? "" : undefined}
      disabled={inerte || undefined}
      aria-disabled={inerte || undefined}
      onClick={inerte ? bloquer : rest.onClick}
      type={rest.type ?? "button"}
    >
      {iconStart}
      {children && <span>{children}</span>}
      {iconEnd}
    </button>
  )
})

type IconButtonProps = ComponentProps<"button"> & {
  /** Le nom du bouton : sans lui, il n'existe pas pour un lecteur d'écran. */
  label: string
  variant?: "ghost" | "secondary" | "primary"
  size?: "sm" | "md" | "lg"
  pressed?: boolean
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, variant = "ghost", size = "md", pressed, className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      {...rest}
      type={rest.type ?? "button"}
      className={cx("oto-icon-btn", "anim-host", className)}
      data-variant={variant}
      data-size={size}
      data-press=""
      data-icon-only=""
      aria-label={label}
      aria-pressed={pressed ?? rest["aria-pressed"]}
    >
      {children}
    </button>
  )
})

type BadgeProps = ComponentProps<"span"> & {
  tone?: "idle" | "run" | "think" | "live" | "ok" | "review" | "fail" | "oto"
  solid?: boolean
  count?: boolean
  icon?: ReactNode
}

export function Badge({ tone, solid, count, icon, className, children, ...rest }: BadgeProps) {
  return (
    <span className={cx("oto-badge", className)} data-tone={tone} data-solid={solid ? "" : undefined} data-count={count ? "" : undefined} {...rest}>
      {icon}
      <span>{children}</span>
    </span>
  )
}

type AvatarProps = ComponentProps<"span"> & { name?: string; src?: string | null; size?: "sm" | "md" | "lg"; self?: boolean }

/** Une personne : son image, sinon ses initiales, le nom lu par le lecteur d'écran. */
export function Avatar({ name = "", src, size = "md", self, className, ...rest }: AvatarProps) {
  return (
    <span {...rest} className={cx("oto-avatar", className)} data-size={size} data-self={self ? "" : undefined} title={name || rest.title}>
      {src ? (
        // L'image d'un avatar vient d'une adresse que l'hôte sert : pas d'optimisation de Next ici (ui/ n'importe pas next/*).
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={name} loading="lazy" />
      ) : (
        <span aria-hidden={name ? undefined : "true"}>{initials(name)}</span>
      )}
      {!src && name && <span className="oto-sr-only">{name}</span>}
    </span>
  )
}

/** Une touche, ou une combinaison (`keys` : « ⌘ », « K ») séparée par « + ». */
export function Kbd({ keys, className, children, ...rest }: ComponentProps<"kbd"> & { keys?: string[] }) {
  if (!keys) {
    return (
      <kbd className={cx("oto-kbd", className)} {...rest}>
        {children}
      </kbd>
    )
  }
  return (
    <span className={cx("oto-kbd-group", className)}>
      {keys.map((touche, rang) => (
        <Fragment key={touche}>
          {rang > 0 && (
            <span className="oto-kbd-plus" aria-hidden="true">
              +
            </span>
          )}
          <kbd className="oto-kbd">{touche}</kbd>
        </Fragment>
      ))}
    </span>
  )
}

type AlertProps = Omit<ComponentProps<"div">, "title"> & {
  tone?: "idle" | "run" | "think" | "live" | "ok" | "review" | "fail" | "oto"
  title?: ReactNode
  icon?: ReactNode
  actions?: ReactNode
}

/**
 * Un message ; `role="alert"` réservé à l'échec, qui interrompt la lecture, `status` sinon ; un `role` reçu
 * l'emporte (`none` dans une région déjà vivante, qu'une seconde imbriquée ferait annoncer deux fois, M31).
 */
export function Alert({ tone = "run", title, icon, actions, className, children, ...rest }: AlertProps) {
  return (
    <div {...rest} className={cx("oto-alert", className)} data-tone={tone} role={rest.role ?? (tone === "fail" ? "alert" : "status")}>
      {icon}
      <div className="oto-alert-body">
        {title && <p className="oto-alert-title">{title}</p>}
        {children && <p className="oto-alert-desc">{children}</p>}
        {actions && <div className="oto-alert-actions">{actions}</div>}
      </div>
    </div>
  )
}
