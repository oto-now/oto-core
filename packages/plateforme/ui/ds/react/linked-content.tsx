// Porté d'oto-frontend (src/design-system/components/react/content.jsx, `LinkedContent`) : un repli qu'on ne
// regarde qu'au besoin, donc replié, et dont le résumé dit s'il faut l'ouvrir ; `<details>` et `<summary>`
// natifs, l'état, le clavier et l'annonce « développé / réduit » viennent du navigateur. Tel quel, en
// TypeScript. Retiré : `LinkedLabel` et `LinkedNote`, qu'aucun écran porté n'emploie encore.
import type { ComponentProps, ReactNode } from "react"
import { cx } from "./outils"

type LinkedContentProps = Omit<ComponentProps<"details">, "title"> & {
  icon?: ReactNode
  title: ReactNode
  count?: number
  summary?: ReactNode
}

/** Le chevron du repli, qui pivote à l'ouverture (`content.css`). */
function LinkedChevron() {
  return (
    <svg className="oto-icon oto-linked-chevron" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

export function LinkedContent({ icon, title, count, summary, className, children, ...rest }: LinkedContentProps) {
  return (
    <details className={cx("oto-linked", className)} {...rest}>
      <summary>
        {icon}
        <strong>{title}</strong>
        {count != null && <span className="oto-linked-count">{count}</span>}
        {summary != null && <span>{summary}</span>}
        <LinkedChevron />
      </summary>
      <div className="oto-linked-body">{children}</div>
    </details>
  )
}
