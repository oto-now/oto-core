// @vitest-environment node
// Le consentement d'une personne à un connecteur `oauth2_user`, sur une vraie base et par la vraie porte : départ
// (`POST connector-consent`) et retour (`GET connector-consent/callback`) sous le jeton de personnes jetables, leurs
// lignes de journal ; le code échangé avec la preuve PKCE, l'identité lue, les jetons chiffrés sur le compte
// personnel, jamais en clair en base ni au journal ; un `state` inconnu, rejoué, échu ou d'une autre personne refusé ;
// l'appel par `callFunction` sur le compte de la personne sans le nommer ; le renouvellement à l'échéance et après un
// 401, la rotation du jeton de rafraîchissement ; un renouvellement refusé qui passe le compte à reconnecter, et la
// reconnexion ; le compte partagé, qui suit le chemin de tout compte personnel ; le compte fait à la main et la saisie
// d'un secret refusés ; un connecteur à niveaux d'accès (droits de `full` demandés) dont l'identité se lit à une
// adresse complète, et son refus quand la réponse ne dit pas qui a consenti. Un fournisseur OAuth simulé tient lieu du
// tiers : `fetch` remplacé, aucun réseau. Jetons et secrets tirés à l'exécution.
import { createHash, randomBytes } from "crypto"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { handlePlateforme } from "@otomata_tech/oto_platform/api"
import { callFunction, createAccount, setAccountSecret, setAccountRule } from "@otomata_tech/oto_platform/server"
import { registerConnectors } from "../../packages/plateforme/server/connectors/declaration"
import type { Fetch } from "../../packages/plateforme/server/connectors/http"
import { decryptCredential, decryptToken } from "../../packages/plateforme/server/connectors/vault"
import type { PlatformDb } from "../../packages/plateforme/server/db"
import { PlatformError } from "../../packages/plateforme/server/errors"
import { resolveIdentity, type Identity } from "../../packages/plateforme/server/identity"
import { consentConnector, leveledConsentConnector, TEST_APPLICATION } from "../factories/described-connector"
import { pendingMigrations, pendingReason } from "../helpers/pending-migrations"
import { hex } from "../helpers/plateforme"
import { createLocalFixtures, type LocalFixtures } from "../helpers/session-locale"
import { SQL_SKIP_REASON, sqlConfigured, testAdminSql, type SqlReferenceOrg, type TestSql } from "../helpers/sql"

const VERSION = "20261016090000"
const pending = (await pendingMigrations()).includes(VERSION)

const CONNECTOR = `t${hex(4)}`
/** Le connecteur à niveaux d'accès, son identité lue à une adresse complète. */
const LEVELED = `t${hex(4)}`
const TOKEN_URL = "https://login.crm.example.test/token"
const IDENTITY_URL = "https://id.crm.example.test/v1/userinfo"
const API = "https://crm.example.test/v2"
type Caller = "ada" | "lea" | "claire"
type Task = () => Promise<void>

const secret = (prefix: string) => `${prefix}_${randomBytes(16).toString("hex")}`
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
const base64url = (bytes: Buffer) => bytes.toString("base64url")

/**
 * Le fournisseur OAuth simulé : codes émis à l'autorisation (avec leur preuve PKCE attendue), jetons d'accès et de
 * rafraîchissement valides, rotation à chaque renouvellement ; l'API répond à un jeton d'accès valide. `sent` relève
 * chaque requête.
 */
