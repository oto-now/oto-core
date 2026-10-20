// Les formes de page qu'E10-S04 ajoute à l'analyse du markdown de `write` (`markdown-parse.ts`) : tableau
// simple, séparateur et repli (AC-a1 à AC-a3), l'inverse exact de leur rendu (`schemas/blocks-render.ts`).
// Séparées de `markdown-parse.ts`, qui les appelle, pour que chaque module reste lisible d'un tenant ; le
// refus de l'analyse (`ParseProblem`) vit ici et `markdown-parse.ts` l'importe. Sans lui, un tableau, un
// `---` ou un `<details>` écrits par un assistant restaient des paragraphes affichés avec leur balisage.
//
// Tout est lu en temps linéaire (`security-patterns.md § Validation des inputs`) : chaque ligne par un
// parcours à la main ou une expression ancrée, chaque caractère une fois.
import {
  isBlankLine,
  isToggleFence,
  SIMPLE_TABLE_COLUMNS_MAX,
  SIMPLE_TABLE_ROWS_MAX,
  TOGGLE_SUMMARY_MAX,
  trimBlanks,
  type BlockInput,
} from "../../schemas/blocks"
import { charCount, formatCount } from "./document"

/** Un refus de l'analyse : son texte est servi au modèle (AC3 d'E03-S03), sans le préfixe de l'opération. */
export class ParseProblem extends Error {}

export function refuse(message: string): never {
  throw new ParseProblem(message)
}

/**
 * Le mode d'une analyse (E10-S01, AC-a2) : strict pour `write`, qui refuse avec la ligne ; tolérant pour ce
 * qu'envoie l'écran (collage, fichier importé), qui ne refuse jamais et compte dans `kept` les constructions
 * gardées en texte (bloc `code` ou paragraphe). Un par analyse.
 */
export type ParseMode = { tolerant: boolean; kept: number }

/** Strict : le refus ; tolérant : la construction comptée, et l'appelant la garde en texte. */
export function refuseOrKeep(mode: ParseMode, message: string): void {
  if (!mode.tolerant) refuse(message)
  mode.kept++
}

/** Une ligne de tableau (E10-S04, AC-a1). */
type Row = string[]

/** La barre oblique inverse, composée : écrite en littéral, un outil d'édition peut la livrer déjà interprétée. */
const BACKSLASH = String.fromCharCode(92)

/**
 * Les cellules d'une ligne qui commence par `|`, blancs de bord retirés : coupée à chaque `|` que ne précède
 * pas un `\` (qui échappe le caractère suivant) et hors d'un lien `[[…]]`, le segment avant le premier `|` et celui qui suit un `|`
 * final retirés, chaque cellule sans blancs de bord et son `\|` gardé. `null` : pas une ligne de tableau.
 */
function cellsOf(line: string): Row | null {
  const row = trimBlanks(line)
  if (!row.startsWith("|")) return null
  const cells: Row = []
  let cell = ""
  let lastPipe = 0
  // Un `|` dans un lien (`[[chemin|titre]]`) n'en coupe pas la cellule : il y est gardé échappé, la forme d'une cellule
  // (`\|`, que le lien lit aussi) ; un `[[` après le dernier `]]` n'ouvre rien.
  const lastClose = row.lastIndexOf("]]")
  let inLink = false
  for (let at = 1; at < row.length; at++) {
    if (row[at] === "\\") {
      cell += row.slice(at, at + 2)
      at++
    } else if (!inLink && row[at] === "[" && row[at + 1] === "[" && at < lastClose) {
      inLink = true
      cell += "[["
      at++
    } else if (row[at] !== "|") {
      inLink &&= row[at] !== "]"
      cell += row[at]
    } else if (inLink) {
      cell += `${BACKSLASH}|`
    } else {
      cells.push(trimBlanks(cell))
      cell = ""
      lastPipe = at
    }
  }
  if (lastPipe !== row.length - 1) cells.push(trimBlanks(cell))
  return cells.length > 0 ? cells : null
}

type Align = "left" | "center" | "right" | null

/** L'alignement d'une cellule de délimitation (`---`, `:---`, `:---:`, `---:`), `undefined` si ce n'en est pas une. */
function alignOf(cell: string): Align | undefined {
  const match = /^(:?)-+(:?)$/.exec(cell)
  if (!match) return undefined
  if (match[1] && match[2]) return "center"
  return match[1] ? "left" : match[2] ? "right" : null
}

/**
 * Un tableau simple qui commence à la ligne `at` (AC-a1) : une ligne d'en-tête qui commence par `|`, une ligne
 * de délimitation du même nombre de cellules, puis des rangées qui commencent par `|` jusqu'à une ligne vide ou
 * sans `|` en tête. `null` sans en-tête ni délimitation : la ligne reste du texte (HN-E10S04-5). Hors des bornes,
 * le mode tolérant le garde en bloc `code`, ses lignes telles quelles (E10-S01, AC-a2).
 */
