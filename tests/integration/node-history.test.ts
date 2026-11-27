// @vitest-environment node
// L'historique des versions d'un contenu sur une vraie base : la liste (de la plus récente à la plus ancienne, auteur,
// porte, ligne de résumé, portée d'un bloc, pages), l'écart d'une version à la précédente, et le retour à une version
// (`restoreRevision`), publié comme une révision de plus, refusé sans le droit d'écrire, sur un tableau, sur une
// révision périmée et sur un brouillon ouvert. Suite portable.
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { nodesRoutes } from "../../packages/plateforme/api/nodes"
import type { Route } from "../../packages/plateforme/api/handler"
import { nodeHistory, nodeHistoryDiff } from "../../packages/plateforme/server/nodes/history"
import { restoreRevision } from "../../packages/plateforme/server/nodes/restore"
import { loadBlocks } from "../../packages/plateforme/server/nodes/store"
import { writeNode } from "../../packages/plateforme/server/nodes/write"
import type { Person } from "../helpers/reference-org"
import { seedReferenceOrg, type ReferenceOrgSql } from "../helpers/reference-org-sql"
import { portable, seedWithAdmin, spyDb, sqlConfigured, writesOf, type SeededData } from "../helpers/sql"

const TIMEOUT = 60_000

describe.skipIf(!sqlConfigured)(portable("the version history of a node"), { timeout: TIMEOUT }, () => {
  let seed: SeededData
  let ref: ReferenceOrgSql

  beforeAll(async () => {
    seed = seedWithAdmin()
    ref = await seedReferenceOrg(seed, { rules: [{ node: "ventes", org: true, level: "read" }] })
  }, TIMEOUT)

  afterAll(async () => {
    await seed?.cleanup()
  }, TIMEOUT)

  const as = async (person: Person) => ({ db: await ref.db(person), identity: ref.identityOf(person) })
  const write = async (person: Person, input: Record<string, unknown>, origin: Parameters<typeof writeNode>[3] = { kind: "human" }) => {
    const { db, identity } = await as(person)
    return writeNode(db, identity, input, origin)
  }
  const published = async (path: string) => {
    const [node] = await seed.admin<{ id: string }[]>`select id from platform.nodes where org_id = ${ref.org.id} and path = ${path}`
    const { db } = await as("claire")
    return (await loadBlocks(db, node.id, "published")).map((block) => ({ id: block.id, type: block.type, text: block.text }))
  }
  const failure = (promise: Promise<unknown>) => promise.then(() => null, (error: { code: string; message: string }) => ({ code: error.code, message: error.message }))

  /** Trois versions : A et B (1), A changé (2), B retiré et C ajouté par un assistant (3). */
  async function threeVersions(path: string) {
    await write("claire", { path, title: "Historique", summary: "Trois versions.", ops: [{ op: "add_section", section: "A", text: "a1" }, { op: "add_section", section: "B", text: "b1" }] })
    await write("claire", { path, base_revision: 1, ops: [{ op: "replace_text", section: "A", find: "a1", text: "a2" }] })
    await write("claire", { path, base_revision: 2, ops: [{ op: "delete_section", section: "B" }, { op: "add_section", section: "C", text: "c1" }] }, { kind: "agent", ctx: null })
  }

  it("should restore a version as a new revision, keeping the ids of the blocks it still has and deleting those created after it", async () => {
    const path = "ventes/hist_restore"
    await threeVersions(path)
    const before = await published(path)
    const { db, identity } = await as("claire")
    const restored = await restoreRevision(db, identity, { path, revision: 1, base_revision: 3 })
    expect(restored.data).toEqual({ path, revision: 4, restored: 1 })
    const after = await published(path)
    expect(after.map(({ type, text }) => ({ type, text }))).toEqual([
      { type: "heading", text: "A" },
      { type: "paragraph", text: "a1" },
      { type: "heading", text: "B" },
      { type: "paragraph", text: "b1" },
    ])
    // A et son texte gardent leur identifiant ; C, créé après la version 1, est parti.
    expect(after.slice(0, 2).map((block) => block.id)).toEqual(before.slice(0, 2).map((block) => block.id))
    const created = before.filter((block) => block.text === "C" || block.text === "c1").map((block) => block.id)
    expect(after.filter((block) => created.includes(block.id))).toEqual([])
  })

  it("should refuse a restore without the right to write, before any write", async () => {
    const path = "ventes/hist_lecteur"
    await threeVersions(path)
    const { db, sent } = spyDb(await ref.db("paul"))
    expect(await failure(restoreRevision(db, ref.identityOf("paul"), { path, revision: 1, base_revision: 3 }))).toMatchObject({ code: "forbidden" })
    expect(writesOf(sent)).toEqual([])
    expect(sent.some((query) => query.target === "open_draft")).toBe(false)
  })

  it("should refuse a restore on a table, on a stale revision, on the current revision and over an open draft", async () => {
    const path = "ventes/hist_refus"
    await threeVersions(path)
    const { db, identity } = await as("claire")
    expect(await failure(restoreRevision(db, identity, { path, revision: 1, base_revision: 2 }))).toMatchObject({ code: "stale_revision" })
    expect(await failure(restoreRevision(db, identity, { path, revision: 3, base_revision: 3 }))).toMatchObject({ code: "invalid_arguments" })
    await write("claire", { path, base_revision: 3, ops: [{ op: "append", section: "A", text: "en attente" }], publish: false })
    expect(await failure(restoreRevision(db, identity, { path, revision: 1, base_revision: 3 }))).toMatchObject({ code: "conflict" })
    await write("claire", {
      path: "ventes/hist_tableau",
      title: "Tableau",
      summary: "Un tableau.",
      kind: "table",
      header: { key: "nom", columns: [{ name: "nom", type: "text" }] },
    })
    await write("claire", { path: "ventes/hist_tableau", base_revision: 1, title: "Tableau renommé" })
    expect(await failure(restoreRevision(db, identity, { path: "ventes/hist_tableau", revision: 1, base_revision: 2 }))).toMatchObject({ code: "invalid_arguments" })
  })

  it("should refuse a restore over a draft opened during the call, under the draft's lock, and keep that draft", async () => {
    // La course : un brouillon s'ouvre, dans une autre transaction (la connexion d'administration), juste avant que le
    // retour n'ouvre le sien (`before` de l'espion) ; lu hors du verrou, le brouillon absent laissait le retour le publier.
    const path = "ventes/hist_course"
    await threeVersions(path)
    const [node] = await seed.admin<{ id: string }[]>`select id from platform.nodes where org_id = ${ref.org.id} and path = ${path}`
    let armed = true
    const { db } = spyDb(await ref.db("claire"), {
      before: async (query) => {
        if (!armed || query.target !== "open_draft") return
        armed = false
        await seed.admin`select created from platform.open_draft(${node.id})`
      },
    })
    expect(await failure(restoreRevision(db, ref.identityOf("claire"), { path, revision: 1, base_revision: 3 }))).toMatchObject({ code: "conflict" })
    const [after] = await seed.admin<{ revision: number; drafts: number }[]>`
      select n.revision, (select count(*)::int from platform.node_drafts d where d.node_id = n.id) as drafts from platform.nodes n where n.id = ${node.id}`
    expect(after).toEqual({ revision: 3, drafts: 1 })
  })

  it("should journal a restore as a write of its path, through POST nodes/restore", async () => {
    const path = "ventes/hist_journal"
    await threeVersions(path)
    const route = [nodesRoutes.POST ?? []].flat().find((one: Route) => one.fixed?.[0] === "restore")
    const { db, identity } = await as("claire")
    const request = new Request("https://acme.test/api/platform/nodes/restore", { method: "POST" })
    const body = { path, revision: 2, base_revision: 3 }
    const result = await route?.handle({ db, identity, request, params: ["restore"], body, origin: "https://acme.test", linkOrigin: "https://acme.test" })
    expect(result).toMatchObject({ status: 200, data: { path, revision: 4, restored: 2 }, journal: { target: path } })
  })

  it("should list the versions newest first, with their author and what they changed, a block's alone and by page", async () => {
    const path = "ventes/hist_liste"
    await threeVersions(path)
    const { db, identity } = await as("lea")
    const view = await nodeHistory(db, identity, { path })
    // La version écrite par l'assistant de Claire se lit à son nom, sans porte servie.
    expect(view.entries).toEqual([
      { revision: 3, at: expect.any(String), author: { name: "Claire Morel" }, summary: expect.objectContaining({ added: 2, deleted: 2, changed: 0 }) },
      { revision: 2, at: expect.any(String), author: { name: "Claire Morel" }, summary: expect.objectContaining({ changed: 1, section: null }) },
      { revision: 1, at: expect.any(String), author: { name: "Claire Morel" }, summary: expect.objectContaining({ created: true }) },
    ])
    expect(view.next).toBeNull()
    const blockA = (await published(path))[1].id ?? ""
    expect((await nodeHistory(db, identity, { path, block: blockA })).entries.map((entry) => entry.revision)).toEqual([2, 1])
    // Vingt et une versions : une page de vingt, puis la dernière sous son curseur.
    for (let revision = 3; revision < 21; revision++) await write("claire", { path, base_revision: revision, ops: [{ op: "replace_text", section: "A", find: `a${revision - 1}`, text: `a${revision}` }] })
    const page = await nodeHistory(db, identity, { path })
    expect([page.entries.length, page.next]).toEqual([20, 2])
    expect((await nodeHistory(db, identity, { path, cursor: "2" })).entries.map((entry) => entry.revision)).toEqual([1])
  })

  it("should serve what a version changed against the previous one, and refuse a node the person cannot read", async () => {
    const path = "ventes/hist_ecart"
    await threeVersions(path)
    const { db, identity } = await as("lea")
    const changed = await nodeHistoryDiff(db, identity, { path, revision: "2" })
    expect(changed).toMatchObject({ revision: 2, previous: 1, header: {}, total: 1, blocks: [{ change: "changed", section: "A", before: "a1", after: "a2" }] })
    const third = await nodeHistoryDiff(db, identity, { path, revision: "3" })
    expect(third.blocks.map(({ change, before, after }) => ({ change, before, after }))).toEqual([
      { change: "added", before: null, after: "## C" },
      { change: "added", before: null, after: "c1" },
      { change: "deleted", before: "## B", after: null },
      { change: "deleted", before: "b1", after: null },
    ])
    await write("claire", { path: "private/claire/hist_prive", title: "Privé", summary: "À moi.", ops: [{ op: "add_section", section: "S", text: "t" }] })
    const paul = spyDb(await ref.db("paul"))
    expect(await failure(nodeHistory(paul.db, ref.identityOf("paul"), { path: "private/claire/hist_prive" }))).toMatchObject({ code: "not_found" })
    expect(paul.sent.some((query) => query.target === "node_versions")).toBe(false)
  })
})
