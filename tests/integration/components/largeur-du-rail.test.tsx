// La largeur du rail à la main (`PoigneeDuRail`) : au clavier, au double-clic, gardée dans ce navigateur ; la ligne
// courante amenée dans le champ du rail (`amenerEnVue`), en hauteur et en largeur.
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { RAIL } from "../../../packages/plateforme/ui/coque/libelles"
import { amenerEnVue, defilementEnLargeur } from "../../../packages/plateforme/ui/coque/ligne-courante-en-vue"
import { PoigneeDuRail } from "../../../packages/plateforme/ui/coque/poignee-du-rail"

function monter() {
  render(
    <div className="oto-desk">
      <nav className="oto-rail">
        <PoigneeDuRail />
      </nav>
    </div>,
  )
  return screen.getByRole("separator", { name: RAIL.largeur })
}

describe("PoigneeDuRail", () => {
  beforeEach(() => {
    window.localStorage.clear()
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 })
  })
  afterEach(cleanup)

  it("should widen with the keyboard, stay between 200 px and 40 % of the window, and keep the width", () => {
    const poignee = monter()
    expect(poignee.getAttribute("aria-valuenow")).toBe("232")
    fireEvent.keyDown(poignee, { key: "ArrowRight" })
    expect(poignee.getAttribute("aria-valuenow")).toBe("248")
    expect(window.localStorage.getItem("oto-rail-largeur")).toBe("248")
    fireEvent.keyDown(poignee, { key: "End" })
    expect(poignee.getAttribute("aria-valuenow")).toBe("576")
    fireEvent.keyDown(poignee, { key: "Home" })
    expect(poignee.getAttribute("aria-valuenow")).toBe("200")
  })

  it("should take the kept width back, and restore the original width on a double click", () => {
    window.localStorage.setItem("oto-rail-largeur", "300")
    const poignee = monter()
    expect(poignee.getAttribute("aria-valuenow")).toBe("300")
    fireEvent.doubleClick(poignee)
    expect(poignee.getAttribute("aria-valuenow")).toBe("232")
    expect(window.localStorage.getItem("oto-rail-largeur")).toBeNull()
  })
})

describe("amenerEnVue", () => {
  const boite = (gauche: number, haut: number, largeur: number, hauteur: number) =>
    // Une boîte simulée : jsdom ne calcule aucune mise en page, et `DOMRect` n'a pas de constructeur sous jsdom.
    ({ left: gauche, top: haut, right: gauche + largeur, bottom: haut + hauteur, width: largeur, height: hauteur, x: gauche, y: haut }) as DOMRect

  function cadre(ligne: DOMRect) {
    const conteneur = document.createElement("div")
    const element = document.createElement("a")
    conteneur.getBoundingClientRect = () => boite(0, 0, 232, 400)
    element.getBoundingClientRect = () => ligne
    return { conteneur, element }
  }

  it("should scroll down to a line below the view, and not sideways for a first-level line that overflows", () => {
    const { conteneur, element } = cadre(boite(120, 600, 300, 28))
    const arbre = document.createElement("ul")
    arbre.className = "oto-rail-tree"
    arbre.append(element)
    conteneur.append(arbre)
    amenerEnVue(conteneur, element)
    expect(conteneur.scrollTop).toBe(236)
    expect(conteneur.scrollLeft).toBe(0)
  })

  it("should not scroll for a line already in view", () => {
    const { conteneur, element } = cadre(boite(16, 100, 200, 28))
    amenerEnVue(conteneur, element)
    expect(conteneur.scrollTop).toBe(0)
    expect(conteneur.scrollLeft).toBe(0)
  })
})

// 1.5.1 : en largeur, un pas de retrait par niveau sous le premier, jamais plus, et seulement si la ligne dépasse.
describe("defilementEnLargeur", () => {
  it.each([
    { profondeur: 1, pas: 16, deborde: true, actuel: 0, attendu: 0 },
    { profondeur: 2, pas: 16, deborde: true, actuel: 0, attendu: 16 },
    { profondeur: 3, pas: 16, deborde: true, actuel: 0, attendu: 32 },
    { profondeur: 3, pas: 16, deborde: true, actuel: 200, attendu: 32 },
    { profondeur: 3, pas: 16, deborde: false, actuel: 40, attendu: 40 },
    { profondeur: 0, pas: 16, deborde: true, actuel: 0, attendu: 0 },
  ])("should scroll a line at depth $profondeur (overflowing $deborde, from $actuel) to $attendu", ({ profondeur, pas, deborde, actuel, attendu }) => {
    expect(defilementEnLargeur(profondeur, pas, deborde, actuel)).toBe(attendu)
  })
})
