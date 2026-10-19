// @vitest-environment node
// Le rôle du serveur, lu sur une vraie base (garde mécanique ; `base-et-portabilite.md` § Port de base ; migration
// `20261019130000`). Une fonction SECURITY DEFINER exécutable par `authenticated` ou `anon`, ou une colonne qui leur est
// accordée en écriture, croit ce que l'appelant lui passe : sur un hôte qui exposerait `platform` (le Data API de
// Supabase), une personne l'affirmerait avec son seul jeton. Ce qui écrit un fait venu d'un tiers ou du serveur est
// réservé à `platform_server`. Les listes fermées ci-dessous font échouer toute fonction ou colonne nouvelle : la
// réserver au rôle du serveur, ou l'ajouter à sa liste en disant pourquoi elle n'écrit aucun fait affirmé.
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { pendingMigrations, pendingReason } from "../helpers/pending-migrations"
import { asCaller, seedWithAdmin, SQL_SKIP_REASON, sqlConfigured, type SeededData, type SeededOrg, type SeededPerson } from "../helpers/sql"
import { withServerSession } from "../../packages/plateforme/server/sql"

const VERSION = "20261019130000"
const pending = (await pendingMigrations()).includes(VERSION)

/**
 * Les fonctions SECURITY DEFINER de `platform` qu'`authenticated` ou `anon` exécutent, chacune avec la raison pour
 * laquelle elle n'écrit aucun fait que l'appelant affirmerait : une lecture, une écriture fondée sur les seuls claims
 * vérifiés, ou un geste que la personne décide elle-même.
 */
const CALLABLE: Record<string, string> = {
  "platform.accept_invitations()": "writes memberships from the verified email of the claims, no argument",
  "platform.account_linked_id(uuid)": "read",
  "platform.account_secret(uuid)": "read",
  "platform.account_token(uuid)": "read",
  "platform.applied_migrations()": "read",
  "platform.claim_org_admin(uuid)": "a platform team member names themselves, from the verified claims",
  "platform.consume_upload_ticket(uuid,text,boolean)": "anon: consumes the ticket whose token the caller holds, nothing affirmed",
  "platform.create_org(text,text,text,text[])": "reserved to the platform team, whose decision the arguments are",
  "platform.discard_draft(uuid,timestamp with time zone)": "the person's own gesture on a draft",
  "platform.duplicate_subtree(uuid,uuid[],text,text,double precision)":
    "the person's own copy; the descendants copied are those the service decided readable, checked inside the organisation only (access rules: lot 2)",
  "platform.hosted_linked_elsewhere(text,text[])": "read",
  "platform.identity_for_caller()": "writes the identity of the verified claims, no argument",
  "platform.invalidate_pseudonyms(uuid)": "advances a generation counter, no value affirmed",
  "platform.is_org_admin(uuid)": "read",
  "platform.is_staff()": "read",
  "platform.member_directory(uuid)": "read",
  "platform.member_orgs()": "read",
  "platform.my_hosted_accounts(text)": "read",
  "platform.node_level_for(uuid,extensions.ltree,text,uuid,uuid)": "read",
  "platform.node_owner(uuid)": "read",
  "platform.oauth_pending_resource(text)": "read",
  "platform.open_draft(uuid)": "the person's own gesture on a node",
  "platform.open_entry_admits(uuid)": "read",
  "platform.org_by_host(text)": "read (anon too)",
  "platform.org_contact(uuid)": "read",
  "platform.org_files_bytes(uuid)": "read",
  "platform.org_usage(uuid)": "read (anon)",
  "platform.platform_access_directory(uuid)": "read",
  "platform.public_file_by_token(uuid,text,uuid)": "read (anon)",
  "platform.public_node_by_token(uuid,text,text)": "read (anon)",
  "platform.publish_node(uuid,integer,jsonb)": "the person's own content",
  "platform.publish_node(uuid,integer,timestamp with time zone,jsonb)": "the person's own content",
  "platform.route_candidates(uuid,text,text,integer)": "read",
  "platform.search_content(uuid,text,text[],integer)": "read",
  "platform.staff_directory()": "read",
  "platform.update_my_profile(uuid,jsonb)": "the person's own profile",
}

/** Les fonctions qui écrivent un fait venu d'un tiers ou du serveur : exécutables par `platform_server` seul. */
const RESERVED: Record<string, string> = {
  "platform.declare_connector(text,text)": "the label the host declares",
  "platform.join_org(uuid,integer)": "the member limit read from the host",
  "platform.link_hosted_account(uuid,text,timestamp with time zone,text)": "the identifier and creation date given by the third party",
  "platform.mark_account(uuid,text)": "the refusal of the third party",
  "platform.mark_files_ready(uuid,uuid[])": "the object read in the storage",
  "platform.pseudonym_org(uuid,text,text)": "the salt and the witness of the server's key",
  "platform.purge_transit_files(uuid)": "the transit files of others, which the caller cannot see",
  "platform.signup_org(text,text,text,text[])": "the addresses given by the host",
}

