// @vitest-environment node
// L'espace d'un nœud écrit sur lui (`droits-d-acces.md` § Propriétaires, déplacements, personnel ; décidé avec JB le
// 03/11, migration 20261119090000) sur une vraie base : une écriture d'assistant qui ne nomme aucun espace partagé tombe
// dans le Privé de son auteur, et sa réponse le dit ; `space: "everyone"` crée dans Tout le monde ; un dossier d'équipe
// ou un Privé nomme son espace ; sous une session, la base n'admet que l'espace du parent ou le Privé de l'auteur ; un
// déplacement ou une copie ne partagent rien. Les autres portes de création (`node.import_tree`, `table.import`, le dépôt
// par lien) suivent la même règle ; `space` sur un nœud existant d'un autre espace est refusé. Portable : O de
// `seedReferenceOrg`, sessions `asCaller`.
import { strToU8, zipSync } from "fflate"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { nodeLevel } from "../../packages/plateforme/server/access"
import { duplicateNode } from "../../packages/plateforme/server/nodes/duplicate"
import { moveNode } from "../../packages/plateforme/server/nodes/move"
import { writeNode, type WriteOrigin } from "../../packages/plateforme/server/nodes/write"
import { tableImport } from "../../packages/plateforme/server/tables/import"
import { importPlan } from "../../packages/plateforme/server/transfer/formats"
import { runImport } from "../../packages/plateforme/server/transfer/import"
import { writeUpload, type UploadTicket } from "../../packages/plateforme/server/uploads-write"
import type { Person } from "../helpers/reference-org"
import { seedReferenceOrg, type ReferenceOrgSql } from "../helpers/reference-org-sql"
import { asCaller, seedWithAdmin, SQL_SKIP_REASON, sqlConfigured, type SeededData } from "../helpers/sql"

const SETUP_TIMEOUT = 180_000
const NETWORK_TIMEOUT = 60_000
const SUITE = "the space written on a node at its creation (20261119090000)"
const AGENT: WriteOrigin = { kind: "agent", ctx: null }

