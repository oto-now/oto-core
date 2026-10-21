// @vitest-environment node
// Un fichier rendu par un tiers, rangé en fichier en transit de l'appelant, sur une vraie base (connecteurs et comptes,
// § Fichiers rendus par un tiers ; fichiers et stockage, § Fichier en transit). Le tiers est un serveur HTTP local : son
// API rend la fiche d'un appel, qui porte l'adresse signée de l'enregistrement, qu'il sert aussi. Le moteur le télécharge
// par le transport gardé (remplacé ici par un transport vers le serveur local, le poste n'ayant pas d'hôte public), le
// range sous l'identité de l'appelant, 24 h, sous le quota, et ne rend que son identifiant. La base est le sujet : la
// lecture réservée à l'auteur, l'échéance lue en base, le quota, aucune ligne partielle quand l'objet ne s'écrit pas, et
// le stockage absent refusé sans appeler le tiers. Organisation de référence jetable (H120). Suite portable.
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { registerOrgLimits, resolveIdentity, type Identity, type PlatformDb } from "@otomata_tech/oto_platform/server"
import { checkArguments } from "../../packages/plateforme/server/catalog/arguments"
import type { FunctionContext } from "../../packages/plateforme/server/catalog/define"
import { catalogFunctions, findFunction } from "../../packages/plateforme/server/catalog/registry"
import type { Fetch } from "../../packages/plateforme/server/connectors/http"
import { registerConnectors } from "../../packages/plateforme/server/connectors/declaration"
import { memoryFileStore, type MemoryFileStore } from "../../packages/plateforme/server/files/memory"
import { objectKey } from "../../packages/plateforme/server/files/store"
import { fileReadUrl } from "../../packages/plateforme/server/files/address"
import { readTransitBytes, TRANSIT_HOURS } from "../../packages/plateforme/server/files/transit"
import { fileConnector, memoryTokens } from "../factories/described-connector"
import { pendingMigrations } from "../helpers/pending-migrations"
import { createSqlFixtures, SQL_SKIP_REASON, sqlConfigured, type SqlFixtures, type SqlReferenceOrg } from "../helpers/sql"

const storage = vi.hoisted(() => ({ store: null as unknown, local: "", realFetch: globalThis.fetch.bind(globalThis) }))

vi.mock("../../packages/plateforme/server/files/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../packages/plateforme/server/files/store")>()),
  fileStore: () => storage.store,
}))

/** Le transport gardé vers le serveur local : l'adresse publique du tiers réécrite vers lui, rien d'autre. */
vi.mock("../../packages/plateforme/server/connectors/address-guard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../packages/plateforme/server/connectors/address-guard")>()),
  guardedFetch: (): Fetch => (input, init) => {
    if (!input.startsWith("https://files.example.test/")) throw new Error("the test only downloads from files.example.test")
    return storage.realFetch(input.replace("https://files.example.test", storage.local), init)
  },
}))

const VERSION = "20261021160000"
const pending = (await pendingMigrations()).includes(VERSION)
const NETWORK_TIMEOUT = 60_000
const SETUP_TIMEOUT = 180_000
const SUITE = "files returned by a third party on a real database"
const SIGNATURE = "SIGNEDTOKEN42"
const RECORDING = new Uint8Array(3000).map((_, at) => at % 251)

