// @vitest-environment node
// `read` sur une base réelle (E03-S03, AC4 à AC18 ; E01-S10, lot t1-b) : l'organisation O de la graine du
// fichier, chaque cas y écrivant ses tables simulées (`replaceContent`), sans règle d'accès en base ; la base
// rend toutes les lignes de O (RLS d'isolation seule) : chaque filtre et chaque refus sont prouvés par le
// service (`security-patterns.md § Droits dans le service`), l'espion des requêtes (`spyDb`) montre ce qui
// n'est pas lu. Textes servis comparés mot pour mot. En suite portable (`sqlConfigured`) : le projet, ou le Postgres nu du job `bare-postgres`.
import * as z from "zod/v4"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { formatResult } from "../../packages/plateforme/mcp/result"
import { renderBlocks, type BlockInput, type ReadNodeInput } from "../../packages/plateforme/schemas"
import { defineFunction } from "../../packages/plateforme/server/catalog/define"
import { catalogFunctions, describeFunction } from "../../packages/plateforme/server/catalog/registry"
import { diffBlocks, samePublishedContent } from "../../packages/plateforme/server/nodes/diff"
import { displayRefs, type DocBlock } from "../../packages/plateforme/server/nodes/document"
import type { NodeRow } from "../../packages/plateforme/server/nodes/lookup"
import { applyOps } from "../../packages/plateforme/server/nodes/ops"
import { readNode } from "../../packages/plateforme/server/nodes/read"
import { staleState } from "../../packages/plateforme/server/nodes/read-format"
import {
  addBlocks,
  addVersion,
  blockUuid,
  CONTENT_AT,
  contentTables,
  identityOf,
  openDraftRow,
  ORG,
  OTHER_ORG,
  TEAMS,
  type ContentNode,
  type Person,
  type RuleSpec,
} from "../helpers/reference-org"
import { seedReferenceOrg, type ReferenceOrgSql } from "../helpers/reference-org-sql"
import type { Tables } from "../helpers/simulated-db"
import { draftReads, replaceContent, sameInstant, spyDb } from "../helpers/spy-t1-b"
import { sqlConfigured, seedWithAdmin, type SeededData, portable } from "../helpers/sql"

vi.mock("../../packages/plateforme/server/catalog/registry", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../packages/plateforme/server/catalog/registry")>()
  const catalogFunctions = vi.fn((): ReturnType<typeof original.catalogFunctions> => [])
  return { ...original, catalogFunctions, assistantFunctions: () => catalogFunctions().filter((fn) => fn.serverOnly !== true) }
})

afterEach(() => {
  vi.mocked(catalogFunctions).mockReturnValue([])
})

const NETWORK_TIMEOUT = 60_000
const SETUP_TIMEOUT = 180_000

const heading = (text: string, level: 1 | 2 | 3 | 4 | 5 = 1, key?: string): BlockInput => ({ type: "heading", text, data: { level }, key })
const paragraph = (text: string): BlockInput => ({ type: "paragraph", text, data: {} })
const list = (items: string[], ordered = false): BlockInput => ({ type: "list", text: null, data: ordered ? { items, ordered } : { items } })

const DAY = CONTENT_AT.slice(0, 10)
const MODELE: ContentNode = {
  path: "ventes/modele_relance",
  title: "Modèle d'email de relance",
  summary: "Le modèle d'email de relance d'un devis, à personnaliser.",
  revision: 2,
}
const MODELE_BLOCKS = [heading("Objet", 1, "objet"), paragraph("Bonjour,"), heading("Corps"), paragraph("Je reviens vers vous."), list(["Relire", "Envoyer"], true)]
const MODELE_MARKDOWN = "## Objet\n\nBonjour,\n\n## Corps\n\nJe reviens vers vous.\n\n1. Relire\n2. Envoyer"

function base(nodes: ContentNode[] = [], rules: RuleSpec[] = []): Tables {
  return contentTables(rules, [{ path: "ventes", title: "Ventes" }, { path: "conseil", title: "Conseil" }, ...nodes])
}

function modele(): Tables {
  const tables = base([MODELE])
  addBlocks(tables, MODELE.path, "published", MODELE_BLOCKS)
  return tables
}

