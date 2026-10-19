// @vitest-environment node
// Prise des connecteurs sur une vraie base (stories prise-des-connecteurs et moteur-des-connecteurs-decrits) : comptes
// réels, secret posé par qui gère le compte, refus d'un compte simulé sur un connecteur réel, la table des connecteurs,
// le chiffré lu par `platform.account_secret` et le secret remis à la seule fonction appelée, jamais servi ailleurs
// (NFR-ADMIN-01) ; la sonde d'un compte ; puis, migration appliquée, la liste des connecteurs tenue depuis la
// déclaration. Le connecteur réel est un connecteur décrit de test (`tests/factories/described-connector.ts`), déclaré
// sous un nom propre au passage, sa ligne de `platform.connectors` retirée à la fin. Portable : organisation O de
// `createSqlFixtures`, chaque personne sous sa session (`fx.as`), la connexion d'administration pour poser et relire.
// `fetch` simulé : aucun réseau, un jeton tiré à l'exécution. Ce qui se refuse avant la base (mode d'un compte, client
// HTTP, moteur, coffre) est dans `tests/unit/`.
import { randomBytes } from "crypto"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { runCall, type CallInput } from "../../packages/plateforme/server/calls"
import { setAccountSecret } from "../../packages/plateforme/server/connectors/account-secret"
import { probeAccount } from "../../packages/plateforme/server/connectors/probe"
import { createAccount, listOrgAccounts } from "../../packages/plateforme/server/connectors/accounts"
import { activateConnector, loadActiveConnectors } from "../../packages/plateforme/server/connectors/activations"
import { registerConnectors } from "../../packages/plateforme/server/connectors/declaration"
import type { Fetch } from "../../packages/plateforme/server/connectors/http"
import { decryptCredential } from "../../packages/plateforme/server/connectors/vault"
import type { PlatformDb } from "../../packages/plateforme/server/db"
import { PlatformError } from "../../packages/plateforme/server/errors"
import { resolveIdentity, type Identity } from "../../packages/plateforme/server/identity"
import { describedConnector, timedConnector } from "../factories/described-connector"
import { loggedText } from "../helpers/logs"
import { connectDeps } from "../helpers/mcp"
import { pendingMigrations, pendingReason } from "../helpers/pending-migrations"
import { hex, REFERENCE_PEOPLE, type ReferencePerson } from "../helpers/plateforme"
import { createSqlFixtures, spyDb, SQL_SKIP_REASON, sqlConfigured, testAdminSql, type SqlFixtures, type SqlReferenceOrg } from "../helpers/sql"

const VERSION = "20261006090000"
/** La liste des connecteurs tenue depuis la déclaration (`platform.declare_connector`). */
const DECLARED_VERSION = "20261007090000"
/** Les comptes à plusieurs champs : les services de compte lisent leurs colonnes. */
const FIELDS_VERSION = "20261008090000"
const missing = await pendingMigrations()
const fieldsPending = missing.includes(FIELDS_VERSION)
const pending = missing.includes(VERSION)
const declaredPending = missing.includes(DECLARED_VERSION)

/** Le connecteur réel du passage, et un second que seule la déclaration fait entrer en base. */
const LIVE = `t${hex(4)}`
const FRESH = `t${hex(4)}`

const NETWORK_TIMEOUT = 120_000
const SETUP_TIMEOUT = 180_000
const ORIGIN = "https://acme.test"

type Session = { db: PlatformDb; identity: Identity }

async function refusal(run: Promise<unknown>): Promise<PlatformError> {
  const error = await run.then(
    () => null,
    (reason: unknown) => reason,
  )
  if (!(error instanceof PlatformError)) throw new Error(`expected a PlatformError, got ${String(error)}`)
  return error
}

/** Le code SQL d'une requête refusée par la base, `null` si elle passe. */
const codeOf = (run: Promise<unknown>) =>
  run.then(
    () => null,
    (error: { code?: string }) => error.code ?? "?",
  )

const newSecret = () => `key_${randomBytes(16).toString("hex")}`

/** Le tiers simulé : une liste d'un contact ; chaque requête est gardée pour relire son en-tête d'authentification. */
function stubTiers(answer: unknown = { items: [{ id: "c-1", name: "Ada" }], has_more: false, next_cursor: null }) {
  const send = vi.fn<Fetch>(async () => new Response(JSON.stringify(answer)))
  vi.stubGlobal("fetch", send)
  return { send, authorizations: () => send.mock.calls.map(([, init]) => new Headers(init.headers).get("authorization")) }
}

