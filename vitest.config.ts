import { existsSync, readFileSync } from "fs"
import path from "path"
import { parseEnv } from "util"
import { defineConfig } from "vitest/config"
import react from "@vitejs/plugin-react"
import { localUrls } from "./scripts/lib/test-db-local.mjs"
import { testProjectRefusal } from "./tests/helpers/test-project-guard.mjs"

// Les tests d'intégration RLS tournent sur le projet Supabase cloud : ils lisent l'URL, la clé
// anon et la clé secrète dans `.env` puis `.env.local` (le second l'emporte, l'environnement du
// processus l'emporte sur les deux). Seules `NEXT_PUBLIC_*`, `SUPABASE_SECRET_KEY` et
// `SUPABASE_DB_URL` passent : le jeton d'accès reste hors des tests. L'URL de la base ne sert que la
// connexion d'administration des tests (`tests/helpers/admin-sql.ts`, E01-S09) : lectures de
// catalogue et sessions aux claims choisis, que PostgREST ne sert pas. Le port de base (E01-S10) : la
// connexion du serveur (`PLATFORM_DATABASE_URL`) et celle d'administration des suites portables
// (`PLATFORM_ADMIN_DATABASE_URL`, `tests/helpers/sql.ts`). `SUPABASE_PROJECT_ID` et
// `PLATFORM_TEST_PROJECT_ID` servent la garde du projet de test, plus bas. `util.parseEnv` (Node) plutôt
// que `loadEnv` de Vite : la lecture ne dépend pas de la version de Vite que la racine déclare pour Vitest.
function loadTestEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const file of [".env", ".env.local"]) {
    const filePath = path.resolve(__dirname, file)
    if (!existsSync(filePath)) continue
    const parsed = parseEnv(readFileSync(filePath, "utf8"))
    for (const [key, value] of Object.entries(parsed)) {
      const kept =
        key.startsWith("NEXT_PUBLIC_") ||
        ["SUPABASE_SECRET_KEY", "SUPABASE_DB_URL", "PLATFORM_DATABASE_URL", "PLATFORM_ADMIN_DATABASE_URL", "PLATFORM_TEST_DB", "SUPABASE_PROJECT_ID", "PLATFORM_TEST_PROJECT_ID"].includes(key)
      if (kept && value !== undefined && process.env[key] === undefined) env[key] = value
    }
  }
  return env
}

// Base de test locale (M62) : `PLATFORM_TEST_DB=local`, dans l'environnement ou `.env.local`, fait tourner
// les suites sur la base du checkout dans le Postgres du poste (`pnpm db:local`), comme le job
// `bare-postgres` : les deux connexions y pointent, et les variables de Supabase sont retirées, pour que
// ses suites (Auth, `auth.users`, Data API) se sautent. Sans la variable, rien ne change.
const SUPABASE_VARIABLES = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SECRET_KEY", "SUPABASE_DB_URL"]
const testEnv = loadTestEnv()
const localDb = (process.env.PLATFORM_TEST_DB ?? testEnv.PLATFORM_TEST_DB) === "local"
if (localDb) {
  const urls = localUrls(__dirname)
  for (const key of SUPABASE_VARIABLES) {
    delete testEnv[key]
    // Une variable de l'environnement du processus passerait aux suites : vide, elle les fait sauter.
    if (process.env[key] !== undefined) testEnv[key] = ""
  }
  testEnv.PLATFORM_DATABASE_URL = urls.app
  testEnv.PLATFORM_ADMIN_DATABASE_URL = urls.admin
}

// Aucune suite ne part vers un autre projet que celui de `PLATFORM_TEST_PROJECT_ID` : jugé sur les
// variables que verront les suites (celles du processus, recouvertes par `testEnv`).
const refusal = testProjectRefusal({ ...process.env, ...testEnv })
if (refusal) throw new Error(refusal)

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    globalSetup: localDb ? ["./tests/local-db.setup.ts"] : [],
    include: ["tests/**/*.test.{ts,tsx}", "src/**/*.test.{ts,tsx}", "packages/**/*.test.{ts,tsx}"],
    env: testEnv,
    // Délais par défaut portés de 5 à 20 s (test) et de 10 à 30 s (hook) : sous la charge de
    // plusieurs agents sur la machine partagée, un test sans délai explicite a dépassé 5 s le
    // 2026-09-24 (`tests/unit/package-faces.test.ts > should resolve the mcp face` : 5 061 ms, import
    // du SDK MCP, contre 1 966 ms lancé seul) et fait échouer `pnpm verify` (M04). 20 s laisse près
    // de quatre fois le pire temps mesuré. Les délais explicites (`SPAWN_TIMEOUT`, `NETWORK_TIMEOUT`)
    // restent la règle des tests qui lancent des processus ou appellent le réseau.
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
