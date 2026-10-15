import type { ReactNode } from "react"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { BlockView } from "@otomata_tech/oto_platform/schemas"
import { Reader } from "../../../packages/plateforme/ui/ds/react/reader"
import { BlocsRepliables } from "../../../packages/plateforme/ui/noeud/blocs-repliables"
import { CADRE_DU_TABLEAU } from "../../../packages/plateforme/ui/noeud/libelles"
import { RenduDUnBloc } from "../../../packages/plateforme/ui/noeud/rendu-des-blocs"
import { bloc } from "../../helpers/noeud"

// Les formes de page d'E10-S04 à l'écran, par `RenduDUnBloc` (lecture, éditeur au repos, page publique) :
// tableau simple (AC-a1), séparateur (AC-a2), repli (AC-a3), listes imbriquées (AC-b1), titres `h2` à `h6`
// (AC-b3), marques en ligne dans une cellule (AC-c1) ; aucun HTML injecté (`security-patterns.md § XSS Prevention`).

afterEach(() => {
  cleanup()
  // Les plis ouverts sont gardés dans le navigateur (`plis-gardes.ts`) : chaque cas part replié.
  window.localStorage.clear()
})

function LienDeTest({ children, ...props }: { href: string; className?: string; children: ReactNode }) {
  return (
    <a data-lien-hote="" {...props}>
      {children}
    </a>
  )
}

function rendre(blocs: BlockView[], baliseDeTitre?: "h3") {
  return render(
    <div>
      {blocs.map((un) => (
        <RenduDUnBloc key={un.id} bloc={un} Lien={LienDeTest} hrefDuChemin={(chemin) => `/n/${chemin}`} baliseDeTitre={baliseDeTitre} />
      ))}
    </div>,
  )
}

const id = (rang: number) => `${String(rang).padStart(8, "0")}-0000-4000-8000-000000000000`

