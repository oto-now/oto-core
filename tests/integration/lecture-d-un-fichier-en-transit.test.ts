// @vitest-environment node
// `read {file}` d'un fichier en transit, et sa citation dans une page, sur une vraie base (fichiers et stockage, § Adresse
// unique et lecture d'un fichier en transit ; étape 2), par la porte MCP sous chaque personne : `file` seul désigne un
// fichier quel que soit son état ; en transit, son auteur seul le lit, avec les mêmes lecteurs, bornes et curseur qu'un
// fichier joint, sans que son nom entre au journal ; effacé, le refus le date ; un fichier joint lu par `file` seul se lit
// comme avec son chemin. Citer son fichier en transit dans une page est refusé avec ce qu'il faut faire ; celui d'un
// autre reste un fichier non joint. Le bucket est l'adaptateur en mémoire. Suite portable.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { resolveIdentity, type Identity, type PlatformDb } from "@otomata_tech/oto_platform/server"
import { memoryFileStore, type MemoryFileStore } from "../../packages/plateforme/server/files/memory"
import { objectKey } from "../../packages/plateforme/server/files/store"
import { completeTransitUpload, expireTransitFile, requestTransitUpload } from "../../packages/plateforme/server/files/transit"
import { connectDeps } from "../helpers/mcp"
import { hex } from "../helpers/plateforme"
import { pendingMigrations, privateFolderPending, privateFolderSuite } from "../helpers/pending-migrations"
import { createLocalFixtures, type LocalFixtures } from "../helpers/session-locale"
import { SQL_SKIP_REASON, sqlConfigured, type SqlReferenceOrg } from "../helpers/sql"

const storage = vi.hoisted(() => ({ store: null as MemoryFileStore | null }))

vi.mock("../../packages/plateforme/server/files/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../packages/plateforme/server/files/store")>()),
  fileStore: () => storage.store,
}))

const VERSION = "20261021190000"
const pending = (await privateFolderPending()) || (await pendingMigrations()).includes(VERSION)
const NETWORK_TIMEOUT = 60_000
const SETUP_TIMEOUT = 180_000
const SUITE = "read of a transit file, and its citation in a page"

type Person = "claire" | "lea"

const bytesOf = (text: string) => new TextEncoder().encode(text)

