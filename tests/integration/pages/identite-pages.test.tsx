// Les écrans qui dépendent de l'identité par l'adresse (E02-S01, AC25, AC26), services du paquet et
// session de l'hôte simulés : chaque branche de rendu et de redirection. La page de montage du
// formulaire d'invitation d'E02-S01 (AC29) est retirée par E05-S03 : son formulaire vit dans l'onglet
// « Membres » de `/teams` (`tests/integration/components/ecran-equipes.test.tsx`).
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { orgContact, resolveOrg, type Identity, type PlatformDb } from "@otomata_tech/oto_platform/server"
import { useRafraichir } from "@otomata_tech/oto_platform/ui"
import DashboardLayout from "@/app/(dashboard)/layout"
import AucuneOrganisationPage, { metadata as aucuneOrganisationMetadata } from "@/app/no-organization/page"
import { getPlatformIdentitySafely, getPlatformSession, type PlatformSession } from "@/lib/plateforme/session"

vi.mock("@/lib/plateforme/session", () => ({
  getPlatformSession: vi.fn(),
  getPlatformIdentity: vi.fn(),
  getPlatformIdentitySafely: vi.fn(),
}))

vi.mock("@/lib/actions/auth", () => ({ logoutAction: vi.fn() }))

// redirect() lève NEXT_REDIRECT dans Next : le mock lève aussi, le rendu s'arrête comme en production.
// Le rail et le fournisseur de relecture du layout (E05-S03, E05-S09) lisent le routeur, absent ici :
// `refresh` et `push` sont ceux du routeur simulé, que le fournisseur doit appeler.
const { refresh, push } = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }))
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
  usePathname: () => "/",
  useRouter: () => ({ refresh, push }),
}))

// Le rail lit l'arbre et les équipes (E05-S09) : vides ici, sa lecture est prouvée par `rail-application.test.tsx`.
vi.mock("@otomata_tech/oto_platform/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@otomata_tech/oto_platform/server")>()),
  resolveOrg: vi.fn(),
  orgContact: vi.fn(),
  visibleTree: vi.fn(async () => ({ tree: [], truncated: false })),
  listTeams: vi.fn(async () => []),
}))

const ORG = { id: "org-1", slug: "acme", name: "Acme Énergies", prefix: "acm", brand: {}, domains: null }
const LOGO = "https://example.com/logo.png"
const SESSION: PlatformSession = {
  user: { id: "user-1", email: "claire@acme.test" },
  accessToken: "session-token",
  host: "acme.test",
  // Les services qui liraient la base sont simulés : un client vide suffit.
  db: {} as PlatformDb,
}

function identite(role: "admin" | "member" = "member"): Identity {
  return {
    org: ORG,
    user: { id: SESSION.user.id, email: SESSION.user.email, name: "claire" },
    member: { role, profile: {} },
    teams: [],
    isStaff: false,
    viaGrant: false,
    hasOpenGrant: false,
  }
}

const membre = (role: "admin" | "member" = "member") => ({ data: { identity: identite(role), session: SESSION } })

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(cleanup)

/** Ouvre le menu du compte, au pied du rail, et rend ses entrées. */
function menuDuCompte(nom: string): string[] {
  fireEvent.click(screen.getByRole("button", { name: `Compte : ${nom}. Ouvrir le menu` }))
  return within(screen.getByRole("menu")).getAllByRole("menuitem").map((item) => item.textContent ?? "")
}

describe("(dashboard) layout (AC25)", () => {
  it.each(["unknown_org", "not_member"] as const)("should send %s to /no-organization", async (code) => {
    vi.mocked(getPlatformIdentitySafely).mockResolvedValue({ error: { code } })

    await expect(DashboardLayout({ children: <p>Contenu</p> })).rejects.toThrow("NEXT_REDIRECT:/no-organization")
  })

  it("should keep the rail without the organisation name, and say its tree, when the identity is unavailable", async () => {
    vi.mocked(getPlatformIdentitySafely).mockResolvedValue(null)

    render(await DashboardLayout({ children: <p>Contenu</p> }))

    expect(screen.queryByText("Acme Énergies")).toBeNull()
    expect(screen.getByText("Contenu")).toBeInTheDocument()
    expect(screen.getByRole("alert")).toHaveTextContent("L'arbre n'a pas pu être chargé")
    expect(menuDuCompte("Mon compte")).toContain("Déconnexion")
  })
})

