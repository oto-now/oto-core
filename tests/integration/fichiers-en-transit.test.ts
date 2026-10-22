// @vitest-environment node
// Le fichier en transit sur une vraie base (fichiers et stockage, § Fichier en transit ; décision d'Alexis du 19/10) : la
// garde « son auteur seul, et le moteur sous son identité » décidée par le service et doublée par la RLS, contre une
// autre personne de son équipe, un administrateur et l'équipe plateforme ; l'échéance, à 24 h de la création par
// l'horloge de la base, la garde refusant l'ancienne heure (décision du 21/10), puis échue (illisible, hors quota,
// purgée à l'entrée suivante, objet compris) ; le quota de l'organisation, qui compte un fichier en transit que la RLS cache aux
// autres, puis le libère ; 50 Mo pour tout type, un export CSV de plus de 4 Mo compris, qu'un fichier joint refuse. La
// base est le sujet : RLS, `org_files_bytes`, `purge_transit_files`. Le bucket est
// l'adaptateur en mémoire. Organisation de référence jetable (H120). Suite portable.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { registerOrgLimits, resolveIdentity, type Identity, type PlatformDb } from "@otomata_tech/oto_platform/server"
import { memoryFileStore, type MemoryFileStore } from "../../packages/plateforme/server/files/memory"
import { fileReadUrl } from "../../packages/plateforme/server/files/address"
import { requestFileUpload } from "../../packages/plateforme/server/files/service"
import { objectKey } from "../../packages/plateforme/server/files/store"
import { readCallerBytes } from "../../packages/plateforme/server/files/caller-file"
import {
  completeTransitUpload,
  expireTransitFile,
  requestTransitUpload,
  TRANSIT_HOURS,
} from "../../packages/plateforme/server/files/transit"
import { orgRowsSql, TABLES } from "../../scripts/lib/org-transfer.mjs"
import { pendingMigrations } from "../helpers/pending-migrations"
import { createSqlFixtures, SQL_SKIP_REASON, sqlConfigured, type SqlFixtures, type SqlReferenceOrg } from "../helpers/sql"

const storage = vi.hoisted(() => ({ store: null as MemoryFileStore | null }))

vi.mock("../../packages/plateforme/server/files/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../packages/plateforme/server/files/store")>()),
  fileStore: () => storage.store,
}))

const VERSION = "20261019090000"
const pending = (await pendingMigrations()).includes(VERSION)
const NETWORK_TIMEOUT = 60_000
const SETUP_TIMEOUT = 180_000
const SUITE = "transit files on a real database"

type Person = "ada" | "claire" | "lea" | "s"
type Session = { db: PlatformDb; identity: Identity }

const bytesOf = (text: string) => new TextEncoder().encode(text)

/** L'issue d'un appel : ce qu'il rend, ou le code de son refus. */
const codeOf = (run: Promise<unknown>): Promise<string> =>
  run.then(
    () => "ok",
    (error: { code?: string }) => error.code ?? "error",
  )

const skipReason = !sqlConfigured ? SQL_SKIP_REASON : `skipped: migration ${VERSION} not applied`

