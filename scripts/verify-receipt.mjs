#!/usr/bin/env node
/**
 * verify-receipt — évite de rejouer les checks déjà passés sur un arbre inchangé.
 *
 * Le problème : `dev` termine par une vérification complète, puis `commit-push` relance
 * exactement les 4 mêmes commandes trente secondes plus tard sur le même code. Sur un projet
 * réel (tests + build), c'est plusieurs minutes perdues à chaque chantier.
 *
 * Le reçu enregistre l'empreinte exacte de l'arbre de travail au moment où les checks sont
 * passés. `commit-push` ne les rejoue que si l'empreinte a changé — donc si le code a bougé.
 *
 * Effet de bord voulu : le reçu est une PREUVE que les checks ont tourné sur CE code. Le hook
 * s'en sert pour que le marqueur ` # checks-ok` ne puisse plus être posé par réflexe sur un
 * arbre jamais vérifié.
 *
 *   node scripts/verify-receipt.mjs write [check1,check2,...] [docs] → écrit le reçu (`docs` : reçu doc)
 *   node scripts/verify-receipt.mjs check [--commit]             → exit 0 si valide, 1 sinon
 *   node scripts/verify-receipt.mjs docs-only                    → exit 0 si seule la doc diffère de HEAD
 *   node scripts/verify-receipt.mjs cached                       → `pnpm verify:cached` : reçu valide → rien ;
 *     doc seule → `check:framework` et `check-public --secrets-only`, puis reçu doc ; sinon `pnpm verify`
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { arbreDeCodeDuDossier, estDoc, estExclu } from './lib/arbre-de-code.mjs'

// La racine est celle du SCRIPT, pas le cwd : le reçu doit couvrir le projet entier même quand
// la commande est lancée depuis un sous-dossier. `VERIFY_RECEIPT_ROOT` la redirige — réservé aux
// tests, qui doivent pouvoir exercer un dépôt jetable (dépôt sans commit, renommage). Sans ce
// seam, ces tests hachaient le dépôt du template et passaient sans rien vérifier.
const ROOT = process.env.VERIFY_RECEIPT_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), '..')

// `VERIFY_RECEIPT_PATH` permet aux tests d'écrire un reçu ISOLÉ. Sans ça, la suite de tests
// écrivait dans le vrai reçu un document déclarant les 4 checks passés alors que seul vitest
// avait tourné : un `pnpm test` interrompu laissait derrière lui un reçu valide, et le gate
// autorisait un commit sans que type-check ni lint n'aient jamais été lancés.
const RECEIPT = process.env.VERIFY_RECEIPT_PATH ?? join(ROOT, '.claude/.verify-receipt.json')
const MAX_AGE_MS = 60 * 60 * 1000 // 1 h : au-delà, l'environnement a pu bouger (deps, node)
// Checks qu'un reçu doit déclarer pour être valide. Le contrôle vit ici, pas dans le seul gate : pour un autre
// dépôt, le gate se fie au `check --commit` du script de ce dépôt, qui doit donc relire ce champ lui-même.
export const CHECKS_REQUIS = ['check:framework', 'type-check', 'lint', 'test']
/**
 * Reçu doc (`scope: "docs"`, écrit par `verify:cached` sur un arbre de doc seule) : contrôle de méthode et de
 * secrets seulement. `check:public` y est le passage de `node scripts/check-public.mjs --secrets-only` : un
 * document peut porter un secret recopié, que type-check, lint et tests ne voyaient pas non plus.
 */
export const CHECKS_DOC = ['check:framework', 'check:public']
/** Les commandes du reçu doc, dans l'ordre, lancées par `cached` depuis la racine. */
const COMMANDES_DOC = ['pnpm check:framework', 'node scripts/check-public.mjs --secrets-only']


const git = (args, options = {}, root = ROOT) =>
  execFileSync(
    'git',
    // `core.quotePath=false` : sinon git échappe les noms non-ASCII en octal
    // (`"src/caf\303\251.ts"`), `hash-object` échoue sur ce chemin, le fallback renvoie une
    // constante — et TOUT fichier accentué devenait aveugle au contenu : trois versions
    // différentes produisaient la même empreinte, donc un reçu valide sur du code modifié.
    ['-c', 'core.quotePath=false', ...args],
    {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'], // sans ça, les erreurs git polluent la sortie de `pnpm verify`
      ...options, // `input` pour `hash-object --stdin-paths`
    }
  )

