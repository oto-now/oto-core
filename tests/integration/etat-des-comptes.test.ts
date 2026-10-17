// @vitest-environment node
// L'état d'un compte sur une vraie base (oto-now/oto-core#69) : un refus que la description du connecteur dit marquant
// (`marksAccount` : une clé refusée sur un 401, une autorisation expirée sous un 400, des crédits épuisés sous un 200)
// marque le compte, que l'appel suivant refuse nommément avec sa raison, sa date et à qui demander ; un 403 seul ne
// marque rien ; le premier appel réussi lève la marque, sans écriture quand il n'y en a pas. Le journal dit chaque
// marque posée ou levée ; l'écran Connecteurs et le contexte la disent. Une écriture de la marque qui échoue laisse à
// l'appel l'issue rendue par le tiers (un succès reste un succès), au log serveur et au journal. La marque s'écrit par `platform.mark_account`
// seule, que joue une personne qui ne gère pas le compte, sans rien pouvoir changer d'autre ; une autre organisation
// n'y atteint pas. Un connecteur décrit de test sous un nom propre au passage, sa ligne de `platform.connectors`
// retirée à la fin. `fetch` simulé : aucun réseau. Clé tirée à l'exécution.
import { randomBytes } from "crypto"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { setAccountSecret } from "../../packages/plateforme/server/connectors/account-secret"
import { listOrgAccounts } from "../../packages/plateforme/server/connectors/accounts"
import { registerConnectors } from "../../packages/plateforme/server/connectors/declaration"
import { teamConnectorLines } from "../../packages/plateforme/server/connectors/lines"
import type { PlatformDb } from "../../packages/plateforme/server/db"
import { PlatformError } from "../../packages/plateforme/server/errors"
import { callFunction } from "../../packages/plateforme/server/function-call"
import { resolveIdentity, type Identity } from "../../packages/plateforme/server/identity"
import { hostedConnector, markingConnector } from "../factories/described-connector"
import { pendingMigrations, pendingReason } from "../helpers/pending-migrations"
import { loggedText } from "../helpers/logs"
import { hex } from "../helpers/plateforme"
import { codeOf, createSqlFixtures, SQL_SKIP_REASON, sqlConfigured, testAdminSql, type SqlFixtures, type SqlReferenceOrg } from "../helpers/sql"

const VERSION = "20261017150000"
const pending = (await pendingMigrations()).includes(VERSION)

const CONNECTOR = `t${hex(4)}`
const READ = `${CONNECTOR}.get_company`
/** Un connecteur à compte rattaché dont la table marque : sa clé est celle de l'hôte, le compte se reconnecte. */
const HOSTED = `t${hex(4)}`
const ORIGIN = "https://acme.test"

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

async function refusal(run: Promise<unknown>): Promise<PlatformError> {
  const error = await run.then(
    () => null,
    (reason: unknown) => reason,
  )
  if (!(error instanceof PlatformError)) throw new Error(`expected a PlatformError, got ${String(error)}`)
  return error
}

type Person = { db: PlatformDb; identity: Identity }
type Row = { label: string; status: string; secret_fields: string[]; health: Record<string, unknown>; updated_at: string }

const suite = !sqlConfigured ? `account state (${SQL_SKIP_REASON})` : pending ? `account state (${pendingReason([VERSION])})` : "account state: marked by a refusal, lifted by a success"

