"use client"

// Le bouton « Commentaires » de l'en-tête d'un contenu (refonte #218, D8) : la bulle et le nombre de fils ouverts (aucun
// « 0 »), une pastille à la couleur du thème quand un fil est non lu pour la personne (`filsNonLus`), le nom qui dit les deux.
// Il ouvre et ferme le panneau des commentaires. Sans lui, le panneau ne s'ouvre que par la bulle d'un bloc.
import { ChatText } from "@phosphor-icons/react/dist/csr/ChatText"
import { Icon } from "../../ds/react/icon"
import { Button } from "../../ds/react/primitives"
import { Tooltip } from "../../ds/react/tooltip"
import { ACTIONS } from "../libelles"
import { filsNonLus, useCommentaires } from "./contexte"

export function BoutonDesCommentaires() {
  const commentaires = useCommentaires()
  if (!commentaires) return null
  const fils = commentaires.lecture.phase === "lue" ? commentaires.lecture.vue.threads : []
  const ouverts = fils.filter((fil) => fil.status === "open").length
  const nonLus = filsNonLus(fils).length
  const ouvert = commentaires.encartOuvert
  return (
    <Tooltip content={ACTIONS.commentaires} side="bottom">
      <Button
        variant="ghost"
        size="sm"
        className="oto-node-action"
        data-non-lu={nonLus > 0 ? "" : undefined}
        aria-label={ACTIONS.nomDesCommentaires(ouverts, nonLus)}
        aria-expanded={ouvert}
        iconStart={<Icon as={ChatText} size="sm" />}
        onClick={() => commentaires.ouvrirLEncart(!ouvert)}
      >
        {ouverts > 0 ? ouverts : null}
      </Button>
    </Tooltip>
  )
}
