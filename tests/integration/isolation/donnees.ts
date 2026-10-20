// Données de la suite d'isolation (E09-S05), sur une vraie base : deux organisations semées par le
// script Démo en mode OIDC (`pnpm demo:seed --slug t<8 hex> --user <identifiant>`, H121, E11-S14), A et
// B, chacune avec sa personne administratrice passée au script comme personne E2E (`a` pour A, `b` pour B) ; les
// marqueurs de B (AC6, AC12) posés par le service `write` sous la session de `b`, le tableau et les
// lignes par les aides de `tests/helpers/plateforme.ts` (aucun service ne crée un tableau avant
// E07-S04) ; une ligne de B dans chaque table que le script ne remplit pas (AC3 : une table vide ne
// prouve rien) ; `c`, administratrice d'A et de B (le cas où seule l'adresse sépare, HN-E09S05-3) ; `p`,
// de l'équipe plateforme, avec un accès en cours à A seulement et un accès révoqué à B. La connexion
// d'administration sert ici seulement : préparation, relecture, nettoyage. Depuis E01-S10 f2, chaque
// personne lit et écrit `platform` par la face SQL sous son appelant (`clientOf`, `asCaller`), plus par
// PostgREST ; ses jetons ne servent qu'aux portes (`sessionOf`). Suite portable (E11-S14) : personnes sans
// compte, jetons signés localement (`tests/helpers/session-locale.ts`), aucun compte de Supabase Auth.
import { execFile } from "child_process"
import path from "path"
import { promisify } from "util"
import type { Json } from "../../../packages/plateforme/server/database"
import type { PlatformDb } from "../../../packages/plateforme/server/db"
import type { Tx } from "../../../packages/plateforme/server/sql"
import { resolveIdentity } from "../../../packages/plateforme/server/identity"
import { isJsonObject } from "../../../packages/plateforme/server/json"
import { writeNode } from "../../../packages/plateforme/server/nodes/write"
import { hex } from "../../helpers/plateforme"
import { packagePolicies, platformTables } from "../../helpers/platform-tables"
import { createLocalFixtures, type LocalFixtures } from "../../helpers/session-locale"
import { asCaller, testAdminSql, type SqlUser, type TestSql } from "../../helpers/sql"

const execFileAsync = promisify(execFile)
const SEED = path.resolve(__dirname, "../../../scripts/demo-seed.mjs")
// Un passage du script : 7,4 s mesurées le 2026-09-25 ; marge pour la machine partagée.
const SEED_TIMEOUT = 120_000
/** Posée, le script Démo passe en mode OIDC : sa seule présence compte, aucun émetteur n'est joint. */
const OIDC_ISSUER = "https://issuer.example.invalid/oidc"

/** Domaines de travail de B, autres que ceux du script Démo (AC8 : la liste d'A ne cite pas ceux de B). */
const DOMAINS_B = "logistics, delivery planning"

/** Les marqueurs de B (AC6, AC12) : chemins, titres et mots qui n'existent que chez B. */
export const MARKERS = {
  folder: { path: "exploitation", title: "Exploitation" },
  page: { path: "zz_marqueur_delta", title: "ZZ Marqueur Delta", word: "zzdeltabloc" },
  procedure: { path: "exploitation/planifier_tournees", title: "Planifier les tournées de livraison", phrase: "Planifie les tournées de livraison" },
  table: { path: "exploitation/tournees", title: "Tournées de livraison", key: "T-001" },
  /** Une ligne de B au chemin commun aux deux organisations (le tableau du script Démo). */
  row: { table: "ventes/suivi_prospects", key: "zz-delta-only" },
} as const

/** Rattachement d'une table sans `org_id` à son organisation, par sa ligne parente (AC3). */
const PARENTS: Readonly<Record<string, { table: string; column: string }>> = {
  team_members: { table: "teams", column: "team_id" },
  node_versions: { table: "nodes", column: "node_id" },
  node_drafts: { table: "nodes", column: "node_id" },
}

/** Sans organisation : l'équipe plateforme, lue à part (AC5) ; les correspondances d'émetteur (E01-S11), lues par leur personne. */
const WITHOUT_ORG: readonly string[] = ["platform_staff", "identities"]

export type Place = { id: string; slug: string; prefix: string; name: string; host: string; domains: string }
export type Who = "a" | "b" | "c" | "p"
export type Row = Record<string, unknown>
/** Une organisation et les ids de ses lignes parentes (`teams`, `nodes`), pour les tables qui s'y rattachent. */
export type Scope = { org: string; parents: Record<string, string[]> }

