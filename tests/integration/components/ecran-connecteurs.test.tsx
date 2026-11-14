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
import { simulerLesDialogues } from "../../helpers/dialogue"
import { choisirDansLaListe, libellesDesChoix } from "../../helpers/liste-de-choix"

// L'écran « Connecteurs » : une seule liste pour un administrateur et pour un membre, le détail d'un connecteur dans un
// tiroir ouvert par l'adresse, son partage dans le panneau des pages, « Ajouter un connecteur », et pour un
// administrateur « Outils de l'organisation ». `fetch` simulé pour l'API, relecture et navigation fournies par des
// contextes de test.

const ICI = "/admin/connectors"
const LEA = "0b6f1f0e-1c1a-4a8e-9a51-0d7c1a2b3c01"
const PAUL = "0b6f1f0e-1c1a-4a8e-9a51-0d7c1a2b3c02"
const VENTES = "0e8e5a3c-7f10-4a5b-8d3b-2b1c4d5e6f70"
const FINANCE = "0e8e5a3c-7f10-4a5b-8d3b-2b1c4d5e6f71"

const MAIL: OrgConnector = {
  connector: "mail",
  label: "mail",
  closedBy: null,
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
}

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
    expect(agenda.getByText("Lecture seule")).toBeInTheDocument()

    const ventes = ligneDe("Mail Ventes")
    expect(ventes.getByText("mail", { selector: ".oto-caption" })).toBeInTheDocument()
    expect(ventes.getByText("Équipe Ventes")).toBeInTheDocument()
    expect(ventes.getByText("Lecture et écriture")).toBeInTheDocument()

    expect(screen.getByText("Un connecteur est privé tant que vous ne le partagez pas.")).toBeInTheDocument()
    // Ni l'îlot de l'administrateur, ni les mots du moteur.
    expect(screen.queryByRole("region", { name: "Outils de l'organisation" })).toBeNull()
    expect(screen.queryByText(/secret|activ/i)).toBeNull()
  })

  it("should say « Privé » for an own account nobody shares, and open the detail of a line by its address, the view kept", () => {
    rendre({ partages: {} }, { vue: { filtre: "mine" } })
    expect(ligneDe("Banque").getByText("Privé")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Banque" })).toHaveAttribute("href", `${ICI}?filter=mine&connector=${BANQUE.id}`)
  })

  it("should count each filter on its pill and write the chosen one in the address; the search shows only above eight lines and keeps the filter", () => {
    const { unmount } = rendre()
    const filtres = within(screen.getByRole("radiogroup", { name: "Filtrer les connecteurs" }))
    expect(filtres.getAllByRole("radio").map((filtre) => filtre.textContent)).toEqual(["Tous · 3", "À moi · 1", "Partagés avec moi · 2"])
    fireEvent.click(filtres.getByRole("radio", { name: "À moi · 1" }))
    expect(naviguer).toHaveBeenCalledWith(`${ICI}?filter=mine`)
    expect(screen.queryByRole("searchbox")).toBeNull()
    unmount()

    const neuf = Array.from({ length: 9 }, (_, rang) => ({ ...MAIL_VENTES, id: `6b2f3c1d-4e5a-4b6c-8d7e-9f0a1b2c3d5${rang}`, label: `Mail ${rang}` }))
    rendre({ accounts: neuf }, { vue: { filtre: "shared" } })
    const champ = screen.getByRole("searchbox", { name: "Rechercher un connecteur" })
    fireEvent.change(champ, { target: { value: "mail 3" } })
    fireEvent.submit(champ)
    expect(naviguer).toHaveBeenLastCalledWith(`${ICI}?filter=shared&q=mail+3`)
  })

  it("should say a search without answer, and keep the field to clear it", () => {
    rendre({}, { vue: { q: "introuvable" } })
    expect(screen.getByText("Aucun connecteur ne correspond à « introuvable ».")).toBeInTheDocument()
    expect(screen.getByRole("searchbox", { name: "Rechercher un connecteur" })).toHaveValue("introuvable")
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

  it("should say an empty page and offer to add a connector, once", () => {
    rendre({ accounts: [] })
    expect(screen.getByText("Aucun connecteur pour l'instant")).toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: "Ajouter un connecteur" })).toHaveLength(1)
    expect(screen.queryByRole("table")).toBeNull()
  })

  it("should say a failed read in an alert, with a way to retry, and render a busy status while loading", () => {
    const { unmount } = rendre({ error: "Une erreur est survenue. Réessayez." })
    expect(screen.getByRole("alert")).toHaveTextContent("Une erreur est survenue. Réessayez.")
    expect(screen.getByRole("link", { name: "Réessayer" })).toHaveAttribute("href", ICI)
    expect(screen.queryByRole("button", { name: "Ajouter un connecteur" })).toBeNull()
    unmount()
    render(<EcranConnecteursChargement />)
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true")
  })
})

