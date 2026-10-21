import type { AnchorHTMLAttributes, ReactNode } from "react"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { MemberView, NodeRulesView, TeamView } from "@otomata_tech/oto_platform/schemas"
import { AccesPlateforme, ContexteDeLHote, ContexteDeRafraichissement, CoquilleOto, EcranEquipes, type EcranEquipesProps } from "@otomata_tech/oto_platform/ui"
import { coucheDuDessus, simulerLesDialogues } from "../../helpers/dialogue"
import { choisirDansLaListe } from "../../helpers/liste-de-choix"

// Les gestes de l'écran « Équipes et droits », portés sur les menus et les dialogues d'oto-frontend
// (E05-S09 partie d1, AC-x2 ; E05-S03 : AC6 à AC9, AC11 à AC14, AC18 ; le focus rendu quand un geste emporte
// son déclencheur, AC20) : `fetch` simulé pour l'API, relecture fournie par un contexte de test et jouée
// par `rerender`.

const ADA = "0b6f1f0e-1c1a-4a8e-9a51-0d7c1a2b3c01"
const CLAIRE = "0b6f1f0e-1c1a-4a8e-9a51-0d7c1a2b3c02"
const VENTES = "0e8e5a3c-7f10-4a5b-8d3b-2b1c4d5e6f70"
const SUPPORT = "5b0d1c56-0f3a-4a57-9d8e-6f1f1b9e2c11"
const INVITATION = "9d1c7e2a-3b4c-4d5e-8f6a-7b8c9d0e1f2a"

const MEMBRES: MemberView[] = [
  { userId: ADA, email: "ada@demo.test", name: "Ada Martin", role: "admin", teams: [], lastSignInAt: null, isSelf: true },
  {
    userId: CLAIRE,
    email: "claire@demo.test",
    name: "Claire Morel",
    role: "member",
    teams: [
      { id: SUPPORT, name: "Support", role: "member" },
      { id: VENTES, name: "Ventes", role: "lead" },
    ],
    lastSignInAt: null,
    isSelf: false,
  },
]

const EQUIPES: TeamView[] = [
  { id: SUPPORT, slug: "support", name: "Support", leadName: null, members: [{ userId: CLAIRE, name: "Claire Morel", email: "claire@demo.test", role: "member" }] },
  { id: VENTES, slug: "ventes", name: "Ventes", leadName: "Claire Morel", members: [{ userId: CLAIRE, name: "Claire Morel", email: "claire@demo.test", role: "lead" }] },
]

const EN_ATTENTE = { id: INVITATION, email: "new@demo.test", role: "member" as const, teamId: null, invitedBy: ADA, expiresAt: "2026-10-01T10:00:00Z" }

const fetchMock = vi.fn<typeof fetch>()
const rafraichir = vi.fn()
const naviguer = vi.fn()

function reponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

function refus(status: number, code: string, reason?: string): Response {
  return reponse(status, { error: { code, message: "server text", ...(reason ? { details: { reason } } : {}) } })
}

function Lien({ href, children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children?: ReactNode }) {
  return (
    <a href={href} {...props}>
      {children}
    </a>
  )
}

/** L'écran tel que la page le sert ; `rerender(ecran(…))` joue la relecture qui suit un geste. */
function ecran(props: Partial<EcranEquipesProps> = {}) {
  return (
    <CoquilleOto pleinePage>
      <ContexteDeRafraichissement.Provider value={rafraichir}>
        <ContexteDeLHote.Provider value={{ Lien, chemin: "/teams", naviguer }}>
          <EcranEquipes
            onglet="members"
            nomOrganisation="Démo"
            moi={{ userId: ADA, estAdmin: true, equipesDirigees: [] }}
            membres={{ data: MEMBRES }}
            invitations={{ data: [EN_ATTENTE] }}
            optionsDInvitation={{ data: null }}
            equipes={{ data: EQUIPES }}
            Lien={Lien}
            hrefDOnglet={(onglet) => `/teams?tab=${onglet}`}
            prefixeDesPages="/n/"
            {...props}
          />
        </ContexteDeLHote.Provider>
      </ContexteDeRafraichissement.Provider>
    </CoquilleOto>
  )
}

function rendre(props: Partial<EcranEquipesProps> = {}) {
  return render(ecran(props))
}

/** Les membres que sert la lecture du dossier de l'équipe (`GET rules?path=`), par cas ; aucun par défaut. */
const dossier: { people: NonNullable<NodeRulesView["people"]> } = { people: [] }

