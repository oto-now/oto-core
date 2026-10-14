// Analyse du markdown d'une opération de `write` en blocs typés (E03-S03, N7, N8, N44) : l'inverse
// exact du rendu commun de M05 (`renderBlocks`), sur le tableau « Formes canoniques » de la story, qui
// fait foi. Propriété testée : pour tout bloc `b` que cette analyse peut produire,
// `parseMarkdown(renderBlocks([b]))` redonne `b`. Sans lui, aucun texte envoyé par le modèle ne devient
// bloc.
//
// Repris d'Oto (`oto_mcp/db/blocks.py` l. 13-27, 71-117) : une propriété d'aller-retour vérifiable en
// une ligne ; une clôture de code isolée en bloc, son info = la langue ; la fermeture sur le même
// caractère, au moins aussi longue. Retiré : le markdown comme source (ici les blocs typés font foi), la
// clôture jamais fermée qui court jusqu'à la fin (ici refusée), le titre qui reste du texte (ici
// `heading`), le rejeu au démarrage.
//
// Tout ce qui lit le texte est linéaire (`security-patterns.md § Validation des inputs`) : expressions
// ancrées dont chaque caractère n'a qu'une lecture, sinon un parcours à la main (titre, image, clôture).
//
// E10-S04 : tableau simple, séparateur et repli (`markdown-rich.ts`), listes imbriquées sur trois niveaux
// (`markdown-lists.ts`, chaque ligne lue trois fois au plus), titres `##` à `######`.
//
// E10-S01 (AC-a2) : un mode tolérant, pour ce qu'envoie l'écran (collage, fichier importé). Il ne refuse rien :
// une construction que le mode strict refuse est gardée en texte (bloc `code` ou paragraphe, comptée dans
// `keptAsText`) ou ramenée à une forme admise (titre `#` au niveau 1, liste coupée en listes de 500, liste
// ramenée au troisième niveau, repli dans un repli gardé dans son corps). `write` reste strict.
//
// E10-S02 (AC-d1) : l'image et le fichier joints, par l'adresse de lecture d'un fichier (`markdown-files.ts`).
import { blockInputSchema, NODE_PATH_PATTERN, type BlockInput } from "../../schemas"
import { EMBED_HEIGHTS, embedUrlSchema, trimBlanks } from "../../schemas/blocks"
import { closesFence, LINE_SEPARATORS, openingFence, type Fence } from "../../schemas/link-syntax"
import { cut } from "../journal"
import { charCount, formatCount } from "./document"
import { FUNCTION_NAME_MAX, HEADING_TEXT_MAX, IMAGE_SRC_MAX, REFERENCE_PATH_MAX } from "./limits"
import { fileIdOfUrl, fileLinkAt } from "./markdown-files"
import { indentedFence, isBlank, isComment, markerOf, parseList } from "./markdown-lists"
import { isDivider, ParseProblem, parseToggle, refuse, refuseOrKeep, tableAt, toggleOpening, type ParseMode } from "./markdown-rich"

type Parsed = { block: BlockInput; line: number }

/** `##` à `######` : les niveaux 1 à 5 d'un bloc `heading` (headingBase 2, E10-S04 AC-b3). */
const HEADING_LEVELS = [1, 2, 3, 4, 5] as const
const QUOTE_MAX = 100

/** Une ligne citée dans un refus : sans espaces de bord, coupée à 100 caractères (`cut`, jamais dans un emoji). */
function quoted(text: string): string {
  return cut(text.trim(), QUOTE_MAX)
}

/** Un objet JSON (jamais un tableau ni `null`), ou `null`. */
function jsonObject(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text)
    // Un objet non tableau rendu par `JSON.parse` : ses clés sont des chaînes, TypeScript ne le déduit pas.
    return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
  } catch {
    // Pas du JSON : l'appelant le refuse en citant le texte.
    return null
  }
}

/** Nom de fonction puis objet JSON facultatif, sur une ou plusieurs lignes (nom seul = `{}`, N44). */
function callBlock(content: string, line: number): BlockInput {
  const body = content.trim()
  const match = /^(\S+)\s*([\s\S]*)$/.exec(body)
  if (!match) refuse(`line ${line}: a call block holds <function> {"argument": …}; this one is empty.`)
  const [, name, rest] = match
  if (charCount(name) > FUNCTION_NAME_MAX) {
    refuse(`line ${line}: a call block names a function of ${formatCount(FUNCTION_NAME_MAX)} characters at most (${formatCount(charCount(name))}).`)
  }
  const args = rest.trim() === "" ? {} : jsonObject(rest)
  if (!args) refuse(`line ${line}: a call block holds <function> {"argument": …}; « ${quoted(body)} » is not followed by a JSON object.`)
  return { type: "call", text: null, data: { function: name, args } }
}

