// Les cinq écrans d'authentification sur le gabarit porté d'oto-frontend (E05-S09, partie d3 ; E05-S07,
// AC1, AC4, AC6 à AC10), au niveau des pages : `marqueDeLAdresse` simulé (Forêt avec logo, puis aucune
// organisation) ; actions, fournisseurs et session simulés. La lecture réelle de la marque est couverte
// par `marque-layout-connexion.test.tsx` et `tests/unit/marque-de-l-adresse.test.ts`.
import { Suspense, type ReactNode } from "react"
import type { Metadata } from "next"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { orgContact, resolveOrg, type PlatformDb } from "@otomata_tech/oto_platform/server"
import type { MarqueDOrganisation } from "@otomata_tech/oto_platform/ui"
import ForgotPasswordPage, { metadata as metadataMotDePasseOublie } from "@/app/(auth)/forgot-password/page"
import LoginPage, { metadata as metadataConnexion } from "@/app/(auth)/login/page"
import ResetPasswordPage, { metadata as metadataNouveauMotDePasse } from "@/app/(auth)/reset-password/page"
import AucuneOrganisationPage, { metadata as metadataAucuneOrganisation } from "@/app/no-organization/page"
import ConfirmerPage, { metadata as metadataConfirmer } from "@/app/auth/confirm/page"
import { generateMetadata as metadataRacine } from "@/app/layout"
import { forgotPasswordAction, loginAction, magicLinkAction, resetPasswordAction } from "@/lib/actions/auth"
import { marqueDeLAdresse } from "@/lib/plateforme/marque-de-l-adresse"
import { getPlatformIdentitySafely, getPlatformSession, type PlatformSession } from "@/lib/plateforme/session"

// `next/font/google` n'existe qu'à la compilation de Next : le layout racine n'est lu ici que pour
// son titre.
vi.mock("next/font/google", () => ({ Inter: () => ({ className: "inter" }) }))

vi.mock("@/lib/plateforme/marque-de-l-adresse", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/plateforme/marque-de-l-adresse")>()),
  marqueDeLAdresse: vi.fn(),
}))

vi.mock("@/lib/supabase/fournisseurs", () => ({ fournisseursActives: vi.fn(async () => ({ google: false, azure: false })) }))

vi.mock("@/lib/actions/auth", () => ({
  loginAction: vi.fn(),
  magicLinkAction: vi.fn(),
  connexionFournisseurAction: vi.fn(),
  forgotPasswordAction: vi.fn(),
  resetPasswordAction: vi.fn(),
  confirmerLienAction: vi.fn(),
  logoutAction: vi.fn(),
}))

vi.mock("@/lib/plateforme/session", () => ({ getPlatformSession: vi.fn(), getPlatformIdentitySafely: vi.fn(), getRequestOrigin: vi.fn(async () => "https://demo.oto.test"), getCalledOrigin: vi.fn(async () => "https://demo.oto.test") }))

// redirect() lève NEXT_REDIRECT dans Next : le mock lève aussi, le rendu s'arrête comme en production.
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
}))

vi.mock("@otomata_tech/oto_platform/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@otomata_tech/oto_platform/server")>()),
  resolveOrg: vi.fn(),
  orgContact: vi.fn(),
}))

const LOGO = "https://example.com/logo.png"
const FORET: MarqueDOrganisation = { theme: "foret", logo: LOGO, nomAffiche: "Démo Forêt" }
const LEGENDE_CONNEXION =
  "Pas encore de compte ? On entre sur invitation : demandez-en une à l'administrateur de votre organisation."
const MESSAGE_DU_LIEN = "Si une invitation ou un compte existe pour cette adresse, un lien de connexion vient de partir."

/** Rend un arbre qui contient des composants lisant une promesse (`use`). */
async function rendre(arbre: ReactNode) {
  await act(async () => {
    render(<Suspense fallback={null}>{arbre}</Suspense>)
  })
}

/** `true` quand `b` suit `a` dans le document ; `false` quand l'un des deux manque. */
function suit(a: Element | null | undefined, b: Element | null | undefined): boolean {
  if (!a || !b) return false
  return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
}

type Ecran = {
  chemin: string
  page: () => Promise<ReactNode>
  titre: string
  onglet: Metadata["title"]
  /** Texte propre de la légende sous l'îlot (hors de son lien), ou celui de son lien ; `null` : aucune. */
  legende: string | null
}

const ECRANS: Ecran[] = [
  {
    chemin: "/login",
    page: () => LoginPage({ searchParams: Promise.resolve({}) }),
    titre: "Se connecter",
    onglet: metadataConnexion.title,
    legende: LEGENDE_CONNEXION,
  },
  {
    chemin: "/forgot-password",
    page: () => ForgotPasswordPage(),
    titre: "Mot de passe oublié",
    onglet: metadataMotDePasseOublie.title,
    legende: "Vous vous en souvenez ?",
  },
  {
    chemin: "/reset-password",
    page: () => ResetPasswordPage(),
    titre: "Choisir un nouveau mot de passe",
    onglet: metadataNouveauMotDePasse.title,
    legende: "Se connecter",
  },
  {
    chemin: "/auth/confirm",
    page: () => ConfirmerPage({ searchParams: Promise.resolve({ token_hash: "h", type: "email", next: "/" }) }),
    titre: "Connexion",
    onglet: metadataConfirmer.title,
    legende: null,
  },
]

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(marqueDeLAdresse).mockResolvedValue(FORET)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

