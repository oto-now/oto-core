// @vitest-environment node
// Les connecteurs privés sur une vraie base (`docs/conception/connecteurs-prives.md`) : écrits par l'équipe plateforme
// seule, lus par les membres de leur organisation ; une définition refusée laisse servie la précédente et rend tous ses
// problèmes ; chaque enregistrement ajoute une version, le retour à une version passée aussi ; un retrait garde
// l'historique, un nouvel enregistrement rouvre le connecteur. Puis la base : aucune écriture sous une session de
// personne, aucune lecture hors de l'organisation. Organisation de référence jetable. Suite portable.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { resolveIdentity, type Identity, type PlatformDb } from "@otomata_tech/oto_platform/server"
import {
  checkPrivateConnector,
  listPrivateConnectors,
  readPrivateConnector,
  removePrivateConnector,
  restorePrivateConnector,
  savePrivateConnector,
} from "../../packages/plateforme/server/private-connectors/service"
import { pendingMigrations } from "../helpers/pending-migrations"
import { hex } from "../helpers/plateforme"
import { ERP, erpDefinition } from "../helpers/private-connectors"
import { codeOf, createSqlFixtures, SQL_SKIP_REASON, sqlConfigured, type SqlFixtures, type SqlReferenceOrg } from "../helpers/sql"

/** La résolution des adresses jugées : toutes publiques, les domaines de test ne se résolvant pas. */
vi.mock("../../packages/plateforme/server/connectors/address-guard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../packages/plateforme/server/connectors/address-guard")>()),
  resolutionFault: async () => null,
}))

const VERSION = "20261127170000"
const pending = (await pendingMigrations()).includes(VERSION)
const SETUP_TIMEOUT = 180_000
const SUITE = "private connectors on a real database"
const skipReason = !sqlConfigured ? SQL_SKIP_REASON : `skipped: migration ${VERSION} not applied`

type Session = { db: PlatformDb; identity: Identity }

