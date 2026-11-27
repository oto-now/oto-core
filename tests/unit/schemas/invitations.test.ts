import { randomUUID } from "crypto"
import { describe, expect, it } from "vitest"
import {
  invitationIdSchema,
  inviteSchema,
  listInvitationsQuerySchema,
} from "@otomata_tech/oto_platform/schemas"

describe("inviteSchema", () => {
  it("should trim and lower-case the email", () => {
    const result = inviteSchema.safeParse({ email: "  New@X.test " })
    expect(result.success).toBe(true)
    expect(result.data?.email).toBe("new@x.test")
  })

  it("should reject a malformed email", () => {
    expect(inviteSchema.safeParse({ email: "not-an-email" }).success).toBe(false)
  })

  it("should reject an email longer than 254 characters", () => {
    expect(inviteSchema.safeParse({ email: `${"a".repeat(250)}@x.test` }).success).toBe(false)
  })

  it("should default the role to member", () => {
    expect(inviteSchema.parse({ email: "a@x.test" }).role).toBe("member")
  })

  it("should reject an unknown role", () => {
    expect(inviteSchema.safeParse({ email: "a@x.test", role: "owner" }).success).toBe(false)
  })

  it("should read no team, an empty team and a null team as no team", () => {
    expect([{}, { teamId: "" }, { teamId: null }, { teamIds: [] }].map((teams) => inviteSchema.parse({ email: "a@x.test", ...teams }).teamIds)).toEqual([[], [], [], []])
  })

  it("should give every team once, the single team of the older form first, and reject an invalid id or more than 50 teams", () => {
    const [a, b] = [randomUUID(), randomUUID()]
    expect(inviteSchema.parse({ email: "a@x.test", teamId: a, teamIds: [b, a, b] }).teamIds).toEqual([a, b])
    expect(inviteSchema.parse({ email: "a@x.test", teamId: a })).toEqual({ email: "a@x.test", role: "member", teamIds: [a] })
    expect(inviteSchema.safeParse({ email: "a@x.test", teamId: "ventes" }).success).toBe(false)
    expect(inviteSchema.safeParse({ email: "a@x.test", teamIds: ["ventes"] }).success).toBe(false)
    expect(inviteSchema.safeParse({ email: "a@x.test", teamIds: Array.from({ length: 51 }, () => randomUUID()) }).success).toBe(false)
  })
})

describe("invitationIdSchema", () => {
  it("should accept a UUID and reject anything else", () => {
    expect(invitationIdSchema.safeParse(randomUUID()).success).toBe(true)
    expect(invitationIdSchema.safeParse("42").success).toBe(false)
  })
})

describe("listInvitationsQuerySchema", () => {
  it("should default the state to pending and accept all", () => {
    expect(listInvitationsQuerySchema.parse({}).state).toBe("pending")
    expect(listInvitationsQuerySchema.parse({ state: "all" }).state).toBe("all")
    expect(listInvitationsQuerySchema.safeParse({ state: "revoked" }).success).toBe(false)
  })
})
