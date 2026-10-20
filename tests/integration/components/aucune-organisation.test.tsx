import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  AucuneOrganisation,
  AucuneOrganisationChargement,
  type ResultatAucuneOrganisation,
} from "@otomata_tech/oto_platform/ui"

afterEach(cleanup)

// E05-S07 : l'écran est l'îlot du gabarit des écrans d'authentification. Son titre devient le `h2`
// de l'îlot (le `h1`, « Oto », est celui du gabarit, que la page pose), « Se déconnecter » va au pied.

function rendre(resultat: ResultatAucuneOrganisation) {
  return render(<AucuneOrganisation resultat={resultat} actionDeDeconnexion={vi.fn()} />)
}

describe("AucuneOrganisation", () => {
  it("should name the organisation and whom to ask for a non-member", () => {
    rendre({
      data: {
        email: "claire@ailleurs.test",
        hote: "acme.oto.cx",
        organisation: { nom: "Acme Énergies", contact: { nom: "Paul Martin", email: "paul@acme.test" } },
      },
    })

    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Vous n'êtes pas membre de Acme Énergies")
    expect(screen.getByText("Pour y entrer, demandez à Paul Martin (paul@acme.test) de vous inviter.")).toBeInTheDocument()
    expect(screen.getByText("Si vous avez reçu une invitation, ouvrez le lien de son email.")).toBeInTheDocument()
    expect(screen.getByText("Connecté·e avec claire@ailleurs.test.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Se déconnecter" })).toBeInTheDocument()
  })

  // 1.4.12 : à l'adresse commune, les organisations de la personne, chacune à son adresse.
  it("should list the organisations of the person, each linked to its address, at an address that names none", () => {
    rendre({
      data: {
        email: "claire@acme.test",
        hote: "oto.cx",
        organisation: null,
        organisations: [
          { nom: "Acme", adresse: "https://acme.oto.cx" },
          { nom: "Démo", adresse: "https://demo.oto.cx" },
        ],
      },
    })

    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Vos organisations")
    expect(screen.getByRole("link", { name: "Acme" })).toHaveAttribute("href", "https://acme.oto.cx")
    expect(screen.getByRole("link", { name: "Démo" })).toHaveAttribute("href", "https://demo.oto.cx")
    expect(screen.getByText("Connecté·e avec claire@acme.test.")).toBeInTheDocument()
  })

  it("should fall back on the administrators without a contact", () => {
    rendre({
      data: { email: "claire@ailleurs.test", hote: "acme.oto.cx", organisation: { nom: "Acme", contact: null } },
    })

    expect(screen.getByText("Demandez à un administrateur de Acme de vous inviter.")).toBeInTheDocument()
  })

  it("should render the unknown address state", () => {
    rendre({ data: { email: "claire@ailleurs.test", hote: "nulle-part.test", organisation: null } })

    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Adresse inconnue")
    expect(
      screen.getByText(
        "L'adresse nulle-part.test ne correspond à aucune organisation. Vérifiez l'adresse reçue dans votre invitation.",
      ),
    ).toBeInTheDocument()
    expect(screen.getByText("Connecté·e avec claire@ailleurs.test.")).toBeInTheDocument()
  })

  it("should announce the error message", () => {
    rendre({ error: "Impossible de vérifier votre accès." })

    expect(screen.getByRole("alert")).toHaveTextContent("Impossible de vérifier votre accès.")
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Aucune organisation")
    expect(screen.getByRole("button", { name: "Se déconnecter" })).toBeInTheDocument()
  })

  it("should render no h1 and exactly one h2, the title of the state, naming its island, in every state", () => {
    const etats: ResultatAucuneOrganisation[] = [
      { data: { email: "a@b.test", hote: "x.test", organisation: { nom: "X", contact: null } } },
      { data: { email: "a@b.test", hote: "x.test", organisation: null } },
      { error: "Panne." },
    ]
    for (const resultat of etats) {
      rendre(resultat)
      expect(screen.queryAllByRole("heading", { level: 1 })).toHaveLength(0)
      const titres = screen.getAllByRole("heading", { level: 2 })
      expect(titres).toHaveLength(1)
      expect(screen.getByRole("region", { name: titres[0].textContent ?? "" })).toBeInTheDocument()
      cleanup()
    }
  })
})

describe("AucuneOrganisationChargement", () => {
  it("should expose a busy status with a readable label", () => {
    render(<AucuneOrganisationChargement />)
    const statut = screen.getByRole("status")
    expect(statut).toHaveAttribute("aria-busy", "true")
    expect(statut).toHaveTextContent("Vérification de votre organisation…")
  })
})
