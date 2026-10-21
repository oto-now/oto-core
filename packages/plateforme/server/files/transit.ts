// Le fichier en transit (fichiers et stockage, § Fichier en transit ; décision d'Alexis du 19/10) : un fichier qui passe
// entre une personne et un connecteur, une ligne `files` sans nœud, avec une échéance. Il se dépose en trois temps comme
// un fichier joint (demande, envoi au bucket, confirmation), se relit à son adresse (`address.ts`), se lit en octets par le moteur
// et s'efface à son échéance ou à sa consommation. Seule la personne qui l'a fait entrer le lit : le service le décide en
// filtrant sur elle avant toute URL, et la RLS le cache à tout autre (organisation, équipe, administrateur, équipe
// plateforme). Le moteur court sous l'identité de la personne qui appelle, donc ne lit que les siens. Il compte au quota
// de l'organisation jusqu'à son échéance (`rows.ts`). Un fichier rendu par un tiers s'y range par le serveur
// (`storeTransitFile`), sans URL d'envoi. Sans lui, une pièce rendue par un connecteur ou envoyée à un connecteur devrait
// être rangée sous une page, où toute l'équipe la lirait.
import { FILE_MAX_BYTES, fileIdSchema, transitFileRequestSchema, type TransitFile, type TransitFileUpload } from "../../schemas"
import type { PlatformDb } from "../db"
import { inTransaction, invalidInput, PlatformError } from "../errors"
import type { Identity } from "../identity"
import { insertPending, markReady, type FileOrigin } from "./rows"
import { admittedType, boundedBytes, checkSize, confirmObject, onStorage, removeObjects, requireStore, unknownFile } from "./service"
import { objectKey } from "./store"

/**
 * La vie d'un fichier en transit jamais consommé, en heures (décidé le 21/10 ; une heure auparavant). La base garde la
 * même durée (`files_expires_at_clock`) et refuse toute autre échéance (42501) : les deux concordent, et changer l'une
 * demande une migration pour l'autre.
 */
export const TRANSIT_HOURS = 24

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
 * Purge les fichiers en transit échus de l'organisation, de toute personne (`purge_transit_files`, réservée au rôle du
 * serveur, qui ne rend que leurs identifiants), puis leurs objets après le commit. Le paquet n'a pas de tâche planifiée : elle court à chaque entrée en
 * transit ; d'ici là, un fichier échu est déjà illisible et hors du quota.
 */
