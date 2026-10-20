// La jauge du budget sur la page d'un Contexte (décidé par JB le 20/10/2026) : une barre fine et une ligne, tout ce que
// l'assistant recevrait sans plafond sur le budget et le poids du Contexte ; l'état réduit à une icône, dit au lecteur
// d'écran ; rien sans le poids entier.
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { JaugeDuBudget } from "../../../packages/plateforme/ui/contexte/jauge-du-budget"

type Apercu = Parameters<typeof JaugeDuBudget>[0]["apercu"]

const apercu = (total: number, poids: number | null, budget = 35_000): Apercu => ({
  text: "",
  budget,
  blocks: [],
  whole: { total, blocks: [{ name: "code", chars: 3_000 }, ...(poids === null ? [] : [{ name: "ventes/contexte", chars: poids }])] },
})

/** Les espaces du format français (fines insécables) lus comme des espaces. */
const texte = (valeur: string | null) => (valeur ?? "").replace(/\s/g, " ")

const jauge = () => screen.getByRole("meter", { name: "Part du budget du contexte" })

afterEach(cleanup)

describe("JaugeDuBudget", () => {
  it("should give the whole served on the budget and the weight of this Contexte on one line, saying everything fits to a screen reader", () => {
    render(<JaugeDuBudget apercu={apercu(12_400, 3_100)} cheminCourant="ventes/contexte" />)
    expect(jauge()).toHaveAttribute("aria-valuenow", "12400")
    expect(jauge()).toHaveAttribute("aria-valuemax", "35000")
    expect(texte(screen.getByText(/ce contexte/).textContent)).toBe("12 400 / 35 000 caractères · ce contexte 3 100")
    expect(screen.getByText("Tout tient : votre assistant reçoit chaque partie en entier.")).toHaveClass("oto-sr-only")
    expect(texte(jauge().getAttribute("aria-valuetext"))).toBe("12 400 / 35 000 caractères · ce contexte 3 100. Tout tient : votre assistant reçoit chaque partie en entier.")
  })

  it("should say what happens beyond the budget", () => {
    render(<JaugeDuBudget apercu={apercu(41_000, 9_000)} cheminCourant="ventes/contexte" />)
    expect(jauge()).toHaveAttribute("aria-valuenow", "35000")
    expect(screen.getByText(/^Au-delà du budget, les dernières parties sont coupées\./)).toBeInTheDocument()
    expect(screen.queryByText(/^Tout tient/)).toBeNull()
  })

  it("should say a Contexte not served yet, and show nothing without the whole weights", () => {
    render(<JaugeDuBudget apercu={apercu(3_000, null)} cheminCourant="ventes/contexte" />)
    expect(texte(screen.getByText(/ce contexte/).textContent)).toBe("3 000 / 35 000 caractères · ce contexte pas encore servi")
    cleanup()
    const { container } = render(<JaugeDuBudget apercu={{ ...apercu(3_000, null), whole: undefined }} cheminCourant="ventes/contexte" />)
    expect(container).toBeEmptyDOMElement()
  })
})
