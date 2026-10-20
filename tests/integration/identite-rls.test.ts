// @vitest-environment node
// RLS de `org_domains` et `invitations` (E02-S01, AC9 à AC13), sous la session de chaque personne, sur des
// données jetables. Depuis E01-S08, la RLS n'y garde que l'isolation par organisation et les invariants :
// les droits (rôles, fiche D14) sont décidés par les services, et leurs cas de policy sont retirés
// (HN-E01S08-9). M11b retire aussi les lectures et écritures que l'isolation par table prouve
// (`isolation-par-table.test.ts`, AC3 à AC5), les chemins permis d'une policy réduite à l'appartenance, la
// révocation décidée par le service (`tests/unit/invitations.test.ts`) et les permutations d'un même refus.
// Suite portable depuis E01-S10 f2 : chaque personne par sa session (`fx.as`), sans PostgREST ni Supabase
// Auth ; le job `bare-postgres` la joue.
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { PlatformDb } from "../../packages/plateforme/server/db"
import { hex, type TestOrg } from "../helpers/plateforme"
import { codeOf, createSqlFixtures, failureOf, SQL_SKIP_REASON, sqlConfigured, type SqlFixtures, type SqlUser } from "../helpers/sql"

const NETWORK_TIMEOUT = 60_000
const PAST = new Date(Date.now() - 24 * 3600 * 1000)
const SUITE = "platform identity RLS"

const email = (label: string) => `${label}-${hex(4)}@example.invalid`

const PEOPLE = ["adminA", "leadA", "memberA", "invitee"] as const
type Person = (typeof PEOPLE)[number]

