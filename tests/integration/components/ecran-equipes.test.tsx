import type { AnchorHTMLAttributes, ReactNode } from "react"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { MemberView, ReglagesDesListes, TeamView } from "@otomata_tech/oto_platform/schemas"
import { ContexteDeLHote, CoquilleOto, EcranEquipes, EcranEquipesChargement, type EcranEquipesProps } from "@otomata_tech/oto_platform/ui"
import { simulerLesDialogues } from "../../helpers/dialogue"
import { libellesDesChoix } from "../../helpers/liste-de-choix"

// L'écran « Équipes et droits », porté d'oto-frontend (E05-S09 partie d1 : AC-d1, AC-x2 ; E05-S03 : AC1,
// AC2, AC4 à AC7, AC10, AC13, AC15, AC18) sur des données en mémoire, rendues comme la page de l'hôte les
// passe, sous la racine `.oto` et avec ce que l'hôte prête (`ContexteDeLHote`).

const ADA = "0b6f1f0e-1c1a-4a8e-9a51-0d7c1a2b3c01"
const CLAIRE = "0b6f1f0e-1c1a-4a8e-9a51-0d7c1a2b3c02"
const PAUL = "0b6f1f0e-1c1a-4a8e-9a51-0d7c1a2b3c04"
const VENTES = "0e8e5a3c-7f10-4a5b-8d3b-2b1c4d5e6f70"
const SUPPORT = "5b0d1c56-0f3a-4a57-9d8e-6f1f1b9e2c11"

const MEMBRES: MemberView[] = [
  {
    userId: ADA,
    email: "ada@demo.test",
    name: "Ada Martin",
    role: "admin",
    teams: [{ id: VENTES, name: "Ventes", role: "lead" }],
    lastSignInAt: "2026-09-20T08:00:00Z",
    isSelf: true,
  },
  {
    userId: CLAIRE,
    email: "claire@demo.test",
    name: "Claire Morel",
    role: "member",
    teams: [
      { id: SUPPORT, name: "Support", role: "member" },
      { id: VENTES, name: "Ventes", role: "member" },
    ],
    lastSignInAt: null,
    isSelf: false,
  },
]

const EQUIPES: TeamView[] = [
  { id: SUPPORT, slug: "support", name: "Support", leadName: null, members: [{ userId: CLAIRE, name: "Claire Morel", email: "claire@demo.test", role: "member" }] },
  {
    id: VENTES,
    slug: "ventes",
    name: "Ventes",
    leadName: "Ada Martin",
    members: [
      { userId: ADA, name: "Ada Martin", email: "ada@demo.test", role: "lead" },
      { userId: CLAIRE, name: "Claire Morel", email: "claire@demo.test", role: "member" },
    ],
  },
]

const INVITATION = { id: "9d1c7e2a-3b4c-4d5e-8f6a-7b8c9d0e1f2a", email: "new@demo.test", role: "member" as const, teamId: VENTES, invitedBy: ADA, expiresAt: "2026-10-01T10:00:00Z" }

const ADMIN = { userId: ADA, estAdmin: true, equipesDirigees: [VENTES] }
const SIMPLE_MEMBRE = { userId: CLAIRE, estAdmin: false, equipesDirigees: [] }
const ECHEC = "Une erreur est survenue. Réessayez."

const hote = vi.hoisted(() => ({ naviguer: vi.fn() }))

function LienDeTest({ href, children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children?: ReactNode }) {
  return (
    <a href={href} data-lien-hote="" {...props}>
      {children}
    </a>
  )
}

/** L'adresse d'un onglet, réglages compris, comme la page de l'hôte la construit. */
function hrefDOnglet(onglet: string, reglages: Partial<ReglagesDesListes> = {}): string {
  const recherche = new URLSearchParams({ tab: onglet })
  if (reglages.q) recherche.set("q", reglages.q)
  if (reglages.filter) recherche.set("filter", reglages.filter)
  if (reglages.sort) recherche.set("sort", reglages.sort)
  if (reglages.order === "desc") recherche.set("order", "desc")
  return `/teams?${recherche.toString()}`
}

