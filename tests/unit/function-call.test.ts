// @vitest-environment node
// `callFunction` : une fonction du catalogue lancée par le serveur de l'hôte, sous la personne connectée, sur une base
// réelle (O de la fixture de référence, le vrai `mail` simulé). Les contrôles sont ceux de `runCall`, dont
// `calls.test.ts` joue la matrice entière : ici, qu'ils s'appliquent tels quels (connecteur inactif refusé, fonction
// sensible sans `confirm` récapitulée sans rien exécuter), que la sortie est typée, et que chaque appel, refus compris,
// laisse la ligne de journal de `<p>_call` à l'origine près (`method` `api`, ni `ctx` ni `host`).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { mailSendDraft } from "../../packages/plateforme/server/connectors/simulated/mail"
import { callFunction, HOST_CALL_JOURNAL, type FunctionCallInput } from "../../packages/plateforme/server/function-call"
import type { Identity } from "../../packages/plateforme/server/identity"
import { ACCOUNTS, CONTENT_AT, ORG, PEOPLE, referenceTables, TEAMS } from "../helpers/reference-org"
import { keysOf, seedReferenceTables, type ReferenceOrgSql } from "../helpers/reference-org-sql"
import type { Row, Tables } from "../helpers/simulated-db"
import { portable, seedWithAdmin, sqlConfigured, type SeededData } from "../helpers/sql"

const ORIGIN = "https://acme.test"
const USER_AGENT = "host-screen-test"
const DRAFT = { to: "sophie@valbrune.test", subject: "Votre rendez-vous", body: "Bonjour Sophie, …" }
const DRAFT_ID = "sim_1a2b3c4d"

let seed: SeededData
let ref: ReferenceOrgSql

afterEach(() => {
  vi.restoreAllMocks()
})

/** Le brouillon de « Mail Ventes » de chaque cas. */
function seededDraft(): Row {
  const row = { id: DRAFT_ID, org_id: ORG.id, account_id: ACCOUNTS.ventes.id, connector: "mail", function: "mail.create_draft", payload: DRAFT }
  return { ...row, status: "draft", sent_at: null, created_at: CONTENT_AT }
}

/**
 * O avec `mail` activé, ses comptes simulés, actifs sauf « Mail Claire » (le compte personnel de Claire servirait ses
 * appels avant celui de son équipe : partage des comptes, #68), et un brouillon de « Mail Ventes ».
 */
function functionCallTables(): Tables {
  const tables = referenceTables()
  for (const row of tables.accounts) Object.assign(row, { mode: "simule", status: row.id === ACCOUNTS.claire.id ? "disabled" : "active" })
  tables.connector_activations = [{ org_id: ORG.id, connector: "mail", state: "active" }]
  tables.sim_outbox = [seededDraft()]
  return tables
}

/** La base de chaque cas : brouillons, journal et activation de `mail` reviennent avant le suivant. */
async function reset(): Promise<void> {
  const org = ref.org.id
  await seed.admin`delete from platform.sim_outbox where org_id = ${org}`
  await seed.admin`delete from platform.journal where org_id = ${org}`
  await seed.admin`insert into platform.connector_activations (org_id, connector, state) values (${org}, 'mail', 'active')
                   on conflict (org_id, connector) do update set state = 'active'`
  await ref.write({ sim_outbox: [seededDraft()] })
}

/** `callFunction` sous le client de la personne de l'identité, comme le serveur de l'hôte sous sa session. */
async function call(identity: Identity, input: FunctionCallInput) {
  const person = keysOf(ref.people).find((key) => ref.people[key].id === identity.user.id)
  if (!person) throw new Error(`${identity.user.id} is not a seeded person`)
  return callFunction(await ref.db(person), identity, input, { origin: ORIGIN, userAgent: USER_AGENT })
}

/** Les lignes de journal d'O, dans l'ordre, en valeurs simulées. */
async function journal(): Promise<Row[]> {
  return ref.readable([
    ...(await seed.admin<Row[]>`select method, tool, target, ctx, host, user_id, user_agent, team_id, account_id, is_error, error, args
                                 from platform.journal where org_id = ${ref.org.id} order by id`),
  ])
}

/** Les brouillons d'O relus, en valeurs simulées, dans l'ordre. */
async function outbox(): Promise<Row[]> {
  return ref.readable([...(await seed.admin<Row[]>`select * from platform.sim_outbox where org_id = ${ref.org.id} order by created_at, id`)])
}

