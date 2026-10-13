// Porte HTTP du MCP admin (E08-S02, H105) : `POST /api/mcp-admin` de l'hôte délègue ici. Même forme
// que celle des six outils (`../handler.ts`) : le jeton d'abord (401 et `WWW-Authenticate` vers les
// métadonnées suffixées `…/api/mcp-admin`), puis l'équipe plateforme, relue à chaque requête : hors
// d'elle, 401 sans métadonnées et rien d'annoncé (AC2, N2) ; puis un serveur construit pour la
// requête, sans état (ADR-009). Le journal à part part après la réponse.
//
// Repris du banc E03 (`mcp-test/src/auth-test/http.ts` l. 111-155) : `withMcpAuth`, `resourceMetadataPath`
// suffixé, 401 sans motif au client ; (`src/app/api/proto/u/[user]/[transport]/route.ts` l. 49-59) :
// handler par requête, `disableSse`, journal dans `after()` ; retiré : l'identité par segment d'URL.
import { createMcpHandler, withMcpAuth } from "mcp-handler"
import { ensureZodMessages } from "../../schemas/zod-messages"
import { adminJournalEntry, flushAdminJournal, requireStaff, type AdminJournalEntry } from "../../server/admin/context"
import type { OrgCreationHook } from "../../server/admin/org-creation"
import { createPlatformDb } from "../../server/db"
import { isPlatformError } from "../../server/errors"
import { rawRequestHost, requestOrigin } from "../../server/identity"
import { initializeSignatures } from "../../server/journal"
import { MCP_ADMIN_RESOURCE_PATH } from "../../server/oauth"
import { verifiedCaller, type VerifyToken } from "../auth"
import { rpcError } from "../handler"
import { buildAdminServerOptions, installAdmin, type AdminMcpDeps } from "./server"

const RESOURCE_METADATA_PATH = `/.well-known/oauth-protected-resource${MCP_ADMIN_RESOURCE_PATH}`
const SERVICE_UNAVAILABLE = "Service unavailable. Retry in a moment."

/** Exécute une tâche après la réponse (`after` de `next/server` dans l'hôte). */
type Defer = (task: () => Promise<void>) => void

export type AdminRequestFacts = {
  accessToken: string
  /** `extra` de l'`AuthInfo` rendu par `makeVerifyToken` : `sub`, `email` et `name` du jeton. */
  claims: Record<string, unknown> | undefined
  userAgent: string | null
  /** L'origine appelée (`calledOrigin`) : le lien d'une invitation envoyée par `admin_org` en reprend protocole et port. */
  origin: string
}

/**
 * La requête d'un membre de l'équipe plateforme (AC2) : client au jeton de l'appelant, puis
 * `requireStaff`, qui lève `forbidden` hors de l'équipe et lit l'identifiant interne dans la session
 * (le sujet d'un émetteur OIDC n'en est pas un, E01-S11). Sert la route et les tests `InMemoryTransport`,
 * qui câblent ainsi exactement comme elle.
 */
export async function openAdminRequest(facts: AdminRequestFacts): Promise<AdminMcpDeps> {
  const db = createPlatformDb({ caller: verifiedCaller(facts.claims) ?? undefined })
  const email = typeof facts.claims?.email === "string" ? facts.claims.email : ""
  const caller = await requireStaff(db, { email })
  return { db, caller, origin: facts.origin, userAgent: facts.userAgent, journal: [] }
}

/** L'origine du MCP admin telle que le navigateur ou l'assistant l'a appelée, derrière un proxy compris (`requestOrigin`). */
export function calledOrigin(request: Request): string {
  const url = new URL(request.url)
  return requestOrigin(request.headers, rawRequestHost(request.headers) ?? url.host, url.protocol.replace(/:$/, ""))
}

