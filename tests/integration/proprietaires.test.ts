// @vitest-environment node
// Gardes du propriétaire (tâche M26, décisions de JB du 2026-09-26) sur une vraie base, la base étant le
// sujet : fiche D18 B (tout gestionnaire rend personnel un nœud d'équipe, par le service de déplacement
// comme sous sa session ; l'administrateur ne le voit plus, D5 amendé), tâche M18b (HN-E08S06-17 : le
// propriétaire de `private/<handle>` ne change pas en base) et fiche D42 B (H69 : une équipe qui possède un
// compte de connecteur ne se supprime pas, clé différée). Portable : O de `seedReferenceOrg`, sessions
// `asCaller`, connexion d'administration ; sur le projet comme sur un Postgres nu.
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { nodeLevel } from "../../packages/plateforme/server/access"
import { moveNode } from "../../packages/plateforme/server/nodes/move"
import { TEAMS, type Person } from "../helpers/reference-org"
import { seedReferenceOrg, type ReferenceOrgSql } from "../helpers/reference-org-sql"
import { asCaller, seedWithAdmin, SQL_SKIP_REASON, sqlConfigured, type SeededData } from "../helpers/sql"
import { privateFolderPending, privateFolderSuite } from "../helpers/pending-migrations"

// Ces tests supposent le dossier `private` en base (fiche D107) : sautés, la version nommée, tant que
// 20260928120000 n'est pas appliquée au projet (`database-patterns.md § Règles`).
const privatePending = await privateFolderPending()

const SETUP_TIMEOUT = 180_000
const NETWORK_TIMEOUT = 60_000
const SUITE = "owner guards on a real database (M26)"
const ready = sqlConfigured
const skipReason = SQL_SKIP_REASON

/** Le refus de la base (SQLSTATE et message), ou `null` quand l'instruction passe. */
function failure(run: PromiseLike<unknown>): Promise<{ code?: string; message?: string } | null> {
  return Promise.resolve(run).then(
    () => null,
    (error: { code?: string; message?: string }) => ({ code: error.code, message: error.message }),
  )
}

const PERSONAL_SPACE = { code: "23514", message: "private/<handle> is the personal space of the member with that handle" }

