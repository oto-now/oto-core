// @vitest-environment node
// Les pages désignées par leur identifiant stable (`nodes.id`) sur une vraie base : `read`, `write` et `node.move` par
// `id`, avec les droits du chemin ; une page à la corbeille lue ou écrite par `id` refusée en le disant ; `node.describe`
// en un lot, qui ne dit rien de ce que l'appelant ne lit pas ; l'identifiant servi par `read`, `write`, `find` et
// `node.tree`. Fixture d'E07-S01 semée (`seedTableFixture`, suite portable) : Claire mène Ventes, Léa en est membre,
// `private/claire/…` n'est lu que par Claire.
import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { runCall, type CallInput } from "../../packages/plateforme/server/calls"
import { find } from "../../packages/plateforme/server/find"
import { readNode } from "../../packages/plateforme/server/nodes/read"
import { writeNode } from "../../packages/plateforme/server/nodes/write"
import { PERSONAL_TABLE } from "../factories/table-fixture"
import { seedTableFixture } from "../factories/table-fixture-sql"
import { acmeIdentity } from "../factories/table-publish-sql"
import type { Person } from "../helpers/reference-org"
import type { ReferenceOrgSql } from "../helpers/reference-org-sql"
import { portable, seedWithAdmin, spyDb, sqlConfigured, type SeededData } from "../helpers/sql"

const NETWORK_TIMEOUT = 60_000
const SETUP_TIMEOUT = 180_000
const AGENT = { kind: "agent" as const, ctx: null }

