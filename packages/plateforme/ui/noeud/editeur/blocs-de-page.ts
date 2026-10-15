// Les formes qu'E10-S06 apprend à l'éditeur, en fonctions pures : le tableau simple (cellules, rangées, colonnes,
// alignement, collage d'un tableur, cellules telles qu'elles partent), le repli (résumé et corps), le niveau d'une
// ligne de liste (`Tab`, `Maj+Tab`) et les numéros de la gouttière d'une liste numérotée ; puis les trois titres. Les bornes sont celles du
// schéma partagé (`schemas/blocks.ts`). Sans lui, `modele.ts` dépasserait les 300 lignes d'ESLint
// (`coding-standards.md § Complexité`).
import {
  LIST_DEPTH_MAX,
  SIMPLE_TABLE_COLUMNS_MAX,
  SIMPLE_TABLE_ROWS_MAX,
  TOGGLE_SUMMARY_MAX,
  isBlankLine,
  trimBlanks,
  type SimpleTable,
  type SimpleTableAlign,
} from "../../../schemas/blocks"
import type { Forme } from "./modele"

export type Alignement = SimpleTableAlign

/** Un tableau simple, tel que le lit `simpleTableOf` (`schemas/blocks.ts`). */
export type Tableau = SimpleTable

/** Une cellule : la ligne 0 est l'en-tête, la ligne N la N-ième rangée. */
export type Position = { ligne: number; colonne: number }

/** Un ajout refusé par sa borne (AC-b1) : rien n'est ajouté. */
export type Borne = { borne: "colonnes" | "rangees" }

/** Le tableau reposé dans `data`, les autres champs gardés ; `align` part quand aucune colonne n'est alignée (forme canonique d'E10-S04). */
export function avecTableau(data: Record<string, unknown>, tableau: Tableau): Record<string, unknown> {
  const reste = Object.fromEntries(Object.entries(data).filter(([champ]) => champ !== "align"))
  const aligne = tableau.align?.some((alignement) => alignement !== null) === true
  return { ...reste, columns: tableau.columns, rows: tableau.rows, ...(aligne ? { align: tableau.align } : {}) }
}

/** « Tableau simple » choisi (AC-b1) : 3 colonnes et 3 rangées vides, en-tête compris. */
export const TABLEAU_NEUF: Tableau = { columns: ["", "", ""], rows: [["", "", ""], ["", "", ""]] }

const rangeeVide = (largeur: number) => Array.from({ length: largeur }, () => "")

export function ecrireCellule(tableau: Tableau, { ligne, colonne }: Position, texte: string): Tableau {
  if (ligne === 0) return { ...tableau, columns: tableau.columns.map((une, rang) => (rang === colonne ? texte : une)) }
  return { ...tableau, rows: tableau.rows.map((rangee, rang) => (rang === ligne - 1 ? rangee.map((une, place) => (place === colonne ? texte : une)) : rangee)) }
}

/** Une rangée vide après la ligne `apres` (0 : sous l'en-tête) ; 200 rangées au plus (AC-b1). */
export function ajouterRangee(tableau: Tableau, apres: number): Tableau | Borne {
  if (tableau.rows.length >= SIMPLE_TABLE_ROWS_MAX) return { borne: "rangees" }
  return { ...tableau, rows: [...tableau.rows.slice(0, apres), rangeeVide(tableau.columns.length), ...tableau.rows.slice(apres)] }
}

/** Une colonne vide après la colonne `apres` ; 20 colonnes au plus (AC-b1). */
export function ajouterColonne(tableau: Tableau, apres: number): Tableau | Borne {
  if (tableau.columns.length >= SIMPLE_TABLE_COLUMNS_MAX) return { borne: "colonnes" }
  const inserer = <T>(valeurs: readonly T[], valeur: T) => [...valeurs.slice(0, apres + 1), valeur, ...valeurs.slice(apres + 1)]
  const align = tableau.align ? { align: inserer(tableau.align, null) } : {}
  return { columns: inserer(tableau.columns, ""), rows: tableau.rows.map((rangee) => inserer(rangee, "")), ...align }
}

/** Retirer la rangée de la ligne `ligne` (AC-b2) : jamais l'en-tête. */
export function retirerRangee(tableau: Tableau, ligne: number): Tableau {
  return ligne === 0 ? tableau : { ...tableau, rows: tableau.rows.filter((_, rang) => rang !== ligne - 1) }
}

/** Retirer une colonne (AC-b2) : jamais la dernière. */
export function retirerColonne(tableau: Tableau, colonne: number): Tableau {
  if (tableau.columns.length <= 1) return tableau
  const sans = <T>(valeurs: readonly T[]) => valeurs.filter((_, rang) => rang !== colonne)
  return { columns: sans(tableau.columns), rows: tableau.rows.map(sans), ...(tableau.align ? { align: sans(tableau.align) } : {}) }
}

