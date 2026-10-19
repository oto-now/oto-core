// L'adaptateur S3 du port de stockage (ADR-016 § 1) : le protocole S3 signé en SigV4 par `aws4fetch`, sans le
// SDK AWS (`tech-stack.md`). Il sert AWS S3, l'Object Storage de Scaleway, MinIO, et Supabase Storage par son
// point d'accès S3 : une configuration, pas du code. Adresses en chemin (`<endpoint>/<bucket>/<clé>`), que
// servent tous ces fournisseurs, point d'accès S3 de Supabase compris.
//
// Repris d'Oto (`oto_mcp/media_store.py`) : la lecture par URL présignée courte, le bucket privé sans ACL
// publique, cinq variables. Retiré : `boto3`, le téléversement par le serveur pour l'écran (ici, envoi direct
// au bucket), les images publiques par ACL (ici, tout passe par une route qui décide).
//
// L'adresse du bucket, le client, la liste par préfixe et la suppression vivent dans `cli/storage.mjs`, partagé avec la
// commande `oto-platform org delete`.
import type { AwsClient } from "aws4fetch"
import { bucketBase, listKeys, OPERATION_TIMEOUT_MS, removeObject, s3Client, storageFailure, type StorageConfig } from "../../cli/storage.mjs"
import { PlatformConfigError } from "../db"
import { READ_URL_SECONDS, UPLOAD_URL_SECONDS, type FileStore, type ObjectHead, type ObjectResponse } from "./store"

export { s3Client }

export type S3Config = StorageConfig

/**
 * `datetime` : l'instant de la signature (`AAAAMMJJTHHMMSSZ`), fixé par les tests sur les vecteurs publiés
 * d'AWS ; l'heure courante sinon.
 */
type SignOptions = { method: string; headers?: Record<string, string>; query?: Record<string, string>; seconds: number; datetime?: string }

/**
 * Une URL présignée (signature dans la requête, `X-Amz-Expires` en secondes). Les en-têtes passés sont tous
 * signés (`allHeaders`) : `content-type` et `content-length` d'un envoi, que `aws4fetch` laisse sinon hors de
 * la signature. Un espace de la requête sort en `%20`, jamais en `+`, que S3 ne relit pas comme un espace : la
 * sérialisation d'`URLSearchParams` écrit `+` pour un espace et `%2B` pour un `+`, le remplacement est sûr.
 */
export async function presign(client: AwsClient, address: string, options: SignOptions): Promise<string> {
  const url = new URL(address)
  for (const [name, value] of Object.entries(options.query ?? {})) url.searchParams.set(name, value)
  url.searchParams.set("X-Amz-Expires", String(options.seconds))
  const signed = await client.sign(url.toString(), {
    method: options.method,
    headers: options.headers,
    aws: { signQuery: true, allHeaders: true, ...(options.datetime ? { datetime: options.datetime } : {}) },
  })
  const result = new URL(signed.url)
  return `${result.origin}${result.pathname}${result.search.split("+").join("%20")}`
}

/** Une taille écrite en chiffres seuls, sinon `null` : jamais `Number(null)` (0) ni `NaN`. */
function digits(value: string | null | undefined): number | null {
  return value && /^\d{1,15}$/.test(value) ? Number(value) : null
}

/** La taille d'une réponse non compressée ; `null` si un `content-encoding` la change ou si `content-length` manque. */
function plainLength(headers: Headers): number | null {
  const encoding = headers.get("content-encoding")
  return encoding === null || encoding.toLowerCase() === "identity" ? digits(headers.get("content-length")) : null
}

/** Les en-têtes qui disent comment une taille a été rendue, pour le log serveur : aucun ne porte de secret. */
function sizeHeaders(answer: Response): Record<string, string | number | null> {
  const read = (name: string) => answer.headers.get(name)
  return { status: answer.status, "content-length": read("content-length"), "content-encoding": read("content-encoding"), "transfer-encoding": read("transfer-encoding"), "content-range": read("content-range"), "content-type": read("content-type") }
}

