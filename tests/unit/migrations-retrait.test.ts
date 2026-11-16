// @vitest-environment node
// Le retrait déclaré, second temps d'un expand/contract sur base partagée (database-patterns.md § Expand/contract sur
// base partagée) : une opération non additive n'est admise que nommée par une mention `-- retrait:` de l'en-tête, à une
// version étiquetée d'oto-core. Les règles sans mention : `tests/unit/migrations-guard.test.ts`.
import { execFileSync, spawnSync } from "child_process"
import fs from "fs"
import os from "os"
import path from "path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { reunirMigrations } from "../../scripts/lib/reunion-des-migrations.mjs"

const root = path.resolve(__dirname, "../..")
const bin = path.join(root, "packages/plateforme/cli/bin.mjs")

let dir: string

// Une variable GIT_* (crochet de commit, index temporaire) ferait lire à `git -C` un autre dépôt que celui du fichier.
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_"))) as NodeJS.ProcessEnv

/** `oto-platform migrations check` sur des fichiers, avec les options données, depuis `cwd`. */
function check(files: string[], options: string[] = [], cwd = root) {
  const args = [bin, "migrations", "check", ...files.flatMap((file) => ["--file", file]), ...options]
  const result = spawnSync(process.execPath, args, { cwd, encoding: "utf8", env })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

/** Les erreurs de la sortie texte, sans le chemin : `ligne règle — explication`. */
const errorsOf = (stdout: string) => stdout.split("\n").filter(Boolean).map((line) => line.replace(/^.*\.sql:/, ""))

/** Un fichier de migration dans un dossier neuf hors de tout dépôt git. */
function fixture(sql: string, name = "20261120090000_platform_retrait.sql", into = fs.mkdtempSync(path.join(dir, "sql-"))) {
  const file = path.join(into, name)
  fs.writeFileSync(file, sql)
  return file
}

/** Un dépôt git jetable qui porte les étiquettes données. */
function repoWithTags(tags: string[]) {
  const repo = fs.mkdtempSync(path.join(dir, "repo-"))
  // Sans la configuration du poste (signature des commits et des étiquettes, qui ouvrirait un éditeur).
  const gitEnv = { ...env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" }
  const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { env: gitEnv, stdio: "pipe" })
  git("init", "-q")
  git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "--allow-empty", "-m", "racine")
  for (const tag of tags) git("tag", tag)
  return repo
}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "migrations-retrait-"))
})

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

const TAGS = ["--tags", "v1.7.0,v1.8.0"]

