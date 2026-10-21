// Des classeurs xlsx construits dans le test, pas de binaire commité : les parties qu'écrit un tableur (types de contenu,
// relations, propriétés, classeur, styles, chaînes partagées, feuilles), zippées par `fflate` ; et un ZIP écrit à la
// main, dont chaque entrée déclare la taille qu'on veut (une bombe qui ment sur elle-même). Sans lui, chaque cas du
// lecteur de tableur demanderait un fichier fait à la main.
import { Deflate, deflateSync, strToU8, zipSync } from "fflate"

/** Une feuille : son nom, son état, et le contenu de `<sheetData>` (et ce qui suit, `<mergeCells>`). */
export type SheetSpec = { name: string; state?: "hidden" | "veryHidden"; data: string; after?: string }

export type WorkbookSpec = {
  sheets: SheetSpec[]
  strings?: string[]
  title?: string
  date1904?: boolean
  /** Des parties remplacées ou ajoutées, par nom : un XML piégé, une feuille géante. */
  parts?: Record<string, string | Uint8Array>
}

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'

/** Les styles : 0 standard, 1 date (14), 2 date et heure (personnalisé 164), 3 heure (20), 4 nombre (4), 5 date personnalisée (165). */
const STYLES = `${DECL}<styleSheet ${NS}><numFmts count="2"><numFmt numFmtId="164" formatCode="dd/mm/yyyy\\ hh:mm"/><numFmt numFmtId="165" formatCode="[$-40C]d\\ mmmm\\ yyyy;@"/></numFmts><cellStyleXfs count="1"><xf numFmtId="0"/></cellStyleXfs><cellXfs count="6"><xf numFmtId="0"/><xf numFmtId="14" applyNumberFormat="1"/><xf numFmtId="164" applyNumberFormat="1"/><xf numFmtId="20" applyNumberFormat="1"/><xf numFmtId="4" applyNumberFormat="1"/><xf numFmtId="165" applyNumberFormat="1"/></cellXfs></styleSheet>`

const escapeXml = (text: string) => text.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/"/gu, "&quot;")

