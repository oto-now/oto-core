"use client"

// Les liens d'un champ en place réduits à leur titre pendant la frappe (1.4.12), comme dans un Texte (story
// `liens-en-edition`, `use-liens-masques.ts`) : le résumé et le corps d'un menu dépliant, une cellule d'un tableau
// simple. Le champ montre `[[Titre]]`, chaque frappe rendue à la source ; au focus, le dessin du texte montré se pose sur
// le champ (`oto-block-miroir`), son texte transparent dessous (`editeur.css`). Sans lui, ces champs montraient au focus
// la source entière d'un lien (`[[chemin|Titre]]`, `\|` dans une cellule), bien plus longue que son titre lu au repos.
import { useState, type ChangeEvent, type ClipboardEvent, type RefObject } from "react"
import { MorceauxMontres } from "./miroir-des-liens"
import { useLiensMasques } from "./use-liens-masques"

/** `ecrire(source, curseur)` : la frappe rendue en source, curseur en position de la source, que l'appelant écrit. */
export function useChampEnPlace(texte: string, champ: RefObject<HTMLTextAreaElement | null>, lectureSeule: boolean, ecrire: (source: string, curseur: number) => void) {
  const masque = useLiensMasques(texte, true, false, champ)
  const [auFocus, setAuFocus] = useState(false)
  const frapper = (ecrit: { source: string; curseur: number }) => ecrire(ecrit.source, ecrit.curseur)
  return {
    /** Les propriétés du `<textarea>` : sa valeur montrée, la frappe, la copie et la coupe en source. */
    champ: {
      value: masque.visible,
      "data-miroir": masque.reduit ? "" : undefined,
      onChange: (evenement: ChangeEvent<HTMLTextAreaElement>) => frapper(masque.ecrire(evenement.target.value, evenement.target.selectionStart)),
      onCopy: (evenement: ClipboardEvent<HTMLTextAreaElement>) => void masque.copier(evenement),
      onCut: (evenement: ClipboardEvent<HTMLTextAreaElement>) => masque.couper(evenement, lectureSeule, frapper),
    },
    /** Le focus entre ou sort : le dessin des liens réduits ne se pose qu'au focus. */
    suivreLeFocus: setAuFocus,
    /** Le dessin du texte montré, au focus d'un champ dont un lien est réduit ; à poser après le champ et son rendu au repos. */
    miroir:
      auFocus && masque.reduit ? (
        <span className="oto-inline-field oto-block-miroir" aria-hidden="true">
          <MorceauxMontres morceaux={masque.morceaux} />
        </span>
      ) : null,
  }
}
