// @vitest-environment node
// Arbre et droits sur les nœuds (E01-S04 : AC1 à AC7, AC12 à AC14, AC26) : chaque cas lit le niveau par
// `platform.node_level_for` sous la session de la personne (`sqlNodeLevel`). Depuis E01-S08, la RLS n'isole que les
// organisations : les cas qui prouvaient un niveau par une policy (visibilité lue par `select`, écriture
// refusée) sont retirés (HN-E01S08-9) ; la garde de l'arbre et les fonctions restent. Les valeurs des
// niveaux se prouvent par le calcul pur (`tests/unit/access-levels.test.ts`) et la parité TypeScript
// contre SQL (`access-parity.test.ts`) ; seules restent ici les deux règles qu'aucun scénario de parité ne
// joue (M11b). Les mêmes personnes servent plusieurs organisations jetables. Suite portable depuis
// E01-S10 f2 : chaque personne par sa session (`fx.as`), sans PostgREST ni Supabase Auth ; le job
// `bare-postgres` la joue. Depuis E01-S12 partie c, la garde de l'arbre ne contrôle plus aucun niveau
// (ADR-012 § 3) : les refus de déplacement par niveau et les pouvoirs du responsable (AC7, AC11) sont
// ceux du service (`tests/unit/nodes-move.test.ts`, `tests/unit/nodes-publish.test.ts`).
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import type { PlatformDb } from "../../packages/plateforme/server/db"
import { hex, type ReferencePerson } from "../helpers/plateforme"
import { codeOf, createSqlFixtures, failureOf, SQL_SKIP_REASON, sqlConfigured, sqlNodeLevel, type SqlFixtures, type SqlReferenceOrg, type SqlUser } from "../helpers/sql"
import { privateFolderPending, privateFolderSuite } from "../helpers/pending-migrations"

// Ces tests supposent le dossier `private` en base (fiche D107) : sautés, la version nommée, tant que
// 20260928120000 n'est pas appliquée au projet (`database-patterns.md § Règles`).
const privatePending = await privateFolderPending()

const NETWORK_TIMEOUT = 60_000
const SETUP_TIMEOUT = 180_000
const SUITE = "tree and node rights"

type Who = ReferencePerson | "zoe"
type NodeRow = { path: string; lpath: string; parent_id: string | null; kind: string; status: string; revision: number; owner_kind: string | null; owner_team_id: string | null; owner_user_id: string | null }

