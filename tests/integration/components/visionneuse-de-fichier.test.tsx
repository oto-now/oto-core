import type { ReactNode } from "react"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { publicFilesRoute, type FileView } from "../../../packages/plateforme/schemas"
import { tailleLisible } from "../../../packages/plateforme/ui/format/nombres"
import { SANDBOX } from "../../../packages/plateforme/ui/noeud/cadre-du-fichier"
import { FICHIERS } from "../../../packages/plateforme/ui/noeud/libelles-des-fichiers"
import { RenduDUnBloc } from "../../../packages/plateforme/ui/noeud/rendu-des-blocs"
import { VisionneuseDeFichier, type VisionneuseProps } from "../../../packages/plateforme/ui/noeud/visionneuse-de-fichier"

// La visionneuse d'un fichier joint et « Voir » (E10-S02 lot c : AC-c1, AC-c2, AC-c4, AC-c5 ; ADR-017) : l'en-tête hors
// du contenu, la bannière hors de l'iframe, l'iframe isolée (`sandbox` exact, sans `allow-same-origin`, sans `allow`,
// `no-referrer`, titrée par le nom), la navigation de son contenu remplacée par un avis et « Recharger », aucun message
// écouté ; un `.md` en blocs ; introuvable et échec ; les adresses d'un lien public. `fetch` simulé : aucun appel
// attendu de la visionneuse.

const ID = "f1000000-0000-4000-8000-0000000000cc"