function rendre(props: Partial<EcranEquipesProps> = {}) {
  return render(
    <CoquilleOto pleinePage>
      <ContexteDeLHote.Provider value={{ Lien: LienDeTest, chemin: "/teams", naviguer: hote.naviguer }}>
        <EcranEquipes
          onglet="members"
          nomOrganisation="Démo"
          moi={ADMIN}
          membres={{ data: MEMBRES }}
          invitations={{ data: [INVITATION] }}
          optionsDInvitation={{ data: { roles: ["member", "admin"], teams: [{ id: SUPPORT, name: "Support" }, { id: VENTES, name: "Ventes" }], teamRequired: false } }}
          equipes={{ data: EQUIPES }}
          Lien={LienDeTest}
          hrefDOnglet={hrefDOnglet}
          prefixeDesPages="/n/"
          {...props}
        />
      </ContexteDeLHote.Provider>
    </CoquilleOto>,
  )
}

/** Le texte d'une cellule, sans ce qui est caché aux lecteurs d'écran (les initiales d'un visage). */
function texte(element: HTMLElement): string {
  const copie = element.cloneNode(true)
  if (!(copie instanceof HTMLElement)) return ""
  for (const cache of copie.querySelectorAll("[aria-hidden='true']")) cache.remove()
  return copie.textContent ?? ""
}
const cellules = (ligne: HTMLElement) => within(ligne).getAllByRole("cell").map(texte)
const lignes = (nom: string) => within(screen.getByRole("table", { name: nom })).getAllByRole("row").slice(1)
/** Les lignes du menu ouvert (actions, choix exclusifs, cases), dans l'ordre. */
const items = () => [...screen.getByRole("menu").querySelectorAll("[role^='menuitem']")].map((item) => item.textContent)

beforeAll(simulerLesDialogues)

beforeEach(() => hote.naviguer.mockReset())

afterEach(cleanup)