describe("RenduDUnBloc — page markdown forms (E10-S04)", () => {
  it("should render a simple table with column headers, alignments, inline marks, and HTML as text (AC-a1)", () => {
    const { container } = rendre([
      bloc(id(1), "simple_table", null, {
        columns: ["Sujet", "Décision", "Montant"],
        rows: [["Devis \\| Acme", "~~Relancer~~<br>Appeler", "<script>alert(1)</script>"]],
        align: ["left", "center", "right"],
      }),
    ])
    const tableau = screen.getByRole("table")
    expect(tableau.closest("div")).toHaveAttribute("id", "00000001")
    expect(within(tableau).getAllByRole("columnheader").map((entete) => [entete.textContent, entete.getAttribute("scope"), entete.getAttribute("data-align")])).toEqual([
      ["Sujet", "col", null],
      ["Décision", "col", "center"],
      ["Montant", "col", "end"],
    ])
    const cellules = within(tableau).getAllByRole("cell")
    expect(cellules.map((cellule) => cellule.textContent)).toEqual(["Devis | Acme", "RelancerAppeler", "<script>alert(1)</script>"])
    expect(cellules[1].querySelector("s")?.textContent).toBe("Relancer")
    expect(cellules[1].querySelector("br")).not.toBeNull()
    expect(container.querySelector("script")).toBeNull()
  })

  // 1.1.5 : la colonne de lecture est centrée (`content.css`) ; un tableau, enfant direct du corps de lecture, s'en élargit
  // et défile dans son propre cadre, que le clavier atteint. Les largeurs se mesurent au navigateur, pas sous jsdom.
  it("should render each table, simple or written as text, in its own named keyboard-focusable scroll frame, a direct child of the reading body", () => {
    const { container } = render(
      <Reader>
        <RenduDUnBloc bloc={bloc(id(9), "simple_table", null, { columns: ["A", "B"], rows: [["1", "2"]] })} Lien={LienDeTest} hrefDuChemin={(chemin) => `/n/${chemin}`} />
        <RenduDUnBloc bloc={bloc(id(10), "paragraph", "| A | B |\n|---|---|\n| 1 | 2 |", {})} Lien={LienDeTest} hrefDuChemin={(chemin) => `/n/${chemin}`} />
      </Reader>,
    )
    const corps = container.querySelector(".oto-island-body[data-reading]")
    const simple = screen.getByRole("region", { name: CADRE_DU_TABLEAU.simple })
    const texte = screen.getByRole("region", { name: CADRE_DU_TABLEAU.texte })
    expect(corps).toHaveAttribute("data-reading", "")
    expect(simple).toHaveClass("oto-table-wrap")
    expect(within(simple).getByRole("table")).toBeInTheDocument()
    expect(texte.tagName).toBe("PRE")
    expect(texte).toHaveClass("oto-code")
    for (const cadre of [simple, texte]) {
      expect(cadre.parentElement).toBe(corps)
      expect(cadre).toHaveAttribute("tabindex", "0")
    }
  })

  it("should render a divider as a horizontal rule without an added role (AC-a2)", () => {
    const { container } = rendre([bloc(id(2), "divider", null, {})])
    const filet = container.querySelector("hr")
    expect(filet).toHaveAttribute("id", "00000002")
    expect(filet).toHaveAttribute("data-orientation", "horizontal")
    expect(filet).not.toHaveAttribute("role")
  })

  it("should render a toggle closed, its summary as title, open it, its body with kept lines and each fence as code, HTML as text (AC-a3)", () => {
    const { container } = rendre([bloc(id(3), "toggle", "Ligne un\nLigne <script>deux</script>\n```sql\nselect 1\n```", { summary: "Voir **le détail**" })])
    const repli = container.querySelector("details")
    expect(repli).toHaveAttribute("id", "00000003")
    expect(repli).not.toHaveAttribute("open")
    const resume = container.querySelector("summary")
    expect(resume?.textContent).toBe("Voir le détail")
    expect(resume?.querySelector("strong")?.textContent).toBe("le détail")
    if (resume) fireEvent.click(resume)
    expect(repli).toHaveAttribute("open")
    expect(repli?.querySelector("p")?.textContent).toBe("Ligne un\nLigne <script>deux</script>")
    expect(repli?.querySelector("figure code")?.textContent).toBe("select 1")
    expect(repli?.querySelector("figcaption")?.textContent).toBe("Code · sql")
    expect(container.querySelector("script")).toBeNull()
  })

  it("should render nested lists as nested ul and ol, each with its start (AC-b1)", () => {
    const { container } = rendre([
      bloc(id(4), "list", null, {
        items: ["a", { text: "b", children: { items: ["c", { text: "d", children: { items: ["e"], ordered: true, start: 3 } }] } }],
        ordered: true,
        start: 2,
      }),
    ])
    const premiere = container.querySelector("ol")
    expect(premiere).toHaveAttribute("start", "2")
    expect(container.querySelector("div > ol > li > ul > li > ol")).toHaveAttribute("start", "3")
    expect(container.querySelector("div > ol > li > ul > li > ol > li")?.textContent).toBe("e")
  })

  it("should give a heading of level N the tag h(N+1), bounded to h6, and h(N+2) under baliseDeTitre h3 (AC-b3)", () => {
    const titres = [1, 2, 3, 4, 5].map((niveau) => bloc(id(10 + niveau), "heading", `Niveau ${niveau}`, { level: niveau }))
    rendre(titres)
    expect(screen.getAllByRole("heading").map((titre) => titre.tagName)).toEqual(["H2", "H3", "H4", "H5", "H6"])
    cleanup()
    rendre(titres, "h3")
    expect(screen.getAllByRole("heading").map((titre) => titre.tagName)).toEqual(["H3", "H4", "H5", "H6", "H6"])
  })
})

