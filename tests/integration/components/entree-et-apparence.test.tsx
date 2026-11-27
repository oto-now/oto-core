import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ContexteDeLHote, ContexteDeRafraichissement, CoquilleOto, type Hote } from "@otomata_tech/oto_platform/ui"
import { PiedDuRail } from "../../../packages/plateforme/ui/coque/pied-du-rail"
import { EntreeSansInvitation } from "../../../packages/plateforme/ui/equipes/entree-sans-invitation"

// Deux gestes que l'hôte ou l'administrateur règle : la bascule jour ou nuit du menu du compte, que l'hôte pilote
// (`Hote.apparence`), et l'entrée sans invitation de l'organisation, sous les membres. `fetch` simulé pour l'API.

const fetchMock = vi.fn<typeof fetch>()
const rafraichir = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  rafraichir.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function pied(apparence?: Hote["apparence"]) {
  const hote: Hote = { Lien: "a", chemin: "/", naviguer: vi.fn(), deconnecter: vi.fn(), apparence }
  const rendu = (vue: Hote) => (
    <CoquilleOto pleinePage>
      <ContexteDeLHote.Provider value={vue}>
        <PiedDuRail compte="Claire Morel" handle={null} adresses={{ pages: "/n/", profil: "/profile" }} administre={false} />
      </ContexteDeLHote.Provider>
    </CoquilleOto>
  )
  const { rerender } = render(rendu(hote))
  fireEvent.click(screen.getByRole("button", { name: "Compte : Claire Morel. Ouvrir le menu" }))
  return { rerender: (vue: Partial<Hote>) => rerender(rendu({ ...hote, ...vue })) }
}

const lignes = () => [...screen.getByRole("menu").querySelectorAll("[role^='menuitem']")].map((item) => [item.textContent, item.getAttribute("role"), item.getAttribute("aria-checked")])

// #221 : le mode sombre est un interrupteur du groupe « Apparence », coché quand l'hôte l'a mis ; le menu reste ouvert.
describe("day or night in the account menu", () => {
  it("should offer « Mode sombre » as a switch above the sign-out when the host gives the mode, checked in dark mode, and call the host", () => {
    const basculer = vi.fn()
    const { rerender } = pied({ mode: "light", basculer })
    expect(lignes()).toEqual([
      ["Profil", "menuitem", null],
      ["Mode sombre", "menuitemcheckbox", "false"],
      ["Déconnexion", "menuitem", null],
    ])
    expect(within(screen.getByRole("menu")).getByText("Apparence")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Mode sombre" }))
    expect(basculer).toHaveBeenCalledTimes(1)
    rerender({ apparence: { mode: "dark", basculer } })
    expect(screen.getByRole("menuitemcheckbox", { name: "Mode sombre" })).toHaveAttribute("aria-checked", "true")
  })

  it("should offer nothing without the host's mode", () => {
    pied()
    expect(lignes().map(([texte]) => texte)).toEqual(["Profil", "Déconnexion"])
    expect(within(screen.getByRole("menu")).queryByText("Apparence")).toBeNull()
  })
})

function entree(reglage = { enabled: false, email_domains: [] as string[] }) {
  render(
    <CoquilleOto pleinePage>
      <ContexteDeRafraichissement.Provider value={rafraichir}>
        <EntreeSansInvitation reglage={reglage} nomOrganisation="Démo" />
      </ContexteDeRafraichissement.Provider>
    </CoquilleOto>,
  )
}

describe("EntreeSansInvitation", () => {
  it("should refuse to open without a domain, before any request, then send the domains and say it is saved", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: { open_entry: { enabled: true, email_domains: ["acme.fr", "acme.com"] } } }), { status: 200, headers: { "content-type": "application/json" } }))
    entree()
    expect(screen.getByText(/entre dans Démo comme membre, sans équipe/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("checkbox", { name: "Ouvrir l'entrée sans invitation" }))
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }))
    expect(screen.getByText("Nommez au moins un domaine d'email pour ouvrir l'entrée.")).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText("Domaines d'email admis"), { target: { value: "Acme.fr,  acme.com" } })
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }))
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Enregistré."))
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/platform/admin/open-entry")
    expect(fetchMock.mock.calls[0][1]?.method).toBe("PATCH")
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ enabled: true, email_domains: ["Acme.fr", "acme.com"] })
    expect(screen.getByLabelText("Domaines d'email admis")).toHaveValue("acme.fr, acme.com")
    expect(rafraichir).toHaveBeenCalledTimes(1)
  })

  it("should say a malformed domain under the field, and a refusal of the server in an alert", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { code: "forbidden", message: "…" } }), { status: 403, headers: { "content-type": "application/json" } }))
    entree({ enabled: true, email_domains: ["acme.fr"] })
    fireEvent.change(screen.getByLabelText("Domaines d'email admis"), { target: { value: "@acme" } })
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }))
    expect(screen.getByText(/Écrivez un à 20 domaines d'email/)).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText("Domaines d'email admis"), { target: { value: "acme.fr" } })
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }))
    expect(await screen.findByRole("alert")).toBeInTheDocument()
    expect(rafraichir).not.toHaveBeenCalled()
  })
})
