// L'écran « Corbeille » (E05-S10, partie b2, AC-b11) : ce que `listTrash` rend, en table (titre, type, date,
// nombre de contenus, date de purge) ; vide et échec dits ; « Restaurer » par `POST trash/restore`, puis le
// contenu restauré s'ouvre à l'adresse que le service rend et la page se relit ; un refus se dit sous le
// bouton. L'hôte est simulé par ce qu'il prête (`ContexteDeLHote`, la relecture) ; l'API, par `fetch`.
import type { ComponentProps } from "react"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { TrashItem } from "@otomata_tech/oto_platform/schemas"
import { ContexteDeLHote, ContexteDeRafraichissement, CoquilleOto, EcranDeLaCorbeille } from "@otomata_tech/oto_platform/ui"

const hote = vi.hoisted(() => ({ naviguer: vi.fn(), rafraichir: vi.fn() }))

const ITEMS: TrashItem[] = [
  { path: "conseil", title: "Conseil", kind: "page", deletedAt: "2026-09-20T08:00:00Z", count: 3, purgeAt: "2026-10-20T08:00:00Z" },
  { path: "ventes/grille", title: "Grille tarifaire", kind: "table", deletedAt: "2026-09-26T08:00:00Z", count: 1, purgeAt: "2026-10-26T08:00:00Z" },
]

function monter(resultat: ComponentProps<typeof EcranDeLaCorbeille>["resultat"]) {
  render(
    <CoquilleOto>
      <ContexteDeRafraichissement.Provider value={hote.rafraichir}>
        <ContexteDeLHote.Provider value={{ Lien: "a", chemin: "/trash", naviguer: hote.naviguer }}>
          <EcranDeLaCorbeille resultat={resultat} prefixeDesPages="/n/" />
        </ContexteDeLHote.Provider>
      </ContexteDeRafraichissement.Provider>
    </CoquilleOto>,
  )
}

type Reponse = { data: unknown } | { error: { code: string; message: string } }

function simulerLAPI(reponse: Reponse, statut = 200) {
  const appels: { url: string; corps: unknown }[] = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      appels.push({ url, corps: init?.body ? JSON.parse(String(init.body)) : undefined })
      return new Response(JSON.stringify(reponse), { status: statut, headers: { "content-type": "application/json" } })
    }),
  )
  return appels
}

beforeEach(() => vi.clearAllMocks())

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("EcranDeLaCorbeille (AC-b11)", () => {
  it("should list each content in the bin with its type, its date, what went with it and its purge date", () => {
    monter({ data: ITEMS })

    expect(screen.getByRole("heading", { level: 1, name: "Corbeille" })).toBeInTheDocument()
    const lignes = within(screen.getByRole("table", { name: "Les contenus à la corbeille" })).getAllByRole("row").slice(1)
    expect(lignes.map((ligne) => within(ligne).getAllByRole("cell").slice(0, 5).map((cellule) => cellule.textContent))).toEqual([
      ["Conseilconseil", "Page", "20 septembre 2026", "3 (avec 2 dessous)", "20 octobre 2026"],
      ["Grille tarifaireventes/grille", "Tableau", "26 septembre 2026", "1", "26 octobre 2026"],
    ])
    expect(screen.getByRole("button", { name: "Restaurer « Grille tarifaire »" })).toBeInTheDocument()
  })

  it("should say an empty bin in one sentence, and a failed read with « Réessayer »", () => {
    monter({ data: [] })
    expect(screen.getByText("La corbeille est vide.")).toBeInTheDocument()
    expect(screen.queryByRole("table")).toBeNull()
    cleanup()

    monter({ error: "Votre session a expiré. Reconnectez-vous." })
    const alerte = screen.getByRole("alert")
    expect(alerte).toHaveTextContent("Votre session a expiré. Reconnectez-vous.")
    fireEvent.click(within(alerte).getByRole("button", { name: "Réessayer" }))
    expect(hote.rafraichir).toHaveBeenCalledTimes(1)
  })

  it("should restore a content through the restore service, then open it where the service put it and re-read the page", async () => {
    const appels = simulerLAPI({ data: { path: "ventes/grille_2", from: "ventes/grille", count: 1 } })
    monter({ data: ITEMS })
    fireEvent.click(screen.getByRole("button", { name: "Restaurer « Grille tarifaire »" }))

    await waitFor(() => expect(hote.naviguer).toHaveBeenCalledWith("/n/ventes/grille_2"))
    expect(hote.rafraichir).toHaveBeenCalledTimes(1)
    expect(appels).toEqual([{ url: "/api/platform/trash/restore", corps: { path: "ventes/grille" } }])
  })

  it("should say a refusal under the button, give it the focus back, open nothing, and re-read the page when the content left the bin", async () => {
    simulerLAPI({ error: { code: "forbidden", message: "Only a manager can restore." } }, 403)
    monter({ data: ITEMS })
    const restaurer = screen.getByRole("button", { name: "Restaurer « Conseil »" })
    fireEvent.click(restaurer)
    expect(await screen.findByRole("alert")).toHaveTextContent("Restaurer ce contenu vous est refusé : il faut sa gestion, et pouvoir écrire là où il revient.")
    // Désactivé pendant l'envoi, le bouton retrouve le focus après le refus, que `fetch` rend sans attendre.
    await waitFor(() => expect(document.activeElement).toBe(restaurer))
    expect(hote.naviguer).not.toHaveBeenCalled()
    expect(hote.rafraichir).not.toHaveBeenCalled()
    cleanup()

    simulerLAPI({ error: { code: "not_found", message: "conseil is not in the bin." } }, 404)
    monter({ data: ITEMS })
    fireEvent.click(screen.getByRole("button", { name: "Restaurer « Conseil »" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Ce contenu n'est plus dans la corbeille : il a été restauré ou purgé.")
    expect(hote.rafraichir).toHaveBeenCalledTimes(1)
  })
})
