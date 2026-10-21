// @vitest-environment node
import { describe, expect, it } from "vitest"
import { testProjectRefusal } from "../helpers/test-project-guard.mjs"

// Garde du projet de test : les tests ne visent jamais la production (`testing-strategy.md § Base de
// test locale`). Identifiants factices, URL sans mot de passe (la garde ne lit que l'hôte et
// l'utilisateur) : aucune valeur réelle, rien que le contrôle pré-public refuse.

const TEST = "t".repeat(20)
const OTHER = "p".repeat(20)

function remote(ref: string) {
  return {
    SUPABASE_PROJECT_ID: ref,
    NEXT_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co`,
    SUPABASE_DB_URL: `postgresql://postgres@db.${ref}.supabase.co:5432/postgres?sslmode=require`,
    PLATFORM_DATABASE_URL: `postgresql://platform_app.${ref}@aws-1-eu-west-3.pooler.supabase.com:6543/postgres`,
    PLATFORM_ADMIN_DATABASE_URL: `postgresql://postgres.${ref}@aws-1-eu-west-3.pooler.supabase.com:5432/postgres`,
  }
}

describe("testProjectRefusal", () => {
  it("should let a bare Postgres run without any Supabase variable", () => {
    expect(testProjectRefusal({ PLATFORM_DATABASE_URL: "postgresql://platform_app@localhost:5432/postgres", PLATFORM_ADMIN_DATABASE_URL: "postgresql://postgres@localhost:5432/postgres" })).toBeNull()
    expect(testProjectRefusal({})).toBeNull()
  })

  // Supabase local (`npx supabase start`) : une adresse du poste n'a pas de projet distant.
  it.each(["http://localhost:54321", "http://127.0.0.1:54321", "http://[::1]:54321", "http://t1.localhost:54321"])(
    "should let a Supabase served at %s run without PLATFORM_TEST_PROJECT_ID",
    (api) => {
      const host = new URL(api).host
      const db = `postgresql://postgres@${host.replace(/:\d+$/, "")}:54322/postgres`
      expect(testProjectRefusal({ NEXT_PUBLIC_SUPABASE_URL: api, SUPABASE_DB_URL: db, PLATFORM_DATABASE_URL: db, PLATFORM_ADMIN_DATABASE_URL: db })).toBeNull()
    },
  )

  it.each([
    ["NEXT_PUBLIC_SUPABASE_URL", "https://localhost.supabase.co"],
    ["NEXT_PUBLIC_SUPABASE_URL", "https://127.0.0.1.nip.io"],
    ["NEXT_PUBLIC_SUPABASE_URL", "https://t1.localhost.example.com"],
    ["NEXT_PUBLIC_SUPABASE_URL", "http://localhost@db.localhost.supabase.co"],
    ["SUPABASE_DB_URL", "postgresql://postgres@db.localhost.supabase.co:5432/postgres"],
    ["PLATFORM_DATABASE_URL", "postgresql://platform_app.localhost@aws-1-eu-west-3.pooler.supabase.com:6543/postgres"],
  ])("should still check %s at the remote address %s", (key, url) => {
    expect(testProjectRefusal({ [key]: url })).toMatch(/: PLATFORM_TEST_PROJECT_ID manque\./)
  })

  it("should let the local mode run whatever the Supabase variables", () => {
    expect(testProjectRefusal({ ...remote(OTHER), PLATFORM_TEST_DB: "local" })).toBeNull()
  })

  it("should accept a remote run when every variable names the test project", () => {
    expect(testProjectRefusal({ ...remote(TEST), PLATFORM_TEST_PROJECT_ID: TEST })).toBeNull()
  })

  // L'URL de l'API seule, une URL du pooler seule : « should still check … at the remote address », plus haut.
  it("should require PLATFORM_TEST_PROJECT_ID for the project id alone", () => {
    expect(testProjectRefusal({ SUPABASE_PROJECT_ID: TEST })).toMatch(/: PLATFORM_TEST_PROJECT_ID manque\./)
  })

  it("should refuse a project id other than the test project", () => {
    expect(testProjectRefusal({ ...remote(TEST), SUPABASE_PROJECT_ID: OTHER, PLATFORM_TEST_PROJECT_ID: TEST })).toMatch(/: SUPABASE_PROJECT_ID ne vise pas/)
    expect(testProjectRefusal({ NEXT_PUBLIC_SUPABASE_URL: `https://${TEST}.supabase.co`, PLATFORM_TEST_PROJECT_ID: TEST })).toMatch(/: SUPABASE_PROJECT_ID ne vise pas/)
  })

  // Chaque variable qui vise un autre projet, nommée : « should never print a value » exige la liste des cinq.
  it("should refuse an API URL that does not name its project", () => {
    expect(testProjectRefusal({ ...remote(TEST), NEXT_PUBLIC_SUPABASE_URL: "https://api.example.invalid", PLATFORM_TEST_PROJECT_ID: TEST })).toMatch(/: NEXT_PUBLIC_SUPABASE_URL ne vise pas/)
  })

  it("should never print a value", () => {
    const env = { ...remote(OTHER), PLATFORM_TEST_PROJECT_ID: TEST }
    const message = testProjectRefusal(env) ?? ""
    expect(message).toMatch(/SUPABASE_PROJECT_ID, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_DB_URL, PLATFORM_DATABASE_URL, PLATFORM_ADMIN_DATABASE_URL ne visent pas/)
    expect(Object.entries(env).filter(([, value]) => message.includes(value)).map(([key]) => key)).toEqual([])
  })
})
