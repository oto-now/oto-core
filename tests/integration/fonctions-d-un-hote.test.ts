// @vitest-environment node
// Les fonctions d'un hôte sur une vraie base (`docs/conception/fonctions-d-un-hote.md`) : l'API de l'hôte d'une
// organisation réglée et rafraîchie par l'équipe plateforme seule, un document refusé qui laisse la version précédente
// servie et enregistre ses problèmes, le catalogue de l'organisation (`find`, `read functions`), et un `call` de bout en
// bout, en deux temps pour une fonction sensible, sous un jeton échangé jamais égal à celui de la personne. Puis le
// client tiers, dont l'émetteur n'échange pas le jeton : sans consentement, le refus et son lien d'autorisation ; le
// consentement rangé par le retour du parcours `oauth2_user`, chiffré sur le compte `host_api` de la personne ; l'appel
// sous le jeton consenti, son renouvellement, la révocation par la désactivation du compte, un renouvellement refusé, un
// consentement donné sous un autre compte de l'émetteur. Enfin ce que la personne voit : sa liste (`/me/functions`) filtre
// `read functions`, `find` et le bloc de `context`, jamais `call` ; une personne sans rôle n'a pas de bloc, une liste
// indisponible le dit, une organisation sans API d'hôte n'a pas de bloc. Un faux émetteur et un faux hôte en local
// (`tests/helpers/host-api.ts`). Organisation de référence jetable. Suite portable.
import { randomBytes } from "node:crypto"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { resolveIdentity, type Identity, type PlatformDb } from "@otomata_tech/oto_platform/server"
import { runCall } from "../../packages/plateforme/server/calls"
import { disableAccount } from "../../packages/plateforme/server/connectors/account-changes"
import { connectionStep } from "../../packages/plateforme/server/connectors/connect-page"
import { completeConnectorConsent, startConnectorConsent } from "../../packages/plateforme/server/connectors/consent"
import { orgAssistantFunctions, visibleOrgFunctions } from "../../packages/plateforme/server/catalog/org-catalog"
import { buildContext } from "../../packages/plateforme/server/context"
import type { Fetch } from "../../packages/plateforme/server/connectors/http"
import { forgetExchangedTokens } from "../../packages/plateforme/server/host-api/exchange"
import { forgetHostFunctions, hostApi, hostApiFunctions, refreshHostApi } from "../../packages/plateforme/server/host-api/service"
import { forgetHostVisibility } from "../../packages/plateforme/server/host-api/visibility"
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
    forgetHostVisibility()
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
    const catalogue = await readNode(lea.db, lea.identity, { path: "functions" }, { origin: ORIGIN, viewer: { accessToken: SUBJECT } })
    expect(catalogue.text).toContain("- projet.lister (read): List the projects")

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
    /** L'adresse stable d'un refus (`/connect/host_api?space=me`), ouverte par la page : l'adresse d'autorisation où elle envoie. */
    const opened = async (link: string) => {
      const url = new URL(link)
      const step = await connectionStep(lea.db, lea.identity, { connector: decodeURIComponent(url.pathname.split("/").pop() ?? ""), ...Object.fromEntries(url.searchParams) }, { origin: ORIGIN })
      if (step.kind !== "redirect") throw new Error(`expected a redirect, got ${step.kind}`)
      return step.url
    }
    /** Le lien d'un refus suivi comme le feraient la page puis l'émetteur : le retour sur l'adresse du paquet, avec un code et le `state`. */
    const consentThrough = async (link: string) => {
      const state = new URL(await opened(link)).searchParams.get("state") ?? ""
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

    it("should refuse without a consent with the connection link, then call the host under the consented token, never the person's", async () => {
      const refused = await refusal(callThirdParty({ function: "projet.lister" }))
      const link = `${ORIGIN}/connect/host_api?space=me`
      expect(refused).toMatchObject({ code: "not_enabled", details: { reason: "no_account", gesture: "oauth", connector: "host_api", space: "me", url: link } })
      expect(refused?.message).toContain(`Ask the user to authorize Hote Test, then call again: open ${link}`)
      const url = new URL(await opened(link))
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

      const state = url.searchParams.get("state") ?? ""
      const { account: kept, returnTo } = await completeConnectorConsent(lea.db, lea.identity, { code: `code-${randomBytes(6).toString("hex")}`, state }, { origin: ORIGIN })
      expect(kept).toMatchObject({ connector: "host_api", label: "Hote Test", owner: { kind: "user", userId: o.people.lea.id } })
      // Le retour ramène sur la page de connexion, qui dira de revenir à l'assistant.
      expect(returnTo).toBe("/connect/host_api?space=me")
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

    it("should give the same stable link from a call as from the list of functions, and pose a consent request only when the page opens", async () => {
      const requests = async () => {
        const admin = testAdminSql()
        try {
          return await admin<{ expires_at: Date }[]>`select expires_at from platform.connector_consents where org_id = ${o.org.id} and user_id = ${o.people.lea.id} and connector = 'host_api'`
        } finally {
          await admin.end({ timeout: 5 })
        }
      }
      const before = (await requests()).length
      const first = await refusal(callThirdParty({ function: "projet.lister" }))
      const url = String(first?.details?.url)
      expect(String((await refusal(callThirdParty({ function: "projet.lister" })))?.details?.url)).toBe(url)
      // La liste des fonctions de la personne dit le même lien, entier, dans sa raison.
      const { visibility } = await visibleOrgFunctions(lea.db, lea.identity, { accessToken: THIRD_PARTY_SUBJECT, origin: ORIGIN })
      expect(visibility).toMatchObject({ kind: "unavailable" })
      expect(visibility.kind === "unavailable" ? visibility.reason : "").toContain(url)
      // Ni secret ni jeton dans le lien : ni `state`, ni code, ni client.
      expect([...new URL(url).searchParams.keys()]).toEqual(["space"])
      expect((await requests()).length).toBe(before)
      // L'ouverture pose une demande, de dix minutes, à usage unique : servie une fois, elle ne ressert pas.
      const authorization = new URL(await opened(url))
      expect((await requests()).length).toBe(before + 1)
      const state = authorization.searchParams.get("state") ?? ""
      await completeConnectorConsent(lea.db, lea.identity, { code: "code-1", state }, { origin: ORIGIN })
      expect(await codeOf(completeConnectorConsent(lea.db, lea.identity, { code: "code-2", state }, { origin: ORIGIN }))).toBe("invalid_arguments")
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
      expect(await refusal(callThirdParty({ function: "projet.lister" }))).toMatchObject({ code: "not_enabled", details: { reason: "no_account", gesture: "oauth" } })

      // Consentir de nouveau reprend le même compte, actif ; son jeton échoit vite, pour que le suivant se renouvelle.
      fake.state.consentExpiresIn = 30
      const again = await refusal(callThirdParty({ function: "projet.lister" }))
      expect((await consentThrough(String(again?.details?.url))).account.id).toBe(kept.id)
      expect((await account()).map((row) => row.status)).toEqual(["active"])

      const third = await refusal(callThirdParty({ function: "projet.lister" }))
      expect(third).toBeNull()
      fake.state.refreshRefused = true
      const lapsed = await refusal(callThirdParty({ function: "projet.lister" }))
      expect(lapsed).toMatchObject({ code: "not_enabled", details: { reason: "reconnect", gesture: "oauth" } })
      expect(lapsed?.message).toContain("no longer holds")
      expect((await account()).map((row) => row.status)).toEqual(["error"])
      expect(toHost()).toHaveLength(1)
    })

    it("should refuse a consent given under another account of the issuer, and never send its token", async () => {
      fake.state.consentSubject = "sub-someone-else"
      const refused = await refusal(callThirdParty({ function: "projet.lister" }))
      await consentThrough(String(refused?.details?.url))
      const mismatch = await refusal(callThirdParty({ function: "projet.lister" }))
      expect(mismatch).toMatchObject({ code: "not_enabled", details: { reason: "reconnect", gesture: "oauth" } })
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

  describe("what the person sees: her list of the host's functions", () => {
    const viewer = { accessToken: SUBJECT, ctx: "7K3Q-M2XA", host: "claude-ai@0.1.0" }
    const catalogue = () => readNode(lea.db, lea.identity, { path: "functions" }, { origin: ORIGIN, viewer })
    const contextText = async (phrase?: string) => (await buildContext(lea.db, lea.identity, { phrase }, { userAgent: null, origin: ORIGIN, accessToken: SUBJECT })).text
    const lists = () => fake.seen.filter((request) => request.path === "/me/functions")
    const grants = () => fake.seen.filter((request) => request.path === "/oidc/token").map((request) => Object.fromEntries(new URLSearchParams(request.body)))

    beforeEach(async () => {
      fake.state.document = hostDocument("5.0.0")
      fake.state.etag = '"v5"'
      await refreshHostApi(staff.db, staff.identity, { address: HOST })
    })

    it("should show in the index only what the host lists for the person, asked once under an exchanged token without scope", async () => {
      fake.state.functions = ["projet.lister"]
      const read = await catalogue()
      expect(read.text).toContain("Functions of Hote Test open to you, by family:\nProjects:\n- projet.lister (read): List the projects")
      expect(read.text).not.toContain("archiver")
      expect((read.data as { functions: { name: string }[] }).functions.map((fn) => fn.name)).toContain("projet.lister")

      const { host } = await visibleOrgFunctions(lea.db, lea.identity, viewer)
      expect(host.map((fn) => fn.name)).toEqual(["projet.lister"])

      const text = await contextText("archive a project")
      expect(text).toContain("Functions of Hote Test open to you, by family")
      expect(text).toContain("- Projects: projet.lister\nClosest to the request:\n- projet.lister: List the projects")
      expect(text).not.toContain("projet_act.archiver")

      // Une seule lecture de la liste pour les trois portes : elle est gardée cinq minutes.
      expect(lists()).toHaveLength(1)
      const [list] = lists()
      expect(list.headers.authorization).toBe("Bearer exchanged-token-1")
      expect(list.headers["oto-org"]).toBe(o.org.id)
      expect(JSON.stringify(lists())).not.toContain(SUBJECT)
      expect(grants()).toEqual([expect.not.objectContaining({ scope: expect.anything() })])
      expect(grants()[0]).toMatchObject({ resource: RESOURCE, grant_type: "urn:ietf:params:oauth:grant-type:token-exchange" })
    })

    it("should still send a call of a function outside the list to the host, which decides, and relay its refusal", async () => {
      fake.state.functions = ["projet.lister"]
      await catalogue()
      fake.state.problem = { status: 403, body: { title: "Forbidden", detail: "Only a coach can archive a project.", code: "role_required" } }
      const refused = await callAs(lea, { function: "projet_act.archiver", arguments: { id: 7 } }).then(
        () => null,
        (error: { code: string; message: string; details?: Record<string, unknown> }) => ({ code: error.code, message: error.message, details: error.details }),
      )
      expect(refused).toEqual({ code: "forbidden", message: "Only a coach can archive a project.", details: { refusal: "role_required" } })
      expect(fake.seen.filter((request) => request.path.startsWith("/api/v2/")).map((request) => request.path)).toEqual(["/api/v2/projets/7/archive"])
    })

    it("should serve no block and no host function to a person without a role", async () => {
      fake.state.functions = []
      expect(await contextText("archive a project")).not.toContain("Hote Test")
      expect((await catalogue()).text).toContain("No function of Hote Test is open to you.")
      expect((await visibleOrgFunctions(lea.db, lea.identity, viewer)).host).toEqual([])
    })

    it("should say the list is unavailable, with its reason, rather than show every function, and not keep the failure", async () => {
      fake.state.functionsStatus = 500
      const unavailable = "Functions of Hote Test unavailable: Hote Test answered with an unexpected status (500). Retry later. acme_call still reaches Hote Test, which decides."
      expect(await contextText()).toContain(unavailable.replaceAll("acme", lea.identity.org.prefix))
      const read = await catalogue()
      expect(read.text).toContain(unavailable.replaceAll("acme", lea.identity.org.prefix))
      expect(read.text).not.toContain("projet.lister")

      fake.state.functionsStatus = null
      expect((await catalogue()).text).toContain("- projet.lister (read)")
    })

    it("should serve no block in an organisation without a host's API", async () => {
      const admin = testAdminSql()
      try {
        await admin`delete from platform.host_apis where org_id = ${o.org.id}`
      } finally {
        await admin.end({ timeout: 5 })
      }
      forgetHostFunctions()
      expect(await contextText("archive a project")).not.toContain("Hote Test")
      expect((await catalogue()).text).not.toContain("Hote Test")
      expect(lists()).toEqual([])
    })
  })
})
