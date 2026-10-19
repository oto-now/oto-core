// @vitest-environment node
// Procédures (E03-S06, AC2, AC5, AC6, AC9, AC10, AC13) : publication par le service d'E03-S03 (`writeNode`
// avec `publish: true`), contrôle et liste de l'écran d'E05-S04, sur la base réelle (E01-S10, lot t1-e2b2) :
// O semée une fois (`seedReferenceOrg`, `tests/helpers/reference-org-sql.ts`), chaque test y ajoutant ses
// nœuds, règles, brouillons et blocs, retirés après lui ; les services sous le client de la personne
// (`ref.db`), chaque requête vue par `watchDb` (`tests/helpers/spy-t1-e2b2.ts`). Avec la seule
// isolation (E01-S08), la base rend toute ligne de O que les filtres demandent, brouillons compris : chaque
// filtre et chaque refus sont prouvés par le service (`security-patterns.md § Droits dans le service`).
// Catalogue réel complété par celui de `tests/factories/test-functions.ts`. `open_draft` et `publish_node`
// sont les vraies fonctions ; leurs effets en base (atomicité, instantané) sont la règle d'E01-S06,
// prouvée par ses tests.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import type { BlockInput } from "../../packages/plateforme/schemas"
import { writeNode, type WriteOrigin } from "../../packages/plateforme/server/nodes/write"
import { checkProcedure, listProcedures } from "../../packages/plateforme/server/procedures"
import { BUSY_REFUSAL } from "../factories/test-functions"
import { CONTENT_AT, nodeId, ORG, OTHER_ORG, TEAMS, type ContentNode, type Person, type RuleSpec } from "../helpers/reference-org"
import { seedReferenceOrg, type ReferenceOrgSql } from "../helpers/reference-org-sql"
import { callsFunction, isWrite, touches, watchDb, type DbCall, type WatchOptions } from "../helpers/spy-t1-e2b2"
import { sqlConfigured, seedWithAdmin, type SeededData, portable } from "../helpers/sql"

vi.mock("../../packages/plateforme/server/catalog/registry", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../packages/plateforme/server/catalog/registry")>()
  const { TEST_FUNCTIONS } = await import("../factories/test-functions")
  // Le catalogue de l'assistant aussi : les portes qui servent un assistant le lisent (`assistantFunctions`).
  return {
    ...original,
    catalogFunctions: () => [...original.catalogFunctions(), ...TEST_FUNCTIONS],
    assistantFunctions: () => [...original.assistantFunctions(), ...TEST_FUNCTIONS],
  }
})

const NETWORK_TIMEOUT = 60_000
const SETUP_TIMEOUT = 180_000

const heading = (text: string): BlockInput => ({ type: "heading", text, data: { level: 1 } })
const paragraph = (text: string): BlockInput => ({ type: "paragraph", text, data: {} })
const steps = (items: string[], start?: number): BlockInput => ({ type: "list", text: null, data: start === undefined ? { items, ordered: true } : { items, ordered: true, start } })
const callBlock = (fn: string, args: Record<string, unknown> = {}): BlockInput => ({ type: "call", text: null, data: { function: fn, args } })

const PATH = "ventes/relance_test"
const PROCEDURE: ContentNode = { path: PATH, kind: "procedure", title: "Relance de test", summary: "Relance les prospects de test." }
const DRAFT_ARGS = { to: "<email du contact>", subject: "Suite à notre échange", body: "<texte>" }
/** La consigne qui clôt un refus, au préfixe de l'organisation (jetable sur la base réelle). */
// La dernière ligne dit comment écrire en plusieurs appels, `write` publiant par défaut (E11-S02, AC-b2).
const footer = (prefix: string) =>
  `Fix them with ${prefix}_write (ops on the sections), then publish again. Format and rules: ${prefix}_read {"path": "write.procedure"}.\nWriting it in several calls? Pass publish: false until the last one.`
/** Une procédure de P au chemin d'une de O : une lecture qui oublierait l'organisation la listerait. */
const OTHER_PROCEDURE = "other:node:proc"
/** Les tables qu'une publication écrit. */
const CONTENT_TABLES = ["nodes", "blocks", "node_drafts", "node_versions", "links"] as const

