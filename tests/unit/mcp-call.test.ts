// @vitest-environment node
// `<p>_call` par la porte (E03-S04, AC15 à AC17) : le vrai SDK par InMemoryTransport, l'adaptateur câblé
// comme la route (`connectDeps`), sur une base réelle (E01-S10, lot t1-d1) : O de la fixture de
// référence. Le catalogue est le vrai, plus les fonctions de test (`tests/factories/test-functions.ts`) :
// un résultat de 60 000 caractères, une panne et une équipe rendue par la fonction, que le `mail` simulé
// ne produit pas.
import { afterAll, afterEach, beforeAll, describe, expect, expectTypeOf, it, vi } from "vitest"
import { MAX_RESULT_CHARS } from "../../packages/plateforme/mcp/result"
import type { ToolInput } from "../../packages/plateforme/mcp/schemas"
import type { CallInput, ReadRunFields } from "../../packages/plateforme/server/calls"
import { runsByRead } from "../../packages/plateforme/server/catalog/registry"
import { loadActiveConnectors } from "../../packages/plateforme/server/connectors/activations"
import type { Identity } from "../../packages/plateforme/server/identity"
import { mailTestPeek, testActPeek, testPaidRead, testRead, testSend, testWrite } from "../factories/test-functions"
import { connectDeps } from "../helpers/mcp"
import { ACCOUNTS, ORG, PEOPLE, referenceTables, teamOf, TEAMS } from "../helpers/reference-org"
import { seedReferenceTables, type ReferenceOrgSql } from "../helpers/reference-org-sql"
import type { Row, Tables } from "../helpers/simulated-db"
import { sqlConfigured, seedWithAdmin, type SeededData, portable } from "../helpers/sql"

vi.mock("../../packages/plateforme/server/catalog/registry", async (importOriginal) => {
  const factory = await import("../factories/test-functions")
  return factory.withTestFunctions(importOriginal, factory.READ_GATE_FUNCTIONS)
})

const CTX = "7K3Q-M2XA"
const DRAFT_ID = "sim_1a2b3c4d"

afterEach(() => {
  vi.restoreAllMocks()
})

// N10 : `CallInput`, tenu dans `server/`, qui n'importe pas `mcp/`. Un champ ajouté au schéma de
// `call` (ADR-002) sans que le service le reçoive ferait échouer le type-check, au lieu d'être
// ignoré en silence.
describe("acme_call input", () => {
  it("should give the service every field of the call schema but ctx (N10)", () => {
    expectTypeOf<Omit<ToolInput<"call">, "ctx">>().toEqualTypeOf<CallInput>()
  })
})

// `read` exécute une fonction de pure lecture (`outils-mcp.md` § Lire et engager) : ses champs d'exécution sont ceux de `call`.
describe("acme_read that runs a function", () => {
  it("should give runRead the arguments, team and account of the read schema", () => {
    expectTypeOf<Pick<ToolInput<"read">, "arguments" | "team" | "account">>().toEqualTypeOf<ReadRunFields>()
  })

  it("should run by read only a function of class read, outside the _act namespace, that declares no cost", () => {
    expect([testRead, mailTestPeek, testWrite, testSend, testActPeek, testPaidRead].map((fn) => [fn.name, runsByRead(fn)])).toEqual([
      ["test.read", true],
      ["mail.test_peek", true],
      ["test.write", false],
      ["test.send", false],
      ["test_act.peek", false],
      ["test.paid_read", false],
    ])
  })
})

