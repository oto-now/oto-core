// La marque là où la personne la voit (E09-S01) : layout `(dashboard)` (AC3, AC4), page de
// connexion (AC5) ; la marque se règle dans « Organisation » depuis E05-S11 (AC-22 :
// `admin-config-pages.test.tsx`), l'ancienne adresse de la marque répond 404 (E11-S07). Session de l'hôte, en-têtes et services
// du paquet simulés ; `readBrand` reste le vrai. Ce que prouvent déjà les composants et les aides
// (thème par défaut : `server-brand.test.ts` ; première lettre et attributs du logo :
// `logo-d-organisation.test.tsx` ; lecture de la marque en panne, bornée à 1 000 ms, signal
// dynamique : `marque-de-l-adresse.test.ts` ; lien refusé : `login-page.test.tsx` ; état de
// chargement : `ecran-marque.test.tsx`) est retiré d'ici (M11b).
import { Suspense, type ReactNode } from "react"
import { headers } from "next/headers"
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  createAnonPlatformDb,
  PlatformError,
  resolveOrg,
  type Identity,
  type IdentityOrg,
  type PlatformDb,
} from "@otomata_tech/oto_platform/server"
import LoginPage from "@/app/(auth)/login/page"
import DashboardLayout from "@/app/(dashboard)/layout"
import { getPlatformIdentitySafely, type PlatformSession } from "@/lib/plateforme/session"

vi.mock("@/lib/plateforme/session", () => ({ getPlatformIdentitySafely: vi.fn() }))

vi.mock("@/lib/actions/auth", () => ({ loginAction: vi.fn(), logoutAction: vi.fn(), magicLinkAction: vi.fn() }))

// La page lit aussi les fournisseurs activés (E09-S03, `connexion-fournisseurs.test.tsx`) : aucun
// ici, et aucun appel réseau.
vi.mock("@/lib/supabase/fournisseurs", () => ({ fournisseursActives: vi.fn(async () => ({ google: false, azure: false })) }))

vi.mock("next/headers", () => ({ headers: vi.fn() }))

// redirect() lève NEXT_REDIRECT dans Next : le mock lève aussi, le rendu s'arrête comme en production.
// Le fournisseur de relecture du layout (E05-S03) lit le routeur de l'App Router, absent ici.
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
  useRouter: () => ({ refresh: vi.fn() }),
}))

vi.mock("@otomata_tech/oto_platform/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@otomata_tech/oto_platform/server")>()),
  createAnonPlatformDb: vi.fn(),
  resolveOrg: vi.fn(),
  // L'arbre et les équipes du rail du layout (E05-S09) : vides ici.
  visibleTree: vi.fn(async () => ({ tree: [], truncated: false })),
  listTeams: vi.fn(async () => []),
}))

// Les services qui liraient la base sont simulés : un client vide suffit.
const ANON_DB = {} as PlatformDb
const SESSION: PlatformSession = {
  user: { id: "user-1", email: "claire@demo.test" },
  accessToken: "session-token",
  host: "demo.localhost:3000",
  db: {} as PlatformDb,
}
const LOGO = "https://example.com/logo.png"

function org(brand: unknown): IdentityOrg {
  // `brand` est du JSON libre en base : le test y met aussi des valeurs invalides.
  return { id: "org-1", slug: "demo", name: "Démo", prefix: "demo", brand: brand as IdentityOrg["brand"], domains: null }
}

function membre(brand: unknown, profile: Identity["member"]["profile"] = {}) {
  const identity: Identity = {
    org: org(brand),
    user: { id: SESSION.user.id, email: SESSION.user.email, name: "claire" },
    member: { role: "admin", profile },
    teams: [],
    isStaff: false,
    viaGrant: false,
    hasOpenGrant: false,
  }
  return { data: { identity, session: SESSION } }
}

