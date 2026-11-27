"use client"

// L'état des commentaires d'une page (parcours 5.4), partagé par le panneau des commentaires, le bouton de l'en-tête et les bulles
// des blocs du document : les fils lus (d'abord ceux que la page de l'hôte a lancés sans les attendre, avant de compter la
// visite, sinon `GET comments?path=` ; puis `GET comments?path=` à chaque relecture), le fil
// ouvert, le nouveau fil en cours d'écriture, l'onglet et l'ouverture du panneau, le focus à rendre après un geste. Il
// reçoit l'écran déjà rendu par le serveur (`portage-ecrans.md § 2`). Sans lui, la bulle d'un bloc ne saurait ni
// compter ses fils ni ouvrir le panneau, que l'en-tête ouvre aussi.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import type { CommentThreadStatus, CommentThreadView, NodeCommentsView } from "../../../schemas/comments"
import { messageDErreur } from "../../api/messages"
import type { Resultat } from "../../api/resultat"
import { lireLesFils } from "./api"
import { ContexteDesCommentaires, filsNonLus, FOCUS, type Brouillon, type Commentaires, type LectureDesFils } from "./contexte"
import { allerAuBloc, surlignerLePassage } from "./passage"
import { CommenterLaSelection } from "./selection"

/** Le panneau tient à droite du texte : la fenêtre atteint le palier `--bp-lg` que déclare la racine `.oto`. */
function panneauALaPlace(): boolean {
  if (typeof window.matchMedia !== "function") return false
  const racine = document.querySelector(".oto") ?? document.documentElement
  const palier = parseInt(getComputedStyle(racine).getPropertyValue("--bp-lg"), 10) || 1024
  return window.matchMedia(`(min-width: ${palier}px)`).matches
}

/** Les fils dans l'ordre du service : ouverts d'abord ; un fil adopté garde sa place, un fil neuf prend la tête. */
function avecLeFil(fils: readonly CommentThreadView[], fil: CommentThreadView): CommentThreadView[] {
  return fils.some((un) => un.id === fil.id) ? fils.map((un) => (un.id === fil.id ? fil : un)) : [fil, ...fils]
}

/** Une lecture des fils : celle que la page a servie, sinon une demande à l'API, sous la même forme. */
async function lire(chemin: string, servie: Promise<Resultat<NodeCommentsView>> | null): Promise<Resultat<NodeCommentsView>> {
  if (servie) return servie
  const reponse = await lireLesFils(chemin)
  return reponse.erreur ? { error: messageDErreur(reponse.erreur) } : { data: reponse.data }
}

/**
 * La lecture des fils du nœud : au montage (celle que la page a servie, s'il y en a une), à chaque publication
 * (`revision`), et sur demande (`relire`).
 */
function useLectureDesFils(chemin: string, revision: number, servie: Promise<Resultat<NodeCommentsView>> | undefined, surPremiereLecture: (vue: NodeCommentsView) => void) {
  const [lecture, setLecture] = useState<LectureDesFils>({ phase: "chargement" })
  const [tour, setTour] = useState(0)
  const premiere = useRef(true)
  useEffect(() => {
    let perime = false
    void lire(chemin, premiere.current ? (servie ?? null) : null).then((resultat) => {
      if (perime) return
      if (resultat.error !== undefined) {
        // Une relecture de fond en échec (après une publication) garde les fils déjà lus ; la première dit l'échec.
        setLecture((avant) => (avant.phase === "lue" ? avant : { phase: "erreur", message: resultat.error }))
        return
      }
      setLecture({ phase: "lue", vue: resultat.data })
      if (premiere.current) surPremiereLecture(resultat.data)
      premiere.current = false
    })
    return () => {
      perime = true
    }
  }, [chemin, revision, tour, servie, surPremiereLecture])
  const relire = useCallback(() => {
    setLecture({ phase: "chargement" })
    setTour((avant) => avant + 1)
  }, [])
  return { lecture, setLecture, relire }
}

type FournisseurProps = {
  /** Le chemin du nœud : ses fils se lisent et s'écrivent par lui. */
  chemin: string
  /** La révision publiée : une publication fait relire les fils (« passage modifié depuis », « passage supprimé »). */
  revision: number
  /** Les identifiants des blocs publiés : seuls eux se commentent. */
  blocsPublies: readonly string[]
  /**
   * La première lecture des fils, lancée par la page de l'hôte avant qu'elle ne compte la visite en cours : lus après,
   * le « non lu » se calculerait sur cette visite même, et aucun fil ne le serait. Absente, l'écran les lit par l'API.
   */
  filsServis?: Promise<Resultat<NodeCommentsView>>
  children: ReactNode
}

