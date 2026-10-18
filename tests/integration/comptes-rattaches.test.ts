// @vitest-environment node
// Le compte de l'hôte et le compte rattaché (`accountIdentity`), sur une vraie base et par la vraie porte : départ
// (`POST hosted-link`) et retour (`GET hosted-link/callback`) sous le jeton de personnes jetables, leurs lignes de
// journal ; les gardes du branchement (identifiant d'une autre personne, dans toute organisation ; provenance ;
// ambiguïté ; session morte ou indisponible ; rejeu ; indice forgé) ; la reconnexion et la liaison dans une deuxième
// organisation ; l'appel, qui assemble la clé de l'hôte et l'identifiant du compte ; le refus de `createAccount` et
// de `setAccountSecret` ; le cliquet des droits sur `linked_id`. Un faux port du branchement tient lieu du tiers, et
// `fetch` remplacé de son API : aucun réseau. Clé et identifiants tirés à l'exécution.
import { randomBytes } from "crypto"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { handlePlateforme } from "@otomata_tech/oto_platform/api"
import { callFunction, createAccount, setAccountRule, setAccountSecret } from "@otomata_tech/oto_platform/server"
import { readNode } from "../../packages/plateforme/server/nodes/read"
import { registerConnectors } from "../../packages/plateforme/server/connectors/declaration"
import type { Fetch } from "../../packages/plateforme/server/connectors/http"
import type { PlatformDb } from "../../packages/plateforme/server/db"
import { PlatformError } from "../../packages/plateforme/server/errors"
import { resolveIdentity, type Identity } from "../../packages/plateforme/server/identity"
import { fakeHostedLinks, hostedConnector, type FakeHostedAccount } from "../factories/described-connector"
import { pendingMigrations, pendingReason } from "../helpers/pending-migrations"
import { hex } from "../helpers/plateforme"
import { createLocalFixtures, type LocalFixtures } from "../helpers/session-locale"
import { codeOf, SQL_SKIP_REASON, sqlConfigured, testAdminSql, type SqlReferenceOrg, type TestSql } from "../helpers/sql"

const VERSION = "20261017090000"
const pending = (await pendingMigrations()).includes(VERSION)

const CONNECTOR = `t${hex(4)}`
const API = "https://crm.example.test/v2"
const LABEL = "Hosted Crm"
type Caller = "ada" | "lea" | "claire"
type Task = () => Promise<void>

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
const accountId = (name: string) => `${name}-${hex(4)}`

async function refusal(run: Promise<unknown>): Promise<PlatformError> {
  const error = await run.then(
    () => null,
    (reason: unknown) => reason,
  )
  if (!(error instanceof PlatformError)) throw new Error(`expected a PlatformError, got ${String(error)}`)
  return error
}

const suite = !sqlConfigured ? `hosted accounts (${SQL_SKIP_REASON})` : pending ? `hosted accounts (${pendingReason([VERSION])})` : "host account and hosted accounts linked by a person"

