"use client"

// Le champ d'un commentaire (parcours 5.4, AC19, AC20 ; l'assistant, AC1 ; l'email, son encadré) : un nouveau fil, une
// réponse, ou un commentaire modifié en place. Taper `@` propose l'assistant puis les membres qui lisent la page,
// filtrés à la frappe, au clavier (flèches, Entrée ou Tab, Échap) comme à la souris. Sous le champ, ce qu'une mention
// déclenchera : le fil attendra un assistant ; la personne recevra l'email groupé, si l'hôte en envoie. Un refus garde la
// saisie et dit quoi faire. Champ en place, nommé par `aria-label`, validé à l'envoi par le schéma du service. Sans
// lui, la carte d'un fil, le nouveau fil et la modification écriraient chacun leur champ.
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react"
import { addressesAssistant, COMMENT_MAX_CHARS, editCommentSchema } from "../../../schemas/comments"
import { Textarea } from "../../ds/react/textarea"
import { Button } from "../../ds/react/primitives"
import { useCommentaires } from "./contexte"
import { CHAMP } from "./libelles"
import { avecLaMention, choixDeMention, lecteursNommes, mentionEnCours, type ChoixDeMention, type Lecteur } from "./mentions"

const SANS_LECTEUR: readonly Lecteur[] = []

type ListeProps = { id: string; choix: readonly ChoixDeMention[]; rang: number; choisir: (choix: ChoixDeMention) => void }

/** La liste des mentions, sous le champ : l'option courante suit les flèches du champ (`aria-activedescendant`). */
function ListeDesMentions({ id, choix, rang, choisir }: ListeProps) {
  return (
    <div role="listbox" id={id} aria-label={CHAMP.mentions} className="oto-mentions">
      {choix.map((un, place) => (
        <button
          key={un.cle}
          type="button"
          role="option"
          id={`${id}-${place}`}
          aria-selected={place === rang}
          tabIndex={-1}
          className="oto-mention-choix"
          data-assistant={un.assistant ? "" : undefined}
          // L'appui ne prend pas le focus au champ : la frappe continue après le choix.
          onMouseDown={(evenement) => evenement.preventDefault()}
          onClick={() => choisir(un)}
        >
          <span>@{un.nom}</span>
          <small>{un.aide}</small>
        </button>
      ))}
    </div>
  )
}

/** Ce que les mentions du texte en cours déclencheront, dit avant l'envoi ; la région est montée vide. */
function Encadres({ texte, lecteurs, email }: { texte: string; lecteurs: readonly Lecteur[]; email: boolean }) {
  const nommes = email ? lecteursNommes(texte, lecteurs) : []
  return (
    <div role="status" className="oto-commentaire-encadre">
      {addressesAssistant(texte) && <p>{CHAMP.pourLAssistant}</p>}
      {nommes.length > 0 && <p>{CHAMP.email(nommes)}</p>}
    </div>
  )
}

export type ChampDeCommentaireProps = {
  /** Ce que le champ attend (« Répondre… ») : son invite et son nom. */
  libelle: string
  /** Le texte de départ : celui du commentaire qu'on modifie. */
  initial?: string
  libelleEnvoyer: string
  /** L'envoi est en cours : le bouton attend, le champ garde sa saisie. */
  envoi: boolean
  /** Le refus du dernier envoi, déjà dit en français. */
  erreur: string | null
  surEnvoi: (texte: string) => void
  surAbandon: () => void
}

