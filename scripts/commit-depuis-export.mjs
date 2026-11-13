#!/usr/bin/env node
/**
 * commit-depuis-export — construit le commit d'un export vérifié, avec son reçu en trailers.
 *
 *   node scripts/commit-depuis-export.mjs --depot <checkout> --base <sha> --message <fichier> [--branche <nom>]
 *
 * Se lance depuis l'export (`git archive origin/main` dans un dossier temporaire, `CLAUDE.md § Vérifier,
 * commiter, pousser`), après un `pnpm verify` vert DANS cet export. Le commit a pour parent `--base`, pour
 * contenu tout l'export (ce que `.gitignore` n'écarte pas, les modes de `--base` gardés), pour message le
 * fichier `--message` suivi de deux trailers :
 *
 *   Verified-tree: <arbre de code vérifié>
 *   Verified: 4 checks, <n> tests, <n> sautés (<n> fichiers tolérés), <n> forks, base <empreinte>, <n> s, <date>
 *
 * Le commit s'écrit dans le dépôt `--depot` (le checkout partagé), sans toucher à son index ni à son arbre
 * de travail, et n'est pas poussé : le script affiche son SHA et la commande de push.
 *
 * Refusé (code 1), rien n'est écrit :
 * - reçu absent, de plus d'une heure, sans les quatre checks, sans arbre ou sans résumé des tests ;
 * - reçu sans base de test construite par `pnpm verify` depuis les migrations de l'arbre (`scripts/lib/base-de-verify.mjs`),
 *   ou dont l'empreinte des migrations n'est pas celle de l'arbre commité : des tests verts sur une base qui ne
 *   correspond pas à l'arbre ne prouvent rien ;
 * - un test en échec, ou un fichier sauté en entier hors de `scripts/sauts-toleres.txt` (celui de `--base`) ;
 * - `--base` n'est pas `origin/main` (relu par `git fetch`) : refaire l'export et `pnpm verify` ;
 * - l'arbre de code du commit n'est pas celui du reçu : le code a bougé depuis `pnpm verify`, ou un fichier
 *   non ignoré est apparu ;
 * - le commit ne changerait rien.
 *
 * Sur une branche de travail : `--branche <nom>` empile le commit sur la tête d'`origin/<nom>`, que `--base` doit
 * nommer (l'export est alors celui de cette tête, plus le travail). Tant qu'`origin/main` n'a pas avancé depuis la
 * branche, le commit n'a qu'elle pour parent. Sinon il prend aussi la tête d'`origin/main` pour second parent, et
 * l'export doit porter ce que `main` a changé : tout fichier que `main` a changé depuis la branche, et que la branche
 * n'a pas changé, y est celui de `main` ; refusé sinon, car le commit reviendrait en silence sur le travail de `main`.
 * Les fichiers changés des deux côtés sont fusionnés par qui prépare l'export, et vérifiés par `pnpm verify`. Le
 * premier commit d'une branche se construit sans `--branche`, sur `origin/main`, et se pousse sur
 * `refs/heads/<nom>`. Sans cette option, une branche de travail ne pouvait recevoir qu'un seul commit.
 *
 * Ce qui reste possible, et assumé : écrire le reçu ou les trailers à la main. C'est une garde contre
 * l'erreur, pas contre la malveillance (même principe que le gate de commit).
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { arbreDeCodeDuCommit } from './lib/arbre-de-code.mjs'
import { empreinteDesMigrations } from './lib/empreinte-des-migrations.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const RECU = process.env.VERIFY_RECEIPT_PATH ?? join(ROOT, '.claude/.verify-receipt.json')
const AGE_MAX_MS = 60 * 60 * 1000
const CHECKS = ['check:framework', 'type-check', 'lint', 'test']
const SAUTS_TOLERES = 'scripts/sauts-toleres.txt'

class Refus extends Error {}

const git = (depot, args, { env = {}, input } = {}) =>
  execFileSync('git', ['-C', depot, '-c', 'core.quotePath=false', ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
    input,
    env: { ...process.env, ...env },
  })

/** Les chemins d'une liste de sauts tolérés : une ligne par chemin, `#` pour un commentaire. */
export const lireLaListe = (texte) =>
  texte
    .split('\n')
    .map((ligne) => ligne.trim())
    .filter((ligne) => ligne && !ligne.startsWith('#'))

/** La liste de `--base` ; si `--base` ne l'a pas encore (le commit qui l'introduit), celle de l'export. */
function sautsToleres(depot, base) {
  try {
    return lireLaListe(git(depot, ['show', `${base}:${SAUTS_TOLERES}`]))
  } catch {
    const locale = join(ROOT, SAUTS_TOLERES)
    if (!existsSync(locale)) throw new Refus(`${SAUTS_TOLERES} absent de la base et de l'export`)
    return lireLaListe(readFileSync(locale, 'utf8'))
  }
}

