// Adaptateur MCP (mcp-patterns.md § 1) : la route (`handler.ts`) et les tests (InMemoryTransport)
// l'installent sur un `McpServer`. Il ne fait que garder, valider, appeler un service, mettre en
// forme et journaliser ; aucune logique métier. Handlers BAS NIVEAU, pas `registerTool` (H21) :
// la garde `ctx` doit rendre le message de H27, pas l'erreur de validation générique du SDK.
//
// Repris de la maquette (`mcp-test/src/proto/mcp/server.ts` l. 30-150) : options, capacités, table
// des services, ordre `ctx` → Zod → service, une ligne de journal par requête, message de panne,
// prompts. Ajouté : la garde d'appartenance (banc E03, `auth-test/mcp/server.ts` l. 61-64 et
// 174-184). Retiré : `structuredContent: { text }` seul (H26), `ProtoError` (→ `PlatformError`).
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import {
  CallToolRequestSchema,
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"
import pkg from "../package.json"
import { CTX_PATTERN } from "../schemas"
import type { CatalogFunction } from "../server/catalog/define"
import { runCall, type CallTrace } from "../server/calls"
import { assistantFunctions, callExamples, findFunction } from "../server/catalog/registry"
import { buildContext } from "../server/context"
import { changedCtxMessage, requireCtx, type CallOutcome, type CtxChange } from "../server/ctx"
import type { PlatformDb } from "../server/db"
import { isPlatformError, PlatformError, type PlatformErrorCode } from "../server/errors"
import { recordFeedback } from "../server/feedback"
import { find } from "../server/find"
import type { Identity, IdentityOrg } from "../server/identity"
import { clip, failedEntry, journalError, openedEntry, servedEntry, type JournalEntry } from "../server/journal"
import { preferredTheme } from "../server/language"
import { readNode } from "../server/nodes/read"
import { writeNode } from "../server/nodes/write"
import { getPrompt, listPrompts, type ProcedurePrompt, unknownPromptMessage } from "../server/prompts"
import type { ToolOutput } from "../server/tool-output"
import { formatError, formatResult, type ToolResult } from "./result"
import { inputSchemas, parseInput, type ToolInput } from "./schemas"
import { buildTools, displayOrg, serverInstructions, toolKey, type ToolKey, type ToolOrg } from "./tools"
import { readWidgetResource, widgetResources } from "./widget-meta"

/** Version du contrat servi : aucun host ne la montre, elle date le journal (mcp-patterns.md § 2). */
export const PLATFORM_MCP_VERSION = pkg.version

/** Au-delà, un appel est refusé avant tout traitement (N11 ; un modèle en écrit ~50 000 au plus). */
export const MAX_ARGS_CHARS = 1_000_000

/** Borne d'un nom venu du host, non validé, au journal et dans un message (N22). */
const MAX_NAME_CHARS = 200

/** Qui appelle : un membre, ou une personne connectée qui ne l'est pas (sa liste d'outils reste servie). */
export type McpCaller = { kind: "member"; identity: Identity } | { kind: "not_member"; refusal: string }

export type McpDeps = {
  db: PlatformDb
  /** Organisation de l'adresse appelée, jamais du jeton (ADR-004). */
  org: IdentityOrg
  caller: McpCaller
  userAgent: string | null
  /** Lignes empilées pendant la requête ; la porte les écrit après la réponse (AC17). */
  journal: JournalEntry[]
  /**
   * Connecteurs actifs de l'organisation (E04-S01, N9, N27) : lus au premier appel, puis gardés pour
   * cette requête seule, jamais d'une requête à l'autre.
   */
  activeConnectors: () => Promise<ReadonlySet<string>>
  /** Origine appelée (`getPublicOrigin`, celle du 401) : lien du tableau de bord d'un refus de `call` (E03-S04, AC8). */
  origin: string
  /** Jeton vérifié de la requête : une fonction ERP s'exécute sous lui (E08-S05, NH4) ; sans lui, aucune ne court. */
  accessToken?: string
  /**
   * Le widget routeur est allumé (`handleMcpPost`, story widgets-dans-la-conversation) : méta de `call` et `read`,
   * resources du bundle, vue des résultats. Éteint (défaut), le serveur sert le texte seul d'avant.
   */
  widgets?: boolean
}

/** `trace` : ce qu'un `call` a établi avant d'échouer (équipe, compte), pour sa ligne de journal (E03-S04, AC16). */
type MemberDeps = McpDeps & { identity: Identity; trace?: CallTrace }
type ValidCtx = { code: string; host: string | null; changed?: CtxChange }

/** Titre posé entre l'avis d'un Contexte changé et ce que l'appel a rendu. */
const RESULT_HEADING = "## Result of this call"

/**
 * `text` précédé de l'avis d'un Contexte changé (`changedCtxMessage`) quand le code de l'appel était périmé : l'appel a
 * couru sous le nouveau code, a été refusé ou est tombé en panne (`outcome`), et le modèle lit d'abord le code à passer
 * désormais, ce qu'est devenu l'appel et ce qui a changé.
 */
function withCtxNotice(text: string, prefix: string, ctx: ValidCtx | null, outcome: CallOutcome = "ran"): string {
  if (!ctx?.changed) return text
  return `${changedCtxMessage(prefix, { paths: ctx.changed.paths, code: ctx.code, served: ctx.changed.served }, outcome)}\n\n${RESULT_HEADING}\n\n${text}`
}
type Service<K extends ToolKey> = (deps: MemberDeps, input: ToolInput<K>, ctx: ValidCtx | null) => Promise<ToolOutput>
/** Un appel d'outil tel que reçu ; `size` : ses arguments sérialisés, en caractères. */
type ToolCall = { name: string; args: Record<string, unknown>; size: number }

/** Erreur JSON-RPC au code choisi : le SDK rend `code` et `message` tels quels. */
class JsonRpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message)
  }
}

