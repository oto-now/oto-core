// Opérations des outils admin (E08-S02) : une table par outil (`tools/<outil>.ts`), dont chaque entrée
// porte le schéma de l'opération (source de ses champs, requis et facultatifs), son organisation
// (visée, nouvelle ou aucune), ses deux temps, le contrat que sert `op help`, et sa fonction. Sans ce
// module, chaque outil validerait ses opérations et nommerait ses refus à sa façon.
//
// Repris d'Oto (`oto_mcp/capabilities/_rest_adapter.py:128-152`) : un champ inconnu refusé en nommant
// l'excédent et les champs attendus ; (`oto_mcp/api/routes.py:126-140`) : chaque opération classée, un
// test échoue sur une opération non déclarée ; retiré : « voir en tant que » par en-tête
// (`X-Oto-Org`), la lecture seule forcée d'une organisation tierce. Repris de la maquette
// (`mcp-test/src/proto/functions/registry.ts` l. 22-36, `describeFunction`) : la forme du contrat.
import type * as z from "zod/v4"
import { ADMIN_CTX_MISSING, ADMIN_CTX_STALE, resolveAdminOrg, type StaffCaller } from "../../server/admin/context"
import type { OrgCreationHook } from "../../server/admin/org-creation"
import type { PlatformDb } from "../../server/db"
import { issuesText, PlatformError } from "../../server/errors"
import type { Identity } from "../../server/identity"
import { clip } from "../../server/journal"
import type { ToolOutput } from "../../server/tool-output"
import type { AdminToolKey } from "./tools"

/** L'organisation d'une opération : visée (résolue et gardée, AC10), à créer (son slug), ou aucune (AC9, N4). */
export type OrgTarget = "target" | "new" | "none"

/**
 * `orgCreation` : le point de création que branche l'hôte (E09-S02), lu par `admin_org create` et son aide. `origin` :
 * l'origine du MCP admin appelé (`https://cell.example.com`), dont le lien d'une invitation reprend protocole et port.
 */
export type AdminDeps = { db: PlatformDb; caller: StaffCaller; origin: string; orgCreation?: OrgCreationHook }

/** Ce que reçoit une opération : ses champs validés, l'organisation visée s'il y en a une, le code de la session. */
export type OpCall = { deps: AdminDeps; identity: Identity | null; input: Record<string, unknown>; ctx: string }

/** Ce que rend une opération : le résultat servi, et pour le journal l'organisation touchée (N15). */
export type AdminOutput = ToolOutput & { orgId?: string | null }

export type AdminOp = {
  schema: z.ZodObject
  org: OrgTarget
  twoStep: boolean
  /** Une phrase : ce que fait l'opération. */
  summary: string
  /** Ses champs d'exemple, sans `ctx` ni `op`. */
  example: Record<string, unknown>
  /** Ses refus propres, en plus des refus communs. */
  refusals: string[]
  run: (call: OpCall) => Promise<AdminOutput>
}

export type OpTable = Record<string, AdminOp>

/** Ce que l'appel a touché, lu par sa ligne de journal même quand il échoue (AC22, N15). */
export type OpTrace = { orgId: string | null; target: string | null }

/** Borne d'un nom venu du host (opération, champ), non validé, dans un refus et au journal. */
export const MAX_NAME_CHARS = 100

/** Clés hors du schéma d'une opération, lues par la garde et l'aiguillage. */
const ROUTING_KEYS: ReadonlySet<string> = new Set(["ctx", "op"])

const EXAMPLE_CTX = "7K3Q-M2XA"

function list(names: readonly string[]): string {
  return names.length > 0 ? names.join(", ") : "none"
}

/** L'organisation visée par une opération `target`, résolue avant elle par `runAdminOp`. */
export function targetOf(call: OpCall): Identity {
  if (call.identity) return call.identity
  throw new PlatformError("internal", "Internal error.")
}

function fieldsOf(op: AdminOp): string[] {
  return Object.keys(op.schema.shape)
}

/** L'opération nommée par `args.op`, ou `defaultOp` sans lui ; inconnue : le refus d'AC8. */
function opNamed(tool: AdminToolKey, table: OpTable, args: Record<string, unknown>, defaultOp?: string): [string, AdminOp] {
  const name = args.op === undefined ? defaultOp : args.op
  if (typeof name === "string" && Object.hasOwn(table, name)) return [name, table[name]]
  const shown = typeof args.op === "string" ? clip(args.op, MAX_NAME_CHARS) : "(missing)"
  throw new PlatformError("invalid_arguments", `Unknown op ${shown} for ${tool}. Operations: ${Object.keys(table).join(", ")}.`)
}

/** Les champs validés par le schéma de l'opération (AC8) ; un refus sans chemin est la règle de l'opération entière, servie telle quelle. */
function validated(tool: AdminToolKey, name: string, op: AdminOp, values: Record<string, unknown>): Record<string, unknown> {
  const parsed = op.schema.safeParse(values)
  if (parsed.success) return parsed.data
  const { issues } = parsed.error
  if (issues.every((issue) => issue.path.length === 0)) {
    throw new PlatformError("invalid_arguments", issues.map((issue) => issue.message).join(" "))
  }
  throw new PlatformError("invalid_arguments", `Invalid arguments for ${tool} op ${name}: ${issuesText(issues)}. Call ${tool} {"op": "help"} for details.`)
}