describe.skipIf(!sqlConfigured || pending)(sqlConfigured && !pending ? SUITE : `${SUITE} (${skipReason})`, { timeout: NETWORK_TIMEOUT }, () => {
  let fx: SqlFixtures
  let o: SqlReferenceOrg
  let memory: MemoryFileStore
  const sessions = new Map<Person, Session>()

  beforeAll(async () => {
    fx = createSqlFixtures()
    o = await fx.buildReferenceOrg()
    // `s` : l'équipe plateforme, avec un accès en cours à l'organisation, sans en être membre.
    const sam = await fx.createUser({ fullName: "Sam Staff" })
    await fx.makeStaff(sam.id)
    await fx.grantPlatformAccess(o.org.id, sam.id, null)
    for (const [person, user] of [["ada", o.people.ada], ["claire", o.people.claire], ["lea", o.people.lea], ["s", sam]] as const) {
      const db = fx.as(user)
      sessions.set(person, { db, identity: await resolveIdentity(db, o.host, { userId: user.id, email: user.email }) })
    }
    memory = memoryFileStore()
    storage.store = memory
  }, SETUP_TIMEOUT)

  afterEach(() => {
    registerOrgLimits(null)
    vi.restoreAllMocks()
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

  /** Un fichier en transit de `person`, déposé en trois temps comme le ferait son navigateur. */
  async function deposit(person: Person, name: string, text: string, mime = "application/pdf"): Promise<{ id: string; expiresAt: string }> {
    const { db, identity } = as(person)
    const requested = await requestTransitUpload(db, identity, { name, mime: "", size: bytesOf(text).byteLength })
    const sent = await memory.fetch(requested.upload.url, { method: "PUT", headers: requested.upload.headers, body: bytesOf(text) })
    expect(sent.status).toBe(200)
    const done = await completeTransitUpload(db, identity, requested.id)
    expect(done).toEqual({ id: requested.id, name, size: bytesOf(text).byteLength, mime, expiresAt: requested.expiresAt })
    return { id: requested.id, expiresAt: requested.expiresAt }
  }

  /** Les lignes `files` que `person` voit sous la RLS, par identifiant. */
  const seen = (person: Person, id: string) => as(person).db.tx((sql) => sql`select id from platform.files where id = ${id}`)

  /** Ce que la base compte au quota de l'organisation, lu sous la session de `person`. */
  const used = async (person: Person) => Number((await as(person).db.tx((sql) => sql<{ used: string }[]>`select platform.org_files_bytes(${o.org.id})::text as used`))[0].used)

  it("should let its author and the engine read a transit file, and refuse a teammate, an administrator and the platform team, by the service and by the row level security", async () => {
    vi.stubGlobal("fetch", memory.fetch)
    const { id } = await deposit("lea", "facture.pdf", "%PDF-transit")
    const lea = as("lea")

    // À son adresse, `/f/<id>`, comme un fichier joint ; téléchargé même sur « Voir » (décision du 19/10).
    const author = await fileReadUrl(lea.db, lea.identity, id, { disposition: "inline" })
    const engine = await readCallerBytes(lea.db, lea.identity, id)
    const refusedTo = async (person: Exclude<Person, "lea">) => {
      const { db, identity } = as(person)
      return {
        read: await codeOf(fileReadUrl(db, identity, id, {})),
        engine: await codeOf(readCallerBytes(db, identity, id)),
        complete: await codeOf(completeTransitUpload(db, identity, id)),
        expire: await codeOf(expireTransitFile(db, identity, id)),
        rows: (await seen(person, id)).length,
      }
    }
    expect({
      author: new URL(author).searchParams.get("response-content-disposition"),
      engine: { name: engine.name, mime: engine.mime, text: new TextDecoder().decode(engine.bytes) },
      authorRows: (await seen("lea", id)).length,
      teammate: await refusedTo("claire"),
      administrator: await refusedTo("ada"),
      platformTeam: await refusedTo("s"),
    }).toEqual({
      author: "attachment; filename*=UTF-8''facture.pdf",
      engine: { name: "facture.pdf", mime: "application/pdf", text: "%PDF-transit" },
      authorRows: 1,
      teammate: { read: "not_found", engine: "not_found", complete: "not_found", expire: "not_found", rows: 0 },
      administrator: { read: "not_found", engine: "not_found", complete: "not_found", expire: "not_found", rows: 0 },
      platformTeam: { read: "not_found", engine: "not_found", complete: "not_found", expire: "not_found", rows: 0 },
    })
    // Les refus n'ont rien effacé : l'auteur le lit encore.
    expect(await codeOf(readCallerBytes(lea.db, lea.identity, id))).toBe("ok")
  })

  it("should set the expiry of a transit file 24 hours after its creation by the database clock, and refuse the former hour (42501)", async () => {
    vi.stubGlobal("fetch", memory.fetch)
    const { id, expiresAt } = await deposit("lea", "duree.pdf", "%PDF-duree")
    const [{ stored, ...row }] = await fx.admin<{ day: boolean; seconds: number; stored: string }[]>`
      select expires_at - created_at = interval '24 hours' as day, extract(epoch from expires_at - created_at)::int as seconds,
             to_json(expires_at) #>> '{}' as stored
        from platform.files where id = ${id}`
    // La garde de la base (`files_expires_at_clock`), sous la session de l'auteur : l'échéance d'une heure d'avant le
    // 21/10 est refusée, comme toute autre que celle de `TRANSIT_HOURS`.
    const lea = as("lea")
    const formerHour = await lea.db
      .tx((sql) => sql`
        insert into platform.files (org_id, node_id, name, mime, size, status, created_by, expires_at)
        values (${o.org.id}, null, 'ancienne.pdf', 'application/pdf', 3, 'pending', ${o.people.lea.id}, now() + interval '1 hour')`)
      .then(
        () => null,
        (error: { code?: string; message: string }) => ({ code: error.code, message: error.message }),
      )
    expect({ hours: TRANSIT_HOURS, ...row, served: Date.parse(expiresAt) === Date.parse(stored), formerHour }).toEqual({
      hours: 24,
      day: true,
      seconds: 86_400,
      served: true,
      formerHour: { code: "42501", message: "platform.files.expires_at is set by the database clock: now() + 24 hours" },
    })
  })

  it("should make an expired transit file unreadable and out of the quota at once, then purge its row and object at the next entry in transit", async () => {
    vi.stubGlobal("fetch", memory.fetch)
    const { id } = await deposit("lea", "releve.pdf", "%PDF-echu")
    const lea = as("lea")
    const counted = await used("claire")
    await fx.admin`update platform.files set expires_at = now() - interval '1 second' where id = ${id}`

    const expired = {
      read: await codeOf(fileReadUrl(lea.db, lea.identity, id, {})),
      engine: await codeOf(readCallerBytes(lea.db, lea.identity, id)),
      freed: counted - (await used("claire")),
      rowKept: (await fx.admin`select id from platform.files where id = ${id}`).length,
    }
    // Une autre personne fait entrer un fichier en transit : la purge emporte l'échu de Léa, qu'elle ne voit pas.
    const other = await deposit("claire", "autre.pdf", "%PDF-autre")
    expect({
      ...expired,
      rowPurged: (await fx.admin`select id from platform.files where id = ${id}`).length,
      objectPurged: !memory.objects.has(objectKey(o.org.id, id)),
      otherKept: memory.objects.has(objectKey(o.org.id, other.id)),
    }).toEqual({ read: "not_found", engine: "not_found", freed: "%PDF-echu".length, rowKept: 1, rowPurged: 0, objectPurged: true, otherKept: true })
  })

  it("should count a transit file in the quota of the organisation for everyone, then free it once consumed", async () => {
    vi.stubGlobal("fetch", memory.fetch)
    await fx.createNode(o.org.id, { parentId: o.nodes.ventes, path: "ventes/t_quota", title: "Quota" })
    const claire = as("claire")
    const start = await used("claire")
    registerOrgLimits({ read: ({ id }) => (id === o.org.id ? { storage_bytes: start + 12 } : null) })

    const { id } = await deposit("lea", "export.pdf", "%PDF-0123")
    const attach = () => codeOf(requestFileUpload(claire.db, claire.identity, { node: "ventes/t_quota", name: "piece.pdf", mime: "", size: 5 }))
    const counted = { claire: await used("claire"), ada: await used("ada"), refused: await attach() }
    await expireTransitFile(as("lea").db, as("lea").identity, id)
    expect({
      ...counted,
      freed: await used("claire"),
      objectGone: !memory.objects.has(objectKey(o.org.id, id)),
      accepted: await attach(),
    }).toEqual({ claire: start + 9, ada: start + 9, refused: "too_large", freed: start, objectGone: true, accepted: "ok" })
  })

  it("should admit a text file up to 50 MB in transit, a CSV export over the 4 MB of an attached text file included", async () => {
    vi.stubGlobal("fetch", memory.fetch)
    await fx.createNode(o.org.id, { parentId: o.nodes.ventes, path: "ventes/t_csv", title: "CSV" })
    const lea = as("lea")
    const csv = `id;montant\n${"1;42\n".repeat(1_250_000)}`
    const { id } = await deposit("lea", "export.csv", csv, "text/csv")
    const engine = await readCallerBytes(lea.db, lea.identity, id)
    const request = (size: number) => codeOf(requestTransitUpload(lea.db, lea.identity, { name: "gros.csv", mime: "", size }))
    expect({
      size: engine.size > 4 * 1024 * 1024,
      bytes: engine.bytes.byteLength === bytesOf(csv).byteLength,
      attached: await codeOf(requestFileUpload(lea.db, lea.identity, { node: "ventes/t_csv", name: "export.csv", mime: "", size: engine.size })),
      atBound: await request(50 * 1024 * 1024),
      overBound: await request(50 * 1024 * 1024 + 1),
    }).toEqual({ size: true, bytes: true, attached: "too_large", atBound: "ok", overBound: "too_large" })
    await expireTransitFile(lea.db, lea.identity, id)
  })

  it("should leave a transit file out of the export of the organisation, and keep a ready attached file in it", async () => {
    const node = await fx.createNode(o.org.id, { parentId: o.nodes.ventes, path: "ventes/t_export", title: "Export" })
    const [attached] = await fx.admin<{ id: string }[]>`
      insert into platform.files (org_id, node_id, name, mime, size, status, created_by)
      values (${o.org.id}, ${node}, 'joint.pdf', 'application/pdf', 3, 'ready', ${o.people.lea.id}) returning id`
    const { id: transit } = await deposit("lea", "transit.pdf", "%PDF")
    const spec = TABLES.find((table) => table.name === "files")
    if (!spec) throw new Error("files is not in the transfer map")
    const exported = (await fx.admin<{ id: string }[]>`select id from platform.files where ${orgRowsSql(fx.admin, spec, o.org.id)}`).map((row) => row.id)
    expect({ attached: exported.includes(attached.id), transit: exported.includes(transit) }).toEqual({ attached: true, transit: false })
  })

  it("should refuse to sum the files of an organisation the caller is not a member of", async () => {
    const other = await fx.createOrg()
    expect(await codeOf(as("claire").db.tx((sql) => sql`select platform.org_files_bytes(${other.id})`))).toBe("42501")
    expect(await codeOf(as("claire").db.tx((sql) => sql`select * from platform.purge_transit_files(${other.id})`))).toBe("42501")
  })
})
