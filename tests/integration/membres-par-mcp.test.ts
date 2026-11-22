// @vitest-environment node
// Les membres et les équipes d'une organisation derrière `call` (`member.list`, `member.add`, `member.set_teams`,
// `member.remove`, `team.create`), sur une vraie base : le serveur d'un hôte qui sert de client MCP, sous le jeton de
// la personne qui agit. Les droits sont ceux de l'écran Équipes, décidés par ses services. O de référence : Ada
// administre, Claire mène Ventes (Léa en est), Paul mène Support, Marc est membre sans équipe, Sam (équipe plateforme)
// entre par un accès en cours.
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { runCall } from "../../packages/plateforme/server/calls"
import type { FunctionContext, FunctionOutput } from "../../packages/plateforme/server/catalog/define"
import { acceptInvitations } from "../../packages/plateforme/server/invitations"
import { memberAdd, memberList, memberRemove, memberSetTeams, teamCreate } from "../../packages/plateforme/server/member-functions"
import { nodeAccess, nodeShareFunction } from "../../packages/plateforme/server/nodes/share-functions"
import type { Person } from "../helpers/reference-org"
import { seedReferenceOrg, type ReferenceOrgSql } from "../helpers/reference-org-sql"
import { asCaller, seedWithAdmin, SQL_SKIP_REASON, sqlConfigured, type SeededData } from "../helpers/sql"

const SETUP_TIMEOUT = 180_000

const settle = <T,>(promise: Promise<T>) =>
  promise.then(
    (result) => ({ result, error: null }),
    (error: unknown) => ({ result: null, error }),
  )

type Listed = { member_id: string; email: string | null; status: string; role: string; teams: string[] }

