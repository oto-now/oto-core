// @vitest-environment node
// `oto-platform db prepare` (E01-S09, AC10 et AC11) sans base : le SQL joué selon l'hôte, lu dans
// `cli/db-prepare.sql`, et la commande sur un client simulé. La préparation réelle d'un Postgres nu,
// deux fois de suite, est le job de CI `bare-postgres` ; sur notre projet Supabase, une action JB.
import { spawnSync } from "child_process"
import { randomBytes } from "crypto"
import path from "path"
import { describe, expect, it } from "vitest"
import { DETECT_SUPABASE, prepareDatabase, preparePlan } from "../../packages/plateforme/cli/db-prepare.mjs"

const bin = path.resolve(__dirname, "../../packages/plateforme/cli/bin.mjs")

type Executed = { query: string; params?: unknown[] }

/** Un client postgres.js simulé : il note chaque requête, rend l'hôte détecté, lève sur `failOn`. */
function fakeClient(options: { supabase: boolean; failOn?: RegExp; failWith?: string }) {
  const executed: Executed[] = []
  const unsafe = async (query: string, params?: unknown[]) => {
    executed.push({ query, params })
    if (query === DETECT_SUPABASE) return [{ supabase: options.supabase }]
    if (options.failOn?.test(query)) throw new Error(options.failWith ?? "refused")
    return []
  }
  const connect = () => ({ unsafe, begin: async (run: (tx: { unsafe: typeof unsafe }) => Promise<unknown>) => run({ unsafe }), end: async () => {} })
  return { connect, executed }
}

/** Le SQL d'un plan sans ses commentaires : ce qu'il crée, pas ce qu'il en dit. */
const codeOf = (statements: string[]) => statements.join("\n").replace(/--[^\n]*/g, "")

async function prepare(options: { supabase: boolean; failOn?: RegExp; failWith?: string; password?: string; dbUrl?: string }) {
  const { connect, executed } = fakeClient(options)
  const printed: string[] = []
  const code = await prepareDatabase({
    dbUrl: options.dbUrl ?? "postgresql://admin@db.example.invalid:5432/app",
    password: options.password ?? randomBytes(12).toString("hex"),
    print: (line) => printed.push(line),
    printError: (line) => printed.push(line),
    connect,
  })
  return { code, executed, printed: printed.join("\n") }
}

