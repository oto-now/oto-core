// @vitest-environment node
// Le niveau exigé par les fonctions `security definer` qu'une session exécute (migration `20261021100000`, décision
// d'Alexis du 20/10 ; suite de `role-dans-les-noeuds.test.ts`) : avec son seul jeton, en SQL direct, un membre simple
// n'ouvre, ne publie ni n'abandonne le brouillon d'une page qu'il ne fait que lire, n'abandonne pas celui d'une page
// jamais publiée, et ne duplique ni une page qui lui est cachée, ni des descendants cachés, ni une page sous un parent
// qu'il ne fait que lire : la copie, qui hérite de son parent, lui rendrait lisible ce qui lui était caché. Sous sa
// session comme sous celle du serveur, qui juge la même personne. Une page cachée reçoit le même refus qu'une page
// absente. L'ayant droit du service passe, création comprise (`insertNode` puis `open_draft` dans une transaction), et
// la donnée est relue par la connexion d'administration.
import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { pendingMigrations, pendingReason } from "../helpers/pending-migrations"
import { asCaller, failureOf, seedWithAdmin, SQL_SKIP_REASON, sqlConfigured, type SeededData, type SeededOrg, type SeededPerson } from "../helpers/sql"
import type { Tx } from "../../packages/plateforme/server/sql"

const VERSION = "20261021100000"
const pending = (await pendingMigrations()).includes(VERSION)

const suite = !sqlConfigured
  ? `the level required by the security definer functions (${SQL_SKIP_REASON})`
  : pending
    ? `the level required by the security definer functions (${pendingReason([VERSION])})`
    : "the level required by the security definer functions: a plain member is refused, whoever the service lets in passes"

/** Les deux sessions d'une personne : la sienne, et celle du serveur, aux mêmes claims. */
const SESSIONS = [undefined, "server"] as const

const tag = () => Math.random().toString(16).slice(2, 8)

type Place = { id: string; path: string }
type NodeSeed = { owner?: { kind: "org" | "team" | "user"; id: string }; revision?: number; draft?: boolean; text?: string }

