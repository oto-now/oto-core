/**
 * journal purge — retire du journal des appels, du journal de l'équipe plateforme et des tickets `feedback` ce qui
 * dépasse la durée de rétention de l'hôte (`pseudonymisation.md` § Les quatre primitives), par la fonction
 * `platform.purge_expired` et une connexion d'administration. L'hôte la lance de sa tâche planifiée ; la durée est la
 * sienne, pour toutes ses organisations. Sans durée pour une table, elle reste telle quelle. Rien du mot de passe de
 * l'URL n'est jamais écrit. TLS sauf `sslmode` écrit dans l'URL (`ssl-option.mjs`).
 */
import postgres from 'postgres'
import { mask, urlPassword } from './masking.mjs'
import { sslOption } from './ssl-option.mjs'

/** Une durée en jours : un entier de 1 à 36 500, comme la fonction SQL l'exige. */
const MAX_DAYS = 36500

/**
 * La durée lue d'une option, `null` absente, ou le problème.
 * @param {string | undefined} text
 * @param {string} option
 * @returns {number | null | string}
 */
function daysOf(text, option) {
  if (text === undefined) return null
  if (!/^\d+$/.test(text) || Number(text) < 1 || Number(text) > MAX_DAYS) return `${option} attend un nombre de jours, de 1 à ${MAX_DAYS}`
  return Number(text)
}

/**
 * Purge. `connect` : le client postgres.js (remplacé par les tests). Rend le code de sortie : 0 purgé ; 1 durée mal
 * écrite, aucune durée, base injoignable ou fonction refusée (message sur `printError`).
 * @param {{ dbUrl: string, journalDays?: string, feedbackDays?: string, print: (line: string) => void,
 *   printError: (line: string) => void, connect?: typeof postgres }} options
 */
export async function purgeCommand({ dbUrl, journalDays, feedbackDays, print, printError, connect = postgres }) {
  const journal = daysOf(journalDays, '--journal-days')
  const feedback = daysOf(feedbackDays, '--feedback-days')
  const problem = [journal, feedback].find((value) => typeof value === 'string')
  if (problem) {
    printError(`journal purge : ${problem}`)
    return 1
  }
  if (journal === null && feedback === null) {
    printError('journal purge : rien à purger : --journal-days <jours>, --feedback-days <jours>, ou les deux')
    return 1
  }
  const secrets = [urlPassword(dbUrl)]
  const sql = connect(dbUrl, { max: 1, ...sslOption(dbUrl), connection: { application_name: 'oto-platform journal purge' } })
  try {
    const [row] = await sql`select journal, admin_journal, feedback from platform.purge_expired(${journal}::integer, ${feedback}::integer)`
    print(`journal purge : ${row.journal} ligne(s) du journal, ${row.admin_journal} du journal de l'équipe plateforme, ${row.feedback} retour(s) retirés.`)
    return 0
  } catch (error) {
    printError(mask(`journal purge : ${error?.message ?? error}`, secrets))
    return 1
  } finally {
    await sql.end({ timeout: 5 }).catch((error) => printError(mask(`journal purge : connexion mal fermée : ${error?.message ?? error}`, secrets)))
  }
}
