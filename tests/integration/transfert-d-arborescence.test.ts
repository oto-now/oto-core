// @vitest-environment node
// Le transfert d'une arborescence d'un MCP Oto à un autre, sur une vraie base : `node.export_tree` (le pivot à une URL
// signée, ce qu'on lit seulement, les liens hors du périmètre, l'en-tête et les lignes d'un tableau avec leurs preuves)
// et `node.import_tree` (deux passes sous un parent, liens recollés, en-tête complet posé après les lignes, collisions
// skip / overwrite / suffix, déversement, reprise par `continue_from`, ZIP aux deux conventions, `.md` et CSV seuls, ZIP
// joint à une page).
// Le bucket est l'adaptateur en mémoire, le téléchargement sert ses URL (aucun réseau). Suite portable.
import { strToU8, zipSync } from "fflate"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { resolveIdentity, type Identity, type PlatformDb } from "@otomata_tech/oto_platform/server"
import { treeExportArgsSchema, treeImportArgsSchema, treePivotSchema } from "../../packages/plateforme/schemas/tree-transfer"
import { tableWriteArgsSchema } from "../../packages/plateforme/schemas/table-write"
import { FILES_ROUTE } from "../../packages/plateforme/schemas/files"
import { memoryFileStore, type MemoryFileStore } from "../../packages/plateforme/server/files/memory"
import { storeFile } from "../../packages/plateforme/server/files/service"
import { findNode } from "../../packages/plateforme/server/nodes/lookup"
import { loadBlocks } from "../../packages/plateforme/server/nodes/store"
import { writeNodeLazily } from "../../packages/plateforme/server/nodes/write-lazy"
import { publishedHeader } from "../../packages/plateforme/server/tables/meta"
import { loadRows, toReadRow } from "../../packages/plateforme/server/tables/rows"
import { tableWrite } from "../../packages/plateforme/server/tables/write"
import { purgeExpiredExports } from "../../packages/plateforme/server/transfer/files"
import { importPlan } from "../../packages/plateforme/server/transfer/formats"
import { nodeExportTree, nodeImportTree, setTreeFetchDeps } from "../../packages/plateforme/server/transfer/functions"
import { runImport } from "../../packages/plateforme/server/transfer/import"
import { nodeCheck, nodeTree } from "../../packages/plateforme/server/transfer/inspect"
import type { SourceAnswer } from "../../packages/plateforme/server/uploads-fetch"
import { hex } from "../helpers/plateforme"
import { createLocalFixtures, type LocalFixtures } from "../helpers/session-locale"
import { SQL_SKIP_REASON, sqlConfigured, type SqlReferenceOrg } from "../helpers/sql"

const storage = vi.hoisted(() => ({ store: null as MemoryFileStore | null }))

vi.mock("../../packages/plateforme/server/files/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../packages/plateforme/server/files/store")>()),
  fileStore: () => storage.store,
}))

const NETWORK_TIMEOUT = 120_000
const SETUP_TIMEOUT = 180_000
const SUITE = "tree transfer between Oto platforms (node.export_tree, node.import_tree)"

type Session = { db: PlatformDb; identity: Identity }

