// @vitest-environment node
// Rôle plateforme (E01-S04 : AC10, AC17 à AC19, AC25) : les lignes `platform_staff` et les accès de départ
// sont posés par la connexion d'administration (outillage), chaque lecture et écriture passe par la
// session de la personne. Depuis E01-S08, la RLS n'isole que les organisations : les cas qui prouvaient un
// rôle par une policy (accord refusé à un membre, accords et journal admin cachés aux membres) sont retirés
// (HN-E01S08-9). Les niveaux du consultant sont ceux du calcul pur et de la parité (`access-levels.test.ts`,
// `access-parity.test.ts`), ses lectures celles d'`isolation-par-table.test.ts` (M11b). Suite portable
// depuis E01-S10 f2 : chaque personne par sa session (`fx.as`), sans PostgREST ni Supabase Auth ; le job
// `bare-postgres` la joue.
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { PlatformDb } from "../../packages/plateforme/server/db"
import type { Tx } from "../../packages/plateforme/server/sql"
import { hex } from "../helpers/plateforme"
import { codeOf, createSqlFixtures, SQL_SKIP_REASON, sqlConfigured, sqlNodeLevel, type SqlFixtures, type SqlReferenceOrg, type SqlUser } from "../helpers/sql"
import { privateFolderPending, privateFolderSuite } from "../helpers/pending-migrations"

// Ces tests supposent le dossier `private` en base (fiche D107) : sautés, la version nommée, tant que
// 20260928120000 n'est pas appliquée au projet (`database-patterns.md § Règles`).
const privatePending = await privateFolderPending()

const NETWORK_TIMEOUT = 60_000
const SETUP_TIMEOUT = 180_000
const SUITE = "platform role"

type Who = "s" | "s2" | "ada" | "lea" | "outsider"

