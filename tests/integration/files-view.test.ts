// @vitest-environment node
// « Voir » un fichier joint sur une vraie base (E10-S02 lot c : AC-c2, AC-c3, AC-c5 ; ADR-017) : la route isolée d'un
// fichier HTML par la porte (en-têtes exacts, texte servi, la même 404 en texte brut pour tout refus, `Sec-Fetch-Dest`,
// le 401 sans session prouvé sans base par `tests/unit/files-html.test.ts`), la route des blocs d'un `.md` (mode tolérant), ce que la visionneuse reçoit (`fileView`), et la
// lecture publique par le jeton d'un lien (`public_file_by_token` sous `anon` : un fichier cité par un bloc publié du
// périmètre, jamais par un seul brouillon, hors périmètre, `pending` ou d'un autre nœud même cité par un bloc publié,
// par un lien désactivé ni à une autre adresse). Le bucket
// est l'adaptateur en mémoire, à la place de `fileStore()` et de `fetch` : aucun service extérieur. Les sessions sont
// celles de l'émetteur de test (`createLocalFixtures`), vérifiées par la porte. Suite portable.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { handlePlateforme } from "@otomata_tech/oto_platform/api"
import { resolveIdentity, revokeShare, shareNode, type Identity, type PlatformDb } from "@otomata_tech/oto_platform/server"
import { FILE_TYPES, fileTypeOf } from "../../packages/plateforme/schemas"
import { HTML_CONTENT_SECURITY_POLICY } from "../../packages/plateforme/server/files/html"
import { memoryFileStore, type MemoryFileStore } from "../../packages/plateforme/server/files/memory"
import { objectKey } from "../../packages/plateforme/server/files/store"
import { fileView, publicFileView } from "../../packages/plateforme/server/files/view"
import { parseMarkdown } from "../../packages/plateforme/server/nodes/markdown-parse"
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
const SUITE = "viewing an attached file on a real database (E10-S02, lot c)"

type Person = "ada" | "claire" | "paul"
type Session = { db: PlatformDb; identity: Identity; token: string }

const bytesOf = (text: string) => new TextEncoder().encode(text)

/** Les en-têtes d'ADR-017 § 1 que la route pose sur toute réponse, erreurs comprises. */
const ISOLATION = {
  "content-security-policy": HTML_CONTENT_SECURITY_POLICY,
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cache-control": "private, no-store",
}
const SERVED = { "content-type": "text/html; charset=utf-8", ...ISOLATION }
const REFUSED = { "content-type": "text/plain; charset=utf-8", ...ISOLATION }
const NOINDEX = { "x-robots-tag": "noindex, nofollow" }

/** Ce qu'une réponse de la route donne à lire : statut, en-têtes, corps. */
async function answer(response: Response) {
  return { status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() }
}

