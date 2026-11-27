// La file de revue d'un tableau (E07-S03, AC10 à AC14), portée sur l'îlot d'attente d'oto-frontend (E05-S09
// partie c2, AC-c2) : `TableauDuNoeud` avec sa file, sous le fournisseur de relecture de l'hôte (espionné) ;
// `fetch` simulé pour `POST /api/platform/tables/review`, presse-papiers simulé ; une relecture se joue en
// rerendant l'écran avec la file relue. Seule la date est figée.
import type { ReactNode } from "react"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { TableHeader, TableReviewQueue, TableRowRead } from "@otomata_tech/oto_platform/schemas"
import { adresseDesReglages, ContexteDeRafraichissement, reglagesDepuisLAdresse, TableauDuNoeud, type Reglages } from "@otomata_tech/oto_platform/ui"
import { choisirDansLaListe } from "../../helpers/liste-de-choix"

const STATES = ["à traiter", "en cours", "à revoir", "qualifié", "écarté"]
const CHEMIN = "ventes/suivi_prospects"
const ENTETE: TableHeader = {
  columns: [
    { name: "ref", type: "text" },
    { name: "entreprise", type: "text" },
    { name: "montant_estime", type: "number" },
    { name: "statut", type: "enum", options: STATES },
  ],
  key: "ref",
  lifecycle: { column: "statut", states: STATES, working: "en cours", review: { state: "à revoir", approve: "qualifié", reject: "écarté" } },
  closed: false,
  proof: false,
}

const aRevoir = (key: string, entreprise: string, revision = 4): TableRowRead => ({ key, revision, set: { ref: key, entreprise, montant_estime: 95000, statut: "à revoir" } })
const P003 = aRevoir("P-003", "Mairie de Valbrune")
const P006 = aRevoir("P-006", "Clinique vétérinaire des Saules", 2)
const P009 = aRevoir("P-009", "Maison de santé du Plateau", 7)

const rafraichir = vi.fn()

function LienDeTest({ children, ...props }: { href: string; className?: string; children: ReactNode }) {
  return <a {...props}>{children}</a>
}

const hrefDuTableau = (reglages: Reglages) => `/n/${CHEMIN}?${adresseDesReglages(reglages)}`

function ecran({ revue, niveau = 2, entete = ENTETE }: { revue?: { data: TableReviewQueue } | { error: string }; niveau?: 1 | 2 | 3; entete?: TableHeader }) {
  return (
    <ContexteDeRafraichissement.Provider value={rafraichir}>
      <TableauDuNoeud
        chemin={CHEMIN}
        titre="Suivi des prospects"
        entete={entete}
        lignes={{ data: { rows: [], total: 0, count: 0 } }}
        resume={{ data: { states: null, sums: [] } }}
        revue={revue}
        reglages={reglagesDepuisLAdresse({}, entete)}
        niveau={niveau}
        Lien={LienDeTest}
        hrefDuTableau={hrefDuTableau}
        adresse={`/n/${CHEMIN}`}
      />
    </ContexteDeRafraichissement.Provider>
  )
}

const file = (first: TableRowRead | null, count: number) => ({ data: { count, rows: first ? [first] : [] } })

type Suite = Response | "reseau" | Promise<Response>
let suites: Suite[] = []
let envoyes: Record<string, unknown>[] = []

function reponse(statut: number, corps: unknown): Response {
  return new Response(JSON.stringify(corps), { status: statut, headers: { "content-type": "application/json" } })
}

const decidee = (key: string, state: string, revision: number) => reponse(200, { data: { outcome: "decided", key, state, revision } })
const refus = (statut: number, code: string) => reponse(statut, { error: { code, message: "refused" } })

beforeEach(() => {
  suites = []
  envoyes = []
  rafraichir.mockReset()
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_adresse: string, init?: RequestInit) => {
      envoyes.push(JSON.parse(String(init?.body)))
      const suite = suites.shift()
      if (suite === "reseau") throw new TypeError("fetch failed")
      return suite ?? decidee("P-003", "qualifié", 5)
    }),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  Reflect.deleteProperty(navigator, "clipboard")
})

