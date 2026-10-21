// @vitest-environment node
import { execFileSync, spawnSync } from "child_process"
import fs from "fs"
import os from "os"
import path from "path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { commitsAVerifier, verdict } from "../../scripts/ci/recu.mjs"
import { arbreDeCodeDuCommit } from "../../scripts/lib/arbre-de-code.mjs"

/**
 * `scripts/ci/recu.mjs`, le job `recu` de la CI : chaque commit poussé porte le `Verified-tree:` de son arbre de code,
 * sauf s'il laisse inchangé celui de son parent ; en avertissement (`--avertir`), il le dit sans échouer. Testé sur
 * un dépôt jetable.
 */

const root = path.resolve(__dirname, "../..")
const SCRIPT = path.join(root, "scripts/ci/recu.mjs")
const ZERO = "0".repeat(40)

let dir: string

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "recu-ci-test-"))
})

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-C", cwd, "-c", "user.email=test@test", "-c", "user.name=test", ...args], { encoding: "utf8", stdio: "pipe" }).trim()

/** Écrit `fichiers` et les commite ; `trailer` : `vrai` pose le `Verified-tree:` du commit, une chaîne pose celle-là. */
function commiter(depot: string, sujet: string, fichiers: Record<string, string>, trailer?: "vrai" | string) {
  for (const [chemin, contenu] of Object.entries(fichiers)) {
    fs.mkdirSync(path.dirname(path.join(depot, chemin)), { recursive: true })
    fs.writeFileSync(path.join(depot, chemin), contenu)
  }
  git(depot, "add", "--all")
  git(depot, "commit", "--quiet", "--no-verify", "-m", sujet)
  if (trailer) {
    const arbre = trailer === "vrai" ? arbreDeCodeDuCommit(depot, "HEAD") : trailer
    git(depot, "commit", "--quiet", "--amend", "--no-verify", "-m", `${sujet}\n\nVerified-tree: ${arbre}`)
  }
  return git(depot, "rev-parse", "HEAD")
}

/** Un dépôt de quatre commits après une base : attesté, documents seuls, sans trailer, trailer faux. */
function monter() {
  const depot = fs.mkdtempSync(path.join(dir, "depot-"))
  git(depot, "init", "--quiet", "--initial-branch=main")
  const base = commiter(depot, "base", { "a.ts": "export const a = 1\n", "docs/changelog.md": "# Changelog\n" }, "vrai")
  const atteste = commiter(depot, "a vaut 2", { "a.ts": "export const a = 2\n" }, "vrai")
  const documents = commiter(depot, "changelog", { "docs/changelog.md": "# Changelog\n\n## a vaut 2\n" })
  const absent = commiter(depot, "a vaut 3", { "a.ts": "export const a = 3\n" })
  const faux = commiter(depot, "a vaut 4", { "a.ts": "export const a = 4\n" }, arbreDeCodeDuCommit(depot, absent))
  return { depot, base, atteste, documents, absent, faux }
}

const lancer = (depot: string, ...args: string[]) => {
  const result = spawnSync("node", [SCRIPT, ...args], { cwd: depot, encoding: "utf8" })
  return { status: result.status, output: result.stdout + result.stderr }
}

describe("receipt of pushed commits", { timeout: 30_000 }, () => {
  it("should accept an attested commit and a commit that leaves the code tree unchanged, and flag the others", () => {
    const cas = monter()
    expect(verdict(cas.depot, cas.atteste).etat).toBe("atteste")
    expect(verdict(cas.depot, cas.documents).etat).toBe("inchange")
    expect(verdict(cas.depot, cas.absent).etat).toBe("absent")
    expect(verdict(cas.depot, cas.faux).etat).toBe("faux")
  })

  it("should read the pushed range, or only the head after a new branch or a rewritten history", () => {
    const cas = monter()
    expect(commitsAVerifier(cas.depot, cas.base, cas.faux)).toEqual([cas.atteste, cas.documents, cas.absent, cas.faux])
    expect(commitsAVerifier(cas.depot, ZERO, cas.faux)).toEqual([cas.faux])
    expect(commitsAVerifier(cas.depot, "", cas.faux)).toEqual([cas.faux])
    // `before` d'un push forcé : n'est pas un ancêtre de la tête.
    expect(commitsAVerifier(cas.depot, cas.faux, cas.atteste)).toEqual([cas.atteste])
  })

  it("should fail on a commit without a valid receipt, and only warn with --avertir", () => {
    const cas = monter()
    const bloquant = lancer(cas.depot, "--depuis", cas.base, "--jusqua", cas.faux)
    expect(bloquant.status, bloquant.output).toBe(1)
    expect(bloquant.output).toMatch(/^::error title=Reçu du commit::.* a vaut 3 : sans `Verified-tree:`/m)
    expect(bloquant.output).toMatch(/^::error title=Reçu du commit::.* a vaut 4 : `Verified-tree:` ne correspond pas/m)
    expect(bloquant.output).toContain("4 commit(s) lus, 2 sans reçu valable.")

    const avertir = lancer(cas.depot, "--depuis", cas.base, "--jusqua", cas.faux, "--avertir")
    expect(avertir.status, avertir.output).toBe(0)
    expect(avertir.output).toMatch(/^::warning title=Reçu du commit::.* a vaut 3/m)
    expect(avertir.output).not.toContain("::error")
  })

  it("should pass a range whose commits are all covered, and say its usage without --jusqua", () => {
    const cas = monter()
    const vert = lancer(cas.depot, "--depuis", cas.base, "--jusqua", cas.documents)
    expect(vert.status, vert.output).toBe(0)
    expect(vert.output).toContain("2 commit(s) lus, 0 sans reçu valable.")

    const usage = lancer(cas.depot, "--depuis", cas.base)
    expect(usage.status).toBe(2)
    expect(usage.output).toContain("usage")
  })
})
