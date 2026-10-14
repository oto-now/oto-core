// @vitest-environment node
// Procédures de bout en bout sur une vraie base (E03-S06, AC11), seul test de la story dont la base est le
// sujet : `write` d'une procédure par Léa, clôtures ```call indentées sous leurs étapes (forme de la
// maquette) ; publication par Claire (`open_draft`, `publish_node` sur le tampon du brouillon) ; `context`
// qui la sert, appels sous leurs clôtures ; refus exact d'une clôture qui cite une fonction inconnue ;
// journal. Organisation de référence jetable (H120), `mail` activé, sessions par `fx.sessionFor`. Suite
// portable (E11-S14) : personnes sans compte, jetons signés localement (`tests/helpers/session-locale.ts`) ;
// relectures par la connexion d'administration.
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { renderBlocks, type BlockInput } from "../../packages/plateforme/schemas"
import { connectMcp } from "../helpers/mcp"
import { hex } from "../helpers/plateforme"
import { createLocalFixtures, type LocalFixtures } from "../helpers/session-locale"
import { portable, sqlConfigured, testAdminSql, type SqlReferenceOrg, type TestSql } from "../helpers/sql"
import { privateFolderPending, privateFolderSuite } from "../helpers/pending-migrations"

// Ces tests supposent le dossier `private` en base (fiche D107) : sautés, la version nommée, tant que
// 20260928120000 n'est pas appliquée au projet (`database-patterns.md § Règles`).
const privatePending = await privateFolderPending()

const NETWORK_TIMEOUT = 120_000

type Person = "lea" | "claire"

const DRAFT_CALL = 'mail.create_draft {"to": "<email du contact>", "subject": "Suite à notre échange", "body": "<texte>"}'
const SEND_CALL = 'mail.send_draft {"id": "<id du brouillon>"}'
const SEND_STEP = "Après l'accord explicite de la personne, envoie chaque brouillon ; le premier appel rend un récapitulatif, rappelle avec confirm: true après son accord :"

/** Les blocs que l'analyse d'E03-S03 tire de l'opération de Léa : listes coupées par les blocs `call`, numéros repris par `start`. */
const EXPECTED: BlockInput[] = [
  { type: "heading", text: "Étapes", data: { level: 1 } },
  { type: "list", text: null, data: { items: ["Annonce en une phrase ce que tu vas faire.", "Prépare un brouillon pour chaque prospect :"], ordered: true } },
  { type: "call", text: null, data: { function: "mail.create_draft", args: { to: "<email du contact>", subject: "Suite à notre échange", body: "<texte>" } } },
  { type: "list", text: null, data: { items: [SEND_STEP], ordered: true, start: 3 } },
  { type: "call", text: null, data: { function: "mail.send_draft", args: { id: "<id du brouillon>" } } },
]

const SUITE = "procedures through MCP on a real database"