describe("retrait déclaré", () => {
  it("should keep today's rule names when the file declares nothing", () => {
    const result = check([fixture("alter table platform.orgs drop column name;\n")], TAGS)
    expect(result.status).toBe(1)
    expect(errorsOf(result.stdout)).toEqual(["1 drop-column"])
  })

  it("should accept every non-additive operation that the mention names, each mapped to its object", () => {
    const sql = [
      "-- Le second temps du retrait.",
      "-- retrait: platform.orgs.name, platform.old_items, platform.orgs.title ; plus lu depuis v1.7.0",
      "-- retrait: platform.idx_items_label, platform.label_of, platform.orgs_label_check, platform.items_select ; plus lu depuis v1.8.0",
      "-- retrait: platform.items_touch, platform.orgs.kind, platform.orgs.size, platform.orgs.note, platform.orgs ; plus lu depuis v1.8.0",
      "alter table platform.orgs drop column name;",
      "drop table if exists platform.old_items;",
      "alter table platform.orgs rename column title to label;",
      "drop index platform.idx_items_label;",
      "drop function platform.label_of(uuid, varchar(80));",
      "alter table platform.orgs drop constraint orgs_label_check;",
      "drop policy items_select on platform.items;",
      "drop trigger items_touch on platform.items;",
      "alter table platform.orgs alter column kind set not null, alter column size type bigint;",
      "alter table platform.orgs alter column note drop default;",
      "alter table platform.orgs rename to organisations;",
      "",
    ].join("\n")
    const result = check([fixture(sql)], TAGS)
    expect(result.stdout).toBe("check:migrations — 1 fichier(s) conforme(s)\n")
    expect(result.status).toBe(0)
  })

  it("should read quoted and unquoted names alike, as the check reads SQL", () => {
    const sql = '-- retrait: platform."Notes".body ; plus lu depuis v1.8.0\nalter table platform."Notes" drop column "body";\n'
    expect(check([fixture(sql)], TAGS).status).toBe(0)
  })

  it("should refuse an operation outside the mention, and one whose object cannot be determined, naming it", () => {
    const sql = [
      "-- retrait: platform.orgs.name ; plus lu depuis v1.8.0",
      "alter table platform.orgs drop column name, drop column slug;",
      "drop table platform.a, public.b;",
      "do $$ begin drop table platform.z; end $$;",
      "",
    ].join("\n")
    const result = check([fixture(sql)], TAGS)
    expect(result.status).toBe(1)
    expect(errorsOf(result.stdout)).toEqual([
      "2 retrait-uncovered — drop-column de platform.orgs.slug, absent de la mention de retrait",
      "3 retrait-uncovered — drop : objet indéterminé, qu'aucune mention ne peut couvrir",
      "4 retrait-uncovered — drop : objet indéterminé, qu'aucune mention ne peut couvrir",
    ])
  })

  it("should refuse a malformed mention, a version that is not vX.Y.Z or not a tag, and an object the file does not remove", () => {
    const sql = [
      "-- retrait: platform.orgs.name",
      "-- retrait: public.orgs.slug ; plus lu depuis v1.8.0",
      "-- retrait: platform.orgs.slug ; plus lu depuis 1.8",
      "-- retrait: platform.orgs.kind, platform.orgs.size ; plus lu depuis v1.9.0",
      "alter table platform.orgs drop column name, drop column slug, drop column kind;",
      "",
    ].join("\n")
    const result = check([fixture(sql)], TAGS)
    expect(result.status).toBe(1)
    expect(errorsOf(result.stdout)).toEqual([
      "1 retrait-malformed — attendu « -- retrait: platform.<objet>[, platform.<objet>…] ; plus lu depuis vX.Y.Z »",
      "2 retrait-malformed — objet « public.orgs.slug » : attendu platform.<nom> ou platform.<table>.<colonne>",
      "3 retrait-malformed — version « 1.8 » : attendu vX.Y.Z",
      "4 retrait-untagged — v1.9.0 n'est pas une étiquette d'oto-core",
      "4 retrait-unused — platform.orgs.size : le fichier ne le retire pas",
      "5 retrait-uncovered — drop-column de platform.orgs.name, absent de la mention de retrait",
    ])
  })

  it("should read a mention only in the header, before the first statement", () => {
    const sql = "select 1;\n-- retrait: platform.orgs.name ; plus lu depuis v1.8.0\nalter table platform.orgs drop column name;\n"
    expect(errorsOf(check([fixture(sql)], TAGS).stdout)).toEqual(["3 drop-column"])
  })

  it("should read the tags of the git repository that holds the file, and refuse to guess without one", () => {
    const sql = "-- retrait: platform.orgs.name ; plus lu depuis v1.8.0\nalter table platform.orgs drop column name;\n"
    const tagged = fixture(sql, undefined, repoWithTags(["v1.7.0", "v1.8.0"]))
    expect(check([tagged]).status).toBe(0)
    const older = fixture(sql, undefined, repoWithTags(["v1.7.0"]))
    expect(errorsOf(check([older]).stdout)).toEqual(["1 retrait-untagged — v1.8.0 n'est pas une étiquette d'oto-core"])
    // Le paquet installé dans `node_modules` d'un hôte : un dossier que le dépôt de l'hôte ignore n'est pas le sien.
    const host = repoWithTags(["v1.8.0"])
    fs.writeFileSync(path.join(host, ".gitignore"), "node_modules/\n")
    fs.mkdirSync(path.join(host, "node_modules"))
    const installed = fixture(sql, undefined, path.join(host, "node_modules"))
    expect(errorsOf(check([installed]).stdout)).toEqual([expect.stringMatching(/^1 retrait-untagged-unverifiable — /)])
    const outside = check([fixture(sql)])
    expect(errorsOf(outside.stdout)).toEqual(["1 retrait-untagged-unverifiable — v1.8.0 : étiquettes introuvables, ni dépôt git autour du fichier, ni --tags"])
    // Un fichier sans mention n'a jamais besoin d'étiquettes.
    expect(check([fixture("create table platform.items (id uuid primary key);\n")]).status).toBe(0)
  })

  it("should print one JSON object with --json: each file, its retraits and errors, and the highest declared version", () => {
    const first = fixture("-- retrait: platform.orgs.name ; plus lu depuis v1.7.0\nalter table platform.orgs drop column name;\n")
    const second = fixture("-- retrait: platform.orgs.slug ; plus lu depuis v1.10.0\nalter table platform.orgs drop column slug;\n", "20261121090000_platform_retrait.sql")
    const ok = check([first, second], ["--json", "--tags", "v1.7.0,v1.10.0"], dir)
    expect(ok.status).toBe(0)
    expect(ok.stderr).toBe("")
    expect(JSON.parse(ok.stdout)).toEqual({
      ok: true,
      files: [
        { file: path.relative(dir, first), retraits: [{ line: 1, objects: ["platform.orgs.name"], since: "v1.7.0" }], errors: [] },
        { file: path.relative(dir, second), retraits: [{ line: 1, objects: ["platform.orgs.slug"], since: "v1.10.0" }], errors: [] },
      ],
      requires: "v1.10.0",
    })
    const refused = check([fixture("alter table platform.orgs drop column name;\n")], ["--json"])
    expect(refused.status).toBe(1)
    expect(JSON.parse(refused.stdout)).toMatchObject({ ok: false, requires: null, files: [{ retraits: [], errors: [{ line: 1, rule: "drop-column", detail: null }] }] })
  })

  it("should refuse an empty tag in --tags as a usage error", () => {
    const result = check([fixture("select 1;\n")], ["--tags", "v1.7.0,"])
    expect(result.status).toBe(2)
    expect(result.stderr.startsWith("oto-platform : l'option « --tags » attend des étiquettes séparées par des virgules")).toBe(true)
  })
})

