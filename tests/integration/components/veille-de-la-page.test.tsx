// La veille d'une page ouverte (retour RET-008) : toutes les 30 secondes, onglet visible, l'écran relit la seule révision
// de la page ; changée ailleurs, la page se relit, ou, si la personne écrit, un bandeau propose de recharger ; un onglet
// caché ne lit rien. `fetch` simulé pour l'API, relecture fournie par le contexte de l'hôte.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ContexteDeRafraichissement } from "../../../packages/plateforme/ui/hote/rafraichir"
import { VEILLE_MS, VeilleDeLaPage } from "../../../packages/plateforme/ui/noeud/veille-de-la-page"

const fetchMock = vi.fn<typeof fetch>()
const rafraichir = vi.fn()
let visibilite: DocumentVisibilityState = "visible"

const revisionLue = (revision: number) =>
  fetchMock.mockImplementation(async () => new Response(JSON.stringify({ data: { path: "ventes/offre", revision } }), { status: 200, headers: { "content-type": "application/json" } }))

function monter() {
  return render(
    <ContexteDeRafraichissement.Provider value={rafraichir}>
      <textarea aria-label="Bloc" />
      <VeilleDeLaPage chemin="ventes/offre" revision={3} />
    </ContexteDeRafraichissement.Provider>,
  )
}

/** Un tour de veille : 30 secondes, puis les promesses de la lecture. */
const unTour = () => act(async () => vi.advanceTimersByTimeAsync(VEILLE_MS))

beforeEach(() => {
  vi.useFakeTimers()
  fetchMock.mockReset()
  rafraichir.mockReset()
  visibilite = "visible"
  vi.stubGlobal("fetch", fetchMock)
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibilite)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("VeilleDeLaPage", () => {
  it("should read only the revision every 30 seconds, and reread the page when it changed elsewhere", async () => {
    revisionLue(3)
    monter()
    await unTour()
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(["/api/platform/nodes/revision?path=ventes%2Foffre"])
    expect(rafraichir).not.toHaveBeenCalled()

    revisionLue(4)
    await unTour()
    expect(rafraichir).toHaveBeenCalledTimes(1)
    expect(screen.getByRole("status")).toBeEmptyDOMElement()
  })

  it("should replace nothing while the person writes, and offer to reload", async () => {
    revisionLue(4)
    monter()
    screen.getByRole("textbox", { name: "Bloc" }).focus()
    await unTour()
    expect(rafraichir).not.toHaveBeenCalled()
    expect(screen.getByRole("status")).toHaveTextContent("Cette page a été modifiée ailleurs, par un assistant ou une autre personne.")
    fireEvent.click(screen.getByRole("button", { name: "Recharger la page" }))
    expect(rafraichir).toHaveBeenCalledTimes(1)
  })

  it("should read nothing while the tab is hidden, and check at once on coming back", async () => {
    revisionLue(4)
    monter()
    visibilite = "hidden"
    await unTour()
    expect(fetchMock).not.toHaveBeenCalled()

    visibilite = "visible"
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(rafraichir).toHaveBeenCalledTimes(1)
  })
})
