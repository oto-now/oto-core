// @vitest-environment node
// Les fonctions d'un hôte sur une vraie base (`docs/conception/fonctions-d-un-hote.md`) : l'API de l'hôte d'une
// organisation réglée et rafraîchie par l'équipe plateforme seule, un document refusé qui laisse la version précédente
// servie et enregistre ses problèmes, le catalogue de l'organisation (`find`, `read functions`), et un `call` de bout en
// bout, en deux temps pour une fonction sensible, sous un jeton échangé jamais égal à celui de la personne. Puis le
// client tiers, dont l'émetteur n'échange pas le jeton : sans consentement, le refus et son lien d'autorisation ; le
// consentement rangé par le retour du parcours `oauth2_user`, chiffré sur le compte `host_api` de la personne ; l'appel
// sous le jeton consenti, son renouvellement, la révocation par la désactivation du compte, un renouvellement refusé, un
// consentement donné sous un autre compte de l'émetteur. Un faux émetteur et un faux hôte en local
// (`tests/helpers/host-api.ts`). Organisation de référence jetable. Suite portable.
import { randomBytes } from "node:crypto"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { resolveIdentity, type Identity, type PlatformDb } from "@otomata_tech/oto_platform/server"
import { runCall } from "../../packages/plateforme/server/calls"
import { disableAccount } from "../../packages/plateforme/server/connectors/account-changes"
import { completeConnectorConsent, startConnectorConsent } from "../../packages/plateforme/server/connectors/consent"
import { orgAssistantFunctions } from "../../packages/plateforme/server/catalog/org-catalog"
import type { Fetch } from "../../packages/plateforme/server/connectors/http"
import { forgetExchangedTokens } from "../../packages/plateforme/server/host-api/exchange"
import { forgetHostFunctions, hostApi, hostApiFunctions, refreshHostApi } from "../../packages/plateforme/server/host-api/service"
import { readNode } from "../../packages/plateforme/server/nodes/read"
import { CONSENT_ENV, EXCHANGE_ENV, HOST, hostDocument, ISSUER, RESOURCE, routeFetch, startFakeHost, THIRD_PARTY, unsignedJwt, type FakeHost } from "../helpers/host-api"
import { pendingMigrations } from "../helpers/pending-migrations"
import { codeOf, createSqlFixtures, SQL_SKIP_REASON, sqlConfigured, testAdminSql, type SqlFixtures, type SqlReferenceOrg } from "../helpers/sql"

const route = vi.hoisted(() => ({ local: "", realFetch: globalThis.fetch.bind(globalThis) }))

/** Le transport gardé vers le faux hôte ; toute autre adresse par le vrai transport gardé. */
vi.mock("../../packages/plateforme/server/connectors/address-guard", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../packages/plateforme/server/connectors/address-guard")>()
  return {
    ...original,
    guardedFetch: (): Fetch => (input, init) =>
      input.startsWith("https://hote.example.test/")
        ? route.realFetch(input.replace("https://hote.example.test", route.local), { ...init, redirect: "manual" })
        : original.guardedFetch()(input, init),
  }
})

const VERSION = "20261123150000"
const pending = (await pendingMigrations()).includes(VERSION)
const SETUP_TIMEOUT = 180_000
const SUITE = "functions of a host on a real database"
const SUBJECT = "verified-token-of-lea-never-sent-to-the-host"
/** Le jeton vérifié de Léa sous un client tiers (CIMD) : son `sub` à l'émetteur, que le jeton consenti doit porter. */
const THIRD_PARTY_SUBJECT = unsignedJwt({ sub: "sub-lea", client_id: "https://client.example.test/oauth/metadata.json", exp: Math.floor(Date.now() / 1000) + 3600 })
const ORIGIN = "https://acme.example.test"
const VAULT_KEY = randomBytes(32).toString("base64")
const skipReason = !sqlConfigured ? SQL_SKIP_REASON : `skipped: migration ${VERSION} not applied`

type Session = { db: PlatformDb; identity: Identity }

