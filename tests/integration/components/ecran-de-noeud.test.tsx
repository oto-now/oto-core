import type { ComponentProps, ReactNode } from "react"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { NodeView, TreeNode } from "@otomata_tech/oto_platform/schemas"
import { ContexteDeLHote, EcranDeNoeud, EcranDeNoeudChargement } from "@otomata_tech/oto_platform/ui"
import { cheminsCites } from "../../../packages/plateforme/ui/noeud/corps-du-noeud"
import { texteDuBloc } from "../../helpers/champ-du-bloc"
import { simulerLesDialogues } from "../../helpers/dialogue"
import { avecCle, bloc, ID, PAGE, simulerLAPI, vueDuNoeud } from "../../helpers/noeud"

// L'écran d'un nœud (E05-S02 : AC1 à AC9, AC14, AC17, AC19 ; E05-S09, partie c1 : porté d'oto-frontend ;
// E05-S10, partie b : AC-a7, AC-b4, AC-b6), rendu comme la page de l'hôte le monte : lectures en
// `resultat`, lien de l'hôte marqué, adresse d'un chemin ; la navigation du fil passe par l'hôte
// (`ContexteDeLHote`), espionnée. Le panneau « Partager » a son fichier (`partager.test.tsx`). E05-S11 :
// le titre d'un Contexte (AC-17), une page citée par son titre (AC-26, AC-27). E11-S05 : « Télécharger » (lot c), le
// résumé d'une procédure seule (lot f), la page vide (lot g). Refonte #217, #218 : la page à plat, la méta, le pied
// « Sous-pages », « Cité dans », « Cite », « Liens » et le menu « ⋯ » de l'en-tête.

type EcranDeNoeudProps = ComponentProps<typeof EcranDeNoeud>

const naviguer = vi.fn()

/** Les fils de commentaires du nœud, que l'encart « Commentaires » lit une fois l'écran monté : aucun, ici. */
const sansFil = () => new Response(JSON.stringify({ data: { path: "ventes/modele_relance", threads: [], readers: [], mailEnabled: false } }), { status: 200 })
const lectureDesFils = (adresse: unknown) => String(adresse).includes("/comments?path=")

// Seule la lecture des fils répond ; toute autre requête échoue comme sans serveur, sauf dans un cas qui simule l'API.
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (adresse) => {
      if (lectureDesFils(adresse)) return sansFil()
      throw new TypeError("fetch failed")
    }),
  )
})

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

