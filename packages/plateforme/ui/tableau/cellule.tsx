// Une cellule d'un tableau (E07-S03, AC2, AC3 ; H93, H94) : la valeur au format de son type, « — »
// sans valeur, « vérifié vide », et le repli natif de sa provenance (qui, quand, commentaire, preuve,
// valeur importée). Sans directive ni état : rendu dans l'îlot de la grille, par la file de revue et par
// la vue d'un bloc `reference`. Jamais de `null` affiché : une ligne lue n'en porte pas (H93). Sans lui, la
// grille, la file et les vues formateraient chacune leurs valeurs.
//
// Porté d'oto-frontend (`corps-tableau.tsx`, `render` d'une colonne) : une clé absente est une cellule
// vide, pas une erreur. Retiré : le contrat de colonne en infobulle (le `Popover` de la provenance, remplacé par un
// `<details>` natif, est revenu en 1.4.11).
//
// E11-S05 (AC-a1, AC-a2) : le détail est en gris.
//
// 1.4.11 : une cellule de texte va à la ligne au-delà d'une largeur maximale (`.oto-cell-texte`, `table.css`) au lieu
// d'être coupée ; ses liens `[[…]]` et ses adresses se lisent comme dans une page (`EnLigne`), quand l'écran sait
// bâtir l'adresse d'un nœud (`liens`) ; une adresse d'une colonne `url` se montre raccourcie. La provenance s'ouvre
// par une icône « info » dans un panneau posé par-dessus le tableau (`Popover`), au lieu d'un repli qui le
// déplaçait.
import type { ReactNode } from "react"
import { Info } from "@phosphor-icons/react/dist/ssr/Info"
import type { CellValue, TableColumn, TableRowRead } from "../../schemas"
import { LIEN } from "../components/classes"
import { Icon } from "../ds/react/icon"
import { Popover, PopoverBody } from "../ds/react/popover"
import { IconButton } from "../ds/react/primitives"
import { dateEtHeureLisibles, dateLisible } from "../format/dates"
import { nombreLisible } from "../format/nombres"
import { adresseSansIdentifiants, libelleDUneAdresse } from "../noeud/en-ligne"
import { EnLigne, type Liens } from "../noeud/rendu-des-blocs"
import { PROVENANCE, TEXTES_DE_CELLULE } from "./libelles"

type ProvenanceLue = NonNullable<TableRowRead["provenance"]>[string]

/** Un lien vers l'extérieur, seulement en `http(s)` : jamais `javascript:` (`security-patterns.md § XSS Prevention`). */
const EXTERNE = /^https?:\/\//i

/** La valeur d'une cellule au format de son type (AC2) ; une valeur hors type se lit telle quelle. */
function valeurLisible(colonne: TableColumn, valeur: CellValue): string {
  if (colonne.type === "number" && typeof valeur === "number") return nombreLisible(valeur)
  if (colonne.type === "bool" && typeof valeur === "boolean") return valeur ? TEXTES_DE_CELLULE.oui : TEXTES_DE_CELLULE.non
  if (colonne.type === "date" && typeof valeur === "string") return dateLisible(valeur) ?? valeur
  if (colonne.type === "datetime" && typeof valeur === "string") return dateEtHeureLisibles(valeur) ?? valeur
  return String(valeur)
}

/** La valeur d'une colonne dans une ligne lue : `set`, ou la clé pour la colonne clé. */
export function valeurDe(ligne: TableRowRead, colonne: TableColumn, cle: string): CellValue | undefined {
  return Object.hasOwn(ligne.set, colonne.name) ? ligne.set[colonne.name] : colonne.name === cle ? ligne.key : undefined
}

/** Un lien du détail : gris comme le détail, souligné comme tout lien (AC-a2). */
const LIEN_DU_DETAIL = "rounded-sm text-mute underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-ink"

function LienExterne({ href, children, className = LIEN, title }: { href: string; children: string; className?: string; title?: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className} title={title}>
      {children}
    </a>
  )
}

/** L'origine d'une provenance en une phrase (AC3) ; `verified_empty` porte la raison écrite par l'assistant. */
function origine(provenance: ProvenanceLue, raison: string | undefined): string {
  if (provenance.origin === "agent") return PROVENANCE.agent(provenance.by)
  if (provenance.origin === "human") return PROVENANCE.human(provenance.by)
  if (provenance.origin === "import") return PROVENANCE.import
  return PROVENANCE.verifieVide(provenance.by, raison ?? "")
}

