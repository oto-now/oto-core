// @vitest-environment node
// Le port de stockage des fichiers (E10-S02 lot a, ADR-016) sans base ni bucket : `fileStore()` rendu nul sans
// l'une des cinq variables (AC-a1), la signature SigV4 de l'adaptateur S3 sur le vecteur publié d'AWS, les
// durées et les en-têtes signés des URL d'envoi et de lecture, la clé d'objet, les types admis et la
// disposition de lecture (AC-a5), l'objet absent d'un `HEAD`. Aucune requête ne part : les URL se construisent et se
// lisent, le `HEAD` répond par un `fetch` simulé.
import { afterEach, describe, expect, it, vi } from "vitest"
import { FILE_MAX_BYTES, FILE_TYPES, fileTypeOf, ORG_QUOTA_BYTES, TEXT_FILE_MAX_BYTES, TEXT_TYPES } from "../../packages/plateforme/schemas"
import { readResponse } from "../../packages/plateforme/server/files/service"
import { presign, s3Client, s3FileStore } from "../../packages/plateforme/server/files/s3"
import { fileStore, objectKey, STORAGE_VARIABLES, storageNotEnabled } from "../../packages/plateforme/server/files/store"

// Les clés de l'exemple publié d'AWS (« Authenticating Requests: Using Query Parameters »), construites à
// l'exécution : aucun motif de clé en littéral (`testing-strategy.md § Anti-patterns`).
const AWS_EXAMPLE = {
  accessKeyId: ["AKIA", "IOSFODNN7EXAMPLE"].join(""),
  secretAccessKey: ["wJalrXUtnFEMI", "K7MDENG", "bPxRfiCYEXAMPLEKEY"].join("/"),
}

/** Les cinq variables, valeurs d'essai construites à l'exécution. */
function storageEnv(): Record<string, string> {
  return {
    PLATFORM_STORAGE_ENDPOINT: "https://s3.fr-par.scw.cloud",
    PLATFORM_STORAGE_BUCKET: "plateforme-essai",
    PLATFORM_STORAGE_REGION: "fr-par",
    PLATFORM_STORAGE_ACCESS_KEY_ID: ["cle", "essai"].join("-"),
    PLATFORM_STORAGE_SECRET_ACCESS_KEY: ["secret", "essai"].join("-"),
  }
}

const ORG = "8d3f2c1a-5b6e-4f70-9a81-2b3c4d5e6f70"
const FILE = "0c9e8d7f-6a5b-4c3d-8e2f-1a0b9c8d7e6f"

describe("fileStore (AC-a1)", () => {
  it("should be null without any one of the five variables", () => {
    const verdicts = Object.fromEntries(STORAGE_VARIABLES.map((name) => [name, fileStore({ ...storageEnv(), [name]: "" })]))
    expect(verdicts).toEqual(Object.fromEntries(STORAGE_VARIABLES.map((name) => [name, null])))
  })

  it("should give a store of seven operations with the five variables", () => {
    const store = fileStore(storageEnv())
    expect(Object.keys(store ?? {}).sort()).toEqual(["copy", "head", "list", "put", "readUrl", "remove", "uploadUrl"])
  })

  it("should name the five variables in the not_enabled refusal", () => {
    const refusal = storageNotEnabled()
    expect(refusal.code).toBe("not_enabled")
    expect(STORAGE_VARIABLES.filter((name) => !refusal.message.includes(name))).toEqual([])
  })

  it("should never put the original name in the object key", () => {
    expect(objectKey(ORG, FILE)).toBe(`${ORG}/${FILE}`)
  })
})

