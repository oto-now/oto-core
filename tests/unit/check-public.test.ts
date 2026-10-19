// @vitest-environment node
import { execFileSync, spawnSync } from "child_process"
import { randomBytes } from "crypto"
import fs from "fs"
import os from "os"
import path from "path"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"

// Chaque test lance git et node de façon synchrone : sans un tour de boucle d'événements entre deux
// tests, les réponses aux appels internes de Vitest attendent la fin du fichier, et passé 60 s
// cumulées, « Timeout calling "onTaskUpdate" » fait échouer le passage, tests verts compris. Mesuré le
// 2026-09-25 pendant un `pnpm verify` complet sur la machine partagée : 87,9 s pour les neuf tests, le
// plus long à 16,9 s (M13a ; même remède que `hooks.test.ts`, M03).
afterEach(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))

const root = path.resolve(__dirname, "../..")
const script = path.join(root, "scripts/check-public.mjs")

// Faux secrets et noms de la liste construits à l'exécution, jamais en littéral : le contrôle de
// ce dépôt (AC12) trouverait un secret écrit ici (testing-strategy.md § Anti-patterns).
const hex = (bytes: number) => randomBytes(bytes).toString("hex")
const b64 = (bytes: number) => randomBytes(bytes).toString("base64url")
const fakeJwt = () => ["eyJ", b64(12), ".", b64(24), ".", b64(24)].join("")
const fakeSupabaseKey = () => ["sb", "secret", b64(24)].join("_")
// Une organisation fictive, écrite dans la liste, puis ailleurs avec d'autres accents et une autre casse.
const client = ["Célestine", "Rôtisserie"].join(" ")
const clientElsewhere = ["CELESTÏNE", "ROTISSÉRIE"].join(" ")
const plain = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()

let dir: string

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "check-public-"))
})

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

/** Dépôt git jetable : `commit` écrit (ou supprime, `null`) des fichiers et rend le sha court. */
function repo() {
  const at = fs.mkdtempSync(path.join(dir, "repo-"))
  const git = (...args: string[]) => execFileSync("git", ["-C", at, ...args], { encoding: "utf8", stdio: "pipe" }).trim()
  git("init", "--quiet")
  git("config", "user.name", "test")
  git("config", "user.email", "test@example.invalid")
  git("config", "core.autocrlf", "false")
  git("config", "commit.gpgsign", "false")
  // Aucun hook (global ou autre) ne s'invite dans le dépôt jetable.
  git("config", "core.hooksPath", "no-hooks")
  const commit = (message: string, files: Record<string, string | null>) => {
    for (const [name, content] of Object.entries(files)) {
      const file = path.join(at, name)
      if (content === null) {
        fs.rmSync(file)
        continue
      }
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, content)
    }
    git("add", "--", ...Object.keys(files))
    git("commit", "--quiet", "--message", message)
    return git("rev-parse", "HEAD").slice(0, 7)
  }
  const write = (name: string, content: string) => fs.writeFileSync(path.join(at, name), content)
  return { at, commit, write }
}

function checkPublic(at: string, ...args: string[]) {
  const result = spawnSync(process.execPath, [script, "--root", at, ...args], { encoding: "utf8" })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, output: result.stdout + result.stderr }
}

