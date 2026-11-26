// @vitest-environment node
// Un connecteur à deux accès (`connecteurs-et-comptes.md` § Plusieurs accès), sur une vraie base et par la vraie porte :
// le compte de l'organisation créé à la main par l'accès du compte de service, qui retient son accès, reçoit sa clé et
// se signe par une assertion échangée ; la création sans accès, par un accès inconnu ou par l'accès à consentement,
// refusée nommément ; le consentement d'une personne par l'accès de connexion, son retour qui range un compte retenant
// cet accès, appelé par le jeton de la personne ; un consentement qui ne nomme pas d'accès, refusé ; le formulaire de
// chaque accès ; la page de connexion qui fait choisir l'accès, puis offre les autres à côté du geste de l'un, et le
// refus sans compte qui les nomme. Un tiers simulé tient lieu de fournisseur : `fetch` remplacé, aucun réseau ; jetons tirés à l'exécution.
import { randomBytes } from "crypto"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { credentialValue, jwtBearerCases } from "@otomata_tech/connectors/jwt-bearer-cases"
import { handlePlateforme } from "@otomata_tech/oto_platform/api"
import { callFunction, createAccount, setAccountSecret } from "@otomata_tech/oto_platform/server"
import { connectorAccountForms } from "../../packages/plateforme/server/connectors/account-secret"
import { connectionStep } from "../../packages/plateforme/server/connectors/connect-page"
import { registerConnectors } from "../../packages/plateforme/server/connectors/declaration"
import type { Fetch } from "../../packages/plateforme/server/connectors/http"
import type { PlatformDb } from "../../packages/plateforme/server/db"
import { PlatformError } from "../../packages/plateforme/server/errors"
import { resolveIdentity, type Identity } from "../../packages/plateforme/server/identity"
import { SERVICE_ACCOUNT_TOKEN_URL, TEST_APPLICATION, TWO_ACCESSES, twoAccessConnector } from "../factories/described-connector"
import { pendingMigrations, pendingReason } from "../helpers/pending-migrations"
import { hex } from "../helpers/plateforme"
import { createLocalFixtures, type LocalFixtures } from "../helpers/session-locale"
import { SQL_SKIP_REASON, sqlConfigured, testAdminSql, type SqlReferenceOrg, type TestSql } from "../helpers/sql"

const VERSION = "20261119210949"
const pending = (await pendingMigrations()).includes(VERSION)

const CONNECTOR = `t${hex(4)}`
const CONSENT_TOKEN_URL = "https://login.crm.example.test/token"
const IDENTITY_URL = "https://id.crm.example.test/v1/userinfo"
const API = "https://crm.example.test/v2"
const { serviceAccount: SERVICE, signIn: SIGN_IN } = TWO_ACCESSES
type Caller = "ada" | "lea"

const leveled = jwtBearerCases.find((c) => c.name === "assertion_at_default_level")
if (!leveled) throw new Error("the common case assertion_at_default_level is missing")

const secret = (prefix: string) => `${prefix}_${randomBytes(16).toString("hex")}`
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

/**
 * Le tiers simulé : l'adresse de jeton du compte de service (une assertion contre un jeton), celle du consentement (un
 * code contre des jetons), l'identité et l'API, qui répondent à un jeton émis. `sent` relève chaque requête.
 */
function thirdParty() {
  const issued = new Map<string, string>()
  const sent: { url: string; authorization: string | null }[] = []
  const issue = (who: string) => {
    const access = secret("at")
    issued.set(access, who)
    return { access_token: access, refresh_token: secret("rt"), expires_in: 3600, scope: "offline_access contacts.read", token_type: "Bearer" }
  }
  const fetcher: Fetch = async (url, init) => {
    const authorization = new Headers(init.headers).get("authorization")
    sent.push({ url, authorization })
    const form = new URLSearchParams(typeof init.body === "string" ? init.body : "")
    if (url === SERVICE_ACCOUNT_TOKEN_URL) return form.get("assertion") ? json(issue("service")) : json({ error: "invalid_grant" }, 400)
    if (url === CONSENT_TOKEN_URL) return form.get("code") ? json(issue(form.get("code") ?? "")) : json({ error: "invalid_grant" }, 400)
    const who = issued.get((authorization ?? "").replace(/^Bearer /, ""))
    if (!who) return json({ error: "unauthorized" }, 401)
    if (url === IDENTITY_URL) return json({ sub: who, email: who })
    if (url.startsWith(`${API}/contacts`)) return json({ items: [{ id: "c-1", owner: who }], has_more: false })
    return json({ scopes: ["contacts.read"] })
  }
  return { fetcher, sent, tokenOf: (who: string) => [...issued].find(([, owner]) => owner === who)?.[0] }
}

async function refusal(run: Promise<unknown>): Promise<PlatformError> {
  const error = await run.then(
    () => null,
    (reason: unknown) => reason,
  )
  if (!(error instanceof PlatformError)) throw new Error(`expected a PlatformError, got ${String(error)}`)
  return error
}

