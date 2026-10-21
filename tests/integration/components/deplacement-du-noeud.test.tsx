import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { TreeNode } from "@otomata_tech/oto_platform/schemas"
import { destinationsDuDeplacement } from "../../../packages/plateforme/ui/arbre/depuis-l-arbre"
import { envoyerLeDeplacement, FormulaireDeDeplacement } from "../../../packages/plateforme/ui/noeud/deplacement-du-noeud"
import { choisirDansLaListe, libellesDesChoix } from "../../helpers/liste-de-choix"

// « Déplacer » (E05-S02, AC20, AC21) : le formulaire et l'envoi, que le « Déplacer » du rail monte (E05-S10,
// AC-b7 ; le parcours du rail : `rail-application.test.tsx`). E05-S13 (AC-20) : le bouton d'en-tête
// (`DeplacementDuNoeud`) est retiré ; le formulaire se monte ici seul, destinations calculées depuis l'arbre
// visible, `fetch` simulé pour `POST /api/platform/nodes/move`.

const fetchMock = vi.fn<typeof fetch>()

const noeud = (path: string, title: string, children: TreeNode[] = []): TreeNode => ({ path, kind: "page", title, status: "published", children })

const ARBRE: TreeNode[] = [
  noeud("guide", "Guide de Démo", [
    noeud("conseil", "Conseil", [noeud("conseil/grille", "Grille tarifaire")]),
    noeud("ventes", "Ventes", [noeud("ventes/modele_relance", "Modèle de relance", [noeud("ventes/modele_relance/exemple", "Exemple")])]),
  ]),
]

const CHEMIN = "ventes/modele_relance"

function reponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

type Deplacer = (nouveauChemin: string) => Promise<{ fait: string } | { refus: string } | null>

function formulaire(arbre: TreeNode[], deplacer: Deplacer, annuler = vi.fn()) {
  return <FormulaireDeDeplacement chemin={CHEMIN} destinations={destinationsDuDeplacement(arbre, CHEMIN)} sousPages={2} deplacer={deplacer} annuler={annuler} />
}

const bouton = (nom: string) => screen.getByRole("button", { name: nom })
const ENVOYER = "Déplacer ici"
const parent = () => screen.getByRole("combobox", { name: "Nouveau parent" })
const annonce = () => screen.getAllByRole("status").find((region) => region.closest("form"))

/** Le parent « Conseil », choisi dans la liste. */
const CONSEIL = "Conseil (conseil)"

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("FormulaireDeDeplacement (AC20)", () => {
  it("should offer the visible parents, announce the new path, the alias, the sub-pages and the owner, then hand the new path over and say what was done", async () => {
    let finir: (issue: { fait: string }) => void = () => {}
    const deplacer = vi.fn<Deplacer>(() => new Promise((resolve) => (finir = resolve)))
    render(formulaire(ARBRE, deplacer))
    expect(libellesDesChoix(parent())).toEqual(["Choisissez un parent", "Racine de l'arbre", CONSEIL, "Grille tarifaire (conseil/grille)"])
    expect(annonce()).toBeEmptyDOMElement()
    expect(bouton(ENVOYER)).toBeDisabled()

    choisirDansLaListe(parent(), "Racine de l'arbre")
    expect(annonce()).toHaveTextContent("Nouveau chemin : modele_relance")
    choisirDansLaListe(parent(), CONSEIL)
    const region = annonce()
    expect(region).toHaveTextContent("Nouveau chemin : conseil/modele_relance")
    expect(region).toHaveTextContent("L'ancien chemin ventes/modele_relance restera valable : les liens et les assistants qui l'emploient seront redirigés.")
    expect(region).toHaveTextContent("Ses 2 sous-pages suivent.")
    expect(region).toHaveTextContent("Sans propriétaire propre, la page prendra celui de sa nouvelle place.")

    fireEvent.click(bouton(ENVOYER))
    await waitFor(() => expect(bouton(ENVOYER)).toBeDisabled())
    expect(bouton(ENVOYER)).toHaveAttribute("aria-busy", "true")
    expect(deplacer).toHaveBeenCalledWith("conseil/modele_relance")
    finir({ fait: "Page rangée." })
    await waitFor(() => expect(annonce()).toHaveTextContent("Page rangée."))
  })

  it("should say a refusal under the button and keep the choice, and drop a chosen parent that the reread tree no longer shows", async () => {
    const { rerender } = render(formulaire(ARBRE, async () => ({ refus: "Ce parent n'existe plus ou ne vous est plus partagé." })))
    choisirDansLaListe(parent(), CONSEIL)
    fireEvent.click(bouton(ENVOYER))
    expect(await screen.findByRole("alert")).toHaveTextContent("Ce parent n'existe plus ou ne vous est plus partagé.")
    expect(parent()).toHaveValue("conseil")

    rerender(formulaire([noeud("guide", "Guide de Démo", [ARBRE[0].children[1]])], async () => null))
    await waitFor(() => expect(parent()).toHaveValue("-"))
    expect(annonce()).toBeEmptyDOMElement()
    expect(bouton(ENVOYER)).toBeDisabled()
  })

  it("should call « Annuler » back", () => {
    const annuler = vi.fn()
    render(formulaire(ARBRE, async () => null, annuler))
    fireEvent.click(bouton("Annuler"))
    expect(annuler).toHaveBeenCalledTimes(1)
  })
})

describe("envoyerLeDeplacement (AC21)", () => {
  it("should send POST nodes/move and give the path where the node arrived", async () => {
    // Le nom est pris sous `conseil` (fiche D125) : le service rend le premier chemin libre.
    fetchMock.mockResolvedValueOnce(reponse(200, { data: { path: "conseil/modele_relance_2", moves: [] } }))
    expect(await envoyerLeDeplacement(CHEMIN, "conseil/modele_relance")).toEqual({ chemin: "conseil/modele_relance_2" })
    expect(fetchMock.mock.calls[0][0]).toBe("/api/platform/nodes/move")
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ path: CHEMIN, new_path: "conseil/modele_relance" })
  })

  it.each([
    ["forbidden", 403, "Ce déplacement vous est refusé : il faut la gestion de la page et l'écriture sous le nouveau parent."],
    // Un nom pris ne refuse plus (fiche D125) : un conflit est une course, dite par le texte commun, la branche
    // de tout autre code, `invalid_arguments` compris (`messageDErreur`).
    ["conflict", 409, "L'action entre en conflit avec l'état actuel. Rechargez la page."],
    ["not_found", 404, "Ce parent n'existe plus ou ne vous est plus partagé."],
  ])("should say %s, the parent gone only for not_found", async (code, statut, message) => {
    fetchMock.mockResolvedValueOnce(reponse(statut, { error: { code, message: "refused" } }))
    expect(await envoyerLeDeplacement(CHEMIN, "conseil/modele_relance")).toEqual({ message, disparu: code === "not_found" })
  })
})
