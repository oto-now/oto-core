// Page `/oauth/consent` et sa Server Action (E02-S02 : AC9 à AC18, AC21), avec le client du starter
// et la session de l'hôte simulés ; le service du paquet (`consentRequest`, `consentDecision`) est le
// vrai. Les cas qui lisent la base tournent sur le projet (E01-S10, lot t1-e2b1) : O et P de
// `seedReferenceOrg`, le client de Léa (face SQL sous son appelant, `asCaller`, depuis E01-S10 f2), son
// compte Supabase Auth et sa demande en attente, posée dans les tables du serveur OAuth de Supabase Auth
// (`pendingRequests`), qu'un Postgres nu n'a pas. Les autres ne l'atteignent pas. Modèle :
// `tests/integration/consent-page.test.tsx` du banc E03.
import { cleanup, render, screen } from "@testing-library/react"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { PlatformDb } from "@otomata_tech/oto_platform/server"
import ConsentPage, { metadata } from "@/app/oauth/consent/page"
import { deciderConsentementAction } from "@/lib/actions/consentement"
import { getPlatformSession, type PlatformSession } from "@/lib/plateforme/session"
import { AUTHORIZATION_ID as ID, DECIDED, DETAILS, form, pendingRequests, type PendingRequests } from "../helpers/oauth-pending"
import { createFixtures, type Fixtures } from "../helpers/plateforme"
import { OTHER_ORG } from "../helpers/reference-org"
import { seedReferenceOrg, type ReferenceOrgSql } from "../helpers/reference-org-sql"
import { asCaller, onProject, projectConfigured, seedWithAdmin, type SeededData } from "../helpers/sql"

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  getAuthorizationDetails: vi.fn(),
  approveAuthorization: vi.fn(),
  denyAuthorization: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
}))

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: mocks.getUser,
      oauth: {
        getAuthorizationDetails: mocks.getAuthorizationDetails,
        approveAuthorization: mocks.approveAuthorization,
        denyAuthorization: mocks.denyAuthorization,
      },
    },
  })),
}))

vi.mock("@/lib/plateforme/session", () => ({ getPlatformSession: vi.fn() }))

// redirect() lève NEXT_REDIRECT dans Next : le mock lève aussi, le rendu s'arrête comme en production.
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }))

const CONSENT = `/oauth/consent?authorization_id=${ID}`
const LOGIN_BACK = `/login?redirect=${encodeURIComponent(CONSENT)}`
const RETURN_CODE = "https://claude.ai/api/mcp/auth_callback?code=c0de&state=xyz"
const RETURN_DENIED = "https://claude.ai/api/mcp/auth_callback?error=access_denied&state=xyz"
const EXPIREE =
  "Cette demande d'autorisation a expiré ou a été ouverte avec un autre compte. Relancez la connexion depuis votre assistant."
const TRANCHEE =
  "Cette demande a déjà été tranchée, dans un autre onglet par exemple, ou elle a expiré. Si votre assistant n'est pas connecté, relancez la connexion depuis celui-ci."
// E09-S02, AC14 : la marque de P, dont la page prend le thème.
const BRAND = { theme: "foret", logo_url: "https://acme.example/logo.png", display_name: "Acme" }

const NETWORK_TIMEOUT = 60_000
const SETUP_TIMEOUT = 180_000
const ON_PROJECT = "page /oauth/consent on the project database, the pending request in the OAuth server of Supabase Auth"

const SESSION: PlatformSession = {
  user: { id: "user-1", email: "claire@example.invalid" },
  accessToken: "session-token",
  host: "oto-platform.example.test",
  // Ces cas ne lisent pas la base : le service reçoit un `PlatformDb` dont les trois faces ne font qu'enregistrer.
  db: { from: vi.fn(), rpc: vi.fn(), tx: vi.fn() } as unknown as PlatformDb,
}

function page(searchParams: Record<string, string | string[]>) {
  return ConsentPage({ searchParams: Promise.resolve(searchParams) })
}

