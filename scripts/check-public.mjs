#!/usr/bin/env node
/**
 * check-public — contrôle pré-public d'ADR-010 § 4 : aucun secret, aucun nom de client réel, ni
 * dans les fichiers ni dans l'historique git.
 *
 * Ce que ça empêche : qu'un dépôt rendu public expose un secret ou le nom d'un client, même dans
 * un commit ancien. La sortie dit où, jamais quoi : ni la valeur trouvée, ni l'entrée de la liste
 * (un segment de chemin qui en contient une est affiché `***`), car elle peut finir dans un
 * journal de CI public.
 *
 * Usage : `pnpm check:public` (secrets et `.public-denylist`) ; `--secrets-only` sans la liste
 * (CI, `pnpm test`) ; `--root <dépôt>` pour un autre dépôt que le répertoire courant.
 * - Arbre : fichiers suivis et nouveaux fichiers non ignorés (un secret se voit avant d'être
 *   commité) ; un fichier qui contient un octet nul est sauté ; ligne 0 = le chemin lui-même.
 * - Historique, toutes références : lignes ajoutées, chemins touchés, messages de commit.
 * - `.public-denylist` : un nom par ligne, `#` pour un commentaire ; comparaison sans accents ni
 *   casse, bornée aux mots ; règle `denylist#<n>`, n = rang de l'entrée (commentaires exclus).
 * Codes : 0 aucun constat · 1 constat(s) · 2 usage, dossier hors git ou liste invalide.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, posix, resolve } from 'node:path'

const DENYLIST = '.public-denylist'
const USAGE = 'usage : node scripts/check-public.mjs [--secrets-only] [--root <dépôt>]'

// Les expressions des secrets ne vivent qu'ici : ailleurs, un faux secret se construit à
// l'exécution (`testing-strategy.md § Anti-patterns`), sinon ce contrôle le trouve. Aucune ne
// se reconnaît elle-même dans ce fichier.
const SECRET_RULES = [
  ['jwt', /\beyJ[\w-]{7,}\.[\w-]{10,}\.[\w-]{10,}/],
  ['supabase-secret-key', /\bsb_secret_[\w-]{20,}/],
  ['npm-token', /\bnpm_[A-Za-z0-9]{36}/],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_\w{30,})/],
  ['aws-access-key', /\bAKIA[0-9A-Z]{16}/],
  ['private-key', /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY(?: BLOCK)?-----/],
  ['stripe-live-key', /\bsk_live_[0-9A-Za-z]{10,}/],
  // `smtps?` : le relais d'invitation (`PLATFORM_SMTP_URL`, E01-S11 a2-core ; M23).
  // Un mot de passe écrit `${…}` est une interpolation, composée à l'exécution, jamais un secret en clair.
  ['url-with-password', /\b(?:postgres(?:ql)?|mysql|redis|https?|smtps?):\/\/[^\s:@/]+:(?!\$\{)[^\s@/]+@/i],
]
// Nom de fichier : `.env` ou `.env.<suffixe>`, hors `.env.example`.
const ENV_FILE = /^\.env(?:\.(?!example$).+)?$/

/** Refus qui arrête le contrôle avant tout constat : usage, dépôt ou liste invalides (code 2). */
class Refusal extends Error {}

function readOptions(argv) {
  const options = { secretsOnly: false, root: '.' }
  for (let k = 0; k < argv.length; k++) {
    if (argv[k] === '--secrets-only') options.secretsOnly = true
    else if (argv[k] !== '--root') throw new Refusal(`option inconnue « ${argv[k]} » (${USAGE})`)
    else if (!argv[k + 1] || argv[k + 1].startsWith('--')) throw new Refusal(`--root attend un chemin (${USAGE})`)
    else options.root = argv[++k]
  }
  return options
}

