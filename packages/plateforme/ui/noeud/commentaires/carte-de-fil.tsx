"use client"

// La carte d'un fil de commentaires (parcours 5.4, AC16, AC17, AC20 ; l'assistant, AC2) : la section du passage (un
// lien qui y défile) ou « Sur la page », ses états (« passage modifié depuis », « passage supprimé », expliqués en
// infobulle), la citation, les commentaires, et en pied « Répondre », sous « en attente d'un assistant » quand le fil
// en attend un. En haut à droite, toujours visible : la coche qui résout tout le fil, ou « Rouvrir le fil » ; inerte et
// expliquée pour qui ne peut pas (elle garde le focus et son infobulle, donc `aria-disabled`, jamais `disabled`). Un
// refus se dit dans la carte, la saisie gardée. Sans elle, l'encart n'aurait rien à lister.
import { useEffect, useRef, useState } from "react"
import { ArrowCounterClockwise } from "@phosphor-icons/react/dist/csr/ArrowCounterClockwise"
import { Check } from "@phosphor-icons/react/dist/csr/Check"
import type { CommentThreadView } from "../../../schemas/comments"
import { messageDErreur } from "../../api/messages"
import { Icon } from "../../ds/react/icon"
import { Badge, Button, IconButton } from "../../ds/react/primitives"
import { Tooltip } from "../../ds/react/tooltip"
import { changerLEtatDuFil, envoyerUnCommentaire } from "./api"
import { ChampDeCommentaire } from "./champ-de-commentaire"
import { CommentaireDuFil } from "./commentaire-du-fil"
import { FOCUS, useFocusDemande, type Commentaires } from "./contexte"
import { CHAMP, FIL, REFUS } from "./libelles"

/** Où le fil est posé, en mots : la section de son bloc, le début de la page avant le premier titre, ou la page. */
function lieuDuFil(fil: CommentThreadView): string {
  return fil.block === null ? FIL.surLaPage : (fil.section ?? FIL.debutDeLaPage)
}

/** Une étiquette d'état (le `Badge` du design system), son explication en infobulle : elle prend le focus, rien à activer. */
function Etiquette({ texte, aide, ton }: { texte: string; aide: string; ton: "review" | "oto" }) {
  return (
    <Tooltip content={aide} side="bottom">
      <Badge tone={ton} tabIndex={0} className="oto-fil-etiquette">
        {texte}
      </Badge>
    </Tooltip>
  )
}

/** L'ancre du fil : le lien vers son passage, ou « Sur la page » ; puis ce qui est arrivé au passage depuis. */
function AncreDuFil({ fil, aller }: { fil: CommentThreadView; aller: () => void }) {
  return (
    <div className="oto-fil-ancre">
      {fil.block === null ? (
        <strong>{FIL.surLaPage}</strong>
      ) : (
        <button type="button" title={FIL.allerAuPassage} onClick={aller}>
          {fil.section ?? FIL.debutDeLaPage}
        </button>
      )}
      {fil.anchor === "changed" && <Etiquette texte={FIL.modifieDepuis} aide={FIL.modifieDepuisAide} ton="review" />}
      {fil.anchor === "deleted" && <Etiquette texte={FIL.supprime} aide={FIL.supprimeAide} ton="review" />}
    </div>
  )
}

/** La coche qui résout tout le fil, ou « Rouvrir le fil » ; pour qui ne peut pas, inerte, son infobulle dit à qui cela revient. */
function EtatDuFil({ fil, envoi, changer }: { fil: CommentThreadView; envoi: boolean; changer: () => void }) {
  const ouvert = fil.status === "open"
  const aide = !fil.canResolve ? FIL.reserve : ouvert ? FIL.resoudreAide : FIL.rouvrirAide
  return (
    <Tooltip content={aide} side="left">
      <IconButton label={ouvert ? FIL.resoudre : FIL.rouvrir} variant="secondary" className="oto-fil-etat" aria-disabled={!fil.canResolve || envoi || undefined} aria-busy={envoi || undefined} onClick={changer}>
        <Icon as={ouvert ? Check : ArrowCounterClockwise} size="md" />
      </IconButton>
    </Tooltip>
  )
}

