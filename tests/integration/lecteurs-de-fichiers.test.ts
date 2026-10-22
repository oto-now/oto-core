// @vitest-environment node
// Les lecteurs de fichiers sur une vraie base, lot 1 (`lecture-des-fichiers.md` : registre, types de l'hôte, plan et
// `section`), par la porte MCP (`InMemoryTransport`, `connectDeps`) : le type qu'un lecteur de l'hôte inscrit se dépose
// (demande, envoi, confirmation) et se lit, en entier, en plan au-delà de 12 000 caractères, par partie et en tout ; un
// type non inscrit reste refusé au dépôt ; un long `md` vient en plan de ses titres, une section se lit par son nom, au
// curseur au-delà de 45 000 caractères, une section inconnue est refusée avec la liste des parties ; un petit `csv` se
// lit comme avant ; la pseudonymisation passe sur le plan et sur une section. Le bucket est l'adaptateur en mémoire, à
// la place de `fileStore()` et de `fetch` : aucun service extérieur. Suite portable.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { resolveIdentity, type Identity, type PlatformDb } from "@otomata_tech/oto_platform/server"
import { fileSizeText } from "../../packages/plateforme/schemas/files"
import { defineReader, registerReaders } from "../../packages/plateforme/server/files/readers/registry"
import { memoryFileStore, type MemoryFileStore } from "../../packages/plateforme/server/files/memory"
import { completeFileUpload, requestFileUpload } from "../../packages/plateforme/server/files/service"
import { registerSensitiveEntities } from "../../packages/plateforme/server/pseudonym/declaration"
import { forgetDictionaries } from "../../packages/plateforme/server/pseudonym/service"
import { connectDeps } from "../helpers/mcp"
import { hex } from "../helpers/plateforme"
import { privateFolderPending, privateFolderSuite } from "../helpers/pending-migrations"
import { createLocalFixtures, type LocalFixtures } from "../helpers/session-locale"
import { SQL_SKIP_REASON, sqlConfigured, type SqlReferenceOrg } from "../helpers/sql"

const storage = vi.hoisted(() => ({ store: null as MemoryFileStore | null }))

vi.mock("../../packages/plateforme/server/files/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../packages/plateforme/server/files/store")>()),
  fileStore: () => storage.store,
}))

const privatePending = await privateFolderPending()

const NETWORK_TIMEOUT = 60_000
const SETUP_TIMEOUT = 180_000
const SUITE = "file readers on a real database (lot 1: registry, host types, outline and section)"

const bytesOf = (text: string) => new TextEncoder().encode(text)

/**
 * Le lecteur de plans `.dxf` d'un hôte de test : un plan écrit en JSON (`{ "Niveau 1": "texte", … }`), une partie par
 * niveau. Un programme tiers en vrai ; ici, la forme seule compte.
 */
const planReader = defineReader({
  types: [{ extension: "dxf", mime: "image/vnd.dxf" }],
  read: ({ bytes }) => {
    const levels = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, string>
    return {
      title: "Plan de masse",
      summary: `${Object.keys(levels).length} levels.`,
      parts: Object.entries(levels).map(([name, text]) => ({ name, chars: text.length })),
      text: (part) => levels[part] ?? "",
    }
  },
})

