// Porté d'oto-frontend (src/design-system/components/react/forms.jsx, `Field` et `Input`) : l'étiquette,
// l'aide et l'erreur distribuées au champ (`id`, `aria-describedby`, `aria-invalid`), l'erreur lue avant
// l'aide ; tels quels, en TypeScript. Retiré : les autres contrôles, que la coque n'emploie pas.
import { cloneElement, forwardRef, isValidElement, useId, type ComponentProps, type ReactElement, type ReactNode } from "react"
import { cx } from "./outils"

type Controle = ReactElement<{ id?: string; "aria-describedby"?: string; "aria-invalid"?: boolean; required?: boolean }>

function estUnControle(enfant: ReactNode): enfant is Controle {
  return isValidElement(enfant) && typeof enfant.type !== "symbol"
}

type FieldProps = Omit<ComponentProps<"div">, "children"> & {
  label?: ReactNode
  hint?: ReactNode
  error?: ReactNode
  required?: boolean
  children: ReactNode
}

/** L'erreur d'un champ ou d'un groupe de cases (`CheckboxGroup`), son icône devant : la couleur n'est jamais seule. */
export function FieldError({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p className="oto-field-error" id={id}>
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true" style={{ flex: "none", marginBlockStart: "1px" }}>
        <circle cx="12" cy="12" r="10" />
        <path d="M12 8v4M12 16h.01" />
      </svg>
      {children}
    </p>
  )
}

export function Field({ label, hint, error, required, id, className, children, ...rest }: FieldProps) {
  const auto = useId()
  const fieldId = id || auto
  const hintId = hint ? `${fieldId}-hint` : undefined
  const errId = error ? `${fieldId}-err` : undefined
  const describedBy = [errId, hintId].filter(Boolean).join(" ") || undefined
  const controle = estUnControle(children)
    ? cloneElement(children, { id: fieldId, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined, required: required || children.props.required })
    : children

  return (
    <div className={cx("oto-field", className)} {...rest}>
      {label && (
        <label className="oto-field-label" htmlFor={fieldId} data-required={required ? "" : undefined}>
          {label}
        </label>
      )}
      {controle}
      {error && <FieldError id={errId}>{error}</FieldError>}
      {hint && !error && (
        <p className="oto-field-hint" id={hintId}>
          {hint}
        </p>
      )}
    </div>
  )
}

export const Input = forwardRef<HTMLInputElement, Omit<ComponentProps<"input">, "size"> & { size?: "sm" | "md" | "lg" }>(function Input({ size = "md", className, ...rest }, ref) {
  return <input ref={ref} className={cx("oto-input", className)} data-size={size} {...rest} />
})
