// @vitest-environment node
// Comptes à plusieurs champs et réglages (story comptes-a-plusieurs-champs) : le moteur sur un `fetch` simulé, sans
// réseau ni base. `basic` sur deux champs ; `api_key` en query, la clé absente de tout log, erreur et texte rendu ;
// adresse par région et par sous-domaine ; `oauth2_client_credentials` : échange, jeton rangé par le compte (pas en
// mémoire du processus), réutilisé, renouvelé à l'échéance, une fois de plus après un 401 ; `oauth2_jwt_bearer` : la
// même mécanique, la clé refusée qui marque le compte, la déclaration contrôlée ; une adresse saisie qui mène à un hôte
// interne, refusée avant tout envoi. Secrets tirés à l'exécution, la clé du compte de service construite par les cas
// communs.
import { randomBytes } from "crypto"
import type { LookupAddress } from "node:dns"
import { afterEach, describe, expect, it, vi } from "vitest"
import { declaredConnector } from "../../packages/plateforme/server/catalog/connector-source"
import { CatalogRegistrationError } from "../../packages/plateforme/server/catalog/erp"
import type { AccountCredential, AccountMarker } from "../../packages/plateforme/server/connectors/auth"
import { guardedFetch, isPublicAddress } from "../../packages/plateforme/server/connectors/address-guard"
import { registerConnectors } from "../../packages/plateforme/server/connectors/declaration"
import type { ConnectorDefinition } from "../../packages/plateforme/server/connectors/definition"
import type { Fetch } from "../../packages/plateforme/server/connectors/http"
import { PlatformError } from "../../packages/plateforme/server/errors"
import { describedConnector, memoryTokens } from "../factories/described-connector"
import { credentialValue, jwtBearerCases } from "../factories/jwt-bearer-cases"
import { loggedText } from "../helpers/logs"

const secret = () => `s_${randomBytes(12).toString("hex")}`
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
const ACCOUNT = "account-1"

/** Le connecteur de test sous une autre authentification, d'autres champs ou réglages. */
function variant(change: Partial<ConnectorDefinition>): ConnectorDefinition {
  return { ...describedConnector(), ...change }
}

/** `fetch` simulé : réponses dans l'ordre ; chaque requête gardée. */
function stub(...answers: Response[]) {
  const send = vi.fn<Fetch>(async () => answers.shift() ?? json({}))
  vi.stubGlobal("fetch", send)
  const sent = () => send.mock.calls.map(([url, init]) => ({ url, headers: Object.fromEntries(new Headers(init.headers)), body: init.body }))
  return { send, sent }
}

