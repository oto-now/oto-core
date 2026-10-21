// @vitest-environment node
// Export-import d'une organisation de bout en bout (E09-S04, AC1 à AC14), sur le projet Supabase
// d'oto-platform (H120) : organisation source semée par `pnpm demo:seed --slug t<hex>` (compte E2E
// jetable, passé par l'environnement du processus), complétée par la connexion d'administration
// (brouillon, lien, déplacement, bail, journal, invitation, accès plateforme) ; seconde organisation
// témoin ; export, import sous d'autres slugs, refus. Organisations `t<hex>` et personnes
// `test-<hex>@example.invalid`, supprimées en `afterAll`, même en échec. La connexion d'administration
// sert au test et aux scripts, jamais au paquet. Marqué Supabase : le script Démo crée ses comptes par
// l'API d'administration de Supabase Auth (AC-f4 d'E01-S10) ; depuis E01-S10 f2, plus rien ne passe par
// PostgREST. Le `describe` AC14, la carte face aux tables lues dans le catalogue, est portable (E11-S14).
import { execFile } from "child_process"
import fs from "fs"
import http from "http"
import type { AddressInfo } from "net"
import os from "os"
import path from "path"
import { promisify } from "util"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { fingerprint } from "../../scripts/lib/org-transfer-plan.mjs"
import { NEVER_EXPORTED, orgRowsSql, TABLES } from "../../scripts/lib/org-transfer.mjs"
import { filesDir, STORAGE_VARIABLES } from "../../scripts/lib/org-transfer-files.mjs"
import { pendingMigrations, pendingReason, privateFolderPending, privateFolderSuite } from "../helpers/pending-migrations"
import { platformTables } from "../helpers/platform-tables"
import { createFixtures, ctxCode, hex, SKIP_REASON, supabaseConfigured, type Fixtures, type TestUser } from "../helpers/plateforme"
import { adminConnectionSecrets, asCaller, portable, SQL_SKIP_REASON, sqlConfigured, testAdminSql, type TestSql } from "../helpers/sql"

// Ces tests supposent le dossier `private` en base (fiche D107) : sautés, la version nommée, tant que
// 20260928120000 n'est pas appliquée au projet (`database-patterns.md § Règles`).
const privatePending = await privateFolderPending()
// La carte exporte les réglages d'un compte et en écarte le secret et le jeton : sans les colonnes des comptes à plusieurs
// champs, l'export échoue sur une colonne absente (42703) ; la suite se saute, la version nommée, d'ici leur application.
const ACCOUNT_FIELDS_VERSION = "20261008090000"
const accountFieldsPending = (await pendingMigrations()).includes(ACCOUNT_FIELDS_VERSION)

// Semis, trois exports et un import en préparation : une trentaine de secondes au calme ; sous la
// charge des agents qui testent en même temps, une requête triviale prend jusqu'à 3,5 s et le semis
// Démo plus de 120 s (mesuré le 2026-09-24) : délai de 180 s de la story porté à 600 s.
const TIMEOUT = 600_000
const SCRIPTS = path.resolve(__dirname, "../../scripts")
const CROCKFORD = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/
const JOURNAL = ["ctx", "journal", "admin_journal", "feedback", "sim_outbox"]
// E10-S02 (AC-e4) : les scripts parlent à un faux S3 local (`fakeS3`), quel que soit `.env.local` : aucun test
// n'écrit dans un bucket réel. Sans les cinq variables, l'export et l'import d'une organisation avec des fichiers
// échouent avant toute écriture (`NO_STORAGE`).
const NO_STORAGE = Object.fromEntries(STORAGE_VARIABLES.map((name) => [name, ""]))
const BUCKET = "plateforme"

/**
 * Un faux S3 en chemin (`/<bucket>/<clé>`) : `PUT` garde les octets, `GET` les rend ou 404. La signature n'est pas
 * contrôlée : elle l'est en unitaire. `env` : les cinq variables, clés factices construites à l'exécution.
 */