const bouton = (nom: string) => screen.getByRole("button", { name: nom })
const statut = () => screen.getAllByRole("status").find((region) => region.textContent !== "") ?? null
const raison = () => screen.getByRole("textbox", { name: "Raison (facultative)" })

describe("FileDeRevue, the queue (AC10)", () => {
  it("should show a writer the count, the first row to review with its values, the reason and the two decisions", () => {
    render(ecran({ revue: file(P003, 3) }))
    const region = screen.getByRole("region", { name: "À revoir" })
    const section = within(region)
    expect(section.getByRole("heading", { level: 2 })).toHaveTextContent("À revoir")
    expect(region.querySelector(".oto-badge")).toHaveTextContent("3")
    expect(section.getByText("3 lignes à revoir")).toBeInTheDocument()
    const demande = region.querySelector(".oto-wait-item-demand")
    expect(demande).toHaveTextContent("P-003")
    // Les valeurs, la clé non répétée, au format de la grille : le nom de la colonne, puis sa valeur.
    expect(demande?.nextElementSibling).toHaveTextContent("Entreprise Mairie de Valbrune · Montant estime 95 000 · Statut à revoir")
    expect(raison()).toHaveAttribute("maxlength", "500")
    expect(section.getAllByRole("button").map((un) => un.textContent)).toEqual(["Refuser → écarté", "Approuver → qualifié"])
  })

  it("should give a reader the count only, say an empty queue, and show no section without review", () => {
    render(ecran({ revue: file(P003, 3), niveau: 1 }))
    expect(screen.getByText("3 lignes à revoir")).toBeInTheDocument()
    expect(screen.queryByText("P-003")).toBeNull()
    expect(screen.queryByRole("button", { name: /Approuver/ })).toBeNull()
    cleanup()
    render(ecran({ revue: file(null, 0) }))
    expect(screen.getByText("Rien à revoir.")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Approuver/ })).toBeNull()
    cleanup()
    const { lifecycle, ...sansCycle } = ENTETE
    render(ecran({ entete: { ...sansCycle, lifecycle: lifecycle ? { column: lifecycle.column, states: lifecycle.states, working: lifecycle.working } : undefined }, revue: file(null, 0) }))
    expect(screen.queryByRole("heading", { name: "À revoir" })).toBeNull()
  })

  it("should say the cycle of a row under its title, composed of the declared states, to a writer and a reader alike (E11-S05, AC-a5)", () => {
    const etats = ["nouveau", "pris", "à valider", "retenu", "rejeté"]
    const entete: TableHeader = {
      ...ENTETE,
      columns: ENTETE.columns.map((colonne) => (colonne.name === "statut" ? { ...colonne, options: etats } : colonne)),
      lifecycle: { column: "statut", states: etats, working: "pris", review: { state: "à valider", approve: "retenu", reject: "rejeté" } },
    }
    const cycle =
      "Une ligne entre à « nouveau », passe à « pris » quand un assistant la prend, puis à « à valider ». Vous l'approuvez (« retenu ») ou la refusez (« rejeté »). Les lignes à revoir sont surlignées dans le tableau."
    for (const niveau of [2, 1] as const) {
      render(ecran({ revue: file(null, 0), niveau, entete }))
      const region = screen.getByRole("region", { name: "À revoir" })
      expect(region.querySelector(".oto-wait-body")?.firstElementChild).toHaveTextContent(cycle)
      cleanup()
    }
  })

  it("should say a failed read of the queue, with « Réessayer » to the same address, and no count nor decision", () => {
    render(ecran({ revue: { error: "Une erreur est survenue. Réessayez." } }))
    const section = within(screen.getByRole("region", { name: "À revoir" }))
    expect(section.getByRole("alert")).toHaveTextContent("Une erreur est survenue. Réessayez.")
    expect(section.getByRole("link", { name: "Réessayer" })).toHaveAttribute("href", hrefDuTableau(reglagesDepuisLAdresse({}, ENTETE)))
    expect(section.queryByText(/à revoir$|^Rien à revoir/)).toBeNull()
    expect(section.queryByRole("button")).toBeNull()
  })
})

