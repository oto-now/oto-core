// Le classeur d'un xlsx (ECMA-376 partie 1 § 18.2, 18.4, 18.8 ; OPC, partie 2) : ce qu'il faut lire avant toute feuille,
// et rien d'autre. Les relations du paquet mènent au classeur et à ses propriétés ; le classeur donne ses feuilles
// (nom, état caché, partie) et son calendrier (`date1904`) ; ses relations, les chaînes partagées et les styles, dont on
// ne garde que ce qu'un format de date dit de chaque style de cellule. Chaque partie se lit par le tokeniseur, sous la
// borne de décompression du passage. Sans lui, une feuille ne saurait ni ses chaînes ni ses dates.
import { type InflateBudget, type ZipArchive } from "../archive"
import { ReaderStatusError } from "../status"
import { scanXml, XmlScanner, type XmlHandler } from "../xml"
import { formatKind, type DateKind } from "./dates"

/** Une feuille de calcul du classeur, dans son ordre. */
export type SheetEntry = { name: string; hidden: boolean; part: string }

export type Workbook = {
  sheets: SheetEntry[]
  /** Les feuilles sans cellules (graphique, boîte de dialogue, macros) : dites dans le résumé, jamais lues. */
  otherSheets: number
  date1904: boolean
  title: string | null
  sharedStrings: string | null
  styles: string | null
}

type Relationship = { type: string; target: string }

/** Lit une partie XML entière ; le handler reçoit de quoi arrêter la lecture quand il a ce qu'il lui faut. */
export function scanPart(zip: ZipArchive, part: string, budget: InflateBudget, handlerOf: (stop: () => void) => XmlHandler): void {
  let scanner: XmlScanner | null = null
  const handler = handlerOf(() => scanner?.stop())
  scanner = new XmlScanner(handler)
  scanXml((sink) => zip.stream(part, budget, sink), scanner)
}

const notWorkbook = (why: string) => new ReaderStatusError({ status: "unsupported", detail: `it is not a spreadsheet: ${why}` })

/** Le chemin d'une cible de relation, relative au dossier de la partie source (ou absolue, `/xl/…`). */
function resolveTarget(source: string, target: string): string {
  const base = target.startsWith("/") ? [] : source.split("/").slice(0, -1)
  for (const segment of target.split("/")) {
    if (segment === "..") base.pop()
    else if (segment !== "." && segment !== "") base.push(segment)
  }
  return base.join("/")
}

/** Les relations d'une partie (`xl/_rels/workbook.xml.rels` pour `xl/workbook.xml`), par identifiant ; vides sans fichier. */
function relationships(zip: ZipArchive, source: string, budget: InflateBudget): Map<string, Relationship> {
  const slash = source.lastIndexOf("/")
  const rels = `${source.slice(0, slash + 1)}_rels/${source.slice(slash + 1)}.rels`
  const found = new Map<string, Relationship>()
  if (!zip.has(rels)) return found
  scanPart(zip, rels, budget, () => ({
    open: (name, attributes) => {
      if (name !== "Relationship" || attributes.TargetMode === "External" || !attributes.Id || !attributes.Target) return
      found.set(attributes.Id, { type: attributes.Type ?? "", target: resolveTarget(source, attributes.Target) })
    },
  }))
  return found
}

/** La cible de la première relation d'un type (`…/officeDocument`, `…/sharedStrings`), comparé à sa fin d'URI. */
const targetOf = (rels: Map<string, Relationship>, type: string) => [...rels.values()].find((rel) => rel.type.endsWith(`/${type}`))?.target ?? null

/** Le titre des propriétés du document (`docProps/core.xml`, `dc:title`), sans blancs autour ; `null` sans titre. */
function coreTitle(zip: ZipArchive, part: string | null, budget: InflateBudget): string | null {
  if (part === null || !zip.has(part)) return null
  let title = ""
  let inTitle = false
  scanPart(zip, part, budget, (stop) => ({
    open: (name) => {
      inTitle = name === "title"
    },
    text: (text) => {
      if (inTitle) title += text
    },
    close: (name) => {
      if (name === "title") stop()
    },
  }))
  return title.trim() || null
}