describe.skipIf(!sqlConfigured)(portable("pages designated by their stable id"), { timeout: NETWORK_TIMEOUT }, () => {
  let seed: SeededData
  let ref: ReferenceOrgSql

  beforeAll(async () => {
    seed = seedWithAdmin()
    ref = await seedTableFixture(seed)
  }, SETUP_TIMEOUT)

  afterAll(async () => {
    await seed?.cleanup()
  }, SETUP_TIMEOUT)

  const settle = <T>(promise: Promise<T>) =>
    promise.then(
      (result) => ({ result, error: null }),
      (error: unknown) => ({ result: null, error }),
    )

  async function read(person: Person, input: Record<string, unknown>) {
    return readNode(await ref.db(person), acmeIdentity(ref, person), input)
  }

  async function write(person: Person, input: Record<string, unknown>) {
    return writeNode(await ref.db(person), acmeIdentity(ref, person), input, AGENT)
  }

  /** Un `call` de la personne, requêtes comptées. */
  async function call(person: Person, input: CallInput) {
    const spied = spyDb(await ref.db(person))
    const deps = { db: spied.db, identity: acmeIdentity(ref, person), ctxCode: null, origin: "https://acme.test", activeConnectors: async () => new Set<string>() }
    return { ...(await settle(runCall(deps, input))), sent: spied.sent }
  }

  /** Les données de la fonction appelée, que `call` range sous `result`. */
  const resultOf = (outcome: { result: { data?: Record<string, unknown> } | null }) => (outcome.result?.data as { result?: Record<string, unknown> } | undefined)?.result

  async function realId(path: string): Promise<string> {
    const [row] = await seed.admin<{ id: string }[]>`select id from platform.nodes where org_id = ${ref.org.id} and path = ${path}`
    if (!row) throw new Error(`${path} not found`)
    return row.id
  }

  const unknownId = (id: string) => `Unknown id ${id}: no content you can read has it. Use acme_find to locate it by its words.`

  it("should read a page by its id as by its path, its id in the header and the data, and answer an id the reader cannot read as unknown", async () => {
    await write("claire", { path: "ventes/par_id", title: "Par identifiant", summary: "Une page lue par son identifiant.", ops: [{ op: "set_markdown", text: "## Notes\n\nBonjour." }] })
    const id = await realId("ventes/par_id")
    const [byPath, byId] = [await read("lea", { path: "ventes/par_id" }), await read("lea", { id })]
    expect(byId.text).toBe(byPath.text)
    expect(byId.text.split("\n").slice(1, 3)).toEqual([expect.stringMatching(/^path: ventes\/par_id · page · published · revision 1 · /), `id: ${id}`])
    expect(byId.data).toMatchObject({ id, path: "ventes/par_id", level: 2 })

    const personal = await realId(PERSONAL_TABLE)
    const absent = randomUUID()
    const refusals = await Promise.all([settle(read("lea", { id: personal })), settle(read("lea", { id: absent })), settle(read("lea", { path: "ventes/par_id", id })), settle(read("lea", { id: "ventes/par_id" }))])
    expect(refusals.map((one) => one.error)).toMatchObject([
      { code: "not_found", message: unknownId(personal) },
      { code: "not_found", message: unknownId(absent) },
      { code: "invalid_arguments", message: "Give path or id, not both." },
      { code: "invalid_arguments", message: expect.stringContaining("Invalid id « ventes/par_id »") },
    ])
    // Son propriétaire la lit par son identifiant.
    expect((await read("claire", { id: personal })).data).toMatchObject({ id: personal, path: PERSONAL_TABLE })
  })

  it("should edit and move a page by its id with the rights of its path, never create by id, and serve the id in write, find and node.tree", async () => {
    const created = await write("claire", { path: "ventes/zygomatique", title: "Fiche zygomatique", summary: "Une fiche à ranger.", ops: [{ op: "set_markdown", text: "## Notes\n\nDébut." }] })
    await write("claire", { path: "ventes/dossier_id", title: "Dossier", summary: "Où ranger les fiches." })
    const id = await realId("ventes/zygomatique")
    expect(created.data).toMatchObject({ id, path: "ventes/zygomatique", revision: 1 })

    const edited = await write("lea", { id, base_revision: 1, ops: [{ op: "append", section: "Notes", text: "Suite." }] })
    expect(edited.data).toMatchObject({ id, path: "ventes/zygomatique", revision: 2, status: "published" })
    const absent = randomUUID()
    const refusals = await Promise.all([
      settle(write("lea", { id: absent, title: "Neuve", summary: "Jamais créée par identifiant." })),
      settle(write("lea", { id, path: "ventes/zygomatique", base_revision: 2 })),
      settle(write("lea", { base_revision: 2 })),
    ])
    expect(refusals.map((one) => (one.error as { code?: string } | null)?.code)).toEqual(["not_found", "invalid_arguments", "invalid_arguments"])

    // Déplacer exige la gestion, par identifiant comme par chemin.
    const refused = await call("lea", { function: "node.move", arguments: { id, new_path: "ventes/dossier_id/zygomatique" } })
    expect(refused.error).toMatchObject({ code: "forbidden", message: expect.stringContaining("Moving ventes/zygomatique is reserved to") })
    const moved = await call("claire", { function: "node.move", arguments: { id, new_path: "ventes/dossier_id/zygomatique" } })
    expect(resultOf(moved)).toMatchObject({ path: "ventes/dossier_id/zygomatique" })
    expect((await read("lea", { id })).data).toMatchObject({ id, path: "ventes/dossier_id/zygomatique", revision: 2 })
    const both = await call("claire", { function: "node.move", arguments: { id, path: "ventes/dossier_id/zygomatique", new_path: "ventes/zygomatique" } })
    expect(both.error).toMatchObject({ code: "invalid_arguments", message: expect.stringContaining("Give path or id, not both.") })

    const found = await find(await ref.db("lea"), acmeIdentity(ref, "lea"), { query: "zygomatique", type: "page" }, { functions: [], activeConnectors: new Set() })
    expect(found.data?.matches).toMatchObject([{ id, path: "ventes/dossier_id/zygomatique" }])
    const tree = await call("lea", { function: "node.tree", arguments: { path: "ventes/dossier_id" } })
    expect(resultOf(tree)?.nodes).toMatchObject([
      { id: await realId("ventes/dossier_id"), path: "ventes/dossier_id" },
      { id, path: "ventes/dossier_id/zygomatique" },
    ])
  })

  it("should refuse a trashed page read or written by its id, saying so, and describe a batch of ids in one read, telling nothing of what the caller cannot read", async () => {
    await write("claire", { path: "ventes/a_jeter", title: "À jeter", summary: "Une page mise à la corbeille." })
    await write("claire", { path: "ventes/a_garder", title: "À garder", summary: "Une page qui reste." })
    await write("claire", { path: "private/claire/brouillon_id", title: "Brouillon", summary: "Une page personnelle jetée." })
    const [trashed, kept, personalTrashed, personal] = await Promise.all(["ventes/a_jeter", "ventes/a_garder", "private/claire/brouillon_id", PERSONAL_TABLE].map(realId))
    for (const path of ["ventes/a_jeter", "private/claire/brouillon_id"]) {
      expect((await call("claire", { function: "node.trash", arguments: { path }, confirm: true })).error).toBeNull()
    }

    const inTrash = `ventes/a_jeter (id ${trashed}) is in the trash: it cannot be read nor written until a manager restores it from the Trash screen.`
    const [readTrashed, writeTrashed, hiddenTrashed] = await Promise.all([
      settle(read("lea", { id: trashed })),
      settle(write("lea", { id: trashed, base_revision: 1, title: "Revenue" })),
      settle(read("lea", { id: personalTrashed })),
    ])
    expect([readTrashed.error, writeTrashed.error, hiddenTrashed.error]).toMatchObject([
      { code: "conflict", message: inTrash },
      { code: "conflict", message: inTrash },
      { code: "not_found", message: unknownId(personalTrashed) },
    ])

    const absent = randomUUID()
    const ids = [kept, trashed, personal, personalTrashed, absent, kept.toUpperCase()]
    const lea = await call("lea", { function: "node.describe", arguments: { ids } })
    expect(resultOf(lea)).toEqual({
      nodes: [
        { id: kept, state: "present", can_read: true, title: "À garder", path: "ventes/a_garder" },
        { id: trashed, state: "trashed", can_read: false },
        { id: personal, state: "missing", can_read: false },
        { id: personalTrashed, state: "missing", can_read: false },
        { id: absent, state: "missing", can_read: false },
      ],
    })
    expect(lea.result?.text.split("\n")[0]).toBe("5 ids: 1 present, 1 in the trash, 3 missing or not visible to you.")
    const claire = await call("claire", { function: "node.describe", arguments: { ids: [personal, personalTrashed] } })
    expect(resultOf(claire)?.nodes).toEqual([
      { id: personal, state: "present", can_read: true, title: expect.any(String), path: PERSONAL_TABLE },
      { id: personalTrashed, state: "trashed", can_read: false },
    ])
    // Le lot coûte autant de requêtes pour un identifiant que pour cinq : aucune requête par identifiant.
    const one = await call("lea", { function: "node.describe", arguments: { ids: [kept] } })
    expect(one.sent.length).toBe(lea.sent.length)

    const refusals = await Promise.all([call("lea", { function: "node.describe", arguments: { ids: [] } }), call("lea", { function: "node.describe", arguments: { ids: ["ventes/a_garder"] } })])
    expect(refusals.map((one) => (one.error as { code?: string } | null)?.code)).toEqual(["invalid_arguments", "invalid_arguments"])
  })
})
