// @vitest-environment node
// Le partage d'un compte personnel sur une vraie base (oto-now/oto-core#68, `droits-d-acces.md` § Partage d'un compte de
// connecteur) : partagé à toute l'organisation puis à une équipe, il ne sert à un autre que nommé, et l'appel dit à qui il
// est (texte, données, `_lent_by` au journal) ; un refus faute de compte nomme ceux partagés et leur propriétaire ; une
// fonction sensible exige le niveau sensible, au-dessus de l'écriture ; le départ du propriétaire arrête le compte pour
// les autres, lu à chaque appel, rien n'étant effacé, et son retour le rend ; le journal des partages écrit chaque règle
// posée, remplacée ou retirée (même par le départ d'une personne), que seule la personne qui gère le compte lit, et que
// la RLS borne à l'organisation. `mail` simulé : aucun réseau.
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { listUsableAccounts } from "../../packages/plateforme/server/connectors/accounts"
import type { PlatformDb } from "../../packages/plateforme/server/db"
import { PlatformError } from "../../packages/plateforme/server/errors"
import { callFunction } from "../../packages/plateforme/server/function-call"
import { resolveIdentity, type Identity } from "../../packages/plateforme/server/identity"
import { removeMember } from "../../packages/plateforme/server/members"
import { listAccountShareJournal } from "../../packages/plateforme/server/account-share-journal"
import { listAccountRules, removeAccountRule, setAccountRule } from "../../packages/plateforme/server/rules"
import { pendingMigrations, pendingReason } from "../helpers/pending-migrations"
import { hex } from "../helpers/plateforme"
import { codeOf, createSqlFixtures, SQL_SKIP_REASON, sqlConfigured, type SqlFixtures, type SqlReferenceOrg, type SqlUser } from "../helpers/sql"

const VERSION = "20261018090000"
const pending = (await pendingMigrations()).includes(VERSION)
const ORIGIN = "https://acme.test"
const DRAFT = { to: "sophie@valbrune.test", subject: "Votre rendez-vous", body: "Bonjour Sophie, …" }
const ASK_WHICH = "Show them to the user and ask which one to use; do not pick one yourself."

type Person = { db: PlatformDb; identity: Identity }

async function refusal(run: Promise<unknown>): Promise<PlatformError> {
  const error = await run.then(
    () => null,
    (reason: unknown) => reason,
  )
  if (!(error instanceof PlatformError)) throw new Error(`expected a PlatformError, got ${String(error)}`)
  return error
}

const suite = !sqlConfigured ? `account sharing (${SQL_SKIP_REASON})` : pending ? `account sharing (${pendingReason([VERSION])})` : "account sharing: personal accounts shared, owner left, share journal"

