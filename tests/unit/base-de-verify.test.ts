// @vitest-environment node
import fs from "fs"
import os from "os"
import path from "path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { serveurDeTest, variablesDesTests } from "../../scripts/lib/base-de-verify.mjs"
import { empreinteDesMigrations } from "../../scripts/lib/empreinte-des-migrations.mjs"
import { localUrls } from "../../scripts/lib/test-db-local.mjs"

/**
 * La base d'un `pnpm verify` (`scripts/lib/base-de-verify.mjs`) : l'empreinte des migrations change avec le contenu
 * d'une migration réécrite sous le même nom (le cas du 21/10/2026, où la base locale gardait l'ancienne version) ;
 * la base ne se construit que sur un Postgres du poste ; les tests du passage ne voient qu'elle.
 */

let dir: string

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "base-de-verify-"))
})

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

/** Un dossier jetable : ses migrations, et son `.env.local` s'il est donné. */
function dossier(migrations: Record<string, string>, envLocal?: string) {
  const at = fs.mkdtempSync(path.join(dir, "racine-"))
  fs.mkdirSync(path.join(at, "supabase/migrations"), { recursive: true })
  for (const [nom, contenu] of Object.entries(migrations)) fs.writeFileSync(path.join(at, "supabase/migrations", nom), contenu)
  if (envLocal !== undefined) fs.writeFileSync(path.join(at, ".env.local"), envLocal)
  return at
}

const GRANT = "grant execute on function platform.purge_transit_files() to platform_server;\n"

describe("migration fingerprint", () => {
  it("should change when a migration is rewritten under the same name, and not with the files that are not migrations", () => {
    const avant = dossier({ "20261021190000_a.sql": GRANT, "20261021230000_b.sql": "select 1;\n" })
    const apres = dossier({ "20261021190000_a.sql": GRANT.replace("platform_server", "authenticated"), "20261021230000_b.sql": "select 1;\n" })
    const memes = dossier({ "20261021190000_a.sql": GRANT, "20261021230000_b.sql": "select 1;\n", "README.md": "notes" })

    expect(empreinteDesMigrations(avant)).toMatch(/^[0-9a-f]{64}$/)
    expect(empreinteDesMigrations(apres)).not.toBe(empreinteDesMigrations(avant))
    expect(empreinteDesMigrations(memes)).toBe(empreinteDesMigrations(avant))
  })

  it("should change when a migration is renamed", () => {
    expect(empreinteDesMigrations(dossier({ "20261021190000_a.sql": GRANT }))).not.toBe(empreinteDesMigrations(dossier({ "20261021190001_a.sql": GRANT })))
  })
})

describe("server of the test base", () => {
  const LOCAL = "postgresql://postgres@127.0.0.1:32778/postgres?sslmode=disable"

  it("should build on the Postgres of the machine in local mode, from the environment or .env.local", async () => {
    const at = dossier({}, "PLATFORM_TEST_DB=local\n")
    expect(await serveurDeTest(at, {})).toEqual(localUrls(at, "postgres"))
    expect(await serveurDeTest(dossier({}), { PLATFORM_TEST_DB: "local" })).toEqual(localUrls(dossier({}), "postgres"))
  })

  it("should build on the server of PLATFORM_ADMIN_DATABASE_URL when it is on the machine, the environment over .env.local", async () => {
    const at = dossier({}, `PLATFORM_ADMIN_DATABASE_URL=https://db.example.supabase.co/postgres\n`)
    expect(await serveurDeTest(at, { PLATFORM_ADMIN_DATABASE_URL: LOCAL, PLATFORM_DATABASE_URL: "postgresql://platform_app@127.0.0.1:32778/postgres" })).toEqual({
      admin: LOCAL,
      app: "postgresql://platform_app@127.0.0.1:32778/postgres",
    })
  })

  it("should build nowhere without a server, or on a remote one", async () => {
    expect(await serveurDeTest(dossier({}), {})).toBeNull()
    expect(await serveurDeTest(dossier({}), { PLATFORM_ADMIN_DATABASE_URL: "postgresql://postgres@db.example.supabase.co:5432/postgres" })).toBeNull()
    // Le mode local neutralisé (vide) par l'environnement l'emporte sur `.env.local`.
    expect(await serveurDeTest(dossier({}, "PLATFORM_TEST_DB=local\n"), { PLATFORM_TEST_DB: "" })).toBeNull()
  })
})

describe("variables of the tests", () => {
  it("should point both connections to the base of the run, and blank the local mode and the Supabase variables", () => {
    const base = { nom: "verify_x", empreinte: "e".repeat(64), admin: "postgresql://postgres@127.0.0.1:1/verify_x", app: "postgresql://platform_app@127.0.0.1:1/verify_x" }
    expect(variablesDesTests(base)).toEqual({
      PLATFORM_TEST_DB: "",
      PLATFORM_DATABASE_URL: base.app,
      PLATFORM_ADMIN_DATABASE_URL: base.admin,
      NEXT_PUBLIC_SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
      SUPABASE_SECRET_KEY: "",
      SUPABASE_DB_URL: "",
    })
  })
})
