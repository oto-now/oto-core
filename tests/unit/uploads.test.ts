// @vitest-environment node
// Le dépôt par lien sans base (E10-S02 lot f ; ADR-018) : le jeton et son empreinte (AC-f3), les deux commandes
// rendues pour un nom qui porte espaces, apostrophe, `$` et accent grave (AC-f2), l'entrée d'`upload.link` (AC-f1), et
// la porte sans session (AC-f4, AC-f11) : servie avant le jeton de session, ses refus 1 à 4 dans leur ordre, en texte
// brut, sans aucun client de base ouvert (espion) ni lecture du corps au-delà de la borne. Le masquage de `source_url`
// au journal (AC-f14), avec les clés voisines qui restent lisibles. Sur une vraie base : `tests/integration/uploads.test.ts`.
import { createHash } from "node:crypto"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { handlePlateforme } from "@otomata_tech/oto_platform/api"
import { isUploadFormRoute, isUploadRoute, UPLOAD_HEADERS } from "../../packages/plateforme/api/uploads"
import { UPLOAD_BYTES_MAX, UPLOAD_TOKEN_PATTERN, uploadLinkSchema } from "../../packages/plateforme/schemas"
import { uploadCommands } from "../../packages/plateforme/server/catalog/upload-link"
import { loggedArgs } from "../../packages/plateforme/server/journal"
import { newUploadToken, uploadTokenHash } from "../../packages/plateforme/server/uploads"

// Tout client de base ouvert est relevé, et ne sert rien : un refus 1 à 4 n'en ouvre aucun (AC-f11).
const opened = vi.hoisted(() => ({ clients: [] as string[] }))

vi.mock("../../packages/plateforme/server/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../packages/plateforme/server/db")>()
  const refused = { tx: () => Promise.reject(new Error("no database in this test")) }
  return {
    ...real,
    createAnonPlatformDb: () => {
      opened.clients.push("anon")
      return refused
    },
    createPlatformDb: () => {
      opened.clients.push("caller")
      return refused
    },
  }
})

const HOST = "demo.oto.test"
const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde"

/**
 * Un corps qui compte ce qu'on en lit : `size` octets par morceaux de 256 Kio. File d'attente de taille 0 : un flux
 * par défaut (taille 1) tire un morceau dès sa création, sans aucune lecture, et le compte mentirait.
 */
function countedBody(size: number): { stream: ReadableStream<Uint8Array>; read: () => number } {
  const chunk = 262_144
  let sent = 0
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (sent >= size) return controller.close()
        const length = Math.min(chunk, size - sent)
        sent += length
        controller.enqueue(new Uint8Array(length))
      },
    },
    { highWaterMark: 0 },
  )
  return { stream, read: () => sent }
}

/** Une requête `POST` sur la porte ; `body` : un flux lu à la demande, sans `Content-Length`. */
function post(path: string, init: { headers?: Record<string, string>; body?: ReadableStream<Uint8Array> | string } = {}): Request {
  // `duplex` n'est pas encore dans le type `RequestInit` de TypeScript, et Node l'exige pour un corps en flux.
  const options = { method: "POST", headers: init.headers, body: init.body, duplex: "half" } as RequestInit
  return new Request(`https://${HOST}/api/platform/${path}`, options)
}

async function answer(request: Request) {
  const verifyToken = vi.fn()
  const response = await handlePlateforme(request, { accessToken: null, host: HOST, verifyToken })
  return { status: response.status, body: await response.text(), headers: Object.fromEntries(response.headers), verified: verifyToken.mock.calls.length }
}

const lowered = Object.fromEntries(Object.entries(UPLOAD_HEADERS).map(([name, value]) => [name.toLowerCase(), value]))

