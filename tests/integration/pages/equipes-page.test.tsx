// La page `/teams` (E05-S03 : AC1, AC2, AC5 ; E05-S09 partie d1 : les réglages des tableaux lus dans
// l'adresse ; E05-S13, AC-5 : plus d'onglets « Règles d'accès » ni « Accès plateforme ») : la session revérifiée par la page (`nextjs-patterns.md § Un layout n'est JAMAIS une
// frontière d'autorisation`), les lectures des services avec le client de la session, et leurs refus
// traduits en états d'écran. Session de l'hôte et services du paquet simulés ; l'écran est le vrai.
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  invitationOptions,
  listInvitations,
  listMembers,
  listNodeRules,
  listPlatformAccess,
  listRuledNodes,
  listTeams,
  PlatformError,
  type Identity,
  type PlatformDb,
} from "@otomata_tech/oto_platform/server"
import EquipesLoading from "@/app/(dashboard)/teams/loading"
import EquipesPage, { metadata } from "@/app/(dashboard)/teams/page"
import { getPlatformIdentitySafely, type PlatformSession } from "@/lib/plateforme/session"

vi.mock("@/lib/plateforme/session", () => ({ getPlatformIdentitySafely: vi.fn() }))

// redirect() lève NEXT_REDIRECT dans Next : le mock lève aussi, le rendu s'arrête comme en production.
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
}))

vi.mock("@otomata_tech/oto_platform/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@otomata_tech/oto_platform/server")>()),
  invitationOptions: vi.fn(),
  listInvitations: vi.fn(),
  listMembers: vi.fn(),
  listNodeRules: vi.fn(),
  listPlatformAccess: vi.fn(),
  listRuledNodes: vi.fn(),
  listTeams: vi.fn(),
}))

const ADA = "0b6f1f0e-1c1a-4a8e-9a51-0d7c1a2b3c01"
const ECHEC = "Une erreur est survenue. Réessayez."

// Les services qui liraient la base sont simulés : un client vide suffit.
const SESSION: PlatformSession = {
  user: { id: ADA, email: "ada@demo.test" },
  accessToken: "session-token",
  host: "demo.localhost:3000",
  db: {} as PlatformDb,
}

function identite(role: "admin" | "member"): Identity {
  return {
    org: { id: "org-1", slug: "demo", name: "Démo", prefix: "demo", brand: {}, domains: null },
    user: { id: ADA, email: SESSION.user.email, name: "Ada Martin" },
    member: { role, profile: {} },
    teams: [],
    isStaff: false,
    viaGrant: false,
    hasOpenGrant: false,
  }
}

const connecte = (role: "admin" | "member") => ({ data: { identity: identite(role), session: SESSION } })
const page = (parametres: Record<string, string> = {}) => EquipesPage({ searchParams: Promise.resolve(parametres) })
const refusDInviter = () => new PlatformError("forbidden", "Only administrators and team leads can invite people.", { reason: "not_allowed" })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(listMembers).mockResolvedValue([
    { userId: ADA, email: "ada@demo.test", name: "Ada Martin", role: "admin", teams: [], lastSignInAt: null, isSelf: true },
  ])
  vi.mocked(listInvitations).mockResolvedValue([])
  vi.mocked(invitationOptions).mockResolvedValue({ roles: ["member", "admin"], teams: [], teamRequired: false })
  vi.mocked(listTeams).mockResolvedValue([])
  vi.mocked(listRuledNodes).mockResolvedValue([])
  vi.mocked(listPlatformAccess).mockResolvedValue({ accesses: [], addedByStaff: [] })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("/teams page session", () => {
  it("should send a visitor without a session to /login, reading nothing", async () => {
    vi.mocked(getPlatformIdentitySafely).mockResolvedValue({ error: { code: "unauthenticated" } })
    await expect(page()).rejects.toThrow("NEXT_REDIRECT:/login")
    expect(listMembers).not.toHaveBeenCalled()
  })

  it.each(["unknown_org", "not_member"] as const)("should send %s to /no-organization", async (code) => {
    vi.mocked(getPlatformIdentitySafely).mockResolvedValue({ error: { code } })
    await expect(page()).rejects.toThrow("NEXT_REDIRECT:/no-organization")
  })

  it("should say the lists failed, reading nothing, when the identity cannot be resolved (AC2)", async () => {
    vi.mocked(getPlatformIdentitySafely).mockResolvedValue(null)

    render(await page())

    expect(screen.getByRole("alert")).toHaveTextContent(ECHEC)
    expect(listMembers).not.toHaveBeenCalled()
  })

  it.each(["teams"])("should say the failure on the %s tab, with « Réessayer », when the identity cannot be resolved (AC2)", async (onglet) => {
    vi.mocked(getPlatformIdentitySafely).mockResolvedValue(null)

    render(await page({ tab: onglet }))

    expect(screen.getByRole("alert")).toHaveTextContent(ECHEC)
    expect(screen.getByRole("link", { name: "Réessayer" })).toHaveAttribute("href", `/teams?tab=${onglet}`)
    expect(listTeams).not.toHaveBeenCalled()
  })

  it("should be titled Équipes & accès and not indexed", () => {
    expect(metadata).toMatchObject({ title: "Équipes & accès", robots: { index: false } })
  })

  it("should show the loading state while the page loads (AC2)", () => {
    render(<EquipesLoading />)
    expect(screen.getByRole("status")).toHaveTextContent("Chargement des équipes et des accès…")
  })
})

