// @vitest-environment node
// La porte seule pour les ressources d'E05-S03 (AC19) : deux routes d'une même méthode se départagent par
// leurs segments fixes, qui nomment aussi l'outil du journal. Identité par l'adresse et services simulés ;
// la ligne de journal s'écrit sur une vraie base, en suite portable (E01-S10, partie e1a : `writeJournal`
// passe au SQL ; AC-x3, fiche D76 A), sous le client de l'appelant vérifié (`asCaller`, sans Supabase Auth),
// et la connexion d'administration la relit. `api-equipes.test.ts` rejoue les statuts et le journal avec
// les vrais services, sur le projet.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { handlePlateforme } from "@otomata_tech/oto_platform/api"
import { PlatformError, type Identity } from "@otomata_tech/oto_platform/server"
import type { VerifyToken } from "../../packages/plateforme/mcp/auth"
import { resolveIdentity } from "../../packages/plateforme/server/identity"
import { removeRule, setNodeRule } from "../../packages/plateforme/server/rules"
import { addTeamMember, createTeam, deleteTeam, removeTeamMember, setTeamMemberRole, updateTeam } from "../../packages/plateforme/server/teams"
import { TEAMS } from "../helpers/reference-org"
import { seedReferenceOrg, type ReferenceOrgSql } from "../helpers/reference-org-sql"
import { seedWithAdmin, SQL_SKIP_REASON, sqlConfigured, type SeededData } from "../helpers/sql"

// Le client que la porte construit : celui de l'appelant que le vérificateur lui a rendu, face SQL seule.
vi.mock("../../packages/plateforme/server/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../packages/plateforme/server/db")>()
  const { asCaller } = await import("../helpers/sql")
  return {
    ...original,
    // Le vérificateur du test ne dit pas son émetteur : l'appelant porte son identifiant interne (E01-S11).
    createPlatformDb: vi.fn((session: Parameters<typeof original.createPlatformDb>[0]) =>
      asCaller(session.caller && "userId" in session.caller ? session.caller.userId : "", session.caller?.email ?? undefined),
    ),
  }
})

vi.mock("../../packages/plateforme/server/identity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../packages/plateforme/server/identity")>()),
  resolveIdentity: vi.fn(),
}))

vi.mock("../../packages/plateforme/server/teams", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../packages/plateforme/server/teams")>()),
  createTeam: vi.fn(),
  updateTeam: vi.fn(),
  deleteTeam: vi.fn(),
  addTeamMember: vi.fn(),
  removeTeamMember: vi.fn(),
  setTeamMemberRole: vi.fn(),
}))

vi.mock("../../packages/plateforme/server/rules", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../packages/plateforme/server/rules")>()),
  setNodeRule: vi.fn(),
  removeRule: vi.fn(),
}))

const SETUP_TIMEOUT = 180_000
const SUITE = "teams, members, rules and platform-access routes on a real database (AC19)"
const HOST = "acme.test"
const USER = "5b0d1c56-0f3a-4a57-9d8e-6f1f1b9e2c11"

/** Une ligne du journal, relue par la connexion d'administration. */
type JournalLine = { tool: string | null; target: string | null; team_id: string | null; args: unknown; is_error: boolean; error: string | null }

/** L'appelant qu'accepte le vérificateur injecté (M10) : Ada, administratrice de O, une fois O semée. */
let caller = { sub: "5f0c1d7e-0000-4000-8000-000000000001", email: "admin@acme.test" }
const verifyToken: VerifyToken = async () => ({ token: "token", clientId: "", scopes: [], extra: { ...caller } })

beforeEach(() => {
  vi.clearAllMocks()
})

function request(method: string, path: string, body?: unknown) {
  return new Request(`https://${HOST}/api/platform/${path}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "x-forwarded-proto": "https", origin: `https://${HOST}`, "content-type": "application/json" },
  })
}

/** La porte, puis sa tâche différée : la ligne de journal écrite avant qu'on la relise. */
async function serve(req: Request) {
  const tasks: (() => Promise<void>)[] = []
  const response = await handlePlateforme(req, { accessToken: "token", host: HOST, defer: (task) => tasks.push(task), verifyToken })
  for (const task of tasks) await task()
  return { status: response.status, body: await response.json() }
}

