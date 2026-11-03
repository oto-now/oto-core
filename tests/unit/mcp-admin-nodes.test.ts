// @vitest-environment node
// `admin_node` par InMemoryTransport sur une vraie base (E08-S06, AC1 à AC6 ; E01-S10, lot t1-d2b) :
// les services de déplacement (E03-S07) et de publication (E03-S03) appelés avec les bons arguments, le
// texte composé de ce qu'ils rendent, leurs refus rendus tels quels ; le changement de propriétaire en
// deux temps, ses refus décidés avant toute écriture (`security-patterns.md § Droits dans le service`) ;
// les règles d'un nœud par les services d'E05-S03. La base des tests admin, avec l'arbre d'acme
// (`seedAdminFixture`), est semée par la connexion d'administration : une graine pour le fichier, et une
// base à soi, sur la même connexion, pour chaque test qui change l'arbre ou ses règles ; emails et slug
// jetables, les textes attendus les portent. La RLS n'isole que les organisations : ce que le service ne
// filtre pas revient. L'espion des deux faces du client de chaque session (`spyDb`) voit ses requêtes : un
// refus sans écriture se prouve par ses écritures, vides, et par les nœuds relus, identiques (AC-x3) ; la
// course d'AC4 se pose juste avant l'écriture du transfert.
// En suite portable (`sqlConfigured`) : le projet, ou le Postgres nu du job `bare-postgres`.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { PlatformError } from "../../packages/plateforme/server/errors"
import { moveNode } from "../../packages/plateforme/server/nodes/move"
import { publishNode } from "../../packages/plateforme/server/nodes/publish"
import { loggedText } from "../helpers/logs"
import { codes, connectAdminMcp, NODES, ORGS, PERSONS, TEAMS, type AdminPerson, type NodePath } from "../helpers/mcp-admin"
import { seedAdminFixture, type AdminFixtureSql } from "../helpers/mcp-admin-sql"
import type { Row, Tables } from "../helpers/simulated-db"
import { seedWithAdmin, spyDb, sqlConfigured, writesOf, type SeededData, type SentQuery, type SpyOptions, portable } from "../helpers/sql"

vi.mock("../../packages/plateforme/server/nodes/move", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../packages/plateforme/server/nodes/move")>()
  return { ...original, moveNode: vi.fn(original.moveNode) }
})

vi.mock("../../packages/plateforme/server/nodes/publish", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../packages/plateforme/server/nodes/publish")>()
  return { ...original, publishNode: vi.fn(original.publishNode) }
})

const NOTHING = "Nothing was transferred. Show this to the user and ask for explicit approval, then call again with confirm: true."
const INHERITANCE = "Where no rule is set here, the closest rule above applies, then the owner's defaults."
const NETWORK_TIMEOUT = 60_000
const SETUP_TIMEOUT = 180_000

function rule(n: number, subject: { subject_team_id?: string; subject_user_id?: string }, level: string): Row {
  const base = { id: `f0000000-0000-4000-8000-00000000000${n}`, org_id: ORGS.acme.id, node_id: NODES["ventes/tarifs"], account_id: null }
  return { ...base, subject_team_id: null, subject_user_id: null, ...subject, level }
}

/** Deux règles sur `ventes/tarifs` : Conseil en lecture, Marc en écriture (il ne la gère pas). */
const RULES = [rule(2, { subject_team_id: TEAMS.conseil.id }, "read"), rule(3, { subject_user_id: PERSONS.marc.id }, "write")]

/**
 * L'arbre d'acme et ses deux règles, sur une graine. Claire et Marc, qui appellent le MCP admin comme
 * membres d'acme, sont aussi de l'équipe plateforme : la base simulée tenait tout appelant pour tel
 * (`adminRpc`, `isStaff` par défaut) ; sur la vraie base, `is_staff()` lit `platform_staff`, et sans elle
 * la base refuse l'ancrage de leur session (`admin_journal_insert_staff`).
 */