describe("/teams page reads (AC1, AC5)", () => {
  it("should read the lists with the session client and show the members tab, with the form, to an administrator", async () => {
    vi.mocked(getPlatformIdentitySafely).mockResolvedValue(connecte("admin"))

    render(await page())

    expect(listMembers).toHaveBeenCalledWith(SESSION.db, identite("admin"))
    expect(listInvitations).toHaveBeenCalledWith(SESSION.db, identite("admin"), { state: "pending" })
    expect(invitationOptions).toHaveBeenCalledWith(SESSION.db, identite("admin"))
    expect(listTeams).toHaveBeenCalledWith(SESSION.db, identite("admin"))
    expect(listRuledNodes).not.toHaveBeenCalled()
    expect(listPlatformAccess).not.toHaveBeenCalled()
    expect(screen.getByRole("heading", { level: 1, name: "Équipes & accès" })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: /^Membres/ })).toHaveAttribute("aria-selected", "true")
    expect(screen.getByRole("button", { name: "Inviter quelqu'un" })).toBeInTheDocument()
  })

  it("should read the search, the filter and the sort of the tables in the address, an unreadable value falling back to its default", async () => {
    vi.mocked(getPlatformIdentitySafely).mockResolvedValue(connecte("admin"))

    render(await page({ q: "ada", order: "desc", filter: "inconnu" }))

    expect(screen.getByRole("searchbox", { name: "Chercher une personne" })).toHaveValue("ada")
    expect(screen.getByRole("columnheader", { name: /Personne/ })).toHaveAttribute("aria-sort", "descending")
    expect(within(screen.getByRole("group", { name: "Les personnes en chiffres" })).getAllByRole("button")[0]).toHaveAttribute("aria-pressed", "true")
  })

  it("should read the tab, the filter and the search under their English names (E11-S07, AC-b2)", async () => {
    vi.mocked(getPlatformIdentitySafely).mockResolvedValue(connecte("admin"))

    render(await page({ q: "ada", filter: "invitations" }))

    expect(screen.getByRole("searchbox", { name: "Chercher une personne" })).toHaveValue("ada")
    expect(within(screen.getByRole("group", { name: "Les personnes en chiffres" })).getAllByRole("button")[1]).toHaveAttribute("aria-pressed", "true")
    cleanup()
    render(await page({ tab: "teams", sort: "people", order: "desc" }))
    expect(screen.getByRole("tab", { name: /^Équipes/ })).toHaveAttribute("aria-selected", "true")
  })

  // 1.4.13 : une page qui bloque la suppression d'une équipe mène à son adresse, sous la route des pages de l'hôte.
  it("should give the screen the address prefix of the pages", async () => {
    vi.mocked(getPlatformIdentitySafely).mockResolvedValue(connecte("admin"))

    expect((await page({ tab: "teams" })).props).toMatchObject({ prefixeDesPages: "/n/" })
  })

  it("should mount no form and show no alert when a plain member may not invite (forbidden, AC5)", async () => {
    vi.mocked(getPlatformIdentitySafely).mockResolvedValue(connecte("member"))
    vi.mocked(invitationOptions).mockRejectedValue(refusDInviter())

    render(await page())

    expect(screen.queryByRole("button", { name: "Inviter quelqu'un" })).toBeNull()
    expect(screen.queryByRole("alert")).toBeNull()
    expect(screen.getByRole("table", { name: "Les personnes de Démo" })).toBeInTheDocument()
  })

  it("should say a failure of the invitation options that is not a refusal (AC2)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    vi.mocked(getPlatformIdentitySafely).mockResolvedValue(connecte("admin"))
    vi.mocked(invitationOptions).mockRejectedValue(new PlatformError("internal", "Internal error."))

    render(await page())

    expect(screen.getByRole("alert")).toHaveTextContent(ECHEC)
    expect(screen.queryByRole("button", { name: "Inviter quelqu'un" })).toBeNull()
  })
})

// E05-S13 (AC-5, fiche D127 b, c) : les deux onglets retirés ouvrent « Membres », et leurs lectures ne partent plus.
describe("/teams page without the rules and platform access tabs (AC-5)", () => {
  it("should open Membres for ?tab=regles, reading neither the rules nor the platform accesses", async () => {
    vi.mocked(getPlatformIdentitySafely).mockResolvedValue(connecte("admin"))

    render(await page({ tab: "regles", noeud: "ventes" }))

    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Membres1", "Équipes0"])
    expect(screen.getByRole("tab", { name: /^Membres/ })).toHaveAttribute("aria-selected", "true")
    expect([listRuledNodes, listNodeRules, listPlatformAccess].map((lecture) => vi.mocked(lecture).mock.calls.length)).toEqual([0, 0, 0])
  })
})

