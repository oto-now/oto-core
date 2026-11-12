"use client"

// La bulle de commentaire d'un bloc (parcours 5.4, AC14), à droite du bloc, en lecture comme en édition (l'emplacement
// `menu` de `BlockRow`) : au survol ou au focus du bloc, elle ouvre un nouveau fil sur lui ; quand le bloc a des fils
// ouverts, elle reste, avec leur nombre, et ouvre le premier, dont le passage est surligné. Rien sur un bloc jamais
// publié (le service ne commente que la version publiée), ni hors du fournisseur des commentaires (page publique,
// widget). Sans elle, un fil ne se poserait que sur la page entière.
import { ChatText } from "@phosphor-icons/react/dist/csr/ChatText"
import { Icon } from "../../ds/react/icon"
import { IconButton } from "../../ds/react/primitives"
import { Tooltip } from "../../ds/react/tooltip"
import { FOCUS, useCommentaires, useFocusDemande } from "./contexte"
import { BULLE } from "./libelles"

type BulleDeBlocProps = {
  /** L'identifiant du bloc ; absent pour un bloc que le serveur ne connaît pas encore. */
  bloc: string | undefined
  /** Les premiers mots du bloc : ils distinguent sa bulle de celle de ses voisins. */
  mots: string
}

export function BulleDeBloc({ bloc, mots }: BulleDeBlocProps) {
  const commentaires = useCommentaires()
  const bouton = useFocusDemande<HTMLButtonElement>(FOCUS.bulle(bloc ?? ""))
  if (!commentaires || bloc === undefined || !commentaires.blocsPublies.has(bloc)) return null
  const fils = commentaires.lecture.phase === "lue" ? commentaires.lecture.vue.threads : []
  const ouverts = fils.filter((fil) => fil.block === bloc && fil.status === "open")
  const actif = commentaires.blocActif === bloc ? "" : undefined
  if (ouverts.length > 0) {
    return (
      <Tooltip content={BULLE.filsAide(ouverts.length)} side="left">
        <button ref={bouton} type="button" className="oto-bulle-compte" data-actif={actif} aria-label={BULLE.fils(ouverts.length, mots)} onClick={() => commentaires.ouvrirLeFil(ouverts[0].id, true)}>
          <Icon as={ChatText} size="xs" />
          <span aria-hidden="true">{ouverts.length}</span>
        </button>
      </Tooltip>
    )
  }
  return (
    <Tooltip content={BULLE.commenterAide} side="left">
      <IconButton ref={bouton} size="sm" label={BULLE.nom(mots)} className="oto-bulle" data-actif={actif} onClick={() => commentaires.commenter(bloc, null)}>
        <Icon as={ChatText} size="xs" />
      </IconButton>
    </Tooltip>
  )
}