// Une ligne par outil : chaque story de la vague 4 remplace la sienne (E03-S02 à E03-S05).
const SERVICES: { [K in ToolKey]: Service<K> } = {
  context: ({ db, identity, userAgent }, input) => buildContext(db, identity, input, { userAgent }),
  find: async ({ db, identity, activeConnectors }, input) => find(db, identity, input, { functions: assistantFunctions(), activeConnectors: await activeConnectors() }),
  // L'origine de la requête rend absolue l'adresse d'un fichier joint (E10-S02, AC-d1).
  read: ({ db, identity, origin, widgets }, input) => readNode(db, identity, input, { origin, views: widgets }),
  call: ({ db, identity, origin, activeConnectors, trace, accessToken }, input, ctx) =>
    runCall({ db, identity, ctxCode: ctx?.code ?? null, ctxHost: ctx?.host ?? null, origin, activeConnectors, trace, accessToken }, input),
  // La provenance d'un bloc écrit par un assistant porte le code `ctx` de la conversation (AC28).
  write: ({ db, identity }, input, ctx) => writeNode(db, identity, input, { kind: "agent", ctx: ctx?.code ?? null }),
  // `ctx` est toujours validé ici : la garde précède tout outil autre que `context`.
  feedback: ({ db, identity }, input, ctx) => recordFeedback(db, identity, input, ctx?.code ?? null),
}

export function serverOptions(org: ToolOrg, options: { widgets?: boolean } = {}) {
  return {
    serverInfo: { name: "oto-platform", title: displayOrg(org).name, version: PLATFORM_MCP_VERSION },
    instructions: serverInstructions(org),
    // `resources` : les deux variantes du bundle du widget, déclarées seulement quand il est allumé.
    capabilities: { tools: {}, prompts: {}, ...(options.widgets ? { resources: {} } : {}) },
  }
}

