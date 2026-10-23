// @vitest-environment node
// `file.keep` sur une vraie base (fichiers et stockage, § Garder un fichier en transit sur une page ; étape 3 du chantier
// « fichier », décidée par Alexis le 21/10), par la porte MCP sous chaque personne : garder, c'est insérer un bloc média
// dans la page, à la position donnée (fin d'une section, après un bloc, en bas par défaut), sous une révision ; le
// fichier y est joint, son échéance levée, sans copie, et se lit dès lors par qui lit la page. Un refus de l'écriture
// annule le rattachement : aucun fichier n'est rangé sans bloc. Gardé de nouveau sur la même page, rien n'est écrit ;
// sur une autre, une copie sous un identifiant neuf, pour qui lit la page source et écrit la cible. Un texte de plus de
// 4 Mo ne se garde pas. Le journal porte la page et l'identifiant, jamais le nom. Le bucket est l'adaptateur en mémoire.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { resolveIdentity, type Identity, type PlatformDb } from "@otomata_tech/oto_platform/server"
import { fileLink } from "../../packages/plateforme/schemas/files"
import { fileReadUrl } from "../../packages/plateforme/server/files/address"
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

const VERSION = "20261023120000" // 20261023120000_v1_6_0.sql, partie écrite en 20261021230000
const pending = (await privateFolderPending()) || (await pendingMigrations()).includes(VERSION)
const NETWORK_TIMEOUT = 60_000
const SETUP_TIMEOUT = 180_000
const SUITE = "keep a transit file on a page"

type Person = "ada" | "claire" | "lea" | "paul"

const bytesOf = (text: string) => new TextEncoder().encode(text)

