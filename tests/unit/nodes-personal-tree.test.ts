// @vitest-environment node
// Espace personnel, nœud complet de l'écran, arbre visible (E03-S03, AC34, AC35, AC36), sur une base réelle
// (E01-S10, lot t1-b) : chaque cas écrit ses tables simulées sur l'organisation O de la graine du fichier
// (`replaceContent`) ; la base y rend tous les nœuds, brouillons et blocs de l'organisation, la RLS
// d'isolation d'E01-S08 seule ; le service filtre et refuse lui-même (`security-patterns.md § Droits dans le
// service`), et l'espion (`spyDb`) montre ce qui n'est pas lu. En suite portable (`sqlConfigured`) : le projet, ou le Postgres nu du job `bare-postgres`.
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { BlockInput } from "../../packages/plateforme/schemas"
import { ACCESS_LEVELS, nodeLevels } from "../../packages/plateforme/server/access"
import { loadNode, readNode } from "../../packages/plateforme/server/nodes/read"
import { visibleTree } from "../../packages/plateforme/server/nodes/tree"
import { writeNode } from "../../packages/plateforme/server/nodes/write"
import type { TreeNode } from "../../packages/plateforme/schemas"
import {
  addBlocks,
  CONTENT_AT,
  contentTables,
  identityOf,
  nodeId,
  openDraftRow,
  PEOPLE,
  TEAMS,
  type ContentNode,
  type Person,
  type RuleSpec,
} from "../helpers/reference-org"
import { seedReferenceOrg, type ReferenceOrgSql } from "../helpers/reference-org-sql"
import type { Tables } from "../helpers/simulated-db"
import { draftReads, replaceContent, sameInstant, spyDb } from "../helpers/spy-t1-b"
import { sqlConfigured, seedWithAdmin, type SeededData, portable } from "../helpers/sql"

const NETWORK_TIMEOUT = 60_000
const SETUP_TIMEOUT = 180_000
// L'arbre borné se construit sur un grand jeu, écrit sur la base (6 000 nœuds) puis lu deux fois par pages :
// plus long que les autres cas.
const TREE_TIMEOUT = 180_000

const paragraph = (text: string): BlockInput => ({ type: "paragraph", text, data: {} })
const heading = (text: string): BlockInput => ({ type: "heading", text, data: { level: 1 } })

function base(nodes: ContentNode[] = [], rules: RuleSpec[] = []): Tables {
  return contentTables(rules, [{ path: "ventes", title: "Ventes" }, { path: "conseil", title: "Conseil" }, ...nodes])
}

