// Les lecteurs texte du paquet (`lecture-des-fichiers.md` § Ce que rend chaque format) : `html`, `md`, `txt`, `csv` et
// `json`, tels quels, en UTF-8 strict, BOM retiré. Leurs parties découpent le texte sans rien en retirer (jointes par un
// saut de ligne, elles le redonnent) : les titres `#`, `##` et `###` d'un `md` hors des blocs de code, sinon des suites
// de lignes d'au plus une page (`lines 1-230`). Un `html` se découpe en lignes jusqu'à son lecteur du texte utile : ses
// titres demandent un vrai analyseur, pas une expression rationnelle (§ Décisions). Chaque ligne se lit à la main, en
// temps linéaire (`security-patterns.md § Validation des inputs`). Sans eux, `read {file}` n'aurait ni plan ni partie.
import { FILE_TYPES, type FileType } from "../../../schemas/files"
import { frontmatterHead, splitFrontmatter } from "../../../schemas/frontmatter"
import { PAGE_FULL_MAX } from "../../nodes/limits"
import type { Reader, ReaderDocument, ReaderStatus } from "./types"

/** Caractères d'une suite de lignes : une page, servie en entier par un appel. */
const LINES_PART_CHARS = PAGE_FULL_MAX

/** Le nom de la partie qui précède le premier titre d'un `md`. */
export const START_PART = "(start of file)"

/** Longueur d'un nom de partie, sous celle de `section` (200), suffixe d'homonyme compris. */
const PART_NAME_MAX = 190

/** Le refus d'un octet invalide, dit comme la visionneuse (AC-c2). */
export const NOT_UTF8 = "the file is not UTF-8; download it instead"

/** Le texte d'octets en UTF-8 strict, BOM de tête retiré ; `null` pour un octet invalide. */
export function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    // `fatal` : un octet invalide lève ; le BOM de tête est retiré (`ignoreBOM` faux par défaut).
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

type Slice = { name: string; lines: readonly string[] }

/** Un document fait de tranches de lignes contiguës. */
function documentOf(head: { title: string; summary: string }, slices: readonly Slice[]): ReaderDocument {
  const texts = new Map(slices.map((slice) => [slice.name, slice.lines.join("\n")]))
  return {
    ...head,
    parts: slices.map((slice) => ({ name: slice.name, chars: texts.get(slice.name)?.length ?? 0 })),
    text: (part) => texts.get(part) ?? "",
  }
}

/** Les lignes `lines[from..to)` en suites d'au plus `LINES_PART_CHARS` caractères ; une ligne plus longue reste seule. */
function lineSlices(lines: readonly string[], from = 0, to = lines.length): Slice[] {
  const slices: Slice[] = []
  const named = (start: number, end: number): Slice => ({ name: end - start === 1 ? `line ${start + 1}` : `lines ${start + 1}-${end}`, lines: lines.slice(start, end) })
  let start = from
  let size = 0
  for (let at = from; at < to; at++) {
    const length = lines[at].length + (at > start ? 1 : 0)
    if (at > start && size + length > LINES_PART_CHARS) {
      slices.push(named(start, at))
      start = at
      size = lines[at].length
    } else {
      size += length
    }
  }
  slices.push(named(start, Math.max(to, start + 1)))
  return slices
}

/** Les blancs de tête d'une ligne : 3 espaces au plus, comme CommonMark ; `-1` au-delà. */
function indentOf(line: string): number {
  let at = 0
  while (at < line.length && line[at] === " ") at++
  return at > 3 ? -1 : at
}

/** La suite de « ` » ou de « ~ » qui ouvre ou ferme un bloc de code (trois au moins), sinon `null`. */
function fenceOf(line: string): string | null {
  const at = indentOf(line)
  if (at < 0) return null
  const mark = line[at]
  if (mark !== "`" && mark !== "~") return null
  let end = at
  while (end < line.length && line[end] === mark) end++
  return end - at >= 3 ? line.slice(at, end) : null
}