/** Les colonnes de `platform` qu'`authenticated` peut modifier, par table (aucune pour `anon`) : des gestes de la personne. */
const UPDATED_BY_AUTHENTICATED: Record<string, string[]> = {
  access_rules: ["level"],
  blocks: ["position", "type", "text", "data", "key", "provenance", "revision", "claimed_by", "claimed_by_user", "lease_until", "updated_by"],
  connector_activations: ["org_id", "connector", "state", "activated_by", "created_at", "updated_at"],
  ctx: ["contexts"],
  feedback: ["state", "resolution", "handled_by", "handled_at"],
  invitations: ["revoked_at"],
  members: ["org_id", "user_id", "role", "profile", "created_at"],
  node_drafts: ["title", "summary", "kind", "meta", "updated_by"],
  node_shares: ["include_children", "created_by", "revoked_at"],
  nodes: [
    "id", "org_id", "parent_id", "path", "lpath", "kind", "title", "summary", "status", "revision", "meta", "owner_kind", "owner_team_id",
    "owner_user_id", "created_by", "updated_by", "created_at", "updated_at", "search_tsv", "position", "deleted_at",
  ],
  orgs: ["id", "slug", "name", "prefix", "brand", "settings", "flags", "rules_version", "created_at", "updated_at"],
  platform_grants: ["revoked_at", "revoked_by"],
  sim_outbox: ["status", "sent_by", "sent_at"],
  team_members: ["team_id", "user_id", "role", "created_at"],
  teams: ["name", "lead_user_id"],
}

/** Les colonnes que `platform_server` modifie en plus d'`authenticated` : l'état, le secret et les jetons d'un compte. */
const UPDATED_BY_SERVER_ONLY: Record<string, string[]> = {
  accounts: ["secret_ciphertext", "status", "settings", "secret_fields", "secret_updated_at", "token_ciphertext", "token_expires_at", "status_reason", "granted_scopes"],
}

const suite = !sqlConfigured
  ? `the server role (${SQL_SKIP_REASON})`
  : pending
    ? `the server role (${pendingReason([VERSION])})`
    : "the server role platform_server: who takes it, and what only it writes"

type Callable = { fn: string; authenticated: boolean; anon: boolean; server: boolean }
type ColumnRight = { role: string; table_name: string; column_name: string }

/** Les écarts entre ce que la base accorde et une liste fermée de colonnes, avec le geste à faire. */
function columnDrift(granted: ColumnRight[], role: string, closed: Record<string, string[]>): string[] {
  const held = new Set(granted.filter((right) => right.role === role).map((right) => `${right.table_name}.${right.column_name}`))
  const listed = new Set(Object.entries(closed).flatMap(([table, columns]) => columns.map((column) => `${table}.${column}`)))
  return [
    ...[...held].filter((column) => !listed.has(column)).map((column) => `platform.${column}: ${role} can UPDATE it, outside the closed list. If its value comes from a third party or the server, grant it to platform_server only; otherwise add it to the list of this test with the reason.`),
    ...[...listed].filter((column) => !held.has(column)).map((column) => `platform.${column}: in the closed list of ${role}, but no longer granted: remove it from the list.`),
  ].sort()
}

/** Le SQLSTATE et le message d'une promesse rejetée ; `null` si elle aboutit. */
async function failureOf(promise: Promise<unknown>): Promise<{ code: string | undefined; message: string } | null> {
  try {
    await promise
    return null
  } catch (error) {
    return { code: (error as { code?: string }).code, message: (error as Error).message }
  }
}