/**
 * Chemins qui diffèrent de HEAD (indexés ou non, non suivis, suppressions), hors `EXCLUS`.
 * Une seule énumération, partagée par l'empreinte et par `docsOnly` : deux calculs de la liste
 * finiraient par diverger, et un reçu doc couvrirait alors un chemin que l'empreinte voit.
 */
function cheminsChanges(root) {
  const g = (args, options) => git(args, options, root)
  // Hors dépôt git, aucune empreinte n'a de sens. Le cas arrive quand le template est récupéré
  // en ZIP ou via degit, sans `git init` : `ls-files` levait alors une exception APRÈS que les
  // 4 checks soient passés, et le gate refusait ensuite tout commit en boucle.
  try {
    g(['rev-parse', '--is-inside-work-tree'])
  } catch {
    throw new Error(
      "hors d'un dépôt git — le reçu ne peut pas être calculé. Lancer `git init` (le framework " +
        'suppose un dépôt : le gate de commit et le routing du diff en dépendent).'
    )
  }

  // Un dépôt fraîchement initialisé n'a pas de HEAD : c'est le cas du premier commit d'un
  // projet issu du template. Sans ce garde, `pnpm verify` mourait sur une exception APRÈS avoir
  // passé les 4 checks, et le hook refusait ensuite le commit en boucle — sans échappement,
  // puisque `--no-verify` est bloqué.
  let head = 'sans-commit'
  try {
    head = g(['rev-parse', 'HEAD']).trim()
  } catch {
    /* dépôt sans commit : tout le contenu est « non suivi », ce qui suffit à l'empreinte */
  }

  const lines = (out) => out.split('\n').map((f) => f.trim()).filter(Boolean)

  // L'empreinte doit être INDÉPENDANTE DU STAGING : `git add` déplace un fichier de la liste
  // des non-suivis vers l'index sans changer une ligne de code. Une empreinte fondée sur la
  // sortie de `git diff` ou sur l'énumération des non-suivis changerait à ce moment-là et
  // invaliderait le reçu juste avant le commit — exactement quand on en a besoin.
  // On hache donc le CONTENU de chaque chemin concerné, quel que soit son état d'indexation.
  // `--name-status` distingue les suppressions : les hacher provoquerait une erreur git par
  // fichier et ferait dépendre le résultat d'une exception.
  const supprimes = new Set()
  const modifies = []
  // `--no-renames` : sur un rename, git n'émet qu'une ligne `R100 ancien nouveau`. En ne
  // retenant que la destination, la disparition de l'ancien chemin n'était jamais enregistrée —
  // restaurer l'ancien fichier à côté du nouveau laissait le reçu valide alors que les deux
  // coexistaient. Sans détection de rename, git émet un D et un A distincts.
  if (head !== 'sans-commit') {
    for (const line of lines(g(['diff', 'HEAD', '--name-status', '--no-renames']))) {
      const [status, path] = line.split('\t')
      if (!path) continue
      if (status.startsWith('D')) supprimes.add(path)
      else modifies.push(path)
    }
    // Ce que l'index change par rapport à HEAD, même quand l'arbre de travail est revenu à HEAD (fichier modifié,
    // indexé, puis restauré sur le disque) : c'est l'index que le commit prendra, et la liste doit le nommer.
    modifies.push(...lines(g(['diff', '--cached', 'HEAD', '--name-only', '--no-renames'])))
  } else {
    // Sans commit, l'index est tout le contenu suivi : l'ignorer rendait l'empreinte aveugle à tout
    // fichier indexé, et `git add -A` avant le commit initial invalidait le reçu (coupe en oto-pkg et oto-saas).
    modifies.push(...lines(g(['ls-files', '--cached'])))
  }

  const paths = [
    ...modifies, // modifié ou ajouté, indexé ou non
    ...lines(g(['ls-files', '--others', '--exclude-standard'])), // jamais commité
  ]

  const uniques = [...new Set([...paths, ...supprimes])].filter((f) => !estExclu(f)).sort()
  return { g, head, lines, uniques, supprimes }
}