describe("FileDeRevue, the proof of each value on the card (fiche D99, M54, P3)", () => {
  // La preuve exigée par le tableau (fiche D133, E11-S01 AC-f7) : « sans preuve » ne se dit que là.
  const entete: TableHeader = {
    ...ENTETE,
    proof: true,
    columns: [ENTETE.columns[0], ENTETE.columns[1], { name: "contact", type: "text" }, { name: "email", type: "email" }, { name: "site", type: "url" }, ...ENTETE.columns.slice(2)],
  }
  const agent = { origin: "agent" as const, by: "Léa Roux", at: "2026-09-27T10:00:00.000Z" }
  const ligne: TableRowRead = {
    key: "P-004",
    revision: 3,
    set: { ref: "P-004", entreprise: "Garage Moreau", contact: "Luc Moreau", site: "https://garage-moreau.test", statut: "à revoir" },
    verified_empty: [{ column: "email", reason: "Aucune adresse publiée" }],
    provenance: {
      entreprise: { origin: "import", by: "Ada Martin" },
      contact: agent,
      email: { origin: "verified_empty", by: "Léa Roux" },
      site: { ...agent, comment: "Registre public", link: "https://registre.test/garage-moreau" },
      statut: agent,
    },
  }

  it("should show the comment and the link of a value, the reason of verified_empty, « sans preuve » for an assistant's value without one, nothing for an imported value", () => {
    render(ecran({ entete, revue: file(ligne, 1) }))
    const valeurs = document.querySelector(".oto-wait-item-demand")?.nextElementSibling
    expect(valeurs).toHaveTextContent(
      "Entreprise Garage Moreau · Contact Luc Moreau (sans preuve) · Email vérifié vide (« Aucune adresse publiée ») · Site https://garage-moreau.test (« Registre public », https://registre.test/garage-moreau) · Montant estime — · Statut à revoir",
    )
    expect(within(valeurs as HTMLElement).getByRole("link", { name: "https://registre.test/garage-moreau" })).toHaveAttribute("rel", "noopener noreferrer")
  })

  it("should not say « sans preuve » on a table that does not require proof, and keep the comment, the link and the reason (E11-S01, AC-f7)", () => {
    render(ecran({ entete: { ...entete, proof: false }, revue: file(ligne, 1) }))
    const valeurs = document.querySelector(".oto-wait-item-demand")?.nextElementSibling
    expect(valeurs).toHaveTextContent(
      "Entreprise Garage Moreau · Contact Luc Moreau · Email vérifié vide (« Aucune adresse publiée ») · Site https://garage-moreau.test (« Registre public », https://registre.test/garage-moreau) · Montant estime — · Statut à revoir",
    )
  })
})

