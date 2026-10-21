// @vitest-environment node
// L'origine d'un fichier sur une vraie base (fichiers et stockage, § Origine d'un fichier ; étape 4 du chantier
// « fichier », décidée par Alexis le 21/10) : chaque ligne neuve dit ce qui l'a produite (dépôt, lien de dépôt, fonction),
// la fonction, l'auteur et la date, que `read {file}` rend dans `file.origin` ; la conversation, à son seul auteur. Une
// copie (garder ailleurs, dupliquer une page) reprend l'origine de sa source et dit d'où elle vient. La base pose l'auteur
// et la date, refuse la conversation d'un autre et la source qu'on ne lit pas, et oublie l'auteur qui quitte
// l'organisation. La carte d'un fichier joint la lit par `GET /f/<id>?check`, sous la même règle. Le bucket est
// l'adaptateur en mémoire. Suite portable.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { resolveIdentity, type Identity, type PlatformDb } from "@otomata_tech/oto_platform/server"
import { fileAvailability } from "../../packages/plateforme/server/files/address"
import { keepTransitFile } from "../../packages/plateforme/server/files/keep"
import { memoryFileStore, type MemoryFileStore } from "../../packages/plateforme/server/files/memory"
import { insertPending } from "../../packages/plateforme/server/files/rows"
import { requestTransitUpload, storeTransitFile } from "../../packages/plateforme/server/files/transit"
import { duplicateNode } from "../../packages/plateforme/server/nodes/duplicate"
import { connectDeps } from "../helpers/mcp"
import { hex } from "../helpers/plateforme"
import { pendingMigrations } from "../helpers/pending-migrations"
import { createLocalFixtures, type LocalFixtures } from "../helpers/session-locale"
import { SQL_SKIP_REASON, sqlConfigured, type SqlReferenceOrg } from "../helpers/sql"

const storage = vi.hoisted(() => ({ store: null as MemoryFileStore | null }))

vi.mock("../../packages/plateforme/server/files/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../packages/plateforme/server/files/store")>()),
  fileStore: () => storage.store,
}))

const VERSION = "20261021233000"
const pending = (await pendingMigrations()).includes(VERSION)
const NETWORK_TIMEOUT = 60_000
const SETUP_TIMEOUT = 180_000
const SUITE = "origin of a file on a real database"
const skipReason = !sqlConfigured ? SQL_SKIP_REASON : `skipped: migration ${VERSION} not applied`

type Session = { db: PlatformDb; identity: Identity }

const bytesOf = (text: string) => new TextEncoder().encode(text)
const ISO = expect.stringMatching(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/)

