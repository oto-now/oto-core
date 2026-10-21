// Signalements des assistants (FR-OBS-01, DF « Observabilité et sécurité ») : un ticket numéroté
// par organisation (`FB-0001`, P3), lié au `ctx`, donc recoupable avec le journal de la
// conversation. Sans ce module, `feedback` répond « Not available yet » et une friction vue par le
// modèle ne laisse aucune trace. L'outil ne fait qu'ajouter (H23) : aucun changement d'état ici
// (E08-S06).
//
// Repris de la maquette (`mcp-test/src/proto/services/feedback.ts` l. 8-24) : insertion puis
// `FB-%04d`, texte « Ticket … recorded. », cible du journal = le ticket. Ajouté : doublon, `target`,
// données en champs, numéro par organisation. Repris d'Oto (`oto_mcp/db/usage.py` l. 480-546,
// `capabilities/usage.py` l. 25-91) : fenêtre de 10 minutes ; texte entier, auteur, organisation,
// type et cible comparés ; le ticket existant rendu et dit, jamais un refus, avec la consigne de dire
// ce qui a changé ; ticket créé à l'état `open`. Retiré : `session_id` et `source` (le `ctx` les
// remplace), `signal` et `kind` libres (→ `type` en liste fermée), la consigne portée par la notice
// serveur (architecture § 10).
import {
  FEEDBACK_VISIBLE,
  feedbackStateChangeSchema,
  feedbackStateSchema,
  feedbackTypeSchema,
  ticketSchema,
  type FeedbackCounts,
  type FeedbackInput,
  type FeedbackList,
  type FeedbackState,
  type FeedbackStateChange,
  type FeedbackTicketView,
  type FeedbackType,
} from "../schemas"
import { isOrgAdmin } from "./access"
import type { PlatformDb } from "./db"
import { memberDirectory } from "./directory"
import { inTransaction, invalidInput, PlatformError } from "./errors"
import { readFlag } from "./flags"
import type { Identity } from "./identity"
import type { Tx } from "./sql"
import type { ToolOutput } from "./tool-output"
import { pseudonymizerFor } from "./pseudonym/service"

/**
 * Fenêtre du rejeu (Oto) : un rejeu arrive dans la seconde ou la minute (réseau coupé, réponse non
 * vue) ; un défaut qui se reproduit vraiment ne se raconte pas deux fois mot pour mot si vite.
 */
const DUPLICATE_WINDOW_MINUTES = 10
/** Les bornes de `platform.feedback` (`feedback_text_check`, `feedback_target_check`). */
const FEEDBACK_TEXT_MAX = 4000
const FEEDBACK_TARGET_MAX = 500

/**
 * Tickets relus pour y chercher le même texte, les plus récents d'abord (N6). Le texte se compare
 * ici, pas dans le filtre : forme d'E03-S05, où un filtre voyageait dans l'adresse de PostgREST,
 * gardée telle quelle par la face SQL (E01-S10, comportement identique). Au-delà de ce nombre de
 * tickets du même type et de la même cible en 10 minutes, un rejeu fait un ticket de plus, jamais un
 * ticket perdu.
 */
const DUPLICATE_SCAN_ROWS = 50

/** `FB-0007` : le numéro de l'organisation (`feedback.number`, P3), sur quatre chiffres au moins. */
export function ticketNumber(number: number): string {
  return `FB-${String(number).padStart(4, "0")}`
}

/** Aveu du doublon ; `minutes` écoulées depuis le ticket, arrondies, une au moins. */
/**
 * Ce que l'assistant lit après un signalement (21/10) : rien qu'il répéterait à la personne, ni numéro de ticket ni
 * « l'équipe a été prévenue ». Le retour sert aux mainteneurs de la plateforme ; une personne qui lisait « ticket FB-0002 »
 * ne savait qu'en faire. Le numéro reste au journal (`target`) et à l'écran « Retours ».
 */
export const FEEDBACK_RECORDED = "Recorded for the platform maintainers; nothing to tell the user."

export function duplicateMessage(minutes: number): string {
  const shown = Math.max(1, Math.round(minutes))
  return `Already recorded ${shown} minute(s) ago with the same text, for the platform maintainers; nothing new was recorded and nothing to tell the user. If the problem happened again, record what changed: another call, another argument or another moment.`
}

