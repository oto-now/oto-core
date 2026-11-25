// La connexion menée par l'agent (`connexion-par-l-agent.md`), sur une vraie base, avec un connecteur réel à clé
// déclaré : `connector.connect` rend l'adresse stable de chaque personne, à l'espace qu'elle peut doter (l'organisation
// pour qui l'administre, l'équipe qu'on dirige, sinon soi) et refuse nommément un espace qu'elle ne peut pas ; la page
// (`connectionStep`) ouvre la saisie du compte, l'espace posé ; un connecteur fermé par un administrateur donne à
// l'administrateur l'adresse qui active (la page demande sa confirmation, jamais à l'ouverture) et à un membre celle à
// transmettre, les administrateurs nommés. Un compte existant sans clé mène à la saisie de la sienne (`account_id=<id>`),
// pour qui le gère seul, l'adresse revérifiée contre le compte. Aucune adresse ne porte de secret. Le consentement OAuth
// et le branchement hébergé se testent avec leurs parcours (`consentement-oauth.test.ts`, `comptes-rattaches.test.ts`) ;
// la clé refusée par le tiers, avec la marque (`etat-des-comptes.test.ts`).
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { runCall, type CallInput } from "../../packages/plateforme/server/calls"
import { activateConnector, deactivateConnector, loadActiveConnectors } from "../../packages/plateforme/server/connectors/activations"
import { connectionStep } from "../../packages/plateforme/server/connectors/connect-page"
import { registerConnectors } from "../../packages/plateforme/server/connectors/declaration"
import type { PlatformDb } from "../../packages/plateforme/server/db"
import { PlatformError } from "../../packages/plateforme/server/errors"
import { resolveIdentity, type Identity } from "../../packages/plateforme/server/identity"
import { describedConnector } from "../factories/described-connector"
import { hex, REFERENCE_PEOPLE, type ReferencePerson } from "../helpers/plateforme"
import { createSqlFixtures, SQL_SKIP_REASON, sqlConfigured, testAdminSql, type SqlFixtures, type SqlReferenceOrg } from "../helpers/sql"

const LIVE = `t${hex(4)}`
const ORIGIN = "https://acme.example.test"
const SETUP_TIMEOUT = 180_000

type Session = { db: PlatformDb; identity: Identity }

async function refusal(run: Promise<unknown>): Promise<PlatformError> {
  const error = await run.then(
    () => null,
    (reason: unknown) => reason,
  )
  if (!(error instanceof PlatformError)) throw new Error(`expected a PlatformError, got ${String(error)}`)
  return error
}