describe("oto-platform db prepare", () => {
  it("should only create platform_app and platform_server on Supabase, platform_app login and noinherit, member of anon, authenticated and platform_server, platform_server nologin and member of authenticated, neither bypassrls nor createrole, and say so (AC11)", async () => {
    const plan = codeOf(preparePlan(true))
    expect(plan.match(/'create role [^']*'/g)).toEqual(["'create role platform_app login noinherit nocreatedb nocreaterole nobypassrls password %L'"])
    expect(plan.match(/^\s*create role [^;]*;/gm)?.map((statement) => statement.trim())).toEqual(["create role platform_server nologin inherit nocreatedb nocreaterole nobypassrls;"])
    expect(plan).toContain("array['anon', 'authenticated']")
    expect(plan).toContain("grant %I to platform_app")
    expect(plan).toContain("array[array['authenticated', 'platform_server'], array['platform_server', 'platform_app']]")
    expect(plan).not.toMatch(/authenticator/i)
    expect(plan).not.toMatch(/create (schema|extension|function)/i)

    const { code, executed, printed } = await prepare({ supabase: true })
    expect(code).toBe(0)
    expect(executed.slice(2).map(({ query }) => query)).toEqual(preparePlan(true))
    expect(printed).toContain("seuls les rôles platform_app et platform_server sont préparés")
  })

  it("should prepare a bare Postgres once: roles, the auth schema reading request.jwt.claims, the extensions schema with its three extensions, then platform_app, checking each object before creating it (AC10)", async () => {
    const statements = preparePlan(false)
    const plan = codeOf(statements)
    for (const created of [
      "create role %I nologin",
      "create schema auth",
      "create function auth.uid() returns uuid",
      "create function auth.jwt() returns jsonb",
      "create function auth.role() returns text",
      "create schema extensions",
      "array['pg_trgm', 'unaccent', 'ltree']",
      "create extension %I with schema extensions",
      "create role platform_app",
    ]) {
      expect(plan, created).toContain(created)
    }
    expect(plan.match(/current_setting\('request\.jwt\.claims', true\)/g)).toHaveLength(3)
    expect(plan).not.toMatch(/moddatetime|auth\.users|create table/i)
    // Un second passage ne change rien : chaque instruction regarde d'abord ce qui existe.
    expect(statements.filter((statement) => !/if (not )?exists|is null then/i.test(statement))).toEqual([])

    const { code, executed } = await prepare({ supabase: false })
    expect(code).toBe(0)
    expect(executed.slice(2).map(({ query }) => query)).toEqual(statements)
  })

  it("should pass PLATFORM_APP_PASSWORD as a parameter only, and never print it nor the password of the URL, even in an error", async () => {
    const password = randomBytes(12).toString("hex")
    const urlPassword = randomBytes(12).toString("hex")
    // Construite à l'exécution : une URL à mot de passe écrite en clair, le contrôle pré-public la refuse.
    const url = new URL("postgresql://db.example.invalid:5432/app")
    url.username = "admin"
    url.password = urlPassword
    const { code, executed, printed } = await prepare({
      supabase: false,
      password,
      dbUrl: url.toString(),
      failOn: /grant %I to platform_app/,
      failWith: `connection to ${url.toString()} failed while granting with ${password}`,
    })
    expect(code).toBe(1)
    const withSecret = (value: unknown) => [password, urlPassword].some((secret) => String(JSON.stringify(value)).includes(secret))
    expect(executed.filter(({ query }) => withSecret(query)).map(({ query }) => query)).toEqual([])
    expect(executed.filter(({ params }) => withSecret(params)).map(({ query }) => query)).toEqual([
      "select pg_catalog.set_config('oto_platform.app_password', $1, true)",
    ])
    expect(Object.entries({ password, urlPassword }).filter(([, secret]) => printed.includes(secret)).map(([name]) => name)).toEqual([])
    expect(printed).toContain(`db prepare : connection to ${url.toString().replace(urlPassword, "***")} failed while granting with ***`)
  })

  // postgres.js se connecte en clair sans `sslmode` dans l'URL, et l'URI directe de Supabase n'en porte
  // pas ; une erreur relevée telle quelle dans un bloc `do` cite son instruction au journal du serveur.
  it("should keep PLATFORM_APP_PASSWORD off the wire and out of the server log: TLS unless the URL names its sslmode, a refused role creation raised without its statement", async () => {
    const { connect } = fakeClient({ supabase: true })
    const seen: (string | null)[] = []
    for (const dbUrl of ["postgresql://admin@db.example.invalid:5432/app", "postgresql://admin@localhost:5432/app?sslmode=disable"]) {
      const code = await prepareDatabase({
        dbUrl,
        password: randomBytes(12).toString("hex"),
        print: () => {},
        printError: () => {},
        connect: (_url: string, options: { ssl?: string }) => {
          seen.push(options.ssl ?? null)
          return connect()
        },
      })
      expect(code).toBe(0)
    }
    expect(seen).toEqual(["require", null])
    const refused = await prepare({ supabase: true, failOn: /./, failWith: "Client network socket disconnected before secure TLS connection was established" })
    expect(refused.printed).toContain("(TLS exigé : ?sslmode=disable dans l'URL pour un Postgres sans TLS)")
    expect(codeOf(preparePlan(true))).toContain("raise exception 'rôle platform_app refusé par l''hôte : %', sqlerrm")
  })

  it("should stop on an extension the host refuses, naming it, with code 1 (AC10)", async () => {
    expect(codeOf(preparePlan(false))).toContain("raise exception 'extension % refusée par l''hôte : %', v_extension, sqlerrm")

    const { code, printed } = await prepare({
      supabase: false,
      failOn: /create extension %I/,
      failWith: "extension unaccent refusée par l'hôte : extension \"unaccent\" is not allow-listed",
    })
    expect(code).toBe(1)
    expect(printed).toContain("db prepare : extension unaccent refusée par l'hôte")
  })

  it("should refuse db prepare without --db-url, with the usage and code 2", () => {
    const run = spawnSync(process.execPath, [bin, "db", "prepare"], { encoding: "utf8", timeout: 20_000 })
    expect(run.status).toBe(2)
    expect(run.stderr.startsWith("oto-platform : « db prepare » attend --db-url <url>")).toBe(true)
    expect(run.stderr).toContain("db prepare --db-url <url>")
  })
})