describe.skipIf(!sqlConfigured || pending)(sqlConfigured && !pending ? SUITE : `${SUITE} (${skipReason})`, { timeout: 60_000 }, () => {
  let fx: SqlFixtures
  let o: SqlReferenceOrg
  let fake: FakeHost
  let staff: Session
  let lea: Session

  beforeAll(async () => {
    fake = await startFakeHost()
    route.local = fake.local
    fx = createSqlFixtures()
    o = await fx.buildReferenceOrg()
    const sam = await fx.createUser({ fullName: "Sam Staff" })
    await fx.makeStaff(sam.id)
    await fx.grantPlatformAccess(o.org.id, sam.id, null)
    const samDb = fx.as(sam)
    staff = { db: samDb, identity: await resolveIdentity(samDb, o.host, { userId: sam.id, email: sam.email }) }
    const leaDb = fx.as(o.people.lea)
    lea = { db: leaDb, identity: await resolveIdentity(leaDb, o.host, { userId: o.people.lea.id, email: o.people.lea.email }) }
  }, SETUP_TIMEOUT)

  beforeEach(() => {
    fake.reset()
    forgetExchangedTokens()
    vi.stubEnv("PLATFORM_OIDC_ISSUER", ISSUER)
    vi.stubEnv("PLATFORM_OIDC_AUDIENCE", "https://oto.example.test/api/mcp")
    for (const [name, value] of Object.entries({ ...EXCHANGE_ENV, ...CONSENT_ENV })) vi.stubEnv(name, value)
    vi.stubEnv("PLATFORM_VAULT_KEY", VAULT_KEY)
    vi.stubGlobal("fetch", routeFetch(() => fake.local, route.realFetch))
    vi.spyOn(console, "error").mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  afterAll(async () => {
    forgetHostFunctions()
    await fake?.close()
    await fx?.cleanup()
  }, SETUP_TIMEOUT)

  const callAs = (session: Session, input: { function: string; arguments?: Record<string, unknown>; confirm?: boolean }, accessToken = SUBJECT) =>
    runCall({ db: session.db, identity: session.identity, ctxCode: "7K3Q-M2XA", ctxHost: "claude-ai@0.1.0", origin: ORIGIN, accessToken, activeConnectors: async () => new Set<string>() }, input)

  it("should reserve the setting to the platform team, serve an accepted document, and list its functions in the organisation's catalogue", async () => {
    expect(await codeOf(refreshHostApi(lea.db, lea.identity, { address: HOST }))).toBe("forbidden")
    // La base le tient aussi : un membre n'écrit pas la ligne.
    expect(await codeOf(lea.db.tx((sql) => sql`insert into platform.host_apis (org_id, refused_address, refused_at, problems) values (${o.org.id}, ${HOST}, now(), '[]'::jsonb)`))).not.toBeNull()

    const served = await refreshHostApi(staff.db, staff.identity, { address: HOST })
    expect(served).toMatchObject({ kind: "served", view: { address: HOST, version: "1.0.0", refused: null } })

    const names = (await hostApiFunctions(lea.db, lea.identity)).map((fn) => fn.name)
    expect(names).toEqual(["projet.lister", "projet_act.archiver"])
    expect((await orgAssistantFunctions(lea.db, lea.identity)).filter((fn) => fn.connector === "projet").map((fn) => fn.name)).toEqual(names)
    const catalogue = await readNode(lea.db, lea.identity, { path: "functions" })
    expect(catalogue.text).toContain("projet.lister")

    // Le même document, relu avec son ETag : rien ne change que la date du rafraîchissement.
    expect(await refreshHostApi(staff.db, staff.identity, {})).toMatchObject({ kind: "unchanged", view: { version: "1.0.0" } })
    expect(fake.seen.filter((request) => request.path === "/openapi.json").at(-1)?.headers["if-none-match"]).toBe('"v1"')
  })

  it("should keep the previous version served when a new document is refused, and record its problems", async () => {
    await refreshHostApi(staff.db, staff.identity, { address: HOST })
    const broken = hostDocument("2.0.0")
    delete (broken.paths as Record<string, Record<string, Record<string, unknown>>>)["/projets"].get["x-oto-class"]
    fake.state.document = broken
    fake.state.etag = '"v2"'

    const refused = await refreshHostApi(staff.db, staff.identity, {})
    expect(refused.kind).toBe("refused")
    expect(refused.view).toMatchObject({ address: HOST, version: "1.0.0", refused: { address: HOST } })
    expect(refused.view.refused?.problems.map((problem) => problem.code)).toContain("host_extension_missing")
    expect((await hostApi(lea.db, lea.identity))?.version).toBe("1.0.0")
    expect((await hostApiFunctions(lea.db, lea.identity)).map((fn) => fn.name)).toEqual(["projet.lister", "projet_act.archiver"])

    // Une adresse injoignable non plus ne remplace rien.
    fake.state.documentStatus = 500
    const unreachable = await refreshHostApi(staff.db, staff.identity, {})
    expect(unreachable.view).toMatchObject({ version: "1.0.0", refused: { problems: [{ code: "host_document_status" }] } })
  })

  it("should run a call end to end under the exchanged token, and confirm a sensitive function in two steps", async () => {
    fake.state.document = hostDocument("3.0.0")
    fake.state.etag = '"v3"'
    await refreshHostApi(staff.db, staff.identity, { address: HOST })

    const listed = await callAs(lea, { function: "projet.lister" })
    expect(listed.data.result).toMatchObject({ items: [{ id: 7, name: "Alpha" }] })

    const first = await callAs(lea, { function: "projet_act.archiver", arguments: { id: 7 } })
    expect(first.data).toMatchObject({ status: "needs_confirmation" })
    expect(first.text).toContain("Archive project Alpha (#7) and its 3 steps.")
    const second = await callAs(lea, { function: "projet_act.archiver", arguments: { id: 7 }, confirm: true })
    expect(second.data.result).toEqual({ archived: 7 })

    const toHost = fake.seen.filter((request) => request.path.startsWith("/api/v2/"))
    expect(toHost.map((request) => request.path)).toEqual(["/api/v2/projets", "/api/v2/projets/7/archive", "/api/v2/projets/7/archive?confirm=true"])
    expect(toHost.every((request) => request.headers.authorization === "Bearer exchanged-token-1" && request.headers["oto-org"] === o.org.id)).toBe(true)
    expect(JSON.stringify(toHost)).not.toContain(SUBJECT)
  })

  describe("a third-party client, by the person's consent", () => {
    const callThirdParty = (input: { function: string; arguments?: Record<string, unknown>; confirm?: boolean }) => callAs(lea, input, THIRD_PARTY_SUBJECT)
    const refusal = (run: Promise<unknown>) =>
      run.then(
        () => null,
        (error: { code: string; message: string; details?: Record<string, unknown> }) => ({ code: error.code, message: error.message, details: error.details }),
      )
    const toHost = () => fake.seen.filter((request) => request.path.startsWith("/api/v2/"))
    const tokenGrants = () => fake.seen.filter((request) => request.path === "/oidc/token").map((request) => Object.fromEntries(new URLSearchParams(request.body)))
    const account = async () => {
      const admin = testAdminSql()
      try {
        const rows = await admin<{ id: string; label: string; status: string; settings: Record<string, string>; row: unknown }[]>`
          select id, label, status, settings, to_jsonb(a) as row from platform.accounts a
           where org_id = ${o.org.id} and connector = 'host_api' and owner_user_id = ${o.people.lea.id}`
        return rows
      } finally {
        await admin.end({ timeout: 5 })
      }
    }
    /** Le lien d'un refus suivi comme le ferait l'émetteur : le retour sur l'adresse du paquet, avec un code et le `state`. */
    const consentThrough = async (url: string) => {
      const state = new URL(url).searchParams.get("state") ?? ""
      return completeConnectorConsent(lea.db, lea.identity, { code: `code-${randomBytes(6).toString("hex")}`, state }, { origin: ORIGIN })
    }

    beforeEach(async () => {
      const admin = testAdminSql()
      try {
        await admin`delete from platform.accounts where org_id = ${o.org.id} and connector = 'host_api'`
      } finally {
        await admin.end({ timeout: 5 })
      }
      fake.state.document = hostDocument("4.0.0")
      fake.state.etag = '"v4"'
      fake.state.exchangeRefusal = THIRD_PARTY
      await refreshHostApi(staff.db, staff.identity, { address: HOST })
    })

    it("should refuse without a consent with the authorization link, then call the host under the consented token, never the person's", async () => {
      const refused = await refusal(callThirdParty({ function: "projet.lister" }))
      expect(refused).toMatchObject({ code: "not_enabled", details: { reason: "host_consent_required" } })
      const url = new URL(String(refused?.details?.url))
      expect(refused?.message).toContain(`Authorize oto to act on Hote Test for you: ${url.toString()}`)
      expect(`${url.origin}${url.pathname}`).toBe(`${ISSUER}/auth`)
      expect(Object.fromEntries(url.searchParams)).toMatchObject({
        response_type: "code",
        client_id: CONSENT_ENV.PLATFORM_OIDC_CONSENT_CLIENT_ID,
        redirect_uri: `${ORIGIN}/api/platform/connector-consent/callback`,
        scope: "openid offline_access projets",
        resource: RESOURCE,
        prompt: "consent",
        code_challenge_method: "S256",
      })
      expect(toHost()).toEqual([])

      const { account: kept } = await consentThrough(url.toString())
      expect(kept).toMatchObject({ connector: "host_api", label: "Hote Test", owner: { kind: "user", userId: o.people.lea.id } })
      const [code] = tokenGrants().filter((grant) => grant.grant_type === "authorization_code")
      expect(code).toMatchObject({ resource: RESOURCE, redirect_uri: `${ORIGIN}/api/platform/connector-consent/callback` })
      expect(fake.seen.find((request) => new URLSearchParams(request.body).get("grant_type") === "authorization_code")?.headers.authorization).toBe(
        `Basic ${Buffer.from("oto-web:web-secret-not-in-logs").toString("base64")}`,
      )

      const listed = await callThirdParty({ function: "projet.lister" })
      expect(listed.data.result).toMatchObject({ items: [{ id: 7, name: "Alpha" }] })
      const [sent] = toHost()
      const bearer = String(sent.headers.authorization).replace(/^Bearer /, "")
      expect(JSON.parse(Buffer.from(bearer.split(".")[1], "base64url").toString())).toMatchObject({ sub: "sub-lea", aud: RESOURCE, client_id: "oto-web" })
      expect(JSON.stringify(toHost())).not.toContain(THIRD_PARTY_SUBJECT)

      // Rangés chiffrés : ni le jeton d'accès ni le jeton de rafraîchissement en clair sur la ligne du compte.
      const [row] = await account()
      expect(row).toMatchObject({ status: "active", settings: { resource: RESOURCE } })
      expect(JSON.stringify(row.row)).not.toContain(bearer)
      expect(JSON.stringify(row.row)).not.toContain("refresh-1")
      // Ni jeton ni secret au log.
      const logged = vi.mocked(console.error).mock.calls.flat().map(String).join(" ")
      for (const secret of [bearer, "refresh-1", THIRD_PARTY_SUBJECT, "web-secret-not-in-logs", "m2m-secret-not-in-logs"]) expect(logged).not.toContain(secret)
    })

    it("should start the same consent from the Connectors screen (Reconnect), and refuse it in an organisation without a host's API", async () => {
      const { url } = await startConnectorConsent(lea.db, lea.identity, { connector: "host_api" }, { origin: ORIGIN })
      expect(Object.fromEntries(new URL(url).searchParams)).toMatchObject({ client_id: "oto-web", resource: RESOURCE, scope: "openid offline_access projets" })
      expect(await codeOf(startConnectorConsent(lea.db, lea.identity, { connector: "host_api", access: "other" }, { origin: ORIGIN }))).toBe("invalid_arguments")
    })

    it("should renew the consented token at its expiry with the refresh token, for the resource", async () => {
      fake.state.consentExpiresIn = 30
      const refused = await refusal(callThirdParty({ function: "projet.lister" }))
      await consentThrough(String(refused?.details?.url))
      await callThirdParty({ function: "projet.lister" })
      expect(tokenGrants().filter((grant) => grant.grant_type === "refresh_token")).toEqual([
        expect.objectContaining({ refresh_token: "refresh-1", resource: RESOURCE }),
      ])
      const [sent] = toHost()
      expect(JSON.parse(Buffer.from(String(sent.headers.authorization).split(".")[1], "base64url").toString())).toMatchObject({ n: 2 })
    })

    it("should give the link again once the person revokes the consent by disabling the account, or the issuer refuses to renew it", async () => {
      const first = await refusal(callThirdParty({ function: "projet.lister" }))
      const { account: kept } = await consentThrough(String(first?.details?.url))
      await disableAccount(lea.db, lea.identity, { account_id: kept.id })
      expect(await refusal(callThirdParty({ function: "projet.lister" }))).toMatchObject({ code: "not_enabled", details: { reason: "host_consent_required" } })

      // Consentir de nouveau reprend le même compte, actif ; son jeton échoit vite, pour que le suivant se renouvelle.
      fake.state.consentExpiresIn = 30
      const again = await refusal(callThirdParty({ function: "projet.lister" }))
      expect((await consentThrough(String(again?.details?.url))).account.id).toBe(kept.id)
      expect((await account()).map((row) => row.status)).toEqual(["active"])

      const third = await refusal(callThirdParty({ function: "projet.lister" }))
      expect(third).toBeNull()
      fake.state.refreshRefused = true
      const lapsed = await refusal(callThirdParty({ function: "projet.lister" }))
      expect(lapsed).toMatchObject({ code: "not_enabled", details: { reason: "host_consent_required" } })
      expect(lapsed?.message).toContain("no longer holds")
      expect((await account()).map((row) => row.status)).toEqual(["error"])
      expect(toHost()).toHaveLength(1)
    })

    it("should refuse a consent given under another account of the issuer, and never send its token", async () => {
      fake.state.consentSubject = "sub-someone-else"
      const refused = await refusal(callThirdParty({ function: "projet.lister" }))
      await consentThrough(String(refused?.details?.url))
      const mismatch = await refusal(callThirdParty({ function: "projet.lister" }))
      expect(mismatch).toMatchObject({ code: "not_enabled", details: { reason: "host_consent_required" } })
      expect(mismatch?.message).toContain("under another account")
      expect((await account()).map((row) => row.status)).toEqual(["error"])
      expect(toHost()).toEqual([])
    })

    it("should never try the consent when the exchange fails for another reason", async () => {
      fake.state.exchangeRefusal = { error: "unauthorized_client", description: "token exchange is not allowed for this application" }
      expect(await refusal(callThirdParty({ function: "projet.lister" }))).toMatchObject({ code: "upstream_error" })
      expect(fake.seen.filter((request) => request.path.startsWith("/oidc/auth"))).toEqual([])
      expect(toHost()).toEqual([])
    })
  })
})