describe("EcranDeNoeud, en-tête (AC2 ; AC-a2 ; refonte #217, #218)", () => {
  it("should show the flat header: trail ending with the title, the big title once without glyph, the meta under it, the gestures on the right, no summary for a page", async () => {
    await act(async () => {
      rendre({ partage: { regles: { data: null }, sujets: { data: { equipes: [], personnes: [] } }, gestionAccordable: false, moi: null } })
    })
    // L'arbre ne vit plus que dans le rail (AC-a2) : le contenu n'en rend aucun.
    expect(screen.queryByRole("navigation", { name: "Arbre des connaissances" })).toBeNull()
    expect(screen.getAllByRole("navigation")).toHaveLength(1)
    expect(fil().queryAllByRole("link")).toHaveLength(0)
    expect(maillon("Modèle de relance")).toHaveAttribute("aria-current", "page")
    expect(maillon("Ventes")).not.toHaveAttribute("aria-current")
    const titre = screen.getByRole("heading", { level: 1 })
    expect(titre).toHaveTextContent("Modèle de relance")
    expect(titre).toHaveClass("oto-page-title")
    expect(titre.querySelector("svg")).toBeNull()
    // Le résumé d'une page ne se montre pas (E11-S05, AC-f1).
    expect(screen.queryByText("Relancer un devis resté sans réponse.")).toBeNull()
    expect(screen.getByText("Modifiée il y a 3 jours par Claire Morel · Ventes").closest("p")).toHaveClass("oto-screen-header-meta")
    // Le document est posé à plat, nommé par son titre, sans îlot.
    const document_ = screen.getByRole("region", { name: "Modèle de relance" })
    expect(document_).not.toHaveClass("oto-island")
    expect(document_.closest(".oto-island")).toBeNull()
    // À droite, dans cet ordre : Commentaires, Historique, Partager, puis « ⋯ » (les liens ne sont pas servis ici).
    const gestes = Array.from(document.querySelectorAll<HTMLElement>(".oto-screen-header-access button")).map((bouton) => bouton.getAttribute("aria-label") ?? bouton.textContent)
    expect(gestes).toEqual(["Commentaires", "Historique des versions", "Partager", "Plus d'actions"])
  })

  it("should make each link of the trail open its siblings, the current one checked, each leading through the host, an invisible segment staying inert", async () => {
    rendre({ noeud: { data: vueDuNoeud({ path: "ventes/modele_relance/exemple", title: "Exemple", status: "draft", revision: 0, updatedByName: null }) } })
    expect(screen.getByText("Modifiée il y a 3 jours · Ventes")).toBeInTheDocument()

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

describe("EcranDeNoeud, la ligne sous le titre (E05-S10, AC-a7 ; brief § 5.6)", () => {
  it("should say « Modifiée <quand> par <qui> · <espace> », the nature first except for a page, and open a tooltip with the type, state, revision and owner", async () => {
    rendre({ noeud: { data: vueDuNoeud({ owner: { kind: "user", userName: "Claire Morel" } }) } })
    const meta = screen.getByText("Modifiée il y a 3 jours par Claire Morel · Ventes")
    // Ni type, ni état, ni révision dans la ligne : ils passent dans l'infobulle ; la ligne n'a que son texte.
    expect(document.querySelector(".oto-screen-header-meta")?.textContent).toBe("Modifiée il y a 3 jours par Claire Morel · Ventes")
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

    rendre({ noeud: { data: vueDuNoeud({ kind: "procedure" }) } })
    expect(screen.getByText("Procédure · Modifiée il y a 3 jours par Claire Morel · Ventes")).toBeInTheDocument()
    cleanup()

    // Un tableau jamais publié : l'accord au masculin, sa nature en tête, l'état et ses lignes dans l'infobulle, sans le
    // mot « brouillon » (E11-S02, AC-c4).
    rendre({ noeud: { data: vueDuNoeud({ kind: "table", status: "draft", revision: 0, blocks: [], rowsTotal: 12, updatedByName: null }) } })
    const tableau = screen.getByText("Tableau · Modifié il y a 3 jours · Ventes")
    act(() => tableau.focus())
    expect(await screen.findByRole("tooltip")).toHaveTextContent("TypeTableauÉtatNon publiéRévisionaucuneLignes12 lignesPropriétaireéquipe Ventes (responsable : Claire Morel)")
  })
})

describe("EcranDeNoeud, le pied et les liens (refonte #217, #218 ; E11-S05, AC-e1)", () => {
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
  /** Les colonnes du pied, dans l'ordre : leur intitulé. */
  const colonnes = () => Array.from(document.querySelectorAll(".oto-node-foot-column > h2")).map((titre) => titre.textContent)
  const colonne = (nom: string) => within(screen.getByRole("list", { name: nom }))
  const liens = (liste: ReturnType<typeof colonne>) => liste.getAllByRole("link").map((lien) => [lien.textContent, lien.getAttribute("href")])

  it("should list « Sous-pages », « Cité dans » and « Cite » in three columns under the text, each line a link with its glyph, and no right column", async () => {
    await act(async () => {
      rendre({ noeud: { data: vueDuNoeud({ children: [ENFANT, NOTE], childrenTotal: 2 }) }, liens: Promise.resolve({ data: LIENS }) })
    })
    await waitFor(() => expect(colonnes()).toEqual(["Sous-pages · 2", "Cité dans 1 contenu", "Cite 3 contenus"]))
    expect(document.querySelector(".oto-two-columns-aside")).toBeNull()
    expect(document.querySelector("details.oto-linked")).toBeNull()
    // Le pied suit le document, dans la colonne de lecture ; sans panneau ouvert, aucune piste de `TwoColumns`.
    const pied = document.querySelector(".oto-node-foot")
    expect(screen.getByRole("region", { name: "Modèle de relance" }).compareDocumentPosition(pied as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(pied?.closest(".oto-content-max")).toHaveAttribute("data-width", "document")
    expect(document.querySelector(".oto-two-columns")).toBeNull()

    // Chaque nœud dessous, son nom seul, entier au survol (E11-S15, AC-a2).
    expect(liens(colonne("Sous-pages"))).toEqual([
      ["Exemple", "/n/ventes/modele_relance/exemple"],
      ["Note", "/n/ventes/modele_relance/note"],
    ])
    expect(colonne("Sous-pages").getByText("Exemple")).toHaveAttribute("title", "Exemple")
    // Deux ancres d'un même contenu : une ligne ; un contenu rangé ailleurs mène à sa nouvelle place ; sans cible, un texte.
    expect(liens(colonne("Cite"))).toEqual([
      ["Grille", "/n/ventes/grille"],
      ["Nouveau", "/n/conseil/nouveau"],
    ])
    expect(colonne("Cite").getByText("déplacé vers conseil/nouveau")).toBeInTheDocument()
    expect(colonne("Cite").getByText("sans cible")).toBeInTheDocument()
    expect(liens(colonne("Cité dans"))).toEqual([["Guide du conseil", "/n/conseil/guide"]])

    // « Liens » de l'en-tête : leur total, et le popover « Cité dans » puis « Cite », chaque ligne avec son espace (D1).
    const bouton = screen.getByRole("button", { name: "Liens, 4 contenus" })
    fireEvent.click(bouton)
    const popover = within(await screen.findByRole("dialog", { name: "Liens de la page" }))
    expect(popover.getAllByRole("heading").map((titre) => titre.textContent)).toEqual(["Cité dans 1 contenu", "Cite 3 contenus"])
    expect(popover.getByRole("link", { name: "Guide du conseil" })).toHaveAttribute("href", "/n/conseil/guide")
  })

  it("should move Liens and Historique into « ⋯ » under 640 px, « Liens » opening its popover and « Historique des versions » the history", async () => {
    // La fenêtre d'un téléphone : toute rupture répond (maquette « Mobile », la rangée tient sur une ligne).
    simulerLesDialogues()
    vi.stubGlobal("matchMedia", (requete: string) => ({ matches: true, media: requete, addEventListener: () => {}, removeEventListener: () => {} }))
    try {
      await act(async () => {
        rendre({ liens: Promise.resolve({ data: LIENS }) })
      })
      await screen.findByRole("button", { name: "Liens, 4 contenus" })
      const menu = () => within(screen.getByRole("menu"))
      fireEvent.click(screen.getByRole("button", { name: "Plus d'actions" }))
      expect(menu().getAllByRole("menuitem").map((ligne) => ligne.textContent).slice(0, 2)).toEqual(["Liens", "Historique des versions"])
      fireEvent.click(menu().getByRole("menuitem", { name: "Liens" }))
      expect(await screen.findByRole("dialog", { name: "Liens de la page" })).toBeInTheDocument()
      fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" })
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Liens de la page" })).toBeNull())
      fireEvent.click(screen.getByRole("button", { name: "Plus d'actions" }))
      fireEvent.click(menu().getByRole("menuitem", { name: "Historique des versions" }))
      expect(await screen.findByRole("dialog", { name: "Historique des versions" })).toBeInTheDocument()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it("should leave out an empty column, show five lines then « Voir les N autres », count what the service did not serve, and render no foot when nothing is linked", async () => {
    await act(async () => {
      rendre({ liens: Promise.resolve({ data: { links_out: [], links_out_total: 0, links_in: [{ path: "conseil/guide", title: "Guide du conseil" }], links_in_total: 1 } }) })
    })
    await waitFor(() => expect(colonnes()).toEqual(["Cité dans 1 contenu"]))
    cleanup()

    // Sept nœuds servis sur soixante : cinq lignes, la suite à la demande, puis ce que le service n'a pas servi.
    const enfants = Array.from({ length: 7 }, (_, rang) => ({ ...NOTE, path: `ventes/modele_relance/n${rang}`, title: `Note ${rang}` }))
    rendre({ noeud: { data: vueDuNoeud({ children: enfants, childrenTotal: 60 }) } })
    expect(colonnes()).toEqual(["Sous-pages · 60"])
    expect(colonne("Sous-pages").getAllByRole("link")).toHaveLength(5)
    expect(screen.getByText("et 53 autres")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Voir les 2 autres" }))
    expect(colonne("Sous-pages").getAllByRole("link")).toHaveLength(7)
    await waitFor(() => expect(document.activeElement).toBe(colonne("Sous-pages").getByRole("link", { name: "Note 5" })))
    expect(screen.queryByRole("button", { name: "Voir les 2 autres" })).toBeNull()
    cleanup()

    await act(async () => {
      rendre({ liens: Promise.resolve({ data: { links_out: [], links_out_total: 0, links_in: [], links_in_total: 0 } }) })
    })
    expect(colonnes()).toEqual([])
    expect(screen.queryByRole("button", { name: /^Liens/ })).toBeNull()
  })

  it("should say « Lecture des liens… » while the links are read, then their failure with « Réessayer » at the foot, even without a sub-page (AC-e4)", async () => {
    let servir: (lu: { error: string }) => void = () => {}
    const lecture = new Promise<{ error: string }>((resolve) => (servir = resolve))
    await act(async () => {
      rendre({ liens: lecture })
    })
    // La veille de la page (retour RET-008) a aussi sa région `status`, vide : on vise celle des liens.
    expect(screen.getByText("Lecture des liens…")).toHaveAttribute("role", "status")
    await act(async () => {
      servir({ error: "Une erreur est survenue. Réessayez." })
    })
    const pied = within(document.querySelector<HTMLElement>(".oto-node-foot") ?? document.body)
    await waitFor(() => expect(pied.getByRole("alert")).toHaveTextContent("Une erreur est survenue. Réessayez."))
    expect(pied.getByRole("link", { name: "Réessayer" })).toHaveAttribute("href", "/n/ventes/modele_relance")
    expect(screen.queryByText("Lecture des liens…")).toBeNull()
  })

  it("should put the foot of a table under its grid, which keeps the full width (AC-e3)", async () => {
    await act(async () => {
      rendre({
        noeud: { data: vueDuNoeud({ kind: "table", blocks: [], children: [NOTE], childrenTotal: 1 }) },
        liens: Promise.resolve({ data: LIENS }),
        complement: <p>La grille du tableau</p>,
      })
    })
    await waitFor(() => expect(colonnes()).toEqual(["Sous-pages · 1", "Cité dans 1 contenu", "Cite 3 contenus"]))
    const pied = document.querySelector(".oto-node-foot")
    expect(screen.getByText("La grille du tableau").compareDocumentPosition(pied as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // Sans panneau ouvert, aucune piste : la grille et le pied dans le cadre de l'écran, sans mesure de lecture.
    expect(document.querySelector(".oto-two-columns")).toBeNull()
    const cadres = Array.from(document.querySelectorAll(".oto-content-max")).filter((cadre) => cadre.contains(screen.getByText("La grille du tableau")))
    expect(cadres.map((cadre) => cadre.hasAttribute("data-width"))).toEqual([false])
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
    ["another person's Privé", "private/marc/contexte", "claire"],
  ] as const)("should title the Contexte of %s « Contexte · <section> » (« Mes instructions » for one's own Privé only), never in place, the saved title unchanged", (_section, path, handle) => {
    const titres = { contexte: "Contexte · Tout le monde", "ventes/contexte": "Contexte · Ventes", "private/claire/contexte": "Mes instructions", "private/marc/contexte": "Contexte · Privé" }
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

describe("EcranDeNoeud, accès et partage (AC19 ; E05-S10, AC-b5 ; refonte #218)", () => {
  const partage = (surcharge: Partial<NonNullable<EcranDeNoeudProps["partage"]>> = {}): EcranDeNoeudProps["partage"] => ({
    regles: { data: { path: "ventes/modele_relance", title: "Modèle de relance", owner: { kind: "team", teamName: "Ventes" }, viewerLevel: 3, rules: [] } },
    sujets: { data: { equipes: [{ id: "t-conseil", nom: "Conseil" }], personnes: [] } },
    gestionAccordable: false,
    moi: null,
    ...surcharge,
  })

  it("should open « Partager » from the header, named after the content, clear a search on a first Escape, close on the next and give the focus back", async () => {
    rendre({ partage: partage() })
    const partager = screen.getByRole("button", { name: "Partager" })
    expect(partager).toHaveAttribute("aria-expanded", "false")
    act(() => partager.focus())
    fireEvent.click(partager)
    const panneau = screen.getByRole("dialog", { name: "Partager « Modèle de relance »" })
    expect(partager).toHaveAttribute("aria-expanded", "true")
    await waitFor(() => expect(document.activeElement).toBe(panneau))
    const champ = within(panneau).getByRole("combobox", { name: "Ajouter une personne ou une équipe" })
    fireEvent.change(champ, { target: { value: "cons" } })
    fireEvent.keyDown(champ, { key: "Escape" })
    expect(champ).toHaveValue("")
    expect(screen.getByRole("dialog", { name: /^Partager « .+ »$/ })).toBeInTheDocument()
    fireEvent.keyDown(champ, { key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(document.activeElement).toBe(partager)
  })
})

/** Les entrées du menu « ⋯ » de l'en-tête, ouvert par son déclencheur ; aucune sans menu. */
function entreesDuMenu(): (string | null)[] {
  const plus = screen.queryByRole("button", { name: "Plus d'actions" })
  if (!plus) return []
  fireEvent.click(plus)
  return within(screen.getByRole("menu")).getAllByRole("menuitem").map((entree) => entree.textContent)
}

describe("EcranDeNoeud, réglages d'un tableau (E11-S01, AC-g1, AC-g6 ; refonte #218)", () => {
  const ENTETE = { columns: [{ name: "entreprise", type: "text" }], key: "entreprise" }
  const tableau = (surcharge: Partial<NodeView> = {}) => vueDuNoeud({ kind: "table", blocks: [], meta: ENTETE, ...surcharge })

  beforeEach(() => simulerLesDialogues())

  it("should offer « Importer un fichier… » and « Réglages du tableau… » after « Télécharger en .csv » in « ⋯ » for a table read at the write or manage level, the latter opening « Réglages du tableau »", () => {
    for (const level of [2, 3] as const) {
      rendre({ noeud: { data: tableau({ level }) }, complement: <p>La grille du tableau</p> })
      expect(entreesDuMenu()).toEqual(["Télécharger en .csv", "Importer un fichier…", "Réglages du tableau…"])
      fireEvent.click(screen.getByRole("menuitem", { name: "Réglages du tableau…" }))
      expect(screen.getByRole("dialog", { name: "Réglages du tableau" })).toBeInTheDocument()
      cleanup()
    }
  })

  it("should give no settings to a reader, on ?version=published, or to a page, a procedure or a Contexte", () => {
    rendre({ noeud: { data: tableau({ level: 1 }) } })
    expect(entreesDuMenu()).toEqual(["Télécharger en .csv"])
    cleanup()
    rendre({ noeud: { data: tableau({ level: 2 }) }, versionPubliee: true })
    expect(entreesDuMenu()).toEqual(["Télécharger en .csv"])
    cleanup()
    for (const kind of ["page", "procedure", "context"] as const) {
      rendre({ noeud: { data: vueDuNoeud({ kind, level: 2, meta: ENTETE }) } })
      expect(entreesDuMenu(), kind).not.toContain("Réglages du tableau…")
      cleanup()
    }
  })

  it("should block the settings on a pending header in the draft, and not on a draft of the title or the summary only (AC-g6)", () => {
    const attente = "Un changement de l'en-tête attend en brouillon. Demandez à l'assistant de le publier ou de l'abandonner, puis rechargez la page."
    const draft = brouillon([])
    rendre({ noeud: { data: tableau({ level: 2, draft: draft && { ...draft, meta: { ...ENTETE, closed: true } } }) } })
    entreesDuMenu()
    fireEvent.click(screen.getByRole("menuitem", { name: "Réglages du tableau…" }))
    expect(screen.getByText(attente)).toBeInTheDocument()
    // L'état publié, et non celui du brouillon : « Fermé » reste décoché.
    expect(screen.getByRole("switch", { name: "Fermé" })).not.toBeChecked()
    for (const un of screen.getAllByRole("switch")) expect(un).toBeDisabled()
    cleanup()

    rendre({ noeud: { data: tableau({ level: 2, draft: draft && { ...draft, title: "Suivi des prospects 2026" } }) } })
    entreesDuMenu()
    fireEvent.click(screen.getByRole("menuitem", { name: "Réglages du tableau…" }))
    expect(screen.queryByText(attente)).toBeNull()
    for (const un of screen.getAllByRole("switch")) expect(un).toBeEnabled()
  })
})

// E11-S05 (lot c ; HN-E11S05-8, HN-E11S05-9) : le fichier publié, par les routes d'export d'E10-S01.
describe("EcranDeNoeud, télécharger (E11-S05, AC-c1 to AC-c3 ; refonte #218)", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("should offer « Télécharger en .md » for a page, a procedure or a Contexte and « Télécharger en .csv » for a table in « ⋯ », none for a node never published (AC-c1)", () => {
    for (const [kind, libelle] of [["page", "Télécharger en .md"], ["procedure", "Télécharger en .md"], ["context", "Télécharger en .md"], ["table", "Télécharger en .csv"]] as const) {
      rendre({ noeud: { data: vueDuNoeud({ kind, blocks: [] }) } })
      expect(entreesDuMenu(), kind).toEqual([libelle])
      cleanup()
    }
    // Jamais publié : ni téléchargement ni historique ; un menu vide n'est pas rendu (HN-E11S05-9, brief § 5.7).
    rendre({ noeud: { data: vueDuNoeud({ status: "draft", revision: 0 }) } })
    expect(screen.queryByRole("button", { name: "Plus d'actions" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Historique des versions" })).toBeNull()
    cleanup()
    // Au niveau écriture, « Transformer en procédure » reste.
    rendre({ noeud: { data: vueDuNoeud({ status: "draft", revision: 0, level: 2 }) } })
    expect(entreesDuMenu()).toEqual(["Transformer en procédure"])
  })

  it("should download the published file of the export route, the entry disabled meanwhile, and say a refusal in an alert without any file (AC-c2, AC-c3)", async () => {
    let repondre: (reponse: Response) => void = () => {}
    const requetes = vi.fn<typeof fetch>((adresse) => (lectureDesFils(adresse) ? Promise.resolve(sansFil()) : new Promise<Response>((resolve) => (repondre = resolve))))
    vi.stubGlobal("fetch", requetes)
    const creer = vi.fn(() => "blob:fichier")
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: creer, revokeObjectURL: vi.fn() }))
    const clic = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined)
    rendre({ noeud: { data: vueDuNoeud({ kind: "table", blocks: [] }) } })

    entreesDuMenu()
    fireEvent.click(screen.getByRole("menuitem", { name: "Télécharger en .csv" }))
    expect(requetes).toHaveBeenCalledWith("/api/platform/tables/export?path=ventes%2Fmodele_relance", expect.objectContaining({ method: "GET" }))
    entreesDuMenu()
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "Télécharger en .csv" })).toHaveAttribute("aria-disabled", "true"))
    await act(async () => {
      repondre(new Response(JSON.stringify({ data: { filename: "modele_relance.csv", content: "nom\r\n" } }), { status: 200 }))
    })
    await waitFor(() => expect(clic).toHaveBeenCalledTimes(1))
    expect(creer).toHaveBeenCalledWith(expect.objectContaining({ type: "text/csv;charset=utf-8" }))
    expect(screen.getByRole("menuitem", { name: "Télécharger en .csv" })).not.toHaveAttribute("aria-disabled")
    cleanup()

    // Un refus : sa phrase sous l'en-tête, aucun fichier.
    requetes.mockImplementation(async (adresse) =>
      lectureDesFils(adresse) ? sansFil() : new Response(JSON.stringify({ error: { code: "too_large", message: "Too many rows." } }), { status: 422 }),
    )
    rendre()
    entreesDuMenu()
    fireEvent.click(screen.getByRole("menuitem", { name: "Télécharger en .md" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Ce tableau a trop de lignes pour un export : filtrez-le, ou demandez à un assistant de le lire par pages.")
    expect(requetes).toHaveBeenLastCalledWith("/api/platform/nodes/export?path=ventes%2Fmodele_relance", expect.objectContaining({ method: "GET" }))
    expect(clic).toHaveBeenCalledTimes(1)
  })
})