type Attachment =
  | { kind: "org"; column: string }
  | { kind: "parent"; column: string; parent: string }
  | { kind: "none" }
  | { kind: "unknown" }

/**
 * L'organisation d'une ligne (AC3) : `id` pour `orgs`, `org_id`, sinon sa ligne parente (`PARENTS`) ;
 * aucune pour les tables de `WITHOUT_ORG` (`platform_staff`, `identities`) ; inconnue pour toute autre table, que la suite nomme en échouant.
 */
function attachmentOf(table: string, columns: readonly string[]): Attachment {
  if (table === "orgs") return { kind: "org", column: "id" }
  if (columns.includes("org_id")) return { kind: "org", column: "org_id" }
  const parent = PARENTS[table]
  if (parent) return { kind: "parent", column: parent.column, parent: parent.table }
  return WITHOUT_ORG.includes(table) ? { kind: "none" } : { kind: "unknown" }
}

/** Clé d'une ligne, colonnes de sa clé primaire jointes. */
export const keyOf = (primaryKey: readonly string[], row: Row) => primaryKey.map((column) => String(row[column])).join("/")

export type Isolation = Awaited<ReturnType<typeof build>>

/**
 * Le script Démo sur `slug`, en mode OIDC : la personne passée par `--user` et son email comme personne E2E,
 * sans compte (l'environnement du processus l'emporte sur `.env.local`).
 */
async function seedDemo(slug: string, admin: SqlUser): Promise<void> {
  await execFileAsync(process.execPath, [SEED, "--slug", slug, "--user", admin.id], {
    timeout: SEED_TIMEOUT,
    env: { ...process.env, PLATFORM_OIDC_ISSUER: OIDC_ISSUER, E2E_USER_EMAIL: admin.email },
  })
}

/** `settings` d'une organisation, objet JSON ou rien. */
function settingsOf(value: Json | undefined): { [key: string]: Json | undefined } {
  return isJsonObject(value) ? { ...value } : {}
}

/**
 * A et B semées en même temps, chaque organisation enregistrée pour le nettoyage, script en échec
 * compris ; puis les domaines de travail de B changés : le script pose les mêmes aux deux.
 */
async function seedBoth(fx: LocalFixtures, admin: TestSql, admins: { a: SqlUser; b: SqlUser }): Promise<{ a: Place; b: Place }> {
  const slugs = { a: `t${hex(4)}`, b: `t${hex(4)}` }
  const seeded = await Promise.allSettled([seedDemo(slugs.a, admins.a), seedDemo(slugs.b, admins.b)])
  const orgs = await admin<{ id: string; slug: string; prefix: string; name: string; settings: Json }[]>`
    select id, slug, prefix, name, settings from platform.orgs where slug in ${admin([slugs.a, slugs.b])}`
  for (const org of orgs) fx.trackOrg(org.id)
  const failed = seeded.find((outcome) => outcome.status === "rejected")
  if (failed) throw failed.reason
  const place = (slug: string): Place => {
    const org = orgs.find((row) => row.slug === slug)
    if (!org) throw new Error(`organisation ${slug} absente après le script Démo`)
    return { id: org.id, slug, prefix: org.prefix, name: org.name, host: `${slug}.localhost`, domains: String(settingsOf(org.settings).domains ?? "") }
  }
  const b = place(slugs.b)
  const settings = { ...settingsOf(orgs.find((org) => org.id === b.id)?.settings), domains: DOMAINS_B }
  await admin`update platform.orgs set settings = ${admin.json(JSON.parse(JSON.stringify(settings)))} where id = ${b.id}`
  return { a: place(slugs.a), b: { ...b, domains: DOMAINS_B } }
}

