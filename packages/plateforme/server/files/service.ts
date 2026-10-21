// Le service des fichiers joints (E10-S02 lot a, ADR-016 § 3 à § 5) : la demande d'envoi, la confirmation, la
// lecture par redirection, sa disponibilité, les octets et le texte d'un fichier, la purge des envois abandonnés et la copie des
// objets d'une page dupliquée (lot e), l'envoi par le serveur d'un fichier déposé par lien (lot f) ; le quota et la ligne
// `pending` sont dans `rows.ts`. Chaque refus est décidé ici, avant la requête qu'il garde (`security-patterns.md § Droits
// dans le service`) : l'écriture sur le nœud pour envoyer et confirmer, la lecture pour lire ; la RLS n'isole que
// l'organisation, et cache un fichier en transit à tout autre que son auteur (`transit.ts`). Les octets ne passent
// jamais par le paquet pour l'écran : le navigateur envoie au bucket par l'URL présignée, et lit par la
// redirection. Sans lui, aucun fichier ne se dépose ni ne se lit.
import {
  FILE_MAX_BYTES,
  FILE_TYPES,
  fileExtension,
  fileIdSchema,
  fileReadQuerySchema,
  fileRequestSchema,
  fileTypeOf,
  IMAGE_TYPES,
  TEXT_FILE_MAX_BYTES,
  TEXT_TYPES,
  type FileAvailability,
  type FileReady,
  type FileStorageState,
  type FileType,
  type FileUpload,
} from "../../schemas"
import { ACCESS_LEVELS, nodeLevel, requireNodeLevel } from "../access"
import { readBounded } from "../bounded-read"
import type { PlatformDb } from "../db"
import { boundedList, inTransaction, invalidInput, PlatformError } from "../errors"
import type { Identity } from "../identity"
import type { Mutation } from "../members"
import { findNode, unknownNode } from "../nodes/lookup"
import { ownerOf, teamOf } from "../nodes/view"
import { hostExtensions, hostFileType } from "./readers/registry"
import { decodeUtf8, NOT_UTF8 } from "./readers/text"
import { insertPending, markReady, readyFiles } from "./rows"
import { fileStore, objectKey, storageNotEnabled, type FileStore, type ObjectResponse } from "./store"

/** Délai de la lecture d'un fichier texte par le serveur (AC-a8). */
const TEXT_READ_TIMEOUT_MS = 10_000

const MB = 1_048_576

/** Les fichiers texte, dits dans un refus : « html, md, txt, csv ». */
const TEXT_LIST = TEXT_TYPES.join(", ")

/** Les images servies `inline` : les matricielles ; un `svg` se télécharge à la navigation (ADR-016 § 5). */
const INLINE_IMAGES: readonly FileType[] = IMAGE_TYPES.filter((type) => type !== "svg")

/** Un fichier lu : sa ligne `ready` et le chemin de son nœud. */
export type FileRow = { id: string; node_id: string; name: string; mime: string; size: number; path: string }

/** La même réponse pour un fichier inconnu, `pending`, d'une autre organisation ou d'un nœud illisible (AC-a5). */
export function unknownFile(): PlatformError {
  return new PlatformError("not_found", "Unknown file.")
}

/** Un identifiant bien formé, sinon la réponse d'un fichier inconnu. */
function fileIdOf(input: unknown): string {
  const parsed = fileIdSchema.safeParse(input)
  if (!parsed.success) throw unknownFile()
  return parsed.data
}

/** La panne d'une opération sur le bucket : son détail au log serveur, jamais l'adresse signée. */
export async function onStorage<T>(operation: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    console.error(`[platform] files: storage ${operation} failed`, error instanceof Error ? error.message : error)
    throw new PlatformError("internal", "File storage unreachable. Retry later.")
  }
}

/** Le stockage configuré, sinon `not_enabled` (AC-a1). */
export function requireStore(): FileStore {
  const store = fileStore()
  if (!store) throw storageNotEnabled()
  return store
}

/** `12.5 MB` : une taille dite dans un refus. */
function megabytes(bytes: number): string {
  return `${Math.round((bytes / MB) * 10) / 10} MB`
}

/** L'état du stockage et les types de l'hôte, pour l'écran (AC-a7, HN-E10S02-6) ; le dépôt reste jugé par `admittedType`. */
export function fileStorageState(): FileStorageState {
  return { enabled: fileStore() !== null, hostTypes: hostExtensions() }
}