/** L'alignement d'une colonne (AC-b2) : aucun, gauche, centre ou droite. */
export function aligner(tableau: Tableau, colonne: number, alignement: Alignement): Tableau {
  const avant = tableau.align ?? tableau.columns.map((): Alignement => null)
  return { ...tableau, align: avant.map((une, rang) => (rang === colonne ? alignement : une)) }
}

/** La cellule suivante (`pas` 1) ou précédente (-1), ligne par ligne ; `null` au bord du tableau. */
export function celluleVoisine(tableau: Tableau, { ligne, colonne }: Position, pas: 1 | -1): Position | null {
  const largeur = tableau.columns.length
  const rang = ligne * largeur + colonne + pas
  if (rang < 0 || rang >= (tableau.rows.length + 1) * largeur) return null
  return { ligne: Math.floor(rang / largeur), colonne: rang % largeur }
}

/**
 * Un `|` part écrit `\|` (AC-b1) ; un `|` déjà échappé (précédé d'un `\`) reste tel quel. Un parcours : chaque
 * caractère lu une fois, comme le contrôle du schéma (`isCell`).
 */
export function echapperLesBarres(texte: string): string {
  let sortie = ""
  for (let rang = 0; rang < texte.length; rang += 1) {
    const signe = texte[rang]
    const echappe = signe === "\\" && rang + 1 < texte.length
    sortie += echappe ? `${signe}${texte[rang + 1]}` : signe === "|" ? "\\|" : signe
    if (echappe) rang += 1
  }
  return sortie
}

/** Une cellule telle qu'elle part (AC-b1) : sans blanc de bord, chaque `|` échappé. */
export const celluleEnvoyee = (texte: string) => echapperLesBarres(trimBlanks(texte))

/** Le texte d'un tableau : une ligne par rangée, en-tête d'abord, cellules séparées par une tabulation (le format d'un tableur). */
export const texteDuTableau = (tableau: Tableau) => [tableau.columns, ...tableau.rows].map((cellules) => cellules.join("\t")).join("\n")

/** Un texte relu en tableau (texte final d'un conflit) : une rangée par ligne, une cellule par tabulation, rangées complétées. */
export function tableauDuTexte(texte: string): Tableau {
  const lignes = texte.split("\n").map((ligne) => ligne.split("\t"))
  const largeur = lignes.reduce((plus, cellules) => Math.max(plus, cellules.length), 1)
  const [columns, ...rows] = lignes.map((cellules) => [...cellules, ...rangeeVide(largeur - cellules.length)])
  return { columns, rows }
}

/**
 * Le collage d'un tableur (AC-b3) : au moins deux lignes, chacune avec le même nombre, au moins un, de tabulations ;
 * première ligne en en-tête, cellules rognées, `|` échappés. `null` au-delà de 20 colonnes ou de 200 rangées, ou pour
 * tout autre texte : il suit le collage d'E10-S01. La fin de ligne du tableur est retirée.
 */
export function tableauColle(texte: string): Tableau | null {
  const lignes = texte.replace(/\r?\n$/, "").split(/\r?\n/)
  if (lignes.length < 2 || lignes.length - 1 > SIMPLE_TABLE_ROWS_MAX) return null
  const cellules = lignes.map((ligne) => ligne.split("\t"))
  const largeur = cellules[0].length
  if (largeur < 2 || largeur > SIMPLE_TABLE_COLUMNS_MAX || cellules.some((une) => une.length !== largeur)) return null
  const [columns, ...rows] = cellules.map((une) => une.map(celluleEnvoyee))
  return { columns, rows }
}

/** Les lignes sans les lignes blanches de leurs bords : le corps d'un repli n'en a pas (E10-S04, AC-a3). */
export function sansLignesBlanchesDeBord(lignes: readonly string[]): string[] {
  let debut = 0
  let fin = lignes.length
  while (debut < fin && isBlankLine(lignes[debut])) debut += 1
  while (fin > debut && isBlankLine(lignes[fin - 1])) fin -= 1
  return lignes.slice(debut, fin)
}

/** Le texte d'un repli devenu une autre forme (AC-a3) : le résumé, une ligne vide, puis le corps. */
export const texteDuRepli = (resume: string, corps: string) => (corps === "" ? resume : `${resume}\n\n${corps}`)

/**
 * Un texte devenu repli (AC-a3) : sa première ligne, coupée à 200 caractères, est le résumé ; le reste de cette ligne
 * ouvre le corps, les autres lignes le suivent, sans lignes blanches de bord.
 */
export function repliDuTexte(texte: string): { resume: string; corps: string } {
  const [premiere, ...autres] = texte.split("\n")
  const signes = Array.from(premiere)
  const reste = signes.slice(TOGGLE_SUMMARY_MAX).join("")
  const corps = sansLignesBlanchesDeBord([...(reste === "" ? [] : [reste]), ...autres])
  return { resume: signes.slice(0, TOGGLE_SUMMARY_MAX).join(""), corps: corps.join("\n") }
}

