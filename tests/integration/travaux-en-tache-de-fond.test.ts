// @vitest-environment node
// Les fonctions longues sur une vraie base (`fonctions-longues.md`, décidé par Alexis le 22/10) : `call` met en file
// après les contrôles d'un appel synchrone et rend aussitôt un travail ; l'exécutant (`runJobs`) le mène à sa fin sous
// l'identité de son auteur ; `job.read` le relève, réponse ou refus de l'appel synchrone. Arguments et issue chiffrés,
// lisibles par le seul auteur ; un appel parti n'est jamais relancé (`outcome_unknown`), un travail resté en file finit
// `not_started`, un résultat s'efface après 24 heures ; deux lignes de journal par travail, reliées par son identifiant,
// la quantité réglée sur celle de fin. Un connecteur décrit de test sous un nom propre au passage, sa ligne de
// `platform.connectors` retirée à la fin ; `fetch` simulé, aucun réseau ; le bucket est l'adaptateur en mémoire.
import { randomBytes } from "crypto"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { runCall, type CallInput, type CallOutput } from "../../packages/plateforme/server/calls"
import { catalogFunctions } from "../../packages/plateforme/server/catalog/registry"
import { setAccountSecret } from "../../packages/plateforme/server/connectors/account-secret"
import { loadActiveConnectors } from "../../packages/plateforme/server/connectors/activations"
import { registerConnectors } from "../../packages/plateforme/server/connectors/declaration"
import type { ConnectorDefinition, ConnectorFunctionDefinition } from "../../packages/plateforme/server/connectors/definition"
import type { PlatformDb } from "../../packages/plateforme/server/db"
import { PlatformError } from "../../packages/plateforme/server/errors"
import { memoryFileStore, type MemoryFileStore } from "../../packages/plateforme/server/files/memory"
import { completeFileUpload, requestFileUpload } from "../../packages/plateforme/server/files/service"
import { storeTransitFile } from "../../packages/plateforme/server/files/transit"
import { callFunction } from "../../packages/plateforme/server/function-call"
import { resolveIdentity, type Identity } from "../../packages/plateforme/server/identity"
import { runJobs } from "../../packages/plateforme/server/jobs/runner"
import { describedConnector } from "../factories/described-connector"
import { pendingMigrations, pendingReason } from "../helpers/pending-migrations"
import { hex } from "../helpers/plateforme"
import { createSqlFixtures, SQL_SKIP_REASON, sqlConfigured, testAdminSql, type SqlFixtures, type SqlReferenceOrg } from "../helpers/sql"

const storage = vi.hoisted(() => ({ store: null as MemoryFileStore | null }))

vi.mock("../../packages/plateforme/server/files/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../packages/plateforme/server/files/store")>()),
  fileStore: () => storage.store,
}))

const VERSION = "20261023120000" // 20261023120000_v1_6_0.sql, partie écrite en 20261022230000
const pending = (await pendingMigrations()).includes(VERSION)
const CONNECTOR = `t${hex(4)}`
const ORIGIN = "https://acme.test"
const JOB_ID = /^[0-9a-f-]{36}$/

