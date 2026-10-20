// @vitest-environment node
// E05-S13, lot M, sur une base réelle portable (le job `bare-postgres` la joue) : plusieurs responsables par
// équipe (AC-22, fiche D128 point 13) — `team_members.role` seule source, lu par `node_level_of` et par
// l'identité dont dérivent les droits du service —, et les résumés générés des Contextes (AC-18, AC-19 ;
// textes par portée de D128). Sautée, la version nommée, tant que la migration n'est pas appliquée à la base.
import { randomUUID } from "crypto"
import fs from "fs"
import path from "path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { createAccount } from "../../packages/plateforme/server/connectors/accounts"
import { resolveIdentity, type Identity } from "../../packages/plateforme/server/identity"
import { invitationOptions } from "../../packages/plateforme/server/invitations"
import { journalScope } from "../../packages/plateforme/server/journal-read"
import { listNodeRules } from "../../packages/plateforme/server/rules"
import { addTeamMember, listTeams, removeTeamMember, setTeamMemberRole } from "../../packages/plateforme/server/teams"
import { planImport } from "../../scripts/lib/org-transfer-plan.mjs"
import { writePlan } from "../../scripts/org-import.mjs"
import { pendingMigrations, pendingReason } from "../helpers/pending-migrations"
import { hex, type ReferencePerson } from "../helpers/plateforme"
import { createSqlFixtures, spyDb, SQL_SKIP_REASON, sqlConfigured, sqlNodeLevel, writesOf, type SqlFixtures, type SqlReferenceOrg } from "../helpers/sql"

const VERSION = "20260929090000"
const pending = (await pendingMigrations()).includes(VERSION)
const SUITE = "several leads per team and generated Context summaries (E05-S13)"
const NAME = !sqlConfigured ? `${SUITE} (${SQL_SKIP_REASON})` : pending ? `${SUITE} (${pendingReason([VERSION])})` : SUITE

const SETUP_TIMEOUT = 180_000
const MIGRATION = path.resolve(__dirname, `../../packages/plateforme/migrations/${VERSION}_platform_e05s13.sql`)

const SUMMARIES = {
  everyone: "Ce que les assistants de tous les membres de l'organisation lisent à chaque conversation.",
  private: "Ce que votre assistant lit à chaque conversation ; vous seul le recevez.",
  team: (name: string) => `Ce que les assistants des membres de l'équipe ${name} lisent à chaque conversation.`,
  oldEveryone: "Mission, règles et ton de l'organisation, lus par les assistants de tous les membres à chaque conversation.",
  oldPrivate: "Ce que vos assistants lisent à chaque conversation : ton, signature, préférences.",
}

/** Les `update` des résumés tels que la migration les écrit, déclencheur de `updated_at` coupé puis remis. */
function summaryUpdates(): string {
  const text = fs.readFileSync(MIGRATION, "utf8")
  const enable = "ALTER TABLE platform.nodes ENABLE TRIGGER set_updated_at;"
  return text.slice(text.indexOf("ALTER TABLE platform.nodes DISABLE TRIGGER set_updated_at;"), text.indexOf(enable) + enable.length)
}

