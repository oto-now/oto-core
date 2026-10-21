// @vitest-environment node
// Le lecteur de tableur sur une vraie base, lot 2 des lecteurs de fichiers (`lecture-des-fichiers.md`), par la porte MCP
// (`InMemoryTransport`, `connectDeps`) : un xlsx se dépose sans lecteur d'hôte (type du paquet, son type MIME signé) et
// se lit par le worker, en entier sous 12 000 caractères, en plan au-delà, par feuille (nom sans casse, feuille cachée)
// et en tout ; une bombe ZIP déposée est refusée `too_large` ; la pseudonymisation passe sur une feuille ; l'hôte qui
// retient le contenu des fichiers (`metadata`) fait refuser la lecture. Le bucket est l'adaptateur en mémoire, à la
// place de `fileStore()` et de `fetch`. Suite portable.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { resolveIdentity, type Identity, type PlatformDb } from "@otomata_tech/oto_platform/server"
import { fileSizeText } from "../../packages/plateforme/schemas/files"
import { registerDataPolicy } from "../../packages/plateforme/server/data-policy"
import { memoryFileStore, type MemoryFileStore } from "../../packages/plateforme/server/files/memory"
import { completeFileUpload, requestFileUpload } from "../../packages/plateforme/server/files/service"
import { registerSensitiveEntities } from "../../packages/plateforme/server/pseudonym/declaration"
import { forgetDictionaries } from "../../packages/plateforme/server/pseudonym/service"
import { connectDeps } from "../helpers/mcp"
import { hex } from "../helpers/plateforme"
import { privateFolderPending, privateFolderSuite } from "../helpers/pending-migrations"
import { createLocalFixtures, type LocalFixtures } from "../helpers/session-locale"
import { SQL_SKIP_REASON, sqlConfigured, type SqlReferenceOrg } from "../helpers/sql"
import { BUDGET, BUDGET_TEXTS, deflatedRun, rawWorkbookEntries, rawZip, xlsxBytes } from "../helpers/xlsx"

const storage = vi.hoisted(() => ({ store: null as MemoryFileStore | null }))

vi.mock("../../packages/plateforme/server/files/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../packages/plateforme/server/files/store")>()),
  fileStore: () => storage.store,
}))

const privatePending = await privateFolderPending()