function oauthProvider() {
  const codes = new Map<string, { challenge: string; who: string; redirectUri: string }>()
  const access = new Map<string, string>()
  const refresh = new Map<string, string>()
  const sent: { url: string; body: string; authorization: string | null }[] = []
  const issued: string[] = []
  let last: [string, string] = ["", ""]
  let unauthorizedOnce = false
  let identityWithoutEmail = false
  const issue = (who: string) => {
    const [accessToken, refreshToken] = [secret("at"), secret("rt")]
    access.set(accessToken, who)
    refresh.set(refreshToken, who)
    issued.push(accessToken, refreshToken)
    last = [accessToken, refreshToken]
    return { access_token: accessToken, refresh_token: refreshToken, expires_in: 3600, scope: "offline_access contacts.read", token_type: "Bearer" }
  }
  const fetcher: Fetch = async (url, init) => {
    const body = typeof init.body === "string" ? init.body : ""
    const authorization = new Headers(init.headers).get("authorization")
    sent.push({ url, body, authorization })
    if (url === TOKEN_URL) {
      const form = new URLSearchParams(body)
      if (form.get("client_id") !== TEST_APPLICATION.clientId || form.get("client_secret") !== TEST_APPLICATION.clientSecret) return json({ error: "invalid_client" }, 401)
      if (form.get("grant_type") === "authorization_code") {
        const code = codes.get(form.get("code") ?? "")
        codes.delete(form.get("code") ?? "")
        const proof = base64url(createHash("sha256").update(form.get("code_verifier") ?? "").digest())
        if (!code || proof !== code.challenge || form.get("redirect_uri") !== code.redirectUri) return json({ error: "invalid_grant" }, 400)
        return json(issue(code.who))
      }
      const who = refresh.get(form.get("refresh_token") ?? "")
      if (form.get("grant_type") !== "refresh_token" || !who) return json({ error: "invalid_grant" }, 400)
      refresh.delete(form.get("refresh_token") ?? "")
      return json(issue(who))
    }
    const who = access.get((authorization ?? "").replace(/^Bearer /, ""))
    if (!who || unauthorizedOnce) {
      unauthorizedOnce = false
      return json({ error: "unauthorized" }, 401)
    }
    if (url === `${API}/me`) return json({ email: who, scopes: ["contacts.read"] })
    if (url === IDENTITY_URL) return json(identityWithoutEmail ? { sub: who } : { sub: who, email: who })
    if (url.startsWith(`${API}/contacts`)) return json({ items: [{ id: "c-1", owner: who }], has_more: false })
    return json({}, 404)
  }
  return {
    fetcher,
    sent,
    /** La personne consent chez le tiers : un code émis pour la preuve PKCE et l'adresse de retour de l'adresse d'autorisation. */
    authorize(address: string, who: string): { code: string; state: string } {
      const url = new URL(address)
      const code = secret("code")
      codes.set(code, { challenge: url.searchParams.get("code_challenge") ?? "", who, redirectUri: url.searchParams.get("redirect_uri") ?? "" })
      return { code, state: url.searchParams.get("state") ?? "" }
    },
    revokeAll: () => refresh.clear(),
    unauthorizedOnce: () => {
      unauthorizedOnce = true
    },
    /** L'adresse d'identité répond sans dire l'adresse de qui a consenti. */
    identityWithoutEmail: () => {
      identityWithoutEmail = true
    },
    /** Le dernier jeton d'accès et le dernier jeton de rafraîchissement émis. */
    latest: () => last,
    /** Tous les jetons émis. */
    issued: () => issued,
  }
}

async function refusal(run: Promise<unknown>): Promise<PlatformError> {
  const error = await run.then(
    () => null,
    (reason: unknown) => reason,
  )
  if (!(error instanceof PlatformError)) throw new Error(`expected a PlatformError, got ${String(error)}`)
  return error
}

const suite = !sqlConfigured ? `person's consent (${SQL_SKIP_REASON})` : pending ? `person's consent (${pendingReason([VERSION])})` : "person's consent to an oauth2_user connector"

