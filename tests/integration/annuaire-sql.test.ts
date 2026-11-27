// @vitest-environment node
// L'annuaire du paquet dans `members` (tâche M08, fiche D27 ; ADR-012 § 1) : l'email, le nom et la date de
// dernière connexion de la personne sont copiés dans `members` par l'outillage qui l'inscrit et à chaque
// retour de connexion (`accept_invitations`, depuis la session : E01-S09), `member_directory` les lit là,
// et personne ne les écrit sous sa session. Reçu de M13 : `members_tree_sync` quand `private/<handle>` est
// l'ancien chemin d'un autre nœud (H58, M02). La connexion d'administration pose les données et relit
// l'état ; chaque personne agit sous sa session (`fx.as`). Suite portable depuis E01-S10 f2 (plus de
// PostgREST ni de Supabase Auth) : le job `bare-postgres` la joue.
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { PlatformDb } from "../../packages/plateforme/server/db"
import type { Tx } from "../../packages/plateforme/server/sql"
import { hex, type TestOrg } from "../helpers/plateforme"
import { createSqlFixtures, SQL_SKIP_REASON, sqlConfigured, type SqlFixtures, type SqlUser } from "../helpers/sql"
import { privateFolderPending, privateFolderSuite } from "../helpers/pending-migrations"

// Ces tests supposent le dossier `private` en base (fiche D107) : sautés, la version nommée, tant que
// 20260928120000 n'est pas appliquée au projet (`database-patterns.md § Règles`).
const privatePending = await privateFolderPending()

const NETWORK_TIMEOUT = 60_000
const SETUP_TIMEOUT = 180_000
const SUITE = "members directory in members (M08)"

