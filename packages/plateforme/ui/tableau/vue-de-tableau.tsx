// La vue d'un tableau rendue en place dans une page (E07-S03, AC15 ; H56) : une table compacte, la
// colonne clé en tête, 20 lignes au plus, « <n> lignes sur <total> » et le lien « Ouvrir le tableau ».
// Server Component : il entre dans l'éditeur d'E05-S02 déjà rendu, jamais comme composant (AC17). Sans
// lui, un bloc `reference` avec `view` ne serait qu'un lien.
//
// Repris d'oto-frontend (`src/api/generated/schema.d.ts`, `EmbeddedContent`) : le contenu cité au fil
// du texte. Retiré : le volume, le mode d'injection. La table est celle du design system (`TableServeur`,
// M31).
import type { ScreenView } from "../../schemas"
import type { LienDeLHote } from "../arbre/navigateur-d-arbre"
import { LIEN } from "../components/classes"
import { TableServeur } from "../components/table-serveur"
import { Cellule, valeurDe } from "./cellule"
import { lignesSur, REFERENCES } from "./libelles"

type VueDeTableauProps = { vue: ScreenView; Lien: LienDeLHote; hrefDuChemin: (chemin: string) => string }

export function VueDeTableau({ vue, Lien, hrefDuChemin }: VueDeTableauProps) {
  const titre = REFERENCES.vue(vue.title)
  return (
    <div className="space-y-2">
      {vue.rows.length === 0 ? (
        <p className="text-sm text-ink">{REFERENCES.vueVide}</p>
      ) : (
        <>
          {/* Le titre, vu ; la légende de la table le dit au lecteur d'écran, une seule fois. */}
          <p aria-hidden="true" className="text-sm font-medium text-ink">
            {titre}
          </p>
          <TableServeur legende={titre} colonnes={vue.columns.map((colonne) => ({ entete: colonne.name }))}>
            {vue.rows.map((ligne) => (
              <tr key={String(ligne.key)}>
                {vue.columns.map((colonne) =>
                  colonne.name === vue.key ? (
                    <th key={colonne.name} scope="row">
                      <Cellule colonne={colonne} valeur={valeurDe(ligne, colonne, vue.key)} liens={{ Lien, hrefDuChemin }} />
                    </th>
                  ) : (
                    <td key={colonne.name}>
                      <Cellule colonne={colonne} valeur={valeurDe(ligne, colonne, vue.key)} liens={{ Lien, hrefDuChemin }} />
                    </td>
                  ),
                )}
              </tr>
            ))}
          </TableServeur>
        </>
      )}
      <p className="flex flex-wrap gap-x-3 text-sm text-ink">
        <span>{lignesSur(vue.rows.length, vue.total)}</span>
        <Lien href={hrefDuChemin(vue.path)} className={LIEN}>
          {REFERENCES.ouvrirLeTableau}
        </Lien>
      </p>
    </div>
  )
}
