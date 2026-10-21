// @vitest-environment node
// La ligne de journal d'une mutation de l'API (E02-S01 AC21, H07 ; E09-S01 AC7, AC9, AC11 ; E03-S03 AC37 ;
// E03-S07 AC14) sur une vraie base, en suite portable (E01-S10, partie e1a : `writeJournal` passe au SQL ;
// AC-x3, fiche D76 A) : la porte est la vraie, les services et l'identité par l'adresse restent simulés, et
// le client que la porte construit est celui de l'appelant vérifié (`asCaller`, sans Supabase Auth), sous
// lequel la ligne s'écrit comme en production (`journal_insert_own`). La connexion d'administration la
// relit. Le reste de la porte, sans base : `tests/unit/api-handler.test.ts`.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { handlePlateforme } from "@otomata_tech/oto_platform/api"
import { PlatformError, type Identity } from "@otomata_tech/oto_platform/server"
import type { VerifyToken } from "../../packages/plateforme/mcp/auth"
import { updateBrand } from "../../packages/plateforme/server/brand"
import { resolveIdentity } from "../../packages/plateforme/server/identity"
import { inviteMember, revokeInvitation } from "../../packages/plateforme/server/invitations"
import { moveNode } from "../../packages/plateforme/server/nodes/move"
import { writeNode } from "../../packages/plateforme/server/nodes/write"
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

vi.mock("../../packages/plateforme/server/invitations", () => ({
  inviteMember: vi.fn(),
  listInvitations: vi.fn(),
  revokeInvitation: vi.fn(),
}))

vi.mock("../../packages/plateforme/server/brand", () => ({ updateBrand: vi.fn() }))

vi.mock("../../packages/plateforme/server/nodes/write", () => ({ writeNode: vi.fn() }))

vi.mock("../../packages/plateforme/server/nodes/move", () => ({ moveNode: vi.fn() }))

const SETUP_TIMEOUT = 180_000
const SUITE = "handlePlateforme journal on a real database (AC21)"
const HOST = "acme.test"
const ORIGIN = `https://${HOST}`
const INVITATION_ID = "5b0d1c56-0f3a-4a57-9d8e-6f1f1b9e2c11"

/** Une ligne du journal, relue par la connexion d'administration. */
type JournalLine = {
  org_id: string
  user_id: string
  method: string
  tool: string | null
  target: string | null
  team_id: string | null
  args: unknown
  is_error: boolean
  error: string | null
  duration_ms: number | null
  user_agent: string | null
  ctx: string | null
  host: string | null
}

type Task = () => Promise<void>

// Le vérificateur injecté (M10) : il accepte le jeton comme celui d'Ada, administratrice de O.
const verifyToken = vi.fn<VerifyToken>()

function request(method: string, path: string, init: { body?: string; headers?: Record<string, string> } = {}) {
  return new Request(`https://${HOST}/api/platform/${path}`, {
    method,
    body: init.body,
    headers: { "x-forwarded-proto": "https", origin: ORIGIN, "user-agent": "api-test", ...init.headers },
  })
}

async function call(req: Request, accessToken: string | null = "token") {
  const tasks: Task[] = []
  const response = await handlePlateforme(req, { accessToken, host: HOST, defer: (task) => tasks.push(task), verifyToken })
  return { response, body: await response.json(), tasks }
}

