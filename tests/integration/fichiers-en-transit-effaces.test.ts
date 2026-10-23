// @vitest-environment node
// La trace d'un fichier en transit effacé sur une vraie base (fichiers et stockage, § Adresse unique et lecture d'un
// fichier en transit ; 30 jours, décision d'Alexis du 21/10) : consommé ou échu, il laisse une trace qui ne garde que
// l'identifiant, l'auteur, la date et la cause, lue par son seul auteur ; son adresse, sa disponibilité et le moteur
// le lui refusent avec la date et quoi faire, et à tout autre comme un identifiant faux. Une ligne `pending` n'en
// laisse aucune ; une trace de plus de 30 jours n'est plus lue, puis part à la purge suivante ; une personne retirée de
// l'organisation, ou oubliée, emporte les siennes et n'en reçoit plus. La base est le sujet : `erased_files`, son
// déclencheur, sa RLS, `purge_transit_files`. Le bucket est l'adaptateur en mémoire. Suite portable.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { resolveIdentity, type Identity, type PlatformDb } from "@otomata_tech/oto_platform/server"
import { fileAvailability, fileReadUrl } from "../../packages/plateforme/server/files/address"
import { memoryFileStore, type MemoryFileStore } from "../../packages/plateforme/server/files/memory"
import { readCallerBytes } from "../../packages/plateforme/server/files/caller-file"
import { completeTransitUpload, expireTransitFile, purgeTransitFiles, requestTransitUpload } from "../../packages/plateforme/server/files/transit"
import { pendingMigrations } from "../helpers/pending-migrations"
import { createSqlFixtures, SQL_SKIP_REASON, sqlConfigured, type SqlFixtures, type SqlReferenceOrg } from "../helpers/sql"

const storage = vi.hoisted(() => ({ store: null as MemoryFileStore | null }))

vi.mock("../../packages/plateforme/server/files/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../packages/plateforme/server/files/store")>()),
  fileStore: () => storage.store,
}))

const VERSION = "20261023120000" // 20261023120000_v1_6_0.sql, partie écrite en 20261021190000
const pending = (await pendingMigrations()).includes(VERSION)
const NETWORK_TIMEOUT = 60_000
const SETUP_TIMEOUT = 180_000
const SUITE = "trace of an erased transit file on a real database"

type Session = { db: PlatformDb; identity: Identity }

const bytesOf = (text: string) => new TextEncoder().encode(text)

/** Le refus d'un appel : son code, son texte et sa raison ; `ok` s'il passe. */
const refusalOf = (run: Promise<unknown>) =>
  run.then(
    () => "ok",
    (error: { code?: string; message: string; details?: { reason?: string } }) => ({ code: error.code, message: error.message, reason: error.details?.reason ?? null }),
  )

/** Le refus d'un fichier effacé, à la minute de `at` (UTC). */
const erased = (id: string, at: string, cause: string) => ({
  code: "not_found",
  message: `File ${id} was deleted on ${at.slice(0, 16).replace("T", " ")} UTC (${cause}): run the function that produced it again, or upload it again.`,
  reason: "file_erased",
})

const UNKNOWN = { code: "not_found", message: "Unknown file.", reason: null }
const SENT = "sent to a third party"
const EXPIRED = "its 24 hours in transit ran out"

const skipReason = !sqlConfigured ? SQL_SKIP_REASON : `skipped: migration ${VERSION} not applied`

