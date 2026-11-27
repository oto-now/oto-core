"use client"

// L'aperçu de ce qu'une version a changé, sous la version choisie du tiroir : le premier bloc changé (sa section, puis
// « Supprimé » et « Ajouté »), « Voir les N autres blocs » pour le reste, et les changements de l'en-tête. Lu à la
// demande (`GET nodes/history/diff`) ; chargement, échec avec « Réessayer », et rien à montrer, chacun dit.
import { useCallback, useEffect, useState } from "react"
import type { HistoryBlockChange, NodeHistoryDiffView } from "../../../schemas/node-history"
import { messageDErreur } from "../../api/messages"
import { Diff, DiffLine } from "../../ds/react/history-list"
import { Alert, Button } from "../../ds/react/primitives"
import { SkeletonText } from "../../ds/react/skeleton"
import { lireLEcart } from "./api"
import { HISTORIQUE, MOTS_DE_L_ECART } from "./libelles"

type Lecture = { etat: "chargement" } | { etat: "echec"; message: string } | { etat: "pret"; ecart: NodeHistoryDiffView }

/** L'écart d'une version, relu quand la version ou le bloc changent ; `relire` le relit après un échec. */
function useEcart(chemin: string, revision: number, bloc: string | undefined) {
  const [lecture, setLecture] = useState<Lecture>({ etat: "chargement" })
  const [tour, setTour] = useState(0)
  useEffect(() => {
    let actif = true
    setLecture({ etat: "chargement" })
    void lireLEcart(chemin, revision, bloc).then((reponse) => {
      if (!actif) return
      setLecture(reponse.erreur ? { etat: "echec", message: messageDErreur(reponse.erreur) } : { etat: "pret", ecart: reponse.data })
    })
    return () => {
      actif = false
    }
  }, [chemin, revision, bloc, tour])
  return { lecture, relire: useCallback(() => setTour((n) => n + 1), []) }
}

/** Un bloc changé : où il est, puis son texte d'avant et d'après ; un déplacement seul le dit. */
function BlocChange({ change }: { change: HistoryBlockChange }) {
  return (
    <div className="oto-history-stack" data-gap="xs">
      <p className="oto-caption">{change.section ?? HISTORIQUE.debutDeLaPage}</p>
      <Diff>
        {change.change === "moved" && <p className="oto-caption">Bloc déplacé</p>}
        {change.change !== "moved" && change.before !== null && (
          <DiffLine change="deleted" label={MOTS_DE_L_ECART.deleted}>
            {change.before}
          </DiffLine>
        )}
        {change.change !== "moved" && change.after !== null && (
          <DiffLine change="added" label={MOTS_DE_L_ECART.added}>
            {change.after}
          </DiffLine>
        )}
      </Diff>
    </div>
  )
}

const CHAMPS = { title: "Titre", summary: "Résumé", kind: "Genre" } as const

/** Les champs de l'en-tête changés : titre, résumé, genre, chacun avant et après ; les colonnes d'un tableau, nommées. */
function EnTeteChange({ ecart }: { ecart: NodeHistoryDiffView }) {
  const champs = (Object.keys(CHAMPS) as (keyof typeof CHAMPS)[]).flatMap((champ) => {
    const change = ecart.header[champ]
    return change ? [{ champ, change }] : []
  })
  if (champs.length === 0 && !ecart.schema) return null
  return (
    <>
      {champs.map(({ champ, change }) => (
        <div key={champ} className="oto-history-stack" data-gap="xs">
          <p className="oto-caption">{CHAMPS[champ]}</p>
          <Diff>
            <DiffLine change="deleted" label={MOTS_DE_L_ECART.deleted}>
              {change.before}
            </DiffLine>
            <DiffLine change="added" label={MOTS_DE_L_ECART.added}>
              {change.after}
            </DiffLine>
          </Diff>
        </div>
      ))}
      {ecart.schema && <p className="oto-caption">Colonnes modifiées</p>}
    </>
  )
}

function Blocs({ blocs, tous }: { blocs: readonly HistoryBlockChange[]; tous: boolean }) {
  return (
    <>
      {(tous ? blocs : blocs.slice(0, 1)).map((change) => (
        <BlocChange key={change.id} change={change} />
      ))}
    </>
  )
}

type ApercuDeLEcartProps = { chemin: string; revision: number; bloc?: string }

export function ApercuDeLEcart({ chemin, revision, bloc }: ApercuDeLEcartProps) {
  const { lecture, relire } = useEcart(chemin, revision, bloc)
  const [tous, setTous] = useState(false)
  if (lecture.etat === "chargement") return <SkeletonText lines={2} />

  if (lecture.etat === "echec") {
    return (
      <Alert tone="fail" title={HISTORIQUE.echecDeLEcart} actions={<Button size="sm" onClick={relire}>{HISTORIQUE.reessayer}</Button>}>
        {lecture.message}
      </Alert>
    )
  }
  const { ecart } = lecture
  const autres = ecart.total - 1
  const vide = ecart.blocks.length === 0 && Object.keys(ecart.header).length === 0 && !ecart.schema
  return (
    <>
      <EnTeteChange ecart={ecart} />
      <Blocs blocs={ecart.blocks} tous={tous} />
      {vide && <p className="oto-caption">{HISTORIQUE.aucunTexte}</p>}
      {!tous && autres > 0 && (
        <Button variant="link" size="sm" className="self-start" onClick={() => setTous(true)}>
          {HISTORIQUE.autresBlocs(autres)}
        </Button>
      )}
    </>
  )
}
