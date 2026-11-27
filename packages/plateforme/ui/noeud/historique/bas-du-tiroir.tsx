"use client"

// Le pied du tiroir « Historique des versions » : la version choisie (« Version du 12 nov., 10:05 ») et « Revenir à
// cette version », bouton secondaire confirmé en ligne (`useConfirmationEnLigne`) ; désactivé, avec sa raison, pour qui
// ne fait que lire et sur la version actuelle. Le retour publie la version comme une révision de plus ; la page et la
// liste sont relues, le succès s'annonce, un refus se dit en `role="alert"`. Interne au tiroir.
import { useId, useState } from "react"
import { ArrowCounterClockwise } from "@phosphor-icons/react/dist/csr/ArrowCounterClockwise"
import type { HistoryEntry, NodeHistoryView } from "../../../schemas/node-history"
import { messageDErreur, type MessagesDuGeste } from "../../api/messages"
import { useConfirmationEnLigne } from "../../components/confirmation-en-ligne"
import { Icon } from "../../ds/react/icon"
import { Button } from "../../ds/react/primitives"
import { useRafraichir } from "../../hote/rafraichir"
import { revenirALaVersion } from "./api"
import { HISTORIQUE, quandLaVersion } from "./libelles"

/** Les refus propres au retour à une version ; les autres suivent la table commune. */
const REFUS: MessagesDuGeste = {
  forbidden: HISTORIQUE.lectureSeule,
  stale_revision: "Le contenu a été publié depuis : l'historique est relu, choisissez de nouveau la version.",
  conflict: "Ce contenu a des modifications non publiées : publiez-les ou abandonnez-les, puis revenez à la version.",
}

type BasDuTiroirProps = {
  chemin: string
  vue: NodeHistoryView
  versions: readonly HistoryEntry[]
  choisie: number
  /** La liste relue après un retour, ou après un refus de révision périmée. */
  apres: () => void
}

export function BasDuTiroir({ chemin, vue, versions, choisie, apres }: BasDuTiroirProps) {
  const rafraichir = useRafraichir()
  const raisonId = useId()
  const [envoi, setEnvoi] = useState(false)
  const [statut, setStatut] = useState<{ ok: boolean; texte: string } | null>(null)
  const version = versions.find((une) => une.revision === choisie)
  const quand = version ? quandLaVersion(version.at) : ""
  const courante = choisie === vue.revision
  const raison = !vue.writable ? HISTORIQUE.lectureSeule : courante ? HISTORIQUE.courante : null

  async function confirmer() {
    setEnvoi(true)
    try {
      const reponse = await revenirALaVersion(chemin, choisie, vue.revision)
      if (reponse.erreur) {
        setStatut({ ok: false, texte: messageDErreur(reponse.erreur, REFUS) })
        confirmation.revenir()
        if (reponse.erreur.code === "stale_revision") apres()
        return
      }
      confirmation.refermer()
      setStatut({ ok: true, texte: HISTORIQUE.revenu(quand) })
      rafraichir()
      apres()
    } finally {
      setEnvoi(false)
    }
  }

  const confirmation = useConfirmationEnLigne({ question: HISTORIQUE.question, libelleConfirmer: HISTORIQUE.confirmer, confirmer: () => void confirmer(), envoi })

  return (
    <div className="oto-history-stack oto-history-foot" data-gap="sm">
      <div className="oto-history-foot-row">
        <span className="oto-caption">{HISTORIQUE.version(quand)}</span>
        {!confirmation.ouverte && (
          <Button
            ref={confirmation.depart}
            variant="secondary"
            iconStart={<Icon as={ArrowCounterClockwise} size="sm" />}
            disabled={raison !== null}
            aria-describedby={raison === null ? undefined : raisonId}
            onClick={confirmation.demander}
          >
            {HISTORIQUE.revenir}
          </Button>
        )}
      </div>
      {confirmation.rendu}
      {raison !== null && (
        <p id={raisonId} className="oto-caption">
          {raison}
        </p>
      )}
      <p role="status" className="oto-caption">
        {statut?.ok ? statut.texte : null}
      </p>
      {statut?.ok === false && (
        <p role="alert" className="oto-caption">
          {statut.texte}
        </p>
      )}
    </div>
  )
}