function git(root, args) {
  return execFileSync('git', ['-C', root, '-c', 'core.quotePath=false', ...args], {
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function repoRoot(dir) {
  const start = resolve(dir)
  if (!existsSync(start)) throw new Refusal(`dossier introuvable : ${start}`)
  try {
    return git(start, ['rev-parse', '--show-toplevel']).trim()
  } catch (error) {
    if (error.code === 'ENOENT') throw new Refusal('git introuvable dans le PATH')
    throw new Refusal(`${start} n'est pas dans un dépôt git`)
  }
}

/** Sans accents ni casse : NFD, marques diacritiques retirées, minuscules. */
function normalize(text) {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

function readDenylist(root) {
  const file = join(root, DENYLIST)
  if (!existsSync(file)) {
    throw new Refusal(`${DENYLIST} absent : un nom de client réel par ligne (fichier ignoré par git), ou --secrets-only`)
  }
  const entries = readFileSync(file, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
  return entries.map((entry, i) => {
    const text = normalize(entry)
    if (text.length < 3) throw new Refusal(`entrée n°${i + 1} trop courte`)
    const escaped = text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
    // Bornée aux mots : ni lettre ni chiffre de part et d'autre, en Unicode.
    return { rule: `denylist#${i + 1}`, pattern: new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'u') }
  })
}

/** Règles qui reconnaissent quelque chose dans un texte d'une ligne. */
function rulesIn(text, denylist) {
  const found = SECRET_RULES.filter(([, pattern]) => pattern.test(text)).map(([rule]) => rule)
  if (denylist.length) {
    const normalized = normalize(text)
    for (const { rule, pattern } of denylist) if (pattern.test(normalized)) found.push(rule)
  }
  return found
}

/**
 * La liste de refus d'un fichier : aucune pour une licence, qui nomme son titulaire légitimement (clôture E01-S12 e,
 * ADR-010 § 4, fiche D67 A) ; les règles de secrets s'y appliquent toujours.
 */
const termsFor = (path, denylist) => (posix.basename(path) === 'LICENSE' ? [] : denylist)

function pathRules(path, denylist) {
  return [...(ENV_FILE.test(posix.basename(path)) ? ['env-file'] : []), ...rulesIn(path, denylist)]
}

/** Chemin affichable : un segment où une règle reconnaît quelque chose devient `***`. */
function shownPath(path, denylist) {
  return path
    .split('/')
    .map((segment) => (rulesIn(segment, denylist).length ? '***' : segment))
    .join('/')
}

/** Texte d'un fichier de l'arbre ; null pour un binaire (octet nul) ou un chemin sans fichier. */
function readText(file) {
  let buffer
  try {
    buffer = readFileSync(file)
  } catch (error) {
    // Suivi mais supprimé de la copie de travail, ou sous-module : l'historique couvre son contenu.
    if (error.code === 'ENOENT' || error.code === 'EISDIR') return null
    throw error
  }
  return buffer.includes(0) ? null : buffer.toString('utf8')
}

function scanTree(root, denylist) {
  const listed = git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']).split('\0')
  // La liste elle-même contient ses entrées par définition ; commitée, l'historique la trouve.
  const paths = [...new Set(listed)].filter((path) => path && path !== DENYLIST)
  const findings = []
  for (const path of paths) {
    const shown = shownPath(path, denylist)
    for (const rule of pathRules(path, denylist)) findings.push(`arbre  ${shown}:0  ${rule}`)
    const lines = readText(join(root, path))?.split('\n') ?? []
    lines.forEach((line, i) => {
      for (const rule of rulesIn(line, termsFor(path, denylist))) findings.push(`arbre  ${shown}:${i + 1}  ${rule}`)
    })
  }
  return { findings, files: paths.length }
}

/** `+++ b/<chemin>` : git ajoute une tabulation après un nom qui contient un espace. */
function diffPath(raw) {
  const name = raw.replace(/\t$/, '').replace(/^"(.*)"$/, '$1')
  return name === '/dev/null' ? null : name.replace(/^b\//, '')
}

/** Lignes ajoutées d'un diff `--unified=0`, avec leur fichier. Dans un hunk, `+++…` est une ligne. */
function addedLines(diff) {
  const added = []
  let path = null
  let inHunk = false
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) [path, inHunk] = [null, false]
    else if (!inHunk && line.startsWith('+++ ')) path = diffPath(line.slice(4))
    else if (line.startsWith('@@')) inHunk = true
    else if (inHunk && path && line.startsWith('+')) added.push({ path, text: line.slice(1) })
  }
  return added
}

/** Sortie de `git log --format=%x00%H%x00%B%x00 -p` : "", puis sha, message, diff par commit. */
function parseLog(out) {
  const parts = out.split('\0')
  const commits = []
  for (let k = 1; k < parts.length; k += 3) {
    commits.push({ sha: parts[k], message: parts[k + 1] ?? '', added: addedLines(parts[k + 2] ?? '') })
  }
  return commits
}

/** Sortie de `git log --format=%x00%H --name-only` : chemins touchés par commit, supprimés compris. */
function touchedPaths(out) {
  const bySha = new Map()
  for (const chunk of out.split('\0').slice(1)) {
    const [sha, ...paths] = chunk.split('\n')
    bySha.set(sha, paths.filter(Boolean).map((path) => path.replace(/^"(.*)"$/, '$1')))
  }
  return bySha
}

function scanHistory(root, denylist) {
  const commits = parseLog(git(root, ['log', '--all', '-p', '--no-color', '--unified=0', '--format=%x00%H%x00%B%x00']))
  const touched = touchedPaths(git(root, ['log', '--all', '--format=%x00%H', '--name-only']))
  // Un même secret sur dix lignes d'un fichier fait un constat par commit, pas dix.
  const findings = new Set()
  for (const { sha, message, added } of commits) {
    const at = (where, rules) => rules.forEach((rule) => findings.add(`historique  ${sha.slice(0, 7)} ${where}  ${rule}`))
    for (const line of message.split('\n')) at('(message)', rulesIn(line, denylist))
    for (const path of touched.get(sha) ?? []) at(shownPath(path, denylist), pathRules(path, denylist))
    for (const { path, text } of added) at(shownPath(path, denylist), rulesIn(text, termsFor(path, denylist)))
  }
  return { findings: [...findings], commits: commits.length }
}

function main(argv) {
  let root
  let denylist
  try {
    const options = readOptions(argv)
    root = repoRoot(options.root)
    denylist = options.secretsOnly ? [] : readDenylist(root)
  } catch (error) {
    if (!(error instanceof Refusal)) throw error
    console.error(`check:public — ${error.message}`)
    return 2
  }
  const tree = scanTree(root, denylist)
  const history = scanHistory(root, denylist)
  const findings = [...tree.findings, ...history.findings]
  for (const finding of findings) console.log(finding)
  if (findings.length) {
    console.error(`check:public — ${findings.length} constat(s)`)
    return 1
  }
  console.log(`check:public — aucun constat (arbre : ${tree.files} fichiers, historique : ${history.commits} commits)`)
  return 0
}

process.exitCode = main(process.argv.slice(2))