describe.skipIf(!sqlConfigured || pending)(privateFolderSuite(sqlConfigured ? SUITE : `${SUITE} (${SQL_SKIP_REASON})`, pending), { timeout: NETWORK_TIMEOUT }, () => {
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

  /** Une session MCP de `person`, son `ctx`, et le journal qu'elle écrit. */
  async function session(person: Person) {
    const { db, identity } = as(person)
    const journal: Parameters<typeof connectDeps>[0]["journal"] = []
    const mcp = await connectDeps({ db, org: identity.org, caller: { kind: "member", identity }, userAgent: `transit-${hex(4)}`, journal, activeConnectors: () => Promise.resolve(new Set<string>()), origin: `https://${o.host}` })
    const { code } = await mcp.openContext("Lis la pièce")
    return { call: (tool: string, args: Record<string, unknown>) => mcp.call(tool, { ctx: code, ...args }), journal }
  }

  /** Un fichier en transit `ready` de `person`, déposé par son service. */
  async function deposit(person: Person, name: string, text: string): Promise<string> {
    const { db, identity } = as(person)
    const requested = await requestTransitUpload(db, identity, { name, mime: "", size: bytesOf(text).byteLength })
    await memory.fetch(requested.upload.url, { method: "PUT", headers: requested.upload.headers, body: bytesOf(text) })
    await completeTransitUpload(db, identity, requested.id)
    return requested.id
  }

  /** Une page de `claire`, publiée, et son identifiant. */
  async function page(path: string): Promise<string> {
    const claire = await session("claire")
    const created = await claire.call("write", { path, title: `Page ${path}`, summary: "Page de test.", ops: [{ op: "add_section", section: "Pièces", text: "Intro." }] })
    expect(created.isError, created.text).toBe(false)
    const [row] = await fx.admin<{ id: string }[]>`select id from platform.nodes where org_id = ${o.org.id} and path = ${path}`
    return row.id
  }

  describe("read {file} alone", () => {
    it("should serve the text of a transit file to its author, its expiry in the data and its name out of the journal, and refuse it to a teammate as an unknown file", async () => {
      vi.stubGlobal("fetch", memory.fetch)
      const id = await deposit("lea", "compte_rendu_confidentiel.md", "## Appel\n\nRelancer lundi.")
      const lea = await session("lea")
      const claire = await session("claire")

      const read = await lea.call("read", { file: id })
      const refused = await claire.call("read", { file: id })
      const [row] = await fx.admin<{ expires_at: string }[]>`select to_json(expires_at) #>> '{}' as expires_at from platform.files where id = ${id}`

      expect([read.isError, read.text]).toEqual([false, "compte_rendu_confidentiel.md (25 bytes)\n\n```markdown\n## Appel\n\nRelancer lundi.\n```"])
      expect(read.result.structuredContent).toMatchObject({ file: { id, name: "compte_rendu_confidentiel.md", size: 25, type: "md" }, expires_at: new Date(row.expires_at).toISOString() })
      expect(read.result.structuredContent).not.toHaveProperty("path")
      expect(JSON.stringify(lea.journal)).not.toContain("compte_rendu_confidentiel")
      expect([refused.isError, refused.text]).toEqual([true, `Unknown file ${id}: read the page that cites it to get its file links.`])
    })

    it("should read an attached file by file alone as with its path, and refuse a file of a page the caller does not read as an unknown file", async () => {
      vi.stubGlobal("fetch", memory.fetch)
      const path = `ventes/t_joint_${hex(3)}`
      const node = await page(path)
      const [file] = await fx.admin<{ id: string }[]>`
        insert into platform.files (org_id, node_id, name, mime, size, status, created_by)
        values (${o.org.id}, ${node}, 'notes.txt', 'text/plain', 5, 'ready', ${o.people.claire.id}) returning id`
      memory.objects.set(objectKey(o.org.id, file.id), { bytes: bytesOf("notes"), mime: "text/plain" })
      const lea = await session("lea")

      const alone = await lea.call("read", { file: file.id })
      const withPath = await lea.call("read", { path, file: file.id })

      expect([alone.isError, alone.text]).toEqual([withPath.isError, withPath.text])
      expect(alone.result.structuredContent).toMatchObject({ path, file: { id: file.id } })
      expect(alone.isError, alone.text).toBe(false)
    })

    it("should refuse to its author an erased transit file with its date and what to do, and a read with neither path nor file", async () => {
      vi.stubGlobal("fetch", memory.fetch)
      const id = await deposit("lea", "envoye.txt", "parti")
      const { db, identity } = as("lea")
      await expireTransitFile(db, identity, id)
      const lea = await session("lea")

      const erased = await lea.call("read", { file: id })
      const nothing = await lea.call("read", {})

      expect([erased.isError, erased.text]).toEqual([
        true,
        expect.stringMatching(new RegExp(`^File ${id} was deleted on \\d{4}-\\d\\d-\\d\\d \\d\\d:\\d\\d UTC \\(sent to a third party\\): run the function that produced it again, or upload it again\\.$`)),
      ])
      expect([nothing.isError, nothing.text]).toEqual([true, "Give path, or file alone to read a file by its id."])
    })

    it("should cut a long transit file with a cursor bound to the file, its continuation without path", async () => {
      vi.stubGlobal("fetch", memory.fetch)
      const lines = Array.from({ length: 1_500 }, (_, index) => `ligne ${String(index).padStart(4, "0")} ${"x".repeat(40)}`)
      const id = await deposit("lea", "journal.txt", lines.join("\n"))
      const other = await deposit("lea", "autre.txt", lines.join("\n"))
      const lea = await session("lea")

      const outline = await lea.call("read", { file: id })
      const first = await lea.call("read", { file: id, section: "*" })
      const data = first.result.structuredContent as { next_cursor?: string; parts?: number }
      const second = await lea.call("read", { file: id, section: "*", cursor: data.next_cursor })
      const elsewhere = await lea.call("read", { file: other, section: "*", cursor: data.next_cursor })

      expect([outline.isError, outline.text.split("\n").slice(2, 4)]).toEqual([false, ["1,500 lines", "outline (7 parts, 77,993 characters, over the 12,000-character page limit):"]])
      expect(outline.text).toContain(`read {"file": "${id}", "section": "<name>"}`)
      expect([first.isError, data.parts]).toEqual([false, 2])
      expect(first.text).toContain(`read {"section": "*", "file": "${id}", "cursor": "${data.next_cursor}"}`)
      expect([second.isError, second.text.includes("ligne 1499")]).toEqual([false, true])
      expect([elsewhere.isError, elsewhere.text]).toEqual([true, `This cursor no longer matches file ${other} (it changed, or the request differs): read again without cursor.`])
    })
  })

  describe("a transit file cited in a page", () => {
    it("should refuse its author's page with what to do, on an edit and on a creation, and a teammate's as a file not attached", async () => {
      const id = await deposit("claire", "devis.pdf", "%PDF")
      const path = `ventes/t_cite_${hex(3)}`
      await page(path)
      const created = `ventes/t_neuve_${hex(3)}`
      const claire = await session("claire")

      const edit = await claire.call("write", { path, base_revision: 1, ops: [{ op: "append", section: "Pièces", text: `[devis](/f/${id})` }] })
      const creation = await claire.call("write", { path: created, title: "Neuve", summary: "Page neuve.", ops: [{ op: "add_section", section: "A", text: `[devis](/f/${id})` }] })
      const lea = await session("lea")
      const teammate = await lea.call("write", { path, base_revision: 1, ops: [{ op: "append", section: "Pièces", text: `[devis](/f/${id})` }] })

      expect([edit.isError, edit.text]).toEqual([true, `File ${id} is in transit: upload it to ${path} first.`])
      expect([creation.isError, creation.text]).toEqual([true, `File ${id} is in transit: upload it to ${created} first.`])
      expect([teammate.isError, teammate.text]).toEqual([true, `File ${id} is not attached to ${path}: upload it to this page first.`])
    })
  })
})