/** Le classeur : ses feuilles de calcul, son calendrier, son titre, et ses parties de chaînes partagées et de styles. */
export function openWorkbook(zip: ZipArchive, budget: InflateBudget): Workbook {
  const root = relationships(zip, "", budget)
  const part = targetOf(root, "officeDocument")
  if (part === null || !zip.has(part)) throw notWorkbook("no workbook part")
  const rels = relationships(zip, part, budget)
  const workbook: Workbook = { sheets: [], otherSheets: 0, date1904: false, title: coreTitle(zip, targetOf(root, "core-properties"), budget), sharedStrings: null, styles: null }
  let rootSeen = false
  scanPart(zip, part, budget, (stop) => ({
    open: (name, attributes) => {
      if (!rootSeen) {
        if (name !== "workbook") throw notWorkbook(`its main part is a ${name}`)
        rootSeen = true
      } else if (name === "workbookPr") {
        workbook.date1904 = attributes.date1904 === "1" || attributes.date1904 === "true"
      } else if (name === "sheet") {
        const rel = rels.get(attributes.id ?? "")
        if (rel?.type.endsWith("/worksheet") && attributes.name) {
          workbook.sheets.push({ name: attributes.name, hidden: attributes.state === "hidden" || attributes.state === "veryHidden", part: rel.target })
        } else {
          workbook.otherSheets++
        }
      }
    },
    close: (name) => {
      if (name === "sheets") stop()
    },
  }))
  workbook.sharedStrings = targetOf(rels, "sharedStrings")
  workbook.styles = targetOf(rels, "styles")
  return workbook
}

/**
 * Les chaînes partagées (`<si>`), dans l'ordre : le texte de leurs `<t>`, runs enrichis compris, sans leur lecture
 * phonétique (`<rPh>`) ; chacune coupée à `maxChars`, une partie ne servant jamais plus.
 */
export function readSharedStrings(zip: ZipArchive, part: string | null, budget: InflateBudget, maxChars: number): string[] {
  const strings: string[] = []
  if (part === null || !zip.has(part)) return strings
  let current = ""
  let inText = false
  let phonetic = 0
  scanPart(zip, part, budget, () => ({
    open: (name, _attributes, empty) => {
      if (name === "si") current = ""
      else if (name === "rPh" && !empty) phonetic++
      else if (name === "t" && phonetic === 0) inText = !empty
    },
    text: (text) => {
      if (inText && current.length < maxChars) current += text
    },
    close: (name) => {
      if (name === "t") inText = false
      else if (name === "rPh") phonetic = Math.max(0, phonetic - 1)
      else if (name === "si") strings.push(current.length > maxChars ? current.slice(0, maxChars) : current)
    },
  }))
  return strings
}

/** Ce que montre le format de chaque style de cellule (`cellXfs`), par index de style : une date, une heure, ou rien. */
export function readDateStyles(zip: ZipArchive, part: string | null, budget: InflateBudget): DateKind[] {
  if (part === null || !zip.has(part)) return []
  const custom = new Map<number, string>()
  const formats: number[] = []
  let inCellXfs = false
  scanPart(zip, part, budget, (stop) => ({
    open: (name, attributes) => {
      if (name === "numFmt" && attributes.formatCode !== undefined) custom.set(Number(attributes.numFmtId), attributes.formatCode)
      else if (name === "cellXfs") inCellXfs = true
      else if (name === "xf" && inCellXfs) formats.push(Number(attributes.numFmtId ?? 0))
    },
    close: (name) => {
      if (name !== "cellXfs") return
      inCellXfs = false
      stop()
    },
  }))
  return formats.map((id) => formatKind(id, custom))
}
