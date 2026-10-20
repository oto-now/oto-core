// @vitest-environment node
// Les six fonctions `table.*` par `<p>_call` (E07-S02, AC28, AC30 ; H84, N20) : `InMemoryTransport`
// (`connectDeps`), sur la fixture d'E07-S01 semée sur une vraie base (E01-S10, lot t1-c1b :
// `seedTableFixture`, une graine pour le fichier ; suite portable), garde `ctx`
// comprise (un code semé par personne). Journal : la fonction en cible, l'équipe propriétaire du tableau,
// aucun compte. Un tableau atteint par un ancien chemin (alias d'E03-S07) : la ligne « moved to »,
// `moved_from`, et l'équipe propriétaire du tableau déplacé au journal, là où `call` ne trouve pas
// l'ancien chemin. La parité des canaux, le schéma strict et les suites sont les règles d'E03-S01 et
// d'E03-S04, prouvées par leurs tests.
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { isRecord } from "../../packages/plateforme/schemas/tables"
import type { CatalogFunction } from "../../packages/plateforme/server/catalog/define"
import { describeFunction } from "../../packages/plateforme/server/catalog/registry"
import type { Identity } from "../../packages/plateforme/server/identity"
import { tableClaim } from "../../packages/plateforme/server/tables/claim"
import { tableRelease } from "../../packages/plateforme/server/tables/release"
import { tableRows } from "../../packages/plateforme/server/tables/rows"
import { tableWrite } from "../../packages/plateforme/server/tables/write"
import { connectDeps } from "../helpers/mcp"
import { nodeId, ORG, PEOPLE, TEAMS, teamOf } from "../helpers/reference-org"
import type { ReferenceOrgSql } from "../helpers/reference-org-sql"
import { seedWithAdmin, type SeededData, sqlConfigured, portable } from "../helpers/sql"
import { undoAll } from "../helpers/spy-t1-d2a"
import { fixtureTables, PROSPECT_ROWS, PROSPECTS, rowBlocks } from "../factories/table-fixture"
import { seedTableFixture } from "../factories/table-fixture-sql"
import { acmeIdentity } from "../factories/table-publish-sql"

const NETWORK_TIMEOUT = 60_000
const SETUP_TIMEOUT = 180_000

/** Le code `ctx` semé pour chaque personne qui appelle : la base le tient pour unique, un par personne. */
const CTX = { lea: "ABCD-1234", claire: "ABCD-5678" } as const