/** Les parties d'un classeur, par nom. */
export function workbookParts(spec: WorkbookSpec): Record<string, string | Uint8Array> {
  const sheets = spec.sheets.map((sheet, index) => ({ ...sheet, file: `sheet${index + 1}.xml`, id: `rId${index + 1}` }))
  const parts: Record<string, string | Uint8Array> = {
    "[Content_Types].xml": `${DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`,
    "_rels/.rels": `${DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
    "docProps/core.xml": `${DECL}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">${spec.title ? `<dc:title>${escapeXml(spec.title)}</dc:title>` : ""}<dc:creator>Test</dc:creator></cp:coreProperties>`,
    "xl/workbook.xml": `${DECL}<workbook ${NS}><workbookPr${spec.date1904 ? ' date1904="1"' : ""}/><bookViews><workbookView/></bookViews><sheets>${sheets
      .map((sheet, index) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}"${sheet.state ? ` state="${sheet.state}"` : ""} r:id="${sheet.id}"/>`)
      .join("")}</sheets><calcPr calcId="191029"/></workbook>`,
    "xl/_rels/workbook.xml.rels": `${DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
      .map((sheet) => `<Relationship Id="${sheet.id}" Type="${REL}/worksheet" Target="worksheets/${sheet.file}"/>`)
      .join("")}<Relationship Id="rIdS" Type="${REL}/styles" Target="styles.xml"/><Relationship Id="rIdT" Type="${REL}/sharedStrings" Target="/xl/sharedStrings.xml"/></Relationships>`,
    "xl/styles.xml": STYLES,
    "xl/sharedStrings.xml": `${DECL}<sst ${NS} count="${spec.strings?.length ?? 0}" uniqueCount="${spec.strings?.length ?? 0}">${(spec.strings ?? []).map((text) => (text.startsWith("<") ? `<si>${text}</si>` : `<si><t xml:space="preserve">${escapeXml(text)}</t></si>`)).join("")}</sst>`,
  }
  for (const sheet of sheets) {
    parts[`xl/worksheets/${sheet.file}`] = `${DECL}<worksheet ${NS}><dimension ref="A1"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetData>${sheet.data}</sheetData>${sheet.after ?? ""}</worksheet>`
  }
  return { ...parts, ...spec.parts }
}

/** Un classeur comme un tableur l'écrit. */
export const BUDGET: WorkbookSpec = {
  title: "Budget 2026",
  strings: [
    "Client",
    "Montant",
    "Date",
    "Valbrune, SA",
    '<r><t xml:space="preserve">Dupont </t></r><r><rPr><b/></rPr><t>&amp; fils</t></r><rPh sb="0" eb="1"><t>デュポン</t></rPh>',
    'Dit "oui"',
    "Total",
    "Synthèse 2026",
  ],
  sheets: [
    {
      name: "Synthèse",
      data: [
        '<row r="1" spans="1:3"><c r="A1" t="s"><v>7</v></c><c r="B1"/><c r="C1"/></row>',
        '<row r="2"><c r="A2" t="s"><v>0</v></c><c r="B2" t="s"><v>1</v></c><c r="C2" t="s"><v>2</v></c></row>',
        '<row r="3"><c r="A3" t="s"><v>3</v></c><c r="B3"><v>1200.5</v></c><c r="C3" s="1"><v>46316</v></c></row>',
        '<row r="4"><c r="A4" t="s"><v>4</v></c><c r="B4"><v>800</v></c><c r="C4" s="2"><v>46316.5</v></c></row>',
        '<row r="5"><c r="A5" t="s"><v>6</v></c><c r="B5"><f>SUM(B3:B4)</f><v>2000.5</v></c><c r="C5" s="1"><f>TODAY()</f></c><c r="D5"><f>C5+1</f><v></v></c></row>',
        '<row r="7"><c r="A7" t="inlineStr"><is><t>Note &lt;1&gt;</t></is></c><c r="B7" s="3"><v>0.75</v></c><c r="C7" t="b"><v>1</v></c></row>',
      ].join(""),
      after: '<mergeCells count="1"><mergeCell ref="A1:C1"/></mergeCells>',
    },
    {
      name: "Détail",
      data: '<row r="3"><c r="B3" t="s"><v>5</v></c><c r="C3"><v>3</v></c></row><row r="4"><c r="B4" t="e"><v>#DIV/0!</v></c><c r="C4" t="str"><f>A1&amp;"x"</f><v>ok</v></c></row>',
    },
    { name: "Paramètres", state: "hidden", data: '<row r="1"><c r="A1" t="inlineStr"><is><t>Taux</t></is></c><c r="B1" s="4"><v>0.2</v></c><c r="C1" s="5"><v>46316</v></c></row>' },
    { name: "Vide", state: "veryHidden", data: "" },
  ],
}

/** Le texte de chaque feuille de `BUDGET`, tel que le lecteur le rend. */
export const BUDGET_TEXTS = {
  SYNTHESE: [
    "## Synthèse",
    "(2 formulas have no saved value: their cells are empty.)",
    "Synthèse 2026,,",
    "Client,Montant,Date",
    '"Valbrune, SA",1200.5,2026-10-21',
    "Dupont & fils,800,2026-10-21T12:00:00",
    "Total,2000.5,",
    ",,",
    "Note <1>,18:00:00,TRUE",
  ].join("\n"),
  DETAIL: ["## Détail", '"Dit ""oui""",3', "#DIV/0!,ok"].join("\n"),
  PARAMETRES: ["## Paramètres (hidden)", "Taux,0.2,2026-10-21"].join("\n"),
  VIDE: ["## Vide (hidden)", "(empty sheet)"].join("\n"),
}

/** Les octets d'un classeur, zippés comme un tableur les zippe (DEFLATE). */
export function xlsxBytes(spec: WorkbookSpec): Uint8Array {
  const parts = workbookParts(spec)
  return zipSync(Object.fromEntries(Object.entries(parts).map(([name, content]) => [name, typeof content === "string" ? strToU8(content) : content])))
}

/** Une entrée d'un ZIP écrit à la main : ses octets compressés (ou stockés), la méthode et la taille qu'elle déclare. */
export type RawEntry = { name: string; data: Uint8Array; method: 0 | 8; declaredSize: number; flags?: number }

/** Une entrée DEFLATE d'un texte, déclarant sa vraie taille. */
export function deflated(name: string, text: string | Uint8Array): RawEntry {
  const bytes = typeof text === "string" ? strToU8(text) : text
  return { name, data: deflateSync(bytes), method: 8, declaredSize: bytes.length }
}

/** Le flux DEFLATE de `size` octets de `byte`, compressé par morceaux d'un mégaoctet : jamais tout en mémoire. */
export function deflatedRun(size: number, byte: number, head = "", tail = ""): Uint8Array {
  const out: Uint8Array[] = []
  const deflate = new Deflate({ level: 9 }, (chunk) => {
    out.push(chunk)
  })
  deflate.push(strToU8(head))
  const block = new Uint8Array(1_048_576).fill(byte)
  for (let left = size; left > 0; left -= block.length) deflate.push(left >= block.length ? block : block.subarray(0, left))
  deflate.push(strToU8(tail), true)
  return concat(out)
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0))
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.length
  }
  return out
}

/** Un ZIP écrit à la main : en-têtes locaux, répertoire central et fin, chaque entrée à la taille qu'elle déclare. */
export function rawZip(entries: readonly RawEntry[]): Uint8Array {
  const chunks: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const entry of entries) {
    const name = strToU8(entry.name)
    const local = new Uint8Array(30 + name.length)
    const view = new DataView(local.buffer)
    view.setUint32(0, 0x04034b50, true)
    view.setUint16(4, 20, true)
    view.setUint16(6, entry.flags ?? 0, true)
    view.setUint16(8, entry.method, true)
    view.setUint32(18, entry.data.length, true)
    view.setUint32(22, entry.declaredSize, true)
    view.setUint16(26, name.length, true)
    local.set(name, 30)
    const record = new Uint8Array(46 + name.length)
    const cv = new DataView(record.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint16(8, entry.flags ?? 0, true)
    cv.setUint16(10, entry.method, true)
    cv.setUint32(20, entry.data.length, true)
    cv.setUint32(24, entry.declaredSize, true)
    cv.setUint16(28, name.length, true)
    cv.setUint32(42, offset, true)
    record.set(name, 46)
    chunks.push(local, entry.data)
    central.push(record)
    offset += local.length + entry.data.length
  }
  const directory = concat(central)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, entries.length, true)
  ev.setUint16(10, entries.length, true)
  ev.setUint32(12, directory.length, true)
  ev.setUint32(16, offset, true)
  return concat([...chunks, directory, end])
}

/** Les entrées d'un classeur, chacune DEFLATE à sa vraie taille, pour `rawZip`. */
export const rawWorkbookEntries = (spec: WorkbookSpec): RawEntry[] => Object.entries(workbookParts(spec)).map(([name, content]) => deflated(name, content))

/** Un conteneur OLE (CFB) : l'en-tête, puis le nom d'un flux en UTF-16LE (`EncryptedPackage` pour un fichier chiffré). */
export function cfbBytes(stream: string): Uint8Array {
  const out = new Uint8Array(2048)
  out.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
  const name = [...stream].flatMap((char) => [char.charCodeAt(0), 0])
  out.set(name, 1024)
  return out
}
