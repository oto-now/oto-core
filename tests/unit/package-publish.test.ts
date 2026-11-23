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
      url: "git+https://github.com/oto-now/oto-core.git",
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
    // E03-S01 AC1 : le canal MCP à versions exactes ; le SDK 1.32.1 corrige trois failles de la 1.26 (le peer exact 1.26.0 de
    // mcp-handler 1.1.0 reste non satisfait, sans effet sur ce qu'il emploie),
    // et `zod/v4` exige zod 3.25 chez l'hôte. E01-S09 : le pilote Postgres de `db prepare` (ADR-012 § 1).
    // E01-S11 a2 : nodemailer, l'email d'invitation hors Supabase (`server/mail.ts`).
    // 1.1.3 : mermaid, le dessin des blocs mermaid, chargé à la demande dans le navigateur (`ui/noeud/diagramme-mermaid.tsx`).
    // E10-S02 lot a : aws4fetch, la signature SigV4 du port de stockage S3 (`server/files/s3.ts`, ADR-016).
    // Moteur des connecteurs décrits : ajv, la validation du JSON Schema 2020-12 d'un connecteur décrit (`server/catalog/arguments.ts`).
    // fflate : les ZIP du transfert d'une arborescence (`server/transfer/formats.ts`).
    // Fonctions d'un hôte : la lib de connecteurs, son profil hôte (`server/host-api/document.ts`), épinglée par SHA complet,
    // faute d'être publiée sur npm.
    expect(pkg.dependencies).toEqual({ "@modelcontextprotocol/sdk": "1.32.1", "@otomata_tech/connectors": "github:oto-now/connectors#47c4bdcb0273f8fc7fbb2433adb5ad2167548784&path:/ts", ajv: "8.20.0", aws4fetch: "1.0.20", fflate: "0.8.3", jose: "6.2.12", "mcp-handler": "1.1.0", mermaid: "11.17.2", nodemailer: "10.0.10", postgres: "3.4.9" })
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
  const flat = (text: string) => text.replace(/#.*$/gm, "").replace(/\s+/g, " ").trim()
  const job = (name: "tag" | "publish") => {
    const jobs = workflow().split("\njobs:")[1]
    return name === "tag" ? jobs.split("\n  publish:")[0] : jobs.split("\n  publish:")[1]
  }

  // ADR-010 révisée le 2026-11-19 : une version se publie à la fusion de sa pull request de version, approuvée par
  // JB ou Alexis ; aucun `push: tags`, sans quoi un tag poussé à la main publierait sans approbation.
  it("should run on merged pull requests to main or release/** that touch the package manifest, or by hand on an existing tag, never on a pushed tag", () => {
    const trigger = workflow().split("\npermissions:")[0].split("\non:")[1]
    expect(flat(trigger)).toBe(
      'pull_request: types: [closed] branches: [main, "release/**"] paths: ["packages/plateforme/package.json"] ' +
        'workflow_dispatch: inputs: tag: description: "Tag v<version> déjà posé, à publier" required: true type: string',
    )
    expect(trigger).not.toMatch(/push:/)

    const permissions = workflow().split("\npermissions:")[1].split(/\n[a-z]/)[0]
    expect(flat(permissions)).toBe("contents: read")
    expect(workflow()).toContain('APPROVERS: "jean-baptiste-tiple AlexisLaporte"')
    // Seul Alexis passe outre : JB, même administrateur, attend son approbation.
    expect(workflow()).toContain('BYPASSERS: "AlexisLaporte"')
  })

  // Alexis seul (`BYPASSERS`), passant outre la règle de branche (exception des administrateurs), publie, en avertissement tracé.
  it("should tag the merge commit of a version pull request only after its content checks and an approver's approval of its last commit, or a bypasser's traced merge", () => {
    const tag = job("tag")
    expect(tag).toContain("if: github.event_name == 'pull_request' && github.event.pull_request.merged == true")
    expect(flat(tag.split("permissions:")[1].split("outputs:")[0])).toBe("contents: write pull-requests: read")

    const steps = [
      "ref: ${{ github.event.pull_request.merge_commit_sha }}",
      'node scripts/ci/version-publiable.mjs --ref "$MERGE_SHA" --base "$BASE_SHA" --head "$HEAD_SHA"',
      '"repos/$GITHUB_REPOSITORY/pulls/$PR/reviews"',
      '$2 != "COMMENTED"',
      'if [ "$last" = "APPROVED $HEAD_SHA" ]',
      'if [ -n "$approved" ]; then echo "approved by $approved"; exit 0; fi',
      "for login in $BYPASSERS; do",
      'if [ "$MERGED_BY" = "$login" ]; then',
      'echo "::warning title=Version without approval::$message"',
      'echo "$message" >> "$GITHUB_STEP_SUMMARY"',
      'and merged by $MERGED_BY, not one of: $BYPASSERS"; exit 1',
      'git tag -a "$TAG" -m "@otomata_tech/oto_platform ${TAG#v}" "$MERGE_SHA"',
      'git push origin "refs/tags/$TAG"',
    ]
    const positions = steps.map((step) => tag.indexOf(step))
    steps.forEach((step, k) => expect(positions[k], step).toBeGreaterThan(k === 0 ? -1 : positions[k - 1]))
    // Un tag poussé avec le GITHUB_TOKEN ne déclenche aucun workflow : la publication suit dans le même workflow.
    expect(job("publish")).toContain("needs: tag")
  })

  it("should publish from the tag, after every check, with provenance; by hand only for an approver", () => {
    const publish = job("publish")
    // Le job `tag` peut avoir sorti un tag puis échoué (approbation absente) : son résultat compte, pas sa sortie seule.
    expect(publish).toContain(
      "if: ${{ !cancelled() && ((github.event_name == 'pull_request' && needs.tag.result == 'success' && needs.tag.outputs.tag != '') || github.event_name == 'workflow_dispatch') }}",
    )
    expect(flat(publish.split("permissions:")[1].split("env:")[0])).toBe("contents: read id-token: write")
    expect(publish).toContain("TAG: ${{ needs.tag.outputs.tag || inputs.tag }}")

    const steps = [
      "- name: Manual pass by an approver only",
      'for login in $APPROVERS; do test "$GITHUB_ACTOR" = "$login" && exit 0; done',
      "uses: actions/checkout@v4",
      "ref: refs/tags/${{ env.TAG }}",
      "fetch-depth: 0",
      "uses: pnpm/action-setup@v4",
      "uses: actions/setup-node@v4",
      "node-version: 24",
      "registry-url: https://registry.npmjs.org",
      "run: pnpm install --frozen-lockfile",
      "run: node scripts/check-public.mjs --secrets-only",
      "run: pnpm check:migrations",
      'run: node scripts/ci/version-publiable.mjs --ref "$TAG" --tag "$TAG"',
      "run: npm pack --dry-run",
      "run: npm publish --provenance --access public",
      "NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}",
    ]
    const positions = steps.map((step) => publish.indexOf(step))
    steps.forEach((step, k) => expect(positions[k], step).toBeGreaterThan(k === 0 ? -1 : positions[k - 1]))

    const last = publish.split("- name: Publish\n")[1]
    expect(last).toContain("working-directory: packages/plateforme")
    expect(last).toContain("run: npm publish --provenance --access public")
    expect(last).toContain("NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}")
  })

  it("should run CI on pull requests to release/** too, with the version's content checks before the merge", () => {
    const ci = read(".github/workflows/ci.yml")
    const trigger = ci.split("\njobs:")[0]
    expect(flat(trigger.split("pull_request:")[1])).toBe('branches: [main, "release/**"]')
    const version = ci.split("\n  version:")[1].split("\n  packed-host-build:")[0]
    expect(version).toContain("if: github.event_name == 'pull_request'")
    expect(version).toContain("fetch-depth: 0")
    expect(version).toContain('run: node scripts/ci/version-publiable.mjs --ref "$GITHUB_SHA" --base "$BASE_SHA" --head "$HEAD_SHA"')
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
