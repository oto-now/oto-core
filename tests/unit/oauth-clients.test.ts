// @vitest-environment node
import { execFileSync } from "child_process"
import path from "path"
import { describe, expect, it, vi } from "vitest"
import { deleteClients, formatClients, NOT_A_CANDIDATE, parseArgs, purgeCandidates, runCommand, USAGE } from "../../scripts/lib/oauth-clients.mjs"

// Le ménage des clients OAuth (E02-S04, AC13 à AC17) sans base : fonctions pures, et le déroulé des
// commandes sur une connexion simulée qui ne sait que lire l'activité et une API d'administration
// simulée qui ne sait que supprimer un client.

const script = path.resolve(__dirname, "../../scripts/oauth-clients.mjs")
const DAY = 24 * 60 * 60 * 1000
const NOW = Date.parse("2026-10-30T12:00:00Z")
const iso = (ms: number) => new Date(ms).toISOString()

type ClientRow = Parameters<typeof formatClients>[0][number]

function client(overrides: Partial<ClientRow> = {}): ClientRow {
  return {
    client_id: "0f3a9c1e-5b7d-4e2a-9c8b-1d2e3f4a5b6c",
    client_name: "Claude",
    client_type: "confidential",
    registration_type: "dynamic",
    created_at: iso(NOW - 60 * DAY),
    sessions: 0,
    last_activity: null,
    ...overrides,
  }
}

/**
 * La connexion d'administration simulée : la requête exécutée rend l'activité des clients, chaque
 * ligne sous `row`, comme `to_json` de `jsonRows` ; le fragment qu'elle enveloppe n'est jamais exécuté.
 */
function activite(rows: ClientRow[]) {
  return async () => rows.map((row) => ({ row }))
}

/**
 * La connexion simulée qui lit l'activité, et une API d'administration d'Auth simulée dont
 * `deleteClient` refuse `refuses`.
 */
function fakeAdmin(rows: ClientRow[], refuses: string[] = []) {
  const deleted: string[] = []
  const admin = {
    auth: {
      admin: {
        oauth: {
          deleteClient: async (id: string) => {
            if (refuses.includes(id)) return { data: null, error: { code: "unexpected_failure", status: 500 } }
            deleted.push(id)
            return { data: null, error: null }
          },
        },
      },
    },
  }
  // Seules la lecture et la suppression sont simulées : les types de la connexion et du client complets
  // ne s'en infèrent pas.
  const db = { sql: activite(rows), admin } as unknown as Parameters<typeof runCommand>[0]
  return { db, admin: admin as unknown as Parameters<typeof deleteClients>[0], deleted }
}

function sorties() {
  return { log: vi.fn<(line: string) => void>(), error: vi.fn<(line: string) => void>() }
}