describe("EcranEquipes header and tabs (AC1, AC-d1)", () => {
  it("should title the screen and give an administrator the two tabs as the head of one island, counts in badges, the current one selected (E05-S13, AC-5)", () => {
    rendre()

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Équipes & accès")
    const onglets = within(screen.getByRole("tablist", { name: "Onglets de l'écran" })).getAllByRole("tab")
    expect(onglets.map((onglet) => onglet.textContent)).toEqual(["Membres2", "Équipes2"])
    expect(onglets.map((onglet) => onglet.getAttribute("aria-selected"))).toEqual(["true", "false"])
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName("Membres 2")
    // Il contient des contrôles : pas de second arrêt de tabulation sur le panneau (motif APG).
    expect(screen.getByRole("tabpanel")).not.toHaveAttribute("tabindex")
  })

  it("should open another tab at its address of the host, and move the focus between tabs with the arrows", () => {
    rendre()
    const [membres, equipes] = screen.getAllByRole("tab")

    membres.focus()
    fireEvent.keyDown(membres, { key: "ArrowRight" })
    expect(equipes).toHaveFocus()
    expect(hote.naviguer).not.toHaveBeenCalled()
    fireEvent.click(equipes)
    expect(hote.naviguer).toHaveBeenCalledWith("/teams?tab=teams")
  })

  it("should give a non-administrator the same two tabs, no rules nor platform access tab (E05-S13, AC-5)", () => {
    rendre({ moi: SIMPLE_MEMBRE, optionsDInvitation: { data: null } })
    expect(screen.getAllByRole("tab").map((onglet) => onglet.textContent)).toEqual(["Membres2", "Équipes2"])
  })

  it("should count the people and the invitations under the title, and the teams on the teams tab", () => {
    rendre()
    expect(screen.getByText("2 personnes · 1 invitation")).toBeInTheDocument()

    cleanup()
    rendre({ onglet: "teams" })
    expect(screen.getByText("2 équipes")).toBeInTheDocument()
  })

  it("should offer « Inviter quelqu'un » in the header, a dialog with both roles and every team, to an administrator", () => {
    rendre()

    fireEvent.click(screen.getByRole("button", { name: "Inviter quelqu'un" }))

    const dialogue = screen.getByRole("dialog", { name: "Inviter quelqu'un" })
    expect(libellesDesChoix(within(dialogue).getByLabelText("Rôle"))).toEqual(["Membre", "Administrateur"])
    expect(libellesDesChoix(within(dialogue).getByLabelText("Équipe"))).toEqual(["Aucune équipe", "Support", "Ventes"])
  })

  it("should fix the member role and offer the led teams only to a lead (H72)", () => {
    rendre({ moi: { userId: CLAIRE, estAdmin: false, equipesDirigees: [VENTES] }, optionsDInvitation: { data: { roles: ["member"], teams: [{ id: VENTES, name: "Ventes" }], teamRequired: true } } })

    fireEvent.click(screen.getByRole("button", { name: "Inviter quelqu'un" }))

    const dialogue = screen.getByRole("dialog", { name: "Inviter quelqu'un" })
    expect(within(dialogue).queryByLabelText("Rôle")).toBeNull()
    expect(libellesDesChoix(within(dialogue).getByLabelText("Équipe"))).toEqual(["Ventes"])
  })

  it("should offer no invitation to a plain member, and « Créer une équipe » to an administrator only", () => {
    rendre({ moi: SIMPLE_MEMBRE, optionsDInvitation: { data: null } })
    expect(screen.queryByRole("button", { name: "Inviter quelqu'un" })).toBeNull()

    cleanup()
    rendre({ onglet: "teams", moi: SIMPLE_MEMBRE })
    expect(screen.queryByRole("button", { name: "Créer une équipe" })).toBeNull()

    cleanup()
    rendre({ onglet: "teams" })
    expect(screen.getByRole("button", { name: "Créer une équipe" })).toBeInTheDocument()
  })
})

describe("EcranEquipes states (AC2)", () => {
  it("should render a busy loading state with a readable label", () => {
    render(<EcranEquipesChargement />)
    const statut = screen.getByRole("status")
    expect(statut).toHaveAttribute("aria-busy", "true")
    expect(statut).toHaveTextContent("Chargement des équipes et des accès…")
  })

  it("should announce a failed read of the people and link « Réessayer » to the same address, without a table", () => {
    rendre({ membres: { error: ECHEC } })

    expect(screen.getByRole("alert")).toHaveTextContent(ECHEC)
    expect(screen.getByRole("link", { name: "Réessayer" })).toHaveAttribute("href", "/teams?tab=members")
    expect(screen.queryByRole("table")).toBeNull()
  })

  it("should say the teams failed and show the members alone, rather than name the team of an invitation « Équipe inconnue »", () => {
    rendre({ equipes: { error: ECHEC } })

    expect(screen.getByRole("alert")).toHaveTextContent(ECHEC)
    expect(lignes("Les personnes de Démo").map((ligne) => cellules(ligne)[1])).toEqual(["Membre", "Membre"])
    expect(screen.queryByRole("button", { name: /invitations/ })).toBeNull()
    expect(screen.queryByText(/inconnue/)).toBeNull()
  })

  // Chaque lecture d'un onglet, en échec, se dit avec « Réessayer » vers la même adresse (portage § 4).
  const LECTURES_EN_ECHEC: [string, Partial<EcranEquipesProps>, string][] = [
    ["the pending invitations", { invitations: { error: ECHEC } }, "/teams?tab=members"],
    ["the invitation options", { optionsDInvitation: { error: ECHEC } }, "/teams?tab=members"],
    ["the teams of the teams tab", { onglet: "teams", equipes: { error: ECHEC } }, "/teams?tab=teams"],
    ["the people of the teams tab", { onglet: "teams", membres: { error: ECHEC } }, "/teams?tab=teams"],
  ]

  it.each(LECTURES_EN_ECHEC)("should say a failed read of %s with « Réessayer » to the same address", (_lecture, echec, adresse) => {
    rendre(echec)

    expect(screen.getByRole("alert")).toHaveTextContent(ECHEC)
    expect(screen.getByRole("link", { name: "Réessayer" })).toHaveAttribute("href", adresse)
  })
})

