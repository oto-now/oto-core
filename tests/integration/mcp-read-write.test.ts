// @vitest-environment node
// `read` et `write` sur une vraie base (E03-S03), les deux seuls tests de la story dont la base est le
// sujet : AC38, bout en bout par `InMemoryTransport` sous le jeton de chaque personne (`open_draft`,
// blocs sous leurs invariants et leurs droits de colonne, `publish_node`, `links`) ; AC25, part de la
// base : deux personnes écrivent deux blocs différents du même brouillon en même temps (ADR-011,
// Conséquences). Organisation de référence jetable (H120), sessions par `fx.sessionFor`. Suite portable
// (E11-S14) : personnes sans compte, jetons signés localement (`tests/helpers/session-locale.ts`) ;
// depuis E01-S10 f2, les relectures passent par la connexion d'administration, plus par PostgREST.
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { connectMcp } from "../helpers/mcp"
import { hex } from "../helpers/plateforme"
import { createLocalFixtures, type LocalFixtures } from "../helpers/session-locale"
import { portable, sqlConfigured, testAdminSql, type SqlReferenceOrg, type TestSql } from "../helpers/sql"
import { privateFolderPending, privateFolderSuite } from "../helpers/pending-migrations"

// Ces tests supposent le dossier `private` en base (fiche D107) : sautés, la version nommée, tant que
// 20260928120000 n'est pas appliquée au projet (`database-patterns.md § Règles`).
const privatePending = await privateFolderPending()

const NETWORK_TIMEOUT = 120_000
const SUITE = "read and write through MCP on a real database"

type Person = "lea" | "claire"

