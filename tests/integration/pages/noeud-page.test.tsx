// La page `/n/[...chemin]` (E05-S02 : AC1, AC6, AC9, AC19, AC22) : la session revérifiée par la page
// (`nextjs-patterns.md § Un layout n'est JAMAIS une frontière d'autorisation`), le chemin lu par
// `nodePathSchema`, les lectures des services avec le client de la session, le refus `not_found`
// traduit en « introuvable » (H68), et la gestion qu'accorde le panneau des règles selon le rôle.
// Session de l'hôte et services du paquet simulés ; l'écran est le vrai. Le panneau « Partager » s'ouvre
// depuis « Partager · <espace> » de l'en-tête (E05-S09, partie c1 ; E05-S10, AC-b5) ; les liens du nœud
// (« Contenus liés », AC-b6) sont lus par `nodeLinks` dès le chemin connu, et arrivent après la page (M58).
import type { ReactNode } from "react"
import { after } from "next/server"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { NodeRulesView, TreeNode } from "@otomata_tech/oto_platform/schemas"
import {
  checkProcedure,
  listMembers,
  listNodeRules,
  listTeams,
  loadNode,
  PlatformError,
  previewContext,
  nodeLinks,
  recordNodeView,
  visibleTree,
  type Identity,
  type PlatformDb,
} from "@otomata_tech/oto_platform/server"
import { ContexteDeLHote } from "@otomata_tech/oto_platform/ui"
import NoeudLoading from "@/app/(dashboard)/n/[...chemin]/loading"
import NoeudPage, { generateMetadata } from "@/app/(dashboard)/n/[...chemin]/page"
import { getPlatformIdentitySafely, type PlatformSession } from "@/lib/plateforme/session"
import { PAGE, vueDuNoeud } from "../../helpers/noeud"
import { libellesDesChoix } from "../../helpers/liste-de-choix"

vi.mock("@/lib/plateforme/session", () => ({ getPlatformIdentitySafely: vi.fn() }))

// redirect() lève NEXT_REDIRECT dans Next : le mock lève aussi, le rendu s'arrête comme en production.
// La vue de la page se compte après la réponse (`after`, 1.4.13) : hors d'une requête de Next, `after` lèverait.
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), after: vi.fn() }))

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
}))

vi.mock("@otomata_tech/oto_platform/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@otomata_tech/oto_platform/server")>()),
  loadNode: vi.fn(),
  visibleTree: vi.fn(),
  listTeams: vi.fn(),
  listMembers: vi.fn(),
  listNodeRules: vi.fn(),
  checkProcedure: vi.fn(),
  previewContext: vi.fn(),
  nodeLinks: vi.fn(),
  recordNodeView: vi.fn(),
}))

const LEA = "0b6f1f0e-1c1a-4a8e-9a51-0d7c1a2b3c02"
const ECHEC = "Une erreur est survenue. Réessayez."

// Les services qui liraient la base sont simulés : un client vide suffit.
const SESSION: PlatformSession = { user: { id: LEA, email: "lea@demo.test" }, accessToken: "session-token", host: "localhost:3000", db: {} as PlatformDb }

function identite(role: "admin" | "member"): Identity {
  return {
    org: { id: "org-1", slug: "demo", name: "Démo", prefix: "demo", brand: {}, domains: null },
    user: { id: LEA, email: SESSION.user.email, name: "Léa Martin" },
    member: { role, profile: { handle: "lea" } },
    teams: [],
    isStaff: false,
    viaGrant: false,
    hasOpenGrant: false,
  }
}

const connecte = (role: "admin" | "member" = "member") => ({ data: { identity: identite(role), session: SESSION } })

const arbre = (path: string, title: string, children: TreeNode[] = [], kind: TreeNode["kind"] = "page"): TreeNode => ({ path, kind, title, status: "published", children })

const ARBRE: TreeNode[] = [
  arbre("guide", "Guide de Démo", [
    arbre("private", "Espaces personnels", [arbre("private/lea", "Perso de Léa", [arbre("private/lea/contexte", "Contexte", [], "context")])]),
    arbre("ventes", "Ventes", [arbre("ventes/modele_relance", "Modèle de relance")]),
  ]),
]

const REGLES: NodeRulesView = {
  path: "ventes/modele_relance",
  title: "Modèle de relance",
  owner: { kind: "team", teamName: "Ventes", leadName: "Léa Martin" },
  viewerLevel: 3,
  rules: [{ id: "5e6f7a8b-9c0d-4e1f-8a2b-000000000011", subject: { kind: "team", id: "t-ventes", name: "Ventes" }, level: "write" }],
}