type Report = { type: FeedbackInput["type"]; text: string; target: string | null }

type RecentTicket = { number: number; state: string; created_at: string; text: string }

/**
 * Le ticket de la même personne, dans la même organisation, au même type, au même texte et à la
 * même cible (absente des deux côtés comprise), créé depuis moins de 10 minutes (N1). Filtré ici sur
 * l'organisation et la personne : seuls ses tickets sont lus, la RLS n'est qu'un garde-fou (E01-S07).
 * `created_at` passe par `to_json`, en texte ISO comme PostgREST le rendait.
 */
async function sameReport(sql: Tx, identity: Identity, report: Report): Promise<RecentTicket | null> {
  const since = new Date(Date.now() - DUPLICATE_WINDOW_MINUTES * 60_000)
  const recent = await sql<{ row: RecentTicket }[]>`
    select (select to_json(r) from (select f.number, f.state, f.created_at, f.text) r) as row
    from platform.feedback f
    where f.org_id = ${identity.org.id} and f.user_id = ${identity.user.id} and f.type = ${report.type}
      and f.created_at >= ${since} and f.target is not distinct from ${report.target}
    order by f.id desc
    limit ${DUPLICATE_SCAN_ROWS}`
  return recent.map(({ row }) => row).find((row) => row.text === report.text) ?? null
}

/**
 * `feedback` : crée le ticket, ou rend celui du même signalement déposé depuis moins de 10 minutes,
 * sans ligne nouvelle. Texte servi au modèle et données en champs (H26) ; la cible du journal est le
 * ticket. La recherche du doublon et l'insertion tiennent dans une transaction.
 */
export async function recordFeedback(
  db: PlatformDb,
  identity: Identity,
  input: FeedbackInput,
  ctx: string | null,
): Promise<ToolOutput> {
  // Une moitié de paire de substitution envoyée par le host devient U+FFFD, comme au journal : le texte
  // comparé au doublon est celui qu'on écrit (`supabase-patterns.md § Error Handling`).
  const written: Report = { type: input.type, text: input.text.toWellFormed(), target: input.target?.toWellFormed() ?? null }
  // Pseudonymisé à l'écriture : l'équipe plateforme, qui traite les retours, est un tiers pour l'organisation (J2).
  const gate = await pseudonymizerFor(db, identity.org.id)
  // Un jeton est plus long que le nom qu'il remplace : le texte gardé reste sous les bornes de la table (4 000 et 500).
  const gated = (text: string, max: number) => (gate ? [...gate.text(text)].slice(0, max).join("") : text)
  const report: Report = { ...written, text: gated(written.text, FEEDBACK_TEXT_MAX), target: written.target === null ? null : gated(written.target, FEEDBACK_TARGET_MAX) }
  return inTransaction(db, "recordFeedback: feedback", async (sql): Promise<ToolOutput> => {
    const existing = await sameReport(sql, identity, report)
    if (existing) {
      const ticket = ticketNumber(existing.number)
      return {
        text: duplicateMessage((Date.now() - Date.parse(existing.created_at)) / 60_000),
        data: { recorded: true, type: report.type, duplicate: true },
        nextActions: [],
        target: ticket,
      }
    }
    // `number` est posé par la base (déclencheur `feedback_number`, E01-S06).
    const [inserted] = await sql<{ number: number }[]>`
      insert into platform.feedback (org_id, user_id, ctx, type, text, target)
      values (${identity.org.id}, ${identity.user.id}, ${ctx}, ${report.type}, ${report.text}, ${report.target})
      returning number`
    const ticket = ticketNumber(inserted.number)
    return {
      text: FEEDBACK_RECORDED,
      data: { recorded: true, type: report.type, duplicate: false },
      nextActions: [],
      target: ticket,
    }
  })
}