type Person = "ada" | "claire" | "lea"
type Session = { db: PlatformDb; identity: Identity }

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
  let server: Server
  /** Les chemins demandés au tiers, dans l'ordre. */
  const asked: string[] = []
  const sessions = new Map<Person, Session>()

  beforeAll(async () => {
    server = createServer((request, response) => {
      const path = request.url ?? ""
      asked.push(path.split("?")[0])
      const call = /^\/v2\/calls\/(\d+)$/.exec(path)
      if (call) {
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ call: { id: Number(call[1]), recording: `https://files.example.test/rec/${call[1]}.mp3?X-Signature=${SIGNATURE}` } }))
        return
      }
      if (path.startsWith("/rec/") && path.includes(`X-Signature=${SIGNATURE}`)) {
        response.writeHead(200, { "content-type": "audio/mpeg", "content-length": String(RECORDING.byteLength) })
        response.end(Buffer.from(RECORDING))
        return
      }
      response.writeHead(404)
      response.end()
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    storage.local = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    fx = createSqlFixtures()
    o = await fx.buildReferenceOrg()
    for (const [person, user] of [["ada", o.people.ada], ["claire", o.people.claire], ["lea", o.people.lea]] as const) {
      const db = fx.as(user)
      sessions.set(person, { db, identity: await resolveIdentity(db, o.host, { userId: user.id, email: user.email }) })
    }
    memory = memoryFileStore()
    storage.store = memory
    registerConnectors([fileConnector()])
  }, SETUP_TIMEOUT)

  afterEach(() => {
    storage.store = memory
    memory.failing.clear()
    registerOrgLimits(null)
    asked.length = 0
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  afterAll(async () => {
    registerConnectors([])
    await new Promise<void>((resolve) => server?.close(() => resolve()))
    await fx?.cleanup()
  }, SETUP_TIMEOUT)

  const as = (person: Person): Session => {
    const session = sessions.get(person)
    if (!session) throw new Error(`no session for ${person}`)
    return session
  }

  /** L'API du tiers vers le serveur local, le bucket en mémoire par ses propres adresses. */
  function thirdParty() {
    vi.stubGlobal("fetch", async (input: string | URL | Request, init: RequestInit = {}) => {
      const url = String(input instanceof Request ? input.url : input)
      if (url.startsWith("https://memory.invalid/")) return memory.fetch(input as string, init)
      if (!url.startsWith("https://crm.example.test/")) throw new Error(`unexpected address in the test: ${url.split("?")[0]}`)
      return storage.realFetch(url.replace("https://crm.example.test", storage.local), init)
    })
  }

  /** La fonction déclarée, appelée comme `call` l'appelle, sous la session de `person`. */
  async function recording(person: Person, callId: number) {
    const fn = findFunction(catalogFunctions(), "crm.get_call_recording")
    if (!fn) throw new Error("crm.get_call_recording is not declared")
    const checked = checkArguments(fn.schema, { call_id: callId })
    if (!checked.success) throw new Error("invalid test arguments")
    const { db, identity } = as(person)
    const context = { db, identity, account: { id: "account-1" }, credential: { fields: { api_key: "key_test" }, settings: {}, tokens: memoryTokens() } }
    return fn.run(context as unknown as FunctionContext, checked.data as never)
  }

  /** Les lignes `files` de l'organisation, vues par l'administration des tests. */
  const rows = () => fx.admin<{ id: string; status: string; hours: number }[]>`
    select id, status, extract(epoch from expires_at - created_at)::float8 / 3600 as hours from platform.files
     where org_id = ${o.org.id} and node_id is null order by created_at`

  /** Tout ce qui part au log serveur pendant le test. */
  function logs() {
    const spies = [vi.spyOn(console, "error"), vi.spyOn(console, "warn"), vi.spyOn(console, "log")]
    for (const spy of spies) spy.mockImplementation(() => undefined)
    return () => spies.flatMap((spy) => spy.mock.calls.map((call) => call.map(String).join(" "))).join("\n")
  }

  it("should keep the downloaded recording as a transit file of the caller for 24 hours, readable by the caller only, and serve its id without the address", async () => {
    thirdParty()
    const logged = logs()
    const before = (await rows()).length
    const output = await recording("lea", 987654321)
    const file = (output.data as { file: { id: string; name: string; mime: string; size: number; expires_at: string } }).file

    expect(asked).toEqual(["/v2/calls/987654321", "/rec/987654321.mp3"])
    expect({ name: file.name, mime: file.mime, size: file.size }).toEqual({ name: "call-987654321-recording.mp3", mime: "audio/mpeg", size: RECORDING.byteLength })
    expect(output.text).toBe(
      [
        `crm.get_call_recording: file ready: call-987654321-recording.mp3 (audio/mpeg, 2.9 KB), id ${file.id}, yours until ${file.expires_at.slice(0, 16).replace("T", " ")} UTC.`,
        "Pass this id as is to a function that takes a file; it is deleted once sent, or at that time.",
      ].join("\n"),
    )
    expect(`${output.text}${JSON.stringify(output.data)}${logged()}`).not.toContain(SIGNATURE)

    // L'échéance, lue en base : 24 heures après l'insertion, à l'horloge de la base.
    const kept = await rows()
    expect(kept).toHaveLength(before + 1)
    expect(kept.at(-1)).toEqual({ id: file.id, status: "ready", hours: TRANSIT_HOURS })
    expect(new Date(file.expires_at).getTime()).toBe(new Date((await fx.admin<{ at: Date }[]>`select expires_at as at from platform.files where id = ${file.id}`)[0].at).getTime())

    // Lisible par son auteur seul : ni un membre de son équipe, ni un administrateur.
    const lea = as("lea")
    const read = await readTransitBytes(lea.db, lea.identity, file.id)
    expect(Buffer.from(read.bytes).equals(Buffer.from(RECORDING))).toBe(true)
    expect(await codeOf(fileReadUrl(lea.db, lea.identity, file.id, {}))).toBe("ok")
    for (const person of ["claire", "ada"] as const) {
      const { db, identity } = as(person)
      expect({ person, read: await codeOf(readTransitBytes(db, identity, file.id)), url: await codeOf(fileReadUrl(db, identity, file.id, {})) }).toEqual({ person, read: "not_found", url: "not_found" })
    }
  })

  it("should refuse a recording beyond the quota of the organisation, with its reason, and keep nothing", async () => {
    thirdParty()
    const used = Number((await fx.admin<{ used: string }[]>`select coalesce(sum(size), 0)::text as used from platform.files where org_id = ${o.org.id} and (expires_at is null or expires_at > now())`)[0].used)
    registerOrgLimits({ read: ({ id }) => (id === o.org.id ? { storage_bytes: used + 100 } : null) })
    const before = await rows()
    const error = await recording("lea", 11).then(
      () => null,
      (reason: { code?: string; details?: Record<string, unknown> }) => reason,
    )
    expect({ code: error?.code, reason: error?.details?.reason }).toEqual({ code: "too_large", reason: "quota" })
    expect(await rows()).toEqual(before)
  })

  it("should leave no row nor object when the object cannot be written, and say the storage is unreachable", async () => {
    thirdParty()
    logs()
    memory.failing.add("put")
    const before = await rows()
    const error = await recording("lea", 12).then(
      () => null,
      (reason: { code?: string; message?: string }) => reason,
    )
    expect({ code: error?.code, message: error?.message }).toEqual({ code: "internal", message: "File storage unreachable. Retry later." })
    expect(await rows()).toEqual(before)
    expect([...memory.objects.keys()].filter((key) => key.startsWith(`${o.org.id}/`) && !before.some((row) => key === objectKey(o.org.id, row.id)))).toEqual([])
  })

  it("should refuse not_enabled without calling the third party when files are not enabled", async () => {
    thirdParty()
    storage.store = null
    expect(await codeOf(recording("lea", 13))).toBe("not_enabled")
    expect(asked).toEqual([])
  })
})
