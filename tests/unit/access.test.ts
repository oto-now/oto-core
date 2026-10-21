// @vitest-environment node
// Formulation des refus « à qui demander » (E01-S04, H68, AC21), sans base : le texte d'un refus, les
// administrateurs nommés (tri en français, trois au plus) et le propriétaire d'un espace personnel, jamais
// nommé. Les niveaux, les refus et `describeOwner` sur une vraie base sont dans
// `tests/integration/access.test.ts` (E01-S10, partie e1a) ; la parité avec le SQL dans
// `tests/integration/access-parity.test.ts`.
import { describe, expect, it } from "vitest"
import { describeOwner, reservedTo, unknownPath, type Identity, type PlatformDb } from "@otomata_tech/oto_platform/server"
// `administrators` reste interne au paquet : lu par le module, hors de la face `./server`.
import { administrators } from "../../packages/plateforme/server/access"
import type { DirectoryEntry } from "../../packages/plateforme/server/directory"

const IDENTITY: Identity = {
  org: { id: "org-1", slug: "acme", name: "Acme Test", prefix: "acme", brand: {}, domains: null },
  user: { id: "user-9", email: "lea@acme.test", name: "Léa Roux" },
  member: { role: "member", profile: {} },
  teams: [],
  isStaff: false,
  viaGrant: false,
  hasOpenGrant: false,
}

const person = (userId: string, name: string, role: "admin" | "member"): DirectoryEntry => ({
  userId,
  email: `${userId}@acme.test`,
  name,
  role,
  lastSignInAt: null,
})
const admin = (userId: string, name: string) => person(userId, name, "admin")
const member = (userId: string, name: string) => person(userId, name, "member")

// Toute lecture en base lève : ce qui passe ici ne l'a pas touchée. Un Proxy vide n'a pas le type du
// client : l'assertion le fait passer pour lui.
const untouchable = new Proxy(
  {},
  {
    get() {
      throw new Error("database touched")
    },
  },
) as unknown as PlatformDb

describe("reservedTo", () => {
  it("should say who writes and ask for access", () => {
    expect(reservedTo("write", "ventes/devis", "team Ventes (lead: Claire Morel)")).toBe(
      "Writing ventes/devis is reserved to team Ventes (lead: Claire Morel). Ask them for access.",
    )
  })

  it("should say who publishes and ask them to publish it", () => {
    expect(reservedTo("publish", "ventes/devis", "team Ventes (lead: Claire Morel)")).toBe(
      "Publishing ventes/devis is reserved to team Ventes (lead: Claire Morel). Ask them to publish it.",
    )
  })

  it("should say who renames and ask them to rename it (E11-S02)", () => {
    expect(reservedTo("rename", "ventes/devis", "team Ventes (lead: Claire Morel)")).toBe(
      "Renaming ventes/devis is reserved to team Ventes (lead: Claire Morel). Ask them to rename it.",
    )
  })

  it("should say who uses an account and ask for access", () => {
    expect(reservedTo("use", "account « Mail Ventes »", "team Ventes (lead: Claire Morel)")).toBe(
      "Using account « Mail Ventes » is reserved to team Ventes (lead: Claire Morel). Ask them for access.",
    )
  })
})

describe("unknownPath", () => {
  it("should answer as for a path that does not exist", () => {
    expect(unknownPath("ventes/devis")).toBe("Unknown path ventes/devis.")
  })
})

describe("administrators", () => {
  it("should name the organisation without administrators", () => {
    expect(administrators(IDENTITY, [member("u-claire", "Claire Morel")])).toBe("the administrators of Acme Test")
  })

  it("should name the single administrator", () => {
    expect(administrators(IDENTITY, [admin("u-ada", "Ada Martin"), member("u-claire", "Claire Morel")])).toBe(
      "the administrators of Acme Test (Ada Martin)",
    )
  })

  it("should name three administrators, sorted the French way", () => {
    const three = [admin("u-3", "Émile Zola"), admin("u-1", "Ada Martin"), admin("u-2", "bruno Petit")]
    expect(administrators(IDENTITY, three)).toBe("the administrators of Acme Test (Ada Martin, bruno Petit and Émile Zola)")
  })

  it("should name three administrators out of five, then count the others", () => {
    const five = ["Ada Martin", "Bruno Petit", "Chloé Durand", "Denis Roux", "Eva Blanc"].map((name, index) => admin(`u-${index}`, name))
    expect(administrators(IDENTITY, five)).toBe("the administrators of Acme Test (Ada Martin, Bruno Petit, Chloé Durand and 2 more)")
  })
})

describe("describeOwner", () => {
  it("should name the owner of a personal node without naming them, and without reading the database", async () => {
    expect(await describeOwner(untouchable, IDENTITY, { kind: "user", teamId: null, userId: "u-claire" })).toBe("its owner")
  })
})
