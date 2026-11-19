// @vitest-environment node
// Portabilité du schéma (E01-S09, AC1 à AC7) après la migration de portabilité : aucune clé ni lecture
// vers `auth.users`, invitations et annuaires lus dans les claims et dans les copies de `members` et de
// `platform_staff`, `forget_user`, `updated_at` sans `moddatetime`. Suite portable (E11-S14) : le
// catalogue et les sessions aux claims choisis passent par la connexion d'administration des suites
// portables, les données, jetables, par `createSqlFixtures` ; AC1 et AC2 lisent `auth.users` et
// `auth.oauth_*`, absents d'un Postgres nu, et gardent le projet (HN-E11S14-5).
import { randomUUID } from "crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { asClaims, type AdminSql, type AdminTx } from "../helpers/admin-sql"
import { hex, supabaseConfigured } from "../helpers/plateforme"
import { createSqlFixtures, onProject, portable, sqlConfigured, testAdminSql, type SqlFixtures, type SqlUser } from "../helpers/sql"
import { privateFolderPending, privateFolderSuite } from "../helpers/pending-migrations"

// Ces tests supposent le dossier `private` en base (fiche D107) : sautés, la version nommée, tant que
// 20260928120000 n'est pas appliquée au projet (`database-patterns.md § Règles`).
const privatePending = await privateFolderPending()

const NETWORK_TIMEOUT = 60_000
const SETUP_TIMEOUT = 180_000

/** Les 31 colonnes qui visaient `auth.users`, par ce que faisait leur clé à la suppression du compte. */
const PERSON_COLUMNS = {
  cascade: [
    "members.user_id",
    "team_members.user_id",
    "accounts.owner_user_id",
    "ctx.user_id",
    "access_rules.subject_user_id",
    "platform_staff.user_id",
    "platform_grants.user_id",
    // Les tickets de dépôt par lien de la personne (E10-S02 lot f), sans clé depuis leur création.
    "upload_tickets.user_id",
  ],
  // Sans action : l'espace personnel empêchait la suppression du compte (fiche D19).
  noAction: ["nodes.owner_user_id"],
  setNull: [
    "teams.lead_user_id",
    "journal.user_id",
    "invitations.invited_by",
    "invitations.accepted_by",
    "nodes.created_by",
    "nodes.updated_by",
    "access_rules.created_by",
    "platform_staff.added_by",
    "platform_grants.granted_by",
    "platform_grants.revoked_by",
    "admin_journal.user_id",
    "node_drafts.created_by",
    "node_drafts.updated_by",
    "blocks.claimed_by_user",
    "blocks.created_by",
    "blocks.updated_by",
    "node_versions.author",
    "node_aliases.created_by",
    "feedback.user_id",
    "feedback.handled_by",
    "connector_activations.activated_by",
    "sim_outbox.created_by",
    "sim_outbox.sent_by",
    // L'auteur d'un fichier joint (E10-S02), sans clé depuis sa création.
    "files.created_by",
  ],
}
const ALL_PERSON_COLUMNS = [...PERSON_COLUMNS.cascade, ...PERSON_COLUMNS.noAction, ...PERSON_COLUMNS.setNull]

/** Le nom d'un compte tel que le calculaient les annuaires d'avant la migration, depuis `auth.users`. */
const accountName = (person: { email: string; fullName?: string }) => person.fullName || person.email.split("@")[0]

const plain = <T>(rows: readonly T[]) => [...rows]

/** Attend que la session `pid` attende un verrou (relation, ligne ou transaction) ; au plus 10 s. */
async function lockWaitOf(tx: AdminTx, pid: number): Promise<void> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const [{ waiting }] = await tx`select exists (select 1 from pg_catalog.pg_locks where pid = ${pid} and not granted) as waiting`
    if (waiting) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`forget_user never waited for a lock (backend ${pid})`)
}

