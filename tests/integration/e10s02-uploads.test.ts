// @vitest-environment node
// Le dépôt par lien à usage unique sur une vraie base (E10-S02 lot f : AC-f1 à AC-f12, AC-f14, AC-f15 ; ADR-018) :
// `upload.link` par la porte MCP (`InMemoryTransport`, `connectDeps`), ses refus immédiats et le ticket qu'il crée ;
// l'envoi par la porte sans session (`handlePlateforme`, sans jeton de session), qui consomme le ticket une fois, relit
// l'identité et les droits, contrôle et écrit un fichier, un `.md` ou un CSV ; la même `not_found` pour tout ticket qui
// ne sert plus ; les droits retirés depuis le lien, refusés sans écriture (espion sur `writeUpload`) ; le journal ; le
// téléchargement d'une adresse fournie (remplacé : aucun réseau) ; le formulaire de dépôt et son jeton, que la porte sans
// session refuse (HN-E10S02-108) ; le `.html` envoyé, servi par la route isolée aux en-têtes d'ADR-017. Le bucket est
// l'adaptateur en mémoire, à la place de `fileStore()` et de `fetch`. La base est le sujet (ticket, consommation atomique,
// RLS). Suite portable.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { handlePlateforme } from "@otomata_tech/oto_platform/api"
import { resolveIdentity, type Identity, type PlatformDb } from "@otomata_tech/oto_platform/server"
import { UPLOAD_RULE } from "../../packages/plateforme/schemas"
import { HTML_CONTENT_SECURITY_POLICY } from "../../packages/plateforme/server/files/html"
import { memoryFileStore, type MemoryFileStore } from "../../packages/plateforme/server/files/memory"
import { objectKey } from "../../packages/plateforme/server/files/store"
import type { JournalEntry } from "../../packages/plateforme/server/journal"
import { withAnonSession } from "../../packages/plateforme/server/sql"
import { receiveFormUpload, uploadForm, uploadTokenHash } from "../../packages/plateforme/server/uploads"
import { SOURCE_FAILURES } from "../../packages/plateforme/server/uploads-fetch"
import { writeUpload, type UploadTicket } from "../../packages/plateforme/server/uploads-write"
import { loggedText } from "../helpers/logs"
import { connectDeps } from "../helpers/mcp"
import { hex } from "../helpers/plateforme"
import { privateFolderPending, privateFolderSuite } from "../helpers/pending-migrations"
import { createLocalFixtures, type LocalFixtures } from "../helpers/session-locale"
import { spyDb, SQL_SKIP_REASON, sqlConfigured, writesOf, type SqlReferenceOrg } from "../helpers/sql"

// Le bucket du test : `null` joue un hôte sans les cinq variables (AC-a1).
const storage = vi.hoisted(() => ({ store: null as MemoryFileStore | null }))

vi.mock("../../packages/plateforme/server/files/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../packages/plateforme/server/files/store")>()),
  fileStore: () => storage.store,
}))

// Le téléchargement d'une adresse fournie, sans réseau : ce que le test lui fait rendre (AC-f12, AC-f14).
const source = vi.hoisted(() => ({ fetched: { failure: "source_url could not be reached" } as { bytes: Uint8Array; type: string | null } | { failure: string } }))

vi.mock("../../packages/plateforme/server/uploads-fetch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../packages/plateforme/server/uploads-fetch")>()),
  fetchSource: async () => source.fetched,
}))

// Ces tests supposent le dossier `private` en base (fiche D107), comme l'organisation de référence.
const privatePending = await privateFolderPending()

const NETWORK_TIMEOUT = 60_000
const SETUP_TIMEOUT = 180_000
const SUITE = "upload by a one-time link (E10-S02, lot f)"

type Person = "claire" | "lea" | "paul"
type Session = { db: PlatformDb; identity: Identity }

const bytesOf = (text: string) => new TextEncoder().encode(text)

const UNKNOWN_LINK = "not_found: Unknown upload link: it may have expired (15 minutes) or already been used. Ask for a new link.\n"