async function seedTree(seed: SeededData): Promise<AdminFixtureSql> {
  const fixture = await seedAdminFixture(seed, { tree: true })
  await fixture.write({ access_rules: RULES, platform_staff: [{ user_id: PERSONS.claire.id }, { user_id: PERSONS.marc.id }] })
  return fixture
}

/** Les nœuds d'acme relus par la connexion d'administration, par chemin ; une écriture change leur `updated_at`. */
async function nodesOf(fixture: AdminFixtureSql, seed: SeededData): Promise<Record<string, Row>> {
  const rows = await seed.admin<Row[]>`
    select path, owner_kind, owner_team_id, owner_user_id, updated_by, updated_at::text as updated_at
      from platform.nodes where org_id = ${fixture.orgs.acme.id}`
  return Object.fromEntries(fixture.readable([...rows]).map((row) => [String(row.path), row]))
}

/** Les chemins des nœuds qu'une écriture a changés entre deux relectures. */
function rewritten(before: Record<string, Row>, after: Record<string, Row>): string[] {
  return Object.keys(after).filter((path) => JSON.stringify(after[path]) !== JSON.stringify(before[path]))
}

/** Les blocs d'AC4 : un de `ventes/tarifs`, publié et dans son brouillon ouvert, un de la grille, qui en hérite. */
const BLOCKS = { tarifs: "b1000000-0000-4000-8000-000000000001", grille: "b1000000-0000-4000-8000-000000000002" }

/** Ces blocs et le brouillon ouvert de `ventes/tarifs` : leurs droits sont ceux du nœud, un transfert ne les réécrit pas (ADR-011 § 2). */
function content(): Tables {
  const block = (id: string, path: NodePath, state: "published" | "draft") => ({ id, state, org_id: ORGS.acme.id, node_id: NODES[path], position: 1024, type: "paragraph", text: `Text of ${path}.` })
  return {
    // Un brouillon ouvert copie les blocs publiés sous leur identifiant (`open_draft`).
    blocks: [block(BLOCKS.tarifs, "ventes/tarifs", "published"), block(BLOCKS.tarifs, "ventes/tarifs", "draft"), block(BLOCKS.grille, "ventes/tarifs/grille", "published")],
    node_drafts: [{ node_id: NODES["ventes/tarifs"], base_revision: 3 }],
  }
}

/**
 * Les blocs et les brouillons d'acme relus par la connexion d'administration, chaque ligne avec sa version
 * (`xmin`) : toute écriture, même à l'identique, lui en donne une autre. Rangés par identifiant simulé.
 */
async function contentOf(fixture: AdminFixtureSql, seed: SeededData): Promise<Row[]> {
  const org = fixture.orgs.acme.id
  const rows = await seed.admin<Row[]>`
    select 'blocks' as source, id, state, xmin::text as version from platform.blocks where org_id = ${org}
    union all
    select 'node_drafts', node_id, null, xmin::text from platform.node_drafts where node_id in (select id from platform.nodes where org_id = ${org})`
  const key = (row: Row) => [row.source, row.id, row.state].join(" ")
  return fixture.readable([...rows]).sort((a, b) => key(a).localeCompare(key(b)))
}

/** Les écritures envoyées, l'ancrage de la session admin mis à part (`writes` de la base simulée) : table et opération. */
function writes(sent: readonly SentQuery[]): string[][] {
  return writesOf(sent)
    .filter((query) => query.target !== "admin_journal")
    .map((query) => [String(query.target), query.op])
}

