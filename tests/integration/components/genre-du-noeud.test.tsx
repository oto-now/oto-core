import type { ComponentProps, ReactNode } from "react"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { TreeNode } from "@otomata_tech/oto_platform/schemas"
import { ContexteDeLHote, ContexteDeRafraichissement, EcranDeNoeud } from "@otomata_tech/oto_platform/ui"
import { FileDOperations, useFileDOperations } from "../../../packages/plateforme/ui/noeud/editeur/file-d-operations"
import { useTransformation } from "../../../packages/plateforme/ui/noeud/genre-du-noeud"
import { ID, PAGE, simulerLAPI, vueDuNoeud } from "../../helpers/noeud"

// « Transformer en procédure / en page » dans le menu « ⋯ » de l'en-tête d'un contenu (refonte #218) : qui le voit et ce
// qui le bloque, monté par l'écran (lectures en
// `resultat`, seule la lecture des fils de commentaires répond) ; le geste lui-même, monté comme l'en-tête le pose, sous
// la file d'opérations de la page, `fetch` simulé pour `POST /api/platform/nodes`, relecture espionnée. Que la page garde
// son genre après un refus des blocs `call` : `tests/unit/nodes-write.test.ts`.

const CHEMIN = "ventes/modele_relance"
const BLOCS = PAGE.map((bloc) => ({ id: bloc.id, ref: bloc.ref }))
const rafraichir = vi.fn()

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("EcranDeNoeud, « Transformer » in the « ⋯ » menu", () => {
  const noeud = (path: string, kind: TreeNode["kind"], children: TreeNode[] = []): TreeNode => ({ path, kind, title: path, status: "published", children })
  const arbre = (parent: TreeNode["kind"]): TreeNode[] => [noeud("guide", "page", [noeud("ventes", parent, [noeud(CHEMIN, "page")])])]
  const transformer = () => screen.queryByRole("menuitem", { name: /^Transformer en (procédure|page)/ })

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ data: { path: CHEMIN, threads: [], readers: [], mailEnabled: false } }), { status: 200 })),
    )
  })

  function rendre(props: Partial<ComponentProps<typeof EcranDeNoeud>> = {}, parent: TreeNode["kind"] = "page") {
    const Lien = ({ children, ...reste }: { href: string; className?: string; children: ReactNode }) => <a {...reste}>{children}</a>
    render(
      <ContexteDeLHote.Provider value={{ Lien: "a", chemin: "", naviguer: vi.fn() }}>
        <EcranDeNoeud
          chemin={CHEMIN}
          noeud={{ data: vueDuNoeud({ level: 2 }) }}
          arbre={{ data: { tree: arbre(parent), truncated: false } }}
          equipes={{ data: [{ slug: "ventes", name: "Ventes" }] }}
          handle={null}
          nomOrganisation="Démo"
          versionPubliee={false}
          Lien={Lien}
          hrefDuChemin={(chemin) => `/n/${chemin}`}
          prefixeDesPages="/n/"
          {...props}
        />
      </ContexteDeLHote.Provider>,
    )
    const menu = screen.queryByRole("button", { name: "Plus d'actions" })
    if (menu) fireEvent.click(menu)
  }

  it("should offer the gesture after « Télécharger en .md » to who writes a page or a procedure, and to nobody else", () => {
    rendre()
    const entrees = screen.getAllByRole("menuitem").map((entree) => entree.textContent)
    expect(entrees).toEqual(["Télécharger en .md", "Transformer en procédure"])
    expect(transformer()).not.toHaveAttribute("aria-disabled")
    cleanup()

    // Relue en procédure (le genre publié, ou celui du brouillon), le menu suit : le geste inverse.
    rendre({ noeud: { data: vueDuNoeud({ level: 3, kind: "procedure" }) } })
    expect(transformer()).toHaveTextContent("Transformer en page")
    cleanup()

    const absents = [
      { noeud: { data: vueDuNoeud({ level: 1 }) } },
      { versionPubliee: true },
      { noeud: { data: vueDuNoeud({ level: 2, kind: "table", blocks: [], meta: { columns: [{ name: "nom", type: "text" }], key: "nom" } }) } },
      { noeud: { data: vueDuNoeud({ level: 2, kind: "context", path: "ventes/contexte" }) }, chemin: "ventes/contexte" },
    ]
    for (const props of absents) {
      rendre(props)
      expect(transformer(), JSON.stringify(props)).toBeNull()
      cleanup()
    }
  })

  it("should block a page under a procedure, its reason on a second line, and still let a procedure under one become a page", () => {
    rendre({}, "procedure")
    expect(transformer()).toHaveAttribute("aria-disabled", "true")
    expect(transformer()).toHaveTextContent("Rangée sous une procédure : ses sous-étapes restent des pages.")
    cleanup()
    rendre({ noeud: { data: vueDuNoeud({ level: 2, kind: "procedure" }) } }, "procedure")
    expect(transformer()).not.toHaveAttribute("aria-disabled")
  })
})

