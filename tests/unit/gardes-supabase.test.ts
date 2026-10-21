// @vitest-environment node
import { execFileSync } from "child_process"
import fs from "fs"
import path from "path"
import { describe, expect, it } from "vitest"

// Liste fermée des fichiers de `tests/` gardés par Supabase (E11-S14, AC-a7) : une suite du paquet prend
// ses personnes dans `createSqlFixtures`, ses jetons dans `createLocalFixtures` et se garde par
// `sqlConfigured` ; seuls les fichiers ci-dessous, chacun avec sa raison, importent un nom qui exige le
// projet. Un fichier nouveau qui en importe un échoue ici en se nommant ; une ligne dont le fichier n'en
// importe plus échoue aussi, et sort de la liste. Fichiers lus comme `rg` : suivis, ou nouveaux non ignorés.

const root = path.resolve(__dirname, "../..")
const GUARDED_NAMES = new Set(["supabaseConfigured", "projectConfigured", "onProject", "createFixtures", "authAdminClient"])

/** Les fichiers qui importent un nom de `GUARDED_NAMES`, et pourquoi ils gardent le projet. */
const SUPABASE_GUARDED: Record<string, string> = {
  // Aides : elles définissent la garde du projet ou servent les suites OAuth.
  "tests/helpers/sql.ts": "defines projectConfigured and onProject from supabaseConfigured",
  "tests/helpers/oauth-pending.ts": "poses pending requests of the OAuth server of Supabase, accounts by the Auth admin API",
  // Suites de l'adaptateur Supabase, sautées en entier hors du projet.
  "tests/integration/data-api-platform.test.ts": "the Data API of the project, closed to the platform schema",
  "tests/integration/demo-seed.test.ts": "the Demo script in its Supabase mode, E2E account by the Auth admin API",
  "tests/integration/oauth-clients.test.ts": "the OAuth administration API of Supabase",
  "tests/integration/oauth-consent.test.ts": "the OAuth server of Supabase and the auth schema",
  "tests/integration/oauth-lectures.test.ts": "the OAuth server of Supabase and the auth schema",
  "tests/integration/test-cleanup.test.ts": "the script lists and deletes Auth accounts",
  // Suites mixtes : seule leur partie Supabase se saute.
  "tests/integration/mcp-core.test.ts": "one describe proves a real Auth token checked by the JWKS of the project",
  "tests/integration/portabilite-schema.test.ts": "AC1 and AC2 read auth.users and auth.oauth_*, absent from a bare Postgres",
  "tests/integration/oauth-consent-page.test.tsx": "one describe drives the OAuth server of Supabase",
  "tests/integration/platform-staff-script.test.ts": "one describe runs the script in its Supabase mode",
  "tests/unit/server-oauth.test.ts": "one describe drives the OAuth server of Supabase",
  "tests/integration/org-transfer.test.ts": "export and import read and match the emails of Auth accounts (the AC14 describe is portable)",
  // Playwright : la campagne passe par l'écran de connexion de l'hôte de référence, Supabase Auth.
  "tests/e2e/aucune-organisation.spec.ts": "Playwright signs in through Supabase Auth",
  "tests/e2e/connect.spec.ts": "Playwright signs in through Supabase Auth",
  "tests/e2e/consentement.spec.ts": "Playwright signs in through Supabase Auth and its OAuth server",
  "tests/e2e/ecrans-d-authentification.spec.ts": "Playwright drives the Supabase Auth screens",
  "tests/e2e/fixtures/campagne.ts": "the t<hex> campaign creates its accounts in Supabase Auth",
}

/** Les fichiers de `tests/` que `rg` lirait : suivis, ou nouveaux et non ignorés. */
function testFiles(): string[] {
  const listed = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "tests"], { cwd: root, encoding: "utf8" })
  return [...new Set(listed.split("\0").filter(Boolean))].filter((file) => /\.(ts|tsx|mjs|js)$/.test(file) && fs.existsSync(path.join(root, file)))
}

/**
 * Les noms entre accolades d'un `import { … } from`, d'un `export { … } from` ou d'un import dynamique
 * déstructuré (`const { … } = await import(…)`), alias (`as`, `:`) et `type` retirés.
 */
function importedNames(source: string): string[] {
  const clauses = [
    ...source.matchAll(/\b(?:import|export)\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["'][^"']+["']/g),
    ...source.matchAll(/\bconst\s*\{([^}]*)\}\s*=\s*await\s+import\(/g),
  ]
  return clauses.flatMap(([, names]) =>
    names
      .split(",")
      .map((name) => name.trim().replace(/^type\s+/, "").split(/\s+as\s+|\s*:\s*/)[0])
      .filter(Boolean),
  )
}

describe("the files of tests/ guarded by Supabase (E11-S14, AC-a7)", () => {
  it("should find the Supabase guards imported by the listed files only, each listed file still importing one", () => {
    const guarded = testFiles()
      .filter((file) => importedNames(fs.readFileSync(path.join(root, file), "utf8")).some((name) => GUARDED_NAMES.has(name)))
      .sort()

    expect(guarded).toEqual(Object.keys(SUPABASE_GUARDED).sort())
  })
})
