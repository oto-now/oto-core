/**
 * La base de test locale (M62) : un Postgres 16 natif du poste, à la place du projet Supabase, pour les
 * suites portables de Vitest (`PLATFORM_TEST_DB=local`, `vitest.config.ts`). Ce que ça empêche : un
 * `pnpm verify` de ~20 min, fait surtout d'allers-retours vers le projet distant ; et, une base par
 * dossier (le checkout, chaque export), qu'une migration d'un export change la base des autres.
 *
 * Le cluster appartient à l'utilisateur, sans service ni mot de passe : `%LOCALAPPDATA%\oto-pg16\data`,
 * port 55432, écoute sur 127.0.0.1 seul, authentification `trust` (le job `bare-postgres` de la CI fait
 * de même). La préparation d'une base reprend les étapes de ce job : `db prepare` du paquet, puis
 * `supabase db push` des migrations de `supabase/migrations/`. Outillage du dépôt, jamais importé par le
 * paquet ni par l'hôte.
 */
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import postgres from 'postgres'
import { prepareDatabase } from '../../packages/plateforme/cli/db-prepare.mjs'

export const LOCAL_PORT = 55432
const HOST = '127.0.0.1'
const HOME = join(process.env.LOCALAPPDATA ?? join(process.env.HOME ?? '.', '.local'), 'oto-pg16')
const DATA = join(HOME, 'data')

/** Le nom de la base d'un dossier : `test_` puis son nom (`test_oto_platform`, `test_oto_core_export_…`). */
export function localDatabaseName(root) {
  return `test_${basename(root).toLowerCase().replace(/[^a-z0-9]+/g, '_')}`.slice(0, 63)
}

/**
 * Les deux connexions des tests, comme dans le job `bare-postgres` : le serveur par `platform_app` (le pool
 * du paquet joint une base locale sans TLS), l'administration par `postgres` (`sslmode=disable`, que la
 * règle TLS de l'outillage exige d'écrire). Aucune ne porte de mot de passe.
 */
export function localUrls(root, database = localDatabaseName(root)) {
  return {
    app: `postgresql://platform_app@${HOST}:${LOCAL_PORT}/${database}`,
    admin: `postgresql://postgres@${HOST}:${LOCAL_PORT}/${database}?sslmode=disable`,
  }
}

/** Le dossier des binaires : `OTO_PG_BIN`, sinon l'installation winget, sinon les binaires zip d'EDB. */
function binDir() {
  const candidates = [process.env.OTO_PG_BIN, 'C:\\Program Files\\PostgreSQL\\16\\bin', join(HOME, 'pgsql', 'bin')]
  const found = candidates.find((dir) => dir && existsSync(join(dir, process.platform === 'win32' ? 'pg_ctl.exe' : 'pg_ctl')))
  if (!found) throw new Error(`binaires de PostgreSQL 16 introuvables (${candidates.filter(Boolean).join(', ')}) : OTO_PG_BIN les nomme`)
  return found
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true, ...options })
  if (result.error) throw result.error
  return result
}

/**
 * Crée le cluster s'il manque et le démarre s'il est arrêté (après un redémarrage du poste). Réglages d'une
 * base jetable : ni `fsync` ni écriture synchrone (une panne perd au pire des données de test) ; 300
 * connexions, pour plusieurs agents à quatre processus de test chacun. Un réglage changé ici ne vaut que
 * pour un cluster nouveau : `pg_ctl stop`, supprimer `%LOCALAPPDATA%\oto-pg16\data`, `pnpm db:local`.
 */
export function ensureServer(print) {
  const bin = binDir()
  if (!existsSync(join(DATA, 'PG_VERSION'))) {
    mkdirSync(HOME, { recursive: true })
    print(`initdb : ${DATA}`)
    // Fuseau UTC, celui du projet Supabase et de l'image `postgres:16` : initdb prendrait celui du poste,
    // et un `timestamptz` relu en texte changerait de décalage (quatre tests en échec le 2026-09-28).
    const settings = ['port=55432', 'listen_addresses=127.0.0.1', 'timezone=UTC', 'log_timezone=UTC', 'max_connections=300', 'fsync=off', 'synchronous_commit=off', 'full_page_writes=off']
    const init = run(join(bin, 'initdb'), [
      '-D', DATA, '-U', 'postgres', '--auth=trust', '--encoding=UTF8',
      '--locale-provider=icu', '--icu-locale=en-US', '--locale=en-US',
      ...settings.flatMap((setting) => ['-c', setting]),
    ])
    if (init.status !== 0) throw new Error(`initdb : ${init.stderr || init.stdout}`)
  }
  const status = run(join(bin, 'pg_ctl'), ['status', '-D', DATA])
  if (status.status === 0) return
  print(`pg_ctl start : port ${LOCAL_PORT}`)
  const args = ['start', '-D', DATA, '-l', join(HOME, 'server.log'), '-w', '-t', '60']
  // Sous Windows, un serveur lancé par `spawn` hérite des tubes de sortie du shell appelant, qui attend
  // alors sa fin (constaté le 2026-09-28 : `pnpm db:local` ne rendait pas la main à l'outil de l'agent) ;
  // `Start-Process` passe par ShellExecute, sans héritage. Attente de `pg_ctl` seul, pas de ses enfants.
  const start = process.platform === 'win32'
    ? run('powershell', ['-NoProfile', '-NonInteractive', '-Command',
      `$p = Start-Process -FilePath '${join(bin, 'pg_ctl.exe')}' -ArgumentList ${args.map((a) => `'"${a}"'`).join(',')} -WindowStyle Hidden -PassThru; $p.WaitForExit(); exit $p.ExitCode`], { stdio: 'ignore' })
    : run(join(bin, 'pg_ctl'), args, { stdio: 'ignore' })
  if (start.status !== 0) throw new Error(`pg_ctl start : échec, journal dans ${join(HOME, 'server.log')}`)
}

