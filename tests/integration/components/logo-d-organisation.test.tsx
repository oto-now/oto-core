// Le seul « logo, sinon initiale » du paquet : le logo d'une organisation, la tuile d'un outil, et l'initiale sans logo,
// après un échec de chargement, et pour un logo déjà en échec avant le montage (hydratation).
import { cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { LogoDOrganisation } from "@otomata_tech/oto_platform/ui"

const LOGO = "/api/platform/connectors/crm/logo"

/** Ce que le logo montre : l'adresse de son image, sinon son texte. */
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

describe("LogoDOrganisation", () => {
  it("should render the logo as a decorative image of the given size, without referrer", () => {
    const { container } = render(<LogoDOrganisation nom="Démo" logo="https://example.com/logo.png" taille={32} />)

    const image = container.querySelector("img")
    expect(image).toHaveAttribute("src", "https://example.com/logo.png")
    expect(image).toHaveAttribute("alt", "")
    expect(image).toHaveAttribute("aria-hidden", "true")
    expect(image).toHaveAttribute("referrerpolicy", "no-referrer")
    expect(image).toHaveAttribute("width", "32")
    expect(image).toHaveAttribute("height", "32")
    expect(image).toHaveStyle({ width: "32px", height: "32px" })
  })

  it("should render the first letter of the name in a square ringed by the design system's hairline without a logo", () => {
    const { container } = render(<LogoDOrganisation nom="  énergies du Sud" logo={null} taille={40} />)

    const lettre = container.firstElementChild
    expect(lettre?.tagName).toBe("SPAN")
    expect(lettre).toHaveTextContent(/^É$/)
    expect(lettre).toHaveAttribute("aria-hidden", "true")
    expect(lettre).toHaveClass("ring-hair")
    expect(lettre).toHaveStyle({ width: "40px", height: "40px" })
    expect(container.querySelector("img")).toBeNull()
  })

  it("should show the logo of a tool tile, its initial without one, and its initial once the logo fails", () => {
    images("en_cours")
    const avecLogo = render(<LogoDOrganisation nom="Crm Pro" logo={LOGO} taille={40} tuile />).container
    const sansLogo = render(<LogoDOrganisation nom="mail" logo={null} taille={40} tuile />).container
    expect([montre(avecLogo), montre(sansLogo)]).toEqual([LOGO, "M"])
    const image = avecLogo.querySelector("img")
    if (!image) throw new Error("no logo")
    fireEvent.error(image)
    expect(montre(avecLogo)).toBe("C")
  })

  it("should show the initial of a logo that failed before it was mounted", () => {
    images("en_echec")
    expect(montre(render(<LogoDOrganisation nom="Démo" logo="https://example.com/logo.png" taille={32} />).container)).toBe("D")
  })
})
