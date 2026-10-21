#!/usr/bin/env node
/**
 * verify — les checks de `pnpm verify`, par étapes.
 *
 *   node scripts/verify.mjs check:framework,type-check,lint test
 *
 * Chaque argument est une étape, chaque nom un script de package.json lancé par `pnpm run`. Les
 * checks d'une étape tournent en même temps ; l'étape suivante ne part que s'ils ont tous réussi.
 * Code de sortie 1 au premier échec, et la dernière ligne nomme les checks en échec.
 *
 * Le reçu n'est pas écrit ici : package.json enchaîne `verify-receipt.mjs write` derrière ce
 * script, donc seulement sur un code de sortie nul. Les étapes restent écrites dans package.json,
 * où `check:framework` contrôle que `verify` nomme les quatre checks avant le reçu.
 *
 * Pourquoi : lancés l'un après l'autre, check:framework, type-check et lint coûtaient la somme de
 * leurs durées avant même les tests (M12). Aucun ne lit ce qu'un autre produit.
 *
 * `test` tourne avec `VITEST_MAX_FORKS=4` (le poste est partagé : ~6 min, 4 cœurs, 2,7 Go mesurés le
 * 21/10/2026) et écrit son rapport JSON. Une fois tout passé, le script écrit le résumé du passage
 * (`.claude/.verify-run.json`) : durée, plafond, tests verts et sautés, fichiers sautés en entier. Le reçu le
 * reprend (`verify-receipt.mjs write`), puis le trailer `Verified:` d'un commit (`commit-depuis-export.mjs`).
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// La racine du SCRIPT, comme `verify-receipt.mjs` : les checks portent sur ce dépôt quel que soit le cwd.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const secondes = (ms) => `${(ms / 1000).toFixed(1)} s`

/** Le plafond de processus de Vitest pendant `pnpm verify`, posé quel que soit l'environnement. */
export const VITEST_MAX_FORKS = '4'
const RAPPORT_DES_TESTS = join(ROOT, '.claude/.verify-tests.json')
export const PASSAGE = join(ROOT, '.claude/.verify-run.json')

/** Ce que chaque check reçoit en plus de `pnpm run <check>` : arguments et variables. */
const OPTIONS = {
  test: {
    arguments: `--reporter=default --reporter=json --outputFile.json=${JSON.stringify(RAPPORT_DES_TESTS)}`,
    env: { VITEST_MAX_FORKS },
  },
}

/**
 * Le résumé d'un rapport JSON de Vitest : tests verts, sautés (`pending`, `todo`), en échec, et les fichiers
 * dont aucun test n'a tourné (chemins relatifs à `racine`, triés).
 */
export function resumerLesTests(rapport, racine = ROOT) {
  const sautes = new Set(['skipped', 'pending', 'todo'])
  const fichiersSautes = rapport.testResults
    .filter((fichier) => fichier.assertionResults.length && fichier.assertionResults.every((t) => sautes.has(t.status)))
    .map((fichier) => relative(racine, fichier.name).split('\\').join('/'))
    .sort()
  return {
    verts: rapport.numPassedTests,
    sautes: rapport.numPendingTests + rapport.numTodoTests,
    echecs: rapport.numFailedTests,
    fichiersSautes,
  }
}

/**
 * Lance `pnpm run <check>`. Seul dans son étape, il écrit en direct. À plusieurs, chacun garde sa
 * sortie (stdout et stderr, dans l'ordre d'arrivée) et l'affiche d'un bloc à sa fin : les lignes
 * de trois checks simultanés ne se mêlent pas.
 */
function lancer(check, direct) {
  return new Promise((resolve) => {
    const debut = Date.now()
    const morceaux = []
    const fin = (code) =>
      resolve({ check, ok: code === 0, sortie: Buffer.concat(morceaux).toString(), duree: Date.now() - debut })
    // `shell` : sous Windows, pnpm est un script `.cmd`, que Node ne lance pas sans shell. Une seule
    // chaîne, sans tableau d'arguments : Node 24 déprécie les arguments passés avec `shell` (DEP0190).
    const options = OPTIONS[check]
    const enfant = spawn(`pnpm run ${check}${options ? ` ${options.arguments}` : ''}`, {
      cwd: ROOT,
      env: { ...process.env, ...options?.env },
      shell: true,
      stdio: direct ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    })
    if (!direct) {
      enfant.stdout.on('data', (morceau) => morceaux.push(morceau))
      enfant.stderr.on('data', (morceau) => morceaux.push(morceau))
    }
    // Un lancement impossible compte comme un échec, avec sa raison dans la sortie du check.
    enfant.on('error', (error) => {
      morceaux.push(Buffer.from(`${error.message}\n`))
      fin(1)
    })
    enfant.on('close', fin)
  })
}

/** Lance une étape et rend les checks en échec, dans l'ordre où l'étape les nomme. */
async function etape(checks) {
  const direct = checks.length === 1
  console.log(direct ? `\n── ${checks[0]}` : `\n→  ${checks.join(', ')} : en même temps, chaque sortie à la fin de son check`)
  const resultats = await Promise.all(
    checks.map((check) =>
      lancer(check, direct).then((r) => {
        const statut = `── ${r.check} : ${r.ok ? 'OK' : 'ÉCHEC'} (${secondes(r.duree)})`
        const sortie = r.sortie && !r.sortie.endsWith('\n') ? `${r.sortie}\n` : r.sortie
        // Un seul `write` par check : son bloc ne peut pas être coupé par celui d'un autre.
        process.stdout.write(direct ? `${statut}\n` : `\n${statut}\n${sortie}`)
        return r
      })
    )
  )
  return resultats.filter((r) => !r.ok).map((r) => r.check)
}

// Lancé par un test qui importe `resumerLesTests`, le script ne lance rien.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await verifier()

async function verifier() {
const etapes = process.argv
  .slice(2)
  .map((argument) => argument.split(',').map((check) => check.trim()).filter(Boolean))
  .filter((checks) => checks.length)

// Sans étape, le script sortait 0 sans rien lancer, et package.json écrivait le reçu derrière.
if (!etapes.length) {
  console.error('usage : node scripts/verify.mjs <check>[,<check>…] [<check>[,<check>…] …]')
  process.exit(2)
}

// Un résumé d'un passage précédent ne doit jamais être repris pour celui-ci.
rmSync(PASSAGE, { force: true })
rmSync(RAPPORT_DES_TESTS, { force: true })
const debut = Date.now()
for (const [i, checks] of etapes.entries()) {
  const echecs = await etape(checks)
  if (echecs.length) {
    const nonLances = etapes.slice(i + 1).flat()
    console.log(`\n✖  verify : échec de ${echecs.join(', ')}${nonLances.length ? ` ; non lancé : ${nonLances.join(', ')}` : ''}.`)
    // `exitCode` plutôt que `exit()` : la sortie déjà écrite dans un pipe part en entier.
    process.exitCode = 1
    break
  }
}
if (!process.exitCode) {
  const passage = { fin: new Date().toISOString(), duree: Math.round((Date.now() - debut) / 1000), checks: etapes.flat() }
  if (existsSync(RAPPORT_DES_TESTS)) {
    passage.forks = Number(VITEST_MAX_FORKS)
    passage.tests = resumerLesTests(JSON.parse(readFileSync(RAPPORT_DES_TESTS, 'utf8')))
  }
  mkdirSync(dirname(PASSAGE), { recursive: true })
  writeFileSync(PASSAGE, JSON.stringify(passage, null, 2) + '\n')
  console.log(`\n✔  verify : ${etapes.flat().join(', ')} passés (${secondes(Date.now() - debut)}).`)
}
}
