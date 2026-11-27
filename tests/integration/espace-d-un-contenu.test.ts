// @vitest-environment node
// L'espace d'un contenu (droits d'accès, § Propriétaires, déplacements, personnel ; règle de JB du 27/11, qui remplace
// la fiche D18 B) : changer le propriétaire d'un nœud exige de le gérer et d'écrire dans l'espace qui le reçoit. Tout le
// monde : l'écriture sur la racine ; une autre équipe : l'écriture sur son dossier ; son propre Privé : toujours ; le
// Privé d'une autre personne : jamais ; `inherit` : l'écriture sur le parent. Le service (`transferOwner`, celui
// d'`admin_node transfer_owner`) refuse avant toute écriture ; la base (`nodes_gesture_guard`, `20261127150000`) juge
// la même règle sous la session de la personne et sous celle du serveur. Deux organisations O : l'une sans règle (Tout
// le monde en lecture), l'autre où Tout le monde est en « Peut modifier » et où Claire écrit dans le dossier Support.
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { transferOwner } from "../../packages/plateforme/server/admin/nodes"
import type { Tx } from "../../packages/plateforme/server/sql"
import { pendingMigrations, pendingReason } from "../helpers/pending-migrations"
import { TEAMS, type Person } from "../helpers/reference-org"
import { seedReferenceOrg, type ReferenceOrgSql } from "../helpers/reference-org-sql"
import { asCaller, failureOf, seedWithAdmin, spyDb, SQL_SKIP_REASON, sqlConfigured, writesOf, type SeededData } from "../helpers/sql"

const VERSION = "20261127150000"
const pending = (await pendingMigrations()).includes(VERSION)

const SETUP_TIMEOUT = 180_000
const NETWORK_TIMEOUT = 60_000
const SUITE = "the space of a content: managing it and writing in the destination"
const suite = !sqlConfigured ? `${SUITE} (${SQL_SKIP_REASON})` : pending ? `${SUITE} (${pendingReason([VERSION])})` : SUITE

/** Les deux sessions d'une personne : la sienne, et celle du serveur, aux mêmes claims. */
const SESSIONS = [undefined, "server"] as const

/** Le refus du déclencheur des gestes d'un nœud. */
const GUARD = "guard"

const tag = () => Math.random().toString(16).slice(2, 8)

type OwnerSeed = { kind: "team"; team: keyof typeof TEAMS } | { kind: "user"; person: Person }

