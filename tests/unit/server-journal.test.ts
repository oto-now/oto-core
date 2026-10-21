// @vitest-environment node
// Journal des portes (E03-S01, AC16 à AC19, H07) : arguments masqués puis bornés, coupes sans
// moitié de paire de substitution (N31), signatures de l'`initialize` ; sans base, ce que l'écrivain
// et la lecture du dernier `initialize` décident avant elle.
import { afterEach, describe, expect, it, vi } from "vitest"
import type { PlatformDb } from "../../packages/plateforme/server/db"
import type { Identity } from "../../packages/plateforme/server/identity"
import {
  clip,
  cut,
  initializeSignatures,
  journalError,
  lastHostSignature,
  loggedArgs,
  MAX_LOGGED_ARGS_CHARS,
  writeJournal,
} from "../../packages/plateforme/server/journal"

const IDENTITY: Identity = {
  org: { id: "org-1", slug: "acme", name: "Acme", prefix: "acme", brand: {}, domains: null },
  user: { id: "user-1", email: "claire@example.test", name: "Claire" },
  member: { role: "member", profile: {} },
  teams: [],
  isStaff: false,
  viaGrant: false,
  hasOpenGrant: false,
}

afterEach(() => {
  vi.restoreAllMocks()
})

// De petits arguments gardés tels quels : le cas courant de toute ligne de journal (`tests/integration/api-handler.test.ts`).
describe("loggedArgs (AC16, N5)", () => {
  it("should mask secret values whatever the case, with or without - and _", () => {
    const masked = loggedArgs({
      password: "p1",
      Passwd: "p2",
      api_key: "k1",
      "X-Api-Key": "k2",
      apiKey: "k3",
      private_key: "k4",
      refresh_token: "t1",
      Authorization: "Bearer t2",
      client_secret: "s1",
      key: "ref-042",
      monkey: "banana",
    })
    expect(masked).toEqual({
      password: "[masked]",
      Passwd: "[masked]",
      api_key: "[masked]",
      "X-Api-Key": "[masked]",
      apiKey: "[masked]",
      private_key: "[masked]",
      refresh_token: "[masked]",
      Authorization: "[masked]",
      client_secret: "[masked]",
      key: "ref-042",
      monkey: "banana",
    })
  })

  it("should mask at three levels of nesting, arrays included, and keep a row key readable", () => {
    const args = {
      function: "table.write",
      arguments: { rows: [{ key: "r1", set: { contact: { token: "t", name: "Jo" } } }], credentials: { password: "p" } },
    }
    expect(loggedArgs(args)).toEqual({
      function: "table.write",
      arguments: { rows: [{ key: "r1", set: { contact: { token: "[masked]", name: "Jo" } } }], credentials: { password: "[masked]" } },
    })
  })

  it("should cut beyond 2,048 characters after masking, keeping the head", () => {
    const args = { text: "x".repeat(3000), secret: "s" }
    const logged = loggedArgs(args)
    const serialized = JSON.stringify({ text: "x".repeat(3000), secret: "[masked]" })
    expect(logged).toEqual({ _truncated: true, head: serialized.slice(0, MAX_LOGGED_ARGS_CHARS) })
    expect(JSON.stringify(logged)).not.toContain('"secret":"s"')
  })

  // Revue du cycle 1 : une moitié de paire seule fait refuser tout le lot par PostgREST (PGRST102).
  it("should cut the head before an emoji that straddles 2,048 characters, never inside it", () => {
    const opening = JSON.stringify({ text: "" }).length - 2
    const args = { text: `${"y".repeat(MAX_LOGGED_ARGS_CHARS - 1 - opening)}😀${"z".repeat(100)}` }
    const serialized = JSON.stringify(args)
    expect(serialized.charCodeAt(MAX_LOGGED_ARGS_CHARS - 1)).toBe(0xd83d)
    expect(loggedArgs(args)).toEqual({ _truncated: true, head: serialized.slice(0, MAX_LOGGED_ARGS_CHARS - 1) })
  })

  it("should replace half a surrogate pair sent in the arguments, keys included", () => {
    expect(loggedArgs({ note: "a\ud83d", ["k\udc00"]: [1, "\udc00b"] })).toEqual({ note: "a�", "k�": [1, "�b"] })
  })
})