async function build(fx: LocalFixtures, admin: TestSql) {
  const [tables, people] = await Promise.all([
    platformTables(),
    Promise.all([
      fx.createUser({ fullName: "Alice Acme" }),
      fx.createUser({ fullName: "Bruno Delta" }),
      fx.createUser({ fullName: "Camille Deux" }),
      fx.createUser({ fullName: "Pia Plateforme" }),
    ]).then(([a, b, c, p]) => ({ a, b, c, p })),
  ])
  const schema = packagePolicies()
  const { a, b } = await seedBoth(fx, admin, people)

  await fx.addMember(a.id, people.c.id, { role: "admin", profile: { name: "Camille Deux" } })
  await fx.addMember(b.id, people.c.id, { role: "admin", profile: { name: "Camille Deux" } })
  await fx.makeStaff(people.p.id)
  await fx.grantPlatformAccess(a.id, people.p.id, people.p.id)

  const sessions = new Map<Who, Promise<{ accessToken: string }>>()
  /** Le jeton de la personne, signé localement : pour les portes (API, MCP), que l'API vérifie par `fx.verifyToken`. */
  const sessionOf = (who: Who) => {
    const known = sessions.get(who) ?? fx.sessionFor(people[who])
    sessions.set(who, known)
    return known
  }
  /** Le client du paquet de la personne, face SQL sous son appelant : ses lectures et écritures de `platform`, sous RLS. */
  const clientOf = (who: Who): PlatformDb => asCaller(people[who].id, people[who].email)

  const markers = await seedMarkers(fx, admin, { b, admin: people.b })
  const rows = await seedRows(fx, admin, { b, people })

  async function scopeOf(org: string): Promise<Scope> {
    const parentTables = [...new Set(Object.values(PARENTS).map((parent) => parent.table))]
    const read = await Promise.all(
      parentTables.map(async (table) => {
        const found = await admin<{ id: string }[]>`select id from ${admin(`platform.${table}`)} where org_id = ${org}`
        return [table, found.map((row) => String(row.id))] as const
      }),
    )
    return { org, parents: Object.fromEntries(read) }
  }

  const attachments = Object.fromEntries(Object.keys(tables).map((table) => [table, attachmentOf(table, tables[table].columns)]))

  /**
   * Les lignes de l'organisation dans une table, lues par `sql` (la connexion d'administration, ou la
   * transaction d'une personne) : par son rattachement (AC3). Table et colonnes : celles du projet.
   */
  function rowsOf(sql: Tx | TestSql, table: string, scope: Scope, columns: readonly string[]) {
    const attached = attachments[table]
    const from = sql`select ${sql([...columns])} from ${sql(`platform.${table}`)}`
    if (attached?.kind === "org") return sql<Row[]>`${from} where ${sql(attached.column)} = ${scope.org}`
    if (attached?.kind === "parent") {
      const parents = scope.parents[attached.parent] ?? []
      return sql<Row[]>`${from} where ${sql(attached.column)} = any(${parents}::uuid[])`
    }
    throw new Error(`${table} n'a pas d'organisation connue`)
  }

  /** Les tables du projet qui ont une organisation, dans l'ordre de la spécification. */
  const orgTables = Object.keys(tables).filter((table) => ["org", "parent"].includes(attachments[table].kind))

  /**
   * Les lignes de l'organisation, table par table, relues par la connexion d'administration et rangées par
   * clé : les colonnes que posent les migrations du paquet et que le projet sert (une colonne d'une
   * migration appliquée au projet mais pas encore sur `main` n'y entre pas).
   */
  async function snapshot(org: string): Promise<Record<string, Row[]>> {
    const scope = await scopeOf(org)
    const read = await Promise.all(
      orgTables.map(async (table) => {
        const known = new Set(tables[table].columns)
        const columns = (schema[table]?.columns ?? tables[table].columns).filter((column) => known.has(column))
        const found = await rowsOf(admin, table, scope, columns)
        const key = tables[table].primaryKey
        return [table, [...found].sort((left, right) => keyOf(key, left).localeCompare(keyOf(key, right)))] as const
      }),
    )
    return Object.fromEntries(read)
  }

  return {
    fx,
    admin,
    a,
    b,
    people,
    ids: { ...markers, ...rows },
    tables,
    schema,
    attachments,
    orgTables,
    sessionOf,
    clientOf,
    scopeOf,
    rowsOf,
    snapshot,
  }
}

/**
 * Les marqueurs de B : le dossier `exploitation`, la procédure et la page témoin écrits et publiés par
 * `writeNode` sous la session de `b` (une page qui porte le mot témoin et un lien vers le tableau :
 * une ligne `links`) ; le tableau `exploitation/tournees` et sa ligne par les aides ; la ligne
 * `zz-delta-only` dans le tableau du script Démo ; un brouillon ouvert sur la page témoin, avec un
 * bloc `draft` ajouté (AC11).
 */