function CommentairesDuFil({ fil, commentaires }: { fil: CommentThreadView; commentaires: Commentaires }) {
  return (
    <ol className="oto-fil-commentaires">
      {fil.comments.map((commentaire, rang) => (
        <CommentaireDuFil key={commentaire.id} fil={fil} commentaire={commentaire} premier={rang === 0} commentaires={commentaires} />
      ))}
    </ol>
  )
}

export function CarteDeFil({ fil, commentaires }: { fil: CommentThreadView; commentaires: Commentaires }) {
  const [repond, setRepond] = useState(false)
  const [envoi, setEnvoi] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const carte = useFocusDemande<HTMLElement>(FOCUS.fil(fil.id))
  const repondre = useRef<HTMLButtonElement>(null)
  const rendreARepondre = useRef(false)
  // Le champ de réponse refermé (envoyée ou abandonnée), « Répondre » reprend le focus.
  useEffect(() => {
    if (!rendreARepondre.current || repond) return
    rendreARepondre.current = false
    repondre.current?.focus()
  })

  const changerLEtat = async () => {
    // Inerte pour qui ne peut pas résoudre : rien ne part, l'infobulle dit pourquoi.
    if (!fil.canResolve || envoi) return
    const etat = fil.status === "open" ? "resolved" : "open"
    setEnvoi(true)
    setErreur(null)
    const reponse = await changerLEtatDuFil(fil.id, etat)
    setEnvoi(false)
    if (reponse.erreur) {
      setErreur(messageDErreur(reponse.erreur, REFUS))
      return
    }
    if (etat === "resolved") {
      // La carte quitte « Ouverts » avec sa coche : le focus va à la liste.
      commentaires.adopter(reponse.data.thread, FOCUS.liste)
      return
    }
    commentaires.choisirLOnglet("open")
    commentaires.activer(fil.id)
    commentaires.adopter(reponse.data.thread, FOCUS.fil(fil.id))
  }
  const fermerLaReponse = () => {
    rendreARepondre.current = true
    setRepond(false)
  }
  const envoyerLaReponse = async (texte: string) => {
    setEnvoi(true)
    setErreur(null)
    const reponse = await envoyerUnCommentaire({ path: commentaires.chemin, thread: fil.id, text: texte })
    setEnvoi(false)
    if (reponse.erreur) {
      setErreur(messageDErreur(reponse.erreur, REFUS))
      return
    }
    commentaires.adopter(reponse.data.thread)
    fermerLaReponse()
  }

  return (
    <article ref={carte} tabIndex={-1} className="oto-fil" aria-label={FIL.nom(lieuDuFil(fil))} data-actif={commentaires.actif === fil.id ? "" : undefined}>
      <header className="oto-fil-tete">
        <AncreDuFil fil={fil} aller={() => commentaires.ouvrirLeFil(fil.id, false)} />
        <EtatDuFil fil={fil} envoi={envoi && !repond} changer={() => void changerLEtat()} />
      </header>
      {fil.quote !== null && <blockquote className="oto-fil-citation">{FIL.citation(fil.quote)}</blockquote>}
      <CommentairesDuFil fil={fil} commentaires={commentaires} />
      {erreur !== null && !repond && (
        <p role="alert" className="oto-field-error">
          {erreur}
        </p>
      )}
      {fil.status === "open" && (
        <footer className="oto-fil-pied">
          {fil.waitingAssistant && <Etiquette texte={FIL.enAttente} aide={FIL.enAttenteAide} ton="oto" />}
          {repond ? (
            <ChampDeCommentaire
              libelle={CHAMP.reponse}
              libelleEnvoyer={CHAMP.envoyer}
              envoi={envoi}
              erreur={erreur}
              surEnvoi={(texte) => void envoyerLaReponse(texte)}
              surAbandon={() => {
                setErreur(null)
                fermerLaReponse()
              }}
            />
          ) : (
            <Button
              ref={repondre}
              size="sm"
              onClick={() => {
                setErreur(null)
                commentaires.activer(fil.id)
                setRepond(true)
              }}
            >
              {FIL.repondre}
            </Button>
          )}
        </footer>
      )}
    </article>
  )
}