describe.skipIf(!sqlConfigured || pending)(sqlConfigured && !pending ? SUITE : `${SUITE} (${skipReason})`, { timeout: NETWORK_TIMEOUT }, () => {
  let fx: LocalFixtures
  let o: SqlReferenceOrg
  let memory: MemoryFileStore
  let lea: Session
  let claire: Session

  async function sessionOf(user: { id: string; email: string }): Promise<Session> {
    const db = fx.as(user)
    return { db, identity: await resolveIdentity(db, o.host, { userId: user.id, email: user.email }) }
  }

  beforeAll(async () => {
    fx = createLocalFixtures()
    o = await fx.buildReferenceOrg()
    lea = await sessionOf(o.people.lea)
    claire = await sessionOf(o.people.claire)
    memory = memoryFileStore()
    storage.store = memory
  }, SETUP_TIMEOUT)

  // Les octets se lisent et s'envoient par les URL présignées de l'adaptateur en mémoire.
  beforeEach(() => {
    vi.stubGlobal("fetch", memory.fetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  afterAll(async () => {
    await fx?.cleanup()
  }, SETUP_TIMEOUT)

  /** Une conversation MCP de `who` : son code, et `read`. */
  async function conversation(who: Session) {
    const mcp = await connectDeps({ db: who.db, org: who.identity.org, caller: { kind: "member", identity: who.identity }, userAgent: `origine-${hex(4)}`, journal: [], activeConnectors: () => Promise.resolve(new Set<string>()), origin: `https://${o.host}` })
    const { code } = await mcp.openContext("Range l'enregistrement")
    return {
      code,
      read: async (args: Record<string, unknown>) => {
        const read = await mcp.call("read", { ctx: code, ...args })
        expect(read.isError, read.text).toBe(false)
        return read.result.structuredContent as { file?: { origin?: unknown } }
      },
    }
  }

  /** Le fichier que `3cx.recording` rend à `who`, dans la conversation `ctx`. */
  const recording = (who: Session, ctx: string | null) =>
    storeTransitFile(who.db, who.identity, { name: `appel-${hex(3)}.txt`, bytes: bytesOf("bonjour"), origin: { kind: "function", function: "3cx.recording", ctx } })

  /** Une page de `who`, publiée, et son chemin. */
  async function page(who: Session, ctx: string): Promise<string> {
    const path = `ventes/t_origine_${hex(3)}`
    const mcp = await connectDeps({ db: who.db, org: who.identity.org, caller: { kind: "member", identity: who.identity }, userAgent: `page-${hex(4)}`, journal: [], activeConnectors: () => Promise.resolve(new Set<string>()), origin: `https://${o.host}` })
    const created = await mcp.call("write", { ctx, path, title: "Durand", summary: "Client.", ops: [{ op: "add_section", section: "Appels", text: "Intro." }] })
    expect(created.isError, created.text).toBe(false)
    return path
  }

  const refusalOf = (run: Promise<unknown>) =>
    run.then(
      () => "ok",
      (error: { code?: string }) => error.code ?? "error",
    )

  const rowOf = async (id: string) =>
    (await fx.admin<{ origin_kind: string | null; origin_function: string | null; origin_ctx: string | null; origin_by: string | null; copied_from: string | null }[]>`
      select origin_kind, origin_function, origin_ctx, origin_by, copied_from from platform.files where id = ${id}`)[0]

  it("should give a file a function returns its function, its author, its date and, to its author, its conversation", async () => {
    const chat = await conversation(lea)
    const file = await recording(lea, chat.code)

    const read = await chat.read({ file: file.id })

    expect(read.file?.origin).toEqual({ kind: "function", function: "3cx.recording", by: { id: o.people.lea.id, name: expect.anything() as unknown }, at: ISO, ctx: chat.code })
  })

  it("should give an upload its kind, author and date, without function nor conversation, the author and date set by the database", async () => {
    const requested = await requestTransitUpload(lea.db, lea.identity, { name: "devis.txt", mime: "", size: 4 })

    expect(await rowOf(requested.id)).toEqual({ origin_kind: "upload", origin_function: null, origin_ctx: null, origin_by: o.people.lea.id, copied_from: null })
    // La session n'écrit ni l'auteur ni la date de l'origine : aucun `INSERT` ne lui est accordé sur eux.
    const forged = await refusalOf(lea.db.tx((sql) => sql`
      insert into platform.files (org_id, name, mime, size, status, created_by, expires_at, origin_by)
      values (${o.org.id}, 'faux.txt', 'text/plain', 1, 'pending', ${o.people.lea.id}, now() + interval '24 hours', ${o.people.claire.id})`))
    expect(forged).not.toBe("ok")
  })

  it("should refuse the conversation of another person as the origin of a file", async () => {
    const theirs = await conversation(claire)

    expect(await refusalOf(recording(lea, theirs.code))).not.toBe("ok")
  })

  it("should carry the origin of its source into a copy kept on another page, the conversation to its author alone", async () => {
    const claireChat = await conversation(claire)
    const source = await recording(claire, claireChat.code)
    const durand = await page(claire, claireChat.code)
    const litige = await page(claire, claireChat.code)
    await keepTransitFile(claire.db, claire.identity, { file: source.id, path: durand, base_revision: 1 }, { origin: { kind: "agent", ctx: claireChat.code }, route: "/f" })
    const copied = await keepTransitFile(lea.db, lea.identity, { file: source.id, path: litige, base_revision: 1 }, { origin: { kind: "agent", ctx: null }, route: "/f" })
    const copy = (copied.data.file as { id: string }).id

    const byLea = (await (await conversation(lea)).read({ path: litige, file: copy })).file?.origin
    const byClaire = (await claireChat.read({ path: litige, file: copy })).file?.origin

    const origin = { kind: "function", function: "3cx.recording", by: { id: o.people.claire.id, name: expect.anything() as unknown }, at: ISO, copied_from: source.id, copied_at: ISO }
    expect({ byLea, byClaire }).toEqual({ byLea: origin, byClaire: { ...origin, ctx: claireChat.code } })
  })

  // La carte d'un fichier joint lit l'origine par la vérification de sa disponibilité (`GET /f/<id>?check`).
  it("should give with the availability of a kept file its function, date and author to any reader, the conversation to its author alone", async () => {
    const claireChat = await conversation(claire)
    const source = await recording(claire, claireChat.code)
    const durand = await page(claire, claireChat.code)
    await keepTransitFile(claire.db, claire.identity, { file: source.id, path: durand, base_revision: 1 }, { origin: { kind: "agent", ctx: claireChat.code }, route: "/f" })

    const byLea = await fileAvailability(lea.db, lea.identity, source.id)
    const byClaire = await fileAvailability(claire.db, claire.identity, source.id)

    const origin = { kind: "function", function: "3cx.recording", by: { id: o.people.claire.id, name: expect.anything() as unknown }, at: ISO }
    expect({ byLea, byClaire }).toEqual({ byLea: { available: true, origin }, byClaire: { available: true, origin: { ...origin, ctx: claireChat.code } } })
  })

  it("should mark the files of a duplicated page as copies of the originals, with their origin", async () => {
    const chat = await conversation(lea)
    const source = await recording(lea, chat.code)
    const path = await page(lea, chat.code)
    await keepTransitFile(lea.db, lea.identity, { file: source.id, path, base_revision: 1 }, { origin: { kind: "agent", ctx: chat.code }, route: "/f" })

    const copyPath = (await duplicateNode(lea.db, lea.identity, { path })).data.path
    const [copy] = await fx.admin<{ id: string }[]>`
      select f.id from platform.files f join platform.nodes n on n.id = f.node_id where n.org_id = ${o.org.id} and n.path = ${copyPath}`

    expect(await rowOf(copy.id)).toEqual({ origin_kind: "function", origin_function: "3cx.recording", origin_ctx: chat.code, origin_by: o.people.lea.id, copied_from: source.id })
  })

  it("should refuse a copy of a file the caller does not read", async () => {
    const theirs = await recording(claire, null)

    const copy = refusalOf(insertPending(lea.db, lea.identity, { nodeId: null, transitHours: 24, name: "vole.txt", mime: "text/plain", size: 7, origin: { copiedFrom: theirs.id } }))

    expect(await copy).not.toBe("ok")
  })

  it("should forget the author of the origin who leaves the organisation, and keep the function and the date", async () => {
    const gone = await fx.createUser()
    await fx.addMember(o.org.id, gone.id)
    const session = await sessionOf(gone)
    const file = await recording(session, null)

    await fx.admin`delete from platform.members where org_id = ${o.org.id} and user_id = ${gone.id}`

    expect(await rowOf(file.id)).toMatchObject({ origin_kind: "function", origin_function: "3cx.recording", origin_by: null })
  })

  // L'import d'une organisation (`scripts/org-import.mjs`, par la connexion d'administration) reprend l'origine de la source.
  it("should keep an origin already dated, with its author, as the import of an organisation writes it", async () => {
    const [imported] = await fx.admin<{ id: string }[]>`
      insert into platform.files (org_id, node_id, name, mime, size, status, created_by, expires_at, origin_kind, origin_function, origin_by, origin_at)
      values (${o.org.id}, null, 'importe.txt', 'text/plain', 1, 'pending', ${o.people.lea.id}, now() + interval '24 hours', 'function', '3cx.recording', ${o.people.claire.id}, '2026-03-02T10:00:00Z')
      returning id`
    const [dated] = await fx.admin<{ origin_at: Date }[]>`select origin_at from platform.files where id = ${imported.id}`

    expect({ row: await rowOf(imported.id), at: dated.origin_at.toISOString() }).toEqual({
      row: { origin_kind: "function", origin_function: "3cx.recording", origin_ctx: null, origin_by: o.people.claire.id, copied_from: null },
      at: "2026-03-02T10:00:00.000Z",
    })
  })

  it("should serve no origin for a file written before the origin existed", async () => {
    const chat = await conversation(lea)
    const file = await recording(lea, null)
    await fx.admin`update platform.files set origin_kind = null, origin_function = null, origin_by = null, origin_at = null where id = ${file.id}`

    expect((await chat.read({ file: file.id })).file?.origin).toBeNull()
  })
})
