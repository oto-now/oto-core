// La page de connexion d'un connecteur (`/connect/<connecteur>?space=…`, `connexion-par-l-agent.md` § Page) : sans
// session, la connexion ramène sur la même adresse ; l'ouverture ne part nulle part et n'appelle rien : un consentement
// ou un branchement part par le bouton, en `POST` de même origine, cette page pour retour ; le compte hébergé déjà relié
// ailleurs est dit avant le clic ; le retour du tiers dit son issue sans rien relancer ni croire l'adresse (raison
// connue seule, aucun nom de compte), l'invitation à revenir à l'assistant comprise ; un administrateur confirme
// l'activation par un bouton, jamais à l'ouverture ; un membre reçoit l'adresse à transmettre ; un espace refusé, une
// adresse publique absente se disent en `role="alert"`. Session de l'hôte et service simulés ; l'écran est le vrai.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { connectionStep, PlatformError, type PlatformDb } from "@otomata_tech/oto_platform/server"
import ConnexionDUnConnecteurPage from "@/app/(dashboard)/connect/[connector]/page"
import { getPlatformIdentity, getRequestOrigin, type PlatformSession } from "@/lib/plateforme/session"
import { identityOf, ORG } from "../../helpers/reference-org"

vi.mock("@/lib/plateforme/session", () => ({ getPlatformIdentity: vi.fn(), getRequestOrigin: vi.fn() }))

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
}))

vi.mock("@otomata_tech/oto_platform/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@otomata_tech/oto_platform/server")>()),
  connectionStep: vi.fn(),
}))

const ORIGINE = "https://demo.example.test"
const IDENTITE = identityOf("lea", { org: { id: ORG.id, slug: "demo", name: "Démo", prefix: "demo", brand: {}, domains: null } })
const SESSION: PlatformSession = { user: { id: IDENTITE.user.id, email: IDENTITE.user.email }, accessToken: "session-token", host: "demo.example.test", db: {} as PlatformDb }

const page = (query: Record<string, string>) => ConnexionDUnConnecteurPage({ params: Promise.resolve({ connector: "crm" }), searchParams: Promise.resolve(query) })

