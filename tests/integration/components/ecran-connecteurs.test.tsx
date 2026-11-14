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
    for (const geste of [/^Partager/, /^Gérer les accès/, /la clé/, /^Désactiver/, /^Journal des partages/]) expect(detail.queryByRole("button", { name: geste })).toBeNull()
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

  it("should disable the account after the question, which keeps the warning that it does not come back", async () => {
    fetchMock.mockResolvedValue(reponse(200, { data: { account: { id: BANQUE.id } } }))
    rendre({}, { vue: { compte: BANQUE.id } })
    const detail = detailDe(BANQUE)
    fireEvent.click(detail.getByRole("button", { name: "Désactiver Banque" }))
    const question = "Désactiver « Banque » ? Aucun assistant ne pourra plus s'en servir, dès maintenant. Un connecteur désactivé ne se réactive pas : il faudra en ajouter un autre."
    fireEvent.click(within(detail.getByRole("group", { name: question })).getByRole("button", { name: "Désactiver" }))
    await waitFor(() => expect(rafraichir).toHaveBeenCalledTimes(1))
    expect(envois()).toEqual([{ url: `/api/platform/admin/accounts/${BANQUE.id}/disable`, methode: "POST", corps: {} }])
    // La relecture emporte le bouton : le focus l'attend au titre de l'état, qui reste.
    expect(detail.getByRole("heading", { name: "État" })).toHaveFocus()
  })

  it("should say a disabled account without any gesture on it", () => {
    rendre({ accounts: [{ ...BANQUE, status: "disabled" }] }, { vue: { compte: BANQUE.id } })
    expect(ligneDe("Banque").getByText("Désactivé")).toBeInTheDocument()
    const detail = detailDe(BANQUE)
    for (const geste of [/la clé/, /^Désactiver/]) expect(detail.queryByRole("button", { name: geste })).toBeNull()
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
  it("should let a member connect their own account from the window, and offer them no creation by hand", async () => {
    const assign = vi.fn()
    vi.stubGlobal("location", { ...window.location, assign })
    fetchMock.mockResolvedValue(reponse(200, { data: { url: "https://login.example.test/authorize?state=s" } }))
    rendre()
    fireEvent.click(screen.getByRole("button", { name: "Ajouter un connecteur" }))
    const fenetre = within(screen.getByRole("dialog", { name: "Ajouter un connecteur" }))
    expect(fenetre.queryByRole("form")).toBeNull()
    fireEvent.click(fenetre.getByRole("button", { name: "Connecter mon compte Microsoft 365" }))
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://login.example.test/authorize?state=s"))
    expect(envois()).toEqual([{ url: "/api/platform/connector-consent", methode: "POST", corps: { connector: "microsoft", return_to: ICI } }])
  })

  it("should say so to a member who can add nothing by themselves", () => {
    rendre({ formulaires: [FORMULAIRE_CRM] })
    fireEvent.click(screen.getByRole("button", { name: "Ajouter un connecteur" }))
    expect(screen.getByText("Aucun outil ne se connecte par vous-même pour l'instant. Un administrateur peut ajouter un connecteur et le partager avec vous.")).toBeInTheDocument()
  })

  it("should let an administrator create an account for a team, never of a connector each person connects themselves", async () => {
    fetchMock.mockResolvedValue(reponse(201, { data: { account: { id: "6b2f3c1d-4e5a-4b6c-8d7e-9f0a1b2c3d60", label: "Mail Finance" } } }))
    const MS: OrgConnector = { ...MAIL, connector: "microsoft", functions: [] }
    rendre({ connectors: [MAIL, CRM, MS], administration: { impacts: {} } })
    fireEvent.click(screen.getByRole("button", { name: "Ajouter un connecteur" }))
    const formulaire = within(screen.getByRole("form", { name: "Créer un compte" }))
    expect(libellesDesChoix(formulaire.getByLabelText("Connecteur"))).toEqual(["mail", "crm"])
    fireEvent.change(formulaire.getByLabelText("Libellé"), { target: { value: "Mail Finance" } })
    fireEvent.click(formulaire.getByLabelText("Une équipe"))
    choisirDansLaListe(formulaire.getByLabelText("Équipe"), "Finance")
    fireEvent.click(formulaire.getByRole("button", { name: "Créer le compte" }))
    await waitFor(() => expect(rafraichir).toHaveBeenCalledTimes(1))
    expect(envois()).toEqual([{ url: "/api/platform/admin/accounts", methode: "POST", corps: { connector: "mail", owner_kind: "team", team_id: FINANCE, label: "Mail Finance", mode: "simule" } }])
    // La fenêtre se ferme et le détail du compte créé s'ouvre par son adresse.
    expect(naviguer).toHaveBeenLastCalledWith(`${ICI}?connector=6b2f3c1d-4e5a-4b6c-8d7e-9f0a1b2c3d60`)
    expect(screen.queryByRole("dialog", { name: "Ajouter un connecteur" })).toBeNull()
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
  const INACTIF: OrgConnector = { ...MAIL, state: "inactive", activatedAt: null, activatedBy: null }

  it("should list each connector with its functions and its state, and activate one without a question", async () => {
    fetchMock.mockResolvedValue(reponse(200, { data: { connector: MAIL } }))
    rendre({ connectors: [INACTIF, CRM], administration: { impacts: {} } })
    const ilot = within(screen.getByRole("region", { name: "Outils de l'organisation" }))
    expect(ilot.getByText("2 connecteurs activables")).toBeInTheDocument()
    expect(ilot.getByText("2 fonctions : mail.create_draft, mail.send_draft")).toBeInTheDocument()
    expect(ilot.getByText("Actif depuis le 24 septembre 2026")).toBeInTheDocument()
    fireEvent.click(ilot.getByRole("button", { name: "Activer mail" }))
    await waitFor(() => expect(rafraichir).toHaveBeenCalledTimes(1))
    expect(envois()).toEqual([{ url: "/api/platform/admin/connectors/mail/activation", methode: "POST", corps: {} }])
    expect(screen.getByRole("heading", { level: 2, name: "Outils de l'organisation" })).toHaveFocus()
  })

  it("should ask before deactivating, naming the procedures and the accounts it touches", async () => {
    fetchMock.mockResolvedValue(reponse(200, { data: { connector: INACTIF } }))
    rendre({ connectors: [MAIL], administration: { impacts: { mail: { functions: ["mail.create_draft", "mail.send_draft"], procedures: ["ventes/qualifier_prospects"], accounts: 1 } } } })
    fireEvent.click(screen.getByRole("button", { name: "Désactiver mail" }))
    const question =
      "Désactiver « mail » ? Ses fonctions cesseront aussitôt de répondre, pour tout le monde. 1 procédure publiée le cite dans ses blocs d'appel : ventes/qualifier_prospects. Son compte est conservé."
    fireEvent.click(within(screen.getByRole("group", { name: question })).getByRole("button", { name: "Désactiver" }))
    await waitFor(() => expect(rafraichir).toHaveBeenCalledTimes(1))
    expect(envois()).toEqual([{ url: "/api/platform/admin/connectors/mail/activation", methode: "DELETE", corps: undefined }])
  })

  it("should grey the activation of an inactive connector at connectors_max, with the raise link", () => {
    rendre({ connectors: [INACTIF], administration: { impacts: {}, limites: { members: null, teams: null, connectors: { max: 0, used: 0 }, raiseUrl: "https://acme.test/billing?from=pkg" } } })
    expect(screen.getByRole("button", { name: "Activer" })).toBeDisabled()
    expect(screen.getByText(/Limite atteinte : 0 connecteur actif sur 0\./)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Relever la limite" })).toHaveAttribute("href", "https://acme.test/billing?from=pkg&capacity=connectors_max")
  })
})
