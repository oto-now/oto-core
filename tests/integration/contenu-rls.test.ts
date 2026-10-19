// @vitest-environment node
// Alias, retours, connecteurs, boîte d'envoi du simulé, journal et comptes (E01-S06 : AC21, AC29 à
// AC32), sous la session de chaque personne ; B est une seconde organisation jetable. Depuis E01-S08, la
// RLS n'isole que les organisations : les cas qui prouvaient un niveau ou un rôle par une policy (alias,
// tickets et boîte d'envoi cachés, activations par l'admin seul) sont retirés (HN-E01S08-9) ;
// déclencheurs, invariants et privilèges restent. Suite portable depuis E01-S10 f2 : données semées par
// la connexion d'administration, chaque personne par sa session (`fx.as`), sans PostgREST ni Supabase
// Auth ; le job `bare-postgres` la joue.
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { PlatformDb } from "../../packages/plateforme/server/db"
import { hex, type ReferencePerson, type TestOrg } from "../helpers/plateforme"
import { codeOf, createSqlFixtures, SQL_SKIP_REASON, sqlConfigured, type SqlFixtures, type SqlReferenceOrg } from "../helpers/sql"
import { privateFolderPending, privateFolderSuite } from "../helpers/pending-migrations"

// Ces tests supposent le dossier `private` en base (fiche D107) : sautés, la version nommée, tant que
// 20260928120000 n'est pas appliquée au projet (`database-patterns.md § Règles`).
const privatePending = await privateFolderPending()

const NETWORK_TIMEOUT = 60_000
const SETUP_TIMEOUT = 180_000
const SUITE = "aliases, feedback, connectors, simulated outbox"

