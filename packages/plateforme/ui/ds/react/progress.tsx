// La barre de progression du design system (`oto-progress`, `feedback.css`), une seule source là où l'import d'un
// CSV, l'envoi d'un fichier dans l'éditeur et la mise en ligne d'une organisation en gardaient chacun une copie :
// `role="progressbar"` et ses bornes pour le lecteur d'écran, nommée par son libellé visible.
import { useId, type CSSProperties } from "react"

type ProgressProps = {
  /** Le libellé montré au-dessus de la barre, qui la nomme. */
  label: string
  value: number
  max: number
}

export function Progress({ label, value, max }: ProgressProps) {
  const id = useId()
  // `CSSProperties` ne connaît que les propriétés de CSS nommées ; une propriété personnalisée (`--progress`, lue par
  // `.oto-progress-bar`) n'y figure pas, d'où le cast.
  const largeur = { "--progress": `${(value / Math.max(max, 1)) * 100}%` } as CSSProperties
  return (
    <div>
      <div className="oto-progress-label">
        <span id={id}>{label}</span>
      </div>
      <div className="oto-progress" role="progressbar" aria-labelledby={id} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
        <div className="oto-progress-bar" style={largeur} />
      </div>
    </div>
  )
}
