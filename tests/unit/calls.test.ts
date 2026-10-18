// @vitest-environment node
// `call` (E03-S04, AC1 à AC14) : `runCall` sur une base réelle (E01-S10, lot t1-d1), O de la fixture de
// référence : le vrai `mail` simulé, la vraie résolution de l'équipe et du compte (E04-S01), les vrais
// niveaux (`access.ts`), et des fonctions de test pour les classes et origines que la V1 n'a pas encore.
// L'isolation seule rend aussi ce que la personne ne voit pas (comptes d'autres équipes et d'autres
// personnes) : les services filtrent et refusent avant d'écrire (`security-patterns.md § Droits dans le
// service`), ce que prouve l'espion des deux faces (`recordDb`, AC-x3). Les refus sont servis au modèle :
// ils se comparent mot pour mot (H04). AC15 à AC17 passent par la porte (`mcp-call.test.ts`).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { runCall, type CallInput } from "../../packages/plateforme/server/calls"
import type { CatalogFunction } from "../../packages/plateforme/server/catalog/define"
import { catalogFunctions } from "../../packages/plateforme/server/catalog/registry"
import { loadActiveConnectors } from "../../packages/plateforme/server/connectors/activations"
import type { Identity } from "../../packages/plateforme/server/identity"
import { TEST_FUNCTIONS, testSend } from "../factories/test-functions"
import { ACCOUNTS, CONTENT_AT, nodeId, ORG, PEOPLE, referenceTables, teamOf, TEAMS, type Person, type RuleSpec } from "../helpers/reference-org"
import { keysOf, seedReferenceTables, type ReferenceOrgSql } from "../helpers/reference-org-sql"
import type { Row, Tables } from "../helpers/simulated-db"
import { namesOf, sqlConfigured, recordPeople, seedWithAdmin, type SeededData, portable } from "../helpers/sql"

const ORIGIN = "https://acme.test"
const CTX = "7K3Q-M2XA"
const DRAFT = { to: "sophie@valbrune.test", subject: "Votre rendez-vous", body: "Bonjour Sophie, …" }
const DRAFT_ID = "sim_1a2b3c4d"
const MAIL_SUPPORT = { id: "account:mail-support", label: "Mail Support" }
const FUNCTIONS = [...catalogFunctions(), ...TEST_FUNCTIONS]

let seed: SeededData
let ref: ReferenceOrgSql

afterEach(() => {
  vi.restoreAllMocks()
})

/** Claire (Ventes, responsable) aussi membre de Support. */
function claireInBoth(): Identity {
  return ref.identityOf("claire", { teams: [teamOf("ventes", "claire"), teamOf("support", "claire")] })
}

/** Léa, membre de Ventes et de Support (AC6). */
function leaInBoth(): Identity {
  return ref.identityOf("lea", { teams: [teamOf("ventes", "lea"), teamOf("support", "lea")] })
}

function node(path: string, kind: string): Row {
  return { id: nodeId(path), org_id: ORG.id, path, kind, owner_kind: null, owner_team_id: null, owner_user_id: null }
}

function account(id: string, label: string, team: keyof typeof TEAMS): Row {
  return { id, org_id: ORG.id, connector: "mail", label, owner_kind: "team", owner_team_id: TEAMS[team].id, owner_user_id: null }
}

/** Le brouillon de « Mail Ventes » de chaque cas ; son identifiant est tiré sur la base (`ref.id(DRAFT_ID)`). */
function seededDraft(): Row {
  const row = { id: DRAFT_ID, org_id: ORG.id, account_id: ACCOUNTS.ventes.id, connector: "mail", function: "mail.create_draft", payload: DRAFT }
  return { ...row, status: "draft", sent_at: null, created_at: CONTENT_AT }
}

/**
 * L'état de départ d'un compte : « Mail Claire » désactivé, sinon le compte personnel de Claire servirait ses appels
 * avant ceux de ses équipes (partage des comptes, #68) ; les cas de l'ordre des équipes le laissent ainsi, ceux des
 * comptes personnels l'activent.
 */