describe.skipIf(!sqlConfigured)(sqlConfigured ? SUITE : `${SUITE} (${SQL_SKIP_REASON})`, { timeout: NETWORK_TIMEOUT }, () => {
  let fx: SqlFixtures
  let orgA: TestOrg
  let orgB: TestOrg
  const hosts = { a: "", b: "" }
  const teams = { ventes: "", support: "", b: "" }
  const users = new Map<Person, SqlUser>()
  const ids: Record<Person, string> = { adminA: "", leadA: "", memberA: "", invitee: "" }
  const emails: Record<Person, string> = { adminA: "", leadA: "", memberA: "", invitee: "" }
  const invitations = { ventes: "", support: "", none: "" }

  /** La face SQL de cette personne : chaque requête passe par sa session, donc sous RLS. */
  function signedIn(person: Person): PlatformDb {
    const user = users.get(person)
    if (!user) throw new Error(`${person} is not seeded`)
    return fx.as(user)
  }

  /** Une invitation insérée sous la session de la personne, colonnes du formulaire données. */
  const invite = (person: Person, row: Record<string, unknown>) =>
    signedIn(person).tx((sql) => sql<{ id: string }[]>`insert into platform.invitations ${sql(row)} returning id`)

  beforeAll(async () => {
    fx = createSqlFixtures()
    hosts.a = `t${hex(4)}.example.invalid`
    hosts.b = `t${hex(4)}.example.invalid`
    orgA = await fx.createOrg({ hosts: [hosts.a] })
    orgB = await fx.createOrg({ hosts: [hosts.b] })

    for (const person of PEOPLE) {
      const user = await fx.createUser()
      users.set(person, user)
      ids[person] = user.id
      emails[person] = user.email
    }

    teams.ventes = (await fx.createTeam(orgA.id, { name: "Ventes", leadUserId: ids.leadA })).id
    teams.support = (await fx.createTeam(orgA.id, { name: "Support" })).id
    teams.b = (await fx.createTeam(orgB.id, { name: "Team B" })).id
    await fx.addMember(orgA.id, ids.adminA, { role: "admin" })
    await fx.addMember(orgA.id, ids.leadA)
    await fx.addMember(orgA.id, ids.memberA)

    const seed = (address: string, team: string | null) =>
      fx.admin<{ id: string }[]>`insert into platform.invitations (org_id, email, team_id, invited_by) values (${orgA.id}, ${address}, ${team}, ${ids.adminA}) returning id`
    invitations.ventes = (await seed(emails.invitee, teams.ventes))[0].id
    invitations.support = (await seed(email("support"), teams.support))[0].id
    invitations.none = (await seed(email("none"), null))[0].id
  }, 120_000)

  afterAll(async () => {
    await fx?.cleanup()
  }, NETWORK_TIMEOUT)

  // Rattacher une adresse est réservé à l'équipe plateforme qui administre l'organisation (`addHost`), en base aussi
  // depuis `20261020190000` (`org_domains_insert_admin`) : la forme et l'unicité se prouvent sous la session d'un membre
  // de l'équipe plateforme avec un accès en cours à A, et non plus sous l'administratrice de A.
  describe("org_domains (AC9)", () => {
    let platformTeam: PlatformDb

    beforeAll(async () => {
      const staff = await fx.createUser()
      await fx.makeStaff(staff.id)
      await fx.grantPlatformAccess(orgA.id, staff.id, null)
      platformTeam = fx.as(staff)
    })

    it("should refuse a malformed host, here with a port (23514)", async () => {
      const insert = platformTeam.tx((sql) => sql`insert into platform.org_domains (host, org_id) values ('acme.example.invalid:3000', ${orgA.id})`)
      expect(await codeOf(insert)).toBe("23514")
    })

    it("should refuse a host already attached", async () => {
      const insert = platformTeam.tx((sql) => sql`insert into platform.org_domains (host, org_id) values (${hosts.a}, ${orgA.id})`)
      expect(await codeOf(insert)).toBe("23505")
    })

    it("should refuse any update", async () => {
      const update = signedIn("adminA").tx((sql) => sql`update platform.org_domains set org_id = ${orgA.id} where host = ${hosts.a}`)
      expect(await codeOf(update)).toBe("42501")
    })
  })

  describe("invitations read (AC10)", () => {
    const visible = async (person: Person) =>
      (await signedIn(person).tx((sql) => sql<{ id: string }[]>`select id from platform.invitations where org_id = ${orgA.id}`)).map((row) => row.id).sort()

    it("should let the invited person read their own", async () => {
      expect(await visible("invitee")).toEqual([invitations.ventes])
    })
  })

  describe("invitations insert (AC11)", () => {
    it("should let the team lead invite a member into their team", async () => {
      const [row] = await invite("leadA", { org_id: orgA.id, email: email("lead"), role: "member", team_id: teams.ventes, invited_by: ids.leadA })
      expect(row.id).toBeTruthy()
    })

    // Qui invite (l'administrateur, ou le responsable dans son équipe) est décidé par le service depuis
    // E01-S12 partie c (ADR-012 § 3, `tests/integration/invitations.test.ts`, AC16) ; restent la policy et le
    // déclencheur : l'auteur, l'équipe de l'organisation.
    it.each([
      ["the admin signs as someone else", "adminA", { role: "member", team: null, invitedBy: "leadA" }],
      ["the admin uses a team of another organisation", "adminA", { role: "member", team: "b", invitedBy: "adminA" }],
    ] as const)("should refuse when %s", async (_label, caller, row) => {
      const insert = invite(caller, {
        org_id: orgA.id,
        email: email("refused"),
        role: row.role,
        team_id: row.team ? teams[row.team] : null,
        invited_by: ids[row.invitedBy],
      })
      expect(await codeOf(insert)).toBe("42501")
    })

    // H12 : une invitation vit 7 jours et naît ouverte. L'insertion n'est accordée que sur les
    // colonnes du formulaire (`org_id`, `email`, `role`, `team_id`, `invited_by`) ; le reste prend
    // son défaut (migration `20260924110200_platform_invitations_insert.sql`). Un privilège de
    // colonne suffit à le prouver (M11b).
    it("should refuse the admin setting accepted_at at insert", async () => {
      const insert = invite("adminA", { org_id: orgA.id, email: email("column"), invited_by: ids.adminA, accepted_at: new Date() })
      expect(await codeOf(insert)).toBe("42501")
    })
  })

  describe("invitations duplicates (AC12)", () => {
    it("should refuse inviting a member of the organisation as already_member", async () => {
      const failure = await failureOf(invite("adminA", { org_id: orgA.id, email: emails.memberA, invited_by: ids.adminA }))
      expect(failure?.code).toBe("23505")
      expect(failure?.message).toContain("already_member")
    })

    it("should refuse a second pending invitation as already_invited", async () => {
      const pending = email("pending")
      expect(await codeOf(invite("adminA", { org_id: orgA.id, email: pending, invited_by: ids.adminA }))).toBeNull()
      const second = await failureOf(invite("adminA", { org_id: orgA.id, email: pending, invited_by: ids.adminA }))
      expect(second?.code).toBe("23505")
      expect(second?.message).toContain("already_invited")
    })

    // Sans verrou, chaque insertion ne voit pas l'autre avant sa validation : des invitations
    // simultanées pour la même adresse passaient toutes. Le verrou du déclencheur les sérialise
    // (migration `20260924110300_platform_invitations_guard_lock.sql`).
    it("should keep a single pending invitation when the same address is invited concurrently", async () => {
      const address = email("concurrent")
      const attempts = await Promise.all(
        Array.from({ length: 6 }, () => failureOf(invite("adminA", { org_id: orgA.id, email: address, invited_by: ids.adminA }))),
      )
      const rows = await fx.admin`select id from platform.invitations where org_id = ${orgA.id} and email = ${address}`
      expect(rows).toHaveLength(1)
      expect(attempts.filter((attempt) => attempt === null)).toHaveLength(1)
      expect(attempts.filter((attempt) => attempt?.message.includes("already_invited"))).toHaveLength(5)
    })

    it("should accept a new invitation once the previous one expired", async () => {
      const expired = email("expired")
      await fx.admin`insert into platform.invitations (org_id, email, expires_at) values (${orgA.id}, ${expired}, ${PAST})`
      expect(await codeOf(invite("adminA", { org_id: orgA.id, email: expired, invited_by: ids.adminA }))).toBeNull()
    })

    // Retiré de l'organisation, une personne peut rester `teams.lead_user_id` : le déclencheur exige
    // l'appartenance, sans quoi il répondrait `already_member` avant le refus de la RLS.
    it("should tell a lead removed from the organisation nothing about an address", async () => {
      const former = await fx.createUser()
      await fx.addMember(orgA.id, former.id)
      const team = await fx.createTeam(orgA.id, { name: "Ancienne équipe", leadUserId: former.id })
      await fx.admin`delete from platform.members where org_id = ${orgA.id} and user_id = ${former.id}`

      const failure = await failureOf(
        fx.as(former).tx(
          (sql) => sql`insert into platform.invitations (org_id, email, role, team_id, invited_by)
                       values (${orgA.id}, ${emails.memberA}, 'member', ${team.id}, ${former.id})`,
        ),
      )

      expect(failure?.code).toBe("42501")
      expect(failure?.message).not.toContain("already_member")
    })
  })

  // Qui révoque (l'émetteur ou un administrateur) est décidé par le service depuis E01-S07 : prouvé
  // sur la base simulée (`tests/unit/invitations.test.ts`, AC18), ses cas sur la vraie base sont
  // retirés (M11b). Restent les invariants de la policy et les privilèges.
  describe("invitations revocation (AC13)", () => {
    /** L'instruction sous l'administratrice de A : `true` si elle a été refusée ou n'a touché aucune ligne. */
    const changedNothing = (text: (id: string) => Parameters<PlatformDb["tx"]>[0], id: string) =>
      signedIn("adminA")
        .tx(text(id))
        .then(
          (rows: unknown) => Array.isArray(rows) && rows.length === 0,
          () => true,
        )

    it("should never reopen a revoked, accepted or declined invitation", async () => {
      const closed = [
        ...(await fx.admin<{ id: string }[]>`insert into platform.invitations (org_id, email, revoked_at) values (${orgA.id}, ${email("revoked")}, now()) returning id`),
        ...(await fx.admin<{ id: string }[]>`insert into platform.invitations (org_id, email, accepted_at) values (${orgA.id}, ${email("accepted")}, now()) returning id`),
        ...(await fx.admin<{ id: string }[]>`insert into platform.invitations (org_id, email, declined_at) values (${orgA.id}, ${email("declined")}, now()) returning id`),
      ]
      expect(closed).toHaveLength(3)
      for (const row of closed) {
        expect(await changedNothing((id) => (sql) => sql`update platform.invitations set revoked_at = null where id = ${id} returning id`, row.id)).toBe(true)
        expect(await changedNothing((id) => (sql) => sql`update platform.invitations set revoked_at = now() where id = ${id} returning id`, row.id)).toBe(true)
      }
    })

    // Mise à jour accordée sur `revoked_at` seul : un privilège de colonne suffit à le prouver (M11b).
    it("should refuse changing role", async () => {
      const update = signedIn("adminA").tx((sql) => sql`update platform.invitations set role = 'admin' where id = ${invitations.support}`)
      expect(await codeOf(update)).toBe("42501")
    })

    it("should refuse deleting an invitation", async () => {
      const deletion = signedIn("adminA").tx((sql) => sql`delete from platform.invitations where id = ${invitations.none}`)
      expect(await codeOf(deletion)).toBe("42501")
    })
  })
})