/**
 * Supprime les objets de fichiers déjà retirés de la base, après le commit (AC-a6, ADR-016 § 6). Un objet
 * déjà absent n'est pas une erreur ; un échec du bucket, ou un stockage retiré depuis, laisse l'objet orphelin,
 * nommé au log serveur, sans faire échouer la requête.
 */
export async function removeObjects(orgId: string, fileIds: readonly string[]): Promise<void> {
  if (fileIds.length === 0) return
  const store = fileStore()
  await Promise.all(
    fileIds.map(async (id) => {
      const key = objectKey(orgId, id)
      try {
        if (!store) throw new Error("storage not configured")
        await store.remove(key)
      } catch {
        console.error(`[platform] files: orphan ${key}`)
      }
    }),
  )
}

/**
 * Purge les envois abandonnés de l'organisation (AC-a6) : les lignes `pending` de plus d'une heure, puis leurs
 * objets après le commit. Une rétention de l'organisation, pas un geste de la personne : la base la fait
 * (`purge_pending_files`, `security definer`, délai fixé en base, membre de l'organisation), sur toute page, lue ou non
 * par l'appelant, plus ses propres envois en transit, et ne rend que les identifiants, comme la purge de la corbeille.
 */
export async function purgePendingFiles(db: PlatformDb, identity: Identity): Promise<void> {
  const purged = await inTransaction(db, "files: purge", (sql) => sql<{ id: string }[]>`
    select id from platform.purge_pending_files(${identity.org.id}) as id`)
  await removeObjects(identity.org.id, purged.map((row) => row.id))
}

/** Copies d'objets lancées ensemble au plus : une page qui cite des centaines de fichiers n'ouvre pas autant de requêtes. */
const COPIES_AT_ONCE = 8

/**
 * Les objets des fichiers copiés par la duplication d'une page (AC-e3, ADR-016 § 6), après son commit : chaque paire
 * (ancien, nouveau) copiée côté bucket (`copy`), par lots de `COPIES_AT_ONCE`, puis les lignes copiées passées à `ready`,
 * en une écriture sous le rôle du serveur (`readyFiles`). Une copie en échec, ou un stockage retiré depuis, laisse sa
 * ligne `pending`, nommée au log serveur : purgée ensuite avec les envois abandonnés (AC-a6), le bloc de la copie dit
 * « Fichier indisponible » (AC-b8).
 */
export async function copyFileObjects(db: PlatformDb, identity: Identity, pairs: readonly (readonly [string, string])[]): Promise<void> {
  if (pairs.length === 0) return
  const store = fileStore()
  const copyOne = async ([from, to]: readonly [string, string]): Promise<string | null> => {
    try {
      if (!store) throw new Error("storage not configured")
      await store.copy(objectKey(identity.org.id, from), objectKey(identity.org.id, to))
      return to
    } catch (error) {
      console.error(`[platform] files: copy left pending ${objectKey(identity.org.id, to)}`, error instanceof Error ? error.message : error)
      return null
    }
  }
  const copied: (string | null)[] = []
  for (let at = 0; at < pairs.length; at += COPIES_AT_ONCE) copied.push(...(await Promise.all(pairs.slice(at, at + COPIES_AT_ONCE).map(copyOne))))
  const ready = copied.filter((id): id is string => id !== null)
  if (ready.length === 0) return
  await readyFiles(db, identity, ready, "files: copied")
}

/** Un type admis au dépôt : son extension, et le type MIME signé à l'envoi et porté par la ligne. */
export type AdmittedType = { type: string; mime: string }

/**
 * Le type admis d'un nom, sinon `invalid_arguments` avec la liste des extensions admises (AC-a3, 3) : un type du paquet
 * (`FILE_TYPES`), ou un type qu'un lecteur de l'hôte ouvre (`registerReaders`, `lecture-des-fichiers.md` § Types de
 * l'hôte). Relu par `upload.link` (lot f, AC-f1, AC-f7), qui fixe le type d'un fichier déposé par l'extension de `name`,
 * jamais par le corps, et par le fichier en transit.
 */