describe("réunion des migrations d'une version", () => {
  const first = "-- La première partie.\ncreate table platform.items (id uuid primary key);\n"
  const second = "-- La seconde partie.\n-- retrait: platform.orgs.name ; plus lu depuis v1.8.0\nalter table platform.orgs drop column name;\n"
  const parts = [
    { name: "20261121090000_platform_retrait.sql", sql: second },
    { name: "20261120090000_platform_items.sql", sql: first },
  ]

  it("should concatenate the parts in timestamp order, unchanged, and copy their retrait mentions into the header", () => {
    const merged = reunirMigrations({ version: "1.9.0", parts })
    const [header] = merged.split("\n-- ====")
    expect(header).toContain("-- retrait: platform.orgs.name ; plus lu depuis v1.8.0")
    expect(merged.indexOf(first)).toBeGreaterThan(-1)
    expect(merged.indexOf(second)).toBeGreaterThan(merged.indexOf(first))
    expect(merged).toContain("-- Partie 2 sur 2 : écrite en 20261121090000_platform_retrait.sql.")
    expect(check([fixture(merged, "20261122090000_v1_9_0.sql")], TAGS).status).toBe(0)
    // Sans la copie, la mention de la seconde partie tombe dans le corps : son retrait n'est plus couvert.
    const lost = merged.replace(/^(-- retrait: .*\n)(?=[\s\S]*Partie 1)/m, "")
    expect(errorsOf(check([fixture(lost, "20261122090000_v1_9_0.sql")], TAGS).stdout)).toEqual([expect.stringMatching(/^\d+ drop-column$/)])
  })

  it("should refuse a malformed version or part name", () => {
    expect(() => reunirMigrations({ version: "v1.9.0", parts })).toThrow("version « v1.9.0 » : attendu X.Y.Z")
    expect(() => reunirMigrations({ version: "1.9.0", parts: [{ name: "retrait.sql", sql: first }] })).toThrow("« retrait.sql » : attendu <horodatage>_<sujet>.sql")
  })
})