/** Le reçu de l'export, s'il atteste un `pnpm verify` complet et vert ; sinon un refus qui dit quoi faire. */
export function lireLeRecu(chemin, toleres, maintenant = Date.now()) {
  if (!existsSync(chemin)) throw new Refus("aucun reçu : lancer `pnpm verify` dans l'export")
  let recu
  try {
    recu = JSON.parse(readFileSync(chemin, 'utf8'))
  } catch {
    throw new Refus('reçu illisible : relancer `pnpm verify`')
  }
  const age = maintenant - new Date(recu.at).getTime()
  if (!Number.isFinite(age) || age < 0 || age > AGE_MAX_MS) throw new Refus('reçu périmé ou mal daté : relancer `pnpm verify`')
  const manquants = CHECKS.filter((check) => !recu.checks?.includes(check))
  if (manquants.length) throw new Refus(`le reçu ne déclare pas ${manquants.join(', ')} : lancer \`pnpm verify\`, pas un check seul`)
  if (typeof recu.tree !== 'string' || !/^[0-9a-f]{40,64}$/.test(recu.tree)) throw new Refus("le reçu n'a pas d'arbre de code : relancer `pnpm verify`")
  if (!recu.tests || !Number.isInteger(recu.forks)) throw new Refus('le reçu ne résume pas les tests : relancer `pnpm verify`')
  if (recu.tests.echecs !== 0) throw new Refus(`${recu.tests.echecs} test(s) en échec dans le reçu`)
  if (typeof recu.base?.empreinte !== 'string' || !/^[0-9a-f]{64}$/.test(recu.base.empreinte)) {
    throw new Refus(
      "le reçu n'atteste aucune base de test construite depuis les migrations de l'arbre : relancer `pnpm verify` avec " +
        '`PLATFORM_TEST_DB=local`, ou `PLATFORM_ADMIN_DATABASE_URL` vers un Postgres du poste'
    )
  }
  const horsListe = recu.tests.fichiersSautes.filter((fichier) => !toleres.includes(fichier))
  if (horsListe.length) {
    throw new Refus(
      `fichiers sautés en entier hors de ${SAUTS_TOLERES} (base de test injoignable ?) : ${horsListe.join(', ')}`
    )
  }
  return recu
}

/** Le trailer `Verified:`, lisible sans outil. */
export const ligneVerified = (recu) =>
  `${recu.checks.length} checks, ${recu.tests.verts} tests, ${recu.tests.sautes} sautés ` +
  `(${recu.tests.fichiersSautes.length} fichiers tolérés), ${recu.forks} forks, base ${recu.base.empreinte.slice(0, 12)}, ` +
  `${recu.duree} s, ${recu.at}`

/** L'arbre du commit : `base`, puis tout l'export par-dessus, dans un index jetable du dépôt. */
function arbreDuCommit(depot, base) {
  const dossier = mkdtempSync(join(tmpdir(), 'commit-depuis-export-'))
  const env = { GIT_INDEX_FILE: join(dossier, 'index') }
  try {
    git(depot, ['read-tree', base], { env })
    // `core.fileMode=false` : un fichier de la base garde son mode (le `bin` que `pnpm install` rend
    // exécutable reste tel que la base le dit) ; `core.excludesFile` : seul le `.gitignore` de l'export compte.
    git(depot, ['-c', 'core.fileMode=false', '-c', 'core.excludesFile=/dev/null', `--work-tree=${ROOT}`, 'add', '--all', '--', '.'], { env })
    return git(depot, ['write-tree'], { env }).trim()
  } finally {
    rmSync(dossier, { recursive: true, force: true })
  }
}

/** Vrai si `ancetre` est dans l'histoire de `commit` (ou lui est égal). */
function estAncetre(depot, ancetre, commit) {
  try {
    git(depot, ['merge-base', '--is-ancestor', ancetre, commit])
    return true
  } catch (erreur) {
    if (erreur.status === 1) return false
    throw erreur
  }
}

/**
 * Les parents d'un commit empilé sur la branche de travail `branche` : sa tête, que `base` doit nommer, puis la tête
 * d'`origin/main` quand la branche ne la contient pas encore.
 */
function parentsSurUneBranche(depot, { branche, base, main }) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branche) || branche === 'main') throw new Refus(`--branche nomme une branche de travail, pas « ${branche} »`)
  let tete
  try {
    tete = git(depot, ['rev-parse', '--verify', '--quiet', `origin/${branche}^{commit}`]).trim()
  } catch {
    throw new Refus(`origin/${branche} n'existe pas : son premier commit se construit sans --branche, sur origin/main, puis se pousse sur refs/heads/${branche}`)
  }
  if (base !== tete) throw new Refus(`origin/${branche} est ${tete.slice(0, 7)}, pas ${base.slice(0, 7)} : refaire l'export sur sa tête, puis \`pnpm verify\``)
  return estAncetre(depot, main, tete) ? [tete] : [tete, main]
}