beforeEach(() => {
  vi.mocked(getPlatformSession).mockResolvedValue(SESSION)
  mocks.getUser.mockResolvedValue({ data: { user: SESSION.user }, error: null })
  mocks.getAuthorizationDetails.mockResolvedValue({ data: DETAILS, error: null })
  mocks.approveAuthorization.mockResolvedValue({ data: { redirect_url: RETURN_CODE }, error: null })
  mocks.denyAuthorization.mockResolvedValue({ data: { redirect_url: RETURN_DENIED }, error: null })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe("page /oauth/consent", () => {
  it("should carry a title, noindex (AC21)", () => {
    expect(metadata).toEqual({ title: "Autoriser un assistant", robots: { index: false } })
  })

  it("should send a person without session to /login, back to the request, without reading it (AC7)", async () => {
    vi.mocked(getPlatformSession).mockResolvedValue(null)

    await expect(page({ authorization_id: ID })).rejects.toThrow(`NEXT_REDIRECT:${LOGIN_BACK}`)
    expect(mocks.getAuthorizationDetails).not.toHaveBeenCalled()
  })

  it("should send a person without session and without a valid id to /login, back to the page", async () => {
    vi.mocked(getPlatformSession).mockResolvedValue(null)

    await expect(page({ authorization_id: "../../admin/users" })).rejects.toThrow(
      `NEXT_REDIRECT:/login?redirect=${encodeURIComponent("/oauth/consent")}`,
    )
  })

  it.each<Record<string, string | string[]>>([{}, { authorization_id: [ID, ID] }])(
    "should explain an invalid link %j without calling the OAuth server (AC9)",
    async (searchParams) => {
      render(await page(searchParams))

      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Autorisation impossible")
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Ce lien ne porte pas de demande d'autorisation valide. Relancez la connexion depuis votre assistant.",
      )
      expect(mocks.getAuthorizationDetails).not.toHaveBeenCalled()
    },
  )

  it("should explain an expired request, the SDK error in the server log only (AC10)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    mocks.getAuthorizationDetails.mockResolvedValue({ data: null, error: { status: 404, message: "SDK secret detail" } })

    render(await page({ authorization_id: ID }))

    expect(screen.getByRole("alert")).toHaveTextContent(EXPIREE)
    expect(document.body.textContent).not.toContain("SDK secret detail")
    expect(log).toHaveBeenCalled()
  })

  it("should go straight back to the assistant when consent was already given (AC11)", async () => {
    mocks.getAuthorizationDetails.mockResolvedValue({ data: { redirect_url: RETURN_CODE }, error: null })

    await expect(page({ authorization_id: ID })).rejects.toThrow(`NEXT_REDIRECT:${RETURN_CODE}`)
  })

  // État mesuré (HN-E02S02-20) : tranchée dans un autre onglet, la demande répond 400 à sa relecture.
  it("should say the request can no longer be decided when its re-read fails after a decision (AC17)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    mocks.getAuthorizationDetails.mockResolvedValue({ data: null, error: DECIDED })

    render(await page({ authorization_id: ID, error: "decision" }))

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Autorisation impossible")
    expect(screen.getByRole("alert")).toHaveTextContent(TRANCHEE)
    expect(screen.queryByRole("button")).toBeNull()
  })

  it("should keep the expired message for an unreadable request without error in the address (AC10)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    mocks.getAuthorizationDetails.mockResolvedValue({ data: null, error: DECIDED })

    render(await page({ authorization_id: ID, error: "autre" }))

    expect(screen.getByRole("alert")).toHaveTextContent(EXPIREE)
  })
})

describe.skipIf(!projectConfigured)(
  onProject(ON_PROJECT),
  { timeout: NETWORK_TIMEOUT },
  () => {
    let seed: SeededData
    let accounts: Fixtures
    let ref: ReferenceOrgSql
    let requests: PendingRequests
    let lea: PlatformSession
    let leaAccount = false

    beforeAll(async () => {
      seed = seedWithAdmin()
      accounts = createFixtures()
      ref = await seedReferenceOrg(seed)
      await ref.write({ orgs: [{ id: OTHER_ORG.id, brand: BRAND }] })
      // Le compte Supabase Auth de Léa, à son identifiant semé, avant ses demandes (`user_id` vise `auth.users`).
      const created = await accounts.auth.auth.admin.createUser({ id: ref.people.lea.id, email: ref.people.lea.email, email_confirm: true })
      if (created.error) throw new Error(`createUser failed: ${created.error.message}`)
      leaAccount = true
      lea = { ...SESSION, user: { id: ref.people.lea.id, email: ref.people.lea.email }, db: asCaller(ref.people.lea.id, ref.people.lea.email) }
      requests = await pendingRequests(seed.admin)
    }, SETUP_TIMEOUT)

    afterAll(async () => {
      try {
        await requests?.cleanup()
      } finally {
        try {
          if (leaAccount) await accounts.auth.auth.admin.deleteUser(ref.people.lea.id)
        } finally {
          await seed?.cleanup()
        }
      }
    }, SETUP_TIMEOUT)

    beforeEach(() => {
      vi.mocked(getPlatformSession).mockResolvedValue(lea)
    })

    /** Une demande en attente de Léa pour la ressource MCP de cette adresse, par défaut celle de O. */
    function pending(host: string = ref.org.host): Promise<string> {
      return requests.pending(`https://${host}/api/mcp`, ref.people.lea.id)
    }

    it("should show the request under the default Oto root, the organisation of the resource named (AC12)", async () => {
      const id = await pending()

      render(await page({ authorization_id: id }))

      expect(screen.getAllByRole("heading", { level: 1 }).map((titre) => titre.textContent)).toEqual([
        "Claude demande l'accès à votre compte",
      ])
      // Sans nom affiché, celui de l'organisation : en en-tête (E09-S02) et sur la ligne « Organisation ».
      expect(screen.getAllByText(ref.org.name)).toHaveLength(2)
      expect(screen.getByText("claire@example.invalid")).toBeInTheDocument()
      const racines = document.querySelectorAll(".oto")
      expect(racines).toHaveLength(1)
      // Une marque vide rend le thème par défaut, que la page pose désormais (E09-S02).
      expect(racines[0]).toHaveAttribute("data-oto-theme", "manuscrit")
      expect(mocks.getAuthorizationDetails).toHaveBeenCalledWith(id)
    })

    // E09-S02, AC14 : la racine au thème de l'organisation de la ressource ; sans organisation connue, sans thème.
    it.each([
      ["the brand of its organisation", "branded", "foret"],
      ["no organisation at the address", "unknown", null],
    ] as const)("should dress the page in %s (E09-S02, AC14)", async (_cas, where, theme) => {
      const id = await pending(where === "branded" ? ref.other.host : "delta.example.test")

      render(await page({ authorization_id: id }))

      const racine = document.querySelector(".oto")
      if (theme) expect(racine).toHaveAttribute("data-oto-theme", theme)
      else expect(racine).not.toHaveAttribute("data-oto-theme")
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Claude demande l'accès à votre compte")
    })

    // Échec passager : la demande est toujours en attente, la page la remontre avec l'alerte.
    it("should show the request again, with the decision alert, after a transient failure (AC17)", async () => {
      render(await page({ authorization_id: await pending(), error: "decision" }))

      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Claude demande l'accès à votre compte")
      expect(screen.getByRole("alert")).toHaveTextContent("La décision n'a pas abouti. Rechargez la page, puis réessayez.")
    })

    it.each<string | string[]>(["autre", "", "deja_autorise", ["decision", "decision"]])(
      "should ignore the error %j, out of the closed list",
      async (erreur) => {
        render(await page({ authorization_id: await pending(), error: erreur }))

        expect(screen.queryByRole("alert")).toBeNull()
      },
    )
  },
)