describe.skipIf(!sqlConfigured)(portable("read on a real database"), { timeout: NETWORK_TIMEOUT }, () => {
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

  async function read(person: Person, input: ReadNodeInput, options: { views?: boolean } = {}) {
    const spied = spyDb(await ref.db(person))
    const output = await readNode(spied.db, who(person), input, options)
    return { ...output, calls: spied.calls }
  }

  async function refusal(person: Person, input: ReadNodeInput): Promise<unknown> {
    return read(person, input).then(
      () => null,
      (error: unknown) => error,
    )
  }

  describe("read — header and page (AC4 to AC8)", () => {
    it("should serve a short page whole, after the exact header of its reader, and name the team in the journal (AC4)", async () => {
      await content(modele())
      const lea = await read("lea", { path: MODELE.path })
      expect(lea.text).toBe(
        [
          "# Modèle d'email de relance",
          `path: ventes/modele_relance · page · published · revision 2 · updated ${DAY}`,
          "summary: Le modèle d'email de relance d'un devis, à personnaliser.",
          "owner: team Ventes (lead: Claire Morel)",
          "access: write (write and publish; sharing, moving and deleting are reserved to team Ventes (lead: Claire Morel))",
          "parent: ventes — Ventes",
          "children: none",
          "links in: none",
          "links out: none",
          "",
          MODELE_MARKDOWN,
          "",
          'To edit: acme_write {"path": "ventes/modele_relance", "base_revision": 2, "ops": [...]}.',
        ].join("\n"),
      )
      expect(lea.data).toMatchObject({
        path: MODELE.path,
        title: MODELE.title,
        kind: "page",
        status: "published",
        revision: 2,
        updated_at: sameInstant(CONTENT_AT),
        owner: "team Ventes (lead: Claire Morel)",
        level: 2,
        parent: { path: "ventes", title: "Ventes" },
        children: [],
        children_total: 0,
        // « ## Objet » (8), « Bonjour, » (8) ; « ## Corps » (8), le paragraphe (21), la liste (20) ; lignes vides : 2.
        outline: [
          { title: "Objet", level: 1, chars: 18 },
          { title: "Corps", level: 1, chars: 53 },
        ],
        sections_total: 2,
        blocks_total: 5,
        has_draft: false,
      })
      expect(JSON.stringify(lea.data)).not.toContain("Bonjour")
      expect([lea.nextActions, lea.target, lea.teamId]).toEqual([["acme_write"], MODELE.path, ref.id(TEAMS.ventes.id)])

      const withDraft = modele()
      openDraftRow(withDraft, MODELE.path)
      await content(withDraft)
      const drafted = await read("lea", { path: MODELE.path })
      expect(drafted.text).toContain(`children: none\nlinks in: none\nlinks out: none\ndraft: pending on revision 2 (saved ${DAY}): read it with draft: true\n\n## Objet`)
      expect(drafted.data).toMatchObject({ has_draft: true })

      const annonces = base([{ path: "annonces", title: "Annonces" }])
      openDraftRow(annonces, "annonces")
      await content(annonces)
      const marc = await read("marc", { path: "annonces" })
      expect(marc.text).toContain("owner: organisation Acme Test\naccess: read\nparent: guide — guide\n")
      expect(marc.text).not.toContain("draft:")
      expect(marc.text).not.toContain("To edit")
      expect([marc.nextActions, marc.data?.has_draft]).toEqual([[], false])
      expect(draftReads(marc.calls)).toEqual([])

      await content(base())
      expect((await read("lea", { path: "private/lea" })).text).toContain("owner: you (personal)\naccess: manage (write and publish, share, move, delete)\n")
      // Partagé par une règle sous l'espace de Claire, qu'Ada ne voit pas (D5) : le titre du parent serait une fuite (N56).
      await content(base([], [{ node: "private/claire/notes", user: "ada", level: "read" }]))
      const notes = await read("ada", { path: "private/claire/notes" })
      expect(notes.text).toContain("owner: Claire Morel (personal)\naccess: read\nparent: none\n")
      expect(notes.data?.parent).toBeNull()
    })

    it("should list 50 visible children by path, count them after the filter, and leave out an invisible one (AC5)", async () => {
      // Plus de 1 000 enfants : PostgREST en rend 1 000 par lecture (`max_rows`) ; le compte prouve la lecture
      // par pages (`supabase-patterns.md § Error Handling`). L'enfant invisible trie en tête : une borne posée
      // avant le filtre servirait 49 lignes (HN-E01S07-8).
      const children = Array.from({ length: 1060 }, (_, index): ContentNode => ({ path: `dossier/p${String(index + 1).padStart(4, "0")}`, summary: `Résumé ${index + 1}.` }))
      const support = { kind: "team" as const, teamId: TEAMS.support.id, userId: null }
      await content(base([{ path: "dossier", owner: { kind: "team", teamId: TEAMS.ventes.id, userId: null } }, ...children, { path: "dossier/a_secret", owner: support }]))
      const lea = await read("lea", { path: "dossier" })
      const lines = Array.from({ length: 50 }, (_, index) => `- dossier/p${String(index + 1).padStart(4, "0")} (page): Résumé ${index + 1}.`)
      expect(lea.text).toContain(["children (1,060):", ...lines, "- … and 1,010 more: open a child or use acme_find."].join("\n"))
      expect(lea.text).not.toContain("dossier/a_secret")
      expect(lea.data).toMatchObject({ children_total: 1060 })
      expect(lea.data?.children).toHaveLength(50)
    })

    it("should serve the root without parent, a table as one line, and a page never published (AC6)", async () => {
      await content(base())
      expect((await read("lea", { path: "guide" })).text).toContain("\nparent: none\n")
      await content(base([{ path: "ventes/suivi", kind: "table", title: "Suivi" }, { path: "ventes/cr", title: "CR", status: "draft", revision: 0 }]))
      const table = await read("lea", { path: "ventes/suivi" })
      // Un tableau est décrit par E07-S01 (`tableReadBody`) ; celui-ci, sans en-tête publié, en une ligne.
      expect(table.text.endsWith("children: none\nlinks in: none\nlinks out: none\n\nTable ventes/suivi has no published header yet: its owner publishes it with acme_write.")).toBe(true)
      for (const mode of [{ section: "x" }, { outline: true }, { since_revision: 0 }, { cursor: "x" }]) {
        expect(await refusal("lea", { path: "ventes/suivi", ...mode })).toMatchObject({
          code: "invalid_arguments",
          message: 'A table has no sections: read its rows with acme_call {"function": "table.rows", "arguments": {"table": "ventes/suivi"}}.',
        })
      }
      await ref.openDraft("ventes/suivi", { title: "Suivi des prospects" })
      const drafted = await read("lea", { path: "ventes/suivi", draft: true })
      expect(drafted.text).toContain(`draft: pending on revision 1 (saved ${DAY})\npending title: Suivi des prospects\n\nTable ventes/suivi has no published header yet:`)
      const never = await read("lea", { path: "ventes/cr" })
      expect(never.text).toContain("path: ventes/cr · page · draft · revision 0 ·")
      expect(never.text.endsWith('\n\nNo published revision yet.\n\nTo edit: acme_write {"path": "ventes/cr", "base_revision": 0, "ops": [...]}.')).toBe(true)
    })

    const TITLES = ["Objet de l'étude", "Collecte des données", "Dimensionnement", "Analyse", "Scénarios", "Budget prévisionnel", "Planning", "Risques", "Recommandations", "Annexes"]

    /** `conseil/methode_etude` : début de page de 200 caractères, dix titres, deux sous-titres sous « Dimensionnement ». */
    function methode(): { tables: Tables; sizes: Map<string, number>; page: number } {
      const blocks: BlockInput[] = [paragraph("i".repeat(200))]
      for (const title of TITLES) {
        if (title !== "Dimensionnement") blocks.push(heading(title), paragraph("t".repeat(2300)))
        else blocks.push(heading(title), paragraph("d".repeat(2000)), heading("Hypothèses", 2), paragraph("h".repeat(1000)), heading("Calcul", 2), paragraph("c".repeat(1000)))
      }
      const tables = base([{ path: "conseil/methode_etude", title: "Méthode d'étude", summary: "La méthode." }])
      addBlocks(tables, "conseil/methode_etude", "published", blocks)
      const sizes = new Map(TITLES.map((title) => [title, 3 + title.length + 2 + 2300]))
      sizes.set("Dimensionnement", 18 + 2 + 2000 + 2 + (14 + 2 + 1000) + 2 + (10 + 2 + 1000))
      sizes.set("Hypothèses", 14 + 2 + 1000)
      sizes.set("Calcul", 10 + 2 + 1000)
      const page = 200 + TITLES.reduce((total, title) => total + 2 + (sizes.get(title) ?? 0), 0)
      return { tables, sizes, page }
    }

    function outline(sizes: Map<string, number>): string[] {
      return TITLES.flatMap((title) => {
        const line = `- ${title} (${(sizes.get(title) ?? 0).toLocaleString("en-US")} characters)`
        if (title !== "Dimensionnement") return [line]
        return [line, `  - Hypothèses (${(sizes.get("Hypothèses") ?? 0).toLocaleString("en-US")} characters)`, `  - Calcul (${(sizes.get("Calcul") ?? 0).toLocaleString("en-US")} characters)`]
      })
    }

    it("should serve a long page as its start and outline, and a long page without title whole (AC7)", async () => {
      const { tables, sizes, page } = methode()
      await content(tables)
      const marc = await read("marc", { path: "conseil/methode_etude" })
      const expected = [
        "i".repeat(200),
        "",
        `outline (12 sections, ${page.toLocaleString("en-US")} characters, over the 12,000-character page limit):`,
        // E11-S03 (AC-c3) : les blocs d'avant le premier titre, en première ligne, hors du compte des sections.
        "- (start of page, 200 characters)",
        ...outline(sizes),
        'Read one with acme_read {"path": "conseil/methode_etude", "section": "<title>"}.',
      ].join("\n")
      expect(marc.text.endsWith(`children: none\nlinks in: none\nlinks out: none\n\n${expected}`)).toBe(true)
      expect(marc.text.length).toBeLessThan(3500)
      // E11-S19 (AC-e2, HN-E11S19-9) : le plan est dans le texte, pas une seconde fois en données.
      expect(marc.data).not.toHaveProperty("outline")
      expect(marc.data).toMatchObject({ sections_total: 12 })
      const flat = base([{ path: "conseil/texte" }])
      addBlocks(flat, "conseil/texte", "published", Array.from({ length: 13 }, (_, index) => paragraph(String(index).repeat(1000))))
      await content(flat)
      expect((await read("marc", { path: "conseil/texte" })).text).toContain(`${"12".repeat(1000)}`)
      // 2026-10-27 : une procédure se sert entière au-delà de 12 000 caractères, sans plan : ses étapes se suivent en entier.
      const procedure = base([{ path: "conseil/procedure_longue", kind: "procedure", title: "Procédure longue", summary: "Longue." }])
      addBlocks(procedure, "conseil/procedure_longue", "published", [heading("Étape 1"), paragraph("a".repeat(7000)), heading("Étape 2"), paragraph("b".repeat(7000))])
      await content(procedure)
      const steps = await read("marc", { path: "conseil/procedure_longue" })
      expect([steps.text.includes("a".repeat(7000)), steps.text.includes("b".repeat(7000)), steps.text.includes("outline (")]).toEqual([true, true, false])
    })

    it("should serve the outline asked for, without the start of the page nor the limit (AC8)", async () => {
      await content(modele())
      const lea = await read("lea", { path: MODELE.path, outline: true })
      expect(lea.text.endsWith('\n\noutline (2 sections, 73 characters):\n- Objet (18 characters)\n- Corps (53 characters)\nRead one with acme_read {"path": "ventes/modele_relance", "section": "<title>"}.')).toBe(true)
      expect(lea.text).not.toContain("Bonjour")
      expect(lea.data).not.toHaveProperty("outline")
    })
  })

  describe("read — sections and modes (AC9, AC10)", () => {
    it("should serve a section with its sub-sections, every homonym, and list the titles of an unknown one (AC9)", async () => {
      const blocks: BlockInput[] = [heading("Objet de l'étude"), paragraph("o"), heading("Dimensionnement"), paragraph("d"), heading("Hypothèses", 2), paragraph("h"), heading("Calcul", 2), paragraph("c"), heading("Exemple"), paragraph("e1"), heading("Exemple"), paragraph("e2")]
      const tables = base([{ path: "conseil/methode_etude" }])
      addBlocks(tables, "conseil/methode_etude", "published", blocks)
      await content(tables)
      const ada = await read("ada", { path: "conseil/methode_etude", section: "dimensionnement" })
      // E11-S19 (AC-e1) : le plan de la page n'accompagne pas une section ; son nombre de sections reste.
      expect(ada.data).not.toHaveProperty("outline")
      expect(ada.data).toMatchObject({ sections_total: 6 })
      expect(ada.text.endsWith('\n\n## Dimensionnement\n\nd\n\n### Hypothèses\n\nh\n\n### Calcul\n\nc\n\nTo edit: acme_write {"path": "conseil/methode_etude", "base_revision": 1, "ops": [...]}.')).toBe(true)
      expect((await read("ada", { path: "conseil/methode_etude", section: "exemple" })).text).toContain("\n\n## Exemple\n\ne1\n\n## Exemple\n\ne2\n\nTo edit")
      expect(await refusal("ada", { path: "conseil/methode_etude", section: "Budget" })).toMatchObject({
        code: "not_found",
        message: "Unknown section « Budget » in conseil/methode_etude. Sections: « Objet de l'étude », « Dimensionnement », « Hypothèses », « Calcul », « Exemple », « Exemple ».",
      })
    })

    it("should outline five heading levels and serve a level-4 section with its level-5 sub-section (E10-S04, AC-b3)", async () => {
      const blocks: BlockInput[] = ([1, 2, 3, 4, 5] as const).flatMap((level) => [heading(`Niveau ${level}`, level), paragraph(`p${level}`)])
      const tables = base([{ path: "conseil/niveaux" }])
      addBlocks(tables, "conseil/niveaux", "published", blocks)
      await content(tables)
      const outlined = await read("ada", { path: "conseil/niveaux", outline: true })
      expect(outlined.text).toContain("\n- Niveau 1 (")
      expect(outlined.text).toContain("\n        - Niveau 5 (")
      const section = await read("ada", { path: "conseil/niveaux", section: "Niveau 4" })
      expect(section.text).toContain("\n\n##### Niveau 4\n\np4\n\n###### Niveau 5\n\np5\n\nTo edit")
      // `replace_section` sur un titre de niveau 4 : un sous-niveau `######` passe, un titre de son niveau est refusé.
      const docBlocks = blocks.map((block, index): DocBlock => ({ id: blockUuid(900 + index), type: block.type, text: block.text ?? null, data: block.data ?? {}, key: block.key ?? null, position: index + 1, revision: 1, provenance: {} }))
      const replaced = applyOps(docBlocks, [{ op: "replace_section", section: "Niveau 4", text: "p\n\n###### Fin" }], { path: "conseil/niveaux" })
      expect(replaced.blocks.slice(6).map((block) => block.text)).toEqual(["Niveau 4", "p", "Fin"])
      expect(() => applyOps(docBlocks, [{ op: "replace_section", section: "Niveau 4", text: "##### Autre" }], { path: "conseil/niveaux" })).toThrow(
        "line 1 « ##### Autre » is a heading at the level of « Niveau 4 » or above; add a new section with add_section, or use ###### for a sub-section.",
      )
    })

    // Story widgets-dans-la-conversation : la vue `page` porte les blocs d'une page servie entière, rien d'autre.
    it("should add the served blocks and the page view to a page served whole, widgets on only", async () => {
      await content(modele())
      const whole = await read("lea", { path: MODELE.path }, { views: true })
      expect(whole.view).toBe("page")
      expect(whole.data?.blocks).toEqual(MODELE_BLOCKS.map(({ type, text, data }) => ({ type, text, data })))
      const off = await read("lea", { path: MODELE.path })
      expect([off.view, off.data?.blocks]).toEqual([undefined, undefined])
      const modes: ReadNodeInput[] = [{ path: MODELE.path, section: "Corps" }, { path: MODELE.path, outline: true }, { path: MODELE.path, since_revision: 0 }]
      for (const input of modes) {
        const partial = await read("lea", input, { views: true })
        expect([partial.view, partial.data?.blocks], JSON.stringify(input)).toEqual([undefined, undefined])
      }
    })

    it("should refuse two modes at once (AC10)", async () => {
      await content(modele())
      expect(await refusal("lea", { path: MODELE.path, section: "Objet", since_revision: 1 })).toMatchObject({
        code: "invalid_arguments",
        message: "Give only one of section, outline or since_revision.",
      })
    })
  })

  describe("read — revisions, drafts, references, cursor (AC11 to AC15)", () => {
    const [A, B, C, D, E, F] = [1, 2, 3, 4, 5, 6].map((rank) => blockUuid(0x9000 + rank))

    /** `support/faq` en révision 3 (D, A, B', F, C, « FAQ support ») ; révisions 1 (A…E, « FAQ ») et 2 (comme la 3). */
    function faq(): Tables {
      const tables = base([{ path: "support/faq", title: "FAQ support", summary: "Questions.", revision: 3 }])
      const current = [
        { ...paragraph("Écrire à support@acme.test."), id: D },
        { ...heading("Délais"), id: A },
        { ...paragraph("Nous répondons sous 24 h ouvrées."), id: B, revision: 2 },
        { ...paragraph("Le samedi, réponse le lundi."), id: F },
        { ...heading("Contacts"), id: C },
      ]
      addBlocks(tables, "support/faq", "published", current)
      const snapshot = (blocks: typeof current) => blocks.map(({ id, type, text, data }, index) => ({ id, type, text: text ?? null, data, key: null, position: 1024 * (index + 1), provenance: {}, revision: 1 }))
      const first = [{ ...heading("Délais"), id: A }, { ...paragraph("Nous répondons sous 48 h."), id: B }, { ...heading("Contacts"), id: C }, { ...paragraph("Écrire à support@acme.test."), id: D }, { ...list(["Téléphone", "Chat"]), id: E }]
      addVersion(tables, "support/faq", { revision: 1, title: "FAQ", summary: "Questions.", blocks: snapshot(first) })
      addVersion(tables, "support/faq", { revision: 2, title: "FAQ support", summary: "Questions.", blocks: snapshot(current) })
      addVersion(tables, "support/faq", { revision: 3, title: "FAQ support", summary: "Questions.", blocks: snapshot(current) })
      return tables
    }

    it("should give what changed since a revision, block by block, and refuse an unknown revision (AC11)", async () => {
      await content(faq())
      const paul = await read("paul", { path: "support/faq", since_revision: 1 })
      const changes = [
        "Changes from revision 1 to 3 (1 added, 1 changed, 1 moved, 1 deleted):",
        "Title changed: « FAQ » → « FAQ support ».",
        "At the start:",
        "(moved)",
        "Écrire à support@acme.test.",
        "In « Délais »:",
        "(changed)",
        "Nous répondons sous 24 h ouvrées.",
        "(added)",
        "Le samedi, réponse le lundi.",
        "Deleted:",
        "(from « Contacts »)",
        "- Téléphone\n- Chat",
      ].join("\n")
      expect(paul.text.slice(paul.text.indexOf("\n\nChanges from"))).toBe(`\n\n${changes}\n\nTo edit: acme_write {"path": "support/faq", "base_revision": 3, "ops": [...]}.`)
      expect((await read("paul", { path: "support/faq", since_revision: 3 })).text).toContain("\n\nNo change since revision 3.\n\n")
      expect((await read("paul", { path: "support/faq", since_revision: 0 })).text).toContain("Changes from revision 0 to 3 (5 added, 0 changed, 0 moved, 0 deleted):\nAt the start:\n(added)\nÉcrire")
      expect((await read("paul", { path: "support/faq", since_revision: 2 })).text).toContain("\n\nRevisions 2 and 3 have the same content.\n\n")
      expect(await refusal("paul", { path: "support/faq", since_revision: 7 })).toMatchObject({
        code: "not_found",
        message: "Unknown revision 7 of support/faq. Revisions: 1, 2, 3.",
      })
      const swap = (first: string, second: string): DocBlock[] => [first, second].map((id, index) => ({ id, type: "paragraph", text: id, data: {}, key: null, position: index, revision: 1, provenance: {} }))
      const moved = [diffBlocks(swap(A, B), swap(B, A)), diffBlocks(swap(A, B), swap(B, A))].map(({ changes: found }) => found.map((change) => [change.kind, change.block.id]))
      expect(moved[0]).toHaveLength(1)
      expect(moved[1]).toEqual(moved[0])
    })

    it("should serve the draft from the write level, with its pending header, and refuse it below without reading it (AC12)", async () => {
      const tables = modele()
      openDraftRow(tables, MODELE.path, { title: "Relance d'un devis" })
      // Le brouillon copie les blocs publiés sous les mêmes id (`open_draft`) ; un bloc y a changé.
      const published = tables.blocks.filter((row) => row.state === "published")
      tables.blocks.push(...published.map((row) => ({ ...row, state: "draft", text: row.text === "Bonjour," ? "Madame, Monsieur," : row.text })))
      addVersion(tables, MODELE.path, { revision: 2, title: MODELE.title ?? "", summary: MODELE.summary ?? "", blocks: published })
      await content(tables)
      const lea = await read("lea", { path: MODELE.path, draft: true })
      expect(lea.text).toContain(`children: none\nlinks in: none\nlinks out: none\ndraft: pending on revision 2 (saved ${DAY})\npending title: Relance d'un devis\n\n## Objet\n\nMadame, Monsieur,\n\n`)
      // Dès le niveau écriture, qui publie (E11-S02, AC-b4) : le pied dit comment publier le brouillon.
      expect(lea.text.endsWith('To edit: acme_write {"path": "ventes/modele_relance", "base_revision": 2, "ops": [...]}.\nPublish it with acme_write {"path": "ventes/modele_relance", "base_revision": 2, "publish": true}.')).toBe(true)
      const claire = await read("claire", { path: MODELE.path, draft: true })
      expect(claire.text.endsWith('\nPublish it with acme_write {"path": "ventes/modele_relance", "base_revision": 2, "publish": true}.')).toBe(true)
      expect((await read("lea", { path: MODELE.path, draft: true, since_revision: 2 })).text).toContain(
        "Changes from revision 2 to the draft (0 added, 1 changed, 0 moved, 0 deleted):\nTitle changed: « Modèle d'email de relance » → « Relance d'un devis ».\nIn « Objet »:\n(changed)\nMadame, Monsieur,\n\n",
      )
      await content(modele())
      expect((await read("lea", { path: MODELE.path, draft: true })).text.endsWith("\n\nNo pending draft on ventes/modele_relance.")).toBe(true)

      const conseil = base([{ path: "conseil/methode_etude" }])
      openDraftRow(conseil, "conseil/methode_etude")
      await content(conseil)
      const marc = spyDb(await ref.db("marc"))
      await expect(readNode(marc.db, who("marc"), { path: "conseil/methode_etude", draft: true })).rejects.toMatchObject({
        code: "forbidden",
        message: "Drafts of conseil/methode_etude are shown to its writers: the administrators of Acme Test (Ada Martin). Read the published revision without draft.",
      })
      expect(draftReads(marc.calls)).toEqual([])
    })

    it("should put the reference of each block before it, in the outline and in the changes (AC13)", async () => {
      const tables = base([{ path: "ventes/devis", revision: 2 }])
      const [headingId, paragraphId] = addBlocks(tables, "ventes/devis", "published", [heading("Objet", 1, "objet"), { ...paragraph("Relancer."), id: "3f9a2c1b-5b7d-4c1a-9e2f-8a6b4c2d0e1f" }])
      await content(tables)
      // La référence courte d'un bloc : les huit premiers caractères de son identifiant réel.
      const short = ref.id(paragraphId).slice(0, 8)
      const lea = await read("lea", { path: "ventes/devis", refs: true })
      expect(lea.text).toContain(`\n\n<!-- ref: objet -->\n## Objet\n\n<!-- ref: ${short} -->\nRelancer.\n\nTo edit`)
      const outlined = await read("lea", { path: "ventes/devis", outline: true, refs: true })
      // Tailles sans les lignes de référence : « ## Objet » (8), une ligne vide, « Relancer. » (9).
      expect(outlined.text).toContain("\noutline (1 section, 19 characters):\n- Objet (19 characters, ref objet)\n")
      // E11-S19 (AC-e2) : la référence est dans le plan du texte, pas redite en données.
      expect(outlined.data).not.toHaveProperty("outline")
      const version: Tables = { node_versions: [] }
      addVersion(version, "ventes/devis", { revision: 1, title: "ventes/devis", summary: "Summary of ventes/devis.", blocks: [{ id: headingId, type: "heading", text: "Objet", data: { level: 1 }, key: "objet" }, { id: paragraphId, type: "paragraph", text: "Relancer vite.", data: {} }] })
      await ref.write(version)
      expect((await read("lea", { path: "ventes/devis", since_revision: 1, refs: true })).text).toContain(`(changed, ref ${short})\nRelancer.`)
      const twins: DocBlock[] = ["3f9a2c1b-0000-4000-8000-000000000001", "3f9a2c1b-0000-4000-8000-000000000002"].map((id) => ({ id, type: "paragraph", text: "x", data: {}, key: null, position: 1, revision: 1, provenance: {} }))
      expect([...displayRefs(twins).values()]).toEqual(["3f9a2c1b-0000-4000-8000-000000000001", "3f9a2c1b-0000-4000-8000-000000000002"])
    })

    /** `ventes/long` : « Corps » et trois paragraphes de 20 000 caractères (AC33). */
    function long(): Tables {
      const tables = base([{ path: "ventes/long", title: "Long" }])
      addBlocks(tables, "ventes/long", "published", [heading("Corps"), paragraph("a".repeat(20_000)), paragraph("b".repeat(20_000)), paragraph("c".repeat(20_000))])
      return tables
    }

    it("should cut a result over 45,000 characters at a line end, serve the rest by cursor, and refuse a stale cursor (AC14)", async () => {
      const tables = long()
      await content(tables)
      const first = await read("claire", { path: "ventes/long", section: "Corps" })
      const structured = formatResult(first, () => false).structuredContent ?? {}
      expect(JSON.stringify(structured).length).toBeLessThanOrEqual(45_000)
      expect(structured.truncated).toBeUndefined()
      const cursor = String(first.data?.next_cursor)
      expect(first.data).toMatchObject({ part: 1, parts: 2 })
      expect(first.text.endsWith(`\n\nContinued (part 1 of 2): read the rest with acme_read {"path": "ventes/long", "section": "Corps", "cursor": "${cursor}"}.`)).toBe(true)
      const second = await read("claire", { path: "ventes/long", section: "Corps", cursor })
      expect(second.text.startsWith("# Long (continued, part 2 of 2)\n\n")).toBe(true)
      expect(second.data).toMatchObject({ part: 2, parts: 2, next_cursor: null })
      const header = first.text.slice(0, first.text.indexOf("\n\n## Corps") + 2)
      const partOne = first.text.slice(header.length, first.text.lastIndexOf("\n\nContinued (part 1"))
      const partTwo = second.text.slice("# Long (continued, part 2 of 2)\n\n".length, second.text.lastIndexOf("\n\nTo edit:"))
      expect(`${partOne}\n${partTwo}`).toBe(renderBlocks(tables.blocks.map((row) => ({ type: String(row.type), text: row.text as string, data: row.data }))))
      const stale = "This cursor no longer matches ventes/long (it changed, or the request differs): read again without cursor."
      expect(await refusal("claire", { path: "ventes/long", section: "Autre", cursor })).toMatchObject({ code: "invalid_arguments", message: stale })
      expect(await refusal("claire", { path: "ventes/long", section: "Corps", cursor: "xyz" })).toMatchObject({ message: stale })
      // Republié entre-temps : le texte d'un bloc a changé sous le même nœud, l'empreinte du curseur ne le sert plus.
      await seed.admin`update platform.blocks set text = ${"d".repeat(20_000)} where id = ${ref.id(String(tables.blocks[3].id))} and state = 'published'`
      expect(await refusal("claire", { path: "ventes/long", section: "Corps", cursor })).toMatchObject({ message: stale })
    })

    it("should keep every form of read under 45,000 serialized characters, a cut always giving a cursor (AC15)", async () => {
      // Mesuré sur la sortie du service, avant le formateur, qui couperait lui-même, sans curseur.
      const size = (output: { text: string; data?: Record<string, unknown>; nextActions?: string[] }) =>
        JSON.stringify({ ...output.data, text: output.text, next_actions: output.nextActions ?? [] }).length
      const big = base([{ path: "ventes/big", title: "Big" }])
      addBlocks(big, "ventes/big", "published", Array.from({ length: 6 }, (_, index) => paragraph(String(index).repeat(20_000))))
      await content(big)
      const parts = [await read("claire", { path: "ventes/big", since_revision: 0 })]
      for (let cursor = parts[0].data?.next_cursor; typeof cursor === "string"; cursor = parts[parts.length - 1].data?.next_cursor) {
        parts.push(await read("claire", { path: "ventes/big", since_revision: 0, cursor }))
      }
      // L'écart de 120 000 caractères part en plusieurs parties, chacune sous le plafond, et chacune sauf la dernière porte son curseur.
      expect(parts.length).toBeGreaterThan(1)
      expect(parts.map((part) => [size(part) <= 45_000, part.data?.parts])).toEqual(parts.map(() => [true, parts.length]))
      expect(parts.slice(0, -1).every((part) => typeof part.data?.next_cursor === "string")).toBe(true)
      await content(base([{ path: "dossier", owner: { kind: "team", teamId: TEAMS.ventes.id, userId: null } }, ...Array.from({ length: 50 }, (_, index): ContentNode => ({ path: `dossier/c${index}`, summary: "s".repeat(200) }))]))
      expect(size(await read("lea", { path: "dossier" }))).toBeLessThanOrEqual(45_000)
      const titles = base([{ path: "conseil/titres" }])
      addBlocks(titles, "conseil/titres", "published", Array.from({ length: 300 }, (_, index) => [heading(`Titre ${index}`), paragraph("p".repeat(100))]).flat())
      await content(titles)
      expect(size(await read("marc", { path: "conseil/titres" }))).toBeLessThanOrEqual(45_000)
      // Le contrat de chaque fonction du catalogue de la V1, ses connecteurs activés.
      const registry = await vi.importActual<typeof import("../../packages/plateforme/server/catalog/registry")>("../../packages/plateforme/server/catalog/registry")
      const functions = registry.catalogFunctions()
      vi.mocked(catalogFunctions).mockReturnValue(functions)
      // Les connecteurs activables seuls : les natifs, toujours actifs, ne sont pas dans `platform.connectors`.
      const activable = functions.filter((fn) => fn.origin === "connecteur")
      const activations = [...new Set(activable.map((fn) => fn.connector))].map((connector) => ({ org_id: ORG.id, connector, state: "active" }))
      await content({ ...base(), connector_activations: activations })
      for (const fn of functions) {
        const contract = await read("lea", { path: fn.name })
        expect([contract.target, size(contract) <= 45_000], fn.name).toEqual([fn.name, true])
      }
    })
  })

  describe("read — functions, unknown paths, administrators (AC16 to AC18)", () => {
    it("should serve the contract of an active function and refuse an unknown or inactive one, and the journal (AC16)", async () => {
      const rows = defineFunction({
        name: "table.rows",
        connector: "table",
        class: "read",
        origin: "paquet",
        description: "Reads the rows of a table.",
        schema: z.strictObject({ table: z.string() }),
        examples: [{ table: "ventes/suivi" }],
        refusals: ["Unknown table."],
        run: async () => ({ text: "" }),
      })
      const remote = { ...rows, name: "mail.send", connector: "mail", origin: "connecteur" as const }
      vi.mocked(catalogFunctions).mockReturnValue([rows, remote])
      await content(base())
      const contract = await read("lea", { path: "table.rows" })
      const expected = describeFunction(rows, "acme")
      expect([contract.text, contract.data, contract.nextActions, contract.target]).toEqual([expected.text, expected.data, ["acme_call"], "table.rows"])
      // `mail` activé pour une autre organisation seulement : inactif pour O.
      await content({ ...base(), connector_activations: [{ org_id: OTHER_ORG.id, connector: "mail", state: "active" }] })
      for (const name of ["x.y", "mail.send"]) {
        expect(await refusal("lea", { path: name })).toMatchObject({ code: "not_found", message: `Unknown function ${name}. Use acme_find with type function.` })
      }
      await content({ ...base(), connector_activations: [{ org_id: ORG.id, connector: "mail", state: "active" }] })
      const active = await read("lea", { path: "mail.send" })
      expect([active.text, active.target]).toEqual([describeFunction(remote, "acme").text, "mail.send"])
      // `journal` est servi par la branche d'E05-S05, avant toute recherche d'un nœud de ce nom ; le journal de
      // O est vide (rien ne l'écrit dans ce fichier).
      await content(base())
      expect((await read("lea", { path: "journal" })).text.split("\n")[0]).toBe("# Journal — last 24 hours")
    })

    // E11-S19 (AC-e3, HN-E11S19-8) : toutes les fonctions actives, par connecteur, avec leur classe ; un connecteur inactif absent.
    it("should list every active function by connector with its class and first sentence, then the contracts", async () => {
      const define = (name: string, fields: { connector: string; class: "read" | "write" | "sensitive"; origin: "paquet" | "connecteur"; description: string }) =>
        defineFunction({ name, ...fields, schema: z.strictObject({}), examples: [], refusals: [], run: async () => ({ text: "" }) })
      const rows = define("table.rows", { connector: "table", class: "read", origin: "paquet", description: "Reads the rows of a table. Twenty per page." })
      const trash = define("node.trash", { connector: "node", class: "write", origin: "paquet", description: "Moves a node to the trash." })
      const send = define("mail.send", { connector: "mail", class: "sensitive", origin: "connecteur", description: "Sends a draft." })
      vi.mocked(catalogFunctions).mockReturnValue([rows, send, trash])
      await content(base())
      const tail = ["Contracts to read before writing: write.procedure, write.table.", 'Read a contract with acme_read {"path": "<function>"}, then run it with acme_call.']
      const listed = await read("lea", { path: "functions" })
      expect(listed.text.split("\n")).toEqual([
        "2 functions you can run, by connector:",
        "node:",
        "- node.trash (write): Moves a node to the trash.",
        "table:",
        "- table.rows (read): Reads the rows of a table.",
        ...tail,
      ])
      expect([listed.data, listed.target]).toEqual([
        {
          functions: [
            { name: "node.trash", connector: "node", class: "write" },
            { name: "table.rows", connector: "table", class: "read" },
          ],
          contracts: ["write.procedure", "write.table"],
        },
        "functions",
      ])
      await content({ ...base(), connector_activations: [{ org_id: ORG.id, connector: "mail", state: "active" }] })
      expect((await read("lea", { path: "functions" })).text.split("\n").slice(0, 3)).toEqual(["3 functions you can run, by connector:", "mail:", "- mail.send (sensitive): Sends a draft."])
      // Une description sans point : sa phrase coupée à 200 caractères, points de suspension compris.
      const wordy = define("erp.long", { connector: "erp", class: "read", origin: "paquet", description: `${"mot ".repeat(80)}sans point` })
      vi.mocked(catalogFunctions).mockReturnValue([wordy])
      const line = (await read("lea", { path: "functions" })).text.split("\n")[2]
      expect([line.length, line.endsWith("…")]).toEqual(["- erp.long (read): ".length + 200, true])
    })

    it("should answer an unknown, invisible, personal or foreign node as unknown, and refuse a malformed path (AC17)", async () => {
      const tables = base([{ path: "support/faq" }])
      tables.nodes.push({ id: "other:node:secret", org_id: OTHER_ORG.id, path: "secret", parent_id: OTHER_ORG.root, kind: "page", title: "P", summary: "P", status: "published", revision: 1 })
      await content(tables)
      for (const [person, path] of [["lea", "ventes/inexistant"], ["lea", "support/faq"], ["ada", "private/claire"], ["lea", "secret"]] as const) {
        expect(await refusal(person, { path }), path).toMatchObject({ code: "not_found", message: `Unknown path ${path}. Use acme_find to locate it.` })
      }
      expect(await refusal("lea", { path: "Ventes/X" })).toMatchObject({
        code: "invalid_arguments",
        message: "Invalid path « Ventes/X »: lowercase letters, digits and _ separated by /, e.g. ventes/relance_devis.",
      })
    })

    it("should let an administrator read a node of a team, with the manage level (AC18)", async () => {
      await content(base())
      expect((await read("ada", { path: "ventes/devis" })).text).toContain("\naccess: manage (write and publish, share, move, delete)\n")
    })
  })
})

