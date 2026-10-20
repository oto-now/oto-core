// @vitest-environment node
// Le niveau exigé par la lecture du contenu d'un nœud, et le dernier auteur d'un bloc (migration `20261021130000`, décision
// d'Alexis du 20/10 ; suite de `role-dans-les-blocs.test.ts`) : avec son seul jeton, en SQL direct, un membre simple ne lit
// ni les blocs publiés, ni les versions, ni les liens sortants, ni les noms des fichiers joints d'une page qui lui est
// cachée (l'espace personnel d'un autre, une page d'équipe fermée) ; ni le brouillon, ni l'en-tête du brouillon d'une page
// qu'il lit sans l'écrire ; ni le jeton du lien public d'une page qu'il ne partage pas. Personne ne nomme un autre que soi
// dernier auteur d'un bloc (`updated_by`). Sous sa session comme sous celle du serveur, qui juge la même personne.
// L'ayant droit du service lit : `findNode` et les listes filtrées par `nodeLevels` (niveau 1) pour le contenu publié,
// `loadDraft` derrière le niveau 2 pour le brouillon, `managedNode` (niveau 3) ou l'administrateur pour le lien public.
// Les fichiers d'une page à la corbeille restent lus par toute l'organisation : la purge de la corbeille (`purgeTrash`,
// une rétention de l'organisation) en retire les objets. Les statistiques d'usage gardent leurs comptes de toute
// l'organisation par trois fonctions `security definer`, réservées à l'administrateur. Le titre et le résumé d'un nœud
// (`nodes_select_level`) restent
// lus par toute l'organisation, en attente d'une décision. Une lecture écartée par la policy rend zéro ligne ; un
// `with check` refusé lève 42501.
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { pendingMigrations, pendingReason } from "../helpers/pending-migrations"
import { asCaller, failureOf, seedWithAdmin, SQL_SKIP_REASON, sqlConfigured, type SeededData, type SeededOrg, type SeededPerson } from "../helpers/sql"
import type { Tx } from "../../packages/plateforme/server/sql"

const VERSION = "20261021130000"
const pending = (await pendingMigrations()).includes(VERSION)

const suite = !sqlConfigured
  ? `the level required by the reads of the content of a node, and the last author of a block (${SQL_SKIP_REASON})`
  : pending
    ? `the level required by the reads of the content of a node, and the last author of a block (${pendingReason([VERSION])})`
    : "the level required by the reads of the content of a node, and the last author of a block: a plain member reads nothing she may not, whoever the service lets in reads"

/** Les deux sessions d'une personne : la sienne, et celle du serveur, aux mêmes claims. */
const SESSIONS = [undefined, "server"] as const

const tag = () => Math.random().toString(16).slice(2, 8)

type Page = { id: string; path: string }

/** Ce qu'une personne lit d'un nœud, table par table, en nombre de lignes. */
type Seen = { blocks: number; versions: number; links: number; files: number }

