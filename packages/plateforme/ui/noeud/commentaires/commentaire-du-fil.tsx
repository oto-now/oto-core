"use client"

// Un commentaire dans la carte de son fil (parcours 5.4, AC16, AC18 ; l'assistant, AC7) : « Nom · quand », « modifié »
// le cas échéant, le texte, ses mentions en valeur ; sans avatar. Écrit par un assistant, il est signé « Assistant de
// <nom> ». Sur les siens, au survol ou au focus : un crayon (le texte se modifie en place) et une poubelle, qui demande
// confirmation dans la carte ; le premier commentaire emporte le fil et ses réponses. Un refus se dit sous le
// commentaire, la saisie gardée. Sans lui, la carte d'un fil porterait aussi les gestes de chaque commentaire.
import { useEffect, useRef, useState } from "react"
import { PencilSimple } from "@phosphor-icons/react/dist/csr/PencilSimple"
import { Trash } from "@phosphor-icons/react/dist/csr/Trash"
import type { CommentThreadView, CommentView } from "../../../schemas/comments"
import { messageDErreur } from "../../api/messages"
import { useConfirmationEnLigne } from "../../components/confirmation-en-ligne"
import { Icon } from "../../ds/react/icon"
import { IconButton } from "../../ds/react/primitives"
import { dateEtHeureLisibles, ilYA } from "../../format/dates"
import { modifierUnCommentaire, supprimerUnCommentaire } from "./api"
import { ChampDeCommentaire } from "./champ-de-commentaire"
import { FOCUS, type Commentaires } from "./contexte"
import { CHAMP, COMMENTAIRE, REFUS } from "./libelles"
import { morceauxDuTexte, nomsEnValeur } from "./mentions"

/** Qui signe : la personne, « Ancien membre » quand elle n'est plus connue, son assistant quand il a écrit pour elle. */
function signature(commentaire: CommentView): string {
  if (commentaire.viaAssistant) return commentaire.author === null ? COMMENTAIRE.assistantDUnAncienMembre : COMMENTAIRE.assistantDe(commentaire.author)
  return commentaire.author ?? COMMENTAIRE.ancienMembre
}

/** Le texte d'un commentaire, ses mentions enregistrées en valeur. */
function TexteDuCommentaire({ commentaire }: { commentaire: CommentView }) {
  return (
    <p className="oto-commentaire-texte">
      {morceauxDuTexte(commentaire.text, nomsEnValeur(commentaire)).map((morceau, rang) =>
        morceau.mention ? (
          <span key={rang} className="oto-mention">
            {morceau.texte}
          </span>
        ) : (
          morceau.texte
        ),
      )}
    </p>
  )
}

type CommentaireDuFilProps = {
  fil: CommentThreadView
  commentaire: CommentView
  /** Le premier commentaire : le supprimer supprime le fil et ses réponses. */
  premier: boolean
  commentaires: Commentaires
}

export function CommentaireDuFil({ fil, commentaire, premier, commentaires }: CommentaireDuFilProps) {
  const [modifie, setModifie] = useState(false)
  const [envoi, setEnvoi] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const crayon = useRef<HTMLButtonElement>(null)
  const rendreAuCrayon = useRef(false)
  // Le champ refermé (enregistré ou abandonné), le crayon reprend le focus.
  useEffect(() => {
    if (!rendreAuCrayon.current || modifie) return
    rendreAuCrayon.current = false
    crayon.current?.focus()
  })

  const confirmation = useConfirmationEnLigne({
    question: premier ? COMMENTAIRE.questionDuFil(fil.comments.length - 1) : COMMENTAIRE.questionDeLaReponse,
    libelleConfirmer: COMMENTAIRE.supprimer,
    confirmer: () => void supprimer(),
    envoi,
  })
  async function supprimer() {
    setEnvoi(true)
    setErreur(null)
    const reponse = await supprimerUnCommentaire(commentaire.id)
    setEnvoi(false)
    if (reponse.erreur) {
      setErreur(messageDErreur(reponse.erreur, REFUS))
      confirmation.revenir()
      return
    }
    if (reponse.data.thread === null) commentaires.retirer(fil.id)
    else commentaires.adopter(reponse.data.thread, FOCUS.fil(fil.id))
  }
  const fermerLeChamp = () => {
    rendreAuCrayon.current = true
    setModifie(false)
  }
  const enregistrer = async (texte: string) => {
    setEnvoi(true)
    setErreur(null)
    const reponse = await modifierUnCommentaire(commentaire.id, texte)
    setEnvoi(false)
    if (reponse.erreur) {
      setErreur(messageDErreur(reponse.erreur, REFUS))
      return
    }
    commentaires.adopter(reponse.data.thread)
    fermerLeChamp()
  }

  return (
    <li className="oto-commentaire">
      <p className="oto-commentaire-signature">
        <strong>{signature(commentaire)}</strong>
        <span>
          {" · "}
          <time dateTime={commentaire.createdAt} title={dateEtHeureLisibles(commentaire.createdAt)}>
            {ilYA(commentaire.createdAt)}
          </time>
          {commentaire.editedAt !== null && ` · ${COMMENTAIRE.modifie}`}
        </span>
      </p>
      {modifie ? (
        <ChampDeCommentaire
          libelle={CHAMP.modification}
          initial={commentaire.text}
          libelleEnvoyer={CHAMP.enregistrer}
          envoi={envoi}
          erreur={erreur}
          surEnvoi={(texte) => void enregistrer(texte)}
          surAbandon={() => {
            setErreur(null)
            fermerLeChamp()
          }}
        />
      ) : (
        <TexteDuCommentaire commentaire={commentaire} />
      )}
      {/* Dans un fil résolu, un commentaire est figé : ni crayon ni poubelle tant que le fil n'est pas rouvert. */}
      {commentaire.mine && fil.status === "open" && !modifie && !confirmation.ouverte && (
        <div className="oto-commentaire-outils">
          <IconButton
            ref={crayon}
            size="sm"
            label={COMMENTAIRE.modifier}
            onClick={() => {
              setErreur(null)
              setModifie(true)
            }}
          >
            <Icon as={PencilSimple} size="xs" />
          </IconButton>
          <IconButton ref={confirmation.depart} size="sm" label={premier ? COMMENTAIRE.supprimerLeFil : COMMENTAIRE.supprimerLaReponse} data-danger="" onClick={confirmation.demander}>
            <Icon as={Trash} size="xs" />
          </IconButton>
        </div>
      )}
      {confirmation.rendu}
      {erreur !== null && !modifie && (
        <p role="alert" className="oto-field-error">
          {erreur}
        </p>
      )}
    </li>
  )
}
