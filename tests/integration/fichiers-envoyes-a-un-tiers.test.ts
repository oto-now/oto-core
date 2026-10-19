// @vitest-environment node
// Un fichier en transit envoyé à un tiers par une fonction décrite, sur une vraie base (connecteurs et comptes, § Fichiers
// envoyés à un tiers) : le moteur lit le fichier sous l'identité de l'appelant, jamais celui d'une autre personne de son
// équipe ni d'un administrateur ; il l'envoie en corps multipart et ne le consomme qu'après un appel réussi. La base est
// le sujet : la garde du fichier en transit (service et RLS) vue par le moteur, et sa consommation. Le tiers est un
// `fetch` simulé, le bucket l'adaptateur en mémoire. Organisation de référence jetable (H120). Suite portable.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { resolveIdentity, type Identity, type PlatformDb } from "@otomata_tech/oto_platform/server"
import { checkArguments } from "../../packages/plateforme/server/catalog/arguments"
import type { FunctionContext } from "../../packages/plateforme/server/catalog/define"
import { catalogFunctions, findFunction } from "../../packages/plateforme/server/catalog/registry"
import { registerConnectors } from "../../packages/plateforme/server/connectors/declaration"
import { memoryFileStore, type MemoryFileStore } from "../../packages/plateforme/server/files/memory"
import { completeTransitUpload, readTransitBytes, requestTransitUpload } from "../../packages/plateforme/server/files/transit"
import { memoryTokens, uploadConnector } from "../factories/described-connector"
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
const SUITE = "transit files sent to a third party on a real database"
const CONTENT = "%PDF-1.7 bulletin de paie"

type Person = "ada" | "claire" | "lea"
type Session = { db: PlatformDb; identity: Identity }

const bytesOf = (text: string) => new TextEncoder().encode(text)
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
    for (const [person, user] of [["ada", o.people.ada], ["claire", o.people.claire], ["lea", o.people.lea]] as const) {
      const db = fx.as(user)
      sessions.set(person, { db, identity: await resolveIdentity(db, o.host, { userId: user.id, email: user.email }) })
    }
    memory = memoryFileStore()
    storage.store = memory
    registerConnectors([uploadConnector()])
  }, SETUP_TIMEOUT)

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  afterAll(async () => {
    registerConnectors([])
    await fx?.cleanup()
  }, SETUP_TIMEOUT)

  const as = (person: Person): Session => {
    const session = sessions.get(person)
    if (!session) throw new Error(`no session for ${person}`)
    return session
  }

  /** Le tiers simulé : ses réponses dans l'ordre ; le bucket en mémoire sert ses propres adresses. */
  function thirdParty(...answers: Response[]) {
    const calls: { url: string; init: RequestInit }[] = []
    vi.stubGlobal("fetch", async (input: string | URL | Request, init: RequestInit = {}) => {
      const url = String(input instanceof Request ? input.url : input)
      if (url.startsWith("https://memory.invalid/")) return memory.fetch(input as string, init)
      calls.push({ url, init })
      return answers.shift() ?? new Response(JSON.stringify({ id: 1 }), { status: 201, headers: { "content-type": "application/json" } })
    })
    return calls
  }

  async function deposit(person: Person, name: string): Promise<string> {
    const { db, identity } = as(person)
    const requested = await requestTransitUpload(db, identity, { name, mime: "", size: bytesOf(CONTENT).byteLength })
    const sent = await memory.fetch(requested.upload.url, { method: "PUT", headers: requested.upload.headers, body: bytesOf(CONTENT) })
    expect(sent.status).toBe(200)
    await completeTransitUpload(db, identity, requested.id)
    return requested.id
  }

  /** La fonction déclarée, appelée comme `call` l'appelle, sous la session de `person`. */
  async function upload(person: Person, file: string) {
    const fn = findFunction(catalogFunctions(), "crm_act.upload_document")
    if (!fn) throw new Error("crm_act.upload_document is not declared")
    const checked = checkArguments(fn.schema, { folder_id: 7, file })
    if (!checked.success) throw new Error("invalid test arguments")
    const { db, identity } = as(person)
    const context = { db, identity, account: { id: "account-1" }, credential: { fields: { api_key: "key_test" }, settings: {}, tokens: memoryTokens() } }
    return fn.run(context as unknown as FunctionContext, checked.data as never)
  }

  it("should send the author's file in a multipart body, then consume it, and refuse it to a teammate and an administrator without sending anything", async () => {
    const calls = thirdParty()
    const id = await deposit("lea", "bulletin.pdf")

    const teammate = await codeOf(upload("claire", id))
    const administrator = await codeOf(upload("ada", id))
    expect({ teammate, administrator, sent: calls.length }).toEqual({ teammate: "not_found", administrator: "not_found", sent: 0 })

    await upload("lea", id)
    expect(calls).toHaveLength(1)
    const [call] = calls
    const type = new Headers(call?.init.headers).get("content-type") ?? ""
    const form = await new Response(call?.init.body as BodyInit, { headers: { "content-type": type } }).formData()
    const document = form.get("document") as File
    expect({ name: document.name, type: document.type, text: await document.text(), source: form.get("source") }).toEqual({
      name: "bulletin.pdf",
      type: "application/pdf",
      text: CONTENT,
      source: "oto",
    })
    // Consommé : illisible pour son auteur, la ligne partie.
    const lea = as("lea")
    expect(await codeOf(readTransitBytes(lea.db, lea.identity, id))).toBe("not_found")
    expect((await fx.admin`select id from platform.files where id = ${id}`).length).toBe(0)
  })

  it("should keep the file after a refusal of the third party, readable by its author until its expiry", async () => {
    thirdParty(new Response(JSON.stringify({ error: "bad type" }), { status: 422, headers: { "content-type": "application/json" } }))
    const id = await deposit("lea", "releve.pdf")
    expect(await codeOf(upload("lea", id))).toBe("invalid_arguments")
    const lea = as("lea")
    const kept = await readTransitBytes(lea.db, lea.identity, id)
    expect(new TextDecoder().decode(kept.bytes)).toBe(CONTENT)
  })
})