describe("deciderConsentementAction", () => {
  it("should approve and go back to the assistant with its code (AC15)", async () => {
    await expect(deciderConsentementAction(form({ authorization_id: ID, decision: "approve" }))).rejects.toThrow(
      `NEXT_REDIRECT:${RETURN_CODE}`,
    )
    expect(mocks.getUser).toHaveBeenCalled()
    expect(mocks.getAuthorizationDetails).toHaveBeenCalledWith(ID)
    expect(mocks.approveAuthorization).toHaveBeenCalledWith(ID, { skipBrowserRedirect: true })
  })

  it("should deny and go back to the assistant with access_denied (AC16)", async () => {
    await expect(deciderConsentementAction(form({ authorization_id: ID, decision: "deny" }))).rejects.toThrow(
      `NEXT_REDIRECT:${RETURN_DENIED}`,
    )
    expect(mocks.denyAuthorization).toHaveBeenCalledWith(ID, { skipBrowserRedirect: true })
  })

  it("should come back to the request with error=decision when the SDK fails (AC17)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    mocks.approveAuthorization.mockResolvedValue({ data: null, error: { status: 500, message: "boom" } })

    await expect(deciderConsentementAction(form({ authorization_id: ID, decision: "approve" }))).rejects.toThrow(
      `NEXT_REDIRECT:${CONSENT}&error=decision`,
    )
  })

  it("should send a lost session to /login, back to the request, without any decision (AC18)", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null })

    await expect(deciderConsentementAction(form({ authorization_id: ID, decision: "approve" }))).rejects.toThrow(
      `NEXT_REDIRECT:${LOGIN_BACK}`,
    )
    expect(mocks.getAuthorizationDetails).not.toHaveBeenCalled()
    expect(mocks.approveAuthorization).not.toHaveBeenCalled()
  })

  it("should send a lost session with an altered id to /login, back to the page", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null })

    await expect(deciderConsentementAction(form({ authorization_id: "../x", decision: "approve" }))).rejects.toThrow(
      `NEXT_REDIRECT:/login?redirect=${encodeURIComponent("/oauth/consent")}`,
    )
  })

  it('should send an altered form {"authorization_id":"../../admin/users","decision":"approve"} back to /oauth/consent without calling the SDK (AC18)', async () => {
    await expect(deciderConsentementAction(form({ authorization_id: "../../admin/users", decision: "approve" }))).rejects.toThrow(/^NEXT_REDIRECT:\/oauth\/consent$/)
    expect(mocks.getAuthorizationDetails).not.toHaveBeenCalled()
    expect(mocks.approveAuthorization).not.toHaveBeenCalled()
    expect(mocks.denyAuthorization).not.toHaveBeenCalled()
  })
})