describe("EcranConnecteurs, the detail of a connector", () => {
  it("should open the account of the address in a drawer: its state, who has access, what the assistant may do and its connection; the close button and Escape lead back to the list", () => {
    rendre({}, { vue: { filtre: "mine", compte: BANQUE.id } })
    const detail = detailDe(BANQUE)
    expect(detail.getByText("Non testé")).toBeInTheDocument()
    expect(detail.getAllByRole("listitem").slice(0, 3).map((ligne) => ligne.textContent)).toEqual([
      expect.stringMatching(/Léa Bernard.*vous.*Propriétaire$/),
      expect.stringMatching(/Équipe Finance.*Lecture seule$/),
      expect.stringMatching(/Paul Durand.*Lecture et écriture$/),
    ])
    expect(detail.getByText("actions de lecture").previousElementSibling).toHaveTextContent("2")
    expect(detail.getByText("action d'écriture").previousElementSibling).toHaveTextContent("1")
    expect(detail.getByText("action sensible").previousElementSibling).toHaveTextContent("1")
    expect(detail.getByText("crm.delete")).toBeInTheDocument()
    expect(detail.getByText("Clé posée le 2 novembre 2026. Jamais réaffichée, jamais transmise à l'assistant.")).toBeInTheDocument()

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
    expect(detail.getByText("Votre accès : Toutes les actions. Géré par Paul Durand.")).toBeInTheDocument()
    for (const geste of [/^Partager/, /^Gérer les accès/, /la clé/, /^Désactiver/, /^Journal des partages/, /^Tester/, /^Modifier le nom/]) expect(detail.queryByRole("button", { name: geste })).toBeNull()
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
    expect(detail.getByRole("heading", { name: "État" })).toHaveFocus()
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
    expect(detail.getByRole("heading", { name: "État" })).toHaveFocus()

    fetchMock.mockImplementation(async () => reponse(403, { error: { code: "not_enabled", details: { reason: "closed", administrators: [{ userId: "u", name: "Claire Morel" }] } } }))
    fireEvent.click(detail.getByRole("button", { name: "Réactiver Banque" }))
    expect(await detail.findByText("Cet outil a été fermé par un administrateur. Un administrateur peut le rouvrir.")).toBeInTheDocument()
  })

  it("should test a connector for who manages it, say a failed test and too many tests, and offer no test under that level", async () => {
    fetchMock.mockImplementation(async () => reponse(200, { data: { probe: { at: "2026-11-14T09:00:00.000Z", healthy: false, reason: "Crm refused the key. (key_rejected)", balance: null } } }))
    const { unmount } = rendre({}, { vue: { compte: BANQUE.id } })
    const detail = detailDe(BANQUE)
    fireEvent.click(detail.getByRole("button", { name: "Tester Banque" }))
    expect(await detail.findByText("Le test a échoué.")).toBeInTheDocument()
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
    const teste = { ...BANQUE, lastProbe: { at: "2026-11-14T09:00:00.000Z", healthy: false, reason: "Crm is unreachable.", balance: null } }
    const { unmount } = rendre({ accounts: [teste] }, { vue: { compte: BANQUE.id } })
    expect(ligneDe("Banque").getByText("Test en échec")).toBeInTheDocument()
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
      expect.stringMatching(/^18 octobre 2026 à \d\d:12 · Léa Bernard a retiré le partage à Paul Durand \(Lecture seule\)$/),
      expect.stringMatching(/^17 octobre 2026 à \d\d:00 · Une personne qui n'est plus membre a partagé à l'équipe Support \(Lecture et écriture, avant : Lecture seule\)$/),
      expect.stringMatching(/^16 octobre 2026 à \d\d:00 · Hors session a partagé à toute l'organisation \(Toutes les actions\)$/),
    ])
    expect(envois()).toEqual([{ url: `/api/platform/admin/accounts/${BANQUE.id}/share-journal`, methode: "GET", corps: undefined }])
  })
})

