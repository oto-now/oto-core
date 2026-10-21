// L'ordre des frères dans le rail (E05-S10, partie b2, AC-b9) : les bornes des zones d'une ligne, le frère
// après lequel un dépôt ou un pas range le nœud, et le rangement qui ne changerait rien. Les gestes du rail
// sont prouvés par `rail-application.test.tsx` ; ici, chaque borne, sur une liste de quatre frères.
import { describe, expect, it } from "vitest"
import { placeDuDepot, placeDuPas, zoneDuPointeur } from "../../packages/plateforme/ui/coque/freres"

const FRERES = ["offres", "conseil", "tarifs", "devis"]

describe("zoneDuPointeur", () => {
  it.each([
    [0.249, false, "avant"],
    [0.25, false, "dans"],
    [0.75, false, "dans"],
    [0.751, false, "apres"],
    [0.9, true, "dans"],
    [0.1, true, "avant"],
    [Number.NaN, false, "dans"],
  ] as const)("should read %s of the line height (unfolded branch: %s) as %s", (fraction, depliee, zone) => {
    expect(zoneDuPointeur(fraction, depliee)).toBe(zone)
  })
})

describe("placeDuDepot", () => {
  it.each([
    ["devis", "offres", "avant", { after: null }],
    ["devis", "conseil", "avant", { after: "offres" }],
    ["offres", "tarifs", "apres", { after: "tarifs" }],
    ["offres", "conseil", "avant", null],
    ["conseil", "offres", "apres", null],
    ["ailleurs/page", "offres", "avant", { after: null }],
    ["ailleurs/page", "devis", "apres", { after: "devis" }],
  ] as const)("should put %s dropped on %s (%s) after %j", (source, cible, zone, place) => {
    expect(placeDuDepot(FRERES, source, cible, zone)).toEqual(place)
  })
})

describe("placeDuPas", () => {
  it.each([
    ["offres", -1, null],
    ["conseil", -1, { after: null }],
    ["tarifs", -1, { after: "offres" }],
    ["tarifs", 1, { after: "devis" }],
    ["devis", 1, null],
  ] as const)("should move %s by %s after %j", (chemin, pas, place) => {
    expect(placeDuPas(FRERES, chemin, pas)).toEqual(place)
  })
})
