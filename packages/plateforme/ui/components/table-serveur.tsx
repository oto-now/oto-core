// La table d'un écran serveur (E05-S09 partie d2 ; M31) : l'enveloppe qui défile dans son îlot, la légende lue
// seule, l'en-tête en mono capitales, une colonne numérique alignée à droite ; le corps est celui de l'écran.
// Server Component, sans lequel chaque écran qui liste en table (usage, retours, vue d'un tableau, liste des
// procédures) écrirait son enveloppe et son en-tête, ou les classes de `classes.ts`.
//
// Porté d'oto-frontend (src/design-system/components/react/data.jsx, `Table`, en `responsive="scroll"`
// comme les tables du suivi) : son balisage et ses classes (`table.css`). Retiré : tri, sélection,
// redimensionnement et troncature mesurée ; la `Table` est un îlot client dont les colonnes se rendent par
// des fonctions, qu'un écran serveur ne peut pas lui passer (`portage-ecrans.md § 2`).
import type { ReactNode } from "react"
import type { LienDeLHote } from "../arbre/navigateur-d-arbre"
import { LIEN } from "./classes"

export type ColonneDeTable = { entete: string; numerique?: boolean }

type LienDeCelluleProps = { Lien: LienDeLHote; href: string; children: ReactNode }

/**
 * Le lien d'une cellule vers un autre écran (la procédure, la conversation) : le lien de texte du design
 * system (`LIEN`, `.oto-link`), souligné au repos : la couleur seule ne le distinguerait pas du texte de la
 * ligne (WCAG 1.4.1, `accessibility-patterns.md`).
 */
export function LienDeCellule({ Lien, href, children }: LienDeCelluleProps) {
  return (
    <Lien href={href} className={LIEN}>
      {children}
    </Lien>
  )
}

type TableServeurProps = {
  /** La légende, lue par un lecteur d'écran : l'îlot, ou l'écran, porte déjà le titre visible. */
  legende: string
  colonnes: readonly ColonneDeTable[]
  /** Les lignes, `<tr>` de l'écran. */
  children: ReactNode
}

export function TableServeur({ legende, colonnes, children }: TableServeurProps) {
  return (
    <div className="oto-table-wrap">
      <table className="oto-table" data-responsive="scroll">
        <caption className="oto-sr-only">{legende}</caption>
        <thead>
          <tr>
            {colonnes.map((colonne) => (
              <th key={colonne.entete} scope="col" data-numeric={colonne.numerique ? "" : undefined}>
                {/* `.oto-th-cell` est une ligne flex, que le `text-align: end` du `<th>` numérique ne déplace pas : l'intitulé
                    se pose au bout, au-dessus de ses chiffres, comme `table.css` le veut. */}
                <span className={colonne.numerique ? "oto-th-cell justify-end" : "oto-th-cell"}>
                  <span className="oto-th-in">{colonne.entete}</span>
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}
