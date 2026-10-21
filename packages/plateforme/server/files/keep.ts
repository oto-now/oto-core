// Garder un fichier sur une page (fichiers et stockage, § Garder un fichier en transit sur une page ; étape 3 du chantier
// « fichier », décidée par Alexis le 21/10) : `file.keep` et `POST transit-files/<id>/keep`. Une page, ce sont des
// blocs : garder, c'est insérer un bloc média à la place donnée, sous une révision, par `writeNode`. Le fichier en transit
// y est joint, son échéance levée, sans copie (`keep_transit_file`), dans la transaction de l'écriture : un refus de
// l'écriture annule le rattachement, aucun fichier n'est rangé sans bloc. Gardé de nouveau sur la même page, rien n'est
// écrit ; sur une autre, une copie sous un identifiant neuf. Sans lui, un fichier rendu par une fonction s'efface à son
// échéance, et un assistant ne peut le ranger nulle part.
import { blockRef, fileKeepSchema, fileLink, fileTypeOf, TEXT_FILE_MAX_BYTES, TEXT_TYPES, type BlockInput, type FileKeep, type WriteOpBody } from "../../schemas"
import { fileSizeText } from "../../schemas/files"
import { ACCESS_LEVELS, requireNodeLevel } from "../access"
import type { PlatformDb } from "../db"
import { inTransaction, invalidInput, isPlatformError, PlatformError } from "../errors"
import type { Identity } from "../identity"
import type { DocBlock } from "../nodes/document"
import { findNode, unknownNode, type NodeRow } from "../nodes/lookup"
import { OpProblem } from "../nodes/op-kit"
import { locate } from "../nodes/section-ops"
import { loadBlocks, loadDraft } from "../nodes/store"
import { citedFile } from "../nodes/write-files"
import type { WriteOrigin } from "../nodes/write-result"
import type { ToolOutput } from "../tool-output"
import { insertPending, markReady } from "./rows"
import { INLINE_IMAGES, onStorage, readableFile, removeObjects, requireStore } from "./service"
import { objectKey } from "./store"
import { readyTransitFile } from "./transit"

/** La porte qui garde : la provenance de l'écriture, et la route des liens rendus (`<origine>/f`). */
export type KeepOptions = { origin: WriteOrigin; route: string }

/** Ce que garder rend : le texte, les données (page, révision, fichier, bloc) et l'équipe du journal. */
export type Kept = { text: string; data: Record<string, unknown>; teamId?: string | null }

/** Le fichier gardé : sa ligne, et son échéance s'il est en transit. */
type Source = { id: string; name: string; size: number; mime: string; node_id: string | null; expires_at: string | null }

type Keeping = { node: NodeRow; args: FileKeep; source: Source; blocks: DocBlock[]; options: KeepOptions }

const BOTH = "Give section or after_block, not both: section puts the file at the end of a section, after_block right after a block."

/** La page cible : visible, écrite par l'appelant, jamais un tableau ; le geste ne crée pas de page. */
async function targetNode(db: PlatformDb, identity: Identity, path: string): Promise<NodeRow> {
  const found = await findNode(db, identity, path)
  if (!found) throw unknownNode(path, identity.org.prefix)
  const { node } = found
  if (node.kind === "table") throw new PlatformError("invalid_arguments", `${node.path} is a table: a file goes into a page, a procedure or a context page.`)
  if (found.level < ACCESS_LEVELS.write) await requireNodeLevel(db, identity, { id: node.id, path: node.path }, "write")
  return node
}

/**
 * Le fichier : en transit et à l'appelant (`readyTransitFile`, refus daté d'un fichier effacé compris), sinon joint à une
 * page qu'il lit (`readableFile`) ; pour tout autre, le refus du transit (`not_found`).
 */