export async function purgeTransitFiles(db: PlatformDb, identity: Identity): Promise<void> {
  const purged = await inTransaction(db, "files: transit purge", (sql) => sql<{ id: string }[]>`
    select id from platform.purge_transit_files(${identity.org.id}) as id`, "server")
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
  const { mime } = admittedType(request.name)
  // 50 Mo pour tout type admis, texte compris (décision du 19/10) : la borne de 4 Mo d'un texte joint ne vaut pas ici.
  checkSize(request.name, null, request.size)
  const { id, expiresAt } = await insertPending(db, identity, { nodeId: null, transitHours: TRANSIT_HOURS, name: request.name, mime, size: request.size, origin: { kind: "upload" } })
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

/** Ce que dit le refus d'un fichier effacé, selon sa cause. */
const ERASED_CAUSES: Readonly<Record<string, string>> = { expired: `its ${TRANSIT_HOURS} hours in transit ran out`, consumed: "sent to a third party" }

/**
 * Le refus d'un fichier en transit de l'appelant effacé (`20261021190000`) : sa trace, 30 jours, ou sa ligne échue que la
 * purge n'a pas encore emportée, datée de son échéance. `null` pour tout autre identifiant : la trace d'un autre auteur,
 * que la RLS cache aussi, reste un fichier inconnu.
 */
async function erasedRefusal(db: PlatformDb, identity: Identity, id: string): Promise<PlatformError | null> {
  const [erased] = await inTransaction(db, "files: transit erased", (sql) => sql<{ at: string; cause: string }[]>`
    select to_json(erased_at) #>> '{}' as at, cause from platform.erased_files
     where org_id = ${identity.org.id} and id = ${id} and created_by = ${identity.user.id} and keep_until > now()
    union all
    select to_json(expires_at) #>> '{}', 'expired' from platform.files
     where org_id = ${identity.org.id} and id = ${id} and node_id is null and created_by = ${identity.user.id}
       and status = 'ready' and expires_at <= now()`)
  if (!erased) return null
  const at = new Date(erased.at).toISOString()
  return new PlatformError(
    "not_found",
    `File ${id} was deleted on ${at.slice(0, 16).replace("T", " ")} UTC (${ERASED_CAUSES[erased.cause]}): run the function that produced it again, or upload it again.`,
    { reason: "file_erased", erased_at: at, cause: erased.cause },
  )
}

/**
 * Un fichier en transit de l'appelant, prêt et non échu, pour sa lecture (`/f/<id>`, `read {file}`, le moteur) ; effacé,
 * le refus qui le date et dit quoi faire, à son seul auteur ; sinon `not_found`, comme `ownTransitRow`.
 */
export async function readyTransitFile(db: PlatformDb, identity: Identity, fileId: unknown): Promise<TransitRow> {
  const id = transitIdOf(fileId)
  try {
    return await ownTransitRow(db, identity, id, "ready")
  } catch (error) {
    if (!(error instanceof PlatformError) || error.code !== "not_found") throw error
    throw (await erasedRefusal(db, identity, id)) ?? error
  }
}

/**
 * Les octets d'un fichier en transit, pour le moteur pendant un transfert, sous l'identité de la personne qui appelle : sa
 * ligne `ready`, non échue, puis l'objet lu par le serveur, 50 Mo au plus. Ne l'efface pas : sa consommation se décide
 * après l'envoi au tiers (`expireTransitFile`).
 */
export async function readTransitBytes(db: PlatformDb, identity: Identity, fileId: unknown): Promise<TransitBytes> {
  const store = requireStore()
  const row = await readyTransitFile(db, identity, fileId)
  const url = await onStorage("read url", () => store.readUrl(objectKey(identity.org.id, row.id), { contentType: "application/octet-stream", disposition: "attachment" }))
  const bytes = await boundedBytes(url, row.name, FILE_MAX_BYTES)
  return { id: row.id, name: row.name, mime: row.mime, size: row.size, bytes }
}

/**
 * Range en fichier en transit de l'appelant un fichier que le serveur a déjà lu en entier (la sortie d'une fonction de
 * connecteur, `connecteurs-et-comptes.md` § Fichiers rendus par un tiers), pendant de `storeFile` sans nœud : purge des
 * échus de l'organisation, stockage, type de l'extension (`admittedType`), taille (50 Mo pour tout type), ligne `pending`
 * à l'échéance de `TRANSIT_HOURS` sous le quota et le verrou de l'organisation, objet écrit (`put`), puis `ready`. Un
 * objet qui ne s'écrit pas efface la ligne et rend `internal` : aucun fichier partiel. Rend le fichier et son échéance.
 */
export async function storeTransitFile(db: PlatformDb, identity: Identity, file: { name: string; bytes: Uint8Array; origin: FileOrigin }): Promise<TransitFile> {
  await purgeTransitFiles(db, identity)
  const store = requireStore()
  const size = file.bytes.byteLength
  const { mime } = admittedType(file.name)
  checkSize(file.name, null, size)
  const { id, expiresAt } = await insertPending(db, identity, { nodeId: null, transitHours: TRANSIT_HOURS, name: file.name, mime, size, origin: file.origin })
  if (expiresAt === null) throw new Error("[platform] files: a transit file was inserted without expiry")
  try {
    await onStorage("put", () => store.put(objectKey(identity.org.id, id), file.bytes, mime))
  } catch (error) {
    // La ligne part ; si même cela échoue, elle reste `pending`, illisible, et part avec les envois abandonnés.
    await expireTransitFile(db, identity, id).catch(() => console.error(`[platform] files: transit row left pending ${objectKey(identity.org.id, id)}`))
    throw error
  }
  await markReady(db, identity, { id, name: file.name }, { label: "files: transit kept", advice: "call the function again" })
  return { id, name: file.name, size, mime, expiresAt }
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
