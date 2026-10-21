// Schéma partagé d'un signalement (E03-S05) : bornes qu'E03-S01 sert, lues par la face `./schemas` comme les
// autres faces du paquet. La liste fermée des types et les champs requis sont servis figés (`enum`, `required`) :
// `mcp-tools.test.ts`, « should keep the JSON Schemas frozen ». Les paramètres d'adresse de l'usage (AC2) et des
// retours (AC9), E08-S09 : une valeur absente ou illisible retombe sur son défaut, jamais passée brute à un
// service. `ticketSchema` et `feedbackStateChangeSchema` sont prouvés par le test d'AC11
// (`usage-and-feedback.test.ts`).
import { describe, expect, it } from "vitest"
import { feedbackInputSchema, feedbackListQuerySchema, usageQuerySchema } from "@otomata_tech/oto_platform/schemas"

const VENTES = "0e8e5a3c-7f10-4a5b-8d3b-2b1c4d5e6f70"

describe("feedbackInputSchema", () => {
  it("should trim the text and the target, and keep the target optional", () => {
    expect(feedbackInputSchema.parse({ type: "gap", text: "  Il manque un export.  ", target: " table.rows " })).toEqual({
      type: "gap",
      text: "Il manque un export.",
      target: "table.rows",
    })
    expect(feedbackInputSchema.parse({ type: "error", text: "x" })).toEqual({ type: "error", text: "x" })
  })

  it("should take a text of 1 to 4,000 characters, blank refused", () => {
    expect(feedbackInputSchema.safeParse({ type: "gap", text: "x".repeat(4000) }).success).toBe(true)
    for (const text of ["", "   ", "x".repeat(4001)]) {
      expect(feedbackInputSchema.safeParse({ type: "gap", text }).success, `${text.length} characters`).toBe(false)
    }
  })

  it("should take a target of 1 to 200 characters, blank refused", () => {
    expect(feedbackInputSchema.safeParse({ type: "gap", text: "x", target: "t".repeat(200) }).success).toBe(true)
    for (const target of ["", "  ", "t".repeat(201)]) {
      expect(feedbackInputSchema.safeParse({ type: "gap", text: "x", target }).success, `${target.length} characters`).toBe(false)
    }
  })
})

describe("usageQuerySchema (AC2)", () => {
  it("should default to 30 days, fall back to 30 on an unknown window, drop a malformed team, and ignore the former French names (E11-S07, AC-b3)", () => {
    expect(usageQuerySchema.parse({})).toEqual({ period: 30, team: undefined })
    expect(usageQuerySchema.parse({ period: "45", team: "ventes" })).toEqual({ period: 30, team: undefined })
    expect(usageQuerySchema.parse({ period: "7", team: VENTES })).toEqual({ period: 7, team: VENTES })
    expect(usageQuerySchema.parse({ period: ["7", "90"], team: "" })).toEqual({ period: 30, team: undefined })
    expect(usageQuerySchema.parse({ periode: "7", equipe: VENTES })).toEqual({ period: 30, team: undefined })
  })
})

describe("feedbackListQuerySchema (AC9)", () => {
  it("should default to the tickets to handle over 30 days, fall back to each default on an unknown value, and ignore the former French names (E11-S07, AC-b3)", () => {
    expect(feedbackListQuerySchema.parse({})).toEqual({ state: "to_handle", type: undefined, period: 30, cursor: undefined })
    expect(feedbackListQuerySchema.parse({ state: "archived", type: "idea", period: "12", cursor: "" })).toEqual({
      state: "to_handle",
      type: undefined,
      period: 30,
      cursor: undefined,
    })
    expect(feedbackListQuerySchema.parse({ state: "declined", type: "gap", period: "90", cursor: "c-2" })).toEqual({
      state: "declined",
      type: "gap",
      period: 90,
      cursor: "c-2",
    })
    expect(feedbackListQuerySchema.parse({ etat: "all", periode: "7", curseur: "c-2" })).toEqual({ state: "to_handle", type: undefined, period: 30, cursor: undefined })
  })
})
