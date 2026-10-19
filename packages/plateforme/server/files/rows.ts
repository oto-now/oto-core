// Les lignes `files` d'un envoi (ADR-016 § 4) : le quota de l'organisation, lu sous son verrou ; la ligne `pending`
// insérée sous ce quota, jointe à un nœud ou en transit ; son passage à `ready`. Communes au fichier joint
// (`service.ts`) et au fichier en transit (`transit.ts`) : sans elles, chacun recompterait le quota et réécrirait
// l'insertion. Le quota compte aussi les fichiers en transit des autres, que la RLS cache : il se lit par
// `org_files_bytes`, qui ne rend qu'une somme.
import type { PlatformDb } from "../db"
import { changedMeanwhile, inTransaction, PlatformError } from "../errors"
import type { Identity } from "../identity"
import { orgStorageQuota } from "../limits"
import type { Tx } from "../sql"

/** Le verrou consultatif du quota d'une organisation (`database-patterns.md § Transactions`, après 7401). */
const QUOTA_LOCK = 7501

const GB = 1_073_741_824

/** `10 GB` : le quota dit dans un refus. */
function gigabytes(bytes: number): string {
  return `${Math.round((bytes / GB) * 10) / 10} GB`
}

/**
 * Le quota de l'organisation (AC-a3, 5 ; ADR-016 § 4), dans la transaction qui écrit des lignes `files` : le verrou de
 * l'organisation, puis la somme des lignes `pending` et `ready` (les fichiers en transit non échus compris, de toute
 * personne) plus `adding` octets ; au-delà de `quota` (`orgStorageQuota`, lu chez l'hôte avant la transaction, 10 Go par
 * défaut, E12-S02), `too_large` (raison `quota`, `max` en octets), qui annule la transaction. Pris avant l'insertion (la
 * demande d'envoi) ou après elle (la duplication d'une page, AC-e3, `adding` nul) : la dernière transaction à prendre le
 * verrou compte les lignes des autres, validées.
 */
export async function requireQuota(sql: Tx, identity: Identity, request: { adding: number; what: string; quota: number }): Promise<void> {
  await sql`select pg_catalog.pg_advisory_xact_lock(${QUOTA_LOCK}, pg_catalog.hashtext(${identity.org.id}::text))`
  const [{ used }] = await sql<{ used: string }[]>`select platform.org_files_bytes(${identity.org.id})::text as used`
  if (Number(used) + request.adding > request.quota) {
    throw new PlatformError("too_large", `${request.what} would take the files of ${identity.org.name} beyond ${gigabytes(request.quota)}: delete the pages that hold files no longer needed.`, { reason: "quota", max: request.quota })
  }
}

/** Une ligne à insérer : jointe à `nodeId`, ou en transit (`nodeId` nul) pour `transitHours` heures. */
export type PendingFile = { nodeId: string; name: string; mime: string; size: number } | { nodeId: null; transitHours: number; name: string; mime: string; size: number }

/**
 * La ligne `pending` d'un envoi (AC-a3, 5), sous le quota lu dans la même transaction, sous le verrou de l'organisation :
 * la demande de l'écran, l'envoi par le serveur du dépôt par lien (lot f, `storeFile`) et la demande d'un fichier en
 * transit, dont l'échéance part de l'horloge de la base. Rend son identifiant et son échéance (nulle pour un fichier joint).
 */
export async function insertPending(db: PlatformDb, identity: Identity, file: PendingFile): Promise<{ id: string; expiresAt: string | null }> {
  const quota = await orgStorageQuota(identity.org)
  return inTransaction(db, "files: request", async (sql) => {
    await requireQuota(sql, identity, { adding: file.size, what: file.name, quota })
    const expiry = file.nodeId === null ? sql`now() + make_interval(hours => ${file.transitHours})` : sql`null`
    const [row] = await sql<{ id: string; expires_at: string | null }[]>`
      insert into platform.files (org_id, node_id, name, mime, size, status, created_by, expires_at)
      values (${identity.org.id}, ${file.nodeId}, ${file.name}, ${file.mime}, ${file.size}, 'pending', ${identity.user.id}, ${expiry})
      returning id, to_json(expires_at) #>> '{}' as expires_at`
    return { id: row.id, expiresAt: row.expires_at }
  })
}

/**
 * La ligne `pending` d'un objet lu passée à `ready` : la confirmation de l'écran (AC-a4), l'envoi par le serveur (lot f) et
 * la confirmation d'un fichier en transit. Aucune ligne : la ligne a changé entre-temps (ou, en transit, elle est échue et
 * purgée), `conflict` journalisé d'abord (`changedMeanwhile`).
 */
export async function markReady(db: PlatformDb, identity: Identity, file: { id: string; name: string }, meanwhile: { label: string; advice: string }): Promise<void> {
  const updated = await inTransaction(db, meanwhile.label, (sql) => sql<{ id: string }[]>`
    update platform.files set status = 'ready'
     where org_id = ${identity.org.id} and id = ${file.id} and status = 'pending'
    returning id`)
  if (updated.length === 0) throw changedMeanwhile(meanwhile.label, file.id, `${file.name} changed meanwhile: ${meanwhile.advice}.`)
}