describe.skipIf(!sqlConfigured || pending)(suite, { timeout: 120_000 }, () => {
  let fx: SqlFixtures
  let o: SqlReferenceOrg
  let outside: SqlReferenceOrg
  let ada: Person
  let claire: Person
  let stranger: Person
  const savedKey = process.env.PLATFORM_VAULT_KEY

  const person = async (org: SqlReferenceOrg, user: { id: string; email: string }): Promise<Person> => {
    const db = fx.as(user)
    return { db, identity: await resolveIdentity(db, org.host, { userId: user.id, email: user.email }) }
  }
  /** Un compte de l'organisation, sa clé posée par Ada, qui le gère (administratrice). */
  const account = async () => {
    const label = `Crm ${hex(3)}`
    const id = await fx.createAccount(o.org.id, { connector: CONNECTOR, ownerKind: "org", label, mode: "reel" })
    await setAccountSecret(ada.db, ada.identity, { account_id: id, input: { secret: { api_key: `k_${randomBytes(12).toString("hex")}` } } })
    return { id, label }
  }
  /** Claire, simple membre : elle lit avec un compte de l'organisation sans le gérer. */
  const call = (label: string, answer: Response) => {
    vi.stubGlobal("fetch", vi.fn(async () => answer))
    return callFunction(claire.db, claire.identity, { function: READ, arguments: {}, account: label }, { origin: ORIGIN })
  }
  const row = async (id: string) =>
    (await fx.admin<Row[]>`select label, status, secret_fields, health, to_json(updated_at) #>> '{}' as updated_at from platform.accounts where id = ${id}`)[0]
  const lastLine = async () =>
    (await fx.admin<{ is_error: boolean; error: string | null; args: Record<string, unknown> }[]>`
      select is_error, error, args from platform.journal where org_id = ${o.org.id} and target = ${READ} order by id desc limit 1`)[0]

  beforeAll(async () => {
    process.env.PLATFORM_VAULT_KEY = randomBytes(32).toString("base64")
    registerConnectors([markingConnector(CONNECTOR), { ...hostedConnector(HOSTED), errors: markingConnector(HOSTED).errors }], {
      hostCredentials: { [HOSTED]: () => ({ api_key: `hk_${randomBytes(12).toString("hex")}` }) },
    })
    fx = createSqlFixtures()
    await fx.admin`insert into platform.connectors (name, label) values (${CONNECTOR}, 'Crm'), (${HOSTED}, 'Hosted Crm')`
    o = await fx.buildReferenceOrg()
    outside = await fx.buildReferenceOrg()
    await fx.addActivation(o.org.id, CONNECTOR)
    await fx.addActivation(o.org.id, HOSTED)
    ada = await person(o, o.people.ada)
    claire = await person(o, o.people.claire)
    stranger = await person(outside, outside.people.ada)
  }, 180_000)

  afterAll(async () => {
    registerConnectors([])
    if (savedKey === undefined) delete process.env.PLATFORM_VAULT_KEY
    else process.env.PLATFORM_VAULT_KEY = savedKey
    await fx?.cleanup()
    const admin = testAdminSql()
    try {
      await admin`delete from platform.connectors where name in (${CONNECTOR}, ${HOSTED})`
    } finally {
      await admin.end({ timeout: 5 })
    }
  }, 180_000)

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("should mark on a refused key, refuse the next failure by name with the reason, its date and whom to ask, and journal the mark once", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const crm = await account()
    const first = await refusal(call(crm.label, json({}, 401)))
    const { mark } = (await row(crm.id)).health as { mark: { reason: string; at: string } }
    expect(mark.reason).toBe("credential_rejected")
    const since = `${new Date(mark.at).toISOString().slice(0, 10)} ${new Date(mark.at).toISOString().slice(11, 16)} UTC`
    expect(first.code).toBe("credential_rejected")
    expect(first.message.startsWith(`Crm refused the key. (key_rejected) Account « ${crm.label} » is marked: key refused since ${since}. Ask the administrators of ${o.org.name}`)).toBe(true)
    expect(first.message.endsWith(" to set a new key.")).toBe(true)
    expect(await lastLine()).toMatchObject({ is_error: true, args: { _outcome: { account_marked: 1 } } })

    const again = await refusal(call(crm.label, json({}, 401)))
    expect(again.message).toBe(first.message)
    expect(((await row(crm.id)).health as { mark: unknown }).mark).toEqual(mark)
    expect((await lastLine()).args._outcome).toBeUndefined()
  })

  it("should tell the person whose own account is marked to ask the user, for spent credits as for a refused key", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const label = `Crm ${hex(3)}`
    const id = await fx.createAccount(o.org.id, { connector: CONNECTOR, ownerKind: "user", ownerUserId: o.people.claire.id, label, mode: "reel" })
    await setAccountSecret(claire.db, claire.identity, { account_id: id, input: { secret: { api_key: `k_${randomBytes(12).toString("hex")}` } } })
    expect((await refusal(call(label, json({ error: { code: "NO_CREDITS" } })))).message).toMatch(/is marked: credits spent since .+ UTC\. Ask the user to add credits\.$/)
    expect((await refusal(call(label, json({}, 401)))).message).toMatch(/is marked: key refused since .+ UTC\. Ask the user to set a new key\.$/)
  })

  it("should tell the person whose linked account is marked for a refused key to connect it again, not to set a key", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const label = `Hosted ${hex(3)}`
    const id = await fx.createAccount(o.org.id, { connector: HOSTED, ownerKind: "user", ownerUserId: o.people.claire.id, label, mode: "reel" })
    await fx.admin`update platform.accounts set linked_id = ${`acc_${hex(4)}`}, linked_at = now() where id = ${id}`
    vi.stubGlobal("fetch", vi.fn(async () => json({}, 401)))
    const error = await refusal(callFunction(claire.db, claire.identity, { function: `${HOSTED}.get_company`, arguments: {}, account: label }, { origin: ORIGIN }))
    expect(error.code).toBe("credential_rejected")
    expect(error.message).toMatch(/is marked: key refused since .+ UTC\. Ask the user to connect it again \(Connect my account\)\.$/)
  })

  it("should mark on a body condition under a 400 and under a 200, the newer reason with its own date, and not on a 403 alone", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const crm = await account()
    expect((await refusal(call(crm.label, json({ error: { code: 190 } }, 400)))).code).toBe("credential_rejected")
    const expired = (await row(crm.id)).health.mark as { reason: string; at: string }
    expect(expired.reason).toBe("credential_rejected")
    expect((await refusal(call(crm.label, json({ error: { code: "NO_CREDITS" } })))).code).toBe("quota_exhausted")
    const spent = (await row(crm.id)).health.mark as { reason: string; at: string }
    expect(spent.reason).toBe("quota_exhausted")
    expect(Date.parse(spent.at)).toBeGreaterThanOrEqual(Date.parse(expired.at))
    expect(await lastLine()).toMatchObject({ is_error: true, args: { _outcome: { account_marked: 1 } } })

    const plain = await account()
    expect((await refusal(call(plain.label, json({}, 403)))).code).toBe("upstream_error")
    expect((await refusal(call(plain.label, json({ error: { code: 100 } }, 400)))).code).toBe("invalid_arguments")
    expect((await refusal(call(plain.label, json({}, 418)))).code).toBe("upstream_error")
    expect((await row(plain.id)).health).toEqual({})
  })

  it("should show the mark on the screen and in the context, keep the account called, and lift it at the first success, journaled", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const crm = await account()
    // Seul compte actif du connecteur : le contexte le dit comme le compte que prennent les appels.
    await fx.admin`update platform.accounts set status = 'disabled' where org_id = ${o.org.id} and connector = ${CONNECTOR} and id <> ${crm.id}`
    await refusal(call(crm.label, json({ error: { code: "NO_CREDITS" } })))
    const view = (await listOrgAccounts(ada.db, ada.identity)).find((candidate) => candidate.id === crm.id)
    expect(view).toMatchObject({ status: "active", mark: { reason: "quota_exhausted" } })
    const lines = await teamConnectorLines(claire.db, claire.identity)
    expect(lines.everyone.join("\n")).toMatch(new RegExp(`account « ${crm.label} » \\(live\\), marked: credits spent since \\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2} UTC`))

    const done = await call(crm.label, json({ name: "Contoso", scopes: ["read"] }))
    expect(done.status).toBe("done")
    const lifted = await row(crm.id)
    expect(lifted.health).toEqual({})
    expect(await lastLine()).toMatchObject({ is_error: false, args: { _outcome: { account_mark_lifted: 1 } } })
    expect((await listOrgAccounts(ada.db, ada.identity)).find((candidate) => candidate.id === crm.id)?.mark).toBeNull()

    // Un appel réussi sur un compte sans marque n'écrit rien sur la ligne du compte.
    await call(crm.label, json({ name: "Contoso", scopes: ["read"] }))
    expect((await row(crm.id)).updated_at).toBe(lifted.updated_at)
    expect((await lastLine()).args._outcome).toBeUndefined()
  })

  /**
   * L'écriture de la marque échoue sur ce seul compte (une panne de la base au moment de `platform.mark_account`) : un
   * déclencheur propre au test refuse toute mise à jour de sa ligne, retiré à la fin ; les autres comptes n'en voient rien.
   */
  async function withFailingMarkWrite(id: string, run: () => Promise<void>) {
    const trigger = `t_fail_mark_${hex(4)}`
    await fx.admin.unsafe(`create function public.${trigger}() returns trigger language plpgsql as $$ begin raise exception 'mark write fails' using errcode = 'XX000'; end $$`)
    await fx.admin.unsafe(`create trigger ${trigger} before update on platform.accounts for each row when (old.id = '${id}') execute function public.${trigger}()`)
    try {
      await run()
    } finally {
      await fx.admin.unsafe(`drop trigger ${trigger} on platform.accounts`)
      await fx.admin.unsafe(`drop function public.${trigger}()`)
    }
  }

  it("should return the success when lifting the mark fails, log the failure and journal it, the mark kept", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {})
    const crm = await account()
    await refusal(call(crm.label, json({}, 401)))
    const marked = (await row(crm.id)).health
    await withFailingMarkWrite(crm.id, async () => {
      const done = await call(crm.label, json({ name: "Contoso", scopes: ["read"] }))
      expect(done.status).toBe("done")
    })
    expect((await row(crm.id)).health).toEqual(marked)
    expect(await lastLine()).toMatchObject({ is_error: false, args: { _outcome: { account_mark_lift_failed: 1 } } })
    expect(loggedText(errors)).toContain(`[platform] connector ${CONNECTOR}: account ${crm.id}: mark not lifted (internal)`)
  })

  it("should return the named refusal of the third party, without the mark sentence, when setting the mark fails, and journal it", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {})
    const crm = await account()
    await withFailingMarkWrite(crm.id, async () => {
      const error = await refusal(call(crm.label, json({}, 401)))
      expect({ code: error.code, message: error.message }).toEqual({ code: "credential_rejected", message: "Crm refused the key. (key_rejected)" })
    })
    expect((await row(crm.id)).health).toEqual({})
    expect(await lastLine()).toMatchObject({ is_error: true, args: { _outcome: { account_mark_failed: 1 } } })
    expect(loggedText(errors)).toContain(`[platform] connector ${CONNECTOR}: account ${crm.id}: mark not set (internal)`)
  })

  it("should let a person who does not manage the account set or lift its mark through the function, and change nothing else", async () => {
    const crm = await account()
    await fx.admin`update platform.accounts set health = ${fx.admin.json({ seen: { by: "probe" } })} where id = ${crm.id}`
    const before = await row(crm.id)
    const [marked] = await claire.db.tx((sql) => sql<{ changed: boolean; mark: { reason: string } }[]>`select changed, mark from platform.mark_account(${crm.id}, 'quota_exhausted')`)
    expect(marked).toMatchObject({ changed: true, mark: { reason: "quota_exhausted" } })
    const [same] = await claire.db.tx((sql) => sql<{ changed: boolean }[]>`select changed from platform.mark_account(${crm.id}, 'quota_exhausted')`)
    expect(same.changed).toBe(false)
    const after = await row(crm.id)
    expect({ ...after, health: { seen: after.health.seen }, updated_at: null }).toEqual({ ...before, updated_at: null })

    expect(await codeOf(claire.db.tx((sql) => sql`update platform.accounts set health = '{}'::jsonb where id = ${crm.id}`))).toBe("42501")
    expect(await codeOf(claire.db.tx((sql) => sql`select * from platform.mark_account(${crm.id}, 'banned')`))).toBe("22023")
    const [cleared] = await claire.db.tx((sql) => sql<{ changed: boolean }[]>`select changed from platform.mark_account(${crm.id}, null)`)
    expect(cleared.changed).toBe(true)
    expect((await row(crm.id)).health).toEqual({ seen: { by: "probe" } })
  })

  it("should keep the mark of an account out of reach of another organisation, and of anon", async () => {
    const crm = await account()
    expect(await codeOf(stranger.db.tx((sql) => sql`select * from platform.mark_account(${crm.id}, 'quota_exhausted')`))).toBe("42501")
    expect(await codeOf(stranger.db.tx((sql) => sql`select * from platform.mark_account(${crm.id}, null)`))).toBe("42501")
    expect((await row(crm.id)).health).toEqual({})
    const [grants] = await fx.admin<{ anon: boolean; public: boolean }[]>`
      select has_function_privilege('anon', 'platform.mark_account(uuid, text)', 'execute') as anon,
             exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                      where p.oid = 'platform.mark_account(uuid, text)'::regprocedure and a.grantee = 0) as public`
    expect(grants).toEqual({ anon: false, public: false })
  })
})