describe.skipIf(!sqlConfigured || privatePending)(privateFolderSuite(sqlConfigured ? SUITE : `${SUITE} (${SQL_SKIP_REASON})`, privatePending), { timeout: NETWORK_TIMEOUT }, () => {
  let fx: SqlFixtures
  let o: SqlReferenceOrg
  const nobody: SqlUser = { id: "", email: "", name: null }
  // S4 : le collègue à qui S accorde un accès (AC17), sans session ; aucun autre test ne touche à ses
  // accès (testing-strategy.md § Anti-patterns).
  const staff: Record<"s" | "s2" | "s3" | "s4", SqlUser> = { s: nobody, s2: nobody, s3: nobody, s4: nobody }
  let outsider: SqlUser

  function as(who: Who): PlatformDb {
    if (who === "ada" || who === "lea") return fx.as(o.people[who])
    return fx.as(who === "outsider" ? outsider : staff[who])
  }

  const level = (who: Who, nodeId: string) => sqlNodeLevel(as(who), nodeId)

  /** Une écriture sous la session de la personne. */
  const write = (who: Who, run: (sql: Tx) => Promise<unknown>) => as(who).tx(run)

  beforeAll(async () => {
    fx = createSqlFixtures()
    o = await fx.buildReferenceOrg()
    staff.s = await fx.createUser({ fullName: "Sam Staff" })
    staff.s2 = await fx.createUser({ fullName: "Sacha Deux" })
    staff.s3 = await fx.createUser({ fullName: "Sonia Trois" })
    staff.s4 = await fx.createUser({ fullName: "Simon Quatre" })
    outsider = await fx.createUser({ fullName: "Pierre Dehors" })
    for (const person of [staff.s, staff.s2, staff.s3, staff.s4]) await fx.makeStaff(person.id)
    await fx.grantPlatformAccess(o.org.id, staff.s.id, staff.s.id)
  }, SETUP_TIMEOUT)

  afterAll(async () => {
    await fx?.cleanup()
  }, SETUP_TIMEOUT)

  describe("platform_staff, platform_grants, admin_journal (AC17)", () => {
    it("should never let a session write platform_staff, and let the staff only read it", async () => {
      expect(await codeOf(write("s", (sql) => sql`insert into platform.platform_staff (user_id) values (${o.people.lea.id})`))).toBe("42501")
      const staffIds = [staff.s.id, staff.s2.id, staff.s3.id]
      expect(await as("s").tx((sql) => sql`select user_id from platform.platform_staff where user_id in ${sql(staffIds)}`)).toHaveLength(3)
      for (const who of ["ada", "lea"] as const) {
        expect(await as(who).tx((sql) => sql`select user_id from platform.platform_staff`)).toEqual([])
      }
    })

    it("should let a staff member with access grant a colleague, once at a time (23505)", async () => {
      const grant = (sql: Tx) =>
        sql`insert into platform.platform_grants (org_id, user_id, granted_by, reason) values (${o.org.id}, ${staff.s4.id}, ${staff.s.id}, 'renfort') returning granted_by`
      expect(await write("s", grant)).toEqual([{ granted_by: staff.s.id }])
      expect(await codeOf(write("s", grant))).toBe("23505")
    })

    // Une organisation jetable dont Ada est l'admin : l'accès révoqué ici n'est celui d'aucun autre
    // test. Le staff révoque aussi, en son nom seulement, un accès à O posé pour ce test (S3).
    it("should let an admin, or the staff in its own name, revoke a grant, dated and signed, never reopened nor deleted", async () => {
      const q = await fx.createOrg()
      await fx.addMember(q.id, o.people.ada.id, { role: "admin" })
      const grant = await fx.grantPlatformAccess(q.id, staff.s2.id, staff.s.id)
      const revoke = (id: string, by: string) => (sql: Tx) =>
        sql`update platform.platform_grants set revoked_at = now(), revoked_by = ${by} where id = ${id} returning revoked_by`
      expect(await write("ada", revoke(grant, o.people.ada.id))).toEqual([{ revoked_by: o.people.ada.id }])
      const reopened = await write("ada", (sql) => sql`update platform.platform_grants set revoked_at = null, revoked_by = null where id = ${grant} returning id`).then(
        (rows) => Array.isArray(rows) && rows.length === 0,
        () => true,
      )
      expect(reopened).toBe(true)
      expect(await codeOf(write("s", (sql) => sql`delete from platform.platform_grants where id = ${grant}`))).toBe("42501")

      const staffGrant = await fx.grantPlatformAccess(o.org.id, staff.s3.id, staff.s.id)
      expect(await codeOf(write("s", revoke(staffGrant, o.people.ada.id)))).toBe("42501")
      expect(await write("s", revoke(staffGrant, staff.s.id))).toEqual([{ revoked_by: staff.s.id }])
    })

    // Tâche M02 (revue d'E01-S04 ; fiche D2 : chaque accès daté, lu par l'admin du client) : sous une
    // session, ni la date d'un accès, ni celle d'une ligne du journal admin, ni celle d'une révocation
    // ne viennent de l'appelant. Organisation jetable : l'accès révoqué n'est celui d'aucun autre test.
    it("should date grants, journal lines and revocations by the database, never by the caller", async () => {
      const q = await fx.createOrg()
      await fx.addMember(q.id, o.people.ada.id, { role: "admin" })
      await fx.grantPlatformAccess(q.id, staff.s.id, staff.s.id)
      const past = new Date("2000-01-01T00:00:00.000Z")
      const grant = write("s", (sql) => sql`insert into platform.platform_grants (org_id, user_id, granted_by, granted_at) values (${q.id}, ${staff.s3.id}, ${staff.s.id}, ${past})`)
      const line = write("s", (sql) => sql`insert into platform.admin_journal (org_id, user_id, method, ts) values (${q.id}, ${staff.s.id}, 'tools/call', ${past})`)
      expect([await codeOf(grant), await codeOf(line)]).toEqual(["42501", "42501"])
      const granted = await fx.grantPlatformAccess(q.id, staff.s2.id, staff.s.id)
      const revoked = await as("ada").tx(
        (sql) => sql<{ granted_at: Date; revoked_at: Date | null }[]>`
          update platform.platform_grants set revoked_at = ${past}, revoked_by = ${o.people.ada.id} where id = ${granted} returning granted_at, revoked_at`,
      )
      expect(revoked).toHaveLength(1)
      expect((revoked[0].revoked_at ?? past).getTime()).toBeGreaterThanOrEqual(revoked[0].granted_at.getTime())
    })

    it("should let the staff journal for itself only, and the admins read their organisation's lines", async () => {
      const journal = (who: Who, userId: string, op: string | null = null) =>
        write(who, (sql) => sql`insert into platform.admin_journal (org_id, user_id, method, op) values (${o.org.id}, ${userId}, 'tools/call', ${op})`)
      expect(await codeOf(journal("s", staff.s.id, "list"))).toBeNull()
      expect(await codeOf(journal("s", o.people.lea.id))).toBe("42501")
      expect(await codeOf(journal("lea", o.people.lea.id))).toBe("42501")
      const elsewhere = await fx.createOrg()
      await fx.admin`insert into platform.admin_journal (org_id, user_id, method) values (${elsewhere.id}, ${staff.s.id}, 'tools/call')`

      const linesOf = (who: Who) => as(who).tx((sql) => sql<{ org_id: string }[]>`select org_id from platform.admin_journal where user_id = ${staff.s.id}`)
      expect((await linesOf("ada")).map((line) => line.org_id)).toEqual([o.org.id])
      expect((await linesOf("s")).map((line) => line.org_id).sort()).toEqual([o.org.id, elsewhere.id].sort())
    })
  })

  describe("create_org (AC18)", () => {
    type CreateOrgArgs = { p_name: string; p_slug: string; p_prefix: string; p_hosts: string[] }
    const newOrg = (overrides: Partial<CreateOrgArgs> = {}): CreateOrgArgs => {
      const suffix = hex(4)
      return { p_name: "Acme Test", p_slug: `t${suffix}`, p_prefix: `t${suffix}`, p_hosts: [`t${suffix}.example.invalid`], ...overrides }
    }
    const callCreateOrg = (who: Who, args: CreateOrgArgs) =>
      as(who)
        .tx(
          (sql) => sql<{ id: string }[]>`
            select platform.create_org(p_name => ${args.p_name}, p_slug => ${args.p_slug}, p_prefix => ${args.p_prefix}, p_hosts => ${args.p_hosts}::text[]) as id`,
        )
        .then(([row]) => row.id)
    /** Crée par `create_org` sous la session de S ; l'organisation créée part au nettoyage. */
    async function createOrg(args: CreateOrgArgs): Promise<string> {
      const id = await callCreateOrg("s", args)
      fx.trackOrg(id)
      return id
    }

    it("should create the organisation, its root, private, contexte, the creator's access and the hosts", async () => {
      const args = newOrg()
      const id = await createOrg(args)
      const nodes = await fx.admin`select path, title, kind, status, owner_kind from platform.nodes where org_id = ${id} order by path`
      expect(nodes).toEqual([
        { path: "contexte", title: "Contexte", kind: "context", status: "draft", owner_kind: "org" },
        { path: "guide", title: "Guide de Acme Test", kind: "page", status: "draft", owner_kind: "org" },
        { path: "private", title: "Espaces personnels", kind: "page", status: "draft", owner_kind: "org" },
      ])
      expect(await fx.admin`select user_id, reason, revoked_at from platform.platform_grants where org_id = ${id}`).toEqual([
        { user_id: staff.s.id, reason: "creation", revoked_at: null },
      ])
      expect(await fx.admin`select host from platform.org_domains where org_id = ${id}`).toEqual([{ host: args.p_hosts[0] }])
      expect(await level("s", await fx.nodeId(id, "guide"))).toBe(3)
    })

    it("should refuse someone outside the staff (42501)", async () => {
      expect(await codeOf(callCreateOrg("ada", newOrg()))).toBe("42501")
    })

    // Un refus par mécanisme : la validation des arguments par la fonction (22023) et la contrainte du
    // préfixe (23514) ; le nom vide et le nom trop long, refusés par la même validation que le slug,
    // sont retirés (M11b).
    it.each([
      ["a slug with capitals", { p_slug: "Acme" }, "22023"],
      ["an invalid prefix", { p_prefix: "9acme" }, "23514"],
    ] as const)("should refuse %s (%s)", async (_label, override, code) => {
      expect(await codeOf(createOrg(newOrg(override)))).toBe(code)
    })

    it("should refuse a slug, a prefix or a host already taken (23505), creating nothing", async () => {
      const taken = newOrg()
      await createOrg(taken)
      const fresh = newOrg()
      for (const clash of [{ p_slug: taken.p_slug }, { p_prefix: taken.p_prefix }, { p_hosts: taken.p_hosts }]) {
        expect(await codeOf(createOrg({ ...fresh, ...clash }))).toBe("23505")
      }
      expect(await fx.admin`select id from platform.orgs where slug = ${fresh.p_slug} or prefix = ${fresh.p_prefix}`).toEqual([])
      expect(await fx.admin`select host from platform.org_domains where host = ${fresh.p_hosts[0]}`).toEqual([])
    })
  })

  describe("reading functions (AC19)", () => {
    // L'historique du projet change à la ligne de base (E01-S09, AC16 : la procédure de JB) : la
    // forme de chaque migration appliquée, pas une version. L'historique est la table de la CLI de
    // Supabase (`supabase_migrations.schema_migrations`), que le job `bare-postgres` pose aussi (`supabase
    // db push`) ; sur une base migrée sans elle, le cas se saute en le disant.
    it("should serve the applied migrations to the staff only", async (ctx) => {
      const [{ history }] = await fx.admin<{ history: boolean }[]>`
        select pg_catalog.to_regclass('supabase_migrations.schema_migrations') is not null as history`
      if (!history) return ctx.skip("no migration history of the Supabase CLI on this database")
      const applied = (sql: Tx) => sql<{ version: string }[]>`select * from platform.applied_migrations()`
      const rows = await as("s").tx(applied)
      expect(rows.length).toBeGreaterThan(0)
      expect(rows.filter((row) => !/^\d{14}$/.test(row.version))).toEqual([])
      expect(await codeOf(as("lea").tx(applied))).toBe("42501")
    })

    it("should serve the member directory to members and to the staff with access, sorted by name", async () => {
      const directory = (who: Who) => as(who).tx((sql) => sql<{ name: string }[]>`select * from platform.member_directory(${o.org.id})`)
      for (const who of ["lea", "s"] as const) {
        const rows = await directory(who)
        expect(rows.map((row) => row.name)).toEqual(["Ada Martin", "Claire Morel", "Léa Roux", "Marc Petit", "Paul Girard"])
        expect(rows.find((row) => row.name === "Claire Morel")).toEqual({
          user_id: o.people.claire.id,
          email: o.people.claire.email,
          name: "Claire Morel",
          role: "member",
          // E05-S13 (fiche D128) : la colonne reste servie, vide, jusqu'à son retrait en 1.1.
          default_team_id: null,
          last_sign_in_at: null,
        })
      }
      expect(await directory("outsider")).toEqual([])
    })

    it("should serve the staff directory to the staff only", async () => {
      const directory = (who: Who) => as(who).tx((sql) => sql<{ user_id: string; name: string }[]>`select * from platform.staff_directory()`)
      const mine = (await directory("s2")).filter((row) => [staff.s.id, staff.s2.id, staff.s3.id].includes(row.user_id))
      expect(mine.map((row) => row.name).sort()).toEqual(["Sacha Deux", "Sam Staff", "Sonia Trois"])
      expect(mine[0]).toEqual({ user_id: expect.any(String), email: expect.any(String), name: expect.any(String), added_at: expect.any(Date) })
      for (const who of ["ada", "outsider"] as const) expect(await directory(who)).toEqual([])
    })

    it("should serve the effective owner of a node to members only", async () => {
      const owner = (who: Who) => as(who).tx((sql) => sql`select * from platform.node_owner(${o.nodes.devis})`)
      expect(await owner("lea")).toEqual([{ owner_kind: "team", owner_team_id: o.teams.ventes, owner_user_id: null, owner_node_id: o.nodes.ventes }])
      expect(await owner("outsider")).toEqual([])
    })
  })

  describe("platform access directory (AC25, D2)", () => {
    it("should name who holds, held, granted or revoked an access to the staff and the admins only", async () => {
      // Une organisation nue, Ada administratrice et Léa simple membre : l'arbre et les équipes d'une
      // organisation de référence n'y servaient pas (M11b).
      const p = await fx.createOrg()
      await fx.addMember(p.id, o.people.ada.id, { role: "admin" })
      await fx.addMember(p.id, o.people.lea.id)
      await fx.grantPlatformAccess(p.id, staff.s.id, staff.s2.id)
      const revokedGrant = await fx.grantPlatformAccess(p.id, staff.s3.id, staff.s.id)
      await fx.admin`update platform.platform_grants set revoked_at = now(), revoked_by = ${o.people.ada.id} where id = ${revokedGrant}`
      const expected = [
        { user_id: staff.s2.id, email: staff.s2.email, name: "Sacha Deux" },
        { user_id: staff.s.id, email: staff.s.email, name: "Sam Staff" },
        { user_id: staff.s3.id, email: staff.s3.email, name: "Sonia Trois" },
      ]
      const directory = (who: Who) => as(who).tx((sql) => sql`select * from platform.platform_access_directory(${p.id})`)
      for (const who of ["ada", "s", "s2"] as const) expect(await directory(who), who).toEqual(expected)
      for (const who of ["lea", "outsider"] as const) expect(await directory(who), who).toEqual([])
    })
  })

  // Sur une organisation jetable dont Ada est l'admin : l'accès de S à O, dont les autres tests ont
  // besoin, reste en cours quel que soit l'ordre des tests.
  describe("revocation cuts the consultant (AC10)", () => {
    it("should cut the consultant at the next request once an admin revokes the access", async () => {
      const r = await fx.createOrg()
      const tree = await fx.createTree(r.id)
      await fx.addMember(r.id, o.people.ada.id, { role: "admin" })
      const grant = await fx.grantPlatformAccess(r.id, staff.s.id, staff.s.id)
      const membersSeenByS = () => as("s").tx((sql) => sql`select user_id from platform.members where org_id = ${r.id}`)
      expect(await membersSeenByS()).toHaveLength(1)
      expect(await level("s", tree.root)).toBe(3)
      const revoked = await as("ada").tx(
        (sql) => sql`update platform.platform_grants set revoked_at = now(), revoked_by = ${o.people.ada.id} where id = ${grant} returning id`,
      )
      expect(revoked).toHaveLength(1)
      expect(await as("s").tx((sql) => sql`select id from platform.orgs where id = ${r.id}`)).toEqual([])
      expect(await membersSeenByS()).toEqual([])
      expect(await level("s", tree.root)).toBe(0)
    })
  })
})
