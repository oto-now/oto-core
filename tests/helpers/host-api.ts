// Un faux émetteur et un faux hôte en local, pour les fonctions d'un hôte (`docs/conception/fonctions-d-un-hote.md`) :
// un serveur HTTP sur 127.0.0.1 sert la découverte et le point de jeton de l'émetteur (`https://auth.example.test/oidc`),
// le document OpenAPI et l'API de l'hôte (`https://hote.example.test`). Le poste n'ayant pas d'hôte public, le transport
// gardé et `fetch` sont réécrits vers lui par la suite qui l'emploie (`vi.mock` d'`address-guard`, `routeFetch`) ; une
// autre adresse passe par le vrai transport gardé, qui la refuse. Ce que le serveur a reçu se relit dans `seen`.
import { createServer, type IncomingMessage, type Server } from "node:http"
import type { AddressInfo } from "node:net"

export const ISSUER = "https://auth.example.test/oidc"
export const HOST = "https://hote.example.test"
export const RESOURCE = "https://hote.example.test/api"
export const EXCHANGE_ENV = { PLATFORM_OIDC_EXCHANGE_CLIENT_ID: "oto-m2m", PLATFORM_OIDC_EXCHANGE_CLIENT_SECRET: "m2m-secret-not-in-logs" }

/** Le document d'un hôte accepté par le profil : une lecture et une écriture sensible confirmée par l'hôte. */
export function hostDocument(version = "1.0.0", extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: { title: "Hote Test", version },
    servers: [{ url: "/api/v2" }],
    "x-oto": {
      functions: "/me/functions",
      issuer: ISSUER,
      resource: RESOURCE,
      roles: { member: "Member" },
      families: { projet: "Projects", etape: "Steps" },
    },
    paths: {
      "/projets": {
        get: {
          operationId: "projet.lister",
          summary: "List the projects",
          description: "Lists the projects of the person.",
          "x-oto-class": "read",
          "x-oto-roles": ["member"],
          "x-oto-label": "Lister les projets",
          "x-oto-family": "projet",
          "x-oto-examples": [{}],
          "x-oto-output": { items: "items" },
          responses: { "200": { description: "The projects", content: { "application/json": { schema: { type: "object" } } } } },
        },
      },
      "/projets/{id}/archive": {
        post: {
          operationId: "projet.archiver",
          summary: "Archive a project",
          description: "Archives one project of the person.",
          "x-oto-class": "sensitive",
          "x-oto-roles": ["member"],
          "x-oto-label": "Archiver un projet",
          "x-oto-family": "projet",
          "x-oto-examples": [{ id: 7 }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "integer" } },
            { name: "confirm", in: "query", required: false, schema: { type: "boolean" } },
          ],
          responses: {
            "200": { description: "Archived", content: { "application/json": { schema: { type: "object" } } } },
            "202": { description: "Needs confirmation", content: { "application/json": { schema: { type: "object" } } } },
          },
        },
      },
    },
    ...extra,
  }
}

/** Ce que le faux serveur a reçu : chaque requête, ses en-têtes et son corps. */
export type Seen = { method: string; path: string; headers: Record<string, string | string[] | undefined>; body: string }

/** L'état réglable du faux serveur. */
export type FakeState = {
  document: unknown
  etag: string | null
  documentStatus: number | null
  documentRaw: string | null
  exchangeError: string | null
  exchanged: number
  problem: { status: number; body: Record<string, unknown> } | null
  firstStep: "202" | "200"
}

export type FakeHost = { local: string; state: FakeState; seen: Seen[]; reset(): void; close(): Promise<void> }

const freshState = (): FakeState => ({
  document: hostDocument(),
  etag: '"v1"',
  documentStatus: null,
  documentRaw: null,
  exchangeError: null,
  exchanged: 0,
  problem: null,
  firstStep: "202",
})

function bodyOf(request: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    request.on("data", (chunk: Buffer) => chunks.push(chunk))
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
  })
}

/** Démarre le faux émetteur et le faux hôte. */
export async function startFakeHost(): Promise<FakeHost> {
  const seen: Seen[] = []
  const state = freshState()
  const server: Server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://local")
    const body = await bodyOf(request)
    seen.push({ method: request.method ?? "GET", path: `${url.pathname}${url.search}`, headers: request.headers, body })
    const json = (status: number, value: unknown, headers: Record<string, string> = {}) => {
      response.writeHead(status, { "content-type": "application/json", ...headers })
      response.end(JSON.stringify(value))
    }
    if (url.pathname === "/oidc/.well-known/openid-configuration") {
      return json(200, { issuer: ISSUER, jwks_uri: `${ISSUER}/jwks`, token_endpoint: `${ISSUER}/token` })
    }
    if (url.pathname === "/oidc/token" && request.method === "POST") {
      if (state.exchangeError) return json(400, { error: state.exchangeError, error_description: "subject token not delegable" })
      state.exchanged += 1
      return json(200, { access_token: `exchanged-token-${state.exchanged}`, token_type: "Bearer", expires_in: 3600 })
    }
    if (url.pathname === "/openapi.json") {
      if (state.documentStatus) {
        response.writeHead(state.documentStatus, state.documentStatus === 302 ? { location: "https://ailleurs.example.test/openapi.json" } : {})
        return response.end()
      }
      if (state.etag && request.headers["if-none-match"] === state.etag) {
        response.writeHead(304)
        return response.end()
      }
      response.writeHead(200, { "content-type": "application/json", ...(state.etag ? { etag: state.etag } : {}) })
      return response.end(state.documentRaw ?? JSON.stringify(state.document))
    }
    if (state.problem && url.pathname.startsWith("/api/v2/")) {
      response.writeHead(state.problem.status, { "content-type": "application/problem+json" })
      return response.end(JSON.stringify(state.problem.body))
    }
    if (url.pathname === "/api/v2/projets" && request.method === "GET") return json(200, { items: [{ id: 7, name: "Alpha" }] })
    const archive = /^\/api\/v2\/projets\/(\d+)\/archive$/.exec(url.pathname)
    if (archive && request.method === "POST") {
      if (url.searchParams.get("confirm") === "true") return json(200, { archived: Number(archive[1]) })
      if (state.firstStep === "200") return json(200, { archived: Number(archive[1]) })
      return json(202, { status: "needs_confirmation", summary: `Archive project Alpha (#${archive[1]}) and its 3 steps.` })
    }
    response.writeHead(404)
    response.end()
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const local = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return {
    local,
    state,
    seen,
    reset() {
      Object.assign(state, freshState())
      seen.length = 0
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

/** `fetch` réécrit : l'émetteur vers le serveur local ; toute autre adresse lève (rien ne sort du poste). */
export function routeFetch(local: () => string, real: typeof fetch): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    if (!url.startsWith("https://auth.example.test/")) throw new Error(`unexpected address in the test: ${url.split("?")[0]}`)
    return real(url.replace("https://auth.example.test", local()), init)
  }) as typeof fetch
}
