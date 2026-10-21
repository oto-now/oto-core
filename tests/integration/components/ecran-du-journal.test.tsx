import type { AnchorHTMLAttributes, ReactNode } from "react"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { journalFiltersSchema, type ConversationDetail, type ConversationSummary, type JournalPage, type MemberView, type TeamView } from "@otomata_tech/oto_platform/schemas"
import { ContexteDeLHote, CoquilleOto, EcranDuJournal, EcranDuJournalChargement, type EcranDuJournalProps, type ParametresDuJournal } from "@otomata_tech/oto_platform/ui"
import { simulerLesDialogues } from "../../helpers/dialogue"
import { libellesDesChoix } from "../../helpers/liste-de-choix"

// L'écran « Journal », porté d'oto-frontend (E05-S09 partie d1 : AC-d1, AC-x2 ; E05-S05 : AC2, AC3, AC4, AC6,
// AC7, AC14) sur des données en mémoire, rendues comme la page de l'hôte les passe, sous la racine `.oto` et
// avec ce que l'hôte prête (`ContexteDeLHote`) ; les heures sont lues à Paris (UTC+2 en septembre).

const VENTES = "0e8e5a3c-7f10-4a5b-8d3b-2b1c4d5e6f70"
const CLAIRE = "0b6f1f0e-1c1a-4a8e-9a51-0d7c1a2b3c02"
const ECHEC = "Une erreur est survenue. Réessayez."

const SERVIE: ConversationSummary = {
  ctx: "K7M2-9QXR",
  startedAt: "2026-09-23T12:02:07.000Z",
  lastAt: "2026-09-23T12:09:12.000Z",
  userId: CLAIRE,
  userName: "Claire Morel",
  host: "claude-ai@0.1.0",
  context: true,
  procedurePath: "ventes/qualifier_prospects",
  request: null,
  calls: 9,
  errors: 2,
}
// La demande arrive coupée par le service (`journal-read.test.ts`, AC3) : l'écran la montre telle quelle.
const DEMANDE: ConversationSummary = { ...SERVIE, ctx: "P4QR-2XYZ", procedurePath: null, request: "Combien de prospects à Valbrune ?", errors: 0 }
const SANS_CONTEXTE: ConversationSummary = { ...SERVIE, ctx: "ZZZZ-0001", userId: null, userName: null, host: null, context: false, procedurePath: null, errors: 0 }

const PAGE: JournalPage = { conversations: [SERVIE, DEMANDE, SANS_CONTEXTE], total: 3, calls: 27, withErrors: 1, truncated: false, restarted: false, nextCursor: null }
const VIDE: JournalPage = { ...PAGE, conversations: [], total: 0, calls: 0, withErrors: 0 }

const DETAIL: ConversationDetail = {
  summary: { ...SERVIE, calls: 2, errors: 1 },
  calls: [
    { id: 11, rank: 1, ts: "2026-09-23T12:02:07.000Z", tool: "context", target: "ventes/qualifier_prospects", teamName: null, accountLabel: null, durationMs: 412, isError: false, error: null, args: { phrase: "qualifie" } },
    {
      id: 12,
      rank: 2,
      ts: "2026-09-23T12:03:40.000Z",
      tool: "call",
      target: "table.write",
      teamName: "Ventes",
      accountLabel: null,
      durationMs: 1240,
      isError: true,
      error: "invalid_arguments: Unknown column « statut ».",
      args: { function: "table.write", arguments: { api_token: "[masked]" } },
    },
  ],
  nextCursor: "apres-12",
}

const EQUIPES: TeamView[] = [{ id: VENTES, slug: "ventes", name: "Ventes", leadName: "Claire Morel", members: [] }]
const PERSONNES: MemberView[] = [
  { userId: CLAIRE, email: "claire@demo.test", name: "Claire Morel", role: "member", teams: [], lastSignInAt: null, isSelf: true },
]

