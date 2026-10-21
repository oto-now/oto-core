// @vitest-environment node
// Les fichiers joints à la corbeille et à la duplication, sur une vraie base (E10-S02 lot e : AC-e2, AC-e3 ; ADR-016
// § 6, fiche D118). La purge de la corbeille supprime, dans l'instruction qui purge les nœuds, les lignes `files` des
// seuls nœuds purgés, puis leurs objets après le commit ; un échec du bucket nomme l'objet orphelin. La duplication
// d'une page copie chaque fichier qu'un bloc publié copié cite, sous un identifiant neuf, `pending` puis `ready` une
// fois l'objet copié, réécrit le `file_id` des blocs et de l'instantané de la copie, et compte au quota ; une copie en
// échec reste `pending`. Aucun fichier n'est cité par deux nœuds, et le lien public de la copie sert son fichier. La
// base est le sujet (`duplicate_subtree`, cascade, RLS) ; le bucket est l'adaptateur en mémoire, à la place de
// `fileStore()` et de `fetch`. Organisation de référence jetable. Suite portable.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { duplicateNode, listTrash, resolveIdentity, shareNode, trashNode, type Identity, type PlatformDb } from "@otomata_tech/oto_platform/server"
import { FILE_MAX_BYTES, FILE_TYPES, fileTypeOf, ORG_QUOTA_BYTES } from "../../packages/plateforme/schemas"
import { memoryFileStore, type MemoryFileStore } from "../../packages/plateforme/server/files/memory"
import { objectKey } from "../../packages/plateforme/server/files/store"
import { readPublicFile } from "../../packages/plateforme/server/shares"
import { loggedText } from "../helpers/logs"
import { hex } from "../helpers/plateforme"
import { privateFolderPending, privateFolderSuite } from "../helpers/pending-migrations"
import { createSqlFixtures, SQL_SKIP_REASON, sqlConfigured, type SqlFixtures, type SqlReferenceOrg } from "../helpers/sql"

// Le bucket du test : `null` joue un hôte sans les cinq variables (AC-a1).
const storage = vi.hoisted(() => ({ store: null as MemoryFileStore | null }))

vi.mock("../../packages/plateforme/server/files/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../packages/plateforme/server/files/store")>()),
  fileStore: () => storage.store,
}))

// Ces tests supposent le dossier `private` en base (fiche D107), comme l'organisation de référence.
const privatePending = await privateFolderPending()

const NETWORK_TIMEOUT = 60_000
const SETUP_TIMEOUT = 180_000
const SUITE = "attached files in the trash and in a duplicated page on a real database (E10-S02, lot e)"

type Person = "ada" | "lea"
type Session = { db: PlatformDb; identity: Identity }
type FileLine = { id: string; path: string; name: string; status: string }

const bytesOf = (text: string) => new TextEncoder().encode(text)