const page = (segments: string[], parametres: Record<string, string> = {}) =>
  NoeudPage({ params: Promise.resolve({ chemin: segments }), searchParams: Promise.resolve(parametres) })

/** Rend la page ; les liens du nœud, attendus sous leur `<Suspense>` (AC-b6), arrivent dans le même `act`. */
async function monter(element: ReactNode) {
  await act(async () => {
    render(element)
  })
}

/** Le panneau « Partager », ouvert depuis l'accès de l'en-tête, nommé par la section du nœud (AC19, AC-b5). */
function ouvrirLePartage(section = "Ventes") {
  fireEvent.click(screen.getByRole("button", { name: `Partager · ${section}` }))
  return within(screen.getByRole("dialog", { name: `Partager — ${section}` }))
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getPlatformIdentitySafely).mockResolvedValue(connecte())
  vi.mocked(loadNode).mockResolvedValue(vueDuNoeud({ level: 3 }))
  vi.mocked(visibleTree).mockResolvedValue({ tree: ARBRE, truncated: false })
  vi.mocked(listTeams).mockResolvedValue([{ id: "t-ventes", slug: "ventes", name: "Ventes", leadName: "Léa Martin", members: [] }])
  vi.mocked(listMembers).mockResolvedValue([])
  vi.mocked(listNodeRules).mockResolvedValue(REGLES)
  vi.mocked(nodeLinks).mockResolvedValue({ links_out: [], links_out_total: 0, links_in: [], links_in_total: 0 })
  vi.mocked(recordNodeView).mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("/n/[...chemin] page session and addresses (AC1)", () => {
  it("should send a visitor without a session to /login with the way back, reading nothing", async () => {
    vi.mocked(getPlatformIdentitySafely).mockResolvedValue({ error: { code: "unauthenticated" } })
    await expect(page(["ventes", "modele_relance"])).rejects.toThrow("NEXT_REDIRECT:/login?redirect=%2Fn%2Fventes%2Fmodele_relance")
    expect(loadNode).not.toHaveBeenCalled()
  })

  it.each(["unknown_org", "not_member"] as const)("should send %s to /no-organization, reading nothing", async (code) => {
    vi.mocked(getPlatformIdentitySafely).mockResolvedValue({ error: { code } })
    await expect(page(["ventes"])).rejects.toThrow("NEXT_REDIRECT:/no-organization")
    expect(loadNode).not.toHaveBeenCalled()
  })

  it("should send the technical root /n/guide to the Contexte of Tout le monde", async () => {
    await expect(page(["guide"])).rejects.toThrow("NEXT_REDIRECT:/n/contexte")
  })
})

describe("/n/[...chemin] page view (1.4.13)", () => {
  /** Ce que la page a confié à `after`, joué comme Next le jouerait après la réponse. */
  const apresLaReponse = async () => {
    for (const [tache] of vi.mocked(after).mock.calls) if (typeof tache === "function") await tache()
  }

  it("should count the view after the response, by the path asked, with the session client", async () => {
    await monter(await page(["ventes", "modele_relance"]))
    expect(recordNodeView).not.toHaveBeenCalled()
    await apresLaReponse()
    expect(recordNodeView).toHaveBeenCalledWith(SESSION.db, identite("member"), { path: "ventes/modele_relance" })
  })

  it("should keep the page when the view cannot be counted, saying a failure other than an unknown page in the server log", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    vi.mocked(recordNodeView).mockRejectedValueOnce(new PlatformError("not_found", "Unknown path."))
    await monter(await page(["ventes", "modele_relance"]))
    await apresLaReponse()
    expect(log).not.toHaveBeenCalled()
    vi.mocked(after).mockClear()
    cleanup()
    vi.mocked(recordNodeView).mockRejectedValueOnce(new PlatformError("internal", "Database unreachable."))
    await monter(await page(["ventes", "modele_relance"]))
    await apresLaReponse()
    expect(log).toHaveBeenCalledTimes(1)
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Modèle de relance")
  })
})