describe.skipIf(!sqlConfigured || pending)(privateFolderSuite(sqlConfigured ? SUITE : `${SUITE} (${SQL_SKIP_REASON})`, pending), { timeout: NETWORK_TIMEOUT }, () => {
  let fx: LocalFixtures
  let o: SqlReferenceOrg
  let memory: MemoryFileStore
  let origin: string
  const people = new Map<Person, { db: PlatformDb; identity: Identity }>()

  beforeAll(async () => {
    fx = createLocalFixtures()
    o = await fx.buildReferenceOrg()
    origin = `https://${o.host}`
    for (const person of ["ada", "claire", "lea", "paul"] as const) {
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

  /** Une session MCP de `person` : ses outils, `file.keep` par `call`, et le journal qu'elle écrit. */
  async function session(person: Person) {
    const { db, identity } = as(person)
    const journal: Parameters<typeof connectDeps>[0]["journal"] = []
    const mcp = await connectDeps({ db, org: identity.org, caller: { kind: "member", identity }, userAgent: `garder-${hex(4)}`, journal, activeConnectors: () => Promise.resolve(new Set<string>()), origin })
    const { code } = await mcp.openContext("Range la pièce")
    const call = (tool: string, args: Record<string, unknown>) => mcp.call(tool, { ctx: code, ...args })
    return { call, keep: (args: Record<string, unknown>) => call("call", { function: "file.keep", arguments: args }), journal }
  }

  /** Un fichier en transit `ready` de `person`, déposé par son service. */
  async function deposit(person: Person, name: string, bytes: Uint8Array): Promise<string> {
    const { db, identity } = as(person)
    const requested = await requestTransitUpload(db, identity, { name, mime: "", size: bytes.byteLength })
    await memory.fetch(requested.upload.url, { method: "PUT", headers: requested.upload.headers, body: bytes })
    await completeTransitUpload(db, identity, requested.id)
    return requested.id
  }

  /** Une page publiée par `author`, en révision 1, à trois sections : son identifiant. */
  async function page(path: string, author: Person = "claire"): Promise<string> {
    const writer = await session(author)
    const ops = ["Lundi", "Mardi", "Mercredi"].map((section) => ({ op: "add_section", section, text: `Appel du ${section.toLowerCase()}.` }))
    const created = await writer.call("write", { path, title: `Page ${path}`, summary: "Page de test.", ops })
    expect(created.isError, created.text).toBe(false)
    const [row] = await fx.admin<{ id: string }[]>`select id from platform.nodes where org_id = ${o.org.id} and path = ${path}`
    return row.id
  }

  /** La ligne d'un fichier, lue par la connexion d'administration. */
  const rowOf = async (id: string) =>
    (await fx.admin<{ node_id: string | null; expires_at: string | null; status: string }[]>`
      select node_id, to_json(expires_at) #>> '{}' as expires_at, status from platform.files where id = ${id}`)[0] ?? null

  /** Les fichiers joints à un nœud. */
  const filesOn = (nodeId: string) => fx.admin<{ id: string; name: string; status: string }[]>`select id, name, status from platform.files where node_id = ${nodeId} order by created_at`

  /** Le texte publié d'une page, lu par `person`. */
  async function published(path: string, person: Person = "claire"): Promise<string> {
    const read = await (await session(person)).call("read", { path })
    expect(read.isError, read.text).toBe(false)
    return read.text
  }

  const link = (file: { id: string; name: string; size: number; mime: string }) => fileLink(file, `${origin}/f`)

  describe("keep on a page", () => {
    it("should insert a file block at the end of the section given, join the file to the page without copy, and let a reader of the page open it", async () => {
      vi.stubGlobal("fetch", memory.fetch)
      const path = `ventes/t_appels_${hex(3)}`
      const node = await page(path)
      const id = await deposit("lea", "appel_mardi.pdf", bytesOf("%PDF-mardi"))
      const lea = await session("lea")

      const kept = await lea.keep({ file: id, path, base_revision: 1, section: "Mardi" })
      const text = await published(path)
      const { db, identity } = as("claire")

      const shown = link({ id, name: "appel_mardi.pdf", size: 10, mime: "application/pdf" })
      expect([kept.isError, kept.text]).toEqual([false, `Kept appel_mardi.pdf on ${path}, revision 2: ${shown}.`])
      expect(kept.result.structuredContent).toMatchObject({ result: { path, revision: 2, file: { id, name: "appel_mardi.pdf", size: 10, url: `${origin}/f/${id}` } } })
      expect(text.indexOf("Appel du mardi.") < text.indexOf(shown) && text.indexOf(shown) < text.indexOf("## Mercredi")).toBe(true)
      expect({ ...(await rowOf(id)), objects: [...memory.objects.keys()].filter((key) => key.endsWith(id)) }).toEqual({
        node_id: node,
        expires_at: null,
        status: "ready",
        objects: [objectKey(o.org.id, id)],
      })
      expect(await fileReadUrl(db, identity, id, {})).toMatch(/^https?:\/\//)
    })

    it("should put a raster image at the bottom of the page by default, after the block given otherwise, and refuse both at once", async () => {
      vi.stubGlobal("fetch", memory.fetch)
      const path = `ventes/t_photos_${hex(3)}`
      await page(path)
      const photo = await deposit("lea", "vitrine.png", bytesOf("png-bytes"))
      const plan = await deposit("lea", "plan.svg", bytesOf("<svg/>"))
      const lea = await session("lea")

      const bottom = await lea.keep({ file: photo, path, base_revision: 1 })
      const refs = await lea.call("read", { path, refs: true })
      const lundi = /<!-- ref: (\S+) -->\nAppel du lundi\./.exec(refs.text)?.[1]
      const after = await lea.keep({ file: plan, path, base_revision: 2, after_block: lundi })
      const both = await lea.keep({ file: plan, path, base_revision: 3, section: "Mardi", after_block: lundi })
      const text = await published(path)

      expect([bottom.isError, after.isError, lundi !== undefined]).toEqual([false, false, true])
      const image = text.indexOf(`![](${origin}/f/${photo})`)
      expect(text.indexOf("Appel du mercredi.") < image && text.indexOf("## ", image) === -1).toBe(true)
      const svg = link({ id: plan, name: "plan.svg", size: 6, mime: "image/svg+xml" })
      expect(text.indexOf("Appel du lundi.") < text.indexOf(svg) && text.indexOf(svg) < text.indexOf("## Mardi")).toBe(true)
      expect([both.isError, both.text]).toEqual([true, "Give section or after_block, not both: section puts the file at the end of a section, after_block right after a block."])
    })

    it("should keep nothing when the write is refused: a stale revision leaves the file in transit with its expiry", async () => {
      vi.stubGlobal("fetch", memory.fetch)
      const path = `ventes/t_perime_${hex(3)}`
      await page(path)
      const id = await deposit("lea", "devis.pdf", bytesOf("%PDF"))
      const before = await rowOf(id)
      const lea = await session("lea")

      const stale = await lea.keep({ file: id, path, base_revision: 0 })
      const missing = await lea.keep({ file: id, path })

      expect([stale.isError, stale.text.startsWith(`stale revision: ${path} is at revision 1, not 0.`)]).toEqual([true, true])
      expect([missing.isError, missing.text.startsWith(`stale revision: ${path} is at revision 1 and base_revision is missing.`)]).toEqual([true, true])
      expect(await rowOf(id)).toEqual(before)
      expect(before?.expires_at).not.toBeNull()
    })

    it("should write nothing when kept again on the same page, and a new block when its block was removed", async () => {
      vi.stubGlobal("fetch", memory.fetch)
      const path = `ventes/t_reprise_${hex(3)}`
      const node = await page(path)
      const id = await deposit("lea", "releve.pdf", bytesOf("%PDF-releve"))
      const lea = await session("lea")
      await lea.keep({ file: id, path, base_revision: 1 })

      const again = await lea.keep({ file: id, path, base_revision: 2 })
      const refs = await lea.call("read", { path, refs: true })
      const block = new RegExp(`<!-- ref: (\\S+) -->\\n\\[releve\\.pdf`).exec(refs.text)?.[1]
      const removed = await lea.call("write", { path, base_revision: 2, ops: [{ op: "delete_block", block }] })
      const back = await lea.keep({ file: id, path, base_revision: 3 })

      expect([again.isError, again.text]).toEqual([false, `releve.pdf is already on ${path}, revision 2: nothing was written.`])
      expect([removed.isError, back.isError]).toEqual([false, false])
      expect(back.result.structuredContent).toMatchObject({ result: { revision: 4, file: { id } } })
      expect((await filesOn(node)).map((file) => file.id)).toEqual([id])
    })
  })

  describe("refusals", () => {
    it("should refuse a teammate's transit file, a table, a page the caller does not write, a page that does not exist, and an erased file with its date", async () => {
      vi.stubGlobal("fetch", memory.fetch)
      const path = `ventes/t_refus_${hex(3)}`
      await page(path)
      const id = await deposit("lea", "piece.pdf", bytesOf("%PDF"))
      const pauls = await deposit("paul", "support.pdf", bytesOf("%PDF"))
      const gone = await deposit("lea", "parti.pdf", bytesOf("%PDF"))
      await expireTransitFile(as("lea").db, as("lea").identity, gone)
      const claire = await session("claire")
      const paul = await session("paul")
      const lea = await session("lea")
      const table = `ventes/t_tableau_${hex(3)}`
      const createdTable = await claire.call("write", { path: table, kind: "table", title: "Tableau", summary: "Un tableau.", header: { columns: [{ name: "nom", type: "text" }], key: "nom" } })
      expect(createdTable.isError, createdTable.text).toBe(false)

      const teammate = await claire.keep({ file: id, path, base_revision: 1 })
      const noWrite = await paul.keep({ file: pauls, path: "ventes/devis", base_revision: 1 })
      const intoTable = await lea.keep({ file: id, path: table, base_revision: 1 })
      const nowhere = await lea.keep({ file: id, path: `ventes/t_absente_${hex(3)}`, base_revision: 0 })
      const erased = await lea.keep({ file: gone, path, base_revision: 1 })

      expect([teammate.isError, teammate.text]).toEqual([true, "Unknown file."])
      expect([noWrite.isError, noWrite.text.startsWith("Unknown path ventes/devis")]).toEqual([true, true])
      expect([intoTable.isError, intoTable.text]).toEqual([true, `${table} is a table: a file goes into a page, a procedure or a context page.`])
      expect([nowhere.isError, nowhere.text.startsWith("Unknown path")]).toEqual([true, true])
      expect([erased.isError, erased.text]).toEqual([true, expect.stringMatching(new RegExp(`^File ${gone} was deleted on .+ UTC \\(sent to a third party\\)`))])
      expect((await rowOf(id))?.node_id).toBeNull()
    })

    it("should refuse to keep a text file over 4 MB, saying why and offering the download before its expiry", async () => {
      vi.stubGlobal("fetch", memory.fetch)
      const path = `ventes/t_gros_${hex(3)}`
      await page(path)
      const big = new Uint8Array(4_194_305).fill(0x61)
      const id = await deposit("lea", "export.csv", big)
      const row = await rowOf(id)
      const lea = await session("lea")

      const refused = await lea.keep({ file: id, path, base_revision: 1 })

      const expiry = (row?.expires_at ?? "").slice(0, 16).replace("T", " ")
      expect([refused.isError, refused.text]).toEqual([
        true,
        `File ${id} is a csv file of 4,194,305 bytes: a text file is kept on a page up to 4,194,304 bytes, to be read there. Download it from ${origin}/f/${id} before ${expiry} UTC.`,
      ])
      expect((await rowOf(id))?.node_id).toBeNull()
    })
  })

  describe("kept on a second page", () => {
    it("should copy the file under a new id joined to the second page, counted twice, for a reader of the first page who writes the second", async () => {
      vi.stubGlobal("fetch", memory.fetch)
      const first = `ventes/t_premiere_${hex(3)}`
      const second = `ventes/t_seconde_${hex(3)}`
      await page(first)
      const secondNode = await page(second)
      const id = await deposit("lea", "contrat.pdf", bytesOf("%PDF-contrat"))
      const lea = await session("lea")
      await lea.keep({ file: id, path: first, base_revision: 1 })
      const claire = await session("claire")

      const copied = await claire.keep({ file: id, path: second, base_revision: 1 })
      const [copy] = await filesOn(secondNode)

      expect(copy && copy.id !== id).toBe(true)
      expect([copied.isError, copied.text]).toEqual([
        false,
        `Copied contrat.pdf to ${second} as file ${copy?.id}, revision 2: ${link({ id: copy?.id ?? "", name: "contrat.pdf", size: 12, mime: "application/pdf" })}.`,
      ])
      expect({ status: copy?.status, object: memory.objects.has(objectKey(o.org.id, copy?.id ?? "")), original: (await rowOf(id))?.node_id !== null }).toEqual({ status: "ready", object: true, original: true })
      expect(await published(second)).toContain(`${origin}/f/${copy?.id}`)
    })

    it("should refuse a reader of the first page who does not write the second, and give not_found to a writer of the second who does not read the first", async () => {
      vi.stubGlobal("fetch", memory.fetch)
      const first = `ventes/t_source_${hex(3)}`
      const orgPage = `t_note_${hex(3)}`
      await page(first)
      await page(orgPage, "ada")
      const id = await deposit("lea", "source.pdf", bytesOf("%PDF-source"))
      const lea = await session("lea")
      await lea.keep({ file: id, path: first, base_revision: 1 })
      const claire = await session("claire")
      const paul = await session("paul")

      const readerOnly = await claire.keep({ file: id, path: orgPage, base_revision: 1 })
      const writerOnly = await paul.keep({ file: id, path: "support/faq", base_revision: 1 })

      expect([readerOnly.isError, readerOnly.text]).toEqual([true, expect.stringContaining(`${orgPage} is reserved to`)])
      expect([writerOnly.isError, writerOnly.text]).toEqual([true, "Unknown file."])
      expect(await filesOn(o.nodes.faq)).toEqual([])
    })

    it("should leave no copy when the write of the second page is refused", async () => {
      vi.stubGlobal("fetch", memory.fetch)
      const first = `ventes/t_origine_${hex(3)}`
      const second = `ventes/t_cible_${hex(3)}`
      await page(first)
      const secondNode = await page(second)
      const id = await deposit("lea", "annexe.pdf", bytesOf("%PDF-annexe"))
      const lea = await session("lea")
      await lea.keep({ file: id, path: first, base_revision: 1 })

      const stale = await lea.keep({ file: id, path: second, base_revision: 0 })

      expect([stale.isError, stale.text.startsWith("stale revision:")]).toEqual([true, true])
      expect(await filesOn(secondNode)).toEqual([])
    })
  })

  describe("journal and citation", () => {
    it("should journal the page and the id of a kept file, never its name", async () => {
      vi.stubGlobal("fetch", memory.fetch)
      const path = `ventes/t_journal_${hex(3)}`
      await page(path)
      const id = await deposit("lea", "compte_rendu_confidentiel.pdf", bytesOf("%PDF"))
      const lea = await session("lea")

      const kept = await lea.keep({ file: id, path, base_revision: 1 })
      const logged = JSON.stringify(lea.journal)

      expect(kept.isError, kept.text).toBe(false)
      expect([logged.includes(path), logged.includes(id), logged.includes("compte_rendu_confidentiel")]).toEqual([true, true, false])
    })

    it("should refuse a transit file written by hand with the call of file.keep, on an edit and on a creation", async () => {
      const id = await deposit("claire", "devis.pdf", bytesOf("%PDF"))
      const path = `ventes/t_main_${hex(3)}`
      await page(path)
      const created = `ventes/t_neuve_${hex(3)}`
      const claire = await session("claire")
      const prefix = as("claire").identity.org.prefix

      const edit = await claire.call("write", { path, base_revision: 1, ops: [{ op: "append", section: "Lundi", text: `[devis](/f/${id})` }] })
      const creation = await claire.call("write", { path: created, title: "Neuve", summary: "Page neuve.", ops: [{ op: "add_section", section: "A", text: `[devis](/f/${id})` }] })

      expect([edit.isError, edit.text]).toEqual([
        true,
        `File ${id} is in transit: keep it on ${path} with ${prefix}_call {"function": "file.keep", "arguments": {"file": "${id}", "path": "${path}", "base_revision": 1}}; it adds the file at the end of the page, or where section or after_block says.`,
      ])
      expect([creation.isError, creation.text]).toEqual([
        true,
        `File ${id} is in transit: create ${created} without it, then keep it there with ${prefix}_call {"function": "file.keep", "arguments": {"file": "${id}", "path": "${created}", "base_revision": 1}}.`,
      ])
    })
  })
})
