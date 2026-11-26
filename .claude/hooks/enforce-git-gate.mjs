#!/usr/bin/env node
/**
 * Hook PreToolUse — aucune écriture git en dehors du skill commit-push.
 *
 * Exit 0 = autorisé, exit 2 = bloqué (stderr renvoyé à Claude). Il reçoit les commandes des
 * outils Bash et PowerShell (matcher de `.claude/settings.json`), chacune lue avec la grammaire de
 * son shell (`scripts/hook-command.mjs`).
 *
 * Pourquoi un hook plutôt qu'un skill : le déclenchement d'un skill est un jugement du modèle,
 * donc probabiliste. Acceptable pour charger des conventions, pas pour un gate de push.
 *
 * Pourquoi Node plutôt que bash : le payload est du JSON, et toute extraction du champ
 * `command` à coups de grep/sed est fausse dans un sens ou dans l'autre — soit elle tronque la
 * commande au premier guillemet échappé, soit elle matche le JSON brut. `JSON.parse` supprime
 * la classe de bug entière.
 *
 * CE QUE CE HOOK NE PEUT PAS VOIR — limite structurelle, pas un oubli.
 * Il ne reçoit qu'une chaîne de commande. Un `git commit` écrit dans un `.sh`, un Makefile ou
 * un script npm lui est invisible : `bash deploy.sh` est une commande parfaitement anodine.
 * C'est le hook git `.githooks/pre-commit` qui couvre ce chemin — lui s'exécute quel que soit
 * l'appelant. Les deux sont complémentaires et aucun ne remplace l'autre.
 *
 * Échappement : ` # checks-ok` **en fin de commande**, posé par le skill commit-push une fois
 * `pnpm verify` passé. Le marqueur seul ne suffit pas : le reçu doit couvrir l'état exact du
 * code ET déclarer les 4 checks (ou `check:framework` seul pour un reçu doc, accepté sur un
 * commit qui ne touche que de la documentation). C'est un garde-fou contre l'oubli, pas une
 * barrière de sécurité — quelqu'un de déterminé écrira le reçu à la main.
 */

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const MARKER = /#\s*checks-ok\s*$/

// Le programme git, quelle que soit sa graphie : `Git` (le nom d'un programme ne distingue pas la
// casse sous Windows, en PowerShell comme en Git Bash), `git.exe`, un chemin (`C:\Git\cmd\git.exe`,
// `/usr/bin/git`), ou ouvert par `(` ou `{` (`$r = (git push)`, `{git push}`) ; pas quand il prolonge
// un mot (`.git`, `digit`, `my-git`). Ses sous-commandes, elles, distinguent la casse (`git STATUS`
// échoue). Ces formes passaient sans marqueur (revue de M09, M13a). L'accent grave reste exclu : le
// corps d'un heredoc Bash est lu comme des commandes, et le code en ligne d'un texte markdown
// (`git push` entre accents graves) y serait refusé.
const GIT = '(?<![\\w.`-])[gG][iI][tT](?:\\.[eE][xX][eE])?'

/**
 * Le dépôt que la commande VISE : `cd <dir> &&` en tête, puis `git -C <dir>`, depuis le cwd de
 * la session. Le hook tourne depuis le dossier de la session : sans ce calcul, un commit lancé
 * dans un autre dépôt était jugé sur le reçu de ce checkout. `undefined` : dépôt de la session.
 */
