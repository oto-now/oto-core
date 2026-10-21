import { execFileSync, spawnSync } from "node:child_process"
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Worker } from "node:worker_threads"
import { afterAll, afterEach, beforeAll, describe, expect, it, onTestFailed } from "vitest"

/**
 * Le gate git est la seule garantie non probabiliste du framework : si un `git push` nu passe,
 * du code non vérifié part en production. Ces tests existent parce que deux réécritures
 * successives du hook ont chacune introduit une régression silencieuse — d'abord une extraction
 * qui tronquait la commande au premier guillemet échappé, puis un matching du JSON brut qui
 * acceptait le marqueur écrit dans un message de commit.
 */

const RECEIPT_SCRIPT = join(process.cwd(), "scripts/verify-receipt.mjs")

// Les tests écrivent dans un reçu ISOLÉ, jamais dans `.claude/.verify-receipt.json`.
// Un `pnpm test` interrompu laisserait sinon un reçu déclarant les 4 checks passés alors que
// seul vitest a tourné — et le gate autoriserait un commit sans type-check ni lint.
const TEST_RECEIPT = join(tmpdir(), `verify-receipt-test-${process.pid}.json`)
const RECEIPT_ENV = { ...process.env, VERIFY_RECEIPT_PATH: TEST_RECEIPT }

// Les blocs du gate hachent un dépôt jetable d'un fichier, pas ce checkout, avec leur propre reçu : le
// gate n'y est jugé que sur la lecture de la commande et sur la présence d'un reçu valable. Écrire le reçu
// du checkout hache tout son contenu (l'arbre de code) : jusqu'à 10 s par écriture, mesuré le 2026-10-21,
// contre 0,5 s ici ; et une autre session qui écrit dans le checkout invalidait le reçu entre son écriture
// et l'appel du gate. Le reçu du checkout reste testé par le bloc « verify-receipt ».
const GATE_ROOT = join(tmpdir(), `verify-receipt-gate-${process.pid}`)
const GATE_ENV = {
  ...process.env,
  VERIFY_RECEIPT_PATH: join(tmpdir(), `verify-receipt-gate-${process.pid}.json`),
  VERIFY_RECEIPT_ROOT: GATE_ROOT,
}

const HOOKS = join(process.cwd(), ".claude/hooks")
const MARKER = "# checks-ok"

const payloadOf = (command: string, extra: Record<string, unknown>, tool: "Bash" | "PowerShell") =>
  JSON.stringify({ tool_name: tool, tool_input: { command, ...extra } })

/** Le hook lancé comme Claude Code le lance : un processus node, le JSON d'une commande Bash sur stdin. */
function runHookProcess(hook: string, command: string, env: NodeJS.ProcessEnv = GATE_ENV): number {
  try {
    execFileSync("node", [join(HOOKS, hook)], { input: payloadOf(command, {}, "Bash"), stdio: "pipe", env })
    return 0
  } catch (error) {
    return (error as { status: number }).status
  }
}

/**
 * Le même contrat (le JSON sur stdin, le code de sortie), dans un thread : le hook s'y charge tel quel, y lit
 * `process.stdin`, et son `process.exit` arrête le thread avec ce code ; une exception non rattrapée y sort en
 * code 1, comme le processus. Un processus node par appel coûtait trois fois plus (mesuré le 2026-10-21) ;
 * `runHookProcess` garde le lancement réel dans un test par hook.
 */
function runHook(
  hook: string,
  command: string,
  extra: Record<string, unknown> = {},
  tool: "Bash" | "PowerShell" = "Bash"
): Promise<number> {
  return new Promise((resolve) => {
    const worker = new Worker(join(HOOKS, hook), { stdin: true, stdout: true, stderr: true, env: GATE_ENV })
    worker.stdout.resume()
    worker.stderr.resume()
    worker.on("error", () => {})
    worker.on("exit", resolve)
    worker.stdin?.end(payloadOf(command, extra, tool))
  })
}

const gate = (command: string, extra?: Record<string, unknown>) =>
  runHook("enforce-git-gate.mjs", command, extra)
const bashRules = (command: string, extra?: Record<string, unknown>) =>
  runHook("enforce-bash-rules.mjs", command, extra)

const BLOCKED = 2
const ALLOWED = 0


function receipt(action: "write" | "check" | "clear", env: NodeJS.ProcessEnv = RECEIPT_ENV): number {
  try {
    execFileSync("node", [RECEIPT_SCRIPT, action], { stdio: "pipe", env })
    return 0
  } catch (error) {
    return (error as { status: number }).status
  }
}

const gateReceipt = (action: "write" | "check" | "clear") => receipt(action, GATE_ENV)

beforeAll(() => {
  rmSync(GATE_ROOT, { recursive: true, force: true })
  execFileSync("git", ["init", "--quiet", GATE_ROOT], { stdio: "pipe" })
  writeFileSync(join(GATE_ROOT, "a.ts"), "export const a = 1\n")
  const g = (...args: string[]) => execFileSync("git", ["-C", GATE_ROOT, ...args], { stdio: "pipe" })
  g("add", "a.ts")
  g("-c", "user.email=test@test", "-c", "user.name=test", "commit", "--quiet", "--no-verify", "-m", "init")
}, 30_000)

