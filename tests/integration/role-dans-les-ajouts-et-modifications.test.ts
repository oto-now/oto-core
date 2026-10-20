// @vitest-environment node
// Le rôle exigé dans les policies d'ajout et de modification (migration `20261020190000`, décision d'Alexis du 20/10 ;
// suite de `role-dans-les-policies.test.ts`, qui joue les suppressions) : avec son seul jeton, en SQL direct, un membre
// simple n'accorde pas d'accès plateforme, n'ajoute ni ne promeut un membre, n'invite pas, ne révoque pas l'invitation
// d'un autre, ne crée ni ne renomme une équipe, n'y entre pas, ne rattache pas d'adresse, ne pose pas de règle sur un
// nœud qu'il ne gère pas, ne crée pas le compte d'un autre, n'active pas de connecteur et ne traite pas un retour ; sous
// sa session comme sous celle du serveur, qui juge la même personne. L'ayant droit du service passe, et la donnée est
// relue par la connexion d'administration. Un `using` qui écarte la ligne la cache : zéro ligne touchée ; un `with
// check` refusé lève 42501 (une insertion n'a que lui).
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { pendingMigrations, pendingReason } from "../helpers/pending-migrations"
import { asCaller, failureOf, seedWithAdmin, SQL_SKIP_REASON, sqlConfigured, type SeededData, type SeededOrg, type SeededPerson } from "../helpers/sql"
import type { Tx } from "../../packages/plateforme/server/sql"

const VERSION = "20261020190000"
const pending = (await pendingMigrations()).includes(VERSION)

const suite = !sqlConfigured
  ? `the role required by the insert and update policies (${SQL_SKIP_REASON})`
  : pending
    ? `the role required by the insert and update policies (${pendingReason([VERSION])})`
    : "the role required by the insert and update policies: a plain member is refused, whoever the service lets in passes"

/** Les deux sessions d'une personne : la sienne, et celle du serveur, aux mêmes claims. */
const SESSIONS = [undefined, "server"] as const

const tag = () => Math.random().toString(16).slice(2, 8)

