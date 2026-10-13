// @vitest-environment node
import fs from "fs"
import path from "path"
import { describe, expect, it } from "vitest"

const root = path.resolve(__dirname, "../..")
const packageDir = path.join(root, "packages/plateforme")
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n")

type Manifest = {
  name: string
  version: string
  private?: boolean
  license: string
  repository: unknown
  publishConfig: unknown
  bin: Record<string, string>
  files: string[]
  sideEffects: boolean
  exports: Record<string, string>
  dependencies: Record<string, string>
  peerDependencies: Record<string, string>
}

// Relu à chaque test plutôt qu'importé : le manifeste est la chose testée, pas une dépendance.
// `JSON.parse` rend `any` : la forme attendue du manifeste est déclarée ci-dessus.
const manifest = () => JSON.parse(read("packages/plateforme/package.json")) as Manifest

/** Vrai si `target` (chemin relatif du paquet) est embarqué par `files` ou toujours publié par npm. */
function published(target: string, files: string[]) {
  const relativePath = target.replace(/^\.\//, "")
  if (relativePath === "package.json") return true
  return files.some((entry) => relativePath === entry || relativePath.startsWith(`${entry}/`))
}

// Un test par critère (M11) : chacun porte toutes les assertions de son AC.
describe("package manifest (AC1)", () => {
  it("should be a publishable manifest: license, repository, provenance, files, bin, exports and pinned dependencies", () => {
    const pkg = manifest()
    expect(pkg).not.toHaveProperty("private")
    expect(pkg.license).toBe("MIT")
    expect(pkg.repository).toEqual({
      type: "git",
      url: "git+https://github.com/otomata-tech/oto-pkg.git",
      directory: "packages/plateforme",
    })
    expect(pkg.publishConfig).toEqual({ access: "public", provenance: true })
    expect(pkg.files).toEqual(["ui", "schemas", "mcp", "api", "server", "migrations", "cli", "widgets", "CHANGELOG.md", "README.md", "LICENSE"])

    expect(pkg.bin).toEqual({ "oto-platform": "./cli/bin.mjs" })
    expect(published(pkg.bin["oto-platform"], pkg.files)).toBe(true)
    // Lu brut : en CRLF, la première ligne deviendrait `node\r` et le bin ne se lancerait pas.
    const bin = fs.readFileSync(path.join(packageDir, "cli/bin.mjs"), "utf8")
    expect(bin.startsWith("#!/usr/bin/env node\n")).toBe(true)

    expect(pkg.name).toBe("@otomata_tech/oto_platform")
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(pkg.sideEffects).toBe(false)
    for (const target of Object.values(pkg.exports)) {
      expect(published(target, pkg.files), target).toBe(true)
    }

    expect(pkg.peerDependencies).toMatchObject({
      "@supabase/supabase-js": "^2",
      next: "^15",
      react: "^19",
      "react-dom": "^19",
      "@phosphor-icons/react": "^2",
    })
    // E03-S01 AC1 : le canal MCP à versions exactes ; le SDK suit le peer exact de mcp-handler 1.1.0,
    // et `zod/v4` exige zod 3.25 chez l'hôte. E01-S09 : le pilote Postgres de `db prepare` (ADR-012 § 1).
    // E01-S11 a2 : nodemailer, l'email d'invitation hors Supabase (`server/mail.ts`).
    // 1.1.3 : mermaid, le dessin des blocs mermaid, chargé à la demande dans le navigateur (`ui/noeud/diagramme-mermaid.tsx`).
    // E10-S02 lot a : aws4fetch, la signature SigV4 du port de stockage S3 (`server/files/s3.ts`, ADR-016).
    // Moteur des connecteurs décrits : ajv, la validation du JSON Schema 2020-12 d'un connecteur décrit (`server/catalog/arguments.ts`).
    // fflate : les ZIP du transfert d'une arborescence (`server/transfer/formats.ts`).
    expect(pkg.dependencies).toEqual({ "@modelcontextprotocol/sdk": "1.26.0", ajv: "8.20.0", aws4fetch: "1.0.20", fflate: "0.8.3", jose: "6.2.12", "mcp-handler": "1.1.0", mermaid: "11.17.2", nodemailer: "10.0.10", postgres: "3.4.9" })
    expect(pkg.peerDependencies.zod).toBe("^3.25")
  })
})

describe("package LICENSE (AC2)", () => {
  it("should be byte for byte the LICENSE of the repository", () => {
    const own = fs.readFileSync(path.join(packageDir, "LICENSE"))
    expect(own.equals(fs.readFileSync(path.join(root, "LICENSE")))).toBe(true)
  })
})

// Notes de version, écrites à la fusion d'un changement visible d'un hôte : tant qu'il
// n'existe pas dans la branche, ces tests sont sautés, et ils tournent sur main dès qu'il existe.
const changelogWritten = fs.existsSync(path.join(packageDir, "CHANGELOG.md"))

describe.skipIf(!changelogWritten)("package CHANGELOG (AC7), written by the pilot at merge", () => {
  const changelog = () => read("packages/plateforme/CHANGELOG.md").split("\n")
  const VERSION = /^## (?:Unreleased|\d+\.\d+\.\d+ — \d{4}-\d{2}-\d{2})$/

  it("should describe its format, title each version, hold one-line lists only and tell hosts about the command line", () => {
    const lines = changelog()
    expect(lines[0]).toBe("# Changelog — @otomata_tech/oto_platform")
    const intro = lines.slice(1, lines.findIndex((line) => line.startsWith("## "))).join("\n")
    for (const term of ["## <x.y.z> — <YYYY-MM-DD>", "## Unreleased", "### Assistants", "### Hosts"]) {
      expect(intro).toContain(term)
    }

    const versions = lines.filter((line) => line.startsWith("## "))
    expect(versions[0]).toBe("## Unreleased")
    for (const heading of versions) expect(heading, heading).toMatch(VERSION)

    let list: string | null = null
    const hostEntries: string[] = []
    for (const line of lines.slice(lines.findIndex((l) => l.startsWith("## ")))) {
      if (!line.trim()) continue
      if (line.startsWith("#")) {
        expect(line, line).toMatch(/^(?:## .+|### (?:Assistants|Hosts))$/)
        list = line.startsWith("### ") ? line : null
        continue
      }
      expect(list, `entry outside a list: ${line}`).not.toBeNull()
      expect(line, line).toMatch(/^- \S/)
      // Une entrée Assistants est servie au modèle dans `context` : 200 caractères au plus.
      if (list === "### Assistants") expect(line.length - 2, line).toBeLessThanOrEqual(200)
      if (list === "### Hosts") hostEntries.push(line)
    }
    // Sous `## Unreleased` au départ, sous `## 0.1.0 — …` après la première publication.
    expect(hostEntries.some((entry) => entry.includes("oto-platform migrations sync|check"))).toBe(true)
  })
})

describe("publish workflow (AC9)", () => {
  const workflow = () => read(".github/workflows/publish.yml")

  it("should run on pushed v* tags only, read the contents, write the provenance token, and check everything before publishing from the package", () => {
    const trigger = workflow().split("\npermissions:")[0].split("\non:")[1]
    expect(trigger.replace(/\s+/g, " ").trim()).toBe('push: tags: ["v*"]')

    const permissions = workflow().split("\npermissions:")[1].split("\njobs:")[0]
    expect(permissions.replace(/#.*$/gm, "").replace(/\s+/g, " ").trim()).toBe("contents: read id-token: write")

    const text = workflow()
    const steps = [
      "uses: actions/checkout@v4",
      "fetch-depth: 0",
      "uses: pnpm/action-setup@v4",
      "uses: actions/setup-node@v4",
      "node-version: 22",
      "registry-url: https://registry.npmjs.org",
      "run: pnpm install --frozen-lockfile",
      "run: node scripts/check-public.mjs --secrets-only",
      "run: pnpm check:migrations",
      'test "$GITHUB_REF_NAME" = "v$version"',
      'grep -q "^## $version — " packages/plateforme/CHANGELOG.md',
      "run: npm pack --dry-run",
      "run: npm publish --provenance --access public",
      "NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}",
    ]
    const positions = steps.map((step) => text.indexOf(step))
    steps.forEach((step, k) => expect(positions[k], step).toBeGreaterThan(k === 0 ? -1 : positions[k - 1]))

    const publish = text.split("- name: Publish")[1]
    expect(publish).toContain("working-directory: packages/plateforme")
    expect(publish).toContain("run: npm publish --provenance --access public")
    expect(publish).toContain("NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}")
  })
})

describe("Renovate preset (AC10)", () => {
  type Rule = { matchPackageNames: string[]; matchUpdateTypes: string[]; rangeStrategy: string; automerge: boolean; labels?: string[] }
  // `JSON.parse` rend `any` : la forme d'une règle du preset est déclarée ci-dessus.
  const rules = () => (JSON.parse(read("renovate/preset.json")) as { packageRules: Rule[] }).packageRules

  it("should hold three rules: pin and automerge patches, pin minors and majors for a human review under their own label", () => {
    const all = rules()
    expect(all).toHaveLength(3)
    const patch = all.find((r) => r.matchUpdateTypes.includes("patch"))
    expect(patch).toMatchObject({ matchPackageNames: ["@otomata_tech/oto_platform"], matchUpdateTypes: ["patch"], rangeStrategy: "pin", automerge: true })
    const minor = all.find((r) => r.matchUpdateTypes.includes("minor"))
    expect(minor).toMatchObject({ matchPackageNames: ["@otomata_tech/oto_platform"], matchUpdateTypes: ["minor"], rangeStrategy: "pin", automerge: false, labels: ["oto-platform-minor"] })
    const major = all.find((r) => r.matchUpdateTypes.includes("major"))
    expect(major).toMatchObject({ matchPackageNames: ["@otomata_tech/oto_platform"], matchUpdateTypes: ["major"], rangeStrategy: "pin", automerge: false, labels: ["oto-platform-major"] })
  })
})
