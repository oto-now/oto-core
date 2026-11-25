// Les connecteurs ouverts par défaut (`connecteurs-et-comptes.md` § Activation), sur une vraie base, avec un connecteur
// réel à clé déclaré et jamais touché (aucune ligne d'activation) : `find` le trouve, `read` sert son contrat, et un
// appel sans compte rend le refus `no_account` et son lien de connexion, jamais `connector_off`. Bloqué par un
// administrateur (une ligne `inactive`), il disparaît de `find` et de `read`, son appel est refusé `connector_off` et
// l'ajout d'un compte `closed`. Un connecteur sans clé (`auth: none`, l'open data) s'exécute sans compte ni secret.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { runCall, type CallInput } from "../../packages/plateforme/server/calls"
import { catalogFunctions } from "../../packages/plateforme/server/catalog/registry"
import { createAccount } from "../../packages/plateforme/server/connectors/accounts"
import { loadOpenConnectors } from "../../packages/plateforme/server/connectors/activations"
import { registerConnectors } from "../../packages/plateforme/server/connectors/declaration"
import type { ConnectorView } from "../../packages/plateforme/server/connectors/definition"
import type { Fetch } from "../../packages/plateforme/server/connectors/http"
import type { PlatformDb } from "../../packages/plateforme/server/db"
import { PlatformError } from "../../packages/plateforme/server/errors"
import { find } from "../../packages/plateforme/server/find"
import { resolveIdentity, type Identity } from "../../packages/plateforme/server/identity"
import { readNode } from "../../packages/plateforme/server/nodes/read"
import { describedConnector } from "../factories/described-connector"
import { hex, REFERENCE_PEOPLE, type ReferencePerson } from "../helpers/plateforme"
import { createSqlFixtures, SQL_SKIP_REASON, sqlConfigured, testAdminSql, type SqlFixtures, type SqlReferenceOrg } from "../helpers/sql"

const LIVE = `t${hex(4)}`
const OPEN_DATA = `o${hex(4)}`
const ORIGIN = "https://acme.example.test"
const SETUP_TIMEOUT = 180_000

type Session = { db: PlatformDb; identity: Identity }

/** Le connecteur de test, sans clé : ni champ, ni sonde, ni compte. */
function keylessConnector(name: string): ConnectorView {
  return { ...describedConnector(name), label: "Open data", auth: { kind: "none" }, credential: [], probe: undefined }
}

async function refusal(run: Promise<unknown>): Promise<PlatformError> {
  const error = await run.then(
    () => null,
    (reason: unknown) => reason,
  )
  if (!(error instanceof PlatformError)) throw new Error(`expected a PlatformError, got ${String(error)}`)
  return error
}

const suite = sqlConfigured ? "connectors open by default, on a real database" : `connectors open by default (${SQL_SKIP_REASON})`