/** Hors de l'équipe plateforme : 401 sans `resource_metadata`, corps JSON-RPC fixe (AC2, N2). */
function outsideStaff(): Response {
  // Aucun identifiant ni argument au log : la trace d'un refus n'est pas une donnée (N15).
  console.warn("[platform] mcp-admin: caller outside the platform team refused")
  const response = rpcError(401, -32001, "Unauthorized")
  response.headers.set("WWW-Authenticate", 'Bearer error="invalid_token"')
  return response
}

function parses(body: string): boolean {
  try {
    JSON.parse(body)
    return true
  } catch {
    // Illisible : la porte répond l'erreur JSON-RPC elle-même (mcp-handler ne répondrait jamais).
    return false
  }
}

/** Lignes `initialize` de la requête (H29) : aucun handler du SDK ne les voit passer. */
function initializeEntries(deps: AdminMcpDeps, body: string): AdminJournalEntry[] {
  return initializeSignatures(body).map((host) => ({ ...adminJournalEntry(deps.caller, { method: "initialize", userAgent: deps.userAgent }), host }))
}

type RequestContext = { body: string; userAgent: string | null; defer: Defer; orgCreation: OrgCreationHook | undefined }

async function serveAdmin(request: Request, context: RequestContext): Promise<Response> {
  if (!parses(context.body)) return rpcError(400, -32700, "Parse error")
  const auth = request.auth
  // Impossible derrière `withMcpAuth` (`required`) : gardé pour que le type ne mente pas.
  if (!auth) return rpcError(401, -32001, "Authentication required.")

  let deps: AdminMcpDeps
  try {
    const opened = await openAdminRequest({ accessToken: auth.token, claims: auth.extra, userAgent: context.userAgent, origin: calledOrigin(request) })
    deps = { ...opened, orgCreation: context.orgCreation }
  } catch (error) {
    if (isPlatformError(error) && error.code === "forbidden") return outsideStaff()
    console.error("[platform] mcp-admin: platform team unavailable", error)
    return rpcError(503, -32603, SERVICE_UNAVAILABLE)
  }
  // `streamableHttpEndpoint` explicite : `basePath` ferait servir `…/mcp` (mcp-handler 1.1.0).
  const mcp = createMcpHandler((server) => installAdmin(server, deps), buildAdminServerOptions(), {
    streamableHttpEndpoint: MCP_ADMIN_RESOURCE_PATH,
    maxDuration: 60,
    disableSse: true,
  })
  const response = await mcp(request)
  // Refus du transport (406, 415, version de protocole) : rien n'a été servi, aucun `initialize`.
  if (response.status < 400) deps.journal.push(...initializeEntries(deps, context.body))
  // Les outils écrivent encore pendant le flux de la réponse : le journal part après elle.
  context.defer(() => flushAdminJournal(deps.db, deps.caller, deps.journal))
  return response
}

/**
 * `POST /api/mcp-admin`. `verifyToken` : `makeVerifyToken()` de `../auth` ; `defer` : `after` de Next ;
 * `orgCreation` : le point de création de l'hôte (E09-S02), à relire à chaque requête, absent chez un ERP.
 * Sans jeton valide : 401 avec métadonnées ; hors de l'équipe plateforme : 401 sans ; base injoignable : 503.
 */
export async function handleAdminMcp(
  request: Request,
  options: { verifyToken: VerifyToken; defer: Defer; orgCreation?: OrgCreationHook },
): Promise<Response> {
  // Avant toute validation : chez un hôte empaqueté, Zod n'a pas ses messages (`schemas/zod-messages.ts`).
  ensureZodMessages()
  const context: RequestContext = {
    body: await request.clone().text(),
    userAgent: request.headers.get("user-agent"),
    defer: options.defer,
    orgCreation: options.orgCreation,
  }
  const authenticated = withMcpAuth((authorized) => serveAdmin(authorized, context), options.verifyToken, {
    required: true,
    resourceMetadataPath: RESOURCE_METADATA_PATH,
  })
  return authenticated(request)
}
