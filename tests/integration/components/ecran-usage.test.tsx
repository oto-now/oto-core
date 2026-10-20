import type { AnchorHTMLAttributes } from "react"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { usageQuerySchema, type UsagePeriod, type UsageQuery, type UsageSummary } from "@otomata_tech/oto_platform/schemas"
import { ContexteDeLHote, EcranUsage, EcranUsageChargement, type EcranUsageProps } from "@otomata_tech/oto_platform/ui"
import { libellesDesChoix } from "../../helpers/liste-de-choix"

// L'écran « Statistiques » (E08-S09 : AC2 à AC6, AC8, AC15 ; 1.4.13 : nom, adoption, contenu, partage et connecteurs), porté sur le design system d'oto-frontend
// (E05-S09 partie d2 : `suivi-de-lentreprise.tsx`, `fenetre-du-suivi.tsx`, `adoption-des-membres.tsx`), sur des
// données en mémoire rendues comme la page de l'hôte les passe ; la navigation de l'hôte est un espion ; les
// heures sont lues à Paris (UTC+2 en septembre).

const naviguer = vi.fn()

beforeEach(() => naviguer.mockReset())
afterEach(cleanup)

const VENTES = "0e8e5a3c-7f10-4a5b-8d3b-2b1c4d5e6f70"
const ECHEC = "Une erreur est survenue. Réessayez."

const USAGE: UsageSummary = {
  periode: 7,
  team: { id: VENTES, name: "Ventes" },
  truncated: false,
  coveredFrom: null,
  totals: { conversations: 1234, people: 3, calls: 8, errors: 1 },
  procedures: [
    { path: "ventes/qualifier_prospects", title: "Qualifier les prospects", served: 3, conversations: 2, people: 2, lastServedAt: "2026-09-23T12:02:07.000Z" },
  ],
  functions: [
    { name: "table.write", calls: 4, errors: 1, lastError: { message: "invalid_arguments: Unknown column « statut ».", at: "2026-09-23T12:03:40.000Z" } },
    { name: "table.schema", calls: 2, errors: 0, lastError: null },
  ],
  unmatched: {
    count: 2,
    items: [{ ctx: "DEMO-0004", at: "2026-09-23T13:00:00.000Z", person: null, phrase: "Prépare le planning des tournées de la semaine", host: null }],
  },
  statistics: {
    adoption: {
      weeks: [
        { week: "2026-09-14", people: 1, conversations: 2 },
        { week: "2026-09-21", people: 3, conversations: 5 },
      ],
      assistants: [
        { name: "Claude", conversations: 3 },
        { name: null, conversations: 1 },
      ],
      pendingInvitations: 2,
      neverSignedIn: { count: 3, names: ["Léa Roux", "Marc Petit"] },
    },
    content: {
      weeks: [
        { week: "2026-09-14", created: 0, published: 0 },
        { week: "2026-09-21", created: 4, published: 6 },
      ],
      written: { assistant: 3, human: 1 },
      mostRead: [{ path: "ventes/tarifs", title: "Tarifs", reads: 7, conversations: 3 }],
    },
    sharing: {
      publicLinks: { active: 1, created: 1 },
      connectors: [
        { name: "mail", label: "Mail", active: true, calls: 5, errors: 1 },
        { name: "table", label: null, active: false, calls: 2, errors: 0 },
      ],
    },
    teams: [
      { id: VENTES, name: "Ventes", members: 4, activeMembers: 3, conversations: 4, calls: 9, pages: 2, proceduresServed: 3, topProcedure: { path: "ventes/qualifier_prospects", title: "Qualifier les prospects" }, lastActivity: "2026-09-23T12:00:00.000Z" },
      { id: "t-compta", name: "Compta", members: 2, activeMembers: 0, conversations: 0, calls: 0, pages: 0, proceduresServed: 0, topProcedure: null, lastActivity: null },
    ],
    people: [
      { userId: "u-lea", name: "Léa Roux", teams: ["Ventes"], lastSignInAt: "2026-09-22T09:00:00.000Z", lastAssistantUse: "2026-09-23T12:00:00.000Z", conversations: 3, calls: 7, pagesByHand: 1, pagesByAssistant: 2, assistant: "Claude", neverSignedIn: false, inactive: false },
      { userId: "u-marc", name: "Marc Petit", teams: ["Compta", "Ventes"], lastSignInAt: null, lastAssistantUse: null, conversations: 0, calls: 0, pagesByHand: 0, pagesByAssistant: 0, assistant: null, neverSignedIn: true, inactive: false },
      { userId: "u-zoe", name: "Zoé Blanc", teams: [], lastSignInAt: "2026-07-01T09:00:00.000Z", lastAssistantUse: null, conversations: 1, calls: 2, pagesByHand: 0, pagesByAssistant: 0, assistant: null, neverSignedIn: false, inactive: true },
    ],
  },
}
const VIDE: UsageSummary = {
  ...USAGE,
  team: null,
  totals: { conversations: 0, people: 0, calls: 0, errors: 0 },
  procedures: [],
  functions: [],
  unmatched: { count: 0, items: [] },
  statistics: {
    adoption: { weeks: [{ week: "2026-09-21", people: 0, conversations: 0 }], assistants: [], pendingInvitations: 0, neverSignedIn: { count: 0, names: [] } },
    content: { weeks: [{ week: "2026-09-21", created: 0, published: 0 }], written: { assistant: 0, human: 0 }, mostRead: [] },
    sharing: { publicLinks: { active: 0, created: 0 }, connectors: [] },
    teams: [],
    people: [],
  },
}
const EQUIPES = [{ id: VENTES, name: "Ventes" }]