const NETWORK_TIMEOUT = 60_000
const SETUP_TIMEOUT = 180_000
const SUITE = "the xlsx reader on a real database (lot 2: spreadsheet in a worker)"

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

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
    registerDataPolicy(null)
    registerSensitiveEntities(null)
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  afterAll(async () => {
    await fx?.cleanup()
  }, SETUP_TIMEOUT)

  async function session() {
    const mcp = await connectDeps({ db: claire.db, org: claire.identity.org, caller: { kind: "member", identity: claire.identity }, userAgent: `tableur-${hex(4)}`, journal: [], activeConnectors: () => Promise.resolve(new Set<string>()), origin: `https://${o.host}` })
    const { code } = await mcp.openContext("Lis le tableur")
    return { call: (tool: string, args: Record<string, unknown>) => mcp.call(tool, { ctx: code, ...args }), prefix: mcp.prefix }
  }

  /** Une page créée par `write`, sous `ventes` (Claire y écrit). */
  async function page(mcp: Awaited<ReturnType<typeof session>>, path: string): Promise<void> {
    const created = await mcp.call("write", { path, title: `Page ${path}`, summary: "Page de test.", ops: [{ op: "add_section", section: "Pièces", text: "Intro." }] })
    expect(created.isError, created.text).toBe(false)
  }

  /** Un fichier déposé comme l'écran le fait : la demande, l'envoi à l'URL signée, la confirmation ; son identifiant. */
  async function deposit(path: string, name: string, bytes: Uint8Array): Promise<string> {
    const requested = await requestFileUpload(claire.db, claire.identity, { node: path, name, mime: "", size: bytes.byteLength })
    const sent = await memory.fetch(requested.data.upload.url, { method: "PUT", headers: requested.data.upload.headers, body: bytes })
    expect(sent.status).toBe(200)
    await completeFileUpload(claire.db, claire.identity, requested.data.id)
    return requested.data.id
  }

  it("should deposit an xlsx without any host reader and read it whole, by sheet (a hidden one, any case) and whole with *", async () => {
    vi.stubGlobal("fetch", memory.fetch)
    const mcp = await session()
    const path = `ventes/l_xlsx_${hex(3)}`
    await page(mcp, path)
    const bytes = xlsxBytes(BUDGET)
    const id = await deposit(path, "budget.xlsx", bytes)
    const size = fileSizeText(bytes.byteLength)
    const [row] = await fx.admin<{ mime: string; status: string }[]>`select mime, status from platform.files where id = ${id}`

    const whole = await mcp.call("read", { path, file: id })
    const hidden = await mcp.call("read", { path, file: id, section: "PARAMÈTRES (HIDDEN)" })
    const all = await mcp.call("read", { path, file: id, section: "*" })

    const sheets = [BUDGET_TEXTS.SYNTHESE, BUDGET_TEXTS.DETAIL, BUDGET_TEXTS.PARAMETRES, BUDGET_TEXTS.VIDE]
    const texts = sheets.join("\n")
    // La taille dite est celle du plan, la somme des parties, sans les sauts de ligne qui les joignent.
    const chars = sheets.reduce((sum, text) => sum + text.length, 0)
    expect(row).toEqual({ mime: XLSX_MIME, status: "ready" })
    expect([whole.isError, whole.text]).toEqual([false, `budget.xlsx (${size})\n\n\`\`\`text\n${texts}\n\`\`\``])
    expect(whole.result.structuredContent).toMatchObject({ file: { id, name: "budget.xlsx", type: "xlsx" } })
    expect([hidden.isError, hidden.text]).toEqual([false, `budget.xlsx (${size}) — section « Paramètres (hidden) » (${BUDGET_TEXTS.PARAMETRES.length} characters)\n\n\`\`\`text\n${BUDGET_TEXTS.PARAMETRES}\n\`\`\``])
    expect([all.isError, all.text]).toEqual([false, `budget.xlsx (${size}) — whole text (${chars} characters)\n\n\`\`\`text\n${texts}\n\`\`\``])
  })

  it("should serve a large workbook as the outline of its sheets, and refuse a zip bomb as too_large", async () => {
    vi.stubGlobal("fetch", memory.fetch)
    const mcp = await session()
    const path = `ventes/l_xlsx_plan_${hex(3)}`
    await page(mcp, path)
    const rows = Array.from({ length: 1_500 }, (_, index) => `<row r="${index + 1}"><c r="A${index + 1}"><v>${index}</v></c><c r="B${index + 1}" t="inlineStr"><is><t>ligne ${index}</t></is></c></row>`).join("")
    const big = await deposit(path, "ventes.xlsx", xlsxBytes({ title: "Ventes", sheets: [{ name: "Lignes", data: rows }, { name: "Notes", state: "hidden", data: '<row r="1"><c r="A1" t="inlineStr"><is><t>RAS</t></is></c></row>' }] }))
    const head = "<sst><si><t>"
    const entries = rawWorkbookEntries({ sheets: [{ name: "Feuil1", data: '<row r="1"><c r="A1" t="s"><v>0</v></c></row>' }] }).map((entry) =>
      entry.name === "xl/sharedStrings.xml" ? { name: entry.name, data: deflatedRun(80 * 1_048_576, 0x61, head, "</t></si></sst>"), method: 8 as const, declaredSize: 120 } : entry,
    )
    const bomb = await deposit(path, "bombe.xlsx", rawZip(entries))

    const outline = await mcp.call("read", { path, file: big })
    const refused = await mcp.call("read", { path, file: bomb })

    expect(outline.isError).toBe(false)
    expect(outline.text.split("\n").slice(2)).toEqual([
      "« Ventes » — 2 sheets: Lignes (1,500 × 2), Notes (hidden, 1 × 1)",
      expect.stringMatching(/^outline \(2 parts, [\d,]+ characters, over the 12,000-character page limit\):$/u),
      expect.stringMatching(/^- Lignes \([\d,]+ characters\)$/u),
      "- Notes (hidden) (21 characters)",
      `Read one with ${mcp.prefix}_read {"path": "${path}", "file": "${big}", "section": "<name>"}; the whole text with "section": "*".`,
    ])
    expect([refused.isError, refused.text]).toEqual([true, "bombe.xlsx cannot be read: it unzips to more than 64 MB (too_large)."])
  })

  it("should pseudonymize a sheet, and refuse to read a workbook when the host withholds file contents", async () => {
    vi.stubGlobal("fetch", memory.fetch)
    vi.stubEnv("PLATFORM_PSEUDONYM_KEY", Buffer.alloc(32, 7).toString("base64"))
    const camille = { id: "c-1", values: { firstNames: "Camille", lastName: "Dupré" } }
    registerSensitiveEntities([{ kind: "client", list: async () => [camille], read: async (_org, id) => (id === camille.id ? camille.values : null) }])
    forgetDictionaries()
    const mcp = await session()
    const path = `ventes/l_xlsx_pseudo_${hex(3)}`
    await page(mcp, path)
    const id = await deposit(path, "clients.xlsx", xlsxBytes({ strings: ["Camille Dupré", "Relance"], sheets: [{ name: "Clients", data: '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' }] }))

    const section = await mcp.call("read", { path, file: id, section: "Clients" })
    registerDataPolicy({ fileContents: "metadata" })
    const withheld = await mcp.call("read", { path, file: id })

    expect([section.isError, section.text.includes(",Relance")]).toEqual([false, true])
    expect(section.text).not.toMatch(/Camille|Dupré/u)
    expect([withheld.isError, withheld.text]).toEqual([true, `The contents of files are not served to assistants at ${claire.identity.org.name}: only their name, size and type, shown in ${path}. Ask the user to open the file.`])
  })
})
