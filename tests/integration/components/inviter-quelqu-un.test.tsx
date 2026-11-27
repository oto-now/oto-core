import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { InviterQuelquUn } from "@otomata_tech/oto_platform/ui"
import { libellesDesChoix } from "../../helpers/liste-de-choix"

const VENTES = { id: "0e8e5a3c-7f10-4a5b-8d3b-2b1c4d5e6f70", nom: "Ventes" }
const SUPPORT = { id: "5b0d1c56-0f3a-4a57-9d8e-6f1f1b9e2c11", nom: "Support" }

const fetchMock = vi.fn<typeof fetch>()
// Sans fournisseur de relecture, la page se recharge après un envoi réussi (E05-S03, AC3, AC5).
const reload = vi.fn()

function reponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

function refus(status: number, code: string, reason?: string): Response {
  return reponse(status, { error: { code, message: "server text", ...(reason ? { details: { reason } } : {}) } })
}

function rendreAdmin() {
  return render(<InviterQuelquUn equipes={[VENTES, SUPPORT]} rolesPermis={["member", "admin"]} equipeObligatoire={false} />)
}

function saisirEtEnvoyer(email: string) {
  fireEvent.change(screen.getByLabelText("Adresse email"), { target: { value: email } })
  fireEvent.click(screen.getByRole("button", { name: "Envoyer l'invitation" }))
}

beforeEach(() => {
  fetchMock.mockReset()
  reload.mockReset()
  vi.stubGlobal("fetch", fetchMock)
  vi.stubGlobal("location", { ...window.location, reload })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/** Les cases du groupe « Équipes », par libellé, et si chacune est cochée. */
function casesDesEquipes() {
  const groupe = screen.getByRole("group", { name: "Équipes" })
  return within(groupe)
    .getAllByRole("checkbox")
    .map((boite) => [boite.closest("label")?.textContent, (boite as HTMLInputElement).checked])
}

describe("InviterQuelquUn fields", () => {
  it("should offer email, role and one unchecked box per team to an administrator, with the help under them", () => {
    rendreAdmin()

    expect(screen.getByLabelText("Adresse email")).toHaveAttribute("type", "email")
    const role = screen.getByLabelText("Rôle")
    expect(libellesDesChoix(role)).toEqual(["Membre", "Administrateur"])
    expect(casesDesEquipes()).toEqual([
      ["Ventes", false],
      ["Support", false],
    ])
    expect(screen.getByRole("group", { name: "Équipes" })).toHaveAccessibleDescription("Elle rejoint les équipes cochées à sa première connexion.")
    expect(screen.getByRole("button", { name: "Envoyer l'invitation" })).toBeEnabled()
  })

  it("should hide the role and check the only team of a team lead", () => {
    render(<InviterQuelquUn equipes={[VENTES]} rolesPermis={["member"]} equipeObligatoire />)

    expect(screen.queryByLabelText("Rôle")).toBeNull()
    expect(casesDesEquipes()).toEqual([["Ventes", true]])
  })

  it("should require a lead to check one of her teams, under the list, before calling the API", async () => {
    render(<InviterQuelquUn equipes={[VENTES, SUPPORT]} rolesPermis={["member"]} equipeObligatoire />)

    saisirEtEnvoyer("new@x.test")

    expect(await screen.findByText("Cochez au moins une de vos équipes.")).toBeInTheDocument()
    expect(screen.getByRole("group", { name: "Équipes" })).toHaveAccessibleDescription("Cochez au moins une de vos équipes.")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("should mount the status region empty from the start", () => {
    rendreAdmin()
    expect(screen.getByRole("status")).toBeEmptyDOMElement()
  })
})

describe("InviterQuelquUn submission", () => {
  it("should post the shared schema output and announce the email that left", async () => {
    fetchMock.mockResolvedValue(reponse(201, { data: { invitation: { email: "new@x.test" }, emailed: true } }))
    rendreAdmin()
    fireEvent.click(screen.getByRole("checkbox", { name: "Support" }))
    fireEvent.click(screen.getByRole("checkbox", { name: "Ventes" }))

    saisirEtEnvoyer("  New@X.test ")

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Invitation envoyée : un email vient de partir à new@x.test"),
    )
    expect(screen.getByLabelText("Adresse email")).toHaveValue("")
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("/api/platform/invitations")
    expect(init?.method).toBe("POST")
    expect(JSON.parse(String(init?.body))).toEqual({ email: "new@x.test", role: "member", teamIds: [SUPPORT.id, VENTES.id] })
  })

  it("should have the page re-read after sending, the invitation then listed as pending (E05-S03, AC5)", async () => {
    fetchMock.mockResolvedValue(reponse(201, { data: { invitation: { email: "new@x.test" }, emailed: true } }))
    rendreAdmin()

    saisirEtEnvoyer("new@x.test")

    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
  })

  it("should not re-read the page after a refusal", async () => {
    fetchMock.mockResolvedValue(refus(409, "conflict", "already_invited"))
    rendreAdmin()

    saisirEtEnvoyer("m@x.test")

    await screen.findByText("Une invitation attend déjà cette adresse. Révoquez-la pour en envoyer une autre.")
    expect(reload).not.toHaveBeenCalled()
  })

  it("should disable the button while sending", async () => {
    let terminer: (value: Response) => void = () => {}
    fetchMock.mockReturnValue(new Promise<Response>((resolve) => (terminer = resolve)))
    rendreAdmin()

    saisirEtEnvoyer("new@x.test")

    const bouton = await screen.findByRole("button", { name: "Envoi…" })
    expect(bouton).toBeDisabled()
    expect(bouton).toHaveAttribute("aria-busy", "true")
    await act(async () => terminer(reponse(201, { data: { invitation: { email: "new@x.test" }, emailed: true } })))
    expect(await screen.findByRole("button", { name: "Envoyer l'invitation" })).toBeEnabled()
  })

  it("should refuse a malformed email before calling the API", async () => {
    rendreAdmin()

    saisirEtEnvoyer("pas-une-adresse")

    expect(await screen.findByText("Saisissez une adresse email valide.")).toBeInTheDocument()
    expect(screen.getByLabelText("Adresse email")).toHaveAttribute("aria-invalid", "true")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // Un refus lié à l'adresse et un refus global prouvent chacun sa place (M11b) : les autres codes
  // (`already_member`, `invalid_arguments`, `team_required`, `not_allowed`, `internal`, panne réseau),
  // autres entrées des mêmes tables de messages, sont retirés.
  it("should show a refusal tied to the address under the email field", async () => {
    fetchMock.mockResolvedValue(refus(409, "conflict", "already_invited"))
    rendreAdmin()

    saisirEtEnvoyer("m@x.test")

    const erreur = await screen.findByText("Une invitation attend déjà cette adresse. Révoquez-la pour en envoyer une autre.")
    expect(screen.getByLabelText("Adresse email")).toHaveAttribute("aria-describedby", erreur.id)
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("should show any other refusal as a global alert", async () => {
    fetchMock.mockResolvedValue(refus(401, "forbidden"))
    rendreAdmin()

    saisirEtEnvoyer("m@x.test")

    expect(await screen.findByRole("alert")).toHaveTextContent("Votre session a expiré. Reconnectez-vous.")
  })
})