describe.skipIf(!sqlConfigured)(portable("acme_call through the MCP gate"), { timeout: 60_000 }, () => {
  let seed: SeededData
  let ref: ReferenceOrgSql

  /** Le brouillon de « Mail Ventes » de chaque session ; son identifiant est tiré sur la base (`ref.id(DRAFT_ID)`). */
  const draftRow = (): Row => ({
    id: DRAFT_ID,
    org_id: ORG.id,
    account_id: ACCOUNTS.ventes.id,
    connector: "mail",
    payload: { to: "sophie@valbrune.test", subject: "Votre rendez-vous", body: "Bonjour Sophie, …" },
    status: "draft",
    sent_at: null,
  })

  /** O : `mail` activé, comptes simulés et actifs, le `ctx` de Claire et un brouillon de « Mail Ventes ». */
  function sessionTables(): Tables {
    const tables = referenceTables()
    tables.orgs[0].rules_version = 1
    tables.ctx = [{ code: CTX, org_id: ORG.id, user_id: PEOPLE.claire.id, rules_version: 1, host: null }]
    for (const row of tables.accounts) Object.assign(row, { mode: "simule", status: "active" })
    tables.connector_activations = [{ org_id: ORG.id, connector: "mail", state: "active" }]
    tables.sim_outbox = [draftRow()]
    return tables
  }

  beforeAll(async () => {
    seed = seedWithAdmin()
    ref = await seedReferenceTables(seed, sessionTables())
  }, 180_000)

  afterAll(async () => {
    await seed?.cleanup()
  }, 180_000)

  /** La consigne d'une panne, servie au modèle sous le préfixe de l'organisation. */
  const internal = () => `Internal error. Retry once, then report it with ${ref.org.prefix}_feedback (type error).`

  /** Claire, responsable de Ventes (son équipe par défaut), aussi membre de Support. */
  function claire(): Identity {
    return ref.identityOf("claire", { teams: [teamOf("ventes", "claire"), teamOf("support", "claire")] })
  }

  /** Session MCP de Claire sur O, son brouillon de nouveau à envoyer. */
  async function session() {
    await seed.admin`delete from platform.sim_outbox where org_id = ${ref.org.id}`
    await ref.write({ sim_outbox: [draftRow()] })
    const db = await ref.db("claire")
    const identity = claire()
    const activeConnectors = () => loadActiveConnectors(db, ref.org.id)
    const connected = await connectDeps({ db, org: identity.org, caller: { kind: "member", identity }, userAgent: "unit-test", journal: [], activeConnectors, origin: "https://acme.test" })
    const run = (fields: Record<string, unknown>) => connected.call("call", { ctx: ref.id(CTX), ...fields })
    return { ...connected, run }
  }

  it("should serve a result of 60,000 characters cut under 45,000, said so, the same text in both channels (AC15)", async () => {
    const { run } = await session()
    const big = await run({ function: "test.big" })
    expect(big.isError).toBe(false)
    expect(big.result.structuredContent).toMatchObject({ text: big.text, function: "test.big", truncated: true, next_actions: [] })
    expect(JSON.stringify(big.result.structuredContent).length).toBeLessThanOrEqual(MAX_RESULT_CHARS)
    expect(big.text).toContain("\n\n[Result cut at 45,000 characters. Ask for a smaller part: one section, a filter or the next page.]")
  })

  it("should journal each call, refusals included, with the function, the team and the account, in the order of the D1 flow (AC16)", async () => {
    const { run, journal } = await session()
    const draftId = ref.id(DRAFT_ID)
    // Le compte est nommé, comme le demande le refus quand le compte personnel de Claire servirait d'abord (#68).
    const account = ACCOUNTS.ventes.label
    const summary = await run({ function: "mail.send_draft", account, arguments: { id: draftId } })
    expect(summary.isError).toBe(false)
    expect(summary.result.structuredContent).toMatchObject({ status: "needs_confirmation", next_actions: [] })
    const sent = await run({ function: "mail.send_draft", account, arguments: { id: draftId }, confirm: true })
    expect(ref.readable(sent.result.structuredContent)).toMatchObject({ result: { sent_ids: [DRAFT_ID] } })
    // Refusé après le choix de l'équipe et du compte : ils restent à la ligne (N7).
    expect((await run({ function: "mail.send_draft", account, arguments: { id: draftId }, confirm: true })).isError).toBe(true)
    // Refusé avant : la fonction demandée seule.
    expect((await run({ function: "sellsy.list_estimates" })).isError).toBe(true)
    // Un nom de 250 caractères, refusé par le schéma (100 au plus) après la pose de la cible, qui en
    // garde 200 (N19) : la garde de taille laisse passer jusqu'à 1 000 000 caractères d'arguments.
    const long = `mail.${"x".repeat(245)}`
    expect((await run({ function: long })).isError).toBe(true)
    // L'équipe rendue par la fonction prime sur celle de l'appel, Ventes (N8).
    expect((await run({ function: "test.write", arguments: { team_id: ref.id(TEAMS.support.id) } })).isError).toBe(false)

    const send = { ctx: CTX, function: "mail.send_draft", account, arguments: { id: DRAFT_ID } }
    const [ventes, mailVentes] = [TEAMS.ventes.id, ACCOUNTS.ventes.id]
    const lines = ref.readable(journal)
    expect(lines.map((line) => [line.target, line.team_id, line.account_id, line.is_error ?? false, line.args])).toEqual([
      ["mail.send_draft", ventes, mailVentes, false, send],
      ["mail.send_draft", ventes, mailVentes, false, { ...send, confirm: true }],
      ["mail.send_draft", ventes, mailVentes, true, { ...send, confirm: true }],
      ["sellsy.list_estimates", null, null, true, { ctx: CTX, function: "sellsy.list_estimates" }],
      [long.slice(0, 200), null, null, true, { ctx: CTX, function: long }],
      ["test.write", TEAMS.support.id, null, false, { ctx: CTX, function: "test.write", arguments: { team_id: TEAMS.support.id } }],
    ])
    expect(lines.map((line) => [line.method, line.tool, line.ctx])).toEqual(Array.from({ length: 6 }, () => ["tools/call", `${ref.org.prefix}_call`, CTX]))
    expect(journal[2].error).toMatch(new RegExp(`^conflict: Draft ${draftId} was already sent on \\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2} UTC\\.$`))
    expect(journal[3].error).toBe(`not_found: Unknown function sellsy.list_estimates. Use ${ref.org.prefix}_find with type function.`)
  })

  it("should hide a failure of the function behind the internal instruction, the error in the server log only (AC17)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    const { run, journal } = await session()
    const failed = await run({ function: "test.fail" })
    expect([failed.isError, failed.text, failed.result.structuredContent]).toEqual([true, internal(), undefined])
    expect(log).toHaveBeenCalledWith("[platform] mcp: tools/call failed", expect.objectContaining({ message: "socket hang up at 10.0.0.12:5432" }))
    expect(journal[0]).toMatchObject({ target: "test.fail", is_error: true, error: `internal: ${internal()}` })
  })

  /** Session MCP de Claire, et `read` sous son `ctx`. */
  async function readSession() {
    const connected = await session()
    const read = (fields: Record<string, unknown>) => connected.call("read", { ctx: ref.id(CTX), ...fields })
    return { ...connected, read }
  }

  it("should run with read a function that only reads, through the path of call: same result, account resolved", async () => {
    const { read, run } = await readSession()
    const ran = await read({ path: "test.read", arguments: {} })
    expect(ran.isError).toBe(false)
    expect(ran.text).toBe("Test data read.")
    expect(ref.readable(ran.result.structuredContent)).toMatchObject({ function: "test.read", result: { account: null, ctx: CTX } })
    expect(ran.result.structuredContent).toEqual((await run({ function: "test.read", arguments: {} })).result.structuredContent)
    // Une fonction de connecteur court sur le compte résolu, nommé comme par `call`.
    const peeked = await read({ path: "mail.test_peek", arguments: {}, account: ACCOUNTS.ventes.label })
    expect(peeked.isError).toBe(false)
    expect(ref.readable(peeked.result.structuredContent)).toMatchObject({ function: "mail.test_peek", result: { account: ACCOUNTS.ventes.label } })
  })

  it("should refuse with read a write, a sensitive, an _act and a costly function, run none, and give the call to make", async () => {
    const { read, journal } = await readSession()
    const prefix = ref.org.prefix
    const refusals = [
      ["test.write", { team_id: "x" }, "it writes"],
      ["test.send", { to: "sophie@valbrune.test" }, "it sends, deletes or pays"],
      ["test_act.peek", {}, "it engages or destroys"],
      ["test.paid_read", {}, "it costs credits"],
    ] as const
    for (const [name, args, why] of refusals) {
      const refused = await read({ path: name, arguments: args, team: "ventes" })
      expect(refused.isError, name).toBe(true)
      expect(refused.text).toBe(
        `${prefix}_read runs only functions that read and cost nothing; ${name} is not one (${why}). Nothing was run. Run it with ${prefix}_call {"function": "${name}", "arguments": <the same arguments>, "team": "ventes"}.`,
      )
    }
    // Rien n'a couru : aucune ligne ne porte de compte ni d'équipe, chaque refus garde sa fonction en cible.
    expect(journal.map((line) => [line.tool, line.target, line.is_error, line.team_id ?? null])).toEqual(refusals.map(([name]) => [`${prefix}_read`, name, true, null]))
  })

  it("should still return the contract without arguments, and refuse team or account without them", async () => {
    const { read } = await readSession()
    const contract = await read({ path: "test.read" })
    expect(contract.isError).toBe(false)
    expect(contract.text).not.toContain("Test data read.")
    expect(contract.text).toContain("test.read")
    const alone = await read({ path: "test.read", team: "ventes" })
    expect([alone.isError, alone.text]).toEqual([true, `team and account go with arguments: ${ref.org.prefix}_read {"path": "test.read", "arguments": {}} runs test.read without any.`])
    const page = await read({ path: "ventes/relance_devis", arguments: {} })
    expect(page.isError).toBe(true)
    expect(page.text).toContain("give its name as path")
  })

  it("should journal a read that runs with its function as target, its team and its account, like call", async () => {
    const { read, run, journal } = await readSession()
    await read({ path: "mail.test_peek", arguments: {}, account: ACCOUNTS.ventes.label })
    await run({ function: "mail.test_peek", arguments: {}, account: ACCOUNTS.ventes.label })
    const lines = ref.readable(journal)
    expect(lines.map((line) => [line.tool, line.target, line.team_id, line.account_id, line.is_error ?? false])).toEqual([
      [`${ref.org.prefix}_read`, "mail.test_peek", TEAMS.ventes.id, ACCOUNTS.ventes.id, false],
      [`${ref.org.prefix}_call`, "mail.test_peek", TEAMS.ventes.id, ACCOUNTS.ventes.id, false],
    ])
  })

  it("should give by read the refusal of call for an inactive connector or an unknown account", async () => {
    const { read, run } = await readSession()
    const off = await read({ path: "test.off", arguments: {} })
    expect(off.isError).toBe(true)
    expect(off.text).toBe((await run({ function: "test.off", arguments: {} })).text)
    const unknown = await read({ path: "mail.test_peek", arguments: {}, account: "Mail Inconnu" })
    expect(unknown.isError).toBe(true)
    expect(unknown.text).toBe((await run({ function: "mail.test_peek", arguments: {}, account: "Mail Inconnu" })).text)
  })
})