export function admittedType(name: string): AdmittedType {
  const type = fileTypeOf(name)
  if (type) return { type, mime: FILE_TYPES[type] }
  const host = hostFileType(fileExtension(name))
  if (host) return { type: host.extension, mime: host.mime }
  // Les types du paquet, une liste fixe, tous nommés ; ceux de l'hôte, bornés comme toute liste qu'il allonge.
  const admitted = [...Object.keys(FILE_TYPES), ...(hostExtensions().length > 0 ? [boundedList(hostExtensions())] : [])]
  throw new PlatformError("invalid_arguments", `${name}: this type of file is not admitted. Admitted extensions: ${admitted.join(", ")}.`)
}

/**
 * La taille : de 1 octet à 50 Mo, 4 Mo pour un fichier texte joint, sinon `too_large` (AC-a3, 4) ; relue par le dépôt par
 * lien (AC-f7). Un fichier en transit (`type` nul) passe 50 Mo quel que soit son type : un gros export CSV y passe.
 */
export function checkSize(name: string, type: string | null, size: number): void {
  const limit = type !== null && (TEXT_TYPES as readonly string[]).includes(type) ? TEXT_FILE_MAX_BYTES : FILE_MAX_BYTES
  if (size < 1) throw new PlatformError("too_large", `${name} is empty: a file holds 1 byte at least.`)
  if (size <= limit) return
  const rule = type === null ? `a file in transit holds ${megabytes(FILE_MAX_BYTES)} at most` : `a file holds ${megabytes(FILE_MAX_BYTES)} at most, a text file (${TEXT_LIST}) ${megabytes(TEXT_FILE_MAX_BYTES)}`
  throw new PlatformError("too_large", `${name} is ${megabytes(size)}: ${rule}.`)
}

/**
 * La demande d'envoi (AC-a3) : purge d'abord les envois abandonnés de l'organisation, puis refuse au premier
 * échec, dans cet ordre, le stockage absent, l'écriture sur le nœud, le type, la taille et le quota. Le quota se
 * lit et la ligne `pending` s'insère sous le verrou de l'organisation, dans une transaction : deux demandes
 * simultanées ne le dépassent pas. Rend la ligne et l'URL présignée d'envoi (5 minutes, taille et type signés),
 * au type que fixe l'extension du nom.
 */
export async function requestFileUpload(db: PlatformDb, identity: Identity, input: unknown): Promise<Mutation<FileUpload>> {
  const parsed = fileRequestSchema.safeParse(input)
  if (!parsed.success) throw invalidInput(parsed.error)
  const request = parsed.data
  await purgePendingFiles(db, identity)
  const store = requireStore()
  const found = await findNode(db, identity, request.node)
  if (!found) throw unknownNode(request.node, identity.org.prefix)
  const { node } = found
  if (found.level < ACCESS_LEVELS.write) await requireNodeLevel(db, identity, { id: node.id, path: node.path }, "write")
  const { type, mime } = admittedType(request.name)
  checkSize(request.name, type, request.size)
  const { id } = await insertPending(db, identity, { nodeId: node.id, name: request.name, mime, size: request.size })
  const upload = await onStorage("upload url", () => store.uploadUrl(objectKey(identity.org.id, id), { size: request.size, mime }))
  return { data: { id, upload }, target: node.path, teamId: teamOf(await ownerOf(db, node.id)) }
}

/** Le délai d'un envoi par le serveur au stockage (dépôt par lien, 1 Mo au plus). */
const STORE_TIMEOUT_MS = 20_000

/** Ce qui a manqué à un envoi par le serveur, dit tel quel (HN-E10S02-116) : « unreachable » seulement sans réponse. */
const NOT_REACHED = "the file storage could not be reached"

/**
 * L'objet envoyé par le serveur puis relu (`HEAD`) : `null` s'il est gardé à sa taille, sinon ce qui a manqué. Une panne
 * sans réponse du stockage (signature, réseau, délai) lève, et son appelant la dit `NOT_REACHED`.
 */
async function sendObject(store: FileStore, key: string, object: { bytes: Uint8Array; mime: string }): Promise<string | null> {
  const size = object.bytes.byteLength
  const upload = await store.uploadUrl(key, { size, mime: object.mime })
  const answer = await fetch(upload.url, { method: "PUT", headers: upload.headers, body: new Blob([object.bytes]), signal: AbortSignal.timeout(STORE_TIMEOUT_MS), redirect: "error" })
  await answer.body?.cancel()
  if (!answer.ok) return `the file storage refused it (HTTP ${answer.status})`
  const head = await store.head(key)
  // La taille seule, comme la confirmation (`completeFileUpload`) : le type relu n'est pas celui envoyé partout.
  if (!head) return "the file storage did not keep it"
  if (head.size === null) return "the file storage gave no size"
  return head.size === size ? null : `the file storage kept ${head.size} bytes instead of ${size}`
}

