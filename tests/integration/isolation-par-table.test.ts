// @vitest-environment node
// Isolation par organisation, table par table (E01-S08 : AC3 à AC6, AC8), sur une vraie base (H120 ; la
// base est ici le sujet, testing-strategy.md § Budget de tests). Deux organisations jetables, A
// (l'organisation de référence d'E01-S04) et B, ont chacune au moins une ligne dans chaque table de
// `platform`, posée par la connexion d'administration. Les tables, leurs clés et le rattachement d'une
// table sans `org_id` viennent de la carte de l'export-import (`TABLES`, `scripts/lib/org-transfer.mjs`),
// où une table ajoutée à `platform` entre avec sa migration (database-patterns.md § Migrations) : ce test
// la parcourt alors, et échoue tant qu'aucune ligne n'y est posée ici. Personnes : Marc (membre simple de
// A, sans équipe), Bea (membre de B), S0 (équipe plateforme, sans accès à A), SA (équipe plateforme, accès
// en cours à A, non membre), X (connecté, membre d'aucune organisation) et `anon`. Lectures et écritures
// passent par la face SQL, sous la session de la personne (`fx.as`) ou d'`anon` (`withAnonSession`) : la
// carte nomme ses tables par des chaînes. Suite portable depuis E01-S10 f2 (plus de PostgREST ni de
// Supabase Auth) : le job `bare-postgres` la joue.
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { PlatformDb } from "../../packages/plateforme/server/db"
import { withAnonSession, type Tx } from "../../packages/plateforme/server/sql"
import { TABLES } from "../../scripts/lib/org-transfer.mjs"
import { ctxCode, hex, type TestOrg } from "../helpers/plateforme"
import { codeOf, createSqlFixtures, SQL_SKIP_REASON, sqlConfigured, type SqlFixtures, type SqlReferenceOrg, type SqlUser, type TestSql } from "../helpers/sql"
import { privateFolderPending, privateFolderSuite } from "../helpers/pending-migrations"

// Ces tests supposent le dossier `private` en base (fiche D107) : sautés, la version nommée, tant que
// 20260928120000 n'est pas appliquée au projet (`database-patterns.md § Règles`).
const privatePending = await privateFolderPending()

const NETWORK_TIMEOUT = 60_000
const SETUP_TIMEOUT = 240_000
// Une quarantaine d'écritures refusées, l'une après l'autre, et deux relectures complètes de A.
const WRITES_TIMEOUT = 120_000
const SUITE = "isolation between organisations, table by table"

/** Les tables du contenu d'un nœud, que la base ne rend qu'à qui lit le nœud (`20261021130000`). */
const CONTENT = ["blocks", "files", "links", "node_drafts", "node_shares", "node_versions"]

/** Tables sans écriture accordée à `authenticated` : rien à tenter (AC4). */
const SELECT_ONLY = ["links", "node_aliases", "node_versions"]

type Who = "marc" | "bea" | "s0" | "sa" | "x"
type Spec = (typeof TABLES)[number]
type Row = Record<string, unknown>
/** Une organisation : son id, et les ids de ses lignes parentes (`teams`, `nodes`) pour les tables qui s'y rattachent. */
type Scope = { org: string; parents: Record<string, string[]> }
/** Clés lues, table par table ; le code d'erreur d'une lecture refusée. */
type Keys = Record<string, string[] | string>
/** Qui lit : la connexion d'administration (relecture), une session (`PlatformDb`), ou `anon`. */
type Reader = { admin: TestSql } | { db: PlatformDb } | "anon"

/**
 * Les lignes de l'organisation dans une table, filtrées comme l'export (`orgRowsSql` de la carte) : par
 * `org_id` (`id` pour `orgs`), ou par la ligne parente parmi les identifiants de `scope`, lus d'avance
 * par la connexion d'administration (sous la session, une sous-requête sur la table parente serait
 * elle-même filtrée par la RLS et cacherait une fuite de la table lue).
 */
function rowsOf(sql: Tx | TestSql, spec: Spec, scope: Scope, columns: readonly string[]) {
  const from = sql`select ${sql([...columns])} from ${sql(`platform.${spec.name}`)}`
  if (!spec.parent) return sql<Row[]>`${from} where ${sql(spec.name === "orgs" ? "id" : "org_id")} = ${scope.org}`
  return sql<Row[]>`${from} where ${sql(spec.parent.column)} = any(${scope.parents[spec.parent.table] ?? []}::uuid[])`
}

/** `run` sous le lecteur : dans une transaction de sa session, ou sur la connexion d'administration. */
function readAs<T>(reader: Reader, run: (sql: Tx | TestSql) => Promise<T>): Promise<T> {
  if (reader === "anon") return withAnonSession(run)
  return "admin" in reader ? run(reader.admin) : reader.db.tx(run)
}

