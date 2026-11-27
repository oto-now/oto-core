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
  render(
    <CoquilleOto pleinePage>
      <ContexteDeLHote.Provider value={hote}>
        <PiedDuRail compte="Claire Morel" handle={null} adresses={{ pages: "/n/", profil: "/profile" }} administre={false} />
      </ContexteDeLHote.Provider>
    </CoquilleOto>,
  )
  fireEvent.click(screen.getByRole("button", { name: "Compte : Claire Morel. Ouvrir le menu" }))
  return within(screen.getByRole("menu"))
    .getAllByRole("menuitem")
    .map((item) => item.textContent)
}

describe("day or night in the account menu", () => {
  it("should offer the other mode above the sign-out when the host gives it, and call the host", () => {
    const basculer = vi.fn()
    expect(pied({ mode: "light", basculer })).toEqual(["Profil", "Mode sombre", "Déconnexion"])
    fireEvent.click(screen.getByRole("menuitem", { name: "Mode sombre" }))
    expect(basculer).toHaveBeenCalledTimes(1)
    cleanup()
    expect(pied({ mode: "dark", basculer })).toEqual(["Profil", "Mode clair", "Déconnexion"])
  })

  it("should offer nothing without the host's mode", () => {
    expect(pied()).toEqual(["Profil", "Déconnexion"])
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
