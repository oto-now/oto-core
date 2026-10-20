import { Suspense } from "react"
import { unstable_rethrow } from "next/navigation"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
// Le formulaire a quitté la page (E09-S01) : la page, devenue serveur, rend l'en-tête de marque
// (`marque-layout-connexion.test.tsx`). Les cas ci-dessous restent ceux d'E02-S01, sur le formulaire
// porté d'oto-frontend (E05-S09, partie d3) : l'adresse s'appelle « Adresse mail », et une adresse mal
// formée se dit sous son champ. L'adresse d'abord (2026-10-20) : « Continuer » montre ensuite le mot de passe et le lien.
import { FormulaireDeConnexion as LoginPage } from "@/app/(auth)/login/formulaire-de-connexion"
import { loginAction, magicLinkAction } from "@/lib/actions/auth"

vi.mock("@/lib/actions/auth", () => ({
  loginAction: vi.fn(),
  magicLinkAction: vi.fn(),
}))

// `unstable_rethrow` relance la redirection d'une connexion réussie : relancée ici, elle deviendrait
// un rejet non géré du test. Le double l'enregistre seulement.
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  unstable_rethrow: vi.fn(),
}))

const MESSAGE = "Si une invitation ou un compte existe pour cette adresse, un lien de connexion vient de partir."

/** Saisit l'adresse et la pose par « Continuer » : la seconde étape, mot de passe et lien, se montre. */
async function poserLAdresse(adresse = "claire@acme.test") {
  fireEvent.change(screen.getByLabelText("Adresse mail"), { target: { value: adresse } })
  fireEvent.click(screen.getByRole("button", { name: "Continuer" }))
  return screen.findByLabelText("Mot de passe")
}

beforeEach(() => {
  vi.mocked(magicLinkAction).mockResolvedValue({ data: { message: MESSAGE } })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("LoginPage, the address first (2026-10-20)", () => {
  it("should ask only for the address, then show the password and the link, the address kept read-only and editable again", async () => {
    render(<LoginPage />)
    expect(screen.queryByLabelText("Mot de passe")).toBeNull()
    expect(screen.queryByRole("button", { name: "Recevoir un lien de connexion" })).toBeNull()
    const motDePasse = await poserLAdresse()
    await waitFor(() => expect(document.activeElement).toBe(motDePasse))
    expect(screen.getByLabelText("Adresse mail")).toHaveAttribute("readonly")
    expect(screen.getByRole("button", { name: "Recevoir un lien de connexion" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Mot de passe oublié ?" })).toHaveAttribute("href", "/forgot-password")
    fireEvent.click(screen.getByRole("button", { name: "Modifier l'adresse" }))
    expect(screen.queryByLabelText("Mot de passe")).toBeNull()
    expect(screen.getByLabelText("Adresse mail")).not.toHaveAttribute("readonly")
  })

  it("should refuse a malformed email under its field, and stay at the first step", async () => {
    render(<LoginPage />)
    const champ = screen.getByLabelText("Adresse mail")
    fireEvent.change(champ, { target: { value: "claire" } })

    fireEvent.click(screen.getByRole("button", { name: "Continuer" }))

    const erreur = await screen.findByText("Email invalide")
    expect(champ).toHaveAttribute("aria-invalid", "true")
    expect(champ.getAttribute("aria-describedby")).toContain(erreur.id)
    expect(screen.queryByLabelText("Mot de passe")).toBeNull()
  })
})

describe("LoginPage magic link (AC24)", () => {
  it("should mount the status region empty from the start", () => {
    render(<LoginPage />)
    expect(screen.getByRole("status")).toBeEmptyDOMElement()
  })

  it("should ask for a link with the typed email and announce the answer in the status region", async () => {
    render(<LoginPage />)
    const region = screen.getByRole("status")
    await poserLAdresse()

    fireEvent.click(screen.getByRole("button", { name: "Recevoir un lien de connexion" }))

    await waitFor(() => expect(region).toHaveTextContent(MESSAGE))
    const envoye = vi.mocked(magicLinkAction).mock.calls[0][0]
    expect(envoye.get("email")).toBe("claire@acme.test")
  })

  it("should say the request failed and free the button when the action cannot be reached", async () => {
    vi.mocked(magicLinkAction).mockRejectedValue(new TypeError("Failed to fetch"))
    render(<LoginPage />)
    await poserLAdresse()
    const bouton = screen.getByRole("button", { name: "Recevoir un lien de connexion" })

    fireEvent.click(bouton)

    expect(await screen.findByRole("alert")).toHaveTextContent("La connexion au serveur a échoué. Réessayez.")
    await waitFor(() => expect(bouton).toBeEnabled())
    expect(bouton).toHaveAttribute("aria-busy", "false")
    expect(screen.getByRole("status")).toBeEmptyDOMElement()
  })
})

describe("LoginPage password sign-in (E09-S01, api-patterns.md § Type de retour standard)", () => {
  async function seConnecter() {
    fireEvent.change(await poserLAdresse(), { target: { value: "password123" } })
    fireEvent.click(screen.getByRole("button", { name: "Se connecter" }))
  }

  it("should hand the rejection to unstable_rethrow first, so that the redirect of a success goes through", async () => {
    const redirection = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;push;/;307;" })
    vi.mocked(loginAction).mockRejectedValue(redirection)
    render(<LoginPage />)

    await seConnecter()

    await waitFor(() => expect(unstable_rethrow).toHaveBeenCalledWith(redirection))
    await waitFor(() => expect(screen.getByRole("button", { name: "Se connecter" })).toBeEnabled())
  })

  it("should show the refusal of the action and free the button", async () => {
    vi.mocked(loginAction).mockResolvedValue({ error: "Email ou mot de passe incorrect." })
    render(<LoginPage />)

    await seConnecter()

    expect(await screen.findByRole("alert")).toHaveTextContent("Email ou mot de passe incorrect.")
    await waitFor(() => expect(screen.getByRole("button", { name: "Se connecter" })).toBeEnabled())
  })
})

describe("LoginPage refused link (AC22)", () => {
  /** `searchParams` est une promesse (Next 15) : `act` asynchrone laisse `use()` la résoudre. */
  async function renderWith(searchParams: Promise<{ error?: string }>) {
    await act(async () => {
      render(
        <Suspense fallback={null}>
          <LoginPage searchParams={searchParams} />
        </Suspense>,
      )
    })
  }

  it("should explain an expired or used email link and point to the link button", async () => {
    await renderWith(Promise.resolve({ error: "auth_callback_error" }))

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Ce lien de connexion a expiré ou a déjà servi. Saisissez votre adresse, puis choisissez « Recevoir un lien de connexion » pour en recevoir un nouveau.",
    )
  })

  it("should say nothing about a link without the error parameter", async () => {
    await renderWith(Promise.resolve({}))

    expect(screen.getByRole("button", { name: "Continuer" })).toBeInTheDocument()
    expect(screen.queryByRole("alert")).toBeNull()
  })
})