/** Rend un arbre qui contient un Client Component lisant une promesse (`use`). */
async function rendre(arbre: ReactNode) {
  await act(async () => {
    render(<Suspense fallback={null}>{arbre}</Suspense>)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  // `headers()` rend des en-têtes en lecture seule : des `Headers` ordinaires suffisent au rendu.
  vi.mocked(headers).mockResolvedValue(new Headers({ host: "demo.localhost:3000" }) as unknown as Awaited<ReturnType<typeof headers>>)
  vi.mocked(createAnonPlatformDb).mockReturnValue(ANON_DB)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe("(dashboard) layout brand (AC3, AC4)", () => {
  it("should render the content under a single .oto carrying the theme of the organisation", async () => {
    vi.mocked(getPlatformIdentitySafely).mockResolvedValue(membre({ theme: "foret" }))

    const { container } = render(await DashboardLayout({ children: <p>Contenu</p> }))

    const racines = container.querySelectorAll<HTMLElement>(".oto")
    expect(racines).toHaveLength(1)
    expect(racines[0]).toHaveAttribute("data-oto-theme", "foret")
    expect(within(racines[0]).getByText("Contenu")).toBeInTheDocument()
  })

  // Depuis E05-S09 (AC-a3), la tête du rail est la pastille d'entreprise d'oto-frontend : le logo, à la
  // place du mark, puis le nom de l'organisation (E05-S13, AC-3 : un ancien nom affiché n'est plus lu).
  it("should open the rail with the logo, then the organisation name", async () => {
    vi.mocked(getPlatformIdentitySafely).mockResolvedValue(membre({ logo_url: LOGO, display_name: "Démo Forêt" }))

    render(await DashboardLayout({ children: <p>Contenu</p> }))

    const entreprise = screen.getByRole("button", { name: /^Entreprise : Démo\./ })
    const logo = entreprise.firstElementChild
    expect(logo?.tagName).toBe("IMG")
    expect(logo).toHaveAttribute("src", LOGO)
    expect(entreprise).toHaveTextContent(/^Démo$/)
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
    vi.mocked(getPlatformIdentitySafely).mockResolvedValue(membre({ theme: "foret" }, profile))

    const { container } = render(await DashboardLayout({ children: <p>Contenu</p> }))

    const racines = container.querySelectorAll<HTMLElement>(".oto")
    expect(racines).toHaveLength(1)
    expect(racines[0]).toHaveAttribute("data-oto-theme", attendu)
    expect(screen.queryByRole("button", { name: "Couleur du thème" })).toBeNull()
  })

  // E05-S11 (AC-32, AC-6, AC-e22) : les adresses que le layout donne au pied du rail ; le menu de
  // l'entreprise (AC-31, AC-33) : `admin-pages.test.tsx`.
  // E11-S10 (AC-e1) : « Contexte » en tête du menu du compte, à `/context`.
  it("should give the rail Connecteurs at its foot, then Contexte, Profil and Corbeille in the account menu", async () => {
    vi.mocked(getPlatformIdentitySafely).mockResolvedValue(membre({}))

    render(await DashboardLayout({ children: <p>Contenu</p> }))

    expect(screen.getByRole("link", { name: "Connecteurs" })).toHaveAttribute("href", "/admin/connectors")
    fireEvent.click(screen.getByRole("button", { name: /^Compte : / }))
    expect(within(screen.getByRole("menu")).getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Contexte", "Profil", "Brancher mon Claude, ChatGPT ou Mistral", "Corbeille", "Déconnexion"])
  })
})

// E05-S07 : `/login` passe sur le gabarit des écrans d'authentification, porté d'oto-frontend depuis
// E05-S09 (partie d3). Le produit en `h1`, l'écran en `h2` ; la marque de l'adresse donne le thème de la
// racine et la ligne d'organisation au-dessus de l'îlot ; elle est attendue, dans une borne de 1 000 ms,
// au lieu d'arriver en streaming.
describe("/login brand of the address (AC5 ; E05-S07, AC1, AC4, AC5)", () => {
  function formulaireInchange() {
    // L'adresse d'abord (2026-10-20) : la première étape, son champ et « Continuer ».
    expect(screen.getByLabelText("Adresse mail")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Continuer" })).toBeInTheDocument()
    expect(screen.getByRole("status")).toBeEmptyDOMElement()
  }

  const ilot = () => screen.getByRole("region", { name: "Se connecter" })
  // La ligne d'organisation : l'élément qui précède l'îlot, dans la colonne du formulaire.
  const ligneDOrganisation = () => ilot().previousElementSibling

  it("should show the logo and the display name of the organisation of the address above the island", async () => {
    vi.mocked(resolveOrg).mockResolvedValue(org({ logo_url: LOGO }))

    await rendre(await LoginPage({ searchParams: Promise.resolve({}) }))

    expect(resolveOrg).toHaveBeenCalledWith(ANON_DB, "demo.localhost")
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/^Oto$/)
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(/^Se connecter$/)
    const ligne = ligneDOrganisation()
    expect(ligne).toHaveTextContent(/^Démo$/)
    const logo = ligne?.querySelector("img")
    expect(logo).toHaveAttribute("src", LOGO)
    expect(logo).toHaveAttribute("alt", "")
    expect(logo).toHaveAttribute("width", "32")
    formulaireInchange()
  })

  it("should put the theme of the organisation on the single .oto root of the page", async () => {
    vi.mocked(resolveOrg).mockResolvedValue(org({ theme: "foret" }))

    await rendre(await LoginPage({ searchParams: Promise.resolve({}) }))

    const racines = document.querySelectorAll(".oto")
    expect(racines).toHaveLength(1)
    expect(racines[0]).toHaveAttribute("data-oto-theme", "foret")
  })

  it("should render without an organisation line nor theme for an address without organisation, without logging", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    vi.mocked(resolveOrg).mockRejectedValue(new PlatformError("unknown_org", "No organisation is served at inconnu.localhost."))

    await rendre(await LoginPage({ searchParams: Promise.resolve({}) }))

    expect(ligneDOrganisation()).toBeNull()
    expect(screen.queryByText("Démo")).toBeNull()
    expect(document.querySelector("img")).toBeNull()
    expect(document.querySelector(".oto")).not.toHaveAttribute("data-oto-theme")
    expect(log).not.toHaveBeenCalled()
    formulaireInchange()
  })
})
