// Les pages `/admin/*` du tableau de bord (E08-S03, AC1) : l'accès décidé par `isOrgAdmin` de
// l'identité, avant tout appel de service ; le même droit pose le fil de l'en-tête (E05-S09 partie d2). « Connecteurs »
// s'ouvre aux membres : à qui n'administre pas, ses seuls comptes personnels et leurs partages.
// « Organisation » porte aussi la marque et le Contexte de Tout le monde (E05-S11, AC-22, AC-24) ; « Drapeaux »
// et « Accès plateforme » n'ont plus d'adresse : 404 (E11-S07, `tests/e2e/e11s07-adresses.spec.ts`).
// Session de l'hôte et services du paquet simulés ; `isOrgAdmin`, `readBrand` et les écrans sont les vrais.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readOrgView } from "@otomata_tech/oto_platform/api"
import type { NodeView } from "@otomata_tech/oto_platform/schemas"
import type { AccountView } from "@otomata_tech/oto_platform/schemas"
import {
  deactivationImpact,
  listAccountRules,
  listConnectorsForOrg,
  listOrgAccounts,
  listOwnAccounts,
  listShares,
  listTeams,
  loadNode,
  previewContext,
  type Identity,
  type PlatformDb,
} from "@otomata_tech/oto_platform/server"
import ConnecteursPage, { metadata as connecteursMetadata } from "@/app/(dashboard)/admin/connectors/page"
import OrganisationPage, { metadata as organisationMetadata } from "@/app/(dashboard)/admin/organization/page"
import AdminPage from "@/app/(dashboard)/admin/page"
import { getPlatformIdentitySafely, type PlatformSession } from "@/lib/plateforme/session"

vi.mock("@/lib/plateforme/session", () => ({ getPlatformIdentitySafely: vi.fn() }))

vi.mock("@/lib/actions/auth", () => ({ logoutAction: vi.fn() }))

// redirect() lève NEXT_REDIRECT dans Next : le mock lève aussi, le rendu s'arrête comme en production.
// La navigation et le fournisseur de relecture du layout lisent le routeur, absent ici.
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
  usePathname: () => "/",
  useRouter: () => ({ refresh: vi.fn() }),
}))

vi.mock("@otomata_tech/oto_platform/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@otomata_tech/oto_platform/server")>()),
  listConnectorsForOrg: vi.fn(),
  listOrgAccounts: vi.fn(),
  listOwnAccounts: vi.fn(),
  listAccountRules: vi.fn(),
  listTeams: vi.fn(),
  deactivationImpact: vi.fn(),
  listShares: vi.fn(),
  loadNode: vi.fn(),
  // L'aperçu du Contexte servi de la même page (E05-S13, lot A), vide ici.
  previewContext: vi.fn(async () => ({ text: "", blocks: [], budget: 20_000, served: null, candidates: [] })),
  // L'option « Retours visibles » de la même page (1.4.13), éteinte ici.
  listFlags: vi.fn(async () => [{ name: "feedback_visible", description: "Retours visibles.", enabled: false }]),
}))

vi.mock("@otomata_tech/oto_platform/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@otomata_tech/oto_platform/api")>()),
  readOrgView: vi.fn(),
}))

// Les services qui liraient la base sont simulés : un client vide suffit.
const SESSION: PlatformSession = { user: { id: "user-1", email: "claire@demo.test" }, accessToken: "session-token", host: "demo.localhost:3000", db: {} as PlatformDb }

type Profil = "admin" | "member" | "staff-member"

function identite(profil: Profil, brand: Identity["org"]["brand"] = {}): Identity {
  return {
    org: { id: "org-1", slug: "demo", name: "Démo", prefix: "demo", brand, domains: null },
    user: { id: SESSION.user.id, email: SESSION.user.email, name: "Claire Morel" },
    member: { role: profil === "admin" ? "admin" : "member", profile: {} },
    teams: [],
    // Membre simple de l'organisation et de l'équipe plateforme, avec un accès en cours (fiche D17).
    isStaff: profil === "staff-member",
    viaGrant: false,
    hasOpenGrant: profil === "staff-member",
  }
}

const connecte = (profil: Profil, brand: Identity["org"]["brand"] = {}) => ({ data: { identity: identite(profil, brand), session: SESSION } })
const fil = () => screen.queryByRole("navigation", { name: "Chemin" })
const organisation = (saved?: string) => OrganisationPage({ searchParams: Promise.resolve(saved ? { saved } : {}) })

