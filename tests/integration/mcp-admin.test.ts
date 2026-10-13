// @vitest-environment node
// Le MCP admin sur une vraie base (E08-S02 : AC6, AC16, AC22, N24), la base étant
// le sujet : ligne d'ancrage écrite sous la policy d'`admin_journal`, `create_org` sous la session d'un
// membre de l'équipe plateforme jetable, contraintes de son `23505` reconnues par leur nom, journal à
// part. Un seul scénario, par `connectAdminMcp` câblé comme la route (`openAdminRequest`) ; le reste
// des opérations est prouvé en suites portables, sur la graine de `seedAdminFixture`
// (`mcp-admin-ops.test.ts`, `admin-orgs.test.ts`). Suite
// portable (E11-S14) : la porte reçoit les claims et un jeton signé localement
// (`tests/helpers/session-locale.ts`) ; relectures par la connexion d'administration.
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { openAdminRequest } from "../../packages/plateforme/mcp/admin/handler"
import { connectAdminMcp } from "../helpers/mcp-admin"
import { hex, type TestOrg } from "../helpers/plateforme"
import { createLocalFixtures, type LocalFixtures } from "../helpers/session-locale"
import { portable, sqlConfigured, testAdminSql, type SqlUser, type TestSql } from "../helpers/sql"
import { privateFolderPending, privateFolderSuite } from "../helpers/pending-migrations"

// Ces tests supposent le dossier `private` en base (fiche D107) : sautés, la version nommée, tant que
// 20260928120000 n'est pas appliquée au projet (`database-patterns.md § Règles`).
const privatePending = await privateFolderPending()

const NETWORK_TIMEOUT = 90_000
const SUITE = "MCP admin on a real database"

describe.skipIf(!sqlConfigured)(portable(SUITE), { timeout: NETWORK_TIMEOUT }, () => {
  let fx: LocalFixtures
  let admin: TestSql
  let staff: SqlUser
  let taken: TestOrg

  beforeAll(async () => {
    fx = createLocalFixtures()
    admin = testAdminSql()
    staff = await fx.createUser({ fullName: "Admin Test" })
    taken = await fx.createOrg()
    await fx.makeStaff(staff.id)
  }, 120_000)

  afterAll(async () => {
    try {
      await fx?.cleanup()
    } finally {
      await admin?.end({ timeout: 5 })
    }
  }, NETWORK_TIMEOUT)

  it.skipIf(privatePending)(privateFolderSuite("should anchor an admin session, name a taken slug or prefix, create an organisation and journal apart (AC6, AC16, AC22, N24)", privatePending), async () => {
    const { accessToken } = await fx.sessionFor(staff)
    const userAgent = `vitest-admin-${hex(3)}`
    const session = await connectAdminMcp(await openAdminRequest({ accessToken, claims: { sub: staff.id, email: staff.email }, userAgent, origin: "https://cell.example.test" }))
    const { code } = await session.openAdmin()
    const anchor = await admin`select tool, op, user_id, org_id, is_error from platform.admin_journal where ctx = ${code}`
    expect(anchor).toEqual([{ tool: "admin_context", op: "ctx", user_id: staff.id, org_id: null, is_error: false }])

    const create = (args: Record<string, unknown>) => session.call("admin_org", { ctx: code, op: "create", confirm: true, admin_email: staff.email, ...args })
    const slugTaken = await create({ org: taken.slug, name: "Taken", prefix: `t${hex(4)}` })
    expect(slugTaken.text).toBe(`Slug ${taken.slug} is already taken. Pick another slug.`)
    const prefixTaken = await create({ org: `t${hex(4)}`, name: "Taken", prefix: taken.prefix })
    expect(prefixTaken.text).toBe(
      `Prefix ${taken.prefix} is already used by another organisation. Pick another prefix: it names the tools (${taken.prefix}_context…) for good.`,
    )

    // Slug égal au préfixe, `t<hex>` : la marque des données de test que reconnaît `pnpm test:cleanup`.
    const slug = `t${hex(4)}`
    const host = `${slug}.example.invalid`
    // Le créateur se nomme premier administrateur (décision du 2026-10-14) : membre `admin`, sans invitation.
    const created = await create({ org: slug, name: `Test ${slug}`, prefix: slug, host })
    // `structuredContent.org` : l'organisation créée, que rend `create` (AC16) ; typée objet quelconque.
    const orgId = String((created.structured?.org as { id?: string } | undefined)?.id)
    fx.trackOrg(orgId)
    expect(created.text.split("\n")[0]).toBe(
      `Organisation ${slug} (Test ${slug}) created: root page guide, context page contexte, personal spaces (private), your platform access, address ${host}.`,
    )
    expect(created.text.split("\n")[1]).toBe(`You (${staff.email}) are its first administrator: a member with the admin role.`)
    const [nodes, grants, domains, members] = await Promise.all([
      admin`select path, kind from platform.nodes where org_id = ${orgId} order by path`,
      admin`select user_id, granted_by, reason, revoked_at from platform.platform_grants where org_id = ${orgId}`,
      admin`select host from platform.org_domains where org_id = ${orgId}`,
      admin`select user_id, role from platform.members where org_id = ${orgId}`,
    ])
    // Son espace personnel et son Contexte naissent avec sa ligne `members` (`members_tree_sync`).
    expect(nodes.map((node) => node.path)).toEqual([
      "contexte",
      "guide",
      "private",
      expect.stringMatching(/^private\/[a-z0-9_]+$/),
      expect.stringMatching(/^private\/[a-z0-9_]+\/contexte$/),
    ])
    expect(members).toEqual([{ user_id: staff.id, role: "admin" }])
    expect(grants).toEqual([{ user_id: staff.id, granted_by: staff.id, reason: "creation", revoked_at: null }])
    expect(domains).toEqual([{ host }])

    await session.flush()
    const lines = await admin`select tool, op, org_id, is_error, error from platform.admin_journal where user_id = ${staff.id} order by id`
    expect(lines).toEqual([
      { tool: "admin_context", op: "ctx", org_id: null, is_error: false, error: null },
      { tool: "admin_org", op: "create", org_id: null, is_error: true, error: `conflict: Slug ${taken.slug} is already taken. Pick another slug.` },
      { tool: "admin_org", op: "create", org_id: null, is_error: true, error: expect.stringMatching(/^conflict: Prefix /) },
      { tool: "admin_org", op: "create", org_id: orgId, is_error: false, error: null },
    ])
    expect(await admin`select id from platform.journal where user_id = ${staff.id}`).toEqual([])
  })
})
