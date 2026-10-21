import type { ComponentProps, ReactNode } from "react"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { NodeView, TreeNode } from "@otomata_tech/oto_platform/schemas"
import { ContexteDeLHote, EcranDeNoeud, EcranDeNoeudChargement } from "@otomata_tech/oto_platform/ui"
import { cheminsCites } from "../../../packages/plateforme/ui/noeud/corps-du-noeud"
import { texteDuBloc } from "../../helpers/champ-du-bloc"
import { avecCle, bloc, ID, PAGE, simulerLAPI, vueDuNoeud } from "../../helpers/noeud"

// L'écran d'un nœud (E05-S02 : AC1 à AC9, AC14, AC17, AC19 ; E05-S09, partie c1 : porté d'oto-frontend ;
// E05-S10, partie b : AC-a7, AC-b4, AC-b6), rendu comme la page de l'hôte le monte : lectures en
// `resultat`, lien de l'hôte marqué, adresse d'un chemin ; la navigation du fil passe par l'hôte
// (`ContexteDeLHote`), espionnée. Le panneau « Partager » a son fichier (`partager.test.tsx`). E05-S11 :
// le titre d'un Contexte (AC-17), une page citée par son titre (AC-26, AC-27). E11-S05 : « Cité dans », « Cite » et
// « Sous-pages » en encarts (lot e), « Télécharger » (lot c), le résumé d'une procédure seule (lot f), la page vide (lot g).

type EcranDeNoeudProps = ComponentProps<typeof EcranDeNoeud>

const naviguer = vi.fn()

afterEach(() => {
  cleanup()
  naviguer.mockReset()
})

function LienDeTest({ children, ...props }: { href: string; className?: string; "aria-current"?: "page"; children: ReactNode }) {
  return (
    <a data-lien-hote="" {...props}>
      {children}
    </a>
  )
}

const noeud = (path: string, kind: TreeNode["kind"], title: string, children: TreeNode[] = []): TreeNode => ({ path, kind, title, status: "published", children })

const ARBRE: TreeNode[] = [
  noeud("guide", "page", "Guide de Démo", [
    noeud("contexte", "context", "Contexte"),
    noeud("ventes", "page", "Ventes", [
      noeud("ventes/contexte", "context", "Contexte"),
      noeud("ventes/modele_relance", "page", "Modèle de relance", [noeud("ventes/modele_relance/exemple", "page", "Exemple")]),
    ]),
  ]),
]

function rendre(props: Partial<EcranDeNoeudProps> = {}) {
  return render(
    <ContexteDeLHote.Provider value={{ Lien: "a", chemin: "", naviguer }}>
      <EcranDeNoeud
        chemin="ventes/modele_relance"
        noeud={{ data: vueDuNoeud() }}
        arbre={{ data: { tree: ARBRE, truncated: false } }}
        equipes={{ data: [{ slug: "ventes", name: "Ventes" }] }}
        handle={null}
        nomOrganisation="Démo"
        versionPubliee={false}
        Lien={LienDeTest}
        hrefDuChemin={(chemin) => `/n/${chemin}`}
        prefixeDesPages="/n/"
        {...props}
      />
    </ContexteDeLHote.Provider>,
  )
}

const fil = () => within(screen.getByRole("navigation", { name: "Chemin" }))
const maillon = (nom: string) => fil().getByRole("button", { name: nom })
/** Les lignes du menu ouvert : leur nom et si elles sont cochées. */
const lignesDuMenu = () => within(screen.getByRole("menu")).getAllByRole("menuitemradio").map((ligne) => [ligne.textContent, ligne.getAttribute("aria-checked")])
// Une référence commence souvent par un chiffre (début d'un `id`) : un sélecteur `#…` la refuserait.
const ancre = (racine: HTMLElement, id: string) => racine.querySelector(`[id="${id}"]`)
const brouillon = (blocs = PAGE, baseRevision = 4): NodeView["draft"] => ({ baseRevision, savedAt: "2026-09-24T10:00:00Z", draftStamp: "2026-09-24T10:00:00.000000+00:00", blocks: blocs, title: null, summary: null, kind: null, meta: null })

describe("EcranDeNoeud, en-tête (AC2 ; AC-a2)", () => {
  it("should show the header of the design system, without any tree in the content: trail, glyph and title, meta and owner, no summary for a page", () => {
    rendre()
    // L'arbre ne vit plus que dans le rail (AC-a2) : le contenu n'en rend aucun.
    expect(screen.queryByRole("navigation", { name: "Arbre des connaissances" })).toBeNull()
    expect(screen.getAllByRole("navigation")).toHaveLength(1)
    expect(fil().queryAllByRole("link")).toHaveLength(0)
    expect(maillon("Modèle de relance")).toHaveAttribute("aria-current", "page")
    expect(maillon("Ventes")).not.toHaveAttribute("aria-current")
    const titre = screen.getByRole("heading", { level: 1 })
    expect(titre).toHaveTextContent("Modèle de relance")
    expect(titre).toHaveClass("oto-page-title")
    // Le résumé d'une page ne se montre pas (E11-S05, AC-f1).
    expect(screen.queryByText("Relancer un devis resté sans réponse.")).toBeNull()
    expect(screen.getByText("modifiée il y a 3 jours, par Claire Morel").closest("p")).toHaveClass("oto-screen-header-meta")
    // Le document est un îlot nommé par son titre, au corps de lecture du design system.
    expect(screen.getByRole("region", { name: "Modèle de relance" })).toHaveClass("oto-island")
  })

  it("should make each link of the trail open its siblings, the current one checked, each leading through the host, an invisible segment staying inert", async () => {
    rendre({ noeud: { data: vueDuNoeud({ path: "ventes/modele_relance/exemple", title: "Exemple", status: "draft", revision: 0, updatedByName: null }) } })
    expect(screen.getByText("modifiée il y a 3 jours")).toBeInTheDocument()

    // La section ouvre les espaces, chacun menant à son Contexte.
    fireEvent.click(maillon("Ventes"))
    expect(lignesDuMenu()).toEqual([
      ["Tout le monde", "false"],
      ["Ventes", "true"],
    ])
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitemradio", { name: "Tout le monde" }))
    expect(naviguer).toHaveBeenCalledWith("/n/contexte")
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull())

    // Un ancêtre visible ouvre ses frères, lui coché ; le choisir y mène.
    fireEvent.click(maillon("Modèle de relance"))
    expect(lignesDuMenu()).toEqual([
      ["Contexte", "false"],
      ["Modèle de relance", "true"],
    ])
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitemradio", { name: "Modèle de relance" }))
    expect(naviguer).toHaveBeenLastCalledWith("/n/ventes/modele_relance")
    cleanup()

    // Un segment invisible reste affiché, sans menu ni destination (H68 : rien n'est deviné) : un texte, jamais un
    // bouton qui ne ferait rien (M31).
    rendre({ noeud: { data: vueDuNoeud({ path: "ventes/archive/vieux", title: "Vieux" }) } })
    expect(fil().queryByRole("button", { name: "archive" })).toBeNull()
    expect(fil().getByText("archive").closest(".oto-breadcrumb-item")?.tagName).toBe("SPAN")
    expect(fil().getByText("Vieux").closest(".oto-breadcrumb-item")).toHaveAttribute("aria-current", "page")
  })
})