/** Une administratrice sous la marque de son organisation et le thème choisi dans son profil (E09-S01, E05-S11). */
function sousLaMarque(brand: Identity["org"]["brand"], profile: Identity["member"]["profile"] = {}) {
  const identity = identite("admin")
  return { data: { identity: { ...identity, org: { ...ORG, brand }, member: { ...identity.member, profile } }, session: SESSION } }
}

// La marque là où la personne la voit (E09-S01, AC3, AC4) ; la marque se règle dans « Organisation »
// depuis E05-S11 (AC-22 : `admin-config-pages.test.tsx`).
describe("(dashboard) layout brand (AC3, AC4)", () => {
  it("should render the content under a single .oto carrying the theme of the organisation", async () => {
    vi.mocked(getPlatformIdentitySafely).mockResolvedValue(sousLaMarque({ theme: "foret" }))

    const { container } = render(await DashboardLayout({ children: <p>Contenu</p> }))

    const racines = container.querySelectorAll<HTMLElement>(".oto")
    expect(racines).toHaveLength(1)
    expect(racines[0]).toHaveAttribute("data-oto-theme", "foret")
    expect(within(racines[0]).getByText("Contenu")).toBeInTheDocument()
  })

  // Depuis E05-S09 (AC-a3), la tête du rail est la pastille d'entreprise d'oto-frontend : le logo, à la
  // place du mark, puis le nom de l'organisation (E05-S13, AC-3 : un ancien nom affiché n'est plus lu).
  it("should open the rail with the logo, then the organisation name", async () => {
    vi.mocked(getPlatformIdentitySafely).mockResolvedValue(sousLaMarque({ logo_url: LOGO, display_name: "Acme Forêt" }))

    render(await DashboardLayout({ children: <p>Contenu</p> }))

    const entreprise = screen.getByRole("button", { name: /^Entreprise : Acme Énergies\./ })
    const logo = entreprise.firstElementChild
    expect(logo?.tagName).toBe("IMG")
    expect(logo).toHaveAttribute("src", LOGO)
    expect(entreprise).toHaveTextContent(/^Acme Énergies$/)
  })

  it("should keep a single .oto, without a theme, when the identity is unavailable", async () => {
    vi.mocked(getPlatformIdentitySafely).mockResolvedValue(null)

    const { container } = render(await DashboardLayout({ children: <p>Contenu</p> }))

    expect(container.querySelectorAll(".oto")).toHaveLength(1)
    expect(container.querySelector(".oto")).not.toHaveAttribute("data-oto-theme")
    expect(container.querySelector("nav img")).toBeNull()
  })

  // E05-S11 (AC-4, AC-6) : la couleur est celle que la personne a choisie dans Profil, sinon celle de son
  // organisation ; un thème enregistré hors des huit ne compte pas. La ligne « Couleur » quitte le rail.
  it.each([
    ["the person's own", { theme: "cobalt" }, "cobalt"],
    ["the organisation's without a choice", {}, "foret"],
    ["the organisation's for a theme out of the eight", { theme: "rose" }, "foret"],
  ])("should colour the whole group with %s theme, and offer no colour line in the rail", async (_nom, profile, attendu) => {
    vi.mocked(getPlatformIdentitySafely).mockResolvedValue(sousLaMarque({ theme: "foret" }, profile))

    const { container } = render(await DashboardLayout({ children: <p>Contenu</p> }))

    const racines = container.querySelectorAll<HTMLElement>(".oto")
    expect(racines).toHaveLength(1)
    expect(racines[0]).toHaveAttribute("data-oto-theme", attendu)
    expect(screen.queryByRole("button", { name: "Couleur du thème" })).toBeNull()
  })

  // E05-S11 (AC-32, AC-6, AC-e22) : les adresses que le layout donne au pied du rail ; le menu de
  // l'entreprise (AC-31, AC-33) : `admin-pages.test.tsx`.
  // E11-S10 (AC-e1) : « Contexte » en tête du menu du compte, à `/context`. Le compte porte le nom de la personne.
  it("should give the rail Connecteurs at its foot, then Contexte, Profil and Corbeille in the account menu", async () => {
    vi.mocked(getPlatformIdentitySafely).mockResolvedValue(sousLaMarque({}))

    render(await DashboardLayout({ children: <p>Contenu</p> }))

    expect(screen.getByRole("link", { name: "Connecteurs" })).toHaveAttribute("href", "/admin/connectors")
    expect(menuDuCompte("claire")).toEqual(["Contexte", "Profil", "Brancher mon Claude, ChatGPT ou Mistral", "Corbeille", "Déconnexion"])
  })
})

