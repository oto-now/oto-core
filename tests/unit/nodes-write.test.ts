// @vitest-environment node
// `write` sur une base réelle (E03-S03, AC19, AC20, AC21, AC26, AC27, AC28 ; E01-S10, lot t1-b) : création,
// refus, garde de révision, en-tête en attente et genre, provenance. Chaque cas écrit ses tables simulées sur
// l'organisation O de la graine du fichier (`replaceContent`), puis relit par la connexion d'administration
// les lignes que le service a écrites. Les droits sont décidés par le service avant toute écriture :
// l'espion des requêtes (`spyDb`) montre qu'aucune écriture ne part d'un refus. Une course (chemin pris
// entre le contrôle et l'insertion) est une vraie insertion de la connexion d'administration, juste avant
// celle du service : la base la refuse (`23505`). Une création tient dans une transaction (AC-x4, partie b2) :
// arrêtée au milieu, elle ne laisse rien. En suite portable (`sqlConfigured`) : le projet, ou le Postgres nu du job `bare-postgres`.
// L'écriture côté assistants (E11-S18) : les blocs insérés retrouvés par leur rang, pas par leur position relue (AC-8,
// FB-0015) ; un refus de publication qui n'écrit rien pour un assistant, et garde le brouillon de l'écran (AC-1, AC-3) ;
// `node.move` (AC-5) ; `node.write_many` (AC-12) ; l'auteur d'un Contexte qui garde son `ctx` (AC-14).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { inputSchemas, parseInput } from "../../packages/plateforme/mcp/schemas"
import type { BlockInput } from "../../packages/plateforme/schemas"
import { writeManyArgsSchema } from "../../packages/plateforme/schemas/nodes"
import type { FunctionContext } from "../../packages/plateforme/server/catalog/define"
import { issueCtx, requireCtx } from "../../packages/plateforme/server/ctx"
import type { PlatformDb } from "../../packages/plateforme/server/db"
import { BLOCKS_MAX } from "../../packages/plateforme/server/nodes/limits"
import { nodeMove } from "../../packages/plateforme/server/nodes/move-function"
import { writeNode, type WriteOrigin } from "../../packages/plateforme/server/nodes/write"
import { nodeWriteMany } from "../../packages/plateforme/server/nodes/write-many"
import { addBlocks, contentTables, identityOf, nodeId, TEAMS, type ContentNode, type Person, type RuleSpec } from "../helpers/reference-org"
import { seedReferenceOrg, type ReferenceOrgSql } from "../helpers/reference-org-sql"
import type { Tables } from "../helpers/simulated-db"
import { loggedText } from "../helpers/logs"
import { functionCalls, isWrite, replaceContent, spyDb, touches, type SpiedCall, type SpyHook } from "../helpers/spy-t1-b"
import { watchDb, type DbCall } from "../helpers/spy-t1-e2b2"
import { sqlConfigured, seedWithAdmin, type SeededData, portable } from "../helpers/sql"

const NETWORK_TIMEOUT = 60_000
const SETUP_TIMEOUT = 180_000

const AGENT: WriteOrigin = { kind: "agent", ctx: "7K3Q-M2XA" }
/** Un assistant sans `ctx` : les cas d'E11-S18. */
const AGENT_WITHOUT_CTX: WriteOrigin = { kind: "agent", ctx: null }

const heading = (text: string, level: 1 | 2 | 3 = 1, key?: string): BlockInput => ({ type: "heading", text, data: { level }, key })
const paragraph = (text: string): BlockInput => ({ type: "paragraph", text, data: {} })

/** `ventes/devis` publiée en révision 1 : Objet, un paragraphe, Étapes, un paragraphe (positions 1024, 2048…). */
function shortDevis(): Tables {
  const tables = contentTables([], [{ path: "ventes", title: "Ventes" }, { path: "ventes/devis", title: "Devis" }])
  addBlocks(tables, "ventes/devis", "published", [heading("Objet"), paragraph("Relancer."), heading("Étapes"), paragraph("Lire.")])
  return tables
}

/**
 * Une session qui relit un `double precision` à 15 chiffres (`extra_float_digits = 0`, comme certains poolers) : une
 * position de 1365.3333333333333 revient 1365.33333333333, et ne s'égale plus à celle qu'on a envoyée.
 */
function roundingPositions(db: PlatformDb): PlatformDb {
  return {
    tx: (fn) =>
      db.tx(async (sql) => {
        await sql`select pg_catalog.set_config('extra_float_digits', '0', true)`
        return fn(sql)
      }),
  }
}

function base(nodes: ContentNode[] = [], rules: RuleSpec[] = []): Tables {
  return contentTables(rules, [{ path: "ventes", title: "Ventes" }, { path: "conseil", title: "Conseil" }, ...nodes])
}

/** Écritures parties vers la base, par l'une ou l'autre face : insertions, mises à jour, suppressions, `open_draft`, `publish_node`. */
const writes = (calls: SpiedCall[]) => calls.filter(isWrite)

/** Une insertion dans `table` par la face SQL, son verbe en tête (`insert into platform.nodes …`) : `write-result.ts` et `store.ts` écrivent ainsi (partie b2). */
const inserts = (call: SpiedCall, table: string) => call.kind === "sql" && new RegExp(`^\\s*insert\\s+into\\s+platform\\.${table}\\b`, "i").test(call.text)

