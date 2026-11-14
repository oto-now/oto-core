// @vitest-environment node
// L'écran Connecteurs, lot 1, sur une vraie base (`connecteurs-et-comptes.md` § Écran Connecteurs, oto-core#103) : le
// compte personnel créé par un membre, l'activation implicite et le connecteur fermé, les propriétaires admis par les
// `modes` et par les capacités de l'hôte, le libellé et la description, la réactivation, la sonde d'un compte gardée et
// la sonde à blanc. Chaque personne par `fx.as` ; la connexion d'administration ne sert qu'à poser et relire.
import { randomBytes } from "crypto"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import type { ConnectorDefinition } from "../../packages/plateforme/server/connectors/definition"
import { connectorAccountForms, setAccountSecret } from "../../packages/plateforme/server/connectors/account-secret"
import { disableAccount, enableAccount, updateAccount } from "../../packages/plateforme/server/connectors/account-changes"
import { createAccount, listOwnAccounts } from "../../packages/plateforme/server/connectors/accounts"
import { deactivateConnector, listConnectorsForOrg } from "../../packages/plateforme/server/connectors/activations"
import { registerConnectors } from "../../packages/plateforme/server/connectors/declaration"
import type { Fetch } from "../../packages/plateforme/server/connectors/http"
import { forgetRecentProbes, probeAccount, probeConnector } from "../../packages/plateforme/server/connectors/probe"
import type { PlatformDb } from "../../packages/plateforme/server/db"
import { PlatformError } from "../../packages/plateforme/server/errors"
import { resolveIdentity, type Identity } from "../../packages/plateforme/server/identity"
import { registerOrgLimits } from "../../packages/plateforme/server/limits"
import { describedConnector } from "../factories/described-connector"
import { pendingMigrations, pendingReason } from "../helpers/pending-migrations"
import { hex, REFERENCE_PEOPLE, type ReferencePerson } from "../helpers/plateforme"
import { createSqlFixtures, SQL_SKIP_REASON, sqlConfigured, testAdminSql, type SqlFixtures, type SqlReferenceOrg } from "../helpers/sql"

/** La migration de l'écran : description, dernier test, libellé par propriétaire, activation implicite. */
const VERSION = "20261114120000"
const pending = (await pendingMigrations()).includes(VERSION)

const NETWORK_TIMEOUT = 120_000
const SETUP_TIMEOUT = 180_000

/** Le connecteur activé du passage, deux jamais activés, et un que l'éditeur ne vend qu'aux organisations. */
const LIVE = `t${hex(4)}`
const FRESH = `t${hex(4)}`
const SPARE = `t${hex(4)}`
const ORG_ONLY = `t${hex(4)}`
const CONNECTORS = [LIVE, FRESH, SPARE, ORG_ONLY]

const orgOnly = (): ConnectorDefinition => ({ ...describedConnector(ORG_ONLY), modes: ["byo_org"] })

type Session = { db: PlatformDb; identity: Identity }

async function refusal(promise: Promise<unknown>): Promise<PlatformError> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  )
  if (!(error instanceof PlatformError)) throw new Error(`expected a PlatformError, got ${String(error)}`)
  return error
}

/** Ce qu'un refus dit à l'écran : son code et ses précisions. */
const said = (error: PlatformError) => ({ code: error.code, details: error.details })

/** Le tiers simulé de la sonde (`get_company`) : sain avec des droits, non sain sans. */
function stubTiers(scopes: string[]) {
  const send = vi.fn<Fetch>(async () => new Response(JSON.stringify({ company: "Acme", scopes })))
  vi.stubGlobal("fetch", send)
  return send
}

const suite = !sqlConfigured
  ? `connectors screen, lot 1 (${SQL_SKIP_REASON})`
  : pending
    ? `connectors screen, lot 1 (${pendingReason([VERSION])})`
    : "connectors screen, lot 1, on a real database"