/** Les versions de `supabase/migrations/` (préfixe `AAAAMMJJHHMMSS`), dans l'ordre. */
function repositoryVersions(root) {
  return readdirSync(join(root, 'supabase', 'migrations'))
    .flatMap((file) => /^(\d{14})_.*\.sql$/.exec(file)?.[1] ?? [])
    .sort()
}

/** Les versions du dépôt que la base n'a pas ; toutes, sur une base sans historique. */
async function pendingVersions(root, sql) {
  const [{ history }] = await sql`select pg_catalog.to_regclass('supabase_migrations.schema_migrations') is not null as history`
  const applied = history ? new Set((await sql`select version from supabase_migrations.schema_migrations`).map((row) => String(row.version))) : new Set()
  return repositoryVersions(root).filter((version) => !applied.has(version))
}

const connect = (url) => postgres(url, { max: 1, onnotice: () => {}, connection: { application_name: 'oto-platform db:local' } })

/**
 * Crée la base du checkout si elle manque (`reset` : la recrée), la prépare (`db prepare`) et lui applique
 * les migrations de `supabase/migrations/` par la CLI Supabase, comme le job `bare-postgres`. Rejouable :
 * un second passage n'applique que les migrations nouvelles. Une migration déjà appliquée puis réécrite
 * (travail en cours sur une migration pas encore fusionnée) ne se rejoue que par `reset`.
 */
export async function prepareLocalDatabase(root, { reset = false, print }) {
  const database = localDatabaseName(root)
  const server = connect(localUrls(root, 'postgres').admin)
  try {
    if (reset) {
      print(`base ${database} : supprimée`)
      await server.unsafe(`drop database if exists "${database}" with (force)`)
    }
    const [{ present }] = await server`select exists (select 1 from pg_catalog.pg_database where datname = ${database}) as present`
    if (!present) {
      await server.unsafe(`create database "${database}"`)
      print(`base ${database} : créée`)
    }
  } finally {
    await server.end({ timeout: 5 })
  }

  const { admin } = localUrls(root)
  // Le mot de passe ne sert qu'à créer `platform_app` au premier passage ; `trust` ne le demande jamais.
  const code = await prepareDatabase({ dbUrl: admin, password: randomBytes(16).toString('hex'), print: () => {}, printError: print })
  if (code !== 0) throw new Error('db prepare : échec (message ci-dessus)')

  // La CLI Supabase ignore `sslmode=disable` dans l'URL et refuse un Postgres sans TLS : `PGSSLMODE` l'y
  // fait passer (même contournement que le job `bare-postgres`). `--include-all` : une base déjà migrée reçoit
  // aussi la migration datée avant la ligne de base (`20260928090000`), que la CLI refuse sans lui.
  const push = run('supabase', ['db', 'push', '--db-url', admin, '--yes', '--include-all'], { cwd: root, env: { ...process.env, PGSSLMODE: 'disable' } })
  if (push.status !== 0) throw new Error(`supabase db push : ${push.stderr || push.stdout}`)
  print(`base ${database} : migrations à jour`)
}

/**
 * Avant une suite Vitest en mode local : la base du checkout existe et porte toutes les migrations du
 * dépôt, sinon elle se prépare. Un serveur arrêté n'est pas démarré ici (le processus de Vitest ne doit
 * pas en être le parent) : l'erreur dit la commande.
 */
export async function ensureLocalDatabase(root, print) {
  const sql = connect(localUrls(root).admin)
  let pending
  try {
    pending = await pendingVersions(root, sql)
  } catch (error) {
    if (error?.code === '3D000') pending = ['base absente']
    else throw new Error(`Postgres local injoignable sur ${HOST}:${LOCAL_PORT} (${error?.code ?? error?.message}) : lancer \`pnpm db:local\``)
  } finally {
    await sql.end({ timeout: 5 })
  }
  if (pending.length) await prepareLocalDatabase(root, { print })
}
