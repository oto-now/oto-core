// Un classeur xlsx lu en deux temps (`lecture-des-fichiers.md` § Ce que rend chaque format) : le plan (titre, résumé,
// une partie par feuille et ses caractères exacts), puis le texte d'une partie à la demande. Chaque temps est un
// passage, sous sa propre borne de décompression (64 Mo d'octets produits) : le plan décompresse le classeur, ses
// relations, ses chaînes partagées, ses styles et chaque feuille, qu'il compte sans en garder les cellules ; une partie
// ne décompresse que sa feuille, le reste étant gardé du plan. Code pur, sans worker : `worker/entry.ts` le court dans
// un worker, les tests aussi en direct. Sans lui, le worker n'aurait rien à lire.
import { ZipArchive, type InflateBudget } from "../archive"
import { ReaderStatusError } from "../status"
import { sheetChars, sheetSize, sheetStats, sheetText, type SheetContext, type SheetStats } from "./sheet"
import { openWorkbook, readDateStyles, readSharedStrings, type SheetEntry, type Workbook } from "./workbook"

/** Les bornes d'une lecture, passées par le fil principal : le worker n'importe pas celles du paquet. */
export type BookLimits = { decompressedBytes: number; textChars: number }

/** Le plan d'un classeur : ce que rend le lecteur avant toute partie. */
export type BookOutline = { title: string; summary: string; parts: { name: string; chars: number }[] }

/** Le résumé d'un classeur tient en 300 caractères, coupé à une feuille près. */
const SUMMARY_MAX = 300

/** Longueur d'un nom de feuille gardée dans le nom d'une partie (un tableur en écrit 31 au plus ; `section` en prend 200). */
const SHEET_NAME_MAX = 180

/** Le nom d'une partie : celui de la feuille, suivi de « (hidden) » pour une feuille cachée, unique. */
function partNames(sheets: readonly SheetEntry[]): string[] {
  const seen = new Set<string>()
  return sheets.map((sheet) => {
    const kept = sheet.name.slice(0, SHEET_NAME_MAX)
    const base = sheet.hidden ? `${kept} (hidden)` : kept
    let name = base
    for (let count = 2; seen.has(name); count++) name = `${base} (${count})`
    seen.add(name)
    return name
  })
}

const count = (value: number) => value.toLocaleString("en-US")

/** « 3 sheets: Synthèse (12 × 8), Détail (4,210 × 15), Paramètres (hidden, 30 × 2) », coupé à 300 caractères. */
function summaryOf(workbook: Workbook, stats: readonly SheetStats[]): string {
  const items = workbook.sheets.map((sheet, index) => {
    const { rows, columns } = sheetSize(stats[index])
    const size = rows === 0 ? "empty" : `${count(rows)} × ${count(columns)}`
    return `${sheet.name} (${sheet.hidden ? "hidden, " : ""}${size})`
  })
  const n = workbook.sheets.length
  const head = `${count(n)} ${n === 1 ? "sheet" : "sheets"}: `
  const tail = workbook.otherSheets > 0 ? `; ${count(workbook.otherSheets)} chart or macro ${workbook.otherSheets === 1 ? "sheet" : "sheets"} not read` : ""
  let shown = items.length
  const text = (kept: number) => `${head}${items.slice(0, kept).join(", ")}${kept < items.length ? `, … and ${count(items.length - kept)} more` : ""}${tail}`
  while (shown > 0 && text(shown).length > SUMMARY_MAX) shown--
  return text(shown).slice(0, SUMMARY_MAX)
}

export class Book {
  private readonly zip: ZipArchive
  private workbook: Workbook | null = null
  private context: SheetContext | null = null
  private readonly stats = new Map<number, SheetStats>()

  constructor(
    bytes: Uint8Array,
    private readonly name: string,
    private readonly limits: BookLimits,
  ) {
    this.zip = new ZipArchive(bytes)
  }

  /** Le plan : chaque feuille comptée, aucune gardée ; `empty` quand aucune feuille n'a de cellule. */
  outline(): BookOutline {
    const budget = this.budget()
    const workbook = this.open(budget)
    const names = partNames(workbook.sheets)
    const stats = workbook.sheets.map((_, index) => this.statsOf(index, budget))
    if (workbook.sheets.length === 0 || stats.every((one) => one.firstRow === 0)) throw new ReaderStatusError({ status: "empty", detail: "its sheets hold no cells" })
    return {
      title: (workbook.title ?? this.name).slice(0, 200),
      summary: summaryOf(workbook, stats),
      parts: names.map((name, index) => ({ name, chars: sheetChars(name, stats[index]) })),
    }
  }

  /** Le texte d'une partie du plan, arrêté à la borne de caractères. */
  text(part: string): string {
    const budget = this.budget()
    const workbook = this.open(budget)
    const index = partNames(workbook.sheets).indexOf(part)
    if (index < 0) throw new ReaderStatusError({ status: "failed", detail: `no sheet ${part}` })
    const stats = this.statsOf(index, budget)
    const source = { zip: this.zip, part: workbook.sheets[index].part, budget }
    return sheetText(source, this.contextOf(budget), { ...stats, heading: part, maxChars: this.limits.textChars })
  }

  private budget(): InflateBudget {
    return { left: this.limits.decompressedBytes, total: this.limits.decompressedBytes }
  }

  private open(budget: InflateBudget): Workbook {
    this.workbook ??= openWorkbook(this.zip, budget)
    return this.workbook
  }

  private contextOf(budget: InflateBudget): SheetContext {
    if (this.context === null) {
      const workbook = this.open(budget)
      this.context = {
        strings: readSharedStrings(this.zip, workbook.sharedStrings, budget, this.limits.textChars),
        dateKinds: readDateStyles(this.zip, workbook.styles, budget),
        date1904: workbook.date1904,
      }
    }
    return this.context
  }

  private statsOf(index: number, budget: InflateBudget): SheetStats {
    const known = this.stats.get(index)
    if (known) return known
    const workbook = this.open(budget)
    const stats = sheetStats({ zip: this.zip, part: workbook.sheets[index].part, budget }, this.contextOf(budget))
    this.stats.set(index, stats)
    return stats
  }
}
