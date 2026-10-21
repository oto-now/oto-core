import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { tableHeaderSchema, type TableHeader } from "@otomata_tech/oto_platform/schemas"
import { ContexteDeRafraichissement } from "@otomata_tech/oto_platform/ui"
import { FileDOperations } from "../../../packages/plateforme/ui/noeud/editeur/file-d-operations"
import { OptionsDuTableau } from "../../../packages/plateforme/ui/tableau/options-du-tableau"
import { simulerLAPI } from "../../helpers/noeud"

// Les réglages d'un tableau à l'écran (E11-S01, lot g : AC-g2, AC-g3, AC-g5, AC-g6, AC-g7), montés comme
// l'en-tête d'écran les pose : sous la file d'opérations de la page, `fetch` simulé pour
// `POST /api/platform/nodes`, relecture espionnée. Qui voit « Réglages » (AC-g1) et d'où vient le blocage
// (AC-g6, `vue.draft.meta`) : `ecran-de-noeud.test.tsx`.

const CHEMIN = "ventes/suivi_prospects"
const ETATS = ["à qualifier", "en cours", "à revoir", "qualifié", "écarté"]
const REVUE = { state: "à revoir", approve: "qualifié", reject: "écarté" }
const CYCLE = { column: "statut", states: ETATS, working: "en cours", review: REVUE }

const enTeteDe = (surcharge: Record<string, unknown> = {}): TableHeader =>
  tableHeaderSchema.parse({
    columns: [
      { name: "entreprise", type: "text", required: true },
      { name: "statut", type: "enum", options: ETATS },
    ],
    key: "entreprise",
    lifecycle: CYCLE,
    proof: true,
    ...surcharge,
  })

const rafraichir = vi.fn()
let api: ReturnType<typeof simulerLAPI>

function monter(entete: TableHeader = enTeteDe(), enAttente = false) {
  return render(
    <ContexteDeRafraichissement.Provider value={rafraichir}>
      <FileDOperations chemin={CHEMIN} revisionPubliee={4} tampon={null}>
        <OptionsDuTableau entete={entete} enAttente={enAttente} />
      </FileDOperations>
    </ContexteDeRafraichissement.Provider>,
  )
}

const reglages = () => screen.getByRole("button", { name: "Réglages" })
function ouvrir() {
  fireEvent.click(reglages())
  return within(screen.getByRole("dialog", { name: "Réglages du tableau" }))
}
const interrupteurs = () => screen.getAllByRole("switch")

