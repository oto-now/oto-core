// @vitest-environment node
import fs from "fs"
import os from "os"
import path from "path"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { checkMigrations } from "../../packages/plateforme/cli/migrations-check.mjs"

/**
 * `migrations check`, le droit d'exécuter une fonction suivi de fichier en fichier (`cli/migrations-execute-grants.mjs`) :
 * un fichier qui redéfinit une fonction existante ne donne `EXECUTE` à aucun rôle de plus qu'avant lui. Jugé sur le
 * droit que Postgres applique : `create or replace` garde le droit d'avant, une fonction recréée après `drop`
 * s'exécute par `public`, `public` couvre tous les rôles.
 */

let dir: string
/** La sortie complète du dernier `check`. */
let output = ""

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "migrations-execute-grants-"))
})

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** Les élargissements que `migrations check` relève sur ces fichiers, dans cet ordre : `<version>:<ligne> <règle>`. */
function check(...sql: string[]): string[] {
  const at = fs.mkdtempSync(path.join(dir, "cas-"))
  const files = sql.map((text, index) => {
    const file = path.join(at, `2026102${index}000000_m.sql`)
    fs.writeFileSync(file, text)
    return file
  })
  const lines: string[] = []
  vi.spyOn(console, "log").mockImplementation((line: string) => lines.push(line))
  vi.spyOn(console, "error").mockImplementation(() => {})
  checkMigrations({ files })
  output = lines.join("\n")
  return lines
    .filter((line) => line.includes(" function-execute-widened"))
    .map((line) => line.replace(/^.*\/(\d+)_m\.sql:/, "$1:").replace(/ — .*$/, ""))
}

/** Une fonction de `platform`, son corps et ses arguments au choix. */
const fn = (name: string, args = "p_org uuid", replace = true) =>
  `${replace ? "create or replace" : "create"} function platform.${name}(${args}) returns void language sql as $$ select 1 $$;\n`

// La première version de la fonction, réservée au rôle serveur (la forme de `20261019130000`).
const SERVER_ONLY = `${fn("purge_transit_files")}revoke all on function platform.purge_transit_files(p_org uuid) from public, anon, authenticated;
grant execute on function platform.purge_transit_files(p_org uuid) to platform_server;
`

describe("migrations check, EXECUTE of a redefined function", () => {
  // Le cas du 21/10/2026 : la redéfinition recopie le droit d'une autre fonction.
  it("should refuse a redefinition that grants EXECUTE to a role the function did not have, on the line of its create", () => {
    const widened = `-- trace des fichiers effacés
${fn("purge_transit_files")}revoke all on function platform.purge_transit_files(p_org uuid) from public;
grant execute on function platform.purge_transit_files(p_org uuid) to authenticated;
`
    expect(check(SERVER_ONLY, widened)).toEqual(["20261021000000:2 function-execute-widened"])
    expect(output).toContain(
      "function-execute-widened — platform.purge_transit_files(uuid) : EXECUTE donné à authenticated, que la fonction n'avait pas avant ce fichier ; " +
        "une redéfinition garde le droit de la fonction. Élargissement voulu : un `grant` seul, dans une migration qui ne redéfinit pas la fonction",
    )
  })

  it("should accept a redefinition that keeps or narrows the right, or says nothing of it", () => {
    const same = `${fn("purge_transit_files")}revoke all on function platform.purge_transit_files(p_org uuid) from public, anon, authenticated;
grant execute on function platform.purge_transit_files(p_org uuid) to platform_server;
`
    const silent = `${fn("purge_transit_files")}revoke all on function platform.purge_transit_files(uuid) from public;\n`
    const narrowed = `${fn("purge_transit_files")}revoke all on function platform.purge_transit_files(uuid) from public, platform_server;\n`
    expect(check(SERVER_ONLY, same, silent, narrowed)).toEqual([])
  })

  it("should judge a function dropped then recreated in a file against its right before the drop", () => {
    const recreated = `drop function if exists platform.purge_transit_files(uuid);
${fn("purge_transit_files", "p_org uuid", false)}revoke all on function platform.purge_transit_files(p_org uuid) from public;
grant all on function platform.purge_transit_files(p_org uuid) to platform_server, anon;
`
    // Recréée sans revoke, elle s'exécute par `public` : un élargissement aussi.
    const publicAgain = `drop function platform.purge_transit_files(uuid);\n${fn("purge_transit_files", "p_org uuid", false)}`
    expect(check(SERVER_ONLY, recreated)).toEqual(["20261021000000:2 function-execute-widened"])
    expect(check(SERVER_ONLY, publicAgain)).toEqual(["20261021000000:2 function-execute-widened"])
  })

  it("should accept a grant alone in a file that does not redefine the function, a new function, and a function executable by public before", () => {
    const grantAlone = "grant execute on function platform.purge_transit_files(uuid) to authenticated;\n"
    const created = `${fn("leads_team", "p_team uuid")}revoke all on function platform.leads_team(uuid) from public;
grant execute on function platform.leads_team(uuid) to authenticated;
`
    const open = `${fn("forbid_prefix_change", "")}`
    const reopened = `${fn("forbid_prefix_change", "")}grant execute on function platform.forbid_prefix_change() to anon;\n`
    expect(check(SERVER_ONLY, grantAlone, created)).toEqual([])
    expect(check(open, reopened)).toEqual([])
  })

  it("should tell an overload by its argument types, written with names, aliases, modifiers, defaults and out parameters", () => {
    const first = `${fn("search", "p_org uuid, p_query varchar(80), p_limit int default 10, out p_total bigint")}revoke all on function platform.search(uuid, character varying, integer) from public;\n`
    const overloads = `${fn("search", "p_org uuid, p_query text")}revoke all on function platform.search(uuid, text) from public;\n${SERVER_ONLY}`
    const widened = `${fn("search", "p_org uuid, p_query character varying(80), p_limit integer = 5, out p_total bigint")}grant execute on function platform.search(uuid, varchar, int4) to anon;\n`
    expect(check(first, overloads, widened)).toEqual(["20261022000000:1 function-execute-widened"])
  })
})