/**
 * Une opération d'un outil admin (AC8 à AC10), après la garde `ctx` : opération connue, aucun champ
 * en trop (cherché dans les arguments bruts, que la validation écarterait), `org` exigé, valeurs,
 * organisation visée résolue (`resolveAdminOrg`, qui décide l'accès), puis la fonction.
 */
export async function runAdminOp(
  tool: AdminToolKey,
  table: OpTable,
  args: Record<string, unknown>,
  context: { deps: AdminDeps; ctx: string; trace: OpTrace; defaultOp?: string },
): Promise<AdminOutput> {
  const [name, op] = opNamed(tool, table, args, context.defaultOp)
  const fields = fieldsOf(op)
  const extra = Object.keys(args).find((key) => !ROUTING_KEYS.has(key) && !fields.includes(key))
  if (extra !== undefined) {
    throw new PlatformError(
      "invalid_arguments",
      `Field ${clip(extra, MAX_NAME_CHARS)} is not used by op ${name} of ${tool}. Fields of ${name}: ${list(fields)}. Call ${tool} {"op": "help"} for details.`,
    )
  }
  const values = Object.fromEntries(Object.entries(args).filter(([key]) => !ROUTING_KEYS.has(key)))
  if (op.org !== "none" && values.org === undefined) {
    throw new PlatformError("invalid_arguments", `op ${name} of ${tool} needs org = the organisation slug. List yours with admin_context {"op": "orgs"}.`)
  }
  const input = validated(tool, name, op, values)
  if (op.org !== "none") context.trace.target = `org:${String(input.org)}`
  const identity = op.org === "target" ? await resolveAdminOrg(context.deps.db, context.deps.caller, String(input.org)) : null
  if (identity) context.trace.orgId = identity.org.id
  return op.run({ deps: context.deps, identity, input, ctx: context.ctx })
}

/** Lignes au plus d'une liste servie (AC23). */
export const MAX_LIST_LINES = 200

/** Une ligne par élément, `max` au plus, puis « … and N more » (ou la suite que donne `more`). */
export function listLines<T>(
  items: readonly T[],
  line: (item: T) => string,
  options: { max?: number; more?: (count: number) => string } = {},
): string[] {
  const { max = MAX_LIST_LINES, more = (count: number) => `… and ${count} more` } = options
  const lines = items.slice(0, max).map(line)
  return items.length > max ? [...lines, more(items.length - max)] : lines
}

/** La date UTC d'un horodatage de la base, `2026-09-24` : celle des lectures (`read-format.ts`). */
export { day } from "../../server/nodes/read-format"

export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

/** Un texte lu en base, sur une ligne d'une liste : ses sauts de ligne n'en font pas une seconde (lecture linéaire) (E08-S06). */
export function oneLine(text: string): string {
  return text.replace(/[\r\n]+/g, " ")
}

/** Les `max` premiers éléments, puis « +N more » ; `total` : leur nombre quand `items` n'en porte que le début (AC21). */
export function firstOf(items: readonly string[], max: number, total = items.length): string {
  const shown = items.slice(0, max)
  return [...shown, ...(total > shown.length ? [`+${total - shown.length} more`] : [])].join(", ")
}

/** La dernière phrase d'un premier temps (N7, H86) : rien n'est fait sans l'accord de l'utilisateur. */
export function nothingWas(done: string): string {
  return `Nothing was ${done}. Show this to the user and ask for explicit approval, then call again with confirm: true.`
}

/** Les refus que toute opération peut rendre, écrits une fois dans le contrat. */
const COMMON_REFUSALS = [
  "Refusals of every operation:",
  `- ctx_missing: ${ADMIN_CTX_MISSING}`,
  `- ctx_stale: ${ADMIN_CTX_STALE}`,
  "- not_found: Unknown organisation <org>, or you have no platform access to it (operations that take org).",
]

/** Le contrat d'une opération (`describeFunction`) : deux temps, résumé, champs tirés du schéma, exemple, refus. */
function describeOp(tool: AdminToolKey, name: string, op: AdminOp): string[] {
  const fields: [string, z.ZodType][] = Object.entries(op.schema.shape)
  const optional = (schema: z.ZodType) => schema.safeParse(undefined).success
  const required = fields.filter(([, schema]) => !optional(schema)).map(([field]) => field)
  const facultative = fields.filter(([, schema]) => optional(schema)).map(([field]) => field)
  const example = { op: name, ...(tool === "admin_context" ? {} : { ctx: EXAMPLE_CTX }), ...op.example }
  const steps = op.twoStep ? " (two steps: without confirm: true it returns a summary and changes nothing)" : ""
  return [
    `Op ${name}${steps}`,
    op.summary,
    `Required: ${list(required)}. Optional: ${list(facultative)}.`,
    `Example: ${tool} ${JSON.stringify(example)}`,
    "Possible refusals:",
    ...(op.refusals.length > 0 ? op.refusals.map((refusal) => `- ${refusal}`) : ["- none beyond those of every operation"]),
  ]
}

/** Ce que sert `op help` (AC4, H105) : le contrat de chaque opération de l'outil, dans l'ordre de sa table. */
export function renderHelp(tool: AdminToolKey, table: OpTable): string {
  const intro = tool === "admin_context" ? [] : [`Operations of ${tool}: pass ctx on every call, and org = the organisation slug where required.`, ...COMMON_REFUSALS]
  const ops = Object.entries(table).filter(([name]) => name !== "help")
  return [...intro, ...ops.flatMap(([name, op]) => ["", ...describeOp(tool, name, op)])].join("\n").trim()
}
