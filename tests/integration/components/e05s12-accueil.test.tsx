// L'accueil en activités (E05-S12, lot B) : une activité par ligne, sa phrase écrite par l'écran depuis le verbe
// classé par le service, le nombre de gestes regroupés, l'heure (AC-13) ; ce qu'ouvre une ligne (AC-15) ; à
// droite la recherche, « Brancher un assistant » et « Procédures les plus utilisées » (AC-18). L'hôte est simulé par ce
// qu'il prête ; l'écran reçoit les données déjà lues, comme de sa page. Les journées, le premier jour et les
// lectures en échec restent éprouvés par `ecran-accueil.test.tsx`. 1.4.13 : le fil est l'onglet « Fil » de la carte
// « Reprendre », le contenu cité d'une ligne qui l'ouvre se montre comme un lien ; à droite, « Brancher votre
// assistant », « Lancer » et « Nouveautés depuis votre dernière visite ».
import type { AnchorHTMLAttributes } from "react"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Activity, UsefulProcedure } from "@otomata_tech/oto_platform/schemas"
import { ContexteDeLHote, ContexteDeRafraichissement, CoquilleOto, EcranDAccueil, type DonneesDeLAccueil } from "@otomata_tech/oto_platform/ui"

// Le 26 septembre 2026 à midi, heure de Paris (UTC+2).
const MAINTENANT = new Date("2026-09-26T10:00:00Z")
const MOI = "0b6f1f0e-1c1a-4a8e-9a51-0d7c1a2b3c02"
const ADA = "0b6f1f0e-1c1a-4a8e-9a51-0d7c1a2b3c03"

const activite = (id: number, surcharge: Partial<Activity>): Activity => ({
  id,
  at: "2026-09-26T09:00:00Z",
  userId: ADA,
  userName: "Ada Martin",
  verb: "edited",
  kind: "page",
  path: `ventes/page_${id}`,
  title: `Page ${id}`,
  count: 1,
  ctx: null,
  ...surcharge,
})

const DONNEES: DonneesDeLAccueil = {
  nom: "Claire Morel",
  moi: MOI,
  activites: { data: { activities: [], truncated: false } },
  reprendre: { data: { items: [], hasMore: false } },
  nouveautes: { data: { since: "2026-09-20T00:00:00.000Z", items: [] } },
  adresse: { url: "https://demo.example.test/api/mcp", nom: "Démo", nomCli: "demo", phrase: "Commence par le contexte de « Démo »." },
  connexions: { data: [{ famille: "claude.ai", signature: "claude-ai@1.0", date: "2026-09-24T09:00:00Z" }] },
  procedures: { data: [] },
}

function LienDeLHote({ href, children, ...reste }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return (
    <a href={href} data-lien="hote" {...reste}>
      {children}
    </a>
  )
}

function monter(donnees: Partial<DonneesDeLAccueil>) {
  render(
    <CoquilleOto pleinePage>
      <ContexteDeRafraichissement.Provider value={vi.fn()}>
        <ContexteDeLHote.Provider value={{ Lien: LienDeLHote, chemin: "/", naviguer: vi.fn() }}>
          <EcranDAccueil
            donnees={{ data: { ...DONNEES, ...donnees } }}
            Lien={LienDeLHote}
            hrefDuJournal="/journal"
            hrefDeConversation={(code) => `/journal?conversation=${code}`}
            prefixeDesPages="/n/"
          />
        </ContexteDeLHote.Provider>
      </ContexteDeRafraichissement.Provider>
    </CoquilleOto>,
  )
  // Le fil est l'onglet « Fil » de « Reprendre », fermé par défaut.
  fireEvent.click(within(screen.getByRole("region", { name: "Reprendre" })).getByRole("tab", { name: "Fil" }))
}

const fil = () => within(screen.getByRole("region", { name: "Reprendre" }))
/** Les lignes du fil, liens ou non, dans l'ordre du document. */
const lignes = () => [...screen.getByRole("region", { name: "Reprendre" }).querySelectorAll(".oto-feed-item")]

