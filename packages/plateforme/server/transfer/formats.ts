// Les formats d'un transfert d'arborescence, ramenés à un seul plan d'import : le pivot JSON (fidèle : blocs, en-têtes,
// lignes et preuves), un ZIP ou un dossier (`.md` en pages, `.csv` en tableaux, la page d'un dossier dans `<dossier>.md`
// à côté de lui ou dans `<dossier>/index.md`), un `.md` seul, un CSV seul. Et l'inverse pour l'export d'une personne :
// le pivot rendu en ZIP. Fonctions pures, sans base : `import.ts` exécute le plan sous les droits de l'appelant. Sans lui,
// chaque format aurait son import, et un lien ne se recollerait pas de la même façon.
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate"
import { readPageMarkdown, renderBlocks } from "../../schemas/blocks-render"
import { detectSeparator, fileBaseName, fileExtension, parseCsv, toCsv } from "../../schemas/csv"
import { splitFrontmatter } from "../../schemas/frontmatter"
import { slugOf } from "../../schemas/nodes"
import {
  TREE_NODES_MAX,
  treePivotSchema,
  type PivotRow,
  type TreeImportFormat,
  type TreePivot,
} from "../../schemas/tree-transfer"
import type { TableHeader } from "../../schemas/tables"
import { PlatformError } from "../errors"
import { SEGMENT_MAX, UNTITLED_SEGMENT } from "../nodes/segments"

/** Un nœud à importer, son chemin relatif à la destination : `sav`, `sav/fiches/garantie`. */
export type PlanNode = {
  path: string
  kind: "page" | "procedure" | "table"
  title: string
  summary: string
  /** Le corps d'une page ou d'une procédure, en markdown, sans son titre ; vide pour une page sans contenu. */
  markdown: string
  /** Un tableau du pivot : son en-tête et ses lignes, preuves comprises. */
  table?: { header: TableHeader; rows: PivotRow[] }
  /** Un tableau d'un CSV : la ligne d'en-tête et les lignes, lues comme `table.import` les lit. */
  csv?: { headers: string[]; rows: string[][] }
}

/**
 * Le plan d'un import : ses nœuds, un parent avant ses enfants ; ses racines (le premier segment des chemins) ; et la
 * correspondance d'un lien `[[…]]` de la source vers un chemin relatif, `null` hors du périmètre.
 */
export type ImportPlan = {
  nodes: PlanNode[]
  roots: string[]
  relink: (sourcePath: string) => string | null
  /** Ce que la lecture a laissé, dit au rapport. */
  notes: string[]
}

/** Octets au plus des `.md` et `.csv` d'un ZIP une fois décompressés. */
const TREE_UNZIPPED_BYTES_MAX = 100 * 1024 * 1024

const EXTENSIONS: Record<string, Exclude<TreeImportFormat, "auto">> = { json: "json", zip: "zip", md: "md", markdown: "md", csv: "csv" }

/** Le format d'une source : demandé, sinon son type servi, son extension, puis ses premiers octets (`PK` d'un ZIP, `{` d'un JSON). */
export function detectFormat(declared: TreeImportFormat, bytes: Uint8Array, type: string | null, name: string): Exclude<TreeImportFormat, "auto"> {
  if (declared !== "auto") return declared
  const mime = (type ?? "").split(";")[0].trim().toLowerCase()
  if (mime === "application/zip" || mime === "application/x-zip-compressed") return "zip"
  if (mime === "application/json") return "json"
  if (mime === "text/csv") return "csv"
  if (mime === "text/markdown") return "md"
  const byName = EXTENSIONS[fileExtension(name)]
  if (byName) return byName
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return "zip"
  const start = strFromU8(bytes.subarray(0, 64)).replace(/^﻿/, "").trimStart()
  if (start.startsWith("{")) return "json"
  throw new PlatformError("invalid_arguments", "The format of the source cannot be told from its address nor its content: pass format (json, zip, md or csv).")
}