describe.skipIf(!sqlConfigured)(sqlConfigured ? SUITE : `${SUITE} (${SQL_SKIP_REASON})`, { timeout: NETWORK_TIMEOUT }, () => {
  let fx: SqlFixtures
  let org: TestOrg
  let ada: SqlUser
  let asAda: PlatformDb

  /** La copie du compte dans la ligne `members` de la personne, relue par la connexion d'administration. */
  const copyOf = async (orgId: string, userId: string) =>
    (await fx.admin`select email, name, last_sign_in_at from platform.members where org_id = ${orgId} and user_id = ${userId}`)[0]

  /** La ligne de l'annuaire d'une personne, lue sous la session d'Ada, membre de l'organisation. */
  async function directoryEntry(userId: string) {
    const rows = await asAda.tx((sql) => sql`select * from platform.member_directory(${org.id})`)
    return rows.find((row) => row.user_id === userId)
  }

  beforeAll(async () => {
    fx = createSqlFixtures()
    org = await fx.createOrg()
    ada = await fx.createUser({ fullName: "Ada Martin" })
    await fx.addMember(org.id, ada.id, { role: "admin", profile: { name: "Ada Martin" } })
    asAda = fx.as(ada)
  }, SETUP_TIMEOUT)

  afterAll(async () => {
    await fx?.cleanup()
  }, SETUP_TIMEOUT)

  // E01-S09 (AC15) : l'outillage passe l'email et le nom du compte ; la base ne les lit plus dans
  // `auth.users`. Aucune connexion encore : pas de date.
  it("should serve in the directory the email and account name the tooling gives a member", async () => {
    const nina = await fx.createUser({ fullName: "Nina Annuaire" })

    await fx.addMember(org.id, nina.id)

    expect(await copyOf(org.id, nina.id)).toEqual({ email: nina.email, name: "Nina Annuaire", last_sign_in_at: null })
    // Sans nom de fiche, l'annuaire nomme la personne par le nom de son compte.
    expect(await directoryEntry(nina.id)).toEqual({
      user_id: nina.id,
      email: nina.email,
      name: "Nina Annuaire",
      role: "member",
      default_team_id: null,
      last_sign_in_at: null,
    })
  })

  it("should serve the copy of members, not the account, and copy the session at acceptance and again at each sign-in, in every organisation", async () => {
    const paul = await fx.createUser({ fullName: "Paul Copie" })
    const other = await fx.createOrg()
    const joined = await fx.createOrg()
    await fx.addMember(org.id, paul.id)
    await fx.addMember(other.id, paul.id)
    await fx.admin`insert into platform.invitations (org_id, email, role) values (${joined.id}, ${paul.email}, 'member')`
    const stale = { email: `ancienne-${hex(4)}@example.invalid`, name: "Ancien Nom", last_sign_in_at: null }
    await fx.admin`update platform.members set ${fx.admin(stale)} where user_id = ${paul.id}`

    expect(await directoryEntry(paul.id)).toMatchObject(stale)

    // Le retour de connexion de l'hôte appelle `accept_invitations` (`acceptPendingInvitations`) :
    // l'invitation de `joined` y est acceptée, les deux autres appartenances y sont remises à jour.
    const [accepted] = await fx.as(paul).tx((sql) => sql<{ joined: unknown }[]>`select platform.accept_invitations() as joined`)
    expect(accepted.joined).toEqual([{ org_id: joined.id, slug: joined.slug, name: joined.name, role: "member" }])

    // E01-S09 : l'email et le nom viennent de la session (claims `email`, nom), la date est celle de
    // l'acceptation, la même dans chaque organisation.
    const copies = await fx.admin<{ org_id: string; email: string; name: string; last_sign_in_at: Date | null }[]>`
      select org_id, email, name, last_sign_in_at from platform.members where user_id = ${paul.id}`
    const signedIn = copies[0].last_sign_in_at
    expect(signedIn).toEqual(expect.any(Date))
    expect([...copies].sort((a, b) => a.org_id.localeCompare(b.org_id))).toEqual(
      [org.id, other.id, joined.id].sort().map((orgId) => ({ org_id: orgId, email: paul.email, name: "Paul Copie", last_sign_in_at: signedIn })),
    )
    expect(await directoryEntry(paul.id)).toMatchObject({ email: paul.email, name: "Paul Copie", last_sign_in_at: signedIn })
  })

  it("should refuse anyone writing the email, name or last sign-in of a member under their session, their own included (42501)", async () => {
    const lea = await fx.createUser()
    await fx.addMember(org.id, lea.id)
    const asLea = fx.as(lea)
    const forged = `forge-${hex(4)}@example.invalid`
    const writes: (readonly [string, (sql: Tx) => Promise<unknown>])[] = [
      ["another member's email", (sql) => sql`update platform.members set email = ${forged} where org_id = ${org.id} and user_id = ${ada.id}`],
      ["another member's name", (sql) => sql`update platform.members set name = 'Forgé' where org_id = ${org.id} and user_id = ${ada.id}`],
      ["one's own last sign-in", (sql) => sql`update platform.members set last_sign_in_at = now() where org_id = ${org.id} and user_id = ${lea.id}`],
      ["a membership carrying an email", (sql) => sql`insert into platform.members (org_id, user_id, email) values (${org.id}, ${ada.id}, ${forged})`],
    ]

    const codes: [string, string | undefined][] = []
    for (const [label, write] of writes) {
      codes.push([label, await asLea.tx(write).then(() => undefined, (error: { code?: string }) => error.code)])
    }

    expect(codes).toEqual(writes.map(([label]) => [label, "42501"]))
    expect(await copyOf(org.id, ada.id)).toMatchObject({ email: ada.email, name: "Ada Martin" })
  })

  // Revue de M02 (BASSE, passée à M08 par M13) : `nodes_aliases_sync` refuse un nœud nouveau sur
  // l'ancien chemin d'un autre nœud (23505, H58), et l'insertion du membre échouait avec lui. Deux
  // personnes au même handle entrent en même temps : l'index unique des handles fait attendre la
  // seconde, qui choisit après la première (database-patterns.md § Transactions).
  it.skipIf(privatePending)(privateFolderSuite("should give a member whose private/<handle> is the former path of another node the first free <handle>_<n>, with its space", privatePending), async () => {
    const n = await fx.createOrg()
    const tree = await fx.createTree(n.id)
    const handle = `h_${hex(3)}`
    const archives = await fx.createNode(n.id, { parentId: tree.root, path: `archives_${hex(3)}`, title: "Archives" })
    await fx.admin`insert into platform.node_aliases (org_id, old_path, node_id) values (${n.id}, ${`private/${handle}`}, ${archives})`
    // `<handle>_2` est le handle d'un autre membre (H61) : les premiers libres sont `<handle>_3`, `<handle>_4`.
    const namesake = await fx.createUser()
    await fx.addMember(n.id, namesake.id, { profile: { handle: `${handle}_2` } })
    const people = [await fx.createUser(), await fx.createUser()]

    await Promise.all(people.map((person) => fx.addMember(n.id, person.id, { profile: { handle } })))

    const members = await fx.admin<{ user_id: string; handle: string }[]>`
      select user_id, profile ->> 'handle' as handle from platform.members where org_id = ${n.id} and user_id in ${fx.admin(people.map((person) => person.id))}`
    expect(members.map((row) => row.handle).sort()).toEqual([`${handle}_3`, `${handle}_4`])
    const ownerOf = (suffix: number) => members.find((row) => row.handle === `${handle}_${suffix}`)?.user_id
    const spaces = await fx.admin<{ path: string }[]>`
      select path, kind, owner_user_id from platform.nodes where org_id = ${n.id} and path like ${`private/${handle}%`}`
    expect([...spaces].sort((a, b) => (a.path < b.path ? -1 : 1))).toEqual([
      { path: `private/${handle}_2`, kind: "page", owner_user_id: namesake.id },
      { path: `private/${handle}_2/contexte`, kind: "context", owner_user_id: namesake.id },
      { path: `private/${handle}_3`, kind: "page", owner_user_id: ownerOf(3) },
      { path: `private/${handle}_3/contexte`, kind: "context", owner_user_id: ownerOf(3) },
      { path: `private/${handle}_4`, kind: "page", owner_user_id: ownerOf(4) },
      { path: `private/${handle}_4/contexte`, kind: "context", owner_user_id: ownerOf(4) },
    ])
    const alias = await fx.admin`select node_id from platform.node_aliases where org_id = ${n.id} and old_path = ${`private/${handle}`}`
    expect(alias).toEqual([{ node_id: archives }])
  })
})
