// @vitest-environment node
import fs from "fs"
import path from "path"
import { describe, expect, it } from "vitest"

// AC7 (E01-S05) : la clé secrète sert l'outillage seulement (architecture § 4, ADR-006 § 3). Aucun
// fichier de code du paquet ni de l'hôte ne nomme la clé, le rôle `service_role` ou `scripts/`
// (où vit l'outillage) : un import du script Démo ou une lecture de la clé y seraient refusés ici.
// E01-S10 (AC-a9) : de même la connexion d'administration de la base, réservée aux tests et à
// l'outillage, sous ses deux noms (`SUPABASE_DB_URL` d'E01-S09 a la même valeur) ; le serveur ne se
// connecte que par `PLATFORM_DATABASE_URL`, rôle `platform_app`.

const root = path.resolve(__dirname, "../..")
const SCANNED = [
  "packages/plateforme/server",
  "packages/plateforme/api",
  "packages/plateforme/mcp",
  "packages/plateforme/ui",
  "packages/plateforme/schemas",
  "src",
]
const CODE_FILE = /\.(?:ts|tsx|js|mjs)$/
const FORBIDDEN = ["SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY", "service_role", "scripts/", "PLATFORM_ADMIN_DATABASE_URL", "SUPABASE_DB_URL"]

/** Fichiers de code sous `dir`, récursivement ; un dossier pas encore créé n'en a aucun. */
function codeFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return codeFiles(full)
    return CODE_FILE.test(entry.name) ? [full] : []
  })
}

/** Une entrée `fichier:ligne : mot` par mot interdit trouvé. */
function leaks(file: string, text: string): string[] {
  return text
    .split(/\r?\n/)
    .flatMap((line, index) => FORBIDDEN.filter((word) => line.includes(word)).map((word) => `${file}:${index + 1} : ${word}`))
}

const relative = (file: string) => path.relative(root, file).split(path.sep).join("/")

describe("service key kept out of the package and the host (AC7)", () => {
  const files = SCANNED.flatMap((dir) => codeFiles(path.join(root, dir)))

  it("should find no secret key name, service_role or scripts/ path in the code files of the package and of the host", () => {
    // Le parcours lit bien les deux : sans eux, la garde passerait à vide.
    expect(files.some((file) => relative(file).startsWith("packages/plateforme/server/"))).toBe(true)
    expect(files.some((file) => relative(file).startsWith("src/"))).toBe(true)
    const found = files.flatMap((file) => leaks(relative(file), fs.readFileSync(file, "utf8")))
    expect(found).toEqual([])
  })

  it("should flag service_role, the secret key names, the admin database connection and an import from scripts/, with its file and line", () => {
    const role = 'import { createClient } from "@supabase/supabase-js"\nconst role = "service_role"\n'
    expect(leaks("packages/plateforme/server/fixture.ts", role)).toEqual([
      "packages/plateforme/server/fixture.ts:2 : service_role",
    ])
    const text = [
      "const a = process.env.SUPABASE_SECRET_KEY",
      "const b = process.env.SUPABASE_SERVICE_ROLE_KEY",
      'import "../../scripts/demo-seed.mjs"',
      "const c = process.env.PLATFORM_ADMIN_DATABASE_URL",
      "const d = process.env.SUPABASE_DB_URL",
    ].join("\n")
    expect(leaks("src/fixture.ts", text)).toEqual([
      "src/fixture.ts:1 : SUPABASE_SECRET_KEY",
      "src/fixture.ts:2 : SUPABASE_SERVICE_ROLE_KEY",
      "src/fixture.ts:3 : scripts/",
      "src/fixture.ts:4 : PLATFORM_ADMIN_DATABASE_URL",
      "src/fixture.ts:5 : SUPABASE_DB_URL",
    ])
  })
})
