// @vitest-environment node
// Les fichiers joints sur une vraie base (E10-S02 lot a, ADR-016) : la migration (bloc `file`, image interne,
// texte cherchable, AC-a2), la demande d'envoi et l'ordre de ses refus, le quota lu sous le verrou de
// l'organisation (AC-a3), la confirmation et le droit qu'elle relit (AC-a4), la lecture et sa même réponse
// `not_found` (AC-a5), la disponibilité d'un fichier (AC-b8), la purge des envois abandonnés (AC-a6) et le texte
// d'un fichier, lu par `read {file}` et son lecteur (AC-a8). La base est le sujet : table `files`, RLS
// d'isolation, verrou consultatif. Le bucket est l'adaptateur en mémoire, à la place de `fileStore()` et de
// `fetch` : aucun service extérieur. Chaque refus est décidé avant toute insertion (espion `spyDb`,
// `security-patterns.md § Droits dans le service`). Organisation de référence jetable (H120). Suite portable.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { readNode, resolveIdentity, type Identity, type PlatformDb } from "@otomata_tech/oto_platform/server"
import { FILE_MAX_BYTES, FILE_TYPES, fileTypeOf, ORG_QUOTA_BYTES, TEXT_FILE_MAX_BYTES } from "../../packages/plateforme/schemas"
import { memoryFileStore, type MemoryFileStore } from "../../packages/plateforme/server/files/memory"
import { completeFileUpload, fileAvailability, fileReadUrl, requestFileUpload } from "../../packages/plateforme/server/files/service"
import { objectKey, STORAGE_VARIABLES } from "../../packages/plateforme/server/files/store"
import { listTrash } from "../../packages/plateforme/server/nodes/trash"
import { loggedText } from "../helpers/logs"
import { codeOf, createSqlFixtures, spyDb, SQL_SKIP_REASON, sqlConfigured, type SentQuery, type SqlFixtures, type SqlReferenceOrg } from "../helpers/sql"
import { privateFolderPending, privateFolderSuite } from "../helpers/pending-migrations"

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
const SUITE = "attached files on a real database (E10-S02, lot a)"

/** Le verrou consultatif du quota (`server/files/service.ts`). */
const QUOTA_LOCK = 7501

type Person = "ada" | "claire" | "lea" | "paul"
type Session = { db: PlatformDb; identity: Identity }

const bytesOf = (text: string) => new TextEncoder().encode(text)