/** `crm.get_company` (sans argument) exécutée sur le compte ouvert. */
function getCompany(credential: AccountCredential) {
  const prepared = declaredConnector("crm")?.functions.find((fn) => fn.name === "crm.get_company")
  if (!prepared) throw new Error("crm.get_company is not declared")
  return prepared.run({ credential, account: { id: ACCOUNT } } as never, {} as never)
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

const TWO_FIELDS = [
  { name: "client_id", label: "Client ID", secret: false },
  { name: "client_secret", label: "Client secret", secret: true },
]

describe("account fields and settings in the engine", () => {
  it("should send basic authentication built from two fields of the account", async () => {
    registerConnectors([variant({ credential: TWO_FIELDS, auth: { kind: "basic", username: "client_id", password: "client_secret" } })])
    const fields = { client_id: secret(), client_secret: secret() }
    const { sent } = stub(json({ scopes: ["a"] }))
    await getCompany({ fields, settings: {}, tokens: memoryTokens() })
    expect(sent()[0].headers.authorization).toBe(`Basic ${Buffer.from(`${fields.client_id}:${fields.client_secret}`).toString("base64")}`)
  })

  it("should put a query key in the address only, never in a log, an error or the rendered text", async () => {
    registerConnectors([variant({ auth: { kind: "api_key", in: "query", name: "key", key: "api_key" } })])
    const key = secret()
    const credential = { fields: { api_key: key }, settings: {}, tokens: memoryTokens() }
    const { sent } = stub(json({ scopes: ["a"], echo: "ok" }))
    const output = await getCompany(credential)
    expect(sent()[0].url).toBe(`https://crm.example.test/v2/me?key=${key}`)
    expect(sent()[0].headers.authorization).toBeUndefined()
    const errors = vi.spyOn(console, "error").mockImplementation(() => {})
    // Un `fetch` en panne qui citerait l'adresse, puis un refus du tiers : ni l'un ni l'autre ne laisse passer la clé.
    vi.stubGlobal("fetch", vi.fn<Fetch>(async (url) => Promise.reject(new TypeError(`fetch failed: ${url}`))))
    const down = await refusal(getCompany(credential))
    stub(json({ error: `bad key ${key}` }, 401))
    const refused = await refusal(getCompany(credential))
    const served = [output.text, JSON.stringify(output.data), down.message, JSON.stringify(down.details), refused.message, JSON.stringify(refused.details), loggedText(errors)].join("\n")
    expect(served.includes(key)).toBe(false)
  })

  it("should resolve the address from the region of the account, or from its subdomain", async () => {
    registerConnectors([
      variant({
        baseUrl: undefined,
        settings: [{ name: "region", label: "Region", type: "choice", choices: ["us", "eu"], default: "us" }],
        baseUrls: { setting: "region", values: { us: "https://api.crm.example.test", eu: "https://api.eu.crm.example.test" } },
      }),
    ])
    const { sent } = stub(json({ scopes: ["a"] }))
    await getCompany({ fields: { api_key: secret() }, settings: { region: "eu" }, tokens: memoryTokens() })
    expect(sent()[0].url).toBe("https://api.eu.crm.example.test/me")
  })

  it("should refuse an entered address that leads to an internal host, sending nothing (guarded transport)", async () => {
    registerConnectors([variant({ settings: [{ name: "server", label: "Server", type: "url" }], baseUrl: "{server}/v2" })])
    const { send } = stub()
    const error = await refusal(getCompany({ fields: { api_key: secret() }, settings: { server: "https://localhost" }, tokens: memoryTokens() }))
    expect([error.code, error.message]).toEqual([
      "not_enabled",
      "The address of this account resolves to a private or internal host (localhost): refused. Ask whoever manages the account to fix its settings.",
    ])
    expect(send).not.toHaveBeenCalled()
  })
})

describe("oauth2_client_credentials", () => {
  const exchanging = (change: Partial<Extract<ConnectorDefinition["auth"], { kind: "oauth2_client_credentials" }>> = {}) =>
    variant({
      credential: TWO_FIELDS,
      auth: { kind: "oauth2_client_credentials", tokenUrl: "https://login.crm.example.test/token", tokenRequest: "form", clientAuth: "body", clientId: "client_id", clientSecret: "client_secret", ...change } as ConnectorDefinition["auth"],
    })

  it("should exchange the client credentials, keep the token on the account with its expiry, and reuse it", async () => {
    registerConnectors([exchanging({ scope: "contacts" })])
    const fields = { client_id: secret(), client_secret: secret() }
    const tokens = memoryTokens()
    const token = secret()
    const { sent } = stub(json({ access_token: token, expires_in: 3600 }), json({ scopes: ["a"] }), json({ scopes: ["a"] }))
    const before = Date.now()
    await getCompany({ fields, settings: {}, tokens })
    await getCompany({ fields, settings: {}, tokens })
    const [exchange, first, second] = sent()
    expect(exchange.url).toBe("https://login.crm.example.test/token")
    expect([exchange.headers["content-type"], String(exchange.body)]).toEqual([
      "application/x-www-form-urlencoded",
      `grant_type=client_credentials&client_id=${fields.client_id}&client_secret=${fields.client_secret}&scope=contacts`,
    ])
    expect([first.headers.authorization, second.headers.authorization]).toEqual([`Bearer ${token}`, `Bearer ${token}`])
    expect(tokens.written).toHaveLength(1)
    expect(tokens.written[0].expiresAt?.getTime()).toBeGreaterThanOrEqual(before + 3_600_000)
  })

  it("should renew a token at its expiry, and once after a 401, then give the refusal", async () => {
    registerConnectors([exchanging({ clientAuth: "basic", tokenRequest: "json", expiresInDefault: 600 })])
    const fields = { client_id: secret(), client_secret: secret() }
    const tokens = memoryTokens({ token: "old", expiresAt: new Date(Date.now() + 30_000) })
    const { sent } = stub(json({ access_token: "t1" }), json({}, 401), json({ access_token: "t2" }), json({ scopes: ["a"] }))
    await getCompany({ fields, settings: {}, tokens })
    expect(sent().map((request) => request.headers.authorization)).toEqual([
      `Basic ${Buffer.from(`${fields.client_id}:${fields.client_secret}`).toString("base64")}`,
      "Bearer t1",
      expect.stringMatching(/^Basic /),
      "Bearer t2",
    ])
    expect(JSON.parse(String(sent()[0].body))).toEqual({ grant_type: "client_credentials" })
    expect(tokens.written.map((written) => written.token)).toEqual(["t1", "t2"])
    stub(json({}, 401), json({ access_token: "t3" }), json({}, 401))
    const error = await refusal(getCompany({ fields, settings: {}, tokens }))
    expect([error.code, error.details]).toEqual(["upstream_error", { refusal: "access_rejected" }])
  })

  it("should say that the third party refused the client credentials, without them", async () => {
    registerConnectors([exchanging()])
    const fields = { client_id: secret(), client_secret: secret() }
    stub(json({ error: "invalid_client" }, 401))
    vi.spyOn(console, "error").mockImplementation(() => {})
    const error = await refusal(getCompany({ fields, settings: {}, tokens: memoryTokens() }))
    expect([error.code, error.message]).toEqual(["upstream_error", "Crm refused the client credentials of this account: check its client id and secret."])
  })
})

describe("oauth2_jwt_bearer", () => {
  const [signed] = jwtBearerCases
  const serviceAccount = (auth: Record<string, unknown> = {}, credential = signed.credential) =>
    variant({ auth: { ...signed.auth, ...auth } as ConnectorDefinition["auth"], credential })
  const keyOf = () => ({ [signed.credential[0].name]: credentialValue(signed) })
  const form = (body: unknown) => Object.fromEntries(new URLSearchParams(String(body)))

  it("should exchange a signed assertion, keep the token on the account, reuse it, and renew it once after a 401", async () => {
    registerConnectors([serviceAccount()])
    const tokens = memoryTokens()
    const [t1, t2] = [secret(), secret()]
    const { sent } = stub(json({ access_token: t1, expires_in: 3600 }), json({ scopes: ["a"] }), json({}, 401), json({ access_token: t2, expires_in: 3600 }), json({ scopes: ["a"] }))
    await getCompany({ fields: keyOf(), settings: {}, tokens })
    await getCompany({ fields: keyOf(), settings: {}, tokens })
    const requests = sent()
    expect(requests.map((request) => [request.url, request.headers.authorization])).toEqual([
      [signed.tokenRequest.url, undefined],
      ["https://crm.example.test/v2/me", `Bearer ${t1}`],
      ["https://crm.example.test/v2/me", `Bearer ${t1}`],
      [signed.tokenRequest.url, undefined],
      ["https://crm.example.test/v2/me", `Bearer ${t2}`],
    ])
    expect(form(requests[0].body).grant_type).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer")
    expect(form(requests[0].body).assertion.split(".")).toHaveLength(3)
    expect(tokens.written.map((written) => written.token)).toEqual([t1, t2])
  })

  it("should mark the account when the third party refuses the key (invalid_grant)", async () => {
    registerConnectors([serviceAccount()])
    vi.spyOn(console, "error").mockImplementation(() => {})
    const set = vi.fn<AccountMarker["set"]>(async () => {})
    const mark: AccountMarker = { current: null, effect: null, set, remedy: async () => "Ask the manager." }
    stub(json({ error: "invalid_grant", error_description: "Invalid JWT Signature." }, 400))
    const error = await refusal(getCompany({ fields: keyOf(), settings: {}, tokens: memoryTokens(), mark }))
    expect([error.code, set.mock.calls]).toEqual(["credential_rejected", [["credential_rejected"]]])
  })

  it("should refuse at declaration a token address that is not fixed https, empty scopes, or a key that is not the one secret field", () => {
    const declared = (definition: ConnectorDefinition) => {
      try {
        registerConnectors([definition])
        return "declared"
      } catch (error) {
        if (error instanceof CatalogRegistrationError) return error.message
        throw error
      }
    }
    const verdicts = [
      serviceAccount({ tokenUrl: "https://{domain}.example.test/token" }),
      serviceAccount({ tokenUrl: "https://oauth2.example.test/token?x=1" }),
      serviceAccount({ tokenUrl: "http://oauth2.example.test/token" }),
      serviceAccount({ scopes: [] }),
      serviceAccount({}, [{ ...signed.credential[0], secret: false }]),
      serviceAccount({}, [...signed.credential, { name: "other", label: "Other", secret: true }]),
      serviceAccount(),
    ].map(declared)
    const address = "crm: auth oauth2_jwt_bearer needs a fixed https tokenUrl (no template, query nor tokenUrls)."
    const key = "crm: auth oauth2_jwt_bearer: key must name the one credential field, secret (the JSON key file)."
    expect(verdicts).toEqual([address, address, address, "crm: auth oauth2_jwt_bearer needs scopes, a non-empty list.", key, key, "declared"])
  })
})

describe("address guard", () => {
  it.each([
    ["10.0.0.1", false],
    ["169.254.169.254", false],
    ["127.0.0.1", false],
    ["::1", false],
    ["::ffff:10.0.0.1", false],
    ["fd00:ec2::254", false],
    ["fe80::1", false],
    ["100.64.0.1", false],
    ["93.184.215.14", true],
    ["2606:4700::1111", true],
    ["example.com", false],
  ])("should say whether %s is a public address (%s)", (address, expected) => {
    expect(isPublicAddress(address)).toBe(expected)
  })

  it("should refuse at connection a host that resolves to an internal address, and a plain http address", async () => {
    const resolve = ((_host: string, _options: unknown, done: (error: null, addresses: LookupAddress[]) => void) => done(null, [{ address: "10.1.2.3", family: 4 }])) as never
    const init = { method: "GET", headers: {}, redirect: "error" as const }
    const internal = await refusal(guardedFetch(resolve)("https://rebind.example.test/me", init))
    expect([internal.code, internal.message]).toEqual([
      "not_enabled",
      "The address of this account resolves to a private or internal host (rebind.example.test): refused. Ask whoever manages the account to fix its settings.",
    ])
    expect((await refusal(guardedFetch(resolve)("http://example.test/me", init))).code).toBe("not_enabled")
  })
})
