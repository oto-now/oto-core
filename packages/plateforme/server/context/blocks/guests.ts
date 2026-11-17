// Bloc « Shared with you by other teams » de `context` : la vue invité de la personne (`nodes/guest-entries.ts`), une équipe
// par intertitre, un point d'entrée par ligne avec son résumé, qui dit quand s'en servir. Le même texte quelle que soit la
// demande : ni classement, ni plafond en lignes ; le repli ne dépend que de la taille. Sans lui, un assistant ne cherche
// pas ce qu'une autre équipe a ouvert à la sienne : il ignore que cela existe.
import { CONTEXT_INDEX, SERVED_GUESTS } from "../../../schemas"
import type { PlatformDb } from "../../db"
import type { Identity } from "../../identity"
import { clip } from "../../journal"
import { formatCount } from "../../nodes/document"
import { guestTeams, type GuestEntry, type GuestTeam } from "../../nodes/guest-entries"
import type { ContextBlock } from "../engine"
import { leadsByTeam, teamLine } from "./team"

/** Le bloc servi aux résumés entiers, puis coupés, tant qu'il tient dans cette taille. */
export const GUESTS_FULL_MAX = 5_000

/** Sans résumé, le bloc tient dans cette taille ; au-delà, une ligne par équipe. */
export const GUESTS_PLAIN_MAX = 10_000

/** Caractères d'un résumé coupé, à un mot. */
export const GUEST_SUMMARY_MAX = 100

/** Une équipe invitante et ses responsables nommés. */
export type GuestView = GuestTeam & { leads: string[] }

type Summaries = "whole" | "short" | "none"

/** Le résumé coupé à son dernier mot entier dans la borne, suivi de « … ». */
function shortened(summary: string): string {
  if (summary.length <= GUEST_SUMMARY_MAX) return summary
  const cut = clip(summary, GUEST_SUMMARY_MAX)
  const space = cut.lastIndexOf(" ")
  return `${(space > 0 ? cut.slice(0, space) : cut).trimEnd()}${SERVED_GUESTS.cutMark}`
}

function entryLine(entry: GuestEntry, summaries: Summaries): string {
  const { item, separator } = CONTEXT_INDEX
  const under = entry.under > 0 ? `${SERVED_GUESTS.underStart}${formatCount(entry.under)}${SERVED_GUESTS.underEnd}` : ""
  // Un résumé n'est jamais vide : la base l'exige (`nodes_summary_check`).
  const summary = summaries === "none" ? "" : `${separator}${summaries === "short" ? shortened(entry.summary) : entry.summary}`
  return `${item}${entry.path}${under}${separator}${entry.title}${summary}`
}

const heading = (team: GuestView) => `${SERVED_GUESTS.team}${teamLine(team.name, team.leads)}`

const notice = (prefix: string) => `${SERVED_GUESTS.noticeStart}${prefix}${SERVED_GUESTS.noticeMiddle}${prefix}${SERVED_GUESTS.noticeEnd}`

function listed(teams: readonly GuestView[], prefix: string, summaries: Summaries): string {
  return [SERVED_GUESTS.title, notice(prefix), ...teams.flatMap((team) => [heading(team), ...team.entries.map((entry) => entryLine(entry, summaries))])].join("\n")
}

/** Une ligne par équipe : ses responsables, le compte de ses contenus lisibles, et comment les trouver. */
function counted(teams: readonly GuestView[], prefix: string): string {
  const line = (team: GuestView) => {
    const count = team.entries.reduce((sum, entry) => sum + 1 + entry.under, 0)
    return `${heading(team)} ${formatCount(count)}${count === 1 ? SERVED_GUESTS.countOne : SERVED_GUESTS.countMany}${prefix}${SERVED_GUESTS.countEnd}`
  }
  return [SERVED_GUESTS.title, notice(prefix), ...teams.map(line)].join("\n")
}

/**
 * Le texte du bloc et son palier, par la taille seule, le palier valant pour tout le bloc : 1, résumés entiers tant
 * que le bloc tient en `GUESTS_FULL_MAX` ; 2, tous coupés à `GUEST_SUMMARY_MAX` ; 3, s'il dépasse encore, sans résumé ;
 * 4, si le bloc sans résumé dépasse `GUESTS_PLAIN_MAX`, une ligne par équipe.
 */
export function guestsText(teams: readonly GuestView[], prefix: string): { text: string; tier: 1 | 2 | 3 | 4 } {
  const whole = listed(teams, prefix, "whole")
  if (whole.length <= GUESTS_FULL_MAX) return { text: whole, tier: 1 }
  const short = listed(teams, prefix, "short")
  if (short.length <= GUESTS_FULL_MAX) return { text: short, tier: 2 }
  const plain = listed(teams, prefix, "none")
  if (plain.length <= GUESTS_PLAIN_MAX) return { text: plain, tier: 3 }
  return { text: counted(teams, prefix), tier: 4 }
}

/** Le bloc, ou `null` sans vue invité ; `cut` dès qu'un repli retire quelque chose, pour que l'aperçu le dise. */
export async function guestsBlock(db: PlatformDb, identity: Identity): Promise<ContextBlock | null> {
  const teams = await guestTeams(db, identity)
  if (teams.length === 0) return null
  const leads = await leadsByTeam(db, identity.org.id, teams.map((team) => team.id))
  const { text, tier } = guestsText(teams.map((team) => ({ ...team, leads: leads.get(team.id) ?? [] })), identity.org.prefix)
  return { name: "guests", text, ...(tier > 1 ? { cut: true } : {}) }
}