async function seedMarkers(fx: LocalFixtures, admin: TestSql, of: { b: Place; admin: SqlUser }) {
  const { b } = of
  const db = asCaller(of.admin.id, of.admin.email)
  const identity = await resolveIdentity(db, b.host, { userId: of.admin.id, email: of.admin.email })
  const write = (input: Record<string, unknown>) => writeNode(db, identity, { ...input, publish: true }, { kind: "human" })

  await write({ path: MARKERS.folder.path, title: MARKERS.folder.title, summary: "La logistique de B : tournées et chauffeurs." })
  const folder = await fx.nodeId(b.id, MARKERS.folder.path)
  const table = await fx.createNode(b.id, { parentId: folder, path: MARKERS.table.path, kind: "table", title: MARKERS.table.title, summary: "Les tournées de livraison de B." })
  await fx.publishBlocks(table, [], { meta: { columns: [{ name: "ref", type: "text", required: true }, { name: "chauffeur", type: "text" }], key: "ref", closed: false } })
  const [tableRow] = await fx.addRows(table, [{ key: MARKERS.table.key, data: { ref: MARKERS.table.key, chauffeur: "Nadia Ferrand" } }])
  await write({
    path: MARKERS.procedure.path,
    kind: "procedure",
    title: MARKERS.procedure.title,
    summary: `${MARKERS.procedure.phrase} de la semaine. Se demande aussi : « prépare les tournées ».`,
    ops: [{ op: "add_section", section: "Étapes", text: "1. Lister les livraisons du jour.\n2. Grouper les arrêts par commune." }],
  })
  await write({
    path: MARKERS.page.path,
    title: MARKERS.page.title,
    summary: "Page témoin de l'organisation B.",
    ops: [{ op: "add_section", section: "Témoin", text: `Le mot ${MARKERS.page.word} n'existe que chez B. Voir [[${MARKERS.table.path}]].` }],
  })
  const page = await fx.nodeId(b.id, MARKERS.page.path)
  const suivi = await fx.nodeId(b.id, MARKERS.row.table)
  await fx.addRows(suivi, [{ key: MARKERS.row.key, data: { ref: MARKERS.row.key, entreprise: "Témoin de B", statut: "à traiter" } }])
  const published = await admin<{ id: string; text: string | null }[]>`select id, text from platform.blocks where node_id = ${page} and state = 'published'`
  const publishedBlock = published.find((block) => block.text?.includes(MARKERS.page.word))?.id
  if (!publishedBlock) throw new Error("bloc témoin de B absent")
  await admin`select * from platform.open_draft(${page})`
  const [draft] = await admin<{ id: string }[]>`
    insert into platform.blocks (org_id, node_id, state, position, type, text)
    values (${b.id}, ${page}, 'draft', 99999, 'paragraph', 'Brouillon de B, jamais publié.') returning id`
  return { table, tableRow, page, publishedBlock, draftBlock: draft.id, suivi }
}

/** La seule ligne d'une lecture de la connexion d'administration ; aucune : l'opération nommée en échec. */
async function one<T>(query: PromiseLike<readonly T[]>, what: string): Promise<T> {
  const [row] = await query
  if (!row) throw new Error(`${what} failed: no row`)
  return row
}

/**
 * Une ligne de B dans chaque table que le script Démo ne remplit pas (AC3) : ancien chemin, invitation,
 * accès plateforme révoqué de `p`, journal admin, `ctx` et journal, envoi simulé, quatrième retour
 * (le script en pose trois dans chaque organisation : `FB-0004` n'existe que chez B).
 */
