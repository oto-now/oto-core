// @vitest-environment node
// Le consentement d'une personne (`oauth2_user`) dans le moteur, sur un `fetch` simulé, sans réseau ni base : la
// déclaration de la forme que rend la fabrique et ses refus nommés ; l'application OAuth fournie par l'hôte ;
// l'adresse d'autorisation ; à l'appel, le jeton d'accès gardé, renouvelé à l'échéance et une fois après un 401 (le
// jeton de rafraîchissement rendu remplace l'ancien), un renouvellement refusé qui passe le compte à reconnecter, une
// application refusée qui ne change rien au compte. Les niveaux d'accès déclarés, acceptés sans être appliqués : le
// consentement demande les droits de `full` ; l'identité lue à une adresse complète, en `GET` avec le jeton. Jetons
// tirés à l'exécution, jamais dans un log ni une erreur.
import { randomBytes } from "crypto"
import { afterEach, describe, expect, it, vi } from "vitest"
import { declaredConnector } from "../../packages/plateforme/server/catalog/connector-source"
import type { AccountCredential } from "../../packages/plateforme/server/connectors/auth"
import { registerConnectors } from "../../packages/plateforme/server/connectors/declaration"
import type { ConnectorDefinition } from "../../packages/plateforme/server/connectors/definition"
import { executeDescribed } from "../../packages/plateforme/server/connectors/engine"
import type { Fetch } from "../../packages/plateforme/server/connectors/http"
import { authorizationAddress } from "../../packages/plateforme/server/connectors/oauth-user"
import { CatalogRegistrationError } from "../../packages/plateforme/server/catalog/erp"
import { PlatformError } from "../../packages/plateforme/server/errors"
import { consentConnector, leveledConsentConnector, memoryConsent, memoryTokens, TEST_APPLICATION } from "../factories/described-connector"
import { loggedText } from "../helpers/logs"

const token = () => `t_${randomBytes(12).toString("hex")}`
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

function stub(...answers: Response[]) {
  const send = vi.fn<Fetch>(async () => answers.shift() ?? json({}))
  vi.stubGlobal("fetch", send)
  const sent = () =>
    send.mock.calls.map(([url, init]) => ({ url, method: init.method, redirect: init.redirect, headers: Object.fromEntries(new Headers(init.headers)), body: init.body === undefined ? undefined : String(init.body) }))
  return { send, sent }
}

/** L'adresse d'autorisation du connecteur déclaré `crm`, et ses paramètres. */
function authorizationOf(): { address: string; query: Record<string, string> } {
  const declared = declaredConnector("crm")
  if (declared?.auth.kind !== "user_consent") throw new Error("not a consent")
  const url = new URL(authorizationAddress(declared.auth, { clientId: "client-test", redirectUri: "https://acme.test/api/platform/connector-consent/callback", state: "s", codeChallenge: "c" }))
  return { address: url.origin + url.pathname, query: Object.fromEntries(url.searchParams) }
}

/** Le connecteur de test à niveaux d'accès sous une autre authentification, ou une fonction changée. */
function leveledVariant(auth: Record<string, unknown> = {}, change: (fn: ConnectorDefinition["functions"][number]) => ConnectorDefinition["functions"][number] = (fn) => fn): ConnectorDefinition {
  const base = leveledConsentConnector()
  return { ...base, auth: { ...base.auth, ...auth } as ConnectorDefinition["auth"], functions: base.functions.map(change) }
}

/** Le connecteur à consentement de test sous une autre authentification ou d'autres champs. */
function consentVariant(auth: Record<string, unknown> = {}, change: Partial<ConnectorDefinition> = {}): ConnectorDefinition {
  const base = consentConnector()
  return { ...base, ...change, auth: { ...base.auth, ...auth } as ConnectorDefinition["auth"] }
}

const register = (definition: ConnectorDefinition = consentConnector()) => registerConnectors([definition], { oauthApplications: { [definition.name]: TEST_APPLICATION } })

function registrationProblem(definition: ConnectorDefinition, applications?: Record<string, { clientId: string; clientSecret: string }>): string {
  try {
    registerConnectors([definition], { oauthApplications: applications })
  } catch (error) {
    if (error instanceof CatalogRegistrationError) return error.message
    throw error
  }
  return "accepted"
}

function getCompany(credential: AccountCredential) {
  const prepared = declaredConnector("crm")?.functions.find((fn) => fn.name === "crm.get_company")
  if (!prepared) throw new Error("crm.get_company is not declared")
  return prepared.run({ credential, account: { id: "account-1" } } as never, {} as never)
}

