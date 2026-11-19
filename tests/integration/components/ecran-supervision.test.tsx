import type { AnchorHTMLAttributes } from "react"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import type { SupervisedOrg } from "@otomata_tech/oto_platform/schemas"
import { EcranSupervision, EcranSupervisionChargement } from "@otomata_tech/oto_platform/ui"

// L'écran « Supervision » de la plateforme (administration et cellule, N9) : un tableau des espaces et leurs chiffres ;
// une ligne s'ouvre (`<details>`) sur ses membres et rôles, puis ses comptes par connecteur et titulaire ; l'échec, le
// vide et le chargement.

const ACME: SupervisedOrg = {
  id: "b0000000-0000-4000-8000-000000000001",
  slug: "acme",
  name: "Acme Test",
  prefix: "acme",
  createdAt: "2026-09-10T08:00:00.000Z",
  members: 2,
  teams: 1,
  calls: 1234,
  activeConnectors: 1,
  accounts: 3,
  people: [
    { userId: "a1", email: "ada@acme.test", name: "Ada Martin", role: "admin", since: "2026-09-10T08:00:00.000Z" },
    { userId: "a2", email: null, name: "Claire Morel", role: "member", since: "2026-09-11T08:00:00.000Z" },
  ],
  accountGroups: [
    { connector: "mail", ownerKind: "team", ownerLabel: "Ventes", status: "active", mode: "simule", accounts: 2 },
    { connector: "mail", ownerKind: "user", ownerLabel: "ada@acme.test", status: "disabled", mode: "reel", accounts: 1 },
  ],
}

function Lien({ children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return <a {...props}>{children}</a>
}

afterEach(() => {
  cleanup()
})

describe("EcranSupervision", () => {
  it("should list each space with its figures, and open a row on its members, roles and accounts by connector and owner", () => {
    render(<EcranSupervision resultat={{ data: [ACME] }} Lien={Lien} ici="/platform/supervision" />)
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Supervision")
    const table = screen.getByRole("table", { name: "Espaces de la plateforme" })
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
      "Espace",
      "Identifiant",
      "Membres",
      "Appels (30 j)",
      "Connecteurs actifs",
      "Comptes",
    ])
    const [ligne] = within(table).getAllByRole("row").slice(1)
    expect(within(ligne).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["Acme Test", "acme", "2", "1 234", "1", "3"])
    fireEvent.click(screen.getByText("Membres et comptes de Acme Test"))
    expect(within(screen.getByRole("region", { name: "Membres de Acme Test" })).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "ada@acme.test · Administrateur · depuis le 10 septembre 2026",
      "Claire Morel · Membre · depuis le 11 septembre 2026",
    ])
    expect(within(screen.getByRole("region", { name: "Comptes de Acme Test" })).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "mail · Équipe Ventes · actif · simulé · 2 comptes",
      "mail · ada@acme.test · désactivé · réel · 1 compte",
    ])
  })

  it("should say an empty platform, a failed read with « Réessayer », and the loading state", () => {
    const { unmount } = render(<EcranSupervision resultat={{ data: [] }} Lien={Lien} ici="/platform/supervision" />)
    expect(screen.getByText("Aucun espace sur cette plateforme.")).toBeInTheDocument()
    expect(screen.queryByRole("table")).toBeNull()
    unmount()
    const echec = render(<EcranSupervision resultat={{ error: "Une erreur est survenue. Réessayez." }} Lien={Lien} ici="/platform/supervision" />)
    expect(screen.getByRole("alert")).toHaveTextContent("Une erreur est survenue. Réessayez.")
    expect(screen.getByRole("link", { name: "Réessayer" })).toHaveAttribute("href", "/platform/supervision")
    echec.unmount()
    render(<EcranSupervisionChargement />)
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true")
  })
})
