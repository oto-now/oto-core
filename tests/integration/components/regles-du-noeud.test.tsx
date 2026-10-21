import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { NodeRulesView } from "@otomata_tech/oto_platform/schemas"
import { ContexteDeRafraichissement, ReglesDuNoeud } from "@otomata_tech/oto_platform/ui"
import { choisirDansLaListe, libellesDesChoix } from "../../helpers/liste-de-choix"

// Le panneau des règles d'un nœud (E05-S03, AC16, AC17), réutilisé par E05-S02 : `fetch` simulé
// pour l'API, relecture fournie par un contexte de test.

const VENTES = "0e8e5a3c-7f10-4a5b-8d3b-2b1c4d5e6f70"
const SUPPORT = "5b0d1c56-0f3a-4a57-9d8e-6f1f1b9e2c11"
const LEA = "0b6f1f0e-1c1a-4a8e-9a51-0d7c1a2b3c05"
const REGLE = "9d1c7e2a-3b4c-4d5e-8f6a-7b8c9d0e1f2a"

const SUJETS = {
  equipes: [
    { id: SUPPORT, nom: "Support" },
    { id: VENTES, nom: "Ventes" },
  ],
  personnes: [{ id: LEA, nom: "Léa Roux" }],
}

const DEVIS: NodeRulesView = {
  path: "ventes/devis",
  title: "Devis",
  owner: { kind: "team", teamName: "Ventes", leadName: "Claire Morel" },
  viewerLevel: 3,
  rules: [
    { id: REGLE, subject: { kind: "team", id: SUPPORT, name: "Support" }, level: "read" },
    { id: "3c2b1a09-8f7e-4d6c-9b5a-493827160514", subject: { kind: "user", id: LEA, name: "Léa Roux" }, level: "none" },
  ],
}

const fetchMock = vi.fn<typeof fetch>()
const rafraichir = vi.fn()

function reponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

/** Le panneau tel que l'onglet le monte ; `rerender(panneau(…))` joue la relecture qui suit un geste. */
function panneau(noeud: NodeRulesView | null, gestionAccordable = true) {
  return (
    <ContexteDeRafraichissement.Provider value={rafraichir}>
      <ReglesDuNoeud noeud={noeud} sujets={SUJETS} gestionAccordable={gestionAccordable} />
    </ContexteDeRafraichissement.Provider>
  )
}

function rendre(noeud: NodeRulesView | null, gestionAccordable = true) {
  return render(panneau(noeud, gestionAccordable))
}

