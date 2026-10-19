// Porte HTTP du paquet : `/api/platform/<ressource>[/<paramètres>]` (H03, H06). La route de
// l'hôte délègue ici avec le jeton de sa session ; chaque ressource délègue à ses services.
// Réponses `{ data }` ou `{ error: { code, message, details? } }`, au statut de `HTTP_STATUS`
// (H04). Une ligne de journal par mutation, écrite après la réponse (H07).
import type { VerifyToken } from "../mcp/auth"
import type { SignupOptions } from "../server/admin/signup"
import { PLATFORM_API_PREFIX } from "../schemas/api"
import { ensureZodMessages } from "../schemas/zod-messages"
import type { Json } from "../server/database"
import type { PlatformDb } from "../server/db"
import { PlatformError } from "../server/errors"
import type { Identity } from "../server/identity"
import { journalError, loggedArgs, wellFormed, withheldValues, withoutWithheld, writeJournal } from "../server/journal"
import { brandRoutes } from "./brand"
import { cellRoutes } from "./cell"
import { connectorConsentRoutes } from "./connector-consent"
import { feedbackRoutes } from "./feedback"
import { filesRoutes } from "./files"
import { hostedLinkRoutes } from "./hosted-link"
import { fileHtmlResponse, isFileHtmlRoute } from "./files-html"
import { invitationsRoutes } from "./invitations"
import { membersRoutes } from "./members"
import { nodesRoutes } from "./nodes"
import { platformAccessRoutes } from "./platform-access"
import { profileRoutes } from "./profile"
import { isPublicRoute, publicResponse } from "./public"
import { rulesRoutes } from "./rules"
import { searchRoutes } from "./search"
import { addressOrigin, asPlatformError, authenticationRequired, errorResponse, requireSameOrigin, sessionIdentity, verifiedSession } from "./session"
import { sharesRoutes } from "./shares"
import { isSignupRoute, signupResponse } from "./signup"
import { trashRoutes } from "./trash"
import { isUploadFormRoute, isUploadRoute, uploadFormResponse, uploadResponse } from "./uploads"
import { tablesRoutes } from "./tables"
import { teamsRoutes } from "./teams"
import { transitFilesRoutes } from "./transit-files"
import {
  accountCreationRoute,
  accountDisablingRoute,
  accountRuleRemovalRoute,
  accountRuleSettingRoute,
  accountSecretRoute,
  accountShareJournalRoute,
} from "./admin/accounts"
import { activationRoute, deactivationRoute } from "./admin/connectors"
import { flagRoute } from "./admin/flags"
import { openEntryRoute, orgRoute } from "./admin/org"

type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE"

type RouteContext = {
  db: PlatformDb
  identity: Identity
  request: Request
  /** Segments de l'URL après la ressource, décodés. */
  params: string[]
  /** Corps JSON d'un `POST` ou d'un `PATCH` ; `undefined` sinon. */
  body: unknown
  /** Origine appelée (`https://acme.oto.cx`) : adresse de retour des emails (hypothèse N2). */
  origin: string
}

type RouteResult = {
  status: number
  data: unknown
  /**
   * Ce que le service rend pour le journal : sa cible et son équipe ; `error`, le refus qu'une route sert autrement
   * qu'en erreur (le retour d'un consentement, une redirection), journalisé comme un échec.
   */
  journal?: { target?: string | null; teamId?: string | null; error?: PlatformError }
  /**
   * Une redirection (`status` 302) vers cette adresse, sans corps et jamais gardée en cache (`private, no-store`) :
   * la lecture d'un fichier, vers son URL présignée (E10-S02, AC-a5). `data` n'est alors pas servi.
   */
  redirect?: string
}

type Route = {
  /** Nombre exact de segments après la ressource. */
  params: number
  /**
   * Segments fixes, par rang après la ressource (`{ 1: "members" }` pour `teams/<id>/members`) : ils
   * départagent deux routes d'une même méthode et nomment l'outil du journal (« POST teams/members »,
   * comme « POST nodes/move » de H07).
   */
  fixed?: Readonly<Record<number, string>>
  handle: (context: RouteContext) => Promise<RouteResult>
  /** Cible journalisée quand le service échoue : celle de la requête validée, sinon `null`. */
  target?: (request: { params: string[]; body: unknown }) => string | null
  /** Une lecture (`GET`) qui écrit pourtant : sa ligne de journal part comme celle d'une mutation. */
  journaled?: boolean
  /**
   * Liste blanche des arguments journalisés, tirée de l'adresse, du corps et, servie, de la réponse, au lieu du corps
   * entier : posée, un refus se journalise par son seul code, son message pouvant citer le corps (un nom de fichier), et
   * toute valeur du corps qu'elle ne garde pas est retirée de la cible. C'est ainsi qu'une route tient une donnée
   * personnelle hors du journal ; elle peut y mettre `PERSONAL` (`[personal]`) à sa place.
   */
  journalArgs?: (request: { params: string[]; body: unknown; data?: unknown }) => Json
}

