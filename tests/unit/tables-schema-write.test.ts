// @vitest-environment node
// Créer un tableau, le fermer, changer son cycle de vie, lire son brouillon (E07-S04, AC1, AC2, AC11,
// AC12), par les services d'E03-S03 et leur branche `table`, sur la fixture d'E07-S01 semée sur une
// vraie base (E01-S10, lot t1-c1b : `seedTableFixture`, une graine pour le fichier ; suite portable),
// le tableau remis à son état semé par `freshTable`. Droits dans le service (H123) : la
// publication de Léa (écriture) est refusée avant tout appel de `publish_node`, et un lecteur ne reçoit
// pas le brouillon que la base rend (`security-patterns.md § Droits dans le service`) ; requêtes vues
// par `spyDb`. Textes servis au modèle comparés mot pour mot (H04).
// E11-S01, lot g : les réglages de l'écran publient par la porte de la route, au niveau écriture (AC-g4, AC-g8).
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { readNode } from "../../packages/plateforme/server/nodes/read"
import { writeNode } from "../../packages/plateforme/server/nodes/write"
import { teamOf } from "../helpers/reference-org"
import type { ReferenceOrgSql } from "../helpers/reference-org-sql"
import { spyDb, type DbCall } from "../helpers/spy-tables"
import { seedWithAdmin, type SeededData, sqlConfigured, portable } from "../helpers/sql"
import { PROSPECTS, PROSPECTS_HEADER, STATES } from "../factories/table-fixture"
import { seedTableFixture } from "../factories/table-fixture-sql"
import { acmeIdentity, draftsAt, freshTable, nodeAt, publishCalls, writeAs, writesOf } from "../factories/table-publish-sql"

const NETWORK_TIMEOUT = 60_000
const SETUP_TIMEOUT = 180_000

const SALONS_STATES = ["à contacter", "en cours", "à revoir", "inscrit", "écarté"]

/** L'en-tête de l'AC1 : quatre colonnes, clé `nom`, file sur `statut` avec revue. */
const SALONS_HEADER = {
  columns: [
    { name: "nom", type: "text", required: true, max_length: 200 },
    { name: "ville", type: "text" },
    { name: "date", type: "date" },
    { name: "statut", type: "enum", options: SALONS_STATES },
  ],
  key: "nom",
  lifecycle: { column: "statut", states: SALONS_STATES, working: "en cours", review: { state: "à revoir", approve: "inscrit", reject: "écarté" } },
}

const salons = (path: string, header: Record<string, unknown> = SALONS_HEADER) => ({
  path,
  kind: "table",
  title: "Salons professionnels",
  summary: "Les salons où l'équipe Ventes expose ou prospecte.",
  header,
  publish: true,
})

const draftReads = (calls: readonly DbCall[]) => calls.filter((call) => call.kind === "table" && call.table === "node_drafts")