describe.skipIf(!sqlConfigured || pending)(suite, () => {
  let seed: SeededData
  let org: SeededOrg
  let lea: SeededPerson

  beforeAll(async () => {
    seed = seedWithAdmin()
    org = await seed.createOrg()
    lea = seed.person()
    await seed.addMember(org.id, lea)
  })

  afterAll(async () => {
    await seed?.cleanup()
  })

  it("should be nologin, inherit authenticated, be taken by platform_app only, never by PostgREST's authenticator", async () => {
    const [role] = await seed.admin<{ login: boolean; bypass: boolean; createrole: boolean; inherits: boolean; app: boolean; anon: boolean; authenticated: boolean }[]>`
      select r.rolcanlogin as login, r.rolbypassrls as bypass, r.rolcreaterole as createrole,
             pg_catalog.pg_has_role('platform_server', 'authenticated', 'USAGE') as inherits,
             pg_catalog.pg_has_role('platform_app', 'platform_server', 'MEMBER') as app,
             pg_catalog.pg_has_role('anon', 'platform_server', 'MEMBER') as anon,
             pg_catalog.pg_has_role('authenticated', 'platform_server', 'MEMBER') as authenticated
        from pg_catalog.pg_roles r where r.rolname = 'platform_server'`
    expect(role).toEqual({ login: false, bypass: false, createrole: false, inherits: true, app: true, anon: false, authenticated: false })
    const [postgrest] = await seed.admin<{ member: boolean | null }[]>`
      select case when exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticator')
                  then pg_catalog.pg_has_role('authenticator', 'platform_server', 'MEMBER') end as member`
    expect(postgrest.member ?? false).toBe(false)
  })

  describe("SECURITY DEFINER functions", () => {
    let callable: Callable[]

    beforeAll(async () => {
      callable = await seed.admin<Callable[]>`
        select p.oid::regprocedure::text as fn,
               pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated,
               pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
               pg_catalog.has_function_privilege('platform_server', p.oid, 'EXECUTE') as server
          from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'platform' and p.prosecdef`
    })

    it("should let authenticated and anon execute only the closed list: none writes a fact from a third party or the server", () => {
      const open = callable.filter((fn) => fn.authenticated || fn.anon).map((fn) => fn.fn)
      expect([
        ...open.filter((fn) => !(fn in CALLABLE)).map((fn) => `${fn}: SECURITY DEFINER, executable by authenticated or anon, outside the closed list. If it writes a value that comes from a third party or the server, revoke it from PUBLIC, anon and authenticated and grant it to platform_server; otherwise add it to CALLABLE in this test, saying why it writes no affirmed fact.`),
        ...Object.keys(CALLABLE).filter((fn) => !open.includes(fn)).map((fn) => `${fn}: in CALLABLE, but no longer a SECURITY DEFINER function executable by authenticated or anon: remove it from the list.`),
      ].sort()).toEqual([])
    })

    it("should reserve the functions that write a fact to platform_server", () => {
      const byName = new Map(callable.map((fn) => [fn.fn, fn]))
      expect(
        Object.keys(RESERVED).flatMap((name) => {
          const fn = byName.get(name)
          if (!fn) return [`${name}: reserved to platform_server in this test, but no such SECURITY DEFINER function.`]
          return [
            ...(fn.server ? [] : [`${name}: platform_server cannot execute it.`]),
            ...(fn.authenticated || fn.anon ? [`${name}: authenticated or anon can execute it, though it writes ${RESERVED[name]}.`] : []),
          ]
        }),
      ).toEqual([])
    })
  })

  it("should grant UPDATE to authenticated and anon on the closed list of columns only, and to platform_server only the state, secret and tokens of an account beyond it", async () => {
    const granted = await seed.admin<ColumnRight[]>`
      select r.role, c.relname as table_name, a.attname as column_name
        from pg_catalog.pg_class c
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
       cross join (values ('authenticated'), ('anon'), ('platform_server')) as r(role)
       where n.nspname = 'platform' and c.relkind in ('r', 'p', 'v')
         and pg_catalog.has_column_privilege(r.role, c.oid, a.attnum, 'UPDATE')`
    const beyond = granted.filter((right) => right.role === "platform_server" && !granted.some((other) => other.role === "authenticated" && other.table_name === right.table_name && other.column_name === right.column_name))
    expect([
      ...columnDrift(granted, "authenticated", UPDATED_BY_AUTHENTICATED),
      ...columnDrift(granted, "anon", {}),
      ...columnDrift(beyond.map((right) => ({ ...right, role: "server only" })), "server only", UPDATED_BY_SERVER_ONLY),
    ]).toEqual([])
  })

  it("should refuse a reserved function under the caller's session and run it under the server's, same caller", async () => {
    const db = asCaller(lea.id, lea.email)
    expect(await failureOf(db.tx((sql) => sql`select * from platform.purge_transit_files(${org.id})`))).toMatchObject({ code: "42501" })
    expect(await failureOf(db.tx((sql) => sql`select * from platform.purge_transit_files(${org.id})`, "server"))).toBeNull()
    const [seen] = await withServerSession({ userId: lea.id, email: lea.email }, (sql) => sql<{ uid: string; role: string }[]>`select auth.uid()::text as uid, current_user::text as role`)
    expect(seen).toEqual({ uid: lea.id, role: "platform_server" })
  })

  it("should refuse an expiry affirmed by the caller: the database clock sets it", async () => {
    const db = asCaller(lea.id, lea.email)
    const hash = (n: string) => n.repeat(64)
    const failure = await failureOf(db.tx((sql) => sql`
      insert into platform.upload_tickets (org_id, user_id, token_hash, form_token_hash, kind, mode, target_path, expires_at)
      values (${org.id}, ${lea.id}, ${hash("a")}, ${hash("b")}, 'md', 'create', 'notes', now() + interval '2 days')`))
    expect(failure).toEqual({ code: "42501", message: "platform.upload_tickets.expires_at is set by the database clock: now() + 15 minutes" })
  })
})