describe.skipIf(!sqlConfigured || privatePending)(privateFolderSuite(sqlConfigured ? SUITE : `${SUITE} (${SQL_SKIP_REASON})`, privatePending), { timeout: NETWORK_TIMEOUT }, () => {
  let fx: SqlFixtures
  let o: SqlReferenceOrg
  let memory: MemoryFileStore
  const sessions = new Map<Person, Session>()

  beforeAll(async () => {
    fx = createSqlFixtures()
    o = await fx.buildReferenceOrg()
    for (const person of ["ada", "claire", "lea", "paul"] as const) {
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

  /** Une page sous `ventes` (équipe Ventes : Claire et Léa y écrivent, Paul ne la voit pas). */
  const page = (path: string) => fx.createNode(o.org.id, { parentId: o.nodes.ventes, path, title: path })

  /** Une ligne `ready` posée par la connexion d'administration, et son objet dans le bucket quand on en donne. */
  async function readyFile(nodeId: string, name: string, bytes: Uint8Array | null, orgId = o.org.id): Promise<string> {
    const mime = FILE_TYPES[fileTypeOf(name) ?? "zip"]
    const [row] = await fx.admin<{ id: string }[]>`
      insert into platform.files (org_id, node_id, name, mime, size, status, created_by)
      values (${orgId}, ${nodeId}, ${name}, ${mime}, ${Math.max(bytes?.byteLength ?? 1, 1)}, 'ready', ${o.people.lea.id}) returning id`
    if (bytes) memory.objects.set(objectKey(orgId, row.id), { bytes, mime })
    return row.id
  }

  /** L'issue d'un appel : ce qu'il rend, ou le code, le message et les détails de son refus. */
  type Outcome<T> = { value?: T; code?: string; message?: string; details?: unknown }
  const outcome = <T>(run: Promise<T>): Promise<Outcome<T>> =>
    run.then(
      (value) => ({ value }),
      (error: { code?: string; message?: string; details?: unknown }) => ({ code: error.code, message: error.message, details: error.details }),
    )

  const fileInserts = (sent: readonly SentQuery[]) => sent.filter((query) => query.op === "insert" && query.target === "files")

  describe("migration (AC-a2)", () => {
    it("should accept a file block and index its name, accept an internal image, and refuse the malformed forms", async () => {
      const node = await page("ventes/f_migration")
      await fx.admin`select * from platform.open_draft(${node})`
      const fileId = "0c9e8d7f-6a5b-4c3d-8e2f-1a0b9c8d7e6f"
      let position = 0
      const insert = (type: string, data: Record<string, unknown>) =>
        codeOf(fx.admin`insert into platform.blocks (node_id, state, position, type, data) values (${node}, 'draft', ${(position += 1024)}, ${type}, ${fx.admin.json(JSON.parse(JSON.stringify(data)))})`)
      const verdicts = {
        file: await insert("file", { file_id: fileId, name: "Rapport mars.pdf", size: 1200, mime: "application/pdf" }),
        emptyFile: await insert("file", { file_id: fileId, name: "Rapport mars.pdf", size: 0, mime: "application/pdf" }),
        fileWithoutName: await insert("file", { file_id: fileId, size: 12, mime: "application/pdf" }),
        internalImage: await insert("image", { file_id: fileId, alt: "Plan", width: "medium" }),
        imageWithBoth: await insert("image", { file_id: fileId, src: "https://x.test/a.png" }),
        imageWithNullId: await insert("image", { file_id: null }),
      }
      expect(verdicts).toEqual({ file: null, emptyFile: "23514", fileWithoutName: "23514", internalImage: null, imageWithBoth: "23514", imageWithNullId: "23514" })
      const [{ text }] = await fx.admin<{ text: string }[]>`
        select platform.block_search_text('file', null, ${fx.admin.json({ file_id: fileId, name: "Rapport mars.pdf", size: 1200, mime: "application/pdf" })}, null) as text`
      expect(text).toBe("Rapport mars.pdf")
    })
  })

  describe("upload request (AC-a1, AC-a3)", () => {
    it("should refuse in order: storage, write on the node, type, size; before inserting any file", async () => {
      const node = await page("ventes/f_ordre")
      const paul = as("paul")
      const lea = as("lea")
      const spies = [spyDb(paul.db), spyDb(lea.db)]
      const request = (session: Session, db: PlatformDb, name: string, size: number) => outcome(requestFileUpload(db, session.identity, { node: "ventes/f_ordre", name, mime: "", size }))

      storage.store = null
      const disabled = await request(paul, spies[0].db, "setup.exe", 0)
      storage.store = memory
      const unreadable = await request(paul, spies[0].db, "setup.exe", 0)
      const rule = await fx.addRule({ orgId: o.org.id, nodeId: node, userId: o.people.paul.id, level: "read" })
      const readOnly = await request(paul, spies[0].db, "setup.exe", 0)
      await fx.admin`delete from platform.access_rules where id = ${rule}`
      const badType = await request(lea, spies[1].db, "setup.exe", FILE_MAX_BYTES + 1)
      const tooBig = await request(lea, spies[1].db, "rapport.pdf", FILE_MAX_BYTES + 1)
      const tooBigText = await request(lea, spies[1].db, "notes.md", TEXT_FILE_MAX_BYTES + 1)
      const empty = await request(lea, spies[1].db, "rapport.pdf", 0)

      expect({ code: disabled.code, named: STORAGE_VARIABLES.every((name) => disabled.message?.includes(name)) }).toEqual({ code: "not_enabled", named: true })
      expect(unreadable).toMatchObject({ code: "not_found", message: expect.stringContaining("Unknown path ventes/f_ordre") })
      expect(readOnly).toMatchObject({ code: "forbidden", message: "Writing ventes/f_ordre is reserved to team Ventes (lead: Claire Morel). Ask them for access." })
      expect(badType).toMatchObject({ code: "invalid_arguments", message: expect.stringContaining("Admitted extensions: png, jpeg, jpg, gif, webp, svg, pdf, csv, txt, md, html, docx, xlsx, pptx, odt, ods, zip") })
      expect([tooBig.code, tooBigText.code, empty.code]).toEqual(["too_large", "too_large", "too_large"])
      expect(spies.flatMap((spy) => fileInserts(spy.sent))).toEqual([])
    })

    it("should create a pending row typed by the extension, then make it ready once the object is uploaded and confirmed (AC-a3, AC-a4)", async () => {
      const node = await page("ventes/f_envoi")
      const lea = as("lea")
      const requested = await requestFileUpload(lea.db, lea.identity, { node: "ventes/f_envoi", name: "Notes.MD", mime: "", size: 5 })
      const { id, upload } = requested.data
      const [pending] = await fx.admin`select node_id, name, mime, size::int as size, status, created_by from platform.files where id = ${id}`
      expect({ row: { ...pending }, target: requested.target, headers: upload.headers }).toEqual({
        row: { node_id: node, name: "Notes.MD", mime: "text/markdown", size: 5, status: "pending", created_by: o.people.lea.id },
        target: "ventes/f_envoi",
        headers: { "content-type": "text/markdown" },
      })

      const sent = await memory.fetch(upload.url, { method: "PUT", headers: upload.headers, body: bytesOf("# Hi\n") })
      const confirmed = await completeFileUpload(lea.db, lea.identity, id)
      const [ready] = await fx.admin`select status from platform.files where id = ${id}`
      expect({ uploaded: sent.status, data: confirmed.data, status: ready.status }).toEqual({
        uploaded: 200,
        data: { id, name: "Notes.MD", size: 5, mime: "text/markdown" },
        status: "ready",
      })
    })

    it("should read the quota under the lock of the organisation, counting pending and ready rows (AC-a3, 5)", async () => {
      const node = await page("ventes/f_quota")
      const lea = as("lea")
      const [{ used }] = await fx.admin<{ used: string }[]>`select coalesce(sum(size), 0)::text as used from platform.files where org_id = ${o.org.id}`
      // Il reste ensuite entre 50 et 100 Mo : un fichier de 50 Mo passe seul, pas avec un autre.
      const fill = Math.floor((ORG_QUOTA_BYTES - Number(used)) / FILE_MAX_BYTES) - 1
      await fx.admin`
        insert into platform.files (org_id, node_id, name, mime, size, status, created_by)
        select ${o.org.id}, ${node}, 'plein.zip', 'application/zip', ${FILE_MAX_BYTES}, case when g % 2 = 0 then 'pending' else 'ready' end, ${o.people.lea.id}
          from generate_series(1, ${fill}) g`
      try {
        let concurrent: Promise<unknown> = Promise.resolve()
        // Une demande concurrente tient le verrou et vient d'insérer sa ligne `pending` : la demande de Léa l'attend,
        // puis la compte. Sans le verrou, elle aurait lu le quota avant et passé.
        await fx.admin.begin(async (tx) => {
          await tx`select pg_catalog.pg_advisory_xact_lock(${QUOTA_LOCK}, pg_catalog.hashtext(${o.org.id}::text))`
          await tx`
            insert into platform.files (org_id, node_id, name, mime, size, status, created_by)
            values (${o.org.id}, ${node}, 'concurrent.zip', 'application/zip', ${FILE_MAX_BYTES}, 'pending', ${o.people.claire.id})`
          concurrent = outcome(requestFileUpload(lea.db, lea.identity, { node: "ventes/f_quota", name: "rapport.pdf", mime: "application/pdf", size: FILE_MAX_BYTES }))
          for (let tries = 0; ; tries += 1) {
            const [{ waiting }] = await fx.admin<{ waiting: boolean }[]>`
              select exists (select 1 from pg_catalog.pg_locks where locktype = 'advisory' and classid = ${QUOTA_LOCK} and not granted) as waiting`
            if (waiting) break
            if (tries > 500) throw new Error("the request never waited for the quota lock")
            await new Promise((resolve) => setTimeout(resolve, 20))
          }
        })
        expect(await concurrent).toMatchObject({ code: "too_large", details: { reason: "quota" } })
      } finally {
        await fx.admin`delete from platform.files where org_id = ${o.org.id} and node_id = ${node}`
      }
    })
  })

  describe("confirmation (AC-a4)", () => {
    it("should refuse another person and a row already ready, and say conflict for an absent or a mismatching object", async () => {
      await page("ventes/f_confirme")
      const lea = as("lea")
      const claire = as("claire")
      const request = () => requestFileUpload(lea.db, lea.identity, { node: "ventes/f_confirme", name: "r.pdf", mime: "application/pdf", size: 4 })

      const absent = (await request()).data.id
      const otherPerson = await outcome(completeFileUpload(claire.db, claire.identity, absent))
      const notUploaded = await outcome(completeFileUpload(lea.db, lea.identity, absent))
      const [stillPending] = await fx.admin`select status from platform.files where id = ${absent}`

      const mismatching = (await request()).data.id
      memory.objects.set(objectKey(o.org.id, mismatching), { bytes: bytesOf("12345"), mime: "application/pdf" })
      // Le log part avant la suppression : il garde la preuve que la ligne et l'objet emportent.
      const objectWhenLogged: boolean[] = []
      const errors = vi.spyOn(console, "error").mockImplementation(() => {
        objectWhenLogged.push(memory.objects.has(objectKey(o.org.id, mismatching)))
      })
      const mismatch = await outcome(completeFileUpload(lea.db, lea.identity, mismatching))
      const logged = loggedText(errors)
      errors.mockRestore()
      const [gone] = await fx.admin<{ n: number }[]>`select count(*)::int as n from platform.files where id = ${mismatching}`

      const done = await request()
      await memory.fetch(done.data.upload.url, { method: "PUT", headers: done.data.upload.headers, body: bytesOf("1234") })
      await completeFileUpload(lea.db, lea.identity, done.data.id)
      const again = await outcome(completeFileUpload(lea.db, lea.identity, done.data.id))

      expect({
        otherPerson: otherPerson.code,
        notUploaded: notUploaded.code,
        stillPending: stillPending.status,
        mismatch: { code: mismatch.code, message: mismatch.message },
        logged,
        objectWhenLogged,
        rowGone: gone.n,
        objectGone: memory.objects.has(objectKey(o.org.id, mismatching)),
        again: again.code,
      }).toEqual({
        otherPerson: "not_found",
        notUploaded: "conflict",
        stillPending: "pending",
        mismatch: { code: "conflict", message: "r.pdf does not match its request: 4 bytes announced, 5 bytes stored. Upload it again." },
        logged: `[platform] files: size mismatch { id: '${mismatching}', announced: 4, stored: 5 }`,
        objectWhenLogged: [true],
        rowGone: 0,
        objectGone: false,
        again: "not_found",
      })
    })

    it("should keep the pending row and its object when the storage gives no size, and confirm them on a later try (HN-E10S02-124)", async () => {
      await page("ventes/f_sans_taille")
      const lea = as("lea")
      const { data } = await requestFileUpload(lea.db, lea.identity, { node: "ventes/f_sans_taille", name: "page.html", mime: "text/html", size: 4 })
      await memory.fetch(data.upload.url, { method: "PUT", headers: data.upload.headers, body: bytesOf("<p/>") })
      const errors = vi.spyOn(console, "error").mockImplementation(() => {})
      vi.spyOn(memory, "head").mockResolvedValueOnce({ size: null, mime: "text/plain" })
      const unknown = await outcome(completeFileUpload(lea.db, lea.identity, data.id))
      const [kept] = await fx.admin<{ status: string }[]>`select status from platform.files where id = ${data.id}`
      const objectKept = memory.objects.has(objectKey(o.org.id, data.id))
      const later = await completeFileUpload(lea.db, lea.identity, data.id)
      expect({ code: unknown.code, message: unknown.message, logged: loggedText(errors), status: kept.status, objectKept, later: later.data.size }).toEqual({
        code: "internal",
        message: "page.html was uploaded, but the file storage gave no size: confirm it again later.",
        logged: `[platform] files: size unknown { id: '${data.id}', announced: 4 }`,
        status: "pending",
        objectKept: true,
        later: 4,
      })
    })

    it("should confirm an HTML file that the storage reads back as text/plain, like Supabase Storage, on its size alone", async () => {
      await page("ventes/f_html")
      const lea = as("lea")
      const html = bytesOf("<h1>Rapport</h1>")
      const { data } = await requestFileUpload(lea.db, lea.identity, { node: "ventes/f_html", name: "rapport.html", mime: "text/html", size: html.byteLength })
      const sent = await memory.fetch(data.upload.url, { method: "PUT", headers: data.upload.headers, body: html })
      const confirmed = await outcome(completeFileUpload(lea.db, lea.identity, data.id))
      const [row] = await fx.admin<{ status: string }[]>`select status from platform.files where id = ${data.id}`
      expect({ uploaded: sent.status, readBack: await memory.head(objectKey(o.org.id, data.id)), code: confirmed.code, data: confirmed.value?.data, status: row?.status }).toEqual({
        uploaded: 200,
        readBack: { size: html.byteLength, mime: "text/plain" },
        code: undefined,
        data: { id: data.id, name: "rapport.html", size: html.byteLength, mime: "text/html" },
        status: "ready",
      })
    })

    it("should read the write right again: a node rule removed since the request refuses the confirmation, before any update of files", async () => {
      const node = await page("ventes/f_retire")
      const paul = as("paul")
      // Paul lit `ventes` par une règle sur le dossier, et écrit la page par une règle sur elle, retirée après la demande.
      const reads = await fx.addRule({ orgId: o.org.id, nodeId: o.nodes.ventes, userId: o.people.paul.id, level: "read" })
      const writes = await fx.addRule({ orgId: o.org.id, nodeId: node, userId: o.people.paul.id, level: "write" })
      try {
        const { data } = await requestFileUpload(paul.db, paul.identity, { node: "ventes/f_retire", name: "r.pdf", mime: "application/pdf", size: 4 })
        await memory.fetch(data.upload.url, { method: "PUT", headers: data.upload.headers, body: bytesOf("1234") })
        await fx.admin`delete from platform.access_rules where id = ${writes}`
        const spy = spyDb(paul.db)
        const refused = await outcome(completeFileUpload(spy.db, paul.identity, data.id))
        const [row] = await fx.admin<{ status: string }[]>`select status from platform.files where id = ${data.id}`
        expect({
          code: refused.code,
          status: row.status,
          updates: spy.sent.filter((query) => query.op === "update" && query.target === "files"),
        }).toEqual({ code: "forbidden", status: "pending", updates: [] })
      } finally {
        await fx.admin`delete from platform.access_rules where id in (${reads}, ${writes})`
      }
    })
  })

  describe("read (AC-a5)", () => {
    it("should give a presigned URL to a reader, and the same not_found for another organisation, a pending row, an unreadable or trashed node", async () => {
      const readable = await page("ventes/f_lecture")
      const trashed = await page("ventes/f_jetee")
      const claire = as("claire")
      const paul = as("paul")
      const file = await readyFile(readable, "plan.png", bytesOf("png"))
      const inTrash = await readyFile(trashed, "plan.png", bytesOf("png"))
      await fx.admin`update platform.nodes set deleted_at = now() where id = ${trashed}`
      const other = await fx.createOrg()
      const otherTree = await fx.createTree(other.id)
      const elsewhere = await readyFile(otherTree.root, "plan.png", bytesOf("png"), other.id)
      const [{ id: pending }] = await fx.admin<{ id: string }[]>`
        insert into platform.files (org_id, node_id, name, mime, size, status, created_by)
        values (${o.org.id}, ${readable}, 'brouillon.png', 'image/png', 3, 'pending', ${o.people.claire.id}) returning id`

      const url = new URL(await fileReadUrl(claire.db, claire.identity, file, {}))
      const refusals = await Promise.all([
        outcome(fileReadUrl(paul.db, paul.identity, file, {})),
        outcome(fileReadUrl(claire.db, claire.identity, elsewhere, {})),
        outcome(fileReadUrl(claire.db, claire.identity, pending, {})),
        outcome(fileReadUrl(claire.db, claire.identity, inTrash, {})),
        outcome(fileReadUrl(claire.db, claire.identity, "pas-un-id", {})),
      ])
      expect({
        key: url.pathname.slice(1),
        type: url.searchParams.get("response-content-type"),
        disposition: url.searchParams.get("response-content-disposition"),
        refusals: refusals.map((refusal) => ({ code: refusal.code, message: refusal.message })),
      }).toEqual({
        key: objectKey(o.org.id, file),
        type: "image/png",
        disposition: "inline",
        refusals: Array.from({ length: 5 }, () => ({ code: "not_found", message: "Unknown file." })),
      })
    })
  })

  describe("availability (AC-b8)", () => {
    it("should say a readable file available while the storage holds its object, unavailable once gone, and the same not_found to who cannot read it", async () => {
      const node = await page("ventes/f_disponible")
      const claire = as("claire")
      const paul = as("paul")
      const served = await readyFile(node, "plan.png", bytesOf("png"))
      const lost = await readyFile(node, "perdu.pdf", null)
      const answers = [
        await outcome(fileAvailability(claire.db, claire.identity, served)),
        await outcome(fileAvailability(claire.db, claire.identity, lost)),
        await outcome(fileAvailability(paul.db, paul.identity, served)),
      ]
      expect(answers.map(({ value, code, message }) => ({ value, code, message }))).toEqual([
        { value: { available: true }, code: undefined, message: undefined },
        { value: { available: false }, code: undefined, message: undefined },
        { value: undefined, code: "not_found", message: "Unknown file." },
      ])
    })
  })

  describe("purge of abandoned uploads (AC-a6)", () => {
    it("should delete the pending rows of more than an hour at the next request and when the trash is read, then their objects; a bucket failure only logs the orphan", async () => {
      const node = await page("ventes/f_purge")
      const lea = as("lea")
      const stale = async () => {
        const [row] = await fx.admin<{ id: string }[]>`
          insert into platform.files (org_id, node_id, name, mime, size, status, created_by, created_at)
          values (${o.org.id}, ${node}, 'vieux.pdf', 'application/pdf', 3, 'pending', ${o.people.lea.id}, now() - interval '2 hours') returning id`
        memory.objects.set(objectKey(o.org.id, row.id), { bytes: bytesOf("pdf"), mime: "application/pdf" })
        return row.id
      }
      const count = async (id: string) => (await fx.admin<{ n: number }[]>`select count(*)::int as n from platform.files where id = ${id}`)[0].n

      const orphan = await stale()
      memory.failing.add("remove")
      const errors = vi.spyOn(console, "error").mockImplementation(() => undefined)
      const fresh = await requestFileUpload(lea.db, lea.identity, { node: "ventes/f_purge", name: "neuf.pdf", mime: "application/pdf", size: 3 })
      memory.failing.clear()
      const logged = loggedText(errors)
      errors.mockRestore()

      const purgedByTrash = await stale()
      await listTrash(lea.db, lea.identity)

      expect({
        orphanRow: await count(orphan),
        logged: logged.includes(`[platform] files: orphan ${objectKey(o.org.id, orphan)}`),
        freshRow: await count(fresh.data.id),
        trashRow: await count(purgedByTrash),
        trashObject: memory.objects.has(objectKey(o.org.id, purgedByTrash)),
      }).toEqual({ orphanRow: 0, logged: true, freshRow: 1, trashRow: 0, trashObject: false })
    })
  })

  describe("text of a file (AC-a8)", () => {
    it("should read a text file in strict UTF-8 without its BOM, and refuse invalid bytes, another type, an absent object and more than 4 MB", async () => {
      vi.stubGlobal("fetch", memory.fetch)
      const node = await page("ventes/f_texte")
      const claire = as("claire")
      const withBom = await readyFile(node, "notes.md", new Uint8Array([0xef, 0xbb, 0xbf, ...bytesOf("# Été\n")]))
      const latin1 = await readyFile(node, "ancien.txt", new Uint8Array([0x45, 0x74, 0xe9]))
      const pdf = await readyFile(node, "rapport.pdf", bytesOf("%PDF"))
      const absent = await readyFile(node, "perdu.csv", null)
      const huge = await readyFile(node, "gros.csv", new Uint8Array(TEXT_FILE_MAX_BYTES + 1).fill(0x61))

      const readFile = (file: string) => readNode(claire.db, claire.identity, { path: "ventes/f_texte", file })
      const read = await readFile(withBom)
      const refusals = await Promise.all([latin1, pdf, absent, huge].map((id) => outcome(readFile(id))))
      expect({ text: read.text, refusals: refusals.map((refusal) => ({ code: refusal.code, message: refusal.message })) }).toEqual({
        text: "notes.md (11 bytes)\n\n```markdown\n# Été\n\n```",
        refusals: [
          { code: "invalid_arguments", message: "ancien.txt cannot be read: the file is not UTF-8; download it instead (unsupported)." },
          { code: "invalid_arguments", message: "rapport.pdf is a pdf file; only html, md, txt and csv files are read as text." },
          { code: "not_found", message: "Unknown file." },
          { code: "too_large", message: "gros.csv is over 4 MB: download it instead." },
        ],
      })
    })
  })
})
