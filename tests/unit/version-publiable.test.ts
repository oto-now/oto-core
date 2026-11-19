// @vitest-environment node
import { execFileSync, spawnSync } from "child_process"
import fs from "fs"
import os from "os"
import path from "path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { controler } from "../../scripts/ci/version-publiable.mjs"

/**
 * `scripts/ci/version-publiable.mjs` : les contrôles de contenu d'une version (une seule migration depuis le tag
 * précédent, accord de la version et du CHANGELOG, tag libre), joués par `ci.yml` sur la pull request et par
 * `publish.yml` avant de poser le tag, puis sur le tag. Testé sur un dépôt jetable.
 */

const root = path.resolve(__dirname, "../..")
const SCRIPT = path.join(root, "scripts/ci/version-publiable.mjs")

let dir: string

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "version-publiable-test-"))
})

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-C", cwd, "-c", "user.email=test@test", "-c", "user.name=test", ...args], { encoding: "utf8", stdio: "pipe" }).trim()

function commiter(depot: string, sujet: string, fichiers: Record<string, string>) {
  for (const [chemin, contenu] of Object.entries(fichiers)) {
    fs.mkdirSync(path.dirname(path.join(depot, chemin)), { recursive: true })
    fs.writeFileSync(path.join(depot, chemin), contenu)
  }
  git(depot, "add", "--all")
  git(depot, "commit", "--quiet", "--no-verify", "-m", sujet)
  return git(depot, "rev-parse", "HEAD")
}

const manifeste = (version: string) => ({ "packages/plateforme/package.json": JSON.stringify({ version }) })
const changelog = (...versions: string[]) => ({
  "packages/plateforme/CHANGELOG.md": ["# Changelog", "", "## Unreleased", ...versions.map((v) => `\n## ${v} — 2026-11-19`)].join("\n"),
})
const migration = (nom: string) => ({ [`packages/plateforme/migrations/${nom}.sql`]: "select 1;\n" })

/** Un dépôt tagué v1.0.0, puis une branche de version partie de là. */
function monter() {
  const depot = fs.mkdtempSync(path.join(dir, "depot-"))
  git(depot, "init", "--quiet", "--initial-branch=main")
  const base = commiter(depot, "1.0.0", { ...manifeste("1.0.0"), ...changelog("1.0.0"), ...migration("0001_base") })
  git(depot, "tag", "-a", "v1.0.0", "-m", "1.0.0")
  return { depot, base }
}

describe("version-publiable (content checks of a version, before its tag)", () => {
  it("should check nothing when the pull request leaves the version unchanged", () => {
    const { depot, base } = monter()
    const head = commiter(depot, "fix", { "a.ts": "export const a = 1\n" })
    expect(controler(depot, { ref: head, base, head })).toEqual({ etat: "inchangee", version: "1.0.0" })
  })

  it("should accept a version pull request with one migration and its CHANGELOG section", () => {
    const { depot, base } = monter()
    const head = commiter(depot, "1.1.0", { ...manifeste("1.1.0"), ...changelog("1.1.0", "1.0.0"), ...migration("0002_v1_1_0") })
    expect(controler(depot, { ref: head, base, head })).toMatchObject({ etat: "publiable", tag: "v1.1.0", precedent: "v1.0.0" })
  })

  it("should refuse two migrations since the previous tag, a missing CHANGELOG section, or a tag already taken", () => {
    const { depot, base } = monter()
    const deux = commiter(depot, "1.1.0", { ...manifeste("1.1.0"), ...changelog("1.1.0", "1.0.0"), ...migration("0002_a"), ...migration("0003_b") })
    expect(controler(depot, { ref: deux, base, head: deux })).toMatchObject({ etat: "refusee", raison: expect.stringContaining("2 migrations") })

    fs.rmSync(path.join(depot, "packages/plateforme/migrations/0003_b.sql"))
    const une = commiter(depot, "une seule migration, section absente", changelog("1.0.0"))
    expect(controler(depot, { ref: une, base, head: une })).toMatchObject({ etat: "refusee", raison: expect.stringContaining("## 1.1.0") })

    git(depot, "tag", "-a", "v1.1.0", "-m", "1.1.0", une)
    const prise = commiter(depot, "section ajoutée", changelog("1.1.0", "1.0.0"))
    expect(controler(depot, { ref: prise, base, head: prise })).toMatchObject({ etat: "refusee", raison: expect.stringContaining("v1.1.0 existe déjà") })
  })

  it("should check the tag against the version on the tagged commit, and write the tag for GitHub Actions", () => {
    const { depot, base } = monter()
    const head = commiter(depot, "1.0.1", { ...manifeste("1.0.1"), ...changelog("1.0.1", "1.0.0") })
    git(depot, "tag", "-a", "v1.0.1", "-m", "1.0.1", head)
    expect(controler(depot, { ref: "v1.0.1", tag: "v1.0.1" })).toMatchObject({ etat: "publiable", tag: "v1.0.1", precedent: "v1.0.0" })
    expect(controler(depot, { ref: "v1.0.1", tag: "v1.0.2" })).toMatchObject({ etat: "refusee", raison: "tag v1.0.2, paquet v1.0.1" })

    const sortie = path.join(depot, "output.txt")
    const ok = spawnSync("node", [SCRIPT, "--ref", head, "--base", base, "--head", head], { cwd: depot, encoding: "utf8", env: { ...process.env, GITHUB_OUTPUT: sortie } })
    // Le tag v1.0.1 existe : la pull request est refusée, code 1, rien n'est écrit.
    expect(ok.status).toBe(1)
    expect(fs.existsSync(sortie)).toBe(false)
    git(depot, "tag", "-d", "v1.0.1")
    const libre = spawnSync("node", [SCRIPT, "--ref", head, "--base", base, "--head", head], { cwd: depot, encoding: "utf8", env: { ...process.env, GITHUB_OUTPUT: sortie } })
    expect(libre.status).toBe(0)
    expect(fs.readFileSync(sortie, "utf8")).toBe("tag=v1.0.1\n")
    expect(spawnSync("node", [SCRIPT, "--ref", head], { cwd: depot, encoding: "utf8" }).status).toBe(2)
  })
})
