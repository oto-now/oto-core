"use client"

// La liste du tiroir « Historique des versions », dans ses quatre états : chargement (squelettes), échec (« Réessayer »),
// aucune version, et les versions (avatar, auteur, date, ce qui a changé ; la choisie marquée, son aperçu sous elle),
// puis « Voir les versions plus anciennes » quand une page suit. Interne au tiroir.
import type { HistoryEntry, NodeHistoryView } from "../../../schemas/node-history"
import { HistoryItem, HistoryList } from "../../ds/react/history-list"
import { Alert, Avatar, Button } from "../../ds/react/primitives"
import { Skeleton } from "../../ds/react/skeleton"
import { ApercuDeLEcart } from "./apercu-de-l-ecart"
import { auteurDeLaVersion, HISTORIQUE, quandLaVersion, resumeDeLaVersion } from "./libelles"
import type { LectureDesVersions } from "./use-versions"

type ListeDesVersionsProps = {
  chemin: string
  bloc: string | undefined
  lecture: LectureDesVersions
  choisie: number | null
  choisir: (revision: number | null) => void
  relire: () => void
  plus: () => void
}

function Chargement() {
  return (
    <div role="status" aria-busy="true" aria-label={HISTORIQUE.chargement} className="oto-history-stack">
      {[0, 1, 2].map((rang) => (
        <div key={rang} className="oto-history-skeleton">
          <Skeleton shape="circle" width={24} height={24} />
          <div className="oto-history-text">
            <Skeleton width="60%" />
            <Skeleton width="40%" />
          </div>
        </div>
      ))}
    </div>
  )
}

function Version({ version, vue, ouverte, choisir, chemin, bloc }: { version: HistoryEntry; vue: NodeHistoryView; ouverte: boolean; choisir: (revision: number | null) => void; chemin: string; bloc: string | undefined }) {
  const auteur = auteurDeLaVersion(version)
  return (
    <HistoryItem
      // Le nom se lit déjà dans la ligne : l'avatar est muet, sinon le bouton dirait le nom deux fois.
      lead={<Avatar size="sm" aria-hidden="true" name={version.author?.name ?? HISTORIQUE.ancienMembre} />}
      title={auteur}
      meta={quandLaVersion(version.at)}
      description={resumeDeLaVersion(version.summary, vue.kind)}
      selected={ouverte}
      onSelect={() => choisir(ouverte ? null : version.revision)}
    >
      <ApercuDeLEcart chemin={chemin} revision={version.revision} bloc={bloc} />
    </HistoryItem>
  )
}

export function ListeDesVersions({ chemin, bloc, lecture, choisie, choisir, relire, plus }: ListeDesVersionsProps) {
  if (lecture.etat === "chargement") return <Chargement />
  if (lecture.etat === "echec") {
    return (
      <Alert tone="fail" title={HISTORIQUE.echec} actions={<Button size="sm" onClick={relire}>{HISTORIQUE.reessayer}</Button>}>
        {HISTORIQUE.echecDeLaListe}
      </Alert>
    )
  }
  const { vue, versions, suite } = lecture
  if (versions.length === 0) return <p className="oto-caption">{bloc === undefined ? HISTORIQUE.vide : HISTORIQUE.videDuBloc}</p>
  return (
    <>
      <HistoryList aria-label={HISTORIQUE.liste}>
        <Versions versions={versions} vue={vue} choisie={choisie} choisir={choisir} chemin={chemin} bloc={bloc} />
      </HistoryList>
      {suite !== "aucune" && (
        <Button variant="secondary" size="sm" className="self-start" loading={suite === "en-cours"} onClick={plus}>
          {HISTORIQUE.plus}
        </Button>
      )}
      {suite === "echec" && <p role="alert" className="oto-caption">{HISTORIQUE.echecDeLaListe}</p>}
    </>
  )
}

function Versions({ versions, ...rest }: { versions: readonly HistoryEntry[]; vue: NodeHistoryView; choisie: number | null; choisir: (revision: number | null) => void; chemin: string; bloc: string | undefined }) {
  return (
    <>
      {versions.map((version) => (
        <Version key={version.revision} version={version} ouverte={rest.choisie === version.revision} {...rest} />
      ))}
    </>
  )
}