describe.skipIf(!sqlConfigured)(portable("tables written through write"), { timeout: NETWORK_TIMEOUT }, () => {
  let seed: SeededData
  let ref: ReferenceOrgSql

  beforeAll(async () => {
    seed = seedWithAdmin()
    ref = await seedTableFixture(seed)
  }, SETUP_TIMEOUT)

  afterAll(async () => {
    await seed?.cleanup()
  }, SETUP_TIMEOUT)

  describe("creating a table (AC1, AC2)", () => {
    it("should create, open the draft, pose the header and publish revision 1 for Claire, and for Léa at the write level (E11-S02, AC-a2)", async () => {
      const claire = await writeAs(ref, "claire", salons("ventes/salons"))
      expect(claire.result?.text).toBe("Published ventes/salons revision 1: a table with 4 columns, key nom. Write rows with acme_call table.write. Next write: base_revision 1.")
      const node = await nodeAt(seed, ref, "ventes/salons")
      expect(node).toMatchObject({ kind: "table", status: "published", revision: 1 })
      expect(node?.meta).toEqual({ ...SALONS_HEADER, closed: false, proof: false })
      expect(claire.calls.filter((call) => call.kind === "rpc" && call.name === "open_draft")).toHaveLength(1)
      // `p_node`, `p_base_revision`, `p_draft_stamp`.
      expect(publishCalls(claire.calls)).toEqual([{ kind: "rpc", name: "publish_node", values: [node?.id, 0, expect.any(String)] }])
      expect(await draftsAt(seed, ref, "ventes/salons")).toEqual([])
      const read = await readNode(await ref.db("claire"), acmeIdentity(ref, "claire"), { path: "ventes/salons" })
      expect(read.text).toContain("\n\nKey: nom — each row is addressed by its nom value; a new value creates a row.\nColumns:\n- nom: text, required, 200 characters at most (key)\n")
      expect(read.text).toContain("\nWork queue on statut: rows enter « à contacter »; « en cours » marks a row a worker holds under a lease.\n")

      // Léa rédige dans l'équipe Ventes (niveau 2) : sa création publie aussi l'en-tête (E11-S02, AC-a2, HN-E11S02-17).
      const lea = await writeAs(ref, "lea", salons("ventes/salons_2"))
      expect(lea.result?.text).toBe("Published ventes/salons_2 revision 1: a table with 4 columns, key nom. Write rows with acme_call table.write. Next write: base_revision 1.")
      const created = await nodeAt(seed, ref, "ventes/salons_2")
      expect(created).toMatchObject({ kind: "table", status: "published", revision: 1 })
      expect(created?.meta).toEqual({ ...SALONS_HEADER, closed: false, proof: false })
      expect(await draftsAt(seed, ref, "ventes/salons_2")).toEqual([])
      expect(publishCalls(lea.calls)).toHaveLength(1)
    })

    it("should refuse a new column without type, a header the checks refuse, and ops on a table, writing nothing", async () => {
      // Aucun `ventes/salons` : celui que crée le cas précédent ferait de ces écritures des modifications.
      await seed.admin`delete from platform.nodes where org_id = ${ref.org.id} and path = 'ventes/salons'`
      const contract = 'Contract: acme_read {"path": "write.table"}.'
      const noType = { ...SALONS_HEADER, columns: SALONS_HEADER.columns.map((column) => (column.name === "ville" ? { name: "ville" } : column)) }
      const invalid = { columns: [{ name: "statut", type: "enum", options: ["a", "b"] }], key: "statut", lifecycle: { column: "statut", states: ["b", "a"], working: "b" } }
      const cases: [Record<string, unknown>, string][] = [
        [salons("ventes/salons", noType), `Invalid table header: columns: « ville » is a new column: give its type (text, number, date, datetime, bool, enum, email, url). ${contract}`],
        [
          salons("ventes/salons", invalid),
          `Invalid table header: key: the key column must be text, email, url, number or date; statut is enum; lifecycle.states must list exactly the options of statut, in the same order; lifecycle.working: b is the first state, where rows enter; the working state comes after it. ${contract}`,
        ],
        // Un attribut inconnu, refusé par la forme stricte du patch (N1) : à la création, dans le cadre de l'AC2.
        [
          salons("ventes/salons", { ...SALONS_HEADER, columns: [...SALONS_HEADER.columns, { name: "stand", type: "text", width: 3 }] }),
          `Invalid table header: header.columns[4]: unknown key « width »; keys: name, type, options, required, allow_verified_empty, max_length. ${contract}`,
        ],
        [{ ...salons("ventes/salons"), ops: [{ op: "append", section: "Colonnes", text: "x" }] }, "ventes/salons is a table: it has no sections. Write its rows with acme_call table.write."],
      ]
      for (const [input, message] of cases) {
        const refused = await writeAs(ref, "claire", input)
        expect(refused.error, message).toMatchObject({ code: "invalid_arguments", message })
        expect(writesOf(refused.calls), message).toEqual([])
      }
    })
  })

  describe("closing and lifecycle (AC11)", () => {
    it("should publish closed, and replace the lifecycle together with the options of its state column", async () => {
      // Le titre écrit dans le même appel reste dit ; ce que l'en-tête change l'est par la ligne de publication.
      await freshTable(seed, ref)
      const closed = await writeAs(ref, "claire", { path: PROSPECTS.path, base_revision: 3, title: "Suivi des prospects 2026", header: { closed: true }, publish: true })
      // Le titre publié déplace l'adresse (AC-b12 d'E05-S10, HN-E05S10e-17).
      expect(closed.result?.text).toBe(
        // Une ligne pour l'écriture publiée (E11-S18, AC-4) ; le chemin se choisit par `node.move` (AC-6).
        'Published ventes/suivi_prospects revision 4: title « Suivi des prospects 2026 », closed. Next write: base_revision 4.\nRenamed: now at ventes/suivi_des_prospects_2026; the old path ventes/suivi_prospects still leads here. To choose the path, call acme_call node.move {"path": "ventes/suivi_des_prospects_2026", "new_path": "<path>"}.',
      )
      expect((await nodeAt(seed, ref, "ventes/suivi_des_prospects_2026"))?.meta).toEqual({ ...PROSPECTS_HEADER, closed: true })

      const states = [...STATES, "archivé"]
      const lifecycle = { column: "statut", states, working: "en cours" }
      await freshTable(seed, ref)
      const replaced = await writeAs(ref, "claire", { path: PROSPECTS.path, base_revision: 3, header: { columns: [{ name: "statut", options: states }], lifecycle }, publish: true })
      expect(replaced.result?.text).toBe("Published ventes/suivi_prospects revision 4: changed statut (options); lifecycle replaced. Next write: base_revision 4.")
      // Le cycle remplacé entier : sans `review`, que l'ancien portait.
      expect((await nodeAt(seed, ref, PROSPECTS.path))?.meta).toEqual({ ...PROSPECTS_HEADER, columns: expect.any(Array), lifecycle })
      // Les états sans les options : `parseTableHeader` refuse, rien n'est écrit.
      await freshTable(seed, ref)
      const alone = await writeAs(ref, "claire", { path: PROSPECTS.path, base_revision: 3, header: { lifecycle }, publish: true })
      expect(alone.error).toMatchObject({ code: "invalid_arguments", message: expect.stringContaining("lifecycle.states must list exactly the options of statut, in the same order") })
      expect(writesOf(alone.calls)).toEqual([])
    })
  })

  describe("reading the draft of a table (AC12)", () => {
    it("should describe the pending header and its changes to a writer, the published header without pending header, and nothing to a reader", async () => {
      await freshTable(seed, ref)
      await writeAs(ref, "lea", { path: PROSPECTS.path, base_revision: 3, header: { columns: [{ name: "telephone", type: "text" }, { name: "email", max_length: 100 }], remove_columns: ["notes"] } })
      const read = async (person: "lea" | "marc" = "lea") => {
        const identity = person === "marc" ? acmeIdentity(ref, "marc", { teams: [teamOf("support", "marc")] }) : acmeIdentity(ref, person)
        const { db, calls } = spyDb(await ref.db(person))
        const output = await readNode(db, identity, { path: PROSPECTS.path, draft: true }).then(
          (result) => ({ result, error: null }),
          (error: unknown) => ({ result: null, error }),
        )
        return { ...output, calls }
      }
      const pending = await read()
      const lines = pending.result?.text.split("\n") ?? []
      expect(lines).toContain("- telephone: text")
      expect(lines).toContain("- email: email, 100 characters at most")
      expect(lines).not.toContain("- notes: text")
      expect(lines.at(-1)).toBe("pending header changes (from revision 3): add telephone; change email (max_length); remove notes.")

      // Marc lit le tableau (règle de lecture) : la base rend le brouillon, le service ne le lit pas.
      await ref.addRules([{ node: PROSPECTS.path, team: "support", level: "read" }])
      const reader = await read("marc")
      expect(reader.error).toMatchObject({ code: "forbidden", message: expect.stringMatching(/^Drafts of ventes\/suivi_prospects are shown to its writers: /) })
      expect(draftReads(reader.calls)).toEqual([])

      await freshTable(seed, ref, { draft: { meta: null } })
      const unchanged = await read()
      expect(unchanged.result?.text).toContain("\n- notes: text\n")
      expect(unchanged.result?.text.endsWith("\nno pending header changes.")).toBe(true)
      await freshTable(seed, ref)
      expect((await read()).result?.text.endsWith("\n\nNo pending draft on ventes/suivi_prospects.")).toBe(true)
    })
  })

  describe("settings of the screen (E11-S01, lot g: AC-g4, AC-g8)", () => {
    // La porte de la route `POST /api/platform/nodes` : `writeNode` avec la provenance d'une personne.
    const screenWrite = async (person: "lea" | "marc", header: Record<string, unknown>, identity = acmeIdentity(ref, person)) => {
      const { db, calls } = spyDb(await ref.db(person))
      const outcome = await writeNode(db, identity, { path: PROSPECTS.path, base_revision: 3, header, publish: true }, { kind: "human" }).then(
        (result) => ({ result, error: null }),
        (error: unknown) => ({ result: null, error }),
      )
      return { ...outcome, calls }
    }

    it("should publish each setting in one step at the write level, reading no row, the route journaling the table's path", async () => {
      const cycle = { ...PROSPECTS_HEADER.lifecycle, review: { ...PROSPECTS_HEADER.lifecycle.review, agents_may_decide: true } }
      const cases: [Record<string, unknown>, string, Record<string, unknown>][] = [
        [{ proof: false }, "proof optional", { ...PROSPECTS_HEADER, proof: false }],
        [{ closed: true }, "closed", { ...PROSPECTS_HEADER, closed: true }],
        [{ lifecycle: cycle }, "lifecycle replaced", { ...PROSPECTS_HEADER, lifecycle: cycle }],
      ]
      for (const [header, change, meta] of cases) {
        await freshTable(seed, ref)
        // Léa rédige dans l'équipe Ventes (niveau 2) : aucun refus propre au rédacteur (E11-S02, AC-a2, HN-E11S01-21).
        const lea = await screenWrite("lea", header)
        expect(lea.result?.text, change).toBe(`Published ventes/suivi_prospects revision 4: ${change}. Next write: base_revision 4.`)
        // La ligne de journal de la route prend `target` (`api/nodes.ts`).
        expect(lea.result?.target, change).toBe(PROSPECTS.path)
        expect(lea.calls.filter((call) => call.kind === "table" && call.table === "blocks"), change).toEqual([])
        expect(publishCalls(lea.calls), change).toHaveLength(1)
        expect((await nodeAt(seed, ref, PROSPECTS.path))?.meta, change).toEqual(meta)
        expect(await draftsAt(seed, ref, PROSPECTS.path), change).toEqual([])
      }

      // La preuve (AC-f1) : en attente, « stop requiring proof » ; rendue exigée, « proof required », sans lire de ligne.
      await freshTable(seed, ref)
      const lea = acmeIdentity(ref, "lea")
      const write = async (base_revision: number, header: Record<string, unknown>, publish: boolean) => {
        const { db, calls } = spyDb(await ref.db("lea"))
        return { result: await writeNode(db, lea, { path: PROSPECTS.path, base_revision, header, publish }, { kind: "human" }), calls }
      }
      expect((await write(3, { proof: false }, false)).result.text).toContain("header changed (stop requiring proof)")
      await write(3, { proof: false }, true)
      const required = await write(4, { proof: true }, true)
      expect(required.result.text).toBe("Published ventes/suivi_prospects revision 5: proof required. Next write: base_revision 5.")
      expect(required.calls.filter((call) => call.kind === "table" && call.table === "blocks")).toEqual([])
      expect((await nodeAt(seed, ref, PROSPECTS.path))?.meta).toEqual(PROSPECTS_HEADER)
    })

    it("should refuse a reader before any write, recording nothing", async () => {
      await freshTable(seed, ref)
      await ref.addRules([{ node: PROSPECTS.path, team: "support", level: "read" }])
      const marc = await screenWrite("marc", { proof: false }, acmeIdentity(ref, "marc", { teams: [teamOf("support", "marc")] }))
      expect(marc.error).toMatchObject({ code: "forbidden" })
      expect(writesOf(marc.calls)).toEqual([])
      expect((await nodeAt(seed, ref, PROSPECTS.path))?.meta).toEqual(PROSPECTS_HEADER)
    })
  })
})
