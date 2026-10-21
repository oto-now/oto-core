// La jauge du budget de `context` sur la page d'un Contexte (2026-10-20, décidé par JB) : tout en bas de sa colonne de droite,
// une seule phrase : ce que `context` sert à la personne qui regarde (`whole` de l'aperçu, sans phrase : chaque partie
// entière) sur le budget, au-delà ce qui arrive, et le poids de ce Contexte. L'état (tout tient, ou dépasse) se montre par une
// icône, dit aussi en texte au lecteur d'écran ; jamais la couleur seule. 2026-10-21 (JB) : la barre et le trait du plafond
// partent, « 13 971 / 35 000 caractères · ce contexte 64 » ne se comprenait pas. Server Component : l'aperçu
// (`previewContext`) compte tout, le plafond vient de lui, l'écran ne recompte rien. Sans elle, l'auteur d'un Contexte ne
// savait pas qu'il faisait couper les parties lues après la sienne.
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
  const phrase = JAUGE_DU_BUDGET.phrase({ total: nombre.format(whole.total), budget: nombre.format(budget), poids: poids > 0 ? nombre.format(poids) : null, depasse })
  return (
    <p className="oto-budget" data-depasse={depasse ? "" : undefined}>
      <AnimatedIcon as={depasse ? Warning : CheckCircle} size="xs" />
      <span className="oto-sr-only">{depasse ? JAUGE_DU_BUDGET.depasse : JAUGE_DU_BUDGET.tient}</span>
      <span>{phrase}</span>
    </p>
  )
}