describe("EcranDeNoeud, la ligne sous le titre (E05-S10, AC-a7)", () => {
  it("should keep « modifiée <quand>, par <qui> » and open, on hover and on focus, a tooltip with the type, state, revision and owner", async () => {
    rendre({ noeud: { data: vueDuNoeud({ owner: { kind: "user", userName: "Claire Morel" } }) } })
    const meta = screen.getByText("modifiée il y a 3 jours, par Claire Morel")
    expect(meta.closest("p")).toHaveClass("oto-screen-header-meta")
    // Ni type, ni état, ni révision dans la ligne : ils passent dans l'infobulle.
    expect(document.querySelector(".oto-screen-header-meta")?.textContent).toBe("modifiée il y a 3 jours, par Claire Morel")
    expect(screen.queryByText(/^Propriétaire :/)).toBeNull()
    expect(screen.queryByRole("tooltip")).toBeNull()

    act(() => meta.focus())
    const infobulle = await screen.findByRole("tooltip")
    expect(meta).toHaveAttribute("aria-describedby", infobulle.id)
    const faits = within(infobulle)
      .getAllByRole("term")
      .map((intitule) => [intitule.textContent, intitule.nextElementSibling?.textContent])
    expect(faits).toEqual([
      ["Type", "Page"],
      ["État", "Publiée"],
      ["Révision", "4"],
      ["Propriétaire", "Claire Morel (Privé)"],
    ])
    fireEvent.keyDown(meta, { key: "Escape" })
    expect(screen.queryByRole("tooltip")).toBeNull()

    fireEvent.mouseEnter(meta)
    expect(await screen.findByRole("tooltip")).toBeInTheDocument()
    cleanup()

    // Un tableau jamais publié : l'accord au masculin, l'état et ses lignes dans l'infobulle, sans le mot
    // « brouillon » (E11-S02, AC-c4).
    rendre({ noeud: { data: vueDuNoeud({ kind: "table", status: "draft", revision: 0, blocks: [], rowsTotal: 12, updatedByName: null }) } })
    const tableau = screen.getByText("modifié il y a 3 jours")
    act(() => tableau.focus())
    expect(await screen.findByRole("tooltip")).toHaveTextContent("TypeTableauÉtatNon publiéRévisionaucuneLignes12 lignesPropriétaireéquipe Ventes (responsable : Claire Morel)")
  })
})

