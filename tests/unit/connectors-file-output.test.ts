// @vitest-environment node
// Les fichiers rendus par un tiers (connecteurs et comptes, § Fichiers rendus par un tiers) : sur un `fetch` simulé,
// sans base ni bucket, le rangement en transit simulé. La déclaration (`fileOutputProblem` à `registerConnectors`, clé
// inconnue d'`output` refusée), la lecture (corps, adresse par le transport gardé sans redirection, base64), le nom, le
// type, les bornes, le texte servi et les six refus nommés ; l'adresse du tiers n'apparaît jamais, ni dans un texte, ni
// dans une erreur, ni dans un log. Les cas communs avec la lib, copiés (`tests/factories/file-cases.ts`), en attendant
// `@otomata_tech/connectors/file-cases`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { FILE_TYPES, fileTypeOf } from "../../packages/plateforme/schemas"
import { checkArguments } from "../../packages/plateforme/server/catalog/arguments"
import type { FunctionContext } from "../../packages/plateforme/server/catalog/define"
import { CatalogRegistrationError } from "../../packages/plateforme/server/catalog/erp"
import { catalogFunctions, findFunction } from "../../packages/plateforme/server/catalog/registry"
import { registerConnectors } from "../../packages/plateforme/server/connectors/declaration"
import type { ConnectorDefinition, ConnectorFunctionDefinition } from "../../packages/plateforme/server/connectors/definition"
import type { Fetch } from "../../packages/plateforme/server/connectors/http"
import { PlatformError } from "../../packages/plateforme/server/errors"
import { fileConnector, memoryTokens } from "../factories/described-connector"
import { connector as fileCasesConnector, fileCases, type FileCaseAnswer } from "../factories/file-cases"

const state = vi.hoisted(() => ({
  storage: true,
  kept: [] as { name: string; bytes: Uint8Array }[],
  download: null as null | ((input: string, init: RequestInit) => Promise<Response>),
  guarded: 0,
  storeError: null as PlatformError | null,
}))

vi.mock("../../packages/plateforme/server/files/transit", () => ({
  readTransitBytes: async () => {
    throw new PlatformError("not_found", "Unknown file.")
  },
  expireTransitFile: async () => undefined,
  storeTransitFile: async (_db: unknown, _identity: unknown, file: { name: string; bytes: Uint8Array }) => {
    if (state.storeError) throw state.storeError
    state.kept.push(file)
    const type = fileTypeOf(file.name)
    return { id: "6f0c2b9e-1d4a-4c3e-9b7f-2a8e5d1c0f34", name: file.name, mime: type ? FILE_TYPES[type] : "?", size: file.bytes.byteLength, expiresAt: "2026-10-22T09:12:34.567+00:00" }
  },
}))

vi.mock("../../packages/plateforme/server/files/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../packages/plateforme/server/files/store")>()),
  fileStore: () => (state.storage ? {} : null),
}))

vi.mock("../../packages/plateforme/server/connectors/address-guard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../packages/plateforme/server/connectors/address-guard")>()),
  guardedFetch: (): Fetch => async (input, init) => {
    state.guarded++
    if (!state.download) throw new Error("no download expected")
    return state.download(input, init)
  },
}))

/** L'adresse signée du tiers : elle ne doit apparaître nulle part. */
const SIGNED = "https://files.example.test/rec/987.mp3?X-Signature=SIGNEDTOKEN42"
const SECRET_MARK = "SIGNEDTOKEN42"
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
const bytesOf = (text: string) => new TextEncoder().encode(text)

function context(): FunctionContext {
  const credential = { fields: { api_key: "key_test" }, settings: {}, tokens: memoryTokens() }
  return { db: {}, identity: {}, credential, account: { id: "account-1" }, origin: "https://acme.example.test" } as unknown as FunctionContext
}

async function run(name: string, args: Record<string, unknown>) {
  const fn = findFunction(catalogFunctions(), name)
  if (!fn) throw new Error(`${name} is not declared`)
  const checked = checkArguments(fn.schema, args)
  if (!checked.success) throw new Error("invalid test arguments")
  return fn.run(context(), checked.data as never)
}

async function refusal(work: Promise<unknown>): Promise<PlatformError> {
  const error = await work.then(
    () => null,
    (reason: unknown) => reason,
  )
  if (!(error instanceof PlatformError)) throw new Error(`expected a PlatformError, got ${String(error)}`)
  return error
}

