// L'adresse d'un contenu renommé, à l'écran (E05-S10, partie b2, AC-b12 ; décision de JB du 2026-09-28 : mettre
// l'adresse à jour plus tard) : la publication seule rend le nouveau chemin et l'ancien ; l'adresse du navigateur
// garde l'ancien, un alias, tant qu'on reste sur la page, qui n'est pas remontée (le champ garde le focus et la
// saisie) ; la relecture suit, et les écritures suivantes partent sur l'ancien chemin. Le rail reconnaît l'alias :
// la page annonce son chemin actuel (`NoeudOuvert`), sa ligne est la ligne courante. `fetch` simulé pour
// l'API du paquet, relecture espionnée, horloge simulée pour la publication (1 200 ms pour le titre, 3 s).
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { TreeNode } from "@otomata_tech/oto_platform/schemas"
import { ContexteDeLHote, ContexteDeRafraichissement, CoquilleOto, SectionsDuRail } from "@otomata_tech/oto_platform/ui"
import { NoeudOuvert } from "../../../packages/plateforme/ui/coque/noeud-ouvert"
import { FileDOperations } from "../../../packages/plateforme/ui/noeud/editeur/file-d-operations"
import { TitreModifiable } from "../../../packages/plateforme/ui/noeud/en-tete-modifiable"
import { Publication } from "../../../packages/plateforme/ui/noeud/publication"
import { simulerLesDialogues } from "../../helpers/dialogue"

const rafraichir = vi.fn()
const naviguer = vi.fn()

type Corps = { path: string; publish?: boolean; title?: string }

/** L'API : une écriture rend un tampon ; une publication rend le chemin que lui donne `publiee`. */
function simulerLAPI(publiee: (corps: Corps) => Record<string, unknown>) {
  const envoyes: Corps[] = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_adresse: string, init?: RequestInit) => {
      const corps = JSON.parse(String(init?.body)) as Corps
      envoyes.push(corps)
      const data = corps.publish
        ? { revision: 1, status: "published", draft_stamp: null, touched: [], ...publiee(corps) }
        : { path: corps.path, revision: 0, status: "draft", draft_stamp: `2026-09-27T10:00:0${envoyes.length}.000000+00:00`, touched: [] }
      return new Response(JSON.stringify({ data }), { status: 200, headers: { "content-type": "application/json" } })
    }),
  )
  return envoyes
}

beforeAll(simulerLesDialogues)

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("Publication, the address of a renamed content (AC-b12)", () => {
  function monter() {
    render(
      <ContexteDeRafraichissement.Provider value={rafraichir}>
        <FileDOperations chemin="ventes/sans_titre" revisionPubliee={0} tampon={null}>
          <h1>
            <TitreModifiable titre="Sans titre" revisionServie={0} tamponServi={null} />
          </h1>
          <Publication />
        </FileDOperations>
      </ContexteDeRafraichissement.Provider>,
    )
  }

  const champTitre = () => screen.getByRole("textbox", { name: "Titre" })

  /** Un titre tapé, enregistré après 1 200 ms, puis publié 3 s après la frappe. */
  async function ecrireEtPublier(titre: string) {
    fireEvent.change(champTitre(), { target: { value: titre } })
    await act(() => vi.advanceTimersByTimeAsync(3_000))
  }

  beforeEach(() => {
    window.history.replaceState(null, "", "/n/ventes/sans_titre?vue=grille#bloc")
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    window.history.replaceState(null, "", "/")
  })

  it("should keep the old address, an alias, and the open page with its focus and its input, re-read it, and keep writing through the old path", async () => {
    const envoyes = simulerLAPI(() => ({ path: "ventes/tarifs_2026", renamed_from: "ventes/sans_titre" }))
    monter()
    const champ = champTitre()
    champ.focus()

    await ecrireEtPublier("Tarifs 2026")

    expect(envoyes.map((corps) => [corps.path, corps.publish === true ? true : corps.title])).toEqual([
      ["ventes/sans_titre", "Tarifs 2026"],
      ["ventes/sans_titre", true],
    ])
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe("/n/ventes/sans_titre?vue=grille#bloc")
    expect(rafraichir).toHaveBeenCalled()
    // La page n'a pas été remontée : le même champ, le focus et la saisie gardés.
    expect(champTitre()).toBe(champ)
    expect(champ).toHaveFocus()
    expect(champ).toHaveValue("Tarifs 2026")

    // L'ancien chemin reste un alias : la file y écrit encore, le service suit.
    await ecrireEtPublier("Tarifs 2026 révisés")
    expect(envoyes.at(-2)).toMatchObject({ path: "ventes/sans_titre", title: "Tarifs 2026 révisés" })
  })
})

const noeud = (path: string, kind: TreeNode["kind"], title: string, children: TreeNode[] = []): TreeNode => ({ path, kind, title, status: "published", children })

// L'arbre relu après le renommage : la page porte son nouveau chemin.
const ARBRE: TreeNode[] = [
  noeud("guide", "page", "Guide de Démo", [
    noeud("contexte", "context", "Contexte de l'organisation"),
    noeud("ventes", "page", "Ventes", [noeud("ventes/tarifs_2026", "page", "Tarifs 2026"), noeud("ventes/devis", "page", "Devis")]),
  ]),
]

/** Le rail et, à côté, la page ouverte qui annonce son chemin actuel (`ouvert`), sous l'hôte à cette adresse. */
function railEtPage(adresse: string, ouvert: string | null) {
  return (
    <CoquilleOto pleinePage>
      <ContexteDeRafraichissement.Provider value={rafraichir}>
        <ContexteDeLHote.Provider value={{ Lien: "a", chemin: adresse, naviguer }}>
          <nav aria-label="Rail">
            <SectionsDuRail arbre={ARBRE} equipes={[]} handle={null} prefixe="/n/" />
          </nav>
          {ouvert !== null && <NoeudOuvert chemin={ouvert} />}
        </ContexteDeLHote.Provider>
      </ContexteDeRafraichissement.Provider>
    </CoquilleOto>
  )
}

describe("SectionsDuRail, the open content under its old address (AC-b12)", () => {
  const lien = (nom: string) => within(screen.getByRole("navigation", { name: "Rail" })).getByRole("link", { name: nom })

  it("should mark the line of the open content at its old address, and the line of the address once the page is left", async () => {
    const { rerender } = render(railEtPage("/n/ventes/sans_titre", "ventes/tarifs_2026"))
    await waitFor(() => expect(lien("Tarifs 2026")).toHaveAttribute("aria-current", "page"))

    rerender(railEtPage("/n/ventes/devis", null))
    expect(lien("Devis")).toHaveAttribute("aria-current", "page")
    expect(lien("Tarifs 2026")).not.toHaveAttribute("aria-current")
  })

  it("should open the parent when the content open at its old address is deleted", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: { path: "ventes/tarifs_2026", count: 1 } }), { status: 200, headers: { "content-type": "application/json" } })))
    render(railEtPage("/n/ventes/sans_titre", "ventes/tarifs_2026"))
    await waitFor(() => expect(lien("Tarifs 2026")).toHaveAttribute("aria-current", "page"))
    fireEvent.click(screen.getByRole("button", { name: "Autres actions sur Tarifs 2026" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Supprimer" }))
    fireEvent.click(within(screen.getByRole("dialog", { name: "Supprimer « Tarifs 2026 » ?" })).getByRole("button", { name: "Supprimer" }))

    await waitFor(() => expect(naviguer).toHaveBeenCalledWith("/n/ventes"))
  })
})
