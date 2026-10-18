// @vitest-environment node
// Lecture des faits du calcul des niveaux (E01-S07 AC12, HN-E01S07-3) sur une vraie base, en suite
// portable (E01-S10, partie e1a : `server/access-facts.ts` passe au SQL ; AC-x3, fiche D76 A) : par
// lots, jamais une lecture par nœud ; `node_owner` rend le propriétaire effectif et le nœud qui le
// porte ; une lecture en échec lève, elle ne vaut jamais un niveau 0. O et P de `seedReferenceOrg`, sous
// `asCaller` ; `spyDb` voit chaque instruction de la face SQL. Les tranches de l'adresse et les pages de
// `max_rows` (HN-E01S07-23, 24) étaient des limites de PostgREST, que la face SQL n'a pas : leurs cas
// partent avec elles (HN-E01S10-e1a-3).
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { accountLevels, nodeLevel, nodeLevels, nodeOwner } from "../../packages/plateforme/server/access"
import { PlatformError } from "../../packages/plateforme/server/errors"
import { ACCOUNTS, OTHER_ORG, TEAMS, type Person } from "../helpers/reference-org"
import { seedReferenceOrg, type ReferenceOrgSql } from "../helpers/reference-org-sql"
import { asCaller, seedWithAdmin, spyDb, SQL_SKIP_REASON, sqlConfigured, type SeededData, type SentQuery } from "../helpers/sql"

const SETUP_TIMEOUT = 180_000
const SUITE = "access facts on a real database (AC12)"

/** Les tables lues par la face SQL, dans l'ordre des lectures. */
const reads = (sent: readonly SentQuery[]) => sent.flatMap((query) => (query.face === "sql" && query.op === "select" ? [query.target] : []))