describe.skipIf(!sqlConfigured)(suite, { timeout: 120_000 }, () => {
  let fx: SqlFixtures
  let o: SqlReferenceOrg
  const sessions = new Map<ReferencePerson, Session>()

  function as(who: ReferencePerson): Session {
    const found = sessions.get(who)
    if (!found) throw new Error(`${who} has no session`)
    return found
  }

  const call = (who: ReferencePerson, input: CallInput) => {
    const { db, identity } = as(who)
    return runCall({ db, identity, ctxCode: null, origin: ORIGIN, activeConnectors: () => loadOpenConnectors(db, o.org.id) }, input)
  }
  const found = async (who: ReferencePerson, query: string) => {
    const { db, identity } = as(who)
    const output = await find(db, identity, { query, type: "function" }, { functions: catalogFunctions(), activeConnectors: await loadOpenConnectors(db, o.org.id) })
    return (output.data as { functions: { name: string }[] }).functions.map((fn) => fn.name)
  }
  const read = (who: ReferencePerson, path: string) => readNode(as(who).db, as(who).identity, { path })

  beforeAll(async () => {
    registerConnectors([describedConnector(LIVE), keylessConnector(OPEN_DATA)])
    fx = createSqlFixtures()
    await fx.admin`insert into platform.connectors (name, label) values (${LIVE}, 'Crm'), (${OPEN_DATA}, 'Open data')`
    o = await fx.buildReferenceOrg()
    for (const person of REFERENCE_PEOPLE) {
      const user = o.people[person]
      const db = fx.as(user)
      sessions.set(person, { db, identity: await resolveIdentity(db, o.host, { userId: user.id, email: user.email }) })
    }
  }, SETUP_TIMEOUT)

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  afterAll(async () => {
    registerConnectors([])
    await fx?.cleanup()
    const admin = testAdminSql()
    try {
      await admin`delete from platform.connectors where name in (${LIVE}, ${OPEN_DATA})`
    } finally {
      await admin.end({ timeout: 5 })
    }
  }, SETUP_TIMEOUT)

  it("should find a connector never touched in the organisation and serve its contract to read", async () => {
    const rows = await fx.admin`select 1 from platform.connector_activations where org_id = ${o.org.id} and connector = ${LIVE}`
    expect(rows).toHaveLength(0)
    expect(await found("lea", `${LIVE}.get_contact`)).toContain(`${LIVE}.get_contact`)
    const contract = await read("lea", `${LIVE}.get_contact`)
    expect(contract.target).toBe(`${LIVE}.get_contact`)
  })

  it("should refuse a call without an account with no_account and the link to connect one, never connector_off", async () => {
    const refused = await refusal(call("lea", { function: `${LIVE}.get_contact`, arguments: { contact_id: "c-1" } }))
    const url = `${ORIGIN}/connect/${LIVE}?space=me`
    expect([refused.code, refused.details]).toEqual(["not_enabled", { reason: "no_account", gesture: "key", connector: LIVE, space: "me", url }])
    expect(refused.message).toContain(url)
  })

  it("should run a keyless connector (auth none) without any account nor secret", async () => {
    const send = vi.fn<Fetch>(async () => new Response(JSON.stringify({ id: "c-1", name: "Ada", email: "ada@example.test" })))
    vi.stubGlobal("fetch", send)
    const result = await call("lea", { function: `${OPEN_DATA}.get_contact`, arguments: { contact_id: "c-1" } })
    expect(result.data).toMatchObject({ result: { id: "c-1", name: "Ada", email: "ada@example.test" } })
    expect(result.accountId).toBeNull()
    expect(send).toHaveBeenCalledTimes(1)
    expect(new Headers(send.mock.calls[0][1]?.headers).get("authorization")).toBeNull()
    const accounts = await fx.admin`select 1 from platform.accounts where org_id = ${o.org.id} and connector = ${OPEN_DATA}`
    expect(accounts).toHaveLength(0)
  })

  it("should hide a connector an administrator blocked from find and read, refuse its call connector_off and an account closed", async () => {
    await fx.addActivation(o.org.id, LIVE, "inactive")
    try {
      expect((await found("lea", `${LIVE}.get_contact`)).filter((name) => name.startsWith(`${LIVE}.`))).toEqual([])
      expect((await refusal(read("lea", `${LIVE}.get_contact`))).code).toBe("not_found")
      const off = await refusal(call("lea", { function: `${LIVE}.get_contact`, arguments: { contact_id: "c-1" } }))
      expect([off.code, (off.details as { reason?: string }).reason, (off.details as { gesture?: string }).gesture]).toEqual(["not_enabled", "connector_off", "admin_activation"])
      const { db, identity } = as("lea")
      const closed = await refusal(createAccount(db, identity, { connector: LIVE, owner_kind: "user", label: `Crm ${hex(3)}`, mode: "reel" }))
      expect([closed.code, (closed.details as { reason?: string }).reason]).toEqual(["not_enabled", "closed"])
    } finally {
      await fx.admin`delete from platform.connector_activations where org_id = ${o.org.id} and connector = ${LIVE}`
    }
  })
})