describe.skipIf(!sqlConfigured || pending)(suite, { timeout: 120_000 }, () => {
  let fx: LocalFixtures
  let admin: TestSql
  let o: SqlReferenceOrg
  let o2: SqlReferenceOrg
  let outside: SqlReferenceOrg
  let fake: ReturnType<typeof fakeHostedLinks>
  let sent: { url: string; key: string | null }[]
  const KEY = `hk_${randomBytes(16).toString("hex")}`
  const tokens = new Map<Caller, string>()
  const people = new Map<string, { db: PlatformDb; identity: Identity }>()
  const origin = (org: SqlReferenceOrg) => `https://${org.host}`
  const who = (caller: Caller) => `${caller}@contoso.test`
  const label = (caller: Caller) => `${who(caller)} (${CONNECTOR})`
  const person = (caller: Caller, org: SqlReferenceOrg) => {
    const found = people.get(`${caller}@${org.org.id}`)
    if (!found) throw new Error(`no person ${caller}`)
    return found
  }

  const register = (options: { host?: boolean; port?: boolean } = {}) =>
    registerConnectors([hostedConnector(CONNECTOR)], {
      ...(options.host === false ? {} : { hostCredentials: { [CONNECTOR]: () => ({ api_key: KEY }) } }),
      ...(options.port === false ? {} : { hostedLinks: { [CONNECTOR]: fake.port } }),
    })

  async function gate(caller: Caller, org: SqlReferenceOrg, path: string, body?: unknown): Promise<Response> {
    const method = body === undefined ? "GET" : "POST"
    const tasks: Task[] = []
    const request = new Request(`${origin(org)}/api/platform/${path}`, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: { origin: origin(org), "x-forwarded-proto": "https", "content-type": "application/json", "user-agent": "comptes-rattaches-test" },
    })
    const response = await handlePlateforme(request, { accessToken: tokens.get(caller) ?? null, host: org.host, verifyToken: fx.verifyToken, defer: (task) => tasks.push(task) })
    for (const task of tasks) await task()
    return response
  }

  async function start(caller: Caller, org = o, body: unknown = { connector: CONNECTOR }): Promise<{ status: number; url: string; error?: { code: string; message: string } }> {
    const response = await gate(caller, org, "hosted-link", body)
    const answer = (await response.json()) as { data?: { url: string }; error?: { code: string; message: string } }
    return { status: response.status, url: answer.data?.url ?? "", error: answer.error }
  }

  async function back(caller: Caller, query: Record<string, string>, org = o): Promise<URL> {
    const response = await gate(caller, org, `hosted-link/callback?${new URLSearchParams(query).toString()}`)
    expect(response.status).toBe(302)
    return new URL(response.headers.get("location") ?? "")
  }

  /** La dernière demande de la personne dans l'organisation : son identifiant et sa date, posée par la base. */
  const lastRequest = async (caller: Caller, org = o) =>
    (
      await admin<{ id: string; created_at: Date; kind: string; consumed_at: Date | null }[]>`
        select id, created_at, kind, consumed_at from platform.hosted_link_requests
         where org_id = ${org.org.id} and user_id = ${o.people[caller].id} order by created_at desc limit 1`
    )[0]

  /** Une date ISO à `minutes` de la demande. */
  const near = (request: { created_at: Date }, minutes: number) => new Date(request.created_at.getTime() + minutes * 60_000).toISOString()

  /** Départ, compte créé chez le tiers juste après la demande, retour : l'adresse où le navigateur revient. */
  async function connect(caller: Caller, id: string, org = o, extra: FakeHostedAccount[] = []): Promise<URL> {
    await start(caller, org)
    const request = await lastRequest(caller, org)
    fake.state.accounts = [...extra, { id, createdAt: near(request, 1), probe: "alive", who: who(caller) }]
    return back(caller, { request: request.id }, org)
  }

  const accountsOf = (caller: Caller, org = o) =>
    admin<{ id: string; label: string; owner_kind: string; mode: string; status: string; linked_id: string | null }[]>`
      select id, label, owner_kind, mode, status, linked_id from platform.accounts
       where org_id = ${org.org.id} and connector = ${CONNECTOR} and owner_user_id = ${o.people[caller].id} order by created_at`
  const linkedRows = (id: string) => admin<{ org_id: string; owner_user_id: string }[]>`select org_id, owner_user_id from platform.accounts where connector = ${CONNECTOR} and linked_id = ${id}`
  const journal = (tool: string, org = o) =>
    admin<{ target: string | null; is_error: boolean; error: string | null; args: unknown }[]>`
      select target, is_error, error, args from platform.journal where org_id = ${org.org.id} and tool = ${tool} order by id`
  const outcome = (location: URL) => [location.pathname, location.searchParams.get("hosted"), location.searchParams.get("reason") ?? location.searchParams.get("account")]

  beforeAll(async () => {
    fake = fakeHostedLinks()
    register()
    fx = createLocalFixtures()
    admin = testAdminSql()
    await admin`insert into platform.connectors (name, label) values (${CONNECTOR}, ${LABEL})`
    o = await fx.buildReferenceOrg()
    o2 = await fx.buildReferenceOrg(o.people)
    outside = await fx.buildReferenceOrg()
    for (const org of [o, o2]) {
      await fx.addActivation(org.org.id, CONNECTOR)
      for (const caller of ["ada", "lea", "claire"] as const) {
        const user = o.people[caller]
        tokens.set(caller, (await fx.sessionFor(user)).accessToken)
        const db = fx.as(user)
        people.set(`${caller}@${org.org.id}`, { db, identity: await resolveIdentity(db, org.host, { userId: user.id, email: user.email }) })
      }
    }
  }, 180_000)

  afterAll(async () => {
    registerConnectors([])
    try {
      await fx?.cleanup()
      await admin`delete from platform.connectors where name = ${CONNECTOR}`
    } finally {
      await admin?.end({ timeout: 5 })
    }
  }, 180_000)

  beforeEach(async () => {
    fake = fakeHostedLinks()
    register()
    sent = []
    const fetcher: Fetch = async (url, init) => {
      sent.push({ url, key: new Headers(init.headers).get("x-api-key") })
      if (url.includes("/contacts")) return json({ items: [{ id: "c-1" }], has_more: false })
      return url.endsWith("/entries") ? json({ id: "e-1" }) : json({}, 404)
    }
    vi.stubGlobal("fetch", fetcher)
    vi.spyOn(console, "error").mockImplementation(() => {})
    // Chaque cas part de zéro : ni compte ni demande du connecteur.
    await admin`delete from platform.hosted_link_requests where connector = ${CONNECTOR}`
    await admin`delete from platform.accounts where connector = ${CONNECTOR}`
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("should start a link for the signed-in person: a dated request, the package's return address, a create link, nothing from the client", async () => {
    const { status, url } = await start("lea", o, { connector: CONNECTOR, return_to: "/dossiers/42?tab=pieces" })
    const request = await lastRequest("lea")
    const [created] = fake.calls
    expect([status, url, created.method]).toEqual([200, fake.state.url, "createLink"])
    expect(created.input).toEqual({ requestId: request.id, kind: "create", returnUrl: `${origin(o)}/api/platform/hosted-link/callback?request=${request.id}`, expiresAt: expect.any(Date) })
    const expiresAt = (created.input as { expiresAt: Date }).expiresAt.getTime()
    expect(Math.abs(expiresAt - request.created_at.getTime() - 3_600_000)).toBeLessThan(1_000)
    expect(request.kind).toBe("create")
    expect((await journal("POST hosted-link")).at(-1)).toMatchObject({ target: CONNECTOR, is_error: false })
    // Une adresse de retour fournie par le client est refusée, jamais suivie.
    const forged = await start("lea", o, { connector: CONNECTOR, redirect_uri: "https://evil.example.test" })
    expect([forged.status, forged.error?.code]).toEqual([400, "invalid_arguments"])
    expect(fake.calls).toHaveLength(1)
  })

  it("should link the only live account created during the request on the person's own account, then call with the host's key and its id", async () => {
    const id = accountId("lea")
    await start("lea", o, { connector: CONNECTOR, return_to: "/dossiers/42?tab=pieces" })
    const request = await lastRequest("lea")
    fake.state.accounts = [{ id, createdAt: near(request, 1), probe: "alive", who: who("lea") }]
    const location = await back("lea", { request: request.id })
    expect([location.origin, location.pathname, Object.fromEntries(location.searchParams)]).toEqual([origin(o), "/dossiers/42", { tab: "pieces", hosted: "connected", account: label("lea") }])
    expect(await accountsOf("lea")).toEqual([{ id: expect.any(String), label: label("lea"), owner_kind: "user", mode: "reel", status: "active", linked_id: id }])
    expect((await lastRequest("lea")).consumed_at).not.toBeNull()
    expect((await journal("GET hosted-link/callback")).at(-1)).toMatchObject({ target: label("lea"), is_error: false, args: null })

    // Son propre compte sert sans être nommé (§ Compte rattaché, À l'appel).
    const lea = person("lea", o)
    const result = await callFunction(lea.db, lea.identity, { function: `${CONNECTOR}.list_contacts` }, { origin: origin(o) })
    expect([result.status, result.account?.label, sent.at(-1)]).toEqual(["done", label("lea"), { url: `${API}/${id}/contacts?view=full`, key: KEY }])
    // La clé de l'hôte n'est ni en base ni au journal.
    const everything = JSON.stringify(await admin`select to_jsonb(a) as row from platform.accounts a where connector = ${CONNECTOR}`) + JSON.stringify(await journal("GET hosted-link/callback"))
    expect(everything).not.toContain(KEY)
  })

  it("should take the person's own account unnamed, and serve it shared to another only named", async () => {
    const lea = person("lea", o)
    const claire = person("claire", o)
    const none = await refusal(callFunction(lea.db, lea.identity, { function: `${CONNECTOR}.list_contacts` }, { origin: origin(o) }))
    const yours = `No ${CONNECTOR} account of yours is connected: each person connects their own to ${CONNECTOR}. Ask the user to connect theirs in the application (Connect my account).`
    expect([none.code, none.message]).toEqual(["not_enabled", yours])
    const id = accountId("lea")
    await connect("lea", id)
    const own = await callFunction(lea.db, lea.identity, { function: `${CONNECTOR}.list_contacts` }, { origin: origin(o) })
    expect([own.status, own.account?.label, sent.at(-1)?.url]).toEqual(["done", label("lea"), `${API}/${id}/contacts?view=full`])

    // Partagé (décision du 16/10, n° 10) : le compte d'un autre se nomme ; sans nom, l'appel de claire cherche le sien.
    const [account] = await accountsOf("lea")
    await setAccountRule(lea.db, lea.identity, { accountId: account.id, subject: { kind: "user", id: o.people.claire.id }, level: "write" })
    // Le refus nomme le compte partagé et sa propriétaire (partage des comptes, #68), sans le prendre.
    const unnamed = await refusal(callFunction(claire.db, claire.identity, { function: `${CONNECTOR}.list_contacts` }, { origin: origin(o) }))
    const shared = ` Personal accounts shared with you, used only when named: « ${label("lea")} » (owner Léa Roux, live). Show them to the user and ask which one to use; do not pick one yourself. Then call again with account: "<label>".`
    expect([unnamed.code, unnamed.message, unnamed.details]).toEqual([
      "not_enabled",
      yours + shared,
      { shared_accounts: [{ id: account.id, label: label("lea"), owner: "Léa Roux" }] },
    ])
    const named = await callFunction(claire.db, claire.identity, { function: `${CONNECTOR}.list_contacts`, account: label("lea") }, { origin: origin(o) })
    expect([named.status, named.account?.label, sent.at(-1)?.url]).toEqual(["done", label("lea"), `${API}/${id}/contacts?view=full`])
  })

  it("should never link the id of another person, active or disabled, in any organisation, even named by the hint", async () => {
    const theirs = accountId("claire")
    await connect("claire", theirs)
    await start("lea")
    const request = await lastRequest("lea")
    fake.state.accounts = [{ id: theirs, createdAt: near(request, 1), probe: "alive" }]
    const hinted = await back("lea", { request: request.id, account_id: theirs })
    const unhinted = await back("lea", { request: request.id })
    await admin`update platform.accounts set status = 'disabled' where linked_id = ${theirs}`
    const disabled = await back("lea", { request: request.id, account_id: theirs })
    // Rattaché par une personne d'une organisation dont lea n'est pas membre : la RLS ne le voit pas, la garde si.
    const foreign = accountId("outsider")
    await admin`
      insert into platform.accounts (org_id, connector, owner_kind, owner_user_id, label, mode, status, linked_id)
      values (${outside.org.id}, ${CONNECTOR}, 'user', ${outside.people.marc.id}, ${`Outsider ${hex(3)}`}, 'reel', 'active', ${foreign})`
    fake.state.accounts = [{ id: foreign, createdAt: near(request, 1), probe: "alive" }]
    const elsewhere = await back("lea", { request: request.id, account_id: foreign })
    expect([outcome(hinted), outcome(unhinted), outcome(disabled), outcome(elsewhere)]).toEqual([
      ["/admin/connectors", "failed", "forbidden"],
      ["/admin/connectors", "failed", "no_candidate"],
      ["/admin/connectors", "failed", "forbidden"],
      ["/admin/connectors", "failed", "forbidden"],
    ])
    expect(await accountsOf("lea")).toEqual([])
    expect((await linkedRows(theirs)).map((row) => row.owner_user_id)).toEqual([o.people.claire.id])
    // Le refus ne dit ni à qui est le compte, ni combien la clé en porte.
    const lines = (await journal("GET hosted-link/callback")).filter((line) => line.is_error)
    expect(lines.at(-1)?.error).toBe(`forbidden: This ${LABEL} account cannot be connected by you.`)
    expect(JSON.stringify(lines)).not.toMatch(/claire|outsider|\b[0-9]+ accounts?\b/i)
  })

  it("should require provenance: created at most 5 minutes before the request; a missing or unreadable date refuses", async () => {
    await start("lea")
    const request = await lastRequest("lea")
    const id = accountId("lea")
    const tryWith = async (createdAt: string | null) => {
      fake.state.accounts = [{ id, createdAt, probe: "alive", who: who("lea") }]
      return outcome(await back("lea", { request: request.id }))
    }
    expect(await tryWith(near(request, -10))).toEqual(["/admin/connectors", "failed", "no_candidate"])
    expect(await tryWith(null)).toEqual(["/admin/connectors", "failed", "no_candidate"])
    expect(await tryWith("1697000000000")).toEqual(["/admin/connectors", "failed", "no_candidate"])
    expect(await tryWith("last tuesday")).toEqual(["/admin/connectors", "failed", "no_candidate"])
    expect(await accountsOf("lea")).toEqual([])
    expect(await tryWith(near(request, -4))).toEqual(["/admin/connectors", "connected", label("lea")])
  })

  it("should reconnect a dead session of the person's own id, then link it back whatever its date", async () => {
    const id = accountId("lea")
    await connect("lea", id)
    fake.state.accounts = [{ id, createdAt: "2020-01-01T00:00:00Z", probe: "dead" }]
    await admin`update platform.accounts set status = 'error', status_reason = 'session lost' where linked_id = ${id}`
    fake.calls.length = 0
    const { url } = await start("lea")
    const request = await lastRequest("lea")
    expect([url, request.kind, fake.calls.map((call) => call.method)]).toEqual([fake.state.url, "reconnect", ["probe", "createLink"]])
    expect(fake.calls[1].input).toMatchObject({ kind: "reconnect", linkedId: id })
    fake.state.accounts = [{ id, createdAt: "2020-01-01T00:00:00Z", probe: "alive", who: who("lea") }]
    expect(outcome(await back("lea", { request: request.id }))).toEqual(["/admin/connectors", "connected", label("lea")])
    expect(await accountsOf("lea")).toMatchObject([{ status: "active", linked_id: id }])
  })

  it("should link an id already the person's in a second organisation in one gesture, without the third party's link", async () => {
    const id = accountId("lea")
    await connect("lea", id)
    fake.calls.length = 0
    const { url } = await start("lea", o2, { connector: CONNECTOR, return_to: "/mes-comptes" })
    const location = new URL(url)
    expect([location.origin, location.pathname, Object.fromEntries(location.searchParams)]).toEqual([origin(o2), "/mes-comptes", { hosted: "connected", account: label("lea") }])
    expect(fake.calls.map((call) => call.method)).toEqual(["probe"])
    expect((await linkedRows(id)).map((row) => row.org_id).sort()).toEqual([o.org.id, o2.org.id].sort())
    expect((await lastRequest("lea", o2)).consumed_at).not.toBeNull()
  })

  it("should refuse a dead session, and say unavailable for a session it cannot read, a port that throws, or an invalid link", async () => {
    await start("lea")
    const request = await lastRequest("lea")
    const id = accountId("lea")
    fake.state.accounts = [{ id, createdAt: near(request, 1), probe: "dead" }]
    const dead = await back("lea", { request: request.id })
    fake.state.accounts = [{ id, createdAt: near(request, 1), probe: "unavailable" }]
    const unavailable = await back("lea", { request: request.id })
    fake.state.accounts = [{ id, createdAt: near(request, 1), probe: "throws" }]
    const thrown = await back("lea", { request: request.id })
    fake.state.fail = "listAccounts"
    const listing = await back("lea", { request: request.id })
    expect([outcome(dead), outcome(unavailable), outcome(thrown), outcome(listing)]).toEqual([
      ["/admin/connectors", "failed", "candidates_dead"],
      ["/admin/connectors", "failed", "upstream_error"],
      ["/admin/connectors", "failed", "upstream_error"],
      ["/admin/connectors", "failed", "upstream_error"],
    ])
    expect((await lastRequest("lea")).consumed_at).toBeNull()
    // Rien de ce que le tiers a dit : ni au journal, ni au log serveur, où seul le nom de l'erreur passe.
    const logged = JSON.stringify(vi.mocked(console.error).mock.calls) + JSON.stringify(await journal("GET hosted-link/callback"))
    expect(logged).not.toMatch(/secret-key-123|api\.example\.test|exploded/)
    expect(logged).toContain("hostedLinks.listAccounts failed (TypeError)")

    fake.state.fail = "createLink"
    const failed = await start("claire")
    fake.state.fail = null
    fake.state.url = "http://link.example.test/plain"
    const plain = await start("claire")
    expect([failed.status, failed.error?.code, plain.error?.code]).toEqual([502, "upstream_error", "upstream_error"])
    expect(JSON.stringify(failed)).not.toContain("secret-key-123")
    // Une demande sans lien ne reste pas ouverte : elle couvrirait les comptes des autres.
    expect(await lastRequest("claire")).toBeUndefined()
  })

  it("should refuse a replayed return, a request of another person, an expired one, and a request id that is not one", async () => {
    const id = accountId("lea")
    await connect("lea", id)
    const already = (await journal("GET hosted-link/callback")).length
    const consumed = await lastRequest("lea")
    const replayed = await back("lea", { request: consumed.id })
    await start("claire")
    const claires = await lastRequest("claire")
    const another = await back("lea", { request: claires.id })
    await admin`update platform.hosted_link_requests set expires_at = now() - interval '1 second' where id = ${claires.id}`
    const expired = await back("claire", { request: claires.id })
    const malformed = await back("lea", { request: "../../etc" })
    expect([outcome(replayed), outcome(another), outcome(expired), outcome(malformed)]).toEqual([
      ["/admin/connectors", "failed", "not_found"],
      ["/admin/connectors", "failed", "not_found"],
      ["/admin/connectors", "failed", "expired"],
      ["/admin/connectors", "failed", "not_found"],
    ])
    expect(await accountsOf("claire")).toEqual([])
    expect((await journal("GET hosted-link/callback")).slice(already).map((line) => line.error?.split(":")[0])).toEqual([
      "not_found",
      "not_found",
      "invalid_arguments",
      "not_found",
    ])
  })

  it("should consume every open request of the person for this connector when one links", async () => {
    await start("lea")
    const first = await lastRequest("lea")
    await connect("lea", accountId("lea"))
    const rows = await admin<{ consumed_at: Date | null }[]>`select consumed_at from platform.hosted_link_requests where user_id = ${o.people.lea.id} and connector = ${CONNECTOR}`
    expect(rows).toHaveLength(2)
    expect(rows.every((row) => row.consumed_at !== null)).toBe(true)
    expect(outcome(await back("lea", { request: first.id }))).toEqual(["/admin/connectors", "failed", "not_found"])
  })

  it("should take the hint only as a restriction: whitelisted before any call, never in an address, never lifting a guard", async () => {
    await start("lea")
    const request = await lastRequest("lea")
    const [one, two] = [accountId("one"), accountId("two")]
    fake.state.accounts = [
      { id: one, createdAt: near(request, 1), probe: "alive", who: who("lea") },
      { id: two, createdAt: near(request, 2), probe: "alive", who: "someone@contoso.test" },
    ]
    fake.calls.length = 0
    for (const hint of ["..", "a/b", "%2F", "a?b", "a#b", "x".repeat(129)]) {
      expect(outcome(await back("lea", { request: request.id, account_id: hint }))).toEqual(["/admin/connectors", "failed", "invalid_arguments"])
    }
    expect(fake.calls).toEqual([])
    const absent = await back("lea", { request: request.id, account_id: accountId("absent") })
    const ambiguous = await back("lea", { request: request.id })
    expect([outcome(absent), outcome(ambiguous)]).toEqual([
      ["/admin/connectors", "failed", "no_candidate"],
      ["/admin/connectors", "failed", "ambiguous_candidates"],
    ])
    expect(fake.calls.filter((call) => call.method === "probe").every((call) => call.input === one || call.input === two)).toBe(true)
    const hinted = await back("lea", { request: request.id, account_id: one })
    expect(outcome(hinted)).toEqual(["/admin/connectors", "connected", label("lea")])
    expect(hinted.toString()).not.toContain(one)
    expect(await accountsOf("lea")).toMatchObject([{ linked_id: one }])
  })

  it("should say ambiguous when another person's open request could cover the only candidate, and link once it cannot", async () => {
    await start("claire")
    const claires = await lastRequest("claire")
    await start("lea")
    const request = await lastRequest("lea")
    const id = accountId("lea")
    fake.state.accounts = [{ id, createdAt: near(request, 1), probe: "alive", who: who("lea") }]
    const covered = await back("lea", { request: request.id })
    expect(outcome(covered)).toEqual(["/admin/connectors", "failed", "ambiguous_candidates"])
    const lines = await journal("GET hosted-link/callback")
    expect(lines.at(-1)?.error).toBe(`conflict: Several ${LABEL} accounts could match this request. Nothing was saved; connect the account again in a few minutes. (ambiguous_candidates)`)
    // Une demande de l'autre personne posée plus de 5 minutes après la création du compte ne le couvre pas.
    await admin`update platform.hosted_link_requests set created_at = ${near(request, 7)}::timestamptz, expires_at = ${near(request, 60)}::timestamptz where id = ${claires.id}`
    expect(outcome(await back("lea", { request: request.id }))).toEqual(["/admin/connectors", "connected", label("lea")])
  })

  it("should let only one of two concurrent links of the same id win", async () => {
    const id = accountId("lea")
    await start("lea")
    const first = await lastRequest("lea")
    await start("lea")
    const second = await lastRequest("lea")
    fake.state.accounts = [{ id, createdAt: near(first, 1), probe: "alive", who: who("lea") }]
    const both = await Promise.all([back("lea", { request: first.id }), back("lea", { request: second.id })])
    // La seconde attend la première sans interblocage, puis trouve sa demande consommée.
    expect(both.map((location) => location.searchParams.get("reason") ?? location.searchParams.get("hosted")).sort()).toEqual(["connected", "not_found"])
    expect(await linkedRows(id)).toHaveLength(1)
  })

  it("should refuse a link onto a label another account of the organisation holds, writing nothing", async () => {
    await admin`
      insert into platform.accounts (org_id, connector, owner_kind, label, mode, status)
      values (${o.org.id}, ${CONNECTOR}, 'org', ${label("lea")}, 'reel', 'active')`
    const location = await connect("lea", accountId("lea"))
    expect(outcome(location)).toEqual(["/admin/connectors", "failed", "conflict"])
    expect(await admin`select 1 from platform.accounts where connector = ${CONNECTOR} and linked_id is not null`).toHaveLength(0)
  })

  it("should refuse to set linked_id or a host field by hand, and refuse a call on an account not linked yet", async () => {
    const ada = person("ada", o)
    const withId = await refusal(createAccount(ada.db, ada.identity, { connector: CONNECTOR, owner_kind: "org", label: `Crm ${hex(3)}`, mode: "reel", linked_id: "x" }))
    expect([withId.code, withId.message]).toEqual(["invalid_arguments", "linked_id is never set by hand: it is written only when a person connects their own account (Connect my account)."])
    const manual = await createAccount(ada.db, ada.identity, { connector: CONNECTOR, owner_kind: "org", label: `Crm ${hex(3)}`, mode: "reel" })
    const idInput = await refusal(setAccountSecret(ada.db, ada.identity, { account_id: manual.id, input: { linked_id: "x" } }))
    const hostField = await refusal(setAccountSecret(ada.db, ada.identity, { account_id: manual.id, input: { secret: { api_key: "mine" } } }))
    expect([idInput.code, hostField.code, hostField.message]).toEqual(["invalid_arguments", "invalid_arguments", `Field api_key of ${CONNECTOR} is provided by this application, never set on an account.`])
    const notLinked = await refusal(callFunction(ada.db, ada.identity, { function: `${CONNECTOR}.list_contacts`, account: manual.label }, { origin: origin(o) }))
    expect([notLinked.code, notLinked.message]).toEqual(["not_enabled", expect.stringMatching(new RegExp(`^Account « ${manual.label} » is not connected to ${LABEL} yet\\. Ask .+ to connect it \\(Connect my account\\)\\.$`))])
    expect(sent).toEqual([])
  })

  it("should refuse a call and a link without the host's key, and a link without the host's port, by name", async () => {
    await connect("lea", accountId("lea"))
    register({ host: false })
    const lea = person("lea", o)
    const called = await refusal(callFunction(lea.db, lea.identity, { function: `${CONNECTOR}.list_contacts` }, { origin: origin(o) }))
    const started = await start("lea")
    const message = `${LABEL} needs the API key of this application, which is not configured. Ask whoever runs this application to configure it.`
    expect([called.code, called.message, started.status, started.error]).toEqual(["not_enabled", message, 403, { code: "not_enabled", message }])
    register({ port: false })
    const portless = await start("lea")
    expect([portless.status, portless.error?.code]).toEqual([403, "not_enabled"])
    expect(sent).toEqual([])
  })

  it("should keep linked_id out of reach of authenticated: no read, no insert, no update, and no update of a request", async () => {
    const id = accountId("lea")
    await connect("lea", id)
    const [account] = await accountsOf("lea")
    const lea = fx.as(o.people.lea)
    expect(await codeOf(lea.tx((sql) => sql`update platform.accounts set linked_id = 'forged' where id = ${account.id}`))).toBe("42501")
    expect(await codeOf(lea.tx((sql) => sql`select linked_id from platform.accounts where id = ${account.id}`))).toBe("42501")
    expect(
      await codeOf(
        lea.tx((sql) => sql`
          insert into platform.accounts (org_id, connector, owner_kind, owner_user_id, label, mode, status, linked_id)
          values (${o.org.id}, ${CONNECTOR}, 'user', ${o.people.lea.id}, ${`Forged ${hex(3)}`}, 'reel', 'active', 'forged')`),
      ),
    ).toBe("42501")
    expect(await codeOf(lea.tx((sql) => sql`update platform.hosted_link_requests set consumed_at = null where user_id = ${o.people.lea.id}`))).toBe("42501")
    expect(await linkedRows(id)).toHaveLength(1)
    expect(await linkedRows("forged")).toHaveLength(0)
  })

  it("should serve a function that engages under its _act name: read under it, called under it and journaled so, refused under the plain name", async () => {
    await connect("lea", accountId("lea"))
    const lea = person("lea", o)
    const served = `${CONNECTOR}_act.post_entry`
    const read = await readNode(lea.db, lea.identity, { path: served })
    expect(read.text.split("\n")[0]).toBe(`Function ${served} (connector ${CONNECTOR}, origin connecteur, class sensitive: two-step confirmation)`)
    const unread = await refusal(readNode(lea.db, lea.identity, { path: `${CONNECTOR}.post_entry` }))
    expect(unread.code).toBe("not_found")

    const args = { label: "Fees", lines: [{ debit: "15.00" }, { credit: "15" }] }
    const done = await callFunction(lea.db, lea.identity, { function: served, arguments: args, confirm: true, account: label("lea") }, { origin: origin(o) })
    expect([done.status, sent.at(-1)?.url]).toEqual(["done", expect.stringMatching(/\/entries$/)])
    const plain = await refusal(callFunction(lea.db, lea.identity, { function: `${CONNECTOR}.post_entry`, arguments: args, confirm: true, account: label("lea") }, { origin: origin(o) }))
    expect([plain.code, plain.message]).toEqual(["not_found", `Unknown function ${CONNECTOR}.post_entry: it engages or destroys, so it is served as ${served}. Call ${served}.`])
    expect(sent.filter((request) => request.url.endsWith("/entries"))).toHaveLength(1)
    const lines = await admin<{ target: string | null; is_error: boolean }[]>`
      select target, is_error from platform.journal where org_id = ${o.org.id} and tool = 'call' and target like ${`%post_entry`} order by id`
    expect(lines.slice(-2)).toEqual([{ target: served, is_error: false }, { target: `${CONNECTOR}.post_entry`, is_error: true }])
  })
})
