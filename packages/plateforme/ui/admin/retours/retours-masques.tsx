// Les retours d'une organisation qui ne les affiche pas (1.4.13) : l'administrateur voit toujours « Retours » au menu ; tant
// que l'option « Retours visibles » est éteinte, l'écran le dit et l'allume sur place par `PATCH admin/flags`, comme
// l'îlot de l'écran Organisation, puis la page se relit et montre la liste. Server Component : le geste est une
// `ActionPlateforme`. Sans lui, l'entrée du menu menait à une page introuvable.
import { FEEDBACK_VISIBLE } from "../../../schemas"
import { ActionPlateforme } from "../../components/action-plateforme"
import { Ilot } from "../ilot"
import { MESSAGES_DES_DRAPEAUX } from "../textes"

const ANCRE = "retours-masques"

export function RetoursMasques() {
  return (
    <Ilot id={ANCRE} titre="Retours masqués">
      <div className="flex flex-col items-start gap-3">
        <p>Les retours des assistants ne sont pas affichés pour votre organisation.</p>
        <ActionPlateforme
          libelle="Les afficher"
          nomAccessible="Afficher les retours des assistants aux administrateurs"
          requete={{ methode: "PATCH", ressource: "admin/flags", corps: { name: FEEDBACK_VISIBLE, enabled: true } }}
          ancre={ANCRE}
          messages={MESSAGES_DES_DRAPEAUX}
        />
      </div>
    </Ilot>
  )
}