/**
 * Un fichier envoyé par le serveur (dépôt par lien, AC-f8 ; ADR-018 § 4), dans un nœud dont l'appelant a déjà relu
 * l'écriture : la ligne `pending` sous le quota, l'objet envoyé par l'URL présignée d'envoi du port, lu (`HEAD`), puis
 * `ready`. Un échec du stockage laisse la ligne `pending`, purgée ensuite (AC-a6), nommé au log serveur, et rend
 * `conflict` qui dit ce qui a manqué (« … could not be stored: <cause>. Nothing was attached. »), sans consigne : son
 * appelant la pose. Sans lui, un fichier déposé par lien n'arriverait pas au stockage d'ADR-016.
 */
export async function storeFile(db: PlatformDb, identity: Identity, file: { nodeId: string; name: string; bytes: Uint8Array }): Promise<FileReady> {
  const store = requireStore()
  const size = file.bytes.byteLength
  const { type, mime } = admittedType(file.name)
  checkSize(file.name, type, size)
  const { id } = await insertPending(db, identity, { nodeId: file.nodeId, name: file.name, mime, size })
  const key = objectKey(identity.org.id, id)
  const failure = await sendObject(store, key, { bytes: file.bytes, mime }).catch((error: unknown) => {
    console.error(`[platform] files: upload left pending ${key}`, error instanceof Error ? error.message : error)
    return NOT_REACHED
  })
  if (failure !== null) {
    if (failure !== NOT_REACHED) console.error(`[platform] files: upload left pending ${key}: ${failure}`)
    throw new PlatformError("conflict", `${file.name} could not be stored: ${failure}. Nothing was attached.`)
  }
  await markReady(db, identity, { id, name: file.name }, { label: "files: stored", advice: "nothing was attached" })
  return { id, name: file.name, size, mime }
}

/** La ligne `pending` de l'appelant, avec le chemin de son nœud ; `null` sinon (inconnue, déjà `ready`, d'une autre personne). */
async function pendingFile(db: PlatformDb, identity: Identity, id: string): Promise<FileRow | null> {
  const [row] = await inTransaction(db, "files: pending", (sql) => sql<FileRow[]>`
    select f.id, f.node_id, f.name, f.mime, f.size::int as size, n.path
      from platform.files f join platform.nodes n on n.id = f.node_id
     where f.org_id = ${identity.org.id} and f.id = ${id} and f.status = 'pending' and f.created_by = ${identity.user.id}`)
  return row ?? null
}

/**
 * La confirmation d'un envoi (AC-a4) : la ligne `pending` de l'appelant, l'écriture sur son nœud, l'objet confirmé
 * (`confirmObject`). Ligne inconnue, déjà `ready` ou d'une autre personne : `not_found`.
 */
export async function completeFileUpload(db: PlatformDb, identity: Identity, fileId: unknown): Promise<Mutation<FileReady>> {
  const id = fileIdOf(fileId)
  const store = requireStore()
  const file = await pendingFile(db, identity, id)
  if (!file) throw unknownFile()
  await requireNodeLevel(db, identity, { id: file.node_id, path: file.path }, "write")
  await confirmObject(db, identity, store, file)
  const data: FileReady = { id: file.id, name: file.name, size: file.size, mime: file.mime }
  return { data, target: file.path, teamId: teamOf(await ownerOf(db, file.node_id)) }
}

/**
 * L'objet d'une ligne `pending` dont l'appelant a déjà décidé le droit, lu (`HEAD`) : taille égale à celle de la ligne,
 * `ready`. Objet absent : `conflict`. Taille différente : journalisée avec les deux tailles, puis la ligne et l'objet
 * supprimés, `conflict` qui les dit. Taille non dite par le stockage : `internal`, la ligne `pending` et l'objet gardés
 * pour une nouvelle confirmation (HN-E10S02-124). La confirmation d'un fichier joint et celle d'un fichier en transit.
 *
 * Le type relu n'est pas comparé (ADR-016 § 4, HN-E10S02-114) : Supabase Storage relit un objet `text/html` en
 * `text/plain`, et la comparaison refusait tout fichier HTML. Il ne garde rien : l'URL d'envoi signe déjà le
 * type de l'extension, et aucune lecture ne sert le type de l'objet (`readResponse` le tire du nom, la route
 * isolée d'ADR-017 pose le sien, `objectText` lit en `application/octet-stream`).
 */