/** Un segment de chemin tiré d'un nom de fichier ou de dossier : `Fiches SAV` → `fiches_sav`. */
function segment(name: string): string {
  return slugOf(name, SEGMENT_MAX) || UNTITLED_SEGMENT
}

/** Le texte UTF-8 d'un fichier, BOM retiré. */
function text(bytes: Uint8Array): string {
  return strFromU8(bytes).replace(/^﻿/, "")
}

/** Une page tirée d'un `.md` : titre et résumé du fichier (frontmatter, premier titre, sinon le nom), son corps. */
function markdownNode(path: string, content: string, fileName: string): PlanNode {
  const read = readPageMarkdown(content, fileName)
  const front = splitFrontmatter(content.replace(/\r\n?/g, "\n").split("\n"))
  const kind = front?.fields.get("kind") === "procedure" ? "procedure" : "page"
  return { path, kind, title: read.title, summary: read.summary, markdown: read.chunks.join("\n\n").trim() }
}

/** Un tableau tiré d'un CSV ; un CSV illisible refuse l'import entier, nommant le fichier. */
function csvNode(path: string, content: string, fileName: string): PlanNode {
  const read = parseCsv(content, detectSeparator(content))
  if ("unclosedQuote" in read) throw new PlatformError("invalid_arguments", `${fileName}: line ${read.unclosedQuote}: a quote is never closed. Nothing was imported.`)
  const [headers = [], ...rows] = read.rows
  const title = fileBaseName(fileName).slice(0, 200) || path
  return { path, kind: "table", title, summary: `Importé de ${fileName}`.slice(0, 200), markdown: "", csv: { headers, rows } }
}

/** Un lien vers un chemin du plan (lui ou sous lui), tel qu'écrit dans un ZIP ou un `.md` : depuis la racine du ZIP, ou depuis
 * son dossier de tête (`[[fiches/garantie]]` dans `Base/` vise `base/fiches/garantie`). */
function relinkWithin(paths: ReadonlySet<string>, roots: readonly string[]): (sourcePath: string) => string | null {
  const known = (candidate: string): boolean => {
    for (let at = candidate; at !== ""; at = at.includes("/") ? at.slice(0, at.lastIndexOf("/")) : "") {
      if (paths.has(at)) return true
    }
    return false
  }
  return (sourcePath) => {
    if (known(sourcePath)) return sourcePath
    return roots.map((root) => `${root}/${sourcePath}`).find(known) ?? null
  }
}

/** Le pivot (`node.export_tree`) : validé, puis ses nœuds tels quels, leurs blocs rendus en markdown. */
function pivotPlan(bytes: Uint8Array): ImportPlan {
  let parsed: unknown
  try {
    parsed = JSON.parse(text(bytes))
  } catch {
    throw new PlatformError("invalid_arguments", "The source is not valid JSON. Pass format if it is a zip, a markdown file or a CSV.")
  }
  const checked = treePivotSchema.safeParse(parsed)
  if (!checked.success) {
    const first = checked.error.issues[0]
    throw new PlatformError("invalid_arguments", `The source is not an Oto tree (format oto-tree, version 1): ${first ? `${first.path.join(".")}: ${first.message}` : "unreadable"}.`)
  }
  const pivot = checked.data
  const nodes = pivot.nodes.map((node): PlanNode => {
    const base = { path: node.path, kind: node.kind, title: node.title, summary: node.summary }
    if (node.table) return { ...base, markdown: "", table: node.table }
    return { ...base, markdown: renderBlocks(node.blocks ?? []) }
  })
  // Un lien vers une racine exportée ou sous elle : le nom de la racine, puis le reste du chemin.
  const relink = (sourcePath: string): string | null => {
    const root = pivot.roots.find((candidate) => sourcePath === candidate.path || sourcePath.startsWith(`${candidate.path}/`))
    return root ? `${root.name}${sourcePath.slice(root.path.length)}` : null
  }
  return { nodes, roots: pivot.roots.map((root) => root.name), relink, notes: [] }
}

