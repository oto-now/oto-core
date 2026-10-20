// La jauge du budget de `context` sur la page d'un Contexte (2026-10-20, décidé par JB) : tout en bas de sa colonne de droite,
// une barre fine marquée au plafond, puis une ligne en petit : tout ce que `context` servirait à la personne qui regarde sans
// plafond (`whole` de l'aperçu, sans phrase : chaque partie entière) sur le budget, et le poids de ce Contexte. L'état (tout
// tient, ou dépasse) se réduit à une icône, son texte gardé pour un lecteur d'écran ; la barre change aussi de ton, jamais la
// couleur seule. Server Component : l'aperçu (`previewContext`) compte tout, le plafond vient de lui, l'écran ne recompte
// rien. Sans elle, l'auteur d'un Contexte ne savait pas qu'il faisait couper les parties lues après la sienne.
import type { CSSProperties } from "react"
import { CheckCircle } from "@phosphor-icons/react/dist/ssr/CheckCircle"
import { Warning } from "@phosphor-icons/react/dist/ssr/Warning"
import { AnimatedIcon } from "../ds/react/icon"
import type { DonneesDeLApercu } from "./apercu-du-contexte"
import { JAUGE_DU_BUDGET } from "./libelles"

const nombre = new Intl.NumberFormat("fr-FR")

type JaugeDuBudgetProps = { apercu: DonneesDeLApercu; cheminCourant: string }

/** Rien sans le poids entier (un hôte qui ne le sert pas encore) : la page reste lisible sans la jauge. */
export function JaugeDuBudget({ apercu, cheminCourant }: JaugeDuBudgetProps) {
  const { whole, budget } = apercu
  if (!whole || budget <= 0) return null
  const poids = whole.blocks.find((bloc) => bloc.name === cheminCourant)?.chars ?? 0
  const depasse = whole.total > budget
  // La barre couvre le plus grand des deux, le plafond marqué à sa place : au-delà, ce qui dépasse se voit à droite du trait.
  const echelle = Math.max(whole.total, budget)
  // Deux propriétés personnalisées (`--progress`, `--seuil`) que `CSSProperties` ne connaît pas : le type ne peut pas les inférer.
  const style = { "--progress": `${(whole.total / echelle) * 100}%`, "--seuil": `${(budget / echelle) * 100}%` } as CSSProperties
  const ligne = JAUGE_DU_BUDGET.ligne(nombre.format(whole.total), nombre.format(budget), poids > 0 ? nombre.format(poids) : null)
  const etat = depasse ? JAUGE_DU_BUDGET.depasse : JAUGE_DU_BUDGET.tient
  return (
    <div className="oto-budget" data-depasse={depasse ? "" : undefined}>
      <div
        className="oto-progress"
        role="meter"
        aria-label={JAUGE_DU_BUDGET.nom}
        aria-valuemin={0}
        aria-valuemax={budget}
        aria-valuenow={Math.min(whole.total, budget)}
        aria-valuetext={`${ligne}. ${etat}`}
        data-tone={depasse ? "fail" : "ok"}
        style={style}
      >
        <div className="oto-progress-bar" />
        <span className="oto-budget-seuil" aria-hidden="true" />
      </div>
      <p className="oto-budget-ligne">
        <AnimatedIcon as={depasse ? Warning : CheckCircle} size="xs" />
        <span>{ligne}</span>
        <span className="oto-sr-only">{etat}</span>
      </p>
    </div>
  )
}
