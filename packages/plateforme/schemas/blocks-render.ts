// Rendu des blocs (tâche M05 ; ADR-011 § 5) : ordre, markdown, sections et emplacement d'un bloc
// `call`, en fonctions pures, sans base ni import de server/, pour que `read` et `write` (E03-S03),
// `context` (E03-S02, E03-S08), le contrôle des procédures (E03-S06), les références (E03-S07) et les
// écrans (ui/) partagent un seul rendu. Sans ce module, chacun réécrirait le sien, et un texte servi
// par `context` ou vérifié à la publication différerait de celui que `read` sert et que `write` relit.
//
// Règles : « Contrat pour les autres stories » d'E01-S06, § 3 (ordre, section, emplacement d'un
// `call`, rendu) ; tableau « Formes canoniques » d'E03-S03, qui fait foi pour le rendu et dont
// `parseMarkdown` (E03-S03) est l'inverse ; règle 7 d'E03-S06 (format de l'emplacement). Un bloc que
// `blockInputSchema` refuse (forme que la base admet par ses chemins JSON `lax`, E01-S06 N44, ou type
// et forme écrits par une version plus récente, M67) n'est ni titre de section, ni liste qui numérote
// une étape ; il est rendu à sa place par une ligne de commentaire (`isUnknownBlock`, M67, D122), jamais
// effacé : un hôte resté en 1.0 le perdrait en silence, et un `write` par section le réécrirait sans lui.
//
// Repris de la maquette (`mcp-test/src/proto/services/sections.ts`, `sameTitle`) : titres comparés
// sans casse, sans accent et sans espace de bord. Retiré : les sections `{title, body}` en markdown
// (→ plages de blocs).
import { blockInputSchema, chars, isBlankLine, trimBlanks, type BlockInput } from "./blocks"
import { fileBaseName } from "./csv"
import { fileLink, filePath } from "./files"
import { frontmatterHead, splitFrontmatter } from "./frontmatter"
import { closesFence, LINE_SEPARATORS, openingFence, type Fence } from "./link-syntax"
import { NODE_HEAD_MAX, normalizeTitle, OP_TEXT_MAX } from "./nodes"

/**
 * Forme minimale d'un bloc : celle de `BlockInput` (E01-S06), d'une ligne de `blocks`, ou d'un bloc
 * de brouillon calculé avant son écriture, qui n'a encore ni `id` ni `position`.
 */
export type BlockLike = {
  type: string
  text?: string | null
  data?: unknown
  key?: string | null
  id?: string | null
  position?: number | null
}

export type RenderOptions<B extends BlockLike = BlockLike> = {
  /** Nombre de `#` d'un titre de niveau 1 (défaut 2 : le titre du nœud prend `#`) ; `context` passe 3. */
  headingBase?: number
  /** Rendu d'un bloc `reference` à la place de sa clôture relisible (E03-S07 : ligne résolue). */
  reference?: (block: B) => string
  /** Référence affichée d'un bloc (E03-S03, `displayRefs`) : une chaîne donne la ligne `<!-- ref: … -->` avant lui. */
  refs?: (block: B) => string | null
  /**
   * La route des fichiers d'un bloc `file` ou d'une image jointe (E10-S02, AC-d1) : `read` passe `<origine>` suivie de
   * `FILE_ADDRESS` (`/f`), pour qu'un assistant tienne une adresse absolue ; sans elle, `FILE_ADDRESS`, relative à la page.
   */
  fileRoute?: string
}

/** Une section : son titre (`null` pour le début de page) et ses blocs, titre en tête, sous-sections comprises. */
export type BlockSection<B extends BlockLike = BlockLike> = { heading: B | null; blocks: B[] }

/** Emplacement d'un bloc `call` : titre le plus proche avant lui, rang parmi les `call` qui le suivent, étape. */
export type CallLocation = { section: string | null; rank: number; step: number | null }

const DEFAULT_HEADING_BASE = 2

/** Le bloc tel que le schéma partagé l'accepte (E01-S06 N44), ou `null`. */
function validated(block: BlockLike): BlockInput | null {
  const parsed = blockInputSchema.safeParse(block)
  return parsed.success ? parsed.data : null
}

