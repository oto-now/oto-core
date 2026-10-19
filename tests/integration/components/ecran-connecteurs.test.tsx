import type { AnchorHTMLAttributes } from "react"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { AccountView, ConnectorAccountForm, OrgConnector } from "@otomata_tech/oto_platform/schemas"
import {
  ContexteDeRafraichissement,
  EcranConnecteurs,
  EcranConnecteursChargement,
  issueDuConsentement,
  type DonneesDeMesComptes,
  type DonneesDesConnecteurs,
} from "@otomata_tech/oto_platform/ui"
import { choisirDansLaListe, libellesDesChoix } from "../../helpers/liste-de-choix"

// L'écran « Connecteurs » du tableau de bord (E08-S03 : AC4 à AC7, AC12 ; comptes-a-plusieurs-champs : saisie du
// secret et des réglages d'un compte réel), sur le design system d'oto-frontend (E05-S09 partie d2) : `fetch` simulé
// pour l'API, relecture fournie par un contexte de test.

const VENTES = "0e8e5a3c-7f10-4a5b-8d3b-2b1c4d5e6f70"
const COMPTE = "6b2f3c1d-4e5a-4b6c-8d7e-9f0a1b2c3d4e"

const MAIL_ACTIF: OrgConnector = {
  connector: "mail",
  state: "active",
  activatedAt: "2026-09-24T10:00:00.000Z",
  activatedBy: { userId: "user-claire", name: "Claire Morel" },
  functions: [
    { name: "mail.create_draft", class: "write" },
    { name: "mail.send_draft", class: "sensitive" },
  ],
}
const MAIL_INACTIF: OrgConnector = { ...MAIL_ACTIF, state: "inactive", activatedAt: null, activatedBy: null }

const MAIL_VENTES: AccountView = { id: COMPTE, label: "Mail Ventes", connector: "mail", owner: { kind: "team", teamName: "Ventes" }, mode: "simule", status: "active", viewerLevel: "manage" }

const DONNEES: DonneesDesConnecteurs = {
  connectors: [MAIL_ACTIF],
  impacts: { mail: { functions: ["mail.create_draft", "mail.send_draft"], procedures: ["ventes/qualifier_prospects"], accounts: 1 } },
  accounts: [MAIL_VENTES, { ...MAIL_VENTES, id: "7c3a4d2e-5f6b-4c7d-9e8f-0a1b2c3d4e5f", label: "Mail Ancien", owner: { kind: "org" }, status: "disabled" }],
  options: { teams: [{ id: VENTES, name: "Ventes" }] },
  partages: {},
}

const fetchMock = vi.fn<typeof fetch>()
const rafraichir = vi.fn()

function reponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

