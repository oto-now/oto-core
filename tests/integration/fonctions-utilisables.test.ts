// @vitest-environment node
// Les fonctions que la personne peut appeler, devant celles d'un connecteur sans compte (`routage-et-recherche.md`
// § Classement des fonctions), sur une vraie base : la lecture groupée des comptes qu'elle sert
// (`connectorsWithUsableAccount`, la règle de `listUsableAccounts`), puis `find` et les propositions de `context` qui la
// lisent. Les connecteurs sont ceux de `@otomata_tech/connectors` (version épinglée), seulement déclarés : aucun appel
// au tiers ; les comptes sont des lignes simulées.
import * as connectorsLibrary from "@otomata_tech/connectors"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { assistantFunctions } from "../../packages/plateforme/server/catalog/registry"
import { registerConnectors } from "../../packages/plateforme/server/connectors/declaration"
import type { ConnectorDefinition } from "../../packages/plateforme/server/connectors/definition"
import { connectorsWithUsableAccount, usablePredicate } from "../../packages/plateforme/server/connectors/usable-accounts"
import { routingHints } from "../../packages/plateforme/server/context/hints"
import type { PlatformDb } from "../../packages/plateforme/server/db"
import { find } from "../../packages/plateforme/server/find"
import { resolveIdentity, type Identity } from "../../packages/plateforme/server/identity"
import { removeMember } from "../../packages/plateforme/server/members"
import { setAccountRule } from "../../packages/plateforme/server/rules"
import { loggedText } from "../helpers/logs"
import { hex } from "../helpers/plateforme"
import { createSqlFixtures, spyDb, SQL_SKIP_REASON, sqlConfigured, type SqlFixtures, type SqlReferenceOrg } from "../helpers/sql"

const CONNECTORS = ["brevo", "affinity", "aircall", "allo", "amplitude"]

type Person = { db: PlatformDb; identity: Identity }

function libraryConnectors(): ConnectorDefinition[] {
  return Object.values(connectorsLibrary).flatMap((module: unknown) =>
    typeof module === "object" && module !== null && "connector" in module && CONNECTORS.includes((module.connector as ConnectorDefinition).name)
      ? [module.connector as ConnectorDefinition]
      : [],
  )
}

const suite = sqlConfigured ? "usable functions first: accounts read in one batch, find and context" : `usable functions first (${SQL_SKIP_REASON})`