describe("/n/[...chemin] page reads (AC9, AC19, AC22)", () => {
  it("should read with the session client, range the person's own space under Privé, and give the rules panel to the header", async () => {
    // La navigation du fil passe par l'hôte, que le layout prête (`ContexteDeLHote`).
    const naviguer = vi.fn()
    await monter(<ContexteDeLHote.Provider value={{ Lien: "a", chemin: "", naviguer }}>{await page(["ventes", "modele_relance"])}</ContexteDeLHote.Provider>)

    const lecture = [SESSION.db, identite("member")] as const
    expect(loadNode).toHaveBeenCalledWith(...lecture, { path: "ventes/modele_relance" })
    expect(visibleTree).toHaveBeenCalledWith(...lecture)
    expect(listNodeRules).toHaveBeenCalledWith(...lecture, "ventes/modele_relance")
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Modèle de relance")
    // Le `handle` de l'identité : l'espace de Léa n'est pas un maillon, son Contexte ouvre Privé.
    fireEvent.click(within(screen.getByRole("navigation", { name: "Chemin" })).getByRole("button", { name: "Ventes" }))
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Privé" }))
    expect(naviguer).toHaveBeenCalledWith("/n/private/lea/contexte")
    expect(within(ouvrirLePartage().getByRole("list", { name: "Personnes et équipes ajoutées" })).getByRole("combobox", { name: "Accès de Équipe Ventes" })).toHaveValue("write")
  })

  it("should read the links of the node by nodeLinks, with the page, and fold them in « Cité dans » (E11-S05, AC-e1)", async () => {
    vi.mocked(nodeLinks).mockResolvedValue({ links_out: [], links_out_total: 0, links_in: [{ path: "conseil/guide", title: "Guide du conseil" }], links_in_total: 1 })
    await monter(await page(["ventes", "modele_relance"]))
    expect(nodeLinks).toHaveBeenCalledWith(SESSION.db, identite("member"), { path: "ventes/modele_relance" })
    const titre = await screen.findByText("Cité dans", { selector: "strong" })
    await waitFor(() => expect(titre.closest("summary")).toHaveTextContent("Cité dans1"))
    expect(within(titre.closest("details") ?? document.body).getByRole("link", { name: /^Guide du conseil/ })).toHaveAttribute("href", "/n/conseil/guide")
  })

  it("should show a writer the published version on ?version=published", async () => {
    const draft = { baseRevision: 4, savedAt: "2026-09-24T10:00:00Z", draftStamp: "2026-09-24T10:00:00.000000+00:00", blocks: PAGE, title: null, summary: null, kind: null, meta: null }
    vi.mocked(loadNode).mockResolvedValue(vueDuNoeud({ level: 2, draft }))
    await monter(await page(["ventes", "modele_relance"], { version: "published" }))
    expect(screen.getByText("Version publiée (révision 4).")).toBeInTheDocument()
    // La version publiée se lit : aucun champ de bloc (E05-S08, AC1).
    expect(screen.queryByRole("textbox", { name: /^Modifier / })).toBeNull()
  })

  it("should show the draft on the former French value of version, like any unknown value (E11-S07, AC-b5)", async () => {
    const draft = { baseRevision: 4, savedAt: "2026-09-24T10:00:00Z", draftStamp: "2026-09-24T10:00:00.000000+00:00", blocks: PAGE, title: null, summary: null, kind: null, meta: null }
    vi.mocked(loadNode).mockResolvedValue(vueDuNoeud({ level: 2, draft }))
    await monter(await page(["ventes", "modele_relance"], { version: "publiee" }))
    expect(screen.queryByText("Version publiée (révision 4).")).toBeNull()
  })

  // `gestionAccordable` vient du rôle : réduit à `true`, un responsable non administrateur accorderait l'accès complet.
  it.each([
    ["an administrator", "admin", true],
    ["a team lead who is not an administrator", "member", false],
  ] as const)("should offer « Accès complet » in « Partager » to %s only", async (_cas, role, gestion) => {
    vi.mocked(getPlatformIdentitySafely).mockResolvedValue(connecte(role))
    await monter(await page(["ventes", "modele_relance"]))
    const niveaux = libellesDesChoix(ouvrirLePartage().getByRole("combobox", { name: "Accès de Équipe Ventes" }))
    expect(niveaux.includes("Accès complet")).toBe(gestion)
  })
})