describe("EcranEquipes people table (AC4 to AC7, AC-d1)", () => {
  it("should list the people and the pending invitations by name, with status, role, teams and last sign-in, no default team (E05-S13, AC-26)", () => {
    rendre()

    const tableau = screen.getByRole("table", { name: "Les personnes de Démo" })
    expect(within(tableau).getAllByRole("columnheader").map((entete) => entete.textContent)).toEqual([
      "Personne",
      "Statut",
      "Rôle",
      "Équipes",
      "Dernière connexion",
      "Actions",
    ])
    const [ada, claire, invitation] = lignes("Les personnes de Démo")
    expect(cellules(ada).slice(0, 5)).toEqual(["Ada Martin · vousada@demo.test", "Membre", "Administrateur", "Ventes", "20 septembre 2026"])
    expect(cellules(claire).slice(0, 5)).toEqual(["Claire Morelclaire@demo.test", "Membre", "Membre", "SupportVentes", "Jamais"])
    expect(cellules(invitation).slice(0, 5)).toEqual(["new@demo.testinvitée par Ada Martin", "Invitée", "Membre", "Ventes", "expire le 1 octobre 2026"])
  })

  it("should sort by name in the order of the address, and ask the host for the other order", () => {
    rendre({ reglages: { q: "", order: "desc" } })

    expect(lignes("Les personnes de Démo").map((ligne) => cellules(ligne)[0])).toEqual([
      "new@demo.testinvitée par Ada Martin",
      "Claire Morelclaire@demo.test",
      "Ada Martin · vousada@demo.test",
    ])
    expect(screen.getByRole("columnheader", { name: /Personne/ })).toHaveAttribute("aria-sort", "descending")
    fireEvent.click(screen.getByRole("button", { name: "Trier sur Personne" }))
    expect(hote.naviguer).toHaveBeenCalledWith("/teams?tab=members")
  })

  it("should count the people and the invitations in tiles that filter the table through the address", () => {
    rendre({ reglages: { q: "", order: "asc", filter: "invitations" } })

    const tuiles = within(screen.getByRole("group", { name: "Les personnes en chiffres" })).getAllByRole("button")
    expect(tuiles.map((tuile) => [tuile.textContent, tuile.getAttribute("aria-pressed")])).toEqual([
      ["2personnesdans Démo", "false"],
      ["1invitationen attente de réponse", "true"],
    ])
    expect(lignes("Les personnes de Démo").map((ligne) => cellules(ligne)[1])).toEqual(["Invitée"])
    fireEvent.click(tuiles[0])
    expect(hote.naviguer).toHaveBeenCalledWith("/teams?tab=members")
  })

  it("should search a name or an address on submit, and say when nobody matches with a way back to everyone", () => {
    rendre({ reglages: { q: "claire", order: "asc" } })

    expect(lignes("Les personnes de Démo").map((ligne) => cellules(ligne)[0])).toEqual(["Claire Morelclaire@demo.test"])
    const champ = screen.getByRole("searchbox", { name: "Chercher une personne" })
    fireEvent.change(champ, { target: { value: "Émile" } })
    fireEvent.submit(champ)
    expect(hote.naviguer).toHaveBeenCalledWith("/teams?tab=members&q=%C3%89mile")

    cleanup()
    rendre({ reglages: { q: "personne", order: "asc" } })
    expect(screen.getByText("Personne ne correspond")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Voir tout le monde" })).toHaveAttribute("href", "/teams?tab=members")
  })

  it("should give a plain member no gesture on the people", () => {
    rendre({ moi: SIMPLE_MEMBRE, optionsDInvitation: { data: null } })

    const tableau = screen.getByRole("table", { name: "Les personnes de Démo" })
    expect(within(tableau).queryByRole("columnheader", { name: "Actions" })).toBeNull()
    expect(within(tableau).queryByRole("button", { name: /^Gérer|^Régler/ })).toBeNull()
  })

  it("should give the administrator a menu on every row, the invitation cancellable whoever sent it (AC6)", () => {
    const deClaire = { ...INVITATION, id: "9d1c7e2a-3b4c-4d5e-8f6a-7b8c9d0e1f2b", email: "alain@demo.test", invitedBy: CLAIRE }
    rendre({ invitations: { data: [INVITATION, deClaire] } })

    fireEvent.click(screen.getByRole("button", { name: "Gérer alain@demo.test" }))
    expect(items()).toEqual(["Annuler l'invitation"])
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" })

    fireEvent.click(screen.getByRole("button", { name: "Gérer Claire Morel" }))
    expect(items()).toEqual(["Administrateur", "Membre", "Support", "Ventes", "Retirer de Démo"])
  })

  it("should let a lead who is not an administrator compose the team he leads and cancel the invitations he sent, and only those (AC6, AC13)", () => {
    const deClaire = { ...INVITATION, id: "9d1c7e2a-3b4c-4d5e-8f6a-7b8c9d0e1f2c", email: "recrue@demo.test", invitedBy: CLAIRE }
    rendre({
      moi: { userId: CLAIRE, estAdmin: false, equipesDirigees: [SUPPORT] },
      invitations: { data: [deClaire, INVITATION] },
      optionsDInvitation: { data: { roles: ["member"], teams: [{ id: SUPPORT, name: "Support" }], teamRequired: true } },
    })

    expect(screen.getByRole("button", { name: "Gérer recrue@demo.test" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Gérer new@demo.test" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Régler les équipes de Ada Martin" }))
    // Support se compose ; Ventes, où Ada est, se lit sans se changer.
    expect(within(screen.getByRole("menu")).getByRole("menuitemcheckbox", { name: "Support" })).toHaveAttribute("aria-checked", "false")
    expect(within(screen.getByRole("menu")).getByRole("menuitemcheckbox", { name: "Ventes" })).toHaveAttribute("aria-disabled", "true")
  })
})

describe("EcranEquipes teams table (AC10 to AC14)", () => {
  it("should show each team, its leads or none, its people, and those in no team (E05-S13, AC-24)", () => {
    // Paul, membre sans équipe, que le compte au-dessus du tableau annonce.
    const paul: MemberView = { userId: PAUL, email: "paul@demo.test", name: "Paul Roux", role: "member", teams: [], lastSignInAt: null, isSelf: false }
    rendre({ onglet: "teams", membres: { data: [...MEMBRES, paul] } })

    expect(screen.getByText("1 personne dans aucune équipe")).toBeInTheDocument()
    const [support, ventes] = lignes("Les équipes de Démo")
    expect(cellules(support).slice(0, 3)).toEqual(["Support", "—", "1 personne"])
    expect(cellules(ventes).slice(0, 3)).toEqual(["Ventes", "Ada Martin", "2 personnes"])
  })

  it("should sort the teams by their number of people when the address asks", () => {
    rendre({ onglet: "teams", reglages: { q: "", order: "desc", sort: "people" } })
    expect(lignes("Les équipes de Démo").map((ligne) => cellules(ligne)[0])).toEqual(["Ventes", "Support"])
    fireEvent.click(screen.getByRole("button", { name: "Trier sur Équipe" }))
    expect(hote.naviguer).toHaveBeenCalledWith("/teams?tab=teams")
  })

  it("should give the administrator composition, renaming and deletion in the menu of a team he does not lead, no « Changer de responsable… » (AC-24)", () => {
    rendre({ onglet: "teams" })

    fireEvent.click(screen.getByRole("button", { name: "Gérer Support" }))
    expect(items()).toEqual(["Ajouter quelqu'un…", "Renommer…", "Supprimer l'équipe"])
  })

  it("should let a lead compose the team he leads only, and show the people of any team to anyone (AC13)", () => {
    rendre({ onglet: "teams", moi: { userId: CLAIRE, estAdmin: false, equipesDirigees: [SUPPORT] } })

    expect(screen.queryByRole("button", { name: "Gérer Ventes" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Gérer Support" }))
    expect(items()).toEqual(["Ajouter quelqu'un…"])
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" })

    fireEvent.click(screen.getByRole("button", { name: "Voir les personnes de Ventes" }))
    const dialogue = screen.getByRole("dialog", { name: "Les personnes de Ventes" })
    expect(within(dialogue).getByRole("list", { name: "Les personnes de Ventes" })).toHaveTextContent("Ada MartinResponsableada@demo.test")
    expect(within(dialogue).queryByRole("button", { name: /^Retirer|^Ajouter/ })).toBeNull()
  })

  it("should say there is no team yet", () => {
    rendre({ onglet: "teams", equipes: { data: [] } })
    expect(screen.getByText("Aucune équipe pour l'instant")).toBeInTheDocument()
  })
})

describe("EcranEquipes accessibility (AC-x3)", () => {
  it("should give every field a label and every button a name, on every tab", () => {
    for (const vue of [{}, { onglet: "teams" as const }]) {
      const { container, unmount } = rendre(vue)
      // Hors des dialogues fermés, que personne n'atteint.
      const visibles = (selecteur: string) => [...container.querySelectorAll(selecteur)].filter((element) => !element.closest("dialog:not([open])"))
      for (const champ of visibles("input:not([type='hidden']), [role='combobox']")) expect(champ).toHaveAccessibleName()
      for (const bouton of visibles("button")) expect(bouton).toHaveAccessibleName()
      unmount()
    }
  })
})

describe("capacités atteintes (E12-S02, AC-10)", () => {
  it("should grey the header gesture at the limit, with the raise link for an administrator only", () => {
    const limites = { members: { max: 3, used: 3 }, teams: { max: 2, used: 2 }, connectors: null, raiseUrl: "/billing" }
    const { unmount } = rendre({ limites })
    expect(screen.getByRole("button", { name: "Inviter quelqu'un" })).toBeDisabled()
    expect(screen.getByText(/Limite atteinte : 3 membres sur 3, invitations en attente comprises\./)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Relever la limite" })).toHaveAttribute("href", "/billing?capacity=members_max")
    unmount()

    rendre({ limites, onglet: "teams" })
    expect(screen.getByRole("button", { name: "Créer une équipe" })).toBeDisabled()
    expect(screen.getByRole("link", { name: "Relever la limite" })).toHaveAttribute("href", "/billing?capacity=teams_max")
  })

  it("should leave the gesture open under the limit, and give no link to a lead", () => {
    const { unmount } = rendre({ limites: { members: { max: 3, used: 2 }, teams: null, connectors: null, raiseUrl: "/billing" } })
    expect(screen.getByRole("button", { name: "Inviter quelqu'un" })).toBeEnabled()
    unmount()
    rendre({
      moi: { userId: ADA, estAdmin: false, equipesDirigees: [VENTES] },
      optionsDInvitation: { data: { roles: ["member"], teams: [{ id: VENTES, name: "Ventes" }], teamRequired: true } },
      limites: { members: { max: 3, used: 3 }, teams: null, connectors: null, raiseUrl: "/billing" },
    })
    expect(screen.getByRole("button", { name: "Inviter quelqu'un" })).toBeDisabled()
    expect(screen.queryByRole("link", { name: "Relever la limite" })).toBeNull()
  })
})