describe.skipIf(!sqlConfigured || privatePending)(privateFolderSuite(sqlConfigured ? SUITE : `${SUITE} (${SQL_SKIP_REASON})`, privatePending), { timeout: NETWORK_TIMEOUT }, () => {
  let fx: SqlFixtures
  let o: SqlReferenceOrg
  let memory: MemoryFileStore
  const sessions = new Map<Person, Session>()

  beforeAll(async () => {
    fx = createSqlFixtures()
    o = await fx.buildReferenceOrg()
    for (const person of ["ada", "lea"] as const) {
      const user = o.people[person]
      const db = fx.as(user)
      sessions.set(person, { db, identity: await resolveIdentity(db, o.host, { userId: user.id, email: user.email }) })
    }
    memory = memoryFileStore()
    storage.store = memory
  }, SETUP_TIMEOUT)

  afterEach(() => {
    storage.store = memory
    memory.failing.clear()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  afterAll(async () => {
    await fx?.cleanup()
  }, SETUP_TIMEOUT)

  const as = (person: Person): Session => {
    const session = sessions.get(person)
    if (!session) throw new Error(`no session for ${person}`)
    return session
  }

  /** Une page sous `ventes` (équipe Ventes : Léa y écrit ; Ada, administratrice, gère tout), titrée de son dernier segment. */
  const page = (path: string, parentId = o.nodes.ventes) => fx.createNode(o.org.id, { parentId, path, title: path.split("/").at(-1) })

  /** Une ligne `ready` posée par la connexion d'administration, et son objet dans le bucket quand on en donne. */
  async function attached(nodeId: string, name: string, bytes: Uint8Array | null): Promise<string> {
    const mime = FILE_TYPES[fileTypeOf(name) ?? "zip"]
    const [row] = await fx.admin<{ id: string }[]>`
      insert into platform.files (org_id, node_id, name, mime, size, status, created_by)
      values (${o.org.id}, ${nodeId}, ${name}, ${mime}, ${Math.max(bytes?.byteLength ?? 1, 1)}, 'ready', ${o.people.lea.id}) returning id`
    if (bytes) memory.objects.set(objectKey(o.org.id, row.id), { bytes, mime })
    return row.id
  }

  /** Le bloc `file` qui cite un fichier posé par `attached`. */
  async function fileBlock(id: string) {
    const [row] = await fx.admin<{ name: string; size: string; mime: string }[]>`select name, size::text, mime from platform.files where id = ${id}`
    return { type: "file" as const, data: { file_id: id, name: row.name, size: Number(row.size), mime: row.mime } }
  }

  /** Les fichiers joints au sous-arbre de `path`, par chemin puis par nom. */
  const filesUnder = (path: string) => fx.admin<FileLine[]>`
    select f.id::text, n.path, f.name, f.status from platform.files f join platform.nodes n on n.id = f.node_id
     where f.org_id = ${o.org.id} and (n.path = ${path} or starts_with(n.path, ${`${path}/`})) order by n.path, f.name`

  /** Les `file_id` que citent les blocs publiés et l'instantané publié du sous-arbre de `path`, par chemin. */
  const citedUnder = (path: string) => fx.admin<{ path: string; blocks: string[]; snapshot: string[] }[]>`
    select n.path,
           coalesce((select array_agg(b.data ->> 'file_id' order by b.position) from platform.blocks b
                      where b.node_id = n.id and b.state = 'published' and b.data ? 'file_id'), '{}') as blocks,
           coalesce((select array_agg(x -> 'data' ->> 'file_id' order by (x ->> 'position')::float8)
                       from platform.node_versions v, jsonb_array_elements(v.blocks) x
                      where v.node_id = n.id and v.revision = n.revision and x -> 'data' ? 'file_id'), '{}') as snapshot
      from platform.nodes n
     where n.org_id = ${o.org.id} and (n.path = ${path} or starts_with(n.path, ${`${path}/`})) order by n.path`

  /** Une page et sa sous-page, chacune avec un fichier qu'un bloc publié cite ; la page, un fichier que rien ne cite. */
  async function pageWithFiles(path: string) {
    const node = await page(path)
    const child = await page(`${path}/sous`, node)
    const ids = {
      devis: await attached(node, "devis.pdf", bytesOf("%PDF devis")),
      seul: await attached(node, "seul.pdf", bytesOf("%PDF seul")),
      plan: await attached(child, "plan.png", bytesOf("png plan")),
    }
    await fx.publishBlocks(node, [await fileBlock(ids.devis), { type: "paragraph", text: "Le devis." }])
    await fx.publishBlocks(child, [{ type: "image", data: { file_id: ids.plan, alt: "Plan" } }])
    return ids
  }

  describe("duplication (AC-e3)", () => {
    it("should copy each cited file under a new id, pending then ready once its object is copied, with the blocks and the snapshot of the copy citing it", async () => {
      const path = `ventes/e_dup_${hex(3)}`
      const ids = await pageWithFiles(path)
      const lea = as("lea")

      const copied = await duplicateNode(lea.db, lea.identity, { path })
      const copyPath = copied.data.path
      const copies = await filesUnder(copyPath)
      const byName = new Map(copies.map((file) => [file.name, file.id]))
      const devis = byName.get("devis.pdf") ?? ""
      const plan = byName.get("plan.png") ?? ""

      expect({
        count: copied.data.count,
        files: copies.map(({ path: at, name, status }) => ({ at, name, status })),
        fresh: [devis, plan].filter((id) => Object.values(ids).includes(id)),
        cited: [...(await citedUnder(copyPath))],
        objects: [devis, plan].map((id) => new TextDecoder().decode(memory.objects.get(objectKey(o.org.id, id))?.bytes)),
        source: (await filesUnder(path)).map((file) => file.id).sort(),
      }).toEqual({
        count: 2,
        // Un fichier que rien de publié ne cite (`seul.pdf`) ne se lit pas dans la copie : il ne se copie pas.
        files: [
          { at: copyPath, name: "devis.pdf", status: "ready" },
          { at: `${copyPath}/sous`, name: "plan.png", status: "ready" },
        ],
        fresh: [],
        cited: [
          { path: copyPath, blocks: [devis], snapshot: [devis] },
          { path: `${copyPath}/sous`, blocks: [plan], snapshot: [plan] },
        ],
        objects: ["%PDF devis", "png plan"],
        source: Object.values(ids).sort(),
      })
    })

    it("should leave a file whose object cannot be copied pending, naming it in the server log, and never cite a file from two nodes", async () => {
      const path = `ventes/e_dup_${hex(3)}`
      const ids = await pageWithFiles(path)
      // L'objet du plan a disparu du bucket : sa copie échoue, celle du devis passe.
      memory.objects.delete(objectKey(o.org.id, ids.plan))
      const errors = vi.spyOn(console, "error").mockImplementation(() => undefined)
      const lea = as("lea")

      const copyPath = (await duplicateNode(lea.db, lea.identity, { path })).data.path
      const copies = await filesUnder(copyPath)
      const plan = copies.find((file) => file.name === "plan.png")?.id ?? ""
      const shared = await fx.admin<{ file_id: string }[]>`
        select b.data ->> 'file_id' as file_id from platform.blocks b
         where b.org_id = ${o.org.id} and b.state = 'published' and b.data ? 'file_id'
         group by 1 having count(distinct b.node_id) > 1`
      const foreign = await fx.admin<{ file_id: string }[]>`
        select b.data ->> 'file_id' as file_id from platform.blocks b
          join platform.files f on f.id = (b.data ->> 'file_id')::uuid
         where b.org_id = ${o.org.id} and b.state = 'published' and f.node_id <> b.node_id`

      expect({
        statuses: copies.map(({ name, status }) => [name, status]),
        logged: loggedText(errors).includes(`[platform] files: copy left pending ${objectKey(o.org.id, plan)}`),
        shared: [...shared],
        foreign: [...foreign],
      }).toEqual({ statuses: [["devis.pdf", "ready"], ["plan.png", "pending"]], logged: true, shared: [], foreign: [] })
    })

    it("should serve a copied file by a public link of the copy, and not the file of the original", async () => {
      vi.stubGlobal("fetch", memory.fetch)
      const path = `ventes/e_dup_${hex(3)}`
      const ids = await pageWithFiles(path)
      const lea = as("lea")
      const ada = as("ada")
      const copyPath = (await duplicateNode(lea.db, lea.identity, { path })).data.path
      const devis = (await filesUnder(copyPath)).find((file) => file.name === "devis.pdf")?.id ?? ""
      const { share } = (await shareNode(ada.db, ada.identity, { path: copyPath, include_children: false })).data

      const served = await readPublicFile(o.host, share.token, devis)
      const original = await readPublicFile(o.host, share.token, ids.devis).then(
        () => "served",
        (error: { code?: string }) => error.code,
      )
      expect({ served: [served.name, served.nodePath], original }).toEqual({ served: ["devis.pdf", copyPath], original: "not_found" })
    })

    it("should refuse a copy that would take the files of the organization beyond the quota, writing nothing", async () => {
      const segment = `e_dup_${hex(3)}`
      const path = `ventes/${segment}`
      await pageWithFiles(path)
      const filler = await page(`ventes/e_quota_${hex(3)}`)
      // Des lignes de 50 Mo au plus, jusqu'au quota exactement : la copie des deux fichiers le dépasse.
      const [{ used }] = await fx.admin<{ used: string }[]>`
        select coalesce(sum(size), 0)::text as used from platform.files where org_id = ${o.org.id} and status in ('pending', 'ready')`
      const needed = ORG_QUOTA_BYTES - Number(used)
      const rows = Math.ceil(needed / FILE_MAX_BYTES)
      await fx.admin`
        insert into platform.files (org_id, node_id, name, mime, size, status)
        select ${o.org.id}, ${filler}, 'remplissage.zip', 'application/zip',
               case when i < ${rows} then ${FILE_MAX_BYTES}::bigint else ${needed - (rows - 1) * FILE_MAX_BYTES}::bigint end, 'ready'
          from generate_series(1, ${rows}) as i`
      const lea = as("lea")
      try {
        const refused = await duplicateNode(lea.db, lea.identity, { path }).then(
          () => null,
          (error: { code?: string; details?: unknown }) => ({ code: error.code, details: error.details }),
        )
        const [{ copies }] = await fx.admin<{ copies: number }[]>`
          select count(*)::int as copies from platform.nodes where org_id = ${o.org.id} and title = ${`${segment} (copie)`}`
        expect({ refused, copies }).toEqual({ refused: { code: "too_large", details: { reason: "quota", max: ORG_QUOTA_BYTES } }, copies: 0 })
      } finally {
        await fx.admin`delete from platform.files where node_id = ${filler}`
      }
    })
  })

  describe("trash purge (AC-e2)", () => {
    it("should delete the files of the purged nodes with them and their objects after the commit, keep those of live nodes, and name an orphan object", async () => {
      const ada = as("ada")
      const purged = await page(`ventes/e_purge_${hex(3)}`)
      const orphan = await page(`ventes/e_purge_${hex(3)}`)
      const live = await page(`ventes/e_vivant_${hex(3)}`)
      const gone = await attached(purged, "ancien.pdf", bytesOf("%PDF ancien"))
      const left = await attached(orphan, "orphelin.pdf", bytesOf("%PDF orphelin"))
      // Un fichier que plus aucun bloc ne cite vit aussi longtemps que son nœud (ADR-016 § 6).
      const kept = await attached(live, "garde.pdf", bytesOf("%PDF garde"))
      const pathOf = async (id: string) => (await fx.admin<{ path: string }[]>`select path from platform.nodes where id = ${id}`)[0].path
      const age = (id: string) => fx.admin`update platform.nodes set deleted_at = now() - interval '31 days' where id = ${id}`
      const rows = async () => (await fx.admin<{ id: string }[]>`select id::text from platform.files where id in (${gone}, ${left}, ${kept}) order by name`).map((row) => row.id)

      await trashNode(ada.db, ada.identity, { path: await pathOf(purged) })
      await trashNode(ada.db, ada.identity, { path: await pathOf(orphan) })
      await age(purged)
      await listTrash(ada.db, ada.identity)
      const afterFirst = { rows: await rows(), object: memory.objects.has(objectKey(o.org.id, gone)) }

      await age(orphan)
      memory.failing.add("remove")
      const errors = vi.spyOn(console, "error").mockImplementation(() => undefined)
      await listTrash(ada.db, ada.identity)

      expect({
        afterFirst,
        rows: await rows(),
        logged: loggedText(errors).includes(`[platform] files: orphan ${objectKey(o.org.id, left)}`),
        kept: memory.objects.has(objectKey(o.org.id, kept)),
      }).toEqual({ afterFirst: { rows: [kept, left], object: false }, rows: [kept], logged: true, kept: true })
    })
  })
})