const statusAtStart = (id: string) => (id === ACCOUNTS.claire.id ? "disabled" : "active")

/**
 * O avec `mail` activé, ses comptes simulés, actifs sauf « Mail Claire » (`statusAtStart`), plus « Mail Support », la
 * procédure `ventes/relance`, le tableau `support/suivi` et un brouillon de « Mail Ventes ».
 */
function callTables(): Tables {
  const tables = referenceTables()
  tables.accounts.push(account(MAIL_SUPPORT.id, MAIL_SUPPORT.label, "support"))
  for (const row of tables.accounts) Object.assign(row, { mode: "simule", status: statusAtStart(String(row.id)) })
  tables.connector_activations = [{ org_id: ORG.id, connector: "mail", state: "active" }]
  tables.nodes.push(node("ventes/relance", "procedure"), node("support/suivi", "table"))
  tables.sim_outbox = [seededDraft()]
  return tables
}

/**
 * La base de chaque cas, celle de `callTables` : ce qu'un cas a changé (brouillons, règles, comptes,
 * modes, activation, journal) revient avant le suivant.
 */
async function reset(): Promise<void> {
  const org = ref.org.id
  const kept = [ACCOUNTS.org.id, ACCOUNTS.ventes.id, ACCOUNTS.claire.id, MAIL_SUPPORT.id].map((id) => ref.id(id))
  await seed.admin`delete from platform.sim_outbox where org_id = ${org}`
  await seed.admin`delete from platform.journal where org_id = ${org}`
  await seed.admin`delete from platform.access_rules where org_id = ${org}`
  await seed.admin`delete from platform.accounts where org_id = ${org} and id not in ${seed.admin(kept)}`
  await seed.admin`update platform.accounts set mode = 'simule', status = case when id = ${ref.id(ACCOUNTS.claire.id)} then 'disabled' else 'active' end
                   where org_id = ${org}`
  await seed.admin`insert into platform.connector_activations (org_id, connector, state) values (${org}, 'mail', 'active')
                   on conflict (org_id, connector) do update set state = 'active'`
  await ref.write({ sim_outbox: [seededDraft()] })
}

/** `mail` désactivé chez O (AC2). */
async function mailOff(): Promise<void> {
  await seed.admin`delete from platform.connector_activations where org_id = ${ref.org.id} and connector = 'mail'`
}

/** Une ligne réussie de `<p>_context` de `person` sous `CTX`, qui a servi la procédure `target`. */
function contextLine(person: Person, target: string): Row {
  return { org_id: ORG.id, user_id: PEOPLE[person].id, ctx: CTX, tool: `${ref.org.prefix}_context`, is_error: false, target, ts: "2026-09-25T08:00:00.000Z" }
}

/** Les brouillons d'O relus, en valeurs simulées : celui du cas d'abord, puis ceux des appels, dans l'ordre. */
async function outbox(): Promise<Row[]> {
  return ref.readable([...(await seed.admin<Row[]>`select * from platform.sim_outbox where org_id = ${ref.org.id} order by created_at, id`)])
}

/** `call` sur la base réelle, sous le client de la personne de l'identité, espionné (requêtes des deux faces). */
function setup() {
  const spied = recordPeople(ref.db)
  const call = async (identity: Identity, input: CallInput, options: { ctxCode?: string; functions?: CatalogFunction[] } = {}) => {
    const person = keysOf(ref.people).find((key) => ref.people[key].id === identity.user.id)
    if (!person) throw new Error(`${identity.user.id} is not a seeded person`)
    const db = await spied.db(person)
    return runCall(
      { db, identity, ctxCode: options.ctxCode ?? null, origin: ORIGIN, activeConnectors: () => loadActiveConnectors(db, ref.org.id), functions: options.functions ?? FUNCTIONS },
      input,
    )
  }
  return {
    call,
    requests: spied.requests,
    /** Écritures envoyées à la base, sur ses deux faces : l'espion des refus décidés avant la requête. */
    writes: spied.writes,
  }
}

