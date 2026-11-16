"use client"

// L'encart « Commentaires » d'un nœud (parcours 5.4, AC12, AC13, AC20) : la même pastille que « Cité dans » et
// « Sous-pages » (glyphe, compte des fils ouverts, chevron), toujours présente, ouverte à l'arrivée tant qu'un fil est
// ouvert. Ouvert : les onglets « Ouverts » et « Résolus » avec leur compte, « Commenter la page », le nouveau fil en
// cours, puis les cartes. Quatre états : lecture en cours, échec avec « Réessayer » (la lecture est celle de l'îlot :
// elle se relance ici, sans relire la page), aucun fil, les fils. Il lit l'état que tient `FournisseurDeCommentaires`.
// Sans lui, les fils d'une page ne se lisent nulle part à l'écran.
import { useState } from "react"
import { ChatText } from "@phosphor-icons/react/dist/csr/ChatText"
import type { CommentThreadStatus, CommentThreadView } from "../../../schemas/comments"
import { messageDErreur } from "../../api/messages"
import { AnimatedIcon } from "../../ds/react/icon"
import { LinkedContent } from "../../ds/react/linked-content"
import { Alert, Badge, Button } from "../../ds/react/primitives"
import { Tabs } from "../../ds/react/tabs"
import { Tooltip } from "../../ds/react/tooltip"
import { envoyerUnCommentaire } from "./api"
import { CarteDeFil } from "./carte-de-fil"
import { ChampDeCommentaire } from "./champ-de-commentaire"
import { FOCUS, useCommentaires, useFocusDemande, type Brouillon, type Commentaires } from "./contexte"
import { CHAMP, COMMENTAIRES, FIL, REFUS } from "./libelles"

/** Le nouveau fil en cours d'écriture : sur la page entière, ou sur un passage et sa citation. */
function NouveauFil({ brouillon, commentaires }: { brouillon: Brouillon; commentaires: Commentaires }) {
  const [envoi, setEnvoi] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const envoyer = async (texte: string) => {
    setEnvoi(true)
    setErreur(null)
    const reponse = await envoyerUnCommentaire({
      path: commentaires.chemin,
      ...(brouillon.bloc !== null ? { block: brouillon.bloc } : {}),
      ...(brouillon.bloc !== null && brouillon.citation !== null ? { quote: brouillon.citation } : {}),
      text: texte,
    })
    setEnvoi(false)
    if (reponse.erreur) {
      // Le service ne retrouve pas la citation dans le texte publié du bloc : elle part, le texte reste, et la carte le dit.
      const citationRefusee = reponse.erreur.code === "invalid_arguments" && brouillon.citation !== null
      if (citationRefusee) commentaires.retirerLaCitation()
      setErreur(citationRefusee ? CHAMP.citationRetiree : messageDErreur(reponse.erreur, REFUS))
      return
    }
    const fil = reponse.data.thread
    commentaires.fermerLeBrouillon(FOCUS.fil(fil.id))
    commentaires.activer(fil.id)
    commentaires.adopter(fil)
  }
  return (
    <section className="oto-fil" data-nouveau="" aria-label={brouillon.bloc === null ? FIL.nouveauSurLaPage : FIL.nouveauSurUnPassage}>
      {brouillon.citation !== null && <blockquote className="oto-fil-citation">{FIL.citation(brouillon.citation)}</blockquote>}
      <ChampDeCommentaire
        libelle={CHAMP.nouveau}
        libelleEnvoyer={CHAMP.envoyer}
        envoi={envoi}
        erreur={erreur}
        surEnvoi={(texte) => void envoyer(texte)}
        surAbandon={() => commentaires.fermerLeBrouillon(brouillon.origine)}
      />
    </section>
  )
}

function Cartes({ fils, commentaires }: { fils: readonly CommentThreadView[]; commentaires: Commentaires }) {
  return fils.map((fil) => <CarteDeFil key={fil.id} fil={fil} commentaires={commentaires} />)
}

/** Les fils de l'onglet choisi, sous le nouveau fil en cours ; sans fil, la phrase qui dit comment commencer. */
function ListeDesFils({ fils, commentaires }: { fils: readonly CommentThreadView[]; commentaires: Commentaires }) {
  const liste = useFocusDemande<HTMLDivElement>(FOCUS.liste)
  const ouverts = commentaires.onglet === "open"
  const vide = ouverts ? (commentaires.blocsPublies.size > 0 ? COMMENTAIRES.aucunOuvert : COMMENTAIRES.aucunOuvertSansBloc) : COMMENTAIRES.aucunResolu
  return (
    <>
      {commentaires.brouillon && ouverts && <NouveauFil key={commentaires.brouillon.bloc ?? "page"} brouillon={commentaires.brouillon} commentaires={commentaires} />}
      <div ref={liste} tabIndex={-1} role="group" aria-label={ouverts ? COMMENTAIRES.filsOuverts : COMMENTAIRES.filsResolus} className="oto-fils">
        {fils.length === 0 ? <p className="oto-fils-vide">{vide}</p> : <Cartes fils={fils} commentaires={commentaires} />}
      </div>
    </>
  )
}