function Lien({ children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return <a {...props}>{children}</a>
}

function rendre(donnees: Partial<DonneesDesConnecteurs> | { error: string } = {}) {
  const resultat = "error" in donnees ? donnees : { data: { ...DONNEES, ...donnees } }
  return render(
    <ContexteDeRafraichissement.Provider value={rafraichir}>
      <EcranConnecteurs resultat={resultat} Lien={Lien} ici="/admin/connectors" />
    </ContexteDeRafraichissement.Provider>,
  )
}

const envoi = () => {
  const [url, init] = fetchMock.mock.calls[0]
  return { url, methode: init?.method, corps: init?.body === undefined ? undefined : JSON.parse(String(init.body)) }
}

beforeEach(() => {
  fetchMock.mockReset()
  rafraichir.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("EcranConnecteurs, connectors (AC4, AC5)", () => {
  it("should list each connector that can be activated, its functions and its state in text, under the count and the always-active sentence", () => {
    rendre()
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Connecteurs")
    const ilot = within(screen.getByRole("region", { name: "Connecteurs" }))
    expect(ilot.getByText("1 connecteur activable")).toBeInTheDocument()
    expect(ilot.getByText("Les fonctions de tableau (table.*) et celles de l'application sont toujours actives : elles ne s'activent pas.")).toBeInTheDocument()
    expect(ilot.getByText("2 fonctions : mail.create_draft, mail.send_draft")).toBeInTheDocument()
    expect(ilot.getByText("Actif depuis le 24 septembre 2026 (Claire Morel)")).toBeInTheDocument()
  })

  it("should activate without a question, then have the page re-read", async () => {
    fetchMock.mockResolvedValue(reponse(200, { data: { connector: MAIL_ACTIF } }))
    rendre({ connectors: [MAIL_INACTIF], impacts: {} })

    expect(screen.getByText("Inactif")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Activer mail" }))

    await waitFor(() => expect(rafraichir).toHaveBeenCalledTimes(1))
    expect(envoi()).toEqual({ url: "/api/platform/admin/connectors/mail/activation", methode: "POST", corps: {} })
    expect(screen.getByRole("heading", { level: 2, name: "Connecteurs" })).toHaveFocus()
  })

  it("should ask before deactivating, naming ten of the procedures and the accounts it touches; Escape keeps it, the confirmation sends DELETE", async () => {
    fetchMock.mockResolvedValue(reponse(200, { data: { connector: MAIL_INACTIF } }))
    // Onze procédures publiées le citent : la question en nomme dix, puis « , … » (AC5, N18).
    const onze = Array.from({ length: 11 }, (_, rang) => `ventes/p${String(rang + 1).padStart(2, "0")}`)
    rendre({ impacts: { mail: { functions: ["mail.create_draft", "mail.send_draft"], procedures: onze, accounts: 1 } } })

    fireEvent.click(screen.getByRole("button", { name: "Désactiver mail" }))
    const question =
      "Désactiver « mail » ? Ses fonctions cesseront aussitôt de répondre, pour tout le monde. 11 procédures publiées le citent dans leurs blocs d'appel : " +
      "ventes/p01, ventes/p02, ventes/p03, ventes/p04, ventes/p05, ventes/p06, ventes/p07, ventes/p08, ventes/p09, ventes/p10, …. Son compte est conservé."
    expect(screen.getByText(question)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Garder" })).toHaveFocus()
    fireEvent.keyDown(screen.getByRole("group", { name: question }), { key: "Escape" })
    expect(screen.queryByText(question)).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Désactiver mail" }))
    fireEvent.click(within(screen.getByRole("group", { name: question })).getByRole("button", { name: "Désactiver" }))
    await waitFor(() => expect(rafraichir).toHaveBeenCalledTimes(1))
    expect(envoi()).toMatchObject({ url: "/api/platform/admin/connectors/mail/activation", methode: "DELETE" })
    expect(screen.getByRole("heading", { level: 2, name: "Connecteurs" })).toHaveFocus()
  })

  it("should say no published procedure cites it, and count the accounts, when none does", () => {
    rendre({ impacts: { mail: { functions: [], procedures: [], accounts: 3 } } })
    fireEvent.click(screen.getByRole("button", { name: "Désactiver mail" }))
    expect(
      screen.getByText("Désactiver « mail » ? Ses fonctions cesseront aussitôt de répondre, pour tout le monde. Aucune procédure publiée ne le cite. Ses 3 comptes sont conservés."),
    ).toBeInTheDocument()
  })

  it("should say an empty catalog, in both islands (AC4, AC6)", () => {
    rendre({ connectors: [], impacts: {}, accounts: [] })
    expect(screen.getByText("Aucun connecteur à activer dans cette version de la plateforme.")).toBeInTheDocument()
    expect(screen.getByText("Aucun compte. Créez un compte pour qu'une procédure puisse appeler un connecteur.")).toBeInTheDocument()
    expect(screen.getByText("Aucun connecteur ne demande de compte dans cette version de la plateforme.")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Créer le compte" })).toBeNull()
  })
})

describe("EcranConnecteurs, accounts (AC6, AC7)", () => {
  it("should list each account with its owner, mode and state, and disable an active one after the question", async () => {
    fetchMock.mockResolvedValue(reponse(200, { data: { account: { id: COMPTE, status: "disabled" } } }))
    rendre()

    const comptes = within(screen.getByRole("region", { name: "Comptes" }))
    expect(comptes.getByText("Mail Ventes · mail · équipe Ventes · simulé · actif")).toBeInTheDocument()
    expect(comptes.getByText("Mail Ancien · mail · organisation · simulé · désactivé")).toBeInTheDocument()
    expect(comptes.queryByRole("button", { name: "Désactiver le compte Mail Ancien" })).toBeNull()

    fireEvent.click(comptes.getByRole("button", { name: "Désactiver le compte Mail Ventes" }))
    const question =
      "Désactiver le compte « Mail Ventes » ? Les appels qui le résolvent échoueront dès maintenant. Un compte désactivé ne se réactive pas : il faudra en créer un autre."
    fireEvent.click(within(comptes.getByRole("group", { name: question })).getByRole("button", { name: "Désactiver" }))

    await waitFor(() => expect(rafraichir).toHaveBeenCalledTimes(1))
    expect(envoi()).toEqual({ url: `/api/platform/admin/accounts/${COMPTE}/disable`, methode: "POST", corps: {} })
    // Le geste part avec la relecture (un compte désactivé n'en a plus) : le focus l'attend au titre de la liste.
    expect(screen.getByRole("heading", { level: 2, name: "Comptes" })).toHaveFocus()
  })

  it("should create an account for a team, then have the page re-read", async () => {
    fetchMock.mockResolvedValue(reponse(200, { data: { account: { label: "Mail Support" } } }))
    rendre()

    expect(screen.getByText(/^Mode : simulé\. Rien ne sort du serveur/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText("Libellé"), { target: { value: "Mail Support" } })
    fireEvent.click(screen.getByLabelText("Une équipe"))
    choisirDansLaListe(screen.getByLabelText("Équipe"), "Ventes")
    fireEvent.click(screen.getByRole("button", { name: "Créer le compte" }))

    await waitFor(() => expect(rafraichir).toHaveBeenCalledTimes(1))
    expect(envoi()).toEqual({
      url: "/api/platform/admin/accounts",
      methode: "POST",
      corps: { connector: "mail", owner_kind: "team", team_id: VENTES, label: "Mail Support", mode: "simule" },
    })
    expect(screen.getByRole("status")).toHaveTextContent("Compte « Mail Support » créé.")
  })

  it("should create an account for the organisation, for a connector not active yet, and say a label already taken under the field", async () => {
    fetchMock.mockResolvedValue(reponse(409, { error: { code: "conflict", message: "server text" } }))
    // Un compte se prépare avant l'activation (AC6, E04-S01) : le formulaire offre les connecteurs inactifs.
    rendre({ connectors: [MAIL_INACTIF], impacts: {} })

    expect(screen.getByLabelText("Connecteur")).toHaveValue("mail")
    fireEvent.change(screen.getByLabelText("Libellé"), { target: { value: "mail ventes" } })
    fireEvent.click(screen.getByRole("button", { name: "Créer le compte" }))

    expect(await screen.findByText("Un compte porte déjà ce libellé dans l'organisation.")).toBeInTheDocument()
    expect(screen.getByLabelText("Libellé")).toHaveAttribute("aria-invalid", "true")
    expect(envoi().corps).toEqual({ connector: "mail", owner_kind: "org", label: "mail ventes", mode: "simule" })
    expect(rafraichir).not.toHaveBeenCalled()
  })
})

const CRM: OrgConnector = { connector: "crm", state: "active", activatedAt: null, activatedBy: null, functions: [{ name: "crm.get_company", class: "read" }] }
const FORMULAIRE_CRM: ConnectorAccountForm = {
  connector: "crm",
  label: "Crm",
  fields: [
    { name: "client_id", label: "Client ID", secret: false },
    { name: "client_secret", label: "Client secret", secret: true },
  ],
  settings: [{ name: "region", label: "Région", type: "choice", choices: ["us", "eu"], default: "us" }],
}
const CRM_VENTES: AccountView = { id: COMPTE, label: "Crm Ventes", connector: "crm", owner: { kind: "org" }, mode: "reel", status: "active", secret: { fields: [], updatedAt: null }, settings: {}, viewerLevel: "manage" }
const VIVANTS: Partial<DonneesDesConnecteurs> = { connectors: [CRM], impacts: {}, accounts: [CRM_VENTES], formulaires: [FORMULAIRE_CRM] }

describe("EcranConnecteurs, live accounts and their secret (comptes-a-plusieurs-champs)", () => {
  it("should enter the secret fields masked and a setting, sending only what changed, the secret never shown again", async () => {
    fetchMock.mockResolvedValue(reponse(200, { data: { account: { id: COMPTE } } }))
    rendre(VIVANTS)
    const comptes = within(screen.getByRole("region", { name: "Comptes" }))
    expect(comptes.getByText("Crm Ventes · crm · organisation · réel · actif · sans secret")).toBeInTheDocument()

    fireEvent.click(comptes.getByRole("button", { name: "Secret et réglages de Crm Ventes" }))
    const formulaire = within(screen.getByRole("form", { name: "Secret et réglages de Crm Ventes" }))
    expect(formulaire.getByLabelText("Client secret")).toHaveAttribute("type", "password")
    expect(formulaire.getByLabelText("Client secret")).toHaveValue("")
    fireEvent.change(formulaire.getByLabelText("Client secret"), { target: { value: "s3cr3t" } })
    choisirDansLaListe(formulaire.getByLabelText("Région"), "eu")
    fireEvent.click(formulaire.getByRole("button", { name: "Enregistrer" }))

    await waitFor(() => expect(rafraichir).toHaveBeenCalledTimes(1))
    expect(envoi()).toEqual({ url: `/api/platform/admin/accounts/${COMPTE}/secret`, methode: "POST", corps: { secret: { client_secret: "s3cr3t" }, settings: { region: "eu" } } })
    expect(screen.queryByDisplayValue("s3cr3t")).toBeNull()
    expect(comptes.getByRole("status")).toHaveTextContent("Secret et réglages de « Crm Ventes » enregistrés.")
  })

  it("should say a field set, keep it when left empty, erase it when ticked, and send nothing when nothing changed", async () => {
    fetchMock.mockResolvedValue(reponse(200, { data: { account: { id: COMPTE } } }))
    const pose = { ...CRM_VENTES, secret: { fields: ["client_id", "client_secret"], updatedAt: "2026-10-08T09:00:00.000Z" }, settings: { region: "eu" } }
    rendre({ ...VIVANTS, accounts: [pose] })
    expect(screen.getByText("Crm Ventes · crm · organisation · réel · actif · secret posé le 8 octobre 2026")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Secret et réglages de Crm Ventes" }))
    const formulaire = within(screen.getByRole("form", { name: "Secret et réglages de Crm Ventes" }))
    expect(formulaire.getAllByText("Posé. Laissez vide pour le garder.")).toHaveLength(2)

    fireEvent.click(formulaire.getByRole("button", { name: "Enregistrer" }))
    expect(await formulaire.findByText("Rien à enregistrer : saisissez un champ, cochez « Effacer » ou changez un réglage.")).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()

    fireEvent.click(formulaire.getByLabelText("Effacer Client ID"))
    fireEvent.click(formulaire.getByRole("button", { name: "Enregistrer" }))
    await waitFor(() => expect(rafraichir).toHaveBeenCalledTimes(1))
    expect(envoi().corps).toEqual({ secret: { client_id: null } })
  })

  it("should say the mark of an account, its reason and its date, the account still active (oto-core#69)", () => {
    const pose = { ...CRM_VENTES, secret: { fields: ["client_id", "client_secret"], updatedAt: "2026-10-08T09:00:00.000Z" } }
    const refuse: AccountView = { ...pose, mark: { reason: "credential_rejected", at: "2026-10-17T09:12:00.000Z" } }
    const epuise: AccountView = { ...pose, id: "7c3a4d2e-5f6b-4c7d-9e8f-0a1b2c3d4e5f", label: "Crm Support", mark: { reason: "quota_exhausted", at: "2026-10-16T10:00:00.000Z" } }
    rendre({ ...VIVANTS, accounts: [refuse, epuise] })
    const comptes = within(screen.getByRole("region", { name: "Comptes" }))
    expect(comptes.getByText("Crm Ventes · crm · organisation · réel · actif · clé refusée le 17 octobre 2026 · secret posé le 8 octobre 2026")).toBeInTheDocument()
    expect(comptes.getByText("Crm Support · crm · organisation · réel · actif · crédits épuisés le 16 octobre 2026 · secret posé le 8 octobre 2026")).toBeInTheDocument()
  })

  it("should create a live account with its secret: the account first, mode reel, then its secret", async () => {
    fetchMock.mockResolvedValueOnce(reponse(200, { data: { account: { id: COMPTE, label: "Crm Support" } } }))
    fetchMock.mockResolvedValueOnce(reponse(200, { data: { account: { id: COMPTE } } }))
    rendre({ ...VIVANTS, accounts: [] })
    expect(screen.getByText(/^Mode : réel\./)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText("Libellé"), { target: { value: "Crm Support" } })
    fireEvent.change(screen.getByLabelText("Client ID"), { target: { value: "id-1" } })
    fireEvent.change(screen.getByLabelText("Client secret"), { target: { value: "s3cr3t" } })
    fireEvent.click(screen.getByRole("button", { name: "Créer le compte" }))

    await waitFor(() => expect(rafraichir).toHaveBeenCalledTimes(1))
    const corps = fetchMock.mock.calls.map(([url, init]) => [url, JSON.parse(String(init?.body))])
    expect(corps).toEqual([
      ["/api/platform/admin/accounts", { connector: "crm", owner_kind: "org", label: "Crm Support", mode: "reel" }],
      [`/api/platform/admin/accounts/${COMPTE}/secret`, { secret: { client_id: "id-1", client_secret: "s3cr3t" }, settings: { region: "us" } }],
    ])
  })
})

const FORMULAIRE_MS: ConnectorAccountForm = { connector: "microsoft", label: "Microsoft 365", consent: true, fields: [], settings: [] }
const MS: OrgConnector = { connector: "microsoft", state: "active", activatedAt: null, activatedBy: null, functions: [{ name: "microsoft.get_me", class: "read" }] }
const MON_COMPTE_MS: AccountView = {
  id: COMPTE,
  label: "lea@contoso.test (microsoft)",
  connector: "microsoft",
  owner: { kind: "user" },
  mode: "reel",
  status: "active",
  secret: { fields: ["refresh_token"], updatedAt: "2026-10-16T09:00:00.000Z" },
  settings: {},
  viewerLevel: "manage",
}

describe("EcranConnecteurs, a person's consent (oauth2_user)", () => {
  it("should offer « Connecter mon compte », start the consent and send the browser to the address it gets, never offering to create such an account by hand", async () => {
    const assign = vi.fn()
    vi.stubGlobal("location", { ...window.location, assign })
    fetchMock.mockResolvedValue(reponse(200, { data: { url: "https://login.example.test/authorize?state=s" } }))
    rendre({ connectors: [MAIL_ACTIF, MS], formulaires: [FORMULAIRE_MS], accounts: [MON_COMPTE_MS] })

    expect(screen.getByText("lea@contoso.test (microsoft) · microsoft · personnel · réel · actif · jetons du 16 octobre 2026")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Secret et réglages/ })).toBeNull()
    expect(within(screen.getByLabelText("Connecteur")).queryByRole("option", { name: "microsoft" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Connecter mon compte Microsoft 365" }))

    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://login.example.test/authorize?state=s"))
    expect(envoi()).toEqual({ url: "/api/platform/connector-consent", methode: "POST", corps: { connector: "microsoft", return_to: "/admin/connectors" } })
  })

  it("should offer to reconnect an account to connect again, with its reason, and say a refused start", async () => {
    fetchMock.mockResolvedValue(reponse(403, { error: { code: "not_enabled", message: "server text" } }))
    rendre({ connectors: [MS], formulaires: [FORMULAIRE_MS], accounts: [{ ...MON_COMPTE_MS, status: "error", statusReason: "Microsoft 365 no longer accepts its authorization (expired or revoked)" }] })
    expect(screen.getByText(/en erreur · à reconnecter : Microsoft 365 no longer accepts its authorization/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Reconnecter le compte lea@contoso.test (microsoft)" }))
    expect(await screen.findAllByRole("alert")).not.toHaveLength(0)
    expect(envoi().corps).toEqual({ connector: "microsoft", return_to: "/admin/connectors" })
  })

  it("should say the outcome of a return from the third party", () => {
    render(
      <ContexteDeRafraichissement.Provider value={rafraichir}>
        <EcranConnecteurs resultat={{ data: DONNEES }} Lien={Lien} ici="/admin/connectors" consentement={issueDuConsentement({ consent: "connected", account: "lea@contoso.test (microsoft)" })} />
      </ContexteDeRafraichissement.Provider>,
    )
    expect(screen.getByText("Compte « lea@contoso.test (microsoft) » connecté.")).toBeInTheDocument()
    cleanup()
    render(
      <ContexteDeRafraichissement.Provider value={rafraichir}>
        <EcranConnecteurs resultat={{ data: DONNEES }} Lien={Lien} ici="/admin/connectors" consentement={issueDuConsentement({ consent: "failed", reason: "invalid_arguments" })} />
      </ContexteDeRafraichissement.Provider>,
    )
    expect(screen.getByRole("alert")).toHaveTextContent("La connexion n'a pas abouti : refusée, annulée, expirée ou déjà servie. Recommencez.")
    expect(issueDuConsentement({})).toBeUndefined()
  })
})

const FORMULAIRE_LI: ConnectorAccountForm = { connector: "messagerie", label: "Messagerie", hosted: { ready: true }, fields: [], settings: [] }
const LI: OrgConnector = { connector: "messagerie", state: "active", activatedAt: null, activatedBy: null, functions: [{ name: "messagerie.get_me", class: "read" }] }
const MON_COMPTE_LI: AccountView = { ...MON_COMPTE_MS, label: "lea@contoso.test (messagerie)", connector: "messagerie", secret: { fields: [], updatedAt: null } }

describe("EcranConnecteurs, a hosted account (accountIdentity)", () => {
  it("should offer « Connecter mon compte » on the hosted link, never a secret nor a creation by hand", async () => {
    const assign = vi.fn()
    vi.stubGlobal("location", { ...window.location, assign })
    fetchMock.mockResolvedValue(reponse(200, { data: { url: "https://link.example.test/auth/abc" } }))
    rendre({ connectors: [MAIL_ACTIF, LI], formulaires: [FORMULAIRE_LI], accounts: [MON_COMPTE_LI] })

    expect(screen.getByText("lea@contoso.test (messagerie) · messagerie · personnel · réel · actif")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Secret et réglages/ })).toBeNull()
    expect(within(screen.getByLabelText("Connecteur")).queryByRole("option", { name: "messagerie" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Connecter mon compte Messagerie" }))

    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://link.example.test/auth/abc"))
    expect(envoi()).toEqual({ url: "/api/platform/hosted-link", methode: "POST", corps: { connector: "messagerie", return_to: "/admin/connectors" } })
  })

  it("should offer to reconnect an account in error, and nothing while the host has not given its port", () => {
    rendre({ connectors: [LI], formulaires: [FORMULAIRE_LI], accounts: [{ ...MON_COMPTE_LI, status: "error", statusReason: "session lost" }] })
    expect(screen.getByText(/en erreur · à reconnecter : session lost/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Reconnecter le compte lea@contoso.test (messagerie)" })).toBeInTheDocument()
    cleanup()
    rendre({ connectors: [LI], formulaires: [{ ...FORMULAIRE_LI, hosted: { ready: false } }], accounts: [{ ...MON_COMPTE_LI, status: "error" }] })
    expect(screen.queryByRole("button", { name: /Reconnecter|Connecter mon compte/ })).toBeNull()
  })

  it("should say the outcome of a hosted link, by its reason", () => {
    expect(issueDuConsentement({ hosted: "connected", account: "lea@contoso.test (messagerie)" })).toEqual({ issue: "connected", compte: "lea@contoso.test (messagerie)" })
    render(
      <ContexteDeRafraichissement.Provider value={rafraichir}>
        <EcranConnecteurs resultat={{ data: DONNEES }} Lien={Lien} ici="/admin/connectors" consentement={issueDuConsentement({ hosted: "failed", reason: "ambiguous_candidates" })} />
      </ContexteDeRafraichissement.Provider>,
    )
    expect(screen.getByRole("alert")).toHaveTextContent("Plusieurs comptes pourraient correspondre à cette demande ; rien n'a été rangé. Recommencez dans quelques minutes.")
  })
})

describe("EcranConnecteurs, states (AC12)", () => {
  it("should render a busy status while loading", () => {
    render(<EcranConnecteursChargement />)
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true")
    expect(screen.getByRole("status")).toHaveTextContent("Chargement des connecteurs…")
  })

  it("should say a failed read in an alert, with a way to retry", () => {
    rendre({ error: "Une erreur est survenue. Réessayez." })
    expect(screen.getByRole("alert")).toHaveTextContent("Une erreur est survenue. Réessayez.")
    expect(screen.getByRole("link", { name: "Réessayer" })).toHaveAttribute("href", "/admin/connectors")
  })
})

describe("capacités atteintes (E12-S02, AC-10)", () => {
  it("should grey the activation of an inactive connector at connectors_max, with the raise link", () => {
    rendre({ connectors: [MAIL_INACTIF], limites: { members: null, teams: null, connectors: { max: 0, used: 0 }, raiseUrl: "https://acme.test/billing?from=pkg" } })
    expect(screen.getByRole("button", { name: "Activer" })).toBeDisabled()
    expect(screen.getByText(/Limite atteinte : 0 connecteur actif sur 0\./)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Relever la limite" })).toHaveAttribute("href", "https://acme.test/billing?from=pkg&capacity=connectors_max")
  })
})

describe("EcranConnecteurs, the share journal of an account (#68)", () => {
  const MON_COMPTE: AccountView = { ...MAIL_VENTES, label: "Mail Léa", owner: { kind: "user" } }

  it("should read the journal of an account the person manages on opening, and say each share in French", async () => {
    fetchMock.mockResolvedValue(
      reponse(200, {
        data: {
          label: "Mail Léa",
          events: [
            { at: "2026-10-18T09:12:00.000Z", action: "removed", subject: { kind: "user", name: "Paul Durand" }, level: "read", previous: null, by: { name: "Léa Bernard" } },
            { at: "2026-10-17T08:00:00.000Z", action: "set", subject: { kind: "team", name: "Support" }, level: "write", previous: "read", by: { name: null } },
            { at: "2026-10-16T08:00:00.000Z", action: "set", subject: { kind: "org", name: null }, level: "sensitive", previous: null, by: null },
          ],
        },
      }),
    )
    rendre({ accounts: [MON_COMPTE] })
    const bouton = screen.getByRole("button", { name: "Journal des partages de Mail Léa" })
    expect(bouton).toHaveAttribute("aria-expanded", "false")
    fireEvent.click(bouton)

    const journal = await screen.findByRole("list", { name: "Journal des partages de Mail Léa" })
    expect(within(journal).getAllByRole("listitem").map((ligne) => ligne.textContent)).toEqual([
      expect.stringMatching(/^18 octobre 2026 à \d\d:12 · Léa Bernard a retiré le partage à Paul Durand \(en lecture\)$/),
      expect.stringMatching(/^17 octobre 2026 à \d\d:00 · Une personne qui n'est plus membre a partagé à l'équipe Support en écriture \(avant : en lecture\)$/),
      expect.stringMatching(/^16 octobre 2026 à \d\d:00 · Hors session a partagé à toute l'organisation jusqu'aux fonctions sensibles$/),
    ])
    expect(envoi()).toEqual({ url: `/api/platform/admin/accounts/${COMPTE}/share-journal`, methode: "GET", corps: undefined })
    expect(bouton).toHaveAttribute("aria-expanded", "true")
  })

  it("should say an empty journal and a refused read", async () => {
    fetchMock.mockResolvedValueOnce(reponse(200, { data: { label: "Mail Léa", events: [] } }))
    rendre({ accounts: [MON_COMPTE] })
    fireEvent.click(screen.getByRole("button", { name: "Journal des partages de Mail Léa" }))
    expect(await screen.findByText("Aucun partage posé ni retiré sur ce compte.")).toBeInTheDocument()
    cleanup()

    fetchMock.mockResolvedValueOnce(reponse(403, { error: { code: "forbidden" } }))
    rendre({ accounts: [MON_COMPTE] })
    fireEvent.click(screen.getByRole("button", { name: "Journal des partages de Mail Léa" }))
    expect(await screen.findByRole("alert")).toBeInTheDocument()
  })

  it("should offer no journal on an account the person does not manage", () => {
    rendre({ accounts: [{ ...MON_COMPTE, label: "Mail Claire", viewerLevel: "write" }] })
    expect(screen.queryByRole("button", { name: /Journal des partages/ })).toBeNull()
  })
})

// L'écran ouvert aux membres (`connecteurs-et-comptes.md` § Écran Connecteurs) : à qui n'administre pas, ses seuls
// comptes personnels, sans catalogue ni création ; sous chaque compte personnel qu'il gère, ses partages, retirés par un
// geste confirmé, et le formulaire qui partage à toute l'organisation ou à une équipe.
describe("EcranConnecteurs, a member's own accounts and their shares", () => {
  const MON_COMPTE: AccountView = { ...MAIL_VENTES, label: "Mail Léa", owner: { kind: "user" } }
  const REGLE_ORG = "1a2b3c4d-0000-4000-8000-000000000001"
  const REGLE_VENTES = "1a2b3c4d-0000-4000-8000-000000000002"
  const PARTAGES = {
    [COMPTE]: { general: { id: REGLE_ORG, level: "write" as const }, rules: [{ id: REGLE_VENTES, subject: { kind: "team" as const, name: "Ventes" }, level: "read" as const }] },
  }
  const MES_COMPTES: DonneesDeMesComptes = { accounts: [MON_COMPTE], options: { teams: [{ id: VENTES, name: "Ventes" }] }, partages: PARTAGES }

  function rendreMesComptes(donnees: Partial<DonneesDeMesComptes> = {}) {
    return render(
      <ContexteDeRafraichissement.Provider value={rafraichir}>
        <EcranConnecteurs resultat={{ data: { ...MES_COMPTES, ...donnees } }} Lien={Lien} ici="/admin/connectors" />
      </ContexteDeRafraichissement.Provider>,
    )
  }

  it("should show a member their own accounts only, with neither the catalog nor the creation of an account", () => {
    rendreMesComptes()
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Connecteurs")
    const comptes = within(screen.getByRole("region", { name: "Mes comptes" }))
    expect(comptes.getByText("1 compte")).toBeInTheDocument()
    expect(comptes.getByText("Mail Léa · mail · personnel · simulé · actif")).toBeInTheDocument()
    expect(screen.queryByRole("region", { name: "Connecteurs" })).toBeNull()
    expect(screen.queryByRole("region", { name: "Créer un compte" })).toBeNull()
    expect(screen.queryByRole("region", { name: "Connecter mon compte" })).toBeNull()
    expect(comptes.getByRole("button", { name: "Journal des partages de Mail Léa" })).toBeInTheDocument()
  })

  it("should say a member has no account yet, and offer to connect theirs where the host gave the port", () => {
    rendreMesComptes({ accounts: [], partages: {}, formulaires: [FORMULAIRE_MS] })
    expect(within(screen.getByRole("region", { name: "Mes comptes" })).getByText("Vous n'avez aucun compte personnel.")).toBeInTheDocument()
    expect(within(screen.getByRole("region", { name: "Connecter mon compte" })).getByRole("button", { name: "Connecter mon compte Microsoft 365" })).toBeInTheDocument()
  })

  it("should list the shares of an account the person manages, and remove one after the question", async () => {
    fetchMock.mockResolvedValue(reponse(200, { data: { rule: { id: REGLE_VENTES } } }))
    rendreMesComptes()

    const partages = within(screen.getByRole("list", { name: "Partages de Mail Léa" }))
    expect(partages.getAllByRole("listitem").map((ligne) => ligne.querySelector("span")?.textContent)).toEqual([
      "toute l'organisation · en écriture",
      "l'équipe Ventes · en lecture",
    ])
    fireEvent.click(partages.getByRole("button", { name: "Retirer le partage à l'équipe Ventes" }))
    const question = "Retirer le partage de « Mail Léa » à l'équipe Ventes ?"
    fireEvent.click(within(screen.getByRole("group", { name: question })).getByRole("button", { name: "Retirer le partage" }))

    await waitFor(() => expect(rafraichir).toHaveBeenCalledTimes(1))
    expect(envoi()).toEqual({ url: `/api/platform/admin/account-rules/${REGLE_VENTES}`, methode: "DELETE", corps: undefined })
    expect(screen.getByRole("heading", { level: 2, name: "Mes comptes" })).toHaveFocus()
  })

  it("should share an account with a team at a level of the account scale, never the management, then have the page re-read", async () => {
    fetchMock.mockResolvedValue(reponse(201, { data: { rule: { id: REGLE_VENTES, created: true } } }))
    rendreMesComptes({ partages: { [COMPTE]: { general: null, rules: [] } } })

    expect(screen.getByText("Ce compte n'est partagé avec personne.")).toBeInTheDocument()
    expect(libellesDesChoix(screen.getByLabelText("Partager à"))).toEqual(["toute l'organisation", "l'équipe Ventes"])
    expect(libellesDesChoix(screen.getByLabelText("Niveau"))).toEqual(["en lecture", "en écriture", "jusqu'aux fonctions sensibles"])
    choisirDansLaListe(screen.getByLabelText("Partager à"), "l'équipe Ventes")
    choisirDansLaListe(screen.getByLabelText("Niveau"), "jusqu'aux fonctions sensibles")
    fireEvent.click(screen.getByRole("button", { name: "Partager" }))

    await waitFor(() => expect(rafraichir).toHaveBeenCalledTimes(1))
    expect(envoi()).toEqual({
      url: "/api/platform/admin/account-rules",
      methode: "POST",
      corps: { accountId: COMPTE, subject: { kind: "team", id: VENTES }, level: "sensitive" },
    })
    expect(within(screen.getByRole("form", { name: "Partager Mail Léa" })).getByRole("status")).toHaveTextContent("Partage enregistré.")
  })

  it("should share with the whole organisation by default, and say a refusal under the form", async () => {
    fetchMock.mockResolvedValue(reponse(403, { error: { code: "forbidden", message: "server text" } }))
    rendreMesComptes()
    fireEvent.click(screen.getByRole("button", { name: "Partager" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("Seule une personne qui gère ce compte peut le partager.")
    expect(envoi().corps).toEqual({ accountId: COMPTE, subject: { kind: "org" }, level: "read" })
    expect(rafraichir).not.toHaveBeenCalled()
  })

  it("should offer no share on an account the person does not manage, nor on an account of a team or of the organisation", () => {
    rendreMesComptes({ accounts: [{ ...MON_COMPTE, viewerLevel: "write" }] })
    expect(screen.queryByRole("form", { name: /^Partager/ })).toBeNull()
    expect(screen.queryByText("Partages de Mail Léa")).toBeNull()
    cleanup()

    // L'administrateur garde sa vue : un compte d'équipe qu'il gère n'a que son journal, même si des partages arrivaient.
    rendre({ partages: { [COMPTE]: { general: null, rules: [] } } })
    expect(screen.queryByRole("form", { name: /^Partager/ })).toBeNull()
    expect(screen.getByRole("button", { name: "Journal des partages de Mail Ventes" })).toBeInTheDocument()
  })

  it("should give an administrator the shares of their own personal account, beside the catalog", () => {
    rendre({ accounts: [MAIL_VENTES, { ...MON_COMPTE, id: "8d4b5e3f-6a7c-4d8e-9f0a-1b2c3d4e5f60" }], partages: { "8d4b5e3f-6a7c-4d8e-9f0a-1b2c3d4e5f60": { general: null, rules: [] } } })
    expect(screen.getByRole("region", { name: "Connecteurs" })).toBeInTheDocument()
    expect(within(screen.getByRole("region", { name: "Comptes" })).getAllByRole("form", { name: /^Partager/ })).toHaveLength(1)
    expect(screen.getByRole("form", { name: "Partager Mail Léa" })).toBeInTheDocument()
  })
})