/** L'API simulée : ses réponses dans l'ordre. */
function api(...answers: Response[]) {
  const send = vi.fn<Fetch>(async () => answers.shift() ?? json({}))
  vi.stubGlobal("fetch", send)
  return send
}

/** Le téléchargement simulé (transport gardé) : ses réponses dans l'ordre. */
function download(...answers: Response[]) {
  const calls: { url: string; init: RequestInit }[] = []
  state.download = async (url, init) => {
    calls.push({ url, init })
    return answers.shift() ?? new Response(null, { status: 404 })
  }
  return calls
}

/** Tout ce qui part au log serveur pendant le test. */
function logs() {
  const spies = [vi.spyOn(console, "error"), vi.spyOn(console, "warn"), vi.spyOn(console, "log"), vi.spyOn(console, "info")]
  for (const spy of spies) spy.mockImplementation(() => undefined)
  return () => spies.flatMap((spy) => spy.mock.calls.map((call) => call.map(String).join(" "))).join("\n")
}

const audio = (size: number, headers: Record<string, string> = { "content-type": "audio/mpeg" }) => new Response(new Uint8Array(size).fill(7), { status: 200, headers: { ...headers, "content-length": String(size) } })

beforeEach(() => {
  state.storage = true
  state.kept = []
  state.download = null
  state.guarded = 0
  state.storeError = null
  registerConnectors([fileConnector()])
})