// Les routes `admin/*` du tableau de bord (E08-S03) vivent dans quatre fichiers et se réunissent ici.
export type { Route }

/** Une route par méthode, ou plusieurs que leurs segments départagent (`teams` et `teams/<id>/members`). */
export type ResourceRoutes = Partial<Record<HttpMethod, Route | readonly Route[]>>

// Table de dispatch : une ligne par ressource (E05-S03 et les stories suivantes l'étendent).
const RESOURCES: Record<string, ResourceRoutes> = {
  invitations: invitationsRoutes,
  brand: brandRoutes,
  teams: teamsRoutes,
  members: membersRoutes,
  rules: rulesRoutes,
  "platform-access": platformAccessRoutes,
  nodes: nodesRoutes,
  feedback: feedbackRoutes,
  // Tableau de bord (E08-S03) : `admin/org`, `admin/open-entry`, `admin/connectors/<nom>/activation`, `admin/accounts`,
  // `admin/accounts/<id>/disable`, `admin/accounts/<id>/secret`, `admin/accounts/<id>/share-journal` (lecture),
  // `admin/account-rules` et `admin/account-rules/<id>` (le partage d'un compte, pour qui le gère) et `admin/flags`,
  // départagées par leurs segments fixes.
  admin: {
    GET: accountShareJournalRoute,
    PATCH: [orgRoute, flagRoute, openEntryRoute],
    POST: [activationRoute, accountCreationRoute, accountDisablingRoute, accountSecretRoute, accountRuleSettingRoute],
    DELETE: [deactivationRoute, accountRuleRemovalRoute],
  },
  tables: tablesRoutes,
  profile: profileRoutes,
  // E05-S09 : la recherche de la palette du rail (⌘K).
  search: searchRoutes,
  // E05-S10 : la corbeille (partie e) et les liens publics (partie d, ADR-013).
  trash: trashRoutes,
  shares: sharesRoutes,
  // E10-S02 : les fichiers joints (ADR-016).
  files: filesRoutes,
  // Les fichiers en transit, entre une personne et un connecteur : sans nœud, lisibles par leur seul auteur, à échéance.
  "transit-files": transitFilesRoutes,
  // Le consentement d'une personne à un connecteur `oauth2_user` : son départ, et l'adresse de retour du tiers.
  "connector-consent": connectorConsentRoutes,
  // Le branchement hébergé d'un compte à un connecteur à `accountIdentity` : son départ, et l'adresse de retour du tiers.
  "hosted-link": hostedLinkRoutes,
}

type PlatformRequestOptions = {
  /** Jeton de la session de l'hôte ; vérifié ici par `verifyToken`. */
  accessToken: string | null | undefined
  /** Hôte brut de la requête (`x-forwarded-host` puis `host`) : il désigne l'organisation. */
  host: string | null
  /** Exécute une tâche après la réponse (`after` de `next/server` dans l'hôte). */
  defer?: (task: () => Promise<void>) => void
  /**
   * Vérificateur du jeton, du type de celui du MCP (`makeVerifyToken({ jwks, issuer })`, ADR-012
   * § 5 b) ; l'appelant est ce qu'en tire `verifiedCaller` : l'émetteur et le sujet de son `extra`,
   * traduits par la base (E01-S11), sinon `extra.sub` pour un vérificateur qui ne dit pas son émetteur,
   * et `extra.email`. Sans lui, `makeVerifyToken()` : l'émetteur de l'hôte (`server/issuer.ts`), Supabase
   * Auth du projet par défaut ou l'émetteur OIDC de `PLATFORM_OIDC_ISSUER`, comme `/api/mcp`.
   */
  verifyToken?: VerifyToken
  /** L'inscription libre (E12-S01, ADR-023) : son point de création et son contrôle d'abus ; absente, `POST signup` n'existe pas. */
  signup?: SignupOptions
}

