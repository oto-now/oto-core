// Le tiroir « Historique des versions » (maquette validée de la refonte) : ses quatre états, l'auteur d'une version
// écrite par un assistant ou par un ancien membre, l'aperçu « Supprimé » / « Ajouté » de la version choisie, « Revenir
// à cette version » confirmé en ligne (et désactivé pour qui lit), un tableau sans ses lignes, la ligne de résumé, et
// l'historique d'un bloc ouvert sur ce bloc, en panneau de la piste de droite.
// `fetch` simulé pour l'API du paquet : chaque cas sert ses réponses et lit ce qui est parti.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { HistoryEntry, HistorySummary, NodeHistoryDiffView, NodeHistoryView } from "../../../packages/plateforme/schemas/node-history"
import { ContexteDeRafraichissement } from "../../../packages/plateforme/ui/hote/rafraichir"
import { ColonnesDuNoeud } from "../../../packages/plateforme/ui/noeud/colonnes-du-noeud"
import { FournisseurDHistorique, useHistorique } from "../../../packages/plateforme/ui/noeud/historique-du-noeud"
import { resumeDeLaVersion } from "../../../packages/plateforme/ui/noeud/historique/libelles"
import { TiroirDHistorique } from "../../../packages/plateforme/ui/noeud/historique/tiroir-d-historique"
import { simulerLesDialogues } from "../../helpers/dialogue"

const CHEMIN = "ventes/strapi"
const fetchMock = vi.fn<typeof fetch>()

const RIEN: HistorySummary = { created: false, title: false, summary: false, kind: false, schema: false, added: 0, changed: 0, moved: 0, deleted: 0, section: null }

function version(revision: number, propres: Partial<HistoryEntry> = {}): HistoryEntry {
  return { revision, at: "2026-11-12T09:05:00.000Z", author: { name: "Claire Morel" }, summary: { ...RIEN, changed: 1 }, ...propres }
}

function vue(propres: Partial<NodeHistoryView> = {}): NodeHistoryView {
  return {
    path: CHEMIN,
    kind: "page",
    revision: 3,
    writable: true,
    entries: [version(3), version(2, { summary: { ...RIEN, changed: 3 } }), version(1, { author: null, summary: { ...RIEN, created: true } })],
    next: null,
    ...propres,
  }
}