/** Le nom d'une entrée de ZIP, barres obliques normalisées ; `null` pour un dossier ou un fichier caché (`.git/…`, `__MACOSX/…`). */
function entryName(name: string): string | null {
  const clean = name.replace(/\\/g, "/").replace(/^\.?\//, "")
  if (clean.endsWith("/") || clean.startsWith("__MACOSX/") || clean.split("/").some((part) => part.startsWith("."))) return null
  return clean
}

const isText = (name: string) => ["md", "markdown", "csv"].includes(fileExtension(name))

/**
 * Les fichiers d'un ZIP, par chemin ; les dossiers et ce qui n'est ni `.md` ni `.csv` sont ignorés, et dits. Seuls les
 * `.md` et `.csv` sont décompressés, sous `TREE_UNZIPPED_BYTES_MAX` en tout, comptés à la taille que le ZIP déclare (le
 * tampon de chaque fichier a cette taille) : un ZIP de 25 Mo qui se décompresserait en gigaoctets ne remplit pas la mémoire.
 */
function zipEntries(bytes: Uint8Array): { files: Map<string, Uint8Array>; ignored: string[] } {
  const ignored: string[] = []
  let unzipped = 0
  const wanted = (file: { name: string; originalSize: number }): boolean => {
    const name = entryName(file.name)
    if (name === null) return false
    if (!isText(name)) {
      ignored.push(name)
      return false
    }
    unzipped += file.originalSize
    return unzipped <= TREE_UNZIPPED_BYTES_MAX
  }
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(bytes, { filter: wanted })
  } catch {
    throw new PlatformError("invalid_arguments", "The source is not a readable zip file.")
  }
  if (unzipped > TREE_UNZIPPED_BYTES_MAX) throw new PlatformError("too_large", `The .md and .csv files of the zip make more than ${TREE_UNZIPPED_BYTES_MAX / (1024 * 1024)} MB once unzipped: split it.`)
  const files = new Map<string, Uint8Array>()
  for (const [name, content] of Object.entries(entries)) {
    const clean = entryName(name)
    if (clean !== null) files.set(clean, content)
  }
  return { files, ignored }
}

/**
 * Un ZIP ou un dossier : un sous-dossier est un nœud parent, un `.md` une page, un `.csv` un tableau. La page d'un
 * dossier est `<dossier>.md` à côté de lui, sinon `<dossier>/index.md` ; les deux présents, le premier l'emporte et le
 * rapport le dit. Un dossier sans page devient une page vide titrée d'après lui.
 */