describe.skipIf(!sqlConfigured || pending)(suite, { timeout: 120_000 }, () => {
  let fx: SqlFixtures
  let o: SqlReferenceOrg
  let outside: SqlReferenceOrg
  let lea: Person
  let paul: Person
  let marc: Person
  let ada: Person
  let claire: Person
  let stranger: Person

  const person = async (org: SqlReferenceOrg, user: { id: string; email: string; name?: string | null }): Promise<Person> => {
    const db = fx.as(user)
    return { db, identity: await resolveIdentity(db, org.host, { userId: user.id, email: user.email }) }
  }
  /** Un compte personnel simulé et actif, sous un libellé propre au cas. */
  const personalAccount = async (owner: { id: string }, name: string) => {
    const label = `Mail ${name} ${hex(3)}`
    const id = await fx.createAccount(o.org.id, { ownerKind: "user", ownerUserId: owner.id, label })
    return { id, label }
  }
  const draft = (who: Person, account?: string) =>
    callFunction(who.db, who.identity, { function: "mail.create_draft", arguments: DRAFT, ...(account ? { account } : {}) }, { origin: ORIGIN })
  const lastCallLine = async () =>
    (await fx.admin<{ user_id: string; is_error: boolean; args: Record<string, unknown> }[]>`
      select user_id, is_error, args from platform.journal where org_id = ${o.org.id} and target = 'mail.create_draft' order by id desc limit 1`)[0]
  const sharedText = (label: string, owner: string) =>
    ` Personal accounts shared with you, used only when named: « ${label} » (owner ${owner}, simulated). ${ASK_WHICH} Then call again with account: "<label>".`

  beforeAll(async () => {
    fx = createSqlFixtures()
    o = await fx.buildReferenceOrg()
    outside = await fx.buildReferenceOrg()
    await fx.addActivation(o.org.id, "mail")
    lea = await person(o, o.people.lea)
    paul = await person(o, o.people.paul)
    marc = await person(o, o.people.marc)
    ada = await person(o, o.people.ada)
    claire = await person(o, o.people.claire)
    stranger = await person(outside, outside.people.ada)
  }, 180_000)

  afterAll(async () => {
    await fx?.cleanup()
  }, 180_000)

  it("should share a personal account with the whole organisation, then with a team, serving it to another only named and saying whose it is", async () => {
    const mail = await personalAccount(o.people.lea, "Léa")
    // Le sien sert sans être nommé, avant les comptes de ses équipes et de l'organisation.
    const own = await draft(lea)
    expect([own.account?.label, own.account?.owner]).toEqual([mail.label, { kind: "user", userId: o.people.lea.id, name: "Léa Roux", yours: true }])
    expect((await lastCallLine()).args._lent_by).toBeUndefined()

    await setAccountRule(lea.db, lea.identity, { accountId: mail.id, subject: { kind: "org" }, level: "write" })
    const unnamed = await refusal(draft(marc))
    expect(unnamed.code).toBe("not_enabled")
    expect(unnamed.message).toBe(
      `No mail account is connected for you (your own, then the organisation). Ask an administrator of ${o.org.name} (Ada Martin) to connect one on the dashboard: ${ORIGIN}/admin/connectors.` +
        sharedText(mail.label, "Léa Roux"),
    )
    expect(unnamed.details).toEqual({ shared_accounts: [{ id: mail.id, label: mail.label, owner: "Léa Roux" }] })

    const lent = await draft(marc, mail.label)
    expect(lent.account?.owner).toEqual({ kind: "user", userId: o.people.lea.id, name: "Léa Roux", yours: false })
    expect(lent.text.split("\n").slice(-2)).toEqual([`No team · account « ${mail.label} » (simulated).`, `Account « ${mail.label} » belongs to Léa Roux, who shared it with you.`])
    expect(await lastCallLine()).toMatchObject({ user_id: o.people.marc.id, is_error: false, args: { _lent_by: o.people.lea.id } })

    // Remplacé par un partage à Support : Paul le garde, Marc ne le voit plus.
    await setAccountRule(lea.db, lea.identity, { accountId: mail.id, subject: { kind: "team", id: o.teams.support }, level: "write" })
    const general = (await listAccountRules(lea.db, lea.identity, mail.id)).general
    if (!general) throw new Error("the organisation rule should be listed apart")
    expect(general.level).toBe("write")
    await removeAccountRule(lea.db, lea.identity, general.id)
    expect((await draft(paul, mail.label)).account?.label).toBe(mail.label)
    expect((await refusal(draft(marc, mail.label))).code).toBe("not_found")
  })

  it("should refuse a sensitive function on an account shared in write, then ask for approval once shared up to sensitive", async () => {
    const mail = await personalAccount(o.people.lea, "Léa sensible")
    await setAccountRule(lea.db, lea.identity, { accountId: mail.id, subject: { kind: "user", id: o.people.paul.id }, level: "write" })
    const created = await draft(paul, mail.label)
    if (created.status !== "done") throw new Error(created.status)
    const send = (confirm?: true) =>
      callFunction(paul.db, paul.identity, { function: "mail.send_draft", arguments: { id: created.result.draft_id }, account: mail.label, ...(confirm ? { confirm } : {}) }, { origin: ORIGIN })
    const refused = await refusal(send(true))
    expect(refused.code).toBe("forbidden")
    expect(refused.message.startsWith(`Account « ${mail.label} » cannot run mail.send_draft for you (sensitive access needed). `)).toBe(true)

    await setAccountRule(lea.db, lea.identity, { accountId: mail.id, subject: { kind: "user", id: o.people.paul.id }, level: "sensitive" })
    const asked = await send()
    expect(asked.status).toBe("needs_confirmation")
    expect(asked.text).toContain(`Account « ${mail.label} » belongs to Léa Roux, who shared it with you.`)
  })

  it("should stop serving the account of a person who left, at once and by name, deleting nothing, and serve it again when she is back", async () => {
    const zoe: SqlUser = await fx.createUser({ fullName: "Zoé Faure" })
    await fx.addMember(o.org.id, zoe.id, { profile: { name: "Zoé Faure" } })
    const her = await person(o, zoe)
    const mail = await personalAccount(zoe, "Zoé")
    await setAccountRule(her.db, her.identity, { accountId: mail.id, subject: { kind: "team", id: o.teams.support }, level: "write" })
    expect((await draft(paul, mail.label)).account?.label).toBe(mail.label)

    await removeMember(ada.db, ada.identity, zoe.id)
    const gone = await refusal(draft(paul, mail.label))
    expect([gone.code, gone.message]).toEqual(["not_enabled", `Account « ${mail.label} » no longer serves: its owner has left ${o.org.name}. Name another account.`])
    // Ni proposé, ni mentionné dans un refus faute de compte : rien ne sert plus.
    expect((await listUsableAccounts(paul.db, paul.identity, { connector: "mail" })).map((account) => account.id)).not.toContain(mail.id)
    // Rien n'est effacé : le compte, son secret éventuel et ses partages restent.
    const kept = await fx.admin<{ status: string; rules: number }[]>`
      select a.status, (select count(*)::int from platform.access_rules r where r.account_id = a.id) as rules from platform.accounts a where a.id = ${mail.id}`
    expect(kept).toEqual([{ status: "active", rules: 1 }])

    await fx.addMember(o.org.id, zoe.id, { profile: { name: "Zoé Faure" } })
    expect((await draft(paul, mail.label)).account?.owner).toEqual({ kind: "user", userId: zoe.id, name: "Zoé Faure", yours: false })
  })

  it("should journal every share set, replaced or removed, with who, to whom and when, readable by the owner only", async () => {
    const mail = await personalAccount(o.people.lea, "Léa journal")
    const yan = await fx.createUser({ fullName: "Yan Leroy" })
    await fx.addMember(o.org.id, yan.id, { profile: { name: "Yan Leroy" } })
    await setAccountRule(lea.db, lea.identity, { accountId: mail.id, subject: { kind: "org" }, level: "read" })
    await setAccountRule(lea.db, lea.identity, { accountId: mail.id, subject: { kind: "team", id: o.teams.support }, level: "read" })
    await setAccountRule(lea.db, lea.identity, { accountId: mail.id, subject: { kind: "team", id: o.teams.support }, level: "sensitive" })
    // Un niveau inchangé n'écrit rien.
    await setAccountRule(lea.db, lea.identity, { accountId: mail.id, subject: { kind: "team", id: o.teams.support }, level: "sensitive" })
    await setAccountRule(lea.db, lea.identity, { accountId: mail.id, subject: { kind: "user", id: yan.id }, level: "write" })
    // Le départ de Yan retire la règle qui le nomme (`members_cleanup`), sous la session d'Ada.
    await removeMember(ada.db, ada.identity, yan.id)

    const { label, events } = await listAccountShareJournal(lea.db, lea.identity, mail.id)
    expect(label).toBe(mail.label)
    const lea_ = { name: "Léa Roux" }
    expect(events.map(({ at, ...event }) => (expect(Date.parse(at)).not.toBeNaN(), event))).toEqual([
      { action: "removed", subject: { kind: "user", name: null }, level: "write", previous: null, by: { name: "Ada Martin" } },
      { action: "set", subject: { kind: "user", name: null }, level: "write", previous: null, by: lea_ },
      { action: "set", subject: { kind: "team", name: "Support" }, level: "sensitive", previous: "read", by: lea_ },
      { action: "set", subject: { kind: "team", name: "Support" }, level: "read", previous: null, by: lea_ },
      { action: "set", subject: { kind: "org", name: o.org.name }, level: "read", previous: null, by: lea_ },
    ])

    // Seule la personne qui gère le compte le lit : ni celles qui s'en servent (l'administratrice comprise), ni une autre
    // organisation, à qui il reste inconnu.
    for (const other of [claire, paul, ada]) {
      expect((await refusal(listAccountShareJournal(other.db, other.identity, mail.id))).code).toBe("forbidden")
    }
    expect((await refusal(listAccountShareJournal(stranger.db, stranger.identity, mail.id))).code).toBe("not_found")
    const seen = await stranger.db.tx((sql) => sql<{ n: number }[]>`select count(*)::int as n from platform.account_share_events where account_id = ${mail.id}`)
    expect(seen).toEqual([{ n: 0 }])
    // Aucune session ne l'écrit : le déclencheur seul.
    const forged = lea.db.tx(
      (sql) => sql`insert into platform.account_share_events (org_id, account_id, action, subject_kind, level) values (${o.org.id}, ${mail.id}, 'set', 'org', 'manage')`,
    )
    expect(await codeOf(forged)).toBe("42501")

    // `forget_user` efface la personne du journal, l'événement reste.
    await fx.admin`select platform.forget_user(${yan.id})`
    const scrubbed = await fx.admin<{ subject_id: string | null }[]>`
      select subject_id from platform.account_share_events where account_id = ${mail.id} and subject_kind = 'user'`
    expect(scrubbed).toEqual([{ subject_id: null }, { subject_id: null }])
  })
})