beforeEach(() => {
  vi.useFakeTimers({ now: MAINTENANT, toFake: ["Date"] })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe("home activities, one line each (E05-S12, AC-13, AC-15)", () => {
  it("should write who, what happened with the nature and the title, the grouped count and the hour, each line opening the content through the host's link", () => {
    monter({
      activites: {
        data: {
          truncated: false,
          activities: [
            activite(5, { at: "2026-09-26T10:02:00Z", userId: MOI, userName: "Claire Morel", verb: "published", path: "ventes/tarifs_2026", title: "Tarifs 2026" }),
            activite(4, { at: "2026-09-26T09:15:00Z", verb: "wrote_rows", kind: "table", path: "ventes/salons", title: "Salons", count: 3 }),
            activite(3, { at: "2026-09-26T09:00:00Z", userId: MOI, userName: "Claire Morel", verb: "created", kind: "table", path: "ventes/prospects", title: "Prospects" }),
          ],
        },
      },
    })

    const liens = fil().getAllByRole("link").filter((lien) => lien.textContent !== "Tout le journal")
    // L'avatar se tait : chaque ligne se nomme par sa phrase entière, puis le nombre et l'heure.
    expect(liens.map((lien) => [lien.getAttribute("href"), lien.dataset.lien])).toEqual([
      ["/n/ventes/tarifs_2026", "hote"],
      ["/n/ventes/salons", "hote"],
      ["/n/ventes/prospects", "hote"],
    ])
    expect(liens[0]).toHaveAccessibleName("Vous avez publié la page Tarifs 2026 12:02")
    expect(liens[1]).toHaveAccessibleName("Ada Martin a écrit dans le tableau Salons 3 fois 11:15")
    expect(liens[2]).toHaveAccessibleName("Vous avez créé le tableau Prospects 11:00")
    // « ×3 » à l'œil, « 3 fois » au lecteur d'écran (AC-14).
    expect(within(liens[1]).getByText("×3")).toHaveAttribute("aria-hidden", "true")
    // La phrase coupée par des points de suspension garde son texte entier au survol, sans changer le nom de la ligne.
    expect(within(liens[1]).getByTitle("a écrit dans le tableau Salons")).toHaveTextContent("a écrit dans le tableau Salons")
    // 1.4.13 : le contenu cité se montre comme un lien, dans une ligne qui l'ouvre.
    expect(within(liens[1]).getByText("Salons")).toHaveClass("oto-feed-cible")
  })

  it("should say how many deleted rows were waiting for review, and nothing more without them (E11-S02, AC-h3)", () => {
    monter({
      activites: {
        data: {
          truncated: false,
          activities: [
            activite(2, { userId: MOI, userName: "Claire Morel", verb: "deleted_rows", kind: "table", path: "ventes/suivi_prospects", title: "Suivi des prospects", inReview: 2 }),
            activite(1, { verb: "deleted_rows", kind: "table", path: "ventes/salons", title: "Salons" }),
          ],
        },
      },
    })
    const [avecRevue, sansRevue] = lignes()
    // Le texte, et non le nom calculé : le contenu cité est un élément à lui (1.4.13), et jsdom, qui ne voit aucun
    // élément en ligne, met une espace devant la virgule qui le suit.
    expect(avecRevue).toHaveTextContent("Vousavez supprimé des lignes dans le tableau Suivi des prospects, dont 2 à revoir11:00")
    expect(sansRevue).toHaveAccessibleName("Ada Martin a supprimé des lignes dans le tableau Salons 11:00")
  })

  it("should open the conversation of a launched procedure, and nothing for a content the person does not read, keeping its path as the journal shows it", () => {
    monter({
      activites: {
        data: {
          truncated: false,
          activities: [
            activite(3, { verb: "ran", kind: "procedure", path: "ventes/relance_devis", title: "Relancer les devis", ctx: "K7M2-9QXR" }),
            activite(2, { userId: "u-parti", userName: null, verb: "trashed", path: "ventes/ancienne_grille", title: null }),
            // L'espace personnel d'une autre personne, coupé par le service (D44) : ni nature ni titre.
            activite(1, { verb: "edited", kind: null, path: "private/lea", title: null, count: 2 }),
          ],
        },
      },
    })

    const [lancee, corbeille, privee] = lignes()
    expect(lancee).toHaveAttribute("href", "/journal?conversation=K7M2-9QXR")
    expect(lancee).toHaveAccessibleName("Ada Martin a lancé la procédure Relancer les devis 11:00")
    expect(corbeille.tagName).toBe("DIV")
    expect(corbeille.querySelector(".oto-feed-cible")).toBeNull()
    expect(corbeille).toHaveTextContent("Personne retiréea mis à la corbeille la page ventes/ancienne_grille11:00")
    expect(privee.tagName).toBe("DIV")
    expect(privee).toHaveTextContent("Ada Martina modifié private/lea×22 fois 11:00")
  })
})

describe("home right column (E05-S12, AC-18)", () => {
  const PROCEDURES: UsefulProcedure[] = [
    { path: "ventes/relance_devis", title: "Relancer les devis" },
    { path: "achats/commande", title: "Passer une commande" },
  ]

  it("should put « Reprendre » alone on the left, then Brancher votre assistant, Lancer and the news on the right, in that order, without the home search", () => {
    monter({ procedures: { data: PROCEDURES } })

    const principal = screen.getByRole("region", { name: "Reprendre" })
    const brancher = screen.getByRole("region", { name: "Brancher votre assistant" })
    const lancer = screen.getByRole("region", { name: "Lancer" })
    const nouveautes = screen.getByRole("region", { name: "Nouveautés depuis votre dernière visite" })
    const colonnes = [...document.querySelectorAll(".oto-home-col")]
    expect(colonnes).toHaveLength(2)
    expect(colonnes[0]).toContainElement(principal)
    for (const element of [brancher, lancer, nouveautes]) expect(colonnes[1]).toContainElement(element)
    // 1.4.13 : la recherche de l'accueil part, celle du rail suffit.
    expect(screen.queryByRole("search")).toBeNull()
    const ordre = [principal, brancher, lancer, nouveautes]
    for (let rang = 1; rang < ordre.length; rang += 1) expect(ordre[rang - 1].compareDocumentPosition(ordre[rang]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("should list the procedures to launch in the order served, each with its glyph and its title, opening the procedure", () => {
    monter({ procedures: { data: PROCEDURES } })

    const liens = within(screen.getByRole("region", { name: "Lancer" })).getAllByRole("link")
    expect(liens.map((lien) => [lien.textContent, lien.getAttribute("href"), lien.dataset.lien])).toEqual([
      ["Relancer les devis", "/n/ventes/relance_devis", "hote"],
      ["Passer une commande", "/n/achats/commande", "hote"],
    ])
    expect(liens[0].querySelector("svg")).not.toBeNull()
  })

  it("should say that no procedure is published when the list is empty, without any action", () => {
    monter({ procedures: { data: [] } })

    const ilot = within(screen.getByRole("region", { name: "Lancer" }))
    expect(ilot.getByText("Aucune procédure publiée")).toBeInTheDocument()
    expect(ilot.queryByRole("link")).toBeNull()
    expect(ilot.queryByRole("button")).toBeNull()
  })
})

// 1.4.13 : « Lancer » copie la demande à coller dans l'assistant ; « Nouveautés » ouvre ce que d'autres ont publié.
describe("home Lancer and news (1.4.13)", () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, "clipboard")
  })

  it("should copy the request of a procedure, say it in a status region, and say a refused copy", async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })
    monter({ procedures: { data: [{ path: "ventes/relance_devis", title: "Relancer les devis" }] } })
    const lancer = within(screen.getByRole("region", { name: "Lancer" }))

    fireEvent.click(lancer.getByRole("button", { name: "Copier la demande : Relancer les devis" }))
    await waitFor(() => expect(lancer.getByRole("status")).toHaveTextContent("Demande copiée"))
    expect(writeText).toHaveBeenCalledWith("Suis la procédure « Relancer les devis » (ventes/relance_devis).")

    writeText.mockRejectedValueOnce(new Error("denied"))
    fireEvent.click(lancer.getByRole("button", { name: "Copier la demande : Relancer les devis" }))
    await waitFor(() => expect(lancer.getByRole("status")).toHaveTextContent("Copie impossible"))
  })

  it("should list the news since the last visit, each opening its content, and say when there is none", () => {
    monter({
      nouveautes: {
        data: { since: "2026-09-24T00:00:00.000Z", items: [{ path: "ventes/tarifs_2026", title: "Tarifs 2026", kind: "page", at: "2026-09-25T08:00:00.000Z", byName: "Ada Martin" }] },
      },
    })
    const nouveautes = within(screen.getByRole("region", { name: "Nouveautés depuis votre dernière visite" }))
    expect(nouveautes.getByText("Depuis le 24 septembre 2026")).toBeInTheDocument()
    const [lien] = nouveautes.getAllByRole("link")
    expect([lien.getAttribute("href"), lien.dataset.lien]).toEqual(["/n/ventes/tarifs_2026", "hote"])
    expect(lien).toHaveTextContent("Tarifs 2026publié par Ada Martin25/09/2026")
    cleanup()

    monter({})
    expect(within(screen.getByRole("region", { name: "Nouveautés depuis votre dernière visite" })).getByText("Rien de nouveau depuis votre dernière visite")).toBeInTheDocument()
  })
})