/** Vrai si au moins un chemin diffère de HEAD et que tous sont de la documentation (`estDoc`). */
export function docsOnly(root = ROOT) {
  const { head, uniques } = cheminsChanges(root)
  return head !== 'sans-commit' && uniques.length > 0 && uniques.every(estDoc)
}

// Pour un commit : rien ne diffère de HEAD compte aussi. Après le commit de doc, un rebase ou un merge ne rejoue
// que des commits déjà passés par le gate ; exiger un verify complet pour rebaser sur un `main` qui avait bougé
// annulait le gain du reçu doc. Sans HEAD, tout diffère : jamais de la doc seule.
const docsOuRien = (root) => {
  const { head, uniques } = cheminsChanges(root)
  return head !== 'sans-commit' && uniques.every(estDoc)
}

/** Vrai si le dossier est un dépôt git qui a un HEAD (le checkout) ; faux dans un export (sans dépôt ni commit). */
function aUnHead(root) {
  try {
    git(['rev-parse', '--verify', '--quiet', 'HEAD'], {}, root)
    return true
  } catch {
    return false
  }
}

/**
 * Empreinte de tout ce qui est susceptible de faire échouer un check :
 * le HEAD, le diff complet (indexé et non indexé), et le contenu des fichiers non suivis.
 */
export function worktreeHash(root = ROOT) {
  const { g, head, lines, uniques, supprimes } = cheminsChanges(root)

  // Un processus git par fichier : lent (~40 ms chacun), mais isole un chemin que git ne sait
  // pas hacher (symlink cassé, socket, permission) et le signale dans l'empreinte plutôt que de
  // faire échouer toute la vérification.
  const hashUnParUn = (paths) =>
    new Map(
      paths.map((path) => {
        try {
          return [path, g(['hash-object', '--', path]).trim()]
        } catch {
          return [path, 'illisible']
        }
      })
    )

  // Un seul processus git pour tous les fichiers : `hash-object --stdin-paths` renvoie une
  // empreinte par ligne, dans l'ordre des chemins reçus — la même empreinte que fichier par
  // fichier. Sur un arbre non commité de 40 fichiers, le processus par fichier coûtait 1,5 s par
  // empreinte, et les tests du gate, qui en enchaînent plusieurs, dépassaient leur délai
  // (E01-S01, 2026-09-23). Si git refuse un chemin, il échoue en bloc : repli fichier par fichier.
  const hashEnLot = (paths) => {
    if (!paths.length) return new Map()
    try {
      const out = g(['hash-object', '--stdin-paths'], { input: `${paths.join('\n')}\n` })
      return new Map(lines(out).map((hash, i) => [paths[i], hash]))
    } catch {
      return hashUnParUn(paths)
    }
  }

  const hashes = hashEnLot(uniques.filter((path) => !supprimes.has(path)))
  const entries = uniques.map((path) =>
    supprimes.has(path) ? `${path}:supprimé` : `${path}:${hashes.get(path) ?? 'illisible'}`
  )

  return createHash('sha256').update([head, ...entries].join('\n')).digest('hex')
}