describe("/n/[...chemin] page not found and failures (AC6, AC7)", () => {
  it("should say the same sentence for a malformed path, read without asking the service, and for an unknown one, without « Partager » nor links", async () => {
    await monter(await page(["Ventes"]))
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Page introuvable")
    expect(screen.getByText("Cette page n'existe pas ou ne vous est pas partagée.")).toBeInTheDocument()
    expect(loadNode).not.toHaveBeenCalled()
    cleanup()

    vi.mocked(loadNode).mockRejectedValue(new PlatformError("not_found", "Unknown path ventes/inconnue."))
    vi.mocked(listNodeRules).mockRejectedValue(new PlatformError("not_found", "Unknown path ventes/inconnue."))
    await monter(await page(["ventes", "inconnue"]))
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Page introuvable")
    expect(screen.getByText("Cette page n'existe pas ou ne vous est pas partagée.")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^Partager/ })).toBeNull()
    // Lus avec la page (E05-S10, partie c), les liens d'un nœud introuvable ne se montrent pas.
    expect(screen.queryByText("Cité dans")).toBeNull()
    expect(document.querySelector("details.oto-linked")).toBeNull()
  })

  // Un panneau « Partager » sans ses sujets proposerait un champ vide : la lecture en échec se dit (portage § 4).
  // Les équipes illisibles, la section se dit par son segment : rien n'est deviné.
  it.each([
    ["the rules of the node", "Ventes", () => vi.mocked(listNodeRules).mockRejectedValue(new Error("panne"))],
    ["the teams", "ventes", () => vi.mocked(listTeams).mockRejectedValue(new Error("panne"))],
    ["the members", "Ventes", () => vi.mocked(listMembers).mockRejectedValue(new Error("panne"))],
  ])("should say a failed read of %s in « Partager », with « Réessayer » on the same address", async (_lecture, section, enPanne) => {
    enPanne()
    await monter(await page(["ventes", "modele_relance"], { version: "published" }))
    const repli = ouvrirLePartage(section)
    expect(repli.getByRole("alert")).toHaveTextContent(ECHEC)
    expect(repli.getByRole("link", { name: "Réessayer" })).toHaveAttribute("href", "/n/ventes/modele_relance?version=published")
    expect(repli.queryByRole("combobox")).toBeNull()
  })

  it("should say every read failed, with « Réessayer » on the same address, when the identity cannot be resolved", async () => {
    vi.mocked(getPlatformIdentitySafely).mockResolvedValue(null)
    await monter(await page(["ventes", "modele_relance"]))
    // L'arbre vit dans le rail, que le layout lit et dit en échec de son côté : la page n'a que le nœud.
    expect(screen.getByRole("alert")).toHaveTextContent(`Ce contenu n'a pas pu être chargé${ECHEC}`)
    expect(screen.getByRole("link", { name: "Réessayer" })).toHaveAttribute("href", "/n/ventes/modele_relance")
    expect(loadNode).not.toHaveBeenCalled()
  })

  it("should title the page by its node, not indexed, and show the loading state", async () => {
    expect(await generateMetadata({ params: Promise.resolve({ chemin: ["ventes", "modele_relance"] }) })).toEqual({ title: "Modèle de relance", robots: { index: false } })
    render(<NoeudLoading />)
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Chargement de la page…")
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true")
  })
})