async function refusal(work: Promise<unknown>): Promise<PlatformError> {
  const error = await work.then(
    () => null,
    (reason: unknown) => reason,
  )
  if (!(error instanceof PlatformError)) throw new Error(`expected a PlatformError, got ${String(error)}`)
  return error
}

afterEach(() => {
  registerConnectors([])
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("oauth2_user declaration", () => {
  it("should accept the form the factory renders, with the host's OAuth application, and keep the identity function", () => {
    register()
    const declared = declaredConnector("crm")
    expect([declared?.auth.kind, declared?.identity?.fn.name, declared?.application]).toEqual(["user_consent", "crm.get_company", TEST_APPLICATION])
  })

  it("should accept the connector without an OAuth application, which the consent and the call then refuse", () => {
    registerConnectors([consentConnector()])
    expect(declaredConnector("crm")?.application).toBeNull()
  })

  it.each([
    ["credential fields", consentVariant({}, { credential: [{ name: "api_key", label: "API key", secret: true }] }), "crm: credential must be empty with oauth2_user: the tokens of a consent are not fields, and the OAuth application is the host's."],
    ["settings", consentVariant({}, { settings: [{ name: "region", label: "Region", type: "choice", choices: ["us", "eu"] }] }), "crm: auth oauth2_user takes no settings in this version of the package."],
    ["fromToken", consentVariant({ fromToken: ["instance_url"] }), "crm: auth oauth2_user: fromToken is not supported yet by the package."],
    ["a parameter the package sets", consentVariant({ authorizeParams: { redirect_uri: "https://evil.test" } }), "crm: auth oauth2_user: authorizeParams must not set redirect_uri, which the package sets itself."],
    ["a scope with a space", consentVariant({ scopes: ["a b"] }), "crm: auth oauth2_user: scopes must list texts without spaces."],
    ["rotates missing", consentVariant({ rotates: undefined }), "crm: auth oauth2_user: refresh refresh_token needs rotates true or false."],
    ["an identity that is not a read", consentVariant({ identity: { function: "crm.update_contact", path: "email" } }), "crm: identity must name a read function of the connector without required arguments."],
    ["an identity without path", consentVariant({ identity: { function: "crm.get_company" } }), "crm: auth oauth2_user needs identity {function, path} or {url, path, scopes}: what names who consented."],
    ["a plain http address", consentVariant({ authorizeUrl: "http://login.crm.example.test/authorize" }), "crm: authorizeUrl must start with https:// or with a url setting."],
  ])("should refuse %s by name", (_case, definition, message) => {
    expect(registrationProblem(definition, { crm: TEST_APPLICATION })).toBe(message)
  })

  it("should refuse an OAuth application for an unknown connector, or an empty one", () => {
    expect(registrationProblem(consentConnector(), { other: TEST_APPLICATION })).toBe("OAuth application for other: no oauth2_user connector of this name is declared.")
    expect(registrationProblem(consentConnector(), { crm: { clientId: "id", clientSecret: "" } })).toBe("OAuth application for crm needs a non-empty clientId and clientSecret.")
  })

  it("should build the authorization address: code, client, return address, scopes joined by spaces, state, PKCE, constants", () => {
    register()
    const { address, query } = authorizationOf()
    expect([address, query]).toEqual([
      "https://login.crm.example.test/authorize",
      {
        response_type: "code",
        client_id: "client-test",
        redirect_uri: "https://acme.test/api/platform/connector-consent/callback",
        scope: "offline_access contacts.read",
        state: "s",
        code_challenge: "c",
        code_challenge_method: "S256",
        prompt: "select_account",
      },
    ])
  })
})

describe("oauth2_user with access levels and an identity address", () => {
  it("should accept the levels the factory renders, keep them unapplied, and ask the scopes of full plus those of the identity address", () => {
    register(leveledConsentConnector())
    const declared = declaredConnector("crm")
    if (declared?.auth.kind !== "user_consent") throw new Error("not a consent")
    expect([declared.auth.accessLevels, declared.auth.scopeImplies]).toEqual([
      { read: ["offline_access", "contacts.read"], full: ["offline_access", "contacts.write", "entries.write"] },
      { "contacts.write": ["contacts.read"] },
    ])
    // Aucun filtrage : toutes les fonctions sont servies, comme au niveau `full`.
    expect(declared.functions.map((fn) => fn.name)).toEqual(["crm.get_company", "crm.list_contacts", "crm.get_contact", "crm.rename_contact", "crm.untag_contact", "crm.post_entry"])
    expect(authorizationOf().query.scope).toBe("offline_access contacts.write entries.write openid email")
  })

  it("should keep a connector without levels as it was: its scopes, its identity function", () => {
    register()
    const declared = declaredConnector("crm")
    if (declared?.auth.kind !== "user_consent") throw new Error("not a consent")
    expect([declared.auth.scopes, declared.auth.accessLevels, declared.auth.scopeImplies, declared.auth.identity, declared.identity?.fn.name]).toEqual([
      ["offline_access", "contacts.read"],
      null,
      {},
      { function: "crm.get_company", path: "email" },
      "crm.get_company",
    ])
  })

  it("should not ask twice a scope of the identity address that full already asks", () => {
    register(leveledVariant({ identity: { url: "https://id.crm.example.test/v1/userinfo", path: "email", scopes: ["offline_access", "email"] } }))
    expect(authorizationOf().query.scope).toBe("offline_access contacts.write entries.write email")
  })

  it.each([
    ["scopes with accessLevels", leveledVariant({ scopes: ["contacts.read"] }), "crm: auth oauth2_user: scopes and accessLevels exclude each other; a connector with access levels asks the scopes of a level."],
    ["accessLevels without full", leveledVariant({ accessLevels: { read: { scopes: ["contacts.read"] } } }), "crm: auth oauth2_user: accessLevels needs the level full."],
    [
      "a level without scopes",
      leveledVariant({ accessLevels: { read: { scopes: [] }, full: { scopes: ["contacts.write"] } } }),
      'crm: auth oauth2_user: access level "read" needs a name in lowercase ASCII letters, digits and _, and a non-empty list of scopes without spaces.',
    ],
    ["scopeImplies without levels", consentVariant({ scopeImplies: { "contacts.write": ["contacts.read"] } }), "crm: auth oauth2_user: scopeImplies needs accessLevels."],
    ["scopeImplies to an empty list", leveledVariant({ scopeImplies: { "contacts.write": [] } }), "crm: auth oauth2_user: scopeImplies must map a scope to the non-empty list of scopes it covers."],
    [
      "a function without its scopes",
      leveledVariant({}, (fn) => (fn.name === "crm.rename_contact" ? { ...fn, scopes: undefined } : fn)),
      "crm.rename_contact: scopes must list the scopes the function needs, in a connector with access levels.",
    ],
    ["a function's scopes without levels", consentVariant({}, { functions: consentConnector().functions.map((fn) => ({ ...fn, scopes: ["contacts.read"] })) }), "crm.get_company: scopes need the connector's accessLevels."],
    ["an identity address in http", leveledVariant({ identity: { url: "http://id.crm.example.test/v1/userinfo", path: "email", scopes: ["openid"] } }), "crm: identity url must start with https:// or with a url setting."],
    [
      "an identity address with a query",
      leveledVariant({ identity: { url: "https://id.crm.example.test/v1/userinfo?alt=json", path: "email", scopes: ["openid"] } }),
      "crm: identity url must be an https:// address without a trailing slash.",
    ],
    ["an identity address as a template", leveledVariant({ identity: { url: "https://{tenant}.crm.example.test/me", path: "email", scopes: ["openid"] } }), "crm: identity url cites {tenant}, which is not a setting."],
    ["an identity address without scopes", leveledVariant({ identity: { url: "https://id.crm.example.test/v1/userinfo", path: "email", scopes: [] } }), "crm: auth oauth2_user: identity url needs the scopes it requires, a non-empty list without spaces."],
    [
      "an identity with a function and an address",
      leveledVariant({ identity: { function: "crm.get_company", url: "https://id.crm.example.test/v1/userinfo", path: "email", scopes: ["openid"] } }),
      "crm: auth oauth2_user: identity takes a function or a url, not both.",
    ],
  ])("should refuse %s by name", (_case, definition, message) => {
    expect(registrationProblem(definition, { crm: TEST_APPLICATION })).toBe(message)
  })

  it("should read the identity address with a GET, the access token as a bearer, no redirect followed, outside the catalog", async () => {
    register(leveledConsentConnector())
    const declared = declaredConnector("crm")
    if (!declared?.identity) throw new Error("no identity")
    const access = token()
    const { sent } = stub(json({ email: "ada@contoso.test", sub: "1" }))
    const credential = { fields: {}, settings: {}, tokens: memoryTokens({ token: access, expiresAt: new Date(Date.now() + 600_000) }), consent: memoryConsent(token()) }
    const { answers } = await executeDescribed(declared.identity, { credential, accountId: "consent-1" }, {})
    expect([answers, sent().map((request) => [request.method, request.url, request.redirect, request.headers.authorization])]).toEqual([
      [{ email: "ada@contoso.test", sub: "1" }],
      [["GET", "https://id.crm.example.test/v1/userinfo", "error", `Bearer ${access}`]],
    ])
    expect(declared.functions.map((fn) => fn.name)).not.toContain(declared.identity.fn.name)
  })
})

describe("oauth2_user at the call", () => {
  it("should send the kept access token as a bearer while it is not about to expire", async () => {
    register()
    const access = token()
    const consent = memoryConsent(token())
    const { sent } = stub(json({ scopes: ["a"] }))
    await getCompany({ fields: {}, settings: {}, tokens: memoryTokens({ token: access, expiresAt: new Date(Date.now() + 600_000) }), consent })
    expect(sent().map((request) => [request.url, request.headers.authorization])).toEqual([["https://crm.example.test/v2/me", `Bearer ${access}`]])
    expect(consent.renewals).toEqual([])
  })

  it("should renew at expiry with the refresh token and the host's application, keep the rotated refresh token, and once more after a 401", async () => {
    register()
    const [old, rotated, again] = [token(), token(), token()]
    const consent = memoryConsent(old)
    const { sent } = stub(
      json({ access_token: "a1", refresh_token: rotated, expires_in: 3600, scope: "contacts.read" }),
      json({}, 401),
      json({ access_token: "a2", refresh_token: again }),
      json({ scopes: ["a"] }),
    )
    await getCompany({ fields: {}, settings: {}, tokens: memoryTokens({ token: "expiring", expiresAt: new Date(Date.now() + 30_000) }), consent })
    const [renewal, first, second, retried] = sent()
    expect([renewal.url, renewal.headers["content-type"], renewal.body]).toEqual([
      "https://login.crm.example.test/token",
      "application/x-www-form-urlencoded",
      `grant_type=refresh_token&refresh_token=${old}&client_id=client-test&client_secret=secret-test`,
    ])
    expect([first.headers.authorization, second.body, retried.headers.authorization]).toEqual([
      "Bearer a1",
      `grant_type=refresh_token&refresh_token=${rotated}&client_id=client-test&client_secret=secret-test`,
      "Bearer a2",
    ])
    expect(consent.renewals).toEqual([
      { token: "a1", rotated, scopes: ["contacts.read"] },
      { token: "a2", rotated: again, scopes: null },
    ])
  })

  it("should mark the account to connect again when the third party refuses the refresh token, never masking it", async () => {
    register()
    const refresh = token()
    const consent = memoryConsent(refresh)
    stub(json({ error: "invalid_grant", error_description: `bad ${refresh}` }, 400))
    const errors = vi.spyOn(console, "error").mockImplementation(() => {})
    const error = await refusal(getCompany({ fields: {}, settings: {}, tokens: memoryTokens({ token: "old", expiresAt: new Date(Date.now() - 1000) }), consent }))
    expect([error.code, error.message, consent.revocations]).toEqual(["not_enabled", "to connect again: Crm no longer accepts its authorization (expired or revoked)", ["Crm no longer accepts its authorization (expired or revoked)"]])
    expect(loggedText(errors).includes(refresh)).toBe(false)
  })

  it("should say that the OAuth application was refused, without changing the account", async () => {
    register()
    const consent = memoryConsent(token())
    stub(json({ error: "invalid_client" }, 401))
    vi.spyOn(console, "error").mockImplementation(() => {})
    const error = await refusal(getCompany({ fields: {}, settings: {}, tokens: memoryTokens(), consent }))
    expect([error.code, error.message, consent.revocations]).toEqual([
      "upstream_error",
      "Crm refused the OAuth application of this application: ask whoever runs this application to check its client id and secret.",
      [],
    ])
  })

  it("should ask to connect again an expired token that does not renew (refresh none), sending nothing", async () => {
    register(consentVariant({ refresh: "none", rotates: undefined }))
    const consent = memoryConsent(null)
    const { send } = stub()
    const error = await refusal(getCompany({ fields: {}, settings: {}, tokens: memoryTokens({ token: "old", expiresAt: new Date(Date.now() - 1000) }), consent }))
    expect([error.code, consent.revocations, send.mock.calls.length]).toEqual(["not_enabled", ["its Crm authorization expired"], 0])
  })

  it("should exchange the current access token when the description says so", async () => {
    register(consentVariant({ refresh: "exchange", rotates: undefined, exchange: { grantType: "fb_exchange_token", tokenParam: "fb_exchange_token" } }))
    const consent = memoryConsent(null)
    const { sent } = stub(json({ access_token: "a1", expires_in: 5_000_000 }), json({ scopes: ["a"] }))
    await getCompany({ fields: {}, settings: {}, tokens: memoryTokens({ token: "current", expiresAt: new Date(Date.now() + 10_000) }), consent })
    expect([sent()[0].body, sent()[1].headers.authorization]).toEqual(["grant_type=fb_exchange_token&fb_exchange_token=current&client_id=client-test&client_secret=secret-test", "Bearer a1"])
  })
})
