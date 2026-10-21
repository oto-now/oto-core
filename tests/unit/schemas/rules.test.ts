import { randomUUID } from "crypto"
import { describe, expect, it } from "vitest"
import { ACCESS_LEVEL_NAMES, setNodeRuleSchema } from "@otomata_tech/oto_platform/schemas"
import { ACCESS_LEVELS } from "@otomata_tech/oto_platform/server"

const REGLE = { path: "ventes/devis", subject: { kind: "team", id: randomUUID() }, level: "read" }

describe("setNodeRuleSchema (AC17)", () => {
  it("should accept a rule for a team or a person", () => {
    expect(setNodeRuleSchema.safeParse(REGLE).success).toBe(true)
    expect(setNodeRuleSchema.safeParse({ ...REGLE, subject: { kind: "user", id: randomUUID() } }).success).toBe(true)
  })

  it("should refuse a malformed path", () => {
    for (const path of ["Ventes/Devis", "ventes/", "/ventes", "ventes devis", ""]) {
      expect(setNodeRuleSchema.safeParse({ ...REGLE, path }).success).toBe(false)
    }
  })

  it("should refuse a subject without kind, of an unknown kind, or with an id that is not a UUID", () => {
    expect(setNodeRuleSchema.safeParse({ ...REGLE, subject: { id: randomUUID() } }).success).toBe(false)
    expect(setNodeRuleSchema.safeParse({ ...REGLE, subject: { kind: "org", id: randomUUID() } }).success).toBe(false)
    expect(setNodeRuleSchema.safeParse({ ...REGLE, subject: { kind: "team", id: "ventes" } }).success).toBe(false)
  })

  it("should accept each of the four levels, and refuse an unknown one", () => {
    for (const level of ACCESS_LEVEL_NAMES) {
      expect(setNodeRuleSchema.safeParse({ ...REGLE, level }).success).toBe(true)
    }
    expect(setNodeRuleSchema.safeParse({ ...REGLE, level: "admin" }).success).toBe(false)
  })
})

// Le panneau `ReglesDuNoeud` nomme le niveau calculé par le service (`nodeLevel`, 0 à 3) par son rang
// dans cette liste : l'ordre est le contrat.
describe("ACCESS_LEVEL_NAMES", () => {
  it("should rank the four levels the same in the schema and the server, from none (0) to manage (3) (H65)", () => {
    expect(ACCESS_LEVEL_NAMES).toEqual(["none", "read", "write", "manage"])
    expect(Object.fromEntries(ACCESS_LEVEL_NAMES.map((name, rank) => [name, rank]))).toEqual(ACCESS_LEVELS)
  })
})
