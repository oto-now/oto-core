// La carte « Reprendre » de l'accueil (1.4.13) : « Récents » ouvert par défaut sur « Mes équipes », la première page
// venue de l'hôte ; un autre onglet ou un autre filtre lu par `GET /api/platform/home`, « Voir plus » qui ajoute la page
// suivante ; les quatre états (lecture, échec et « Réessayer », vide, lignes). L'API simulée par `fetch`. Retours du 21/10 :
// les filtres sur la ligne des onglets, aussi pour le fil (`GET /api/platform/home/activities`) ; une ligne dit l'espace du
// contenu, jamais son chemin.
import type { AnchorHTMLAttributes } from "react"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { HomeContent, HomeContentsPage } from "@otomata_tech/oto_platform/schemas"
import { ContexteDeLHote } from "@otomata_tech/oto_platform/ui"
import { Reprendre } from "../../../packages/plateforme/ui/accueil/reprendre"

const MAINTENANT = new Date("2026-09-26T10:00:00Z")

const contenu = (rang: number, surcharge: Partial<HomeContent> = {}): HomeContent => ({
  path: `ventes/page_${rang}`,
  title: `Page ${rang}`,
  kind: "page",
  space: { kind: "team", name: "Ventes" },
  at: "2026-09-26T08:00:00Z",
  ...surcharge,
})

const fetchMock = vi.fn<typeof fetch>()

function reponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

function LienDeLHote({ href, children, ...reste }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return (
    <a href={href} data-lien="hote" {...reste}>
      {children}
    </a>
  )
}

function monter(premiere: { data: HomeContentsPage } | { error: string }) {
  render(
    <ContexteDeLHote.Provider value={{ Lien: LienDeLHote, chemin: "/", naviguer: vi.fn() }}>
      <Reprendre premiere={premiere} premierFil={{ data: { activities: [], truncated: false } }} moi="u-moi" hrefDuJournal="/journal" modeleDeConversation="/journal?conversation=OTOCODEDECONVERSATION" prefixeDesPages="/n/" />
    </ContexteDeLHote.Provider>,
  )
}