export async function confirmObject(db: PlatformDb, identity: Identity, store: FileStore, file: { id: string; name: string; size: number }): Promise<void> {
  const head = await onStorage("head", () => store.head(objectKey(identity.org.id, file.id)))
  if (!head) throw new PlatformError("conflict", `${file.name} has not been uploaded: send it to its upload address, then confirm.`)
  if (head.size === null) {
    console.error("[platform] files: size unknown", { id: file.id, announced: file.size })
    throw new PlatformError("internal", `${file.name} was uploaded, but the file storage gave no size: confirm it again later.`)
  }
  if (head.size !== file.size) {
    console.error("[platform] files: size mismatch", { id: file.id, announced: file.size, stored: head.size })
    await inTransaction(db, "files: mismatch", (sql) => sql`
      delete from platform.files where org_id = ${identity.org.id} and id = ${file.id} and status = 'pending'`)
    await removeObjects(identity.org.id, [file.id])
    throw new PlatformError("conflict", `${file.name} does not match its request: ${file.size} bytes announced, ${head.size} bytes stored. Upload it again.`)
  }
  await markReady(db, identity, file, { label: "files: complete", advice: "upload it again" })
}

/**
 * Un fichier `ready` de l'organisation dont l'appelant lit le nœud ; sinon la même réponse `not_found`, pour
 * un fichier inconnu, `pending`, d'une autre organisation, ou d'un nœud illisible ou à la corbeille (AC-a5).
 */
export async function readableFile(db: PlatformDb, identity: Identity, fileId: unknown): Promise<FileRow> {
  const id = fileIdOf(fileId)
  const [file] = await inTransaction(db, "files: read", (sql) => sql<FileRow[]>`
    select f.id, f.node_id, f.name, f.mime, f.size::int as size, n.path
      from platform.files f join platform.nodes n on n.id = f.node_id
     where f.org_id = ${identity.org.id} and f.id = ${id} and f.status = 'ready'`)
  if (!file || (await nodeLevel(db, identity, file.node_id)) < ACCESS_LEVELS.read) throw unknownFile()
  return file
}

/** Un fichier lisible joint à `node` (AC-d2) ; sinon « Unknown file <id> in <chemin> », la même phrase pour tout refus. */
export async function attachedFile(db: PlatformDb, identity: Identity, fileId: unknown, node: { id: string; path: string }): Promise<FileRow> {
  const unknown = () => new PlatformError("not_found", `Unknown file ${String(fileId)} in ${node.path}: read the page to get its file links.`)
  const file = await readableFile(db, identity, fileId).catch((error: unknown) => {
    throw error instanceof PlatformError && error.code === "not_found" ? unknown() : error
  })
  if (file.node_id !== node.id) throw unknown()
  return file
}

/** Le nom dans `filename*` (RFC 5987) : encodé en UTF-8, `'`, `(`, `)` et `*` compris. */
function encodedFileName(name: string): string {
  return encodeURIComponent(name).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
}

/**
 * Le type et la disposition fixés dans l'URL de lecture (AC-a5, ADR-016 § 5), jamais lus de l'objet ni de la ligne :
 * le type de l'extension du nom (`FILE_TYPES`, ou celui qu'un lecteur de l'hôte déclare), `application/octet-stream`
 * pour un nom sans type admis. `inline` pour une image matricielle ; sur `inline` (« Voir »), `inline` pour un PDF, un
 * `txt` ou un `csv` (en texte) ; `attachment` pour tout le reste, `html`, `md`, `svg` et tout type d'hôte compris.
 */
export function readResponse(file: { name: string }, inline: boolean): ObjectResponse {
  const type = fileTypeOf(file.name)
  const contentType = type ? FILE_TYPES[type] : (hostFileType(fileExtension(file.name))?.mime ?? "application/octet-stream")
  if (type && INLINE_IMAGES.includes(type)) return { contentType, disposition: "inline" }
  if (inline && type === "pdf") return { contentType, disposition: "inline" }
  if (inline && (type === "txt" || type === "csv")) return { contentType: "text/plain; charset=utf-8", disposition: "inline" }
  return { contentType, disposition: `attachment; filename*=UTF-8''${encodedFileName(file.name)}` }
}

