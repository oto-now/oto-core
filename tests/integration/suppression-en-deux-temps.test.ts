// @vitest-environment node
// E11-S02 sur une vraie base (lots d, e, f) : abandonner un brouillon (`node.discard_draft`, AC-d1 à AC-d5),
// mettre à la corbeille (`node.trash`, AC-e1 à AC-e3) et supprimer des lignes (`table.delete_rows`, AC-f1 à
// AC-f6), derrière `call` (`runCall`), en deux temps. La base est le sujet : `platform.discard_draft` (verrou,
// tampon), la corbeille de `trashNode`, la suppression gardée par la révision relue. Fixture d'E07-S01 semée
// (`seedTableFixture`, une graine pour le fichier ; suite portable), le tableau remis à son état par
// `freshTable` ; refus sans requête d'écriture et courses par `spyDb`.
// Par le MCP (AC-h1, AC-h2, AC-b1) : `InMemoryTransport` (`connectDeps`) sur la même fixture, codes `ctx` semés. Ce
// qu'on vérifie est ce que le modèle lit : `find` trouve les trois fonctions qui suppriment, `read` sert leur contrat
// en deux temps, `call` rend le récapitulatif puis l'exécution, le même texte dans les deux canaux, et la ligne de
// journal d'une suppression de lignes porte `_outcome` (celle du récapitulatif non).
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { runCall, type CallInput } from "../../packages/plateforme/server/calls"
import { readNode } from "../../packages/plateforme/server/nodes/read"
import { writeNode } from "../../packages/plateforme/server/nodes/write"
import { LEASE_ACTIVE, LEASE_EXPIRED, PROSPECTS } from "../factories/table-fixture"
import { seedTableFixture } from "../factories/table-fixture-sql"
import { acmeIdentity, draftsAt, freshTable, nodeAt, tableRows } from "../factories/table-publish-sql"
import { loggedText } from "../helpers/logs"
import { connectDeps } from "../helpers/mcp"
import { DISCARD_DRAFT_VERSION, pendingMigrations, pendingReason } from "../helpers/pending-migrations"
import { ORG, PEOPLE, type Person } from "../helpers/reference-org"
import type { ReferenceOrgSql } from "../helpers/reference-org-sql"
import { portable, seedWithAdmin, spyDb, sqlConfigured, writesOf, type SeededData, type SpyOptions } from "../helpers/sql"

const NETWORK_TIMEOUT = 60_000
const SETUP_TIMEOUT = 180_000
const ORIGIN = "https://acme.test"
const NOTHING_SENT = "Nothing was sent. Show this to the user and ask for explicit approval, then call again with confirm: true."
const AGENT = { kind: "agent" as const, ctx: null }
const RESTORE = `A manager can restore it for 30 days from the Trash screen (${ORIGIN}/trash); after that it is erased.`
const CTX: Record<"lea" | "claire", string> = { lea: "LEAA-2202", claire: "CLAI-2202" }

/** `discard_draft` pas encore appliquée au projet : ses cas se sautent, la version nommée (`database-patterns.md § Règles`). */
const discardPending = (await pendingMigrations()).includes(DISCARD_DRAFT_VERSION)