describe("EcranDeNoeud, encarts et blocs (AC4 ; E11-S05, lot e)", () => {
  const ENFANT = { path: "ventes/modele_relance/exemple", title: "Exemple", summary: "Un cas réel.", kind: "procedure" as const, status: "published" as const }
  const NOTE = { path: "ventes/modele_relance/note", title: "Note", summary: "Un résumé de page.", kind: "page" as const, status: "published" as const }
  const LIENS = {
    links_out: [
      { path: "ventes/grille", key: "tarifs", title: "Grille", status: "ok" },
      { path: "ventes/grille", key: "remises", title: "Grille", status: "ok" },
      { path: "ventes/ancien", status: "moved", title: "Nouveau", moved_to: "conseil/nouveau" },
      { path: "ventes/perdu", status: "missing" },
    ],
    links_out_total: 4,
    links_in: [{ path: "conseil/guide", title: "Guide du conseil" }],
    links_in_total: 1,
  }
  /** Les encarts rendus, dans l'ordre du document : le texte de leur `summary` (titre et total). */
  const encarts = (racine: ParentNode = document) => Array.from(racine.querySelectorAll("details.oto-linked")).map((repli) => repli.querySelector("summary")?.textContent)
  const encart = (titre: string) => {
    const repli = screen.getByText(titre, { selector: "strong" }).closest("details")
    if (!repli) throw new Error(`encart ${titre} absent`)
    return repli
  }

  it("should put « Cité dans », « Cite » and « Sous-pages » in the right column, in this order, folded, each with its total (AC-e1, AC-f2)", async () => {
    await act(async () => {
      rendre({ noeud: { data: vueDuNoeud({ children: [ENFANT, NOTE], childrenTotal: 2 }) }, liens: Promise.resolve({ data: LIENS }) })
    })
    await waitFor(() => expect(encarts()).toEqual(["Cité dans1", "Cite3", "Sous-pages2"]))
    const colonne = document.querySelector(".oto-two-columns-aside")
    if (!colonne) throw new Error("colonne de droite absente")
    expect(encarts(colonne)).toHaveLength(3)
    expect(Array.from(colonne.querySelectorAll("details")).some((repli) => repli.hasAttribute("open"))).toBe(false)
    // Le document est dans la colonne principale d'un `TwoColumns main="document"`.
    expect(screen.getByRole("region", { name: "Modèle de relance" }).closest(".oto-two-columns-main")?.parentElement).toHaveAttribute("data-main", "document")
    expect(screen.queryByText("Contenus liés")).toBeNull()
    expect(screen.queryByText(/Mentionn/)).toBeNull()

    const sousPages = within(within(encart("Sous-pages")).getByRole("list", { name: "Sous-pages" }))
    // Chaque nœud dessous ne dit que sa nature, sans résumé, procédure comprise (E11-S15, AC-a2).
    expect(sousPages.getAllByRole("link").map((lien) => [lien.textContent, lien.getAttribute("href")])).toEqual([
      ["ExempleProcédure", "/n/ventes/modele_relance/exemple"],
      ["NotePage", "/n/ventes/modele_relance/note"],
    ])
    const cite = within(within(encart("Cite")).getByRole("list", { name: "Cite" }))
    // Deux ancres d'un même contenu : une ligne ; un contenu rangé ailleurs mène à sa nouvelle place ; sans cible, un texte.
    expect(cite.getAllByRole("link").map((lien) => [lien.textContent, lien.getAttribute("href")])).toEqual([
      ["Grille", "/n/ventes/grille"],
      ["Nouveaudéplacé vers conseil/nouveau", "/n/conseil/nouveau"],
    ])
    expect(cite.getByText("ventes/perdu").closest("li")).toHaveAttribute("data-broken")
    expect(cite.getByText("sans cible")).toBeInTheDocument()
    const citeDans = within(within(encart("Cité dans")).getByRole("list", { name: "Cité dans" }))
    expect(citeDans.getAllByRole("link").map((lien) => [lien.textContent, lien.getAttribute("href")])).toEqual([["Guide du conseil", "/n/conseil/guide"]])
  })

  it("should leave out an encart whose total is 0, count what the service did not serve, and keep the right column empty when nothing is linked (AC-e1, HN-E11S05-13)", async () => {
    await act(async () => {
      rendre({ liens: Promise.resolve({ data: { links_out: [], links_out_total: 0, links_in: [{ path: "conseil/guide", title: "Guide du conseil" }], links_in_total: 1 } }) })
    })
    await waitFor(() => expect(encarts()).toEqual(["Cité dans1"]))
    cleanup()

    // Le service ne sert que les premiers nœuds dessous : le nombre est le total.
    rendre({ noeud: { data: vueDuNoeud({ children: [ENFANT], childrenTotal: 60 }) } })
    expect(encarts()).toEqual(["Sous-pages60"])
    expect(within(encart("Sous-pages")).getByText("et 59 autres")).toBeInTheDocument()
    cleanup()

    await act(async () => {
      rendre({ liens: Promise.resolve({ data: { links_out: [], links_out_total: 0, links_in: [], links_in_total: 0 } }) })
    })
    expect(screen.getByRole("region", { name: "Modèle de relance" })).toBeInTheDocument()
    expect(encarts()).toEqual([])
    // La colonne garde sa piste : le document ne bouge pas quand les liens arrivent.
    expect(document.querySelector(".oto-two-columns-aside")).not.toBeNull()
  })

  it("should say « Lecture des liens… » while the links are read, then their failure with « Réessayer », even without a sub-page (AC-e4)", async () => {
    let servir: (lu: { error: string }) => void = () => {}
    const liens = new Promise<{ error: string }>((resolve) => (servir = resolve))
    await act(async () => {
      rendre({ liens })
    })
    expect(screen.getByRole("status")).toHaveTextContent("Lecture des liens…")
    await act(async () => {
      servir({ error: "Une erreur est survenue. Réessayez." })
    })
    const colonne = within(document.querySelector<HTMLElement>(".oto-two-columns-aside") ?? document.body)
    await waitFor(() => expect(colonne.getByRole("alert")).toHaveTextContent("Une erreur est survenue. Réessayez."))
    expect(colonne.getByRole("link", { name: "Réessayer" })).toHaveAttribute("href", "/n/ventes/modele_relance")
    expect(screen.queryByText("Lecture des liens…")).toBeNull()
  })

  it("should put the encarts of a table on a line above its grid, which keeps the full width (AC-e3)", async () => {
    await act(async () => {
      rendre({
        noeud: { data: vueDuNoeud({ kind: "table", blocks: [], children: [NOTE], childrenTotal: 1 }) },
        liens: Promise.resolve({ data: LIENS }),
        complement: <p>La grille du tableau</p>,
      })
    })
    await waitFor(() => expect(encarts()).toEqual(["Cité dans1", "Cite3", "Sous-pages1"]))
    expect(document.querySelector(".oto-two-columns")).toBeNull()
    const ligne = encart("Cité dans").parentElement
    expect(ligne).toBe(encart("Sous-pages").parentElement)
    expect(ligne?.compareDocumentPosition(screen.getByText("La grille du tableau")) ?? 0).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    const cadre = screen.getByText("La grille du tableau").closest(".oto-content-max")
    expect(cadre).not.toHaveAttribute("data-width")
  })

  it("should render each block by its type, in order, with its reference as anchor, its inline text marked and no HTML injected", () => {
    const blocs = [
      avecCle(bloc(ID.titre, "heading", "Objet", { level: 1 }), "objet"),
      bloc("10000000-0000-4000-8000-000000000010", "heading", "Détails", { level: 3 }),
      bloc("20000000-0000-4000-8000-000000000020", "paragraph", "Ligne un\nLigne <b>deux</b>"),
      bloc("21000000-0000-4000-8000-000000000021", "paragraph", "Voir **[[ventes/grille#tarifs|les tarifs]]**, `sql` et *vite*"),
      bloc("30000000-0000-4000-8000-000000000030", "paragraph", "| a | b |\n| 1 | 2 |"),
      bloc("40000000-0000-4000-8000-000000000040", "list", null, { items: ["Lire", "Écrire"], ordered: true, start: 3 }),
      bloc("50000000-0000-4000-8000-000000000050", "checklist", null, { items: [{ text: "Relire", checked: true }, { text: "Envoyer", checked: false }] }),
      bloc("60000000-0000-4000-8000-000000000060", "code", "select 1", { language: "sql" }),
      bloc("70000000-0000-4000-8000-000000000070", "call", null, { function: "mail.create_draft", args: { to: "x" } }),
      bloc("80000000-0000-4000-8000-000000000080", "mermaid", "graph TD"),
      bloc("90000000-0000-4000-8000-000000000090", "image", "Le plan", { src: "https://exemple.test/plan.png", alt: "Plan" }),
      bloc("a0000000-0000-4000-8000-0000000000a0", "image", null, { src: "javascript:alert(1)", alt: "Piège" }),
      bloc("b0000000-0000-4000-8000-0000000000b0", "callout", "Attention au **délai**"),
      bloc("c0000000-0000-4000-8000-0000000000c0", "reference", null, { path: "ventes/suivi", view: { limit: 5 } }),
      bloc("d0000000-0000-4000-8000-0000000000d0", "row", null),
    ]
    const { container } = rendre({ noeud: { data: vueDuNoeud({ blocks: blocs }) }, arbre: { data: { tree: [...ARBRE, noeud("ventes/grille", "page", "Grille")], truncated: false } } })
    expect(screen.getByRole("heading", { level: 2, name: "Objet" })).toHaveAttribute("id", "objet")
    // Un titre prend la balise de son niveau (E10-S04, AC-b3, qui remplace E05-S10 AC-a5) : un niveau 3 en `h4`.
    expect(screen.getByRole("heading", { level: 4, name: "Détails" })).toHaveAttribute("id", "10000000")
    const paragraphe = ancre(container, "20000000")
    expect(paragraphe?.tagName).toBe("P")
    expect(paragraphe?.textContent).toBe("Ligne un\nLigne <b>deux</b>")
    expect(container.querySelector("b")).toBeNull()
    // Le texte en ligne (AC5) : le lien interne est celui de l'hôte, vers le bloc de clé `tarifs`, en gras ; sa
    // cible est une page de l'arbre visible (E05-S11, AC-26).
    const tarifs = screen.getByRole("link", { name: "les tarifs" })
    expect(tarifs).toHaveAttribute("href", "/n/ventes/grille#tarifs")
    expect(tarifs).toHaveAttribute("data-lien-hote")
    expect(tarifs.parentElement?.tagName).toBe("STRONG")
    expect(screen.getByText("sql").tagName).toBe("CODE")
    expect(screen.getByText("vite").tagName).toBe("EM")
    expect(ancre(container, "30000000")?.tagName).toBe("PRE")
    expect(ancre(container, "40000000")).toHaveAttribute("start", "3")
    expect(ancre(container, "40000000")?.tagName).toBe("OL")
    expect(within(screen.getByText("Relire").closest("li") ?? document.body).getByText("(fait)")).toBeInTheDocument()
    expect(within(screen.getByText("Envoyer").closest("li") ?? document.body).getByText("(à faire)")).toBeInTheDocument()
    expect(screen.getByText("Code · sql")).toBeInTheDocument()
    // Un appel déjà écrit se lit comme un texte (M59) : sa fonction, puis ses arguments.
    expect(ancre(container, "70000000")?.tagName).toBe("P")
    expect(ancre(container, "70000000")?.textContent).toBe('Appel de mail.create_draft : { "to": "x" }')
    expect(screen.getByText("Diagramme (texte)")).toBeInTheDocument()
    expect(screen.getByRole("img", { name: "Plan" })).toHaveAttribute("src", "https://exemple.test/plan.png")
    // L'hôte de l'image ne reçoit pas l'adresse de la page qui l'affiche.
    expect(screen.getByRole("img", { name: "Plan" })).toHaveAttribute("referrerpolicy", "no-referrer")
    expect(screen.getByText("Le plan").tagName).toBe("FIGCAPTION")
    expect(screen.getByText("Image non affichée : adresse non sûre. Piège")).toBeInTheDocument()
    expect(screen.queryByRole("img", { name: "Piège" })).toBeNull()
    expect(within(screen.getByRole("note")).getByText("délai").tagName).toBe("STRONG")
    // Un contenu cité est un encart, rangé ailleurs, son nom portant le lien de l'hôte.
    const cite = screen.getByRole("link", { name: "ventes/suivi" })
    expect(cite).toHaveAttribute("href", "/n/ventes/suivi")
    expect(cite.closest(".oto-embed")).toHaveTextContent("rangé ailleurs")
    expect(screen.getByText("Bloc de type « row » non affiché ici.")).toBeInTheDocument()
  })
})

