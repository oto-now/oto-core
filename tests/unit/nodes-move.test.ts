// @vitest-environment node
// Déplacement et anciens chemins sur une base réelle (E03-S07, AC7, AC8, AC9, AC15, et la part du service
// de l'AC6 ; E01-S10, lot t1-b) : `findNode` par un alias, `read` et `write` par un ancien chemin, chaque
// refus de `moveNode` décidé par le service avant la mise à jour, les refus de la base traduits, les nœuds
// nommés filtrés. Chaque cas écrit ses tables simulées sur l'organisation O de la graine du fichier ; la
// base rend les lignes interdites de O (nœuds et alias invisibles, RLS d'isolation seule) : le service
// prouve qu'il les filtre (`security-patterns.md § Droits dans le service`), et l'espion montre qu'aucune
// écriture ne part d'un refus, lignes relues identiques. La cascade des chemins et l'inscription des alias
// sont les déclencheurs de la base (AC6 ; aussi `tests/integration/links-move.test.ts`). Les refus que la
// base ne rend pas d'elle-même à coup sûr (`42501`, `23514`, interblocage `40P01`, chemin pris par un
// alias que le service ne lirait pas) sont rendus par l'espion à la requête visée ; une course (chemin
// pris, révision avancée) est une vraie écriture de la connexion d'administration, faite juste avant.
// En suite portable (`sqlConfigured`) : le projet, ou le Postgres nu du job `bare-postgres`.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import type { BlockInput } from "../../packages/plateforme/schemas"
import { findNode, movedNotice } from "../../packages/plateforme/server/nodes/lookup"
import { moveNode } from "../../packages/plateforme/server/nodes/move"
import { readNode } from "../../packages/plateforme/server/nodes/read"
import { writeNode } from "../../packages/plateforme/server/nodes/write"
import {
  addBlocks,
  ALIASED_AT,
  aliasRow,
  contentTables,
  identityOf,
  nodeId,
  TEAMS,
  type ContentNode,
  type Person,
  type RuleSpec,
} from "../helpers/reference-org"
import { seedReferenceOrg, type ReferenceOrgSql } from "../helpers/reference-org-sql"
import type { Tables } from "../helpers/simulated-db"
import { contentRows, replaceContent, sameInstant, spyDb, type SpiedCall, type SpiedError, type SpyHook } from "../helpers/spy-t1-b"
import { sqlConfigured, seedWithAdmin, type SeededData, portable } from "../helpers/sql"

const NETWORK_TIMEOUT = 60_000
const SETUP_TIMEOUT = 180_000
const AGENT = { kind: "agent", ctx: null } as const

afterEach(() => {
  vi.restoreAllMocks()
})

const heading = (text: string): BlockInput => ({ type: "heading", text, data: { level: 1 } })
const paragraph = (text: string): BlockInput => ({ type: "paragraph", text, data: {} })

async function settle<T>(promise: Promise<T>): Promise<{ result: T | null; error: unknown }> {
  return promise.then(
    (result) => ({ result, error: null }),
    (error: unknown) => ({ result: null, error }),
  )
}

/** La mise à jour d'un nœud. */
const isNodeUpdate = (call: SpiedCall) => /^\s*update\s+platform\.nodes\b/i.test(call.text)
const nodeUpdates = (calls: SpiedCall[]) => calls.filter(isNodeUpdate)
const nodeInserts = (calls: SpiedCall[]) => calls.filter((call) => /^\s*insert\s+into\s+platform\.nodes\b/i.test(call.text))
/** Ce que pose la mise à jour d'un déplacement (`set parent_id = …, path = …`, `move.ts`, partie b2), lu dans ses valeurs liées. */
const movedTo = (call: SpiedCall) =>
  call.kind === "sql" && /\bset\s+parent_id\s*=\s*\$\s*,\s*path\s*=\s*\$/i.test(call.text) ? { parent_id: call.values[0], path: call.values[1] } : call

const orgOwner = { kind: "org" as const, teamId: null, userId: null }

