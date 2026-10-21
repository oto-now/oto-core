// @vitest-environment node
// Service du consentement OAuth (E02-S02, AC9 à AC18), avec le client d'auth simulé (le SDK, frontière du
// service) : lecture de la demande, organisation visée par la ressource, décisions. La base est la vraie
// (E01-S10, lot t1-e2b1) : O et P de `seedReferenceOrg`, lus sous le client de Léa, membre des deux, ou de
// Claire, membre de O seul, et la demande en attente que lit `oauth_pending_resource`, posée dans les tables
// du serveur OAuth de Supabase Auth (`pendingRequests`, qui crée leurs comptes). Les cas qui lisent la base ne
// tournent que sur le projet : un Postgres nu n'a pas ce serveur, et le consentement reste l'implémentation
// Supabase du port (ADR-012 § 2). Une demande refusée avant toute lecture passe un client dont les faces ne
// font qu'enregistrer.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { PlatformDb } from "../../packages/plateforme/server/db"
import { CONSENT_PATH, consentDecision, consentPath, consentRequest } from "../../packages/plateforme/server/oauth"
import type { Tx } from "../../packages/plateforme/server/sql"
import { loggedText } from "../helpers/logs"
import { AUTHORIZATION_ID as ID, DECIDED, DETAILS, form, pendingRequests, type PendingRequests } from "../helpers/oauth-pending"
import { OTHER_ORG } from "../helpers/reference-org"
import { seedReferenceOrg, type ReferenceOrgSql } from "../helpers/reference-org-sql"
import { onProject, projectConfigured, seedWithAdmin, type SeededData } from "../helpers/sql"

const RETURN_CODE = "https://claude.ai/api/mcp/auth_callback?code=c0de&state=xyz"
const RETURN_DENIED = "https://claude.ai/api/mcp/auth_callback?error=access_denied&state=xyz"
// Une `redirect_uri` qu'un client s'enregistre lui-même (DCR ouvert) : Next en ferait un `location.assign`.
const RETURN_SCRIPT = "javascript://x/%0aalert(1)//"
// E09-S02, AC14 : thème, logo et nom affiché de P, publics sur `/login` de son adresse.
const BRAND = { theme: "foret", logo_url: "https://acme.example/logo.png", display_name: "Acme" }

const NETWORK_TIMEOUT = 60_000
const SETUP_TIMEOUT = 180_000
const ON_PROJECT = "consentRequest on the project database, the pending request in the OAuth server of Supabase Auth"

const oauth = {
  getAuthorizationDetails: vi.fn(),
  approveAuthorization: vi.fn(),
  denyAuthorization: vi.fn(),
}
const auth = { oauth }

// Une demande refusée avant toute lecture : aucune face de ce client ne doit être appelée (E01-S10, AC-x3).
const faces = { from: vi.fn(), rpc: vi.fn(), tx: vi.fn() }
// Le service attend un `PlatformDb` ; ce client n'en a que les trois faces, qui enregistrent.
const untouched = faces as unknown as PlatformDb

function expectNoRequest(): void {
  expect(faces.from).not.toHaveBeenCalled()
  expect(faces.rpc).not.toHaveBeenCalled()
  expect(faces.tx).not.toHaveBeenCalled()
}

type Failure = { code: string }

/**
 * `db` dont chaque appel de la fonction SQL `fn`, sur l'une ou l'autre face, passe d'abord par `onCall`,
 * qui rend l'erreur à lever à sa place, ou rien pour laisser passer à la base : `rpc(fn)` de la face
 * PostgREST, ou une requête de la face SQL qui l'appelle (`platform.fn(` : E01-S10, une RPC y devient
 * `select platform.f(…)`). Le cas reste vrai quand un module passe d'une face à l'autre.
 */
function around(db: PlatformDb, fn: string, onCall: () => Failure | undefined): PlatformDb {
  const calling = new RegExp(`\\bplatform\\.${fn}\\s*\\(`)
  const aroundSql = (sql: Tx): Tx =>
    new Proxy(sql, {
      apply(target, self, args: unknown[]) {
        const [strings] = args
        const failure = Array.isArray(strings) && calling.test(strings.join(" ")) ? onCall() : undefined
        return failure ? Promise.reject(Object.assign(new Error(`${fn} failed`), failure)) : Reflect.apply(target, self, args)
      },
    })
  return new Proxy(db, {
    get(target, key, receiver) {
      if (key === "tx") return <T>(run: (sql: Tx) => Promise<T>) => target.tx((sql) => run(aroundSql(sql)))
      return Reflect.get(target, key, receiver)
    },
  })
}

