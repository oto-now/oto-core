import type { ReactNode } from "react"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ActionPlateforme, ContexteDeRafraichissement } from "@otomata_tech/oto_platform/ui"

// Le geste confirmé en ligne (E05-S03, AC20), le repli du focus sur l'ancre de la liste
// (`accessibility-patterns.md § Focus Management`) et la relecture fournie par l'hôte (AC3) : `fetch`
// simulé pour l'API, `location` simulée pour le repli sans fournisseur.

const fetchMock = vi.fn<typeof fetch>()
const reload = vi.fn()
const rafraichir = vi.fn()

function reponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

const SUPPRIMER = {
  libelle: "Supprimer l'équipe",
  nomAccessible: "Supprimer l'équipe Ventes",
  requete: { methode: "DELETE" as const, ressource: "teams/0e8e5a3c-7f10-4a5b-8d3b-2b1c4d5e6f70" },
  confirmation: { question: "Supprimer l'équipe Ventes ? Ses membres la quittent et ses règles d'accès tombent.", libelleConfirmer: "Supprimer l'équipe" },
  ancre: "equipes-liste",
  messages: { team_owns_objects: "Ventes possède encore : {objets}. Transférez-les ou supprimez-les avant de supprimer l'équipe." },
}

/** Le titre de la liste, comme l'écran le pose : l'ancre du geste. */
function Liste({ children }: { children: ReactNode }) {
  return (
    <section>
      <h2 id={SUPPRIMER.ancre} tabIndex={-1}>
        Les équipes de Démo
      </h2>
      {children}
    </section>
  )
}

function rendre(props: Partial<Parameters<typeof ActionPlateforme>[0]> = {}) {
  return render(
    <ContexteDeRafraichissement.Provider value={rafraichir}>
      <Liste>
        <ActionPlateforme {...SUPPRIMER} {...props} />
      </Liste>
    </ContexteDeRafraichissement.Provider>,
  )
}

const depart = () => screen.getByRole("button", { name: SUPPRIMER.nomAccessible })
const ancre = () => screen.getByRole("heading", { name: "Les équipes de Démo" })

