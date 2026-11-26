// @vitest-environment node
// Liens relus pour chaque personne (E03-S07, AC2, AC4, AC5, AC10) sur une base réelle (E01-S10, lot t1-b) :
// `prepareLinks` à la publication (liens écrits, avertissements sous les droits du publieur), liens
// sortants et entrants de l'en-tête de `read`. Chaque test écrit ses tables simulées sur l'organisation O
// de la graine du fichier (`replaceContent`) ; la base rend toutes les lignes de `links`, `node_aliases`
// et `nodes` de l'organisation, la RLS d'isolation d'E01-S08 seule : le service prouve qu'il filtre cibles
// et sources de niveau 0 (`security-patterns.md § Droits dans le service`). La résolution de
// `target_node_id` par `publish_node` est prouvée par E01-S06 (AC18) ; la syntaxe et la borne (AC1, AC3),
// par le test d'AC31 d'E03-S03 (`nodes-links.test.ts`). En suite portable (`sqlConfigured`) : le projet, ou le Postgres nu du job `bare-postgres`.
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { BlockInput } from "../../packages/plateforme/schemas"
import { readNode } from "../../packages/plateforme/server/nodes/read"
import { writeNode } from "../../packages/plateforme/server/nodes/write"
import {
  addBlocks,
  aliasRow,
  blockUuid,
  contentTables,
  identityOf,
  nodeId,
  openDraftRow,
  ORG,
  type ContentNode,
  type Person,
} from "../helpers/reference-org"
import { seedReferenceOrg, type ReferenceOrgSql } from "../helpers/reference-org-sql"
import type { Row, Tables } from "../helpers/simulated-db"
import { functionCalls, linkSet, replaceContent, spyDb, writtenLinks } from "../helpers/spy-t1-b"
import { sqlConfigured, seedWithAdmin, type SeededData, portable } from "../helpers/sql"

const NETWORK_TIMEOUT = 60_000
const SETUP_TIMEOUT = 180_000

const heading = (text: string, key?: string): BlockInput => ({ type: "heading", text, data: { level: 1 }, key })
const paragraph = (text: string): BlockInput => ({ type: "paragraph", text, data: {} })

let linkIds = 0

/** Une ligne de `links` telle que `publish_node` l'écrit ; `resolved` : le nœud trouvé par chemin exact à la publication. */
function linkRow(source: string, target: string, options: { key?: string; resolved?: string; block?: string } = {}): Row {
  linkIds++
  return {
    id: linkIds,
    org_id: ORG.id,
    source_node_id: nodeId(source),
    source_block_id: options.block ?? blockUuid(0x30000 + linkIds),
    target_path: target,
    target_key: options.key ?? null,
    target_node_id: options.resolved === undefined ? null : nodeId(options.resolved),
  }
}

function base(nodes: ContentNode[]): Tables {
  return contentTables([], [{ path: "ventes", title: "Ventes" }, ...nodes])
}

/** La ligne de l'en-tête qui commence par `label` (« links in », « links out »). */
function line(text: string, label: string): string | undefined {
  return text.split("\n").find((row) => row.startsWith(label))
}

