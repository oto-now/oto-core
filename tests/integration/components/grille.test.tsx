// La grille d'un tableau, portée d'oto-frontend (E05-S09 partie c2, AC-c2 ; E07-S03, AC2 à AC9) :
// `TableauDuNoeud` et son chargement, rendus comme la page de l'hôte les monte, sur des lectures construites
// en mémoire (forme de H93). L'hôte est simulé par ce qu'il prête : son lien (une ancre marquée) et sa
// navigation, espionnée (`ContexteDeLHote`) ; les adresses du tableau par `adresseDesReglages`. Les nombres
// attendus se calculent sur ces lignes. E11-S05 : le détail d'une provenance (AC-a2), la ligne à revoir (AC-a4), le vide
// nommé par l'assistant de la personne (AC-h1) ; 1.4.11 : l'icône de provenance, les liens d'une cellule de texte.
import type { AnchorHTMLAttributes, ComponentProps } from "react"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { TableGridRows, TableGridSummary, TableHeader, TableRowRead } from "@otomata_tech/oto_platform/schemas"
import { adresseDesReglages, ContexteDeLHote, EcranDeTableauChargement, reglagesDepuisLAdresse, TableauDuNoeud, type Reglages } from "@otomata_tech/oto_platform/ui"
import { choisirDansLaListe, libellesDesChoix } from "../../helpers/liste-de-choix"

const naviguer = vi.fn()

beforeEach(() => naviguer.mockReset())
afterEach(cleanup)

const STATES = ["à traiter", "en cours", "à revoir", "qualifié", "écarté"]
const CHEMIN = "ventes/suivi_prospects"
const ADRESSE = `/n/${CHEMIN}`

const ENTETE: TableHeader = {
  columns: [
    { name: "ref", type: "text" },
    { name: "entreprise", type: "text" },
    { name: "email", type: "email" },
    { name: "site", type: "url" },
    { name: "montant_estime", type: "number" },
    { name: "dernier_contact", type: "date" },
    { name: "relance_le", type: "datetime" },
    { name: "actif", type: "bool" },
    { name: "statut", type: "enum", options: STATES },
  ],
  key: "ref",
  lifecycle: { column: "statut", states: STATES, working: "en cours", review: { state: "à revoir", approve: "qualifié", reject: "écarté" } },
  closed: false,
  proof: false,
}

const P001: TableRowRead = {
  key: "P-001",
  revision: 3,
  set: {
    ref: "P-001",
    entreprise: "Boulangerie des Tilleuls",
    email: "marion@valbrune.test",
    site: "https://tilleuls.test",
    montant_estime: 12000,
    dernier_contact: "2026-09-24",
    relance_le: "2026-09-30T08:00:00.000Z",
    actif: true,
    statut: "à traiter",
  },
  provenance: {
    montant_estime: { origin: "human", by: "Claire Morel", at: "2026-09-24T12:05:00.000Z", comment: "Devis signé", link: "https://valbrune.test/deliberation-12", imported: { value: 9000, at: "2026-08-01T00:00:00.000Z" } },
    email: { origin: "agent", by: "former member", at: "2026-09-24T12:05:00.000Z", link: "annuaire interne" },
    ref: { origin: "import", at: "2026-09-01T08:00:00.000Z" },
  },
}

const P002: TableRowRead = {
  key: "P-002",
  revision: 1,
  set: { ref: "P-002", site: "ftp://camping.test", actif: false, statut: "en cours" },
  verified_empty: [{ column: "email", reason: "Aucune adresse sur le site" }],
  provenance: { email: { origin: "verified_empty", by: "Léa Roux", at: "2026-09-24T09:00:00.000Z" } },
  claim: { worker: "claude-claire", by: "Claire Morel", until: "2026-09-24T12:05:00.000Z" },
}

const P003: TableRowRead = { key: "P-003", revision: 1, set: { ref: "P-003", statut: "à revoir" }, provenance: {} }

function lignes(rows: TableRowRead[], total = rows.length, count = total): { data: TableGridRows } {
  return { data: { rows, total, count } }
}

const RESUME: { data: TableGridSummary } = {
  data: {
    states: STATES.map((state) => ({ state, count: [7, 0, 3, 0, 0][STATES.indexOf(state)] })),
    sums: [{ column: "montant_estime", total: 21000 }],
  },
}

