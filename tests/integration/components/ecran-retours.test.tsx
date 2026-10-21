import type { AnchorHTMLAttributes } from "react"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { feedbackListQuerySchema, type FeedbackList, type FeedbackListQuery, type FeedbackTicketView } from "@otomata_tech/oto_platform/schemas"
import { ContexteDeLHote, ContexteDeRafraichissement, EcranRetours, EcranRetoursChargement, type EcranRetoursProps } from "@otomata_tech/oto_platform/ui"

// L'écran « Retours des assistants » (E08-S09 : AC9, AC10, AC15), porté sur le design system d'oto-frontend
// (E05-S09 partie d2 : `signaux-du-suivi.tsx`, `fenetre-du-suivi.tsx`), sur des données en mémoire rendues comme
// la page de l'hôte les passe ; `fetch` simulé pour l'API, relecture et navigation de l'hôte fournies par des
// espions.

const fetchMock = vi.fn<typeof fetch>()
const rafraichir = vi.fn()
const naviguer = vi.fn()

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

function reponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

const OUVERT: FeedbackTicketView = {
  ticket: "FB-0012",
  number: 12,
  createdAt: "2026-09-23T12:02:07.000Z",
  person: "Léa Roux",
  type: "error",
  target: "table.write",
  text: "L'écriture dans le tableau des prospects a été refusée sans dire quelle valeur posait problème.",
  state: "open",
  resolution: null,
  handledBy: null,
  handledAt: null,
  ctx: "DEMO-0003",
}
const PRIS: FeedbackTicketView = { ...OUVERT, ticket: "FB-0011", number: 11, type: "gap", target: null, text: "x".repeat(250), state: "acknowledged", handledBy: "Ada Martin", handledAt: "2026-09-24T08:00:00.000Z", ctx: null }
const DECLINE: FeedbackTicketView = { ...OUVERT, ticket: "FB-0010", number: 10, person: null, state: "declined", resolution: "Hors périmètre du pilote.", handledBy: null, handledAt: "2026-09-24T08:00:00.000Z" }

const LISTE: FeedbackList = { tickets: [OUVERT, PRIS, DECLINE], counts: { open: 2, acknowledged: 1, resolved: 0, declined: 3 }, nextCursor: "suite-2" }
const RIEN: FeedbackList = { tickets: [], counts: { open: 0, acknowledged: 0, resolved: 0, declined: 0 }, nextCursor: null }

