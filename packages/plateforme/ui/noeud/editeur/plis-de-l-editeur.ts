"use client"

// Les titres dans l'éditeur : quelles rangées un titre replié cache, le chevron qui replie et déplie, et la section qui
// s'ouvre quand le focus doit y aller (une flèche, un déplacement, « Annuler »). Chaque titre se replie ; ouvert par
// défaut, sauf ceux que ce navigateur a gardés repliés (`plis-gardes.ts`). L'état se tient par clé de rangée, celle d'un
// bloc servi étant son `id` (`rangeesDepuis`), et se garde par `id` : un bloc pas encore parti n'est pas gardé.
import { useCallback, useEffect, useState } from "react"
import { headingOf, sectionEnd } from "../../../schemas/blocks-render"
import { foldsAround, hiddenByFolds } from "../../../schemas/folds"
import { garderLePli, plisGardes } from "../plis-gardes"
import type { Rangee } from "./modele"

export function usePlisDeLEditeur() {
  const [replies, setReplies] = useState<ReadonlySet<string>>(() => new Set())
  useEffect(() => setReplies((avant) => new Set([...avant, ...[...plisGardes()].flatMap(([id, ouvert]) => (ouvert ? [] : [id]))])), [])

  /** Les titres `rangees` ouverts (`true`) ou repliés, et gardés comme tels dans ce navigateur. */
  const changer = useCallback((rangees: readonly Rangee[], ouvert: boolean) => {
    setReplies((avant) => {
      const suivants = new Set(avant)
      for (const { cle } of rangees) {
        if (ouvert) suivants.delete(cle)
        else suivants.add(cle)
      }
      return suivants
    })
    for (const { bloc } of rangees) if (bloc.id !== undefined) garderLePli(bloc.id, ouvert)
  }, [])

  /** Les rangées que cache un titre replié, par rang. */
  const cachees = (modele: readonly Rangee[]): boolean[] => hiddenByFolds(modele.map((rangee) => rangee.bloc), (_, rang) => !replies.has(modele[rang].cle))

  /** Les titres sans section, par rang : leur chevron ne replie rien, et s'efface à moitié (`BoutonDuPli`). */
  const sansSection = (modele: readonly Rangee[]): boolean[] => {
    const niveaux = modele.map((rangee) => headingOf(rangee.bloc)?.level ?? null)
    return niveaux.map((niveau, rang) => niveau !== null && sectionEnd(niveaux, rang) === rang + 1)
  }

  /** Le focus doit aller à la rangée `cle` : chaque titre replié qui la cache s'ouvre. */
  const reveler = useCallback(
    (cle: string, modele: readonly Rangee[]) => {
      const rang = modele.findIndex((rangee) => rangee.cle === cle)
      const titres = foldsAround(
        modele.map((rangee) => rangee.bloc),
        rang,
      )
      changer(
        titres.map((titre) => modele[titre]),
        true,
      )
    },
    [changer],
  )

  return { replies, changer, cachees, sansSection, reveler }
}
