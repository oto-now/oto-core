import type { ComponentProps, ReactNode } from "react"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { NodeRulesView, ShareView, TreeNode } from "@otomata_tech/oto_platform/schemas"
import { ContexteDeLHote, ContexteDeRafraichissement, EcranDeNoeud } from "@otomata_tech/oto_platform/ui"
import { choisirDansLaListe, libellesDesChoix } from "../../helpers/liste-de-choix"
import { envoiDuNiveau } from "../../../packages/plateforme/ui/noeud/niveau-d-un-membre"
import { vueDuNoeud } from "../../helpers/noeud"

// « Partager » (E05-S10, partie b, AC-b5), ouvert depuis l'en-tête de l'écran d'un nœud : le champ qui ajoute
// une personne ou une équipe, l'accès par défaut (l'équipe propriétaire et toute l'organisation, 1.4.13), la liste
// des ajoutés avec leur niveau dans un menu ; l'API simulée par `fetch`, la relecture espionnée. Les services et
// leurs refus sont ceux d'E05-S03 : ici, l'écran seul. Après la partie d d'E05-S10 : « Partager sur le web »
// (AC-d1, ADR-013) pour qui a l'accès complet, et l'accès général qui se change (AC-b13, ADR-014) ; les refus
// sont ceux des services (parties e), dits ici par l'écran.

type Props = ComponentProps<typeof EcranDeNoeud>

const LEA = "0b6f1f0e-1c1a-4a8e-9a51-0d7c1a2b3c02"
const MARC = "0b6f1f0e-1c1a-4a8e-9a51-0d7c1a2b3c03"
const NORA = "0b6f1f0e-1c1a-4a8e-9a51-0d7c1a2b3c04"
const VENTES = "7c1d2e3f-4a5b-4c6d-8e7f-000000000001"
const CONSEIL = "7c1d2e3f-4a5b-4c6d-8e7f-000000000002"
const REGLE_VENTES = "5e6f7a8b-9c0d-4e1f-8a2b-000000000011"
const REGLE_LEA = "5e6f7a8b-9c0d-4e1f-8a2b-000000000012"
const REGLE_MARC = "5e6f7a8b-9c0d-4e1f-8a2b-000000000013"

const REGLES: NodeRulesView = {
  path: "ventes/modele_relance",
  title: "Modèle de relance",
  owner: { kind: "team", teamId: VENTES, teamName: "Ventes", leadName: "Claire Morel" },
  viewerLevel: 3,
  rules: [
    { id: REGLE_VENTES, subject: { kind: "team", id: VENTES, name: "Ventes" }, level: "write" },
    { id: REGLE_LEA, subject: { kind: "user", id: LEA, name: "Léa Martin" }, level: "read" },
    { id: REGLE_MARC, subject: { kind: "user", id: MARC, name: "Marc Dupont" }, level: "manage" },
  ],
}

/** L'accès par défaut de l'équipe que sert `GET rules?path=` : sa règle sur la page, au niveau qu'elle aurait sans elle. */
const EQUIPE: NonNullable<NodeRulesView["team"]> = { teamId: VENTES, level: "write", inherited: "write", ruleId: REGLE_VENTES }

const SUJETS = {
  equipes: [
    { id: VENTES, nom: "Ventes" },
    { id: CONSEIL, nom: "Conseil" },
  ],
  personnes: [
    { id: LEA, nom: "Léa Martin" },
    { id: MARC, nom: "Marc Dupont" },
    { id: NORA, nom: "Nora Écoffier" },
  ],
}

const ARBRE: TreeNode[] = [{ path: "guide", kind: "page", title: "Guide", status: "published", children: [{ path: "ventes", kind: "page", title: "Ventes", status: "published", children: [] }] }]

const rafraichir = vi.fn()
const fetchMock = vi.fn<typeof fetch>()

function LienDeTest({ children, ...props }: { href: string; className?: string; children: ReactNode }) {
  return <a {...props}>{children}</a>
}

function ecran(partage: Partial<NonNullable<Props["partage"]>> = {}) {
  return (
    <ContexteDeRafraichissement.Provider value={rafraichir}>
      <ContexteDeLHote.Provider value={{ Lien: "a", chemin: "", naviguer: vi.fn() }}>
        <EcranDeNoeud
          chemin="ventes/modele_relance"
          noeud={{ data: vueDuNoeud() }}
          arbre={{ data: { tree: ARBRE, truncated: false } }}
          equipes={{ data: [{ slug: "ventes", name: "Ventes" }] }}
          handle="lea"
          nomOrganisation="Démo"
          versionPubliee={false}
          Lien={LienDeTest}
          hrefDuChemin={(chemin) => `/n/${chemin}`}
          prefixeDesPages="/n/"
          partage={{ regles: { data: REGLES }, sujets: { data: SUJETS }, gestionAccordable: true, moi: LEA, ...partage }}
        />
      </ContexteDeLHote.Provider>
    </ContexteDeRafraichissement.Provider>
  )
}