const PREFIX = PLATFORM_API_PREFIX
const MUTATIONS: ReadonlySet<string> = new Set(["POST", "PATCH", "DELETE"])

/** `tool` : le nom de la ligne de journal, « <VERBE> <ressource>[/<segment fixe>] » (H07). */
type MatchedRoute = { route: Route; params: string[]; tool: string }

function isHttpMethod(value: string): value is HttpMethod {
  return value === "GET" || value === "POST" || value === "PATCH" || value === "DELETE"
}

function fits(route: Route, segments: string[]): boolean {
  if (route.params !== segments.length) return false
  return Object.entries(route.fixed ?? {}).every(([at, segment]) => segments[Number(at)] === segment)
}

/** Segments du chemin après `/api/platform/`, encore encodés ; aucun hors de ce préfixe. */
function routeSegments(request: Request): string[] {
  const { pathname } = new URL(request.url)
  const at = pathname.indexOf(PREFIX)
  return at === -1 ? [] : pathname.slice(at + PREFIX.length).split("/").filter(Boolean)
}

/** `GET /api/platform/cell`, sans paramètre : servie hors de `RESOURCES` (NH11). */
function isCellRoute(segments: readonly string[], method: string): boolean {
  return method === "GET" && segments.length === 1 && segments[0] === "cell"
}

function matchRoute(segments: readonly string[], method: string): MatchedRoute | null {
  if (!isHttpMethod(method)) return null
  const [resource = "", ...rest] = segments
  const routes = Object.hasOwn(RESOURCES, resource) ? [RESOURCES[resource][method] ?? []].flat() : []
  const route = routes.find((candidate) => fits(candidate, rest))
  if (!route) return null
  const tool = `${method} ${[resource, ...Object.values(route.fixed ?? {})].join("/")}`
  try {
    return { route, params: rest.map((segment) => decodeURIComponent(segment)), tool }
  } catch {
    // Un `%` mal formé ne désigne aucune ressource.
    return null
  }
}

async function readJson(request: Request): Promise<Json> {
  const text = await request.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new PlatformError("invalid_arguments", "Request body must be JSON.")
  }
}

type JournalLine = {
  org_id: string
  user_id: string
  method: "api"
  tool: string
  target: string | null
  team_id: string | null
  args: Json | null
  is_error: boolean
  error: string | null
  duration_ms: number
  user_agent: string | null
  ctx: null
  host: null
}

/** Une redirection sans corps, jamais gardée par un cache (E10-S02, AC-a5) : son adresse est signée pour 60 s. */
function redirection(location: string, status: number): Response {
  return new Response(null, { status, headers: { Location: location, "Cache-Control": "private, no-store" } })
}

type Served = {
  response: Response
  failure: PlatformError | null
  target: string | null
  teamId: string | null
  args: Json | null
  /** La colonne `error` : code et message, le code seul sous `journalArgs`. */
  error: string | null
}

/**
 * Arguments, erreur et cible de la ligne : le corps masqué (`loggedArgs`), sinon la liste blanche de la route. Sous la
 * liste blanche, une valeur du corps qu'elle ne garde pas (une donnée personnelle, un nom de fichier) ne revient ni par
 * l'erreur, réduite à son code, ni par la cible, d'où elle est retirée (`pseudonymisation.md` § Les quatre primitives).
 */
function journaled(
  route: Route,
  request: { params: string[]; body: Json | undefined; data?: unknown },
  failure: PlatformError | null,
  target: string | null,
): Pick<Served, "args" | "error" | "target"> {
  if (route.journalArgs) {
    const args = wellFormed(route.journalArgs(request))
    return { args, error: failure ? failure.code : null, target: withoutWithheld(target, withheldValues(request.body, args)) }
  }
  return { args: request.body === undefined ? null : loggedArgs(request.body), error: failure ? journalError(failure.code, failure.message) : null, target }
}

async function serve(match: MatchedRoute, context: Omit<RouteContext, "params" | "body">): Promise<Served> {
  const { request } = context
  let body: Json | undefined
  try {
    if (request.method === "POST" || request.method === "PATCH") body = await readJson(request)
    const result = await match.route.handle({ ...context, params: match.params, body })
    const failure = result.journal?.error ?? null
    return {
      response: result.redirect ? redirection(result.redirect, result.status) : Response.json({ data: result.data }, { status: result.status }),
      failure,
      teamId: result.journal?.teamId ?? null,
      ...journaled(match.route, { params: match.params, body, data: result.data }, failure, result.journal?.target ?? match.route.target?.({ params: match.params, body }) ?? null),
    }
  } catch (error) {
    const failure = asPlatformError(error)
    return {
      response: errorResponse(failure),
      failure,
      teamId: null,
      ...journaled(match.route, { params: match.params, body }, failure, match.route.target?.({ params: match.params, body }) ?? null),
    }
  }
}