describe("upload token (AC-f3)", () => {
  it("should draw 43 base64url characters and keep only their SHA-256 in hexadecimal", () => {
    const tokens = [newUploadToken(), newUploadToken()]
    expect(tokens.map((token) => UPLOAD_TOKEN_PATTERN.test(token))).toEqual([true, true])
    expect(tokens[0]).not.toBe(tokens[1])
    expect(uploadTokenHash(tokens[0])).toBe(createHash("sha256").update(tokens[0]).digest("hex"))
    expect(uploadTokenHash(tokens[0])).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe("commands given to the assistant (AC-f2)", () => {
  it("should quote a name with spaces, an apostrophe, a dollar and a backtick for bash and for PowerShell", () => {
    const url = `https://${HOST}/api/platform/uploads/${TOKEN}`
    expect(uploadCommands(url, "rapport d'avril $1 `x`.html")).toEqual({
      bash: `curl -sS --fail-with-body --data-binary @'rapport d'\\''avril $1 \`x\`.html' '${url}'`,
      powershell: `curl.exe -sS --fail-with-body --data-binary "@rapport d'avril \`$1 \`\`x\`\`.html" "${url}"`,
    })
    expect(uploadCommands(url, "<file>")).toEqual({
      bash: `curl -sS --fail-with-body --data-binary @'<file>' '${url}'`,
      powershell: `curl.exe -sS --fail-with-body --data-binary "@<file>" "${url}"`,
    })
  })
})

describe("upload.link arguments (AC-f1)", () => {
  const issues = (args: Record<string, unknown>) => {
    const parsed = uploadLinkSchema.safeParse(args)
    return parsed.success ? [] : parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
  }

  it("should tie the mode, name, key and publish to the kind, title and summary to create, base_revision to the other modes", () => {
    expect({
      csvReplace: issues({ path: "ventes/clients", kind: "csv", mode: "replace", base_revision: 1 }),
      fileWithoutName: issues({ path: "ventes/r", kind: "file", mode: "attach", base_revision: 1 }),
      createWithoutSummary: issues({ path: "ventes/r", kind: "md", mode: "create", title: "R" }),
      attachWithoutRevision: issues({ path: "ventes/r", kind: "file", mode: "attach", name: "r.pdf" }),
      createWithRevision: issues({ path: "ventes/r", kind: "md", mode: "create", title: "R", summary: "S.", base_revision: 0 }),
      keyOnMarkdown: issues({ path: "ventes/r", kind: "md", mode: "replace", base_revision: 1, key: "Nom" }),
      publishOnCsv: issues({ path: "ventes/c", kind: "csv", mode: "merge", base_revision: 1, publish: false }),
      unknownKey: issues({ path: "ventes/r", kind: "md", mode: "replace", base_revision: 1, bytes: 3 }).length > 0,
    }).toEqual({
      csvReplace: ["mode: mode replace does not apply to kind csv: create or merge"],
      fileWithoutName: ["name: name is required for kind file"],
      createWithoutSummary: ["summary: title and summary are required for mode create"],
      attachWithoutRevision: ["base_revision: base_revision is required for mode attach"],
      createWithRevision: ["base_revision: base_revision applies to attach, replace and merge only"],
      keyOnMarkdown: ["key: key applies to kind csv only"],
      publishOnCsv: ["publish: publish applies to kinds file and md only: a table is published by its import"],
      unknownKey: true,
    })
    expect(issues({ path: "ventes/r", kind: "file", mode: "create", name: "rapport.html", title: "Rapport", summary: "Le rapport." })).toEqual([])
  })
})

describe("door without session (AC-f4, AC-f11)", () => {
  beforeEach(() => {
    opened.clients.length = 0
  })

  it("should route uploads/<token> alone to the door, whatever its method, and POST uploads/<token>/form to the form route", () => {
    expect([
      isUploadRoute(["uploads", TOKEN]),
      isUploadRoute(["uploads", TOKEN, "form"]),
      isUploadRoute(["uploads"]),
      isUploadFormRoute(["uploads", TOKEN, "form"], "POST"),
      isUploadFormRoute(["uploads", TOKEN, "form"], "GET"),
      isUploadFormRoute(["uploads", TOKEN, "x"], "POST"),
    ]).toEqual([true, false, false, true, false, false])
  })

  it("should refuse another method than POST with forbidden, in plain text, before the token and the database: nothing consumed (FB-0014)", async () => {
    const refusals = await Promise.all(["GET", "PUT", "HEAD"].map((method) => answer(new Request(`https://${HOST}/api/platform/uploads/${TOKEN}`, { method }))))
    const forbidden = { status: 403, headers: lowered, verified: 0, body: "forbidden: Only POST is accepted here: send the file with curl --data-binary, or use the form link.\n" }
    expect(refusals).toEqual([forbidden, forbidden, forbidden])
    // Aucun client de base : le ticket, que seule la consommation sous `anon` sert, reste libre.
    expect(opened.clients).toEqual([])
  })

  it("should refuse any Origin, null or a third site, before the token, the body and the database (1)", async () => {
    const body = countedBody(10)
    const refusals = [
      await answer(post(`uploads/${TOKEN}`, { headers: { origin: "null" }, body: body.stream })),
      await answer(post("uploads/not-a-token", { headers: { origin: "https://example.invalid" }, body: "x" })),
    ]
    const expected = { status: 403, body: "forbidden: Requests from a browser are refused: send the file with curl, or use the form link.\n", headers: lowered, verified: 0 }
    expect(refusals).toEqual([expected, expected])
    expect({ read: body.read(), clients: opened.clients }).toEqual({ read: 0, clients: [] })
  })

  it("should answer not_found to a malformed token before the body and the database (2)", async () => {
    const body = countedBody(10)
    const refused = await answer(post(`uploads/${TOKEN}x`, { headers: { "content-length": String(UPLOAD_BYTES_MAX + 1) }, body: body.stream }))
    expect(refused).toEqual({
      status: 404,
      body: "not_found: Unknown upload link: it may have expired (15 minutes) or already been used. Ask for a new link.\n",
      headers: lowered,
      verified: 0,
    })
    expect({ read: body.read(), clients: opened.clients }).toEqual({ read: 0, clients: [] })
  })

  it("should refuse a Content-Length over 1 MB without reading the body (3), and cut a body without it at 1 MB (4)", async () => {
    const announced = countedBody(UPLOAD_BYTES_MAX + 1)
    const streamed = countedBody(4 * UPLOAD_BYTES_MAX)
    const refusals = [
      await answer(post(`uploads/${TOKEN}`, { headers: { "content-length": String(UPLOAD_BYTES_MAX + 1), "content-type": "application/x-www-form-urlencoded" }, body: announced.stream })),
      await answer(post(`uploads/${TOKEN}`, { body: streamed.stream })),
    ]
    const expected = { status: 413, body: "too_large: The file is over 1 MB (1048576 bytes): attach a larger file from the page itself.\n", headers: lowered, verified: 0 }
    expect(refusals).toEqual([expected, expected])
    expect({ announced: announced.read(), clients: opened.clients }).toEqual({ announced: 0, clients: [] })
    // La lecture s'arrête au premier morceau qui passe la borne : jamais les 4 Mo.
    expect(streamed.read()).toBeLessThanOrEqual(UPLOAD_BYTES_MAX + 262_144)
  })

  it("should answer 401 to the form route without a session, verifying no token and opening no client", async () => {
    const refused = await answer(post(`uploads/${TOKEN}/form`, { headers: { origin: `https://${HOST}` }, body: "x" }))
    expect({ status: refused.status, body: JSON.parse(refused.body), verified: refused.verified, clients: opened.clients }).toEqual({
      status: 401,
      body: { error: { code: "forbidden", message: "Authentication required." } },
      verified: 0,
      clients: [],
    })
  })
})

describe("source_url in the journal (AC-f14)", () => {
  const ADDRESS = "https://example.invalid/a.md"
  const logged = (keys: string[]) => Object.fromEntries(keys.map((key) => [key, loggedArgs({ function: "upload.link", arguments: { [key]: ADDRESS } })]))

  it("should mask source_url in each of its spellings", () => {
    const keys = ["source_url", "sourceUrl", "source-url"]
    expect(logged(keys)).toEqual(Object.fromEntries(keys.map((key) => [key, { function: "upload.link", arguments: { [key]: "[masked]" } }])))
  })

  it("should leave the neighbouring keys readable, the name being compared whole", () => {
    const keys = ["url", "source", "source_path", "resource_url", "resourceUrl", "datasource_url"]
    expect(logged(keys)).toEqual(Object.fromEntries(keys.map((key) => [key, { function: "upload.link", arguments: { [key]: ADDRESS } }])))
  })
})