afterAll(() => {
  rmSync(TEST_RECEIPT, { force: true })
  rmSync(GATE_ENV.VERIFY_RECEIPT_PATH, { force: true })
  rmSync(GATE_ROOT, { recursive: true, force: true })
})

// Délai de chaque test, et du `beforeAll` qui écrit le reçu : chaque appel au script de reçu lance
// node, chaque appel au hook un thread, et le gate comme le reçu lancent git (empreinte de l'arbre,
// dépôts jetables). Mesuré le 2026-09-24, VITEST_MAX_FORKS=2, sur la machine partagée par les agents,
// quand chaque appel au hook lançait node : pendant une autre suite, jusqu'à 10,5 s pour un test de
// verify-receipt et 4,8 s pour les sept lancements de node d'un test d'enforce-bash-rules ; le délai de
// 5 s par défaut a sauté trois fois ce jour-là (M03). 30 s laisse près de trois fois le pire temps mesuré.
const SPAWN_TIMEOUT = 30_000

// Délai du bloc « verify-receipt » : ses tests hachent l'arbre à chaque écriture ou lecture du reçu et à
// chaque appel du gate. Moins de 2 s par test au calme (M15b-1) ; 7 s pour chacun des trois tests qui
// écrivent le reçu de ce checkout, le fichier lancé seul le 2026-10-21 ; deux cas à 40 et 53 s le 2026-09-25,
// pendant un `pnpm verify` complet, huit à neuf worktrees sur la machine (E01-S08). 60 s : le plafond
// d'un test synchrone (testing-strategy.md § Anti-patterns).
const RECEIPT_TIMEOUT = 60_000

// Un test qui lance node ou git par `execFileSync` bloque son processus : sans un tour de boucle d'événements entre
// deux tests, les réponses aux appels internes de Vitest (`onTaskUpdate`) ne sont traitées qu'en
// fin de fichier ; passé 60 s cumulées, Vitest les déclare expirées et le passage échoue, tests
// verts compris. Le fichier a duré de 18 à 59 s le 2026-09-24 selon la charge de la machine.
afterEach(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))

