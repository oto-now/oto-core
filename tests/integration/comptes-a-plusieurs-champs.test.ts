// @vitest-environment node
// Comptes à plusieurs champs et réglages sur une vraie base (story comptes-a-plusieurs-champs) : la saisie fusionne
// avec ce qui est posé et se contrôle contre la déclaration ; l'écran lit les champs posés et la date, jamais le
// secret ; l'appel lit les champs et les réglages (adresse par région, `basic`) ; le jeton d'un échange est rangé
// chiffré sur la ligne du compte, hors de portée d'un `select`, réutilisé, effacé par une nouvelle saisie. Deux
// connecteurs décrits de test sous des noms propres au passage, leurs lignes de `platform.connectors` retirées à la
// fin. `fetch` simulé : aucun réseau. Secrets tirés à l'exécution.
import { randomBytes } from "crypto"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { runCall } from "../../packages/plateforme/server/calls"
import { setAccountSecret } from "../../packages/plateforme/server/connectors/account-secret"
import { listOrgAccounts } from "../../packages/plateforme/server/connectors/accounts"
import { loadActiveConnectors } from "../../packages/plateforme/server/connectors/activations"
import { registerConnectors } from "../../packages/plateforme/server/connectors/declaration"
import type { ConnectorView } from "../../packages/plateforme/server/connectors/definition"
import type { Fetch } from "../../packages/plateforme/server/connectors/http"
import { decryptCredential } from "../../packages/plateforme/server/connectors/vault"
import type { PlatformDb } from "../../packages/plateforme/server/db"
import { PlatformError } from "../../packages/plateforme/server/errors"
import { resolveIdentity, type Identity } from "../../packages/plateforme/server/identity"
import { describedConnector } from "../factories/described-connector"
import { pendingMigrations, pendingReason } from "../helpers/pending-migrations"
import { hex } from "../helpers/plateforme"
import { createSqlFixtures, SQL_SKIP_REASON, sqlConfigured, testAdminSql, type SqlFixtures, type SqlReferenceOrg } from "../helpers/sql"

const VERSION = "20261008090000"
const pending = (await pendingMigrations()).includes(VERSION)

/** Un connecteur à deux champs en `basic`, son hôte par région ; un autre à échange de jeton. */
const BASIC = `t${hex(4)}`
const EXCHANGE = `t${hex(4)}`
const FIELDS = [
  { name: "client_id", label: "Client ID", secret: false },
  { name: "client_secret", label: "Client secret", secret: true },
]

function basicConnector(): ConnectorView {
  return {
    ...describedConnector(BASIC),
    baseUrl: undefined,
    baseUrls: { setting: "region", values: { us: "https://api.crm.example.test", eu: "https://api.eu.crm.example.test" } },
    settings: [{ name: "region", label: "Region", type: "choice", choices: ["us", "eu"] }],
    credential: FIELDS,
    auth: { kind: "basic", username: "client_id", password: "client_secret" },
  }
}

function exchangeConnector(): ConnectorView {
  return {
    ...describedConnector(EXCHANGE),
    credential: FIELDS,
    auth: { kind: "oauth2_client_credentials", tokenUrl: "https://login.crm.example.test/token", tokenRequest: "json", clientAuth: "body", clientId: "client_id", clientSecret: "client_secret" },
  }
}

const newSecret = () => `s_${randomBytes(12).toString("hex")}`
const ORIGIN = "https://acme.test"

async function refusal(run: Promise<unknown>): Promise<PlatformError> {
  const error = await run.then(
    () => null,
    (reason: unknown) => reason,
  )
  if (!(error instanceof PlatformError)) throw new Error(`expected a PlatformError, got ${String(error)}`)
  return error
}

const codeOf = (run: Promise<unknown>) =>
  run.then(
    () => null,
    (error: { code?: string }) => error.code ?? "?",
  )

const suite = !sqlConfigured ? `accounts with several fields (${SQL_SKIP_REASON})` : pending ? `accounts with several fields (${pendingReason([VERSION])})` : "accounts with several fields"

