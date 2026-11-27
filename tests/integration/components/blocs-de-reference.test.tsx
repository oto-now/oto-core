// Les blocs `reference` rendus en place (E07-S03, AC15 à AC17) : `referencesRendues` sur des résolutions
// construites en mémoire (forme de `resolveReferencesForScreen`), puis leurs rendus au repos dans
// `RenduDUnBloc` (lecture) et dans l'éditeur d'E05-S02 (îlot client, sous sa file d'écriture) ; un bloc sans
// rendu garde `ReferenceEnLien`. Et la frontière client de `ui/tableau/` : les vues, les cartes et l'écran
// rendus par le serveur.
import type { ReactNode } from "react"
import fs from "fs"
import path from "path"
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import type { BlockView, ScreenReference } from "@otomata_tech/oto_platform/schemas"
import { ContexteDeRafraichissement, referencesRendues } from "@otomata_tech/oto_platform/ui"
import { EditeurDeBlocs } from "../../../packages/plateforme/ui/noeud/editeur/editeur-de-blocs"
import { FileDOperations } from "../../../packages/plateforme/ui/noeud/editeur/file-d-operations"
import { RenduDUnBloc } from "../../../packages/plateforme/ui/noeud/rendu-des-blocs"
import { bloc } from "../../helpers/noeud"

afterEach(cleanup)

const TABLEAU = "ventes/suivi_prospects"
const GRILLE = "conseil/grille_tarifaire"

function LienDeTest({ children, ...props }: { href: string; className?: string; children: ReactNode }) {
  return (
    <a data-lien-hote="" {...props}>
      {children}
    </a>
  )
}

const hrefDuChemin = (chemin: string) => `/n/${chemin}`
const reference = (rang: number, chemin: string): BlockView => ({ ...bloc(`${String(rang).padStart(8, "0")}-0000-4000-8000-000000000000`, "reference", null, { path: chemin }), ref: `ref-${rang}` })

const VUE: ScreenReference = {
  kind: "view",
  path: TABLEAU,
  title: "Suivi des prospects",
  key: "ref",
  columns: [
    { name: "ref", type: "text" },
    { name: "entreprise", type: "text" },
    { name: "statut", type: "enum", options: ["à traiter", "à revoir"] },
  ],
  rows: [
    { key: "P-001", revision: 1, set: { entreprise: "Boulangerie des Tilleuls", statut: "à traiter" } },
    { key: "P-003", revision: 4, set: { entreprise: "Mairie de Valbrune", statut: "à revoir" } },
  ],
  total: 3,
}

const CARTE: ScreenReference = { kind: "card", path: GRILLE, title: "Grille tarifaire", nodeKind: "page", summary: "Tarifs des études, en euros HT." }

/** Douze blocs : une vue, une carte, deux introuvables, une vue illisible, cinq cartes, la onzième et la douzième. */
const BLOCS = Array.from({ length: 12 }, (_, rang) => reference(rang, rang === 0 || rang === 2 || rang === 4 ? TABLEAU : GRILLE))
const RESOLUTIONS: Record<string, ScreenReference> = {
  [BLOCS[0].id]: VUE,
  [BLOCS[1].id]: { ...CARTE, movedFrom: "conseil/ancienne_grille" },
  [BLOCS[2].id]: { kind: "view", path: TABLEAU, error: "not_found", reason: "not_found" },
  [BLOCS[3].id]: { kind: "card", path: GRILLE, error: "not_found", reason: "not_found" },
  [BLOCS[4].id]: { kind: "view", path: TABLEAU, error: "invalid_arguments", reason: "unknown_column", detail: "couleur" },
  ...Object.fromEntries(BLOCS.slice(5, 10).map((un) => [un.id, CARTE])),
}

function rendus(resolutions: Parameters<typeof referencesRendues>[0]["resolutions"] = { data: RESOLUTIONS }) {
  return referencesRendues({ resolutions, blocs: BLOCS, Lien: LienDeTest, hrefDuChemin })
}