export function ChampDeCommentaire({ libelle, initial = "", libelleEnvoyer, envoi, erreur, surEnvoi, surAbandon }: ChampDeCommentaireProps) {
  const commentaires = useCommentaires()
  const vue = commentaires?.lecture.phase === "lue" ? commentaires.lecture.vue : null
  const lecteurs = vue?.readers ?? SANS_LECTEUR
  const [texte, setTexte] = useState(initial)
  const [curseur, setCurseur] = useState(initial.length)
  const [rang, setRang] = useState(0)
  const [listeFermee, setListeFermee] = useState(false)
  const [invalide, setInvalide] = useState<string | null>(null)
  const champ = useRef<HTMLTextAreaElement>(null)
  const curseurVoulu = useRef<number | null>(null)
  const id = useId()
  const mention = listeFermee ? null : mentionEnCours(texte, curseur)
  const choix = mention ? choixDeMention(mention.saisie, lecteurs) : []
  const courant = Math.min(rang, choix.length - 1)
  const message = invalide ?? erreur

  // Le champ s'ouvre avec le focus, le curseur en fin de texte.
  useEffect(() => {
    champ.current?.focus()
    champ.current?.setSelectionRange(initial.length, initial.length)
  }, [initial.length])
  // Après le choix d'une mention, le curseur se pose juste après elle.
  useLayoutEffect(() => {
    if (curseurVoulu.current === null) return
    champ.current?.setSelectionRange(curseurVoulu.current, curseurVoulu.current)
    curseurVoulu.current = null
  })

  const suivre = (element: HTMLTextAreaElement) => setCurseur(element.selectionStart)
  const choisir = (un: ChoixDeMention) => {
    if (!mention) return
    const suite = avecLaMention(texte, mention, un.nom)
    setTexte(suite.texte)
    setCurseur(suite.curseur)
    setRang(0)
    curseurVoulu.current = suite.curseur
    champ.current?.focus()
  }
  const envoyer = () => {
    if (envoi) return
    const lu = editCommentSchema.safeParse({ text: texte })
    if (!lu.success) {
      setInvalide(texte.trim() === "" ? CHAMP.vide : CHAMP.tropLong(COMMENT_MAX_CHARS))
      champ.current?.focus()
      return
    }
    setInvalide(null)
    surEnvoi(lu.data.text)
  }
  const surTouche = (evenement: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((evenement.ctrlKey || evenement.metaKey) && evenement.key === "Enter") {
      evenement.preventDefault()
      envoyer()
      return
    }
    if (choix.length === 0) return
    const gestes: Record<string, () => void> = {
      ArrowDown: () => setRang((courant + 1) % choix.length),
      ArrowUp: () => setRang((courant - 1 + choix.length) % choix.length),
      Enter: () => choisir(choix[courant]),
      Tab: () => choisir(choix[courant]),
      Escape: () => setListeFermee(true),
    }
    const geste = gestes[evenement.key]
    if (!geste) return
    evenement.preventDefault()
    evenement.stopPropagation()
    geste()
  }

  return (
    <div className="oto-commentaire-champ">
      <Textarea
        ref={champ}
        value={texte}
        placeholder={`${libelle} ${CHAMP.aide}`}
        aria-label={libelle}
        aria-autocomplete="list"
        aria-controls={choix.length > 0 ? `${id}-mentions` : undefined}
        aria-activedescendant={choix.length > 0 ? `${id}-mentions-${courant}` : undefined}
        aria-invalid={message !== null || undefined}
        aria-describedby={message !== null ? `${id}-erreur` : undefined}
        onChange={(evenement) => {
          setTexte(evenement.target.value)
          setListeFermee(false)
          setRang(0)
          suivre(evenement.target)
        }}
        // Le curseur déplacé sans frappe (flèches, clic) : lu une fois le geste fini, jamais pendant la touche qui choisit une mention.
        onKeyUp={(evenement) => suivre(evenement.currentTarget)}
        onClick={(evenement) => suivre(evenement.currentTarget)}
        onBlur={() => setListeFermee(true)}
        onKeyDown={surTouche}
      />
      {choix.length > 0 && <ListeDesMentions id={`${id}-mentions`} choix={choix} rang={courant} choisir={choisir} />}
      <Encadres texte={texte} lecteurs={lecteurs} email={vue?.mailEnabled === true} />
      {message !== null && (
        <p id={`${id}-erreur`} role="alert" className="oto-field-error">
          {message}
        </p>
      )}
      <div className="oto-commentaire-gestes">
        <Button size="sm" variant="ghost" onClick={surAbandon} disabled={envoi}>
          {CHAMP.annuler}
        </Button>
        <Button size="sm" variant="primary" onClick={envoyer} disabled={texte.trim() === ""} loading={envoi} aria-busy={envoi || undefined}>
          {libelleEnvoyer}
        </Button>
      </div>
    </div>
  )
}