/** Le récapitulatif de la suppression d'une équipe (`GET teams/<slug>/deletion`, 1.4.13), servi à part des gestes comptés. */
const RECAPITULATIF_VIDE = { team: { id: VENTES, slug: "ventes", name: "Ventes" }, blockedBy: null, members: [{ name: "Claire Morel", email: "claire@demo.test" }], rules: 2, trashed: 0 }
const recapitulatif: { vue: Record<string, unknown> } = { vue: RECAPITULATIF_VIDE }

const envoi = (rang = 0) => {
  const [url, init] = fetchMock.mock.calls[rang]
  return { url, methode: init?.method, corps: init?.body === undefined ? undefined : JSON.parse(String(init.body)) }
}

/** Ouvre le menu d'un déclencheur, puis choisit sa ligne de ce rôle et de ce nom. */
function choisir(declencheur: string, role: "menuitem" | "menuitemradio" | "menuitemcheckbox", ligne: string) {
  fireEvent.click(screen.getByRole("button", { name: declencheur }))
  fireEvent.click(within(screen.getByRole("menu")).getByRole(role, { name: ligne }))
}

const dialogue = (nom: string) => within(screen.getByRole("dialog", { name: nom }))

beforeAll(simulerLesDialogues)

beforeEach(() => {
  fetchMock.mockReset()
  rafraichir.mockReset()
  naviguer.mockReset()
  dossier.people = []
  recapitulatif.vue = RECAPITULATIF_VIDE
  // La lecture des niveaux du dossier d'une équipe (1.4.12), à l'ouverture de « Les personnes de … », et celle du
  // récapitulatif d'une suppression (1.4.13) répondent à part : les gestes de ce fichier se comptent sur `fetchMock` seul.
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) =>
    String(url).startsWith("/api/platform/rules?")
      ? Promise.resolve(reponse(200, { data: { path: "ventes", title: "Ventes", owner: { kind: "team" }, viewerLevel: 3, rules: [], people: dossier.people } }))
      : String(url).endsWith("/deletion")
        ? Promise.resolve(reponse(200, { data: recapitulatif.vue }))
        : fetchMock(url, init),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("member gestures (AC6 to AC9)", () => {
  it("should send only the chosen role, and say under the menu that the last administrator stays", async () => {
    fetchMock.mockResolvedValue(refus(409, "conflict", "last_admin"))
    rendre()

    choisir("Gérer Ada Martin", "menuitemradio", "Membre")

    expect(await screen.findByRole("alert")).toHaveTextContent("C'est le dernier administrateur de Démo : nommez-en un autre avant.")
    expect(envoi()).toEqual({ url: `/api/platform/members/${ADA}`, methode: "PATCH", corps: { role: "member" } })
    expect(rafraichir).not.toHaveBeenCalled()
  })

  it("should send nothing when the choice is the served one", () => {
    rendre()
    choisir("Gérer Claire Morel", "menuitemradio", "Membre")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("should check the served role, no default team, and follow a state changed elsewhere once the page is re-read (AC7 ; E05-S13, AC-26)", () => {
    const vue = rendre()
    fireEvent.click(screen.getByRole("button", { name: "Gérer Claire Morel" }))
    const servi = within(screen.getByRole("menu"))
    expect(servi.getByRole("menuitemradio", { name: "Membre" })).toHaveAttribute("aria-checked", "true")
    expect(servi.queryByRole("menuitemradio", { name: "Ventes" })).toBeNull()
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" })

    const [ada, claire] = MEMBRES
    vue.rerender(ecran({ membres: { data: [ada, { ...claire, role: "admin" }] } }))
    fireEvent.click(screen.getByRole("button", { name: "Gérer Claire Morel" }))
    const relu = within(screen.getByRole("menu"))
    expect(relu.getByRole("menuitemradio", { name: "Administrateur" })).toHaveAttribute("aria-checked", "true")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("should add a person to a team and remove her from another through « Ses équipes », a refusal said under its trigger (AC13)", async () => {
    fetchMock.mockResolvedValueOnce(reponse(200, { data: { membership: {} } }))
    rendre()

    choisir("Régler les équipes de Ada Martin", "menuitemcheckbox", "Ventes")
    await waitFor(() => expect(rafraichir).toHaveBeenCalledTimes(1))
    expect(envoi()).toEqual({ url: `/api/platform/teams/${VENTES}/members`, methode: "POST", corps: { userId: ADA } })

    fetchMock.mockResolvedValueOnce(refus(403, "forbidden"))
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" })
    choisir("Régler les équipes de Claire Morel", "menuitemcheckbox", "Ventes")
    expect(await screen.findByRole("alert")).toHaveTextContent("Vous n'avez pas le droit de faire cela.")
    expect(envoi(1)).toMatchObject({ url: `/api/platform/teams/${VENTES}/members/${CLAIRE}`, methode: "DELETE" })
  })

  it("should ask before removing someone, and say what falls with them", () => {
    rendre()
    choisir("Gérer Claire Morel", "menuitem", "Retirer de Démo")
    expect(dialogue("Retirer Claire Morel de Démo ?").getByText("Ses équipes et ses partages nominatifs tombent ; ses pages personnelles restent, invisibles de tous.")).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("should ask the administrator removing themselves whether they want to lose the access, then send DELETE members", async () => {
    fetchMock.mockResolvedValue(reponse(200, { data: { member: { userId: ADA } } }))
    rendre()

    choisir("Gérer Ada Martin", "menuitem", "Retirer de Démo")
    const question = dialogue("Vous retirer de Démo ?")
    expect(question.getByText("Vous perdrez l'accès à Démo.")).toBeInTheDocument()
    fireEvent.click(question.getByRole("button", { name: "Retirer de Démo" }))

    await waitFor(() => expect(rafraichir).toHaveBeenCalledTimes(1))
    expect(envoi()).toMatchObject({ url: `/api/platform/members/${ADA}`, methode: "DELETE" })
  })

  it("should say in a second dialog that the last administrator of the organisation stays (AC9)", async () => {
    fetchMock.mockResolvedValue(refus(409, "conflict", "last_admin"))
    rendre()

    choisir("Gérer Ada Martin", "menuitem", "Retirer de Démo")
    fireEvent.click(dialogue("Vous retirer de Démo ?").getByRole("button", { name: "Retirer de Démo" }))

    const echec = await screen.findByRole("dialog", { name: "Retirer Ada Martin de Démo" })
    expect(within(echec).getByRole("alert")).toHaveTextContent("C'est le dernier administrateur de Démo : nommez-en un autre avant.")
    expect(rafraichir).not.toHaveBeenCalled()
  })

  it("should cancel an invitation after the confirmation, say it is no longer pending when it was accepted meanwhile, then re-read (AC6)", async () => {
    fetchMock.mockResolvedValue(refus(404, "not_found"))
    rendre()

    choisir("Gérer new@demo.test", "menuitem", "Annuler l'invitation")
    fireEvent.click(dialogue("Annuler l'invitation de new@demo.test ?").getByRole("button", { name: "Annuler l'invitation" }))

    const echec = within(await screen.findByRole("dialog", { name: "Annuler l'invitation de new@demo.test" }))
    expect(echec.getByRole("alert")).toHaveTextContent("Cette invitation n'est plus en attente : elle a été acceptée ou annulée.")
    expect(envoi()).toMatchObject({ url: `/api/platform/invitations/${INVITATION}`, methode: "DELETE" })
    // Le bouton du pied ; celui de l'en-tête (la croix) porte le même nom.
    fireEvent.click(echec.getAllByRole("button", { name: "Fermer" }).at(-1) ?? document.body)
    expect(rafraichir).toHaveBeenCalledTimes(1)
  })
})

describe("team gestures (AC11 to AC14)", () => {
  function ouvrirLaCreation() {
    rendre({ onglet: "teams" })
    fireEvent.click(screen.getByRole("button", { name: "Créer une équipe" }))
    return dialogue("Créer une équipe")
  }

  it("should refuse an empty name or 61 characters under the field, before any request", async () => {
    const creation = ouvrirLaCreation()
    const champ = creation.getByLabelText("Nom de la nouvelle équipe")

    fireEvent.click(creation.getByRole("button", { name: "Créer l'équipe" }))
    expect(await creation.findByText("Le nom compte de 1 à 60 caractères.")).toBeInTheDocument()
    fireEvent.change(champ, { target: { value: "x".repeat(61) } })
    fireEvent.click(creation.getByRole("button", { name: "Créer l'équipe" }))

    await waitFor(() => expect(champ).toHaveAttribute("aria-invalid", "true"))
    expect(champ).toHaveAccessibleDescription("Le nom compte de 1 à 60 caractères.")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    [() => refus(409, "conflict", "name_taken"), "Une équipe de Démo porte déjà ce nom."],
    [() => refus(400, "invalid_arguments", "reserved_slug"), "Ce nom est réservé : choisissez-en un autre."],
    [() => refus(409, "conflict", "path_taken"), "Une page porte déjà ce nom : choisissez-en un autre pour l'équipe."],
    [() => refus(409, "conflict", "slug_taken"), "Une autre équipe de Démo utilise déjà le chemin de ce nom : choisissez-en un autre."],
  ])("should say a refused name under the field (%#)", async (refusServeur, message) => {
    fetchMock.mockResolvedValue(refusServeur())
    const creation = ouvrirLaCreation()

    fireEvent.change(creation.getByLabelText("Nom de la nouvelle équipe"), { target: { value: "Conseil" } })
    fireEvent.click(creation.getByRole("button", { name: "Créer l'équipe" }))

    const erreur = await creation.findByText(message)
    expect(creation.getByLabelText("Nom de la nouvelle équipe")).toHaveAttribute("aria-describedby", erreur.id)
    expect(envoi()).toEqual({ url: "/api/platform/teams", methode: "POST", corps: { name: "Conseil" } })
  })

  it("should create a team, close the dialog and have the page re-read", async () => {
    fetchMock.mockResolvedValue(reponse(201, { data: { team: { id: SUPPORT, slug: "conseil", name: "Conseil" } } }))
    const creation = ouvrirLaCreation()

    fireEvent.change(creation.getByLabelText("Nom de la nouvelle équipe"), { target: { value: "  Conseil " } })
    fireEvent.click(creation.getByRole("button", { name: "Créer l'équipe" }))

    await waitFor(() => expect(rafraichir).toHaveBeenCalledTimes(1))
    expect(envoi().corps).toEqual({ name: "Conseil" })
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Créer une équipe" })).toBeNull())
  })

  it("should rename a team, sending its name only, and keep a refused name to correct it, without re-reading (AC12)", async () => {
    fetchMock.mockResolvedValue(refus(409, "conflict", "name_taken"))
    rendre({ onglet: "teams" })

    choisir("Gérer Ventes", "menuitem", "Renommer…")
    const renommage = dialogue("Renommer Ventes")
    expect(renommage.getByLabelText("Nom de l'équipe")).toHaveValue("Ventes")
    fireEvent.change(renommage.getByLabelText("Nom de l'équipe"), { target: { value: "Support" } })
    fireEvent.click(renommage.getByRole("button", { name: "Enregistrer" }))

    expect(await renommage.findByText("Une équipe de Démo porte déjà ce nom.")).toBeInTheDocument()
    expect(envoi()).toEqual({ url: `/api/platform/teams/${VENTES}`, methode: "PATCH", corps: { name: "Support" } })
    expect(renommage.getByLabelText("Nom de l'équipe")).toHaveValue("Support")
    expect(rafraichir).not.toHaveBeenCalled()
  })

  it("should show a team renamed elsewhere once the page is re-read, and send nothing the admin did not change (AC12)", async () => {
    const vue = rendre({ onglet: "teams" })
    choisir("Gérer Ventes", "menuitem", "Renommer…")
    expect(dialogue("Renommer Ventes").getByLabelText("Nom de l'équipe")).toHaveValue("Ventes")

    const [support, ventes] = EQUIPES
    vue.rerender(ecran({ onglet: "teams", equipes: { data: [support, { ...ventes, name: "Ventes Europe" }] } }))
    const renommage = dialogue("Renommer Ventes Europe")
    expect(renommage.getByLabelText("Nom de l'équipe")).toHaveValue("Ventes Europe")
    fireEvent.click(renommage.getByRole("button", { name: "Enregistrer" }))

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Renommer Ventes Europe" })).toBeNull())
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // E05-S13 (AC-24) : une équipe a zéro, un ou plusieurs responsables ; l'administrateur les nomme un à un.
  it("should name a member lead and remove a lead from the leads, from the people of a team, then re-read (AC-24)", async () => {
    fetchMock.mockResolvedValueOnce(reponse(200, { data: { membership: {} } })).mockResolvedValueOnce(reponse(200, { data: { membership: {} } }))
    rendre({ onglet: "teams" })

    fireEvent.click(screen.getByRole("button", { name: "Voir les personnes de Ventes" }))
    fireEvent.click(dialogue("Les personnes de Ventes").getByRole("button", { name: "Retirer des responsables : Claire Morel" }))
    await waitFor(() => expect(rafraichir).toHaveBeenCalledTimes(1))
    expect(envoi()).toEqual({ url: `/api/platform/teams/${VENTES}/members/${CLAIRE}`, methode: "PATCH", corps: { role: "member" } })
    fireEvent.click(dialogue("Les personnes de Ventes").getAllByRole("button", { name: "Fermer" }).at(-1) ?? document.body)

    fireEvent.click(screen.getByRole("button", { name: "Voir les personnes de Support" }))
    // 1.4.13 : ce que change le rôle se lit au focus du geste même.
    const nommer = dialogue("Les personnes de Support").getByRole("button", { name: "Nommer responsable : Claire Morel" })
    fireEvent.focus(nommer)
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Un responsable a l'accès complet aux pages de l'équipe")
    expect(nommer).toHaveAttribute("aria-describedby", screen.getByRole("tooltip").id)
    // Devant le dialogue modal : dans la couche du dessus, après lui ; un `z-index` ne passe jamais devant un `<dialog>`.
    expect(screen.getByRole("tooltip")).toHaveAttribute("popover", "manual")
    expect(coucheDuDessus.at(-1)).toBe(screen.getByRole("tooltip"))
    expect(coucheDuDessus).toContain(nommer.closest("dialog"))
    fireEvent.click(nommer)
    await waitFor(() => expect(rafraichir).toHaveBeenCalledTimes(2))
    expect(envoi(1)).toEqual({ url: `/api/platform/teams/${SUPPORT}/members/${CLAIRE}`, methode: "PATCH", corps: { role: "lead" } })
  })

  it("should let a lead who is not an administrator remove members, never name nor remove a lead (HN-E05S13-20)", () => {
    const ada = { userId: ADA, name: "Ada Martin", email: "ada@demo.test", role: "member" as const }
    const ventes = { ...EQUIPES[1], members: [...EQUIPES[1].members, ada] }
    rendre({ onglet: "teams", moi: { userId: CLAIRE, estAdmin: false, equipesDirigees: [VENTES] }, equipes: { data: [EQUIPES[0], ventes] } })

    fireEvent.click(screen.getByRole("button", { name: "Voir les personnes de Ventes" }))
    const personnes = dialogue("Les personnes de Ventes")
    expect(personnes.getByRole("button", { name: "Retirer Ada Martin de cette équipe" })).toBeInTheDocument()
    expect(personnes.queryByRole("button", { name: "Retirer Claire Morel de cette équipe" })).toBeNull()
    expect(personnes.queryByRole("button", { name: /responsable/ })).toBeNull()
  })

  // 1.4.12 : le niveau de chaque membre sur les pages de l'équipe, réglé sur sa ligne.
  it("should show the level of each member on the pages of the team, and set it on its line", async () => {
    dossier.people = [{ userId: CLAIRE, name: "Claire Morel", lead: true, level: "manage", inherited: "manage", ruleId: null }]
    fetchMock.mockResolvedValueOnce(reponse(201, { data: { rule: {} } }))
    rendre({ onglet: "teams" })

    fireEvent.click(screen.getByRole("button", { name: "Voir les personnes de Ventes" }))
    const personnes = dialogue("Les personnes de Ventes")
    const niveau = await personnes.findByRole("combobox", { name: "Accès de Claire Morel" })
    expect(niveau).toHaveValue("manage")
    choisirDansLaListe(niveau, "Peut lire")
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(envoi()).toEqual({ url: "/api/platform/rules", methode: "POST", corps: { path: "ventes", subject: { kind: "user", id: CLAIRE }, level: "read" } })
  })

  it("should add a person to the team and remove one, a lead included (AC13, AC-22)", async () => {
    fetchMock.mockResolvedValueOnce(reponse(200, { data: { membership: {} } }))
    rendre({ onglet: "teams" })

    fireEvent.click(screen.getByRole("button", { name: "Voir les personnes de Ventes" }))
    const personnes = dialogue("Les personnes de Ventes")
    fireEvent.click(personnes.getByRole("button", { name: "Ajouter Ada Martin à cette équipe" }))
    await waitFor(() => expect(rafraichir).toHaveBeenCalledTimes(1))
    expect(envoi()).toEqual({ url: `/api/platform/teams/${VENTES}/members`, methode: "POST", corps: { userId: ADA } })

    fetchMock.mockResolvedValueOnce(reponse(200, { data: { membership: {} } }))
    fireEvent.click(personnes.getByRole("button", { name: "Retirer Claire Morel de cette équipe" }))
    // M36 (fiche D94 B) : rien ne part avant la confirmation.
    const question = dialogue("Retirer Claire Morel de l'équipe Ventes ?")
    expect(fetchMock).toHaveBeenCalledTimes(1)
    fireEvent.click(question.getByRole("button", { name: "Retirer de l'équipe" }))
    await waitFor(() => expect(rafraichir).toHaveBeenCalledTimes(2))
    expect(envoi(1)).toMatchObject({ url: `/api/platform/teams/${VENTES}/members/${CLAIRE}`, methode: "DELETE" })
    expect(screen.queryByRole("dialog", { name: "Retirer Claire Morel de l'équipe Ventes ?" })).toBeNull()
  })

  it("should send nothing when the removal from a team is cancelled, and give the focus back to its trigger (M36)", async () => {
    rendre({ onglet: "teams" })

    fireEvent.click(screen.getByRole("button", { name: "Voir les personnes de Ventes" }))
    const retirer = dialogue("Les personnes de Ventes").getByRole("button", { name: "Retirer Claire Morel de cette équipe" })
    retirer.focus()
    fireEvent.click(retirer)
    const annuler = dialogue("Retirer Claire Morel de l'équipe Ventes ?").getByRole("button", { name: "Annuler" })
    // Au clavier, Annuler a le focus quand il est pressé : le démontage l'emporte avec le dialogue.
    annuler.focus()
    fireEvent.click(annuler)

    expect(screen.queryByRole("dialog", { name: "Retirer Claire Morel de l'équipe Ventes ?" })).toBeNull()
    await waitFor(() => expect(retirer).toHaveFocus())
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // 1.4.13 : trois blocs, ce qui part (pages de la corbeille comprises), ce qui bloque avec ses liens, puis le geste.
  it("should say what goes with the team, list what blocks it with links, and keep the gesture off while something blocks", async () => {
    recapitulatif.vue = { ...RECAPITULATIF_VIDE, trashed: 3, blockedBy: { nodes: [{ path: "ventes/devis" }], accounts: [{ label: "Mail Ventes" }] } }
    rendre({ onglet: "teams" })

    choisir("Gérer Ventes", "menuitem", "Supprimer l'équipe")
    const suppression = dialogue("Supprimer Ventes")
    const part = within(await suppression.findByRole("region", { name: "Ce qui part" }))
    expect(part.getAllByRole("listitem").map((ligne) => ligne.textContent)).toEqual([
      "1 personne quitte l'équipe.",
      "2 règles d'accès qui la nomment tombent.",
      "Son Contexte est supprimé.",
      "3 pages de la corbeille sont effacées définitivement.",
    ])
    const bloque = within(suppression.getByRole("region", { name: "Ce qui bloque" }))
    expect(bloque.getByRole("link", { name: "ventes/devis" })).toHaveAttribute("href", "/n/ventes/devis")
    expect(bloque.getByText("le compte de connecteur « Mail Ventes »")).toBeInTheDocument()
    const geste = suppression.getByRole("button", { name: "Supprimer l'équipe" })
    expect(geste).toBeDisabled()
    fireEvent.click(geste)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("should say what the team still owns, by name, and keep the page as it is (AC14)", async () => {
    const details = { reason: "team_owns_objects", nodes: ["ventes/devis", "ventes/suivi_prospects"], accounts: ["Mail Ventes"], nodesTotal: 2, accountsTotal: 1 }
    fetchMock.mockResolvedValue(reponse(409, { error: { code: "conflict", message: "server text", details } }))
    rendre({ onglet: "teams" })

    choisir("Gérer Ventes", "menuitem", "Supprimer l'équipe")
    const suppression = dialogue("Supprimer Ventes")
    // Une page rangée entre la lecture du récapitulatif et le geste : le refus du service se dit dans le dialogue.
    await waitFor(() => expect(suppression.getByRole("button", { name: "Supprimer l'équipe" })).toBeEnabled())
    fireEvent.click(suppression.getByRole("button", { name: "Supprimer l'équipe" }))

    expect((await suppression.findByRole("alert")).textContent).toBe(
      "Ventes possède encore : ventes/devis, ventes/suivi_prospects (nœuds) ; Mail Ventes (compte). Transférez-les ou supprimez-les avant de supprimer l'équipe.",
    )
    expect(envoi()).toMatchObject({ url: `/api/platform/teams/${VENTES}`, methode: "DELETE" })
    expect(rafraichir).not.toHaveBeenCalled()
  })
})

describe("focus after a gesture that takes its trigger away (AC20, accessibility-patterns § Focus Management)", () => {
  const sansClaire = { membres: { data: [MEMBRES[0]] } }

  it("should give the focus to the people table, out of the tab order, once a removed member leaves with the re-read", async () => {
    fetchMock.mockResolvedValue(reponse(200, { data: {} }))
    const vue = rendre()

    choisir("Gérer Claire Morel", "menuitem", "Retirer de Démo")
    fireEvent.click(dialogue("Retirer Claire Morel de Démo ?").getByRole("button", { name: "Retirer de Démo" }))
    await waitFor(() => expect(rafraichir).toHaveBeenCalledTimes(1))
    vue.rerender(ecran(sansClaire))

    const conteneur = document.getElementById("equipes-personnes")
    await waitFor(() => expect(conteneur).toHaveFocus())
    expect(conteneur).toHaveAttribute("tabindex", "-1")
  })

  it("should give the focus to the people table once a cancelled invitation leaves", async () => {
    fetchMock.mockResolvedValue(reponse(200, { data: {} }))
    const vue = rendre()

    choisir("Gérer new@demo.test", "menuitem", "Annuler l'invitation")
    fireEvent.click(dialogue("Annuler l'invitation de new@demo.test ?").getByRole("button", { name: "Annuler l'invitation" }))
    await waitFor(() => expect(rafraichir).toHaveBeenCalledTimes(1))
    vue.rerender(ecran({ invitations: { data: [] } }))

    await waitFor(() => expect(document.getElementById("equipes-personnes")).toHaveFocus())
  })

  it("should give the focus to the people table after an administrator demotes themselves, their menu leaving", async () => {
    fetchMock.mockResolvedValue(reponse(200, { data: { member: {} } }))
    const avecDeuxAdministrateurs = { membres: { data: [MEMBRES[0], { ...MEMBRES[1], role: "admin" as const }] } }
    const vue = rendre(avecDeuxAdministrateurs)

    choisir("Gérer Ada Martin", "menuitemradio", "Membre")
    await waitFor(() => expect(rafraichir).toHaveBeenCalledTimes(1))
    vue.rerender(ecran({ ...avecDeuxAdministrateurs, moi: { userId: ADA, estAdmin: false, equipesDirigees: [] }, invitations: { data: [] } }))

    await waitFor(() => expect(document.getElementById("equipes-personnes")).toHaveFocus())
  })

  it("should leave the focus on the trigger when it stays after the re-read", async () => {
    fetchMock.mockResolvedValue(reponse(200, { data: { member: {} } }))
    const vue = rendre()

    choisir("Gérer Claire Morel", "menuitemradio", "Administrateur")
    await waitFor(() => expect(rafraichir).toHaveBeenCalledTimes(1))
    vue.rerender(ecran({ membres: { data: [MEMBRES[0], { ...MEMBRES[1], role: "admin" }] } }))

    expect(screen.getByRole("button", { name: "Gérer Claire Morel" })).toHaveFocus()
  })

  it("should give both triggers of the checkbox menu the rounded border of a list of choices, the menu unchanged (E05-S11, AC-21)", () => {
    const ACHATS = "7c2e4b1a-5d6f-4a7b-8c9d-0e1f2a3b4c5d"
    const achats: TeamView = { id: ACHATS, slug: "achats", name: "Achats", leadName: null, members: [] }
    const claireEnTrois = { ...MEMBRES[1], teams: [{ id: ACHATS, name: "Achats", role: "member" as const }, ...MEMBRES[1].teams] }
    rendre({ membres: { data: [MEMBRES[0], claireEnTrois] }, equipes: { data: [achats, ...EQUIPES] } })

    for (const nom of ["Et 1 autre équipe de Claire Morel", "Régler les équipes de Claire Morel"]) {
      const declencheur = screen.getByRole("button", { name: nom })
      expect(declencheur).toHaveClass("oto-scope")
      fireEvent.click(declencheur)
      expect(within(screen.getByRole("menu")).getByRole("menuitemcheckbox", { name: "Achats" })).toHaveAttribute("aria-checked", "true")
      fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" })
    }
  })

  it("should give the focus to the people table once a team unchecked from « +n » leaves the person two teams, the « +n » leaving", async () => {
    fetchMock.mockResolvedValue(reponse(200, { data: {} }))
    const ACHATS = "7c2e4b1a-5d6f-4a7b-8c9d-0e1f2a3b4c5d"
    const achats: TeamView = { id: ACHATS, slug: "achats", name: "Achats", leadName: null, members: [] }
    const claireEnTrois = { ...MEMBRES[1], teams: [{ id: ACHATS, name: "Achats", role: "member" as const }, ...MEMBRES[1].teams] }
    const vue = rendre({ membres: { data: [MEMBRES[0], claireEnTrois] }, equipes: { data: [achats, ...EQUIPES] } })

    fireEvent.click(screen.getByRole("button", { name: "Et 1 autre équipe de Claire Morel" }))
    const achatsCoche = within(screen.getByRole("menu")).getByRole("menuitemcheckbox", { name: "Achats" })
    achatsCoche.focus()
    fireEvent.click(achatsCoche)
    await waitFor(() => expect(rafraichir).toHaveBeenCalledTimes(1))
    expect(envoi()).toMatchObject({ methode: "DELETE" })
    expect(String(envoi().url)).toContain(`teams/${ACHATS}/members/${CLAIRE}`)
    vue.rerender(ecran({ equipes: { data: [achats, ...EQUIPES] } }))

    expect(screen.queryByRole("button", { name: /autres? équipes? de Claire Morel/ })).not.toBeInTheDocument()
    await waitFor(() => expect(document.getElementById("equipes-personnes")).toHaveFocus())
  })

  it("should give the focus to the teams table once a deleted team leaves", async () => {
    fetchMock.mockResolvedValue(reponse(200, { data: {} }))
    const vue = rendre({ onglet: "teams" })

    choisir("Gérer Ventes", "menuitem", "Supprimer l'équipe")
    await waitFor(() => expect(dialogue("Supprimer Ventes").getByRole("button", { name: "Supprimer l'équipe" })).toBeEnabled())
    fireEvent.click(dialogue("Supprimer Ventes").getByRole("button", { name: "Supprimer l'équipe" }))
    await waitFor(() => expect(rafraichir).toHaveBeenCalledTimes(1))
    vue.rerender(ecran({ onglet: "teams", equipes: { data: [EQUIPES[0]] } }))

    await waitFor(() => expect(document.getElementById("equipes-liste")).toHaveFocus())
  })

  it("should give the focus to the dialog once the last candidate added leaves the list of people to add", async () => {
    fetchMock.mockResolvedValue(reponse(200, { data: { membership: {} } }))
    const vue = rendre({ onglet: "teams" })

    fireEvent.click(screen.getByRole("button", { name: "Voir les personnes de Ventes" }))
    const ajouter = dialogue("Les personnes de Ventes").getByRole("button", { name: "Ajouter Ada Martin à cette équipe" })
    ajouter.focus()
    fireEvent.click(ajouter)
    await waitFor(() => expect(rafraichir).toHaveBeenCalledTimes(1))
    const ventesAvecAda: TeamView = { ...EQUIPES[1], members: [...EQUIPES[1].members, { userId: ADA, name: "Ada Martin", email: "ada@demo.test", role: "member" }] }
    vue.rerender(ecran({ onglet: "teams", equipes: { data: [EQUIPES[0], ventesAvecAda] } }))

    await waitFor(() => expect(document.getElementById("equipe-composition")).toHaveFocus())
    expect(dialogue("Les personnes de Ventes").getByText("Tout le monde y est déjà")).toBeInTheDocument()
  })
})

// E05-S13 (AC-5) : l'onglet est retiré de l'écran ; le panneau reste exporté (HN-E05S13-4), monté seul ici.
describe("platform access gesture (AC18)", () => {
  it("should revoke after a confirmation that names the person and the organisation, the focus then on the title of the accesses", async () => {
    fetchMock.mockResolvedValue(reponse(200, { data: { access: { alreadyRevoked: false } } }))
    const acces = {
      accesses: [{ id: "a1", userId: "u1", name: "Paul Staff", email: "paul@editeur.test", grantedAt: "2026-09-01T09:00:00Z", grantedByName: null, revokedAt: null, revokedByName: null, reason: null }],
      addedByStaff: [],
    }
    render(
      <CoquilleOto pleinePage>
        <ContexteDeRafraichissement.Provider value={rafraichir}>
          <ContexteDeLHote.Provider value={{ Lien, chemin: "/admin/access", naviguer }}>
            <AccesPlateforme resultat={{ data: acces }} nomOrganisation="Démo" Lien={Lien} ici="/admin/access" />
          </ContexteDeLHote.Provider>
        </ContexteDeRafraichissement.Provider>
      </CoquilleOto>,
    )

    fireEvent.click(screen.getByRole("button", { name: "Révoquer l'accès (Paul Staff)" }))
    expect(screen.getByText("Révoquer l'accès de Paul Staff à Démo ? Il ne pourra plus agir sur Démo.")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Révoquer l'accès" }))

    await waitFor(() => expect(rafraichir).toHaveBeenCalledTimes(1))
    expect(envoi()).toEqual({ url: "/api/platform/platform-access/a1/revoke", methode: "POST", corps: {} })
    expect(screen.getByRole("heading", { name: "Accès de l'équipe plateforme à Démo" })).toHaveFocus()
  })
})
