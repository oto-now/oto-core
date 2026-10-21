// @vitest-environment node
// `server/members.ts` (E05-S03 : AC4, AC7 à AC9, AC18 ; H70, H73, fiches D2 et D17) sur une vraie base :
// les services reçoivent le client du paquet sous la session de la personne ; les données de départ et
// l'état se posent et se relisent par la connexion d'administration. Les cas qui retirent ou révoquent
// travaillent sur une organisation à eux (mêmes personnes). Suite portable depuis E01-S10 f2 (chaque
// personne par `fx.as`, sans Supabase Auth ni PostgREST) : le job `bare-postgres` la joue.
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  acceptInvitations,
  listMembers,
  listPlatformAccess,
  PlatformError,
  removeMember,
  resolveIdentity,
  revokePlatformAccess,
  updateMember,
  type Identity,
  type PlatformDb,
} from "@otomata_tech/oto_platform/server"
import { createSqlFixtures, SQL_SKIP_REASON, sqlConfigured, type SqlFixtures, type SqlReferenceOrg, type SqlUser } from "../helpers/sql"
import { privateFolderPending, privateFolderSuite } from "../helpers/pending-migrations"

// Ces tests supposent le dossier `private` en base (fiche D107) : sautés, la version nommée, tant que
// 20260928120000 n'est pas appliquée au projet (`database-patterns.md § Règles`).
const privatePending = await privateFolderPending()

const NETWORK_TIMEOUT = 60_000
const SETUP_TIMEOUT = 240_000

type Who = "ada" | "lea" | "staff"

async function refusal(promise: Promise<unknown>): Promise<PlatformError> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  )
  if (!(error instanceof PlatformError)) throw new Error(`expected a PlatformError, got ${String(error)}`)
  return error
}

