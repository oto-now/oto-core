// Le corps d'un nœud `table` (E07-S03, AC2 à AC9 ; H93, H95 à H97), un îlot nommé par le tableau : la barre
// d'outils collée à la table (recherche, « Retirer les filtres », l'avis d'un réglage écarté), puis la table
// (tri et filtre dans chaque en-tête) ou l'un des deux vides, et le pied (le compte, « Charger plus », le
// résumé). Une lecture en échec se dit dans l'îlot, avec « Réessayer », la barre gardée pour retirer ce qui
// fait échouer (une recherche sur un tableau trop grand). Server Component : il reçoit les lectures de la
// page de l'hôte, son lien et l'adresse du tableau pour des réglages ; l'îlot (qui replie le focus), la
// barre et la table sont des îlots client qui reçoivent des données et du `ReactNode` déjà rendu. Sans
// lui, les lignes d'un tableau ne se lisent qu'à travers un assistant.
//
// Porté d'oto-frontend (`src/components/noeud/corps-tableau.tsx`) : l'îlot, la barre dans un corps sans
// gouttière et sa gouttière à elle, la table bord à bord, le pied d'îlot, les deux vides (« rien pour cette
// recherche » propose de retirer la recherche et les filtres, « rien du tout » dit seulement la vérité),
// l'échec dans l'îlot ; son squelette est `EcranDeTableauChargement`. Changé : la donnée est celle de la page
// (l'adresse de l'hôte porte `n`, au lieu d'une pagination en client) ; le vide d'un tableau dit que les
// lignes viennent d'un assistant (plus d'agent) ; l'action du vide nomme ce qu'elle retire ; la barre reste
// au-dessus d'un échec. Retiré : TanStack Query, les colonnes dérivées d'une table libre (le schéma est
// déclaré, H91), la teinte des lignes « récemment écrites », « Ajouter une ligne » (aucun service n'écrit une
// ligne depuis l'écran en V1 : HN-E05S09c2-1).
import type { TableGridRows, TableGridSummary, TableHeader } from "../../schemas"
import type { Resultat } from "../api/resultat"
import type { LienDeLHote } from "../arbre/navigateur-d-arbre"
import { ErreurDeLecture } from "../components/erreur-de-lecture"
import { EmptyState } from "../ds/react/empty-state"
import { IslandBody, IslandFoot } from "../ds/react/island"
import { sansFiltres, sansRecherche, type Reglages } from "./adresse"
import { BarreDuTableau } from "./barre-du-tableau"
import { Grille } from "./grille"
import { IlotDuTableau } from "./ilot-du-tableau"
import { LienBouton } from "./lien-bouton"
import { correspondent, GRILLE, nLignes, nomDeLAssistant } from "./libelles"
import { TableFoot } from "./table-foot"

type Navigation = { reglages: Reglages; Lien: LienDeLHote; hrefDuTableau: (reglages: Reglages) => string }

export type CorpsTableauProps = Navigation & {
  entete: TableHeader
  titre: string
  lignes: Resultat<TableGridRows>
  resume: Resultat<TableGridSummary>
  /** Un réglage de l'adresse a été écarté (AC4, AC6) : l'îlot le dit. */
  avis: boolean
  /** L'adresse du tableau sans paramètre : la base des adresses que la barre et la table construisent. */
  adresse: string
  /** La famille de l'assistant le plus récent de la personne (E11-S05, AC-h1), qui nomme qui écrira les lignes. */
  assistant?: string
  /** Le début de l'adresse d'un nœud : les liens `[[…]]` d'une cellule s'y suivent (1.4.11). */
  prefixeDesPages?: string
}

/**
 * Les deux vides (AC9) : un tableau sans ligne, et qui les écrira (E11-S05, AC-h1) ; aucune ligne pour la recherche
 * ou les filtres, et le geste qui les retire.
 */
function TableauVide({ lu, reglages, Lien, hrefDuTableau, assistant }: Navigation & { lu: TableGridRows; assistant?: string }) {
  if (lu.count === 0) return <EmptyState title={GRILLE.vide}>{GRILLE.videTexte(nomDeLAssistant(assistant))}</EmptyState>
  const filtres = reglages.clauses.length > 0
  const recherche = reglages.q !== null
  // Le geste qui répare retire tout ce qui vide l'écran : ne défaire que la recherche d'un tableau aussi filtré le laisserait vide.
  const [texte, suite]: [string, Reglages] =
    filtres && recherche ? [GRILLE.retirerTout, sansRecherche(sansFiltres(reglages))] : filtres ? [GRILLE.retirerLesFiltres, sansFiltres(reglages)] : [GRILLE.effacerLaRecherche, sansRecherche(reglages)]
  const action = (filtres || recherche) && <LienBouton Lien={Lien} href={hrefDuTableau(suite)} variante="secondary">{texte}</LienBouton>
  return (
    <EmptyState title={GRILLE.aucune} action={action}>
      {GRILLE.aucuneTexte}
    </EmptyState>
  )
}

/** La barre d'outils, dans un corps sans gouttière et sa gouttière à elle : elle est collée à l'en-tête de la table. */
function Barre({ lu, avis, adresse, ...navigation }: Navigation & { lu: TableGridRows | null; avis: boolean; adresse: string }) {
  const { reglages, Lien, hrefDuTableau } = navigation
  return (
    <IslandBody flush>
      <div className="px-4 pt-4">
        <BarreDuTableau reglages={reglages} adresse={adresse} lignes={lu?.count ?? null}>
          {reglages.clauses.length > 0 && (
            <LienBouton Lien={Lien} href={hrefDuTableau(sansFiltres(reglages))} variante="ghost">
              {GRILLE.retirerLesFiltres}
            </LienBouton>
          )}
        </BarreDuTableau>
        {avis && <p className="oto-caption pb-2">{GRILLE.avisDeReglage}</p>}
      </div>
    </IslandBody>
  )
}

export function CorpsTableau(props: CorpsTableauProps) {
  const { entete, titre, lignes, resume, avis, adresse, assistant, prefixeDesPages, ...navigation } = props
  const { reglages, Lien, hrefDuTableau } = navigation
  if (lignes.error !== undefined) {
    return (
      <IlotDuTableau titre={titre}>
        <Barre lu={null} avis={avis} adresse={adresse} {...navigation} />
        <IslandBody>
          <ErreurDeLecture message={lignes.error} href={hrefDuTableau(reglages)} Lien={Lien} />
        </IslandBody>
      </IlotDuTableau>
    )
  }
  const lu = lignes.data
  const cherche = reglages.q !== null || reglages.clauses.length > 0
  return (
    <IlotDuTableau titre={titre}>
      <Barre lu={lu} avis={avis} adresse={adresse} {...navigation} />
      {lu.rows.length === 0 ? (
        <IslandBody>
          <TableauVide lu={lu} assistant={assistant} {...navigation} />
        </IslandBody>
      ) : (
        // Bord à bord : la table porte son cadre et son en-tête collant.
        <IslandBody flush>
          <Grille entete={entete} reglages={reglages} adresse={adresse} prefixeDesPages={prefixeDesPages} lignes={lu.rows} legende={`${titre} — ${nLignes(lu.count)}${cherche ? ` · ${correspondent(lu.total)}` : ""}`} />
        </IslandBody>
      )}
      <IslandFoot>
        <TableFoot lu={lu} resume={resume} entete={entete} {...navigation} />
      </IslandFoot>
    </IlotDuTableau>
  )
}