beforeEach(() => {
  api = simulerLAPI()
  rafraichir.mockReset()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("OptionsDuTableau, les interrupteurs (AC-g2)", () => {
  it("should show, in order, the switches named by their label, described by their help and checked as published; the review switch only with a review", () => {
    monter(enTeteDe({ lifecycle: { ...CYCLE, review: { ...REVUE, agents_may_decide: true } }, closed: false }))
    const panneau = ouvrir()
    expect(panneau.getByText("Réglages du tableau")).toBeInTheDocument()
    const noms = ["Preuve exigée", "L'assistant peut décider la revue", "Fermé"]
    expect(interrupteurs().map((un) => un.id)).toEqual(noms.map((nom) => panneau.getByRole("switch", { name: nom }).id))
    for (const un of interrupteurs()) expect(un).toHaveAttribute("type", "checkbox")
    const [preuve, decider, ferme] = interrupteurs()
    expect(preuve).toBeChecked()
    expect(decider).toBeChecked()
    expect(ferme).not.toBeChecked()
    expect(panneau.getByRole("switch", { name: "Preuve exigée" })).toHaveAccessibleDescription(
      "Chaque valeur nouvelle écrite par un assistant doit citer sa source : un commentaire ou un lien.",
    )
    expect(panneau.getByRole("switch", { name: "L'assistant peut décider la revue" })).toHaveAccessibleDescription(
      "Un assistant peut aussi passer une ligne « à revoir » à « qualifié » ou « écarté » ; sa décision est tracée comme venant d'un assistant.",
    )
    expect(panneau.getByRole("switch", { name: "Fermé" })).toHaveAccessibleDescription("Seules les lignes existantes s'écrivent : aucune ligne nouvelle n'est créée.")
    expect(interrupteurs().every((un) => un.hasAttribute("aria-labelledby") && un.hasAttribute("aria-describedby"))).toBe(true)
    cleanup()

    // Sans revue déclarée, rien à décider : l'interrupteur est absent, pas désactivé (HN-E11S01-17).
    monter(enTeteDe({ lifecycle: { column: "statut", states: ETATS, working: "en cours" }, proof: false }))
    const sansRevue = ouvrir()
    expect(interrupteurs().map((un) => un.id)).toEqual(["Preuve exigée", "Fermé"].map((nom) => sansRevue.getByRole("switch", { name: nom }).id))
    expect(sansRevue.queryByRole("switch", { name: "L'assistant peut décider la revue" })).toBeNull()
  })
})

describe("OptionsDuTableau, un geste, une publication (AC-g3)", () => {
  it.each([
    ["Preuve exigée", { proof: false }, "Preuve exigée : désactivée."],
    ["L'assistant peut décider la revue", { lifecycle: { ...CYCLE, review: { ...REVUE, agents_may_decide: true } } }, "L'assistant peut décider la revue : activée."],
    ["Fermé", { closed: true }, "Fermé : activée."],
  ])("should publish « %s » in one request through the page's queue, the switches disabled meanwhile, then announce it and read the page again", async (nom, header, annonce) => {
    monter()
    ouvrir()
    const relacher = api.retenir()
    const interrupteur = screen.getByRole("switch", { name: nom })
    act(() => interrupteur.focus())
    fireEvent.click(interrupteur)
    await waitFor(() => expect(api.envoyes).toHaveLength(1))
    expect(api.envoyes[0]).toEqual({ path: CHEMIN, base_revision: 4, header, publish: true })
    for (const un of interrupteurs()) expect(un).toBeDisabled()
    expect(interrupteur.closest("[aria-busy]")).toHaveAttribute("aria-busy", "true")
    relacher()
    expect(await screen.findByText(annonce)).toHaveAttribute("role", "status")
    expect(rafraichir).toHaveBeenCalledTimes(1)
    for (const un of interrupteurs()) expect(un).toBeEnabled()
    await waitFor(() => expect(document.activeElement).toBe(interrupteur))
    expect(api.envoyes).toHaveLength(1)
  })

  it("should follow the published header once the page is read again", async () => {
    const rendu = monter()
    ouvrir()
    fireEvent.click(screen.getByRole("switch", { name: "Preuve exigée" }))
    await screen.findByText("Preuve exigée : désactivée.")
    expect(screen.getByRole("switch", { name: "Preuve exigée" })).not.toBeChecked()
    // La relecture sert l'en-tête publié ; un autre l'a changé depuis : l'interrupteur suit ce qui est publié.
    rendu.rerender(
      <ContexteDeRafraichissement.Provider value={rafraichir}>
        <FileDOperations chemin={CHEMIN} revisionPubliee={6} tampon={null}>
          <OptionsDuTableau entete={enTeteDe({ proof: true, closed: true })} enAttente={false} />
        </FileDOperations>
      </ContexteDeRafraichissement.Provider>,
    )
    expect(screen.getByRole("switch", { name: "Preuve exigée" })).toBeChecked()
    expect(screen.getByRole("switch", { name: "Fermé" })).toBeChecked()
  })
})

// La phrase d'un autre refus (forbidden) : `tests/unit/ui-messages.test.ts`, que l'écran lit par `messageDErreur`.
describe("OptionsDuTableau, refus (AC-g5)", () => {
  it("should say stale_revision under the switches, put the switch back to its published state and keep the focus on it", async () => {
    monter()
    ouvrir()
    api.refuser("stale_revision", 409)
    const interrupteur = screen.getByRole("switch", { name: "Preuve exigée" })
    act(() => interrupteur.focus())
    fireEvent.click(interrupteur)
    expect(await screen.findByText("Le tableau a changé pendant que la page était ouverte. Rechargez la page, puis réessayez.")).toHaveAttribute("role", "alert")
    expect(interrupteur).toBeChecked()
    expect(interrupteur).toBeEnabled()
    await waitFor(() => expect(document.activeElement).toBe(interrupteur))
    expect(rafraichir).not.toHaveBeenCalled()
    expect(screen.getByRole("status").textContent).toBe("")
    // Le refus a levé l'arrêt de la file : un second geste repart en une seconde requête.
    fireEvent.click(interrupteur)
    await waitFor(() => expect(api.envoyes).toHaveLength(2))
    expect(api.envoyes[1]).toEqual(api.envoyes[0])
    await screen.findByText("Preuve exigée : désactivée.")
  })
})

describe("OptionsDuTableau, brouillon d'en-tête en attente (AC-g6)", () => {
  it("should disable the switches, showing the published state, say why under the title, and send nothing", () => {
    monter(enTeteDe(), true)
    const panneau = ouvrir()
    expect(panneau.getByText("Un changement de l'en-tête attend en brouillon. Demandez à l'assistant de le publier ou de l'abandonner, puis rechargez la page.")).toBeInTheDocument()
    expect(interrupteurs()).toHaveLength(3)
    for (const un of interrupteurs()) expect(un).toBeDisabled()
    const [preuve, decider, ferme] = interrupteurs()
    expect(preuve).toBeChecked()
    expect(decider).not.toBeChecked()
    expect(ferme).not.toBeChecked()
    for (const interrupteur of interrupteurs()) fireEvent.click(interrupteur)
    expect(api.fetchMock).not.toHaveBeenCalled()
  })
})

describe("OptionsDuTableau, clavier (AC-g7)", () => {
  it("should close on Escape and give the focus back to « Réglages »", async () => {
    monter()
    ouvrir()
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Réglages du tableau" }).contains(document.activeElement)).toBe(true))
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" })
    expect(screen.queryByRole("dialog", { name: "Réglages du tableau" })).toBeNull()
    expect(document.activeElement).toBe(reglages())
    expect(reglages()).toHaveAttribute("aria-expanded", "false")
  })
})
