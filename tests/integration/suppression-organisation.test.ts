// @vitest-environment node
// Suppression d'une organisation (`administration-et-cellule.md` § Suppression d'une organisation), sur une vraie base
// (la base est le sujet, testing-strategy.md § Budget de tests) : la carte `ORG_TABLES` face au catalogue, puis une
// organisation A (l'organisation de référence d'E01-S04) semée dans chaque table de la carte, une organisation témoin B
// semée de même et partageant ses personnes, et le bucket en mémoire. Compter n'écrit rien ; `--by` hors de l'équipe
// plateforme et une panne du bucket ne suppriment rien en base ; la suppression ne laisse aucune ligne de A, retire
// ses objets, laisse B identique, anonymise le journal admin de A et y ajoute la ligne « organisation supprimée » ; une
// relance ne repasse que sur le stockage. Suite portable : le job `bare-postgres` la joue.
import { randomBytes } from "crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { deleteOrg, orgDeleteCommand } from "../../packages/plateforme/cli/org-delete.mjs"
import { countOrgRows, NOT_DELETED, ORG_TABLES } from "../../packages/plateforme/cli/org-tables.mjs"
import { memoryFileStore, type MemoryFileStore } from "../../packages/plateforme/server/files/memory"
import { pendingMigrations, pendingReason, privateFolderPending, privateFolderSuite } from "../helpers/pending-migrations"
import { platformTables } from "../helpers/platform-tables"
import { hex } from "../helpers/plateforme"
import { createSqlFixtures, SQL_SKIP_REASON, sqlConfigured, type SqlFixtures, type SqlReferenceOrg, type SqlUser } from "../helpers/sql"

const privatePending = await privateFolderPending()
const SETUP_TIMEOUT = 240_000
const SUITE = "organisation deletion"
const name = (suite: string) => privateFolderSuite(sqlConfigured ? suite : `${suite} (${SQL_SKIP_REASON})`, privatePending)

const sha = () => randomBytes(32).toString("hex")
const inMinutes = (minutes: number) => new Date(Date.now() + minutes * 60_000)

type AdminLine = { id: number; ts: string; org_id: string | null; user_id: string | null; method: string; tool: string | null; op: string | null; target: string | null; args: unknown; ctx: string | null; error: string | null; is_error: boolean; duration_ms: number | null }

describe.skipIf(!sqlConfigured)(name(`${SUITE}: the map against the database`), () => {
  it("should put every table of platform on the map: deleted, anonymized, or left with its reason; org_id read directly; every key to orgs cascading but the staff journal's", async (ctx) => {
    const pending = await pendingMigrations()
    ctx.skip(pending.length > 0, pendingReason(pending))
    const tables = await platformTables()
    expect(Object.keys(tables).sort()).toEqual([...ORG_TABLES.map((table) => table.name), ...Object.keys(NOT_DELETED)].sort())
    const withOrgId = Object.keys(tables).filter((table) => tables[table].columns.includes("org_id"))
    expect(withOrgId.sort()).toEqual(ORG_TABLES.filter((table) => !table.parent && table.name !== "orgs").map((table) => table.name).sort())
    const fx = createSqlFixtures()
    try {
      const keys = await fx.admin<{ table: string; action: string }[]>`
        select c.conrelid::regclass::text as table, c.confdeltype::text as action from pg_catalog.pg_constraint c
         where c.contype = 'f' and c.confrelid = 'platform.orgs'::regclass order by 1`
      expect(keys.filter((key) => key.action !== "c")).toEqual([{ table: "platform.admin_journal", action: "n" }])
    } finally {
      await fx.cleanup()
    }
  })
})