// ------------------------------------------------------------------ Administration (E08-S09)
// Liste et état des tickets, pour l'écran « Retours » et `admin_feedback` (E08-S06) : « Rien n'existe
// que dans le MCP admin » (DF). Réservés à qui administre l'organisation, décidé ici avant toute
// lecture ou écriture (N9, H123) ; le filtre de l'organisation est posé dans chaque requête. Repris
// d'Oto (`docs/usage-loop.md` l. 56-100, `capabilities/usage.py` l. 200-223) : quatre états, « à
// traiter » = ouverts et pris en compte, motif exigé pour décliner, retour à `open` qui efface la
// décision, comptes par état avec la liste. Retiré : ré-aiguillage, avis par email, notice serveur.

const LIST_PAGE = 50
const DAY_MS = 86_400_000
const TO_HANDLE: readonly FeedbackState[] = ["open", "acknowledged"]
// Textes d'E08-S06 (AC18), qui sert ces refus au modèle par `admin_feedback`.
const MALFORMED_TICKET = "ticket must look like FB-0012."
const DECLINE_NEEDS_RESOLUTION = "A declined ticket needs a resolution: pass resolution = why it will not be handled, which the reporter will read."
/** L'instant d'une ligne tel que PostgREST le rend : seul texte admis dans le filtre du curseur (lu aussi par `admin/journal.ts`, E08-S06). */
export const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/

type TicketRow = {
  id: number
  number: number
  created_at: string
  user_id: string | null
  ctx: string | null
  type: string
  target: string | null
  text: string
  state: string
  resolution: string | null
  handled_by: string | null
  handled_at: string | null
}

/**
 * Un ticket (`f`), tel que PostgREST le rendait : passé par `to_json` dans la requête qui le rend,
 * `created_at` et `handled_at` en texte ISO à la microseconde, `id` en nombre (postgres.js rendrait des
 * `Date` et une chaîne).
 */
function ticketRow(sql: Tx) {
  return sql`(select to_json(t) from (select f.id, f.number, f.created_at, f.user_id, f.ctx, f.type, f.target, f.text, f.state, f.resolution, f.handled_by, f.handled_at) t)`
}

/** Le numéro d'un ticket « FB-0012 » (l'inverse de `ticketNumber`), sinon `invalid_arguments`. */
export function parseTicket(ticket: unknown): number {
  const parsed = ticketSchema.safeParse(ticket)
  if (!parsed.success) throw new PlatformError("invalid_arguments", MALFORMED_TICKET)
  return parsed.data
}

/**
 * Traiter les retours : des frictions d'assistant, destinées à l'équipe plateforme (E05-S13, AC-9, HN-E05S13-7),
 * donc au membre de l'équipe plateforme qui administre l'organisation, la règle de `requireStaffAdmin`
 * (`isStaff` et `isOrgAdmin`) ; l'administrateur du client y entre quand l'organisation a allumé « Retours visibles »
 * (drapeau `feedback_visible`, 1.4.13), lu en une requête, et seulement pour lui. Lu aussi par l'hôte, qui ne donne
 * l'adresse des retours qu'à qui les traite.
 */
export async function handlesFeedback(db: PlatformDb, identity: Identity): Promise<boolean> {
  if (!isOrgAdmin(identity)) return false
  return identity.isStaff || readFlag(db, identity, FEEDBACK_VISIBLE)
}

/** Le refus de qui ne traite pas les retours (AC-9), avec à qui s'adresser (H68). */
function handlingReserved(identity: Identity): PlatformError {
  return new PlatformError(
    "forbidden",
    `Handling the feedback of ${identity.org.name} is reserved to the platform team that administers it, and to its administrators when « Retours visibles » is on. Ask them.`,
  )
}

async function namesOf(db: PlatformDb, identity: Identity): Promise<Map<string, string>> {
  const directory = await memberDirectory(db, identity.org.id)
  return new Map(directory.map((person) => [person.userId, person.name]))
}

function viewOf(row: TicketRow, names: ReadonlyMap<string, string>): FeedbackTicketView {
  const nameOf = (userId: string | null) => (userId ? (names.get(userId) ?? null) : null)
  return {
    ticket: ticketNumber(row.number),
    number: row.number,
    createdAt: row.created_at,
    person: nameOf(row.user_id),
    // Les checks de `feedback.type` et `feedback.state` garantissent ces valeurs.
    type: feedbackTypeSchema.parse(row.type),
    target: row.target,
    text: row.text,
    state: feedbackStateSchema.parse(row.state),
    resolution: row.resolution,
    handledBy: nameOf(row.handled_by),
    handledAt: row.handled_at,
    ctx: row.ctx,
  }
}