describe("DecisionDeRevue, choosing or passing a card (fiche D99, M54, P2)", () => {
  it("should pass to the next card, choose one in the list, decide the one shown, and keep the next one chosen after the reread", async () => {
    const vue = render(ecran({ revue: { data: { count: 3, rows: [P003, P006, P009] } } }))
    const demande = () => document.querySelector(".oto-wait-item-demand")
    const fiche = () => screen.getByRole("combobox", { name: "Fiche à revoir" })
    expect([demande()?.textContent, fiche()]).toEqual(["P-003", expect.objectContaining({ value: "P-003" })])
    fireEvent.change(raison(), { target: { value: "Pour P-003" } })
    fireEvent.click(bouton("Passer"))
    expect([demande()?.textContent, (fiche() as HTMLButtonElement).value]).toEqual(["P-006", "P-006"])
    // La raison saisie pour une fiche ne part pas avec une autre ; la fiche montrée s'annonce.
    expect(raison()).toHaveValue("")
    expect(statut()).toHaveTextContent("Fiche P-006.")
    choisirDansLaListe(fiche(), "P-009")
    expect(demande()).toHaveTextContent("P-009")
    choisirDansLaListe(fiche(), "P-006")
    suites.push(decidee("P-006", "qualifié", 3))
    fireEvent.click(bouton("Approuver → qualifié"))
    await waitFor(() => expect(statut()).toHaveTextContent("P-006 → qualifié."))
    expect(envoyes).toEqual([{ table: CHEMIN, key: "P-006", revision: 2, decision: "approve" }])
    // Relue sans P-006 : la fiche qui la suivait reste montrée ; seule, plus de choix à faire.
    vue.rerender(ecran({ revue: { data: { count: 2, rows: [P003, P009] } } }))
    expect(demande()).toHaveTextContent("P-009")
    vue.rerender(ecran({ revue: file(P003, 1) }))
    expect([demande()?.textContent, screen.queryByRole("combobox"), screen.queryByRole("button", { name: "Passer" })]).toEqual(["P-003", null, null])
  })

  it("should say the first cards out of the count when the queue holds more, and say the return to the first card on passing the last one (HN-M54-5)", () => {
    const vue = render(ecran({ revue: { data: { count: 57, rows: [P003, P006, P009] } } }))
    expect(screen.getByText("3 premières sur 57")).toBeInTheDocument()
    choisirDansLaListe(screen.getByRole("combobox", { name: "Fiche à revoir" }), "P-009")
    fireEvent.click(bouton("Passer"))
    expect(document.querySelector(".oto-wait-item-demand")).toHaveTextContent("P-003")
    expect(statut()).toHaveTextContent("Fiche P-003 : retour à la première ; les suivantes paraissent après vos décisions.")
    // Toute la file lue : pas de compte des fiches, le retour se dit seul.
    vue.rerender(ecran({ revue: { data: { count: 3, rows: [P003, P006, P009] } } }))
    expect(screen.queryByText(/premières sur/)).toBeNull()
    choisirDansLaListe(screen.getByRole("combobox", { name: "Fiche à revoir" }), "P-009")
    fireEvent.click(bouton("Passer"))
    expect(statut()).toHaveTextContent(/^Fiche P-003 : retour à la première\.$/)
  })
})

describe("DecisionDeRevue, a decision (AC11)", () => {
  it("should send the key, revision and decision once, busy the buttons meanwhile, announce the outcome, give the focus to the queue and reread", async () => {
    let relacher = () => {}
    suites.push(new Promise<Response>((resolve) => (relacher = () => resolve(decidee("P-003", "qualifié", 5)))))
    render(ecran({ revue: file(P003, 3) }))
    fireEvent.change(raison(), { target: { value: "Élus rencontrés" } })
    fireEvent.click(bouton("Approuver → qualifié"))
    fireEvent.click(bouton("Approuver → qualifié"))
    await waitFor(() => expect(bouton("Approuver → qualifié")).toBeDisabled())
    expect([bouton("Refuser → écarté").hasAttribute("disabled"), bouton("Approuver → qualifié").getAttribute("aria-busy"), bouton("Refuser → écarté").getAttribute("aria-busy")]).toEqual([true, "true", null])
    await act(async () => relacher())
    await waitFor(() => expect(statut()).toHaveTextContent("P-003 → qualifié."))
    expect(envoyes).toEqual([{ table: CHEMIN, key: "P-003", revision: 4, decision: "approve", reason: "Élus rencontrés" }])
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("/api/platform/tables/review")
    expect(rafraichir).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("region", { name: "À revoir" })))
    expect(raison()).toHaveValue("")
  })
})

