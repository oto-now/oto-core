"use client"

// Les titres repliables dans l'éditeur : quelles rangées un titre replié cache, le chevron qui replie et déplie, et la
// section qui s'ouvre quand le focus doit y aller (une flèche, un déplacement, « Annuler »). Repliés à l'ouverture de la
// page, sauf ceux que ce navigateur a gardés ouverts (`plis-gardes.ts`) ; un titre qu'on vient de rendre repliable
// reste ouvert, pour que l'auteur ne perde pas de vue ce qu'il écrit. L'état se tient par clé de rangée, celle d'un bloc
// servi étant son `id` (`rangeesDepuis`), et se garde par `id` : un bloc pas encore parti n'est pas gardé.
import { useCallback, useEffect, useState } from "react"
import { foldsAround, hiddenByFolds } from "../../../schemas/folds"
import { garderLePli, plisOuverts } from "../plis-gardes"
import type { Rangee } from "./modele"

export function usePlisDeLEditeur() {
  const [ouverts, setOuverts] = useState<ReadonlySet<string>>(() => new Set())
  useEffect(() => setOuverts((avant) => new Set([...avant, ...plisOuverts()])), [])

  /** Les titres `rangees` ouverts (`true`) ou refermés, et gardés comme tels dans ce navigateur. */
  const changer = useCallback((rangees: readonly Rangee[], ouvert: boolean) => {
    setOuverts((avant) => {
      const suivants = new Set(avant)
      for (const { cle } of rangees) {
        if (ouvert) suivants.add(cle)
        else suivants.delete(cle)
      }
      return suivants
    })
    for (const { bloc } of rangees) if (bloc.id !== undefined) garderLePli(bloc.id, ouvert)
  }, [])

  /** Les rangées que cache un titre replié, par rang. */
  const cachees = (modele: readonly Rangee[]): boolean[] => hiddenByFolds(modele.map((rangee) => rangee.bloc), (_, rang) => ouverts.has(modele[rang].cle))

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

  return { ouverts, changer, cachees, reveler }
}
