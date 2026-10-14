// Le rail porté d'oto-frontend, la seule coque (E05-S09, partie a) : ses zones dans l'ordre (AC-a3), ses
// menus et leurs gestes par l'API du paquet (AC-a4), les procédures dans l'arbre (AC-a5), la navigation
// par le lien de l'hôte et la ligne courante (AC-a6), la palette (AC-a7), et ses morceaux dans la barre
// latérale d'un ERP (AC-a8) ; E05-S10 (partie b) : le « + » d'une procédure (AC-b1), le dépliage au clic
// (AC-b2), la création sans dialogue (AC-b3), le déplacement par glisser-déposer et par « ⋯ » (AC-b7) ;
// partie b2 : la confirmation sur l'aperçu du service (AC-b7), le « ⋯ » sans « Renommer » (AC-b8), le
// rangement entre frères (AC-b9), « Dupliquer » (AC-b10), « Supprimer » et le lien de la corbeille (AC-b11) ;
// le nœud créé montré avant la relecture de l'arbre, à l'adresse que le service rend (AC-c2). E05-S11 (lot e) :
// Connecteurs au pied (AC-32), le menu de l'entreprise (AC-31, AC-33), le menu du compte (AC-6, AC-e22), le
// « + » de Privé (AC-34), le résumé par genre (AC-e21), « Contexte · <section> » (AC-18). E05-S12 (lot D) : créer,
// déposer et ranger sous un Contexte (AC-25 à AC-27). E11-S20 : l'arbre relu seul, à la navigation, au retour sur
// l'onglet, après un geste (AC-3 à AC-8).
// L'hôte est simulé par ce qu'il prête (`ContexteDeLHote`, la relecture) ; l'API, par `fetch`.
import type { AnchorHTMLAttributes } from "react"
import { cleanup, createEvent, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { MoveImpact, TreeNode } from "@otomata_tech/oto_platform/schemas"
import {
  ContexteDeLHote,
  ContexteDeRafraichissement,
  CoquilleOto,
  RailApplication,
  SectionsDuRail,
  type AdressesDuRail,
  type RailApplicationProps,
} from "@otomata_tech/oto_platform/ui"
import { simulerLesDialogues } from "../../helpers/dialogue"
import { choisirDansLaListe } from "../../helpers/liste-de-choix"

const noeud = (path: string, kind: TreeNode["kind"], title: string, children: TreeNode[] = []): TreeNode => ({ path, kind, title, status: "published", children })

// L'arbre de Claire, membre de Ventes : Tout le monde (son Contexte, Conseil et sa grille), Ventes (son
// Contexte et une procédure), Privé (son Contexte et ses notes).
const ARBRE: TreeNode[] = [
  noeud("guide", "page", "Guide de Démo", [
    noeud("contexte", "context", "Contexte de l'organisation"),
    noeud("conseil", "page", "Conseil", [noeud("conseil/grille", "table", "Grille tarifaire")]),
    noeud("private", "page", "Espaces personnels", [noeud("private/claire", "page", "Claire", [noeud("private/claire/contexte", "context", "Contexte"), noeud("private/claire/notes", "page", "Notes")])]),
    noeud("ventes", "page", "Ventes", [noeud("ventes/contexte", "context", "Contexte"), noeud("ventes/qualifier", "procedure", "Qualifier un prospect")]),
  ]),
]
const EQUIPES = [{ slug: "ventes", name: "Ventes" }]

const ADRESSES: AdressesDuRail = {
  pages: "/n/",
  accueil: "/",
  journal: "/journal",
  equipes: "/teams",
  brancher: "/connect",
  usage: "/admin/usage",
  retours: "/admin/feedback",
  organisation: "/admin/organization",
  connecteurs: "/admin/connectors",
  corbeille: "/trash",
  profil: "/profile",
}

/** Le lien de l'hôte : une ancre marquée, pour reconnaître ce qu'il rend. */
function LienDeLHote({ href, children, ...reste }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return (
    <a href={href} data-lien="hote" {...reste}>
      {children}
    </a>
  )
}

const hote = vi.hoisted(() => ({ naviguer: vi.fn(), deconnecter: vi.fn(), rafraichir: vi.fn() }))

const PROPS: RailApplicationProps = {
  entreprise: { nom: "Démo", logo: null },
  arbre: { data: { tree: ARBRE, truncated: false } },
  equipes: { data: EQUIPES },
  handle: "claire",
  compte: "Claire Morel",
  administre: true,
  adresses: ADRESSES,
}

/** Le rail sous l'hôte simulé, à cette adresse ; rerendu à une autre, c'est une navigation. */
function railA(chemin: string, props: Partial<RailApplicationProps> = {}) {
  return (
    <CoquilleOto pleinePage>
      <ContexteDeRafraichissement.Provider value={hote.rafraichir}>
        <ContexteDeLHote.Provider value={{ Lien: LienDeLHote, chemin, naviguer: hote.naviguer, deconnecter: hote.deconnecter }}>
          <RailApplication {...PROPS} {...props} />
        </ContexteDeLHote.Provider>
      </ContexteDeRafraichissement.Provider>
    </CoquilleOto>
  )
}

function monter(props: Partial<RailApplicationProps> = {}, chemin = "/n/conseil/grille") {
  render(railA(chemin, props))
  // `hidden` : sous 768 px, le tiroir fermé est caché aux lecteurs d'écran (sans nom accessible), et le
  // test le lit quand même ; le rail est la seule navigation rendue ici.
  return screen.getByRole("navigation", { hidden: true })
}

type Reponse = { data: unknown } | { error: { code: "forbidden" | "conflict" | "stale_revision" | "not_found" | "internal"; message: string } }

const STATUTS = { forbidden: 403, conflict: 409, stale_revision: 409, not_found: 404, internal: 500 } as const

/** Une réponse de l'API, au statut de son code. */
function repondre(reponse: Reponse): Response {
  const statut = "error" in reponse ? STATUTS[reponse.error.code] : 200
  return new Response(JSON.stringify(reponse), { status: statut, headers: { "content-type": "application/json" } })
}

/** Une relecture de l'arbre en panne : l'arbre montré reste (E11-S20, AC-6). */
const PANNE: Reponse = { error: { code: "internal", message: "Internal error." } }

/** L'arbre que rend une relecture (`GET nodes/tree`, E11-S20). */
const arbreRelu = (tree: TreeNode[]): Reponse => ({ data: { tree, truncated: false } })

/**
 * Les relectures de l'arbre par le rail (E11-S20, `GET nodes/tree`) : servies hors de la file des réponses et des
 * appels relus, chacune par la première de `reponses`, sinon en panne (l'arbre montré reste) ; comptées.
 */
const relectures: { nombre: number; reponses: Reponse[] } = { nombre: 0, reponses: [] }

/**
 * L'API simulée, qui répond sans attendre : chaque appel est rendu par `reponses`, dans l'ordre, un refus
 * au statut de son code ; les appels se relisent. Les relectures de l'arbre passent par `relectures`.
 */
function simulerLAPI(...reponses: Reponse[]) {
  const appels: { url: string; methode: string; corps: unknown }[] = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/platform/nodes/tree") {
        relectures.nombre++
        return repondre(relectures.reponses.shift() ?? PANNE)
      }
      appels.push({ url, methode: init?.method ?? "GET", corps: init?.body ? JSON.parse(String(init.body)) : undefined })
      return repondre(reponses.shift() ?? { data: {} })
    }),
  )
  return appels
}

const REFUS: Reponse = { error: { code: "forbidden", message: "Only a writer of ventes can write here: ask Ada." } }

type Changement = MoveImpact["gained"][number]

const membre = (name: string, before: Changement["before"], after: Changement["after"]): Changement => ({ userId: `u-${name}`, name, before, after })

/** L'aperçu d'un déplacement (`GET nodes/impact`, E05-S10 b2) : par défaut, un changement de propriétaire seul. */
function impact(surcharge: Partial<MoveImpact>): Reponse {
  const place = { space: "all", owner: "organisation Démo" } as const
  const totals = { gained: 0, lost: 0, changed: 0 }
  return { data: { path: "conseil/grille", newPath: "grille", changes: true, before: place, after: place, gained: [], lost: [], changed: [], totals, ...surcharge } }
}

/** Ouvre au clavier le menu d'un déclencheur qui a le focus, puis choisit la ligne de ce rang (Entrée). */
function choisirAuClavier(declencheur: HTMLElement, rang = 0) {
  declencheur.focus()
  fireEvent.keyDown(declencheur, { key: "ArrowDown" })
  for (let pas = 0; pas <= rang; pas++) fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" })
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Enter" })
}

const menu = () => within(screen.getByRole("menu"))
const itemsDuMenu = () => menu().getAllByRole("menuitem").map((item) => item.textContent)

/** Le corps d'une création sans dialogue (AC-b3) : « Sans titre », le résumé par défaut de son genre (AC-e21), et la colonne clé d'un tableau. */
const NEUF = { title: "Sans titre" }
// E11-S05 (AC-f3) : le résumé par défaut d'une procédure dit comment l'écrire ; ceux d'une page et d'un tableau ne changent pas.
const RESUMES = {
  page: "Résumé de la page à compléter.",
  table: "Résumé du tableau à compléter.",
  procedure: "Résumé à compléter : dites ce que fait la procédure et comment on la demande, avec les mots de l'équipe. L'assistant la choisit sur ce résumé et sur le titre.",
}
const COLONNE_CLE = { header: { columns: [{ name: "nom", type: "text" }], key: "nom" } }