export function FournisseurDeCommentaires({ chemin, revision, blocsPublies, filsServis, children }: FournisseurProps) {
  const [onglet, choisirLOnglet] = useState<CommentThreadStatus>("open")
  const [encartOuvert, ouvrirLEncart] = useState(false)
  const [actif, setActif] = useState<string | null>(null)
  const [brouillon, setBrouillon] = useState<Brouillon | null>(null)
  const [focus, demanderLeFocus] = useState<string | null>(null)
  // Le panneau s'ouvre à l'arrivée quand un fil est non lu pour la personne (D8), et seulement là où il ne recouvre pas
  // le texte : en tiroir modal, sous 1 024 px, il prendrait le focus à l'ouverture de la page.
  const surPremiereLecture = useCallback((vue: NodeCommentsView) => ouvrirLEncart(filsNonLus(vue.threads).length > 0 && panneauALaPlace()), [])
  const { lecture, setLecture, relire } = useLectureDesFils(chemin, revision, filsServis, surPremiereLecture)
  const publies = useMemo(() => new Set(blocsPublies), [blocsPublies])
  const fils = lecture.phase === "lue" ? lecture.vue.threads : null
  const filActif = fils?.find((fil) => fil.id === actif) ?? null
  const blocActif = brouillon ? brouillon.bloc : (filActif?.block ?? null)
  const citationActive = brouillon ? brouillon.citation : (filActif?.quote ?? null)

  // Le passage du fil ouvert, ou du nouveau fil, surligné dans son bloc ; effacé quand l'écran part.
  useEffect(() => {
    surlignerLePassage(blocActif, citationActive)
    return () => surlignerLePassage(null, null)
  }, [blocActif, citationActive])

  const commenter = useCallback((bloc: string | null, citation: string | null) => {
    setBrouillon({ bloc, citation, origine: bloc === null ? FOCUS.page : FOCUS.bulle(bloc) })
    setActif(null)
    choisirLOnglet("open")
    ouvrirLEncart(true)
  }, [])
  const retirerLaCitation = useCallback(() => setBrouillon((avant) => avant && { ...avant, citation: null }), [])
  const fermerLeBrouillon = useCallback((cle: string) => {
    setBrouillon(null)
    demanderLeFocus(cle)
  }, [])
  const ouvrirLeFil = useCallback(
    (id: string, prendreLeFocus: boolean) => {
      const fil = fils?.find((un) => un.id === id)
      if (!fil) return
      setBrouillon(null)
      setActif(id)
      choisirLOnglet(fil.status)
      ouvrirLEncart(true)
      if (prendreLeFocus) demanderLeFocus(FOCUS.fil(id))
      if (fil.block !== null) allerAuBloc(fil.block)
    },
    [fils],
  )
  const adopter = useCallback(
    (fil: CommentThreadView, cle?: string) => {
      setLecture((avant) => (avant.phase === "lue" ? { phase: "lue", vue: { ...avant.vue, threads: avecLeFil(avant.vue.threads, fil) } } : avant))
      // Un fil résolu quitte l'onglet « Ouverts » : il n'est plus le fil ouvert, son passage n'est plus surligné.
      if (fil.status === "resolved") setActif((avant) => (avant === fil.id ? null : avant))
      if (cle !== undefined) demanderLeFocus(cle)
    },
    [setLecture],
  )
  const retirer = useCallback(
    (id: string) => {
      setLecture((avant) => (avant.phase === "lue" ? { phase: "lue", vue: { ...avant.vue, threads: avant.vue.threads.filter((fil) => fil.id !== id) } } : avant))
      setActif((avant) => (avant === id ? null : avant))
      demanderLeFocus(FOCUS.liste)
    },
    [setLecture],
  )

  const valeur = useMemo<Commentaires>(
    () => ({
      chemin,
      lecture,
      relire,
      blocsPublies: publies,
      onglet,
      choisirLOnglet,
      encartOuvert,
      ouvrirLEncart,
      actif,
      activer: setActif,
      blocActif,
      brouillon,
      commenter,
      retirerLaCitation,
      fermerLeBrouillon,
      ouvrirLeFil,
      adopter,
      retirer,
      focus,
      demanderLeFocus,
    }),
    [chemin, lecture, relire, publies, onglet, encartOuvert, actif, blocActif, brouillon, commenter, retirerLaCitation, fermerLeBrouillon, ouvrirLeFil, adopter, retirer, focus],
  )
  return (
    <ContexteDesCommentaires.Provider value={valeur}>
      {children}
      <CommenterLaSelection />
    </ContexteDesCommentaires.Provider>
  )
}
