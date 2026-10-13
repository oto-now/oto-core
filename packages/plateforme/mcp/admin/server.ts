// Adaptateur du MCP admin (E08-S02, mcp-patterns.md § 1) : garder, valider, résoudre l'organisation,
// appeler le service, mettre en forme, journaliser ; aucune logique métier. Handlers BAS NIVEAU (H21) :
// la garde `ctx` rend nos messages, pas l'erreur de validation générique du SDK.
//
// Repris de la maquette (`mcp-test/src/proto/mcp/server.ts` l. 44-51, 68-128) : options du serveur,
// garde avant validation, service, texte identique dans les deux canaux, entrée de journal ouverte
// avant le service pour garder la cible d'un refus, handlers bas niveau ; retiré : `prompts`.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { CTX_PATTERN } from "../../schemas"
import { adminJournalEntry, openAdminSession, requireAdminCtx, type AdminJournalEntry, type StaffCaller } from "../../server/admin/context"
import type { OrgCreationHook } from "../../server/admin/org-creation"
import { newCtxCode } from "../../server/ctx"
import type { PlatformDb } from "../../server/db"
import { isPlatformError, PlatformError, type PlatformErrorCode } from "../../server/errors"
import { clip, journalError, lastHostSignature } from "../../server/journal"
import { formatError, formatResult, type ToolResult } from "../result"
import { MAX_ARGS_CHARS } from "../server"
import { MAX_NAME_CHARS, runAdminOp, type AdminOutput, type OpTable, type OpTrace } from "./ops"
import { ADMIN_INSTRUCTIONS, ADMIN_SERVER_VERSION, adminToolKey, buildAdminTools, type AdminToolKey } from "./tools"
import { CELL_OPS } from "./tools/cell"
import { CONNECTOR_OPS } from "./tools/connector"
import { CONTEXT_OPS } from "./tools/context"
import { FEEDBACK_OPS } from "./tools/feedback"
import { JOURNAL_OPS } from "./tools/journal"
import { NODE_OPS } from "./tools/node"
import { ORG_OPS } from "./tools/org"
import { TEAM_OPS } from "./tools/team"

export type AdminMcpDeps = {
  db: PlatformDb
  /** L'appelant, reconnu membre de l'équipe plateforme par la porte (`requireStaff`). */
  caller: StaffCaller
  /** L'origine du MCP admin appelé (`requestOrigin`) : le lien d'une invitation en reprend protocole et port. */
  origin: string
  userAgent: string | null
  /** Lignes empilées pendant la requête ; la porte les écrit après la réponse (H07). */
  journal: AdminJournalEntry[]
  /** Le point de création de l'hôte (E09-S02), absent chez un ERP : `admin_org` le déclare et le passe à `createOrg`. */
  orgCreation?: OrgCreationHook
}

/**
 * Les opérations de chaque outil ; un outil sans table est déclaré mais pas encore rendu (N17 d'E08-S02) :
 * toute opération y rendrait `unavailable_in_v1`, après la garde. Depuis E08-S06, les huit en ont une.
 */
const TABLES: Partial<Record<AdminToolKey, OpTable>> = {
  admin_context: CONTEXT_OPS,
  admin_org: ORG_OPS,
  admin_team: TEAM_OPS,
  admin_node: NODE_OPS,
  admin_connector: CONNECTOR_OPS,
  admin_journal: JOURNAL_OPS,
  admin_feedback: FEEDBACK_OPS,
  admin_cell: CELL_OPS,
}

/** `"<outil> <op>"` des opérations en deux temps : jamais proposées en suite (N14, H26). */
const TWO_STEP: ReadonlySet<string> = new Set(
  Object.entries(TABLES).flatMap(([tool, table]) =>
    Object.entries(table ?? {})
      .filter(([, op]) => op.twoStep)
      .map(([name]) => `${tool} ${name}`),
  ),
)

export function isTwoStep(action: string): boolean {
  return TWO_STEP.has(action)
}

const INTERNAL = "Internal error. Retry once; if it fails again, report it to the platform developers."
/** Le message d'une panne que rien ne décrit (`fromDatabaseError`) : remplacé par la consigne de réessayer. */
const BARE_INTERNAL = "Internal error."

export function buildAdminServerOptions() {
  return {
    serverInfo: { name: "oto-platform-admin", title: "Platform admin", version: ADMIN_SERVER_VERSION },
    instructions: ADMIN_INSTRUCTIONS,
    capabilities: { tools: {} },
  }
}

/** Code de l'argument `ctx` s'il en a la forme, sinon `null` : il regroupe au journal les appels refusés. */
function ctxOfArgs(args: Record<string, unknown>): string | null {
  const code = typeof args.ctx === "string" ? args.ctx.trim().toUpperCase() : ""
  return CTX_PATTERN.test(code) ? code : null
}