describe.skipIf(!sqlConfigured || pending)(suite, { timeout: NETWORK_TIMEOUT }, () => {
  let seed: SeededData
  /** O sans règle : chaque membre lit Tout le monde, l'administratrice le gère. */
  let closed: ReferenceOrgSql
  /** O où toute l'organisation écrit dans Tout le monde, et Claire dans le dossier Support. */
  let open: ReferenceOrgSql

  beforeAll(async () => {
    seed = seedWithAdmin()
    closed = await seedReferenceOrg(seed)
    open = await seedReferenceOrg(seed, {
      rules: [
        { node: "guide", org: true, level: "write" },
        { node: "support", user: "claire", level: "write" },
      ],
    })
  }, SETUP_TIMEOUT)

  afterAll(async () => {
    await seed?.cleanup()
  }, SETUP_TIMEOUT)

  const dbOf = (ref: ReferenceOrgSql, person: Person) => asCaller(ref.people[person].id, ref.people[person].email)

  /** Une page neuve sous `ventes` : elle tient Ventes de son dossier, sauf `owner` ; Claire la gère. */
  async function page(ref: ReferenceOrgSql, owner?: OwnerSeed): Promise<{ id: string; path: string }> {
    const path = `ventes/p${tag()}`
    const team = owner?.kind === "team" ? ref.id(TEAMS[owner.team].id) : null
    const user = owner?.kind === "user" ? ref.people[owner.person].id : null
    const [row] = await seed.admin<{ id: string; path: string }[]>`
      insert into platform.nodes (org_id, parent_id, path, title, summary, status, revision, owner_kind, owner_team_id, owner_user_id, created_by)
      values (${ref.org.id}, ${ref.nodeId("ventes")}, ${path}, 'Page', 'Une page.', 'published', 1, ${owner?.kind ?? null}, ${team}, ${user}, ${ref.people.ada.id})
      returning id, path`
    return row
  }

  /** Le propriétaire explicite d'un nœud, relu par la connexion d'administration. */
  async function ownerColumns(id: string) {
    const [row] = await seed.admin<{ owner_kind: string | null; owner_team_id: string | null; owner_user_id: string | null }[]>`
      select owner_kind, owner_team_id, owner_user_id from platform.nodes where id = ${id}`
    return row
  }

  describe("the service (transferOwner, behind admin_node transfer_owner)", () => {
    /** Le transfert confirmé de `person`, son client vu par l'espion : le résultat ou le refus, et les écritures envoyées. */
    async function transfer(ref: ReferenceOrgSql, person: Person, path: string, owner: string) {
      const { db, sent } = spyDb(dbOf(ref, person))
      const outcome = await transferOwner(db, ref.identityOf(person), { path, owner }).then(
        (done) => ({ changed: done.changed }),
        (error: { code?: string; message?: string }) => ({ code: error.code, message: error.message }),
      )
      return { outcome, writes: writesOf(sent).filter((query) => query.target === "nodes") }
    }

    it("should refuse a lead giving a team page to Tout le monde where she only reads, to a team she does not write in, and to another person's private space, before any write", async () => {
      const target = await page(closed)
      const before = await ownerColumns(target.id)
      const refusals = [
        await transfer(closed, "claire", target.path, "org"),
        await transfer(closed, "claire", target.path, "team:support"),
        await transfer(closed, "claire", target.path, `user:${closed.people.paul.email}`),
      ]
      expect(refusals.map((refusal) => refusal.outcome)).toEqual([
        { code: "forbidden", message: expect.stringMatching(/^.+ cannot go to the organisation \(Tout le monde\): you do not write there\. /) },
        { code: "forbidden", message: expect.stringMatching(/^.+ cannot go to team Support: you do not write there\. .*Paul Girard/) },
        { code: "forbidden", message: `${target.path} cannot go to the private space of Paul Girard: only they put content there. Give it to yourself, or to a team or the organisation you write in.` },
      ])
      expect(refusals.flatMap((refusal) => refusal.writes)).toEqual([])
      expect(await ownerColumns(target.id)).toEqual(before)
    })

    it("should let a lead give a team page to her own private space, and to Tout le monde or another team once she writes there", async () => {
      const [mine, everyone, support] = [await page(closed), await page(open), await page(open)]
      expect((await transfer(closed, "claire", mine.path, `user:${closed.people.claire.email}`)).outcome).toEqual({ changed: 1 })
      expect((await transfer(open, "claire", everyone.path, "org")).outcome).toEqual({ changed: 1 })
      expect((await transfer(open, "claire", support.path, "team:support")).outcome).toEqual({ changed: 1 })
      expect([await ownerColumns(mine.id), await ownerColumns(everyone.id), await ownerColumns(support.id)]).toEqual([
        { owner_kind: "user", owner_team_id: null, owner_user_id: closed.people.claire.id },
        { owner_kind: "org", owner_team_id: null, owner_user_id: null },
        { owner_kind: "team", owner_team_id: open.id(TEAMS.support.id), owner_user_id: null },
      ])
    })

    it("should hold the administrator to the same rule: never another person's private space, Tout le monde and every team allowed", async () => {
      const [personal, everyone] = [await page(closed), await page(closed)]
      const refused = await transfer(closed, "ada", personal.path, `user:${closed.people.claire.email}`)
      expect(refused).toEqual({
        outcome: { code: "forbidden", message: `${personal.path} cannot go to the private space of Claire Morel: only they put content there. Give it to yourself, or to a team or the organisation you write in.` },
        writes: [],
      })
      expect((await ownerColumns(personal.id)).owner_kind).toBeNull()
      expect((await transfer(closed, "ada", everyone.path, "org")).outcome).toEqual({ changed: 1 })
    })

    it("should refuse giving a node back to a parent its manager does not write, and let whoever writes the parent", async () => {
      // Une page de Support rangée sous `ventes` : Paul la gère (responsable de Support) sans écrire dans Ventes.
      const [refused, given] = [await page(closed, { kind: "team", team: "support" }), await page(closed, { kind: "team", team: "support" })]
      const back = await transfer(closed, "paul", refused.path, "inherit")
      expect(back.outcome).toEqual({ code: "forbidden", message: expect.stringMatching(/^.+ cannot go to ventes \(its parent\): you do not write there\. /) })
      expect(back.writes).toEqual([])
      expect((await transfer(closed, "ada", given.path, "inherit")).outcome).toEqual({ changed: 1 })
    })
  })

  describe("the database (nodes_gesture_guard, 20261127150000)", () => {
    /** Le résultat d'une écriture sous la session de `person` : le nombre de lignes, `guard` pour le refus du déclencheur, sinon l'erreur. */
    async function attempt(ref: ReferenceOrgSql, person: Person, query: (sql: Tx) => PromiseLike<readonly unknown[]>, session?: "server"): Promise<number | string> {
      let rows = 0
      const failure = await failureOf(dbOf(ref, person).tx(async (sql) => (rows = (await query(sql)).length), session))
      if (!failure) return rows
      if (failure.code === "42501" && /^platform\.nodes: /.test(failure.message)) return GUARD
      return `${failure.code} ${failure.message}`
    }

    const give = (id: string, owner: { kind: "org" | "team" | "user" | null; team?: string; user?: string }) => (sql: Tx) =>
      sql`update platform.nodes set owner_kind = ${owner.kind}, owner_team_id = ${owner.team ?? null}, owner_user_id = ${owner.user ?? null} where id = ${id} returning id`

    it.each(SESSIONS)("should refuse a lead giving a team page to Tout le monde she only reads, to a team she does not write in, to another person's private space, and let her own (session %s)", async (session) => {
      const [target, mine] = [await page(closed), await page(closed)]
      const support = closed.id(TEAMS.support.id)
      expect(await attempt(closed, "claire", give(target.id, { kind: "org" }), session)).toBe(GUARD)
      expect(await attempt(closed, "claire", give(target.id, { kind: "team", team: support }), session)).toBe(GUARD)
      expect(await attempt(closed, "claire", give(target.id, { kind: "user", user: closed.people.paul.id }), session)).toBe(GUARD)
      expect((await ownerColumns(target.id)).owner_kind).toBeNull()
      expect(await attempt(closed, "claire", give(mine.id, { kind: "user", user: closed.people.claire.id }), session)).toBe(1)
    })

    it.each(SESSIONS)("should let a lead give a team page to Tout le monde or another team once she writes there (session %s)", async (session) => {
      const [everyone, support] = [await page(open), await page(open)]
      expect(await attempt(open, "claire", give(everyone.id, { kind: "org" }), session)).toBe(1)
      expect(await attempt(open, "claire", give(support.id, { kind: "team", team: open.id(TEAMS.support.id) }), session)).toBe(1)
    })

    it.each(SESSIONS)("should hold the administrator to the same rule, and refuse giving a node back to a parent its manager does not write (session %s)", async (session) => {
      const [personal, everyone] = [await page(closed), await page(closed)]
      expect(await attempt(closed, "ada", give(personal.id, { kind: "user", user: closed.people.claire.id }), session)).toBe(GUARD)
      expect(await attempt(closed, "ada", give(everyone.id, { kind: "org" }), session)).toBe(1)
      const [refused, given] = [await page(closed, { kind: "team", team: "support" }), await page(closed, { kind: "team", team: "support" })]
      expect(await attempt(closed, "paul", give(refused.id, { kind: null }), session)).toBe(GUARD)
      expect(await attempt(closed, "ada", give(given.id, { kind: null }), session)).toBe(1)
    })
  })
})
