import { describe, expect, it } from "vitest"
import { ecransPermis } from "../../packages/plateforme/ui/coque/ecrans"
import { GLYPHES_DE_L_HOTE } from "../../packages/plateforme/ui/coque/glyphes-de-l-hote"
import type { AdressesDuRail } from "../../packages/plateforme/ui/coque/types"

// L'écran d'abonnement de l'hôte (E12-S02) : rangé aux réglages de l'entreprise pour qui administre, quand l'hôte en
// donne l'adresse ; absent sinon, comme tout écran que l'hôte ne sert pas.

describe("ecransPermis, abonnement (E12-S02)", () => {
  const adresses = { pages: "/n/", organisation: "/admin/organization", abonnement: "/admin/billing" }

  it("should list the host's subscription screen under the settings, for an administrator only", () => {
    expect(ecransPermis(adresses, true).find((ecran) => ecran.adresse === "/admin/billing")).toMatchObject({ libelle: "Abonnement", rangement: "reglages" })
    expect(ecransPermis(adresses, false).map((ecran) => ecran.adresse)).not.toContain("/admin/billing")
  })

  it("should list nothing when the host gives no address", () => {
    expect(ecransPermis({ pages: "/n/", organisation: "/admin/organization" }, true).map((ecran) => ecran.libelle)).not.toContain("Abonnement")
  })
})

// Les écrans propres à l'hôte (décision du 2026-10-14) : dans la même table que ceux du paquet, après eux dans leur
// rangement ; ceux d'administration pour qui administre ; un glyphe nommé dans la table fermée ; une adresse unique.
describe("ecransPermis, the host's own screens", () => {
  const PAQUET = { pages: "/n/", accueil: "/", organisation: "/admin/organization", equipes: "/teams", connecteurs: "/admin/connectors" }
  const adresses = {
    ...PAQUET,
    ecransDeLHote: [
      { libelle: "Rapports", adresse: "/reports", glyphe: "ChartBar", rangement: "tete" },
      { libelle: "Facturation", adresse: "/admin/invoicing", glyphe: "Receipt", rangement: "reglages", admin: true },
      { libelle: "Aide", adresse: "/help", rangement: "pied" },
    ],
  } satisfies AdressesDuRail

  it("should change nothing for a host that passes no screen of its own", () => {
    expect(ecransPermis({ ...PAQUET, ecransDeLHote: [] }, true)).toEqual(ecransPermis(PAQUET, true))
  })

  it("should range Accueil first in the head, then the host's screens after the package's in each place", () => {
    const parRangement = (rangement: string) =>
      ecransPermis(adresses, true)
        .filter((ecran) => ecran.rangement === rangement)
        .map((ecran) => ecran.libelle)
    expect(parRangement("tete")).toEqual(["Accueil", "Rapports"])
    expect(parRangement("reglages")).toEqual(["Organisation", "Équipes & accès", "Facturation"])
    expect(parRangement("pied")).toEqual(["Connecteurs", "Aide"])
  })

  it("should keep a host's administration screen for an administrator, by the rule of the package's", () => {
    expect(ecransPermis(adresses, true).map((ecran) => ecran.adresse)).toContain("/admin/invoicing")
    expect(ecransPermis(adresses, false).map((ecran) => ecran.adresse)).toEqual(["/", "/teams", "/reports", "/help"])
  })

  it("should read the glyph from its name in the closed table, an application window without one", () => {
    const ecrans = ecransPermis(adresses, true)
    expect(ecrans.find((ecran) => ecran.adresse === "/reports")?.glyphe).toBe(GLYPHES_DE_L_HOTE.ChartBar)
    expect(ecrans.find((ecran) => ecran.adresse === "/help")?.glyphe).toBe(GLYPHES_DE_L_HOTE.AppWindow)
  })

  it("should throw on a glyph outside the table, naming it", () => {
    const inconnu = { ...PAQUET, ecransDeLHote: [{ libelle: "Rapports", adresse: "/reports", glyphe: "Licorne", rangement: "tete" }] } as unknown as AdressesDuRail
    expect(() => ecransPermis(inconnu, true)).toThrow("glyphe inconnu « Licorne »")
  })

  it.each([
    ["a package screen", "/admin/organization"],
    ["another host screen", "/reports"],
  ])("should throw on an address already taken by %s", (_ecran, adresse) => {
    const doublon = { ...adresses, ecransDeLHote: [...adresses.ecransDeLHote, { libelle: "Doublon", adresse, rangement: "hors-menu" as const }] }
    expect(() => ecransPermis(doublon, true)).toThrow(`l'adresse « ${adresse} » est déjà celle d'un autre écran`)
  })
})
