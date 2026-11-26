import type { AnchorHTMLAttributes } from "react"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { AccountView, ConnectorAccountForm, OrgConnector } from "@otomata_tech/oto_platform/schemas"
import {
  ContexteDeLHote,
  ContexteDeRafraichissement,
  EcranConnecteurs,
  EcranConnecteursChargement,
  issueDuConsentement,
  type DonneesDesConnecteurs,
  type EcranConnecteursProps,
} from "@otomata_tech/oto_platform/ui"
import { coucheDuDessus, simulerLesDialogues } from "../../helpers/dialogue"
import { choisirDansLaListe, libellesDesChoix } from "../../helpers/liste-de-choix"

// L'écran « Connecteurs » : un seul objet, le connecteur, une seule liste pour un administrateur et pour un membre, l'état
// vide qui apprend à s'en servir, le détail d'un connecteur dans un tiroir ouvert par l'adresse, son partage dans le
// panneau des pages, « Ajouter un connecteur », et pour un administrateur le blocage d'un outil, geste sur l'outil dans
// le catalogue et dans le détail. `fetch` simulé pour l'API, relecture et navigation fournies par des contextes de test.

const ICI = "/admin/connectors"
const LEA = "0b6f1f0e-1c1a-4a8e-9a51-0d7c1a2b3c01"
const PAUL = "0b6f1f0e-1c1a-4a8e-9a51-0d7c1a2b3c02"
const VENTES = "0e8e5a3c-7f10-4a5b-8d3b-2b1c4d5e6f70"
const FINANCE = "0e8e5a3c-7f10-4a5b-8d3b-2b1c4d5e6f71"

const MAIL: OrgConnector = {
  connector: "mail",
  label: "mail",
  closedBy: null,
  accountModes: ["simule"],
  state: "active",
  activatedAt: "2026-09-24T10:00:00.000Z",
  activatedBy: { userId: "user-claire", name: "Claire Morel" },
  functions: [
    { name: "mail.create_draft", class: "write" },
    { name: "mail.send_draft", class: "sensitive" },
  ],
}
const CRM: OrgConnector = {
  connector: "crm",
  label: "Crm Pro",
  closedBy: null,
  accountModes: ["reel"],
  state: "active",
  activatedAt: "2026-09-24T10:00:00.000Z",
  activatedBy: null,
  functions: [
    { name: "crm.find", class: "read" },
    { name: "crm.get", class: "read" },
    { name: "crm.update", class: "write" },
    { name: "crm.delete", class: "sensitive" },
  ],
}
const FORMULAIRE_CRM: ConnectorAccountForm = {
  connector: "crm",
  label: "Crm Pro",
  ownerKinds: ["org", "team", "user"],
  probe: { available: true, balance: false },
  fields: [{ name: "api_key", label: "Clé d'API", secret: true }],
  settings: [{ name: "region", label: "Région", type: "choice", choices: ["us", "eu"], default: "us" }],
}
const FORMULAIRE_MS: ConnectorAccountForm = { connector: "microsoft", label: "Microsoft 365", consent: true, ownerKinds: ["user"], probe: { available: false, balance: false }, fields: [], settings: [] }

const A_LEA: AccountView["owner"] = { kind: "user", userId: LEA, userName: "Léa Bernard" }
const A_PAUL: AccountView["owner"] = { kind: "user", userId: PAUL, userName: "Paul Durand" }

const BANQUE: AccountView = { id: "6b2f3c1d-4e5a-4b6c-8d7e-9f0a1b2c3d41", label: "Banque", connector: "crm", owner: A_LEA, mode: "reel", status: "active", secret: { fields: ["api_key"], updatedAt: "2026-11-02T09:00:00.000Z" }, settings: { region: "us" }, viewerLevel: "manage", description: null, lastProbe: null }
const AGENDA: AccountView = { id: "6b2f3c1d-4e5a-4b6c-8d7e-9f0a1b2c3d42", label: "Agenda de Paul", connector: "microsoft", owner: A_PAUL, mode: "reel", status: "active", secret: { fields: ["refresh_token"], updatedAt: "2026-10-16T09:00:00.000Z" }, viewerLevel: "read", description: null, lastProbe: null }
const MAIL_VENTES: AccountView = { id: "6b2f3c1d-4e5a-4b6c-8d7e-9f0a1b2c3d43", label: "Mail Ventes", connector: "mail", owner: { kind: "team", teamName: "Ventes" }, mode: "simule", status: "active", viewerLevel: "write", description: null, lastProbe: null }

const PARTAGES_DE_BANQUE = {
  general: null,
  rules: [
    { id: "9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c01", subject: { kind: "team" as const, id: FINANCE, name: "Finance" }, level: "read" as const },
    { id: "9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c02", subject: { kind: "user" as const, id: PAUL, name: "Paul Durand" }, level: "write" as const },
  ],
}

const DONNEES: DonneesDesConnecteurs = {
  accounts: [BANQUE, AGENDA, MAIL_VENTES],
  connectors: [MAIL, CRM],
  formulaires: [FORMULAIRE_CRM, FORMULAIRE_MS],
  partages: { [BANQUE.id]: PARTAGES_DE_BANQUE },
  sujets: {
    equipes: [
      { id: VENTES, nom: "Ventes" },
      { id: FINANCE, nom: "Finance" },
    ],
    personnes: [
      { id: LEA, nom: "Léa Bernard" },
      { id: PAUL, nom: "Paul Durand" },
      { id: "0b6f1f0e-1c1a-4a8e-9a51-0d7c1a2b3c03", nom: "Nadia Finet" },
    ],
  },
  proprietaires: { user: true, org: false, teams: [] },
}
const EQUIPES = [
  { id: FINANCE, name: "Finance" },
  { id: VENTES, name: "Ventes" },
]
/** Qui administre crée pour l'organisation et pour chaque équipe. */
const ADMINISTRE: Partial<DonneesDesConnecteurs> = { administration: { impacts: {} }, proprietaires: { user: true, org: true, teams: EQUIPES } }

const fetchMock = vi.fn<typeof fetch>()
const rafraichir = vi.fn()
const naviguer = vi.fn()

function reponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

