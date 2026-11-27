// Opérations d'`admin_journal` (E08-S06, AC14 à AC16 ; N7), en lecture seule : les conversations d'une
// organisation et les appels d'une conversation par la lecture d'E05-S05 (portée H74 décidée par elle,
// fenêtre gelée, arguments masqués et coupés, et ce que lui ajoute M14 pour l'espace personnel d'autrui,
// fiche D44), le journal du connecteur admin par `listAdminLog`. Chaque page tient sous le plafond de
// 45 000 caractères (H26) : on sert le plus d'éléments qui y tiennent, la suite par curseur après le
// dernier servi, jamais une coupe du formateur qui sauterait des lignes. La coupe, les champs d'une
// conversation et d'un appel, et le texte d'un appel masqué sont ceux de `read journal` (M18a).
import * as z from "zod/v4"
import { emailSchema, orgSlugSchema, type ConversationSummary, type JournalCall } from "../../../schemas"
import { journalPeriodSchema } from "../../../schemas/journal"
import { findMember, findStaff, findTeam, resolveAdminOrg } from "../../../server/admin/context"
import { listAdminLog, type AdminLogEntry } from "../../../server/admin/journal"
import { PlatformError } from "../../../server/errors"
import { callData, fittedPage, HIDDEN_ARGS, summaryData, type PageFrame, type PagePiece } from "../../../server/journal-model"
import { readConversation, readConversations } from "../../../server/journal-read"
import { oneLine, plural, renderHelp, targetOf, type AdminOutput, type OpCall, type OpTable } from "../ops"

/** Un curseur qui ne mène plus à rien : la première page, dite par `admin_journal` et `admin_connector catalogue`. */
export const RESTARTED = "The cursor is no longer valid: this is the first page again."
const TRUNCATED = "The period has more than 2,000 calls: only the most recent are grouped here. Narrow the period or filter."

/** Le plus grand nombre d'éléments qui tiennent sous le plafond (H26, AC22), une ligne chacun, la suite par `next_cursor`. */
function served(frame: Omit<PageFrame, "tail" | "continueLine">, pieces: readonly PagePiece[]): AdminOutput {
  const { text, data } = fittedPage({ ...frame, tail: [], continueLine: (cursor) => `next_cursor: ${cursor}` }, pieces)
  return { text, data, nextActions: frame.nextActions }
}

/** « 2026-09-24 14:02 UTC » ; « 14:03:40 » avec `seconds` seulement. */
function when(ts: string, seconds = false): string {
  const date = new Date(ts)
  if (Number.isNaN(date.getTime())) return ts
  const iso = date.toISOString()
  return seconds ? iso.slice(11, 19) : `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`
}

const filtersText = (parts: (string | null)[]) => parts.filter((part) => part !== null).map((part) => `, ${part}`).join("")

const daysOf = (value: unknown, fallback: number) => journalPeriodSchema.safeParse(value).data ?? fallback
const textOf = (value: unknown) => (typeof value === "string" ? value : undefined)

/** « <date heure> · <code> · <personne> · <host> · served <chemin> · <n> calls, <n> errors » (AC14). */
function conversationText(summary: ConversationSummary): string {
  const served = summary.procedurePath ? `served ${summary.procedurePath}` : "no procedure served"
  const who = summary.userName ?? "removed person"
  const counts = `${plural(summary.calls, "call", "calls")}, ${plural(summary.errors, "error", "errors")}`
  return `${when(summary.lastAt)} · ${summary.ctx} · ${who} · ${summary.host ?? "unknown host"} · ${served} · ${counts}`
}

