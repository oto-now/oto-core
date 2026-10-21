// @vitest-environment node
// `server/teams.ts` (E05-S03 : AC10 à AC14 ; H69, H72, P17, P39) sur une vraie base : les services
// reçoivent le client du paquet sous la session de la personne, comme dans l'hôte ; l'état se relit par la
// connexion d'administration. Chaque cas crée son équipe : aucun ne dépend de l'ordre. Les refus que le
// service décide avant toute lecture (créer, renommer ou supprimer une équipe sans être administrateur ;
// composer l'équipe d'un autre responsable) sont prouvés sur la base réelle par
// `tests/unit/equipes-droits.test.ts`, qui voit aussi qu'aucune requête ne part : leurs cas sont retirés d'ici
// (M11b, liste d'E01-S07 ; M29). Reste celui du membre simple de l'équipe, qu'`equipes-droits` ne joue pas. Suite portable
// depuis E01-S10 f2 (chaque personne par `fx.as`, sans Supabase Auth ni PostgREST) : le job
// `bare-postgres` la joue.
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  addTeamMember,
  createTeam,
  deleteTeam,
  listTeams,
  PlatformError,
  removeTeamMember,
  resolveIdentity,
  teamSlug,
  updateTeam,
  type Identity,
  type PlatformDb,
} from "@otomata_tech/oto_platform/server"
import { teamPanel } from "../../packages/plateforme/server/team-panel"
import { hex } from "../helpers/plateforme"
import { createSqlFixtures, SQL_SKIP_REASON, sqlConfigured, type SqlFixtures, type SqlReferenceOrg } from "../helpers/sql"
import { privateFolderPending, privateFolderSuite } from "../helpers/pending-migrations"

// Ces tests supposent le dossier `private` en base (fiche D107) : sautés, la version nommée, tant que
// 20260928120000 n'est pas appliquée au projet (`database-patterns.md § Règles`).
const privatePending = await privateFolderPending()

const NETWORK_TIMEOUT = 60_000
const SETUP_TIMEOUT = 180_000

type Who = "ada" | "claire" | "lea"
type Session = { db: PlatformDb; identity: Identity }

async function refusal(promise: Promise<unknown>): Promise<PlatformError> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  )
  if (!(error instanceof PlatformError)) throw new Error(`expected a PlatformError, got ${String(error)}`)
  return error
}