/** Un horodatage en instant, quelle que soit sa forme : `…+00:00` de PostgREST, `…000000+00:00` écrit, `Date` de postgres.js. */
const instant = (value: unknown) => (value instanceof Date ? value : new Date(String(value))).toISOString()

/** Écritures parties vers la base, d'une face ou de l'autre : insertions, mises à jour, suppressions, `open_draft`, `publish_node`. */
const writes = (calls: DbCall[]) => calls.filter((call) => isWrite(call) || callsFunction(call, "open_draft") || callsFunction(call, "publish_node"))

const publishCalls = (calls: DbCall[]) => calls.filter((call) => callsFunction(call, "publish_node"))

/**
 * Les arguments d'un appel de `publish_node` : nommés sur la face PostgREST ; sur la face SQL, les valeurs
 * liées dans l'ordre de sa signature (`p_node`, `p_base_revision`, `p_draft_stamp`, `p_links`). Le tampon en
 * instant.
 */
function publishArgs(call: DbCall) {
  const [node, baseRevision, stamp, links] =
    call.kind === "rpc" ? [call.args.p_node, call.args.p_base_revision, call.args.p_draft_stamp, call.args.p_links] : call.kind === "sql" ? call.values : []
  // `p_links` arrive sur la face SQL dans le `Parameter` de `sql.json` (`publish.ts`, partie b2) : sa valeur.
  const bound = links !== null && typeof links === "object" && "type" in links && "value" in links ? links.value : links
  return { node, baseRevision, stamp: instant(stamp), links: bound }
}

/** Les requêtes qui lisent ou écrivent `table`, d'une face ou de l'autre. */
const reads = (calls: DbCall[], table: string) => calls.filter((call) => touches(call, table))

/** Les lectures des blocs d'un brouillon : `draft` lié ou écrit dans l'instruction. */
const draftBlockReads = (calls: DbCall[]) =>
  reads(calls, "blocks").filter((call) => call.kind === "sql" && (call.values.includes("draft") || call.text.includes("'draft'")))

