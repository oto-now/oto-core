// @vitest-environment node
import { execFileSync } from "child_process"
import fs from "fs"
import os from "os"
import path from "path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { arbreDeCodeDuCommit, arbreDeCodeDuDossier } from "../../scripts/lib/arbre-de-code.mjs"

/**
 * L'arbre de code (`scripts/lib/arbre-de-code.mjs`) : celui d'un dossier égale celui du commit au même
 * contenu, quels que soient les chemins écrits après les checks, le bit d'exécution, les fichiers ignorés et
 * les exclusions globales de la personne ; il change avec le code. Testé sur un dépôt jetable.
 */

let dir: string

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "arbre-de-code-test-"))
})

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

const FICHIERS: Record<string, string> = {
  "a.ts": "export const a = 1\n",
  "cli/bin.mjs": "console.log('bin')\n",
  "docs/changelog.md": "# Changelog\n",
  "docs/conception/sujet.md": "# Sujet\n",
  ".gitignore": "node_modules/\n.claude/*\n",
}

/** Un dépôt au contenu `FICHIERS`, un commit ; rend le dépôt et un dossier qui en est l'export. */
function depotEtExport() {
  const racine = fs.mkdtempSync(path.join(dir, "cas-"))
  const depot = path.join(racine, "depot")
  const exporte = path.join(racine, "export")
  for (const [chemin, contenu] of Object.entries(FICHIERS)) {
    fs.mkdirSync(path.dirname(path.join(depot, chemin)), { recursive: true })
    fs.writeFileSync(path.join(depot, chemin), contenu)
  }
  const git = (...args: string[]) => execFileSync("git", ["-C", depot, ...args], { stdio: "pipe" })
  git("init", "--quiet")
  git("add", "--all")
  git("-c", "user.email=test@test", "-c", "user.name=test", "commit", "--quiet", "--no-verify", "-m", "init")
  fs.mkdirSync(exporte)
  execFileSync("sh", ["-c", `git -C "${depot}" archive HEAD | tar -x -C "${exporte}"`])
  return { depot, exporte }
}

describe("arbre de code", { timeout: 30_000 }, () => {
  it("should give the same tree for a commit and its export", () => {
    const { depot, exporte } = depotEtExport()
    expect(arbreDeCodeDuDossier(exporte)).toBe(arbreDeCodeDuCommit(depot, "HEAD"))
  })

  it("should ignore the paths written after the checks, the executable bit, ignored files and personal excludes", () => {
    const { depot, exporte } = depotEtExport()
    const attendu = arbreDeCodeDuCommit(depot, "HEAD")
    fs.appendFileSync(path.join(exporte, "docs/changelog.md"), "## entrée\n")
    fs.appendFileSync(path.join(exporte, "docs/conception/sujet.md"), "Décision.\n")
    fs.chmodSync(path.join(exporte, "cli/bin.mjs"), 0o755)
    fs.mkdirSync(path.join(exporte, "node_modules/x"), { recursive: true })
    fs.writeFileSync(path.join(exporte, "node_modules/x/index.js"), "x\n")
    fs.mkdirSync(path.join(exporte, ".claude"))
    fs.writeFileSync(path.join(exporte, ".claude/.verify-receipt.json"), "{}\n")
    // Une exclusion globale de la personne qui cacherait du code : elle ne compte pas.
    const global = path.join(dir, "gitconfig-global")
    const exclusions = path.join(dir, "exclusions-globales")
    fs.writeFileSync(exclusions, "a.ts\n")
    fs.writeFileSync(global, `[core]\n\texcludesFile = ${exclusions}\n`)
    const avant = process.env.GIT_CONFIG_GLOBAL
    process.env.GIT_CONFIG_GLOBAL = global
    try {
      expect(arbreDeCodeDuDossier(exporte)).toBe(attendu)
    } finally {
      if (avant === undefined) delete process.env.GIT_CONFIG_GLOBAL
      else process.env.GIT_CONFIG_GLOBAL = avant
    }
  })

  it("should change when the code changes, a file is added or a file is removed", () => {
    const { depot, exporte } = depotEtExport()
    const attendu = arbreDeCodeDuCommit(depot, "HEAD")
    const vus = new Set([attendu])

    fs.writeFileSync(path.join(exporte, "a.ts"), "export const a = 2\n")
    vus.add(arbreDeCodeDuDossier(exporte))
    fs.writeFileSync(path.join(exporte, "b.ts"), "export const b = 1\n")
    vus.add(arbreDeCodeDuDossier(exporte))
    fs.rmSync(path.join(exporte, "cli/bin.mjs"))
    vus.add(arbreDeCodeDuDossier(exporte))

    expect(vus.size).toBe(4)
  })

  it("should write nothing into the repository it reads", () => {
    const { depot } = depotEtExport()
    const objets = () => execFileSync("git", ["-C", depot, "count-objects", "-v"], { encoding: "utf8" })
    const avant = objets()
    arbreDeCodeDuCommit(depot, "HEAD")
    expect(objets()).toBe(avant)
  })
})
