// @vitest-environment node
// La copie garde les masquages (décidé par JB le 2026-11-27) : chaque page copiée par « Dupliquer » reprend les
// règles « Aucun accès » (`none`) de l'original, sur le nœud copié comme sur ses descendants ; les règles qui
// ouvrent ne sont pas reprises. Personne ne lit dans la copie ce qu'il ne lisait pas dans l'original. La base est le
// sujet : `duplicate_subtree`, `access_rules` et le niveau que la base calcule (`node_level_for`). Organisation de
// référence jetable (H120). Migration `20261127120000`. Suite portable.
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { duplicateNode, findNode, resolveIdentity, type Identity, type PlatformDb } from "@otomata_tech/oto_platform/server"
import { createSqlFixtures, SQL_SKIP_REASON, sqlConfigured, sqlNodeLevel, type SqlFixtures, type SqlReferenceOrg } from "../helpers/sql"
import { pendingMigrations, pendingReason, PRIVATE_FOLDER_VERSION } from "../helpers/pending-migrations"

const VERSION = "20261127120000"
const waiting = (await pendingMigrations()).filter((version) => version === PRIVATE_FOLDER_VERSION || version === VERSION)

const NETWORK_TIMEOUT = 60_000
const SETUP_TIMEOUT = 180_000
const SUITE = "a copy keeps the hidden parts of the original"
const ready = sqlConfigured

type Person = "claire" | "lea" | "paul" | "marc"
type Session = { db: PlatformDb; identity: Identity }

const suite = !ready ? `${SUITE} (${SQL_SKIP_REASON})` : waiting.length > 0 ? `${SUITE} (${pendingReason(waiting)})` : SUITE