/** Ligne de journal d'une requête d'un membre : qui, quoi, arguments masqués et bornés (`openedEntry`). */
function openEntry(deps: MemberDeps, method: string, params: unknown): JournalEntry & { args_chars: number } {
  return openedEntry(deps.identity, { method, params, userAgent: deps.userAgent })
}

/** Code de l'argument `ctx` s'il en a la forme, sinon `null` (AC16). */
function ctxOfArgs(args: Record<string, unknown>): string | null {
  const code = typeof args.ctx === "string" ? args.ctx.trim().toUpperCase() : ""
  return CTX_PATTERN.test(code) ? code : null
}

/** Fonction demandée par un `call`, telle qu'envoyée, sans espace de bord et bornée (N22) ; sinon `null`. */
function functionOfArgs(args: Record<string, unknown>): string | null {
  return typeof args.function === "string" ? clip(args.function.trim(), MAX_NAME_CHARS) : null
}

/** Refus nommé tel quel ; toute panne, `internal` compris, devient la consigne de H04. */
function failureOf(error: unknown, prefix: string): { code: PlatformErrorCode; message: string } {
  if (isPlatformError(error) && error.code !== "internal") return { code: error.code, message: error.message }
  if (!isPlatformError(error)) console.error("[platform] mcp: tools/call failed", error)
  return { code: "internal", message: `Internal error. Retry once, then report it with ${prefix}_feedback (type error).` }
}

/** Gardes dans l'ordre : nom d'outil, taille, `ctx` (sauf `context`), Zod ; puis le service. */
async function serve(deps: MemberDeps, call: ToolCall, validated: { ctx: ValidCtx | null }) {
  const { name, args, size } = call
  const prefix = deps.org.prefix
  const key = toolKey(prefix, name)
  if (!key) throw new PlatformError("not_found", `Unknown tool ${clip(name, MAX_NAME_CHARS)}. The tools of this server all start with ${prefix}_.`)
  if (size > MAX_ARGS_CHARS) {
    throw new PlatformError("too_large", `Arguments too large (${size} characters, max ${MAX_ARGS_CHARS}). Split the content into several calls.`)
  }
  // `feedback` accepte un code connu mais périmé (E11-S03, AC-a6) : un retour sur la panne n'exige pas de relire le contexte.
  if (key !== "context") validated.ctx = await requireCtx(deps.db, deps.identity, args.ctx, { staleAllowed: key === "feedback" })
  const parsed = parseInput(inputSchemas(prefix)[key], args)
  if ("issues" in parsed) throw new PlatformError("invalid_arguments", `Invalid arguments for ${name}: ${parsed.issues}`)
  // `parsed.data` suit le schéma de `key` : TypeScript ne relie pas `SERVICES[key]` à ce schéma.
  const service = SERVICES[key] as Service<ToolKey>
  return service(deps, parsed.data, validated.ctx)
}