// Délai du bloc : chaque test lance git une dizaine de fois (dépôt jetable), puis le script. Environ 1 s
// par test au calme (M15b-1) ; trois cas de 39 à 55 s le 2026-09-25, pendant un `pnpm verify` complet,
// huit à neuf worktrees sur la machine (E01-S08). 60 s : le plafond d'un test synchrone
// (testing-strategy.md § Anti-patterns).
describe("check-public on a throwaway repository (AC11)", { timeout: 60_000 }, () => {
  it("should report nothing on a clean repository, with the files and commits read", () => {
    const { at, commit } = repo()
    commit("first", { "README.md": "# Demo\n" })
    commit("second", { "src/app.ts": "export const answer = 42\n" })
    const result = checkPublic(at, "--secrets-only")
    expect(result.status).toBe(0)
    expect(result.stdout).toBe("check:public — aucun constat (arbre : 2 fichiers, historique : 2 commits)\n")
  })

  it("should find a secret in a tracked file, with its path, line and rule, but never its value", () => {
    const secret = fakeJwt()
    const { at, commit } = repo()
    const sha = commit("config", { "config/app.ts": `export const url = "/api"\nexport const token = "${secret}"\n` })
    const result = checkPublic(at, "--secrets-only")
    expect(result.status).toBe(1)
    expect(result.stdout).toBe(`arbre  config/app.ts:2  jwt\nhistorique  ${sha} config/app.ts  jwt\n`)
    expect(result.stderr).toBe("check:public — 2 constat(s)\n")
    expect(result.output).not.toContain(secret)
  })

  it("should find a secret added then removed, in the history only", () => {
    const secret = fakeJwt()
    const { at, commit } = repo()
    const added = commit("add the token", { "src/env.ts": `export const token = "${secret}"\n` })
    commit("read the token from the environment", { "src/env.ts": "export const token = process.env.TOKEN\n" })
    const result = checkPublic(at, "--secrets-only")
    expect(result.status).toBe(1)
    expect(result.stdout).toBe(`historique  ${added} src/env.ts  jwt\n`)
    expect(result.output).not.toContain(secret)
  })

  it("should recognise each kind of secret", () => {
    const secrets: [string, string][] = [
      ["jwt", fakeJwt()],
      ["supabase-secret-key", fakeSupabaseKey()],
      ["npm-token", ["npm", hex(18)].join("_")],
      ["github-token", ["gh" + "p", hex(18)].join("_")],
      ["github-token", ["github", "pat", hex(20)].join("_")],
      ["aws-access-key", "AKIA" + hex(8).toUpperCase()],
      ["private-key", ["-----BEGIN", "RSA", "PRIVATE", "KEY-----"].join(" ")],
      ["private-key", ["-----BEGIN", "PGP", "PRIVATE", "KEY", "BLOCK-----"].join(" ")],
      ["stripe-live-key", ["sk", "live", hex(12)].join("_")],
      ["url-with-password", ["postgres://app", `${hex(8)}@db.example.invalid:5432/app`].join(":")],
      // Le relais SMTP d'E01-S11 a2-core (`PLATFORM_SMTP_URL`), sous ses deux schémas (M23).
      ["url-with-password", ["smtp://relay-user", `${hex(8)}@relay.example.invalid:587`].join(":")],
      ["url-with-password", ["smtps://relay-user", `${hex(8)}@relay.example.invalid:465`].join(":")],
    ]
    const { at, commit, write } = repo()
    commit("first", { "README.md": "# Demo\n" })
    write("secrets.txt", secrets.map(([, value]) => `value = ${value}`).join("\n") + "\n")
    const result = checkPublic(at, "--secrets-only")
    expect(result.status).toBe(1)
    expect(result.stdout).toBe(secrets.map(([rule], k) => `arbre  secrets.txt:${k + 1}  ${rule}\n`).join(""))
    for (const [, value] of secrets) expect(result.output).not.toContain(value)
  })

  it("should let a relay address without a password through, the url-with-password rule widened to smtp and smtps", () => {
    // Formes voisines que la règle élargie doit laisser passer (testing-strategy.md § Anti-patterns) :
    // hôte et port, utilisateur sans mot de passe, schémas cités en prose (`.env.example`).
    const { at, commit } = repo()
    commit("relay", {
      "relay.txt": [
        "PLATFORM_SMTP_URL=smtp://relay.example.invalid:587",
        "PLATFORM_SMTP_URL=smtps://relay-user@relay.example.invalid:465",
        "# Adresse du relais SMTP, `smtp://` (port 587) ou `smtps://` (port 465)",
        // Un mot de passe interpolé, composé à l'exécution : jamais un secret en clair.
        "const url = `postgresql://admin:${password}@db.example.invalid:5432/app`",
        "",
      ].join("\n"),
    })
    const result = checkPublic(at, "--secrets-only")
    expect({ status: result.status, stdout: result.stdout }).toEqual({
      status: 0,
      stdout: "check:public — aucun constat (arbre : 1 fichiers, historique : 1 commits)\n",
    })
  })

  it("should find a tracked .env file, but not .env.example", () => {
    const { at, commit } = repo()
    const sha = commit("environment", { ".env": "", ".env.example": "KEY=\n" })
    const result = checkPublic(at, "--secrets-only")
    expect(result.status).toBe(1)
    expect(result.stdout).toBe(`arbre  .env:0  env-file\nhistorique  ${sha} .env  env-file\n`)
  })

  it("should find a listed name written with other accents and case, in a file and in a commit message", () => {
    const { at, commit, write } = repo()
    const inFile = commit("meeting notes", { "notes.md": `Rendez-vous avec ${clientElsewhere} jeudi\n` })
    const inMessage = commit(`Relance ${clientElsewhere.toLowerCase()}`, { "todo.md": "- relancer\n" })
    write(".public-denylist", `# un nom de client réel par ligne\n\nAutre Entreprise\n${client}\n`)
    const result = checkPublic(at)
    expect(result.status).toBe(1)
    expect(result.stdout).toBe(
      [
        "arbre  notes.md:1  denylist#2",
        `historique  ${inMessage} (message)  denylist#2`,
        `historique  ${inFile} notes.md  denylist#2`,
        "",
      ].join("\n"),
    )
    expect(plain(result.output)).not.toContain(plain(client))
  })

  it("should let a listed name through in a LICENSE file only, a secret there still found", () => {
    // Clôture E01-S12 e (ADR-010 § 4, fiche D67 A) : la licence nomme son titulaire, légitimement.
    const { at, commit, write } = repo()
    const secret = ["ghp", "_", "a".repeat(36)].join("")
    const sha = commit("licence", {
      LICENSE: `MIT License\n\nCopyright (c) 2026 ${client}\n`,
      "packages/p/LICENSE": `Copyright (c) 2026 ${client}\ntoken ${secret}\n`,
      "notes.md": `${client}\n`,
    })
    write(".public-denylist", `${client}\n`)
    const result = checkPublic(at)
    expect(result.status).toBe(1)
    expect(result.stdout).toContain("arbre  notes.md:1  denylist#1")
    expect(result.stdout).toContain(`historique  ${sha} notes.md  denylist#1`)
    expect(result.stdout).not.toMatch(/LICENSE:\d+ {2}denylist/)
    expect(result.stdout).not.toMatch(/LICENSE {2}denylist/)
    expect(result.stdout).toMatch(/arbre {2}packages\/p\/LICENSE:2 {2}\S+/)
  })

  it("should mask a path segment that holds a listed name", () => {
    const name = ["Valmo", "rin"].join("")
    const { at, commit, write } = repo()
    const sha = commit("notes", { [`clients/${name.toUpperCase()}/notes.md`]: "rien\n" })
    write(".public-denylist", `${name}\n`)
    const result = checkPublic(at)
    expect(result.status).toBe(1)
    expect(result.stdout).toBe(`arbre  clients/***/notes.md:0  denylist#1\nhistorique  ${sha} clients/***/notes.md  denylist#1\n`)
    expect(plain(result.output)).not.toContain(plain(name))
  })
})

describe("check-public on this repository (AC12, AC13)", { timeout: 60_000 }, () => {
  it("should find no secret in the tree nor in the history of any reference", () => {
    const result = spawnSync(process.execPath, [script, "--secrets-only"], { cwd: root, encoding: "utf8" })
    expect(result.status, result.stdout).toBe(0)
    expect(result.stdout).toMatch(/^check:public — aucun constat \(arbre : \d+ fichiers, historique : \d+ commits\)\n$/)
  })

  it("should keep .public-denylist ignored by git", () => {
    const result = spawnSync("git", ["check-ignore", "--quiet", ".public-denylist"], { cwd: root })
    expect(result.status).toBe(0)
  })
})