describe.skipIf(!sqlConfigured || privatePending)(privateFolderSuite(sqlConfigured ? SUITE : `${SUITE} (${SQL_SKIP_REASON})`, privatePending), { timeout: NETWORK_TIMEOUT }, () => {
  let fx: SqlFixtures
  let o: SqlReferenceOrg
  let b: TestOrg

  const as = (who: ReferencePerson): PlatformDb => fx.as(o.people[who])

  beforeAll(async () => {
    fx = createSqlFixtures()
    o = await fx.buildReferenceOrg()
    b = await fx.createOrg()
  }, SETUP_TIMEOUT)

  afterAll(async () => {
    await fx?.cleanup()
  }, SETUP_TIMEOUT)

  describe("aliases written by the database (AC21)", () => {
    /** `ventes/archives_x`, `ventes/dossier_x`, ses enfants `modele` et `confidentiel` (Claire → none). */
    async function subtree() {
      const tag = hex(3)
      const archives = await fx.createNode(o.org.id, { parentId: o.nodes.ventes, path: `ventes/archives_${tag}`, title: "Archives" })
      const dossier = await fx.createNode(o.org.id, { parentId: o.nodes.ventes, path: `ventes/dossier_${tag}`, title: "Dossier" })
      const modele = await fx.createNode(o.org.id, { parentId: dossier, path: `ventes/dossier_${tag}/modele`, title: "Modèle" })
      const confidentiel = await fx.createNode(o.org.id, { parentId: dossier, path: `ventes/dossier_${tag}/confidentiel`, title: "Confidentiel" })
      await fx.addRule({ orgId: o.org.id, nodeId: confidentiel, userId: o.people.claire.id, level: "none" })
      return { tag, archives, dossier, modele, confidentiel }
    }

    const move = (who: ReferencePerson, id: string, parentId: string, path: string) =>
      as(who).tx((sql) => sql`update platform.nodes set parent_id = ${parentId}, path = ${path} where id = ${id} returning id`)

    const aliasSelect = (ids: string[]) => fx.admin`
      select old_path, node_id, created_by from platform.node_aliases where node_id in ${fx.admin(ids)} order by old_path`
    const aliasesAs = (who: ReferencePerson, ids: string[]) =>
      as(who).tx((sql) => sql`select old_path, node_id, created_by from platform.node_aliases where node_id in ${sql(ids)} order by old_path`)

    it("should write an alias for the moved node and each descendant, the one Claire cannot read included", async () => {
      const t = await subtree()
      expect(await codeOf(move("claire", t.dossier, t.archives, `ventes/archives_${t.tag}/dossier_${t.tag}`))).toBeNull()
      const ids = [t.dossier, t.modele, t.confidentiel]
      expect(await aliasSelect(ids)).toEqual([
        { old_path: `ventes/dossier_${t.tag}`, node_id: t.dossier, created_by: o.people.claire.id },
        { old_path: `ventes/dossier_${t.tag}/confidentiel`, node_id: t.confidentiel, created_by: o.people.claire.id },
        { old_path: `ventes/dossier_${t.tag}/modele`, node_id: t.modele, created_by: o.people.claire.id },
      ])
      expect(await aliasesAs("ada", ids)).toHaveLength(3)
      const written = as("ada").tx((sql) => sql`insert into platform.node_aliases (org_id, old_path, node_id) values (${o.org.id}, 'ventes/x', ${t.dossier})`)
      expect(await codeOf(written)).toBe("42501")
    })

    // Tâche M02 (H58, qui l'emporte sur N33 d'E01-S06) : l'ancien chemin d'un nœud reste le sien. Un
    // nœud nouveau, créé ou déplacé, n'y est pas admis ; seul le nœud à qui l'alias appartient le
    // reprend (cas suivant). La création part avec le déplacement, par la connexion d'administration
    // (sans le verrou de l'arbre) : dans l'un ou l'autre ordre, l'index unique des chemins la fait
    // attendre ou la refuse (database-patterns.md § Transactions).
    it("should refuse a new node, created or moved, on the former path of another node (23505), keeping the alias", async () => {
      const t = await subtree()
      const other = await fx.createNode(o.org.id, { parentId: o.nodes.ventes, path: `ventes/autre_${t.tag}`, title: "Autre" })
      const [left, created] = await Promise.all([
        codeOf(move("claire", t.dossier, t.archives, `ventes/archives_${t.tag}/dossier_${t.tag}`)),
        codeOf(fx.admin`
          insert into platform.nodes (org_id, parent_id, path, title, summary)
          values (${o.org.id}, ${o.nodes.ventes}, ${`ventes/dossier_${t.tag}`}, 'Nouveau dossier', 'Nouveau.') returning id`),
      ])
      const moved = await codeOf(move("claire", other, o.nodes.ventes, `ventes/dossier_${t.tag}`))
      expect([left, created, moved]).toEqual([null, "23505", "23505"])
      expect((await aliasSelect([t.dossier])).map((alias) => alias.old_path)).toEqual([`ventes/dossier_${t.tag}`])
    })

    it("should swap the alias when a node returns to its former path", async () => {
      const t = await subtree()
      await move("claire", t.dossier, t.archives, `ventes/archives_${t.tag}/dossier_${t.tag}`)
      await move("claire", t.dossier, o.nodes.ventes, `ventes/dossier_${t.tag}`)
      expect((await aliasSelect([t.dossier])).map((alias) => alias.old_path)).toEqual([`ventes/archives_${t.tag}/dossier_${t.tag}`])
    })
  })

  describe("feedback (AC29)", () => {
    const ticket = (who: ReferencePerson, orgId: string, extra: { state?: string; resolution?: string } = {}) =>
      as(who).tx(
        (sql) => sql<{ id: string; number: number; user_id: string; state: string }[]>`
          insert into platform.feedback ${sql({ org_id: orgId, user_id: o.people[who].id, type: "gap", text: `Il manque une page ${hex(2)}.`, number: 0, ...extra })}
          returning id, number, user_id, state`,
      )

    it("should refuse declining without a reason (23514), and filing a ticket already handled (42501)", async () => {
      const [row] = await ticket("lea", o.org.id)
      for (const resolution of [null, "   "]) {
        const declined = as("ada").tx((sql) => sql`update platform.feedback set state = 'declined', resolution = ${resolution} where id = ${row.id} returning id`)
        expect(await codeOf(declined), String(resolution)).toBe("23514")
      }
      expect(await codeOf(ticket("lea", o.org.id, { state: "resolved" }))).toBe("42501")
      expect(await codeOf(ticket("lea", o.org.id, { resolution: "Fait." }))).toBe("42501")
    })

    it("should number tickets per organisation, simultaneous ones distinctly, ignoring a given number", async () => {
      const first = await fx.createOrg()
      const second = await fx.createOrg()
      const file = async (orgId: string, number = 0) =>
        (await fx.admin<{ number: number }[]>`
          insert into platform.feedback (org_id, type, text, number) values (${orgId}, 'friction', 'Lent.', ${number}) returning number`)[0].number
      const numbers = []
      for (let index = 0; index < 3; index++) numbers.push(await file(first.id, 99))
      expect(numbers).toEqual([1, 2, 3])
      expect(await file(second.id)).toBe(1)
      const together = await Promise.all([file(first.id), file(first.id)])
      expect(together.sort()).toEqual([4, 5])
    })
  })

  describe("connector activations (AC30)", () => {
    const activate = (who: ReferencePerson, connector: string) =>
      as(who).tx(
        (sql) => sql`insert into platform.connector_activations (org_id, connector, activated_by) values (${o.org.id}, ${connector}, ${o.people[who].id}) returning connector, state`,
      )

    it("should refuse a second activation of a connector (23505) and a malformed name (23514)", async () => {
      // Un connecteur connu de la table des connecteurs (clé étrangère), qu'aucun autre cas de la suite n'active.
      const connector = "notion"
      await fx.addActivation(o.org.id, connector)
      expect(await codeOf(activate("ada", connector))).toBe("23505")
      // Un nom malformé suffit à prouver la contrainte (M11b).
      expect(await codeOf(activate("ada", "Mail"))).toBe("23514")
    })
  })

  describe("simulated outbox (AC31)", () => {
    let account: string

    beforeAll(async () => {
      account = await fx.createAccount(o.org.id, { ownerKind: "team", ownerTeamId: o.teams.ventes, label: "Mail Ventes" })
    }, SETUP_TIMEOUT)

    const draft = () =>
      as("lea").tx(
        (sql) => sql<{ id: string; status: string; created_by: string }[]>`
          insert into platform.sim_outbox (org_id, account_id, connector, function, payload, created_by)
          values (${o.org.id}, ${account}, 'mail', 'mail.create_draft', ${sql.json({ to: "x@y.test" })}, ${o.people.lea.id})
          returning id, status, created_by`,
      )
    const updateAsLea = (id: string, values: Record<string, unknown>) =>
      as("lea").tx((sql) => sql`update platform.sim_outbox set ${sql(values)} where id = ${id} returning status, sent_by`)

    it("should let Léa create a draft and send it herself", async () => {
      const [created] = await draft()
      expect(created.id).toMatch(/^sim_[0-9a-f]{8}$/)
      expect(created).toMatchObject({ status: "draft", created_by: o.people.lea.id })
      const sent = await updateAsLea(created.id, { status: "sent", sent_by: o.people.lea.id, sent_at: new Date() })
      expect(sent).toEqual([{ status: "sent", sent_by: o.people.lea.id }])
    })

    it("should refuse sending in someone else's name (42501), without a date (23514), or changing another column (42501)", async () => {
      const [created] = await draft()
      expect(await codeOf(updateAsLea(created.id, { status: "sent", sent_by: o.people.claire.id, sent_at: new Date() }))).toBe("42501")
      expect(await codeOf(updateAsLea(created.id, { status: "sent" }))).toBe("23514")
      const payload = as("lea").tx((sql) => sql`update platform.sim_outbox set payload = ${sql.json({ to: "z@y.test" })} where id = ${created.id} returning id`)
      expect(await codeOf(payload)).toBe("42501")
    })
  })

  describe("journal and accounts (AC32)", () => {
    it("should keep account_id on a journal line, set to null when the account is deleted", async () => {
      const account = await fx.createAccount(o.org.id, { ownerKind: "team", ownerTeamId: o.teams.ventes, label: `Mail journal ${hex(3)}` })
      const [line] = await as("lea").tx(
        (sql) => sql<{ id: string; account_id: string | null }[]>`
          insert into platform.journal (org_id, user_id, method, tool, account_id) values (${o.org.id}, ${o.people.lea.id}, 'tools/call', 'call', ${account})
          returning id, account_id`,
      )
      expect(line.account_id).toBe(account)
      // Un compte ne se supprime sous aucune session, administratrice comprise (20261019140000) : l'outillage le fait.
      expect(await codeOf(as("ada").tx((sql) => sql`delete from platform.accounts where id = ${account} returning id`))).toBe("42501")
      expect(await fx.admin`delete from platform.accounts where id = ${account} returning id`).toEqual([{ id: account }])
      expect(await fx.admin`select account_id from platform.journal where id = ${line.id}`).toEqual([{ account_id: null }])
    })

    it("should refuse a second account of the organisation with the same label in any case (23505), not in another organisation", async () => {
      const label = `Mail Unique ${hex(3)}`
      await fx.createAccount(o.org.id, { ownerKind: "org", label })
      const duplicate = fx.admin`
        insert into platform.accounts (org_id, connector, owner_kind, label, mode) values (${o.org.id}, 'mail', 'org', ${label.toLowerCase()}, 'simule')`
      expect(await codeOf(duplicate)).toBe("23505")
      await fx.createAccount(b.id, { ownerKind: "org", label })
    })
  })
})
