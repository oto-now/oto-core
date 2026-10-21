// Une feuille d'un xlsx (ECMA-376 partie 1 § 18.3) lue au fil de son XML, sans garder ses cellules : un premier passage
// compte (le rectangle des cellules non vides, ses lignes et colonnes vides de bord retirées, et les caractères exacts
// de son CSV), un second écrit le CSV, ligne par ligne, et s'arrête à la borne de caractères. Une cellule rend sa valeur
// gardée : chaîne partagée ou en ligne, nombre tel qu'écrit, booléen, erreur, date en ISO par le format de son style ;
// une formule rend sa valeur calculée gardée, jamais la formule, et une formule sans valeur une cellule vide, que la
// note en tête de la partie compte. Une cellule fusionnée n'a de valeur qu'à son coin : les autres restent vides. La
// lecture s'arrête à la fin des cellules (`</sheetData>`). Sans lui, une feuille d'un million de cellules se lirait en
// mémoire avant d'être coupée.
import type { InflateBudget, ZipArchive } from "../archive"
import { ReaderStatusError } from "../status"
import { NOT_DATE, serialToIso, type DateKind } from "./dates"
import { scanPart } from "./workbook"

/** Ce qu'une cellule lit hors de sa feuille : les chaînes partagées, ce que montre chaque style, le calendrier. */
export type SheetContext = { strings: readonly string[]; dateKinds: readonly DateKind[]; date1904: boolean }

/** Le compte d'une feuille : son rectangle de cellules non vides (lignes et colonnes, 1 à n), ses formules sans valeur. */
export type SheetStats = { firstRow: number; lastRow: number; firstColumn: number; lastColumn: number; fieldChars: number; missing: number }

/** La partie d'une feuille dans son archive, et la borne du passage qui la lit. */
export type SheetSource = { zip: ZipArchive; part: string; budget: InflateBudget }

/** Ce que reçoit une lecture de cellules : chaque cellule non vide, et la fin de chaque ligne. */
type CellVisitor = { cell: (row: number, column: number, value: string) => void; rowEnd: (row: number) => void }

const A = "A".charCodeAt(0)
const Z = "Z".charCodeAt(0)

/** La colonne (1 pour `A`) d'une référence de cellule (`AB12`) ; `0` sans lettres. */
function columnOf(reference: string): number {
  let column = 0
  for (let at = 0; at < reference.length; at++) {
    const code = reference.charCodeAt(at)
    if (code < A || code > Z) break
    column = column * 26 + (code - A + 1)
  }
  return column
}

/** Un champ CSV (RFC 4180) : entre guillemets quand il porte une virgule, un guillemet ou une fin de ligne. */
export function csvField(value: string): string {
  if (value.indexOf(",") < 0 && value.indexOf('"') < 0 && value.indexOf("\n") < 0 && value.indexOf("\r") < 0) return value
  return `"${value.split('"').join('""')}"`
}

/** La valeur rendue d'une cellule, d'après son type (`t`), son style et ce qu'elle porte. */
function cellValue(context: SheetContext, cell: { type: string; style: number; value: string; inline: string; hasValue: boolean }): string {
  switch (cell.type) {
    case "s": {
      const index = Number(cell.value)
      return Number.isInteger(index) ? (context.strings[index] ?? "") : ""
    }
    case "inlineStr":
      return cell.inline
    case "b":
      return cell.hasValue ? (cell.value.trim() === "1" ? "TRUE" : "FALSE") : ""
    case "str":
    case "e":
    case "d":
      return cell.value
    default: {
      if (cell.value === "") return ""
      const kind = context.dateKinds[cell.style] ?? NOT_DATE
      return kind === NOT_DATE ? cell.value : (serialToIso(Number(cell.value), kind, context.date1904) ?? cell.value)
    }
  }
}

/** Lit les cellules d'une feuille, dans l'ordre de ses lignes ; rend le nombre de formules sans valeur gardée. */
function scanCells(source: SheetSource, context: SheetContext, visitor: CellVisitor & { stopped?: () => boolean }): number {
  const { part } = source
  let row = 0
  let column = 0
  let missing = 0
  let cell = { type: "n", style: 0, value: "", inline: "", hasValue: false, hasFormula: false }
  let inCell = false
  let target: "value" | "inline" | null = null
  let inInline = false
  let phonetic = 0
  scanPart(source.zip, part, source.budget, (stop) => ({
    open: (name, attributes, empty) => {
      if (name === "row") {
        const at = attributes.r === undefined ? row + 1 : Number(attributes.r)
        if (!Number.isInteger(at) || at <= row) throw new ReaderStatusError({ status: "unsupported", detail: `the file is damaged: row ${attributes.r ?? at} is out of order in ${part}` })
        row = at
        column = 0
      } else if (name === "c" && row > 0) {
        const at = attributes.r === undefined ? 0 : columnOf(attributes.r)
        column = at > 0 ? at : column + 1
        cell = { type: attributes.t ?? "n", style: Number(attributes.s ?? 0), value: "", inline: "", hasValue: false, hasFormula: false }
        inCell = true
      } else if (inCell && name === "v") {
        cell.hasValue = true
        target = empty ? null : "value"
      } else if (inCell && name === "f") {
        cell.hasFormula = true
      } else if (inCell && name === "is") {
        inInline = !empty
      } else if (inInline && name === "rPh" && !empty) {
        phonetic++
      } else if (inInline && name === "t" && phonetic === 0 && !empty) {
        target = "inline"
      }
    },
    text: (text) => {
      if (target === "value") cell.value += text
      else if (target === "inline") cell.inline += text
    },
    close: (name) => {
      if (name === "v" || name === "t") {
        target = null
      } else if (name === "rPh") {
        phonetic = Math.max(0, phonetic - 1)
      } else if (name === "is") {
        inInline = false
      } else if (name === "c" && inCell) {
        inCell = false
        // Une formule sans valeur gardée : pas de `<v>`, ou un `<v>` vide hors d'un résultat texte (`t="str"`).
        if (cell.hasFormula && cell.type !== "inlineStr" && cell.type !== "str" && cell.value === "") missing++
        const value = cellValue(context, cell)
        if (value !== "") visitor.cell(row, column, value)
      } else if (name === "row") {
        visitor.rowEnd(row)
        if (visitor.stopped?.()) stop()
      } else if (name === "sheetData") {
        stop()
      }
    },
  }))
  return missing
}