describe.skipIf(!sqlConfigured || pending)(suite, { timeout: 120_000 }, () => {
  let fx: SqlFixtures
  let o: SqlReferenceOrg
  let ada: { db: PlatformDb; identity: Identity }
  const savedKey = process.env.PLATFORM_VAULT_KEY

  const account = async (connector: string) => {
    const label = `Crm ${hex(3)}`
    return { id: await fx.createAccount(o.org.id, { connector, ownerKind: "org", label, mode: "reel" }), label }
  }
  const set = (id: string, input: unknown) => setAccountSecret(ada.db, ada.identity, { account_id: id, input })
  const call = (fn: string, accountLabel: string) =>
    runCall({ db: ada.db, identity: ada.identity, ctxCode: null, origin: ORIGIN, activeConnectors: () => loadActiveConnectors(ada.db, o.org.id) }, { function: fn, arguments: {}, account: accountLabel })
  const columns = async (id: string) =>
    (await fx.admin<{ secret_ciphertext: string | null; token_ciphertext: string | null }[]>`select secret_ciphertext, token_ciphertext from platform.accounts where id = ${id}`)[0]

  beforeAll(async () => {
    process.env.PLATFORM_VAULT_KEY = randomBytes(32).toString("base64")
    registerConnectors([basicConnector(), exchangeConnector()])
    fx = createSqlFixtures()
    await fx.admin`insert into platform.connectors (name, label) values (${BASIC}, 'Crm'), (${EXCHANGE}, 'Crm')`
    o = await fx.buildReferenceOrg()
    await fx.addActivation(o.org.id, BASIC)
    await fx.addActivation(o.org.id, EXCHANGE)
    const user = o.people.ada
    const db = fx.as(user)
    ada = { db, identity: await resolveIdentity(db, o.host, { userId: user.id, email: user.email }) }
  }, 180_000)

  afterAll(async () => {
    registerConnectors([])
    if (savedKey === undefined) delete process.env.PLATFORM_VAULT_KEY
    else process.env.PLATFORM_VAULT_KEY = savedKey
    await fx?.cleanup()
    const admin = testAdminSql()
    try {
      await admin`delete from platform.connectors where name in (${BASIC}, ${EXCHANGE})`
    } finally {
      await admin.end({ timeout: 5 })
    }
  }, 180_000)

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("should merge an entry into what is set, keep the settings in clear, and show the fields set and the date, never the secret", async () => {
    const live = await account(BASIC)
    const [id, secret] = [newSecret(), newSecret()]
    await set(live.id, { secret: { client_id: id, client_secret: secret }, settings: { region: "eu" } })
    await set(live.id, { secret: { client_secret: null } })
    const view = (await listOrgAccounts(ada.db, ada.identity)).find((candidate) => candidate.id === live.id)
    expect([view?.secret?.fields, view?.settings, typeof view?.secret?.updatedAt]).toEqual([["client_id"], { region: "eu" }, "string"])
    expect(JSON.stringify(view)).not.toContain(id)
    expect(decryptCredential(live.id, (await columns(live.id)).secret_ciphertext ?? "")).toEqual({ fields: { client_id: id } })
  })

  it("should refuse an unknown field and a setting its declaration refuses, writing nothing", async () => {
    const live = await account(BASIC)
    const unknown = await refusal(set(live.id, { secret: { api_key: newSecret() } }))
    const region = await refusal(set(live.id, { settings: { region: "fr" } }))
    expect([unknown.code, unknown.message, region.code, region.message]).toEqual([
      "invalid_arguments",
      `Unknown field api_key of ${BASIC}: its fields are client_id, client_secret.`,
      "invalid_arguments",
      "Setting Region must be one of us, eu.",
    ])
    expect((await columns(live.id)).secret_ciphertext).toBeNull()
  })

  it("should call on the host of the account's region with basic authentication, and refuse a missing field or setting before the function", async () => {
    const live = await account(BASIC)
    const [id, secret] = [newSecret(), newSecret()]
    const send = vi.fn<Fetch>(async () => new Response(JSON.stringify({ scopes: ["a"] })))
    vi.stubGlobal("fetch", send)
    await set(live.id, { secret: { client_id: id } })
    const noRegion = await refusal(call(`${BASIC}.get_company`, live.label))
    await set(live.id, { settings: { region: "eu" } })
    const noSecret = await refusal(call(`${BASIC}.get_company`, live.label))
    expect([noRegion.code, noRegion.message, noSecret.code]).toEqual([
      "not_enabled",
      `The Region setting of account « ${live.label} » is not set. Ask the administrators of Acme Test (Ada Martin) to set it.`,
      "not_enabled",
    ])
    expect(noSecret.message).toBe(`Account « ${live.label} » has no Client secret yet. Ask the administrators of Acme Test (Ada Martin) to set it.`)
    expect(send).not.toHaveBeenCalled()
    await set(live.id, { secret: { client_secret: secret } })
    await call(`${BASIC}.get_company`, live.label)
    const [url, init] = send.mock.calls[0]
    expect([url, new Headers(init.headers).get("authorization")]).toEqual(["https://api.eu.crm.example.test/me", `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`])
  })

  it("should keep the exchanged token encrypted on the account, out of a member's select, reuse it, and drop it at the next entry", async () => {
    const live = await account(EXCHANGE)
    await set(live.id, { secret: { client_id: newSecret(), client_secret: newSecret() } })
    const token = newSecret()
    const send = vi.fn<Fetch>(async (url) => new Response(JSON.stringify(url.endsWith("/token") ? { access_token: token, expires_in: 3600 } : { scopes: ["a"] })))
    vi.stubGlobal("fetch", send)
    await call(`${EXCHANGE}.get_company`, live.label)
    await call(`${EXCHANGE}.get_company`, live.label)
    expect(send.mock.calls.map(([url]) => url)).toEqual(["https://login.crm.example.test/token", "https://crm.example.test/v2/me", "https://crm.example.test/v2/me"])
    const stored = (await columns(live.id)).token_ciphertext
    expect([stored?.startsWith("v2:"), stored?.includes(token)]).toEqual([true, false])
    expect(await codeOf(ada.db.tx((sql) => sql`select token_ciphertext from platform.accounts where id = ${live.id}`))).toBe("42501")
    await set(live.id, { settings: {}, secret: { client_secret: newSecret() } })
    expect((await columns(live.id)).token_ciphertext).toBeNull()
  })
})
