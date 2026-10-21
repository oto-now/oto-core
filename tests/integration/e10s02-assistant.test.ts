// @vitest-environment node
// Les fichiers joints côté assistant sur une vraie base (E10-S02 lot d : AC-d1 à AC-d4), par la porte MCP
// (`InMemoryTransport`, `connectDeps`) sous chaque personne : `read` sert l'image et le fichier joints sur l'origine
// de la requête ; `write` relit ces formes, de toute origine, sur le nœud qui les porte et refuse un fichier d'un autre
// nœud, `pending` ou inconnu, avec la phrase d'AC-d3 ; le mode tolérant de l'écran le garde en texte ; `read {file}` sert
// le texte d'un fichier texte joint, dans sa clôture, coupé par le curseur ; `find` trouve un fichier par son nom. Le
// bucket est l'adaptateur en mémoire, à la place de `fileStore()` et de `fetch` : aucun service extérieur. Suite portable.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { resolveIdentity, writeNode, type Identity, type PlatformDb } from "@otomata_tech/oto_platform/server"
import { FILE_TYPES, fileTypeOf } from "../../packages/plateforme/schemas"
import { memoryFileStore, type MemoryFileStore } from "../../packages/plateforme/server/files/memory"
import { objectKey } from "../../packages/plateforme/server/files/store"
import { connectDeps } from "../helpers/mcp"
import { hex } from "../helpers/plateforme"
import { privateFolderPending, privateFolderSuite } from "../helpers/pending-migrations"
import { createLocalFixtures, type LocalFixtures } from "../helpers/session-locale"
import { SQL_SKIP_REASON, sqlConfigured, type SqlReferenceOrg } from "../helpers/sql"

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
const SUITE = "attached files on the assistant side (E10-S02, lot d)"

type Person = "claire" | "lea"

const bytesOf = (text: string) => new TextEncoder().encode(text)