const naviguer = vi.fn()

function LienDeTest({ href, children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children?: ReactNode }) {
  return (
    <a href={href} {...props}>
      {children}
    </a>
  )
}

function hrefDuJournal(parametres: ParametresDuJournal): string {
  const recherche = new URLSearchParams()
  for (const [cle, valeur] of Object.entries(parametres)) if (valeur) recherche.set(cle, valeur)
  return recherche.size > 0 ? `/journal?${recherche}` : "/journal"
}

function rendre(adresse: Record<string, string> = {}, props: Partial<EcranDuJournalProps> = {}) {
  return render(
    <CoquilleOto pleinePage>
      <ContexteDeLHote.Provider value={{ Lien: LienDeTest, chemin: "/journal", naviguer }}>
        <EcranDuJournal
          resultat={{ data: PAGE }}
          filtres={journalFiltersSchema.parse(adresse)}
          equipes={{ data: EQUIPES }}
          personnes={{ data: PERSONNES }}
          Lien={LienDeTest}
          hrefDuJournal={hrefDuJournal}
          hrefDuNoeud={(chemin) => `/n/${chemin}`}
          {...props}
        />
      </ContexteDeLHote.Provider>
    </CoquilleOto>,
  )
}

const lien = (nom: string | RegExp) => screen.getByRole("link", { name: nom })

/** Le texte d'une cellule, sans ce qui est caché aux lecteurs d'écran. */
function texte(element: HTMLElement): string {
  const copie = element.cloneNode(true)
  if (!(copie instanceof HTMLElement)) return ""
  for (const cache of copie.querySelectorAll("[aria-hidden='true']")) cache.remove()
  return copie.textContent ?? ""
}

beforeAll(simulerLesDialogues)

beforeEach(() => naviguer.mockReset())

afterEach(cleanup)

describe("EcranDuJournal header (AC4, AC-d1)", () => {
  it("should title the screen, count the conversations and calls of the period, and choose the period in the header", () => {
    rendre({ period: "30", person: CLAIRE, cursor: "suite", conversation: "K7M2-9QXR" }, { conversation: { data: DETAIL } })

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Journal")
    expect(screen.getByText("3 conversations · 27 appels")).toBeInTheDocument()
    const periodes = within(screen.getByRole("radiogroup", { name: "La période observée" })).getAllByRole("radio")
    expect(periodes.map((periode) => [periode.textContent, periode.getAttribute("aria-checked")])).toEqual([
      ["7 jours", "false"],
      ["30 jours", "true"],
      ["90 jours", "false"],
    ])
    // Une autre période garde les filtres, oublie la suite de la liste et la conversation ouverte.
    fireEvent.click(periodes[2])
    expect(naviguer).toHaveBeenCalledWith(`/journal?period=90&person=${CLAIRE}`)
  })
})

describe("EcranDuJournal states (AC2)", () => {
  it("should render the loading state as a busy status", () => {
    render(<EcranDuJournalChargement />)
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true")
    expect(screen.getByRole("status")).toHaveTextContent("Chargement du journal…")
  })

  // Chaque lecture en échec se dit à sa place, jamais en liste vide (`portage-ecrans.md § 4`).
  it("should say each failed read (result, conversation, teams, people), with « Réessayer » to the same address", () => {
    const lectures = ["resultat", "conversation", "equipes", "personnes"] as const
    const verdicts = Object.fromEntries(
      lectures.map((prop) => {
        rendre({ period: "30", errors: "1", conversation: "K7M2-9QXR" }, { conversation: { data: DETAIL }, [prop]: { error: ECHEC } })
        const verdict = {
          alerte: screen.getByRole("alert").textContent?.includes(ECHEC),
          reessayer: lien("Réessayer").getAttribute("href"),
          ...(prop === "resultat" ? { tableau: screen.queryByRole("table") !== null } : {}),
        }
        cleanup()
        return [prop, verdict]
      }),
    )
    const dite = { alerte: true, reessayer: "/journal?period=30&errors=1&conversation=K7M2-9QXR" }
    expect(verdicts).toEqual({ resultat: { ...dite, tableau: false }, conversation: dite, equipes: dite, personnes: dite })
  })

  it("should say an empty period, offering to remove the filters only when one is set", () => {
    rendre({}, { resultat: { data: VIDE } })
    expect(screen.getByText("Aucune conversation sur cette période.")).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "Retirer les filtres" })).toBeNull()
    cleanup()

    rendre({ team: VENTES }, { resultat: { data: VIDE } })
    const retraits = screen.getAllByRole("link", { name: "Retirer les filtres" })
    expect(retraits).toHaveLength(2)
    for (const retrait of retraits) expect(retrait).toHaveAttribute("href", "/journal")
  })
})