type DetailProps = { colonne: TableColumn; provenance: ProvenanceLue; raison: string | undefined }

/** Le contenu du panneau : l'origine, le moment, le commentaire, la preuve et la valeur importée (AC3). */
function DetailDeProvenance({ colonne, provenance, raison }: DetailProps) {
  const quand = dateEtHeureLisibles(provenance.at)
  const { comment, link, imported } = provenance
  return (
    <div className="min-w-64 max-w-(--reader-measure) space-y-0.5 text-xs text-mute">
      <p>{origine(provenance, raison)}</p>
      {quand && <p>{PROVENANCE.le(quand)}</p>}
      {comment && <p className="whitespace-pre-line">{PROVENANCE.commentaire(comment)}</p>}
      {link && (
        <p>
          {PROVENANCE.preuve}
          {EXTERNE.test(link) ? (
            <LienExterne href={link} className={LIEN_DU_DETAIL}>
              {link}
            </LienExterne>
          ) : (
            link
          )}
        </p>
      )}
      {imported && <p>{PROVENANCE.importee(valeurLisible(colonne, imported.value), dateLisible(imported.at))}</p>}
    </div>
  )
}

type CelluleProps = {
  colonne: TableColumn
  valeur: CellValue | undefined
  /** La raison d'une colonne déclarée vide après recherche (`verified_empty`, H92). */
  raisonDuVide?: string
  provenance?: ProvenanceLue
  /**
   * Le lien de l'hôte et l'adresse d'un nœud : les liens `[[…]]` d'un texte s'y suivent. Absent (page publique, vue d'un
   * bloc), le texte se lit tel quel.
   */
  liens?: Pick<Liens, "Lien" | "hrefDuChemin">
}

/** La valeur rendue (1.4.11) : un texte qui va à la ligne, liens compris ; une adresse raccourcie ; sinon la valeur lisible. */
function corpsDeCellule(colonne: TableColumn, valeur: CellValue | undefined, texte: string, liens: CelluleProps["liens"]): ReactNode {
  if (colonne.type === "url" && typeof valeur === "string" && EXTERNE.test(valeur)) {
    return (
      <LienExterne href={valeur} title={adresseSansIdentifiants(valeur)}>
        {libelleDUneAdresse(valeur)}
      </LienExterne>
    )
  }
  if (colonne.type !== "text" || typeof valeur !== "string") return texte
  return (
    <span className="oto-cell-texte">
      {liens ? <EnLigne texte={valeur} {...liens} /> : valeur}
    </span>
  )
}

/**
 * Une cellule (AC2, AC3) : sa valeur, ou « vérifié vide », ou « — » ; une URL `http(s)` en lien externe ; avec une
 * provenance, une icône « info » après la valeur ouvre son détail. Un nombre, une date ou un choix restent une chaîne :
 * la grille du design system (E05-S09 partie c2) ne tronque, avec son infobulle, qu'une cellule dont le rendu est une
 * chaîne, et appelle donc cette fonction, pas le composant.
 */
export function contenuDeCellule({ colonne, valeur, raisonDuVide, provenance, liens }: CelluleProps): ReactNode {
  const texte = valeur !== undefined ? valeurLisible(colonne, valeur) : raisonDuVide !== undefined ? TEXTES_DE_CELLULE.verifieVide : TEXTES_DE_CELLULE.vide
  const corps = corpsDeCellule(colonne, valeur, texte, liens)
  if (!provenance) return corps
  return (
    <span className="oto-cell-info">
      <span className="text-ink">{corps}</span>
      <Popover
        align="start"
        // Un dialogue sans nom n'existe pas pour un lecteur d'écran : le panneau porte celui de son bouton.
        aria-label={TEXTES_DE_CELLULE.provenance(colonne.name)}
        trigger={
          <IconButton size="sm" className="oto-cell-info-btn" label={TEXTES_DE_CELLULE.provenance(colonne.name)}>
            <Icon as={Info} size="xs" />
          </IconButton>
        }
      >
        <PopoverBody>
          <DetailDeProvenance colonne={colonne} provenance={provenance} raison={raisonDuVide} />
        </PopoverBody>
      </Popover>
    </span>
  )
}

/** La même cellule, en composant : la file de revue et la vue d'un bloc `reference`. */
export function Cellule(props: CelluleProps) {
  return contenuDeCellule(props)
}
