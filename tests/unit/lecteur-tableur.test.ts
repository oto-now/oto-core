// @vitest-environment node
// Le lecteur de tableur xlsx, lot 2 des lecteurs de fichiers (`lecture-des-fichiers.md` § Ce que rend chaque format,
// § Bornes, § Sécurité), sans base, par le vrai worker (le script généré, lancé par `eval`) : un classeur comme un
// tableur l'écrit (plusieurs feuilles, chaînes partagées enrichies, dates intégrées et personnalisées, heure, formules
// avec et sans valeur gardée, cellule fusionnée, feuilles cachées) en plan, par feuille et en tout ; puis les cas
// rouges : une bombe ZIP qui ment sur sa taille, un DOCTYPE à entités dans une partie, des chaînes partagées géantes,
// un million de cellules, un worker bloqué terminé à l'échéance ou mort de mémoire, un fichier chiffré ; enfin les deux
// places de worker du processus, rendues sur tout chemin. Les fixtures sont construites ici (`tests/helpers/xlsx.ts`) :
// aucun binaire commité.
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { Worker } from "node:worker_threads"
import { Deflate, strToU8 } from "fflate"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ZipArchive } from "../../packages/plateforme/server/files/readers/archive"
import { readText, startDeadline } from "../../packages/plateforme/server/files/readers/document"
import { readableExtensions, readerFor } from "../../packages/plateforme/server/files/readers/registry"
import { READER_LIMITS, type Reader, type ReaderDocument, type ReaderStatus } from "../../packages/plateforme/server/files/readers/types"
import { READER_WORKER_INPUTS } from "../../packages/plateforme/server/files/readers/worker/generated"
import { WORKER_SLOTS } from "../../packages/plateforme/server/files/readers/worker/slots"
import { decodeEntities } from "../../packages/plateforme/server/files/readers/xml"
import { customKind, serialToIso } from "../../packages/plateforme/server/files/readers/xlsx/dates"
import { readXlsx, XLSX_READER } from "../../packages/plateforme/server/files/readers/xlsx"
import { admittedType, checkSize } from "../../packages/plateforme/server/files/service"
import { PlatformError } from "../../packages/plateforme/server/errors"
import { BUDGET, BUDGET_TEXTS, cfbBytes, deflated, deflatedRun, rawWorkbookEntries, rawZip, xlsxBytes } from "../helpers/xlsx"

const { SYNTHESE, DETAIL, PARAMETRES, VIDE } = BUDGET_TEXTS

/** Les lectures qui gonflent des dizaines de mégaoctets ou courent jusqu'à l'échéance. */
const HEAVY_TIMEOUT = 60_000

const PACKAGE_ROOT = path.resolve(__dirname, "../../packages/plateforme")

/** Des scripts de worker d'essai : une boucle sans fin, une allocation sans borne, une exception à la demande. */
const STUCK = 'require("node:worker_threads").parentPort.on("message", () => { for (;;) {} })'
const HUNGRY = 'const kept = []; require("node:worker_threads").parentPort.on("message", () => { for (;;) kept.push(new Array(100000).fill(Math.random())) })'
const CRASHING = 'require("node:worker_threads").parentPort.on("message", () => { throw new Error("broken") })'

/** Un worker d'essai qui rend un plan `ms` millisecondes après chaque demande. */
const slow = (ms: number) =>
  `const { parentPort } = require("node:worker_threads"); parentPort.on("message", (request) => setTimeout(() => parentPort.postMessage({ id: request.id, result: { title: "t", summary: "s", parts: [] } }), ${ms}))`

/** Le refus d'une promesse, ou `null` si elle aboutit. */
const refusal = (run: Promise<unknown>) => run.then(() => null, (error: unknown) => error)

/** Le code, le message et la raison d'un refus de la plateforme. */
const said = (error: unknown) => (error instanceof PlatformError ? { code: error.code, message: error.message, reason: error.details?.reason } : error)

/** Le texte d'un classeur lu par le lecteur du paquet, sous les bornes communes (échéance de 10 s). */
async function readBook(bytes: Uint8Array, reader: Reader = XLSX_READER, ms?: number) {
  const deadline = startDeadline(ms)
  try {
    return await readText(reader, { name: "budget.xlsx", bytes }, deadline)
  } finally {
    deadline.clear()
  }
}

/** Le statut que rend le lecteur pour ces octets, sans les bornes communes. */
async function statusOf(bytes: Uint8Array, source?: string, signal = new AbortController().signal): Promise<ReaderStatus | ReaderDocument> {
  return readXlsx({ name: "budget.xlsx", bytes, signal }, source)
}

