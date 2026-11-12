"use client"

// Ce que partagent l'encart « Commentaires » et les bulles des blocs (parcours 5.4) : la forme de l'état des
// commentaires d'une page, son contexte React, et le focus rendu après un geste. L'état lui-même est tenu par
// `FournisseurDeCommentaires` (`fournisseur-de-commentaires.tsx`). Sans ce module, le fournisseur et le bouton de la
// sélection, qu'il monte, s'importeraient l'un l'autre.
import { createContext, useContext, useEffect, useRef } from "react"
import type { CommentThreadStatus, CommentThreadView, NodeCommentsView } from "../../../schemas/comments"

/** Où en est la lecture des fils : les quatre états de l'encart en sortent (`vide` se lit dans `lue`). */
export type LectureDesFils = { phase: "chargement" } | { phase: "erreur"; message: string } | { phase: "lue"; vue: NodeCommentsView }

/** Un nouveau fil en cours d'écriture : son bloc (nul pour la page entière), sa citation, et où rendre le focus s'il est abandonné. */
export type Brouillon = { bloc: string | null; citation: string | null; origine: string }

export type Commentaires = {
  chemin: string
  lecture: LectureDesFils
  relire: () => void
  blocsPublies: ReadonlySet<string>
  onglet: CommentThreadStatus
  choisirLOnglet: (onglet: CommentThreadStatus) => void
  encartOuvert: boolean
  ouvrirLEncart: (ouvert: boolean) => void
  /** Le fil ouvert : sa carte est mise en valeur, son bloc aussi. */
  actif: string | null
  activer: (id: string | null) => void
  /** Le bloc mis en valeur dans le document : celui du fil ouvert, ou du nouveau fil en cours. */
  blocActif: string | null
  brouillon: Brouillon | null
  /** Ouvre un nouveau fil sur `bloc` (nul : la page entière), avec ou sans citation. */
  commenter: (bloc: string | null, citation: string | null) => void
  retirerLaCitation: () => void
  /** Ferme le nouveau fil en cours ; `focus` : la clé de ce qui reprend le focus. */
  fermerLeBrouillon: (focus: string) => void
  /** Ouvre un fil : son onglet, sa carte, son bloc amené dans la vue ; `focus` : sa carte prend le focus (depuis la bulle d'un bloc). */
  ouvrirLeFil: (id: string, focus: boolean) => void
  /** Adopte un fil tel que le service vient de le rendre (créé, complété, modifié, résolu, rouvert). */
  adopter: (fil: CommentThreadView, focus?: string) => void
  /** Retire un fil supprimé avec son premier commentaire. */
  retirer: (id: string) => void
  /** La clé de l'élément qui doit prendre le focus (`useFocusDemande`), nulle une fois pris. */
  focus: string | null
  demanderLeFocus: (cle: string | null) => void
}

export const ContexteDesCommentaires = createContext<Commentaires | null>(null)

/** Les commentaires de la page, ou `null` hors de leur fournisseur (page publique, widget, visionneuse) : pas de bulle. */
export function useCommentaires(): Commentaires | null {
  return useContext(ContexteDesCommentaires)
}

/** Les clés de focus : la liste des fils, une carte, la bulle d'un bloc, « Commenter la page ». */
export const FOCUS = {
  liste: "liste",
  page: "page",
  fil: (id: string) => `fil:${id}`,
  bulle: (bloc: string) => `bulle:${bloc}`,
} as const

/**
 * La référence d'un élément qui prend le focus quand un geste le lui rend (`demanderLeFocus(cle)`) : après un envoi, un
 * abandon, une résolution, une suppression. L'effet court après le rendu qui monte l'élément ; pris, la demande est levée.
 */
export function useFocusDemande<T extends HTMLElement>(cle: string) {
  const commentaires = useCommentaires()
  const ref = useRef<T>(null)
  const demande = commentaires?.focus === cle
  const lever = commentaires?.demanderLeFocus
  useEffect(() => {
    if (!demande || !ref.current) return
    ref.current.focus()
    lever?.(null)
  }, [demande, lever])
  return ref
}
