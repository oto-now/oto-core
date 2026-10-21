// @vitest-environment node
import { spawnSync } from "child_process"
import fs from "fs"
import os from "os"
import path from "path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

/**
 * `pnpm check:framework` fait partie de `pnpm verify`, donc du gate des fusions sur main : il se lance
 * ici sur un dépôt jetable.
 */

const root = path.resolve(__dirname, "../..")
const scripts = path.join(root, "scripts")

let dir: string

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "check-framework-"))
})

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

/**
 * Dépôt jetable au framework minimal et cohérent, plus `files`. Le script déduit sa racine de son
 * propre emplacement (`scripts/..`) : copié dans `<dépôt>/scripts/`, c'est ce dépôt qu'il contrôle.
 */
function repo(files: Record<string, string> = {}) {
  const at = fs.mkdtempSync(path.join(dir, "repo-"))
  const write = (name: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(at, name)), { recursive: true })
    fs.writeFileSync(path.join(at, name), content)
  }
  fs.mkdirSync(path.join(at, "scripts"))
  for (const script of fs.readdirSync(scripts).filter((name) => /^check-framework.*\.mjs$/.test(name))) {
    fs.copyFileSync(path.join(scripts, script), path.join(at, "scripts", script))
  }
  write(
    ".method/conventions/_index.md",
    [
      "| Tag | Fichier | Globs | Description |",
      "|-----|---------|-------|-------------|",
      "| `testing` | `testing-strategy.md` | `**/*.test.ts` | Tests |",
      "",
    ].join("\n"),
  )
  write(".method/conventions/coding-standards.md", "# Coding Standards\n\n## Naming\n")
  write(".method/conventions/testing-strategy.md", "# Stratégie de tests\n\n## Setup\n")
  // Chaque convention a sa fiche, dont chaque règle renvoie à une section du texte complet (M33).
  write(".method/conventions/fiches/coding-standards.md", "# Fiche\n\n- Fichiers en kebab-case. § Naming\n")
  write(".method/conventions/fiches/testing-strategy.md", "# Fiche\n\n- Vitest configuré. § Setup\n")
  // Les skills attendus sont ceux de ce dépôt, sur lequel le check passe : ses dossiers, comme le script.
  const skills = fs.readdirSync(path.join(root, ".claude/skills"), { withFileTypes: true }).filter((e) => e.isDirectory())
  for (const { name: skill } of skills) {
    write(
      `.claude/skills/${skill}/SKILL.md`,
      `---\nname: ${skill}\ndescription: "Skill ${skill} du dépôt jetable, décrit assez longuement pour le contrôle."\n---\n`,
    )
  }
  // Hooks que le check exige branchés (scripts/check-framework-invariants.mjs).
  write(".claude/hooks/enforce-git-gate.mjs", "process.exit(2)\n")
  write(".claude/hooks/enforce-bash-rules.mjs", "process.exit(2)\n")
  write(".githooks/pre-commit", "node scripts/verify-receipt.mjs check\n")
  for (const [name, content] of Object.entries(files)) write(name, content)
  return at
}

function checkFramework(at: string) {
  const result = spawnSync(process.execPath, [path.join(at, "scripts/check-framework.mjs")], { encoding: "utf8" })
  return { status: result.status, stdout: result.stdout, output: result.stdout + result.stderr }
}

// Une section que `coding-standards.md` n'a pas : le check la refuse partout où il lit ce fichier.
const citationMorte = "Voir `coding-standards.md § Section absente`.\n"
const erreurDe = (file: string) => `✖  ${file} : cite \`coding-standards.md § Section absente\``

