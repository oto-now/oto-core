"use client"

// Les lignes d'un tableau dans la table du design system (E07-S03, AC2 à AC4, AC6 ; H93, H96) : les colonnes
// déclarées dans leur ordre, la clé en première cellule de la ligne, chaque
// cellule au format de son type, le bail dans la cellule clé ; chaque en-tête trie (un bouton, `aria-sort`) et
// porte le filtre de sa colonne. Îlot client, parce que la table du design system rend ses cellules par des
// fonctions et mesure leur débordement : il reçoit des données (en-tête, lignes, réglages, adresse), jamais
// une fonction, et navigue par l'hôte (`useHote`). Le tri se fait par le service : l'adresse change, la page
// relit (`tables-patterns.md § L'état de la table vit dans l'URL`).
//
// E11-S05 (AC-a4) : une ligne à l'état de revue porte le repère de ligne du design system.
//
// 1.4.11 : les liens `[[…]]` d'une cellule de texte s'y suivent, l'adresse d'un nœud bâtie sur `prefixeDesPages`.
//
// Porté d'oto-frontend (`src/components/noeud/corps-tableau.tsx`, `colonneDuDS` et la `Table`) : toutes les
// colonnes triables, le filtre posé dans l'en-tête et gardé visible quand il est posé, l'identité de la ligne
// venue de la donnée, jamais son rang. Changé : la colonne clé est la colonne principale (oto-frontend : la
// première), une colonne `number` est numérique. Retiré : les colonnes dérivées d'une table libre (le schéma
// est déclaré, H91), la teinte des lignes « récemment écrites ».
import type { ReactNode } from "react"
import type { TableColumn, TableHeader, TableRowRead } from "../../schemas"
import type { Liens } from "../noeud/rendu-des-blocs"
import { Table, type Column } from "../ds/react/table"
import { heureCourte } from "../format/dates"
import { useHote } from "../hote/navigation"
import { adresseDuTableau, avecTri, type Reglages } from "./adresse"
import { contenuDeCellule, valeurDe } from "./cellule"
import { FiltreDeColonne } from "./filtre-de-colonne"
import { GRILLE } from "./libelles"

type Ecran = { entete: TableHeader; reglages: Reglages; adresse: string; liens?: Pick<Liens, "Lien" | "hrefDuChemin"> }

/** Le bail en cours d'une ligne réservée, dans sa cellule clé (AC2) : « en cours · claude-claire jusqu'à 14:05 ». */
function Bail({ ligne, entete }: { ligne: TableRowRead; entete: TableHeader }) {
  if (!ligne.claim) return null
  return <span className="block text-xs font-normal text-mute">{GRILLE.bail(entete.lifecycle?.working, ligne.claim.worker, heureCourte(ligne.claim.until) ?? "")}</span>
}

/** Le lien de l'hôte, pour un lien `[[…]]` d'une cellule : la navigation sans recharger le document. */
function LienDeLaCellule({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  const { Lien } = useHote()
  return (
    <Lien href={href} className={className}>
      {children}
    </Lien>
  )
}

/** Une cellule (AC2, AC3) : un texte nu reste une chaîne, que la table tronque et redit en infobulle. */
function rendu(ligne: TableRowRead, colonne: TableColumn, { entete, liens }: Ecran): ReactNode {
  const raisonDuVide = ligne.verified_empty?.find((vide) => vide.column === colonne.name)?.reason
  const cellule = contenuDeCellule({ colonne, valeur: valeurDe(ligne, colonne, entete.key), raisonDuVide, provenance: ligne.provenance?.[colonne.name], liens })
  if (colonne.name !== entete.key || !ligne.claim) return cellule
  return (
    <>
      {cellule}
      <Bail ligne={ligne} entete={entete} />
    </>
  )
}

/**
 * Le repère d'une ligne (E11-S05, AC-a4, HN-E11S05-3) : `review` quand sa colonne d'état vaut l'état de revue que
 * l'en-tête déclare (fond et barre de `table.css`) ; aucun autre état ne se marque.
 */
function etatDeLaLigne(ligne: TableRowRead, entete: TableHeader): "review" | undefined {
  const cycle = entete.lifecycle
  if (!cycle?.review) return undefined
  return valeurDe(ligne, { name: cycle.column, type: "enum" }, entete.key) === cycle.review.state ? "review" : undefined
}

/** Une colonne déclarée traduite en colonne du design system : triable, filtrable, rendue au format de son type. */
function colonneDuDS(colonne: TableColumn, ecran: Ecran): Column<TableRowRead> {
  const { entete, reglages, adresse } = ecran
  return {
    key: colonne.name,
    header: colonne.name,
    numeric: colonne.type === "number",
    primary: colonne.name === entete.key,
    sortable: true,
    // Visible sans survol quand un filtre est posé : sinon on arrive sur un tableau qui ne montre pas tout, et rien ne le dit.
    filterOn: reglages.clauses.some((clause) => clause.colonne === colonne.name),
    filter: <FiltreDeColonne colonne={colonne} entete={entete} reglages={reglages} adresse={adresse} />,
    render: (ligne) => rendu(ligne, colonne, ecran),
  }
}

const colonnesDuDS = (ecran: Ecran) => ecran.entete.columns.map((colonne) => colonneDuDS(colonne, ecran))

type GrilleProps = Omit<Ecran, "liens"> & {
  /** Le début de l'adresse d'un nœud (`/n/`) : les liens `[[…]]` d'une cellule s'y suivent ; absent, ils se lisent tels quels. */
  prefixeDesPages?: string
  lignes: TableRowRead[]
  /** Le nom du tableau pour un lecteur d'écran, qui parcourt les tableaux d'une page. */
  legende: string
}

export function Grille({ entete, reglages, adresse, prefixeDesPages, lignes, legende }: GrilleProps) {
  const { naviguer } = useHote()
  const liens = prefixeDesPages === undefined ? undefined : { Lien: LienDeLaCellule, hrefDuChemin: (chemin: string) => `${prefixeDesPages}${chemin}` }
  return (
    <Table<TableRowRead>
      caption={legende}
      // Défile en largeur dans son îlot, jamais en cartes : une fenêtre de bureau étroite garde tri et filtres par colonne (fiche D97 B).
      responsive="scroll"
      columns={colonnesDuDS({ entete, reglages, adresse, liens })}
      rows={lignes}
      // La clé du service, jamais le rang : une liste qui s'allonge et se retrie recyclerait les nœuds au mauvais endroit.
      getRowId={(ligne) => String(ligne.key)}
      rowState={(ligne) => etatDeLaLigne(ligne, entete)}
      sort={reglages.tri ? { key: reglages.tri.colonne, dir: reglages.tri.sens } : undefined}
      // Le sens que la table calcule est celui d'`avecTri` : croissant, puis décroissant sur la colonne triée croissante.
      onSortChange={(tri) => naviguer(adresseDuTableau(adresse, avecTri(reglages, tri.key)))}
    />
  )
}
