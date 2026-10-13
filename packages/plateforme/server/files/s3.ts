// L'adaptateur S3 du port de stockage (ADR-016 § 1) : le protocole S3 signé en SigV4 par `aws4fetch`, sans le
// SDK AWS (`tech-stack.md`). Il sert AWS S3, l'Object Storage de Scaleway, MinIO, et Supabase Storage par son
// point d'accès S3 : une configuration, pas du code. Adresses en chemin (`<endpoint>/<bucket>/<clé>`), que
// servent tous ces fournisseurs, point d'accès S3 de Supabase compris.
//
// Repris d'Oto (`oto_mcp/media_store.py`) : la lecture par URL présignée courte, le bucket privé sans ACL
// publique, cinq variables. Retiré : `boto3`, le téléversement par le serveur pour l'écran (ici, envoi direct
// au bucket), les images publiques par ACL (ici, tout passe par une route qui décide).
import { AwsClient } from "aws4fetch"
import { PlatformConfigError } from "../db"
import { READ_URL_SECONDS, UPLOAD_URL_SECONDS, type FileStore, type ObjectHead, type ObjectResponse } from "./store"

export type S3Config = { endpoint: string; bucket: string; region: string; accessKeyId: string; secretAccessKey: string }

/** Délai d'une opération du serveur sur le bucket (`HEAD`, copie, suppression). */
const OPERATION_TIMEOUT_MS = 10_000

/** Un envoi de plus : `aws4fetch` rejoue une réponse 5xx ou 429 ; dix fois par défaut, trop long dans une requête. */
const RETRIES = 1

/**
 * `datetime` : l'instant de la signature (`AAAAMMJJTHHMMSSZ`), fixé par les tests sur les vecteurs publiés
 * d'AWS ; l'heure courante sinon.
 */
type SignOptions = { method: string; headers?: Record<string, string>; query?: Record<string, string>; seconds: number; datetime?: string }

/** L'adresse sans barre finale : `https://s3.fr-par.scw.cloud/` → `https://s3.fr-par.scw.cloud`. */
function trimmedEndpoint(endpoint: string): string {
  let base = endpoint
  while (base.endsWith("/")) base = base.slice(0, -1)
  if (!URL.canParse(base)) throw new PlatformConfigError("PLATFORM_STORAGE_ENDPOINT is not an address")
  const { protocol } = new URL(base)
  if (protocol !== "https:" && protocol !== "http:") throw new PlatformConfigError("PLATFORM_STORAGE_ENDPOINT is not an http(s) address")
  return base
}

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

/** Le client SigV4 d'une configuration, service `s3`. */
export function s3Client(config: S3Config): AwsClient {
  return new AwsClient({ accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey, service: "s3", region: config.region, retries: RETRIES })
}

/** L'échec d'une opération sur le bucket : son nom et le statut rendu, jamais l'adresse signée. */
function failed(operation: string, status: number): Error {
  return new Error(`storage ${operation} answered HTTP ${status}`)
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

/** Pages de 1 000 clés au plus lues par `list`. */
const LIST_PAGES_MAX = 10

const XML_ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" }

/** Les valeurs des balises `<name>` d'une réponse XML du bucket, entités décodées, par un parcours linéaire. */
function xmlValues(xml: string, name: string): string[] {
  const values: string[] = []
  const open = `<${name}>`
  const close = `</${name}>`
  for (let at = xml.indexOf(open); at !== -1; at = xml.indexOf(open, at)) {
    const end = xml.indexOf(close, at + open.length)
    if (end === -1) break
    values.push(xml.slice(at + open.length, end).replace(/&(?:amp|lt|gt|quot|apos);/g, (entity) => XML_ENTITIES[entity] ?? entity))
    at = end + close.length
  }
  return values
}

export function s3FileStore(config: S3Config): FileStore {
  const client = s3Client(config)
  const base = `${trimmedEndpoint(config.endpoint)}/${encodeURIComponent(config.bucket)}`
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
      if (!answer.ok) throw failed("HEAD", answer.status)
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
      if (!answer.ok || body.includes("<Error>")) throw failed("copy", answer.status)
    },

    async put(key: string, bytes: Uint8Array, mime: string) {
      const answer = await client.fetch(objectUrl(key), {
        method: "PUT",
        headers: { "content-type": mime, "content-length": String(bytes.byteLength) },
        body: bytes,
        signal: AbortSignal.timeout(OPERATION_TIMEOUT_MS),
      })
      await answer.body?.cancel()
      if (!answer.ok) throw failed("PUT", answer.status)
    },

    // ListObjectsV2, page par page : les `<Key>` de la réponse, lus à la main (une réponse du bucket, pas d'un client).
    async list(prefix: string) {
      const keys: string[] = []
      let token: string | null = null
      for (let page = 0; page < LIST_PAGES_MAX; page++) {
        const query = new URLSearchParams({ "list-type": "2", prefix, ...(token ? { "continuation-token": token } : {}) })
        const answer = await client.fetch(`${base}?${query.toString()}`, { method: "GET", signal: AbortSignal.timeout(OPERATION_TIMEOUT_MS) })
        const body = await answer.text()
        if (!answer.ok) throw failed("list", answer.status)
        keys.push(...xmlValues(body, "Key"))
        token = xmlValues(body, "NextContinuationToken")[0] ?? null
        if (token === null) break
      }
      return keys
    },

    async remove(key: string) {
      const answer = await call(key, { method: "DELETE" })
      await answer.body?.cancel()
      if (!answer.ok && answer.status !== 404) throw failed("DELETE", answer.status)
    },
  }
}