describe("EcranConnecteurs, sharing a connector", () => {
  const ouvrir = (libelle: RegExp = /^Partager Banque$/) => {
    fireEvent.click(detailDe(BANQUE).getByRole("button", { name: libelle }))
    return within(screen.getByRole("dialog", { name: "Partager « Banque »" }))
  }

  it("should open the panel from « Partager » and from « Gérer les accès », with the shares read and what the engine does of a personal account", () => {
    rendre({}, { vue: { compte: BANQUE.id } })
    const panneau = ouvrir(/^Gérer les accès de Banque$/)
    expect(within(panneau.getByRole("list", { name: "Personnes et équipes ajoutées" })).getAllByRole("listitem").map((ligne) => ligne.textContent)).toEqual([
      expect.stringContaining("Équipe Finance"),
      expect.stringContaining("Paul Durand"),
    ])
    expect(libellesDesChoix(panneau.getByLabelText("Accès de Paul Durand"))).toEqual(["Toutes les actions", "Lecture et écriture", "Lecture seule", "Retirer l'accès"])
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
    expect(panneau.getByRole("status")).toHaveTextContent("Équipe Ventes : lecture seule.")
  })

  it("should change the level of a line, never offering the management, and remove an access without a further question", async () => {
    // Une réponse neuve par appel : le corps d'une `Response` ne se lit qu'une fois.
    fetchMock.mockImplementation(async () => reponse(200, { data: {} }))
    rendre({}, { vue: { compte: BANQUE.id } })
    const panneau = ouvrir()
    choisirDansLaListe(panneau.getByLabelText("Accès de Équipe Finance"), /^Toutes les actions/)
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
    expect(libellesDesChoix(panneau.getByLabelText("Accès de toute l'organisation"))).toEqual(["Toutes les actions", "Lecture et écriture", "Lecture seule", "Aucun accès"])
    choisirDansLaListe(panneau.getByLabelText("Accès de toute l'organisation"), /^Lecture seule/)
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
    expect(libellesDesChoix(panneau.getByLabelText("Accès de Léa Bernard"))).toEqual(["Gestion", "Toutes les actions", "Lecture et écriture", "Lecture seule", "Retirer l'accès"])
    choisirDansLaListe(panneau.getByLabelText("Accès de Léa Bernard"), /^Lecture seule/)
    await waitFor(() => expect(rafraichir).toHaveBeenCalledTimes(1))

    // La relecture : elle ne gère plus le compte, ni panneau ni « Partager ».
    rerender(ecran({ accounts: [{ ...dePaul, viewerLevel: "read" }], partages: {} }, { vue: { compte: BANQUE.id } }))
    expect(screen.queryByRole("dialog", { name: "Partager « Banque »" })).toBeNull()
    await waitFor(() => expect(detailDe(BANQUE).getByRole("heading", { name: "État" })).toHaveFocus())
  })

  it("should say a refusal of the service and keep the level served", async () => {
    fetchMock.mockResolvedValue(reponse(403, { error: { code: "forbidden", message: "server text" } }))
    rendre({}, { vue: { compte: BANQUE.id } })
    const panneau = ouvrir()
    choisirDansLaListe(panneau.getByLabelText("Accès de Paul Durand"), /^Lecture seule/)
    expect(await panneau.findByRole("alert")).toHaveTextContent("Seule une personne qui gère ce connecteur peut le partager.")
    expect(panneau.getByLabelText("Accès de Paul Durand")).toHaveTextContent("Lecture et écriture")
    expect(rafraichir).not.toHaveBeenCalled()
  })
})