async function seedRows(fx: LocalFixtures, admin: TestSql, of: { b: Place; people: Record<Who, SqlUser> }) {
  const { b, people } = of
  const table = await fx.nodeId(b.id, MARKERS.table.path)
  await admin`insert into platform.node_aliases (org_id, old_path, node_id) values (${b.id}, 'exploitation/ancien_suivi', ${table})`
  const invitation = await one(
    admin<{ id: string }[]>`insert into platform.invitations (org_id, email, invited_by) values (${b.id}, ${`test-${hex(6)}@example.invalid`}, ${people.b.id}) returning id`,
    "invitation of B insert",
  )
  const grant = await one(
    admin<{ id: string }[]>`
      insert into platform.platform_grants (org_id, user_id, granted_by, revoked_at, revoked_by)
      values (${b.id}, ${people.p.id}, ${people.p.id}, now(), ${people.p.id}) returning id`,
    "revoked grant of B insert",
  )
  await admin`insert into platform.admin_journal (org_id, user_id, method) values (${b.id}, ${people.b.id}, 'tools/call')`
  await fx.seedCtxJournal({ id: b.id }, people.b, [{ tool: `${b.prefix}_read`, target: MARKERS.page.path }])
  const account = await one(admin<{ id: string }[]>`select id from platform.accounts where org_id = ${b.id} and label = 'Mail Ventes'`, "account of B read")
  await admin`
    insert into platform.sim_outbox (org_id, account_id, connector, function, payload, created_by)
    values (${b.id}, ${account.id}, 'mail', 'mail.create_draft', ${admin.json({ to: "tournees@example.invalid" })}, ${people.b.id})`
  const ticket = await one(
    admin<{ number: number }[]>`
      insert into platform.feedback (org_id, user_id, type, text, number) values (${b.id}, ${people.b.id}, 'gap', 'Il manque la carte des tournées.', 0) returning number`,
    "feedback of B insert",
  )
  // Le lien public de B (E05-S10, ADR-013 ; jeton tiré par la base).
  await admin`insert into platform.node_shares (org_id, node_id, created_by) values (${b.id}, ${table}, ${people.b.id})`
  // Une vue du tableau de B à l'écran (1.4.13) : une ligne par page, personne et jour.
  await admin`insert into platform.node_views (org_id, node_id, user_id) values (${b.id}, ${table}, ${people.b.id})`
  // Un fichier joint de B (E10-S02, ADR-016) : sa ligne seule, aucun objet dans un bucket.
  await admin`
    insert into platform.files (org_id, node_id, name, mime, size, status, created_by)
    values (${b.id}, ${table}, 'tournees.pdf', 'application/pdf', 3, 'ready', ${people.b.id})`
  // Un ticket de dépôt par lien de B (E10-S02 lot f, ADR-018) : son empreinte seule, jamais un jeton. Deux
  // empreintes tirées à chaque passage : elles sont uniques dans toute la table, et les suites d'isolation
  // sèment chacune leur B en parallèle.
  await admin`
    insert into platform.upload_tickets (org_id, user_id, token_hash, form_token_hash, kind, mode, target_path, expires_at)
    values (${b.id}, ${people.b.id}, ${hex(32)}, ${hex(32)}, 'csv', 'merge', 'ventes/suivi_prospects', now() + interval '15 minutes')`
  // Une personne retirée de B (entrée sans invitation) : son exclusion.
  await admin`insert into platform.member_exclusions (org_id, user_id, excluded_by) values (${b.id}, gen_random_uuid(), ${people.b.id})`
  // L'accès général de B (ADR-014) : toute l'organisation B peut modifier son tableau.
  await admin`insert into platform.access_rules (org_id, node_id, subject_org, level, created_by) values (${b.id}, ${table}, true, 'write', ${people.b.id})`
  const rule = await one(admin<{ id: string }[]>`select id from platform.access_rules where org_id = ${b.id} limit 1`, "rule of B read")
  const team = await one(admin<{ id: string }[]>`select id from platform.teams where org_id = ${b.id} and slug = 'support'`, "team of B read")
  // Le lexique (E01-S13) : les déclencheurs de la publication le remplissent (script Démo, marqueurs), aucun
  // client ne l'écrit ; le mot témoin de B y est.
  await one(admin`select word from platform.lexicon where org_id = ${b.id} and word = ${MARKERS.page.word}`, "lexicon of B read")
  return { invitation: invitation.id, grant: grant.id, ticket: ticket.number, rule: rule.id, team: team.id }
}

/**
 * Prépare A et B (voir l'en-tête) ; une préparation interrompue nettoie ce qu'elle a créé avant de
 * relever son échec. `nettoyer` : en `afterAll`, même en échec.
 */
export async function preparer(): Promise<Isolation & { nettoyer: () => Promise<void> }> {
  const fx = createLocalFixtures()
  const admin = testAdminSql()
  const nettoyer = async () => {
    try {
      await fx.cleanup()
    } finally {
      await admin.end({ timeout: 5 })
    }
  }
  try {
    const built = await build(fx, admin)
    return { ...built, nettoyer }
  } catch (error) {
    await nettoyer().catch((cleanupError: unknown) => console.error("[isolation] cleanup after a failed preparation", cleanupError))
    throw error
  }
}