describe.skipIf(!sqlConfigured || pending)(sqlConfigured && !pending ? SUITE : `${SUITE} (${skipReason})`, { timeout: NETWORK_TIMEOUT }, () => {
  let fx: SqlFixtures
  let o: SqlReferenceOrg
  let memory: MemoryFileStore
  let lea: Session
  let claire: Session

  async function sessionOf(user: { id: string; email: string }): Promise<Session> {
    const db = fx.as(user)
    return { db, identity: await resolveIdentity(db, o.host, { userId: user.id, email: user.email }) }
  }

  beforeAll(async () => {
    fx = createSqlFixtures()
    o = await fx.buildReferenceOrg()
    lea = await sessionOf(o.people.lea)
    claire = await sessionOf(o.people.claire)
    memory = memoryFileStore()
    storage.store = memory
  }, SETUP_TIMEOUT)

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  afterAll(async () => {
    await fx?.cleanup()
  }, SETUP_TIMEOUT)

  /** Un fichier en transit `ready` de `who`. */
  async function deposit(who: Session, text = "%PDF-transit"): Promise<string> {
    const requested = await requestTransitUpload(who.db, who.identity, { name: "piece.pdf", mime: "", size: bytesOf(text).byteLength })
    await memory.fetch(requested.upload.url, { method: "PUT", headers: requested.upload.headers, body: bytesOf(text) })
    await completeTransitUpload(who.db, who.identity, requested.id)
    return requested.id
  }

  /** La trace de `id`, lue par la connexion d'administration. */
  const traceOf = async (id: string) =>
    (await fx.admin<{ created_by: string; cause: string; erased_at: string; keep_until: string }[]>`
      select created_by, cause, to_json(erased_at) #>> '{}' as erased_at, to_json(keep_until) #>> '{}' as keep_until
        from platform.erased_files where id = ${id}`)[0] ?? null

  /** Les traces que `who` lit sous la RLS. */
  const seen = (who: Session, id: string) => who.db.tx((sql) => sql`select id from platform.erased_files where id = ${id}`)

  it("should keep only the id, the organisation, the author, the date, the cause and the end of a trace", async () => {
    const columns = await fx.admin<{ column_name: string }[]>`
      select column_name from information_schema.columns where table_schema = 'platform' and table_name = 'erased_files' order by ordinal_position`
    expect(columns.map((column) => column.column_name)).toEqual(["id", "org_id", "created_by", "erased_at", "cause", "keep_until"])
  })

  it("should trace a consumed transit file for 30 days, read by its author alone, and refuse her its address, its availability and the engine with the date and what to do", async () => {
    vi.stubGlobal("fetch", memory.fetch)
    const id = await deposit(lea)
    await expireTransitFile(lea.db, lea.identity, id)
    const trace = await traceOf(id)
    const days = trace ? (Date.parse(trace.keep_until) - Date.parse(trace.erased_at)) / 86_400_000 : null

    expect({ cause: trace?.cause, author: trace?.created_by, days }).toEqual({ cause: "consumed", author: o.people.lea.id, days: 30 })
    const refusal = erased(id, trace?.erased_at ?? "", SENT)
    expect({
      read: await refusalOf(fileReadUrl(lea.db, lea.identity, id, {})),
      check: await refusalOf(fileAvailability(lea.db, lea.identity, id)),
      engine: await refusalOf(readCallerBytes(lea.db, lea.identity, id)),
      teammate: await refusalOf(fileReadUrl(claire.db, claire.identity, id, {})),
      seenByAuthor: (await seen(lea, id)).length,
      seenByTeammate: (await seen(claire, id)).length,
    }).toEqual({ read: refusal, check: refusal, engine: refusal, teammate: UNKNOWN, seenByAuthor: 1, seenByTeammate: 0 })
  })

  it("should date an expired transit file at its expiry, before its purge and after it", async () => {
    vi.stubGlobal("fetch", memory.fetch)
    const id = await deposit(lea)
    const [{ expires_at: expiresAt }] = await fx.admin<{ expires_at: string }[]>`
      update platform.files set expires_at = now() - interval '1 hour' where id = ${id} returning to_json(expires_at) #>> '{}' as expires_at`

    const before = await refusalOf(fileReadUrl(lea.db, lea.identity, id, {}))
    // Une autre personne fait entrer un fichier en transit : la purge emporte l'échu de Léa et laisse sa trace.
    await purgeTransitFiles(claire.db, claire.identity)
    const trace = await traceOf(id)

    expect({ before, after: await refusalOf(fileReadUrl(lea.db, lea.identity, id, {})), cause: trace?.cause, at: trace && Date.parse(trace.erased_at) }).toEqual({
      before: erased(id, expiresAt, EXPIRED),
      after: erased(id, expiresAt, EXPIRED),
      cause: "expired",
      at: Date.parse(expiresAt),
    })
  })

  it("should leave no trace of a pending transit file deleted", async () => {
    const requested = await requestTransitUpload(lea.db, lea.identity, { name: "jamais.pdf", mime: "", size: 4 })
    await expireTransitFile(lea.db, lea.identity, requested.id)

    expect({ trace: await traceOf(requested.id), read: await refusalOf(fileReadUrl(lea.db, lea.identity, requested.id, {})) }).toEqual({ trace: null, read: UNKNOWN })
  })

  it("should no longer read a trace past its 30 days, then delete it at the next purge", async () => {
    vi.stubGlobal("fetch", memory.fetch)
    const id = await deposit(lea)
    await expireTransitFile(lea.db, lea.identity, id)
    await fx.admin`update platform.erased_files set keep_until = now() - interval '1 second' where id = ${id}`

    const read = await refusalOf(fileReadUrl(lea.db, lea.identity, id, {}))
    await purgeTransitFiles(claire.db, claire.identity)

    expect({ read, trace: await traceOf(id) }).toEqual({ read: UNKNOWN, trace: null })
  })

  it("should take the traces of a person removed from the organisation or forgotten, and leave none for a person no longer a member", async () => {
    vi.stubGlobal("fetch", memory.fetch)
    const [removed, forgotten, gone] = await Promise.all([fx.createUser(), fx.createUser(), fx.createUser()])
    for (const user of [removed, forgotten, gone]) await fx.addMember(o.org.id, user.id)
    const traced = async (user: { id: string; email: string }) => {
      const session = await sessionOf(user)
      const id = await deposit(session)
      await expireTransitFile(session.db, session.identity, id)
      return id
    }
    const removedFile = await traced(removed)
    const forgottenFile = await traced(forgotten)
    const goneSession = await sessionOf(gone)
    const goneFile = await deposit(goneSession)
    const kept = { removed: (await traceOf(removedFile)) !== null, forgotten: (await traceOf(forgottenFile)) !== null }

    await fx.admin`delete from platform.members where org_id = ${o.org.id} and user_id = ${removed.id}`
    await fx.admin`select platform.forget_user(${forgotten.id})`
    await fx.admin`delete from platform.members where org_id = ${o.org.id} and user_id = ${gone.id}`
    await fx.admin`update platform.files set expires_at = now() - interval '1 second' where id = ${goneFile}`
    await purgeTransitFiles(claire.db, claire.identity)

    expect({
      kept,
      removed: await traceOf(removedFile),
      forgotten: await traceOf(forgottenFile),
      gone: await traceOf(goneFile),
      goneRow: (await fx.admin`select id from platform.files where id = ${goneFile}`).length,
    }).toEqual({ kept: { removed: true, forgotten: true }, removed: null, forgotten: null, gone: null, goneRow: 0 })
  })
})
