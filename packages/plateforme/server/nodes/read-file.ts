// `read {path, file}` (E10-S02, AC-d2 ; fiche D119 ; `lecture-des-fichiers.md`) : le texte d'un fichier joint au nœud de
// `path`, lu par le lecteur de son type (`files/readers/`), servi seul dans une clôture de son type, précédé de son nom et
// de sa taille, coupé par le curseur de `read` au-delà de 45 000 caractères. Au-delà de 12 000 caractères, le fichier
// vient en plan, comme une longue page : ses parties et leur taille ; `section` en sert une, `*` le tout. Le droit est
// celui de la lecture du nœud, relu par `attachedFile` (AC-a8), qui refuse avant de lire l'objet un fichier inconnu,
// `pending` ou d'un autre nœud ; un type sans lecteur est refusé avant aussi. Le téléchargement et la lecture tiennent
// sous l'échéance de 10 secondes (`startDeadline`). Le texte n'a pas de référence de bloc : `write` ne le relit jamais
// comme un bloc. Sans lui, un assistant ne lirait d'un fichier joint que son nom (ADR-009). L'hôte qui retient le
// contenu des fichiers (`registerDataPolicy`, `fileContents: "metadata"`) le fait refuser avant toute lecture. `file` seul
// (étape 2 du chantier « fichier ») désigne un fichier quel que soit son état : joint, il se lit sur son nœud ; en
// transit, à son seul auteur, avec les mêmes lecteurs, bornes et curseur, sans nœud ni équipe, son nom hors du journal.
// Fichier à part de `read.ts` (borne de 300 lignes).
import type { FileOriginView } from "../../schemas"
import { fileOrigin } from "../files/origin"
import { normalizeTitle, type ReadNodeInput } from "../../schemas"
import { fenceFor } from "../../schemas/blocks-render"
import { fileExtension } from "../../schemas/csv"
import { fileSizeText, fileTypeOf } from "../../schemas/files"
import { fileContentsFor } from "../data-policy"
import type { PlatformDb } from "../db"
import { PlatformError } from "../errors"
import { readText, startDeadline, statusError, type ReadText } from "../files/readers/document"
import { readableExtensions, readerFor } from "../files/readers/registry"
import { READER_LIMITS, type ReaderPart } from "../files/readers/types"
import { attachedFile, objectBytes, readableFile, requireStore } from "../files/service"
import type { FileStore } from "../files/store"
import { readyTransitFile } from "../files/transit"
import type { Identity } from "../identity"
import type { ToolOutput } from "../tool-output"
import { formatCount } from "./document"
import { PAGE_FULL_MAX } from "./limits"
import type { NodeRow } from "./lookup"
import { plural, quotedList } from "./op-kit"
import { callArguments, type Served } from "./read-body"
import { checkCursor, paginate, type PageSubject } from "./read-pages"
import { ownerOf, teamOf } from "./view"

/** Le mot de tête de la clôture d'un fichier texte (AC-d2) ; `text` pour un autre type. */
const FENCE_INFO: Readonly<Record<string, string>> = { html: "html", md: "markdown", csv: "csv", txt: "text", json: "json" }

/** La valeur de `section` qui sert tout le texte d'un fichier. */
const WHOLE = "*"

type Request = { input: ReadNodeInput; file: string; subject: PageSubject; prefix: string }

/** Un fichier dont la lecture est décidée : sa ligne et son origine, ce que ses données portent avant lui, l'équipe de l'appel. */
type Decided = {
  request: Request
  store: FileStore
  file: { id: string; name: string; size: number; origin: FileOriginView | null }
  data: Record<string, unknown>
  teamId: string | null
}

