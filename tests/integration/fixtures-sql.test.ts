// @vitest-environment node
// Les quatre fixtures communes aux lots de t1 (E01-S10, lot t1-0) sur une vraie base, en suites
// portables (`sqlConfigured` : le projet Supabase, ou le Postgres nu du job `bare-postgres`) : chacune
// sème ses données par la connexion d'administration ; ce test les relit, les traduit en identifiants
// simulés et les compare, colonne par colonne, à la base simulée dont elles viennent (mêmes noms, même
// forme ; les écarts que le schéma impose sont posés ici en clair) ; une lecture sous un appelant
// prouve le client que rend la fixture (`asCaller`, le mode de transition du lot t1-0b étant tombé avec la
// face PostgREST, E01-S10 f2).
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { resolveIdentity } from "../../packages/plateforme/server/identity"
import { fixtureTables, FOREIGN_TABLE, PROSPECT_ROWS, PROSPECTS } from "../factories/table-fixture"
import { FOREIGN_FOLDER, seedTableFixture } from "../factories/table-fixture-sql"
import { adminTables, adminTree, ORGS, PERSONS, type AdminPerson } from "../helpers/mcp-admin"
import { seedAdminFixture, type AdminFixtureSql } from "../helpers/mcp-admin-sql"
import {
  ACCOUNTS,
  addBlocks,
  aliasRow,
  blockUuid,
  contentTables,
  nodeId,
  openDraftRow,
  ORG,
  OTHER_ORG,
  PEOPLE,
  referenceRpc,
  referenceTables,
  TEAMS,
  type ContentNode,
  type RuleSpec,
  type SeedBlock,
} from "../helpers/reference-org"
import { seedReferenceOrg, type ReferenceOrgSql } from "../helpers/reference-org-sql"
import type { Row, Tables } from "../helpers/simulated-db"
import { seedWithAdmin, SQL_SKIP_REASON, sqlConfigured, type SeededData, type TestSql } from "../helpers/sql"
import { ACME_PROCEDURES, acmeTables } from "./fixtures/acme"
import { ACME_UNSEEDED, seedAcme } from "./fixtures/acme-sql"

const NETWORK_TIMEOUT = 60_000
const SETUP_TIMEOUT = 180_000

/** Une date des lignes semées par les tests d'écriture, au format que rend la relecture. */
const AT = "2026-09-24T10:00:00.000Z"

/**
 * Colonnes simulées jamais comparées : celles, jetables, d'une organisation (`seed.createOrg`), et
 * l'identifiant que la base tire à une table à identité.
 */
const JETABLE: Record<string, readonly string[]> = {
  orgs: ["slug", "prefix", "host", "created_at", "updated_at"],
  links: ["id"],
  feedback: ["id"],
  journal: ["id"],
  admin_journal: ["id"],
}
/** Tables simulées que les graines n'écrivent pas : les adresses des organisations, jetables. */
const NOT_WRITTEN: ReadonlySet<string> = new Set(["org_domains"])
/** La clé qui apparie une ligne simulée à sa ligne relue ; `id` pour les autres tables. */
const KEYS: Record<string, readonly string[]> = {
  members: ["org_id", "user_id"],
  team_members: ["team_id", "user_id"],
  platform_staff: ["user_id"],
  node_drafts: ["node_id"],
  node_aliases: ["org_id", "old_path"],
  org_domains: ["host"],
  connector_activations: ["org_id", "connector"],
  ctx: ["code"],
  links: ["source_block_id", "target_path"],
  feedback: ["org_id", "number"],
  journal: ["ctx"],
  admin_journal: ["ctx"],
}

/** Les organisations et les personnes qu'une fixture a semées : la portée des lectures. */
type Scope = { orgs: string[]; people: string[] }
type Readable = { readable<T>(value: T): T }

function isRow(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Une valeur comparable : clés d'objet triées (`jsonb` les range à sa façon), dates en ISO. */
function canonical(column: string, value: unknown): unknown {
  if (/_at$|^lease_until$/.test(column) && typeof value === "string") return new Date(value).toISOString()
  if (Array.isArray(value)) return value.map((item) => canonical("", item))
  if (isRow(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(key, value[key])]))
  return value
}