function LienDeTest({ children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return <a {...props}>{children}</a>
}

function hrefDeFiltre(parametres: FeedbackListQuery): string {
  const recherche = new URLSearchParams({ state: parametres.state, period: String(parametres.period) })
  if (parametres.type) recherche.set("type", parametres.type)
  if (parametres.cursor) recherche.set("cursor", parametres.cursor)
  return `/admin/feedback?${recherche}`
}

function rendre(resultat: EcranRetoursProps["resultat"], adresse: Record<string, string> = {}) {
  return render(
    <ContexteDeLHote.Provider value={{ Lien: LienDeTest, chemin: "/admin/feedback", naviguer }}>
      <ContexteDeRafraichissement.Provider value={rafraichir}>
        <EcranRetours
          resultat={resultat}
          filtres={feedbackListQuerySchema.parse(adresse)}
          Lien={LienDeTest}
          hrefDeFiltre={hrefDeFiltre}
          hrefDeConversation={(code, periode) => `/journal?conversation=${code}&period=${periode}`}
        />
      </ContexteDeRafraichissement.Provider>
    </ContexteDeLHote.Provider>,
  )
}

/** La ligne d'un ticket, trouvée par sa première cellule. */
function ligne(ticket: string): HTMLElement {
  const rangee = screen.getByRole("cell", { name: ticket }).closest("tr")
  if (!rangee) throw new Error(`no row for ${ticket}`)
  return rangee
}
/** Les choix d'un filtre segmenté : leur libellé et s'ils sont cochés. */
const choix = (groupe: string) =>
  within(screen.getByRole("radiogroup", { name: groupe }))
    .getAllByRole("radio")
    .map((radio) => [radio.textContent, radio.getAttribute("aria-checked")])
/** Choisit un filtre et rend l'adresse que l'hôte a ouverte. */
function adresseDuChoix(groupe: string, libelle: string): string {
  naviguer.mockReset()
  fireEvent.click(within(screen.getByRole("radiogroup", { name: groupe })).getByRole("radio", { name: libelle }))
  return String(naviguer.mock.calls[0]?.[0])
}
/** Le titre de la liste, ancre du focus quand un geste part avec la relecture. */
const titreDeLaListe = () => screen.getByRole("heading", { level: 2, name: "Retours, le plus récent d'abord" })

describe("EcranRetours states (AC15)", () => {
  it("should render the loading state as a busy status", () => {
    render(<EcranRetoursChargement />)
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true")
    expect(screen.getByText("Chargement des retours…")).toHaveClass("oto-sr-only")
  })

  it("should say a failed read once, with « Réessayer » to the same address", () => {
    rendre({ error: "Une erreur est survenue. Réessayez." }, { state: "all", type: "gap", period: "7" })
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Retours des assistants")
    expect(screen.getByRole("alert")).toHaveTextContent("Une erreur est survenue. Réessayez.")
    expect(screen.getByRole("link", { name: "Réessayer" })).toHaveAttribute("href", "/admin/feedback?state=all&period=7&type=gap")
    expect(screen.queryByRole("radiogroup")).toBeNull()
  })
})

describe("EcranRetours list (AC9)", () => {
  it("should count by state, offer the filters as segmented choices opening their address, and show one row per ticket with its conversation", () => {
    rendre({ data: LISTE }, { type: "error" })
    expect(screen.getByText("2 ouverts · 1 pris en compte · 0 résolu · 3 déclinés")).toBeInTheDocument()
    expect(choix("Filtrer par état")).toEqual([
      ["À traiter", "true"],
      ["Ouverts", "false"],
      ["Pris en compte", "false"],
      ["Résolus", "false"],
      ["Déclinés", "false"],
      ["Tous", "false"],
    ])
    expect(adresseDuChoix("Filtrer par état", "Déclinés")).toBe("/admin/feedback?state=declined&period=30&type=error")
    expect(choix("Filtrer par type")).toEqual([
      ["Tous les types", "false"],
      ["Friction", "false"],
      ["Manque", "false"],
      ["Erreur", "true"],
    ])
    expect(adresseDuChoix("Filtrer par type", "Tous les types")).toBe("/admin/feedback?state=to_handle&period=30")
    expect(choix("La période observée")[1]).toEqual(["30 jours", "true"])
    expect(adresseDuChoix("La période observée", "7 jours")).toBe("/admin/feedback?state=to_handle&period=7&type=error")

    const tableau = screen.getByRole("table", { name: "Retours, le plus récent d'abord" })
    expect(within(tableau).getAllByRole("columnheader").map((entete) => entete.textContent)).toEqual([
      "Ticket",
      "Quand",
      "Personne",
      "Type",
      "À propos de",
      "Ce qui a été écrit",
      "État",
      "Réponse",
      "Traité par",
      "Conversation",
      "Traiter",
    ])
    expect(within(ligne("FB-0012")).getAllByRole("cell").slice(0, 10).map((cellule) => cellule.textContent)).toEqual([
      "FB-0012",
      "23 septembre 2026 à 14:02",
      "Léa Roux",
      "Erreur",
      "table.write",
      OUVERT.text,
      "Ouvert",
      "—",
      "—",
      "Voir la conversation du retour FB-0012",
    ])
    expect(within(ligne("FB-0012")).getByRole("link", { name: "Voir la conversation du retour FB-0012" })).toHaveAttribute("href", "/journal?conversation=DEMO-0003&period=30")
    // Au-delà de 200 caractères : un aperçu, puis « Lire tout ».
    const pris = within(ligne("FB-0011")).getAllByRole("cell")
    expect(pris[5].querySelector("details summary")).toHaveTextContent("Lire tout")
    expect(pris[5].querySelector("details > span")).toHaveTextContent("x".repeat(250))
    expect(pris.slice(6, 10).map((cellule) => cellule.textContent)).toEqual(["Pris en compte", "—", "Ada Martin, le 24 septembre 2026", "—"])
    expect(within(ligne("FB-0010")).getAllByRole("cell").slice(6, 9).map((cellule) => cellule.textContent)).toEqual([
      "Décliné",
      "Hors périmètre du pilote.",
      "Hors de l'organisation, le 24 septembre 2026",
    ])
    expect(screen.getByRole("link", { name: "Voir les suivants" })).toHaveAttribute("href", "/admin/feedback?state=to_handle&period=30&type=error&cursor=suite-2")
  })

  it("should say an empty period without a filter, and offer every ticket when a filter hides them", () => {
    rendre({ data: RIEN })
    expect(screen.getByText("Aucun retour sur cette période. Cela ne veut pas dire que rien ne manque : c'est une mesure de ce qui remonte.")).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "Voir tous les retours" })).toBeNull()
    cleanup()

    rendre({ data: { ...RIEN, counts: { ...RIEN.counts, resolved: 2 } } })
    expect(screen.getByText("Aucun retour ne correspond à ce filtre.")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Voir tous les retours" })).toHaveAttribute("href", "/admin/feedback?state=all&period=30")
  })
})