describe.skipIf(!sqlConfigured || privatePending)(privateFolderSuite(sqlConfigured ? SUITE : `${SUITE} (${SQL_SKIP_REASON})`, privatePending), { timeout: NETWORK_TIMEOUT }, () => {
  let fx: LocalFixtures
  let o: SqlReferenceOrg
  let memory: MemoryFileStore
  const sessions = new Map<Person, Session>()

  beforeAll(async () => {
    fx = createLocalFixtures()
    o = await fx.buildReferenceOrg()
    for (const person of ["claire", "lea", "paul"] as const) {
      const user = o.people[person]
      const db = fx.as(user)
      sessions.set(person, { db, identity: await resolveIdentity(db, o.host, { userId: user.id, email: user.email }) })
    }
    memory = memoryFileStore()
  }, SETUP_TIMEOUT)

  beforeEach(() => {
    storage.store = memory
    // L'envoi par le serveur au stockage passe par `fetch` (`storeFile`) : le bucket en mémoire le sert.
    vi.stubGlobal("fetch", memory.fetch)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  afterAll(async () => {
    await fx?.cleanup()
  }, SETUP_TIMEOUT)

  const as = (person: Person): Session => {
    const found = sessions.get(person)
    if (!found) throw new Error(`no session for ${person}`)
    return found
  }

  /** Une conversation MCP de `session`, sur l'adresse de l'organisation, son `ctx` et son journal empilé. */
  async function conversation({ db, identity }: Session) {
    const journal: JournalEntry[] = []
    const mcp = await connectDeps({ db, org: identity.org, caller: { kind: "member", identity }, userAgent: `uploads-${hex(4)}`, journal, activeConnectors: () => Promise.resolve(new Set<string>()), origin: `https://${o.host}` })
    const { code } = await mcp.openContext("Range le rapport")
    return {
      code,
      journal,
      link: (args: Record<string, unknown>) => mcp.call("call", { ctx: code, function: "upload.link", arguments: args }),
      write: (args: Record<string, unknown>) => mcp.call("write", { ctx: code, ...args }),
      tool: (name: string, args: Record<string, unknown>) => mcp.call(name, { ctx: code, ...args }),
    }
  }

  /** Le jeton d'un lien, lu dans l'adresse rendue. */
  function tokenOf(text: string): string {
    const token = /\/api\/platform\/uploads\/([A-Za-z0-9_-]{43})/.exec(text)?.[1]
    if (!token) throw new Error(`no upload link in: ${text.slice(0, 300)}`)
    return token
  }

  /** Le jeton du formulaire, lu dans `form_url` (`/upload/<jeton>`). */
  function formTokenOf(text: string): string {
    const token = /\/upload\/([A-Za-z0-9_-]{43})/.exec(text)?.[1]
    if (!token) throw new Error(`no form link in: ${text.slice(0, 300)}`)
    return token
  }

  /** L'envoi de `curl` : la porte sans session, sans jeton de session ; `query` : ce qu'ajouterait un tiers à l'adresse. */
  async function send(token: string, body: string | Uint8Array, options: { host?: string; query?: string } = {}) {
    const host = options.host ?? o.host
    const request = new Request(`https://${host}/api/platform/uploads/${token}${options.query ?? ""}`, {
      method: "POST",
      body,
      headers: { "user-agent": "curl/8.7.1", "content-type": "application/x-www-form-urlencoded" },
    })
    const response = await handlePlateforme(request, { accessToken: null, host })
    return { status: response.status, text: await response.text(), type: response.headers.get("content-type"), cache: response.headers.get("cache-control"), robots: response.headers.get("x-robots-tag") }
  }

  /** Les blocs publiés ou brouillon d'un nœud, dans l'ordre. */
  const blocksOf = (path: string, state: "draft" | "published") =>
    fx.admin<{ type: string; text: string | null; data: Record<string, unknown>; provenance: Record<string, unknown> }[]>`
      select b.type, b.text, b.data, b.provenance from platform.blocks b join platform.nodes n on n.id = b.node_id
       where n.org_id = ${o.org.id} and n.path = ${path} and b.state = ${state} order by b.position, b.id`

  const nodeOf = async (path: string) => {
    const [row] = await fx.admin<{ id: string; kind: string; revision: number; status: string }[]>`
      select id, kind, revision, status from platform.nodes where org_id = ${o.org.id} and path = ${path}`
    return row ?? null
  }

  const ticketsOf = (userId: string) => fx.admin<{ n: number }[]>`select count(*)::int as n from platform.upload_tickets where org_id = ${o.org.id} and user_id = ${userId}`

  describe("upload.link (AC-f1 to AC-f3)", () => {
    it("should refuse at once, before any ticket: path taken, parent missing, write level, kind, revision, storage and type", async () => {
      const claire = await conversation(as("claire"))
      const page = `ventes/f_refus_${hex(3)}`
      expect((await claire.write({ path: page, title: "Page", summary: "Une page.", ops: [{ op: "add_section", section: "A", text: "Texte." }] })).isError).toBe(false)
      const reads = await fx.addRule({ orgId: o.org.id, nodeId: o.nodes.ventes, userId: o.people.paul.id, level: "read" })
      const before = await ticketsOf(o.people.claire.id)
      try {
        const paul = await conversation(as("paul"))
        storage.store = null
        const disabled = await claire.link({ path: `${page}_x`, kind: "file", mode: "create", name: "r.pdf", title: "R", summary: "Le rapport." })
        storage.store = memory
        const outcomes = {
          taken: await claire.link({ path: page, kind: "md", mode: "create", title: "R", summary: "Le rapport." }),
          noParent: await claire.link({ path: "ventes/nulle_part/r", kind: "md", mode: "create", title: "R", summary: "Le rapport." }),
          readOnly: await paul.link({ path: `ventes/f_paul_${hex(3)}`, kind: "md", mode: "create", title: "R", summary: "Le rapport." }),
          stale: await claire.link({ path: page, kind: "md", mode: "replace", base_revision: 0 }),
          csvOnPage: await claire.link({ path: page, kind: "csv", mode: "merge", base_revision: 1 }),
          type: await claire.link({ path: `${page}_y`, kind: "file", mode: "create", name: "setup.exe", title: "R", summary: "Le rapport." }),
        }
        expect({ disabled: disabled.isError, starts: disabled.text.startsWith("Files are not enabled on this platform") }).toEqual({ disabled: true, starts: true })
        expect(Object.fromEntries(Object.entries(outcomes).map(([key, outcome]) => [key, { isError: outcome.isError, text: outcome.text.split("\n")[0] }]))).toEqual({
          taken: { isError: true, text: `Path ${page} is not available: a content holds it (perhaps one you cannot see), a moved content had it, or the name is reserved. Choose another path.` },
          noParent: { isError: true, text: "Cannot create ventes/nulle_part/r: its parent ventes/nulle_part does not exist." },
          readOnly: { isError: true, text: expect.stringMatching(/^Writing under ventes is reserved to /) },
          stale: { isError: true, text: `stale revision: ${page} is at revision 1, not 0. Nothing was written. Read it again, then ask for a new link with base_revision 1.` },
          csvOnPage: { isError: true, text: `${page} is a page: a CSV is imported into a table.` },
          type: { isError: true, text: expect.stringMatching(/^setup\.exe: this type of file is not admitted\. Admitted extensions: png, /) },
        })
        expect(await ticketsOf(o.people.claire.id)).toEqual(before)
        // FB-0014 : le chemin pris est `conflict`, le code du contrat ; la porte MCP n'en sert que le message, le journal le code.
        expect(claire.journal.find((line) => line.error?.includes(`Path ${page} is not available`))?.error).toBe(`conflict: Path ${page} is not available: a content holds it (perhaps one you cannot see), a moved content had it, or the name is reserved. Choose another path.`)
      } finally {
        await fx.admin`delete from platform.access_rules where id = ${reads}`
      }
    })

    it("should give the address, the expiry, both commands, the limit and the note, the same in the text and in the fields, and keep only the hash", async () => {
      const lea = await conversation(as("lea"))
      const path = `ventes/f_lien_${hex(3)}`
      const linked = await lea.link({ path, kind: "file", mode: "create", name: "rapport d'avril.html", title: "Rapport d'avril", summary: "Le rapport d'avril." })
      const token = tokenOf(linked.text)
      const formToken = formTokenOf(linked.text)
      const url = `https://${o.host}/api/platform/uploads/${token}`
      const form = `https://${o.host}/upload/${formToken}`
      const fields = (linked.result.structuredContent as { result: Record<string, unknown> }).result
      const [row] = await fx.admin<{ row: Record<string, unknown> }[]>`select to_json(t) as row from platform.upload_tickets t where token_hash = ${uploadTokenHash(token)}`
      const expires = String(fields.expires_at)
      // B7 : un autre membre ne lit pas le ticket encore valable de Léa (destination prévue, titre), Léa si.
      const readBy = (person: Person) => as(person).db.tx((sql) => sql<{ n: number }[]>`select count(*)::int as n from platform.upload_tickets where token_hash = ${uploadTokenHash(token)}`)

      expect(linked.isError, linked.text).toBe(false)
      expect(linked.text.split("\n")).toEqual([
        `Upload link for ${path} (file, create): ${url}`,
        `Expires at ${expires}: the link works once, for 15 minutes; the file never goes through this conversation.`,
        `bash: curl -sS --fail-with-body --data-binary @'rapport d'\\''avril.html' '${url}'`,
        `PowerShell: curl.exe -sS --fail-with-body --data-binary "@rapport d'avril.html" "${url}"`,
        "Limit: 1 MB (1,048,576 bytes); its type comes from the extension of rapport d'avril.html.",
        `Without a shell, or if curl cannot reach this address (a proxy answers 403): give the person this form link to drop the file: ${form}`,
      ])
      expect(fields).toEqual({
        path,
        kind: "file",
        mode: "create",
        url,
        expires_at: expires,
        commands: {
          bash: `curl -sS --fail-with-body --data-binary @'rapport d'\\''avril.html' '${url}'`,
          powershell: `curl.exe -sS --fail-with-body --data-binary "@rapport d'avril.html" "${url}"`,
        },
        limit: "1 MB (1,048,576 bytes); its type comes from the extension of rapport d'avril.html.",
        note: "the link works once, for 15 minutes; the file never goes through this conversation",
        form_url: form,
      })
      // Quinze minutes, une empreinte et jamais le jeton, la destination et le `ctx` de l'appel (AC-f3).
      expect(Date.parse(expires) - Date.now()).toBeGreaterThan(14 * 60_000)
      expect(Date.parse(expires) - Date.now()).toBeLessThanOrEqual(15 * 60_000)
      expect(JSON.stringify(row.row)).not.toContain(token)
      expect(JSON.stringify(row.row)).not.toContain(formToken)
      expect(formToken).not.toBe(token)
      expect(row.row).toMatchObject({ user_id: o.people.lea.id, ctx: lea.code, kind: "file", mode: "create", target_path: path, name: "rapport d'avril.html", used_at: null, form_token_hash: uploadTokenHash(formToken) })
      expect({ lea: await readBy("lea"), claire: await readBy("claire") }).toEqual({ lea: [{ n: 1 }], claire: [{ n: 0 }] })
    })

    it("should be found by find, serve its contract with the rule by read, and be refused in a call block of a procedure", async () => {
      const lea = await conversation(as("lea"))
      const found = await lea.tool("find", { query: "upload a file link", type: "function" })
      const contract = await lea.tool("read", { path: "upload.link" })
      const fence = '```call\nupload.link {"path": "ventes/x", "kind": "md", "mode": "create", "title": "T", "summary": "S."}\n```'
      const procedure = await lea.write({ path: `ventes/f_procedure_${hex(3)}`, kind: "procedure", title: "Déposer", summary: "Dépose un fichier.", ops: [{ op: "add_section", section: "Étapes", text: fence }] })

      expect(found.text).toContain("upload.link")
      expect(contract.text).toContain(`Rule: ${UPLOAD_RULE}.`)
      expect(procedure.text).toContain("upload.link is called by an assistant, not by a procedure")
    })

    it("should delete the tickets of the organisation expired for more than 24 hours, and keep the others", async () => {
      const insert = (hours: number) => fx.admin<{ id: string }[]>`
        insert into platform.upload_tickets (org_id, user_id, token_hash, form_token_hash, kind, mode, target_path, expires_at)
        values (${o.org.id}, ${o.people.claire.id}, ${uploadTokenHash(`old-${hex(8)}`)}, ${uploadTokenHash(`form-${hex(8)}`)}, 'md', 'create', 'ventes/x', now() - make_interval(hours => ${hours}))
        returning id`
      const [[old], [recent]] = await Promise.all([insert(25), insert(1)])
      const lea = await conversation(as("lea"))
      expect((await lea.link({ path: `ventes/f_menage_${hex(3)}`, kind: "md", mode: "create", title: "M", summary: "Ménage." })).isError).toBe(false)
      const left = await fx.admin<{ id: string }[]>`select id from platform.upload_tickets where id in (${old.id}, ${recent.id})`
      expect(left.map((row) => row.id)).toEqual([recent.id])
    })
  })

  describe("sending (AC-f4 to AC-f9, AC-f11)", () => {
    it("should create a page holding the file, stored and published, answer in plain text, ignore another path, journal it under the ctx without the token, and serve the HTML by the isolated route only", async () => {
      const lea = await conversation(as("lea"))
      const path = `ventes/f_fichier_${hex(3)}`
      const token = tokenOf((await lea.link({ path, kind: "file", mode: "create", name: "rapport.html", title: "Rapport", summary: "Le rapport de mars." })).text)
      const html = bytesOf("<h1>Rapport</h1><script>alert(1)</script>")

      const sent = await send(token, html, { query: "?path=ventes/ailleurs" })
      const blocks = await blocksOf(path, "published")
      const [file] = await fx.admin<{ id: string; status: string; size: number; mime: string }[]>`
        select f.id, f.status, f.size::int as size, f.mime from platform.files f join platform.nodes n on n.id = f.node_id
         where n.org_id = ${o.org.id} and n.path = ${path}`
      const [line] = await fx.admin<JournalEntry[]>`
        select tool, method, target, args, is_error, ctx, user_id from platform.journal where org_id = ${o.org.id} and tool = 'uploads' and target = ${path}`
      const node = await nodeOf(path)

      expect({ status: sent.status, type: sent.type, cache: sent.cache, robots: sent.robots }).toEqual({
        status: 200,
        type: "text/plain; charset=utf-8",
        cache: "private, no-store",
        robots: "noindex, nofollow",
      })
      expect(sent.text).toBe(
        [`Uploaded to ${path}: revision 1, published.`, `Page: https://${o.host}/n/${path}`, `File rapport.html (${html.byteLength} bytes) attached at the end of the page.`, ""].join("\n"),
      )
      expect(await nodeOf("ventes/ailleurs")).toBeNull()
      expect({ node: { kind: node?.kind, status: node?.status }, file: { status: file.status, size: file.size, mime: file.mime } }).toEqual({
        node: { kind: "page", status: "published" },
        file: { status: "ready", size: html.byteLength, mime: "text/html" },
      })
      expect(blocks).toEqual([{ type: "file", text: null, data: { file_id: file.id, name: "rapport.html", size: html.byteLength, mime: "text/html" }, provenance: expect.objectContaining({ origin: "agent", ctx: lea.code, by: o.people.lea.id }) }])
      expect(memory.objects.get(objectKey(o.org.id, file.id))?.bytes).toEqual(html)
      // Le journal : la ligne de l'appel (porte MCP) et celle de l'envoi, sous le même `ctx`, sans le jeton (AC-f9).
      const callLine = lea.journal.find((entry) => entry.target === "upload.link")
      expect({ call: callLine?.ctx, upload: line }).toEqual({
        call: lea.code,
        upload: { tool: "uploads", method: "api", target: path, args: { kind: "file", mode: "create", bytes: html.byteLength }, is_error: false, ctx: lea.code, user_id: o.people.lea.id },
      })
      expect(JSON.stringify([...lea.journal, line])).not.toContain(token)
      // AC-f11, HTML servi : le `.html` envoyé se lit par la route isolée d'AC-c3, aux en-têtes d'ADR-017 § 1, dans un iframe.
      const viewed = await handlePlateforme(new Request(`https://${o.host}/api/platform/files/${file.id}/html`, { headers: { "sec-fetch-dest": "iframe" } }), {
        accessToken: (await fx.sessionFor(o.people.lea)).accessToken,
        host: o.host,
        verifyToken: fx.verifyToken,
      })
      expect({ status: viewed.status, headers: Object.fromEntries(viewed.headers), body: await viewed.text() }).toEqual({
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "content-security-policy": HTML_CONTENT_SECURITY_POLICY,
          "x-content-type-options": "nosniff",
          "referrer-policy": "no-referrer",
          "cache-control": "private, no-store",
        },
        body: "<h1>Rapport</h1><script>alert(1)</script>",
      })
    })

    it("should attach a file at the end of a page, as a draft with publish false", async () => {
      const claire = await conversation(as("claire"))
      const path = `ventes/f_ajout_${hex(3)}`
      expect((await claire.write({ path, title: "Ajout", summary: "Une page.", ops: [{ op: "add_section", section: "Pièces", text: "Voici le rapport." }] })).isError).toBe(false)
      const token = tokenOf((await claire.link({ path, kind: "file", mode: "attach", name: "export.csv", base_revision: 1, publish: false })).text)

      const sent = await send(token, "Nom;Ville\nA;B\n")

      expect(sent.text.split("\n")[0]).toBe(`Uploaded to ${path}: revision 1, unpublished draft.`)
      expect((await blocksOf(path, "draft")).map((block) => block.type)).toEqual(["heading", "paragraph", "file"])
      expect((await blocksOf(path, "published")).map((block) => block.type)).toEqual(["heading", "paragraph"])
    })

    it("should create a page from a markdown file, BOM and CRLF read, tolerant mode counted, then replace its whole content", async () => {
      const lea = await conversation(as("lea"))
      const path = `ventes/f_md_${hex(3)}`
      const created = tokenOf((await lea.link({ path, kind: "md", mode: "create", title: "Compte rendu", summary: "Le compte rendu du client." })).text)
      // Une clôture `call` mal formée : gardée en texte par le mode tolérant (E10-S01, AC-a2), jamais refusée.
      const markdown = "\uFEFF# Compte rendu\r\n\r\n## Décisions\r\n\r\nOn signe.\r\n\r\n```call\r\nx {\r\n```\r\n"

      const first = await send(created, bytesOf(markdown))
      const node = await nodeOf(path)
      const replaced = tokenOf((await lea.link({ path, kind: "md", mode: "replace", base_revision: node?.revision ?? -1 })).text)
      const second = await send(replaced, bytesOf("## Nouveau\n\nTout le reste part.\n"))

      expect(first.text.split("\n")).toContain("1 element kept as text.")
      expect(first.status).toBe(200)
      expect((await blocksOf(path, "published")).map((block) => [block.type, block.text])).toEqual([
        ["heading", "Nouveau"],
        ["paragraph", "Tout le reste part."],
      ])
      expect(second.text.split("\n")[0]).toBe(`Uploaded to ${path}: revision 2, published.`)
    })

    it("should create a table from a CSV with the provenance import, then merge rows on its key", async () => {
      const lea = await conversation(as("lea"))
      const path = `ventes/f_clients_${hex(3)}`
      const created = tokenOf((await lea.link({ path, kind: "csv", mode: "create", title: "Clients", summary: "Les clients exportés.", name: "clients.csv" })).text)
      const first = await send(created, "\uFEFFNom;Ville\r\nAtelier 2;Valbrune\r\nBoulangerie;Brémontier\r\n")
      const table = await nodeOf(path)
      const merged = tokenOf((await lea.link({ path, kind: "csv", mode: "merge", base_revision: table?.revision ?? -1, key: "Nom" })).text)
      const second = await send(merged, "Nom;Ville\nAtelier 2;Brémontier\nCordonnerie;Valbrune\n")
      const rows = await fx.admin<{ key: string; data: Record<string, unknown>; provenance: Record<string, Record<string, unknown>> }[]>`
        select key, data, provenance from platform.blocks where node_id = ${table?.id ?? null} and type = 'row' order by key`

      expect({ first: first.text.split("\n").at(-2), second: second.text.split("\n").at(-2), kind: table?.kind }).toEqual({
        first: "2 row(s) created, 0 updated, 0 unchanged.",
        second: "1 row(s) created, 1 updated, 0 unchanged.",
        kind: "table",
      })
      expect(rows.map((row) => [row.key, row.data.ville])).toEqual([
        ["Atelier 2", "Brémontier"],
        ["Boulangerie", "Brémontier"],
        ["Cordonnerie", "Valbrune"],
      ])
      expect(rows[0].provenance.ville).toMatchObject({ origin: "import", comment: "Importé de upload.link" })
    })

    it("should answer the same not_found to a ticket served, expired, unknown or sent to another organisation, and serve a ticket whose write failed", async () => {
      const lea = await conversation(as("lea"))
      const link = async () => tokenOf((await lea.link({ path: `ventes/f_nf_${hex(3)}`, kind: "csv", mode: "create", title: "T", summary: "Un tableau." })).text)
      const [served, expired, elsewhere, failing] = [await link(), await link(), await link(), await link()]
      await send(served, "Nom\nA\n")
      await fx.admin`update platform.upload_tickets set expires_at = now() - interval '1 second' where token_hash = ${uploadTokenHash(expired)}`
      const other = await fx.createOrg({ hosts: [`t${hex(4)}.example.invalid`] })
      const [otherHost] = await fx.admin<{ host: string }[]>`select host from platform.org_domains where org_id = ${other.id}`

      const refusals = [
        await send(served, "Nom\nB\n"),
        await send(expired, "Nom\nB\n"),
        await send("A".repeat(43), "Nom\nB\n"),
        await send(elsewhere, "Nom\nB\n", { host: otherHost.host }),
      ]
      const invalid = await send(failing, "Nom;Ville\nA;B;C\n")
      const again = await send(failing, "Nom\nA\n")

      expect(refusals.map((refusal) => [refusal.status, refusal.text])).toEqual(Array.from({ length: 4 }, () => [404, UNKNOWN_LINK]))
      expect({ invalid: invalid.status, again: [again.status, again.text] }).toEqual({ invalid: 400, again: [404, UNKNOWN_LINK] })
      // FB-0014 : l'envoi refusé après la consommation compte comme une erreur de la conversation du lien ; les refus avant elle ne s'écrivent pas (AC-f9).
      expect(await fx.admin`select is_error, error, ctx from platform.journal where org_id = ${o.org.id} and tool = 'uploads' and ctx = ${lea.code} and is_error`).toEqual([
        { is_error: true, error: expect.stringMatching(/^invalid_arguments: /), ctx: lea.code },
      ])
      // Le ticket envoyé à l'adresse de B reste servi pour A : aucune autre organisation ne le consomme.
      expect((await send(elsewhere, "Nom\nA\n")).status).toBe(200)
    })

    it("should serve a ticket once to two consumptions that cross, the second waiting for the first", async () => {
      const lea = await conversation(as("lea"))
      const hash = uploadTokenHash(tokenOf((await lea.link({ path: `ventes/f_course_${hex(3)}`, kind: "md", mode: "create", title: "C", summary: "Course." })).text))
      const consume = (sql: Parameters<Parameters<typeof withAnonSession>[0]>[0]) => sql<{ ticket: unknown }[]>`select platform.consume_upload_ticket(${o.org.id}, ${hash}, false) as ticket`
      const crossed = await fx.admin.begin(async (tx) => {
        await tx`set local role anon`
        const [first] = await tx<{ ticket: unknown }[]>`select platform.consume_upload_ticket(${o.org.id}, ${hash}, false) as ticket`
        const second = withAnonSession(consume)
        // La seconde consommation attend le verrou de la ligne que tient la première, encore ouverte.
        const deadline = Date.now() + 10_000
        for (;;) {
          const [{ waiting }] = await fx.admin<{ waiting: boolean }[]>`
            select exists (select 1 from pg_catalog.pg_stat_activity where wait_event_type = 'Lock' and query like '%consume_upload_ticket%') as waiting`
          if (waiting || Date.now() > deadline) break
          await new Promise((resolve) => setTimeout(resolve, 20))
        }
        return { first: first.ticket !== null, second }
      })
      const [late] = await crossed.second
      expect({ first: crossed.first, second: late.ticket }).toEqual({ first: true, second: null })
    })

    it("should refuse an empty body, a markdown file that is not UTF-8, a page beyond 300,000 characters and a CSV beyond 5,000 lines, not a section beyond 100,000", async () => {
      const lea = await conversation(as("lea"))
      const link = async (args: Record<string, unknown>) => tokenOf((await lea.link({ path: `ventes/f_borne_${hex(3)}`, mode: "create", title: "B", summary: "Borne.", ...args })).text)
      const empty = await send(await link({ kind: "md" }), "")
      const latin = await send(await link({ kind: "md" }), new Uint8Array([0x23, 0x20, 0xe9, 0x74, 0xe9]))
      const paragraphs = (count: number) => Array.from({ length: count }, (_, rank) => `Paragraphe ${rank} ${"a".repeat(9_990)}`).join("\n\n")
      // 150 000 caractères sans titre : au-delà de la borne d'une section (100 000), qu'un fichier déposé n'a pas.
      const wide = await send(await link({ kind: "md" }), paragraphs(15))
      const long = await send(await link({ kind: "md" }), paragraphs(31))
      const lines = await send(await link({ kind: "csv" }), ["Nom", ...Array.from({ length: 5_001 }, (_, rank) => `L${rank}`)].join("\n"))

      expect([empty, latin].map((refusal) => [refusal.status, refusal.text])).toEqual([
        [400, "invalid_arguments: The body is empty: send the file itself (curl --data-binary @<file>).\n"],
        [400, "invalid_arguments: the file is not UTF-8; convert it first (iconv -f WINDOWS-1252 -t UTF-8, or Get-Content -Encoding Default | Set-Content -Encoding UTF8)\n"],
      ])
      expect(wide.status, wide.text).toBe(200)
      expect([long.status, long.text.startsWith("too_large: ")]).toEqual([413, true])
      expect([lines.status, lines.text.startsWith("too_large: ")]).toEqual([413, true])
    })
  })

  describe("rights read again at sending (AC-f6)", () => {
    const request = { bytes: bytesOf("<p>R</p>"), origin: `https://acme.example.invalid` }
    const ticket = (path: string, mode: "create" | "attach", baseRevision: number | null): UploadTicket => ({
      userId: o.people.paul.id,
      email: o.people.paul.email,
      ctx: null,
      kind: "file",
      mode,
      path,
      name: "r.html",
      title: "R",
      summary: "Le rapport.",
      key: null,
      baseRevision,
      publish: null,
    })

    it("should refuse a write right removed, a path taken and a revision changed since the link, before any write", async () => {
      const paul = as("paul")
      const claire = await conversation(as("claire"))
      const page = `ventes/f_droit_${hex(3)}`
      const taken = `ventes/f_pris_${hex(3)}`
      for (const path of [page, taken]) expect((await claire.write({ path, title: "P", summary: "Une page.", ops: [{ op: "add_section", section: "A", text: "T." }] })).isError).toBe(false)
      const reads = await fx.addRule({ orgId: o.org.id, nodeId: o.nodes.ventes, userId: o.people.paul.id, level: "read" })
      try {
        const refused = async (sent: UploadTicket) => {
          const spy = spyDb(paul.db)
          const code = await writeUpload(spy.db, paul.identity, sent, request).then(
            () => "written",
            (error: { code?: string }) => error.code,
          )
          return { code, writes: writesOf(spy.sent) }
        }
        const noRight = await refused(ticket(page, "attach", 1))
        const pageId = (await nodeOf(page))?.id ?? ""
        const writes = await fx.addRule({ orgId: o.org.id, nodeId: pageId, userId: o.people.paul.id, level: "write" })
        const pathTaken = await refused(ticket(taken, "create", null))
        const revised = await refused(ticket(page, "attach", 0))
        await fx.admin`delete from platform.access_rules where id = ${writes}`
        expect({ noRight, pathTaken, revised }).toEqual({
          noRight: { code: "forbidden", writes: [] },
          pathTaken: { code: "conflict", writes: [] },
          revised: { code: "stale_revision", writes: [] },
        })
      } finally {
        await fx.admin`delete from platform.access_rules where id = ${reads}`
      }
    })

    it("should refuse a person no longer a member, write nothing, and log it to the server, not to the journal", async () => {
      const claire = await conversation(as("claire"))
      const path = `ventes/f_parti_${hex(3)}`
      expect((await claire.write({ path, title: "P", summary: "Une page.", ops: [{ op: "add_section", section: "A", text: "T." }] })).isError).toBe(false)
      const node = await nodeOf(path)
      if (!node) throw new Error(`${path} was not created`)
      const leaving = await fx.createUser({ fullName: "Sacha Départ" })
      await fx.addMember(o.org.id, leaving.id)
      await fx.addRule({ orgId: o.org.id, nodeId: node.id, userId: leaving.id, level: "write" })
      const db = fx.as(leaving)
      const sacha = await conversation({ db, identity: await resolveIdentity(db, o.host, { userId: leaving.id, email: leaving.email }) })
      const token = tokenOf((await sacha.link({ path, kind: "file", mode: "attach", name: "r.html", base_revision: 1 })).text)
      await fx.admin`delete from platform.members where org_id = ${o.org.id} and user_id = ${leaving.id}`
      const errors = vi.spyOn(console, "error").mockImplementation(() => undefined)

      const sent = await send(token, "<p>R</p>")
      const journaled = await fx.admin<{ n: number }[]>`select count(*)::int as n from platform.journal where org_id = ${o.org.id} and user_id = ${leaving.id} and tool = 'uploads'`

      expect([sent.status, sent.text]).toEqual([403, "not_member: The person who asked for this link is no longer a member of Acme Test: nothing was written.\n"])
      expect((await blocksOf(path, "published")).map((block) => block.type)).toEqual(["heading", "paragraph"])
      expect(journaled).toEqual([{ n: 0 }])
      expect(loggedText(errors)).toContain(`[platform] uploads: ticket of ${leaving.id} served, no longer a member of ${o.org.id}`)
    })
  })

  describe("assistants without a shell (AC-f12, AC-f14, AC-f15)", () => {
    it("should give the cause and the form link when the download fails, keep the ticket unserved for the form, and source_url out of the journal", async () => {
      const lea = await conversation(as("lea"))
      const path = `ventes/f_source_${hex(3)}`
      source.fetched = { failure: SOURCE_FAILURES.address }
      const failed = await lea.link({ path, kind: "md", mode: "create", title: "Notes", summary: "Les notes.", source_url: "https://127.0.0.1/secret-token-abc" })
      const formToken = formTokenOf(failed.text)
      const owner = as("lea")

      expect(failed.isError).toBe(false)
      expect(failed.text).toBe(
        `Could not download the file: ${SOURCE_FAILURES.address}. Send the markdown with write (one page, within its limits), or give the person this form link (the link works once, for 15 minutes; the file never goes through this conversation): https://${o.host}/upload/${formToken}`,
      )
      expect(JSON.stringify(lea.journal)).not.toContain("secret-token-abc")
      // Le jeton du formulaire n'ouvre pas la porte sans session (HN-E10S02-108) : la même `not_found`, rien de consommé.
      expect(await send(formToken, "## A\n\nTexte.\n")).toMatchObject({ status: 404, text: UNKNOWN_LINK })
      const sent = await receiveFormUpload(owner.db, owner.identity, formToken, { bytes: bytesOf("## A\n\nTexte.\n"), origin: `https://${o.host}`, userAgent: "vitest" })
      expect(sent.data.path).toBe(path)
    })

    it("should write the downloaded file like a file sent by curl", async () => {
      const lea = await conversation(as("lea"))
      const path = `ventes/f_telecharge_${hex(3)}`
      source.fetched = { bytes: bytesOf("## Résumé\n\nLe salon.\n"), type: "text/markdown" }
      const written = await lea.link({ path, kind: "md", mode: "create", title: "Salon", summary: "Le salon.", source_url: "https://claude.ai/public/artifacts/abc" })
      expect(written.isError, written.text).toBe(false)
      expect(written.text.split("\n")[0]).toBe(`Uploaded to ${path}: revision 1, published.`)
      expect((await blocksOf(path, "published")).map((block) => [block.type, block.text])).toEqual([
        ["heading", "Résumé"],
        ["paragraph", "Le salon."],
      ])
    })

    it("should show the form to the person of the ticket only, by the form token only, consume nothing for another, then serve the ticket once, the curl token with it", async () => {
      const lea = await conversation(as("lea"))
      const path = `ventes/f_formulaire_${hex(3)}`
      const linked = (await lea.link({ path, kind: "md", mode: "create", title: "Formulaire", summary: "Déposé par le formulaire." })).text
      const [token, formToken] = [tokenOf(linked), formTokenOf(linked)]
      const claire = as("claire")
      const owner = as("lea")
      const request = { bytes: bytesOf("## Déposé\n\nPar le formulaire.\n"), origin: `https://${o.host}`, userAgent: "vitest" }
      const outcome = <T>(run: Promise<T>) => run.then(() => "done", (error: { code?: string }) => error.code)

      const other = { view: await outcome(uploadForm(claire.db, claire.identity, formToken)), send: await outcome(receiveFormUpload(claire.db, claire.identity, formToken, request)) }
      // Le jeton de `curl` n'ouvre pas le formulaire, même pour la personne du ticket (HN-E10S02-108).
      const curlAtForm = { view: await outcome(uploadForm(owner.db, owner.identity, token)), send: await outcome(receiveFormUpload(owner.db, owner.identity, token, request)) }
      const view = await uploadForm(owner.db, owner.identity, formToken)
      const sent = await receiveFormUpload(owner.db, owner.identity, formToken, request)
      const again = await outcome(receiveFormUpload(owner.db, owner.identity, formToken, request))
      const curlAfter = await send(token, "## Encore\n\nTexte.\n")

      expect({ other, curlAtForm }).toEqual({ other: { view: "not_found", send: "not_found" }, curlAtForm: { view: "not_found", send: "not_found" } })
      expect(view).toEqual({ path, kind: "md", mode: "create", name: null, expiresAt: expect.any(String) })
      expect({ path: sent.data.path, status: sent.data.status, again, curlAfter: [curlAfter.status, curlAfter.text] }).toEqual({
        path,
        status: "published",
        again: "not_found",
        curlAfter: [404, UNKNOWN_LINK],
      })
    })

    it("should leave the form token unusable once the curl token has served the ticket", async () => {
      const lea = await conversation(as("lea"))
      const linked = (await lea.link({ path: `ventes/f_un_seul_${hex(3)}`, kind: "md", mode: "create", title: "Un seul", summary: "Un seul envoi." })).text
      const owner = as("lea")
      const sent = await send(tokenOf(linked), "## Par curl\n\nTexte.\n")
      const outcome = (run: Promise<unknown>) => run.then(() => "done", (error: { code?: string }) => error.code)
      const form = formTokenOf(linked)
      const request = { bytes: bytesOf("## Par le formulaire\n\nTexte.\n"), origin: `https://${o.host}`, userAgent: "vitest" }

      expect({ sent: sent.status, view: await outcome(uploadForm(owner.db, owner.identity, form)), send: await outcome(receiveFormUpload(owner.db, owner.identity, form, request)) }).toEqual({
        sent: 200,
        view: "not_found",
        send: "not_found",
      })
    })
  })

  describe("feedback of a real test (FB-0012, FB-0014)", () => {
    /** Le bucket vu par `fetch`, dont l'envoi (`PUT`) rend ce que décide `put` ; toute autre requête, le bucket. */
    const puttingWith = (put: (request: Request) => Promise<Response>) => async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init)
      return request.method === "PUT" ? put(request) : memory.fetch(request)
    }

    it("should store a .html file by source_url in create then in attach, the bucket reading it back as text/plain as Supabase does (FB-0012)", async () => {
      const lea = await conversation(as("lea"))
      const path = `ventes/f_type_html_${hex(3)}`
      source.fetched = { bytes: bytesOf("<p>Contenu du fichier html.</p>"), type: "application/octet-stream" }
      const created = await lea.link({ path, kind: "file", mode: "create", name: "a.html", title: "Type", summary: "Un fichier HTML.", source_url: "https://files.example.org/a" })
      const attached = await lea.link({ path, kind: "file", mode: "attach", name: "b.html", base_revision: 1, source_url: "https://files.example.org/b" })
      const files = await fx.admin<{ name: string; status: string }[]>`
        select f.name, f.status from platform.files f join platform.nodes n on n.id = f.node_id
         where n.org_id = ${o.org.id} and n.path = ${path} order by f.name`

      expect({ created: created.text.split("\n")[0], attached: attached.text.split("\n")[0], files }).toEqual({
        created: `Uploaded to ${path}: revision 1, published.`,
        attached: `Uploaded to ${path}: revision 2, published.`,
        files: [
          { name: "a.html", status: "ready" },
          { name: "b.html", status: "ready" },
        ],
      })
    })

    it("should say what the file storage did when it fails, « could not be reached » only without an answer, and leave the page as it was (FB-0012)", async () => {
      const claire = await conversation(as("claire"))
      const path = `ventes/f_stockage_${hex(3)}`
      expect((await claire.write({ path, title: "Stockage", summary: "Une page.", ops: [{ op: "add_section", section: "A", text: "T." }] })).isError).toBe(false)
      vi.spyOn(console, "error").mockImplementation(() => undefined)
      source.fetched = { bytes: bytesOf("12345678"), type: null }
      const attach = async (name: string) => (await claire.link({ path, kind: "file", mode: "attach", name, base_revision: 1, source_url: "https://files.example.org/f" })).text

      memory.failing.add("uploadUrl")
      const unreachable = await attach("u.pdf")
      memory.failing.delete("uploadUrl")
      vi.stubGlobal("fetch", puttingWith(async () => new Response("denied", { status: 403 })))
      const refused = await attach("r.pdf")
      vi.stubGlobal("fetch", puttingWith(async () => new Response(null, { status: 200 })))
      const missing = await attach("m.pdf")
      vi.stubGlobal(
        "fetch",
        puttingWith(async (request) => {
          memory.objects.set(new URL(request.url).pathname.slice(1), { bytes: new Uint8Array(await request.arrayBuffer()).slice(0, 3), mime: "application/pdf" })
          return new Response(null, { status: 200 })
        }),
      )
      const shorter = await attach("s.pdf")

      expect([unreachable, refused, missing, shorter]).toEqual([
        "u.pdf could not be stored: the file storage could not be reached. Nothing was attached. Ask for a new upload link and send it again.",
        "r.pdf could not be stored: the file storage refused it (HTTP 403). Nothing was attached. Ask for a new upload link and send it again.",
        "m.pdf could not be stored: the file storage did not keep it. Nothing was attached. Ask for a new upload link and send it again.",
        "s.pdf could not be stored: the file storage kept 3 bytes instead of 8. Nothing was attached. Ask for a new upload link and send it again.",
      ])
      expect((await blocksOf(path, "published")).map((block) => block.type)).toEqual(["heading", "paragraph"])
    })

    it("should remove the page a failed create made, so a new link creates it, and keep a page that received something meanwhile or is not its own (FB-0012)", async () => {
      const lea = await conversation(as("lea"))
      const claire = await conversation(as("claire"))
      const [path, name] = [`ventes/f_retire_${hex(3)}`, `rapport_${hex(3)}.pdf`]
      const errors = vi.spyOn(console, "error").mockImplementation(() => undefined)
      source.fetched = { bytes: bytesOf("%PDF-1.4 rapport"), type: null }
      const create = (at: string) => lea.link({ path: at, kind: "file", mode: "create", name, title: "Rapport", summary: "Le rapport.", source_url: "https://files.example.org/r.pdf" })
      const down = () => new Response("down", { status: 500 })
      const wrote = (outcome: Promise<{ isError: boolean; text: string }>) => outcome.then((written) => (written.isError ? written.text : "done"))
      const changed = async (rows: Promise<{ count: number }>) => ((await rows).count === 1 ? "done" : "no row changed")

      vi.stubGlobal("fetch", puttingWith(async () => down()))
      const failed = await create(path)
      const removed = await nodeOf(path)
      // Ce que la page reçoit pendant l'envoi : chaque cas n'est écarté que par une condition du retrait, et la page reste.
      const meanwhile: Record<string, (at: string) => Promise<string>> = {
        subpage: (at) => wrote(lea.write({ path: `${at}/annexe`, title: "Annexe", summary: "Une annexe.", ops: [{ op: "add_section", section: "A", text: "T." }] })),
        block: (at) => wrote(claire.write({ path: at, base_revision: 0, publish: false, ops: [{ op: "add_section", section: "A", text: "Le brouillon de Claire." }] })),
        // La page d'une autre personne : aucun geste d'un service ne change `created_by`, la base le pose.
        creator: (at) => changed(fx.admin`update platform.nodes set created_by = ${o.people.claire.id} where org_id = ${o.org.id} and path = ${at}`),
        revision: (at) => changed(fx.admin`update platform.nodes set revision = 1 where org_id = ${o.org.id} and path = ${at}`),
        file: (at) =>
          changed(fx.admin`
            insert into platform.files (org_id, node_id, name, mime, size, status, created_by)
            select org_id, id, 'autre.pdf', 'application/pdf', 3, 'ready', ${o.people.lea.id} from platform.nodes where org_id = ${o.org.id} and path = ${at}`),
      }
      const kept: Record<string, unknown> = {}
      const keptPaths: string[] = []
      for (const [what, act] of Object.entries(meanwhile)) {
        const at = `ventes/f_garde_${what}_${hex(3)}`
        let done = "not run"
        vi.stubGlobal(
          "fetch",
          puttingWith(async () => {
            done = await act(at)
            return down()
          }),
        )
        const text = (await create(at)).text
        kept[what] = { done, stays: text.endsWith(`The page ${at} it created stays, as an unpublished draft: ask for an upload link with mode attach and base_revision 0 to send the file there.`), node: (await nodeOf(at)) !== null }
        keptPaths.push(at)
      }
      vi.stubGlobal("fetch", memory.fetch)
      const again = await create(path)
      const pending = await fx.admin<{ path: string }[]>`
        select n.path from platform.files f join platform.nodes n on n.id = f.node_id where f.org_id = ${o.org.id} and f.name = ${name} and f.status = 'pending' order by n.path`

      expect({ failed: [failed.isError, failed.text], removed, again: again.text.split("\n")[0], pending }).toEqual({
        failed: [true, `${name} could not be stored: the file storage refused it (HTTP 500). Nothing was attached. The page ${path} it created was removed: ask for a new upload link and send it again.`],
        removed: null,
        again: `Uploaded to ${path}: revision 1, published.`,
        pending: keptPaths.sort().map((at) => ({ path: at })),
      })
      expect(kept).toEqual(Object.fromEntries(Object.keys(meanwhile).map((what) => [what, { done: "done", stays: true, node: true }])))
      // Gardée par ses conditions, jamais par l'échec du retrait (la clé de `parent_id` refuserait la sous-page, au log serveur).
      expect(loggedText(errors)).not.toContain("created for a file not removed")
    })

    it("should remove the page and the file a create stored when writing its block fails, so a new link creates it (HN-E10S02-117)", async () => {
      const lea = as("lea")
      const [path, name] = [`ventes/f_bloc_${hex(3)}`, `bloc_${hex(3)}.pdf`]
      const ticket: UploadTicket = { userId: o.people.lea.id, email: o.people.lea.email, ctx: null, kind: "file", mode: "create", path, name, title: "Bloc", summary: "Le bloc.", key: null, baseRevision: null, publish: null }
      const request = { bytes: bytesOf("%PDF-1.4 bloc"), origin: `https://${o.host}` }
      vi.spyOn(console, "error").mockImplementation(() => undefined)
      // Le fichier passé à `ready` (`storeFile`), l'écriture du bloc `file` échoue, à chaque essai : l'écriture atomique
      // rejoue une fois une panne de la base (`writeAtomically`, HN-E11S18-2), qu'une panne d'un coup n'atteindrait pas.
      // Le retrait, qui n'écrit pas dans `blocks`, passe.
      let stage: "storing" | "ready" | "failed" = "storing"
      const spy = spyDb(lea.db, {
        fail: (query) => {
          if (stage === "storing" && query.op === "update" && query.target === "files") stage = "ready"
          else if (stage !== "storing" && writesOf([query]).length > 0 && query.target === "blocks") {
            stage = "failed"
            return { code: "57014" }
          }
          return null
        },
      })
      const objects = new Set(memory.objects.keys())

      const failed = await writeUpload(spy.db, lea.identity, ticket, request).then(
        () => "written",
        (error: { message?: string }) => error.message ?? "",
      )
      const left = { node: await nodeOf(path), files: await fx.admin`select id from platform.files where org_id = ${o.org.id} and name = ${name}`, objects: [...memory.objects.keys()].filter((key) => !objects.has(key)) }
      const again = await writeUpload(lea.db, lea.identity, ticket, request)

      expect({ stage, removed: failed.endsWith(`The page ${path} it created was removed: ask for a new upload link and send it again.`), left, again: again.text.split("\n")[0] }).toEqual({
        stage: "failed",
        removed: true,
        left: { node: null, files: [], objects: [] },
        again: `Uploaded to ${path}: revision 1, published.`,
      })
    })

    it("should refuse a markdown file served as HTML, or that is an HTML page, writing nothing (FB-0014)", async () => {
      const lea = await conversation(as("lea"))
      const [served, page] = [`ventes/f_html_${hex(3)}`, `ventes/f_html_${hex(3)}`]
      const markdown = (path: string) => lea.link({ path, kind: "md", mode: "create", title: "Notes", summary: "Les notes.", source_url: "https://example.com/" })
      source.fetched = { bytes: bytesOf("<!doctype html><html><script>alert(1)</script></html>"), type: "text/html; charset=UTF-8" }
      const byType = await markdown(served)
      source.fetched = { bytes: bytesOf('\n  <!DOCTYPE html>\n<html lang="fr"><body>Texte</body></html>'), type: "text/plain" }
      const byContent = await markdown(page)

      expect({ byType: [byType.isError, byType.text], byContent: [byContent.isError, byContent.text], nodes: [await nodeOf(served), await nodeOf(page)] }).toEqual({
        byType: [
          false,
          `Could not download the file: source_url serves text/html, not a text file: a markdown file or a CSV is read from text/markdown, text/plain or text/csv. Send the markdown with write (one page, within its limits), or give the person this form link (the link works once, for 15 minutes; the file never goes through this conversation): https://${o.host}/upload/${formTokenOf(byType.text)}`,
        ],
        byContent: [true, "The markdown file is an HTML page (it starts with <!doctype html> or <html>): nothing was written. Send the markdown itself, or attach the HTML page with kind file."],
        nodes: [null, null],
      })
    })
  })
})
