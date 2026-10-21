// @vitest-environment node
import { execFileSync, spawnSync } from "child_process"
import fs from "fs"
import os from "os"
import path from "path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { lireLaListe, lireLeRecu, ligneVerified } from "../../scripts/commit-depuis-export.mjs"
import { arbreDeCodeDuCommit, arbreDeCodeDuDossier } from "../../scripts/lib/arbre-de-code.mjs"
import { empreinteDesMigrations } from "../../scripts/lib/empreinte-des-migrations.mjs"

/**
 * `scripts/commit-depuis-export.mjs` : le commit d'un export vérifié porte son reçu en trailers
 * (`Verified-tree:`, `Verified:`), et tout reçu qui ne couvre pas exactement le commit est refusé sans rien
 * écrire. Testé sur un dépôt jetable : un `origin` nu, son checkout, et un export de `origin/main` où le script
 * est recopié tel quel.
 */

const root = path.resolve(__dirname, "../..")
const SCRIPTS = ["scripts/commit-depuis-export.mjs", "scripts/lib/arbre-de-code.mjs", "scripts/lib/empreinte-des-migrations.mjs", "scripts/sauts-toleres.txt"]
const MIGRATION = "supabase/migrations/20261021190000_purge.sql"
const TOLERE = lireLaListe(fs.readFileSync(path.join(root, "scripts/sauts-toleres.txt"), "utf8"))[0]

let dir: string

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "commit-depuis-export-test-"))
})

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-C", cwd, "-c", "user.email=test@test", "-c", "user.name=test", ...args], { encoding: "utf8", stdio: "pipe" }).trim()

/** `origin` (nu), son checkout `depot` et un export de `origin/main` ; rend aussi la base. */
function monter() {
  const racine = fs.mkdtempSync(path.join(dir, "cas-"))
  const origin = path.join(racine, "origin.git")
  const depot = path.join(racine, "depot")
  const exporte = path.join(racine, "export")
  git(racine, "init", "--quiet", "--bare", "--initial-branch=main", origin)
  git(racine, "clone", "--quiet", origin, depot)
  const fichiers: Record<string, string> = {
    "a.ts": "export const a = 1\n",
    "cli/bin.mjs": "console.log('bin')\n",
    "docs/changelog.md": "# Changelog\n",
    [MIGRATION]: "grant execute on function platform.purge_transit_files() to platform_server;\n",
    ".gitignore": "node_modules/\n.claude/*\n",
  }
  for (const chemin of SCRIPTS) fichiers[chemin] = fs.readFileSync(path.join(root, chemin), "utf8")
  for (const [chemin, contenu] of Object.entries(fichiers)) {
    fs.mkdirSync(path.dirname(path.join(depot, chemin)), { recursive: true })
    fs.writeFileSync(path.join(depot, chemin), contenu)
  }
  git(depot, "add", "--all")
  git(depot, "commit", "--quiet", "--no-verify", "-m", "init")
  git(depot, "push", "--quiet", "origin", "HEAD:refs/heads/main")
  git(depot, "fetch", "--quiet", "origin")
  const base = git(depot, "rev-parse", "origin/main")
  fs.mkdirSync(exporte)
  execFileSync("sh", ["-c", `git -C "${depot}" archive ${base} | tar -x -C "${exporte}"`])
  const message = path.join(racine, "message.txt")
  fs.writeFileSync(message, "feat: a vaut 2\n\nChangelog: changed\nCo-Authored-By: test <test@test>\n")
  return { racine, origin, depot, exporte, base, message }
}

/** Le reçu d'un `pnpm verify` vert sur l'export tel qu'il est maintenant, sa base construite depuis ses migrations. */
function recuVert(exporte: string, surcharge: Record<string, unknown> = {}) {
  fs.mkdirSync(path.join(exporte, ".claude"), { recursive: true })
  const recu = {
    checks: ["check:framework", "type-check", "lint", "test"],
    at: new Date().toISOString(),
    tree: arbreDeCodeDuDossier(exporte),
    duree: 350,
    forks: 4,
    tests: { verts: 12, sautes: 1, echecs: 0, fichiersSautes: [TOLERE] },
    base: { empreinte: empreinteDesMigrations(exporte) },
    ...surcharge,
  }
  fs.writeFileSync(path.join(exporte, ".claude/.verify-receipt.json"), JSON.stringify(recu))
  return recu
}