async function sourceOf(db: PlatformDb, identity: Identity, fileId: string): Promise<Source> {
  try {
    return { ...(await readyTransitFile(db, identity, fileId)), node_id: null }
  } catch (error) {
    if (!isPlatformError(error) || error.code !== "not_found" || error.details?.reason === "file_erased") throw error
    const joined = await readableFile(db, identity, fileId).catch(() => {
      throw error
    })
    return { ...joined, expires_at: null }
  }
}

/** Un texte de plus de 4 Mo ne se garde pas (décidé par Alexis le 21/10) : le refus dit pourquoi, et le téléchargement. */
function refuseLargeText(source: Source, route: string): void {
  const type = fileTypeOf(source.name)
  if (!type || !TEXT_TYPES.includes(type) || source.size <= TEXT_FILE_MAX_BYTES) return
  const until = source.expires_at === null ? "" : ` before ${new Date(source.expires_at).toISOString().slice(0, 16).replace("T", " ")} UTC`
  throw new PlatformError(
    "too_large",
    `File ${source.id} is a ${type} file of ${fileSizeText(source.size)}: a text file is kept on a page up to ${fileSizeText(TEXT_FILE_MAX_BYTES)}, to be read there. Download it from ${route}/${source.id}${until}.`,
    { reason: "text_too_large" },
  )
}

/** Le bloc média : une image jointe pour une image matricielle, un bloc `file` sinon (`svg` compris). */
function mediaBlock(file: Pick<Source, "id" | "name" | "size" | "mime">): BlockInput {
  const type = fileTypeOf(file.name)
  if (type && INLINE_IMAGES.includes(type)) return { type: "image", data: { file_id: file.id } }
  return { type: "file", data: { file_id: file.id, name: file.name, size: file.size, mime: file.mime } }
}

/** L'insertion du bloc : après le bloc donné, après le dernier bloc de la section donnée, sinon après le dernier bloc. */
function insertion(keeping: Pick<Keeping, "node" | "args" | "blocks">, input: BlockInput): WriteOpBody {
  const { args, blocks } = keeping
  if (args.after_block !== undefined) return { op: "insert_after", block: args.after_block, input }
  let anchor = blocks.at(-1)
  if (args.section !== undefined) {
    try {
      const { end } = locate({ blocks: blocks.map((block, uid) => ({ ...block, uid })), path: keeping.node.path, nextUid: blocks.length }, args.section, "section")
      anchor = blocks[end - 1]
    } catch (problem) {
      throw problem instanceof OpProblem ? new PlatformError(problem.code, problem.message, problem.details) : problem
    }
  }
  return { op: "insert_after", ...(anchor?.id ? { block: blockRef({ id: anchor.id, key: anchor.key }) } : {}), input }
}

/** `writeNode`, lu à l'appel : `write` relit le registre, qui importe ce module (précédent : `uploads-write.ts`). */
async function writeBlock(db: PlatformDb, identity: Identity, keeping: Keeping, input: BlockInput): Promise<ToolOutput> {
  const { writeNode } = await import("../nodes/write")
  const { node, args } = keeping
  const body = { path: node.path, ...(args.base_revision === undefined ? {} : { base_revision: args.base_revision }), ops: [insertion(keeping, input)] }
  return writeNode(db, identity, body, keeping.options.origin)
}

/** Ce que rend un bloc écrit : le chemin, la révision, le fichier et la référence du bloc. */
function keptData(output: ToolOutput, file: Pick<Source, "id" | "name" | "size">, route: string): Record<string, unknown> {
  const data = output.data ?? {}
  const touched = Array.isArray(data.touched) ? (data.touched as { blocks?: { ref?: string }[] }[]) : []
  const block = touched[0]?.blocks?.[0]?.ref
  return { path: data.path, revision: data.revision, file: { id: file.id, name: file.name, size: file.size, url: `${route}/${file.id}` }, ...(block ? { block } : {}) }
}