/** Les paramètres de chaque lecture de l'API, dans l'ordre. */
const lectures = () => fetchMock.mock.calls.map(([adresse]) => Object.fromEntries(new URL(String(adresse), "https://hote.test").searchParams))
const liens = () => screen.queryAllByRole("link").map((lien) => lien.getAttribute("href"))

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
  vi.useFakeTimers({ now: MAINTENANT, toFake: ["Date"] })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe("Reprendre, the card of the home (1.4.13)", () => {
  it("should open « Récents » on « Mes équipes » with the host's first page, each line opening its content, and add the next page on « Voir plus »", async () => {
    fetchMock.mockResolvedValue(reponse(200, { data: { items: [contenu(3)], hasMore: false } }))
    monter({ data: { items: [contenu(1), contenu(2, { space: { kind: "org" } })], hasMore: true } })

    expect(screen.getByRole("tab", { name: "Récents" })).toHaveAttribute("aria-selected", "true")
    expect(screen.getByRole("radio", { name: "Mes équipes" })).toBeChecked()
    expect(liens()).toEqual(["/n/ventes/page_1", "/n/ventes/page_2"])
    // Le titre, puis l'espace et la date : ni chemin, ni porte.
    expect(screen.getAllByRole("link")[0]).toHaveTextContent("Page 1Ventesil y a 2 heures")
    expect(screen.getAllByRole("link")[0]).not.toHaveTextContent("ventes/page_1")
    expect(screen.getAllByRole("link")[0]).toHaveAttribute("data-lien", "hote")
    expect(fetchMock).not.toHaveBeenCalled()

    // Le bouton reste là pendant la lecture, le focus avec lui ; la région de statut, montée vide, le dit.
    expect(screen.getByRole("status")).toBeEmptyDOMElement()
    const voirPlus = screen.getByRole("button", { name: "Voir plus" })
    voirPlus.focus()
    fireEvent.click(voirPlus)
    expect(voirPlus).toHaveAttribute("aria-busy", "true")
    expect(document.activeElement).toBe(voirPlus)
    expect(screen.getByRole("status")).toHaveTextContent("Chargement…")
    // Puis le focus va à la première ligne ajoutée : le bouton, sans suite, est parti.
    await waitFor(() => expect(liens()).toEqual(["/n/ventes/page_1", "/n/ventes/page_2", "/n/ventes/page_3"]))
    await waitFor(() => expect(document.activeElement).toBe(screen.getAllByRole("link")[2]))
    expect(lectures()).toEqual([{ tab: "recent", scope: "teams", offset: "2" }])
    expect(screen.queryByRole("button", { name: "Voir plus" })).toBeNull()
    expect(screen.getByRole("status")).toBeEmptyDOMElement()
  })

  it("should read another filter and the most consulted contents from the start, counting their consultations", async () => {
    fetchMock.mockImplementation(async (adresse) =>
      String(adresse).includes("tab=viewed")
        ? reponse(200, { data: { items: [contenu(9, { views: { screen: 4, assistant: 3 }, space: { kind: "user" } })], hasMore: false } })
        : reponse(200, { data: { items: [], hasMore: false } }),
    )
    monter({ data: { items: [contenu(1)], hasMore: false } })

    fireEvent.click(screen.getByRole("radio", { name: "Moi" }))
    expect(await screen.findByText("Aucun contenu modifié ici pour l'instant")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("tab", { name: "Les plus consultés" }))
    await waitFor(() => expect(liens()).toEqual(["/n/ventes/page_9"]))
    expect(screen.getByRole("link")).toHaveTextContent("Privé · 7 consultations")
    expect(lectures()).toEqual([
      { tab: "recent", scope: "me", offset: "0" },
      { tab: "viewed", scope: "me", offset: "0" },
    ])
  })

  it("should keep the contents of the last filter chosen when an earlier reading answers late", async () => {
    let repondreMoi: (reponse: Response) => void = () => {}
    fetchMock.mockImplementation((adresse) =>
      String(adresse).includes("scope=me")
        ? new Promise<Response>((resoudre) => {
            repondreMoi = resoudre
          })
        : Promise.resolve(reponse(200, { data: { items: [contenu(7)], hasMore: false } })),
    )
    monter({ data: { items: [contenu(1)], hasMore: false } })

    fireEvent.click(screen.getByRole("radio", { name: "Moi" }))
    fireEvent.click(screen.getByRole("radio", { name: "Toute l'organisation" }))
    await waitFor(() => expect(liens()).toEqual(["/n/ventes/page_7"]))
    // La lecture de « Moi » répond après : elle ne remplace rien.
    await act(async () => {
      repondreMoi(reponse(200, { data: { items: [contenu(3)], hasMore: false } }))
    })
    expect(liens()).toEqual(["/n/ventes/page_7"])
    expect(screen.getByRole("radio", { name: "Toute l'organisation" })).toBeChecked()
  })

  it("should show the host's feed of « Mes équipes » in « Fil », then read another filter of the feed by the API", async () => {
    fetchMock.mockResolvedValue(
      reponse(200, {
        data: {
          truncated: false,
          activities: [{ id: 3, at: "2026-09-26T08:00:00Z", userId: "u-moi", userName: "Léa Roux", verb: "edited", kind: "page", path: "ventes/tarifs", title: "Tarifs", count: 1, ctx: null }],
        },
      }),
    )
    monter({ data: { items: [contenu(1)], hasMore: false } })

    fireEvent.click(screen.getByRole("tab", { name: "Fil" }))
    expect(screen.getByText("Aucune activité cette semaine")).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
    // Les filtres restent sur la ligne des onglets, et filtrent aussi le fil.
    fireEvent.click(screen.getByRole("radio", { name: "Moi" }))
    await waitFor(() => expect(screen.getByRole("link", { name: /Vous avez modifié la page Tarifs/ })).toHaveAttribute("href", "/n/ventes/tarifs"))
    expect(fetchMock.mock.calls.map(([adresse]) => String(adresse))).toEqual(["/api/platform/home/activities?scope=me"])
  })

  it("should put the filters on the line of the tabs, after them and before the panel", () => {
    monter({ data: { items: [contenu(1)], hasMore: false } })

    const ligne = document.querySelector(".oto-tabs-row")
    expect(ligne?.querySelector("[role=tablist]")).not.toBeNull()
    expect(ligne?.querySelector("[role=radiogroup]")).not.toBeNull()
    const [onglets, filtres, panneau] = [screen.getByRole("tablist"), screen.getByRole("radiogroup"), screen.getByRole("tabpanel")]
    expect(onglets.compareDocumentPosition(filtres) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(filtres.compareDocumentPosition(panneau) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("should say a failed first page with « Réessayer », which reads it again by the API", async () => {
    fetchMock.mockResolvedValue(reponse(200, { data: { items: [contenu(1)], hasMore: false } }))
    monter({ error: "Une erreur est survenue. Réessayez." })

    expect(screen.getByRole("alert")).toHaveTextContent("Une erreur est survenue. Réessayez.")
    const reessayer = screen.getByRole("button", { name: "Réessayer" })
    reessayer.focus()
    fireEvent.click(reessayer)
    expect(screen.getByRole("status")).toHaveTextContent("Chargement…")
    expect(document.activeElement).toBe(reessayer)
    await waitFor(() => expect(liens()).toEqual(["/n/ventes/page_1"]))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("link")))
    expect(lectures()).toEqual([{ tab: "recent", scope: "teams", offset: "0" }])
    expect(screen.getByRole("alert")).toBeEmptyDOMElement()
  })

  it("should keep the lines read and say a refused next page", async () => {
    fetchMock.mockResolvedValue(reponse(500, { error: { code: "internal", message: "boom" } }))
    monter({ data: { items: [contenu(1)], hasMore: true } })

    const voirPlus = screen.getByRole("button", { name: "Voir plus" })
    voirPlus.focus()
    fireEvent.click(voirPlus)
    await waitFor(() => expect(screen.getByRole("alert")).not.toBeEmptyDOMElement())
    expect(liens()).toEqual(["/n/ventes/page_1"])
    // Le même bouton devient « Réessayer » : le focus ne le quitte pas.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Réessayer" }))
  })
})