describe.skipIf(!sqlConfigured)(sqlConfigured ? SUITE : `${SUITE} (${SQL_SKIP_REASON})`, () => {
  let seed: SeededData
  let ref: ReferenceOrgSql

  beforeAll(async () => {
    seed = seedWithAdmin()
    ref = await seedReferenceOrg(seed)
  }, SETUP_TIMEOUT)

  afterAll(async () => {
    await seed?.cleanup()
  }, SETUP_TIMEOUT)

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const dbOf = (person: Person) => asCaller(ref.people[person].id, ref.people[person].email)

  it("should read three nodes of different paths in one read, and three accounts in two", async () => {
    const { db, sent } = spyDb(dbOf("lea"))
    const lea = ref.identityOf("lea")

    const nodes = await nodeLevels(db, lea, [ref.nodeId("ventes/devis/modele"), ref.nodeId("support/faq"), ref.nodeId("private/lea")])
    expect([...nodes.values()]).toEqual([2, 0, 3])
    // Cibles, ancêtres et règles en une instruction (E05-S10, partie c).
    expect(reads(sent)).toEqual(["nodes"])

    const accounts = await accountLevels(db, lea, [ref.id(ACCOUNTS.org.id), ref.id(ACCOUNTS.ventes.id), ref.id(ACCOUNTS.claire.id)])
    // Échelle des comptes (#68) : Léa va jusqu'aux fonctions sensibles du compte de son équipe (3).
    expect([...accounts.values()]).toEqual([1, 3, 0])
    expect(reads(sent).slice(1).sort()).toEqual(["access_rules", "accounts"])
    // Aucune fonction : ni niveau lu en base, ni `node_owner` pour une liste.
    expect(sent.filter((query) => query.op === "call")).toEqual([])
  })

  // La parité lit chaque nœud de O en un lot, où chaque ancêtre est aussi une cible (`access-parity.test.ts`) :
  // ici, un nœud lu seul, dont seule la règle d'un ancêtre donne le niveau.
  it("should read the rules of the ancestors of a node read alone", async () => {
    const [rule] = await ref.addRules([{ node: "ventes", team: "support", level: "read" }])
    try {
      const { db, sent } = spyDb(dbOf("paul"))
      expect(await nodeLevel(db, ref.identityOf("paul"), ref.nodeId("ventes/devis/modele"))).toBe(1)
      expect(reads(sent)).toEqual(["nodes"])
    } finally {
      await seed.admin`delete from platform.access_rules where id = ${rule}`
    }
  })

  it("should give the effective owner of a node and the node that holds it, and nothing outside the caller's organisations (node_owner)", async () => {
    expect(await nodeOwner(dbOf("lea"), ref.nodeId("private/claire/notes"))).toEqual({
      kind: "user",
      teamId: null,
      userId: ref.people.claire.id,
      nodeId: ref.nodeId("private/claire"),
    })
    expect(await nodeOwner(dbOf("lea"), ref.nodeId("ventes/devis"))).toEqual({ kind: "team", teamId: ref.id(TEAMS.ventes.id), userId: null, nodeId: ref.nodeId("ventes") })
    // `ventes` de P : Léa, membre de P, lit son propriétaire (la racine de P) ; Ada, qui n'en est pas membre, rien.
    expect(await nodeOwner(dbOf("lea"), ref.id(OTHER_ORG.node.id))).toMatchObject({ kind: "org", nodeId: ref.id(OTHER_ORG.root) })
    expect(await nodeOwner(dbOf("ada"), ref.id(OTHER_ORG.node.id))).toBeNull()
  })

  it("should decide on one instant of the tree when an ancestor moves at the time of the read, without asking node_owner", async () => {
    // Lus en deux instructions, la cible puis ses ancêtres par chemin, un ancêtre déplacé entre les deux manquait
    // à la chaîne, et une décision demandait son propriétaire à `node_owner` (HN-E01S07-4). Lus en une
    // instruction (E05-S10, partie c), cible et ancêtres sont du même instant : la connexion d'administration
    // renomme `private/claire` (et, par la base, ses descendants) juste avant la lecture des faits (`before` de
    // l'espion), puis le rend ; la chaîne lue est complète, le niveau est le même, `node_owner` n'est jamais
    // demandé. Sans ce même instant, la racine passerait pour le propriétaire (3).
    const [rule] = await ref.addRules([{ node: "private/claire/notes", user: "ada", level: "read" }])
    const space = ref.nodeId("private/claire")
    const moved = "private/claire_moved"
    let armed = false
    const { db, sent } = spyDb(dbOf("ada"), {
      before: async (query) => {
        if (!armed || query.target !== "nodes" || !/\bwith targets as\b/.test(String(query.detail))) return
        armed = false
        await seed.admin`update platform.nodes set path = ${moved} where id = ${space}`
      },
    })
    /** `run` pendant que `private/claire` se déplace sous sa lecture, puis le chemin rendu et ses alias retirés. */
    async function whileMoving<T>(run: () => Promise<T>): Promise<T> {
      armed = true
      try {
        return await run()
      } finally {
        await seed.admin`update platform.nodes set path = 'private/claire' where id = ${space} and path = ${moved}`
        await seed.admin`delete from platform.node_aliases where org_id = ${ref.org.id} and old_path in ${seed.admin([moved, `${moved}/notes`])}`
      }
    }
    const ownerCalls = () => sent.filter((query) => query.op === "call" && query.target === "node_owner")
    const ada = ref.identityOf("ada")
    const notes = ref.nodeId("private/claire/notes")
    try {
      const listed = await whileMoving(() => nodeLevels(db, ada, [notes]))
      expect(listed.get(notes)).toBe(1)
      expect(ownerCalls()).toEqual([])
      expect(await whileMoving(() => nodeLevel(db, ada, notes))).toBe(1)
      expect(await nodeLevel(db, ada, ref.nodeId("ventes/devis"))).toBe(3)
      expect(ownerCalls()).toEqual([])
      expect(reads(sent)).toEqual(["nodes", "nodes", "nodes"])
    } finally {
      await seed.admin`delete from platform.access_rules where id = ${rule}`
    }
  })

  it("should raise the internal PlatformError of a failed read, never a level 0", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const { db } = spyDb(dbOf("lea"), { fail: (query) => (query.target === "nodes" ? { code: "57014" } : null) })

    const error = await nodeLevel(db, ref.identityOf("lea"), ref.nodeId("ventes/devis")).catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(PlatformError)
    expect(error).toMatchObject({ code: "internal" })
  })
})