describe.skipIf(!sqlConfigured || pending)(suite, { timeout: 120_000 }, () => {
  let fx: LocalFixtures
  let admin: TestSql
  let o: SqlReferenceOrg
  let provider: ReturnType<typeof oauthProvider>
  const tokens = new Map<Caller, string>()
  const people = new Map<Caller, { db: PlatformDb; identity: Identity }>()
  const savedKey = process.env.PLATFORM_VAULT_KEY
  const origin = () => `https://${o.host}`
  const who = (caller: Caller) => `${caller}@contoso.test`
  const label = (caller: Caller) => `${who(caller)} (${CONNECTOR})`

  const register = (withApplication = true) =>
    registerConnectors([consentConnector(CONNECTOR), leveledConsentConnector(LEVELED)], withApplication ? { oauthApplications: { [CONNECTOR]: TEST_APPLICATION, [LEVELED]: TEST_APPLICATION } } : {})

  async function gate(caller: Caller, method: string, path: string, body?: unknown): Promise<Response> {
    const tasks: Task[] = []
    const request = new Request(`${origin()}/api/platform/${path}`, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: { origin: origin(), "x-forwarded-proto": "https", "content-type": "application/json", "user-agent": "consentement-test" },
    })
    const response = await handlePlateforme(request, { accessToken: tokens.get(caller) ?? null, host: o.host, verifyToken: fx.verifyToken, defer: (task) => tasks.push(task) })
    for (const task of tasks) await task()
    return response
  }

  async function start(caller: Caller, body: unknown = { connector: CONNECTOR }): Promise<{ status: number; url: string; error?: { code: string; message: string } }> {
    const response = await gate(caller, "POST", "connector-consent", body)
    const answer = (await response.json()) as { data?: { url: string }; error?: { code: string; message: string } }
    return { status: response.status, url: answer.data?.url ?? "", error: answer.error }
  }

  async function back(caller: Caller, query: Record<string, string>): Promise<URL> {
    const response = await gate(caller, "GET", `connector-consent/callback?${new URLSearchParams(query).toString()}`)
    expect(response.status).toBe(302)
    return new URL(response.headers.get("location") ?? "")
  }

  /** Départ, consentement chez le tiers, retour : l'adresse où le navigateur revient. */
  async function connect(caller: Caller, as = who(caller)): Promise<URL> {
    const { url } = await start(caller)
    return back(caller, provider.authorize(url, as))
  }

  const accountOf = async (caller: Caller, connector = CONNECTOR) =>
    (
      await admin<{ id: string; label: string; owner_kind: string; owner_user_id: string; mode: string; status: string; status_reason: string | null; granted_scopes: string[] | null; secret_ciphertext: string; token_ciphertext: string; secret_fields: string[] }[]>`
        select id, label, owner_kind, owner_user_id, mode, status, status_reason, granted_scopes, secret_ciphertext, token_ciphertext, secret_fields
          from platform.accounts where org_id = ${o.org.id} and connector = ${connector} and owner_user_id = ${o.people[caller].id}`
    )[0]
  const call = (caller: Caller, account?: string) => {
    const person = people.get(caller)
    if (!person) throw new Error(`no person ${caller}`)
    return callFunction(person.db, person.identity, { function: `${CONNECTOR}.list_contacts`, account }, { origin: origin() })
  }
  const journal = (tool: string) =>
    admin<{ target: string | null; is_error: boolean; error: string | null; args: unknown }[]>`
      select target, is_error, error, args from platform.journal where org_id = ${o.org.id} and tool = ${tool} order by id`

  beforeAll(async () => {
    process.env.PLATFORM_VAULT_KEY = randomBytes(32).toString("base64")
    register()
    fx = createLocalFixtures()
    admin = testAdminSql()
    await admin`insert into platform.connectors (name, label) values (${CONNECTOR}, 'Crm')`
    o = await fx.buildReferenceOrg()
    await fx.addActivation(o.org.id, CONNECTOR)
    for (const caller of ["ada", "lea", "claire"] as const) {
      const user = o.people[caller]
      tokens.set(caller, (await fx.sessionFor(user)).accessToken)
      const db = fx.as(user)
      people.set(caller, { db, identity: await resolveIdentity(db, o.host, { userId: user.id, email: user.email }) })
    }
  }, 180_000)

  afterAll(async () => {
    registerConnectors([])
    if (savedKey === undefined) delete process.env.PLATFORM_VAULT_KEY
    else process.env.PLATFORM_VAULT_KEY = savedKey
    try {
      await fx?.cleanup()
      await admin`delete from platform.connectors where name in (${CONNECTOR}, ${LEVELED})`
    } finally {
      await admin?.end({ timeout: 5 })
    }
  }, 180_000)

  beforeEach(() => {
    provider = oauthProvider()
    vi.stubGlobal("fetch", provider.fetcher)
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(() => {
    register()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("should start a consent for the signed-in person: the host's client, the return address, the scopes, a state and PKCE, only the state's hash kept", async () => {
    const { status, url } = await start("lea", { connector: CONNECTOR, return_to: "/dossiers/42?tab=pieces" })
    const address = new URL(url)
    const query = Object.fromEntries(address.searchParams)
    expect([status, address.origin + address.pathname]).toEqual([200, "https://login.crm.example.test/authorize"])
    expect(query).toMatchObject({
      response_type: "code",
      client_id: TEST_APPLICATION.clientId,
      redirect_uri: `${origin()}/api/platform/connector-consent/callback`,
      scope: "offline_access contacts.read",
      code_challenge_method: "S256",
      prompt: "select_account",
    })
    expect([query.state, query.code_challenge]).toEqual([expect.stringMatching(/^[A-Za-z0-9_-]{43}$/), expect.stringMatching(/^[A-Za-z0-9_-]{43}$/)])
    const rows = await admin<{ state_hash: string; user_id: string; connector: string; return_to: string }[]>`
      select state_hash, user_id, connector, return_to from platform.connector_consents where org_id = ${o.org.id}`
    expect(rows).toContainEqual({ state_hash: createHash("sha256").update(query.state).digest("hex"), user_id: o.people.lea.id, connector: CONNECTOR, return_to: "/dossiers/42?tab=pieces" })
    expect(JSON.stringify(rows)).not.toContain(query.state)
    const lines = await journal("POST connector-consent")
    expect(lines.at(-1)).toMatchObject({ target: CONNECTOR, is_error: false })
  })

  it("should connect the person's own account on return: code exchanged with the PKCE proof, identity read, tokens encrypted, never in clear", async () => {
    const { url } = await start("lea", { connector: CONNECTOR, return_to: "/dossiers/42?tab=pieces" })
    const location = await back("lea", provider.authorize(url, who("lea")))
    expect([location.origin, location.pathname, Object.fromEntries(location.searchParams)]).toEqual([
      origin(),
      "/dossiers/42",
      { tab: "pieces", consent: "connected", account: label("lea") },
    ])
    const account = await accountOf("lea")
    expect(account).toMatchObject({ label: label("lea"), owner_kind: "user", owner_user_id: o.people.lea.id, mode: "reel", status: "active", granted_scopes: ["offline_access", "contacts.read"], secret_fields: ["refresh_token"] })
    const [accessToken, refreshToken] = provider.latest()
    expect([decryptToken(account.id, account.token_ciphertext), decryptCredential(account.id, account.secret_ciphertext)]).toEqual([accessToken, { fields: { refresh_token: refreshToken } }])
    const everything = JSON.stringify(await admin`select to_jsonb(a) as row from platform.accounts a where id = ${account.id}`) + JSON.stringify(await journal("GET connector-consent/callback"))
    for (const value of provider.issued()) expect(everything).not.toContain(value)
    expect((await journal("GET connector-consent/callback")).at(-1)).toMatchObject({ target: label("lea"), is_error: false, args: null })
    const state = new URL(url).searchParams.get("state") ?? ""
    expect(await admin`select 1 from platform.connector_consents where state_hash = ${createHash("sha256").update(state).digest("hex")}`).toHaveLength(0)
  })

  it("should refuse a replayed, unknown, expired state, or one another person started, saving nothing", async () => {
    const before = provider.sent.length
    const unknown = await back("lea", { state: base64url(randomBytes(32)), code: "x" })
    const { url } = await start("ada")
    const granted = provider.authorize(url, who("ada"))
    const elsewhere = await back("lea", granted)
    const { url: late } = await start("claire")
    await admin`update platform.connector_consents set expires_at = now() - interval '1 second' where user_id = ${o.people.claire.id}`
    const expired = await back("claire", provider.authorize(late, who("claire")))
    const first = await back("ada", granted)
    const replayed = await back("ada", granted)
    for (const refused of [unknown, elsewhere, expired, replayed]) {
      expect([refused.pathname, refused.searchParams.get("consent"), refused.searchParams.get("reason")]).toEqual(["/admin/connectors", "failed", "invalid_arguments"])
    }
    expect(first.searchParams.get("consent")).toBe("connected")
    // Une seule requête au tiers : l'échange du code d'ada, puis la lecture de son identité.
    expect(provider.sent.slice(before).map((request) => request.url)).toEqual([TOKEN_URL, `${API}/me`])
    expect(await accountOf("claire")).toBeUndefined()
    expect((await journal("GET connector-consent/callback")).filter((line) => line.is_error)).toHaveLength(4)
  })

  it("should say on return that the person refused, with the screen they left", async () => {
    const { url } = await start("claire", { connector: CONNECTOR, return_to: "/mes-comptes" })
    const location = await back("claire", { state: new URL(url).searchParams.get("state") ?? "", error: "access_denied" })
    expect([location.pathname, Object.fromEntries(location.searchParams)]).toEqual(["/mes-comptes", { consent: "failed", reason: "invalid_arguments" }])
    expect(provider.sent).toEqual([])
  })

  it("should run a function on the person's own account without naming it, and refuse whoever has not connected one", async () => {
    await connect("lea")
    const result = await call("lea")
    const [accessToken] = provider.latest()
    expect([result.status, result.account?.label, provider.sent.at(-1)?.authorization]).toEqual(["done", label("lea"), `Bearer ${accessToken}`])
    const none = await refusal(call("claire"))
    expect([none.code, none.message]).toEqual([
      "not_enabled",
      `No ${CONNECTOR} account of yours is connected: each person connects their own to ${CONNECTOR}. Ask the user to connect theirs in the application (Connect my account).`,
    ])
  })

  it("should renew at expiry and once after a 401, keeping the rotated refresh token; a refused renewal asks to connect again, and reconnecting restores the account", async () => {
    await connect("lea")
    const { id } = await accountOf("lea")
    await admin`update platform.accounts set token_expires_at = now() - interval '1 minute' where id = ${id}`
    await call("lea")
    provider.unauthorizedOnce()
    await call("lea")
    const renewed = await accountOf("lea")
    const live = provider.latest()
    expect(provider.sent.filter((request) => request.url === TOKEN_URL).map((request) => new URLSearchParams(request.body).get("grant_type"))).toEqual(["authorization_code", "refresh_token", "refresh_token"])
    expect([decryptToken(id, renewed.token_ciphertext), decryptCredential(id, renewed.secret_ciphertext)]).toEqual([live[0], { fields: { refresh_token: live[1] } }])

    provider.revokeAll()
    await admin`update platform.accounts set token_expires_at = now() - interval '1 minute' where id = ${id}`
    const revoked = await refusal(call("lea"))
    const reason = "Crm no longer accepts its authorization (expired or revoked)"
    expect([revoked.code, revoked.message]).toEqual(["not_enabled", `Your ${CONNECTOR} account « ${label("lea")} » must be connected again: ${reason}. Ask the user to connect it again in the application (Connect my account).`])
    expect(await accountOf("lea")).toMatchObject({ status: "error", status_reason: reason })
    const sent = provider.sent.length
    expect((await refusal(call("lea"))).message).toBe(revoked.message)
    expect(provider.sent.length).toBe(sent)

    await connect("lea")
    expect(await accountOf("lea")).toMatchObject({ id, status: "active", status_reason: null })
    expect((await call("lea")).status).toBe("done")
  })

  it("should share the account of a consent like any personal account: used by whoever receives it when named, renewed by its owner only", async () => {
    await connect("lea")
    const lea = people.get("lea")
    if (!lea) throw new Error("people missing")
    const { id } = await accountOf("lea")
    await setAccountRule(lea.db, lea.identity, { accountId: id, subject: { kind: "user", id: o.people.claire.id }, level: "write" })
    expect(await admin`select level from platform.access_rules where account_id = ${id}`).toHaveLength(1)

    // Comme tout compte personnel partagé (H83) : il ne sert à qui le reçoit que nommé ; sans nom, son appel cherche le sien.
    const unnamed = await refusal(call("claire"))
    expect(unnamed.message).toMatch(new RegExp(`^No ${CONNECTOR} account of yours is connected`))
    const named = await call("claire", label("lea"))
    expect([named.status, named.account?.id, provider.sent.at(-1)?.authorization]).toEqual(["done", id, `Bearer ${provider.latest()[0]}`])

    // Un renouvellement refusé pendant son appel : seule la personne du compte peut le reconnecter ; ensuite, le refus
    // ordinaire d'un compte nommé en erreur.
    provider.revokeAll()
    await admin`update platform.accounts set token_expires_at = now() - interval '1 minute' where id = ${id}`
    const revoked = await refusal(call("claire", label("lea")))
    const reason = "Crm no longer accepts its authorization (expired or revoked)"
    expect([revoked.code, revoked.message]).toEqual([
      "not_enabled",
      `The ${CONNECTOR} account « ${label("lea")} » must be connected again: ${reason}. Only its owner can, in the application (Connect my account): ask them.`,
    ])
    expect((await refusal(call("claire", label("lea")))).message).toBe(`Account « ${label("lea")} » is in error. Ask its owner to fix it, or name another account.`)
  })

  it("should refuse to create the account of a consent by hand, for any owner, and to set its secret", async () => {
    await connect("lea")
    const lea = people.get("lea")
    const ada = people.get("ada")
    if (!lea || !ada) throw new Error("people missing")
    const { id } = await accountOf("lea")
    const forOrg = await refusal(createAccount(ada.db, ada.identity, { connector: CONNECTOR, owner_kind: "org", label: `Crm ${hex(3)}`, mode: "reel" }))
    const own = await refusal(createAccount(lea.db, lea.identity, { connector: CONNECTOR, owner_kind: "user", label: `Crm ${hex(3)}`, mode: "reel" }))
    const secretSet = await refusal(setAccountSecret(lea.db, lea.identity, { account_id: id, input: { settings: { region: null } } }))
    expect([forOrg.code, own.code, secretSet.code]).toEqual(["invalid_arguments", "invalid_arguments", "invalid_arguments"])
    expect(own.message).toBe(`Accounts of ${CONNECTOR} are not created by hand: each person connects their own by consenting (Connect my account), then may share it like any personal account.`)
  })

  it("should connect a connector with access levels: the scopes of full and of the identity address asked, the identity read at its address with the new token", async () => {
    const { url } = await start("ada", { connector: LEVELED })
    expect(new URL(url).searchParams.get("scope")).toBe("offline_access contacts.write entries.write openid email")
    const location = await back("ada", provider.authorize(url, who("ada")))
    expect(Object.fromEntries(location.searchParams)).toEqual({ consent: "connected", account: `${who("ada")} (${LEVELED})` })
    expect(provider.sent.map((request) => [request.url, request.authorization])).toEqual([
      [TOKEN_URL, null],
      [IDENTITY_URL, `Bearer ${provider.latest()[0]}`],
    ])
    // Les droits accordés sont ceux que dit la réponse de jeton, gardés comme pour tout consentement.
    expect(await accountOf("ada", LEVELED)).toMatchObject({ label: `${who("ada")} (${LEVELED})`, owner_kind: "user", status: "active", granted_scopes: ["offline_access", "contacts.read"] })
  })

  it("should refuse an identity address whose answer does not say who consented, saving nothing", async () => {
    provider.identityWithoutEmail()
    const { url } = await start("claire", { connector: LEVELED })
    const location = await back("claire", provider.authorize(url, who("claire")))
    expect([location.pathname, Object.fromEntries(location.searchParams)]).toEqual(["/admin/connectors", { consent: "failed", reason: "upstream_error" }])
    expect(provider.sent.map((request) => request.url)).toEqual([TOKEN_URL, IDENTITY_URL])
    expect(await accountOf("claire", LEVELED)).toBeUndefined()
  })

  it("should refuse a consent and a call without the host's OAuth application, by name", async () => {
    await connect("lea")
    register(false)
    const started = await start("lea")
    const called = await refusal(call("lea"))
    const message = "Connecting Crm needs the OAuth application of this application, which is not configured. Ask whoever runs this application to configure it."
    expect([started.status, started.error, called.code, called.message]).toEqual([403, { code: "not_enabled", message }, "not_enabled", message])
  })
})