describe("EcranConnecteurs, adding a connector", () => {
  const MS: OrgConnector = { ...CRM, connector: "microsoft", label: "Microsoft 365", functions: [] }
  const CREE = "6b2f3c1d-4e5a-4b6c-8d7e-9f0a1b2c3d60"
  // Une clé de test composée à l'exécution : aucun faux secret en littéral.
  const CLE = ["cle", "de", "test"].join("-")
  const SAINE = { healthy: true, reason: null, balance: null }

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

  /** Le texte d'une carte sans son avatar, caché aux lecteurs d'écran. */
  const nomDe = (carte: HTMLElement) => {
    const copie = carte.cloneNode(true)
    if (!(copie instanceof HTMLElement)) return null
    copie.querySelectorAll('[aria-hidden="true"]').forEach((cache) => cache.remove())
    return copie.textContent
  }

  /** Les noms des cartes du catalogue, dans l'ordre. */
  const cartes = (fenetre: ReturnType<typeof within>) => within(fenetre.getByRole("list")).getAllByRole("button").map(nomDe)

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

  it("should say so to a member who can add nothing, and say a tool closed by an administrator without offering it", () => {
    const { unmount } = rendre({ connectors: [MAIL] })
    expect(ouvrirLaFenetre().getByText("Aucun outil à ajouter pour l'instant. Un administrateur peut ajouter un connecteur et le partager avec vous.")).toBeInTheDocument()
    unmount()
    rendre({ connectors: [{ ...CRM, state: "inactive", closedBy: { userId: "user-claire", name: "Claire Morel" } }] })
    const fenetre = ouvrirLaFenetre()
    expect(fenetre.getByText("Fermé par un administrateur")).toBeInTheDocument()
    expect(fenetre.queryByRole("button", { name: "Crm Pro" })).toBeNull()
  })

  it("should let a member add a key connector: the key tested once complete, then the account, its key, its description and its test, the key never shown again", async () => {
    parRoute({
      "POST admin/connectors/crm/probe": () => reponse(200, { data: { probe: SAINE } }),
      "POST admin/accounts": () => reponse(201, { data: { account: { id: CREE, label: "Crm Pro" } } }),
      [`POST admin/accounts/${CREE}/secret`]: () => reponse(200, { data: { account: { id: CREE } } }),
      [`PATCH admin/accounts/${CREE}`]: () => reponse(200, { data: { account: { id: CREE } } }),
      [`POST admin/accounts/${CREE}/probe`]: () => reponse(200, { data: { probe: { ...SAINE, at: "2026-11-14T09:00:00.000Z" } } }),
    })
    rendre()
    const fenetre = ouvrirLaFenetre()
    fireEvent.click(fenetre.getByRole("button", { name: "Crm Pro" }))
    const formulaire = within(fenetre.getByRole("form", { name: "Ajouter Crm Pro" }))
    // Un membre n'a pas le choix du propriétaire : le connecteur est à lui, et le nom proposé est libre.
    expect(formulaire.queryByRole("group", { name: "Pour qui" })).toBeNull()
    expect(formulaire.getByLabelText("Nom")).toHaveValue("Crm Pro")
    const cle = formulaire.getByLabelText("Clé d'API")
    // Sans clé, la sortie d'un champ ne teste rien.
    fireEvent.blur(cle)
    expect(envois()).toEqual([])
    // Une frappe ne teste rien : la clé part à la sortie du champ.
    fireEvent.change(cle, { target: { value: CLE } })
    expect(envois()).toEqual([])
    fireEvent.change(formulaire.getByLabelText("Description (facultatif)"), { target: { value: "Le suivi des clients" } })
    // « Ajouter » aussitôt sorti du champ, le test encore en cours : la même clé ne part pas deux fois.
    fireEvent.blur(cle)
    fireEvent.click(formulaire.getByRole("button", { name: "Ajouter" }))
    await waitFor(() => expect(naviguer).toHaveBeenLastCalledWith(`${ICI}?connector=${CREE}`))
    expect(envois()).toEqual([
      { url: "/api/platform/admin/connectors/crm/probe", methode: "POST", corps: { fields: { api_key: CLE }, settings: { region: "us" } } },
      { url: "/api/platform/admin/accounts", methode: "POST", corps: { connector: "crm", owner_kind: "user", label: "Crm Pro", mode: "reel" } },
      { url: `/api/platform/admin/accounts/${CREE}/secret`, methode: "POST", corps: { secret: { api_key: CLE }, settings: { region: "us" } } },
      { url: `/api/platform/admin/accounts/${CREE}`, methode: "PATCH", corps: { description: "Le suivi des clients" } },
      { url: `/api/platform/admin/accounts/${CREE}/probe`, methode: "POST", corps: {} },
    ])
    expect(rafraichir).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole("dialog", { name: "Ajouter un connecteur" })).toBeNull()
    expect(screen.queryByDisplayValue(CLE)).toBeNull()
  })

  it("should ask « Ajouter quand même ? » after a failed test, create only from that question and only for the key that failed, and say a name already taken, the entry kept", async () => {
    const creation = vi.fn(() => reponse(409, { error: { code: "conflict", details: { reason: "label_taken" } } }))
    const sonde = vi.fn(() => reponse(200, { data: { probe: { healthy: false, reason: "Crm refused the key. (key_rejected)", balance: null } } }))
    parRoute({ "POST admin/connectors/crm/probe": sonde, "POST admin/accounts": creation })
    rendre()
    const fenetre = ouvrirLaFenetre()
    fireEvent.click(fenetre.getByRole("button", { name: "Crm Pro" }))
    const formulaire = within(fenetre.getByRole("form", { name: "Ajouter Crm Pro" }))
    fireEvent.change(formulaire.getByLabelText("Clé d'API"), { target: { value: CLE } })
    // « Ajouter » sans être sorti du champ : la clé se teste d'abord, et son échec pose la question au lieu de créer.
    fireEvent.click(formulaire.getByRole("button", { name: "Ajouter" }))
    const question = within(await formulaire.findByRole("group", { name: "Ajouter quand même ?" }))
    expect(formulaire.getByText("Crm refused the key. (key_rejected)")).toBeInTheDocument()
    // « Ajouter » de nouveau, un double clic par exemple : toujours rien de créé, et la même clé ne se reteste pas.
    fireEvent.click(formulaire.getByRole("button", { name: "Ajouter" }))
    await waitFor(() => expect(formulaire.getByRole("button", { name: "Ajouter" })).toBeEnabled())
    expect([sonde.mock.calls.length, creation.mock.calls.length]).toEqual([1, 0])
    // Une autre clé, saisie sans sortir du champ : « Ajouter quand même » la teste, et ne crée rien sur son échec.
    fireEvent.change(formulaire.getByLabelText("Clé d'API"), { target: { value: `${CLE}-2` } })
    fireEvent.click(question.getByRole("button", { name: "Ajouter quand même" }))
    await waitFor(() => expect(sonde).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(formulaire.getByRole("button", { name: "Ajouter" })).toBeEnabled())
    expect(creation).not.toHaveBeenCalled()
    fireEvent.click(within(formulaire.getByRole("group", { name: "Ajouter quand même ?" })).getByRole("button", { name: "Ajouter quand même" }))
    expect(await formulaire.findByText("Un connecteur du même propriétaire porte déjà ce nom.")).toBeInTheDocument()
    expect([sonde.mock.calls.length, creation.mock.calls.length]).toEqual([2, 1])
    expect(formulaire.getByLabelText("Clé d'API")).toHaveValue(`${CLE}-2`)
    expect(naviguer).not.toHaveBeenCalled()
  })

  it("should say what is left to finish when a step fails after the account is created, with its reason, then open the detail", async () => {
    parRoute({
      "POST admin/connectors/crm/probe": () => reponse(200, { data: { probe: SAINE } }),
      "POST admin/accounts": () => reponse(201, { data: { account: { id: CREE, label: "Crm Pro" } } }),
      [`POST admin/accounts/${CREE}/secret`]: () => reponse(400, { error: { code: "invalid_arguments" } }),
      [`PATCH admin/accounts/${CREE}`]: () => reponse(200, { data: { account: { id: CREE } } }),
    })
    rendre()
    const fenetre = ouvrirLaFenetre()
    fireEvent.click(fenetre.getByRole("button", { name: "Crm Pro" }))
    const formulaire = within(fenetre.getByRole("form", { name: "Ajouter Crm Pro" }))
    fireEvent.change(formulaire.getByLabelText("Clé d'API"), { target: { value: CLE } })
    fireEvent.change(formulaire.getByLabelText("Description (facultatif)"), { target: { value: "Le suivi des clients" } })
    fireEvent.click(formulaire.getByRole("button", { name: "Ajouter" }))
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
    fireEvent.click(fenetre.getByRole("button", { name: "Crm Pro" }))
    const formulaire = within(fenetre.getByRole("form", { name: "Ajouter Crm Pro" }))
    expect(formulaire.getByText("Pas de test automatique pour cet outil : essayez-le dans votre assistant.")).toBeInTheDocument()
    fireEvent.change(formulaire.getByLabelText("Clé d'API"), { target: { value: CLE } })
    fireEvent.blur(formulaire.getByLabelText("Clé d'API"))
    fireEvent.click(formulaire.getByRole("button", { name: "Ajouter" }))
    await waitFor(() => expect(naviguer).toHaveBeenCalledTimes(1))
    expect(envois().map((envoi) => envoi.url)).toEqual(["/api/platform/admin/accounts", `/api/platform/admin/accounts/${CREE}/secret`])
  })

  it("should let an administrator add a connector for a team, of a tool without a form too, and never propose themselves for it", async () => {
    // « mail » n'a pas de formulaire : l'écran le crée réel, et le service répond qu'il est simulé.
    const creation = vi.fn<() => Response>()
    creation.mockReturnValueOnce(reponse(400, { error: { code: "unavailable_in_v1" } })).mockReturnValueOnce(reponse(201, { data: { account: { id: CREE, label: "mail" } } }))
    parRoute({ "POST admin/accounts": creation })
    rendre({ connectors: [MAIL, CRM, MS], administration: { impacts: {} } })
    const fenetre = ouvrirLaFenetre()
    expect(cartes(fenetre)).toEqual(["Crm Pro", "mail", "Microsoft 365"])
    fireEvent.click(fenetre.getByRole("button", { name: "mail" }))
    const formulaire = within(fenetre.getByRole("form", { name: "Ajouter mail" }))
    const pourQui = within(formulaire.getByRole("group", { name: "Pour qui" }))
    expect(pourQui.getAllByRole("radio").map((choix) => choix.getAttribute("value"))).toEqual(["org", "team"])
    fireEvent.click(pourQui.getByLabelText("Une équipe"))
    choisirDansLaListe(formulaire.getByLabelText("Équipe"), "Finance")
    fireEvent.click(formulaire.getByRole("button", { name: "Ajouter" }))
    await waitFor(() => expect(naviguer).toHaveBeenLastCalledWith(`${ICI}?connector=${CREE}`))
    expect(envois().map((envoi) => envoi.corps)).toEqual([
      { connector: "mail", owner_kind: "team", team_id: FINANCE, label: "mail", mode: "reel" },
      { connector: "mail", owner_kind: "team", team_id: FINANCE, label: "mail", mode: "simule" },
    ])
  })

  it("should say the outcome of a return from the third party", () => {
    const { unmount } = rendre({}, { consentement: issueDuConsentement({ consent: "connected", account: "lea@contoso.test (microsoft)" }) })
    expect(screen.getByRole("status")).toHaveTextContent("« lea@contoso.test (microsoft) » est connecté.")
    unmount()
    rendre({}, { consentement: issueDuConsentement({ hosted: "failed", reason: "expired" }) })
    expect(screen.getByRole("alert")).toHaveTextContent("Cette demande de connexion a expiré. Recommencez.")
    expect(issueDuConsentement({ q: "x" })).toBeUndefined()
  })
})

