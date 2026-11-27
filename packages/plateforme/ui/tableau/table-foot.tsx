// Le pied d'un tableau (E07-S03, AC7, AC8 ; H97) : les lignes affichées sur celles qui répondent, et le
// geste pour en avoir plus — « Charger plus », 20 lignes de plus jusqu'à 200, puis « Affinez… » —, puis le
// résumé sous la même recherche et les mêmes filtres (le compte de chaque état, la somme de chaque colonne
// nombre) ; un résumé en échec se dit à sa place, avec « Réessayer » (`ErreurDeLecture`, M49), sans casser la
// grille. Server Component : « Charger plus » et « Réessayer » sont des liens de l'hôte, habillés en boutons
// du design system (un bouton qui navigue casse le clic milieu et l'ouverture dans un onglet).
//
// Porté d'oto-frontend (`src/components/noeud/table-foot.tsx`) : le compte à gauche, le geste au bout de la
// ligne, aucun numéro de page, le seul total venu du service ; l'échec qui se répare à côté de son geste.
// Changé : « Charger plus » relit la page à `n` lignes (l'adresse de l'hôte), au lieu de la page suivante
// en client (TanStack Query). Ajouté : le résumé des agrégats (oto-frontend n'en rendait pas).
import type { TableGridRows, TableGridSummary, TableHeader } from "../../schemas"
import type { Resultat } from "../api/resultat"
import type { LienDeLHote } from "../arbre/navigateur-d-arbre"
import { ErreurDeLecture } from "../components/erreur-de-lecture"
import { nombreLisible } from "../format/nombres"
import { auMaximum, avecPlus, type Reglages } from "./adresse"
import { affichees, GRILLE, libelleDuNom } from "./libelles"
import { LienBouton } from "./lien-bouton"

type Navigation = { reglages: Reglages; Lien: LienDeLHote; hrefDuTableau: (reglages: Reglages) => string }

/** Le résumé (AC8), sous la même recherche et les mêmes filtres ; un calcul en échec ne casse pas la grille. */
function Resume({ resume, entete, reglages, Lien, hrefDuTableau }: Navigation & { resume: Resultat<TableGridSummary>; entete: TableHeader }) {
  if (resume.error !== undefined) return <ErreurDeLecture titre={GRILLE.resumeEnEchec} message={resume.error} href={hrefDuTableau(reglages)} Lien={Lien} />
  const { states, sums } = resume.data
  return (
    <div className="oto-caption">
      {states && entete.lifecycle && <p>{`Par ${libelleDuNom(entete.columns, entete.lifecycle.column)} : ${states.map((etat) => `${etat.state} ${nombreLisible(etat.count)}`).join(" · ")}`}</p>}
      {sums.map((somme) => (
        <p key={somme.column}>{`${libelleDuNom(entete.columns, somme.column)} : total ${nombreLisible(somme.total)}`}</p>
      ))}
    </div>
  )
}

type TableFootProps = Navigation & { lu: TableGridRows; resume: Resultat<TableGridSummary>; entete: TableHeader }

export function TableFoot({ lu, resume, entete, ...navigation }: TableFootProps) {
  const { reglages, Lien, hrefDuTableau } = navigation
  // Le seul nombre venu d'ailleurs que les lignes rendues est le total du service.
  const reste = lu.rows.length < lu.total
  return (
    <div className="flex w-full flex-col gap-1.5">
      <div className="flex w-full flex-wrap items-center gap-3">
        <span className="oto-caption">{affichees(lu.rows.length, lu.total)}</span>
        {reste && !auMaximum(reglages) && (
          <span className="ml-auto">
            <LienBouton Lien={Lien} href={hrefDuTableau(avecPlus(reglages))} variante="secondary">
              {GRILLE.chargerPlus}
            </LienBouton>
          </span>
        )}
        {reste && auMaximum(reglages) && <span className="oto-caption ml-auto">{GRILLE.affinez}</span>}
      </div>
      <Resume resume={resume} entete={entete} {...navigation} />
    </div>
  )
}
