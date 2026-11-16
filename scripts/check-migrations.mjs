#!/usr/bin/env node
/**
 * check-migrations — `pnpm check:migrations` : `oto-platform migrations check` de la CLI du paquet
 * (ADR-006, FR-INST-04), lancé aussi par la CI.
 *
 * Usage : `pnpm check:migrations` (toutes les migrations du paquet) ou
 * `node scripts/check-migrations.mjs --file <chemin> [--file <chemin> …]` (des fichiers choisis, pour les fixtures) ;
 * `--tags v1.7.0,…` (étiquettes d'un retrait déclaré, défaut : `git tag` du dépôt) et `--json` (un seul objet JSON).
 * Sortie : `fichier:ligne règle` par erreur, code 1 s'il y en a une.
 */
import { run } from '../packages/plateforme/cli/index.mjs'

process.exitCode = await run(['migrations', 'check', ...process.argv.slice(2)])