describe("EcranDeNoeud, pages citées dans la phrase (E05-S11, AC-26, AC-27)", () => {
  const CITANT = bloc("21000000-0000-4000-8000-000000000021", "paragraph", "Voir [[ventes/grille]], [[ventes/grille|la grille]], [[ventes/ancien]] et [[ventes/perdu]].")
  /** Le paragraphe rendu du bloc citant, qui doit être là. */
  const citant = () => {
    const element = ancre(document.body, "21000000")
    if (!(element instanceof HTMLElement)) throw new Error("le bloc 21000000 n'est pas rendu")
    return element
  }

  it("should name each cited page by its label, else its title, a page with no visible target in plain text, then follow a moved one once the links are read", async () => {
    let servir: (lu: { data: Record<string, unknown> }) => void = () => {}
    const liens = new Promise<{ data: Record<string, unknown> }>((resolve) => (servir = resolve))
    const arbre = [...ARBRE, noeud("ventes/grille", "page", "Grille tarifaire")]
    await act(async () => {
      rendre({ noeud: { data: vueDuNoeud({ blocks: [CITANT] }) }, arbre: { data: { tree: arbre, truncated: false } }, liens })
    })
    const paragraphe = () => within(citant())
    // Avant les liens : le titre lu dans l'arbre, le libellé écrit ; hors de l'arbre, un texte sans lien, par son dernier segment.
    expect(paragraphe().getAllByRole("link").map((lien) => [lien.textContent, lien.getAttribute("href")])).toEqual([
      ["Grille tarifaire", "/n/ventes/grille"],
      ["la grille", "/n/ventes/grille"],
    ])
    expect(ancre(document.body, "21000000")?.textContent).toBe("Voir Grille tarifaire, la grille, ancien et perdu.")
    // Les liens lus : un contenu déplacé mène à sa nouvelle place, sous son titre ; un contenu sans cible reste un texte.
    await act(async () => {
      servir({ data: { links_out: [{ path: "ventes/ancien", status: "moved", title: "Nouveau", moved_to: "conseil/nouveau" }, { path: "ventes/perdu", status: "missing" }], links_out_total: 2, links_in: [], links_in_total: 0 } })
    })
    await waitFor(() => expect(paragraphe().getByRole("link", { name: "Nouveau" })).toHaveAttribute("href", "/n/conseil/nouveau"))
    expect(paragraphe().queryByRole("link", { name: "perdu" })).toBeNull()
    expect(ancre(document.body, "21000000")?.textContent).toBe("Voir Grille tarifaire, la grille, Nouveau et perdu.")
  })

  it("should keep the link of a page missing from a truncated tree, named by its last segment: the page may lie past the cut", () => {
    const arbre = [...ARBRE, noeud("ventes/grille", "page", "Grille tarifaire")]
    rendre({ noeud: { data: vueDuNoeud({ blocks: [CITANT] }) }, arbre: { data: { tree: arbre, truncated: true } } })
    const paragraphe = within(citant())
    expect(paragraphe.getAllByRole("link").map((lien) => [lien.textContent, lien.getAttribute("href")])).toEqual([
      ["Grille tarifaire", "/n/ventes/grille"],
      ["la grille", "/n/ventes/grille"],
      ["ancien", "/n/ventes/ancien"],
      ["perdu", "/n/ventes/perdu"],
    ])
  })

  it("should read the pages cited by a table cell, a toggle summary and body outside its fences, and a sub-item (E10-S04, AC-a4)", () => {
    const blocs = [
      bloc("22000000-0000-4000-8000-000000000022", "simple_table", null, { columns: ["Nom", "Page"], rows: [["Devis", "[[ventes/cellule]]"]] }),
      bloc("23000000-0000-4000-8000-000000000023", "toggle", "Voir [[ventes/corps]].\n```\n[[ventes/cloture]]\n```\nFin.", { summary: "Le [[ventes/resume]]" }),
      bloc("24000000-0000-4000-8000-000000000024", "list", null, { items: [{ text: "Lire", children: { items: ["[[ventes/sous_element]]"] } }] }),
    ]
    expect(cheminsCites(blocs)).toEqual(["ventes/cellule", "ventes/resume", "ventes/corps", "ventes/sous_element"])
  })
})