describe.skipIf(!sqlConfigured)(sqlConfigured ? SUITE : `${SUITE} (${SQL_SKIP_REASON})`, { timeout: NETWORK_TIMEOUT }, () => {
  let fx: LocalFixtures
  let o: SqlReferenceOrg
  let ada: Session
  let memory: MemoryFileStore
  /** Les sources servies hors du bucket (un ZIP, un `.md`, un CSV publics), par adresse. */
  const served = new Map<string, { bytes: Uint8Array; type: string }>()
  const root = `kb_${hex(3)}`

  const context = () => ({ db: ada.db, identity: ada.identity, ctx: null, origin: `https://${o.host}` })
  const exportTree = (args: unknown) => nodeExportTree.run(context(), treeExportArgsSchema.parse(args) as never)
  const importTree = (args: unknown) => nodeImportTree.run(context(), treeImportArgsSchema.parse(args) as never)
  const write = (input: Record<string, unknown>) => writeNodeLazily(ada.db, ada.identity, input, { kind: "agent", ctx: null })

  /** Le markdown publié d'une page, bloc par bloc. */
  async function texts(path: string): Promise<string[]> {
    const found = await findNode(ada.db, ada.identity, path)
    if (!found) throw new Error(`no node ${path}`)
    return (await loadBlocks(ada.db, found.node.id, "published")).map((block) => block.text ?? JSON.stringify(block.data))
  }

  async function tableOf(path: string) {
    const found = await findNode(ada.db, ada.identity, path)
    if (!found) throw new Error(`no table ${path}`)
    const published = publishedHeader(found.node)
    if (!("header" in published)) throw new Error(`no header for ${path}`)
    const rows = (await loadRows(ada.db, found.node.id, 100)).map((block) => toReadRow(block, published.header, new Map(), { provenance: true }))
    return { header: published.header, rows }
  }

  beforeAll(async () => {
    fx = createLocalFixtures()
    o = await fx.buildReferenceOrg()
    const user = o.people.ada
    ada = { db: fx.as(user), identity: await resolveIdentity(fx.as(user), o.host, { userId: user.id, email: user.email }) }
    memory = memoryFileStore()
    storage.store = memory
    // La source : une page qui cite sa sœur, une page hors du périmètre et du code (laissé tel quel), une sous-page, un
    // tableau à file de travail et à preuve exigée, dont les lignes portent leurs preuves.
    await write({ path: root, kind: "page", title: "Base SAV", summary: "La base du SAV." })
    await write({ path: `${root}/fiches`, kind: "page", title: "Fiches", summary: "Les fiches.", ops: [{ op: "set_markdown", text: `## Garantie\n\nVoir [[${root}/fiches/retour|le retour]] et [[ventes]].\n\n- statut ACTIVE\n- statut TEMPLATE\n\n\`\`\`text\n[[${root}/fiches]]\n\`\`\`` }] })
    await write({ path: `${root}/fiches/retour`, kind: "page", title: "Retour", summary: "Le retour produit.", ops: [{ op: "set_markdown", text: `Revenir à [[${root}/fiches]].` }] })
    await write({ path: `${root}/suivi`, kind: "table", title: "Suivi", summary: "Le suivi des dossiers.", header: { columns: [{ name: "dossier", type: "text" }, { name: "statut", type: "enum", options: ["ouvert", "en cours", "clos"] }, { name: "note", type: "text" }], key: "dossier" } })
    const rows = tableWriteArgsSchema.parse({
      table: `${root}/suivi`,
      rows: [
        { key: "D1", set: { statut: "clos", note: { value: "Réglé", comment: "Appel du 3 mars" } } },
        { key: "D2", set: { statut: "en cours", note: { value: "En attente", link: "https://exemple.test/d2" } } },
      ],
    })
    await tableWrite.run(context(), rows as never)
    const suivi = await findNode(ada.db, ada.identity, `${root}/suivi`)
    await write({ path: `${root}/suivi`, base_revision: suivi?.node.revision, header: { lifecycle: { column: "statut", states: ["ouvert", "en cours", "clos"], working: "en cours" }, proof: true } })
    setTreeFetchDeps({
      resolve: async () => [{ address: "93.184.216.34", family: 4 }],
      get: async (url): Promise<SourceAnswer> => {
        const external = served.get(url.href)
        const answer = external ? new Response(external.bytes, { headers: { "content-type": external.type } }) : await memory.fetch(url.href)
        const bytes = new Uint8Array(await answer.arrayBuffer())
        return { status: answer.status, location: null, length: bytes.byteLength, type: answer.headers.get("content-type"), body: (async function* () { yield bytes })(), discard: () => {} }
      },
    })
  }, SETUP_TIMEOUT)

  beforeEach(() => {
    storage.store = memory
  })

  afterEach(() => vi.restoreAllMocks())

  afterAll(async () => {
    setTreeFetchDeps({})
    await fx?.cleanup()
  }, SETUP_TIMEOUT)

  async function exported(): Promise<string> {
    const output = await exportTree({ paths: [root] })
    return String(output.data?.url)
  }

  it("should export the readable tree as a valid pivot, its table with header, rows and proofs, and list the links outside it", async () => {
    const output = await exportTree({ paths: [root] })
    expect(output.data).toMatchObject({ format: "json", nodes: 4, roots: [{ path: root, name: root }], orphans: [{ from: `${root}/fiches`, to: "ventes" }] })
    const answer = await memory.fetch(String(output.data?.url))
    const pivot = treePivotSchema.parse(JSON.parse(await answer.text()))
    expect(pivot.nodes.map((node) => node.path)).toEqual([root, `${root}/fiches`, `${root}/fiches/retour`, `${root}/suivi`])
    const suivi = pivot.nodes[3].table
    expect(suivi?.header).toMatchObject({ key: "dossier", proof: true, lifecycle: { column: "statut", working: "en cours" } })
    expect(suivi?.rows).toEqual([
      { key: "D1", set: { dossier: "D1", statut: "clos", note: "Réglé" }, proofs: { note: { comment: "Appel du 3 mars" } } },
      { key: "D2", set: { dossier: "D2", statut: "en cours", note: "En attente" }, proofs: { note: { link: "https://exemple.test/d2" } } },
    ])
    expect(await answer.headers.get("content-disposition")).toContain(`${root}.json`)
  })

  it("should leave out what the person cannot read, and refuse to import under a page she cannot read, writing nothing", async () => {
    const marc = o.people.marc
    const asMarc = { db: fx.as(marc), identity: await resolveIdentity(fx.as(marc), o.host, { userId: marc.id, email: marc.email }), ctx: null, origin: `https://${o.host}` }
    await write({ path: "private/ada/secret", kind: "page", title: "Secret", summary: "La page d'Ada." })
    const output = await nodeExportTree.run(asMarc, treeExportArgsSchema.parse({ paths: ["private"] }) as never)
    const pivot = treePivotSchema.parse(JSON.parse(await (await memory.fetch(String(output.data?.url))).text()))
    // `private` n'a jamais été publié : laissé, avec ce qui est sous lui ; l'espace d'Ada n'y paraît même pas.
    const seen = [...pivot.nodes.map((node) => node.path), ...(output.data?.skipped as { path: string }[]).map((item) => item.path)]
    expect(seen).toContain("private/marc")
    expect(seen.filter((path) => path.startsWith("private/ada"))).toEqual([])
    const url = await exported()
    await expect(nodeImportTree.run(asMarc, treeImportArgsSchema.parse({ source_url: url, parent: "private/ada" }) as never)).rejects.toMatchObject({ code: "not_found" })
    expect(await findNode(ada.db, ada.identity, `private/ada/${root}`)).toBeNull()
  })

  it("should refuse an unknown root, and a root under another one", async () => {
    await expect(exportTree({ paths: [`${root}_absent`] })).rejects.toMatchObject({ code: "not_found" })
    await expect(exportTree({ paths: [root, `${root}/fiches`] })).rejects.toMatchObject({ code: "invalid_arguments" })
  })

  it("should import under a parent in two passes, links following their new paths, the code and the outside link kept, the full header set after the rows", async () => {
    const output = await importTree({ source_url: await exported(), parent: "ventes" })
    const base = `ventes/${root}`
    expect(output.data).toMatchObject({ created: [base, `${base}/fiches`, `${base}/fiches/retour`, `${base}/suivi`], refused: [] })
    expect(output.data?.orphans).toEqual([{ from: `${base}/fiches`, to: "ventes" }])
    const fiches = (await texts(`${base}/fiches`)).join("\n")
    expect(fiches).toContain(`[[${base}/fiches/retour|le retour]]`)
    expect(fiches).toContain("[[ventes]]")
    expect(fiches).toContain(`[[${root}/fiches]]`)
    expect(fiches).toContain("statut TEMPLATE")
    expect((await texts(`${base}/fiches/retour`)).join("\n")).toContain(`[[${base}/fiches]]`)
    const suivi = await tableOf(`${base}/suivi`)
    expect(suivi.header).toMatchObject({ key: "dossier", proof: true, lifecycle: { column: "statut", states: ["ouvert", "en cours", "clos"] } })
    expect(suivi.rows.map((row) => [row.key, row.set.statut, row.set.note, row.provenance?.note?.comment ?? row.provenance?.note?.link])).toEqual([
      ["D1", "clos", "Réglé", "Appel du 3 mars"],
      ["D2", "en cours", "En attente", "https://exemple.test/d2"],
    ])
  })

  it("should keep what is there on a second import (skip), update it with overwrite, and put the root next to it with suffix", async () => {
    const url = await exported()
    const again = await importTree({ source_url: url, parent: "ventes" })
    expect(again.data).toMatchObject({ created: [], updated: [] })
    expect((again.data?.skipped as { path: string }[]).map((item) => item.path)).toContain(`ventes/${root}/fiches`)

    const retour = await findNode(ada.db, ada.identity, `${root}/fiches/retour`)
    await write({ path: `${root}/fiches/retour`, base_revision: retour?.node.revision, ops: [{ op: "set_markdown", text: "Nouveau texte." }] })
    const overwritten = await importTree({ source_url: await exported(), parent: "ventes", collision: "overwrite" })
    expect(overwritten.data?.updated).toContain(`ventes/${root}/fiches/retour`)
    expect(await texts(`ventes/${root}/fiches/retour`)).toEqual(["Nouveau texte."])

    const suffixed = await importTree({ source_url: url, parent: "ventes", collision: "suffix" })
    expect((suffixed.data?.created as string[])[0]).toBe(`ventes/${root}_2`)
    expect((await texts(`ventes/${root}_2/fiches`)).join("\n")).toContain(`[[ventes/${root}_2/fiches/retour|le retour]]`)
  })

  it("should pour the content of the root directly under the parent, the root page not created", async () => {
    await write({ path: `support/depot_${root}`, kind: "page", title: "Dépôt", summary: "Le dépôt." })
    const output = await importTree({ source_url: await exported(), parent: `support/depot_${root}`, root_folder: false })
    expect(output.data?.created).toEqual([`support/depot_${root}/fiches`, `support/depot_${root}/fiches/retour`, `support/depot_${root}/suivi`])
    expect((await texts(`support/depot_${root}/fiches`)).join("\n")).toContain(`[[support/depot_${root}/fiches/retour|le retour]]`)
  })

  it("should stop at the time limit and go on from continue_from to the same end", async () => {
    await write({ path: `support/reprise_${root}`, kind: "page", title: "Reprise", summary: "La reprise." })
    const answer = await memory.fetch(await exported())
    const plan = importPlan("json", new Uint8Array(await answer.arrayBuffer()), `${root}.json`)
    let clock = 0
    const now = () => (clock += 30_000)
    const args = { source_url: "https://memory.invalid/x", parent: `support/reprise_${root}`, source: "x" }
    const first = await runImport(context(), plan, args, now)
    expect(first.next).not.toBeNull()
    expect(first.done).toBeLessThan(first.total)
    let next = first.next
    let created = [...first.report.created]
    for (let guard = 0; next !== null && guard < 20; guard++) {
      const step = await runImport(context(), plan, { ...args, continue_from: next }, now)
      created = [...created, ...step.report.created]
      next = step.next
    }
    expect(next).toBeNull()
    expect(created).toEqual([`support/reprise_${root}/${root}`, `support/reprise_${root}/${root}/fiches`, `support/reprise_${root}/${root}/fiches/retour`, `support/reprise_${root}/${root}/suivi`])
    expect((await tableOf(`support/reprise_${root}/${root}/suivi`)).header.proof).toBe(true)
  })

  it("should import a zip, a folder's page read from <folder>.md or <folder>/index.md, .md as pages, .csv as tables, links within the zip following", async () => {
    const zip = zipSync({
      "Base/Fiches.md": strToU8("---\ntitle: Les fiches\nsummary: Toutes les fiches.\n---\n\nVoir [[fiches/garantie]]."),
      "Base/Fiches/Garantie.md": strToU8("# Garantie\n\nDeux ans."),
      "Base/Procédures/index.md": strToU8("# Procédures\n\nLes procédures."),
      "Base/Procédures/Clients.csv": strToU8("Nom;Ville\nAcme;Lyon\nBeta;Nantes\n"),
      "Base/photo.png": new Uint8Array([1, 2, 3]),
    })
    served.set("https://exemple.test/base.zip", { bytes: zip, type: "application/zip" })
    await write({ path: `support/zip_${root}`, kind: "page", title: "Zip", summary: "Le zip." })
    const output = await importTree({ source_url: "https://exemple.test/base.zip", parent: `support/zip_${root}` })
    const base = `support/zip_${root}/base`
    expect(output.data?.created).toEqual([base, `${base}/fiches`, `${base}/procedures`, `${base}/fiches/garantie`, `${base}/procedures/clients`])
    expect(String(output.text)).toContain("Base/photo.png")
    expect((await texts(`${base}/fiches`)).join("\n")).toContain(`[[${base}/fiches/garantie]]`)
    expect(await texts(`${base}/procedures`)).toEqual(["Les procédures."])
    const clients = await tableOf(`${base}/procedures/clients`)
    expect(clients.rows.map((row) => row.set.ville)).toEqual(["Lyon", "Nantes"])
  })

  it("should import a single markdown file as one page and a single CSV as one table", async () => {
    served.set("https://exemple.test/notes.md", { bytes: strToU8("# Notes du salon\n\nTrois contacts."), type: "text/markdown" })
    served.set("https://exemple.test/contacts.csv", { bytes: strToU8("Email,Nom\na@x.test,Anne\nb@x.test,Bob\n"), type: "text/csv" })
    await write({ path: `support/seul_${root}`, kind: "page", title: "Seul", summary: "Seul." })
    const md = await importTree({ source_url: "https://exemple.test/notes.md", parent: `support/seul_${root}` })
    expect(md.data?.created).toEqual([`support/seul_${root}/notes`])
    expect(await texts(`support/seul_${root}/notes`)).toEqual(["Trois contacts."])
    const csv = await importTree({ source_url: "https://exemple.test/contacts.csv", parent: `support/seul_${root}` })
    expect(csv.data?.created).toEqual([`support/seul_${root}/contacts`])
    expect((await tableOf(`support/seul_${root}/contacts`)).rows).toHaveLength(2)
  })

  it("should import a zip attached to a page from the address read gives, read in the storage under the right to read its page", async () => {
    vi.stubGlobal("fetch", memory.fetch)
    try {
      await write({ path: `support/joint_${root}`, kind: "page", title: "Joint", summary: "Le zip joint." })
      const page = await findNode(ada.db, ada.identity, `support/joint_${root}`)
      const zip = zipSync({ "Notes/Salon.md": strToU8("# Salon\n\nTrois contacts.") })
      const file = await storeFile(ada.db, ada.identity, { nodeId: page!.node.id, name: "notes.zip", bytes: zip })
      const output = await importTree({ source_url: `https://${o.host}${FILES_ROUTE}/${file.id}`, parent: `support/joint_${root}` })
      expect(output.data?.created).toEqual([`support/joint_${root}/notes`, `support/joint_${root}/notes/salon`])
      expect(await texts(`support/joint_${root}/notes/salon`)).toEqual(["Trois contacts."])
      await expect(importTree({ source_url: `https://${o.host}${FILES_ROUTE}/00000000-0000-4000-8000-000000000000`, parent: `support/joint_${root}` })).rejects.toMatchObject({ code: "not_found" })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it("should carry the attached files of a json export to the arrival page, leave the mention of a file that does not arrive, and carry none in a zip", async () => {
    vi.stubGlobal("fetch", memory.fetch)
    try {
      const source = `pj_${root}`
      await write({ path: source, kind: "page", title: "Pièces", summary: "Les pièces jointes." })
      const page = await findNode(ada.db, ada.identity, source)
      const kept = await storeFile(ada.db, ada.identity, { nodeId: page!.node.id, name: "rapport.pdf", bytes: new Uint8Array([1, 2, 3]) })
      const lost = await storeFile(ada.db, ada.identity, { nodeId: page!.node.id, name: "perdu.txt", bytes: strToU8("perdu") })
      const text = ["Le rapport :", `[rapport.pdf (3 bytes, pdf)](${FILES_ROUTE}/${kept.id})`, `[perdu.txt (5 bytes, txt)](${FILES_ROUTE}/${lost.id})`].join("\n\n")
      await write({ path: source, base_revision: page!.node.revision, ops: [{ op: "set_markdown", text }] })
      const exported = await exportTree({ paths: [source] })
      expect(exported.data?.files).toBe(2)
      // L'objet du second fichier disparaît du bucket : l'import ne le relit pas.
      memory.objects.delete(`${o.org.id}/${lost.id}`)
      await write({ path: `support/pj_${root}`, kind: "page", title: "Arrivée", summary: "L'arrivée." })
      const output = await importTree({ source_url: String(exported.data?.url), parent: `support/pj_${root}` })
      expect(output.data?.refused).toEqual([{ path: `support/pj_${root}/${source} (file perdu.txt)`, reason: expect.stringContaining("could not download it") }])
      const arrival = await findNode(ada.db, ada.identity, `support/pj_${root}/${source}`)
      const blocks = await loadBlocks(ada.db, arrival!.node.id, "published")
      const file = blocks.find((block) => block.type === "file")
      expect(file?.data).toMatchObject({ name: "rapport.pdf", size: 3 })
      expect(file?.data.file_id).not.toBe(kept.id)
      expect(memory.objects.get(`${o.org.id}/${String(file?.data.file_id)}`)?.bytes).toEqual(new Uint8Array([1, 2, 3]))
      expect(blocks.map((block) => block.text)).toContain("(Fichier joint non transféré : perdu.txt)")
      const zip = await exportTree({ paths: [source], format: "zip" })
      expect(zip.data?.files_left).toEqual([{ from: source, name: "rapport.pdf" }, { from: source, name: "perdu.txt" }])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it("should point the paths of the call blocks of a procedure to the arrival, and keep as a draft a procedure whose publication is refused", async () => {
    const source = `proc_${root}`
    await write({ path: source, kind: "page", title: "Procédures", summary: "Les procédures." })
    await write({ path: `${source}/tickets`, kind: "table", title: "Tickets", summary: "Les tickets.", header: { columns: [{ name: "ticket", type: "text" }], key: "ticket" } })
    const appel = ["```call", `table.rows {"table":"${source}/tickets"}`, "```"].join("\n")
    await write({ path: `${source}/traiter`, kind: "procedure", title: "Traiter", summary: "Traiter un ticket.", ops: [{ op: "set_markdown", text: `Lire les tickets.\n\n${appel}` }] })
    await write({ path: `support/proc_${root}`, kind: "page", title: "Arrivée", summary: "L'arrivée." })
    const output = await importTree({ source_url: String((await exportTree({ paths: [source] })).data?.url), parent: `support/proc_${root}` })
    expect(output.data?.refused).toEqual([])
    expect((await texts(`support/proc_${root}/${source}/traiter`)).join("\n")).toContain(`support/proc_${root}/${source}/tickets`)

    const inconnu = ["---", "title: Appeler le PMO", "summary: Une fonction que ce catalogue n'a pas.", "kind: procedure", "---", "", "```call", "pmo.list_tickets {}", "```"].join("\n")
    served.set("https://exemple.test/pmo.md", { bytes: strToU8(inconnu), type: "text/markdown" })
    const refusee = await importTree({ source_url: "https://exemple.test/pmo.md", parent: `support/proc_${root}` })
    expect(refusee.data?.drafts).toEqual([{ path: `support/proc_${root}/pmo`, reason: expect.any(String) }])
    expect(String(refusee.text)).toContain("Kept as drafts")
  })

  it("should replay the reference copy: a Contexte held at the arrival placed beside with its children, table cells and tool names of the source rewritten, the counts said", async () => {
    // La source : une racine jamais publiée, un Contexte (servi en page par l'export) et sa table, une fiche, un index dont
    // une cellule vaut le chemin de la fiche, une page qui nomme les outils de l'organisation source.
    const source = `ref_${root}`
    await write({ path: source, kind: "page", title: "Référence", summary: "La copie de référence.", publish: false })
    await write({ path: `${source}/fiche`, kind: "page", title: "Fiche", summary: "Une fiche.", ops: [{ op: "set_markdown", text: "Lire avec demo_read, puis demo_write ; demo_reader reste." }] })
    await write({ path: `${source}/index`, kind: "table", title: "Index", summary: "L'index.", header: { columns: [{ name: "titre", type: "text" }, { name: "chemin", type: "text" }], key: "titre" } })
    await tableWrite.run(context(), tableWriteArgsSchema.parse({ table: `${source}/index`, rows: [{ key: "Fiche", set: { chemin: `${source}/fiche` } }] }) as never)
    const exported = await exportTree({ paths: [source] })
    const pivot = treePivotSchema.parse(JSON.parse(await (await memory.fetch(String(exported.data?.url))).text()))
    expect(pivot.nodes.map((node) => node.path)).toEqual([source, `${source}/fiche`, `${source}/index`])
    // Le Contexte d'une équipe de la source et sa table, comme l'export d'une équipe les sert ; l'organisation source « demo ».
    const contexte = { path: `${source}/contexte`, kind: "page" as const, title: "Contexte", summary: "Le contexte de l'équipe.", blocks: [{ type: "paragraph", text: "Règles de l'équipe.", data: {}, key: null }] }
    const journal = { path: `${source}/contexte/journal`, kind: "page" as const, title: "Journal", summary: "Le journal.", blocks: [] }
    const modified = { ...pivot, source: { ...pivot.source, prefix: "demo" }, nodes: [...pivot.nodes, contexte, journal] }
    served.set("https://exemple.test/reference.json", { bytes: strToU8(JSON.stringify(modified)), type: "application/json" })

    // Déversé sous le dossier de l'équipe support : `support/contexte` est son Contexte, qu'aucun import ne remplace.
    const output = await importTree({ source_url: "https://exemple.test/reference.json", parent: "support", root_folder: false })
    expect(output.data?.refused).toEqual([])
    expect(output.data?.created).toEqual(expect.arrayContaining(["support/fiche", "support/index", "support/contexte_2", "support/contexte_2/journal"]))
    expect(String(output.text)).toContain("support/contexte is a Contexte")
    expect(output.data?.rewritten).toEqual({ paths: 1, prefixes: 2 })
    expect(String(output.text)).toContain("The source holds 5 node(s)")
    expect(output.data?.problems).toEqual([])
    expect(String(output.text)).toContain("node.check on what arrived: nothing to fix.")
    expect((await tableOf("support/index")).rows.map((row) => row.set.chemin)).toEqual(["support/fiche"])
    expect((await texts("support/fiche")).join("\n")).toBe(`Lire avec ${o.org.prefix}_read, puis ${o.org.prefix}_write ; demo_reader reste.`)
    const contexteServi = await findNode(ada.db, ada.identity, "support/contexte")
    expect(contexteServi?.node.kind).toBe("context")
  })

  it("should give the whole refusal of a procedure, one line, and say an empty node created for it holds its text as a draft", async () => {
    const inconnu = ["---", "title: Deux appels inconnus", "summary: Deux fonctions que ce catalogue n'a pas.", "kind: procedure", "---", "", "```call", "pmo.list_tickets {}", "```", "", "```call", "pmo.close_ticket {}", "```"].join("\n")
    served.set("https://exemple.test/deux.md", { bytes: strToU8(inconnu), type: "text/markdown" })
    await write({ path: `support/deux_${root}`, kind: "page", title: "Deux", summary: "Deux." })
    const output = await importTree({ source_url: "https://exemple.test/deux.md", parent: `support/deux_${root}` })
    const [draft] = output.data?.drafts as { path: string; reason: string }[]
    expect(draft.reason).toMatch(/^created empty, its text kept as a draft: invalid_arguments: /)
    expect(draft.reason).toContain("pmo.list_tickets")
    expect(draft.reason).toContain("pmo.close_ticket")
  })

  it("should list a tree with node.tree, and find with node.check a broken link, a cell naming a missing path, a call refused and another organisation's tools", async () => {
    const tree = await nodeTree.run(context(), { path: root } as never)
    expect(tree.data?.nodes).toEqual([
      expect.objectContaining({ path: root, kind: "page" }),
      expect.objectContaining({ path: `${root}/fiches` }),
      expect.objectContaining({ path: `${root}/fiches/retour` }),
      expect.objectContaining({ path: `${root}/suivi`, kind: "table" }),
    ])
    const lieu = `controle_${root}`
    await write({ path: lieu, kind: "page", title: "Contrôle", summary: "À contrôler.", ops: [{ op: "set_markdown", text: `Voir [[${lieu}/absente]] et [[ventes]] ; lire avec zzz_read, écrire avec zzz_write.` }] })
    await write({ path: `${lieu}/index`, kind: "table", title: "Index", summary: "L'index.", header: { columns: [{ name: "titre", type: "text" }, { name: "chemin", type: "text" }], key: "titre" } })
    await tableWrite.run(context(), tableWriteArgsSchema.parse({ table: `${lieu}/index`, rows: [{ key: "A", set: { chemin: `${lieu}/perdue` } }, { key: "B", set: { chemin: `${lieu}/index` } }] }) as never)
    // Une procédure sous une procédure : routée à la place de la principale, signalée.
    await write({ path: `${lieu}/principale`, kind: "procedure", title: "Principale", summary: "La procédure principale.", ops: [{ op: "set_markdown", text: "## Étapes\n\n1. Fais la première étape." }] })
    await write({ path: `${lieu}/principale/etape`, kind: "procedure", title: "Étape", summary: "Une sous-procédure.", ops: [{ op: "set_markdown", text: "## Étapes\n\n1. Fais l'étape." }] })
    const checked = await nodeCheck.run(context(), { path: lieu } as never)
    expect(checked.data?.problems).toEqual([
      `${lieu}: names tools of another organisation (zzz_…): write read, write, find, call without prefix`,
      `${lieu}/principale/etape: a procedure under the procedure ${lieu}/principale: write its steps in a page under it, linked from the main procedure, then trash this one`,
      `${lieu}: links to ${lieu}/absente, which does not exist`,
      `${lieu}/index: links to ${lieu}/perdue, which does not exist`,
    ])
    expect((await nodeCheck.run(context(), { path: root } as never)).data?.problems).toEqual([])
  })

  it("should remove the exports whose address expired, and only them", async () => {
    await exportTree({ paths: [root] })
    const prefix = `${o.org.id}/exports/`
    const before = [...memory.objects.keys()].filter((key) => key.startsWith(prefix)).length
    expect(await purgeExpiredExports(memory, o.org.id)).toBe(0)
    expect(await purgeExpiredExports(memory, o.org.id, Date.now() + 3_601_000)).toBe(before)
    expect([...memory.objects.keys()].filter((key) => key.startsWith(prefix))).toEqual([])
  })

  it("should refuse an unknown parent and a source that is not a tree", async () => {
    await expect(importTree({ source_url: await exported(), parent: `${root}_absent` })).rejects.toMatchObject({ code: "not_found" })
    served.set("https://exemple.test/autre.json", { bytes: strToU8('{"hello": 1}'), type: "application/json" })
    await expect(importTree({ source_url: "https://exemple.test/autre.json", parent: "ventes" })).rejects.toMatchObject({ code: "invalid_arguments" })
    // Une bombe de décompression : 101 Mo de zéros tiennent en quelques centaines de kilo-octets zippés.
    expect(() => importPlan("zip", zipSync({ "bombe.md": new Uint8Array(101 * 1024 * 1024) }), "bombe.zip")).toThrow(/once unzipped/)
  })
})