describe.skipIf(!sqlConfigured)(portable("links on a real database"), { timeout: NETWORK_TIMEOUT }, () => {
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

  async function read(person: Person, path: string) {
    return readNode(await ref.db(person), who(person), { path })
  }

  /** La publication, puis les liens qu'elle a écrits, en identifiants simulés. */
  async function publish(person: Person, path: string, revision: number) {
    const output = await writeNode(await ref.db(person), who(person), { path, base_revision: revision, publish: true }, { kind: "agent", ctx: null })
    return { text: output.text, links: ref.readable(await writtenLinks(seed.admin, ref.nodeId(path))) }
  }

  describe("links written and warned at publication (AC2)", () => {
    it("should write the four links with their blocks, warn about what has no target, and do the same for a procedure", async () => {
      const tables = base([{ path: "ventes/a", title: "A" }, { path: "ventes/b", title: "B" }, { path: "ventes/proc", kind: "procedure", title: "Procédure" }])
      addBlocks(tables, "ventes/b", "published", [heading("Étapes", "etapes"), paragraph("Relancer.")])
      openDraftRow(tables, "ventes/a")
      const [first, second] = addBlocks(tables, "ventes/a", "draft", [
        paragraph("Voir [[ventes/b]] et [[ventes/b#etapes]]."),
        paragraph("Puis [[ventes/b#zzz]], [[ventes/grille]] et [[Grille tarifaire]]."),
      ])
      await content(tables)
      const published = await publish("claire", "ventes/a", 1)
      // Les liens écrits n'ont pas d'ordre : comparés rangés.
      expect(linkSet(published.links)).toEqual(
        linkSet([
          { block_id: first, path: "ventes/b" },
          { block_id: first, path: "ventes/b", key: "etapes" },
          { block_id: second, path: "ventes/b", key: "zzz" },
          { block_id: second, path: "ventes/grille" },
        ]),
      )
      expect(published.text).toBe(
        [
          "Published ventes/a revision 2 (0 sections, 2 blocks). Next write: base_revision 2.",
          "Warnings:",
          "- link [[ventes/grille]]: no page at this path yet",
          "- link [[ventes/b#zzz]]: ventes/b has no block « zzz »",
          "- [[Grille tarifaire]] is not a link: links use paths, e.g. [[conseil/grille_tarifaire]]",
        ].join("\n"),
      )

      // Un brouillon seulement enregistré ne touche pas aux liens : `publish_node` n'est pas appelé.
      await content(tables)
      const saving = spyDb(await ref.db("claire"))
      await writeNode(saving.db, who("claire"), { path: "ventes/a", base_revision: 1, ops: [{ op: "add_section", section: "Suite", text: "[[ventes/autre]]" }], publish: false }, { kind: "agent", ctx: null })
      expect(functionCalls(saving.calls, "publish_node")).toEqual([])

      openDraftRow(tables, "ventes/proc")
      addBlocks(tables, "ventes/proc", "draft", [paragraph("Lire [[ventes/absente]].")])
      await content(tables)
      expect((await publish("claire", "ventes/proc", 1)).text).toContain("\nWarnings:\n- link [[ventes/absente]]: no page at this path yet")
    })
  })

  describe("links in and out in the header of read (AC4)", () => {
    function linked(): Tables {
      const tables = base([
        { path: "ventes/a", title: "A" },
        { path: "ventes/b", title: "B" },
        { path: "ventes/d", title: "D" },
        { path: "support/e", title: "E" },
      ])
      addBlocks(tables, "ventes/b", "published", [heading("Étapes", "etapes")])
      const [first, second] = [blockUuid(0x40001), blockUuid(0x40002)]
      tables.links = [
        // Semées à rebours de l'ordre servi : `links out` est trié par chemin puis clé, jamais par écriture.
        linkRow("ventes/a", "ventes/grille", { block: second }),
        linkRow("ventes/a", "ventes/b", { block: second, key: "zzz", resolved: "ventes/b" }),
        // Deux blocs citent la même cible : elle compte une fois.
        linkRow("ventes/a", "ventes/b", { block: second, key: "etapes", resolved: "ventes/b" }),
        linkRow("ventes/a", "ventes/b", { block: first, key: "etapes", resolved: "ventes/b" }),
        linkRow("ventes/a", "ventes/b", { block: first, resolved: "ventes/b" }),
        linkRow("ventes/d", "ventes/b", { resolved: "ventes/b" }),
        // Source de niveau 0 pour Léa, que la base rend : le service la retire.
        linkRow("support/e", "ventes/b", { resolved: "ventes/b" }),
      ]
      return tables
    }

    it("should name the readable sources and the targets sorted by path then key, and cut each side at 20 after the filter", async () => {
      await content(linked())
      const target = await read("lea", "ventes/b")
      expect(line(target.text, "links in")).toBe("links in (2): ventes/a — A · ventes/d — D")
      expect(target.text).not.toContain("support/e")
      expect(target.data).toMatchObject({ links_in: [{ path: "ventes/a", title: "A" }, { path: "ventes/d", title: "D" }], links_in_total: 2 })

      const source = await read("lea", "ventes/a")
      expect(source.text.split("\n").slice(8, 10)).toEqual([
        "links in: none",
        "links out (4): ventes/b — B · ventes/b#etapes — B · ventes/b#zzz — B (no block « zzz ») · ventes/grille (no target)",
      ])
      expect(source.data).toMatchObject({
        links_out: [
          { path: "ventes/b", title: "B", status: "ok" },
          { path: "ventes/b", key: "etapes", title: "B", status: "ok", key_found: true },
          { path: "ventes/b", key: "zzz", title: "B", status: "ok", key_found: false },
          { path: "ventes/grille", status: "missing" },
        ],
        links_out_total: 4,
        links_in_total: 0,
      })

      const hub = base([{ path: "ventes/hub", title: "Hub" }, ...Array.from({ length: 23 }, (_, index): ContentNode => ({ path: `ventes/s${String(index + 1).padStart(2, "0")}`, title: `S${index + 1}` }))])
      hub.links = [
        ...Array.from({ length: 23 }, (_, index) => linkRow(`ventes/s${String(index + 1).padStart(2, "0")}`, "ventes/hub", { resolved: "ventes/hub" })),
        linkRow("support/faq", "ventes/hub", { resolved: "ventes/hub" }),
        linkRow("support/contexte", "ventes/hub", { resolved: "ventes/hub" }),
        // À rebours aussi : les 20 nommés sont les 20 premiers par chemin, pas les 20 premiers écrits.
        ...Array.from({ length: 22 }, (_, index) => linkRow("ventes/hub", `ventes/cible_${String(22 - index).padStart(2, "0")}`)),
      ]
      await content(hub)
      const cut = await read("lea", "ventes/hub")
      const sources = Array.from({ length: 20 }, (_, index) => `ventes/s${String(index + 1).padStart(2, "0")} — S${index + 1}`)
      expect(line(cut.text, "links in")).toBe(`links in (23): ${[...sources, "… and 3 more"].join(" · ")}`)
      const targets = Array.from({ length: 20 }, (_, index) => `ventes/cible_${String(index + 1).padStart(2, "0")} (no target)`)
      expect(line(cut.text, "links out")).toBe(`links out (22): ${[...targets, "… and 2 more"].join(" · ")}`)
      expect(cut.data).toMatchObject({ links_in_total: 23, links_out_total: 22 })
      expect(cut.data?.links_in).toHaveLength(20)
      expect(cut.data?.links_out).toHaveLength(20)
    })
  })

  describe("a target published later, an invisible target (AC5)", () => {
    it("should find a target by its path at each read, and treat a target the reader or the publisher cannot see as absent", async () => {
      const tables = base([{ path: "ventes/a", title: "A" }, { path: "ventes/liens", title: "Liens" }])
      tables.node_aliases = [aliasRow("support/ancienne_faq", "support/faq", "paul")]
      tables.links = [
        linkRow("ventes/a", "ventes/grille"),
        // Résolue à la publication pour une personne qui la voyait : relue pour Léa, elle n'a pas de cible.
        linkRow("ventes/liens", "support/faq", { resolved: "support/faq" }),
        // L'ancien chemin d'une page que Léa ne voit pas : la base rend l'alias et son nœud, le service les écarte.
        linkRow("ventes/liens", "support/ancienne_faq", { resolved: "support/faq" }),
      ]
      await content(tables)
      expect(line((await read("lea", "ventes/a")).text, "links out")).toBe("links out (1): ventes/grille (no target)")
      const liens = await read("lea", "ventes/liens")
      expect(line(liens.text, "links out")).toBe("links out (2): support/ancienne_faq (no target) · support/faq (no target)")
      expect(liens.data?.links_out).toEqual([
        { path: "support/ancienne_faq", status: "missing" },
        { path: "support/faq", status: "missing" },
      ])

      const later = contentTables([], [{ path: "ventes", title: "Ventes" }, { path: "ventes/a", title: "A" }, { path: "ventes/grille", title: "Grille" }])
      later.links = tables.links.filter((row) => row.target_path === "ventes/grille")
      await content(later)
      expect(line((await read("lea", "ventes/a")).text, "links out")).toBe("links out (1): ventes/grille — Grille")
      expect(line((await read("lea", "ventes/grille")).text, "links in")).toBe("links in (1): ventes/a — A")

      openDraftRow(tables, "ventes/liens")
      addBlocks(tables, "ventes/liens", "draft", [paragraph("Voir [[support/faq]].")])
      await content(tables)
      expect((await publish("claire", "ventes/liens", 1)).text).toContain("\nWarnings:\n- link [[support/faq]]: no page at this path yet")
    })
  })

  describe("links after a move (AC10, and AC7 for the page that cites an old path)", () => {
    it("should keep pointing the moved node: moved targets out, key looked up in the moved node, sources in by id and by old path", async () => {
      const tables = base([
        { path: "ventes/b", title: "B" },
        { path: "ventes/src", title: "Source" },
        { path: "ventes/avant", title: "Avant" },
      ])
      addBlocks(tables, "ventes/b", "published", [heading("Étapes", "etapes")])
      tables.node_aliases = [aliasRow("ventes/a", "ventes/b")]
      tables.links = [
        linkRow("ventes/src", "ventes/a", { resolved: "ventes/b" }),
        linkRow("ventes/src", "ventes/a", { key: "etapes", resolved: "ventes/b" }),
        // Écrit avant que le nœud n'existe : cible nulle, résolue par l'ancien chemin.
        linkRow("ventes/avant", "ventes/a"),
      ]
      await content(tables)
      const source = await read("lea", "ventes/src")
      expect(line(source.text, "links out")).toBe("links out (2): ventes/a → ventes/b (moved) · ventes/a#etapes → ventes/b (moved)")
      expect(source.data).toMatchObject({
        links_out: [
          { path: "ventes/a", title: "B", status: "moved", moved_to: "ventes/b" },
          { path: "ventes/a", key: "etapes", title: "B", status: "moved", moved_to: "ventes/b", key_found: true },
        ],
      })
      expect(line((await read("lea", "ventes/b")).text, "links in")).toBe("links in (2): ventes/avant — Avant · ventes/src — Source")
    })
  })
})