/**
 * Un bloc que cette version ne sait pas lire (M67, D122) : type ou forme que le schéma partagé refuse.
 * `read` le sert par une ligne de commentaire ; `write` refuse de le perdre (`server/nodes/section-ops.ts`,
 * `block-ops.ts`).
 */
export function isUnknownBlock(block: BlockLike): boolean {
  return validated(block) === null
}

// ------------------------------------------------------------------------------------------ Ordre

/** Valeur de tri d'une position ou d'un `id` : absente (nulle, `NaN`) après toutes les autres. */
function sortKey<T extends number | string>(value: T | null | undefined): T | null {
  if (value === null || value === undefined) return null
  return typeof value === "number" && Number.isNaN(value) ? null : value
}

/** Comparaison croissante, valeurs absentes en dernier, comme `order by … nulls last` de Postgres. */
function compareNullsLast<T extends number | string>(a: T | null, b: T | null): number {
  if (a === null) return b === null ? 0 : 1
  if (b === null) return -1
  if (a < b) return -1
  return a > b ? 1 : 0
}

/**
 * Les blocs d'un document dans leur ordre de lecture, par (`position`, `id`) (E01-S06 § 3, l'ordre de
 * la lecture en base) : un bloc sans position vient après les blocs placés ; à position égale, un bloc
 * sans `id` vient après les autres ; à égalité complète, l'ordre reçu est gardé. Rend un nouveau tableau.
 */
export function orderBlocks<B extends BlockLike>(blocks: readonly B[]): B[] {
  return [...blocks].sort(
    (a, b) =>
      compareNullsLast(sortKey(a.position), sortKey(b.position)) || compareNullsLast(sortKey(a.id), sortKey(b.id)),
  )
}

// ---------------------------------------------------------------------------------------- Rendu

