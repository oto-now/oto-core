import type { ComponentProps, ReactNode } from "react"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { BlockView, NodeKind } from "@otomata_tech/oto_platform/schemas"
import { AnnexesDuContexte, ContexteDeRafraichissement, EcranDeNoeud } from "@otomata_tech/oto_platform/ui"
import { EditeurDeBlocs } from "../../../packages/plateforme/ui/noeud/editeur/editeur-de-blocs"
import { FileDOperations } from "../../../packages/plateforme/ui/noeud/editeur/file-d-operations"
import { ouvrirLeChamp } from "../../helpers/champ-du-bloc"
import { bloc, simulerLAPI, vueDuNoeud } from "../../helpers/noeud"

// L'écran d'un Contexte (E05-S04, AC10 à AC12 ; P39 ; E05-S09, partie c1 : porté d'oto-frontend) : l'écran
// de nœud d'E05-S02 en deux colonnes et ses annexes (la note de ce qu'il est et de qui le reçoit, l'encart
// de ce que l'agent va lire), la publication d'un Contexte. E05-S11 (AC-8 à AC-11) : « Ma fiche » quitte la
// colonne ; l'encart se titre « Voici ce que votre agent va lire », sans texte servi replié, le total en
// dernière ligne, chaque ligne un lien vers la vue « Contexte » de l'accueil. E11-S10 (lot g) : l'encart sans titre
// visible ni « Règles Oto », ses lignes vers `/context` ; la publication sans phrase de recharge. E11-S05 (AC-e2) :
// « À quoi sert cette page » est un repli fermé à l'arrivée, en tête de la colonne de droite. `fetch` simulé pour
// `POST /api/platform/nodes`, relecture espionnée.

const rafraichir = vi.fn()
const EQUIPES = [{ slug: "ventes", name: "Ventes" }]
const TEXTE = "x".repeat(12_480)

function LienDeTest({ children, ...props }: { href: string; className?: string; "aria-current"?: "page"; children: ReactNode }) {
  return <a {...props}>{children}</a>
}

const APERCU = {
  data: {
    text: TEXTE,
    budget: 20_000,
    blocks: [
      { name: "code", chars: 1_930, status: "full", path: null, head: 0 },
      { name: "contexte", chars: 2_400, status: "full", path: "contexte", head: 60 },
      { name: "private/lea/contexte", chars: 1_100, status: "cut", path: "private/lea/contexte", head: 90 },
      { name: "ventes/contexte", chars: 6_300, status: "cut", path: "ventes/contexte", head: 640 },
      { name: "recent content", chars: 170, status: "full", path: null, head: 0 },
      { name: "calendar", chars: 0, status: "omitted", path: null, head: 0 },
    ],
  },
}

type AnnexesProps = ComponentProps<typeof AnnexesDuContexte>

function annexes(props: Partial<AnnexesProps> = {}) {
  return (
    <AnnexesDuContexte
      cheminCourant="ventes/contexte"
      handle="lea"
      apercu={APERCU}
      equipes={EQUIPES}
      hrefDuContexteServi="/context"
      ici="/n/ventes/contexte"
      Lien={LienDeTest}
      {...props}
    />
  )
}

function monterLesAnnexes(props: Partial<AnnexesProps> = {}) {
  render(<ContexteDeRafraichissement.Provider value={rafraichir}>{annexes(props)}</ContexteDeRafraichissement.Provider>)
}

/** « À quoi sert cette page » (E11-S05, AC-e2) : un `<details>`, rôle `group`, nommé par son titre. */
const aQuoiSert = () => screen.getByRole("group", { name: "À quoi sert cette page" })
const note = () => within(aQuoiSert())
const apercu = () => within(screen.getByRole("note", { name: "Voici ce que votre agent va lire" }))
/** Les phrases de « À quoi sert cette page » (E05-S13, AC-17) : les paragraphes de son corps replié. */
const phrases = () => [...(aQuoiSert().querySelector(".oto-linked-body")?.children ?? [])].map((enfant) => [enfant.tagName, enfant.className, enfant.textContent])

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

beforeEach(() => {
  rafraichir.mockReset()
})