describe("enforce-git-gate", { timeout: SPAWN_TIMEOUT }, () => {
  // Le gate exige un reçu couvrant l'arbre (ici, du dépôt jetable) pour laisser passer un commit marqué. Écrit une
  // fois : rien entre deux tests ne change le dépôt jetable, et les deux tests qui retirent ou
  // faussent le reçu le réécrivent avant de finir, ou après leur échec.
  beforeAll(() => {
    gateReceipt("write")
  }, SPAWN_TIMEOUT)

  it("bloque un commit et un push nus", () => {
    // Lancement réel du hook (un processus node), le contrat du point d'entrée.
    expect(runHookProcess("enforce-git-gate.mjs", "git push")).toBe(BLOCKED)
    expect(runHookProcess("enforce-git-gate.mjs", 'git commit -m "feat: x"')).toBe(BLOCKED)
  })

  it("bloque les options globales de git utilisées pour contourner le motif", async () => {
    expect(await gate("git -C /repo commit -m x")).toBe(BLOCKED)
    expect(await gate("git --no-pager push")).toBe(BLOCKED)
    expect(await gate("git -c user.email=a@b push")).toBe(BLOCKED)
    expect(await gate("cd /tmp && git push")).toBe(BLOCKED)
  })

  it("n'accepte le marqueur qu'en fin de commande, jamais dans un message ou une description", async () => {
    expect(await gate('git commit -m "docs: expliquer checks-ok"')).toBe(BLOCKED)
    expect(await gate("git push", { description: "voir checks-ok" })).toBe(BLOCKED)
    expect(await gate(`git commit -m "feat: x" ${MARKER}`)).toBe(ALLOWED)
    expect(await gate(`git push -u origin ma-branche ${MARKER}`)).toBe(ALLOWED)
  })

  it("refuse --force et --no-verify même marqués", async () => {
    expect(await gate(`git push --force ${MARKER}`)).toBe(BLOCKED)
    expect(await gate(`git push --force-with-lease ${MARKER}`)).toBe(BLOCKED)
    expect(await gate(`git commit --no-verify -m x ${MARKER}`)).toBe(BLOCKED)
  })

  it("ne bloque pas les commandes git en lecture ni les commandes qui citent git", async () => {
    expect(await gate("git status --short")).toBe(ALLOWED)
    expect(await gate("git log --oneline -5")).toBe(ALLOWED)
    expect(await gate("git add src/")).toBe(ALLOWED)
    expect(await gate('grep -rn "git commit" docs/')).toBe(ALLOWED)
    expect(await gate("ls -la", { description: "prepare le git push" })).toBe(ALLOWED)
  })

  it("ne bloque pas un message de commit qui contient le texte d'un flag interdit", async () => {
    expect(await gate(`git commit -m "fix: gerer --force" ${MARKER}`)).toBe(ALLOWED)
  })

  it("couvre les verbes qui produisent un commit sans passer par `commit`", async () => {
    // `merge`, `revert`, `cherry-pick`, `rebase` et `am` écrivent des commits et peuvent les
    // publier. Les laisser hors du motif ouvrait un chemin complet pour du code jamais vérifié.
    expect(await gate("git merge feature/x")).toBe(BLOCKED)
    expect(await gate("git revert HEAD")).toBe(BLOCKED)
    expect(await gate("git cherry-pick abc1234")).toBe(BLOCKED)
    expect(await gate("git rebase main")).toBe(BLOCKED)
    expect(await gate("git am patch.mbox")).toBe(BLOCKED)
  })

  it("refuse les formes agglomérées de --force", async () => {
    // `git push -fu origin main` est la forme la plus courante d'un push forcé. `-f\b` ne coupe
    // pas entre `f` et `u` : elle franchissait l'interdit.
    expect(await gate(`git push -fu origin main ${MARKER}`)).toBe(BLOCKED)
    expect(await gate(`git push -uf origin main ${MARKER}`)).toBe(BLOCKED)
  })

  it("exige un reçu de tout verbe qui produit un commit, mais pas du push", async () => {
    onTestFailed(() => {
      gateReceipt("write")
    })
    expect(gateReceipt("clear")).toBe(0)
    expect(await gate(`git merge feature/x ${MARKER}`)).toBe(BLOCKED)
    expect(await gate(`git cherry-pick abc1234 ${MARKER}`)).toBe(BLOCKED)

    // `push` ne publie que du déjà-commité, et chaque verbe qui produit un commit passe
    // désormais par le contrôle ci-dessus. L'exiger du push serait impossible à satisfaire :
    // le commit qui vient d'avoir lieu change HEAD, donc invalide le reçu — il faudrait
    // relancer `pnpm verify` entre le commit et le push.
    expect(await gate(`git push -u origin ma-branche ${MARKER}`)).toBe(ALLOWED)

    expect(gateReceipt("write")).toBe(0)
    expect(await gate(`git merge feature/x ${MARKER}`)).toBe(ALLOWED)
  })

  it("refuse un reçu qui ne déclare pas les 4 checks", async () => {
    // Le champ `checks` était écrit puis jamais relu : le reçu prouvait l'identité de l'arbre,
    // pas que quoi que ce soit avait été vérifié.
    onTestFailed(() => {
      gateReceipt("write")
    })
    execFileSync("node", [RECEIPT_SCRIPT, "write", "test"], { stdio: "pipe", env: GATE_ENV })
    expect(await gate(`git commit -m "feat: x" ${MARKER}`)).toBe(BLOCKED)
    expect(gateReceipt("write")).toBe(0)
    expect(await gate(`git commit -m "feat: x" ${MARKER}`)).toBe(ALLOWED)
  })

  it("refuse les shells imbriqués, qui rendent la commande inanalysable", async () => {
    // La neutralisation des chaînes entre quotes efface le contenu de `bash -c "..."` :
    // sans ce refus, la commande git y devient invisible et le gate laisse tout passer.
    expect(await gate('bash -c "git commit -m x"')).toBe(BLOCKED)
    expect(await gate('sh -c "git push"')).toBe(BLOCKED)
    expect(await gate('eval "git push"')).toBe(BLOCKED)
    expect(await gate('echo "git push" | bash')).toBe(BLOCKED)
  })

  it("ne refuse un shell imbriqué que s'il mentionne git", async () => {
    // Le refus portait sur TOUT shell imbriqué : `docker run … sh -c "ls"` était bloqué par un
    // message parlant de commit-push. Un hook qui bloque l'anodin finit désactivé.
    expect(await gate('bash -c "ls -la"')).toBe(ALLOWED)
    expect(await gate('timeout 5 sh -c "echo ok"')).toBe(ALLOWED)
    expect(await gate('docker run alpine sh -c "cat /etc/os-release"')).toBe(ALLOWED)
  })
})