// Le Contexte de Tout le monde, tel que `loadNode` le rend, réduit à son chemin et ses blocs publiés : la page
// n'en lit que les blocs, d'où l'assertion sur un nœud partiel.
const CONTEXTE = {
  path: "contexte",
  blocks: [{ id: "bloc-1", ref: "b1", type: "paragraph", text: "Nous vendons des pompes.", data: {}, key: null, position: 1, revision: 1, provenance: {} }],
} as unknown as NodeView

const SERVICES = [readOrgView, listConnectorsForOrg, listOrgAccounts, listTeams, deactivationImpact, listShares, loadNode, previewContext]

// `fil` : Connecteurs n'est plus rangé dans le menu de l'entreprise mais au pied du rail (E05-S11, AC-32) : sans groupe, sans fil.
const PAGES = [
  { nom: "/admin/organization", rendre: () => organisation(), titre: "Organisation", lecture: readOrgView, fil: true },
  { nom: "/admin/connectors", rendre: () => ConnecteursPage({}), titre: "Connecteurs", lecture: listConnectorsForOrg, fil: false },
]
const [PAGE_ORGANISATION] = PAGES

/** Un compte personnel de qui regarde, qu'il gère : la page en lit les partages. */
const MON_COMPTE: AccountView = { id: "6b2f3c1d-4e5a-4b6c-8d7e-9f0a1b2c3d4e", label: "Mail Claire", connector: "mail", owner: { kind: "user" }, mode: "simule", status: "active", viewerLevel: "manage" }
const PARTAGES = { id: MON_COMPTE.id, label: MON_COMPTE.label, owner: { kind: "user" as const, teamId: null, userId: "user-1" }, viewerLevel: 4 as const, rules: [], general: { id: "regle-1", level: "write" as const } }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(readOrgView).mockResolvedValue({
    name: "Démo",
    slug: "demo",
    prefix: "demo",
    tools: [],
    hosts: [],
    domains: "",
    routing: { threshold: null, gap: null },
    contact: null,
  })
  vi.mocked(listConnectorsForOrg).mockResolvedValue([
    { connector: "mail", state: "active", activatedAt: "2026-09-24T10:00:00.000Z", activatedBy: null, functions: [] },
  ])
  vi.mocked(listOrgAccounts).mockResolvedValue([])
  vi.mocked(listOwnAccounts).mockResolvedValue([])
  vi.mocked(listTeams).mockResolvedValue([])
  vi.mocked(deactivationImpact).mockResolvedValue({ functions: [], procedures: [], accounts: 0 })
  vi.mocked(listShares).mockResolvedValue([])
  vi.mocked(loadNode).mockResolvedValue(CONTEXTE)
})

afterEach(() => {
  cleanup()
})