describe.skipIf(!sqlConfigured || privatePending)(privateFolderSuite(sqlConfigured ? SUITE : `${SUITE} (${SQL_SKIP_REASON})`, privatePending), { timeout: NETWORK_TIMEOUT }, () => {
  let fx: LocalFixtures
  let o: SqlReferenceOrg
  let memory: MemoryFileStore
  let otherHost: string
  const sessions = new Map<Person, Session>()

  beforeAll(async () => {
    fx = createLocalFixtures()
    o = await fx.buildReferenceOrg()
    for (const person of ["ada", "claire", "paul"] as const) {
      const user = o.people[person]
      const db = fx.as(user)
      const identity = await resolveIdentity(db, o.host, { userId: user.id, email: user.email })
      sessions.set(person, { db, identity, token: (await fx.sessionFor(user)).accessToken })
    }
    otherHost = `t${hex(4)}.example.invalid`
    await fx.createOrg({ hosts: [otherHost] })
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

  const as = (person: Person): Session => {
    const session = sessions.get(person)
    if (!session) throw new Error(`no session for ${person}`)
    return session
  }

  /** Une page sous `ventes` (équipe Ventes : Claire y lit et écrit, Paul ne la voit pas). */
  const page = (path: string) => fx.createNode(o.org.id, { parentId: o.nodes.ventes, path, title: path })

  /** Une ligne posée par la connexion d'administration (`ready` par défaut), et son objet quand on en donne. */
  async function attached(nodeId: string, name: string, bytes: Uint8Array | null, options: { orgId?: string; status?: "ready" | "pending" } = {}): Promise<string> {
    const orgId = options.orgId ?? o.org.id
    const [row] = await fx.admin<{ id: string }[]>`
      insert into platform.files (org_id, node_id, name, mime, size, status, created_by)
      values (${orgId}, ${nodeId}, ${name}, ${FILE_TYPES[fileTypeOf(name) ?? "zip"]}, ${Math.max(bytes?.byteLength ?? 1, 1)}, ${options.status ?? "ready"}, ${o.people.claire.id})
      returning id`
    if (bytes) memory.objects.set(objectKey(orgId, row.id), { bytes, mime: FILE_TYPES[fileTypeOf(name) ?? "zip"] })
    return row.id
  }

  /** Le bloc `file` qui cite un fichier posé par `attached`. */
  async function fileBlock(id: string) {
    const [row] = await fx.admin<{ name: string; size: string; mime: string }[]>`select name, size::text, mime from platform.files where id = ${id}`
    return { type: "file" as const, data: { file_id: id, name: row.name, size: Number(row.size), mime: row.mime } }
  }

  /** `GET /api/platform/<chemin>` par la porte, sous la session de `person` (sans elle : `null`). */
  function get(path: string, options: { person?: Person | null; host?: string; dest?: string } = {}) {
    const headers = new Headers(options.dest === undefined ? {} : { "sec-fetch-dest": options.dest })
    const person = options.person === undefined ? "claire" : options.person
    return handlePlateforme(new Request(`https://${options.host ?? o.host}/api/platform/${path}`, { headers }), {
      accessToken: person === null ? null : as(person).token,
      host: options.host ?? o.host,
      verifyToken: fx.verifyToken,
    })
  }

  describe("isolated HTML route (AC-c3)", () => {
    it("should serve a reader the HTML text in an iframe with the headers of ADR-017, and the same plain-text 404 for everything else", async () => {
      vi.stubGlobal("fetch", memory.fetch)
      const node = await page("ventes/v_html")
      const otherOrg = await fx.createOrg()
      const otherTree = await fx.createTree(otherOrg.id)
      const html = await attached(node, "rapport.html", bytesOf("<h1>Rapport</h1><script>document.title = 'x'</script>"))
      const markdown = await attached(node, "notes.md", bytesOf("## Notes"))
      const pending = await attached(node, "brouillon.html", bytesOf("<p>brouillon</p>"), { status: "pending" })
      const elsewhere = await attached(otherTree.root, "ailleurs.html", bytesOf("<p>ailleurs</p>"), { orgId: otherOrg.id })

      const served = await answer(await get(`files/${html}/html`, { dest: "iframe" }))
      const withoutDest = await answer(await get(`files/${html}/html`))
      const refusals = await Promise.all([
        get(`files/${html}/html`, { dest: "document" }),
        get(`files/${html}/html`, { dest: "iframe", person: "paul" }),
        get(`files/${markdown}/html`, { dest: "iframe" }),
        get(`files/${pending}/html`, { dest: "iframe" }),
        get(`files/${elsewhere}/html`, { dest: "iframe" }),
        get(`files/${crypto.randomUUID()}/html`, { dest: "iframe" }),
        get(`files/pas-un-id/html`, { dest: "iframe" }),
      ])
      expect({ served, withoutDest: withoutDest.status, refusals: await Promise.all(refusals.map(answer)) }).toEqual({
        served: { status: 200, headers: SERVED, body: "<h1>Rapport</h1><script>document.title = 'x'</script>" },
        withoutDest: 200,
        refusals: Array.from({ length: 7 }, () => ({ status: 404, headers: REFUSED, body: "not_found: Unknown file." })),
      })
    })

    it("should serve a text that is not UTF-8 as a plain-text refusal, never as JSON", async () => {
      vi.stubGlobal("fetch", memory.fetch)
      const node = await page("ventes/v_latin")
      const html = await attached(node, "ancien.html", new Uint8Array([0x3c, 0x70, 0x3e, 0xe9]))
      expect(await answer(await get(`files/${html}/html`, { dest: "iframe" }))).toEqual({ status: 400, headers: REFUSED, body: "invalid_arguments: the file is not UTF-8; download it instead" })
    })
  })

  describe("markdown of a file and what the viewer receives (AC-c2)", () => {
    it("should read a .md in tolerant mode, by the route and for the viewer, and refuse another type the same way", async () => {
      vi.stubGlobal("fetch", memory.fetch)
      const node = await page("ventes/v_md")
      // `# Titre` est refusé par `write` (titre de page) ; le mode tolérant le garde.
      const text = "# Titre\n\n## Plan\n\nUn paragraphe **gras**.\n"
      expect("problem" in parseMarkdown(text)).toBe(true)
      const tolerant = parseMarkdown(text, { tolerant: true })
      if ("problem" in tolerant) throw new Error("tolerant mode refused")
      const blocks = tolerant.blocks.map((block) => ({ type: block.type, text: block.text ?? null, data: block.data ?? {} }))
      const markdown = await attached(node, "notes.md", bytesOf(text))
      const html = await attached(node, "page.html", null)
      const claire = as("claire")

      const route = await get(`files/${markdown}/markdown`)
      const refused = await get(`files/${html}/markdown`)
      expect({
        route: [route.status, await route.json()],
        refused: [refused.status, await refused.json()],
        viewMd: await fileView(claire.db, claire.identity, { node, file: markdown }),
        // Un `html` n'est pas lu pour la visionneuse : son objet absent ne change rien, l'iframe le lira.
        viewHtml: await fileView(claire.db, claire.identity, { node, file: html }),
      }).toEqual({
        route: [200, { data: { name: "notes.md", blocks } }],
        refused: [404, { error: { code: "not_found", message: "Unknown file." } }],
        viewMd: { id: markdown, name: "notes.md", size: bytesOf(text).byteLength, path: "ventes/v_md", type: "md", blocks },
        viewHtml: { id: html, name: "page.html", size: 1, path: "ventes/v_md", type: "html" },
      })
    })

    it("should say not_found for a file of another node, another type or an unreadable node, not_utf8 for invalid bytes, not_enabled without storage", async () => {
      vi.stubGlobal("fetch", memory.fetch)
      const node = await page("ventes/v_refus")
      const neighbour = await page("ventes/v_voisine")
      const claire = as("claire")
      const paul = as("paul")
      const md = await attached(node, "notes.md", bytesOf("texte"))
      const onNeighbour = await attached(neighbour, "voisine.md", bytesOf("texte"))
      const txt = await attached(node, "lisez.txt", bytesOf("texte"))
      const latin = await attached(node, "ancien.md", new Uint8Array([0x45, 0x74, 0xe9]))
      const outcome = (run: Promise<unknown>) => run.then(() => "served", (error: { code?: string; details?: unknown }) => ({ code: error.code, details: error.details }))
      const view = (session: Session, file: string) => outcome(fileView(session.db, session.identity, { node, file }))

      const refusals = [await view(claire, onNeighbour), await view(claire, txt), await view(paul, md), await view(claire, "pas-un-id"), await view(claire, latin)]
      storage.store = null
      const disabled = await view(claire, md)
      expect({ refusals, disabled }).toEqual({
        refusals: [
          { code: "not_found", details: undefined },
          { code: "not_found", details: undefined },
          { code: "not_found", details: undefined },
          { code: "not_found", details: undefined },
          { code: "invalid_arguments", details: { reason: "not_utf8" } },
        ],
        disabled: { code: "not_enabled", details: undefined },
      })
    })
  })

  describe("public link (AC-c5, ADR-016 § 7)", () => {
    /** Un contenu publié sous la racine, sa sous-page publiée, et le lien d'Ada ; chaque page cite ses fichiers. */
    async function sharedFiles(root: string) {
      const rootId = await fx.createNode(o.org.id, { parentId: o.nodes.root, path: root, title: `Titre ${root}` })
      const childId = await fx.createNode(o.org.id, { parentId: rootId, path: `${root}/sous`, title: "Sous" })
      const files = {
        html: await attached(rootId, "rapport.html", bytesOf("<p>Rapport public</p>")),
        md: await attached(rootId, "notes.md", bytesOf("## Notes\n\nPubliques.")),
        pdf: await attached(rootId, "devis.pdf", bytesOf("%PDF")),
        draftOnly: await attached(rootId, "brouillon.html", bytesOf("<p>brouillon</p>")),
        child: await attached(childId, "enfant.html", bytesOf("<p>enfant</p>")),
      }
      await fx.publishBlocks(rootId, [await fileBlock(files.html), await fileBlock(files.md), await fileBlock(files.pdf)])
      await fx.publishBlocks(childId, [await fileBlock(files.child)])
      // Cité par le seul brouillon de la racine : jamais servi (ADR-016 § 7).
      await fx.draftBlocks(rootId, [await fileBlock(files.html), await fileBlock(files.draftOnly)])
      const ada = as("ada")
      const { share } = (await shareNode(ada.db, ada.identity, { path: root, include_children: false })).data
      return { token: share.token, shareId: share.id, files }
    }

    it("should serve the HTML, the blocks and the read of a file cited by a published block, with the public headers", async () => {
      vi.stubGlobal("fetch", memory.fetch)
      const { token, files } = await sharedFiles(`pub_v_${hex(3)}`)
      const html = await answer(await get(`public/${token}/files/${files.html}/html`, { person: null, dest: "iframe" }))
      const markdown = await get(`public/${token}/files/${files.md}/markdown`, { person: null })
      const read = await get(`public/${token}/files/${files.pdf}?disposition=inline`, { person: null })
      const location = new URL(read.headers.get("location") ?? "")
      expect({
        html,
        markdown: [markdown.status, markdown.headers.get("x-robots-tag"), ((await markdown.json()) as { data: { name: string } }).data.name],
        read: [read.status, read.headers.get("x-robots-tag"), read.headers.get("cache-control"), location.pathname.slice(1), location.searchParams.get("response-content-disposition")],
      }).toEqual({
        html: { status: 200, headers: { ...SERVED, ...NOINDEX }, body: "<p>Rapport public</p>" },
        markdown: [200, "noindex, nofollow", "notes.md"],
        read: [302, "noindex, nofollow", "private, no-store", objectKey(o.org.id, files.pdf), "inline"],
      })
    })

    it("should answer the same 404 for a draft-only file, a file out of scope, a request outside an iframe, another address and a disabled link", async () => {
      vi.stubGlobal("fetch", memory.fetch)
      const { token, shareId, files } = await sharedFiles(`pub_w_${hex(3)}`)
      const refused = { status: 404, headers: { ...REFUSED, ...NOINDEX }, body: "not_found: Not found." }
      const before = await Promise.all(
        [
          get(`public/${token}/files/${files.draftOnly}/html`, { person: null, dest: "iframe" }),
          get(`public/${token}/files/${files.child}/html`, { person: null, dest: "iframe" }),
          get(`public/${token}/files/${files.html}/html`, { person: null, dest: "document" }),
          get(`public/${token}/files/${files.md}/html`, { person: null, dest: "iframe" }),
          get(`public/${token}/files/${files.html}/html`, { person: null, dest: "iframe", host: otherHost }),
        ].map(async (response) => answer(await response)),
      )
      const ada = as("ada")
      await revokeShare(ada.db, ada.identity, shareId)
      const after = await answer(await get(`public/${token}/files/${files.html}/html`, { person: null, dest: "iframe" }))
      const afterRead = await get(`public/${token}/files/${files.pdf}`, { person: null })
      expect({ before, after, afterRead: [afterRead.status, await afterRead.json()] }).toEqual({
        before: Array.from({ length: 5 }, () => refused),
        after: refused,
        afterRead: [404, { error: { code: "not_found", message: "Not found." } }],
      })
    })

    it("should answer the same 404 for a ready file of a node out of scope and for a pending file, both cited by a published block of the shared root", async () => {
      vi.stubGlobal("fetch", memory.fetch)
      const root = `pub_y_${hex(3)}`
      const rootId = await fx.createNode(o.org.id, { parentId: o.nodes.root, path: root, title: `Titre ${root}` })
      const outside = await page(`ventes/v_hors_${hex(3)}`)
      const cited = await attached(rootId, "rapport.html", bytesOf("<p>Rapport</p>"))
      const elsewhere = await attached(outside, "ailleurs.html", bytesOf("<p>ailleurs</p>"))
      const pending = await attached(rootId, "en_cours.html", bytesOf("<p>en cours</p>"), { status: "pending" })
      // Posés en administration : `writeNode` refuserait ces deux citations (AC-d3) ; la lecture publique ne s'y fie pas,
      // elle décide sur le fichier lui-même (`security-patterns.md § Droits dans le service`).
      await fx.publishBlocks(rootId, [await fileBlock(cited), await fileBlock(elsewhere), await fileBlock(pending)])
      const ada = as("ada")
      const { share } = (await shareNode(ada.db, ada.identity, { path: root, include_children: true })).data
      const html = async (id: string) => answer(await get(`public/${share.token}/files/${id}/html`, { person: null, dest: "iframe" }))
      const read = async (id: string) => {
        const response = await get(`public/${share.token}/files/${id}`, { person: null })
        return [response.status, await response.json()]
      }
      const refused = { status: 404, headers: { ...REFUSED, ...NOINDEX }, body: "not_found: Not found." }
      const unknown = [404, { error: { code: "not_found", message: "Not found." } }]

      expect({ cited: await html(cited), html: [await html(elsewhere), await html(pending)], read: [await read(elsewhere), await read(pending)] }).toEqual({
        cited: { status: 200, headers: { ...SERVED, ...NOINDEX }, body: "<p>Rapport</p>" },
        html: [refused, refused],
        read: [unknown, unknown],
      })
    })

    it("should give the viewer a file of the content at the address only, and its blocks for a .md", async () => {
      vi.stubGlobal("fetch", memory.fetch)
      const root = `pub_x_${hex(3)}`
      const { token, files } = await sharedFiles(root)
      const outcome = (run: Promise<unknown>) => run.then((value) => value, (error: { code?: string }) => error.code)
      expect({
        html: await outcome(publicFileView(o.host, token, { path: root, file: files.html })),
        md: await outcome(publicFileView(o.host, token, { path: root, file: files.md }).then((view) => view.type)),
        pdf: await outcome(publicFileView(o.host, token, { path: root, file: files.pdf })),
        otherPath: await outcome(publicFileView(o.host, token, { path: `${root}/sous`, file: files.html })),
      }).toEqual({
        html: { id: files.html, name: "rapport.html", size: bytesOf("<p>Rapport public</p>").byteLength, path: root, type: "html" },
        md: "md",
        pdf: "not_found",
        otherPath: "not_found",
      })
    })
  })
})