afterEach(() => {
  registerConnectors([])
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("a file returned by a third party", () => {
  it("should download the signed address by the guarded transport, keep the file as a transit file of the caller and serve its id and its link, never the address", async () => {
    const logged = logs()
    const calls = api(json({ call: { id: 987654321, recording: SIGNED } }))
    const downloads = download(audio(1_900_000))
    const output = await run("crm.get_call_recording", { call_id: 987654321 })

    expect(output.text).toBe(
      [
        "crm.get_call_recording: file ready: [call-987654321-recording.mp3 (1,900,000 bytes, mp3)](https://acme.example.test/f/6f0c2b9e-1d4a-4c3e-9b7f-2a8e5d1c0f34), yours until 2026-10-22 09:12 UTC.",
        "Pass its id 6f0c2b9e-1d4a-4c3e-9b7f-2a8e5d1c0f34 as is to a function that takes a file; it is deleted once sent, or at that time.",
      ].join("\n"),
    )
    expect(output.data).toEqual({
      file: {
        id: "6f0c2b9e-1d4a-4c3e-9b7f-2a8e5d1c0f34",
        name: "call-987654321-recording.mp3",
        mime: "audio/mpeg",
        size: 1_900_000,
        expires_at: "2026-10-22T09:12:34.567Z",
        url: "https://acme.example.test/f/6f0c2b9e-1d4a-4c3e-9b7f-2a8e5d1c0f34",
      },
    })
    expect(state.kept.map((file) => ({ name: file.name, size: file.bytes.byteLength }))).toEqual([{ name: "call-987654321-recording.mp3", size: 1_900_000 }])
    // L'appel à l'API, puis un seul téléchargement, par le transport gardé, sans redirection ni authentification.
    expect(calls).toHaveBeenCalledTimes(1)
    expect(state.guarded).toBe(1)
    expect(downloads).toHaveLength(1)
    expect(downloads[0].url).toBe(SIGNED)
    expect(downloads[0].init.redirect).toBe("error")
    const headers = new Headers(downloads[0].init.headers)
    expect({ authorization: headers.get("authorization"), version: headers.get("crm-version"), accept: headers.get("accept") }).toEqual({
      authorization: null,
      version: null,
      accept: "audio/mpeg, audio/mp3",
    })
    expect(JSON.stringify(output)).not.toContain(SECRET_MARK)
    expect(logged()).not.toContain(SECRET_MARK)
  })

  it("should refuse not_enabled before calling the third party when files are not enabled", async () => {
    state.storage = false
    const calls = api(json({ call: { recording: SIGNED } }))
    download(audio(10))
    const error = await refusal(run("crm.get_call_recording", { call_id: 1 }))
    expect({ code: error.code, message: error.message }).toEqual({
      code: "not_enabled",
      message: expect.stringMatching(/^Files are not enabled on this platform: the host sets /),
    })
    expect({ api: calls.mock.calls.length, downloads: state.guarded, kept: state.kept.length }).toEqual({ api: 0, downloads: 0, kept: 0 })
  })

  it("should read a binary body under the account's authentication, asking for the declared types, and name it by Content-Disposition (filename* first)", async () => {
    const calls = api(
      new Response(bytesOf("RIFF....WAVE"), {
        status: 200,
        headers: {
          "content-type": "audio/x-wav; rate=8000",
          "content-disposition": `attachment; filename="../../etc/reunion.wav"; filename*=UTF-8''..%2Fr%C3%A9union%20du%2021%0A.wav`,
        },
      }),
    )
    const output = await run("crm.download_recording", { recording_id: 12 })
    const [url, init] = calls.mock.calls[0]
    const headers = new Headers(init.headers)
    expect({ url, authorization: headers.get("authorization"), accept: headers.get("accept") }).toEqual({
      url: "https://crm.example.test/v2/recordings/12",
      authorization: "Bearer key_test",
      accept: "audio/wav, audio/x-wav, audio/wave, audio/mpeg",
    })
    expect(output.data).toMatchObject({ file: { name: "réunion du 21.wav", mime: "audio/wav", size: 12 } })
    expect(state.kept[0]?.name).toBe("réunion du 21.wav")
  })

  it("should fall back on the field, then on the template, when a name has no declared extension", async () => {
    api(new Response(bytesOf("RIFF"), { status: 200, headers: { "content-disposition": 'attachment; filename="notes.txt"' } }))
    expect((await run("crm.download_recording", { recording_id: 12 })).data).toMatchObject({ file: { name: "recording-12.wav" } })

    api(json({ export: { data: Buffer.from("%PDF-1.7").toString("base64"), filename: "dossier/ventes.pdf" } }))
    expect((await run("crm.get_export", { export_id: 3 })).data).toMatchObject({ file: { name: "ventes.pdf", mime: "application/pdf", size: 8 } })

    api(json({ export: { data: Buffer.from("a;b\n").toString("base64"), filename: "ventes.json" } }))
    expect((await run("crm.get_export", { export_id: 3 })).data).toMatchObject({ file: { name: "export-3.csv", mime: "text/csv", size: 4 } })
  })

  it("should decode base64url strictly, padded or not", async () => {
    api(json({ data: Buffer.from("%PDF-1.7 ok?>").toString("base64url") }))
    const output = await run("crm.get_attachment", { attachment_id: 5 })
    expect(output.data).toMatchObject({ file: { name: "attachment-5.pdf", size: 13 } })
    expect(new TextDecoder().decode(state.kept[0]?.bytes)).toBe("%PDF-1.7 ok?>")
  })

  it("should send the account's authentication to an address of the API's origin only, and nothing to an address without auth", async () => {
    api(json({ archive: { url: "https://crm.example.test/v2/files/9.zip", name: "archive-octobre.zip" } }))
    const downloads = download(new Response(bytesOf("PK"), { status: 200, headers: { "content-type": "application/zip" } }))
    const output = await run("crm.get_archive", { archive_id: 9 })
    expect(new Headers(downloads[0].init.headers).get("authorization")).toBe("Bearer key_test")
    expect(output.data).toMatchObject({ file: { name: "archive-octobre.zip", mime: "application/zip" } })

    api(json({ call: { recording: "https://crm.example.test/v2/calls/1/recording.mp3" } }))
    const plain = download(audio(10))
    await run("crm.get_call_recording", { call_id: 1 })
    expect(new Headers(plain[0].init.headers).get("authorization")).toBeNull()
  })

  it("should accept an announced octet-stream or no type, and keep the type of the extension", async () => {
    api(json({ call: { recording: SIGNED } }), json({ call: { recording: SIGNED } }))
    download(audio(10, { "content-type": "application/octet-stream" }), new Response(new Uint8Array(5), { status: 200 }))
    expect((await run("crm.get_call_recording", { call_id: 1 })).data).toMatchObject({ file: { mime: "audio/mpeg", size: 10 } })
    expect((await run("crm.get_call_recording", { call_id: 1 })).data).toMatchObject({ file: { mime: "audio/mpeg", size: 5 } })
  })
})

describe("the refusals of a file returned by a third party", () => {
  /** Le refus, ce qu'il dit, et qu'il n'a rien gardé ni laissé passer l'adresse du tiers. */
  async function refused(work: () => Promise<unknown>) {
    const logged = logs()
    const error = await refusal(work())
    const log = logged()
    expect(error.message).not.toContain(SECRET_MARK)
    expect(JSON.stringify(error.details ?? {})).not.toContain(SECRET_MARK)
    expect(log).not.toContain(SECRET_MARK)
    expect(state.kept).toEqual([])
    return { code: error.code, message: error.message, refusal: error.details?.refusal, log }
  }

  it("file_missing: an empty address field, or an empty body", async () => {
    api(json({ call: { id: 1, recording: null } }))
    download(audio(10))
    expect(await refused(() => run("crm.get_call_recording", { call_id: 1 }))).toMatchObject({
      code: "not_found",
      refusal: "file_missing",
      message: "crm.get_call_recording: Crm answered without a file (call.recording is empty). Nothing was kept.",
    })
    expect(state.guarded).toBe(0)

    api(new Response(null, { status: 200, headers: { "content-type": "audio/wav" } }))
    expect(await refused(() => run("crm.download_recording", { recording_id: 1 }))).toMatchObject({
      code: "not_found",
      refusal: "file_missing",
      message: "crm.download_recording: Crm answered without a file (its body is empty). Nothing was kept.",
    })
  })

  it("file_download_refused: a status out of 2xx, a redirection never followed", async () => {
    api(json({ call: { recording: SIGNED } }))
    download(new Response("expired", { status: 403 }))
    const forbidden = await refused(() => run("crm.get_call_recording", { call_id: 1 }))
    expect(forbidden).toMatchObject({
      code: "upstream_error",
      refusal: "file_download_refused",
      message: "crm.get_call_recording: Crm refused the download (HTTP 403); the link may have expired: call crm.get_call_recording again. Nothing was kept.",
    })
    expect(forbidden.log).toContain("[platform] connector crm: crm.get_call_recording: file not kept (file_download_refused, HTTP 403)")

    api(json({ call: { recording: SIGNED } }))
    const downloads = download(new Response(null, { status: 302, headers: { location: "https://elsewhere.example.test/x.mp3" } }), audio(10))
    expect(await refused(() => run("crm.get_call_recording", { call_id: 1 }))).toMatchObject({ refusal: "file_download_refused", message: expect.stringContaining("(HTTP 302)") })
    expect(downloads).toHaveLength(1)
  })

  it("file_download_refused is not the refusal of the API call, which keeps its error table", async () => {
    api(json({ message: "nope" }, 404))
    expect(await refused(() => run("crm.get_call_recording", { call_id: 1 }))).toMatchObject({ code: "not_found", refusal: "not_found" })
    expect(state.guarded).toBe(0)
  })

  it("file_too_large: an announced Content-Length refused before reading, then the bytes counted as they come", async () => {
    let pulled = 0
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++
        controller.enqueue(new Uint8Array(512))
      },
    })
    api(new Response(endless, { status: 200, headers: { "content-type": "audio/wav", "content-length": "4096" } }))
    expect(await refused(() => run("crm.download_recording", { recording_id: 1 }))).toEqual(
      expect.objectContaining({ code: "too_large", refusal: "file_too_large", message: "crm.download_recording: the file is over 1 KB. Nothing was kept." }),
    )
    expect(pulled).toBeLessThanOrEqual(1)

    const counted = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(600))
      },
    })
    api(new Response(counted, { status: 200, headers: { "content-type": "audio/wav" } }))
    expect(await refused(() => run("crm.download_recording", { recording_id: 1 }))).toMatchObject({ code: "too_large", refusal: "file_too_large" })

    api(json({ call: { recording: SIGNED } }))
    download(new Response(new Uint8Array(10), { status: 200, headers: { "content-type": "audio/mpeg", "content-length": String(60 * 1024 * 1024) } }))
    expect(await refused(() => run("crm.get_call_recording", { call_id: 1 }))).toMatchObject({
      refusal: "file_too_large",
      message: "crm.get_call_recording: the file is over 50 MB. Nothing was kept.",
    })
  })

  it("file_too_large: base64 read up to the encoded size of maxBytes, then decoded within it", async () => {
    api(json({ data: Buffer.from(new Uint8Array(65)).toString("base64url") }))
    expect(await refused(() => run("crm.get_attachment", { attachment_id: 1 }))).toMatchObject({
      code: "too_large",
      refusal: "file_too_large",
      message: "crm.get_attachment: the file is over 64 bytes. Nothing was kept.",
    })
    // Au-delà des 4 Mo d'une réponse ordinaire et de la taille encodée : refusé sans tout lire.
    api(json({ data: "A".repeat(4 * 1024 * 1024 + 200) }))
    expect(await refused(() => run("crm.get_attachment", { attachment_id: 1 }))).toMatchObject({ code: "too_large", refusal: "file_too_large" })
  })

  it("file_type_refused: an announced type that is not one of the retained extension", async () => {
    api(json({ call: { recording: SIGNED } }))
    download(new Response("<html>expired</html>", { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }))
    expect(await refused(() => run("crm.get_call_recording", { call_id: 1 }))).toMatchObject({
      code: "upstream_error",
      refusal: "file_type_refused",
      message: "crm.get_call_recording: Crm sent text/html instead of the file (mp3). Nothing was kept.",
    })
    // `audio/mpeg` est un type déclaré, mais du mp3 : le nom retenu est un wav.
    api(new Response(bytesOf("ID3"), { status: 200, headers: { "content-type": "audio/mpeg" } }))
    expect(await refused(() => run("crm.download_recording", { recording_id: 1 }))).toMatchObject({
      refusal: "file_type_refused",
      message: "crm.download_recording: Crm sent audio/mpeg instead of the file (wav). Nothing was kept.",
    })
  })

  it("file_type_refused: the announced type is judged before any byte of the body is read", async () => {
    let pulled = 0
    // Sans réserve (`highWaterMark` 0) : le flux n'est tiré que par une lecture.
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulled++
          controller.error(new TypeError("the body should not be read"))
        },
      },
      { highWaterMark: 0 },
    )
    api(new Response(body, { status: 200, headers: { "content-type": "text/html" } }))
    expect(await refused(() => run("crm.download_recording", { recording_id: 1 }))).toMatchObject({ refusal: "file_type_refused" })
    expect(pulled).toBe(0)
  })

  it("should compare extensions without regard to case, and keep the name as given", async () => {
    api(new Response(bytesOf("ID3"), { status: 200, headers: { "content-type": "audio/mpeg", "content-disposition": 'attachment; filename="TAKE.MP3"' } }))
    const output = await run("crm.download_recording", { recording_id: 1 })
    expect((output.data as { file: unknown }).file).toMatchObject({ name: "TAKE.MP3", mime: "audio/mpeg", size: 3 })
  })

  it("file_unreadable: a field that is not strict base64 or base64url, or an address that is not text", async () => {
    api(json({ export: { data: "@@not base64@@" } }))
    expect(await refused(() => run("crm.get_export", { export_id: 1 }))).toMatchObject({
      code: "upstream_error",
      refusal: "file_unreadable",
      message: "crm.get_export: Crm sent a file field that is not valid base64. Nothing was kept.",
    })
    api(json({ data: "ab+/cd==" }))
    expect(await refused(() => run("crm.get_attachment", { attachment_id: 1 }))).toMatchObject({
      refusal: "file_unreadable",
      message: "crm.get_attachment: Crm sent a file field that is not valid base64url. Nothing was kept.",
    })
    api(json({ call: { recording: 42 } }))
    expect(await refused(() => run("crm.get_call_recording", { call_id: 1 }))).toMatchObject({
      code: "upstream_error",
      refusal: "file_unreadable",
      message: "crm.get_call_recording: Crm sent a file address that is not text. Nothing was kept.",
    })
    expect(state.guarded).toBe(0)
  })

  it("file_download_refused: an address in http, with credentials or unreadable, never downloaded", async () => {
    for (const address of ["http://files.example.test/rec.mp3?X-Signature=SIGNEDTOKEN42", `https://user:${SECRET_MARK}@files.example.test/rec.mp3`, "not an address SIGNEDTOKEN42"]) {
      api(json({ call: { recording: address } }))
      download(audio(10))
      expect(await refused(() => run("crm.get_call_recording", { call_id: 1 }))).toMatchObject({
        code: "upstream_error",
        refusal: "file_download_refused",
        message: "crm.get_call_recording: Crm gave a file address that cannot be downloaded (a public https address only); nothing was downloaded.",
      })
    }
    expect(state.guarded).toBe(0)
  })

  it("file_download_refused: an address the guarded transport refuses (an internal host) says nothing of the address", async () => {
    api(json({ call: { recording: SIGNED } }))
    state.download = async () => {
      throw new PlatformError("not_enabled", "The address of this account resolves to a private or internal host (files.example.test): refused.")
    }
    expect(await refused(() => run("crm.get_call_recording", { call_id: 1 }))).toMatchObject({
      code: "upstream_error",
      refusal: "file_download_refused",
      message: "crm.get_call_recording: Crm gave a file address that cannot be downloaded (a public https address only); nothing was downloaded.",
    })
  })

  it("file_download_refused: a redirection the transport refuses, or a transfer cut short, before the deadline", async () => {
    const logged = logs()
    api(json({ call: { recording: SIGNED } }))
    state.download = async () => {
      throw new TypeError(`fetch failed: redirect mode is set to error ${SIGNED}`)
    }
    const message = "crm.get_call_recording: Crm cut the download short; call crm.get_call_recording again. Nothing was kept."
    expect(await refused(() => run("crm.get_call_recording", { call_id: 1 }))).toMatchObject({ code: "upstream_error", refusal: "file_download_refused", message })
    api(json({ call: { recording: SIGNED } }))
    state.download = async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(3))
            controller.error(new TypeError(`terminated ${SIGNED}`))
          },
        }),
        { status: 200, headers: { "content-type": "audio/mpeg" } },
      )
    expect(await refused(() => run("crm.get_call_recording", { call_id: 1 }))).toMatchObject({ code: "upstream_error", refusal: "file_download_refused", message })
    expect(state.kept).toEqual([])
    expect(logged()).not.toContain(SECRET_MARK)
  })

  it("file_foreign_origin: under auth account, the origin is judged before the address: the API's host in http is foreign", async () => {
    api(json({ archive: { url: "http://crm.example.test/v2/files/9.zip?X-Signature=SIGNEDTOKEN42" } }))
    expect(await refused(() => run("crm.get_archive", { archive_id: 9 }))).toMatchObject({ code: "upstream_error", refusal: "file_foreign_origin" })
    expect(state.guarded).toBe(0)
  })

  it("file_foreign_origin: under auth account, an address of another origin is refused without downloading anything", async () => {
    api(json({ archive: { url: "https://crm.example.test.evil.example/v2/files/9.zip?X-Signature=SIGNEDTOKEN42" } }))
    download(new Response(bytesOf("PK"), { status: 200 }))
    expect(await refused(() => run("crm.get_archive", { archive_id: 9 }))).toMatchObject({
      code: "upstream_error",
      refusal: "file_foreign_origin",
      message: "crm.get_archive: Crm gave a file address outside its API; nothing was downloaded.",
    })
    expect(state.guarded).toBe(0)
  })

  it("the deadline of the function covers the reading of the body", async () => {
    vi.stubGlobal("fetch", async (_input: string, init: RequestInit) => {
      const signal = init.signal
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(3))
          signal?.addEventListener("abort", () => controller.error(signal.reason))
        },
      })
      return new Response(body, { status: 200, headers: { "content-type": "audio/mpeg" } })
    })
    expect(await refused(() => run("crm.get_slow_recording", { recording_id: 1 }))).toMatchObject({
      code: "upstream_error",
      message: "Crm did not answer within 1 s. Retry later.",
    })
  })

  it("a storage that fails, or a full quota, says so and keeps nothing more", async () => {
    // Le rangement lui-même (purge, type, taille, quota, put, markReady) est joué sur une vraie base : ici, son refus passe tel quel.
    api(json({ call: { recording: SIGNED } }))
    download(audio(10))
    state.storeError = new PlatformError("too_large", "x.mp3 would take the files of Acme beyond 10 GB.", { reason: "quota", max: 1 })
    const error = await refusal(run("crm.get_call_recording", { call_id: 1 }))
    expect({ code: error.code, reason: error.details?.reason }).toEqual({ code: "too_large", reason: "quota" })
  })
})