/** `ventes/devis` publiée en révision `revision` : Objet, un paragraphe, Étapes, Cas particulier. */
function devis(revision = 1): Tables {
  const tables = base([{ path: "ventes/devis", title: "Devis", revision }])
  addBlocks(tables, "ventes/devis", "published", [heading("Objet", 1, "objet"), paragraph("Relancer un devis resté sans réponse."), heading("Étapes", 1, "etapes"), heading("Cas particulier", 2), paragraph("Requalifier.")])
  return tables
}

/** Une ligne de `blocks` relue par la connexion d'administration. */
type BlockRow = { id: string; type: string; text: string | null; key: string | null; position: number | null; revision: number; provenance: Record<string, unknown>; created_by: string | null; updated_by: string | null }

describe.skipIf(!sqlConfigured)(portable("write on a real database"), { timeout: NETWORK_TIMEOUT }, () => {
  let seed: SeededData
  let ref: ReferenceOrgSql

  beforeAll(async () => {
    seed = seedWithAdmin()
    ref = await seedReferenceOrg(seed)
  }, SETUP_TIMEOUT)

  afterAll(async () => {
    await seed?.cleanup()
  }, SETUP_TIMEOUT)

  /** L'identité de la personne dans O, préfixe `acme` des textes servis (l'organisation simulée, son identifiant réel). */
  const who = (person: Person) => ref.identityOf(person, { org: identityOf(person).org })
  const content = (tables: Tables) => replaceContent(seed, ref, tables)

  /**
   * Une écriture de Léa ou d'un autre ; `write` publiant par défaut (E11-S02, AC-b1), les cas qui regardent le
   * brouillon passent `publish: false`, sauf entrée qui nomme `publish` ou `asIs` (le défaut lui-même).
   */
  async function write(person: Person, input: Record<string, unknown>, options: { hook?: SpyHook; origin?: WriteOrigin; asIs?: boolean } = {}) {
    const spied = spyDb(await ref.db(person), options.hook)
    const body = options.asIs || "publish" in input ? input : { ...input, publish: false }
    const output = await writeNode(spied.db, who(person), body, options.origin ?? AGENT).then(
      (result) => ({ result, error: null }),
      (error: unknown) => ({ result: null, error }),
    )
    return { ...output, calls: spied.calls }
  }

  /** Le nœud de O à ce chemin, semé ou créé par le service, relu par la connexion d'administration. */
  async function nodeRow(path: string): Promise<Record<string, unknown> | undefined> {
    const [row] = await seed.admin<Record<string, unknown>[]>`
      select id, org_id, parent_id, path, kind, title, summary, status, revision, owner_kind, created_by, updated_by
        from platform.nodes where org_id = ${ref.org.id} and path = ${path}`
    return row
  }

  /** Les blocs d'un état d'un nœud de O, dans l'ordre du document. */
  async function blockRows(path: string, state: "published" | "draft"): Promise<BlockRow[]> {
    return seed.admin<BlockRow[]>`
      select b.id, b.type, b.text, b.key, b.position, b.revision, b.provenance, b.created_by, b.updated_by
        from platform.blocks b join platform.nodes n on n.id = b.node_id
       where n.org_id = ${ref.org.id} and n.path = ${path} and b.state = ${state}
       order by b.position, b.id`
  }

  /** Les brouillons ouverts des nœuds de O : ce que la base simulée gardait dans `node_drafts`. */
  async function draftsOfO(): Promise<Record<string, unknown>[]> {
    return seed.admin<Record<string, unknown>[]>`
      select d.node_id, d.base_revision, d.title, d.summary, d.kind, d.updated_by, to_json(d.updated_at) #>> '{}' as updated_at
        from platform.node_drafts d join platform.nodes n on n.id = d.node_id
       where n.org_id = ${ref.org.id} order by n.path`
  }

  describe("write — creation (AC19, AC20)", () => {
    it("should create a draft at revision 0 under the inherited owner, open its draft and write its blocks (AC19)", async () => {
      const input = { path: "ventes/cr_test", kind: "page", title: "CR de test", summary: "Compte rendu de test", ops: [{ op: "add_section", section: "Décisions", text: "Lancer la pré-étude." }] }
      await content(base())
      const lea = await write("lea", input)
      expect(lea.result?.text).toBe(
        'Draft of ventes/cr_test created (revision 0): added « Décisions » (34 characters).\nPublish it with acme_write {"path": "ventes/cr_test", "base_revision": 0, "publish": true}.',
      )
      // Le nœud inséré, tel que le service l'a écrit : ses colonnes, et celles que la base pose (brouillon, révision 0, propriétaire hérité).
      const node = await nodeRow("ventes/cr_test")
      expect(ref.readable(node)).toMatchObject({
        org_id: "org-acme",
        parent_id: nodeId("ventes"),
        path: "ventes/cr_test",
        kind: "page",
        title: "CR de test",
        summary: "Compte rendu de test",
        created_by: "user-lea",
        updated_by: "user-lea",
        status: "draft",
        revision: 0,
        owner_kind: null,
      })
      expect(functionCalls(lea.calls, "open_draft")).toHaveLength(1)
      const drafts = await draftsOfO()
      expect(drafts).toMatchObject([{ node_id: node?.id, base_revision: 0 }])
      const drafted = await blockRows("ventes/cr_test", "draft")
      expect(drafted.map((row) => [row.type, row.text, row.position])).toEqual([["heading", "Décisions", 1024], ["paragraph", "Lancer la pré-étude.", 2048]])
      expect(await blockRows("ventes/cr_test", "published")).toEqual([])
      const [first, second] = drafted
      expect(lea.result?.data).toEqual({
        path: "ventes/cr_test",
        revision: 0,
        status: "draft",
        has_draft: true,
        touched: [{ op: "add_section", text: "added « Décisions » (34 characters)", blocks: [first, second].map((row) => ({ id: row.id, ref: String(row.id).slice(0, 8), revision: 1 })) }],
        blocks_total: 2,
        // Le tampon du brouillon relu après l'écriture, une garde (l'écran le rend pour écrire l'en-tête) : le
        // texte exact de `node_drafts.updated_at` relu par `to_json`, que PostgREST écrit de même, microsecondes
        // comprises ; une valeur coupée à la milliseconde ne le passerait pas.
        draft_stamp: drafts[0]?.updated_at,
      })
      expect([lea.result?.nextActions, lea.result?.target, lea.result?.teamId]).toEqual([["acme_read"], "ventes/cr_test", ref.id(TEAMS.ventes.id)])
      await content(base())
      const claire = await write("claire", input)
      expect(claire.result?.text.split("\n")[1]).toBe('Publish it with acme_write {"path": "ventes/cr_test", "base_revision": 0, "publish": true}.')
      await content(base())
      const empty = await write("lea", { path: "ventes/cr_vide", title: "CR", summary: "Vide" })
      expect(empty.result?.text.split("\n")[0]).toBe("Draft of ventes/cr_vide created (revision 0): no content yet.")
    })

    it("should publish a creation by default, at the write level, and say the base_revision of the next write (E11-S02, AC-b1)", async () => {
      const input = { path: "ventes/cr_test", kind: "page", title: "CR de test", summary: "Compte rendu de test", ops: [{ op: "add_section", section: "Décisions", text: "Lancer la pré-étude." }] }
      await content(base())
      const lea = await write("lea", input, { asIs: true })
      expect(lea.result?.text).toBe(
        // Une ligne, sans brouillon (E11-S18, AC-4).
        "Published ventes/cr_test revision 1 (1 section, 2 blocks): added « Décisions » (34 characters). Next write: base_revision 1.",
      )
      expect(lea.result?.data).toMatchObject({ path: "ventes/cr_test", revision: 1, status: "published", has_draft: false, draft_stamp: null })
      expect(await nodeRow("ventes/cr_test")).toMatchObject({ status: "published", revision: 1 })
      expect(await draftsOfO()).toEqual([])
      expect((await blockRows("ventes/cr_test", "published")).map((row) => row.text)).toEqual(["Décisions", "Lancer la pré-étude."])
    })

    it("should refuse a creation without header, under a missing, reserved or occupied path, and a table or a header (AC20)", async () => {
      const refused = async (person: Person, input: Record<string, unknown>) => {
        const outcome = await write(person, input)
        expect(writes(outcome.calls), JSON.stringify(input)).toEqual([])
        return outcome.error
      }
      const create = (path: string, extra: Record<string, unknown> = {}) => ({ path, title: "T", summary: "S", ...extra })
      await content(base())
      expect(await refused("lea", { path: "ventes/x9", title: "T" })).toMatchObject({
        code: "invalid_arguments",
        message: "ventes/x9 does not exist: give title and summary (one line, 200 characters max) to create it.",
      })
      expect(parseInput(inputSchemas("acme").write, { ctx: "AAAA-BBBB", ...create("ventes/x9"), summary: "s".repeat(201) })).toMatchObject({ issues: expect.stringMatching(/^summary: /) })
      expect(await refused("lea", create("ventes/x9", { title: "a\nb" }))).toMatchObject({ code: "invalid_arguments", message: "title and summary hold on one line (no line break)." })
      expect(await refused("lea", create("ventes/clients/acme"))).toMatchObject({
        code: "not_found",
        message: "Cannot create ventes/clients/acme: its parent ventes/clients does not exist. Closest existing page: ventes. Create ventes/clients first, or choose a path under ventes.",
      })
      expect(await refused("paul", create("ventes/nouveau"))).toMatchObject({
        message: "Cannot create ventes/nouveau: its parent ventes does not exist. Closest existing page: guide. Create ventes first, or choose a path under guide.",
      })
      expect(await refused("lea", create("guide/x"))).toMatchObject({
        code: "invalid_arguments",
        message: "guide is the organisation's guide, the root of the tree: its children have paths without prefix, e.g. ventes/notes.",
      })
      expect(await refused("marc", create("conseil/nouveau"))).toMatchObject({
        code: "forbidden",
        message: "Writing under conseil is reserved to the administrators of Acme Test (Ada Martin). Ask them for access.",
      })
      const occupied = { code: "conflict", message: "Path ventes/confidentiel is not available: a content holds it (perhaps one you cannot see), a moved content had it, or the name is reserved. Choose another path." }
      await content(base([{ path: "ventes/confidentiel" }], [{ node: "ventes/confidentiel", user: "lea", level: "none" }]))
      expect(await refused("lea", create("ventes/confidentiel"))).toMatchObject(occupied)
      // Une autre personne prend le chemin entre le contrôle du service et son insertion : la base la refuse (23505).
      await content(base())
      const race = await write("lea", create("ventes/confidentiel"), {
        hook: async (call) => {
          if (inserts(call, "nodes")) await ref.addNodes([{ path: "ventes/confidentiel" }])
        },
      })
      expect(race.error).toMatchObject(occupied)
      // Un tableau se crée avec son en-tête (E07-S04, AC2) : sans lui, rien n'est écrit.
      expect(await refused("lea", create("ventes/tableau", { kind: "table" }))).toMatchObject({
        code: "invalid_arguments",
        message: 'Creating a table needs header {columns, key}: read the contract with acme_read {"path": "write.table"}.',
      })
      expect(await refused("lea", create("ventes/x9", { header: {} }))).toMatchObject({ message: "header applies only to tables; ventes/x9 is a page." })
      expect(await refused("lea", create("ventes/x9", { kind: "procedure", header: {} }))).toMatchObject({ message: "header applies only to tables; ventes/x9 is a procedure." })
    })

    it("should leave neither node nor draft when a creation stops after its first writes, and let it be replayed (AC-x4)", async () => {
      const input = { path: "ventes/cr_test", kind: "page", title: "CR de test", summary: "Compte rendu de test", ops: [{ op: "add_section", section: "Décisions", text: "Lancer la pré-étude." }] }
      await content(base())
      // Le nœud inséré et son brouillon ouvert, l'insertion de ses blocs tombe en panne : tout est annulé.
      const failed = await write("lea", input, { hook: (call) => (inserts(call, "blocks") ? { code: "57014" } : null) })
      expect(failed.error).toMatchObject({ code: "internal", message: "Internal error." })
      expect([failed.calls.filter((call) => inserts(call, "nodes")).length, functionCalls(failed.calls, "open_draft").length]).toEqual([1, 1])
      expect([await nodeRow("ventes/cr_test"), await draftsOfO()]).toEqual([undefined, []])
      // Rejouée (« Retry once » du MCP), la création passe, sans rien en double.
      const replayed = await write("lea", input)
      expect(replayed.error).toBeNull()
      expect((await blockRows("ventes/cr_test", "draft")).map((row) => row.text)).toEqual(["Décisions", "Lancer la pré-étude."])
    })
  })

  describe("write — edits (AC21, AC26, AC27, AC28)", () => {
    it("should leave no draft open when an edit stops after opening it: the draft opens in the transaction of the write (AC-x4, M32)", async () => {
      await content(devis(1))
      // Aucun brouillon au départ : l'écriture l'ouvre, puis l'écriture de ses blocs tombe en panne.
      const writesBlocks = (call: SpiedCall) => call.kind === "sql" && /^\s*(insert\s+into|update)\s+platform\.blocks\b/i.test(call.text)
      const failed = await write("lea", { path: "ventes/devis", base_revision: 1, ops: [{ op: "append", section: "Objet", text: "Relancer." }] }, {
        hook: (call) => (writesBlocks(call) ? { code: "57014" } : null),
      })
      expect(failed.error).toMatchObject({ code: "internal", message: "Internal error." })
      expect(functionCalls(failed.calls, "open_draft")).toHaveLength(1)
      expect(await draftsOfO()).toEqual([])
    })

    it("should refuse a missing or stale revision with the current state, and a reader, writing nothing (AC21)", async () => {
      const state = [
        "# Devis (revision 4, published)",
        "- Objet (47 characters)",
        "- Étapes (44 characters)",
        "  - Cas particulier (33 characters)",
        "Read what you need, then write again with base_revision 4.",
      ].join("\n")
      const op = { op: "append", section: "Objet", text: "x" }
      await content(devis(4))
      const missing = await write("lea", { path: "ventes/devis", ops: [op] })
      expect(missing.error).toMatchObject({
        code: "stale_revision",
        message: `stale revision: ventes/devis is at revision 4 and base_revision is missing. Nothing was written. Current state:\n${state}`,
        details: { revision: 4 },
      })
      const stale = await write("lea", { path: "ventes/devis", base_revision: 3, ops: [op] })
      expect(stale.error).toMatchObject({ message: `stale revision: ventes/devis is at revision 4, not 3. Nothing was written. Current state:\n${state}` })
      await content(base([{ path: "conseil/methode_etude" }]))
      const marc = await write("marc", { path: "conseil/methode_etude", base_revision: 1, ops: [op] })
      expect(marc.error).toMatchObject({
        code: "forbidden",
        message: "Writing conseil/methode_etude is reserved to the administrators of Acme Test (Ada Martin). Ask them for access.",
      })
      for (const outcome of [missing, stale, marc]) expect(writes(outcome.calls)).toEqual([])
    })

    it("should write nothing at all when an operation is refused, on a page or a creation (AC22, AC23)", async () => {
      const unknown = { op: "append", section: "Budget", text: "x" }
      const refusal = { code: "invalid_arguments", message: "Op 1 (append « Budget »): unknown section « Budget ». Sections: « Objet », « Étapes », « Cas particulier ». Nothing was written." }
      // Ni `open_draft` sur la page sans brouillon, ni nœud en révision 0 pour une création refusée.
      await content(devis())
      const edit = await write("lea", { path: "ventes/devis", base_revision: 1, ops: [unknown] })
      await content(base())
      const creation = await write("lea", { path: "ventes/cr_x", title: "CR", summary: "CR.", ops: [{ op: "add_section", section: "A", text: "# Titre" }] })
      expect([edit.error, writes(edit.calls)]).toMatchObject([refusal, []])
      expect([creation.error, writes(creation.calls)]).toMatchObject([{ code: "invalid_arguments", message: expect.stringMatching(/^Op 1 \(add_section « A »\): line 1 /) }, []])
    })

    it("should refuse a write with nothing to write (AC26 ; E11-S02, AC-b3)", async () => {
      await content(devis())
      for (const input of [{ path: "ventes/devis", base_revision: 1 }, { path: "ventes/devis", base_revision: 1, ops: [] }]) {
        expect((await write("lea", input)).error).toMatchObject({
          code: "invalid_arguments",
          message: "Nothing to write: give ops, title, summary or header.",
        })
        // Sans `publish: false`, `write` publie le brouillon en attente : ici, aucun.
        const published = await write("lea", input, { asIs: true })
        expect([published.error, writes(published.calls)]).toMatchObject([{ code: "invalid_arguments", message: "Nothing to publish: ventes/devis has no pending draft." }, []])
      }
    })

    it("should keep the title, summary and kind pending in node_drafts, and refuse what a kind forbids (AC27)", async () => {
      await content(devis())
      const lea = await write("lea", { path: "ventes/devis", base_revision: 1, title: "Relance d'un devis", summary: "Relancer un devis." })
      expect(lea.result?.text).toBe(
        'Draft of ventes/devis saved on revision 1: title « Relance d\'un devis », summary « Relancer un devis. ».\nPublish it with acme_write {"path": "ventes/devis", "base_revision": 1, "publish": true}.',
      )
      expect(ref.readable(await draftsOfO())).toMatchObject([{ node_id: "node:ventes/devis", title: "Relance d'un devis", summary: "Relancer un devis.", updated_by: "user-lea" }])
      expect(await nodeRow("ventes/devis")).toMatchObject({ title: "Devis" })
      await content(devis())
      await write("lea", { path: "ventes/devis", base_revision: 1, kind: "procedure" })
      expect(await draftsOfO()).toMatchObject([{ kind: "procedure" }])
      const tables = base([{ path: "ventes/suivi", kind: "table" }, { path: "ventes/proc", kind: "procedure" }])
      const cases: [Record<string, unknown>, string, string][] = [
        [{ path: "ventes/suivi", kind: "page" }, "invalid_arguments", "ventes/suivi is a table: its kind cannot change."],
        [{ path: "ventes/devis", kind: "table" }, "invalid_arguments", "A page cannot become a table: create the table at a new path."],
        [{ path: "ventes/suivi", ops: [{ op: "append", section: "x", text: "y" }] }, "invalid_arguments", "ventes/suivi is a table: it has no sections. Write its rows with acme_call table.write."],
        // Un en-tête vide ne change rien au tableau (E07-S04) : rien à écrire.
        [{ path: "ventes/suivi", header: {} }, "invalid_arguments", "Nothing to write: give ops, title, summary or header."],
        [{ path: "ventes/devis", header: {} }, "invalid_arguments", "header applies only to tables; ventes/devis is a page."],
        [{ path: "ventes/proc", header: {} }, "invalid_arguments", "header applies only to tables; ventes/proc is a procedure."],
        [{ path: "ventes/contexte", header: {} }, "invalid_arguments", "header applies only to tables; ventes/contexte is a context page."],
        [{ path: "ventes/contexte", kind: "procedure" }, "invalid_arguments", "ventes/contexte is a context page: its kind cannot change."],
      ]
      await content(tables)
      for (const [input, code, message] of cases) {
        expect((await write("claire", { base_revision: 1, ...input })).error, message).toMatchObject({ code, message })
      }
      // Le titre en attente d'un tableau ne touche pas ses lignes : elles ne passent jamais par le brouillon.
      await ref.write({ blocks: [{ id: "row-1", state: "published", org_id: "org-acme", node_id: "node:ventes/suivi", position: null, type: "row", text: null, data: {}, key: "P-001", provenance: {}, revision: 1 }] })
      const titled = await write("claire", { path: "ventes/suivi", base_revision: 1, title: "Suivi des prospects" })
      expect([titled.error, ref.readable(await draftsOfO())]).toMatchObject([null, [{ node_id: "node:ventes/suivi", title: "Suivi des prospects" }]])
      expect(titled.calls.filter((call) => isWrite(call) && touches(call, "blocks"))).toEqual([])
    })

    it("should mark what an assistant or a person writes, bump the revision on content only, and write well-formed text (AC28)", async () => {
      const tables = devis()
      const [objet, , etapes] = tables.blocks.map((row) => String(row.id))
      const ops = [
        { op: "replace_block", block: "objet", text: "## Objet du devis" },
        { op: "move_block", block: "etapes" },
        { op: "append", section: "Objet du devis", text: "Demi \ud83d paire." },
      ]
      await content(tables)
      const lea = ref.people.lea.id
      const agent = await write("lea", { path: "ventes/devis", base_revision: 1, ops })
      expect(agent.error).toBeNull()
      const drafted = await blockRows("ventes/devis", "draft")
      const published = await blockRows("ventes/devis", "published")
      // Le contenu changé : révision + 1, écrit par Léa, provenance de l'assistant.
      const replaced = drafted.find((row) => row.id === ref.id(objet))
      expect(replaced).toMatchObject({ text: "Objet du devis", revision: 2, updated_by: lea })
      expect(replaced?.provenance).toEqual({ origin: "agent", by: lea, ctx: "7K3Q-M2XA", at: expect.any(String) })
      // Le bloc déplacé seulement : sa place change, rien d'autre (la mise à jour n'envoie que `position`), ni sa
      // révision, ni sa provenance, ni l'auteur de sa dernière écriture.
      const before = published.find((row) => row.id === ref.id(etapes))
      const moved = drafted.find((row) => row.id === ref.id(etapes))
      expect(moved?.provenance).toEqual({})
      expect(moved).toEqual({ ...before, position: expect.any(Number) })
      expect(moved?.position).not.toBe(before?.position)
      // Le bloc neuf, au texte bien formé (moitié de paire remplacée).
      const inserted = drafted.filter((row) => !published.some((old) => old.id === row.id))
      expect(inserted).toEqual([
        expect.objectContaining({ text: "Demi � paire.", created_by: lea, updated_by: lea, provenance: expect.objectContaining({ origin: "agent", ctx: "7K3Q-M2XA" }) }),
      ])
      const humanTables = devis()
      await content(humanTables)
      const human = await write("lea", { path: "ventes/devis", base_revision: 1, ops: [ops[0]] }, { origin: { kind: "human" } })
      expect(human.error).toBeNull()
      // Par l'écran, la provenance d'une personne : ni `ctx`, ni rien d'autre.
      const byHand = (await blockRows("ventes/devis", "draft")).find((row) => row.id === ref.id(String(humanTables.blocks[0].id)))
      expect(byHand?.provenance).toEqual({ origin: "human", by: lea, at: expect.any(String) })

      // Par l'API, `revision` et `input` passent le corps (`writeNodeBodySchema`) jusqu'au service (AC24, AC37).
      const screen = { origin: { kind: "human" } as const }
      const checklist = { type: "checklist", data: { items: [{ text: "Relire", checked: true }] } }
      const aimed = (revision: number, input: Record<string, unknown>) => ({ path: "ventes/devis", base_revision: 1, ops: [{ op: "replace_block", block: ref.id(objet), revision, input }] })
      await content(tables)
      const saved = await write("lea", aimed(1, checklist), screen)
      expect(saved.error).toBeNull()
      expect((await blockRows("ventes/devis", "draft")).find((row) => row.id === ref.id(objet))).toMatchObject({ type: "checklist", text: null, key: null, revision: 2 })
      await content(tables)
      expect((await write("lea", aimed(2, checklist), screen)).error).toMatchObject({
        code: "stale_revision",
        message: "stale revision: block objet of ventes/devis is at revision 1, not 2. Nothing was written. Read it again, then retry.",
        details: { revision: 1 },
      })
      const invalid = await write("lea", aimed(1, { type: "heading", text: "Titre", data: { level: 9 } }), screen)
      expect([invalid.error, writes(invalid.calls)]).toMatchObject([{ code: "invalid_arguments", message: expect.stringMatching(/^Invalid arguments: ops\.0\.input/) }, []])
    })
  })

  describe("write — operations per call, decided by the door (E11-S17, AC-a6, fiche D153)", () => {
    /** Une création de `count` paragraphes, chacun inséré en tête par sa propre opération. */
    const lot = (path: string, count: number) => ({
      path,
      title: "Lot",
      summary: "Lot de blocs.",
      ops: Array.from({ length: count }, (_, rank) => ({ op: "insert_after", text: `Bloc ${rank + 1}.` })),
    })
    const screen = { origin: { kind: "human" } as const }

    it("should take from the screen as many operations as a page holds blocks, in one write, and 50 from an assistant", async () => {
      await content(base())
      // L'écran : 51, puis 1 000 opérations passent, chacune en une écriture ; 1 001 sont refusées sans rien écrire.
      expect((await write("lea", lot("ventes/lot_51", 51), screen)).error).toBeNull()
      expect(await blockRows("ventes/lot_51", "draft")).toHaveLength(51)
      expect((await write("lea", lot("ventes/lot_1000", BLOCKS_MAX), screen)).error).toBeNull()
      expect(await blockRows("ventes/lot_1000", "draft")).toHaveLength(BLOCKS_MAX)
      const beyond = await write("lea", lot("ventes/lot_1001", BLOCKS_MAX + 1), screen)
      expect([beyond.error, writes(beyond.calls)]).toMatchObject([
        { code: "invalid_arguments", message: "1,001 operations; 1,000 at most per call: split them over several calls." },
        [],
      ])
      // Un assistant (`write` du MCP) : 51 opérations refusées, rien d'écrit.
      const agent = await write("lea", lot("ventes/lot_agent", 51))
      expect([agent.error, writes(agent.calls)]).toMatchObject([{ code: "invalid_arguments", message: "51 operations; 50 at most per call: split them over several calls." }, []])
      expect(await nodeRow("ventes/lot_agent")).toBeUndefined()
    })
  })

  /** Les textes des blocs publiés d'un nœud de O, dans l'ordre du document. */
  async function publishedTexts(path: string): Promise<(string | null)[]> {
    const rows = await seed.admin<{ text: string | null }[]>`
      select b.text from platform.blocks b join platform.nodes n on n.id = b.node_id
       where n.org_id = ${ref.org.id} and n.path = ${path} and b.state = 'published' order by b.position, b.id`
    return rows.map((row) => row.text)
  }

  describe("inserted blocks read back by rank (E11-S18, AC-8, FB-0015)", () => {
    it("should add a section after another even when the database reads positions back rounded", async () => {
      await content(shortDevis())
      const db = roundingPositions(await ref.db("lea"))
      const input = { path: "ventes/devis", base_revision: 1, ops: [{ op: "add_section", section: "Contexte", text: "Client fidèle.", after: "Objet" }] }
      const result = await writeNode(db, who("lea"), input, AGENT_WITHOUT_CTX)
      expect(result.text.split("\n")[0]).toMatch(/^Published ventes\/devis revision 2 /)
      expect(await publishedTexts("ventes/devis")).toEqual(["Objet", "Relancer.", "Contexte", "Client fidèle.", "Étapes", "Lire."])
    })
  })

  /** Le nœud de O à ce chemin, et ses brouillons ouverts, relus par la connexion d'administration. */
  async function nodeState(path: string): Promise<{ exists: boolean; drafts: number }> {
    const [row] = await seed.admin<{ nodes: number; drafts: number }[]>`
      select (select count(*)::int from platform.nodes n where n.org_id = ${ref.org.id} and n.path = ${path}) as nodes,
             (select count(*)::int from platform.node_drafts d join platform.nodes n on n.id = d.node_id
               where n.org_id = ${ref.org.id} and n.path = ${path}) as drafts`
    return { exists: row.nodes > 0, drafts: row.drafts }
  }

  const settle = <T>(promise: Promise<T>) =>
    promise.then(
      () => null,
      (error: unknown) => error,
    )

  /** Un bloc `call` d'une fonction inconnue : la publication d'une procédure le refuse (E03-S06). */
  const unknownCall = "1. Lis :\n\n```call\nx.unknown {}\n```"

  // Revue E11-S18 : la branche d'un `returning` qui ne redonne pas les blocs envoyés (autre ordre, donc autre genre).
  describe("inserted blocks that do not match what was sent (E11-S18, AC-8)", () => {
    it("should refuse with conflict, log the mismatch, and write nothing", async () => {
      await content(shortDevis())
      const logged = vi.spyOn(console, "error").mockImplementation(() => undefined)
      try {
        const insertsBlocks = (call: DbCall) => call.kind === "sql" && /^\s*insert\s+into\s+platform\.blocks\b/i.test(call.text)
        const { db } = watchDb(await ref.db("lea"), { reverse: insertsBlocks })
        const input = { path: "ventes/devis", base_revision: 1, ops: [{ op: "add_section", section: "Contexte", text: "Client fidèle.", after: "Objet" }] }
        expect(await settle(writeNode(db, who("lea"), input, AGENT_WITHOUT_CTX))).toMatchObject({
          code: "conflict",
          message: "ventes/devis: the new blocks could not be matched once written. Nothing was written. Retry the write; if it fails again, report it with acme_feedback (type error).",
        })
        expect(loggedText(logged)).toContain("2 blocks inserted, 2 rows returned in another shape")
        expect(await nodeState("ventes/devis")).toEqual({ exists: true, drafts: 0 })
      } finally {
        logged.mockRestore()
      }
    })
  })

  describe("a refused publication writes nothing for an assistant (E11-S18, AC-1, AC-3)", () => {
    it("should create no node and keep no draft for an assistant, and keep the draft of the screen", async () => {
      await content(shortDevis())
      const db = await ref.db("lea")
      const created = { path: "ventes/relance", kind: "procedure", title: "Relance", summary: "Relance un devis.", ops: [{ op: "add_section", section: "Étapes", text: unknownCall }] }
      expect(await settle(writeNode(db, who("lea"), created, AGENT_WITHOUT_CTX))).toMatchObject({ code: "invalid_arguments", message: expect.stringContaining("refused: 1 problem(s). Nothing was written.\n") })
      expect(await nodeState("ventes/relance")).toEqual({ exists: false, drafts: 0 })

      const edited = { path: "ventes/devis", base_revision: 1, kind: "procedure", ops: [{ op: "add_section", section: "Appel", text: unknownCall }] }
      expect(await settle(writeNode(db, who("lea"), edited, AGENT_WITHOUT_CTX))).toMatchObject({ code: "invalid_arguments" })
      expect(await nodeState("ventes/devis")).toEqual({ exists: true, drafts: 0 })
      // L'écran garde la frappe d'une personne (AC-3).
      expect(await settle(writeNode(db, who("lea"), edited, { kind: "human" }))).toMatchObject({ code: "invalid_arguments" })
      expect(await nodeState("ventes/devis")).toEqual({ exists: true, drafts: 1 })
    })
  })

  describe("node.move (E11-S18, AC-5)", () => {
    it("should move a page with its sub-page into a folder, the old path kept, and refuse to move a Contexte", async () => {
      const tables = contentTables([], [
        { path: "ventes", title: "Ventes" },
        { path: "ventes/devis", title: "Devis" },
        { path: "ventes/devis/annexe", title: "Annexe" },
        { path: "ventes/dossiers", title: "Dossiers" },
      ])
      await content(tables)
      const context: FunctionContext = { db: await ref.db("claire"), identity: who("claire"), ctx: null }
      // `run` reçoit des arguments que `call` a validés ; son type commun du catalogue les efface (`never`).
      const moved = await nodeMove.run(context, { path: "ventes/devis", new_path: "ventes/dossiers/devis" } as never)
      // `ventes/devis/modele` est un nœud de la graine de référence : il suit aussi.
      expect(moved.text).toBe(
        [
          "Moved ventes/devis to ventes/dossiers/devis with its descendants:",
          "- ventes/devis → ventes/dossiers/devis",
          "- ventes/devis/annexe → ventes/dossiers/devis/annexe",
          "- ventes/devis/modele → ventes/dossiers/devis/modele",
          "The old paths stay valid: tools called with them are redirected.",
        ].join("\n"),
      )
      expect(await nodeState("ventes/dossiers/devis/annexe")).toEqual({ exists: true, drafts: 0 })
      const aliases = await seed.admin<{ old_path: string }[]>`select old_path from platform.node_aliases where org_id = ${ref.org.id} order by old_path`
      expect(aliases.map((row) => row.old_path)).toEqual(["ventes/devis", "ventes/devis/annexe", "ventes/devis/modele"])
      // Refus de `moveNode`, tel quel (AC9 d'E03-S07).
      expect(await settle(nodeMove.run(context, { path: "ventes/contexte", new_path: "ventes/dossiers/contexte" } as never))).toMatchObject({
        code: "invalid_arguments",
        message: "ventes/contexte cannot move: a Contexte stays at the head of its team; move the pages inside it instead.",
      })
    })
  })

  describe("node.write_many (E11-S18, AC-12)", () => {
    it("should write the pages in order, each whole or not at all, one line per page, a refusal not stopping the next ones", async () => {
      await content(shortDevis())
      const context: FunctionContext = { db: await ref.db("lea"), identity: who("lea"), ctx: null }
      const pages = [
        { path: "ventes/absent/page", kind: "page", title: "Page", summary: "Sous un parent absent." },
        { path: "ventes/fiches", kind: "page", title: "Fiches", summary: "Les fiches." },
        { path: "ventes/fiches/garantie", kind: "page", title: "Garantie", summary: "La garantie.", ops: [{ op: "set_markdown", text: "---\ntitle: Garantie\n---\n\n## Durée\n\nDeux ans." }] },
      ]
      // `run` reçoit des arguments que `call` a validés ; son type commun du catalogue les efface (`never`).
      const many = await nodeWriteMany.run(context, { pages } as never)
      expect(many.text.split("\n")).toEqual([
        "2 of 3 pages written, 1 refused.",
        expect.stringMatching(/^1\. ventes\/absent\/page refused \(not_found\): Cannot create ventes\/absent\/page: its parent ventes\/absent does not exist\./),
        "2. Published ventes/fiches revision 1 (0 sections, 0 blocks). Next write: base_revision 1.",
        expect.stringMatching(/^3\. Published ventes\/fiches\/garantie revision 1 \(1 section, 2 blocks\): replaced the whole body \(1 section, [0-9]+ characters\)\. Next write: base_revision 1\.$/),
      ])
      expect(many.data?.pages).toEqual([
        { path: "ventes/absent/page", status: "refused", code: "not_found", message: expect.any(String) },
        { path: "ventes/fiches", status: "published", revision: 1 },
        { path: "ventes/fiches/garantie", status: "published", revision: 1 },
      ])
      expect(await publishedTexts("ventes/fiches/garantie")).toEqual(["Durée", "Deux ans."])
    })

    // Comme `write` : une clé mal nommée dans une opération est refusée, l'opération ne part pas sans elle.
    it("should refuse an unknown key inside an operation of a page, naming where it is", () => {
      const page = { path: "ventes/fiches", ops: [{ op: "append", section: "Notes", content: "x" }] }
      const refused = writeManyArgsSchema.safeParse({ pages: [page] })
      expect(refused.success ? [] : refused.error.issues.map((issue) => [issue.code, issue.path.join(".")])).toEqual([["unrecognized_keys", "pages.0.ops.0"]])
      expect(writeManyArgsSchema.safeParse({ pages: [{ path: "ventes/fiches", ops: [{ op: "append", section: "Notes", text: "x" }] }] }).success).toBe(true)
    })
  })

  describe("the author of a Contexte keeps their ctx (E11-S18, AC-14)", () => {
    it("should advance the ctx of the call to the published revision, and say that only the other conversations get the change", async () => {
      const tables = shortDevis()
      addBlocks(tables, "ventes/contexte", "published", [heading("Ton"), paragraph("Tutoyer.")])
      await content(tables)
      const db = await ref.db("lea")
      const lea = who("lea")
      const code = await issueCtx(db, lea, { host: null, userAgent: null })
      const written = await writeNode(db, lea, { path: "ventes/contexte", base_revision: 1, ops: [{ op: "append", section: "Ton", text: "Signer Léa." }] }, { kind: "agent", ctx: code })
      expect(written.text.split("\n")[1]).toBe(
        "Context ventes/contexte changed: every other conversation it was served to gets it, with a new ctx, on its next call; this one keeps its ctx.",
      )
      await expect(requireCtx(db, lea, code)).resolves.toMatchObject({ code })
    })
  })
})