/** Le texte d'un titre `#`, `##` ou `###`, sans ses dièses de fin ; `null` pour une autre ligne. */
function headingOf(line: string): string | null {
  const indent = indentOf(line)
  if (indent < 0) return null
  let at = indent
  while (at < line.length && line[at] === "#") at++
  const level = at - indent
  if (level < 1 || level > 3 || (line[at] !== " " && line[at] !== "\t")) return null
  let text = line.slice(at).trim()
  // Les dièses de fin (`## Titre ##`) ne comptent que précédés d'un blanc.
  let end = text.length
  while (end > 0 && text[end - 1] === "#") end--
  if (end === 0) text = ""
  else if (end < text.length && (text[end - 1] === " " || text[end - 1] === "\t")) text = text.slice(0, end).trimEnd()
  return text === "" ? null : text
}

/** Les noms des parties, coupés à `PART_NAME_MAX` et rendus uniques par « (2) », « (3) »… */
function uniqueNames(names: readonly string[]): string[] {
  const seen = new Map<string, number>()
  return names.map((raw) => {
    const name = raw.slice(0, PART_NAME_MAX)
    const count = (seen.get(name) ?? 0) + 1
    seen.set(name, count)
    return count === 1 ? name : `${name} (${count})`
  })
}

/** Les sections d'un `md` à ses titres de niveau 1 à 3, hors frontmatter et blocs de code ; `null` sans titre. */
function markdownSlices(lines: readonly string[], bodyStart: number): Slice[] | null {
  const headings: { at: number; text: string }[] = []
  let fence: string | null = null
  for (let at = bodyStart; at < lines.length; at++) {
    const mark = fenceOf(lines[at])
    if (fence !== null) {
      if (mark !== null && mark[0] === fence[0] && mark.length >= fence.length && lines[at].trim() === mark) fence = null
      continue
    }
    if (mark !== null) {
      fence = mark
      continue
    }
    const text = headingOf(lines[at])
    if (text !== null) headings.push({ at, text })
  }
  if (headings.length === 0) return null
  const first = headings[0].at
  // Une tête faite de blancs rejoint la première section : rien d'illisible ne devient une partie.
  const start = lines.slice(0, first).some((line) => line.trim() !== "") ? [{ text: START_PART, at: 0 }] : []
  if (start.length === 0) headings[0] = { ...headings[0], at: 0 }
  const bounds = [...start, ...headings]
  const names = uniqueNames(bounds.map((bound) => bound.text))
  return bounds.map((bound, index) => ({ name: names[index], lines: lines.slice(bound.at, bounds[index + 1]?.at ?? lines.length) }))
}

/** « 1,500 lines » : le résumé d'un fichier texte. */
function linesSummary(lines: readonly string[]): string {
  return `${lines.length.toLocaleString("en-US")} ${lines.length === 1 ? "line" : "lines"}`
}

/** Le lecteur d'un fichier texte : titre et parties tirés des lignes. */
function textReader(type: FileType, shape: (name: string, lines: readonly string[]) => ReaderDocument): Reader {
  return {
    types: [{ extension: type, mime: FILE_TYPES[type] }],
    read: ({ name, bytes }): ReaderDocument | ReaderStatus => {
      const text = decodeUtf8(bytes)
      if (text === null) return { status: "unsupported", detail: NOT_UTF8 }
      return shape(name, text.split("\n"))
    },
  }
}

/** Un fichier lu en suites de lignes : `html`, `txt`, `csv`, `json`. */
const byLines = (name: string, lines: readonly string[]) => documentOf({ title: name, summary: linesSummary(lines) }, lineSlices(lines))

/** Un `md` : titre du frontmatter, sinon du premier titre, sinon le nom ; parties à ses titres, sinon en lignes. */
function markdown(name: string, lines: readonly string[]): ReaderDocument {
  const front = splitFrontmatter(lines)
  const head = frontmatterHead(front)
  const slices = markdownSlices(lines, front?.end ?? 0)
  const firstHeading = slices?.find((slice) => slice.name !== START_PART)?.name
  return documentOf({ title: head.title ?? firstHeading ?? name, summary: head.summary ?? linesSummary(lines) }, slices ?? lineSlices(lines))
}

/** Les lecteurs que le paquet inscrit d'office, un par fichier texte. */
export const TEXT_READERS: readonly Reader[] = [textReader("html", byLines), textReader("md", markdown), textReader("txt", byLines), textReader("csv", byLines), textReader("json", byLines)]