describe("verify-receipt", { timeout: RECEIPT_TIMEOUT }, () => {
  const run = (args: string[]): number => receipt(args[0] as "write" | "check" | "clear")

  it("valide un reçu écrit sur l'arbre courant, l'invalide dès que le code change", () => {
    expect(run(["write"])).toBe(0)
    expect(run(["check"])).toBe(0)

    const scratch = join(process.cwd(), "src/lib/utils/.receipt-probe.ts")
    writeFileSync(scratch, "export const probe = 1\n")
    try {
      // Le reçu couvrait un arbre sans ce fichier : il ne doit plus être valide.
      expect(run(["check"])).toBe(1)
    } finally {
      rmSync(scratch, { force: true })
    }

    // Retour à l'état couvert par le reçu → de nouveau valide, sans avoir rejoué les checks.
    expect(run(["check"])).toBe(0)
  })

  it("reste valide après un `git add` — le staging ne change pas le code", () => {
    const scratch = join(process.cwd(), "src/lib/utils/.receipt-staged.ts")
    writeFileSync(scratch, "export const staged = 1\n")
    try {
      expect(run(["write"])).toBe(0)
      // `git add` fait passer le fichier de « non suivi » à « indexé » sans toucher une ligne.
      // Si l'empreinte dépendait du staging, le reçu serait invalidé juste avant le commit.
      execFileSync("git", ["add", scratch], { stdio: "pipe" })
      expect(run(["check"])).toBe(0)
    } finally {
      execFileSync("git", ["rm", "-f", "--quiet", "--ignore-unmatch", scratch], { stdio: "pipe" })
      rmSync(scratch, { force: true })
    }
  })

  it("détecte un renommage dans les deux sens", () => {
    // Ce test EXIGE un dépôt jetable avec un vrai commit. Sa version précédente créait la
    // fixture dans le dépôt courant et se contentait d'un `git add` : le chemin d'origine
    // n'ayant jamais existé dans HEAD, git n'émettait aucune ligne `R` et `--no-renames` ne
    // changeait rien. Le test passait sans jamais exercer la régression qu'il documente.
    const repo = join(tmpdir(), `rename-repo-${process.pid}`)
    rmSync(repo, { recursive: true, force: true })
    const g = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "pipe" })
    execFileSync("git", ["init", "--quiet", repo], { stdio: "pipe" })
    try {
      g("config", "user.email", "test@test")
      g("config", "user.name", "test")
      writeFileSync(join(repo, "a.ts"), "export const renamed = 1\n")
      g("add", "a.ts")
      g("commit", "--quiet", "--no-verify", "-m", "init")

      // `VERIFY_RECEIPT_ROOT` est indispensable : le script pointe git sur SA propre racine,
      // pas sur le cwd. Sans cette variable, ce test hacherait le dépôt du template.
      const env = {
        ...process.env,
        // Le reçu vit HORS du dépôt : dedans, il serait un fichier non suivi, donc compté dans
        // sa propre empreinte — l'écrire l'invaliderait aussitôt. Dans le template, c'est
        // `.gitignore` qui joue ce rôle pour `.claude/.verify-receipt.json`.
        VERIFY_RECEIPT_PATH: `${repo}-receipt.json`,
        VERIFY_RECEIPT_ROOT: repo,
      }
      const receiptIn = (action: string): number => {
        try {
          execFileSync("node", [RECEIPT_SCRIPT, action], { cwd: repo, stdio: "pipe", env })
          return 0
        } catch (error) {
          return (error as { status: number }).status
        }
      }
      expect(receiptIn("write")).toBe(0)
      expect(receiptIn("check")).toBe(0)

      // `a.ts` est dans HEAD : le renommer produit bien un `R100 a.ts b.ts`. Restaurer `a.ts`
      // à l'identique fait coexister les deux fichiers — le code a changé. Sans `--no-renames`,
      // seule la destination était enregistrée, la disparition de la source jamais, et le
      // contenu restauré à l'identique redonnait l'empreinte d'origine : reçu valide à tort.
      g("mv", "a.ts", "b.ts")
      writeFileSync(join(repo, "a.ts"), "export const renamed = 1\n")
      expect(receiptIn("check")).toBe(1)
    } finally {
      rmSync(repo, { recursive: true, force: true })
      rmSync(`${repo}-receipt.json`, { force: true })
    }
  })

  it("ne casse pas sur un dépôt sans commit", () => {
    // Premier commit d'un projet issu du template : `git rev-parse HEAD` échoue. Sans garde,
    // `pnpm verify` mourait APRÈS avoir passé les 4 checks, et le gate refusait le commit en
    // boucle — sans échappement possible puisque `--no-verify` est bloqué.
    const repo = join(tmpdir(), `empty-repo-${process.pid}`)
    rmSync(repo, { recursive: true, force: true })
    execFileSync("git", ["init", "--quiet", repo], { stdio: "pipe" })
    try {
      // `VERIFY_RECEIPT_ROOT` : sans elle, le script hachait le dépôt du template et ce test
      // n'exerçait jamais le cas « pas de HEAD » qu'il prétend couvrir.
      const env = {
        ...process.env,
        VERIFY_RECEIPT_PATH: join(repo, "receipt.json"),
        VERIFY_RECEIPT_ROOT: repo,
      }
      execFileSync("node", [RECEIPT_SCRIPT, "write"], { cwd: repo, stdio: "pipe", env })
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  it("sans commit, reste valide après `git add -A` et voit un fichier indexé qui change", () => {
    // Dépôts neufs de la coupe (oto-pkg, oto-saas) : `pnpm verify`, puis `git add -A`, puis le commit
    // initial. L'empreinte ne comptait que les non-suivis : après `git add -A` elle ne voyait plus
    // rien, et le gate refusait le commit ; un fichier indexé modifié passait inaperçu.
    const repo = join(tmpdir(), `empty-staged-${process.pid}`)
    rmSync(repo, { recursive: true, force: true })
    execFileSync("git", ["init", "--quiet", repo], { stdio: "pipe" })
    const env = { ...process.env, VERIFY_RECEIPT_PATH: `${repo}-receipt.json`, VERIFY_RECEIPT_ROOT: repo }
    const receiptIn = (action: string): number => {
      try {
        execFileSync("node", [RECEIPT_SCRIPT, action], { cwd: repo, stdio: "pipe", env })
        return 0
      } catch (error) {
        return (error as { status: number }).status
      }
    }
    try {
      writeFileSync(join(repo, "a.ts"), "export const a = 1\n")
      expect(receiptIn("write")).toBe(0)
      execFileSync("git", ["add", "-A"], { cwd: repo, stdio: "pipe" })
      expect(receiptIn("check")).toBe(0)
      writeFileSync(join(repo, "a.ts"), "export const a = 2\n")
      expect(receiptIn("check")).toBe(1)
    } finally {
      rmSync(repo, { recursive: true, force: true })
      rmSync(`${repo}-receipt.json`, { force: true })
    }
  })

  it("le gate refuse un commit marqué si aucun reçu ne couvre le code", () => {
    // Le gate lancé par node sur le reçu de ce checkout : le chemin complet, de bout en bout.
    const realGate = (command: string) => runHookProcess("enforce-git-gate.mjs", command, RECEIPT_ENV)
    expect(run(["clear"])).toBe(0)
    expect(realGate(`git commit -m "feat: x" ${MARKER}`)).toBe(BLOCKED)
    expect(run(["write"])).toBe(0)
    expect(realGate(`git commit -m "feat: x" ${MARKER}`)).toBe(ALLOWED)
  })
})

// M11b (fiche D33) : une preuve par règle du hook des sorties de check,
// chaque lancement de node coûtant jusqu'à 0,7 s sous charge. Les frontières permises gardent leur
// cas (`testing-strategy.md § Anti-patterns`, motif élargi) ; les permutations d'une même règle (noms de
// check, commandes en arrière-plan, chaînes citées) sont retirées, les autres cas réunis ici.
describe("enforce-bash-rules", { timeout: SPAWN_TIMEOUT }, () => {
  it("empêche de tronquer ou rediriger la sortie d'un check", () => {
    // `verify:cached` : les 4 checks ne sont plus lancés séparément, et la seule commande du workflow
    // échappait à une règle qui ne visait que les commandes individuelles.
    // Lancement réel du hook (un processus node), le contrat du point d'entrée.
    expect(runHookProcess("enforce-bash-rules.mjs", "pnpm type-check | tail -20")).toBe(BLOCKED)
    expect(runHookProcess("enforce-bash-rules.mjs", "pnpm verify:cached > out.txt")).toBe(BLOCKED)
  })

  it("laisse passer les checks bruts et les pipes hors checks", async () => {
    // Les règles ne visent QUE l'exécution d'un check : `-` valide une frontière de mot, et un nom de
    // paquet qui contient un check passe.
    expect(await bashRules("pnpm type-check")).toBe(ALLOWED)
    expect(await bashRules("git log --oneline | head -5")).toBe(ALLOWED)
    expect(await bashRules("pnpm add -D eslint-plugin-import")).toBe(ALLOWED)
  })

  it("autorise `run_in_background`, y compris sur un check", async () => {
    // La règle qui le bloquait reposait sur « sa sortie serait invisible » — faux : le harness
    // notifie à la fin et la sortie reste récupérable. Et ce n'est pas la lecture de la sortie
    // qui atteste qu'un check est passé, c'est le reçu, écrit dans les deux cas.
    expect(await bashRules("pnpm test", { run_in_background: true })).toBe(ALLOWED)

    // Les autres règles restent actives sur une commande en arrière-plan.
    expect(await bashRules("pnpm test | tail -20", { run_in_background: true })).toBe(BLOCKED)
  })

  it("ne voit un check qu'en position de commande", async () => {
    // Sans ancre, le simple mot `eslint` ou `vitest` n'importe où déclenchait la règle ; un préfixe
    // qui accepterait n'importe quels mots bloquait la recherche ci-dessous, le mode d'échec le plus
    // probable du hook (son en-tête) ; `.` valide une frontière de mot ; une chaîne citée n'est pas
    // une commande.
    expect(await bashRules("grep -rn vitest src | head")).toBe(ALLOWED)
    expect(await bashRules("cat vitest.config.ts | head -5")).toBe(ALLOWED)
    expect(await bashRules("rg 'pnpm test' docs/ | head -20")).toBe(ALLOWED)
    // …mais un check chaîné derrière `&&` ou un saut de ligne reste en position de commande :
    // une Bash multi-lignes est une seule chaîne.
    expect(await bashRules("git status && pnpm type-check | tail -5")).toBe(BLOCKED)
    expect(await bashRules("git status\npnpm type-check | tail -5")).toBe(BLOCKED)
  })

  it("should see a check behind environment assignments or `rtk proxy`, and let the raw check through", async () => {
    // Le motif n'attendait le check qu'au début de la commande : précédé de `VITEST_MAX_FORKS=2`
    // (la consigne des agents sur la machine partagée) ou du proxy de sortie `rtk proxy`, il
    // échappait aux trois règles (M04, 2026-09-24).
    expect(await bashRules("VITEST_MAX_FORKS=2 pnpm verify > log")).toBe(BLOCKED)
    expect(await bashRules("rtk proxy pnpm verify | head")).toBe(BLOCKED)
    expect(await bashRules("VITEST_MAX_FORKS=2 pnpm verify")).toBe(ALLOWED)
    expect(await bashRules("rtk proxy pnpm verify")).toBe(ALLOWED)
  })
})

// M09 : l'outil PowerShell de Claude Code passe par les deux hooks (il envoie sa commande dans
// `tool_input.command`, comme Bash), et chaque commande est lue avec la grammaire de son shell.
const psGate = (command: string) => runHook("enforce-git-gate.mjs", command, {}, "PowerShell")
const psRules = (command: string) => runHook("enforce-bash-rules.mjs", command, {}, "PowerShell")

describe(".claude/settings.json", () => {
  it("should run both hooks on the Bash and PowerShell tools", () => {
    // Le matcher « Bash » seul laissait passer tout `git commit` ou check tronqué lancé par PowerShell.
    // `JSON.parse` rend `any` : le type ne décrit que la partie lue ici.
    const settings = JSON.parse(readFileSync(join(process.cwd(), ".claude/settings.json"), "utf8")) as {
      hooks: { PreToolUse: { matcher: string; hooks: { command: string }[] }[] }
    }
    const entries = settings.hooks.PreToolUse.map(({ matcher, hooks }) => ({
      matcher,
      commands: hooks.map((h) => h.command),
    }))
    expect(entries).toEqual([
      {
        matcher: "Bash|PowerShell",
        commands: [expect.stringContaining("enforce-bash-rules.mjs"), expect.stringContaining("enforce-git-gate.mjs")],
      },
    ])
  })
})

describe("enforce-git-gate, PowerShell and quoted text", { timeout: SPAWN_TIMEOUT }, () => {
  // Écrit une fois : aucun test du bloc ne touche au reçu ni au dépôt jetable.
  beforeAll(() => {
    gateReceipt("write")
  }, SPAWN_TIMEOUT)

  it("should see a commit or a push behind `;`, the call operator `&` or the stop-parsing token `--%`", async () => {
    expect(await psGate("$env:GIT_TRACE=1; git push")).toBe(BLOCKED)
    expect(await psGate('& "C:\\Program Files\\Git\\cmd\\git.exe" commit -m x')).toBe(BLOCKED)
    expect(await psGate("git --% commit -m x")).toBe(BLOCKED)
  })

  it("should end a PowerShell string where PowerShell ends it, backslash or not", async () => {
    // Lue avec la grammaire de Bash, `\"` échappait le guillemet : la chaîne courait jusqu'au
    // guillemet suivant et cachait le `--no-verify` que PowerShell passe bien à git.
    expect(await psGate(`git commit -m "C:\\dossier\\" --no-verify -m "y" ${MARKER}`)).toBe(BLOCKED)
  })

  it("should accept a here-string commit message whatever its text", async () => {
    // La forme multi-ligne des messages en PowerShell : l'apostrophe de « l'agent » exposait le
    // texte du message, et le `--force` qu'il cite bloquait le commit.
    expect(await psGate(`git commit -m @'\nfix: l'agent ne passe plus --force\n'@ ${MARKER}`)).toBe(ALLOWED)
  })

  it("should refuse PowerShell launchers that hide a git command in a string", async () => {
    expect(await psGate('Invoke-Expression "git commit -m x"')).toBe(BLOCKED)
    expect(await psGate('powershell -Command "git push"')).toBe(BLOCKED)
    expect(await psGate('cmd /c "git push"')).toBe(BLOCKED)
    expect(await psGate('Start-Process git -ArgumentList "push"')).toBe(BLOCKED)
  })

  it("should not take a launcher quoted in a commit message for a nested shell", async () => {
    // Le lanceur était cherché dans la commande brute : ce message suffisait à bloquer le commit.
    expect(await gate(`git commit -m "fix: refuser bash -c et Invoke-Expression" ${MARKER}`)).toBe(ALLOWED)
  })

  it("should not let the apostrophe of a double-quoted message open a string", async () => {
    // Deux passes, apostrophes puis guillemets, appariaient l'apostrophe de « l'agent » avec la
    // chaîne `'x'` qui suit : le `--no-verify` placé entre les deux disparaissait, et Bash le passe.
    expect(await gate(`git commit -m "l'agent" --no-verify -m 'x' ${MARKER}`)).toBe(BLOCKED)
  })

})

// M11b : un cmdlet par mécanisme (tronquer, écrire dans un fichier) ; `Measure-Object`, `Tee-Object`,
// `Set-Content`, `Add-Content` et `Out-Null`, autres noms de la même liste, sont retirés.
describe("enforce-bash-rules, PowerShell", { timeout: SPAWN_TIMEOUT }, () => {
  it("should block a check piped into Select-Object", async () => {
    expect(await psRules("pnpm test | Select-Object -Last 20")).toBe(BLOCKED)
  })

  it("should block a check sent to a file by `*>` or a cmdlet", async () => {
    expect(await psRules("pnpm test *> out.txt")).toBe(BLOCKED)
    expect(await psRules("pnpm verify | Out-File out.txt")).toBe(BLOCKED)
  })

  it("should see a check behind `;`, the call operator `&` or the stop-parsing token `--%`", async () => {
    expect(await psRules("$env:VITEST_MAX_FORKS=2; pnpm verify | Select-Object -Last 5")).toBe(BLOCKED)
    expect(await psRules('& "pnpm" test > out.txt')).toBe(BLOCKED)
    expect(await psRules("pnpm --% test | Select-Object -Last 5")).toBe(BLOCKED)
  })

  it("should block a polling loop around a check", async () => {
    expect(await psRules("while ($true) { pnpm test; Start-Sleep 5 }")).toBe(BLOCKED)
  })

  it("should allow the raw check, a Select-Object after another command and a Select-String filter", async () => {
    // `$env:VITEST_MAX_FORKS=2; pnpm verify` est la consigne des agents en PowerShell ;
    // Select-String filtre comme grep, que la règle 1 laisse passer.
    expect(await psRules("$env:VITEST_MAX_FORKS=2; pnpm verify")).toBe(ALLOWED)
    expect(await psRules("git log --oneline | Select-Object -First 5")).toBe(ALLOWED)
    expect(await psRules("pnpm test | Select-String FAIL")).toBe(ALLOWED)
  })
})

describe("enforce-bash-rules, prefixes and launchers", { timeout: SPAWN_TIMEOUT }, () => {
  // M11b : `rtk` suivi d'une sous-commande une fois ; `rtk pnpm test` et `rtk lint`, autres
  // sous-commandes du même préfixe, sont retirés.
  it("should see a check behind env, timeout or rtk followed by a subcommand", async () => {
    expect(await bashRules("env VITEST_MAX_FORKS=2 pnpm test | tail -5")).toBe(BLOCKED)
    expect(await bashRules("timeout 600 pnpm verify > out.txt")).toBe(BLOCKED)
    expect(await bashRules("rtk vitest run | head")).toBe(BLOCKED)
  })

  it("should see a local binary run by pnpm exec, pnpm alone or npx", async () => {
    expect(await bashRules("pnpm exec vitest run | tail")).toBe(BLOCKED)
    expect(await bashRules("VITEST_MAX_FORKS=2 pnpm vitest run tests/unit/hooks.test.ts | tail -20")).toBe(BLOCKED)
    expect(await bashRules("npx tsc --noEmit | head")).toBe(BLOCKED)
  })

  it("should allow these checks without a pipe or a redirection", async () => {
    expect(await bashRules("env VITEST_MAX_FORKS=2 pnpm test")).toBe(ALLOWED)
    expect(await bashRules("timeout 600 pnpm verify")).toBe(ALLOWED)
    expect(await bashRules("rtk pnpm test")).toBe(ALLOWED)
    expect(await bashRules("pnpm exec vitest run")).toBe(ALLOWED)
  })
})

describe("hooks, commit-push and reading commands", { timeout: SPAWN_TIMEOUT }, () => {
  // Une fois fusionnés, ces hooks sont ceux de la session du pilote : un faux positif sur l'une de
  // ces formes bloquerait tous ses commits. Chacune passe les deux hooks, par Bash et par PowerShell.
  beforeAll(() => {
    gateReceipt("write")
  }, SPAWN_TIMEOUT)

  it.each([
    ["pnpm verify:cached", "pnpm verify:cached"],
    ['git commit -m "…" -m "…" # checks-ok', `git commit -m "feat: x" -m "Co-Authored-By: Claude <noreply@anthropic.com>" ${MARKER}`],
    ["git push -q origin main # checks-ok", `git push -q origin main ${MARKER}`],
    ["git -C <checkout> commit … # checks-ok", `git -C "${process.cwd()}" commit -m "feat: x" ${MARKER}`],
    ["git status --short", "git status --short"],
    ["git log --oneline -5", "git log --oneline -5"],
    ["git diff --stat", "git diff --stat"],
  ])("should let `%s` through both hooks, from Bash and PowerShell", async (_form, command) => {
    for (const tool of ["Bash", "PowerShell"] as const) {
      expect({
        tool,
        gate: await runHook("enforce-git-gate.mjs", command, {}, tool),
        rules: await runHook("enforce-bash-rules.mjs", command, {}, tool),
      }).toEqual({ tool, gate: ALLOWED, rules: ALLOWED })
    }
  })
})

// M13a (revue de M09) : les graphies du programme git qui passaient sans marqueur, deux faux positifs
// de la règle des sorties de check, et les hooks fermés quand leur lecture ne se charge pas.
describe("enforce-git-gate, spellings of the git program", { timeout: SPAWN_TIMEOUT }, () => {
  it.each<[string, "Bash" | "PowerShell"]>([
    ["Git push", "PowerShell"],
    ["git.exe push", "PowerShell"],
    ["C:\\Git\\cmd\\git.exe push", "PowerShell"],
    ["$r = (git push)", "PowerShell"],
    ["{git push}", "PowerShell"],
    ['bash -c "Git push"', "Bash"],
    // Une sous-commande entre guillemets reste un argument de git.
    [`bash -c 'Git "push"'`, "Bash"],
    // Dans un shell imbriqué, le mot `git` en minuscules suffit, entre accents graves compris.
    ['bash -c "echo `git push`"', "Bash"],
  ])("should refuse `%s` without the marker, from %s", async (command, tool) => {
    expect(await runHook("enforce-git-gate.mjs", command, {}, tool)).toBe(BLOCKED)
  })

  it.each<[string, "Bash" | "PowerShell"]>([
    ['& "C:\\Program Files\\Git\\bin\\bash.exe" -c "ls -la"', "PowerShell"],
    ['cmd /c "dir C:\\Program Files\\Git"', "PowerShell"],
    ['bash -c "ls /c/Program\\ Files/Git"', "Bash"],
    // Le dossier suivi d'un blanc, puis d'un opérateur ou d'une option de `cmd` : pas un argument de git.
    ['cmd /c "cd C:\\Program Files\\Git && dir"', "PowerShell"],
    ['cmd /c "dir C:\\Program Files\\Git /s"', "PowerShell"],
  ])("should let `%s` through from %s, the Git folder of Git for Windows being no git command", async (command, tool) => {
    // Ces shells imbriqués passaient avant M13a : le mot `Git` n'y lance pas git (revue de M13a).
    expect(await runHook("enforce-git-gate.mjs", command, {}, tool)).toBe(ALLOWED)
  })

  it("should let a Bash heredoc of markdown quote `git push` as inline code", async () => {
    // Le corps d'un heredoc est lu comme des commandes, et un texte à écrire passe par un heredoc
    // (CLAUDE.md § Modifications documentaires, règle 4) : l'accent grave n'ouvre pas le programme git.
    expect(await gate("cat <<'EOF' >> notes.md\nLe gate refuse `git push` sans marqueur.\nEOF")).toBe(ALLOWED)
  })
})

describe("enforce-bash-rules, output that stays in the terminal", { timeout: SPAWN_TIMEOUT }, () => {
  it.each<[string, "Bash" | "PowerShell"]>([
    // `*>&1` réunit tous les flux dans la sortie : rien ne part dans un fichier.
    ["pnpm verify *>&1", "PowerShell"],
    // Les erreurs restent aussi dans le terminal.
    ["pnpm verify >&2", "Bash"],
    // Un objet PowerShell commence par une clé : `vitest` n'y est pas lancé.
    ["[pscustomobject]@{ vitest = '3.2.4' } | Out-File versions.txt", "PowerShell"],
  ])("should allow `%s` from %s, which sends no check output to a file", async (command, tool) => {
    expect(await runHook("enforce-bash-rules.mjs", command, {}, tool)).toBe(ALLOWED)
  })

  it("should refuse `pnpm verify >&3`, another descriptor being possibly a file", async () => {
    // `exec 3>out.txt` lie le descripteur 3 à un fichier : seules la sortie et les erreurs restent dans
    // le terminal (revue de M13a).
    expect(await bashRules("pnpm verify >&3")).toBe(BLOCKED)
  })
})

describe("hooks whose reading module does not load", { timeout: SPAWN_TIMEOUT }, () => {
  // Une copie du hook dans un dépôt jetable, où `scripts/hook-command.mjs` manque ou n'exporte plus ce
  // que le hook lit : importé statiquement, il faisait sortir node en code 1, que Claude Code tient
  // pour une erreur non bloquante, et tout passait. Les hooks du dépôt ne sont jamais touchés.
  let dir: string
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "hooks-sans-lecture-"))
  })
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it.each<[string, string | null, string]>([
    ["enforce-git-gate.mjs", null, "git push"],
    ["enforce-bash-rules.mjs", "export const autre = 1\n", "pnpm test"],
  ])("should have %s refuse what it guards, naming the module to repair, and let other commands through", (hook, module, guarded) => {
    const root = mkdtempSync(join(dir, "depot-"))
    mkdirSync(join(root, ".claude/hooks"), { recursive: true })
    copyFileSync(join(HOOKS, hook), join(root, ".claude/hooks", hook))
    if (module !== null) {
      mkdirSync(join(root, "scripts"))
      writeFileSync(join(root, "scripts/hook-command.mjs"), module)
    }
    const run = (command: string) =>
      spawnSync(process.execPath, [join(root, ".claude/hooks", hook)], {
        input: JSON.stringify({ tool_name: "Bash", tool_input: { command } }),
        encoding: "utf8",
      })

    const refused = run(guarded)
    expect({ status: refused.status, nomme: refused.stderr.includes("scripts/hook-command.mjs ne se charge pas") }).toEqual({
      status: BLOCKED,
      nomme: true,
    })
    expect(run("ls -la").status).toBe(ALLOWED)
  })
})