/**
 * L'arbre des refus (AC9) : `ventes/a` et ses descendants, `ventes/b` pris, `ventes/secret` fermé à
 * Claire, `ventes/old` ancien chemin de `ventes/confidentiel`, `conseil` à l'organisation (écriture
 * réservée aux administrateurs), `ventes/tarifs` au propriétaire explicite Ventes (O).
 */
function tree(rules: RuleSpec[] = []): Tables {
  const nodes: ContentNode[] = [
    { path: "ventes", title: "Ventes" },
    { path: "ventes/a", title: "A" },
    { path: "ventes/a/x", title: "X" },
    { path: "ventes/a/x/y", title: "Y" },
    { path: "ventes/b", title: "B" },
    { path: "ventes/secret", title: "Secret" },
    { path: "ventes/confidentiel", title: "Confidentiel" },
    { path: "conseil", title: "Conseil", owner: orgOwner },
  ]
  const tables = contentTables([{ node: "ventes/secret", user: "claire", level: "none" }, ...rules], nodes)
  tables.node_aliases = [aliasRow("ventes/old", "ventes/confidentiel", "ada")]
  return tables
}

describe.skipIf(!sqlConfigured)(portable("moves and old paths on a real database"), { timeout: NETWORK_TIMEOUT }, () => {
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

  async function move(person: Person, input: Record<string, unknown>, hook?: SpyHook) {
    const spied = spyDb(await ref.db(person), hook)
    const outcome = await settle(moveNode(spied.db, who(person), input))
    return { ...outcome, calls: spied.calls }
  }

  /** Les textes des blocs du brouillon d'un nœud, dans l'ordre du document, relus par la connexion d'administration. */
  async function draftTexts(path: string): Promise<(string | null)[]> {
    const rows = await seed.admin<{ text: string | null }[]>`
      select text from platform.blocks where node_id = ${ref.nodeId(path)} and state = 'draft' order by position`
    return rows.map((row) => row.text)
  }

  describe("an old path resolved by findNode (AC8)", () => {
    it("should resolve a visible alias with its date, never an invisible one, and write the moved line", async () => {
      const tables = contentTables([{ node: "ventes/confidentiel", user: "lea", level: "none" }], [
        { path: "ventes", title: "Ventes" },
        { path: "ventes/t2", kind: "table", title: "Suivi" },
        { path: "ventes/confidentiel", title: "Confidentiel" },
      ])
      tables.node_aliases = [aliasRow("ventes/t", "ventes/t2"), aliasRow("ventes/old", "ventes/confidentiel")]
      await content(tables)
      const db = await ref.db("lea")
      const lea = who("lea")
      expect(ref.readable(await findNode(db, lea, "ventes/t"))).toMatchObject({
        node: { id: nodeId("ventes/t2"), path: "ventes/t2" },
        level: 2,
        movedFrom: "ventes/t",
        movedAt: sameInstant(ALIASED_AT),
      })
      expect(await findNode(db, lea, "ventes/t2")).toMatchObject({ node: { path: "ventes/t2" }, movedFrom: null, movedAt: null })
      // La base rend l'alias et son nœud : le niveau 0 calculé les rend introuvables (H68, H123).
      expect(await findNode(db, lea, "ventes/old")).toBeNull()
      expect(await findNode(await ref.db("claire"), who("claire"), "ventes/old")).toMatchObject({ node: { path: "ventes/confidentiel" }, level: 3, movedFrom: "ventes/old" })
      expect(await findNode(db, lea, "ventes/rien")).toBeNull()
      expect(movedNotice("ventes/a/x", { path: "ventes/b/x" }, ALIASED_AT)).toBe("ventes/a/x moved to ventes/b/x on 2026-09-24: use the new path.")
    })
  })

  describe("read and write by an old path (AC7)", () => {
    /** L'état laissé par le déplacement de l'AC6 : `ventes/a` et ses descendants sous `ventes/b`. */
    function moved(extra: { path: string; title: string; summary: string }[] = []): Tables {
      const tables = contentTables([], [
        ...extra,
        { path: "ventes", title: "Ventes" },
        { path: "ventes/b", title: "B" },
        { path: "ventes/b/x", title: "X", summary: "La page X." },
        { path: "ventes/b/x/y", title: "Y" },
        { path: "ventes/b/long", title: "Longue" },
      ])
      addBlocks(tables, "ventes/b/x", "published", [heading("Objet"), paragraph("Texte.")])
      addBlocks(tables, "ventes/b/long", "published", Array.from({ length: 5 }, (_, index) => paragraph(String(index).repeat(10_000))))
      tables.node_aliases = ["", "/x", "/x/y", "/long"].map((rest) => aliasRow(`ventes/a${rest}`, `ventes/b${rest}`))
      return tables
    }

    it("should serve the moved line, then the normal result of the new path, and write the moved node without creating one", async () => {
      const notice = "ventes/a/x moved to ventes/b/x on 2026-09-24: use the new path."
      await content(moved())
      const db = await ref.db("lea")
      const lea = who("lea")
      const direct = await readNode(db, lea, { path: "ventes/b/x" })
      const byAlias = await readNode(db, lea, { path: "ventes/a/x" })
      expect(byAlias.text).toBe(`${notice}\n${direct.text}`)
      expect(byAlias.data).toEqual({ moved_from: "ventes/a/x", ...direct.data })
      expect(byAlias.target).toBe("ventes/b/x")

      // Une page longue lue par son ancien chemin se poursuit par l'appel de la partie suivante, au nouveau chemin.
      const first = await readNode(db, lea, { path: "ventes/a/long" })
      expect(first.text.split("\n")[0]).toBe("ventes/a/long moved to ventes/b/long on 2026-09-24: use the new path.")
      const cursor = first.data?.next_cursor
      expect(typeof cursor).toBe("string")
      expect(first.text).toContain(`read the rest with acme_read {"path": "ventes/b/long", "cursor": "${String(cursor)}"}.`)
      expect((await readNode(db, lea, { path: "ventes/b/long", cursor: String(cursor) })).data).toMatchObject({ part: 2, parts: 2 })

      const written = spyDb(db)
      const output = await writeNode(written.db, lea, { path: "ventes/a/x", base_revision: 1, ops: [{ op: "append", section: "Objet", text: "Ajout." }], publish: false }, AGENT)
      expect(output.text.split("\n")[0]).toBe(notice)
      expect(output.data).toMatchObject({ moved_from: "ventes/a/x", path: "ventes/b/x" })
      expect(await draftTexts("ventes/b/x")).toContain("Ajout.")
      expect(nodeInserts(written.calls)).toEqual([])
      // Sous un ancien chemin, rien ne se crée : le refus donne le chemin à suivre.
      const under = spyDb(db)
      expect((await settle(writeNode(under.db, lea, { path: "ventes/a/x/neuf", title: "Neuf", summary: "Une page neuve." }, AGENT))).error).toMatchObject({
        code: "invalid_arguments",
        message: "Cannot create ventes/a/x/neuf: ventes/a/x moved to ventes/b/x. Create ventes/b/x/neuf instead; to move an existing page there, call acme_call node.move.",
      })
      expect(nodeInserts(under.calls)).toEqual([])
    })

    // Un lien vers une page déplacée se lit à son chemin courant ; le texte stocké ne change qu'à l'écriture de la page.
    it("should serve a link to a moved page at its current path, keep the stored text, and record it at the next write", async () => {
      const tables = moved([{ path: "ventes/cite", title: "Cite", summary: "Cite X." }])
      addBlocks(tables, "ventes/cite", "published", [heading("Liens"), paragraph("Voir [[ventes/a/x|la page X]] et [[ventes/b]].")])
      await content(tables)
      const db = await ref.db("lea")
      const lea = who("lea")
      const read = await readNode(db, lea, { path: "ventes/cite" })
      expect(read.text).toContain("Voir [[ventes/b/x|la page X]] et [[ventes/b]].")
      const stored = async (state: string) =>
        (await seed.admin<{ text: string | null }[]>`select text from platform.blocks where node_id = ${ref.nodeId("ventes/cite")} and state = ${state} and type = 'paragraph'`)[0]?.text
      expect(await stored("published")).toBe("Voir [[ventes/a/x|la page X]] et [[ventes/b]].")
      await writeNode(db, lea, { path: "ventes/cite", base_revision: 1, ops: [{ op: "append", section: "Liens", text: "Ajout." }], publish: false }, AGENT)
      expect(await draftTexts("ventes/cite")).toContain("Voir [[ventes/b/x|la page X]] et [[ventes/b]].")
    })
  })

  describe("moveNode refusals (AC9)", () => {
    const PATH_FORMAT = "Invalid arguments: new_path: Path: lowercase letters, digits and _ separated by /, e.g. ventes/relance_devis."
    const cases: [Person, Record<string, string>, string, string][] = [
      ["claire", { path: "ventes/a", new_path: "Ventes/B" }, "invalid_arguments", PATH_FORMAT],
      ["claire", { path: "ventes/a", new_path: "guide/b" }, "invalid_arguments", "guide is the organisation's guide, the root of the tree: its children have paths without prefix, e.g. ventes/notes."],
      ["claire", { path: "ventes/nope", new_path: "ventes/b2" }, "not_found", "Unknown path ventes/nope. Use acme_find to locate it."],
      // Invisible (niveau 0 calculé), même quand la base rend le nœud : introuvable (H68).
      ["claire", { path: "support/faq", new_path: "ventes/faq" }, "not_found", "Unknown path support/faq. Use acme_find to locate it."],
      ["claire", { path: "ventes/a", new_path: "ventes/a" }, "invalid_arguments", "new_path is already the path of ventes/a."],
      ["ada", { path: "guide", new_path: "racine" }, "invalid_arguments", "guide cannot move: it is the root of the tree."],
      ["ada", { path: "private", new_path: "espaces" }, "invalid_arguments", "private cannot move: it holds the personal spaces."],
      ["claire", { path: "private/claire", new_path: "ventes/claire" }, "invalid_arguments", "private/claire cannot move: it is a personal space; move the pages inside it instead."],
      ["claire", { path: "ventes/contexte", new_path: "ventes/ctx" }, "invalid_arguments", "ventes/contexte cannot move: a Contexte stays at the head of its team; move the pages inside it instead."],
      ["claire", { path: "ventes", new_path: "commerce" }, "invalid_arguments", "ventes cannot move: it holds the Contexte of team Ventes; move the pages inside it instead."],
      ["lea", { path: "ventes/a", new_path: "ventes/b2" }, "forbidden", "Moving ventes/a is reserved to team Ventes (lead: Claire Morel). Ask them to move it."],
      // Deux refus à la fois : le premier de la liste l'emporte (gestion avant le cycle).
      ["lea", { path: "ventes/a", new_path: "ventes/a/x/z" }, "forbidden", "Moving ventes/a is reserved to team Ventes (lead: Claire Morel). Ask them to move it."],
      ["claire", { path: "ventes/a", new_path: "ventes/a/x/z" }, "invalid_arguments", "Cannot move ventes/a under itself: ventes/a/x/z is inside ventes/a."],
      ["claire", { path: "ventes/a", new_path: "conseil/x/a" }, "not_found", "Cannot move ventes/a to conseil/x/a: conseil/x does not exist. Closest existing page: conseil."],
      // Parent que la base rend mais que Claire ne voit pas : absent pour elle, ni son existence ni son propriétaire servis (H68).
      ["claire", { path: "ventes/a", new_path: "ventes/secret/a" }, "not_found", "Cannot move ventes/a to ventes/secret/a: ventes/secret does not exist. Closest existing page: ventes."],
      // Sous un ancien chemin, rien ne se pose (N17), comme rien ne s'y crée : le refus donne le chemin à suivre.
      ["claire", { path: "ventes/a", new_path: "ventes/old/a" }, "invalid_arguments", "Cannot move ventes/a to ventes/old/a: ventes/old moved to ventes/confidentiel. Move it to ventes/confidentiel/a instead."],
      // L'ancien chemin du nœud lui-même : la destination est sous lui, aucun chemin à suivre n'est proposé.
      ["claire", { path: "ventes/confidentiel", new_path: "ventes/old/x" }, "invalid_arguments", "Cannot move ventes/confidentiel under itself: ventes/old/x is inside ventes/confidentiel."],
      ["claire", { path: "ventes/a", new_path: "private/a" }, "invalid_arguments", "private holds one personal space per member: move ventes/a inside a space, e.g. private/claire/a."],
      ["claire", { path: "ventes/a", new_path: "conseil/a" }, "forbidden", "Writing under conseil is reserved to the administrators of Acme Test (Ada Martin). Ask them for access."],
    ]

    it("should refuse in the order of the list, each before any update, with texts that say what to do", async () => {
      await content(tree())
      const before = await contentRows(seed.admin, ref.org.id)
      for (const [person, input, code, message] of cases) {
        const refused = await move(person, input)
        expect(refused.error, `${person} ${input.path} → ${input.new_path}`).toMatchObject({ code, message })
        expect(nodeUpdates(refused.calls), `${person} ${input.path} → ${input.new_path}`).toEqual([])
      }
      // Aucune écriture n'est partie : les lignes relues sont celles d'avant (AC-x3).
      expect(await contentRows(seed.admin, ref.org.id)).toEqual(before)
      // Dans un espace personnel : un propriétaire explicite suit le nœud (H71), et un accès plateforme en cours y déplace (H73).
      const tarifs = await move("claire", { path: "ventes/tarifs", new_path: "private/claire/tarifs" })
      expect(tarifs.error).toBeNull()
      const staff = await move("t", { path: "ventes/b", new_path: "private/t/b" })
      expect(staff.error).toBeNull()
      expect(nodeUpdates(staff.calls)).toHaveLength(1)
    })

    // Fiche D125 (M68) : un nom pris ne refuse plus le déplacement ; le nœud prend le premier chemin libre de son
    // segment sous le nouveau parent, que le chemin soit tenu par un nœud visible, invisible (sans dire ce qui
    // l'occupe) ou l'ancien chemin d'un autre nœud. Fiche D18 B (M26) : la responsable range aussi dans son espace.
    it.each([
      ["ventes/b", "ventes/b_2"],
      ["ventes/secret", "ventes/secret_2"],
      ["ventes/old", "ventes/old_2"],
      ["private/claire/notes", "private/claire/notes_2"],
    ])("should move to the first free path when %s is taken, in one update", async (requested, path) => {
      await content(tree())
      const moved = await move("claire", { path: "ventes/a", new_path: requested })
      expect([moved.error, moved.result?.target]).toEqual([null, path])
      expect(nodeUpdates(moved.calls).map(movedTo)).toMatchObject([{ path }])
      // Les descendants suivent, l'ancien chemin mène au nœud.
      expect([...(await seed.admin`select path from platform.nodes where id = ${ref.nodeId("ventes/a/x/y")}`)]).toEqual([{ path: `${path}/x/y` }])
      expect((await findNode(await ref.db("claire"), who("claire"), "ventes/a"))?.node.path).toBe(path)
    })

    it("should refuse a move whose first free path is the node's own path, before any update", async () => {
      await content(contentTables([], [{ path: "ventes", title: "Ventes" }, { path: "ventes/b", title: "B" }, { path: "ventes/b_2", title: "B 2" }]))
      const refused = await move("claire", { path: "ventes/b_2", new_path: "ventes/b" })
      expect(refused.error).toMatchObject({ code: "invalid_arguments", message: "ventes/b is taken and ventes/b_2 is already the first free path after it: nothing to move." })
      expect(nodeUpdates(refused.calls)).toEqual([])
    })

    it("should translate what the database still refuses, replay a deadlock once, and read 0 rows as a concurrent change", async () => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {})
      const onUpdate =
        (errors: (SpiedError | null)[]): SpyHook =>
        (call) =>
          isNodeUpdate(call) ? (errors.shift() ?? null) : null
      const toB2 = { path: "ventes/b", new_path: "ventes/b2" }
      const refused = async (code: string) => (await move("claire", toB2, onUpdate([{ code, message: `database says ${code}` }]))).error
      await content(tree())
      // Le nœud qui occupe le chemin, ou dont c'est l'ancien chemin, reste caché au service (RLS de niveau avant E01-S08, course).
      expect(await refused("23505")).toMatchObject({ code: "conflict", message: "Path ventes/b2 is not available: a content holds it (perhaps one you cannot see), a moved content had it, or the name is reserved. Choose another path." })
      // La décision rejouée passe : le refus ne renvoie la responsable vers personne, pas même elle-même (N25).
      expect(await refused("42501")).toMatchObject({ code: "forbidden", message: "Cannot move ventes/b to ventes/b2: the access rules of Acme Test refuse it there. Choose another path." })
      expect(await refused("23514")).toMatchObject({ code: "invalid_arguments", message: "Cannot move ventes/b to ventes/b2: the tree refuses this place. Choose another path." })

      // Une course : le chemin est pris entre le contrôle et la mise à jour, par une autre écriture ; la base
      // refuse (23505), la décision rejouée trouve le nœud, et le refus de la base est déjà au log serveur.
      log.mockClear()
      const concurrent = tree().nodes.find((row) => row.path === "ventes/b")
      const raced = await move("claire", toB2, async (call) => {
        if (isNodeUpdate(call)) await ref.write({ nodes: [{ ...concurrent, id: "node:concurrent", path: "ventes/b2" }] })
        return null
      })
      expect(raced.error).toMatchObject({ code: "conflict", message: "Path ventes/b2 is not available: a content holds it (perhaps one you cannot see), a moved content had it, or the name is reserved. Choose another path." })
      expect(log).toHaveBeenCalledWith("[platform] move: refused by the database", "23505")

      await content(tree())
      const replayed = await move("claire", toB2, onUpdate([{ code: "40P01" }]))
      expect([replayed.error, nodeUpdates(replayed.calls).length]).toEqual([null, 2])
      expect(replayed.result).toMatchObject({
        text: "Moved ventes/b to ventes/b2.\nThe old path stays valid: tools called with it are redirected.",
        moves: [{ from: "ventes/b", to: "ventes/b2" }],
        target: "ventes/b2",
      })
      await content(tree())
      const locked = await move("claire", toB2, onUpdate([{ code: "40P01" }, { code: "40P01" }]))
      expect(locked.error).toMatchObject({ code: "conflict", message: "The tree of Acme Test was changing at the same time: retry the move." })
      expect(nodeUpdates(locked.calls)).toHaveLength(2)

      log.mockClear()
      // Une publication passe entre le contrôle et la mise à jour : la révision lue n'est plus la bonne.
      const changed = await move("claire", toB2, async (call) => {
        if (isNodeUpdate(call)) await seed.admin`update platform.nodes set revision = 2 where id = ${ref.nodeId("ventes/b")}`
        return null
      })
      expect(changed.error).toMatchObject({ code: "stale_revision", message: "ventes/b changed while it was being moved: read it again, then retry." })
      const [kept] = await seed.admin<{ path: string }[]>`select path from platform.nodes where id = ${ref.nodeId("ventes/b")}`
      expect(kept).toMatchObject({ path: "ventes/b" })
      // La course se journalise au serveur, le nœud nommé par son id : les portes ne journalisent pas un refus.
      expect(log).toHaveBeenCalledWith("[platform] move: node changed before its update", ref.nodeId("ventes/b"))
    })
  })

  describe("the answer of a move (AC6, service side)", () => {
    it("should send one update and name only the moved nodes the mover reads, even when the database returns the others", async () => {
      // La cascade d'E01-S04 est le déclencheur de la base : une seule mise à jour, les descendants suivent.
      await content(tree([{ node: "ventes/a/x/y", user: "claire", level: "none" }]))
      const moved = await move("claire", { path: "ventes/a", new_path: "ventes/b2" })
      expect(ref.readable(moved.result)).toEqual({
        text: "Moved ventes/a to ventes/b2 with its descendants:\n- ventes/a → ventes/b2\n- ventes/a/x → ventes/b2/x\nThe old paths stay valid: tools called with them are redirected.",
        moves: [
          { from: "ventes/a", to: "ventes/b2" },
          { from: "ventes/a/x", to: "ventes/b2/x" },
        ],
        target: "ventes/b2",
        teamId: TEAMS.ventes.id,
      })
      expect(ref.readable(nodeUpdates(moved.calls).map(movedTo))).toEqual([{ parent_id: nodeId("ventes"), path: "ventes/b2" }])
    })
  })

  describe("the old path of another node (AC15)", () => {
    function confidential(): Tables {
      const tables = contentTables(
        [
          { node: "ventes/confidentiel", user: "lea", level: "none" },
          { node: "ventes/c", user: "lea", level: "manage" },
        ],
        [{ path: "ventes", title: "Ventes" }, { path: "ventes/confidentiel", title: "Confidentiel" }, { path: "ventes/c", title: "C" }],
      )
      addBlocks(tables, "ventes/confidentiel", "published", [heading("Objet"), paragraph("Secret.")])
      tables.node_aliases = [aliasRow("ventes/old", "ventes/confidentiel")]
      return tables
    }

    it("should refuse Léa the old path she cannot see, let Claire write it, and let the node take its old path back", async () => {
      const create = { path: "ventes/old", title: "Ancienne", summary: "Une page neuve." }
      const lea = who("lea")
      await content(confidential())
      const byService = spyDb(await ref.db("lea"))
      const refusedCreate = await settle(writeNode(byService.db, lea, create, AGENT))
      expect(refusedCreate.error).toMatchObject({ code: "conflict", message: "Path ventes/old is not available: a content holds it (perhaps one you cannot see), a moved content had it, or the name is reserved. Choose another path." })
      expect(nodeInserts(byService.calls)).toEqual([])

      // Un alias que le service ne lirait pas (RLS de niveau avant E01-S08) : `nodes_aliases_sync` refuse
      // l'insertion (M02), rendu à la requête faute de pouvoir le cacher au service ; même refus.
      const hidden = confidential()
      hidden.node_aliases = []
      await content(hidden)
      const byBase = spyDb(await ref.db("lea"), (call) => (nodeInserts([call]).length > 0 ? { code: "23505", message: "path is the former path of another node" } : null))
      expect((await settle(writeNode(byBase.db, lea, create, AGENT))).error).toMatchObject({
        code: "conflict",
        message: "Path ventes/old is not available: a content holds it (perhaps one you cannot see), a moved content had it, or the name is reserved. Choose another path.",
      })

      await content(confidential())
      // Un déplacement ne prend pas l'ancien chemin d'un autre nœud : il va au premier chemin libre (fiche D125).
      const freeMove = await move("lea", { path: "ventes/c", new_path: "ventes/old" })
      expect([freeMove.error, freeMove.result?.target]).toEqual([null, "ventes/old_2"])

      const claire = spyDb(await ref.db("claire"))
      const edited = await writeNode(claire.db, who("claire"), { path: "ventes/old", base_revision: 1, ops: [{ op: "append", section: "Objet", text: "Suite." }], publish: false }, AGENT)
      expect(edited.text.split("\n")[0]).toBe("ventes/old moved to ventes/confidentiel on 2026-09-24: use the new path.")
      expect(await draftTexts("ventes/confidentiel")).toContain("Suite.")
      expect(nodeInserts(claire.calls)).toEqual([])

      await content(confidential())
      const back = await move("claire", { path: "ventes/confidentiel", new_path: "ventes/old" })
      expect(back.error).toBeNull()
      expect(ref.readable(nodeUpdates(back.calls).map(movedTo))).toEqual([{ parent_id: nodeId("ventes"), path: "ventes/old" }])
    })
  })
})