// La page traduit l'identité en `moi` : les équipes que la personne dirige commandent la composition
// (AC13), son identifiant l'annulation de ses invitations (AC6). Ada dirige Ventes, fait partie de
// Support, et n'est pas administratrice (`testing-strategy.md § Anti-patterns`).
describe("/teams page for a lead who is not an administrator (AC6, AC13)", () => {
  const CLAIRE = "0b6f1f0e-1c1a-4a8e-9a51-0d7c1a2b3c02"
  const MARC = "0b6f1f0e-1c1a-4a8e-9a51-0d7c1a2b3c03"
  const VENTES = "0e8e5a3c-7f10-4a5b-8d3b-2b1c4d5e6f70"
  const SUPPORT = "5b0d1c56-0f3a-4a57-9d8e-6f1f1b9e2c11"
  const personne = (userId: string, name: string, role: "lead" | "member") => ({ userId, name, email: `${name.split(" ")[0].toLowerCase()}@demo.test`, role })

  beforeEach(() => {
    const responsable: Identity = {
      ...identite("member"),
      teams: [
        { id: VENTES, slug: "ventes", name: "Ventes", role: "lead" },
        { id: SUPPORT, slug: "support", name: "Support", role: "member" },
      ],
    }
    vi.mocked(getPlatformIdentitySafely).mockResolvedValue({ data: { identity: responsable, session: SESSION } })
    const membre = (userId: string, name: string) => ({ ...personne(userId, name, "member"), role: "member" as const, teams: [], lastSignInAt: null, isSelf: userId === ADA })
    vi.mocked(listMembers).mockResolvedValue([membre(ADA, "Ada Martin"), membre(CLAIRE, "Claire Morel"), membre(MARC, "Marc Petit")])
    // Marc n'est dans aucune équipe : chacune a un candidat à ajouter.
    vi.mocked(listTeams).mockResolvedValue([
      { id: SUPPORT, slug: "support", name: "Support", leadName: "Claire Morel", members: [personne(CLAIRE, "Claire Morel", "lead"), personne(ADA, "Ada Martin", "member")] },
      { id: VENTES, slug: "ventes", name: "Ventes", leadName: "Ada Martin", members: [personne(ADA, "Ada Martin", "lead")] },
    ])
    vi.mocked(invitationOptions).mockResolvedValue({ roles: ["member"], teams: [{ id: VENTES, slug: "ventes", name: "Ventes" }], teamRequired: true })
    const invitation = (id: string, email: string, teamId: string, invitedBy: string) => ({
      id,
      email,
      role: "member" as const,
      teamId,
      invitedBy,
      createdAt: "2026-09-24T10:00:00Z",
      expiresAt: "2026-10-01T10:00:00Z",
      state: "pending" as const,
    })
    vi.mocked(listInvitations).mockResolvedValue([
      invitation("4a1b2c3d-5e6f-4a7b-8c9d-0e1f2a3b4c01", "par-ada@demo.test", VENTES, ADA),
      invitation("4a1b2c3d-5e6f-4a7b-8c9d-0e1f2a3b4c02", "par-claire@demo.test", SUPPORT, CLAIRE),
    ])
  })

  it("should let the lead compose the team she leads, and not the team she is only part of (AC13)", async () => {
    render(await page({ tab: "teams" }))

    expect(screen.getByRole("button", { name: "Gérer Ventes" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Gérer Support" })).toBeNull()
  })

  it("should let the lead cancel the invitation she sent, and not another one (AC6)", async () => {
    render(await page())

    expect(screen.getByRole("button", { name: "Gérer par-ada@demo.test" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Gérer par-claire@demo.test" })).toBeNull()
  })
})

// Un membre de l'équipe plateforme, membre simple de l'organisation, l'administre tant que son accès
// est en cours, comme pour les services (`isOrgAdmin`, HN-E05S03-40, fiche D17).
describe("/teams page for a platform staff member who is a plain member (HN-E05S03-40)", () => {
  const staff = (hasOpenGrant: boolean): Identity => ({ ...identite("member"), isStaff: true, hasOpenGrant })

  it("should give the administrator's gestures while the access is current, and not once it is revoked", async () => {
    vi.mocked(getPlatformIdentitySafely).mockResolvedValue({ data: { identity: staff(true), session: SESSION } })
    render(await page({ tab: "teams" }))
    expect(screen.getByRole("button", { name: "Créer une équipe" })).toBeInTheDocument()

    cleanup()
    vi.mocked(getPlatformIdentitySafely).mockResolvedValue({ data: { identity: staff(false), session: SESSION } })
    render(await page({ tab: "teams" }))
    expect(screen.queryByRole("button", { name: "Créer une équipe" })).toBeNull()
  })
})
