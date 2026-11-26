// @vitest-environment node
// Les fonctions d'un hôte sans base (`docs/conception/fonctions-d-un-hote.md`) : le document lu par le transport gardé et
// jugé par le profil hôte, le scope de chaque fonction et la famille sans scope refusée, l'échange de jeton (succès,
// cache, refus qui ne désignent pas un client tiers, jeton échu), le jeton de la personne jamais transmis à
// l'hôte, les en-têtes `Oto-*`, les deux temps tenus par l'hôte et leur rupture, les refus `problem+json`. Un faux
// émetteur et un faux hôte en local (`tests/helpers/host-api.ts`).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { checkArguments } from "../../packages/plateforme/server/catalog/arguments"
import type { CatalogFunction, FunctionContext } from "../../packages/plateforme/server/catalog/define"
import type { Fetch } from "../../packages/plateforme/server/connectors/http"
import { importHostDocument, readHostDocument, type ImportedHost } from "../../packages/plateforme/server/host-api/document"
import { forgetExchangedTokens } from "../../packages/plateforme/server/host-api/exchange"
import { hostCatalogFunctions } from "../../packages/plateforme/server/host-api/functions"
import { hostProblems } from "../../packages/plateforme/server/host-api/problem-json"
import { reservedNamespaces } from "../../packages/plateforme/server/host-api/served"
import { EXCHANGE_ENV, HOST, hostDocument, ISSUER, routeFetch, startFakeHost, unsignedJwt, type FakeHost } from "../helpers/host-api"

const route = vi.hoisted(() => ({ local: "", realFetch: globalThis.fetch.bind(globalThis) }))

/** Le transport gardé vers le faux hôte ; toute autre adresse par le vrai transport gardé, qui la juge. */
vi.mock("../../packages/plateforme/server/connectors/address-guard", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../packages/plateforme/server/connectors/address-guard")>()
  return {
    ...original,
    guardedFetch: (): Fetch => (input, init) =>
      // Comme le transport gardé, une redirection est rendue telle quelle, jamais suivie.
      input.startsWith("https://hote.example.test/")
        ? route.realFetch(input.replace("https://hote.example.test", route.local), { ...init, redirect: "manual" })
        : original.guardedFetch()(input, init),
  }
})

const SUBJECT = "subject-token-of-the-person-never-sent-to-the-host"
const ORG = "0b9a3c2e-4f51-4d6e-9a1b-2c3d4e5f6a7b"

let fake: FakeHost

beforeAll(async () => {
  fake = await startFakeHost()
  route.local = fake.local
})

afterAll(async () => {
  await fake?.close()
})