type Cursor = { createdAt: string; id: number }

/** Un jeton opaque : base64url de `[created_at, id]` de la dernière ligne servie (`api-patterns.md § Pagination`). */
function encodeCursor(row: TicketRow): string {
  return Buffer.from(JSON.stringify([row.created_at, row.id])).toString("base64url")
}

function decodeCursor(value: string): Cursor | null {
  try {
    const parts: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"))
    if (!Array.isArray(parts) || parts.length !== 2) return null
    const [createdAt, id] = parts
    const valid = typeof createdAt === "string" && INSTANT.test(createdAt) && typeof id === "number" && Number.isSafeInteger(id)
    return valid ? { createdAt, id } : null
  } catch {
    // Un curseur illisible : la liste repart du début.
    return null
  }
}

type Window = { since: string; type?: FeedbackType }

/**
 * Une page de la fenêtre, triée par `created_at` puis `id` décroissants, après le curseur composite
 * (AC12) : son instant, lu à la microseconde, repasse en texte converti dans la requête, jamais par une
 * `Date` qui le couperait à la milliseconde (`supabase-patterns.md § Couplage à Supabase (ADR-012)`).
 */
async function readTickets(
  db: PlatformDb,
  identity: Identity,
  request: Window & { state?: FeedbackState | "to_handle"; cursor: Cursor | null },
): Promise<TicketRow[]> {
  const states = request.state === "to_handle" ? [...TO_HANDLE] : request.state ? [request.state] : null
  const { cursor } = request
  const rows = await inTransaction(db, "listFeedback: feedback", (sql) => sql<{ row: TicketRow }[]>`
    select ${ticketRow(sql)} as row
    from platform.feedback f
    where f.org_id = ${identity.org.id} and f.created_at >= ${new Date(request.since)}
      ${request.type ? sql`and f.type = ${request.type}` : sql``}
      ${states ? sql`and f.state = any(${states})` : sql``}
      ${cursor ? sql`and (f.created_at, f.id) < (${cursor.createdAt}::text::timestamptz, ${cursor.id})` : sql``}
    order by f.created_at desc, f.id desc
    limit ${LIST_PAGE + 1}`)
  return rows.map(({ row }) => row)
}

/** Les comptes par état de la fenêtre et du type, quel que soit le filtre d'état : tous ses tickets, comptés par la base. */
async function countByState(db: PlatformDb, identity: Identity, request: Window): Promise<FeedbackCounts> {
  const rows = await inTransaction(db, "listFeedback: counts", (sql) => sql<{ state: string; tickets: number }[]>`
    select f.state, count(*)::int as tickets
    from platform.feedback f
    where f.org_id = ${identity.org.id} and f.created_at >= ${new Date(request.since)}
      ${request.type ? sql`and f.type = ${request.type}` : sql``}
    group by f.state`)
  const counts: FeedbackCounts = { open: 0, acknowledged: 0, resolved: 0, declined: 0 }
  for (const row of rows) counts[feedbackStateSchema.parse(row.state)] += row.tickets
  return counts
}

/** Les filtres de `listFeedback` : sans `state`, tous les états ; `days` : la fenêtre (E08-S06 : 30 par défaut). */
export type FeedbackListInput = { state?: FeedbackState | "to_handle"; type?: FeedbackType; days: number; cursor?: string }

/**
 * Les tickets de l'organisation de la fenêtre (AC12), 50 par page, la personne nommée par
 * `member_directory`, et les comptes par état sur la fenêtre et le type. Un curseur illisible fait
 * repartir la liste du début.
 */
