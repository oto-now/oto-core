/**
 * L'arbre de code : ce que `pnpm verify` atteste et ce que le trailer `Verified-tree:` d'un commit porte.
 *
 * C'est l'arbre git d'un contenu, privé des chemins écrits APRÈS les checks (`EXCLUS` : changelog, sprint,
 * stories, conception, registry) et dont chaque fichier ordinaire est ramené au mode 100644 (un lien reste un
 * lien). Le même contenu donne le même identifiant, qu'il soit lu dans un dossier (le checkout, un export de
 * `git archive`) ou dans un commit, quel que soit le dépôt : un arbre git ne dépend que de son contenu.
 *
 * Pourquoi le mode est ramené à 100644 : `pnpm install` pose le bit d'exécution sur le `bin` du paquet
 * (`packages/plateforme/cli/bin.mjs`) dans tout dossier où il tourne ; l'arbre d'un export installé ne serait
 * jamais celui de son commit. Le bit d'exécution ne change le résultat d'aucun check.
 *
 * Tout se calcule dans un dépôt jetable (`git init --bare` dans un dossier temporaire) : rien ne s'écrit dans
 * le dépôt qu'on lit, ni dans son index. Les objets d'un commit s'y lisent par `GIT_ALTERNATE_OBJECT_DIRECTORIES`.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// Documents de méthode écrits APRÈS les checks, par la finalisation puis par `commit-push` : aucun
// n'influence le type-check, le lint ni les tests. Sans ces exclusions, le reçu serait invalidé par les
// étapes qui le suivent. Le registry en fait partie : `dev` l'écrit à l'étape 8, après `pnpm verify`.
// Contrepartie assumée : la cohérence registry ↔ `src/components/` glisse d'un commit.
export const EXCLUS = [
  /^docs\/changelog\.md$/,
  /^\.method\/sprint\//,
  /^docs\/produit\/stories\//,
  /^docs\/conception\//,
  /^\.method\/conventions\/component-registry\.md$/,
]
export const estExclu = (path) => EXCLUS.some((r) => r.test(path))

/** git dans le dépôt jetable `depot`, index `index` ; `env` ajoute ses variables (arbre de travail, objets). */
function gitJetable(depot, index, args, { env = {}, input } = {}) {
  return execFileSync('git', ['-c', 'core.quotePath=false', ...args], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
    input,
    env: { ...process.env, GIT_DIR: depot, GIT_INDEX_FILE: index, ...env },
  })
}

/** Ouvre un dépôt jetable, y fait `travail(git)`, puis le supprime quoi qu'il arrive. */
function dansUnDepotJetable(travail) {
  const dossier = mkdtempSync(join(tmpdir(), 'arbre-de-code-'))
  const depot = join(dossier, 'depot.git')
  const index = join(dossier, 'index')
  try {
    execFileSync('git', ['init', '--quiet', '--bare', depot], { stdio: 'pipe' })
    return travail((args, options) => gitJetable(depot, index, args, options))
  } finally {
    rmSync(dossier, { recursive: true, force: true })
  }
}

/**
 * Ramène l'index courant à l'arbre de code (chemins exclus retirés, fichiers en 100644), puis l'écrit.
 * `--missing-ok` : les objets d'un commit sont lus chez lui, jamais copiés dans le dépôt jetable.
 */
function ecrireLArbreDeCode(git, env) {
  const entrees = git(['ls-files', '--stage', '-z'], { env }).split('\0').filter(Boolean)
  const lignes = []
  for (const entree of entrees) {
    const [entete, chemin] = entree.split('\t')
    const [mode, sha] = entete.split(' ')
    if (estExclu(chemin)) lignes.push(`0 ${'0'.repeat(40)}\t${chemin}`)
    else if (mode === '100755') lignes.push(`100644 ${sha}\t${chemin}`)
  }
  if (lignes.length) git(['update-index', '-z', '--index-info'], { env, input: lignes.join('\0') + '\0' })
  return git(['write-tree', '--missing-ok'], { env }).trim()
}

/**
 * L'arbre de code d'un dossier : son contenu tel que `git add -A` le prendrait, `.gitignore` du dossier compris,
 * sans les exclusions globales de la personne (`core.excludesFile`), qui varient d'un poste à l'autre.
 */
export function arbreDeCodeDuDossier(dossier) {
  return dansUnDepotJetable((git) => {
    const env = { GIT_WORK_TREE: resolve(dossier) }
    git(['-c', 'core.fileMode=false', '-c', 'core.excludesFile=/dev/null', 'add', '--all', '--', '.'], { env })
    return ecrireLArbreDeCode(git, env)
  })
}

/** Le dossier des objets du dépôt git `depot` (un checkout ou un dépôt nu). */
function objetsDe(depot) {
  const commun = execFileSync('git', ['-C', depot, 'rev-parse', '--path-format=absolute', '--git-common-dir'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
  return join(commun, 'objects')
}

/** L'arbre de code du commit (ou de l'arbre) `revision` du dépôt `depot`. */
export function arbreDeCodeDuCommit(depot, revision) {
  const env = { GIT_ALTERNATE_OBJECT_DIRECTORIES: objetsDe(depot) }
  const arbre = execFileSync('git', ['-C', depot, 'rev-parse', '--verify', `${revision}^{tree}`], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
  return dansUnDepotJetable((git) => {
    git(['read-tree', arbre], { env })
    return ecrireLArbreDeCode(git, env)
  })
}
