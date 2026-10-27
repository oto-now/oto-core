// @vitest-environment node
// Contrôle des blocs d'une procédure (E03-S06, AC1, AC3, AC4, AC12, R2) : `checkProcedureBlocks` sur des
// blocs tels que `loadBlocks` les rend, le catalogue réel complété par celui de
// `tests/factories/test-functions.ts`, les connecteurs actifs lus sur une base réelle (E01-S10, lot d1 :
// `loadActiveConnectors` passe par la face SQL ; il ne retient que les activations de l'organisation de
// l'adresse, prouvé par P, dont Léa est aussi membre). Portable : O et P de la fixture de référence semés
// par la connexion d'administration, Léa par `asCaller`, sans Supabase Auth ; le job `bare-postgres` le joue.
// Les textes servis au modèle sont comparés mot pour mot.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { renderBlocks, type BlockInput } from "../../packages/plateforme/schemas"
import type { Identity } from "../../packages/plateforme/server/identity"
import type { DocBlock } from "../../packages/plateforme/server/nodes/document"
import { checkProcedureBlocks, procedurePublicationError } from "../../packages/plateforme/server/procedures-check"
import { BUSY_REFUSAL } from "../factories/test-functions"
import { blockUuid, identityOf, ORG, OTHER_ORG } from "../helpers/reference-org"
import { seedReferenceOrg, type ReferenceOrgSql } from "../helpers/reference-org-sql"
import { asCaller, seedWithAdmin, spyDb, SQL_SKIP_REASON, sqlConfigured, type SeededData } from "../helpers/sql"
import { TEMPS_LINEAIRE_MS } from "../helpers/temps-lineaire"

vi.mock("../../packages/plateforme/server/catalog/registry", async (importOriginal) => (await import("../factories/test-functions")).withTestFunctions(importOriginal))

const NETWORK_TIMEOUT = 60_000
const SETUP_TIMEOUT = 180_000

const heading = (text: string, level: 1 | 2 | 3 = 1): BlockInput => ({ type: "heading", text, data: { level } })
const paragraph = (text: string): BlockInput => ({ type: "paragraph", text, data: {} })
const steps = (items: string[], start?: number): BlockInput => ({ type: "list", text: null, data: start === undefined ? { items, ordered: true } : { items, ordered: true, start } })
const bullets = (items: string[]): BlockInput => ({ type: "list", text: null, data: { items } })
const callBlock = (fn: string, args: Record<string, unknown> = {}): BlockInput => ({ type: "call", text: null, data: { function: fn, args } })
const code = (text: string, language: string): BlockInput => ({ type: "code", text, data: { language } })

/** Des blocs tels que `loadBlocks` les rend : id posé par la base, positions 1 024 × rang. */
function stored(inputs: BlockInput[]): DocBlock[] {
  return inputs.map((input, index) => ({
    id: blockUuid(index + 1),
    type: input.type,
    text: input.text ?? null,
    data: input.data ?? {},
    key: input.key ?? null,
    position: 1024 * (index + 1),
    revision: 1,
    provenance: {},
  }))
}

const unknown = (name: string) => `unknown function « ${name} »; acme_find with type function lists the functions`
const FOOTER = 'Fix them with acme_write (ops on the sections), then publish again. Format and rules: acme_read {"path": "write.procedure"}.'
/** La dernière ligne d'un refus : `write` publie par défaut (E11-S02, AC-b2, N28). */
const SEVERAL = "Writing it in several calls? Pass publish: false until the last one."

