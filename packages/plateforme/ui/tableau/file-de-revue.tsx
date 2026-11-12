// La file de revue d'un tableau (E07-S03, AC10 ; H99, HN-E07S03-1) : l'îlot « À revoir », au-dessus du
// tableau, qui appelle une décision ; le compte des lignes à l'état de revue en pastille et en phrase ; pour
// un rédacteur, les premières dans l'ordre des clés (chacune sa clé, puis ses valeurs et leurs preuves),
// entre lesquelles il choisit ou passe (M54), et l'îlot de la décision, monté même quand la file est vide,
// pour garder le résumé de la session. Un lecteur n'a que
// le compte. Server Component : l'îlot reçoit des données (chemin, clé, révision, états) et les valeurs déjà
// rendues, jamais une fonction ; après une décision, le focus va à l'îlot lui-même.
//
// Porté d'oto-frontend (`src/components/shared/attentes.tsx`, `WaitList` et `WaitItem` du design system ;
// `src/components/datastore/file-du-tableau.tsx`) : l'îlot distinct de ce qui attend une décision, son
// compte en pastille, l'état vide, l'îlot qui reçoit le focus quand la ligne décidée s'en va. Retiré :
// « Libérer » et la colonne « Exécution » (`run`), le dialogue de confirmation (une décision par ligne, en un
// clic, E07-S03), l'îlot qui disparaît après la dernière décision (le résumé de la session y reste).
// E11-S05 (AC-a5, HN-E11S05-4) : sous le titre, une phrase dit le cycle d'une ligne avec les états déclarés.
import type { TableColumn, TableHeader, TableReviewQueue, TableRowRead } from "../../schemas"
import type { Resultat } from "../api/resultat"
import type { LienDeLHote } from "../arbre/navigateur-d-arbre"
import { ErreurDeLecture } from "../components/erreur-de-lecture"
import { EmptyState } from "../ds/react/empty-state"
import { WaitList } from "../ds/react/wait-list"
import { nombreLisible } from "../format/nombres"
import { Cellule, valeurDe } from "./cellule"
import { DecisionDeRevue } from "./decision-de-revue"
import { aRevoir, FICHE, REVUE } from "./libelles"

/** L'îlot de la file : le focus y va après une décision (`accessibility-patterns.md § Focus Management`). */
const ANCRE_DE_LA_REVUE = "tableau-revue"

type FileDeRevueProps = {
  chemin: string
  entete: TableHeader
  revue: Resultat<TableReviewQueue>
  /** Écriture sur le tableau (niveau 2 ou plus) : la ligne courante et la décision. */
  redacteur: boolean
  Lien: LienDeLHote
  /** L'adresse courante, pour « Réessayer ». */
  ici: string
}

type ProvenanceLue = NonNullable<TableRowRead["provenance"]>[string]

/** Un lien de preuve rendu comme une cellule URL : un lien externe en `http(s)` seulement, sinon un texte. */
const SOURCE: TableColumn = { name: "source", type: "url" }

/**
 * La preuve d'une valeur sur la fiche (fiche D99, M54, P3) : son commentaire et son lien, la raison d'un
 * `verified_empty`, ou « sans preuve » pour une valeur écrite par un assistant qui n'en porte pas dans un
 * tableau qui l'exige (`proof`, fiche D133 ; E11-S01, AC-f7) ; rien pour une valeur importée ou décidée par
 * une personne sans commentaire. Sans elle, une valeur sans preuve (défaut P1) ne se voit pas au moment de
 * la décider.
 */
function PreuveDeLaValeur({ provenance, raisonDuVide, exigee }: { provenance: ProvenanceLue | undefined; raisonDuVide: string | undefined; exigee: boolean }) {
  const commentaire = raisonDuVide ?? provenance?.comment
  const lien = provenance?.link
  if (commentaire === undefined && lien === undefined) {
    return exigee && provenance?.origin === "agent" ? <span className="text-mute"> ({FICHE.sansPreuve})</span> : null
  }
  return (
    <span className="text-mute">
      {" ("}
      {commentaire !== undefined && `« ${commentaire} »`}
      {commentaire !== undefined && lien !== undefined && ", "}
      {lien !== undefined && <Cellule colonne={SOURCE} valeur={lien} />}
      {")"}
    </span>
  )
}

/**
 * Les valeurs de la ligne à revoir (AC10), au format de la grille, la clé non répétée, chacune suivie de sa
 * preuve (P3) : « entreprise Mairie de Valbrune · contact Anne Roy (« Page équipe ») · … ». La colonne d'état
 * n'a pas de preuve à montrer : la file la pose.
 */
function ValeursDeLaLigne({ entete, ligne }: { entete: TableHeader; ligne: TableRowRead }) {
  const colonnes = entete.columns.filter((colonne) => colonne.name !== entete.key)
  const etat = entete.lifecycle?.column
  return (
    <>
      {colonnes.map((colonne, rang) => {
        const valeur = valeurDe(ligne, colonne, entete.key)
        const raisonDuVide = ligne.verified_empty?.find((vide) => vide.column === colonne.name)?.reason
        const aPreuve = colonne.name !== etat && (valeur !== undefined || raisonDuVide !== undefined)
        return (
          <span key={colonne.name}>
            {rang > 0 && " · "}
            <span className="font-medium">{colonne.name}</span> <Cellule colonne={colonne} valeur={valeur} raisonDuVide={raisonDuVide} />
            {aPreuve && <PreuveDeLaValeur provenance={ligne.provenance?.[colonne.name]} raisonDuVide={raisonDuVide} exigee={entete.proof === true} />}
          </span>
        )
      })}
    </>
  )
}

export function FileDeRevue({ chemin, entete, revue, redacteur, Lien, ici }: FileDeRevueProps) {
  const cycle = entete.lifecycle
  const etats = cycle?.review
  if (!cycle || !etats) return null
  const file = revue.error === undefined ? revue.data : null
  // Aucune pastille quand il n'y a rien : un « 0 » se lirait comme un compteur en panne, pas comme le calme.
  const pastille = file && file.count > 0 ? nombreLisible(file.count) : undefined
  return (
    // Une file vide ne se montre pas (`data-vide`, `home.css`), sauf après une revue faite dans la session : son résumé reste à copier.
    <WaitList id={ANCRE_DE_LA_REVUE} tabIndex={-1} label={REVUE.titre} count={pastille} data-vide={file && file.count === 0 ? "" : undefined}>
      {/* Le cycle des états, pour qui lit comme pour qui décide (E11-S05, AC-a5). */}
      <p className="oto-caption px-2 pt-1">{REVUE.cycle({ ...cycle, review: etats })}</p>
      {revue.error !== undefined && <ErreurDeLecture titre={REVUE.enEchec} message={revue.error} href={ici} Lien={Lien} />}
      {file && file.count === 0 && <EmptyState compact title={REVUE.rien} />}
      {file && file.count > 0 && <p className="oto-caption px-2 pt-1">{aRevoir(file.count)}</p>}
      {file && redacteur && (
        <DecisionDeRevue
          key={chemin}
          table={chemin}
          lignes={file.rows.map((ligne) => ({ key: String(ligne.key), revision: ligne.revision, valeurs: <ValeursDeLaLigne entete={entete} ligne={ligne} /> }))}
          total={file.count}
          etats={{ refuser: etats.reject, approuver: etats.approve }}
          ancre={ANCRE_DE_LA_REVUE}
        />
      )}
    </WaitList>
  )
}