async function conversations(call: OpCall): Promise<AdminOutput> {
  const { db } = call.deps
  const identity = targetOf(call)
  const days = daysOf(call.input.days, 7)
  const team = textOf(call.input.team) ? await findTeam(db, identity, String(call.input.team)) : null
  const person = textOf(call.input.email) ? await findMember(db, identity, String(call.input.email)) : null
  const errorsOnly = call.input.errors === true
  const list = await readConversations(db, identity, { periodDays: days, teamId: team?.id, userId: person?.userId, errorsOnly, cursor: textOf(call.input.cursor) })
  const { page } = list
  const head = [...(page.restarted ? [RESTARTED] : []), ...(page.truncated ? [TRUNCATED] : [])]
  const nextActions = ["admin_journal conversation"]
  if (page.conversations.length === 0) {
    const filters = filtersText([team ? `team ${team.slug}` : null, person ? `person ${person.email}` : null, errorsOnly ? "errors only" : null])
    return { text: [...head, `No conversation in ${identity.org.slug} over the last ${days} days${filters}.`].join("\n"), data: { conversations: [], next_cursor: null }, nextActions }
  }
  const pieces = page.conversations.map((summary) => ({ lines: [`- ${conversationText(summary)}`], data: summaryData(summary) }))
  const data = { total: page.total, calls: page.calls, with_errors: page.withErrors, truncated: page.truncated }
  const cursorFor = (count: number) => (count < pieces.length ? list.cursorAt(list.rank + count) : page.nextCursor)
  return served({ head, items: "conversations", data, nextActions, cursorFor }, pieces)
}

/** « - <heure> · <outil> <cible> · ok (ou error: …) · <n> ms · args <JSON> » (AC15) ; un appel masqué par la lecture (D44) : `HIDDEN_ARGS`. */
function callLine(entry: JournalCall): string {
  const target = entry.target ? ` ${oneLine(entry.target)}` : ""
  const outcome = entry.isError ? `error: ${oneLine(entry.error ?? "unknown")}` : "ok"
  const duration = entry.durationMs === null ? [] : [`${entry.durationMs} ms`]
  const args = entry.hidden ? HIDDEN_ARGS : `args ${JSON.stringify(entry.args)}`
  return [`- ${when(entry.ts, true)}`, `${entry.tool}${target}`, outcome, ...duration, args].join(" · ")
}

async function conversation(call: OpCall): Promise<AdminOutput> {
  const identity = targetOf(call)
  const code = String(call.input.code).trim().toUpperCase()
  const read = await readConversation(call.deps.db, identity, code, { cursor: textOf(call.input.cursor) })
  if (!read) throw new PlatformError("not_found", `No conversation ${code} in ${identity.org.slug}.`)
  const { summary, calls, nextCursor } = read.detail
  const head = [...(read.restarted ? [RESTARTED] : []), `Conversation ${conversationText(summary)}`]
  const pieces = calls.map((entry) => ({ lines: [callLine(entry)], data: callData(entry) }))
  const cursorFor = (count: number) => (count < pieces.length ? read.cursorAfter(calls[count - 1].id) : nextCursor)
  const output = served({ head, items: "calls", data: { conversation: summaryData(summary) }, nextActions: ["admin_feedback list"], cursorFor }, pieces)
  return { ...output, target: `conversation:${code}` }
}

function logLine(entry: AdminLogEntry, withArgs: boolean): string {
  const what = [entry.tool ?? entry.method, entry.op].filter((part) => part !== null).join(" ")
  const org = entry.orgId === null ? "—" : (entry.org ?? "an organisation you cannot read")
  const duration = entry.durationMs === null ? [] : [`${entry.durationMs} ms`]
  const outcome = entry.isError && withArgs && entry.error ? `error: ${oneLine(entry.error)}` : entry.isError ? "error" : "ok"
  const args = withArgs ? [entry.hidden ? HIDDEN_ARGS : `args ${JSON.stringify(entry.args ?? null)}`] : []
  const who = entry.email ?? "a former platform team member"
  return [`- ${when(entry.ts)}`, who, what, org, entry.target ? oneLine(entry.target) : "—", outcome, ...duration, ...args].join(" · ")
}

