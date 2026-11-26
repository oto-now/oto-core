// @vitest-environment node
// La reprise de la migration 20261126172651 (l'espace écrit sur le nœud), rejouée sur une vraie base dans une
// transaction annulée : l'état d'avant est recréé (contrainte `nodes_owner_written_check` retirée, propriétaires remis
// à nul), puis la section 1 du fichier est jouée telle qu'elle est écrite. Elle s'arrête, sans rien écrire, quand un
// contenu Privé recevrait le partage d'un dossier de la même personne au-dessus de lui
// (`espace_ecrit_partages_herites`) ; sinon elle fige sur chaque nœud le propriétaire qu'il héritait, un membre retiré
// compris (`nodes_guard` coupé le temps de l'UPDATE). Les règles des autres organisations de la base de test sont
// retirées dans la transaction : la vérification compte toute la table.
import fs from "fs"
import path from "path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { AdminTx } from "../helpers/admin-sql"
import { seedReferenceOrg, type ReferenceOrgSql } from "../helpers/reference-org-sql"
import { seedWithAdmin, SQL_SKIP_REASON, sqlConfigured, type SeededData } from "../helpers/sql"

const SETUP_TIMEOUT = 180_000
const SUITE = "the data migration of the space written on a node (20261126172651)"
const MIGRATION = path.resolve(__dirname, "../../packages/plateforme/migrations/20261126172651_platform_espace_ecrit.sql")
const ROLLBACK = new Error("rollback")

/** La section 1 de la migration : la vérification, puis la reprise, jusqu'aux déclencheurs rallumés. */
function dataMigration(): string {
  const text = fs.readFileSync(MIGRATION, "utf8")
  const end = "SET CONSTRAINTS platform.nodes_owner_team_id_fkey DEFERRED;"
  const start = text.indexOf("DO $reprise$")
  if (start < 0 || text.indexOf(end) < start) throw new Error("the data migration section is not found in the migration file")
  return text.slice(start, text.indexOf(end) + end.length)
}

type Tx = AdminTx

describe.skipIf(!sqlConfigured)(sqlConfigured ? SUITE : `${SUITE} (${SQL_SKIP_REASON})`, { timeout: 60_000 }, () => {
  let seed: SeededData
  let ref: ReferenceOrgSql

  beforeAll(async () => {
    seed = seedWithAdmin()
    ref = await seedReferenceOrg(seed)
  }, SETUP_TIMEOUT)

  afterAll(async () => {
    await seed?.cleanup()
  }, SETUP_TIMEOUT)

  /** `run` sur l'état d'avant la migration : `inherited` sans propriétaire, comme avant ; tout est annulé à la fin. */
  async function before<T>(inherited: string[], run: (tx: Tx) => Promise<T>): Promise<T> {
    const outcome: { value?: T } = {}
    await seed.admin
      .begin(async (tx) => {
        await tx`alter table platform.nodes drop constraint nodes_owner_written_check`
        await tx`delete from platform.access_rules where org_id <> ${ref.org.id}`
        await tx`update platform.nodes set owner_kind = null, owner_team_id = null, owner_user_id = null
                  where org_id = ${ref.org.id} and path = any(${inherited})`
        // Les vérifications différées de ces écritures, jouées avant la reprise : elle change les déclencheurs de `nodes`.
        await tx`set constraints platform.nodes_owner_team_id_fkey immediate`
        await tx`set constraints platform.nodes_owner_team_id_fkey deferred`
        outcome.value = await run(tx)
        throw ROLLBACK
      })
      .catch((error: unknown) => {
        if (error !== ROLLBACK) throw error
      })
    return outcome.value as T
  }

  const shareClaireSpaceWithLea = (tx: Tx) =>
    tx`insert into platform.access_rules (org_id, node_id, subject_user_id, level)
       values (${ref.org.id}, ${ref.nodeId("private/claire")}, ${ref.people.lea.id}, 'read')`

  const ownersOf = (tx: Tx, paths: string[]) =>
    tx<{ path: string; owner_kind: string | null; owner_team_id: string | null; owner_user_id: string | null }[]>`
      select path, owner_kind, owner_team_id, owner_user_id from platform.nodes
       where org_id = ${ref.org.id} and path = any(${paths}) order by path`

  it("should stop, writing nothing, when a private content would take the share of a folder of its owner above it", async () => {
    // `private/claire/notes` porte Claire ; `private/claire`, partagé à Léa, ne l'ouvrait pas (plancher : `notes`). Après la
    // reprise, le plancher serait `private/claire` : Léa lirait les notes.
    const { failure, owners } = await before(["ventes/devis"], async (tx) => {
      await shareClaireSpaceWithLea(tx)
      const failure = await tx
        .savepoint((sp) => sp.unsafe(dataMigration()))
        .then(
          () => null,
          (error: { message?: string; code?: string }) => ({ message: error.message, code: error.code }),
        )
      return { failure, owners: await ownersOf(tx, ["ventes/devis"]) }
    })
    expect(failure?.code).toBe("P0001")
    expect(failure?.message).toMatch(/^espace_ecrit_partages_herites: 1 private contents would take the shares/)
    expect(owners).toEqual([{ path: "ventes/devis", owner_kind: null, owner_team_id: null, owner_user_id: null }])
  })

  it("should write on every node the owner it inherited when no private content takes a share", async () => {
    // Les notes héritent de Claire (sans propriétaire) : le partage de `private/claire` les ouvrait déjà à Léa.
    const owners = await before(["ventes/devis", "ventes/devis/modele", "private/claire/notes"], async (tx) => {
      await shareClaireSpaceWithLea(tx)
      await tx.unsafe(dataMigration())
      return ownersOf(tx, ["private/claire/notes", "ventes/devis", "ventes/devis/modele"])
    })
    expect(owners).toEqual([
      { path: "private/claire/notes", owner_kind: "user", owner_team_id: null, owner_user_id: ref.people.claire.id },
      { path: "ventes/devis", owner_kind: "team", owner_team_id: ref.id("team-ventes"), owner_user_id: null },
      { path: "ventes/devis/modele", owner_kind: "team", owner_team_id: ref.id("team-ventes"), owner_user_id: null },
    ])
  })

  it("should give a removed member's content the owner of her private space, which she keeps", async () => {
    const owners = await before(["private/claire/notes"], async (tx) => {
      await tx`delete from platform.members where org_id = ${ref.org.id} and user_id = ${ref.people.claire.id}`
      await tx.unsafe(dataMigration())
      return ownersOf(tx, ["private/claire/notes"])
    })
    expect(owners).toEqual([{ path: "private/claire/notes", owner_kind: "user", owner_team_id: null, owner_user_id: ref.people.claire.id }])
  })
})