/** « html, md, txt and csv » : les formats lisibles, dits dans un refus. */
function said(items: readonly string[]): string {
  return items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items.at(-1)}` : items.join("")
}

/** Le refus d'un type sans lecteur, avant toute lecture de l'objet, qui dit les formats lisibles. */
function unreadable(name: string): PlatformError {
  return new PlatformError("invalid_arguments", `${name} is a ${fileTypeOf(name) ?? "binary"} file; only ${said(readableExtensions())} files are read as text.`)
}

/** La partie que nomme `section` : à l'identique, sinon sans casse ni accents si une seule s'y lit ; sinon le refus. */
function partOf(read: ReadText, section: string, name: string): ReaderPart {
  const exact = read.parts.find((part) => part.name === section)
  if (exact) return exact
  const wanted = normalizeTitle(section)
  const close = read.parts.filter((part) => normalizeTitle(part.name) === wanted)
  if (close.length === 1) return close[0]
  if (close.length > 1) {
    throw new PlatformError("invalid_arguments", `Section « ${section} » of ${name} matches several parts: ${quotedList(close.map((part) => part.name))}. Give one exactly.`)
  }
  throw new PlatformError("not_found", `Unknown section « ${section} » in ${name}. Sections: ${quotedList(read.parts.map((part) => part.name))}; or "${WHOLE}" for the whole text.`)
}

/** Le plan d'un fichier (`lecture-des-fichiers.md` § Trois paliers) : titre et résumé, une ligne par partie, puis comment en lire une. */
function planText(read: ReadText, request: Request, file: { name: string }): string {
  const shown = read.parts.slice(0, READER_LIMITS.partsShown)
  const more = read.parts.length - shown.length
  const head = read.title !== file.name ? `« ${read.title} » — ${read.summary}` : read.summary
  return [
    head,
    `outline (${formatCount(read.parts.length)} ${plural(read.parts.length, "part")}, ${formatCount(read.chars)} characters, over the ${formatCount(PAGE_FULL_MAX)}-character page limit):`,
    ...shown.map((part) => `- ${part.name} (${formatCount(part.chars)} characters)`),
    ...(more > 0 ? [`- … and ${formatCount(more)} more`] : []),
    `Read one with ${request.prefix}_read ${callArguments({ path: request.subject.path ?? undefined, file: request.input.file, section: "<name>" })}; the whole text with "section": "${WHOLE}".`,
  ]
    .filter((line) => line !== "")
    .join("\n")
}

/** Ce que sert `read {file}` : le texte entier, une partie ou le plan, et les champs qui les décrivent. */
async function servedOf(read: ReadText, request: Request, file: { name: string }): Promise<{ served: Served; label: string; fields: Record<string, unknown> }> {
  const section = request.input.section
  const info = FENCE_INFO[fileExtension(file.name)] ?? "text"
  const fenced = (text: string) => `${fenceFor(text)}${info}\n${text}\n${fenceFor(text)}`
  const cut = read.chars < read.declaredChars
  const cutLines = (last: boolean) =>
    cut && last ? [`The text is cut at ${formatCount(READER_LIMITS.textChars)} characters of ${formatCount(read.declaredChars)}: the rest is not served.`] : []
  const counts = { chars: read.chars, ...(cut ? { chars_declared: read.declaredChars } : {}) }
  if (section === undefined && read.chars > PAGE_FULL_MAX && read.parts.length > 1) {
    const outline = read.parts.slice(0, READER_LIMITS.partsShown).map((part) => ({ title: part.name, chars: part.chars }))
    return {
      served: { body: planText(read, request, file), footer: cutLines(true), blocks: [] },
      label: "",
      fields: { title: read.title, summary: read.summary, ...counts, outline, sections_total: read.parts.length },
    }
  }
  if (section === undefined || section === WHOLE) {
    const label = section === WHOLE ? ` — whole text (${formatCount(read.chars)} characters)` : ""
    return { served: { body: fenced(await read.whole()), footer: cutLines(true), blocks: [] }, label, fields: section === WHOLE ? { section, ...counts } : {} }
  }
  const part = partOf(read, section, file.name)
  const last = read.parts.at(-1)?.name === part.name
  return {
    served: { body: fenced(await read.text(part.name)), footer: cutLines(last), blocks: [] },
    label: ` — section « ${part.name} » (${formatCount(part.chars)} characters)`,
    fields: { section: part.name, chars: part.chars },
  }
}

/** `file` avec un mode de page : refusé, avec ou sans `path`. */
export function checkFileModes(input: ReadNodeInput): void {
  if (input.file !== undefined && (input.outline === true || input.since_revision !== undefined || input.draft === true)) {
    throw new PlatformError("invalid_arguments", "Give only one of outline, since_revision or file; file reads the text of a file, or one part with section, without draft.")
  }
}

/** La politique de l'hôte (`registerDataPolicy`) : refusé avant toute lecture du fichier ; `shown` : la page qui le montre. */
async function refuseWithheld(identity: Identity, shown: string | null): Promise<void> {
  if ((await fileContentsFor(identity.org)) !== "metadata") return
  throw new PlatformError(
    "forbidden",
    `The contents of files are not served to assistants at ${identity.org.name}: only their name, size and type${shown === null ? "" : `, shown in ${shown}`}. Ask the user to open the file.`,
    { reason: "file_contents_withheld" },
  )
}

/** Le texte d'un fichier dont la lecture est décidée, en une ou plusieurs parties (`paginate`). */
async function fileText({ request, store, file, data, teamId }: Decided, orgId: string): Promise<ToolOutput> {
  const found = readerFor(fileExtension(file.name))
  if (!found) throw unreadable(file.name)
  const deadline = startDeadline()
  try {
    const bytes = await objectBytes(store, orgId, file, { max: found.maxBytes, signal: deadline.signal }).catch((error: unknown) => {
      throw deadline.expired() ? statusError(file.name, { status: "timeout" }) : error
    })
    const read = await readText(found.reader, { name: file.name, bytes }, deadline)
    const { served, label, fields } = await servedOf(read, request, file)
    return paginate({
      input: request.input,
      node: request.subject,
      prefix: request.prefix,
      header: `${file.name} (${fileSizeText(file.size)})${label}`,
      served,
      data: { ...data, file: { id: file.id, name: file.name, size: file.size, type: found.extension, origin: file.origin }, ...fields },
      nextActions: [],
      teamId,
    })
  } finally {
    deadline.clear()
  }
}

/** Le texte d'un fichier joint au nœud lu (AC-d2), en une ou plusieurs parties (`paginate`). */
export async function readNodeFile(db: PlatformDb, identity: Identity, request: { input: ReadNodeInput; file: string; node: NodeRow; prefix: string }): Promise<ToolOutput> {
  const { node } = request
  await refuseWithheld(identity, node.path)
  const store = requireStore()
  const file = await attachedFile(db, identity, request.file, { id: node.id, path: node.path })
  const teamId = teamOf(await ownerOf(db, node.id))
  const origin = await fileOrigin(db, identity, file.id)
  return fileText({ request: { ...request, subject: node }, store, file: { ...file, origin }, data: { path: node.path }, teamId }, identity.org.id)
}

/**
 * Le texte d'un fichier en transit de l'appelant : son seul auteur, avant l'échéance (`readyTransitFile`), son échéance
 * dans les données ; un fichier effacé, le refus qui le date ; tout autre, un fichier inconnu.
 */
async function readTransitFile(db: PlatformDb, identity: Identity, request: Omit<Request, "subject">): Promise<ToolOutput> {
  await refuseWithheld(identity, null)
  const store = requireStore()
  const file = await readyTransitFile(db, identity, request.file).catch((error: unknown) => {
    if (!(error instanceof PlatformError) || error.code !== "not_found" || error.details !== undefined) throw error
    throw new PlatformError("not_found", `Unknown file ${request.file}: read the page that cites it to get its file links.`)
  })
  const subject = { id: file.id, path: null, title: file.name }
  checkCursor(request.input, subject)
  const origin = await fileOrigin(db, identity, file.id)
  return fileText({ request: { ...request, subject }, store, file: { ...file, origin }, data: { expires_at: new Date(file.expires_at).toISOString() }, teamId: null }, identity.org.id)
}

/**
 * `read {file}` sans `path` : un fichier désigné par son identifiant, quel que soit son état. Joint et lisible, il se lit
 * sur son nœud (`readAt`), comme avec son chemin ; sinon en transit, à son seul auteur.
 */
export async function readFileAlone(db: PlatformDb, identity: Identity, input: ReadNodeInput, readAt: (path: string) => Promise<ToolOutput>): Promise<ToolOutput> {
  if (input.file === undefined) throw new PlatformError("invalid_arguments", "Give path, or file alone to read a file by its id.")
  checkFileModes(input)
  const attached = await readableFile(db, identity, input.file).catch((error: unknown) => {
    if (error instanceof PlatformError && error.code === "not_found") return null
    throw error
  })
  if (attached) return readAt(attached.path)
  return readTransitFile(db, identity, { input, file: input.file, prefix: identity.org.prefix })
}