describe.skipIf(!sqlConfigured)(portable("callFunction on a real database"), { timeout: 60_000 }, () => {
  beforeAll(async () => {
    seed = seedWithAdmin()
    ref = await seedReferenceTables(seed, functionCallTables())
  }, 180_000)

  afterAll(async () => {
    await seed?.cleanup()
  }, 180_000)

  beforeEach(reset)

  it("should run an active function with the checks of call, and journal it as a call from the host (method api, no ctx)", async () => {
    const result = await call(ref.identityOf("claire"), { function: " Mail.Create_Draft ", arguments: DRAFT })
    const draft = (await outbox()).at(-1)
    expect(draft).toMatchObject({ account_id: ACCOUNTS.ventes.id, created_by: PEOPLE.claire.id, status: "draft", payload: DRAFT })
    expect(ref.readable(result)).toEqual({
      status: "done",
      function: "mail.create_draft",
      text: `Draft ${draft?.id} saved for sophie@valbrune.test: « Votre rendez-vous ». Not sent.\nTeam Ventes · account « Mail Ventes » (simulated).`,
      team: { slug: "ventes", name: "Ventes" },
      account: { id: ACCOUNTS.ventes.id, label: "Mail Ventes", mode: "simule", owner: { kind: "team", description: "team Ventes" } },
      result: { draft_id: draft?.id, to: DRAFT.to, subject: DRAFT.subject },
      nextActions: [],
    })
    expect(HOST_CALL_JOURNAL).toEqual({ method: "api", tool: "call" })
    expect(await journal()).toEqual([
      {
        method: "api",
        tool: "call",
        target: "mail.create_draft",
        ctx: null,
        host: null,
        user_id: PEOPLE.claire.id,
        user_agent: USER_AGENT,
        team_id: TEAMS.ventes.id,
        account_id: ACCOUNTS.ventes.id,
        is_error: false,
        error: null,
        args: { function: " Mail.Create_Draft ", arguments: DRAFT },
      },
    ])
  })

  it("should refuse a function whose connector is off as call does, run nothing, and journal the refusal", async () => {
    await seed.admin`delete from platform.connector_activations where org_id = ${ref.org.id} and connector = 'mail'`
    const message =
      "Function mail.create_draft is not enabled at Acme Test: the mail connector is off. Ask an administrator of Acme Test (Ada Martin) to activate it."
    await expect(call(ref.identityOf("claire"), { function: "mail.create_draft", arguments: DRAFT })).rejects.toMatchObject({ code: "not_enabled", message })
    expect(await outbox()).toHaveLength(1)
    expect(await journal()).toEqual([
      expect.objectContaining({ method: "api", tool: "call", target: "mail.create_draft", ctx: null, team_id: null, account_id: null, is_error: true, error: `not_enabled: ${message}` }),
    ])
  })

  it("should answer a sensitive function without confirm with its summary and run nothing, then run it with confirm", async () => {
    const run = vi.spyOn(mailSendDraft, "run")
    const claire = ref.identityOf("claire")
    const draftId = ref.id(DRAFT_ID)
    const summary = await call(claire, { function: "mail.send_draft", arguments: { id: draftId } })
    expect(ref.readable(summary)).toMatchObject({
      status: "needs_confirmation",
      function: "mail.send_draft",
      team: { slug: "ventes", name: "Ventes" },
      account: { id: ACCOUNTS.ventes.id, label: "Mail Ventes" },
      summary: { draft_id: DRAFT_ID },
    })
    expect(summary.text).toMatch(/\nNothing was sent\. Show this to the user and ask for explicit approval, then call again with confirm: true\.$/)
    expect(summary).not.toHaveProperty("result")
    expect(run.mock.calls.length).toBe(0)
    expect((await outbox())[0].status).toBe("draft")

    const sent = await call(claire, { function: "mail.send_draft", arguments: { id: draftId }, confirm: true })
    expect(ref.readable(sent)).toMatchObject({ status: "done", result: { sent_ids: [DRAFT_ID] } })
    expect(run.mock.calls.length).toBe(1)
    expect((await outbox())[0]).toMatchObject({ status: "sent", sent_by: PEOPLE.claire.id })
    const lines = await journal()
    expect(lines.map((line) => [line.method, line.tool, line.target, line.is_error, line.account_id])).toEqual([
      ["api", "call", "mail.send_draft", false, ACCOUNTS.ventes.id],
      ["api", "call", "mail.send_draft", false, ACCOUNTS.ventes.id],
    ])
    expect(lines.map((line) => (line.args as { confirm?: boolean }).confirm)).toEqual([undefined, true])
  })
})