function zipPlan(bytes: Uint8Array): ImportPlan {
  const { files, ignored } = zipEntries(bytes)
  if (files.size === 0) throw new PlatformError("invalid_arguments", "The zip holds no .md nor .csv file.")
  const notes = ignored.length > 0 ? [`Ignored files, neither .md nor .csv: ${ignored.slice(0, 20).join(", ")}${ignored.length > 20 ? ` and ${ignored.length - 20} more` : ""}.`] : []
  const nodes = new Map<string, PlanNode>()
  const fromIndex = new Set<string>()
  const pathOf = (parts: readonly string[]) => parts.map(segment).join("/")
  // D'abord les fichiers ordinaires, puis les `index.md`, qui ne prennent une page que si `<dossier>.md` manque.
  const ordered = [...files.keys()].sort((a, b) => Number(/(^|\/)index\.md$/i.test(a)) - Number(/(^|\/)index\.md$/i.test(b)) || a.localeCompare(b))
  for (const name of ordered) {
    const parts = name.split("/")
    const fileName = parts[parts.length - 1]
    const isIndex = /^index\.md$/i.test(fileName) && parts.length > 1
    const path = isIndex ? pathOf(parts.slice(0, -1)) : pathOf([...parts.slice(0, -1), fileBaseName(fileName)])
    if (nodes.has(path)) {
      notes.push(isIndex ? `${name} ignored: ${parts.slice(0, -1).join("/")}.md already holds the page of that folder.` : `${name} ignored: another file gives the same path ${path}.`)
      continue
    }
    const content = text(files.get(name) ?? new Uint8Array())
    nodes.set(path, fileExtension(fileName) === "csv" ? csvNode(path, content, fileName) : markdownNode(path, content, fileName))
    if (isIndex) fromIndex.add(path)
  }
  // Un dossier sans page : une page vide titrée d'après lui, pour que ses enfants aient un parent.
  for (const path of [...nodes.keys()]) {
    const parts = path.split("/")
    for (let depth = 1; depth < parts.length; depth++) {
      const parent = parts.slice(0, depth).join("/")
      if (nodes.has(parent)) continue
      const folder = [...files.keys()].map((name) => name.split("/")).find((names) => names.length > depth && pathOf(names.slice(0, depth)) === parent)
      const title = (folder ? folder[depth - 1] : parts[depth - 1]).slice(0, 200)
      nodes.set(parent, { path: parent, kind: "page", title, summary: `Le dossier ${title}.`.slice(0, 200), markdown: "" })
    }
  }
  const sorted = [...nodes.values()].sort((a, b) => a.path.split("/").length - b.path.split("/").length || a.path.localeCompare(b.path))
  if (sorted.length > TREE_NODES_MAX) throw new PlatformError("too_large", `The zip gives more than ${TREE_NODES_MAX} nodes: split it.`)
  if (fromIndex.size > 0 && notes.length === 0) notes.push(`${fromIndex.size} folder page(s) read from index.md.`)
  const paths = new Set(sorted.map((node) => node.path))
  const roots = [...new Set(sorted.map((node) => node.path.split("/")[0]))]
  return { nodes: sorted, roots, relink: relinkWithin(paths, roots), notes }
}

/** Le plan d'une source déjà téléchargée, selon son format ; `name` : le nom de fichier de son adresse. */
export function importPlan(format: Exclude<TreeImportFormat, "auto">, bytes: Uint8Array, name: string): ImportPlan {
  if (format === "json") return pivotPlan(bytes)
  if (format === "zip") return zipPlan(bytes)
  const fileName = name || (format === "csv" ? "import.csv" : "import.md")
  const path = segment(fileBaseName(fileName))
  const node = format === "csv" ? csvNode(path, text(bytes), fileName) : markdownNode(path, text(bytes), fileName)
  return { nodes: [node], roots: [path], relink: relinkWithin(new Set([path]), [path]), notes: [] }
}

// ------------------------------------------------------------------------------------- Export ZIP

/** Le frontmatter d'une page exportée : titre, résumé, et son genre quand c'est une procédure ; relu par `readPageMarkdown`. */
function frontmatter(node: { title: string; summary: string; kind: string }): string {
  // Le lecteur de frontmatter prend ce qu'entourent les guillemets, sans échappement : celui que la valeur ne porte pas.
  const quote = (value: string) => (value.includes('"') ? (value.includes("'") ? value.replace(/["']/g, "") : `'${value}'`) : `"${value}"`)
  return ["---", `title: ${quote(node.title)}`, `summary: ${quote(node.summary)}`, ...(node.kind === "procedure" ? ["kind: procedure"] : []), "---", ""].join("\n")
}

/**
 * Le pivot rendu pour une personne : un `.md` par page ou procédure (frontmatter, puis le corps), un `.csv` par tableau ;
 * la page d'un dossier est `<dossier>.md` à côté de `<dossier>/`. Les liens restent ceux de la source : un import de ce
 * ZIP les recolle quand ils visent un fichier du ZIP.
 */
export function pivotZip(pivot: TreePivot): Uint8Array {
  const entries: Record<string, Uint8Array> = {}
  for (const node of pivot.nodes) {
    if (node.table) {
      const rows = node.table.rows.map((row) => new Map(Object.entries(row.set)))
      entries[`${node.path}.csv`] = strToU8(toCsv(node.table.header.columns, rows, "fr"))
      continue
    }
    entries[`${node.path}.md`] = strToU8(`${frontmatter(node)}\n${renderBlocks(node.blocks ?? [])}\n`)
  }
  return zipSync(entries, { level: 6 })
}