// E11-S03 (AC-a4, H28) : deux états publiés au même contenu servi, sans base.
describe("samePublishedContent (E11-S03, AC-a4)", () => {
  const block = (fields: Partial<DocBlock> = {}): DocBlock => ({ id: "b1", type: "paragraph", text: "Tutoyer.", data: {}, key: null, position: 1, revision: 1, provenance: {}, ...fields })

  it("should ignore ids, positions, block revisions and provenance", () => {
    expect(samePublishedContent([block(), block({ id: "b2", text: "Signer." })], [block({ id: "x", position: 9, revision: 4, provenance: { by: "assistant" } }), block({ id: "y", text: "Signer." })])).toBe(true)
  })

  it("should see a changed text, data, key, type, order or count", () => {
    const two = [block(), block({ id: "b2", text: "Signer." })]
    for (const other of [
      [block({ text: "Vouvoyer." }), two[1]],
      [block({ data: { level: 1 } }), two[1]],
      [block({ key: "ton" }), two[1]],
      [block({ type: "quote" }), two[1]],
      [two[1], two[0]],
      [two[0]],
    ]) {
      expect(samePublishedContent(two, other)).toBe(false)
    }
  })
})

// E11-S03 (AC-c3, HN-E11S03-10) : l'état servi par un refus de révision montre les blocs d'avant le premier titre.
describe("staleState (E11-S03, AC-c3)", () => {
  const node: NodeRow = {
    id: "n1",
    org_id: "o1",
    parent_id: null,
    path: "ventes/devis",
    kind: "page",
    title: "Devis",
    summary: "Le devis.",
    status: "published",
    revision: 4,
    meta: null,
    owner_kind: null,
    owner_team_id: null,
    owner_user_id: null,
    created_by: null,
    updated_by: null,
    created_at: CONTENT_AT,
    updated_at: CONTENT_AT,
  }
  const block = (type: string, text: string, data: Record<string, unknown> = {}): DocBlock => ({ id: null, type, text, data, key: null, position: null, revision: 1, provenance: {} })

  it("should put the start of the page first, outside the sections, and nothing without it", () => {
    const moved = block("paragraph", "Relancer.")
    const objet = [block("heading", "Objet", { level: 1 }), block("paragraph", "x")]
    // « ## Objet » (8), une ligne vide, « x » (1).
    expect(staleState(node, [moved, ...objet])).toBe("# Devis (revision 4, published)\n- (start of page, 9 characters)\n- Objet (11 characters)")
    expect(staleState(node, objet)).toBe("# Devis (revision 4, published)\n- Objet (11 characters)")
    expect(staleState(node, [moved])).toBe("# Devis (revision 4, published)\n- (start of page, 9 characters)\n- (no section)")
  })
})