describe.skipIf(!sqlConfigured)(
  sqlConfigured ? "checkProcedureBlocks on a real database, portable" : `checkProcedureBlocks on a real database, portable (${SQL_SKIP_REASON})`,
  { timeout: NETWORK_TIMEOUT },
  () => {
    let seed: SeededData
    let ref: ReferenceOrgSql
    let lea: Identity

    beforeAll(async () => {
      seed = seedWithAdmin()
      ref = await seedReferenceOrg(seed)
      // `mail` actif dans O, et dans P, dont Léa est aussi membre : l'isolation seule lui rend les deux lignes.
      await ref.write({
        connector_activations: [
          { org_id: ORG.id, connector: "mail", state: "active" },
          { org_id: OTHER_ORG.id, connector: "mail", state: "active" },
        ],
      })
      // O sous son identifiant réel, ses textes au préfixe `acme` de la base simulée.
      lea = ref.identityOf("lea", { org: identityOf("lea").org })
    }, SETUP_TIMEOUT)

    afterAll(async () => {
      await seed?.cleanup()
    }, SETUP_TIMEOUT)

    /** Le contrôle pour Léa dans O, `mail` actif ; les requêtes parties, sur l'une ou l'autre face. */
    async function check(blocks: DocBlock[]) {
      const { db, sent } = spyDb(asCaller(ref.people.lea.id, ref.people.lea.email))
      const refusals = await checkProcedureBlocks(db, lea, blocks)
      return { refusals, sent }
    }

    describe("checkProcedureBlocks — where each problem is (AC1)", () => {
      it("should situate each call block as callLocation and formatCallLocation do, and a code block marked Call by its section", async () => {
        const blocks = stored([
          paragraph("Introduction."),
          callBlock("x.before"),
          heading("Étapes"),
          steps(["Annonce.", "Lis le contrat :"]),
          callBlock("x.first"),
          steps(["Réserve :"], 3),
          callBlock("x.second"),
          callBlock("x.third"),
          paragraph("Puis :"),
          callBlock("x.fourth"),
          heading("Détail", 2),
          callBlock("x.detail"),
          heading("Règles"),
          bullets(["Ne jamais inventer."]),
          callBlock("x.rule"),
          steps(["a", "b", "c"], 12),
          code('x.rule {"a": 1}', "Call"),
          callBlock("x.last"),
        ])
        const refusal = (index: number, where: { section?: string; block: number; step?: number }, location: string) => {
          const name = String(blocks[index].data.function)
          return { kind: "unknown_function", ...where, block_id: blocks[index].id, function: name, message: `${location}: ${unknown(name)}` }
        }
        // Rendus à l'envers : l'ordre servi vient de (`position`, `id`), jamais de l'ordre reçu.
        expect((await check([...blocks].reverse())).refusals).toEqual([
          refusal(1, { block: 1 }, "before the first heading, call block 1"),
          refusal(4, { section: "Étapes", block: 1, step: 2 }, "section « Étapes », call block 1 (step 2)"),
          refusal(6, { section: "Étapes", block: 2, step: 3 }, "section « Étapes », call block 2 (step 3)"),
          refusal(7, { section: "Étapes", block: 3, step: 3 }, "section « Étapes », call block 3 (step 3)"),
          refusal(9, { section: "Étapes", block: 4 }, "section « Étapes », call block 4"),
          refusal(11, { section: "Détail", block: 1 }, "section « Détail », call block 1"),
          refusal(14, { section: "Règles", block: 1 }, "section « Règles », call block 1"),
          {
            kind: "invalid_block",
            section: "Règles",
            block_id: blocks[16].id,
            message: "section « Règles », code block: this code block is marked call but is plain code, so it was never checked; write it as a call block",
          },
          refusal(17, { section: "Règles", block: 2 }, "section « Règles », call block 2"),
        ])
      })
    })

    describe("checkProcedureBlocks — every problem at once (AC3)", () => {
      // Plus de borne de taille depuis le 2026-10-27 : une procédure de plus de 12 000 caractères n'est refusée que pour ses blocs.
      it("should list the blocks in document order, in one refusal whose details hold them, and never refuse a procedure for its size", async () => {
        const blocks = stored([
          heading("Étapes"),
          steps(["Annonce.", "Envoie :"]),
          callBlock("mail.send", { id: "<id>" }),
          steps(["Prépare :", "Écris :"], 3),
          callBlock("mail.create_draft", { to: "claire", subject: "Relance", body: "<texte>" }),
          paragraph("x".repeat(12_000)),
        ])
        const { refusals } = await check(blocks)
        expect(renderBlocks(blocks).length).toBeGreaterThan(12_000)
        const error = procedurePublicationError("ventes/relance_test", refusals, "acme")
        expect(error).toMatchObject({
          code: "invalid_arguments",
          message: [
            "Publication of ventes/relance_test refused: 2 problem(s). The draft is kept; nothing was published.",
            `- section « Étapes », call block 1 (step 2): ${unknown("mail.send")}`,
            '- section « Étapes », call block 2 (step 4): mail.create_draft argument « to »: Invalid email address (got "claire")',
            FOOTER,
            SEVERAL,
          ].join("\n"),
        })
        expect(error.details).toEqual({ refusals })
        expect(refusals.map((refusal) => refusal.kind)).toEqual(["unknown_function", "invalid_value"])
        expect(refusals[1]).toMatchObject({ block_id: blocks[4].id, function: "mail.create_draft", element: "to" })
      })

      it("should list 20 problems, then count the others, and keep all 25 in details", async () => {
        const names = Array.from({ length: 25 }, (_, index) => `x.missing_${index}`)
        const blocks = stored([heading("Étapes"), ...names.map((name) => callBlock(name))])
        const { refusals } = await check(blocks)
        const error = procedurePublicationError("ventes/relance_test", refusals, "acme")
        const lines = error.message.split("\n")
        const line = (name: string, rank: number) => `section « Étapes », call block ${rank}: ${unknown(name)}`
        expect(lines[0]).toBe("Publication of ventes/relance_test refused: 25 problem(s). The draft is kept; nothing was published.")
        expect(lines.slice(1)).toEqual([...names.slice(0, 20).map((name, index) => `- ${line(name, index + 1)}`), "- … and 5 more.", FOOTER, SEVERAL])
        expect(error.details).toEqual({
          refusals: names.map((name, index) => ({
            kind: "unknown_function",
            section: "Étapes",
            block: index + 1,
            block_id: blocks[index + 1].id,
            function: name,
            message: line(name, index + 1),
          })),
        })
      })
    })

    describe("checkProcedureBlocks — call fences outside call blocks (AC2, R2, rule 6)", () => {
      it("should refuse a code block whose rendered fence reads as call, and any field rendered as is whose line opens a call fence", async () => {
        const fence = 'Envoie :\n  ~~~Call\n  mail.send_draft {"id": "<id>"}\n  ~~~'
        const call = '```call\nmail.send_draft {"id": "<id>"}\n```'
        const { refusals } = await check(
          stored([
            heading("Étapes"),
            code('mail.send_draft {"id": "<id>"}', " Call x "),
            bullets(["Prépare.", fence]),
            { type: "checklist", text: null, data: { items: [{ text: fence, checked: false }] } },
            { type: "callout", text: fence, data: {} },
            { type: "image", text: fence, data: { src: "https://acme.test/relance.png" } },
            // Source d'une image et ton d'un encart, rendus tels quels (M05) ; sauts de ligne `\r` et blanc
            // insécable avant `call`, que l'analyse du markdown lit comme une clôture `call`.
            { type: "image", text: null, data: { src: `https://acme.test/x.png\n${call}` } },
            { type: "callout", text: "Attention.", data: { tone: `note\n${call}` } },
            paragraph('Envoie :\r```\u00a0call\rmail.send_draft {"id": "<id>"}\r```'),
            // Une langue sur deux lignes, ou qui porte un accent grave, casse la clôture du bloc `code`.
            code("x", "json\n```call"),
            code(call, "x`"),
            code("x", "`call"),
            // Ni une clôture `call` (« callout »), ni une ligne qui en ouvre une, ni un appel dans une clôture intacte.
            paragraph("```callout\nVoir le bloc ```call plus bas."),
            code("x", "callout"),
            code(call, "json"),
          ]),
        )
        const where = (kind: "code" | "text") => ["invalid_block", `section « Étapes », ${kind} block`]
        expect(refusals.map((refusal) => [refusal.kind, refusal.message.split(":")[0]])).toEqual([
          where("code"),
          ...Array.from({ length: 7 }, () => where("text")),
          ...Array.from({ length: 3 }, () => where("code")),
        ])
      })

      it("should refuse a call fence in a cell, a toggle summary or body, or a sub-item, and count a step at the first level (E10-S04, AC-a5)", async () => {
        const call = '```call\nmail.send_draft {"id": "<id>"}\n```'
        const { refusals } = await check(
          stored([
            heading("Étapes"),
            { type: "simple_table", text: null, data: { columns: ["a"], rows: [['```call mail.send_draft {"id": "<id>"}']] } },
            { type: "toggle", text: `Voir :\n${call}`, data: { summary: "Détail" } },
            { type: "toggle", text: "Rien.", data: { summary: "```call x" } },
            { type: "list", text: null, data: { items: [{ text: "Prépare.", children: { items: [call] } }] } },
            // Une étape reste un élément de premier niveau : sous-éléments non comptés.
            { type: "list", text: null, data: { items: ["a", { text: "b", children: { items: ["b1", "b2"] } }], ordered: true } },
            callBlock("x.after"),
          ]),
        )
        expect(refusals.map((refusal) => refusal.message.split(":")[0])).toEqual([
          ...Array.from({ length: 4 }, () => "section « Étapes », text block"),
          "section « Étapes », call block 1 (step 2)",
        ])
      })
    })

    describe("checkProcedureBlocks — hostile blocks (security-patterns.md § Validation des inputs)", () => {
      it("should check each hostile block of the largest size a client sends in linear time, citing a long key cut on one line", async () => {
        // Un argument d'outil va jusqu'à 1 000 000 de caractères (`MAX_ARGS_CHARS`), un texte de bloc jusqu'à 100 000.
        const key = `${" ".repeat(900_000)}x`
        const cases: [string, DocBlock[], number][] = [
          ["unknown key of blanks", stored([callBlock("table.test_read", { table: "ventes/suivi", [key]: 1 })]), 200],
          ["nested keys of blanks", stored([callBlock("test.invoice", { customer: "C-1", lines: [{ sku: "SKU-1", qty: 1, [key]: 1 }], tags: { [key]: 1 } })]), 300],
          ["heading of blanks", stored([heading(`Étapes${" ".repeat(99_000)}`), callBlock("x.unknown")]), Infinity],
          ["line of backticks and blanks", stored([paragraph(`${"`".repeat(50_000)}${" ".repeat(49_000)}calx`)]), Infinity],
        ]
        /** Le plus court de trois passages : la machine est partagée par les agents, une pause du processus n'est pas le contrôle. */
        async function shortest(blocks: DocBlock[]) {
          const times: number[] = []
          let refusals: Awaited<ReturnType<typeof check>>["refusals"] = []
          for (let run = 0; run < 3; run++) {
            const started = performance.now()
            refusals = (await check(blocks)).refusals
            times.push(performance.now() - started)
          }
          return { time: Math.min(...times), refusals }
        }
        // La lecture des connecteurs actifs, sur la base réelle, n'est pas l'analyse du texte : son temps,
        // celui d'un bloc `call` sans texte hostile, est retiré de la mesure des cas qui la font (un bloc
        // `call` au moins), et d'eux seuls.
        const reading = (await shortest(stored([callBlock("x.warm_up")]))).time
        for (const [name, blocks, longest] of cases) {
          const { time, refusals } = await shortest(blocks)
          const read = blocks.some((block) => block.type === "call")
          expect(time - (read ? reading : 0), name).toBeLessThan(TEMPS_LINEAIRE_MS)
          // Clé et message de Zod coupés avant d'entrer dans le problème : une ligne courte.
          expect(refusals.every((refusal) => !/[\r\n]/.test(refusal.message) && refusal.message.length < longest), name).toBe(true)
        }
      })
    })

    describe("checkProcedureBlocks — placeholders and functions with an account (AC4)", () => {
      it("should check the key of a placeholder but never its value, at every level, and ask nothing of a connector function beyond its arguments", async () => {
        const { refusals, sent } = await check(
          stored([
            heading("Étapes"),
            callBlock("mail.create_draft", { to: "<email du contact>", subject: "Suite à notre échange", body: "<texte>" }),
            callBlock("test.release", { table: "ventes/suivi_prospects", key: "<id>", worker: "<ton prénom>", state: "<état final>" }),
            callBlock("test.invoice", { customer: "C-1", lines: [{ sku: "<sku>", qty: 2 }, { sku: "SKU-9", qty: "<quantité>" }] }),
          ]),
        )
        expect(refusals).toEqual([])
        // Aucun compte n'est lu : celui de `mail.create_draft` se résout à l'appel (H83).
        expect(sent.map((query) => query.target)).toEqual(["connector_activations"])
        // Une clé n'est jamais un espace réservé.
        const key = await check(stored([callBlock("table.test_read", { table: "ventes/suivi", "<table>": "x" })]))
        expect(key.refusals.map((refusal) => [refusal.kind, refusal.message])).toEqual([
          ["unknown_key", "before the first heading, call block 1: table.test_read has no argument « <table> »; its arguments: table"],
        ])
      })
    })

    // Le texte des règles que seul ce contrôle dit, au préfixe de l'organisation (R4, R9, R11, R13) : un bloc `call` par
    // cas, sous « Étapes », après une étape numérotée. Un refus de publication qui n'écrit rien : `procedures-service.test.ts`.
    describe("checkProcedureBlocks — the text of each rule (AC2)", () => {
      it("should refuse each call block with the text of its rule, the options of acme_call named by the prefix", async () => {
        const at = "section « Étapes », call block 1 (step 1)"
        const draft = { to: "<email du contact>", subject: "Suite à notre échange", body: "<texte>" }
        const cases: Record<string, BlockInput> = {
          R4: callBlock("acme_call", { function: "mail.send_draft" }),
          "R9 (confirm)": callBlock("mail.send_draft", { id: "<id du brouillon>", confirm: true }),
          "R9 (team)": callBlock("mail.create_draft", { ...draft, team: "ventes" }),
          "R9 (envelope)": callBlock("mail.create_draft", { function: "mail.create_draft", ...draft }),
          R11: callBlock("mail.create_draft", { to: "<email du contact>", body: "<texte>" }),
          R13: callBlock("test.release", { table: "ventes/suivi_prospects", key: "<id>", worker: "<ton prénom>", state: "busy" }),
        }
        const verdicts: Record<string, [string, string][]> = {}
        for (const [rule, block] of Object.entries(cases)) {
          verdicts[rule] = (await check(stored([heading("Étapes"), steps(["Fais :"]), block]))).refusals.map((refusal) => [refusal.kind, refusal.message])
        }
        expect(verdicts).toEqual({
          R4: [["invalid_block", `${at}: a call block starts with a function name such as table.rows, found « acme_call »`]],
          "R9 (confirm)": [
            [
              "unknown_key",
              `${at}: « confirm » is an option of acme_call, not an argument of mail.send_draft; say in the step's text to call again with confirm: true after the user's explicit approval`,
            ],
          ],
          "R9 (team)": [
            [
              "unknown_key",
              `${at}: « team » is an option of acme_call, not an argument of mail.create_draft; the team comes from where the procedure lives, and the account from that team or the organisation`,
            ],
          ],
          "R9 (envelope)": [["unknown_key", `${at}: « function » belongs to the acme_call envelope; write only the arguments of mail.create_draft in the block`]],
          R11: [["missing_argument", `${at}: mail.create_draft needs argument « subject »; write "<…>" for a value known only when the procedure runs`]],
          R13: [["check_failed", `${at}: test.release: ${BUSY_REFUSAL}`]],
        })
      })
    })

    describe("checkProcedureBlocks — the connectors active in the organisation of the address (E01-S10 AC-x3)", () => {
      it("should refuse a function whose connector is inactive there, whatever another organisation of the person activated", async () => {
        // `mail` inactif dans O, actif dans P : la base rend les deux lignes à Léa ; le service ne retient que
        // celle d'O, et son état.
        await seed.admin`update platform.connector_activations set state = 'inactive' where org_id = ${ref.org.id} and connector = 'mail'`
        try {
          const { refusals } = await check(stored([heading("Étapes"), callBlock("mail.create_draft", { to: "<email du contact>", subject: "Relance", body: "<texte>" })]))
          expect(refusals.map((refusal) => [refusal.kind, refusal.message])).toEqual([
            [
              "function_not_active",
              "section « Étapes », call block 1: mail.create_draft belongs to connector mail, which is not enabled for Acme Test; an administrator enables it on the dashboard",
            ],
          ])
        } finally {
          await seed.admin`update platform.connector_activations set state = 'active' where org_id = ${ref.org.id} and connector = 'mail'`
        }
      })
    })

    describe("checkProcedureBlocks — blocks, not text (AC12)", () => {
      it("should leave a paragraph that names a call and a code block of another language unchecked", async () => {
        const { refusals, sent } = await check(
          stored([heading("Règles"), paragraph('Ne relâche jamais avec table.release {"state": "en cours"}.'), code('{"function": "x.unknown", "arguments": {}}', "json")]),
        )
        expect(refusals).toEqual([])
        // Sans bloc `call`, aucune lecture des connecteurs ; le même espion voit celle d'un bloc `call` (témoin).
        expect(sent).toEqual([])
        expect((await check(stored([callBlock("x.witness")]))).sent.map((query) => query.target)).toEqual(["connector_activations"])
      })
    })
  },
)
