// @vitest-environment node
// `<p>_call` par la porte (E03-S04, AC15 à AC17) : le vrai SDK par InMemoryTransport, l'adaptateur câblé
// comme la route (`connectDeps`), sur une base réelle (E01-S10, lot t1-d1) : O de la fixture de
// référence. Le catalogue est le vrai, plus les fonctions de test (`tests/factories/test-functions.ts`) :
// un résultat de 60 000 caractères, une panne et une équipe rendue par la fonction, que le `mail` simulé
// ne produit pas.
import { afterAll, afterEach, beforeAll, describe, expect, expectTypeOf, it, vi } from "vitest"
import { MAX_RESULT_CHARS } from "../../packages/plateforme/mcp/result"
import type { ToolInput } from "../../packages/plateforme/mcp/schemas"
import type { CallInput } from "../../packages/plateforme/server/calls"
import { loadActiveConnectors } from "../../packages/plateforme/server/connectors/activations"
import type { Identity } from "../../packages/plateforme/server/identity"
import { connectDeps } from "../helpers/mcp"
import { ACCOUNTS, ORG, PEOPLE, referenceTables, teamOf, TEAMS } from "../helpers/reference-org"
import { seedReferenceTables, type ReferenceOrgSql } from "../helpers/reference-org-sql"
import type { Row, Tables } from "../helpers/simulated-db"
import { sqlConfigured, seedWithAdmin, type SeededData, portable } from "../helpers/sql"

vi.mock("../../packages/plateforme/server/catalog/registry", async (importOriginal) => (await import("../factories/test-functions")).withTestFunctions(importOriginal))

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
})