const suite = !sqlConfigured
  ? `connector intake on a real database (${SQL_SKIP_REASON})`
  : fieldsPending
    ? `connector intake on a real database (${pendingReason([FIELDS_VERSION])})`
    : "connector intake on a real database"

describe.skipIf(!sqlConfigured || fieldsPending)(suite, { timeout: NETWORK_TIMEOUT }, () => {
  let fx: SqlFixtures
  let o: SqlReferenceOrg
  const sessions = new Map<ReferencePerson, Session>()
  const savedKey = process.env.PLATFORM_VAULT_KEY

  function as(who: ReferencePerson): Session {
    const found = sessions.get(who)
    if (!found) throw new Error(`${who} has no session`)
    return found
  }

  const call = (who: ReferencePerson, input: CallInput) => {
    const { db, identity } = as(who)
    return runCall({ db, identity, ctxCode: null, origin: ORIGIN, activeConnectors: () => loadActiveConnectors(db, o.org.id) }, input)
  }

  /** Un compte de l'organisation, au libellé propre au cas : chaque appel le nomme (`account`), sans ambiguïté. */
  async function orgAccount(mode: "reel" | "simule"): Promise<{ id: string; label: string }> {
    const label = `Crm ${mode} ${hex(3)}`
    return { id: await fx.createAccount(o.org.id, { connector: LIVE, ownerKind: "org", label, mode }), label }
  }

  const ciphertextOf = async (id: string) =>
    (await fx.admin<{ secret_ciphertext: string | null }[]>`select secret_ciphertext from platform.accounts where id = ${id}`)[0]?.secret_ciphertext ?? null

  beforeAll(async () => {
    process.env.PLATFORM_VAULT_KEY = randomBytes(32).toString("base64")
    registerConnectors([describedConnector(LIVE), describedConnector(FRESH)])
    fx = createSqlFixtures()
    // Le connecteur du passage en base, posé par l'administration : ses comptes et son activation s'y rattachent.
    await fx.admin`insert into platform.connectors (name, label) values (${LIVE}, 'Crm')`
    o = await fx.buildReferenceOrg()
    await fx.addActivation(o.org.id, LIVE)
    for (const person of REFERENCE_PEOPLE) {
      const user = o.people[person]
      const db = fx.as(user)
      sessions.set(person, { db, identity: await resolveIdentity(db, o.host, { userId: user.id, email: user.email }) })
    }
  }, SETUP_TIMEOUT)

  afterAll(async () => {
    registerConnectors([])
    if (savedKey === undefined) delete process.env.PLATFORM_VAULT_KEY
    else process.env.PLATFORM_VAULT_KEY = savedKey
    await fx?.cleanup()
    // Les lignes du passage, une fois partis les comptes et activations qui les citent (organisations retirées).
    const admin = testAdminSql()
    try {
      await admin`delete from platform.connectors where name in (${LIVE}, ${FRESH})`
    } finally {
      await admin.end({ timeout: 5 })
    }
  }, SETUP_TIMEOUT)

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  describe("live accounts and their secret (AC8, AC13)", () => {
    // `createAccount` tient la liste des connecteurs (`declare_connector`) : la migration de la déclaration d'abord.
    it.skipIf(declaredPending)("should let an administrator create a live account of a declared connector, then set its secret, never given back (AC8, AC13)", async () => {
      const ada = as("ada")
      const label = `Crm Live ${hex(3)}`
      const created = await createAccount(ada.db, ada.identity, { connector: LIVE, owner_kind: "org", label, mode: "reel" })
      expect(created).toMatchObject({ label, connector: LIVE, mode: "reel" })
      const secret = newSecret()
      const set = await setAccountSecret(ada.db, ada.identity, { account_id: created.id, input: { secret: { api_key: secret } } })
      expect(set).toEqual(created)
      const ciphertext = await ciphertextOf(created.id)
      expect(ciphertext).not.toBeNull()
      expect(JSON.stringify(set)).not.toContain(secret)
      expect(ciphertext).not.toContain(secret)
      expect(decryptCredential(created.id, ciphertext ?? "")).toEqual({ fields: { api_key: secret } })
    })

    it("should refuse the secret to whoever does not manage the account, and to a simulated account, writing nothing (AC8)", async () => {
      const live = await orgAccount("reel")
      const marc = as("marc")
      const forbidden = await refusal(setAccountSecret(marc.db, marc.identity, { account_id: live.id, input: { secret: { api_key: newSecret() } } }))
      expect({ code: forbidden.code, message: forbidden.message }).toEqual({
        code: "forbidden",
        message: `Setting the secret of « ${live.label} » is reserved to those who manage it: the administrators of Acme Test (Ada Martin).`,
      })
      const simulated = await fx.createAccount(o.org.id, { connector: "mail", ownerKind: "org", label: `Mail ${hex(3)}` })
      const ada = as("ada")
      expect((await refusal(setAccountSecret(ada.db, ada.identity, { account_id: simulated, input: { secret: { api_key: newSecret() } } }))).code).toBe("invalid_arguments")
      expect([await ciphertextOf(live.id), await ciphertextOf(simulated)]).toEqual([null, null])
    })

    it("should answer stale_revision, logged, when the account changes between its read and the write of its secret (AC8)", async () => {
      const live = await orgAccount("reel")
      const ada = as("ada")
      const errors = vi.spyOn(console, "error").mockImplementation(() => {})
      const raced = spyDb(ada.db, { before: (query) => (query.op === "update" ? fx.admin`delete from platform.accounts where id = ${live.id}` : undefined) })
      const error = await refusal(setAccountSecret(raced.db, ada.identity, { account_id: live.id, input: { secret: { api_key: newSecret() } } }))
      expect({ code: error.code, message: error.message }).toEqual({
        code: "stale_revision",
        message: `Account « ${live.label} » was changed meanwhile. Reload it and enter its secret again.`,
      })
      expect(loggedText(errors)).toContain(`[platform] setAccountSecret: account ${live.id} changed since its secret was read`)
    })

    it("should refuse a simulated account of a live connector before the function (AC13)", async () => {
      const simulated = await orgAccount("simule")
      const { send } = stubTiers()
      const error = await refusal(call("ada", { function: `${LIVE}.list_contacts`, arguments: { limit: 1 }, account: simulated.label }))
      expect({ code: error.code, message: error.message }).toEqual({
        code: "not_enabled",
        message: `Account « ${simulated.label} » is simulated, but ${LIVE} is a live connector: it runs on live accounts only. Ask the administrators of Acme Test (Ada Martin) to connect a live account.`,
      })
      expect(send).not.toHaveBeenCalled()
    })

    it("should keep secret_ciphertext out of reach of a member's select (AC10)", async () => {
      const live = await orgAccount("reel")
      const ada = as("ada")
      expect(await codeOf(ada.db.tx((sql) => sql`select secret_ciphertext from platform.accounts where id = ${live.id}`))).toBe("42501")
    })
  })

  describe.skipIf(pending)(pending ? `with the migration (${pendingReason([VERSION])})` : "with the migration", () => {
    it("should refuse an account, an activation or a draft of a connector the table does not know (AC3)", async () => {
      const unknown = `c_${hex(3)}`
      const account = await fx.createAccount(o.org.id, { connector: "mail", ownerKind: "org", label: `Mail FK ${hex(3)}` })
      expect([
        await codeOf(fx.admin`insert into platform.accounts (org_id, connector, owner_kind, label, mode) values (${o.org.id}, ${unknown}, 'org', ${`X ${hex(3)}`}, 'reel')`),
        await codeOf(fx.addActivation(o.org.id, unknown)),
        await codeOf(fx.admin`
          insert into platform.sim_outbox (org_id, account_id, connector, function, payload, created_by)
          values (${o.org.id}, ${account}, ${unknown}, 'x.y', ${fx.admin.json({})}, ${o.people.ada.id})`),
      ]).toEqual(["23503", "23503", "23503"])
    })

    it("should let any session read the connectors, and none write them (AC5)", async () => {
      const lea = as("lea")
      const names = await lea.db.tx((sql) => sql<{ name: string }[]>`select name from platform.connectors where name in ('mail', 'notion') order by name`)
      expect(names.map((row) => row.name)).toEqual(["mail", "notion"])
      expect(await codeOf(lea.db.tx((sql) => sql`insert into platform.connectors (name) values (${`c_${hex(3)}`})`))).toBe("42501")
    })

    it("should give the ciphertext to a member of the account's organisation only (AC10)", async () => {
      const live = await orgAccount("reel")
      const ada = as("ada")
      await setAccountSecret(ada.db, ada.identity, { account_id: live.id, input: { secret: { api_key: newSecret() } } })
      const other = await fx.createOrg()
      const stranger = await fx.createUser()
      await fx.addMember(other.id, stranger.id, { role: "admin" })
      const read = (db: PlatformDb) => db.tx((sql) => sql<{ secret: string | null }[]>`select platform.account_secret(${live.id}) as secret`)
      expect((await read(as("lea").db))[0].secret).toBe(await ciphertextOf(live.id))
      expect((await read(fx.as(stranger)))[0].secret).toBeNull()
    })

    it("should hand the decrypted secret to the function of a live account, and to it only (AC11)", async () => {
      const ada = as("ada")
      const live = await orgAccount("reel")
      const secret = newSecret()
      await setAccountSecret(ada.db, ada.identity, { account_id: live.id, input: { secret: { api_key: secret } } })
      const tiers = stubTiers()
      const output = await call("lea", { function: `${LIVE}.list_contacts`, arguments: { limit: 1 }, account: live.label })
      expect(tiers.authorizations()).toEqual([`Bearer ${secret}`])
      expect(output.text).toBe(`${LIVE}.list_contacts: 1 item:\n- {"id":"c-1","name":"Ada"}\nNo team · account « ${live.label} » (live).`)
    })

    it("should refuse arguments that the JSON Schema of the description refuses, before the account and the network (moteur AC2)", async () => {
      const { send } = stubTiers()
      const error = await refusal(call("lea", { function: `${LIVE}.list_contacts`, arguments: { limit: 0, limits: 1 } }))
      expect({ code: error.code, message: error.message }).toEqual({
        code: "invalid_arguments",
        message: `Invalid arguments for ${LIVE}.list_contacts: (root): Unrecognized key: "limits"; limit: must be >= 1. Read the contract with ${o.org.prefix}_read {"path": "${LIVE}.list_contacts"}.`,
      })
      expect(send).not.toHaveBeenCalled()
    })

    it("should refuse a live account without secret before the function (AC12)", async () => {
      const bare = await orgAccount("reel")
      const tiers = stubTiers()
      const error = await refusal(call("lea", { function: `${LIVE}.list_contacts`, arguments: {}, account: bare.label }))
      expect({ code: error.code, message: error.message }).toEqual({
        code: "not_enabled",
        message: `Account « ${bare.label} » has no secret yet. Ask the administrators of Acme Test (Ada Martin) to set it.`,
      })
      expect(tiers.send).not.toHaveBeenCalled()
    })

    it("should serve neither the secret nor its ciphertext in the accounts, context, the call and its journal line, read or the logs (AC15)", async () => {
      const ada = as("ada")
      const live = await orgAccount("reel")
      const secret = newSecret()
      await setAccountSecret(ada.db, ada.identity, { account_id: live.id, input: { secret: { api_key: secret } } })
      const ciphertext = (await ciphertextOf(live.id)) ?? ""
      stubTiers()
      const errors = vi.spyOn(console, "error")
      const journal: Parameters<typeof connectDeps>[0]["journal"] = []
      const gate = await connectDeps({
        db: ada.db,
        org: ada.identity.org,
        caller: { kind: "member", identity: ada.identity },
        userAgent: "vitest",
        journal,
        activeConnectors: () => loadActiveConnectors(ada.db, o.org.id),
        origin: ORIGIN,
      })
      const opened = await gate.openContext()
      const called = await gate.call("call", { ctx: opened.code, function: `${LIVE}.list_contacts`, arguments: { limit: 1 }, account: live.label })
      expect(called.isError).toBe(false)
      const contract = await gate.call("read", { ctx: opened.code, path: `${LIVE}.list_contacts` })
      const served = [
        JSON.stringify(await listOrgAccounts(ada.db, ada.identity)),
        JSON.stringify(opened.result),
        JSON.stringify(called.result),
        JSON.stringify(contract.result),
        JSON.stringify(journal),
        loggedText(errors),
      ].join("\n")
      expect([served.includes(secret), served.includes(ciphertext), served.includes("secret_ciphertext")]).toEqual([false, false, false])
    })
  })
  describe("the probe of an account (moteur AC12)", () => {
    it("should say healthy when the probe answers with its paths, and why not otherwise, the secret nowhere", async () => {
      const ada = as("ada")
      const live = await orgAccount("reel")
      const secret = newSecret()
      await setAccountSecret(ada.db, ada.identity, { account_id: live.id, input: { secret: { api_key: secret } } })
      const probe = () => probeAccount(ada.db, ada.identity, { account_id: live.id })
      const tiers = stubTiers({ company: "Acme", scopes: ["contacts:read"] })
      expect(await probe()).toEqual({ healthy: true })
      expect(tiers.authorizations()).toEqual([`Bearer ${secret}`])
      stubTiers({ company: "Acme", scopes: [] })
      expect(await probe()).toEqual({ healthy: false, reason: "Crm answered without scopes." })
      const errors = vi.spyOn(console, "error").mockImplementation(() => {})
      vi.stubGlobal("fetch", vi.fn<Fetch>(async () => new Response(JSON.stringify({ echo: secret }), { status: 401 })))
      const refused = await probe()
      expect(refused).toEqual({ healthy: false, reason: "Crm refused access: the key is invalid or lacks the scope. (access_rejected)" })
      expect(`${JSON.stringify(refused)} ${loggedText(errors)}`).not.toContain(secret)
      const bare = await orgAccount("reel")
      expect(await probeAccount(ada.db, ada.identity, { account_id: bare.id })).toEqual({
        healthy: false,
        reason: `Account « ${bare.label} » has no secret yet. Ask the administrators of Acme Test (Ada Martin) to set it.`,
      })
    })

    it("should run the probe at its function's own timeout, and say it when the third party does not answer in time (oto-core#70)", async () => {
      const ada = as("ada")
      const live = await orgAccount("reel")
      await setAccountSecret(ada.db, ada.identity, { account_id: live.id, input: { secret: { api_key: newSecret() } } })
      registerConnectors([timedConnector(2_000, LIVE), describedConnector(FRESH)])
      try {
        vi.spyOn(console, "error").mockImplementation(() => {})
        const sent = vi.spyOn(AbortSignal, "timeout")
        stubTiers({ company: "Acme", scopes: ["contacts:read"] })
        expect(await probeAccount(ada.db, ada.identity, { account_id: live.id })).toEqual({ healthy: true })
        vi.stubGlobal(
          "fetch",
          vi.fn<Fetch>(async () => {
            throw Object.assign(new Error("aborted"), { name: "TimeoutError" })
          }),
        )
        expect(await probeAccount(ada.db, ada.identity, { account_id: live.id })).toEqual({ healthy: false, reason: "Crm did not answer within 2 s. Retry later." })
        expect(sent.mock.calls.map(([ms]) => ms)).toEqual([2_000, 2_000])
      } finally {
        registerConnectors([describedConnector(LIVE), describedConnector(FRESH)])
      }
    })

    it("should reserve the probe to whoever manages the account, and refuse a connector without a probe", async () => {
      const live = await orgAccount("reel")
      const marc = as("marc")
      const forbidden = await refusal(probeAccount(marc.db, marc.identity, { account_id: live.id }))
      expect({ code: forbidden.code, message: forbidden.message }).toEqual({
        code: "forbidden",
        message: `Probing « ${live.label} » is reserved to those who manage it: the administrators of Acme Test (Ada Martin).`,
      })
      const mail = await fx.createAccount(o.org.id, { connector: "mail", ownerKind: "org", label: `Mail ${hex(3)}` })
      const ada = as("ada")
      const none = await refusal(probeAccount(ada.db, ada.identity, { account_id: mail }))
      expect({ code: none.code, message: none.message }).toEqual({ code: "invalid_arguments", message: "Connector mail declares no probe." })
    })
  })

  describe.skipIf(declaredPending)(declaredPending ? `the list of connectors kept from the declaration (${pendingReason([DECLARED_VERSION])})` : "the list of connectors kept from the declaration", () => {
    const rowsOf = async (name: string) =>
      (await fx.admin<{ name: string; label: string | null }[]>`select name, label from platform.connectors where name = ${name}`).map((row) => ({ ...row }))

    it("should add a declared connector and its label at its first activation, the host writing no SQL (moteur AC13)", async () => {
      const ada = as("ada")
      expect(await rowsOf(FRESH)).toEqual([])
      await activateConnector(ada.db, ada.identity, { connector: FRESH })
      await createAccount(ada.db, ada.identity, { connector: FRESH, owner_kind: "org", label: `Crm Fresh ${hex(3)}`, mode: "reel" })
      expect(await rowsOf(FRESH)).toEqual([{ name: FRESH, label: "Crm" }])
    })

    it("should let the server add a name only for a member of an organisation, never change one, and refuse a name the table refuses (moteur AC13)", async () => {
      const stranger = await fx.createUser()
      const declare = (db: PlatformDb, name: string, label: string | null) => db.tx((sql) => sql`select platform.declare_connector(${name}, ${label})`, "server")
      expect(await codeOf(declare(fx.as(stranger), `t${hex(4)}`, "X"))).toBe("42501")
      const lea = as("lea").db
      // Le libellé est celui que déclare l'hôte : sous la session de la personne, la fonction est refusée.
      expect(await codeOf(lea.tx((sql) => sql`select platform.declare_connector(${`t${hex(4)}`}, ${"X"})`))).toBe("42501")
      await declare(lea, "mail", "Changed")
      expect(await rowsOf("mail")).toEqual([{ name: "mail", label: "Mail" }])
      expect(await codeOf(declare(lea, "Bad Name", null))).toBe("23514")
      expect(await codeOf(declare(lea, `t${hex(4)}`, "x".repeat(81)))).toBe("22023")
    })
  })
})
