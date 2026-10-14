// L'en-tête d'un écran d'administration (E05-S09 partie d2) : le `ScreenHeader` du design system, son fil
// (le groupe du menu de l'entreprise, puis l'écran et ses frères), le glyphe de l'écran à gauche du titre,
// sa méta et ce qu'on peut y faire. Sans lui, sept écrans composaient chacun le même en-tête. Server
// Component : le fil est l'îlot client, qui ne reçoit que des données.
//
// Porté d'oto-frontend (`routes/settings.company.lazy.tsx`, `settings.appearance.lazy.tsx`,
// `components/monitoring/suivi-de-lentreprise.tsx`, chacun son `ScreenHeader`). Changé : le fil n'est posé
// que pour qui administre (la page d'un autre dit sa réserve, sans fil) et quand l'hôte donne ses adresses
// (un ERP qui monte l'écran seul n'en a pas).
import type { ReactNode } from "react"
import { Icon, type Glyphe } from "../ds/react/icon"
import { ScreenHeader } from "../ds/react/screen-header"
import { FilDeLAdministration, type EcranDAdministration } from "./fil-de-l-administration"
import type { FilDeLEcran } from "./types"

type EnTeteDAdministrationProps = {
  courant: EcranDAdministration
  fil?: FilDeLEcran
  titre: ReactNode
  /** Le glyphe de l'écran, celui du menu de l'entreprise (`@phosphor-icons/react/dist/ssr/<Nom>`). */
  glyphe: Glyphe
  meta?: ReactNode
  actions?: ReactNode
}

export function EnTeteDAdministration({ courant, fil, titre, glyphe, meta, actions }: EnTeteDAdministrationProps) {
  return (
    <ScreenHeader
      breadcrumb={fil?.administre ? <FilDeLAdministration courant={courant} {...fil} /> : undefined}
      title={titre}
      icon={<Icon as={glyphe} size="sm" />}
      meta={meta}
      actions={actions}
    />
  )
}
