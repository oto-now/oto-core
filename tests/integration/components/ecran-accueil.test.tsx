// L'accueil porté d'oto-frontend (E05-S09, partie b, AC-b1) : le salut, la recherche qui ouvre la palette du
// rail, « Brancher mon Claude, ChatGPT ou Mistral » en aparté (état, fenêtre du guide, E11-S09), le fil
// de la semaine par journée et le premier jour ; chaque lecture en échec dite avec « Réessayer »
// (`portage-ecrans.md § 4`). L'hôte est simulé par ce qu'il prête (`ContexteDeLHote`, la relecture) ; l'écran
// reçoit les données déjà lues, comme de sa page. E11-S10 (AC-e3) : l'îlot principal, « Activités », sans onglets ;
// la vue « Contexte » a son écran (`contexte-page.test.tsx`, `contexte-servi.test.tsx`).
// E05-S12 (lot B) : le fil est fait d'activités et « Procédures les plus utilisées » remplace « Contenus récents » ; la
// ligne d'une activité, ses liens et la colonne de droite sont éprouvés plus bas (« home activities », « home right
// column »), la mise en page par « should greet the person… ».
// 1.4.13 : l'îlot principal est « Reprendre », le fil son onglet « Fil » ; la recherche de l'accueil part (celle du rail
// suffit) ; « Brancher votre assistant » et « Lancer avec Claude » à droite. La carte elle-même :
// `accueil-reprendre.test.tsx`.
import type { AnchorHTMLAttributes } from "react"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { Activity, ActivityPage, UsefulProcedure } from "@otomata_tech/oto_platform/schemas"
import {
  ContexteDeLHote,
  ContexteDeRafraichissement,
  CoquilleOto,
  EcranDAccueil,
  EcranDAccueilChargement,
  type DonneesDeLAccueil,
  type EcranDAccueilProps,
} from "@otomata_tech/oto_platform/ui"
import { simulerLesDialogues } from "../../helpers/dialogue"

// Le 26 septembre 2026 à midi, heure de Paris (UTC+2) : les journées du fil se comptent à Paris.
const MAINTENANT = new Date("2026-09-26T10:00:00Z")
const MOI = "0b6f1f0e-1c1a-4a8e-9a51-0d7c1a2b3c02"
const ADRESSE = { url: "https://demo.example.test/api/mcp", nom: "Démo", nomCli: "demo", phrase: "Commence par le contexte de « Démo »." }
const BRANCHER = "Brancher votre assistant"
/** La fenêtre du guide garde le titre long : elle nomme ce qu'elle branche. */
const GUIDE = "Brancher mon Claude, ChatGPT ou Mistral"
const ECHEC = "Une erreur est survenue. Réessayez."

const activite = (id: number, at: string, surcharge: Partial<Activity> = {}): Activity => ({
  id,
  at,
  userId: MOI,
  userName: "Claire Morel",
  verb: "published",
  kind: "page",
  path: `ventes/page_${id}`,
  title: `Page ${id}`,
  count: 1,
  ctx: null,
  ...surcharge,
})

const pageDe = (activities: Activity[]): ActivityPage => ({ activities, truncated: false })

const DONNEES: DonneesDeLAccueil = {
  nom: "Claire Morel",
  moi: MOI,
  activites: { data: pageDe([activite(1, "2026-09-26T08:10:00Z")]) },
  reprendre: { data: { items: [], hasMore: false } },
  adresse: ADRESSE,
  connexions: { data: [] },
  procedures: { data: [] },
}

const CLAUDE = { famille: "claude.ai", signature: "claude-ai@1.0", date: "2026-09-24T09:00:00Z" }


/** Le lien de l'hôte : une ancre marquée, pour reconnaître ce qu'il rend. */
function LienDeLHote({ href, children, ...reste }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return (
    <a href={href} data-lien="hote" {...reste}>
      {children}
    </a>
  )
}

const hote = vi.hoisted(() => ({ naviguer: vi.fn(), rafraichir: vi.fn() }))

/** L'écran sous la racine `.oto`, avec ce que l'hôte prête. */
function monter(donnees: EcranDAccueilProps["donnees"]) {
  render(
    <CoquilleOto pleinePage>
      <ContexteDeRafraichissement.Provider value={hote.rafraichir}>
        <ContexteDeLHote.Provider value={{ Lien: LienDeLHote, chemin: "/", naviguer: hote.naviguer }}>
          <EcranDAccueil
            donnees={donnees}
            Lien={LienDeLHote}
            hrefDuJournal="/journal"
            hrefDeConversation={(code) => `/journal?conversation=${code}`}
            prefixeDesPages="/n/"
          />
        </ContexteDeLHote.Provider>
      </ContexteDeRafraichissement.Provider>
    </CoquilleOto>,
  )
}