function readReceipt(path = RECEIPT) {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

/**
 * `commit` : le contrôle est fait pour un commit (gate, `.githooks/pre-commit`, `verify:cached`).
 *
 * Un reçu doc (`scope: "docs"`) se juge sur son arbre de code (`tree`), pas sur l'empreinte : elle contient
 * HEAD, et le commit de doc l'invaliderait avant le rebase qui le suit. Pour un commit, il n'est valide que si ce
 * qui diffère de HEAD est encore de la doc seule, ou rien : après un `git reset --soft`, le même arbre porte du
 * code jamais vérifié.
 * @returns {{valid: boolean, reason: string, receipt: object|null}}
 */
export function checkReceipt({ commit = false } = {}) {
  const receipt = readReceipt(RECEIPT)
  if (!receipt) return { valid: false, reason: "aucun reçu — les checks n'ont pas été lancés", receipt: null }

  // Un reçu tronqué, vide ou daté n'importe comment affichait « reçu périmé (NaN min) » :
  // le refus était correct, le diagnostic faux — donc inactionnable.
  const at = new Date(receipt.at).getTime()
  if (typeof receipt.hash !== 'string' || !Number.isFinite(at)) {
    return { valid: false, reason: 'reçu illisible ou incomplet — relancer `pnpm verify`', receipt }
  }

  const age = Date.now() - at
  if (age < 0) {
    return { valid: false, reason: `reçu daté dans le futur (${Math.round(-age / 60000)} min) — horloge décalée ?`, receipt }
  }
  if (age > MAX_AGE_MS) {
    return { valid: false, reason: `reçu périmé (${Math.round(age / 60000)} min, limite ${MAX_AGE_MS / 60000} min)`, receipt }
  }

  const doc = receipt.scope === 'docs'
  let current
  try {
    current = doc ? arbreDeCodeDuDossier(ROOT) : worktreeHash()
  } catch (error) {
    return { valid: false, reason: `empreinte de l'arbre illisible : ${error.message}`, receipt }
  }
  if (current !== (doc ? receipt.tree : receipt.hash)) {
    return { valid: false, reason: 'le code a changé depuis les derniers checks', receipt }
  }
  const declares = Array.isArray(receipt.checks) ? receipt.checks : []
  const manquants = (doc ? CHECKS_DOC : CHECKS_REQUIS).filter((c) => !declares.includes(c))
  if (manquants.length) {
    return {
      valid: false,
      reason: `le reçu ne déclare pas tous les checks (manquant : ${manquants.join(', ')}) — lancer \`pnpm verify\``,
      receipt,
    }
  }
  let seuleLaDoc = false
  if (commit && doc) {
    try {
      seuleLaDoc = docsOuRien(ROOT)
    } catch (error) {
      return { valid: false, reason: `chemins illisibles : ${error.message}`, receipt }
    }
  }
  if (commit && doc && !seuleLaDoc) {
    return {
      valid: false,
      reason: 'reçu doc seule (check:framework, check:public), mais le commit touche autre chose que la documentation — lancer `pnpm verify`',
      receipt,
    }
  }
  return { valid: true, reason: `checks déjà passés il y a ${Math.max(1, Math.round(age / 60000))} min sur ce code`, receipt }
}

// Ce module est aussi importé par le hook git-gate : sans ce garde, l'import exécuterait la
// partie CLI ci-dessous, afficherait « usage » et sortirait en erreur.
const executeDirectement =
  process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])

if (!executeDirectement) {
  // rien : les fonctions exportées suffisent
} else runCli()

/**
 * Le résumé du passage de `scripts/verify.mjs` (`.claude/.verify-run.json`), s'il vient de finir : écrit moins
 * de deux minutes avant `maintenant`, il est consommé (supprimé) ; plus vieux, il est ignoré et supprimé. Un
 * `write` lancé seul ne reprend donc jamais les tests d'un autre passage.
 */
function passageRecent(maintenant) {
  const chemin = join(ROOT, '.claude/.verify-run.json')
  if (!existsSync(chemin)) return null
  try {
    const passage = JSON.parse(readFileSync(chemin, 'utf8'))
    const age = new Date(maintenant).getTime() - new Date(passage.fin).getTime()
    return age >= 0 && age <= 2 * 60 * 1000 ? passage : null
  } catch {
    return null
  } finally {
    unlinkSync(chemin)
  }
}