describe.skipIf(!sqlConfigured)(sqlConfigured ? SUITE : `${SUITE} (${SQL_SKIP_REASON})`, { timeout: NETWORK_TIMEOUT }, () => {
  let seed: SeededData
  let ref: ReferenceOrgSql

  beforeAll(async () => {
    seed = seedWithAdmin()
    ref = await seedReferenceOrg(seed)
  }, SETUP_TIMEOUT)

  afterAll(async () => {
    await seed?.cleanup()
  }, SETUP_TIMEOUT)

  const dbOf = (person: Person) => asCaller(ref.people[person].id, ref.people[person].email)
  const write = (person: Person, input: Record<string, unknown>, origin: WriteOrigin = AGENT) => writeNode(dbOf(person), ref.identityOf(person), input, origin)
  const context = (person: Person) => ({ db: dbOf(person), identity: ref.identityOf(person), ctx: null, origin: "https://acme.test" })
  const page = (path: string, extra: Record<string, unknown> = {}) => ({ path, title: "Page", summary: "Une page.", ...extra })

  async function ownerAt(path: string) {
    const [row] = await seed.admin<{ id: string; owner_kind: string; owner_team_id: string | null; owner_user_id: string | null }[]>`
      select id, owner_kind, owner_team_id, owner_user_id from platform.nodes where org_id = ${ref.org.id} and path = ${path}`
    return row
  }

  /** Le niveau du service et celui de la base (`node_level_for`), sous la même session : égaux. */
  async function levels(person: Person, id: string): Promise<[number, number]> {
    const service = await nodeLevel(dbOf(person), ref.identityOf(person), id)
    const [base] = await dbOf(person).tx((sql) => sql<{ level: number }[]>`
      select platform.node_level_for(n.org_id, n.lpath, n.owner_kind, n.owner_team_id, n.owner_user_id) as level from platform.nodes n where n.id = ${id}`)
    return [service, base?.level ?? -1]
  }

  it("should write an owner on every node, the seeded ones taking their parent's", async () => {
    const [row] = await seed.admin<{ missing: number }[]>`select count(*)::int as missing from platform.nodes where org_id = ${ref.org.id} and owner_kind is null`
    expect(row?.missing).toBe(0)
    expect(await ownerAt("ventes/devis")).toMatchObject({ owner_kind: "team", owner_team_id: ref.id("team-ventes") })
    expect(await ownerAt("annonces")).toMatchObject({ owner_kind: "org" })
  })

  it("should put a content an assistant writes in the shared space without naming it in the author's private space, and say so", async () => {
    const output = await write("ada", page("annonces/cr_associes"))
    expect(await ownerAt("annonces/cr_associes")).toMatchObject({ owner_kind: "user", owner_user_id: ref.people.ada.id })
    expect(output.text.split("\n").at(-1)).toBe('Space: your private space: only you see it. No space was named: to create a content for everyone, write it with space "everyone".')
    expect(output.data).toMatchObject({ space: "private" })
    const id = (await ownerAt("annonces/cr_associes"))!.id
    expect([await levels("ada", id), await levels("claire", id)]).toEqual([
      [3, 3],
      [0, 0],
    ])
  })

  it("should create in the shared space when the write names it, and from the screen's gesture", async () => {
    const named = await write("ada", page("annonces/note_publique", { space: "everyone" }))
    expect(named.text.split("\n").at(-1)).toMatch(/^Space: everyone \(organisation .+\): every member can read it\.$/)
    await write("ada", page("annonces/depuis_l_ecran"), { kind: "human" })
    for (const path of ["annonces/note_publique", "annonces/depuis_l_ecran"]) expect(await ownerAt(path)).toMatchObject({ owner_kind: "org" })
    expect(await levels("claire", (await ownerAt("annonces/note_publique"))!.id)).toEqual([1, 1])
  })

  it("should keep a content in the space of its team or private folder, and refuse everyone there", async () => {
    const team = await write("lea", page("ventes/devis/brouillon"))
    expect(await ownerAt("ventes/devis/brouillon")).toMatchObject({ owner_kind: "team", owner_team_id: ref.id("team-ventes") })
    expect(team.data).toMatchObject({ space: "team" })
    await write("lea", page("private/lea/idee"))
    expect(await ownerAt("private/lea/idee")).toMatchObject({ owner_kind: "user", owner_user_id: ref.people.lea.id })
    await write("lea", page("ventes/devis/a_moi", { space: "private" }))
    expect(await ownerAt("ventes/devis/a_moi")).toMatchObject({ owner_kind: "user", owner_user_id: ref.people.lea.id })
    await expect(write("lea", page("ventes/devis/pour_tous", { space: "everyone" }))).rejects.toMatchObject({ code: "invalid_arguments" })
    expect(await ownerAt("ventes/devis/pour_tous")).toBeUndefined()
  })

  it("should let a session create only in its parent's space or its own private space (42501)", async () => {
    const parent = ref.nodeId("ventes")
    const insert = (path: string, owner: string | null) =>
      dbOf("lea").tx((sql) => sql`
        insert into platform.nodes (org_id, parent_id, path, title, summary, created_by, updated_by, owner_kind, owner_user_id)
        values (${ref.org.id}, ${parent}, ${path}, 'T', 'S.', ${ref.people.lea.id}, ${ref.people.lea.id}, ${owner ? "user" : null}, ${owner})`)
    await expect(insert("ventes/pour_claire", ref.people.claire.id)).rejects.toMatchObject({ code: "42501" })
    await insert("ventes/pour_moi", ref.people.lea.id)
    await insert("ventes/herite", null)
    expect(await ownerAt("ventes/pour_moi")).toMatchObject({ owner_kind: "user", owner_user_id: ref.people.lea.id })
    expect(await ownerAt("ventes/herite")).toMatchObject({ owner_kind: "team", owner_team_id: ref.id("team-ventes") })
  })

  it("should neither share a private content by moving it under a shared folder, even one opened to all, nor by copying it", async () => {
    await write("ada", page("annonces/a_ranger"))
    // Tout `annonces` ouvert en écriture à toute l'organisation : une règle au-dessus d'un contenu Privé n'y compte pas.
    await seed.admin`insert into platform.access_rules (org_id, node_id, subject_org, level) values (${ref.org.id}, ${ref.nodeId("annonces")}, true, 'write')`
    const moved = await moveNode(dbOf("ada"), ref.identityOf("ada"), { path: "annonces/a_ranger", new_path: "a_ranger" })
    expect(moved.target).toBe("a_ranger")
    const copy = await duplicateNode(dbOf("ada"), ref.identityOf("ada"), { path: "annonces/cr_associes" })
    for (const path of ["a_ranger", copy.data.path]) {
      expect(await ownerAt(path)).toMatchObject({ owner_kind: "user", owner_user_id: ref.people.ada.id })
      expect(await levels("claire", (await ownerAt(path))!.id)).toEqual([0, 0])
    }
    expect(await levels("claire", (await ownerAt("annonces/note_publique"))!.id)).toEqual([2, 2])
  })

  it("should put the top nodes node.import_tree creates under the shared space in the author's private space, their children with them", async () => {
    const zip = zipSync({ "Base/Fiches.md": strToU8("# Fiches\n\nLes fiches."), "Base/Fiches/Garantie.md": strToU8("# Garantie\n\nDeux ans.") })
    const plan = importPlan("zip", zip, "base.zip")
    const args = { source_url: "https://exemple.test/base.zip", parent: "annonces", source: "base.zip" }
    const done = await runImport(context("ada") as never, plan, args as never)
    expect(done.roots).toEqual(["annonces/base"])
    for (const path of ["annonces/base", "annonces/base/fiches", "annonces/base/fiches/garantie"]) {
      expect(await ownerAt(path)).toMatchObject({ owner_kind: "user", owner_user_id: ref.people.ada.id })
    }
    expect(await levels("claire", (await ownerAt("annonces/base"))!.id)).toEqual([0, 0])
  })

  it("should put a table table.import creates under the shared space in the author's private space", async () => {
    const args = { table: "annonces/clients", csv: "Nom;Ville\nAtelier;Valbrune", create: { title: "Clients", summary: "Les clients." } }
    await tableImport.run(context("ada") as never, args as never)
    expect(await ownerAt("annonces/clients")).toMatchObject({ owner_kind: "user", owner_user_id: ref.people.ada.id })
    expect(await levels("claire", (await ownerAt("annonces/clients"))!.id)).toEqual([0, 0])
  })

  it("should put a page an upload link creates under the shared space in the author's private space", async () => {
    const ticket: UploadTicket = {
      userId: ref.people.ada.id,
      email: ref.people.ada.email,
      ctx: null,
      kind: "md",
      mode: "create",
      path: "annonces/depose",
      name: "depose.md",
      title: "Déposé",
      summary: "Une page déposée.",
      key: null,
      baseRevision: null,
      publish: null,
    }
    await writeUpload(dbOf("ada"), ref.identityOf("ada"), ticket, { bytes: strToU8("# Déposé\n\nUn texte."), origin: "https://acme.test" })
    expect(await ownerAt("annonces/depose")).toMatchObject({ owner_kind: "user", owner_user_id: ref.people.ada.id })
  })

  it("should refuse a content without a space to an author with no private space, writing nothing", async () => {
    const identity = ref.identityOf("ada")
    const handleless = { ...identity, member: { ...identity.member, profile: { ...identity.member.profile, handle: undefined } } }
    await expect(writeNode(dbOf("ada"), handleless, page("annonces/sans_espace"), AGENT)).rejects.toMatchObject({
      code: "invalid_arguments",
      message: expect.stringMatching(/^You have no private space in .+, where a content written without a space goes: pass space "everyone"/),
    })
    expect(await ownerAt("annonces/sans_espace")).toBeUndefined()
    // Nommer Tout le monde reste possible sans Privé.
    await writeNode(dbOf("ada"), handleless, page("annonces/pour_tous", { space: "everyone" }), AGENT)
    expect(await ownerAt("annonces/pour_tous")).toMatchObject({ owner_kind: "org" })
  })

  it("should refuse space on an existing node of another space, writing nothing", async () => {
    const revisionAt = async (path: string) => {
      const [row] = await seed.admin<{ revision: number; title: string }[]>`
        select revision, title from platform.nodes where org_id = ${ref.org.id} and path = ${path}`
      return row
    }
    const cases: [Person, string, "everyone" | "private"][] = [
      ["ada", "annonces/note_publique", "private"],
      ["lea", "ventes/devis/brouillon", "private"],
      ["lea", "ventes/devis/brouillon", "everyone"],
      ["lea", "private/lea/idee", "everyone"],
    ]
    for (const [person, path, space] of cases) {
      const before = await revisionAt(path)
      const refused = write(person, { path, base_revision: before?.revision, title: "Renommée", space })
      await expect(refused).rejects.toMatchObject({ code: "invalid_arguments", message: expect.stringContaining(`${path} already exists, in another space`) })
      expect(await revisionAt(path)).toEqual(before)
    }
  })

  it("should give the same level in the service and in the database on a private content under a shared folder", async () => {
    // Le Privé de Léa sous le dossier de l'équipe Ventes : Claire, responsable de l'équipe, ne le voit pas plus que Marc.
    const team = (await ownerAt("ventes/devis/a_moi"))!.id
    expect([await levels("lea", team), await levels("claire", team), await levels("marc", team)]).toEqual([
      [3, 3],
      [0, 0],
      [0, 0],
    ])
    // Le Privé d'Ada sous `annonces`, ouvert en écriture à toute l'organisation par le cas précédent.
    const open = (await ownerAt("annonces/cr_associes"))!.id
    expect([await levels("ada", open), await levels("claire", open), await levels("marc", open)]).toEqual([
      [3, 3],
      [0, 0],
      [0, 0],
    ])
  })
})
