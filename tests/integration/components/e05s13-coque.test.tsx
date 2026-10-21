// E05-S13, lot B (retours du soir de JB) : la colonne de la Corbeille (AC-11), plus de « Déplacer » en tête d'un
// contenu (AC-20). Le titre d'une section du rail qui la plie (AC-12) : `rail-application.test.tsx`. Le rangement du
// menu de l'entreprise (AC-10) :
// `rail-application.test.tsx`, `ecran-organisation.test.tsx` (fil) et `pages/admin-pages.test.tsx` (adresses par
// droit) ; « Commencer à écrire » (AC-21) : `ecran-de-noeud.test.tsx` et `editeur-de-blocs.test.tsx`.
import type { ReactNode } from "react"
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { TreeNode } from "@otomata_tech/oto_platform/schemas"
import { ContexteDeLHote, ContexteDeRafraichissement, CoquilleOto, EcranDeLaCorbeille, EcranDeNoeud } from "@otomata_tech/oto_platform/ui"
import { vueDuNoeud } from "../../helpers/noeud"

afterEach(() => {
  cleanup()
})

describe("EcranDeLaCorbeille, the purge column (AC-11)", () => {
  it("should head the purge column « Suppr. définitivement le », the date unchanged", () => {
    const item = { path: "conseil", title: "Conseil", kind: "page" as const, deletedAt: "2026-09-20T08:00:00Z", count: 1, purgeAt: "2026-10-20T08:00:00Z" }
    render(
      <CoquilleOto>
        <ContexteDeLHote.Provider value={{ Lien: "a", chemin: "/trash", naviguer: vi.fn() }}>
          <EcranDeLaCorbeille resultat={{ data: [item] }} prefixeDesPages="/n/" />
        </ContexteDeLHote.Provider>
      </CoquilleOto>,
    )

    const table = within(screen.getByRole("table", { name: "Les contenus à la corbeille" }))
    const entetes = table.getAllByRole("columnheader").map((entete) => entete.textContent)
    expect(entetes).toContain("Suppr. définitivement le")
    expect(entetes).not.toContain("Purge le")
    const [ligne] = table.getAllByRole("row").slice(1)
    expect(within(ligne).getAllByRole("cell")[entetes.indexOf("Suppr. définitivement le")]).toHaveTextContent("20 octobre 2026")
  })
})

describe("EcranDeNoeud, no « Déplacer » in the header (AC-20)", () => {
  const ARBRE: TreeNode[] = [
    {
      path: "guide",
      kind: "page",
      title: "Guide de Démo",
      status: "published",
      children: [{ path: "ventes", kind: "page", title: "Ventes", status: "published", children: [] }],
    },
  ]

  function Lien({ children, ...props }: { href: string; children: ReactNode }) {
    return <a {...props}>{children}</a>
  }

  // Au niveau gestion, là où il était offert (E05-S10, AC-b4). L'en-tête est un seul composant, quelle que soit la
  // nature (page, procédure, tableau, Contexte) : une page suffit.
  it("should offer no « Déplacer » on a page, even at the management level", () => {
    render(
      <ContexteDeRafraichissement.Provider value={vi.fn()}>
        <EcranDeNoeud
          chemin="ventes/modele_relance"
          noeud={{ data: vueDuNoeud({ level: 3, childrenTotal: 1 }) }}
          arbre={{ data: { tree: ARBRE, truncated: false } }}
          equipes={{ data: [{ slug: "ventes", name: "Ventes" }] }}
          handle="claire"
          nomOrganisation="Démo"
          versionPubliee={false}
          Lien={Lien}
          hrefDuChemin={(chemin) => `/n/${chemin}`}
          prefixeDesPages="/n/"
        />
      </ContexteDeRafraichissement.Provider>,
    )

    expect(screen.queryByRole("button", { name: /^Déplacer/ })).toBeNull()
  })
})
