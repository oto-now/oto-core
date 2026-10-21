// La jauge du budget sur la page d'un Contexte (décidé par JB le 20/10/2026, une phrase sans barre depuis le 21/10) : ce que
// l'assistant reçoit sur le budget, au-delà ce qui arrive, et le poids du Contexte ; l'état par une icône, dit au lecteur
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

/** La phrase de la jauge, les espaces du format français (fines insécables) lus comme des espaces. */
const phrase = () => (screen.getByText(/^Votre assistant reçoit/).textContent ?? "").replace(/\s/g, " ")

afterEach(cleanup)

describe("JaugeDuBudget", () => {
  it("should say in one sentence what the assistant receives on the budget and what this Contexte weighs, everything fitting", () => {
    render(<JaugeDuBudget apercu={apercu(13_971, 64)} cheminCourant="ventes/contexte" />)
    expect(phrase()).toBe("Votre assistant reçoit 13 971 caractères de contexte sur 35 000 possibles ; celui-ci en pèse 64.")
    expect(screen.getByText("Tout tient.")).toHaveClass("oto-sr-only")
    expect(screen.queryByRole("meter")).toBeNull()
  })

  it("should say what happens beyond the budget", () => {
    render(<JaugeDuBudget apercu={apercu(41_000, 9_000)} cheminCourant="ventes/contexte" />)
    expect(phrase()).toBe("Votre assistant reçoit 41 000 caractères de contexte sur 35 000 possibles : la suite est coupée ou résumée. Celui-ci en pèse 9 000.")
    expect(screen.getByText("Le plafond est dépassé.")).toHaveClass("oto-sr-only")
  })

  it("should say a Contexte not served yet, and show nothing without the whole weights", () => {
    render(<JaugeDuBudget apercu={apercu(3_000, null)} cheminCourant="ventes/contexte" />)
    expect(phrase()).toBe("Votre assistant reçoit 3 000 caractères de contexte sur 35 000 possibles ; celui-ci n'est pas encore servi.")
    cleanup()
    const { container } = render(<JaugeDuBudget apercu={{ ...apercu(3_000, null), whole: undefined }} cheminCourant="ventes/contexte" />)
    expect(container).toBeEmptyDOMElement()
  })
})