describe.skipIf(!sqlConfigured || pending)(suite, () => {
  let seed: SeededData
  let org: SeededOrg
  let other: SeededOrg
  /** Administratrice de O, membre simple de P. */
  let ada: SeededPerson
  /** Membre simple de O. */
  let lea: SeededPerson
  /** Membre de O, responsable de l'équipe `led`. */
  let paul: SeededPerson
  /** Membre simple de O, membre de l'équipe `led`. */
  let marc: SeededPerson
  /** Équipe plateforme, accès en cours à O, sans en être membre. */
  let sam: SeededPerson
  /** Équipe plateforme et membre simple de O, sans accès en cours. */
  let rita: SeededPerson
  let led: string
  let unled: string
  let root: string

  /**
   * Le résultat d'une écriture sous la session de `who` (la sienne, ou celle du serveur) : le nombre de lignes rendues,
   * `42501` pour le refus d'une policy, ou le code et le message de toute autre erreur (un droit de colonne refusé lève
   * aussi 42501, mais ne dit rien de la policy).
   */
  async function attempt(who: SeededPerson, query: (sql: Tx) => PromiseLike<unknown[]>, session?: "server"): Promise<number | string> {
    let rows = 0
    const failure = await failureOf(asCaller(who.id, who.email).tx(async (sql) => (rows = (await query(sql)).length), session))
    if (!failure) return rows
    return failure.code === "42501" && /row-level security/.test(failure.message) ? failure.code : `${failure.code} ${failure.message}`
  }

  async function team(orgId = org.id): Promise<string> {
    const [row] = await seed.admin<{ id: string }[]>`
      insert into platform.teams (org_id, slug, name) values (${orgId}, ${`e${tag()}`}, ${`Équipe ${tag()}`}) returning id`
    return row.id
  }

  async function inTeam(teamId: string, person: SeededPerson, role: "lead" | "member"): Promise<void> {
    await seed.admin`insert into platform.team_members (team_id, user_id, role) values (${teamId}, ${person.id}, ${role})`
  }

  async function staff(): Promise<SeededPerson> {
    const person = seed.person()
    await seed.admin`insert into platform.platform_staff (user_id, email) values (${person.id}, ${person.email})`
    return person
  }

  /** Une page sous la racine, de l'organisation (propriétaire hérité) ou d'une équipe. */
  async function page(teamId?: string): Promise<string> {
    const [row] = await seed.admin<{ id: string }[]>`
      insert into platform.nodes (org_id, parent_id, path, title, summary, owner_kind, owner_team_id)
      values (${org.id}, ${root}, ${`p${tag()}`}, 'Page', 'Une page.', ${teamId ? "team" : null}, ${teamId ?? null}) returning id`
    return row.id
  }

  async function account(): Promise<string> {
    const [row] = await seed.admin<{ id: string }[]>`
      insert into platform.accounts (org_id, connector, owner_kind, label, mode) values (${org.id}, 'mail', 'org', ${`compte ${tag()}`}, 'simule') returning id`
    return row.id
  }

  beforeAll(async () => {
    seed = seedWithAdmin()
    org = await seed.createOrg()
    other = await seed.createOrg()
    ;[ada, lea, paul, marc] = [seed.person(), seed.person(), seed.person(), seed.person()]
    await seed.addMember(org.id, ada, "admin")
    await seed.addMember(other.id, ada)
    for (const person of [lea, paul, marc]) await seed.addMember(org.id, person)
    sam = await staff()
    await seed.admin`insert into platform.platform_grants (org_id, user_id, granted_by) values (${org.id}, ${sam.id}, ${sam.id})`
    rita = await staff()
    await seed.addMember(org.id, rita)
    led = await team()
    unled = await team()
    await inTeam(led, paul, "lead")
    await inTeam(led, marc, "member")
    const [row] = await seed.admin<{ id: string }[]>`
      insert into platform.nodes (org_id, parent_id, path, title, summary, owner_kind)
      values (${org.id}, null, 'guide', 'Guide', 'Racine.', 'org') returning id`
    root = row.id
  })

  afterAll(async () => {
    await seed?.cleanup()
  })

  it.each(SESSIONS)("should refuse a platform access granted by a plain member or an administrator outside the platform team, and let the platform team that administers (session %s)", async (session) => {
    const grant = (by: SeededPerson, to: SeededPerson) => (sql: Tx) =>
      sql`insert into platform.platform_grants (org_id, user_id, granted_by) values (${org.id}, ${to.id}, ${by.id}) returning id`
    const colleague = await staff()
    expect(await attempt(lea, grant(lea, colleague), session)).toBe("42501")
    expect(await attempt(ada, grant(ada, colleague), session)).toBe("42501")
    expect(await attempt(rita, grant(rita, colleague), session)).toBe("42501")
    expect(await seed.admin`select 1 from platform.platform_grants where org_id = ${org.id} and user_id = ${colleague.id}`).toHaveLength(0)
    expect(await attempt(sam, grant(sam, colleague), session)).toBe(1)
    expect(await seed.admin`select granted_by from platform.platform_grants where org_id = ${org.id} and user_id = ${colleague.id}`).toEqual([{ granted_by: sam.id }])
  })

  it.each(SESSIONS)("should refuse a plain member revoking a platform access, and let an administrator or the platform team (session %s)", async (session) => {
    const open = async () => {
      const colleague = await staff()
      const [row] = await seed.admin<{ id: string }[]>`
        insert into platform.platform_grants (org_id, user_id, granted_by) values (${org.id}, ${colleague.id}, ${sam.id}) returning id`
      return row.id
    }
    const revoke = (id: string, by: SeededPerson) => (sql: Tx) =>
      sql`update platform.platform_grants set revoked_at = now(), revoked_by = ${by.id} where id = ${id} and revoked_at is null returning id`
    const first = await open()
    expect(await attempt(lea, revoke(first, lea), session)).toBe(0)
    expect(await seed.admin`select revoked_at from platform.platform_grants where id = ${first}`).toEqual([{ revoked_at: null }])
    expect(await attempt(ada, revoke(first, ada), session)).toBe(1)
    const second = await open()
    expect(await attempt(rita, revoke(second, rita), session)).toBe(1)
    expect(await seed.admin`select revoked_by from platform.platform_grants where id in ${seed.admin([first, second])} order by revoked_by = ${ada.id} desc`).toEqual([
      { revoked_by: ada.id },
      { revoked_by: rita.id },
    ])
  })

  it.each(SESSIONS)("should refuse a plain member adding a member, and let an administrator (session %s)", async (session) => {
    const add = (person: SeededPerson) => (sql: Tx) =>
      sql`insert into platform.members (org_id, user_id, role) values (${org.id}, ${person.id}, 'admin') returning user_id`
    const [stranger, newcomer] = [seed.person(), seed.person()]
    expect(await attempt(lea, add(stranger), session)).toBe("42501")
    expect(await seed.admin`select 1 from platform.members where org_id = ${org.id} and user_id = ${stranger.id}`).toHaveLength(0)
    expect(await attempt(ada, add(newcomer), session)).toBe(1)
    expect(await seed.admin`select role from platform.members where org_id = ${org.id} and user_id = ${newcomer.id}`).toEqual([{ role: "admin" }])
  })

  it.each(SESSIONS)("should refuse a plain member changing a role, hers included, an administrator moving a member out of her organisations, and let an administrator change a role (session %s)", async (session) => {
    const promote = (person: SeededPerson, role: "admin" | "member") => (sql: Tx) =>
      sql`update platform.members set role = ${role} where org_id = ${org.id} and user_id = ${person.id} returning user_id`
    expect(await attempt(lea, promote(marc, "admin"), session)).toBe(0)
    expect(await attempt(lea, promote(lea, "admin"), session)).toBe(0)
    expect(await seed.admin`select role from platform.members where org_id = ${org.id} and user_id in ${seed.admin([marc.id, lea.id])}`).toEqual([
      { role: "member" },
      { role: "member" },
    ])
    // Ada administre O et n'est que membre de P : une ligne de O n'y passe pas.
    const move = (sql: Tx) => sql`update platform.members set org_id = ${other.id} where org_id = ${org.id} and user_id = ${marc.id} returning user_id`
    expect(await attempt(ada, move, session)).toBe("42501")
    expect(await attempt(ada, promote(marc, "admin"), session)).toBe(1)
    expect(await seed.admin`select role from platform.members where org_id = ${org.id} and user_id = ${marc.id}`).toEqual([{ role: "admin" }])
    await seed.admin`update platform.members set role = 'member' where org_id = ${org.id} and user_id = ${marc.id}`
  })

  it.each(SESSIONS)("should refuse an invitation by a plain member, or by a lead outside a team she leads or as an administrator, and let a lead and an administrator (session %s)", async (session) => {
    const invite = (by: SeededPerson, role: "admin" | "member", teamId: string | null) => {
      const email = `test-${tag()}@example.invalid`
      return (sql: Tx) =>
        sql`insert into platform.invitations (org_id, email, role, team_id, invited_by) values (${org.id}, ${email}, ${role}, ${teamId}, ${by.id}) returning id`
    }
    expect(await attempt(lea, invite(lea, "member", null), session)).toBe("42501")
    expect(await attempt(lea, invite(lea, "member", led), session)).toBe("42501")
    expect(await attempt(paul, invite(paul, "member", null), session)).toBe("42501")
    expect(await attempt(paul, invite(paul, "member", unled), session)).toBe("42501")
    expect(await attempt(paul, invite(paul, "admin", led), session)).toBe("42501")
    expect(await seed.admin`select 1 from platform.invitations where org_id = ${org.id} and invited_by in ${seed.admin([lea.id, paul.id])}`).toHaveLength(0)
    expect(await attempt(paul, invite(paul, "member", led), session)).toBe(1)
    expect(await attempt(ada, invite(ada, "admin", null), session)).toBe(1)
    expect(await attempt(sam, invite(sam, "admin", null), session)).toBe(1)
    expect(await seed.admin`select role, team_id from platform.invitations where org_id = ${org.id} and invited_by = ${paul.id}`).toEqual([{ role: "member", team_id: led }])
    await seed.admin`delete from platform.invitations where org_id = ${org.id}`
  })

  it.each(SESSIONS)("should refuse a plain member or a lead revoking another's invitation, and let its sender and an administrator (session %s)", async (session) => {
    const pending = async (by: SeededPerson) => {
      const [row] = await seed.admin<{ id: string }[]>`
        insert into platform.invitations (org_id, email, role, invited_by) values (${org.id}, ${`test-${tag()}@example.invalid`}, 'member', ${by.id}) returning id`
      return row.id
    }
    const revoke = (id: string) => (sql: Tx) => sql`update platform.invitations set revoked_at = now() where id = ${id} returning id`
    const byAda = await pending(ada)
    expect(await attempt(lea, revoke(byAda), session)).toBe(0)
    expect(await attempt(paul, revoke(byAda), session)).toBe(0)
    expect(await seed.admin`select revoked_at from platform.invitations where id = ${byAda}`).toEqual([{ revoked_at: null }])
    // Léa a invité quand elle dirigeait une équipe : l'émettrice révoque son invitation.
    const byLea = await pending(lea)
    expect(await attempt(lea, revoke(byLea), session)).toBe(1)
    expect(await attempt(ada, revoke(byAda), session)).toBe(1)
    expect(await seed.admin`select count(*)::int as revoked from platform.invitations where id in ${seed.admin([byAda, byLea])} and revoked_at is not null`).toEqual([{ revoked: 2 }])
    await seed.admin`delete from platform.invitations where org_id = ${org.id}`
  })

  it.each(SESSIONS)("should refuse a plain member or a lead creating a team, and let an administrator (session %s)", async (session) => {
    const create = (name: string) => (sql: Tx) => sql`insert into platform.teams (org_id, slug, name) values (${org.id}, ${name}, ${name}) returning id`
    const [refused, created] = [`e${tag()}`, `e${tag()}`]
    expect(await attempt(lea, create(refused), session)).toBe("42501")
    expect(await attempt(paul, create(refused), session)).toBe("42501")
    expect(await seed.admin`select 1 from platform.teams where org_id = ${org.id} and slug = ${refused}`).toHaveLength(0)
    expect(await attempt(ada, create(created), session)).toBe(1)
    expect(await seed.admin`select name from platform.teams where org_id = ${org.id} and slug = ${created}`).toEqual([{ name: created }])
  })

  it.each(SESSIONS)("should refuse a plain member or a lead renaming a team or naming its lead, and let an administrator (session %s)", async (session) => {
    const id = await team()
    await inTeam(id, paul, "lead")
    const rename = (name: string) => (sql: Tx) => sql`update platform.teams set name = ${name} where id = ${id} returning id`
    const lead = (person: SeededPerson) => (sql: Tx) => sql`update platform.teams set lead_user_id = ${person.id} where id = ${id} returning id`
    expect(await attempt(lea, rename("Léa"), session)).toBe(0)
    expect(await attempt(paul, rename("Paul"), session)).toBe(0)
    // Nommée responsable par `teams_lead_sync`, Léa composerait l'équipe.
    expect(await attempt(lea, lead(lea), session)).toBe(0)
    expect(await seed.admin`select 1 from platform.team_members where team_id = ${id} and user_id = ${lea.id}`).toHaveLength(0)
    const renamed = `Ada ${tag()}`
    expect(await attempt(ada, rename(renamed), session)).toBe(1)
    expect(await attempt(ada, lead(marc), session)).toBe(1)
    expect(await seed.admin`select t.name, tm.role from platform.teams t join platform.team_members tm on tm.team_id = t.id and tm.user_id = ${marc.id} where t.id = ${id}`).toEqual([
      { name: renamed, role: "lead" },
    ])
  })

  it.each(SESSIONS)("should let a lead add only a member to her team, an administrator a lead, and refuse a plain member (session %s)", async (session) => {
    const id = await team()
    await inTeam(id, paul, "lead")
    const add = (teamId: string, person: SeededPerson, role: "lead" | "member") => (sql: Tx) =>
      sql`insert into platform.team_members (team_id, user_id, role) values (${teamId}, ${person.id}, ${role}) returning user_id`
    expect(await attempt(lea, add(id, marc, "member"), session)).toBe("42501")
    expect(await attempt(lea, add(id, lea, "lead"), session)).toBe("42501")
    expect(await attempt(paul, add(id, marc, "lead"), session)).toBe("42501")
    expect(await attempt(paul, add(unled, marc, "member"), session)).toBe("42501")
    expect(await seed.admin`select 1 from platform.team_members where team_id = ${id} and user_id in ${seed.admin([lea.id, marc.id])}`).toHaveLength(0)
    expect(await attempt(paul, add(id, marc, "member"), session)).toBe(1)
    expect(await attempt(ada, add(id, lea, "lead"), session)).toBe(1)
    expect(await seed.admin`select user_id, role from platform.team_members where team_id = ${id} and user_id in ${seed.admin([lea.id, marc.id])} order by role`).toEqual([
      { user_id: lea.id, role: "lead" },
      { user_id: marc.id, role: "member" },
    ])
  })

  it.each(SESSIONS)("should refuse a plain member or a lead changing a role in a team, and let an administrator (session %s)", async (session) => {
    const id = await team()
    await inTeam(id, paul, "lead")
    await inTeam(id, lea, "member")
    await inTeam(id, marc, "member")
    const role = (person: SeededPerson) => (sql: Tx) => sql`update platform.team_members set role = 'lead' where team_id = ${id} and user_id = ${person.id} returning user_id`
    expect(await attempt(lea, role(lea), session)).toBe(0)
    expect(await attempt(paul, role(marc), session)).toBe(0)
    expect(await seed.admin`select role from platform.team_members where team_id = ${id} and user_id in ${seed.admin([lea.id, marc.id])}`).toEqual([
      { role: "member" },
      { role: "member" },
    ])
    expect(await attempt(ada, role(marc), session)).toBe(1)
    expect(await seed.admin`select role from platform.team_members where team_id = ${id} and user_id = ${marc.id}`).toEqual([{ role: "lead" }])
  })

  it.each(SESSIONS)("should refuse a plain member or an administrator outside the platform team adding an address, and let the platform team (session %s)", async (session) => {
    const add = (host: string) => (sql: Tx) => sql`insert into platform.org_domains (host, org_id) values (${host}, ${org.id}) returning host`
    const [refused, added] = [`h${tag()}.example.invalid`, `h${tag()}.example.invalid`]
    expect(await attempt(lea, add(refused), session)).toBe("42501")
    expect(await attempt(ada, add(refused), session)).toBe("42501")
    expect(await seed.admin`select 1 from platform.org_domains where host = ${refused}`).toHaveLength(0)
    expect(await attempt(sam, add(added), session)).toBe(1)
    expect(await seed.admin`select org_id from platform.org_domains where host = ${added}`).toEqual([{ org_id: org.id }])
  })

  it.each(SESSIONS)("should refuse a rule on a node by whoever does not manage it, and manage to anyone but an administrator (session %s)", async (session) => {
    const [orgPage, teamPage, sharedPage] = [await page(), await page(led), await page()]
    // Léa gère `sharedPage` par une règle nominative : elle y partage, sans pouvoir donner la gestion.
    await seed.admin`insert into platform.access_rules (org_id, node_id, subject_user_id, level, created_by) values (${org.id}, ${sharedPage}, ${lea.id}, 'manage', ${ada.id})`
    const rule = (by: SeededPerson, node: string, level: string) => (sql: Tx) =>
      sql`insert into platform.access_rules (org_id, node_id, subject_user_id, level, created_by) values (${org.id}, ${node}, ${marc.id}, ${level}, ${by.id}) returning id`
    expect(await attempt(lea, rule(lea, orgPage, "read"), session)).toBe("42501")
    expect(await attempt(lea, rule(lea, teamPage, "read"), session)).toBe("42501")
    expect(await attempt(paul, rule(paul, orgPage, "read"), session)).toBe("42501")
    expect(await attempt(paul, rule(paul, teamPage, "manage"), session)).toBe("42501")
    expect(await attempt(lea, rule(lea, sharedPage, "manage"), session)).toBe("42501")
    expect(await seed.admin`select 1 from platform.access_rules where subject_user_id = ${marc.id} and node_id in ${seed.admin([orgPage, teamPage, sharedPage])}`).toHaveLength(0)
    expect(await attempt(paul, rule(paul, teamPage, "write"), session)).toBe(1)
    expect(await attempt(lea, rule(lea, sharedPage, "read"), session)).toBe(1)
    expect(await attempt(ada, rule(ada, orgPage, "manage"), session)).toBe(1)
    expect(await seed.admin`select node_id, level from platform.access_rules where subject_user_id = ${marc.id} and node_id in ${seed.admin([orgPage, teamPage, sharedPage])} order by level`).toEqual(
      [
        { node_id: orgPage, level: "manage" },
        { node_id: sharedPage, level: "read" },
        { node_id: teamPage, level: "write" },
      ],
    )
  })

  it.each(SESSIONS)("should refuse a plain member changing or removing a rule of a node she does not manage, and a lead raising one to manage, and let an administrator (session %s)", async (session) => {
    const [orgPage, teamPage] = [await page(), await page(led)]
    const seeded = async (node: string) => {
      const [row] = await seed.admin<{ id: string }[]>`
        insert into platform.access_rules (org_id, node_id, subject_user_id, level, created_by) values (${org.id}, ${node}, ${marc.id}, 'read', ${ada.id}) returning id`
      return row.id
    }
    const [onOrg, onTeam] = [await seeded(orgPage), await seeded(teamPage)]
    const level = (id: string, value: string) => (sql: Tx) => sql`update platform.access_rules set level = ${value} where id = ${id} returning id`
    const remove = (id: string) => (sql: Tx) => sql`delete from platform.access_rules where id = ${id} returning id`
    expect(await attempt(lea, level(onOrg, "write"), session)).toBe(0)
    expect(await attempt(lea, remove(onOrg), session)).toBe(0)
    expect(await attempt(paul, level(onTeam, "manage"), session)).toBe("42501")
    expect(await seed.admin`select level from platform.access_rules where id in ${seed.admin([onOrg, onTeam])}`).toEqual([{ level: "read" }, { level: "read" }])
    expect(await attempt(paul, level(onTeam, "write"), session)).toBe(1)
    expect(await attempt(ada, level(onOrg, "manage"), session)).toBe(1)
    expect(await seed.admin`select level from platform.access_rules where id in ${seed.admin([onOrg, onTeam])} order by level`).toEqual([{ level: "manage" }, { level: "write" }])
    expect(await attempt(paul, remove(onTeam), session)).toBe(1)
    expect(await seed.admin`select 1 from platform.access_rules where id = ${onTeam}`).toHaveLength(0)
  })

  it.each(SESSIONS)("should keep the manage level of an account rule to an administrator (session %s)", async (session) => {
    const id = await account()
    const rule = (by: SeededPerson) => (sql: Tx) =>
      sql`insert into platform.access_rules (org_id, account_id, subject_user_id, level, created_by) values (${org.id}, ${id}, ${marc.id}, 'manage', ${by.id}) returning id`
    expect(await attempt(lea, rule(lea), session)).toBe("42501")
    expect(await seed.admin`select 1 from platform.access_rules where account_id = ${id}`).toHaveLength(0)
    expect(await attempt(ada, rule(ada), session)).toBe(1)
    expect(await seed.admin`select level from platform.access_rules where account_id = ${id}`).toEqual([{ level: "manage" }])
  })

  it.each(SESSIONS)("should refuse an organisation or team account created by a plain member, or a personal account for someone else, and let an administrator, a lead and the owner (session %s)", async (session) => {
    const create = (kind: "org" | "team" | "user", owner: string | null) => {
      const label = `compte ${tag()}`
      return (sql: Tx) =>
        sql`insert into platform.accounts (org_id, connector, owner_kind, owner_team_id, owner_user_id, label, mode)
            values (${org.id}, 'mail', ${kind}, ${kind === "team" ? owner : null}, ${kind === "user" ? owner : null}, ${label}, 'simule') returning id`
    }
    const before = await seed.admin`select id from platform.accounts where org_id = ${org.id}`
    expect(await attempt(lea, create("org", null), session)).toBe("42501")
    expect(await attempt(lea, create("team", led), session)).toBe("42501")
    expect(await attempt(lea, create("user", marc.id), session)).toBe("42501")
    expect(await attempt(paul, create("team", unled), session)).toBe("42501")
    expect(await seed.admin`select id from platform.accounts where org_id = ${org.id}`).toHaveLength(before.length)
    expect(await attempt(lea, create("user", lea.id), session)).toBe(1)
    expect(await attempt(paul, create("team", led), session)).toBe(1)
    expect(await attempt(ada, create("org", null), session)).toBe(1)
    expect(await attempt(ada, create("team", unled), session)).toBe(1)
    expect(await seed.admin`select id from platform.accounts where org_id = ${org.id}`).toHaveLength(before.length + 4)
  })

  it.each(SESSIONS)("should refuse a plain member activating or deactivating a connector, and let an administrator (session %s)", async (session) => {
    await seed.admin`delete from platform.connector_activations where org_id = ${org.id}`
    const activate = (by: SeededPerson) => (sql: Tx) =>
      sql`insert into platform.connector_activations (org_id, connector, state, activated_by) values (${org.id}, 'notion', 'active', ${by.id})
          on conflict (org_id, connector) do update set state = excluded.state, activated_by = excluded.activated_by returning connector`
    const deactivate = (sql: Tx) => sql`update platform.connector_activations set state = 'inactive' where org_id = ${org.id} and connector = 'notion' returning connector`
    expect(await attempt(lea, activate(lea), session)).toBe("42501")
    expect(await seed.admin`select 1 from platform.connector_activations where org_id = ${org.id}`).toHaveLength(0)
    expect(await attempt(ada, activate(ada), session)).toBe(1)
    expect(await attempt(lea, deactivate, session)).toBe(0)
    expect(await seed.admin`select state from platform.connector_activations where org_id = ${org.id}`).toEqual([{ state: "active" }])
    expect(await attempt(ada, deactivate, session)).toBe(1)
    // Inactif, la réactivation passe par la mise à jour de l'insertion : refusée au membre simple.
    expect(await attempt(lea, activate(lea), session)).toBe("42501")
    expect(await seed.admin`select state, activated_by from platform.connector_activations where org_id = ${org.id}`).toEqual([{ state: "inactive", activated_by: ada.id }])
  })

  it.each(SESSIONS)("should refuse a plain member, and an administrator outside the platform team while « Retours visibles » is off, handling a feedback, and let the platform team or, the option on, the administrator in their own name (session %s)", async (session) => {
    const ticket = async (): Promise<string> => {
      const [row] = await seed.admin<{ id: string }[]>`
        insert into platform.feedback (org_id, user_id, type, text, number) values (${org.id}, ${lea.id}, 'gap', 'Il manque une page.', 0) returning id`
      return row.id
    }
    const handle = (id: string, by: SeededPerson) => (sql: Tx) =>
      sql`update platform.feedback set state = 'resolved', handled_by = ${by.id}, handled_at = now() where id = ${id} returning id`
    const first = await ticket()
    expect(await attempt(lea, handle(first, lea), session)).toBe(0)
    expect(await attempt(ada, handle(first, ada), session)).toBe(0)
    expect(await attempt(sam, handle(first, ada), session)).toBe("42501")
    expect(await seed.admin`select state from platform.feedback where id = ${first}`).toEqual([{ state: "open" }])
    expect(await attempt(sam, handle(first, sam), session)).toBe(1)
    expect(await seed.admin`select state, handled_by from platform.feedback where id = ${first}`).toEqual([{ state: "resolved", handled_by: sam.id }])
    // 1.4.13 : « Retours visibles » allumé (`handlesFeedback`), l'administratrice du client traite en son nom ; le membre
    // simple, jamais.
    const second = await ticket()
    await seed.admin`update platform.orgs set flags = flags || '{"feedback_visible": true}'::jsonb where id = ${org.id}`
    try {
      expect(await attempt(lea, handle(second, lea), session)).toBe(0)
      expect(await attempt(ada, handle(second, lea), session)).toBe("42501")
      expect(await seed.admin`select state from platform.feedback where id = ${second}`).toEqual([{ state: "open" }])
      expect(await attempt(ada, handle(second, ada), session)).toBe(1)
      expect(await seed.admin`select state, handled_by from platform.feedback where id = ${second}`).toEqual([{ state: "resolved", handled_by: ada.id }])
    } finally {
      await seed.admin`update platform.orgs set flags = flags - 'feedback_visible' where id = ${org.id}`
    }
  })
})