describe("referencesRendues (AC15, AC16)", () => {
  it("should render a view in place: key column first, its rows, « n lignes sur total » and « Ouvrir le tableau »", () => {
    render(<>{rendus()[BLOCS[0].id]}</>)
    const table = screen.getByRole("table", { name: "Suivi des prospects — vue" })
    // La table du design system (M31), plus les classes de `classes.ts`.
    expect(table).toHaveClass("oto-table")
    expect(within(table).getAllByRole("columnheader").map((entete) => entete.textContent)).toEqual(["Ref", "Entreprise", "Statut"])
    expect(within(table).getAllByRole("rowheader").map((entete) => entete.textContent)).toEqual(["P-001", "P-003"])
    expect(screen.getByText("2 lignes sur 3")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Ouvrir le tableau" })).toHaveAttribute("href", `/n/${TABLEAU}`)
  })

  it("should render a card, say a target not found or an unreadable view, and keep the link beyond ten references", () => {
    const tous = rendus()
    render(<>{tous[BLOCS[1].id]}</>)
    expect(screen.getByRole("link", { name: "Grille tarifaire" })).toHaveAttribute("href", `/n/${GRILLE}`)
    expect(screen.getByText("Page · ancien chemin : conseil/ancienne_grille")).toBeInTheDocument()
    // Le résumé d'une page ne se montre pas sur sa carte, seul celui d'une procédure (E11-S05, AC-f2).
    expect(screen.queryByText("Tarifs des études, en euros HT.")).toBeNull()
    cleanup()
    render(
      <>
        {tous[BLOCS[2].id]}
        {tous[BLOCS[3].id]}
      </>,
    )
    expect(screen.getByText(`Tableau introuvable ou non partagé : ${TABLEAU}.`)).toBeInTheDocument()
    expect(screen.getByText(`Page introuvable ou non partagée : ${GRILLE}.`)).toBeInTheDocument()
    expect(screen.queryByRole("link")).toBeNull()
    cleanup()
    render(<>{tous[BLOCS[4].id]}</>)
    expect(screen.getByRole("link", { name: TABLEAU })).toHaveAttribute("href", `/n/${TABLEAU}`)
    expect(screen.getByText("Vue illisible : colonne inconnue (couleur).")).toBeInTheDocument()
    cleanup()
    render(<>{tous[BLOCS[10].id]}</>)
    expect(screen.getByRole("link", { name: GRILLE })).toBeInTheDocument()
    expect(screen.getByText("Trop de vues dans cette page : les suivantes s'affichent en lien.")).toBeInTheDocument()
    expect(Object.keys(tous)).toEqual(BLOCS.slice(0, 11).map((un) => un.id))
  })

  it("should say a failed resolution on the first reference only, the others kept in link", () => {
    const echec = rendus({ error: "Une erreur est survenue. Réessayez." })
    expect(Object.keys(echec)).toEqual([BLOCS[0].id])
    render(<>{echec[BLOCS[0].id]}</>)
    expect(screen.getByText("Les vues et les cartes de cette page n'ont pas pu être lues : les références s'affichent en lien.")).toBeInTheDocument()
  })
})

describe("references rendered at rest (AC16, AC17)", () => {
  it("should show the rendered node under the block anchor in the reader and in the editor, and ReferenceEnLien without one", () => {
    const tous = rendus()
    const { container } = render(
      <>
        <RenduDUnBloc bloc={BLOCS[0]} Lien={LienDeTest} hrefDuChemin={hrefDuChemin} rendu={tous[BLOCS[0].id]} />
        <RenduDUnBloc bloc={BLOCS[11]} Lien={LienDeTest} hrefDuChemin={hrefDuChemin} />
      </>,
    )
    expect(container.querySelector('[id="ref-0"]')?.querySelector("table")).not.toBeNull()
    expect(container.querySelector('[id="ref-11"]')).toHaveTextContent(GRILLE)
    cleanup()

    render(
      <ContexteDeRafraichissement.Provider value={() => {}}>
        <FileDOperations chemin="ventes/prospects_valbrune" revisionPubliee={1} tampon={null}>
          <EditeurDeBlocs blocs={[BLOCS[1], BLOCS[11]]} revisionServie={1} prefixeDesPages="/n/" referencesRendues={tous} />
        </FileDOperations>
      </ContexteDeRafraichissement.Provider>,
    )
    expect(screen.getByRole("link", { name: "Grille tarifaire" })).toHaveAttribute("data-lien-hote")
    expect(screen.getByText("Page · ancien chemin : conseil/ancienne_grille")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: GRILLE })).toHaveAttribute("href", `/n/${GRILLE}`)
  })

  // Depuis la grille portée d'oto-frontend (E05-S09 partie c2) : l'îlot du tableau, sa barre, sa table et le
  // filtre d'une colonne sont des îlots client (la table du design system rend ses cellules par des fonctions,
  // l'îlot replie le focus) ; les vues, les cartes et l'écran restent rendus par le serveur. Les réglages du
  // tableau (E11-S01, lot g) sont un îlot client : leurs interrupteurs tiennent un état et publient un geste.
  it("should keep the views, the cards and the screen on the server, the island, the toolbar, the table, the filter, the options and the review as client islands", () => {
    const dossier = path.resolve(__dirname, "../../../packages/plateforme/ui/tableau")
    const ilots = fs.readdirSync(dossier).filter((fichier) => fs.readFileSync(path.join(dossier, fichier), "utf8").startsWith('"use client"'))
    expect(ilots.sort()).toEqual(["barre-du-tableau.tsx", "decision-de-revue.tsx", "filtre-de-colonne.tsx", "grille.tsx", "ilot-du-tableau.tsx", "options-du-tableau.tsx", "resume-de-revue.tsx"])
  })
})