describe("oauth:clients list (AC13)", () => {
  it("should write a text table of the named columns only, newest activity first, then newest creation", () => {
    const secret = { ...client({ client_id: "c3d4e5f6-0000-4000-8000-000000000003", client_name: null, client_type: "public", registration_type: "manual", created_at: "2026-09-15T12:00:00Z" }), client_secret_hash: "hash-a-ne-jamais-ecrire" }
    const rows = [
      client({ client_id: "a1b2c3d4-0000-4000-8000-000000000001", created_at: "2026-09-01T08:00:00Z", sessions: 2, last_activity: "2026-09-20T10:30:00Z" }),
      secret,
      client({ client_id: "d4e5f6a7-0000-4000-8000-000000000004", client_name: "Claude Code", client_type: "public", created_at: "2026-09-05T08:00:00Z" }),
      client({ client_id: "b2c3d4e5-0000-4000-8000-000000000002", client_name: "ChatGPT", client_type: "public", created_at: "2026-09-10T09:00:00Z", sessions: 1, last_activity: "2026-09-25T14:00:00Z" }),
    ]

    const table = formatClients(rows)
    const [entete, trait, ...lignes] = table.split("\n")

    expect(entete.split(/\s{2,}/)).toEqual(["identifiant", "nom", "type", "enregistrement", "créé le", "sessions", "dernière activité"])
    expect(trait).toMatch(/^-+( {2}-+){6}$/)
    expect(lignes.map((ligne) => ligne.split(/\s{2,}/))).toEqual([
      ["b2c3d4e5", "ChatGPT", "public", "dynamique", "10/09/2026 11:00", "1", "25/09/2026 16:00"],
      ["a1b2c3d4", "Claude", "confidentiel", "dynamique", "01/09/2026 10:00", "2", "20/09/2026 12:30"],
      ["c3d4e5f6", "(sans nom)", "public", "manuel", "15/09/2026 14:00", "0", "jamais"],
      ["d4e5f6a7", "Claude Code", "public", "dynamique", "05/09/2026 10:00", "0", "jamais"],
    ])
    expect(table).not.toContain("hash-a-ne-jamais-ecrire")
  })

  it("should write « ? » for the control and format characters of a name, which anyone may register", () => {
    // Effacement de ligne, écriture du presse-papiers (OSC 52), saut de ligne, inversion bidi.
    const table = formatClients([client({ client_name: "Claude\u001b[2K\u001b]52;c;SGk=\u0007\n\u202eevil" })])
    const [, , ...lignes] = table.split("\n")

    expect(lignes).toHaveLength(1)
    expect(lignes[0].split(/\s{2,}/)[1]).toBe("Claude?[2K?]52;c;SGk=???evil")
    expect(table).not.toContain("\u001b")
  })

  it("should say that no client is registered, and exit 0", async () => {
    const out = sorties()

    expect(await runCommand(fakeAdmin([]).db, { command: "list" }, out, NOW)).toBe(0)
    expect(out.log.mock.calls).toEqual([["Aucun client enregistré."]])
  })
})

describe("oauth:clients purge without --yes (AC14)", () => {
  it("should show the candidates, say how many would go, exit 1 and delete nothing", async () => {
    const { db, deleted } = fakeAdmin([client({ client_id: "0a0a0a0a-0000-4000-8000-00000000000a" })])
    const out = sorties()

    expect(await runCommand(db, { command: "purge", olderThanDays: 30, yes: false }, out, NOW)).toBe(1)
    expect(out.log.mock.calls.map(([ligne]) => ligne)).toEqual([
      expect.stringContaining("0a0a0a0a"),
      "1 client(s) seraient supprimés. Relancez avec --yes pour les supprimer.",
    ])
    expect(deleted).toEqual([])
  })

  it("should say that no client is to be deleted, and exit 0", async () => {
    const out = sorties()

    expect(await runCommand(fakeAdmin([client({ created_at: iso(NOW - DAY) })]).db, { command: "purge", olderThanDays: 30, yes: false }, out, NOW)).toBe(0)
    expect(out.log.mock.calls).toEqual([["Aucun client à supprimer."]])
  })
})

describe("oauth:clients purge --yes (AC15)", () => {
  const A = "0a0a0a0a-0000-4000-8000-00000000000a"
  const B = "0b0b0b0b-0000-4000-8000-00000000000b"
  const C = "0c0c0c0c-0000-4000-8000-00000000000c"

  it("should delete each candidate, count them and exit 0", async () => {
    const { db, deleted } = fakeAdmin([client({ client_id: A }), client({ client_id: B })])
    const out = sorties()

    expect(await runCommand(db, { command: "purge", olderThanDays: 30, yes: true }, out, NOW)).toBe(0)
    expect(deleted).toEqual([A, B])
    expect(out.log.mock.calls.at(-1)).toEqual(["2 client(s) supprimé(s)."])
    expect(out.error).not.toHaveBeenCalled()
  })

  it("should go on after a refused deletion, list it by its id on stderr and exit 1", async () => {
    const { db, deleted } = fakeAdmin([client({ client_id: A }), client({ client_id: B }), client({ client_id: C })], [B])
    const out = sorties()

    expect(await runCommand(db, { command: "purge", olderThanDays: 30, yes: true }, out, NOW)).toBe(1)
    expect(deleted).toEqual([A, C])
    expect(out.error.mock.calls).toEqual([[`Suppression impossible : ${B} (unexpected_failure).`]])
    expect(out.log.mock.calls.at(-1)).toEqual(["2 client(s) supprimé(s)."])
  })
})