const ECART: NodeHistoryDiffView = {
  revision: 2,
  previous: 1,
  header: {},
  schema: false,
  total: 3,
  blocks: [{ id: "b1", change: "changed", section: "Pas possible ou bloqué", before: "En attente de Kevin", after: "Cache de 3 mois, en cours avec Kevin" }],
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

/** Sert la liste, l'écart et le retour ; `liste` peut être une réponse d'échec. */
function servir(liste: NodeHistoryView | Response, retour: Response = json(200, { data: { path: CHEMIN, revision: 4, restored: 2 } })) {
  fetchMock.mockImplementation(async (adresse, init) => {
    const url = String(adresse)
    if (init?.method === "POST") return retour.clone()
    if (url.includes("history/diff")) return json(200, { data: ECART })
    return liste instanceof Response ? liste.clone() : json(200, { data: liste })
  })
}

const relireLaPage = vi.fn()

const rendre = (scope: "page" | { block: string } = "page") =>
  render(
    <ContexteDeRafraichissement.Provider value={relireLaPage}>
      <TiroirDHistorique node={{ chemin: CHEMIN, titre: "Strapi x IA" }} scope={scope} open onClose={() => {}} />
    </ContexteDeRafraichissement.Provider>,
  )

beforeAll(() => {
  simulerLesDialogues()
  // jsdom n'implémente pas `show()` (le tiroir non modal) : il s'ouvre par son attribut, comme le navigateur.
  HTMLDialogElement.prototype.show = function show(this: HTMLDialogElement) {
    this.setAttribute("open", "")
  }
})

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/** La version 2, écrite par l'assistant de Claire Morel : son bouton se lit à son nom, puis à ce qu'elle a changé. */
const versionDeLAssistant = () => screen.findByRole("button", { name: /^Claire Morel.*3 blocs modifiés$/ })

describe("TiroirDHistorique", () => {
  it("should list the versions with their author, the person's name alone for one her assistant wrote, a former member's, and show what the chosen one changed", async () => {
    servir(vue())
    rendre()
    expect(screen.getByRole("status", { name: "Chargement de l'historique" })).toBeTruthy()
    const ecriteParLAssistant = await versionDeLAssistant()
    expect(screen.queryByText(/Claude pour|Assistant pour/)).toBeNull()
    expect(screen.getByRole("button", { name: /^Ancien membre/ })).toBeTruthy()
    expect(screen.getByText("Page créée")).toBeTruthy()
    fireEvent.click(ecriteParLAssistant)
    expect(await screen.findByText("Cache de 3 mois, en cours avec Kevin")).toBeTruthy()
    expect(screen.getByText("Supprimé")).toBeTruthy()
    expect(screen.getByText("Ajouté")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Voir les 2 autres blocs" })).toBeTruthy()
    expect((await versionDeLAssistant()).getAttribute("aria-current")).toBe("true")
  })

  it("should say a failed read with Réessayer, then an empty history", async () => {
    servir(json(500, { error: { code: "internal" } }))
    rendre()
    expect(await screen.findByText("L'historique n'a pas pu être lu.")).toBeTruthy()
    servir(vue({ entries: [] }))
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }))
    expect(await screen.findByText("Aucune version publiée")).toBeTruthy()
  })

  it("should restore the chosen version after an inline confirmation, and offer it disabled to a reader", async () => {
    servir(vue())
    const { unmount } = rendre()
    fireEvent.click(await versionDeLAssistant())
    fireEvent.click(screen.getByRole("button", { name: "Revenir à cette version" }))
    fireEvent.click(screen.getByRole("button", { name: "Revenir" }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true))
    const [, envoi] = fetchMock.mock.calls.find(([, init]) => init?.method === "POST") ?? []
    expect(JSON.parse(String(envoi?.body))).toEqual({ path: CHEMIN, revision: 2, base_revision: 3 })
    await waitFor(() => expect(relireLaPage).toHaveBeenCalled())
    unmount()
    servir(vue({ writable: false }))
    rendre()
    fireEvent.click(await versionDeLAssistant())
    expect(screen.getByRole("button", { name: "Revenir à cette version" }).hasAttribute("disabled")).toBe(true)
    expect(screen.getByText("Seuls ceux qui écrivent ce contenu peuvent revenir à une version.")).toBeTruthy()
  })

  it("should show a table's header versions alone, without scope nor restore", async () => {
    servir(vue({ kind: "table", entries: [version(2, { summary: { ...RIEN, schema: true } })] }))
    rendre()
    expect(await screen.findByText("Colonnes modifiées")).toBeTruthy()
    expect(screen.getByText("L'historique des lignes viendra plus tard.")).toBeTruthy()
    expect(screen.queryByRole("radiogroup")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: /^Claire Morel/ }))
    expect(screen.queryByRole("button", { name: "Revenir à cette version" })).toBeNull()
  })

  it("should open a block's history on that block, as a panel of the right track from 1 024 px", async () => {
    // L'icône d'un bloc ouvre l'historique par le fournisseur de l'écran ; la piste de droite (`ColonnesDuNoeud`) le monte
    // à côté du texte (jsdom ne répond à aucune rupture : la fenêtre est large).
    servir(vue())
    function IconeDuBloc() {
      const historique = useHistorique()
      return (
        <button type="button" onClick={() => historique?.ouvrir({ block: "b1" })}>
          Historique du bloc
        </button>
      )
    }
    render(
      <ContexteDeRafraichissement.Provider value={relireLaPage}>
        <FournisseurDHistorique noeud={{ chemin: CHEMIN, titre: "Strapi x IA" }}>
          <IconeDuBloc />
          <ColonnesDuNoeud mesure="document">
            <p>Le texte</p>
          </ColonnesDuNoeud>
        </FournisseurDHistorique>
      </ContexteDeRafraichissement.Provider>,
    )
    expect(screen.queryByRole("region", { name: "Historique des versions" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Historique du bloc" }))
    const panneau = await screen.findByRole("region", { name: "Historique des versions" })
    expect(panneau.closest("aside")).not.toBeNull()
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(within(panneau).getByRole("radio", { name: "Ce bloc" })).toHaveAttribute("aria-checked", "true")
    await waitFor(() => expect(fetchMock.mock.calls.map(([adresse]) => String(adresse)).some((adresse) => adresse.includes("block=b1"))).toBe(true))
    fireEvent.click(within(panneau).getByRole("button", { name: "Fermer" }))
    expect(screen.queryByRole("region", { name: "Historique des versions" })).toBeNull()
  })

  it("should write what a version changed in one line", () => {
    const cas = {
      cree: resumeDeLaVersion({ ...RIEN, created: true }, "procedure"),
      section: resumeDeLaVersion({ ...RIEN, added: 3, section: { title: "Possible", change: "added" } }, "page"),
      titre: resumeDeLaVersion({ ...RIEN, title: true, changed: 1 }, "page"),
      supprimes: resumeDeLaVersion({ ...RIEN, deleted: 2 }, "page"),
      rien: resumeDeLaVersion(RIEN, "page"),
    }
    expect(cas).toEqual({ cree: "Procédure créée", section: "Section Possible ajoutée", titre: "Titre modifié, 1 bloc modifié", supprimes: "2 blocs supprimés", rien: "Aucun changement" })
  })
})
