// @vitest-environment node
// Les fichiers qu'une fonction décrite envoie à un tiers (connecteurs et comptes, § Fichiers envoyés à un tiers) : sur
// un `fetch` simulé, sans base ni bucket, les fichiers en transit de l'appelant étant simulés. Le corps multipart (parties
// texte, fichier à son nom et à son type), la consommation après un appel réussi seulement, le refus d'un fichier
// inconnu sans rien envoyer, les contrôles de la déclaration, et le transport gardé qui n'envoie jamais un corps vidé.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { checkArguments } from "../../packages/plateforme/server/catalog/arguments"
import type { FunctionContext } from "../../packages/plateforme/server/catalog/define"
import { CatalogRegistrationError } from "../../packages/plateforme/server/catalog/erp"
import { catalogFunctions, findFunction } from "../../packages/plateforme/server/catalog/registry"
import { guardedFetch } from "../../packages/plateforme/server/connectors/address-guard"
import { registerConnectors } from "../../packages/plateforme/server/connectors/declaration"
import type { ConnectorFunctionDefinition } from "../../packages/plateforme/server/connectors/definition"
import type { Fetch } from "../../packages/plateforme/server/connectors/http"
import { PlatformError } from "../../packages/plateforme/server/errors"
import { memoryTokens, uploadConnector } from "../factories/described-connector"

const transit = vi.hoisted(() => ({
  files: new Map<string, { id: string; name: string; mime: string; size: number; bytes: Uint8Array }>(),
  consumed: [] as string[],
  consumeFails: false,
}))

vi.mock("../../packages/plateforme/server/files/transit", () => ({
  readTransitBytes: async (_db: unknown, _identity: unknown, id: unknown) => {
    const file = typeof id === "string" ? transit.files.get(id) : undefined
    if (!file) throw new PlatformError("not_found", "Unknown file.")
    return file
  },
  expireTransitFile: async (_db: unknown, _identity: unknown, id: string) => {
    if (transit.consumeFails) throw new PlatformError("internal", "storage down")
    transit.consumed.push(id)
    transit.files.delete(id)
  },
}))

const FILE = "0f8fad5b-d9cb-469f-a165-70867728950e"
const CONTENT = "%PDF-1.7 contenu confidentiel"
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

function context(): FunctionContext {
  const credential = { fields: { api_key: "key_test" }, settings: {}, tokens: memoryTokens() }
  return { db: {}, identity: {}, credential, account: { id: "account-1" } } as unknown as FunctionContext
}