/** Trois fonctions longues : une transcription (un fichier envoyé, un fichier JSON rendu, un coût réglé), une préparation, une purge sensible. */
function backgroundConnector(): ConnectorDefinition {
  const base = describedConnector(CONNECTOR)
  const fn = (short: string, rest: Omit<ConnectorFunctionDefinition, "name" | "connector" | "examples" | "refusals">): ConnectorFunctionDefinition => ({
    name: `${CONNECTOR}.${short}`,
    connector: CONNECTOR,
    examples: [{ title: "One call", input: {} }],
    refusals: [],
    ...rest,
  })
  const transcribe = fn("transcribe", {
    class: "read",
    act: false,
    description: "Transcribe an audio file of yours into a JSON file of yours.",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["file"],
      properties: { file: { type: "string", format: "uuid" }, vocabulary: { type: "string", personal: true } },
    },
    request: { method: "POST", path: "/audio/transcriptions", pathParams: [], query: {}, body: { vocabulary: "vocabulary" }, headers: {}, files: { file: "file" } },
    timeoutMs: 120_000,
    background: true,
    output: { file: { from: "json", name: { template: "transcription.json" }, maxBytes: 4_194_304 } },
    cost: { per: "request", quantity: 10_800, unit: "seconds", settle: { path: "usage.audio_seconds" } },
  })
  const draft = fn("draft", {
    class: "write",
    act: false,
    description: "Draft a campaign from a brief; nothing is sent.",
    schema: { type: "object", additionalProperties: false, required: ["brief"], properties: { brief: { type: "string", minLength: 1 } } },
    request: { method: "POST", path: "/drafts", pathParams: [], query: {}, body: { brief: "brief" }, headers: {} },
    timeoutMs: 10_000,
    background: true,
  })
  const purge = fn("purge", {
    class: "sensitive",
    act: true,
    description: "Delete one archive for good.",
    schema: { type: "object", additionalProperties: false, required: ["archive_id"], properties: { archive_id: { type: "string", minLength: 1 } } },
    request: { method: "DELETE", path: "/archives/{archive_id}", pathParams: ["archive_id"], query: {}, body: {}, headers: {} },
    timeoutMs: 60_000,
    background: true,
    confirm: { summary: "Purge archive {archive_id}: irreversible." },
  })
  return { ...base, probe: undefined, functions: [transcribe, draft, purge].map((one) => ({ ...one, examples: [{ title: "One call", input: exampleOf(one.name) }] })) }
}

/** Le même connecteur, ses fonctions synchrones : l'appel dont un travail doit rendre exactement la réponse. */
function synchronousConnector(): ConnectorDefinition {
  const definition = backgroundConnector()
  return { ...definition, functions: definition.functions.map((fn) => {
    const copy = { ...fn }
    delete copy.background
    return copy
  }) }
}

function exampleOf(name: string): Record<string, unknown> {
  if (name.endsWith(".transcribe")) return { file: "0f8fad5b-d9cb-469f-a165-70867728950e" }
  if (name.endsWith(".draft")) return { brief: "A spring offer." }
  return { archive_id: "arc-1" }
}

type Session = { db: PlatformDb; identity: Identity }
type Sent = { method: string; url: string; body: string }

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

async function refusal(run: Promise<unknown>): Promise<PlatformError> {
  const error = await run.then(
    () => null,
    (reason: unknown) => reason,
  )
  if (!(error instanceof PlatformError)) throw new Error(`expected a PlatformError, got ${String(error)}`)
  return error
}

const suite = !sqlConfigured ? `long functions (${SQL_SKIP_REASON})` : pending ? `long functions (${pendingReason([VERSION])})` : "long functions"