// Le commit s'écrit sous l'identité git de la personne ; la machine de CI n'en a pas : le test la donne.
const IDENTITE = { GIT_AUTHOR_NAME: "test", GIT_AUTHOR_EMAIL: "test@test", GIT_COMMITTER_NAME: "test", GIT_COMMITTER_EMAIL: "test@test" }

function lancer(cas: ReturnType<typeof monter>, args = ["--depot", cas.depot, "--base", cas.base, "--message", cas.message]) {
  const result = spawnSync("node", [path.join(cas.exporte, "scripts/commit-depuis-export.mjs"), ...args], {
    encoding: "utf8",
    env: { ...process.env, ...IDENTITE },
  })
  return { status: result.status, output: result.stdout + result.stderr, sha: /^Commit ([0-9a-f]{40})/m.exec(result.stdout)?.[1] }
}

// Une dizaine de lancements de git par cas, plus node : environ 1 s au calme ; 30 s, comme les autres tests
// sur dépôt jetable (`check-framework.test.ts`), sur la machine partagée.
describe("commit-depuis-export on a throwaway repository", { timeout: 30_000 }, () => {
  it("should build the commit of the export on its base, with the receipt in trailers, without pushing nor touching the checkout", () => {
    const cas = monter()
    fs.writeFileSync(path.join(cas.exporte, "a.ts"), "export const a = 2\n")
    // `pnpm install` rend le bin exécutable dans l'export : le commit garde le mode de la base.
    fs.chmodSync(path.join(cas.exporte, "cli/bin.mjs"), 0o755)
    const recu = recuVert(cas.exporte)
    // Écrit après les checks : n'invalide pas le reçu, et part avec le commit.
    fs.appendFileSync(path.join(cas.exporte, "docs/changelog.md"), "## a vaut 2\n")

    const result = lancer(cas)

    expect(result.status, result.output).toBe(0)
    const sha = result.sha!
    expect(git(cas.depot, "rev-parse", `${sha}^`)).toBe(cas.base)
    expect(git(cas.depot, "show", `${sha}:a.ts`)).toBe("export const a = 2")
    expect(git(cas.depot, "show", `${sha}:docs/changelog.md`)).toContain("## a vaut 2")
    expect(git(cas.depot, "ls-tree", sha, "cli/bin.mjs")).toMatch(/^100644 /)
    const message = git(cas.depot, "log", "-1", "--format=%B", sha)
    expect(message).toContain(`Verified-tree: ${recu.tree}`)
    expect(message).toContain(`Verified: ${ligneVerified(recu)}`)
    // Les trailers rejoignent ceux du message, dans le même bloc.
    expect(git(cas.depot, "log", "-1", "--format=%(trailers:key=Changelog,valueonly)", sha)).toBe("changed")
    expect(git(cas.depot, "log", "-1", "--format=%(trailers:key=Verified-tree,valueonly)", sha)).toBe(arbreDeCodeDuCommit(cas.depot, sha))
    expect(git(cas.depot, "status", "--porcelain")).toBe("")
    expect(git(cas.origin, "rev-parse", "main")).toBe(cas.base)
  })

  it("should refuse when the code changed after the receipt, or a file that is not ignored appeared", () => {
    const cas = monter()
    fs.writeFileSync(path.join(cas.exporte, "a.ts"), "export const a = 2\n")
    recuVert(cas.exporte)
    fs.writeFileSync(path.join(cas.exporte, "a.ts"), "export const a = 3\n")
    const modifie = lancer(cas)
    expect(modifie.status, modifie.output).toBe(1)
    expect(modifie.output).toContain("n'est pas celui du reçu")

    fs.writeFileSync(path.join(cas.exporte, "a.ts"), "export const a = 2\n")
    fs.writeFileSync(path.join(cas.exporte, "trace.log"), "reste d'un essai\n")
    const parasite = lancer(cas)
    expect(parasite.status, parasite.output).toBe(1)
    expect(parasite.output).toContain("n'est pas celui du reçu")
  })

  // Le cas du 21/10/2026 : la migration réécrite après que la base de test a reçu sa première version ; les tests
  // passaient sur l'ancienne. Un reçu dont la base vient d'autres migrations que celles du commit est refusé.
  it("should refuse a receipt whose test base was built from other migrations than the committed tree", () => {
    const cas = monter()
    const premiere = empreinteDesMigrations(cas.exporte)
    fs.writeFileSync(path.join(cas.exporte, MIGRATION), "grant execute on function platform.purge_transit_files() to authenticated;\n")
    recuVert(cas.exporte, { base: { empreinte: premiere } })

    const result = lancer(cas)
    expect(result.status, result.output).toBe(1)
    expect(result.output).toContain(`construite depuis d'autres migrations (${premiere.slice(0, 12)})`)
  })

  it("should refuse a receipt that attests no test base built by pnpm verify", () => {
    const cas = monter()
    fs.writeFileSync(path.join(cas.exporte, "a.ts"), "export const a = 2\n")
    recuVert(cas.exporte, { base: null })

    const result = lancer(cas)
    expect(result.status, result.output).toBe(1)
    expect(result.output).toContain("n'atteste aucune base de test")
  })

  it("should refuse a base that is no longer origin/main", () => {
    const cas = monter()
    fs.writeFileSync(path.join(cas.exporte, "a.ts"), "export const a = 2\n")
    recuVert(cas.exporte)
    // Une autre session pousse entre l'export et le commit.
    const autre = path.join(cas.racine, "autre")
    git(cas.racine, "clone", "--quiet", cas.origin, autre)
    fs.writeFileSync(path.join(autre, "c.ts"), "export const c = 1\n")
    git(autre, "add", "c.ts")
    git(autre, "commit", "--quiet", "--no-verify", "-m", "c")
    git(autre, "push", "--quiet", "origin", "HEAD:refs/heads/main")

    const result = lancer(cas)
    expect(result.status, result.output).toBe(1)
    expect(result.output).toContain("refaire l'export sur la tête")
  })

  it("should refuse a commit that changes nothing, and say its usage without its three options", () => {
    const cas = monter()
    recuVert(cas.exporte)
    const rien = lancer(cas)
    expect(rien.status, rien.output).toBe(1)
    expect(rien.output).toContain("ne changerait rien")

    const usage = lancer(cas, ["--depot", cas.depot])
    expect(usage.status).toBe(2)
    expect(usage.output).toContain("usage")
  })
})

