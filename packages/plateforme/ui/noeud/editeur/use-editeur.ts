"use client"

// L'état de l'éditeur de blocs (E05-S02 ; E05-S08) : le modèle local, nommé comme tel, les messages des
// blocs refusés, le focus posé impérativement après chaque geste, le différé de 1 200 ms du champ où l'on
// tape (HN-E05S08-1) et la garde de départ (`beforeunload`, AC5). Il reprend les blocs servis quand une
// relecture en apporte de nouveaux, s'il n'a ni champ modifié, ni bloc neuf pas encore parti, ni écriture en
// attente, ni conflit ; sinon il garde les siens. E05-S10 (AC-a6) : il participe à la publication seule, à
// qui il envoie son texte en attente et dit ce qui la retient. Sans lui, pas d'édition.
// E11-S05 (AC-g1, AC-g2) : une page sans bloc a son Texte vide, qui prend le focus à l'ouverture quand le titre est
// déjà écrit ; ce Texte, pas encore parti, ne retient pas une relecture.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import type { BlockView } from "../../../schemas"
import { actionsDeLEditeur, aEnvoyer } from "./actions"
import { useFichiersDeLEditeur } from "./envoi-de-fichier"
import { useFileDOperations } from "./file-d-operations"
import { placeDansLeChamp } from "./liens-masques"
import type { BlocEdite, Focus, Rangee } from "./modele"
import { estLaPageVide, modeleDeLaPage } from "./page-vide"
import { useEnvois, type Identite } from "./use-envois"

/** 1 200 ms sans frappe : le différé d'oto-frontend (`use-autosave.ts`), appliqué au bloc (HN-E05S08-1). */
const DIFFERE_MS = 1_200

/** Les blocs partis, par rangée : un bloc servi ; jamais le Texte d'une page vide, qui n'a pas d'`id` et part en insertion. */
function fixesDe(modele: readonly Rangee[]): Map<string, BlocEdite> {
  return new Map(modele.flatMap((rangee) => (rangee.bloc.id === undefined ? [] : [[rangee.cle, rangee.bloc] as const])))
}

function identitesDe(modele: readonly Rangee[]): Map<string, Identite> {
  return new Map(
    modele.flatMap(({ cle, bloc: { id, ref, revision } }) => (id !== undefined && ref !== undefined && revision !== undefined ? [[cle, { id, ref, revision }]] : [])),
  )
}

/** Le message d'un bloc refusé, posé ou retiré, sans toucher à ceux des autres blocs. */
function avecErreur(erreurs: Readonly<Record<string, string>>, cle: string, message: string | null): Readonly<Record<string, string>> {
  if (message === null) return cle in erreurs ? Object.fromEntries(Object.entries(erreurs).filter(([une]) => une !== cle)) : erreurs
  return erreurs[cle] === message ? erreurs : { ...erreurs, [cle]: message }
}

type Parametres = {
  blocs: readonly BlockView[]
  revisionServie: number
  /** Le Texte d'une page vide prend le focus à l'ouverture (AC-g2) ; sinon le titre le garde. */
  focusALOuverture?: boolean
  /** Le focus va à une rangée cachée sous un titre replié : ses titres s'ouvrent (`plis-de-l-editeur.ts`). */
  reveler?: (cle: string, modele: readonly Rangee[]) => void
}