/** Le lien de l'hôte : une ancre marquée, qui transmet ce qu'on lui pose (classes et attributs du design system). */
function LienDeTest({ children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return (
    <a data-lien-hote="" {...props}>
      {children}
    </a>
  )
}

const hrefDuTableau = (reglages: Reglages) => {
  const recherche = adresseDesReglages(reglages)
  return `${ADRESSE}${recherche ? `?${recherche}` : ""}`
}

function rendre(props: Partial<ComponentProps<typeof TableauDuNoeud>> & { parametres?: Record<string, string | string[]> } = {}) {
  const { parametres = {}, ...reste } = props
  return render(
    <ContexteDeLHote.Provider value={{ Lien: LienDeTest, chemin: ADRESSE, naviguer }}>
      <TableauDuNoeud
        chemin={CHEMIN}
        titre="Suivi des prospects"
        entete={ENTETE}
        lignes={lignes([P001, P002, P003])}
        resume={RESUME}
        reglages={reglagesDepuisLAdresse(parametres, ENTETE)}
        niveau={1}
        Lien={LienDeTest}
        hrefDuTableau={hrefDuTableau}
        adresse={ADRESSE}
        {...reste}
      />
    </ContexteDeLHote.Provider>,
  )
}

const table = () => screen.getByRole("table", { name: /^Suivi des prospects —/ })
/** La cellule d'une ligne, par sa clé (première cellule) et le nom de sa colonne. */
const cellule = (ligne: string, colonne: string) => {
  const rang = ENTETE.columns.findIndex((une) => une.name === colonne)
  const rangee = within(table())
    .getAllByRole("row")
    .find((une) => une.querySelector("td")?.textContent?.startsWith(ligne))
  if (!rangee) throw new Error(`ligne ${ligne} absente`)
  const td = rangee.querySelectorAll("td")[rang]
  if (!(td instanceof HTMLElement)) throw new Error(`cellule ${colonne} absente de ${ligne}`)
  return td
}
/** Les paramètres de la dernière adresse ouverte par l'hôte. */
const derniereAdresse = () => new URL(String(naviguer.mock.lastCall?.[0]), "http://hote.test")

describe("TableauDuNoeud, columns and cells (AC2, AC18)", () => {
  it("should show the declared columns once, the key first as the primary cell, each value in the format of its type, never null", () => {
    rendre()
    expect(table()).toHaveAccessibleName("Suivi des prospects — 3 lignes")
    expect(within(table()).getAllByRole("columnheader").map((entete) => entete.querySelector(".oto-th-sort")?.firstChild?.textContent)).toEqual(ENTETE.columns.map((colonne) => colonne.name))
    expect(within(table()).getAllByRole("row").slice(1).map((rangee) => rangee.querySelector("td[data-primary]")?.textContent?.slice(0, 5))).toEqual(["P-001", "P-002", "P-003"])
    expect(cellule("P-001", "montant_estime")).toHaveTextContent("12 000")
    expect(cellule("P-001", "montant_estime")).toHaveAttribute("data-numeric")
    expect(cellule("P-001", "dernier_contact")).toHaveTextContent("24 septembre 2026")
    expect(cellule("P-001", "relance_le")).toHaveTextContent("30 septembre 2026 à 10:00")
    expect([cellule("P-001", "actif").textContent, cellule("P-002", "actif").textContent]).toEqual(["Oui", "Non"])
    const site = within(cellule("P-001", "site")).getByRole("link", { name: "https://tilleuls.test" })
    expect([site.getAttribute("href"), site.getAttribute("target"), site.getAttribute("rel")]).toEqual(["https://tilleuls.test", "_blank", "noopener noreferrer"])
    expect(within(cellule("P-002", "site")).queryByRole("link")).toBeNull()
    expect(cellule("P-003", "entreprise")).toHaveTextContent("—")
    expect(cellule("P-002", "email")).toHaveTextContent("vérifié vide")
    expect(cellule("P-002", "ref")).toHaveTextContent("en cours · claude-claire jusqu'à 14:05")
    const corps = table().querySelector("tbody")
    expect(corps?.textContent).not.toContain("null")
    // Aucune cellule ne s'édite à l'écran : les champs des filtres vivent dans leur panneau, fermé.
    expect(corps?.querySelectorAll("input, textarea, select")).toHaveLength(0)
    // La table défile dans son cadre, bord à bord dans l'îlot du tableau, jamais la page (AC18).
    expect(table().parentElement).toHaveClass("oto-table-wrap")
    // Jamais en cartes dans une fenêtre étroite : en-têtes, tri et filtres restent (fiche D97 B).
    expect(table()).toHaveAttribute("data-responsive", "scroll")
    expect(table().closest(".oto-island-body")).toHaveAttribute("data-flush")
    expect(screen.getByRole("region", { name: "Suivi des prospects" })).toContainElement(table())
  })
})

describe("TableauDuNoeud, provenance (AC3)", () => {
  // 1.4.11 : une icône « info » après la valeur ouvre le détail dans un panneau posé par-dessus le tableau, au lieu du repli.
  it("should open the provenance of a cell from its info button, over the table: who, when, comment, proof, imported value", () => {
    rendre()
    const montant = cellule("P-001", "montant_estime")
    expect(montant).toHaveTextContent(/^12 000$/)
    const bouton = within(montant).getByRole("button", { name: "Provenance de « montant_estime »" })
    expect(bouton).toHaveAttribute("aria-expanded", "false")
    fireEvent.click(bouton)
    const panneau = screen.getByRole("dialog", { name: "Provenance de « montant_estime »" })
    expect(table()).not.toContainElement(panneau)
    const detail = within(panneau)
    expect(detail.getByText("Décidé par Claire Morel")).toBeInTheDocument()
    expect(detail.getByText("le 24 septembre 2026 à 14:05")).toBeInTheDocument()
    expect(detail.getByText("Commentaire : Devis signé")).toBeInTheDocument()
    expect(detail.getByRole("link", { name: "https://valbrune.test/deliberation-12" })).toHaveAttribute("rel", "noopener noreferrer")
    expect(detail.getByText("Valeur importée à l'origine : 9 000 (le 1 août 2026)")).toBeInTheDocument()
    fireEvent.click(within(cellule("P-001", "email")).getByRole("button", { name: "Provenance de « email »" }))
    const email = within(screen.getByRole("dialog", { name: "Provenance de « email »" }))
    expect(email.getByText("Rempli par l'assistant de un ancien membre")).toBeInTheDocument()
    // Une preuve hors http(s) se lit en texte, jamais en lien.
    expect(email.getByText(/annuaire interne/)).toBeInTheDocument()
    expect(email.queryByRole("link")).toBeNull()
    expect(within(cellule("P-001", "entreprise")).queryByRole("button")).toBeNull()
  })

  it("should keep the value in ink and the detail in grey, its link underlined (E11-S05, AC-a2)", () => {
    rendre()
    const montant = cellule("P-001", "montant_estime")
    expect(montant.querySelector(".oto-cell-info > .text-ink")).toHaveTextContent(/^12 000$/)
    fireEvent.click(within(montant).getByRole("button", { name: "Provenance de « montant_estime »" }))
    const panneau = within(screen.getByRole("dialog", { name: "Provenance de « montant_estime »" }))
    expect(panneau.getByText("Décidé par Claire Morel").parentElement).toHaveClass("text-mute")
    expect(panneau.getByRole("link", { name: "https://valbrune.test/deliberation-12" })).toHaveClass("text-mute", "underline")
  })
})

describe("TableauDuNoeud, text cells (1.4.11)", () => {
  it("should follow the links written in a text cell to their node, and show a web address in a url column shortened", () => {
    const longue = "https://valbrune.test/deliberations/2026/conseil-municipal/seance-du-12-septembre-compte-rendu.pdf"
    const ligne: TableRowRead = { key: "P-009", revision: 1, set: { ref: "P-009", entreprise: String.raw`Voir [[ventes/devis\|Le devis]] et [[ventes/suivi]]`, site: longue }, provenance: {} }
    rendre({ lignes: lignes([ligne]), prefixeDesPages: "/n/" })
    const entreprise = within(cellule("P-009", "entreprise"))
    expect(entreprise.getByRole("link", { name: "Le devis" })).toHaveAttribute("href", "/n/ventes/devis")
    expect(entreprise.getByRole("link", { name: "suivi" })).toHaveAttribute("href", "/n/ventes/suivi")
    const site = within(cellule("P-009", "site")).getByRole("link")
    expect(site).toHaveAttribute("href", longue)
    expect(site.textContent?.length).toBeLessThan(longue.length)
    expect(site).toHaveAttribute("title", longue)
  })

  it("should read the links of a text cell as written when the host gives no page address", () => {
    const ligne: TableRowRead = { key: "P-009", revision: 1, set: { ref: "P-009", entreprise: "[[ventes/devis]]" }, provenance: {} }
    rendre({ lignes: lignes([ligne]) })
    expect(within(cellule("P-009", "entreprise")).queryByRole("link")).toBeNull()
    expect(cellule("P-009", "entreprise")).toHaveTextContent("[[ventes/devis]]")
  })
})

describe("TableauDuNoeud, rows in review (E11-S05, AC-a4)", () => {
  const etats = () =>
    within(table())
      .getAllByRole("row")
      .slice(1)
      .map((rangee) => rangee.getAttribute("data-state"))

  it("should mark the row whose state is the review state of the header, and no other", () => {
    rendre()
    expect(etats()).toEqual([null, null, "review"])
    cleanup()

    // Sans revue déclarée, aucune ligne n'est marquée.
    rendre({ entete: { ...ENTETE, lifecycle: { column: "statut", states: STATES, working: "en cours" } } })
    expect(etats()).toEqual([null, null, null])
  })
})

describe("TableauDuNoeud, sort (AC4)", () => {
  it("should sort a column by its header button through the host, the sorted one the other way, and say an ignored setting", () => {
    rendre({ parametres: { sort: "montant_estime", f: "couleur:contains:bleu" } })
    const montant = screen.getByRole("columnheader", { name: /montant_estime/ })
    expect(montant).toHaveAttribute("aria-sort", "ascending")
    expect(screen.getByRole("columnheader", { name: /entreprise/ })).toHaveAttribute("aria-sort", "none")
    fireEvent.click(screen.getByRole("button", { name: "Trier sur montant_estime" }))
    expect(naviguer).toHaveBeenLastCalledWith(`${ADRESSE}?sort=-montant_estime`)
    fireEvent.click(screen.getByRole("button", { name: "Trier sur entreprise" }))
    expect(naviguer).toHaveBeenLastCalledWith(`${ADRESSE}?sort=entreprise`)
    expect(screen.getByText("Un réglage de l'adresse n'a pas été compris : il est ignoré.")).toBeInTheDocument()
    cleanup()
    rendre({ parametres: { sort: "-montant_estime" } })
    expect(screen.getByRole("columnheader", { name: /montant_estime/ })).toHaveAttribute("aria-sort", "descending")
    expect(screen.queryByText(/n'a pas été compris/)).toBeNull()
  })
})

describe("TableauDuNoeud, search (AC5)", () => {
  it("should search from the toolbar through the host, keeping the sort and the filters, cut to 100 characters, and count the rows found", () => {
    rendre({ parametres: { q: "valbrune", sort: "ref", f: "statut:eq:à traiter", n: "40" }, lignes: lignes([P001], 1, 10) })
    const champ = screen.getByRole("searchbox", { name: "Chercher dans 10 lignes" })
    const recherche = screen.getByRole("search")
    expect(champ).toHaveValue("valbrune")
    expect(recherche).toContainElement(champ)
    fireEvent.change(champ, { target: { value: " tilleuls " } })
    fireEvent.submit(recherche)
    expect([...derniereAdresse().searchParams]).toEqual([
      ["q", "tilleuls"],
      ["sort", "ref"],
      ["f", "statut:eq:à traiter"],
    ])
    fireEvent.change(champ, { target: { value: "x".repeat(150) } })
    fireEvent.submit(recherche)
    expect(derniereAdresse().searchParams.get("q")).toHaveLength(100)
    expect(table()).toHaveAccessibleName("Suivi des prospects — 10 lignes · 1 ligne correspond")
  })
})

describe("TableauDuNoeud, column filters (AC6)", () => {
  const panneau = (colonne: string) => within(screen.getByRole("form", { name: `Filtrer sur ${colonne}` }))
  const ouvrir = (colonne: string) => fireEvent.click(screen.getByRole("button", { name: `Filtrer sur ${colonne}` }))

  it("should offer the operations of each type in the panel of each header, marked when a filter is set", () => {
    rendre({ parametres: { q: "tilleuls", sort: "ref", f: ["montant_estime:gte:10000", "statut:eq:à traiter"] } })
    expect(screen.getByRole("button", { name: "Filtrer sur montant_estime" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("button", { name: "Filtrer sur entreprise" })).toHaveAttribute("aria-pressed", "false")
    ouvrir("entreprise")
    expect(panneau("entreprise").getByLabelText("Contient")).toHaveAttribute("name", "contains")
    ouvrir("statut")
    expect(libellesDesChoix(panneau("statut").getByLabelText("Égal à"))).toEqual(["Peu importe", ...STATES])
    ouvrir("actif")
    expect(libellesDesChoix(panneau("actif").getByLabelText("Égal à"))).toEqual(["Peu importe", "Oui", "Non"])
    for (const [colonne, type] of [["montant_estime", "number"], ["dernier_contact", "date"], ["relance_le", "datetime-local"]]) {
      ouvrir(colonne)
      expect([panneau(colonne).getByLabelText("Au moins").getAttribute("type"), panneau(colonne).getByLabelText("Au plus").getAttribute("type")]).toEqual([type, type])
    }
    expect(panneau("montant_estime").getByLabelText("Au moins")).toHaveValue(10000)
    ouvrir("email")
    expect(panneau("email").getAllByRole("radio").map((radio) => radio.getAttribute("value"))).toEqual(["", "empty", "not_empty"])
    expect(screen.getByRole("link", { name: "Retirer les filtres" })).toHaveAttribute("href", `${ADRESSE}?q=tilleuls&sort=ref`)
  })

  // Les opérateurs de H95 (E11-S07, AC-b4) : `tests/unit/ui-tableau-adresse.test.ts` ; leur câblage, et true ou false pour un
  // booléen, ici.
  it("should apply a filter through the host keeping the other settings, remove it, and move the focus in and out of the panel", () => {
    rendre({ parametres: { q: "tilleuls", sort: "ref", f: ["montant_estime:gte:10000", "statut:eq:à traiter"] } })
    const bouton = screen.getByRole("button", { name: "Filtrer sur montant_estime" })
    fireEvent.click(bouton)
    const auMoins = panneau("montant_estime").getByLabelText("Au moins")
    expect(document.activeElement).toBe(auMoins)
    fireEvent.change(auMoins, { target: { value: "15000" } })
    fireEvent.click(panneau("montant_estime").getByRole("radio", { name: "Rempli" }))
    fireEvent.click(panneau("montant_estime").getByRole("button", { name: "Filtrer" }))
    expect([...derniereAdresse().searchParams]).toEqual([
      ["q", "tilleuls"],
      ["sort", "ref"],
      ["f", "statut:eq:à traiter"],
      ["f", "montant_estime:gte:15000"],
      ["f", "montant_estime:not_empty:"],
    ])
    expect(screen.queryByRole("form", { name: "Filtrer sur montant_estime" })).toBeNull()
    expect(document.activeElement).toBe(bouton)

    fireEvent.click(bouton)
    fireEvent.click(panneau("montant_estime").getByRole("button", { name: "Retirer le filtre de montant_estime" }))
    expect([...derniereAdresse().searchParams]).toEqual([
      ["q", "tilleuls"],
      ["sort", "ref"],
      ["f", "statut:eq:à traiter"],
    ])

    fireEvent.click(bouton)
    fireEvent.keyDown(panneau("montant_estime").getByLabelText("Au moins"), { key: "Escape" })
    expect(screen.queryByRole("form", { name: "Filtrer sur montant_estime" })).toBeNull()
    expect(document.activeElement).toBe(bouton)
    expect(naviguer).toHaveBeenCalledTimes(2)

    // Un booléen s'écrit true ou false dans l'adresse.
    ouvrir("actif")
    choisirDansLaListe(panneau("actif").getByLabelText("Égal à"), "Oui")
    fireEvent.click(panneau("actif").getByRole("button", { name: "Filtrer" }))
    expect(derniereAdresse().searchParams.getAll("f")).toEqual(["montant_estime:gte:10000", "statut:eq:à traiter", "actif:eq:true"])
  })
})

describe("TableauDuNoeud, focus after a gesture (AC-x3)", () => {
  it("should give the focus back to the search field its search remounts, and to the island when a filter empties the table", () => {
    const ecran = (parametres: Record<string, string>, lu: { data: TableGridRows }) => (
      <ContexteDeLHote.Provider value={{ Lien: LienDeTest, chemin: ADRESSE, naviguer }}>
        <TableauDuNoeud chemin={CHEMIN} titre="Suivi des prospects" entete={ENTETE} lignes={lu} resume={RESUME} reglages={reglagesDepuisLAdresse(parametres, ENTETE)} niveau={1} Lien={LienDeTest} hrefDuTableau={hrefDuTableau} adresse={ADRESSE} />
      </ContexteDeLHote.Provider>
    )
    const vue = render(ecran({}, lignes([P001, P002, P003])))
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "tilleuls" } })
    fireEvent.submit(screen.getByRole("search"))
    // L'hôte relit la page à l'adresse de la recherche : le champ, remonté par sa clé, reprend le focus.
    vue.rerender(ecran({ q: "tilleuls" }, lignes([P001], 1, 3)))
    expect(document.activeElement).toBe(screen.getByRole("searchbox", { name: "Chercher dans 3 lignes" }))

    const bouton = screen.getByRole("button", { name: "Filtrer sur statut" })
    fireEvent.click(bouton)
    choisirDansLaListe(within(screen.getByRole("form", { name: "Filtrer sur statut" })).getByLabelText("Égal à"), "écarté")
    fireEvent.click(within(screen.getByRole("form", { name: "Filtrer sur statut" })).getByRole("button", { name: "Filtrer" }))
    expect(document.activeElement).toBe(bouton)
    // Le filtre ne garde aucune ligne : la table et son bouton partent, le focus va à l'îlot du tableau.
    vue.rerender(ecran({ q: "tilleuls", f: "statut:eq:écarté" }, lignes([], 0, 3)))
    expect(screen.queryByRole("table")).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole("region", { name: "Suivi des prospects" }))
  })

  it("should leave the focus alone on a later reading when the gesture opened a panel without navigating", () => {
    const ecran = () => (
      <ContexteDeLHote.Provider value={{ Lien: LienDeTest, chemin: ADRESSE, naviguer }}>
        <TableauDuNoeud chemin={CHEMIN} titre="Suivi des prospects" entete={ENTETE} lignes={lignes([P001, P002, P003])} resume={RESUME} reglages={reglagesDepuisLAdresse({}, ENTETE)} niveau={1} Lien={LienDeTest} hrefDuTableau={hrefDuTableau} adresse={ADRESSE} />
      </ContexteDeLHote.Provider>
    )
    const vue = render(ecran())
    const bouton = screen.getByRole("button", { name: "Filtrer sur statut" })
    fireEvent.click(bouton)
    fireEvent.keyDown(within(screen.getByRole("form", { name: "Filtrer sur statut" })).getByLabelText("Égal à"), { key: "Escape" })
    bouton.blur()
    // Une relecture venue d'ailleurs (une décision de revue) : aucun geste de la grille ne l'a demandée.
    vue.rerender(ecran())
    expect(naviguer).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(document.body)
  })
})

describe("TableauDuNoeud, load more (AC7)", () => {
  it("should show 20 rows of 57 with « Charger plus » to n=40, « Affinez… » instead at 200, and neither once every row is shown", () => {
    const ligne = (rang: number): TableRowRead => ({ key: `P-${rang}`, revision: 1, set: { ref: `P-${rang}` } })
    const vingt = Array.from({ length: 20 }, (_, rang) => ligne(rang))
    rendre({ lignes: lignes(vingt, 57) })
    expect(screen.getByText("20 lignes affichées sur 57")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Charger plus" })).toHaveAttribute("href", `${ADRESSE}?n=40`)
    cleanup()
    rendre({ lignes: lignes(vingt, 250), parametres: { n: "200" } })
    expect(screen.queryByRole("link", { name: "Charger plus" })).toBeNull()
    expect(screen.getByText("Affinez la recherche ou les filtres pour voir les autres lignes.")).toBeInTheDocument()
    // La fin : toutes les lignes qui répondent sont affichées, à 20 comme à 200.
    for (const [rangees, n] of [[[P001, P002, P003], "20"], [Array.from({ length: 200 }, (_, rang) => ligne(rang)), "200"]] as const) {
      cleanup()
      rendre({ lignes: lignes([...rangees]), parametres: { n } })
      expect(screen.getByText(`${rangees.length} lignes affichées sur ${rangees.length}`)).toBeInTheDocument()
      expect(screen.queryByRole("link", { name: "Charger plus" })).toBeNull()
      expect(screen.queryByText(/^Affinez/)).toBeNull()
    }
  })
})

describe("TableauDuNoeud, summary (AC8)", () => {
  it("should count each declared state and sum each number column, and say a failed summary without breaking the grid", () => {
    rendre()
    const parEtat = RESUME.data.states?.map((etat) => `${etat.state} ${etat.count}`).join(" · ")
    expect(screen.getByText(`Par statut : ${parEtat}`)).toHaveTextContent("Par statut : à traiter 7 · en cours 0 · à revoir 3 · qualifié 0 · écarté 0")
    expect(screen.getByText(/^montant_estime : total/)).toHaveTextContent("montant_estime : total 21 000")
    cleanup()
    rendre({ resume: { error: "Une erreur est survenue. Réessayez." }, parametres: { sort: "ref" } })
    // Le seul échec de lecture du paquet (M49, HN-M37b-3) : la phrase du résumé en titre, le message dessous.
    expect(screen.getByRole("alert")).toHaveTextContent("Le résumé n'a pas pu être calculé.Une erreur est survenue. Réessayez.")
    expect(screen.getByRole("alert")).toHaveClass("oto-alert")
    expect(within(screen.getByRole("alert")).getByRole("link", { name: "Réessayer" })).toHaveAttribute("href", `${ADRESSE}?sort=ref`)
    expect(table()).toBeInTheDocument()
  })
})

describe("TableauDuNoeud, four states (AC9)", () => {
  it("should show the loading rows, a failed read with « Réessayer » and the toolbar, an empty table, and no match with the gesture that clears it", () => {
    render(<EcranDeTableauChargement />)
    const chargement = screen.getByRole("status")
    expect([chargement.getAttribute("aria-busy"), chargement.textContent, chargement.querySelectorAll(".oto-skeleton[data-shape='row']").length]).toEqual(["true", "Chargement des lignes…", 8])
    cleanup()
    rendre({ lignes: { error: "Une erreur est survenue. Réessayez." }, parametres: { sort: "ref", q: "tilleuls" } })
    expect(screen.getByRole("alert")).toHaveTextContent("Chargement impossibleUne erreur est survenue. Réessayez.")
    expect(within(screen.getByRole("alert")).getByRole("link", { name: "Réessayer" })).toHaveAttribute("href", `${ADRESSE}?q=tilleuls&sort=ref`)
    expect(screen.getByRole("searchbox", { name: "Chercher dans le tableau" })).toHaveValue("tilleuls")
    cleanup()
    // Le vide dit qui écrira les lignes (E11-S05, AC-h1) : l'assistant le plus récent, sinon « votre assistant ».
    rendre({ lignes: lignes([], 0, 0) })
    expect(screen.getByText("Ce tableau est vide")).toBeInTheDocument()
    expect(screen.getByText("C'est votre assistant qui pourra créer et modifier ses lignes.")).toBeInTheDocument()
    expect(screen.queryByRole("table")).toBeNull()
    cleanup()
    rendre({ lignes: lignes([], 0, 0), assistant: "claude.ai" })
    expect(screen.getByText("C'est Claude qui pourra créer et modifier ses lignes.")).toBeInTheDocument()
    cleanup()
    rendre({ lignes: lignes([], 0, 10), parametres: { f: "statut:eq:écarté" } })
    expect(screen.getByText("Aucune ligne pour cette recherche")).toBeInTheDocument()
    expect(screen.getAllByRole("link", { name: "Retirer les filtres" }).map((lien) => lien.getAttribute("href"))).toEqual([ADRESSE, ADRESSE])
    cleanup()
    rendre({ lignes: lignes([], 0, 10), parametres: { q: "tilleuls", f: "statut:eq:écarté", sort: "ref" } })
    expect(screen.getByRole("link", { name: "Retirer la recherche et les filtres" })).toHaveAttribute("href", `${ADRESSE}?sort=ref`)
  })
})