describe("EcranRetours gestures (AC10)", () => {
  const gestes = (ticket: string) => within(within(ligne(ticket)).getAllByRole("cell")[10]).getAllByRole("button").map((bouton) => bouton.getAttribute("aria-label"))

  it("should offer the gestures of each state", () => {
    rendre({ data: LISTE })
    expect(gestes("FB-0012")).toEqual(["Prendre en compte FB-0012", "Résoudre FB-0012", "Décliner FB-0012"])
    expect(gestes("FB-0011")).toEqual(["Résoudre FB-0011", "Décliner FB-0011", "Rouvrir FB-0011"])
    expect(gestes("FB-0010")).toEqual(["Rouvrir FB-0010"])
  })

  it("should send « Prendre en compte » without a question, then move the focus to the list and have the page re-read", async () => {
    fetchMock.mockResolvedValue(reponse(200, { data: { ...OUVERT, state: "acknowledged" } }))
    let focusALaRelecture: Element | null = null
    rafraichir.mockImplementation(() => {
      focusALaRelecture = document.activeElement
    })
    rendre({ data: LISTE })
    const geste = screen.getByRole("button", { name: "Prendre en compte FB-0012" })
    geste.focus()

    fireEvent.click(geste)

    await waitFor(() => expect(rafraichir).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0]
    expect([url, init?.method, init?.body]).toEqual(["/api/platform/feedback/FB-0012", "PATCH", JSON.stringify({ state: "acknowledged" })])
    expect(focusALaRelecture).toBe(titreDeLaListe())
  })

  it("should decline with a reason read by the reporter, 3 characters at least, then move the focus to the list", async () => {
    fetchMock.mockResolvedValue(reponse(200, { data: { ...OUVERT, state: "declined" } }))
    let focusALaRelecture: Element | null = null
    rafraichir.mockImplementation(() => {
      focusALaRelecture = document.activeElement
    })
    rendre({ data: LISTE })
    fireEvent.click(screen.getByRole("button", { name: "Décliner FB-0012" }))
    const motif = screen.getByLabelText("Motif (lu par la personne qui a signalé)")
    await waitFor(() => expect(motif).toHaveFocus())

    fireEvent.click(screen.getByRole("button", { name: "Confirmer le refus" }))
    expect(await screen.findByText("Un refus demande un motif d'au moins 3 caractères.")).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()

    fireEvent.change(motif, { target: { value: "  Hors périmètre du pilote.  " } })
    fireEvent.click(screen.getByRole("button", { name: "Confirmer le refus" }))

    await waitFor(() => expect(rafraichir).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0]
    expect([url, init?.method, init?.body]).toEqual(["/api/platform/feedback/FB-0012", "PATCH", JSON.stringify({ state: "declined", resolution: "Hors périmètre du pilote." })])
    expect(focusALaRelecture).toBe(titreDeLaListe())
  })

  it("should give the button and the focus back on « Annuler »", async () => {
    rendre({ data: LISTE })
    fireEvent.click(screen.getByRole("button", { name: "Décliner FB-0012" }))

    fireEvent.click(screen.getByRole("button", { name: "Annuler" }))

    await waitFor(() => expect(screen.getByRole("button", { name: "Décliner FB-0012" })).toHaveFocus())
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // Les phrases propres au geste pour `not_found` et pour un autre code : `ui-messages.test.ts`, « should prefer the
  // phrase of the gesture for the reason, then for the code ».
  it.each([
    ["forbidden", reponse(403, { error: { code: "forbidden", message: "Reserved." } }), "Seul un administrateur de l'organisation peut traiter les retours."],
    ["network", null, "La connexion au serveur a échoué. Rien n'a changé."],
  ])("should say a %s refusal under the gesture", async (_code, reponseDeLAPI, message) => {
    if (reponseDeLAPI) fetchMock.mockResolvedValue(reponseDeLAPI)
    else fetchMock.mockRejectedValue(new TypeError("fetch failed"))
    rendre({ data: LISTE })

    fireEvent.click(screen.getByRole("button", { name: "Résoudre FB-0012" }))

    expect(await within(within(ligne("FB-0012")).getAllByRole("cell")[10]).findByRole("alert")).toHaveTextContent(message)
  })

  it("should say an invalid reason refused by the server under the refusal form", async () => {
    fetchMock.mockResolvedValue(reponse(400, { error: { code: "invalid_arguments", message: "A declined ticket needs a resolution." } }))
    rendre({ data: LISTE })
    fireEvent.click(screen.getByRole("button", { name: "Décliner FB-0012" }))
    fireEvent.change(screen.getByLabelText("Motif (lu par la personne qui a signalé)"), { target: { value: "abc" } })

    fireEvent.click(screen.getByRole("button", { name: "Confirmer le refus" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("Un refus demande un motif d'au moins 3 caractères.")
    expect(rafraichir).not.toHaveBeenCalled()
  })
})