// E05-S04 : ce que la page lit pour un Contexte (aperçu sans phrase), décidé par les services (H123) ; la page
// passe le `handle` (qui reçoit un Contexte Perso). E05-S11 : plus de « Ma fiche » (AC-8), chaque ligne de
// l'encart mène à la vue « Contexte » de l'accueil (AC-11). Une procédure, rien (D104).
describe("/n/[...chemin] page, procedure and Contexte (E05-S04)", () => {
  const PROCEDURE = "ventes/qualifier_prospects"
  const draft = { baseRevision: 4, savedAt: "2026-09-24T10:00:00Z", draftStamp: "2026-09-24T10:00:00.000000+00:00", blocks: [], title: null, summary: null, kind: null, meta: null }
  const APERCU = {
    text: "ctx: XXXX-XXXX",
    blocks: [{ name: "code", chars: 14, status: "full" as const, path: null, head: 0 }],
    budget: 20_000,
    whole: { total: 14, blocks: [{ name: "code", chars: 14 }] },
    served: { path: PROCEDURE, revision: 4, score: 0.82 },
    candidates: [{ path: PROCEDURE, title: "Qualifier les prospects à traiter", kind: "procedure", score: 0.82 }],
  }

  beforeEach(() => {
    vi.mocked(checkProcedure).mockResolvedValue([])
    vi.mocked(previewContext).mockResolvedValue(APERCU)
  })

  // D104 (M59) : une procédure s'affiche comme une page, même pour le rédacteur d'un brouillon ouvert qui
  // demande une phrase, le cas qui lisait le contrôle et l'aperçu : aucune de ces lectures, aucun de ces îlots.
  it("should display a procedure as a page, without the draft control nor the phrase test, reading neither", async () => {
    vi.mocked(loadNode).mockResolvedValue(vueDuNoeud({ path: PROCEDURE, kind: "procedure", level: 2, draft }))
    await monter(await page(["ventes", "qualifier_prospects"], { phrase: "Qualifie les prospects à traiter" }))

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Modèle de relance")
    expect(checkProcedure).not.toHaveBeenCalled()
    expect(previewContext).not.toHaveBeenCalled()
    expect(screen.queryByRole("region", { name: "Contrôle du brouillon" })).toBeNull()
    expect(screen.queryByRole("region", { name: "Tester une phrase" })).toBeNull()
    expect(screen.queryByRole("group", { name: "À quoi sert cette page" })).toBeNull()
  })

  const lea = (): Identity => {
    const base = identite("member")
    return { ...base, member: { ...base.member, profile: { handle: "lea", name: "Léa Martin", language: "en" } } }
  }

  // Le `handle` de l'identité décide qui reçoit un Contexte Perso ; aucun Contexte ne porte plus « Ma fiche » (AC-8).
  it.each([
    ["private/lea/contexte", "Ce que votre assistant lit à chaque conversation ; vous seul le recevez."],
    // Le Contexte Perso d'une autre personne, qui l'a partagé : il n'est servi qu'à elle (HN-E05S04-22).
    ["private/marc/contexte", "Ce que l'assistant de la personne de cet espace lit à chaque conversation ; elle seule le reçoit."],
    ["ventes/contexte", "Ce que votre Claude/ChatGPT/Mistral, comme celui de chaque membre de l'équipe Ventes, lit à chaque conversation."],
  ])("should give the Contexte %s its annexes and what the agent will read, each line leading to the « Contexte » view, without « Ma fiche »", async (chemin, recu) => {
    vi.mocked(getPlatformIdentitySafely).mockResolvedValue({ data: { identity: lea(), session: SESSION } })
    vi.mocked(loadNode).mockResolvedValue(vueDuNoeud({ path: chemin, kind: "context", title: "Contexte", level: 2 }))
    const toutLeMonde = "## Context: everyone (contexte)\nNous vendons."
    vi.mocked(previewContext).mockResolvedValue({
      ...APERCU,
      text: `${APERCU.text}\n\n${toutLeMonde}`,
      blocks: [...APERCU.blocks, { name: "contexte", chars: toutLeMonde.length, status: "full", path: "contexte", head: 0 }],
    })
    await monter(await page(chemin.split("/")))

    expect(previewContext).toHaveBeenCalledWith(SESSION.db, lea(), {})
    const note = within(screen.getByRole("group", { name: "À quoi sert cette page" }))
    // E05-S13 (AC-17) : qui le reçoit, dit en une phrase.
    expect(note.getByText(recu)).toBeInTheDocument()
    const encart = within(screen.getByRole("note", { name: "Voici ce que votre agent va lire" }))
    // E11-S10 (AC-e4, AC-g2) : chaque ligne mène à `/context#<ancre>`, sans « Règles Oto » ; l'ancre garde son rang d'origine.
    expect(encart.getByRole("link", { name: /^Contexte : Tout le monde/ })).toHaveAttribute("href", "/context#everyone-context")
    expect(encart.queryByRole("link", { name: "Règles Oto" })).toBeNull()
    expect(screen.queryByRole("region", { name: "Ma fiche" })).toBeNull()
    // 2026-10-20 : la jauge du budget, tout en bas de la colonne, après l'aperçu et les encarts.
    const jauge = screen.getByText(/^Votre assistant reçoit/)
    expect(screen.getByRole("note", { name: "Voici ce que votre agent va lire" }).compareDocumentPosition(jauge) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(jauge.closest(".oto-budget")?.nextElementSibling).toBeNull()
  })

  // E05-S11 (AC-17) : le titre du document d'un Contexte est celui de son `<h1>`, « Contexte · <section> » ;
  // le titre enregistré (« Contexte ») ne change pas.
  it.each([
    ["contexte", "Contexte · Tout le monde"],
    ["ventes/contexte", "Contexte · Ventes"],
    ["private/lea/contexte", "Contexte · Privé"],
  ])("should title the document of the Contexte %s « %s », not indexed", async (chemin, titre) => {
    vi.mocked(loadNode).mockResolvedValue(vueDuNoeud({ path: chemin, kind: "context", title: "Contexte", level: 2 }))

    expect(await generateMetadata({ params: Promise.resolve({ chemin: chemin.split("/") }) })).toEqual({ title: titre, robots: { index: false } })
  })

  it("should give a page neither annexes, nor a control, nor a phrase test", async () => {
    await monter(await page(["ventes", "modele_relance"], { phrase: "Relance le devis" }))
    expect(screen.queryByRole("group", { name: "À quoi sert cette page" })).toBeNull()
    expect(screen.queryByRole("region", { name: "Tester une phrase" })).toBeNull()
    expect(checkProcedure).not.toHaveBeenCalled()
  })
})