function racineVisee(command, cwd) {
  const chemin = (m) => (m ? (m[1] ?? m[2] ?? m[3]) : undefined)
  // Git Bash écrit `/c/apps/…` ; git.exe lancé par Node attend `c:/apps/…`.
  const natif = (p) => (process.platform === 'win32' ? p.replace(/^\/([a-zA-Z])(?=\/|$)/, '$1:') : p)
  const ARG = `(?:"([^"]+)"|'([^']+)'|([^\\s;&|]+))`
  // Le motif se cherche sur une copie où le texte entre quotes est masqué à longueur égale : un
  // message de commit qui cite `git -C …` ne déplace pas le dépôt visé. L'argument retenu se relit
  // ensuite dans la commande brute, aux mêmes positions.
  const masque = command.replace(/"(?:\\.|[^"\\])*"|'[^']*'/g, (m) => m[0] + 'x'.repeat(m.length - 2) + m[m.length - 1])
  const trouver = (re) => {
    const m = new RegExp(re, 'd').exec(masque)
    const i = m?.indices?.slice(1).findIndex(Boolean)
    if (!m || i === undefined || i < 0) return undefined
    const [debut, fin] = m.indices[i + 1]
    return [undefined, command.slice(debut, fin)]
  }
  let dir = cwd
  const cd = chemin(trouver(`^\\s*cd\\s+${ARG}\\s*&&`))
  if (cd) dir = resolve(dir, natif(cd))
  const c = chemin(trouver(`${GIT}\\s+(?:-{1,2}[^\\s]+(?:\\s+[^-\\s][^\\s]*)?\\s+)*?-C\\s+${ARG}`))
  if (c) dir = resolve(dir, natif(c))
  if (!cd && !c) return undefined
  try {
    return execFileSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return undefined
  }
}

/**
 * Le module qui lit la commande (`scripts/hook-command.mjs`), ou la raison pour laquelle il ne se
 * charge pas. Importé statiquement, un module absent ou cassé faisait sortir node en code 1 avant la
 * première ligne du hook : Claude Code tient ce code pour une erreur non bloquante, et la commande
 * passait sans contrôle (revue de M09). Recopié dans `enforce-bash-rules.mjs` : ce chargement ne peut
 * pas vivre dans un module, dont le chargement est justement ce qui peut échouer.
 */
async function chargerLaLecture() {
  try {
    const lecture = await import('../../scripts/hook-command.mjs')
    if (typeof lecture.neutraliser === 'function') return { lecture }
    return { raison: "il n'exporte plus `neutraliser`" }
  } catch (erreur) {
    return { raison: erreur instanceof Error ? erreur.message : String(erreur) }
  }
}

const LECTURE_ILLISIBLE = (raison) => `BLOQUÉ: scripts/hook-command.mjs ne se charge pas (${raison}).

Sans lui, le gate ne lit plus les commandes : il refuse toute commande qui cite git, au lieu de la
laisser passer sans contrôle. Réparer scripts/hook-command.mjs avec l'outil Edit ou Write, ou dans un
terminal hors de Claude Code (git checkout -- scripts/hook-command.mjs), puis relancer la commande.`

const BLOCK_MESSAGE = `BLOQUÉ: écriture git directe interdite.

Passer par le skill \`commit-push\` (.claude/skills/commit-push/SKILL.md) :
  1. pnpm verify:cached   (les 4 checks, sans les rejouer s'ils viennent de passer)
  2. entrée dans un fichier neuf de docs/changelog.d/
  3. commit + push

Le skill pose lui-même le marqueur d'échappement une fois \`pnpm verify\` réellement passé.`

const deny = (msg) => {
  process.stderr.write(msg + '\n')
  process.exit(2)
}