describe.skipIf(!ready || waiting.length > 0)(suite, { timeout: NETWORK_TIMEOUT }, () => {
  let fx: SqlFixtures
  let o: SqlReferenceOrg
  const sessions = new Map<Person, Session>()

  beforeAll(async () => {
    fx = createSqlFixtures()
    o = await fx.buildReferenceOrg()
    for (const person of ["claire", "lea", "paul"] as const) {
      const user = o.people[person]
      const db = fx.as(user)
      sessions.set(person, { db, identity: await resolveIdentity(db, o.host, { userId: user.id, email: user.email }) })
    }
  }, SETUP_TIMEOUT)

  afterAll(async () => {
    await fx?.cleanup()
  }, SETUP_TIMEOUT)

  const as = (person: Person): Session => {
    const session = sessions.get(person)
    if (!session) throw new Error(`no session for ${person}`)
    return session
  }

  async function page(path: string): Promise<string> {
    const parentId = await fx.nodeId(o.org.id, path.slice(0, path.lastIndexOf("/")))
    return fx.createNode(o.org.id, { parentId, path, title: path.slice(path.lastIndexOf("/") + 1) })
  }

  /** Ce que la base et le service disent de `path` pour `person` : son niveau en base, et s'il se trouve. */
  async function seen(person: Person, path: string): Promise<{ level: number; found: boolean }> {
    const { db, identity } = as(person)
    const id = await fx.nodeId(o.org.id, path)
    return { level: await sqlNodeLevel(db, id), found: (await findNode(db, identity, path)) !== null }
  }

  // Claire, responsable de Ventes, gère son dossier ; Léa, membre, y écrit ; Paul, de Support, y lit par une règle.
  it("should keep a sub-page hidden from a member hidden in the copy made by the team lead", async () => {
    await page("ventes/masq")
    const hidden = await page("ventes/masq/cache")
    await fx.addRule({ orgId: o.org.id, nodeId: hidden, userId: o.people.lea.id, level: "none" })
    expect(await seen("lea", "ventes/masq/cache")).toEqual({ level: 0, found: false })

    const claire = as("claire")
    const copied = await duplicateNode(claire.db, claire.identity, { path: "ventes/masq" })
    expect(copied.data).toEqual({ path: "ventes/masq_copie", from: "ventes/masq", count: 2 })

    expect(await seen("lea", "ventes/masq_copie/cache")).toEqual({ level: 0, found: false })
    // Qui copie garde ce qu'il lit ; le reste de la copie reste lisible par Léa.
    expect((await seen("claire", "ventes/masq_copie/cache")).found).toBe(true)
    expect(await seen("lea", "ventes/masq_copie")).toEqual({ level: 2, found: true })
  })

  it("should keep the hidden parts in the copy made by a writer who does not manage it, and not copy a rule that opens", async () => {
    const source = await page("ventes/masq2")
    const hidden = await page("ventes/masq2/cache")
    await fx.addRule({ orgId: o.org.id, nodeId: source, userId: o.people.paul.id, level: "read" })
    // Une règle nominative `none` ôte au responsable sa gestion (HN-E01S07-16) : Claire ne lit pas `cache`.
    await fx.addRule({ orgId: o.org.id, nodeId: hidden, userId: o.people.claire.id, level: "none" })
    expect(await seen("claire", "ventes/masq2/cache")).toEqual({ level: 0, found: false })

    const lea = as("lea")
    await duplicateNode(lea.db, lea.identity, { path: "ventes/masq2" })

    const rules = await fx.admin<{ path: string; level: string }[]>`
      select n.path, r.level from platform.access_rules r join platform.nodes n on n.id = r.node_id
       where n.org_id = ${o.org.id} and starts_with(n.path, 'ventes/masq2_copie') order by n.path`
    expect([...rules]).toEqual([{ path: "ventes/masq2_copie/cache", level: "none" }])
    expect(await seen("claire", "ventes/masq2_copie/cache")).toEqual({ level: 0, found: false })
    expect(await seen("paul", "ventes/masq2_copie")).toEqual({ level: 0, found: false })
    expect((await seen("lea", "ventes/masq2_copie/cache")).found).toBe(true)
  })

  // Qui copie garde les pages qu'il lit (décidé par JB le 27/11) : quand une règle `none` reprise lui cache la copie (ici
  // celle de son équipe, l'original lui étant ouvert par une règle nominative, qui ne se reprend pas), toutes les règles
  // `none` restent et une règle à son seul nom lui rend le niveau auquel il lit l'original ; ses coéquipiers (Marc) ne
  // lisent pas la copie. Copiée par Claire, que la règle de Ventes ne cache pas (responsable), aucune règle à son nom.
  it("should give the person who copies a rule in their name on a copy the hiding rules hide from them, and to no one else", async () => {
    await page("ventes/masq4")
    const hidden = await page("ventes/masq4/cache")
    await fx.addRule({ orgId: o.org.id, nodeId: hidden, teamId: o.teams.ventes, level: "none" })
    await fx.addRule({ orgId: o.org.id, nodeId: hidden, userId: o.people.lea.id, level: "read" })
    await fx.addRule({ orgId: o.org.id, nodeId: hidden, userId: o.people.paul.id, level: "none" })
    await fx.addTeamMember(o.teams.ventes, o.people.marc.id)
    const marc = fx.as(o.people.marc)
    sessions.set("marc", { db: marc, identity: await resolveIdentity(marc, o.host, { userId: o.people.marc.id, email: o.people.marc.email }) })
    expect(await seen("lea", "ventes/masq4/cache")).toEqual({ level: 1, found: true })
    expect(await seen("marc", "ventes/masq4/cache")).toEqual({ level: 0, found: false })

    const lea = as("lea")
    const byLea = (await duplicateNode(lea.db, lea.identity, { path: "ventes/masq4" })).data.path
    const claire = as("claire")
    const byClaire = (await duplicateNode(claire.db, claire.identity, { path: "ventes/masq4" })).data.path

    const rulesOf = async (root: string) => [
      ...(await fx.admin<{ team: boolean; user: string | null; level: string }[]>`
        select r.subject_team_id is not null as team, r.subject_user_id as "user", r.level
          from platform.access_rules r join platform.nodes n on n.id = r.node_id
         where n.org_id = ${o.org.id} and n.path = ${`${root}/cache`} order by r.subject_team_id nulls first, r.level`),
    ]
    expect({ byLea: await rulesOf(byLea), byClaire: await rulesOf(byClaire) }).toEqual({
      byLea: [
        { team: false, user: o.people.paul.id, level: "none" },
        { team: false, user: o.people.lea.id, level: "read" },
        { team: true, user: null, level: "none" },
      ],
      byClaire: [
        { team: false, user: o.people.paul.id, level: "none" },
        { team: true, user: null, level: "none" },
      ],
    })
    expect(await seen("lea", `${byLea}/cache`)).toEqual({ level: 1, found: true })
    expect(await seen("marc", `${byLea}/cache`)).toEqual({ level: 0, found: false })
    expect(await seen("lea", `${byClaire}/cache`)).toEqual({ level: 0, found: false })
  })

  it("should not copy a page hidden from the person who copies", async () => {
    await page("ventes/masq3")
    const hidden = await page("ventes/masq3/cache")
    await fx.addRule({ orgId: o.org.id, nodeId: hidden, userId: o.people.lea.id, level: "none" })

    const lea = as("lea")
    const copied = await duplicateNode(lea.db, lea.identity, { path: "ventes/masq3" })
    expect(copied.data.count).toBe(1)
    expect(await fx.admin`select id from platform.nodes where org_id = ${o.org.id} and path = 'ventes/masq3_copie/cache'`).toEqual([])
  })
})