describe.skipIf(!sqlConfigured)(portable("runCall on a real database"), { timeout: 60_000 }, () => {
  beforeAll(async () => {
    seed = seedWithAdmin()
    ref = await seedReferenceTables(seed, callTables())
  }, 180_000)

  afterAll(async () => {
    await seed?.cleanup()
  }, 180_000)

  beforeEach(reset)

  describe("runCall: function, activation, arguments (AC1 to AC3)", () => {
    it("should refuse an unknown function, and find a name given with edge spaces and capitals (AC1)", async () => {
      const { call } = setup()
      await expect(call(ref.identityOf("claire"), { function: "sellsy.list_estimates" })).rejects.toMatchObject({
        code: "not_found",
        message: `Unknown function sellsy.list_estimates. Use ${ref.org.prefix}_find with type function.`,
      })
      expect((await call(ref.identityOf("claire"), { function: " Mail.Create_Draft ", arguments: DRAFT })).target).toBe("mail.create_draft")
    })

    it("should refuse a function whose connector is off, naming the administrators, and run nothing (AC2)", async () => {
      await mailOff()
      const { call, writes } = setup()
      await expect(call(ref.identityOf("claire"), { function: "mail.create_draft", arguments: DRAFT })).rejects.toMatchObject({
        code: "not_enabled",
        message: "Function mail.create_draft is not enabled at Acme Test: the mail connector is off. Ask an administrator of Acme Test (Ada Martin) to activate it.",
      })
      expect(writes()).toEqual([])
    })

    it("should name each invalid argument by its path, the unknown key included, absent arguments being {} (AC3)", async () => {
      const { call, writes } = setup()
      const invalid = (args?: Record<string, unknown>) => call(ref.identityOf("claire"), { function: "mail.create_draft", arguments: args })
      const contract = `Read the contract with ${ref.org.prefix}_read {"path": "mail.create_draft"}.`
      await expect(invalid({ subject: "Rdv", body: "Bonjour", cc: "paul@valbrune.test" })).rejects.toMatchObject({
        code: "invalid_arguments",
        message: `Invalid arguments for mail.create_draft: to: Invalid input: expected string, received undefined; (root): Unrecognized key: "cc". ${contract}`,
      })
      await expect(invalid({ ...DRAFT, to: "sophie" })).rejects.toMatchObject({
        message: `Invalid arguments for mail.create_draft: to: Invalid email address. ${contract}`,
      })
      await expect(invalid()).rejects.toMatchObject({
        message: `Invalid arguments for mail.create_draft: to: Invalid input: expected string, received undefined; subject: Invalid input: expected string, received undefined; body: Invalid input: expected string, received undefined. ${contract}`,
      })
      expect(writes()).toEqual([])
    })
  })

  describe("runCall: team and account (AC4 to AC8)", () => {
    it("should run the function on the team of the ctx's last procedure and its account, and say so (AC4)", async () => {
      await ref.write({ journal: [contextLine("claire", "ventes/relance")] })
      const { call } = setup()
      // Support a aussi un compte : c'est la procédure qui désigne Ventes.
      const output = await call(claireInBoth(), { function: "mail.create_draft", arguments: DRAFT }, { ctxCode: ref.id(CTX) })
      const draft = (await outbox()).at(-1)
      expect(draft).toMatchObject({ account_id: ACCOUNTS.ventes.id, created_by: PEOPLE.claire.id, status: "draft", payload: DRAFT })
      expect(output.text).toBe(
        `Draft ${draft?.id} saved for sophie@valbrune.test: « Votre rendez-vous ». Not sent.\nTeam Ventes · account « Mail Ventes » (simulated).`,
      )
      expect(ref.readable(output.data)).toEqual({
        function: "mail.create_draft",
        team: { slug: "ventes", name: "Ventes" },
        account: { id: ACCOUNTS.ventes.id, label: "Mail Ventes", mode: "simule", owner: { kind: "team", description: "team Ventes" } },
        result: { draft_id: draft?.id, to: DRAFT.to, subject: DRAFT.subject },
      })
      expect(ref.readable(output)).toMatchObject({ nextActions: [], target: "mail.create_draft", teamId: TEAMS.ventes.id, accountId: ACCOUNTS.ventes.id })
    })

    it("should run under the team named in the call, and refuse a team she is not in without running anything (AC5)", async () => {
      const { call, writes } = setup()
      const output = await call(claireInBoth(), { function: "mail.create_draft", arguments: DRAFT, team: "support" })
      expect(ref.readable(output.data)).toMatchObject({ team: { slug: "support", name: "Support" }, account: { id: MAIL_SUPPORT.id, label: "Mail Support" } })
      expect((await outbox()).at(-1)?.account_id).toBe(MAIL_SUPPORT.id)
      const written = writes().length
      await expect(call(claireInBoth(), { function: "mail.create_draft", arguments: DRAFT, team: "marketing" })).rejects.toMatchObject({
        code: "not_found",
        message: "Unknown team marketing. Your teams: support (Support), ventes (Ventes).",
      })
      expect(writes()).toHaveLength(written)
    })

    it("should refuse two teams that can both run the call, then create the draft under the one named (AC6)", async () => {
      const { call } = setup()
      await expect(call(leaInBoth(), { function: "mail.create_draft", arguments: DRAFT })).rejects.toMatchObject({
        code: "ambiguous_team",
        message:
          'Several of your teams can run mail.create_draft: support (Support), ventes (Ventes). Show them to the user and ask which one to use; do not pick one yourself. Then call again with team: "<slug>".',
      })
      expect(await outbox()).toHaveLength(1)
      await call(leaInBoth(), { function: "mail.create_draft", arguments: DRAFT, team: "support" })
      expect((await outbox()).slice(1).map((row) => row.account_id)).toEqual([MAIL_SUPPORT.id])
    })

    it("should refuse an unknown named account without trying another, and two accounts of one step until one is named (AC7)", async () => {
      await ref.write({ accounts: [{ ...account("account:mail-ventes-2", "Mail Ventes 2", "ventes"), mode: "simule", status: "active" }] })
      const { call, writes } = setup()
      const claire = ref.identityOf("claire")
      await expect(call(claire, { function: "mail.create_draft", arguments: DRAFT, account: "Mail Compta" })).rejects.toMatchObject({
        code: "not_found",
        message:
          "Unknown account « Mail Compta » for mail. Accounts you can use: « Mail Ventes » (team Ventes, simulated), « Mail Ventes 2 » (team Ventes, simulated). No other account was tried.",
      })
      await expect(call(claire, { function: "mail.create_draft", arguments: DRAFT })).rejects.toMatchObject({
        code: "ambiguous_account",
        message:
          'Several mail accounts of team Ventes can run mail.create_draft: « Mail Ventes », « Mail Ventes 2 ». Show them to the user and ask which one to use; do not pick one yourself. Then call again with account: "<label>".',
      })
      expect(writes()).toEqual([])
      await call(claire, { function: "mail.create_draft", arguments: DRAFT, account: "Mail Ventes 2" })
      expect((await outbox()).at(-1)?.account_id).toBe("account:mail-ventes-2")
    })

    // Test de sécurité du service : la base rend aussi « Mail Ventes », « Mail Support » et « Mail
    // Claire », de niveau 0 pour Marc (membre sans équipe) ; ils ne sont ni retenus ni nommés.
    it("should refuse the write class on a read-only account, then no account at all, before any write and naming no account he cannot see (AC8)", async () => {
      const hidden = ["Mail Ventes", "Mail Support", "Mail Claire"]
      const draftByMarc = (context: ReturnType<typeof setup>) => context.call(ref.identityOf("marc"), { function: "mail.create_draft", arguments: DRAFT })
      const readOnly = setup()
      const forbidden = draftByMarc(readOnly)
      await expect(forbidden).rejects.toMatchObject({
        code: "forbidden",
        message:
          "mail.create_draft needs write access to a mail account. Accounts you can see but not use this way: « Mail Org » (organisation, read for you). Ask the administrators of Acme Test (Ada Martin) for access.",
      })
      await ref.addRules([{ account: "org", user: "marc", level: "none" }])
      const none = setup()
      const notEnabled = draftByMarc(none)
      await expect(notEnabled).rejects.toMatchObject({
        code: "not_enabled",
        message:
          "No mail account is connected for you (your own, then the organisation). Ask an administrator of Acme Test (Ada Martin) to connect one on the dashboard: https://acme.test/admin/connectors.",
      })
      const refusals = await Promise.all([forbidden, notEnabled].map((refused) => refused.then(() => "", (error: unknown) => String(error))))
      for (const refused of refusals) expect(hidden.filter((label) => refused.includes(label))).toEqual([])
      expect([...readOnly.writes(), ...none.writes()]).toEqual([])
    })

    // Fiche D38, option A : le responsable de l'équipe lirait sinon les arguments de l'appel. Deux équipes
    // passent par ce filtre : l'équipe porteuse, et celle que rend la fonction (N8), comme `table.*`
    // rendra celle d'un tableau lu grâce à une règle (E07-S02). Claire n'est membre que de Ventes.
    it("should keep off the journal a team the person is not a member of, whether it runs the call or the function returns it (D38 A)", async () => {
      const rules: RuleSpec[] = [{ node: "support", user: "claire", level: "read" }]
      await ref.addRules(rules)
      const { call } = setup()
      const claire = ref.identityOf("claire")
      const running = await call(claire, { function: "table.test_read", arguments: { table: "support/suivi" } })
      expect(running.data).toMatchObject({ team: { slug: "support", name: "Support" } })
      expect(running.teamId).toBeNull()
      const returned = await call(claire, { function: "test.write", arguments: { team_id: ref.id(TEAMS.support.id) } })
      expect(returned.teamId).toBeNull()
    })
  })

  describe("runCall: two steps of a sensitive function (AC9 to AC12)", () => {
    it("should answer without confirm with the summary, the team and the approval instruction, not an error, and send nothing (AC9)", async () => {
      const { call, writes } = setup()
      const draftId = ref.id(DRAFT_ID)
      const output = await call(ref.identityOf("claire"), { function: "mail.send_draft", arguments: { id: draftId } })
      expect(output.text).toBe(
        [
          `About to send draft ${draftId}:`,
          "To: sophie@valbrune.test",
          "Subject: Votre rendez-vous",
          "Body: Bonjour Sophie, …",
          "Account: « Mail Ventes » (simulated: nothing will leave the server)",
          "Team: Ventes",
          "",
          "Nothing was sent. Show this to the user and ask for explicit approval, then call again with confirm: true.",
        ].join("\n"),
      )
      expect(ref.readable(output.data)).toMatchObject({ function: "mail.send_draft", status: "needs_confirmation", summary: { draft_id: DRAFT_ID } })
      expect(output.nextActions).toEqual([])
      expect(writes()).toEqual([])
      expect((await outbox())[0].status).toBe("draft")
    })

    it("should never run a sensitive function without confirm when it has no summary (H86)", async () => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {})
      const run = vi.fn(testSend.run)
      const bare: CatalogFunction = { ...testSend, name: "test.bare", summarize: undefined, run }
      const { call } = setup()
      await expect(call(ref.identityOf("claire"), { function: "test.bare", arguments: { to: "x" } }, { functions: [bare] })).rejects.toMatchObject({
        code: "internal",
      })
      // Un nombre : les arguments d'un appel portent le client de la base, que l'affichage d'un échec
      // parcourrait à la place de l'écart (même raison dans AC12).
      expect(run.mock.calls.length).toBe(0)
      expect(log).toHaveBeenCalledWith("[platform] call: sensitive function test.bare has no summarize")
    })

    it("should send with confirm and no prior summary, and report the ids that left with the team and the account (AC10)", async () => {
      const { call } = setup()
      const draftId = ref.id(DRAFT_ID)
      // Premier appel sur ce brouillon, directement avec `confirm` (H86, banc E04 D1).
      const output = await call(ref.identityOf("claire"), { function: "mail.send_draft", arguments: { id: draftId }, confirm: true })
      expect(output.text).toBe(
        `Draft ${draftId} sent to sophie@valbrune.test — simulated account: nothing left the server.\nTeam Ventes · account « Mail Ventes » (simulated).`,
      )
      expect(ref.readable(output.data)).toMatchObject({ result: { sent_ids: [DRAFT_ID] } })
      expect((await outbox())[0]).toMatchObject({ status: "sent", sent_by: PEOPLE.claire.id })
    })

    it("should ignore confirm on a function that is not sensitive: exactly one draft (AC11)", async () => {
      const { call } = setup()
      const output = await call(ref.identityOf("claire"), { function: "mail.create_draft", arguments: DRAFT, confirm: true })
      expect(await outbox()).toHaveLength(2)
      expect(output.data).not.toHaveProperty("status")
    })

    // Prise des connecteurs (AC14) : `mail` reste simulé ; sa propre garde refuse un compte réel ou de bac à sable avant
    // toute écriture (`runCall` ne garde plus le simulé que pour un connecteur réel).
    it("should refuse a live or sandbox mail account, writing nothing (AC12)", async () => {
      for (const [mode, kind] of [
        ["reel", "live"],
        ["sandbox", "sandbox"],
      ]) {
        await seed.admin`update platform.accounts set mode = ${mode} where id = ${ref.id(ACCOUNTS.ventes.id)}`
        const { call, writes } = setup()
        await expect(call(ref.identityOf("claire"), { function: "mail.create_draft", arguments: DRAFT })).rejects.toMatchObject({
          code: "unavailable_in_v1",
          message: `Account « Mail Ventes » is a ${kind} account (mode ${mode}): this connector is simulated in this version and runs on simulated accounts only. Nothing was sent.`,
        })
        expect(writes(), mode).toEqual([])
      }
    })
  })

  // Partage des comptes (#68) : le compte personnel de l'appelant sert d'abord, sans être nommé ; celui d'une autre
  // personne seulement nommé, et l'appel dit à qui il est (texte, données, `lentBy` que le journal écrit en `_lent_by`).
  describe("runCall: personal accounts and shares (#68)", () => {
    const activateMailClaire = () => seed.admin`update platform.accounts set status = 'active' where id = ${ref.id(ACCOUNTS.claire.id)}`
    const CLAIRE_OWNS = { kind: "user", userId: PEOPLE.claire.id, name: "Claire Morel" }

    it("should serve the caller's own personal account before the team of the procedure, unnamed, and say it is hers", async () => {
      await activateMailClaire()
      await ref.write({ journal: [contextLine("claire", "ventes/relance")] })
      const { call } = setup()
      const output = await call(claireInBoth(), { function: "mail.create_draft", arguments: DRAFT }, { ctxCode: ref.id(CTX) })
      expect((await outbox()).at(-1)?.account_id).toBe(ACCOUNTS.claire.id)
      expect(ref.readable(output.data.account)).toEqual({ id: ACCOUNTS.claire.id, label: "Mail Claire", mode: "simule", owner: { ...CLAIRE_OWNS, yours: true } })
      expect(output.text.split("\n").at(-1)).toBe("Team Ventes · account « Mail Claire » (simulated).")
      expect(output.lentBy).toBeNull()
    })

    it("should serve another person's account shared with the caller only when named, and say whose it is", async () => {
      await activateMailClaire()
      await ref.addRules([{ account: "claire", user: "marc", level: "write" }])
      const { call } = setup()
      const marc = ref.identityOf("marc")
      await expect(call(marc, { function: "mail.create_draft", arguments: DRAFT })).rejects.toMatchObject({
        code: "forbidden",
        message:
          "mail.create_draft needs write access to a mail account. Accounts you can see but not use this way: « Mail Org » (organisation, read for you). Ask the administrators of Acme Test (Ada Martin) for access." +
          ' Personal accounts shared with you, used only when named: « Mail Claire » (owner Claire Morel, simulated). Show them to the user and ask which one to use; do not pick one yourself. Then call again with account: "<label>".',
      })
      const output = await call(marc, { function: "mail.create_draft", arguments: DRAFT, account: "Mail Claire" })
      expect(output.text.split("\n").slice(-2)).toEqual(["No team · account « Mail Claire » (simulated).", "Account « Mail Claire » belongs to Claire Morel, who shared it with you."])
      expect(ref.readable(output.data.account?.owner)).toEqual({ ...CLAIRE_OWNS, yours: false })
      expect(ref.readable(output.lentBy)).toBe(PEOPLE.claire.id)
      expect((await outbox()).at(-1)).toMatchObject({ account_id: ACCOUNTS.claire.id, created_by: PEOPLE.marc.id })
    })

    it("should refuse a sensitive function on an account shared in write, and say whose it is before the approval once shared up to sensitive", async () => {
      await activateMailClaire()
      await ref.addRules([{ account: "claire", user: "marc", level: "write" }])
      const { call, writes } = setup()
      const marc = ref.identityOf("marc")
      const created = await call(marc, { function: "mail.create_draft", arguments: DRAFT, account: "Mail Claire" })
      if (created.data.status === "needs_confirmation") throw new Error("a draft needs no confirmation")
      const draftId = String(created.data.result.draft_id)
      const written = writes().length
      const refused = call(marc, { function: "mail.send_draft", arguments: { id: draftId }, account: "Mail Claire", confirm: true })
      await expect(refused).rejects.toMatchObject({ code: "forbidden", message: expect.stringMatching(/^Account « Mail Claire » cannot run mail\.send_draft for you \(sensitive access needed\)\. /) })
      expect(writes()).toHaveLength(written)

      await seed.admin`update platform.access_rules set level = 'sensitive' where account_id = ${ref.id(ACCOUNTS.claire.id)}`
      const asked = await call(marc, { function: "mail.send_draft", arguments: { id: draftId }, account: "Mail Claire" })
      expect(asked.text.split("\n").slice(-3)).toEqual([
        "Account « Mail Claire » belongs to Claire Morel, who shared it with you.",
        "",
        "Nothing was sent. Show this to the user and ask for explicit approval, then call again with confirm: true.",
      ])
    })
  })

  describe("runCall: function without account, next actions (AC13, AC14)", () => {
    it("should run a native function under the team owning its table, without account nor account line (AC13)", async () => {
      const { call, requests } = setup()
      const output = await call(claireInBoth(), { function: "table.test_read", arguments: { table: "support/suivi" } }, { ctxCode: CTX })
      expect(output.text).toBe("Rows of support/suivi.")
      expect(output.data).toEqual({ function: "table.test_read", team: { slug: "support", name: "Support" }, result: { account: null, ctx: CTX } })
      expect(ref.readable(output)).toMatchObject({ teamId: TEAMS.support.id, accountId: null })
      expect(requests().filter((sent) => namesOf(sent).includes("accounts"))).toEqual([])
    })

    it("should propose the next functions that exist, are active and are not sensitive, none after a summary (AC14)", async () => {
      const { call } = setup()
      const claire = ref.identityOf("claire")
      expect((await call(claire, { function: "mail.create_draft", arguments: DRAFT })).nextActions).toEqual([])
      expect((await call(claire, { function: "test.write" })).nextActions).toEqual(["test.read"])
      // Le `next` rendu par l'exécution l'emporte sur celui de la fonction.
      const rendered = await call(claire, { function: "test.write", arguments: { next: ["test.big", "test.send", "nope.missing"] } })
      expect(rendered.nextActions).toEqual(["test.big"])
      expect((await call(claire, { function: "test.send", arguments: { to: "x" } })).nextActions).toEqual([])
    })
  })
})
