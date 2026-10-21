// @vitest-environment node
// Les gestes du rail sur une vraie base (E05-S10, partie e) : ordre des frères (AC-b9), corbeille et sa purge
// (AC-b11), duplication d'un sous-arbre (AC-b10), aperçu d'un déplacement (AC-b7), adresse qui suit le titre
// (AC-b12), accès général (AC-b13), liens d'un nœud (AC-b6). La base est le sujet : colonnes `position` et
// `deleted_at`, déclencheur de l'ordre, `duplicate_subtree`, cascades et alias, verrou de l'arbre. Chaque
// refus est décidé avant toute écriture (espion
// `spyDb`, `security-patterns.md § Droits dans le service`). Organisation de référence jetable (H120). Suite
// portable.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import {
  duplicateNode,
  findNode,
  listNodeRules,
  listTrash,
  moveImpact,
  moveNode,
  nodeLinks,
  placeNode,
  publishNode,
  readNode,
  resolveIdentity,
  restoreNode,
  setGeneralAccess,
  trashNode,
  visibleTree,
  writeNode,
  type Identity,
  type PlatformDb,
} from "@otomata_tech/oto_platform/server"
import type { TreeNode } from "@otomata_tech/oto_platform/schemas"
import { find } from "../../packages/plateforme/server/find"
import { loggedText } from "../helpers/logs"
import { createSqlFixtures, spyDb, SQL_SKIP_REASON, sqlConfigured, writesOf, type SqlFixtures, type SqlReferenceOrg } from "../helpers/sql"
import { privateFolderPending, privateFolderSuite } from "../helpers/pending-migrations"

// Ces tests supposent le dossier `private` en base (fiche D107) : sautés, la version nommée, tant que
// 20260928120000 n'est pas appliquée au projet (`database-patterns.md § Règles`).
const privatePending = await privateFolderPending()

const NETWORK_TIMEOUT = 60_000
const SETUP_TIMEOUT = 180_000
const SUITE = "gestures of the rail on a real database (E05-S10, part e)"
const ready = sqlConfigured
const skipReason = SQL_SKIP_REASON

type Person = "ada" | "claire" | "lea" | "paul" | "marc"
type Session = { db: PlatformDb; identity: Identity }

