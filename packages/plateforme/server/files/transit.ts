// Le fichier en transit (fichiers et stockage, § Fichier en transit ; décision d'Alexis du 19/10) : un fichier qui passe
// entre une personne et un connecteur, une ligne `files` sans nœud, avec une échéance. Il se dépose en trois temps comme
// un fichier joint (demande, envoi au bucket, confirmation), se relit par une redirection, se lit en octets par le moteur
// et s'efface à son échéance ou à sa consommation. Seule la personne qui l'a fait entrer le lit : le service le décide en
// filtrant sur elle avant toute URL, et la RLS le cache à tout autre (organisation, équipe, administrateur, équipe
// plateforme). Le moteur court sous l'identité de la personne qui appelle, donc ne lit que les siens. Il compte au quota
// de l'organisation jusqu'à son échéance (`rows.ts`). Sans lui, une pièce rendue par un connecteur ou envoyée à un
// connecteur devrait être rangée sous une page, où toute l'équipe la lirait.
import { FILE_MAX_BYTES, FILE_TYPES, fileIdSchema, transitFileRequestSchema, type TransitFile, type TransitFileUpload } from "../../schemas"
import type { PlatformDb } from "../db"
import { inTransaction, invalidInput } from "../errors"
import type { Identity } from "../identity"
import { insertPending } from "./rows"
import { admittedType, boundedBytes, checkSize, confirmObject, onStorage, readResponse, removeObjects, requireStore, unknownFile } from "./service"
import { objectKey } from "./store"

/** La vie d'un fichier en transit jamais consommé, en heures (décidé le 16/10). */
export const TRANSIT_HOURS = 1

/** Une ligne en transit de l'appelant, non échue, avec son échéance. */
type TransitRow = { id: string; name: string; mime: string; size: number; expires_at: string }

/** Un fichier en transit lu en octets par le moteur : ce qu'un envoi au tiers doit en dire, et ses octets. */
export type TransitBytes = { id: string; name: string; mime: string; size: number; bytes: Uint8Array }

/** L'identifiant d'un fichier, sinon la réponse d'un fichier inconnu. */
function transitIdOf(input: unknown): string {
  const parsed = fileIdSchema.safeParse(input)
  if (!parsed.success) throw unknownFile()
  return parsed.data
}

/**
 * La ligne en transit `id` de l'appelant, dans l'état `status`, non échue ; sinon `not_found`, la même réponse pour un
 * fichier inconnu, joint à un nœud, d'une autre personne, d'une autre organisation ou échu. Le filtre sur l'auteur est la
 * décision du service ; la RLS (`files_select_member`) la double.
 */
async function ownTransitRow(db: PlatformDb, identity: Identity, id: string, status: "pending" | "ready"): Promise<TransitRow> {
  const [row] = await inTransaction(db, "files: transit", (sql) => sql<TransitRow[]>`
    select id, name, mime, size::int as size, to_json(expires_at) #>> '{}' as expires_at from platform.files
     where org_id = ${identity.org.id} and id = ${id} and node_id is null and created_by = ${identity.user.id}
       and status = ${status} and expires_at > now()`)
  if (!row) throw unknownFile()
  return row
}

/**
 * Purge les fichiers en transit échus de l'organisation, de toute personne (`purge_transit_files`, qui ne rend que leurs
 * identifiants), puis leurs objets après le commit. Le paquet n'a pas de tâche planifiée : elle court à chaque entrée en
 * transit ; d'ici là, un fichier échu est déjà illisible et hors du quota.
 */
export async function purgeTransitFiles(db: PlatformDb, identity: Identity): Promise<void> {
  const purged = await inTransaction(db, "files: transit purge", (sql) => sql<{ id: string }[]>`
    select id from platform.purge_transit_files(${identity.org.id}) as id`)
  await removeObjects(identity.org.id, purged.map((row) => row.id))
}

/**
 * La demande d'envoi d'un fichier en transit (`POST transit-files`) : purge d'abord les échus de l'organisation, puis
 * refuse au premier échec, dans cet ordre, le stockage absent, le type (ceux d'un fichier joint), la taille (50 Mo pour
 * tout type, texte compris) et le quota ; aucun nœud, donc aucun droit de nœud. Rend la ligne `pending`, l'URL présignée
 * d'envoi (5 minutes) et l'échéance.
 */