describe.skipIf(!sqlConfigured)(portable("the table functions through acme_call"), { timeout: NETWORK_TIMEOUT }, () => {
  let seed: SeededData
  let ref: ReferenceOrgSql

  beforeAll(async () => {
    seed = seedWithAdmin()
    ref = await seedTableFixture(seed)
    await ref.write({ ctx: (["lea", "claire"] as const).map((person) => ({ code: CTX[person], user_id: PEOPLE[person].id, org_id: ORG.id, rules_version: 1, host: null })) })
  }, SETUP_TIMEOUT)

  afterAll(async () => {
    await seed?.cleanup()
  }, SETUP_TIMEOUT)

  /** Une session MCP de la personne sur la fixture, avec son code `ctx` semé. */
  async function session(person: keyof typeof CTX, overrides: Partial<Identity> = {}) {
    const identity = acmeIdentity(ref, person, overrides)
    const connected = await connectDeps({ db: await ref.db(person), org: identity.org, caller: { kind: "member", identity }, userAgent: "unit-test", journal: [], activeConnectors: () => Promise.resolve(new Set<string>()), origin: "https://acme.test" })
    return { ...connected, run: (fn: string, args: Record<string, unknown>) => connected.call("call", { ctx: ref.id(CTX[person]), function: fn, arguments: args }) }
  }

  it("should run the six functions, each journaled with the function as target, the team that owns the table and no account (AC28)", async () => {
    const lea = await session("lea")
    const table = PROSPECTS.path
    const calls: [string, Record<string, unknown>, string | RegExp][] = [
      ["table.schema", { table }, "Table ventes/suivi_prospects: Suivi des prospects. Les prospects de l'équipe Ventes et la file des fiches à qualifier."],
      ["table.rows", { table, limit: 2 }, "ventes/suivi_prospects: 12 row(s) match; rows 1-2."],
      ["table.aggregate", { table, group_by: "statut" }, "ventes/suivi_prospects: 12 row(s) match; 5 group(s) by statut."],
      ["table.write", { table, rows: [{ key: "Boulangerie du Pont", set: { ville: { value: "Valbrune", comment: "Site officiel" } } }] }, "ventes/suivi_prospects: 1 row(s) written (1 created, 0 updated), 0 unchanged, 0 refused."],
      ["table.claim", { table, worker: "claude-lea", limit: 1 }, /^Claimed 1 row\(s\) for claude-lea until \d{2}:\d{2} UTC:$/],
      ["table.release", { table, key: "Scierie Vallon", worker: "claude-lea", state: "à revoir" }, "Scierie Vallon released → « à revoir » (revision 7)."],
    ]
    for (const [fn, args, first] of calls) {
      const result = await lea.run(fn, args)
      expect(result.isError, `${fn}: ${result.text}`).toBe(false)
      if (typeof first === "string") expect(result.text.split("\n")[0], fn).toBe(first)
      else expect(result.text.split("\n")[0], fn).toMatch(first)
    }
    expect(ref.readable(lea.journal.map((line) => [line.tool, line.target, line.team_id, line.account_id, line.is_error ?? false]))).toEqual(
      calls.map(([fn]) => ["acme_call", fn, TEAMS.ventes.id, null, false]),
    )
    // Le lien de la file de revue d'AC17, composé sur l'origine de l'adresse appelée, de la porte jusqu'au refus.
    const decided = await lea.run("table.write", { table, rows: [{ key: "Atelier 2", set: { statut: "qualifié" } }] })
    expect(decided.text.split("\n")[1]).toBe(
      "Atelier 2: refused, nothing written: statut: « qualifié » and « écarté » are decided by a person in the review queue of this table (https://acme.test/n/ventes/suivi_prospects).",
    )
    // Le contrat des trois fonctions d'écriture servi par `read` : exemples acceptés par leur schéma strict, sous 45 000 caractères.
    for (const fn of [tableWrite, tableClaim, tableRelease]) {
      for (const example of fn.examples) expect(fn.schema.safeParse(example).success, `${fn.name} ${JSON.stringify(example)}`).toBe(true)
      const { text, data } = describeFunction(fn, "acme")
      expect(JSON.stringify({ ...data, text }).length, fn.name).toBeLessThan(45_000)
    }
  })

  it("should serve a table reached by its old path with the moved line and moved_from, and journal the team that owns the moved table (AC30)", async () => {
    const prospects = fixtureTables().nodes.find((node) => node.path === PROSPECTS.path)
    // `ventes/t` déplacé en `ventes/t2`, possédé par Support : l'équipe par défaut de Claire est Ventes.
    await ref.write({
      nodes: [{ ...structuredClone(prospects), id: nodeId("ventes/t2"), path: "ventes/t2", owner_kind: "team", owner_team_id: TEAMS.support.id, owner_user_id: null }],
      node_aliases: [{ org_id: ORG.id, old_path: "ventes/t", node_id: nodeId("ventes/t2"), created_by: null, created_at: "2026-09-24T08:00:00.000000+00:00" }],
      blocks: rowBlocks(nodeId("ventes/t2"), PROSPECT_ROWS.slice(0, 2)),
    })
    const claire = await session("claire", { teams: [teamOf("ventes", "claire"), teamOf("support", "claire")] })
    // Claire est membre de Support en base aussi, le temps du cas : la base exige le niveau que le service décide, à
    // la lecture des lignes (`20261021130000`) comme à leur écriture.
    const support = ref.id(TEAMS.support.id)
    await seed.admin`insert into platform.team_members (team_id, user_id, role) values (${support}, ${ref.people.claire.id}, 'member')`
    try {
      const moved = "ventes/t moved to ventes/t2 on 2026-09-24: use the new path."
      for (const [fn, args] of [
        ["table.schema", {}],
        ["table.rows", {}],
        ["table.write", { rows: [{ key: "Atelier 2", set: { notes: { value: "Relancer", comment: "Demande de Claire" } } }] }],
      ] as const) {
        const result = await claire.run(fn, { table: "ventes/t", ...args })
        expect([result.isError, result.text.split("\n")[0]], fn).toEqual([false, moved])
        expect(result.result.structuredContent, fn).toMatchObject({ result: { moved_from: "ventes/t" } })
      }
      expect(ref.readable(claire.journal.map((line) => [line.target, line.team_id]))).toEqual(["table.schema", "table.rows", "table.write"].map((fn) => [fn, TEAMS.support.id]))
    } finally {
      await seed.admin`delete from platform.team_members where team_id = ${support} and user_id = ${ref.people.claire.id}`
    }
  })

  describe("E11-S01 through acme_call", () => {
    const CLOSED_NO = "Closed: no — a new key creates a row."
    const HOST = "claude-ai@0.1.0"
    const CREATE_ONLY =
      "create_only: true only creates rows: a key that already exists is refused (conflict) with the row as it is, and nothing is written for it (default false: a known key updates its row)"

    /** Le JSON Schema des arguments d'une fonction, tel que `read` le sert (`describeFunction`). */
    function argumentsOf(fn: CatalogFunction): unknown {
      return describeFunction(fn, "acme").data.arguments_schema
    }

    it("should serve the revision, the proof required and its structured fields in table.schema (AC-d1, AC-f4)", async () => {
      const lea = await session("lea")
      const schema = await lea.run("table.schema", { table: PROSPECTS.path })
      const lines = schema.text.split("\n")
      expect(lines[1]).toMatch(/ Revision: 3 \(the base_revision of acme_write to change the header\)\.$/)
      const proof = "Proof: required — every new value needs {value, comment | link}; a new value without it refuses the whole call."
      expect(lines.indexOf(proof)).toBe(lines.indexOf(CLOSED_NO) + 1)
      expect(schema.result.structuredContent).toMatchObject({ result: { closed: false, proof: true, revision: 3 } })
    })

    it("should describe a table without proof, with a strict column and decisions by the assistant, and write bare values with the host of the conversation (AC-b6, AC-e4, AC-f2, AC-f4, AC-d2)", async () => {
      const id = ref.nodeId(PROSPECTS.path)
      const [saved] = await seed.admin<{ meta: string }[]>`select meta::text as meta from platform.nodes where id = ${id}`
      try {
        // Sans preuve exigée, revue confiée aussi à l'assistant, `contact` (rang 1) requise et sans `verified_empty` ; le client MCP de Claire connu.
        await seed.admin`
          update platform.nodes
             set meta = jsonb_set(jsonb_set(jsonb_set(meta, '{proof}', 'false'::jsonb), '{lifecycle,review,agents_may_decide}', 'true'::jsonb), '{columns,1}', (meta #> '{columns,1}') || '{"required": true, "allow_verified_empty": false}'::jsonb)
           where id = ${id}`
        await seed.admin`update platform.ctx set host = ${HOST} where code = ${ref.id(CTX.claire)}`
        const claire = await session("claire")
        const lines = (await claire.run("table.schema", { table: PROSPECTS.path })).text.split("\n")
        const expected = [
          "- contact: text, required (a value; verified_empty not allowed)",
          "- statut: enum (à traiter | en cours | à revoir | qualifié | écarté), required",
          "An assistant may also decide: set « qualifié » or « écarté » with table.release or table.write.",
          "Write with table.write: rows [{key, revision?, set: {column: value | {value, comment | link}}, clear: [column], verified_empty: [{column, reason}]}]; a bare value equal to the stored one is ignored; null is refused; unnamed columns stay unchanged.",
          "Proof: optional — a bare value is written as it is; {value, comment | link} keeps where it comes from.",
        ]
        for (const line of expected) expect(lines, line).toContain(line)
        const written = await claire.run("table.write", { table: PROSPECTS.path, rows: [{ key: "Relais du Port", set: { contact: "Anne Roy", ville: "Port-Lise" } }] })
        expect(written.text.split("\n")[0]).toBe("ventes/suivi_prospects: 1 row(s) written (1 created, 0 updated), 0 unchanged, 0 refused.")
        const [row] = await seed.admin<{ provenance: Record<string, unknown> }[]>`select provenance from platform.blocks where node_id = ${id} and key = ${"Relais du Port"}`
        expect(row?.provenance.ville).toEqual({ origin: "agent", by: ref.id(PEOPLE.claire.id), ctx: ref.id(CTX.claire), at: expect.stringMatching(/Z$/), host: HOST })
      } finally {
        // Chaque remise est jouée, même après l'échec d'une autre (`testing-strategy.md § Anti-patterns`).
        await undoAll([
          () => seed.admin`update platform.nodes set meta = ${saved.meta}::text::jsonb where id = ${id}`,
          () => seed.admin`update platform.ctx set host = null where code = ${ref.id(CTX.claire)}`,
        ])
      }
    })

    it("should refuse a key that has its row under create_only with the row as it is (AC-a1)", async () => {
      const lea = await session("lea")
      const refused = await lea.run("table.write", { table: PROSPECTS.path, create_only: true, rows: [{ key: "Atelier 2", set: { notes: { value: "Relancer", comment: "Appel" } } }] })
      const content: unknown = refused.result.structuredContent
      const outcome = isRecord(content) && isRecord(content.result) && Array.isArray(content.result.rows) ? content.result.rows[0] : undefined
      const current = isRecord(outcome) && isRecord(outcome.current) ? outcome.current : {}
      expect([refused.isError, isRecord(outcome) ? outcome.code : null]).toEqual([false, "conflict"])
      expect(refused.text.split("\n")[1]).toBe(
        `Atelier 2: refused (conflict): a row with this key already exists (revision ${String(current.revision)}); nothing written (create_only). Current row: ${JSON.stringify(current)}. Pick another key, or write without create_only to update it.`,
      )
    })

    it("should serve the texts of table.write, table.rows and table.release word for word (AC-a7, AC-c5, AC-e4, AC-f5)", () => {
      expect(tableWrite.description).toBe(
        `Writes rows of a table by key: set {column: value}, or {column: {value, comment | link}} with a comment saying where you found it or the link of the source; a new value needs its proof when the table requires it (table.schema says it), except the state column, set bare within its allowed changes; a bare value equal to the stored one is ignored. Other operations: clear columns, or verified_empty with the reason for 'searched, nothing found'. Use it to create or complete rows; null is refused and columns you do not name stay unchanged. Pass the revision you read to refuse a stale write. ${CREATE_ONLY}. 50 rows at most per call; each row is written or refused on its own, except a new value without its proof on a table that requires it, which refuses the whole call; the answer says which and why.`,
      )
      expect(tableWrite.description.length).toBeLessThan(1_000)
      expect(tableWrite.refusals).toContain(
        "A new value without its proof on a table that requires it (a bare value that differs from the stored one, or on a new row): nothing is written in the whole call; add the comment or the link, then call again.",
      )
      expect(argumentsOf(tableWrite)).toMatchObject({
        properties: {
          create_only: { description: `${CREATE_ONLY}.` },
          rows: {
            items: {
              properties: {
                set: {
                  description:
                    'Values by column, e.g. {"contact": {"value": "Anne Roy", "comment": "Page équipe du site"}, "email": {"value": "anne@exemple.test", "link": "https://exemple.test/contact"}}; a new value needs its proof when the table requires it (table.schema says it), except the state column, set bare within its allowed changes; a bare value equal to the stored one is ignored; a null refuses its row (default: none).',
                  additionalProperties: {
                    description:
                      'A value (text, number, true or false), or {"value": …, "comment": "…"} or {"value": …, "link": "https://…"}: the value with a comment saying where you found it (1,000 characters at most) or the link of the source; a new value needs its proof when the table requires it (table.schema says it), except the state column, set bare within its allowed changes; a bare value equal to the stored one is ignored; a null refuses its row: use clear, or verified_empty with a reason.',
                  },
                },
              },
            },
          },
        },
      })
      expect(argumentsOf(tableRows)).toMatchObject({
        properties: {
          q: { description: 'Words to find, without case or accents, in any order: each word must appear (unless match is any) in a text, email, url or enum column or in the key, e.g. "mairie valbrune" (default: none).' },
        },
      })
      expect(tableRelease.description).toBe(
        "Frees a row you claimed with table.claim and sets its next state (default: the first state of the work queue). Use it when you are done with a claimed row, with the same worker name; the working state is set only by table.claim, and the decisions of a review only by a person, unless the table lets assistants decide (table.schema says it).",
      )
    })
  })
})