/** Un chemin (H51), puis une vue JSON facultative, contrôlée comme un objet seulement (N42). */
function referenceBlock(content: string, line: number): BlockInput {
  const body = content.trim()
  const [, path = "", rest = ""] = /^(\S*)\s*([\s\S]*)$/.exec(body) ?? []
  const shape = `line ${line}: a reference block holds a path such as ventes/relance_devis, then an optional JSON view;`
  if (charCount(path) > REFERENCE_PATH_MAX || !NODE_PATH_PATTERN.test(path)) refuse(`${shape} « ${quoted(path)} » is not a path.`)
  if (rest.trim() === "") return { type: "reference", text: null, data: { path } }
  const view = jsonObject(rest)
  if (!view) refuse(`${shape} « ${quoted(rest)} » is not a JSON object.`)
  return { type: "reference", text: null, data: { path, view } }
}

/**
 * Une adresse `https` (1.4.3), puis une hauteur JSON facultative (`{"height": "large"}`) : la forme d'`embedUrlSchema` et
 * d'`EMBED_HEIGHTS`, contrôlée ici pour que le refus nomme la ligne.
 */
function embedBlock(content: string, line: number): BlockInput {
  const body = content.trim()
  const space = body.indexOf(" ")
  const url = space === -1 ? body : body.slice(0, space)
  const rest = space === -1 ? "" : body.slice(space + 1)
  const shape = `line ${line}: an embed block holds an https address, then an optional {"height": "small" | "medium" | "large"};`
  if (!embedUrlSchema.safeParse(url).success) refuse(`${shape} « ${quoted(url)} » is not an https address.`)
  if (rest.trim() === "") return { type: "embed", text: null, data: { url } }
  const options = jsonObject(rest)
  const height = EMBED_HEIGHTS.find((one) => one === options?.height)
  if (!height) refuse(`${shape} « ${quoted(rest)} » is not a height.`)
  return { type: "embed", text: null, data: { url, height } }
}

/** Les clôtures dont le mot de tête fait un autre bloc qu'un `code` : relues telles quelles, elles le redeviendraient. */
const SPECIAL_FENCES: ReadonlySet<string> = new Set(["call", "reference", "mermaid", "embed"])

/**
 * Le bloc d'une clôture ; tolérant (E10-S01, AC-a2) : un `call`, une `reference` ou un `embed` mal formés restent un bloc
 * `code`, leur texte d'origine, sans mot de tête ; un `mermaid` vide est retiré (`null`).
 */
function fenceBlock(fence: Fence, content: string, line: number, mode: ParseMode): BlockInput | null {
  const word = fence.info.split(/\s+/)[0] ?? ""
  if (word === "mermaid" && isBlank(content)) {
    if (!mode.tolerant) refuse(`line ${line}: a mermaid block holds a diagram; this one is empty.`)
    return null
  }
  try {
    if (word === "call") return callBlock(content, line)
    if (word === "reference") return referenceBlock(content, line)
    if (word === "embed") return embedBlock(content, line)
  } catch (error) {
    if (!(error instanceof ParseProblem) || !mode.tolerant) throw error
    mode.kept++
    return { type: "code", text: content, data: {} }
  }
  if (word === "mermaid") return { type: "mermaid", text: content, data: {} }
  return { type: "code", text: content, data: word ? { language: word } : {} }
}

/** Ce que lit une analyse : ses lignes, les blocs lus, et son mode. */
type Reading = { lines: string[]; out: Parsed[]; mode: ParseMode }

/**
 * Le bloc d'une clôture ouverte à la ligne `start` ; `fence.indent` espaces retirés de chaque ligne (N44). Jamais
 * fermée : refusée ; tolérant, un bloc `code` jusqu'à la fin du texte (E10-S01, AC-a2).
 */
function parseFence(reading: Reading, start: number, fence: Fence): number {
  const { lines, out, mode } = reading
  const content: string[] = []
  let at = start + 1
  const strip = new RegExp(`^ {0,${fence.indent}}`)
  while (at < lines.length && !closesFence(lines[at].replace(strip, ""), fence)) {
    content.push(lines[at].replace(strip, ""))
    at++
  }
  if (at >= lines.length) {
    refuseOrKeep(mode, `a code fence opened on line ${start + 1} (${quoted(lines[start])}) is never closed.`)
    const word = fence.info.split(/\s+/)[0] ?? ""
    out.push({ block: { type: "code", text: content.join("\n"), data: word && !SPECIAL_FENCES.has(word) ? { language: word } : {} }, line: start + 1 })
    return at
  }
  const block = fenceBlock(fence, content.join("\n"), start + 1, mode)
  if (block) out.push({ block, line: start + 1 })
  return at + 1
}

