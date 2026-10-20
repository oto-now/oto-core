// La liste des choix du `Select` (E05-S11 lot f ; 1.4.13) : chaque choix, son glyphe, son libellé et la ligne fine qui le
// décrit, la coche du choix courant, et les groupes sous leur intitulé. À part de `select.tsx`, qui tenait sous 300 lignes.
import type { SelectOption } from "./select"

const COCHE = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 6 9 17l-5-5" />
  </svg>
)

type ListeProps = { id: string; nom: string | undefined; options: readonly SelectOption[]; valeur: string; index: number; surSurvol: (rang: number) => void; choisir: (rang: number) => void }

/** Les options, groupées sous leur intitulé ; le survol et le clavier partagent la ligne surlignée. */
export function ListeDesChoix({ id, nom, options, valeur, index, surSurvol, choisir }: ListeProps) {
  const ligne = (rang: number) => {
    const option = options[rang]
    return (
      <div
        key={`${rang}-${option.value}`}
        id={`${id}-${rang}`}
        role="option"
        aria-selected={option.value === valeur}
        aria-disabled={option.disabled || undefined}
        aria-labelledby={`${id}-${rang}-libelle`}
        aria-describedby={option.description ? `${id}-${rang}-description` : undefined}
        className="oto-menu-item"
        data-decrit={option.description ? "" : undefined}
        data-highlighted={index === rang ? "" : undefined}
        onMouseEnter={() => !option.disabled && surSurvol(rang)}
        onClick={() => choisir(rang)}
      >
        {option.icon && (
          <span className="oto-menu-icon" aria-hidden="true">
            {option.icon}
          </span>
        )}
        <span className="oto-menu-text">
          <span id={`${id}-${rang}-libelle`} className="oto-menu-label">
            {option.label}
          </span>
          {option.description && (
            <span id={`${id}-${rang}-description`} className="oto-menu-description">
              {option.description}
            </span>
          )}
        </span>
        <span className="oto-menu-check" aria-hidden="true">
          {option.value === valeur && COCHE}
        </span>
      </div>
    )
  }
  const groupes: { intitule: string | undefined; rangs: number[] }[] = []
  options.forEach((option, rang) => {
    const dernier = groupes.at(-1)
    if (dernier && dernier.intitule === option.group) dernier.rangs.push(rang)
    else groupes.push({ intitule: option.group, rangs: [rang] })
  })
  return (
    <div id={id} role="listbox" aria-label={nom} className="oto-select-list">
      {groupes.map(({ intitule, rangs }, rangDuGroupe) =>
        intitule === undefined ? (
          rangs.map(ligne)
        ) : (
          <div key={`groupe-${rangDuGroupe}`} role="group" aria-label={intitule}>
            <p className="oto-menu-group-label" aria-hidden="true">
              {intitule}
            </p>
            {rangs.map(ligne)}
          </div>
        ),
      )}
    </div>
  )
}
