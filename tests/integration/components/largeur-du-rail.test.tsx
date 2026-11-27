// La largeur du rail à la main (`PoigneeDuRail`) : au clavier, au double-clic, gardée dans ce navigateur ; la ligne
// courante amenée dans le champ du rail (`amenerEnVue`), en hauteur seulement : le rail ne glisse jamais en largeur (D11).
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { RAIL } from "../../../packages/plateforme/ui/coque/libelles"
import { amenerEnVue } from "../../../packages/plateforme/ui/coque/ligne-courante-en-vue"
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

  // D11 (#87 appliqué partout) : quelle que soit la façon d'arriver sur la page, `scrollLeft` reste où la personne l'a laissé.
  it("should scroll only down for a deep line that overflows, leaving the sideways scroll where it was, 0 by default", () => {
    const verdicts = [0, 40].map((laisse) => {
      const { conteneur, element } = cadre(boite(120, 600, 300, 28))
      let parent: HTMLElement = conteneur
      for (let niveau = 0; niveau < 3; niveau++) {
        const arbre = document.createElement("ul")
        arbre.className = "oto-rail-tree"
        arbre.style.paddingInlineStart = "16px"
        parent.append(arbre)
        parent = arbre
      }
      parent.append(element)
      conteneur.scrollLeft = laisse
      amenerEnVue(conteneur, element)
      return [conteneur.scrollTop, conteneur.scrollLeft]
    })
    expect(verdicts).toEqual([
      [236, 0],
      [236, 40],
    ])
  })

  it("should not scroll for a line already in view", () => {
    const { conteneur, element } = cadre(boite(16, 100, 200, 28))
    amenerEnVue(conteneur, element)
    expect(conteneur.scrollTop).toBe(0)
    expect(conteneur.scrollLeft).toBe(0)
  })
})