describe.skipIf(!sqlConfigured)(sqlConfigured ? SUITE : `${SUITE} (${SQL_SKIP_REASON})`, () => {
  let seed: SeededData
  let ref: ReferenceOrgSql
  let identity: Identity
  /** Ventes, une vraie équipe de O : `journal.team_id` la désigne (clé étrangère). */
  let teamId: string

  beforeAll(async () => {
    seed = seedWithAdmin()
    ref = await seedReferenceOrg(seed)
    identity = ref.identityOf("ada")
    teamId = ref.id(TEAMS.ventes.id)
  }, SETUP_TIMEOUT)

  afterAll(async () => {
    await seed?.cleanup()
  }, SETUP_TIMEOUT)

  beforeEach(async () => {
    vi.restoreAllMocks()
    verifyToken.mockResolvedValue({ token: "token", clientId: "", scopes: [], extra: { sub: identity.user.id, email: identity.user.email } })
    vi.mocked(resolveIdentity).mockResolvedValue(identity)
    // Chaque cas relit ses seules lignes : le journal de O repart vide.
    await seed.admin`delete from platform.journal where org_id = ${ref.org.id}`
  })

  /** Les lignes de O, dans l'ordre d'écriture. */
  const lines = () =>
    seed.admin<JournalLine[]>`select org_id, user_id, method, tool, target, team_id, args, is_error, error, duration_ms, user_agent, ctx, host
                              from platform.journal where org_id = ${ref.org.id} order by id`

  /** La dernière ligne écrite pour O. */
  const lastLine = async () => (await lines()).at(-1)

  describe("handlePlateforme journal (AC21)", () => {
    it("should write the line of a mutation only when the deferred task runs", async () => {
      vi.mocked(inviteMember).mockResolvedValue({
        invitation: { id: INVITATION_ID, email: "a@x.test", role: "member", teamId, expiresAt: "2026-10-01T00:00:00Z" },
        emailed: true,
      })
      const { tasks } = await call(request("POST", "invitations", { body: JSON.stringify({ email: "A@x.test", teamId }) }))
      expect(tasks).toHaveLength(1)
      expect(await lines()).toEqual([])

      await tasks[0]()
      const written = await lines()
      expect(written).toHaveLength(1)
      expect(written[0]).toMatchObject({
        org_id: ref.org.id,
        user_id: identity.user.id,
        method: "api",
        tool: "POST invitations",
        target: "a@x.test",
        team_id: teamId,
        args: { email: "A@x.test", teamId },
        is_error: false,
        error: null,
        user_agent: "api-test",
        ctx: null,
        host: null,
      })
      expect(written[0].duration_ms).toBeGreaterThanOrEqual(0)
    })

    it("should log a refusal as <code>: <message>, with the target of the validated request", async () => {
      vi.mocked(inviteMember).mockRejectedValue(
        new PlatformError("conflict", "m@x.test is already a member of Acme.", { reason: "already_member" }),
      )
      const { tasks } = await call(request("POST", "invitations", { body: JSON.stringify({ email: " M@x.test " }) }))
      await tasks[0]()
      expect(await lastLine()).toMatchObject({
        is_error: true,
        error: "conflict: m@x.test is already a member of Acme.",
        target: "m@x.test",
        team_id: null,
      })
    })

    it("should log a DELETE with the revoked id as target and no args", async () => {
      vi.mocked(revokeInvitation).mockResolvedValue({ id: INVITATION_ID, state: "revoked", teamId })
      const { tasks } = await call(request("DELETE", `invitations/${INVITATION_ID}`))
      await tasks[0]()
      expect(await lastLine()).toMatchObject({ tool: "DELETE invitations", target: INVITATION_ID, team_id: teamId, args: null })
    })

    // E03-S01 AC27 : l'écrivain commun `server/journal.ts` masque les valeurs secrètes (H07), une clé métier restant
    // lisible, puis coupe au-delà de 2 048 caractères ; l'erreur, à la même borne que la porte MCP (N4, revue du
    // cycle 1), hors d'une paire de substitution. Chaque règle en détail : `tests/unit/server-journal.test.ts`.
    it("should write args through the common writer (masked, then cut at 2,048) and the error cut at 500", async () => {
      vi.mocked(inviteMember).mockRejectedValue(new PlatformError("invalid_arguments", `${"m".repeat(480)}😀 and more`))
      const args = { api_key: "k-123", password: "p-456", key: "ref-042", email: "x".repeat(3000) }
      const { tasks } = await call(request("POST", "invitations", { body: JSON.stringify(args) }))
      await tasks[0]()
      const line = await lastLine()
      expect({ args: line?.args, error: line?.error }).toEqual({
        args: { _truncated: true, head: JSON.stringify({ ...args, api_key: "[masked]", password: "[masked]" }).slice(0, 2048) },
        error: `invalid_arguments: ${"m".repeat(480)}`,
      })
    })

    it("should keep the response unchanged when the journal write fails", async () => {
      // Une identité dans P, dont Ada n'est pas membre : la base refuse sa ligne (`journal_insert_own`, 42501).
      const log = vi.spyOn(console, "error").mockImplementation(() => {})
      vi.mocked(resolveIdentity).mockResolvedValue({ ...identity, org: { ...identity.org, id: ref.other.id } })
      vi.mocked(revokeInvitation).mockResolvedValue({ id: INVITATION_ID, state: "revoked", teamId: null })
      const { response, body, tasks } = await call(request("DELETE", `invitations/${INVITATION_ID}`))
      await expect(tasks[0]()).resolves.toBeUndefined()
      expect(response.status).toBe(200)
      expect(body.data.invitation.id).toBe(INVITATION_ID)
      expect(log).toHaveBeenCalledWith("[platform] journal: insert failed", "42501")
      expect(await seed.admin`select id from platform.journal where org_id = ${ref.other.id} and user_id = ${identity.user.id}`).toEqual([])
    })

    it("should still write the line when no defer is given", async () => {
      vi.mocked(revokeInvitation).mockResolvedValue({ id: INVITATION_ID, state: "revoked", teamId: null })
      await handlePlateforme(request("DELETE", `invitations/${INVITATION_ID}`), { accessToken: "token", host: HOST, verifyToken })
      // La ligne part sans être attendue : sa transaction sur le pooler, sous la charge du projet partagé.
      await vi.waitFor(async () => expect(await lines()).toHaveLength(1), { timeout: 15_000, interval: 250 })
    })
  })

  describe("handlePlateforme brand (E09-S01, AC7, AC9, AC11)", () => {
    const BRAND = { theme: "foret" as const, logo_url: "https://example.com/logo.png", display_name: "Démo Forêt" }

    it("should save the brand with 200 and journal PATCH brand on the target brand", async () => {
      vi.mocked(updateBrand).mockResolvedValue({ data: BRAND, target: "brand" })

      const { response, body, tasks } = await call(request("PATCH", "brand", { body: JSON.stringify(BRAND) }))

      expect(response.status).toBe(200)
      expect(body).toEqual({ data: BRAND })
      expect(updateBrand).toHaveBeenCalledWith(expect.anything(), identity, BRAND)
      await tasks[0]()
      expect(await lastLine()).toMatchObject({ method: "api", tool: "PATCH brand", target: "brand", is_error: false })
    })

    it("should answer a refusal with 403 and journal it on the target brand", async () => {
      vi.mocked(updateBrand).mockRejectedValue(new PlatformError("forbidden", "Only an administrator of Acme can change its brand."))

      const { response, body, tasks } = await call(request("PATCH", "brand", { body: JSON.stringify(BRAND) }))

      expect(response.status).toBe(403)
      expect(body).toEqual({ error: { code: "forbidden", message: "Only an administrator of Acme can change its brand." } })
      await tasks[0]()
      expect(await lastLine()).toMatchObject({
        tool: "PATCH brand",
        target: "brand",
        is_error: true,
        error: "forbidden: Only an administrator of Acme can change its brand.",
      })
    })
  })

  describe("handlePlateforme nodes (E03-S03, AC37)", () => {
    const BLOCK_ID = "3f9a2c1b-5b7d-4c1a-9e2f-8a6b4c2d0e1f"
    const BODY = {
      path: "ventes/devis",
      base_revision: 2,
      ops: [{ op: "replace_block", block: BLOCK_ID, revision: 2, input: { type: "checklist", data: { items: [{ text: "Relire", checked: true }] } } }],
    }

    it("should write the draft by the shared service, answer each refusal at its status, and journal POST nodes", async () => {
      expect((await call(request("POST", "nodes", { body: JSON.stringify(BODY) }), null)).response.status).toBe(401)
      const data = {
        path: "ventes/devis",
        revision: 2,
        status: "published",
        has_draft: true,
        touched: [{ op: "replace_block", text: "replaced block 3f9a2c1b", blocks: [{ id: BLOCK_ID, ref: "3f9a2c1b", revision: 3 }] }],
        blocks_total: 9,
        draft_stamp: "2026-09-24T10:00:00.123456+00:00",
      }
      vi.mocked(writeNode).mockResolvedValueOnce({ text: "Draft of ventes/devis saved on revision 2: replaced block 3f9a2c1b.", data, target: "ventes/devis", teamId })
      const saved = await call(request("POST", "nodes", { body: JSON.stringify(BODY) }))
      expect([saved.response.status, saved.body]).toEqual([200, { data }])
      expect(writeNode).toHaveBeenCalledWith(expect.anything(), identity, BODY, { kind: "human" })
      await saved.tasks[0]()
      expect(await lastLine()).toMatchObject({ method: "api", tool: "POST nodes", target: "ventes/devis", team_id: teamId, is_error: false })

      const statuses: [PlatformError, number][] = [
        [new PlatformError("invalid_arguments", "Invalid arguments: path: Path."), 400],
        [new PlatformError("forbidden", "Writing ventes/devis is reserved to team Ventes (lead: Claire Morel). Ask them for access."), 403],
        [new PlatformError("not_found", "Unknown path ventes/devis."), 404],
        [new PlatformError("stale_revision", "stale revision: ventes/devis is at revision 4, not 2.", { revision: 4 }), 409],
        [new PlatformError("conflict", "Path ventes/devis is not available: a content holds it (perhaps one you cannot see), a moved content had it, or the name is reserved. Choose another path."), 409],
        [new PlatformError("too_large", "ventes/devis would hold 1,001 blocks."), 413],
        [new PlatformError("unavailable_in_v1", "Creating tables is not available yet in this version."), 501],
      ]
      for (const [refusal, status] of statuses) {
        vi.mocked(writeNode).mockRejectedValueOnce(refusal)
        const refused = await call(request("POST", "nodes", { body: JSON.stringify(BODY) }))
        expect([refused.response.status, refused.body.error.code, refused.body.error.message], refusal.code).toEqual([status, refusal.code, refusal.message])
        await refused.tasks[0]()
        expect(await lastLine(), refusal.code).toMatchObject({ tool: "POST nodes", target: "ventes/devis", is_error: true, error: `${refusal.code}: ${refusal.message}` })
      }
      vi.mocked(writeNode).mockRejectedValueOnce(statuses[3][0])
      expect((await call(request("POST", "nodes", { body: JSON.stringify(BODY) }))).body.error.details).toEqual({ revision: 4 })
    })
  })

  describe("handlePlateforme nodes/move (E03-S07, AC14)", () => {
    const BODY = { path: "ventes/a", new_path: "ventes/b" }

    it("should move by the shared service, answer each refusal at its status, and journal POST nodes/move on the new path", async () => {
      expect((await call(request("POST", "nodes/move", { body: JSON.stringify(BODY) }), null)).response.status).toBe(401)
      const moves = [
        { from: "ventes/a", to: "ventes/b" },
        { from: "ventes/a/x", to: "ventes/b/x" },
      ]
      vi.mocked(moveNode).mockResolvedValueOnce({ text: "Moved ventes/a to ventes/b with its descendants:", moves, target: "ventes/b", teamId })
      const moved = await call(request("POST", "nodes/move", { body: JSON.stringify(BODY) }))
      expect([moved.response.status, moved.body]).toEqual([200, { data: { path: "ventes/b", moves } }])
      expect(moveNode).toHaveBeenCalledWith(expect.anything(), identity, BODY)
      expect(writeNode).not.toHaveBeenCalled()
      await moved.tasks[0]()
      expect(await lastLine()).toMatchObject({ method: "api", tool: "POST nodes/move", target: "ventes/b", team_id: teamId, is_error: false })

      const statuses: [PlatformError, number][] = [
        [new PlatformError("invalid_arguments", "Cannot move ventes/a under itself: ventes/a/x/z is inside ventes/a."), 400],
        [new PlatformError("forbidden", "Moving ventes/a is reserved to team Ventes (lead: Claire Morel). Ask them to move it."), 403],
        [new PlatformError("not_found", "Unknown path ventes/a. Use acme_find to locate it."), 404],
        [new PlatformError("conflict", "Path ventes/b is not available: a content holds it (perhaps one you cannot see), a moved content had it, or the name is reserved. Choose another path."), 409],
        [new PlatformError("stale_revision", "ventes/a changed while it was being moved: read it again, then retry."), 409],
      ]
      for (const [refusal, status] of statuses) {
        vi.mocked(moveNode).mockRejectedValueOnce(refusal)
        const refused = await call(request("POST", "nodes/move", { body: JSON.stringify(BODY) }))
        expect([refused.response.status, refused.body], refusal.code).toEqual([status, { error: { code: refusal.code, message: refusal.message } }])
        await refused.tasks[0]()
        expect(await lastLine(), refusal.code).toMatchObject({ tool: "POST nodes/move", target: "ventes/a", is_error: true, error: `${refusal.code}: ${refusal.message}` })
      }

      // Un corps non conforme à `moveNodeSchema` : le service le refuse avant toute lecture, sans cible au journal.
      const actual = await vi.importActual<typeof import("../../packages/plateforme/server/nodes/move")>("../../packages/plateforme/server/nodes/move")
      vi.mocked(moveNode).mockImplementationOnce(actual.moveNode)
      const malformed = await call(request("POST", "nodes/move", { body: JSON.stringify({ path: "ventes/a", new_path: "ventes/b", extra: 1 }) }))
      expect([malformed.response.status, malformed.body.error.code]).toEqual([400, "invalid_arguments"])
      await malformed.tasks[0]()
      expect(await lastLine()).toMatchObject({ tool: "POST nodes/move", target: null, is_error: true })
    })
  })
})