/** Le compte d'une feuille, en un passage qui ne garde que la ligne en cours. */
export function sheetStats(source: SheetSource, context: SheetContext): SheetStats {
  const stats: SheetStats = { firstRow: 0, lastRow: 0, firstColumn: 0, lastColumn: 0, fieldChars: 0, missing: 0 }
  // Les longueurs des champs de la ligne en cours, par colonne : une colonne écrite deux fois ne compte qu'une fois.
  let fields = new Map<number, number>()
  stats.missing = scanCells(source, context, {
    cell: (_row, column, value) => {
      fields.set(column, csvField(value).length)
    },
    rowEnd: (row) => {
      if (fields.size === 0) return
      if (stats.firstRow === 0) stats.firstRow = row
      stats.lastRow = row
      for (const [column, length] of fields) {
        stats.fieldChars += length
        if (stats.firstColumn === 0 || column < stats.firstColumn) stats.firstColumn = column
        if (column > stats.lastColumn) stats.lastColumn = column
      }
      fields = new Map()
    },
  })
  return stats
}

/** Lignes et colonnes du rectangle d'une feuille ; `0` pour une feuille vide. */
export const sheetSize = (stats: SheetStats) => ({
  rows: stats.firstRow === 0 ? 0 : stats.lastRow - stats.firstRow + 1,
  columns: stats.firstColumn === 0 ? 0 : stats.lastColumn - stats.firstColumn + 1,
})

/** La note d'une feuille dont des formules n'ont pas de valeur gardée ; vide sinon. */
function missingNote(missing: number): string {
  if (missing === 0) return ""
  if (missing === 1) return "(1 formula has no saved value: its cell is empty.)"
  return `(${missing.toLocaleString("en-US")} formulas have no saved value: their cells are empty.)`
}

/** Le texte vide d'une feuille sans cellules. */
const EMPTY_SHEET = "(empty sheet)"

/** Les lignes de tête d'une partie : son titre, et la note des formules sans valeur. */
const headOf = (heading: string, stats: SheetStats) => [`## ${heading}`, ...(stats.missing > 0 ? [missingNote(stats.missing)] : [])]

/** Les caractères exacts du texte d'une feuille, calculés depuis son compte, sans l'écrire. */
export function sheetChars(heading: string, stats: SheetStats): number {
  const head = headOf(heading, stats)
  const headChars = head.reduce((sum, line) => sum + line.length, 0) + head.length - 1
  const { rows, columns } = sheetSize(stats)
  if (rows === 0) return headChars + 1 + EMPTY_SHEET.length
  return headChars + rows + stats.fieldChars + rows * (columns - 1)
}

/**
 * Le texte d'une feuille : son titre, la note éventuelle, puis son rectangle en CSV, une ligne de virgules pour une
 * ligne vide ; arrêté à `maxChars` caractères, sa longueur étant celle que `sheetChars` annonce quand rien n'est coupé.
 */
export function sheetText(source: SheetSource, context: SheetContext, stats: SheetStats & { heading: string; maxChars: number }): string {
  const lines = headOf(stats.heading, stats)
  const { rows, columns } = sheetSize(stats)
  if (rows === 0) return [...lines, EMPTY_SHEET].join("\n")
  let length = lines.reduce((sum, line) => sum + line.length + 1, 0)
  const empty = ",".repeat(columns - 1)
  let fields: string[] = new Array<string>(columns).fill("")
  let written = stats.firstRow - 1
  const push = (line: string) => {
    lines.push(line)
    length += line.length + 1
  }
  scanCells(source, context, {
    cell: (row, column, value) => {
      if (row >= stats.firstRow && row <= stats.lastRow) fields[column - stats.firstColumn] = csvField(value)
    },
    rowEnd: (row) => {
      if (row < stats.firstRow || row > stats.lastRow) return
      for (written++; written < row && length < stats.maxChars; written++) push(empty)
      push(fields.join(","))
      fields = new Array<string>(columns).fill("")
    },
    stopped: () => length >= stats.maxChars || written >= stats.lastRow,
  })
  const text = lines.join("\n")
  return text.length > stats.maxChars ? text.slice(0, stats.maxChars) : text
}