describe("/admin/* pages of the dashboard (AC1)", () => {
  it.each([PAGE_ORGANISATION])("should tell a member who does not administer the organisation that $nom is reserved, calling no service", async ({ rendre, titre }) => {
    vi.mocked(getPlatformIdentitySafely).mockResolvedValue(connecte("member"))

    render(await rendre())

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(titre)
    expect(screen.getByRole("alert")).toHaveTextContent("Cette page est réservée aux administrateurs de Démo.")
    for (const service of SERVICES) expect(service).not.toHaveBeenCalled()
    // Le fil suit le menu de l'entreprise : à qui n'administre pas, aucun écran d'administration.
    expect(fil()).toBeNull()
    // Ni marque ni Contexte à qui n'administre pas (E05-S11, AC-22, AC-24).
    expect(screen.queryByRole("region", { name: "La couleur" })).toBeNull()
  })

  it.each(PAGES)("should serve $nom to a plain member of the platform team with an access in progress (D17), with the session's client", async ({ rendre, lecture, fil: avecFil }) => {
    vi.mocked(getPlatformIdentitySafely).mockResolvedValue(connecte("staff-member"))

    await act(async () => {
      render(await rendre())
    })

    expect(lecture).toHaveBeenCalledWith(SESSION.db, identite("staff-member"))
    expect(screen.queryByRole("alert")).toBeNull()
    expect(fil() !== null).toBe(avecFil)
  })

  it("should show a member who does not administer only their own accounts on /admin/connectors, with the shares of those they manage", async () => {
    vi.mocked(getPlatformIdentitySafely).mockResolvedValue(connecte("member"))
    vi.mocked(listOwnAccounts).mockResolvedValue([MON_COMPTE, { ...MON_COMPTE, id: "7c3a4d2e-5f6b-4c7d-9e8f-0a1b2c3d4e5f", label: "Mail restreint", viewerLevel: "write" }])
    vi.mocked(listAccountRules).mockResolvedValue(PARTAGES)

    await act(async () => {
      render(await ConnecteursPage({}))
    })

    expect(listOwnAccounts).toHaveBeenCalledWith(SESSION.db, identite("member"))
    // Les partages du seul compte qu'il gère ; ni le catalogue, ni les comptes de l'organisation.
    expect(vi.mocked(listAccountRules).mock.calls).toEqual([[SESSION.db, identite("member"), MON_COMPTE.id]])
    for (const service of [listConnectorsForOrg, listOrgAccounts, deactivationImpact]) expect(service).not.toHaveBeenCalled()
    expect(screen.queryByRole("alert")).toBeNull()
    expect(screen.queryByRole("region", { name: "Connecteurs" })).toBeNull()
    const comptes = within(screen.getByRole("region", { name: "Mes comptes" }))
    expect(within(comptes.getByRole("list", { name: "Partages de Mail Claire" })).getByText("toute l'organisation · en écriture")).toBeInTheDocument()
    expect(fil()).toBeNull()
  })

  it("should give an administrator of /admin/organization the brand of the identity, and say it was saved on ?saved=1 (E05-S11, AC-22 ; E11-S07, AC-b6)", async () => {
    vi.mocked(getPlatformIdentitySafely).mockResolvedValue(connecte("admin", { theme: "lagune", logo_url: "https://example.com/logo.png" }))
    await act(async () => {
      render(await organisation("1"))
    })

    expect(screen.getByRole("region", { name: "L’entreprise" }).querySelector("img")).toHaveAttribute("src", "https://example.com/logo.png")
    expect(screen.getByLabelText("Adresse du logo (https)")).toHaveValue("https://example.com/logo.png")
    expect(within(screen.getByRole("region", { name: "La couleur" })).getByRole("radio", { name: "Lagune" })).toBeChecked()
    expect(within(screen.getByRole("region", { name: "La couleur" })).getByRole("status")).toHaveTextContent("Marque enregistrée.")
  })

  it("should read the Contexte of Tout le monde with the session's client for an administrator, and open it by « Modifier » (E05-S11, AC-24)", async () => {
    vi.mocked(getPlatformIdentitySafely).mockResolvedValue(connecte("admin"))
    await act(async () => {
      render(await organisation())
    })

    expect(loadNode).toHaveBeenCalledWith(SESSION.db, identite("admin"), { path: "contexte" })
    expect(previewContext).toHaveBeenCalledWith(SESSION.db, identite("admin"), {})
    const contexte = within(screen.getByRole("region", { name: "Contexte · Tout le monde" }))
    expect(contexte.getByText("Nous vendons des pompes.")).toBeInTheDocument()
    expect(contexte.getByRole("link", { name: "Modifier" })).toHaveAttribute("href", "/n/contexte")
  })

  it("should read the impact of deactivating each active connector for the connectors page, and put it in the question", async () => {
    vi.mocked(getPlatformIdentitySafely).mockResolvedValue(connecte("admin"))
    render(await ConnecteursPage({}))
    expect(deactivationImpact).toHaveBeenCalledWith(SESSION.db, identite("admin"), "mail")
    expect(listOrgAccounts).toHaveBeenCalledWith(SESSION.db, identite("admin"))

    // L'impact simulé, indexé par le nom du connecteur, arrive dans la question (AC5).
    fireEvent.click(screen.getByRole("button", { name: "Désactiver mail" }))
    expect(
      screen.getByText("Désactiver « mail » ? Ses fonctions cesseront aussitôt de répondre, pour tout le monde. Aucune procédure publiée ne le cite. Il n'a aucun compte."),
    ).toBeInTheDocument()
  })

  it.each(PAGES)("should send a visitor without a session from $nom to /login, and say a failed identity", async ({ rendre }) => {
    vi.mocked(getPlatformIdentitySafely).mockResolvedValue({ error: { code: "unauthenticated" } })
    await expect(rendre()).rejects.toThrow("NEXT_REDIRECT:/login")

    vi.mocked(getPlatformIdentitySafely).mockResolvedValue(null)
    render(await rendre())
    expect(screen.getByRole("alert")).toHaveTextContent("Une erreur est survenue. Réessayez.")
    for (const service of SERVICES) expect(service).not.toHaveBeenCalled()
  })

  it("should open /admin on the organisation, and title the pages out of the index", () => {
    expect(() => AdminPage()).toThrow("NEXT_REDIRECT:/admin/organization")
    for (const [metadata, titre] of [
      [organisationMetadata, "Organisation"],
      [connecteursMetadata, "Connecteurs"],
    ] as const) {
      expect(metadata).toMatchObject({ title: titre, robots: { index: false } })
    }
  })
})
