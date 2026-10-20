// @vitest-environment node
// Le rôle exigé dans les policies d'administration (migration `20261019150000`, décision d'Alexis du 19/10) : avec son
// seul jeton, en SQL direct, un membre simple ne retire ni un membre, ni une équipe, ni un membre d'une équipe, ni une
// adresse, et ne règle pas son organisation ; sous sa session comme sous celle du serveur, qui juge la même personne.
// L'ayant droit du service passe : l'administrateur, le responsable qui retire un membre de son équipe, le membre de
// l'équipe plateforme avec un accès en cours. Une policy dont le `using` écarte la ligne la cache à la commande : zéro
// ligne touchée, jamais 42501 (seul le `with check` d'une ligne gardée lève).
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { pendingMigrations, pendingReason } from "../helpers/pending-migrations"
import { asCaller, seedWithAdmin, SQL_SKIP_REASON, sqlConfigured, type SeededData, type SeededOrg, type SeededPerson } from "../helpers/sql"
import type { Tx } from "../../packages/plateforme/server/sql"

const VERSION = "20261019150000"
const pending = (await pendingMigrations()).includes(VERSION)

const suite = !sqlConfigured
  ? `the role required by the administration policies (${SQL_SKIP_REASON})`
  : pending
    ? `the role required by the administration policies (${pendingReason([VERSION])})`
    : "the role required by the administration policies: a plain member is refused, whoever the service lets in passes"

/** Les deux sessions d'une personne : la sienne, et celle du serveur, aux mêmes claims. */
const SESSIONS = [undefined, "server"] as const

describe.skipIf(!sqlConfigured || pending)(suite, () => {
  let seed: SeededData
  let org: SeededOrg
  let ada: SeededPerson
  let lea: SeededPerson
  let paul: SeededPerson
  let marc: SeededPerson
  let sam: SeededPerson

  /** Les lignes que touche `query` sous la session de `who` (la sienne, ou celle du serveur). */
  const touched = (who: SeededPerson, query: (sql: Tx) => PromiseLike<unknown[]>, session?: "server") =>
    asCaller(who.id, who.email).tx(async (sql) => (await query(sql)).length, session)

  async function team(): Promise<string> {
    const [row] = await seed.admin<{ id: string }[]>`
      insert into platform.teams (org_id, slug, name) values (${org.id}, ${`e${Math.random().toString(16).slice(2, 8)}`}, 'Équipe') returning id`
    return row.id
  }

  async function inTeam(teamId: string, person: SeededPerson, role: "lead" | "member"): Promise<void> {
    await seed.admin`insert into platform.team_members (team_id, user_id, role) values (${teamId}, ${person.id}, ${role})`
  }

  async function host(): Promise<string> {
    const name = `h${Math.random().toString(16).slice(2, 8)}.example.invalid`
    await seed.admin`insert into platform.org_domains (host, org_id) values (${name}, ${org.id})`
    return name
  }

  beforeAll(async () => {
    seed = seedWithAdmin()
    org = await seed.createOrg()
    ;[ada, lea, paul, marc, sam] = [seed.person(), seed.person(), seed.person(), seed.person(), seed.person()]
    await seed.addMember(org.id, ada, "admin")
    for (const person of [lea, paul, marc]) await seed.addMember(org.id, person)
    // Sam, de l'équipe plateforme, administre l'organisation par un accès en cours, sans en être membre.
    await seed.admin`insert into platform.platform_staff (user_id, email) values (${sam.id}, ${sam.email})`
    await seed.admin`insert into platform.platform_grants (org_id, user_id, granted_by) values (${org.id}, ${sam.id}, ${sam.id})`
  })

  afterAll(async () => {
    await seed?.cleanup()
  })

  it.each(SESSIONS)("should refuse a plain member removing a member, herself included, and let an administrator (session %s)", async (session) => {
    const remove = (person: SeededPerson) => (sql: Tx) => sql`delete from platform.members where org_id = ${org.id} and user_id = ${person.id} returning user_id`
    expect(await touched(lea, remove(marc), session)).toBe(0)
    expect(await touched(lea, remove(lea), session)).toBe(0)
    const gone = seed.person()
    await seed.addMember(org.id, gone)
    expect(await touched(ada, remove(gone), session)).toBe(1)
  })

  it.each(SESSIONS)("should refuse a plain member or a lead deleting a team, and let an administrator (session %s)", async (session) => {
    const id = await team()
    await inTeam(id, paul, "lead")
    const remove = (sql: Tx) => sql`delete from platform.teams where id = ${id} returning id`
    expect(await touched(lea, remove, session)).toBe(0)
    expect(await touched(paul, remove, session)).toBe(0)
    expect(await touched(ada, remove, session)).toBe(1)
  })

  it.each(SESSIONS)("should let a lead remove only a member of her team, an administrator anyone, and refuse a plain member (session %s)", async (session) => {
    const id = await team()
    const other = await team()
    await inTeam(id, paul, "lead")
    await inTeam(id, ada, "lead")
    await inTeam(id, marc, "member")
    await inTeam(id, lea, "member")
    await inTeam(other, marc, "member")
    const remove = (person: SeededPerson, teamId = id) => (sql: Tx) =>
      sql`delete from platform.team_members where team_id = ${teamId} and user_id = ${person.id} returning user_id`
    // Un membre simple, de l'équipe ou non : rien, ni un autre, ni lui-même.
    expect(await touched(lea, remove(marc), session)).toBe(0)
    expect(await touched(lea, remove(lea), session)).toBe(0)
    // Le responsable : un membre de son équipe, pas d'une autre, ni un autre responsable (HN-E05S13-20).
    expect(await touched(paul, remove(marc, other), session)).toBe(0)
    expect(await touched(paul, remove(ada), session)).toBe(0)
    expect(await touched(paul, remove(marc), session)).toBe(1)
    // L'administrateur : un responsable aussi.
    expect(await touched(ada, remove(paul), session)).toBe(1)
  })

  it.each(SESSIONS)("should refuse a plain member or an administrator outside the platform team removing an address, and let the platform team (session %s)", async (session) => {
    const name = await host()
    const remove = (sql: Tx) => sql`delete from platform.org_domains where host = ${name} returning host`
    expect(await touched(lea, remove, session)).toBe(0)
    expect(await touched(ada, remove, session)).toBe(0)
    expect(await touched(sam, remove, session)).toBe(1)
  })

  it.each(SESSIONS)("should refuse a plain member setting settings.demo on her organisation, and let an administrator and the platform team (session %s)", async (session) => {
    const mark = (value: string) => (sql: Tx) =>
      sql`update platform.orgs set settings = settings || ${sql.json({ demo: value })} where id = ${org.id} returning id`
    expect(await touched(lea, mark("lea"), session)).toBe(0)
    expect(await seed.admin`select settings -> 'demo' as demo from platform.orgs where id = ${org.id}`).not.toEqual([{ demo: "lea" }])
    expect(await touched(ada, mark("ada"), session)).toBe(1)
    expect(await touched(sam, mark("sam"), session)).toBe(1)
    expect(await seed.admin`select settings ->> 'demo' as demo from platform.orgs where id = ${org.id}`).toEqual([{ demo: "sam" }])
  })
})