/** Une feuille de `rows` lignes de `columns` nombres, compressée au fil de son écriture. */
function bigSheet(rows: number, columns: number): Uint8Array {
  const out: Uint8Array[] = []
  const deflate = new Deflate({ level: 6 }, (chunk) => {
    out.push(chunk)
  })
  deflate.push(strToU8('<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'))
  const letters = Array.from({ length: columns }, (_, index) => String.fromCharCode(65 + index))
  for (let from = 1; from <= rows; from += 1_000) {
    let block = ""
    for (let row = from; row < from + 1_000 && row <= rows; row++) block += `<row r="${row}">${letters.map((letter, index) => `<c r="${letter}${row}"><v>${row * 10 + index}</v></c>`).join("")}</row>`
    deflate.push(strToU8(block))
  }
  deflate.push(strToU8("</sheetData></worksheet>"), true)
  const data = new Uint8Array(out.reduce((sum, chunk) => sum + chunk.length, 0))
  let at = 0
  for (const chunk of out) {
    data.set(chunk, at)
    at += chunk.length
  }
  return data
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("the xlsx reader", () => {
  it("should read a workbook as a spreadsheet writes it: one CSV part per sheet, hidden ones said, dates in ISO, saved values of formulas, a merged cell at its corner", async () => {
    const read = await readBook(xlsxBytes(BUDGET))
    expect([read.title, read.summary]).toEqual(["Budget 2026", "4 sheets: Synthèse (7 × 3), Détail (2 × 2), Paramètres (hidden, 1 × 3), Vide (hidden, empty)"])
    expect(read.parts).toEqual([
      { name: "Synthèse", chars: SYNTHESE.length },
      { name: "Détail", chars: DETAIL.length },
      { name: "Paramètres (hidden)", chars: PARAMETRES.length },
      { name: "Vide (hidden)", chars: VIDE.length },
    ])
    expect([await read.text("Synthèse"), await read.text("Détail"), await read.text("Paramètres (hidden)"), await read.text("Vide (hidden)")]).toEqual([SYNTHESE, DETAIL, PARAMETRES, VIDE])
    expect(await read.whole()).toBe([SYNTHESE, DETAIL, PARAMETRES, VIDE].join("\n"))
  })

  it("should take the file name for title without document properties, and refuse a workbook without cells as empty", async () => {
    const untitled = await readBook(xlsxBytes({ sheets: [{ name: "Feuil1", data: '<row r="1"><c r="A1"><v>1</v></c></row>' }] }))
    const empty = await refusal(readBook(xlsxBytes({ sheets: [{ name: "Feuil1", data: "" }] })))
    expect([untitled.title, untitled.summary]).toEqual(["budget.xlsx", "1 sheet: Feuil1 (1 × 1)"])
    expect(said(empty)).toEqual({ code: "invalid_arguments", message: "budget.xlsx cannot be read: its sheets hold no cells (empty).", reason: "empty" })
  })

  it("should read dates of the 1900 and 1904 calendars and the date formats of the package and custom ones", () => {
    expect([serialToIso(1, 1, false), serialToIso(60, 1, false), serialToIso(61, 1, false), serialToIso(46316, 1, false), serialToIso(0, 1, true), serialToIso(1.5, 3, false)]).toEqual([
      "1900-01-01",
      "1900-02-29",
      "1900-03-01",
      "2026-10-21",
      "1904-01-01",
      "36:00:00",
    ])
    expect(["yyyy-mm-dd", "[$-40C]d mmmm yyyy;@", "dd/mm/yyyy hh:mm", "[h]:mm:ss", "mmm", '#,##0.00 "€"', "0.00E+00", "[Red]0", "General"].map(customKind)).toEqual([1, 1, 2, 3, 1, 0, 0, 0, 0])
  })

  it("should admit xlsx at deposit as a binary of 50 MB and read it by the package reader", () => {
    expect(admittedType("Budget 2026.XLSX")).toEqual({ type: "xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
    expect(() => checkSize("budget.xlsx", "xlsx", READER_LIMITS.binaryBytes)).not.toThrow()
    expect(readerFor("xlsx")).toMatchObject({ reader: XLSX_READER, extension: "xlsx", maxBytes: READER_LIMITS.binaryBytes })
    expect(readableExtensions()).toEqual(["html", "md", "txt", "csv", "json", "xlsx"])
  })

  it("should run a worker script built from the current sources (pnpm widgets:build)", async () => {
    const { workerDigest } = (await import("../../packages/plateforme/widgets/build.mjs")) as { workerDigest: (files: string[]) => string }
    expect(READER_WORKER_INPUTS.files).toContain("server/files/readers/xlsx/sheet.ts")
    expect(READER_WORKER_INPUTS.files.every((file) => readFileSync(path.join(PACKAGE_ROOT, file)).length > 0)).toBe(true)
    expect(workerDigest(READER_WORKER_INPUTS.files), "the reader worker script is stale: run pnpm widgets:build").toBe(READER_WORKER_INPUTS.digest)
  })
})

describe("red cases of the xlsx reader", () => {
  it(
    "should refuse as too_large a zip bomb whose entry declares a few bytes and inflates past 64 MB, counted while inflating",
    async () => {
      const head = '<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>'
      const bomb = { name: "xl/sharedStrings.xml", data: deflatedRun(80 * 1_048_576, 0x61, head, "</t></si></sst>"), method: 8 as const, declaredSize: 120 }
      const entries = rawWorkbookEntries({ sheets: [{ name: "Feuil1", data: '<row r="1"><c r="A1" t="s"><v>0</v></c></row>' }] }).map((entry) => (entry.name === bomb.name ? bomb : entry))
      const bytes = rawZip(entries)
      // L'archive pèse moins de 100 Ko ; la décompression s'arrête au morceau qui passe 64 Mo, sans gonfler le reste.
      let produced = 0
      const counted = (() => {
        try {
          new ZipArchive(bytes).stream(bomb.name, { left: READER_LIMITS.decompressedBytes, total: READER_LIMITS.decompressedBytes }, (chunk) => (produced += chunk.length) > 0)
          return null
        } catch (error) {
          return error
        }
      })()
      expect(bytes.length).toBeLessThan(100_000)
      expect([counted instanceof Error && counted.message, produced <= READER_LIMITS.decompressedBytes, produced > READER_LIMITS.decompressedBytes - 5 * 1_048_576]).toEqual([
        "too_large: it unzips to more than 64 MB",
        true,
        true,
      ])
      expect(said(await refusal(readBook(bytes)))).toEqual({ code: "too_large", message: "budget.xlsx cannot be read: it unzips to more than 64 MB (too_large).", reason: "too_large" })
      // Une entrée qui déclare honnêtement plus que la borne est refusée avant d'être décompressée.
      const honest = rawZip(entries.map((entry) => (entry.name === bomb.name ? { ...bomb, declaredSize: 80 * 1_048_576 } : entry)))
      expect(await statusOf(honest)).toEqual({ status: "too_large", detail: "it unzips to more than 64 MB" })
    },
    HEAVY_TIMEOUT,
  )

  it("should refuse as rejected_dtd a DOCTYPE with entities in any XML part, expanding no entity", async () => {
    const laughs = `<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol">${Array.from({ length: 9 }, (_, index) => `<!ENTITY lol${index + 1} "${`&lol${index === 0 ? "" : index};`.repeat(10)}">`).join("")}]>`
    const inWorkbook = xlsxBytes({ ...BUDGET, parts: { "xl/workbook.xml": `${laughs}<workbook><sheets><sheet name="&lol9;" sheetId="1" r:id="rId1"/></sheets></workbook>` } })
    const external = xlsxBytes({
      sheets: [{ name: "Feuil1", data: "" }],
      parts: { "xl/worksheets/sheet1.xml": '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>&xxe;</t></is></c></row></sheetData></worksheet>' },
    })
    const inStrings = xlsxBytes({ ...BUDGET, parts: { "xl/sharedStrings.xml": '<!DOCTYPE sst SYSTEM "http://example.invalid/sst.dtd"><sst><si><t>x</t></si></sst>' } })
    const statuses = await Promise.all([inWorkbook, external, inStrings].map((bytes) => statusOf(bytes)))
    expect(statuses).toEqual(Array(3).fill({ status: "rejected_dtd", detail: "its XML declares a DOCTYPE, which is refused" }))
    expect(said(await refusal(readBook(external)))).toEqual({
      code: "invalid_arguments",
      message: "budget.xlsx cannot be read: its XML declares a DOCTYPE, which is refused (rejected_dtd).",
      reason: "rejected_dtd",
    })
    // Seules les cinq entités prédéfinies et les références numériques se lisent ; une autre reste telle quelle.
    expect(decodeEntities("&lt;&#65;&#x42;&lol9;&amp;&#0;&#xD800;")).toBe("<AB&lol9;&��")
  })

  it(
    "should cut giant shared strings at 2,000,000 characters, said by the cut line, and refuse a table past the bounds as too_large",
    async () => {
      const giant = "g".repeat(3_000_000)
      const read = await readBook(xlsxBytes({ strings: [giant, "petit"], sheets: [{ name: "Feuil1", data: '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' }] }))
      const text = await read.text("Feuil1")
      // La chaîne est gardée à 2 millions de caractères ; la partie qui la porte les passe de son titre : coupée.
      expect([read.declaredChars, read.chars, read.parts, text.length, text.startsWith("## Feuil1\ng")]).toEqual([
        "## Feuil1\n".length + READER_LIMITS.textChars + ",petit".length,
        READER_LIMITS.textChars,
        [{ name: "Feuil1", chars: READER_LIMITS.textChars }],
        READER_LIMITS.textChars,
        true,
      ])
      // Une table plus grosse que la borne de décompression : refusée, quelle que soit sa taille déclarée.
      const table = { name: "xl/sharedStrings.xml", data: deflatedRun(70 * 1_048_576, 0x62, "<sst><si><t>", "</t></si></sst>"), method: 8 as const, declaredSize: 70 * 1_048_576 }
      const entries = rawWorkbookEntries({ sheets: [{ name: "Feuil1", data: '<row r="1"><c r="A1" t="s"><v>0</v></c></row>' }] }).map((entry) => (entry.name === table.name ? table : entry))
      expect(await statusOf(rawZip(entries))).toEqual({ status: "too_large", detail: "it unzips to more than 64 MB" })
    },
    HEAVY_TIMEOUT,
  )

  it(
    "should outline a million cells within the deadline and cut a section of them at 2,000,000 characters",
    async () => {
      const entries = rawWorkbookEntries({ sheets: [{ name: "Grand", data: "" }, { name: "Petit", data: '<row r="1"><c r="A1"><v>1</v></c></row>' }] }).map((entry) =>
        entry.name === "xl/worksheets/sheet1.xml" ? { name: entry.name, data: bigSheet(100_000, 10), method: 8 as const, declaredSize: 0 } : entry,
      )
      const started = Date.now()
      const read = await readBook(rawZip(entries))
      const outlined = Date.now() - started
      const section = await read.text("Grand")
      console.info(`a million cells: outline in ${outlined} ms, section in ${Date.now() - started - outlined} ms`)
      expect(outlined).toBeLessThan(READER_LIMITS.readMs)
      // Le plan compte tout (100 000 lignes de 10 nombres) ; la partie servie s'arrête à la borne, la petite feuille part.
      let csv = "## Grand".length
      for (let row = 1; row <= 100_000; row++) for (let index = 0; index < 10; index++) csv += String(row * 10 + index).length + 1
      expect([read.summary, read.declaredChars, read.parts, section.length, section.split("\n")[1]]).toEqual([
        "2 sheets: Grand (100,000 × 10), Petit (1 × 1)",
        csv + "## Petit\n1".length,
        [{ name: "Grand", chars: READER_LIMITS.textChars }],
        READER_LIMITS.textChars,
        "10,11,12,13,14,15,16,17,18,19",
      ])
    },
    HEAVY_TIMEOUT,
  )

  it("should terminate a worker stuck in a loop at the deadline, with the status timeout", async () => {
    const terminate = vi.spyOn(Worker.prototype, "terminate")
    const reader: Reader = { types: XLSX_READER.types, read: (input) => readXlsx(input, STUCK) }
    const started = Date.now()
    const error = await refusal(readBook(xlsxBytes(BUDGET), reader, 500))
    const elapsed = Date.now() - started
    expect(said(error)).toEqual({ code: "conflict", message: "budget.xlsx cannot be read: it was not read within 10 seconds; retry later (timeout).", reason: "timeout" })
    expect(elapsed).toBeLessThan(5_000)
    // Le worker est bien terminé : `terminate()` rend le code de sortie d'un thread arrêté.
    expect(terminate).toHaveBeenCalledTimes(1)
    expect(typeof (await terminate.mock.results[0].value)).toBe("number")
  })

  // too_large pour un worker à court de mémoire, failed pour un worker qui lève : « the worker places of a process »,
  // dont la première assertion est la même.
  it("should refuse a password-protected workbook (an OLE container) as encrypted, an old binary one and a non-zip as unsupported", async () => {
    const statuses = await Promise.all([cfbBytes("EncryptedPackage"), cfbBytes("Workbook"), strToU8("client;montant\n")].map((bytes) => statusOf(bytes)))
    expect(statuses).toEqual([
      { status: "encrypted", detail: "it is protected by a password; ask for a copy without one" },
      { status: "unsupported", detail: "it is an old binary Office file, not xlsx; save it as xlsx" },
      { status: "unsupported", detail: "it is not a ZIP archive, so not a valid xlsx file" },
    ])
    // Une entrée chiffrée par le ZIP lui-même (drapeau de chiffrement) : encrypted aussi.
    const zipped = rawZip([{ ...deflated("_rels/.rels", "<Relationships/>"), flags: 1 }])
    expect(await statusOf(zipped)).toEqual({ status: "encrypted", detail: "its parts are encrypted" })
  })
})

describe("the worker places of a process", () => {
  /** Attend que les workers des tests précédents (une seconde d'inactivité) aient rendu leur place. */
  const settled = () => vi.waitFor(() => expect([WORKER_SLOTS.busy, WORKER_SLOTS.waiting]).toEqual([0, 0]), { timeout: 5_000, interval: 20 })

  it(
    "should run two reads at once and start a third one when a place is given back",
    async () => {
      await settled()
      expect(READER_LIMITS.workers).toBe(2)
      const started = Date.now()
      const done: number[] = []
      const reads = [0, 1, 2].map((index) =>
        statusOf(xlsxBytes(BUDGET), slow(200)).then((read) => {
          done[index] = Date.now() - started
          return read
        }),
      )
      await vi.waitFor(() => expect([WORKER_SLOTS.busy, WORKER_SLOTS.waiting]).toEqual([2, 1]), { interval: 10 })
      expect((await Promise.all(reads)).map((read) => (read as ReaderDocument).title)).toEqual(["t", "t", "t"])
      // La troisième ne part qu'à la sortie d'un des deux premiers workers, une seconde après leur réponse.
      expect(done[2] - Math.max(done[0], done[1])).toBeGreaterThan(1_000)
      await settled()
    },
    HEAVY_TIMEOUT,
  )

  it(
    "should give timeout to a read that waits past its deadline, without ever starting its worker",
    async () => {
      await settled()
      const dir = mkdtempSync(path.join(tmpdir(), "lecteur-places-"))
      const marker = path.join(dir, "started")
      // Un worker qui laisse une trace dès son lancement, et ne répond jamais.
      const marking = `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "x"); require("node:worker_threads").parentPort.on("message", () => {})`
      try {
        const holders = [0, 1].map(() => statusOf(xlsxBytes(BUDGET), slow(1_500)))
        await vi.waitFor(() => expect(WORKER_SLOTS.busy).toBe(2), { interval: 10 })
        const started = Date.now()
        expect(await statusOf(xlsxBytes(BUDGET), marking, AbortSignal.timeout(300))).toEqual({ status: "timeout" })
        expect([Date.now() - started < 1_000, WORKER_SLOTS.busy, WORKER_SLOTS.waiting]).toEqual([true, 2, 0])
        await Promise.all(holders)
        await settled()
        // Les places rendues, la lecture abandonnée ne part pas après coup ; le même script, lancé, laisse sa trace.
        expect(existsSync(marker)).toBe(false)
        expect(await statusOf(xlsxBytes(BUDGET), marking, AbortSignal.timeout(300))).toEqual({ status: "timeout" })
        expect(existsSync(marker)).toBe(true)
        await settled()
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
    HEAVY_TIMEOUT,
  )

  it(
    "should give the places back after a death of memory, an exception and a deadline, then run two reads at once",
    async () => {
      await settled()
      vi.spyOn(console, "error").mockImplementation(() => {})
      const deaths = await Promise.all([statusOf(xlsxBytes(BUDGET), HUNGRY), statusOf(xlsxBytes(BUDGET), CRASHING)])
      expect(deaths).toEqual([{ status: "too_large", detail: "reading it needs more than 256 MB of memory" }, { status: "failed" }])
      expect(await statusOf(xlsxBytes(BUDGET), STUCK, AbortSignal.timeout(300))).toEqual({ status: "timeout" })
      await settled()
      const reads = [0, 1].map(() => statusOf(xlsxBytes(BUDGET), slow(300)))
      await vi.waitFor(() => expect([WORKER_SLOTS.busy, WORKER_SLOTS.waiting]).toEqual([2, 0]), { interval: 10 })
      expect((await Promise.all(reads)).map((read) => (read as ReaderDocument).title)).toEqual(["t", "t"])
      await settled()
    },
    HEAVY_TIMEOUT,
  )
})