describe("EcranDeNoeud, titre d'un Contexte (E05-S11, AC-17)", () => {
  it.each([
    ["Tout le monde", "contexte", null],
    ["a team", "ventes/contexte", null],
    ["Privé", "private/claire/contexte", "claire"],
  ] as const)("should title the Contexte of %s « Contexte · <section> », never in place, the saved title unchanged", (_section, path, handle) => {
    const titres = { contexte: "Contexte · Tout le monde", "ventes/contexte": "Contexte · Ventes", "private/claire/contexte": "Contexte · Privé" }
    rendre({ chemin: path, handle, noeud: { data: vueDuNoeud({ path, kind: "context", title: "Contexte de l'organisation", level: 3 }) } })
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(titres[path])
    expect(screen.queryByRole("textbox", { name: "Titre" })).toBeNull()
    expect(screen.queryByText("Contexte de l'organisation")).toBeNull()
    expect(fil().getByText(titres[path]).closest(".oto-breadcrumb-item")).toHaveAttribute("aria-current", "page")
  })
})

describe("EcranDeNoeud, états (AC6, AC7)", () => {
  it("should render the loading state, a failed read with « Réessayer » on the same address, an empty page, and a table without editor", () => {
    render(<EcranDeNoeudChargement />)
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true")
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Chargement de la page…")
    cleanup()

    rendre({ noeud: { error: "Une erreur est survenue. Réessayez." }, arbre: { error: "Une erreur est survenue. Réessayez." }, versionPubliee: true })
    expect(screen.getByRole("alert")).toHaveTextContent("Ce contenu n'a pas pu être chargéUne erreur est survenue. Réessayez.")
    expect(screen.getByRole("link", { name: "Réessayer" })).toHaveAttribute("href", "/n/ventes/modele_relance?version=published")
    cleanup()

    // Les équipes illisibles : la page le dit, le fil ne devine pas la section d'équipe.
    rendre({ equipes: { error: "Une erreur est survenue. Réessayez." } })
    expect(screen.getByRole("alert")).toHaveTextContent("Une erreur est survenue. Réessayez.")
    expect(screen.getByRole("link", { name: "Réessayer" })).toHaveAttribute("href", "/n/ventes/modele_relance")
    expect(fil().queryByText("Tout le monde")).toBeNull()
    expect(fil().getByText("ventes")).toBeInTheDocument()
    cleanup()

    // Lue, une page vide le dit (E11-S05, AC-g3) ; écrite, l'éditeur montre un Texte vide et son invite (AC-g1).
    rendre({ noeud: { data: vueDuNoeud({ blocks: [] }) } })
    expect(screen.getByText("Cette page n'a pas encore de contenu.")).toBeInTheDocument()
    expect(screen.queryByRole("textbox")).toBeNull()
    cleanup()

    rendre({ noeud: { data: vueDuNoeud({ blocks: [], level: 2 }) } })
    expect(screen.queryByText("Cette page n'a pas encore de contenu.")).toBeNull()
    expect(screen.queryByRole("button", { name: "Commencer à écrire" })).toBeNull()
    expect(screen.getByRole("textbox", { name: /^Modifier ce texte/ })).toHaveAttribute("placeholder", "Commencer à écrire... Utilisez '/' pour afficher tous les types de blocs - Utilisez '@' pour citer un autre contenu (page, tableau, procédure) de l'espace")
    cleanup()

    rendre({ noeud: { data: vueDuNoeud({ kind: "table", blocks: [], level: 2 }) }, complement: <p>La grille du tableau</p> })
    expect(screen.getByText("La grille du tableau")).toBeInTheDocument()
    expect(screen.queryByText("Cette page n'a pas encore de contenu.")).toBeNull()
    expect(screen.queryByRole("button", { name: /^Actions sur ce bloc/ })).toBeNull()
  })
})