describe("EcranConnecteurs, the tools of the organisation (administrator)", () => {
  const FERME: OrgConnector = { ...MAIL, state: "inactive", activatedAt: null, activatedBy: null, closedBy: { userId: "user-claire", name: "Claire Morel" } }
  const JAMAIS: OrgConnector = { ...MAIL, connector: "agenda", label: "Agenda", state: "inactive", activatedAt: null, activatedBy: null, functions: [] }

  it("should say each tool open, closed and by whom, or never used, and open a closed one again without a question", async () => {
    fetchMock.mockResolvedValue(reponse(200, { data: { connector: MAIL } }))
    rendre({ connectors: [FERME, CRM, JAMAIS], administration: { impacts: {} } })
    const ilot = within(screen.getByRole("region", { name: "Outils de l'organisation" }))
    expect(ilot.getByText("3 outils")).toBeInTheDocument()
    expect(ilot.getByText("2 fonctions : mail.create_draft, mail.send_draft")).toBeInTheDocument()
    expect(ilot.getByText("Ouvert depuis le 24 septembre 2026")).toBeInTheDocument()
    expect(ilot.getByText("Fermé par Claire Morel")).toBeInTheDocument()
    // Un outil jamais utilisé s'ouvre au premier ajout : aucun geste.
    expect(ilot.getByText("S'ouvre au premier ajout")).toBeInTheDocument()
    expect(ilot.getAllByRole("button").map((bouton) => bouton.getAttribute("aria-label") ?? bouton.textContent)).toEqual(["Rouvrir mail", "Fermer Crm Pro"])
    fireEvent.click(ilot.getByRole("button", { name: "Rouvrir mail" }))
    await waitFor(() => expect(rafraichir).toHaveBeenCalledTimes(1))
    expect(envois()).toEqual([{ url: "/api/platform/admin/connectors/mail/activation", methode: "POST", corps: {} }])
    expect(screen.getByRole("heading", { level: 2, name: "Outils de l'organisation" })).toHaveFocus()
  })

  it("should ask before closing a tool, naming the procedures and the connectors it touches", async () => {
    fetchMock.mockResolvedValue(reponse(200, { data: { connector: FERME } }))
    rendre({ connectors: [MAIL], administration: { impacts: { mail: { functions: ["mail.create_draft", "mail.send_draft"], procedures: ["ventes/qualifier_prospects"], accounts: 1 } } } })
    fireEvent.click(screen.getByRole("button", { name: "Fermer mail" }))
    const question =
      "Fermer « mail » ? Ses fonctions cesseront aussitôt de répondre, pour tout le monde, et plus personne ne pourra l'ajouter. 1 procédure publiée le cite dans ses blocs d'appel : ventes/qualifier_prospects. Son connecteur est conservé."
    fireEvent.click(within(screen.getByRole("group", { name: question })).getByRole("button", { name: "Fermer" }))
    await waitFor(() => expect(rafraichir).toHaveBeenCalledTimes(1))
    expect(envois()).toEqual([{ url: "/api/platform/admin/connectors/mail/activation", methode: "DELETE", corps: undefined }])
  })

  it("should grey the reopening of a closed tool at connectors_max, with the raise link", () => {
    rendre({ connectors: [FERME], administration: { impacts: {}, limites: { members: null, teams: null, connectors: { max: 0, used: 0 }, raiseUrl: "https://acme.test/billing?from=pkg" } } })
    expect(screen.getByRole("button", { name: "Rouvrir" })).toBeDisabled()
    expect(screen.getByText(/Limite atteinte : 0 connecteur actif sur 0\./)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Relever la limite" })).toHaveAttribute("href", "https://acme.test/billing?from=pkg&capacity=connectors_max")
  })
})