describe.skipIf(!ready)(ready ? SUITE : `${SUITE} (${skipReason})`, { timeout: NETWORK_TIMEOUT }, () => {
  let seed: SeededData
  let ref: ReferenceOrgSql

  beforeAll(async () => {
    seed = seedWithAdmin()
    ref = await seedReferenceOrg(seed)
  }, SETUP_TIMEOUT)

  afterAll(async () => {
    await seed?.cleanup()
  }, SETUP_TIMEOUT)

  const dbOf = (person: Person) => asCaller(ref.people[person].id, ref.people[person].email)

  /** Le propriétaire explicite d'un nœud, relu par la connexion d'administration. */
  async function ownerOf(nodeId: string) {
    return [...(await seed.admin`select owner_kind, owner_team_id, owner_user_id from platform.nodes where id = ${nodeId}`)]
  }

  it("should let a lead who does not administer make a team node personal by its owner, hidden then from the administrator, a move into her space keeping its team (fiche D18 B, 20261103150000)", async () => {
    const claire = ref.people.claire.id
    const [devis, tarifs] = ["ventes/devis", "ventes/tarifs"].map((path) => ref.nodeId(path))
    // Le service : Claire mène Ventes, sans administrer O ; déplacée dans son espace, `ventes/devis` garde l'équipe (l'espace
    // est écrit sur le nœud, décidé avec JB le 03/11).
    const moved = await moveNode(dbOf("claire"), ref.identityOf("claire"), { path: "ventes/devis", new_path: "private/claire/devis" })
    expect(moved.target).toBe("private/claire/devis")
    expect(await nodeLevel(dbOf("ada"), ref.identityOf("ada"), devis)).toBe(3)
    await dbOf("claire").tx((sql) => sql`update platform.nodes set owner_kind = 'user', owner_team_id = null, owner_user_id = ${claire} where id = ${devis} returning id`)
    // La base, sous sa session : `ventes/tarifs` porte Ventes pour propriétaire explicite.
    const given = await dbOf("claire").tx(
      (sql) => sql`update platform.nodes set owner_kind = 'user', owner_team_id = null, owner_user_id = ${claire} where id = ${tarifs} returning id`,
    )
    expect(given).toHaveLength(1)
    // D5 amendé : l'administratrice ne les voit plus ; Claire les gère.
    const levels = (person: Person) => Promise.all([devis, tarifs].map((id) => nodeLevel(dbOf(person), ref.identityOf(person), id)))
    expect([await levels("ada"), await levels("claire")]).toEqual([
      [0, 0],
      [3, 3],
    ])
    // Qu'un rédacteur qui ne gère pas la page ne le puisse pas est décidé par le service depuis E01-S12
    // partie c (ADR-012 § 3 ; `tests/unit/mcp-admin-nodes.test.ts`).
  })

  it.skipIf(privatePending)(privateFolderSuite("should keep the member of the handle as the only owner of private/<handle>, whoever writes, a node inside it taking any owner (M18b)", privatePending), async () => {
    const ventes = ref.id(TEAMS.ventes.id)
    const [space, notes] = ["private/claire", "private/claire/notes"].map((path) => ref.nodeId(path))
    const before = await ownerOf(space)
    const refusals = [
      // Claire gère son espace, sans pouvoir le donner à son équipe (H61).
      await failure(dbOf("claire").tx((sql) => sql`update platform.nodes set owner_kind = 'team', owner_team_id = ${ventes}, owner_user_id = null where id = ${space}`)),
      // Ni la connexion d'administration : à une autre personne, ou à personne (propriétaire hérité, NULL).
      await failure(seed.admin`update platform.nodes set owner_user_id = ${ref.people.ada.id} where id = ${space}`),
      await failure(seed.admin`update platform.nodes set owner_kind = null, owner_user_id = null where id = ${space}`),
    ]
    expect(refusals).toEqual([PERSONAL_SPACE, PERSONAL_SPACE, PERSONAL_SPACE])
    expect(await ownerOf(space)).toEqual(before)
    // Plus bas dans l'espace, un propriétaire explicite reste permis (H71).
    const given = await dbOf("claire").tx(
      (sql) => sql`update platform.nodes set owner_kind = 'team', owner_team_id = ${ventes}, owner_user_id = null where id = ${notes} returning id`,
    )
    expect(given).toHaveLength(1)
  })

  it("should refuse deleting a team that owns a connector account at commit, even by the administration connection, and let its organisation go with both (fiche D42 B, H69)", async () => {
    // Une organisation sans arbre : ses équipes n'y ont ni dossier ni Contexte (`teams_tree_sync`), seul un compte les retient.
    const org = await seed.createOrg()
    const team = async (slug: string) => {
      const [row] = await seed.admin<{ id: string }[]>`insert into platform.teams (org_id, slug, name) values (${org.id}, ${slug}, ${slug}) returning id`
      await seed.admin`insert into platform.accounts (org_id, connector, owner_kind, owner_team_id, label, mode)
                       values (${org.id}, 'mail', 'team', ${row.id}, ${`Mail ${slug}`}, 'simule')`
      return row.id
    }
    const achats = await team("achats")
    await team("ventes")
    const left = async () => {
      const [row] = await seed.admin<{ teams: number; accounts: number }[]>`
        select (select count(*)::int from platform.teams where org_id = ${org.id}) as teams,
               (select count(*)::int from platform.accounts where org_id = ${org.id}) as accounts`
      return row
    }

    expect((await failure(seed.admin`delete from platform.teams where id = ${achats}`))?.code).toBe("23503")
    expect(await left()).toEqual({ teams: 2, accounts: 2 })
    // Clé différée : le compte passé à l'organisation avant le `commit`, l'équipe part seule.
    await seed.admin.begin(async (sql) => {
      await sql`delete from platform.teams where id = ${achats}`
      await sql`update platform.accounts set owner_kind = 'org', owner_team_id = null where owner_team_id = ${achats}`
    })
    expect(await left()).toEqual({ teams: 1, accounts: 2 })
    // L'organisation part avec Ventes et le compte qu'elle possède, quel que soit l'ordre des cascades.
    await seed.admin`delete from platform.orgs where id = ${org.id}`
    expect(await left()).toEqual({ teams: 0, accounts: 0 })
  })
})
