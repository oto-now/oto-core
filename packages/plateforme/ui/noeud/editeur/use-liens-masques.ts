// Le champ d'un bloc montre ses liens réduits à leur titre (story `liens-en-edition`) : le texte montré, chaque frappe
// rendue à la source, le curseur reposé quand le texte montré n'est pas celui qu'on a tapé (un lien tapé en entier qui
// se réduit, un titre vidé), la copie et la coupe en source (AC-8). Le masque du champ monté est retenu pour le clavier
// et le focus de l'éditeur (`retenirLeMasque`). Fichier à part de `champ-de-bloc.tsx` (borne de 300 lignes).
import { useLayoutEffect, useMemo, useRef, type ClipboardEvent, type RefObject } from "react"
import { appliquer, masquer, retenirLeMasque, sansLienReduit, sourceDeLaSelection, versSource, versVisible, type Ecriture, type Masque } from "./liens-masques"

/**
 * `actif` : le champ écrit des liens (ni code, ni appel) ; sinon son texte se montre tel quel. `parLigne` : une liste.
 * `ecrire(nouveau, curseur)` rend la frappe en source, que l'appelant envoie à l'éditeur.
 */
export function useLiensMasques(texte: string, actif: boolean, parLigne: boolean, champ: RefObject<HTMLTextAreaElement | null>) {
  const masque: Masque = useMemo(() => (actif ? masquer(texte, parLigne) : { visible: texte, morceaux: [{ genre: "texte", texte }] }), [texte, actif, parLigne])
  // Les liens rendus à leur titre par une frappe, le temps du champ : l'annulation qui les remet retrouve leur source (AC-5).
  const retenus = useRef(new Map<string, string>())
  // Le curseur à reposer, en position de la source, quand le texte montré diffère de celui tapé.
  const aReposer = useRef<number | null>(null)
  useLayoutEffect(() => {
    const element = champ.current
    if (!element) return
    retenirLeMasque(element, masque)
    if (aReposer.current === null) return
    const place = versVisible(masque, aReposer.current)
    aReposer.current = null
    element.setSelectionRange(place, place)
  })
  const ecrire = (nouveau: string, curseur: number): Ecriture => {
    const ecrit = appliquer(masque, nouveau, curseur, retenus.current)
    if (masquer(ecrit.source, parLigne).visible !== nouveau) aReposer.current = ecrit.curseur
    return ecrit
  }
  const reduit = !sansLienReduit(masque)
  /** La source de la sélection en `text/plain` ; `null` quand le navigateur copie lui-même (aucun lien réduit, rien de sélectionné). */
  const copier = (evenement: ClipboardEvent<HTMLTextAreaElement>): { debut: number; fin: number } | null => {
    const { selectionStart: debut, selectionEnd: fin } = evenement.currentTarget
    if (!reduit || debut === fin) return null
    evenement.preventDefault()
    evenement.clipboardData.setData("text/plain", sourceDeLaSelection(masque, debut, fin))
    return { debut, fin }
  }
  return {
    visible: masque.visible,
    morceaux: masque.morceaux,
    masque,
    reduit,
    ecrire,
    versSource: (position: number) => versSource(masque, position),
    copier,
    /**
     * La coupe : la source copiée, puis la sélection retirée comme une frappe, rendue à `frapper` ; le navigateur coupe
     * lui-même sans lien réduit. Un champ en lecture seule copie seulement.
     */
    couper(evenement: ClipboardEvent<HTMLTextAreaElement>, lectureSeule: boolean, frapper: (ecrit: Ecriture) => void) {
      const coupe = copier(evenement)
      if (!coupe || lectureSeule) return
      const ecrit = ecrire(`${masque.visible.slice(0, coupe.debut)}${masque.visible.slice(coupe.fin)}`, coupe.debut)
      aReposer.current = ecrit.curseur
      frapper(ecrit)
    },
  }
}