const keyOf = (spec: Spec, row: Row) => spec.key.map((column) => String(row[column])).join("/")

/** Le code de l'erreur de la base, telle quelle. */
const errorCode = (error: unknown) => String(error instanceof Error ? Reflect.get(error, "code") : error)

/** Clés des lignes de l'organisation que le lecteur lit, table par table. */
async function keysOf(reader: Reader, scope: Scope): Promise<Keys> {
  const read = await Promise.all(
    TABLES.map(async (spec) => {
      const keys = await readAs(reader, (sql) => rowsOf(sql, spec, scope, spec.key)).then(
        (rows): string[] | string => rows.map((row) => keyOf(spec, row)).sort(),
        errorCode,
      )
      return [spec.name, keys] as const
    }),
  )
  return Object.fromEntries(read)
}

/** Une écriture : son code d'erreur, le nombre de lignes rendues (`returning`), ou `written` pour une insertion sans `returning`. */
function outcome(write: Promise<readonly unknown[]>, counted: boolean): Promise<string> {
  return write.then((rows) => (counted ? `${rows.length} rows` : "written"), errorCode)
}

describe.skipIf(!sqlConfigured || privatePending)(privateFolderSuite(sqlConfigured ? SUITE : `${SUITE} (${SQL_SKIP_REASON})`, privatePending), { timeout: NETWORK_TIMEOUT }, () => {
  let fx: SqlFixtures
  let service: Reader
  let a: SqlReferenceOrg
  let b: TestOrg
  let scopeA: Scope
  let scopeB: Scope
  const nobody: SqlUser = { id: "", email: "", name: null }
  const people: Record<Exclude<Who, "marc">, SqlUser> = { bea: nobody, s0: nobody, sa: nobody, x: nobody }
  const ids = {
    pageA: "",
    blockA: "",
    ruleA: "",
    shareA: "",
    fileA: "",
    accountA: "",
    grantA: "",
    invitationToBea: "",
    ticketA: "",
    simA: "",
    teamB: "",
    pageB: "",
    accountB: "",
  }

  const as = (who: Who): PlatformDb => fx.as(who === "marc" ? a.people.marc : people[who])
  const session = (who: Who): Reader => ({ db: as(who) })

  /** Une insertion sous la session : son code d'erreur, ou `written`. */
  const insert = (who: Who, table: string, row: Row) => outcome(as(who).tx((sql) => sql`insert into ${sql(`platform.${table}`)} ${sql(row)}`), false)
  /** Une instruction sous la session, rendant ses lignes : son code d'erreur, ou le nombre de lignes. */
  const counted = (who: Who, run: (sql: Tx) => Promise<readonly unknown[]>) => outcome(as(who).tx(run), true)
  /** Une écriture sous le rôle du serveur pour la personne : il hérite des policies d'`authenticated`. */
  const countedByServer = (who: Who, run: (sql: Tx) => Promise<readonly unknown[]>) => outcome(as(who).tx(run, "server"), true)

  async function scopeOf(org: string): Promise<Scope> {
    const teams = await fx.admin<{ id: string }[]>`select id from platform.teams where org_id = ${org}`
    const nodes = await fx.admin<{ id: string }[]>`select id from platform.nodes where org_id = ${org}`
    return { org, parents: { teams: teams.map((row) => row.id), nodes: nodes.map((row) => row.id) } }
  }

  /** Lignes complètes de l'organisation, relues par la connexion d'administration, rangées par clé : ce qu'un refus doit laisser. */
  async function snapshot(scope: Scope): Promise<Record<string, unknown[]>> {
    const read = await Promise.all(
      TABLES.map(async (spec) => {
        const rows = await rowsOf(fx.admin, spec, scope, [...new Set([...spec.key, ...spec.columns])])
        return [spec.name, [...rows].sort((left, right) => keyOf(spec, left).localeCompare(keyOf(spec, right)))] as const
      }),
    )
    return Object.fromEntries(read)
  }

  /** `platform_staff` n'a pas d'organisation : les lignes des deux membres de l'équipe plateforme du test. */
  function staffRows(reader: Reader): Promise<string[] | string> {
    return readAs(reader, (sql) => sql<{ user_id: string }[]>`select user_id from platform.platform_staff where user_id in ${sql([people.s0.id, people.sa.id])}`).then(
      (rows): string[] | string => rows.map((row) => row.user_id).sort(),
      errorCode,
    )
  }

  /** Une page publiée de deux blocs et d'un lien, son brouillon ouvert, un ancien chemin : une ligne dans chaque table du contenu. */
  async function seedContent(org: string, parentId: string, path: string, link: string): Promise<{ page: string; block: string }> {
    const page = await fx.createNode(org, { parentId, path, title: "Offre" })
    const { blockIds } = await fx.publishBlocks(
      page,
      [
        { type: "paragraph", text: "Premier." },
        { type: "paragraph", text: "Second." },
      ],
      { links: [{ block: 0, path: link }] },
    )
    await fx.admin`select * from platform.open_draft(${page})`
    await fx.admin`insert into platform.node_aliases (org_id, old_path, node_id) values (${org}, ${`${path}_ancienne`}, ${page})`
    return { page, block: blockIds[0] }
  }

  /** Accès plateforme, journal admin, retours, boîte d'envoi et invitations de A et de B. */
  async function seedRows(): Promise<void> {
    const { admin } = fx
    const { claire, lea, ada } = a.people
    ids.grantA = await fx.grantPlatformAccess(a.org.id, people.sa.id, people.sa.id)
    await admin`
      insert into platform.platform_grants (org_id, user_id, granted_by, revoked_at, revoked_by)
      values (${b.id}, ${people.s0.id}, ${people.s0.id}, now(), ${people.s0.id})`
    await admin`
      insert into platform.admin_journal (org_id, user_id, method)
      values (${a.org.id}, ${people.sa.id}, 'tools/call'), (${b.id}, ${people.s0.id}, 'tools/call')`
    const tickets = await admin<{ id: string; user_id: string }[]>`
      insert into platform.feedback (org_id, user_id, type, text, number)
      values (${a.org.id}, ${claire.id}, 'gap', 'Il manque la grille.', 0),
             (${a.org.id}, ${lea.id}, 'friction', 'Lent.', 0),
             (${b.id}, ${people.bea.id}, 'gap', 'Il manque une page.', 0)
      returning id, user_id`
    const ticket = tickets.find((row) => row.user_id === claire.id)
    if (!ticket) throw new Error("ticket of Claire not returned")
    ids.ticketA = String(ticket.id)
    const outbox = await admin<{ id: string; org_id: string }[]>`
      insert into platform.sim_outbox (org_id, account_id, connector, function, payload, created_by)
      values (${a.org.id}, ${ids.accountA}, 'mail', 'mail.create_draft', ${admin.json({ to: "x@example.invalid" })}, ${claire.id}),
             (${b.id}, ${ids.accountB}, 'mail', 'mail.create_draft', ${admin.json({ to: "y@example.invalid" })}, ${people.bea.id})
      returning id, org_id`
    ids.simA = outbox.find((row) => row.org_id === a.org.id)?.id ?? ""
    const [toBea] = await admin<{ id: string }[]>`
      insert into platform.invitations (org_id, email, invited_by) values (${a.org.id}, ${people.bea.email}, ${ada.id}) returning id`
    await admin`
      insert into platform.invitations (org_id, email, team_id, invited_by) values (${a.org.id}, ${`test-${hex(6)}@example.invalid`}, ${a.teams.ventes}, ${claire.id})`
    await admin`insert into platform.invitations (org_id, email, invited_by) values (${b.id}, ${`test-${hex(6)}@example.invalid`}, ${people.bea.id})`
    ids.invitationToBea = toBea.id
    await fx.seedCtxJournal(a.org, claire, [{ tool: "t_read", target: "ventes/offre" }])
    await fx.seedCtxJournal(a.org, lea, [{ tool: "t_context", target: null }])
    await fx.seedCtxJournal({ id: b.id }, people.bea, [{ tool: "t_read", target: "equipe_b/offre" }])
  }

  beforeAll(async () => {
    fx = createSqlFixtures()
    service = { admin: fx.admin }
    a = await fx.buildReferenceOrg()
    people.bea = await fx.createUser({ fullName: "Bea Blanc" })
    people.s0 = await fx.createUser({ fullName: "Sol Zéro" })
    people.sa = await fx.createUser({ fullName: "Sacha Accès" })
    people.x = await fx.createUser({ fullName: "Xavier Seul" })
    for (const staff of [people.s0, people.sa]) await fx.makeStaff(staff.id)

    b = await fx.createOrg({ hosts: [`t${hex(4)}.example.invalid`] })
    await fx.createTree(b.id)
    await fx.addMember(b.id, people.bea.id, { profile: { handle: "bea", name: "Bea Blanc" } })
    ids.teamB = (await fx.createTeam(b.id, { slug: "equipe_b", name: "Équipe B", leadUserId: people.bea.id })).id

    const contentA = await seedContent(a.org.id, a.nodes.ventes, "ventes/offre", "support/faq")
    ids.pageA = contentA.page
    ids.blockA = contentA.block
    ids.pageB = (await seedContent(b.id, await fx.nodeId(b.id, "equipe_b"), "equipe_b/offre", "equipe_b")).page
    ids.ruleA = await fx.addRule({ orgId: a.org.id, nodeId: ids.pageA, teamId: a.teams.support, level: "read" })
    await fx.addRule({ orgId: b.id, nodeId: ids.pageB, teamId: ids.teamB, level: "read" })
    // Un lien public dans A et dans B (E05-S10, ADR-013), jeton tiré par la base.
    const [shareA] = await fx.admin<{ id: string }[]>`
      insert into platform.node_shares (org_id, node_id, created_by) values (${a.org.id}, ${ids.pageA}, ${a.people.claire.id}) returning id`
    ids.shareA = shareA.id
    await fx.admin`insert into platform.node_shares (org_id, node_id, created_by) values (${b.id}, ${ids.pageB}, ${people.bea.id})`
    // Un fichier joint dans A et dans B (E10-S02, ADR-016) : sa ligne seule, aucun objet dans un bucket.
    const [fileA] = await fx.admin<{ id: string }[]>`
      insert into platform.files (org_id, node_id, name, mime, size, status, created_by)
      values (${a.org.id}, ${ids.pageA}, 'offre.pdf', 'application/pdf', 3, 'ready', ${a.people.claire.id}) returning id`
    ids.fileA = fileA.id
    await fx.admin`
      insert into platform.files (org_id, node_id, name, mime, size, status, created_by)
      values (${b.id}, ${ids.pageB}, 'offre.pdf', 'application/pdf', 3, 'ready', ${people.bea.id})`
    ids.accountA = await fx.createAccount(a.org.id, { ownerKind: "team", ownerTeamId: a.teams.ventes, label: "Mail Ventes" })
    await fx.createAccount(a.org.id, { ownerKind: "user", ownerUserId: a.people.claire.id, label: "Mail Claire" })
    ids.accountB = await fx.createAccount(b.id, { ownerKind: "org", label: "Mail B" })
    await fx.addActivation(a.org.id, "mail")
    await fx.addActivation(b.id, "notion")
    await seedRows()

    scopeA = await scopeOf(a.org.id)
    scopeB = await scopeOf(b.id)
    const empty = (keys: Keys, org: string) => Object.entries(keys).flatMap(([table, read]) => (typeof read === "string" || read.length === 0 ? [`${org}.${table}`] : []))
    const missing = [...empty(await keysOf(service, scopeA), "A"), ...empty(await keysOf(service, scopeB), "B")]
    if (missing.length > 0) throw new Error(`no row seeded in ${missing.join(", ")}`)
  }, SETUP_TIMEOUT)

  afterAll(async () => {
    await fx?.cleanup()
  }, SETUP_TIMEOUT)

  it("should keep each organisation's rows from any person outside it, the invitee and the platform scope aside (AC3)", async () => {
    const none: Keys = Object.fromEntries(TABLES.map((spec) => [spec.name, []]))
    const inA = await keysOf(service, scopeA)
    expect({
      bea: await keysOf(session("bea"), scopeA),
      s0: await keysOf(session("s0"), scopeA),
      x: await keysOf(session("x"), scopeA),
      sa: await keysOf(session("sa"), scopeA),
      beaInB: await keysOf(session("bea"), scopeB),
    }).toEqual({
      // L'invitée lit l'invitation adressée à l'email de sa session (`invitations_select_own`, HN-E01S08-6).
      bea: { ...none, invitations: [ids.invitationToBea] },
      // Portée plateforme (HN-E01S08-3) : toute l'équipe plateforme lit les accords et le journal admin.
      s0: { ...none, platform_grants: inA.platform_grants, admin_journal: inA.admin_journal },
      x: none,
      // L'accès plateforme en cours compte comme appartenance (`member_orgs`, H73).
      sa: inA,
      beaInB: await keysOf(service, scopeB),
    })
    const staff = [people.s0.id, people.sa.id].sort()
    expect({ bea: await staffRows(session("bea")), x: await staffRows(session("x")), s0: await staffRows(session("s0")), sa: await staffRows(session("sa")) }).toEqual({
      bea: [],
      x: [],
      s0: staff,
      sa: staff,
    })
    // `anon` : aucune table accordée (42501), ou aucune ligne.
    const anonymous: Keys = { ...(await keysOf("anon", scopeA)), platform_staff: await staffRows("anon") }
    expect(Object.entries(anonymous).filter(([, read]) => read !== "42501" && read.length > 0)).toEqual([])
  })

  it(
    "should refuse every write of a person outside the organisation, table by table and command by command (AC4)",
    async () => {
      const org = a.org.id
      const now = new Date()
      const { marc, lea } = a.people
      const bea = (run: (sql: Tx) => Promise<readonly unknown[]>) => counted("bea", run)
      // Chaque commande que les privilèges accordent à `authenticated` (migrations du paquet) ;
      // l'insertion : 42501, ou 23503 quand la garde `BEFORE` lit sous la RLS et ne trouve pas le parent.
      const writes: [string, string, () => Promise<string>][] = [
        ["orgs insert", "42501", () => insert("bea", "orgs", { name: "Intrus", slug: `t${hex(4)}`, prefix: `t${hex(4)}` })],
        ["orgs update", "0 rows", () => bea((sql) => sql`update platform.orgs set name = 'Intrus' where id = ${org} returning id`)],
        // Une organisation, un compte, une activation ne se suppriment sous aucune session (20261019140000).
        ["orgs delete", "42501", () => bea((sql) => sql`delete from platform.orgs where id = ${org} returning id`)],
        ["members insert", "42501", () => insert("bea", "members", { org_id: org, user_id: people.bea.id, role: "admin" })],
        ["members update", "0 rows", () => bea((sql) => sql`update platform.members set role = 'admin' where org_id = ${org} and user_id = ${marc.id} returning user_id`)],
        ["members delete", "0 rows", () => bea((sql) => sql`delete from platform.members where org_id = ${org} and user_id = ${marc.id} returning user_id`)],
        ["teams insert", "42501", () => insert("bea", "teams", { org_id: org, slug: `intrus_${hex(2)}`, name: "Intrus" })],
        ["teams update", "0 rows", () => bea((sql) => sql`update platform.teams set name = 'Intrus' where id = ${a.teams.ventes} returning id`)],
        ["teams delete", "0 rows", () => bea((sql) => sql`delete from platform.teams where id = ${a.teams.support} returning id`)],
        ["team_members insert", "42501", () => insert("bea", "team_members", { team_id: a.teams.ventes, user_id: people.bea.id })],
        [
          "team_members update",
          "0 rows",
          () => bea((sql) => sql`update platform.team_members set role = 'lead' where team_id = ${a.teams.ventes} and user_id = ${lea.id} returning user_id`),
        ],
        ["team_members delete", "0 rows", () => bea((sql) => sql`delete from platform.team_members where team_id = ${a.teams.ventes} and user_id = ${lea.id} returning user_id`)],
        ["accounts insert", "42501", () => insert("bea", "accounts", { org_id: org, connector: "mail", owner_kind: "org", label: `Intrus ${hex(2)}` })],
        // `authenticated` ne modifie aucune colonne d'un compte (20261019130000) ; le rôle du serveur, sous la RLS.
        ["accounts update", "42501", () => bea((sql) => sql`update platform.accounts set label = 'Intrus' where id = ${ids.accountA} returning id`)],
        ["accounts update by the server", "0 rows", () => countedByServer("bea", (sql) => sql`update platform.accounts set status = 'disabled' where id = ${ids.accountA} returning id`)],
        ["accounts delete", "42501", () => bea((sql) => sql`delete from platform.accounts where id = ${ids.accountA} returning id`)],
        ["ctx insert", "42501", () => insert("bea", "ctx", { code: ctxCode(), org_id: org, user_id: people.bea.id, rules_version: 1 })],
        ["journal insert", "42501", () => insert("bea", "journal", { org_id: org, user_id: people.bea.id, method: "tools/call" })],
        ["org_domains insert", "42501", () => insert("bea", "org_domains", { host: `t${hex(4)}.example.invalid`, org_id: org })],
        ["org_domains delete", "0 rows", () => bea((sql) => sql`delete from platform.org_domains where host = ${a.host} returning host`)],
        ["invitations insert", "42501", () => insert("bea", "invitations", { org_id: org, email: `test-${hex(6)}@example.invalid`, invited_by: people.bea.id })],
        ["invitations update", "0 rows", () => bea((sql) => sql`update platform.invitations set revoked_at = ${now} where id = ${ids.invitationToBea} returning id`)],
        [
          "nodes insert",
          "23503",
          () => insert("bea", "nodes", { org_id: org, parent_id: a.nodes.root, path: `intrus_${hex(3)}`, title: "Intrus", summary: "Intrus.", created_by: people.bea.id }),
        ],
        // Depuis `20261021110000`, le titre ne s'écrit plus sous une session (droit de colonne) : le refus doit venir de
        // l'isolation, sur une colonne accordée.
        ["nodes update", "0 rows", () => bea((sql) => sql`update platform.nodes set position = 1 where id = ${ids.pageA} returning id`)],
        ["nodes delete", "0 rows", () => bea((sql) => sql`delete from platform.nodes where id = ${ids.pageA} returning id`)],
        [
          "access_rules insert",
          "42501",
          () => insert("bea", "access_rules", { org_id: org, node_id: ids.pageA, subject_user_id: people.bea.id, level: "read", created_by: people.bea.id }),
        ],
        ["access_rules update", "0 rows", () => bea((sql) => sql`update platform.access_rules set level = 'manage' where id = ${ids.ruleA} returning id`)],
        ["access_rules delete", "0 rows", () => bea((sql) => sql`delete from platform.access_rules where id = ${ids.ruleA} returning id`)],
        ["platform_grants insert", "42501", () => insert("bea", "platform_grants", { org_id: org, user_id: people.bea.id, granted_by: people.bea.id })],
        [
          "platform_grants update",
          "0 rows",
          () => bea((sql) => sql`update platform.platform_grants set revoked_at = ${now}, revoked_by = ${people.bea.id} where id = ${ids.grantA} returning id`),
        ],
        // S0 est de l'équipe plateforme : il lit `platform_staff`, et seule l'appartenance
        // (`member_orgs()`, accès en cours compris) lui refuse de s'accorder l'accès à A.
        ["platform_grants insert by staff", "42501", () => insert("s0", "platform_grants", { org_id: org, user_id: people.s0.id, granted_by: people.s0.id })],
        ["admin_journal insert", "42501", () => insert("bea", "admin_journal", { org_id: org, user_id: people.bea.id, method: "tools/call" })],
        ["node_drafts update", "0 rows", () => bea((sql) => sql`update platform.node_drafts set title = 'Intrus' where node_id = ${ids.pageA} returning node_id`)],
        [
          "blocks insert",
          "23503",
          () => insert("bea", "blocks", { node_id: ids.pageA, state: "draft", position: 9000, type: "paragraph", text: "Intrus.", created_by: people.bea.id }),
        ],
        ["blocks update", "0 rows", () => bea((sql) => sql`update platform.blocks set text = 'Intrus.' where id = ${ids.blockA} and state = 'draft' returning id`)],
        ["blocks delete", "0 rows", () => bea((sql) => sql`delete from platform.blocks where id = ${ids.blockA} and state = 'draft' returning id`)],
        ["feedback insert", "42501", () => insert("bea", "feedback", { org_id: org, user_id: people.bea.id, type: "gap", text: "Intrus.", number: 0 })],
        [
          "feedback update",
          "0 rows",
          () => bea((sql) => sql`update platform.feedback set state = 'declined', resolution = 'Intrus.' where id = ${ids.ticketA} returning id`),
        ],
        ["connector_activations insert", "42501", () => insert("bea", "connector_activations", { org_id: org, connector: `intrus_${hex(2)}`, activated_by: people.bea.id })],
        [
          "connector_activations update",
          "0 rows",
          () => bea((sql) => sql`update platform.connector_activations set state = 'inactive' where org_id = ${org} and connector = 'mail' returning connector`),
        ],
        [
          "connector_activations delete",
          "42501",
          () => bea((sql) => sql`delete from platform.connector_activations where org_id = ${org} and connector = 'mail' returning connector`),
        ],
        [
          "sim_outbox insert",
          "42501",
          () => insert("bea", "sim_outbox", { org_id: org, account_id: ids.accountA, connector: "mail", function: "mail.create_draft", created_by: people.bea.id }),
        ],
        [
          "sim_outbox update",
          "0 rows",
          () => bea((sql) => sql`update platform.sim_outbox set status = 'sent', sent_by = ${people.bea.id}, sent_at = ${now} where id = ${ids.simA} returning id`),
        ],
        ["node_shares insert", "42501", () => insert("bea", "node_shares", { org_id: org, node_id: ids.pageA, created_by: people.bea.id })],
        ["node_shares update", "0 rows", () => bea((sql) => sql`update platform.node_shares set revoked_at = ${now} where id = ${ids.shareA} returning id`)],
        [
          "files insert",
          "42501",
          () => insert("bea", "files", { org_id: org, node_id: ids.pageA, name: "intrus.pdf", mime: "application/pdf", size: 3, status: "pending", created_by: people.bea.id }),
        ],
        // Le passage à `ready` est une fonction du serveur (20261019130000) : aucune colonne de `files` ne se modifie.
        ["files update", "42501", () => bea((sql) => sql`update platform.files set status = 'pending' where id = ${ids.fileA} returning id`)],
        ["files ready by the server", "42501", () => countedByServer("bea", (sql) => sql`select id from platform.mark_files_ready(${org}, ${[ids.fileA]}::uuid[]) as id`)],
        ["files delete", "0 rows", () => bea((sql) => sql`delete from platform.files where id = ${ids.fileA} returning id`)],
        // Une ligne de B, que Bea administre le temps de la boucle, qu'une mise à jour déplacerait dans A : refusée par le
        // `with check`.
        ["members move", "42501", () => bea((sql) => sql`update platform.members set org_id = ${org} where org_id = ${b.id} and user_id = ${people.bea.id} returning user_id`)],
        [
          "team_members move",
          "42501",
          () => bea((sql) => sql`update platform.team_members set team_id = ${a.teams.ventes} where team_id = ${ids.teamB} and user_id = ${people.bea.id} returning user_id`),
        ],
        [
          "connector_activations move",
          "42501",
          () => bea((sql) => sql`update platform.connector_activations set org_id = ${org} where org_id = ${b.id} and connector = 'notion' returning connector`),
        ],
      ]
      const tried = new Set(writes.map(([label]) => label.split(" ")[0]))
      expect(TABLES.map((spec) => spec.name).filter((table) => !tried.has(table)).sort()).toEqual(SELECT_ONLY)

      const before = await snapshot(scopeA)
      const outcomes: [string, string][] = []
      // Depuis `20261020190000`, le `using` d'une mise à jour de `members`, `team_members` ou `connector_activations` exige
      // l'administrateur : membre simple de B, Bea n'y verrait pas ses lignes (0 ligne), et le `with check` ne serait pas
      // joué. Administratrice de B le temps de la boucle, elle n'est toujours rien dans A.
      await fx.admin`update platform.members set role = 'admin' where org_id = ${b.id} and user_id = ${people.bea.id}`
      try {
        for (const [label, , write] of writes) outcomes.push([label, await write()])
      } finally {
        await fx.admin`update platform.members set role = 'member' where org_id = ${b.id} and user_id = ${people.bea.id}`
      }
      expect(outcomes).toEqual(writes.map(([label, expected]) => [label, expected]))
      expect(await snapshot(scopeA)).toEqual(before)
    },
    WRITES_TIMEOUT,
  )

  // Depuis `20261021130000`, la lecture du contenu exige en base le niveau que son service décide : le contenu de A est
  // semé sous `ventes/offre`, de l'équipe Ventes, dont Marc n'est pas. Une règle de lecture de l'organisation sur
  // `ventes` lui en ouvre le publié (blocs, versions, liens, fichiers), jamais le brouillon (écriture) ni le lien
  // public (partage).
  it("should let a plain member without a team read every row of his organisation but the content he does not read (AC5)", async () => {
    const all = await keysOf(service, scopeA)
    const hidden = (tables: string[]) => Object.fromEntries(tables.map((table) => [table, []]))
    expect(await keysOf(session("marc"), scopeA)).toEqual({ ...all, ...hidden(CONTENT) })
    const [rule] = await fx.admin<{ id: string }[]>`
      insert into platform.access_rules (org_id, node_id, subject_org, level, created_by)
      values (${a.org.id}, ${a.nodes.ventes}, true, 'read', ${a.people.claire.id}) returning id`
    try {
      const opened = await keysOf(service, scopeA)
      const published = (opened.blocks as string[]).filter((key) => key.endsWith("/published"))
      expect(published.length).toBeGreaterThan(0)
      expect(await keysOf(session("marc"), scopeA)).toEqual({ ...opened, ...hidden(["node_drafts", "node_shares"]), blocks: published })
    } finally {
      await fx.admin`delete from platform.access_rules where id = ${rule.id}`
    }
  })

  // Seuls les invariants de policy qu'aucun test existant ne couvre (relevé à l'ouverture, story
  // E01-S08, post-implémentation) : les autres restent prouvés par leur fichier (émetteur d'une
  // invitation, révocation signée, envoi signé, ligne `ctx` et `journal` d'une autre personne, ticket
  // déjà traité, invitation rouverte, équipe d'une autre organisation, bloc publié d'un document,
  // racine, `private` et Contexte supprimés). Les accords sont tentés par SA : un membre hors de l'équipe
  // plateforme ne lit pas `platform_staff`, et le bénéficiaire y serait introuvable quel qu'il soit.
  it(
    "should refuse a member of the organisation the writes that break an invariant of a policy (AC6)",
    async () => {
      const org = a.org.id
      const { ada } = a.people
      const me = a.people.marc.id
      const draft = { account_id: ids.accountA, connector: "mail", function: "mail.create_draft" }
      const writes: [string, () => Promise<string>][] = [
        [
          "nodes: created by another person",
          () => insert("marc", "nodes", { org_id: org, parent_id: a.nodes.root, path: `forge_${hex(3)}`, title: "Forge", summary: "Forge.", created_by: ada.id }),
        ],
        [
          "nodes: a root",
          () => insert("marc", "nodes", { org_id: org, parent_id: null, path: "guide", title: "Racine", summary: "Racine.", owner_kind: "org", created_by: me }),
        ],
        [
          "blocks: created by another person",
          () => insert("marc", "blocks", { node_id: ids.pageA, state: "draft", position: 9000, type: "paragraph", text: "Forge.", created_by: ada.id }),
        ],
        [
          "access_rules: created by another person",
          () => insert("marc", "access_rules", { org_id: org, node_id: a.nodes.devis, subject_user_id: me, level: "read", created_by: ada.id }),
        ],
        [
          "access_rules: a target of another organisation",
          () => insert("marc", "access_rules", { org_id: org, node_id: ids.pageB, subject_user_id: me, level: "read", created_by: me }),
        ],
        [
          "access_rules: a subject of another organisation",
          () => insert("marc", "access_rules", { org_id: org, node_id: a.nodes.devis, subject_team_id: ids.teamB, level: "read", created_by: me }),
        ],
        // ADR-014 : la règle de toute l'organisation vise une cible de son organisation.
        [
          "access_rules: an organisation rule on a node of another organisation",
          () => insert("marc", "access_rules", { org_id: org, node_id: ids.pageB, subject_org: true, level: "write", created_by: me }),
        ],
        [
          "connector_activations: activated by another person",
          () => insert("marc", "connector_activations", { org_id: org, connector: `forge_${hex(2)}`, activated_by: ada.id }),
        ],
        ["sim_outbox: created by another person", () => insert("marc", "sim_outbox", { org_id: org, ...draft, created_by: ada.id })],
        ["sim_outbox: an account of another organisation", () => insert("marc", "sim_outbox", { org_id: org, ...draft, account_id: ids.accountB, created_by: me })],
        [
          "sim_outbox: created already sent",
          () => insert("marc", "sim_outbox", { org_id: org, ...draft, created_by: me, status: "sent", sent_by: me, sent_at: new Date() }),
        ],
        ["node_shares: created by another person", () => insert("marc", "node_shares", { org_id: org, node_id: a.nodes.devis, created_by: ada.id })],
        ["node_shares: a node of another organisation", () => insert("marc", "node_shares", { org_id: org, node_id: ids.pageB, created_by: me })],
        ["platform_grants: granted by another person", () => insert("sa", "platform_grants", { org_id: org, user_id: people.s0.id, granted_by: ada.id })],
        ["platform_grants: to a person outside the platform team", () => insert("sa", "platform_grants", { org_id: org, user_id: me, granted_by: people.sa.id })],
      ]
      const before = await snapshot(scopeA)
      const outcomes: [string, string][] = []
      for (const [label, write] of writes) outcomes.push([label, await write()])
      expect(outcomes).toEqual(writes.map(([label]) => [label, "42501"]))
      expect(await snapshot(scopeA)).toEqual(before)
    },
    WRITES_TIMEOUT,
  )

  // Option A de HN-E01S08-1, tranchée par JB (dans son organisation, une policy n'exige que l'appartenance et les
  // invariants), remplacée par la décision d'Alexis du 20/10 : une policy d'écriture d'administration reprend le rôle
  // que son service exige (`ROLE_REQUIRED` de `tests/unit/rls-policies.test.ts`, migrations `20261019150000` et
  // `20261020190000`). Le cas joué ici, une règle posée par un membre sans la gestion du nœud, est de nouveau refusé
  // par `access_rules_insert_manager` (`node_level_for`), et les refus de chaque policy sont joués par
  // `role-dans-les-policies.test.ts` et `role-dans-les-ajouts-et-modifications.test.ts`. Restent ouvertes sous une
  // session, nommées, jamais jouées : créer un nœud déjà publié, ou avec `meta` ou un propriétaire explicite, le
  // modifier, le déplacer ou le publier (`nodes_guard`, `publish_node`, `nodes_update_writer` : aucun niveau depuis
  // E01-S12 partie c), et poser ou retirer une règle d'un compte sans le gérer (`accountLevelOf`, sans pendant en base).
  it("should refuse a plain member posing a rule on a node of another team, which she does not manage (AC8)", async () => {
    const posed = as("marc").tx(
      (sql) => sql<{ id: string }[]>`
        insert into platform.access_rules (org_id, node_id, subject_team_id, level, created_by)
        values (${a.org.id}, ${a.nodes.devis}, ${a.teams.support}, 'read', ${a.people.marc.id}) returning id`,
    )
    expect(await codeOf(posed)).toBe("42501")
    expect(await fx.admin`select 1 from platform.access_rules where node_id = ${a.nodes.devis} and subject_team_id = ${a.teams.support}`).toHaveLength(0)
  })
})