function runCli() {
const [, , command, checksArg, scopeArg] = process.argv

if (command === 'write') {
  const checks = (checksArg ?? 'check:framework,type-check,lint,test').split(',').map((c) => c.trim())
  try {
    // Un reçu doc ne s'écrit dans le checkout que sur un arbre de doc seule : sinon il attesterait du code que seuls
    // `check:framework` et `check:public` ont vu. Un export n'a pas de HEAD : c'est `commit-depuis-export.mjs` qui y compare le
    // commit à sa base, et refuse un reçu doc dès qu'un chemin hors de la doc a changé.
    if (scopeArg === 'docs' && aUnHead(ROOT) && !docsOnly()) {
      throw new Error("l'arbre ne diffère pas de HEAD que par de la documentation — lancer `pnpm verify`")
    }
    const at = new Date().toISOString()
    // L'arbre de code (`scripts/lib/arbre-de-code.mjs`) : ce que `commit-depuis-export.mjs` compare à l'arbre
    // du commit qu'il construit, et qu'il écrit en trailer `Verified-tree:`. Il se calcule hors de tout dépôt,
    // dans un export de `git archive` comme dans le checkout.
    const recu = { checks, ...(scopeArg === 'docs' ? { scope: 'docs' } : {}), at, tree: arbreDeCodeDuDossier(ROOT) }
    // L'empreinte du gate de commit n'a de sens que dans un dépôt git (le checkout) ; un export n'en a pas.
    try {
      recu.hash = worktreeHash()
    } catch {
      /* hors d'un dépôt git : le gate refusera ce reçu, l'outil d'export n'en lit que l'arbre */
    }
    const passage = passageRecent(at)
    if (passage) Object.assign(recu, { duree: passage.duree, forks: passage.forks, tests: passage.tests, base: passage.base })
    writeFileSync(RECEIPT, JSON.stringify(recu, null, 2) + '\n')
  } catch (error) {
    // Échouer proprement plutôt que sur une stack Node : ce point du script est atteint APRÈS
    // que les 4 checks sont passés, et l'utilisateur doit comprendre pourquoi le gate le
    // refusera ensuite.
    console.error(`Reçu NON écrit — ${error.message}`)
    process.exit(1)
  }
  console.log(`Reçu écrit — ${checks.join(', ')}`)
} else if (command === 'docs-only') {
  let ok
  try {
    ok = docsOnly()
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
  console.log(ok ? 'Documentation seule : check:framework et check:public suffisent.' : 'Pas de la documentation seule (ou aucun changement).')
  process.exit(ok ? 0 : 1)
} else if (command === 'cached') {
  // `pnpm verify:cached`. En node plutôt qu'en `a || (b && c) || d` dans package.json : là, un `check:framework`
  // ou un secret en échec sur de la doc retombait sur un `pnpm verify` complet, qui échouait de même plusieurs
  // minutes plus tard. Ici, l'échec d'un contrôle de la doc rend la main avec son code.
  const { valid, reason, receipt } = checkReceipt({ commit: true })
  if (valid) {
    console.log(`✔  ${reason} : ${receipt.checks.join(', ')}. Inutile de les rejouer.`)
    process.exit(0)
  }
  const lancer = (commande) => spawnSync(commande, { cwd: ROOT, stdio: 'inherit', shell: true }).status ?? 1
  let doc = false
  try {
    doc = docsOnly()
  } catch {
    /* chemins illisibles : le verify complet tranche */
  }
  if (!doc) {
    console.log(`→  Checks à lancer : ${reason}.`)
    process.exit(lancer('pnpm verify'))
  }
  console.log('Documentation seule : contrôle de méthode et de secrets (check:framework, check-public --secrets-only).')
  for (const commande of [...COMMANDES_DOC, `node scripts/verify-receipt.mjs write ${CHECKS_DOC.join(',')} docs`]) {
    const code = lancer(commande)
    if (code !== 0) {
      console.error(`✘  ${commande} en échec : le corriger, puis relancer \`pnpm verify:cached\`.`)
      process.exit(code)
    }
  }
} else if (command === 'check') {
  const { valid, reason, receipt } = checkReceipt({ commit: checksArg === '--commit' })
  if (valid) {
    console.log(`✔  ${reason} : ${receipt.checks.join(', ')}. Inutile de les rejouer.`)
    process.exit(0)
  }
  console.log(`→  Checks à lancer : ${reason}.`)
  process.exit(1)
} else if (command === 'clear') {
  if (existsSync(RECEIPT)) unlinkSync(RECEIPT)
} else {
  console.error('usage: verify-receipt.mjs write|check|docs-only|cached|clear')
  process.exit(2)
}
}