describe("useTransformation, the gesture", () => {
  let api: ReturnType<typeof simulerLAPI>

  beforeEach(() => {
    api = simulerLAPI()
    rafraichir.mockReset()
  })

  /** L'entrée du menu rendue en bouton, comme le menu la joue : rien n'est choisi tant qu'elle est bloquée. */
  function Transformation(props: Parameters<typeof useTransformation>[0]) {
    const { entree, issue } = useTransformation(props)
    return (
      <>
        <button type="button" aria-disabled={entree.disabled || undefined} onClick={() => !entree.disabled && entree.onSelect?.()}>
          {entree.label}
        </button>
        {entree.meta && <p>{entree.meta}</p>}
        {issue}
      </>
    )
  }

  /** Un autre champ de la page, qui écrit dans le brouillon par la même file. */
  function Ecriture() {
    const { envoyer } = useFileDOperations()
    const ecrire = () => envoyer({ corps: () => ({ ops: [{ op: "append", section: "Objet", text: "Relire." }] }), issue: () => {} })
    return (
      <button type="button" onClick={ecrire}>
        Écrire
      </button>
    )
  }

  function monter(props: Partial<Parameters<typeof useTransformation>[0]> = {}, tampon: string | null = null) {
    return render(
      <ContexteDeRafraichissement.Provider value={rafraichir}>
        <FileDOperations chemin={CHEMIN} revisionPubliee={4} tampon={tampon}>
          <Ecriture />
          <Transformation genre="page" titre="Modèle de relance" sousUneProcedure={false} blocs={BLOCS} {...props} />
        </FileDOperations>
      </ContexteDeRafraichissement.Provider>,
    )
  }

  it("should turn a page or a procedure over in one published write, without confirmation, busy meanwhile, then announce it and read the page again", async () => {
    const sens = [
      ["page", "Transformer en procédure", "procedure", "« Modèle de relance » est maintenant une procédure : l'assistant peut la proposer."],
      ["procedure", "Transformer en page", "page", "« Modèle de relance » est maintenant une page : l'assistant ne la propose plus."],
    ] as const
    for (const [genre, nom, cible, annonce] of sens) {
      api.envoyes.length = 0
      rafraichir.mockReset()
      monter({ genre })
      const relacher = api.retenir()
      const bouton = screen.getByRole("button", { name: nom })
      fireEvent.click(bouton)
      fireEvent.click(bouton)
      await waitFor(() => expect(api.envoyes).toHaveLength(1))
      expect(api.envoyes[0], genre).toEqual({ path: CHEMIN, base_revision: 4, kind: cible, publish: true })
      expect(bouton).toHaveAttribute("aria-disabled", "true")
      relacher()
      expect(await screen.findByText(annonce)).toHaveAttribute("role", "status")
      expect(rafraichir).toHaveBeenCalledTimes(1)
      expect(bouton).not.toHaveAttribute("aria-disabled")
      expect(api.envoyes).toHaveLength(1)
      cleanup()
    }
  })

  it("should let the gesture go with the draft stamp once a write of this page has opened the draft", async () => {
    monter()
    fireEvent.click(screen.getByRole("button", { name: "Écrire" }))
    await waitFor(() => expect(api.envoyes).toHaveLength(1))
    const bouton = screen.getByRole("button", { name: "Transformer en procédure" })
    await waitFor(() => expect(bouton).not.toHaveAttribute("aria-disabled"))
    fireEvent.click(bouton)
    await waitFor(() => expect(api.envoyes).toHaveLength(2))
    expect(api.envoyes[1]).toEqual({ path: CHEMIN, base_revision: 4, draft_stamp: "2026-09-24T10:00:01.000000+00:00", kind: "procedure", publish: true })
  })

  it("should show the writing advice served by the publication, folded and as served, after a page became a procedure", async () => {
    const conseil = "Procedure: no part « When to use it » (or « Quand l'utiliser »): say when to use it, when not, and where to go instead (read path help, section procedures)."
    const publiee = { path: CHEMIN, revision: 5, status: "published", has_draft: false, touched: [], draft_stamp: null, warnings: [conseil] }
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ data: publiee }), { status: 200 })))
    monter()
    fireEvent.click(screen.getByRole("button", { name: "Transformer en procédure" }))
    await screen.findByText("« Modèle de relance » est maintenant une procédure : l'assistant peut la proposer.")
    const titre = screen.getByText("1 avertissement de la publication (texte du service, en anglais)")
    expect(titre.tagName).toBe("SUMMARY")
    expect(titre.closest("details")).not.toHaveAttribute("open")
    expect(within(titre.closest("details") ?? document.body).getByText(conseil)).toBeInTheDocument()
  })

  it("should list the refused call blocks in an alert under the header, each leading to its block, the page left a page and not read again", async () => {
    const refus = { kind: "unknown_function", message: "Unknown function x.unknown.", section: "Appel", block: 1, block_id: ID.code, function: "x.unknown" }
    api.refuser("invalid_arguments", 422, { refusals: [refus] })
    monter()
    fireEvent.click(screen.getByRole("button", { name: "Transformer en procédure" }))
    const alerte = (await screen.findByText("La publication est refusée : 1 problème à corriger.")).closest("[role='alert']")
    expect(alerte).not.toBeNull()
    const liste = within(alerte instanceof HTMLElement ? alerte : document.body)
    expect(liste.getByText("Section « Appel », bloc 1 · x.unknown · fonction inconnue")).toBeInTheDocument()
    expect(liste.getByRole("link", { name: /Aller au bloc/ })).toHaveAttribute("href", `#${ID.code.slice(0, 8)}`)
    expect(screen.getByRole("button", { name: "Transformer en procédure" })).not.toHaveAttribute("aria-disabled")
    expect(screen.getByRole("status").textContent).toBe("")
    expect(rafraichir).not.toHaveBeenCalled()
  })

  it("should block the gesture on a draft this page did not write, said under its name, and send nothing", () => {
    monter({}, "2026-09-24T09:00:00.000000+00:00")
    const bouton = screen.getByRole("button", { name: "Transformer en procédure" })
    expect(bouton).toHaveAttribute("aria-disabled", "true")
    expect(screen.getByText("Un brouillon attend sur cette page. Demandez à l'assistant de le publier ou de l'abandonner, puis rechargez la page.")).toBeInTheDocument()
    fireEvent.click(bouton)
    expect(api.envoyes).toEqual([])
  })
})