describe("S3 adapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("should read an object answered 404 or 403 as absent, and fail on any other refusal (HEAD, HN-E10S02-32)", async () => {
    const store = s3FileStore({ ...AWS_EXAMPLE, endpoint: "https://s3.fr-par.scw.cloud", bucket: "plateforme-essai", region: "fr-par" })
    const answers = [404, 403, 400]
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: answers.shift() })),
    )
    const absent = [await store.head(objectKey(ORG, FILE)), await store.head(objectKey(ORG, FILE))]
    await expect(store.head(objectKey(ORG, FILE))).rejects.toThrow("storage HEAD answered HTTP 400")
    expect(absent).toEqual([null, null])
  })

  it("should list the keys under a prefix page by page (ListObjectsV2), entities decoded, and fail on a refusal", async () => {
    const store = s3FileStore({ ...AWS_EXAMPLE, endpoint: "https://s3.fr-par.scw.cloud", bucket: "plateforme-essai", region: "fr-par" })
    const pages = [
      `<ListBucketResult><Contents><Key>${ORG}/exports/1-a.json</Key></Contents><NextContinuationToken>t&amp;2</NextContinuationToken></ListBucketResult>`,
      `<ListBucketResult><Contents><Key>${ORG}/exports/2-b&amp;c.zip</Key></Contents></ListBucketResult>`,
    ]
    const asked: string[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init)
        asked.push(new URL(request.url).searchParams.get("continuation-token") ?? "")
        return new Response(pages.shift() ?? "", { status: 200 })
      }),
    )
    expect(await store.list(`${ORG}/exports/`)).toEqual([`${ORG}/exports/1-a.json`, `${ORG}/exports/2-b&c.zip`])
    expect(asked).toEqual(["", "t&2"])
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<Error/>", { status: 403 })))
    await expect(store.list(`${ORG}/exports/`)).rejects.toThrow("storage list answered HTTP 403")
  })

  /**
   * Supabase Storage derrière son CDN : un objet relu `text/plain` sort compressé au `HEAD`, sans `content-length`,
   * sauf sur `accept-encoding: identity` (que `ignoresIdentity` fait ignorer) ; `range: bytes=0-0` dit la taille dans
   * `content-range`, et rend 416 sur un objet vide. `ranged` : ce que rend un `GET` qui lit toute la taille autrement.
   */
  function behindCdn(size: number, options: { ignoresIdentity?: boolean; ranged?: Response } = {}) {
    return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      if (request.method === "GET") {
        if (options.ranged) return options.ranged
        if (size === 0) return new Response(null, { status: 416, headers: { "content-range": "bytes */0" } })
        return new Response("x", { status: 206, headers: { "content-range": `bytes 0-0/${size}`, "content-type": "text/plain" } })
      }
      const identity = request.headers.get("accept-encoding") === "identity" && !options.ignoresIdentity
      const headers: Record<string, string> = identity ? { "content-length": String(size) } : { "content-encoding": "gzip", "transfer-encoding": "chunked" }
      return new Response(null, { status: 200, headers: { ...headers, "content-type": "text/plain" } })
    })
  }

  it("should read the size of an object the CDN compresses, by an uncompressed HEAD, else by content-range of bytes=0-0, 0 for an empty one", async () => {
    const store = s3FileStore({ ...AWS_EXAMPLE, endpoint: "https://s3.fr-par.scw.cloud", bucket: "plateforme-essai", region: "fr-par" })
    const identity = behindCdn(156)
    vi.stubGlobal("fetch", identity)
    const byHead = await store.head(objectKey(ORG, FILE))
    const [sent] = identity.mock.calls.map(([input, init]) => new Request(input, init))
    vi.stubGlobal("fetch", behindCdn(156, { ignoresIdentity: true }))
    const byRange = await store.head(objectKey(ORG, FILE))
    vi.stubGlobal("fetch", behindCdn(0, { ignoresIdentity: true }))
    const empty = await store.head(objectKey(ORG, FILE))
    expect({
      byHead,
      requests: identity.mock.calls.length,
      acceptEncoding: sent.headers.get("accept-encoding"),
      // Un CDN réécrit `accept-encoding` vers l'origine : signé, il casserait la signature.
      signed: sent.headers.get("authorization")?.includes("accept-encoding"),
      byRange,
      empty,
    }).toEqual({ byHead: { size: 156, mime: "text/plain" }, requests: 1, acceptEncoding: "identity", signed: false, byRange: { size: 156, mime: "text/plain" }, empty: { size: 0, mime: "text/plain" } })
  })

  it("should give no size, never NaN, and log the headers read, when neither the HEAD nor bytes=0-0 says it", async () => {
    const store = s3FileStore({ ...AWS_EXAMPLE, endpoint: "https://s3.fr-par.scw.cloud", bucket: "plateforme-essai", region: "fr-par" })
    const errors = vi.spyOn(console, "error").mockImplementation(() => {})
    vi.stubGlobal("fetch", behindCdn(156, { ignoresIdentity: true, ranged: new Response("x", { status: 200, headers: { "content-encoding": "gzip" } }) }))
    const head = await store.head(objectKey(ORG, FILE))
    expect({ head, logged: errors.mock.calls.map(([message]) => message) }).toEqual({ head: { size: null, mime: "text/plain" }, logged: ["[platform] files: storage gave no size"] })
    errors.mockRestore()
  })

  it("should sign a presigned GET like the published AWS example (SigV4)", async () => {
    const client = s3Client({ endpoint: "https://s3.amazonaws.com", bucket: "examplebucket", region: "us-east-1", ...AWS_EXAMPLE })
    const url = new URL(await presign(client, "https://examplebucket.s3.amazonaws.com/test.txt", { method: "GET", seconds: 86_400, datetime: "20130524T000000Z" }))
    expect(url.searchParams.get("X-Amz-Signature")).toBe("aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404")
  })

  it("should sign content-length and content-type in an upload URL of 5 minutes, under <endpoint>/<bucket>/<key>", async () => {
    const store = s3FileStore({ ...AWS_EXAMPLE, endpoint: "https://s3.fr-par.scw.cloud/", bucket: "plateforme-essai", region: "fr-par" })
    const { url, headers } = await store.uploadUrl(objectKey(ORG, FILE), { size: 1234, mime: "text/csv" })
    const signed = new URL(url)
    expect({
      path: signed.pathname,
      expires: signed.searchParams.get("X-Amz-Expires"),
      signedHeaders: signed.searchParams.get("X-Amz-SignedHeaders"),
      headers,
    }).toEqual({
      path: `/plateforme-essai/${ORG}/${FILE}`,
      expires: "300",
      signedHeaders: "content-length;content-type;host",
      headers: { "content-type": "text/csv" },
    })
  })

  it("should fix the type and the disposition in a read URL of 60 seconds, spaces written %20", async () => {
    const store = s3FileStore({ ...AWS_EXAMPLE, endpoint: "https://s3.fr-par.scw.cloud", bucket: "plateforme-essai", region: "fr-par" })
    const url = await store.readUrl(objectKey(ORG, FILE), { contentType: "text/plain; charset=utf-8", disposition: "attachment; filename*=UTF-8''a%20b.csv" })
    const signed = new URL(url)
    expect({
      expires: signed.searchParams.get("X-Amz-Expires"),
      type: signed.searchParams.get("response-content-type"),
      disposition: signed.searchParams.get("response-content-disposition"),
      plus: signed.search.includes("+"),
    }).toEqual({ expires: "60", type: "text/plain; charset=utf-8", disposition: "attachment; filename*=UTF-8''a%20b.csv", plus: false })
  })
})