function journalLine(served: Served, request: { method: string; tool: string; identity: Identity; started: number; userAgent: string | null }): JournalLine {
  return {
    org_id: request.identity.org.id,
    user_id: request.identity.user.id,
    method: "api",
    tool: request.tool,
    target: served.target,
    team_id: served.teamId,
    args: request.method === "DELETE" ? null : served.args,
    is_error: served.failure !== null,
    error: served.error,
    duration_ms: Date.now() - request.started,
    user_agent: request.userAgent,
    ctx: null,
    host: null,
  }
}

/**
 * La porte : jeton vérifié, origine contrôlée pour les mutations, route, identité par l'adresse,
 * service, réponse ; puis la ligne de journal d'une mutation, confiée à `defer` pour partir après
 * la réponse. Sans `defer`, la promesse n'est pas attendue ; son échec part au log serveur.
 */
export async function handlePlateforme(request: Request, options: PlatformRequestOptions): Promise<Response> {
  // Avant toute validation : chez un hôte empaqueté, Zod n'a pas ses messages (`schemas/zod-messages.ts`).
  ensureZodMessages()
  const started = Date.now()
  try {
    // La lecture d'un lien public (E05-S10 partie d, ADR-013 § 4) : hors session, avant le jeton, sans journal.
    const publicSegments = routeSegments(request)
    if (isPublicRoute(publicSegments, request.method)) return await publicResponse(request, options.host, publicSegments)
    // La route isolée d'un fichier HTML (E10-S02, AC-c3, ADR-017) : du texte, jamais du JSON, 401 compris ; elle vérifie le jeton elle-même.
    if (isFileHtmlRoute(publicSegments, request.method)) return await fileHtmlResponse(request, options, publicSegments)
    // Le dépôt par lien (E10-S02 lot f, ADR-018) : la seule porte sans session qui écrit, le ticket en tient lieu, en texte
    // brut ; puis le formulaire de dépôt, à session, qui vérifie le jeton lui-même. Le corps de l'une et l'autre est le fichier.
    if (isUploadRoute(publicSegments)) return await uploadResponse(request, options, publicSegments)
    if (isUploadFormRoute(publicSegments, request.method)) return await uploadFormResponse(request, options, publicSegments)
    const session = await verifiedSession(request, options)
    if (!session) return errorResponse(authenticationRequired(), 401)
    const { db } = session

    const method = request.method.toUpperCase()
    const origin = addressOrigin(request, options.host)
    // Une mutation vient de l'adresse elle-même ; le refus rejoint le `catch` de la porte, même réponse.
    if (MUTATIONS.has(method)) requireSameOrigin(request, origin)
    const segments = routeSegments(request)
    // La cellule ne désigne aucune organisation : ni identité par l'adresse, ni journal (NH4, H07).
    if (isCellRoute(segments, method)) {
      const result = await cellRoutes.GET.handle({ db })
      return Response.json({ data: result.data }, { status: result.status })
    }
    // L'inscription (E12-S01) : sans organisation par l'adresse, sur l'option de l'hôte seule ; sans elle, route inconnue.
    if (options.signup && isSignupRoute(segments, method)) return await signupResponse(request, session, { signup: options.signup, defer: options.defer }, started)
    const match = matchRoute(segments, method)
    if (!match) return errorResponse(new PlatformError("not_found", "Unknown route."))

    let identity: Identity
    try {
      identity = await sessionIdentity(session, options.host)
    } catch (error) {
      return errorResponse(asPlatformError(error))
    }

    const served = await serve(match, { db, identity, request, origin })
    if (MUTATIONS.has(method) || match.route.journaled) {
      const userAgent = request.headers.get("user-agent")
      const line = journalLine(served, { method, tool: match.tool, identity, started, userAgent })
      // L'écrivain commun des portes (H07) : il ne lève jamais, un journal en panne ne change rien.
      const task = () => writeJournal(db, [line])
      if (options.defer) options.defer(task)
      else void task()
    }
    return served.response
  } catch (error) {
    return errorResponse(asPlatformError(error))
  }
}