// Les contrôles du gabarit en un test par écran (M11) : un seul rendu les porte tous. Un seul `h1`,
// « Oto », celui du panneau de marque, à toute largeur (la marque compacte n'en est que le dessin).
describe.each(ECRANS)("$chemin on the authentication template (AC-d3 ; E05-S07, AC1, AC4, AC5)", ({ page, titre, legende }) => {
  it("should render the template at the theme of the address, with its titles, one empty status region, the organisation line and its legend", async () => {
    await rendre(await page())

    const racines = document.querySelectorAll(".oto")
    expect(racines).toHaveLength(1)
    expect(racines[0]).toHaveAttribute("data-oto-theme", "foret")

    expect(document.querySelectorAll("main")).toHaveLength(1)
    expect(screen.getAllByRole("heading", { level: 1 }).map((h) => h.textContent)).toEqual(["Oto"])
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([titre])
    const ilot = screen.getByRole("region", { name: titre })

    const regions = screen.getAllByRole("status")
    expect(regions).toHaveLength(1)
    expect(regions[0]).toBeEmptyDOMElement()

    const logo = document.querySelector("img")
    expect(logo).toHaveAttribute("src", LOGO)
    expect(logo?.parentElement).toHaveTextContent(/^Démo Forêt$/)
    expect(suit(logo, ilot)).toBe(true)

    if (legende === null) expect(ilot.nextElementSibling).toBeNull()
    else expect(suit(ilot, screen.getByText(legende))).toBe(true)
  })
})

describe("/login on the authentication template without an organisation (E05-S07, AC1, AC4, AC5)", () => {
  it("should render the default root, without an organisation line, without a brand", async () => {
    vi.mocked(marqueDeLAdresse).mockResolvedValue(null)

    await rendre(await LoginPage({ searchParams: Promise.resolve({}) }))

    expect(document.querySelectorAll(".oto")).toHaveLength(1)
    expect(document.querySelector(".oto")).not.toHaveAttribute("data-oto-theme")
    expect(document.querySelector("img")).toBeNull()
    expect(screen.queryByText("Démo Forêt")).toBeNull()
  })
})

describe("tab titles (E05-S07, AC1)", () => {
  it("should title each screen under the product template of the root layout, and keep the five screens out of search engines", async () => {
    expect((await metadataRacine()).title).toEqual({ default: "Oto", template: "%s | Oto" })
    expect(ECRANS.map((ecran) => ecran.onglet)).toEqual([
      "Connexion",
      "Mot de passe oublié",
      "Nouveau mot de passe",
      "Ouvrir votre session",
    ])
    expect(metadataAucuneOrganisation.title).toBe("Aucune organisation")
    expect(metadataConfirmer.robots).toEqual({ index: false })
    expect(metadataAucuneOrganisation.robots).toEqual({ index: false })
  })
})

describe("/login (AC-d3 ; E05-S07, AC6, AC7)", () => {
  it("should offer the forgotten password link in the island, and both buttons in its foot, tied to the form", async () => {
    await rendre(await LoginPage({ searchParams: Promise.resolve({}) }))

    const ilot = screen.getByRole("region", { name: "Se connecter" })
    expect(within(ilot).getByRole("link", { name: "Mot de passe oublié ?" })).toHaveAttribute("href", "/forgot-password")
    for (const nom of ["Se connecter", "Recevoir un lien de connexion"]) {
      expect(within(ilot).getByRole("button", { name: nom }).closest("footer")).not.toBeNull()
    }
    const principal = within(ilot).getByRole<HTMLButtonElement>("button", { name: "Se connecter" })
    expect(principal).toHaveAttribute("type", "submit")
    expect(principal.form).toBe(ilot.querySelector("form"))
    expect(principal).toHaveAttribute("aria-busy", "false")
  })

  it("should announce the magic link in the region of the island and bring the focus to its title", async () => {
    vi.mocked(magicLinkAction).mockResolvedValue({ data: { message: MESSAGE_DU_LIEN } })
    await rendre(await LoginPage({ searchParams: Promise.resolve({}) }))
    fireEvent.change(screen.getByLabelText("Adresse mail"), { target: { value: "claire@acme.test" } })

    fireEvent.click(screen.getByRole("button", { name: "Recevoir un lien de connexion" }))

    // La région montée d'emblée est la première ; l'`Alert` du statut s'y loge.
    await waitFor(() => expect(screen.getAllByRole("status")[0]).toHaveTextContent(MESSAGE_DU_LIEN))
    // Le focus part dans l'effet qui suit le rendu du statut : il s'attend comme lui.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { level: 2, name: "Se connecter" })))
  })

  it("should mark the sign-in button busy, and say so, while signing in", async () => {
    await rendre(await LoginPage({ searchParams: Promise.resolve({}) }))
    fireEvent.change(screen.getByLabelText("Adresse mail"), { target: { value: "claire@acme.test" } })
    fireEvent.change(screen.getByLabelText("Mot de passe"), { target: { value: "password123" } })
    vi.mocked(loginAction).mockReturnValue(new Promise(() => {}))

    fireEvent.click(screen.getByRole("button", { name: "Se connecter" }))

    const bouton = await screen.findByRole("button", { name: "Connexion…" })
    expect(bouton).toHaveAttribute("aria-busy", "true")
    expect(bouton).toBeDisabled()
  })
})