describe("EcranDeNoeud, contrôles selon le niveau (AC8, AC20)", () => {
  it("should give no control to a reader", () => {
    rendre()
    expect(screen.queryByRole("textbox")).toBeNull()
    expect(screen.queryByRole("button", { name: /^Actions sur ce bloc/ })).toBeNull()
  })

  // « Déplacer » a quitté l'en-tête (E05-S13, AC-20) : `tests/integration/components/e05s13-coque.test.tsx`.
  it("should give a writer the block controls, the title in place, the summary of a procedure only, and the publication without a button, as a manager, a table's draft included (E11-S02, AC-c2)", () => {
    rendre({ noeud: { data: vueDuNoeud({ level: 2 }) } })
    expect(screen.getByRole("button", { name: "Ajouter un bloc après — Objet de la relance" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Actions sur ce bloc — Objet de la relance" })).toBeInTheDocument()
    // Un bloc qu'on ne touche pas se lit (1.1.3) : son texte brut, sans champ monté.
    expect(texteDuBloc("Modifier ce texte — Objet de la relance")).toBe("Objet de la relance")
    // Le titre s'écrit en place (E05-S10, AC-a1), dans le `<h1>` ; le résumé d'une page, ni lu ni écrit (E11-S05, AC-f1).
    expect(screen.getByRole("textbox", { name: "Titre" })).toHaveValue("Modèle de relance")
    expect(screen.getByRole("textbox", { name: "Titre" }).closest("h1")).not.toBeNull()
    expect(screen.queryByRole("textbox", { name: "Résumé" })).toBeNull()
    // Écrire publie (E11-S02, AC-c2) : la publication seule, sans phrase « La publication revient… ».
    expect(screen.getByRole("group", { name: "Publication" })).toBeInTheDocument()
    expect(screen.queryByText(/La publication revient/)).toBeNull()
    expect(screen.queryByRole("button", { name: "Publier" })).toBeNull()
    cleanup()

    // Une procédure : son résumé, en champ dès l'écriture, lu au niveau lecture (AC-f1).
    rendre({ noeud: { data: vueDuNoeud({ kind: "procedure", level: 2 }) } })
    expect(screen.getByRole("textbox", { name: "Résumé" })).toHaveValue("Relancer un devis resté sans réponse.")
    cleanup()
    rendre({ noeud: { data: vueDuNoeud({ kind: "procedure" }) } })
    expect(screen.getByText("Relancer un devis resté sans réponse.")).toBeInTheDocument()
    cleanup()

    // Au niveau gestion, aucun bouton « Publier » ni phrase : la publication part seule (E05-S10, AC-a6).
    rendre({ noeud: { data: vueDuNoeud({ level: 3, draft: brouillon() }) } })
    expect(screen.getByRole("group", { name: "Publication" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Publier" })).toBeNull()
    expect(screen.queryByText(/^La publication revient/)).toBeNull()
    cleanup()

    // Un tableau n'a pas d'éditeur de blocs, mais son brouillon se publie (AC9, AC17), son en-tête écrit en place
    // (AC-a10), sans bandeau (E11-S02, AC-c3), au niveau écriture comme à la gestion.
    rendre({ noeud: { data: vueDuNoeud({ kind: "table", blocks: [], level: 2, draft: brouillon([]) }) }, complement: <p>La grille du tableau</p> })
    expect(screen.queryByText(/Brouillon non publié/)).toBeNull()
    expect(screen.getByRole("group", { name: "Publication" })).toBeInTheDocument()
    expect(screen.getByRole("textbox", { name: "Titre" })).toBeInTheDocument()
    expect(screen.queryByRole("textbox", { name: "Résumé" })).toBeNull()
    expect(screen.queryByRole("button", { name: /^Actions sur ce bloc/ })).toBeNull()
  })

  it("should open a node just created from the rail with its title field focused and selected, and no other node (E05-S10, AC-b3 ; E11-S02, AC-c5)", async () => {
    // Créé publié par « + » (révision 1) : reconnu à son titre seul (HN-E11S02-29).
    rendre({ noeud: { data: vueDuNoeud({ level: 2, title: "Sans titre", summary: "À compléter.", revision: 1, blocks: [] }) } })
    const titre = screen.getByRole("textbox", { name: "Titre" })
    await waitFor(() => expect(document.activeElement).toBe(titre))
    // Sélectionné entier : la première frappe remplace « Sans titre ».
    expect(titre).toHaveProperty("selectionStart", 0)
    expect(titre).toHaveProperty("selectionEnd", "Sans titre".length)
    cleanup()

    // Déjà nommé, publié ou non : le focus reste où il est.
    for (const surcharge of [{ title: "Modèle de relance" }, { title: "Modèle de relance", status: "draft" as const, revision: 0 }]) {
      rendre({ noeud: { data: vueDuNoeud({ level: 3, ...surcharge }) } })
      expect(document.activeElement).toBe(document.body)
      cleanup()
    }
  })

  it("should take a new node from its title to its empty Texte with Entrée, and open an empty page with a title in its Texte (E11-S05, AC-g2)", async () => {
    simulerLAPI()
    rendre({ noeud: { data: vueDuNoeud({ level: 2, title: "Sans titre", blocks: [] }) } })
    const titre = screen.getByRole("textbox", { name: "Titre" })
    await waitFor(() => expect(document.activeElement).toBe(titre))
    fireEvent.change(titre, { target: { value: "Relances de novembre" } })
    fireEvent.keyDown(titre, { key: "Enter" })
    const texte = screen.getByRole("textbox", { name: /^Modifier ce texte/ })
    await waitFor(() => expect(document.activeElement).toBe(texte))
    cleanup()
    vi.unstubAllGlobals()

    rendre({ noeud: { data: vueDuNoeud({ level: 2, blocks: [] }) } })
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("textbox", { name: /^Modifier ce texte/ })))
  })
})

describe("EcranDeNoeud, brouillon (AC9 ; E11-S02, AC-c3)", () => {
  it("should show the pending draft without banner, notice or link, at every writing level, and the published version on ?version=published; a reader sees neither", () => {
    const blocsDuBrouillon = [bloc(ID.objet, "paragraph", "Texte du brouillon")]
    // Un brouillon laissé par un assistant (`publish: false`) ou refusé : rien ne le signale ; la frappe suivante le publie.
    for (const level of [2, 3] as const) {
      rendre({ noeud: { data: vueDuNoeud({ level, draft: brouillon(blocsDuBrouillon) }) } })
      expect(screen.queryByText(/Brouillon non publié|^Brouillon/)).toBeNull()
      expect(screen.queryByRole("link", { name: "Voir la version publiée" })).toBeNull()
      expect(texteDuBloc("Modifier ce texte — Texte du brouillon")).toBe("Texte du brouillon")
      expect(screen.queryByText("Objet de la relance")).toBeNull()
      cleanup()
    }

    // La version publiée se lit, comme pour un lecteur : aucun champ (E05-S08, AC1) ; l'adresse reste (HN-E11S02-25).
    rendre({ noeud: { data: vueDuNoeud({ level: 2, draft: brouillon(blocsDuBrouillon) }) }, versionPubliee: true })
    expect(screen.getByText("Version publiée (révision 4).")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Revenir aux modifications en attente" })).toHaveAttribute("href", "/n/ventes/modele_relance")
    expect(screen.getByText("Objet de la relance")).toBeInTheDocument()
    expect(screen.queryByRole("textbox")).toBeNull()
    cleanup()

    rendre({ noeud: { data: vueDuNoeud({ level: 2, status: "draft", revision: 0, blocks: [], draft: brouillon(blocsDuBrouillon, 0) }) } })
    expect(screen.queryByText(/Brouillon non publié/)).toBeNull()
    cleanup()

    rendre({ versionPubliee: true })
    expect(screen.queryByText(/^Brouillon non publié|^Version publiée/)).toBeNull()
    expect(screen.queryByRole("link", { name: "Revenir aux modifications en attente" })).toBeNull()
  })
})

describe("EcranDeNoeud, sections toujours visibles comme titres (AC14 ; E05-S08, AC7)", () => {
  const TITRES = [
    avecCle(bloc(ID.titre, "heading", "Objet", { level: 1 }), "objet"),
    bloc(ID.objet, "paragraph", "Objet de la relance"),
    bloc("10000000-0000-4000-8000-000000000010", "heading", "Détails **utiles**", { level: 2 }),
    bloc("20000000-0000-4000-8000-000000000020", "heading", "Cas", { level: 3 }),
  ]
  // Le nom d'un titre : son texte rendu, ou, pour un titre écrit, le texte de son champ sans balisage (`aria-label`).
  const plan = () => screen.getAllByRole("heading").map((titre) => [titre.tagName, titre.getAttribute("aria-label") ?? titre.textContent])

  it("should give a writer the reader's outline, each heading field mounted in its heading element", () => {
    rendre({ noeud: { data: vueDuNoeud({ blocks: TITRES }) } })
    const lecteur = plan()
    // Un titre de niveau N en `h(N+1)` (E10-S04, AC-b3, qui remplace E05-S10 AC-a5), au repos dans l'éditeur aussi.
    expect(lecteur).toEqual([
      ["H1", "Modèle de relance"],
      ["H2", "Objet"],
      ["H3", "Détails utiles"],
      ["H4", "Cas"],
    ])
    cleanup()

    rendre({ noeud: { data: vueDuNoeud({ blocks: TITRES, level: 2 }) } })
    expect(plan()).toEqual(lecteur)
    const champ = screen.getByRole("textbox", { name: "Modifier ce titre — Détails utiles" })
    expect(texteDuBloc("Modifier ce titre — Détails utiles")).toBe("Détails **utiles**")
    expect(champ.closest("h3")).toHaveAttribute("id", "10000000")
  })
})

describe("EcranDeNoeud, accès et partage (AC19 ; E05-S10, AC-b5)", () => {
  const partage = (surcharge: Partial<NonNullable<EcranDeNoeudProps["partage"]>> = {}): EcranDeNoeudProps["partage"] => ({
    regles: { data: { path: "ventes/modele_relance", title: "Modèle de relance", owner: { kind: "team", teamName: "Ventes" }, viewerLevel: 3, rules: [] } },
    sujets: { data: { equipes: [{ id: "t-conseil", nom: "Conseil" }], personnes: [] } },
    gestionAccordable: false,
    moi: null,
    ...surcharge,
  })

  it("should open « Partager » from « Partager · <espace> » of the header, clear a search on a first Escape, close on the next and give the focus back", async () => {
    rendre({ partage: partage() })
    const partager = screen.getByRole("button", { name: "Partager · Ventes" })
    expect(partager).toHaveAttribute("aria-expanded", "false")
    act(() => partager.focus())
    fireEvent.click(partager)
    const panneau = screen.getByRole("dialog", { name: "Partager — Ventes" })
    expect(partager).toHaveAttribute("aria-expanded", "true")
    await waitFor(() => expect(document.activeElement).toBe(panneau))
    const champ = within(panneau).getByRole("combobox", { name: "Ajouter une personne ou une équipe" })
    fireEvent.change(champ, { target: { value: "cons" } })
    fireEvent.keyDown(champ, { key: "Escape" })
    expect(champ).toHaveValue("")
    expect(screen.getByRole("dialog", { name: "Partager — Ventes" })).toBeInTheDocument()
    fireEvent.keyDown(champ, { key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(document.activeElement).toBe(partager)
  })
})

describe("EcranDeNoeud, réglages d'un tableau (E11-S01, AC-g1, AC-g6)", () => {
  const ENTETE = { columns: [{ name: "entreprise", type: "text" }], key: "entreprise" }
  const tableau = (surcharge: Partial<NodeView> = {}) => vueDuNoeud({ kind: "table", blocks: [], meta: ENTETE, ...surcharge })
  const partage: EcranDeNoeudProps["partage"] = {
    regles: { data: { path: "ventes/modele_relance", title: "Modèle de relance", owner: { kind: "team", teamName: "Ventes" }, viewerLevel: 3, rules: [] } },
    sujets: { data: { equipes: [], personnes: [] } },
    gestionAccordable: false,
    moi: null,
  }
  const reglages = () => screen.queryByRole("button", { name: "Réglages" })

  it("should put « Réglages » after « Télécharger en .csv » and before « Partager · <espace> » for a table read at the write or manage level, and open « Réglages du tableau »", () => {
    for (const level of [2, 3] as const) {
      rendre({ noeud: { data: tableau({ level }) }, partage, complement: <p>La grille du tableau</p> })
      const bouton = screen.getByRole("button", { name: "Réglages" })
      const telecharger = screen.getByRole("button", { name: "Télécharger en .csv" })
      const partager = screen.getByRole("button", { name: "Partager · Ventes" })
      expect(bouton.closest(".oto-screen-header-access")).toBe(partager.closest(".oto-screen-header-access"))
      expect(telecharger.closest(".oto-screen-header-access")).toBe(partager.closest(".oto-screen-header-access"))
      expect(telecharger.compareDocumentPosition(bouton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(bouton.compareDocumentPosition(partager) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      fireEvent.click(bouton)
      expect(screen.getByRole("dialog", { name: "Réglages du tableau" })).toBeInTheDocument()
      cleanup()
    }
  })

  it("should give no « Réglages » to a reader, on ?version=published, or to a page, a procedure or a Contexte", () => {
    rendre({ noeud: { data: tableau({ level: 1 }) }, partage })
    expect(reglages()).toBeNull()
    cleanup()
    rendre({ noeud: { data: tableau({ level: 2 }) }, partage, versionPubliee: true })
    expect(reglages()).toBeNull()
    cleanup()
    for (const kind of ["page", "procedure", "context"] as const) {
      rendre({ noeud: { data: vueDuNoeud({ kind, level: 2, meta: ENTETE }) }, partage })
      expect(reglages()).toBeNull()
      cleanup()
    }
  })

  it("should block the panel on a pending header in the draft, and not on a draft of the title or the summary only (AC-g6)", () => {
    const attente = "Un changement de l'en-tête attend en brouillon. Demandez à l'assistant de le publier ou de l'abandonner, puis rechargez la page."
    const draft = brouillon([])
    rendre({ noeud: { data: tableau({ level: 2, draft: draft && { ...draft, meta: { ...ENTETE, closed: true } } }) } })
    fireEvent.click(screen.getByRole("button", { name: "Réglages" }))
    expect(screen.getByText(attente)).toBeInTheDocument()
    // L'état publié, et non celui du brouillon : « Fermé » reste décoché.
    expect(screen.getByRole("switch", { name: "Fermé" })).not.toBeChecked()
    for (const un of screen.getAllByRole("switch")) expect(un).toBeDisabled()
    cleanup()

    rendre({ noeud: { data: tableau({ level: 2, draft: draft && { ...draft, title: "Suivi des prospects 2026" } }) } })
    fireEvent.click(screen.getByRole("button", { name: "Réglages" }))
    expect(screen.queryByText(attente)).toBeNull()
    for (const un of screen.getAllByRole("switch")) expect(un).toBeEnabled()
  })
})

// E11-S05 (lot c ; HN-E11S05-8, HN-E11S05-9) : le fichier publié, par les routes d'export d'E10-S01.
describe("EcranDeNoeud, télécharger (E11-S05, AC-c1 to AC-c3)", () => {
  const partage: EcranDeNoeudProps["partage"] = {
    regles: { data: { path: "ventes/modele_relance", title: "Modèle de relance", owner: { kind: "team", teamName: "Ventes" }, viewerLevel: 1, rules: [] } },
    sujets: { data: { equipes: [], personnes: [] } },
    gestionAccordable: false,
    moi: null,
  }
  const commandes = () => Array.from(document.querySelectorAll(".oto-screen-header-access button")).map((bouton) => bouton.textContent)

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("should offer « Télécharger en .md » for a page, a procedure or a Contexte and « Télécharger en .csv » for a table, before « Partager », none for a node never published (AC-c1)", () => {
    for (const [kind, libelle] of [["page", "Télécharger en .md"], ["procedure", "Télécharger en .md"], ["context", "Télécharger en .md"], ["table", "Télécharger en .csv"]] as const) {
      rendre({ noeud: { data: vueDuNoeud({ kind, blocks: [] }) }, partage })
      expect(commandes()).toEqual([libelle, "Partager · Ventes"])
      cleanup()
    }
    // Sans panneau de partage, le bouton est seul ; jamais publié, aucun bouton (HN-E11S05-9).
    rendre()
    expect(commandes()).toEqual(["Télécharger en .md"])
    cleanup()
    rendre({ noeud: { data: vueDuNoeud({ status: "draft", revision: 0, level: 2 }) }, partage })
    expect(commandes()).toEqual(["Partager · Ventes"])
  })

  it("should download the published file of the export route, the button disabled meanwhile, and say a refusal in an alert without any file (AC-c2, AC-c3)", async () => {
    let repondre: (reponse: Response) => void = () => {}
    const requetes = vi.fn<typeof fetch>(() => new Promise<Response>((resolve) => (repondre = resolve)))
    vi.stubGlobal("fetch", requetes)
    const creer = vi.fn(() => "blob:fichier")
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: creer, revokeObjectURL: vi.fn() }))
    const clic = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined)
    rendre({ noeud: { data: vueDuNoeud({ kind: "table", blocks: [] }) } })
    const bouton = screen.getByRole("button", { name: "Télécharger en .csv" })

    fireEvent.click(bouton)
    expect(requetes).toHaveBeenCalledWith("/api/platform/tables/export?path=ventes%2Fmodele_relance", expect.objectContaining({ method: "GET" }))
    await waitFor(() => expect(bouton).toBeDisabled())
    await act(async () => {
      repondre(new Response(JSON.stringify({ data: { filename: "modele_relance.csv", content: "nom\r\n" } }), { status: 200 }))
    })
    await waitFor(() => expect(clic).toHaveBeenCalledTimes(1))
    expect(creer).toHaveBeenCalledWith(expect.objectContaining({ type: "text/csv;charset=utf-8" }))
    expect(bouton).not.toBeDisabled()
    cleanup()

    // Un refus : sa phrase sous l'en-tête, aucun fichier.
    requetes.mockResolvedValue(new Response(JSON.stringify({ error: { code: "too_large", message: "Too many rows." } }), { status: 422 }))
    rendre()
    fireEvent.click(screen.getByRole("button", { name: "Télécharger en .md" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Ce tableau a trop de lignes pour un export : filtrez-le, ou demandez à un assistant de le lire par pages.")
    expect(requetes).toHaveBeenLastCalledWith("/api/platform/nodes/export?path=ventes%2Fmodele_relance", expect.objectContaining({ method: "GET" }))
    expect(clic).toHaveBeenCalledTimes(1)
  })
})