/**
 * Refus nommé tel quel, panne décrite par son service comprise (session non ouverte, AC6 ; responsable
 * non posé, AC20) ; une panne sans description, ou qui n'est pas une `PlatformError`, devient la
 * consigne de réessayer.
 */
function failureOf(error: unknown): { code: PlatformErrorCode; message: string } {
  if (isPlatformError(error) && error.message !== BARE_INTERNAL) return { code: error.code, message: error.message }
  if (!isPlatformError(error)) console.error("[platform] mcp-admin: tools/call failed", error)
  return { code: "internal", message: INTERNAL }
}

type Call = { name: string; args: Record<string, unknown>; size: number }

/**
 * Gardes dans l'ordre : outil, taille, `ctx` (sauf `admin_context`, qui l'émet), table de l'outil ; puis
 * l'opération. `session.host` : la signature du client (P6), celle du dernier `initialize` pour un code
 * émis, celle de l'ancrage pour un code reçu ; posée dès la garde passée, un refus la garde.
 */
async function serve(deps: AdminMcpDeps, call: Call, trace: OpTrace, session: { host: string | null }): Promise<{ output: AdminOutput; issued: string | null }> {
  const key = adminToolKey(call.name)
  if (!key) throw new PlatformError("not_found", `Unknown tool ${clip(call.name, MAX_NAME_CHARS)}. The tools of this server all start with admin_.`)
  if (call.size > MAX_ARGS_CHARS) throw new PlatformError("too_large", `Arguments too large (${call.size} characters, max ${MAX_ARGS_CHARS}).`)
  if (key === "admin_context") {
    const code = newCtxCode()
    session.host = await lastHostSignature(deps.db, deps.caller, deps.userAgent)
    const output = await runAdminOp(key, CONTEXT_OPS, call.args, { deps, ctx: code, trace, defaultOp: "ctx" })
    return { output, issued: code }
  }
  const ctx = await requireAdminCtx(deps.db, deps.caller, call.args.ctx)
  session.host = ctx.host
  const table = TABLES[key]
  if (!table) throw new PlatformError("unavailable_in_v1", "Not available yet in this version.")
  return { output: await runAdminOp(key, table, call.args, { deps, ctx: ctx.code, trace }), issued: null }
}

async function runAdminCall(deps: AdminMcpDeps, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const started = Date.now()
  const opened = adminJournalEntry(deps.caller, { method: "tools/call", params: args, userAgent: deps.userAgent })
  const op = typeof args.op === "string" ? clip(args.op, MAX_NAME_CHARS) : name === "admin_context" ? "ctx" : null
  // `admin_context` n'a pas de `ctx` : sa ligne porte le code qu'il émet, ou aucun.
  const entry: AdminJournalEntry = { ...opened, tool: clip(name, MAX_NAME_CHARS), op, ctx: name === "admin_context" ? null : ctxOfArgs(args) }
  const trace: OpTrace = { orgId: null, target: null }
  const session: { host: string | null } = { host: null }
  const refuse = (failure: { code: PlatformErrorCode; message: string }) => {
    const result = formatError(failure.message)
    const fields = { org_id: trace.orgId, target: trace.target, host: session.host, is_error: true, error: journalError(failure.code, failure.message) }
    deps.journal.push({ ...entry, ...fields, result_chars: result.content[0].text.length, duration_ms: Date.now() - started })
    return result
  }

  let served: { output: AdminOutput; issued: string | null }
  try {
    served = await serve(deps, { name, args, size: opened.args_chars ?? 0 }, trace, session)
  } catch (error) {
    return refuse(failureOf(error))
  }
  const { output, issued } = served
  const result = formatResult(output, isTwoStep)
  const done: AdminJournalEntry = {
    ...entry,
    host: session.host,
    org_id: output.orgId ?? trace.orgId,
    target: output.target ?? trace.target,
    result_chars: result.content[0].text.length,
    duration_ms: Date.now() - started,
  }
  if (!issued) {
    deps.journal.push(done)
    return result
  }
  // L'ancrage du code, écrit et attendu avant la réponse (AC6, N5) : sans lui, aucun code n'est servi.
  try {
    await openAdminSession(deps.db, deps.caller, { ...done, ctx: issued })
  } catch (error) {
    return refuse(failureOf(error))
  }
  return result
}

export function installAdmin(server: McpServer, deps: AdminMcpDeps): void {
  server.server.setRequestHandler(ListToolsRequestSchema, async (request) => {
    const started = Date.now()
    const tools = buildAdminTools({ orgCreation: deps.orgCreation !== undefined })
    const entry = adminJournalEntry(deps.caller, { method: "tools/list", params: request.params ?? {}, userAgent: deps.userAgent })
    deps.journal.push({ ...entry, result_chars: JSON.stringify(tools).length, duration_ms: Date.now() - started })
    return { tools }
  })

  server.server.setRequestHandler(CallToolRequestSchema, (request) => runAdminCall(deps, request.params.name, request.params.arguments ?? {}))
}