describe("/forgot-password and /reset-password (AC-d3 ; E05-S07, AC6, AC8)", () => {
  it("should link /forgot-password back to /login, and mark its button busy while sending", async () => {
    vi.mocked(forgotPasswordAction).mockReturnValue(new Promise(() => {}))
    await rendre(await ForgotPasswordPage())

    expect(screen.getByRole("link", { name: "Se connecter" })).toHaveAttribute("href", "/login")
    fireEvent.change(screen.getByLabelText("Adresse mail"), { target: { value: "claire@acme.test" } })
    fireEvent.click(screen.getByRole("button", { name: "Envoyer le lien" }))

    expect(await screen.findByRole("button", { name: "Envoi…" })).toHaveAttribute("aria-busy", "true")
  })

  it("should give /reset-password both fields and a way to /login, and mark its button busy while sending", async () => {
    vi.mocked(resetPasswordAction).mockReturnValue(new Promise(() => {}))
    await rendre(await ResetPasswordPage())

    expect(screen.getByRole("link", { name: "Se connecter" })).toHaveAttribute("href", "/login")
    fireEvent.change(screen.getByLabelText("Nouveau mot de passe"), { target: { value: "nouveau-secret" } })
    fireEvent.change(screen.getByLabelText("Confirmer le mot de passe"), { target: { value: "nouveau-secret" } })
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer le mot de passe" }))

    expect(await screen.findByRole("button", { name: "Enregistrement…" })).toHaveAttribute("aria-busy", "true")
  })
})

describe("/auth/confirm (E05-S07, AC9)", () => {
  it("should still render the button without parameters (N27)", async () => {
    await rendre(await ConfirmerPage({ searchParams: Promise.resolve({}) }))

    expect(screen.getByRole("button", { name: "Continuer" })).toBeInTheDocument()
  })
})

describe("/no-organization on the template (E05-S07, AC10)", () => {
  const SESSION: PlatformSession = {
    user: { id: "user-1", email: "claire@acme.test" },
    accessToken: "session-token",
    host: "acme.test",
    // Les services qui liraient la base sont simulés : un client vide suffit.
    db: {} as PlatformDb,
  }
  const ACME = { id: "org-1", slug: "acme", name: "Acme Énergies", prefix: "acm", brand: { theme: "cobalt" }, domains: null }

  beforeEach(() => {
    vi.mocked(getPlatformSession).mockResolvedValue(SESSION)
  })

  it("should take the theme and the line of the organisation it resolves for a non-member, no other read", async () => {
    vi.mocked(getPlatformIdentitySafely).mockResolvedValue({ error: { code: "not_member" } })
    vi.mocked(resolveOrg).mockResolvedValue(ACME)
    vi.mocked(orgContact).mockResolvedValue({ name: "Paul Martin", email: "paul@acme.test" })

    await rendre(await AucuneOrganisationPage())

    expect(document.querySelectorAll(".oto")).toHaveLength(1)
    expect(document.querySelector(".oto")).toHaveAttribute("data-oto-theme", "cobalt")
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/^Oto$/)
    const ilot = screen.getByRole("region", { name: "Vous n'êtes pas membre de Acme Énergies" })
    expect(ilot.previousElementSibling).toHaveTextContent(/^AAcme Énergies$/)
    expect(within(ilot).getByText("Connecté·e avec claire@acme.test.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Se déconnecter" }).closest("footer")).not.toBeNull()
    expect(resolveOrg).toHaveBeenCalledTimes(1)
    expect(marqueDeLAdresse).not.toHaveBeenCalled()
  })

  it("should render the default root, without an organisation line, for an unknown address", async () => {
    vi.mocked(getPlatformIdentitySafely).mockResolvedValue({ error: { code: "unknown_org" } })

    await rendre(await AucuneOrganisationPage())

    expect(document.querySelector(".oto")).not.toHaveAttribute("data-oto-theme")
    const ilot = screen.getByRole("region", { name: "Adresse inconnue" })
    expect(ilot.previousElementSibling).toBeNull()
  })
})
