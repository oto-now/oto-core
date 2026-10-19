// @vitest-environment node
// L'identité par l'adresse (E02-S01 ; E01-S04 : staff et accès ; E01-S07 AC13) sur une vraie base, en
// suite portable (E01-S10, partie e1a : `server/identity.ts` passe au SQL ; AC-x3, fiche D76 A) : O et P
// de `seedReferenceOrg`, semées par la connexion d'administration, et chaque personne appelée par
// `asCaller`, sans Supabase Auth. Sous la seule isolation (E01-S08), la base rend à chacun les lignes de
// toutes ses organisations : la ligne `members`, les équipes et les accès de l'organisation de l'adresse
// se choisissent dans le service. Les cas purs (hôte, origine) sont dans `tests/unit/identity.test.ts`.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { PlatformError } from "../../packages/plateforme/server/errors"
import { createAnonPlatformDb } from "../../packages/plateforme/server/db"
import { orgContact, resolveIdentity, trustedRequestOrigin } from "../../packages/plateforme/server/identity"
import { hex } from "../helpers/plateforme"
import { ORG, OTHER_ORG, PEOPLE, TEAMS, type Person } from "../helpers/reference-org"
import { seedReferenceOrg, type ReferenceOrgSql } from "../helpers/reference-org-sql"
import { asCaller, seedWithAdmin, spyDb, SQL_SKIP_REASON, sqlConfigured, type SeededData, type SeededPerson } from "../helpers/sql"

const SETUP_TIMEOUT = 180_000
const SUITE = "resolveIdentity on a real database"