describe("clip (N31)", () => {
  it("should keep a text within the bound as it is", () => {
    expect(clip("Relance 😀 les devis", 200)).toBe("Relance 😀 les devis")
  })

  it("should drop the half of an emoji cut by the bound", () => {
    const text = `${"x".repeat(199)}😀 et la suite`
    expect(text.charCodeAt(199)).toBe(0xd83d)
    expect(clip(text, 200)).toBe("x".repeat(199))
  })

  it("should replace half a pair that comes from the text itself, at its end included", () => {
    expect(clip("a\ud83db\udc00", 10)).toBe("a�b�")
    expect(clip("acme_\ud83d", 200)).toBe("acme_�")
  })
})

// Coupe unique des noms, libellés et lignes servis au modèle (E03-S01 N31 ; E04-S01 : bloc équipe,
// récapitulatif de mail.send_draft).
describe("cut (N31)", () => {
  it("should keep a text that fits, its last character included", () => {
    expect(cut("Mail Ventes", 11)).toBe("Mail Ventes")
  })

  it("should cut a longer text to the bound, ellipsis included", () => {
    expect(cut("Mail Ventes Nord", 11)).toBe("Mail Vente…")
    expect(cut("Mail Ventes Nord", 11)).toHaveLength(11)
  })

  it("should never cut inside an emoji", () => {
    expect(cut(`${"a".repeat(9)}😀bcd`, 11)).toBe(`${"a".repeat(9)}…`)
  })
})

describe("journalError (N4)", () => {
  it("should write <code>: <message>, cut at 500 characters, never inside an emoji", () => {
    expect(journalError("not_found", "Unknown prompt relance.")).toBe("not_found: Unknown prompt relance.")
    // « invalid_arguments: » fait 19 caractères : l'emoji occupe les positions 499 et 500.
    expect(journalError("invalid_arguments", `${"m".repeat(480)}😀 and more`)).toBe(`invalid_arguments: ${"m".repeat(480)}`)
  })
})

describe("initializeSignatures (AC18)", () => {
  const init = { jsonrpc: "2.0", id: 1, method: "initialize", params: { clientInfo: { name: "claude-ai", version: "0.1.0" } } }

  it("should read the client of a single message and of a batch", () => {
    expect(initializeSignatures(JSON.stringify(init))).toEqual(["claude-ai@0.1.0"])
    expect(initializeSignatures(JSON.stringify([init, { jsonrpc: "2.0", method: "notifications/initialized" }]))).toEqual([
      "claude-ai@0.1.0",
    ])
  })

  it("should find nothing without initialize or in an unreadable body", () => {
    expect(initializeSignatures(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }))).toEqual([])
    expect(initializeSignatures("{not json")).toEqual([])
  })

  it("should sign ?@? when clientInfo is absent", () => {
    expect(initializeSignatures(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }))).toEqual(["?@?"])
  })

  it("should bound a signature at 200 characters, never inside an emoji, and replace half a pair", () => {
    const long = { ...init, params: { clientInfo: { name: `${"x".repeat(199)}😀`, version: "1" } } }
    expect(initializeSignatures(JSON.stringify(long))).toEqual(["x".repeat(199)])
    const half = { ...init, params: { clientInfo: { name: "claude\ud83d", version: "1" } } }
    expect(initializeSignatures(JSON.stringify(half))).toEqual(["claude�@1"])
  })
})

// Sans base : ce qui ne lit ni n'écrit rien. L'écriture et la lecture du journal sur une vraie base sont
// dans `tests/integration/server-journal.test.ts` (E01-S10, partie e1a).
describe("writeJournal and lastHostSignature without the database (AC17, AC19)", () => {
  // Toute lecture ou écriture en base lève : ce qui passe ici ne l'a pas touchée. Un Proxy vide n'a pas
  // le type du client : l'assertion le fait passer pour lui.
  const untouchable = new Proxy(
    {},
    {
      get() {
        throw new Error("database touched")
      },
    },
  ) as unknown as PlatformDb

  it("should not call the database without lines", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    await writeJournal(untouchable, [])
    expect(log).not.toHaveBeenCalled()
  })

  it("should give null without a user agent, before the database", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    expect(await lastHostSignature(untouchable, IDENTITY, null)).toBeNull()
    expect(log).not.toHaveBeenCalled()
  })
})