describe.skipIf(!sqlConfigured || pending)(sqlConfigured && !pending ? SUITE : `${SUITE} (${skipReason})`, { timeout: 60_000 }, () => {
  let fx: SqlFixtures
  let o: SqlReferenceOrg
  let other: SqlReferenceOrg
  let staff: Session
  let lea: Session
  let outsider: Session

  beforeAll(async () => {
    fx = createSqlFixtures()
    o = await fx.buildReferenceOrg()
    other = await fx.buildReferenceOrg()
    const sam = await fx.createUser({ fullName: "Sam Staff" })
    await fx.makeStaff(sam.id)
    await fx.grantPlatformAccess(o.org.id, sam.id, null)
    const session = async (person: { id: string; email: string }, org: SqlReferenceOrg): Promise<Session> => {
      const db = fx.as(person)
      return { db, identity: await resolveIdentity(db, org.host, { userId: person.id, email: person.email }) }
    }
    staff = await session(sam, o)
    lea = await session(o.people.lea, o)
    outsider = await session(other.people.lea, other)
  }, SETUP_TIMEOUT)

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined)
  })

  afterAll(async () => {
    await fx?.cleanup()
  })

  it("should reserve every write to the platform team, and let members read", async () => {
    expect(await codeOf(checkPrivateConnector(lea.db, lea.identity, erpDefinition()))).toBe("forbidden")
    expect(await codeOf(savePrivateConnector(lea.db, lea.identity, erpDefinition()))).toBe("forbidden")
    expect(await codeOf(removePrivateConnector(lea.db, lea.identity, ERP))).toBe("forbidden")
    expect(await codeOf(restorePrivateConnector(lea.db, lea.identity, ERP, 1))).toBe("forbidden")
    expect(await listPrivateConnectors(lea.db, lea.identity)).toEqual([])
  })

  it("should save versions, refuse a definition with all its problems while the previous one stays served, restore and remove", async () => {
    const first = await savePrivateConnector(staff.db, staff.identity, erpDefinition())
    expect(first).toMatchObject({ kind: "saved", view: { namespace: ERP, label: "ERP", version: 1, functions: 2, removedAt: null } })
    if (first.kind === "refused") throw new Error("refused")
    expect(first.view.key).toMatch(/^custom_[0-9a-f]{8}$/)
    expect(await savePrivateConnector(staff.db, staff.identity, erpDefinition())).toMatchObject({ kind: "unchanged", view: { version: 1 } })

    const broken = erpDefinition()
    broken.connector.base_url = "http://erp.exemple.test/api"
    broken.connector.label = "x".repeat(81)
    const refused = await savePrivateConnector(staff.db, staff.identity, broken)
    expect(refused).toMatchObject({ kind: "refused", current: { version: 1 }, problems: [{ code: "custom_api_base_url_not_https", path: "connector.base_url" }] })
    expect((await readPrivateConnector(lea.db, lea.identity, ERP)).version).toBe(1)

    const second = erpDefinition()
    second.connector.label = "ERP 2"
    expect(await savePrivateConnector(staff.db, staff.identity, second)).toMatchObject({ kind: "saved", view: { label: "ERP 2", version: 2 } })
    expect(await restorePrivateConnector(staff.db, staff.identity, ERP, 1)).toMatchObject({ kind: "saved", view: { label: "ERP", version: 3 } })
    expect(await restorePrivateConnector(staff.db, staff.identity, ERP, 3)).toMatchObject({ kind: "unchanged", view: { version: 3 } })
    expect(await codeOf(restorePrivateConnector(staff.db, staff.identity, ERP, 9))).toBe("not_found")

    const read = await readPrivateConnector(lea.db, lea.identity, ERP)
    expect(read.versions.map(({ version, restoredFrom }) => [version, restoredFrom])).toEqual([
      [3, 1],
      [2, null],
      [1, null],
    ])
    expect((await readPrivateConnector(lea.db, lea.identity, ERP, 2)).document).toEqual(second)

    const removed = await removePrivateConnector(staff.db, staff.identity, ERP)
    expect(removed).toMatchObject({ version: 3, removedAt: expect.any(String) })
    expect(await codeOf(removePrivateConnector(staff.db, staff.identity, ERP))).toBe("not_found")
    // Retiré, le connecteur garde sa clé ; réenregistré, il revient à la version suivante, sous la même clé.
    expect(await savePrivateConnector(staff.db, staff.identity, erpDefinition())).toMatchObject({ kind: "saved", view: { version: 4, removedAt: null, key: first.view.key } })
    expect(await listPrivateConnectors(lea.db, lea.identity)).toEqual([expect.objectContaining({ namespace: ERP, version: 4 })])
  })

  it("should keep a private connector out of reach of another organisation", async () => {
    expect(await listPrivateConnectors(outsider.db, outsider.identity)).toEqual([])
    expect(await codeOf(readPrivateConnector(outsider.db, outsider.identity, ERP))).toBe("not_found")
  })

  it("should let no session of a person write the tables, even a platform team member: the server role only", async () => {
    const insert = (db: PlatformDb) =>
      db.tx((sql) => sql`insert into platform.private_connectors (org_id, name, namespace, version) values (${o.org.id}, ${`custom_${hex(4)}`}, 'custom_autre', 1)`)
    expect(await codeOf(insert(staff.db))).toBe("42501")
    expect(await codeOf(insert(lea.db))).toBe("42501")
    const update = (db: PlatformDb) => db.tx((sql) => sql`update platform.private_connectors set version = 9 where org_id = ${o.org.id}`)
    expect(await codeOf(update(staff.db))).toBe("42501")
    const appended = (db: PlatformDb) => db.tx((sql) => sql`update platform.private_connector_versions set document = '{}'::jsonb where org_id = ${o.org.id}`)
    expect(await codeOf(appended(staff.db))).toBe("42501")
    const erase = (db: PlatformDb) => db.tx((sql) => sql`delete from platform.private_connector_versions where org_id = ${o.org.id}`)
    expect(await codeOf(erase(staff.db))).toBe("42501")
    // Sous le rôle du serveur, une organisation que l'appelant n'atteint pas reste refusée par la RLS.
    const foreign = staff.db.tx(
      (sql) => sql`insert into platform.private_connectors (org_id, name, namespace, version) values (${other.org.id}, ${`custom_${hex(4)}`}, 'custom_autre', 1)`,
      "server",
    )
    expect(await codeOf(foreign)).toBe("42501")
  })
})