describe("EcranDuJournal list (AC3, AC14)", () => {
  it("should show one row per conversation with its start, person, host, served procedure or request, calls, errors and an « Ouvrir » link keeping the filters", () => {
    rendre({ period: "30", person: CLAIRE })
    const tableau = screen.getByRole("table", { name: "Conversations, la plus récente d'abord" })
    expect(within(tableau).getAllByRole("columnheader").map((entete) => [entete.textContent, entete.getAttribute("scope")])).toEqual(
      ["Début", "Personne", "Hôte", "Procédure servie", "Appels", "Erreurs", "Détail"].map((nom) => [nom, "col"]),
    )
    const [servie, demande, sansContexte] = within(tableau).getAllByRole("row").slice(1)
    expect(within(servie).getAllByRole("cell").map(texte)).toEqual([
      "23 septembre 2026 à 14:02",
      "Claire Morel",
      "claude-ai@0.1.0",
      "ventes/qualifier_prospects",
      "9",
      "2 erreurs",
      "Ouvrir la conversation K7M2-9QXR",
    ])
    expect(within(servie).getByRole("link", { name: "ventes/qualifier_prospects" })).toHaveAttribute("href", "/n/ventes/qualifier_prospects")
    // Le mot et une icône, jamais la couleur seule.
    expect(within(servie).getAllByRole("cell")[5].querySelector('.oto-icon[aria-hidden="true"]')).not.toBeNull()
    expect(within(demande).getAllByRole("cell")[3]).toHaveTextContent("Aucune « Combien de prospects à Valbrune ? »")
    expect(within(sansContexte).getAllByRole("cell").map(texte).slice(1, 6)).toEqual(["Personne retirée", "—", "—", "9", "Aucune"])
    // « Ouvrir » garde les filtres et ouvre le tiroir de la conversation.
    expect(lien("Ouvrir la conversation K7M2-9QXR")).toHaveAttribute("href", `/journal?period=30&person=${CLAIRE}&conversation=K7M2-9QXR`)
  })
})

describe("EcranDuJournal filters (AC4)", () => {
  it("should offer a labelled GET form over the teams and members, keep the period, and say an address value it did not understand", () => {
    rendre({ period: "12", team: VENTES, errors: "1" })
    const formulaire = screen.getByRole<HTMLFormElement>("form", { name: "Filtrer le journal" })
    expect(formulaire).toHaveAttribute("method", "get")
    expect(formulaire).toHaveAttribute("action", "/journal")
    // Les noms que le formulaire envoie sont les paramètres de l'adresse que la page lit ; la période 12,
    // illisible, repart à 7 jours, et l'écran le dit.
    expect([...new FormData(formulaire).entries()]).toEqual([
      ["period", "7"],
      ["team", VENTES],
      ["person", ""],
      ["errors", "1"],
    ])
    expect(screen.getByRole("radio", { name: "7 jours" })).toHaveAttribute("aria-checked", "true")
    expect(screen.getByText("Un filtre de l'adresse n'a pas été compris : il est ignoré.")).toBeInTheDocument()
    expect(libellesDesChoix(within(formulaire).getByRole("combobox", { name: "Personne" }))).toEqual([
      "Toutes les personnes",
      "Claire Morel",
    ])
    expect(within(formulaire).getByRole("checkbox", { name: "Erreurs seulement" })).toBeChecked()
    expect(within(formulaire).getByRole("link", { name: "Retirer les filtres" })).toHaveAttribute("href", "/journal")
  })
})