/** Monte l'écran et ouvre « Partager » ; `relire` le rerend, comme l'hôte après `rafraichir`. */
function ouvrir(partage: Partial<NonNullable<Props["partage"]>> = {}) {
  const rendu = render(ecran(partage))
  fireEvent.click(screen.getByRole("button", { name: "Partager · Ventes" }))
  return { panneau: () => within(screen.getByRole("dialog", { name: "Partager — Ventes" })), relire: (suite: Partial<NonNullable<Props["partage"]>>) => rendu.rerender(ecran(suite)) }
}

function reponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

// La lecture du lien public, faite par « Partager sur le web » à l'ouverture du panneau (partie d) : « aucun
// lien » ici, et hors des gestes comptés ; ses cas sont plus bas (« Partager sur le web »).
const LECTURE_DU_LIEN_PUBLIC = "/api/platform/shares?"

const estLaLectureDuLien = (url: unknown) => String(url).startsWith(LECTURE_DU_LIEN_PUBLIC)

/** La lecture des membres et du niveau de l'équipe (1.4.12, 1.4.13), faite à l'ouverture du panneau : hors des gestes comptés. */
const LECTURE_DES_MEMBRES = "/api/platform/rules?"
const servis: { people: NonNullable<NodeRulesView["people"]>; team: NodeRulesView["team"] } = { people: [], team: EQUIPE }
const estUneLecture = (url: unknown) => estLaLectureDuLien(url) || String(url).startsWith(LECTURE_DES_MEMBRES)

/** L'API simulée : la lecture du lien public rend « aucun lien », tout autre appel la réponse du cas. */
function repondre(reponseDuGeste: () => Response) {
  fetchMock.mockImplementation(async (url) =>
    estLaLectureDuLien(url) ? reponse(200, { data: { share: null } }) : String(url).startsWith(LECTURE_DES_MEMBRES) ? reponse(200, { data: { ...REGLES, ...servis } }) : reponseDuGeste(),
  )
}

const envoye = (rang = 0) => {
  const [url, init] = fetchMock.mock.calls.filter(([adresse]) => !estUneLecture(adresse))[rang]
  return { url, methode: init?.method, corps: init?.body ? JSON.parse(String(init.body)) : undefined }
}

// « Partager sur le web » et l'accès général (partie d) : un nœud d'équipe sans ajouté, vu par qui n'est pas administrateur.
const CHEMIN = "ventes/modele_relance"
const JETON = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde"
const LIEN_ID = "9a8b7c6d-5e4f-4a3b-8c2d-000000000001"

const REGLES_SANS_AJOUT: NodeRulesView = {
  path: CHEMIN,
  title: "Modèle de relance",
  owner: { kind: "team", teamName: "Ventes", leadName: "Claire Morel" },
  viewerLevel: 3,
  rules: [],
  general: null,
}

const SANS_AJOUT: Partial<NonNullable<Props["partage"]>> = { regles: { data: REGLES_SANS_AJOUT }, sujets: { data: { equipes: [], personnes: [] } }, gestionAccordable: false, moi: null }

const LIEN: ShareView = { id: LIEN_ID, path: CHEMIN, token: JETON, includeChildren: false, createdAt: "2026-09-27T08:00:00.000Z", createdByName: "Léa Martin" }

type Appel = { url: string; methode: string; corps: unknown }

/** L'API simulée, appel par appel : `reponseA` reçoit l'URL, la méthode et le corps lu. */
function api(reponseA: (appel: Appel) => Response) {
  fetchMock.mockImplementation(async (url, init) => reponseA({ url: String(url), methode: init?.method ?? "GET", corps: init?.body ? JSON.parse(String(init.body)) : undefined }))
}

// La lecture des membres de l'équipe propriétaire (1.4.12), faite par « Partager » à l'ouverture : hors des appels comptés.
const appels = (): Appel[] => fetchMock.mock.calls.filter(([url]) => !String(url).startsWith(LECTURE_DES_MEMBRES)).map(([url, init]) => ({ url: String(url), methode: init?.method ?? "GET", corps: init?.body ? JSON.parse(String(init.body)) : undefined }))

const LECTURE = `/api/platform/shares?path=${encodeURIComponent(CHEMIN)}`

