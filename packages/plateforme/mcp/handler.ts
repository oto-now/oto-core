// Porte HTTP du MCP (H06, H20) : `POST /api/mcp` de l'hôte délègue ici. Le jeton d'abord (401 et
// `WWW-Authenticate` vers les métadonnées de l'adresse appelée, jamais de mode anonyme) ; puis
// l'organisation par l'adresse et l'appartenance, relues à chaque requête (ADR-004) ; puis un
// serveur MCP construit pour cette requête, sans état (ADR-009). Le journal part après la réponse.
//
// Repris du banc E03 (`mcp-test/src/auth-test/http.ts` l. 98-156) : `withMcpAuth`, handler construit
// par requête, corps illisible refusé avant mcp-handler, 405. Retiré : l'organisation résolue
// avant le jeton par une clé de service (N1) et les lignes de refus au journal (N2, AC2).
import { createMcpHandler, getPublicOrigin, withMcpAuth } from "mcp-handler"
import { ensureZodMessages } from "../schemas/zod-messages"
import { servesCapability } from "../server/catalog/surface-source"
import { loadActiveConnectors } from "../server/connectors/activations"
import { createPlatformDb } from "../server/db"
import { isPlatformError } from "../server/errors"
import { requestHost, resolveIdentity, resolveOrg, servedHost, type IdentityOrg, type ServedHost } from "../server/identity"
import { initializeSignatures, writeJournal, type JournalEntry } from "../server/journal"
import { verifiedCaller, type VerifyToken } from "./auth"
import { installPlatformMcp, serverOptions, type McpDeps } from "./server"

/** Forme suffixée des métadonnées RFC 9728, celle que lisent les trois hosts (E02-S02 la sert). */
const RESOURCE_METADATA_PATH = "/.well-known/oauth-protected-resource/api/mcp"
const SERVICE_UNAVAILABLE = "Service unavailable. Retry in a moment."

/** Exécute une tâche après la réponse (`after` de `next/server` dans l'hôte). */
type Defer = (task: () => Promise<void>) => void

export type McpRequestFacts = {
  accessToken: string
  /** `extra` de l'`AuthInfo` rendu par `makeVerifyToken` : `sub`, `email` et `name` du jeton, son émetteur (`iss`, `issuer_kind`). */
  claims: Record<string, unknown> | undefined
  /** Hôte appelé, normalisé : il désigne l'organisation. */
  host: string | null
  /** Origine appelée, lue comme `withMcpAuth` la lit pour le 401 (`getPublicOrigin`) : lien d'un refus de `call` (E03-S04). */
  origin: string
  userAgent: string | null
}

export type ResolvedMcpRequest =
  | { kind: "member" | "not_member"; org: IdentityOrg; deps: McpDeps }
  | { kind: "unknown_org"; host: string | null; message: string }

export function rpcError(status: number, code: number, message: string): Response {
  return Response.json({ jsonrpc: "2.0", error: { code, message }, id: null }, { status })
}

/** GET et DELETE : ni flux SSE ni session (ADR-009). */
export function mcpMethodNotAllowed(): Response {
  return new Response(null, { status: 405, headers: { Allow: "POST" } })
}

/**
 * Organisation de l'adresse, personne et appartenance, au jeton de l'appelant (sous RLS). Sert
 * la route et les tests `InMemoryTransport`, qui câblent ainsi exactement comme la route. Lève
 * sur une base injoignable ou une erreur inattendue.
 */
export async function resolveMcpRequest(facts: McpRequestFacts): Promise<ResolvedMcpRequest> {
  // La base voit l'appelant du jeton (E01-S10), traduit par elle (E01-S11), jamais le repli d'affichage
  // du refus ci-dessous.
  const db = createPlatformDb({ caller: verifiedCaller(facts.claims) ?? undefined })
  const sub = String(facts.claims?.sub ?? "")
  const email = typeof facts.claims?.email === "string" ? facts.claims.email : ""
  // Le refus d'un non-membre le nomme par son email, sinon par son sujet (AC5, N19) ; l'identifiant
  // interne est celui de la session, traduit par la base.
  const caller = { email: email || `user ${sub}` }
  const journal: JournalEntry[] = []
  try {
    const identity = await resolveIdentity(db, facts.host, caller)
    // Lus au premier usage, gardés pour cette requête seule (N9, N27) : une activation vaut dès la
    // requête suivante, et une requête qui ne les lit pas (`initialize`, `prompts/*`, un appel
    // d'outil qui n'en a pas besoin) ne les paie pas.
    let active: Promise<ReadonlySet<string>> | undefined
    const activeConnectors = () => (active ??= loadActiveConnectors(db, identity.org.id))
    // `accessToken` : le jeton vérifié de la requête, sous lequel s'exécutent les fonctions ERP (E08-S05, NH4).
    const deps: McpDeps = { db, org: identity.org, caller: { kind: "member", identity }, userAgent: facts.userAgent, journal, activeConnectors, origin: facts.origin, accessToken: facts.accessToken }
    return { kind: "member", org: identity.org, deps }
  } catch (error) {
    if (!isPlatformError(error)) throw error
    if (error.code === "unknown_org") return { kind: "unknown_org", host: facts.host, message: error.message }
    // Le plafond de membres atteint à l'entrée sans invitation (`enterOrg`) : un refus d'appartenance qui dit sa raison.
    const atLimit = error.code === "forbidden" && error.details?.reason === "limit"
    if (error.code !== "not_member" && !atLimit) throw error
    const org = await resolveOrg(db, facts.host)
    // Un non-membre ne lit pas les activations (RLS) : sa liste d'outils n'a pas d'exemples de connecteur.
    const none = () => Promise.resolve(new Set<string>())
    const deps: McpDeps = { db, org, caller: { kind: "not_member", refusal: error.message }, userAgent: facts.userAgent, journal, activeConnectors: none, origin: facts.origin }
    return { kind: "not_member", org, deps }
  }
}