function logData(entry: AdminLogEntry): Record<string, unknown> {
  const { ts, email, tool, op, org, target, isError, durationMs, ctx, args, hidden } = entry
  const data = { at: ts, email, tool, op, org, target, is_error: isError, duration_ms: durationMs, ctx, ...(args === undefined ? {} : { args }) }
  return hidden ? { ...data, args_hidden: true } : data
}

async function adminLog(call: OpCall): Promise<AdminOutput> {
  const { db, caller } = call.deps
  const days = daysOf(call.input.days, 7)
  // `org` est un filtre facultatif (H105, N4) : résolu comme partout, avec le même refus (AC10 d'E08-S02).
  const identity = textOf(call.input.org) ? await resolveAdminOrg(db, caller, String(call.input.org)) : null
  const staff = textOf(call.input.email) ? await findStaff(db, String(call.input.email)) : null
  const code = textOf(call.input.code)?.trim().toUpperCase()
  const page = await listAdminLog(db, caller, { orgId: identity?.org.id, userId: staff?.userId, days, code, cursor: textOf(call.input.cursor) })
  const scope = { orgId: identity?.org.id ?? null, target: identity ? `org:${identity.org.slug}` : null }
  const head = page.restarted ? [RESTARTED] : []
  if (page.entries.length === 0) {
    const filters = filtersText([identity ? `org ${identity.org.slug}` : null, staff ? `person ${staff.email}` : null, code ? `session ${code}` : null])
    return { ...scope, text: [...head, `No line in the admin journal over the last ${days} days${filters}.`].join("\n"), data: { rows: [], next_cursor: null }, nextActions: [] }
  }
  const pieces = page.entries.map((entry) => ({ lines: [logLine(entry, code !== undefined)], data: logData(entry) }))
  const cursorFor = (count: number) => (count < pieces.length ? page.cursorAfter(page.entries[count - 1]) : page.nextCursor)
  return { ...served({ head, items: "rows", data: {}, nextActions: [], cursorFor }, pieces), ...scope }
}

const period = journalPeriodSchema.optional()
const cursor = z.string().max(200).optional()
/** Un code de conversation ou de session, lu sans casse ; mal formé, il ne désigne rien (AC15). */
const codeField = z.string().max(100)

export const JOURNAL_OPS: OpTable = {
  help: {
    schema: z.object({}),
    org: "none",
    twoStep: false,
    summary: "Gives the fields of each operation of admin_journal.",
    example: {},
    refusals: [],
    run: async () => ({ text: renderHelp("admin_journal", JOURNAL_OPS), nextActions: [] }),
  },
  conversations: {
    schema: z.object({ org: orgSlugSchema, team: z.string().trim().min(1).max(100).optional(), email: emailSchema.optional(), errors: z.boolean().optional(), days: period, cursor }),
    org: "target",
    twoStep: false,
    summary: "Lists the conversations of the organisation, most recent first, grouped by ctx code: person, host, procedure served, calls and errors (7 days by default).",
    example: { org: "acme", errors: true, days: 7 },
    refusals: ["not_found: Unknown team <team> in <org>.", "not_found: No member of <org> has the email <email>."],
    run: conversations,
  },
  conversation: {
    schema: z.object({ org: orgSlugSchema, code: codeField, cursor }),
    org: "target",
    twoStep: false,
    summary: "Lists the calls of one conversation: time, tool and target, outcome, duration and arguments, secret-looking values masked.",
    example: { org: "acme", code: "7K3Q-M2XA" },
    refusals: ["not_found: No conversation <code> in <org>."],
    run: conversation,
  },
  admin_log: {
    schema: z.object({ org: orgSlugSchema.optional(), email: emailSchema.optional(), days: period, code: codeField.optional(), cursor }),
    org: "none",
    twoStep: false,
    summary: "Lists the lines of this admin connector's journal for the whole platform team, most recent first; with code, the lines of one admin session with their arguments, masked.",
    example: { org: "acme", days: 7 },
    refusals: ["not_found: No member of the platform team has the email <email>.", "not_found: Unknown organisation <org>, or you have no platform access to it."],
    run: adminLog,
  },
}