export function tableAt(lines: readonly string[], at: number, mode: ParseMode): { block: BlockInput; next: number } | null {
  const columns = cellsOf(lines[at])
  const delimiter = at + 1 < lines.length ? cellsOf(lines[at + 1]) : null
  if (!columns || !delimiter || delimiter.length !== columns.length) return null
  const align: Align[] = []
  for (const cell of delimiter) {
    const value = alignOf(cell)
    if (value === undefined) return null
    align.push(value)
  }
  const wide = columns.length > SIMPLE_TABLE_COLUMNS_MAX
  if (wide && !mode.tolerant) {
    refuse(`line ${at + 1}: a table holds ${formatCount(SIMPLE_TABLE_COLUMNS_MAX)} columns at most (${formatCount(columns.length)}).`)
  }
  const rows: Row[] = []
  let uneven = false
  let next = at + 2
  for (let cells = next < lines.length ? cellsOf(lines[next]) : null; cells; cells = next < lines.length ? cellsOf(lines[next]) : null) {
    if (cells.length !== columns.length && !mode.tolerant) {
      refuse(`line ${next + 1}: this row has ${cells.length} cell${cells.length === 1 ? "" : "s"}; the header has ${columns.length}.`)
    }
    uneven ||= cells.length !== columns.length
    rows.push(cells)
    next++
  }
  if (wide || uneven || rows.length > SIMPLE_TABLE_ROWS_MAX) {
    refuseOrKeep(mode, `line ${at + 1}: a table holds ${formatCount(SIMPLE_TABLE_ROWS_MAX)} rows at most (${formatCount(rows.length)}).`)
    return { block: { type: "code", text: lines.slice(at, next).join("\n"), data: {} }, next }
  }
  const aligned = align.some((value) => value !== null) ? { align } : {}
  return { block: { type: "simple_table", text: null, data: { columns, rows, ...aligned } }, next }
}

/** Un séparateur (AC-a2) : trois `-`, `*` ou `_` au moins, tous le même, 0 à 3 espaces avant, blancs de fin admis. */
export const isDivider = (line: string) => /^ {0,3}(?:-{3,}|\*{3,}|_{3,})[ \t]*$/.test(line)

const SUMMARY_OPEN = "<summary>"
const SUMMARY_CLOSE = "</summary>"

/**
 * Ce qui suit `<details>` ou `<details open>` (`open` n'est pas gardé) sur une ligne qui ouvre un repli
 * (AC-a3) : rien, ou le résumé ; `null` : la ligne n'ouvre pas de repli.
 */
export function toggleOpening(line: string): string | null {
  const trimmed = trimBlanks(line)
  const tag = /^<details(?: open)?>/.exec(trimmed)
  if (!tag) return null
  const rest = trimBlanks(trimmed.slice(tag[0].length))
  return rest === "" || rest.startsWith(SUMMARY_OPEN) ? rest : null
}

/**
 * Le résumé d'un repli, `<summary>…</summary>` seul sur sa ligne (blancs de bord retirés), refusé sinon. Tolérant
 * (E10-S01) : `null` pour une forme refusée, la ligne reste du texte ; un résumé trop long, coupé.
 */
function summaryOf(line: string, number: number, mode: ParseMode): string | null {
  const shape = `line ${number}: a toggle starts with <summary>…</summary> on one line.`
  const framed = line.startsWith(SUMMARY_OPEN) && line.endsWith(SUMMARY_CLOSE) && line.length >= SUMMARY_OPEN.length + SUMMARY_CLOSE.length
  const summary = framed ? trimBlanks(line.slice(SUMMARY_OPEN.length, line.length - SUMMARY_CLOSE.length)) : ""
  if (summary === "") {
    refuseOrKeep(mode, shape)
    return null
  }
  if (charCount(summary) <= TOGGLE_SUMMARY_MAX) return summary
  if (!mode.tolerant) refuse(`line ${number}: a toggle summary holds ${formatCount(TOGGLE_SUMMARY_MAX)} characters at most (${formatCount(charCount(summary))}).`)
  return trimBlanks(Array.from(summary).slice(0, TOGGLE_SUMMARY_MAX).join(""))
}

/**
 * Le repli ouvert à la ligne `at` (AC-a3) : son résumé, sur cette ligne (`opening`) ou la suivante, puis son
 * corps jusqu'à la ligne `</details>`, lignes blanches de bord retirées, jamais relu en blocs (HN-E10S04-8).
 * Tolérant (E10-S01, AC-a2) : un repli dans le repli reste dans son corps, ses lignes `<details…>` et
 * `</details>` retirées ; un repli jamais fermé court jusqu'à la fin ; `null` pour un résumé refusé.
 */
export function parseToggle(lines: readonly string[], at: number, opening: string, mode: ParseMode): { block: BlockInput; next: number } | null {
  const onNextLine = opening === ""
  const summaryAt = onNextLine ? at + 1 : at
  const summary = summaryOf(onNextLine ? trimBlanks(lines[summaryAt] ?? "") : opening, summaryAt + 1, mode)
  if (summary === null) return null
  const body: string[] = []
  let depth = 0
  let next = summaryAt + 1
  for (; next < lines.length; next++) {
    const trimmed = trimBlanks(lines[next])
    if (trimmed === "</details>" && depth === 0) break
    const inner = isToggleFence(trimmed)
    if (inner && !mode.tolerant) refuse(`line ${next + 1}: a toggle cannot hold another toggle.`)
    if (inner) depth += trimmed === "</details>" ? -1 : 1
    else body.push(lines[next])
  }
  if (next >= lines.length && !mode.tolerant) refuse(`line ${at + 1}: <details> is never closed by </details>.`)
  let start = 0
  let end = body.length
  while (start < end && isBlankLine(body[start])) start++
  while (end > start && isBlankLine(body[end - 1])) end--
  return { block: { type: "toggle", text: body.slice(start, end).join("\n"), data: { summary } }, next: next + 1 }
}