describe("the declaration of a file output (registerConnectors)", () => {
  const base = fileConnector()
  const recording = base.functions.find((fn) => fn.name === "crm.get_call_recording") as ConnectorFunctionDefinition
  const withRecording = (change: (fn: ConnectorFunctionDefinition) => unknown): ConnectorDefinition => ({
    ...base,
    functions: base.functions.map((fn) => (fn.name === recording.name ? (change(fn) as ConnectorFunctionDefinition) : fn)),
  })
  const withFile = (file: Record<string, unknown>) => withRecording((fn) => ({ ...fn, output: { file: { ...fn.output?.file, ...file } } }))
  const refusedWith = (definition: ConnectorDefinition): string => {
    try {
      registerConnectors([definition])
    } catch (error) {
      if (error instanceof CatalogRegistrationError) return error.message
      throw error
    }
    return "declared"
  }

  it("should declare the functions that return a file", () => {
    expect(refusedWith(base)).toBe("declared")
  })

  it("should refuse an unknown key of output instead of ignoring it", () => {
    expect(refusedWith(withRecording((fn) => ({ ...fn, output: { ...fn.output, link: "call.recording" } })))).toBe(
      "crm.get_call_recording: output.link is not known to this package: refused rather than ignored (the connectors pin and the package go up together).",
    )
    const contacts = { ...base, functions: base.functions.map((fn) => (fn.name === "crm.list_contacts" ? { ...fn, output: { items: "items", files: true } } : fn)) }
    expect(refusedWith(contacts as ConnectorDefinition)).toMatch(/^crm\.list_contacts: output\.files is not known to this package/)
  })

  it.each([
    ["an extension that is not a type of the package", { types: { flac: ["audio/flac"] } }, "crm.get_call_recording: output.file type flac is not a type of the package (the types of a host reader do not count for a shared description)."],
    ["an extension of the package under another first type", { types: { mp3: ["audio/mp3", "audio/mpeg"] } }, "crm.get_call_recording: output.file type mp3 must first name audio/mpeg, the type of the package."],
    ["a type a browser renders", { types: { mp3: ["audio/mpeg", "text/html"] }, name: { template: "call-{call_id}-recording.mp3" } }, "crm.get_call_recording: output.file type mp3: text/html is rendered or run by a browser."],
    ["a type with parameters", { types: { mp3: ["audio/mpeg; rate=8000"] } }, "crm.get_call_recording: output.file type mp3: audio/mpeg; rate=8000 must be a lowercase media type without parameters."],
    ["a malformed extension", { types: { "MP3!": ["audio/mpeg"] } }, 'crm.get_call_recording: output.file type "MP3!": 1 to 16 lowercase ASCII letters or digits.'],
    ["no type", { types: {} }, "crm.get_call_recording: output.file types must list at least one extension with its media types."],
    ["an unknown from", { from: "stream" }, "crm.get_call_recording: output.file from must be body, url, base64 or base64url."],
    ["a path with body", { from: "body", path: "call.recording", auth: undefined }, "crm.get_call_recording: output.file path is for url, base64 and base64url, not body."],
    ["no path with url", { path: undefined }, "crm.get_call_recording: output.file needs the path of the field that holds the address or the bytes."],
    ["auth outside url", { from: "base64", auth: "account" }, "crm.get_call_recording: output.file auth is for url only."],
    ["an unknown auth", { auth: "bearer" }, "crm.get_call_recording: output.file auth must be none or account."],
    ["a name.path with body", { from: "body", path: undefined, name: { path: "call.name", template: "call-{call_id}-recording.mp3" } }, "crm.get_call_recording: output.file name.path is for url, base64 and base64url, not body."],
    ["a header with base64", { from: "base64", name: { header: "Content-Disposition", template: "call-{call_id}-recording.mp3" } }, "crm.get_call_recording: output.file name.header is for body and url only."],
    ["a template on an optional argument", { name: { template: "call-{other}.mp3" } }, "crm.get_call_recording: output.file name.template cites other, which is not a required argument."],
    ["a template without a declared extension", { name: { template: "call-{call_id}.wav" } }, "crm.get_call_recording: output.file name.template must end with a declared extension (mp3)."],
    ["no template", { name: { header: "Content-Disposition" } }, "crm.get_call_recording: output.file name.template is required: it always gives a name."],
    ["maxBytes beyond 50 MB", { maxBytes: 52_428_801 }, "crm.get_call_recording: output.file maxBytes must be an integer from 1 to 52428800."],
    ["maxBytes of zero", { maxBytes: 0 }, "crm.get_call_recording: output.file maxBytes must be an integer from 1 to 52428800."],
    ["an unknown key of file", { ttl: 48 }, "crm.get_call_recording: output.file.ttl is not known to this package: refused rather than ignored."],
    ["an unknown key of name", { name: { template: "call-{call_id}-recording.mp3", fallback: "x.mp3" } }, "crm.get_call_recording: output.file.name.fallback is not known to this package: refused rather than ignored."],
  ])("should refuse %s", (_what, file, message) => {
    expect(refusedWith(withFile(file))).toBe(message)
  })

  it.each([
    ["items", { items: "calls" }],
    ["strip", { strip: ["url"] }],
    ["projection", { projection: ["id"] }],
    ["schema", { schema: { type: "object" } }],
  ])("should refuse output.file with %s", (key, shape) => {
    expect(refusedWith(withRecording((fn) => ({ ...fn, output: { ...fn.output, ...shape } })))).toBe(`crm.get_call_recording: output.file excludes items, strip, projection and schema (${key}).`)
  })

  it("should refuse output.file on a paginated, asynchronous or collecting function, and expect with a body", () => {
    expect(
      refusedWith(
        withRecording((fn) => ({
          ...fn,
          schema: { ...fn.schema, properties: { ...(fn.schema.properties as object), cursor: { type: "string" } } },
          request: { ...fn.request, query: { cursor: "cursor" } },
          pagination: { kind: "cursor", requestParam: "cursor", next: "next", maxPages: 2 },
        })),
      ),
    ).toBe("crm.get_call_recording: output.file is not for a paginated function, an asynchronous one or the collect of an asynchronous job.")
    const collected = withRecording((fn) => fn)
    const submit: ConnectorFunctionDefinition = {
      ...recording,
      name: "crm.submit_job",
      output: undefined,
      async: { collect: "crm.get_call_recording", jobId: { from: "id", to: "call_id" }, withinMs: 60_000 },
    }
    expect(refusedWith({ ...collected, functions: [...collected.functions, submit] })).toBe(
      "crm.get_call_recording: output.file is not for a paginated function, an asynchronous one or the collect of an asynchronous job.",
    )
    const body = base.functions.find((fn) => fn.name === "crm.download_recording") as ConnectorFunctionDefinition
    const expecting = {
      ...base,
      functions: base.functions.map((fn) =>
        fn.name === body.name ? { ...fn, refusals: [{ code: "empty", when: "no file", message: "No file." }], expect: [{ kind: "non_empty", refusal: "empty", path: "id" }] } : fn,
      ),
    }
    expect(refusedWith(expecting)).toBe("crm.download_recording: output.file from body has no JSON: expect is refused.")
  })
})