describe.skipIf(!ready || privatePending)(privateFolderSuite(ready ? SUITE : `${SUITE} (${skipReason})`, privatePending), { timeout: NETWORK_TIMEOUT }, () => {
  let fx: SqlFixtures
  let o: SqlReferenceOrg
  const sessions = new Map<Person, Session>()

  beforeAll(async () => {
    fx = createSqlFixtures()
    o = await fx.buildReferenceOrg()
    for (const person of ["ada", "claire", "lea", "paul", "marc"] as const) {
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

  /** Un nœud sous `parentPath`, publié avec `blocks` quand on en donne ; rend son id. */
  async function page(path: string, options: { title?: string; blocks?: string[]; links?: { block: number; path: string }[] } = {}): Promise<string> {
    const parentId = await fx.nodeId(o.org.id, path.slice(0, path.lastIndexOf("/")))
    const id = await fx.createNode(o.org.id, { parentId, path, title: options.title ?? path })
    if (options.blocks) {
      await fx.publishBlocks(id, options.blocks.map((text) => ({ type: "paragraph" as const, text })), { links: options.links })
    }
    return id
  }

  function childrenOf(tree: readonly TreeNode[], path: string): string[] {
    for (const node of tree) {
      if (node.path === path) return node.children.map((child) => child.path)
      const found = childrenOf(node.children, path)
      if (found.length > 0) return found
    }
    return []
  }

  async function ventesChildren(person: Person): Promise<string[]> {
    const { db, identity } = as(person)
    return childrenOf((await visibleTree(db, identity)).tree, "ventes")
  }

  /** Ce que `find` (MCP) trouve pour `person` : les nœuds seuls, sans catalogue de fonctions. */
  async function searched(person: Person, query: string): Promise<{ matches: { path: string }[] }> {
    const { db, identity } = as(person)
    const { data } = await find(db, identity, { query, type: "page" }, { functions: [], activeConnectors: new Set() })
    // `data` du résultat de `find` : un objet dont `matches` porte le chemin de chaque nœud trouvé.
    return data as { matches: { path: string }[] }
  }

  describe("order of siblings (AC-b9)", () => {
    it("should place a node between its siblings for everyone, and refuse a writer before any write", async () => {
      for (const path of ["ventes/oa", "ventes/ob", "ventes/oc"]) await page(path)
      const stamps = () => fx.admin<{ path: string; updated_at: string }[]>`
        select path, updated_at::text from platform.nodes where parent_id = ${o.nodes.ventes} order by path`
      const before = await stamps()
      const claire = as("claire")
      await placeNode(claire.db, claire.identity, { path: "ventes/oc", after: null })
      await placeNode(claire.db, claire.identity, { path: "ventes/oa", after: "ventes/ob" })
      // Avant : par chemin (devis, oa, ob, oc) ; `oc` passe en tête, `oa` après `ob`.
      const order = (await ventesChildren("lea")).filter((path) => ["ventes/oa", "ventes/ob", "ventes/oc", "ventes/devis"].includes(path))
      expect(order).toEqual(["ventes/oc", "ventes/devis", "ventes/ob", "ventes/oa"])
      // Ranger n'est pas modifier : ni le nœud rangé ni ses frères renumérotés ne changent de « modifié le ».
      expect(await stamps()).toEqual(before)

      const lea = as("lea")
      const spy = spyDb(lea.db)
      await expect(placeNode(spy.db, lea.identity, { path: "ventes/ob", after: null })).rejects.toMatchObject({ code: "forbidden" })
      expect(writesOf(spy.sent)).toEqual([])
    })
  })

  describe("trash (AC-b11)", () => {
    it("should put a node and its subtree in the trash, gone from the tree, lookups and links, then restore it in place", async () => {
      await page("ventes/t", { title: "Zanzibar à jeter", blocks: ["Contenu à jeter."] })
      await page("ventes/t/u")
      await page("ventes/cite", { blocks: ["Voir [[ventes/t]]."], links: [{ block: 0, path: "ventes/t" }] })
      const claire = as("claire")
      const lea = as("lea")
      expect((await searched("lea", "Zanzibar")).matches.map((match) => match.path)).toEqual(["ventes/t"])

      const spy = spyDb(lea.db)
      await expect(trashNode(spy.db, lea.identity, { path: "ventes/t" })).rejects.toMatchObject({ code: "forbidden" })
      expect(writesOf(spy.sent)).toEqual([])

      expect((await trashNode(claire.db, claire.identity, { path: "ventes/t" })).data).toEqual({ path: "ventes/t", count: 2 })
      expect(await findNode(lea.db, lea.identity, "ventes/t")).toBeNull()
      expect(await findNode(lea.db, lea.identity, "ventes/t/u")).toBeNull()
      expect(await ventesChildren("lea")).not.toContain("ventes/t")
      expect((await searched("lea", "Zanzibar")).matches).toEqual([])
      const links = await nodeLinks(lea.db, lea.identity, { path: "ventes/cite" })
      expect(links.links_out).toEqual([{ path: "ventes/t", status: "missing" }])

      const items = await listTrash(claire.db, claire.identity)
      expect(items.map((item) => [item.path, item.count])).toEqual([["ventes/t", 2]])
      expect(await listTrash(lea.db, lea.identity)).toEqual([])

      expect((await restoreNode(claire.db, claire.identity, { path: "ventes/t" })).data).toEqual({ path: "ventes/t", from: "ventes/t", count: 2 })
      expect((await findNode(lea.db, lea.identity, "ventes/t/u"))?.node.path).toBe("ventes/t/u")
    })

    it("should restore a node whose parent is in the trash under its closest live ancestor, and purge what stayed 30 days", async () => {
      await page("ventes/r")
      await page("ventes/r/fils")
      const claire = as("claire")
      await trashNode(claire.db, claire.identity, { path: "ventes/r/fils" })
      await trashNode(claire.db, claire.identity, { path: "ventes/r" })
      expect((await restoreNode(claire.db, claire.identity, { path: "ventes/r/fils" })).data).toEqual({ path: "ventes/fils", from: "ventes/r/fils", count: 1 })
      // L'ancien chemin reste un alias (E01-S06) : un lien vers lui arrive au nœud restauré.
      expect((await findNode(claire.db, claire.identity, "ventes/r/fils"))?.node.path).toBe("ventes/fils")

      await fx.admin`update platform.nodes set deleted_at = now() - interval '31 days' where org_id = ${o.org.id} and path = 'ventes/r'`
      expect((await listTrash(claire.db, claire.identity)).map((item) => item.path)).not.toContain("ventes/r")
      expect(await fx.admin`select id from platform.nodes where org_id = ${o.org.id} and path = 'ventes/r'`).toEqual([])
    })

    it("should refuse to delete a subtree that holds a page the person cannot see, before any write", async () => {
      await page("ventes/h")
      const secret = await page("ventes/h/secret")
      await fx.addRule({ orgId: o.org.id, nodeId: secret, userId: o.people.claire.id, level: "none" })
      const claire = as("claire")
      const spy = spyDb(claire.db)
      await expect(trashNode(spy.db, claire.identity, { path: "ventes/h" })).rejects.toMatchObject({ code: "forbidden", message: expect.stringContaining("1 page you cannot see") })
      expect(writesOf(spy.sent)).toEqual([])
    })

    it("should not put in the trash a page put under the node after the decision (lock of the tree)", async () => {
      const course = await page("ventes/course")
      const claire = as("claire")
      const spy = spyDb(claire.db, {
        before: async (query) => {
          if (String(query.detail).includes("pg_advisory_xact_lock")) await fx.createNode(o.org.id, { parentId: course, path: "ventes/course/tard", title: "Tard" })
        },
      })
      const errors = vi.spyOn(console, "error").mockImplementation(() => undefined)
      try {
        await expect(trashNode(spy.db, claire.identity, { path: "ventes/course" })).rejects.toMatchObject({ code: "conflict" })
        expect(loggedText(errors)).toContain("trashNode")
      } finally {
        errors.mockRestore()
      }
      expect(await fx.admin`select path from platform.nodes where org_id = ${o.org.id} and starts_with(path, 'ventes/course') and deleted_at is not null`).toEqual([])
    })

    it("should refuse to restore to a person without management, and under an ancestor they cannot write, before any write", async () => {
      await page("ventes/rq")
      const fils = await page("ventes/rq/fils")
      await fx.addRule({ orgId: o.org.id, nodeId: fils, userId: o.people.paul.id, level: "manage" })
      const claire = as("claire")
      await trashNode(claire.db, claire.identity, { path: "ventes/rq" })

      const lea = as("lea")
      const writer = spyDb(lea.db)
      await expect(restoreNode(writer.db, lea.identity, { path: "ventes/rq" })).rejects.toMatchObject({ code: "forbidden" })
      // Paul gère `fils`, dont le parent est à la corbeille : il reviendrait sous `ventes`, que Paul n'écrit pas.
      const paul = as("paul")
      const manager = spyDb(paul.db)
      await expect(restoreNode(manager.db, paul.identity, { path: "ventes/rq/fils" })).rejects.toMatchObject({ code: "forbidden", message: expect.stringContaining("under ventes") })
      expect([writesOf(writer.sent), writesOf(manager.sent)]).toEqual([[], []])
    })
  })

  describe("duplicate (AC-b10)", () => {
    it("should copy the node and the subtree the person reads, published blocks, rows and links included, rules left, right after the original", async () => {
      const source = await page("ventes/dup", { title: "Dup", blocks: ["Premier.", "Voir [[ventes/devis]]."], links: [{ block: 1, path: "ventes/devis" }] })
      await page("ventes/dup/enfant", { blocks: ["Enfant."] })
      const hidden = await page("ventes/dup/cache", { blocks: ["Caché."] })
      await fx.addRule({ orgId: o.org.id, nodeId: hidden, userId: o.people.lea.id, level: "none" })
      await fx.addRule({ orgId: o.org.id, nodeId: source, teamId: o.teams.support, level: "read" })
      const table = await fx.createNode(o.org.id, { parentId: source, path: "ventes/dup/tab", kind: "table", title: "Tab", status: "published", revision: 1 })
      await fx.addRows(table, [{ key: "r1", data: { nom: "Ligne" } }])

      const lea = as("lea")
      const copied = await duplicateNode(lea.db, lea.identity, { path: "ventes/dup" })
      expect(copied.data).toEqual({ path: "ventes/dup_copie", from: "ventes/dup", count: 3 })

      const nodes = await fx.admin<{ path: string; title: string; status: string; revision: number; owner_kind: string | null }[]>`
        select path, title, status, revision, owner_kind from platform.nodes where org_id = ${o.org.id} and starts_with(path, 'ventes/dup_copie') order by path`
      expect([...nodes]).toEqual([
        { path: "ventes/dup_copie", title: "Dup (copie)", status: "published", revision: 1, owner_kind: null },
        { path: "ventes/dup_copie/enfant", title: "ventes/dup/enfant", status: "published", revision: 1, owner_kind: null },
        { path: "ventes/dup_copie/tab", title: "Tab", status: "published", revision: 1, owner_kind: null },
      ])
      const blocks = await fx.admin<{ path: string; type: string; text: string | null; key: string | null }[]>`
        select n.path, b.type, b.text, b.key from platform.blocks b join platform.nodes n on n.id = b.node_id
         where n.org_id = ${o.org.id} and starts_with(n.path, 'ventes/dup_copie') and b.state = 'published' order by n.path, b.position nulls last, b.key`
      expect([...blocks]).toEqual([
        { path: "ventes/dup_copie", type: "paragraph", text: "Premier.", key: null },
        { path: "ventes/dup_copie", type: "paragraph", text: "Voir [[ventes/devis]].", key: null },
        { path: "ventes/dup_copie/enfant", type: "paragraph", text: "Enfant.", key: null },
        { path: "ventes/dup_copie/tab", type: "row", text: null, key: "r1" },
      ])
      const [copy] = await fx.admin<{ id: string }[]>`select id from platform.nodes where org_id = ${o.org.id} and path = 'ventes/dup_copie'`
      expect(await fx.admin`select target_path from platform.links where source_node_id = ${copy.id}`).toEqual([{ target_path: "ventes/devis" }])
      expect(await fx.admin`select revision from platform.node_versions where node_id = ${copy.id}`).toEqual([{ revision: 1 }])
      expect(await fx.admin`select id from platform.access_rules where node_id = ${copy.id}`).toEqual([])
      const order = await ventesChildren("claire")
      expect(order.indexOf("ventes/dup_copie")).toBe(order.indexOf("ventes/dup") + 1)
    })

    it("should refuse a person who cannot write under the parent, before any write", async () => {
      const source = await page("ventes/dup2")
      await fx.addRule({ orgId: o.org.id, nodeId: source, userId: o.people.paul.id, level: "read" })
      const paul = as("paul")
      const spy = spyDb(paul.db)
      await expect(duplicateNode(spy.db, paul.identity, { path: "ventes/dup2" })).rejects.toMatchObject({ code: "forbidden" })
      expect(writesOf(spy.sent)).toEqual([])
    })
  })

  describe("impact of a move (AC-b7)", () => {
    it("should say who gains, loses or changes access when a node leaves its team", async () => {
      await page("ventes/partant")
      // Ada, administratrice, lit les deux dossiers d'équipe ; Claire ne lit pas celui de Support.
      const ada = as("ada")
      const claire = as("claire")
      await expect(moveImpact(claire.db, claire.identity, { path: "ventes/partant", new_path: "support/partant" })).rejects.toMatchObject({ code: "not_found" })
      const impact = await moveImpact(ada.db, ada.identity, { path: "ventes/partant", new_path: "support/partant" })
      const ids = (changes: { userId: string; before: number; after: number }[]) => changes.map((change) => [change.userId, change.before, change.after])
      expect({ changes: impact.changes, before: impact.before.space, after: impact.after.space }).toEqual({ changes: true, before: "team", after: "team" })
      expect(ids(impact.gained)).toEqual([[o.people.paul.id, 0, 3]])
      expect(ids(impact.lost).sort()).toEqual(
        [
          [o.people.claire.id, 3, 0],
          [o.people.lea.id, 2, 0],
        ].sort(),
      )
      expect(impact.changed).toEqual([])
      // Même place : rien ne change.
      expect((await moveImpact(ada.db, ada.identity, { path: "ventes/partant", new_path: "ventes/devis/partant" })).changes).toBe(false)
    })
  })

  describe("address that follows the title (AC-b12)", () => {
    // Le renommage à l'écran par une responsable passe par le même `followTitle` qu'une rédactrice (plus bas).
    it("should move the node when an assistant publishes a new title, and say the new path in the result of write (MCP)", async () => {
      const claire = as("claire")
      const agent = { kind: "agent" as const, ctx: null }
      await writeNode(claire.db, claire.identity, { path: "ventes/grille", title: "Grille", summary: "Les prix.", publish: true }, agent)
      const renamed = await writeNode(claire.db, claire.identity, { path: "ventes/grille", base_revision: 1, title: "Grille 2027", publish: true }, agent)
      expect(renamed.data).toMatchObject({ path: "ventes/grille_2027", renamed_from: "ventes/grille" })
      expect(renamed.text).toContain("Renamed: now at ventes/grille_2027; the old path ventes/grille still leads here.")
      expect((await findNode(claire.db, claire.identity, "ventes/grille"))?.node.path).toBe("ventes/grille_2027")
      // Un titre laissé en brouillon ne déplace rien : l'adresse suit à la publication (celle d'`admin_node publish`).
      const draft = await writeNode(claire.db, claire.identity, { path: "ventes/grille_2027", base_revision: 2, title: "Grille 2028", publish: false }, agent)
      expect(draft.data).not.toHaveProperty("renamed_from")
      const found = await findNode(claire.db, claire.identity, "ventes/grille_2027")
      if (!found) throw new Error("ventes/grille_2027 not found")
      expect((await publishNode(claire.db, claire.identity, found.node, { baseRevision: 2 })).renamed).toEqual({ from: "ventes/grille_2027", to: "ventes/grille_2028" })
    })

    // E11-S02 (AC-a3, HN-E11S02-18) : le chemin suit le titre au niveau écriture, par le même mécanisme qu'un
    // renommage par la gestion ; l'ancien chemin mène toujours au nœud, en lecture comme en écriture ; déplacer
    // reste à la gestion.
    it("should let a writer publish a new title, the path following it, the old path still leading to the node", async () => {
      const lea = as("lea")
      await writeNode(lea.db, lea.identity, { path: "ventes/sans_titre_lea", title: "Sans titre", summary: "À compléter." }, { kind: "human" })
      const renamed = await writeNode(lea.db, lea.identity, { path: "ventes/sans_titre_lea", base_revision: 1, title: "Tarifs Léa 2026" }, { kind: "human" })
      expect(renamed.data).toMatchObject({ path: "ventes/tarifs_lea_2026", renamed_from: "ventes/sans_titre_lea", status: "published", revision: 2 })
      // E11-S18 (AC-6) : le chemin se choisit ensuite par `node.move`.
      expect(renamed.text.split("\n").at(-1)).toBe(
        `Renamed: now at ventes/tarifs_lea_2026; the old path ventes/sans_titre_lea still leads here. To choose the path, call ${lea.identity.org.prefix}_call node.move {"path": "ventes/tarifs_lea_2026", "new_path": "<path>"}.`,
      )
      const [alias] = await fx.admin<{ path: string }[]>`select old_path as path from platform.node_aliases where org_id = ${o.org.id} and old_path = 'ventes/sans_titre_lea'`
      expect(alias).toEqual({ path: "ventes/sans_titre_lea" })
      // Lu par l'ancien chemin : la ligne « moved to » en tête ; écrit par lui : le nœud modifié, et publié.
      const read = await readNode(lea.db, lea.identity, { path: "ventes/sans_titre_lea" })
      expect(read.text.split("\n")[0]).toMatch(/^ventes\/sans_titre_lea moved to ventes\/tarifs_lea_2026 on \d{4}-\d{2}-\d{2}: use the new path\.$/)
      expect(read.data).toMatchObject({ moved_from: "ventes/sans_titre_lea" })
      const written = await writeNode(lea.db, lea.identity, { path: "ventes/sans_titre_lea", base_revision: 2, ops: [{ op: "add_section", section: "Grille", text: "Tarif A." }] }, { kind: "agent", ctx: null })
      expect(written.text.split("\n")[0]).toMatch(/^ventes\/sans_titre_lea moved to ventes\/tarifs_lea_2026 on /)
      expect(written.data).toMatchObject({ moved_from: "ventes/sans_titre_lea", status: "published", revision: 3 })
      // Déplacer reste à la gestion : Léa est refusée.
      await expect(moveNode(lea.db, lea.identity, { path: "ventes/tarifs_lea_2026", new_path: "ventes/ailleurs" })).rejects.toMatchObject({ code: "forbidden" })
    })

    it("should publish a new title but keep the path when the writer cannot write under the parent, and log it (HN-E11S02-18)", async () => {
      const logged = vi.spyOn(console, "error").mockImplementation(() => undefined)
      const lea = as("lea")
      // Un dossier que Léa lit seulement, une page dessous qu'elle écrit (règles propres à Léa).
      const dossier = await page("ventes/lecture_seule")
      await fx.addRule({ orgId: o.org.id, nodeId: dossier, userId: o.people.lea.id, level: "read" })
      const child = await page("ventes/lecture_seule/note")
      await fx.addRule({ orgId: o.org.id, nodeId: child, userId: o.people.lea.id, level: "write" })
      const found = await findNode(lea.db, lea.identity, "ventes/lecture_seule/note")
      if (!found) throw new Error("ventes/lecture_seule/note not found")
      const published = await writeNode(lea.db, lea.identity, { path: "ventes/lecture_seule/note", base_revision: found.node.revision, title: "Note publiée" }, { kind: "human" })
      expect(published.data).toMatchObject({ path: "ventes/lecture_seule/note", status: "published", revision: found.node.revision + 1 })
      expect(published.data).not.toHaveProperty("renamed_from")
      expect(loggedText(logged)).toContain("[platform] followTitle: path kept")
      logged.mockRestore()
    })

    // E01-S12 partie c (HN-E01S12c-11) : un contenu à la corbeille garde son chemin ; six « Sans titre » à la
    // corbeille sous un même parent ne bloquent plus une création depuis le rail, qui va au premier chemin
    // libre, sans borne, et le dit (`data.path`). Un autre chemin pris par un nœud invisible reste refusé.
    it("should create an untitled node past every untitled path in the trash, at the first free path, and still refuse another taken path", async () => {
      const claire = as("claire")
      const folder = await page("ventes/brouillons")
      const untitled = (path: string) => writeNode(claire.db, claire.identity, { path, title: "Sans titre", summary: "À compléter." }, { kind: "human" })
      const paths = ["ventes/brouillons/sans_titre", ...Array.from({ length: 5 }, (_, index) => `ventes/brouillons/sans_titre_${index + 2}`)]
      for (const path of paths) {
        await untitled(path)
        await trashNode(claire.db, claire.identity, { path })
      }
      // Un septième, à la corbeille : le rail n'essaie que cinq adresses qu'il ne voit pas.
      await untitled("ventes/brouillons/sans_titre_7")
      await trashNode(claire.db, claire.identity, { path: "ventes/brouillons/sans_titre_7" })
      const created = await untitled("ventes/brouillons/sans_titre_3")
      expect(created.data).toMatchObject({ path: "ventes/brouillons/sans_titre_8" })
      expect((await findNode(claire.db, claire.identity, "ventes/brouillons/sans_titre_8"))?.node.parent_id).toBe(folder)
      await page("ventes/brouillons/fiche")
      await trashNode(claire.db, claire.identity, { path: "ventes/brouillons/fiche" })
      await expect(writeNode(claire.db, claire.identity, { path: "ventes/brouillons/fiche", title: "Fiche", summary: "Une fiche." }, { kind: "human" })).rejects.toMatchObject({
        code: "conflict",
      })
    })

    // M68 (Démo, `projet_toto`) : la procédure créée depuis le rail a suivi son titre, `sans_titre` reste son ancien
    // chemin. Le « + » de la page parente, qui ne voit pas les alias, demande `sans_titre` : un tableau y était
    // refusé (« A procedure cannot become a table »). Une création « Sans titre » va au premier chemin libre quand
    // l'adresse est un ancien chemin, ou un nœud qui ne peut pas prendre son genre ; sur un nœud qui le peut, elle
    // reste une modification sans révision, refusée, et ne crée rien.
    it("should create an untitled table, page or procedure at the first free path past an old path or a node of another kind", async () => {
      const claire = as("claire")
      await page("ventes/projet")
      const untitled = (path: string, kind: "page" | "table" | "procedure") =>
        writeNode(
          claire.db,
          claire.identity,
          { path, title: "Sans titre", summary: "À compléter.", kind, ...(kind === "table" ? { header: { columns: [{ name: "nom", type: "text" }], key: "nom" } } : {}) },
          { kind: "human" },
        )
      await untitled("ventes/projet/sans_titre", "procedure")
      // Créée publiée depuis E11-S02 (AC-c1) : révision 1.
      const renamed = await writeNode(claire.db, claire.identity, { path: "ventes/projet/sans_titre", base_revision: 1, title: "Procédure 1", publish: true }, { kind: "human" })
      expect(renamed.data).toMatchObject({ path: "ventes/projet/procedure_1", renamed_from: "ventes/projet/sans_titre" })
      const procedureRow = () => fx.admin<{ kind: string; revision: number }[]>`select kind, revision from platform.nodes where org_id = ${o.org.id} and path = 'ventes/projet/procedure_1'`
      const procedure = [...(await procedureRow())]

      expect((await untitled("ventes/projet/sans_titre", "table")).data).toMatchObject({ path: "ventes/projet/sans_titre_2" })
      expect((await untitled("ventes/projet/sans_titre", "page")).data).toMatchObject({ path: "ventes/projet/sans_titre_3" })
      expect((await untitled("ventes/projet/sans_titre", "procedure")).data).toMatchObject({ path: "ventes/projet/sans_titre_4" })
      // Un nœud visible d'un autre genre : un tableau à l'adresse d'une page, une page à l'adresse d'un tableau.
      expect((await untitled("ventes/projet/sans_titre_3", "table")).data).toMatchObject({ path: "ventes/projet/sans_titre_5" })
      expect((await untitled("ventes/projet/sans_titre_2", "page")).data).toMatchObject({ path: "ventes/projet/sans_titre_6" })
      // Un nœud qui peut prendre ce genre : rien n'est créé, la modification sans révision est refusée.
      await expect(untitled("ventes/projet/sans_titre_3", "procedure")).rejects.toMatchObject({ code: "stale_revision" })
      const kinds = await fx.admin<{ path: string; kind: string }[]>`
        select path, kind from platform.nodes where org_id = ${o.org.id} and starts_with(path, 'ventes/projet/') order by path`
      expect([...kinds]).toEqual([
        { path: "ventes/projet/procedure_1", kind: "procedure" },
        { path: "ventes/projet/sans_titre_2", kind: "table" },
        { path: "ventes/projet/sans_titre_3", kind: "page" },
        { path: "ventes/projet/sans_titre_4", kind: "procedure" },
        { path: "ventes/projet/sans_titre_5", kind: "table" },
        { path: "ventes/projet/sans_titre_6", kind: "page" },
      ])
      // La procédure atteinte par son ancien chemin n'a pas bougé.
      expect([...(await procedureRow())]).toEqual(procedure)
    })

    /** Une page créée comme depuis le rail (« Sans titre » à `parent/untitled`), puis titrée `title` et publiée. */
    async function titled(parent: string, untitled: string, title: string) {
      const claire = as("claire")
      await writeNode(claire.db, claire.identity, { path: `${parent}/${untitled}`, title: "Sans titre", summary: "À compléter.", publish: true }, { kind: "human" })
      return writeNode(claire.db, claire.identity, { path: `${parent}/${untitled}`, base_revision: 1, title, publish: true }, { kind: "human" })
    }

    /** La page à `path`, à sa révision `revision`, renommée `title` et publiée. */
    async function retitled(path: string, revision: number, title: string) {
      const claire = as("claire")
      return writeNode(claire.db, claire.identity, { path, base_revision: revision, title, publish: true }, { kind: "human" })
    }

    // E01-S12 partie c, correction 1 : le chemin suit le titre sans lire un suffixe dans le titre lui-même ; un
    // chemin qui suit déjà le nouveau titre, le sien compté libre, ne bouge pas.
    it("should move a node at tarifs_2026 retitled Tarifs to tarifs, and keep in place a path that already follows its new title", async () => {
      await page("ventes/suivi")
      expect((await titled("ventes/suivi", "sans_titre", "Tarifs 2026")).data).toMatchObject({ path: "ventes/suivi/tarifs_2026" })
      expect((await retitled("ventes/suivi/tarifs_2026", 2, "Tarifs")).data).toMatchObject({ path: "ventes/suivi/tarifs", renamed_from: "ventes/suivi/tarifs_2026" })
      const same = await retitled("ventes/suivi/tarifs", 3, "TARIFS")
      expect(same.data).toMatchObject({ path: "ventes/suivi/tarifs" })
      expect(same.data).not.toHaveProperty("renamed_from")
      // `tarifs` pris par la première : la seconde « Tarifs » est à `tarifs_2`, et y reste sous « Tarifs. ».
      expect((await titled("ventes/suivi", "sans_titre_2", "Tarifs")).data).toMatchObject({ path: "ventes/suivi/tarifs_2" })
      const kept = await retitled("ventes/suivi/tarifs_2", 2, "Tarifs.")
      expect(kept.data).toMatchObject({ path: "ventes/suivi/tarifs_2" })
      expect(kept.data).not.toHaveProperty("renamed_from")
    })

    // E01-S12 partie c, correction 1 (question de JB) : une adresse par titre sous un parent, à la création comme
    // au renommage ; un ancien chemin reste à son nœud, et le chemin d'un contenu à la corbeille n'est jamais repris.
    it("should give a title one address per parent, created or renamed: never an old path, never a path in the trash", async () => {
      await page("ventes/nord")
      await page("ventes/sud")
      // Deux parents : aucun suffixe.
      expect((await titled("ventes/nord", "sans_titre", "Tarifs")).data).toMatchObject({ path: "ventes/nord/tarifs" })
      expect((await titled("ventes/sud", "sans_titre", "Tarifs")).data).toMatchObject({ path: "ventes/sud/tarifs" })
      // Un parent : `_2` à la création, `_3` au renommage.
      expect((await titled("ventes/nord", "sans_titre_2", "Tarifs")).data).toMatchObject({ path: "ventes/nord/tarifs_2" })
      expect((await titled("ventes/nord", "sans_titre_3", "Devis")).data).toMatchObject({ path: "ventes/nord/devis" })
      expect((await retitled("ventes/nord/devis", 2, "Tarifs")).data).toMatchObject({ path: "ventes/nord/tarifs_3" })
      // « Tarifs » → « Prix » : `tarifs` reste l'ancien chemin de l'original, et une autre « Tarifs » va à `_2`.
      expect((await retitled("ventes/sud/tarifs", 2, "Prix")).data).toMatchObject({ path: "ventes/sud/prix", renamed_from: "ventes/sud/tarifs" })
      expect((await titled("ventes/sud", "sans_titre_2", "Tarifs")).data).toMatchObject({ path: "ventes/sud/tarifs_2" })
      expect((await titled("ventes/sud", "sans_titre_3", "Grille")).data).toMatchObject({ path: "ventes/sud/grille" })
      expect((await retitled("ventes/sud/grille", 2, "Tarifs")).data).toMatchObject({ path: "ventes/sud/tarifs_3" })
      const claire = as("claire")
      expect((await findNode(claire.db, claire.identity, "ventes/sud/tarifs"))?.node.path).toBe("ventes/sud/prix")
      // Un contenu à la corbeille garde son adresse.
      expect((await titled("ventes/nord", "sans_titre_4", "Offre")).data).toMatchObject({ path: "ventes/nord/offre" })
      await trashNode(claire.db, claire.identity, { path: "ventes/nord/offre" })
      expect((await titled("ventes/nord", "sans_titre_5", "Offre")).data).toMatchObject({ path: "ventes/nord/offre_2" })
    })
  })

  describe("general access (AC-b13, ADR-014)", () => {
    it("should open a node to the whole organisation at a level, change the level, then restrict it to the people added", async () => {
      await page("ventes/ouvert")
      const claire = as("claire")
      const marc = as("marc")
      const marcLevel = async () => (await findNode(marc.db, marc.identity, "ventes/ouvert"))?.level ?? 0
      const set = async (input: object) => (await setGeneralAccess(claire.db, claire.identity, { path: "ventes/ouvert", ...input })).data
      expect(await marcLevel()).toBe(0)
      expect(await set({ access: "organisation" })).toEqual({ path: "ventes/ouvert", access: "organisation", level: "read", changed: true })
      expect(await marcLevel()).toBe(1)
      expect(await set({ access: "organisation", level: "write" })).toMatchObject({ level: "write", changed: true })
      expect(await marcLevel()).toBe(2)
      // Léa, de l'équipe propriétaire, garde l'écriture ; la règle se lit à part des personnes et des équipes.
      expect((await findNode(as("lea").db, as("lea").identity, "ventes/ouvert"))?.level).toBe(2)
      const panel = await listNodeRules(claire.db, claire.identity, "ventes/ouvert")
      expect([panel.rules, panel.general?.level]).toEqual([[], "write"])
      expect(await set({ access: "organisation", level: "write" })).toMatchObject({ changed: false })
      expect(await set({ access: "restricted" })).toEqual({ path: "ventes/ouvert", access: "restricted", level: null, changed: true })
      expect([await marcLevel(), (await listNodeRules(claire.db, claire.identity, "ventes/ouvert")).general]).toEqual([0, null])
      expect(await set({ access: "restricted" })).toMatchObject({ changed: false })
    })

    it("should keep the full access to the administrator, refusing a lead before any write (D4)", async () => {
      await page("ventes/complet")
      const claire = as("claire")
      const spy = spyDb(claire.db)
      await expect(setGeneralAccess(spy.db, claire.identity, { path: "ventes/complet", access: "organisation", level: "manage" })).rejects.toMatchObject({ code: "forbidden" })
      expect(writesOf(spy.sent)).toEqual([])
      const ada = as("ada")
      await setGeneralAccess(ada.db, ada.identity, { path: "ventes/complet", access: "organisation", level: "manage" })
      expect((await findNode(as("marc").db, as("marc").identity, "ventes/complet"))?.level).toBe(3)
    })

    it("should refuse a private space, and a person without management, before any write", async () => {
      const [space] = await fx.admin<{ path: string }[]>`select path from platform.nodes where id = ${o.spaces.claire}`
      await page(`${space.path}/prive_g`)
      const claire = as("claire")
      const own = spyDb(claire.db)
      await expect(setGeneralAccess(own.db, claire.identity, { path: `${space.path}/prive_g`, access: "organisation" })).rejects.toMatchObject({
        code: "invalid_arguments",
      })
      expect(writesOf(own.sent)).toEqual([])
      await page("ventes/lecture_g")
      const lea = as("lea")
      const writer = spyDb(lea.db)
      await expect(setGeneralAccess(writer.db, lea.identity, { path: "ventes/lecture_g", access: "organisation" })).rejects.toMatchObject({ code: "forbidden" })
      expect(writesOf(writer.sent)).toEqual([])
    })
  })

  describe("links of a node (AC-b6)", () => {
    it("should give the outgoing and incoming links the person reads, with their totals", async () => {
      await page("ventes/lie", { blocks: ["Voir [[ventes/devis]]."], links: [{ block: 0, path: "ventes/devis" }] })
      const lea = as("lea")
      const out = await nodeLinks(lea.db, lea.identity, { path: "ventes/lie" })
      expect([out.links_out, out.links_out_total]).toEqual([[{ path: "ventes/devis", title: "Devis", status: "ok" }], 1])
      const into = await nodeLinks(lea.db, lea.identity, { path: "ventes/devis" })
      expect(into.links_in).toContainEqual({ path: "ventes/lie", title: "ventes/lie" })
      await expect(nodeLinks(as("marc").db, as("marc").identity, { path: "ventes/lie" })).rejects.toMatchObject({ code: "not_found" })
    })
  })
})