describe.skipIf(!sqlConfigured)(portable("admin_node on a real database"), { timeout: NETWORK_TIMEOUT }, () => {
  let seed: SeededData
  let admin: AdminFixtureSql
  /** Les bases à soi des tests, sur la connexion de la graine du fichier : défaites avec elle. */
  const own: AdminFixtureSql[] = []

  beforeAll(async () => {
    seed = seedWithAdmin()
    admin = await seedTree(seed)
  }, SETUP_TIMEOUT)

  afterAll(async () => {
    try {
      for (const fixture of [admin, ...own]) await fixture?.forgetJournal()
    } finally {
      await seed?.cleanup()
    }
  }, SETUP_TIMEOUT)

  beforeEach(() => {
    // Les refus de la base et les conflits journalisent côté serveur.
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  /**
   * Une base à soi (l'arbre et ses règles : organisations et personnes nouvelles), pour un test qui change
   * ce que lisent les autres ; sur la connexion de la graine du fichier, qui reste la seule de ce fichier.
   */
  async function ownSeed(): Promise<{ seed: SeededData; admin: AdminFixtureSql }> {
    const fixture = await seedTree(seed)
    own.push(fixture)
    return { seed, admin: fixture }
  }

  /** La session admin de `caller` sur `fixture`, son client vu par l'espion (`sent`, `options` : `before`, `fail`), et `admin_node` sur acme. */
  async function session(fixture: AdminFixtureSql = admin, caller: AdminPerson = "sam", options: SpyOptions = {}) {
    const person = await fixture.deps(caller)
    const { db, sent } = spyDb(person.db, options)
    const deps = { ...person, db }
    const mcp = await connectAdminMcp(deps)
    const { code } = await mcp.openAdmin()
    const node = (args: Record<string, unknown>) => mcp.call("admin_node", { ctx: code, org: fixture.orgs.acme.slug, ...args })
    return { deps, node, sent }
  }

  describe("admin_node move (AC1)", () => {
    it("should move through the move service of E03-S07, name the descendants it moved and the owner now, and serve its refusals as they are", async () => {
      // Le vrai service : la base réécrit le chemin des descendants (`nodes_path_cascade`), que la base simulée imitait.
      const mine = await ownSeed()
      const { deps, node } = await session(mine.admin)
      const moved = await node({ op: "move", path: "ventes/tarifs", new_path: "conseil/tarifs" })
      expect(moveNode).toHaveBeenLastCalledWith(deps.db, expect.objectContaining({ org: expect.objectContaining({ id: mine.admin.orgs.acme.id }) }), {
        path: "ventes/tarifs",
        new_path: "conseil/tarifs",
      })
      expect(moved.text).toBe(
        "ventes/tarifs moved to conseil/tarifs with its 2 descendants; the old paths stay as aliases (tools called with them answer « moved to conseil/tarifs »). Owner now: team Ventes (lead: Claire Morel).",
      )
      expect(moved.structured).toMatchObject({ nodes: [{ from: "ventes/tarifs", to: "conseil/tarifs" }, expect.anything(), expect.anything()], next_actions: ["admin_node rules"] })

      // Le vrai service refuse de déplacer un Contexte (P39) : son texte, tel quel.
      const refused = await node({ op: "move", path: "ventes/contexte", new_path: "conseil/contexte" })
      expect(refused).toMatchObject({ isError: true, text: "ventes/contexte cannot move: a Contexte stays at the head of its team; move the pages inside it instead." })
    })
  })

  describe("admin_node publish (AC2)", () => {
    it("should publish through the publication service of E03-S03 on the revision read, and serve its refusals as they are", async () => {
      const { deps, node } = await session()
      vi.mocked(publishNode).mockResolvedValueOnce({ revision: 4, sections: 1, blocks: 3, rulesChanged: false, warnings: [] })
      expect((await node({ op: "publish", path: "ventes/tarifs" })).text).toBe("ventes/tarifs published: revision 4 (was 3).")
      const published = expect.objectContaining({ id: admin.id(NODES["ventes/tarifs"]), path: "ventes/tarifs", revision: 3 })
      expect(publishNode).toHaveBeenLastCalledWith(deps.db, expect.objectContaining({ org: expect.objectContaining({ id: admin.orgs.acme.id }) }), published, { baseRevision: 3 })

      vi.mocked(publishNode).mockResolvedValueOnce({ revision: 4, sections: 1, blocks: 2, rulesChanged: true, warnings: [] })
      const acme = admin.orgs.acme
      expect((await node({ op: "publish", path: "ventes/contexte" })).text).toBe(
        `ventes/contexte published: revision 4 (was 3).\nventes/contexte is a context page: the conversations it was served to expire, and their assistants call ${acme.prefix}_context again.`,
      )
      // Une publication concurrente et une procédure refusée par E03-S06 : les refus du service, tels quels.
      const stale = "stale revision: ventes/tarifs is at revision 5, not 3. Nothing was published. Read it again, then retry."
      vi.mocked(publishNode).mockRejectedValueOnce(new PlatformError("stale_revision", stale))
      expect((await node({ op: "publish", path: "ventes/tarifs" })).text).toBe(stale)
      const procedure = "Cannot publish ventes/relance: section Steps, block 2, step 1 calls mail.send_draft with an account the team cannot use."
      vi.mocked(publishNode).mockRejectedValueOnce(new PlatformError("invalid_arguments", procedure))
      expect((await node({ op: "publish", path: "ventes/relance" })).text).toBe(procedure)
      // Le vrai service, sans brouillon ouvert (`55000` de `publish_node`, décidé avant lui).
      expect(await node({ op: "publish", path: "ventes/tarifs" })).toMatchObject({ isError: true, text: "Nothing to publish: ventes/tarifs has no pending draft." })

      // L'espace personnel de Claire est introuvable pour l'administrateur (H61, H66) : rien n'est tenté.
      const attempts = vi.mocked(publishNode).mock.calls.length
      expect(await node({ op: "publish", path: "private/claire/notes" })).toMatchObject({ isError: true, text: "Unknown path private/claire/notes." })
      expect(vi.mocked(publishNode).mock.calls.length).toBe(attempts)
      expect(codes(deps.journal)).toEqual([null, null, "stale_revision", "invalid_arguments", "invalid_arguments", "not_found"])
    })
  })

  describe("admin_node transfer_owner, first step (AC3)", () => {
    it("should summarise the transfer to a team, to a person and back to the parent's owner, and write nothing", async () => {
      const { node, sent } = await session()
      const acme = admin.orgs.acme.slug
      const before = await nodesOf(admin, seed)
      const team = await node({ op: "transfer_owner", path: "ventes/tarifs", owner: "team:support" })
      expect(team.text).toBe(
        [
          "About to give ventes/tarifs and its 1 descendant that inherits its owner to team Support.",
          `Management now: team Ventes (lead: Claire Morel); after: team Support; administrators of ${acme} keep it.`,
          NOTHING,
        ].join("\n"),
      )
      expect(team.structured?.next_actions).toEqual([])
      expect((await node({ op: "transfer_owner", path: "ventes/tarifs", owner: `user:${admin.persons.claire.email}` })).text).toBe(
        [
          "About to give ventes/tarifs and its 1 descendant that inherits its owner to Claire Morel (personal).",
          `Only Claire Morel will see these nodes: the administrators of ${acme} and the platform team lose access (personal space).`,
          NOTHING,
        ].join("\n"),
      )
      expect((await node({ op: "transfer_owner", path: "ventes/tarifs/remises", owner: "inherit" })).text).toBe(
        [
          "About to give ventes/tarifs/remises to team Ventes (lead: Claire Morel).",
          "It will inherit its owner from ventes/tarifs: team Ventes (lead: Claire Morel).",
          NOTHING,
        ].join("\n"),
      )
      expect(rewritten(before, await nodesOf(admin, seed))).toEqual([])
      expect(writes(sent)).toEqual([])
    })

    it("should count the inheriting descendants beyond one page of the database (supabase-patterns.md § Error Handling)", async () => {
      // 1 000 pages de plus sous ventes/tarifs, qui héritent : avec `grille`, 1 001 héritiers, au-delà d'une lecture.
      const mine = await ownSeed()
      const morePages = Array.from({ length: 1000 }, (_, index) => {
        const n = String(index).padStart(4, "0")
        return { id: `e1000000-0000-4000-8000-00000000${n}`, org_id: ORGS.acme.id, path: `ventes/tarifs/p${n}` }
      })
      await mine.admin.write({ nodes: morePages })
      const { node } = await session(mine.admin)
      const summary = await node({ op: "transfer_owner", path: "ventes/tarifs", owner: "team:support" })
      expect(summary.text.split("\n")[0]).toBe("About to give ventes/tarifs and its 1001 descendants that inherit their owner to team Support.")
    })

    it("should not count an inheriting descendant the caller cannot read (security-patterns.md § Droits dans le service)", async () => {
      // Une règle `none` pour Claire sur la grille : responsable de Ventes, elle gère ventes/tarifs, sans lire la grille (H66 (1 bis)).
      const hidden = { id: "f0000000-0000-4000-8000-000000000009", org_id: ORGS.acme.id, node_id: NODES["ventes/tarifs/grille"], account_id: null }
      await admin.write({ access_rules: [{ ...hidden, subject_team_id: null, subject_user_id: PERSONS.claire.id, level: "none" }] })
      try {
        const { node } = await session(admin, "claire")
        const summary = await node({ op: "transfer_owner", path: "ventes/tarifs", owner: "team:support" })
        expect(summary.text.split("\n")[0]).toBe("About to give ventes/tarifs to team Support.")
      } finally {
        await seed.admin`delete from platform.access_rules where id = ${admin.id(hidden.id)}`
      }
    })
  })

  describe("admin_node transfer_owner, second step (AC4)", () => {
    it("should write the owner of the node alone once confirmed, its inheriting descendants following, and change nothing for the same owner", async () => {
      const mine = await ownSeed()
      await mine.admin.write(content())
      const { node, sent } = await session(mine.admin)
      const before = await nodesOf(mine.admin, mine.seed)
      const blocks = await contentOf(mine.admin, mine.seed)
      // Trois blocs et un brouillon, relus avant tout transfert : la comparaison qui suit porte sur eux.
      expect(blocks.map((row) => [row.source, row.id, row.state])).toEqual([
        ["blocks", BLOCKS.tarifs, "draft"],
        ["blocks", BLOCKS.tarifs, "published"],
        ["blocks", BLOCKS.grille, "published"],
        ["node_drafts", NODES["ventes/tarifs"], null],
      ])
      const done = await node({ op: "transfer_owner", path: "ventes/tarifs", owner: "team:support", confirm: true })
      expect(done.text).toBe("ventes/tarifs now belongs to team Support (2 nodes changed owner).")
      const transferred = await nodesOf(mine.admin, mine.seed)
      expect(transferred["ventes/tarifs"]).toMatchObject({ owner_kind: "team", owner_team_id: TEAMS.support.id, owner_user_id: null, updated_by: PERSONS.sam.id })
      // Le descendant du même propriétaire le suit, écrit dans la même transaction (20261103150000) ; aucun bloc ni
      // brouillon n'est touché (ADR-011 § 2).
      expect(transferred["ventes/tarifs/grille"]).toMatchObject({ owner_kind: "team", owner_team_id: TEAMS.support.id })
      expect(rewritten(before, transferred).sort()).toEqual(["ventes/tarifs", "ventes/tarifs/grille"])
      expect(await contentOf(mine.admin, mine.seed)).toEqual(blocks)
      expect(writes(sent)).toEqual([
        ["nodes", "update"],
        ["nodes", "update"],
      ])

      const back = await node({ op: "transfer_owner", path: "ventes/tarifs", owner: "inherit", confirm: true })
      expect(back.text).toBe("ventes/tarifs now belongs to team Ventes (lead: Claire Morel) (2 nodes changed owner).")
      const inherited = await nodesOf(mine.admin, mine.seed)
      // `inherit` écrit le propriétaire du parent : aucun nœud ne redevient hérité.
      expect(inherited["ventes/tarifs"]).toMatchObject({ owner_kind: "team", owner_team_id: TEAMS.ventes.id, owner_user_id: null })
      expect(inherited["ventes/tarifs/grille"]).toMatchObject({ owner_kind: "team", owner_team_id: TEAMS.ventes.id })
      expect((await node({ op: "transfer_owner", path: "conseil", owner: "team:conseil", confirm: true })).text).toBe("conseil already belongs to team Conseil; nothing changed.")
      expect(rewritten(inherited, await nodesOf(mine.admin, mine.seed))).toEqual([])
      expect(await contentOf(mine.admin, mine.seed)).toEqual(blocks)
      expect(writes(sent)).toEqual([
        ["nodes", "update"],
        ["nodes", "update"],
        ["nodes", "update"],
        ["nodes", "update"],
      ])
    })

    it("should refuse a malformed owner, the root, private, a personal space, an unknown team, a non-member and a personal node, before any write", async () => {
      const sam = await session()
      const claire = await session(admin, "claire")
      const acme = admin.orgs.acme.slug
      const otto = admin.persons.otto.email
      const before = await nodesOf(admin, seed)
      const refused = async (args: Record<string, unknown>) => (await sam.node({ op: "transfer_owner", confirm: true, ...args })).text
      expect(await refused({ path: "ventes/tarifs", owner: "group:x" })).toBe("owner must be team:<slug>, user:<email>, org or inherit.")
      expect(await refused({ path: "guide", owner: "team:ventes" })).toBe("The root guide always belongs to the organisation.")
      expect(await refused({ path: "private", owner: "team:ventes" })).toBe("The owner of private cannot change: it holds the personal spaces.")
      expect(await refused({ path: "ventes/tarifs", owner: "team:achats" })).toBe(`Unknown team achats in ${acme}. Teams: conseil, support, ventes.`)
      expect(await refused({ path: "ventes/tarifs", owner: `user:${otto}` })).toBe(`No member of ${acme} has the email ${otto}. Invite them first from the web app (Équipes).`)
      expect(await refused({ path: "private/claire/notes", owner: "org" })).toBe("Unknown path private/claire/notes.")
      // Claire gère son espace personnel, sans pouvoir le donner (H61) : le service refuse avant `nodes_guard` (M26).
      expect((await claire.node({ op: "transfer_owner", path: "private/claire", owner: "team:ventes", confirm: true })).text).toBe(
        "The owner of private/claire cannot change: it is a personal space.",
      )
      expect(codes([...sam.deps.journal, ...claire.deps.journal])).toEqual([
        "invalid_arguments",
        "invalid_arguments",
        "invalid_arguments",
        "not_found",
        "not_found",
        "not_found",
        "invalid_arguments",
      ])
      expect(rewritten(before, await nodesOf(admin, seed))).toEqual([])
      expect(writes([...sam.sent, ...claire.sent])).toEqual([])
    })

    it("should refuse without the manage level, and let a lead who does not administer prepare making a node personal (fiche D18 B), without any write request", async () => {
      // Marc écrit sur ventes/tarifs par une règle, sans la gérer ; Claire mène Ventes, donc gère la page, sans administrer acme.
      // Fiche D18 B (M26) : la gestion suffit pour rendre le nœud personnel ; le premier temps le lui décrit comme à Sam,
      // l'écriture permise est prouvée avec la garde de la base (`tests/integration/proprietaires.test.ts`).
      const marc = await session(admin, "marc")
      const claire = await session(admin, "claire")
      const before = await nodesOf(admin, seed)
      expect((await marc.node({ op: "transfer_owner", path: "ventes/tarifs", owner: "team:support", confirm: true })).text).toBe(
        "Changing the owner of ventes/tarifs is reserved to team Ventes (lead: Claire Morel). Ask them to change it.",
      )
      expect((await claire.node({ op: "transfer_owner", path: "ventes/tarifs", owner: `user:${admin.persons.claire.email}` })).text).toBe(
        [
          "About to give ventes/tarifs and its 1 descendant that inherits its owner to Claire Morel (personal).",
          `Only Claire Morel will see these nodes: the administrators of ${admin.orgs.acme.slug} and the platform team lose access (personal space).`,
          NOTHING,
        ].join("\n"),
      )
      expect(rewritten(before, await nodesOf(admin, seed))).toEqual([])
      expect(writes([...marc.sent, ...claire.sent])).toEqual([])
      expect(codes([...marc.deps.journal, ...claire.deps.journal])).toEqual(["forbidden", null])
    })

    it("should answer conflict, logged first, when the node changed between the decision and the write (HN-E01S07-6)", async () => {
      const tarifs = admin.id(NODES["ventes/tarifs"])
      // Un autre écrit le nœud juste avant l'écriture du transfert, comme la base simulée au moment de l'écriture
      // (`meanwhile`) : `set_updated_at` change l'`updated_at` que garde l'écriture.
      const meanwhile = async (query: SentQuery) => {
        if (query.op === "update" && query.target === "nodes") await seed.admin`update platform.nodes set title = title where id = ${tarifs}`
      }
      const { deps, node } = await session(admin, "sam", { before: meanwhile })
      const refused = await node({ op: "transfer_owner", path: "ventes/tarifs", owner: "team:support", confirm: true })
      expect(refused).toMatchObject({ isError: true, text: "ventes/tarifs changed meanwhile: retry the transfer." })
      expect(codes(deps.journal)).toEqual(["conflict"])
      expect(loggedText(vi.mocked(console.error))).toContain(`[platform] transferOwner: no row written ${tarifs}`)
    })
  })

  describe("admin_node rules (AC5)", () => {
    it("should list the rules of a node with their subjects named, then its owner and how the rules apply", async () => {
      const { node } = await session()
      expect((await node({ op: "rules", path: "ventes/tarifs" })).text).toBe(
        ["- team Conseil: read", `- user Marc Petit <${admin.persons.marc.email}>: write`, `Owner: team Ventes (lead: Claire Morel). ${INHERITANCE}`].join("\n"),
      )
      expect((await node({ op: "rules", path: "conseil" })).text).toBe(["No rule on conseil.", `Owner: team Conseil. ${INHERITANCE}`].join("\n"))
    })

    it("should list the rule of the whole organisation, its subject named « organisation » (ADR-014)", async () => {
      const mine = await ownSeed()
      await mine.admin.write({ access_rules: [{ ...rule(9, {}, "write"), node_id: NODES.conseil, subject_org: true }] })
      const { node } = await session(mine.admin)
      const listed = await node({ op: "rules", path: "conseil" })
      expect(listed.text).toBe(["- organisation Acme Test: write", `Owner: team Conseil. ${INHERITANCE}`].join("\n"))
    })
  })

  describe("admin_node add_rule and remove_rule (AC6)", () => {
    it("should set a rule and say the level it replaced, remove one, and refuse a malformed subject or a subject without rule", async () => {
      const mine = await ownSeed()
      const { node } = await session(mine.admin)
      const { ada, marc } = mine.admin.persons
      expect((await node({ op: "add_rule", path: "ventes/tarifs", subject: "team:support", level: "read" })).text).toBe(
        "team Support now has read on ventes/tarifs and below, unless a closer rule says otherwise.",
      )
      expect((await node({ op: "add_rule", path: "ventes/tarifs", subject: `user:${marc.email}`, level: "read" })).text).toBe(
        `user Marc Petit <${marc.email}> now has read on ventes/tarifs and below, unless a closer rule says otherwise. It was write.`,
      )
      expect((await node({ op: "remove_rule", path: "ventes/tarifs", subject: "team:conseil" })).text).toBe(
        `team Conseil no longer has a rule on ventes/tarifs (it was read). ${INHERITANCE}`,
      )
      const rules = await mine.seed.admin<Row[]>`
        select subject_team_id, subject_user_id, level from platform.access_rules where node_id = ${mine.admin.id(NODES["ventes/tarifs"])}`
      const bySubject = mine.admin.readable([...rules]).map((row) => [String(row.subject_team_id ?? row.subject_user_id), row.level])
      expect(bySubject.sort()).toEqual([
        [PERSONS.marc.id, "read"],
        [TEAMS.support.id, "read"],
      ])
      expect((await node({ op: "add_rule", path: "ventes/tarifs", subject: "org", level: "read" })).text).toBe("subject must be team:<slug> or user:<email>.")
      expect((await node({ op: "remove_rule", path: "ventes/tarifs", subject: `user:${ada.email}` })).text).toBe(
        `No rule for user Ada Martin <${ada.email}> on ventes/tarifs.`,
      )
    })
  })
})