describe.skipIf(!sqlConfigured || pending)(suite, { timeout: 120_000 }, () => {
  let fx: SqlFixtures
  let o: SqlReferenceOrg
  let ada: Session
  let claire: Session
  let account: { id: string; label: string }
  let sent: Sent[]
  let answer: (request: Sent) => Response
  const savedKey = process.env.PLATFORM_VAULT_KEY

  const sessionOf = async (user: { id: string; email: string }): Promise<Session> => {
    const db = fx.as(user)
    return { db, identity: await resolveIdentity(db, o.host, { userId: user.id, email: user.email }) }
  }
  const call = (who: Session, input: CallInput): Promise<CallOutput> =>
    runCall({ db: who.db, identity: who.identity, ctxCode: null, origin: ORIGIN, activeConnectors: () => loadActiveConnectors(who.db, o.org.id), functions: catalogFunctions() }, { account: account.label, ...input })
  const readJob = (who: Session, job: string) => call(who, { function: "job.read", arguments: { job }, account: undefined })
  const jobRow = async (id: string) =>
    (await fx.admin<{ state: string; reason: string | null; arguments_ciphertext: string | null; outcome_ciphertext: string | null; erased_at: string | null }[]>`
      select state, reason, arguments_ciphertext, outcome_ciphertext, erased_at from platform.jobs where id = ${id}`)[0]
  const journalOf = (job: string) =>
    fx.admin<{ method: string; tool: string | null; target: string | null; args: Record<string, unknown>; error: string | null; duration_ms: number | null; account_id: string | null }[]>`
      select method, tool, target, args, error, duration_ms, account_id from platform.journal where org_id = ${o.org.id} and args ->> '_job' = ${job} order by id`
  /** `work` sous le connecteur synchrone, puis le connecteur aux fonctions longues de nouveau. */
  const synchronously = async <T>(work: () => Promise<T>): Promise<T> => {
    registerConnectors([synchronousConnector()])
    try {
      return await work()
    } finally {
      registerConnectors([backgroundConnector()], { backgroundRunner: "process" })
    }
  }
  const queued = (output: CallOutput) => {
    if (output.data.status !== "queued") throw new Error(`expected a queued job, got ${output.text}`)
    return output.data.job
  }

  beforeAll(async () => {
    process.env.PLATFORM_VAULT_KEY = randomBytes(32).toString("base64")
    fx = createSqlFixtures()
    await fx.admin`insert into platform.connectors (name, label) values (${CONNECTOR}, 'Crm')`
    o = await fx.buildReferenceOrg()
    await fx.addActivation(o.org.id, CONNECTOR)
    ada = await sessionOf(o.people.ada)
    claire = await sessionOf(o.people.claire)
    registerConnectors([backgroundConnector()], { backgroundRunner: "process" })
    account = { id: await fx.createAccount(o.org.id, { connector: CONNECTOR, ownerKind: "org", label: `Crm ${hex(3)}`, mode: "reel" }), label: "" }
    account.label = (await fx.admin<{ label: string }[]>`select label from platform.accounts where id = ${account.id}`)[0].label
    await setAccountSecret(ada.db, ada.identity, { account_id: account.id, input: { secret: { api_key: `k_${randomBytes(12).toString("hex")}` } } })
  }, 180_000)

  beforeEach(async () => {
    const memory = memoryFileStore()
    storage.store = memory
    sent = []
    answer = () => json({ id: "d-1", status: "drafted" })
    registerConnectors([backgroundConnector()], { backgroundRunner: "process" })
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      // Les URL présignées du bucket en mémoire se servent par lui ; le reste est le tiers.
      if (String(input).startsWith("https://memory.invalid/")) return memory.fetch(input, init)
      const request: Sent = { method: init?.method ?? "GET", url: String(input), body: typeof init?.body === "string" ? init.body : init?.body ? "[multipart]" : "" }
      sent.push(request)
      return answer(request)
    })
    // Les travaux d'un passage précédent ne courent pas dans celui-ci.
    await fx.admin`delete from platform.jobs where org_id = ${o.org.id}`
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  afterAll(async () => {
    registerConnectors([])
    if (savedKey === undefined) delete process.env.PLATFORM_VAULT_KEY
    else process.env.PLATFORM_VAULT_KEY = savedKey
    await fx?.cleanup()
    const admin = testAdminSql()
    try {
      await admin`delete from platform.connectors where name = ${CONNECTOR}`
    } finally {
      await admin.end({ timeout: 5 })
    }
  }, 180_000)

  it("should refuse to queue a long function while the host declares no runner, and send nothing", async () => {
    registerConnectors([backgroundConnector()])

    const error = await refusal(call(ada, { function: `${CONNECTOR}.draft`, arguments: { brief: "A spring offer." } }))

    expect(error.code).toBe("unavailable_in_v1")
    expect(error.message).toBe(`${CONNECTOR}.draft runs in the background, and this application has declared no runner for background jobs: nothing was queued nor sent. Tell whoever runs this application.`)
    expect(sent).toEqual([])
    expect(await fx.admin`select 1 from platform.jobs where org_id = ${o.org.id}`).toHaveLength(0)
  })

  it("should queue at once, return the same job for the same call, run it under its author and give the answer of the call", async () => {
    const first = await call(ada, { function: `${CONNECTOR}.draft`, arguments: { brief: "A spring offer." } })
    const job = queued(first)
    expect(job).toMatch(JOB_ID)
    expect(first.data).toMatchObject({ status: "queued", retry_after_s: 15, account: { id: account.id } })
    expect(first.text.split("\n")[0]).toBe(`Job ${job} queued: ${CONNECTOR}.draft runs in the background. Read its result with job.read {"job": "${job}"} in 15 seconds, until it is done or failed.`)
    expect(first.nextActions).toEqual(["job.read"])
    expect(sent).toEqual([])
    // Même appel pendant qu'il court : le même travail, aucun second.
    const again = await call(ada, { function: `${CONNECTOR}.draft`, arguments: { brief: "A spring offer." } })
    expect(queued(again)).toBe(job)
    expect(again.text).toContain("already under way")
    expect((await readJob(ada, job)).data.result).toEqual({ job, status: "queued", function: `${CONNECTOR}.draft`, retry_after_s: 15 })

    expect(await runJobs({ limit: 5 })).toEqual({ ran: 1 })

    expect(sent.map((one) => [one.method, one.url, one.body])).toEqual([["POST", "https://crm.example.test/v2/drafts", JSON.stringify({ brief: "A spring offer." })]])
    const read = await readJob(ada, job)
    // Exactement la réponse de l'appel synchrone : son texte, ses données, ses suites.
    const sync = await synchronously(() => call(ada, { function: `${CONNECTOR}.draft`, arguments: { brief: "A spring offer." } }))
    expect(read.data.result).toEqual({ ...sync.data, job, status: "done" })
    expect(sync.data).toMatchObject({ account: { id: account.id }, result: { id: "d-1", status: "drafted" } })
    expect(read.text).toBe(sync.text)
    expect(read.nextActions).toEqual(sync.nextActions)
    // Arguments retirés à la fin, issue chiffrée : rien en clair sur la ligne.
    const row = await jobRow(job)
    expect(row).toMatchObject({ state: "done", reason: null, arguments_ciphertext: null })
    expect(row.outcome_ciphertext).toMatch(/^v2:/)
    expect(row.outcome_ciphertext).not.toContain("drafted")
    // Un travail fini se relance : un nouveau travail.
    expect(queued(await call(ada, { function: `${CONNECTOR}.draft`, arguments: { brief: "A spring offer." } }))).not.toBe(job)
  })

  it("should keep a job readable by its author alone, the same refusal as an unknown job", async () => {
    const job = queued(await call(ada, { function: `${CONNECTOR}.draft`, arguments: { brief: "Mine." } }))

    const theirs = await refusal(readJob(claire, job))
    const unknown = await refusal(readJob(claire, "5d1c2b3a-4e5f-4a6b-8c7d-9e0f1a2b3c4d"))

    expect({ code: theirs.code, message: theirs.message }).toEqual({ code: "not_found", message: "Unknown job." })
    expect({ code: unknown.code, message: unknown.message }).toEqual({ code: "not_found", message: "Unknown job." })
    expect((await refusal(readJob(ada, "not-a-job"))).message).toBe("Unknown job.")
    // La RLS ne montre la ligne qu'à son auteur ; aucune session n'écrit dans la table.
    expect(await claire.db.tx((sql) => sql`select id from platform.jobs where id = ${job}`)).toHaveLength(0)
    expect(await ada.db.tx((sql) => sql`select id from platform.jobs where id = ${job}`)).toHaveLength(1)
    await expect(ada.db.tx((sql) => sql`update platform.jobs set state = 'done' where id = ${job}`)).rejects.toThrow()
    await expect(ada.db.tx((sql) => sql`select platform.claim_jobs(5)`)).rejects.toThrow()
  })

  it("should send the file of the author, keep the file returned, settle the quantity read and keep the personal values out of the base and the journal", async () => {
    const audio = await storeTransitFile(ada.db, ada.identity, { name: "appel.mp3", bytes: new Uint8Array(16).fill(7), origin: { kind: "upload" } })
    answer = () => json({ text: "Bonjour Durand.", usage: { audio_seconds: 42 } })
    const missing = await refusal(call(ada, { function: `${CONNECTOR}.transcribe`, arguments: { file: "0f8fad5b-d9cb-469f-a165-70867728950e" } }))
    expect({ code: missing.code, message: missing.message }).toEqual({ code: "not_found", message: "Unknown file." })

    const output = await callFunction(ada.db, ada.identity, { function: `${CONNECTOR}.transcribe`, arguments: { file: audio.id, vocabulary: "Durand,Morel" }, account: account.label }, { origin: ORIGIN })
    if (output.status !== "queued") throw new Error("expected a queued job")
    const { job } = output
    expect(output.retryAfterSeconds).toBe(15)
    const stored = await jobRow(job)
    expect(stored.arguments_ciphertext).toMatch(/^v2:/)
    expect(stored.arguments_ciphertext).not.toContain("Durand")

    await runJobs({ limit: 1 })

    const done = (await readJob(ada, job)).data.result as { status: string; result: { file: { id: string; name: string } } }
    expect(done.status).toBe("done")
    expect(done.result.file).toMatchObject({ name: "transcription.json" })
    expect(sent).toHaveLength(1)
    // Le fichier envoyé est consommé après l'envoi réussi, comme en synchrone.
    expect(await fx.admin`select 1 from platform.files where id = ${audio.id}`).toHaveLength(0)
    const lines = await journalOf(job)
    expect(lines.map((line) => [line.method, line.tool, line.target])).toEqual([
      ["api", "call", `${CONNECTOR}.transcribe`],
      ["job", "call", `${CONNECTOR}.transcribe`],
    ])
    expect(lines[0].args).toMatchObject({ _job: job, arguments: { file: audio.id, vocabulary: "[personal]" } })
    expect(lines[1]).toMatchObject({ error: null, account_id: account.id, args: { _job: job, _cost: { quantity: 42, unit: "seconds", from: "response" } } })
    expect(typeof lines[1].duration_ms).toBe("number")
    expect(JSON.stringify(lines)).not.toContain("Durand")
  })

  it("should send a file attached to a page the author reads, at the run as at the queueing, and never consume it", async () => {
    await fx.createNode(o.org.id, { parentId: o.nodes.ventes, path: "ventes/t_audio", title: "Audio" })
    const requested = await requestFileUpload(ada.db, ada.identity, { node: "ventes/t_audio", name: "reunion.mp3", mime: "", size: 16 })
    const { id, upload } = requested.data
    expect((await storage.store?.fetch(upload.url, { method: "PUT", headers: upload.headers, body: new Uint8Array(16).fill(7) }))?.status).toBe(200)
    await completeFileUpload(ada.db, ada.identity, id)
    answer = () => json({ text: "Bonjour.", usage: { audio_seconds: 12 } })

    const job = queued(await call(ada, { function: `${CONNECTOR}.transcribe`, arguments: { file: id } }))
    await runJobs({ limit: 1 })

    const done = (await readJob(ada, job)).data.result as { status: string }
    const [row] = await fx.admin<{ attached: boolean }[]>`select node_id is not null as attached from platform.files where id = ${id}`
    expect({ status: done.status, sent: sent.map((request) => request.body), attached: row?.attached }).toEqual({ status: "done", sent: ["[multipart]"], attached: true })
  })

  it("should ask the approval of a sensitive long function before queueing, and fail with the refusal of the call", async () => {
    const asked = await call(ada, { function: `${CONNECTOR}_act.purge`, arguments: { archive_id: "arc-1" } })
    expect(asked.data.status).toBe("needs_confirmation")
    expect(await fx.admin`select 1 from platform.jobs where org_id = ${o.org.id}`).toHaveLength(0)
    answer = () => json({ error: "missing" }, 404)

    const job = queued(await call(ada, { function: `${CONNECTOR}_act.purge`, arguments: { archive_id: "arc-1" }, confirm: true }))
    await runJobs({ limit: 1 })

    const failed = await refusal(readJob(ada, job))
    const sync = await refusal(synchronously(() => call(ada, { function: `${CONNECTOR}_act.purge`, arguments: { archive_id: "arc-1" }, confirm: true })))
    expect({ code: failed.code, message: failed.message }).toEqual({ code: sync.code, message: sync.message })
    expect(sync.message).toBe("No such object in Crm. (not_found)")
    expect(failed.details).toMatchObject({ job, status: "failed", reason: "refused" })
    expect(await jobRow(job)).toMatchObject({ state: "failed", reason: "refused", arguments_ciphertext: null })
    // Refusé par le tiers : rien à régler.
    expect((await journalOf(job)).map((line) => [line.method, line.error, line.args._cost])).toEqual([["job", "not_found: No such object in Crm. (not_found)", undefined]])
  })

  it("should never send again a call whose lease ran out after sending: outcome unknown, at the worst case", async () => {
    const audio = await storeTransitFile(ada.db, ada.identity, { name: "appel.mp3", bytes: new Uint8Array(8).fill(1), origin: { kind: "upload" } })
    const job = queued(await call(ada, { function: `${CONNECTOR}.transcribe`, arguments: { file: audio.id } }))
    await fx.admin`update platform.jobs set state = 'sent', lease_token = gen_random_uuid(), lease_until = now() - interval '1 second', sent_at = now() - interval '3 minutes' where id = ${job}`

    const failed = await refusal(readJob(ada, job))

    expect(failed.code).toBe("upstream_error")
    expect(failed.message).toContain("outcome unknown")
    expect(await jobRow(job)).toMatchObject({ state: "failed", reason: "outcome_unknown", arguments_ciphertext: null })
    expect(await runJobs({ limit: 5 })).toEqual({ ran: 0 })
    expect(sent).toEqual([])
    const [end] = (await journalOf(job)).filter((line) => line.method === "job")
    expect(end.args._cost).toEqual({ quantity: 10_800, unit: "seconds", from: "worst_case" })
  })

  it("should put back in the queue a job claimed whose lease ran out before sending, and run it once", async () => {
    const job = queued(await call(ada, { function: `${CONNECTOR}.draft`, arguments: { brief: "Claimed." } }))
    await fx.admin`update platform.jobs set state = 'claimed', lease_token = gen_random_uuid(), lease_until = now() - interval '1 second' where id = ${job}`

    // Deux exécutants ensemble : le travail ne part qu'une fois.
    const [one, two] = await Promise.all([runJobs({ limit: 5 }), runJobs({ limit: 5 })])

    expect(one.ran + two.ran).toBe(1)
    expect(sent).toHaveLength(1)
    expect(await jobRow(job)).toMatchObject({ state: "done" })
  })

  it("should end without cost a job left 24 hours in the queue, and erase a result 24 hours after its end", async () => {
    const waiting = queued(await call(ada, { function: `${CONNECTOR}.draft`, arguments: { brief: "Waiting." } }))
    await fx.admin`update platform.jobs set created_at = now() - interval '25 hours' where id = ${waiting}`
    const ended = queued(await call(ada, { function: `${CONNECTOR}.draft`, arguments: { brief: "Ended." } }))

    expect(await runJobs({ limit: 5 })).toEqual({ ran: 1 })
    await fx.admin`update platform.jobs set finished_at = now() - interval '25 hours' where id = ${ended}`

    const never = await refusal(readJob(ada, waiting))
    expect(never.code).toBe("internal")
    expect(never.message).toContain("was never started")
    expect(await jobRow(waiting)).toMatchObject({ state: "failed", reason: "not_started" })
    const erased = await refusal(readJob(ada, ended))
    expect(erased.code).toBe("not_found")
    expect(erased.message).toMatch(new RegExp(`^Job ${ended} was erased on \\d{4}-\\d\\d-\\d\\d \\d\\d:\\d\\d UTC: the result of a job is kept 24 hours after it ends\\.`))
    expect(await jobRow(ended)).toMatchObject({ outcome_ciphertext: null })
    expect(sent).toHaveLength(1)
    const [line] = (await journalOf(waiting)).filter((one) => one.method === "job")
    expect(line.args._cost).toBeUndefined()
    expect(line.error).toContain("internal: Job")
  })
})