describe("lireLeRecu", () => {
  const ecrire = (recu: unknown) => {
    const chemin = path.join(fs.mkdtempSync(path.join(dir, "recu-")), "recu.json")
    fs.writeFileSync(chemin, JSON.stringify(recu))
    return chemin
  }
  const VERT = {
    checks: ["check:framework", "type-check", "lint", "test"],
    at: new Date().toISOString(),
    tree: "a".repeat(40),
    duree: 300,
    forks: 4,
    tests: { verts: 10, sautes: 2, echecs: 0, fichiersSautes: [TOLERE] },
    base: { empreinte: "e".repeat(64) },
  }

  it("should accept a green receipt whose wholly skipped files are all tolerated", () => {
    expect(lireLeRecu(ecrire(VERT), [TOLERE]).tree).toBe(VERT.tree)
  })

  it.each<[string, Record<string, unknown>, string]>([
    ["older than an hour", { at: new Date(Date.now() - 61 * 60 * 1000).toISOString() }, "périmé"],
    ["dated in the future", { at: new Date(Date.now() + 60 * 1000).toISOString() }, "périmé"],
    ["without a check", { checks: ["type-check", "lint", "test"] }, "check:framework"],
    ["without the code tree", { tree: undefined }, "arbre de code"],
    ["without the test summary", { tests: undefined }, "résume pas les tests"],
    ["with a failed test", { tests: { ...VERT.tests, echecs: 1 } }, "en échec"],
    ["without a test base", { base: null }, "n'atteste aucune base de test"],
    ["with a test base without fingerprint", { base: {} }, "n'atteste aucune base de test"],
    ["with a wholly skipped file out of the list", { tests: { ...VERT.tests, fichiersSautes: ["tests/integration/files.test.ts"] } }, "tests/integration/files.test.ts"],
  ])("should refuse a receipt %s", (_cas, surcharge, raison) => {
    expect(() => lireLeRecu(ecrire({ ...VERT, ...surcharge }), [TOLERE])).toThrow(raison)
  })

  it("should refuse a missing receipt", () => {
    expect(() => lireLeRecu(path.join(dir, "absent.json"), [TOLERE])).toThrow("aucun reçu")
  })
})