describe.skipIf(!sqlConfigured)(portable("personal space, screens and tree on a real database"), { timeout: NETWORK_TIMEOUT }, () => {
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

  /** `write` publiant par défaut (E11-S02, AC-b1), une entrée qui ne nomme pas `publish` garde ici le brouillon. */
  async function write(person: Person, input: Record<string, unknown>) {
    const body = "publish" in input ? input : { ...input, publish: false }
    return writeNode(await ref.db(person), who(person), body, { kind: "agent", ctx: null }).then(
      (result) => ({ result, error: null }),
      (error: unknown) => ({ result: null, error }),
    )
  }

  describe("personal space (AC34)", () => {
    it("should let a person write in her space, hide it from the others, and refuse another person's space", async () => {
      const notes = { path: "private/lea/notes", title: "Notes", summary: "Mes notes.", ops: [{ op: "add_section", section: "Idées", text: "Relancer Acme." }] }
      await content(base())
      const lea = await write("lea", notes)
      expect(lea.result?.text).toBe(
        'Draft of private/lea/notes created (revision 0): added « Idées » (24 characters).\nPublish it with acme_write {"path": "private/lea/notes", "base_revision": 0, "publish": true}.\nSpace: your private space: only you see it.',
      )
      const [created] = await seed.admin`select parent_id, owner_kind from platform.nodes where org_id = ${ref.org.id} and path = 'private/lea/notes'`
      expect(ref.readable({ ...created })).toMatchObject({ parent_id: nodeId("private/lea"), owner_kind: "user" })
      await expect(readNode(await ref.db("ada"), who("ada"), { path: "private/lea/notes" })).rejects.toMatchObject({
        code: "not_found",
        message: "Unknown path private/lea/notes. Use acme_find to locate it.",
      })
      await content(base())
      expect((await write("claire", { path: "private/lea/x", title: "X", summary: "X" })).error).toMatchObject({
        code: "not_found",
        message: "Cannot create private/lea/x: its parent private/lea does not exist. Closest existing page: private. Create private/lea first, or choose a path under private.",
      })
      // Le refus nomme le compte et l'organisation de l'appel, et l'espace de la personne (FB-0011).
      const signedIn = who("lea")
      for (const path of ["private/claire", "private/zoe"]) {
        expect((await write("lea", { path, title: "X", summary: "X" })).error).toMatchObject({
          code: "forbidden",
          message: `${path} is not your personal space: this connection is signed in as ${signedIn.user.email} in ${signedIn.org.name}, where your personal space is private/lea.`,
        })
      }
      // Sans handle (accès de l'équipe plateforme sans ligne de membre) : aucun espace ici, et la phrase le dit.
      const staff = who("s")
      expect((await write("s", { path: "private/lea", title: "X", summary: "X" })).error).toMatchObject({
        code: "forbidden",
        message: `private/lea is not your personal space: this connection is signed in as ${staff.user.email} in ${staff.org.name}; you have no personal space here.`,
      })
    })

    it("should tell a person who gives a title to her own space without base_revision to write the page under it (FB-0011)", async () => {
      await content(base())
      const { error } = await write("lea", { path: "private/lea", title: "Idées", summary: "Mes idées." })
      expect(error).toMatchObject({
        code: "stale_revision",
        message: expect.stringContaining("Nothing was written. private/lea is your personal space itself: to create a page in it, write at private/lea/<page>. Current state:"),
      })
      // Sans titre, ou avec une révision (périmée ici), c'est une modification de l'espace : le refus reste le seul.
      for (const input of [{ summary: "Mes idées." }, { title: "Idées", base_revision: 999 }]) {
        const stale = (await write("lea", { path: "private/lea", ...input })).error
        expect(stale).toMatchObject({ code: "stale_revision", message: expect.not.stringContaining("your personal space itself") })
      }
    })
  })

  describe("screens (AC35, AC36)", () => {
    it("should load the whole node with its blocks, and its draft from the write level only (AC35)", async () => {
      const tables = base([{ path: "ventes/grande", title: "Grande", summary: "Une grande page." }, { path: "ventes/suivi", kind: "table" }, { path: "ventes/cr", status: "draft", revision: 0 }])
      tables.nodes.find((row) => row.path === "ventes/grande")!.updated_by = PEOPLE.claire.id
      const ids = addBlocks(tables, "ventes/grande", "published", [heading("Tout"), ...Array.from({ length: 25 }, (_, index) => paragraph(String(index % 10).repeat(1000)))])
      openDraftRow(tables, "ventes/grande", { title: "Très grande", kind: "procedure" })
      addBlocks(tables, "ventes/grande", "draft", [heading("Tout"), paragraph("Brouillon.")])
      await content(tables)
      const lea = await ref.db("lea")
      const view = await loadNode(lea, who("lea"), { path: "ventes/grande" })
      expect(ref.readable(view)).toMatchObject({
        id: nodeId("ventes/grande"),
        path: "ventes/grande",
        kind: "page",
        status: "published",
        revision: 1,
        updatedAt: sameInstant(CONTENT_AT),
        updatedByName: "Claire Morel",
        owner: { kind: "team", teamName: "Ventes", leadName: "Claire Morel" },
        level: 2,
        parent: { path: "ventes", title: "Ventes" },
        childrenTotal: 0,
        outline: [{ blockId: ids[0], title: "Tout", level: 1 }],
        draft: {
          baseRevision: 1,
          savedAt: sameInstant(CONTENT_AT),
          draftStamp: sameInstant(CONTENT_AT),
          title: "Très grande",
          summary: null,
          kind: "procedure",
          meta: null,
        },
      })
      expect(view.blocks).toHaveLength(26)
      // La référence courte d'un bloc : les huit premiers caractères de son identifiant réel.
      expect(view.blocks[1]).toEqual({ id: ref.id(ids[1]), ref: ref.id(ids[1]).slice(0, 8), type: "paragraph", text: "0".repeat(1000), data: {}, key: null, position: 2048, revision: 1, provenance: {} })
      expect(view.draft?.blocks.map((block) => block.text)).toEqual(["Tout", "Brouillon."])
      expect((await loadNode(lea, who("lea"), { path: "ventes/suivi" })).blocks).toEqual([])
      expect((await loadNode(lea, who("lea"), { path: "ventes/cr" })).blocks).toEqual([])

      const annonces = base([{ path: "annonces" }])
      openDraftRow(annonces, "annonces")
      await content(annonces)
      const marc = spyDb(await ref.db("marc"))
      expect((await loadNode(marc.db, who("marc"), { path: "annonces" })).draft).toBeNull()
      expect(draftReads(marc.calls)).toEqual([])
      await expect(loadNode(marc.db, who("marc"), { path: "ventes/devis" })).rejects.toMatchObject({ code: "not_found", message: "Unknown path ventes/devis." })
      // Mêmes refus que `read` : un chemin mal formé ou trop long est refusé avant toute requête (son filtre échouerait).
      const malformed = spyDb(await ref.db("marc"))
      for (const [path, shown] of [["Ventes/X", "Ventes/X"], ["a/".repeat(2500) + "b", `${"a/".repeat(99)}a…`]]) {
        await expect(loadNode(malformed.db, who("marc"), { path })).rejects.toMatchObject({
          code: "invalid_arguments",
          message: `Invalid path « ${shown} »: lowercase letters, digits and _ separated by /, e.g. ventes/relance_devis.`,
        })
      }
      expect(malformed.calls).toEqual([])
    })

    it("should build the visible tree by path, reattach a node under an invisible parent, and bound it after the filter (AC36)", { timeout: TREE_TIMEOUT }, async () => {
      await content(base([{ path: "ventes/brouillon", status: "draft", revision: 0 }], [{ node: "support/faq", user: "claire", level: "read" }]))
      const { tree, truncated } = await visibleTree(await ref.db("claire"), who("claire"))
      const shape = (nodes: TreeNode[]): unknown[] => nodes.map((node) => (node.children.length > 0 ? [node.path, shape(node.children)] : node.path))
      expect(shape(tree)).toEqual([
        [
          "guide",
          [
            "annonces",
            "conseil",
            "contexte",
            ["private", [["private/claire", ["private/claire/notes"]]]],
            "support/faq",
            ["ventes", ["ventes/brouillon", "ventes/contexte", ["ventes/devis", ["ventes/devis/modele"]], "ventes/tarifs"]],
          ],
        ],
      ])
      expect(truncated).toBe(false)
      const [root] = tree
      expect(root.children.find((node) => node.path === "contexte")).toMatchObject({ kind: "context", status: "published" })
      expect(root.children.find((node) => node.path === "ventes")?.children[0]).toMatchObject({ path: "ventes/brouillon", status: "draft" })

      // La borne de 5 000 compte les nœuds gardés (HN-E01S07-8) : 1 001 nœuds invisibles de Marc trient en
      // tête, devant 5 000 visibles ; une borne posée avant le filtre en perdrait, ou dirait l'arbre tronqué.
      const count = (nodes: TreeNode[]): number => nodes.reduce((total, node) => total + 1 + count(node.children), 0)
      await content(base())
      const alone = count((await visibleTree(await ref.db("marc"), who("marc"))).tree)
      const support = { kind: "team" as const, teamId: TEAMS.support.id, userId: null }
      const hidden = [{ path: "a_secret", owner: support }, ...Array.from({ length: 1000 }, (_, index): ContentNode => ({ path: `a_secret/x${String(index).padStart(4, "0")}` }))]
      const visible = Array.from({ length: 5000 - alone }, (_, index): ContentNode => ({ path: `conseil/n${String(index).padStart(4, "0")}` }))
      await content(base([...hidden, ...visible]))
      const full = await visibleTree(await ref.db("marc"), who("marc"))
      expect([full.truncated, count(full.tree)]).toEqual([false, 5000])
      await ref.addNodes([{ path: "conseil/n9999" }])
      const over = await visibleTree(await ref.db("marc"), who("marc"))
      expect([over.truncated, count(over.tree)]).toEqual([true, 5000])
    })

    it("should build the tree of an administrator as a member's, her rights unchanged (E11-S10, AC-b1 to AC-b3)", async () => {
      await content(base([], [{ node: "support/faq", org: true, level: "read" }]))
      const shape = (nodes: TreeNode[]): unknown[] => nodes.map((node) => (node.children.length > 0 ? [node.path, shape(node.children)] : node.path))
      const ada = await ref.db("ada")
      // Membre d'aucune équipe : « Tout le monde », son espace et la page que la règle d'organisation partage (AC-b1).
      expect(shape((await visibleTree(ada, who("ada"))).tree)).toEqual([
        ["guide", ["annonces", "conseil", "contexte", ["private", ["private/ada"]], "support/faq"]],
      ])
      // La gestion de l'administratrice reste entière hors de l'arbre (AC-b2).
      expect(await nodeLevels(ada, who("ada"), [ref.nodeId("ventes/devis")])).toEqual(new Map([[ref.nodeId("ventes/devis"), ACCESS_LEVELS.manage]]))
      // Entrée dans Ventes, l'arbre relu porte ses nœuds (AC-b3).
      const inVentes = ref.identityOf("ada", { org: identityOf("ada").org, teams: [ref.teamOf("ventes", "ada")] })
      expect(shape((await visibleTree(ada, inVentes)).tree)).toEqual([
        [
          "guide",
          [
            "annonces",
            "conseil",
            "contexte",
            ["private", ["private/ada"]],
            "support/faq",
            ["ventes", ["ventes/contexte", ["ventes/devis", ["ventes/devis/modele"]], "ventes/tarifs"]],
          ],
        ],
      ])
      // Son premier geste retire le grand jeu du cas précédent (6 000 nœuds) : sous la charge d'une campagne
      // complète, cela dépasse le délai commun.
    }, TREE_TIMEOUT)
  })
})