describe.skipIf(!sqlConfigured || privatePending)(
  privateFolderSuite(portable(SUITE), privatePending),
  { timeout: NETWORK_TIMEOUT },
  () => {
    let fx: LocalFixtures
    let admin: TestSql
    let ref: SqlReferenceOrg
    const tokens = {} as Record<Person, string>

    beforeAll(async () => {
      fx = createLocalFixtures()
      admin = testAdminSql()
      ref = await fx.buildReferenceOrg()
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
      const { code } = await connected.openContext("Écris le compte rendu de la réunion")
      /** Un appel d'outil ; ses deux canaux portent le même texte (H26). */
      const call = async (tool: string, args: Record<string, unknown>) => {
        const answer = await connected.call(tool, { ctx: code, ...args })
        expect(answer.isError, `${tool}: ${answer.text}`).toBe(false)
        expect((answer.result.structuredContent as { text?: string } | undefined)?.text).toBe(answer.text)
        return answer
      }
      /** Un appel d'outil dont la réponse peut être un refus (E10-S04). */
      const answer = (tool: string, args: Record<string, unknown>) => connected.call(tool, { ctx: code, ...args })
      return { ...connected, call, answer, code }
    }

    it("should write a report as an assistant writes it, publish it and read it back identically, and name a refusal (E10-S04)", async () => {
      const lea = await session("lea", `md-${hex(4)}`)
      const claire = await session("claire", `md-${hex(4)}`)
      const path = `ventes/cr_md_${hex(3)}`
      const body = [
        "Réunion du **lundi** : ~~report~~ maintenu.<br>Voir [[ventes/devis]].",
        "---",
        "| Sujet | Décision | Échéance |\n| :--- | :---: | ---: |\n| Devis \\| Acme | Relancer | vendredi |\n| Pré-étude |  | 15/10 |",
        "- Actions\n  - Léa : relancer\n    1. appeler\n    2. écrire\n  - Paul : chiffrer\n- Suivi",
        "### Détail\n\nTexte.\n\n#### Précision\n\n##### Note\n\n###### Fin",
        "<details>\n<summary>Notes brutes</summary>\n\nTout ce qui a été dit.\n\n</details>",
      ].join("\n\n")
      await lea.call("write", { path, title: "CR markdown", summary: "Compte rendu en markdown.", ops: [{ op: "add_section", section: "Réunion", text: body }], publish: false })
      expect((await claire.call("write", { path, base_revision: 0, publish: true })).text).toMatch(new RegExp(`^Published ${path} revision 1 `))
      expect((await lea.call("read", { path, section: "Réunion" })).text).toContain(`\n\n## Réunion\n\n${body}\n\nTo edit`)

      const refused = await lea.answer("write", { path, base_revision: 1, ops: [{ op: "append", section: "Réunion", text: "| a | b |\n| --- | --- |\n| x | y | z |" }] })
      expect(refused.isError).toBe(true)
      expect(refused.text).toContain("line 3: this row has 3 cells; the header has 2.")
    })

    it("should chain context, write, publish, read with references, write one block and read the draft, journaled per call (AC38)", async () => {
      const agent = `rw-${hex(4)}`
      const lea = await session("lea", agent)
      const claire = await session("claire", agent)
      const path = `ventes/cr_${hex(3)}`
      const created = await lea.call("write", {
        path,
        title: "CR de la réunion",
        summary: "Compte rendu de test.",
        ops: [{ op: "add_section", section: "Décisions", text: "Lancer la pré-étude.\n\nRelancer Acme." }],
        publish: false,
      })
      expect(created.text.split("\n")[0]).toMatch(new RegExp(`^Draft of ${path} created \\(revision 0\\): added « Décisions »`))
      expect((await claire.call("write", { path, base_revision: 0, publish: true })).text).toBe(`Published ${path} revision 1 (1 section, 3 blocks). Next write: base_revision 1.`)

      const section = await lea.call("read", { path, section: "Décisions", refs: true })
      const blockRef = /<!-- ref: (\S+) -->\nRelancer Acme\./.exec(section.text)?.[1]
      expect(blockRef).toBeTruthy()
      await lea.call("write", { path, base_revision: 1, ops: [{ op: "replace_block", block: blockRef, text: "Relancer Acme vendredi." }], publish: false })
      const draft = await lea.call("read", { path, draft: true })
      expect(draft.text).toContain("\n\n## Décisions\n\nLancer la pré-étude.\n\nRelancer Acme vendredi.")
      const node = await fx.nodeId(ref.org.id, path)
      const blocks = await admin<{ id: string }[]>`select id, text, revision, provenance from platform.blocks where node_id = ${node} and state = 'draft'`
      // La provenance posée par l'adaptateur MCP : l'assistant de Léa, avec le `ctx` de la conversation (AC28).
      expect(blocks.find((block) => block.id.startsWith(String(blockRef)))).toMatchObject({
        text: "Relancer Acme vendredi.",
        revision: 2,
        provenance: { origin: "agent", by: ref.people.lea.id, ctx: lea.code },
      })

      await Promise.all([lea.flush(), claire.flush()])
      const lines = await admin<{ user_id: string | null; tool: string | null; target: string | null; team_id: string | null; is_error: boolean }[]>`
        select user_id, tool, target, team_id, is_error from platform.journal
        where org_id = ${ref.org.id} and user_agent = ${agent} and method = 'tools/call' order by id`
      // Chaque session écrit ses lignes d'un coup : l'ordre se lit par personne.
      const of = (person: Person) =>
        lines
          .filter((line) => line.user_id === ref.people[person].id && line.tool !== `${ref.org.prefix}_context`)
          .map((line) => [line.tool, line.target, line.team_id, line.is_error])
      const expected = (tools: string[]) => tools.map((tool) => [`${ref.org.prefix}_${tool}`, path, ref.teams.ventes, false])
      expect([of("lea"), of("claire")]).toEqual([expected(["write", "read", "write", "read"]), expected(["write"])])
    })

    // E11-S02 (AC-b1, AC-a2) : écrire publie, au niveau écriture ; `publish: false` garde un brouillon.
    it("should publish a write without publish, keep a draft with publish: false, and publish a table header at the write level", async () => {
      const lea = await session("lea", `pub-${hex(4)}`)
      const path = `ventes/faq_${hex(3)}`
      const created = await lea.call("write", { path, title: "FAQ", summary: "Questions fréquentes.", ops: [{ op: "add_section", section: "Livraison", text: "Sous huit jours." }] })
      expect(created.isError, created.text).toBe(false)
      // E11-S18 (AC-4) : une ligne, la publication et ce que l'écriture a fait.
      expect(created.text).toBe(`Published ${path} revision 1 (1 section, 2 blocks): added « Livraison » (30 characters). Next write: base_revision 1.\nSpace: team Ventes (lead: Claire Morel): its members see it.`)
      expect(created.result.structuredContent).toMatchObject({ status: "published", revision: 1 })
      const drafted = await lea.call("write", { path, base_revision: 1, ops: [{ op: "append", section: "Livraison", text: "Hors week-end." }], publish: false })
      expect(drafted.text.split("\n")[1]).toBe(`Publish it with ${ref.org.prefix}_write {"path": "${path}", "base_revision": 1, "publish": true}.`)
      expect(drafted.result.structuredContent).toMatchObject({ status: "published", revision: 1, has_draft: true })

      const table = `ventes/salons_${hex(3)}`
      const header = { columns: [{ name: "nom", type: "text" }], key: "nom" }
      const made = await lea.call("write", { path: table, kind: "table", title: "Salons", summary: "Les salons.", header })
      expect(made.text).toBe(`Published ${table} revision 1: a table with 1 column, key nom. Write rows with ${ref.org.prefix}_call table.write. Next write: base_revision 1.\nSpace: team Ventes (lead: Claire Morel): its members see it.`)
      const changed = await lea.call("write", { path: table, base_revision: 1, header: { columns: [{ name: "ville", type: "text" }], closed: true } })
      expect(changed.text).toBe(`Published ${table} revision 2: added ville; closed. Next write: base_revision 2.`)
      expect((await lea.call("read", { path: table })).text).toContain("\naccess: write (write and publish; sharing, moving and deleting are reserved to team Ventes (lead: Claire Morel))\n")
    })

    it("should keep both changes when two people write two different blocks of the same draft at once (AC25)", async () => {
      const path = `ventes/devis_${hex(3)}`
      const node = await fx.createNode(ref.org.id, { parentId: ref.nodes.ventes, path, title: "Devis" })
      await fx.publishBlocks(node, [{ type: "paragraph", text: "Premier." }, { type: "paragraph", text: "Second." }])
      const [first, second] = await fx.draftBlocks(node, [{ type: "paragraph", text: "Premier." }, { type: "paragraph", text: "Second." }], { title: "Devis en cours" })
      const agent = `rw-${hex(4)}`
      const [lea, claire] = await Promise.all([session("lea", agent), session("claire", agent)])
      await Promise.all([
        lea.call("write", { path, base_revision: 1, ops: [{ op: "replace_block", block: first.slice(0, 8), text: "Premier, par Léa." }], publish: false }),
        claire.call("write", { path, base_revision: 1, ops: [{ op: "replace_block", block: second.slice(0, 8), text: "Second, par Claire." }], publish: false }),
      ])
      const blocks = await admin<{ id: string; text: string | null }[]>`select id, text from platform.blocks where node_id = ${node} and state = 'draft' order by position`
      expect(blocks.map((block) => [block.id, block.text])).toEqual([
        [first, "Premier, par Léa."],
        [second, "Second, par Claire."],
      ])
    })
  },
)