describe.skipIf(!sqlConfigured)(sqlConfigured ? SUITE : `${SUITE} (${SQL_SKIP_REASON})`, () => {
  let seed: SeededData
  let ref: ReferenceOrgSql

  beforeAll(async () => {
    seed = seedWithAdmin()
    ref = await seedReferenceOrg(seed)
  }, SETUP_TIMEOUT)

  afterAll(async () => {
    await seed?.cleanup()
  }, SETUP_TIMEOUT)

  const callerOf = (person: SeededPerson) => ({ userId: person.id, email: person.email })
  const dbOf = (person: SeededPerson) => asCaller(person.id, person.email)
  const resolveAtO = (person: SeededPerson, db = dbOf(person)) => resolveIdentity(db, ref.org.host, callerOf(person))
  const named = (person: Person) => ref.people[person]

  // E05-S13 (fiche D128) : les équipes par nom, l'équipe par défaut (encore en base) ignorée ; le rôle lu sur
  // `team_members.role`, une personne pouvant mener plusieurs équipes et une équipe avoir plusieurs responsables.
  it("should sort the teams by name, ignoring a default team, with the role read on team_members", async () => {
    // Claire mène Ventes ; elle rejoint Support et mène aussi Achats ; RH ne la compte pas.
    const claire = named("claire")
    await ref.write({
      teams: [
        { id: "team-achats", org_id: ORG.id, slug: "achats", name: "Achats" },
        { id: "team-rh", org_id: ORG.id, slug: "rh", name: "RH" },
      ],
    })
    await ref.write({
      team_members: [
        { team_id: TEAMS.support.id, user_id: PEOPLE.claire.id },
        { team_id: "team-achats", user_id: PEOPLE.claire.id, role: "lead" },
      ],
    })
    await seed.admin`update platform.members set default_team_id = ${ref.id(TEAMS.support.id)} where org_id = ${ref.org.id} and user_id = ${claire.id}`
    try {
      const identity = await resolveAtO(claire)
      expect(identity.teams.map((team) => [team.name, team.role])).toEqual([
        ["Achats", "lead"],
        ["Support", "member"],
        ["Ventes", "lead"],
      ])
    } finally {
      await seed.admin`update platform.members set default_team_id = null where org_id = ${ref.org.id} and user_id = ${claire.id}`
      await seed.admin`delete from platform.team_members where user_id = ${claire.id} and team_id in ${seed.admin([ref.id(TEAMS.support.id), ref.id("team-achats")])}`
    }
  })

  it("should name the person after the email local part without profile.name, and serve the organisation of the address", async () => {
    const newcomer = seed.person()
    await ref.write({ members: [{ org_id: ORG.id, user_id: newcomer.id, role: "member", profile: {}, email: newcomer.email }] })
    await ref.write({ orgs: [{ id: ORG.id, settings: { domains: "sales" } }] })

    const identity = await resolveAtO(newcomer)

    expect(identity.user).toEqual({ id: newcomer.id, email: newcomer.email, name: newcomer.email.split("@")[0] })
    // Sans handle à l'insertion, la base lui en pose un, tiré de son email (E11-S10, AC-a1).
    expect(identity.member).toEqual({ role: "member", profile: { handle: newcomer.email.split("@")[0].replaceAll("-", "_") } })
    expect(identity.org).toEqual({ id: ref.org.id, slug: ref.org.slug, name: "Acme Test", prefix: ref.org.prefix, brand: {}, domains: "sales" })
  })

  it("should raise unknown_org for a host without organisation", async () => {
    const host = `t${hex(4)}.example.invalid`
    const error = await resolveIdentity(dbOf(named("lea")), host, callerOf(named("lea"))).catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(PlatformError)
    expect(error).toMatchObject({ code: "unknown_org", message: `No organisation is served at ${host}.` })
  })

  it("should raise not_member for a signed-in person outside the organisation, even a member of another one (P)", async () => {
    // Membre de P seulement : sa ligne `members` de P lui est lisible, et ne vaut rien à l'adresse de O.
    const outsider = seed.person()
    await ref.write({ members: [{ org_id: OTHER_ORG.id, user_id: outsider.id, role: "member", profile: {}, email: outsider.email }] })

    await expect(resolveAtO(outsider)).rejects.toMatchObject({
      code: "not_member",
      message: `You are signed in as ${outsider.email} but you are not a member of Acme Test. Ask an administrator of Acme Test to add you.`,
    })
  })

  it("should never take the role nor the teams another organisation of the person gives her (P)", async () => {
    // Léa, membre simple de O (Ventes), administratrice de P et membre d'une équipe de P.
    const lea = named("lea")
    await seed.admin`update platform.members set role = 'admin' where org_id = ${ref.other.id} and user_id = ${lea.id}`
    await ref.write({ teams: [{ id: "team-p", org_id: OTHER_ORG.id, slug: "equipe_p", name: "Équipe P", lead_user_id: null }] })
    await ref.write({ team_members: [{ team_id: "team-p", user_id: PEOPLE.lea.id }] })
    try {
      const identity = await resolveAtO(lea)
      expect([identity.member.role, identity.teams.map((team) => team.name)]).toEqual(["member", ["Ventes"]])
    } finally {
      await seed.admin`update platform.members set role = 'member' where org_id = ${ref.other.id} and user_id = ${lea.id}`
    }
  })

  it("should read the current platform access of any staff member, member or not, and never another's (AC13)", async () => {
    const { db: t, sent: tSent } = spyDb(dbOf(named("t")))
    const { db: lea, sent: leaSent } = spyDb(dbOf(named("lea")))
    const grantReads = (sent: typeof tSent) => sent.filter((query) => query.target === "platform_grants")

    expect(await resolveAtO(named("t"), t)).toMatchObject({ member: { role: "member" }, isStaff: true, viaGrant: false, hasOpenGrant: true })
    expect(grantReads(tSent)).toHaveLength(1)
    expect(await resolveAtO(named("lea"), lea)).toMatchObject({ isStaff: false, viaGrant: false, hasOpenGrant: false })
    expect(grantReads(leaSent)).toEqual([])
  })

  it("should count only a current platform access to this organisation: neither one to another organisation nor a revoked one", async () => {
    // Un membre simple de O, de l'équipe plateforme, avec un accès en cours à P et un accès révoqué à O.
    const staff = seed.person()
    await ref.write({
      members: [{ org_id: ORG.id, user_id: staff.id, role: "member", profile: {}, email: staff.email }],
      platform_staff: [{ user_id: staff.id }],
      platform_grants: [
        { id: `grant:${staff.id}:other`, org_id: OTHER_ORG.id, user_id: staff.id, revoked_at: null },
        { id: `grant:${staff.id}:revoked`, org_id: ORG.id, user_id: staff.id, revoked_at: "2026-09-25T10:00:00.000Z" },
      ],
    })

    expect(await resolveAtO(staff)).toMatchObject({ member: { role: "member" }, isStaff: true, viaGrant: false, hasOpenGrant: false })
  })

  // Repris d'`access-service.test.ts` (M11b) : un consultant de l'équipe plateforme sans ligne `members`
  // entre par son accès en cours, en administrateur sans équipe, et n'entre plus une fois l'accès révoqué.
  // Une personne à ce cas : la révocation ne touche pas S, que les autres cas lisent.
  it("should give a consultant with a current access an administrator identity without teams, and refuse her once it is revoked (not_member)", async () => {
    const consultant = seed.person()
    await ref.write({
      platform_staff: [{ user_id: consultant.id }],
      platform_grants: [{ id: `grant:${consultant.id}`, org_id: ORG.id, user_id: consultant.id, revoked_at: null }],
    })

    expect(await resolveAtO(consultant)).toMatchObject({
      member: { role: "admin", profile: {} },
      teams: [],
      isStaff: true,
      viaGrant: true,
    })
    await seed.admin`update platform.platform_grants set revoked_at = now() where id = ${ref.id(`grant:${consultant.id}`)}`
    await expect(resolveAtO(consultant)).rejects.toMatchObject({ code: "not_member" })
  })

  it("should name the oldest administrator to ask for access, and nobody for an organisation without one (orgContact)", async () => {
    const lea = dbOf(named("lea"))
    expect(await orgContact(lea, ref.org.id)).toEqual({ name: "Ada Martin", email: named("ada").email })
    expect(await orgContact(lea, ref.other.id)).toBeNull()
  })

  // L'origine des liens envoyés hors de la requête : `org_by_host` sous `anon`, comme la page de connexion.
  it("should give a link origin, in https, only to an address of org_domains or an entry address (trustedRequestOrigin)", async () => {
    const anon = createAnonPlatformDb()
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      const forwarded = (host: string) => new Headers({ "x-forwarded-host": host, "x-forwarded-proto": "http", host: ref.org.host })

      await expect(trustedRequestOrigin(anon, forwarded(`${ref.org.host.toUpperCase()}:8443`))).resolves.toBe(`https://${ref.org.host}`)
      await expect(trustedRequestOrigin(anon, forwarded("evil.example.invalid"))).resolves.toBeNull()
      await expect(trustedRequestOrigin(anon, forwarded("site.example.invalid"), { entryHosts: ["site.example.invalid"] })).resolves.toBe("https://site.example.invalid")
      expect(log).toHaveBeenCalledTimes(1)
    } finally {
      log.mockRestore()
    }
  })
})
