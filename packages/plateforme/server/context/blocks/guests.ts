// Bloc « Shared with you by other teams » de `context` : la vue invité de la personne (`nodes/guest-entries.ts`), une équipe
// par intertitre, un point d'entrée par ligne avec la première phrase de son résumé, qui dit quand s'en servir. Le même
// texte quelle que soit la demande : ni classement, ni coupe par le budget ; 25 points d'entrée au plus, puis une ligne
// qui dit combien d'autres et comment les trouver (contexte plus court, décision de JB). Sans lui, un assistant ne
// cherche pas ce qu'une autre équipe a ouvert à la sienne : il ignore que cela existe.
import { CONTEXT_INDEX, SERVED_GUESTS } from "../../../schemas"
import type { PlatformDb } from "../../db"
import type { Identity } from "../../identity"
import { formatCount } from "../../nodes/document"
import { guestTeams, type GuestEntry, type GuestTeam } from "../../nodes/guest-entries"
import type { ContextBlock } from "../engine"
import { servedSentence } from "./contexts"
import { leadsByTeam, teamLine } from "./team"

/**
 * Points d'entrée servis au plus, toutes équipes comprises, dans l'ordre des équipes (par nom) puis des chemins ; au-delà,
 * la ligne `SERVED_GUESTS.moreStart` … `moreEnd` (JB : « 20/30 max »). Remplace les paliers de taille d'avant (résumés entiers, coupés à
 * 100 caractères, retirés, puis une ligne par équipe).
 */
export const GUESTS_MAX = 25

/** Une équipe invitante et ses responsables nommés. */
export type GuestView = GuestTeam & { leads: string[] }

function entryLine(entry: GuestEntry): string {
  const { item, separator } = CONTEXT_INDEX
  const under = entry.under > 0 ? `${SERVED_GUESTS.underStart}${formatCount(entry.under)}${SERVED_GUESTS.underEnd}` : ""
  // Un résumé n'est jamais vide : la base l'exige (`nodes_summary_check`) ; servi à sa première phrase (AC9 bis).
  return `${item}${entry.path}${under}${separator}${entry.title}${separator}${servedSentence(entry.summary)}`
}

const heading = (team: GuestView) => `${SERVED_GUESTS.team}${teamLine(team.name, team.leads)}`

const notice = (prefix: string) => `${SERVED_GUESTS.noticeStart}${prefix}${SERVED_GUESTS.noticeMiddle}${prefix}${SERVED_GUESTS.noticeEnd}`

/** Les équipes réduites à leurs `GUESTS_MAX` premiers points d'entrée, sans équipe vide, et le nombre des autres. */
function bounded(teams: readonly GuestView[]): { shown: GuestView[]; more: number } {
  let left = GUESTS_MAX
  const shown = teams.flatMap((team) => {
    const entries = team.entries.slice(0, Math.max(left, 0))
    left -= entries.length
    return entries.length > 0 ? [{ ...team, entries }] : []
  })
  const total = teams.reduce((sum, team) => sum + team.entries.length, 0)
  return { shown, more: total - Math.min(total, GUESTS_MAX) }
}

/**
 * Le texte du bloc : le titre, la consigne, puis par équipe son intertitre et ses points d'entrée, `GUESTS_MAX` au plus ;
 * au-delà, `and <n> more shared with you: search them with <p>_find and the words of what you need.` : `find` les
 * trouve (il cherche tout ce que la personne lit), alors que le dossier d'une équipe dont elle n'est pas membre ne se lit
 * pas. `more` : les points d'entrée non listés.
 */
export function guestsText(teams: readonly GuestView[], prefix: string): { text: string; more: number } {
  const { shown, more } = bounded(teams)
  const tail = more > 0 ? [`${SERVED_GUESTS.moreStart}${formatCount(more)}${SERVED_GUESTS.moreMiddle}${prefix}${SERVED_GUESTS.moreEnd}`] : []
  const lines = [SERVED_GUESTS.title, notice(prefix), ...shown.flatMap((team) => [heading(team), ...team.entries.map(entryLine)]), ...tail]
  return { text: lines.join("\n"), more }
}

/** Le bloc, ou `null` sans vue invité ; `cut` quand des points d'entrée ne sont pas listés, pour que l'aperçu le dise. */
export async function guestsBlock(db: PlatformDb, identity: Identity): Promise<ContextBlock | null> {
  const teams = await guestTeams(db, identity)
  if (teams.length === 0) return null
  const leads = await leadsByTeam(db, identity.org.id, teams.map((team) => team.id))
  const { text, more } = guestsText(teams.map((team) => ({ ...team, leads: leads.get(team.id) ?? [] })), identity.org.prefix)
  return { name: "guests", text, ...(more > 0 ? { cut: true } : {}) }
}
