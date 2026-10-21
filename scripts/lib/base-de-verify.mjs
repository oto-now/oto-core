/**
 * La base de test d'un `pnpm verify` : une base neuve, construite pour le passage depuis les migrations de
 * `supabase/migrations/` de l'arbre vérifié, sur le serveur Postgres configuré, puis supprimée. Ce que ça
 * empêche : un reçu vert sur une base qui ne correspond pas à l'arbre. Le cas réel (21/10/2026) : une migration
 * réécrite après son application à la base locale, qui ne la rejoue pas (`ensureLocalDatabase` n'applique que les
 * versions qu'elle n'a pas) ; les tests passaient sur l'ancienne version, la CI a échoué sur la nouvelle.
 *
 * L'empreinte des migrations (`empreinteDesMigrations`) entre dans le passage, le reçu et le trailer `Verified:` ;
 * `commit-depuis-export.mjs` refuse un reçu sans elle, ou dont l'empreinte n'est pas celle de l'arbre commité.
 * Outillage du dépôt, jamais importé par le paquet ni par l'hôte.
 */
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseEnv } from 'node:util'
import { empreinteDesMigrations } from './empreinte-des-migrations.mjs'

// Chargé à l'appel : `test-db-local.mjs` importe `postgres` et le paquet, que `verify.mjs` n'exige que s'il construit
// une base (un dépôt sans installation, comme celui des tests de `verify`, s'en passe).
const outils = () => import('./test-db-local.mjs')

/** Les variables des tests, comme `vitest.config.ts` les lit : l'environnement, sinon `.env.local`, sinon `.env`. */
function variables(root, env) {
  const fichiers = ['.env', '.env.local'].map((nom) => join(root, nom)).filter(existsSync)
  return Object.assign({}, ...fichiers.map((chemin) => parseEnv(readFileSync(chemin, 'utf8'))), env)
}

/** Un hôte du poste : `localhost`, `127.0.0.1` ou `[::1]`. */
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * Le serveur où construire la base : le Postgres du poste en mode local (`PLATFORM_TEST_DB=local`), sinon celui de
 * `PLATFORM_ADMIN_DATABASE_URL` s'il est sur le poste (conteneur jetable, job `bare-postgres`). `null` sans l'un ni
 * l'autre, et pour un serveur distant (le projet Supabase) : aucune base ne s'y crée, le reçu n'en atteste aucune.
 * @param {string} root
 * @param {Record<string, string | undefined>} [env]
 */
export async function serveurDeTest(root, env = process.env) {
  const vars = variables(root, env)
  if (vars.PLATFORM_TEST_DB === 'local') return (await outils()).localUrls(root, 'postgres')
  if (!vars.PLATFORM_ADMIN_DATABASE_URL || !LOOPBACK.has(new URL(vars.PLATFORM_ADMIN_DATABASE_URL).hostname)) return null
  return { admin: vars.PLATFORM_ADMIN_DATABASE_URL, app: vars.PLATFORM_DATABASE_URL || null }
}

/** `url` vers la base `nom` du même serveur ; sans `url` d'application, celle d'administration sous `platform_app`. */
function versLaBase(url, nom) {
  const cible = new URL(url)
  cible.pathname = `/${nom}`
  return cible.toString()
}

function urlApplication(serveur, nom) {
  if (serveur.app) return versLaBase(serveur.app, nom)
  const cible = new URL(versLaBase(serveur.admin, nom))
  cible.username = 'platform_app'
  cible.password = ''
  cible.search = ''
  return cible.toString()
}

/**
 * Construit la base du passage : `verify_<empreinte>_<hasard>`, créée sur `serveur`, préparée et migrée depuis les
 * fichiers de `root`, puis contrôlée (ses versions appliquées sont celles du dépôt, ni plus ni moins). Rend son nom,
 * ses deux connexions et l'empreinte des migrations.
 */
export async function construireLaBase(root, serveur, print) {
  const { connect, migrateDatabase, repositoryVersions } = await outils()
  const empreinte = empreinteDesMigrations(root)
  const nom = `verify_${empreinte.slice(0, 12)}_${randomBytes(4).toString('hex')}`
  const admin = connect(serveur.admin)
  try {
    await admin.unsafe(`create database "${nom}"`)
  } finally {
    await admin.end({ timeout: 5 })
  }
  const base = { nom, empreinte, admin: versLaBase(serveur.admin, nom), app: urlApplication(serveur, nom) }
  try {
    await migrateDatabase(root, base.admin, print)
    const sql = connect(base.admin)
    try {
      const appliquees = (await sql`select version from supabase_migrations.schema_migrations order by version`).map((ligne) => String(ligne.version))
      const attendues = repositoryVersions(root)
      if (appliquees.join() !== attendues.join()) throw new Error(`base ${nom} : versions appliquées ${appliquees.length}, attendues ${attendues.length} (migrations de l'arbre)`)
    } finally {
      await sql.end({ timeout: 5 })
    }
  } catch (error) {
    await supprimerLaBase(serveur, nom)
    throw error
  }
  return base
}

/** Supprime la base du passage, même si une connexion des tests y traîne. */
export async function supprimerLaBase(serveur, nom) {
  const admin = (await outils()).connect(serveur.admin)
  try {
    await admin.unsafe(`drop database if exists "${nom}" with (force)`)
  } finally {
    await admin.end({ timeout: 5 })
  }
}

/**
 * Les variables du check `test` sur la base du passage : les deux connexions y pointent, le mode local et les
 * variables de Supabase sont neutralisés (vides, donc prioritaires sur `.env.local`), comme `vitest.config.ts` le
 * fait en mode local : les suites de l'adaptateur Supabase se sautent.
 */
export function variablesDesTests(base) {
  return {
    PLATFORM_TEST_DB: '',
    PLATFORM_DATABASE_URL: base.app,
    PLATFORM_ADMIN_DATABASE_URL: base.admin,
    NEXT_PUBLIC_SUPABASE_URL: '',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: '',
    SUPABASE_SECRET_KEY: '',
    SUPABASE_DB_URL: '',
  }
}