beforeEach(() => {
  oauth.getAuthorizationDetails.mockResolvedValue({ data: DETAILS, error: null })
  oauth.approveAuthorization.mockResolvedValue({ data: { redirect_url: RETURN_CODE }, error: null })
  oauth.denyAuthorization.mockResolvedValue({ data: { redirect_url: RETURN_DENIED }, error: null })
})

afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe("consentPath", () => {
  it("should build the consent page of a request", () => {
    expect(CONSENT_PATH).toBe("/oauth/consent")
    expect(consentPath("abc123")).toBe("/oauth/consent?authorization_id=abc123")
  })

  it.each([undefined, "abc?x=1"])("should give the page alone for an id %j out of pattern", (raw) => {
    expect(consentPath(raw)).toBe(CONSENT_PATH)
  })
})

describe("consentRequest: the request refused before any read (AC9 to AC11)", () => {
  it.each([undefined, "", "../../admin/users", "abc/def", "abc.def", "a".repeat(256), ["abc123"]])(
    "should answer invalid for %j without calling the SDK (AC9)",
    async (raw) => {
      expect(await consentRequest({ auth, db: untouched }, raw)).toEqual({ kind: "invalid" })
      expect(oauth.getAuthorizationDetails).not.toHaveBeenCalled()
      expectNoRequest()
    },
  )

  it("should answer expired and log the SDK error when the request cannot be read (AC10)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    const sdkError = { name: "AuthApiError", status: 404, message: "authorization not found" }
    oauth.getAuthorizationDetails.mockResolvedValue({ data: null, error: sdkError })

    expect(await consentRequest({ auth, db: untouched }, ID)).toEqual({ kind: "expired" })
    expect(log).toHaveBeenCalledWith(expect.any(String), sdkError)
    expectNoRequest()
  })

  it("should answer redirect when consent was already given (AC11)", async () => {
    oauth.getAuthorizationDetails.mockResolvedValue({ data: { redirect_url: RETURN_CODE }, error: null })

    expect(await consentRequest({ auth, db: untouched }, ID)).toEqual({ kind: "redirect", url: RETURN_CODE })
    expectNoRequest()
  })

  it("should refuse a return address that is neither http nor https, and log it without the address (AC11)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    oauth.getAuthorizationDetails.mockResolvedValue({ data: { redirect_url: RETURN_SCRIPT }, error: null })

    expect(await consentRequest({ auth, db: untouched }, ID)).toEqual({ kind: "expired" })
    expect(log).toHaveBeenCalledTimes(1)
    expect(loggedText(log)).not.toContain("alert")
  })

  // Le consentement des assistants se donne chez l'émetteur OIDC : rien à lire chez Supabase Auth.
  it("should answer not_found in OIDC mode, before the SDK and the database (E01-S11 AC-a10)", async () => {
    vi.stubEnv("PLATFORM_OIDC_ISSUER", "https://issuer.example.test/oidc")

    await expect(consentRequest({ auth, db: untouched }, ID)).rejects.toMatchObject({ code: "not_found" })
    expect(oauth.getAuthorizationDetails).not.toHaveBeenCalled()
    expectNoRequest()
  })
})