/** Un fichier en transit : le rattachement et le bloc, dans une seule transaction. */
async function keepInTransit(db: PlatformDb, identity: Identity, keeping: Keeping): Promise<Kept> {
  const { source, node, options } = keeping
  refuseLargeText(source, options.route)
  const output = await inTransaction(db, "files: keep", async (sql) => {
    await sql`select platform.keep_transit_file(${source.id}, ${node.id})`
    return writeBlock(db, identity, keeping, mediaBlock(source))
  })
  const data = keptData(output, source, options.route)
  return { text: `Kept ${source.name} on ${String(data.path)}, revision ${String(data.revision)}: ${fileLink(source, options.route)}.`, data, teamId: output.teamId }
}

/** Un fichier déjà joint à cette page : rien n'est écrit s'il y est cité ; sinon (son bloc retiré), un nouveau bloc. */
async function keepAgain(db: PlatformDb, identity: Identity, keeping: Keeping): Promise<Kept> {
  const { source, node, options } = keeping
  if (keeping.blocks.some((block) => citedFile(block) === source.id)) {
    const data = { path: node.path, revision: node.revision, file: { id: source.id, name: source.name, size: source.size, url: `${options.route}/${source.id}` } }
    return { text: `${source.name} is already on ${node.path}, revision ${node.revision}: nothing was written.`, data }
  }
  const output = await writeBlock(db, identity, keeping, mediaBlock(source))
  const data = keptData(output, source, options.route)
  return { text: `Kept ${source.name} on ${String(data.path)}, revision ${String(data.revision)}: ${fileLink(source, options.route)}.`, data, teamId: output.teamId }
}

/**
 * Un fichier joint à une autre page : une copie sous un identifiant neuf, jointe à celle-ci, comme un dépôt (ligne
 * `pending` sous le quota, objet copié, `ready`), puis son bloc ; un refus de l'écriture retire la copie.
 */
async function keepCopy(db: PlatformDb, identity: Identity, keeping: Keeping): Promise<Kept> {
  const { source, node, options } = keeping
  const store = requireStore()
  const { id } = await insertPending(db, identity, { nodeId: node.id, name: source.name, mime: source.mime, size: source.size, origin: { copiedFrom: source.id } })
  await onStorage("copy", () => store.copy(objectKey(identity.org.id, source.id), objectKey(identity.org.id, id)))
  await markReady(db, identity, { id, name: source.name }, { label: "files: kept copy", advice: "nothing was written" })
  const copy = { ...source, id }
  const output = await writeBlock(db, identity, keeping, mediaBlock(copy)).catch(async (error: unknown) => {
    await inTransaction(db, "files: kept copy undone", (sql) => sql`delete from platform.files where org_id = ${identity.org.id} and id = ${id}`)
    await removeObjects(identity.org.id, [id])
    throw error
  })
  const written = keptData(output, copy, options.route)
  const text = `Copied ${source.name} to ${String(written.path)} as file ${id}, revision ${String(written.revision)}: ${fileLink(copy, options.route)}.`
  return { text, data: { ...written, copied_from: source.id }, teamId: output.teamId }
}

/**
 * Garde un fichier sur une page (`file.keep`) : la page écrite par l'appelant, le fichier en transit à lui ou joint à une
 * page qu'il lit, puis le bloc média à sa place. Le nom du fichier n'entre que dans la réponse, jamais dans un refus.
 */
export async function keepTransitFile(db: PlatformDb, identity: Identity, input: unknown, options: KeepOptions): Promise<Kept> {
  const parsed = fileKeepSchema.safeParse(input)
  if (!parsed.success) throw invalidInput(parsed.error)
  const args = parsed.data
  if (args.section !== undefined && args.after_block !== undefined) throw new PlatformError("invalid_arguments", BOTH)
  const node = await targetNode(db, identity, args.path)
  const source = await sourceOf(db, identity, args.file)
  const draft = await loadDraft(db, node.id)
  const keeping: Keeping = { node, args, source, blocks: await loadBlocks(db, node.id, draft ? "draft" : "published"), options }
  if (source.node_id === null) return keepInTransit(db, identity, keeping)
  if (source.node_id === node.id) return keepAgain(db, identity, keeping)
  return keepCopy(db, identity, keeping)
}