beforeEach(() => {
  fetchMock.mockReset()
  rafraichir.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("ReglesDuNoeud reading (AC16)", () => {
  it("should say the owner team and its lead, the default rule of a team, the level and the rules", () => {
    rendre(DEVIS)

    expect(screen.getByRole("heading", { name: "Accès à Devis" })).toBeInTheDocument()
    expect(screen.getByText("Propriétaire : équipe Ventes (responsable : Claire Morel)")).toBeInTheDocument()
    expect(screen.getByText("Sans règle : écriture pour l'équipe, gestion pour ses responsables, rien pour les autres.")).toBeInTheDocument()
    expect(screen.getByText("Votre niveau : Gestion")).toBeInTheDocument()
    const tableau = screen.getByRole("table", { name: "Règles de ventes/devis" })
    const lignes = within(tableau).getAllByRole("row").slice(1)
    expect(lignes.map((ligne) => within(ligne).getAllByRole("cell").slice(0, 2).map((cellule) => cellule.textContent))).toEqual([
      ["équipe Support", "Lecture"],
      ["personne Léa Roux", "Aucun accès"],
    ])
  })

  it("should say the organisation and its default rule, without « espace » nor « dossier » (P39)", () => {
    rendre({ ...DEVIS, path: "annonces", title: "Annonces", owner: { kind: "org" }, viewerLevel: 1, rules: [] })

    expect(screen.getByText("Propriétaire : l'organisation")).toBeInTheDocument()
    expect(screen.getByText("Sans règle : lecture pour tous les membres.")).toBeInTheDocument()
    expect(screen.getByText("Votre niveau : Lecture")).toBeInTheDocument()
    expect(screen.getByText("Aucune règle sur ce nœud : la règle par défaut s'applique.")).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/espace|dossier/i)
  })

  it("should say a personal owner and its default rule", () => {
    rendre({ ...DEVIS, path: "private/lea/notes", title: "Notes", owner: { kind: "user", userName: "Léa Roux" }, rules: [] })

    expect(screen.getByText("Propriétaire : Léa Roux (Privé)")).toBeInTheDocument()
    expect(screen.getByText("Sans règle : son propriétaire seul.")).toBeInTheDocument()
  })

  // E05-S13 (AC-23) : `leadName` joint tous les responsables ; le pluriel suit leur nombre, pas une virgule.
  it("should name no lead, or every lead of a team with several", () => {
    rendre({ ...DEVIS, owner: { kind: "team", teamName: "Support" } })
    expect(screen.getByText("Propriétaire : équipe Support (sans responsable)")).toBeInTheDocument()
    cleanup()
    rendre({ ...DEVIS, owner: { kind: "team", teamName: "Ventes", leadName: "Claire Morel, Léa Roux", leadCount: 2 } })
    expect(screen.getByText("Propriétaire : équipe Ventes (responsables : Claire Morel, Léa Roux)")).toBeInTheDocument()
    cleanup()
    rendre({ ...DEVIS, owner: { kind: "team", teamName: "Ventes", leadName: "Morel, Claire", leadCount: 1 } })
    expect(screen.getByText("Propriétaire : équipe Ventes (responsable : Morel, Claire)")).toBeInTheDocument()
  })

  it("should give one phrase to an unknown, invisible or malformed path (H68)", () => {
    rendre(null)
    expect(screen.getByRole("alert")).toHaveTextContent("Ce nœud n'existe pas ou ne vous est pas partagé.")
    expect(screen.queryByRole("table")).toBeNull()
  })
})

describe("ReglesDuNoeud managing (AC17)", () => {
  it("should offer the form and the removals at the manage level only", () => {
    rendre({ ...DEVIS, viewerLevel: 2 })

    expect(screen.getByText("Votre niveau : Écriture")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Enregistrer la règle" })).toBeNull()
    expect(screen.queryByRole("button", { name: /^Retirer/ })).toBeNull()
  })

  it("should offer the teams and the people of the organisation, and the manage level to an administrator only", () => {
    rendre(DEVIS)
    const sujet = screen.getByLabelText("Équipe ou personne")
    expect(libellesDesChoix(sujet)).toEqual(["équipe Support", "équipe Ventes", "personne Léa Roux"])
    expect(libellesDesChoix(screen.getByLabelText("Niveau"))).toEqual([
      "Aucun accès",
      "Lecture",
      "Écriture",
      "Gestion",
    ])

    cleanup()
    rendre(DEVIS, false)
    expect(libellesDesChoix(screen.getByLabelText("Niveau"))).not.toContain("Gestion")
  })

  it("should post the rule on the shared schema, say it is saved and have the host re-read the page", async () => {
    fetchMock.mockResolvedValue(reponse(201, { data: { rule: { id: REGLE, created: true } } }))
    rendre(DEVIS)
    expect(screen.getByRole("status")).toBeEmptyDOMElement()

    choisirDansLaListe(screen.getByLabelText("Équipe ou personne"), "équipe Ventes")
    choisirDansLaListe(screen.getByLabelText("Niveau"), "Écriture")
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer la règle" }))

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Règle enregistrée."))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("/api/platform/rules")
    expect(init?.method).toBe("POST")
    expect(JSON.parse(String(init?.body))).toEqual({ path: "ventes/devis", subject: { kind: "team", id: VENTES }, level: "write" })
    expect(rafraichir).toHaveBeenCalledTimes(1)
  })

  it("should give the focus to the panel title when the re-read takes the form away from a lead who posted a rule on herself", async () => {
    fetchMock.mockResolvedValue(reponse(201, { data: { rule: { id: REGLE, created: true } } }))
    // Léa dirige Ventes sans être administratrice : une règle à son nom passe avant sa gestion de
    // responsable (N7, `node_level_for`), et « Gestion » ne lui est pas proposé. La relecture lui
    // retire le niveau 3, et le formulaire avec.
    const avant: NodeRulesView = { ...DEVIS, owner: { kind: "team", teamName: "Ventes", leadName: "Léa Roux" }, rules: [DEVIS.rules[0]] }
    const vue = rendre(avant, false)
    choisirDansLaListe(screen.getByLabelText("Équipe ou personne"), "personne Léa Roux")
    choisirDansLaListe(screen.getByLabelText("Niveau"), "Écriture")
    const enregistrer = screen.getByRole("button", { name: "Enregistrer la règle" })

    enregistrer.focus()
    fireEvent.click(enregistrer)
    await waitFor(() => expect(rafraichir).toHaveBeenCalledTimes(1))
    const regleDeLea: NodeRulesView["rules"][number] = { id: "7a6b5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c2d", subject: { kind: "user", id: LEA, name: "Léa Roux" }, level: "write" }
    vue.rerender(panneau({ ...avant, viewerLevel: 2, rules: [...avant.rules, regleDeLea] }, false))

    expect(screen.queryByRole("button", { name: "Enregistrer la règle" })).toBeNull()
    await waitFor(() => expect(screen.getByRole("heading", { name: "Accès à Devis" })).toHaveFocus())
  })

  it("should give the focus to the alert that replaces the panel when the rule posted takes the node away from its author", async () => {
    fetchMock.mockResolvedValue(reponse(201, { data: { rule: { id: REGLE, created: true } } }))
    // « Aucun accès » à son nom retire aussi la lecture à Léa : la relecture rend le nœud introuvable
    // (H68), et l'alerte remplace le panneau entier, titre compris (M13a).
    const avant: NodeRulesView = { ...DEVIS, owner: { kind: "team", teamName: "Ventes", leadName: "Léa Roux" }, rules: [DEVIS.rules[0]] }
    const vue = rendre(avant, false)
    choisirDansLaListe(screen.getByLabelText("Équipe ou personne"), "personne Léa Roux")
    choisirDansLaListe(screen.getByLabelText("Niveau"), "Aucun accès")
    const enregistrer = screen.getByRole("button", { name: "Enregistrer la règle" })

    enregistrer.focus()
    fireEvent.click(enregistrer)
    await waitFor(() => expect(rafraichir).toHaveBeenCalledTimes(1))
    vue.rerender(panneau(null, false))

    await waitFor(() => expect(screen.getByRole("alert")).toHaveFocus())
  })

  it("should not move the focus when strict mode mounts the panel twice, before any success", async () => {
    // Next monte en mode strict en développement : le démontage simulé ne suit aucun succès, et le titre
    // n'a pas le focus. L'attente laisse passer un repli remis après le rendu (`queueMicrotask`, M13a).
    render(panneau(DEVIS), { reactStrictMode: true })
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(document.body).toHaveFocus()
  })

  it("should show a refusal of the API as an alert, without re-reading", async () => {
    fetchMock.mockResolvedValue(reponse(400, { error: { code: "invalid_arguments", message: "No team x in Acme." } }))
    rendre(DEVIS)

    fireEvent.click(screen.getByRole("button", { name: "Enregistrer la règle" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("Certaines valeurs sont invalides.")
    expect(rafraichir).not.toHaveBeenCalled()
  })

  it("should remove a rule after the inline confirmation that names its subject and its path, the focus then on the panel title", async () => {
    fetchMock.mockResolvedValue(reponse(200, { data: { rule: { id: REGLE, path: "ventes/devis" } } }))
    rendre(DEVIS)

    fireEvent.click(screen.getByRole("button", { name: "Retirer (équipe Support)" }))
    expect(screen.getByText("Retirer la règle de l'équipe Support sur ventes/devis ?")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Retirer la règle" }))

    await waitFor(() => expect(rafraichir).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`/api/platform/rules/${REGLE}`)
    expect(init?.method).toBe("DELETE")
    // La ligne part avec la relecture : le focus va au titre du panneau, qui reste (accessibility-patterns § Focus Management).
    await waitFor(() => expect(screen.getByRole("heading", { name: "Accès à Devis" })).toHaveFocus())
  })

  it("should give the focus to the alert that replaces the panel when the rule removed takes the node away from its author", async () => {
    fetchMock.mockResolvedValue(reponse(200, { data: { rule: { id: DEVIS.rules[1].id, path: "ventes/devis" } } }))
    // Un administrateur a donné « Gestion » à Léa, hors de l'équipe propriétaire. Elle retire elle-même
    // cette règle : la règle par défaut ne lui laisse rien, la relecture rend le nœud introuvable (H68),
    // et l'alerte remplace le panneau, titre compris (revue de M13a).
    const vue = rendre({ ...DEVIS, rules: [{ ...DEVIS.rules[1], level: "manage" }] })

    fireEvent.click(screen.getByRole("button", { name: "Retirer (personne Léa Roux)" }))
    fireEvent.click(screen.getByRole("button", { name: "Retirer la règle" }))
    await waitFor(() => expect(rafraichir).toHaveBeenCalledTimes(1))
    vue.rerender(panneau(null))

    await waitFor(() => expect(screen.getByRole("alert")).toHaveFocus())
  })

  it("should name a person by her name alone in the question", () => {
    rendre(DEVIS)
    fireEvent.click(screen.getByRole("button", { name: "Retirer (personne Léa Roux)" }))
    expect(screen.getByText("Retirer la règle de Léa Roux sur ventes/devis ?")).toBeInTheDocument()
  })
})