describe.skipIf(!sqlConfigured)(sqlConfigured ? "members and teams through call on a real database" : `members and teams through call on a real database (${SQL_SKIP_REASON})`, { timeout: SETUP_TIMEOUT }, () => {
  let seed: SeededData
  let ref: ReferenceOrgSql

  beforeAll(async () => {
    seed = seedWithAdmin()
    ref = await seedReferenceOrg(seed)
  }, SETUP_TIMEOUT)

  afterAll(async () => {
    await seed?.cleanup()
  }, SETUP_TIMEOUT)

  const context = async (person: Person): Promise<FunctionContext> => ({ db: await ref.db(person), identity: ref.identityOf(person), ctx: null })
  // `run` reçoit des arguments déjà validés par le schéma de la fonction : le test passe leur forme validée.
  const as = (person: Person) => ({
    list: async () => (await memberList.run(await context(person), { offset: 0 } as never)) as FunctionOutput & { data: { people: Listed[] } },
    add: async (args: Record<string, unknown>) => memberAdd.run(await context(person), { role: "member", ...args } as never),
    setTeams: async (member: string, teams: string[]) => memberSetTeams.run(await context(person), { member, teams } as never),
    remove: async (member: string) => memberRemove.run(await context(person), { member } as never),
    createTeam: async (name: string) => teamCreate.run(await context(person), { name } as never),
  })
  const listed = async (email: string) => (await as("ada").list()).data.people.find((person) => person.email === email)

  it("should create a team with its folder once, then return it unchanged, for an administrator only", async () => {
    const created = await as("ada").createTeam("Achats")
    const again = await as("ada").createTeam("achats")
    const refused = await settle(as("claire").createTeam("Formation"))

    expect(created.data).toEqual({ slug: "achats", name: "Achats", created: true })
    expect(again.data).toEqual({ slug: "achats", name: "Achats", created: false })
    const [folder] = await seed.admin<{ owner_team_id: string | null }[]>`select owner_team_id from platform.nodes where org_id = ${ref.org.id} and path = 'achats'`
    expect(folder?.owner_team_id).toBe(created.teamId)
    expect(refused.error).toMatchObject({ code: "forbidden", message: `Only an administrator of ${ref.org.name} can create a team.` })
  })

  it("should give other teams read or write on the folder of a created team with node.share, as a host sets up an organisation", async () => {
    await as("ada").createTeam("Formation")
    for (const [team, level] of [["Ventes", "read"], ["Support", "write"]]) {
      await nodeShareFunction.run(await context("ada"), { path: "formation", subject: "team", name: team, level } as never)
    }
    const access = await nodeAccess.run(await context("ada"), { path: "formation" } as never)

    expect(access.data).toMatchObject({ owner: { kind: "team", team: "Formation" }, organisation: "none" })
    expect((access.data as { added: unknown[] }).added).toEqual([
      { kind: "team", name: "Support", level: "write" },
      { kind: "team", name: "Ventes", level: "read" },
    ])
  })

  it("should add a pending person without email, idempotently, list her, and let her in with her team at her first sign-in", async () => {
    const person = seed.person()
    const added = await as("ada").add({ email: person.email.toUpperCase(), teams: ["Ventes"] })
    const again = await as("ada").add({ email: person.email, teams: ["ventes"] })
    const two = await settle(as("ada").add({ email: person.email, teams: ["ventes", "support"] }))

    expect(added.data).toMatchObject({ email: person.email, status: "pending", role: "member", teams: ["ventes"], changed: true })
    expect(again.data).toMatchObject({ member_id: added.data?.member_id, status: "pending", changed: false })
    expect(two.error).toMatchObject({ code: "invalid_arguments", details: { reason: "pending_single_team" } })
    expect(await listed(person.email)).toEqual({ member_id: added.data?.member_id, email: person.email, role: "member", status: "pending", teams: ["ventes"] })

    // Sa première connexion : l'invitation acceptée (en mode OIDC, `resolveIdentity` le fait à sa première requête).
    await acceptInvitations(asCaller(person.id, person.email))

    expect(await listed(person.email)).toMatchObject({ member_id: person.id, status: "active", teams: ["ventes"] })
  })

  it("should let a lead add a member to the team she leads only, as a member, and refuse a plain member", async () => {
    const person = seed.person()
    const added = await as("claire").add({ email: person.email, teams: ["ventes"] })
    const otherTeam = await settle(as("claire").add({ email: seed.person().email, teams: ["support"] }))
    const noTeam = await settle(as("claire").add({ email: seed.person().email }))
    const admin = await settle(as("claire").add({ email: seed.person().email, teams: ["ventes"], role: "admin" }))
    const plain = await settle(as("lea").add({ email: seed.person().email, teams: ["ventes"] }))
    const plainList = await settle(as("lea").list())

    expect(added.data).toMatchObject({ status: "pending", teams: ["ventes"] })
    expect(otherTeam.error).toMatchObject({ code: "forbidden", details: { reason: "team_required" } })
    expect(noTeam.error).toMatchObject({ code: "forbidden", details: { reason: "team_required" } })
    expect(admin.error).toMatchObject({ code: "forbidden", details: { reason: "admin_role_reserved" } })
    for (const refused of [plain, plainList]) expect(refused.error).toMatchObject({ code: "forbidden", details: { reason: "not_allowed" } })
    // Le responsable voit les personnes en attente de son équipe, et l'email des membres de ses équipes seulement.
    const people = (await as("claire").list()).data.people
    expect(people.find((entry) => entry.email === person.email)).toMatchObject({ status: "pending", teams: ["ventes"] })
    const byId = (person: Person) => people.find((entry) => entry.status === "active" && entry.member_id === ref.people[person].id)
    expect([byId("lea")?.email, byId("ada")?.email]).toEqual([ref.people.lea.email, null])
  })

  it("should replace the teams of a member, a lead only within the teams she leads, all or nothing", async () => {
    const marc = ref.people.marc.email
    const paul = ref.people.paul.email
    await as("ada").setTeams(marc, ["ventes", "support"])
    const moved = await as("ada").setTeams(marc, ["support"])
    const added = await as("claire").setTeams(paul, ["support", "ventes"])
    const outside = await settle(as("claire").setTeams(paul, []))

    expect(moved.data).toMatchObject({ status: "active", teams: ["support"], changed: true })
    expect(moved.text).toBe("Marc Petit: removed from ventes.")
    expect(added.data).toMatchObject({ teams: ["support", "ventes"], changed: true })
    // Retirer Paul de Support, que Claire ne mène pas : refusé, et Ventes, retirée dans la même transaction, reste.
    expect(outside.error).toMatchObject({ code: "forbidden" })
    expect((await listed(paul))?.teams.sort()).toEqual(["support", "ventes"])
  })

  it("should remove a member or a pending person in two steps through call, an administrator only, the last administrator kept", async () => {
    const deps = async (person: Person) => ({ db: await ref.db(person), identity: ref.identityOf(person), ctxCode: null, origin: "https://exemple.test", activeConnectors: async () => new Set<string>() })
    const pending = seed.person()
    await as("ada").add({ email: pending.email, teams: ["support"] })
    const asked = await runCall(await deps("ada"), { function: "member.remove", arguments: { member: ref.people.marc.email } })
    const done = await runCall(await deps("ada"), { function: "member.remove", arguments: { member: ref.people.marc.email }, confirm: true })
    const withdrawn = await as("ada").remove(pending.email)
    const byLead = await settle(as("claire").remove(ref.people.lea.email))
    const last = await settle(as("ada").remove(ref.people.ada.email))

    expect(asked.data).toMatchObject({ status: "needs_confirmation" })
    expect(asked.text).toContain(`Remove Marc Petit <${ref.people.marc.email}>`)
    expect(done.text).toContain("Marc Petit is removed from")
    expect(withdrawn.data).toMatchObject({ status: "removed" })
    expect(await listed(pending.email)).toBeUndefined()
    expect(byLead.error).toMatchObject({ code: "forbidden" })
    expect(last.error).toMatchObject({ code: "conflict", details: { reason: "last_admin" } })
  })

  it("should let a platform team member with an open access add the first administrator of the organisation", async () => {
    const person = seed.person()
    const added = await as("s").add({ email: person.email, role: "admin" })

    expect(added.data).toMatchObject({ status: "pending", role: "admin", teams: [] })
  })
})