function fakeS3() {
  const objects = new Map<string, string>()
  const server = http.createServer((request, response) => {
    const key = decodeURIComponent(new URL(request.url ?? "/", "http://127.0.0.1").pathname)
    if (request.method === "PUT") {
      const chunks: Buffer[] = []
      request.on("data", (chunk: Buffer) => chunks.push(chunk))
      request.on("end", () => {
        objects.set(key, Buffer.concat(chunks).toString("utf8"))
        response.writeHead(200).end()
      })
      return
    }
    const body = request.method === "GET" ? objects.get(key) : undefined
    if (body === undefined) response.writeHead(404).end()
    else response.writeHead(200, { "content-type": "application/octet-stream" }).end(body)
  })
  const env: Record<string, string> = {}
  return {
    objects,
    env,
    object: (orgId: string, fileId: string) => objects.get(`/${BUCKET}/${orgId}/${fileId}`),
    async start() {
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
      Object.assign(env, {
        PLATFORM_STORAGE_ENDPOINT: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        PLATFORM_STORAGE_BUCKET: BUCKET,
        PLATFORM_STORAGE_REGION: "fr-par",
        PLATFORM_STORAGE_ACCESS_KEY_ID: `AK${hex(4)}`,
        PLATFORM_STORAGE_SECRET_ACCESS_KEY: hex(16),
      })
    },
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}
const s3 = fakeS3()

type Row = Record<string, unknown>
type ExportFile = {
  format: string
  version: number
  exported_at: string
  source: { host: string; org: { id: string; slug: string; prefix: string; name: string } }
  people: { id: string; email: string | null }[]
  tables: Record<string, Row[]>
}
type Outcome = { code: number; stdout: string; stderr: string }

const run = promisify(execFile)

/** Lance un script de `scripts/`, sur le faux S3 sauf `env` contraire ; ne lève pas : son code de sortie et ses deux sorties. */
async function script(name: string, args: string[], env: Record<string, string> = {}): Promise<Outcome> {
  try {
    const { stdout, stderr } = await run(process.execPath, [path.join(SCRIPTS, name), ...args], {
      env: { ...process.env, ...s3.env, ...env },
      timeout: TIMEOUT - 60_000,
    })
    return { code: 0, stdout, stderr }
  } catch (error) {
    // execFile rejette sur un code non nul, ou sur le délai (`signal`) ; l'erreur porte le code et les
    // deux sorties du processus.
    const { code, signal, stdout, stderr } = error as { code: number | null; signal: string | null; stdout: string; stderr: string }
    return { code: code ?? -1, stdout, stderr: signal ? `${stderr}\n(killed by ${signal})` : stderr }
  }
}

function readExport(file: string): ExportFile {
  // Écrit par `scripts/org-export.mjs` : la forme d'AC1.
  return JSON.parse(fs.readFileSync(file, "utf8")) as ExportFile
}

/** Aucune valeur secrète dans une sortie ; l'échec ne nomme que la variable. */
function expectNoSecret(output: string) {
  const secrets = { secretKey: process.env.SUPABASE_SECRET_KEY, anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, ...adminConnectionSecrets() }
  expect(Object.entries(secrets).filter(([, value]) => value && output.includes(value)).map(([name]) => name)).toEqual([])
}

const org = () => {
  const slug = `t${hex(4)}`
  return { slug, prefix: slug, id: "" }
}

// Les scripts lisent et écrivent `platform` par la connexion d'administration (E01-S10, AC-f4) ; le
// test compte les lignes de la base par celle des tests, par la même variable.
const configured = supabaseConfigured && sqlConfigured

describe.skipIf(!configured || accountFieldsPending)(
  !configured
    ? `org:export and org:import end to end (${supabaseConfigured ? SQL_SKIP_REASON : SKIP_REASON})`
    : accountFieldsPending
      ? `org:export and org:import end to end (${pendingReason([ACCOUNT_FIELDS_VERSION])})`
      : "org:export and org:import end to end",
  { timeout: TIMEOUT },
  () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "org-transfer-"))
    const slugs: string[] = []
    const source = org()
    const copy = { ...org(), host: `t${hex(4)}.example.invalid` }
    const sourceFile = path.join(dir, "source.org-export.json")
    const copyFile = path.join(dir, "copy.org-export.json")
    const qHandle = `q${hex(3)}`
    const cipher = `ciphertext-${hex(8)}`
    const pendingEmail = `test-${hex(6)}@example.invalid`
    const witness = `temoin${hex(6)}`
    let fx: Fixtures
    let admin: TestSql
    let e2e: TestUser
    let q: TestUser
    let staff: TestUser
    let exported: Outcome
    let imported: Outcome
    let sourceDoc: ExportFile
    let copyDoc: ExportFile
    let shareToken = ""
    let sourceFileId = ""
    const other: { id: string; slug: string; ids: string[]; email: string } = { id: "", slug: "", ids: [], email: "" }
    const at = new Date().toISOString()

    /** La seule ligne d'une lecture ; aucune : l'opération nommée en échec. */
    async function one<T>(query: PromiseLike<readonly T[]>, what: string): Promise<T> {
      const [row] = await query
      if (!row) throw new Error(`${what} failed: no row`)
      return row
    }

    async function orgId(slug: string): Promise<string | null> {
      const [row] = await admin<{ id: string }[]>`select id from platform.orgs where slug = ${slug}`
      return row?.id ?? null
    }

    /**
     * Lignes de l'organisation source dans la base, pour une table de la carte, sous le filtre de
     * l'export (`orgRowsSql`) : par `org_id`, par son `id` pour `orgs`, parmi les lignes parentes de la
     * source pour une table sans `org_id`. Par la connexion d'administration, comme l'export.
     */
    async function countInBase(sql: TestSql, spec: (typeof TABLES)[number]): Promise<number> {
      const [{ count }] = await sql`select count(*)::int as count from ${sql(`platform.${spec.name}`)} where ${orgRowsSql(sql, spec, source.id)}`
      return count
    }

    /** Brouillon, lien, déplacement, bail, personne Q, règle, lien public, compte chiffré, accès plateforme. */
    async function completeSource(): Promise<void> {
      const ventes = (await one(admin<{ id: string }[]>`select id from platform.teams where org_id = ${source.id} and slug = 'ventes'`, "ventes")).id
      const conseil = await fx.nodeId(source.id, "conseil")
      const grille = await fx.nodeId(source.id, "conseil/grille_tarifaire")
      const table = await fx.nodeId(source.id, "ventes/suivi_prospects")
      await fx.addMember(source.id, q.id, { profile: { handle: qHandle, name: "Quentin Test" } })
      await fx.addTeamMember(ventes, q.id)
      const offre = await fx.createNode(source.id, { parentId: conseil, path: "conseil/offre", title: "Offre", summary: "Offre de conseil." })
      // Un fichier joint (E10-S02, ADR-016) cité par un bloc publié, rendu par une fonction (son origine), et un envoi en
      // cours, que l'export laisse (AC-e4).
      const file = await one(admin<{ id: string }[]>`
        insert into platform.files (org_id, node_id, name, mime, size, status, created_by, origin_kind, origin_function)
        values (${source.id}, ${offre}, 'offre.pdf', 'application/pdf', 3, 'ready', ${e2e.id}, 'function', 'devis.render') returning id`, "files")
      sourceFileId = file.id
      s3.objects.set(`/${BUCKET}/${source.id}/${file.id}`, "pdf")
      await admin`
        insert into platform.files (org_id, node_id, name, mime, size, status, created_by)
        values (${source.id}, ${offre}, 'en_cours.pdf', 'application/pdf', 3, 'pending', ${e2e.id})`
      const { blockIds } = await fx.publishBlocks(
        offre,
        [
          { type: "heading", text: "Offre", data: { level: 1 }, key: "offre" },
          { type: "paragraph", text: `Voir [[conseil/grille_tarifaire#etudes]] et [[private/${qHandle}]].` },
          { type: "file", data: { file_id: file.id, name: "offre.pdf", size: 3, mime: "application/pdf" } },
        ],
        { links: [{ block: 1, path: "conseil/grille_tarifaire", key: "etudes" }, { block: 1, path: `private/${qHandle}` }] },
      )
      await admin`
        update platform.blocks set created_by = ${q.id}, provenance = ${admin.json({ origin: "human", by: q.id, at })}
        where id = ${blockIds[1]} and state = 'published'`
      await fx.addRule({ orgId: source.id, nodeId: offre, userId: q.id, level: "write" })
      // Un lien public actif (ADR-013) : son jeton, un secret, ne sort pas (AC4) ; la copie l'a désactivé (HN-E05S10e-9).
      shareToken = (await one(admin<{ token: string }[]>`
        insert into platform.node_shares (org_id, node_id, created_by) values (${source.id}, ${offre}, ${e2e.id}) returning token`, "node_shares")).token
      await admin`select * from platform.open_draft(${grille})`
      await admin`update platform.blocks set text = 'Pré-étude : 1 800 € HT.' where node_id = ${grille} and state = 'draft' and text like 'Pré-étude%'`
      await admin`update platform.node_drafts set title = 'Grille tarifaire 2027' where node_id = ${grille}`
      const moved = await fx.createNode(source.id, { parentId: conseil, path: "conseil/ancienne", title: "Ancienne" })
      await admin`update platform.nodes set path = 'conseil/nouvelle' where id = ${moved}`
      const lease = new Date(Date.now() + 3_600_000).toISOString()
      await fx.addRows(table, [{ key: "P-099", data: { ref: "P-099", entreprise: "Scierie Témoin", statut: "en cours" }, claim: { worker: "agent-test", userId: e2e.id, until: lease } }])
      const account = (await one(admin<{ id: string }[]>`select id from platform.accounts where org_id = ${source.id} and label ilike 'Mail Ventes'`, "Mail Ventes")).id
      // Un compte au secret chiffré, posé à l'insertion par l'outillage.
      await admin`
        insert into platform.accounts (org_id, connector, owner_kind, label, mode, secret_ciphertext)
        values (${source.id}, 'mail', 'org', 'Coffre', 'simule', ${cipher})`
      await fx.makeStaff(staff.id)
      await fx.grantPlatformAccess(source.id, staff.id, e2e.id)
      await addJournal({ ventes, grille, account })
      // Une invitation en attente, importée (AC13) ; le filtre des invitations closes est prouvé par
      // `planImport` en unitaire.
      await admin`
        insert into platform.invitations (org_id, email, role, team_id, invited_by) values (${source.id}, ${pendingEmail}, 'member', ${ventes}, ${e2e.id})`
    }

    async function addJournal({ ventes, grille, account }: { ventes: string; grille: string; account: string }): Promise<void> {
      const code = ctxCode()
      const rules = await fx.rulesVersion(source.id)
      await admin`
        insert into platform.ctx (code, org_id, user_id, rules_version, host, user_agent)
        values (${code}, ${source.id}, ${e2e.id}, ${rules}, 'test@1', 'vitest')`
      await admin`
        insert into platform.journal (org_id, user_id, team_id, ctx, method, tool, target, args, account_id)
        values (${source.id}, ${e2e.id}, ${ventes}, ${code}, 'tools/call', ${`${source.prefix}_read`}, 'conseil/grille_tarifaire', ${admin.json({ node: grille })}, ${account})`
      await admin`
        insert into platform.admin_journal (org_id, user_id, ctx, method, tool, op, target, args)
        values (${source.id}, ${staff.id}, 'ADMN-TEST', 'tools/call', 'admin_org', 'show', ${source.slug}, ${admin.json({ org: source.id })})`
      // `number` : reposé par `feedback_number` (E01-S06).
      await admin`
        insert into platform.feedback (org_id, number, user_id, ctx, type, text) values (${source.id}, 1, ${e2e.id}, ${code}, 'gap', 'Ticket témoin.')`
      await admin`
        insert into platform.sim_outbox (org_id, account_id, connector, function, payload, created_by)
        values (${source.id}, ${account}, 'mail', 'mail.draft', ${admin.json({ to: "prospect@example.test", node: grille })}, ${e2e.id})`
    }

    /** Seconde organisation : un membre et un bloc témoin qu'aucun export d'une autre ne doit porter (AC4). */
    async function secondOrg(): Promise<void> {
      const created = await fx.createOrg()
      const member = await fx.createUser()
      await fx.addMember(created.id, member.id, { role: "admin" })
      const tree = await fx.createTree(created.id)
      const page = await fx.createNode(created.id, { parentId: tree.root, path: "temoin", title: "Témoin" })
      const { blockIds } = await fx.publishBlocks(page, [{ type: "paragraph", text: `Bloc ${witness}.` }])
      Object.assign(other, { id: created.id, slug: created.slug, ids: [created.id, tree.root, tree.private, tree.contexte, page, ...blockIds], email: member.email })
    }

    beforeAll(async () => {
      await s3.start()
      fx = createFixtures()
      admin = testAdminSql()
      e2e = await fx.createUser({ fullName: "Compte E2E" })
      q = await fx.createUser({ fullName: "Quentin Test" })
      staff = await fx.createUser({ fullName: "Staff Test" })
      slugs.push(source.slug, copy.slug)
      const seeded = await script("demo-seed.mjs", ["--slug", source.slug], { E2E_USER_EMAIL: e2e.email, E2E_USER_PASSWORD: e2e.password })
      if (seeded.code !== 0) throw new Error(`demo:seed failed: ${seeded.stderr}`)
      source.id = (await orgId(source.slug)) ?? ""
      fx.trackOrg(source.id)
      await completeSource()
      await secondOrg()
      exported = await script("org-export.mjs", ["--org", source.slug, "--out", sourceFile, "--with-journal"])
      if (exported.code !== 0) throw new Error(`org:export failed: ${exported.stderr}`)
      imported = await script("org-import.mjs", ["--in", sourceFile, "--slug", copy.slug, "--prefix", copy.prefix, "--domain", copy.host])
      if (imported.code !== 0) throw new Error(`org:import failed: ${imported.stderr}`)
      copy.id = (await orgId(copy.slug)) ?? ""
      fx.trackOrg(copy.id)
      const again = await script("org-export.mjs", ["--org", copy.slug, "--out", copyFile, "--with-journal"])
      if (again.code !== 0) throw new Error(`org:export of the copy failed: ${again.stderr}`)
      sourceDoc = readExport(sourceFile)
      copyDoc = readExport(copyFile)
    }, TIMEOUT)

    // Par slug d'abord : une organisation qu'un import aurait laissée n'est connue que par lui. Puis
    // `cleanup()`, même si cette suppression échoue (57014 sous charge) : comptes jetables, équipe
    // plateforme et journal admin ne restent pas dans le projet partagé.
    afterAll(async () => {
      const deleted = admin ? await admin`delete from platform.orgs where slug in ${admin(slugs)}`.then(() => null, (error: { code?: string }) => error) : null
      try {
        await fx?.cleanup()
      } finally {
        fs.rmSync(dir, { recursive: true, force: true })
        await admin?.end({ timeout: 5 })
        await s3.stop()
      }
      if (deleted) throw new Error(`orgs delete failed: ${deleted.code}`)
    }, TIMEOUT)

    const rows = (doc: ExportFile, table: string) => doc.tables[table] ?? []
    const node = (doc: ExportFile, nodePath: string) => rows(doc, "nodes").find((row) => row.path === nodePath)

    it("AC1 — should write the file's format, source, people and every row of every table of the map, and say so", async () => {
      expect(sourceDoc).toMatchObject({
        format: "oto-platform-org-export",
        version: 1,
        source: { host: new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").host, org: { id: source.id, slug: source.slug, prefix: source.prefix, name: `Démo ${source.slug}` } },
      })
      expect(Date.parse(sourceDoc.exported_at)).not.toBeNaN()
      expect(Object.keys(sourceDoc.tables).sort()).toEqual(TABLES.map((spec) => spec.name).sort())
      const emails = sourceDoc.people.map((person) => person.email)
      for (const person of [e2e, q, staff]) expect(emails).toContain(person.email)
      const total = Object.values(sourceDoc.tables).reduce((sum, list) => sum + list.length, 0)
      const filled = Object.values(sourceDoc.tables).filter((list) => list.length > 0).length
      expect(exported.stdout).toContain(`${total} lignes dans ${filled} tables, ${sourceDoc.people.length} personnes.`)
      expect(exported.stdout).toContain("Ce fichier contient des données personnelles : ne le commitez pas.")
      expectNoSecret(exported.stdout + exported.stderr)
      // Chaque table porte toutes les lignes de l'organisation : le semis et la préparation remplissent
      // toutes les tables de la carte, si bien qu'une table lue en partie, ou pas du tout, se voit.
      const sql = testAdminSql()
      let counts: Record<string, number>
      try {
        counts = Object.fromEntries(await Promise.all(TABLES.map(async (spec) => [spec.name, await countInBase(sql, spec)] as const)))
      } finally {
        await sql.end()
      }
      expect(counts).toEqual(Object.fromEntries(TABLES.map((spec) => [spec.name, rows(sourceDoc, spec.name).length])))
      expect(Object.entries(counts).filter(([, count]) => count === 0)).toEqual([])
    })

    it("AC2 — should add the journal group on option only", async () => {
      for (const table of JOURNAL) {
        expect({ table, rows: rows(sourceDoc, table).length > 0 }).toEqual({ table, rows: true })
        expect(rows(sourceDoc, table).every((row) => row.org_id === source.id)).toBe(true)
      }
      const file = path.join(dir, "without-journal.org-export.json")
      const plain = await script("org-export.mjs", ["--org", source.slug, "--out", file])
      expect(plain.code).toBe(0)
      expect(Object.keys(readExport(file).tables).filter((table) => JOURNAL.includes(table))).toEqual([])
    })

    it("AC3 — should export content as blocks in both states, drafts, snapshots, links and aliases", () => {
      const grille = node(sourceDoc, "conseil/grille_tarifaire")
      const table = node(sourceDoc, "ventes/suivi_prospects")
      const blocks = rows(sourceDoc, "blocks")
      expect(new Set(blocks.filter((row) => row.node_id === grille?.id).map((row) => row.state))).toEqual(new Set(["draft", "published"]))
      // Présentes ; toutes, par le compte d'AC1.
      expect(blocks.some((row) => row.node_id === table?.id && row.type === "row")).toBe(true)
      expect(blocks.filter((row) => "search_tsv" in row)).toEqual([])
      expect(rows(sourceDoc, "node_drafts")).toEqual([expect.objectContaining({ node_id: grille?.id, title: "Grille tarifaire 2027", base_revision: 1 })])
      const versions = rows(sourceDoc, "node_versions").filter((row) => row.node_id === grille?.id)
      expect(versions).toEqual([expect.objectContaining({ revision: 1, blocks: expect.arrayContaining([expect.objectContaining({ key: "etudes" })]) })])
      const links = rows(sourceDoc, "links")
      expect(links.map((row) => [row.target_path, row.target_key])).toEqual(
        expect.arrayContaining([["conseil/grille_tarifaire", "etudes"], [`private/${qHandle}`, null]]),
      )
      expect(links.every((row) => typeof row.source_block_id === "string" && !("id" in row))).toBe(true)
      expect(rows(sourceDoc, "node_aliases")).toEqual([expect.objectContaining({ old_path: "conseil/ancienne", node_id: node(sourceDoc, "conseil/nouvelle")?.id })])
      expect(rows(sourceDoc, "nodes").filter((row) => "lpath" in row || "search_tsv" in row)).toEqual([])
      expect(node(sourceDoc, "ventes/contexte")).toMatchObject({ kind: "context" })
      expect(Object.keys(sourceDoc.tables).filter((table) => table === "rows" || table === "vocabulary")).toEqual([])
    })

    it("AC4 — should hold nothing of another organization, no secret and no platform staff", () => {
      const text = fs.readFileSync(sourceFile, "utf8")
      const leaks = { ...Object.fromEntries(other.ids.map((id, index) => [`id${index}`, id])), email: other.email, witness, cipher, column: "secret_ciphertext", shareToken }
      expect(Object.entries(leaks).filter(([, value]) => value && text.includes(value)).map(([name]) => name)).toEqual([])
      expect(Object.keys(sourceDoc.tables)).not.toContain(NEVER_EXPORTED[0])
      expect(rows(sourceDoc, "platform_grants")).toEqual([expect.objectContaining({ user_id: staff.id })])
    })

    it("AC5 — should refuse an unknown organization", async () => {
      const unknown = `t${hex(4)}`
      const outcome = await script("org-export.mjs", ["--org", unknown, "--out", path.join(dir, "unknown.org-export.json")])
      expect(outcome).toMatchObject({ code: 1, stderr: expect.stringContaining(`Organisation inconnue : ${unknown}.`) })
      expect(fs.existsSync(path.join(dir, "unknown.org-export.json"))).toBe(false)
    })

    it("AC6 — should create a new organization with new identifiers, every path once", async () => {
      const written = Object.entries(sourceDoc.tables).filter(([table]) => table !== "org_domains").map(([, list]) => list)
      const total = written.reduce((sum, list) => sum + list.length, 0)
      const filled = written.filter((list) => list.length > 0).length
      expect(imported.stdout).toContain(`Organisation ${copy.slug} importée : ${total} lignes dans ${filled} tables.`)
      expectNoSecret(imported.stdout + imported.stderr)
      expect(copyDoc.source.org).toEqual({ id: copy.id, slug: copy.slug, prefix: copy.prefix, name: `Démo ${source.slug}` })
      const keys = (doc: ExportFile) =>
        new Set([
          ...["teams", "accounts", "nodes", "files", "blocks", "access_rules", "node_shares", "invitations", "platform_grants", "sim_outbox"].flatMap((table) => rows(doc, table).map((row) => row.id)),
          ...rows(doc, "ctx").map((row) => row.code),
          doc.source.org.id,
        ])
      const before = keys(sourceDoc)
      expect([...keys(copyDoc)].filter((key) => before.has(key))).toEqual([])
      for (const row of rows(copyDoc, "ctx")) expect(row.code).toMatch(CROCKFORD)
      for (const row of rows(copyDoc, "sim_outbox")) expect(row.id).toMatch(/^sim_[0-9a-f]{8}$/)
      // `nodes` porte `unique (org_id, path)` : le même ensemble de chemins que la source prouve P39.
      const paths = rows(copyDoc, "nodes").map((row) => row.path)
      expect(paths.sort()).toEqual(rows(sourceDoc, "nodes").map((row) => row.path).sort())
      const contexts = (doc: ExportFile) => rows(doc, "nodes").filter((row) => row.kind === "context").map((row) => row.path).sort()
      expect(contexts(copyDoc)).toEqual(contexts(sourceDoc))
      // Le lien public : actif dans la source, désactivé à l'import, sous un jeton neuf (HN-E05S10e-9).
      expect(rows(sourceDoc, "node_shares")).toEqual([expect.objectContaining({ node_id: node(sourceDoc, "conseil/offre")?.id, revoked_at: null })])
      expect(rows(copyDoc, "node_shares")).toEqual([expect.objectContaining({ node_id: node(copyDoc, "conseil/offre")?.id, revoked_at: expect.any(String) })])
      const copied = await admin<{ token: string }[]>`select token from platform.node_shares where org_id = ${copy.id}`
      expect(copied.map((row) => row.token === shareToken)).toEqual([false])
    })

    it.skipIf(privatePending)(privateFolderSuite("AC7 — should give each block one new id for both states, used by snapshots and links", privatePending), () => {
      const blocks = rows(copyDoc, "blocks")
      const ids = new Set(blocks.map((row) => row.id))
      const grille = node(copyDoc, "conseil/grille_tarifaire")
      const draft = blocks.filter((row) => row.node_id === grille?.id && row.state === "draft")
      const published = new Set(blocks.filter((row) => row.node_id === grille?.id && row.state === "published").map((row) => row.id))
      expect(draft.length).toBe(4)
      expect(draft.filter((row) => !published.has(row.id))).toEqual([])
      const snapshotIds = rows(copyDoc, "node_versions").flatMap((row) => (Array.isArray(row.blocks) ? row.blocks.map((entry) => entry?.id) : []))
      expect(snapshotIds.length).toBeGreaterThan(0)
      expect(snapshotIds.filter((id) => !ids.has(id))).toEqual([])
      const links = rows(copyDoc, "links")
      expect(links.filter((row) => !ids.has(row.source_block_id))).toEqual([])
      expect(links.find((row) => row.target_path === "conseil/grille_tarifaire")?.target_node_id).toBe(grille?.id)
      expect(links.find((row) => row.target_path === `private/${qHandle}`)?.target_node_id).toBe(node(copyDoc, `private/${qHandle}`)?.id)
      expect(blocks.find((row) => row.key === "P-099")).toMatchObject({ claimed_by: "agent-test", claimed_by_user: e2e.id, lease_until: expect.any(String) })
    })

    it("AC7 — should publish the imported draft by the administration connection: revision + 1, draft blocks published", async () => {
      const grille = await fx.nodeId(copy.id, "conseil/grille_tarifaire")
      const pending = await one(admin`select base_revision, title from platform.node_drafts where node_id = ${grille}`, "draft")
      const current = await one(admin<{ revision: number }[]>`select revision from platform.nodes where id = ${grille}`, "node")
      expect(pending).toEqual({ base_revision: current.revision, title: "Grille tarifaire 2027" })
      const published = await one(admin<{ revision: number }[]>`select platform.publish_node(${grille}, ${current.revision}, null::jsonb) as revision`, "publish_node")
      expect(published.revision).toBe(current.revision + 1)
      const after = await admin<{ state: string; text: string | null }[]>`select state, text from platform.blocks where node_id = ${grille}`
      expect(after.map((row) => row.state)).not.toContain("draft")
      expect(after.map((row) => row.text)).toContain("Pré-étude : 1 800 € HT.")
      expect(await admin`select node_id from platform.node_drafts where node_id = ${grille}`).toEqual([])
      expect(await admin`select title from platform.nodes where id = ${grille}`).toEqual([{ title: "Grille tarifaire 2027" }])
    })

    it("AC7 — should let an admin of the copy find a copied block and row, search columns recomputed", async () => {
      const person = await fx.createUser()
      await fx.addMember(copy.id, person.id, { role: "admin" })
      const search = (query: string) =>
        asCaller(person.id, person.email).tx((sql) => sql`select * from platform.search_content(p_org => ${copy.id}, p_query => ${query})`)
      expect(await search("Tilleuls")).toEqual(expect.arrayContaining([expect.objectContaining({ match: "block", block_type: "row", block_key: "P-001" })]))
      expect(await search("autoconsommation")).toEqual(expect.arrayContaining([expect.objectContaining({ match: "block", path: "contexte" })]))
    })

    it("AC7 — should raise rules_version by one per Contexte version inserted", async () => {
      const contexts = new Set(rows(sourceDoc, "nodes").filter((row) => row.kind === "context").map((row) => row.id))
      const inserted = rows(sourceDoc, "node_versions").filter((row) => contexts.has(row.node_id)).length
      expect(inserted).toBeGreaterThan(0)
      expect(await fx.rulesVersion(copy.id)).toBe(Number(rows(sourceDoc, "orgs")[0].rules_version) + inserted)
    })

    it("AC8 — should give the source and its copy the same fingerprint", () => {
      const now = new Date()
      expect(fingerprint(copyDoc, now)).toEqual(fingerprint(sourceDoc, now))
    })

    it("AC-e4 (E10-S02) — should carry the ready files only, under new ids cited by the blocks and snapshots of the copy, their bytes under <new org>/<new id>", () => {
      const cited = (doc: ExportFile) => {
        const offre = node(doc, "conseil/offre")?.id
        const block = rows(doc, "blocks").find((row) => row.node_id === offre && row.state === "published" && row.type === "file")
        const version = rows(doc, "node_versions").find((row) => row.node_id === offre)
        const entries = (Array.isArray(version?.blocks) ? version.blocks : []) as { type?: string; data?: { file_id?: string } }[]
        return { block: (block?.data as { file_id?: string } | undefined)?.file_id, snapshot: entries.find((entry) => entry.type === "file")?.data?.file_id }
      }
      const files = (doc: ExportFile) => rows(doc, "files").map((row) => ({ id: String(row.id), name: row.name, status: row.status, node: row.node_id, origin: [row.origin_kind, row.origin_function, row.origin_by, row.origin_at] }))
      const [copied] = files(copyDoc)
      const written = (file: string, id: string) => fs.readFileSync(path.join(filesDir(file), id), "utf8")
      expect({
        source: files(sourceDoc).map(({ id, name, status }) => [id, name, status]),
        copy: files(copyDoc).map(({ name, status }) => [name, status]),
        // L'origine (fichiers et stockage, § Origine d'un fichier) : la sorte, la fonction, l'auteur et la date de la source.
        origin: copied?.origin,
        sameOriginDate: copied?.origin[3] === files(sourceDoc)[0]?.origin[3],
        newId: copied?.id !== sourceFileId,
        node: copied?.node === node(copyDoc, "conseil/offre")?.id,
        sourceCited: cited(sourceDoc),
        copyCited: cited(copyDoc),
        exported: exported.stdout.includes(`Fichiers joints : 1 objets écrits dans ${filesDir(sourceFile)}.`),
        imported: imported.stdout.includes("Fichiers joints : 1 objets envoyés au stockage."),
        sourceBytes: written(sourceFile, sourceFileId),
        copyObject: s3.object(copy.id, copied?.id ?? ""),
        copyBytes: written(copyFile, copied?.id ?? ""),
      }).toEqual({
        source: [[sourceFileId, "offre.pdf", "ready"]],
        copy: [["offre.pdf", "ready"]],
        origin: ["function", "devis.render", e2e.id, expect.any(String)],
        sameOriginDate: true,
        newId: true,
        node: true,
        sourceCited: { block: sourceFileId, snapshot: sourceFileId },
        copyCited: { block: copied?.id, snapshot: copied?.id },
        exported: true,
        imported: true,
        sourceBytes: "pdf",
        copyObject: "pdf",
        copyBytes: "pdf",
      })
    })

    describe("without storage, an organization or a file that carries ready files (AC-e4)", () => {
      const target = org()
      const out = path.join(dir, "sans-stockage.org-export.json")
      let refusedExport: Outcome
      let refusedImport: Outcome

      beforeAll(async () => {
        slugs.push(target.slug)
        refusedExport = await script("org-export.mjs", ["--org", source.slug, "--out", out], NO_STORAGE)
        refusedImport = await script("org-import.mjs", ["--in", sourceFile, "--slug", target.slug, "--prefix", target.prefix], NO_STORAGE)
      }, TIMEOUT)

      it("AC-e4 — should stop the export before any write, naming the five variables", () => {
        expect(refusedExport).toMatchObject({ code: 1, stderr: expect.stringContaining(`Posez ${STORAGE_VARIABLES.join(", ")}, puis relancez.`) })
        expect({ json: fs.existsSync(out), objects: fs.existsSync(filesDir(out)) }).toEqual({ json: false, objects: false })
      })

      it("AC-e4 — should stop the import before any write, naming the five variables, the organization absent", async () => {
        expect(refusedImport).toMatchObject({ code: 1, stderr: expect.stringContaining(`Posez ${STORAGE_VARIABLES.join(", ")}, puis relancez.`) })
        expect(await orgId(target.slug)).toBeNull()
      })
    })

    it("AC13 — should pose the --domain addresses only, and import the pending invitation", () => {
      expect(rows(copyDoc, "org_domains").map((row) => row.host)).toEqual([copy.host])
      expect(rows(copyDoc, "invitations").map((row) => row.email)).toEqual([pendingEmail])
    })

    // AC9 (sauts en cascade) et le remplacement par l'auteur par défaut (AC10) sont prouvés par
    // `planImport` en unitaire (`testing-strategy.md § Budget de tests`) ; ici, ce que seul le script
    // fait : rapprocher les personnes de la cible et s'arrêter avant toute écriture.
    describe("with a person absent from the target (AC10)", () => {
      const absent = `absent-${hex(6)}@example.invalid`
      const target = org()
      const tampered = path.join(dir, "absent.org-export.json")
      let required: Outcome
      let unknown: Outcome

      beforeAll(async () => {
        slugs.push(target.slug)
        const doc = readExport(sourceFile)
        doc.people = doc.people.map((person) => (person.id === q.id ? { ...person, email: absent } : person))
        fs.writeFileSync(tampered, JSON.stringify(doc))
        const args = ["--in", tampered, "--slug", target.slug, "--prefix", target.prefix]
        required = await script("org-import.mjs", args)
        unknown = await script("org-import.mjs", [...args, "--auteur-par-defaut", `test-${hex(6)}@example.invalid`])
      }, TIMEOUT)

      it("AC10 — should stop before any write without a default author, and refuse an unknown one", async () => {
        expect(required).toMatchObject({
          code: 1,
          stderr: expect.stringContaining(`Auteur par défaut requis : 1 lignes ont pour auteur une personne absente (${absent}). Relancez avec --auteur-par-defaut <email>.`),
        })
        expect(unknown).toMatchObject({ code: 1, stderr: expect.stringContaining("Auteur par défaut inconnu : test-") })
        // « Import annulé » dirait une écriture suivie de son annulation, pas un arrêt avant d'écrire.
        expect(required.stderr).not.toContain("Import annulé")
        expect(unknown.stderr).not.toContain("Import annulé")
        expect(await orgId(target.slug)).toBeNull()
      })
    })

    describe("refusals before any write, and the rollback (AC11, AC12, AC13)", () => {
      const fresh = org()
      const corrupted = org()
      const served = org()
      const marker = `t${hex(6)}`
      let samePrefix: Outcome
      let rolledBack: Outcome
      let taken: Outcome
      let unmarked: Outcome
      let before: unknown
      let after: unknown

      /** Lignes de la seconde organisation, sans marque de démonstration : identiques après un refus. */
      async function otherRows() {
        return {
          org: await one(admin`select * from platform.orgs where id = ${other.id}`, "other org"),
          members: [...(await admin`select * from platform.members where org_id = ${other.id} order by user_id`)],
          nodes: [...(await admin`select id, path, title, revision, updated_at from platform.nodes where org_id = ${other.id} order by path`)],
          blocks: [...(await admin`select id, state, text, updated_at from platform.blocks where org_id = ${other.id} order by id`)],
        }
      }

      beforeAll(async () => {
        slugs.push(fresh.slug, corrupted.slug, served.slug)
        before = await otherRows()
        unmarked = await script("org-import.mjs", ["--in", sourceFile, "--slug", other.slug, "--prefix", fresh.prefix])
        after = await otherRows()
        samePrefix = await script("org-import.mjs", ["--in", sourceFile, "--slug", fresh.slug, "--prefix", source.prefix])
        taken = await script("org-import.mjs", ["--in", sourceFile, "--slug", served.slug, "--prefix", served.prefix, "--domain", `${source.slug}.localhost`])
        const doc = readExport(sourceFile)
        const page = node(doc, "conseil/grille_tarifaire")
        const row = rows(doc, "blocks").find((block) => block.type === "row")
        if (!page || !row) throw new Error("fixture: grille or row missing")
        row.node_id = page.id
        const conseil = node(doc, "conseil")
        if (conseil) conseil.title = marker
        const file = path.join(dir, "corrupted.org-export.json")
        fs.writeFileSync(file, JSON.stringify(doc))
        rolledBack = await script("org-import.mjs", ["--in", file, "--slug", corrupted.slug, "--prefix", corrupted.prefix])
      }, TIMEOUT)

      it("AC11 — should refuse a slug or a prefix already taken, writing nothing, the other organization's rows identical after", async () => {
        expect(unmarked).toMatchObject({ code: 1, stderr: expect.stringContaining(other.slug) })
        expect(after).toEqual(before)
        expect(samePrefix).toMatchObject({ code: 1, stderr: expect.stringContaining(source.prefix) })
        expect(await orgId(fresh.slug)).toBeNull()
      })

      it("AC12 — should delete the organization it created when an insertion fails", async () => {
        expect(rolledBack).toMatchObject({
          code: 1,
          stderr: expect.stringContaining(`Import annulé : blocks : 23514. L'organisation ${corrupted.slug} a été supprimée.`),
        })
        expect(await orgId(corrupted.slug)).toBeNull()
        expect(await admin`select id from platform.nodes where title = ${marker}`).toEqual([])
      })

      it("AC13 — should refuse an address already served, before any write", async () => {
        expect(taken).toMatchObject({ code: 1, stderr: expect.stringContaining(`${source.slug}.localhost`) })
        expect(taken.stderr).not.toContain("Import annulé")
        expect(await orgId(served.slug)).toBeNull()
      })
    })
  },
)