function LienDeTest({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  return (
    <a href={href} className={className}>
      {children}
    </a>
  )
}

const HTML: FileView = { id: ID, name: "rapport.html", size: 12_800, path: "ventes/rapports", type: "html" }

function monter(surcharge: Partial<VisionneuseProps> = {}) {
  const fetch = vi.fn<typeof globalThis.fetch>()
  vi.stubGlobal("fetch", fetch)
  render(
    <VisionneuseDeFichier
      fichier={{ data: HTML }}
      nomOrganisation="Acme"
      page={{ titre: "Rapports", href: "/n/ventes/rapports" }}
      ici={`/n/ventes/rapports?view=${ID}`}
      Lien={LienDeTest}
      hrefDuChemin={(chemin) => `/n/${chemin}`}
      {...surcharge}
    />,
  )
  return { fetch }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("VisionneuseDeFichier — an HTML file (AC-c2, AC-c4)", () => {
  it("should show the header out of the content, the banner out of the iframe, and the isolated iframe of ADR-017", () => {
    const ecoute = vi.spyOn(window, "addEventListener")
    const { fetch } = monter()
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("rapport.html")
    expect(screen.getByText(tailleLisible(12_800))).toBeInTheDocument()
    expect(screen.getByRole("link", { name: FICHIERS.telechargerNom("rapport.html") })).toHaveAttribute("href", `/f/${ID}`)
    expect(screen.getByRole("link", { name: "Ouvrir la page Rapports" })).toHaveAttribute("href", "/n/ventes/rapports")
    const banniere = screen.getByRole("note")
    expect(banniere).toHaveTextContent("Contenu interactif publié par Acme. N'y saisissez jamais de mot de passe.")

    const cadre = screen.getByTitle("rapport.html")
    expect({
      balise: cadre.tagName,
      src: cadre.getAttribute("src"),
      sandbox: cadre.getAttribute("sandbox"),
      referrer: cadre.getAttribute("referrerpolicy"),
      allow: cadre.hasAttribute("allow"),
      srcdoc: cadre.hasAttribute("srcdoc"),
      banniereHorsDuCadre: cadre.contains(banniere) || banniere.contains(cadre),
    }).toEqual({
      balise: "IFRAME",
      src: `/api/platform/files/${ID}/html`,
      sandbox: "allow-scripts allow-popups allow-forms",
      referrer: "no-referrer",
      allow: false,
      srcdoc: false,
      banniereHorsDuCadre: false,
    })
    expect(SANDBOX.split(" ")).not.toContain("allow-same-origin")
    // L'écran n'écoute aucun message de l'iframe (ADR-017 § 3) et ne lit rien lui-même.
    expect(ecoute.mock.calls.filter(([type]) => type === "message")).toEqual([])
    expect(fetch).not.toHaveBeenCalled()
  })

  it("should replace the iframe on a second load (navigation of its content) by a notice in a region mounted empty, and « Recharger » mounts a new iframe that takes the focus", async () => {
    monter()
    // La région se monte vide avec l'iframe, puis reçoit l'avis (`accessibility-patterns.md § Régions dynamiques`).
    const region = screen.getByRole("alert")
    expect(region).toBeEmptyDOMElement()
    fireEvent.load(screen.getByTitle("rapport.html"))
    expect(screen.queryByText(FICHIERS.quitte)).toBeNull()
    fireEvent.load(screen.getByTitle("rapport.html"))
    expect([screen.getByRole("alert") === region, region.textContent?.includes(FICHIERS.quitte)]).toEqual([true, true])
    expect(screen.queryByTitle("rapport.html")).toBeNull()
    fireEvent.click(within(region).getByRole("button", { name: FICHIERS.recharger }))
    const neuf = screen.getByTitle("rapport.html")
    // Le bouton part avec l'avis : le focus va à l'iframe neuve, jamais à `<body>` (`§ Focus Management`).
    await waitFor(() => expect(document.activeElement).toBe(neuf))
    fireEvent.load(neuf)
    expect(neuf.getAttribute("sandbox")).toBe("allow-scripts allow-popups allow-forms")
    expect(region).toBeEmptyDOMElement()
  })

  it("should load the file and download it through the routes of a public link (AC-c5)", () => {
    monter({ routeDesFichiers: publicFilesRoute("AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde") })
    const base = "/api/platform/public/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde/files"
    expect([screen.getByTitle("rapport.html").getAttribute("src"), screen.getByRole("link", { name: FICHIERS.telechargerNom("rapport.html") }).getAttribute("href")]).toEqual([
      `${base}/${ID}/html`,
      `${base}/${ID}`,
    ])
  })
})

describe("VisionneuseDeFichier — a .md file, not found, failed (AC-c2)", () => {
  it("should render the blocks of a .md read-only, like a page, with no banner nor iframe", () => {
    const { fetch } = monter({
      fichier: {
        data: {
          id: ID,
          name: "notes.md",
          size: 40,
          path: "ventes/rapports",
          type: "md",
          blocks: [
            { type: "heading", text: "Plan", data: { level: 1 } },
            { type: "paragraph", text: "Un <script>alert(1)</script> paragraphe **gras**.", data: {} },
          ],
        },
      },
    })
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Plan")
    expect(screen.getByText("gras").tagName).toBe("STRONG")
    expect(screen.getByRole("region", { name: FICHIERS.contenuDe("notes.md") })).toBeInTheDocument()
    expect([screen.queryByRole("note"), document.querySelector("iframe, script")]).toEqual([null, null])
    expect(fetch).not.toHaveBeenCalled()
  })

  it("should say « Fichier introuvable » with a way back to the page, and a failed read with « Réessayer »", () => {
    monter({ fichier: { data: null } })
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(FICHIERS.introuvable)
    expect(screen.getByRole("link", { name: "Ouvrir la page Rapports" })).toHaveAttribute("href", "/n/ventes/rapports")
    expect(document.querySelector("iframe")).toBeNull()
    cleanup()
    monter({ fichier: { error: FICHIERS.pasEnUtf8 } })
    const alerte = screen.getByRole("alert")
    expect(alerte).toHaveTextContent("Ce fichier n'est pas en UTF-8 : téléchargez-le.")
    expect(within(alerte).getByRole("link", { name: "Réessayer" })).toHaveAttribute("href", `/n/ventes/rapports?view=${ID}`)
  })
})

describe("CarteDeFichier on a public page (AC-c1, AC-c5)", () => {
  it("should open « Voir » in a new tab through the link's routes, and read no availability, whose route needs a session", () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
    vi.stubGlobal("fetch", fetch)
    const route = publicFilesRoute("AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde")
    const carte = (nom: string, rang: number) => (
      <RenduDUnBloc
        key={nom}
        bloc={{ type: "file", text: null, data: { file_id: `f${rang}000000-0000-4000-8000-000000000001`, name: nom, size: 10, mime: "x" } }}
        Lien="a"
        hrefDuChemin={(chemin) => `/p/x/${chemin}`}
        routeDesFichiers={route}
      />
    )
    render(<>{["devis.pdf", "page.html"].map(carte)}</>)
    const pdf = screen.getByRole("link", { name: "Voir devis.pdf (nouvel onglet)" })
    expect({
      pdf: [pdf.getAttribute("href"), pdf.getAttribute("target"), pdf.getAttribute("rel")],
      html: screen.getByRole("link", { name: "Voir page.html (nouvel onglet)" }).getAttribute("href"),
      telecharger: screen.getByRole("link", { name: "Télécharger devis.pdf" }).getAttribute("href"),
    }).toEqual({
      pdf: [`${route}/f0000000-0000-4000-8000-000000000001?disposition=inline`, "_blank", "noopener noreferrer"],
      html: "?view=f1000000-0000-4000-8000-000000000001",
      telecharger: `${route}/f0000000-0000-4000-8000-000000000001`,
    })
    expect(fetch).not.toHaveBeenCalled()
  })
})
