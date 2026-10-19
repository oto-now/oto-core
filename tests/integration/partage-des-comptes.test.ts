// @vitest-environment node
// Le partage d'un compte personnel sur une vraie base (oto-now/oto-core#68, `droits-d-acces.md` § Partage d'un compte de
// connecteur) : partagé à toute l'organisation puis à une équipe, il ne sert à un autre que nommé, et l'appel dit à qui il
// est (texte, données, `_lent_by` au journal) ; un refus faute de compte nomme ceux partagés et leur propriétaire ; une
// fonction sensible exige le niveau sensible, au-dessus de l'écriture ; le départ du propriétaire arrête le compte pour
// les autres, lu à chaque appel, rien n'étant effacé, et son retour le rend ; le journal des partages écrit chaque règle
// posée, remplacée ou retirée (même par le départ d'une personne), que seule la personne qui gère le compte lit, et que
// la RLS borne à l'organisation ; l'écran Connecteurs ouvert aux membres lit les comptes personnels de qui regarde
// (`listOwnAccounts`) ; le propriétaire d'un compte personnel le gère avant toute règle (décidé le 19/10), et
// l'administrateur n'y pose rien (question ouverte, comportement d'avant). `mail` simulé : aucun réseau.
import { readFileSync } from "node:fs"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { accountLevel } from "../../packages/plateforme/server/access"
import { listOwnAccounts, listUsableAccounts } from "../../packages/plateforme/server/connectors/accounts"
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
/** L'instruction de la migration qui passe les règles de compte `write` d'hier à `sensitive`, lue dans le fichier. */
const WRITE_TO_SENSITIVE = (() => {
  const migration = readFileSync(new URL(`../../packages/plateforme/migrations/${VERSION}_platform_partage_des_comptes.sql`, import.meta.url), "utf8")
  const statement = migration.split("\n").find((line) => line.startsWith("UPDATE platform.access_rules SET level = 'sensitive'"))
  if (!statement) throw new Error("the migration no longer moves account rules from write to sensitive")
  return statement.replace(/;\s*$/, "")
})()

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

  // Rien de ce qu'un compte permettait hier ne se perd, rien ne s'ouvre de plus : l'ancien niveau 2 (`write`) couvrait
  // l'écriture et le sensible, jamais la gestion.
  it("should let a write rule of yesterday, once migrated, open write and sensitive functions as before, and nothing more", async () => {
    const mail = await personalAccount(o.people.lea, "Léa hier")
    // La règle telle qu'elle était en base avant ce lot, puis l'instruction même de la migration, bornée à elle.
    const [rule] = await fx.admin<{ id: string }[]>`
      insert into platform.access_rules (org_id, account_id, subject_user_id, level, created_by)
      values (${o.org.id}, ${mail.id}, ${o.people.paul.id}, 'write', ${o.people.lea.id}) returning id`
    await fx.admin.unsafe(`${WRITE_TO_SENSITIVE} AND id = $1`, [rule.id])
    expect(await fx.admin`select level from platform.access_rules where id = ${rule.id}`).toEqual([{ level: "sensitive" }])

    const created = await draft(paul, mail.label)
    if (created.status !== "done") throw new Error(created.status)
    const asked = await callFunction(paul.db, paul.identity, { function: "mail.send_draft", arguments: { id: created.result.draft_id }, account: mail.label }, { origin: ORIGIN })
    expect(asked.status).toBe("needs_confirmation")
    // Ni la gestion du compte, ni la pose d'une règle, ni la lecture du journal des partages.
    expect(await accountLevel(paul.db, paul.identity, mail.id)).toBe(3)
    expect((await refusal(setAccountRule(paul.db, paul.identity, { accountId: mail.id, subject: { kind: "user", id: o.people.marc.id }, level: "read" }))).code).toBe("forbidden")
    expect((await refusal(listAccountShareJournal(paul.db, paul.identity, mail.id))).code).toBe("forbidden")

    // Une règle `write` posée après ce lot ouvre l'écriture, pas le sensible.
    await setAccountRule(lea.db, lea.identity, { accountId: mail.id, subject: { kind: "user", id: o.people.marc.id }, level: "write" })
    const marcs = await draft(marc, mail.label)
    if (marcs.status !== "done") throw new Error(marcs.status)
    const refused = await refusal(
      callFunction(marc.db, marc.identity, { function: "mail.send_draft", arguments: { id: marcs.result.draft_id }, account: mail.label }, { origin: ORIGIN }),
    )
    expect(refused.code).toBe("forbidden")
  })

  it("should keep the default of a team account up to its sensitive functions for a member, as write covered them", async () => {
    const label = `Mail Ventes ${hex(3)}`
    await fx.createAccount(o.org.id, { ownerKind: "team", ownerTeamId: o.teams.ventes, label })
    const created = await draft(lea, label)
    if (created.status !== "done") throw new Error(created.status)
    const asked = await callFunction(lea.db, lea.identity, { function: "mail.send_draft", arguments: { id: created.result.draft_id }, account: label }, { origin: ORIGIN })
    expect(asked.status).toBe("needs_confirmation")
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

  // Décidé le 19/10 (#68) : la personne d'un compte personnel le gère avant toute règle, même posée hors des services
  // (outillage, SQL) et la nommant, ou nommant une de ses équipes, ou toute l'organisation.
  it("should keep the owner of a personal account at manage whatever rule names her, her team or the organisation", async () => {
    const mail = await personalAccount(o.people.lea, "Léa gestion")
    await fx.admin`
      insert into platform.access_rules (org_id, account_id, subject_user_id, subject_team_id, subject_org, level, created_by)
      values (${o.org.id}, ${mail.id}, ${o.people.lea.id}, null, false, 'none', ${o.people.ada.id}),
             (${o.org.id}, ${mail.id}, null, ${o.teams.ventes}, false, 'read', ${o.people.ada.id}),
             (${o.org.id}, ${mail.id}, null, null, true, 'read', ${o.people.ada.id})`
    expect(await accountLevel(lea.db, lea.identity, mail.id)).toBe(4)
    const created = await draft(lea, mail.label)
    if (created.status !== "done") throw new Error(created.status)
    const asked = await callFunction(lea.db, lea.identity, { function: "mail.send_draft", arguments: { id: created.result.draft_id }, account: mail.label }, { origin: ORIGIN })
    expect(asked.status).toBe("needs_confirmation")
    await setAccountRule(lea.db, lea.identity, { accountId: mail.id, subject: { kind: "user", id: o.people.paul.id }, level: "read" })
    expect((await listAccountShareJournal(lea.db, lea.identity, mail.id)).label).toBe(mail.label)
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

  // L'écran Connecteurs ouvert aux membres : ses seuls comptes personnels, ni ceux de l'organisation ou de ses équipes, ni
  // celui d'un autre partagé avec lui, ni celui qu'une règle lui fermerait.
  it("should list the own personal accounts of the caller only, for the screen opened to members", async () => {
    const mine = await personalAccount(o.people.paul, "Paul à moi")
    const hers = await personalAccount(o.people.lea, "Léa à Paul")
    await setAccountRule(lea.db, lea.identity, { accountId: hers.id, subject: { kind: "user", id: o.people.paul.id }, level: "write" })
    await fx.createAccount(o.org.id, { ownerKind: "org", label: `Mail org ${hex(3)}` })
    await fx.createAccount(o.org.id, { ownerKind: "team", ownerTeamId: o.teams.support, label: `Mail Support ${hex(3)}` })

    const own = await listOwnAccounts(paul.db, paul.identity)
    expect(own.map((account) => [account.label, account.owner.kind, account.viewerLevel])).toEqual([[mine.label, "user", "manage"]])
    expect((await listOwnAccounts(stranger.db, stranger.identity)).map((account) => account.id)).not.toContain(mine.id)
  })

  // Décidé le 19/10 (#68), l'exemple de la décision : Léa partage son compte personnel en lecture à Ventes, dont
  // elle est membre ; la règle sert les autres membres de Ventes, et Léa garde la gestion : elle partage encore, lit le
  // journal et retire le partage. Avant, la règle de son équipe comptait pour elle et lui retirait la gestion.
  it("should let the owner share her personal account in read to her own team and keep managing it", async () => {
    const mail = await personalAccount(o.people.lea, "Léa à Ventes")
    const shared = await setAccountRule(lea.db, lea.identity, { accountId: mail.id, subject: { kind: "team", id: o.teams.ventes }, level: "read" })

    expect(await accountLevel(lea.db, lea.identity, mail.id)).toBe(4)
    expect(await accountLevel(claire.db, claire.identity, mail.id)).toBe(1)
    expect((await listOwnAccounts(lea.db, lea.identity)).find((account) => account.id === mail.id)?.viewerLevel).toBe("manage")
    const again = await setAccountRule(lea.db, lea.identity, { accountId: mail.id, subject: { kind: "org" }, level: "read" })
    expect(again.data.created).toBe(true)
    expect((await listAccountRules(lea.db, lea.identity, mail.id)).rules.map((rule) => [rule.subject.kind, rule.level])).toEqual([["team", "read"]])
    await removeAccountRule(lea.db, lea.identity, shared.data.id)
    expect(await accountLevel(claire.db, claire.identity, mail.id)).toBe(1)
    const { events } = await listAccountShareJournal(lea.db, lea.identity, mail.id)
    expect(events.map((event) => [event.action, event.subject.kind, event.level])).toEqual([
      ["removed", "team", "read"],
      ["set", "org", "read"],
      ["set", "team", "read"],
    ])
  })

  // Décidé le 19/10 : pas d'écriture sans effet. Une règle qui nommerait la personne de son propre compte personnel ne
  // changerait rien (elle le gère avant toute règle) : refusée, sans règle ni ligne au journal des partages.
  it("should refuse the owner a rule naming herself on her personal account, writing neither the rule nor a journal line", async () => {
    const mail = await personalAccount(o.people.lea, "Léa à elle")
    for (const level of ["read", "sensitive"] as const) {
      const refused = await refusal(setAccountRule(lea.db, lea.identity, { accountId: mail.id, subject: { kind: "user", id: o.people.lea.id }, level }))
      expect([refused.code, refused.details]).toEqual(["invalid_arguments", { reason: "owner_subject" }])
      expect(refused.message).toBe(
        `A rule naming the owner of the personal account « ${mail.label} » would change nothing: its owner manages it whatever the rules. Share it with a team, another person or the whole organisation.`,
      )
    }
    const written = await fx.admin<{ rules: number; events: number }[]>`
      select (select count(*)::int from platform.access_rules where account_id = ${mail.id}) as rules,
             (select count(*)::int from platform.account_share_events where account_id = ${mail.id}) as events`
    expect(written).toEqual([{ rules: 0, events: 0 }])
  })

  // Question ouverte : un administrateur peut-il restreindre le compte personnel d'un membre ? Comportement d'avant,
  // gardé : il ne le gère pas, ne le voit pas sans partage (`not_found`), et partagé en lecture n'y pose rien (`forbidden`).
  it("should keep the behaviour of before: an administrator sets no rule on the personal account of a member", async () => {
    const mail = await personalAccount(o.people.lea, "Léa admin")
    const restrict = { accountId: mail.id, subject: { kind: "user" as const, id: o.people.lea.id }, level: "read" as const }
    expect((await refusal(setAccountRule(ada.db, ada.identity, restrict))).code).toBe("not_found")

    await setAccountRule(lea.db, lea.identity, { accountId: mail.id, subject: { kind: "org" }, level: "read" })
    expect((await refusal(setAccountRule(ada.db, ada.identity, restrict))).code).toBe("forbidden")
    expect(await accountLevel(lea.db, lea.identity, mail.id)).toBe(4)
  })
})