describe.skipIf(!sqlConfigured || pending)(suite, () => {
  let seed: SeededData
  let org: SeededOrg
  /** Administratrice de O. */
  let ada: SeededPerson
  /** Membre simple de O, hors de l'équipe `led`. */
  let lea: SeededPerson
  /** Membre de O, responsable de l'équipe `led`, propriétaire de son espace personnel. */
  let paul: SeededPerson
  /** Membre simple de O, membre de l'équipe `led`. */
  let marc: SeededPerson
  let led: string
  let root: Page
  /** L'espace personnel de Paul. */
  let space: Page

  /**
   * Le résultat d'une instruction sous la session de `who` (la sienne, ou celle du serveur) : le nombre de lignes rendues,
   * `42501` pour le refus d'une policy, ou le code et le message de toute autre erreur.
   */
  async function attempt(who: SeededPerson, query: (sql: Tx) => PromiseLike<readonly unknown[]>, session?: "server"): Promise<number | string> {
    let rows = 0
    const failure = await failureOf(asCaller(who.id, who.email).tx(async (sql) => (rows = (await query(sql)).length), session))
    if (!failure) return rows
    if (failure.code === "42501" && /row-level security/.test(failure.message)) return failure.code
    return `${failure.code} ${failure.message}`
  }

  /** Un nœud publié sous `parent` (la racine par défaut), posé par la connexion d'administration ; de l'équipe `led` avec `team`. */
  async function node(options: { team?: string; parent?: Page; trashed?: boolean } = {}): Promise<Page> {
    const parent = options.parent ?? root
    const path = parent === root ? `p${tag()}` : `${parent.path}/p${tag()}`
    const [row] = await seed.admin<Page[]>`
      insert into platform.nodes (org_id, parent_id, path, kind, title, summary, status, revision, owner_kind, owner_team_id, created_by, deleted_at)
      values (${org.id}, ${parent.id}, ${path}, 'page', 'Page', 'Une page.', 'published', 1, ${options.team ? "team" : null}, ${options.team ?? null},
              ${ada.id}, ${options.trashed ? new Date(Date.now() - 40 * 86_400_000) : null})
      returning id, path`
    return row
  }

  /** Une règle nominative sur un nœud (`access_rules`, comme `setNodeRule`). */
  async function grant(page: Page, who: SeededPerson, level: "read" | "write" | "manage"): Promise<void> {
    await seed.admin`
      insert into platform.access_rules (org_id, node_id, subject_user_id, level, created_by) values (${org.id}, ${page.id}, ${who.id}, ${level}, ${ada.id})`
  }

  /**
   * Le contenu publié d'une page : un bloc, sa version, un lien sortant, un fichier joint (sans auteur : son auteur le lit
   * toujours) ; posés par la connexion d'administration.
   */
  async function published(page: Page): Promise<void> {
    const [block] = await seed.admin<{ id: string }[]>`
      insert into platform.blocks (org_id, node_id, state, type, text, position, created_by)
      values (${org.id}, ${page.id}, 'published', 'paragraph', 'Le chiffre du trimestre.', 1, ${ada.id}) returning id`
    await seed.admin`
      insert into platform.node_versions (node_id, revision, title, summary, kind, blocks, author)
      values (${page.id}, 1, 'Page', 'Une page.', 'page', '[{"type":"paragraph","text":"Le chiffre du trimestre."}]'::jsonb, ${ada.id})`
    await seed.admin`
      insert into platform.links (org_id, source_node_id, source_block_id, target_path) values (${org.id}, ${page.id}, ${block.id}, 'clients/valbrune')`
    await seed.admin`
      insert into platform.files (org_id, node_id, name, mime, size, status)
      values (${org.id}, ${page.id}, 'bilan-confidentiel.pdf', 'application/pdf', 1024, 'ready')`
  }

  /** Le brouillon ouvert de `page` et un bloc de ce brouillon, posés par la connexion d'administration. */
  async function seededDraft(page: Page): Promise<string> {
    await seed.admin`insert into platform.node_drafts (node_id, base_revision, title, created_by) values (${page.id}, 1, 'Titre à venir', ${ada.id})`
    const [block] = await seed.admin<{ id: string }[]>`
      insert into platform.blocks (org_id, node_id, state, type, text, position, created_by)
      values (${org.id}, ${page.id}, 'draft', 'paragraph', 'Pas encore publié.', 1, ${ada.id}) returning id`
    return block.id
  }

  /** Ce que `who` lit du contenu publié de `page`, table par table, sous la session donnée. */
  async function seen(who: SeededPerson, page: Page, session?: "server"): Promise<Seen | string> {
    const counts = await Promise.all([
      attempt(who, (sql) => sql`select text from platform.blocks where node_id = ${page.id} and state = 'published'`, session),
      attempt(who, (sql) => sql`select blocks from platform.node_versions where node_id = ${page.id}`, session),
      attempt(who, (sql) => sql`select target_path from platform.links where source_node_id = ${page.id}`, session),
      attempt(who, (sql) => sql`select name from platform.files where node_id = ${page.id}`, session),
    ])
    if (counts.some((count) => typeof count === "string")) return counts.join(", ")
    const [blocks, versions, links, files] = counts as number[]
    return { blocks, versions, links, files }
  }

  const all: Seen = { blocks: 1, versions: 1, links: 1, files: 1 }
  const none: Seen = { blocks: 0, versions: 0, links: 0, files: 0 }

  beforeAll(async () => {
    seed = seedWithAdmin()
    org = await seed.createOrg()
    const [row] = await seed.admin<Page[]>`
      insert into platform.nodes (org_id, parent_id, path, title, summary, owner_kind)
      values (${org.id}, null, 'guide', 'Guide', 'Racine.', 'org') returning id, path`
    root = row
    const [folder] = await seed.admin<Page[]>`
      insert into platform.nodes (org_id, parent_id, path, title, summary)
      values (${org.id}, ${root.id}, 'private', 'Espaces personnels', 'Un espace par personne.') returning id, path`
    ;[ada, lea, paul, marc] = [seed.person(), seed.person(), seed.person(), seed.person()]
    await seed.addMember(org.id, ada, "admin")
    for (const person of [lea, paul, marc]) await seed.addMember(org.id, person)
    const [team] = await seed.admin<{ id: string }[]>`
      insert into platform.teams (org_id, slug, name) values (${org.id}, ${`e${tag()}`}, ${`Équipe ${tag()}`}) returning id`
    led = team.id
    await seed.admin`insert into platform.team_members (team_id, user_id, role) values (${led}, ${paul.id}, 'lead'), (${led}, ${marc.id}, 'member')`
    const [own] = await seed.admin<Page[]>`
      select id, path from platform.nodes where org_id = ${org.id} and parent_id = ${folder.id} and owner_kind = 'user' and owner_user_id = ${paul.id}`
    space = own
  })

  afterAll(async () => {
    await seed?.cleanup()
  })

  it.each(SESSIONS)("should hide the content of a page in the personal space of another or of a closed team, and show it to whoever reads it (session %s)", async (session) => {
    // De l'équipe `led` : Léa ne la voit pas (0), Marc la lit (2). Dans l'espace de Paul : Paul seul la lit (3), pas même Ada.
    const [team, personal] = [await node({ team: led }), await node({ parent: space })]
    for (const page of [team, personal]) await published(page)
    expect(await seen(lea, team, session)).toEqual(none)
    expect(await seen(lea, personal, session)).toEqual(none)
    expect(await seen(ada, personal, session)).toEqual(none)
    expect(await seen(marc, team, session)).toEqual(all)
    expect(await seen(paul, personal, session)).toEqual(all)
    // Le titre et le résumé restent lus par toute l'organisation (`nodes_select_level`), en attente d'une décision.
    expect(await attempt(lea, (sql) => sql`select title from platform.nodes where id in (${team.id}, ${personal.id})`, session)).toBe(2)
  })

  it.each(SESSIONS)("should hide the draft of a page a plain member only reads, and show it to whoever writes it (session %s)", async (session) => {
    // Une page de l'organisation : Léa et Marc la lisent (1) ; Marc l'écrit par une règle (2).
    const page = await node()
    await published(page)
    await seededDraft(page)
    const draftBlocks = (sql: Tx) => sql`select text from platform.blocks where node_id = ${page.id} and state = 'draft'`
    const draft = (sql: Tx) => sql`select title from platform.node_drafts where node_id = ${page.id}`
    expect(await seen(lea, page, session)).toEqual(all)
    expect(await attempt(lea, draftBlocks, session)).toBe(0)
    expect(await attempt(lea, draft, session)).toBe(0)
    await grant(page, marc, "write")
    expect(await attempt(marc, draftBlocks, session)).toBe(1)
    expect(await attempt(marc, draft, session)).toBe(1)
  })

  it.each(SESSIONS)("should hide the public link of a page from whoever does not share it, and show it to whoever shares it and to the administrator (session %s)", async (session) => {
    // De l'équipe `led` : Léa ne la voit pas (0), Marc l'écrit (2), Paul la gère (3), Ada l'administre.
    const page = await node({ team: led })
    await seed.admin`insert into platform.node_shares (org_id, node_id, created_by) values (${org.id}, ${page.id}, ${paul.id})`
    const token = (sql: Tx) => sql`select token from platform.node_shares where node_id = ${page.id}`
    expect(await attempt(lea, token, session)).toBe(0)
    expect(await attempt(marc, token, session)).toBe(0)
    expect(await attempt(paul, token, session)).toBe(1)
    expect(await attempt(ada, token, session)).toBe(1)
    // Marc, à qui une règle donne la gestion, le lit.
    await grant(page, marc, "manage")
    expect(await attempt(marc, token, session)).toBe(1)
  })

  it.each(SESSIONS)("should let any member see the files of a page in the trash, which the purge of the trash removes (session %s)", async (session) => {
    const page = await node({ team: led, trashed: true })
    await published(page)
    expect(await attempt(lea, (sql) => sql`select name from platform.files where node_id = ${page.id}`, session)).toBe(1)
    expect(await attempt(lea, (sql) => sql`select text from platform.blocks where node_id = ${page.id}`, session)).toBe(0)
  })

  // Les statistiques d'usage (`server/usage-statistics.ts`) comptent le contenu de toute l'organisation sans le nommer
  // (D44) : l'administrateur, qui ne lit pas l'espace personnel de Paul, en reçoit les comptes par les fonctions
  // `security definer` ; un membre simple est refusé.
  it.each(SESSIONS)("should count for the administrator the content of the whole organisation, personal spaces included, and refuse a plain member (session %s)", async (session) => {
    const [{ since }] = await seed.admin<{ since: Date }[]>`select now() as since`
    const page = await node({ parent: space })
    await seed.admin`
      insert into platform.blocks (org_id, node_id, state, type, text, position, provenance, created_by, updated_by)
      values (${org.id}, ${page.id}, 'published', 'paragraph', 'Écrit par Paul.', 1, ${seed.admin.json({ by: paul.id, origin: "human" })}, ${paul.id}, ${paul.id})`
    await seed.admin`
      insert into platform.node_versions (node_id, revision, title, summary, kind, author) values (${page.id}, 1, 'Page', 'Une page.', 'page', ${paul.id})`
    const authorship = (sql: Tx) => sql`select user_id, origin, node_id from platform.usage_authorship(${org.id}, ${since}, ${[paul.id]}::uuid[], 100)`
    const written = (sql: Tx) => sql`select origin, count from platform.usage_written(${org.id}, ${since}, ${[paul.id]}::uuid[])`
    const published = (sql: Tx) => sql`select count from platform.usage_published_weeks(${org.id}, ${since}, ${[paul.id]}::uuid[])`
    expect(await seen(ada, page, session)).toMatchObject({ blocks: 0, versions: 0 })
    const asAda = async (query: (sql: Tx) => PromiseLike<readonly unknown[]>) => asCaller(ada.id, ada.email).tx(async (sql) => [...(await query(sql))], session)
    expect(await asAda(authorship)).toEqual([{ user_id: paul.id, origin: "human", node_id: page.id }])
    expect(await asAda(written)).toEqual([{ origin: "human", count: 1 }])
    expect(await asAda(published)).toEqual([{ count: 1 }])
    for (const query of [authorship, written, published]) expect(await attempt(lea, query, session)).toMatch(/^42501 the usage statistics/)
  })

  it.each(SESSIONS)("should refuse a writer naming someone else the last author of a block, and let her name herself (session %s)", async (session) => {
    const page = await node({ team: led })
    const block = await seededDraft(page)
    const insert = (author: SeededPerson) => (sql: Tx) =>
      sql`insert into platform.blocks (node_id, state, type, text, position, created_by, updated_by)
          values (${page.id}, 'draft', 'paragraph', 'Ajouté.', 2, ${marc.id}, ${author.id}) returning id`
    const update = (author: SeededPerson) => (sql: Tx) =>
      sql`update platform.blocks set text = 'Après.', revision = revision + 1, updated_by = ${author.id} where id = ${block} returning id`
    expect(await attempt(marc, insert(paul), session)).toBe("42501")
    expect(await attempt(marc, update(paul), session)).toBe("42501")
    expect(await seed.admin`select text, updated_by from platform.blocks where node_id = ${page.id}`).toEqual([{ text: "Pas encore publié.", updated_by: null }])
    expect(await attempt(marc, update(marc), session)).toBe(1)
    expect(await attempt(marc, insert(marc), session)).toBe(1)
    expect(await seed.admin`select text, updated_by from platform.blocks where node_id = ${page.id} order by position`).toEqual([
      { text: "Après.", updated_by: marc.id },
      { text: "Ajouté.", updated_by: marc.id },
    ])
  })
})