beforeEach(() => {
  fetchMock.mockReset()
  reload.mockReset()
  rafraichir.mockReset()
  vi.stubGlobal("fetch", fetchMock)
  vi.stubGlobal("location", { ...window.location, reload })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("ActionPlateforme confirmation (AC20)", () => {
  it("should put the question in place of the button, « Garder » focused before the confirmation", () => {
    rendre()

    fireEvent.click(depart())

    expect(screen.getByRole("group", { name: SUPPRIMER.confirmation.question })).toBeInTheDocument()
    const boutons = screen.getAllByRole("button")
    expect(boutons.map((bouton) => bouton.textContent)).toEqual(["Garder", "Supprimer l'équipe"])
    expect(boutons[0]).toHaveFocus()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("should give the button and the focus back on « Garder »", () => {
    rendre()
    fireEvent.click(depart())

    fireEvent.click(screen.getByRole("button", { name: "Garder" }))

    expect(screen.queryByRole("group")).toBeNull()
    expect(depart()).toHaveFocus()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("should give the button and the focus back on Escape", () => {
    rendre()
    fireEvent.click(depart())

    fireEvent.keyDown(screen.getByRole("button", { name: "Garder" }), { key: "Escape" })

    expect(screen.queryByRole("group")).toBeNull()
    expect(depart()).toHaveFocus()
  })

  it("should disable the confirmation while sending, busy, and send once whatever the clicks", async () => {
    let terminer: (value: Response) => void = () => {}
    fetchMock.mockReturnValue(new Promise<Response>((resolve) => (terminer = resolve)))
    rendre()
    fireEvent.click(depart())
    const confirmer = screen.getAllByRole("button")[1]

    fireEvent.click(confirmer)
    fireEvent.click(confirmer)

    await waitFor(() => expect(confirmer).toBeDisabled())
    expect(confirmer).toHaveAttribute("aria-busy", "true")
    expect(screen.getByRole("button", { name: "Garder" })).toBeDisabled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await act(async () => terminer(reponse(200, { data: { team: {} } })))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("should send the request of the gesture and have the host re-read the page after a success (AC3)", async () => {
    fetchMock.mockResolvedValue(reponse(200, { data: { team: {} } }))
    rendre()
    fireEvent.click(depart())

    fireEvent.click(screen.getAllByRole("button")[1])

    await waitFor(() => expect(rafraichir).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`/api/platform/${SUPPRIMER.requete.ressource}`)
    expect(init?.method).toBe("DELETE")
    expect(reload).not.toHaveBeenCalled()
  })

  it("should show a refusal as an alert under the gesture, with the phrase of the gesture and what blocks, the focus back on the button", async () => {
    fetchMock.mockResolvedValue(
      reponse(409, {
        error: {
          code: "conflict",
          message: "Team Ventes still owns nodes or accounts.",
          details: { reason: "team_owns_objects", nodes: ["ventes/suivi_prospects"], accounts: ["Mail Ventes"], nodesTotal: 1, accountsTotal: 1 },
        },
      }),
    )
    rendre()
    fireEvent.click(depart())

    fireEvent.click(screen.getAllByRole("button")[1])

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Ventes possède encore : ventes/suivi_prospects (nœud) ; Mail Ventes (compte). Transférez-les ou supprimez-les avant de supprimer l'équipe.",
    )
    expect(depart()).toBeEnabled()
    await waitFor(() => expect(depart()).toHaveFocus())
    expect(rafraichir).not.toHaveBeenCalled()
  })

  it("should name the starting button after its line, then send once through the confirmation, busy meanwhile", async () => {
    let terminer: (value: Response) => void = () => {}
    fetchMock.mockReturnValue(new Promise<Response>((resolve) => (terminer = resolve)))
    rendre({
      libelle: "Retirer",
      nomAccessible: "Retirer (Léa Roux)",
      confirmation: { question: "Retirer Léa Roux de Ventes ?", libelleConfirmer: "Retirer de Ventes" },
    })

    fireEvent.click(screen.getByRole("button", { name: "Retirer (Léa Roux)" }))
    fireEvent.click(screen.getByRole("button", { name: "Retirer de Ventes" }))

    await waitFor(() => expect(screen.getByRole("button", { name: "Retirer de Ventes" })).toHaveAttribute("aria-busy", "true"))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await act(async () => terminer(reponse(200, { data: {} })))
    await waitFor(() => expect(rafraichir).toHaveBeenCalledTimes(1))
  })

  // Le focus en encre (AC21) vient du `Button` du design system, comme sa forme et sa taille.
  it("should render every button as the design system's Button, at the size it is given", () => {
    rendre()
    expect(depart()).toHaveClass("oto-btn")
    expect(depart()).toHaveAttribute("data-size", "md")
    cleanup()
    rendre({ taille: "sm" })
    fireEvent.click(depart())
    const boutons = screen.getAllByRole("button")
    expect(boutons.map((bouton) => [bouton.textContent, bouton.className.includes("oto-btn"), bouton.dataset.size])).toEqual([
      ["Garder", true, "sm"],
      ["Supprimer l'équipe", true, "sm"],
    ])
  })
})

describe("ActionPlateforme focus after a success (accessibility-patterns § Focus Management)", () => {
  it("should move the focus to the anchor of its list before the host re-reads the page, never to <body>", async () => {
    fetchMock.mockResolvedValue(reponse(200, { data: { team: {} } }))
    let focusALaRelecture: Element | null = null
    rafraichir.mockImplementation(() => {
      focusALaRelecture = document.activeElement
    })
    rendre()
    fireEvent.click(depart())

    fireEvent.click(screen.getAllByRole("button")[1])

    await waitFor(() => expect(rafraichir).toHaveBeenCalledTimes(1))
    expect(focusALaRelecture).toBe(ancre())
    await waitFor(() => expect(ancre()).toHaveFocus())
  })

  it("should leave the focus where the person moved it while the request was running", async () => {
    let terminer: (value: Response) => void = () => {}
    fetchMock.mockReturnValue(new Promise<Response>((resolve) => (terminer = resolve)))
    render(
      <ContexteDeRafraichissement.Provider value={rafraichir}>
        <Liste>
          <ActionPlateforme {...SUPPRIMER} />
          <button type="button">Ailleurs</button>
        </Liste>
      </ContexteDeRafraichissement.Provider>,
    )
    fireEvent.click(depart())
    fireEvent.click(screen.getByRole("button", { name: "Supprimer l'équipe" }))
    const ailleurs = screen.getByRole("button", { name: "Ailleurs" })

    ailleurs.focus()
    await act(async () => terminer(reponse(200, { data: { team: {} } })))

    // Le focus se décide juste avant la relecture : une fois l'hôte appelé, il ne bouge plus.
    await waitFor(() => expect(rafraichir).toHaveBeenCalledTimes(1))
    expect(ailleurs).toHaveFocus()
  })
})

describe("ActionPlateforme after a not_found refusal (AC6)", () => {
  it("should say the refusal, give the focus to the anchor, then have the host re-read the page: the line is gone", async () => {
    fetchMock.mockResolvedValue(reponse(404, { error: { code: "not_found", message: "No team." } }))
    let aLaRelecture: { alerte: string | null | undefined; focus: Element | null } | undefined
    rafraichir.mockImplementation(() => {
      aLaRelecture = { alerte: screen.queryByRole("alert")?.textContent, focus: document.activeElement }
    })
    rendre({ messages: { not_found: "Cette équipe n'existe plus." } })
    fireEvent.click(depart())

    fireEvent.click(screen.getAllByRole("button")[1])

    // L'alerte est rendue, donc annoncée, avant la relecture qui emporte la ligne et l'alerte avec elle.
    await waitFor(() => expect(rafraichir).toHaveBeenCalledTimes(1))
    expect(aLaRelecture).toEqual({ alerte: "Cette équipe n'existe plus.", focus: ancre() })
  })

  it("should not re-read after another refusal, the line staying", async () => {
    fetchMock.mockResolvedValue(reponse(403, { error: { code: "forbidden", message: "No." } }))
    rendre()
    fireEvent.click(depart())

    fireEvent.click(screen.getAllByRole("button")[1])

    expect(await screen.findByRole("alert")).toHaveTextContent("Vous n'avez pas le droit de faire cela.")
    await waitFor(() => expect(depart()).toHaveFocus())
    expect(rafraichir).not.toHaveBeenCalled()
  })
})

describe("re-reading without a host provider (AC3)", () => {
  it("should reload the page when no provider is mounted", async () => {
    fetchMock.mockResolvedValue(reponse(200, { data: {} }))
    render(
      <Liste>
        <ActionPlateforme {...SUPPRIMER} />
      </Liste>,
    )

    fireEvent.click(depart())
    fireEvent.click(screen.getByRole("button", { name: "Supprimer l'équipe" }))

    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
  })
})
