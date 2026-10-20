// Le tableau d'un nœud `table` (E07-S03, AC1 à AC14) : l'îlot de la file de revue quand l'en-tête déclare
// une revue, puis l'îlot du tableau (barre, table, pied). Passé par l'hôte dans l'emplacement de complément
// de l'écran de nœud (`complement`) : la méta, le titre et le résumé restent ceux de l'écran, et un tableau
// n'y rend aucun bloc de document ; il apporte ses îlots, comme tout écran posé dans le contenu (E05-S09).
// Server Component : il reçoit les lectures de la page de l'hôte en `resultat`, son lien et l'adresse du
// tableau pour des réglages ; la barre, la table, le filtre d'une colonne, la décision et le résumé de la
// revue sont des îlots qui reçoivent des données. Sans lui, les lignes d'un tableau ne se lisent qu'à
// travers un assistant.
//
// Porté d'oto-frontend (`src/routes/n.$nodeId.lazy.tsx`, `CorpsTableauDuNoeud`) : les îlots du corps d'un
// tableau posés l'un sous l'autre, dans le contenu. Retiré : « Qui s'en sert » et l'îlot d'activité du
// tableau (le journal d'une ligne, V2 : E07-S03 hors périmètre).
// E10-S01 (AC-b5) : pour qui l'écrit, le corps du tableau reçoit un `.csv` lâché sur lui (`DepotSurLeTableau`), vide
// compris ; « Importer un fichier… » est dans l'en-tête de l'écran (E11-S15, AC-a7).
import type { TableGridRows, TableGridSummary, TableHeader, TableReviewQueue } from "../../schemas"
import type { Resultat } from "../api/resultat"
import type { LienDeLHote } from "../arbre/navigateur-d-arbre"
import { Island, IslandBody } from "../ds/react/island"
import { Skeleton } from "../ds/react/skeleton"
import { DepotSurLeTableau } from "../coque/import-de-fichier"
import type { Reglages, ReglagesLus } from "./adresse"
import { CorpsTableau } from "./corps-tableau"
import { FileDeRevue } from "./file-de-revue"
import { GRILLE } from "./libelles"

export type TableauDuNoeudProps = {
  /** Le chemin courant du tableau. */
  chemin: string
  titre: string
  /** L'en-tête publié (H91). */
  entete: TableHeader
  lignes: Resultat<TableGridRows>
  resume: Resultat<TableGridSummary>
  /** La file de revue ; absente quand l'en-tête ne déclare pas de revue (AC10). */
  revue?: Resultat<TableReviewQueue>
  reglages: ReglagesLus
  /** Le niveau de la personne sur le tableau : dès l'écriture, la ligne à revoir et la décision. */
  niveau: 1 | 2 | 3
  Lien: LienDeLHote
  /** L'adresse du tableau pour des réglages, construite par l'hôte. */
  hrefDuTableau: (reglages: Reglages) => string
  /** L'adresse du tableau sans paramètre : l'action des formulaires GET. */
  adresse: string
  /**
   * La famille de l'assistant le plus récent de la personne (`lastConnections`), lue par l'hôte pour un tableau sans
   * ligne seulement (E11-S05, AC-h1) ; absente, « votre assistant ».
   */
  assistant?: string
  /** Le début de l'adresse d'un nœud (`/n/`) : les liens `[[…]]` d'une cellule s'y suivent ; absent, ils se lisent tels quels (1.4.11). */
  prefixeDesPages?: string
}

export function TableauDuNoeud(props: TableauDuNoeudProps) {
  const { chemin, entete, revue, reglages, Lien, hrefDuTableau } = props
  const corps = (
    <CorpsTableau
      entete={entete}
      titre={props.titre}
      lignes={props.lignes}
      resume={props.resume}
      reglages={reglages}
      avis={reglages.ignores}
      Lien={Lien}
      hrefDuTableau={hrefDuTableau}
      adresse={props.adresse}
      assistant={props.assistant}
      prefixeDesPages={props.prefixeDesPages}
    />
  )
  return (
    <div className="flex flex-col gap-3">
      {revue && <FileDeRevue chemin={chemin} entete={entete} revue={revue} redacteur={props.niveau >= 2} Lien={Lien} ici={hrefDuTableau(reglages)} />}
      {props.niveau >= 2 ? (
        <DepotSurLeTableau chemin={chemin} titre={props.titre} entete={entete}>
          {corps}
        </DepotSurLeTableau>
      ) : (
        corps
      )}
    </div>
  )
}

/**
 * Le chargement des lignes (AC9), `fallback` du `<Suspense>` de l'hôte : l'îlot du tableau et huit lignes
 * fantômes aux dimensions d'une ligne, jamais un spinner, qui ne réserve pas la place ; le conteneur parle,
 * pas les rectangles (`corps-tableau.tsx` d'oto-frontend, `SqueletteDuTableau`).
 */
export function EcranDeTableauChargement() {
  return (
    <Island>
      <IslandBody>
        <div role="status" aria-busy="true" className="flex flex-col gap-2">
          <span className="oto-sr-only">{GRILLE.chargement}</span>
          {Array.from({ length: 8 }, (_, rang) => (
            // Aucune donnée n'existe encore : le rang est l'identité de la ligne fantôme, qui ne bouge jamais.
            <Skeleton key={rang} shape="row" />
          ))}
        </div>
      </IslandBody>
    </Island>
  )
}