describe.skipIf(!sqlConfigured || privatePending)(privateFolderSuite(sqlConfigured ? SUITE : `${SUITE} (${SQL_SKIP_REASON})`, privatePending), { timeout: NETWORK_TIMEOUT }, () => {
  let fx: LocalFixtures
  let o: SqlReferenceOrg
  let memory: MemoryFileStore
  const people = new Map<Person, { db: PlatformDb; identity: Identity }>()

  beforeAll(async () => {
    fx = createLocalFixtures()
    o = await fx.buildReferenceOrg()
    for (const person of ["claire", "lea"] as const) {
      const user = o.people[person]
      const db = fx.as(user)
      people.set(person, { db, identity: await resolveIdentity(db, o.host, { userId: user.id, email: user.email }) })
    }
    memory = memoryFileStore()
    storage.store = memory
  }, SETUP_TIMEOUT)

  afterEach(() => {
    storage.store = memory
    vi.unstubAllGlobals()
  })

  afterAll(async () => {
    await fx?.cleanup()
  }, SETUP_TIMEOUT)

  const as = (person: Person) => {
    const found = people.get(person)
    if (!found) throw new Error(`no session for ${person}`)
    return found
  }

  /** Une session MCP de `person`, l'origine de la requête sur l'adresse de l'organisation, et son `ctx`. */
  async function session(person: Person) {
    const { db, identity } = as(person)
    const mcp = await connectDeps({ db, org: identity.org, caller: { kind: "member", identity }, userAgent: `files-${hex(4)}`, journal: [], activeConnectors: () => Promise.resolve(new Set<string>()), origin: `https://${o.host}` })
    const { code } = await mcp.openContext("Range le rapport")
    return { call: (tool: string, args: Record<string, unknown>) => mcp.call(tool, { ctx: code, ...args }), prefix: mcp.prefix }
  }

  /** Une page créée par `write` en brouillon (`publish: false`, révision 0 ; `write` publie par défaut, D135), et son identifiant. */
  async function page(mcp: Awaited<ReturnType<typeof session>>, path: string): Promise<string> {
    const created = await mcp.call("write", { path, title: `Page ${path}`, summary: "Page de test.", ops: [{ op: "add_section", section: "Pièces", text: "Intro." }], publish: false })
    expect(created.isError, created.text).toBe(false)
    const [row] = await fx.admin<{ id: string }[]>`select id from platform.nodes where org_id = ${o.org.id} and path = ${path}`
    return row.id
  }

  /** Une ligne posée par la connexion d'administration (`ready` par défaut), et son objet quand on en donne. */
  async function attached(nodeId: string, name: string, bytes: Uint8Array | null, options: { status?: "ready" | "pending"; size?: number } = {}): Promise<string> {
    const mime = FILE_TYPES[fileTypeOf(name) ?? "zip"]
    const [row] = await fx.admin<{ id: string }[]>`
      insert into platform.files (org_id, node_id, name, mime, size, status, created_by)
      values (${o.org.id}, ${nodeId}, ${name}, ${mime}, ${options.size ?? Math.max(bytes?.byteLength ?? 1, 1)}, ${options.status ?? "ready"}, ${o.people.claire.id})
      returning id`
    if (bytes) memory.objects.set(objectKey(o.org.id, row.id), { bytes, mime })
    return row.id
  }

  /** Les blocs brouillon ou publiés d'un nœud, dans l'ordre. */
  const blocksOf = (nodeId: string, state: "draft" | "published") =>
    fx.admin<{ type: string; text: string | null; data: Record<string, unknown> }[]>`
      select type, text, data from platform.blocks where node_id = ${nodeId} and state = ${state} order by position, id`

  describe("read and write of attached files (AC-d1, AC-d3)", () => {
    it("should read back both forms from any origin on the page that holds them, take the file from its row, and serve them on the origin of the request", async () => {
      const claire = await session("claire")
      const path = `ventes/d_formes_${hex(3)}`
      const node = await page(claire, path)
      const image = await attached(node, "plan.png", bytesOf("png"))
      const report = await attached(node, "rapport mars.pdf", null, { size: 1_200 })
      const text = [`![Plan du site](https://ailleurs.example.invalid/api/platform/files/${image.toUpperCase()})`, `[le rapport (3 bytes, zip)](/api/platform/files/${report})`].join("\n\n")

      const written = await claire.call("write", { path, base_revision: 0, ops: [{ op: "append", section: "Pièces", text }], publish: true })
      const read = await claire.call("read", { path })

      expect(written.isError, written.text).toBe(false)
      expect((await blocksOf(node, "published")).filter((block) => block.type !== "heading" && block.type !== "paragraph")).toEqual([
        { type: "image", text: null, data: { file_id: image, alt: "Plan du site" } },
        { type: "file", text: null, data: { file_id: report, name: "rapport mars.pdf", size: 1_200, mime: "application/pdf" } },
      ])
      expect(read.text).toContain(
        `## Pièces\n\nIntro.\n\n![Plan du site](https://${o.host}/api/platform/files/${image})\n\n[rapport mars.pdf (1,200 bytes, pdf)](https://${o.host}/api/platform/files/${report})`,
      )
    })

    it("should refuse a file of another page, a pending file and an unknown file with the text of AC-d3, a file cited on creation, and keep a html fence as code", async () => {
      const claire = await session("claire")
      const path = `ventes/d_refus_${hex(3)}`
      const node = await page(claire, path)
      const other = await page(claire, `ventes/d_autre_${hex(3)}`)
      const elsewhere = await attached(other, "ailleurs.pdf", null)
      const pending = await attached(node, "en_cours.pdf", null, { status: "pending" })
      const unknown = "0b6f3c1e-5a2d-4c8e-9f10-2b3c4d5e6f70"
      const created = `ventes/d_neuve_${hex(3)}`

      const refusals = await Promise.all(
        [elsewhere, pending, unknown].map((id) => claire.call("write", { path, base_revision: 0, ops: [{ op: "append", section: "Pièces", text: `[x](/api/platform/files/${id})` }] })),
      )
      const onCreation = await claire.call("write", { path: created, title: "Neuve", summary: "Page neuve.", ops: [{ op: "add_section", section: "A", text: `![](/api/platform/files/${elsewhere})` }] })
      const fence = await claire.call("write", { path, base_revision: 0, ops: [{ op: "append", section: "Pièces", text: "```html\n<p>Rapport</p>\n```" }] })
      const [createdRow] = await fx.admin<{ n: number }[]>`select count(*)::int as n from platform.nodes where org_id = ${o.org.id} and path = ${created}`

      expect(refusals.map((refusal) => [refusal.isError, refusal.text])).toEqual(
        [elsewhere, pending, unknown].map((id) => [true, `File ${id} is not attached to ${path}: upload it to this page first.`]),
      )
      expect([onCreation.isError, onCreation.text, createdRow.n]).toEqual([true, `File ${elsewhere} is not attached to ${created}: upload it to this page first.`, 0])
      expect(fence.isError, fence.text).toBe(false)
      // `write` publie par défaut (D135) : le bloc écrit est dans la version publiée.
      expect((await blocksOf(node, "published")).at(-1)).toEqual({ type: "code", text: "<p>Rapport</p>", data: { language: "html" } })
    })

    it("should keep in a code block, in the tolerant mode of the screen, a file that is not attached to the page", async () => {
      const claire = await session("claire")
      const path = `ventes/d_tolerant_${hex(3)}`
      const node = await page(claire, path)
      const other = await page(claire, `ventes/d_source_${hex(3)}`)
      const elsewhere = await attached(other, "source.pdf", null, { size: 10 })
      const { db, identity } = as("claire")

      const output = await writeNode(
        db,
        identity,
        { path, base_revision: 0, tolerant: true, ops: [{ op: "append", section: "Pièces", text: `[source.pdf (10 bytes, pdf)](/api/platform/files/${elsewhere})` }] },
        { kind: "human" },
      )

      expect(output.data).toMatchObject({ kept_as_text: 1 })
      expect((await blocksOf(node, "published")).at(-1)).toEqual({ type: "code", text: `[source.pdf (10 bytes, pdf)](/api/platform/files/${elsewhere})`, data: {} })
    })

    it("should refuse a file block whose file was cited only by an image and has no ready row, and keep it in a code block in tolerant mode", async () => {
      const claire = await session("claire")
      const path = `ventes/d_sans_meta_${hex(3)}`
      const node = await page(claire, path)
      // Une image qui cite une copie encore `pending` (AC-e3), posée en administration : le fichier est déjà cité, sans
      // bloc `file` qui en porterait les métadonnées.
      const pending = await attached(node, "plan.png", null, { status: "pending" })
      const { revision } = await fx.publishBlocks(node, [{ type: "image", data: { file_id: pending } }])
      const op = { op: "add_section", section: "Pièces", text: `[x](/api/platform/files/${pending})` }
      const { db, identity } = as("claire")

      const strict = await claire.call("write", { path, base_revision: revision, ops: [op] })
      const tolerant = await writeNode(db, identity, { path, base_revision: revision, tolerant: true, ops: [op] }, { kind: "human" })

      expect([strict.isError, strict.text]).toEqual([true, `File ${pending} is not attached to ${path}: upload it to this page first.`])
      expect(tolerant.data).toMatchObject({ kept_as_text: 1 })
      expect((await blocksOf(node, "published")).at(-1)).toEqual({ type: "code", text: `[x (1 byte, application/octet-stream)](/api/platform/files/${pending})`, data: {} })
    })
  })

  describe("read {file} (AC-d2)", () => {
    it("should serve the text of a markdown and a html file alone, in a fence of its type longer than its own", async () => {
      vi.stubGlobal("fetch", memory.fetch)
      const lea = await session("lea")
      const path = `ventes/d_texte_${hex(3)}`
      const node = await page(await session("claire"), path)
      const notes = await attached(node, "notes.md", bytesOf("## Été\n\n```sh\nls\n```"))
      const report = await attached(node, "rapport.html", bytesOf("<h1>Rapport</h1>"))

      const markdown = await lea.call("read", { path, file: notes })
      const html = await lea.call("read", { path, file: report })

      expect([markdown.isError, markdown.text]).toEqual([false, "notes.md (22 bytes)\n\n````markdown\n## Été\n\n```sh\nls\n```\n````"])
      expect([html.isError, html.text]).toEqual([false, "rapport.html (16 bytes)\n\n```html\n<h1>Rapport</h1>\n```"])
    })

    it("should refuse file with outline, since_revision or draft, an unknown, pending or other-page file, and a file of another type, word for word", async () => {
      vi.stubGlobal("fetch", memory.fetch)
      const claire = await session("claire")
      const path = `ventes/d_refus_texte_${hex(3)}`
      const node = await page(claire, path)
      const other = await page(claire, `ventes/d_autre_texte_${hex(3)}`)
      const notes = await attached(node, "notes.md", bytesOf("notes"))
      const pdf = await attached(node, "rapport.pdf", bytesOf("%PDF"))
      const pending = await attached(node, "en_cours.md", bytesOf("x"), { status: "pending" })
      const elsewhere = await attached(other, "ailleurs.md", bytesOf("x"))
      const unknown = "0b6f3c1e-5a2d-4c8e-9f10-2b3c4d5e6f71"

      const combined = await Promise.all([{ outline: true }, { since_revision: 0 }, { draft: true }].map((mode) => claire.call("read", { path, file: notes, ...mode })))
      const missing = await Promise.all([unknown, pending, elsewhere].map((id) => claire.call("read", { path, file: id })))
      const binary = await claire.call("read", { path, file: pdf })

      expect(combined.map((one) => [one.isError, one.text])).toEqual(
        Array(3).fill([true, "Give only one of outline, since_revision or file; file reads the text of a file, or one part with section, without draft."]),
      )
      expect(missing.map((one) => [one.isError, one.text])).toEqual(
        [unknown, pending, elsewhere].map((id) => [true, `Unknown file ${id} in ${path}: read the page to get its file links.`]),
      )
      expect([binary.isError, binary.text]).toEqual([true, "rapport.pdf is a pdf file; only html, md, txt, csv and xlsx files are read as text."])
    })

    it("should serve a long text as an outline, cut its whole text at 45,000 characters and read the rest with the cursor, the file and the section in the cursor's request", async () => {
      vi.stubGlobal("fetch", memory.fetch)
      const claire = await session("claire")
      const path = `ventes/d_long_${hex(3)}`
      const node = await page(claire, path)
      const lines = Array.from({ length: 1_500 }, (_, index) => `ligne ${String(index).padStart(4, "0")} ${"x".repeat(40)}`)
      const long = await attached(node, "journal.txt", bytesOf(lines.join("\n")))

      // Au-delà de 12 000 caractères, le plan ; le tout par `section: "*"`, coupé par le curseur.
      const outline = await claire.call("read", { path, file: long })
      const first = await claire.call("read", { path, file: long, section: "*" })
      const data = first.result.structuredContent as { next_cursor?: string; parts?: number }
      const second = await claire.call("read", { path, file: long, section: "*", cursor: data.next_cursor })
      const withoutFile = await claire.call("read", { path, cursor: data.next_cursor })
      // Un curseur d'une autre requête, avec `file` : refusé avant toute lecture de l'objet.
      const reads = vi.fn(memory.fetch)
      vi.stubGlobal("fetch", reads)
      const staleWithFile = await claire.call("read", { path, file: long, section: "*", cursor: data.next_cursor, refs: true })

      expect([staleWithFile.isError, staleWithFile.text, reads.mock.calls.length]).toEqual([
        true,
        `This cursor no longer matches ${path} (it changed, or the request differs): read again without cursor.`,
        0,
      ])
      expect([outline.isError, outline.text.split("\n").slice(2, 4)]).toEqual([false, ["1,500 lines", "outline (7 parts, 77,993 characters, over the 12,000-character page limit):"]])
      expect([first.isError, data.parts]).toEqual([false, 2])
      expect(first.text).toContain(`"file": "${long}", "cursor": "${data.next_cursor}"`)
      expect(first.text).toContain(`"section": "*"`)
      expect([second.isError, second.text.includes("ligne 1499"), first.text.includes("ligne 1499")]).toEqual([false, true, false])
      expect([withoutFile.isError, withoutFile.text]).toEqual([true, `This cursor no longer matches ${path} (it changed, or the request differs): read again without cursor.`])
    })
  })

  describe("find (AC-d4)", () => {
    it("should find a published file block by its name", async () => {
      const claire = await session("claire")
      const word = `bilan${hex(4)}`
      const path = `ventes/d_trouve_${hex(3)}`
      const node = await page(claire, path)
      // Le mot seul avant l'extension : le parseur de la recherche lirait « <mot>.pdf » comme un seul jeton.
      const file = await attached(node, `${word} trimestre.pdf`, null, { size: 42 })
      await claire.call("write", { path, base_revision: 0, ops: [{ op: "append", section: "Pièces", text: `[x](/api/platform/files/${file})` }], publish: true })

      const found = await claire.call("find", { query: word })

      expect(found.isError, found.text).toBe(false)
      expect(found.text).toContain(path)
      // E11-S19 (AC-e4) : le bloc trouvé dit sa section.
      expect(found.text).toMatch(/block \S+ \(file\) in « Pièces »: /)
    })
  })
})