/** La lecture d'un fichier (AC-a5) : l'URL présignée de 60 s où la route redirige. */
export async function fileReadUrl(db: PlatformDb, identity: Identity, fileId: unknown, query: Record<string, string>): Promise<string> {
  const parsed = fileReadQuerySchema.safeParse(query)
  if (!parsed.success) throw invalidInput(parsed.error)
  const store = requireStore()
  const file = await readableFile(db, identity, fileId)
  return onStorage("read url", () => store.readUrl(objectKey(identity.org.id, file.id), readResponse(file, parsed.data.disposition === "inline")))
}

/**
 * La disponibilité d'un fichier (AC-b8, HN-E10S02-43) : la même ligne `ready` sous le droit de lecture du nœud que la
 * lecture, et la même réponse `not_found` pour ce qui n'est pas lisible ; puis l'objet lu par `HEAD`. Aucun octet ne
 * sort du bucket, aucune redirection : la carte d'un fichier lit la réponse sans suivre le stockage.
 */
export async function fileAvailability(db: PlatformDb, identity: Identity, fileId: unknown): Promise<FileAvailability> {
  const store = requireStore()
  const file = await readableFile(db, identity, fileId)
  const head = await onStorage("head", () => store.head(objectKey(identity.org.id, file.id)))
  return { available: head !== null }
}

/**
 * Les octets d'une URL de lecture : 10 s au plus (ou jusqu'à `signal`, l'échéance d'une lecture), coupés au-delà de `max`,
 * 4 Mo à défaut (`too_large`) ; objet absent : `not_found`.
 */
export async function boundedBytes(url: string, name: string, max: number = TEXT_FILE_MAX_BYTES, signal: AbortSignal = AbortSignal.timeout(TEXT_READ_TIMEOUT_MS)): Promise<Uint8Array> {
  const answer = await onStorage("read", () => fetch(url, { signal, redirect: "error" }))
  // Un objet absent : 404, ou 403 quand les clés ne listent pas le bucket.
  if (answer.status === 404 || answer.status === 403) throw unknownFile()
  if (!answer.ok || !answer.body) {
    console.error("[platform] files: storage read answered", answer.status)
    throw new PlatformError("internal", "File storage unreachable. Retry later.")
  }
  const body = answer.body
  const bytes = await onStorage("read", () => readBounded(body, max, () => null))
  if (!bytes) throw new PlatformError("too_large", `${name} is over ${megabytes(max)}${max === TEXT_FILE_MAX_BYTES ? ": download it instead" : ""}.`)
  return bytes
}

/**
 * Les octets de l'objet d'un fichier, lus par le serveur sur une URL présignée (aucune opération de plus au port), pour
 * une lecture déjà décidée : `max` octets au plus (`too_large` au-delà), jusqu'à `signal` (10 s à défaut). Un objet
 * absent : `not_found`.
 */
export async function objectBytes(store: FileStore, orgId: string, file: { id: string; name: string }, bounds: { max?: number; signal?: AbortSignal } = {}): Promise<Uint8Array> {
  const url = await onStorage("read url", () => store.readUrl(objectKey(orgId, file.id), { contentType: "application/octet-stream", disposition: "attachment" }))
  return boundedBytes(url, file.name, bounds.max, bounds.signal)
}

/**
 * Le texte de l'objet d'un fichier (`objectBytes`), en UTF-8 strict, BOM retiré, pour une lecture déjà décidée (un
 * lecteur du nœud, AC-a8 ; un lien public, AC-c5). Un octet invalide : `invalid_arguments`, raison `not_utf8`, que la
 * visionneuse dit (AC-c2) ; un objet absent : `not_found` ; au-delà de 4 Mo lus : `too_large`.
 */
export async function objectText(store: FileStore, orgId: string, file: { id: string; name: string }): Promise<string> {
  const text = decodeUtf8(await objectBytes(store, orgId, file))
  if (text === null) throw new PlatformError("invalid_arguments", NOT_UTF8, { reason: "not_utf8" })
  return text
}