async function runTool(
  deps: McpDeps,
  functions: readonly CatalogFunction[],
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  // Appartenance d'abord (ADR-004 § 2) ; aucune ligne : la RLS du journal exige d'être membre (N2).
  if (deps.caller.kind === "not_member") return formatError(deps.caller.refusal)
  // Ce qu'un `call` établit avant d'échouer (équipe, compte) reste à sa ligne de journal (E03-S04, AC16).
  const trace: CallTrace = {}
  const member: MemberDeps = { ...deps, identity: deps.caller.identity, trace }
  const started = Date.now()
  const opened = openEntry(member, "tools/call", args)
  const entry: JournalEntry = { ...opened, tool: clip(name, MAX_NAME_CHARS), ctx: ctxOfArgs(args) }
  // La fonction demandée, posée avant les gardes : un `call` refusé la garde (E03-S04, N7).
  if (toolKey(deps.org.prefix, name) === "call") entry.target = functionOfArgs(args)
  const validated: { ctx: ValidCtx | null } = { ctx: null }
  try {
    const served = await serve(member, { name, args, size: opened.args_chars }, validated)
    // Un code périmé : l'avis en tête du texte, le nouveau code aussi en champ (`new_ctx`).
    const output = validated.ctx?.changed
      ? { ...served, text: withCtxNotice(served.text, deps.org.prefix, validated.ctx), data: { ...served.data, new_ctx: validated.ctx.code } }
      : served
    // La vue du widget, au thème de la personne sinon de l'organisation, comme ses écrans (ADR-008 § 3).
    // `call` : l'outil que le widget appelle (page suivante, vue de l'ERP), sous le préfixe de l'organisation.
    const view = deps.widgets && output.view ? { kind: output.view, theme: preferredTheme(member.identity), call: `${deps.org.prefix}_call` } : undefined
    const result = formatResult(output, (next) => findFunction(functions, next)?.class === "sensitive", view)
    servedEntry(entry, output, { ctx: validated.ctx?.code ?? entry.ctx ?? null, host: validated.ctx?.host ?? null, resultChars: result.content[0].text.length })
    return result
  } catch (error) {
    const failure = failureOf(error, deps.org.prefix)
    // Un refus d'un service n'a rien écrit ; une panne a pu courir en partie : l'avis le dit autrement.
    const result = formatError(withCtxNotice(failure.message, deps.org.prefix, validated.ctx, failure.code === "internal" ? "failed" : "refused"))
    failedEntry(entry, failure, { ctx: validated.ctx?.code ?? entry.ctx ?? null, host: validated.ctx?.host ?? null, trace, resultChars: result.content[0].text.length })
    return result
  } finally {
    entry.duration_ms = Date.now() - started
    member.journal.push(entry)
  }
}

type HandledRequest = { method: string; params?: unknown; started: number }

/** Une ligne pour une requête d'un membre sans outil (`tools/list`, `prompts/*`). */
function record(deps: McpDeps, request: HandledRequest, fields: Partial<JournalEntry>): void {
  if (deps.caller.kind !== "member") return
  const entry = openEntry({ ...deps, identity: deps.caller.identity }, request.method, request.params)
  deps.journal.push({ ...entry, duration_ms: Date.now() - request.started, ...fields })
}

/**
 * Connecteurs actifs cités par les exemples de `call` (E04-S01, AC22). Leur lecture en panne sert la
 * liste sans exemples de connecteur, comme sans connecteur actif, au lieu de refuser `tools/list`
 * (N38) : la description reste vraie, et la liste est servie à tout jeton valide.
 */
async function exampleConnectors(deps: McpDeps): Promise<ReadonlySet<string>> {
  try {
    return await deps.activeConnectors()
  } catch (error) {
    console.error("[platform] mcp: tools/list served without connector examples", isPlatformError(error) ? error.code : error)
    return new Set()
  }
}

/** `prompts/list` : nom, titre et description de chaque prompt ; aucun pour un non-membre (N5). */
async function visiblePrompts(deps: McpDeps): Promise<ProcedurePrompt[]> {
  if (deps.caller.kind !== "member") return []
  return listPrompts(deps.db, deps.caller.identity)
}

/** `prompts/get` : un message de la personne, le titre de la procédure (P37) ; inconnu pour un non-membre. */
async function servedPrompt(deps: McpDeps, name: string) {
  if (deps.caller.kind !== "member") throw new PlatformError("not_found", unknownPromptMessage(name))
  const prompt = await getPrompt(deps.db, deps.caller.identity, name)
  return {
    description: prompt.description,
    messages: [{ role: "user" as const, content: { type: "text" as const, text: prompt.text } }],
  }
}

/**
 * Refus d'une requête `prompts/*`, journalisé : un nom inconnu rend -32602 et son message (N21) ;
 * toute autre erreur, -32603 « Internal error. », le détail au log serveur seulement (N23).
 */
