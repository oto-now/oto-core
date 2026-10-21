import { describe, expect, it } from "vitest"
import {
  confirmerLienSchema,
  loginPath,
  loginSchema,
  magicLinkSchema,
  oauthSignInSchema,
  providerSchema,
  resetPasswordSchema,
  safeRedirect,
} from "@/lib/schemas/auth"

describe("resetPasswordSchema", () => {
  it("should accept a password of 6 characters confirmed identically", () => {
    const result = resetPasswordSchema.safeParse({ password: "123456", confirmPassword: "123456" })

    expect(result.success).toBe(true)
  })

  it("should reject a password of 5 characters", () => {
    const result = resetPasswordSchema.safeParse({ password: "12345", confirmPassword: "12345" })

    expect(result.success).toBe(false)
  })

  it("should reject a confirmation that does not match", () => {
    const result = resetPasswordSchema.safeParse({ password: "12345678", confirmPassword: "87654321" })

    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(["confirmPassword"])
  })

  it("should reject a password of 73 characters", () => {
    const password = "a".repeat(73)
    const result = resetPasswordSchema.safeParse({ password, confirmPassword: password })

    expect(result.success).toBe(false)
  })
})

describe("loginSchema", () => {
  it("should reject an email of 256 characters", () => {
    const email = `${"a".repeat(244)}@exemple.com`
    const result = loginSchema.safeParse({ email, password: "12345678" })

    expect(email).toHaveLength(256)
    expect(result.success).toBe(false)
  })
})

describe("magicLinkSchema", () => {
  it("should accept a valid email", () => {
    expect(magicLinkSchema.safeParse({ email: "claire@acme.test" }).success).toBe(true)
  })

  it("should reject a malformed or missing email", () => {
    expect(magicLinkSchema.safeParse({ email: "claire" }).success).toBe(false)
    expect(magicLinkSchema.safeParse({}).success).toBe(false)
  })
})

describe("confirmerLienSchema", () => {
  it("should accept the fields of an email link", () => {
    expect(confirmerLienSchema.safeParse({ token_hash: "abc", type: "email", next: "/" }).success).toBe(true)
  })

  it("should reject another link type or an empty token", () => {
    expect(confirmerLienSchema.safeParse({ token_hash: "abc", type: "recovery" }).success).toBe(false)
    expect(confirmerLienSchema.safeParse({ token_hash: "", type: "email" }).success).toBe(false)
  })
})

describe("providerSchema and oauthSignInSchema (E09-S03)", () => {
  it("should accept google and azure, Microsoft's name at Supabase Auth", () => {
    expect(providerSchema.options).toEqual(["google", "azure"])
    expect(oauthSignInSchema.safeParse({ fournisseur: "google" }).data).toEqual({ fournisseur: "google" })
    expect(oauthSignInSchema.safeParse({ fournisseur: "azure" }).data).toEqual({ fournisseur: "azure" })
  })

  it.each(["microsoft", "Google"])("should reject the provider %j", (fournisseur) => {
    expect(oauthSignInSchema.safeParse({ fournisseur }).success).toBe(false)
  })

  it("should reject a missing provider", () => {
    expect(oauthSignInSchema.safeParse({}).success).toBe(false)
  })
})

// Retour après la connexion (E02-S02, AC8) : seul un chemin du site revient, sinon `/`.
describe("safeRedirect (E02-S02, AC8)", () => {
  it.each([
    ["/oauth/consent?authorization_id=abc123", "/oauth/consent?authorization_id=abc123"],
    ["/n/contexte", "/n/contexte"],
    [`/${"a".repeat(2047)}`, `/${"a".repeat(2047)}`],
  ])("should keep the path of the site %j", (path, expected) => {
    expect(safeRedirect(path)).toBe(expected)
  })

  it.each([
    ["an absolute address", "https://evil.example"],
    ["a protocol-relative address", "//evil.example"],
    ["a backslash read as a slash", "/\\evil.example"],
    ["a space", "/oauth/consent?authorization_id=abc 123"],
    ["a tab removed by the browser", "/\t/evil.example"],
    ["a line feed removed by the browser", "/\n/evil.example"],
    ["more than 2 048 characters", `/${"a".repeat(2048)}`],
    ["no leading slash", "evil.example"],
    ["an empty value", ""],
  ])("should bring %s back to /", (_cas, path) => {
    expect(safeRedirect(path)).toBe("/")
  })

  it("should bring a missing value back to /", () => {
    expect(safeRedirect(undefined)).toBe("/")
    expect(safeRedirect(null)).toBe("/")
  })
})

describe("loginPath (E02-S02, AC7)", () => {
  it("should encode the way back in the redirect parameter", () => {
    expect(loginPath("/oauth/consent?authorization_id=abc123")).toBe("/login?redirect=%2Foauth%2Fconsent%3Fauthorization_id%3Dabc123")
  })
})

describe("redirect field of the sign-in schemas (E02-S02)", () => {
  const LOGIN = { email: "claire@acme.test", password: "password123" }

  it("should keep the redirect of the form", () => {
    const parsed = loginSchema.safeParse({ ...LOGIN, redirect: "/oauth/consent?authorization_id=abc123" })

    expect(parsed.data?.redirect).toBe("/oauth/consent?authorization_id=abc123")
  })

  it("should ignore a redirect longer than 2 048 characters without refusing the sign-in", () => {
    const parsed = loginSchema.safeParse({ ...LOGIN, redirect: `/${"a".repeat(2048)}` })

    expect(parsed.success).toBe(true)
    expect(parsed.data?.redirect).toBeUndefined()
  })

  it("should carry the redirect of the magic link and of the provider buttons", () => {
    expect(magicLinkSchema.safeParse({ email: "claire@acme.test", redirect: "/platform" }).data?.redirect).toBe("/platform")
    expect(oauthSignInSchema.safeParse({ fournisseur: "google", redirect: "/platform" }).data?.redirect).toBe("/platform")
  })
})