// Délai de la suite : la lecture de la spécification OpenAPI a pris 38 s sous charge (HN-E09S04-22).
describe.skipIf(!sqlConfigured)(
  portable("org transfer map against the database (AC14)"),
  { timeout: TIMEOUT },
  () => {
    it("should match the platform tables of the project, the tables never exported aside, column by column, the null policy on nullable columns only", async (ctx) => {
      // Une migration du dépôt que le projet n'a pas encore (E01-S11) : la carte la devance jusqu'à la fusion.
      const pending = await pendingMigrations()
      ctx.skip(pending.length > 0, pendingReason(pending))
      const tables = await platformTables()
      expect(Object.keys(tables).sort()).toEqual([...TABLES.map((spec) => spec.name), ...NEVER_EXPORTED].sort())
      for (const spec of TABLES) {
        expect({ table: spec.name, columns: [...(tables[spec.name]?.columns ?? [])].sort() }).toEqual({
          table: spec.name,
          columns: [...spec.columns, ...spec.excluded].sort(),
        })
        expect({ table: spec.name, key: tables[spec.name]?.primaryKey }).toEqual({ table: spec.name, key: spec.key })
      }
      // Une politique `null` sur une colonne `not null` ferait échouer l'import d'une personne absente.
      const wrong = TABLES.flatMap((spec) =>
        Object.entries(spec.people)
          .filter(([column, policy]) => policy === "null" && tables[spec.name]?.required.includes(column))
          .map(([column]) => `${spec.name}.${column}`),
      )
      expect(wrong).toEqual([])
    })
  },
)
