// @vitest-environment node
import { spawnSync } from "child_process"
import fs from "fs"
import os from "os"
import path from "path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const root = path.resolve(__dirname, "../..")
const bin = path.join(root, "packages/plateforme/cli/bin.mjs")
const packageMigrations = path.join(root, "packages/plateforme/migrations")
const MIGRATION = "20260101000000_a.sql"

let dir: string

/** Lance `oto-platform` comme le ferait `pnpm exec`, depuis `cwd`. */
function cli(args: string[], cwd = root) {
  const result = spawnSync(process.execPath, [bin, ...args], { cwd, encoding: "utf8" })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

function tempDir(prefix: string) {
  return fs.mkdtempSync(path.join(dir, prefix))
}

function fixture(sql: string) {
  const file = path.join(tempDir("sql-"), "fixture.sql")
  fs.writeFileSync(file, sql)
  return file
}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-migrations-"))
})

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe("oto-platform migrations sync", () => {
  it("should copy a migration missing from the host and say so", () => {
    const from = tempDir("from-")
    const to = path.join(tempDir("host-"), "migrations")
    fs.writeFileSync(path.join(from, MIGRATION), "create schema if not exists platform;\n")
    const result = cli(["migrations", "sync", "--from", from, "--to", to])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain(`copié   ${MIGRATION}`)
    expect(fs.readFileSync(path.join(to, MIGRATION), "utf8")).toBe("create schema if not exists platform;\n")
  })

  it("should refuse a diverging host copy and write nothing at all", () => {
    const from = tempDir("from-")
    const to = tempDir("to-")
    fs.writeFileSync(path.join(from, MIGRATION), "package version\n")
    fs.writeFileSync(path.join(from, "20260102000000_b.sql"), "new migration\n")
    fs.writeFileSync(path.join(to, MIGRATION), "host edit\n")
    const result = cli(["migrations", "sync", "--from", from, "--to", to])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(`migrations:sync — ${MIGRATION} diffère de la copie de l'hôte, non écrasé`)
    expect(result.stderr).toContain("migrations:sync — aucun fichier écrit : le paquet fait foi, résoudre l'écart à la main")
    expect(fs.readFileSync(path.join(to, MIGRATION), "utf8")).toBe("host edit\n")
    expect(fs.existsSync(path.join(to, "20260102000000_b.sql"))).toBe(false)
  })

  it("should copy every shipped migration into supabase/migrations of the current directory by default", () => {
    const host = tempDir("host-")
    const result = cli(["migrations", "sync"], host)
    expect(result.status).toBe(0)
    const shipped = fs.readdirSync(packageMigrations).filter((f) => f.endsWith(".sql"))
    expect(shipped.length).toBeGreaterThan(0)
    for (const file of shipped) {
      const copy = path.join(host, "supabase/migrations", file)
      expect(fs.readFileSync(copy).equals(fs.readFileSync(path.join(packageMigrations, file))), file).toBe(true)
    }
  })
})

describe("oto-platform migrations check", () => {
  // Un hôte lance la CLI, le dépôt son script : la même sortie. Chaque règle, dont l'`EXECUTE` d'une fonction de
  // `platform` non retiré à `public` (E02-S01) : `tests/unit/migrations-guard.test.ts`.
  it("should list each error as path:line rule, then count them, like the repository script", () => {
    const file = fixture("create table public.items (id uuid primary key);\n")
    const result = cli(["migrations", "check", "--file", file])
    expect(result.status).toBe(1)
    expect(result.stdout).toBe(`${file}:1 table-outside-platform\n`)
    expect(result.stderr).toBe("check:migrations — 1 erreur(s)\n")
    const script = spawnSync(process.execPath, [path.join(root, "scripts/check-migrations.mjs"), "--file", file], { cwd: root, encoding: "utf8" })
    expect({ status: script.status, stdout: script.stdout, stderr: script.stderr }).toEqual(result)
  })

  it("should check every shipped migration without --file", () => {
    const shipped = fs.readdirSync(packageMigrations).filter((f) => f.endsWith(".sql"))
    const result = cli(["migrations", "check"], tempDir("host-"))
    expect(result.status).toBe(0)
    expect(result.stdout).toBe(`check:migrations — ${shipped.length} fichier(s) conforme(s)\n`)
  })
})

describe("oto-platform usage", () => {
  // Un cas pour la règle (M11) : l'option qu'un hôte croirait exister, refusée sans rien lancer.
  it("should reject an unknown option with a named problem, the usage and code 2", () => {
    const result = cli(["migrations", "sync", "--force"])
    expect(result.status).toBe(2)
    expect(result.stderr.startsWith("oto-platform : option inconnue « --force »")).toBe(true)
    expect(result.stderr).toContain("Usage : oto-platform")
    expect(result.stdout).toBe("")
  })
})
