// @vitest-environment node
// Le cas D4 du banc E04 refusé à la publication (E07-S02, AC27 ; H60) : une procédure dont l'étape 5 rend
// une ligne à l'état de travail, publiée par `write` (`publish: true`, service d'E03-S03), contrôlée par
// E03-S06 avec le `checkArgs` de `table.release`, sur une base réelle (E01-S10, lot t1-b), la fixture
// d'E07-S01 semée pour le fichier (`seedTableFixture`), catalogue réel. Refusée sans appel de `publish_node`
// (l'espion, `spyDb`), puis publiée une fois le bloc `call` corrigé dans le brouillon (connexion
// d'administration). En suite portable (`sqlConfigured`) : le projet, ou le Postgres nu du job `bare-postgres`.
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { BlockInput } from "../../packages/plateforme/schemas"
import { writeNode } from "../../packages/plateforme/server/nodes/write"
import { identityOf } from "../helpers/reference-org"
import type { ReferenceOrgSql } from "../helpers/reference-org-sql"
import { functionCalls, spyDb, type SpiedCall } from "../helpers/spy-t1-b"
import { sqlConfigured, seedWithAdmin, type SeededData, portable } from "../helpers/sql"
import { PROSPECTS } from "../factories/table-fixture"
import { seedTableFixture } from "../factories/table-fixture-sql"

const NETWORK_TIMEOUT = 60_000
const SETUP_TIMEOUT = 180_000

const PATH = "ventes/qualifier_prospects"

const heading = (text: string): BlockInput => ({ type: "heading", text, data: { level: 1 } })
const steps = (items: string[]): BlockInput => ({ type: "list", text: null, data: { items, ordered: true } })
const release = (state: string): BlockInput => ({
  type: "call",
  text: null,
  data: { function: "table.release", args: { table: PROSPECTS.path, key: "<…>", worker: "<…>", state } },
})

/**
 * Le bloc `table.write` qu'E01-S06 semait dans la procédure Démo (remplacée par celle de
 * `scripts/lib/pilot-qualification.mjs`, E06-S01) : le lien réservé passe le schéma parce que son
 * problème tombe sur le chemin exact du champ, un espace réservé (règle 4 d'E03-S06).
 */
const demoWrite: BlockInput = {
  type: "call",
  text: null,
  data: {
    function: "table.write",
    args: {
      table: PROSPECTS.path,
      rows: [{ key: "<ref>", set: { contact: { value: "<nom>", link: "<url de la preuve>" } }, verified_empty: [{ column: "email", reason: "<où tu as cherché>" }] }],
    },
  },
}

const publishCalls = (calls: SpiedCall[]) => functionCalls(calls, "publish_node")

describe.skipIf(!sqlConfigured)(portable("publishing a procedure that releases rows to the working state (AC27)"), { timeout: NETWORK_TIMEOUT }, () => {
  let seed: SeededData
  let ref: ReferenceOrgSql

  beforeAll(async () => {
    seed = seedWithAdmin()
    ref = await seedTableFixture(seed)
  }, SETUP_TIMEOUT)

  afterAll(async () => {
    await seed?.cleanup()
  }, SETUP_TIMEOUT)

  it("should refuse the D4 step with the location of its call block, publish nothing, then publish once the block is corrected", async () => {
    await ref.addBlocks(PATH, "published", [heading("Étapes"), steps(["Annonce en une phrase ce que tu vas faire."])])
    await ref.openDraft(PATH)
    const [, , callId] = await ref.addBlocks(PATH, "draft", [
      heading("Étapes"),
      steps(["Annonce en une phrase ce que tu vas faire.", "Lis le contrat du tableau.", "Réserve des lignes.", "Cherche le contact de chaque ligne.", "Remets chaque ligne en cours :"]),
      release("en cours"),
      demoWrite,
    ])
    const spied = spyDb(await ref.db("claire"))
    // L'organisation simulée, son identifiant réel : le préfixe `acme` des textes servis.
    const claire = ref.identityOf("claire", { org: identityOf("claire").org })
    const problem =
      "section « Étapes », call block 1 (step 5): table.release: state « en cours » is set only by table.claim; states accepted by table.release: à traiter, à revoir"
    const refused = await writeNode(spied.db, claire, { path: PATH, base_revision: 1, publish: true }, { kind: "agent", ctx: null }).then(
      () => null,
      (error: unknown) => error,
    )
    expect(refused).toMatchObject({
      code: "invalid_arguments",
      message: [
        // E11-S18 (AC-1) : rien d'écrit ; le brouillon d'avant l'appel reste, le bloc s'y corrige.
        `Publication of ${PATH} refused: 1 problem(s). Nothing was written; the draft saved before this call stays.`,
        `- ${problem}`,
        'Fix them with acme_write (ops on the sections), then publish again. Format and rules: acme_read {"path": "write.procedure"}.',
        "Writing it in several calls? Pass publish: false until the last one.",
      ].join("\n"),
      details: { refusals: [{ kind: "check_failed", section: "Étapes", block: 1, step: 5, block_id: callId, function: "table.release", message: problem }] },
    })
    expect(publishCalls(spied.calls)).toEqual([])

    // Le bloc `call` corrigé dans le brouillon : « à revoir ».
    await seed.admin`update platform.blocks set data = jsonb_set(data, '{args,state}', to_jsonb(${"à revoir"}::text)) where id = ${callId} and state = 'draft'`
    const published = await writeNode(spied.db, claire, { path: PATH, base_revision: 1, publish: true }, { kind: "agent", ctx: null })
    // 1.4.3 : une procédure sans partie « Quand l'utiliser » se publie, avec un avertissement.
    expect(published.text).toBe(`Published ${PATH} revision 2 (1 section, 4 blocks). Next write: base_revision 2.\nWarnings:\n- Procedure: no part « When to use it » (or « Quand l'utiliser »): say when to use it, when not, and where to go instead (read path help, section procedures).`)
    expect(publishCalls(spied.calls)).toHaveLength(1)
    const [node] = await seed.admin<{ revision: number }[]>`select revision from platform.nodes where id = ${ref.nodeId(PATH)}`
    expect(node).toMatchObject({ revision: 2 })
  })
})