// Un lancement de node par test : de 0,85 à 1,4 s mesurés pendant un `pnpm verify` complet
// (VITEST_MAX_FORKS=2, 2026-09-24), sur la machine où la charge des agents a fait sauter le délai de
// 5 s par défaut le même jour (M03). 30 s, comme `check-public.test.ts`.
describe("check-framework on a throwaway repository", { timeout: 30_000 }, () => {
  it("should report a section citation that matches no heading", () => {
    const result = checkFramework(repo({ "docs/brouillon.md": citationMorte }))
    expect(result.status).toBe(1)
    expect(result.stdout).toContain(erreurDe("docs/brouillon.md"))
  })

  it("should read the markdown files under .claude/", () => {
    const result = checkFramework(repo({ ".claude/skills/dev/notes.md": citationMorte }))
    expect(result.status).toBe(1)
    expect(result.stdout).toContain(erreurDe(".claude/skills/dev/notes.md"))
  })

  it.each<[string, Record<string, string>, string]>([
    ["is absent", {}, "scripts/verify.mjs absent"],
    ["does not set process.exitCode = 1", { "scripts/verify.mjs": 'console.log("verify")\n' }, "scripts/verify.mjs ne pose plus `process.exitCode = 1`"],
  ])("should report a scripts/verify.mjs that %s", (_cas, files, erreur) => {
    // Revue de M12 : `pnpm verify` écrit le reçu sur le seul code de sortie de ce script ; sorti à 0 sur
    // un check rouge, il l'écrirait. Les scripts de ce dépôt, recopiés, passent les autres contrôles.
    const scriptsDuPaquet = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).scripts
    const result = checkFramework(repo({ "package.json": JSON.stringify({ scripts: scriptsDuPaquet }), ...files }))
    expect(result.status).toBe(1)
    expect(result.stdout).toContain(`✖  ${erreur}`)
  })

  // M33 : un agent lit la fiche par défaut, et le texte complet sur un doute. Un renvoi mort ferait
  // tenir une règle sans source ; une convention sans fiche ferait lire une fiche absente.
  const fiche = ".method/conventions/fiches/coding-standards.md"
  it.each<[string, Record<string, string>, string]>([
    [
      "cites a section absent from its full text",
      { [fiche]: "# Fiche\n\n- Fichiers en kebab-case. § Nommage\n" },
      `${fiche}:3 : renvoie à \`§ Nommage\``,
    ],
    [
      "has a rule without any section citation",
      { [fiche]: "# Fiche\n\n- Fichiers en kebab-case. § Naming\n- Règle sans renvoi.\n" },
      `${fiche}:4 : règle sans renvoi`,
    ],
    [
      "writes an invisible character literally",
      { [fiche]: `# Fiche\n\n- Fichiers en kebab-case ${String.fromCodePoint(0x202e)}. § Naming\n` },
      `${fiche}:3 : caractère invisible`,
    ],
    [
      "has no full text",
      { ".method/conventions/fiches/absente.md": "# Fiche\n" },
      ".method/conventions/fiches/absente.md : aucune convention",
    ],
    [
      "exceeds 60 lines",
      { [fiche]: `# Fiche\n\n${"- Fichiers en kebab-case. § Naming\n".repeat(59)}` },
      `${fiche} : 61 lignes (max 60)`,
    ],
  ])("should report a fiche that %s", (_cas, files, erreur) => {
    const result = checkFramework(repo(files))
    expect(result.status).toBe(1)
    expect(result.stdout).toContain(`✖  ${erreur}`)
  })

  it("should report a convention without a fiche", () => {
    const result = checkFramework(repo({ ".method/conventions/api-patterns.md": "# API\n\n## Auth\n" }))
    expect(result.status).toBe(1)
    expect(result.stdout).toContain("✖  Convention sans fiche : api-patterns.md")
  })

  it("should check a citation of another file in a fiche against that file only", () => {
    const result = checkFramework(
      repo({ [fiche]: "# Fiche\n\n- Tests : `testing-strategy.md § Setup`. § Naming\n" }),
    )
    expect(result.status, result.output).toBe(0)
  })

  // E11-S07 (AC-d1) : un segment de route de `src/app` est pris dans la liste des segments admis, en anglais.
  const PAGE = "export default function Page() {\n  return null\n}\n"

  it.each<[string, string]>([
    ["a French route folder", "src/app/(dashboard)/equipes/page.tsx"],
    ["a route folder in British spelling", "src/app/(dashboard)/admin/organisation/page.tsx"],
  ])("should report %s, naming the file and the segment", (_cas, fichier) => {
    const result = checkFramework(repo({ [fichier]: PAGE }))
    const segment = fichier.split("/").at(-2)
    expect(result.status).toBe(1)
    expect(result.stdout).toContain(`✖  ${fichier} : segment de route « ${segment} » absent de SEGMENTS_ADMIS`)
  })

  it("should let English route folders, groups, parameters, private folders, slots and dot folders through", () => {
    const result = checkFramework(
      repo({
        "src/app/(dashboard)/admin/organization/page.tsx": PAGE,
        "src/app/(dashboard)/n/[...chemin]/page.tsx": PAGE,
        "src/app/(dashboard)/_composants/bouton.tsx": PAGE,
        "src/app/@apercu/default.tsx": PAGE,
        "src/app/.well-known/oauth-protected-resource/route.ts": "export const GET = () => new Response()\n",
      }),
    )
    expect(result.status, result.output).toBe(0)
  })

  // E11-S07 (AC-d2) : aucun ancien nom français en position d'adresse, avec le fichier, la ligne et le nouveau nom.
  it.each<[string, string, string]>([
    ["the former API prefix", 'await fetch("/api/plateforme/x")', "« api/plateforme » — écrire « /api/platform »"],
    ["a French parameter", 'const adresse = "/teams?onglet=members"', "« ?onglet= » — écrire « ?tab= »"],
    ["the British spelling in an address", 'redirect("/admin/organisation")', "« /admin/organisation » — écrire « /admin/organization »"],
    ["a French parameter set on URLSearchParams", 'recherche.set("onglet", "members")', '« .set("onglet" » — écrire « tab »'],
    ["a French parameter appended to URLSearchParams", "recherche.append('curseur', suivant)", "« .append('curseur' » — écrire « cursor »"],
    ["a French GET form field", '<input type="hidden" name="periode" value="7" />', '« name="periode" » — écrire « period »'],
    ["a French filter choice", '<ChoixDuFiltre nom={"equipe"} />', '« nom={"equipe" » — écrire « team »'],
    ["a French key of URLSearchParams", 'new URLSearchParams({ etat: "open" })', "« URLSearchParams({ etat: » — écrire « state »"],
    ["a French shorthand key after another", "new URLSearchParams({ tab, sens })", "« URLSearchParams({ tab, sens } » — écrire « order »"],
    ["the former anchor of Everyone's Context", 'href="/context#contexte-tout-le-monde"', "« #contexte-tout-le-monde » — écrire « #everyone-context »"],
  ])("should report %s written in an address", (_cas, ligne, erreur) => {
    const result = checkFramework(repo({ "src/lib/adresse.ts": `// Une adresse.\n${ligne}\n` }))
    expect(result.status).toBe(1)
    expect(result.stdout).toContain(`✖  src/lib/adresse.ts:2 : ancien nom d'adresse ${erreur}`)
  })

  it.each<[string, string]>([
    ["a French word in a comment", "// Restaurer depuis la corbeille.\n"],
    ["a module path", 'import { EcranOrganisation } from "./admin/organisation/ecran-organisation"\n'],
    ["the British spelling in an English text", 'const texte = "Ask an administrator of the organisation."\n'],
    ["the presence parameter, kept", 'recherche.set("presence", "empty")\n'],
    ["English parameters with French values", 'new URLSearchParams({ tab: "etat", period: String(7) }).set("filter", "tri")\n'],
    ["French words in a screen text", '<Select name="team" label="Équipe">Le tri, le sens et la période de l\'état</Select>\n'],
    ["a Map keyed by a variable", "etats.set(etat, 1)\n"],
  ])("should let %s through", (_cas, contenu) => {
    const result = checkFramework(repo({ "src/lib/texte.ts": contenu }))
    expect(result.status, result.output).toBe(0)
  })
})