describe("admitted types and limits", () => {
  it("should read the type from the extension of the name, whatever its case, and refuse any other", () => {
    expect([fileTypeOf("Rapport.PDF"), fileTypeOf("notes.md"), fileTypeOf("photo.JPG"), fileTypeOf("setup.exe"), fileTypeOf("sans_extension")]).toEqual([
      "pdf",
      "md",
      "jpg",
      null,
      null,
    ])
    expect(Object.keys(FILE_TYPES)).toEqual(["png", "jpeg", "jpg", "gif", "webp", "svg", "pdf", "csv", "txt", "md", "html", "json", "docx", "xlsx", "pptx", "odt", "ods", "zip", "mp3", "wav", "m4a", "ogg"])
  })

  it("should admit the audio types, by extension, at their media type (decided on 21/10)", () => {
    expect([fileTypeOf("appel.MP3"), fileTypeOf("appel.wav"), fileTypeOf("note.m4a"), fileTypeOf("note.ogg")].map((type) => type && FILE_TYPES[type])).toEqual([
      "audio/mpeg",
      "audio/wav",
      "audio/mp4",
      "audio/ogg",
    ])
  })

  it("should hold 50 MB per file, 4 MB per text file, 10 GB per organisation", () => {
    expect({ file: FILE_MAX_BYTES, text: TEXT_FILE_MAX_BYTES, quota: ORG_QUOTA_BYTES, texts: TEXT_TYPES }).toEqual({
      file: 52_428_800,
      text: 4_194_304,
      quota: 10_737_418_240,
      texts: ["html", "md", "txt", "csv", "json"],
    })
  })
})

describe("readResponse (AC-a5)", () => {
  const read = (name: string, inline = false) => readResponse({ name }, inline)
  const attachment = (name: string) => ({ contentType: FILE_TYPES[fileTypeOf(name) ?? "zip"], disposition: `attachment; filename*=UTF-8''${name}` })

  it("should serve a raster image inline at its type, and a svg as an attachment", () => {
    expect([read("plan.png"), read("plan.svg"), read("plan.svg", true)]).toEqual([
      { contentType: "image/png", disposition: "inline" },
      attachment("plan.svg"),
      attachment("plan.svg"),
    ])
  })

  it("should serve a pdf, a txt or a csv inline on disposition=inline only, the text ones as text/plain", () => {
    expect([read("r.pdf"), read("r.pdf", true), read("r.txt", true), read("r.csv", true), read("r.csv")]).toEqual([
      attachment("r.pdf"),
      { contentType: "application/pdf", disposition: "inline" },
      { contentType: "text/plain; charset=utf-8", disposition: "inline" },
      { contentType: "text/plain; charset=utf-8", disposition: "inline" },
      attachment("r.csv"),
    ])
  })

  it("should serve html, md, json and everything else as an attachment, disposition=inline ignored", () => {
    expect([read("page.html", true), read("notes.md", true), read("report.json", true), read("archive.zip", true), read("note.docx")]).toEqual([
      attachment("page.html"),
      attachment("notes.md"),
      attachment("report.json"),
      attachment("archive.zip"),
      attachment("note.docx"),
    ])
  })

  it("should serve the audio types as an attachment, never inline, disposition=inline ignored", () => {
    expect([read("appel.mp3", true), read("appel.wav"), read("note.m4a", true), read("note.ogg")]).toEqual([
      { contentType: "audio/mpeg", disposition: "attachment; filename*=UTF-8''appel.mp3" },
      attachment("appel.wav"),
      attachment("note.m4a"),
      attachment("note.ogg"),
    ])
  })

  it("should encode the name in filename* (RFC 5987), apostrophe and parentheses included", () => {
    expect(read("Compte rendu (d'avril) é.pdf").disposition).toBe("attachment; filename*=UTF-8''Compte%20rendu%20%28d%27avril%29%20%C3%A9.pdf")
  })
})