/** Les lignes de `table` relues par la connexion d'administration, dans la portée semée. */
async function readBack(sql: TestSql, table: string, scope: Scope): Promise<Row[]> {
  const name = sql(`platform.${table}`)
  if (table === "orgs") return [...(await sql`select * from ${name} where id in ${sql(scope.orgs)}`)]
  if (table === "platform_staff") return [...(await sql`select * from ${name} where user_id in ${sql(scope.people)}`)]
  if (table === "team_members") {
    return [...(await sql`select * from ${name} where team_id in (select id from platform.teams where org_id in ${sql(scope.orgs)})`)]
  }
  if (table === "node_drafts") {
    return [...(await sql`select * from ${name} where node_id in (select id from platform.nodes where org_id in ${sql(scope.orgs)})`)]
  }
  return [...(await sql`select * from ${name} where org_id in ${sql(scope.orgs)}`)]
}

const keyOf = (table: string, row: Row) => (KEYS[table] ?? ["id"]).map((column) => String(row[column])).join(" ")

/** Les lignes relues de `table`, traduites en valeurs simulées, par clé. */
async function seededRows(sql: TestSql, fixture: Readable, table: string, scope: Scope): Promise<Map<string, Row>> {
  return new Map(fixture.readable(await readBack(sql, table, scope)).map((row) => [keyOf(table, row), row]))
}

/** Chaque ligne simulée face à sa ligne relue : les colonnes que la base simulée lui donne, hors valeurs jetables. */
function expectRows(table: string, rows: Row[], seeded: Map<string, Row>): void {
  for (const row of rows) {
    const columns = Object.keys(row).filter((column) => !(JETABLE[table] ?? []).includes(column))
    const pick = (source: Row | undefined) => Object.fromEntries(columns.map((column) => [column, canonical(column, source?.[column])]))
    expect(pick(seeded.get(keyOf(table, row))), `${table} ${keyOf(table, row)}`).toEqual(pick(row))
  }
}

const OWNER_COLUMNS = ["owner_kind", "owner_team_id", "owner_user_id"] as const

/**
 * Les nœuds simulés, chacun avec le propriétaire que la base écrit à sa création (20261103150000) : la base simulée
 * laisse hérité (NULL) le propriétaire d'un nœud, la vraie y recopie celui de son plus proche ancêtre qui en porte un.
 * Un parent que la fixture ne simule pas (elle n'en porte qu'une partie, parfois sans `parent_id`) se lit dans la
 * base, `seeded`.
 */
function writtenOwners(rows: Row[], seeded: Map<string, Row> = new Map()): Row[] {
  const byId = new Map(rows.map((row) => [String(row.id), row]))
  const carrier = (row: Row): Row | undefined => {
    let at: Row | undefined = row
    while (at && at.owner_kind == null) {
      const parent: string = String(at.parent_id ?? seeded.get(String(at.id))?.parent_id)
      at = byId.get(parent) ?? seeded.get(parent)
    }
    return at
  }
  return rows.map((row) => (row.owner_kind == null ? { ...row, ...Object.fromEntries(OWNER_COLUMNS.map((column) => [column, carrier(row)?.[column] ?? null])) } : row))
}

/** Chaque table non vide de `simulated` face à ses lignes relues : les mêmes lignes, puis `expectRows`. */
async function expectSeeded(sql: TestSql, fixture: Readable, simulated: Tables, scope: Scope): Promise<void> {
  for (const [table, rows] of Object.entries(simulated)) {
    if (rows.length === 0 || NOT_WRITTEN.has(table)) continue
    const seeded = await seededRows(sql, fixture, table, scope)
    expect([...seeded.keys()].sort(), table).toEqual(rows.map((row) => keyOf(table, row)).sort())
    expectRows(table, table === "nodes" ? writtenOwners(rows, seeded) : rows, seeded)
  }
}