function LienDeTest({ children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return <a {...props}>{children}</a>
}

function hrefDeFenetre(filtres: UsageQuery) {
  return (periode: UsagePeriod) => (filtres.team ? `/admin/usage?period=${periode}&team=${filtres.team}` : `/admin/usage?period=${periode}`)
}

function rendre(resultat: EcranUsageProps["resultat"], adresse: Record<string, string> = { period: "7", team: VENTES }) {
  const filtres = usageQuerySchema.parse(adresse)
  return render(
    <ContexteDeLHote.Provider value={{ Lien: LienDeTest, chemin: "/admin/usage", naviguer }}>
      <EcranUsage
        resultat={resultat}
        filtres={filtres}
        Lien={LienDeTest}
        hrefDuNoeud={(chemin) => `/n/${chemin}`}
        hrefDeConversation={(code, periode) => `/journal?conversation=${code}&period=${periode}`}
        hrefDeFenetre={hrefDeFenetre(filtres)}
        actionDuFiltre="/admin/usage"
      />
    </ContexteDeLHote.Provider>,
  )
}

const donnees = (usage: UsageSummary): EcranUsageProps["resultat"] => ({ data: { usage, equipes: EQUIPES } })
const ilot = (nom: string) => screen.getByRole("region", { name: nom })
// `Intl` sépare les milliers et le « % » par une espace insécable (fine ou non selon ICU) : comparée en espace.
const texte = (valeur: string | null | undefined) => valeur?.replace(/\s/gu, " ")
const cellules = (ligne: HTMLElement) => within(ligne).getAllByRole("cell").map((cellule) => texte(cellule.textContent))

describe("EcranUsage states (AC15)", () => {
  it("should render the loading state as a busy status", () => {
    render(<EcranUsageChargement />)
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true")
    expect(screen.getByText("Chargement des statistiques…")).toHaveClass("oto-sr-only")
  })

  it("should say a failed read once, with « Réessayer » to the same address, the heading still readable", () => {
    rendre({ error: ECHEC })
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Statistiques")
    expect(screen.getByRole("alert")).toHaveTextContent(ECHEC)
    expect(screen.getByRole("link", { name: "Réessayer" })).toHaveAttribute("href", `/admin/usage?period=7&team=${VENTES}`)
    expect(screen.queryByRole("table")).toBeNull()
    expect(screen.queryByRole("radiogroup")).toBeNull()
  })
})

describe("EcranUsage window and team (AC2)", () => {
  it("should offer the three windows as a segmented choice, the active one checked, each opening its address by the host", () => {
    rendre(donnees(USAGE))
    expect(screen.getByText("Sur les 7 derniers jours · équipe Ventes")).toBeInTheDocument()
    const fenetres = within(screen.getByRole("radiogroup", { name: "La période observée" })).getAllByRole("radio")
    expect(fenetres.map((fenetre) => [fenetre.textContent, fenetre.getAttribute("aria-checked")])).toEqual([
      ["7 jours", "true"],
      ["30 jours", "false"],
      ["90 jours", "false"],
    ])
    fireEvent.click(fenetres[2])
    expect(naviguer).toHaveBeenCalledWith(`/admin/usage?period=90&team=${VENTES}`)
  })

  it("should be reached once by Tab and moved by the arrows, like a radio group (E05-S09, AC-x3)", () => {
    rendre(donnees(USAGE))
    const fenetres = within(screen.getByRole("radiogroup", { name: "La période observée" })).getAllByRole("radio")
    expect(fenetres.map((fenetre) => fenetre.tabIndex)).toEqual([0, -1, -1])
    fenetres[0].focus()
    fireEvent.keyDown(fenetres[0], { key: "ArrowRight" })
    expect(naviguer).toHaveBeenCalledWith(`/admin/usage?period=30&team=${VENTES}`)
    expect(fenetres[1]).toHaveFocus()
  })

  it("should filter by team with a GET form keeping the window, without JavaScript", () => {
    rendre(donnees(USAGE))
    const formulaire = screen.getByRole("form", { name: "Filtrer par équipe" })
    expect(formulaire).toHaveAttribute("method", "get")
    expect(formulaire).toHaveAttribute("action", "/admin/usage")
    const equipe = within(formulaire).getByRole("combobox", { name: "Équipe" })
    expect(equipe).toHaveValue(VENTES)
    expect(equipe).toHaveTextContent("Ventes")
    expect(libellesDesChoix(equipe)).toEqual(["Toutes les équipes", "Ventes"])
    expect(formulaire.querySelector('input[type="hidden"][name="team"]')).toHaveValue(VENTES)
    expect(formulaire.querySelector('input[type="hidden"][name="period"]')).toHaveValue("7")
    expect(within(formulaire).getByRole("button", { name: "Filtrer" })).toHaveAttribute("type", "submit")
  })

  it("should show « Toutes les équipes » and no team in the heading when the service ignored the team", () => {
    rendre(donnees(VIDE), { period: "7", team: "0b6f1f0e-1c1a-4a8e-9a51-0d7c1a2b3c02" })
    expect(screen.getByText("Sur les 7 derniers jours")).toBeInTheDocument()
    expect(screen.getByRole("combobox", { name: "Équipe" })).toHaveValue("")
  })
})

describe("EcranUsage islands (AC3 to AC6, AC8)", () => {
  it("should show the four read-only key figures, the error rate as a French percentage", () => {
    rendre(donnees(USAGE))
    const chiffres = within(ilot("Chiffres clés"))
    const tuiles = ["Conversations", "Personnes actives", "Appels", "Taux d'erreur"].map((libelle) => [libelle, texte(chiffres.getByText(libelle).previousElementSibling?.textContent)])
    expect(tuiles).toEqual([
      ["Conversations", "1 234"],
      ["Personnes actives", "3"],
      ["Appels", "8"],
      ["Taux d'erreur", "12,5 %"],
    ])
    expect(chiffres.queryByRole("link")).toBeNull()
    expect(chiffres.queryByRole("button")).toBeNull()
  })

  it("should list the served procedures linked to their page, the functions by errors, and the conversations without a procedure linked to the journal", () => {
    rendre(donnees(USAGE))
    const [procedure] = within(ilot("Procédures les plus servies")).getAllByRole("row").slice(1)
    expect(cellules(procedure)).toEqual(["Qualifier les prospectsventes/qualifier_prospects", "3", "2", "2", "23 septembre 2026 à 14:02"])
    expect(within(procedure).getByRole("link", { name: "Qualifier les prospects" })).toHaveAttribute("href", "/n/ventes/qualifier_prospects")

    const fonctions = within(ilot("Erreurs par fonction"))
    expect(fonctions.getAllByRole("columnheader").map((entete) => [entete.textContent, entete.getAttribute("scope")])).toEqual(
      ["Fonction", "Appels", "Erreurs", "Taux", "Dernière erreur"].map((nom) => [nom, "col"]),
    )
    const [ecriture, schema] = fonctions.getAllByRole("row").slice(1)
    expect(cellules(ecriture)).toEqual(["table.write", "4", "1", "25 %", "invalid_arguments: Unknown column « statut ».23 septembre 2026 à 14:03"])
    expect(cellules(schema)).toEqual(["table.schema", "2", "0", "0 %", "—"])

    const sansProcedure = within(ilot("Conversations sans procédure"))
    expect(sansProcedure.getByText("2 conversations sans procédure trouvée")).toBeInTheDocument()
    expect(sansProcedure.getByText("Ces demandes n'ont trouvé ni procédure ni appel : elles nourrissent le titre et le résumé des procédures.")).toBeInTheDocument()
    const [demande] = sansProcedure.getAllByRole("row").slice(1)
    expect(cellules(demande)).toEqual(["23 septembre 2026 à 15:00", "Personne retirée", "Prépare le planning des tournées de la semaine (conversation DEMO-0004)", "—"])
    expect(within(demande).getByRole("link")).toHaveAttribute("href", "/journal?conversation=DEMO-0004&period=7")
  })

  it("should say each empty island, and « — » for an error rate without calls", () => {
    rendre(donnees(VIDE))
    expect(within(ilot("Chiffres clés")).getByText("Taux d'erreur").previousElementSibling).toHaveTextContent("—")
    expect(within(ilot("Procédures les plus servies")).getByText("Aucune procédure servie sur cette période. Essayez une période plus large.")).toBeInTheDocument()
    expect(within(ilot("Erreurs par fonction")).getByText("Aucun appel de fonction sur cette période.")).toBeInTheDocument()
    expect(within(ilot("Conversations sans procédure")).getByText("Toutes les demandes de la période ont trouvé une procédure ou mené à un appel.")).toBeInTheDocument()
    expect(within(ilot("Adoption")).getByText("Aucune conversation sur cette période.")).toBeInTheDocument()
    expect(within(ilot("Contenu")).getByText("Aucun contenu créé ni publié sur cette période.")).toBeInTheDocument()
    expect(within(ilot("Contenu")).getByText("Les assistants n'ont lu aucun contenu sur cette période.")).toBeInTheDocument()
    expect(within(ilot("Partage et connecteurs")).getByText("Aucun connecteur activé ni appelé sur cette période.")).toBeInTheDocument()
    expect(within(ilot("Par équipe")).getByText("Aucune équipe dans l'organisation.")).toBeInTheDocument()
    expect(within(ilot("Par personne")).getByText("Aucun membre à montrer.")).toBeInTheDocument()
    expect(screen.queryByRole("table")).toBeNull()
  })

  it("should say the 20,000-call bound as information, with the date the period is covered from (AC8)", () => {
    rendre(donnees({ ...USAGE, truncated: true, coveredFrom: "2026-09-20T08:30:00.000Z" }))
    expect(screen.getByRole("status")).toHaveTextContent(
      "Calculé sur les 20 000 appels les plus récents : la période n'est couverte qu'à partir du 20 septembre 2026 à 10:30. Les appels plus anciens ne sont pas comptés.",
    )
    expect(screen.queryByRole("alert")).toBeNull()
  })
})

// 1.4.13 : les trois îlots des statistiques, tels que le service les calcule.
describe("EcranUsage statistics (1.4.13)", () => {
  it("should show the adoption: invitations, members never signed in, the weekly curve, each week and each assistant", () => {
    rendre(donnees(USAGE))
    const adoption = within(ilot("Adoption"))
    expect(texte(adoption.getByText("Invitations en attente").previousElementSibling?.textContent)).toBe("2")
    expect(adoption.getByText("Jamais connectés : Léa Roux, Marc Petit et 1 autre.")).toBeInTheDocument()
    expect(adoption.getByRole("img", { name: "Activité par semaine, sur 2 semaines : 3 personnes actives et 5 conversations au plus." })).toBeInTheDocument()
    const [semaines, assistants] = adoption.getAllByRole("table")
    expect(within(semaines).getAllByRole("row").slice(1).map(cellules)).toEqual([
      ["Semaine du 14/09/2026", "1", "2"],
      ["Semaine du 21/09/2026", "3", "5"],
    ])
    expect(within(assistants).getAllByRole("row").slice(1).map(cellules)).toEqual([
      ["Claude", "3", "75 %"],
      ["Non renseigné", "1", "25 %"],
    ])
  })

  it("should show the content written by an assistant or by hand, each week, and the most read contents linked to their page", () => {
    rendre(donnees(USAGE))
    const contenu = within(ilot("Contenu"))
    expect(texte(contenu.getByText("Écrits par un assistant").previousElementSibling?.textContent)).toBe("75 %")
    expect(texte(contenu.getByText("Écrits à la main").previousElementSibling?.textContent)).toBe("25 %")
    const [semaines, lus] = contenu.getAllByRole("table")
    expect(within(semaines).getAllByRole("row").slice(1).map(cellules)).toEqual([
      ["Semaine du 14/09/2026", "0", "0"],
      ["Semaine du 21/09/2026", "4", "6"],
    ])
    const [lu] = within(lus).getAllByRole("row").slice(1)
    expect(cellules(lu)).toEqual(["Tarifsventes/tarifs", "7", "3"])
    expect(within(lu).getByRole("link", { name: "Tarifs" })).toHaveAttribute("href", "/n/ventes/tarifs")
  })

  it("should show the public links and each connector, activated or not, by calls", () => {
    rendre(donnees(USAGE))
    const partage = within(ilot("Partage et connecteurs"))
    expect(texte(partage.getByText("Liens publics actifs").previousElementSibling?.textContent)).toBe("1")
    expect(partage.getAllByRole("row").slice(1).map(cellules)).toEqual([
      ["Mailmail", "Activé", "5", "1"],
      ["tabletable", "Sans activation", "2", "0"],
    ])
  })
})

// 1.4.13 : les tableaux par équipe et par personne, triables par colonne.
describe("EcranUsage tables by team and by person (1.4.13)", () => {
  it("should show each team with its usage rate and most served procedure linked to its page, the most active first, sortable", () => {
    rendre(donnees(USAGE))
    const equipes = within(ilot("Par équipe"))
    const lignes = () => equipes.getAllByRole("row").slice(1)
    expect(lignes().map(cellules)).toEqual([
      ["Ventes", "4", "3", "75 %", "4", "9", "2", "3", "Qualifier les prospects", "23 septembre 2026"],
      ["Compta", "2", "0", "0 %", "0", "0", "0", "0", "—", "—"],
    ])
    expect(within(lignes()[0]).getByRole("link", { name: "Qualifier les prospects" })).toHaveAttribute("href", "/n/ventes/qualifier_prospects")
    fireEvent.click(equipes.getByRole("button", { name: /Équipe/ }))
    expect(lignes().map((ligne) => cellules(ligne)[0])).toEqual(["Compta", "Ventes"])
    expect(equipes.getByRole("columnheader", { name: /Équipe/ })).toHaveAttribute("aria-sort", "ascending")
  })

  it("should show each person by name with the never signed in and inactive labels, and sort by last sign-in, the absent last", () => {
    rendre(donnees(USAGE))
    const personnes = within(ilot("Par personne"))
    const lignes = () => personnes.getAllByRole("row").slice(1)
    expect(lignes().map(cellules)).toEqual([
      ["Léa Roux", "Ventes", "22 septembre 2026", "23 septembre 2026", "3", "7", "1", "2", "Claude"],
      ["Marc PetitJamais connecté", "Compta, Ventes", "—", "—", "0", "0", "0", "0", "—"],
      ["Zoé BlancInactif depuis 30 j", "—", "1 juillet 2026", "—", "1", "2", "0", "0", "—"],
    ])
    fireEvent.click(personnes.getByRole("button", { name: /Dernière connexion/ }))
    expect(lignes().map((ligne) => cellules(ligne)[0])).toEqual(["Zoé BlancInactif depuis 30 j", "Léa Roux", "Marc PetitJamais connecté"])
    fireEvent.click(personnes.getByRole("button", { name: /Dernière connexion/ }))
    expect(lignes().map((ligne) => cellules(ligne)[0])).toEqual(["Léa Roux", "Zoé BlancInactif depuis 30 j", "Marc PetitJamais connecté"])
  })
})