describe.skipIf(!sqlConfigured)(portable("E11-S02: discard a draft, trash and delete rows through call"), { timeout: NETWORK_TIMEOUT }, () => {
  let seed: SeededData
  let ref: ReferenceOrgSql

  beforeAll(async () => {
    seed = seedWithAdmin()
    ref = await seedTableFixture(seed)
    await ref.write({
      ctx: (["lea", "claire"] as const).map((person) => ({ code: CTX[person], user_id: PEOPLE[person].id, org_id: ORG.id, rules_version: 1, host: null })),
    })
  }, SETUP_TIMEOUT)

  afterAll(async () => {
    await seed?.cleanup()
  }, SETUP_TIMEOUT)

  afterEach(() => {
    vi.restoreAllMocks()
  })

  /** Un `call` de la personne, requêtes espionnées ; son résultat ou son refus. */
  async function call(person: Person, input: CallInput, options: SpyOptions = {}) {
    const spied = spyDb(await ref.db(person), options)
    const deps = { db: spied.db, identity: acmeIdentity(ref, person), ctxCode: null, origin: ORIGIN, activeConnectors: async () => new Set<string>() }
    const outcome = await runCall(deps, input).then(
      (result) => ({ result, error: null }),
      (error: unknown) => ({ result: null, error }),
    )
    return { ...outcome, sent: spied.sent }
  }

  /** `write` d'un assistant de la personne, qui publie par défaut (E11-S02, AC-b1). */
  async function write(person: Person, input: Record<string, unknown>) {
    return writeNode(await ref.db(person), acmeIdentity(ref, person), input, AGENT)
  }

  const settle = <T>(promise: Promise<T>) =>
    promise.then(
      (result) => ({ result, error: null }),
      (error: unknown) => ({ result: null, error }),
    )

  /** L'identifiant réel d'un nœud de O créé par le service. */
  async function realId(path: string): Promise<string> {
    const [row] = await seed.admin<{ id: string }[]>`select id from platform.nodes where org_id = ${ref.org.id} and path = ${path}`
    if (!row) throw new Error(`${path} not found`)
    return row.id
  }

  /** Les blocs d'un nœud de O, par état, relus par la connexion d'administration. */
  async function blocksAt(path: string): Promise<{ state: string; text: string | null }[]> {
    return seed.admin<{ state: string; text: string | null }[]>`
      select b.state, b.text from platform.blocks b join platform.nodes n on n.id = b.node_id
       where n.org_id = ${ref.org.id} and n.path = ${path} order by b.state, b.position`
  }

  /**
   * Attend qu'une session attende le verrou consultatif 7401 du nœud (`pg_locks`, clés `classid`/`objid`) ;
   * au plus 10 s. Une attente sur une ligne ou une transaction ne compte pas.
   */
  async function lockWaitOn(nodeId: string): Promise<void> {
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline) {
      const [row] = await seed.admin<{ waiting: boolean }[]>`
        select exists (select 1 from pg_catalog.pg_locks
                        where locktype = 'advisory' and not granted and classid = 7401
                          and objid = (pg_catalog.hashtext(${nodeId}::text)::bigint & 4294967295)::oid) as waiting`
      if (row?.waiting) return
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    throw new Error(`discard_draft never waited for the lock 7401 of ${nodeId}`)
  }

  describe.skipIf(discardPending)(discardPending ? `node.discard_draft (${pendingReason([DISCARD_DRAFT_VERSION])})` : "node.discard_draft", () => {
    it("should summarize a page's draft without writing, then discard it whole, the published revision untouched (AC-d1, AC-d2)", async () => {
      const path = "ventes/faq_s02"
      await write("claire", { path, title: "FAQ", summary: "Les questions fréquentes.", ops: [{ op: "add_section", section: "Livraison", text: "Sous huit jours." }] })
      await write("lea", { path, base_revision: 1, title: "FAQ revue", ops: [{ op: "append", section: "Livraison", text: "Hors week-end." }], publish: false })

      const recap = await call("lea", { function: "node.discard_draft", arguments: { path } })
      const lines = recap.result?.text.split("\n") ?? []
      expect(lines[0]).toMatch(new RegExp(`^About to discard the draft of ${path} \\(page « FAQ »\\): opened on revision 1, last saved \\d{4}-\\d{2}-\\d{2}\\.$`))
      expect(lines.slice(1)).toEqual([
        "Pending title « FAQ revue ».",
        "Blocks: 1 added, 0 changed, 0 moved, 0 deleted.",
        "The published revision 1 stays as it is. This cannot be undone.",
        "",
        NOTHING_SENT,
      ])
      expect(recap.result?.data).toMatchObject({
        status: "needs_confirmation",
        summary: { path, kind: "page", revision: 1, base_revision: 1, pending: { title: "FAQ revue" }, blocks: { added: 1, changed: 0, moved: 0, deleted: 0 } },
      })
      expect(writesOf(recap.sent)).toEqual([])
      expect(recap.sent.filter((query) => query.target === "discard_draft")).toEqual([])

      const done = await call("lea", { function: "node.discard_draft", arguments: { path }, confirm: true })
      expect(done.result?.text).toBe(`Draft of ${path} discarded: ${path} is back to its published revision 1.`)
      expect(await draftsAt(seed, ref, path)).toEqual([])
      expect(await blocksAt(path)).toEqual([
        { state: "published", text: "Livraison" },
        { state: "published", text: "Sous huit jours." },
      ])
      expect(await nodeAt(seed, ref, path)).toMatchObject({ status: "published", revision: 1 })
      const read = await readNode(await ref.db("lea"), acmeIdentity(ref, "lea"), { path })
      expect(read.text).toContain("Sous huit jours.")
      expect(read.text).not.toContain("Hors week-end.")
    })

    it("should keep a refused header in the draft and say how to leave it, then discard it: the next header write starts from the published one (AC-d2, AC-d5)", async () => {
      await freshTable(seed, ref)
      const path = PROSPECTS.path
      await write("lea", { path, base_revision: 3, header: { columns: [{ name: "ville", type: "number" }] }, publish: false })
      const refused = await settle(write("lea", { path, base_revision: 3 }))
      expect(refused.error).toMatchObject({
        code: "conflict",
        details: { reason: "header_refused" },
        // E11-S18 (AC-1) : l'écriture refusée n'écrit rien ; le brouillon d'avant (`publish: false`) reste, et son renvoi.
        message: expect.stringContaining(`Nothing was written; the draft saved before this call stays. To go back to the published header, discard the draft: acme_call node.discard_draft {"path": "${path}"}.`),
      })

      const recap = await call("lea", { function: "node.discard_draft", arguments: { path } })
      expect(recap.result?.text.split("\n")[1]).toMatch(/^Pending header changes \(from revision 3\): /)
      const done = await call("lea", { function: "node.discard_draft", arguments: { path }, confirm: true })
      expect(done.result?.text).toBe(`Draft of ${path} discarded: ${path} is back to its published revision 3.`)
      expect(await draftsAt(seed, ref, path)).toEqual([])

      const next = await write("lea", { path, base_revision: 3, header: { columns: [{ name: "secteur", type: "text" }] } })
      expect(next.text).toBe(`Published ${path} revision 4: added secteur. Next write: base_revision 4.`)
    })

    it("should refuse, before any write, an unknown path, the read level, a node without draft and a node never published (AC-d3)", async () => {
      const unknown = await call("lea", { function: "node.discard_draft", arguments: { path: "ventes/inexistante" } })
      expect(unknown.error).toMatchObject({ code: "not_found", message: "Unknown path ventes/inexistante. Use acme_find to locate it." })

      const path = "ventes/lu_s02"
      await write("claire", { path, title: "Lu", summary: "Une page lue." })
      await write("claire", { path, base_revision: 1, title: "Lu revu", publish: false })
      // Un nœud créé par le service n'est pas semé : `ref.addRules` ne connaît que les chemins de la fixture.
      const [{ id: rule }] = await seed.admin<{ id: string }[]>`
        insert into platform.access_rules (org_id, node_id, subject_user_id, level)
        values (${ref.org.id}, ${await realId(path)}, ${ref.people.marc.id}, 'read') returning id`
      try {
        const reader = await call("marc", { function: "node.discard_draft", arguments: { path }, confirm: true })
        expect(reader.error).toMatchObject({ code: "forbidden", message: `Writing ${path} is reserved to team Ventes (lead: Claire Morel). Ask them for access.` })
        expect([writesOf(reader.sent), reader.sent.filter((query) => query.target === "discard_draft")]).toEqual([[], []])
      } finally {
        await seed.admin`delete from platform.access_rules where id = ${rule}`
      }

      const bare = "ventes/sans_brouillon_s02"
      await write("claire", { path: bare, title: "Nue", summary: "Sans brouillon." })
      const none = await call("lea", { function: "node.discard_draft", arguments: { path: bare }, confirm: true })
      expect(none.error).toMatchObject({ code: "invalid_arguments", message: `Nothing to discard: ${bare} has no pending draft.` })

      const fresh = "ventes/jamais_s02"
      await write("lea", { path: fresh, title: "Jamais", summary: "Jamais publiée.", publish: false })
      const never = await call("lea", { function: "node.discard_draft", arguments: { path: fresh }, confirm: true })
      expect(never.error).toMatchObject({
        code: "invalid_arguments",
        message: `${fresh} has never been published: discarding its draft would leave it empty. To remove it, call acme_call node.trash {"path": "${fresh}"} (manage level).`,
      })
      for (const outcome of [unknown, none, never]) expect(outcome.sent.filter((query) => query.target === "discard_draft")).toEqual([])
    })

    it("should refuse a draft saved between the reading of its stamp and the discard, logged first, and say nothing to discard after a publication (AC-d3, AC-d4)", async () => {
      const logged = vi.spyOn(console, "error").mockImplementation(() => undefined)
      const path = "ventes/course_s02"
      await write("claire", { path, title: "Course", summary: "Une course." })
      await write("lea", { path, base_revision: 1, title: "Course revue", publish: false })
      const node_id = await realId(path)
      const saved = await call("lea", { function: "node.discard_draft", arguments: { path }, confirm: true }, {
        before: async (query) => {
          if (query.target === "discard_draft") await seed.admin`update platform.node_drafts set title = 'Autre titre' where node_id = ${node_id}`
        },
      })
      expect(saved.error).toMatchObject({
        code: "stale_revision",
        message: `stale revision: ${path} changed while discarding (its draft was saved meanwhile). Nothing was discarded. Read it again with draft: true, then retry.`,
      })
      expect(loggedText(logged)).toContain(`[platform] nodes: draft of ${node_id} changed while discarding`)
      expect(await draftsAt(seed, ref, path)).toHaveLength(1)

      // Publié et validé entre la lecture du brouillon et l'appel de la fonction : elle ne trouve plus de brouillon (`55000`).
      const published = await call("lea", { function: "node.discard_draft", arguments: { path }, confirm: true }, {
        before: async (query) => {
          if (query.target === "discard_draft") await seed.admin`select platform.publish_node(${node_id}::uuid, 1)`
        },
      })
      expect(published.error).toMatchObject({ code: "invalid_arguments", message: `Nothing to discard: ${path} has no pending draft.` })
    })

    it("should wait for a draft write holding the shared lock 7401, then refuse the discard on the stamp that write moved, the written draft kept (AC-d4)", async () => {
      const logged = vi.spyOn(console, "error").mockImplementation(() => undefined)
      const path = "ventes/verrou_s02"
      await write("claire", { path, title: "Verrou", summary: "Une page verrouillée.", ops: [{ op: "add_section", section: "Délais", text: "Sous huit jours." }] })
      await write("lea", { path, base_revision: 1, title: "Verrou revu", publish: false })
      const node_id = await realId(path)
      const written = "Écrit pendant l'abandon."
      let release = () => {}
      const released = new Promise<void>((resolve) => (release = resolve))
      let hold = () => {}
      const holding = new Promise<void>((resolve) => (hold = resolve))
      // Ce que `blocks_lock_draft` fait pour l'écriture d'un bloc `draft` d'une personne (sur la connexion
      // d'administration, `auth.uid()` est nul et le déclencheur n'agit pas) : verrou partagé, puis tampon avancé.
      const writing = seed.admin.begin(async (tx) => {
        await tx`select pg_catalog.pg_advisory_xact_lock_shared(7401, pg_catalog.hashtext(${node_id}::text))`
        await tx`update platform.blocks set text = ${written} where node_id = ${node_id} and state = 'draft' and text = 'Sous huit jours.'`
        await tx`update platform.node_drafts set updated_at = now() where node_id = ${node_id}`
        hold()
        await released
      })
      await Promise.race([holding, writing])
      const discarding = call("lea", { function: "node.discard_draft", arguments: { path }, confirm: true })
      try {
        await lockWaitOn(node_id)
      } finally {
        release()
      }
      await writing
      const outcome = await discarding

      expect(outcome.error).toMatchObject({ code: "stale_revision", message: expect.stringContaining(`${path} changed while discarding`) })
      expect(loggedText(logged)).toContain(`[platform] nodes: draft of ${node_id} changed while discarding`)
      expect(await draftsAt(seed, ref, path)).toHaveLength(1)
      expect(await blocksAt(path)).toEqual([
        { state: "draft", text: "Délais" },
        { state: "draft", text: written },
        { state: "published", text: "Délais" },
        { state: "published", text: "Sous huit jours." },
      ])
    })
  })

  describe("node.trash", () => {
    it("should summarize a trashing without writing, then trash the node and what is under it (AC-e1, AC-e2)", async () => {
      await write("claire", { path: "ventes/essai_s02", title: "Essai", summary: "Une page d'essai." })
      await write("claire", { path: "ventes/essai_s02/sous_page", title: "Sous-page", summary: "Dessous." })
      const recap = await call("claire", { function: "node.trash", arguments: { path: "ventes/essai_s02" } })
      expect(recap.result?.text).toBe(
        ["About to move ventes/essai_s02 (page « Essai ») to the trash, with 1 page under it:", "- ventes/essai_s02/sous_page", RESTORE, "", NOTHING_SENT].join("\n"),
      )
      expect(writesOf(recap.sent)).toEqual([])

      const done = await call("claire", { function: "node.trash", arguments: { path: "ventes/essai_s02" }, confirm: true })
      expect(done.result?.text).toBe(`ventes/essai_s02 moved to the trash with 1 page under it. ${RESTORE}`)
      await expect(readNode(await ref.db("claire"), acmeIdentity(ref, "claire"), { path: "ventes/essai_s02" })).rejects.toMatchObject({ code: "not_found" })
    })

    it("should refuse a team folder, and a writer who does not manage the node, at both steps, before any write (AC-e3)", async () => {
      for (const confirm of [false, true]) {
        const folder = await call("claire", { function: "node.trash", arguments: { path: "ventes" }, confirm })
        expect(folder.error).toMatchObject({ code: "invalid_arguments", message: "ventes cannot be deleted: it is the folder of a team; delete the team, or the pages inside it." })
      }
      await write("claire", { path: "ventes/a_garder_s02", title: "À garder", summary: "Une page gardée." })
      for (const confirm of [false, true]) {
        const lea = await call("lea", { function: "node.trash", arguments: { path: "ventes/a_garder_s02" }, confirm })
        expect(lea.error).toMatchObject({ code: "forbidden", message: "Deleting ventes/a_garder_s02 is reserved to team Ventes (lead: Claire Morel). Ask them to delete it." })
        expect(writesOf(lea.sent)).toEqual([])
      }
    })
  })

  describe("table.delete_rows", () => {
    const REVIEW = "1 of these rows is waiting for review: Clinique des Saules. Deleting them removes them from the review queue."
    const CLAIMED = "Refused: Atelier 10 — claimed by Claire Morel (worker claude-claire) until 00:00 UTC; wait for its release or the end of the lease."

    it("should summarize the rows to delete for good, then delete them, a row to review signalled, a row claimed by someone else refused, an expired lease of someone else and an active lease of the caller not (AC-f2 à AC-f4)", async () => {
      await freshTable(seed, ref)
      // Les deux côtés de la garde (AC-f4) : Clinique des Saules sous un bail expiré de Claire, Scierie Vallon sous un bail actif de Léa.
      const table = ref.nodeId(PROSPECTS.path)
      await seed.admin`update platform.blocks set claimed_by = 'claude-claire', claimed_by_user = ${ref.people.claire.id}, lease_until = ${LEASE_EXPIRED}
                        where node_id = ${table} and state = 'published' and key = 'Clinique des Saules'`
      await seed.admin`update platform.blocks set lease_until = ${LEASE_ACTIVE} where node_id = ${table} and state = 'published' and key = 'Scierie Vallon'`
      const args = { table: PROSPECTS.path, keys: ["Clinique des Saules", "Scierie Vallon", "Atelier 10", "Inconnue SA"] }
      const recap = await call("lea", { function: "table.delete_rows", arguments: args })
      const lines = (recap.result?.text ?? "").split("\n").filter((line) => !line.startsWith("Team: "))
      expect(lines).toEqual([
        `About to delete 2 rows of ${PROSPECTS.path} for good:`,
        "- Clinique des Saules (contact: Rémi Barthe, email: remi@saules.test, ville: Saint-Arlan)",
        "- Scierie Vallon (contact: Denis Vallon, ville: Haute-Lise, montant_estime: 15000)",
        REVIEW,
        "Not found: Inconnue SA.",
        CLAIMED,
        "Their values and proofs cannot be restored. To empty cells instead, use table.write with clear.",
        "",
        NOTHING_SENT,
      ])
      expect(writesOf(recap.sent)).toEqual([])

      const done = await call("lea", { function: "table.delete_rows", arguments: args, confirm: true })
      expect(done.result?.text.split("\n")).toEqual([
        `Deleted 2 rows of ${PROSPECTS.path}: Clinique des Saules, Scierie Vallon.`,
        "1 of these rows was waiting for review.",
        "Not found: Inconnue SA.",
        CLAIMED,
      ])
      expect(done.result?.outcome).toEqual({ deleted: 2, review: 1 })
      expect(done.result?.data).toMatchObject({ result: { deleted: ["Clinique des Saules", "Scierie Vallon"], review: ["Clinique des Saules"], not_found: ["Inconnue SA"] } })
      const keys = (await tableRows(seed, ref)).map((row) => row.key)
      expect(keys).not.toContain("Clinique des Saules")
      expect(keys).not.toContain("Scierie Vallon")
      expect(keys).toContain("Atelier 10")
    })

    it("should delete the rows of a closed table as of an open one (AC-f5)", async () => {
      await freshTable(seed, ref)
      await seed.admin`update platform.nodes set meta = meta || '{"closed": true}'::jsonb where id = ${ref.nodeId(PROSPECTS.path)}`
      const args = { table: PROSPECTS.path, keys: ["Ferme du Coudray"] }
      expect((await call("lea", { function: "table.delete_rows", arguments: args })).result?.text).toContain(`About to delete 1 row of ${PROSPECTS.path} for good:`)
      expect((await call("lea", { function: "table.delete_rows", arguments: args, confirm: true })).result?.text).toBe(`Deleted 1 row of ${PROSPECTS.path}: Ferme du Coudray.`)
    })

    it("should refuse a row changed between its reading and its deletion, logged first, deleting nothing for it (AC-f4)", async () => {
      const logged = vi.spyOn(console, "error").mockImplementation(() => undefined)
      await freshTable(seed, ref)
      const table = ref.nodeId(PROSPECTS.path)
      const done = await call("lea", { function: "table.delete_rows", arguments: { table: PROSPECTS.path, keys: ["Garage des Tilleuls"] }, confirm: true }, {
        before: async (query) => {
          if (query.op === "delete" && query.target === "blocks") {
            await seed.admin`update platform.blocks set revision = revision + 1 where node_id = ${table} and key = 'Garage des Tilleuls' and state = 'published'`
          }
        },
      })
      expect(done.result?.text.split("\n")).toEqual([`Deleted 0 rows of ${PROSPECTS.path}.`, "Refused: Garage des Tilleuls — changed meanwhile; read it again."])
      expect(done.result?.outcome).toEqual({ deleted: 0, review: 0 })
      expect(loggedText(logged)).toContain(`[platform] tables: delete_rows row changed before its delete ${table}#Garage des Tilleuls`)
      expect((await tableRows(seed, ref)).map((row) => row.key)).toContain("Garage des Tilleuls")
    })

    it("should refuse an unknown table and a reader, before reading any row (AC-f6)", async () => {
      await freshTable(seed, ref)
      const unknown = await call("lea", { function: "table.delete_rows", arguments: { table: "ventes/inconnue", keys: ["x"] } })
      expect(unknown.error).toMatchObject({ code: "not_found" })
      const [rule] = await ref.addRules([{ node: PROSPECTS.path, user: "marc", level: "read" }])
      try {
        const reader = await call("marc", { function: "table.delete_rows", arguments: { table: PROSPECTS.path, keys: ["Atelier 2"] }, confirm: true })
        expect(reader.error).toMatchObject({ code: "forbidden", message: `Writing ${PROSPECTS.path} is reserved to team Ventes (lead: Claire Morel). Ask them for access.` })
        expect(writesOf(reader.sent)).toEqual([])
      } finally {
        await seed.admin`delete from platform.access_rules where id = ${rule}`
      }
    })
  })

  describe("through MCP: the functions that delete, in two steps", () => {
    /** Une session MCP de la personne sur la fixture, avec son code `ctx` semé. */
    async function session(person: "lea" | "claire") {
      const identity = acmeIdentity(ref, person as Person)
      const connected = await connectDeps({
        db: await ref.db(person),
        org: identity.org,
        caller: { kind: "member", identity },
        userAgent: "unit-test",
        journal: [],
        activeConnectors: () => Promise.resolve(new Set<string>()),
        origin: "https://acme.test",
      })
      const ctx = ref.id(CTX[person])
      return { ...connected, tool: (name: string, args: Record<string, unknown>) => connected.call(name, { ctx, ...args }) }
    }

    it("should find the three functions by their words and serve their contract as sensitive, in two steps (AC-h1)", async () => {
      const lea = await session("lea")
      for (const [query, name] of [
        ["delete rows", "table.delete_rows"],
        ["trash", "node.trash"],
        ["discard draft", "node.discard_draft"],
      ]) {
        const found = await lea.tool("find", { query, type: "function" })
        expect(found.text, query).toContain(name)
      }
      for (const [name, connector] of [
        ["node.discard_draft", "node"],
        ["node.trash", "node"],
        ["table.delete_rows", "table"],
      ]) {
        const contract = await lea.tool("read", { path: name })
        expect(contract.text.split("\n")[0]).toBe(`Function ${name} (connector ${connector}, origin paquet, class sensitive: two-step confirmation)`)
        expect(contract.result.structuredContent).toMatchObject({ text: contract.text, function: name, class: "sensitive" })
      }
    })

    it("should answer a summary then the deletion, the same text in both channels, the journal line of the execution carrying _outcome (AC-h2, HN-E11S02-16)", async () => {
      await freshTable(seed, ref)
      const lea = await session("lea")
      const args = { function: "table.delete_rows", arguments: { table: PROSPECTS.path, keys: ["Clinique des Saules", "Pharmacie du Port"] } }
      const recap = await lea.tool("call", args)
      expect(recap.isError).toBe(false)
      expect(recap.text.split("\n")[0]).toBe(`About to delete 2 rows of ${PROSPECTS.path} for good:`)
      expect(recap.text.endsWith(NOTHING_SENT)).toBe(true)
      expect(recap.result.structuredContent).toMatchObject({ text: recap.text, status: "needs_confirmation", next_actions: [] })

      const done = await lea.tool("call", { ...args, confirm: true })
      expect(done.text.split("\n")).toEqual([`Deleted 2 rows of ${PROSPECTS.path}: Clinique des Saules, Pharmacie du Port.`, "1 of these rows was waiting for review."])
      expect(done.result.structuredContent).toMatchObject({ text: done.text, result: { deleted: ["Clinique des Saules", "Pharmacie du Port"], review: ["Clinique des Saules"] } })
      // La suite proposée : une lecture, jamais une fonction sensible (H87).
      expect(done.result.structuredContent).toMatchObject({ next_actions: ["table.rows"] })

      const calls = lea.journal.filter((entry) => entry.tool === "acme_call")
      expect(calls.map((entry) => [entry.target, entry.is_error === true])).toEqual([
        ["table.delete_rows", false],
        ["table.delete_rows", false],
      ])
      expect(calls[0].args).not.toHaveProperty("_outcome")
      expect(calls[1].args).toMatchObject({ confirm: true, _outcome: { deleted: 2, review: 1 } })
    })

    it("should publish a write of an assistant by default, and keep a draft with publish: false (AC-b1)", async () => {
      const claire = await session("claire")
      const created = await claire.tool("write", { path: "ventes/faq_mcp_s02", title: "FAQ", summary: "Questions fréquentes.", ops: [{ op: "add_section", section: "Livraison", text: "Sous huit jours." }] })
      // E11-S18 (AC-4) : une ligne, la publication et ce que l'écriture a fait.
      expect(created.text).toBe("Published ventes/faq_mcp_s02 revision 1 (1 section, 2 blocks): added « Livraison » (30 characters). Next write: base_revision 1.")
      const drafted = await claire.tool("write", { path: "ventes/faq_mcp_s02", base_revision: 1, ops: [{ op: "append", section: "Livraison", text: "Hors week-end." }], publish: false })
      expect(drafted.text.split("\n")[1]).toBe('Publish it with acme_write {"path": "ventes/faq_mcp_s02", "base_revision": 1, "publish": true}.')
      expect(drafted.result.structuredContent).toMatchObject({ status: "published", revision: 1, has_draft: true })
    })
  })
})