/** La palette est un `<dialog>` toujours monté : elle est ouverte quand elle porte `open`. */
const paletteOuverte = () => document.querySelector("dialog.oto-palette")?.hasAttribute("open") ?? false

beforeAll(simulerLesDialogues)

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  relectures.nombre = 0
  relectures.reponses = []
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("RailApplication zones (AC-a3)", () => {
  it("should lay out the company, Accueil, Rechercher, one section per space opened by its Contexte, then Connecteurs and the account, without Agents, Procédures, the colour nor the bin at the foot (AC-32, AC-6, AC-e22)", () => {
    const rail = monter()

    const ordre = [
      // Sans liste d'organisations, le nom accessible ne promet pas de bascule (HN-E05S09a-2).
      within(rail).getByRole("button", { name: "Entreprise : Démo. Réglages de l'entreprise" }),
      within(rail).getByRole("link", { name: "Accueil" }),
      within(rail).getByRole("searchbox", { name: "Rechercher" }),
      // Le titre d'une section est dans son bouton de pli (E05-S13, AC-12).
      within(rail).getByRole("button", { name: "Replier Tout le monde" }),
      within(rail).getByRole("link", { name: "Contexte · Tout le monde" }),
      within(rail).getByRole("button", { name: "Replier Ventes" }),
      within(rail).getByRole("link", { name: "Contexte · Ventes" }),
      within(rail).getByRole("button", { name: "Replier Privé" }),
      within(rail).getByRole("link", { name: "Contexte · Privé" }),
      within(rail).getByRole("link", { name: "Connecteurs" }),
      within(rail).getByRole("button", { name: "Compte : Claire Morel. Ouvrir le menu" }),
    ]
    for (const [rang, element] of ordre.slice(0, -1).entries()) {
      expect(element.compareDocumentPosition(ordre[rang + 1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
    // Chaque liste de l'arbre porte le nom de sa section, comme le navigateur d'arbre remplacé.
    expect(within(rail).getByRole("list", { name: "Ventes" })).toContainElement(within(rail).getByRole("link", { name: "Qualifier un prospect" }))
    // Le pied d'oto-frontend portait « Couleur », « Procédures », « Agents » : aucun n'est une ligne du rail ; la Corbeille est au menu du compte.
    expect(within(rail).getByRole("link", { name: "Connecteurs" })).toHaveAttribute("href", "/admin/connectors")
    expect(within(rail).queryByRole("link", { name: /^(Agents|Procédures|Corbeille)$/ })).toBeNull()
    expect(within(rail).queryByRole("button", { name: /^(Agents|Couleur du thème)$/ })).toBeNull()
  })

  it("should keep Connecteurs out of the foot for a person who does not administer, and mark it current on its screens (AC-32)", () => {
    const membre = monter({ administre: false })
    expect(within(membre).queryByRole("link", { name: "Connecteurs" })).toBeNull()
    cleanup()

    const admin = monter({}, "/admin/connectors")
    expect(within(admin).getByRole("link", { name: "Connecteurs" })).toHaveAttribute("aria-current", "page")
  })

  it("should keep a section folded by this browser", async () => {
    const rail = monter()
    fireEvent.click(within(rail).getByRole("button", { name: "Replier Ventes" }))
    expect(within(rail).getByRole("button", { name: "Déplier Ventes" })).toHaveAttribute("aria-expanded", "false")
    expect(window.localStorage.getItem("oto-rail-plis")).toBe("ventes")
    cleanup()

    const relu = monter()
    await waitFor(() => expect(within(relu).getByRole("button", { name: "Déplier Ventes" })).toBeInTheDocument())
    expect(within(relu).queryByRole("link", { name: "Qualifier un prospect" })).toBeNull()
  })

  // portage-ecrans.md § 4 : chaque lecture en échec se dit, avec son message et « Réessayer ».
  it.each([
    ["the tree", { arbre: { error: "Votre session a expiré. Reconnectez-vous." } }, "Votre session a expiré. Reconnectez-vous."],
    ["the teams", { equipes: { error: "Cette adresse ne sert plus d'organisation. Rechargez la page." } }, "Cette adresse ne sert plus d'organisation. Rechargez la page."],
  ] as const)("should say the failed read of %s with its message, and re-read the page on « Réessayer »", (_lecture, panne, message) => {
    const rail = monter(panne)

    const alerte = within(rail).getByRole("alert")
    expect(alerte).toHaveTextContent("L'arbre n'a pas pu être chargé")
    expect(alerte).toHaveTextContent(message)
    expect(within(rail).queryByRole("link", { name: /^Contexte/ })).toBeNull()
    fireEvent.click(within(alerte).getByRole("button", { name: "Réessayer" }))
    expect(hote.rafraichir).toHaveBeenCalledTimes(1)
  })

  it("should say an empty tree in one sentence", () => {
    const rail = monter({ arbre: { data: { tree: [], truncated: false } } })

    expect(within(rail).getByText("L'arbre est vide : aucun nœud ne vous est encore partagé.")).toBeInTheDocument()
    expect(within(rail).queryByRole("alert")).toBeNull()
  })
})

describe("RailApplication menus (AC-a4)", () => {
  // E05-S11 (AC-31, AC-32, AC-33) : « Réglages de l'entreprise » d'abord, « Équipes & accès » dedans ; ni Marque,
  // ni Drapeaux, ni Accès plateforme, ni Connecteurs (au pied du rail), même quand l'hôte en sert l'adresse.
  // E05-S13 (AC-10) : « Journal » dans les réglages ; un seul groupe montré n'a pas de sous-titre. 1.1.3 : ni Usage
  // ni Retours, même quand l'hôte en sert l'adresse ; « Suivi de l'entreprise » disparaît.
  it.each([
    [true, ["Organisation", "Équipes & accès", "Journal"]],
    [false, ["Équipes & accès", "Journal"]],
  ])("should offer the company menu by administration right (%s), without follow-up screens, each entry navigating", (administre, attendues) => {
    const rail = monter({ administre, adresses: { ...ADRESSES, marque: "/admin/brand", drapeaux: "/admin/flags", acces: "/admin/access" } })
    fireEvent.click(within(rail).getByRole("button", { name: /^Entreprise : Démo/ }))

    expect(itemsDuMenu()).toEqual(attendues)
    const texte = screen.getByRole("menu").textContent ?? ""
    expect(texte).not.toMatch(/Réglages de l’entreprise|Suivi de l’entreprise/)
    expect(texte).not.toContain("Membres & équipes")
    fireEvent.click(menu().getByRole("menuitem", { name: "Équipes & accès" }))
    expect(hote.naviguer).toHaveBeenCalledWith("/teams")
  })

  // E05-S11 (AC-6, AC-e22) : « Profil » ouvre la page Profil, la Corbeille s'ouvre d'ici ; ni « Apparence » ni « Couleur ».
  // E11-S10 (AC-e1) : « Contexte » en tête, quand l'hôte en donne l'adresse.
  it.each([false, true])("should offer Contexte, Profil, Brancher mon Claude, ChatGPT ou Mistral, Corbeille, then Déconnexion in the account menu, the same whatever the administration right (%s)", (administre) => {
    const rail = monter({ administre, adresses: { ...ADRESSES, contexte: "/context" } })
    fireEvent.click(within(rail).getByRole("button", { name: "Compte : Claire Morel. Ouvrir le menu" }))
    expect(itemsDuMenu()).toEqual(["Contexte", "Profil", "Brancher mon Claude, ChatGPT ou Mistral", "Corbeille", "Déconnexion"])
    fireEvent.click(menu().getByRole("menuitem", { name: "Contexte" }))
    expect(hote.naviguer).toHaveBeenCalledWith("/context")

    fireEvent.click(within(rail).getByRole("button", { name: "Compte : Claire Morel. Ouvrir le menu" }))
    fireEvent.click(menu().getByRole("menuitem", { name: "Profil" }))
    expect(hote.naviguer).toHaveBeenLastCalledWith("/profile")

    fireEvent.click(within(rail).getByRole("button", { name: "Compte : Claire Morel. Ouvrir le menu" }))
    fireEvent.click(menu().getByRole("menuitem", { name: "Corbeille" }))
    expect(hote.naviguer).toHaveBeenLastCalledWith("/trash")

    fireEvent.click(within(rail).getByRole("button", { name: "Compte : Claire Morel. Ouvrir le menu" }))
    fireEvent.click(menu().getByRole("menuitem", { name: "Déconnexion" }))
    expect(hote.deconnecter).toHaveBeenCalledTimes(1)
  })

  // E11-S10 (AC-e1, HN-E11S10-18) : sans l'adresse de la vue, ni entrée au menu du compte ni commande de la palette ;
  // avec elle, la palette la propose sous « Aller à ».
  it("should offer « Contexte » in the palette under « Aller à » only when the host gives its address", () => {
    let rail = monter()
    fireEvent.click(within(rail).getByRole("button", { name: "Compte : Claire Morel. Ouvrir le menu" }))
    expect(itemsDuMenu()).not.toContain("Contexte")
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" })
    fireEvent.click(within(rail).getByRole("searchbox", { name: "Rechercher" }))
    expect(within(within(screen.getByRole("dialog", { name: "Palette de commandes" })).getByRole("group", { name: "Aller à" })).queryByRole("option", { name: "Contexte" })).toBeNull()
    cleanup()

    rail = monter({ adresses: { ...ADRESSES, contexte: "/context" } })
    fireEvent.click(within(rail).getByRole("searchbox", { name: "Rechercher" }))
    const allerA = within(within(screen.getByRole("dialog", { name: "Palette de commandes" })).getByRole("group", { name: "Aller à" }))
    fireEvent.click(allerA.getByRole("option", { name: "Contexte" }))
    expect(hote.naviguer).toHaveBeenCalledWith("/context")
  })

  it("should create a table in a team from the « + » of its section at once, untitled with its key column, then open it where the service put it and re-read the page (AC-b3)", async () => {
    // Un « Sans titre » de la corbeille tient l'adresse demandée : le service en choisit une autre, qui s'ouvre.
    const appels = simulerLAPI({ data: { path: "ventes/sans_titre_2" } })
    const rail = monter()
    fireEvent.click(within(rail).getByRole("button", { name: "Créer dans Ventes" }))
    expect(menu().getByText("Dans Ventes")).toBeInTheDocument()
    fireEvent.click(menu().getByRole("menuitem", { name: "Un tableau" }))

    // Aucun dialogue : le nœud naît avec ses valeurs par défaut, sa page s'ouvre.
    expect(screen.queryByRole("dialog")).toBeNull()
    await waitFor(() => expect(hote.naviguer).toHaveBeenCalledWith("/n/ventes/sans_titre_2"))
    expect(hote.rafraichir).toHaveBeenCalledTimes(1)
    expect(appels).toEqual([{ url: "/api/platform/nodes", methode: "POST", corps: { path: "ventes/sans_titre", ...NEUF, summary: RESUMES.table, kind: "table", ...COLONNE_CLE } }])
  })

  it("should offer a page, a table and a procedure from the « + » of Privé as elsewhere, and create at the first free address: a visible one skipped, a taken one tried again (AC-34)", async () => {
    // `private/claire/sans_titre` est dans l'arbre : écartée d'avance ; `…_2` est prise (invisible, ou modifiée sans révision) : la suivante.
    const arbre = { data: { tree: [noeud("guide", "page", "Guide de Démo", [noeud("private", "page", "Espaces", [noeud("private/claire", "page", "Claire", [noeud("private/claire/contexte", "context", "Contexte"), noeud("private/claire/sans_titre", "page", "Sans titre")])])])], truncated: false } }
    const appels = simulerLAPI({ error: { code: "conflict", message: "Path private/claire/sans_titre_2 is not available." } }, { error: { code: "stale_revision", message: "stale revision" } }, { data: { path: "private/claire/sans_titre_4" } })
    const rail = monter({ arbre })
    fireEvent.click(within(rail).getByRole("button", { name: "Créer dans Privé" }))
    expect(itemsDuMenu()).toEqual(["Une page", "Un tableau", "Une procédure", "Importer un fichier…"])
    fireEvent.click(menu().getByRole("menuitem", { name: "Une page" }))

    await waitFor(() => expect(hote.naviguer).toHaveBeenCalledWith("/n/private/claire/sans_titre_4"))
    expect(appels.map((appel) => appel.corps)).toEqual([
      { path: "private/claire/sans_titre_2", ...NEUF, summary: RESUMES.page, kind: "page" },
      { path: "private/claire/sans_titre_3", ...NEUF, summary: RESUMES.page, kind: "page" },
      { path: "private/claire/sans_titre_4", ...NEUF, summary: RESUMES.page, kind: "page" },
    ])
  })

  it("should show the created node in the rail at once, before the tree is re-read, then once when the re-read tree carries it (AC-c2)", async () => {
    simulerLAPI({ data: { path: "ventes/sans_titre" } })
    const { rerender } = render(railA("/n/conseil/grille"))
    const sansTitre = () => within(screen.getByRole("navigation", { hidden: true })).queryAllByRole("link", { name: "Sans titre" })
    fireEvent.click(screen.getByRole("button", { name: "Créer dans Ventes" }))
    fireEvent.click(menu().getByRole("menuitem", { name: "Une page" }))

    await waitFor(() => expect(hote.naviguer).toHaveBeenCalledWith("/n/ventes/sans_titre"))
    // La relecture demandée n'est pas encore là : l'arbre servi est celui d'avant.
    expect(sansTitre().map((lien) => lien.getAttribute("href"))).toEqual(["/n/ventes/sans_titre"])

    const relu = [
      noeud("guide", "page", "Guide de Démo", [
        ...ARBRE[0].children.filter((enfant) => enfant.path !== "ventes"),
        noeud("ventes", "page", "Ventes", [noeud("ventes/contexte", "context", "Contexte"), noeud("ventes/sans_titre", "page", "Sans titre")]),
      ]),
    ]
    rerender(railA("/n/ventes/sans_titre", { arbre: { data: { tree: relu, truncated: false } } }))
    expect(sansTitre().map((lien) => lien.getAttribute("href"))).toEqual(["/n/ventes/sans_titre"])
    expect(sansTitre()[0]).toHaveAttribute("aria-current", "page")
    expect(within(screen.getByRole("navigation", { hidden: true })).queryByRole("link", { name: "Qualifier un prospect" })).toBeNull()
  })

  it("should give a procedure its « + », to create a page, a table or a procedure under it (AC-b1)", async () => {
    const appels = simulerLAPI({ data: { path: "ventes/qualifier/sans_titre" } })
    const rail = monter()
    fireEvent.click(within(rail).getByRole("button", { name: "Ajouter dans Qualifier un prospect" }))
    expect(itemsDuMenu()).toEqual(["Une page", "Un tableau", "Une procédure", "Importer un fichier…"])
    fireEvent.click(menu().getByRole("menuitem", { name: "Une procédure" }))

    await waitFor(() => expect(hote.naviguer).toHaveBeenCalledWith("/n/ventes/qualifier/sans_titre"))
    expect(appels).toEqual([{ url: "/api/platform/nodes", methode: "POST", corps: { path: "ventes/qualifier/sans_titre", ...NEUF, summary: RESUMES.procedure, kind: "procedure" } }])
  })

  // E10-S01 (AC-a5) : « Télécharger en .md » s'ajoute, et c'est le seul geste du « ⋯ » d'un Contexte.
  it("should offer « Déplacer », « Dupliquer », « Télécharger en .md » and « Supprimer » in the « ⋯ » of a content, no « Renommer », and only the download on a Contexte (AC-b8)", () => {
    const rail = monter()
    fireEvent.click(within(rail).getByRole("button", { name: "Autres actions sur Contexte · Tout le monde" }))
    expect(itemsDuMenu()).toEqual(["Télécharger en .md"])
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" })
    fireEvent.click(within(rail).getByRole("button", { name: "Autres actions sur Conseil" }))

    expect(itemsDuMenu()).toEqual(["Déplacer", "Dupliquer", "Télécharger en .md", "Supprimer"])
  })
})

describe("RailApplication, files (E10-S01, AC-a3, AC-a5, AC-b1, AC-b6)", () => {
  it("should download a table as .csv from its « ⋯ », by GET tables/export, and say a refusal", async () => {
    const appels = simulerLAPI({ data: { filename: "grille.csv", content: "nom\r\n" } }, { error: { code: "not_found", message: "Unknown path." } })
    const creer = vi.fn(() => "blob:fichier")
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: creer, revokeObjectURL: vi.fn() }))
    const clic = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined)
    const rail = monter()
    fireEvent.click(within(rail).getByRole("button", { name: "Autres actions sur Grille tarifaire" }))
    fireEvent.click(menu().getByRole("menuitem", { name: "Télécharger en .csv" }))
    await waitFor(() => expect(clic).toHaveBeenCalledTimes(1))
    expect(appels).toEqual([{ url: "/api/platform/tables/export?path=conseil%2Fgrille", methode: "GET", corps: undefined }])
    expect(creer).toHaveBeenCalledWith(expect.objectContaining({ type: "text/csv;charset=utf-8" }))

    fireEvent.click(within(rail).getByRole("button", { name: "Autres actions sur Contexte · Tout le monde" }))
    fireEvent.click(menu().getByRole("menuitem", { name: "Télécharger en .md" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Ce contenu n'est plus visible.")
    expect(appels[1].url).toMatch(/^\/api\/platform\/nodes\/export\?path=/)
  })

  it("should open the import dialog from « Importer un fichier… » of a « + », and from a file dropped on a line", async () => {
    const rail = monter()
    fireEvent.click(within(rail).getByRole("button", { name: "Ajouter dans Conseil" }))
    fireEvent.click(menu().getByRole("menuitem", { name: "Importer un fichier…" }))
    expect(screen.getByRole("dialog", { name: "Importer un fichier" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Annuler" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())

    const ligne = within(rail).getByRole("link", { name: "Conseil" })
    const fichier = new File(["a;b\n1;2"], "notes.txt")
    const transfert = { types: ["Files"], files: [fichier], dropEffect: "none" }
    expect(fireEvent.dragOver(ligne, { dataTransfer: transfert })).toBe(false)
    fireEvent.drop(ligne, { dataTransfer: transfert })
    expect(screen.getByRole("dialog", { name: "Importer un fichier" })).toBeInTheDocument()
  })
})

describe("RailApplication keyboard (AC-x3)", () => {
  it("should open a menu with ↓, name its highlighted line, choose with Entrée, and give the focus back to its trigger after a choice as on Échap", () => {
    const rail = monter()
    const compte = within(rail).getByRole("button", { name: "Compte : Claire Morel. Ouvrir le menu" })
    fireEvent.keyDown(compte, { key: "ArrowDown" })
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" })
    expect(compte).toHaveFocus()
    expect(screen.queryByRole("menu")).toBeNull()

    fireEvent.keyDown(compte, { key: "ArrowDown" })
    const ouvert = screen.getByRole("menu")
    expect(ouvert).toHaveFocus()
    fireEvent.keyDown(ouvert, { key: "ArrowDown" })
    expect(ouvert).toHaveAttribute("aria-activedescendant", within(ouvert).getByRole("menuitem", { name: "Profil" }).id)
    fireEvent.keyDown(ouvert, { key: "Enter" })
    expect(hote.naviguer).toHaveBeenCalledWith("/profile")
    // Le menu part avec le focus : il revient au déclencheur, jamais sur la page.
    expect(compte).toHaveFocus()
  })

  it("should create from the keyboard, say a refusal in the rail by the table of messages, and keep the focus on its « + » (AC-b3)", async () => {
    const appels = simulerLAPI(REFUS)
    const rail = monter()
    const plus = within(rail).getByRole("button", { name: "Ajouter dans Conseil" })
    choisirAuClavier(plus)

    // H04 : jamais le texte anglais du service ; aucune page ouverte, rien de relu.
    expect(await within(rail).findByRole("alert")).toHaveTextContent("Vous n'avez pas le droit de faire cela.")
    expect(appels).toEqual([{ url: "/api/platform/nodes", methode: "POST", corps: { path: "conseil/sans_titre", ...NEUF, summary: RESUMES.page, kind: "page" } }])
    expect(plus).toHaveFocus()
    expect(hote.naviguer).not.toHaveBeenCalled()
    expect(hote.rafraichir).not.toHaveBeenCalled()
  })

  it("should take the closed drawer out of the tab order under 768 px, where it is off screen", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: true, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }))

    const tiroir = monter()

    expect(tiroir).toHaveAttribute("aria-hidden", "true")
    // `inert` retire ses liens et ses boutons de la tabulation : le navigateur l'applique, jsdom ne le simule pas.
    expect(tiroir).toHaveAttribute("inert")
  })

  // Fiche D90 B (M39) : le design system n'affiche « Menu » que sous 768 px (contrôle visuel à 375 px).
  it("should open the drawer from « Menu » under 768 px, let Échap close a menu of the drawer first, then the drawer, giving the focus back to « Menu », and close it on navigation", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: true, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
    const tiroir = monter()
    const bouton = screen.getByRole("button", { name: "Menu" })
    expect(bouton).toHaveAttribute("aria-controls", tiroir.id)

    fireEvent.click(bouton)
    expect(bouton).toHaveAttribute("aria-expanded", "true")
    expect(tiroir).toHaveAttribute("data-open")
    expect(tiroir).not.toHaveAttribute("inert")

    const compte = within(tiroir).getByRole("button", { name: "Compte : Claire Morel. Ouvrir le menu" })
    fireEvent.keyDown(compte, { key: "ArrowDown" })
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" })
    expect(screen.queryByRole("menu")).toBeNull()
    expect(tiroir).toHaveAttribute("data-open")

    fireEvent.keyDown(compte, { key: "Escape" })
    expect(tiroir).not.toHaveAttribute("data-open")
    expect(tiroir).toHaveAttribute("inert")
    expect(bouton).toHaveAttribute("aria-expanded", "false")
    expect(bouton).toHaveFocus()
    cleanup()

    // Une ligne du rail choisie : l'hôte donne la nouvelle adresse, le tiroir se referme sur la page.
    const { rerender } = render(railA("/n/conseil/grille"))
    fireEvent.click(screen.getByRole("button", { name: "Menu" }))
    expect(screen.getByRole("navigation")).toHaveAttribute("data-open")
    rerender(railA("/n/ventes/qualifier"))
    expect(screen.getByRole("navigation", { hidden: true })).not.toHaveAttribute("data-open")
  })
})

describe("RailApplication tree (AC-a5, AC-a6)", () => {
  it("should put a procedure in the tree at its node address, draw every line with the host's link, and mark the current one inside its opened branch", () => {
    const rail = monter()

    expect(within(rail).getByRole("link", { name: "Qualifier un prospect" })).toHaveAttribute("href", "/n/ventes/qualifier")
    expect(rail.querySelector('a[href="/procedures"]')).toBeNull()
    const lignes = within(rail).getAllByRole("link")
    expect(lignes.every((ligne) => ligne.getAttribute("data-lien") === "hote")).toBe(true)
    expect(within(rail).getByRole("link", { name: "Grille tarifaire" })).toHaveAttribute("aria-current", "page")
    expect(within(rail).getByRole("button", { name: "Replier Conseil" })).toHaveAttribute("aria-expanded", "true")
    expect(within(rail).getByRole("link", { name: "Conseil" })).not.toHaveAttribute("aria-current")
  })
})

/** Glisse une ligne sur une autre, comme la souris : départ, survol, dépôt ; rend `false` si le survol n'est pas accepté. */
function glisserSur(source: HTMLElement, cible: HTMLElement): boolean {
  const dataTransfer = { setData: vi.fn(), effectAllowed: "", dropEffect: "" }
  fireEvent.dragStart(source, { dataTransfer })
  // `fireEvent` rend `false` quand le gestionnaire a annulé l'évènement : le survol est accepté.
  const accepte = !fireEvent.dragOver(cible, { dataTransfer })
  if (accepte) fireEvent.drop(cible, { dataTransfer })
  fireEvent.dragEnd(source, { dataTransfer })
  return accepte
}

describe("RailApplication, moving from the rail (E05-S10, AC-b7)", () => {
  const lien = (rail: HTMLElement, nom: string) => within(rail).getByRole("link", { name: nom })

  it("should drop a line on another one, read what the move changes first, confirm who gains, loses or changes access, then move it with its sub-contents and open it (b2)", async () => {
    const qui = impact({ lost: [membre("Ada", 1, 0), membre("Léo", 1, 0)], changed: [membre("Claire", 1, 3)], totals: { gained: 0, lost: 5, changed: 1 } })
    const appels = simulerLAPI(qui, { data: { path: "private/claire/notes/grille", moves: [] } })
    const rail = monter()
    expect(lien(rail, "Grille tarifaire")).toHaveAttribute("draggable", "true")
    expect(glisserSur(lien(rail, "Grille tarifaire"), lien(rail, "Notes"))).toBe(true)

    // Ce qui change se dit avant l'envoi, sur l'aperçu du service, avec les mots de « Partager ».
    const dialogue = within(await screen.findByRole("dialog", { name: "Déplacer « Grille tarifaire » ?" }))
    expect(dialogue.getByText("Il quitte Tout le monde pour Privé.")).toBeInTheDocument()
    expect(dialogue.getByText("Perdent l'accès : Ada, Léo et 3 autres.")).toBeInTheDocument()
    expect(dialogue.getByText("Leur accès change : Claire (Peut lire → Accès complet).")).toBeInTheDocument()
    expect(appels).toEqual([{ url: "/api/platform/nodes/impact?path=conseil%2Fgrille&new_path=private%2Fclaire%2Fnotes%2Fgrille", methode: "GET", corps: undefined }])
    fireEvent.click(dialogue.getByRole("button", { name: "Déplacer" }))

    await waitFor(() => expect(hote.naviguer).toHaveBeenCalledWith("/n/private/claire/notes/grille"))
    expect(appels[1]).toEqual({ url: "/api/platform/nodes/move", methode: "POST", corps: { path: "conseil/grille", new_path: "private/claire/notes/grille" } })
    expect(hote.rafraichir).toHaveBeenCalledTimes(1)
  })

  // E05-S12 (AC-26, fiche D110 a) : le dépôt sur la ligne d'un Contexte range sous lui, plus à la racine de son espace.
  it("should move without a question when the preview changes nothing, the Contexte line taking it under the Contexte, and keep it visible and selected under its line", async () => {
    const appels = simulerLAPI(impact({ changes: false }), { data: { path: "contexte/grille", moves: [] } })
    const { rerender } = render(railA("/n/conseil/grille"))
    const rail = () => screen.getByRole("navigation", { hidden: true })
    expect(glisserSur(lien(rail(), "Grille tarifaire"), lien(rail(), "Contexte · Tout le monde"))).toBe(true)

    await waitFor(() => expect(hote.naviguer).toHaveBeenCalledWith("/n/contexte/grille"))
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(appels.map((appel) => appel.url)).toEqual(["/api/platform/nodes/impact?path=conseil%2Fgrille&new_path=contexte%2Fgrille", "/api/platform/nodes/move"])
    expect(appels[1].corps).toEqual({ path: "conseil/grille", new_path: "contexte/grille" })

    // La relecture de l'hôte, à la nouvelle adresse : la ligne déplacée est sous le Contexte, déplié, sélectionnée.
    const sousLeContexte = (un: TreeNode) => (un.path === "contexte" ? { ...un, children: [noeud("contexte/grille", "table", "Grille tarifaire")] } : un)
    const deplace = [noeud("guide", "page", "Guide de Démo", ARBRE[0].children.map((un) => (un.path === "conseil" ? { ...un, children: [] } : sousLeContexte(un))))]
    rerender(railA("/n/contexte/grille", { arbre: { data: { tree: deplace, truncated: false } } }))
    expect(lien(rail(), "Grille tarifaire")).toHaveAttribute("aria-current", "page")
    expect(within(rail()).getByRole("button", { name: "Replier Contexte · Tout le monde" })).toHaveAttribute("aria-expanded", "true")
  })

  it("should refuse a drop on the line itself, under it, or on its own parent, and never drag a Contexte", () => {
    const appels = simulerLAPI()
    const rail = monter()
    expect(glisserSur(lien(rail, "Conseil"), lien(rail, "Grille tarifaire"))).toBe(false)
    expect(glisserSur(lien(rail, "Conseil"), lien(rail, "Conseil"))).toBe(false)
    expect(glisserSur(lien(rail, "Grille tarifaire"), lien(rail, "Conseil"))).toBe(false)
    expect(lien(rail, "Contexte · Ventes")).not.toHaveAttribute("draggable", "true")
    expect(glisserSur(lien(rail, "Contexte · Ventes"), lien(rail, "Notes"))).toBe(false)
    expect(appels).toEqual([])
  })

  it("should say a refusal of the preview or of the move in the rail, move nothing and send nothing more on « Annuler » of the confirmation", async () => {
    const appels = simulerLAPI(impact({ lost: [membre("Ada", 1, 0)], totals: { gained: 0, lost: 1, changed: 0 } }), impact({ changes: false }), REFUS, {
      error: { code: "not_found", message: "Cannot move conseil/grille to private/claire/notes/grille: private/claire/notes does not exist." },
    })
    const rail = monter()
    glisserSur(lien(rail, "Grille tarifaire"), lien(rail, "Notes"))
    fireEvent.click(within(await screen.findByRole("dialog", { name: "Déplacer « Grille tarifaire » ?" })).getByRole("button", { name: "Annuler" }))
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(appels).toHaveLength(1)

    glisserSur(lien(rail, "Grille tarifaire"), lien(rail, "Contexte · Tout le monde"))
    expect(await within(rail).findByRole("alert")).toHaveTextContent("Ce déplacement vous est refusé : il faut la gestion de la page et l'écriture sous le nouveau parent.")
    expect(hote.naviguer).not.toHaveBeenCalled()

    // L'aperçu refusé : la destination n'est plus visible, rien ne part, le rail se relit.
    glisserSur(lien(rail, "Grille tarifaire"), lien(rail, "Notes"))
    await waitFor(() => expect(within(rail).getByRole("alert")).toHaveTextContent("Ce contenu ou sa destination n'est plus visible."))
    expect(appels.map((appel) => appel.url.split("?")[0])).toEqual(["/api/platform/nodes/impact", "/api/platform/nodes/impact", "/api/platform/nodes/move", "/api/platform/nodes/impact"])
    expect(hote.rafraichir).toHaveBeenCalledTimes(1)
  })

  it("should offer « Déplacer » in the « ⋯ » of a line, towards the choice of the header's « Déplacer », confirmed on the preview", async () => {
    const appels = simulerLAPI(impact({ gained: [membre("Bob", 0, 2)], totals: { gained: 1, lost: 0, changed: 0 } }), { data: { path: "ventes/conseil", moves: [] } })
    const rail = monter()
    choisirAuClavier(within(rail).getByRole("button", { name: "Autres actions sur Conseil" }), 0)

    const choix = within(screen.getByRole("dialog", { name: "Déplacer « Conseil »" }))
    choisirDansLaListe(choix.getByRole("combobox", { name: "Nouveau parent" }), "Ventes (ventes)")
    expect(choix.getByText("Nouveau chemin : ventes/conseil")).toBeInTheDocument()
    expect(choix.getByText("Sa sous-page suit.")).toBeInTheDocument()
    fireEvent.click(choix.getByRole("button", { name: "Déplacer ici" }))

    const confirmation = within(await screen.findByRole("dialog", { name: "Déplacer « Conseil » ?" }))
    expect(confirmation.getByText("Il quitte Tout le monde pour Ventes.")).toBeInTheDocument()
    expect(confirmation.getByText("Gagnent l'accès : Bob (Peut modifier).")).toBeInTheDocument()
    expect(confirmation.getByText("Son sous-contenu le suit.")).toBeInTheDocument()
    fireEvent.click(confirmation.getByRole("button", { name: "Déplacer" }))
    await waitFor(() => expect(hote.naviguer).toHaveBeenCalledWith("/n/ventes/conseil"))
    expect(appels[1]).toEqual({ url: "/api/platform/nodes/move", methode: "POST", corps: { path: "conseil", new_path: "ventes/conseil" } })
  })

  it("should say only the owner changes when nobody gains nor loses access", async () => {
    simulerLAPI(impact({}), { data: { path: "private/claire/notes/grille", moves: [] } })
    const rail = monter()
    glisserSur(lien(rail, "Grille tarifaire"), lien(rail, "Notes"))

    const dialogue = within(await screen.findByRole("dialog", { name: "Déplacer « Grille tarifaire » ?" }))
    expect(dialogue.getByText("Personne ne gagne ni ne perd l'accès, mais son propriétaire change : il prend celui de sa nouvelle place.")).toBeInTheDocument()
  })
})

// L'arbre d'un rangement : trois frères dans Tout le monde (Offres, Conseil et ses deux sous-pages, Tarifs), dans
// l'ordre servi, qui n'est pas celui des chemins.
const ORDRE: TreeNode[] = [
  noeud("guide", "page", "Guide de Démo", [
    noeud("contexte", "context", "Contexte de l'organisation"),
    noeud("offres", "page", "Offres"),
    noeud("conseil", "page", "Conseil", [noeud("conseil/grille", "table", "Grille tarifaire"), noeud("conseil/devis", "page", "Devis")]),
    noeud("tarifs", "page", "Tarifs"),
  ]),
]

/** Un survol à cette hauteur d'une ligne de 20 px (0 en haut) : le quart haut range avant, le quart bas après. */
function survoler(evenement: "dragOver" | "drop", cible: HTMLElement, hauteur: number): boolean {
  vi.spyOn(cible, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, top: 0, left: 0, bottom: 20, right: 200, width: 200, height: 20, toJSON: () => ({}) })
  const survol = createEvent[evenement](cible, { dataTransfer: { setData: vi.fn(), effectAllowed: "", dropEffect: "" } })
  // jsdom n'a pas de `DragEvent` : l'évènement créé n'a pas de `clientY`, posé ici comme le navigateur le pose.
  Object.defineProperty(survol, "clientY", { value: hauteur })
  return fireEvent(cible, survol)
}