/** Une réponse simulée d'un cas commun : statut, en-têtes, corps en texte (octets UTF-8) ou en JSON. */
function caseAnswer(answer: FileCaseAnswer): Response {
  // En octets : un corps en texte recevrait de `Response` un type `text/plain` que le cas n'annonce pas.
  const body = bytesOf(answer.json !== undefined ? JSON.stringify(answer.json) : (answer.text ?? ""))
  return new Response(answer.status >= 300 && answer.status < 400 && body.byteLength === 0 ? null : body, { status: answer.status, headers: answer.headers })
}

describe("the shared file cases", () => {
  beforeEach(() => {
    registerConnectors([fileCasesConnector])
  })

  it("should declare the connector of the shared cases", () => {
    expect(fileCases).toHaveLength(43)
    expect(fileCasesConnector.functions.every((fn) => findFunction(catalogFunctions(), fn.name) !== undefined)).toBe(true)
  })

  it.each(fileCases.map((one) => [one.name, one] as const))("%s", async (_name, one) => {
    const logged = logs()
    api(caseAnswer(one.answer))
    if (one.download) download(caseAnswer(one.download))
    const credential = { fields: { api_key: "key_test" }, settings: {}, tokens: memoryTokens() }
    const fn = findFunction(catalogFunctions(), one.function.name)
    if (!fn) throw new Error(`${one.function.name} is not declared`)
    const checked = checkArguments(fn.schema, one.args)
    if (!checked.success) throw new Error("invalid case arguments")
    const work = fn.run({ db: {}, identity: {}, credential, account: { id: "account-1" } } as unknown as FunctionContext, checked.data as never)
    if (one.file) {
      const output = await work
      expect((output.data as { file: unknown }).file).toMatchObject(one.file)
      expect(state.kept.map((kept) => ({ name: kept.name, size: kept.bytes.byteLength }))).toEqual([{ name: one.file.name, size: one.file.size }])
    } else {
      expect((await refusal(work)).details?.refusal).toBe(one.refusal)
      expect(state.kept).toEqual([])
    }
    // Une adresse n'est téléchargée que si le cas en donne la réponse.
    expect({ downloaded: state.guarded > 0 }).toEqual({ downloaded: one.download !== undefined })
    expect(logged()).not.toMatch(/signature=|user:pass/)
  })

  it.todo("should play the file cases of @otomata_tech/connectors/file-cases, shared with the Python lib, once the connectors pin brings them")
})
