import { describe, expect, it } from "vitest"
import { ecransPermis } from "../../packages/plateforme/ui/coque/ecrans"

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

// L'écran Connecteurs ouvert aux membres (`connecteurs-et-comptes.md` § Écran Connecteurs) : au pied du rail pour chacun,
// qui y voit ses comptes personnels ; l'hôte qui n'en sert pas l'adresse ne l'a pas.
describe("ecransPermis, Connecteurs", () => {
  it("should give Connecteurs at the foot of the rail to a member as to an administrator", () => {
    const adresses = { pages: "/n/", connecteurs: "/admin/connectors" }
    for (const administre of [true, false]) {
      expect(ecransPermis(adresses, administre).find((ecran) => ecran.adresse === "/admin/connectors")).toMatchObject({ libelle: "Connecteurs", rangement: "pied" })
    }
  })
})
