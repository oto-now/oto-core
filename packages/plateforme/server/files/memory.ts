// L'adaptateur en mémoire du port de stockage (ADR-016 § 1, AC-a1) : les tests jouent le bucket sans service
// extérieur. Ses URL présignées (`https://memory.invalid/<clé>?…`) se servent par son `fetch`, comme le bucket
// les servirait : un envoi (`PUT`) qui porte le type et la taille signés, une lecture (`GET`) au type et à la
// disposition de l'URL, 404 pour un objet absent, 403 pour une URL expirée ou un envoi qui ne tient pas sa
// signature. Un test le passe à la place de `fileStore()` et de `fetch`. Jamais utilisé par un hôte.
import { READ_URL_SECONDS, UPLOAD_URL_SECONDS, type FileStore, type ObjectHead, type ObjectResponse } from "./store"

const ORIGIN = "https://memory.invalid"

/** Un objet gardé : ses octets et son type. */
export type StoredObject = { bytes: Uint8Array; mime: string }

/** Les opérations du port qu'un test fait échouer (panne du bucket). */
export type StoreOperation = "uploadUrl" | "readUrl" | "head" | "copy" | "remove" | "put"

export type MemoryFileStore = FileStore & {
  /** Les objets du bucket, par clé : un test y pose un objet qui ne tient pas sa demande, ou l'en retire. */
  objects: Map<string, StoredObject>
  /** Les opérations qui lèvent, le temps qu'un test les y laisse. */
  failing: Set<StoreOperation>
  /** Le bucket vu par ses URL présignées. */
  fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>
}

/** `now` : l'horloge des expirations, `Date.now` par défaut. */
export function memoryFileStore(now: () => number = Date.now): MemoryFileStore {
  const objects = new Map<string, StoredObject>()
  const failing = new Set<StoreOperation>()
  const guard = (operation: StoreOperation) => {
    if (failing.has(operation)) throw new Error(`storage ${operation} failed (memory)`)
  }
  const address = (key: string, query: Record<string, string>) => `${ORIGIN}/${key}?${new URLSearchParams(query).toString()}`

  async function serve(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    const request = new Request(input, init)
    const url = new URL(request.url)
    if (url.origin !== ORIGIN) return new Response("unknown host", { status: 502 })
    const key = url.pathname.slice(1)
    if (Number(url.searchParams.get("expires")) < now()) return new Response("expired", { status: 403 })
    if (request.method === "PUT") {
      const bytes = new Uint8Array(await request.arrayBuffer())
      const mime = request.headers.get("content-type") ?? ""
      if (mime !== url.searchParams.get("content-type") || String(bytes.byteLength) !== url.searchParams.get("content-length")) {
        return new Response("signature does not match", { status: 403 })
      }
      objects.set(key, { bytes, mime })
      return new Response(null, { status: 200 })
    }
    const object = objects.get(key)
    if (request.method !== "GET" || !object) return new Response("not found", { status: 404 })
    return new Response(object.bytes, {
      status: 200,
      headers: {
        "content-type": url.searchParams.get("response-content-type") ?? object.mime,
        "content-disposition": url.searchParams.get("response-content-disposition") ?? "",
      },
    })
  }

  return {
    objects,
    failing,
    fetch: serve,
    async uploadUrl(key: string, object: ObjectHead) {
      guard("uploadUrl")
      const expires = String(now() + UPLOAD_URL_SECONDS * 1000)
      return { url: address(key, { expires, "content-type": object.mime, "content-length": String(object.size) }), headers: { "content-type": object.mime } }
    },
    async readUrl(key: string, response: ObjectResponse) {
      guard("readUrl")
      const expires = String(now() + (response.seconds ?? READ_URL_SECONDS) * 1000)
      return address(key, { expires, "response-content-type": response.contentType, "response-content-disposition": response.disposition })
    },
    async head(key: string) {
      guard("head")
      const object = objects.get(key)
      // Comme Supabase Storage, qui ne rend jamais un objet en `text/html` (il le relit en `text/plain`) et perd les
      // paramètres d'un type (`; charset=…`, HN-E10S02-115) : le bucket le plus strict connu, pour qu'aucun test ne
      // compte sur le type relu (HN-E10S02-114).
      const media = object?.mime.split(";")[0].trim() ?? ""
      return object ? { size: object.bytes.byteLength, mime: media === "text/html" ? "text/plain" : media } : null
    },
    async copy(from: string, to: string) {
      guard("copy")
      const object = objects.get(from)
      if (!object) throw new Error("storage copy: no source object (memory)")
      objects.set(to, { bytes: object.bytes.slice(), mime: object.mime })
    },
    async remove(key: string) {
      guard("remove")
      objects.delete(key)
    },
    async put(key: string, bytes: Uint8Array, mime: string) {
      guard("put")
      objects.set(key, { bytes: bytes.slice(), mime })
    },
  }
}
