// @vitest-environment node
// `oto-platform comments notify` sans base : l'usage, et ce que la commande rend avant toute connexion (hôte sans
// relais, adresse de relais illisible), sans rien du mot de passe de la base ni du relais. Le passage lui-même se joue
// sur une vraie base (`tests/integration/commentaires-email.test.ts`). Mots de passe tirés à l'exécution.
import { spawnSync } from "child_process"
import { randomBytes } from "crypto"
import path from "path"
import { describe, expect, it } from "vitest"
import { commentsNotifyCommand } from "../../packages/plateforme/cli/comments-notify.mjs"

const bin = path.resolve(__dirname, "../../packages/plateforme/cli/bin.mjs")

async function run(env: Record<string, string>) {
  // L'adresse à mot de passe se compose à l'exécution, sans sa forme en littéral, que `check-public` refuse.
  const dbUrl = new URL("postgresql://db.example.invalid:5432/app")
  dbUrl.username = "admin"
  dbUrl.password = randomBytes(8).toString("hex")
  const printed: string[] = []
  let connected = false
  const code = await commentsNotifyCommand({
    dbUrl: dbUrl.toString(),
    env,
    print: (line) => printed.push(line),
    printError: (line) => printed.push(line),
    // `as never` : la doublure ne rend aucun client, elle prouve qu'aucune connexion n'est ouverte.
    connect: (() => {
      connected = true
      throw new Error("no connection expected")
    }) as never,
  })
  return { code, connected, printed, password: dbUrl.password }
}

describe("oto-platform comments notify", () => {
  it("should ask for the address of the database (code 2)", () => {
    // Sans l'adresse que les suites portables posent dans leur environnement (`cli-db-url.test.ts`).
    const result = spawnSync(process.execPath, [bin, "comments", "notify"], { encoding: "utf8", env: { ...process.env, PLATFORM_ADMIN_DATABASE_URL: undefined } })

    expect([result.status, result.stderr.split("\n")[0]]).toEqual([
      2,
      "oto-platform : « comments notify » : adresse de la base absente : PLATFORM_ADMIN_DATABASE_URL dans l'environnement, ou --db-url <url> sans mot de passe",
    ])
  })

  it("should say that the host has no relay, send nothing, open no connection and exit 0 (AC4)", async () => {
    const none = await run({})
    const half = await run({ PLATFORM_MAIL_FROM: "Acme <no-reply@example.invalid>" })

    expect([none.code, none.connected, none.printed]).toEqual([
      0,
      false,
      ["comments notify : aucun relais d'envoi (PLATFORM_SMTP_URL, PLATFORM_MAIL_FROM absente(s) de l'environnement) : aucun email envoyé, rien n'est marqué comme envoyé."],
    ])
    expect([half.code, half.connected, half.printed]).toEqual([
      0,
      false,
      ["comments notify : aucun relais d'envoi (PLATFORM_SMTP_URL absente(s) de l'environnement) : aucun email envoyé, rien n'est marqué comme envoyé."],
    ])
  })

  it("should refuse an unreadable relay address before any connection, without writing it (code 1)", async () => {
    const relayPassword = randomBytes(8).toString("hex")
    const result = await run({ PLATFORM_SMTP_URL: `relay.example.invalid:587?secret=${relayPassword}`, PLATFORM_MAIL_FROM: "Acme <no-reply@example.invalid>" })

    expect([result.code, result.connected, result.printed]).toEqual([1, false, ["comments notify : PLATFORM_SMTP_URL n'est pas une adresse smtp:// ou smtps:// lisible"]])
    expect(result.printed.join("\n")).not.toContain(relayPassword)
  })
})
