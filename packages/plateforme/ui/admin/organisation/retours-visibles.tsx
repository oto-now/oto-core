// « Retours des assistants » de l'écran Organisation (1.4.13) : l'option « Retours visibles » de l'organisation (drapeau
// `feedback_visible`), son état dit en texte et en teinte, et le geste qui la bascule par `PATCH admin/flags`, sans
// question (une option se rebascule). Allumée, ses administrateurs voient « Retours » dans le menu de l'entreprise et
// traitent les tickets ; l'équipe plateforme les traite toujours. Server Component : le geste est une `ActionPlateforme`,
// qui dit l'envoi, le refus et relit la page ; une lecture en échec se dit avec « Réessayer ». Sans lui, l'option ne se
// réglait par aucun écran monté.
import { FEEDBACK_VISIBLE } from "../../../schemas"
import type { Resultat } from "../../api/resultat"
import { ActionPlateforme } from "../../components/action-plateforme"
import { ErreurDeLecture } from "../../components/erreur-de-lecture"
import { Badge } from "../../ds/react/primitives"
import { Ilot } from "../ilot"
import { MESSAGES_DES_DRAPEAUX } from "../textes"

/** Le titre de l'îlot : le focus y va quand la relecture emporte le geste. */
const ANCRE = "organisation-retours"

function Option({ visibles }: { visibles: boolean }) {
  const geste = visibles ? "Masquer les retours" : "Afficher les retours"
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Badge tone={visibles ? "ok" : "idle"}>{visibles ? "Retours affichés" : "Retours masqués"}</Badge>
      <ActionPlateforme
        libelle={geste}
        nomAccessible={`${geste} des assistants aux administrateurs`}
        requete={{ methode: "PATCH", ressource: "admin/flags", corps: { name: FEEDBACK_VISIBLE, enabled: !visibles } }}
        ancre={ANCRE}
        messages={MESSAGES_DES_DRAPEAUX}
      />
    </div>
  )
}

export function RetoursVisibles({ lecture }: { lecture: Resultat<boolean> }) {
  return (
    <Ilot id={ANCRE} titre="Retours des assistants">
      <div className="flex flex-col gap-3">
        <p className="oto-caption">
          Les assistants signalent ce qui les a gênés : une consigne floue, une fonction qui manque, une erreur. Affichés, ces retours
          apparaissent aux administrateurs dans le menu de l’entreprise, sous « Retours ».
        </p>
        {lecture.error !== undefined ? <ErreurDeLecture message={lecture.error} /> : <Option visibles={lecture.data} />}
      </div>
    </Ilot>
  )
}
