/**
 * L'empreinte des migrations d'un dossier : sha256 des noms et contenus de `supabase/migrations/*.sql`, triés par
 * nom. `pnpm verify` l'écrit pour la base qu'il construit (`base-de-verify.mjs`), `commit-depuis-export.mjs` la
 * compare à celle de l'arbre commité. Sans dépendance : le script de commit la charge hors de toute installation.
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export function empreinteDesMigrations(root) {
  const dossier = join(root, 'supabase', 'migrations')
  const hash = createHash('sha256')
  for (const fichier of readdirSync(dossier).filter((nom) => nom.endsWith('.sql')).sort()) {
    hash.update(`${fichier}\0`).update(readFileSync(join(dossier, fichier))).update('\0')
  }
  return hash.digest('hex')
}