// E05-S03, AC3 : le layout monte la navigation et le fournisseur de relecture ; depuis E05-S09 (AC-a2),
// la seule coque est le rail du paquet, qui navigue par le routeur de l'hôte.
describe("(dashboard) layout navigation and re-read (E05-S03, AC3 ; E05-S09, AC-a2)", () => {
  /** Un îlot d'écran qui relit la page après une mutation. */
  function Relire() {
    const rafraichir = useRafraichir()
    return (
      <button type="button" onClick={rafraichir}>
        Relire
      </button>
    )
  }

  it("should mount a single coque, the rail, with the content beside it, « Équipes & accès » opened by the host router", async () => {
    vi.mocked(getPlatformIdentitySafely).mockResolvedValue(membre())

    render(await DashboardLayout({ children: <p>Contenu</p> }))

    expect(screen.getAllByRole("navigation").map((nav) => nav.getAttribute("aria-label"))).toEqual(["Navigation principale"])
    expect(within(screen.getByRole("main")).getByText("Contenu")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /^Entreprise : Acme Énergies/ }))
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Équipes & accès" }))
    expect(push).toHaveBeenCalledWith("/teams")
  })

  it("should have the host router re-read the page when an island of a screen asks for it", async () => {
    vi.mocked(getPlatformIdentitySafely).mockResolvedValue(membre())
    render(await DashboardLayout({ children: <Relire /> }))

    fireEvent.click(screen.getByRole("button", { name: "Relire" }))

    expect(refresh).toHaveBeenCalledTimes(1)
  })
})

describe("/no-organization page (AC26)", () => {
  it("should send a member of the address back to /", async () => {
    vi.mocked(getPlatformSession).mockResolvedValue(SESSION)
    vi.mocked(getPlatformIdentitySafely).mockResolvedValue(membre())

    await expect(AucuneOrganisationPage()).rejects.toThrow(/^NEXT_REDIRECT:\/$/)
  })

  it("should send a visitor without a session to /login", async () => {
    vi.mocked(getPlatformSession).mockResolvedValue(null)

    await expect(AucuneOrganisationPage()).rejects.toThrow("NEXT_REDIRECT:/login")
  })

  it("should name the organisation of the address and its contact for a non-member", async () => {
    vi.mocked(getPlatformSession).mockResolvedValue(SESSION)
    vi.mocked(getPlatformIdentitySafely).mockResolvedValue({ error: { code: "not_member" } })
    vi.mocked(resolveOrg).mockResolvedValue(ORG)
    vi.mocked(orgContact).mockResolvedValue({ name: "Paul Martin", email: "paul@acme.test" })

    render(await AucuneOrganisationPage())

    // Le titre de l'état est le `h2` de l'îlot ; le `h1` est le produit (E05-S07, AC10).
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Vous n'êtes pas membre de Acme Énergies")
    expect(screen.getByText("Pour y entrer, demandez à Paul Martin (paul@acme.test) de vous inviter.")).toBeInTheDocument()
  })

  it("should not be indexed", () => {
    expect(aucuneOrganisationMetadata.robots).toEqual({ index: false })
  })
})