const ilot = (nom: string) => within(screen.getByRole("region", { name: nom }))
/** L'îlot principal, « Reprendre » (1.4.13). */
const activites = () => ilot("Reprendre")
/** Ouvre l'onglet « Fil » de « Reprendre », fermé par défaut. */
const ouvrirLeFil = () => fireEvent.click(activites().getByRole("tab", { name: "Fil" }))
/** Ce que la carte montre d'une valeur à copier, hors de la fenêtre qui porte le guide. */
const copiesSurLaCarte = () =>
  [...ilot(BRANCHER).queryAllByText(ADRESSE.url, { selector: "code" }), ...ilot(BRANCHER).queryAllByRole("button", { name: /^Copier/ })].filter(
    (element) => element.closest("dialog") === null,
  )

beforeAll(simulerLesDialogues)

beforeEach(() => {
  vi.clearAllMocks()
  // Seule l'horloge est figée : les minuteries des dialogues courent.
  vi.useFakeTimers({ now: MAINTENANT, toFake: ["Date"] })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe("home screen (AC-b1)", () => {
  it("should greet the person and lay out « Reprendre », Brancher votre assistant, Lancer and the news, without a home search", () => {
    monter({ data: DONNEES })

    expect(screen.getByRole("heading", { level: 1, name: "Bonjour Claire Morel" })).toBeInTheDocument()
    // 1.4.13 : la recherche de l'accueil part, celle du rail suffit.
    expect(screen.queryByRole("search")).toBeNull()
    // E05-S12 (AC-18) : « Reprendre » seul à gauche, puis Brancher votre assistant et Lancer à droite, dans cet ordre ;
    // « Nouveautés » est parti (21/10) : le fil le dit déjà.
    const principal = screen.getByRole("region", { name: "Reprendre" })
    const brancher = screen.getByRole("region", { name: BRANCHER })
    const lancer = screen.getByRole("region", { name: "Lancer avec Claude" })
    const colonnes = [...document.querySelectorAll(".oto-home-col")]
    expect(colonnes).toHaveLength(2)
    expect(colonnes[0]).toContainElement(principal)
    for (const element of [brancher, lancer]) expect(colonnes[1]).toContainElement(element)
    expect(screen.queryByRole("region", { name: "Nouveautés" })).toBeNull()
    const ordre = [principal, brancher, lancer]
    for (let rang = 1; rang < ordre.length; rang += 1) expect(ordre[rang - 1].compareDocumentPosition(ordre[rang]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(ilot(BRANCHER).getByRole("heading", { level: 2, name: BRANCHER })).toBeInTheDocument()
    expect(ilot(BRANCHER).getAllByRole("listitem").map((pastille) => pastille.textContent).slice(0, 3)).toEqual(["Claude", "ChatGPT", "Mistral"])
    ouvrirLeFil()
    expect(activites().getByRole("link", { name: "Tout le journal" })).toHaveAttribute("href", "/journal")
    expect(ilot("Lancer avec Claude").getByRole("heading", { level: 2, name: "Lancer avec Claude" })).toBeInTheDocument()
    // E05-S12 (AC-18) : « Contenus récents » quitte l'accueil.
    expect(screen.queryByRole("region", { name: "Contenus récents" })).toBeNull()
  })

  it("should list the activities by Paris day, newest first", () => {
    const activites = [
      activite(4, "2026-09-26T08:10:00Z"),
      // 00:30 à Paris le 26 : encore aujourd'hui, bien qu'il soit le 25 en UTC.
      activite(3, "2026-09-25T22:30:00Z"),
      activite(2, "2026-09-25T20:00:00Z"),
      activite(1, "2026-09-22T09:00:00Z"),
    ]
    monter({ data: { ...DONNEES, activites: { data: pageDe(activites) } } })
    ouvrirLeFil()

    // Les journées et leurs lignes, dans l'ordre du document : chaque ligne sous le titre de sa journée, un
    // niveau sous les onglets de l'îlot.
    const ordre = [...screen.getByRole("region", { name: "Reprendre" }).querySelectorAll("h2, h3, a[href^='/n/']")].map((element) =>
      element.tagName === "A" ? element.getAttribute("href") : `${element.tagName} ${element.textContent}`,
    )
    expect(ordre).toEqual(["H3 Aujourd'hui", "/n/ventes/page_4", "/n/ventes/page_3", "H3 Hier", "/n/ventes/page_2", "H3 22 septembre 2026", "/n/ventes/page_1"])
  })
})

describe("home screen first day (AC-b1 ; E05-S12, AC-16)", () => {
  const vide: ActivityPage = pageDe([])

  it.each<[string, Partial<DonneesDeLAccueil>, boolean]>([
    ["no activity this week and no assistant ever connected", { activites: { data: vide }, connexions: { data: [] } }, true],
    ["an activity this week", { connexions: { data: [] } }, false],
    ["an assistant connected", { activites: { data: vide }, connexions: { data: [CLAUDE] } }, false],
    ["a failed read of the journal", { activites: { error: ECHEC }, connexions: { data: [] } }, false],
    ["a failed read of the connections", { activites: { data: vide }, connexions: { error: ECHEC } }, false],
  ])("with %s, should show the first day: %s", (_cas, surcharge, premierJour) => {
    monter({ data: { ...DONNEES, ...surcharge } })

    // Le premier jour prend la place de « Reprendre » (HN-E05S11-11), et retire « Lancer » et les nouveautés ;
    // « Brancher » reste.
    expect(activites().queryByText("Rien n'a encore tourné") !== null).toBe(premierJour)
    expect(activites().queryByRole("tab", { name: "Fil" }) !== null).toBe(!premierJour)
    if (!premierJour) ouvrirLeFil()
    expect(activites().queryByRole("link", { name: "Tout le journal" }) !== null).toBe(!premierJour)
    expect(screen.queryByRole("region", { name: "Lancer avec Claude" }) !== null).toBe(!premierJour)
    expect(screen.getByRole("region", { name: BRANCHER })).toBeInTheDocument()
  })

  it("should say an empty week without any action when an assistant is connected", () => {
    monter({ data: { ...DONNEES, activites: { data: vide }, connexions: { data: [CLAUDE] } } })
    ouvrirLeFil()

    expect(activites().getByText("Aucune activité cette semaine")).toBeInTheDocument()
    expect(within(activites().getByRole("tabpanel")).queryByRole("button")).toBeNull()
  })
})

describe("home screen main island (E11-S10, AC-e3 ; 1.4.13)", () => {
  it("should head the main island with its tabs, no title, open « Récents », keep « Fil » closed, and read no Contexte", () => {
    monter({ data: DONNEES })

    expect(activites().queryByRole("heading", { level: 2 })).toBeNull()
    expect(activites().getAllByRole("tab").map((onglet) => [onglet.textContent, onglet.getAttribute("aria-selected")])).toEqual([
      ["Récents", "true"],
      ["Les plus consultés", "false"],
      ["Fil", "false"],
    ])
    expect(screen.queryByRole("tab", { name: "Contexte" })).toBeNull()
    expect(screen.queryByRole("region", { name: /^Contexte/ })).toBeNull()
  })
})

describe("home screen Brancher mon Claude, ChatGPT ou Mistral (E11-S09, AC-9, AC-10)", () => {
  it.each<[string, Partial<DonneesDeLAccueil>]>([
    ["no connection", { connexions: { data: [] } }],
    ["a connection", { connexions: { data: [CLAUDE] } }],
    ["a failed read of the connections", { connexions: { error: ECHEC } }],
  ])("should never show the address nor any copy on the card, with %s (AC-9)", (_cas, surcharge) => {
    monter({ data: { ...DONNEES, ...surcharge } })

    expect(copiesSurLaCarte()).toEqual([])
  })

  it("should say that no assistant is connected yet", () => {
    monter({ data: DONNEES })

    expect(ilot(BRANCHER).getByText("Aucun assistant branché")).toBeInTheDocument()
  })

  it("should name each connected assistant with its last connection", () => {
    monter({ data: { ...DONNEES, connexions: { data: [CLAUDE, { famille: "Claude Code", signature: "claude-code@2.1", date: "2026-09-20T09:00:00Z" }] } } })

    expect(ilot(BRANCHER).getAllByRole("listitem").slice(3).map((ligne) => ligne.textContent)).toEqual([
      "claude.ai · dernière connexion le 24 septembre 2026",
      "Claude Code · dernière connexion le 20 septembre 2026",
    ])
  })

  it("should open on « Brancher » the large window on the guide, on the tab of the latest family, without any link to /connect, and close it (AC-10)", async () => {
    monter({ data: { ...DONNEES, connexions: { data: [{ famille: "Claude Code", signature: "claude-code@2.1", date: "2026-09-24T09:00:00Z" }, CLAUDE] } } })
    fireEvent.click(ilot(BRANCHER).getByRole("button", { name: "Brancher" }))

    const fenetre = screen.getByRole("dialog", { name: GUIDE })
    expect(fenetre).toHaveAttribute("data-size", "lg")
    const dedans = within(fenetre)
    expect(dedans.getByText("Ajoutez Démo à votre assistant : il agira avec votre compte, dans la limite de vos droits.")).toBeInTheDocument()
    expect(dedans.getByRole("tab", { name: "Claude Code" })).toHaveAttribute("aria-selected", "true")
    expect(dedans.queryByRole("link", { name: /Guides d'installation/ })).toBeNull()
    expect(fenetre.querySelector("a[href='/connect']")).toBeNull()
    fireEvent.click(within(fenetre.querySelector("footer") ?? fenetre).getByRole("button", { name: "Fermer" }))
    // Le dialogue du design system reste monté : il est fermé quand il ne porte plus `open`.
    await waitFor(() => expect(fenetre.hasAttribute("open")).toBe(false))
  })
})

describe("home screen failed reads (portage-ecrans.md § 4 ; E05-S12, AC-16, AC-18)", () => {
  it.each<[string, Partial<DonneesDeLAccueil>]>([
    ["Reprendre", { activites: { error: ECHEC } }],
    [BRANCHER, { connexions: { error: ECHEC } }],
    ["Lancer avec Claude", { procedures: { error: ECHEC } }],
  ])("should say a failed read in « %s » with « Réessayer », which reads the page again", (nom, surcharge) => {
    monter({ data: { ...DONNEES, ...surcharge } })
    if (nom === "Reprendre") ouvrirLeFil()

    const zone = within(screen.getByRole("region", { name: nom }))
    expect(screen.getAllByRole("alert").filter((alerte) => alerte.textContent !== "")).toHaveLength(1)
    // La région d'alerte de « Reprendre », montée vide, ne compte pas.
    expect(zone.getAllByRole("alert").find((alerte) => alerte.textContent !== "")).toHaveTextContent(`Chargement impossible${ECHEC}`)
    fireEvent.click(zone.getByRole("button", { name: "Réessayer" }))
    expect(hote.rafraichir).toHaveBeenCalledTimes(1)
  })

  it("should say once that the home could not be read when the identity could not", () => {
    monter({ error: ECHEC })

    expect(screen.getByRole("heading", { level: 1, name: "Bonjour" })).toBeInTheDocument()
    expect(screen.getByRole("alert")).toHaveTextContent(`Chargement impossible${ECHEC}`)
    expect(screen.queryByRole("region")).toBeNull()
  })

  it("should announce the loading of the home", () => {
    render(<EcranDAccueilChargement />)

    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true")
    expect(screen.getByRole("status")).toHaveTextContent("Chargement de l'accueil…")
  })
})

// L'accueil en activités (E05-S12, lot B) : une activité par ligne, sa phrase écrite par l'écran depuis le verbe
// classé par le service, le nombre de gestes regroupés, l'heure (AC-13) ; ce qu'ouvre une ligne (AC-15) ; à
// droite « Brancher un assistant » et « Procédures les plus utilisées » (AC-18). 1.4.13 : le fil est l'onglet « Fil »
// de la carte « Reprendre », le contenu cité d'une ligne qui l'ouvre se montre comme un lien ; à droite, « Brancher
// votre assistant » et « Lancer avec Claude ».
describe("home activities and right column (E05-S12, lot B)", () => {
  const ADA = "0b6f1f0e-1c1a-4a8e-9a51-0d7c1a2b3c03"

  const activiteDuFil = (id: number, surcharge: Partial<Activity>): Activity => ({
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

  const DONNEES_DU_FIL: DonneesDeLAccueil = {
    nom: "Claire Morel",
    moi: MOI,
    activites: { data: { activities: [], truncated: false } },
    reprendre: { data: { items: [], hasMore: false } },
    adresse: ADRESSE,
    connexions: { data: [CLAUDE] },
    procedures: { data: [] },
  }

  /** L'écran, l'onglet « Fil » de « Reprendre » ouvert. */
  function monterLeFil(donnees: Partial<DonneesDeLAccueil>) {
    monter({ data: { ...DONNEES_DU_FIL, ...donnees } })
    ouvrirLeFil()
  }

  /** Les lignes du fil, liens ou non, dans l'ordre du document. */
  const lignes = () => [...screen.getByRole("region", { name: "Reprendre" }).querySelectorAll(".oto-feed-item")]

  describe("home activities, one line each (E05-S12, AC-13, AC-15)", () => {
    it("should write who, what happened with the nature and the title, the grouped count and the hour, each line opening the content through the host's link", () => {
      monterLeFil({
        activites: {
          data: {
            truncated: false,
            activities: [
              activiteDuFil(5, { at: "2026-09-26T10:02:00Z", userId: MOI, userName: "Claire Morel", verb: "published", path: "ventes/tarifs_2026", title: "Tarifs 2026" }),
              activiteDuFil(4, { at: "2026-09-26T09:15:00Z", verb: "wrote_rows", kind: "table", path: "ventes/salons", title: "Salons", count: 3 }),
              activiteDuFil(3, { at: "2026-09-26T09:00:00Z", userId: MOI, userName: "Claire Morel", verb: "created", kind: "table", path: "ventes/prospects", title: "Prospects" }),
            ],
          },
        },
      })

      const liens = activites().getAllByRole("link").filter((lien) => lien.textContent !== "Tout le journal")
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
      monterLeFil({
        activites: {
          data: {
            truncated: false,
            activities: [
              activiteDuFil(2, { userId: MOI, userName: "Claire Morel", verb: "deleted_rows", kind: "table", path: "ventes/suivi_prospects", title: "Suivi des prospects", inReview: 2 }),
              activiteDuFil(1, { verb: "deleted_rows", kind: "table", path: "ventes/salons", title: "Salons" }),
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

    // Retours du 21/10 : une procédure lancée ouvre la procédure, le contenu que la ligne cite.
    it("should open a launched procedure, and nothing for a content the person does not read, keeping its path as the journal shows it", () => {
      monterLeFil({
        activites: {
          data: {
            truncated: false,
            activities: [
              activiteDuFil(3, { verb: "ran", kind: "procedure", path: "ventes/relance_devis", title: "Relancer les devis", ctx: "K7M2-9QXR" }),
              activiteDuFil(2, { userId: "u-parti", userName: null, verb: "trashed", path: "ventes/ancienne_grille", title: null }),
              // L'espace personnel d'une autre personne, coupé par le service (D44) : ni nature ni titre.
              activiteDuFil(1, { verb: "edited", kind: null, path: "private/lea", title: null, count: 2 }),
            ],
          },
        },
      })

      const [lancee, corbeille, privee] = lignes()
      expect(lancee).toHaveAttribute("href", "/n/ventes/relance_devis")
      // Et, à côté de la ligne, sa conversation au journal : deux liens, jamais l'un dans l'autre.
      const conversation = screen.getByRole("link", { name: "Voir la conversation dans le journal : Relancer les devis" })
      expect(conversation).toHaveAttribute("href", "/journal?conversation=K7M2-9QXR")
      expect(lancee.contains(conversation)).toBe(false)
      expect(screen.getAllByRole("link", { name: /^Voir la conversation/ })).toHaveLength(1)
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

    it("should list the procedures to launch in the order served, each with its glyph and its title, opening the procedure", () => {
      monterLeFil({ procedures: { data: PROCEDURES } })

      const liens = within(screen.getByRole("region", { name: "Lancer avec Claude" })).getAllByRole("link").filter((lien) => lien.dataset.lien === "hote")
      expect(liens.map((lien) => [lien.textContent, lien.getAttribute("href")])).toEqual([
        ["Relancer les devis", "/n/ventes/relance_devis"],
        ["Passer une commande", "/n/achats/commande"],
      ])
      expect(liens[0].querySelector("svg")).not.toBeNull()
    })

    it("should say that no procedure is published when the list is empty, without any action", () => {
      monterLeFil({ procedures: { data: [] } })

      const zone = within(screen.getByRole("region", { name: "Lancer avec Claude" }))
      expect(zone.getByText("Aucune procédure publiée")).toBeInTheDocument()
      expect(zone.queryByRole("link")).toBeNull()
      expect(zone.queryByRole("button")).toBeNull()
    })
  })

  // 1.4.13 : « Lancer avec Claude » ouvre Claude sur la demande.
  describe("home Lancer avec Claude (1.4.13)", () => {
    it("should open Claude in a new tab on the request of a procedure, by a link", () => {
      monterLeFil({ procedures: { data: [{ path: "ventes/relance_devis", title: "Relancer les devis" }] } })
      const lancer = within(screen.getByRole("region", { name: "Lancer avec Claude" }))

      const lien = lancer.getByRole("link", { name: "Lancer dans Claude : Relancer les devis" })
      const adresse = new URL(lien.getAttribute("href") ?? "")
      expect([adresse.origin, adresse.pathname, adresse.searchParams.get("q")]).toEqual(["https://claude.ai", "/new", "Suis la procédure « Relancer les devis » (ventes/relance_devis)."])
      expect([lien.getAttribute("target"), lien.getAttribute("rel")]).toEqual(["_blank", "noopener noreferrer"])
      expect(lancer.queryByRole("button")).toBeNull()
    })
  })
})
