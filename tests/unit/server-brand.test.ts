// @vitest-environment node
// Marque (E09-S01) sans base : lecture normalisée (AC1) et refus d'une saisie invalide, rendus avant toute
// requête. L'écriture, la lecture et leurs refus sur la base réelle (E01-S07 AC15 ; E01-S10, lot e2b) :
// `tests/integration/orgs-settings-sql.test.ts`.
import { afterEach, describe, expect, it, vi } from "vitest"
import { PlatformError, preferredTheme, readBrand, updateBrand, type Identity, type PlatformDb } from "@otomata_tech/oto_platform/server"

const NAME = "Acme Énergies"
const IDENTITY: Identity = {
  org: { id: "org-1", slug: "acme", name: NAME, prefix: "acme", brand: {}, domains: null },
  user: { id: "user-1", email: "admin@acme.test", name: "admin" },
  member: { role: "admin", profile: {} },
  teams: [],
  isStaff: false,
  viaGrant: false,
  hasOpenGrant: false,
}

/** Un client dont chaque face lève et compte : un refus rendu avant toute requête n'en touche aucune. */
function untouchedDb() {
  const touched: string[] = []
  const face = (name: string) => () => {
    touched.push(name)
    throw new Error(`${name} reached`)
  }
  // Le double n'a que les trois faces : le type complet du client n'a pas de sens ici.
  return { db: { tx: face("tx"), from: face("from"), rpc: face("rpc") } as unknown as PlatformDb, touched }
}

async function refusal(promise: Promise<unknown>): Promise<PlatformError> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  )
  if (!(error instanceof PlatformError)) throw new Error("expected a PlatformError")
  return error
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("readBrand (AC1)", () => {
  const defaults = { theme: "manuscrit", logoUrl: null, displayName: NAME }

  it("should give the defaults for an empty brand", () => {
    expect(readBrand({ name: NAME, brand: {} })).toEqual(defaults)
  })

  it("should fall back to manuscrit for a theme outside the eight", () => {
    expect(readBrand({ name: NAME, brand: { theme: "rose" } }).theme).toBe("manuscrit")
  })

  // https seul : `javascript:` (sécurité) ; `http:`, une chaîne qui n'est pas une adresse et un nombre, mêmes
  // refus, sont retirés (M11b ; `http:` refusé par `schemas/brand.test.ts`).
  it("should drop the logo javascript:alert(1)", () => {
    expect(readBrand({ name: NAME, brand: { logo_url: "javascript:alert(1)" } }).logoUrl).toBeNull()
  })

  // E05-S13 (AC-3, HN-E05S13-2) : un seul nom, celui de l'organisation, même quand `display_name` est rempli.
  it("should return valid values as they are, and the organisation name whatever the stored display name", () => {
    const brand = { theme: "foret", logo_url: "https://example.com/logo.png", display_name: "Acme" }
    expect(readBrand({ name: NAME, brand })).toEqual({
      theme: "foret",
      logoUrl: "https://example.com/logo.png",
      displayName: NAME,
    })
  })

  // null, seul cas qui lève sans la garde d'objet (`null.theme`) : une chaîne, un tableau et un nombre
  // rendent déjà les défauts sans elle, et sont retirés (M11b).
  it("should give the defaults for a brand that is not an object, null here", () => {
    expect(readBrand({ name: NAME, brand: null })).toEqual(defaults)
  })

  // E05-S11 (AC-36) : la langue de l'organisation, seulement `fr` ou `en`.
  it("should give the language fr or en, and none for another value", () => {
    expect(readBrand({ name: NAME, brand: { language: "en" } }).language).toBe("en")
    expect(readBrand({ name: NAME, brand: { language: "de" } })).toEqual(defaults)
  })
})

// E05-S11 (AC-4, HN-E05S11-3) : la couleur de la personne, sinon celle de l'organisation, pour tout compte sans choix.
describe("preferredTheme (AC-4)", () => {
  it.each([
    ["the profile theme over the organisation's", "lagune", "cobalt", "lagune"],
    ["the organisation theme without a profile theme", undefined, "cobalt", "cobalt"],
    ["the organisation theme over a profile theme outside the eight", "rose", "cobalt", "cobalt"],
    ["manuscrit without either", undefined, undefined, "manuscrit"],
  ])("should give %s", (_case, profileTheme, orgTheme, expected) => {
    const identity: Identity = {
      ...IDENTITY,
      org: { ...IDENTITY.org, brand: orgTheme ? { theme: orgTheme } : {} },
      member: { ...IDENTITY.member, profile: profileTheme ? { theme: profileTheme } : {} },
    }
    expect(preferredTheme(identity)).toBe(expected)
  })
})

describe("updateBrand refusals of the input", () => {
  it("should refuse an invalid brand with invalid_arguments naming each path, without any request", async () => {
    const { db, touched } = untouchedDb()

    const error = await refusal(updateBrand(db, IDENTITY, { theme: "rose", logo_url: "ftp://x", display_name: null, language: "de" }))

    expect(error.code).toBe("invalid_arguments")
    expect(error.message).toMatch(/^Invalid brand: theme: .+; logo_url: .+; language: expected fr or en, or null\.$/)
    expect(error.details).toEqual({ paths: ["theme", "logo_url", "language"] })
    expect(touched).toEqual([])
  })

  it("should refuse a body that is not an object", async () => {
    const error = await refusal(updateBrand(untouchedDb().db, IDENTITY, "foret"))
    expect(error.code).toBe("invalid_arguments")
    expect(error.details).toEqual({ paths: ["body"] })
  })
})
