#!/usr/bin/env node
/**
 * reunir-migrations — avant le tag `vX.Y.Z`, réunit les migrations ajoutées depuis le tag précédent en un seul
 * `<horodatage>_vX_Y_Z.sql` (database-patterns.md § Règles, fiche D124), mentions de retrait recopiées dans son en-tête
 * (`scripts/lib/reunion-des-migrations.mjs`).
 *
 * Usage : `node scripts/reunir-migrations.mjs --version X.Y.Z --horodatage AAAAMMJJHHMMSS <fichier.sql> …`, chaque
 * fichier nommé dans `packages/plateforme/migrations`. Écrit le fichier réuni dans `packages/plateforme/migrations` et
 * sa copie dans `supabase/migrations`, retire les parties des deux dossiers, puis contrôle les migrations du paquet
 * (`oto-platform migrations check`, fichier réuni compris). Refuse, sans rien écrire, une partie dont la copie de `supabase/migrations`
 * diffère. La réparation de l'historique du projet de test reste un geste du pilote.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { run } from '../packages/plateforme/cli/index.mjs'
import { reunirMigrations } from './lib/reunion-des-migrations.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGE = join(ROOT, 'packages/plateforme/migrations')
const HOST = join(ROOT, 'supabase/migrations')

const { values, positionals } = parseArgs({
  options: { version: { type: 'string' }, horodatage: { type: 'string' } },
  allowPositionals: true,
})
if (!values.version || !/^\d{14}$/.test(values.horodatage ?? '') || !positionals.length) {
  console.error('Usage : node scripts/reunir-migrations.mjs --version X.Y.Z --horodatage AAAAMMJJHHMMSS <fichier.sql> …')
  process.exit(2)
}
const parts = positionals.map((name) => {
  const file = join(PACKAGE, name)
  if (!existsSync(file)) throw new Error(`${name} : absent de packages/plateforme/migrations`)
  const sql = readFileSync(file, 'utf8')
  const copy = join(HOST, name)
  if (existsSync(copy) && readFileSync(copy, 'utf8') !== sql) throw new Error(`${name} : la copie de supabase/migrations diffère`)
  return { name, sql }
})
const merged = reunirMigrations({ version: values.version, parts })
const name = `${values.horodatage}_v${values.version.replaceAll('.', '_')}.sql`
for (const dir of [PACKAGE, HOST]) {
  writeFileSync(join(dir, name), merged)
  for (const part of parts) rmSync(join(dir, part.name), { force: true })
}
console.log(`${name} : ${parts.length} migration(s) réunie(s)`)
process.exitCode = await run(['migrations', 'check'])
