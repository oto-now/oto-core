// E05-S13, lot A (retours 1 et 8 de JB du 2026-09-28) : l'encart « Contexte · Tout le monde » d'Organisation montre,
// sous les blocs publiés, les listes que le texte servi de ce Contexte porte (AC-4) ; dans la vue « Contexte » de
// l'accueil, chaque partie hors Contexte est une carte sous son titre, ses lignes en français, chaque chemin ou titre
// un lien (AC-14). Les textes servis sont écrits en toutes lettres : ce sont ceux du contrat ; leur parité avec le
// service est tenue par `tests/unit/e05s13-lignes-servies.test.ts`. AC-13 (sans chiffres) et AC-17 (« À quoi sert
// cette page ») : `contexte.test.tsx`, `e05s11-contexte-servi.test.tsx`.
import type { ReactNode } from "react"
import { act, cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import type { BlockView } from "@otomata_tech/oto_platform/schemas"
import { ContexteDeLEntreprise } from "../../../packages/plateforme/ui/admin/organisation/contexte-de-l-entreprise"
import type { DonneesDeLApercu } from "../../../packages/plateforme/ui/contexte/apercu-du-contexte"
import { ContexteServi } from "../../../packages/plateforme/ui/contexte/contexte-servi"

function LienDeTest({ children, ...props }: { href: string; className?: string; children: ReactNode }) {
  return <a {...props}>{children}</a>
}

const ECHEC = "Une erreur est survenue. Réessayez."

/** Un rapport d'aperçu pour des parties données : chacune son nom, son texte servi et sa tête. */
function apercu(parties: readonly { name: string; texte: string; tete?: number }[]): DonneesDeLApercu {
  return {
    text: parties.map((partie) => partie.texte).join("\n\n"),
    budget: 20_000,
    blocks: parties.map((partie) => ({ name: partie.name, chars: partie.texte.length, status: "full", path: null, head: partie.tete ?? 0 })),
  }
}

afterEach(cleanup)

describe("the Contexte of Tout le monde on Organisation (AC-4)", () => {
  const TETE = "## Context: everyone (contexte)\nOrganisation: Démo."
  const SUITE = [
    "Nous vendons des pompes.",
    "",
    "Pages, tables and procedures here:",
    "- contexte/conseil — Conseil — Nos conseils aux clients.",
    "- contexte/tarifs — Tarifs 2026 — Les tarifs.",
    "- contexte/qualifier — Qualifier un prospect — La procédure.",
    "Linked pages:",
    "- support/faq — FAQ support — Réponses types.",
  ].join("\n")
  const BLOCS: BlockView[] = [{ id: "bloc-1", ref: "b1", type: "paragraph", text: "Nous vendons des pompes.", data: {}, key: null, position: 1, revision: 1, provenance: {} }]

  async function monter(servi: Promise<{ data: DonneesDeLApercu } | { error: string }>, lecture: Promise<{ data: BlockView[] } | { error: string }> = Promise.resolve({ data: BLOCS })) {
    await act(async () => {
      render(<ContexteDeLEntreprise lecture={lecture} apercu={servi} prefixeDesPages="/n/" Lien={LienDeTest} ici="/admin/organization" hrefDuContexte="/n/contexte" />)
    })
    return within(screen.getByRole("region", { name: "Contexte · Tout le monde" }))
  }

  const lignesDe = (encart: ReturnType<typeof within>, titre: string) =>
    within(encart.getByRole("list", { name: titre }))
      .getAllByRole("listitem")
      .map((ligne) => [ligne.textContent, within(ligne).getByRole("link").getAttribute("href")])

  it("should show under the published blocks the lists its served text carries, each line leading to its content", async () => {
    const encart = await monter(Promise.resolve({ data: apercu([{ name: "code", texte: "ctx: XXXX-XXXX" }, { name: "contexte", texte: `${TETE}\n${SUITE}`, tete: TETE.length }]) }))
    const bloc = encart.getByText("Nous vendons des pompes.")
    const ranges = encart.getByRole("list", { name: "Rangés sous ce contexte" })
    expect(bloc.compareDocumentPosition(ranges)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(lignesDe(encart, "Rangés sous ce contexte")).toEqual([
      ["Conseil — Nos conseils aux clients.", "/n/contexte/conseil"],
      ["Tarifs 2026 — Les tarifs.", "/n/contexte/tarifs"],
      ["Qualifier un prospect — La procédure.", "/n/contexte/qualifier"],
    ])
    expect(lignesDe(encart, "Pages citées")).toEqual([["FAQ support — Réponses types.", "/n/support/faq"]])
    // Le corps servi n'est pas répété (les blocs le montrent), ni l'en-tête ni les faits de la partie.
    expect(encart.getAllByText("Nous vendons des pompes.")).toHaveLength(1)
    expect(encart.queryByText(/Organisation: Démo|## Context/)).toBeNull()
  })

  it("should show no list when the served text carries none, nor when the part is not served", async () => {
    let encart = await monter(Promise.resolve({ data: apercu([{ name: "contexte", texte: `${TETE}\nNous vendons des pompes.`, tete: TETE.length }]) }))
    expect(encart.queryByRole("list")).toBeNull()
    expect(encart.getByText("Nous vendons des pompes.")).toBeInTheDocument()
    cleanup()
    encart = await monter(Promise.resolve({ data: apercu([{ name: "code", texte: "ctx: XXXX-XXXX" }]) }))
    expect(encart.queryByRole("list")).toBeNull()
  })

  it("should keep the blocks and say the failed read of the lists with « Réessayer »", async () => {
    const encart = await monter(Promise.resolve({ error: ECHEC }))
    expect(encart.getByText("Nous vendons des pompes.")).toBeInTheDocument()
    expect(encart.getByRole("alert")).toHaveTextContent(`Les contenus liés n'ont pas pu être lus.${ECHEC}`)
    expect(encart.getByRole("link", { name: "Réessayer" })).toHaveAttribute("href", "/admin/organization")
  })
})

describe("the parts of the « Contexte » view as read-only cards in French (AC-14)", () => {
  const REGLES = [
    "## How this workspace works",
    ...Array.from({ length: 12 }, (_, rang) => `- Rule ${rang + 1}.`),
  ]
  const PROCEDURES = [
    "## Procedures you can run, most used first (62)",
    ...Array.from({ length: 60 }, (_, rang) => `- ventes/p${String(rang).padStart(2, "0")}: Demandez la procédure ${rang}.`),
    "… and 2 more: find them with demo_find, type procedure.",
  ]
  const PARTIES = [
    { name: "code", texte: ["ctx: XXXX-XXXX", "Pass this ctx to every demo_ tool.", ...REGLES, "## This request", "No request given."].join("\n") },
    { name: "news", texte: ["## What's new since 2026-09-20", "- ventes/devis v3 (2026-09-27): Devis type", "- Connector mail activated (2026-09-26)"].join("\n") },
    { name: "procedures", texte: PROCEDURES.join("\n") },
    { name: "recent content", texte: ["## Recent content", "- ventes/tarifs (table, 2026-09-25): Tarifs 2026", "- ventes/faq (page, 2026-09-24): FAQ"].join("\n") },
  ]

  function monter() {
    render(
      <ContexteServi
        donnees={{ apercu: { data: apercu(PARTIES) }, contextes: {}, equipes: [] }}
        Lien={LienDeTest}
        prefixeDesPages="/n/"
        ici="/context"
      />,
    )
  }

  const partie = (nom: string) => screen.getByRole("region", { name: nom })
  /** La carte d'une partie, sous son titre. */
  function carte(nom: string) {
    const region = partie(nom)
    const titre = within(region).getByRole("heading", { level: 2, name: nom })
    const ilot = region.querySelector(".oto-island")
    expect(ilot).not.toBeNull()
    expect(titre.compareDocumentPosition(ilot as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(within(ilot as HTMLElement).queryByRole("textbox")).toBeNull()
    return within(ilot as HTMLElement)
  }
  const lignes = (element: HTMLElement) => within(element).getAllByRole("listitem").map((ligne) => [ligne.textContent, within(ligne).queryByRole("link")?.getAttribute("href") ?? null])

  it("should read « Nouveautés » with its date, a version and a connector", () => {
    monter()
    const nouveautes = carte("Nouveautés")
    expect(lignes(nouveautes.getByRole("list", { name: "Depuis le 20 septembre 2026" }))).toEqual([
      ["Devis type — version 3, publiée le 27 septembre 2026", "/n/ventes/devis"],
      ["Connecteur mail activé le 26 septembre 2026", null],
    ])
  })

  it("should read « Procédures utiles » with its count, each path a link, and the ones not listed", () => {
    monter()
    const procedures = carte("Procédures utiles")
    const liste = lignes(procedures.getByRole("list", { name: "62 procédures" }))
    expect(liste).toHaveLength(60)
    expect(liste[0]).toEqual(["ventes/p00 — Demandez la procédure 0.", "/n/ventes/p00"])
    expect(procedures.getByText("… et 2 autres, que l'assistant trouve par la recherche.")).toBeInTheDocument()
  })

  it("should read « Contenus récents » by title, kind and date", () => {
    monter()
    expect(lignes(carte("Contenus récents").getByRole("list"))).toEqual([
      ["Tarifs 2026 — tableau, 25 septembre 2026", "/n/ventes/tarifs"],
      ["FAQ — page, 24 septembre 2026", "/n/ventes/faq"],
    ])
  })

  it("should render no card for « Règles Oto » (E11-S10, AC-f4)", () => {
    monter()
    expect(screen.queryByRole("region", { name: "Règles Oto" })).toBeNull()
    expect(document.body.textContent).not.toContain("ctx: XXXX-XXXX")
  })

  it("should leave none of the served English headers in the page", () => {
    monter()
    for (const anglais of ["Procedures you can run", "What's new", "Recent content", "Nothing new", "How this workspace works", "Rule 1."]) {
      expect(document.body.textContent).not.toContain(anglais)
    }
  })
})