export function s3FileStore(config: S3Config): FileStore {
  const client = s3Client(config)
  const bucket = bucketBase(config)
  if ("problem" in bucket) throw new PlatformConfigError(bucket.problem)
  const { base } = bucket
  const objectUrl = (key: string) => `${base}/${key}`
  const call = (key: string, init: { method: string; headers?: Record<string, string> }) =>
    client.fetch(objectUrl(key), { ...init, signal: AbortSignal.timeout(OPERATION_TIMEOUT_MS) })
  // Une lecture de taille : `accept-encoding: identity` posé après la signature, hors d'elle, car un CDN le réécrit vers
  // l'origine ; sans lui, `fetch` annonce gzip et le CDN de Supabase compresse un objet relu `text/plain`, sans
  // `content-length` (HN-E10S02-124). `range` n'est jamais signé par `aws4fetch`.
  const sized = async (key: string, method: "HEAD" | "GET", headers: Record<string, string> = {}) => {
    const signed = await client.sign(objectUrl(key), { method, headers })
    signed.headers.set("accept-encoding", "identity")
    return fetch(signed, { signal: AbortSignal.timeout(OPERATION_TIMEOUT_MS) })
  }
  // La taille par `content-range` d'un `GET bytes=0-0` (`bytes 0-0/<taille>`) ; 416 : l'objet est vide ; `null` sinon.
  const rangedSize = async (key: string): Promise<{ size: number | null; answer: Response }> => {
    const answer = await sized(key, "GET", { range: "bytes=0-0" })
    await answer.body?.cancel()
    const total = /^bytes (?:0-0|\*)\/(\d{1,15})$/.exec(answer.headers.get("content-range") ?? "")?.[1]
    if (answer.status === 206 || answer.status === 416) return { size: digits(total) ?? (answer.status === 416 ? 0 : null), answer }
    return { size: answer.status === 200 ? plainLength(answer.headers) : null, answer }
  }

  return {
    async uploadUrl(key: string, object: ObjectHead) {
      const headers = { "content-type": object.mime, "content-length": String(object.size) }
      const url = await presign(client, objectUrl(key), { method: "PUT", headers, seconds: UPLOAD_URL_SECONDS })
      return { url, headers: { "content-type": object.mime } }
    },

    readUrl(key: string, response: ObjectResponse) {
      const query = { "response-content-type": response.contentType, "response-content-disposition": response.disposition }
      return presign(client, objectUrl(key), { method: "GET", query, seconds: response.seconds ?? READ_URL_SECONDS })
    },

    async head(key: string) {
      const answer = await sized(key, "HEAD")
      // Un objet absent : 404, ou 403 quand les clés ne listent pas le bucket (comme la lecture, HN-E10S02-32).
      if (answer.status === 404 || answer.status === 403) return null
      if (!answer.ok) throw storageFailure("HEAD", answer.status)
      const mime = answer.headers.get("content-type") ?? ""
      const size = plainLength(answer.headers)
      if (size !== null) return { size, mime }
      const ranged = await rangedSize(key)
      if (ranged.size === null) console.error("[platform] files: storage gave no size", { key, head: sizeHeaders(answer), range: sizeHeaders(ranged.answer) })
      return { size: ranged.size, mime }
    },

    async copy(from: string, to: string) {
      const answer = await call(to, { method: "PUT", headers: { "x-amz-copy-source": `/${encodeURIComponent(config.bucket)}/${from}` } })
      // S3 peut rendre 200 avec une erreur dans le corps d'une copie : le corps se lit aussi.
      const body = await answer.text()
      if (!answer.ok || body.includes("<Error>")) throw storageFailure("copy", answer.status)
    },

    async put(key: string, bytes: Uint8Array, mime: string) {
      const answer = await client.fetch(objectUrl(key), {
        method: "PUT",
        headers: { "content-type": mime, "content-length": String(bytes.byteLength) },
        body: bytes,
        signal: AbortSignal.timeout(OPERATION_TIMEOUT_MS),
      })
      await answer.body?.cancel()
      if (!answer.ok) throw storageFailure("PUT", answer.status)
    },

    list: (prefix: string) => listKeys(client, base, prefix),

    remove: (key: string) => removeObject(client, base, key),
  }
}