describe.skipIf(!sqlConfigured || pending)(suite, { timeout: NETWORK_TIMEOUT }, () => {
  let fx: SqlFixtures
  let o: SqlReferenceOrg
  const sessions = new Map<ReferencePerson, Session>()
  const savedKey = process.env.PLATFORM_VAULT_KEY

  function as(who: ReferencePerson): Session {
    const found = sessions.get(who)
    if (!found) throw new Error(`${who} has no session`)
    return found
  }

  const activationOf = async (connector: string) =>
    (await fx.admin<{ state: string; activated_by: string }[]>`
      select state, activated_by from platform.connector_activations where org_id = ${o.org.id} and connector = ${connector}`)[0] ?? null
  const forgetActivation = (connector: string) => fx.admin`delete from platform.connector_activations where org_id = ${o.org.id} and connector = ${connector}`
  const accountCount = async () => (await fx.admin<{ n: number }[]>`select count(*)::int as n from platform.accounts where org_id = ${o.org.id}`)[0].n

  /** Un compte personnel de `who`, du connecteur activé, créé par son service. */
  const personal = async (who: ReferencePerson, label = `Perso ${hex(3)}`, connector = LIVE) => {
    const { db, identity } = as(who)
    return createAccount(db, identity, { connector, owner_kind: "user", label, mode: "reel" })
  }

  beforeAll(async () => {
    process.env.PLATFORM_VAULT_KEY = randomBytes(32).toString("base64")
    registerConnectors([describedConnector(LIVE), describedConnector(FRESH), describedConnector(SPARE), orgOnly()])
    fx = createSqlFixtures()
    // Les connecteurs du passage en base, posés par l'administration : comptes et activations s'y rattachent.
    for (const name of CONNECTORS) await fx.admin`insert into platform.connectors (name, label) values (${name}, 'Crm')`
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
    const admin = testAdminSql()
    try {
      await admin`delete from platform.connectors where name in ${admin(CONNECTORS)}`
    } finally {
      await admin.end({ timeout: 5 })
    }
  }, SETUP_TIMEOUT)

  afterEach(() => {
    registerOrgLimits(null)
    forgetRecentProbes()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  describe("a personal account, created by its owner (point 1)", () => {
    it("should create a member's own account, activating a connector never activated in her name, then refuse it once an administrator closed it", async () => {
      const lea = as("lea")
      const created = await personal("lea", `Perso Léa ${hex(3)}`, FRESH)
      expect(created.owner).toEqual({ kind: "user", teamId: null, userId: o.people.lea.id, description: "personal" })
      expect(await activationOf(FRESH)).toEqual({ state: "active", activated_by: o.people.lea.id })

      const ada = as("ada")
      const closed = await deactivateConnector(ada.db, ada.identity, { connector: FRESH })
      expect(closed.closedBy).toEqual({ userId: o.people.ada.id, name: "Ada Martin" })
      const [seen] = (await listConnectorsForOrg(lea.db, lea.identity)).filter((connector) => connector.connector === FRESH)
      expect(seen).toMatchObject({ label: "Crm", state: "inactive", closedBy: { userId: o.people.ada.id, name: "Ada Martin" } })

      const refused = await refusal(personal("lea", `Perso Léa ${hex(3)}`, FRESH))
      expect(said(refused)).toEqual({ code: "not_enabled", details: { reason: "closed", administrators: [{ userId: o.people.ada.id, name: "Ada Martin" }] } })
      expect(refused.message).toBe(`${FRESH} is deactivated at Acme Test: no account can be added or enabled. Ask the administrators of Acme Test (Ada Martin) to activate it.`)
      // Le compte gardé ne se réactive pas non plus tant que le connecteur reste fermé.
      await disableAccount(lea.db, lea.identity, { account_id: created.id })
      expect(said(await refusal(enableAccount(lea.db, lea.identity, { account_id: created.id })))).toMatchObject({ code: "not_enabled", details: { reason: "closed" } })
      await forgetActivation(FRESH)
    })

    it("should refuse the implicit activation beyond connectors_max, writing nothing", async () => {
      const [{ active }] = await fx.admin<{ active: number }[]>`
        select count(*)::int as active from platform.connector_activations where org_id = ${o.org.id} and state = 'active'`
      registerOrgLimits({ read: ({ id }) => (id === o.org.id ? { connectors_max: active } : null) })
      const before = await accountCount()
      const refused = await refusal(personal("lea", `Perso ${hex(3)}`, SPARE))
      expect(said(refused)).toEqual({ code: "forbidden", details: { reason: "limit", limit: "connectors_max", max: active } })
      expect(refused.message).toBe(`Acme Test is limited to ${active} active ${active > 1 ? "connectors" : "connector"}. Ask the administrators of Acme Test (Ada Martin) about it.`)
      expect([await activationOf(SPARE), await accountCount()]).toEqual([null, before])
    })

    it("should admit only the owners the modes of the declaration name, and say them to the form", async () => {
      const refused = await refusal(personal("lea", `Perso ${hex(3)}`, ORG_ONLY))
      expect(said(refused)).toEqual({ code: "invalid_arguments", details: { reason: "owner_kind", admitted: ["org", "team"] } })
      expect(refused.message).toBe("Crm admits only organisation or team accounts: a personal account is not available.")
      const forms = new Map(connectorAccountForms().map((form) => [form.connector, form]))
      expect(forms.get(ORG_ONLY)).toMatchObject({ ownerKinds: ["org", "team"], probe: { available: true, balance: false } })
      expect(forms.get(LIVE)).toMatchObject({ ownerKinds: ["org", "team", "user"], probe: { available: true, balance: false } })
    })

    it("should refuse an owner outside account_owner_kinds, and an account beyond accounts_per_owner_max, disabled ones aside, at creation and at reactivation", async () => {
      const lea = as("lea")
      registerOrgLimits({ read: ({ id }) => (id === o.org.id ? { account_owner_kinds: ["org"] } : null) })
      expect(said(await refusal(personal("lea")))).toEqual({ code: "forbidden", details: { reason: "limit", limit: "account_owner_kinds", admitted: ["org"] } })

      registerOrgLimits(null)
      const first = await personal("paul")
      const paul = as("paul")
      registerOrgLimits({ read: ({ id }) => (id === o.org.id ? { accounts_per_owner_max: 1 } : null) })
      const beyond = await refusal(personal("paul"))
      expect(said(beyond)).toEqual({ code: "forbidden", details: { reason: "limit", limit: "accounts_per_owner_max", max: 1 } })
      expect(beyond.message).toBe(`Acme Test is limited to 1 ${LIVE} account for one person, disabled ones aside. Ask the administrators of Acme Test (Ada Martin) about it.`)
      // Le plafond est par propriétaire : Léa crée le sien.
      await personal("lea")
      // Un compte désactivé ne compte pas ; sa réactivation revérifie le plafond.
      await disableAccount(paul.db, paul.identity, { account_id: first.id })
      const second = await personal("paul")
      expect(said(await refusal(enableAccount(paul.db, paul.identity, { account_id: first.id })))).toEqual({
        code: "forbidden",
        details: { reason: "limit", limit: "accounts_per_owner_max", max: 1 },
      })
      registerOrgLimits(null)
      expect(said(await refusal(enableAccount(paul.db, paul.identity, { account_id: second.id })))).toEqual({ code: "conflict", details: { reason: "not_disabled" } })
      const enabled = await enableAccount(paul.db, paul.identity, { account_id: first.id })
      expect(enabled).toMatchObject({ id: first.id, status: "active", viewerLevel: "manage" })
      expect(said(await refusal(enableAccount(lea.db, lea.identity, { account_id: first.id })))).toMatchObject({ code: "not_found" })
    })
  })

  describe("the label and the description of an account (points 2 and 7)", () => {
    it("should rename and describe an account its owner manages, the label unique for its owner only, the description cleared by null", async () => {
      const tag = hex(3)
      const claire = as("claire")
      const mine = await personal("claire", `Crm Claire ${tag}`)
      await personal("claire", `Autre ${tag}`)
      // Le même libellé chez une autre personne : admis (deux homonymes se départagent à l'appel).
      await personal("lea", `Crm Claire ${tag}`)

      const changed = await updateAccount(claire.db, claire.identity, { account_id: mine.id, input: { label: ` Crm Direction ${tag} `, description: "La clé de la direction." } })
      expect(changed).toMatchObject({ id: mine.id, label: `Crm Direction ${tag}`, description: "La clé de la direction.", lastProbe: null })
      const taken = await refusal(updateAccount(claire.db, claire.identity, { account_id: mine.id, input: { label: `AUTRE ${tag}` } }))
      expect(said(taken)).toEqual({ code: "conflict", details: { reason: "label_taken" } })
      expect(taken.message).toBe(`An account labelled AUTRE ${tag} already exists for the same owner in Acme Test.`)
      expect((await updateAccount(claire.db, claire.identity, { account_id: mine.id, input: { description: null } })).description).toBeNull()

      for (const input of [{}, { label: "" }, { label: "x".repeat(81) }, { description: "x".repeat(201) }, { label: "Ok", extra: 1 }]) {
        expect((await refusal(updateAccount(claire.db, claire.identity, { account_id: mine.id, input }))).code, JSON.stringify(input)).toBe("invalid_arguments")
      }
      // Le compte personnel de Claire est invisible de Léa ; Léa ne le renomme pas.
      const lea = as("lea")
      expect((await refusal(updateAccount(lea.db, lea.identity, { account_id: mine.id, input: { label: "Pris" } }))).code).toBe("not_found")
    })

    it("should refuse to rename an account the caller reads without managing it", async () => {
      const account = await fx.createAccount(o.org.id, { connector: LIVE, ownerKind: "org", label: `Crm Org ${hex(3)}`, mode: "reel" })
      const lea = as("lea")
      expect((await refusal(updateAccount(lea.db, lea.identity, { account_id: account, input: { description: "à moi" } }))).code).toBe("forbidden")
    })
  })

  describe("the probes (point 4)", () => {
    it("should keep the last probe of an account on it, a disabled account included, for whoever manages it", async () => {
      const lea = as("lea")
      const account = await personal("lea")
      await setAccountSecret(lea.db, lea.identity, { account_id: account.id, input: { secret: { api_key: `k_${hex(8)}` } } })
      await disableAccount(lea.db, lea.identity, { account_id: account.id })
      stubTiers(["contacts:read"])
      const probe = await probeAccount(lea.db, lea.identity, { account_id: account.id })
      expect(probe).toEqual({ at: expect.any(String), healthy: true, reason: null, balance: null })
      const view = (await listOwnAccounts(lea.db, lea.identity)).find((candidate) => candidate.id === account.id)
      expect(view).toMatchObject({ status: "disabled", lastProbe: probe })
      stubTiers([])
      expect(await probeAccount(lea.db, lea.identity, { account_id: account.id })).toMatchObject({ healthy: false, reason: "Crm answered without scopes." })
    })

    it("should probe a key before the account exists, for any member, writing nothing, and refuse what cannot be probed", async () => {
      const paul = as("paul")
      const before = await accountCount()
      const send = stubTiers(["contacts:read"])
      const key = `k_${hex(8)}`
      expect(await probeConnector(paul.db, paul.identity, { connector: LIVE, input: { fields: { api_key: key } } })).toEqual({ healthy: true, reason: null, balance: null })
      expect(new Headers(send.mock.calls[0][1].headers).get("authorization")).toBe(`Bearer ${key}`)
      expect(await accountCount()).toBe(before)

      const refused = async (input: unknown) => {
        const error = await refusal(probeConnector(paul.db, paul.identity, input))
        return { code: error.code, reason: (error.details as { reason?: string } | undefined)?.reason ?? null }
      }
      expect(await refused({ connector: "mail", input: { fields: { api_key: key } } })).toEqual({ code: "invalid_arguments", reason: "no_probe" })
      expect(await refused({ connector: LIVE, input: { fields: { token: key } } })).toEqual({ code: "invalid_arguments", reason: null })
      expect(await refused({ connector: LIVE, input: { fields: {} } })).toEqual({ code: "invalid_arguments", reason: null })
      expect(await refused({ connector: "inconnu", input: { fields: { api_key: key } } })).toEqual({ code: "not_found", reason: null })
      await fx.addActivation(o.org.id, SPARE, "inactive")
      try {
        expect(await refused({ connector: SPARE, input: { fields: { api_key: key } } })).toEqual({ code: "not_enabled", reason: "closed" })
      } finally {
        await forgetActivation(SPARE)
      }
    })

    it("should refuse the eleventh probe of a person within a minute, both probes counted together", async () => {
      const paul = as("paul")
      stubTiers(["contacts:read"])
      for (let probe = 0; probe < 10; probe += 1) await probeConnector(paul.db, paul.identity, { connector: LIVE, input: { fields: { api_key: "k" } } })
      const limited = await refusal(probeConnector(paul.db, paul.identity, { connector: LIVE, input: { fields: { api_key: "k" } } }))
      expect(limited.code).toBe("rate_limited")
      expect((limited.details as { retry_after_s: number }).retry_after_s).toBeGreaterThan(0)
      // Une autre personne garde ses dix tests.
      const lea = as("lea")
      expect((await probeConnector(lea.db, lea.identity, { connector: LIVE, input: { fields: { api_key: "k" } } })).healthy).toBe(true)
    })
  })
})
