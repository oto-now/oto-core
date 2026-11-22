// @vitest-environment node
// `read` d'un tableau par le MCP (E07-S01, AC18) : `InMemoryTransport` (`connectDeps`), sur la fixture
// des tableaux semée sur une vraie base (E01-S10, lot t1-c1b : `seedTableFixture`, une graine pour le
// fichier ; suite portable), garde `ctx` comprise (un code semé dans `ctx` pour chaque
// personne), les requêtes vues par `spyDb`. Le passage des trois fonctions par `<p>_call` est testé par
// E07-S02 (AC28), après E03-S04. Textes servis au modèle comparés mot pour mot (H04).
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { Identity } from "../../packages/plateforme/server/identity"
import { connectDeps } from "../helpers/mcp"
import { CONTENT_AT, ORG, PEOPLE, teamOf } from "../helpers/reference-org"
import type { ReferenceOrgSql } from "../helpers/reference-org-sql"
import { spyDb } from "../helpers/spy-tables"
import { seedWithAdmin, type SeededData, sqlConfigured, portable } from "../helpers/sql"
import { DRAFT_TABLE, PROSPECTS } from "../factories/table-fixture"
import { seedTableFixture } from "../factories/table-fixture-sql"
import { acmeIdentity } from "../factories/table-publish-sql"

const NETWORK_TIMEOUT = 60_000
const SETUP_TIMEOUT = 180_000

/** Le code `ctx` semé pour chaque personne qui lit : la base le tient pour unique, un par personne. */
const CTX = { lea: "ABCD-1234", marc: "ABCD-5678" } as const

const NO_SECTIONS = 'A table has no sections: read its rows with acme_call {"function": "table.rows", "arguments": {"table": "ventes/suivi_prospects"}}.'

describe.skipIf(!sqlConfigured)(portable("acme_read of a table (AC18)"), { timeout: NETWORK_TIMEOUT }, () => {
  let seed: SeededData
  let ref: ReferenceOrgSql

  beforeAll(async () => {
    seed = seedWithAdmin()
    ref = await seedTableFixture(seed)
    await ref.write({ ctx: (["lea", "marc"] as const).map((person) => ({ code: CTX[person], user_id: PEOPLE[person].id, org_id: ORG.id, rules_version: 1, host: null })) })
  }, SETUP_TIMEOUT)

  afterAll(async () => {
    await seed?.cleanup()
  }, SETUP_TIMEOUT)

  /** Une session MCP de la personne sur la fixture, avec son code `ctx` semé. */
  async function session(person: keyof typeof CTX, overrides: Partial<Identity> = {}) {
    const identity = acmeIdentity(ref, person, overrides)
    const { db, calls } = spyDb(await ref.db(person))
    const connected = await connectDeps({ db, org: identity.org, caller: { kind: "member", identity }, userAgent: "unit-test", journal: [], activeConnectors: () => Promise.resolve(new Set<string>()), origin: "https://acme.test" })
    return { ...connected, calls, read: (args: Record<string, unknown>) => connected.call("read", { ctx: ref.id(CTX[person]), ...args }) }
  }

  it("should serve the header of read, then the description of the table and how to read its rows, never a block", async () => {
    const lea = await session("lea")
    const read = await lea.read({ path: PROSPECTS.path })
    expect(read.isError).toBe(false)
    expect(read.text).toBe(
      [
        "# Suivi des prospects",
        `path: ventes/suivi_prospects · table · published · revision 3 · updated ${CONTENT_AT.slice(0, 10)}`,
        `id: ${ref.nodeId(PROSPECTS.path)}`,
        "summary: Les prospects de l'équipe Ventes et la file des fiches à qualifier.",
        "owner: team Ventes (lead: Claire Morel)",
        "access: write (write and publish; sharing, moving and deleting are reserved to team Ventes (lead: Claire Morel))",
        "parent: ventes — Ventes",
        "children: none",
        "links in: none",
        "links out: none",
        "",
        "Key: entreprise — each row is addressed by its entreprise value; a new value creates a row.",
        "Columns:",
        "- entreprise: text, required, 200 characters at most (key)",
        "- contact: text",
        "- email: email",
        "- ville: text",
        "- montant_estime: number",
        "- dernier_contact: date (YYYY-MM-DD)",
        "- relance_le: datetime (with a time zone, e.g. 2026-09-24T14:30:00Z)",
        "- actif: bool (true or false)",
        "- notes: text",
        "- statut: enum (à traiter | en cours | à revoir | qualifié | écarté), required",
        "Work queue on statut: rows enter « à traiter »; « en cours » marks a row a worker holds under a lease.",
        "table.claim takes rows « à traiter » (or whose lease expired) and sets them « en cours » with a lease.",
        "table.release frees a row you claimed and sets its next state.",
        "Review: rows « à revoir » wait for a person, who approves them (« qualifié ») or rejects them (« écarté »).",
        "Write with table.write: rows [{key, revision?, set: {column: {value, comment | link}}, clear: [column], verified_empty: [{column, reason}]}]; a bare value equal to the stored one is ignored; any new value needs its proof (comment or link), except the state column statut, set bare within its allowed changes; null is refused; unnamed columns stay unchanged.",
        "Closed: no — a new key creates a row.",
        "Proof: required — every new value needs {value, comment | link}; a new value without it refuses the whole call.",
        "Rows: 12.",
        'Read rows with acme_call {"function": "table.rows", "arguments": {"table": "ventes/suivi_prospects"}}.',
      ].join("\n"),
    )
    expect(read.result.structuredContent).toMatchObject({ text: read.text, path: PROSPECTS.path, kind: "table", blocks_total: 0, outline: [] })
    // Les lignes sont comptées, jamais lues ni rendues.
    const rowReads = lea.calls.filter((call) => call.kind === "table" && call.table === "blocks" && !("count" in call))
    expect(rowReads).toEqual([])
    expect(lea.calls.some((call) => call.kind === "table" && call.table === "blocks" && call.count === true)).toBe(true)
    const draft = await lea.read({ path: DRAFT_TABLE })
    expect(draft.text.endsWith("\n\nTable ventes/brouillon has no published header yet: its owner publishes it with acme_write.")).toBe(true)
  })

  it("should refuse the options of a page on a table, and answer a table of level 0 like an unknown path", async () => {
    const lea = await session("lea")
    for (const mode of [{ section: "Colonnes" }, { outline: true }, { since_revision: 1 }, { cursor: "x" }]) {
      const refused = await lea.read({ path: PROSPECTS.path, ...mode })
      expect([refused.isError, refused.text], JSON.stringify(mode)).toEqual([true, NO_SECTIONS])
    }
    const marc = await session("marc", { teams: [teamOf("support", "marc")] })
    const unknown = await marc.read({ path: PROSPECTS.path })
    expect([unknown.isError, unknown.text]).toEqual([true, "Unknown path ventes/suivi_prospects. Use acme_find to locate it."])
    expect(marc.calls.filter((call) => call.kind === "table" && call.table === "blocks")).toEqual([])
  })
})
