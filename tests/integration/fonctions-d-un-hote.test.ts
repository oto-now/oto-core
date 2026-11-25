// @vitest-environment node
// Les fonctions d'un hôte sur une vraie base (`docs/conception/fonctions-d-un-hote.md`) : l'API de l'hôte d'une
// organisation réglée et rafraîchie par l'équipe plateforme seule, un document refusé qui laisse la version précédente
// servie et enregistre ses problèmes, le catalogue de l'organisation (`find`, `read functions`), et un `call` de bout en
// bout, en deux temps pour une fonction sensible, sous un jeton échangé jamais égal à celui de la personne. Un faux
// émetteur et un faux hôte en local (`tests/helpers/host-api.ts`). Organisation de référence jetable. Suite portable.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { resolveIdentity, type Identity, type PlatformDb } from "@otomata_tech/oto_platform/server"
import { runCall } from "../../packages/plateforme/server/calls"
import { orgAssistantFunctions } from "../../packages/plateforme/server/catalog/org-catalog"
import type { Fetch } from "../../packages/plateforme/server/connectors/http"
import { forgetExchangedTokens } from "../../packages/plateforme/server/host-api/exchange"
import { forgetHostFunctions, hostApi, hostApiFunctions, refreshHostApi } from "../../packages/plateforme/server/host-api/service"
import { readNode } from "../../packages/plateforme/server/nodes/read"
import { EXCHANGE_ENV, HOST, hostDocument, ISSUER, routeFetch, startFakeHost, type FakeHost } from "../helpers/host-api"
import { pendingMigrations } from "../helpers/pending-migrations"
import { codeOf, createSqlFixtures, SQL_SKIP_REASON, sqlConfigured, type SqlFixtures, type SqlReferenceOrg } from "../helpers/sql"

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
    for (const [name, value] of Object.entries(EXCHANGE_ENV)) vi.stubEnv(name, value)
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

  const callAs = (session: Session, input: { function: string; arguments?: Record<string, unknown>; confirm?: boolean }) =>
    runCall({ db: session.db, identity: session.identity, ctxCode: "7K3Q-M2XA", ctxHost: "claude-ai@0.1.0", origin: "https://acme.example.test", accessToken: SUBJECT, activeConnectors: async () => new Set<string>() }, input)

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
})