describe.skipIf(!sqlConfigured || privatePending)(
  privateFolderSuite(portable(SUITE), privatePending),
  { timeout: NETWORK_TIMEOUT },
  () => {
    let fx: LocalFixtures
    let admin: TestSql
    let ref: SqlReferenceOrg
    // Rempli pour chaque personne par `beforeAll`, avant tout test : l'objet vide n'est jamais lu tel quel.
    const tokens = {} as Record<Person, string>

    beforeAll(async () => {
      fx = createLocalFixtures()
      admin = testAdminSql()
      ref = await fx.buildReferenceOrg()
      await fx.addActivation(ref.org.id, "mail")
      for (const person of ["lea", "claire"] as const) tokens[person] = (await fx.sessionFor(ref.people[person])).accessToken
    }, NETWORK_TIMEOUT)

    afterAll(async () => {
      try {
        await fx?.cleanup()
      } finally {
        await admin?.end({ timeout: 5 })
      }
    }, NETWORK_TIMEOUT)

    async function session(person: Person, userAgent: string) {
      const connected = await connectMcp({ host: ref.host }, { id: ref.people[person].id, email: ref.people[person].email, accessToken: tokens[person] }, userAgent)
      const { code } = await connected.openContext("Écris une procédure de relance")
      const call = (tool: string, args: Record<string, unknown>) => connected.call(tool, tool === "context" ? args : { ctx: code, ...args })
      return { ...connected, call }
    }

    it("should write, publish and serve a procedure whose steps call functions, and refuse a fence that cites an unknown function (AC11)", async () => {
      const agent = `proc-${hex(4)}`
      const path = `ventes/relance_${hex(3)}`
      const prefix = ref.org.prefix
      const [lea, claire] = await Promise.all([session("lea", agent), session("claire", agent)])
      const text = [
        "1. Annonce en une phrase ce que tu vas faire.",
        "2. Prépare un brouillon pour chaque prospect :",
        "   ```call",
        `   ${DRAFT_CALL}`,
        "   ```",
        `3. ${SEND_STEP}`,
        "   ```call",
        `   ${SEND_CALL}`,
        "   ```",
      ].join("\n")
      const created = await lea.call("write", {
        path,
        kind: "procedure",
        title: "Relancer les prospects par email",
        summary: "Prépare et envoie les emails de relance des prospects, sur demande « relance les prospects par email ».",
        ops: [{ op: "add_section", section: "Étapes", text }],
        publish: false,
      })
      expect(created.isError, created.text).toBe(false)
      const published = await claire.call("write", { path, base_revision: 0, publish: true })
      // 1.4.3 : une procédure sans partie « Quand l'utiliser » se publie, avec un avertissement.
      expect(published.text).toBe(`Published ${path} revision 1 (1 section, 5 blocks). Next write: base_revision 1.\nWarnings:\n- Procedure: no part « When to use it » (or « Quand l'utiliser »): say when to use it, when not, and where to go instead (read path help, section procedures).`)
      const node = await fx.nodeId(ref.org.id, path)
      const blocks = await admin<{ type: string; text: string | null; data: unknown }[]>`
        select type, text, data from platform.blocks where node_id = ${node} and state = 'published' order by position`
      expect(blocks).toEqual(EXPECTED)

      // Rendus tels que la base les garde : `jsonb` range les clés des arguments (par longueur, puis octets).
      const served = await lea.call("context", { phrase: "relance les prospects par email" })
      expect(served.text).toContain(
        [
          `## Procedure ${path} (v1): Relancer les prospects par email`,
          "Follow these steps now. Ask the user's explicit approval before anything that sends, or that changes data beyond the steps of the procedure the user asked for.",
          `A \`\`\`call block holds <function> <arguments JSON>: run it with ${prefix}_call {"function": "<function>", "arguments": <arguments JSON>}, replacing each "<…>" value with the real one.`,
          "",
          renderBlocks([...blocks], { headingBase: 3 }),
        ].join("\n"),
      )
      expect(served.text).toContain('```call\nmail.send_draft {"id":"<id du brouillon>"}\n```')

      const appended = await lea.call("write", { path, base_revision: 1, ops: [{ op: "append", section: "Étapes", text: '4. Vérifie l\'envoi :\n   ```call\n   mail.send {"id": "<id>"}\n   ```' }], publish: false })
      expect(appended.isError, appended.text).toBe(false)
      const refused = await claire.call("write", { path, base_revision: 1, publish: true })
      expect([refused.isError, refused.text]).toEqual([
        true,
        [
          // E11-S18 (AC-1) : rien d'écrit par ce refus ; le brouillon écrit avant par `publish: false` reste.
          `Publication of ${path} refused: 1 problem(s). Nothing was written; the draft saved before this call stays.`,
          `- section « Étapes », call block 3 (step 4): unknown function « mail.send »; ${prefix}_find with type function lists the functions`,
          `Fix them with ${prefix}_write (ops on the sections), then publish again. Format and rules: ${prefix}_read {"path": "write.procedure"}.`,
          "Writing it in several calls? Pass publish: false until the last one.",
        ].join("\n"),
      ])

      await Promise.all([lea.flush(), claire.flush()])
      const lines = await admin<{ user_id: string | null; tool: string | null; target: string | null; is_error: boolean }[]>`
        select user_id, tool, target, is_error from platform.journal
        where org_id = ${ref.org.id} and user_agent = ${agent} and method = 'tools/call' order by id`
      // Chaque session écrit ses lignes d'un coup : l'ordre se lit par personne.
      const of = (person: Person) => lines.filter((line) => line.user_id === ref.people[person].id).map((line) => [line.tool?.replace(`${prefix}_`, ""), line.target, line.is_error])
      expect([of("lea"), of("claire")]).toEqual([
        [
          ["context", "Écris une procédure de relance", false],
          ["write", path, false],
          ["context", path, false],
          ["write", path, false],
        ],
        [
          ["context", "Écris une procédure de relance", false],
          ["write", path, false],
          ["write", null, true],
        ],
      ])
    })
  },
)