/** Un problème par cas R de la liste exhaustive, sous « Étapes », après une étape numérotée ; son texte au préfixe de O. */
const STEP = [heading("Étapes"), steps(["Fais :"])]
const AT = "section « Étapes », call block 1 (step 1)"
const CASES: { rule: string; blocks: BlockInput[]; active?: string[]; kind: string; problem: (prefix: string) => string }[] = [
  {
    rule: "R1",
    blocks: [heading("Étapes"), paragraph("x".repeat(13_521))],
    kind: "too_long",
    problem: (p) => `steps: 13,532 characters; a procedure is served whole by ${p}_context and holds at most 12,000: move reference material to a page and link to it`,
  },
  {
    rule: "R2 (code block)",
    blocks: [...STEP, { type: "code", text: 'mail.send_draft {"id": "<id>"}', data: { language: " call " } }],
    kind: "invalid_block",
    problem: () => "section « Étapes », code block: this code block is marked call but is plain code, so it was never checked; write it as a call block",
  },
  {
    rule: "R2 (text block)",
    blocks: [...STEP, paragraph('Envoie :\n```call\nmail.send_draft {"id": "<id>"}\n```')],
    kind: "invalid_block",
    problem: () => "section « Étapes », text block: this text holds a call fence but is plain text, so it was never checked; write it as a call block",
  },
  {
    rule: "R4",
    blocks: [...STEP, callBlock("acme_call", { function: "mail.send_draft" })],
    kind: "invalid_block",
    problem: () => `${AT}: a call block starts with a function name such as table.rows, found « acme_call »`,
  },
  {
    rule: "R7",
    blocks: [...STEP, callBlock("mail.send", { id: "<id>" })],
    kind: "unknown_function",
    problem: (p) => `${AT}: unknown function « mail.send »; ${p}_find with type function lists the functions`,
  },
  {
    rule: "R8",
    blocks: [...STEP, callBlock("mail.create_draft", DRAFT_ARGS)],
    active: [],
    kind: "function_not_active",
    problem: () => `${AT}: mail.create_draft belongs to connector mail, which is not enabled for Acme Test; an administrator enables it on the dashboard`,
  },
  {
    rule: "R9 (confirm)",
    blocks: [...STEP, callBlock("mail.send_draft", { id: "<id du brouillon>", confirm: true })],
    kind: "unknown_key",
    problem: (p) =>
      `${AT}: « confirm » is an option of ${p}_call, not an argument of mail.send_draft; say in the step's text to call again with confirm: true after the user's explicit approval`,
  },
  {
    rule: "R9 (team)",
    blocks: [...STEP, callBlock("mail.create_draft", { ...DRAFT_ARGS, team: "ventes" })],
    kind: "unknown_key",
    problem: (p) =>
      `${AT}: « team » is an option of ${p}_call, not an argument of mail.create_draft; the team comes from where the procedure lives, and the account from that team or the organisation`,
  },
  {
    rule: "R9 (envelope)",
    blocks: [...STEP, callBlock("mail.create_draft", { function: "mail.create_draft", ...DRAFT_ARGS })],
    kind: "unknown_key",
    problem: (p) => `${AT}: « function » belongs to the ${p}_call envelope; write only the arguments of mail.create_draft in the block`,
  },
  {
    rule: "R10",
    blocks: [...STEP, callBlock("mail.create_draft", { ...DRAFT_ARGS, destinataire: "sophie@valbrune.test" })],
    kind: "unknown_key",
    problem: () => `${AT}: mail.create_draft has no argument « destinataire »; its arguments: to, subject, body`,
  },
  {
    rule: "R11",
    blocks: [...STEP, callBlock("mail.create_draft", { to: "<email du contact>", body: "<texte>" })],
    kind: "missing_argument",
    problem: () => `${AT}: mail.create_draft needs argument « subject »; write "<…>" for a value known only when the procedure runs`,
  },
  {
    rule: "R12",
    blocks: [...STEP, callBlock("mail.create_draft", { ...DRAFT_ARGS, to: "claire" })],
    kind: "invalid_value",
    problem: () => `${AT}: mail.create_draft argument « to »: Invalid email address (got "claire")`,
  },
  {
    rule: "R13",
    blocks: [...STEP, callBlock("test.release", { table: "ventes/suivi_prospects", key: "<id>", worker: "<ton prénom>", state: "busy" })],
    kind: "check_failed",
    problem: () => `${AT}: test.release: ${BUSY_REFUSAL}`,
  },
]

