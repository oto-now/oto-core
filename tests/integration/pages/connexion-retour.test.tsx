// Retour après la connexion sur `/login` (E02-S02, AC7, AC8) : la page lit `redirect`, le valide et le
// passe en champ caché au formulaire et aux boutons des fournisseurs ; le lien de connexion le porte
// aussi. Page serveur rendue avec `fournisseursActives`, les actions et la marque simulés (comme
// `connexion-fournisseurs.test.tsx`).
import { Suspense, type ReactNode } from "react"
import { headers } from "next/headers"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createAnonPlatformDb, PlatformError, resolveOrg, type PlatformDb } from "@otomata_tech/oto_platform/server"
import { BoutonsDeFournisseurs } from "@/app/(auth)/login/boutons-de-fournisseurs"
import { FormulaireDeConnexion } from "@/app/(auth)/login/formulaire-de-connexion"
import LoginPage from "@/app/(auth)/login/page"
import { connexionFournisseurAction, loginAction, magicLinkAction } from "@/lib/actions/auth"
import { fournisseursActives } from "@/lib/supabase/fournisseurs"

vi.mock("@/lib/supabase/fournisseurs", () => ({ fournisseursActives: vi.fn() }))

vi.mock("@/lib/actions/auth", () => ({
  loginAction: vi.fn(),
  magicLinkAction: vi.fn(),
  connexionFournisseurAction: vi.fn(),
}))

vi.mock("next/headers", () => ({ headers: vi.fn() }))

vi.mock("@otomata_tech/oto_platform/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@otomata_tech/oto_platform/server")>()),
  createAnonPlatformDb: vi.fn(),
  resolveOrg: vi.fn(),
}))

const CONSENT = "/oauth/consent?authorization_id=abc123"

async function rendre(arbre: ReactNode) {
  await act(async () => {
    render(<Suspense fallback={null}>{arbre}</Suspense>)
  })
}

/** Valeurs des champs cachés `redirect` de la page, formulaire par formulaire. */
function retoursCaches(): string[] {
  return [...document.querySelectorAll<HTMLInputElement>('input[type="hidden"][name="redirect"]')].map((champ) => champ.value)
}

beforeEach(() => {
  // `headers()` rend des en-têtes en lecture seule : des `Headers` ordinaires suffisent au rendu.
  vi.mocked(headers).mockResolvedValue(new Headers({ host: "localhost:3000" }) as unknown as Awaited<ReturnType<typeof headers>>)
  // Les services qui liraient la base sont simulés : un client vide suffit.
  vi.mocked(createAnonPlatformDb).mockReturnValue({} as PlatformDb)
  vi.mocked(resolveOrg).mockRejectedValue(new PlatformError("unknown_org", "No organisation is served at localhost."))
  vi.mocked(fournisseursActives).mockResolvedValue({ google: true, azure: false })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("/login with a way back (AC7)", () => {
  it("should hand the validated page to the form and to the provider buttons", async () => {
    await rendre(await LoginPage({ searchParams: Promise.resolve({ redirect: CONSENT }) }))

    expect(retoursCaches()).toEqual([CONSENT, CONSENT])
    const [formulaire, fournisseurs] = document.querySelectorAll("form")
    // Le bouton principal est au pied de l'îlot, relié au formulaire par `form` (E05-S09, partie d3) ; l'adresse d'abord.
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Continuer" }).form).toBe(formulaire)
    expect(fournisseurs.contains(screen.getByRole("button", { name: "Continuer avec Google" }))).toBe(true)
  })

  // Refus de Google ou de Microsoft : `/auth/callback` renvoie ici avec l'erreur et la page demandée.
  it("should keep the way back beside the alert of a refused provider", async () => {
    await rendre(await LoginPage({ searchParams: Promise.resolve({ error: "oauth", redirect: CONSENT }) }))

    expect(screen.getByRole("alert")).toBeInTheDocument()
    expect(retoursCaches()).toEqual([CONSENT, CONSENT])
  })

  it.each<string | string[]>(["/", "https://evil.example", [CONSENT, CONSENT]])(
    "should carry no way back for %j (AC8)",
    async (redirect) => {
      await rendre(await LoginPage({ searchParams: Promise.resolve({ redirect }) }))

      expect(screen.getByRole("button", { name: "Continuer avec Google" })).toBeInTheDocument()
      expect(retoursCaches()).toEqual([])
    },
  )
})

describe("sign-in forms with a way back (AC7)", () => {
  it("should send the way back with the password sign-in", async () => {
    vi.mocked(loginAction).mockResolvedValue({ error: "Email ou mot de passe incorrect." })
    render(<FormulaireDeConnexion retour={CONSENT} />)
    fireEvent.change(screen.getByLabelText("Adresse mail"), { target: { value: "claire@acme.test" } })
    fireEvent.click(screen.getByRole("button", { name: "Continuer" }))
    fireEvent.change(await screen.findByLabelText("Mot de passe"), { target: { value: "password123" } })

    fireEvent.click(screen.getByRole("button", { name: "Se connecter" }))

    await waitFor(() => expect(loginAction).toHaveBeenCalledTimes(1))
    expect(vi.mocked(loginAction).mock.calls[0][0].get("redirect")).toBe(CONSENT)
  })

  it("should send the way back with the magic link request", async () => {
    vi.mocked(magicLinkAction).mockResolvedValue({ data: { message: "Un lien vient de partir." } })
    render(<FormulaireDeConnexion retour={CONSENT} />)
    fireEvent.change(screen.getByLabelText("Adresse mail"), { target: { value: "claire@acme.test" } })
    fireEvent.click(screen.getByRole("button", { name: "Continuer" }))

    fireEvent.click(await screen.findByRole("button", { name: "Recevoir un lien de connexion" }))

    await waitFor(() => expect(magicLinkAction).toHaveBeenCalledTimes(1))
    const envoye = vi.mocked(magicLinkAction).mock.calls[0][0]
    expect(envoye.get("email")).toBe("claire@acme.test")
    expect(envoye.get("redirect")).toBe(CONSENT)
  })

  it("should send no way back with the magic link when there is none", async () => {
    vi.mocked(magicLinkAction).mockResolvedValue({ data: { message: "Un lien vient de partir." } })
    render(<FormulaireDeConnexion />)
    fireEvent.change(screen.getByLabelText("Adresse mail"), { target: { value: "claire@acme.test" } })
    fireEvent.click(screen.getByRole("button", { name: "Continuer" }))

    fireEvent.click(await screen.findByRole("button", { name: "Recevoir un lien de connexion" }))

    await waitFor(() => expect(magicLinkAction).toHaveBeenCalledTimes(1))
    expect(vi.mocked(magicLinkAction).mock.calls[0][0].has("redirect")).toBe(false)
  })

  it("should send the way back with the chosen provider", async () => {
    vi.mocked(connexionFournisseurAction).mockResolvedValue({ error: "La connexion avec ce fournisseur n'a pas pu démarrer. Réessayez." })
    render(<BoutonsDeFournisseurs google azure={false} retour={CONSENT} />)

    fireEvent.click(screen.getByRole("button", { name: "Continuer avec Google" }))

    await waitFor(() => expect(connexionFournisseurAction).toHaveBeenCalledTimes(1))
    const envoye = vi.mocked(connexionFournisseurAction).mock.calls[0][1]
    expect(envoye.get("fournisseur")).toBe("google")
    expect(envoye.get("redirect")).toBe(CONSENT)
  })
})
