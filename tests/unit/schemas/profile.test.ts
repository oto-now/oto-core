import { describe, expect, it } from "vitest"
import { profilePatchSchema } from "../../../packages/plateforme/schemas"

// La fiche qu'une personne écrit (E05-S04, AC13 ; H31, P39 ; E05-S11, AC-3, AC-5) : ses noms, sa langue et sa
// couleur, aux bornes d'`update_my_profile` (migration `20260928110000_platform_profil.sql`), lus par la page
// « Profil » et par `PATCH /api/platform/profile`.

describe("profilePatchSchema (AC13, AC-5)", () => {
  it("should accept names of 80 characters at most, the language fr or en and one of the eight themes, an empty string removing the key", () => {
    expect(profilePatchSchema.parse({ name: "  Léa Martin  " })).toEqual({ name: "Léa Martin" })
    expect(profilePatchSchema.parse({ name: "x".repeat(80), language: "en" })).toEqual({ name: "x".repeat(80), language: "en" })
    expect(profilePatchSchema.parse({ first_name: " Léa ", last_name: "x".repeat(80), theme: "foret" })).toEqual({
      first_name: "Léa",
      last_name: "x".repeat(80),
      theme: "foret",
    })
    expect(profilePatchSchema.parse({ name: "", first_name: "", last_name: "", language: "", theme: "" })).toEqual({
      name: "",
      first_name: "",
      last_name: "",
      language: "",
      theme: "",
    })
    // En caractères, comme `char_length` dans `update_my_profile` : 80 emoji tiennent (160 unités UTF-16).
    expect(profilePatchSchema.safeParse({ first_name: "\u{1F600}".repeat(80) }).success).toBe(true)
  })

  // Une personne n'écrit que ses noms, sa langue et sa couleur : le `handle` fonde `private/<handle>` (H61), le
  // ton s'écrit dans le Contexte Perso (P39).
  const REFUSED: [string, unknown][] = [
    ["a name over 80 characters", { name: "\u{1F600}".repeat(81) }],
    ["a first name over 80 characters", { first_name: "x".repeat(81) }],
    ["a last name over 80 characters", { last_name: "x".repeat(81) }],
    ["an unknown language", { language: "de" }],
    ["a theme outside the eight", { theme: "rose" }],
    ["an empty patch", {}],
    ["the handle", { handle: "lea2" }],
    ["the tone", { name: "Léa", tone: "direct" }],
  ]

  it("should refuse every patch out of its bounds", () => {
    expect(Object.fromEntries(REFUSED.map(([cas, patch]) => [cas, profilePatchSchema.safeParse(patch).success]))).toEqual(Object.fromEntries(REFUSED.map(([cas]) => [cas, false])))
  })
})