describe.skipIf(!sqlConfigured || privatePending)(
  privateFolderSuite(sqlConfigured ? "members service" : `members service (${SQL_SKIP_REASON})`, privatePending),
  { timeout: NETWORK_TIMEOUT },
  () => {
    let fx: SqlFixtures
    let o: SqlReferenceOrg
    let staff: SqlUser

    function db(who: Who): PlatformDb {
      return fx.as(who === "staff" ? staff : o.people[who])
    }

    /** L'identité d'une personne dans l'organisation d'une adresse, sous sa session. */
    function identity(who: Who, org: SqlReferenceOrg): Promise<Identity> {
      const person = who === "staff" ? staff : o.people[who]
      return resolveIdentity(db(who), org.host, { userId: person.id, email: person.email })
    }

    async function setRole(org: SqlReferenceOrg, userId: string, role: "admin" | "member") {
      await fx.admin`update platform.members set role = ${role} where org_id = ${org.org.id} and user_id = ${userId}`
    }

    /** `is_org_admin` sous la session de la personne. */
    const isOrgAdmin = async (who: Who, orgId: string) =>
      (await db(who).tx((sql) => sql<{ admin: boolean }[]>`select platform.is_org_admin(${orgId}) as admin`))[0].admin

    beforeAll(async () => {
      fx = createSqlFixtures()
      o = await fx.buildReferenceOrg()
      staff = await fx.createUser({ fullName: "Sam Staff" })
      await fx.makeStaff(staff.id)
    }, SETUP_TIMEOUT)

    afterAll(async () => {
      await fx?.cleanup()
    }, SETUP_TIMEOUT)

    describe("listMembers (AC4)", () => {
      it("should list the people by name, with email, role, teams, default team and who is looking", async () => {
        await setRole(o, o.people.marc.id, "member")
        // La dernière connexion est la copie posée au retour de connexion (M08), où l'hôte appelle
        // `acceptInvitations` : Léa y passe après sa session.
        await acceptInvitations(db("lea"))
        const members = await listMembers(db("lea"), await identity("lea", o))

        // Les personnes de référence seulement.
        const reference = new Set(Object.values(o.people).map((person) => person.id))
        expect(members.filter((member) => reference.has(member.userId)).map((member) => member.name)).toEqual([
          "Ada Martin",
          "Claire Morel",
          "Léa Roux",
          "Marc Petit",
          "Paul Girard",
        ])
        expect(members.find((member) => member.userId === o.people.lea.id)).toEqual({
          userId: o.people.lea.id,
          email: o.people.lea.email,
          name: "Léa Roux",
          role: "member",
          teams: [{ id: o.teams.ventes, name: "Ventes", role: "member" }],
          lastSignInAt: expect.any(String),
          isSelf: true,
        })
        expect(members.find((member) => member.userId === o.people.claire.id)?.teams).toEqual([{ id: o.teams.ventes, name: "Ventes", role: "lead" }])
        expect(members.find((member) => member.userId === o.people.ada.id)).toMatchObject({ role: "admin", teams: [], isSelf: false })
      })

      // E05-S13 (fiche D128) : l'équipe par défaut n'est plus lue, même posée hors du service.
      it("should no longer read a default team", async () => {
        await fx.admin`update platform.members set default_team_id = ${o.teams.support} where org_id = ${o.org.id} and user_id = ${o.people.marc.id}`
        const members = await listMembers(db("lea"), await identity("lea", o))
        expect(members.find((member) => member.userId === o.people.marc.id)).not.toHaveProperty("defaultTeamId")
        await fx.admin`update platform.members set default_team_id = null where org_id = ${o.org.id} and user_id = ${o.people.marc.id}`
      })
    })

    describe("updateMember (AC7)", () => {
      it("should promote a member to administrator, then back to member", async () => {
        await setRole(o, o.people.marc.id, "member")
        const promoted = await updateMember(db("ada"), await identity("ada", o), o.people.marc.id, { role: "admin" })
        expect(promoted).toMatchObject({ data: { userId: o.people.marc.id, role: "admin" }, target: o.people.marc.email, teamId: null })
        const demoted = await updateMember(db("ada"), await identity("ada", o), o.people.marc.id, { role: "member" })
        expect(demoted.data.role).toBe("member")
      })

      it("should refuse demoting the last administrator (conflict last_admin), changing nothing", async () => {
        await setRole(o, o.people.marc.id, "member")
        const error = await refusal(updateMember(db("ada"), await identity("ada", o), o.people.ada.id, { role: "member" }))
        expect(error.code).toBe("conflict")
        expect(error.details).toEqual({ reason: "last_admin" })
        expect(await fx.admin`select role from platform.members where org_id = ${o.org.id} and user_id = ${o.people.ada.id}`).toEqual([{ role: "admin" }])
      })
    })

    describe("removeMember (AC9, H70)", () => {
      it("should refuse removing the last administrator (conflict last_admin)", async () => {
        const r = await fx.buildReferenceOrg(o.people)
        const error = await refusal(removeMember(db("ada"), await identity("ada", r), o.people.ada.id))
        expect(error.details).toEqual({ reason: "last_admin" })
      })

      it("should remove a lead: no longer lead nor in any team, personal rules gone, by members_cleanup", async () => {
        const r = await fx.buildReferenceOrg(o.people)
        await fx.addRule({ orgId: r.org.id, nodeId: r.nodes.faq, userId: o.people.claire.id, level: "read" })

        const removed = await removeMember(db("ada"), await identity("ada", r), o.people.claire.id)

        expect(removed).toEqual({ data: { userId: o.people.claire.id }, target: o.people.claire.email, teamId: null })
        const [links, rules] = await Promise.all([
          fx.admin`select team_id from platform.team_members where user_id = ${o.people.claire.id} and team_id in ${fx.admin([r.teams.ventes, r.teams.support])}`,
          fx.admin`select id from platform.access_rules where org_id = ${r.org.id} and subject_user_id = ${o.people.claire.id}`,
        ])
        expect([[...links], [...rules]]).toEqual([[], []])
      })
    })

    describe("platform access (AC18, fiches D2 and D17)", () => {
      it("should list an access with the name and email of its holder, who is not a member", async () => {
        const p = await fx.buildReferenceOrg(o.people)
        const grant = await fx.grantPlatformAccess(p.org.id, staff.id, staff.id)

        const { accesses } = await listPlatformAccess(db("ada"), await identity("ada", p))

        expect(accesses).toEqual([
          {
            id: grant,
            userId: staff.id,
            name: "Sam Staff",
            email: staff.email,
            grantedAt: expect.any(String),
            grantedByName: "Sam Staff",
            revokedAt: null,
            revokedByName: null,
            reason: null,
          },
        ])
      })

      it("should list the members added by the platform team: itself a member, or invited by it (D17)", async () => {
        const p = await fx.buildReferenceOrg(o.people)
        await fx.grantPlatformAccess(p.org.id, staff.id, staff.id)
        // Membre, son nom est celui de `member_directory` d'abord (AC18).
        await fx.addMember(p.org.id, staff.id, { profile: { name: "Sam Staff" } })
        // Une invitation du staff, acceptée : posée comme `accept_invitations` la laisse, par la connexion
        // d'administration (la garde `invitations_guard` refuse l'invitation d'une adresse déjà membre).
        const nina = await fx.createUser({ fullName: "Nina Nouvelle" })
        const [invitation] = await fx.admin<{ id: string }[]>`
          insert into platform.invitations (org_id, email, invited_by) values (${p.org.id}, ${nina.email}, ${staff.id}) returning id`
        await fx.addMember(p.org.id, nina.id, { profile: { name: "Nina Nouvelle" } })
        await fx.admin`update platform.invitations set accepted_at = now(), accepted_by = ${nina.id} where id = ${invitation.id}`

        const { addedByStaff } = await listPlatformAccess(db("ada"), await identity("ada", p))

        const vus = addedByStaff.map((member) => [member.userId, member.via, member.invitedByName])
        expect(vus.sort()).toEqual(
          [
            [nina.id, "invitation", "Sam Staff"],
            [staff.id, "staff", null],
          ].sort(),
        )
        expect(addedByStaff.find((member) => member.userId === nina.id)?.joinedAt).toEqual(expect.any(String))
      })

      it("should let an administrator revoke an access, idempotently: its holder is no longer an administrator", async () => {
        const p = await fx.buildReferenceOrg(o.people)
        const grant = await fx.grantPlatformAccess(p.org.id, staff.id, staff.id)
        expect(await isOrgAdmin("staff", p.org.id)).toBe(true)

        const first = await revokePlatformAccess(db("ada"), await identity("ada", p), grant)
        const second = await revokePlatformAccess(db("ada"), await identity("ada", p), grant)

        expect(first).toMatchObject({ data: { id: grant, alreadyRevoked: false }, target: grant, teamId: null })
        expect(second.data).toEqual({ id: grant, revokedAt: first.data.revokedAt, alreadyRevoked: true })
        expect(await fx.admin`select revoked_by from platform.platform_grants where id = ${grant}`).toEqual([{ revoked_by: o.people.ada.id }])
        expect(await isOrgAdmin("staff", p.org.id)).toBe(false)
        const { accesses } = await listPlatformAccess(db("ada"), await identity("ada", p))
        expect(accesses[0]).toMatchObject({ revokedAt: first.data.revokedAt, revokedByName: "Ada Martin" })
      })
    })
  },
)