export async function listFeedback(db: PlatformDb, identity: Identity, input: FeedbackListInput): Promise<FeedbackList> {
  if (!(await handlesFeedback(db, identity))) throw handlingReserved(identity)
  const window: Window = { since: new Date(Date.now() - input.days * DAY_MS).toISOString(), type: input.type }
  const cursor = input.cursor === undefined ? null : decodeCursor(input.cursor)
  const [rows, counts, names] = await Promise.all([
    readTickets(db, identity, { ...window, state: input.state, cursor }),
    countByState(db, identity, window),
    namesOf(db, identity),
  ])
  const shown = rows.slice(0, LIST_PAGE)
  const last = shown.at(-1)
  return { tickets: shown.map((row) => viewOf(row, names)), counts, nextCursor: rows.length > LIST_PAGE && last ? encodeCursor(last) : null }
}

/** Une demande de changement d'état : le ticket et ce qu'envoie l'écran ou le MCP admin, non encore validés. */
export type FeedbackStateRequest = { ticket: unknown; state?: unknown; resolution?: unknown }

function changeOf({ state, resolution }: FeedbackStateRequest): FeedbackStateChange {
  const missing = typeof resolution !== "string" || resolution.trim().length < 3
  if (state === "declined" && missing) throw new PlatformError("invalid_arguments", DECLINE_NEEDS_RESOLUTION)
  const parsed = feedbackStateChangeSchema.safeParse({ state, resolution })
  if (!parsed.success) throw invalidInput(parsed.error)
  return parsed.data
}

/** Retour à `open` : la décision est effacée (N5) ; sinon qui et quand, et la résolution si elle est passée. */
function patchOf(change: FeedbackStateChange, identity: Identity) {
  if (change.state === "open") return { state: "open", resolution: null, handled_by: null, handled_at: null }
  // Une moitié de paire de substitution (écran, ou modèle par le MCP admin) devient U+FFFD, comme le
  // texte d'un ticket dans `recordFeedback` (`supabase-patterns.md § Error Handling`).
  const resolution = change.resolution === undefined ? {} : { resolution: change.resolution.toWellFormed() }
  // Une `Date`, à la milliseconde : l'instant de la décision, pris ici (`supabase-patterns.md § Couplage à Supabase (ADR-012)`).
  return { state: change.state, handled_by: identity.user.id, handled_at: new Date(), ...resolution }
}

/**
 * Change l'état d'un ticket de l'organisation de l'appelant (AC11) : validé, puis réservé à l'équipe
 * plateforme qui l'administre (`handlesFeedback`) avant toute lecture ; cherché par `(org_id, number)` ; même état, rien d'écrit ;
 * écriture gardée par l'état lu (`security-patterns.md § Idempotence et mutations concurrentes`) : un ticket changé entre-temps
 * rend `conflict`, journalisé. Les noms d'abord, puis la lecture et l'écriture dans une transaction :
 * une panne de l'annuaire ne laisse aucun ticket écrit.
 */
export async function setFeedbackState(
  db: PlatformDb,
  identity: Identity,
  request: FeedbackStateRequest,
): Promise<{ changed: boolean; ticket: FeedbackTicketView }> {
  const number = parseTicket(request.ticket)
  const change = changeOf(request)
  if (!(await handlesFeedback(db, identity))) throw handlingReserved(identity)
  const ticket = ticketNumber(number)
  const names = await namesOf(db, identity)
  return inTransaction(db, "setFeedbackState: feedback", async (sql) => {
    const [read] = await sql<{ row: TicketRow }[]>`
      select ${ticketRow(sql)} as row from platform.feedback f where f.org_id = ${identity.org.id} and f.number = ${number}`
    if (!read) throw new PlatformError("not_found", `Unknown ticket ${ticket} in ${identity.org.name}.`)
    if (read.row.state === change.state) return { changed: false, ticket: viewOf(read.row, names) }
    const [written] = await sql<{ row: TicketRow }[]>`
      update platform.feedback f set ${sql(patchOf(change, identity))}
      where f.org_id = ${identity.org.id} and f.number = ${number} and f.state = ${read.row.state}
      returning ${ticketRow(sql)} as row`
    if (!written) {
      console.error(`[platform] setFeedbackState: no row written for ticket ${ticket} of organisation ${identity.org.id}`)
      throw new PlatformError("conflict", `${ticket} changed meanwhile. Read it again, then retry.`)
    }
    return { changed: true, ticket: viewOf(written.row, names) }
  })
}