// Une route inconnue répond avant l'identité et le journal : sans base.
describe("teams routes without the database", () => {
  it("should answer 404 for a segment that is not the fixed one", async () => {
    const TEAM = "0e8e5a3c-7f10-4a5b-8d3b-2b1c4d5e6f70"
    expect((await serve(request("POST", `teams/${TEAM}/membres`, { userId: USER }))).status).toBe(404)
    expect((await serve(request("DELETE", `teams/${TEAM}/people/${USER}`))).status).toBe(404)
    expect(addTeamMember).not.toHaveBeenCalled()
    expect(removeTeamMember).not.toHaveBeenCalled()
  })
})

describe.skipIf(!sqlConfigured)(sqlConfigured ? SUITE : `${SUITE} (${SQL_SKIP_REASON})`, () => {
  let seed: SeededData
  let ref: ReferenceOrgSql
  let identity: Identity
  /** Ventes, une vraie équipe de O : `journal.team_id` la désigne (clé étrangère). */
  let TEAM: string

  beforeAll(async () => {
    seed = seedWithAdmin()
    ref = await seedReferenceOrg(seed)
    identity = ref.identityOf("ada")
    TEAM = ref.id(TEAMS.ventes.id)
    caller = { sub: identity.user.id, email: identity.user.email }
  }, SETUP_TIMEOUT)

  afterAll(async () => {
    await seed?.cleanup()
  }, SETUP_TIMEOUT)

  beforeEach(async () => {
    vi.mocked(resolveIdentity).mockResolvedValue(identity)
    // Chaque cas relit ses seules lignes : le journal de O repart vide.
    await seed.admin`delete from platform.journal where org_id = ${ref.org.id}`
  })

  /** La porte, puis la dernière ligne de journal de O. */
  async function call(req: Request) {
    const { status, body } = await serve(req)
    const [line] = await seed.admin<JournalLine[]>`select tool, target, team_id, args, is_error, error from platform.journal
                                                   where org_id = ${ref.org.id} order by id desc limit 1`
    return { status, body, line }
  }

  describe("teams routes", () => {
    it("should create a team with 201 and journal POST teams on its slug", async () => {
      vi.mocked(createTeam).mockResolvedValue({ data: { id: TEAM, slug: "conseil", name: "Conseil" }, target: "conseil", teamId: TEAM })

      const { status, body, line } = await call(request("POST", "teams", { name: "Conseil" }))

      expect(status).toBe(201)
      expect(body).toEqual({ data: { team: { id: TEAM, slug: "conseil", name: "Conseil" } } })
      expect(createTeam).toHaveBeenCalledWith(expect.anything(), identity, { name: "Conseil" })
      expect(line).toMatchObject({ tool: "POST teams", target: "conseil", team_id: TEAM, is_error: false })
    })

    it("should tell POST teams/<id>/members from POST teams, and name the tool after the fixed segment", async () => {
      vi.mocked(addTeamMember).mockResolvedValue({ data: { teamId: TEAM, userId: USER, added: true }, target: "lea@acme.test", teamId: TEAM })

      const { status, line } = await call(request("POST", `teams/${TEAM}/members`, { userId: USER }))

      expect(status).toBe(200)
      expect(addTeamMember).toHaveBeenCalledWith(expect.anything(), identity, TEAM, { userId: USER })
      expect(createTeam).not.toHaveBeenCalled()
      expect(line).toMatchObject({ tool: "POST teams/members", target: "lea@acme.test", team_id: TEAM })
    })

    it("should tell DELETE teams/<id>/members/<userId> from DELETE teams/<id>", async () => {
      vi.mocked(removeTeamMember).mockResolvedValue({ data: { teamId: TEAM, userId: USER, removed: true }, target: "lea@acme.test", teamId: TEAM })
      vi.mocked(deleteTeam).mockResolvedValue({ data: { id: TEAM, slug: "conseil" }, target: "conseil", teamId: null })

      const retrait = await call(request("DELETE", `teams/${TEAM}/members/${USER}`))
      expect(removeTeamMember).toHaveBeenCalledWith(expect.anything(), identity, TEAM, USER)
      expect(retrait.line).toMatchObject({ tool: "DELETE teams/members", target: "lea@acme.test", args: null })

      const suppression = await call(request("DELETE", `teams/${TEAM}`))
      expect(deleteTeam).toHaveBeenCalledWith(expect.anything(), identity, TEAM)
      expect(suppression.line).toMatchObject({ tool: "DELETE teams", target: "conseil", team_id: null })
    })

    it("should rename with PATCH teams/<id>", async () => {
      vi.mocked(updateTeam).mockResolvedValue({ data: { id: TEAM, slug: "ventes", name: "Ventes Nord" }, target: "ventes", teamId: TEAM })
      const { status, line } = await call(request("PATCH", `teams/${TEAM}`, { name: "Ventes Nord" }))
      expect(status).toBe(200)
      expect(updateTeam).toHaveBeenCalledWith(expect.anything(), identity, TEAM, { name: "Ventes Nord" })
      expect(line).toMatchObject({ tool: "PATCH teams", target: "ventes" })
    })

    // E05-S13 (AC-24) : nommer un membre responsable, ou le retirer des responsables.
    it("should set a role with PATCH teams/<id>/members/<userId>, journaled on the person", async () => {
      vi.mocked(setTeamMemberRole).mockResolvedValue({ data: { teamId: TEAM, userId: USER, role: "lead" }, target: "lea@acme.test", teamId: TEAM })
      const { status, body, line } = await call(request("PATCH", `teams/${TEAM}/members/${USER}`, { role: "lead" }))
      expect(status).toBe(200)
      expect(body).toEqual({ data: { membership: { teamId: TEAM, userId: USER, role: "lead" } } })
      expect(setTeamMemberRole).toHaveBeenCalledWith(expect.anything(), identity, { teamId: TEAM, userId: USER }, { role: "lead" })
      expect(line).toMatchObject({ tool: "PATCH teams/members", target: "lea@acme.test", team_id: TEAM })
    })

    it("should journal a refused deletion on the team id, with its code and details", async () => {
      vi.mocked(deleteTeam).mockRejectedValue(
        new PlatformError("conflict", "Team Ventes still owns nodes or accounts: transfer or delete them first.", {
          reason: "team_owns_objects",
          nodes: ["ventes/devis"],
          accounts: [],
          nodesTotal: 1,
          accountsTotal: 0,
        }),
      )

      const { status, body, line } = await call(request("DELETE", `teams/${TEAM}`))

      expect(status).toBe(409)
      expect(body.error.details).toEqual({ reason: "team_owns_objects", nodes: ["ventes/devis"], accounts: [], nodesTotal: 1, accountsTotal: 0 })
      expect(line).toMatchObject({ tool: "DELETE teams", target: TEAM, is_error: true })
      expect(line.error).toMatch(/^conflict: Team Ventes still owns/)
    })
  })

  // Membres et accès plateforme : `api-equipes.test.ts`, avec les vrais services.
  describe("rules routes", () => {
    it("should answer 201 for a new rule, 200 for a replaced one, and journal the node path", async () => {
      const regle = { path: "ventes/devis", subject: { kind: "team" as const, id: TEAM }, level: "read" as const }
      vi.mocked(setNodeRule).mockResolvedValueOnce({ data: { id: USER, ...regle, created: true }, target: "ventes/devis", teamId: TEAM })
      vi.mocked(setNodeRule).mockResolvedValueOnce({ data: { id: USER, ...regle, created: false }, target: "ventes/devis", teamId: TEAM })

      const creation = await call(request("POST", "rules", regle))
      const remplacement = await call(request("POST", "rules", regle))

      expect([creation.status, remplacement.status]).toEqual([201, 200])
      expect(creation.line).toMatchObject({ tool: "POST rules", target: "ventes/devis", team_id: TEAM })
    })

    it("should remove a rule with DELETE rules/<id>", async () => {
      vi.mocked(removeRule).mockResolvedValue({ data: { id: USER, path: "ventes/devis" }, target: "ventes/devis", teamId: null })
      const { status, line } = await call(request("DELETE", `rules/${USER}`))
      expect(status).toBe(200)
      expect(removeRule).toHaveBeenCalledWith(expect.anything(), identity, USER)
      expect(line).toMatchObject({ tool: "DELETE rules", target: "ventes/devis" })
    })
  })
})