describe.skipIf(!sqlConfigured || pending)(suite, () => {
  let seed: SeededData
  let org: SeededOrg
  /** Administratrice de O. */
  let ada: SeededPerson
  /** Membre simple de O, hors de l'équipe `led`. */
  let lea: SeededPerson
  /** Membre simple de O, membre de l'équipe `led` : il écrit ses pages. */
  let marc: SeededPerson
  let led: string
  let root: Place

  /**
   * Le résultat d'un appel sous la session de `who` (la sienne, ou celle du serveur) : le nombre de lignes rendues, ou
   * le code et le message de l'erreur.
   */
  async function attempt(who: SeededPerson, query: (sql: Tx) => PromiseLike<readonly unknown[]>, session?: "server"): Promise<number | string> {
    let rows = 0
    const failure = await failureOf(asCaller(who.id, who.email).tx(async (sql) => (rows = (await query(sql)).length), session))
    return failure ? `${failure.code} ${failure.message}` : rows
  }

  /**
   * Un nœud sous `parent` : propriétaire hérité sans `owner`, auteur Ada, publié (révision 1) sauf `revision`, un bloc
   * publié de texte `text`, et un brouillon ouvert sur sa révision avec `draft`.
   */
  async function node(parent: Place, options: NodeSeed = {}): Promise<Place> {
    const segment = `p${tag()}`
    const path = parent.id === root.id ? segment : `${parent.path}/${segment}`
    const { owner, revision = 1 } = options
    const [row] = await seed.admin<Place[]>`
      insert into platform.nodes (org_id, parent_id, path, title, summary, status, revision, owner_kind, owner_team_id, owner_user_id, created_by)
      values (${org.id}, ${parent.id}, ${path}, 'Page', 'Une page.', ${revision > 0 ? "published" : "draft"}, ${revision},
              ${owner?.kind ?? null}, ${owner?.kind === "team" ? owner.id : null}, ${owner?.kind === "user" ? owner.id : null}, ${ada.id})
      returning id, path`
    if (options.text !== undefined) {
      await seed.admin`
        insert into platform.blocks (state, org_id, node_id, position, type, text, created_by)
        values ('published', ${org.id}, ${row.id}, 1, 'paragraph', ${options.text}, ${ada.id})`
    }
    if (options.draft) await seed.admin`insert into platform.node_drafts (node_id, base_revision, created_by) values (${row.id}, ${revision}, ${ada.id})`
    return row
  }

  /** Une page de l'organisation sous la racine : tout membre la lit (1), Ada la gère (3). */
  const orgPage = (options: NodeSeed = {}) => node(root, options)
  /** Une page de l'équipe `led` sous la racine : Marc l'écrit (2), Léa ne la voit pas (0). */
  const teamPage = (options: NodeSeed = {}) => node(root, { ...options, owner: { kind: "team", id: led } })

  const openDraft = (id: string) => (sql: Tx) => sql`select base_revision, created from platform.open_draft(${id})`
  /** La surcharge au tampon, celle qu'appelle `publishNode` (`server/nodes/publish.ts`). */
  const publish = (id: string) => (sql: Tx) => sql`select platform.publish_node(p_node => ${id}, p_base_revision => 1, p_draft_stamp => null::timestamptz) as revision`
  /** La surcharge sans tampon, qui appelle la première. */
  const publishWithoutStamp = (id: string) => (sql: Tx) => sql`select platform.publish_node(${id}, 1, null::jsonb) as revision`
  const discard = (id: string) => (sql: Tx) => sql`select platform.discard_draft(${id}, null::timestamptz) as revision`
  const duplicate = (source: string, nodes: string[], segment: string) => (sql: Tx) =>
    sql`select copy_id, copy_path from platform.duplicate_subtree(p_source => ${source}, p_nodes => ${nodes}::uuid[], p_segment => ${segment}, p_title => 'Copie', p_position => 99)`

  /** Le brouillon d'un nœud, relu par la connexion d'administration. */
  const draftOf = async (id: string) => (await seed.admin`select 1 from platform.node_drafts where node_id = ${id}`).length
  /** Les nœuds d'un chemin et de ce qui est dessous, relus par la connexion d'administration. */
  const nodesAt = async (path: string) => (await seed.admin`select 1 from platform.nodes where org_id = ${org.id} and (path = ${path} or starts_with(path, ${`${path}/`}))`).length

  beforeAll(async () => {
    seed = seedWithAdmin()
    org = await seed.createOrg()
    ;[ada, lea, marc] = [seed.person(), seed.person(), seed.person()]
    await seed.addMember(org.id, ada, "admin")
    for (const person of [lea, marc]) await seed.addMember(org.id, person)
    const [team] = await seed.admin<{ id: string }[]>`
      insert into platform.teams (org_id, slug, name) values (${org.id}, ${`e${tag()}`}, ${`Équipe ${tag()}`}) returning id`
    led = team.id
    await seed.admin`insert into platform.team_members (team_id, user_id, role) values (${led}, ${marc.id}, 'member')`
    const [row] = await seed.admin<Place[]>`
      insert into platform.nodes (org_id, parent_id, path, title, summary, owner_kind)
      values (${org.id}, null, 'guide', 'Guide', 'Racine.', 'org') returning id, path`
    root = row
  })

  afterAll(async () => {
    await seed?.cleanup()
  })

  it.each(SESSIONS)("should refuse opening the draft of a page she only reads or cannot see, as for an absent page, and let whoever writes it (session %s)", async (session) => {
    const [read, hidden, written] = [await orgPage(), await teamPage(), await teamPage()]
    const absent = await attempt(lea, openDraft(randomUUID()), session)
    expect(absent).toMatch(/^42501 /)
    expect(await attempt(lea, openDraft(read.id), session)).toBe(absent)
    expect(await attempt(lea, openDraft(hidden.id), session)).toBe(absent)
    expect([await draftOf(read.id), await draftOf(hidden.id)]).toEqual([0, 0])
    expect(await attempt(marc, openDraft(written.id), session)).toBe(1)
    expect(await draftOf(written.id)).toBe(1)
  })

  // `create` (`server/nodes/write.ts`) : `insertNode` puis `openDraft` dans une transaction ; le nœud neuf, sans
  // propriétaire, hérite du niveau de son parent.
  it.each(SESSIONS)("should let whoever writes a parent create a page under it and open its draft in the same transaction (session %s)", async (session) => {
    const folder = await teamPage()
    const path = `${folder.path}/n${tag()}`
    const create = (sql: Tx) => sql`
      with made as (
        insert into platform.nodes (org_id, parent_id, path, title, summary, status, revision, created_by)
        values (${org.id}, ${folder.id}, ${path}, 'Neuve', 'Une page neuve.', 'draft', 0, ${marc.id}) returning id)
      select id from made`
    let created = ""
    const failure = await failureOf(
      asCaller(marc.id, marc.email).tx(async (sql) => {
        const [made] = await create(sql)
        created = String(made.id)
        await sql`select base_revision, created from platform.open_draft(${created})`
      }, session),
    )
    expect(failure).toBeNull()
    expect(await draftOf(created)).toBe(1)
  })

  it.each(SESSIONS)("should refuse publishing the draft of a page she only reads or cannot see, by either overload, and let whoever writes it (session %s)", async (session) => {
    const [read, hidden, written, other] = [await orgPage({ draft: true }), await teamPage({ draft: true }), await teamPage({ draft: true }), await teamPage({ draft: true })]
    const absent = await attempt(lea, publish(randomUUID()), session)
    expect(absent).toMatch(/^42501 /)
    expect(await attempt(lea, publish(read.id), session)).toBe(absent)
    expect(await attempt(lea, publish(hidden.id), session)).toBe(absent)
    expect(await attempt(lea, publishWithoutStamp(read.id), session)).toBe(absent)
    expect(await attempt(lea, publishWithoutStamp(hidden.id), session)).toBe(absent)
    expect(await seed.admin`select revision from platform.nodes where id in ${seed.admin([read.id, hidden.id])}`).toEqual([{ revision: 1 }, { revision: 1 }])
    expect([await draftOf(read.id), await draftOf(hidden.id)]).toEqual([1, 1])
    expect(await attempt(marc, publish(written.id), session)).toBe(1)
    expect(await attempt(marc, publishWithoutStamp(other.id), session)).toBe(1)
    expect(await seed.admin`select revision from platform.nodes where id in ${seed.admin([written.id, other.id])}`).toEqual([{ revision: 2 }, { revision: 2 }])
    expect([await draftOf(written.id), await draftOf(other.id)]).toEqual([0, 0])
  })

  it.each(SESSIONS)("should refuse discarding the draft of a page she only reads or cannot see, or never published, and let whoever writes a published page (session %s)", async (session) => {
    const [read, hidden, written, unpublished] = [
      await orgPage({ draft: true }),
      await teamPage({ draft: true }),
      await teamPage({ draft: true }),
      await teamPage({ draft: true, revision: 0 }),
    ]
    const absent = await attempt(lea, discard(randomUUID()), session)
    expect(absent).toMatch(/^42501 /)
    expect(await attempt(lea, discard(read.id), session)).toBe(absent)
    expect(await attempt(lea, discard(hidden.id), session)).toBe(absent)
    // `discardPlan` (`server/nodes/discard.ts`) : une page jamais publiée n'a pas de révision à laquelle revenir.
    expect(await attempt(marc, discard(unpublished.id), session)).toMatch(/^42501 .*never been published/)
    expect([await draftOf(read.id), await draftOf(hidden.id), await draftOf(unpublished.id)]).toEqual([1, 1, 1])
    expect(await attempt(marc, discard(written.id), session)).toBe(1)
    expect(await draftOf(written.id)).toBe(0)
  })

  // La fuite : la copie ne reprend ni le propriétaire ni les règles, elle hérite de son parent.
  it.each(SESSIONS)("should refuse duplicating a page she cannot see under a folder she reads, as for an absent page, and let an administrator (session %s)", async (session) => {
    const folder = await orgPage()
    const hidden = await node(folder, { owner: { kind: "team", id: led }, text: "Secret de l'équipe." })
    const under = await node(hidden, { text: "Secret dessous." })
    const segment = `c${tag()}`
    const absent = await attempt(lea, duplicate(randomUUID(), [], segment), session)
    expect(absent).toMatch(/^P0002 /)
    expect(await attempt(lea, duplicate(hidden.id, [under.id], segment), session)).toBe(absent)
    // Léa relit ce que la copie lui aurait rendu lisible.
    const leaked = (sql: Tx) =>
      sql`select b.text from platform.blocks b join platform.nodes n on n.id = b.node_id
           where n.org_id = ${org.id} and starts_with(n.path, ${`${folder.path}/${segment}`})`
    expect(await attempt(lea, leaked, session)).toBe(0)
    expect(await nodesAt(`${folder.path}/${segment}`)).toBe(0)
    expect(await attempt(ada, duplicate(hidden.id, [under.id], segment), session)).toBe(2)
    expect(await nodesAt(`${folder.path}/${segment}`)).toBe(2)
  })

  it.each(SESSIONS)("should refuse copying descendants she cannot see under a page she writes, as for an absent node, and let her copy those she reads (session %s)", async (session) => {
    const folder = await teamPage()
    const page = await node(folder)
    // Sous la page de l'équipe : une sous-page qu'Ada garde pour elle (Marc ne la voit pas), une qu'il lit.
    const hidden = await node(page, { owner: { kind: "user", id: ada.id }, text: "Note d'Ada." })
    const readable = await node(page, { owner: { kind: "org", id: org.id } })
    const segment = `c${tag()}`
    const absent = await attempt(marc, duplicate(page.id, [randomUUID()], segment), session)
    expect(absent).toMatch(/^22023 /)
    expect(await attempt(marc, duplicate(page.id, [hidden.id], segment), session)).toBe(absent)
    expect(await attempt(marc, duplicate(page.id, [readable.id, hidden.id], segment), session)).toBe(absent)
    expect(await nodesAt(`${folder.path}/${segment}`)).toBe(0)
    expect(await attempt(marc, duplicate(page.id, [readable.id], segment), session)).toBe(2)
    expect(await nodesAt(`${folder.path}/${segment}`)).toBe(2)
  })

  it.each(SESSIONS)("should refuse duplicating a page under a parent she only reads, and let whoever writes the parent (session %s)", async (session) => {
    const [read, folder] = [await orgPage(), await teamPage()]
    const written = await node(folder, { owner: { kind: "org", id: org.id } })
    const [refused, copied] = [`c${tag()}`, `c${tag()}`]
    // La racine et la page de l'organisation : Léa et Marc les lisent ; la page de l'équipe : Marc l'écrit.
    expect(await attempt(lea, duplicate(read.id, [], refused), session)).toMatch(/^42501 /)
    expect(await attempt(marc, duplicate(read.id, [], refused), session)).toMatch(/^42501 /)
    expect(await nodesAt(refused)).toBe(0)
    expect(await attempt(marc, duplicate(written.id, [], copied), session)).toBe(1)
    expect(await nodesAt(`${folder.path}/${copied}`)).toBe(1)
  })
})
