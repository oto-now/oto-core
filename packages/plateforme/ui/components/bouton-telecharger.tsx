"use client"

// « Télécharger en .csv » ou « Télécharger en .md » d'un contenu (E11-S05, lots c et d) : dans l'en-tête d'un nœud
// publié, le fichier que compose le service (`GET tables/export` ou `GET nodes/export`, E10-S01), le bouton désactivé
// pendant l'appel, un refus dit sous lui en `role="alert"` ; sur la page publique, un fichier déjà composé par la page
// à partir de ce qu'elle a lu, qui part sans requête. Îlot client au plus bas : l'en-tête et la page publique sont
// des Server Components, qui ne créent pas de `Blob`. Sans lui, qui lit un contenu ne le télécharge que depuis le
// « ⋯ » du rail, et le visiteur d'une page publique pas du tout. `iconeSeule` : « Télécharger en .md » de l'en-tête d'un
// contenu, où « Page ⇄ Procédure » prend la place de son texte ; l'icône, nommée et expliquée par le libellé, reste
// focalisable pendant l'appel (`aria-disabled`, `aria-busy`), qui la remplace par le cercle qui tourne du design system
// (`CircleNotch`, `oto-spin`, figé sous mouvement réduit) : `IconButton` n'a pas d'état de chargement propre.
import { useState } from "react"
import { CircleNotch } from "@phosphor-icons/react/dist/csr/CircleNotch"
import { DownloadSimple } from "@phosphor-icons/react/dist/csr/DownloadSimple"
import { messageDErreur } from "../api/messages"
import { telechargerLeFichier, telechargerLExport, type FichierRendu, type FormatDExport } from "../api/telecharger"
import { EXPORTS } from "../coque/libelles"
import { AnimatedIcon, Icon } from "../ds/react/icon"
import { Button, IconButton } from "../ds/react/primitives"
import { Tooltip } from "../ds/react/tooltip"

type BoutonTelechargerProps = {
  format: FormatDExport
  libelle: string
  /** L'icône seule, sous une infobulle qui dit le libellé, nom accessible compris. */
  iconeSeule?: boolean
} & ({ chemin: string; fichier?: never } | { chemin?: never; fichier: FichierRendu })

export function BoutonTelecharger({ format, libelle, iconeSeule, chemin, fichier }: BoutonTelechargerProps) {
  const [enCours, setEnCours] = useState(false)
  const [refus, setRefus] = useState<string | null>(null)
  async function exporter(du: string) {
    setEnCours(true)
    setRefus(null)
    try {
      const issue = await telechargerLExport(du, format)
      if (issue.erreur) setRefus(messageDErreur(issue.erreur, EXPORTS.refus))
    } finally {
      setEnCours(false)
    }
  }
  const cliquer = () => {
    if (enCours) return
    if (fichier) return telechargerLeFichier(fichier, format)
    if (chemin !== undefined) void exporter(chemin)
  }
  const bouton = iconeSeule ? (
    <Tooltip content={libelle} side="bottom">
      <IconButton label={libelle} variant="secondary" size="sm" aria-disabled={enCours || undefined} aria-busy={enCours || undefined} onClick={cliquer}>
        {enCours ? <Icon as={CircleNotch} size="xs" className="oto-spin" /> : <AnimatedIcon as={DownloadSimple} size="xs" />}
      </IconButton>
    </Tooltip>
  ) : (
    <Button variant="secondary" size="sm" iconStart={<AnimatedIcon as={DownloadSimple} size="xs" />} loading={enCours} onClick={cliquer}>
      {libelle}
    </Button>
  )
  return (
    <>
      {bouton}
      {/* Sous la rangée de l'en-tête (`order-last`, pleine largeur), jamais entre ses boutons. */}
      {refus && (
        <p role="alert" className="oto-field-error order-last basis-full">
          {refus}
        </p>
      )}
    </>
  )
}