/** Glisse une ligne entre deux autres, à cette hauteur de la ligne visée ; rend `false` si le survol n'est pas accepté. */
function glisserA(source: HTMLElement, cible: HTMLElement, hauteur: number): boolean {
  fireEvent.dragStart(source, { dataTransfer: { setData: vi.fn(), effectAllowed: "", dropEffect: "" } })
  const accepte = !survoler("dragOver", cible, hauteur)
  if (accepte) survoler("drop", cible, hauteur)
  fireEvent.dragEnd(source)
  return accepte
}

describe("RailApplication, ordering siblings (E05-S10, b2, AC-b9)", () => {
  const rangees = (chemin: string) => railA(chemin, { arbre: { data: { tree: ORDRE, truncated: false } } })
  const lien = (nom: string) => within(screen.getByRole("navigation", { hidden: true })).getByRole("link", { name: nom })

  it("should show where a line would fall between two others, then put it there among its siblings for everyone, without a question", async () => {
    const appels = simulerLAPI({ data: { path: "tarifs", after: null } })
    render(rangees("/"))
    fireEvent.dragStart(lien("Tarifs"), { dataTransfer: { setData: vi.fn(), effectAllowed: "", dropEffect: "" } })
    expect(survoler("dragOver", lien("Offres"), 2)).toBe(false)
    expect(lien("Offres")).toHaveAttribute("data-rang", "avant")
    expect(lien("Offres")).not.toHaveAttribute("data-depot")
    survoler("drop", lien("Offres"), 2)

    await waitFor(() => expect(hote.rafraichir).toHaveBeenCalledTimes(1))
    expect(appels).toEqual([{ url: "/api/platform/nodes/position", methode: "POST", corps: { path: "tarifs", after: null } }])
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(hote.naviguer).not.toHaveBeenCalled()
    expect(screen.getByText("« Tarifs » a changé de place.")).toHaveAttribute("role", "status")
  })

  it("should put a line after a sibling from the bottom quarter, and refuse a drop that leaves it in place", async () => {
    const appels = simulerLAPI({ data: {} })
    render(rangees("/"))
    expect(glisserA(lien("Conseil"), lien("Offres"), 18)).toBe(false)
    expect(glisserA(lien("Conseil"), lien("Tarifs"), 2)).toBe(false)
    expect(glisserA(lien("Offres"), lien("Conseil"), 18)).toBe(true)

    await waitFor(() => expect(appels).toHaveLength(1))
    expect(appels[0].corps).toEqual({ path: "offres", after: "conseil" })
  })

  it("should drop into an unfolded branch from its bottom quarter, its children following it on screen", () => {
    simulerLAPI()
    render(rangees("/n/conseil/devis"))
    fireEvent.dragStart(lien("Tarifs"), { dataTransfer: { setData: vi.fn(), effectAllowed: "", dropEffect: "" } })
    expect(survoler("dragOver", lien("Conseil"), 18)).toBe(false)
    expect(lien("Conseil")).toHaveAttribute("data-depot")
    expect(lien("Conseil")).not.toHaveAttribute("data-rang")
  })

  it("should move a line dropped between the lines of another parent first, on the preview, then put it at that place and open it", async () => {
    // `devis` est pris à la racine (fiche D125) : le service pose le nœud au premier chemin libre, que le rail range et ouvre.
    const appels = simulerLAPI(impact({ changes: false }), { data: { path: "devis_2", moves: [] } }, { data: {} })
    render(rangees("/n/conseil/devis"))
    expect(glisserA(lien("Devis"), lien("Tarifs"), 2)).toBe(true)

    await waitFor(() => expect(hote.naviguer).toHaveBeenCalledWith("/n/devis_2"))
    expect(appels.map((appel) => [appel.url.split("?")[0], appel.corps])).toEqual([
      ["/api/platform/nodes/impact", undefined],
      ["/api/platform/nodes/move", { path: "conseil/devis", new_path: "devis" }],
      ["/api/platform/nodes/position", { path: "devis_2", after: "conseil" }],
    ])
  })

  it("should say « Rangement… » while a step is sent, then keep the focus on the « ⋯ » of the line moved once the tree is re-read", async () => {
    let repondre = () => {}
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            repondre = () => resolve(new Response(JSON.stringify({ data: {} }), { status: 200, headers: { "content-type": "application/json" } }))
          }),
      ),
    )
    const { rerender } = render(rangees("/"))
    choisirAuClavier(screen.getByRole("button", { name: "Autres actions sur Offres" }), 1)
    expect(await screen.findByText("Rangement…")).toHaveAttribute("role", "status")
    repondre()
    await waitFor(() => expect(hote.rafraichir).toHaveBeenCalledTimes(1))

    // Le navigateur ôte le focus d'une ligne que React déplace dans la liste (jsdom le garde) : ôté ici avant la relecture.
    const [racine] = ORDRE
    const [contexte, offres, conseil, tarifs] = racine.children
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Autres actions sur Offres" }))
    ;(document.activeElement as HTMLElement).blur()
    rerender(railA("/", { arbre: { data: { tree: [{ ...racine, children: [contexte, conseil, offres, tarifs] }], truncated: false } } }))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Autres actions sur Offres" })))
  })

  it("should offer « Monter » and « Descendre » in the « ⋯ » when a sibling is on that side, and say a refusal", async () => {
    const appels = simulerLAPI({ data: {} }, { error: { code: "forbidden", message: "Only a manager of tarifs can order it." } })
    render(rangees("/"))
    fireEvent.click(screen.getByRole("button", { name: "Autres actions sur Offres" }))
    expect(itemsDuMenu()).toEqual(["Déplacer", "Descendre", "Dupliquer", "Télécharger en .md", "Supprimer"])
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" })

    choisirAuClavier(screen.getByRole("button", { name: "Autres actions sur Conseil" }), 1)
    await waitFor(() => expect(appels).toHaveLength(1))
    expect(appels[0].corps).toEqual({ path: "conseil", after: null })

    fireEvent.click(screen.getByRole("button", { name: "Autres actions sur Tarifs" }))
    expect(itemsDuMenu()).toEqual(["Déplacer", "Monter", "Dupliquer", "Télécharger en .md", "Supprimer"])
    fireEvent.click(menu().getByRole("menuitem", { name: "Monter" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Ranger ce contenu vous est refusé : il faut sa gestion.")
    expect(appels[1].corps).toEqual({ path: "tarifs", after: "offres" })
  })
})

describe("RailApplication, duplicating and deleting (E05-S10, b2, AC-b10, AC-b11)", () => {
  const lien = (nom: string) => within(screen.getByRole("navigation", { hidden: true })).getByRole("link", { name: nom })

  it("should duplicate a content through the duplicate service, then open the copy, selected in the rail", async () => {
    const appels = simulerLAPI({ data: { path: "conseil_copie", from: "conseil", count: 2 } })
    const { rerender } = render(railA("/n/conseil/grille"))
    fireEvent.click(screen.getByRole("button", { name: "Autres actions sur Conseil" }))
    fireEvent.click(menu().getByRole("menuitem", { name: "Dupliquer" }))

    await waitFor(() => expect(hote.naviguer).toHaveBeenCalledWith("/n/conseil_copie"))
    expect(hote.rafraichir).toHaveBeenCalledTimes(1)
    expect(appels).toEqual([{ url: "/api/platform/nodes/duplicate", methode: "POST", corps: { path: "conseil" } }])
    const avecLaCopie = [noeud("guide", "page", "Guide de Démo", [...ARBRE[0].children, noeud("conseil_copie", "page", "Conseil (copie)")])]
    rerender(railA("/n/conseil_copie", { arbre: { data: { tree: avecLaCopie, truncated: false } } }))
    expect(lien("Conseil (copie)")).toHaveAttribute("aria-current", "page")
  })

  it("should say a refused duplication in the rail and open nothing", async () => {
    simulerLAPI(REFUS)
    render(railA("/"))
    fireEvent.click(screen.getByRole("button", { name: "Autres actions sur Conseil" }))
    fireEvent.click(menu().getByRole("menuitem", { name: "Dupliquer" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("Dupliquer ce contenu vous est refusé : il faut le lire et pouvoir écrire sous son parent.")
    expect(hote.naviguer).not.toHaveBeenCalled()
  })

  it("should ask before deleting, saying how many sub-contents go with it, send nothing on « Annuler », then put it in the bin, open its parent and focus the line before it", async () => {
    const appels = simulerLAPI({ data: { path: "conseil", count: 2 } })
    render(railA("/n/conseil/grille"))
    fireEvent.click(screen.getByRole("button", { name: "Autres actions sur Conseil" }))
    fireEvent.click(menu().getByRole("menuitem", { name: "Supprimer" }))
    const question = within(screen.getByRole("dialog", { name: "Supprimer « Conseil » ?" }))
    expect(question.getByText("Son sous-contenu part avec lui.")).toBeInTheDocument()
    fireEvent.click(question.getByRole("button", { name: "Annuler" }))
    expect(appels).toEqual([])

    fireEvent.click(screen.getByRole("button", { name: "Autres actions sur Conseil" }))
    fireEvent.click(menu().getByRole("menuitem", { name: "Supprimer" }))
    fireEvent.click(within(screen.getByRole("dialog", { name: "Supprimer « Conseil » ?" })).getByRole("button", { name: "Supprimer" }))

    // La page ouverte (sa grille) partie avec lui : le parent s'ouvre, la racine menant au Contexte.
    await waitFor(() => expect(hote.naviguer).toHaveBeenCalledWith("/n/guide"))
    expect(appels).toEqual([{ url: "/api/platform/trash", methode: "POST", corps: { path: "conseil" } }])
    expect(hote.rafraichir).toHaveBeenCalledTimes(1)
    expect(screen.getByText("« Conseil » est à la corbeille.")).toHaveAttribute("role", "status")
    await waitFor(() => expect(lien("Contexte · Tout le monde")).toHaveFocus())
  })

  // Le chemin vers la corbeille, depuis le menu du compte (E05-S11, AC-e22) : `RailApplication menus`.
  it("should say a refused deletion in the rail and open nothing", async () => {
    simulerLAPI({ error: { code: "conflict", message: "A content was put under conseil meanwhile." } })
    render(railA("/trash"))
    fireEvent.click(screen.getByRole("button", { name: "Autres actions sur Conseil" }))
    fireEvent.click(menu().getByRole("menuitem", { name: "Supprimer" }))
    fireEvent.click(within(screen.getByRole("dialog", { name: "Supprimer « Conseil » ?" })).getByRole("button", { name: "Supprimer" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("Un contenu vient d'être rangé dessous : rien n'est parti. Réessayez.")
    expect(hote.naviguer).not.toHaveBeenCalled()
  })
})

describe("RailApplication, unfolding on click (E05-S10, AC-b2)", () => {
  it("should open and unfold a node with sub-nodes on a click on its name, keep what was unfolded, and unfold the ancestors of a page opened elsewhere", () => {
    const { rerender } = render(railA("/"))
    const rail = () => screen.getByRole("navigation", { hidden: true })
    expect(within(rail()).getByRole("button", { name: "Déplier Conseil" })).toHaveAttribute("aria-expanded", "false")
    expect(within(rail()).queryByRole("link", { name: "Grille tarifaire" })).toBeNull()

    const conseil = within(rail()).getByRole("link", { name: "Conseil" })
    // jsdom ne navigue pas : l'ancre du test n'a pas à le tenter, c'est l'hôte qui navigue.
    conseil.addEventListener("click", (evenement) => evenement.preventDefault())
    fireEvent.click(conseil)
    expect(within(rail()).getByRole("button", { name: "Replier Conseil" })).toHaveAttribute("aria-expanded", "true")
    expect(within(rail()).getByRole("link", { name: "Grille tarifaire" })).toBeInTheDocument()
    // L'hôte navigue, puis rend la nouvelle adresse : la branche reste ouverte.
    rerender(railA("/n/conseil"))
    expect(within(rail()).getByRole("button", { name: "Replier Conseil" })).toHaveAttribute("aria-expanded", "true")

    // Le chevron garde son geste.
    fireEvent.click(within(rail()).getByRole("button", { name: "Replier Conseil" }))
    expect(within(rail()).getByRole("button", { name: "Déplier Conseil" })).toHaveAttribute("aria-expanded", "false")
    // Une page ouverte d'ailleurs (le fil, la palette) : ses ancêtres se déplient.
    rerender(railA("/n/conseil/grille"))
    expect(within(rail()).getByRole("button", { name: "Replier Conseil" })).toHaveAttribute("aria-expanded", "true")
    expect(within(rail()).getByRole("link", { name: "Grille tarifaire" })).toHaveAttribute("aria-current", "page")
  })
})

// E05-S12, lot D (fiche D110 a) : un Contexte reçoit des contenus comme une page. L'arbre : le Contexte de Tout le
// monde porte une page et une procédure, dans l'ordre servi ; Conseil est à côté.
const SOUS_CONTEXTE: TreeNode[] = [
  noeud("guide", "page", "Guide de Démo", [
    noeud("contexte", "context", "Contexte de l'organisation", [noeud("contexte/tarifs", "page", "Tarifs"), noeud("contexte/relance", "procedure", "Relancer les devis")]),
    noeud("conseil", "page", "Conseil"),
  ]),
]

describe("RailApplication, contents under a Contexte (E05-S12, AC-25 to AC-27)", () => {
  const rail = () => screen.getByRole("navigation", { hidden: true })
  const lien = (nom: string) => within(rail()).getByRole("link", { name: nom })
  const sousContexte = (chemin: string) => railA(chemin, { arbre: { data: { tree: SOUS_CONTEXTE, truncated: false } } })

  it.each([
    ["Contexte · Tout le monde", "contexte/sans_titre"],
    ["Contexte · Ventes", "ventes/contexte/sans_titre"],
    ["Contexte · Privé", "private/claire/contexte/sans_titre"],
  ])("should create a page, a table or a procedure under the Contexte from the « + » of « %s », open it and show it under that line (AC-25)", async (ligne, chemin) => {
    const appels = simulerLAPI({ data: { path: chemin } })
    const { rerender } = render(railA("/n/conseil/grille"))
    fireEvent.click(within(rail()).getByRole("button", { name: `Ajouter dans ${ligne}` }))
    expect(menu().getByText(`Dans ${ligne}`)).toBeInTheDocument()
    expect(itemsDuMenu()).toEqual(["Une page", "Un tableau", "Une procédure", "Importer un fichier…"])
    fireEvent.click(menu().getByRole("menuitem", { name: "Une procédure" }))

    await waitFor(() => expect(hote.naviguer).toHaveBeenCalledWith(`/n/${chemin}`))
    expect(appels).toEqual([{ url: "/api/platform/nodes", methode: "POST", corps: { path: chemin, ...NEUF, summary: RESUMES.procedure, kind: "procedure" } }])
    // L'hôte ouvre la page créée, pas encore relue : sa ligne est sous celle du Contexte, dépliée.
    rerender(railA(`/n/${chemin}`))
    const pli = within(rail()).getByRole("button", { name: `Replier ${ligne}` })
    expect(document.getElementById(pli.getAttribute("aria-controls") ?? "")).toContainElement(lien("Sans titre"))
    expect(lien("Sans titre")).toHaveAttribute("aria-current", "page")
  })

  it("should ask on the preview before putting a line dropped on a Contexte under it, the whole line receiving it, and refuse a line already under it (AC-26)", async () => {
    const appels = simulerLAPI(impact({ gained: [membre("Bob", 0, 1)], totals: { gained: 1, lost: 0, changed: 0 } }), { data: { path: "ventes/contexte/notes", moves: [] } })
    render(railA("/n/conseil/grille"))
    // Le haut de la ligne d'un Contexte reçoit dedans : rien ne se range avant lui, il reste en tête.
    fireEvent.dragStart(lien("Notes"), { dataTransfer: { setData: vi.fn(), effectAllowed: "", dropEffect: "" } })
    expect(survoler("dragOver", lien("Contexte · Ventes"), 2)).toBe(false)
    expect(lien("Contexte · Ventes")).toHaveAttribute("data-depot")
    expect(lien("Contexte · Ventes")).not.toHaveAttribute("data-rang")
    survoler("drop", lien("Contexte · Ventes"), 2)

    const dialogue = within(await screen.findByRole("dialog", { name: "Déplacer « Notes » ?" }))
    expect(dialogue.getByText("Il quitte Privé pour Ventes.")).toBeInTheDocument()
    expect(appels[0].url).toBe("/api/platform/nodes/impact?path=private%2Fclaire%2Fnotes&new_path=ventes%2Fcontexte%2Fnotes")
    fireEvent.click(dialogue.getByRole("button", { name: "Déplacer" }))
    await waitFor(() => expect(hote.naviguer).toHaveBeenCalledWith("/n/ventes/contexte/notes"))
    expect(appels[1]).toEqual({ url: "/api/platform/nodes/move", methode: "POST", corps: { path: "private/claire/notes", new_path: "ventes/contexte/notes" } })
    cleanup()

    simulerLAPI()
    render(sousContexte("/n/contexte/tarifs"))
    expect(glisserSur(lien("Tarifs"), lien("Contexte · Tout le monde"))).toBe(false)
  })

  it("should show the children of a Contexte under its line, unfolded when the open screen is under it, foldable like a page's (AC-27)", () => {
    render(sousContexte("/n/contexte/relance"))
    const pli = within(rail()).getByRole("button", { name: "Replier Contexte · Tout le monde" })
    expect(pli).toHaveAttribute("aria-expanded", "true")
    const enfants = document.getElementById(pli.getAttribute("aria-controls") ?? "")
    expect(enfants).toContainElement(lien("Tarifs"))
    expect(enfants).toContainElement(lien("Relancer les devis"))
    expect(enfants).not.toContainElement(lien("Conseil"))

    fireEvent.click(pli)
    expect(within(rail()).getByRole("button", { name: "Déplier Contexte · Tout le monde" })).toHaveAttribute("aria-expanded", "false")
    expect(within(rail()).queryByRole("link", { name: "Tarifs" })).toBeNull()
  })

  it("should order the children of a Contexte from the « ⋯ », « Monter » off for the first one, and move a line under a Contexte from « Déplacer » (AC-27)", async () => {
    const appels = simulerLAPI({ data: {} }, impact({ changes: false }), { data: { path: "contexte/conseil", moves: [] } })
    render(sousContexte("/n/contexte/relance"))
    fireEvent.click(within(rail()).getByRole("button", { name: "Autres actions sur Tarifs" }))
    expect(itemsDuMenu()).toEqual(["Déplacer", "Descendre", "Dupliquer", "Télécharger en .md", "Supprimer"])
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" })

    choisirAuClavier(within(rail()).getByRole("button", { name: "Autres actions sur Relancer les devis" }), 1)
    await waitFor(() => expect(appels).toHaveLength(1))
    expect(appels[0]).toEqual({ url: "/api/platform/nodes/position", methode: "POST", corps: { path: "contexte/relance", after: null } })

    choisirAuClavier(within(rail()).getByRole("button", { name: "Autres actions sur Conseil" }), 0)
    const choix = within(screen.getByRole("dialog", { name: "Déplacer « Conseil »" }))
    choisirDansLaListe(choix.getByRole("combobox", { name: "Nouveau parent" }), "Contexte (contexte)")
    expect(choix.getByText("Nouveau chemin : contexte/conseil")).toBeInTheDocument()
    fireEvent.click(choix.getByRole("button", { name: "Déplacer ici" }))
    await waitFor(() => expect(hote.naviguer).toHaveBeenCalledWith("/n/contexte/conseil"))
    expect(appels[2]).toEqual({ url: "/api/platform/nodes/move", methode: "POST", corps: { path: "conseil", new_path: "contexte/conseil" } })
  })

  it("should give the focus back to the Contexte line once its first child is in the bin (AC-27)", async () => {
    simulerLAPI({ data: { path: "contexte/tarifs", count: 0 } })
    render(sousContexte("/n/contexte/relance"))
    fireEvent.click(within(rail()).getByRole("button", { name: "Autres actions sur Tarifs" }))
    fireEvent.click(menu().getByRole("menuitem", { name: "Supprimer" }))
    fireEvent.click(within(screen.getByRole("dialog", { name: "Supprimer « Tarifs » ?" })).getByRole("button", { name: "Supprimer" }))

    await waitFor(() => expect(lien("Contexte · Tout le monde")).toHaveFocus())
    expect(hote.naviguer).not.toHaveBeenCalled()
  })
})

describe("RailApplication search (AC-a7)", () => {
  it("should open the palette from Rechercher and ⌘K, find a title, then content through the package search, and open the node chosen", async () => {
    // L'extrait tel que la recherche le rend : les mots trouvés entre `**`, parfois long.
    const trouve = { path: "ventes/qualifier", kind: "procedure", title: "Qualifier un prospect", snippet: "Appliquer la **grille** tarifaire à chaque prospect avant le premier rendez-vous" }
    const appels = simulerLAPI({ data: { matches: [trouve], more: 0 } })
    const rail = monter()
    fireEvent.click(within(rail).getByRole("searchbox", { name: "Rechercher" }))
    const palette = within(screen.getByRole("dialog", { name: "Palette de commandes" }))
    fireEvent.click(palette.getByRole("option", { name: "Accueil" }))
    expect(hote.naviguer).toHaveBeenCalledWith("/")
    await waitFor(() => expect(paletteOuverte()).toBe(false))

    fireEvent.keyDown(window, { key: "k", ctrlKey: true })
    const rouverte = within(screen.getByRole("dialog", { name: "Palette de commandes" }))
    fireEvent.change(rouverte.getByRole("combobox"), { target: { value: "grille" } })
    expect(within(rouverte.getByRole("group", { name: "Tableaux" })).getByRole("option", { name: "Grille tarifaire" })).toBeInTheDocument()

    const dansLeContenu = await rouverte.findByRole("group", { name: "Dans le contenu" })
    expect(appels).toEqual([{ url: "/api/platform/search?q=grille", methode: "GET", corps: undefined }])
    // Le titre reste lisible : l'extrait, sans marques, est coupé court en fin de ligne.
    expect(within(dansLeContenu).getByText("Appliquer la grille tarifaire à chaque prospect…")).toBeInTheDocument()
    fireEvent.click(within(dansLeContenu).getByRole("option", { name: /Qualifier un prospect/ }))
    expect(hote.naviguer).toHaveBeenLastCalledWith("/n/ventes/qualifier")
  })
})

describe("RailApplication, the tree kept up to date (E11-S20)", () => {
  const rail = () => screen.getByRole("navigation", { hidden: true })
  const lien = (nom: string) => within(rail()).queryByRole("link", { name: nom })
  const titre = (tree: TreeNode[], chemin: string, nouveau: string): TreeNode[] =>
    tree.map((lu) => ({ ...lu, title: lu.path === chemin ? nouveau : lu.title, children: titre(lu.children, chemin, nouveau) }))
  // « Conseil » renommé par un assistant, dans un autre onglet.
  const RELU = titre(ARBRE, "conseil", "Conseil et devis")
  const NON_ACTUALISE = "L'arbre n'a pas pu être actualisé."
  let horloge: { maintenant: number; restaurer: () => void } | null = null

  /** L'heure du rail, avancée à la main (le délai de 5 s d'AC-4), et l'onglet visible ou caché. */
  function arreterLHorloge(visible: { etat: DocumentVisibilityState }) {
    const now = vi.spyOn(Date, "now").mockImplementation(() => horloge?.maintenant ?? 0)
    const visibilite = vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visible.etat)
    horloge = {
      maintenant: 1_000_000,
      restaurer: () => {
        now.mockRestore()
        visibilite.mockRestore()
      },
    }
    return horloge
  }

  afterEach(() => {
    horloge?.restaurer()
    horloge = null
  })

  it("should re-read its tree when the address changes and show it in place, the tree shown meanwhile, a folded section staying folded (AC-3)", async () => {
    simulerLAPI()
    relectures.reponses.push(arbreRelu(RELU))
    const { rerender } = render(railA("/n/conseil/grille"))
    fireEvent.click(within(rail()).getByRole("button", { name: "Replier Ventes" }))
    expect(relectures.nombre).toBe(0)

    rerender(railA("/n/conseil"))
    expect(lien("Conseil")).toBeInTheDocument()
    await waitFor(() => expect(lien("Conseil et devis")).toHaveAttribute("aria-current", "page"))
    expect(relectures.nombre).toBe(1)
    expect(within(rail()).getByRole("button", { name: "Déplier Ventes" })).toHaveAttribute("aria-expanded", "false")
  })

  it("should re-read its tree when the tab is visible again or the window takes the focus, 5 s at least after the last read (AC-4)", async () => {
    simulerLAPI()
    relectures.reponses.push(arbreRelu(RELU))
    const onglet: { etat: DocumentVisibilityState } = { etat: "hidden" }
    const temps = arreterLHorloge(onglet)
    render(railA("/n/conseil/grille"))

    // Moins de 5 s après le montage, ou l'onglet caché : rien ne part.
    temps.maintenant += 4_999
    onglet.etat = "visible"
    fireEvent(document, new Event("visibilitychange"))
    fireEvent.focus(window)
    temps.maintenant += 1
    onglet.etat = "hidden"
    fireEvent(document, new Event("visibilitychange"))
    expect(relectures.nombre).toBe(0)

    onglet.etat = "visible"
    fireEvent(document, new Event("visibilitychange"))
    await waitFor(() => expect(lien("Conseil et devis")).toBeInTheDocument())
    // La fenêtre reprend le focus avec l'onglet : moins de 5 s après la relecture, rien ne part.
    fireEvent.focus(window)
    expect(relectures.nombre).toBe(1)
    temps.maintenant += 5_000
    fireEvent.focus(window)
    await waitFor(() => expect(relectures.nombre).toBe(2))
  })

  it("should re-read its tree after a gesture, with the page (AC-5)", async () => {
    const appels = simulerLAPI({ data: { path: "conseil_copie", from: "conseil", count: 2 } })
    relectures.reponses.push(arbreRelu([{ ...ARBRE[0], children: [...ARBRE[0].children, noeud("conseil_copie", "page", "Conseil (copie)")] }]))
    render(railA("/n/conseil/grille"))
    fireEvent.click(screen.getByRole("button", { name: "Autres actions sur Conseil" }))
    fireEvent.click(menu().getByRole("menuitem", { name: "Dupliquer" }))

    await waitFor(() => expect(lien("Conseil (copie)")).toBeInTheDocument())
    expect(hote.rafraichir).toHaveBeenCalledTimes(1)
    expect(relectures.nombre).toBe(1)
    expect(appels).toEqual([{ url: "/api/platform/nodes/duplicate", methode: "POST", corps: { path: "conseil" } }])
  })

  it("should keep the tree shown when a re-read fails, without an alert, say it quietly after three failures in a row, and drop it on success (AC-6)", async () => {
    simulerLAPI()
    // Une réponse sans arbre compte comme un échec, comme une panne.
    relectures.reponses.push(PANNE, { data: {} })
    const { rerender } = render(railA("/n/conseil/grille"))
    rerender(railA("/n/conseil"))
    await waitFor(() => expect(relectures.nombre).toBe(1))
    rerender(railA("/n/conseil/grille"))
    await waitFor(() => expect(relectures.nombre).toBe(2))
    expect(lien("Conseil")).toBeInTheDocument()
    expect(within(rail()).queryByText(NON_ACTUALISE)).toBeNull()

    rerender(railA("/n/conseil"))
    // Dit par une région de statut montée vide : annoncé sans alerte (`accessibility-patterns.md § Régions dynamiques`).
    expect(await within(rail()).findByText(NON_ACTUALISE)).toHaveAttribute("role", "status")
    expect(lien("Conseil")).toBeInTheDocument()
    expect(within(rail()).queryByRole("alert")).toBeNull()

    relectures.reponses.push(arbreRelu(RELU))
    rerender(railA("/n/conseil/grille"))
    await waitFor(() => expect(lien("Conseil et devis")).toBeInTheDocument())
    expect(within(rail()).queryByText(NON_ACTUALISE)).toBeNull()
  })

  it("should send one re-read at a time, and a single one after it whatever was asked meanwhile (AC-7)", async () => {
    const enAttente: ((reponse: Response) => void)[] = []
    const lire = vi.fn(() => new Promise<Response>((resolve) => enAttente.push(resolve)))
    vi.stubGlobal("fetch", lire)
    const { rerender } = render(railA("/n/conseil/grille"))
    rerender(railA("/n/conseil"))
    rerender(railA("/n/guide"))
    rerender(railA("/n/contexte"))
    expect(lire).toHaveBeenCalledTimes(1)

    enAttente[0](repondre(PANNE))
    await waitFor(() => expect(lire).toHaveBeenCalledTimes(2))
    enAttente[1](repondre(arbreRelu(RELU)))
    await waitFor(() => expect(lien("Conseil et devis")).toBeInTheDocument())
    expect(lire).toHaveBeenCalledTimes(2)
  })

  it("should take a tree served again by the layout in place of the one re-read (AC-8)", async () => {
    simulerLAPI()
    relectures.reponses.push(arbreRelu(RELU))
    const { rerender } = render(railA("/n/conseil/grille"))
    rerender(railA("/n/conseil"))
    await waitFor(() => expect(lien("Conseil et devis")).toBeInTheDocument())

    rerender(railA("/n/conseil", { arbre: { data: { tree: titre(ARBRE, "conseil", "Conseil 2027"), truncated: false } } }))
    expect(lien("Conseil 2027")).toBeInTheDocument()
    expect(lien("Conseil et devis")).toBeNull()
  })
})

describe("SectionsDuRail in the sidebar of an ERP (AC-a8)", () => {
  it("should show a single coque, the ERP's, navigate by the ERP's link and create through the package API", async () => {
    const appels = simulerLAPI({ data: { path: "conseil/sans_titre" } })
    render(
      <aside aria-label="Barre de l'ERP">
        <nav aria-label="Menu de l'ERP">
          <a href="/erp/clients">Clients</a>
        </nav>
        <CoquilleOto>
          <ContexteDeRafraichissement.Provider value={hote.rafraichir}>
            <ContexteDeLHote.Provider value={{ Lien: LienDeLHote, chemin: "/erp/plateforme/n/contexte", naviguer: hote.naviguer }}>
              <SectionsDuRail arbre={ARBRE} equipes={EQUIPES} handle="claire" prefixe="/erp/plateforme/n/" />
            </ContexteDeLHote.Provider>
          </ContexteDeRafraichissement.Provider>
        </CoquilleOto>
      </aside>,
    )

    expect(screen.getAllByRole("navigation").map((nav) => nav.getAttribute("aria-label"))).toEqual(["Menu de l'ERP"])
    expect(document.querySelector(".oto-desk, .oto-rail")).toBeNull()
    const contexte = screen.getByRole("link", { name: "Contexte · Tout le monde" })
    expect(contexte).toHaveAttribute("href", "/erp/plateforme/n/contexte")
    expect(contexte).toHaveAttribute("data-lien", "hote")
    expect(contexte).toHaveAttribute("aria-current", "page")

    fireEvent.click(screen.getByRole("button", { name: "Ajouter dans Conseil" }))
    fireEvent.click(menu().getByRole("menuitem", { name: "Une page" }))

    await waitFor(() => expect(hote.naviguer).toHaveBeenCalledWith("/erp/plateforme/n/conseil/sans_titre"))
    expect(appels[0]).toMatchObject({ url: "/api/platform/nodes", methode: "POST", corps: { path: "conseil/sans_titre", kind: "page" } })
    // E11-S20 : l'arbre de l'ERP est le sien ; seul `RailApplication` relit le sien.
    expect(relectures.nombre).toBe(0)
  })
})
