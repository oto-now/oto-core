import type { ComponentProps, ReactNode } from "react"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { NodeRulesView, ShareView, TreeNode } from "@otomata_tech/oto_platform/schemas"
import { ContexteDeLHote, ContexteDeRafraichissement, EcranDeNoeud } from "@otomata_tech/oto_platform/ui"
import { choisirDansLaListe, libellesDesChoix } from "../../helpers/liste-de-choix"
import { vueDuNoeud } from "../../helpers/noeud"

// « Partager » après la partie d d'E05-S10 : « Partager sur le web » (AC-d1, ADR-013) pour qui a l'accès
// complet, et l'accès général qui se change (AC-b13, ADR-014). L'API simulée par `fetch`, la relecture
// espionnée ; les refus sont ceux des services (parties e), dits ici par l'écran.

type Props = ComponentProps<typeof EcranDeNoeud>

const CHEMIN = "ventes/modele_relance"
const JETON = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde"
const LIEN_ID = "9a8b7c6d-5e4f-4a3b-8c2d-000000000001"

const REGLES: NodeRulesView = {
  path: CHEMIN,
  title: "Modèle de relance",
  owner: { kind: "team", teamName: "Ventes", leadName: "Claire Morel" },
  viewerLevel: 3,
  rules: [],
  general: null,
}

const LIEN: ShareView = { id: LIEN_ID, path: CHEMIN, token: JETON, includeChildren: false, createdAt: "2026-09-27T08:00:00.000Z", createdByName: "Léa Martin" }

const ARBRE: TreeNode[] = [{ path: "ventes", kind: "page", title: "Ventes", status: "published", children: [] }]

const rafraichir = vi.fn()
const fetchMock = vi.fn<typeof fetch>()

function LienDeTest({ children, ...props }: { href: string; className?: string; children: ReactNode }) {
  return <a {...props}>{children}</a>
}

function ecran(partage: Partial<NonNullable<Props["partage"]>>) {
  return (
    <ContexteDeRafraichissement.Provider value={rafraichir}>
      <ContexteDeLHote.Provider value={{ Lien: "a", chemin: "", naviguer: vi.fn() }}>
        <EcranDeNoeud
          chemin={CHEMIN}
          noeud={{ data: vueDuNoeud() }}
          arbre={{ data: { tree: ARBRE, truncated: false } }}
          equipes={{ data: [{ slug: "ventes", name: "Ventes" }] }}
          handle="lea"
          nomOrganisation="Démo"
          versionPubliee={false}
          Lien={LienDeTest}
          hrefDuChemin={(chemin) => `/n/${chemin}`}
          prefixeDesPages="/n/"
          partage={{ regles: { data: REGLES }, sujets: { data: { equipes: [], personnes: [] } }, gestionAccordable: false, moi: null, ...partage }}
        />
      </ContexteDeLHote.Provider>
    </ContexteDeRafraichissement.Provider>
  )
}

function ouvrir(partage: Partial<NonNullable<Props["partage"]>> = {}) {
  const rendu = render(ecran(partage))
  fireEvent.click(screen.getByRole("button", { name: "Partager · Ventes" }))
  return { panneau: () => within(screen.getByRole("dialog", { name: "Partager — Ventes" })), relire: (suite: Partial<NonNullable<Props["partage"]>>) => rendu.rerender(ecran(suite)) }
}

function reponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

type Appel = { url: string; methode: string; corps: unknown }

/** L'API simulée, appel par appel : `repondre` reçoit l'URL, la méthode et le corps lu. */
function api(repondre: (appel: Appel) => Response) {
  fetchMock.mockImplementation(async (url, init) => repondre({ url: String(url), methode: init?.method ?? "GET", corps: init?.body ? JSON.parse(String(init.body)) : undefined }))
}

// La lecture des membres de l'équipe propriétaire (1.4.12), faite par « Partager » à l'ouverture : hors des appels comptés.
const appels = (): Appel[] => fetchMock.mock.calls.filter(([url]) => !String(url).startsWith("/api/platform/rules?")).map(([url, init]) => ({ url: String(url), methode: init?.method ?? "GET", corps: init?.body ? JSON.parse(String(init.body)) : undefined }))

const LECTURE = `/api/platform/shares?path=${encodeURIComponent(CHEMIN)}`

beforeEach(() => {
  fetchMock.mockReset()
  rafraichir.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
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
    const { panneau } = ouvrir()

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
    const { panneau } = ouvrir()
    expect(await panneau().findByRole("switch", { name: /Partager sur le web/ })).toBeChecked()
    expect(panneau().getByRole("checkbox", { name: /Inclure les sous-contenus/ })).toBeChecked()
  })

  it("should neither show the section nor read the link without full access", async () => {
    api(() => reponse(200, { data: { share: null } }))
    const { panneau } = ouvrir({ regles: { data: { ...REGLES, viewerLevel: 2 } } })
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
    const { panneau } = ouvrir()
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
    const { panneau } = ouvrir()
    expect(await panneau().findByRole("alert")).toHaveTextContent("Une erreur est survenue. Réessayez.")
    fireEvent.click(panneau().getByRole("button", { name: "Réessayer" }))
    expect(await panneau().findByRole("switch", { name: /Partager sur le web/ })).toBeChecked()
    expect(panneau().queryByRole("alert")).toBeNull()
  })
})

// 1.4.13 : l'accès de toute l'organisation a sa ligne, à côté de celle de l'équipe ; « Aucun accès » le retire.
describe("Partager, access of the whole organisation (AC-b13)", () => {
  const partage = (general: NodeRulesView["general"], owner: NodeRulesView["owner"] = REGLES.owner, reglages: Partial<NodeRulesView> = {}) => ({ regles: { data: { ...REGLES, owner, general, ...reglages } } })
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

  it("should offer full access to the whole organisation to an administrator only", () => {
    const { panneau } = ouvrir({ ...partage({ id: "r1", level: "write" }), gestionAccordable: true })
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
        ? reponse(200, { data: { ...REGLES, organisation: { level: "read", inherited: "read" } } })
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

  it("should keep a content of Privé closed to the organisation, saying why", () => {
    const { panneau } = ouvrir(partage(null, { kind: "user", userName: "Léa Martin" }))
    expect(panneau().queryByRole("combobox", { name: /toute l'organisation/ })).toBeNull()
    expect(panneau().getByText("Un contenu de Privé ne s'ouvre pas à toute l'organisation : ajoutez des personnes ou des équipes.")).toBeInTheDocument()
  })

  it("should show the organisation's access as a pill to someone without full access", () => {
    const { panneau } = ouvrir(partage({ id: "r1", level: "write" }, REGLES.owner, { viewerLevel: 2 }))
    expect(panneau().queryByRole("combobox")).toBeNull()
    expect(panneau().getByText("Toute l'organisation Démo").closest(".oto-pop-row")).toHaveTextContent("Toute l'organisation DémoPeut modifier")
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