/**
 * Le commit qui prend `main` pour second parent porte ce que `main` a changé : chaque fichier changé sur `main` depuis
 * la souche commune, et pas sur la branche, a dans `arbre` le contenu de `main`. Sans cette garde, un export resté sur
 * l'ancienne tête de `main` effacerait, à la fusion de la branche, ce que `main` a reçu entre-temps.
 */
function garderCeQueMainAChange(depot, { arbre, branche, main }) {
  const souche = git(depot, ['merge-base', branche, main]).trim()
  const changes = (jusqua) => git(depot, ['diff', '--name-only', '-z', souche, jusqua]).split('\0').filter(Boolean)
  const blob = (revision, chemin) => {
    try {
      return git(depot, ['rev-parse', '--verify', '--quiet', `${revision}:${chemin}`]).trim()
    } catch {
      return null
    }
  }
  const surLaBranche = new Set(changes(branche))
  const perdus = changes(main).filter((chemin) => !surLaBranche.has(chemin) && blob(arbre, chemin) !== blob(main, chemin))
  if (perdus.length === 0) return
  const nommes = perdus.slice(0, 5).join(', ') + (perdus.length > 5 ? ', …' : '')
  throw new Refus(
    `l'export ne porte pas ce qu'origin/main (${main.slice(0, 7)}) a changé depuis la branche : ${nommes} ; ` +
      'reprendre ces fichiers de la tête de main dans l\'export, puis `pnpm verify`'
  )
}

/** Construit le commit et rend son SHA ; lève `Refus` sans rien écrire dans `depot` qu'un arbre et un commit. */
export function commitDepuisExport({ depot, base, message, branche }) {
  git(depot, ['fetch', '--quiet', 'origin'])
  const tete = git(depot, ['rev-parse', 'origin/main']).trim()
  const parent = git(depot, ['rev-parse', '--verify', `${base}^{commit}`]).trim()
  const parents = branche ? parentsSurUneBranche(depot, { branche, base: parent, main: tete }) : [parent]
  if (!branche && parent !== tete) throw new Refus(`origin/main est ${tete.slice(0, 7)}, pas ${parent.slice(0, 7)} : refaire l'export sur la tête, puis \`pnpm verify\``)

  const recu = lireLeRecu(RECU, sautsToleres(depot, parent))
  const arbre = arbreDuCommit(depot, parent)
  if (arbre === git(depot, ['rev-parse', `${parent}^{tree}`]).trim()) throw new Refus('le commit ne changerait rien')
  if (parents.length > 1) garderCeQueMainAChange(depot, { arbre, branche: parent, main: tete })
  const verifie = arbreDeCodeDuCommit(depot, arbre)
  if (verifie !== recu.tree) {
    throw new Refus(
      `l'arbre de code du commit (${verifie.slice(0, 7)}) n'est pas celui du reçu (${recu.tree.slice(0, 7)}) : ` +
        "le code a changé depuis `pnpm verify`, ou un fichier non ignoré est apparu dans l'export"
    )
  }
  // L'arbre de code de l'export est celui du commit : ses migrations sont celles du commit.
  const migrations = empreinteDesMigrations(ROOT)
  if (recu.base.empreinte !== migrations) {
    throw new Refus(
      `la base de test du reçu a été construite depuis d'autres migrations (${recu.base.empreinte.slice(0, 12)}) que ` +
        `celles de l'arbre commité (${migrations.slice(0, 12)}) : relancer \`pnpm verify\``
    )
  }

  const texte = readFileSync(message, 'utf8')
  const avecTrailers = git(depot, ['interpret-trailers', '--trailer', `Verified-tree: ${recu.tree}`, '--trailer', `Verified: ${ligneVerified(recu)}`], {
    input: texte,
  })
  return git(depot, ['commit-tree', arbre, ...parents.flatMap((un) => ['-p', un])], { input: avecTrailers }).trim()
}

function options(argv) {
  const valeurs = {}
  for (let i = 0; i < argv.length; i += 2) {
    const nom = argv[i]?.replace(/^--/, '')
    if (!['depot', 'base', 'message', 'branche'].includes(nom) || argv[i + 1] === undefined) return null
    valeurs[nom] = argv[i + 1]
  }
  return valeurs.depot && valeurs.base && valeurs.message ? valeurs : null
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const lus = options(process.argv.slice(2))
  if (!lus) {
    console.error('usage : node scripts/commit-depuis-export.mjs --depot <checkout> --base <sha> --message <fichier> [--branche <nom>]')
    process.exit(2)
  }
  try {
    const sha = commitDepuisExport(lus)
    console.log(git(lus.depot, ['show', '--stat', '--format=%H%n%n%B', sha]))
    console.log(`Commit ${sha}, non poussé. Pousser : git -C ${lus.depot} push origin ${sha}:refs/heads/${lus.branche ?? 'main'}`)
  } catch (erreur) {
    if (!(erreur instanceof Refus)) throw erreur
    console.error(`Refusé : ${erreur.message}.`)
    process.exit(1)
  }
}