beforeEach(() => {
  fetchMock.mockReset()
  rafraichir.mockReset()
  servis.people = []
  servis.team = EQUIPE
  vi.stubGlobal("fetch", fetchMock)
  repondre(() => reponse(200, { data: {} }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("Partager, who has access (AC-b5)", () => {
  it("should list each added team or person with its level in a menu of Notion's words, the owner team on its own line, without the word « règle »", async () => {
    const { panneau } = ouvrir()
    const liste = within(panneau().getByRole("list", { name: "Personnes et équipes ajoutées" }))
    // 1.4.13 : la règle de l'équipe propriétaire se règle sur sa ligne de l'accès par défaut, pas parmi les ajoutés.
    expect(liste.getAllByRole("combobox").map((menu) => menu.getAttribute("aria-label"))).toEqual(["Accès de Léa Martin", "Accès de Marc Dupont"])
    expect(liste.getAllByRole("listitem")[0]).toHaveTextContent("Léa Martinvous")
    const menu = liste.getByRole("combobox", { name: "Accès de Léa Martin" })
    expect(menu).toHaveValue("read")
    // 1.4.12 : « Aucun accès » rend le contenu et ce qu'il range invisibles à la personne ou à l'équipe.
    expect(libellesDesChoix(menu)).toEqual(["Accès complet", "Peut modifier", "Peut lire", "Aucun accès", "Retirer"])
    expect(liste.getByRole("combobox", { name: "Accès de Marc Dupont" })).toHaveValue("manage")
    expect(panneau().getByRole("heading", { name: "Personnes et équipes ajoutées · 2" })).toBeInTheDocument()

    // L'accès par défaut : l'équipe, lue à l'ouverture, et toute l'organisation, chacune à son niveau.
    const equipe = await panneau().findByRole("combobox", { name: "Niveau de l'équipe Ventes" })
    expect(equipe).toHaveValue("write")
    expect(libellesDesChoix(equipe)).toEqual(["Accès complet", "Peut modifier", "Peut lire", "Aucun accès"])
    const organisation = panneau().getByRole("combobox", { name: "Niveau de toute l'organisation" })
    expect(organisation).toHaveValue("none")
    expect(libellesDesChoix(organisation)).toEqual(["Accès complet", "Peut modifier", "Peut lire", "Aucun accès"])
    // 1.4.13 : chaque niveau de la liste dit ce qu'il permet, en une ligne fine sous son nom.
    fireEvent.click(equipe)
    expect(screen.getByRole("option", { name: "Peut modifier" })).toHaveAccessibleDescription("Lit, écrit et publie.")
    fireEvent.click(equipe)
    // 1.5.1 : le pied « Votre accès » est retiré.
    expect(panneau().queryByText("Votre accès")).toBeNull()
    expect(screen.getByRole("dialog", { name: "Partager — Ventes" }).textContent).not.toMatch(/règle/i)
  })

  // N6 : l'accès complet ne s'accorde que par un administrateur ; celui d'une ligne se garde, il est déjà là.
  it("should not offer « Accès complet » to a manager who is not an administrator, except as the current level of a row", async () => {
    const { panneau } = ouvrir({ gestionAccordable: false })
    const options = (nom: string) => libellesDesChoix(panneau().getByRole("combobox", { name: nom }))
    await panneau().findByRole("combobox", { name: "Niveau de l'équipe Ventes" })
    expect(options("Niveau de l'équipe Ventes")).toEqual(["Peut modifier", "Peut lire", "Aucun accès"])
    expect(options("Niveau de toute l'organisation")).toEqual(["Peut modifier", "Peut lire", "Aucun accès"])
    expect(options("Accès de Marc Dupont")).toEqual(["Accès complet", "Peut modifier", "Peut lire", "Aucun accès", "Retirer"])
  })

  it("should show the levels as pills and change nothing for someone without full access", async () => {
    const { panneau } = ouvrir({ regles: { data: { ...REGLES, viewerLevel: 2, general: { id: "r1", level: "write" } } } })
    expect(within(panneau().getByRole("list", { name: "Personnes et équipes ajoutées" })).getAllByRole("listitem")[1]).toHaveTextContent("Marc DupontAccès complet")
    expect(panneau().getByText("Toute l'organisation Démo").closest(".oto-pop-row")).toHaveTextContent("Toute l'organisation DémoPeut modifier")
    // La ligne de l'équipe se lit aussi pour qui ne gère pas : son niveau vient de la même lecture.
    await waitFor(() => expect(panneau().getByText("Équipe Ventes").closest(".oto-pop-row")).toHaveTextContent("Équipe VentesPeut modifier"))
    expect(panneau().queryByRole("combobox")).toBeNull()
    expect(panneau().getByText("Seules les personnes qui ont l'accès complet changent le partage.")).toBeInTheDocument()
  })

  // Un contenu de Privé reste fermé à l'organisation, et le panneau dit pourquoi.
  it.each([
    { cas: "the organisation", owner: { kind: "org" as const }, libelle: "Toute l'organisation Démo", details: ["Dans Tout le monde, chaque membre lit au moins ce contenu."], ouvrable: true },
    {
      cas: "a person",
      owner: { kind: "user" as const, userName: "Léa Martin" },
      libelle: "Seulement les personnes ajoutées",
      details: ["Léa Martin a l'accès complet.", "Un contenu de Privé ne s'ouvre pas à toute l'organisation : ajoutez des personnes ou des équipes."],
      ouvrable: false,
    },
  ])("should say the default access of a node owned by $cas", ({ owner, libelle, details, ouvrable }) => {
    servis.team = null
    const { panneau } = ouvrir({ regles: { data: { ...REGLES, owner, rules: [], general: null } } })
    expect(panneau().getByText("Personne n'a été ajouté à ce contenu.")).toBeInTheDocument()
    expect(panneau().getByText(libelle)).toBeInTheDocument()
    for (const detail of details) expect(panneau().getByText(detail)).toBeInTheDocument()
    expect(panneau().queryByRole("combobox", { name: /toute l'organisation/ }) !== null).toBe(ouvrable)
    expect(panneau().queryByText("Équipe Ventes")).toBeNull()
  })
})

// 1.4.13 : l'équipe propriétaire et toute l'organisation se règlent chacune sur sa ligne ; l'équipe ne descend pas sous l'organisation.
describe("Partager, default access of the owner team and of the organisation", () => {
  it("should post the team's level, remove its rule when the level chosen is the one it inherits, and post the organisation's access", async () => {
    repondre(() => reponse(200, { data: {} }))
    const { panneau } = ouvrir()
    choisirDansLaListe(await panneau().findByRole("combobox", { name: "Niveau de l'équipe Ventes" }), "Peut lire")
    await waitFor(() => expect(panneau().getByRole("status")).toHaveTextContent("Équipe Ventes : peut lire."))
    expect(envoye()).toEqual({ url: "/api/platform/rules", methode: "POST", corps: { path: "ventes/modele_relance", subject: { kind: "team", id: VENTES }, level: "read" } })

    choisirDansLaListe(panneau().getByRole("combobox", { name: "Niveau de toute l'organisation" }), "Peut lire")
    await waitFor(() => expect(panneau().getByRole("status")).toHaveTextContent("Toute l'organisation : peut lire."))
    expect(envoye(1)).toEqual({ url: "/api/platform/nodes/access", methode: "POST", corps: { path: "ventes/modele_relance", access: "organisation", level: "read" } })
    expect(rafraichir).toHaveBeenCalledTimes(2)
  })

  it("should remove the team's rule to get back the inherited level, and offer nothing below the organisation", async () => {
    servis.team = { ...EQUIPE, level: "manage", inherited: "write" }
    const { panneau } = ouvrir({ regles: { data: { ...REGLES, general: { id: "regle-org", level: "read" } } } })
    const equipe = await panneau().findByRole("combobox", { name: "Niveau de l'équipe Ventes" })
    expect(libellesDesChoix(equipe)).toEqual(["Accès complet", "Peut modifier", "Peut lire"])
    choisirDansLaListe(equipe, "Peut modifier")
    await waitFor(() => expect(envoye()).toEqual({ url: `/api/platform/rules/${REGLE_VENTES}`, methode: "DELETE", corps: undefined }))
  })

  it("should mark an inherited team level, and leave the organisation at « Aucun accès » by removing its access", async () => {
    servis.team = { ...EQUIPE, ruleId: null }
    const { panneau } = ouvrir({ regles: { data: { ...REGLES, rules: REGLES.rules.slice(1), general: { id: "regle-org", level: "read" } } } })
    await waitFor(() => expect(panneau().getByText("Équipe Ventes").closest(".oto-pop-row")).toHaveTextContent("Équipe Ventes" + "hérité"))
    choisirDansLaListe(panneau().getByRole("combobox", { name: "Niveau de toute l'organisation" }), "Aucun accès")
    await waitFor(() => expect(envoye()).toEqual({ url: "/api/platform/nodes/access", methode: "POST", corps: { path: "ventes/modele_relance", access: "restricted" } }))
  })
})

describe("Partager, adding someone (AC-b5)", () => {
  it("should find a team or a person without access, accents aside, add it at « Peut lire » by click or keyboard, then re-read the page", async () => {
    repondre(() => reponse(201, { data: { rule: {} } }))
    const { panneau } = ouvrir()
    const champ = panneau().getByRole("combobox", { name: "Ajouter une personne ou une équipe" })
    fireEvent.change(champ, { target: { value: "e" } })
    // Ventes, Léa et Marc ont déjà un accès : seuls Conseil et Nora sont proposés.
    const suggestions = within(panneau().getByRole("listbox", { name: "Personnes et équipes" }))
    expect(suggestions.getAllByRole("option")).toHaveLength(2)
    expect(suggestions.getByRole("option", { name: "Équipe Conseil" })).toBeInTheDocument()
    expect(suggestions.getByRole("option", { name: "Nora Écoffier" })).toBeInTheDocument()
    fireEvent.change(champ, { target: { value: "ecof" } })
    fireEvent.click(panneau().getByRole("option", { name: "Nora Écoffier" }))

    await waitFor(() => expect(panneau().getByRole("status")).toHaveTextContent("Nora Écoffier peut lire ce contenu."))
    expect(envoye()).toEqual({ url: "/api/platform/rules", methode: "POST", corps: { path: "ventes/modele_relance", subject: { kind: "user", id: NORA }, level: "read" } })
    expect(rafraichir).toHaveBeenCalledTimes(1)
    expect(champ).toHaveValue("")

    fireEvent.change(champ, { target: { value: "cons" } })
    fireEvent.keyDown(champ, { key: "ArrowDown" })
    expect(champ).toHaveAttribute("aria-activedescendant", panneau().getByRole("option", { name: "Équipe Conseil" }).id)
    fireEvent.keyDown(champ, { key: "Enter" })
    await waitFor(() => expect(envoye(1).corps).toEqual({ path: "ventes/modele_relance", subject: { kind: "team", id: CONSEIL }, level: "read" }))
    fireEvent.change(champ, { target: { value: "zzz" } })
    expect(panneau().getByText("Aucune personne ni équipe de ce nom.")).toBeInTheDocument()
  })
})

// 1.4.12 : les membres de l'équipe propriétaire, leur niveau hérité, et la règle de cette page qui le surcharge.
describe("Partager, members of the owner team", () => {
  const PAUL = "0b6f1f0e-1c1a-4a8e-9a51-0d7c1a2b3c05"
  const ZOE = "0b6f1f0e-1c1a-4a8e-9a51-0d7c1a2b3c06"
  const REGLE_PAUL = "5e6f7a8b-9c0d-4e1f-8a2b-000000000015"
  const people: NonNullable<NodeRulesView["people"]> = [
    { userId: NORA, name: "Nora Écoffier", lead: true, level: "manage", inherited: "manage", ruleId: null },
    { userId: PAUL, name: "Paul Henry", lead: false, level: "write", inherited: "write", ruleId: null },
    { userId: ZOE, name: "Zoé Arnaud", lead: false, level: "read", inherited: "read", ruleId: null },
    { userId: LEA, name: "Léa Martin", lead: false, level: "read", inherited: "write", ruleId: REGLE_LEA },
  ]

  it("should list the members without access of their own with their real level, mark an exception, and restrict one on this page only", async () => {
    servis.people = people
    const { panneau } = ouvrir()
    // Lus à l'ouverture du panneau, par `GET rules?path=` : l'affichage de la page ne les calcule pas.
    const membres = within(await panneau().findByRole("list", { name: "Membres de l'équipe Ventes" }))
    // Léa a une règle sur la page : elle est parmi les ajoutés, où « Retirer » rend son niveau hérité.
    expect(membres.getAllByRole("combobox").map((menu) => menu.getAttribute("aria-label"))).toEqual(["Accès de Nora Écoffier", "Accès de Paul Henry", "Accès de Zoé Arnaud"])
    expect(membres.getAllByRole("listitem")[0]).toHaveTextContent("Nora Écoffierresponsable")
    // 1.4.13 : Zoé n'a pas le niveau de l'équipe (une règle qui la nomme, posée plus haut) : « exception ».
    expect(membres.getAllByRole("listitem")[2]).toHaveTextContent("Zoé Arnaudexception")
    expect(membres.getAllByRole("listitem")[1]).not.toHaveTextContent("exception")
    const paul = membres.getByRole("combobox", { name: "Accès de Paul Henry" })
    expect(paul).toHaveValue("write")
    expect(libellesDesChoix(paul)).toEqual(["Accès complet", "Peut modifier", "Peut lire", "Aucun accès"])
    choisirDansLaListe(paul, "Peut lire")
    await waitFor(() => expect(rafraichir).toHaveBeenCalledTimes(1))
    expect(envoye()).toEqual({ url: "/api/platform/rules", methode: "POST", corps: { path: "ventes/modele_relance", subject: { kind: "user", id: PAUL }, level: "read" } })
  })

  it("should remove the member's own rule when the level chosen is the one they inherit, and post it otherwise", () => {
    const restreint = { ...people[1], level: "read" as const, ruleId: REGLE_PAUL }
    expect(envoiDuNiveau("ventes", restreint, "write")).toEqual({ methode: "DELETE", ressource: `rules/${REGLE_PAUL}` })
    expect(envoiDuNiveau("ventes", restreint, "none")).toEqual({ methode: "POST", ressource: "rules", corps: { path: "ventes", subject: { kind: "user", id: PAUL }, level: "none" } })
  })
})

describe("Partager, changing a level (AC-b5)", () => {
  it("should post the level chosen in the menu of a row, and remove the access on « Retirer », giving the focus to the list once the row is gone", async () => {
    repondre(() => reponse(200, { data: { rule: {} } }))
    const { panneau, relire } = ouvrir()
    choisirDansLaListe(panneau().getByRole("combobox", { name: "Accès de Léa Martin" }), "Peut modifier")
    await waitFor(() => expect(panneau().getByRole("status")).toHaveTextContent("Léa Martin : peut modifier."))
    expect(envoye()).toEqual({ url: "/api/platform/rules", methode: "POST", corps: { path: "ventes/modele_relance", subject: { kind: "user", id: LEA }, level: "write" } })

    const marc = panneau().getByRole("combobox", { name: "Accès de Marc Dupont" })
    marc.focus()
    choisirDansLaListe(marc, "Retirer")
    await waitFor(() => expect(panneau().getByRole("status")).toHaveTextContent("Marc Dupont n'a plus d'accès propre à ce contenu."))
    expect(envoye(1)).toEqual({ url: `/api/platform/rules/${REGLE_MARC}`, methode: "DELETE", corps: undefined })
    expect(rafraichir).toHaveBeenCalledTimes(2)

    // La relecture retire la ligne : le focus va à l'intitulé de la liste, jamais à `<body>`.
    relire({ regles: { data: { ...REGLES, rules: REGLES.rules.filter((regle) => regle.id !== REGLE_MARC) } } })
    await waitFor(() => expect(document.activeElement).toBe(panneau().getByRole("heading", { name: "Personnes et équipes ajoutées · 1" })))
  })

  it("should say a refusal and bring the menu back to the served level", async () => {
    repondre(() => reponse(403, { error: { code: "forbidden", message: "refused" } }))
    const { panneau } = ouvrir()
    const menu = panneau().getByRole("combobox", { name: "Accès de Léa Martin" })
    choisirDansLaListe(menu, "Peut modifier")
    expect(await panneau().findByRole("alert")).toHaveTextContent("Vous n'avez pas le droit de faire cela.")
    expect(menu).toHaveValue("read")
    expect(rafraichir).not.toHaveBeenCalled()
  })
})

describe("Partager sur le web (AC-d1)", () => {
  it("should create the public link, show it to copy, include the sub-contents, then disable it after a confirmation", async () => {
    let lien: ShareView | null = null
    api(({ url, methode, corps }) => {
      if (methode === "GET") return reponse(200, { data: { share: lien } })
      if (methode === "POST") {
        const reglage = typeof corps === "object" && corps !== null && "include_children" in corps ? corps.include_children === true : undefined
        lien = { ...LIEN, includeChildren: reglage ?? false }
        return reponse(url.endsWith("/shares") && reglage === undefined ? 201 : 200, { data: { share: lien, created: reglage === undefined } })
      }
      lien = null
      return reponse(200, { data: { id: LIEN_ID, path: CHEMIN } })
    })
    const { panneau } = ouvrir(SANS_AJOUT)

    const interrupteur = await panneau().findByRole("switch", { name: "Partager sur le web" })
    expect(interrupteur).toHaveAccessibleDescription("Toute personne qui a le lien lit la dernière version publiée, sans compte ; jamais indexé par un moteur de recherche.")
    expect(interrupteur).not.toBeChecked()
    expect(appels()[0]).toEqual({ url: LECTURE, methode: "GET", corps: undefined })
    expect(panneau().queryByRole("button", { name: "Copier le lien" })).toBeNull()

    fireEvent.click(interrupteur)
    await waitFor(() => expect(interrupteur).toBeChecked())
    // Désactivé pendant l'envoi, l'interrupteur reprend le focus une fois le lien créé.
    await waitFor(() => expect(document.activeElement).toBe(interrupteur))
    expect(appels()[1]).toEqual({ url: "/api/platform/shares", methode: "POST", corps: { path: CHEMIN } })
    expect(panneau().getByText(`${window.location.origin}/p/${JETON}`)).toBeInTheDocument()
    expect(panneau().getByRole("button", { name: "Copier le lien" })).toBeInTheDocument()
    expect(panneau().getByText("Lien public créé : copiez-le pour le partager.")).toHaveAttribute("role", "status")

    const sousContenus = panneau().getByRole("checkbox", { name: /Inclure les sous-contenus/ })
    expect(sousContenus).not.toBeChecked()
    sousContenus.focus()
    fireEvent.click(sousContenus)
    await waitFor(() => expect(sousContenus).toBeChecked())
    expect(appels()[2]).toEqual({ url: "/api/platform/shares", methode: "POST", corps: { path: CHEMIN, include_children: true } })
    await waitFor(() => expect(document.activeElement).toBe(interrupteur))

    // « Garder » referme la question et rend le focus à l'interrupteur, sans rien envoyer.
    fireEvent.click(panneau().getByRole("button", { name: "Désactiver le lien" }))
    fireEvent.click(within(panneau().getByRole("group", { name: /Désactiver ce lien/ })).getByRole("button", { name: "Garder" }))
    await waitFor(() => expect(document.activeElement).toBe(interrupteur))
    expect(panneau().queryByRole("group", { name: /Désactiver ce lien/ })).toBeNull()

    fireEvent.click(panneau().getByRole("button", { name: "Désactiver le lien" }))
    expect(appels()).toHaveLength(3)
    const question = panneau().getByRole("group", { name: /Désactiver ce lien/ })
    fireEvent.click(within(question).getByRole("button", { name: "Désactiver le lien" }))
    await waitFor(() => expect(interrupteur).not.toBeChecked())
    expect(appels()[3]).toEqual({ url: `/api/platform/shares/${LIEN_ID}`, methode: "DELETE", corps: undefined })
    expect(panneau().queryByText(`${window.location.origin}/p/${JETON}`)).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(interrupteur))
  })

  it("should read an active link at opening, with its sub-contents setting", async () => {
    api(() => reponse(200, { data: { share: { ...LIEN, includeChildren: true } } }))
    const { panneau } = ouvrir(SANS_AJOUT)
    expect(await panneau().findByRole("switch", { name: /Partager sur le web/ })).toBeChecked()
    expect(panneau().getByRole("checkbox", { name: /Inclure les sous-contenus/ })).toBeChecked()
  })

  it("should neither show the section nor read the link without full access", async () => {
    api(() => reponse(200, { data: { share: null } }))
    const { panneau } = ouvrir({ ...SANS_AJOUT, regles: { data: { ...REGLES_SANS_AJOUT, viewerLevel: 2 } } })
    expect(panneau().getByText("Seules les personnes qui ont l'accès complet changent le partage.")).toBeInTheDocument()
    expect(panneau().queryByRole("switch")).toBeNull()
    // Seule la lecture des niveaux de l'équipe part (1.4.13) : le lien public ne se lit pas.
    expect(appels()).toEqual([])
  })

  it.each([
    ["the structure of the tree", 400, "invalid_arguments", "Ce contenu ne se partage pas sur le web : la racine, Privé, un espace personnel, un Contexte et le dossier d'une équipe restent dans l'organisation."],
    ["the private space of another person", 403, "forbidden", "un contenu du Privé d'une autre personne ne se partage que par elle."],
  ])("should say the refusal of the service for %s, the switch left off", async (_cas, statut, code, phrase) => {
    api(({ methode }) => (methode === "GET" ? reponse(200, { data: { share: null } }) : reponse(statut, { error: { code, message: "refused" } })))
    const { panneau } = ouvrir(SANS_AJOUT)
    const interrupteur = await panneau().findByRole("switch", { name: /Partager sur le web/ })
    fireEvent.click(interrupteur)
    expect(await panneau().findByRole("alert")).toHaveTextContent(phrase)
    expect(interrupteur).not.toBeChecked()
    await waitFor(() => expect(document.activeElement).toBe(interrupteur))
  })

  it("should say a failed reading of the link, and read it again on « Réessayer »", async () => {
    let premier = true
    api(() => {
      if (!premier) return reponse(200, { data: { share: LIEN } })
      premier = false
      return reponse(500, { error: { code: "internal", message: "down" } })
    })
    const { panneau } = ouvrir(SANS_AJOUT)
    expect(await panneau().findByRole("alert")).toHaveTextContent("Une erreur est survenue. Réessayez.")
    fireEvent.click(panneau().getByRole("button", { name: "Réessayer" }))
    expect(await panneau().findByRole("switch", { name: /Partager sur le web/ })).toBeChecked()
    expect(panneau().queryByRole("alert")).toBeNull()
  })
})

// 1.4.13 : l'accès de toute l'organisation a sa ligne, à côté de celle de l'équipe ; « Aucun accès » le retire.
// L'accès complet offert à l'administrateur seul : « should list each added team or person… » et sa contre-épreuve, plus haut.
describe("Partager, access of the whole organisation (AC-b13)", () => {
  const partage = (general: NodeRulesView["general"], owner: NodeRulesView["owner"] = REGLES_SANS_AJOUT.owner, reglages: Partial<NodeRulesView> = {}) => ({
    ...SANS_AJOUT,
    regles: { data: { ...REGLES_SANS_AJOUT, owner, general, ...reglages } },
  })
  const organisation = (panneau: () => ReturnType<typeof within>) => panneau().getByRole("combobox", { name: "Niveau de toute l'organisation" })

  beforeEach(() => {
    api(({ methode }) => (methode === "GET" ? reponse(200, { data: { share: null } }) : reponse(200, { data: { changed: true } })))
  })

  const posts = () => appels().filter((appel) => appel.methode === "POST")

  it("should open a team's content to the whole organisation, change its level, then close it again", async () => {
    const { panneau, relire } = ouvrir(partage(null))
    expect(organisation(panneau)).toHaveValue("none")
    expect(libellesDesChoix(organisation(panneau))).toEqual(["Peut modifier", "Peut lire", "Aucun accès"])

    choisirDansLaListe(organisation(panneau), "Peut lire")
    await waitFor(() => expect(panneau().getAllByRole("status").at(-1)).toHaveTextContent("Toute l'organisation : peut lire."))
    expect(posts()[0]).toEqual({ url: "/api/platform/nodes/access", methode: "POST", corps: { path: CHEMIN, access: "organisation", level: "read" } })
    expect(rafraichir).toHaveBeenCalledTimes(1)

    relire(partage({ id: "r1", level: "read" }))
    choisirDansLaListe(organisation(panneau), "Peut modifier")
    await waitFor(() => expect(posts()).toHaveLength(2))
    expect(posts()[1].corps).toEqual({ path: CHEMIN, access: "organisation", level: "write" })

    choisirDansLaListe(organisation(panneau), "Aucun accès")
    await waitFor(() => expect(posts()).toHaveLength(3))
    expect(posts()[2].corps).toEqual({ path: CHEMIN, access: "restricted" })
  })

  // Un gestionnaire qui n'est pas administrateur ne pose pas l'accès complet, mais le lit quand il est servi.
  it("should show a served full access to a manager who is not an administrator, with its option", () => {
    const { panneau } = ouvrir({ ...partage({ id: "r1", level: "manage" }), gestionAccordable: false })
    expect(organisation(panneau)).toHaveValue("manage")
    expect(libellesDesChoix(organisation(panneau))).toEqual(["Accès complet", "Peut modifier", "Peut lire", "Aucun accès"])
  })

  it("should give a level in Tout le monde, where each member already reads, « Peut lire » removing the rule", async () => {
    const { panneau } = ouvrir(partage({ id: "r1", level: "write" }, { kind: "org" }))
    expect(panneau().queryByRole("combobox", { name: /Niveau de l'équipe/ })).toBeNull()
    expect(panneau().getByText("Dans Tout le monde, chaque membre lit au moins ce contenu.")).toBeInTheDocument()
    expect(organisation(panneau)).toHaveValue("write")
    expect(libellesDesChoix(organisation(panneau))).toEqual(["Peut modifier", "Peut lire"])
    choisirDansLaListe(organisation(panneau), "Peut lire")
    await waitFor(() => expect(posts()[0]?.corps).toEqual({ path: CHEMIN, access: "restricted" }))
  })

  // 1.4.13 : un dossier au-dessus ouvre la page ; la ligne le dit (« hérité »), « Aucun accès » pose une règle qui la ferme.
  it("should show the organisation's level inherited from a folder, and close the page with an explicit « Aucun accès »", async () => {
    api(({ url, methode }) =>
      url.startsWith("/api/platform/rules?")
        ? reponse(200, { data: { ...REGLES_SANS_AJOUT, organisation: { level: "read", inherited: "read" } } })
        : methode === "GET"
          ? reponse(200, { data: { share: null } })
          : reponse(200, { data: { changed: true } }),
    )
    const { panneau } = ouvrir(partage(null))
    await waitFor(() => expect(organisation(panneau)).toHaveValue("read"))
    expect(panneau().getByText("Toute l'organisation Démo").closest(".oto-pop-row")).toHaveTextContent("hérité")
    choisirDansLaListe(organisation(panneau), "Aucun accès")
    await waitFor(() => expect(posts()[0]?.corps).toEqual({ path: CHEMIN, access: "organisation", level: "none" }))
  })

  it.each([
    [403, "forbidden", "Vous ne pouvez pas changer l'accès général de ce contenu : il faut l'accès complet, et seul un administrateur ouvre l'accès complet à toute l'organisation."],
    [409, "conflict", "L'accès général a changé pendant votre geste : fermez puis rouvrez « Partager »."],
  ])("should say a refusal (%i %s) in the words of the general access, and keep the served access", async (statut, code, phrase) => {
    api(({ methode }) => (methode === "GET" ? reponse(200, { data: { share: null } }) : reponse(statut, { error: { code, message: "refused" } })))
    const { panneau } = ouvrir(partage(null))
    choisirDansLaListe(organisation(panneau), "Peut lire")
    expect(await panneau().findByRole("alert")).toHaveTextContent(phrase)
    expect(organisation(panneau)).toHaveValue("none")
    expect(rafraichir).not.toHaveBeenCalled()
  })
})