describe.skipIf(!sqlConfigured || pending)(NAME, { timeout: 60_000 }, () => {
  let fx: SqlFixtures
  let o: SqlReferenceOrg

  const db = (who: ReferencePerson) => fx.as(o.people[who])
  const identity = (who: ReferencePerson): Promise<Identity> =>
    resolveIdentity(db(who), o.host, { userId: o.people[who].id, email: o.people[who].email })
  const leadsOf = async (teamId: string) =>
    (await fx.admin<{ user_id: string }[]>`select user_id from platform.team_members where team_id = ${teamId} and role = 'lead' order by user_id`).map((row) => row.user_id)

  beforeAll(async () => {
    fx = createSqlFixtures()
    o = await fx.buildReferenceOrg()
  }, SETUP_TIMEOUT)

  afterAll(async () => {
    await fx?.cleanup()
  }, SETUP_TIMEOUT)

  describe("several leads (AC-22)", () => {
    it("should make A and B leads, each with the lead's rights, and removing B touch nothing of A", async () => {
      // Claire mène Ventes ; l'administratrice nomme Léa, déjà membre, responsable aussi.
      const named = await setTeamMemberRole(db("ada"), await identity("ada"), { teamId: o.teams.ventes, userId: o.people.lea.id }, { role: "lead" })
      expect(named).toEqual({ data: { teamId: o.teams.ventes, userId: o.people.lea.id, role: "lead" }, target: o.people.lea.email, teamId: o.teams.ventes })
      expect(await leadsOf(o.teams.ventes)).toEqual([o.people.claire.id, o.people.lea.id].sort())

      for (const lead of ["claire", "lea"] as const) {
        const who = await identity(lead)
        expect(who.teams.find((team) => team.id === o.teams.ventes)?.role, lead).toBe("lead")
        // Le niveau 3 sur un contenu de l'équipe, par `node_level_of` (base) ; le journal et les invitations de l'équipe (service).
        expect(await sqlNodeLevel(db(lead), o.nodes.devis), lead).toBe(3)
        expect(journalScope(who), lead).toMatchObject({ kind: "own", ledTeams: [{ id: o.teams.ventes, name: "Ventes" }] })
        expect((await invitationOptions(db(lead), who)).teams.map((team) => team.id), lead).toEqual([o.teams.ventes])
      }
      // Léa compose l'équipe et crée un compte de connecteur pour elle.
      expect((await addTeamMember(db("lea"), await identity("lea"), o.teams.ventes, { userId: o.people.marc.id })).data.added).toBe(true)
      const account = await createAccount(db("lea"), await identity("lea"), { connector: "mail", owner_kind: "team", team_id: o.teams.ventes, label: `Mail Ventes ${hex(3)}` })
      expect(account.label).toMatch(/^Mail Ventes /)

      // Retirer Léa des responsables, puis de l'équipe : Claire reste responsable, au niveau 3.
      await setTeamMemberRole(db("ada"), await identity("ada"), { teamId: o.teams.ventes, userId: o.people.lea.id }, { role: "member" })
      expect(await sqlNodeLevel(db("lea"), o.nodes.devis)).toBe(2)
      expect((await removeTeamMember(db("ada"), await identity("ada"), o.teams.ventes, o.people.lea.id)).data.removed).toBe(true)
      expect(await leadsOf(o.teams.ventes)).toEqual([o.people.claire.id])
      expect(await sqlNodeLevel(db("claire"), o.nodes.devis)).toBe(3)
      await addTeamMember(db("ada"), await identity("ada"), o.teams.ventes, { userId: o.people.lea.id })
      await removeTeamMember(db("ada"), await identity("ada"), o.teams.ventes, o.people.marc.id)
    })

    it("should name every lead in the teams view, and refuse a member or a lead naming one, before any write (forbidden)", async () => {
      await setTeamMemberRole(db("ada"), await identity("ada"), { teamId: o.teams.ventes, userId: o.people.lea.id }, { role: "lead" })
      try {
        const ventes = (await listTeams(db("marc"), await identity("marc"))).find((team) => team.id === o.teams.ventes)
        expect(ventes?.leadName).toBe("Claire Morel, Léa Roux")
        // Le panneau des règles les compte : le libellé en tire son pluriel (AC-23).
        expect((await listNodeRules(db("ada"), await identity("ada"), "ventes/devis")).owner).toEqual({
          kind: "team", teamId: o.teams.ventes, teamName: "Ventes", leadName: "Claire Morel, Léa Roux", leadCount: 2,
        })
        for (const who of ["marc", "claire"] as const) {
          const spied = spyDb(db(who))
          const refusal = await setTeamMemberRole(spied.db, await identity(who), { teamId: o.teams.ventes, userId: o.people.lea.id }, { role: "member" }).catch((error: unknown) => error)
          expect(refusal, who).toMatchObject({ code: "forbidden" })
          expect(spied.sent, who).toEqual([])
        }
        // Un responsable qui compose ne retire pas un autre responsable de l'équipe (HN-E05S13-20).
        const spied = spyDb(db("claire"))
        const refusal = await removeTeamMember(spied.db, await identity("claire"), o.teams.ventes, o.people.lea.id).catch((error: unknown) => error)
        expect(refusal).toMatchObject({ code: "forbidden" })
        expect(writesOf(spied.sent)).toEqual([])
        expect(await leadsOf(o.teams.ventes)).toEqual([o.people.claire.id, o.people.lea.id].sort())
      } finally {
        await fx.admin`update platform.team_members set role = 'member' where team_id = ${o.teams.ventes} and user_id = ${o.people.lea.id}`
      }
    })

    it("should refuse, as a conflict logged first, a lead removing a member named lead between the read and the delete", async () => {
      // La course (security-patterns.md § Idempotence et mutations concurrentes) : Claire, responsable, lit
      // Léa membre ; l'administratrice la nomme responsable juste avant la suppression.
      const log = vi.spyOn(console, "error").mockImplementation(() => {})
      const spied = spyDb(db("claire"), {
        before: async (query) => {
          if (query.op !== "delete" || query.target !== "team_members") return
          await fx.admin`update platform.team_members set role = 'lead' where team_id = ${o.teams.ventes} and user_id = ${o.people.lea.id}`
        },
      })
      try {
        const refusal = await removeTeamMember(spied.db, await identity("claire"), o.teams.ventes, o.people.lea.id).catch((error: unknown) => error)
        expect(refusal).toMatchObject({ code: "conflict" })
        expect(log).toHaveBeenCalledWith("[platform] removeTeamMember: no row written", o.teams.ventes)
        expect(await leadsOf(o.teams.ventes)).toEqual([o.people.claire.id, o.people.lea.id].sort())
      } finally {
        log.mockRestore()
        await fx.admin`insert into platform.team_members (team_id, user_id, role) values (${o.teams.ventes}, ${o.people.lea.id}, 'member')
                       on conflict (team_id, user_id) do update set role = 'member'`
      }
    })

    it("should say not_found for a person outside the team, and translate a legacy write of teams.lead_user_id into a lead", async () => {
      const refusal = await setTeamMemberRole(db("ada"), await identity("ada"), { teamId: o.teams.ventes, userId: o.people.marc.id }, { role: "lead" }).catch((error: unknown) => error)
      expect(refusal).toMatchObject({ code: "not_found" })
      // Outillage, ancien export : la personne devient responsable, les autres le restent, la colonne revient à null.
      await fx.admin`update platform.teams set lead_user_id = ${o.people.marc.id} where id = ${o.teams.ventes}`
      try {
        expect(await leadsOf(o.teams.ventes)).toEqual([o.people.claire.id, o.people.marc.id].sort())
        expect(await fx.admin`select lead_user_id from platform.teams where id = ${o.teams.ventes}`).toEqual([{ lead_user_id: null }])
      } finally {
        await fx.admin`delete from platform.team_members where team_id = ${o.teams.ventes} and user_id = ${o.people.marc.id}`
      }
    })
  })

  describe("an old export carrying teams.lead_user_id (AC-25)", () => {
    it("should import its lead as a team_members lead, the column left null", async () => {
      // Un fichier d'avant E05-S13 : Marc responsable par `lead_user_id`, membre de l'équipe par son rôle.
      const source = { org: randomUUID(), team: randomUUID() }
      const slug = `t${hex(4)}`
      const at = new Date().toISOString()
      const people = [o.people.lea, o.people.marc]
      const doc = {
        format: "oto-platform-org-export",
        version: 1,
        exported_at: at,
        source: { host: "legacy.example.invalid", org: { id: source.org, slug: "ancien", prefix: "ancien", name: "Ancien export" } },
        people: people.map((person) => ({ id: person.id, email: person.email })),
        tables: {
          orgs: [{ id: source.org, slug: "ancien", prefix: "ancien", name: "Ancien export", created_at: at, updated_at: at }],
          teams: [{ id: source.team, org_id: source.org, slug: "ventes", name: "Ventes", lead_user_id: o.people.marc.id, created_at: at }],
          members: people.map((person, index) => ({
            org_id: source.org, user_id: person.id, role: index === 0 ? "admin" : "member", profile: { handle: `${person.handle}${hex(2)}` }, created_at: at,
          })),
          team_members: people.map((person) => ({ team_id: source.team, user_id: person.id, role: "member", created_at: at })),
        },
      }
      const plan = planImport(doc, { people: new Map(people.map((person) => [person.id, person.id])), org: { slug, prefix: slug } })
      await writePlan(fx.admin, plan, { slug, domains: [] })
      const [{ id }] = await fx.admin<{ id: string }[]>`select id from platform.orgs where slug = ${slug}`
      fx.trackOrg(id)

      const teams = await fx.admin<{ lead_user_id: string | null; leads: string[] }[]>`
        select t.lead_user_id, array(select tm.user_id from platform.team_members tm where tm.team_id = t.id and tm.role = 'lead') as leads
          from platform.teams t where t.org_id = ${id}`
      expect(teams).toEqual([{ lead_user_id: null, leads: [o.people.marc.id] }])
    })
  })

  describe("generated summaries (AC-18, AC-19)", () => {
    it("should give the Contextes of a new organisation, team and member the summary of their scope", async () => {
      const staff = await fx.createUser({ fullName: "Sam Staff" })
      await fx.makeStaff(staff.id)
      const suffix = hex(4)
      const [{ id }] = await fx.as(staff).tx((sql) => sql<{ id: string }[]>`
        select platform.create_org(p_name => ${"Acme Résumés"}, p_slug => ${`t${suffix}`}, p_prefix => ${`t${suffix}`}, p_hosts => ${[`t${suffix}.example.invalid`]}::text[]) as id`)
      fx.trackOrg(id)
      await fx.createTeam(id, { slug: "achats", name: "Achats" })
      const member = await fx.createUser({ fullName: "Nina Neuve" })
      await fx.addMember(id, member.id, { profile: { handle: "nina" } })

      const summaries = await fx.admin<{ path: string; summary: string }[]>`
        select path, summary from platform.nodes where org_id = ${id} and kind = 'context' order by path`
      expect(summaries).toEqual([
        { path: "achats/contexte", summary: SUMMARIES.team("Achats") },
        { path: "contexte", summary: SUMMARIES.everyone },
        { path: "private/nina/contexte", summary: SUMMARIES.private },
      ])
    })

    it("should replace the summaries still word for word the old generated text, keep a written one and their updated_at", async () => {
      const paths = ["contexte", "private/claire/contexte", "private/lea/contexte"]
      // Une date passée, posée déclencheur coupé : la transaction a un seul `now()`, la date d'une ligne
      // qu'un déclencheur remet à jour ne s'en distinguerait pas.
      const PAST = new Date("2026-01-02T03:04:05.000Z")
      // Les `update` de la migration touchent toute la base : joués dans une transaction annulée à la fin.
      const ROLLBACK = new Error("rollback")
      let after: { path: string; summary: string; updated_at: Date }[] = []
      await fx.admin
        .begin(async (tx) => {
          const prepare = async (path: string, summary: string) =>
            tx`update platform.nodes set summary = ${summary}, updated_at = ${PAST} where org_id = ${o.org.id} and path = ${path}`
          await tx`ALTER TABLE platform.nodes DISABLE TRIGGER set_updated_at`
          await prepare("contexte", SUMMARIES.oldEveryone)
          await prepare("private/claire/contexte", SUMMARIES.oldPrivate)
          await prepare("private/lea/contexte", "Mon ton, ma signature.")
          await tx`ALTER TABLE platform.nodes ENABLE TRIGGER set_updated_at`
          await tx.unsafe(summaryUpdates())
          after = await tx<{ path: string; summary: string; updated_at: Date }[]>`
            select path, summary, updated_at from platform.nodes where org_id = ${o.org.id} and path in ${tx(paths)} order by path`
          throw ROLLBACK
        })
        .catch((error: unknown) => {
          if (error !== ROLLBACK) throw error
        })
      expect(after).toEqual([
        { path: "contexte", summary: SUMMARIES.everyone, updated_at: PAST },
        { path: "private/claire/contexte", summary: SUMMARIES.private, updated_at: PAST },
        { path: "private/lea/contexte", summary: "Mon ton, ma signature.", updated_at: PAST },
      ])
    })
  })
})