const suite = !sqlConfigured ? `connector with several accesses (${SQL_SKIP_REASON})` : pending ? `connector with several accesses (${pendingReason([VERSION])})` : "connector with several accesses"

describe.skipIf(!sqlConfigured || pending)(suite, { timeout: 120_000 }, () => {
  let fx: LocalFixtures
  let admin: TestSql
  let o: SqlReferenceOrg
  let tier: ReturnType<typeof thirdParty>
  const tokens = new Map<Caller, string>()
  const people = new Map<Caller, { db: PlatformDb; identity: Identity }>()
  const savedKey = process.env.PLATFORM_VAULT_KEY
  const origin = () => `https://${o.host}`
  const person = (caller: Caller) => {
    const found = people.get(caller)
    if (!found) throw new Error(`no person ${caller}`)
    return found
  }

  const register = () => registerConnectors([twoAccessConnector(CONNECTOR)], { oauthApplications: { [CONNECTOR]: TEST_APPLICATION } })

  async function gate(caller: Caller, method: string, path: string, body?: unknown): Promise<Response> {
    const tasks: (() => Promise<void>)[] = []
    const request = new Request(`${origin()}/api/platform/${path}`, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: { origin: origin(), "x-forwarded-proto": "https", "content-type": "application/json", "user-agent": "plusieurs-acces-test" },
    })
    const response = await handlePlateforme(request, { accessToken: tokens.get(caller) ?? null, host: o.host, verifyToken: fx.verifyToken, defer: (task) => tasks.push(task) })
    for (const task of tasks) await task()
    return response
  }

  const accessOf = async (id: string) => (await admin<{ access: string | null }[]>`select access from platform.accounts where id = ${id}`)[0]?.access

  beforeAll(async () => {
    process.env.PLATFORM_VAULT_KEY = randomBytes(32).toString("base64")
    register()
    fx = createLocalFixtures()
    admin = testAdminSql()
    await admin`insert into platform.connectors (name, label) values (${CONNECTOR}, 'Crm')`
    o = await fx.buildReferenceOrg()
    await fx.addActivation(o.org.id, CONNECTOR)
    for (const caller of ["ada", "lea"] as const) {
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
      await admin`delete from platform.connectors where name = ${CONNECTOR}`
    } finally {
      await admin?.end({ timeout: 5 })
    }
  }, 180_000)

  beforeEach(() => {
    tier = thirdParty()
    vi.stubGlobal("fetch", tier.fetcher)
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("should give one form per access, the access named in each", () => {
    const forms = connectorAccountForms().filter((form) => form.connector === CONNECTOR)
    expect(forms.map((form) => [form.access?.name, form.consent, form.ownerKinds])).toEqual([
      [SERVICE, false, ["org", "team"]],
      [SIGN_IN, true, ["user"]],
    ])
  })

  it("should let the page choose the access, offer the others beside the gesture of one, and name them in a refusal without account", async () => {
    const [ada, lea] = [person("ada"), person("lea")]
    const step = (who: { db: PlatformDb; identity: Identity }, query: Record<string, string>) =>
      connectionStep(who.db, who.identity, { connector: CONNECTOR, ...query }, { origin: origin() })
    const service = { name: SERVICE, label: "Service account of the organization", gesture: "key" }
    const signIn = { name: SIGN_IN, label: "Sign-in of a person", gesture: "oauth" }
    expect(await step(lea, {})).toEqual({ kind: "choose_access", connector: CONNECTOR, label: "Crm", accesses: [service, signIn] })
    // Un espace nommé : contrôlé pour chaque accès avant toute liste ; un accès qu'il ne permet pas n'est pas offert, et
    // chaque lien garde l'espace.
    expect(await step(ada, { space: "org" })).toEqual({ kind: "choose_access", connector: CONNECTOR, label: "Crm", accesses: [{ ...service, space: "org" }] })
    expect(await step(lea, { space: "me" })).toEqual({ kind: "choose_access", connector: CONNECTOR, label: "Crm", accesses: [{ ...signIn, space: "me" }] })
    // Un espace refusé pour tous les accès : refusé nommément, aucun accès listé.
    const forbidden = await refusal(step(lea, { space: "org" }))
    expect([forbidden.code, forbidden.details]).toEqual(["forbidden", { reason: "space", space: "org" }])
    expect((await refusal(step(lea, { space: "team:inconnue" }))).code).toBe("not_found")
    // Les autres accès offerts à côté du geste d'un accès gardent aussi l'espace nommé.
    expect(await step(lea, { access: SIGN_IN, space: "me" })).toMatchObject({ kind: "authorize", space: "me", others: [{ ...service, space: "me" }] })
    expect(await step(lea, { access: SIGN_IN })).toEqual({ kind: "authorize", gesture: "oauth", connector: CONNECTOR, label: "Crm", space: "me", access: SIGN_IN, others: [service] })
    const key = await step(ada, { access: SERVICE })
    const asked = await step(lea, { access: SERVICE })
    expect([key.kind, "space" in key ? key.space : null, "others" in key ? key.others : null, asked.kind, "others" in asked ? asked.others : null]).toEqual(["key", "org", [signIn], "ask_admin", [signIn]])
    const refused = await refusal(callFunction(lea.db, lea.identity, { function: `${CONNECTOR}.list_contacts` }, { origin: origin() }))
    expect([refused.code, refused.details?.reason, refused.details?.gesture, refused.details?.access, refused.details?.space]).toEqual(["not_enabled", "no_account", "oauth", SIGN_IN, "me"])
    expect(refused.message).toContain(`Crm also opens by another access, ${SERVICE} (Service account of the organization), which the link offers too. Ask the user to authorize Crm`)
    expect(tier.sent).toEqual([])
  })

  it("should create an account of the organisation by the service account, retain its access, take its key and sign a call by an exchanged assertion", async () => {
    const ada = person("ada")
    const label = `Crm ${hex(3)}`
    const created = await createAccount(ada.db, ada.identity, { connector: CONNECTOR, owner_kind: "org", label, mode: "reel", access: SERVICE })
    expect([created.access, await accessOf(created.id)]).toEqual([SERVICE, SERVICE])
    await setAccountSecret(ada.db, ada.identity, { account_id: created.id, input: { secret: { service_account_key: credentialValue(leveled) } } })
    await callFunction(ada.db, ada.identity, { function: `${CONNECTOR}.list_contacts`, account: label }, { origin: origin() })
    expect(tier.sent.map((request) => [request.url.split("?")[0], request.authorization])).toEqual([
      [SERVICE_ACCOUNT_TOKEN_URL, null],
      [`${API}/contacts`, `Bearer ${tier.tokenOf("service")}`],
    ])
  })

  it("should refuse by name an account without access, by an unknown access, or by the access of a consent, writing nothing", async () => {
    const ada = person("ada")
    const create = (access?: string) => createAccount(ada.db, ada.identity, { connector: CONNECTOR, owner_kind: "org", label: `Crm ${hex(3)}`, mode: "reel", ...(access ? { access } : {}) })
    const [none, unknown, consent] = [await refusal(create()), await refusal(create("other")), await refusal(create(SIGN_IN))]
    expect([none.code, none.details?.reason, unknown.code, unknown.details?.reason, consent.code]).toEqual(["invalid_arguments", "access", "invalid_arguments", "access", "invalid_arguments"])
    const [{ count }] = await admin<{ count: number }[]>`select count(*)::int as count from platform.accounts where org_id = ${o.org.id} and connector = ${CONNECTOR} and access is null`
    expect(count).toBe(0)
  })

  it("should connect a person by the sign-in access: the consent and the account it stores retain the access, and a call carries the person's token", async () => {
    const started = await gate("lea", "POST", "connector-consent", { connector: CONNECTOR, access: SIGN_IN })
    const { data } = (await started.json()) as { data: { url: string } }
    const address = new URL(data.url)
    const [consent] = await admin<{ access: string | null }[]>`select access from platform.connector_consents where org_id = ${o.org.id} and user_id = ${o.people.lea.id} order by expires_at desc limit 1`
    expect([started.status, address.origin, consent.access]).toEqual([200, "https://login.crm.example.test", SIGN_IN])
    const who = o.people.lea.email
    const back = await gate("lea", "GET", `connector-consent/callback?${new URLSearchParams({ code: who, state: address.searchParams.get("state") ?? "" }).toString()}`)
    const location = new URL(back.headers.get("location") ?? "")
    expect([back.status, location.searchParams.get("consent")]).toEqual([302, "connected"])
    const [account] = await admin<{ id: string; access: string | null; owner_kind: string }[]>`
      select id, access, owner_kind from platform.accounts where org_id = ${o.org.id} and connector = ${CONNECTOR} and owner_user_id = ${o.people.lea.id}`
    expect([account.access, account.owner_kind]).toEqual([SIGN_IN, "user"])
    tier.sent.length = 0
    const lea = person("lea")
    await callFunction(lea.db, lea.identity, { function: `${CONNECTOR}.list_contacts`, account: `${who} (${CONNECTOR})` }, { origin: origin() })
    expect(tier.sent.map((request) => [request.url.split("?")[0], request.authorization])).toEqual([[`${API}/contacts`, `Bearer ${tier.tokenOf(who)}`]])
  })

  it("should refuse a consent that names no access, or the access of the service account", async () => {
    const start = async (body: unknown) => {
      const response = await gate("lea", "POST", "connector-consent", body)
      return [response.status, ((await response.json()) as { error?: { code: string } }).error?.code]
    }
    expect([await start({ connector: CONNECTOR }), await start({ connector: CONNECTOR, access: SERVICE })]).toEqual([
      [400, "invalid_arguments"],
      [400, "invalid_arguments"],
    ])
  })
})
