// @vitest-environment node
// `oto-platform org delete` sans base (`administration-et-cellule.md` § Suppression d'une organisation) : l'usage, et
// les refus rendus avant toute connexion (stockage absent ou contradictoire, slug mal écrit, adresse du bucket), sans
// rien du mot de passe de l'URL ni de la clé du stockage. La suppression elle-même se joue sur une vraie base
// (`tests/integration/suppression-organisation.test.ts`). Clés tirées à l'exécution.
import { spawnSync } from "child_process"
import { randomBytes } from "crypto"
import path from "path"
import { describe, expect, it } from "vitest"
import { orgDeleteCommand } from "../../packages/plateforme/cli/org-delete.mjs"
import { bucketObjects, STORAGE_VARIABLES } from "../../packages/plateforme/cli/storage.mjs"

const bin = path.resolve(__dirname, "../../packages/plateforme/cli/bin.mjs")

function cli(args: string[]) {
  const result = spawnSync(process.execPath, [bin, ...args], { encoding: "utf8" })
  return { code: result.status, stderr: result.stderr }
}

async function run(options: { org?: string; withoutStorage?: boolean; env?: Record<string, string> }) {
  const password = randomBytes(8).toString("hex")
  const printed: string[] = []
  let connected = false
  const code = await orgDeleteCommand({
    dbUrl: `postgresql://admin:${password}@db.example.invalid:5432/app`,
    org: options.org ?? "acme",
    yes: true,
    by: "staff@example.invalid",
    withoutStorage: options.withoutStorage ?? false,
    env: options.env ?? {},
    print: (line) => printed.push(line),
    printError: (line) => printed.push(line),
    connect: (() => {
      connected = true
      throw new Error("no connection expected")
    }) as never,
  })
  return { code, connected, printed: printed.join("\n"), password }
}

const storageEnv = (endpoint = "https://s3.example.invalid") => ({
  PLATFORM_STORAGE_ENDPOINT: endpoint,
  PLATFORM_STORAGE_BUCKET: "plateforme",
  PLATFORM_STORAGE_REGION: "fr-par",
  PLATFORM_STORAGE_ACCESS_KEY_ID: `AK${randomBytes(4).toString("hex")}`,
  PLATFORM_STORAGE_SECRET_ACCESS_KEY: randomBytes(16).toString("hex"),
})

describe("oto-platform org delete", () => {
  it("should ask for --db-url and --org, and for --by with --yes (code 2)", () => {
    expect([cli(["org", "delete"]), cli(["org", "delete", "--db-url", "postgresql://x", "--org", "acme", "--yes"])].map(({ code, stderr }) => [code, stderr.split("\n")[0]])).toEqual([
      [2, "oto-platform : « org delete » attend --db-url <url> et --org <slug>"],
      [2, "oto-platform : « org delete --yes » attend --by <email>"],
    ])
  })

  it("should refuse, before any connection, a missing storage, --without-storage with the variables set, and a slug that is not one", async () => {
    const missing = await run({})
    const contradictory = await run({ withoutStorage: true, env: storageEnv() })
    const slug = await run({ org: "Acme Corp", env: storageEnv() })
    expect([missing, contradictory, slug].map(({ code, connected, printed }) => ({ code, connected, printed }))).toEqual([
      { code: 1, connected: false, printed: `org delete : stockage non configuré : posez ${STORAGE_VARIABLES.join(", ")}, ou --without-storage pour un hôte sans stockage` },
      { code: 1, connected: false, printed: `org delete : --without-storage, mais ${STORAGE_VARIABLES.join(", ")} sont posées` },
      { code: 1, connected: false, printed: "org delete : --org attend le slug d'une organisation (« Acme Corp »)" },
    ])
  })

  it("should name what is wrong in the bucket address, never a key", async () => {
    const env = storageEnv("ftp://s3.example.invalid/")
    const refused = await run({ env })
    expect({ code: refused.code, printed: refused.printed }).toEqual({ code: 1, printed: "org delete : PLATFORM_STORAGE_ENDPOINT is not an http(s) address" })
    expect(bucketObjects({ endpoint: "https://s3.example.invalid//", bucket: "a b", region: "r", accessKeyId: "k", secretAccessKey: "s" })).toHaveProperty("store")
  })
})