function promptFailure(deps: McpDeps, request: HandledRequest, error: unknown, fields: Partial<JournalEntry>): JsonRpcError {
  const failure =
    isPlatformError(error) && error.code === "not_found"
      ? { code: error.code, message: error.message, rpc: ErrorCode.InvalidParams }
      : { code: "internal" as const, message: "Internal error.", rpc: ErrorCode.InternalError }
  if (!isPlatformError(error)) console.error(`[platform] mcp: ${request.method} failed`, error)
  record(deps, request, {
    ...fields,
    is_error: true,
    error: journalError(failure.code, failure.message),
    result_chars: failure.message.length,
  })
  return new JsonRpcError(failure.rpc, failure.message)
}

export function installPlatformMcp(server: McpServer, deps: McpDeps): void {
  // Ce que voit l'assistant : sans les fonctions réservées au serveur de l'hôte (`serverOnly`).
  const functions = assistantFunctions()

  // Servie à tout jeton valide, membre ou non (banc E03) : la connexion passe, les appels sont refusés.
  server.server.setRequestHandler(ListToolsRequestSchema, async (request) => {
    const started = Date.now()
    const tools = buildTools(deps.org, callExamples(functions, await exampleConnectors(deps)), { widgets: deps.widgets })
    record(deps, { method: "tools/list", params: request.params, started }, { result_chars: JSON.stringify(tools).length })
    return { tools }
  })

  server.server.setRequestHandler(CallToolRequestSchema, (request) =>
    runTool(deps, functions, request.params.name, request.params.arguments ?? {}),
  )

  if (deps.widgets) installWidgetResources(server, deps)

  // Les procédures publiées lisibles (P37, E03-S05) : Claude Code lit `prompts/list` à chaque session.
  server.server.setRequestHandler(ListPromptsRequestSchema, async (request) => {
    const handled = { method: "prompts/list", params: request.params, started: Date.now() }
    try {
      const prompts = await visiblePrompts(deps)
      record(deps, handled, { result_chars: JSON.stringify(prompts).length })
      return { prompts }
    } catch (error) {
      throw promptFailure(deps, handled, error, {})
    }
  })

  server.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const handled = { method: "prompts/get", params: request.params, started: Date.now() }
    const name = clip(request.params.name, MAX_NAME_CHARS)
    try {
      const prompt = await servedPrompt(deps, name)
      record(deps, handled, { target: name, result_chars: JSON.stringify(prompt).length })
      return prompt
    } catch (error) {
      throw promptFailure(deps, handled, error, { target: name })
    }
  })
}

/** Adresse inconnue de `resources/read` : erreur JSON-RPC « resource not found » de la spécification MCP. */
const RESOURCE_NOT_FOUND = -32002

/**
 * Le bundle du widget (story widgets-dans-la-conversation) : servi à tout jeton valide, comme la liste d'outils ;
 * il ne porte aucune donnée, seulement le code qui rend un résultat déjà servi.
 */
function installWidgetResources(server: McpServer, deps: McpDeps): void {
  server.server.setRequestHandler(ListResourcesRequestSchema, async (request) => {
    const resources = widgetResources()
    record(deps, { method: "resources/list", params: request.params, started: Date.now() }, { result_chars: JSON.stringify(resources).length })
    return { resources }
  })

  server.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const handled = { method: "resources/read", params: request.params, started: Date.now() }
    const uri = clip(request.params.uri, MAX_NAME_CHARS)
    const resource = readWidgetResource(request.params.uri)
    if (!resource) {
      const message = `Unknown resource ${uri}.`
      record(deps, handled, { target: uri, is_error: true, error: journalError("not_found", message), result_chars: message.length })
      throw new JsonRpcError(RESOURCE_NOT_FOUND, message)
    }
    record(deps, handled, { target: uri, result_chars: resource.contents[0].text.length })
    return resource
  })
}
