// @vitest-environment node
// L'adresse de la base des commandes à connexion d'administration (`db prepare`, `accounts secret`, `journal purge`,
// `org delete`) : lue dans PLATFORM_ADMIN_DATABASE_URL, ou par --db-url sans mot de passe (PGPASSWORD, que lit
// postgres.js). Un mot de passe en argument se lit dans `ps` et l'historique du shell : refusé, sans le réécrire.
// Les adresses à mot de passe se composent à l'exécution, sans leur forme en littéral, que `check-public` refuse.
import { spawnSync } from "child_process"
import { randomBytes } from "crypto"
import path from "path"
import { describe, expect, it } from "vitest"
import { adminDbUrl } from "../../packages/plateforme/cli/admin-url.mjs"

const bin = path.resolve(__dirname, "../../packages/plateforme/cli/bin.mjs")

/** Une adresse au mot de passe tiré à l'exécution, et ce mot de passe. */
function urlWithPassword(base = "postgresql://db.example.invalid:5432/app") {
  const url = new URL(base)
  url.username = "admin"
  url.password = randomBytes(8).toString("hex")
  return { url: url.toString(), password: url.password }
}

/** La CLI, dans un environnement choisi : sans l'adresse que les suites portables posent dans le leur. */
function cli(args: string[], env: Record<string, string> = {}) {
  // Une valeur `undefined` n'est pas transmise au processus fils.
  const inherited = { ...process.env, PLATFORM_ADMIN_DATABASE_URL: undefined, PGPASSWORD: undefined }
  const result = spawnSync(process.execPath, [bin, ...args], { encoding: "utf8", timeout: 20_000, env: { ...inherited, ...env } })
  return { code: result.status, stderr: result.stderr, firstLine: result.stderr.split("\n")[0] }
}

// Un port où rien n'écoute, sans TLS : la commande admise va jusqu'à la connexion, qui échoue (code 1, pas 2).
const UNREACHABLE = "postgresql://admin@127.0.0.1:1/app?sslmode=disable"

const COMMANDS: string[][] = [
  ["db", "prepare"],
  ["accounts", "secret", "--account", "00000000-0000-4000-8000-000000000000"],
  ["journal", "purge", "--journal-days", "30"],
  ["org", "delete", "--org", "acme"],
]

describe("adminDbUrl", () => {
  it("should take --db-url without a password, and PLATFORM_ADMIN_DATABASE_URL alone, password included", () => {
    const withPassword = urlWithPassword().url
    expect(adminDbUrl({ flag: "postgresql://admin@db.example.invalid/app", env: {} })).toEqual({ url: "postgresql://admin@db.example.invalid/app" })
    expect(adminDbUrl({ flag: undefined, env: { PLATFORM_ADMIN_DATABASE_URL: withPassword } })).toEqual({ url: withPassword })
    expect(adminDbUrl({ flag: "postgresql://admin@db.example.invalid/app", env: { PLATFORM_ADMIN_DATABASE_URL: "" } })).toEqual({ url: "postgresql://admin@db.example.invalid/app" })
  })

  it("should refuse --db-url carrying a password, empty or in a parameter, without writing it back", () => {
    const { url, password } = urlWithPassword()
    const query = new URL("postgresql://admin@db.example.invalid/app")
    query.searchParams.set("password", randomBytes(8).toString("hex"))
    const inParameter = query.toString()
    const empty = "postgresql://admin" + ":" + "@db.example.invalid/app"
    // Un mot de passe que ni l'URL du WHATWG ni postgres.js ne lit (un « / » non encodé) reste un secret en argument.
    const slash = "postgresql://admin:" + randomBytes(4).toString("hex") + "/" + randomBytes(4).toString("hex") + "@db.example.invalid/app"
    for (const flag of [url, inParameter, empty, slash, "admin:" + randomBytes(4).toString("hex") + "@db.example.invalid/app"]) {
      const result = adminDbUrl({ flag, env: {} })
      expect(result, flag).toHaveProperty("problem")
      const problem = (result as { problem: string }).problem
      expect(problem).toContain("PLATFORM_ADMIN_DATABASE_URL")
      expect(problem).toContain("PGPASSWORD")
      expect(problem).not.toContain("db.example.invalid")
    }
    expect((adminDbUrl({ flag: url, env: {} }) as { problem: string }).problem).not.toContain(password)
  })

  it("should refuse both addresses, and none", () => {
    expect(adminDbUrl({ flag: "postgresql://admin@db.example.invalid/app", env: { PLATFORM_ADMIN_DATABASE_URL: urlWithPassword().url } })).toEqual({
      problem: "deux adresses de base : PLATFORM_ADMIN_DATABASE_URL et --db-url, gardez-en une",
    })
    expect(adminDbUrl({ flag: undefined, env: {} })).toEqual({
      problem: "adresse de la base absente : PLATFORM_ADMIN_DATABASE_URL dans l'environnement, ou --db-url <url> sans mot de passe",
    })
  })
})

describe("oto-platform, the address of the database", () => {
  it.each(COMMANDS)("should refuse %s %s with a password in --db-url, code 2, without the address nor the password", (...args) => {
    const { url, password } = urlWithPassword()
    const run = cli([...args, "--db-url", url])
    expect(run.code).toBe(2)
    expect(run.firstLine).toMatch(/^oto-platform : « \w+ \w+ » : --db-url porte un mot de passe/)
    expect(run.stderr).not.toContain(password)
    expect(run.stderr).not.toContain("db.example.invalid")
  })

  it.each(COMMANDS)("should refuse %s %s with both addresses, and with none (code 2)", (...args) => {
    const label = `« ${args[0]} ${args[1]} »`
    expect([cli([...args, "--db-url", UNREACHABLE], { PLATFORM_ADMIN_DATABASE_URL: UNREACHABLE }), cli(args)].map(({ code, firstLine }) => [code, firstLine])).toEqual([
      [2, `oto-platform : ${label} : deux adresses de base : PLATFORM_ADMIN_DATABASE_URL et --db-url, gardez-en une`],
      [2, `oto-platform : ${label} : adresse de la base absente : PLATFORM_ADMIN_DATABASE_URL dans l'environnement, ou --db-url <url> sans mot de passe`],
    ])
  })

  it("should connect with PLATFORM_ADMIN_DATABASE_URL alone, password included, never writing it", () => {
    const { url, password } = urlWithPassword(UNREACHABLE)
    const run = cli(["db", "prepare"], { PLATFORM_ADMIN_DATABASE_URL: url })
    expect(run.code).toBe(1)
    expect(run.firstLine).toMatch(/^db prepare : .*ECONNREFUSED/)
    expect(run.stderr).not.toContain(password)
  })

  it("should connect with --db-url without a password, PGPASSWORD set", () => {
    const run = cli(["db", "prepare", "--db-url", UNREACHABLE], { PGPASSWORD: randomBytes(8).toString("hex") })
    expect(run.code).toBe(1)
    expect(run.firstLine).toMatch(/^db prepare : .*ECONNREFUSED/)
  })
})