export function useEditeur({ blocs, revisionServie, focusALOuverture = false, reveler }: Parametres) {
  const file = useFileDOperations()
  const [modele, setModele] = useState<Rangee[]>(() => modeleDeLaPage(blocs))
  const modeleLu = useRef(modele)
  const fixes = useRef(fixesDe(modele))
  const ids = useRef(identitesDe(modele))
  const [erreurs, setErreurs] = useState<Readonly<Record<string, string>>>({})
  const [focus, setFocus] = useState<Focus | null>(() => (focusALOuverture && estLaPageVide(modele) ? { cle: modele[0].cle, curseur: 0 } : null))
  // Le bloc touché en dernier, dont le champ reste monté (1.1.3) ; un focus à poser dans un champ le monte dès son rendu.
  const [actif, setActif] = useState<string | null>(() => focus?.cle ?? null)
  const ouvert = focus !== null && focus.cible !== "rangee" ? focus.cle : actif
  const racine = useRef<HTMLDivElement>(null)
  const blocsVus = useRef(blocs)
  const differe = useRef<{ cle: string; minuteur: ReturnType<typeof setTimeout> } | null>(null)
  // Les gestes du dernier rendu : le différé et le départ de la page envoient avec l'état courant, conflit compris.
  const gestesLus = useRef<{ envoyerLeTexte: (cle: string) => boolean } | null>(null)
  const appui = useRef<{ cle: string; instant: number } | null>(null)

  // Le miroir en `ref` : le corps d'un envoi se calcule à l'envoi, depuis une clôture posée au geste. Stable :
  // les effets de relecture l'ont dans leurs dépendances.
  const changerModele = useCallback((suivant: Rangee[]) => {
    modeleLu.current = suivant
    setModele(suivant)
  }, [])
  const setErreur = (cle: string, message: string | null) => setErreurs((courantes) => avecErreur(courantes, cle, message))
  const annulerLeDiffere = (cle: string) => {
    if (differe.current?.cle !== cle) return
    clearTimeout(differe.current.minuteur)
    differe.current = null
  }
  const differer = (cle: string) => {
    if (differe.current) clearTimeout(differe.current.minuteur)
    const minuteur = setTimeout(() => {
      differe.current = null
      gestesLus.current?.envoyerLeTexte(cle)
    }, DIFFERE_MS)
    differe.current = { cle, minuteur }
  }
  // La page quittée par une navigation du client, sans `blur` ni `beforeunload` : le texte en attente part
  // (oto-frontend, `use-autosave.ts`, envoi au démontage). Stable : l'effet de démontage l'a pour dépendance.
  const partirAvecLeTexte = useCallback(() => {
    const enAttente = differe.current
    if (!enAttente) return
    clearTimeout(enAttente.minuteur)
    differe.current = null
    gestesLus.current?.envoyerLeTexte(enAttente.cle)
  }, [])
  useEffect(() => partirAvecLeTexte, [partirAvecLeTexte])

  const envois = useEnvois({ blocs, revisionServie, modele: modeleLu, changerModele, fixes, ids, setFocus })
  const fichiers = useFichiersDeLEditeur()
  // Le focus a quitté la rangée pour de bon : son champ se démonte, le bloc se lit ; un autre bloc touché l'a déjà remplacé.
  const fermerLeChamp = (cle: string) => setActif((courant) => (courant === cle ? null : courant))
  const actions = actionsDeLEditeur({ modele: modeleLu, changerModele, fixes, setErreur, setFocus, envois, frapper: file.frapper, differer, annulerLeDiffere, appui, fichiers, fermerLeChamp })
  // Ce qui retient la publication seule, lu à son départ : un conflit, un refus qui attend sa relecture.
  const retenues = useRef({ conflit: false, attente: false })
  useLayoutEffect(() => {
    gestesLus.current = actions
    retenues.current = { conflit: envois.conflit !== null, attente: envois.attente }
  })

  // La publication seule (E05-S10, AC-a6) : le texte en attente part avant elle ; un champ refusé la retient.
  const { participer } = file
  useEffect(
    () =>
      participer({
        vider: partirAvecLeTexte,
        retient: () =>
          retenues.current.conflit || retenues.current.attente || modeleLu.current.some((rangee) => aEnvoyer(rangee, fixes.current.get(rangee.cle))),
      }),
    [participer, partirAvecLeTexte],
  )

  // Un champ modifié pas encore parti (AC5) : la publication l'attend, et quitter l'onglet demande confirmation.
  const modifies = modele.some((rangee) => aEnvoyer(rangee, fixes.current.get(rangee.cle)))
  const occupe = file.occupee || envois.conflit !== null || envois.attente || modifies
  // Un bloc neuf pas encore parti, vide compris, n'est pas dans les blocs servis : une relecture ne l'efface pas ; sauf
  // le Texte d'une page vide, que les blocs relus remplacent (AC-g1).
  const neufs = !estLaPageVide(modele) && modele.some((rangee) => !fixes.current.has(rangee.cle))
  useEffect(() => {
    if (blocs === blocsVus.current) return
    blocsVus.current = blocs
    if (occupe || neufs) return
    const suivant = modeleDeLaPage(blocs, modeleLu.current)
    fixes.current = fixesDe(suivant)
    ids.current = identitesDe(suivant)
    changerModele(suivant)
  }, [blocs, occupe, neufs, changerModele])

  // Avant que le navigateur ne peigne : un bloc déplacé retrouve son focus dans le même tour (AC3).
  useLayoutEffect(() => {
    if (!focus) return
    setFocus(null)
    if (focus.cible !== "rangee") setActif(focus.cle)
    const rangee = racine.current?.querySelector(`[data-cle="${focus.cle}"]`)
    // Une rangée cachée ne prend pas le focus : ses titres s'ouvrent, et le focus se pose au rendu suivant.
    if (rangee instanceof HTMLElement && rangee.hidden && reveler) {
      reveler(focus.cle, modeleLu.current)
      return setFocus(focus)
    }
    // Le champ de la rangée ; sinon sa poignée (AC4).
    const champ = focus.cible === "rangee" ? null : rangee?.querySelector<HTMLElement>("[data-champ]")
    if (!champ) return void rangee?.querySelector<HTMLButtonElement>('[data-geste="poignee"]')?.focus()
    champ.focus()
    if (focus.curseur === null || !(champ instanceof HTMLTextAreaElement || champ instanceof HTMLInputElement)) return
    // Le curseur d'un geste est une place de la source ; le champ montre ses liens réduits (story `liens-en-edition`).
    const position = Math.min(placeDansLeChamp(champ, focus.curseur), champ.value.length)
    champ.setSelectionRange(position, position)
  }, [focus, reveler])

  const aProteger = modifies || file.occupee
  useEffect(() => {
    if (!aProteger) return
    // Recharger ou fermer l'onglet avec un champ modifié ou une écriture en attente : le navigateur demande (AC5).
    const retenir = (evenement: BeforeUnloadEvent) => evenement.preventDefault()
    window.addEventListener("beforeunload", retenir)
    return () => window.removeEventListener("beforeunload", retenir)
  }, [aProteger])

  // Les blocs du modèle : les refus d'une publication y trouvent la référence d'un bloc fautif (E05-S04, AC7). Le Texte
  // d'une page vide n'est pas du brouillon (HN-E11S05-19) : sans lui, un Contexte vide demande confirmation (AC11).
  const blocsDuModele = estLaPageVide(modele) ? [] : modele.map((rangee) => rangee.bloc)
  return {
    racine,
    modele,
    blocs: blocsDuModele,
    erreurs,
    envois,
    actions,
    fichiers,
    ouvert,
    ouvrirLeChamp: (cle: string, curseur: number) => setFocus({ cle, curseur }),
    activerLeChamp: (cle: string) => setActif(cle),
  }
}