async function run(args: Record<string, unknown>) {
  const fn = findFunction(catalogFunctions(), "crm_act.upload_document")
  if (!fn) throw new Error("crm_act.upload_document is not declared")
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

/** `fetch` simulé : ses réponses dans l'ordre, chaque requête gardée avec son corps relu en multipart. */
function stub(...answers: (Response | Error)[]) {
  const send = vi.fn<Fetch>(async () => {
    const next = answers.shift() ?? json({})
    if (next instanceof Error) throw next
    return next
  })
  vi.stubGlobal("fetch", send)
  const requests = async () =>
    Promise.all(
      send.mock.calls.map(async ([url, init]) => {
        const headers = new Headers(init.headers)
        const form = await new Response(init.body as BodyInit, { headers: { "content-type": headers.get("content-type") ?? "" } }).formData()
        const document = form.get("document")
        return {
          url,
          method: init.method,
          type: headers.get("content-type")?.split(";")[0],
          texts: Object.fromEntries([...form.entries()].filter(([, value]) => typeof value === "string")),
          document: document instanceof Blob ? { name: (document as File).name, type: document.type, text: await document.text() } : null,
        }
      }),
    )
  return { send, requests }
}

beforeEach(() => {
  transit.files.clear()
  transit.consumed = []
  transit.consumeFails = false
  transit.files.set(FILE, { id: FILE, name: "facture-2026-10.pdf", mime: "application/pdf", size: CONTENT.length, bytes: new TextEncoder().encode(CONTENT) })
  registerConnectors([uploadConnector()])
})

afterEach(() => {
  registerConnectors([])
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("files sent to a third party", () => {
  it("should send a multipart body, the file under its own name and type and the texts as parts, then consume the file", async () => {
    const { requests } = stub(json({ id: 41, title: "Octobre", url: "https://crm.example.test/dl/41" }, 201))
    const output = await run({ folder_id: 7, file: FILE, title: "Octobre" })
    expect(await requests()).toEqual([
      {
        url: "https://crm.example.test/v2/folders/7/documents",
        method: "POST",
        type: "multipart/form-data",
        texts: { source: "oto", title: "Octobre" },
        document: { name: "facture-2026-10.pdf", type: "application/pdf", text: CONTENT },
      },
    ])
    expect(transit.consumed).toEqual([FILE])
    // L'agent reçoit la réponse du tiers, lien retiré ; jamais le contenu du fichier.
    expect(output.data).toEqual({ id: 41, title: "Octobre" })
    expect(output.text).not.toContain(CONTENT)
  })

  it("should leave out an optional text part that is not given", async () => {
    const { requests } = stub(json({ id: 42 }, 201))
    await run({ folder_id: 7, file: FILE })
    expect((await requests())[0]?.texts).toEqual({ source: "oto" })
  })

  it("should refuse a file the caller cannot read with the same answer whatever the reason, and send nothing", async () => {
    const { send } = stub()
    const unknown = await refusal(run({ folder_id: 7, file: "7c9e6679-7425-40de-944b-e07fc1f90ae7" }))
    const malformed = await refusal(run({ folder_id: 7, file: "not-an-id" }))
    for (const error of [unknown, malformed]) {
      expect(error.code).toBe("not_found")
      expect(error.message).toBe("crm.upload_document: file names no transit file of yours (unknown, expired or already sent). Nothing was sent.")
    }
    expect(send).not.toHaveBeenCalled()
    expect(transit.consumed).toEqual([])
  })

  it.each([
    ["a named refusal of the third party", () => json({ error: "bad type" }, 422), "document_rejected"],
    ["a server error", () => json({}, 503), "upstream_unavailable"],
    ["a timeout", () => Object.assign(new Error("timed out"), { name: "TimeoutError" }), null],
  ])("should keep the file after %s, never consumed", async (_label, answer, refusalCode) => {
    stub(answer())
    const error = await refusal(run({ folder_id: 7, file: FILE }))
    if (refusalCode) expect(error.details).toEqual({ refusal: refusalCode })
    else expect(error.code).toBe("upstream_error")
    expect(transit.consumed).toEqual([])
    expect(transit.files.has(FILE)).toBe(true)
  })

  it("should send the same body again on a rate limit retry, and consume the file once", async () => {
    const { requests } = stub(new Response(null, { status: 429, headers: { "retry-after": "0" } }), json({ id: 43 }, 201))
    await run({ folder_id: 7, file: FILE })
    const sent = await requests()
    expect(sent).toHaveLength(2)
    expect(sent[1]).toEqual(sent[0])
    expect(transit.consumed).toEqual([FILE])
  })

  it("should keep a successful call successful when the file cannot be consumed, and say so in the server log only", async () => {
    stub(json({ id: 44 }, 201))
    transit.consumeFails = true
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const output = await run({ folder_id: 7, file: FILE })
    expect(output.data).toEqual({ id: 44 })
    const logged = log.mock.calls.map((call) => call.join(" ")).join("\n")
    expect(logged).toContain("connector crm: crm.upload_document: a sent transit file was not consumed (internal)")
    expect(logged).not.toContain("facture-2026-10.pdf")
    expect(logged).not.toContain(CONTENT)
  })
})

describe("declaration of file parts", () => {
  const upload = (change: (fn: ConnectorFunctionDefinition) => ConnectorFunctionDefinition) => {
    const base = uploadConnector()
    return { ...base, functions: base.functions.map((fn) => (fn.name === "crm.upload_document" ? change(fn) : fn)) }
  }
  const refused = (change: (fn: ConnectorFunctionDefinition) => ConnectorFunctionDefinition) => {
    try {
      registerConnectors([upload(change)])
    } catch (error) {
      if (error instanceof CatalogRegistrationError) return error.message
      throw error
    }
    return null
  }

  it.each([
    ["an empty map", (fn: ConnectorFunctionDefinition) => ({ ...fn, request: { ...fn.request, files: {} } }), "crm.upload_document: request.files must map at least one part to an argument."],
    ["a GET", (fn: ConnectorFunctionDefinition) => ({ ...fn, request: { ...fn.request, method: "GET" as const } }), "crm.upload_document: request.files needs a method that sends a body (POST, PUT, PATCH)."],
    [
      "a paginated function",
      (fn: ConnectorFunctionDefinition) => ({ ...fn, pagination: { kind: "cursor" as const, requestParam: "title", next: "next", maxPages: 2 } }),
      "crm.upload_document: a function that sends files is not paginated.",
    ],
    [
      "a file argument that is not text",
      (fn: ConnectorFunctionDefinition) => ({ ...fn, schema: { ...fn.schema, properties: { ...(fn.schema.properties as object), file: { type: ["string", "null"] } } } }),
      "crm.upload_document: file argument file must be declared as a string (the id of a transit file).",
    ],
    ["a file argument placed in the body too", (fn: ConnectorFunctionDefinition) => ({ ...fn, request: { ...fn.request, body: { title: "title", copy: "file" } } }), "crm.upload_document: file argument file is placed elsewhere or encoded."],
    ["an encoded file argument", (fn: ConnectorFunctionDefinition) => ({ ...fn, request: { ...fn.request, encode: { file: "json" as const } } }), "crm.upload_document: encode file must be json, on a placed argument."],
    ["a part that is also a body value", (fn: ConnectorFunctionDefinition) => ({ ...fn, request: { ...fn.request, files: { title: "file" } } }), "crm.upload_document: multipart part title is both a file and a body value."],
    ["a part that is also a body constant", (fn: ConnectorFunctionDefinition) => ({ ...fn, request: { ...fn.request, files: { source: "file" } } }), "crm.upload_document: multipart part source is both a file and a body value."],
  ])("should refuse %s", (_label, change, message) => {
    expect(refused(change)).toBe(message)
  })

  it("should accept the upload connector as written", () => {
    expect(refused((fn) => fn)).toBeNull()
  })
})

describe("guarded transport", () => {
  it("should refuse a body it cannot send, before any connection, rather than send it empty", async () => {
    const lookup = vi.fn()
    const error = await guardedFetch(lookup as never)("https://crm.example.test/v2/x", { method: "POST", body: new FormData() }).then(
      () => null,
      (reason: unknown) => reason,
    )
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe("[platform] connectors: the guarded transport sends a text or bytes body only")
    expect(lookup).not.toHaveBeenCalled()
  })
})