// Les plis d'une page lue : chaque titre replie sa section, ouverte à l'arrivée ; un menu dépliant, replié à l'arrivée ; le
// geste de la personne gardé dans ce navigateur.
describe("BlocsRepliables — folds of a read page", () => {
  const page = () => [
    bloc(id(20), "heading", "Annexes", { level: 1 }),
    bloc(id(21), "paragraph", "Détail des annexes"),
    bloc(id(22), "heading", "Suite", { level: 1 }),
    bloc(id(23), "toggle", "Corps caché", { summary: "Voir" }),
  ]
  const rendreLaPage = () =>
    render(
      <Reader>
        <BlocsRepliables blocs={page()} rendre={(un) => <RenduDUnBloc bloc={un} Lien={LienDeTest} hrefDuChemin={(chemin) => `/n/${chemin}`} />} />
      </Reader>,
    )

  it("should open every section at first, fold one from the chevron in its title, and keep it folded on the next visit", async () => {
    rendreLaPage()
    const titre = screen.getByRole("heading", { name: /Annexes/ })
    const chevron = within(titre).getByRole("button", { name: "Replier la section — Annexes" })
    expect(within(screen.getByRole("heading", { name: /Suite/ })).getByRole("button", { name: "Replier la section — Suite" })).toBeVisible()
    expect(screen.getByText("Détail des annexes")).toBeVisible()
    fireEvent.click(chevron)
    expect(chevron).toHaveAttribute("aria-expanded", "false")
    expect(screen.getByText("Détail des annexes")).not.toBeVisible()
    expect(screen.getByRole("heading", { name: /Suite/ })).toBeVisible()
    cleanup()
    rendreLaPage()
    await waitFor(() => expect(screen.getByText("Détail des annexes")).not.toBeVisible())
  })

  it("should keep the open default and still fold when the browser refuses its storage", () => {
    const lire = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("refusé", "SecurityError")
    })
    const ecrire = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("refusé", "SecurityError")
    })
    try {
      rendreLaPage()
      expect(screen.getByText("Détail des annexes")).toBeVisible()
      fireEvent.click(screen.getByRole("button", { name: "Replier la section — Annexes" }))
      expect(screen.getByText("Détail des annexes")).not.toBeVisible()
    } finally {
      lire.mockRestore()
      ecrire.mockRestore()
    }
  })

  it("should open a folded section when the address anchor targets one of its blocks", async () => {
    window.localStorage.setItem("oto-plis", `${id(20)}=0`)
    // jsdom ne fait pas défiler : l'ancre montrée se lit sur un espion.
    const avant = Element.prototype.scrollIntoView
    const defiler = vi.fn()
    Element.prototype.scrollIntoView = defiler
    try {
      window.history.replaceState(null, "", "#00000021")
      rendreLaPage()
      await waitFor(() => expect(defiler).toHaveBeenCalledTimes(1))
      expect(screen.getByText("Détail des annexes")).toBeVisible()
    } finally {
      Element.prototype.scrollIntoView = avant
      act(() => window.history.replaceState(null, "", "#"))
    }
  })

  it("should mark as empty the chevron of a heading without a section and of a toggle without a body, not the others", () => {
    const { container } = rendreLaPage()
    expect(screen.getByRole("button", { name: "Replier la section — Annexes" })).not.toHaveAttribute("data-vide")
    expect(container.querySelector("details.oto-depliant")).not.toHaveAttribute("data-vide")
    cleanup()
    const vides = [bloc(id(24), "toggle", "", { summary: "Rien" }), bloc(id(25), "heading", "Seul", { level: 1 })]
    const relu = render(
      <Reader>
        <BlocsRepliables blocs={vides} rendre={(un) => <RenduDUnBloc bloc={un} Lien={LienDeTest} hrefDuChemin={(chemin) => `/n/${chemin}`} />} />
      </Reader>,
    )
    expect(relu.container.querySelector("details.oto-depliant")).toHaveAttribute("data-vide")
    expect(screen.getByRole("button", { name: "Replier la section — Seul" })).toHaveAttribute("data-vide")
  })

  it("should draw a toggle folded at first, its chevron first and no title box, and keep it open on the next visit", async () => {
    const { container } = rendreLaPage()
    const repli = container.querySelector("details.oto-depliant")
    expect(repli).not.toHaveAttribute("open")
    const resume = repli?.querySelector("summary")
    expect(resume?.firstElementChild).toHaveClass("oto-pli-chevron")
    expect(resume?.querySelector("strong")).toBeNull()
    if (resume) fireEvent.click(resume)
    await waitFor(() => expect(window.localStorage.getItem("oto-plis")).toBe(`${id(23)}=1`))
    cleanup()
    const relu = rendreLaPage().container.querySelector("details.oto-depliant")
    await waitFor(() => expect(relu).toHaveAttribute("open"))
  })
})
