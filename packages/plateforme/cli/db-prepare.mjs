/**
 * db prepare — pose sur une base Postgres ce que les migrations du paquet supposent et ne créent pas
 * (E01-S09, ADR-012 § 1) : elles ne touchent que le schéma `platform` (ADR-006 § 1).
 *
 * Ce que ça empêche : qu'un hôte sans Supabase (Postgres managé de Scaleway, Postgres nu) doive écrire
 * à la main le schéma `auth`, les rôles et le schéma `extensions` avant la ligne de base ; et qu'un
 * hôte Supabase n'ait aucun moyen de créer le rôle de connexion du serveur, `platform_app`, ni le rôle du
 * serveur, `platform_server`, sous lequel il écrit ce que lui seul affirme.
 *
 * Sur Supabase (rôle `supabase_auth_admin` et table `auth.users` avec `instance_id`), seule la section
 * `tout-hote` de `db-prepare.sql` s'exécute : les rôles `platform_app` et `platform_server`. Ailleurs, la section
 * `postgres-nu` d'abord. Tout dans une transaction : une extension refusée par l'hôte l'annule et
 * arrête la commande en la nommant. Le mot de passe de `platform_app` vient de
 * `PLATFORM_APP_PASSWORD`, passé en paramètre ; il n'est jamais écrit, ni lui ni celui de l'URL. La
 * connexion passe en TLS sauf `sslmode` écrit dans l'URL (`sslOption`, `ssl-option.mjs`).
 */
import { readFileSync } from 'node:fs'
import postgres from 'postgres'
import { mask, urlPassword } from './masking.mjs'
import { clean, splitStatements } from './migrations-check.mjs'
import { sslOption } from './ssl-option.mjs'

const PREPARE_SQL = readFileSync(new URL('./db-prepare.sql', import.meta.url), 'utf8')

/** Sur Supabase : son rôle d'Auth et sa table des comptes, colonne `instance_id` comprise. */
export const DETECT_SUPABASE = `select exists (select 1 from pg_catalog.pg_roles where rolname = 'supabase_auth_admin')
   and exists (select 1 from information_schema.columns
                where table_schema = 'auth' and table_name = 'users' and column_name = 'instance_id') as supabase`

/**
 * Les sections de `db-prepare.sql` (`-- section: <nom>`), chacune coupée en instructions : les corps
 * `$…$` restent entiers, comme les lit `check:migrations`.
 * @returns {Map<string, string[]>}
 */
function prepareSections(sql = PREPARE_SQL) {
  const sections = new Map()
  const parts = sql.replace(/\r\n/g, '\n').split(/^-- section: ([\w-]+)$/m)
  for (let k = 1; k < parts.length; k += 2) {
    const text = parts[k + 1]
    const { text: cleaned, dollarRanges } = clean(text)
    const statements = splitStatements(cleaned, dollarRanges)
      .map(({ offset, body }) => text.slice(offset, offset + body.length).trim())
      .filter((statement) => clean(statement).text.trim() !== '')
    sections.set(parts[k], statements)
  }
  return sections
}

/**
 * Les instructions à jouer : sur Supabase, `tout-hote` seul ; ailleurs, `postgres-nu` d'abord.
 * @param {boolean} supabase
 * @returns {string[]}
 */
export function preparePlan(supabase, sections = prepareSections()) {
  const everywhere = sections.get('tout-hote') ?? []
  return supabase ? everywhere : [...(sections.get('postgres-nu') ?? []), ...everywhere]
}

/**
 * Ce que la préparation demande au client postgres.js.
 * @typedef {{ unsafe: (query: string, params?: unknown[]) => PromiseLike<any[]>,
 *   begin: (run: (tx: { unsafe: (query: string, params?: unknown[]) => PromiseLike<any[]> }) => Promise<unknown>) => PromiseLike<unknown>,
 *   end: (options?: { timeout?: number }) => Promise<void> }} PrepareClient
 */

/**
 * Prépare la base. `connect` : le client postgres.js (remplacé par les tests). Rend le code de sortie :
 * 0 préparée, 1 refus ou panne (message sur `printError`).
 * @param {{ dbUrl: string, password?: string, print: (line: string) => void,
 *   printError: (line: string) => void,
 *   connect?: (url: string, options: { ssl?: 'require', onnotice: (notice: { message: string }) => void }) => PrepareClient }} options
 */
export async function prepareDatabase({ dbUrl, password, print, printError, connect = postgres }) {
  const secrets = [password, urlPassword(dbUrl)]
  const say = (line) => print(mask(line, secrets))
  const sql = connect(dbUrl, {
    max: 1,
    ...sslOption(dbUrl),
    onnotice: (notice) => say(`  ${notice.message}`),
    connection: { application_name: 'oto-platform db prepare' },
  })
  try {
    const [{ supabase }] = await sql.unsafe(DETECT_SUPABASE)
    say(supabase
      ? 'Base Supabase (rôle supabase_auth_admin, table auth.users) : seuls les rôles platform_app et platform_server sont préparés.'
      : 'Base Postgres sans Supabase : rôles, schéma auth, schéma extensions et extensions, puis platform_app et platform_server.')
    await sql.begin(async (tx) => {
      if (password) await tx.unsafe("select pg_catalog.set_config('oto_platform.app_password', $1, true)", [password])
      for (const statement of preparePlan(supabase)) await tx.unsafe(statement)
    })
    say('db prepare : terminé.')
    return 0
  } catch (error) {
    const message = `${error?.message ?? error}`
    // Un Postgres sans TLS coupe la poignée de main, dans un message qui ne dit pas quoi faire.
    const hint = sslOption(dbUrl).ssl && /\b(TLS|SSL)\b/.test(message) ? ' (TLS exigé : ?sslmode=disable dans l\'URL pour un Postgres sans TLS)' : ''
    printError(mask(`db prepare : ${message}${hint}`, secrets))
    return 1
  } finally {
    // La préparation est jouée ou annulée avant : une connexion mal fermée ne change pas le code rendu.
    await sql.end({ timeout: 5 }).catch((error) => printError(mask(`db prepare : connexion mal fermée : ${error?.message ?? error}`, secrets)))
  }
}