describe.skipIf(!sqlConfigured || privatePending)(name(SUITE), () => {
  let fx: SqlFixtures
  let a: SqlReferenceOrg
  let b: SqlReferenceOrg
  let staff: SqlUser
  let sole: SqlUser
  let store: MemoryFileStore
  let adminLinesA: AdminLine[]
  const fileIds: Record<"a" | "b", string> = { a: "", b: "" }

  /** Une ligne dans chaque table de la carte pour l'organisation. */
  async function seedEveryTable(org: SqlReferenceOrg): Promise<void> {
    const { admin } = fx
    const { claire, lea } = org.people
    const page = await fx.createNode(org.org.id, { parentId: org.nodes.ventes, path: "ventes/offre", title: "Offre tarifaire" })
    await fx.publishBlocks(page, [{ type: "paragraph", text: "Premier paragraphe publié." }, { type: "paragraph", text: "Second." }], { links: [{ block: 0, path: "support/faq" }] })
    await admin`select * from platform.open_draft(${page})`
    await admin`insert into platform.node_aliases (org_id, old_path, node_id) values (${org.org.id}, 'ventes/offre_ancienne', ${page})`
    await admin`insert into platform.node_shares (org_id, node_id, created_by) values (${org.org.id}, ${page}, ${claire.id})`
    await admin`insert into platform.node_views (org_id, node_id, user_id) values (${org.org.id}, ${page}, ${claire.id})`
    const [file] = await admin<{ id: string }[]>`
      insert into platform.files (org_id, node_id, name, mime, size, status, created_by)
      values (${org.org.id}, ${page}, 'offre.pdf', 'application/pdf', 3, 'ready', ${claire.id}) returning id`
    await admin`
      insert into platform.files (org_id, node_id, name, mime, size, status, created_by, expires_at)
      values (${org.org.id}, null, 'transit.csv', 'text/csv', 3, 'ready', ${claire.id}, ${inMinutes(60)})`
    await admin`
      insert into platform.upload_tickets (org_id, user_id, token_hash, form_token_hash, kind, mode, target_path, expires_at)
      values (${org.org.id}, ${claire.id}, ${sha()}, ${sha()}, 'file', 'attach', 'ventes/offre', ${inMinutes(15)})`
    const account = await fx.createAccount(org.org.id, { ownerKind: "team", ownerTeamId: org.teams.ventes, label: "Mail Ventes" })
    await fx.addRule({ orgId: org.org.id, accountId: account, teamId: org.teams.support, level: "read" })
    await fx.addRule({ orgId: org.org.id, nodeId: page, teamId: org.teams.support, level: "read" })
    await fx.addActivation(org.org.id, "mail")
    await admin`
      insert into platform.connector_consents (state_hash, org_id, user_id, connector, expires_at)
      values (${sha()}, ${org.org.id}, ${claire.id}, 'mail', ${inMinutes(10)})`
    await admin`
      insert into platform.hosted_link_requests (org_id, user_id, connector, kind, expires_at)
      values (${org.org.id}, ${claire.id}, 'mail', 'create', ${inMinutes(30)})`
    await admin`
      insert into platform.sim_outbox (org_id, account_id, connector, function, payload, created_by)
      values (${org.org.id}, ${account}, 'mail', 'mail.create_draft', ${admin.json({ to: "x@example.invalid" })}, ${claire.id})`
    const code = await fx.seedCtxJournal(org.org, claire, [{ tool: "t_read", target: "ventes/offre" }])
    await admin`insert into platform.feedback (org_id, user_id, type, text, number) values (${org.org.id}, ${lea.id}, 'gap', 'Il manque la grille.', 0)`
    await admin`insert into platform.pseudonym_orgs (org_id, salt, witness) values (${org.org.id}, ${randomBytes(12).toString("hex")}, 'abcd')`
    await admin`insert into platform.member_exclusions (org_id, user_id) values (${org.org.id}, ${(await fx.createUser()).id})`
    await admin`insert into platform.invitations (org_id, email, invited_by) values (${org.org.id}, ${`test-${hex(6)}@example.invalid`}, ${org.people.ada.id})`
    await fx.grantPlatformAccess(org.org.id, staff.id, staff.id)
    await admin`
      insert into platform.admin_journal (org_id, user_id, ctx, method, tool, op, target, args, error, is_error, duration_ms)
      values (${org.org.id}, ${staff.id}, ${code}, 'tools/call', 'admin_node', 'transfer_owner', 'ventes/offre', ${admin.json({ path: "ventes/offre" })}, null, false, 12),
             (${org.org.id}, ${staff.id}, ${code}, 'tools/call', 'admin_org', 'update', ${`org:${org.org.slug}`}, ${admin.json({ name: "Acme" })}, 'forbidden: reserved', true, 7)`
    fileIds[org === a ? "a" : "b"] = file.id
  }

  const counts = (org: SqlReferenceOrg) => countOrgRows(fx.admin, org.org.id)
  const objectsOf = (org: SqlReferenceOrg) => [...store.objects.keys()].filter((key) => key.startsWith(`${org.org.id}/`)).sort()
  const adminLines = (ids: number[]) =>
    fx.admin<AdminLine[]>`select id, to_json(ts) #>> '{}' as ts, org_id, user_id, method, tool, op, target, args, ctx, error, is_error, duration_ms
                            from platform.admin_journal where id in ${fx.admin(ids)} order by id`
  const deletionLines = (org: SqlReferenceOrg) =>
    fx.admin<AdminLine[]>`select id, to_json(ts) #>> '{}' as ts, org_id, user_id, method, tool, op, target, args, ctx, error, is_error, duration_ms
                            from platform.admin_journal where method = 'cli' and tool = 'org' and op = 'delete' and target = ${`org:${org.org.slug}`}`

  beforeAll(async () => {
    fx = createSqlFixtures()
    staff = await fx.createUser({ fullName: "Sol Équipe" })
    await fx.makeStaff(staff.id)
    a = await fx.buildReferenceOrg()
    b = await fx.buildReferenceOrg(a.people)
    sole = await fx.createUser({ fullName: "Seule Ici" })
    await fx.addMember(a.org.id, sole.id)
    await seedEveryTable(a)
    await seedEveryTable(b)
    store = memoryFileStore()
    for (const [org, file] of [[a, fileIds.a], [b, fileIds.b]] as const) {
      await store.put(`${org.org.id}/${file}`, new Uint8Array([1, 2, 3]), "application/pdf")
      await store.put(`${org.org.id}/exports/1-${hex(4)}.zip`, new Uint8Array([4]), "application/zip")
    }
    adminLinesA = await fx.admin<AdminLine[]>`
      select id, to_json(ts) #>> '{}' as ts, org_id, user_id, method, tool, op, target, args, ctx, error, is_error, duration_ms
        from platform.admin_journal where org_id = ${a.org.id} order by id`
    const empty = async (org: SqlReferenceOrg, label: string) => Object.entries(await counts(org)).flatMap(([table, count]) => (count > 0 ? [] : [`${label}.${table}`]))
    const missing = [...(await empty(a, "A")), ...(await empty(b, "B"))]
    if (missing.length > 0) throw new Error(`no row seeded in ${missing.join(", ")}`)
  }, SETUP_TIMEOUT)

  afterAll(async () => {
    await fx?.cleanup()
  }, SETUP_TIMEOUT)

  it("should count every table and the objects, and write nothing, without --yes", async () => {
    const before = await counts(a)
    const report = await deleteOrg({ sql: fx.admin, store }, { slug: a.org.slug, apply: false })
    expect(report).toMatchObject({ state: "present", applied: false, rows: before, anonymized: 2, objects: 2, people: 1 })
    expect({ rows: await counts(a), objects: objectsOf(a).length }).toEqual({ rows: before, objects: 2 })
  })

  it("should refuse --by outside the platform team, and an unknown organisation, before any write", async () => {
    const before = await counts(a)
    const refused = await deleteOrg({ sql: fx.admin, store }, { slug: a.org.slug, by: a.people.ada.email, apply: true }).catch((error: Error) => error.message)
    const unknown = await deleteOrg({ sql: fx.admin, store }, { slug: `t${hex(4)}`, by: staff.email, apply: true }).catch((error: Error) => error.message)
    expect({ refused, unknown }).toEqual({
      refused: `--by : ${a.people.ada.email} n'est pas un membre de l'équipe plateforme (platform_staff)`,
      unknown: expect.stringMatching(/^organisation inconnue : t[0-9a-f]+$/),
    })
    expect({ rows: await counts(a), objects: objectsOf(a).length }).toEqual({ rows: before, objects: 2 })
  })

  it("should keep the database whole when the bucket fails, and say so", async () => {
    const before = await counts(a)
    store.failing.add("remove")
    const failed = await deleteOrg({ sql: fx.admin, store }, { slug: a.org.slug, by: staff.email, apply: true }).then(
      () => "deleted",
      (error: Error) => error.message,
    )
    store.failing.delete("remove")
    expect({ failed, rows: await counts(a), objects: objectsOf(a).length, line: (await deletionLines(a)).length }).toEqual({
      failed: "storage remove failed (memory)",
      rows: before,
      objects: 2,
      line: 0,
    })
  })

  it("should delete every row and object of A, anonymize its staff journal with the deletion line, and leave B as it was", async () => {
    const bRows = await counts(b)
    const bObjects = objectsOf(b)
    const aRows = await counts(a)
    const printed: string[] = []
    const code = await orgDeleteCommand({
      dbUrl: process.env.PLATFORM_ADMIN_DATABASE_URL ?? "",
      org: a.org.slug,
      by: staff.email.toUpperCase(),
      yes: true,
      withoutStorage: false,
      env: {},
      print: (line) => printed.push(line),
      printError: (line) => printed.push(line),
      store,
    })
    expect({ code, head: printed[0], files: printed.find((line) => line.startsWith("  files :")), people: printed.at(-1) }).toEqual({
      code: 0,
      head: `org delete : organisation ${a.org.slug} (${a.org.name}, ${a.org.id}) supprimée.`,
      files: `  files : ${aRows.files} ligne(s)`,
      people: "  personnes membres de cette seule organisation : 1 (gardées dans identities ; forget_user pour les oublier)",
    })
    expect(printed).toContain(`  stockage : 2 objet(s) sous ${a.org.id}/ supprimé(s)`)
    expect(Object.entries(await counts(a)).filter(([, count]) => count > 0)).toEqual([])
    expect({ a: objectsOf(a), b: objectsOf(b), bRows: await counts(b) }).toEqual({ a: [], b: bObjects, bRows })

    const kept = await adminLines(adminLinesA.map((line) => line.id))
    expect(kept).toEqual(adminLinesA.map((line) => ({ ...line, org_id: null, target: null, args: null, ctx: null, error: null })))
    const [deletion, ...others] = await deletionLines(a)
    expect({ others: others.length, deletion }).toMatchObject({
      others: 0,
      deletion: { org_id: null, user_id: staff.id, method: "cli", tool: "org", op: "delete", args: { org_id: a.org.id }, ctx: null, error: null, is_error: false },
    })
  })

  it("should say already deleted on a relaunch, and only sweep the objects that arrived since", async () => {
    const bRows = await counts(b)
    const late = `${a.org.id}/${hex(8)}`
    await store.put(late, new Uint8Array([9]), "text/plain")
    const counted = await deleteOrg({ sql: fx.admin, store }, { slug: a.org.slug, apply: false })
    const swept = await deleteOrg({ sql: fx.admin, store }, { slug: a.org.slug, by: staff.email, apply: true })
    const again = await deleteOrg({ sql: fx.admin, store }, { slug: a.org.slug, by: staff.email, apply: true })
    expect({ counted, swept, again }).toMatchObject({
      counted: { state: "deleted", orgId: a.org.id, applied: false, objects: 1 },
      swept: { state: "deleted", orgId: a.org.id, applied: true, objects: 1 },
      again: { state: "deleted", orgId: a.org.id, applied: true, objects: 0 },
    })
    expect({ objects: objectsOf(a), lines: (await deletionLines(a)).length, bRows: await counts(b) }).toEqual({ objects: [], lines: 1, bRows })
  })

  it("should refuse a deletion line that names an organisation still there", async () => {
    const slug = `t${hex(4)}`
    await fx.admin`
      insert into platform.admin_journal (user_id, method, tool, op, target, args)
      values (${staff.id}, 'cli', 'org', 'delete', ${`org:${slug}`}, ${fx.admin.json({ org_id: b.org.id })})`
    const refused = await deleteOrg({ sql: fx.admin, store }, { slug, by: staff.email, apply: true }).catch((error: Error) => error.message)
    expect({ refused, objects: objectsOf(b).length }).toEqual({ refused: `la ligne « organisation supprimée » de ${slug} ne nomme pas une organisation supprimée`, objects: 2 })
  })
})