beforeEach(() => {
  fake.reset()
  forgetExchangedTokens()
  vi.stubEnv("PLATFORM_OIDC_ISSUER", ISSUER)
  vi.stubEnv("PLATFORM_OIDC_AUDIENCE", "https://oto.example.test/api/mcp")
  for (const [name, value] of Object.entries(EXCHANGE_ENV)) vi.stubEnv(name, value)
  vi.stubGlobal("fetch", routeFetch(() => fake.local, route.realFetch))
  vi.spyOn(console, "error").mockImplementation(() => undefined)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function imported(document: unknown = hostDocument()): ImportedHost {
  const result = importHostDocument(document, ["table", "node"])
  if ("problems" in result) throw new Error(`document refused: ${JSON.stringify(result.problems)}`)
  return result.imported
}

const context = (overrides: Partial<FunctionContext> = {}): FunctionContext =>
  ({
    db: {} as never,
    identity: { org: { id: ORG, slug: "acme", prefix: "acme", name: "Acme" }, user: { id: "user-1", email: "lea@example.test", name: "Léa" } },
    accessToken: SUBJECT,
    ctx: "7K3Q-M2XA",
    host: "claude-ai@0.1.0",
    ...overrides,
  }) as unknown as FunctionContext

function fn(name: string): CatalogFunction {
  const found = hostCatalogFunctions(imported(), HOST).find((candidate) => candidate.name === name)
  if (!found) throw new Error(`no function ${name}`)
  return found
}

function args(target: CatalogFunction, given: Record<string, unknown>): never {
  const checked = checkArguments(target.schema, given)
  if (!checked.success) throw new Error(`invalid arguments: ${JSON.stringify(checked.issues)}`)
  return checked.data as never
}

const failure = (run: Promise<unknown>) =>
  run.then(
    () => null,
    (error: { code?: string; message?: string; details?: Record<string, unknown> }) => ({ code: error.code, message: error.message, details: error.details }),
  )

const toHost = () => fake.seen.filter((request) => request.path.startsWith("/api/v2/"))
const toIssuer = () => fake.seen.filter((request) => request.path === "/oidc/token")

describe("host API document", () => {
  it("should read the document at <address>/openapi.json with its ETag, then answer not modified for the same ETag", async () => {
    const read = await readHostDocument(HOST, null)
    expect(read).toEqual({ kind: "document", document: hostDocument(), etag: '"v1"' })
    expect(await readHostDocument(HOST, '"v1"')).toEqual({ kind: "not_modified" })
    expect(fake.seen.map((request) => request.headers["if-none-match"] ?? null)).toEqual([null, '"v1"'])
  })

  it("should refuse a redirection, a status, a document that is not JSON or too large, with named problems", async () => {
    fake.state.documentStatus = 302
    expect(await readHostDocument(HOST, null)).toMatchObject({ kind: "refused", problems: [{ code: "host_document_status" }] })
    fake.state.documentStatus = null
    fake.state.documentRaw = "<html>"
    expect(await readHostDocument(HOST, null)).toMatchObject({ kind: "refused", problems: [{ code: "host_document_not_json" }] })
    fake.state.documentRaw = `"${"x".repeat(5 * 1024 * 1024)}"`
    expect(await readHostDocument(HOST, null)).toMatchObject({ kind: "refused", problems: [{ code: "host_document_too_large" }] })
  })

  it("should refuse an address the guarded transport refuses: an internal IP, or http", async () => {
    expect(await readHostDocument("https://127.0.0.1", null)).toMatchObject({ kind: "refused", problems: [{ code: "host_address_refused" }] })
    expect(await readHostDocument("http://hote.example.test", null)).toMatchObject({ kind: "refused", problems: [{ code: "host_address_refused" }] })
  })

  it("should import an accepted document: its title, version, the scope of each function, the scopes to consent, its functions", () => {
    const host = imported()
    expect({ title: host.title, version: host.version, scopes: Object.fromEntries(host.scopes), consent: host.consentScopes }).toEqual({
      title: "Hote Test",
      version: "1.0.0",
      scopes: { "projet.lister": "projets", "projet.archiver": "projets" },
      // La famille etape n'a pas de fonction : son scope ne se demande pas.
      consent: ["projets"],
    })
    expect(hostCatalogFunctions(host, HOST).map((item) => [item.name, item.class, item.origin])).toEqual([
      ["projet.lister", "read", "erp"],
      ["projet_act.archiver", "sensitive", "erp"],
    ])
  })

  it("should refuse a family without a scope, naming each of its functions, never guessing a scope", () => {
    const document = hostDocument()
    ;(document["x-oto"] as { families: Record<string, unknown> }).families.projet = "Projects"
    const refused = importHostDocument(document, [])
    expect(refused).toEqual({
      problems: [
        { code: "host_scope_missing", path: "x-oto.families.projet", message: "projet.lister: its family projet has no OAuth scope; write it as {label, scope}" },
        { code: "host_scope_missing", path: "x-oto.families.projet", message: "projet.archiver: its family projet has no OAuth scope; write it as {label, scope}" },
      ],
    })
  })

  it("should reserve the connector of the consents to a host's API: no namespace of a host takes it", () => {
    expect(reservedNamespaces().has("host_api")).toBe(true)
    const document = hostDocument() as { paths: Record<string, Record<string, Record<string, unknown>>> }
    document.paths["/projets"].get.operationId = "host_api.lister"
    const refused = importHostDocument(document, reservedNamespaces())
    expect("problems" in refused && refused.problems.map((problem) => problem.code)).toContain("host_namespace_reserved")
  })

  it("should refuse a document whose namespace is served by the instance, or whose issuer is not the instance's", () => {
    const reserved = importHostDocument(hostDocument(), ["projet"])
    expect("problems" in reserved && [...new Set(reserved.problems.map((problem) => problem.code))]).toEqual(["host_namespace_reserved"])
    vi.stubEnv("PLATFORM_OIDC_ISSUER", "https://autre.example.test/oidc")
    expect(importHostDocument(hostDocument(), [])).toMatchObject({ problems: [{ code: "host_issuer_not_instance", path: "x-oto.issuer" }] })
  })

  it.each([
    ["a userinfo", "https://user@hote.example.test/api"],
    ["a query", "https://hote.example.test/api?tenant=acme"],
    ["a fragment", "https://hote.example.test/api#v2"],
    ["a template", "https://{tenant}.example.test/api"],
    ["a plain http address", "http://hote.example.test/api"],
    ["a URN", "urn:hote:api"],
  ])("should refuse at import a resource indicator with %s, set as is at the consent, by name", (_case, resource) => {
    const document = hostDocument() as { "x-oto": Record<string, unknown> }
    document["x-oto"].resource = resource
    const refused = importHostDocument(document, [])
    expect(refused).toEqual({
      problems: [
        {
          code: "host_resource_invalid",
          path: "x-oto.resource",
          message: "resource must be a fixed https:// address, a host and a path only: no userinfo, query, fragment, template, space or backslash.",
        },
      ],
    })
  })
})

describe("host API functions", () => {
  it("should call the host with the exchanged token, never the person's, and the Oto headers", async () => {
    const lister = fn("projet.lister")
    const output = await lister.run(context(), args(lister, {}))

    expect(output.data).toMatchObject({ items: [{ id: 7, name: "Alpha" }] })
    const [sent] = toHost()
    expect(sent.path).toBe("/api/v2/projets")
    expect(sent.headers.authorization).toBe("Bearer exchanged-token-1")
    expect({ ctx: sent.headers["oto-ctx"], client: sent.headers["oto-client"], org: sent.headers["oto-org"] }).toEqual({ ctx: "7K3Q-M2XA", client: "Claude", org: ORG })
    // Le jeton de la personne ne part qu'à l'émetteur, jamais à l'hôte.
    expect(JSON.stringify(toHost())).not.toContain(SUBJECT)

    const [exchange] = toIssuer()
    const form = Object.fromEntries(new URLSearchParams(exchange.body))
    expect(form).toEqual({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      subject_token: SUBJECT,
      subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
      resource: "https://hote.example.test/api",
      scope: "projets",
    })
    expect(exchange.headers.authorization).toBe(`Basic ${Buffer.from("oto-m2m:m2m-secret-not-in-logs").toString("base64")}`)
  })

  it("should keep the exchanged token for the same person and scope, and exchange again for another person", async () => {
    const lister = fn("projet.lister")
    await lister.run(context(), args(lister, {}))
    await lister.run(context(), args(lister, {}))
    expect(fake.state.exchanged).toBe(1)
    await lister.run(context({ identity: { org: { id: ORG }, user: { id: "user-2" } } as never }), args(lister, {}))
    expect(fake.state.exchanged).toBe(2)
  })

  it("should never take another refusal of the exchange for a third-party client: no consent, nothing called at the host", async () => {
    const lister = fn("projet.lister")
    for (const refusal of [
      { error: "invalid_grant", description: "subject token is expired" },
      { error: "unauthorized_client", description: "token exchange is not allowed for this application" },
      { error: "invalid_target", description: "resource indicator is missing, or unknown" },
    ]) {
      fake.state.exchangeRefusal = refusal
      const refused = await failure(lister.run(context(), args(lister, {})))
      expect(refused).toMatchObject({ code: "upstream_error", message: expect.stringContaining(`The issuer refused to delegate your session to Hote Test (HTTP 400, ${refusal.error})`) })
    }
    expect(toHost()).toEqual([])
    expect(fake.seen.filter((request) => request.path.startsWith("/oidc/auth"))).toEqual([])
  })

  it("should refuse an expired token of the caller before any exchange, the issuer would refuse it as a third party's", async () => {
    const lister = fn("projet.lister")
    const expired = unsignedJwt({ sub: "sub-lea", client_id: "first-party", exp: Math.floor(Date.now() / 1000) - 5 })
    expect(await failure(lister.run(context({ accessToken: expired }), args(lister, {})))).toMatchObject({ code: "unauthorized" })
    expect(toIssuer()).toEqual([])
  })

  it("should ask the scope of the function called, one exchanged token serving the functions of a same scope", async () => {
    const lister = fn("projet.lister")
    await lister.run(context(), args(lister, {}))
    const archiver = fn("projet_act.archiver")
    await archiver.summarize?.(context(), args(archiver, { id: 7 }))
    expect(toIssuer().map((request) => new URLSearchParams(request.body).get("scope"))).toEqual(["projets"])
  })

  it("should refuse without the M2M client, naming the variable in the log only", async () => {
    vi.stubEnv("PLATFORM_OIDC_EXCHANGE_CLIENT_SECRET", "")
    const lister = fn("projet.lister")
    expect(await failure(lister.run(context(), args(lister, {})))).toMatchObject({ code: "internal" })
    expect(String(vi.mocked(console.error).mock.calls.flat().join(" "))).toContain("PLATFORM_OIDC_EXCHANGE_CLIENT_SECRET missing")
  })

  it("should relay the host's summary on the first step, then send confirm=true on the second", async () => {
    const archiver = fn("projet_act.archiver")
    const summary = await archiver.summarize?.(context(), args(archiver, { id: 7 }))
    expect(summary?.text).toBe("Archive project Alpha (#7) and its 3 steps.")
    expect(toHost().map((request) => request.path)).toEqual(["/api/v2/projets/7/archive"])

    const output = await archiver.run(context(), args(archiver, { id: 7 }))
    expect(output.data).toEqual({ archived: 7 })
    expect(toHost().map((request) => request.path)).toEqual(["/api/v2/projets/7/archive", "/api/v2/projets/7/archive?confirm=true"])
  })

  it("should refuse a first step answered without confirmation, without saying nothing was done", async () => {
    fake.state.firstStep = "200"
    const archiver = fn("projet_act.archiver")
    const refused = await failure(archiver.summarize?.(context(), args(archiver, { id: 7 })) ?? Promise.resolve())
    expect(refused).toMatchObject({ code: "upstream_error", details: { reason: "host_confirmation_broken" } })
    expect(refused?.message).toContain("it may have carried out the action")
    expect(refused?.message).not.toMatch(/nothing (was|has been)/i)
  })

  it("should turn a problem+json of the host into a platform error, its detail as message and its code as refusal", async () => {
    fake.state.problem = { status: 422, body: { type: "about:blank", title: "Invalid", detail: "Accept the terms of use first.", code: "cgu_required" } }
    const lister = fn("projet.lister")
    expect(await failure(lister.run(context(), args(lister, {})))).toEqual({
      code: "invalid_arguments",
      message: "Accept the terms of use first.",
      details: { refusal: "cgu_required" },
    })
    fake.state.problem = { status: 401, body: { title: "Expired" } }
    expect(await failure(lister.run(context(), args(lister, {})))).toMatchObject({ code: "unauthorized", message: expect.stringContaining("Sign in again") })
  })
})

describe("host problems", () => {
  const translate = hostProblems("Hote Test")

  it("should map each status to its code, bound the message to 500 characters, and fall back on the title", () => {
    const codes = [400, 403, 404, 409, 413, 422, 429, 500, 503].map((status) => translate(status, { title: "T" }).code)
    expect(codes).toEqual(["invalid_arguments", "forbidden", "not_found", "conflict", "too_large", "invalid_arguments", "rate_limited", "upstream_error", "upstream_error"])
    expect(translate(403, { title: "Not yours" }).message).toBe("Not yours")
    expect(translate(403, { detail: "x".repeat(800) }).message).toHaveLength(500)
    expect(translate(500, null).message).toBe("Hote Test refused the call (HTTP 500).")
  })
})