describe("écran d'un Contexte (AC10)", () => {
  it("should show the node screen of a Contexte in two columns, masculine meta, neither move nor delete, its notes beside the document: who receives it and how it is written, then what the model will receive", () => {
    render(
      <EcranDeNoeud
        chemin="ventes/contexte"
        noeud={{ data: vueDuNoeud({ path: "ventes/contexte", kind: "context", title: "Contexte", level: 3 }) }}
        arbre={{ data: { tree: [], truncated: false } }}
        equipes={{ data: EQUIPES }}
        handle="lea"
        nomOrganisation="Démo"
        versionPubliee={false}
        Lien={LienDeTest}
        hrefDuChemin={(chemin) => `/n/${chemin}`}
        prefixeDesPages="/n/"
        annexes={annexes()}
      />,
    )
    expect(screen.getByText(/^modifié /)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Déplacer" })).toBeNull()
    expect(screen.queryByRole("button", { name: /supprimer la page/i })).toBeNull()
    // Le document dans la colonne principale ; la colonne de droite commence par « À quoi sert cette page », fermé à
    // l'arrivée, sans compte, son glyphe (E11-S05, AC-e2).
    expect(screen.getByRole("region", { name: "Contexte" }).closest(".oto-two-columns-main")).not.toBeNull()
    expect(aQuoiSert().parentElement).toHaveClass("oto-two-columns-aside")
    expect(aQuoiSert().parentElement?.firstElementChild).toBe(aQuoiSert())
    expect(aQuoiSert()).not.toHaveAttribute("open")
    expect(aQuoiSert().querySelector("summary")?.textContent).toBe("À quoi sert cette page")
    expect(aQuoiSert().querySelector(".oto-linked-count")).toBeNull()
    expect(aQuoiSert().querySelector("summary .oto-icon")).not.toBeNull()
    // Une note porte le rôle `note` : aucun repère complémentaire dans la colonne d'annexes (M31 ; axe
    // `landmark-complementary-is-top-level`).
    expect(screen.getAllByRole("complementary").filter((repere) => repere.parentElement?.closest("aside, [role='complementary']"))).toEqual([])
    // E05-S13 (AC-17) : deux phrases, dans un seul style, sans « Reçu par », recharge ni pied.
    expect(phrases()).toEqual([
      ["P", "", "Ce que votre Claude/ChatGPT/Mistral, comme celui de chaque membre de l'équipe Ventes, lit à chaque conversation."],
      ["P", "", "Vous l'écrivez comme n'importe quelle page."],
    ])
    expect(note().queryByText("Reçu par")).toBeNull()
    // E11-S10 (AC-g1) : l'encart n'a plus de titre visible ; son nom accessible reste.
    expect(screen.getByRole("note", { name: "Voici ce que votre agent va lire" }).querySelector(".oto-note-head")).toBeNull()
    expect(screen.queryByText("Voici ce que votre agent va lire")).toBeNull()
  })

  // E05-S13 (AC-17 ; D128) : la première phrase dit, par portée, qui le reçoit.
  it.each([
    ["contexte", "Ce que votre Claude/ChatGPT/Mistral, comme celui de chaque membre de l'organisation, lit à chaque conversation."],
    // Le `handle` de la personne : son propre Contexte Perso lui est servi.
    ["private/lea/contexte", "Ce que votre assistant lit à chaque conversation ; vous seul le recevez."],
    // Le Contexte Perso d'une autre personne, qu'elle a partagé : servi à elle seule (HN-E05S04-22).
    ["private/marc/contexte", "Ce que l'assistant de la personne de cet espace lit à chaque conversation ; elle seule le reçoit."],
  ])("should say in one sentence who receives %s", (chemin, phrase) => {
    monterLesAnnexes({ cheminCourant: chemin })
    expect(phrases()).toEqual([
      ["P", "", phrase],
      ["P", "", "Vous l'écrivez comme n'importe quelle page."],
    ])
  })

  // AC-8 : ses champs sont dans Profil ; aucun Contexte, pas même le sien, ne porte plus « Ma fiche ».
  it("should not give « Ma fiche » in the column of the person's own Contexte", () => {
    monterLesAnnexes({ cheminCourant: "private/lea/contexte" })
    expect(screen.queryByRole("region", { name: "Ma fiche" })).toBeNull()
    expect(screen.queryByText("Ma fiche")).toBeNull()
  })
})

describe("publier un Contexte (AC11)", () => {
  let api: ReturnType<typeof simulerLAPI>

  function editeur(blocs: BlockView[], genre: NodeKind = "context") {
    return render(
      <ContexteDeRafraichissement.Provider value={rafraichir}>
        <FileDOperations chemin="ventes/contexte" revisionPubliee={4} tampon="2026-09-24T09:00:00.000000+00:00">
          <EditeurDeBlocs blocs={blocs} revisionServie={4} prefixeDesPages="/n/" genre={genre} />
        </FileDOperations>
      </ContexteDeRafraichissement.Provider>,
    )
  }

  beforeEach(() => {
    api = simulerLAPI()
  })

  const TUTOIE = bloc("a1000000-0000-4000-8000-000000000001", "paragraph", "Tutoie les clients.")

  /** Le texte du bloc envoyé par Échap, puis la page quittée (`pagehide`) : la publication seule part (E05-S10, AC-a6). */
  async function ecrireEtQuitter(texte: string) {
    const champ = ouvrirLeChamp("Modifier ce texte — Tutoie les clients.")
    fireEvent.change(champ, { target: { value: texte } })
    fireEvent.keyDown(champ, { key: "Escape" })
    await waitFor(() => expect(api.envoyes).toHaveLength(1))
    act(() => window.dispatchEvent(new Event("pagehide")))
  }

  /** Le seul bloc supprimé par le menu de sa poignée, puis la page quittée. */
  async function viderEtQuitter() {
    fireEvent.click(screen.getByRole("button", { name: "Actions sur ce bloc — Tutoie les clients." }))
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Supprimer" }))
    await waitFor(() => expect(api.envoyes).toHaveLength(1))
    act(() => window.dispatchEvent(new Event("pagehide")))
  }

  it("should publish a Contexte without saying the conversations will reload it (E11-S10, AC-g3)", async () => {
    editeur([TUTOIE])
    await ecrireEtQuitter("Tutoie les clients, toujours.")
    await waitFor(() => expect(api.envoyes).toHaveLength(2))
    expect(api.envoyes[1]).toEqual({ path: "ventes/contexte", base_revision: 4, draft_stamp: "2026-09-24T10:00:01.000000+00:00", publish: true })
    await waitFor(() => expect(rafraichir).toHaveBeenCalled())
    expect(screen.queryByText("Les conversations en cours rechargeront le contexte.")).toBeNull()
  })

  it("should ask before publishing an empty Contexte, without taking the focus of the writer, nothing sent before « Publier quand même »", async () => {
    editeur([TUTOIE])
    await viderEtQuitter()
    const question = await screen.findByRole("group", { name: "Ce contexte est vide : il n'est pas publié tant que vous ne le confirmez pas." })
    expect(within(question).getByText("Publier un contexte vide ? Le modèle ne recevra plus rien de ce contexte.")).toBeInTheDocument()
    const confirmer = within(question).getByRole("button", { name: "Publier quand même" })
    expect(document.activeElement).not.toBe(confirmer)
    expect(api.envoyes).toHaveLength(1)

    fireEvent.click(confirmer)
    await waitFor(() => expect(api.envoyes).toHaveLength(2))
    expect(api.envoyes[1]).toMatchObject({ publish: true })
    await waitFor(() => expect(rafraichir).toHaveBeenCalled())
    expect(screen.queryByText("Les conversations en cours rechargeront le contexte.")).toBeNull()
  })

  // La confirmation est propre à un Contexte (AC11) : une page vide se publie sans question.
  it("should publish an empty page without asking", async () => {
    editeur([TUTOIE], "page")
    await viderEtQuitter()
    await waitFor(() => expect(api.envoyes).toHaveLength(2))
    expect(api.envoyes[1]).toMatchObject({ publish: true })
    expect(screen.queryByRole("group", { name: /^Ce contexte est vide/ })).toBeNull()
  })
})

describe("voici ce que votre agent va lire (AC12 ; E05-S11, AC-9 à AC-11)", () => {
  it("should give each served block in reading order by name, this context marked, each a link to its part of the home's « Contexte » view, without any figure (E05-S13, AC-13)", () => {
    monterLesAnnexes()
    // Les couches servies, dans l'ordre : leur nom seul (ni taille ni état, E05-S13) ; la couche regardée marquée ;
    // chacune un lien, atteint au clavier comme tout lien, vers la même partie de la vue « Contexte » (AC-11).
    const couches = within(apercu().getByRole("list", { name: "Ordre de lecture" }))
      .getAllByRole("listitem")
      .map((couche) => within(couche).getByRole("link"))
      .map((couche) => [couche.textContent, couche.getAttribute("aria-current")])
    // Sans « Règles Oto » (E11-S10, AC-g2) : les autres lignes gardent l'ancre de leur rang d'origine.
    expect(couches).toEqual([
      ["Contexte : Tout le monde", null],
      ["Contexte : Privé", null],
      ["Contexte : équipe Ventes (ce contexte)", "page"],
      ["Contenus récents et nouveautés", null],
      ["calendar", null],
    ])
    expect(within(apercu().getByRole("list", { name: "Ordre de lecture" })).getAllByRole("link").map((lien) => lien.getAttribute("href"))).toEqual(
      ["everyone-context", "private-context", "context-ventes", "recent-content", "part-6"].map((ancre) => `/context#${ancre}`),
    )
    for (const lien of apercu().getAllByRole("link")) expect(lien).not.toHaveAttribute("tabindex", "-1")
    // AC-10 : le texte servi replié est parti (il se lit dans la vue « Contexte »).
    expect(apercu().queryByText("Texte servi")).toBeNull()
    expect(screen.getByRole("note", { name: "Voici ce que votre agent va lire" }).querySelector("details")).toBeNull()
    // E05-S13 (AC-13) : ni note des versions, ni total, ni légende visible (« Ordre de lecture » ne nomme que la liste).
    const encart = screen.getByRole("note", { name: "Voici ce que votre agent va lire" })
    expect(encart.textContent).not.toMatch(/caractères|reflète les versions|Ordre de lecture|complet|coupé|omis/)
    expect(encart.lastElementChild).toBe(apercu().getByRole("list", { name: "Ordre de lecture" }))
  })

  it("should say a failed preview with « Réessayer » on the same address, the rest of the annexes shown", () => {
    monterLesAnnexes({ apercu: { error: "Une erreur est survenue. Réessayez." } })
    expect(apercu().getByRole("alert")).toHaveTextContent("L'aperçu n'a pas pu être calculé.")
    expect(apercu().getByRole("link", { name: "Réessayer" })).toHaveAttribute("href", "/n/ventes/contexte")
    expect(note().getByText("Ce que votre Claude/ChatGPT/Mistral, comme celui de chaque membre de l'équipe Ventes, lit à chaque conversation.")).toBeInTheDocument()
  })
})