describe("oauth:clients purge candidates (AC16)", () => {
  it("should never take a manual client, one used or created within N days, and take one idle for exactly N days", () => {
    const exactement = iso(NOW - 30 * DAY)
    const rows = [
      client({ client_id: "manuel", registration_type: "manual" }),
      client({ client_id: "actif", sessions: 3, last_activity: iso(NOW - 30 * DAY + 1) }),
      client({ client_id: "recent", created_at: iso(NOW - 30 * DAY + 1) }),
      client({ client_id: "oublie", sessions: 2, last_activity: exactement }),
      client({ client_id: "jamais-servi", created_at: exactement }),
    ]

    expect(purgeCandidates(rows, { olderThanDays: 30, now: NOW }).map((row) => row.client_id)).toEqual(["oublie", "jamais-servi"])
  })

  it("should refuse before any request a manual, active or recent client passed straight to deleteClients", async () => {
    const { admin, deleted } = fakeAdmin([])
    const rows = [
      client({ client_id: "manuel", registration_type: "manual" }),
      client({ client_id: "actif", sessions: 1, last_activity: iso(NOW - DAY) }),
      client({ client_id: "recent", created_at: iso(NOW - DAY) }),
    ]

    expect(await deleteClients(admin, rows, { olderThanDays: 30, now: NOW })).toEqual({
      deleted: [],
      failed: rows.map(({ client_id: id }) => ({ id, reason: NOT_A_CANDIDATE })),
    })
    expect(deleted).toEqual([])
  })
})

describe("oauth:clients arguments (AC17)", () => {
  it.each([
    [[], "Commande manquante."],
    [["clean"], "Commande inconnue : clean."],
    [["purge"], "Option requise : --older-than <jours>."],
    [["purge", "--older-than"], "Valeur manquante pour --older-than <jours>."],
    [["purge", "--older-than", "1.5"], "--older-than attend un nombre entier de jours, 1 au moins (reçu : « 1.5 »)."],
    [["purge", "--older-than", "0"], "--older-than attend un nombre entier de jours, 1 au moins (reçu : « 0 »)."],
    [["purge", "--older-than", "30", "--force"], "Argument inattendu : --force."],
  ])("should refuse %j with the usage", (argv, raison) => {
    expect(() => parseArgs(argv)).toThrow(`${raison} ${USAGE}`)
  })

  it("should read list, and purge with its days and --yes in any order", () => {
    expect(parseArgs(["list"])).toEqual({ command: "list" })
    expect(parseArgs(["purge", "--older-than", "30"])).toEqual({ command: "purge", olderThanDays: 30, yes: false })
    expect(parseArgs(["purge", "--yes", "--older-than", "7"])).toEqual({ command: "purge", olderThanDays: 7, yes: true })
  })

  it("should name the missing variables on stderr and exit 1, without any request", () => {
    let result: { status: number; stdout: string; stderr: string }
    try {
      // Vides dans l'environnement du processus, elles masquent `.env.local` : aucune adresse à appeler.
      const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: "", SUPABASE_SECRET_KEY: "" }
      result = { status: 0, stdout: execFileSync(process.execPath, [script, "list"], { encoding: "utf8", stdio: "pipe", env }), stderr: "" }
    } catch (error) {
      // execFileSync lève sur un code non nul ; l'erreur porte status, stdout et stderr du processus.
      result = error as { status: number; stdout: string; stderr: string }
    }

    expect(result.status).toBe(1)
    expect(result.stderr).toContain("Variables manquantes : NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY")
    expect(result.stdout).toBe("")
  })
})
