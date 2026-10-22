// Un fichier qu'un outil d'oto reçoit par son identifiant (fichiers et stockage, § Adresse unique et lecture d'un fichier
// en transit) : en transit et à l'appelant, sinon joint à un nœud qu'il lit. Un même identifiant, un même contrôle, quel
// que soit l'outil : garder un fichier (`keep.ts`), l'envoyer à un tiers (`connectors/multipart.ts`, connecteurs et
// comptes, § Fichiers envoyés à un tiers), le mettre en file avec une fonction longue (`jobs/queue.ts`). Sans lui, chaque
// outil déciderait à sa façon lequel des deux états il admet.
import { FILE_MAX_BYTES } from "../../schemas"
import type { PlatformDb } from "../db"
import { isPlatformError } from "../errors"
import type { Identity } from "../identity"
import { boundedBytes, onStorage, readableFile, requireStore } from "./service"
import { objectKey } from "./store"
import { readyTransitFile } from "./transit"

/** Un fichier de l'appelant : sa ligne, son nœud s'il est joint, son échéance s'il est en transit. */
export type CallerFile = { id: string; name: string; size: number; mime: string; node_id: string | null; expires_at: string | null }

/** Un fichier lu en octets par le moteur, pour un envoi au tiers : joint (`attached`), il n'est jamais consommé. */
export type CallerBytes = { id: string; name: string; mime: string; size: number; bytes: Uint8Array; attached: boolean }

/**
 * Le fichier `fileId` : en transit et à l'appelant (`readyTransitFile`, refus daté d'un fichier effacé compris), sinon
 * joint à un nœud qu'il lit (`readableFile`) ; pour tout autre, le refus du transit (`not_found`).
 */
export async function callerFile(db: PlatformDb, identity: Identity, fileId: unknown): Promise<CallerFile> {
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

/**
 * Les octets du fichier `fileId` (`callerFile`), lus par le serveur, 50 Mo au plus, sous l'identité de la personne qui
 * appelle. Ne l'efface pas : seul un fichier en transit se consomme, après l'envoi au tiers (`expireTransitFile`).
 */
export async function readCallerBytes(db: PlatformDb, identity: Identity, fileId: unknown): Promise<CallerBytes> {
  const store = requireStore()
  const file = await callerFile(db, identity, fileId)
  const url = await onStorage("read url", () => store.readUrl(objectKey(identity.org.id, file.id), { contentType: "application/octet-stream", disposition: "attachment" }))
  const bytes = await boundedBytes(url, file.name, FILE_MAX_BYTES)
  return { id: file.id, name: file.name, mime: file.mime, size: file.size, bytes, attached: file.node_id !== null }
}