describe.skipIf(!sqlConfigured || privatePending)(privateFolderSuite(sqlConfigured ? SUITE : `${SUITE} (${SQL_SKIP_REASON})`, privatePending), { timeout: NETWORK_TIMEOUT }, () => {
  let fx: LocalFixtures
  let o: SqlReferenceOrg
  let memory: MemoryFileStore
  let claire: { db: PlatformDb; identity: Identity }

  beforeAll(async () => {
    fx = createLocalFixtures()
    o = await fx.buildReferenceOrg()
    const user = o.people.claire
    const db = fx.as(user)
    claire = { db, identity: await resolveIdentity(db, o.host, { userId: user.id, email: user.email }) }
    memory = memoryFileStore()
    storage.store = memory
  }, SETUP_TIMEOUT)

  afterEach(() => {
    registerReaders([])
    registerSensitiveEntities(null)
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  afterAll(async () => {
    await fx?.cleanup()
  }, SETUP_TIMEOUT)

  async function session() {
    const mcp = await connectDeps({ db: claire.db, org: claire.identity.org, caller: { kind: "member", identity: claire.identity }, userAgent: `readers-${hex(4)}`, journal: [], activeConnectors: () => Promise.resolve(new Set<string>()), origin: `https://${o.host}` })
    const { code } = await mcp.openContext("Lis le plan")
    return { call: (tool: string, args: Record<string, unknown>) => mcp.call(tool, { ctx: code, ...args }), prefix: mcp.prefix }
  }

  /** Une page créée par `write`, publiée, sous `ventes` (Claire y écrit). */
  async function page(mcp: Awaited<ReturnType<typeof session>>, path: string): Promise<void> {
    const created = await mcp.call("write", { path, title: `Page ${path}`, summary: "Page de test.", ops: [{ op: "add_section", section: "Pièces", text: "Intro." }] })
    expect(created.isError, created.text).toBe(false)
  }

  /** Un fichier déposé comme l'écran le fait : la demande, l'envoi à l'URL signée, la confirmation ; son identifiant. */
  async function deposit(path: string, name: string, text: string): Promise<string> {
    const bytes = bytesOf(text)
    const requested = await requestFileUpload(claire.db, claire.identity, { node: path, name, mime: "", size: bytes.byteLength })
    const sent = await memory.fetch(requested.data.upload.url, { method: "PUT", headers: requested.data.upload.headers, body: bytes })
    expect(sent.status).toBe(200)
    await completeFileUpload(claire.db, claire.identity, requested.data.id)
    return requested.data.id
  }

  it("should deposit the type a host reader inscribes and read it whole, as an outline over 12,000 characters, by part and whole; an uninscribed type refused at deposit", async () => {
    vi.stubGlobal("fetch", memory.fetch)
    const mcp = await session()
    const path = `ventes/l_plan_${hex(3)}`
    await page(mcp, path)
    const refusedBefore = await requestFileUpload(claire.db, claire.identity, { node: path, name: "plan.dxf", mime: "", size: 10 }).catch((error: Error) => error.message)
    registerReaders([planReader])
    const small = await deposit(path, "petit.dxf", JSON.stringify({ RDC: "Mur porteur." }))
    const levels = { RDC: "r".repeat(7_000), "Étage 1": "e".repeat(7_000) }
    const big = await deposit(path, "plan.dxf", JSON.stringify(levels))
    const bigSize = fileSizeText(bytesOf(JSON.stringify(levels)).byteLength)
    // Au-delà de 2 millions de caractères, le texte est coupé : la seconde partie s'arrête à la borne, le plan le dit.
    const giant = await deposit(path, "geant.dxf", JSON.stringify({ A: "a".repeat(1_200_000), B: "b".repeat(1_200_000) }))
    const dwg = await requestFileUpload(claire.db, claire.identity, { node: path, name: "plan.dwg", mime: "", size: 10 }).catch((error: Error) => error.message)
    const [row] = await fx.admin<{ mime: string; status: string }[]>`select mime, status from platform.files where id = ${big}`

    const whole = await mcp.call("read", { path, file: small })
    const outline = await mcp.call("read", { path, file: big })
    const part = await mcp.call("read", { path, file: big, section: "étage 1" })
    const all = await mcp.call("read", { path, file: big, section: "*" })
    const cut = await mcp.call("read", { path, file: giant })

    expect(refusedBefore).toMatch(/^plan\.dxf: this type of file is not admitted\./u)
    expect(dwg).toMatch(/^plan\.dwg: this type of file is not admitted\. Admitted extensions: .*, dxf\.$/u)
    expect(row).toEqual({ mime: "image/vnd.dxf", status: "ready" })
    expect([whole.isError, whole.text]).toEqual([false, "petit.dxf (22 bytes)\n\n```text\nMur porteur.\n```"])
    expect([outline.isError, outline.text]).toEqual([
      false,
      [
        `plan.dxf (${bigSize})`,
        "",
        "« Plan de masse » — 2 levels.",
        "outline (2 parts, 14,000 characters, over the 12,000-character page limit):",
        "- RDC (7,000 characters)",
        "- Étage 1 (7,000 characters)",
        `Read one with ${mcp.prefix}_read {"path": "${path}", "file": "${big}", "section": "<name>"}; the whole text with "section": "*".`,
      ].join("\n"),
    ])
    expect(outline.result.structuredContent).toMatchObject({ file: { id: big, name: "plan.dxf", type: "dxf" }, outline: [{ title: "RDC", chars: 7_000 }, { title: "Étage 1", chars: 7_000 }], sections_total: 2 })
    expect([part.isError, part.text]).toEqual([false, `plan.dxf (${bigSize}) — section « Étage 1 » (7,000 characters)\n\n\`\`\`text\n${levels["Étage 1"]}\n\`\`\``])
    expect([cut.isError, cut.text.split("\n").slice(3)]).toEqual([
      false,
      [
        "outline (2 parts, 2,000,000 characters, over the 12,000-character page limit):",
        "- A (1,200,000 characters)",
        "- B (800,000 characters)",
        `Read one with ${mcp.prefix}_read {"path": "${path}", "file": "${giant}", "section": "<name>"}; the whole text with "section": "*".`,
        "",
        "The text is cut at 2,000,000 characters of 2,400,000: the rest is not served.",
      ],
    ])
    expect(cut.result.structuredContent).toMatchObject({ chars: 2_000_000, chars_declared: 2_400_000 })
    expect([all.isError, all.text]).toEqual([false, `plan.dxf (${bigSize}) — whole text (14,000 characters)\n\n\`\`\`text\n${levels.RDC}\n${levels["Étage 1"]}\n\`\`\``])
  })

  it("should serve a long markdown as the outline of its headings, a section by name and its rest by the cursor, refuse an unknown section with the parts, and serve a small csv as before", async () => {
    vi.stubGlobal("fetch", memory.fetch)
    const mcp = await session()
    const path = `ventes/l_md_${hex(3)}`
    await page(mcp, path)
    const long = Array.from({ length: 1_200 }, (_, index) => `ligne ${String(index).padStart(4, "0")} ${"x".repeat(40)}`).join("\n")
    const notes = await deposit(path, "notes.md", `# Résumé\n\nCourt.\n\n# Journal\n\n${long}\n\n## Fin\n\nVoilà.`)
    const table = await deposit(path, "ventes.csv", "client;montant\nValbrune;1200")
    const report = await deposit(path, "rapport.json", '{"client":"Valbrune","montant":1200}')

    const outline = await mcp.call("read", { path, file: notes })
    const first = await mcp.call("read", { path, file: notes, section: "Journal" })
    const cursor = (first.result.structuredContent as { next_cursor?: string }).next_cursor
    const second = await mcp.call("read", { path, file: notes, section: "Journal", cursor })
    const unknown = await mcp.call("read", { path, file: notes, section: "Annexes" })
    const csv = await mcp.call("read", { path, file: table })
    const json = await mcp.call("read", { path, file: report })

    expect(outline.text).toContain("outline (3 parts, 62,")
    expect(outline.text).toContain("\n- Résumé (17 characters)\n- Journal (")
    expect([first.isError, first.text.startsWith("notes.md ("), first.text.includes("— section « Journal » ("), (first.result.structuredContent as { parts?: number }).parts]).toEqual([false, true, true, 2])
    expect([second.isError, second.text.includes("ligne 1199"), first.text.includes("ligne 1199")]).toEqual([false, true, false])
    expect([unknown.isError, unknown.text]).toEqual([true, `Unknown section « Annexes » in notes.md. Sections: « Résumé », « Journal », « Fin »; or "*" for the whole text.`])
    expect([csv.isError, csv.text]).toEqual([false, "ventes.csv (28 bytes)\n\n```csv\nclient;montant\nValbrune;1200\n```"])
    expect([json.isError, json.text]).toEqual([false, 'rapport.json (36 bytes)\n\n```json\n{"client":"Valbrune","montant":1200}\n```'])
  })

  it("should pseudonymize the outline and a section of a file", async () => {
    vi.stubGlobal("fetch", memory.fetch)
    vi.stubEnv("PLATFORM_PSEUDONYM_KEY", Buffer.alloc(32, 7).toString("base64"))
    const camille = { id: "c-1", values: { firstNames: "Camille", lastName: "Dupré" } }
    registerSensitiveEntities([{ kind: "client", list: async () => [camille], read: async (_org, id) => (id === camille.id ? camille.values : null) }])
    forgetDictionaries()
    const mcp = await session()
    const path = `ventes/l_pseudo_${hex(3)}`
    await page(mcp, path)
    const filler = "Relance du devis. ".repeat(800)
    const notes = await deposit(path, "dossier.md", `# Dossier de Camille Dupré\n\n${filler}\n\n# Notes\n\nAppeler Camille Dupré demain.`)

    const outline = await mcp.call("read", { path, file: notes })
    const section = await mcp.call("read", { path, file: notes, section: "Notes" })

    expect([outline.isError, section.isError]).toEqual([false, false])
    expect(outline.text).toContain("outline (2 parts,")
    expect(section.text).toContain("Appeler ")
    for (const served of [outline.text, JSON.stringify(outline.result.structuredContent), section.text]) expect(served).not.toMatch(/Camille|Dupré/u)
  })
})