/**
 * `forget_user(person)` sur sa propre connexion, pendant une autre transaction : `before`, puis l'appel,
 * puis `after` dès que `forget_user` attend l'un de ses verrous, puis la validation, qui le relâche.
 * Rend l'issue de `forget_user` (`forgotten`) ou son code d'erreur.
 */
async function forgetDuring(
  sql: AdminSql,
  person: string,
  before: (tx: AdminTx) => Promise<unknown>,
  after: (tx: AdminTx) => Promise<unknown> = async () => {},
): Promise<string> {
  const forgetter = await sql.reserve()
  let forgetting: Promise<string> = Promise.resolve("never called")
  try {
    const [{ pid }] = await forgetter`select pg_catalog.pg_backend_pid() as pid`
    await sql.begin(async (tx) => {
      await before(tx)
      forgetting = forgetter`select platform.forget_user(${person})`.then(
        () => "forgotten",
        (error: { code?: string }) => error.code ?? String(error),
      )
      await lockWaitOf(tx, pid)
      await after(tx)
    })
    return await forgetting
  } finally {
    await forgetting
    forgetter.release()
  }
}

describe.skipIf(!sqlConfigured)(
  portable("schema portability (E01-S09)"),
  { timeout: NETWORK_TIMEOUT },
  () => {
    let fx: SqlFixtures
    let sql: AdminSql

    beforeAll(() => {
      fx = createSqlFixtures()
      sql = testAdminSql()
    })

    afterAll(async () => {
      await fx?.cleanup()
      await sql?.end({ timeout: 5 })
    }, SETUP_TIMEOUT)

    it.skipIf(!supabaseConfigured)(onProject("should keep no foreign key to auth.users, the 33 person columns still uuid (AC1)"), async () => {
      const keys = await sql`select conrelid::regclass::text as tbl, conname from pg_catalog.pg_constraint
                              where confrelid = 'auth.users'::regclass and connamespace = 'platform'::regnamespace`
      expect(plain(keys)).toEqual([])
      const columns = await sql`select table_name || '.' || column_name as col, data_type from information_schema.columns
                                 where table_schema = 'platform' and table_name || '.' || column_name = any(${ALL_PERSON_COLUMNS})
                                 order by 1`
      expect(ALL_PERSON_COLUMNS).toHaveLength(33)
      expect(plain(columns)).toEqual([...ALL_PERSON_COLUMNS].sort().map((col) => ({ col, data_type: "uuid" })))
    })

    it.skipIf(!supabaseConfigured)(onProject("should leave auth.users to no function of platform, and the OAuth readings to auth.oauth_* and auth.sessions (AC2)"), async () => {
      const readers = await sql`select p.proname from pg_catalog.pg_proc p
                                 where p.pronamespace = 'platform'::regnamespace and p.prosrc ~ 'auth\\.users'`
      expect(readers.map((row) => row.proname).filter((name) => name !== "hook_before_user_created")).toEqual([])
      const authReaders = await sql`select p.proname,
                                           array(select distinct m[1] from regexp_matches(p.prosrc, 'auth\\.([a-z_]+)', 'g') m
                                                  where m[1] not in ('uid', 'jwt') order by 1) as reads
                                      from pg_catalog.pg_proc p
                                     where p.pronamespace = 'platform'::regnamespace and p.prosrc ~ 'auth\\.(?!uid\\(|jwt\\()'
                                     order by 1`
      expect(plain(authReaders)).toEqual([
        { proname: "oauth_clients_activity", reads: ["oauth_clients", "sessions"] },
        { proname: "oauth_pending_resource", reads: ["oauth_authorizations"] },
      ])
    })

    it("should accept invitations from the email of the session, name and sign-in date included, and nothing without an email claim (AC3)", async () => {
      const org = await fx.createOrg()
      const people = { full: randomUUID(), named: randomUUID(), anonymous: randomUUID() }
      const emails = { full: `test-${hex(6)}@example.invalid`, named: `test-${hex(6)}@example.invalid`, anonymous: `test-${hex(6)}@example.invalid` }
      await sql`insert into platform.invitations ${sql(Object.values(emails).map((email) => ({ org_id: org.id, email })))}`

      const accept = (person: string, claims: Record<string, unknown>) =>
        asClaims(sql, { sub: person, ...claims }, async (tx) => {
          const [{ joined }] = await tx`select platform.accept_invitations() as joined`
          await tx.unsafe("reset role")
          const members = await tx`select email, name, last_sign_in_at from platform.members where org_id = ${org.id} and user_id = ${person}`
          const [{ open }] = await tx`select count(*)::int as open from platform.invitations where org_id = ${org.id} and accepted_at is null`
          return { joined, members: plain(members), open }
        })

      const full = await accept(people.full, { email: emails.full.toUpperCase(), user_metadata: { full_name: "Xavier Invité", name: "Xavier" } })
      expect(full.joined).toEqual([{ org_id: org.id, slug: org.slug, name: org.name, role: "member" }])
      expect(full.members).toEqual([{ email: emails.full, name: "Xavier Invité", last_sign_in_at: expect.any(Date) }])
      const named = await accept(people.named, { email: emails.named, user_metadata: { name: "Nom Seul" } })
      expect(named.members).toEqual([{ email: emails.named, name: "Nom Seul", last_sign_in_at: expect.any(Date) }])
      const anonymous = await accept(people.anonymous, { user_metadata: { full_name: "Sans Email" } })
      expect(anonymous).toEqual({ joined: [], members: [], open: 3 })
    })

    it("should refuse to invite a member, the address read in members.email (AC4)", async () => {
      const org = await fx.createOrg()
      const email = `test-${hex(6)}@example.invalid`
      // Une personne sans compte Supabase : seule sa ligne `members` porte son adresse.
      await sql`insert into platform.members (org_id, user_id, email) values (${org.id}, ${randomUUID()}, ${email})`

      const error = await sql`insert into platform.invitations (org_id, email) values (${org.id}, ${email})`.then(
        () => null,
        (failure: { code?: string; message?: string }) => failure,
      )

      expect({ code: error?.code, message: error?.message }).toEqual({ code: "23505", message: "already_member" })
    })

    // `org_contact`, `member_directory` et `platform_access_directory` pour l'équipe en cours restent
    // tenus par `identite-sql.test.ts` et `role-plateforme.test.ts`, inchangés, qui passent après la
    // migration. Ici, ce qu'aucun autre test ne tient : les emails et noms de `staff_directory`, et un
    // ancien membre de l'équipe plateforme, que `auth.users` nommait encore (fiche D2, P27).
    it("should name the platform team as before the migration: staff_directory, a former member of the team in platform_access_directory from its grant, whose copies no token reads or writes (AC5)", async () => {
      const org = await fx.createOrg()
      const ada = await fx.createUser({ fullName: "Ada Admin" })
      await fx.addMember(org.id, ada.id, { role: "admin" })
      const sam = { ...(await fx.createUser({ fullName: "Sam Plateforme" })), fullName: "Sam Plateforme" }
      const tess = { ...(await fx.createUser({ fullName: "Tess Partie" })), fullName: "Tess Partie" }
      const ugo: SqlUser & { fullName?: string } = await fx.createUser()
      for (const person of [sam, tess, ugo]) await fx.makeStaff(person.id)
      // Tess accorde les trois accès, dont le sien : l'historique la nomme aussi comme auteur.
      for (const person of [sam, tess, ugo]) await fx.grantPlatformAccess(org.id, person.id, tess.id)
      const staffRows = await sql`select user_id, added_at from platform.platform_staff where user_id in ${sql([sam.id, tess.id, ugo.id])}`
      const addedAt = new Map(staffRows.map((row) => [row.user_id, row.added_at]))
      const byName = <T extends { name: string; user_id: string }>(rows: T[]) =>
        [...rows].sort((a, b) => (a.name === b.name ? (a.user_id < b.user_id ? -1 : 1) : a.name < b.name ? -1 : 1))
      const read = (who: string, query: (tx: AdminTx) => Promise<readonly Record<string, unknown>[]>) =>
        asClaims(sql, { sub: who }, async (tx) => {
          const rows = await query(tx)
          return { columns: Object.keys(rows[0] ?? {}), rows: plain(rows) }
        })

      const staff = await read(sam.id, (tx) => tx`select * from platform.staff_directory() where user_id in ${tx([sam.id, tess.id, ugo.id])}`)
      const staffExpected = byName([sam, tess, ugo].map((person) => ({ user_id: person.id, email: person.email, name: accountName(person), added_at: addedAt.get(person.id) })))
      expect(staff).toEqual({ columns: ["user_id", "email", "name", "added_at"], rows: staffExpected })

      // Tess et Ugo quittent l'équipe plateforme (`pnpm platform:staff remove`) ; aucun n'est membre.
      await sql`delete from platform.platform_staff where user_id in ${sql([tess.id, ugo.id])}`
      const access = await read(ada.id, (tx) => tx`select * from platform.platform_access_directory(${org.id})`)
      const accessExpected = byName([sam, tess, ugo].map((person) => ({ user_id: person.id, email: person.email, name: accountName(person) })))
      expect(access).toEqual({ columns: ["user_id", "email", "name"], rows: accessExpected })

      // Ces copies ne sortent que par l'annuaire, réservé aux administrateurs et à l'équipe plateforme
      // (fiche D2, revue 2) : sous un jeton, même d'administrateur, la table se lit sans elles, et elles
      // ne s'écrivent pas. Refus du privilège, contrôlé avant toute policy.
      const underToken = (query: (tx: AdminTx) => Promise<readonly unknown[]>) =>
        asClaims(sql, { sub: ada.id }, query).then(
          (rows) => `${rows.length} rows`,
          (error: { code?: string; message?: string }) => `${error.code} ${/permission denied/.test(error.message ?? "") ? "privilege" : error.message}`,
        )
      expect({
        others: await underToken((tx) => tx`select id, user_id, granted_by, granted_at, revoked_at, revoked_by, reason from platform.platform_grants where org_id = ${org.id}`),
        read: await underToken((tx) => tx`select user_email, user_name from platform.platform_grants where org_id = ${org.id}`),
        update: await underToken((tx) => tx`update platform.platform_grants set user_name = 'Autre' where org_id = ${org.id} returning id`),
        insert: await underToken(
          (tx) => tx`insert into platform.platform_grants (org_id, user_id, granted_by, user_email) values (${org.id}, ${sam.id}, ${ada.id}, 'autre@example.invalid') returning id`,
        ),
      }).toEqual({ others: "3 rows", read: "42501 privilege", update: "42501 privilege", insert: "42501 privilege" })
    })

    it.skipIf(privatePending)(privateFolderSuite("should forget a person for the tooling: former cascades deleted, former set null nulled, personal space gone; and refuse authenticated (42501) (AC6)", privatePending), async () => {
      const org = await fx.createOrg()
      const tree = await fx.createTree(org.id)
      const handle = `x_${hex(3)}`
      const x = await fx.createUser({ fullName: "Xavier Parti" })
      const other = await fx.createUser()
      await fx.addMember(org.id, x.id, { role: "admin", profile: { handle } })
      await fx.addMember(org.id, other.id)
      const team = await fx.createTeam(org.id, { slug: `equipe_${hex(3)}`, leadUserId: x.id })
      const led = await fx.createTeam(org.id, { slug: `menee_${hex(3)}`, leadUserId: other.id })
      await fx.addTeamMember(led.id, x.id)
      const [{ id: pageId }] = await sql<{ id: string }[]>`
        insert into platform.nodes (org_id, parent_id, path, title, summary, created_by, updated_by)
        values (${org.id}, ${tree.root}, ${`page_${hex(3)}`}, 'Page', 'Écrite par X.', ${x.id}, ${x.id}) returning id`
      await fx.addRule({ orgId: org.id, nodeId: pageId, userId: x.id, level: "read" })
      await fx.createAccount(org.id, { ownerKind: "user", ownerUserId: x.id, label: `perso-${hex(3)}` })
      await fx.makeStaff(x.id)
      await fx.grantPlatformAccess(org.id, x.id, x.id)
      await fx.seedCtxJournal(org, x, [{ tool: "t_read", target: "guide" }])
      const [{ id: invitationId }] = await sql<{ id: string }[]>`
        insert into platform.invitations (org_id, email, invited_by) values (${org.id}, ${`test-${hex(6)}@example.invalid`}, ${x.id}) returning id`
      expect(await fx.nodeId(org.id, `private/${handle}/contexte`)).toEqual(expect.any(String))

      const refused = await asClaims(sql, { sub: other.id }, (tx) => tx`select platform.forget_user(${x.id})`).catch((error: { code?: string }) => error.code)
      expect(refused).toBe("42501")
      await sql`select platform.forget_user(${x.id})`

      const left = await sql.unsafe(
        ALL_PERSON_COLUMNS.map((column) => {
          const [table, name] = column.split(".")
          return `select '${column}' as col, count(*)::int as n from platform.${table} where ${name} = $1`
        }).join(" union all "),
        [x.id],
      )
      expect(left.filter((row) => row.n > 0).map((row) => row.col)).toEqual([])
      // Une ligne autrefois en `set null` reste, sa colonne à null : compter la ligne, pas lire la colonne
      // (une sous-requête vaut aussi null quand la ligne a été supprimée).
      const kept = await sql`select
          (select count(*)::int from platform.nodes where org_id = ${org.id} and path like ${`private/${handle}%`}) as space,
          (select count(*)::int from platform.nodes where id = ${pageId} and created_by is null and updated_by is null) as page,
          (select count(*)::int from platform.teams where id = ${team.id} and lead_user_id is null) as team,
          (select count(*)::int from platform.team_members where team_id = ${led.id}) as led_members,
          (select count(*)::int from platform.invitations where id = ${invitationId} and invited_by is null) as invitation,
          (select count(*)::int from platform.journal where org_id = ${org.id} and user_id is null) as journal`
      expect(plain(kept)).toEqual([{ space: 0, page: 1, team: 1, led_members: 1, invitation: 1, journal: 1 }])

      // Les colonnes que ces données ne peuplent pas : chacune a son instruction dans `forget_user`, telle
      // que la clé retirée l'aurait jouée.
      const [{ source }] = await sql`select prosrc as source from pg_catalog.pg_proc
                                      where proname = 'forget_user' and pronamespace = 'platform'::regnamespace`
      const statementOf = (column: string) => {
        const [table, name] = column.split(".")
        if (PERSON_COLUMNS.cascade.includes(column)) return `delete from platform.${table} where ${name} = p_user;`
        if (PERSON_COLUMNS.setNull.includes(column)) return `update platform.${table} set ${name} = null where ${name} = p_user;`
        return `where s.${name} = p_user`
      }
      expect(ALL_PERSON_COLUMNS.filter((column) => !String(source).includes(statementOf(column)))).toEqual([])
    })

    it.skipIf(privatePending)(privateFolderSuite("should refuse to forget a person while a node of another owner lies under hers, naming it, then forget her once it is moved (AC6)", privatePending), async () => {
      const org = await fx.createOrg()
      const tree = await fx.createTree(org.id)
      const handle = `x_${hex(3)}`
      const x = await fx.createUser()
      await fx.addMember(org.id, x.id, { profile: { handle } })
      const team = await fx.createTeam(org.id, { slug: `equipe_${hex(3)}` })
      const segment = `dossier_${hex(3)}`
      // Un dossier d'équipe rangé dans l'espace de X garde son propriétaire (H71), et son contenu en hérite.
      const folder = await fx.createNode(org.id, { parentId: await fx.nodeId(org.id, `private/${handle}`), path: `private/${handle}/${segment}`, ownerKind: "team", ownerTeamId: team.id })
      await fx.createNode(org.id, { parentId: folder, path: `private/${handle}/${segment}/note` })

      const refused = await sql`select platform.forget_user(${x.id})`.then(
        () => null,
        (failure: { code?: string; message?: string }) => failure,
      )

      expect({ code: refused?.code, named: refused?.message?.includes(`${org.slug}:private/${handle}/${segment}`) }).toEqual({ code: "23503", named: true })
      const untouched = await sql`select
          (select count(*)::int from platform.members where user_id = ${x.id}) as member,
          (select count(*)::int from platform.nodes where org_id = ${org.id} and path like ${`private/${handle}%`}) as space`
      expect(plain(untouched)).toEqual([{ member: 1, space: 4 }])

      await sql`update platform.nodes set parent_id = ${tree.root}, path = ${segment} where id = ${folder}`
      await sql`select platform.forget_user(${x.id})`
      const after = await sql`select
          (select count(*)::int from platform.nodes where org_id = ${org.id} and path like ${`private/${handle}%`}) as space,
          (select count(*)::int from platform.nodes where org_id = ${org.id} and path in (${segment}, ${`${segment}/note`})) as team_nodes`
      expect(plain(after)).toEqual([{ space: 0, team_nodes: 2 }])
    })

    // Revue 2 : le refus ne tient à aucune lecture qui précède la suppression. Deux courses, chacune
    // pendant que `forget_user` tourne sur sa propre connexion, rendues déterministes par un verrou que
    // l'autre transaction tient jusqu'à ce que `forget_user` l'attende :
    // - un dossier d'équipe rangé sous l'espace après la lecture qui nomme les chemins (la transaction
    //   qui le déplace tient la ligne de l'espace, `for update` : la lecture passe, la suppression attend
    //   cette ligne, le déplacement est validé avant qu'elle ne reprenne). La seule ligne, jamais la table :
    //   un verrou `share` sur `platform.nodes` attend toutes les écritures des autres suites de la campagne ;
    // - un sous-dossier de l'espace cédé à l'équipe pendant que la suppression attend sa ligne.
    // La troisième, l'espace lui-même cédé à l'équipe pendant que `forget_user` attend son verrou, part
    // avec M26 : `nodes_guard` refuse tout autre propriétaire pour `private/<handle>` (M18b,
    // `tests/integration/proprietaires.test.ts`).
    it.skipIf(privatePending)(privateFolderSuite("should delete only what the person still owns when forget_user ends, whatever is moved under her space or handed over meanwhile (AC6)", privatePending), async () => {
      const org = await fx.createOrg()
      const tree = await fx.createTree(org.id)
      const team = await fx.createTeam(org.id, { slug: `equipe_${hex(3)}` })
      // Trois personnes sans compte : seules leurs lignes `members` et leurs espaces comptent ici.
      const person = async () => {
        const handle = `x_${hex(3)}`
        const id = randomUUID()
        await sql`insert into platform.members (org_id, user_id, email, profile) values (${org.id}, ${id}, ${`test-${hex(6)}@example.invalid`}, ${sql.json({ handle })})`
        return { id, handle, space: await fx.nodeId(org.id, `private/${handle}`) }
      }
      const mover = await person()
      const ceder = await person()
      const segment = `dossier_${hex(3)}`
      const folder = await fx.createNode(org.id, { parentId: tree.root, path: segment, ownerKind: "team", ownerTeamId: team.id })
      const note = await fx.createNode(org.id, { parentId: folder, path: `${segment}/note` })
      const prive = await fx.createNode(org.id, { parentId: ceder.space, path: `private/${ceder.handle}/prive` })

      const moved = await forgetDuring(
        sql,
        mover.id,
        (tx) => tx`select id from platform.nodes where id = ${mover.space} for update`,
        (tx) => tx`update platform.nodes set parent_id = ${mover.space}, path = ${`private/${mover.handle}/${segment}`} where id = ${folder}`,
      )
      const ceded = await forgetDuring(sql, ceder.id, (tx) => tx`update platform.nodes set owner_kind = 'team', owner_team_id = ${team.id}, owner_user_id = null where id = ${prive}`)

      expect({ moved, ceded }).toEqual({ moved: "23503", ceded: "23503" })
      const [kept] = await sql`select
          (select count(*)::int from platform.nodes where id in (${folder}, ${note}) and path like ${`private/${mover.handle}/%`}) as moved,
          (select count(*)::int from platform.nodes where id = ${prive} and owner_kind = 'team') as ceded,
          (select count(*)::int from platform.members where org_id = ${org.id} and user_id in (${mover.id}, ${ceder.id})) as refused`
      expect(kept).toEqual({ moved: 2, ceded: 1, refused: 2 })
    })

    it("should move updated_at on the six dated tables through set_updated_at, moddatetime found nowhere (AC7)", async () => {
      const org = await fx.createOrg()
      const tree = await fx.createTree(org.id)
      const account = await fx.createAccount(org.id, { ownerKind: "org", label: `compte-${hex(3)}` })
      const node = await fx.createNode(org.id, { parentId: tree.root, path: `page_${hex(3)}` })
      const [block] = await fx.draftBlocks(node, [{ type: "paragraph", text: "Avant." }])
      await fx.addActivation(org.id)
      const stamps = async () => {
        const [row] = await sql`select
            (select updated_at from platform.orgs where id = ${org.id}) as orgs,
            (select updated_at from platform.accounts where id = ${account}) as accounts,
            (select updated_at from platform.nodes where id = ${node}) as nodes,
            (select updated_at from platform.node_drafts where node_id = ${node}) as node_drafts,
            (select updated_at from platform.blocks where id = ${block} and state = 'draft') as blocks,
            (select updated_at from platform.connector_activations where org_id = ${org.id}) as connector_activations`
        return row
      }
      const before = await stamps()

      await Promise.all([
        sql`update platform.orgs set name = ${`test_${hex(3)}`} where id = ${org.id}`,
        sql`update platform.accounts set label = ${`compte-${hex(4)}`} where id = ${account}`,
        sql`update platform.nodes set title = 'Après' where id = ${node}`,
        sql`update platform.node_drafts set title = 'Après' where node_id = ${node}`,
        sql`update platform.blocks set text = 'Après.' where id = ${block} and state = 'draft'`,
        sql`update platform.connector_activations set state = 'inactive' where org_id = ${org.id}`,
      ])

      const after = await stamps()
      expect(Object.keys(after).filter((table) => !(after[table] > before[table]))).toEqual([])
      const triggers = await sql`select c.relname as tbl, p.proname
                                   from pg_catalog.pg_trigger t
                                   join pg_catalog.pg_class c on c.oid = t.tgrelid
                                   join pg_catalog.pg_proc p on p.oid = t.tgfoid
                                  where c.relnamespace = 'platform'::regnamespace and (t.tgname = 'set_updated_at' or p.proname = 'moddatetime')
                                  order by 1`
      expect(plain(triggers)).toEqual(Object.keys(after).sort().map((tbl) => ({ tbl, proname: "set_updated_at" })))
      const [{ sources }] = await sql`select count(*)::int as sources from pg_catalog.pg_proc
                                       where pronamespace = 'platform'::regnamespace and prosrc ~ 'moddatetime'`
      expect(sources).toBe(0)
    })
  },
)