describe.skipIf(!projectConfigured)(
  onProject(ON_PROJECT),
  { timeout: NETWORK_TIMEOUT },
  () => {
    let seed: SeededData
    let ref: ReferenceOrgSql
    let requests: PendingRequests

    beforeAll(async () => {
      seed = seedWithAdmin()
      ref = await seedReferenceOrg(seed)
      await ref.write({ orgs: [{ id: OTHER_ORG.id, brand: BRAND }] })
      // Une demande vise le compte Supabase Auth de sa personne (`user_id`, clé vers `auth.users`).
      requests = await pendingRequests(seed.admin, [ref.people.lea, ref.people.claire])
    }, SETUP_TIMEOUT)

    afterAll(async () => {
      try {
        await requests?.cleanup()
      } finally {
        await seed?.cleanup()
      }
    }, SETUP_TIMEOUT)

    /** La ressource MCP d'une organisation, sur son adresse. */
    const mcpOf = (host: string) => `https://${host}/api/mcp`

    /** Une demande en attente de la personne (`null` : pas encore rattachée) pour `resource`, par défaut le MCP de O. */
    function pending(resource: string | null = mcpOf(ref.org.host), person: "lea" | "claire" | null = "lea"): Promise<string> {
      return requests.pending(resource, person && ref.people[person].id)
    }

    /** L'écran de la demande `id`, lue sous `db`, par défaut le client de Léa. */
    async function demande(id: string, db?: PlatformDb) {
      const result = await consentRequest({ auth, db: db ?? (await ref.db("lea")) }, id)
      if (result.kind !== "ask") throw new Error(`expected ask, got ${result.kind}`)
      return result.demande
    }

    describe("consentRequest: the request (AC12)", () => {
      it("should give the client, the account, the return address, the accesses and the organisation (AC12)", async () => {
        const id = await pending()

        expect(await demande(id)).toEqual({
          authorizationId: id,
          client: { nom: "Claude", site: "https://claude.ai/", logo: "https://claude.ai/logo.png" },
          compte: "claire@example.invalid",
          adresseDeRetour: "https://claude.ai/api/mcp/auth_callback",
          acces: [
            { scope: "openid", libelle: "Vous identifier (openid)" },
            { scope: "email", libelle: "Lire votre adresse email (email)" },
            { scope: "profile", libelle: "Lire votre nom (profile)" },
            { scope: "offline_access", libelle: "Rester connecté sans vous le redemander (offline_access)" },
          ],
          organisation: { etat: "connue", nom: ref.org.name, membre: true, marque: { theme: "manuscrit", logo: null, nomAffiche: ref.org.name } },
        })
        expect(oauth.getAuthorizationDetails).toHaveBeenCalledWith(id)
      })

      // Seul `getAuthorizationDetails` rattache la demande à la personne (fiche D10) : lue avant lui, la
      // ressource manquerait à `oauth_pending_resource`, et l'organisation avec elle.
      it("should read the resource after the request, which ties it to the person", async () => {
        const id = await pending(mcpOf(ref.org.host), null)
        oauth.getAuthorizationDetails.mockImplementation(async () => {
          await requests.tie(id, ref.people.lea.id)
          return { data: DETAILS, error: null }
        })

        expect((await demande(id)).organisation).toMatchObject({ etat: "connue", nom: ref.org.name, membre: true })
      })

      // Une preview, à une adresse inconnue d'`org_domains` : l'hôte dit l'adresse à servir, la même fonction qu'à la porte MCP.
      it("should name the organisation of the address the host chooses for a resource at an unknown address", async () => {
        const preview = "preview-42.example.invalid"
        const db = await ref.db("lea")

        const sans = await consentRequest({ auth, db }, await pending(mcpOf(preview)))
        expect(sans.kind === "ask" && sans.demande.organisation).toEqual({ etat: "inconnue", hote: preview })

        const seen: (string | null)[] = []
        const host = ({ host: called }: { host: string | null }) => (seen.push(called), ref.org.host)
        const avec = await consentRequest({ auth, db, host }, await pending(mcpOf(preview)))
        expect(avec.kind === "ask" && avec.demande.organisation).toMatchObject({ etat: "connue", nom: ref.org.name, membre: true })
        expect(seen).toEqual([preview])

        const aucune = await consentRequest({ auth, db, host: () => null }, await pending(mcpOf(preview)))
        expect(aucune.kind === "ask" && aucune.demande.organisation).toEqual({ etat: "inconnue", hote: preview })
      })

      // Un « а » cyrillique se lit comme un « a » : l'adresse s'affiche telle que la suit le navigateur.
      it("should show the return address as the browser reads it, the host in punycode", async () => {
        oauth.getAuthorizationDetails.mockResolvedValue({ data: { ...DETAILS, redirect_uri: "https://clаude.ai/api/mcp/auth_callback" }, error: null })

        expect((await demande(await pending())).adresseDeRetour).toBe("https://xn--clude-5ve.ai/api/mcp/auth_callback")
      })

      it("should keep an unknown scope as is, in the order received, twice when sent twice", async () => {
        oauth.getAuthorizationDetails.mockResolvedValue({ data: { ...DETAILS, scope: "openid mcp:tools  openid" }, error: null })

        expect((await demande(await pending())).acces.map((acces) => acces.libelle)).toEqual(["Vous identifier (openid)", "mcp:tools", "Vous identifier (openid)"])
      })

      it("should show a scope named like an object property as is", async () => {
        oauth.getAuthorizationDetails.mockResolvedValue({ data: { ...DETAILS, scope: "toString constructor __proto__" }, error: null })

        expect((await demande(await pending())).acces.map((acces) => acces.libelle)).toEqual(["toString", "constructor", "__proto__"])
      })

      it("should list no access when Supabase omits an empty scope", async () => {
        const sansScope: Partial<typeof DETAILS> = { ...DETAILS }
        delete sansScope.scope
        oauth.getAuthorizationDetails.mockResolvedValue({ data: sansScope, error: null })

        expect((await demande(await pending())).acces).toEqual([])
      })

      it("should name a client without name « Client sans nom »", async () => {
        oauth.getAuthorizationDetails.mockResolvedValue({ data: { ...DETAILS, client: { id: "client-2", name: "", uri: "", logo_uri: "" } }, error: null })

        expect((await demande(await pending())).client).toEqual({ nom: "Client sans nom", site: null, logo: null })
      })

      // `https://claude.ai@evil.example/` se lit « claude.ai » et mène à evil.example : identifiants refusés.
      it.each(["javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "ftp://claude.ai/logo.png", "not a url", "https://claude.ai@evil.example/"])(
        "should drop a site or logo address %j (http and https only, without credentials)",
        async (address) => {
          oauth.getAuthorizationDetails.mockResolvedValue({ data: { ...DETAILS, client: { ...DETAILS.client, uri: address, logo_uri: address } }, error: null })

          const { client } = await demande(await pending())

          expect(client.site).toBeNull()
          expect(client.logo).toBeNull()
          expect(client.nom).toBe("Claude")
        },
      )
    })

    describe("consentRequest: the organisation of the resource (AC13, AC14)", () => {
      it("should say the person is not a member (AC13)", async () => {
        const id = await pending(mcpOf(ref.other.host), "claire")

        expect((await demande(id, await ref.db("claire"))).organisation).toMatchObject({ etat: "connue", nom: ref.other.name, membre: false })
      })

      // E09-S02, AC14 : thème, logo et nom affiché, publics sur `/login` de l'adresse, pour un membre comme pour un non-membre.
      it.each([true, false])("should give the brand of the organisation, its official name kept (member: %s)", async (membre) => {
        const person = membre ? "lea" : "claire"
        const id = await pending(mcpOf(ref.other.host), person)

        expect((await demande(id, await ref.db(person))).organisation).toEqual({
          etat: "connue",
          nom: ref.other.name,
          membre,
          // E05-S13 (AC-3) : le nom de l'organisation, `display_name` n'étant plus lu.
          marque: { theme: "foret", logo: "https://acme.example/logo.png", nomAffiche: ref.other.name },
        })
      })

      it("should name the normalized host of a resource without organisation (AC14)", async () => {
        const id = await pending("https://Delta.Example.Test:8443/api/mcp")

        expect((await demande(id)).organisation).toEqual({ etat: "inconnue", hote: "delta.example.test" })
      })

      it.each([
        ["the function is missing (PGRST202)", "oauth_pending_resource", "PGRST202"],
        ["the function fails", "oauth_pending_resource", "XX000"],
        ["org_by_host fails", "org_by_host", "57014"],
        ["member_orgs fails", "member_orgs", "XX000"],
      ])("should say « non déterminée » and log when %s (AC14)", async (_cas, fn, code) => {
        const log = vi.spyOn(console, "error").mockImplementation(() => {})
        const id = await pending()

        const result = await demande(id, around(await ref.db("lea"), fn, () => ({ code })))

        expect(result.organisation).toEqual({ etat: "indeterminee" })
        expect(log).toHaveBeenCalled()
        expect(result.compte).toBe("claire@example.invalid")
      })

      /** Le client de Léa, et le nombre de lectures de `org_by_host` qu'il a faites. */
      async function watchingOrgDomains() {
        const lookups = { count: 0 }
        const db = around(await ref.db("lea"), "org_by_host", () => void (lookups.count += 1))
        return { db, lookups }
      }

      it.each([
        ["absent", null],
        ["unreadable", "not a url"],
        ["an IPv6 literal", "https://[::1]/api/mcp"],
      ])("should say « non déterminée » for a resource %s (AC14)", async (_cas, resource) => {
        const { db, lookups } = await watchingOrgDomains()

        expect((await demande(await pending(resource), db)).organisation).toEqual({ etat: "indeterminee" })
        expect(lookups.count).toBe(0)
      })

      it.each(["https://acme.example.test/", "https://acme.example.test/api/mcp/extra"])(
        "should say « non déterminée » for %s, outside the MCP of an organisation, without reading org_domains",
        async (resource) => {
          const { db, lookups } = await watchingOrgDomains()

          expect((await demande(await pending(resource), db)).organisation).toEqual({ etat: "indeterminee" })
          expect(lookups.count).toBe(0)
        },
      )

      // L'organisation du MCP admin est un argument de ses outils, pas son adresse (H105) : ni le nom de
      // l'organisation de l'hôte, ni l'avis au non-membre à un membre de l'équipe plateforme, mais le MCP
      // d'administration nommé (HN-E02S02-28).
      it("should name the administration MCP for its resource, without reading org_domains", async () => {
        const { db, lookups } = await watchingOrgDomains()

        expect((await demande(await pending(`https://${ref.org.host}/api/mcp-admin`), db)).organisation).toEqual({ etat: "administration" })
        expect(lookups.count).toBe(0)
      })
    })
  },
)

describe("consentDecision (AC15 to AC18)", () => {
  it("should re-read the request, then approve without browser redirect (AC15)", async () => {
    const result = await consentDecision({ auth }, form({ authorization_id: ID, decision: "approve" }))

    expect(result).toEqual({ kind: "redirect", url: RETURN_CODE })
    expect(oauth.getAuthorizationDetails).toHaveBeenCalledWith(ID)
    expect(oauth.approveAuthorization).toHaveBeenCalledWith(ID, { skipBrowserRedirect: true })
    expect(oauth.getAuthorizationDetails.mock.invocationCallOrder[0]).toBeLessThan(oauth.approveAuthorization.mock.invocationCallOrder[0])
    expect(oauth.denyAuthorization).not.toHaveBeenCalled()
  })

  it("should deny without browser redirect (AC16)", async () => {
    const result = await consentDecision({ auth }, form({ authorization_id: ID, decision: "deny" }))

    expect(result).toEqual({ kind: "redirect", url: RETURN_DENIED })
    expect(oauth.denyAuthorization).toHaveBeenCalledWith(ID, { skipBrowserRedirect: true })
    expect(oauth.approveAuthorization).not.toHaveBeenCalled()
  })

  it.each(["approve", "deny"] as const)(
    "should ask to retry when the SDK fails to %s on a request still pending, and log it (AC17)",
    async (decision) => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {})
      const sdkError = { name: "AuthRetryableFetchError", status: 503, message: "upstream unavailable" }
      oauth.approveAuthorization.mockResolvedValue({ data: null, error: sdkError })
      oauth.denyAuthorization.mockResolvedValue({ data: null, error: sdkError })

      const result = await consentDecision({ auth }, form({ authorization_id: ID, decision }))

      expect(result).toEqual({ kind: "retry", authorizationId: ID, erreur: "decision" })
      expect(log).toHaveBeenCalledWith(expect.any(String), sdkError)
    },
  )

  // État mesuré sur le serveur OAuth du projet (HN-E02S02-20) : une demande tranchée dans un autre
  // onglet répond 400 à la relecture comme à la décision.
  it.each(["approve", "deny"] as const)("should ask to retry, logging both errors, when another tab already decided (%s, AC17)", async (decision) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    oauth.getAuthorizationDetails.mockResolvedValue({ data: null, error: DECIDED })
    oauth.approveAuthorization.mockResolvedValue({ data: null, error: DECIDED })
    oauth.denyAuthorization.mockResolvedValue({ data: null, error: DECIDED })

    const result = await consentDecision({ auth }, form({ authorization_id: ID, decision }))

    expect(result).toEqual({ kind: "retry", authorizationId: ID, erreur: "decision" })
    expect(log).toHaveBeenCalledTimes(2)
  })

  it("should ask to retry when Supabase gives no return address (AC17)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    oauth.approveAuthorization.mockResolvedValue({ data: {}, error: null })

    expect(await consentDecision({ auth }, form({ authorization_id: ID, decision: "approve" }))).toEqual({
      kind: "retry",
      authorizationId: ID,
      erreur: "decision",
    })
  })

  it.each(["approve", "deny"] as const)("should refuse a return address that is neither http nor https after %s", async (decision) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    oauth.approveAuthorization.mockResolvedValue({ data: { redirect_url: RETURN_SCRIPT }, error: null })
    oauth.denyAuthorization.mockResolvedValue({ data: { redirect_url: RETURN_SCRIPT }, error: null })

    const result = await consentDecision({ auth }, form({ authorization_id: ID, decision }))

    expect(result).toEqual({ kind: "retry", authorizationId: ID, erreur: "decision" })
    expect(loggedText(log)).not.toContain("alert")
  })

  // Seule la première lecture d'une demande rend l'adresse de retour, quand un consentement existe déjà
  // (mesure, HN-E02S02-20) : jamais la relecture d'une demande que la page a montrée.
  it("should go back to the assistant on approve when the re-read gives the return address", async () => {
    oauth.getAuthorizationDetails.mockResolvedValue({ data: { redirect_url: RETURN_CODE }, error: null })

    const result = await consentDecision({ auth }, form({ authorization_id: ID, decision: "approve" }))

    expect(result).toEqual({ kind: "redirect", url: RETURN_CODE })
    expect(oauth.approveAuthorization).not.toHaveBeenCalled()
  })

  it("should refuse that return address when it is neither http nor https", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    oauth.getAuthorizationDetails.mockResolvedValue({ data: { redirect_url: RETURN_SCRIPT }, error: null })

    const result = await consentDecision({ auth }, form({ authorization_id: ID, decision: "approve" }))

    expect(result).toEqual({ kind: "retry", authorizationId: ID, erreur: "decision" })
    expect(oauth.approveAuthorization).not.toHaveBeenCalled()
  })

  it("should not deny a request that its re-read has just approved, and ask to retry", async () => {
    oauth.getAuthorizationDetails.mockResolvedValue({ data: { redirect_url: RETURN_CODE }, error: null })

    const result = await consentDecision({ auth }, form({ authorization_id: ID, decision: "deny" }))

    expect(result).toEqual({ kind: "retry", authorizationId: ID, erreur: "decision" })
    expect(oauth.denyAuthorization).not.toHaveBeenCalled()
  })

  it("should still decide when the re-read fails, and log it", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    oauth.getAuthorizationDetails.mockResolvedValue({ data: null, error: { name: "AuthRetryableFetchError", status: 0 } })

    const result = await consentDecision({ auth }, form({ authorization_id: ID, decision: "approve" }))

    expect(result).toEqual({ kind: "redirect", url: RETURN_CODE })
    expect(log).toHaveBeenCalled()
  })

  it.each<Record<string, string>>([
    { authorization_id: "../../admin/users", decision: "approve" },
    { authorization_id: ID, decision: "maybe" },
    { authorization_id: ID },
    { decision: "deny" },
  ])("should answer invalid for %j without calling the SDK (AC18)", async (fields) => {
    expect(await consentDecision({ auth }, form(fields))).toEqual({ kind: "invalid" })
    expect(oauth.getAuthorizationDetails).not.toHaveBeenCalled()
    expect(oauth.approveAuthorization).not.toHaveBeenCalled()
    expect(oauth.denyAuthorization).not.toHaveBeenCalled()
  })
})