describe.skipIf(!sqlConfigured)(suite, { timeout: 120_000 }, () => {
  let fx: SqlFixtures
  let o: SqlReferenceOrg
  let lea: Person
  let marc: Person

  const person = async (org: SqlReferenceOrg, user: { id: string; email: string }): Promise<Person> => {
    const db = fx.as(user)
    return { db, identity: await resolveIdentity(db, org.host, { userId: user.id, email: user.email }) }
  }
  const account = (orgId: string, connector: string, owner: { ownerKind: "org" | "team" | "user"; ownerTeamId?: string; ownerUserId?: string }) =>
    fx.createAccount(orgId, { connector, label: `${connector} ${hex(3)}`, ...owner })

  beforeAll(async () => {
    registerConnectors(libraryConnectors())
    fx = createSqlFixtures()
    o = await fx.buildReferenceOrg()
    const outside = await fx.buildReferenceOrg()
    lea = await person(o, o.people.lea)
    marc = await person(o, o.people.marc)
    const ada = await person(o, o.people.ada)
    const paul = await person(o, o.people.paul)
    // La ligne de chaque connecteur, que la déclaration pose chez un hôte (`declare_connector`) : partagée, jamais retirée.
    for (const name of [...CONNECTORS, "hubspot", "sellsy", "pipedrive", "qonto"]) {
      await fx.admin`insert into platform.connectors (name, label) values (${name}, ${name}) on conflict (name) do nothing`
    }
    // Usables par Léa : le sien, celui de Paul partagé avec elle, celui de Ventes (son équipe), celui de l'organisation.
    await account(o.org.id, "brevo", { ownerKind: "user", ownerUserId: o.people.lea.id })
    const lent = await account(o.org.id, "affinity", { ownerKind: "user", ownerUserId: o.people.paul.id })
    await setAccountRule(paul.db, paul.identity, { accountId: lent, subject: { kind: "user", id: o.people.lea.id }, level: "read" })
    await account(o.org.id, "hubspot", { ownerKind: "team", ownerTeamId: o.teams.ventes })
    await account(o.org.id, "sellsy", { ownerKind: "org" })
    // Pas pour elle, chacun pour une seule raison : personnel d'un autre non partagé, éteint, d'une équipe qui n'est pas
    // la sienne, d'une personne partie, d'une autre organisation.
    await account(o.org.id, "aircall", { ownerKind: "user", ownerUserId: o.people.paul.id })
    const off = await account(o.org.id, "allo", { ownerKind: "org" })
    await fx.admin`update platform.accounts set status = 'disabled' where id = ${off}`
    await account(o.org.id, "amplitude", { ownerKind: "team", ownerTeamId: o.teams.support })
    const yan = await fx.createUser({ fullName: "Yan Leroy" })
    await fx.addMember(o.org.id, yan.id, { profile: { name: "Yan Leroy" } })
    const gone = await account(o.org.id, "pipedrive", { ownerKind: "user", ownerUserId: yan.id })
    await fx.admin`insert into platform.access_rules (org_id, account_id, subject_org, level) values (${o.org.id}, ${gone}, true, 'read')`
    await removeMember(ada.db, ada.identity, yan.id)
    await account(outside.org.id, "qonto", { ownerKind: "org" })
    // Marc n'a que son Brevo : affinity, aircall, allo et amplitude sont à connecter pour lui (le cas du 26/11/2026).
    await account(o.org.id, "brevo", { ownerKind: "user", ownerUserId: o.people.marc.id })
  }, 180_000)

  afterAll(async () => {
    registerConnectors([])
    await fx?.cleanup()
  }, 180_000)

  it("should read the connectors whose account the person can serve: own, shared with her, of her team or of the organisation", async () => {
    expect([...(await connectorsWithUsableAccount(lea.db, lea.identity)).keys()].sort()).toEqual(["affinity", "brevo", "hubspot", "sellsy"])
    expect([...(await connectorsWithUsableAccount(marc.db, marc.identity)).keys()].sort()).toEqual(["brevo", "sellsy"])
  })

  it("should ask for access, not a connection, when the account is below the level of the function's class", async () => {
    const missing = await usablePredicate(lea.db, lea.identity, assistantFunctions(), "test")
    const first = (connector: string, fnClass: string) => assistantFunctions().find((one) => one.connector === connector && one.class === fnClass)
    // Paul lui a partagé affinity en lecture : ses lectures servent, ses écritures demandent l'accès ; son Brevo couvre tout.
    const cases = [first("affinity", "read"), first("affinity", "write"), first("brevo", "write"), first("aircall", "read")]
    expect(cases.map((one) => (one && missing ? missing(one) : "absent"))).toEqual([null, "access", null, "connect"])
  })

  it("should serve Brevo first in find and in context, and mark what is to connect with connector.connect", async () => {
    const catalog = { functions: assistantFunctions(), activeConnectors: new Set(CONNECTORS) }
    const { prefix } = o.org
    const contacts = await find(marc.db, marc.identity, { query: "liste de contacts", type: "function" }, catalog)
    expect(contacts.data).toMatchObject({ functions: [{ name: "brevo.list_contacts_of_list" }, { name: "brevo.list_contacts" }, {}, {}, {}] })
    expect(contacts.text).not.toContain("to connect")

    const calls = (await find(marc.db, marc.identity, { query: "liste les appels Aircall", type: "function" }, catalog)).text.split("\n")
    expect(calls[1]).toMatch(/^1\. aircall\.list_calls \(read, score \d\.\d\d, to connect\): /)
    expect(calls.at(-1)).toBe(
      `Marked "to connect": no account the user can use yet; offer to connect the connector with ${prefix}_call {"function": "connector.connect", "arguments": {"connector": "<connector>"}} instead of calling the function.`,
    )

    const none = Promise.resolve(new Set<string>())
    const hints = await routingHints(marc.db, marc.identity, "liste de contacts", { served: false, used: none })
    expect(hints.functions.map(({ name, missing }) => [name, missing ?? null])).toEqual([
      ["brevo.list_contacts_of_list", null],
      ["brevo.list_contacts", null],
      ["brevo_act.remove_from_list", null],
    ])
  })

  it("should still propose functions, none marked, when the accounts cannot be read, the failure logged", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const down = spyDb(marc.db, { fail: (query) => (query.target === "accounts" ? { code: "57014" } : null) }).db
    const hints = await routingHints(down, marc.identity, "liste les appels Aircall", { served: false, used: Promise.resolve(new Set<string>()) })
    expect([hints.functions[0]?.name, hints.functions.some((one) => one.missing), loggedText(error).includes("[platform] context: usable accounts read failed")]).toEqual([
      "aircall.list_calls",
      false,
      true,
    ])
    error.mockRestore()
  })
})