describe("EcranDuJournal bounds and cursor (AC6)", () => {
  it("should offer older conversations, say the 2,000-call bound, and say a stale cursor", () => {
    rendre({ cursor: "perime", conversation: "K7M2-9QXR" }, { resultat: { data: { ...PAGE, truncated: true, restarted: true, nextCursor: "suite-2" } }, conversation: { data: DETAIL } })
    expect(lien("Conversations plus anciennes")).toHaveAttribute("href", "/journal?period=7&cursor=suite-2&conversation=K7M2-9QXR")
    expect(screen.getByRole("status")).toHaveTextContent(
      "Cette liste s'arrête avant la finLa période compte plus de 2 000 appels : seuls les plus récents sont regroupés ici. Réduisez la période ou filtrez.",
    )
    expect(screen.getByText("La suite demandée n'est plus valable : la liste repart du début.")).toBeInTheDocument()
    // Le curseur périmé n'est pas recopié dans l'adresse qui ferme la conversation.
    fireEvent.click(screen.getByRole("button", { name: "Fermer le détail" }))
    expect(naviguer).toHaveBeenCalledWith("/journal?period=7")
  })
})

describe("EcranDuJournal conversation (AC7)", () => {
  it("should show the conversation in a drawer, then its calls in order with time, tool, target, team, account, duration, outcome, error and masked arguments", () => {
    rendre({ conversation: "K7M2-9QXR" }, { conversation: { data: DETAIL } })
    const tiroir = within(screen.getByRole("dialog", { name: "Conversation K7M2-9QXR" }))
    expect(tiroir.getByText("Hôte").nextElementSibling).toHaveTextContent("claude-ai@0.1.0")
    expect(tiroir.getByText("Fin").nextElementSibling).toHaveTextContent("23 septembre 2026 à 14:09")
    const liste = tiroir.getByRole("list")
    expect(liste.tagName).toBe("OL")
    const [premier, second] = within(liste).getAllByRole("listitem")
    for (const morceau of ["context ventes/qualifier_prospects", "Réussi", "14:02:07", "Durée : 412 ms", "Équipe : — · Compte : —"]) expect(premier).toHaveTextContent(morceau)
    for (const morceau of ["call table.write", "Échec", "14:03:40", "Durée : 1,2 s", "Équipe : Ventes · Compte : —", "Erreur : invalid_arguments: Unknown column « statut »."]) {
      expect(second).toHaveTextContent(morceau)
    }
    expect(within(second).getByText("Arguments").tagName).toBe("SUMMARY")
    expect(second.querySelector("details pre")?.textContent).toBe(JSON.stringify(DETAIL.calls[1].args, null, 2))
    expect(tiroir.getByRole("link", { name: "Appels suivants" })).toHaveAttribute("href", "/journal?period=7&conversation=K7M2-9QXR&calls=apres-12")
  })

  it.each([
    ["unknown or out of scope", { conversation: "ZZZZ-9999" }, { data: null }],
    ["malformed", { conversation: "pas-un-code" }, undefined],
  ])("should give the same sentence for a %s code", (_cas, adresse, conversation) => {
    rendre(adresse, { conversation })
    expect(screen.getByRole("dialog", { name: "Conversation" })).toHaveTextContent("Cette conversation n'existe pas ou ne vous est pas visible.")
    expect(screen.queryByText("Un filtre de l'adresse n'a pas été compris : il est ignoré.")).toBeNull()
  })
})
