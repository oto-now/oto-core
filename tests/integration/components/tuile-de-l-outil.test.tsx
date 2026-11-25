// La tuile d'un outil de l'écran Connecteurs : le logo relayé par la plateforme quand l'outil déclare son domaine,
// l'initiale sans domaine, après un échec de chargement, et pour un logo déjà en échec avant le montage (hydratation).
import { cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { TuileDeLOutil } from "../../../packages/plateforme/ui/admin/connecteurs/tuile-de-l-outil"

const LOGO = "/api/platform/connectors/crm/logo"

/** Ce que la tuile montre : l'adresse de son image, sinon son texte. */
const montre = (conteneur: HTMLElement) => conteneur.querySelector("img")?.getAttribute("src") ?? conteneur.textContent

/** Une image que jsdom ne charge pas : encore en cours (`complete` faux), ou chargée sans pixel (un échec). */
function images(etat: "en_cours" | "en_echec") {
  vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(etat === "en_echec")
  vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(0)
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("TuileDeLOutil", () => {
  it("should show the logo of a tool that declares its domain, its initial without one, and its initial once the logo fails", () => {
    images("en_cours")
    const avecLogo = render(<TuileDeLOutil nom="Crm Pro" logo={LOGO} />).container
    const sansLogo = render(<TuileDeLOutil nom="mail" logo={null} />).container
    expect([montre(avecLogo), montre(sansLogo)]).toEqual([LOGO, "M"])
    const image = avecLogo.querySelector("img")
    if (!image) throw new Error("no logo")
    fireEvent.error(image)
    expect(montre(avecLogo)).toBe("C")
  })

  it("should show the initial of a logo that failed before the tile was mounted", () => {
    images("en_echec")
    expect(montre(render(<TuileDeLOutil nom="Crm Pro" logo={LOGO} />).container)).toBe("C")
  })
})
