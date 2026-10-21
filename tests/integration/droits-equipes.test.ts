// @vitest-environment node
// Équipes et membres (E01-S04 : AC8, AC9, AC20, AC27) : écritures sous la session d'Ada (admin), de
// Claire ou de Léa, état relu par la connexion d'administration. Reçoit les écritures de comptes de
// `droits-comptes-journal.test.ts` (AC15, M11b), même organisation de référence. La suppression en
// cascade d'une organisation dont les équipes ont des nœuds est jouée par `fx.cleanup()` de chaque
// fichier, qui lève sur un échec. Suite portable depuis E01-S10 f2 : chaque personne par sa session
// (`fx.as`), sans PostgREST ni Supabase Auth ; le job `bare-postgres` la joue.
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { PlatformDb } from "../../packages/plateforme/server/db"
import { codeOf, createSqlFixtures, SQL_SKIP_REASON, sqlConfigured, sqlNodeLevel, type SqlFixtures, type SqlReferenceOrg } from "../helpers/sql"
import { privateFolderPending, privateFolderSuite } from "../helpers/pending-migrations"

// Ces tests supposent le dossier `private` en base (fiche D107) : sautés, la version nommée, tant que
// 20260928120000 n'est pas appliquée au projet (`database-patterns.md § Règles`).
const privatePending = await privateFolderPending()

const NETWORK_TIMEOUT = 60_000
const SETUP_TIMEOUT = 180_000
const SUITE = "teams and members"