function isJson(body: string): boolean {
  try {
    JSON.parse(body)
    return true
  } catch {
    // Illisible : la porte répond l'erreur JSON-RPC elle-même.
    return false
  }
}

/** Lignes `initialize` d'un membre (H29) : aucun handler du SDK ne les voit passer. */
function initializeEntries(deps: McpDeps, body: string): JournalEntry[] {
  if (deps.caller.kind !== "member") return []
  const { identity } = deps.caller
  return initializeSignatures(body).map((host) => ({
    org_id: identity.org.id,
    user_id: identity.user.id,
    method: "initialize",
    host,
    user_agent: deps.userAgent,
  }))
}

type RequestContext = { body: string; host: string | null; chooseHost?: ServedHost; origin: string; userAgent: string | null; defer: Defer; widgets: boolean }

async function serveAuthenticated(request: Request, context: RequestContext): Promise<Response> {
  // mcp-handler lit le corps sans attendre son échec : il ne répondrait jamais (banc E03).
  if (!isJson(context.body)) return rpcError(400, -32700, "Parse error")
  const auth = request.auth
  // Impossible derrière `withMcpAuth` (`required`) : gardé pour que le type ne mente pas.
  if (!auth) return rpcError(401, -32001, "Authentication required.")

  let resolved: ResolvedMcpRequest
  try {
    // L'adresse que l'hôte choisit ne se lit qu'après le jeton (E03-S01 N1) ; sa panne ne sert aucune organisation par défaut.
    const host = await servedHost(context.chooseHost, { host: context.host, request })
    resolved = await resolveMcpRequest({ accessToken: auth.token, claims: auth.extra, host, origin: context.origin, userAgent: context.userAgent })
  } catch (error) {
    console.error("[platform] mcp: organisation or membership unavailable", error)
    return rpcError(503, -32603, SERVICE_UNAVAILABLE)
  }
  if (resolved.kind === "unknown_org") return rpcError(404, -32001, resolved.message)

  // Le widget tient par les ressources MCP : un hôte qui ne les sert pas (`registerHostSurface`) sert le texte seul.
  const widgets = Boolean(context.widgets) && servesCapability("resources")
  const deps: McpDeps = { ...resolved.deps, widgets }
  const mcp = createMcpHandler((server) => installPlatformMcp(server, deps), serverOptions(resolved.org, { widgets }), {
    basePath: "/api", // → /api/mcp
    maxDuration: 60,
    disableSse: true,
  })
  const response = await mcp(request)
  // Refus du transport (406, 415, version de protocole) : rien n'a été servi, aucun `initialize`.
  if (response.status < 400) deps.journal.push(...initializeEntries(deps, context.body))
  // Les outils écrivent encore pendant le flux de la réponse : le journal part après elle (AC17).
  if (deps.caller.kind === "member") context.defer(() => writeJournal(deps.db, deps.journal))
  return response
}

/**
 * `POST /api/mcp`. `verifyToken` : `makeVerifyToken()` de `./auth` ; `defer` : `after` de Next ; `widgets` : le
 * widget routeur sur `call` et `read` (éteint par défaut : texte seul, story widgets-dans-la-conversation) ; `host` :
 * l'adresse à servir, choisie par l'hôte (`ServedHost`), à défaut l'adresse appelée ; l'origine du 401 et des liens reste
 * celle de la requête.
 * Sans jeton valide : 401 ; adresse sans organisation : 404 ; base injoignable : 503.
 */
export async function handleMcpPost(request: Request, options: { verifyToken: VerifyToken; defer: Defer; widgets?: boolean; host?: ServedHost }): Promise<Response> {
  // Avant toute validation : chez un hôte empaqueté, Zod n'a pas ses messages (`schemas/zod-messages.ts`).
  ensureZodMessages()
  const context: RequestContext = {
    body: await request.clone().text(),
    host: requestHost(request.headers),
    chooseHost: options.host,
    origin: getPublicOrigin(request),
    userAgent: request.headers.get("user-agent"),
    defer: options.defer,
    widgets: options.widgets === true,
  }
  const authenticated = withMcpAuth((authorized) => serveAuthenticated(authorized, context), options.verifyToken, {
    required: true,
    resourceMetadataPath: RESOURCE_METADATA_PATH,
  })
  return authenticated(request)
}
