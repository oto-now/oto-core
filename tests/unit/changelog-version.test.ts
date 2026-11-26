// @vitest-environment node
import { spawnSync } from "child_process"
import fs from "fs"
import os from "os"
import path from "path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { defautsDuFragment } from "../../scripts/changelog-version.mjs"

/**
 * `scripts/changelog-version.mjs` (`pnpm changelog:version`) : la pull request de version verse les fragments du
 * CHANGELOG du paquet (`packages/plateforme/changelog.d/AAAA-MM-JJ-<sujet>.md`) dans la section de la version, puis les supprime.
 * Un fragment suit le format des listes du CHANGELOG ; `tests/unit/package-publish.test.ts` le vérifie sur ceux du dépôt.
 */

const root = path.resolve(__dirname, "../..")
const SCRIPT = path.join(root, "scripts/changelog-version.mjs")

let dir: string

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "changelog-version-test-"))
})

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe("package CHANGELOG fragment", () => {
  it("should accept the lists of the CHANGELOG and refuse any other form", () => {
    const cas: Record<string, [string, string]> = {
      "two lists": ["2026-11-26-sujet.md", "### Assistants\n- `find` finds a.\n\n### Hosts\n- API: `b` is new.\n"],
      "CRLF": ["2026-11-26-sujet.md", "### Hosts\r\n- API: `b` is new.\r\n"],
      "long assistant entry": ["2026-11-26-sujet.md", `### Assistants\n- ${"a".repeat(201)}\n`],
      "entry outside a list": ["2026-11-26-sujet.md", "- API: `b` is new.\n"],
      "version heading": ["2026-11-26-sujet.md", "## 1.2.0 — 2026-11-26\n### Hosts\n- API: `b` is new.\n"],
      "unknown list": ["2026-11-26-sujet.md", "### Breaking\n- API: `b` is gone.\n"],
      "not a list item": ["2026-11-26-sujet.md", "### Hosts\nAPI: `b` is new.\n"],
      "no entry": ["2026-11-26-sujet.md", "### Hosts\n"],
      "name": ["sujet.md", "### Hosts\n- API: `b` is new.\n"],
    }
    const verdicts = Object.fromEntries(Object.entries(cas).map(([nom, [fichier, texte]]) => [nom, defautsDuFragment(fichier, texte).length]))
    expect(verdicts).toEqual({
      "two lists": 0,
      "CRLF": 0,
      "long assistant entry": 1,
      "entry outside a list": 1,
      "version heading": 1,
      "unknown list": 2,
      "not a list item": 2,
      "no entry": 1,
      "name": 1,
    })
  })
})

describe("changelog:version", { timeout: 30_000 }, () => {
  it("should pour the lines of ## Unreleased then the fragments, by date, into the version, keeping CRLF, delete them, and refuse a version with no line or a malformed fragment without writing", () => {
    const depot = fs.mkdtempSync(path.join(dir, "depot-"))
    const fragments = path.join(depot, "packages/plateforme/changelog.d")
    fs.mkdirSync(fragments, { recursive: true })
    const fichier = path.join(depot, "packages/plateforme/CHANGELOG.md")
    // En CRLF, comme sur un checkout Windows (autocrlf) : le fichier versé garde ses fins de ligne.
    const crlf = (texte: string) => texte.split("\n").join("\r\n")
    fs.writeFileSync(fichier, crlf("# Changelog\n\nFormat.\n\n## Unreleased\n\n### Hosts\n- API: old.\n\n## 1.0.0 — 2026-11-01\n\n### Hosts\n- Install: first.\n"))
    fs.writeFileSync(path.join(fragments, "2026-11-20-b.md"), "### Hosts\n- UI: b.\n")
    fs.writeFileSync(path.join(fragments, "2026-11-24-a.md"), "### Assistants\n- `find` finds a.\n\n### Hosts\n- MCP: a.\n")
    const lancer = () => spawnSync("node", [SCRIPT, "1.1.0", "--date", "2026-11-26"], { cwd: depot, encoding: "utf8" })

    const verse = lancer()
    expect(verse.status, verse.stderr).toBe(0)
    expect(fs.readFileSync(fichier, "utf8")).toBe(
      crlf("# Changelog\n\nFormat.\n\n## Unreleased\n\n## 1.1.0 — 2026-11-26\n\n### Assistants\n- `find` finds a.\n\n### Hosts\n- API: old.\n- UI: b.\n- MCP: a.\n\n## 1.0.0 — 2026-11-01\n\n### Hosts\n- Install: first.\n"),
    )
    expect(fs.readdirSync(fragments)).toEqual([])

    const avant = fs.readFileSync(fichier, "utf8")
    const vide = spawnSync("node", [SCRIPT, "1.2.0", "--date", "2026-11-27"], { cwd: depot, encoding: "utf8" })
    expect(vide.status).toBe(1)
    expect(vide.stderr).toContain("aucune ligne")
    expect(fs.readFileSync(fichier, "utf8")).toBe(avant)

    fs.writeFileSync(path.join(fragments, "2026-11-27-c.md"), "- API: hors liste.\n")
    const refuse = spawnSync("node", [SCRIPT, "1.2.0", "--date", "2026-11-27"], { cwd: depot, encoding: "utf8" })
    expect(refuse.status).toBe(1)
    expect(refuse.stderr).toContain("2026-11-27-c.md")
    expect(fs.readFileSync(fichier, "utf8")).toBe(avant)
    expect(fs.readdirSync(fragments)).toEqual(["2026-11-27-c.md"])
  })
})