describe.skipIf(!sqlConfigured)(portable("procedures on the real database, O"), { timeout: NETWORK_TIMEOUT }, () => {
  let seed: SeededData
  let ref: ReferenceOrgSql
  /** Les nœuds qu'un test a ajoutés (identifiants réels), retirés après lui ; les connecteurs actifs de O. */
  let added: string[] = []
  let active: string[] = []

  /** Les connecteurs actifs de O, exactement ceux-ci. */
  async function activate(connectors: string[]): Promise<void> {
    if (connectors.join() === active.join()) return
    await seed.admin`delete from platform.connector_activations where org_id = ${ref.org.id}`
    if (connectors.length > 0) await ref.write({ connector_activations: connectors.map((connector) => ({ org_id: ORG.id, connector, state: "active" })) })
    active = connectors
  }

  /** Les nœuds ajoutés par le test (leurs blocs, brouillons, versions et règles partent en cascade), puis `mail` seul actif. */
  async function reset(): Promise<void> {
    if (added.length > 0) await seed.admin`delete from platform.nodes where id in ${seed.admin(added)}`
    added = []
    await activate(["mail"])
  }

  beforeAll(async () => {
    seed = seedWithAdmin()
    ref = await seedReferenceOrg(seed, { nodes: [{ path: "ventes", title: "Ventes" }] })
    await activate(["mail"])
  }, SETUP_TIMEOUT)

  afterAll(async () => {
    await seed?.cleanup()
  }, SETUP_TIMEOUT)

  // Chaque test part de O telle que la graine la pose : ce qu'un autre a ajouté ne compte jamais.
  afterEach(reset, SETUP_TIMEOUT)

  /** Des nœuds de plus dans O, complétés comme `contentTables` (`ventes` y est déjà), leurs règles, les connecteurs actifs (`mail` par défaut). */
  async function base(nodes: ContentNode[] = [], rules: RuleSpec[] = [], connectors = ["mail"]): Promise<void> {
    await ref.addNodes(nodes)
    added.push(...nodes.map((node) => ref.nodeId(node.path)))
    if (rules.length > 0) await ref.addRules(rules)
    await activate(connectors)
  }

  /** `ventes/relance_test`, publiée en révision 1, et son brouillon ouvert fait de `blocks`. */
  async function drafted(blocks: BlockInput[], connectors?: string[]): Promise<void> {
    await base([PROCEDURE], [], connectors)
    await ref.addBlocks(PATH, "published", [heading("Étapes"), steps(["Annonce."])])
    await ref.openDraft(PATH)
    await ref.addBlocks(PATH, "draft", blocks)
  }

  async function write(person: Person, input: Record<string, unknown>, meanwhile?: WatchOptions["meanwhile"], origin: WriteOrigin = { kind: "agent", ctx: null }) {
    const { db, calls } = watchDb(await ref.db(person), { meanwhile })
    const outcome = await writeNode(db, ref.identityOf(person), input, origin).then(
      (result) => ({ result, error: null }),
      (error: unknown) => ({ result: null, error }),
    )
    return { ...outcome, calls }
  }

  /** Les lignes de O qu'une publication écrit, relues par la connexion d'administration, dans un ordre fixe. */
  async function content(): Promise<Record<(typeof CONTENT_TABLES)[number], unknown>> {
    const org = ref.org.id
    const [row] = await seed.admin<{ content: Record<(typeof CONTENT_TABLES)[number], unknown> }[]>`
      select jsonb_build_object(
        'nodes', (select jsonb_agg(to_jsonb(n) order by n.id) from platform.nodes n where n.org_id = ${org}),
        'blocks', (select jsonb_agg(to_jsonb(b) order by b.id, b.state) from platform.blocks b where b.org_id = ${org}),
        'node_drafts', (select jsonb_agg(to_jsonb(d) order by d.node_id) from platform.node_drafts d join platform.nodes n on n.id = d.node_id where n.org_id = ${org}),
        'node_versions', (select jsonb_agg(to_jsonb(v) order by v.node_id, v.revision) from platform.node_versions v join platform.nodes n on n.id = v.node_id where n.org_id = ${org}),
        'links', (select jsonb_agg(to_jsonb(l) order by l.id) from platform.links l where l.org_id = ${org})
      ) as content`
    return row.content
  }

  async function nodeRow(path: string) {
    const [node] = await seed.admin<{ kind: string; meta: unknown; status: string; revision: number }[]>`
      select kind, meta, status, revision from platform.nodes where id = ${ref.nodeId(path)}`
    return node
  }

  /** Les textes des blocs du brouillon ouvert d'un nœud, par position. */
  async function draftTexts(path: string): Promise<(string | null)[]> {
    const rows = await seed.admin<{ text: string | null }[]>`
      select text from platform.blocks where node_id = ${ref.nodeId(path)} and state = 'draft' order by position`
    return rows.map((row) => row.text)
  }

  describe("publishing a procedure (AC2, AC5, AC6, AC13)", () => {
    it.each(CASES)("should refuse $rule with its text, keep the draft and publish nothing (AC2)", async ({ blocks, active: connectors, kind, problem }) => {
      await drafted(blocks, connectors)
      const before = await content()
      const claire = await write("claire", { path: PATH, base_revision: 1, publish: true })
      const { prefix } = ref.org
      expect(claire.error).toMatchObject({
        code: "invalid_arguments",
        // Une écriture d'assistant qui publie n'écrit rien sur un refus ; le brouillon d'avant reste (E11-S18, AC-1).
        message: [`Publication of ${PATH} refused: 1 problem(s). Nothing was written; the draft saved before this call stays.`, `- ${problem(prefix)}`, footer(prefix)].join("\n"),
        details: { refusals: [{ kind, message: problem(prefix) }] },
      })
      const after = await content()
      for (const table of CONTENT_TABLES) expect(after[table], table).toEqual(before[table])
      expect(writes(claire.calls)).toEqual([])
    })

    it("should publish a procedure without problem through publish_node, kind procedure and meta {}, its call blocks in the snapshot (AC5)", async () => {
      const calls = [
        callBlock("table.test_read", { table: "ventes/suivi" }),
        callBlock("mail.create_draft", DRAFT_ARGS),
        callBlock("mail.send_draft", { id: "<id du brouillon>" }),
        callBlock("test.release", { table: "ventes/suivi", key: "<id>", worker: "<ton prénom>", state: "done" }),
      ]
      await base([{ ...PROCEDURE, status: "draft", revision: 0 }])
      await ref.openDraft(PATH)
      await ref.addBlocks(PATH, "draft", [
        heading("Quand l'utiliser"),
        paragraph("Quand des prospects attendent une relance."),
        heading("Étapes"),
        steps(["Annonce en une phrase ce que tu vas faire.", "Lis le suivi :"]),
        calls[0],
        steps(["Prépare un brouillon :"], 3),
        calls[1],
        steps(["Après l'accord explicite de la personne, envoie ; rappelle avec confirm: true :"], 4),
        calls[2],
        heading("Règles"),
        { type: "list", text: null, data: { items: ["Libère chaque ligne :"] } },
        calls[3],
      ])
      const claire = await write("claire", { path: PATH, base_revision: 0, publish: true })
      expect(claire.result?.text).toBe(`Published ${PATH} revision 1 (3 sections, 12 blocks). Next write: base_revision 1.`)
      expect(ref.readable(publishCalls(claire.calls).map(publishArgs))).toEqual([{ node: nodeId(PATH), baseRevision: 0, stamp: instant(CONTENT_AT), links: [] }])
      expect(await nodeRow(PATH)).toMatchObject({ kind: "procedure", meta: {}, status: "published", revision: 1 })
      const [version] = await seed.admin<{ node_id: string; revision: number; kind: string; blocks: Record<string, unknown>[] }[]>`
        select node_id, revision, kind, blocks from platform.node_versions where node_id = ${ref.nodeId(PATH)}`
      expect(ref.readable(version)).toMatchObject({ node_id: nodeId(PATH), revision: 1, kind: "procedure" })
      const snapshot = Array.isArray(version.blocks) ? version.blocks : []
      expect(snapshot.filter((row) => row.type === "call").map((row) => row.data)).toEqual(calls.map((call) => call.data))
    })

    it("should check every block of a republished procedure, check a page that becomes a procedure, and not check a procedure that becomes a page (AC6)", async () => {
      // Un bloc `call` publié devenu fautif : `mail` désactivé depuis ; seul un paragraphe change.
      await base([PROCEDURE], [], [])
      await ref.addBlocks(PATH, "published", [heading("Étapes"), paragraph("Ancien texte."), steps(["Prépare :"]), callBlock("mail.create_draft", DRAFT_ARGS)])
      const edited = await write("claire", { path: PATH, base_revision: 1, ops: [{ op: "replace_text", section: "Étapes", find: "Ancien", text: "Nouveau" }], publish: true })
      expect(edited.error).toMatchObject({
        code: "invalid_arguments",
        message: expect.stringContaining(
          "\n- section « Étapes », call block 1 (step 1): mail.create_draft belongs to connector mail, which is not enabled for Acme Test; an administrator enables it on the dashboard\n",
        ),
      })
      expect(publishCalls(edited.calls)).toEqual([])
      // Refusée à la publication, l'écriture d'un assistant ne laisse aucun brouillon (E11-S18, AC-1).
      expect(await draftTexts(PATH)).toEqual([])
      // La procédure revient plus bas, publiée sans brouillon.
      await reset()

      // Une page dont le brouillon demande `kind: procedure` : contrôlée comme une procédure.
      await base([{ path: "ventes/page_test", kind: "page" }])
      await ref.openDraft("ventes/page_test", { kind: "procedure" })
      await ref.addBlocks("ventes/page_test", "draft", [heading("Étapes"), callBlock("x.unknown")])
      const becoming = await write("claire", { path: "ventes/page_test", base_revision: 1, publish: true })
      expect(becoming.error).toMatchObject({ code: "invalid_arguments", details: { refusals: [{ kind: "unknown_function", function: "x.unknown" }] } })
      expect(publishCalls(becoming.calls)).toEqual([])

      // Une procédure dont le brouillon demande `kind: page` : aucun contrôle, `meta` reste `{}`.
      await base([PROCEDURE])
      await ref.openDraft(PATH, { kind: "page" })
      await ref.addBlocks(PATH, "draft", [heading("Étapes"), callBlock("x.unknown")])
      const leaving = await write("claire", { path: PATH, base_revision: 1, publish: true })
      expect(leaving.result?.text).toBe(`Published ${PATH} revision 2 (1 section, 2 blocks). Next write: base_revision 2.`)
      expect(await nodeRow(PATH)).toMatchObject({ kind: "page", meta: {} })
    })

    it("should pass the draft stamp read before the blocks to publish_node, and answer a draft saved meanwhile as stale (AC13)", async () => {
      await drafted([heading("Étapes"), steps(["Prépare :"]), callBlock("mail.create_draft", DRAFT_ARGS)])
      // Une autre session écrit un bloc `call` fautif avant `publish_node` : la base avance le tampon (M02 ;
      // `blocks_lock_draft` le fait sous un jeton, la connexion d'administration le pose), et `publish_node`
      // refuse en `PT409` un tampon qui n'est plus le sien.
      const concurrent = async (call: DbCall) => {
        if (!callsFunction(call, "publish_node")) return
        await ref.addBlocks(PATH, "draft", [callBlock("mail.send")])
        await seed.admin`update platform.node_drafts set updated_at = now() where node_id = ${ref.nodeId(PATH)}`
      }
      // Par l'écran : l'écriture d'un assistant, atomique, se rejoue après une course (E11-S18, HN-E11S18-2).
      const claire = await write("claire", { path: PATH, base_revision: 1, publish: true }, concurrent, { kind: "human" })
      expect(claire.error).toMatchObject({
        code: "stale_revision",
        message: `stale revision: ${PATH} changed while publishing (its draft was saved meanwhile). Nothing was published. Read it again with draft: true, then retry.`,
      })
      expect(publishCalls(claire.calls).map((call) => publishArgs(call).stamp)).toEqual([instant(CONTENT_AT)])
      // Le tampon est lu avant les blocs du brouillon, donc avant leur contrôle.
      expect(claire.calls.indexOf(reads(claire.calls, "node_drafts")[0])).toBeLessThan(claire.calls.indexOf(draftBlockReads(claire.calls)[0]))
      const [node] = await seed.admin<{ revision: number; versions: number }[]>`
        select n.revision, (select count(*)::int from platform.node_versions v where v.node_id = n.id) as versions
        from platform.nodes n where n.id = ${ref.nodeId(PATH)}`
      expect([node.revision, node.versions]).toEqual([1, 0])
      expect(await draftTexts(PATH)).toHaveLength(4)
    })
  })

  describe("listProcedures (AC9)", () => {
    it("should list the procedures read at level 1 at least, by path, with their owner team, and a draft for writers only", async () => {
      await base(
        [
          { path: "ventes/qualif", kind: "procedure", title: "Qualifier", summary: "Qualifie les prospects.", status: "draft", revision: 0 },
          PROCEDURE,
          { path: "ventes/page_proc", kind: "page", title: "Page", summary: "Une page qui sera une procédure." },
          { path: "support/escalade", kind: "procedure", title: "Escalade", summary: "Escalade un incident." },
        ],
        [{ node: PATH, user: "paul", level: "read" }],
      )
      await ref.openDraft(PATH)
      await ref.openDraft("ventes/qualif")
      await ref.openDraft("ventes/page_proc", { kind: "procedure" })
      await ref.write({
        nodes: [{ id: OTHER_PROCEDURE, org_id: OTHER_ORG.id, path: "ventes/relance_autre", kind: "procedure", title: PROCEDURE.title, summary: PROCEDURE.summary }],
      })
      added.push(ref.id(OTHER_PROCEDURE))
      const list = async (person: Person) => {
        const { db, calls } = watchDb(await ref.db(person))
        return { procedures: await listProcedures(db, ref.identityOf(person)), calls }
      }
      const ventes = { id: TEAMS.ventes.id, name: "Ventes" }
      const lea = await list("lea")
      expect(ref.readable(lea.procedures.map((one) => ({ ...one, updatedAt: instant(one.updatedAt) })))).toEqual([
        { path: "ventes/qualif", title: "Qualifier", summary: "Qualifie les prospects.", status: "draft", revision: 0, updatedAt: instant(CONTENT_AT), ownerTeam: ventes, hasDraft: true },
        { path: PATH, title: PROCEDURE.title, summary: PROCEDURE.summary, status: "published", revision: 1, updatedAt: instant(CONTENT_AT), ownerTeam: ventes, hasDraft: true },
      ])
      // Un lecteur de niveau 1 : le brouillon n'est pas demandé à la base, qui le rendrait (P24).
      const paul = await list("paul")
      expect(paul.procedures.map((one) => [one.path, one.ownerTeam?.name, one.hasDraft])).toEqual([
        ["support/escalade", "Support", false],
        [PATH, "Ventes", false],
      ])
      // Les nœuds dont le brouillon est demandé : la liste liée de la lecture (face SQL, lot e2b).
      const asked = reads(paul.calls, "node_drafts").flatMap((call) => (call.kind === "sql" ? call.values.flatMap((value) => (Array.isArray(value) ? value : [])) : []))
      expect(ref.readable(asked)).toEqual([nodeId("support/escalade")])
      expect((await list("marc")).procedures).toEqual([])
    })

    // Écrit sous la RLS de niveau (jusqu'à E01-S08), où l'espace de Claire manquait à la lecture d'Ada et où le
    // plus proche propriétaire lu (l'organisation) lui aurait donné la gestion : depuis l'isolation seule, la
    // base rend l'ancêtre, et le propriétaire réel vient de `node_owner`. Le cas prouve la décision dans un
    // espace personnel : le niveau de la règle, jamais la gestion de l'administratrice, et aucun brouillon lu.
    it("should decide a procedure of another person's space at its rule's level from its real owner (node_owner), and read no draft (P24)", async () => {
      const path = "private/claire/relance"
      await base([{ path, kind: "procedure", title: "Ma relance", summary: "Relance personnelle." }], [{ node: path, user: "ada", level: "read" }])
      await ref.openDraft(path)
      const { db, calls } = watchDb(await ref.db("ada"))
      const procedures = await listProcedures(db, ref.identityOf("ada"))
      expect(procedures.map((one) => [one.path, one.ownerTeam, one.hasDraft])).toEqual([[path, null, false]])
      expect(reads(calls, "node_drafts")).toEqual([])
    })

    it("should read all the procedures at once, beyond 1,000 rows, and bound the list to 500 after the filter, never one query per procedure", async () => {
      const bulk = (team: string, count: number): ContentNode[] => Array.from({ length: count }, (_, index) => ({ path: `${team}/p${String(index).padStart(3, "0")}`, kind: "procedure" }))
      // Les 600 procédures de Support passent avant celles de Ventes : une borne posée avant le filtre ne laisserait rien à Léa.
      await base([...bulk("support", 600), ...bulk("ventes", 520)])
      const { db, calls } = watchDb(await ref.db("lea"))
      const procedures = await listProcedures(db, ref.identityOf("lea"))
      expect([procedures.length, procedures[0].path, procedures[499].path]).toEqual([500, "ventes/p000", "ventes/p499"])
      // Une lecture de toutes les procédures : la face SQL n'a pas la coupe de `max_rows` que les pages contournaient (lot e2b).
      const procedureReads = reads(calls, "nodes").filter((call) => call.kind === "sql" && /\bkind = 'procedure'/.test(call.text))
      expect(procedureReads).toHaveLength(1)
      expect(calls.filter((call) => call.kind === "rpc")).toEqual([])
      expect(calls.length).toBeLessThan(30)
    })
  })

  describe("checkProcedure (AC10)", () => {
    const run = async (person: Person, path: string) => {
      const { db, calls } = watchDb(await ref.db(person))
      const outcome = await checkProcedure(db, ref.identityOf(person), { path }).then(
        (refusals) => ({ refusals, error: null }),
        (error: unknown) => ({ refusals: null, error }),
      )
      return { ...outcome, calls }
    }

    it("should check the draft from level 2 and the published blocks below it, refuse what is not a readable procedure, and write nothing", async () => {
      await base(
        [
          PROCEDURE,
          { path: "ventes/propre", kind: "procedure" },
          { path: "ventes/publiee", kind: "procedure" },
          { path: "ventes/page_proc", kind: "page" },
          { path: "ventes/suivi", kind: "table" },
        ],
        [
          { node: PATH, user: "paul", level: "read" },
          { node: "ventes/page_proc", user: "paul", level: "read" },
        ],
      )
      await ref.addBlocks(PATH, "published", [heading("Étapes"), callBlock("mail.create_draft", DRAFT_ARGS)])
      await ref.openDraft(PATH)
      await ref.addBlocks(PATH, "draft", [heading("Étapes"), callBlock("mail.send"), callBlock("mail.create_draft", { ...DRAFT_ARGS, to: "claire" })])
      await ref.openDraft("ventes/propre")
      await ref.addBlocks("ventes/propre", "draft", [heading("Étapes"), callBlock("mail.create_draft", DRAFT_ARGS)])
      await ref.addBlocks("ventes/publiee", "published", [heading("Étapes"), callBlock("mail.send")])
      await ref.openDraft("ventes/page_proc", { kind: "procedure" })
      await ref.addBlocks("ventes/page_proc", "draft", [callBlock("mail.send")])
      const { prefix } = ref.org

      const lea = await run("lea", PATH)
      expect(lea.refusals?.map((refusal) => [refusal.kind, refusal.message])).toEqual([
        ["unknown_function", `section « Étapes », call block 1: unknown function « mail.send »; ${prefix}_find with type function lists the functions`],
        ["invalid_value", 'section « Étapes », call block 2: mail.create_draft argument « to »: Invalid email address (got "claire")'],
      ])
      expect(writes(lea.calls)).toEqual([])
      expect((await run("lea", "ventes/propre")).refusals).toEqual([])
      expect((await run("lea", "ventes/publiee")).refusals?.map((refusal) => refusal.function)).toEqual(["mail.send"])
      // Un lecteur de niveau 1 : les blocs publiés, jamais le brouillon, que la base rendrait (P24).
      const paul = await run("paul", PATH)
      expect(paul.refusals).toEqual([])
      expect([reads(paul.calls, "node_drafts"), draftBlockReads(paul.calls)]).toEqual([[], []])
      // Invisible (niveau 0) ou inconnu : `not_found`, sans lecture de blocs.
      for (const [person, path] of [["marc", PATH], ["lea", "ventes/inconnu"]] as const) {
        const unknown = await run(person, path)
        expect(unknown.error, path).toMatchObject({ code: "not_found", message: `Unknown path ${path}.` })
        expect(reads(unknown.calls, "blocks"), path).toEqual([])
      }
      // Le genre du brouillon quand il est lisible, sinon celui du nœud.
      expect((await run("lea", "ventes/page_proc")).refusals?.map((refusal) => refusal.function)).toEqual(["mail.send"])
      for (const [person, path] of [["paul", "ventes/page_proc"], ["lea", "ventes/suivi"], ["lea", "ventes/contexte"], ["lea", "ventes"]] as const) {
        expect((await run(person, path)).error, path).toMatchObject({ code: "invalid_arguments", message: `${path} is not a procedure.` })
      }
    })
  })
})