function Lien({ children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return <a {...props}>{children}</a>
}

type Rendu = { vue?: Partial<NonNullable<EcranConnecteursProps["vue"]>>; moi?: string; consentement?: EcranConnecteursProps["consentement"] }

function ecran(donnees: Partial<DonneesDesConnecteurs> | { error: string }, { vue, moi = LEA, consentement }: Rendu) {
  const resultat = "error" in donnees ? donnees : { data: { ...DONNEES, ...donnees } }
  return (
    <ContexteDeLHote.Provider value={{ Lien, chemin: ICI, naviguer }}>
      <ContexteDeRafraichissement.Provider value={rafraichir}>
        <EcranConnecteurs resultat={resultat} moi={moi} vue={{ filtre: "all", q: "", compte: null, ...vue }} Lien={Lien} ici={ICI} consentement={consentement} />
      </ContexteDeRafraichissement.Provider>
    </ContexteDeLHote.Provider>
  )
}

const rendre = (donnees: Partial<DonneesDesConnecteurs> | { error: string } = {}, rendu: Rendu = {}) => render(ecran(donnees, rendu))

/** Les envois partis vers l'API, dans l'ordre : l'adresse, la méthode et le corps. */
const envois = () =>
  fetchMock.mock.calls.map(([url, init]) => ({ url, methode: init?.method, corps: init?.body === undefined ? undefined : JSON.parse(String(init.body)) }))

const ligneDe = (libelle: string) => {
  const ligne = screen.getByRole("link", { name: libelle }).closest("tr")
  if (!ligne) throw new Error(`ligne « ${libelle} » introuvable`)
  return within(ligne)
}

const detailDe = (compte: AccountView) => within(screen.getByRole("dialog", { name: compte.label }))

/** Les groupes de fonctions du détail d'un compte, par le nom de leur ligne repliable. */
const groupesDe = (compte: AccountView) => [...screen.getByRole("dialog", { name: compte.label }).querySelectorAll("summary[aria-label]")].map((ligne) => ligne.getAttribute("aria-label"))

beforeAll(simulerLesDialogues)

beforeEach(() => {
  fetchMock.mockReset()
  rafraichir.mockReset()
  naviguer.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("EcranConnecteurs, the list", () => {
  it("should show a member one list: their own account, the one another shares with them and their team's, each with its tool, its access, its state in a word and one gesture at most", () => {
    rendre()
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Connecteurs")
    expect(screen.getByText("Les outils que votre assistant peut utiliser pour vous.")).toBeInTheDocument()

    const banque = ligneDe("Banque")
    expect(banque.getByText("Crm Pro", { selector: ".oto-caption" })).toBeInTheDocument()
    expect(banque.getByText("Équipe Finance +1")).toBeInTheDocument()
    expect(banque.getByText("Non testé")).toBeInTheDocument()
    expect(banque.queryByRole("button")).toBeNull()

    const agenda = ligneDe("Agenda de Paul")
    expect(agenda.getByText("Microsoft 365", { selector: ".oto-caption" })).toBeInTheDocument()
    expect(agenda.getByText("Partagé par Paul Durand")).toBeInTheDocument()
    expect(agenda.getByText("Lire")).toBeInTheDocument()

    const ventes = ligneDe("Mail Ventes")
    expect(ventes.getByText("mail", { selector: ".oto-caption" })).toBeInTheDocument()
    expect(ventes.getByText("Équipe Ventes")).toBeInTheDocument()
    expect(ventes.getByText("Lire et modifier")).toBeInTheDocument()

    expect(screen.getByText(/relié à un compte : le vôtre, celui d'une équipe ou de l'organisation\. Il est privé tant que vous ne le partagez pas\./)).toBeInTheDocument()
    // Un seul objet : ni liste d'outils, ni « Autorisé », ni les mots du moteur.
    expect(screen.queryByRole("region", { name: "Outils de l'organisation" })).toBeNull()
    expect(screen.queryByText(/Autorisé/)).toBeNull()
    expect(screen.queryByText(/secret|activ/i)).toBeNull()
  })

  it("should say « Privé » for an own account nobody shares, and open the detail of a line by its address, the view kept", () => {
    rendre({ partages: {} }, { vue: { filtre: "mine" } })
    expect(ligneDe("Banque").getByText("Privé")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Banque" })).toHaveAttribute("href", `${ICI}?filter=mine&connector=${BANQUE.id}`)
  })

  it("should count each filter on its pill and write the chosen one in the address; the search is always there and keeps the filter", () => {
    const { unmount } = rendre()
    const filtres = within(screen.getByRole("radiogroup", { name: "Filtrer les connecteurs" }))
    expect(filtres.getAllByRole("radio").map((filtre) => filtre.textContent)).toEqual(["Tous · 3", "À moi · 1", "Partagés avec moi · 2"])
    fireEvent.click(filtres.getByRole("radio", { name: "À moi · 1" }))
    expect(naviguer).toHaveBeenCalledWith(`${ICI}?filter=mine`)
    unmount()

    // La recherche s'offre dès la première ligne, comme sur la maquette.
    rendre({ accounts: [MAIL_VENTES] }, { vue: { filtre: "shared" } })
    const champ = screen.getByRole("searchbox", { name: "Rechercher un connecteur" })
    fireEvent.change(champ, { target: { value: "mail 3" } })
    fireEvent.submit(champ)
    expect(naviguer).toHaveBeenLastCalledWith(`${ICI}?filter=shared&q=mail+3`)
  })

  it("should say a search without answer, keep the field, and offer to clear it, the filter kept", () => {
    rendre({}, { vue: { q: "introuvable", filtre: "mine" } })
    expect(screen.getByText("Aucun connecteur ne correspond à « introuvable ».")).toBeInTheDocument()
    expect(screen.getByRole("searchbox", { name: "Rechercher un connecteur" })).toHaveValue("introuvable")
    expect(screen.getByRole("link", { name: "Effacer la recherche" })).toHaveAttribute("href", `${ICI}?filter=mine`)
  })

  it("should offer the gesture of a state to whoever may make it: the key to enter leads to the detail, the owner reconnects, the others read whom to ask", async () => {
    const assign = vi.fn()
    vi.stubGlobal("location", { ...window.location, assign })
    fetchMock.mockResolvedValue(reponse(200, { data: { url: "https://login.example.test/authorize?state=s" } }))
    const sansCle: AccountView = { ...BANQUE, secret: { fields: [], updatedAt: null } }
    const monAgenda: AccountView = { ...AGENDA, id: "6b2f3c1d-4e5a-4b6c-8d7e-9f0a1b2c3d44", label: "Mon agenda", owner: A_LEA, status: "error", viewerLevel: "manage" }
    rendre({ accounts: [sansCle, monAgenda, { ...AGENDA, status: "error" }] })

    expect(ligneDe("Banque").getByText("À terminer")).toBeInTheDocument()
    expect(ligneDe("Banque").getByRole("link", { name: "Saisir la clé de Banque" })).toHaveAttribute("href", `${ICI}?connector=${BANQUE.id}`)
    const agenda = ligneDe("Agenda de Paul")
    expect(agenda.getByText("À reconnecter")).toBeInTheDocument()
    expect(agenda.getByText("Demandez à Paul Durand de le reconnecter.")).toBeInTheDocument()
    expect(agenda.queryByRole("button")).toBeNull()

    fireEvent.click(ligneDe("Mon agenda").getByRole("button", { name: "Reconnecter Mon agenda" }))
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://login.example.test/authorize?state=s"))
    expect(envois()).toEqual([{ url: "/api/platform/connector-consent", methode: "POST", corps: { connector: "microsoft", return_to: ICI } }])
  })

  it("should teach the empty page in three steps, offer to add a connector once, and open the sheet of a tool from its logo, the same for an administrator", () => {
    for (const donnees of [{ accounts: [] }, { accounts: [], connectors: [MAIL, CRM], ...ADMINISTRE }]) {
      const { unmount } = rendre(donnees)
      expect(screen.getByRole("heading", { level: 2, name: "Votre assistant n'a encore accès à aucun outil" })).toBeInTheDocument()
      expect(screen.getAllByRole("listitem").slice(0, 3).map((etape) => etape.textContent)).toEqual([
        expect.stringContaining("Choisissez un outil"),
        expect.stringContaining("Connectez votre compte"),
        expect.stringContaining("Demandez à votre assistant"),
      ])
      expect(screen.getAllByRole("button", { name: "Ajouter un connecteur" })).toHaveLength(1)
      expect(screen.queryByRole("table")).toBeNull()
      expect(screen.queryByRole("region", { name: "Outils de l'organisation" })).toBeNull()
      unmount()
    }
    rendre({ accounts: [] })
    fireEvent.click(within(screen.getByRole("list", { name: "Quelques outils" })).getByRole("button", { name: "Crm Pro" }))
    const fenetre = within(screen.getByRole("dialog", { name: "Ajouter un connecteur" }))
    expect(fenetre.getByRole("heading", { name: "Crm Pro" })).toHaveFocus()
    fireEvent.click(fenetre.getByRole("button", { name: "Tous les outils" }))
    expect(fenetre.getByRole("heading", { name: "Choisir un outil" })).toHaveFocus()
  })

  it("should say a failed read in an alert, with a way to retry, and render a busy status while loading", () => {
    const { unmount } = rendre({ error: "Une erreur est survenue. Réessayez." })
    expect(screen.getByRole("alert")).toHaveTextContent("Les connecteurs n'ont pas pu être lus.Une erreur est survenue. Réessayez.")
    expect(screen.getByRole("link", { name: "Réessayer" })).toHaveAttribute("href", ICI)
    expect(screen.queryByRole("button", { name: "Ajouter un connecteur" })).toBeNull()
    unmount()
    render(<EcranConnecteursChargement />)
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true")
  })
})

describe("EcranConnecteurs, the detail of a connector", () => {
  it("should open the account of the address in a drawer: its tool, its state, who may use it, what the assistant may do by group and its connection; the close button and Escape lead back to the list", () => {
    rendre({}, { vue: { filtre: "mine", compte: BANQUE.id } })
    const detail = detailDe(BANQUE)
    expect(detail.getByText("Crm Pro · clé posée le 2 novembre 2026")).toBeInTheDocument()
    expect(detail.getByText("Non testé")).toBeInTheDocument()
    expect(within(detail.getByRole("heading", { name: "Qui peut s'en servir" }).closest("section") ?? document.body).getAllByRole("listitem").map((ligne) => ligne.textContent)).toEqual([
      expect.stringMatching(/Léa Bernard.*vous.*Propriétaire$/),
      expect.stringMatching(/Équipe Finance.*Lire$/),
      expect.stringMatching(/Paul Durand.*Lire et modifier$/),
    ])
    // Trois groupes repliés, leur nombre de fonctions ; seules les sensibles demandent l'accord.
    expect(groupesDe(BANQUE)).toEqual([
      "Lire. 2 fonctions, afficher la liste",
      "Créer et modifier. 1 fonction, afficher la liste",
      "Avec votre accord, il vous demande avant. 1 fonction, afficher la liste",
    ])
    expect(detail.getByText("crm.delete")).toBeInTheDocument()

    fireEvent.click(detail.getByRole("button", { name: "Fermer le détail" }))
    expect(naviguer).toHaveBeenLastCalledWith(`${ICI}?filter=mine`)
    cleanup()
    rendre({}, { vue: { compte: BANQUE.id } })
    fireEvent(screen.getByRole("dialog", { name: "Banque" }), new Event("cancel", { cancelable: true }))
    expect(naviguer).toHaveBeenLastCalledWith(ICI)
  })

  it("should open nothing for an account the person does not see", () => {
    rendre({}, { vue: { compte: "6b2f3c1d-4e5a-4b6c-8d7e-9f0a1b2c3d99" } })
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("should offer nothing reserved to who manages the account under that level, and say who manages it", () => {
    rendre({ accounts: [{ ...BANQUE, owner: A_PAUL, viewerLevel: "sensitive" }], partages: {} }, { vue: { compte: BANQUE.id } })
    const detail = detailDe(BANQUE)
    expect(detail.getByText("Géré par Paul Durand.")).toBeInTheDocument()
    expect(detail.getAllByRole("listitem")[1]).toHaveTextContent(/^.*Léa Bernard.*vous.*Tout, avec accord$/)
    expect(detail.queryByRole("heading", { name: "Arrêter" })).toBeNull()
    for (const geste of [/^Partager/, /^Gérer les accès/, /la clé/, /^Désactiver/, /^Journal des partages/, /^Tester/, /^Modifier le nom/, /^Bloquer/]) expect(detail.queryByRole("button", { name: geste })).toBeNull()
    cleanup()
    rendre({ accounts: [{ ...BANQUE, owner: A_PAUL, viewerLevel: "sensitive", status: "disabled" }], partages: {} }, { vue: { compte: BANQUE.id } })
    for (const geste of [/^Réactiver/, /la clé/, /^Tester/]) expect(detailDe(BANQUE).queryByRole("button", { name: geste })).toBeNull()
  })

  it("should replace the key in the drawer, never prefilling a secret field, and say a refusal in the form", async () => {
    fetchMock.mockResolvedValueOnce(reponse(400, { error: { code: "invalid_arguments", message: "server text" } })).mockResolvedValueOnce(reponse(200, { data: { account: { id: BANQUE.id } } }))
    rendre({}, { vue: { compte: BANQUE.id } })
    const detail = detailDe(BANQUE)
    expect(detail.queryByRole("form")).toBeNull()
    fireEvent.click(detail.getByRole("button", { name: "Remplacer la clé de Banque" }))
    const formulaire = within(detail.getByRole("form", { name: "Clé et réglages de Banque" }))
    expect(formulaire.getByLabelText("Clé d'API")).toHaveAttribute("type", "password")
    expect(formulaire.getByLabelText("Clé d'API")).toHaveValue("")
    fireEvent.change(formulaire.getByLabelText("Clé d'API"), { target: { value: "s3cr3t" } })
    fireEvent.click(formulaire.getByRole("button", { name: "Enregistrer" }))
    expect(await formulaire.findByRole("alert")).toBeInTheDocument()
    expect(rafraichir).not.toHaveBeenCalled()

    fireEvent.click(formulaire.getByRole("button", { name: "Enregistrer" }))
    await waitFor(() => expect(rafraichir).toHaveBeenCalledTimes(1))
    expect(envois()[1]).toEqual({ url: `/api/platform/admin/accounts/${BANQUE.id}/secret`, methode: "POST", corps: { secret: { api_key: "s3cr3t" } } })
    expect(screen.queryByDisplayValue("s3cr3t")).toBeNull()
  })

  it("should offer the key form open when the account waits for its key", () => {
    rendre({ accounts: [{ ...BANQUE, secret: { fields: [], updatedAt: null } }] }, { vue: { compte: BANQUE.id } })
    const detail = detailDe(BANQUE)
    expect(detail.getByText("À terminer")).toBeInTheDocument()
    expect(detail.getByRole("button", { name: "Saisir la clé de Banque" })).toHaveAttribute("aria-expanded", "true")
    expect(detail.getByRole("form", { name: "Clé et réglages de Banque" })).toBeInTheDocument()
    // Sans clé, rien à tester.
    expect(detail.queryByRole("button", { name: /^Tester/ })).toBeNull()
  })

  it("should disable the account after the question, which says it can be enabled again", async () => {
    fetchMock.mockResolvedValue(reponse(200, { data: { account: { id: BANQUE.id } } }))
    rendre({}, { vue: { compte: BANQUE.id } })
    const detail = detailDe(BANQUE)
    fireEvent.click(detail.getByRole("button", { name: "Désactiver Banque" }))
    const question = "Désactiver « Banque » ? Aucun assistant ne pourra plus s'en servir, dès maintenant. Vous pourrez le réactiver."
    fireEvent.click(within(detail.getByRole("group", { name: question })).getByRole("button", { name: "Désactiver" }))
    await waitFor(() => expect(rafraichir).toHaveBeenCalledTimes(1))
    expect(envois()).toEqual([{ url: `/api/platform/admin/accounts/${BANQUE.id}/disable`, methode: "POST", corps: {} }])
    // La relecture emporte le bouton : le focus l'attend au titre de l'état, qui reste.
    expect(detail.getByRole("group", { name: "État" })).toHaveFocus()
  })

  it("should enable a disabled account again without a question, keeping its key form, and say a refusal by its reason", async () => {
    fetchMock.mockImplementation(async () => reponse(200, { data: { account: BANQUE } }))
    rendre({ accounts: [{ ...BANQUE, status: "disabled" }] }, { vue: { compte: BANQUE.id } })
    expect(ligneDe("Banque").getByText("Désactivé")).toBeInTheDocument()
    const detail = detailDe(BANQUE)
    expect(detail.queryByRole("button", { name: /^Désactiver/ })).toBeNull()
    expect(detail.getByRole("button", { name: "Remplacer la clé de Banque" })).toBeInTheDocument()
    fireEvent.click(detail.getByRole("button", { name: "Réactiver Banque" }))
    await waitFor(() => expect(rafraichir).toHaveBeenCalledTimes(1))
    expect(envois()).toEqual([{ url: `/api/platform/admin/accounts/${BANQUE.id}/enable`, methode: "POST", corps: {} }])
    expect(detail.getByRole("group", { name: "État" })).toHaveFocus()

    fetchMock.mockImplementation(async () => reponse(403, { error: { code: "not_enabled", details: { reason: "closed", administrators: [{ name: "Claire Morel" }] } } }))
    fireEvent.click(detail.getByRole("button", { name: "Réactiver Banque" }))
    expect(await detail.findByText("Cet outil a été bloqué pour l'organisation par un administrateur. Un administrateur peut le débloquer.")).toBeInTheDocument()
  })

  it("should test a connector for who manages it, say a failed test and too many tests, and offer no test under that level", async () => {
    fetchMock.mockImplementation(async () => reponse(200, { data: { probe: { at: "2026-11-14T09:00:00.000Z", healthy: false, code: "credential_rejected", reason: "Crm refused the key. (key_rejected)", balance: null } } }))
    const { unmount } = rendre({}, { vue: { compte: BANQUE.id } })
    const detail = detailDe(BANQUE)
    fireEvent.click(detail.getByRole("button", { name: "Tester Banque" }))
    expect(await detail.findByText("Le service a refusé la clé.")).toBeInTheDocument()
    expect(rafraichir).toHaveBeenCalledTimes(1)
    expect(envois()).toEqual([{ url: `/api/platform/admin/accounts/${BANQUE.id}/probe`, methode: "POST", corps: {} }])

    fetchMock.mockImplementation(async () => reponse(429, { error: { code: "rate_limited", details: { retry_after_s: 12 } } }))
    fireEvent.click(detail.getByRole("button", { name: "Tester Banque" }))
    expect(await detail.findByText("Trop de tests : réessayez dans 12 secondes.")).toBeInTheDocument()
    expect(rafraichir).toHaveBeenCalledTimes(1)
    unmount()

    rendre({}, { vue: { compte: AGENDA.id } })
    expect(detailDe(AGENDA).queryByRole("button", { name: /^Tester/ })).toBeNull()
  })

  it("should say the last test kept on the account: its failure with the reason of the engine, and that a tool has no automatic test", () => {
    const teste: AccountView = { ...BANQUE, lastProbe: { at: "2026-11-14T09:00:00.000Z", healthy: false, code: "unreachable", reason: "Crm is unreachable.", balance: null } }
    const { unmount } = rendre({ accounts: [teste] }, { vue: { compte: BANQUE.id } })
    expect(ligneDe("Banque").getByText("Test en échec")).toBeInTheDocument()
    // La raison se dit en français par le code du moteur ; sa phrase reste lisible, repliée.
    expect(detailDe(BANQUE).getByText("· le service est injoignable. Testé le 14 novembre 2026.")).toBeInTheDocument()
    expect(detailDe(BANQUE).getByText("Crm is unreachable.")).toBeInTheDocument()
    unmount()

    // Désactivé, l'état ne dit pas le test : sa raison reste lisible dans le détail.
    const desactive = rendre({ accounts: [{ ...teste, status: "disabled" }] }, { vue: { compte: BANQUE.id } })
    expect(ligneDe("Banque").getByText("Désactivé")).toBeInTheDocument()
    expect(detailDe(BANQUE).getByText("Crm is unreachable.")).toBeInTheDocument()
    desactive.unmount()

    rendre({ formulaires: [{ ...FORMULAIRE_CRM, probe: { available: false, balance: false } }] }, { vue: { compte: BANQUE.id } })
    const detail = detailDe(BANQUE)
    expect(detail.queryByRole("button", { name: /^Tester/ })).toBeNull()
    expect(detail.getByText("Pas de test automatique pour cet outil : essayez-le dans votre assistant.")).toBeInTheDocument()
  })

  it("should rename and describe a connector for who manages it, warn that the old name is forgotten, and say a name already taken", async () => {
    fetchMock.mockImplementation(async () => reponse(200, { data: { account: BANQUE } }))
    rendre({ accounts: [{ ...BANQUE, description: "Les relevés du compte courant" }, AGENDA] }, { vue: { compte: BANQUE.id } })
    // La description remplace le nom de l'outil sous le libellé, et se lit dans le détail.
    expect(screen.getByRole("link", { name: "Banque" }).closest("td")?.querySelector(".oto-caption")).toHaveTextContent("Les relevés du compte courant")
    const detail = detailDe(BANQUE)
    fireEvent.click(detail.getByRole("button", { name: "Modifier le nom de Banque" }))
    const formulaire = within(detail.getByRole("form", { name: "Nom et description de Banque" }))
    expect(formulaire.getByText("L'ancien nom ne sera plus reconnu par votre assistant.")).toBeInTheDocument()
    fireEvent.change(formulaire.getByLabelText("Nom"), { target: { value: "Banque pro" } })
    fireEvent.change(formulaire.getByLabelText("Description (facultatif)"), { target: { value: "" } })
    fireEvent.click(formulaire.getByRole("button", { name: "Enregistrer" }))
    await waitFor(() => expect(rafraichir).toHaveBeenCalledTimes(1))
    expect(envois()).toEqual([{ url: `/api/platform/admin/accounts/${BANQUE.id}`, methode: "PATCH", corps: { label: "Banque pro", description: null } }])
    expect(detail.getByText("Nom et description enregistrés.")).toBeInTheDocument()
    // La saisie repliée emportait le focus : il revient au bouton qui l'a ouverte.
    expect(detail.getByRole("button", { name: "Modifier le nom de Banque" })).toHaveFocus()

    fetchMock.mockImplementation(async () => reponse(409, { error: { code: "conflict", details: { reason: "label_taken" } } }))
    fireEvent.click(detail.getByRole("button", { name: "Modifier le nom de Banque" }))
    const repris = within(detail.getByRole("form", { name: "Nom et description de Banque" }))
    fireEvent.change(repris.getByLabelText("Nom"), { target: { value: "Agenda" } })
    fireEvent.click(repris.getByRole("button", { name: "Enregistrer" }))
    expect(await repris.findByText("Un connecteur du même propriétaire porte déjà ce nom.")).toBeInTheDocument()
  })

  it("should read the share journal on opening, and say each share in the words of the levels", async () => {
    fetchMock.mockResolvedValue(
      reponse(200, {
        data: {
          label: "Banque",
          events: [
            { at: "2026-10-18T09:12:00.000Z", action: "removed", subject: { kind: "user", name: "Paul Durand" }, level: "read", previous: null, by: { name: "Léa Bernard" } },
            { at: "2026-10-17T08:00:00.000Z", action: "set", subject: { kind: "team", name: "Support" }, level: "write", previous: "read", by: { name: null } },
            { at: "2026-10-16T08:00:00.000Z", action: "set", subject: { kind: "org", name: null }, level: "sensitive", previous: null, by: null },
          ],
        },
      }),
    )
    rendre({}, { vue: { compte: BANQUE.id } })
    fireEvent.click(detailDe(BANQUE).getByRole("button", { name: "Journal des partages de Banque" }))
    const journal = await screen.findByRole("list", { name: "Journal des partages de Banque" })
    expect(within(journal).getAllByRole("listitem").map((ligne) => ligne.textContent)).toEqual([
      expect.stringMatching(/^18 octobre 2026 à \d\d:12 · Léa Bernard a retiré le partage à Paul Durand \(Lire\)$/),
      expect.stringMatching(/^17 octobre 2026 à \d\d:00 · Une personne qui n'est plus membre a partagé à l'équipe Support \(Lire et modifier, avant : Lire\)$/),
      expect.stringMatching(/^16 octobre 2026 à \d\d:00 · Hors session a partagé à toute l'organisation \(Tout, avec accord\)$/),
    ])
    expect(envois()).toEqual([{ url: `/api/platform/admin/accounts/${BANQUE.id}/share-journal`, methode: "GET", corps: undefined }])
  })
})

describe("EcranConnecteurs, sharing a connector", () => {
  const ouvrir = (libelle: RegExp = /^Partager Banque$/) => {
    fireEvent.click(detailDe(BANQUE).getByRole("button", { name: libelle }))
    return within(screen.getByRole("dialog", { name: "Partager « Banque »" }))
  }

  it("should open the panel from « Partager », with the shares read and what the engine does of a personal account", () => {
    rendre({}, { vue: { compte: BANQUE.id } })
    const panneau = ouvrir()
    expect(within(panneau.getByRole("list", { name: "Personnes et équipes ajoutées" })).getAllByRole("listitem").map((ligne) => ligne.textContent)).toEqual([
      expect.stringContaining("Équipe Finance"),
      expect.stringContaining("Paul Durand"),
    ])
    expect(libellesDesChoix(panneau.getByLabelText("Accès de Paul Durand"))).toEqual(["Lire", "Lire et modifier", "Tout, avec accord", "Retirer l'accès"])
    expect(panneau.getByText(/L'assistant de la personne s'en servira quand elle le lui demandera en le nommant\. La clé reste cachée : personne ne peut la lire ni la copier\./)).toBeInTheDocument()
    fireEvent.click(panneau.getByRole("button", { name: "Fermer" }))
    expect(screen.queryByRole("dialog", { name: "Partager « Banque »" })).toBeNull()
    expect(ouvrir().getByRole("combobox", { name: "Ajouter une personne ou une équipe" })).toBeInTheDocument()
  })

  it("should say that the assistant of the members uses a team account without naming it", () => {
    const dEquipe: AccountView = { ...MAIL_VENTES, viewerLevel: "manage" }
    rendre({ accounts: [dEquipe], partages: { [dEquipe.id]: { general: null, rules: [] } } }, { vue: { compte: dEquipe.id } })
    fireEvent.click(detailDe(dEquipe).getByRole("button", { name: "Partager Mail Ventes" }))
    expect(screen.getByText(/L'assistant des membres s'en sert sans avoir à le nommer\./)).toBeInTheDocument()
  })

  it("should propose the teams and the people that answer a name, never the owner of a personal account nor a subject already added, and add the chosen one in read only", async () => {
    fetchMock.mockResolvedValue(reponse(200, { data: { rule: {} } }))
    rendre({}, { vue: { compte: BANQUE.id } })
    const panneau = ouvrir()
    const champ = panneau.getByRole("combobox", { name: "Ajouter une personne ou une équipe" })
    fireEvent.change(champ, { target: { value: "e" } })
    // « e » est dans Ventes, Finance, Léa Bernard, Nadia Finet : Finance est déjà ajoutée, Léa possède le compte.
    const proposes = panneau.getAllByRole("option")
    expect(proposes).toHaveLength(2)
    expect(proposes[0]).toHaveAccessibleName("Équipe Ventes")
    expect(proposes[1]).toHaveAccessibleName("Nadia Finet")
    fireEvent.change(champ, { target: { value: "ventes" } })
    fireEvent.click(panneau.getByRole("option", { name: "Équipe Ventes" }))

    await waitFor(() => expect(rafraichir).toHaveBeenCalledTimes(1))
    expect(envois()).toEqual([{ url: "/api/platform/admin/account-rules", methode: "POST", corps: { accountId: BANQUE.id, subject: { kind: "team", id: VENTES }, level: "read" } }])
    expect(panneau.getByRole("status")).toHaveTextContent("Équipe Ventes : lire.")
  })

  it("should change the level of a line, never offering the management to who does not administer, and remove an access without a further question", async () => {
    // Une réponse neuve par appel : le corps d'une `Response` ne se lit qu'une fois.
    fetchMock.mockImplementation(async () => reponse(200, { data: {} }))
    rendre({}, { vue: { compte: BANQUE.id } })
    const panneau = ouvrir()
    choisirDansLaListe(panneau.getByLabelText("Accès de Équipe Finance"), "Tout, avec accord")
    await waitFor(() => expect(rafraichir).toHaveBeenCalledTimes(1))
    choisirDansLaListe(panneau.getByLabelText("Accès de Paul Durand"), "Retirer l'accès")
    await waitFor(() => expect(rafraichir).toHaveBeenCalledTimes(2))
    expect(envois()).toEqual([
      { url: "/api/platform/admin/account-rules", methode: "POST", corps: { accountId: BANQUE.id, subject: { kind: "team", id: FINANCE }, level: "sensitive" } },
      { url: `/api/platform/admin/account-rules/${PARTAGES_DE_BANQUE.rules[1].id}`, methode: "DELETE", corps: undefined },
    ])
    await waitFor(() => expect(screen.getByRole("heading", { name: /Personnes et équipes ajoutées/ })).toHaveFocus())
  })

  it("should set the rule of the whole organisation, and remove it on « Aucun accès »", async () => {
    fetchMock.mockImplementation(async () => reponse(200, { data: {} }))
    const { rerender } = rendre({}, { vue: { compte: BANQUE.id } })
    const panneau = ouvrir()
    expect(libellesDesChoix(panneau.getByLabelText("Accès de toute l'organisation"))).toEqual(["Lire", "Lire et modifier", "Tout, avec accord", "Aucun accès"])
    choisirDansLaListe(panneau.getByLabelText("Accès de toute l'organisation"), "Lire")
    await waitFor(() => expect(rafraichir).toHaveBeenCalledTimes(1))

    const general = { id: "9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c09", level: "read" as const }
    rerender(ecran({ partages: { [BANQUE.id]: { ...PARTAGES_DE_BANQUE, general } } }, { vue: { compte: BANQUE.id } }))
    choisirDansLaListe(panneau.getByLabelText("Accès de toute l'organisation"), "Aucun accès")
    await waitFor(() => expect(rafraichir).toHaveBeenCalledTimes(2))
    expect(envois()).toEqual([
      { url: "/api/platform/admin/account-rules", methode: "POST", corps: { accountId: BANQUE.id, subject: { kind: "org" }, level: "read" } },
      { url: `/api/platform/admin/account-rules/${general.id}`, methode: "DELETE", corps: undefined },
    ])
  })

  it("should give the focus to the state of the detail when the person lowers their own management and the panel leaves with the re-read", async () => {
    fetchMock.mockImplementation(async () => reponse(200, { data: {} }))
    const dePaul: AccountView = { ...BANQUE, owner: A_PAUL }
    const maRegle = { id: "9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c07", subject: { kind: "user" as const, id: LEA, name: "Léa Bernard" }, level: "manage" as const }
    const { rerender } = rendre({ accounts: [dePaul], partages: { [BANQUE.id]: { general: null, rules: [maRegle] } } }, { vue: { compte: BANQUE.id } })
    const panneau = ouvrir()
    expect(libellesDesChoix(panneau.getByLabelText("Accès de Léa Bernard"))).toEqual(["Gestion", "Lire", "Lire et modifier", "Tout, avec accord", "Retirer l'accès"])
    choisirDansLaListe(panneau.getByLabelText("Accès de Léa Bernard"), "Lire")
    await waitFor(() => expect(rafraichir).toHaveBeenCalledTimes(1))

    // La relecture : elle ne gère plus le compte, ni panneau ni « Partager ».
    rerender(ecran({ accounts: [{ ...dePaul, viewerLevel: "read" }], partages: {} }, { vue: { compte: BANQUE.id } }))
    expect(screen.queryByRole("dialog", { name: "Partager « Banque »" })).toBeNull()
    await waitFor(() => expect(detailDe(BANQUE).getByRole("group", { name: "État" })).toHaveFocus())
  })

  it("should say a refusal of the service and keep the level served", async () => {
    fetchMock.mockResolvedValue(reponse(403, { error: { code: "forbidden", message: "server text" } }))
    rendre({}, { vue: { compte: BANQUE.id } })
    const panneau = ouvrir()
    choisirDansLaListe(panneau.getByLabelText("Accès de Paul Durand"), "Lire")
    expect(await panneau.findByRole("alert")).toHaveTextContent("Seule une personne qui gère ce connecteur peut le partager.")
    expect(panneau.getByLabelText("Accès de Paul Durand")).toHaveTextContent("Lire et modifier")
    expect(rafraichir).not.toHaveBeenCalled()
  })
})

describe("EcranConnecteurs, adding a connector", () => {
  const MS: OrgConnector = { ...CRM, connector: "microsoft", label: "Microsoft 365", functions: [] }
  const CREE = "6b2f3c1d-4e5a-4b6c-8d7e-9f0a1b2c3d60"
  // Une clé de test composée à l'exécution : aucun faux secret en littéral.
  const CLE = ["cle", "de", "test"].join("-")
  const SAINE = { healthy: true, code: null, reason: null, balance: null }

  /** Les réponses de l'API par méthode et ressource ; une route inattendue lève. */
  const parRoute = (routes: Record<string, () => Response>) =>
    fetchMock.mockImplementation(async (url, init) => {
      const route = `${init?.method ?? "GET"} ${String(url).replace("/api/platform/", "")}`
      if (!Object.hasOwn(routes, route)) throw new Error(`route inattendue : ${route}`)
      return routes[route]()
    })

  const ouvrirLaFenetre = () => {
    fireEvent.click(screen.getByRole("button", { name: "Ajouter un connecteur" }))
    return within(screen.getByRole("dialog", { name: "Ajouter un connecteur" }))
  }

  /** Le nom d'une carte : son texte sans sa tuile, cachée aux lecteurs d'écran, ni ce qu'elle dit dessous. */
  const nomDe = (carte: HTMLElement) => {
    const copie = carte.cloneNode(true)
    if (!(copie instanceof HTMLElement)) return null
    copie.querySelectorAll('[aria-hidden="true"], .oto-caption, [role="img"]').forEach((cache) => cache.remove())
    return copie.textContent
  }

  /** Les noms des cartes ouvertes du catalogue, dans l'ordre, sans les gestes de gouvernance. */
  const cartes = (fenetre: ReturnType<typeof within>) =>
    within(fenetre.getAllByRole("list")[0])
      .getAllByRole("button")
      .filter((bouton) => !/^Bloquer/.test(bouton.getAttribute("aria-label") ?? ""))
      .map(nomDe)

  /** La carte d'un outil, par le début de son nom : la carte dit aussi ses fonctions. */
  const carte = (fenetre: ReturnType<typeof within>, nom: string) => fenetre.getByRole("button", { name: new RegExp(`^${nom}`) })

  it("should show a member the tools they may add for themselves, never how a tool connects, and connect an account at the third party", async () => {
    const assign = vi.fn()
    vi.stubGlobal("location", { ...window.location, assign })
    fetchMock.mockResolvedValue(reponse(200, { data: { url: "https://login.example.test/authorize?state=s" } }))
    rendre({ connectors: [MAIL, CRM, MS] })
    const fenetre = ouvrirLaFenetre()
    // « mail », sans formulaire, ne se crée que pour l'organisation ou une équipe : un membre ne le voit pas.
    expect(cartes(fenetre)).toEqual(["Crm Pro", "Microsoft 365"])
    fireEvent.click(fenetre.getByRole("button", { name: "Microsoft 365" }))
    expect(fenetre.getByRole("heading", { name: "Microsoft 365" })).toHaveFocus()
    expect(fenetre.queryByRole("form")).toBeNull()
    fireEvent.click(fenetre.getByRole("button", { name: "Connecter mon compte Microsoft 365" }))
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://login.example.test/authorize?state=s"))
    expect(envois()).toEqual([{ url: "/api/platform/connector-consent", methode: "POST", corps: { connector: "microsoft", return_to: ICI } }])
    fireEvent.click(fenetre.getByRole("button", { name: "Tous les outils" }))
    expect(fenetre.getByRole("heading", { name: "Choisir un outil" })).toHaveFocus()
  })

  it("should say so to a member who can add nothing, and put a tool blocked by an administrator at the bottom, greyed, saying by whom and whom to ask", () => {
    const { unmount } = rendre({ connectors: [MAIL] })
    expect(ouvrirLaFenetre().getByText("Aucun outil à ajouter pour l'instant. Un administrateur peut ajouter un connecteur et le partager avec vous.")).toBeInTheDocument()
    unmount()
    rendre({ connectors: [{ ...CRM, state: "inactive", closedBy: { userId: "user-claire", name: "Claire Morel" } }, MS] })
    const fenetre = ouvrirLaFenetre()
    expect(cartes(fenetre)).toEqual(["Microsoft 365"])
    const bloques = within(fenetre.getByRole("region", { name: "Bloqués pour l'organisation" }))
    expect(bloques.getByText("Bloqué par Claire Morel. Demandez à un administrateur si vous en avez besoin.")).toBeInTheDocument()
    expect(bloques.queryByRole("button")).toBeNull()
    expect(fenetre.queryByRole("button", { name: /^Bloquer/ })).toBeNull()
  })

  it("should say a search of the catalogue without answer, and where to ask for a missing tool", () => {
    rendre()
    const fenetre = ouvrirLaFenetre()
    fireEvent.change(fenetre.getByRole("searchbox", { name: "Rechercher un outil" }), { target: { value: "introuvable" } })
    expect(fenetre.getByRole("status")).toHaveTextContent("Aucun outil ne correspond à « introuvable ».Un outil manque ? Dites-le à un administrateur de l'organisation.")
  })

  it("should let a member add a key connector: the key tested once complete, then the account, its key, its description and its test, the key never shown again", async () => {
    parRoute({
      "POST admin/connectors/crm/probe": () => reponse(200, { data: { probe: SAINE } }),
      "POST admin/accounts": () => reponse(201, { data: { account: { id: CREE, label: "Crm Pro" } } }),
      [`POST admin/accounts/${CREE}/secret`]: () => reponse(200, { data: { account: { id: CREE } } }),
      [`POST admin/accounts/${CREE}/probe`]: () => reponse(200, { data: { probe: { ...SAINE, at: "2026-11-14T09:00:00.000Z" } } }),
    })
    rendre({ accounts: [AGENDA] })
    const fenetre = ouvrirLaFenetre()
    fireEvent.click(carte(fenetre, "Crm Pro"))
    const formulaire = within(fenetre.getByRole("form", { name: "Ajouter Crm Pro" }))
    // Un membre n'a pas le choix du propriétaire : le connecteur est à lui ; son premier de l'outil prend son nom, sans le demander.
    expect(formulaire.queryByLabelText("Propriétaire")).toBeNull()
    expect(formulaire.queryByLabelText(/^Nom/)).toBeNull()
    expect(formulaire.getByRole("heading", { name: "Ce que votre assistant pourra faire" })).toBeInTheDocument()
    const cle = formulaire.getByLabelText("Clé d'API")
    // Sans clé, la sortie d'un champ ne teste rien.
    fireEvent.blur(cle)
    expect(envois()).toEqual([])
    // Une frappe ne teste rien : la clé part à la sortie du champ.
    fireEvent.change(cle, { target: { value: CLE } })
    expect(envois()).toEqual([])
    // « Ajouter » aussitôt sorti du champ, le test encore en cours : la même clé ne part pas deux fois.
    fireEvent.blur(cle)
    fireEvent.click(screen.getByRole("button", { name: "Ajouter le connecteur" }))
    await waitFor(() => expect(naviguer).toHaveBeenLastCalledWith(`${ICI}?connector=${CREE}`))
    expect(envois()).toEqual([
      { url: "/api/platform/admin/connectors/crm/probe", methode: "POST", corps: { fields: { api_key: CLE }, settings: { region: "us" } } },
      { url: "/api/platform/admin/accounts", methode: "POST", corps: { connector: "crm", owner_kind: "user", label: "Crm Pro", mode: "reel" } },
      { url: `/api/platform/admin/accounts/${CREE}/secret`, methode: "POST", corps: { secret: { api_key: CLE }, settings: { region: "us" } } },
      { url: `/api/platform/admin/accounts/${CREE}/probe`, methode: "POST", corps: {} },
    ])
    expect(rafraichir).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole("dialog", { name: "Ajouter un connecteur" })).toBeNull()
    expect(screen.queryByDisplayValue(CLE)).toBeNull()
  })

  it("should ask « Ajouter quand même ? » after a failed test, create only from that question and only for the key that failed, and show the name to change when it is already taken, the entry kept", async () => {
    const creation = vi.fn(() => reponse(409, { error: { code: "conflict", details: { reason: "label_taken" } } }))
    const sonde = vi.fn(() => reponse(200, { data: { probe: { healthy: false, code: "credential_rejected", reason: "Crm refused the key. (key_rejected)", balance: null } } }))
    parRoute({ "POST admin/connectors/crm/probe": sonde, "POST admin/accounts": creation })
    rendre({ accounts: [AGENDA] })
    const fenetre = ouvrirLaFenetre()
    fireEvent.click(carte(fenetre, "Crm Pro"))
    const formulaire = within(fenetre.getByRole("form", { name: "Ajouter Crm Pro" }))
    fireEvent.change(formulaire.getByLabelText("Clé d'API"), { target: { value: CLE } })
    // « Ajouter » sans être sorti du champ : la clé se teste d'abord, et son échec pose la question au lieu de créer.
    fireEvent.click(screen.getByRole("button", { name: "Ajouter le connecteur" }))
    const question = within(await formulaire.findByRole("group", { name: "Ajouter quand même ?" }))
    expect(formulaire.getByText("Crm refused the key. (key_rejected)")).toBeInTheDocument()
    // « Ajouter » de nouveau, un double clic par exemple : toujours rien de créé, et la même clé ne se reteste pas.
    fireEvent.click(screen.getByRole("button", { name: "Ajouter le connecteur" }))
    await waitFor(() => expect(screen.getByRole("button", { name: "Ajouter le connecteur" })).toBeEnabled())
    expect([sonde.mock.calls.length, creation.mock.calls.length]).toEqual([1, 0])
    // Une autre clé, saisie sans sortir du champ : « Ajouter quand même » la teste, et ne crée rien sur son échec.
    fireEvent.change(formulaire.getByLabelText("Clé d'API"), { target: { value: `${CLE}-2` } })
    fireEvent.click(question.getByRole("button", { name: "Ajouter quand même" }))
    await waitFor(() => expect(sonde).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByRole("button", { name: "Ajouter le connecteur" })).toBeEnabled())
    expect(creation).not.toHaveBeenCalled()
    fireEvent.click(within(formulaire.getByRole("group", { name: "Ajouter quand même ?" })).getByRole("button", { name: "Ajouter quand même" }))
    expect(await formulaire.findByText("Un connecteur du même propriétaire porte déjà ce nom.")).toBeInTheDocument()
    await waitFor(() => expect(formulaire.getByLabelText("Nom (facultatif)")).toHaveFocus())
    expect([sonde.mock.calls.length, creation.mock.calls.length]).toEqual([2, 1])
    expect(formulaire.getByLabelText("Clé d'API")).toHaveValue(`${CLE}-2`)
    expect(naviguer).not.toHaveBeenCalled()
  })

  it("should say what is left to finish when a step fails after the account is created, with its reason, then open the detail", async () => {
    parRoute({
      "POST admin/connectors/crm/probe": () => reponse(200, { data: { probe: SAINE } }),
      "POST admin/accounts": () => reponse(201, { data: { account: { id: CREE, label: "Crm Pro" } } }),
      [`POST admin/accounts/${CREE}/secret`]: () => reponse(400, { error: { code: "invalid_arguments" } }),
    })
    rendre()
    const fenetre = ouvrirLaFenetre()
    fireEvent.click(carte(fenetre, "Crm Pro"))
    const formulaire = within(fenetre.getByRole("form", { name: "Ajouter Crm Pro" }))
    fireEvent.change(formulaire.getByLabelText("Clé d'API"), { target: { value: CLE } })
    fireEvent.click(screen.getByRole("button", { name: "Ajouter le connecteur" }))
    expect(await fenetre.findByText("« Crm Pro » est ajouté, mais il reste à terminer.")).toHaveFocus()
    expect(fenetre.getByText("Sa clé n'est pas posée : Certaines valeurs sont invalides.")).toBeInTheDocument()
    // La clé n'est pas posée : le compte ne se teste pas, et la saisie de la clé a quitté le document.
    expect(envois().map((envoi) => envoi.url)).not.toContain(`/api/platform/admin/accounts/${CREE}/probe`)
    expect(screen.queryByDisplayValue(CLE)).toBeNull()
    expect(naviguer).not.toHaveBeenCalled()
    fireEvent.click(fenetre.getByRole("button", { name: "Ouvrir le connecteur" }))
    expect(naviguer).toHaveBeenLastCalledWith(`${ICI}?connector=${CREE}`)
  })

  it("should not test the key of a tool without a probe, and say it", async () => {
    parRoute({
      "POST admin/accounts": () => reponse(201, { data: { account: { id: CREE, label: "Crm Pro" } } }),
      [`POST admin/accounts/${CREE}/secret`]: () => reponse(200, { data: { account: { id: CREE } } }),
    })
    rendre({ formulaires: [{ ...FORMULAIRE_CRM, probe: { available: false, balance: false } }] })
    const fenetre = ouvrirLaFenetre()
    fireEvent.click(carte(fenetre, "Crm Pro"))
    const formulaire = within(fenetre.getByRole("form", { name: "Ajouter Crm Pro" }))
    expect(formulaire.getByText("Pas de test automatique pour cet outil : essayez-le dans votre assistant.")).toBeInTheDocument()
    fireEvent.change(formulaire.getByLabelText("Clé d'API"), { target: { value: CLE } })
    fireEvent.blur(formulaire.getByLabelText("Clé d'API"))
    fireEvent.click(screen.getByRole("button", { name: "Ajouter le connecteur" }))
    await waitFor(() => expect(naviguer).toHaveBeenCalledTimes(1))
    expect(envois().map((envoi) => envoi.url)).toEqual(["/api/platform/admin/accounts", `/api/platform/admin/accounts/${CREE}/secret`])
  })

  it("should let an administrator give the connector of a tool without a form to a team, from the owner line, and never propose themselves for it", async () => {
    // « mail » n'a pas de formulaire : son compte se crée au mode que le connecteur admet, simulé, en un seul appel.
    parRoute({ "POST admin/accounts": () => reponse(201, { data: { account: { id: CREE, label: "mail" } } }) })
    rendre({ connectors: [MAIL, CRM, MS], ...ADMINISTRE })
    const fenetre = ouvrirLaFenetre()
    expect(cartes(fenetre)).toEqual(["Crm Pro", "mail", "Microsoft 365"])
    fireEvent.click(carte(fenetre, "mail"))
    const formulaire = within(fenetre.getByRole("form", { name: "Ajouter mail" }))
    expect(libellesDesChoix(formulaire.getByLabelText("Propriétaire"))).toEqual(["Toute l'organisation", "Équipe Finance", "Équipe Ventes"])
    choisirDansLaListe(formulaire.getByLabelText("Propriétaire"), "Équipe Finance")
    fireEvent.click(screen.getByRole("button", { name: "Ajouter le connecteur" }))
    await waitFor(() => expect(naviguer).toHaveBeenLastCalledWith(`${ICI}?connector=${CREE}`))
    expect(envois().map((envoi) => envoi.corps)).toEqual([{ connector: "mail", owner_kind: "team", team_id: FINANCE, label: "mail", mode: "simule" }])
  })

  it("should let a team lead add a connector for themselves or for the team they lead, never for the organisation nor another team", async () => {
    parRoute({ "POST admin/accounts": () => reponse(201, { data: { account: { id: CREE, label: "mail" } } }) })
    rendre({ connectors: [MAIL, CRM], proprietaires: { user: true, org: false, teams: [{ id: FINANCE, name: "Finance" }] } })
    const fenetre = ouvrirLaFenetre()
    expect(cartes(fenetre)).toEqual(["Crm Pro", "mail"])
    fireEvent.click(carte(fenetre, "Crm Pro"))
    expect(libellesDesChoix(within(fenetre.getByRole("form", { name: "Ajouter Crm Pro" })).getByLabelText("Propriétaire"))).toEqual(["Léa Bernard", "Équipe Finance"])
    fireEvent.click(fenetre.getByRole("button", { name: "Tous les outils" }))

    // « mail » ne se porte que par une équipe ou l'organisation : l'équipe qu'il dirige, seule, s'écrit sans choix.
    fireEvent.click(carte(fenetre, "mail"))
    const pourLEquipe = within(fenetre.getByRole("form", { name: "Ajouter mail" }))
    expect(pourLEquipe.queryByLabelText("Propriétaire")).toBeNull()
    expect(pourLEquipe.getByText("Propriétaire").closest(".oto-pop-row")).toHaveTextContent("Équipe Finance")
    fireEvent.click(screen.getByRole("button", { name: "Ajouter le connecteur" }))
    await waitFor(() => expect(naviguer).toHaveBeenLastCalledWith(`${ICI}?connector=${CREE}`))
    expect(envois().map((envoi) => envoi.corps)).toEqual([{ connector: "mail", owner_kind: "team", team_id: FINANCE, label: "mail", mode: "simule" }])
  })

  it("should share a key connector from its sheet: the subjects added with their level and the whole organisation, posed after its creation", async () => {
    parRoute({
      "POST admin/accounts": () => reponse(201, { data: { account: { id: CREE, label: "Crm Pro" } } }),
      [`POST admin/accounts/${CREE}/secret`]: () => reponse(200, { data: { account: { id: CREE } } }),
      "POST admin/account-rules": () => reponse(201, { data: { rule: {} } }),
    })
    rendre({ accounts: [AGENDA], formulaires: [{ ...FORMULAIRE_CRM, fields: [], probe: { available: false, balance: false } }] })
    const fenetre = ouvrirLaFenetre()
    fireEvent.click(carte(fenetre, "Crm Pro"))
    const formulaire = within(fenetre.getByRole("form", { name: "Ajouter Crm Pro" }))
    const panneau = within(formulaire.getByRole("region", { name: "Qui pourra s'en servir" }))
    // Le propriétaire en tête : la personne, jamais proposée à elle-même.
    expect(panneau.getByText("Propriétaire")).toBeInTheDocument()
    const champ = panneau.getByRole("combobox", { name: "Ajouter une personne ou une équipe" })
    fireEvent.change(champ, { target: { value: "ventes" } })
    fireEvent.click(panneau.getByRole("option", { name: "Équipe Ventes" }))
    choisirDansLaListe(panneau.getByLabelText("Accès de Équipe Ventes"), "Lire et modifier")
    choisirDansLaListe(panneau.getByLabelText("Accès de toute l'organisation"), "Lire")
    expect(envois()).toEqual([])
    fireEvent.click(screen.getByRole("button", { name: "Ajouter le connecteur" }))
    await waitFor(() => expect(naviguer).toHaveBeenLastCalledWith(`${ICI}?connector=${CREE}`))
    expect(envois().filter(({ url }) => String(url).endsWith("account-rules")).map(({ corps }) => corps)).toEqual([
      { accountId: CREE, subject: { kind: "org" }, level: "read" },
      { accountId: CREE, subject: { kind: "team", id: VENTES }, level: "write" },
    ])
  })

  it("should say the outcome of a return from the third party, never the text of the address", () => {
    const { unmount } = rendre({}, { consentement: issueDuConsentement({ consent: "connected", account: "Votre compte est suspendu, appelez le 01 23 45 67 89" }) })
    expect(screen.getByRole("status")).toHaveTextContent("Le compte est connecté.")
    expect(document.body.textContent).not.toContain("appelez")
    unmount()
    rendre({}, { consentement: issueDuConsentement({ hosted: "failed", reason: "expired" }) })
    expect(screen.getByRole("alert")).toHaveTextContent("Cette demande de connexion a expiré. Recommencez.")
    expect(issueDuConsentement({ q: "x" })).toBeUndefined()
  })
})

describe("EcranConnecteurs, several connectors of one tool", () => {
  const BANQUE_2: AccountView = { ...BANQUE, id: "6b2f3c1d-4e5a-4b6c-8d7e-9f0a1b2c3d45", label: "Banque 2" }
  const SAIN = { at: "2026-11-14T09:00:00.000Z", healthy: true, code: null, reason: null, balance: null }

  it("should keep the card of a tool the person already uses open, count hers that passed a test, and ask a name and a description only for a further one", async () => {
    const CREE = "6b2f3c1d-4e5a-4b6c-8d7e-9f0a1b2c3d61"
    fetchMock.mockImplementation(async (url, init) => {
      const route = `${init?.method} ${String(url).replace("/api/platform/", "")}`
      if (route === "POST admin/accounts") return reponse(201, { data: { account: { id: CREE, label: "Crm Pro 4" } } })
      return reponse(200, { data: { account: { id: CREE } } })
    })
    // « Agenda de Paul » ne compte pas, ni « Banque 3 », jamais testée : « Connecté » attend un test réussi à soi.
    const BANQUE_3: AccountView = { ...BANQUE, id: "6b2f3c1d-4e5a-4b6c-8d7e-9f0a1b2c3d47", label: "Banque 3" }
    rendre({ accounts: [{ ...BANQUE, lastProbe: SAIN }, { ...BANQUE_2, lastProbe: SAIN }, BANQUE_3, AGENDA], formulaires: [{ ...FORMULAIRE_CRM, probe: { available: false, balance: false } }] })
    fireEvent.click(screen.getByRole("button", { name: "Ajouter un connecteur" }))
    const fenetre = within(screen.getByRole("dialog", { name: "Ajouter un connecteur" }))
    const crm = fenetre.getByRole("button", { name: /^Crm Pro/ })
    expect(within(crm).getByRole("img", { name: "Connecté : 2 connecteurs à vous" })).toBeInTheDocument()
    fireEvent.click(crm)
    const formulaire = within(fenetre.getByRole("form", { name: "Ajouter Crm Pro" }))
    expect(formulaire.getByLabelText("Nom (facultatif)")).toHaveValue("Crm Pro 4")
    expect(formulaire.getByText("Vous en avez déjà 3 : « Banque », « Banque 2 », « Banque 3 ». C'est ce nom que vous direz à votre assistant.")).toBeInTheDocument()
    fireEvent.change(formulaire.getByLabelText("Clé d'API"), { target: { value: ["cle", "de", "test"].join("-") } })
    fireEvent.change(formulaire.getByLabelText("Description (facultatif)"), { target: { value: "Les comptes de la SCI" } })
    fireEvent.click(screen.getByRole("button", { name: "Ajouter le connecteur" }))
    await waitFor(() => expect(naviguer).toHaveBeenLastCalledWith(`${ICI}?connector=${CREE}`))
    expect(envois().map(({ url, methode, corps }) => [methode, url, methode === "POST" && String(url).endsWith("/secret") ? "…" : corps])).toEqual([
      ["POST", "/api/platform/admin/accounts", { connector: "crm", owner_kind: "user", label: "Crm Pro 4", mode: "reel" }],
      ["POST", `/api/platform/admin/accounts/${CREE}/secret`, "…"],
      ["PATCH", `/api/platform/admin/accounts/${CREE}`, { description: "Les comptes de la SCI" }],
    ])
  })

  it("should ask no description for the first connector of a tool", () => {
    rendre({ accounts: [AGENDA] })
    fireEvent.click(screen.getByRole("button", { name: "Ajouter un connecteur" }))
    const fenetre = within(screen.getByRole("dialog", { name: "Ajouter un connecteur" }))
    fireEvent.click(fenetre.getByRole("button", { name: /^Crm Pro/ }))
    expect(fenetre.queryByLabelText("Description (facultatif)")).toBeNull()
  })

  it("should say the ceiling of connectors of a tool for one person with its way out, from the refusal of the service", async () => {
    fetchMock.mockImplementation(async () => reponse(403, { error: { code: "forbidden", details: { reason: "limit", limit: "accounts_per_owner_max", max: 2 } } }))
    rendre({ accounts: [BANQUE, BANQUE_2], formulaires: [{ ...FORMULAIRE_CRM, probe: { available: false, balance: false } }] })
    fireEvent.click(screen.getByRole("button", { name: "Ajouter un connecteur" }))
    const fenetre = within(screen.getByRole("dialog", { name: "Ajouter un connecteur" }))
    fireEvent.click(fenetre.getByRole("button", { name: /^Crm Pro/ }))
    fireEvent.click(fenetre.getByRole("button", { name: "Ajouter le connecteur" }))
    expect(await fenetre.findByRole("alert")).toHaveTextContent("Vous avez déjà 2 connecteurs Crm Pro actifs, le maximum. Désactivez-en un pour en ajouter un autre, ou demandez à un administrateur.")
  })

  it("should show one line per connector in the list, each with its own state", () => {
    rendre({ accounts: [BANQUE, { ...BANQUE_2, mark: { reason: "credential_rejected", at: "2026-11-05T09:00:00.000Z" } }] })
    expect(ligneDe("Banque").getByText("Non testé")).toBeInTheDocument()
    expect(ligneDe("Banque 2").getByText("Clé refusée")).toBeInTheDocument()
  })
})

describe("EcranConnecteurs, blocking a tool for the organisation (administrator)", () => {
  const BLOQUE: OrgConnector = { ...CRM, state: "inactive", activatedAt: null, activatedBy: null, closedBy: { userId: LEA, name: "Léa Bernard" } }
  // Jamais touché : ouvert par défaut, adopté par personne.
  const JAMAIS: OrgConnector = { ...CRM, connector: "agenda", label: "Agenda", state: "active", activatedAt: null, activatedBy: null, functions: [] }
  // Payé par la clé de l'application et jamais adopté : arrêté sans auteur de fermeture.
  const A_ADOPTER: OrgConnector = { ...JAMAIS, connector: "agenda", label: "Agenda", state: "inactive", closedBy: null }
  const FORMULAIRE_AGENDA: ConnectorAccountForm = { ...FORMULAIRE_CRM, connector: "agenda", label: "Agenda" }
  const IMPACT = { functions: [], procedures: ["ventes/qualifier_prospects"], accounts: 1 }

  const ouvrirLaFenetre = () => {
    fireEvent.click(screen.getByRole("button", { name: "Ajouter un connecteur" }))
    return within(screen.getByRole("dialog", { name: "Ajouter un connecteur" }))
  }

  it("should offer a member no gesture on a tool", () => {
    rendre({ connectors: [MAIL, CRM] })
    expect(ouvrirLaFenetre().queryByRole("button", { name: /^Bloquer/ })).toBeNull()
  })

  it("should block a tool from its card after a confirmation listing what stops, its tooltip naming the effect", async () => {
    fetchMock.mockImplementation(async () => reponse(200, { data: { connector: BLOQUE } }))
    rendre({ connectors: [MAIL, CRM], ...ADMINISTRE, administration: { impacts: { crm: IMPACT } } })
    const fenetre = ouvrirLaFenetre()
    const icone = fenetre.getByRole("button", { name: "Bloquer Crm Pro pour l'organisation" })
    fireEvent.focus(icone)
    // L'infobulle entre dans la couche du dessus après le dialogue : elle paraît devant lui.
    const bulle = screen.getByRole("tooltip")
    expect(bulle).toHaveTextContent("Bloquer Crm Pro pour l'organisation")
    expect(coucheDuDessus.indexOf(bulle)).toBeGreaterThan(coucheDuDessus.indexOf(screen.getByRole("dialog", { name: "Ajouter un connecteur" })))
    fireEvent.click(icone)
    const question = within(screen.getByRole("alertdialog", { name: "Bloquer Crm Pro pour toute l'organisation ?" }))
    expect(question.getAllByRole("listitem").map((effet) => effet.textContent)).toEqual([
      "Tous les connecteurs Crm Pro de l'organisation cessent de répondre aussitôt. Ils ne sont pas supprimés.",
      "1 procédure publiée s'arrêtera à l'étape qui appelle Crm Pro.",
      "Plus personne ne pourra ajouter de connecteur Crm Pro.",
      "Vous pourrez le débloquer depuis « Ajouter un connecteur » : les connecteurs repartiront tels quels.",
    ])
    fireEvent.click(question.getByRole("button", { name: "Bloquer Crm Pro" }))
    await waitFor(() => expect(rafraichir).toHaveBeenCalledTimes(1))
    expect(envois()).toEqual([{ url: "/api/platform/admin/connectors/crm/activation", methode: "DELETE", corps: undefined }])
    expect(screen.queryByRole("alertdialog")).toBeNull()
  })

  it("should block a tool open by default like any other: its connectors stop answering", () => {
    rendre({ connectors: [CRM, JAMAIS], formulaires: [FORMULAIRE_CRM, FORMULAIRE_AGENDA], ...ADMINISTRE })
    fireEvent.click(ouvrirLaFenetre().getByRole("button", { name: "Bloquer Agenda pour l'organisation" }))
    expect(within(screen.getByRole("alertdialog")).getAllByRole("listitem").map((effet) => effet.textContent)).toEqual([
      "Tous les connecteurs Agenda de l'organisation cessent de répondre aussitôt. Ils ne sont pas supprimés.",
      "Plus personne ne pourra ajouter de connecteur Agenda.",
      "Vous pourrez le débloquer depuis « Ajouter un connecteur » : les connecteurs repartiront tels quels.",
    ])
  })

  it("should put a blocked tool at the bottom with who blocked it, unblock it without a question, and never grey the unblocking: the number of tools is not limited", async () => {
    fetchMock.mockImplementation(async () => reponse(200, { data: { connector: CRM } }))
    const { unmount } = rendre({ connectors: [MAIL, BLOQUE], ...ADMINISTRE })
    const fenetre = ouvrirLaFenetre()
    const bloques = within(fenetre.getByRole("region", { name: "Bloqués pour l'organisation" }))
    expect(bloques.getByText("Bloqué par vous.")).toBeInTheDocument()
    fireEvent.click(bloques.getByRole("button", { name: "Débloquer Crm Pro" }))
    await waitFor(() => expect(rafraichir).toHaveBeenCalledTimes(1))
    expect(envois()).toEqual([{ url: "/api/platform/admin/connectors/crm/activation", methode: "POST", corps: {} }])
    unmount()

    rendre({ connectors: [MAIL, BLOQUE], ...ADMINISTRE, administration: { impacts: {}, limites: { members: null, teams: null, connectors: { max: 1, used: 1 }, raiseUrl: "https://acme.test/billing" } } })
    const sansPlafond = within(ouvrirLaFenetre().getByRole("region", { name: "Bloqués pour l'organisation" }))
    expect(sansPlafond.getByRole("button", { name: "Débloquer Crm Pro" })).toBeEnabled()
    expect(sansPlafond.queryByRole("link", { name: "Relever la limite" })).toBeNull()
  })

  it("should say a tool paid by the application's key waits for an administrator, keep its add closed, and let the administrator adopt it", async () => {
    fetchMock.mockImplementation(async () => reponse(200, { data: { connector: JAMAIS } }))
    const { unmount } = rendre({ connectors: [CRM, A_ADOPTER], formulaires: [FORMULAIRE_CRM, FORMULAIRE_AGENDA] })
    const membre = ouvrirLaFenetre()
    const carte = membre.getByRole("button", { name: /^Agenda/ })
    expect(within(carte).getByText("À adopter par un administrateur")).toBeInTheDocument()
    fireEvent.click(carte)
    expect(membre.getByText("Agenda est payé par la clé de l'application : un administrateur l'adopte avant tout ajout.")).toBeInTheDocument()
    expect(membre.getByText("Demandez à un administrateur de l'adopter.")).toBeInTheDocument()
    // Rien à saisir avant l'adoption : ni clé, ni partage, ni « Ajouter le connecteur » ; ni « Adopter » pour un membre.
    expect(membre.queryByRole("form")).toBeNull()
    expect(screen.queryByRole("button", { name: "Ajouter le connecteur" })).toBeNull()
    expect(membre.queryByRole("button", { name: "Adopter Agenda" })).toBeNull()
    unmount()

    rendre({ connectors: [CRM, A_ADOPTER], formulaires: [FORMULAIRE_CRM, FORMULAIRE_AGENDA], ...ADMINISTRE })
    const admin = ouvrirLaFenetre()
    fireEvent.click(admin.getByRole("button", { name: /^Agenda/ }))
    fireEvent.click(admin.getByRole("button", { name: "Adopter Agenda" }))
    await waitFor(() => expect(rafraichir).toHaveBeenCalledTimes(1))
    expect(envois()).toEqual([{ url: "/api/platform/admin/connectors/agenda/activation", methode: "POST", corps: {} }])
  })

  it("should say to the owner that an administrator blocked the tool of their connector, put it last, and offer the administrator to unblock it in the detail", () => {
    const { unmount } = rendre({ connectors: [MAIL, { ...BLOQUE, closedBy: { userId: "user-claire", name: "Claire Morel" } }] })
    expect(screen.getAllByRole("row").at(-1)).toHaveTextContent(/Banque.*Bloqué par un administrateur.*Par Claire Morel\. Plus aucun assistant ne s'en sert ; rien n'est effacé\./)
    unmount()

    rendre({ connectors: [MAIL, BLOQUE], ...ADMINISTRE }, { vue: { compte: BANQUE.id } })
    const arreter = within(detailDe(BANQUE).getByRole("heading", { name: "Arrêter" }).closest("section") ?? document.body)
    expect(arreter.getByRole("button", { name: "Débloquer Crm Pro" })).toBeInTheDocument()
    expect(detailDe(BANQUE).queryByRole("button", { name: /^Tester/ })).toBeNull()
  })

  it("should offer an administrator to block the tool from the « Arrêter » zone of a detail, with the same confirmation", () => {
    rendre({ connectors: [MAIL, CRM], ...ADMINISTRE, administration: { impacts: { crm: IMPACT } } }, { vue: { compte: BANQUE.id } })
    const arreter = within(detailDe(BANQUE).getByRole("heading", { name: "Arrêter" }).closest("section") ?? document.body)
    expect(arreter.getByRole("button", { name: "Désactiver Banque" })).toBeInTheDocument()
    fireEvent.click(arreter.getByRole("button", { name: "Bloquer… Crm Pro pour l'organisation" }))
    expect(screen.getByRole("alertdialog", { name: "Bloquer Crm Pro pour toute l'organisation ?" })).toBeInTheDocument()
  })
})

describe("EcranConnecteurs, a connector received in share", () => {
  it("should tell who receives a personal connector to name it, through whose key it acts, the groups its level opens and what to ask for more", () => {
    rendre({ accounts: [{ ...BANQUE, owner: A_PAUL, viewerLevel: "read" }], partages: {} }, { vue: { compte: BANQUE.id } })
    const detail = detailDe(BANQUE)
    expect(detail.getByText("Nommez « Banque » quand vous demandez quelque chose à votre assistant : un connecteur partagé ne sert que nommé.")).toBeInTheDocument()
    expect(detail.getByText("Ce que votre assistant y fait passe par la clé de Paul Durand, qui reste cachée.")).toBeInTheDocument()
    expect(groupesDe(BANQUE)).toEqual(["Lire. 2 fonctions, afficher la liste"])
    expect(detail.getByText("Niveau « Lire ». Pour créer ou modifier, demandez « Lire et modifier » à Paul Durand.")).toBeInTheDocument()
  })
})

describe("EcranConnecteurs, a connector switched off", () => {
  it("should not tell who receives a blocked or disabled connector how to use it, nor what level to ask for", () => {
    const recu: AccountView = { ...BANQUE, owner: A_PAUL, viewerLevel: "read" }
    for (const donnees of [{ accounts: [{ ...recu, status: "disabled" as const }] }, { accounts: [recu], connectors: [MAIL, { ...CRM, state: "inactive" as const, closedBy: { userId: PAUL, name: "Paul Durand" } }] }]) {
      const { unmount } = rendre({ ...donnees, partages: {} }, { vue: { compte: BANQUE.id } })
      expect(detailDe(BANQUE).queryByRole("heading", { name: "Comment vous en servir" })).toBeNull()
      expect(detailDe(BANQUE).queryByText(/^Niveau « Lire »/)).toBeNull()
      unmount()
    }
  })

  it("should name who blocked a tool to a member, never « vous »", () => {
    rendre({ connectors: [MAIL, { ...CRM, state: "inactive", closedBy: { userId: LEA, name: "Léa Bernard" } }, { ...CRM, connector: "microsoft", label: "Microsoft 365" }] })
    fireEvent.click(screen.getByRole("button", { name: "Ajouter un connecteur" }))
    expect(screen.getByRole("region", { name: "Bloqués pour l'organisation" })).toHaveTextContent("Bloqué par Léa Bernard.")
  })
})

describe("EcranConnecteurs, sharing a connector connected at the third party, from its sheet", () => {
  const MS: OrgConnector = { ...CRM, connector: "microsoft", label: "Microsoft 365" }
  const CLE = "oto-connecteurs:partage-au-retour"
  const AVANT = "6b2f3c1d-4e5a-4b6c-8d7e-9f0a1b2c3d47"
  // Le connecteur Microsoft que Léa avait déjà au départ, son jeton renouvelé depuis : il ne reçoit jamais le partage.
  const ANCIEN: AccountView = { ...AGENDA, id: AVANT, label: "Ancien agenda", owner: A_LEA, viewerLevel: "manage", secret: { fields: [], updatedAt: new Date(Date.now() + 5000).toISOString() } }
  const NOUVEAU: AccountView = { ...AGENDA, id: "6b2f3c1d-4e5a-4b6c-8d7e-9f0a1b2c3d48", label: "lea@contoso.test", owner: A_LEA, viewerLevel: "manage" }
  // Plus récents, mais à une autre personne, ou d'un autre outil : jamais retenus.
  const DE_PAUL: AccountView = { ...AGENDA, id: "6b2f3c1d-4e5a-4b6c-8d7e-9f0a1b2c3d49", secret: { fields: [], updatedAt: new Date(Date.now() + 5000).toISOString() } }
  const AUTRE_OUTIL: AccountView = { ...BANQUE, id: "6b2f3c1d-4e5a-4b6c-8d7e-9f0a1b2c3d50", label: "Crm récent" }
  const garde = () =>
    window.sessionStorage.setItem(
      CLE,
      JSON.stringify({ connecteur: "microsoft", outil: "Microsoft 365", at: Date.now(), avant: [AVANT], partage: { general: null, regles: [{ sujet: { kind: "team", id: VENTES, nom: "Ventes" }, niveau: "read" }] } }),
    )

  afterEach(() => window.sessionStorage.clear())

  it("should ask the first-share agreement before leaving, keep the share with the connectors already hers, and forget it when leaving fails", async () => {
    const assign = vi.fn()
    vi.stubGlobal("location", { ...window.location, assign })
    fetchMock.mockResolvedValueOnce(reponse(200, { data: { url: "https://login.example.test/authorize?state=s" } }))
    const partir = () => {
      rendre({ accounts: [ANCIEN], connectors: [MAIL, CRM, MS] })
      fireEvent.click(screen.getByRole("button", { name: "Ajouter un connecteur" }))
      const fenetre = within(screen.getByRole("dialog", { name: "Ajouter un connecteur" }))
      fireEvent.click(fenetre.getByRole("button", { name: /^Microsoft 365/ }))
      const panneau = within(fenetre.getByRole("region", { name: "Qui pourra s'en servir" }))
      fireEvent.change(panneau.getByRole("combobox", { name: "Ajouter une personne ou une équipe" }), { target: { value: "ventes" } })
      fireEvent.click(panneau.getByRole("option", { name: "Équipe Ventes" }))
      fireEvent.click(screen.getByRole("button", { name: "Connecter mon compte Microsoft 365" }))
      fireEvent.click(within(screen.getByRole("alertdialog", { name: "Partager « Microsoft 365 » avec Équipe Ventes ?" })).getByRole("button", { name: "Partager quand même" }))
    }
    partir()
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://login.example.test/authorize?state=s"))
    const lu = JSON.parse(window.sessionStorage.getItem(CLE) ?? "null")
    expect([lu.connecteur, lu.outil, lu.avant, lu.partage]).toEqual(["microsoft", "Microsoft 365", [AVANT], { general: null, regles: [{ sujet: { kind: "team", id: VENTES, nom: "Ventes" }, niveau: "read" }] }])

    // Le départ refusé par la porte : le partage gardé s'oublie.
    cleanup()
    fetchMock.mockResolvedValueOnce(reponse(400, { error: { code: "invalid_arguments" } }))
    partir()
    await waitFor(() => expect(window.sessionStorage.getItem(CLE)).toBeNull())
  })

  it("should pose the kept share on the only connector of that tool that was not hers when leaving, never on a renewed, another person's or another tool's one", async () => {
    fetchMock.mockImplementation(async () => reponse(201, { data: { rule: {} } }))
    garde()
    rendre({ accounts: [ANCIEN, DE_PAUL, AUTRE_OUTIL, NOUVEAU], connectors: [MAIL, CRM, MS] }, { consentement: { issue: "connected" } })
    expect(await screen.findByText("Partagé comme vous l'aviez choisi.")).toBeInTheDocument()
    expect(envois()).toEqual([{ url: "/api/platform/admin/account-rules", methode: "POST", corps: { accountId: NOUVEAU.id, subject: { kind: "team", id: VENTES }, level: "read" } }])
    expect(window.sessionStorage.getItem(CLE)).toBeNull()
  })

  it("should pose nothing without a single new connector of the tool, and lead to the person's connectors to share it", async () => {
    garde()
    rendre({ accounts: [ANCIEN, DE_PAUL, AUTRE_OUTIL], connectors: [MAIL, CRM, MS] }, { consentement: { issue: "connected" } })
    expect(await screen.findByText("Le partage choisi avant la connexion n'a pas pu être posé. Ouvrez votre connecteur Microsoft 365 et partagez-le.")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Vos connecteurs" })).toHaveAttribute("href", `${ICI}?filter=mine`)
    expect(envois()).toEqual([])
    cleanup()
    // Le détail ouvert sur son partage (`?share=1`).
    rendre({ accounts: [NOUVEAU], connectors: [MAIL, CRM, MS], partages: { [NOUVEAU.id]: { general: null, rules: [] } } }, { vue: { compte: NOUVEAU.id, partager: true } })
    expect(screen.getByRole("dialog", { name: "Partager « lea@contoso.test »" })).toBeInTheDocument()
  })

  it("should forget the kept share on a failed return, so that a later return poses nothing", async () => {
    garde()
    const { unmount } = rendre({ accounts: [ANCIEN], connectors: [MAIL, CRM, MS] }, { consentement: { issue: "failed", raison: "expired" } })
    await waitFor(() => expect(window.sessionStorage.getItem(CLE)).toBeNull())
    unmount()
    rendre({ accounts: [ANCIEN, NOUVEAU], connectors: [MAIL, CRM, MS] }, { consentement: { issue: "connected" } })
    expect(screen.queryByText(/Partagé comme vous/)).toBeNull()
    expect(envois()).toEqual([])
  })
})

describe("EcranConnecteurs, the first share of a connector connected by authorisation", () => {
  const MON_AGENDA: AccountView = { ...AGENDA, id: "6b2f3c1d-4e5a-4b6c-8d7e-9f0a1b2c3d46", label: "Mon agenda", owner: A_LEA, viewerLevel: "manage" }
  const MS: OrgConnector = { ...CRM, connector: "microsoft", label: "Microsoft 365" }

  it("should ask once what sharing an account connected by its owner commits to, send nothing on cancel, and share on agreement", async () => {
    fetchMock.mockImplementation(async () => reponse(200, { data: { rule: {} } }))
    rendre({ accounts: [MON_AGENDA], connectors: [MAIL, CRM, MS], partages: { [MON_AGENDA.id]: { general: null, rules: [] } } }, { vue: { compte: MON_AGENDA.id } })
    fireEvent.click(detailDe(MON_AGENDA).getByRole("button", { name: "Partager Mon agenda" }))
    const panneau = within(screen.getByRole("dialog", { name: "Partager « Mon agenda »" }))
    const ajouter = () => {
      const champ = panneau.getByRole("combobox", { name: "Ajouter une personne ou une équipe" })
      fireEvent.change(champ, { target: { value: "ventes" } })
      fireEvent.click(panneau.getByRole("option", { name: "Équipe Ventes" }))
    }
    ajouter()
    const question = () => within(screen.getByRole("alertdialog", { name: "Partager « Mon agenda » avec Équipe Ventes ?" }))
    expect(question().getByText("Équipe Ventes y agira par votre compte, en votre nom : ce que son assistant y lit ou y fait passe par lui.")).toBeInTheDocument()
    fireEvent.click(question().getByRole("button", { name: "Annuler" }))
    expect(screen.queryByRole("alertdialog")).toBeNull()
    expect(envois()).toEqual([])

    ajouter()
    fireEvent.click(question().getByRole("button", { name: "Partager quand même" }))
    await waitFor(() => expect(rafraichir).toHaveBeenCalledTimes(1))
    expect(envois()).toEqual([{ url: "/api/platform/admin/account-rules", methode: "POST", corps: { accountId: MON_AGENDA.id, subject: { kind: "team", id: VENTES }, level: "read" } }])
  })

  it("should not ask again once the connector is shared, nor for a connector with a key", () => {
    fetchMock.mockImplementation(async () => reponse(200, { data: { rule: {} } }))
    rendre({ connectors: [MAIL, CRM] }, { vue: { compte: BANQUE.id } })
    fireEvent.click(detailDe(BANQUE).getByRole("button", { name: "Partager Banque" }))
    const panneau = within(screen.getByRole("dialog", { name: "Partager « Banque »" }))
    fireEvent.change(panneau.getByRole("combobox", { name: "Ajouter une personne ou une équipe" }), { target: { value: "ventes" } })
    fireEvent.click(panneau.getByRole("option", { name: "Équipe Ventes" }))
    expect(screen.queryByRole("alertdialog")).toBeNull()
  })
})