describe.skipIf(!sqlConfigured || privatePending)(
  privateFolderSuite(sqlConfigured ? "teams service" : `teams service (${SQL_SKIP_REASON})`, privatePending),
  { timeout: NETWORK_TIMEOUT },
  () => {
    let fx: SqlFixtures
    let o: SqlReferenceOrg
    const sessions = new Map<Who, Session>()

    function as(who: Who): Session {
      const found = sessions.get(who)
      if (!found) throw new Error(`${who} has no session`)
      return found
    }

    const teamRow = (slug: string) =>
      fx.admin<{ id: string; name: string; lead_user_id: string | null }[]>`select id, name, lead_user_id from platform.teams where org_id = ${o.org.id} and slug = ${slug}`

    async function teamCount(): Promise<number> {
      return (await fx.admin`select id from platform.teams where org_id = ${o.org.id}`).length
    }

    async function paths(prefix: string): Promise<string[]> {
      const rows = await fx.admin<{ path: string }[]>`select path from platform.nodes where org_id = ${o.org.id} and path like ${`${prefix}%`} order by path`
      return rows.map((row) => row.path).filter((path) => path === prefix || path.startsWith(`${prefix}/`))
    }

    async function roles(teamId: string) {
      const rows = await fx.admin<{ user_id: string; role: string }[]>`select user_id, role from platform.team_members where team_id = ${teamId}`
      return Object.fromEntries(rows.map((row) => [row.user_id, row.role]))
    }

    /** Une équipe du cas, créée par le service sous le jeton d'Ada : son dossier et son Contexte naissent. */
    async function newTeam(prefix: string) {
      const name = `${prefix} ${hex(3)}`
      const { data } = await createTeam(as("ada").db, as("ada").identity, { name })
      return data
    }

    beforeAll(async () => {
      fx = createSqlFixtures()
      o = await fx.buildReferenceOrg()
      for (const who of ["ada", "claire", "lea"] as const) {
        const person = o.people[who]
        const db = fx.as(person)
        sessions.set(who, { db, identity: await resolveIdentity(db, o.host, { userId: person.id, email: person.email }) })
      }
    }, SETUP_TIMEOUT)

    afterAll(async () => {
      await fx?.cleanup()
    }, SETUP_TIMEOUT)

    describe("listTeams (AC10)", () => {
      it("should list the teams by name, with their lead and their people, the lead first", async () => {
        const teams = await listTeams(as("lea").db, as("lea").identity)
        const ventes = teams.find((team) => team.id === o.teams.ventes)
        expect(ventes).toMatchObject({ slug: "ventes", name: "Ventes", leadName: "Claire Morel" })
        expect(ventes?.members.map((person) => [person.name, person.role])).toEqual([
          ["Claire Morel", "lead"],
          ["Léa Roux", "member"],
        ])
        expect(teams.map((team) => team.name)).toEqual([...teams.map((team) => team.name)].sort((a, b) => a.localeCompare(b, "fr")))
      })
    })

    // Le « ⋯ » d'une équipe dans le rail (2026-10-15) : l'équipe, les personnes, composer pour son responsable seul.
    describe("teamPanel", () => {
      it("should read a team by its slug with the people of the organisation, compose for its lead only, and refuse an unknown slug", async () => {
        const claire = await teamPanel(as("claire").db, as("claire").identity, "ventes")
        expect(claire.team).toMatchObject({ id: o.teams.ventes, name: "Ventes" })
        expect(claire.people.map((person) => person.name)).toEqual(expect.arrayContaining(["Claire Morel", "Léa Roux"]))
        expect([claire.compose, claire.admin]).toEqual([true, false])
        const lea = await teamPanel(as("lea").db, as("lea").identity, "ventes")
        expect([lea.compose, lea.admin]).toEqual([false, false])
        expect((await refusal(teamPanel(as("lea").db, as("lea").identity, "inconnue"))).code).toBe("not_found")
      })
    })

    describe("createTeam (AC11)", () => {
      it("should enter its creator as its lead in the same transaction, and write no membership on a refusal (E11-S10, AC-c1)", async () => {
        const created = await newTeam("Achats")
        expect(await roles(created.id)).toEqual({ [o.people.ada.id]: "lead" })
        const lead = (await listTeams(as("ada").db, as("ada").identity)).find((team) => team.id === created.id)
        expect(lead).toMatchObject({ leadName: "Ada Martin", members: [{ userId: o.people.ada.id, role: "lead" }] })

        const memberships = async () => (await fx.admin`select team_id from platform.team_members tm join platform.teams t on t.id = tm.team_id where t.org_id = ${o.org.id}`).length
        const before = await memberships()
        const slug = `stock_${hex(3)}`
        await fx.createNode(o.org.id, { parentId: o.nodes.root, path: slug, title: "Stock" })
        expect((await refusal(createTeam(as("ada").db, as("ada").identity, { name: slug }))).details).toEqual({ reason: "path_taken" })
        expect((await refusal(createTeam(as("ada").db, as("ada").identity, { name: created.name }))).details).toEqual({ reason: "name_taken" })
        expect(await memberships()).toBe(before)
      })

      it("should create the team of a platform access without membership, its folder and Contexte born in the tree (P39), and enter nobody (E11-S10, AC-c2)", async () => {
        const s = await fx.createUser({ fullName: "Sam Staff" })
        await fx.makeStaff(s.id)
        await fx.grantPlatformAccess(o.org.id, s.id, null)
        const db = fx.as(s)
        const identity = await resolveIdentity(db, o.host, { userId: s.id, email: s.email })
        expect(identity.viaGrant).toBe(true)
        const name = `Conseil ${hex(3)}`
        const created = await createTeam(db, identity, { name })
        expect(created.data).toMatchObject({ slug: teamSlug(name), name })
        expect(created).toMatchObject({ target: teamSlug(name), teamId: created.data.id })
        expect(await roles(created.data.id)).toEqual({})
        expect(await paths(created.data.slug)).toEqual([created.data.slug, `${created.data.slug}/contexte`])
      })

      it("should refuse a name already taken, by its slug or without case nor accents (name_taken)", async () => {
        const first = await newTeam("Équipe Achats")
        for (const name of [first.name.toUpperCase(), first.name.replace("Équipe", "Equipe"), `${first.name}!`]) {
          const error = await refusal(createTeam(as("ada").db, as("ada").identity, { name }))
          expect(error.code).toBe("conflict")
          expect(error.details).toEqual({ reason: "name_taken" })
        }
      })

      it.each(["Contexte", "Journal", "Private", "Perso"])("should refuse the reserved name %s before any write (reserved_slug)", async (name) => {
        const before = await teamCount()
        const error = await refusal(createTeam(as("ada").db, as("ada").identity, { name }))
        expect(error.code).toBe("invalid_arguments")
        expect(error.details).toEqual({ reason: "reserved_slug" })
        expect(await teamCount()).toBe(before)
      })

      it("should refuse a name whose slug is the path of an organisation page (path_taken), writing nothing", async () => {
        const slug = `annonces_${hex(3)}`
        await fx.createNode(o.org.id, { parentId: o.nodes.root, path: slug, title: "Annonces" })
        const error = await refusal(createTeam(as("ada").db, as("ada").identity, { name: slug }))
        expect(error.code).toBe("conflict")
        expect(error.details).toEqual({ reason: "path_taken" })
        expect(await teamRow(slug)).toEqual([])
      })

      it("should refuse the first name of a renamed team, whose path it keeps (slug_taken), and names near its new one (name_taken)", async () => {
        const team = await newTeam("Magasin")
        const renamed = await updateTeam(as("ada").db, as("ada").identity, team.id, { name: `Entrepôt ${hex(3)}` })
        const other = await newTeam("Atelier")

        const creating = await refusal(createTeam(as("ada").db, as("ada").identity, { name: team.name }))
        const renaming = await refusal(updateTeam(as("ada").db, as("ada").identity, other.id, { name: team.name }))
        const nearName = await refusal(createTeam(as("ada").db, as("ada").identity, { name: `${renamed.data.name}!` }))

        expect([creating.code, renaming.code]).toEqual(["conflict", "conflict"])
        expect([creating.details, renaming.details]).toEqual([{ reason: "slug_taken" }, { reason: "slug_taken" }])
        expect(nearName.details).toEqual({ reason: "name_taken" })
      })
    })

    describe("updateTeam (AC12)", () => {
      it("should rename a team, its slug unchanged, and refuse a name taken", async () => {
        const team = await newTeam("Logistique")
        const renamed = await updateTeam(as("ada").db, as("ada").identity, team.id, { name: `Logistique Nord ${hex(2)}` })
        expect(renamed.data).toMatchObject({ id: team.id, slug: team.slug })
        expect(renamed.target).toBe(team.slug)
        expect((await teamRow(team.slug))[0]?.name).toBe(renamed.data.name)

        const error = await refusal(updateTeam(as("ada").db, as("ada").identity, team.id, { name: "ventes" }))
        expect(error.details).toEqual({ reason: "name_taken" })
      })

      it("should name the lead by leadUserId: the new lead in the team as lead, the former one member", async () => {
        const team = await newTeam("Direction")
        await updateTeam(as("ada").db, as("ada").identity, team.id, { leadUserId: o.people.paul.id })
        await updateTeam(as("ada").db, as("ada").identity, team.id, { leadUserId: o.people.marc.id })
        // Ada, qui l'a créée, en était la responsable (E11-S10, AC-c1) : elle en reste membre.
        expect(await roles(team.id)).toEqual({ [o.people.ada.id]: "member", [o.people.paul.id]: "member", [o.people.marc.id]: "lead" })

        await updateTeam(as("ada").db, as("ada").identity, team.id, { leadUserId: null })
        expect((await teamRow(team.slug))[0]?.lead_user_id).toBeNull()
        expect(await roles(team.id)).toEqual({ [o.people.ada.id]: "member", [o.people.paul.id]: "member", [o.people.marc.id]: "member" })
      })

      it("should refuse a lead who is not a member of the organisation (invalid_arguments)", async () => {
        const team = await newTeam("Qualité")
        const outsider = await fx.createUser()
        const error = await refusal(updateTeam(as("ada").db, as("ada").identity, team.id, { leadUserId: outsider.id }))
        expect(error.code).toBe("invalid_arguments")
      })

    })

    describe("composition (AC13)", () => {
      it("should let the lead add a member of the organisation, idempotently, and remove them, idempotently too", async () => {
        const team = await fx.createTeam(o.org.id, { slug: `compo_${hex(3)}`, name: `Compo ${hex(3)}`, leadUserId: o.people.claire.id })
        // L'identité se résout à chaque requête, et le service lit la responsable dans ses équipes
        // (`leadsTeam`, E01-S07c) : celle de Claire, résolue avant qu'elle mène cette équipe, se relit.
        const claire = await resolveIdentity(as("claire").db, o.host, { userId: o.people.claire.id, email: o.people.claire.email })

        const added = await addTeamMember(as("claire").db, claire, team.id, { userId: o.people.marc.id })
        const again = await addTeamMember(as("claire").db, claire, team.id, { userId: o.people.marc.id })
        expect([added.data.added, again.data.added]).toEqual([true, false])
        expect(added).toMatchObject({ target: o.people.marc.email, teamId: team.id })
        expect(await roles(team.id)).toEqual({ [o.people.claire.id]: "lead", [o.people.marc.id]: "member" })

        const removed = await removeTeamMember(as("claire").db, claire, team.id, o.people.marc.id)
        const gone = await removeTeamMember(as("claire").db, claire, team.id, o.people.marc.id)
        expect([removed.data.removed, gone.data.removed]).toEqual([true, false])
        expect(await roles(team.id)).toEqual({ [o.people.claire.id]: "lead" })
      })

      it("should refuse someone outside the organisation (invalid_arguments)", async () => {
        const outsider = await fx.createUser()
        const error = await refusal(addTeamMember(as("ada").db, as("ada").identity, o.teams.ventes, { userId: outsider.id }))
        expect(error.code).toBe("invalid_arguments")
      })

      // E05-S13 (AC-22) : une équipe peut rester sans responsable ; l'administrateur retire un responsable.
      it("should let an administrator remove a lead from the team", async () => {
        const team = await fx.createTeam(o.org.id, { slug: `sans_${hex(3)}`, name: `Sans ${hex(3)}`, leadUserId: o.people.claire.id })
        const removed = await removeTeamMember(as("ada").db, as("ada").identity, team.id, o.people.claire.id)
        expect(removed.data.removed).toBe(true)
        expect(await roles(team.id)).toEqual({})
      })
    })

    describe("deleteTeam (AC14, H69)", () => {
      it("should refuse a team whose folder holds a page, naming the page, never the folder nor its Contexte", async () => {
        const team = await newTeam("Achats")
        const folder = await fx.nodeId(o.org.id, team.slug)
        await fx.createNode(o.org.id, { parentId: folder, path: `${team.slug}/notes`, title: "Notes" })
        const outside = `hors_${hex(3)}`
        await fx.createNode(o.org.id, { parentId: o.nodes.root, path: outside, title: "Hors", ownerKind: "team", ownerTeamId: team.id })

        const error = await refusal(deleteTeam(as("ada").db, as("ada").identity, team.id))

        expect(error.code).toBe("conflict")
        expect(error.details).toEqual({
          reason: "team_owns_objects",
          nodes: [outside, `${team.slug}/notes`].sort(),
          accounts: [],
          nodesTotal: 2,
          accountsTotal: 0,
        })
        expect(await teamRow(team.slug)).toHaveLength(1)
      })

      it("should refuse a team that owns an account, naming it", async () => {
        const team = await newTeam("Support Niveau 2")
        const label = `Mail ${hex(3)}`
        await fx.createAccount(o.org.id, { ownerKind: "team", ownerTeamId: team.id, label })

        const error = await refusal(deleteTeam(as("ada").db, as("ada").identity, team.id))

        expect(error.details).toMatchObject({ reason: "team_owns_objects", nodes: [], accounts: [label], accountsTotal: 1 })
      })

      it("should delete a team owning only its folder and Contexte: both go, its rules fall, default teams become none", async () => {
        const team = await newTeam("Événements")
        await fx.addTeamMember(team.id, o.people.marc.id)
        await fx.admin`update platform.members set default_team_id = ${team.id} where org_id = ${o.org.id} and user_id = ${o.people.marc.id}`
        await fx.addRule({ orgId: o.org.id, nodeId: o.nodes.ventes, teamId: team.id, level: "read" })

        const deleted = await deleteTeam(as("ada").db, as("ada").identity, team.id)

        expect(deleted).toMatchObject({ data: { id: team.id, slug: team.slug }, target: team.slug, teamId: null })
        expect(await teamRow(team.slug)).toEqual([])
        expect(await paths(team.slug)).toEqual([])
        expect(await fx.admin`select id from platform.access_rules where subject_team_id = ${team.id}`).toEqual([])
        const [marc] = await fx.admin<{ default_team_id: string | null }[]>`
          select default_team_id from platform.members where org_id = ${o.org.id} and user_id = ${o.people.marc.id}`
        expect(marc.default_team_id).toBeNull()
      })

      // 1.4.13 : des pages de l'équipe à la corbeille bloquaient sa suppression ; elles partent avec elle.
      it("should delete a team whose remaining pages are all in the trash, erasing them with the team and its Contexte", async () => {
        const team = await newTeam("Archives")
        const folder = await fx.nodeId(o.org.id, team.slug)
        const notes = await fx.createNode(o.org.id, { parentId: folder, path: `${team.slug}/notes`, title: "Notes" })
        await fx.createNode(o.org.id, { parentId: notes, path: `${team.slug}/notes/detail`, title: "Détail" })
        const outside = `hors_${hex(3)}`
        await fx.createNode(o.org.id, { parentId: o.nodes.root, path: outside, title: "Hors", ownerKind: "team", ownerTeamId: team.id })
        await fx.admin`update platform.nodes set deleted_at = now() - interval '1 day'
                        where org_id = ${o.org.id} and (path = ${outside} or starts_with(path, ${`${team.slug}/notes`}))`

        const deleted = await deleteTeam(as("ada").db, as("ada").identity, team.id)

        expect(deleted.data).toEqual({ id: team.id, slug: team.slug })
        expect(await teamRow(team.slug)).toEqual([])
        expect([...(await paths(team.slug)), ...(await paths(outside))]).toEqual([])
      })

      it("should still refuse a team that keeps a live page next to trashed ones, naming only the live page", async () => {
        const team = await newTeam("Achats bis")
        const folder = await fx.nodeId(o.org.id, team.slug)
        await fx.createNode(o.org.id, { parentId: folder, path: `${team.slug}/vivante`, title: "Vivante" })
        await fx.createNode(o.org.id, { parentId: folder, path: `${team.slug}/jetee`, title: "Jetée" })
        await fx.admin`update platform.nodes set deleted_at = now() where org_id = ${o.org.id} and path = ${`${team.slug}/jetee`}`

        const error = await refusal(deleteTeam(as("ada").db, as("ada").identity, team.id))

        expect(error.details).toMatchObject({ reason: "team_owns_objects", nodes: [`${team.slug}/vivante`], nodesTotal: 1 })
        expect(await paths(`${team.slug}/jetee`)).toEqual([`${team.slug}/jetee`])
      })
    })
  },
)