function scopeOf(ref: ReferenceOrgSql): Scope {
  return { orgs: [ref.org.id, ref.other.id], people: Object.values(ref.people).map((person) => person.id) }
}

function adminScope(admin: AdminFixtureSql): Scope {
  return { orgs: Object.values(admin.orgs).map((org) => org.id), people: Object.values(admin.persons).map((person) => person.id) }
}

/** Des lignes d'annuaire ou d'appartenance dans un ordre fixe : celui de leur clé. */
function sortedBy<T>(rows: readonly T[], key: (row: T) => string): T[] {
  return [...rows].sort((a, b) => key(a).localeCompare(key(b)))
}

describe.skipIf(!sqlConfigured)(
  sqlConfigured ? "shared fixtures of t1 on a real database, portable" : `shared fixtures of t1 on a real database, portable (${SQL_SKIP_REASON})`,
  { timeout: NETWORK_TIMEOUT },
  () => {
    describe("reference organisation O and P (reference-org.ts)", () => {
      const RULES: RuleSpec[] = [
        { node: "ventes/devis", team: "support", level: "read" },
        { account: "ventes", user: "marc", level: "write" },
      ]
      let seed: SeededData
      let ref: ReferenceOrgSql

      beforeAll(async () => {
        seed = seedWithAdmin()
        ref = await seedReferenceOrg(seed, { rules: RULES })
      }, SETUP_TIMEOUT)

      afterAll(async () => {
        await seed?.cleanup()
      }, SETUP_TIMEOUT)

      it("should seed the rows of the simulated O and P, and open a session under one of their people", async () => {
        const simulated = contentTables(RULES)
        await expectSeeded(seed.admin, ref, simulated, scopeOf(ref))
        const [seen] = await (await ref.db("claire")).tx((sql) => sql<{ uid: string; o: number; p: number }[]>`
          select auth.uid() as uid,
                 (select count(*)::int from platform.nodes where org_id = ${ref.org.id}) as o,
                 (select count(*)::int from platform.nodes where org_id = ${ref.other.id}) as p`)
        expect(seen).toEqual({ uid: ref.people.claire.id, o: simulated.nodes.filter((node) => node.org_id === ORG.id).length, p: 0 })
      })

      it("should run the SQL face under the id, the email and the name of the person, as the host does", async () => {
        const [caller] = await (await ref.db("claire")).tx((sql) => sql`select auth.uid() as uid, auth.jwt() ->> 'email' as email, auth.jwt() ->> 'name' as name`)
        expect(caller).toEqual({ uid: ref.people.claire.id, email: ref.people.claire.email, name: ref.people.claire.name })
      })

      it("should give the identity and the teams that resolveIdentity resolves on the base (identityOf, teamOf)", async () => {
        const resolve = async (person: "claire" | "lea" | "t") =>
          resolveIdentity(await ref.db(person), ref.org.host, { userId: ref.people[person].id, email: ref.people[person].email })
        const claire = await resolve("claire")
        const lea = await resolve("lea")
        expect([claire, lea, await resolve("t")]).toEqual([ref.identityOf("claire"), ref.identityOf("lea"), ref.identityOf("t")])
        expect([claire.teams, lea.teams]).toEqual([[ref.teamOf("ventes", "claire")], [ref.teamOf("ventes", "lea")]])
      })

      it("should serve the copies of email and name of members and platform_staff as the simulated directories do (member_directory, staff_directory)", async () => {
        const staffIds = [ref.people.s.id, ref.people.t.id]
        const members = await (await ref.db("ada")).tx(
          (sql) => sql<Row[]>`select user_id, email, name, role, default_team_id, last_sign_in_at from platform.member_directory(${ref.org.id})`,
        )
        const staff = await (await ref.db("t")).tx(
          (sql) => sql<Row[]>`select user_id, email, name from platform.staff_directory() where user_id in ${sql(staffIds)}`,
        )
        // `RpcHandler` rend ce que rendrait PostgREST, sans type : ici les lignes de l'annuaire.
        const directory = referenceRpc().member_directory({ p_org: ORG.id }, contentTables(RULES)) as Row[]
        const byUser = (row: Row) => String(row.user_id)
        expect(sortedBy(ref.readable([...members]), byUser)).toEqual(sortedBy(directory, byUser))
        expect(sortedBy(ref.readable([...staff]), byUser)).toEqual(
          (["s", "t"] as const).map((person) => ({ user_id: PEOPLE[person].id, email: PEOPLE[person].email, name: PEOPLE[person].name })),
        )
      })
    })

    describe("reference organisation, rows added after the seed", () => {
      const NODE: ContentNode = { path: "ventes/devis/relance", title: "Relance", summary: "Relancer un devis." }
      const BLOCK: SeedBlock = { id: blockUuid(0x7001), type: "paragraph", text: "Brouillon." }
      const HEADER = { title: "Relance en attente" }
      const RULE: RuleSpec = { node: NODE.path, user: "paul", level: "write" }
      let seed: SeededData
      let ref: ReferenceOrgSql

      beforeAll(async () => {
        seed = seedWithAdmin()
        ref = await seedReferenceOrg(seed)
      }, SETUP_TIMEOUT)

      afterAll(async () => {
        await seed?.cleanup()
      }, SETUP_TIMEOUT)

      it("should write the rows the simulated helpers add, and seed again a rule once a test removed it", async () => {
        await ref.addNodes([NODE])
        await ref.addBlocks(NODE.path, "draft", [BLOCK])
        await ref.openDraft(NODE.path, HEADER)
        await ref.write({ node_aliases: [aliasRow("ventes/relance", NODE.path)] })
        const simulated = contentTables([], [NODE])
        addBlocks(simulated, NODE.path, "draft", [BLOCK])
        openDraftRow(simulated, NODE.path, HEADER)
        const added: Tables = {
          nodes: writtenOwners(simulated.nodes, await seededRows(seed.admin, ref, "nodes", scopeOf(ref))).filter((row) => row.path === NODE.path),
          blocks: simulated.blocks,
          node_drafts: simulated.node_drafts,
          node_aliases: [aliasRow("ventes/relance", NODE.path)],
        }
        for (const [table, rows] of Object.entries(added)) expectRows(table, rows, await seededRows(seed.admin, ref, table, scopeOf(ref)))

        // Une règle encore là est refusée par la base, sans rien changer à `ref` ; supprimée, elle se sème de nouveau.
        const [rule] = await ref.addRules([RULE])
        await expect(ref.addRules([RULE])).rejects.toMatchObject({ code: "23505" })
        const ruleId = String(referenceTables([RULE]).access_rules[0].id)
        expect(ref.id(ruleId)).toBe(rule)
        await seed.admin`delete from platform.access_rules where id = ${rule}`
        const [again] = await ref.addRules([RULE])
        expect(again).not.toBe(rule)
        expect(ref.id(ruleId)).toBe(again)
      })

      it("should write the tables the lots of t1 fill under drawn keys, a setting of O, and refuse a team membership already there", async () => {
        const CTX = "AAAA-0001"
        const DRAFT = "sim_0000000a"
        const HOST = "acme.cellule.test"
        const SOURCE = blockUuid(0x7002)
        await ref.addBlocks("ventes/devis", "published", [{ id: SOURCE, type: "paragraph", text: "Voir [[ventes/tarifs]]." }])
        const added: Tables = {
          orgs: [{ id: ORG.id, settings: { routing: { threshold: 0.9 } } }],
          org_domains: [{ host: HOST, org_id: ORG.id }],
          connector_activations: [{ org_id: ORG.id, connector: "mail", state: "active", activated_by: PEOPLE.ada.id, updated_at: AT }],
          ctx: [{ code: CTX, org_id: ORG.id, user_id: PEOPLE.claire.id, rules_version: 1, host: "claude-ai@0.1.0" }],
          sim_outbox: [{ id: DRAFT, org_id: ORG.id, account_id: ACCOUNTS.ventes.id, payload: { to: "sophie@example.test" }, status: "draft", sent_at: null }],
          links: [
            { id: 1, org_id: ORG.id, source_node_id: nodeId("ventes/devis"), source_block_id: SOURCE, target_path: "ventes/tarifs", target_node_id: nodeId("ventes/tarifs") },
          ],
          // Numéros dans le désordre, et le même dans P : chaque ligne garde le sien.
          feedback: [
            { id: 1, org_id: ORG.id, number: 12, user_id: PEOPLE.claire.id, ctx: CTX, type: "gap", text: "Missing.", created_at: AT },
            { id: 2, org_id: ORG.id, number: 3, user_id: PEOPLE.lea.id, type: "friction", text: "Slow.", created_at: AT },
            { id: 3, org_id: OTHER_ORG.id, number: 12, user_id: PEOPLE.lea.id, type: "error", text: "Broken.", created_at: AT },
          ],
          journal: [
            { id: 7, ts: AT, org_id: ORG.id, user_id: PEOPLE.claire.id, team_id: TEAMS.ventes.id, account_id: ACCOUNTS.ventes.id, ctx: CTX, tool: "acme_call", target: "mail.create_draft", args: { draft: DRAFT } },
          ],
        }
        await ref.write(added)
        for (const [table, rows] of Object.entries(added)) expectRows(table, rows, await seededRows(seed.admin, ref, table, scopeOf(ref)))

        // Les clés tirées ne sont pas les valeurs simulées ; le journal et le retour de la conversation portent le code de son `ctx`.
        const drawn = { ctx: ref.id(CTX), draft: ref.id(DRAFT), host: ref.id(HOST) }
        expect(drawn).toEqual({
          ctx: expect.stringMatching(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/),
          draft: expect.stringMatching(/^sim_[0-9a-f]{8}$/),
          host: expect.stringMatching(/^t[0-9a-f]{8}\.example\.invalid$/),
        })
        expect([drawn.ctx === CTX, drawn.draft === DRAFT]).toEqual([false, false])
        const conversation = await seed.admin<{ ctx: string }[]>`
          select ctx from platform.journal where org_id = ${ref.org.id}
          union all select ctx from platform.feedback where org_id = ${ref.org.id} and ctx is not null`
        expect(conversation.map((row) => row.ctx)).toEqual([drawn.ctx, drawn.ctx])

        await expect(ref.write({ team_members: [{ team_id: TEAMS.ventes.id, user_id: PEOPLE.lea.id }] })).rejects.toMatchObject({
          code: "23505",
          constraint_name: "team_members_pkey",
          detail: expect.stringContaining(ref.id(PEOPLE.lea.id)),
        })
      })
    })

    describe("tables fixture (table-fixture.ts)", () => {
      let seed: SeededData
      let ref: ReferenceOrgSql

      beforeAll(async () => {
        seed = seedWithAdmin()
        ref = await seedTableFixture(seed)
      }, SETUP_TIMEOUT)

      afterAll(async () => {
        await seed?.cleanup()
      }, SETUP_TIMEOUT)

      it("should seed the tables, headers and rows of the simulated fixture, P's table in its folder, and let its team read the rows", async () => {
        const simulated = fixtureTables()
        // Le schéma range le tableau de P sous son dossier, que la base simulée n'a pas (`nodes_guard`).
        simulated.nodes.push(FOREIGN_FOLDER)
        const foreign = simulated.nodes.find((node) => node.id === FOREIGN_TABLE.id)
        if (foreign) foreign.parent_id = FOREIGN_FOLDER.id
        await expectSeeded(seed.admin, ref, simulated, scopeOf(ref))
        const rows = await (await ref.db("claire")).tx((sql) => sql<{ key: string }[]>`
          select key from platform.blocks where node_id = ${ref.nodeId(PROSPECTS.path)} and type = 'row'`)
        expect(rows.map((row) => row.key).sort()).toEqual(PROSPECT_ROWS.map((row) => row.key).sort())
      })
    })

    describe("admin base (mcp-admin.ts)", () => {
      let seed: SeededData
      let admin: AdminFixtureSql

      beforeAll(async () => {
        seed = seedWithAdmin()
        admin = await seedAdminFixture(seed, { tree: true })
      }, SETUP_TIMEOUT)

      afterAll(async () => {
        try {
          await admin?.forgetJournal()
        } finally {
          await seed?.cleanup()
        }
      }, SETUP_TIMEOUT)

      it("should seed the simulated admin base with the tree of acme, and give the platform team its deps", async () => {
        const simulated = adminTables()
        adminTree(simulated)
        // Le schéma veut le handle de Claire pour son espace `private/claire` (`nodes_guard`).
        const claire = simulated.members.find((row) => row.user_id === PERSONS.claire.id)
        if (claire) claire.profile = { name: PERSONS.claire.name, handle: "claire" }
        await expectSeeded(seed.admin, admin, simulated, adminScope(admin))
        const staff = async (caller: AdminPerson) =>
          (await admin.deps(caller)).db.tx(async (sql) => (await sql<{ staff: boolean }[]>`select platform.is_staff() as staff`)[0].staff)
        expect([await staff("sam"), await staff("theo"), await staff("ada")]).toEqual([true, true, false])
      })
    })

    describe("admin base without the tree, its default (mcp-admin.ts)", () => {
      let seed: SeededData
      let admin: AdminFixtureSql

      beforeAll(async () => {
        seed = seedWithAdmin()
        admin = await seedAdminFixture(seed)
      }, SETUP_TIMEOUT)

      afterAll(async () => {
        try {
          await admin?.forgetJournal()
        } finally {
          await seed?.cleanup()
        }
      }, SETUP_TIMEOUT)

      it("should seed the simulated admin base with support/faq under its root and folder, and write the journal lines of an admin session", async () => {
        const simulated = adminTables()
        const tree: Tables = {}
        adminTree(tree)
        // Le schéma veut sa racine et son dossier à `support/faq` (`nodes_guard`) : les lignes d'`adminTree`.
        simulated.nodes = tree.nodes.filter((row) => ["guide", "support", "support/faq"].includes(String(row.path)))
        await expectSeeded(seed.admin, admin, simulated, adminScope(admin))

        // Ce qu'écrit `mcp-admin-ops.test.ts` : l'ancrage d'une session admin, sous un code tiré au hasard.
        const line = { id: 101, ts: AT, user_id: PERSONS.sam.id, org_id: ORGS.acme.id, method: "tools/call", tool: "admin_context", op: "ctx", ctx: "AAAA-BBBB", is_error: false }
        await admin.write({ admin_journal: [line] })
        expectRows("admin_journal", [line], await seededRows(seed.admin, admin, "admin_journal", adminScope(admin)))
        expect(admin.id("AAAA-BBBB")).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/)
        expect(admin.id("AAAA-BBBB")).not.toBe("AAAA-BBBB")
      })
    })

    describe("Acme on O (acme.ts)", () => {
      let seed: SeededData
      let ref: ReferenceOrgSql

      beforeAll(async () => {
        seed = seedWithAdmin()
        ref = await seedAcme(seed)
      }, SETUP_TIMEOUT)

      afterAll(async () => {
        await seed?.cleanup()
      }, SETUP_TIMEOUT)

      it("should seed Acme like acmeTables, without the Contexte of a team O has not, and let the administrator of O read its procedures", async () => {
        const simulated = acmeTables()
        // Un Contexte n'existe qu'au chemin d'une équipe, et O n'a pas d'équipe Conseil (`is_context_path`).
        const unseeded = new Set(ACME_UNSEEDED.map(nodeId))
        simulated.nodes = simulated.nodes.filter((row) => !unseeded.has(String(row.id)))
        simulated.blocks = simulated.blocks.filter((row) => !unseeded.has(String(row.node_id)))
        await expectSeeded(seed.admin, ref, simulated, scopeOf(ref))
        const [read] = await (await ref.db("ada")).tx((sql) => sql<{ procedures: number }[]>`
          select count(*)::int as procedures from platform.nodes where org_id = ${ref.org.id} and kind = 'procedure' and status = 'published'`)
        expect(read.procedures).toBe(ACME_PROCEDURES.length)
      })
    })
  },
)