/** Clôture d'accents graves plus longue que toute suite d'accents graves du texte, trois au moins ; aussi celle du texte d'un fichier (`read {file}`, AC-d2). */
export function fenceFor(text: string): string {
  let longest = 0
  for (const run of text.match(/`+/g) ?? []) longest = Math.max(longest, run.length)
  return "`".repeat(Math.max(3, longest + 1))
}

function fenced(info: string, content: string, fence = "```"): string {
  return `${fence}${info}\n${content}\n${fence}`
}

/** Les lignes indentées de `pad`, une ligne vide laissée vide. */
const indented = (lines: readonly string[], pad: string) => lines.map((line) => (line === "" ? line : `${pad}${line}`))

/**
 * Un élément de liste : sa marque, puis ses lignes suivantes indentées de deux espaces ; sa sous-liste
 * (E10-S04, AC-b1) indentée de la largeur de sa marque et d'un espace, comme CommonMark.
 */
function listItem(marker: string, text: string, children?: ListLike): string {
  const [first, ...rest] = text.split("\n")
  const lines = [`${marker} ${first}`, ...indented(rest, "  ")]
  if (children) lines.push(...indented(listLines(children).split("\n"), " ".repeat(marker.length + 1)))
  return lines.join("\n")
}

/** Une liste, sous-listes comprises : la forme de `list.data` et de chaque `children`. */
type ListLike = { items: readonly (string | { text: string; children: ListLike })[]; ordered?: boolean; start?: number }

/** Les lignes d'une liste : `- ` ou `N. ` à partir de `start`, par niveau. */
function listLines({ items, ordered, start = 1 }: ListLike): string {
  return items
    .map((item, index) => {
      const marker = ordered === true ? `${start + index}.` : "-"
      return typeof item === "string" ? listItem(marker, item) : listItem(marker, item.text, item.children)
    })
    .join("\n")
}

/** Un tableau simple (E10-S04, AC-a1) : en-tête, délimitation (`---`, `:---`, `:---:`, `---:`), une ligne par rangée. */
function tableLines(data: { columns: readonly string[]; rows: readonly (readonly string[])[]; align?: readonly (string | null)[] }): string {
  const line = (cells: readonly string[]) => `| ${cells.join(" | ")} |`
  const delimiter = (align: string | null | undefined) => (align === "left" ? ":---" : align === "center" ? ":---:" : align === "right" ? "---:" : "---")
  return [line(data.columns), line(data.columns.map((_, index) => delimiter(data.align?.[index]))), ...data.rows.map(line)].join("\n")
}

/** Un repli (E10-S04, AC-a3) : `<details>`, le résumé, une ligne vide, le corps et une ligne vide s'il n'est pas vide. */
function toggleLines(summary: string, body: string): string {
  return ["<details>", `<summary>${summary}</summary>`, "", ...(body === "" ? [] : [body, ""]), "</details>"].join("\n")
}

/** Le plus grand nombre de `#` d'un titre markdown (CommonMark) : `context` (base 3) y borne ses niveaux 4 et 5. */
const HASHES_MAX = 6

/**
 * Le corps d'un bloc selon les formes canoniques d'E03-S03 ; un bloc refusé, la ligne de M67 (une ligne
 * de commentaire, que `parseMarkdown` ignore) ; `null` : jamais rendu (ligne de tableau).
 */
function renderBody<B extends BlockLike>(block: B, options: RenderOptions<B>): string | null {
  if (block.type === "row") return null
  const valid = validated(block)
  if (valid === null) return `<!-- block ${block.type} not shown: this platform version does not know it -->`
  switch (valid.type) {
    case "heading":
      return `${"#".repeat(Math.min(HASHES_MAX, (options.headingBase ?? DEFAULT_HEADING_BASE) + valid.data.level - 1))} ${valid.text}`
    case "paragraph":
      return valid.text
    case "list":
      return listLines(valid.data)
    case "checklist":
      return valid.data.items.map((item) => listItem(item.checked ? "- [x]" : "- [ ]", item.text)).join("\n")
    case "code":
      return fenced(valid.data?.language ?? "", valid.text, fenceFor(valid.text))
    case "call":
      return fenced("call", `${valid.data.function} ${JSON.stringify(valid.data.args)}`)
    case "mermaid":
      return fenced("mermaid", valid.text, fenceFor(valid.text))
    case "image": {
      const caption = valid.text === null || valid.text === undefined ? "" : ` "${valid.text}"`
      // Une image jointe (E10-S02, AC-d1) : l'adresse de lecture du fichier, sur la route donnée (`read` : absolue).
      return `![${valid.data.alt ?? ""}](${valid.data.src ?? filePath(valid.data.file_id ?? "", options.fileRoute)}${caption})`
    }
    case "callout": {
      const tone = valid.data?.tone ? [`> [!${valid.data.tone.toUpperCase()}]`] : []
      return [...tone, ...valid.text.split("\n").map((line) => `> ${line}`)].join("\n")
    }
    case "reference": {
      if (options.reference) return options.reference(block)
      const { path, view } = valid.data
      return fenced("reference", view === undefined ? path : `${path} ${JSON.stringify(view)}`)
    }
    case "row":
      return null
    case "simple_table":
      return tableLines(valid.data)
    case "divider":
      return "---"
    case "toggle":
      return toggleLines(valid.data.summary, valid.text)
    // Un fichier joint (E10-S02, AC-d1) : « [<nom> (<taille>, <type>)](<route>/<id>) », le nom tel quel, comme le texte
    // alternatif d'une image ; `parseMarkdown` le relit de droite à gauche (`markdown-files.ts`). Le type est
    // l'extension du nom (`pdf`, `dxf` d'un type de l'hôte), le type de la ligne pour un nom sans extension.
    // Un cadre intégré (1.4.3) : son adresse dans une clôture `embed`, sa hauteur ensuite quand elle est choisie.
    case "embed": return fenced("embed", valid.data.height === undefined ? valid.data.url : `${valid.data.url} ${JSON.stringify({ height: valid.data.height })}`)
    case "file":
      return fileLink({ id: valid.data.file_id, name: valid.data.name, size: valid.data.size, mime: valid.data.mime }, options.fileRoute)
  }
}

/**
 * Le markdown d'un bloc, précédé d'une ligne `<!-- ref: … -->` quand `refs` rend une chaîne. Une ligne
 * de tableau n'est jamais rendue : chaîne vide, sans ligne de référence. Un bloc que le schéma partagé
 * refuse rend `<!-- block <type> not shown: this platform version does not know it -->` (M67). Sans
 * l'option `reference`, un bloc `reference` rend sa clôture relisible.
 */
export function renderBlock<B extends BlockLike>(block: B, options: RenderOptions<B> = {}): string {
  const body = renderBody(block, options)
  if (body === null) return ""
  const ref = options.refs?.(block)
  const lines = typeof ref === "string" ? [`<!-- ref: ${ref} -->`] : []
  if (body !== "") lines.push(body)
  return lines.join("\n")
}

/** Les blocs dans l'ordre reçu (voir `orderBlocks`), une ligne vide entre deux blocs rendus. */
export function renderBlocks<B extends BlockLike>(blocks: readonly B[], options: RenderOptions<B> = {}): string {
  return blocks
    .map((block) => renderBlock(block, options))
    .filter((markdown) => markdown !== "")
    .join("\n\n")
}

// ------------------------------------------------------------------------------------- Sections

/** Niveau et texte d'un titre que le schéma partagé accepte ; `null` pour tout autre bloc ; lu aussi par `folds.ts`. */
export function headingOf(block: BlockLike): { level: 1 | 2 | 3 | 4 | 5; text: string } | null {
  if (block.type !== "heading") return null
  const valid = validated(block)
  return valid?.type === "heading" ? { level: valid.data.level, text: valid.text } : null
}

/** Fin (exclue) de la section ouverte par le titre d'indice `start` : le prochain titre de niveau ≤ ; lue aussi par `folds.ts`. */
export function sectionEnd(levels: readonly (number | null)[], start: number): number {
  const level = levels[start] ?? 0
  let end = start + 1
  while (end < levels.length) {
    const next = levels[end]
    if (next !== null && next <= level) break
    end++
  }
  return end
}

/**
 * Les sections des blocs reçus, dans l'ordre (ADR-011 § 5, E01-S06 § 3) : d'abord le début de page
 * (`heading: null`, les blocs avant le premier titre, vide quand la page commence par un titre), puis
 * une section par titre : le titre et les blocs qui le suivent jusqu'au prochain titre de niveau
 * inférieur ou égal, sous-sections comprises (une sous-section figure aussi à son propre rang).
 */
export function splitSections<B extends BlockLike>(blocks: readonly B[]): BlockSection<B>[] {
  const levels = blocks.map((block) => headingOf(block)?.level ?? null)
  const first = levels.findIndex((level) => level !== null)
  const start = first === -1 ? blocks.length : first
  const sections: BlockSection<B>[] = [{ heading: null, blocks: blocks.slice(0, start) }]
  for (let index = start; index < blocks.length; index++) {
    if (levels[index] !== null) sections.push({ heading: blocks[index], blocks: blocks.slice(index, sectionEnd(levels, index)) })
  }
  return sections
}

/** Toutes les sections dont le titre correspond à `title` (`normalizeTitle`), homonymes compris, dans l'ordre. */
export function findSections<B extends BlockLike>(blocks: readonly B[], title: string): BlockSection<B>[] {
  const wanted = normalizeTitle(title)
  return splitSections(blocks).filter(
    (section) => section.heading !== null && normalizeTitle(section.heading.text ?? "") === wanted,
  )
}

function indexOfBlock(blocks: readonly BlockLike[], blockId: string): number {
  const index = blocks.findIndex((block) => block.id === blockId)
  if (index === -1) throw new Error(`Block ${blockId} is not among the blocks given.`)
  return index
}

/** Le titre le plus proche à l'indice `index` ou avant, avec son indice ; `null` au début de page. */
function nearestHeading(blocks: readonly BlockLike[], index: number): { index: number; text: string } | null {
  for (let at = index; at >= 0; at--) {
    const heading = headingOf(blocks[at])
    if (heading) return { index: at, text: heading.text }
  }
  return null
}

/**
 * Le texte du titre de la section d'un bloc de tout type : le titre le plus proche avant lui, quel
 * que soit son niveau (un titre est dans sa propre section) ; `null` avant le premier titre. Les
 * blocs sont dans l'ordre du document ; un `blockId` absent de la liste est une erreur d'appel.
 */
export function sectionOfBlock(blocks: readonly BlockLike[], blockId: string): string | null {
  return nearestHeading(blocks, indexOfBlock(blocks, blockId))?.text ?? null
}

/** Étape d'un `call` : le dernier numéro de la liste numérotée qui le précède hors `call`, sinon `null`. */
function stepBefore(blocks: readonly BlockLike[], index: number): number | null {
  let before = index - 1
  while (before >= 0 && blocks[before].type === "call") before--
  const list = before >= 0 ? validated(blocks[before]) : null
  if (list?.type !== "list" || list.data.ordered !== true) return null
  return (list.data.start ?? 1) + list.data.items.length - 1
}

/**
 * Emplacement d'un bloc `call` (E01-S06 § 3 ; E03-S06, règle 7) : la section est le texte du titre le
 * plus proche avant lui (`null` : aucun) ; le rang, sa place parmi les blocs `call` qui suivent ce
 * titre, à partir de 1 ; l'étape, quand le bloc précédent qui n'est pas un `call` est une liste
 * numérotée, `(start ?? 1) + items.length − 1`. Réservé aux blocs `call` : un autre bloc, ou un
 * `blockId` absent de la liste, est une erreur d'appel.
 */
export function callLocation(blocks: readonly BlockLike[], blockId: string): CallLocation {
  const index = indexOfBlock(blocks, blockId)
  if (blocks[index].type !== "call") throw new Error(`Block ${blockId} is a ${blocks[index].type} block, not a call block.`)
  const heading = nearestHeading(blocks, index - 1)
  const calls = blocks.slice(heading === null ? 0 : heading.index + 1, index).filter((block) => block.type === "call")
  return { section: heading?.text ?? null, rank: calls.length + 1, step: stepBefore(blocks, index) }
}

/** « section « Étapes », call block 2 (step 3) » ; avant tout titre, « before the first heading, call block 1 ». */
export function formatCallLocation(location: CallLocation): string {
  const where = location.section === null ? "before the first heading" : `section « ${location.section} »`
  const step = location.step === null ? "" : ` (step ${location.step})`
  return `${where}, call block ${location.rank}${step}`
}

// ------------------------------------------------------------------------------ Le fichier d'une page

/**
 * Le `.md` d'une page, d'une procédure ou d'un Contexte (E10-S01, AC-a5) : « # <titre> », une ligne vide, puis le
 * rendu de ses blocs, sans références. Ici, et pas dans le service, pour que l'écran compose le même fichier
 * (consigne du pilote, décision de JB du 2026-09-29). `readPageMarkdown` en est l'inverse (AC-a6).
 */
export function pageMarkdown(title: string, blocks: readonly BlockLike[]): string {
  const body = renderBlocks(blocks)
  return body === "" ? `# ${title}\n` : `# ${title}\n\n${body}\n`
}

/** Titre et résumé d'une page (`writeNodeSchema`). */
const HEAD_MAX = NODE_HEAD_MAX

/** Caractères du premier paragraphe lus pour le résumé : assez pour en garder 200 une fois les marques retirées. */
const SUMMARY_SOURCE_MAX = 1_000

/** Les 200 premiers caractères d'un texte, par point de code, sans blancs de bord. */
function head(text: string): string {
  return trimBlanks(Array.from(text.slice(0, HEAD_MAX * 2)).slice(0, HEAD_MAX).join(""))
}

/** Un titre `#` (le titre de la page dans son fichier) : son texte, ou `null`. Lu comme `headingAt`, sans retour en arrière. */
function pageTitleOf(line: string): string | null {
  const match = /^ {0,3}#[ \t]/.exec(line)
  if (!match) return null
  const rest = line.slice(match[0].length)
  const text = trimBlanks(rest)
  return text === "" || LINE_SEPARATORS.test(rest) ? null : text
}

/** Une ligne qui ouvre un paragraphe : ni blanche, ni titre, citation, tableau, balise, liste, image ou séparateur. */
function opensParagraph(line: string): boolean {
  const text = line.trimStart()
  return text !== "" && !/^(?:#|>|\||<|!\[|[-*+][ \t]|\d{1,9}[.)][ \t]|(?:-{3,}|\*{3,}|_{3,})[ \t]*$)/.test(text)
}

/** Le texte brut d'un paragraphe : liens et images réduits à leur texte, marques et échappements retirés, sur une ligne. */
function plainText(paragraph: string): string {
  return paragraph
    .slice(0, SUMMARY_SOURCE_MAX)
    .replace(/!?\[([^\]\n]*)\]\([^)\n]*\)/g, "$1")
    .replace(/[*`~]/g, "")
    .replace(/\\(.)/g, "$1")
    .replace(/\s+/g, " ")
}

/** Les parties d'un corps : des lignes séparées par une ligne vide hors d'une clôture, qu'aucun morceau ne coupe. */
function partsOf(lines: readonly string[]): string[] {
  const parts: string[] = []
  let current: string[] = []
  let fence: Fence | null = null
  for (const line of lines) {
    if (fence) fence = closesFence(line, fence) ? null : fence
    else fence = openingFence(line, 3)
    if (fence === null && isBlankLine(line) && current.length > 0) {
      parts.push(current.join("\n"))
      current = []
    } else if (!isBlankLine(line) || current.length > 0) {
      current.push(line)
    }
  }
  if (current.length > 0) parts.push(current.join("\n"))
  return parts
}

/** Une partie plus longue qu'un morceau, coupée à ses lignes, une ligne trop longue à ses caractères. */
function splitPart(part: string, max: number): string[] {
  const pieces: string[] = []
  for (const line of part.split("\n")) {
    const points = Array.from(line)
    for (let at = 0; at < points.length || at === 0; at += max) pieces.push(points.slice(at, at + max).join(""))
  }
  return pieces
}

/** Les morceaux d'un corps (AC-a3) : `max` caractères au plus, coupés à une ligne vide hors d'une clôture. */
function chunksOf(lines: readonly string[], max: number): string[] {
  const chunks: string[] = []
  let current = ""
  for (const part of partsOf(lines).flatMap((one) => (chars(one) > max ? splitPart(one, max) : [one]))) {
    const joined = current === "" ? part : `${current}\n\n${part}`
    if (chars(joined) <= max) current = joined
    else {
      chunks.push(current)
      current = part
    }
  }
  if (current !== "") chunks.push(current)
  return chunks
}

/** Un fichier `.md` lu pour devenir une page (AC-a3) : son titre, son résumé, les morceaux de son corps. */
export type MarkdownFile = { title: string; summary: string; chunks: string[] }

/**
 * Un fichier `.md` en page (AC-a3) : titre, le premier titre `#` hors d'une clôture, retiré du corps, sinon le nom
 * du fichier sans extension ; résumé, le texte brut du premier paragraphe, sinon « Importé de <nom> » ; tous deux
 * coupés à 200 caractères ; corps, des morceaux d'`OP_TEXT_MAX` caractères au plus, coupés à une ligne vide hors
 * d'une clôture. Chaque ligne est lue une fois. Un frontmatter YAML de tête (E11-S18, AC-9) n'est pas du corps : son titre
 * et son résumé passent avant ceux du texte, et un premier titre `#` qui répète le sien est retiré du corps.
 */
export function readPageMarkdown(text: string, fileName: string): MarkdownFile {
  const lines = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n")
  const front = splitFrontmatter(lines)
  const start = front?.end ?? 0
  const given = frontmatterHead(front)
  const [frontTitle, frontSummary] = [given.title, given.summary].map((value) => (value === undefined ? undefined : head(value)))
  let fence: Fence | null = null
  let titleAt = -1
  let paragraphAt = -1
  for (let at = start; at < lines.length && (titleAt === -1 || paragraphAt === -1); at++) {
    const line = lines[at]
    if (fence) {
      if (closesFence(line, fence)) fence = null
      continue
    }
    fence = openingFence(line, 3)
    if (fence) continue
    if (titleAt === -1 && pageTitleOf(line) !== null) titleAt = at
    else if (paragraphAt === -1 && opensParagraph(line)) paragraphAt = at
  }
  const heading = titleAt === -1 ? null : head(pageTitleOf(lines[titleAt]) ?? "")
  const title = frontTitle ?? heading ?? head(fileBaseName(fileName) || fileName)
  let paragraphEnd = paragraphAt
  while (paragraphAt !== -1 && paragraphEnd < lines.length && !isBlankLine(lines[paragraphEnd])) paragraphEnd++
  const summary = frontSummary ?? (paragraphAt === -1 ? "" : head(plainText(lines.slice(paragraphAt, paragraphEnd).join(" "))))
  // Le titre `#` est celui de la page quand le frontmatter n'en donne pas, ou qu'il répète le sien.
  const dropHeading = heading !== null && (frontTitle === undefined || normalizeTitle(heading) === normalizeTitle(frontTitle))
  const body = dropHeading ? [...lines.slice(start, titleAt), ...lines.slice(titleAt + 1)] : lines.slice(start)
  return { title, summary: summary || head(`Importé de ${fileName}`), chunks: chunksOf(body, OP_TEXT_MAX) }
}
