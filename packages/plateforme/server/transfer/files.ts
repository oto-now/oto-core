// Les fichiers joints d'une arborescence transférée, et la purge des exports expirés. À l'export : les fichiers `ready`
// que citent les blocs des pages exportées, chacun relisible à une URL signée aussi longue que celle de l'export ; un
// fichier absent laisse sa mention. À l'import : chaque fichier relu à son URL, joint à la page d'arrivée, et le lien du
// bloc qui le cite pointé vers lui. Sans lui, une base copiée perdrait ses pièces jointes, et chaque export resterait
// dans le bucket.
import { randomUUID } from "node:crypto"
import { FILE_MAX_BYTES, FILES_ROUTE } from "../../schemas/files"
import { TREE_EXPORT_URL_SECONDS, TREE_FILES_MAX, type PivotBlock, type PivotFile, type PivotNode } from "../../schemas/tree-transfer"
import type { PlatformDb } from "../db"
import { inTransaction, PlatformError } from "../errors"
import { storeFile } from "../files/service"
import { objectKey, type FileStore } from "../files/store"
import type { Identity } from "../identity"
import { fetchSource, type Resolve, type SourceGet } from "../uploads-fetch"

/** Les dépendances du téléchargement, que les tests remplacent (aucun réseau). */
export type TreeFetchDeps = { resolve?: Resolve; get?: SourceGet }

let fetchDeps: TreeFetchDeps = {}

/** Pour les tests : la résolution et la requête des téléchargements de l'import (source et fichiers joints). */
export function setTreeFetchDeps(deps: TreeFetchDeps): void {
  fetchDeps = deps
}

export function treeFetchDeps(): TreeFetchDeps {
  return fetchDeps
}

/** Le fichier joint qu'un bloc cite : un bloc `file`, ou une image jointe (sans `src`) ; `null` sinon. */
export function attachedFileId(block: { type: string; data: Record<string, unknown> }): string | null {
  const id = block.data.file_id
  if (typeof id !== "string") return null
  return block.type === "file" || (block.type === "image" && block.data.src === undefined) ? id : null
}

/** Le nom qu'un bloc donne à son fichier : celui du bloc `file`, le texte alternatif d'une image. */
export function attachedName(block: { data: Record<string, unknown> }): string {
  if (typeof block.data.name === "string") return block.data.name
  return typeof block.data.alt === "string" && block.data.alt !== "" ? block.data.alt : "file"
}

/** La mention d'un fichier joint qui ne voyage pas, à la place de son bloc. */
export function fileNote(name: string): PivotBlock {
  return { type: "paragraph", text: `(Fichier joint non transféré : ${name})`, data: {}, key: null }
}

type FileRow = { id: string; node_id: string; name: string; size: number }

/**
 * Les fichiers des pages exportées : ceux que leurs blocs citent, `ready` et joints à la page qui les cite (un bloc ne
 * fait pas voyager le fichier d'une autre page), chacun à une URL signée. Un bloc dont le fichier manque devient sa
 * mention, et `missing` le dit. `nodeIds` : l'identifiant de chaque nœud du pivot, par chemin relatif.
 */
export async function exportedFiles(
  context: { db: PlatformDb; identity: Identity; store: FileStore },
  nodes: PivotNode[],
  nodeIds: ReadonlyMap<string, string>,
  missing: (node: PivotNode, name: string) => void,
): Promise<PivotFile[]> {
  const ids = [...new Set(nodes.flatMap((node) => (node.blocks ?? []).map(attachedFileId).filter((id): id is string => id !== null)))]
  if (ids.length > TREE_FILES_MAX) throw new PlatformError("too_large", `This export cites more than ${TREE_FILES_MAX} attached files: export the folders one by one.`)
  const rows = ids.length === 0 ? [] : await inTransaction(context.db, "export: files", (sql) => sql<FileRow[]>`
    select id, node_id, name, size::int as size from platform.files
     where org_id = ${context.identity.org.id} and status = 'ready' and id in ${sql(ids)}`)
  const byId = new Map(rows.map((row) => [row.id, row]))
  const carried = new Map<string, FileRow>()
  for (const node of nodes) {
    node.blocks = node.blocks?.map((block) => {
      const id = attachedFileId(block)
      if (id === null) return block
      const row = byId.get(id)
      if (row && row.node_id === nodeIds.get(node.path)) {
        carried.set(id, row)
        return block
      }
      missing(node, attachedName(block))
      return fileNote(attachedName(block))
    })
  }
  const response = { contentType: "application/octet-stream", disposition: "attachment", seconds: TREE_EXPORT_URL_SECONDS }
  return Promise.all(
    [...carried.values()].map(async (row) => ({ id: row.id, name: row.name, size: row.size, url: await context.store.readUrl(objectKey(context.identity.org.id, row.id), response) })),
  )
}

/** Le message d'une panne, pour le rapport. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Les fichiers d'une page importée : chacun relu à son URL (gardes de `fetchSource`, 50 Mo), joint à la page d'arrivée
 * par `storeFile` (droits, type, taille, quota), puis son lien dans le markdown pointé vers la copie. Un fichier qui
 * n'arrive pas laisse sa mention à la place de sa ligne, et se rend dans `failed`.
 */
export async function carryFiles(
  context: { db: PlatformDb; identity: Identity },
  nodeId: string,
  markdown: string,
  files: readonly PivotFile[],
): Promise<{ markdown: string; failed: { name: string; reason: string }[] }> {
  let text = markdown
  const failed: { name: string; reason: string }[] = []
  for (const file of files) {
    const cited = `${FILES_ROUTE}/${file.id}`
    try {
      const fetched = await fetchSource(file.url, { ...fetchDeps, maxBytes: FILE_MAX_BYTES, timeoutMs: 30_000 })
      if ("failure" in fetched) throw new Error(`could not download it: ${fetched.failure}`)
      const stored = await storeFile(context.db, context.identity, { nodeId, name: file.name, bytes: fetched.bytes })
      text = text.replaceAll(cited, `${FILES_ROUTE}/${stored.id}`)
    } catch (error) {
      failed.push({ name: file.name, reason: reasonOf(error) })
      const note = fileNote(file.name).text ?? ""
      text = text.split("\n").map((line) => (line.includes(cited) ? note : line)).join("\n")
    }
  }
  return { markdown: text, failed }
}

/** La clé d'un export : son instant d'expiration en tête (secondes), que la purge relit sans autre registre. */
export function exportKey(orgId: string, format: string, now: number = Date.now()): string {
  return objectKey(orgId, `exports/${Math.ceil(now / 1000) + TREE_EXPORT_URL_SECONDS}-${randomUUID()}.${format}`)
}

/**
 * Les exports expirés de l'organisation retirés du bucket, à chaque transfert et à chaque passage de la corbeille (le
 * paquet n'a pas de tâche planifiée). Sans stockage, rien ; une panne du bucket est dite au log, jamais levée : elle
 * n'empêche pas le geste qui l'a appelée. Rend le nombre d'exports retirés.
 */
export async function purgeExpiredExports(store: FileStore | null, orgId: string, now: number = Date.now()): Promise<number> {
  if (!store) return 0
  const prefix = objectKey(orgId, "exports/")
  try {
    const expired = (await store.list(prefix)).filter((key) => {
      const expires = Number(key.slice(prefix.length).split("-")[0])
      return Number.isFinite(expires) && expires * 1000 <= now
    })
    for (const key of expired) await store.remove(key)
    return expired.length
  } catch (error) {
    console.error("[platform] node.export_tree: purge of expired exports failed", reasonOf(error))
    return 0
  }
}