const suite = sqlConfigured ? "connection led by the agent, on a real database" : `connection led by the agent (${SQL_SKIP_REASON})`

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
    return runCall({ db, identity, ctxCode: null, origin: ORIGIN, activeConnectors: () => loadActiveConnectors(db, o.org.id) }, input)
  }
  const connect = (who: ReferencePerson, args: Record<string, unknown>) => call(who, { function: "connector.connect", arguments: { connector: LIVE, ...args } })
  const step = (who: ReferencePerson, query: Record<string, string>) => connectionStep(as(who).db, as(who).identity, { connector: LIVE, ...query }, { origin: ORIGIN })

  beforeAll(async () => {
    registerConnectors([describedConnector(LIVE)])
    fx = createSqlFixtures()
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
    await fx?.cleanup()
    const admin = testAdminSql()
    try {
      await admin`delete from platform.connectors where name = ${LIVE}`
    } finally {
      await admin.end({ timeout: 5 })
    }
  }, SETUP_TIMEOUT)

  it("should give each person the stable link of the space they can connect, with the gesture, and no secret in it", async () => {
    const link = (space: string) => `${ORIGIN}/connect/${LIVE}?space=${encodeURIComponent(space)}`
    // Ada administre : l'organisation ; Claire dirige Ventes : son équipe ; Léa, membre : son compte personnel.
    for (const [who, space] of [["ada", "org"], ["claire", "team:ventes"], ["lea", "me"]] as const) {
      const result = await connect(who, {})
      expect(result.data.result).toEqual({ url: link(space), gesture: "key", connector: LIVE, space, by: "user" })
      expect(result.text).toContain(`Ask the user to paste the Crm key, then call again: open ${link(space)}`)
      expect([...new URL(link(space)).searchParams.keys()]).toEqual(["space"])
    }
    expect((await connect("lea", { space: "me" })).data.result).toMatchObject({ url: link("me") })
  })

  it("should refuse by name a space the person cannot connect, an unknown team, and never take the space of the link on trust", async () => {
    const org = await refusal(connect("lea", { space: "org" }))
    expect([org.code, org.message, org.details]).toEqual([
      "forbidden",
      `You cannot connect Crm in org: only an administrator connects an account of the organisation.`,
      { reason: "space", space: "org" },
    ])
    expect((await refusal(connect("claire", { space: "team:support" }))).message).toBe("You cannot connect Crm in team:support: only an administrator or a lead of team Support connects its accounts.")
    expect((await refusal(connect("claire", { space: "team:inconnue" }))).code).toBe("not_found")
    // La page revérifie de même, à l'affichage : l'adresse ne dote personne d'un droit.
    expect((await refusal(step("lea", { space: "org" }))).code).toBe("forbidden")
    expect((await refusal(step("claire", { space: "team:support" }))).code).toBe("forbidden")
  })

  it("should open the key form on the page, its space and team set, the key never in the link", async () => {
    const shown = await step("claire", { space: "team:ventes" })
    expect(shown).toMatchObject({ kind: "key", connector: LIVE, label: "Crm", space: "team:ventes", owner: "team", team: { name: "Ventes" }, mode: "reel" })
    expect(shown.kind === "key" ? shown.form?.fields : null).toEqual([{ name: "api_key", label: "API key", secret: true }])
    expect(await step("lea", { space: "me" })).toMatchObject({ kind: "key", owner: "user" })
  })

  it("should say an account already works in the space (gesture none), in the shape of a call's account, and give no link", async () => {
    const label = `Crm ${hex(3)}`
    const id = await fx.createAccount(o.org.id, { connector: LIVE, ownerKind: "org", label, mode: "simule" })
    try {
      const result = await connect("ada", {})
      expect(result.data.result).toEqual({ gesture: "none", connector: LIVE, space: "org", account: { id, label, mode: "simule", owner: { kind: "org", description: expect.any(String) } } })
      expect(result.text).toBe(`Crm is already connected (org): account « ${label} ». Call its functions; name the account if several serve.`)
      // Ailleurs, l'espace n'en a pas : l'adresse.
      expect((await connect("lea", {})).data.result).toMatchObject({ gesture: "key", space: "me" })
    } finally {
      await fx.admin`delete from platform.accounts where id = ${id}`
    }
  })

  it("should name the person of a personal account that already works, never their identifier", async () => {
    const label = `Crm ${hex(3)}`
    const id = await fx.createAccount(o.org.id, { connector: LIVE, ownerKind: "user", ownerUserId: o.people.lea.id, label, mode: "simule" })
    try {
      const result = await connect("lea", {})
      expect(result.data.result).toEqual({ gesture: "none", connector: LIVE, space: "me", account: { id, label, mode: "simule", owner: { kind: "user", name: "Léa Roux", yours: true } } })
      expect(JSON.stringify(result.data.result)).not.toContain(o.people.lea.id)
    } finally {
      await fx.admin`delete from platform.accounts where id = ${id}`
    }
  })

  it("should lead a team account without key to the entry of its own key, for its lead, the page checking the link against the account", async () => {
    const label = `Crm ${hex(3)}`
    const id = await fx.createAccount(o.org.id, { connector: LIVE, ownerKind: "team", ownerTeamId: o.teams.ventes, label, mode: "reel" })
    try {
      const url = `${ORIGIN}/connect/${LIVE}?space=team%3Aventes&account_id=${id}`
      const byClaire = await refusal(call("claire", { function: `${LIVE}.list_contacts`, team: "ventes", account: label }))
      expect({ code: byClaire.code, message: byClaire.message, details: byClaire.details }).toEqual({
        code: "not_enabled",
        message: `Account « ${label} » has no secret yet. Ask the user to paste the Crm key of account « ${label} », then call again: open ${url}`,
        details: { reason: "no_account", gesture: "key", connector: LIVE, space: "team:ventes", url },
      })
      expect(url).not.toMatch(/key=|secret|state=|code=/)

      const shown = await step("claire", { space: "team:ventes", account_id: id })
      expect(shown).toMatchObject({ kind: "account_key", connector: LIVE, label: "Crm", space: "team:ventes", account: { id, label, owner: { kind: "team" } } })
      expect(shown.kind === "account_key" ? shown.form.fields : null).toEqual([{ name: "api_key", label: "API key", secret: true }])
      // Sans espace, celui du compte ; un autre espace, un autre connecteur, `activate` : refusés nommément.
      expect(await step("claire", { account_id: id })).toMatchObject({ kind: "account_key", space: "team:ventes" })
      const elsewhere = await refusal(step("claire", { space: "me", account_id: id }))
      expect([elsewhere.code, elsewhere.message]).toEqual(["invalid_arguments", `Account « ${label} » is in team:ventes, not in me.`])
      expect((await refusal(step("claire", { space: "team:ventes", account_id: id, activate: "1" }))).code).toBe("invalid_arguments")
      const other = await refusal(connectionStep(as("claire").db, as("claire").identity, { connector: "autre", account_id: id }, { origin: ORIGIN }))
      expect(other.code).toBe("invalid_arguments")
      // Léa ne gère pas le compte : la page le lui refuse, en disant qui le gère.
      const byLea = await refusal(step("lea", { account_id: id }))
      expect([byLea.code, byLea.message]).toEqual(["forbidden", `Setting the key of « ${label} » is reserved to those who manage it: team Ventes (lead: Claire Morel).`])
    } finally {
      await fx.admin`delete from platform.accounts where id = ${id}`
    }
  })

  it("should answer not_found on the page and its account_key step for an account of another organisation or one that does not exist, even to an administrator", async () => {
    const elsewhere = await fx.createOrg()
    const label = `Crm ${hex(3)}`
    const id = await fx.createAccount(elsewhere.id, { connector: LIVE, ownerKind: "org", label, mode: "reel" })
    try {
      const cases = (["ada", "claire", "lea"] as const).flatMap((who) =>
        [id, "00000000-0000-4000-8000-000000000000"].flatMap((account) =>
          ([{}, { space: "org" }, { space: "me" }] as Record<string, string>[]).map((space): [ReferencePerson, Record<string, string>] => [who, { ...space, account_id: account }]),
        ),
      )
      for (const [who, query] of cases) {
        const error = await refusal(step(who, query))
        expect([who, error.code], JSON.stringify(query)).toEqual([who, "not_found"])
        // Le refus ne dit rien du compte d'une autre organisation : ni son libellé, ni son organisation.
        expect(error.message).not.toContain(label)
        expect(error.message).not.toContain(elsewhere.name)
      }
    } finally {
      await fx.admin`delete from platform.accounts where id = ${id}`
    }
  })

  it("should give the link of a team account without key to its lead when a member, Léa, calls with it", async () => {
    const label = `Crm ${hex(3)}`
    const id = await fx.createAccount(o.org.id, { connector: LIVE, ownerKind: "team", ownerTeamId: o.teams.ventes, label, mode: "reel" })
    try {
      const error = await refusal(call("lea", { function: `${LIVE}.list_contacts`, team: "ventes", account: label }))
      const url = `${ORIGIN}/connect/${LIVE}?space=team%3Aventes&account_id=${id}`
      expect(error.code).toBe("not_enabled")
      expect(error.message).toBe(`Account « ${label} » has no secret yet. Only team Ventes (lead: Claire Morel) can set the key of account « ${label} »; ask the user to pass them the link and call again once it is done: open ${url}`)
      expect(error.details).toEqual({ reason: "no_account", gesture: "key", connector: LIVE, space: "team:ventes", url })
    } finally {
      await fx.admin`delete from platform.accounts where id = ${id}`
    }
  })

  it("should give a connector an administrator closed: the activation link to an administrator, confirmed on the page and never at its opening, and the link to pass on otherwise", async () => {
    const ada = as("ada")
    await deactivateConnector(ada.db, ada.identity, { connector: LIVE })
    try {
      const forAda = `${ORIGIN}/connect/${LIVE}?space=org&activate=1`
      const byAda = await refusal(call("ada", { function: `${LIVE}.list_contacts` }))
      expect(byAda.details).toEqual({ reason: "connector_off", gesture: "admin_activation", connector: LIVE, space: "org", url: forAda })
      expect(byAda.message).toContain(`Ask the user to confirm the activation of Crm and connect an account, then call again: open ${forAda}`)

      const forAdmins = `${ORIGIN}/connect/${LIVE}?space=me&activate=1`
      const byLea = await refusal(call("lea", { function: `${LIVE}.list_contacts` }))
      expect(byLea.details).toEqual({
        reason: "connector_off",
        gesture: "admin_activation",
        connector: LIVE,
        space: "me",
        url: forAdmins,
        administrators: [{ name: "Ada Martin" }],
      })
      expect(byLea.message).toContain(`Only an administrator of ${o.org.name} (Ada Martin) can do it; ask the user to pass them the link and call again once it is done: open ${forAdmins}`)
      expect((await connect("lea", {})).data.result).toMatchObject({ gesture: "admin_activation", by: "administrator", url: forAdmins })

      // La page : la confirmation pour Ada, sans rien activer ; l'adresse et les administrateurs pour Léa.
      expect(await step("ada", { space: "org", activate: "1" })).toEqual({ kind: "activate", connector: LIVE, label: "Crm", space: "org" })
      expect((await loadActiveConnectors(ada.db, o.org.id)).has(LIVE)).toBe(false)
      expect(await step("lea", { space: "me", activate: "1" })).toEqual({
        kind: "ask_admin",
        connector: LIVE,
        label: "Crm",
        space: "me",
        url: forAdmins,
        administrators: [{ name: "Ada Martin" }],
      })
      // Ada confirme (le bouton de la page, `POST admin/connectors/<nom>/activation`) : la page enchaîne sur la saisie.
      await activateConnector(ada.db, ada.identity, { connector: LIVE })
      expect(await step("ada", { space: "org", activate: "1" })).toMatchObject({ kind: "key", owner: "org" })
    } finally {
      await activateConnector(ada.db, ada.identity, { connector: LIVE })
    }
  })
})
