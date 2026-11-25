import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { AccountView, ConnectorAccountForm } from "@otomata_tech/oto_platform/schemas"
import { ContexteDeRafraichissement, EcranConnexionDUnConnecteur } from "@otomata_tech/oto_platform/ui"

// La page de connexion d'un connecteur, à l'étape de la clé d'un compte existant (`account_key`) : l'adresse d'une clé
// refusée par le tiers ou jamais posée. Le formulaire est celui du détail du compte ; enregistrée, la clé laisse la
// personne revenir à son assistant, sans relire la page. `fetch` simulé pour l'API.

const COMPTE: AccountView = {
  id: "6b2f3c1d-4e5a-4b6c-8d7e-9f0a1b2c3d41",
  label: "Crm Ventes",
  connector: "crm",
  owner: { kind: "team", teamName: "Ventes" },
  mode: "reel",
  status: "active",
  secret: { fields: ["api_key"], updatedAt: "2026-11-02T09:00:00.000Z" },
  settings: {},
  mark: { reason: "credential_rejected", at: "2026-11-24T09:00:00.000Z" },
  viewerLevel: "manage",
  description: null,
  lastProbe: null,
}
const FORMULAIRE: ConnectorAccountForm = {
  connector: "crm",
  label: "Crm Pro",
  ownerKinds: ["org", "team"],
  probe: { available: false, balance: false },
  fields: [{ name: "api_key", label: "Clé d'API", secret: true }],
  settings: [],
}

const fetchMock = vi.fn<typeof fetch>()
const rafraichir = vi.fn()

const reponse = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

beforeEach(() => {
  fetchMock.mockReset()
  rafraichir.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("EcranConnexionDUnConnecteur, the key of an existing account", () => {
  it("should show the key form of the account, send its new key, and invite back to the assistant", async () => {
    fetchMock.mockResolvedValue(reponse(200, { data: { account: { id: COMPTE.id } } }))
    render(
      <ContexteDeRafraichissement.Provider value={rafraichir}>
        <EcranConnexionDUnConnecteur
          outil="crm"
          resultat={{ data: { kind: "account_key", connector: "crm", label: "Crm Pro", space: "team:ventes", account: COMPTE, form: FORMULAIRE } }}
          reessayer="/connect/crm?space=team%3Aventes&account_id=6b2f3c1d-4e5a-4b6c-8d7e-9f0a1b2c3d41"
        />
      </ContexteDeRafraichissement.Provider>,
    )
    expect(screen.getByText("Collez la clé de Crm Pro du compte « Crm Ventes » ; elle remplace l'ancienne, part chiffrée, et ne se réaffiche jamais.")).toBeInTheDocument()
    const formulaire = within(screen.getByRole("form", { name: "Clé et réglages de Crm Ventes" }))
    expect(formulaire.getByLabelText("Clé d'API")).toHaveAttribute("type", "password")
    fireEvent.change(formulaire.getByLabelText("Clé d'API"), { target: { value: "n3uve" } })
    fireEvent.click(formulaire.getByRole("button", { name: "Enregistrer" }))
    expect(await screen.findByText("La clé de « Crm Ventes » est enregistrée.")).toBeInTheDocument()
    expect(screen.getByText("Vous pouvez revenir à votre assistant et lui demander de reprendre.")).toBeInTheDocument()
    const [url, init] = fetchMock.mock.calls[0]
    expect([url, init?.method, JSON.parse(String(init?.body))]).toEqual([`/api/platform/admin/accounts/${COMPTE.id}/secret`, "POST", { secret: { api_key: "n3uve" } }])
    expect(screen.queryByDisplayValue("n3uve")).toBeNull()
    await waitFor(() => expect(rafraichir).not.toHaveBeenCalled())
  })
})

describe("EcranConnexionDUnConnecteur, a connector with several accesses", () => {
  const ACCES = [
    { name: "oauth", label: "Sign-in of a person", gesture: "oauth" as const },
    { name: "key", label: "Key of the organization", gesture: "key" as const },
  ]

  it("should make the person choose the access when the link names none, each a link to the same page with its gesture", () => {
    render(<EcranConnexionDUnConnecteur outil="fod" resultat={{ data: { kind: "choose_access", connector: "fod", label: "Fod", accesses: ACCES } }} reessayer="/connect/fod" />)
    expect(screen.getByText("Fod se connecte de plusieurs façons. Choisissez la vôtre :")).toBeInTheDocument()
    const liste = within(screen.getByRole("list", { name: "Les façons de se connecter" }))
    expect(liste.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Sign-in of a person : autoriser l'accès chez l'éditeur",
      "Key of the organization : coller une clé",
    ])
    expect(liste.getAllByRole("link").map((lien) => lien.getAttribute("href"))).toEqual(["/connect/fod?access=oauth", "/connect/fod?access=key"])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("should offer the other accesses beside the gesture of the access the link names", () => {
    render(
      <EcranConnexionDUnConnecteur
        outil="fod"
        resultat={{ data: { kind: "ask_admin", connector: "fod", label: "Fod", space: "org", url: "https://acme.example.test/connect/fod?space=org&access=key", administrators: [{ name: "Ada Martin" }], others: [ACCES[0]] } }}
        reessayer="/connect/fod?access=key"
      />,
    )
    expect(screen.getByText("Ou connectez-vous autrement :")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Sign-in of a person" })).toHaveAttribute("href", "/connect/fod?access=oauth")
  })

  it("should keep in each access link the space the link names", () => {
    render(
      <EcranConnexionDUnConnecteur
        outil="fod"
        resultat={{ data: { kind: "choose_access", connector: "fod", label: "Fod", accesses: ACCES.map((acces) => ({ ...acces, space: "team:ventes" })) } }}
        reessayer="/connect/fod?space=team%3Aventes"
      />,
    )
    const liste = within(screen.getByRole("list", { name: "Les façons de se connecter" }))
    expect(liste.getAllByRole("link").map((lien) => lien.getAttribute("href"))).toEqual([
      "/connect/fod?access=oauth&space=team%3Aventes",
      "/connect/fod?access=key&space=team%3Aventes",
    ])
  })
})
