// Schémas des services connecteurs (E04-S01) : nom de connecteur, libellé et mode d'un compte (lus
// par les schémas des services, N33), création et désactivation d'un compte. Mêmes bornes que la
// base (contrainte du nom, E01-S06).
import { randomUUID } from "crypto"
import { describe, expect, it } from "vitest"
import { connectorRefSchema, createAccountSchema, disableAccountSchema } from "@otomata_tech/oto_platform/schemas"

const ORG_ACCOUNT = { connector: "mail", owner_kind: "org" }

describe("connector name, through connectorRefSchema", () => {
  const connector = (name: string) => connectorRefSchema.safeParse({ connector: name })

  it("should accept the database form and trim the edges", () => {
    expect(connector(" mail ").data).toEqual({ connector: "mail" })
    expect(connector(`m${"a".repeat(39)}`).data?.connector).toHaveLength(40)
    expect(connector("sellsy_v2").data).toEqual({ connector: "sellsy_v2" })
  })

  it("should reject a name out of the database form, on the connector field", () => {
    const names = ["Mail", "1mail", "mail-box", "", `m${"a".repeat(40)}`]
    const verdicts = Object.fromEntries(names.map((name) => [name, connector(name).error?.issues.map((issue) => issue.path)]))
    expect(verdicts).toEqual(Object.fromEntries(names.map((name) => [name, [["connector"]]])))
  })
})

describe("account label, through createAccountSchema", () => {
  it("should trim the edges and keep 1 to 80 characters", () => {
    expect(createAccountSchema.parse({ ...ORG_ACCOUNT, label: " Mail Ventes " }).label).toBe("Mail Ventes")
    expect(createAccountSchema.parse({ ...ORG_ACCOUNT, label: "x".repeat(80) }).label).toHaveLength(80)
  })

  it("should reject an empty, blank or too long label, on the label field", () => {
    const labels = ["", "   ", "x".repeat(81)]
    const verdicts = Object.fromEntries(labels.map((label) => [label, createAccountSchema.safeParse({ ...ORG_ACCOUNT, label }).error?.issues.map((issue) => issue.path)]))
    expect(verdicts).toEqual(Object.fromEntries(labels.map((label) => [label, [["label"]]])))
  })
})

describe("account mode, through createAccountSchema", () => {
  it("should know simule, sandbox and reel only", () => {
    for (const mode of ["simule", "sandbox", "reel"]) {
      expect(createAccountSchema.parse({ ...ORG_ACCOUNT, label: "Mail", mode }).mode).toBe(mode)
    }
    const live = createAccountSchema.safeParse({ ...ORG_ACCOUNT, label: "Mail", mode: "live" })
    expect(live.error?.issues.map((issue) => issue.path)).toEqual([["mode"]])
  })
})

describe("createAccountSchema", () => {
  const team = randomUUID()

  it("should default the mode to simule", () => {
    expect(createAccountSchema.parse({ connector: "mail", owner_kind: "org", label: "Mail Acme" })).toEqual({
      connector: "mail",
      owner_kind: "org",
      label: "Mail Acme",
      mode: "simule",
    })
  })

  it("should require team_id for a team account", () => {
    const parsed = createAccountSchema.safeParse({ connector: "mail", owner_kind: "team", label: "Mail Ventes" })
    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues).toEqual([expect.objectContaining({ path: ["team_id"], message: "team_id is required for a team account" })])
    expect(createAccountSchema.parse({ connector: "mail", owner_kind: "team", team_id: team, label: "Mail Ventes" }).team_id).toBe(team)
  })

  it("should refuse team_id for an account of kind org", () => {
    const parsed = createAccountSchema.safeParse({ connector: "mail", owner_kind: "org", team_id: team, label: "Mail" })
    expect(parsed.error?.issues).toEqual([expect.objectContaining({ path: ["team_id"], message: "team_id is only for a team account" })])
  })

  it("should have no field to name another person, and refuse an unknown owner kind or a bad team id", () => {
    expect(createAccountSchema.parse({ connector: "mail", owner_kind: "user", label: "Mon mail", user_id: randomUUID() })).not.toHaveProperty("user_id")
    expect(createAccountSchema.safeParse({ connector: "mail", owner_kind: "project", label: "Mail" }).success).toBe(false)
    expect(createAccountSchema.safeParse({ connector: "mail", owner_kind: "team", team_id: "ventes", label: "Mail" }).success).toBe(false)
  })
})

describe("disableAccountSchema", () => {
  it("should accept a UUID and reject anything else", () => {
    expect(disableAccountSchema.safeParse({ account_id: randomUUID() }).success).toBe(true)
    expect(disableAccountSchema.safeParse({ account_id: "Mail Ventes" }).success).toBe(false)
  })
})