export async function requestTransitUpload(db: PlatformDb, identity: Identity, input: unknown): Promise<TransitFileUpload> {
  const parsed = transitFileRequestSchema.safeParse(input)
  if (!parsed.success) throw invalidInput(parsed.error)
  const request = parsed.data
  await purgeTransitFiles(db, identity)
  const store = requireStore()
  const type = admittedType(request.name)
  // 50 Mo pour tout type admis, texte compris (décision du 19/10) : la borne de 4 Mo d'un texte joint ne vaut pas ici.
  checkSize(request.name, null, request.size)
  const mime = FILE_TYPES[type]
  const { id, expiresAt } = await insertPending(db, identity, { nodeId: null, transitHours: TRANSIT_HOURS, name: request.name, mime, size: request.size })
  if (expiresAt === null) throw new Error("[platform] files: a transit file was inserted without expiry")
  const upload = await onStorage("upload url", () => store.uploadUrl(objectKey(identity.org.id, id), { size: request.size, mime }))
  return { id, upload, expiresAt }
}

/**
 * La confirmation d'un fichier en transit (`POST transit-files/<id>/complete`) : la ligne `pending` de l'appelant, non
 * échue, puis l'objet confirmé comme celui d'un fichier joint (`confirmObject`).
 */
export async function completeTransitUpload(db: PlatformDb, identity: Identity, fileId: unknown): Promise<TransitFile> {
  const store = requireStore()
  const row = await ownTransitRow(db, identity, transitIdOf(fileId), "pending")
  await confirmObject(db, identity, store, row)
  return { id: row.id, name: row.name, size: row.size, mime: row.mime, expiresAt: row.expires_at }
}

/**
 * La lecture d'un fichier en transit par son auteur (`GET transit-files/<id>`) : l'URL présignée de 60 s où la route
 * redirige, au type et à la disposition de son extension, comme un fichier joint téléchargé.
 */
export async function transitReadUrl(db: PlatformDb, identity: Identity, fileId: unknown): Promise<string> {
  const store = requireStore()
  const row = await ownTransitRow(db, identity, transitIdOf(fileId), "ready")
  return onStorage("read url", () => store.readUrl(objectKey(identity.org.id, row.id), readResponse(row, false)))
}

/**
 * Les octets d'un fichier en transit, pour le moteur pendant un transfert, sous l'identité de la personne qui appelle : sa
 * ligne `ready`, non échue, puis l'objet lu par le serveur, 50 Mo au plus. Ne l'efface pas : sa consommation se décide
 * après l'envoi au tiers (`expireTransitFile`).
 */
export async function readTransitBytes(db: PlatformDb, identity: Identity, fileId: unknown): Promise<TransitBytes> {
  const store = requireStore()
  const row = await ownTransitRow(db, identity, transitIdOf(fileId), "ready")
  const url = await onStorage("read url", () => store.readUrl(objectKey(identity.org.id, row.id), { contentType: "application/octet-stream", disposition: "attachment" }))
  const bytes = await boundedBytes(url, row.name, FILE_MAX_BYTES)
  return { id: row.id, name: row.name, mime: row.mime, size: row.size, bytes }
}

/**
 * Efface un fichier en transit de l'appelant avant son échéance (sa consommation) : la ligne, quel que soit son état,
 * puis l'objet après le commit. Un fichier inconnu, d'un autre ou déjà effacé : `not_found`.
 */
export async function expireTransitFile(db: PlatformDb, identity: Identity, fileId: unknown): Promise<void> {
  const id = transitIdOf(fileId)
  const gone = await inTransaction(db, "files: transit expire", (sql) => sql<{ id: string }[]>`
    delete from platform.files
     where org_id = ${identity.org.id} and id = ${id} and node_id is null and created_by = ${identity.user.id}
    returning id`)
  if (gone.length === 0) throw unknownFile()
  await removeObjects(identity.org.id, [id])
}