/** « Commenter la page » : un nouveau fil sans passage ; il reprend le focus si le fil est abandonné. */
function CommenterLaPage({ commentaires }: { commentaires: Commentaires }) {
  const bouton = useFocusDemande<HTMLButtonElement>(FOCUS.page)
  return (
    <Tooltip content={COMMENTAIRES.commenterLaPageAide} side="bottom">
      <Button ref={bouton} size="sm" className="oto-commenter-la-page" onClick={() => commentaires.commenter(null, null)}>
        {COMMENTAIRES.commenterLaPage}
      </Button>
    </Tooltip>
  )
}

const libelleDOnglet = (nom: string, nombre: number) => (
  <>
    {nom} <Badge count>{nombre}</Badge>
  </>
)

/** Les fils lus : les deux onglets et leur compte, « Commenter la page » sur toute la largeur sous eux, puis la liste. */
function FilsLus({ fils, commentaires }: { fils: readonly CommentThreadView[]; commentaires: Commentaires }) {
  const parEtat = (etat: CommentThreadStatus) => fils.filter((fil) => fil.status === etat)
  const ouverts = parEtat("open")
  const resolus = parEtat("resolved")
  return (
    <Tabs
      label={COMMENTAIRES.onglets}
      tabs={[
        { value: "open", label: libelleDOnglet(COMMENTAIRES.ouverts, ouverts.length) },
        { value: "resolved", label: libelleDOnglet(COMMENTAIRES.resolus, resolus.length) },
      ]}
      value={commentaires.onglet}
      onChange={(valeur) => commentaires.choisirLOnglet(valeur === "resolved" ? "resolved" : "open")}
    >
      {/* Pendant l'écriture d'un nouveau fil, le bouton s'efface : un seul nouveau fil à la fois. */}
      {!commentaires.brouillon && <CommenterLaPage commentaires={commentaires} />}
      <ListeDesFils fils={commentaires.onglet === "open" ? ouverts : resolus} commentaires={commentaires} />
    </Tabs>
  )
}

function CorpsDeLEncart({ commentaires }: { commentaires: Commentaires }) {
  const { lecture } = commentaires
  if (lecture.phase === "chargement") {
    return (
      <p role="status" aria-busy="true" className="oto-linked-note">
        {COMMENTAIRES.chargement}
      </p>
    )
  }
  if (lecture.phase === "erreur") {
    return (
      <Alert
        tone="fail"
        title={COMMENTAIRES.echec}
        actions={
          <Button size="sm" onClick={commentaires.relire}>
            {COMMENTAIRES.reessayer}
          </Button>
        }
      >
        {lecture.message}
      </Alert>
    )
  }
  return <FilsLus fils={lecture.vue.threads} commentaires={commentaires} />
}

export function EncartCommentaires() {
  const commentaires = useCommentaires()
  if (!commentaires) return null
  const { lecture, encartOuvert } = commentaires
  const ouverts = lecture.phase === "lue" ? lecture.vue.threads.filter((fil) => fil.status === "open").length : undefined
  return (
    <LinkedContent
      className="oto-commentaires"
      icon={<AnimatedIcon as={ChatText} size="xs" />}
      title={COMMENTAIRES.titre}
      // Aucune pastille à zéro : un « 0 » se lirait comme un compteur en panne, pas comme le calme.
      count={ouverts !== undefined && ouverts > 0 ? ouverts : undefined}
      // Fermé, l'encart dit quand même qu'il n'a pas pu se lire.
      summary={lecture.phase === "erreur" ? COMMENTAIRES.echec : undefined}
      open={encartOuvert}
      // Le navigateur a ouvert ou fermé le repli (clic, clavier) : l'état le suit, sans s'écrire deux fois.
      onToggle={(evenement) => evenement.currentTarget.open !== encartOuvert && commentaires.ouvrirLEncart(evenement.currentTarget.open)}
    >
      <CorpsDeLEncart commentaires={commentaires} />
    </LinkedContent>
  )
}