/**
 * Un titre `##` à `######` (niveaux 1 à 5) ; `#` refusé ; `null` : pas un titre, dont `#######` et plus
 * (CommonMark). Le texte suit les espaces et tabulations qui suivent les `#`, sans ceux de fin. Tolérant
 * (E10-S01, AC-a2) : `#` donne un titre de niveau 1 (C5) ; un titre de plus de 200 caractères reste un paragraphe.
 */
function headingAt(line: string, number: number, mode: ParseMode): BlockInput | null {
  const match = /^ {0,3}(#+)[ \t]/.exec(line)
  if (!match || match[1].length > HEADING_LEVELS.length + 1) return null
  const rest = line.slice(match[0].length)
  const text = trimBlanks(rest)
  if (text === "" || LINE_SEPARATORS.test(rest)) return null
  const hashes = match[1].length
  if (hashes === 1 && !mode.tolerant) refuse(`line ${number} « ${quoted(line)} » is the level of the page title; headings start at ##.`)
  if (charCount(text) > HEADING_TEXT_MAX) {
    refuseOrKeep(mode, `line ${number}: a heading holds ${formatCount(HEADING_TEXT_MAX)} characters at most (${formatCount(charCount(text))}).`)
    return null
  }
  return { type: "heading", text, data: { level: HEADING_LEVELS[Math.max(hashes - 2, 0)] } }
}

/**
 * `![alt](src)` ou `![alt](src "légende")` sur une ligne sans espaces de bord : le `](` le plus à
 * gauche après lequel la suite a cette forme, `src` sans blanc et non vide, `alt` et légende sans
 * séparateur de ligne. Un parcours à la main, en temps linéaire : la position du premier blanc est
 * connue pour chaque `](` (N70).
 */
function imageParts(line: string): { alt: string; src: string; caption: string | null } | null {
  if (!line.startsWith("![") || !line.endsWith(")")) return null
  const size = line.length
  const blankFrom = new Array<number>(size + 1).fill(size)
  for (let at = size - 1; at >= 0; at--) blankFrom[at] = /\s/.test(line[at]) ? at : blankFrom[at + 1]
  const firstSeparator = line.search(LINE_SEPARATORS)
  const lastSeparator = Math.max(line.lastIndexOf("\u2028"), line.lastIndexOf("\u2029"))
  for (let bracket = line.indexOf("](", 2); bracket !== -1; bracket = line.indexOf("](", bracket + 1)) {
    if (firstSeparator !== -1 && firstSeparator < bracket) return null
    const start = bracket + 2
    const blank = blankFrom[start]
    if (blank === size && size - 1 > start) return { alt: line.slice(2, bracket), src: line.slice(start, size - 1), caption: null }
    const captioned = blank > start && blank < size && line[blank] === " " && line[blank + 1] === '"' && line.endsWith('")') && blank + 2 <= size - 2
    if (captioned && lastSeparator < blank + 2) return { alt: line.slice(2, bracket), src: line.slice(start, blank), caption: line.slice(blank + 2, size - 2) }
  }
  return null
}

/** Une image seule sur sa ligne : `![alt](src)` ou `![alt](src "légende")` ; tolérant, une source trop longue reste du texte. */
function imageAt(line: string, number: number, mode: ParseMode): BlockInput | null {
  const image = imageParts(line.trim())
  if (!image) return null
  const { alt, src, caption } = image
  if (charCount(src) > IMAGE_SRC_MAX) {
    refuseOrKeep(mode, `line ${number}: an image source holds ${formatCount(IMAGE_SRC_MAX)} characters at most (${formatCount(charCount(src))}).`)
    return null
  }
  // Une image jointe (E10-S02, AC-d1) : l'adresse de lecture d'un fichier devient son `file_id`, quelle que soit l'origine.
  const fileId = fileIdOfUrl(src)
  return { type: "image", text: caption, data: fileId ? { file_id: fileId, alt } : { src, alt } }
}

function parseCallout(reading: Reading, start: number): number {
  const { lines, out } = reading
  const body: string[] = []
  let at = start
  while (at < lines.length && /^ {0,3}>/.test(lines[at])) body.push(lines[at++].replace(/^ {0,3}> ?/, ""))
  const tone = /^\[!([A-Za-z]+)\]\s*$/.exec(body[0] ?? "")
  if (tone) body.shift()
  out.push({ block: { type: "callout", text: body.join("\n"), data: tone ? { tone: tone[1].toLowerCase() } : {} }, line: start + 1 })
  return at
}

/**
 * Une ligne qui ouvre un autre bloc interrompt un paragraphe ; une liste numérotée seulement à 1 ; un tableau
 * et un séparateur jamais (HN-E10S04-5), sauf un séparateur en mode tolérant (E10-S01, AC-a2).
 */
function interrupts(line: string, number: number, mode: ParseMode): boolean {
  if (openingFence(line, 3) || /^ {0,3}>/.test(line) || headingAt(line, number, mode) || imageAt(line, number, mode) || fileLinkAt(line) || toggleOpening(line) !== null) return true
  if (mode.tolerant && isDivider(line)) return true
  const marker = markerOf(line)
  return marker !== null && (!marker.ordered || marker.number === 1)
}

function parseParagraph(reading: Reading, start: number): number {
  const { lines, out, mode } = reading
  const text = [lines[start]]
  let at = start + 1
  while (at < lines.length && !isBlank(lines[at]) && !interrupts(lines[at], at + 1, mode)) {
    if (!isComment(lines[at])) text.push(lines[at])
    at++
  }
  out.push({ block: { type: "paragraph", text: text.join("\n"), data: {} }, line: start + 1 })
  return at
}

/** Une liste, puis la clôture indentée qui la coupe (N44). */
function parseListAt(reading: Reading, start: number, first: NonNullable<ReturnType<typeof markerOf>>): number {
  const { lines, out, mode } = reading
  const list = parseList(lines, start, first, mode)
  for (const block of list.blocks) out.push({ block, line: start + 1 })
  const fence = list.next < lines.length && indentedFence(lines[list.next]) ? openingFence(lines[list.next], Number.MAX_SAFE_INTEGER) : null
  return fence ? parseFence(reading, list.next, fence) : list.next
}

function parseBlockAt(reading: Reading, at: number): number {
  const { lines, out, mode } = reading
  const line = lines[at]
  if (isBlank(line) || isComment(line)) return at + 1
  const fence = openingFence(line, 3)
  if (fence) return parseFence(reading, at, fence)
  const single = headingAt(line, at + 1, mode) ?? imageAt(line, at + 1, mode) ?? fileLinkAt(line)
  if (single) {
    out.push({ block: single, line: at + 1 })
    return at + 1
  }
  if (/^ {0,3}>/.test(line)) return parseCallout(reading, at)
  const rich = isDivider(line) ? { block: { type: "divider", text: null, data: {} } as const, next: at + 1 } : tableAt(lines, at, mode)
  const opening = rich ? null : toggleOpening(line)
  const found = rich ?? (opening === null ? null : parseToggle(lines, at, opening, mode))
  if (found) {
    out.push({ block: found.block, line: at + 1 })
    return found.next
  }
  const marker = markerOf(line)
  if (marker) return parseListAt(reading, at, marker)
  return parseParagraph(reading, at)
}

/**
 * Tolérant (E10-S01, AC-a2) : un bloc que `blockInputSchema` refuse encore reste un bloc `code`, les lignes du
 * texte d'où il vient ; `null` quand même ce bloc est refusé.
 */
function keptAsCode(lines: readonly string[], from: number, to: number): BlockInput | null {
  const block: BlockInput = { type: "code", text: lines.slice(from - 1, to - 1).join("\n").trimEnd(), data: {} }
  return blockInputSchema.safeParse(block).success ? block : null
}

/**
 * Les blocs d'un texte markdown (tableau « Formes canoniques », N8, N44), avec la ligne où chacun
 * commence (1 pour la première du texte) ; ou le refus de l'AC3, sans préfixe ni fin. `\r\n` devient
 * `\n` ; les lignes vides de bord et les lignes faites d'un seul commentaire hors d'une clôture sont
 * ignorées. Chaque bloc rendu passe `blockInputSchema`. `tolerant` (E10-S01, AC-a2) : rien n'est refusé, et
 * `keptAsText` compte les constructions gardées en texte ; sans lui, aucun champ de plus.
 */
export function parseMarkdown(text: string, options: { tolerant?: boolean } = {}): { blocks: BlockInput[]; lines: number[]; keptAsText?: number } | { problem: string } {
  const lines = text.replace(/\r\n?/g, "\n").split("\n")
  const reading: Reading = { lines, out: [], mode: { tolerant: options.tolerant === true, kept: 0 } }
  try {
    for (let at = 0; at < lines.length; ) at = parseBlockAt(reading, at)
  } catch (error) {
    if (error instanceof ParseProblem) return { problem: error.message }
    throw error
  }
  const { out: parsed, mode } = reading
  for (const [index, entry] of parsed.entries()) {
    const valid = blockInputSchema.safeParse(entry.block)
    if (valid.success) continue
    const kept = mode.tolerant ? keptAsCode(lines, entry.line, parsed[index + 1]?.line ?? lines.length + 1) : null
    if (!kept) return { problem: `line ${entry.line}: this block is not valid (${valid.error.issues[0]?.message ?? "invalid"}).` }
    entry.block = kept
    mode.kept++
  }
  const blocks = { blocks: parsed.map(({ block }) => block), lines: parsed.map(({ line }) => line) }
  return mode.tolerant ? { ...blocks, keptAsText: mode.kept } : blocks
}

