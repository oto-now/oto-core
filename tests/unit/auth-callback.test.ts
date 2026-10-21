import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { acceptInvitations, createPlatformDb } from "@otomata_tech/oto_platform/server"
import ConfirmerPage from "@/app/auth/confirm/page"
import { GET } from "@/app/auth/callback/route"
import { createClient } from "@/lib/supabase/server"

const auth = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  verifyOtp: vi.fn(),
}))

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth })),
}))

vi.mock("@/lib/actions/auth", () => ({ confirmerLienAction: vi.fn() }))

// La page lit la marque de l'adresse pour son thème (E05-S07) : aucune organisation ici, aucun appel.
vi.mock("@/lib/plateforme/marque-de-l-adresse", () => ({ marqueDeLAdresse: vi.fn(async () => null) }))

vi.mock("@otomata_tech/oto_platform/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@otomata_tech/oto_platform/server")>()),
  createPlatformDb: vi.fn(() => ({})),
  acceptInvitations: vi.fn(async () => []),
}))

const ORIGIN = "https://acme.test"
// La session ouverte par Supabase Auth porte son compte : l'appelant vérifié qu'elle passe au paquet (E01-S10).
const SESSION = { access_token: "session-token", user: { id: "user-1", email: "claire@acme.test", user_metadata: { full_name: "Claire Morel" } } }

function callback(query: string) {
  return GET(new Request(`${ORIGIN}/auth/callback?${query}`))
}

beforeEach(() => {
  vi.clearAllMocks()
  auth.exchangeCodeForSession.mockResolvedValue({ data: { session: SESSION }, error: null })
})

afterEach(cleanup)

describe("GET /auth/callback", () => {
  it("should exchange the code, accept invitations with the session token, then go to next", async () => {
    const response = await callback("code=abc&next=/reset-password")

    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith("abc")
    expect(createPlatformDb).toHaveBeenCalledWith({
      caller: { userId: "user-1", email: "claire@acme.test", name: "Claire Morel" },
    })
    expect(acceptInvitations).toHaveBeenCalledTimes(1)
    expect(response.headers.get("location")).toBe(`${ORIGIN}/reset-password`)
  })

  it("should bring an absolute next (//evil.test) back to /", async () => {
    const response = await callback(`code=abc&next=${encodeURIComponent("//evil.test")}`)
    expect(response.headers.get("location")).toBe(`${ORIGIN}/`)
  })

  it("should still redirect when accepting invitations fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    vi.mocked(acceptInvitations).mockRejectedValueOnce(new Error("database unavailable"))

    const response = await callback("code=abc&next=/")

    expect(response.headers.get("location")).toBe(`${ORIGIN}/`)
    expect(log).toHaveBeenCalled()
  })

  it("should send a refused code or a missing code to the login error", async () => {
    auth.exchangeCodeForSession.mockResolvedValue({ data: { session: null }, error: { status: 400 } })
    const refused = await callback("code=abc")
    const missing = await callback("next=/")

    expect(refused.headers.get("location")).toBe(`${ORIGIN}/login?error=auth_callback_error`)
    expect(missing.headers.get("location")).toBe(`${ORIGIN}/login?error=auth_callback_error`)
    expect(acceptInvitations).not.toHaveBeenCalled()
  })
})

// Retour en erreur de Google ou Microsoft (E09-S03, AC5) : le serveur d'auth ajoute `error`,
// `error_code` et `error_description` à l'adresse de retour (refus du hook, annulation…).
describe("GET /auth/callback with an error of the auth server", () => {
  const DESCRIPTION = "L'inscription se fait sur invitation."
  const ERROR = `error=access_denied&error_code=signup_disabled&error_description=${encodeURIComponent(DESCRIPTION)}`

  it("should send the error to /login?error=oauth, without the description", async () => {
    const response = await callback(ERROR)

    expect(response.headers.get("location")).toBe(`${ORIGIN}/login?error=oauth`)
    expect(response.headers.get("location")).not.toContain("invitation")
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled()
  })

  // Le rappel d'un fournisseur porte `next` quand la connexion a été demandée par une page (E02-S02,
  // consentement OAuth) : la page de connexion le garde, la connexion suivante y ramène.
  it("should keep the way back to the requested page on /login?error=oauth", async () => {
    const next = encodeURIComponent("/oauth/consent?authorization_id=abc123")

    const response = await callback(`next=${next}&${ERROR}`)

    expect(response.headers.get("location")).toBe(`${ORIGIN}/login?redirect=${encodeURIComponent(`/oauth/consent?authorization_id=abc123`)}&error=oauth`)
    expect(response.headers.get("location")).not.toContain("invitation")
  })

  it.each(["https://evil.test", "/"])("should drop the way back %s, unsafe or useless, on /login?error=oauth", async (next) => {
    const response = await callback(`next=${encodeURIComponent(next)}&${ERROR}`)

    expect(response.headers.get("location")).toBe(`${ORIGIN}/login?error=oauth`)
  })

  // Un code, que la route échangerait sans l'erreur : le `token_hash` d'un lien, qu'elle n'échange pas,
  // suit la même règle (M11b).
  it("should keep to the error when a code comes with it", async () => {
    const response = await callback(`code=abc&${ERROR}`)

    expect(response.headers.get("location")).toBe(`${ORIGIN}/login?error=oauth`)
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled()
    expect(acceptInvitations).not.toHaveBeenCalled()
  })

  // Un lien de réinitialisation expiré revient aussi ici (`/verify` de supabase/auth) : il garde le
  // message d'E02-S01 sur le lien expiré, comme avant cette story (HN-E09S03-7).
  it("should keep an expired email link on the refused link message of E02-S01", async () => {
    const response = await callback(
      "next=/reset-password&error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired",
    )

    expect(response.headers.get("location")).toBe(`${ORIGIN}/login?error=auth_callback_error`)
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled()
  })
})

describe("/auth/confirm page", () => {
  it("should verify nothing when it opens, and offer « Continuer » with the link fields", async () => {
    const searchParams = Promise.resolve({ token_hash: "hash-from-the-email", type: "email", next: "/" })

    render(await ConfirmerPage({ searchParams }))

    expect(screen.getByText("Cliquez pour ouvrir votre session.")).toBeInTheDocument()
    const bouton = screen.getByRole("button", { name: "Continuer" })
    const champs = Object.fromEntries(new FormData(bouton.closest("form") ?? undefined).entries())
    expect(champs).toEqual({ token_hash: "hash-from-the-email", type: "email", next: "/" })
    expect(createClient).not.toHaveBeenCalled()
    expect(auth.verifyOtp).not.toHaveBeenCalled()
  })
})
