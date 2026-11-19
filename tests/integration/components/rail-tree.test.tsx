// L'arbre du rail (`RailTree`) : la bascule d'une page qui a des sous-pages ne porte que le chevron, toujours là ; le
// glyphe de type reste dans le lien, sur une branche comme sur une feuille (retour RET-013).
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { RailTree } from "../../../packages/plateforme/ui/ds/react/rail-tree"

const glyphe = (type: string) => <span data-testid={`glyphe-${type}`} aria-hidden="true" />

afterEach(cleanup)

describe("RailTree", () => {
  it("should keep the type glyph in the link of a branch and of a leaf, and put only the chevron in the toggle", () => {
    render(
      <RailTree
        aria-label="Ventes"
        nodes={[
          { id: "dossier", label: "Dossier", href: "/n/ventes/dossier", icon: glyphe("page"), children: [{ id: "note", label: "Note", href: "/n/ventes/dossier/note", icon: glyphe("procedure") }] },
          { id: "seule", label: "Seule", href: "/n/ventes/seule", icon: glyphe("tableau") },
        ]}
      />,
    )
    const bascule = screen.getByRole("button", { name: "Déplier Dossier" })
    expect(within(bascule).queryByTestId("glyphe-page")).toBeNull()
    expect(bascule.querySelector(".oto-rail-chevron")).not.toBeNull()
    expect(within(screen.getByRole("link", { name: "Dossier" })).getByTestId("glyphe-page")).toBeInTheDocument()
    expect(within(screen.getByRole("link", { name: "Seule" })).getByTestId("glyphe-tableau")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Seule/ })).toBeNull()

    fireEvent.click(bascule)
    expect(screen.getByRole("button", { name: "Replier Dossier" })).toHaveAttribute("aria-expanded", "true")
    expect(within(screen.getByRole("link", { name: "Note" })).getByTestId("glyphe-procedure")).toBeInTheDocument()
  })
})
