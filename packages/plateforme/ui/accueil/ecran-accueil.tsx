// L'accueil (E05-S09, partie b, AC-b1) : le salut, la recherche, « Brancher un assistant » en aparté, le fil
// des activités de la semaine (le journal) et les procédures utiles ; le premier jour prend la place du
// fil et retire les cartes quand rien n'a encore tourné. Server Component : les îlots client ne reçoivent
// que des données. Porté d'oto-frontend (`accueil/ecran-accueil.tsx`). Repris : l'en-tête réduit au salut
// (ni fil d'Ariane ni action : l'accueil est la racine), `HomeLayout` et ses quatre créneaux, les états
// réunis à l'écran (un îlot reçoit une donnée déjà lue), le premier jour qui retire les cartes. Changé : les
// données viennent de la page de l'hôte, lues sous le jeton de la session (`resultat`), au lieu de TanStack
// Query ; une identité illisible se dit une fois, avec « Réessayer ». Retiré : « Agents et activités » (le
// fil reste, seul), « Connecteurs » (V2), « En attente de vous » et le résumé de l'en-tête, qu'aucun service
// ne compose (`portage-ecrans.md § 5`).
//
// E11-S10 (AC-e3) : l'îlot principal, « Activités » (le fil, ou le premier jour), sans onglets ; la vue
// « Contexte » est un écran à elle (`EcranDuContexte`, menu du compte).
//
// E05-S12 (lot B, AC-18, HN-E05S12-20) : l'îlot principal seul à gauche ; à droite la recherche, « Brancher
// un assistant », puis « Procédures les plus utilisées » ; « Contenus récents » quitte l'accueil.
//
// 1.4.13 : à gauche, la carte « Reprendre » (Récents, Les plus consultés, Fil) ; à droite, « Brancher votre
// assistant », « Lancer » (les procédures les plus utilisées, la demande à copier), puis « Nouveautés depuis votre
// dernière visite ». La recherche de l'accueil part : celle du rail suffit.
import type { Resultat } from "../api/resultat"
import type { LienDeLHote } from "../arbre/navigateur-d-arbre"
import { ErreurDeLecture } from "../components/erreur-de-lecture"
import type { ExempleDePrompt } from "../connexion/types"
import { HomeLayout } from "../ds/react/home"
import { Island, IslandBody } from "../ds/react/island"
import { ScreenHeader } from "../ds/react/screen-header"
import { Skeleton } from "../ds/react/skeleton"
import { BranchementIA } from "./branchement-ia"
import { FirstDay } from "./first-day"
import { ACCUEIL } from "./libelles"
import { Lancer } from "./lancer"
import { Reprendre } from "./reprendre"
import { MARQUE_DE_CONVERSATION, type DonneesDeLAccueil } from "./types"

/** Le salut, décoratif : le titre se lit sans lui. */
const SALUT = <span aria-hidden="true">👋</span>

export type EcranDAccueilProps = {
  /** Ce que la page a lu ; `{ error }` quand l'identité n'a pas pu l'être. */
  donnees: Resultat<DonneesDeLAccueil>
  Lien: LienDeLHote
  /** L'adresse du journal : « Tout le journal ». */
  hrefDuJournal: string
  /** L'adresse d'une conversation au journal, par son code `ctx` : le petit lien d'une procédure lancée l'ouvre. */
  hrefDeConversation: (code: string) => string
  /** Le préfixe des pages de l'arbre (« /n/ ») : l'adresse d'un contenu est ce préfixe suivi de son chemin. */
  prefixeDesPages: string
}

/**
 * Le premier jour (AC-16) : aucune activité cette semaine, aucun assistant jamais branché. Une lecture en
 * échec n'est pas un vide : l'écran ne conclut jamais de ce qu'il ne sait pas.
 */
function estLePremierJour({ activites, connexions }: DonneesDeLAccueil): boolean {
  return activites.data?.activities.length === 0 && connexions.data?.length === 0
}

type IlotDesActivitesProps = Omit<EcranDAccueilProps, "donnees"> & { lu: DonneesDeLAccueil; premierJour: boolean }

/**
 * L'îlot principal, sans titre (1.4.13, retours du 21/10) : ses onglets et ses filtres tiennent l'en-tête (`Reprendre`) ;
 * le premier jour, sa phrase (HN-E05S11-11). La région se nomme toujours « Reprendre ».
 */
function IlotDesActivites({ lu, premierJour, hrefDuJournal, hrefDeConversation, prefixeDesPages }: IlotDesActivitesProps) {
  return (
    <Island aria-label={ACCUEIL.ilot}>
      {premierJour ? (
        <IslandBody>
          <FirstDay />
        </IslandBody>
      ) : (
        <Reprendre
          premiere={lu.reprendre}
          premierFil={lu.activites}
          moi={lu.moi}
          hrefDuJournal={hrefDuJournal}
          // La fonction de l'hôte ne traverse pas la frontière client : son adresse, la marque à la place du code.
          modeleDeConversation={hrefDeConversation(MARQUE_DE_CONVERSATION)}
          prefixeDesPages={prefixeDesPages}
        />
      )}
    </Island>
  )
}

/** Les procédures utiles, déjà lues pour l'îlot de droite, sont les demandes à essayer du guide (E11-S09, AC-11). */
function exemplesDe(procedures: DonneesDeLAccueil["procedures"]): Resultat<ExempleDePrompt[]> {
  return procedures.error !== undefined ? procedures : { data: procedures.data.map(({ title }) => ({ titre: title })) }
}

export function EcranDAccueil({ donnees, ...props }: EcranDAccueilProps) {
  if (donnees.error !== undefined) {
    return (
      <>
        <ScreenHeader icon={SALUT} title={ACCUEIL.bonjour(null)} />
        <HomeLayout main={<ErreurDeLecture message={donnees.error} />} />
      </>
    )
  }
  const lu = donnees.data
  const premierJour = estLePremierJour(lu)
  return (
    <>
      <ScreenHeader icon={SALUT} title={ACCUEIL.bonjour(lu.nom)} />
      <HomeLayout
        main={<IlotDesActivites {...props} lu={lu} premierJour={premierJour} />}
        cards={
          <>
            <BranchementIA adresse={lu.adresse} exemples={exemplesDe(lu.procedures)} connexions={lu.connexions} />
            {/* Le premier jour retire les procédures : une façon de plus de dire « il n'y a rien » à côté d'un îlot qui le dit déjà. */}
            {!premierJour && <Lancer procedures={lu.procedures} Lien={props.Lien} prefixeDesPages={props.prefixeDesPages} />}
          </>
        }
      />
    </>
  )
}

/** Le chargement, que l'hôte passe en `fallback` de son `<Suspense>` : le conteneur parle, les rectangles se taisent. */
export function EcranDAccueilChargement() {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-3">
      <span className="oto-sr-only">{ACCUEIL.chargement}</span>
      <Skeleton shape="text" width="16rem" />
      <HomeLayout main={<Skeleton shape="card" />} cards={<Skeleton shape="card" />} />
    </div>
  )
}
