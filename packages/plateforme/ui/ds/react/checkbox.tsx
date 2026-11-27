"use client"

// Porté d'oto-frontend (src/design-system/components/react/forms.jsx, `Checkbox`) : l'élément natif,
// visuellement masqué mais dans le flux et focalisable ; la boîte dessinée est son frère immédiat, et
// `:checked + .oto-checkbox-box` fait le travail sans JS ; `indeterminate` n'existe qu'en propriété du DOM,
// posée à la main. Tel quel, en TypeScript.
// `CheckboxGroup` : plusieurs cases d'un même choix, un `<fieldset>` et sa `<legend>` (sans quoi un lecteur d'écran
// annonce des cases isolées), dans une liste encadrée qui défile au-delà de six, avec l'aide et l'erreur de `Field`.
// Sans lui, une liste de cases dans un formulaire (les équipes d'une invitation) se dessinait à la main ; le menu à
// cases, monté en portail, tombe sous la couche d'un dialogue modal.
import { forwardRef, useEffect, useId, useRef, type ComponentProps, type ReactNode } from "react"
import { FieldError } from "./forms"
import { cx, mergeRefs } from "./outils"

type CheckboxProps = Omit<ComponentProps<"input">, "type"> & {
  label?: ReactNode
  description?: ReactNode
  indeterminate?: boolean
}

const CheckMark = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 6 9 17l-5-5" />
  </svg>
)

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox({ label, description, indeterminate, disabled, className, ...rest }, ref) {
  const inner = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (inner.current) inner.current.indeterminate = Boolean(indeterminate)
  }, [indeterminate])

  return (
    <label className={cx("oto-choice", className)} data-disabled={disabled ? "" : undefined}>
      <input type="checkbox" ref={mergeRefs(inner, ref)} disabled={disabled} {...rest} />
      <span className="oto-checkbox-box" aria-hidden="true">
        <CheckMark />
      </span>
      {(label || description) && (
        <span className="oto-choice-text">
          {label}
          {description && <span className="oto-choice-desc">{description}</span>}
        </span>
      )}
    </label>
  )
})

type CheckboxGroupProps = Omit<ComponentProps<"fieldset">, "children"> & {
  legend: ReactNode
  hint?: ReactNode
  error?: ReactNode
  /** Les `Checkbox` du choix. */
  children: ReactNode
}

/** L'aide et l'erreur se lisent comme celles de `Field` : l'erreur avant l'aide, qu'elle remplace, liées au groupe. */
export function CheckboxGroup({ legend, hint, error, id, className, children, ...rest }: CheckboxGroupProps) {
  const auto = useId()
  const groupId = id || auto
  const hintId = hint ? `${groupId}-hint` : undefined
  const errId = error ? `${groupId}-err` : undefined
  return (
    <fieldset id={groupId} className={cx("oto-checkbox-group", className)} aria-describedby={[errId, hint && !error ? hintId : undefined].filter(Boolean).join(" ") || undefined} {...rest}>
      <legend className="oto-field-label">{legend}</legend>
      <div className="oto-checkbox-list">{children}</div>
      {error && <FieldError id={errId}>{error}</FieldError>}
      {hint && !error && (
        <p className="oto-field-hint" id={hintId}>
          {hint}
        </p>
      )}
    </fieldset>
  )
}