async function montrer(query: Record<string, string>) {
  const rendu = await page(query)
  await act(async () => {
    render(rendu)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, "error").mockImplementation(() => {})
  vi.mocked(getPlatformIdentity).mockResolvedValue({ data: { identity: IDENTITE, session: SESSION } })
  vi.mocked(getRequestOrigin).mockResolvedValue(ORIGINE)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("connection page of a connector", () => {
  it("should send someone not signed in to the login, coming back to the same link", async () => {
    vi.mocked(getPlatformIdentity).mockResolvedValue({ error: { code: "unauthenticated" } })
    await expect(page({ space: "team:ventes" })).rejects.toThrow(`NEXT_REDIRECT:/login?redirect=${encodeURIComponent("/connect/crm?space=team%3Aventes")}`)
    expect(connectionStep).not.toHaveBeenCalled()
  })

  it("should send a member of no organisation of this address to /no-organization, deciding nothing", async () => {
    vi.mocked(getPlatformIdentity).mockResolvedValue({ error: { code: "not_member" } })
    await expect(page({ space: "me" })).rejects.toThrow("NEXT_REDIRECT:/no-organization")
    expect(connectionStep).not.toHaveBeenCalled()
  })

  it("should show the consent button without going anywhere nor calling anything, and start the consent only on its click, by a POST, this page for return", async () => {
    const envoi = vi.fn(async () => new Response(JSON.stringify({ data: { url: "https://login.crm.example.test/authorize?state=s" } }), { status: 200 }))
    const assign = vi.fn()
    vi.stubGlobal("fetch", envoi)
    vi.stubGlobal("location", { ...window.location, assign })
    try {
      vi.mocked(connectionStep).mockResolvedValue({ kind: "authorize", gesture: "oauth", connector: "crm", label: "Crm", space: "team:ventes" })
      await montrer({ space: "team:ventes", extra: "x" })
      expect(connectionStep).toHaveBeenCalledWith(SESSION.db, IDENTITE, { connector: "crm", space: "team:ventes" }, { origin: ORIGINE })
      expect([envoi.mock.calls.length, assign.mock.calls.length]).toEqual([0, 0])
      fireEvent.click(screen.getByRole("button", { name: "Autoriser Crm" }))
      await waitFor(() => expect(assign).toHaveBeenCalledWith("https://login.crm.example.test/authorize?state=s"))
      const [adresse, envoye] = envoi.mock.calls[0] as unknown as [string, RequestInit]
      expect([adresse, envoye.method, JSON.parse(String(envoye.body))]).toEqual(["/api/platform/connector-consent", "POST", { connector: "crm", return_to: "/connect/crm?space=team%3Aventes" }])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it("should say a hosted account already linked in another organisation before the click that links it here", async () => {
    vi.mocked(connectionStep).mockResolvedValue({ kind: "authorize", gesture: "hosted_link", connector: "crm", label: "Crm", space: "me", elsewhere: ["Atelier Nord"] })
    await montrer({ space: "me" })
    expect(screen.getByText("Votre compte Crm est déjà utilisé dans Atelier Nord. Le bouton le relie aussi à cette organisation.")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Relier mon compte Crm" })).toBeTruthy()
  })

  it("should tell the outcome of the return, inviting to go back to the assistant, without starting anything again nor showing the text of the address", async () => {
    await montrer({ space: "me", consent: "connected", account: "Votre compte est suspendu, appelez le 01 23 45 67 89" })
    expect(screen.getByText("Le compte est connecté.")).toBeTruthy()
    expect(screen.getByText("Vous pouvez revenir à votre assistant et lui demander de reprendre.")).toBeTruthy()
    expect(document.body.textContent).not.toContain("appelez")
    expect(connectionStep).not.toHaveBeenCalled()
    cleanup()
    await montrer({ space: "me", consent: "failed", reason: "invalid_arguments" })
    expect(screen.getByText("La connexion n'a pas abouti : refusée, annulée, expirée ou déjà servie. Recommencez.")).toBeTruthy()
    expect(screen.getByRole("link", { name: "Réessayer" }).getAttribute("href")).toBe("/connect/crm?space=me")
    cleanup()
    // Une raison inconnue, écrite par un lien forgé : la phrase générique, jamais son texte.
    await montrer({ space: "me", consent: "failed", reason: "Votre compte est suspendu, appelez le 01 23 45 67 89" })
    expect(screen.getByText("La connexion a échoué. Réessayez.")).toBeTruthy()
    expect(document.body.textContent).not.toContain("appelez")
    cleanup()
    await montrer({ space: "me", consent: "failed", reason: "toString" })
    expect(screen.getByText("La connexion a échoué. Réessayez.")).toBeTruthy()
  })

  it("should ask an administrator to confirm the activation with a button, and give a member the link to pass on", async () => {
    vi.mocked(connectionStep).mockResolvedValue({ kind: "activate", connector: "crm", label: "Crm", space: "org" })
    await montrer({ space: "org", activate: "1" })
    expect(screen.getByRole("button", { name: "Activer Crm" })).toBeTruthy()
    cleanup()
    const lien = `${ORIGINE}/connect/crm?space=me&activate=1`
    vi.mocked(connectionStep).mockResolvedValue({ kind: "ask_admin", connector: "crm", label: "Crm", space: "me", url: lien, administrators: [{ name: "Ada Martin" }] })
    await montrer({ space: "me", activate: "1" })
    expect(screen.getByText(/Seul un administrateur de l'organisation peut activer Crm .* : Ada Martin\./)).toBeTruthy()
    expect(screen.getByText(lien)).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Activer Crm" })).toBeNull()
  })

  it("should say a refused space, and a missing public address, in an alert", async () => {
    vi.mocked(connectionStep).mockRejectedValue(new PlatformError("forbidden", "You cannot connect Crm in org: only an administrator connects an account of the organisation.", { reason: "space", space: "org" }))
    await montrer({ space: "org" })
    expect(screen.getByRole("alert").textContent).toContain("Connexion impossible")
    cleanup()
    vi.mocked(getRequestOrigin).mockResolvedValue(null)
    await montrer({ space: "me" })
    expect(screen.getByRole("alert").textContent).toContain("L'adresse publique de cette organisation n'est pas réglée")
    expect(connectionStep).toHaveBeenCalledTimes(1)
  })
})