describe.skipIf(!sqlConfigured || privatePending)(privateFolderSuite(sqlConfigured ? SUITE : `${SUITE} (${SQL_SKIP_REASON})`, privatePending), { timeout: NETWORK_TIMEOUT }, () => {
  let fx: SqlFixtures
  let o: SqlReferenceOrg

  const as = (who: "ada" | "claire" | "lea"): PlatformDb => fx.as(o.people[who])

  // Le nœud et son sous-arbre seulement : `achats%` ne doit pas ramener `achats_b`, qu'un autre cas
  // a pu créer avant (l'ordre des cas ne compte pas).
  const paths = async (orgId: string, root: string) =>
    (await fx.admin<{ path: string }[]>`select path from platform.nodes where org_id = ${orgId} and path like ${`${root}%`} order by path`)
      .map((row) => row.path)
      .filter((path) => path === root || path.startsWith(`${root}/`))

  const teamExists = async (id: string) => (await fx.admin`select id from platform.teams where id = ${id}`).length === 1

  beforeAll(async () => {
    fx = createSqlFixtures()
    o = await fx.buildReferenceOrg()
  }, SETUP_TIMEOUT)

  afterAll(async () => {
    await fx?.cleanup()
  }, SETUP_TIMEOUT)

  // E05-S13 (fiche D128) : `team_members.role` est la seule source des responsables, une équipe en a plusieurs.
  describe("lead and membership (AC20 ; E05-S13, AC-22)", () => {
    it("should turn a legacy write of lead_user_id into one more lead, the former staying, the column back to null", async () => {
      await as("ada").tx((sql) => sql`update platform.teams set lead_user_id = ${o.people.lea.id} where id = ${o.teams.support} returning id`)
      const rows = await fx.admin<{ user_id: string; role: string }[]>`
        select user_id, role from platform.team_members where team_id = ${o.teams.support} and user_id in ${fx.admin([o.people.lea.id, o.people.paul.id])}`
      expect([...rows].sort((a, b) => a.user_id.localeCompare(b.user_id))).toEqual(
        [
          { user_id: o.people.lea.id, role: "lead" },
          { user_id: o.people.paul.id, role: "lead" },
        ].sort((a, b) => a.user_id.localeCompare(b.user_id)),
      )
      expect(await fx.admin`select lead_user_id from platform.teams where id = ${o.teams.support}`).toEqual([{ lead_user_id: null }])
    })

    it("should refuse a lead who is not a member of the organisation (23503)", async () => {
      const outsider = await fx.createUser()
      const named = as("ada").tx((sql) => sql`update platform.teams set lead_user_id = ${outsider.id} where id = ${o.teams.support} returning id`)
      expect(await codeOf(named)).toBe("23503")
    })

    it("should keep the role written on a team_members row, the only source of the lead", async () => {
      const roleOf = async () =>
        (await fx.admin<{ role: string }[]>`select role from platform.team_members where team_id = ${o.teams.support} and user_id = ${o.people.marc.id}`)[0].role
      await fx.admin`insert into platform.team_members (team_id, user_id, role) values (${o.teams.support}, ${o.people.marc.id}, 'lead')`
      expect(await roleOf()).toBe("lead")
      await fx.admin`update platform.team_members set role = 'member' where team_id = ${o.teams.support} and user_id = ${o.people.marc.id}`
      expect(await roleOf()).toBe("member")
      await fx.admin`delete from platform.team_members where team_id = ${o.teams.support} and user_id = ${o.people.marc.id}`
    })

    it("should refuse adding to a team someone outside the organisation (42501)", async () => {
      const outsider = await fx.createUser()
      const added = as("ada").tx((sql) => sql`insert into platform.team_members (team_id, user_id) values (${o.teams.support}, ${outsider.id})`)
      expect(await codeOf(added)).toBe("42501")
    })

    // Revue d'E01-S04 : la mise à jour d'une ligne `team_members` suit la règle de l'insertion
    // (migration 20260924120200, hypothèse N31).
    it("should let the admin rewrite a team_members row to a member of the organisation only (42501)", async () => {
      const outsider = await fx.createUser()
      await fx.addTeamMember(o.teams.ventes, o.people.marc.id)
      const row = (user: string) =>
        as("ada").tx(
          (sql) => sql`update platform.team_members set user_id = ${user} where team_id = ${o.teams.ventes} and user_id = ${o.people.marc.id} returning user_id`,
        )
      expect(await codeOf(row(outsider.id))).toBe("42501")
      expect(await fx.admin`select user_id from platform.team_members where team_id = ${o.teams.ventes} and user_id = ${o.people.marc.id}`).toHaveLength(1)
      expect(await row(o.people.paul.id)).toEqual([{ user_id: o.people.paul.id }])
      await fx.admin`delete from platform.team_members where team_id = ${o.teams.ventes} and user_id = ${o.people.paul.id}`
    })

    // Tâche M02 (revue d'E01-S04) : `teams_lead_sync` lisait l'appartenance du responsable sans
    // verrou ; nommer X responsable pendant que X est retiré passait des deux côtés
    // (database-patterns.md § Transactions). Une organisation jetable, une paire par personne.
    it("should never leave a lead outside the organisation when naming and removal cross", async () => {
      const pairs = 8
      const q = await fx.createOrg()
      await fx.addMember(q.id, o.people.ada.id, { role: "admin" })
      const people = await Promise.all(Array.from({ length: pairs }, () => fx.createUser()))
      await Promise.all(people.map((person) => fx.addMember(q.id, person.id)))
      const teams = await Promise.all(people.map((_, index) => fx.createTeam(q.id, { slug: `equipe_${index}` })))

      const codes = await Promise.all(
        people.flatMap((person, index) => [
          codeOf(as("ada").tx((sql) => sql`update platform.teams set lead_user_id = ${person.id} where id = ${teams[index].id}`)),
          codeOf(as("ada").tx((sql) => sql`delete from platform.members where org_id = ${q.id} and user_id = ${person.id}`)),
        ]),
      )

      expect(codes.filter((code) => code !== null && code !== "23503")).toEqual([])
      const members = new Set((await fx.admin<{ user_id: string }[]>`select user_id from platform.members where org_id = ${q.id}`).map((row) => row.user_id))
      const leads = await fx.admin<{ lead_user_id: string | null }[]>`select lead_user_id from platform.teams where org_id = ${q.id}`
      const rows = await fx.admin<{ user_id: string }[]>`select user_id from platform.team_members where team_id in ${fx.admin(teams.map((team) => team.id))}`
      expect({
        leads: leads.flatMap(({ lead_user_id }) => (lead_user_id !== null && !members.has(lead_user_id) ? [lead_user_id] : [])),
        rows: rows.flatMap(({ user_id }) => (members.has(user_id) ? [] : [user_id])),
      }).toEqual({ leads: [], rows: [] })
    })
  })

  describe("deleting a team that owns nodes (AC8, AC27)", () => {
    /**
     * Une équipe du cas, comme Support dans AC8 : son dossier (né par déclencheur, P39) contient
     * son Contexte et une page, et une règle de `ventes` la vise. Chaque cas supprime la sienne :
     * Support, que les autres cas lisent, reste en place quel que soit l'ordre.
     */
    async function teamWithPage(slug: string) {
      const team = await fx.createTeam(o.org.id, { slug, name: slug, leadUserId: o.people.paul.id })
      const folder = await fx.nodeId(o.org.id, slug)
      await fx.createNode(o.org.id, { parentId: folder, path: `${slug}/faq`, title: "FAQ" })
      await fx.addRule({ orgId: o.org.id, nodeId: o.nodes.ventes, teamId: team.id, level: "read" })
      return { team: team.id, folder, contexte: await fx.nodeId(o.org.id, `${slug}/contexte`) }
    }

    const deleteTeam = (id: string) => as("ada").tx((sql) => sql`delete from platform.teams where id = ${id} returning id`)
    const rulesOfTeam = (id: string) => fx.admin`select id from platform.access_rules where subject_team_id = ${id}`

    it("should refuse deleting a team that owns a folder with pages, at commit (23503), changing nothing", async () => {
      const sav = await teamWithPage("sav")
      expect(await codeOf(deleteTeam(sav.team))).toBe("23503")
      expect(await teamExists(sav.team)).toBe(true)
      expect(await rulesOfTeam(sav.team)).toHaveLength(1)
      expect(await paths(o.org.id, "sav")).toEqual(["sav", "sav/contexte", "sav/faq"])
    })

    it("should delete the team once its folder passed to the organisation, its rules with it, keeping the former Contexte", async () => {
      const logistique = await teamWithPage("logistique")
      await as("ada").tx((sql) => sql`update platform.nodes set owner_kind = 'org', owner_team_id = null where id = ${logistique.folder} returning id`)
      expect(await deleteTeam(logistique.team)).toHaveLength(1)
      expect(await rulesOfTeam(logistique.team)).toEqual([])
      expect(await paths(o.org.id, "logistique")).toEqual(["logistique", "logistique/contexte", "logistique/faq"])
      const [contexte] = await as("ada").tx(
        (sql) => sql<{ is_context: boolean }[]>`select platform.is_context_path(${o.org.id}, 'logistique/contexte') as is_context`,
      )
      expect(contexte.is_context).toBe(false)
      const owner = await as("ada").tx((sql) => sql`select * from platform.node_owner(${logistique.contexte})`)
      expect(owner[0]).toMatchObject({ owner_kind: "org", owner_node_id: logistique.folder })
    })

    it("should delete a team whose folder holds only its Contexte, with both nodes and their rules", async () => {
      const [conseil] = await as("ada").tx(
        (sql) => sql<{ id: string }[]>`insert into platform.teams (org_id, slug, name) values (${o.org.id}, 'conseil', 'Conseil') returning id`,
      )
      const contexte = await fx.nodeId(o.org.id, "conseil/contexte")
      await fx.addRule({ orgId: o.org.id, nodeId: contexte, teamId: o.teams.ventes, level: "read" })
      expect(await codeOf(deleteTeam(conseil.id))).toBeNull()
      expect(await teamExists(conseil.id)).toBe(false)
      expect(await paths(o.org.id, "conseil")).toEqual([])
      expect(await fx.admin`select id from platform.access_rules where node_id = ${contexte}`).toEqual([])
    })

    // Une autre page du dossier : même règle que « should refuse deleting a team that owns a folder
    // with pages » ci-dessus, cas retiré (M11b) ; reste la sous-page du Contexte.
    it("should refuse deleting a team whose folder holds a subpage of its Contexte, at commit (23503)", async () => {
      const slug = "achats_b"
      const [team] = await as("ada").tx(
        (sql) => sql<{ id: string }[]>`insert into platform.teams (org_id, slug, name) values (${o.org.id}, ${slug}, ${slug}) returning id`,
      )
      await fx.createNode(o.org.id, { parentId: await fx.nodeId(o.org.id, `${slug}/contexte`), path: `${slug}/contexte/tarifs` })
      const before = await paths(o.org.id, slug)

      expect(await codeOf(deleteTeam(team.id))).toBe("23503")
      expect(await teamExists(team.id)).toBe(true)
      expect(await paths(o.org.id, slug)).toEqual(before)
      expect(before).toHaveLength(3)
    })
  })

  describe("removing a member (AC9)", () => {
    it("should cut the member at her next request and clean her teams, rules and lead role in the same transaction", async () => {
      const r = await fx.buildReferenceOrg(o.people)
      const led = await fx.createTeam(r.org.id, { slug: "equipe_e", name: "Équipe E", leadUserId: o.people.lea.id })
      await fx.addRule({ orgId: r.org.id, nodeId: r.nodes.faq, userId: o.people.lea.id, level: "read" })
      expect(await as("lea").tx((sql) => sql`select id from platform.orgs where id = ${r.org.id}`)).toHaveLength(1)

      const removed = await as("ada").tx(
        (sql) => sql`delete from platform.members where org_id = ${r.org.id} and user_id = ${o.people.lea.id} returning user_id`,
      )
      expect(removed).toHaveLength(1)

      const after = await Promise.all([
        as("lea").tx((sql) => sql`select id from platform.orgs where id = ${r.org.id}`),
        as("lea").tx((sql) => sql`select id from platform.nodes where org_id = ${r.org.id}`),
        as("lea").tx((sql) => sql`select id from platform.teams where org_id = ${r.org.id}`),
      ])
      expect(after.map((rows) => [...rows])).toEqual([[], [], []])
      const teamIds = [r.teams.ventes, r.teams.support, led.id]
      expect(await fx.admin`select team_id from platform.team_members where user_id = ${o.people.lea.id} and team_id in ${fx.admin(teamIds)}`).toEqual([])
      expect(await fx.admin`select id from platform.access_rules where org_id = ${r.org.id} and subject_user_id = ${o.people.lea.id}`).toEqual([])
      expect(await fx.admin`select lead_user_id from platform.teams where id = ${led.id}`).toEqual([{ lead_user_id: null }])
      expect(await paths(r.org.id, "private/lea")).toEqual(["private/lea", "private/lea/contexte"])
      expect(await sqlNodeLevel(as("ada"), r.spaces.lea)).toBe(0)
    })
  })

  // Repris de `droits-comptes-journal.test.ts` (M11b) : le privilège de colonne reste en base. Qui rend
  // personnel un compte est décidé par le service depuis E01-S12 partie c (la garde des comptes
  // retirée, ADR-012 § 3). Les niveaux d'un compte sont prouvés par le calcul pur (`tests/unit/access-levels.test.ts`
  // AC8), le refus de `select *` par `platform-rls.test.ts`.
  describe("account writes (AC15)", () => {
    // Un compte ne change pas d'organisation par l'API (migration 20260924120200 : mise à jour
    // accordée colonne par colonne, sans `org_id` ; hypothèse N30).
    const ownerOf = async (id: string) =>
      (await fx.admin`select org_id, owner_kind, owner_team_id, owner_user_id from platform.accounts where id = ${id}`)[0]

    it("should refuse moving an account to another organisation, even one its owner belongs to (42501)", async () => {
      const elsewhere = await fx.createOrg()
      await fx.addMember(elsewhere.id, o.people.lea.id)
      const own = await fx.createAccount(o.org.id, { ownerKind: "user", ownerUserId: o.people.lea.id, label: "Mail Léa voyage" })
      const update = as("lea").tx((sql) => sql`update platform.accounts set org_id = ${elsewhere.id} where id = ${own} returning id`)
      expect(await codeOf(update)).toBe("42501")
      expect(await ownerOf(own)).toMatchObject({ org_id: o.org.id })
    })
  })
})