/** Une marque de sous-élément en tête de ligne, comme la lit l'éditeur (`modele.ts`, `elementsLus`). */
const MARQUE = /^(?:\d{1,9}[.)]|[-*+]) /

/** La profondeur de chaque ligne d'un champ de liste, lue comme `elementsLus` : deux espaces par niveau, jamais plus d'un de plus que la ligne d'avant. */
function profondeurs(lignes: readonly string[]): number[] {
  const lues: number[] = []
  for (const ligne of lignes) lues.push(Math.min(Math.floor((/^ */.exec(ligne)?.[0].length ?? 0) / 2), lues.length === 0 ? 0 : lues[lues.length - 1] + 1))
  return lues
}

/** Ce qui précède le texte d'une ligne : ses espaces et sa marque, sauf au premier niveau. */
function enTeteDeLigne(ligne: string, profondeur: number): number {
  if (profondeur === 0) return 0
  const espaces = /^ */.exec(ligne)?.[0].length ?? 0
  return espaces + (MARQUE.exec(ligne.slice(espaces))?.[0].length ?? 0)
}

type RefusDeNiveau = "troisNiveaux" | "rienAuDessus" | "premierNiveau"

/**
 * `Tab` (`pas` 1) ou `Maj+Tab` (-1) sur la ligne du curseur (AC-a6) : la ligne descend sous l'élément qui la précède
 * (deux espaces et la marque du sous-niveau, `1. ` sous une liste numérotée, `- ` sinon) ou remonte d'un niveau.
 * `ligne` et `colonne` disent où remettre le curseur dans son texte ; un refus ne change rien.
 */
export function niveauDeLigne(texte: string, curseur: number, pas: 1 | -1, numerotee: boolean): { texte: string; ligne: number; colonne: number } | { refus: RefusDeNiveau } {
  const lignes = texte.split("\n")
  const debuts: number[] = []
  let position = 0
  for (const une of lignes) {
    debuts.push(position)
    position += une.length + 1
  }
  const ligne = Math.max(0, debuts.findLastIndex((debut) => debut <= curseur))
  const lues = profondeurs(lignes.slice(0, ligne + 1))
  const profondeur = lues[ligne]
  const cible = profondeur + pas
  if (pas === 1 && ligne === 0) return { refus: "rienAuDessus" }
  if (cible >= LIST_DEPTH_MAX) return { refus: "troisNiveaux" }
  if (cible < 0) return { refus: "premierNiveau" }
  if (pas === 1 && cible > lues[ligne - 1] + 1) return { refus: "rienAuDessus" }
  const entete = enTeteDeLigne(lignes[ligne], profondeur)
  const contenu = lignes[ligne].slice(entete)
  const suivante = cible === 0 ? contenu : `${"  ".repeat(cible)}${numerotee ? "1. " : "- "}${contenu}`
  const colonne = Math.max(0, curseur - debuts[ligne] - entete)
  return { texte: [...lignes.slice(0, ligne), suivante, ...lignes.slice(ligne + 1)].join("\n"), ligne, colonne }
}

/** Le curseur au rang `colonne` du texte de la ligne `ligne`, marque et espaces passés, dans le champ réécrit. */
export function positionDansLaLigne(texte: string, ligne: number, colonne: number): number {
  const lignes = texte.split("\n")
  const debut = lignes.slice(0, ligne).reduce((total, une) => total + une.length + 1, 0)
  const courante = lignes[ligne] ?? ""
  const profondeur = profondeurs(lignes.slice(0, ligne + 1))[ligne] ?? 0
  return debut + Math.min(enTeteDeLigne(courante, profondeur) + colonne, courante.length)
}

/**
 * Les numéros de la gouttière d'une liste numérotée (HN-E10S04-14, corrigé par E10-S06) : seuls les éléments du premier
 * niveau se comptent, à partir de `debut` ; une ligne de sous-élément n'en porte pas, sa marque est dans son texte.
 */
export function numerosDeGouttiere(texte: string, debut: number): string[] {
  let numero = debut
  return profondeurs(texte.split("\n")).map((profondeur) => (profondeur === 0 ? `${numero++}.` : ""))
}

/** Les trois titres, et le niveau que chacun écrit ; un titre de niveau 4 ou 5 écrit par un assistant se lit « Petit titre ». */
export const NIVEAUX_DES_TITRES = { grandTitre: 1, moyenTitre: 2, petitTitre: 3 } as const

export type Titre = keyof typeof NIVEAUX_DES_TITRES

export const estUnTitre = (forme: Forme | null): forme is Titre => forme !== null && forme in NIVEAUX_DES_TITRES