let raw = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (c) => (raw += c))
process.stdin.on('end', async () => {
  let command = ''
  let outil
  let cwd = process.cwd()
  try {
    const payload = JSON.parse(raw)
    command = payload?.tool_input?.command ?? ''
    outil = payload?.tool_name
    if (typeof payload?.cwd === 'string') cwd = payload.cwd
  } catch {
    process.exit(0) // payload illisible : ne pas bloquer un appel qu'on ne comprend pas
  }
  if (typeof command !== 'string' || !command.trim()) process.exit(0)

  // Sans lecture, le gate échoue fermé sur ce qu'il garde : toute commande qui cite git, quelle qu'en
  // soit la casse ; les autres passent, sans quoi toute commande de toute session serait refusée (M13a).
  const { lecture, raison } = await chargerLaLecture()
  if (!lecture) {
    if (/\bgit\b/i.test(command)) deny(LECTURE_ILLISIBLE(raison))
    process.exit(0)
  }
  const { neutraliser } = lecture

  const marked = MARKER.test(command)

  // Neutraliser les chaînes entre quotes : sans ça, `--force` écrit dans un message de commit
  // déclencherait l'interdit absolu, et `grep "git push"` serait bloqué.
  const bare = neutraliser(command.replace(MARKER, ''), outil)

  // Un shell imbriqué remet la commande dans une chaîne, que la neutralisation ci-dessus efface :
  // `bash -c "git commit -m x"` passerait sans être vu. On ne refuse que si la commande BRUTE
  // mentionne git — sinon `docker run … sh -c "ls"` et `timeout 5 bash -c "echo"` étaient
  // bloqués avec un message parlant de commit-push, ce qui est absurde et fait désactiver le hook.
  // Le lanceur, lui, se cherche hors des chaînes : un message de commit qui cite `bash -c` n'en
  // lance aucun (M09). En PowerShell : Invoke-Expression (alias iex), Start-Process, cmd /c, et un
  // autre powershell ou pwsh lancé sur une chaîne.
  const SHELL_IMBRIQUE = /(?:^|[;&|\s])(?:sh|bash|zsh|env)\s+(?:-\S+\s+)*-c\b|(?:^|[;&|\s])eval\b|\|\s*(?:sh|bash|zsh)\b/
  const SHELL_IMBRIQUE_PS =
    /(?:^|[;&|\s])(?:(?:invoke-expression|iex|start-process)(?![\w-])|cmd(?:\.exe)?\s+\/{1,2}[ck]\b|(?:powershell|pwsh)(?:\.exe)?\s+(?:-\S+\s+)*(?:-c(?:ommand)?\b|["']))/i
  // Git cité : le mot `git` en minuscules, où qu'il soit (entre accents graves, guillemets, dans un
  // chemin), ou le programme dans une autre graphie suivi d'un argument (`bash -c "Git push"`,
  // `Git "push"`). Pas le mot seul dans toute casse, ni suivi d'un opérateur ou d'une option de `cmd` :
  // `Git` est aussi le dossier de Git pour Windows, que cite un shell imbriqué sans lancer git
  // (`& "C:\Program Files\Git\bin\bash.exe" -c "ls"`, `cmd /c "cd C:\Program Files\Git && dir"`,
  // `cmd /c "dir C:\Program Files\Git /s"`, revue de M13a).
  const CITE_GIT = new RegExp(`\\bgit\\b|${GIT}\\s+(?![\\s&|;<>/)])`)
  if (CITE_GIT.test(command) && (SHELL_IMBRIQUE.test(bare) || SHELL_IMBRIQUE_PS.test(bare))) {
    deny(
      "BLOQUÉ: commande git dans un shell imbriqué (`bash -c`, `eval`, `Invoke-Expression`, pipe vers un shell). Son contenu n'est pas analysable : lancer la commande git directement, via le skill commit-push."
    )
  }

  // Verbes qui créent ou publient des commits. `merge`, `revert`, `cherry-pick`, `rebase` et
  // `am` produisent des commits sans passer par `commit` : les exclure laissait un chemin
  // complet pour publier du code jamais vérifié. `commit-tree` écrit un commit par la plomberie.
  const VERBES_COMMIT = 'commit|commit-tree|merge|revert|cherry-pick|rebase|am'
  const VERBES = `${VERBES_COMMIT}|push`
  // `git` peut porter des options globales avant la sous-commande : -C <path>, -c k=v, --no-pager…
  // Le verbe finit sur un blanc ou une ponctuation, jamais sur un tiret : `merge-file` et
  // `merge-base` ne créent aucun commit.
  const motif = (verbes) =>
    new RegExp(`${GIT}((?:\\s+-{1,2}[^\\s]+(?:\\s+[^-\\s][^\\s]*)?)*)\\s+(${verbes})(?![\\w-])`)

  if (!motif(VERBES).test(bare)) process.exit(0)

  // Dépôt visé qui n'utilise pas cette méthode (ni `scripts/verify-receipt.mjs`, ni reçu) : il a son
  // propre gate. Lui appliquer celui-ci, sans reçu possible, refusait tout commit et ne laissait que
  // le contournement. Les interdits absolus (--no-verify, --force) restent appliqués partout ; le
  // dépôt de la session, lui, est toujours gardé.
  const vise = racineVisee(command, cwd)
  const methode = (root) =>
    existsSync(join(root, 'scripts/verify-receipt.mjs')) || existsSync(join(root, '.claude/.verify-receipt.json'))
  const etranger = vise !== undefined && !methode(vise)

  if (/\s--no-verify\b/.test(bare)) {
    deny(
      'BLOQUÉ: --no-verify est interdit, sans échappement possible. Les hooks git font partie du gate.'
    )
  }
  // `-[a-z]*f[a-z]*` et pas `-f\b` : `git push -fu origin main` — la forme la plus courante d'un
  // push forcé — franchissait l'interdit, parce que `\b` ne coupe pas entre `f` et `u`.
  if (/\s(?:--force\b|--force-with-lease\b|-[a-zA-Z]*f[a-zA-Z]*\b)/.test(bare)) {
    deny(
      "BLOQUÉ: --force est interdit, sans échappement possible. Si le push est refusé (conflit, divergence), remonter le problème à l'utilisateur au lieu de le forcer."
    )
  }
  if (/\s--amend\b/.test(bare) && !marked) {
    deny(
      "BLOQUÉ: --amend interdit sans demande explicite de l'utilisateur. Si l'utilisateur l'a demandé et que `pnpm verify` est passé, ajouter ' # checks-ok' en fin de commande."
    )
  }

  if (etranger) process.exit(0)

  if (!marked) deny(BLOCK_MESSAGE)

  // Le marqueur est une déclaration ; le reçu est une preuve. Il n'est exigé que des verbes qui
  // PRODUISENT un commit.
  //
  // `push` en est exclu, et ce n'est pas un trou : il ne publie que du déjà-commité, et chaque
  // verbe capable de produire un commit passe désormais lui-même par ce contrôle — c'est ce qui
  // manquait en v2, où seul `commit` était couvert. L'exiger aussi du push le rendrait de toute
  // façon impossible à satisfaire : le commit qui vient d'avoir lieu change HEAD, donc invalide
  // le reçu. Il faudrait relancer `pnpm verify` entre le commit et le push — soit exactement la
  // double exécution que le reçu existe pour supprimer.
  if (!motif(VERBES_COMMIT).test(bare)) process.exit(0)

  // Autre dépôt de la méthode qui a son propre `verify-receipt.mjs` : il est jugé par SON script,
  // qu'il a pu adapter (exclusions, empreinte) ; l'algorithme de ce checkout refusait un reçu valide.
  const racineSession = resolve(fileURLToPath(new URL('../..', import.meta.url)))
  const meme = (a, b) =>
    process.platform === 'win32' ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b)
  if (vise !== undefined && !meme(vise, racineSession) && existsSync(join(vise, 'scripts/verify-receipt.mjs'))) {
    try {
      // `--commit` : un reçu doc n'y vaut que sur un commit de doc seule. Un script antérieur
      // ignore l'argument, et n'écrit pas de reçu doc.
      execFileSync('node', [join(vise, 'scripts/verify-receipt.mjs'), 'check', '--commit'], { cwd: vise, stdio: 'pipe' })
      process.exit(0)
    } catch (e) {
      deny(
        `BLOQUÉ: marqueur posé mais le reçu de ${vise} ne couvre pas son arbre.\n\n` +
          `${String(e.stdout ?? '')}${String(e.stderr ?? '')}`.trim() +
          `\n\nLancer la vérification de CE dépôt (son \`verify\`), puis relancer la commande.`
      )
    }
  }

  let receipt
  try {
    receipt = await import('../../scripts/verify-receipt.mjs').then((m) =>
      m.checkReceipt({ commit: true })
    )
  } catch {
    process.exit(0) // outillage absent ou illisible : ne pas bloquer sur le framework lui-même
  }

  if (!receipt.valid) {
    deny(
      `BLOQUÉ: marqueur posé mais ${receipt.reason}.\n\n` +
        `Le marqueur atteste que les 4 checks sont passés sur CE code. Lancer :\n` +
        `  pnpm verify\n\n` +
        `puis relancer la commande. Ne pas contourner en supprimant le reçu.`
    )
  }

  // Les checks déclarés par le reçu (les 4, ou `check:framework` pour un reçu doc) sont contrôlés par
  // `checkReceipt` (verify-receipt.mjs), pour ce dépôt comme pour un autre dépôt jugé par son propre script.
  process.exit(0)
})