describe.skipIf(!sqlConfigured || privatePending)(privateFolderSuite(sqlConfigured ? SUITE : `${SUITE} (${SQL_SKIP_REASON})`, privatePending), { timeout: NETWORK_TIMEOUT }, () => {
  let fx: SqlFixtures
  let o: SqlReferenceOrg
  let zoe: SqlUser

  const as = (who: Who): PlatformDb => fx.as(who === "zoe" ? zoe : o.people[who])

  /** Niveau par la fonction, pour chaque personne. */
  async function expectLevels(nodeId: string, expected: [Who, number][]) {
    const seen = []
    for (const [who] of expected) seen.push([who, await sqlNodeLevel(as(who), nodeId)])
    expect(seen).toEqual(expected)
  }

  async function clearRules(orgId: string) {
    await fx.admin`delete from platform.access_rules where org_id = ${orgId}`
  }

  async function nodeRow(id: string): Promise<NodeRow> {
    const [row] = await fx.admin<NodeRow[]>`
      select path, lpath::text as lpath, parent_id, kind, status, revision, owner_kind, owner_team_id, owner_user_id from platform.nodes where id = ${id}`
    if (!row) throw new Error("nodes read failed: no row")
    return row
  }

  /** Une mise à jour d'un nœud sous la session de la personne, colonnes données. */
  const updateNode = (who: Who, id: string, patch: Record<string, unknown>) =>
    as(who).tx((sql) => sql<{ id: string }[]>`update platform.nodes set ${sql(patch)} where id = ${id} returning id`)

  /** Une insertion de nœud sous la session de la personne, colonnes données. */
  const insertNode = (who: Who, row: Record<string, unknown>) => as(who).tx((sql) => sql`insert into platform.nodes ${sql(row)} returning kind`)

  /** Chaque chemin suit celui de son parent, et chaque nœud remonte à la racine (aucun cycle). */
  async function expectConsistentTree(orgId: string) {
    const rows = await fx.admin<{ id: string; parent_id: string | null; path: string }[]>`select id, parent_id, path from platform.nodes where org_id = ${orgId}`
    const byId = new Map(rows.map((row) => [row.id, row]))
    const expectedPath = (row: (typeof rows)[number]) => {
      const parent = row.parent_id === null ? undefined : byId.get(row.parent_id)
      const segment = row.path.split("/").at(-1)
      return parent?.parent_id === null ? segment : `${parent?.path}/${segment}`
    }
    const reachesRoot = (row: (typeof rows)[number]) => {
      let current: (typeof rows)[number] | undefined = row
      for (let step = 0; current && step <= rows.length; step++) {
        if (current.parent_id === null) return true
        current = byId.get(current.parent_id)
      }
      return false
    }
    const astray = rows.filter((row) => row.parent_id !== null && row.path !== expectedPath(row)).map((row) => row.path)
    const cyclic = rows.filter((row) => !reachesRoot(row)).map((row) => row.path)
    expect({ astray, cyclic }).toEqual({ astray: [], cyclic: [] })
  }

  beforeAll(async () => {
    fx = createSqlFixtures()
    o = await fx.buildReferenceOrg()
    zoe = await fx.createUser({ fullName: "Zoé Lambert" })
  }, SETUP_TIMEOUT)

  afterAll(async () => {
    await fx?.cleanup()
  }, SETUP_TIMEOUT)

  describe("migration (AC1)", () => {
    it("should compute lpath: empty for the root, dotted for a path", async () => {
      const rows = await fx.admin`
        select path, lpath::text as lpath from platform.nodes where org_id = ${o.org.id} and path in ('guide', 'ventes/devis') order by path`
      expect(rows).toEqual([
        { path: "guide", lpath: "" },
        { path: "ventes/devis", lpath: "ventes.devis" },
      ])
    })

    it("should refuse a second root in the organisation (23505)", async () => {
      const root = fx.admin`
        insert into platform.nodes (org_id, parent_id, path, title, summary, owner_kind) values (${o.org.id}, null, 'guide', 'Autre', 'Autre racine.', 'org')`
      expect(await codeOf(root)).toBe("23505")
    })

    it("should refuse a root with a path other than guide or an owner other than the organisation (23514)", async () => {
      const empty = await fx.createOrg()
      for (const root of [
        { path: "autre", owner_kind: "org" },
        { path: "guide", owner_kind: null },
      ] as const) {
        const insert = fx.admin`
          insert into platform.nodes (org_id, parent_id, title, summary, path, owner_kind) values (${empty.id}, null, 'Racine', 'Racine.', ${root.path}, ${root.owner_kind})`
        expect(await codeOf(insert), root.path).toBe("23514")
      }
    })

    it("should refuse a team with a reserved slug: guide, private, contexte, journal (23514)", async () => {
      for (const slug of ["guide", "private", "contexte", "journal"]) {
        expect(await codeOf(fx.admin`insert into platform.teams (org_id, slug, name) values (${o.org.id}, ${slug}, ${slug})`), slug).toBe("23514")
      }
    })
  })

  // Les règles d'AC3 et d'AC4 (partage, règle la plus proche, responsable nommée) sont les scénarios
  // « closest rule » et « lead and person » de la parité ; restent les deux qu'elle ne joue pas.
  describe("rules (AC5, AC6)", () => {
    const leaveTeam = (team: string, user: string) => fx.admin`delete from platform.team_members where team_id = ${team} and user_id = ${user}`

    // Après chaque cas : aucune règle ni appartenance d'un cas ne compte dans un autre, quel que
    // soit l'ordre (testing-strategy.md § Anti-patterns).
    afterEach(async () => {
      await clearRules(o.org.id)
      await leaveTeam(o.teams.ventes, o.people.marc.id)
      await leaveTeam(o.teams.support, o.people.lea.id)
    }, NETWORK_TIMEOUT)

    it("should give the highest level of the person's teams at the closest node (AC5)", async () => {
      await fx.addTeamMember(o.teams.support, o.people.lea.id)
      await fx.addRule({ orgId: o.org.id, nodeId: o.nodes.faq, teamId: o.teams.ventes, level: "read" })
      await fx.addRule({ orgId: o.org.id, nodeId: o.nodes.faq, teamId: o.teams.support, level: "write" })
      await expectLevels(o.nodes.faq, [["lea", 2]])
      await clearRules(o.org.id)
      await leaveTeam(o.teams.support, o.people.lea.id)
    })

    // AC6 écrit « Claire 2 » ; H66 (1 bis), N7 et AC4 lui donnent 3 : une règle qui vise son équipe
    // ne ferme pas la responsable de l'équipe propriétaire. Marc, ajouté à Ventes, porte le cas « un
    // membre de l'équipe sans règle nominative » (hypothèse N26 de la story).
    it("should let the person's rule win over the team's at the same node, even lower (AC6)", async () => {
      await fx.addTeamMember(o.teams.ventes, o.people.marc.id)
      await fx.addRule({ orgId: o.org.id, nodeId: o.nodes.devis, teamId: o.teams.ventes, level: "write" })
      await fx.addRule({ orgId: o.org.id, nodeId: o.nodes.devis, userId: o.people.lea.id, level: "read" })
      await expectLevels(o.nodes.devis, [["lea", 1], ["marc", 2], ["claire", 3]])
    })
  })

  describe("moves (AC7)", () => {
    let m: SqlReferenceOrg

    beforeAll(async () => {
      m = await fx.buildReferenceOrg(o.people)
    }, SETUP_TIMEOUT)

    const move = (who: Who, id: string, parentId: string, path: string) => updateNode(who, id, { parent_id: parentId, path })

    // Chaque refus vérifie son message : `ventes` et `private` contiennent un Contexte, dont la règle
    // (P39) lèverait aussi 23514 dans la cascade si la garde ne les arrêtait pas avant.
    it("should refuse moving a node under its own descendant (23514), a Contexte below or not", async () => {
      const cycle = await failureOf(move("ada", m.nodes.devis, m.nodes.modele, "ventes/devis/modele/devis"))
      expect(cycle?.code).toBe("23514")
      expect(cycle?.message).toContain("a node cannot move under itself")
      expect((await nodeRow(m.nodes.devis)).parent_id).toBe(m.nodes.ventes)
      const folder = await failureOf(move("ada", m.nodes.ventes, m.nodes.devis, "ventes/devis/ventes"))
      expect(folder?.message).toContain("a node cannot move under itself")
    })

    it("should refuse a path that does not follow the parent (23514)", async () => {
      const astray = await failureOf(updateNode("ada", m.nodes.devis, { path: "support/autre" }))
      expect(astray?.code).toBe("23514")
      expect(astray?.message).toContain("path must be ventes/autre under its parent")
    })

    it("should refuse moving the private folder (23514)", async () => {
      const moved = await failureOf(move("ada", m.nodes.private, m.nodes.ventes, "ventes/private"))
      expect(moved?.code).toBe("23514")
      expect(moved?.message).toContain("the private folder does not move")
    })

    // Les déplacements réussis portent sur des nœuds créés par le cas : `ventes/devis` reste en place
    // pour les refus ci-dessus, quel que soit l'ordre. Le propriétaire
    // se lit sur la ligne (M11b) : le niveau qu'il donne à chacun est celui du calcul pur et de la
    // parité (`access-levels.test.ts` AC1, `access-parity.test.ts`).
    it("should move a node and its descendants in one update, the inherited owner following the place", async () => {
      const moving = await fx.createNode(m.org.id, { parentId: m.nodes.ventes, path: "ventes/catalogue", title: "Catalogue" })
      const child = await fx.createNode(m.org.id, { parentId: moving, path: "ventes/catalogue/grille", title: "Grille" })
      expect(await move("ada", moving, m.nodes.support, "support/catalogue")).toHaveLength(1)
      expect(await nodeRow(child)).toMatchObject({ path: "support/catalogue/grille", lpath: "support.catalogue.grille" })
      expect(await nodeRow(moving)).toMatchObject({ parent_id: m.nodes.support, owner_kind: null })
    })

    it("should keep an explicit owner when the node moves", async () => {
      const owned = await fx.createNode(m.org.id, {
        parentId: m.nodes.ventes,
        path: "ventes/remises",
        title: "Remises",
        ownerKind: "team",
        ownerTeamId: m.teams.ventes,
      })
      expect(await codeOf(move("ada", owned, m.nodes.support, "support/remises"))).toBeNull()
      expect(await nodeRow(owned)).toMatchObject({ path: "support/remises", owner_kind: "team", owner_team_id: m.teams.ventes })
    })

    // Fiche D18 B (tâche M26) : la garde de M02 qui réservait à l'admin de rendre personnel un nœud part ;
    // tout gestionnaire le peut, par son propriétaire comme par un déplacement. Le cas qui la prouvait ici
    // change d'attendu et devient portable : `tests/integration/proprietaires.test.ts`.
  })

  describe("personal space (AC13)", () => {
    /**
     * Un espace personnel posé par la connexion d'administration : depuis `20261021110000`, une session ne pose plus de
     * propriétaire (droits de colonne) ; un espace se crée par `ensure_private_space`, `security definer`, et la garde de
     * l'arbre, qui tient pour tout écrivain, se prouve ici.
     */
    const personal = (row: { path: string; owner_kind: string; owner_user_id: string; created_by: string }) =>
      fx.admin`insert into platform.nodes ${fx.admin({ org_id: o.org.id, parent_id: o.nodes.private, kind: "page", title: "Perso", summary: "Espace.", ...row })} returning kind`

    it("should give a member joining after the tree a space and its Contexte, for them only", async () => {
      const contexte = await fx.nodeId(o.org.id, "private/marc/contexte")
      expect(await nodeRow(o.spaces.marc)).toMatchObject({
        path: "private/marc",
        owner_kind: "user",
        owner_user_id: o.people.marc.id,
        kind: "page",
        status: "draft",
        revision: 0,
      })
      // Genre du Contexte d'un nouveau membre (E01-S06 AC3), repris de `contenu-schema.test.ts` (M11b).
      expect((await nodeRow(contexte)).kind).toBe("context")
      await expectLevels(o.spaces.marc, [["marc", 3], ["ada", 0], ["claire", 0]])
      await expectLevels(contexte, [["marc", 3], ["ada", 0], ["claire", 0]])
      const notes = insertNode("marc", { org_id: o.org.id, parent_id: o.spaces.marc, path: "private/marc/notes", title: "Notes", summary: "Notes.", created_by: o.people.marc.id })
      expect(await codeOf(notes)).toBeNull()
    })

    it("should refuse by the guard a space whose segment is not the owner's handle (23514)", async () => {
      const marc = personal({ path: "private/claire", owner_kind: "user", owner_user_id: o.people.marc.id, created_by: o.people.marc.id })
      expect(await codeOf(marc)).toBe("23514")
      const claire = personal({ path: "private/marc", owner_kind: "user", owner_user_id: o.people.claire.id, created_by: o.people.claire.id })
      expect(await codeOf(claire)).toBe("23514")
      const orphan = fx.admin`insert into platform.nodes (org_id, parent_id, path, title, summary) values (${o.org.id}, ${o.nodes.private}, 'private/inconnu', 'Perso', 'Espace.')`
      expect(await codeOf(orphan)).toBe("23514")
    })
  })

  describe("tree guard (AC14)", () => {
    let other: { org: string; root: string; team: string }

    beforeAll(async () => {
      const b = await fx.createOrg()
      const tree = await fx.createTree(b.id)
      const team = await fx.createTeam(b.id, { slug: "equipe_b", name: "Équipe B" })
      other = { org: b.id, root: tree.root, team: team.id }
    }, SETUP_TIMEOUT)

    const update = (id: string, patch: Record<string, unknown>) => updateNode("ada", id, patch)
    /**
     * Une mise à jour par la connexion d'administration : depuis `20261021110000`, une session n'écrit ni `org_id` ni le
     * genre d'un nœud (droits de colonne) ; la garde de l'arbre, qui tient pour tout écrivain (`publish_node` change le
     * genre), se prouve ici.
     */
    const adminUpdate = (id: string, patch: Record<string, unknown>) => fx.admin`update platform.nodes set ${fx.admin(patch)} where id = ${id} returning id`

    it("should refuse a parent taken in another organisation (23503)", async () => {
      const intrus = insertNode("ada", { org_id: o.org.id, parent_id: other.root, path: "intrus", title: "Intrus", summary: "Intrus.", created_by: o.people.ada.id })
      expect(await codeOf(intrus)).toBe("23503")
    })

    it("should refuse changing org_id, or switching a page to a table and a table to a page (23514)", async () => {
      expect(await codeOf(adminUpdate(o.nodes.faq, { org_id: other.org }))).toBe("23514")
      expect(await codeOf(adminUpdate(o.nodes.faq, { kind: "table" }))).toBe("23514")
      const table = await fx.createNode(o.org.id, { parentId: o.nodes.support, path: "support/tickets", kind: "table", title: "Tickets" })
      const failure = await failureOf(adminUpdate(table, { kind: "page" }))
      expect(failure?.code).toBe("23514")
      expect(failure?.message).toContain("a table does not change kind")
      expect((await nodeRow(table)).kind).toBe("table")
    })

    it("should let a page switch to a procedure and back, never a Contexte (23514, P39)", async () => {
      expect(await codeOf(adminUpdate(o.nodes.faq, { kind: "procedure" }))).toBeNull()
      expect(await codeOf(adminUpdate(o.nodes.faq, { kind: "page" }))).toBeNull()
      // Ni procédure ni page : un Contexte reste `context` (E01-S06 AC4, repris de `contenu-schema.test.ts`).
      for (const kind of ["procedure", "page"] as const) {
        expect(await codeOf(adminUpdate(o.nodes.ventesContexte, { kind })), kind).toBe("23514")
      }
    })

    // La règle du genre (E01-S06 AC4, N15), tenue par la garde de l'arbre, reprise de
    // `contenu-schema.test.ts` (M11b) : le Contexte d'Équipe B est supprimé puis recréé.
    it("should keep kind context to the path of a Contexte, and make a page created there a context (23514, N15)", async () => {
      const folder = await fx.nodeId(other.org, "equipe_b")
      await fx.admin`delete from platform.nodes where org_id = ${other.org} and path = 'equipe_b/contexte'`
      const insertAt = (path: string, kind: "page" | "procedure" | "table" | "context") =>
        fx.admin`insert into platform.nodes (org_id, parent_id, path, kind, title, summary) values (${other.org}, ${folder}, ${path}, ${kind}, 'Contexte', 'Contexte recréé.') returning kind`
      expect(await codeOf(insertAt("equipe_b/contexte", "procedure"))).toBe("23514")
      expect(await codeOf(insertAt("equipe_b/contexte", "table"))).toBe("23514")
      expect(await codeOf(insertAt("equipe_b/notes", "context"))).toBe("23514")
      expect(await insertAt("equipe_b/contexte", "page")).toEqual([{ kind: "context" }])
    })

    it("should refuse changing created_by (42501)", async () => {
      expect(await codeOf(update(o.nodes.faq, { created_by: o.people.ada.id }))).toBe("42501")
    })

    it("should refuse a team of another organisation as explicit owner (23503)", async () => {
      expect(await codeOf(update(o.nodes.faq, { owner_kind: "team", owner_team_id: other.team }))).toBe("23503")
    })

    // N32 : un propriétaire hérité (`owner_kind` NULL) ne porte ni équipe ni personne. NULL passe un
    // CHECK (database-patterns.md § Migrations) : sans `nodes_owner_inherited_check`, un membre
    // accrochait à un nœud de son espace une équipe, même d'une autre organisation, ou une personne,
    // que plus rien ne supprimait. La contrainte vaut pour tout rôle : la connexion d'administration la prouve.
    it("should refuse an inherited owner that names a person or a team, or keeps it on a folder made inherited (23514, N32)", async () => {
      const person = await failureOf(fx.admin`
        insert into platform.nodes (org_id, parent_id, path, title, summary, created_by, owner_kind, owner_user_id)
        values (${o.org.id}, ${o.spaces.marc}, ${`private/marc/probe_${hex(3)}`}, 'Sonde', 'Sonde.', ${o.people.marc.id}, null, ${o.people.claire.id})`)
      expect(person?.code).toBe("23514")
      expect(person?.message).toContain("nodes_owner_inherited_check")
      const named = await failureOf(update(o.nodes.faq, { owner_team_id: other.team }))
      expect(named?.code).toBe("23514")
      expect(named?.message).toContain("nodes_owner_inherited_check")
      expect(await codeOf(update(o.nodes.support, { owner_kind: null }))).toBe("23514")
      expect(await nodeRow(o.nodes.support)).toMatchObject({ owner_kind: "team", owner_team_id: o.teams.support })
      expect((await nodeRow(o.nodes.faq)).owner_team_id).toBeNull()
    })

    it("should refuse moving the root (23514)", async () => {
      expect(await codeOf(update(o.nodes.root, { parent_id: o.nodes.contexte }))).toBe("23514")
    })

    it("should delete neither the root, private, nor a Contexte (0 rows)", async () => {
      const claireContexte = await fx.nodeId(o.org.id, "private/claire/contexte")
      const ids = [o.nodes.root, o.nodes.private, o.nodes.contexte, o.nodes.ventesContexte]
      expect(await as("ada").tx((sql) => sql`delete from platform.nodes where id in ${sql(ids)} returning id`)).toEqual([])
      expect(await as("claire").tx((sql) => sql`delete from platform.nodes where id = ${claireContexte} returning id`)).toEqual([])
    })

    // Depuis 20261021150000, une session ne supprime qu'un nœud jamais publié par son auteur (`undoCreation`) ; la
    // corbeille se purge par `purge_trash` et `erase_team_trash` : la clé du parent se prouve sur un dossier rendu
    // jamais publié et attribué à Ada, ses sous-pages en place.
    it("should refuse deleting a node that has children (23503)", async () => {
      const [before] = await fx.admin<{ revision: number; created_by: string | null }[]>`select revision, created_by from platform.nodes where id = ${o.nodes.devis}`
      await fx.admin`update platform.nodes set revision = 0, created_by = ${o.people.ada.id} where id = ${o.nodes.devis}`
      try {
        expect(await codeOf(as("ada").tx((sql) => sql`delete from platform.nodes where id = ${o.nodes.devis} returning id`))).toBe("23503")
      } finally {
        await fx.admin`update platform.nodes set revision = ${before.revision}, created_by = ${before.created_by} where id = ${o.nodes.devis}`
      }
    })

    // N33 : `lpath` (`text2ltree`) se calcule avant la contrainte de `path` ; la garde contrôle le
    // chemin la première, sinon un segment qu'`ltree` refuse sortait en 42601 ou 42622.
    // Le point (séparateur d'`ltree`) et NULL : les deux cas que la garde doit voir avant `text2ltree`.
    // NULL passe un `if` (database-patterns.md § Migrations) : le chemin NULL est essayé aussi.
    it.each([
      ["a dot", "notes.v2"],
      ["NULL", null],
    ])("should refuse a path with %s (23514, H51)", async (_label, path) => {
      const insert = insertNode("ada", { org_id: o.org.id, parent_id: o.nodes.root, path, title: "Notes", summary: "Notes.", created_by: o.people.ada.id })
      expect(await codeOf(insert)).toBe("23514")
    })
  })

  // Revue d'E01-S04 (cycle 3) : la garde contrôle le cycle et « chemin = chemin du parent +
  // segment » sur un instantané. Sans verrou, une écriture sous un dossier que l'on déplace au même
  // moment, invisible du déplacement avant sa validation, gardait l'ancien chemin du dossier
  // (hypothèse N36, classe 7301). Chaque cas a son organisation : un arbre abîmé n'en fausse pas
  // un autre.
  describe("concurrent tree writes (AC7, AC14)", () => {
    /** Organisation jetable avec son arbre, dont Ada est l'admin. */
    async function treeOrg(): Promise<{ org: string; root: string }> {
      const org = await fx.createOrg()
      const tree = await fx.createTree(org.id)
      await fx.addMember(org.id, o.people.ada.id, { role: "admin" })
      return { org: org.id, root: tree.root }
    }

    const move = (id: string, parentId: string, path: string) => codeOf(updateNode("ada", id, { parent_id: parentId, path }))

    /** Ouvre d'avance les connexions du pool du serveur : les écritures simultanées arrivent alors ensemble en base. */
    const warmUp = (root: string, count: number) =>
      Promise.all(Array.from({ length: count }, () => as("ada").tx((sql) => sql`select id from platform.nodes where id = ${root}`)))

    // Une écriture perdante est refusée par la garde (chemin périmé, cycle : 23514) ou désignée par
    // Postgres pour lever un interblocage (40P01) ; jamais pour une autre raison.
    const EXPECTED_OUTCOMES = ["ok", "23514", "40P01"]
    const unexpected = (codes: (string | null)[]) => codes.map((code) => code ?? "ok").filter((code) => !EXPECTED_OUTCOMES.includes(code))

    // Les déplacements croisés (A sous B, B sous A) ne sont plus joués (M11b) : la clé étrangère de
    // `parent_id` les refuse par le verrou de la ligne parente, Postgres et non la garde.
    it("should keep every node moved under a folder that moves at the same time under its parent's path", async () => {
      const c = await treeOrg()
      const folder = await fx.createNode(c.org, { parentId: c.root, path: "dossier" })
      const target = await fx.createNode(c.org, { parentId: c.root, path: "cible" })
      const pages: string[] = []
      for (let k = 0; k < 8; k++) pages.push(await fx.createNode(c.org, { parentId: c.root, path: `page_${k}` }))
      await warmUp(c.root, 9)
      const attempts = await Promise.all([
        ...pages.slice(0, 4).map((page, k) => move(page, folder, `dossier/page_${k}`)),
        move(folder, target, "cible/dossier"),
        ...pages.slice(4).map((page, k) => move(page, folder, `dossier/page_${k + 4}`)),
      ])
      expect(unexpected(attempts)).toEqual([])
      await expectConsistentTree(c.org)
    })

    it("should keep every node created under a folder that moves at the same time under its parent's path", async () => {
      const c = await treeOrg()
      const folder = await fx.createNode(c.org, { parentId: c.root, path: "dossier" })
      const target = await fx.createNode(c.org, { parentId: c.root, path: "cible" })
      const create = (k: number) =>
        codeOf(insertNode("ada", { org_id: c.org, parent_id: folder, path: `dossier/n${k}`, title: "Note", summary: "Note.", created_by: o.people.ada.id }))
      await warmUp(c.root, 9)
      const attempts = await Promise.all([
        ...Array.from({ length: 4 }, (_, k) => create(k)),
        move(folder, target, "cible/dossier"),
        ...Array.from({ length: 4 }, (_, k) => create(k + 4)),
      ])
      expect(unexpected(attempts)).toEqual([])
      await expectConsistentTree(c.org)
    })
  })

  describe("Contexte nodes (AC26)", () => {
    const insertTeam = (row: Record<string, unknown>) => as("ada").tx((sql) => sql<{ id: string }[]>`insert into platform.teams ${sql(row)} returning id`)
    const teamsWithSlug = (slug: string) => fx.admin`select id from platform.teams where org_id = ${o.org.id} and slug = ${slug}`

    it("should give a team created under a session its folder and Contexte, with the team's levels", async () => {
      const [created] = await insertTeam({ org_id: o.org.id, slug: "conseil", name: "Conseil", lead_user_id: o.people.marc.id })
      await fx.addTeamMember(created.id, o.people.lea.id)
      // `kind` : genre du Contexte d'une équipe nouvelle et de son dossier (E01-S06 AC3), repris de
      // `contenu-schema.test.ts` (M11b).
      const rows = await fx.admin`
        select path, title, kind, owner_kind, owner_team_id, status, revision from platform.nodes
        where org_id = ${o.org.id} and path like 'conseil%' order by path`
      expect(rows).toEqual([
        { path: "conseil", title: "Conseil", kind: "page", owner_kind: "team", owner_team_id: created.id, status: "draft", revision: 0 },
        { path: "conseil/contexte", title: "Contexte", kind: "context", owner_kind: null, owner_team_id: null, status: "draft", revision: 0 },
      ])
      const contexte = await fx.nodeId(o.org.id, "conseil/contexte")
      await expectLevels(contexte, [["marc", 3], ["lea", 2], ["paul", 0]])
    })

    it("should write no node for a team or a member of an organisation without a tree", async () => {
      const bare = await fx.createOrg()
      await fx.createTeam(bare.id, { slug: "ventes", name: "Ventes" })
      await fx.addMember(bare.id, zoe.id, { profile: { handle: "zoe" } })
      expect(await fx.admin`select id from platform.nodes where org_id = ${bare.id}`).toEqual([])
    })

    it("should refuse a team whose folder path is taken (23505), creating neither the team nor its nodes", async () => {
      await fx.createNode(o.org.id, { parentId: o.nodes.root, path: "archives", title: "Archives" })
      expect(await codeOf(insertTeam({ org_id: o.org.id, slug: "archives", name: "Archives" }))).toBe("23505")
      expect(await teamsWithSlug("archives")).toEqual([])
      expect(await fx.admin`select path from platform.nodes where org_id = ${o.org.id} and path like 'archives%'`).toEqual([{ path: "archives" }])
    })

    // N28 : le dossier d'une équipe porte son slug, qui doit donc être un segment de chemin (H51)
    // dès que l'arbre existe.
    it("should refuse a team whose slug is not a path segment once the tree exists (23514)", async () => {
      expect(await codeOf(insertTeam({ org_id: o.org.id, slug: "service-client", name: "Service client" }))).toBe("23514")
      expect(await teamsWithSlug("service-client")).toEqual([])
    })

    // Zoé et Lou ont le même handle (`test-<hex>` et `test.<hex>` donnent `test_<hex>`) : Lou part en
    // laissant son espace, Zoé entre par invitation et reçoit `<handle>_2`, puis Lou revient.
    it("should keep the space of a returning member, and give a namesake a fresh one (unique_handle)", async () => {
      const n = await fx.createOrg()
      await fx.createTree(n.id)
      const localPart = zoe.email.split("@")[0]
      const handle = localPart.replace(/-/g, "_")
      const lou = await fx.createUser({ email: `${localPart.replace("-", ".")}@example.invalid` })
      await fx.addMember(n.id, lou.id, { profile: { handle } })
      const space = await fx.nodeId(n.id, `private/${handle}`)
      await fx.admin`delete from platform.members where org_id = ${n.id} and user_id = ${lou.id}`

      await fx.admin`insert into platform.invitations (org_id, email) values (${n.id}, ${zoe.email})`
      expect(await codeOf(as("zoe").tx((sql) => sql`select platform.accept_invitations()`))).toBeNull()
      const [member] = await fx.admin<{ profile: unknown }[]>`select profile from platform.members where org_id = ${n.id} and user_id = ${zoe.id}`
      expect(member.profile).toMatchObject({ handle: `${handle}_2` })
      expect(await nodeRow(await fx.nodeId(n.id, `private/${handle}_2`))).toMatchObject({ owner_user_id: zoe.id })
      await fx.nodeId(n.id, `private/${handle}_2/contexte`)

      await fx.addMember(n.id, lou.id, { profile: { handle } })
      expect(await fx.nodeId(n.id, `private/${handle}`)).toBe(space)
      expect(await nodeRow(space)).toMatchObject({ owner_user_id: lou.id })
      await fx.nodeId(n.id, `private/${handle}/contexte`)
    })

    // Revue d'E01-S04 (cycle 3) : le dossier d'une équipe porte son slug (P39). Un slug changé par
    // l'API retirait à `<ancien>/contexte` son statut de Contexte, supprimable en une requête de
    // plus ; un admin de deux organisations déplaçait une équipe de l'une à l'autre (hypothèse N38).
    it("should refuse changing the slug or the organisation of a team under a session (42501), not its name", async () => {
      const other = await fx.createOrg()
      await fx.addMember(other.id, o.people.ada.id, { role: "admin" })
      const updateTeam = (patch: Record<string, unknown>) =>
        as("ada").tx((sql) => sql`update platform.teams set ${sql(patch)} where id = ${o.teams.ventes} returning name`)
      for (const patch of [{ slug: "ventes_2" }, { org_id: other.id }]) {
        expect(await codeOf(updateTeam(patch)), Object.keys(patch)[0]).toBe("42501")
      }
      expect(await fx.admin`select slug, org_id from platform.teams where id = ${o.teams.ventes}`).toEqual([{ slug: "ventes", org_id: o.org.id }])
      expect(await updateTeam({ name: "Ventes" })).toEqual([{ name: "Ventes" }])
    })

    it("should move neither a Contexte nor its folder, even by the administration connection (23514)", async () => {
      const claireContexte = await fx.nodeId(o.org.id, "private/claire/contexte")
      const moves = [
        () => fx.admin`update platform.nodes set parent_id = ${o.nodes.support}, path = 'support/contexte_ventes' where id = ${o.nodes.ventesContexte}`,
        () => fx.admin`update platform.nodes set parent_id = ${o.nodes.support}, path = 'support/ventes' where id = ${o.nodes.ventes}`,
        () => fx.admin`update platform.nodes set parent_id = ${o.spaces.lea}, path = 'private/lea/contexte_claire' where id = ${claireContexte}`,
        () => fx.admin`update platform.nodes set parent_id = ${o.nodes.ventes}, path = 'ventes/contexte_tous' where id = ${o.nodes.contexte}`,
      ]
      for (const attempt of moves) expect(await codeOf(attempt())).toBe("23514")
      expect((await nodeRow(o.nodes.ventesContexte)).path).toBe("ventes/contexte")
      expect((await nodeRow(o.nodes.ventes)).path).toBe("ventes")
    })
  })
})