describe("DecisionDeRevue, a row changed meanwhile (AC12)", () => {
  it("should say the row was skipped with its current state, nothing written, and reread for the next one", async () => {
    suites.push(reponse(200, { data: { outcome: "skipped", key: "P-003", currentState: "en cours", currentRevision: 5 } }))
    render(ecran({ revue: file(P003, 3) }))
    fireEvent.click(bouton("Refuser → écarté"))
    await waitFor(() => expect(statut()).toHaveTextContent("P-003 a changé entre-temps (état actuel : « en cours ») : rien n'a été écrit."))
    expect(rafraichir).toHaveBeenCalledTimes(1)
  })
})

describe("DecisionDeRevue, refusals (AC13)", () => {
  it("should say each refusal, keep the reason, give the focus back to the button, and reread when the row is gone", async () => {
    render(ecran({ revue: file(P003, 3) }))
    fireEvent.change(raison(), { target: { value: "À rappeler" } })
    const cas: [Suite, string][] = [
      [refus(403, "forbidden"), "Seuls les rédacteurs de ce tableau peuvent décider."],
      [refus(400, "invalid_arguments"), "Certaines valeurs sont invalides."],
      ["reseau", "La décision n'a pas été envoyée. Réessayez : votre raison est gardée."],
      [refus(404, "not_found"), "Cette ligne n'existe plus."],
    ]
    for (const [suite, phrase] of cas) {
      suites.push(suite)
      fireEvent.click(bouton("Approuver → qualifié"))
      await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(phrase))
      await waitFor(() => expect(document.activeElement).toBe(bouton("Approuver → qualifié")))
      expect(raison()).toHaveValue("À rappeler")
    }
    await waitFor(() => expect(rafraichir).toHaveBeenCalledTimes(1))
  })
})

describe("ResumeDeRevue, the summary to copy (AC14)", () => {
  it("should sum up the decisions of the session across rereads, and copy it, or say the clipboard refused", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-09-24T10:00:00Z"))
    const writeText = vi.fn<(texte: string) => Promise<void>>(async () => undefined)
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })
    const vue = render(ecran({ revue: file(P003, 3) }))
    expect(screen.queryByRole("textbox", { name: "Résumé de la revue" })).toBeNull()

    suites.push(decidee("P-003", "qualifié", 5))
    fireEvent.click(bouton("Approuver → qualifié"))
    await waitFor(() => expect(statut()).toHaveTextContent("P-003 → qualifié."))
    vue.rerender(ecran({ revue: file(P006, 2) }))
    suites.push(decidee("P-006", "écarté", 3))
    // La raison d'un refus passe dans le résumé (fiche D99, M54, P4).
    fireEvent.change(raison(), { target: { value: "Doublon de P-003" } })
    fireEvent.click(bouton("Refuser → écarté"))
    await waitFor(() => expect(statut()).toHaveTextContent("P-006 → écarté."))
    vue.rerender(ecran({ revue: file(P009, 1) }))
    suites.push(reponse(200, { data: { outcome: "skipped", key: "P-009", currentState: "en cours", currentRevision: 8 } }))
    fireEvent.click(bouton("Approuver → qualifié"))
    await waitFor(() => expect(statut()).toHaveTextContent(/^P-009 a changé/))
    vue.rerender(ecran({ revue: file(null, 0) }))

    const resume = screen.getByRole("textbox", { name: "Résumé de la revue" })
    expect(resume).toHaveAttribute("readonly")
    const texte = "Revue de ventes/suivi_prospects le 24/09/2026 : 1 approuvée (qualifié : P-003), 1 refusée (écarté : P-006 « Doublon de P-003 »), 1 sautée (P-009)."
    expect(resume).toHaveValue(texte)
    fireEvent.click(bouton("Copier pour la conversation"))
    await waitFor(() => expect(bouton("Copié")).toBeInTheDocument())
    expect(writeText).toHaveBeenCalledWith(texte)
    writeText.mockRejectedValueOnce(new Error("denied"))
    fireEvent.click(bouton("Copié"))
    await waitFor(() => expect(screen.getByText("Copie impossible : sélectionnez le texte du résumé.")).toBeInTheDocument())
  })
})
